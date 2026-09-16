"""WHERE THEY WENT WRONG, SAID IN THIS CONCEPT'S OWN WORDS.

docs/LEARNING-MODEL.md, "The tutor never leaves" (the owner, 2026-09-15), rule 3:

    *"Every wrong answer gets the reason it is wrong, drawn where the mistake is, from the concept
    core's own misconceptions. Never 'incorrect, try again'. Never a generic hint."*

and docs/CONTENT-INTERACTION.md §4: *"a wrong sort says WHY the order matters, in this concept's
words"*.

This is the gateway half, and it plays a learner rather than reading a docstring: a course is
rendered from a real core, its items are answered wrongly, and what comes back is read. Three
things were false when this file was written, and each has a test here that failed first:

  1. **A served workbook item carried no reason at all.** ``specs.Item`` had no field for one, so
     ``Composing.tsx``'s ``item.explanation ? ...`` branch was dead on every course ever served and
     every miss in the workbook and the boss read *"Not this one. The answer is X."* — a generic
     line, the same line for all three items, in every module, forever.
  2. **Every feedback slot in a design said the same sentence.** ``_counter`` returned the FIRST
     misconception's counter whatever the mistake was, so a design's zones, tokens and steps all
     answered alike, and a learner who missed twice read one sentence twice.
  3. **The gate did not look.** ``_template_reasons`` refused seven canned phrases and never saw the
     core, so a design whose every wrong line was a generic hint passed and was cached for ninety
     days.

The model is mocked throughout: no network, no keys, no live call.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from wobo_gateway.plexus import engines, specs, store, validate

SCOPE = {"board": "CBSE", "grade": "6", "subject": "Science", "contentVersion": "2026-27"}

#: A real core in the shape ``create.core`` returns: two misconceptions, each with its counter.
CORE: dict[str, Any] = {
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
    "check": {"question": "Which part keeps a plant cell in shape?", "answer": "the cell wall"},
    "vocabulary": [
        {"term": "cell wall", "meaning": "the stiff outer boundary"},
        {"term": "chloroplast", "meaning": "where light becomes food"},
    ],
}

CORE_RECORD = {"core": CORE, "version": "1", "promptVersion": store.CORE_PROMPT_VERSION}


def _is_a_verdict(line: str) -> bool:
    """Is this line a verdict on the learner rather than a reason about the idea?

    Matched as the WHOLE line, the way the gate itself matches it, not as a substring: "a wrong
    pair costs nothing here, so read it and go again" is an honest sentence that happens to
    contain the word, and banning the word rather than the shape would forbid it.
    """
    stripped = line.strip().lower().rstrip(".!")
    return not stripped or stripped in validate._EMPTY_FEEDBACK


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
    monkeypatch.setenv("PLEXUS_DESIGNER", "off")
    monkeypatch.setattr(engines, "_complete", lambda *a, **k: (json.dumps(_course()), 400))


def _floor_course() -> dict[str, Any]:
    """The level rendered FROM THE CORE with no model call at all.

    This is the honest worst case and the one a learner actually meets when the model missed, so
    it is what the item assertions below are made against. ``_render`` serves the mocked model's
    own course, which can only carry what the mock wrote.
    """
    return engines._level_from_core(CORE_RECORD, CORE["concept"], "core", SCOPE)


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


def _wrong_lines(design: specs.InteractionDesign) -> list[str]:
    """Every line a wrong move can earn in this design, its parts' included."""
    out: list[str] = []
    for step in design.steps:
        primitive = step.primitive
        own = getattr(primitive, "feedback", None)
        if isinstance(own, specs.Feedback):
            out.append(own.wrong)
        for attr in ("zones", "steps"):
            for part in getattr(primitive, attr, []) or []:
                inner = getattr(part, "feedback", None)
                if isinstance(inner, specs.Feedback):
                    out.append(inner.wrong)
        for option in getattr(primitive, "options", []) or []:
            if not option.correct and option.teaches:
                out.append(option.teaches)
    return [line.strip() for line in out if line and line.strip()]


# --- 1. the item a learner gets wrong says why ----------------------------------------------------


def test_every_served_item_carries_the_reason_its_answer_is_the_answer() -> None:
    """The workbook and the boss are where a played learner meets most wrong answers.

    ``Composing.tsx`` renders ``item.explanation`` beside the answer on a miss. It was never sent.
    """
    course = _floor_course()
    for section in ("workbook", "boss"):
        for item in course[section]:
            reason = str(item.get("explanation") or "").strip()
            assert reason, f"{section} item {item['id']} tells a learner nothing about their miss"
            assert len(reason.split()) >= 4, f"{section} {item['id']}: {reason!r} is not a reason"
            assert not _is_a_verdict(reason), f"{section} {item['id']}: {reason!r}"


def test_the_items_that_test_a_misconception_name_it() -> None:
    """A distractor IS a misconception, so the reason a wrong pick is wrong is that misconception:
    the belief it came from, or the counter that undoes it. Both of the core's must be named
    somewhere a learner actually reads."""
    course = _floor_course()
    reasons = [str(i.get("explanation") or "").lower() for i in course["workbook"] + course["boss"]]
    for m in CORE["misconceptions"]:
        belief, counter = m["belief"].lower(), m["counter"].lower()
        assert any(belief in r or counter in r for r in reasons), (
            f"no served item names the misconception {belief!r} when a learner meets it"
        )


def test_no_two_items_on_one_screen_say_the_same_thing() -> None:
    """Three items are checked together and their misses are read together. Three identical lines
    is the same generic hint printed three times (docs/LEARNING-MODEL.md rule 4)."""
    course = _floor_course()
    for section in ("workbook", "boss"):
        reasons = [str(i.get("explanation") or "").strip() for i in course[section]]
        assert len(set(reasons)) == len(reasons), f"{section} repeats one reason: {reasons}"


def test_the_item_contract_can_carry_a_reason() -> None:
    """The client reads it, so the schema has to describe it or it can never be sent."""
    assert "explanation" in specs.Item.model_fields


def test_a_reason_the_model_wrote_survives_the_verifier() -> None:
    """The other half: a course the MODEL wrote carries its own reasons through to the learner.

    ``_verify_items`` rebuilt every item from a fixed set of keys, so a reason a model did write
    was dropped on the floor between the gateway and the screen.
    """
    served = engines._verify_items(
        [
            {
                "id": "w1",
                "type": "mcq",
                "prompt": "which part keeps the shape?",
                "options": ["the cell wall", "the nucleus"],
                "answer": "the cell wall",
                "explanation": "the wall is stiff, and the nucleus is not what holds the shape",
            },
            {
                "id": "w2",
                "type": "fill",
                "prompt": "light becomes food in the ________.",
                "answer": "chloroplast",
                "explanation": "a root cell has none, because no light reaches it",
            },
            {
                "id": "w3",
                "type": "fill",
                "prompt": "the boundary is the ________.",
                "answer": "wall",
            },
        ]
    )
    assert served is not None
    assert served[0]["explanation"].startswith("the wall is stiff")
    assert served[1]["explanation"].endswith("no light reaches it")
    # An item the model gave no reason for is not REFUSED here — a course already in the cache has
    # none and must still reach the learner. It is filled on the way out instead, by
    # `fill_item_reasons`, which is what section 4 below plays. The verifier's own answer is that
    # the item survives; what a learner is handed is never a bare item.
    assert "explanation" not in served[2]
    handed = engines.fill_item_reasons({"workbook": served, "boss": served}, CORE["concept"], SCOPE)
    assert str(handed["workbook"][2].get("explanation") or "").strip(), (
        "the item the model said nothing about reached the learner saying nothing"
    )


# --- 2. the design's feedback is drawn on the mistake ---------------------------------------------


def test_a_design_never_answers_every_mistake_with_one_sentence() -> None:
    """``_counter`` returned misconceptions[0] whatever went wrong, so a whole design spoke once."""
    for kind in specs.INTERACTION_KINDS:
        try:
            design = engines.interaction_floor(kind, CORE)
        except engines.FloorMaterial:
            continue
        lines = _wrong_lines(design)
        assert lines, f"the {kind} floor answers a wrong move with nothing"
        assert len(set(lines)) > 1 or len(lines) == 1, (
            f"the {kind} floor says one sentence to {len(lines)} different mistakes: {set(lines)}"
        )


def test_every_floor_draws_its_wrong_lines_from_this_concept() -> None:
    """A line that would read the same for any other concept teaches the game, not the idea."""
    for kind in specs.INTERACTION_KINDS:
        try:
            design = engines.interaction_floor(kind, CORE)
        except engines.FloorMaterial:
            continue
        for line in _wrong_lines(design):
            assert not _is_a_verdict(line), f"{kind}: {line!r}"
            assert "—" not in line, f"{kind}: an em dash where a learner reads: {line!r}"


def test_a_core_with_no_misconception_for_this_mistake_asks_rather_than_asserts() -> None:
    """docs/LEARNING-MODEL.md rule 3, the other half: where the core has nothing, the tutor asks."""
    bare = {
        "concept": "the parts of a plant cell",
        "shape": "classification",
        "idea": CORE["idea"],
        "why": CORE["why"],
        "misconceptions": [],
        "check": CORE["check"],
        "vocabulary": CORE["vocabulary"],
    }
    asked = False
    for kind in specs.INTERACTION_KINDS:
        try:
            design = engines.interaction_floor(kind, bare)
        except engines.FloorMaterial:
            continue
        for line in _wrong_lines(design):
            assert not _is_a_verdict(line), f"{kind}: {line!r}"
            if line.rstrip().endswith("?"):
                asked = True
    assert asked, "a core with no misconception asserted at the learner instead of asking"


# --- 3. the gate looks at the core ----------------------------------------------------------------


def _generic_design() -> specs.InteractionDesign:
    """A design that moves, has finger-sized targets, and teaches nothing about THIS concept."""
    box = specs.HitBox(x=2, y=2, w=40, h=20)
    return specs.InteractionDesign(
        id="d-generic",
        concept=CORE["concept"],
        kind="classify",
        mechanic="drop each one into the group it belongs to",
        why="the learner has to decide which group each one belongs to",
        steps=[
            specs.InteractionStep(
                id="s1",
                beat="build",
                primitive=specs.DropInteraction(
                    kind="drop",
                    prompt="put each one where it belongs",
                    tokens=[
                        specs.DropToken(
                            id="t1",
                            label="cell wall",
                            box=specs.HitBox(x=2, y=40, w=40, h=20),
                            belongs="z1",
                            why="it is one of them",
                        ),
                        specs.DropToken(
                            id="t2",
                            label="chloroplast",
                            box=specs.HitBox(x=50, y=40, w=40, h=20),
                            belongs="z2",
                            why="it is one of them",
                        ),
                    ],
                    zones=[
                        specs.DropZone(
                            id="z1",
                            label="one group",
                            box=box,
                            accepts=["t1"],
                            feedback=specs.Feedback(
                                right="that one belongs here.",
                                wrong="look again at what makes the two groups different.",
                            ),
                        ),
                        specs.DropZone(
                            id="z2",
                            label="the other group",
                            box=specs.HitBox(x=50, y=2, w=40, h=20),
                            accepts=["t2"],
                            feedback=specs.Feedback(
                                right="that one belongs here.",
                                wrong="look again at what makes the two groups different.",
                            ),
                        ),
                    ],
                    feedback=specs.Feedback(
                        right="every one is in its own group now.",
                        wrong="look again at what makes the two groups different.",
                    ),
                ),
            )
        ],
    )


def _never_judged(*a: Any, **k: Any) -> dict[str, Any]:
    raise AssertionError("the arithmetic bars let a generic design reach a paid judge")


def test_the_gate_refuses_feedback_that_names_no_misconception_of_this_core() -> None:
    """The bar the wave is about, and it is arithmetic: no model is paid to notice this."""
    verdict = validate.judge_interaction_design(
        _generic_design(),
        core=CORE,
        recent=(),
        judge_model="stub/judge",
        judge=_never_judged,
    )
    assert not verdict.ok
    assert any("misconception" in reason.lower() for reason in verdict.reasons), verdict.reasons


def test_the_gate_passes_a_design_whose_wrong_lines_teach_the_core() -> None:
    """The floor is built from the core's own misconceptions, so it must clear its own bar."""
    design = engines.interaction_floor("classify", CORE)
    verdict = validate.judge_interaction_design(
        design,
        core=CORE,
        recent=(),
        judge_model="stub/judge",
        judge=lambda *a, **k: {"score": 88.0, "critical": False, "weak": [], "notes": ""},
    )
    assert verdict.ok, verdict.reasons


def test_a_design_that_repeats_one_sentence_to_every_mistake_is_refused() -> None:
    """One sentence for four mistakes is a generic hint wearing the core's words.

    The construct floor is the one used here because it has several feedback slots: a step's own
    line, per step, plus the primitive's. A row that degrades to a single slot cannot express the
    fault at all.
    """
    design = engines.interaction_floor("construct", CORE)
    counter = CORE["misconceptions"][0]["counter"]
    for step in design.steps:
        primitive = step.primitive
        own = getattr(primitive, "feedback", None)
        if isinstance(own, specs.Feedback):
            own.wrong = counter
        for attr in ("zones", "steps"):
            for part in getattr(primitive, attr, []) or []:
                inner = getattr(part, "feedback", None)
                if isinstance(inner, specs.Feedback):
                    inner.wrong = counter
    verdict = validate.judge_interaction_design(
        design,
        core=CORE,
        recent=(),
        judge_model="stub/judge",
        judge=_never_judged,
    )
    assert not verdict.ok
    assert any("same" in r.lower() or "repeat" in r.lower() for r in verdict.reasons), (
        verdict.reasons
    )


# --- 4. the course ALREADY IN THE CACHE, played by a learner who keeps missing --------------
#
# Everything above this line fixed the courses made AFTERWARDS. A compose result is cached and
# served back verbatim, so every course any learner has actually met was written before
# `specs.Item.explanation` existed and carries no reason on any item. Those are the courses on the
# shelf right now, and for them "every miss says why" was still false.
#
# So these tests do not render a course. They put a course ON THE SHELF in the shape the shelf
# holds it, serve it through the real `run_engine`, and play a learner who misses every item.


def _cached_course(concept: str) -> dict[str, Any]:
    """A real course with every reason stripped: the shape of every course cached before the fix.

    Built from the floor rather than by hand so it is a course that genuinely passes compose
    verification and the serve-path gates, and differs from a served course in exactly one way.
    """
    course = engines._level_from_core(CORE_RECORD, concept, "core", SCOPE)
    for section in ("workbook", "boss"):
        course[section] = [
            {k: v for k, v in item.items() if k != "explanation"} for item in course[section]
        ]
    return course


def _put_it_on_the_shelf(concept: str, *, core: bool) -> dict[str, str]:
    """Cache one course the way the store holds one, and return the scope it is filed under."""
    payload = {"concept": concept, "difficulty": "core", **SCOPE}
    scope = engines._scope(payload)
    if core:
        store.save_core(concept, CORE_RECORD, scope)
    store.save(
        concept,
        "compose",
        "core",
        {
            "concept": concept,
            "modality": "compose",
            "difficulty": "core",
            "verified": True,
            "seeded": False,
            "status": store.CANONICAL,
            "provenance": {
                "engine": "engine.compose",
                "model": "a model, months ago",
                "prompt_version": store.PROMPT_VERSION,
            },
            "artifact": _cached_course(concept),
            "createdAt": "2026-08-01T00:00:00+00:00",
        },
        scope,
    )
    return scope


def _serve(concept: str) -> dict[str, Any]:
    """What a learner is handed, through the real engine entrypoint. No model call: mock mode."""
    out = engines.run_engine(
        capability="engine.compose",
        payload={"concept": concept, "difficulty": "core", **SCOPE},
        provider_model="mock",
        live=False,
    ).output
    assert out["artifact"]["topic"] == concept, "the cached course was not the one served"
    return out["artifact"]


def _a_wrong_answer(item: dict[str, Any]) -> str:
    if item["type"] == "mcq":
        return next(o for o in item["options"] if o != item["answer"])
    return "something else"


def _what_the_learner_reads(item: dict[str, Any]) -> str:
    """The miss line EXACTLY as the screen prints it (``Composing.tsx``, ItemBlock, state retry)."""
    reason = str(item.get("explanation") or "").strip()
    return f"Not this one. The answer is “{item['answer']}”." + (f" {reason}" if reason else "")


def _the_generic_line(item: dict[str, Any]) -> str:
    return f"Not this one. The answer is “{item['answer']}”."


def test_a_learner_missing_every_item_of_a_CACHED_course_is_told_why_every_time() -> None:
    """The played walk: a course cached before the fix, every item answered wrong, every line read.

    This failed before `fill_item_reasons`: all six lines were the generic one, six times.
    """
    concept = "the parts of a plant cell"
    _put_it_on_the_shelf(concept, core=True)
    course = _serve(concept)

    for section in ("workbook", "boss"):
        for item in course[section]:
            entered = _a_wrong_answer(item)
            assert entered != item["answer"], "the learner has to actually miss it"
            line = _what_the_learner_reads(item)
            assert line != _the_generic_line(item), (
                f"{section} {item['id']}: the learner missed and was told nothing but the answer"
            )
            reason = str(item["explanation"]).strip()
            assert len(reason.split()) >= 4, f"{section} {item['id']}: {reason!r} is not a reason"
            assert not _is_a_verdict(reason), f"{section} {item['id']}: {reason!r}"
            assert "—" not in reason, f"{section} {item['id']}: an em dash where a learner reads"


def test_the_cached_course_says_something_DIFFERENT_to_each_miss_on_one_screen() -> None:
    """Three items are checked together and their misses are read together (rule 4)."""
    concept = "the parts of a plant cell"
    _put_it_on_the_shelf(concept, core=True)
    course = _serve(concept)
    for section in ("workbook", "boss"):
        lines = [str(i["explanation"]).strip() for i in course[section]]
        assert len(set(lines)) == len(lines), f"{section} says one thing to three misses: {lines}"


def test_the_cached_course_answers_a_miss_in_THIS_concepts_words() -> None:
    """The reason is drawn from the concept core the platform already bought, not from a phrasebook.

    Both of the core's misconceptions have to be named somewhere the learner actually reads.
    """
    concept = "the parts of a plant cell"
    _put_it_on_the_shelf(concept, core=True)
    course = _serve(concept)
    read = [str(i["explanation"]).lower() for i in course["workbook"] + course["boss"]]
    for m in CORE["misconceptions"]:
        belief, counter = m["belief"].lower(), m["counter"].lower()
        assert any(belief in line or counter in line for line in read), (
            f"nothing a learner reads names the misconception {belief!r}"
        )


def test_a_cached_course_whose_CORE_IS_GONE_still_teaches_rather_than_verdicts() -> None:
    """The oldest courses on the shelf predate the cores, and a core can be evicted.

    The fill may not reach for a model to repair that (a serve path never buys a generation), so it
    falls back to the course's own cards. Still this concept's words; still never a generic hint.
    """
    concept = "the parts of a flower"
    scope = _put_it_on_the_shelf(concept, core=False)
    assert store.load_core(concept, scope) is None, "this case is only real without a core"
    course = _serve(concept)
    for section in ("workbook", "boss"):
        for item in course[section]:
            reason = str(item.get("explanation") or "").strip()
            assert _what_the_learner_reads(item) != _the_generic_line(item), (
                f"{section} {item['id']}: a course with no core left the learner with the answer"
            )
            assert len(reason.split()) >= 4 and not _is_a_verdict(reason), reason


def test_the_fill_repairs_THE_SERVE_and_never_rewrites_what_the_cache_holds() -> None:
    """A serve is not a migration.

    What the store holds stays what was generated, verified and judged; the repair happens on the
    way out. This also pins that the fill never mutated the record it read.
    """
    concept = "the parts of a plant cell"
    scope = _put_it_on_the_shelf(concept, core=True)
    _serve(concept)
    held = json.loads(
        store.artifact_path(concept, "compose", "core", scope).read_text(encoding="utf-8")
    )
    for section in ("workbook", "boss"):
        assert all("explanation" not in i for i in held["artifact"][section]), (
            "the serve path wrote back into the cache"
        )
    assert _serve(concept)["workbook"][0]["explanation"], "the second learner got the bare item"
