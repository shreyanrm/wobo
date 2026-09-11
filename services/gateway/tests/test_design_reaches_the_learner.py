"""THE DESIGNED INTERACTION, ON A CARD A LEARNER IS ACTUALLY SERVED.

docs/CONTENT-INTERACTION.md §3 is the wave's flagship: *"For each concept the model DESIGNS the
interaction… never as code."* Two builders built it — nine primitives, a four-bar gate, eight
filled floors, a composer and seven renderings — and the client was wired for it: ``parseActivity``
in ``screens/course/Composing.tsx`` reads ``card.design`` first and ``card.interactionKind`` second.

None of it reached a learner. ``specs.Card`` had neither field, ``_verify_compose`` built every
served card from a hard-coded literal plus the seventeen keys of ``_CARD_ACTIVITIES``, and
``design_interaction`` was called by nothing but its own test file. Both branches of the client's
parser were dead on live content and every card fell through to the legacy parsers. The browser
proof ran against hand-written fixtures whose own docstring says they are data and not content the
product serves.

So the assertions here are all on a SERVED course: what the level render hands back, with the two
field names spelled exactly as the client reads them.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from wobo_gateway.plexus import engines, specs, store

SCOPE = {"board": "CBSE", "grade": "6", "subject": "Science", "contentVersion": "2026-27"}

CORE = {
    "concept": "the parts of a plant cell",
    "shape": "classification",
    "idea": "A plant cell is a room with named parts, each one doing a job the others cannot.",
    "why": "Every structure a plant has is built from these parts working together.",
    "misconceptions": [
        {
            "belief": "the cell wall and the cell membrane are the same thing",
            "counter": "the wall is stiff and outside the membrane, which is soft and alive",
        },
        {
            "belief": "chloroplasts are in every cell of a plant",
            "counter": "a root cell has none, because no light reaches it",
        },
    ],
    "check": {
        "question": "Which part keeps a plant cell in shape?",
        "answer": "the cell wall",
    },
    "vocabulary": [
        {"term": "cell wall", "meaning": "the stiff outer boundary"},
        {"term": "chloroplast", "meaning": "where light becomes food"},
    ],
}

CORE_RECORD = {"core": CORE, "version": "1", "promptVersion": store.CORE_PROMPT_VERSION}


def _course(**extra: Any) -> dict[str, Any]:
    cards = [
        {
            "id": f"c{i}",
            "kind": "text",
            "title": f"card {i}",
            "idea": "one idea",
            "interaction": {"kind": "tap", "prompt": "tap the wall"},
            "reveal": "there it is",
        }
        for i in range(1, 5)
    ]
    items = [
        {
            "id": "w1",
            "type": "fill",
            "prompt": "the stiff boundary is the ________.",
            "answer": "wall",
        },
        {
            "id": "w2",
            "type": "fill",
            "prompt": "light becomes food in the ________.",
            "answer": "chloroplast",
        },
        {
            "id": "w3",
            "type": "mcq",
            "prompt": "which part keeps the shape?",
            "options": ["the cell wall", "the nucleus"],
            "answer": "the cell wall",
        },
    ]
    return {"topic": CORE["concept"], "cards": cards, "workbook": items, "boss": items, **extra}


@pytest.fixture(autouse=True)
def _cache(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    # The background designer is a model call in a thread. Off by default here, and turned on by
    # the one test that is about it: a suite that spawns designers is a suite that spends money.
    monkeypatch.setenv("PLEXUS_DESIGNER", "off")
    monkeypatch.setattr(engines, "_complete", lambda *a, **k: (json.dumps(_course()), 400))


def _render() -> dict[str, Any]:
    out, _model, _tokens, _seeded = engines._render_level_live(
        CORE["concept"],
        "core",
        "stub/model",
        (),
        {"board": "CBSE", "class": "6"},
        SCOPE,
        CORE_RECORD,
    )
    return out


# --- 1. the two fields the client reads, on a served card -------------------------------------


def test_every_served_card_names_its_row_of_section_two() -> None:
    """``interactionKind`` is the client's second branch and it costs nothing to fill."""
    course = _render()
    kinds = {c.get("interactionKind") for c in course["cards"]}
    assert kinds == {"classify"}
    assert kinds <= set(specs.INTERACTION_KINDS)


def test_one_card_carries_a_design_the_schema_accepts() -> None:
    course = _render()
    designed = [c for c in course["cards"] if c.get("design")]
    assert len(designed) == 1, "one designed interaction per level, on one card"
    design = specs.InteractionDesign.model_validate(designed[0]["design"])
    assert design.kind == "classify"
    assert design.steps


def test_the_design_is_this_concept_and_not_a_generic_template() -> None:
    """*"Templates are the floor, not the ceiling"* — and a floor is filled from the core."""
    course = _render()
    design = next(c["design"] for c in course["cards"] if c.get("design"))
    blob = json.dumps(design).lower()
    assert "cell wall" in blob
    # A wrong move teaches the IDEA, from the core's own misconception.
    feedback = [
        s["primitive"]["feedback"]["wrong"]
        for s in design["steps"]
        if isinstance(s.get("primitive"), dict) and s["primitive"].get("feedback")
    ]
    assert feedback and all(f.strip() for f in feedback)


# --- 2. what it costs -------------------------------------------------------------------------


def test_the_design_is_made_once_and_read_from_the_store_after_that(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Keyed on concept x row, like the core. Twelve levels of one concept design it once."""
    calls: list[str] = []
    real = engines.interaction_floor

    def counted(kind: str, core: dict[str, Any]) -> Any:
        calls.append(kind)
        return real(kind, core)

    monkeypatch.setattr(engines, "interaction_floor", counted)
    first = _render()
    second = _render()
    assert first["cards"][0]["interactionKind"] == second["cards"][0]["interactionKind"]
    assert len(calls) == 1, f"the design was built {len(calls)} times"
    assert store.load_design(CORE["concept"], "classify") is not None


def test_a_design_never_costs_a_model_call_on_the_level_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The level render is Luna's one call. A second live call per level is not the economy §1
    describes, so the design on this path is the core's own floor until a designer fills it."""

    def refuse(*a: Any, **k: Any) -> None:
        raise AssertionError("the level path asked a model to design an interaction")

    monkeypatch.setattr(engines, "design_interaction", refuse)
    course = _render()
    assert any(c.get("design") for c in course["cards"])


def test_the_designer_runs_behind_the_response_and_the_next_learner_gets_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """§3: the model designs, and the learner in front of us never waits for it.

    The first render serves the floor and spawns the designer; what the designer writes is what
    the NEXT render serves. Two calls at most, per concept, per ninety days — so a concept whose
    design is already in the store never spawns another.
    """
    designed: list[str] = []

    class _Outcome:
        source = "model"

        def __init__(self) -> None:
            self.design = specs.InteractionDesign.model_validate(_model_design())

        def provenance(self) -> dict[str, Any]:
            return {"engine": "engine.design", "source": "model", "model": "stub", "costUsd": 0.004}

    def designer(core: dict[str, Any], **kw: Any) -> Any:
        designed.append(str(core.get("concept") or ""))
        return _Outcome()

    monkeypatch.setenv("PLEXUS_DESIGNER", "on")
    monkeypatch.setattr(engines, "design_interaction", designer)
    monkeypatch.setattr(engines.threading, "Thread", _Immediate)

    first = _render()
    served = next(c["design"] for c in first["cards"] if c.get("design"))
    assert served["source"] == "floor", "the learner in front of us did not wait for a model"

    second = _render()
    upgraded = next(c["design"] for c in second["cards"] if c.get("design"))
    assert upgraded["mechanic"] == _model_design()["mechanic"]
    assert len(designed) == 1, "a stored design is never designed again"


class _Immediate:
    """A thread that runs in the caller, so a background job is a testable one."""

    def __init__(self, target: Any = None, **kw: Any) -> None:
        self._target = target

    def start(self) -> None:
        if self._target is not None:
            self._target()


# --- 3. a design the model wrote itself, and one it botched ------------------------------------


def _model_design() -> dict[str, Any]:
    """A design in the vocabulary of §3, shaped the way ``specs.py`` says a drop is shaped."""
    return {
        "id": "design-plant-cell",
        "concept": CORE["concept"],
        "kind": "classify",
        "mechanic": "drop each part into the cell that would have it",
        "why": "a root cell has no chloroplast, and dropping one in is the misconception happening",
        "steps": [
            {
                "id": "s1",
                "beat": "build",
                "primitive": {
                    "kind": "drop",
                    "prompt": "put each part where it belongs",
                    "tokens": [
                        {
                            "id": "p1",
                            "label": "chloroplast",
                            "box": {"x": 4, "y": 46, "w": 20, "h": 14},
                            "belongs": "z1",
                            "why": "it needs light, and light reaches a leaf",
                        },
                        {
                            "id": "p2",
                            "label": "cell wall",
                            "box": {"x": 30, "y": 46, "w": 20, "h": 14},
                            "belongs": "z2",
                            "why": "every plant cell is held in shape by one",
                        },
                    ],
                    "zones": [
                        {
                            "id": "z1",
                            "label": "leaf cell",
                            "box": {"x": 4, "y": 4, "w": 40, "h": 30},
                            "accepts": ["p1", "p2"],
                            "feedback": {
                                "right": "light gets here, so food is made here",
                                "wrong": "nothing in a leaf cell holds a root's job",
                            },
                        },
                        {
                            "id": "z2",
                            "label": "root cell",
                            "box": {"x": 52, "y": 4, "w": 40, "h": 30},
                            "accepts": ["p2"],
                            "feedback": {
                                "right": "a root cell is held in shape the same way",
                                "wrong": "no light reaches a root, so a chloroplast idles",
                            },
                        },
                    ],
                    "feedback": {
                        "right": "that is where it does its work",
                        "wrong": "no light reaches a root, so a chloroplast idles",
                    },
                },
            }
        ],
    }


def test_a_model_written_design_on_the_card_is_kept_verbatim() -> None:
    spec = _course()
    spec["cards"][0]["design"] = _model_design()
    out = engines._verify_compose(spec, CORE["concept"], "core")
    assert out is not None
    assert out["cards"][0]["design"]["mechanic"] == _model_design()["mechanic"]


def test_a_design_the_schema_refuses_is_dropped_and_the_card_still_teaches() -> None:
    spec = _course()
    spec["cards"][0]["design"] = {**_model_design(), "steps": []}
    out = engines._verify_compose(spec, CORE["concept"], "core")
    assert out is not None
    assert "design" not in out["cards"][0]
    assert len(out["cards"]) == 4


def test_the_card_contract_carries_both_fields() -> None:
    """The generated contract described a card that could not carry what the client reads."""
    assert "design" in specs.Card.model_fields
    assert "interactionKind" in specs.Card.model_fields


def test_a_slide_is_spelled_the_way_the_client_reads_it() -> None:
    """``from`` is a Python keyword, so the field is ``from_`` with an alias, and a plain dump
    emits the python name. The client requires ``from`` (parse.ts: "min, max, from and at must all
    be finite numbers"), so an unaliased dump means every design carrying a slide is refused on the
    learner's screen and falls to a floor with nothing anywhere saying why. Found by putting the
    gateway's own floors through the client's own parser (apps/web-pwa/test/gateway-designs.test.ts)."""
    vary = engines.interaction_floor("vary", CORE)
    body = engines._design_json(vary)
    slides = [
        s["primitive"]
        for s in body["steps"]
        if isinstance(s.get("primitive"), dict) and s["primitive"].get("kind") == "slide"
    ]
    assert slides, "the vary floor stopped carrying a slide"
    for slide in slides:
        assert "from" in slide and "from_" not in slide
        assert isinstance(slide["from"], int | float)
