"""The plan of marks on the glass (docs/INK-FREEZE-PLAN-TRACE.md section 3, Plan).

One grammar for every mark on the learner's screen: two to four sentences, at most two marks each,
at most ten a turn; a mark is ``{kind, target, words}`` where the target is an id from the glass
map the client froze; the say names what it draws; a drawing from scratch is the separate verb
``open`` and goes to the plane's pipelines. Wrong is refused before it is drawn, with a reason. The
keyless path uses the same grammar and the same tests.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.board import glass, stream
from wobo_gateway.board.planner import plan_board
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

FIXTURES = Path(__file__).parent / "fixtures" / "glass"
SSE = {"Accept": "text/event-stream"}

GLASS = [
    {"id": "h1", "role": "heading", "text": "Solve 2x + 5 = 15", "box": [24, 80, 300, 28]},
    {"id": "w1", "role": "step", "meaning": "step:1", "text": "2x + 5 = 15", "box": [40, 130, 160, 26]},
    {"id": "w2", "role": "step", "meaning": "step:2", "text": "2x = 15 + 5", "box": [40, 166, 160, 26]},
    {"id": "w3", "role": "step", "meaning": "step:3", "text": "2x = 20", "box": [40, 202, 160, 26]},
    {"id": "chip-hint", "role": "chip", "text": "Give me a hint", "box": [40, 300, 120, 32]},
]  # fmt: skip


def payload(text: str, *, glass_map: list[dict[str, Any]] | None = GLASS, **more: Any) -> dict:
    context: dict[str, Any] = {
        "page": {"route": "practice", "state": {}},
        "turn": {"lastUserInput": text},
        **more,
    }
    if glass_map is not None:
        context["packet"] = {"v": 1, **context.get("packet", {}), "glass": glass_map}
    return {"context": context}


def sentence(say: str, *marks: dict[str, Any]) -> dict[str, Any]:
    return {"say": say, "marks": list(marks)}


def mark(kind: str, target: str, words: str) -> dict[str, Any]:
    return {"kind": kind, "target": target, "words": words}


def planned(data: dict[str, Any], text: str = "which step is wrong?", **more: Any) -> dict | None:
    """A model's plan through the same door the live path uses: parse, validate, compile."""
    body = payload(text, **more)
    entries = glass.entries_of(body)
    plan = glass.validate(glass.parse(data), entries=entries, context=body["context"])
    return glass.compile(plan)


def frames(body: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in body.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((fields["event"], json.loads(fields["data"])))
    return out


@pytest.fixture(autouse=True)
def _clean(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("LLM_MODE", "mock")
    stream.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


# --- the glass map ------------------------------------------------------------------------------


def test_the_map_rides_in_the_packet_and_is_capped_at_sixty() -> None:
    entries = glass.entries_of(payload("x"))
    assert [e.id for e in entries] == ["h1", "w1", "w2", "w3", "chip-hint"]
    assert entries[1].role == "step" and entries[1].meaning == "step:1"
    assert entries[1].box == (40.0, 130.0, 160.0, 26.0)
    many = [{"id": f"g{i}", "role": "text", "text": f"line {i}"} for i in range(80)]
    assert len(glass.entries_of(payload("x", glass_map=many))) == glass.MAX_ENTRIES == 60


def test_the_map_is_also_read_from_the_board_context_and_the_old_registry() -> None:
    body = {"context": {"turn": {"lastUserInput": "x"}}, "board": {"glass": GLASS[:2]}}
    assert [e.id for e in glass.entries_of(body)] == ["h1", "w1"]
    # An older client still sends the registry snapshot; its targets are the map until it moves.
    old = {
        "context": {
            "turn": {"lastUserInput": "x"},
            "targets": [{"id": "tri-hyp", "kind": "side", "label": "the hypotenuse"}],
            "packet": {"screen": {"surfaces": [{"id": "s", "title": "t", "targets": [
                {"id": "tri-right", "kind": "angle", "label": "the right angle"}]}]}},
        }
    }  # fmt: skip
    entries = glass.entries_of(old)
    assert [(e.id, e.role, e.text) for e in entries] == [
        ("tri-hyp", "side", "the hypotenuse"),
        ("tri-right", "angle", "the right angle"),
    ]
    assert all(e.box is None for e in entries)


def test_the_region_the_learner_circled_is_on_the_map_as_a_focus() -> None:
    body = payload("why?", packet={"focus": {"id": "f7", "kind": "lasso", "text": "2x = 10"}})
    focus = [e for e in glass.entries_of(body) if e.role == "focus"]
    assert [(e.id, e.text) for e in focus] == [("f7", "2x = 10")]


def test_an_entry_with_no_id_or_a_bad_box_is_dropped_or_kept_without_a_box() -> None:
    entries = glass.entries_of(
        payload(
            "x",
            glass_map=[{"role": "text", "text": "no id"}, {"id": "a", "text": "t", "box": [1, 2]}],
        )
    )
    assert [(e.id, e.box) for e in entries] == [("a", None)]


def test_the_map_lines_for_the_prompt_are_compact() -> None:
    lines = glass.map_lines(glass.entries_of(payload("x")))
    assert "w2 | step | step:2 | 2x = 15 + 5" in lines
    assert "box" not in lines and "[" not in lines
    assert len(lines) < 2200


# --- the grammar, and every refusal with its reason --------------------------------------------


def test_a_plan_compiles_to_one_say_and_one_beaten_object_per_mark() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Step 2 is where the sign goes wrong.", mark("ring", "w2", "step 2")),
                sentence(
                    "The 5 crossed over and kept its sign.",
                    mark("underline", "w1", "the 5"),
                    mark("arrow", "w2", "crossed over"),
                ),
                sentence("What should the 5 become on the other side?"),
            ],
            "ask": {"prompt": "What should the 5 become?", "targets": ["w2"]},
        }
    )
    assert out is not None
    assert out["say"] == (
        "Step 2 is where the sign goes wrong. The 5 crossed over and kept its sign. "
        "What should the 5 become on the other side?"
    )
    assert out["intents"] == [] and out["presentation"] == "screen"
    assert [(o["kind"], o["anchor"], o["meta"]["beat"]["with"]) for o in out["objects"]] == [
        ("ring", {"target": "w2"}, 0),
        ("underline", {"target": "w1"}, 1),
        ("arrow", {"target": "w2"}, 1),
    ]
    first, second = out["objects"][1], out["objects"][2]
    assert first["meta"]["beat"]["lag"] == 0
    assert second["meta"]["beat"]["lag"] >= first["t"]["dur"]
    assert out["ask"] == {"prompt": "What should the 5 become?", "targets": ["w2"]}
    assert not out.get("refused")


def test_every_mark_kind_has_a_stroke_the_hand_can_draw() -> None:
    out = planned(
        {
            "sentences": [
                sentence(
                    "Step 2 is right, and step 3 is not.",
                    mark("tick", "w2", "step 2"),
                    mark("cross", "w3", "step 3"),
                ),
                sentence(
                    "Bracket the 2x and point at the 20.",
                    mark("bracket", "w1", "the 2x"),
                    mark("point", "w3", "the 20"),
                ),
                sentence(
                    "A note beside step 3 says undo the doubling.",
                    mark("note", "w3", "undo the doubling"),
                ),
            ]
        }  # fmt: skip
    )
    assert out is not None
    # One pen, one name: the hand draws each kind from the element's real box (schema.ts).
    kinds = [(o["meta"]["mark"], o["kind"]) for o in out["objects"]]
    assert kinds == [
        ("tick", "tick"),
        ("cross", "cross"),
        ("bracket", "bracket"),
        ("point", "point"),
        ("note", "note"),
    ]
    note = out["objects"][-1]
    assert note["text"] == "undo the doubling" and note["anchor"] == {"target": "w3", "at": "right"}
    from wobo_gateway.board import schema

    for obj in out["objects"]:
        assert not schema.validate_object(obj), (obj["id"], schema.validate_object(obj))


def test_a_target_not_on_the_map_is_refused_with_a_reason() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Step 2 is the one to check.", mark("ring", "w2", "step 2")),
                sentence("The answer line is fine.", mark("tick", "w9", "the answer line")),
            ]
        }
    )
    assert out is not None
    assert [o["anchor"]["target"] for o in out["objects"]] == ["w2"]
    assert any("w9" in r and "not on the glass" in r for r in out["refused"]), out["refused"]


def test_the_exact_words_of_a_line_are_the_fallback_for_a_target() -> None:
    out = planned(
        {"sentences": [sentence("The line 2x = 20 is the one to check.", mark("ring", "2x = 20", "2x = 20"))]}
    )  # fmt: skip
    assert out is not None and out["objects"][0]["anchor"] == {"target": "w3"}


def test_a_number_the_ask_did_not_give_is_refused_in_the_words_and_in_the_sentence() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Step 2 is where it breaks.", mark("ring", "w2", "step 2")),
                sentence("Both sides lose 5, so 2x is 10.", mark("underline", "w2", "2x is 10")),
                sentence("Write x = 7 under it.", mark("note", "w3", "x = 7")),
            ]
        }
    )
    assert out is not None
    # 5 and 10 are on the glass (15 + 5, 2x = 20 are not 10): the 10 is a number nobody gave.
    said = out["say"]
    assert "x = 7" not in said and "2x is 10" not in said
    assert [o["words"] for o in out["objects"]] == ["step 2"]
    reasons = " | ".join(out["refused"])
    assert "'10'" in reasons and "'7'" in reasons, reasons


def test_a_number_on_the_glass_or_in_the_ask_is_given() -> None:
    out = planned(
        {
            "sentences": [
                sentence(
                    "The 15 and the 5 are on the same side in step 2.",
                    mark("ring", "w2", "the 15 and the 5"),
                ),
            ]
        },  # fmt: skip
        text="why is step 2 wrong when I get 20?",
    )
    assert out is not None and not out.get("refused"), out


def test_a_mark_with_no_words_is_refused() -> None:
    out = planned(
        {
            "sentences": [
                sentence(
                    "Step 2 is wrong.",
                    {"kind": "ring", "target": "w2"},
                    mark("underline", "w2", "step 2"),
                )
            ]
        }
    )
    assert out is not None
    assert [o["words"] for o in out["objects"]] == ["step 2"]
    assert any("no words" in r for r in out["refused"]), out["refused"]


def test_a_sentence_with_no_mark_is_refused_when_the_question_asked_to_be_shown() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Moving a term across flips its sign."),
                sentence("Step 2 kept the plus.", mark("ring", "w2", "step 2")),
                sentence("What does the 5 become?"),
            ]
        },
        text="circle the step that is wrong",
    )
    assert out is not None
    assert out["say"] == "Step 2 kept the plus. What does the 5 become?"
    assert any("no mark" in r and "asked to be shown" in r for r in out["refused"]), out["refused"]


def test_a_sentence_with_no_mark_is_kept_when_the_question_did_not_ask_to_be_shown() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Moving a term across flips its sign."),
                sentence("Step 2 kept the plus.", mark("ring", "w2", "step 2")),
            ]
        },
        text="why is my answer wrong?",
    )
    assert out is not None and out["say"].startswith("Moving a term across")


def test_a_pointer_word_with_no_mark_under_it_is_refused() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Step 2 kept the plus.", mark("ring", "w2", "step 2")),
                sentence("This one should be a minus."),
                sentence("Look here at the sign."),
            ]
        },
        text="why is my answer wrong?",
    )
    assert out is not None
    assert out["say"] == "Step 2 kept the plus."
    assert sum("pointer" in r for r in out["refused"]) == 2, out["refused"]


def test_a_label_read_back_is_not_a_sentence() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Right here: 2x = 15 + 5.", mark("ring", "w2", "2x = 15 + 5")),
                sentence("Give me a hint.", mark("ring", "chip-hint", "the hint chip")),
                sentence("The plus in step 2 should be a minus.", mark("ring", "w2", "step 2")),
            ]
        },
        text="why is my answer wrong?",
    )
    assert out is not None
    assert out["say"] == "The plus in step 2 should be a minus."
    assert sum("read back" in r for r in out["refused"]) == 2, out["refused"]


def test_the_marks_own_words_ride_with_it_when_the_sentence_words_it_differently() -> None:
    """The say and the mark are two voices for one thing. Wave 39 refused the mark whenever the
    two were worded differently and threw away most of what Luna drew; the mark's ``words`` field
    is what it means, and it is spoken with it."""
    out = planned(
        {
            "sentences": [
                sentence("The plus should be a minus.", mark("ring", "w2", "the coefficient of x")),
            ]
        },
        text="why is my answer wrong?",
    )
    assert out is not None
    assert [o["anchor"]["target"] for o in out["objects"]] == ["w2"]
    assert out["objects"][0]["words"] == "the coefficient of x"
    assert not any("does not name" in r for r in out.get("refused", []))


def test_an_unknown_mark_kind_is_refused() -> None:
    out = planned(
        {
            "sentences": [
                sentence(
                    "Step 2 is wrong.", mark("spiral", "w2", "step 2"), mark("ring", "w2", "step 2")
                )
            ]
        }
    )
    assert out is not None
    assert [o["meta"]["mark"] for o in out["objects"]] == ["ring"]
    assert any("spiral" in r for r in out["refused"])


def test_two_marks_a_sentence_and_never_a_413() -> None:
    """Four sentences of two marks is the most a plan can carry (eight), under the ten-a-turn
    ceiling: a crowded plan is trimmed with a reason and served, never refused whole."""
    assert glass.MAX_SENTENCES * glass.MAX_MARKS_PER_SENTENCE <= glass.MAX_MARKS == 10
    crowded = {
        "sentences": [
            sentence(
                f"Step {i % 3 + 1} again, and again.",
                *[mark("ring", f"w{i % 3 + 1}", f"step {i % 3 + 1}") for _ in range(5)],
            )
            for i in range(4)
        ]
    }
    out = planned(crowded, text="why?")
    assert out is not None
    per_sentence = [sum(o["meta"]["beat"]["with"] == n for o in out["objects"]) for n in range(4)]
    assert per_sentence == [2, 2, 2, 2]
    assert any("more than two marks" in r for r in out["refused"])
    plan = plan_board(out, context=payload("why?")["context"])
    assert len(plan.objects) == 8


def test_more_than_four_sentences_are_refused_from_the_fifth() -> None:
    out = planned(
        {"sentences": [sentence("Step 2 again.", mark("ring", "w2", "step 2")) for _ in range(6)]},
        text="why?",
    )
    assert out is not None
    assert len(stream.sentences(out["say"])) == 4
    assert any("more than four sentences" in r for r in out["refused"])


def test_a_drawing_from_scratch_is_the_open_verb_and_goes_to_the_pipelines() -> None:
    out = planned(
        {
            "sentences": [
                sentence("The curve bends up on both sides."),
                sentence("Where does it cross the axis?"),
            ],
            "open": {
                "kind": "graph",
                "intent": {
                    "pipeline": "math",
                    "op": "graph",
                    "expr": "x**2",
                    "var": "x",
                    "domain": [-3, 3],
                },
            },
        },  # fmt: skip
        text="graph y = x^2",
    )
    assert out is not None
    assert out["intents"] == [
        {"pipeline": "math", "op": "graph", "expr": "x**2", "var": "x", "domain": [-3, 3]}
    ]
    assert "presentation" not in out  # the ink decides the surface, never the plan


def test_an_open_that_names_no_pipeline_is_refused_and_no_empty_plane_opens() -> None:
    out = planned(
        {"sentences": [sentence("The curve bends up on both sides.")], "open": {"kind": "graph", "intent": {"op": "graph"}}},
        text="graph y = x^2",
    )  # fmt: skip
    assert out is not None
    assert out["intents"] == []
    assert any("open" in r and "pipeline" in r for r in out["refused"])
    # a plan with an open and nothing else: no board space, nothing to draw on the glass
    plan = plan_board(out, context=payload("graph y = x^2")["context"])
    assert plan.objects == [] and plan.presentation == "screen"


def test_a_plan_with_nothing_left_is_not_a_board_turn() -> None:
    assert planned({"sentences": [sentence("", mark("ring", "w2", "step 2"))]}) is None
    assert planned({"sentences": []}) is None
    assert planned({}) is None
    assert planned({"sentences": "not a list"}) is None


def test_the_plan_keeps_no_board_geometry() -> None:
    out = planned(
        {"sentences": [sentence("Step 2 is wrong.", {"kind": "ring", "target": "w2", "words": "step 2", "at": [500, 500], "offset": [3, 3]})]}
    )  # fmt: skip
    assert out is not None
    obj = out["objects"][0]
    assert set(obj["anchor"]) == {"target"} and "offset" not in obj["anchor"]


def test_marks_on_the_map_resolve_in_the_planner() -> None:
    out = planned({"sentences": [sentence("Step 2 is wrong.", mark("ring", "w2", "step 2"))]})
    plan = plan_board(out, context=payload("which step is wrong?")["context"])
    assert [o["anchor"] for o in plan.objects] == [{"target": "w2"}]
    assert plan.presentation == "screen"
    assert plan.refusals == []


# --- the timing law on the wire -------------------------------------------------------------------


def test_a_sentences_first_stroke_starts_with_its_first_word_and_never_after_it_ends() -> None:
    out = planned(
        {
            "sentences": [
                sentence("Step 2 is where the sign goes wrong.", mark("ring", "w2", "step 2")),
                sentence(
                    "The 5 crossed over and kept its sign, so step 3 is off too.",
                    mark("underline", "w1", "the 5"),
                    mark("cross", "w3", "step 3"),
                ),
                sentence("What should the 5 become on the other side?"),
            ]
        }
    )
    plan = plan_board(out, context=payload("which step is wrong?")["context"])
    events = stream.build_events(plan)
    says = [e for e in events if e.type == "say"]
    inks = [e for e in events if e.type == "ink"]
    assert len(says) == 3 and len(inks) == 3
    by_sentence: dict[int, list[Any]] = {}
    for e in inks:
        by_sentence.setdefault(e.data["object"]["meta"]["beat"]["with"], []).append(e)
    for n, marks in by_sentence.items():
        start, dur = says[n].t, says[n].data["dur"]
        first = min(m.t for m in marks)
        assert first <= start, (n, first, start)
        for m in marks:
            assert m.t < start + dur, (n, m.t, start + dur)
    # two marks in one sentence are drawn one after the other by one pen
    a, b = sorted(by_sentence[1], key=lambda e: e.t)
    assert b.t >= a.t + a.data["object"]["t"]["dur"]
    assert b.t + b.data["object"]["t"]["dur"] <= says[1].t + says[1].data["dur"]


def test_a_mark_that_cannot_fit_after_the_first_still_ends_inside_its_sentence() -> None:
    clock = [(0, 320)]
    late = {"t": {"dur": 300}, "meta": {"beat": {"with": 0, "lag": 200}}}
    start, dur = stream._beat_slot(late, clock)
    assert start + dur <= 320 and start >= 0


# --- the keyless path: the same grammar, from the map and the verifier --------------------------


@pytest.mark.parametrize("name", ["which-step-is-wrong", "circle-the-effect"])
def test_the_golden_keyless_plans(name: str) -> None:
    case = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    body = {"context": {**case["context"], "turn": {"lastUserInput": case["question"]}}}
    out = glass.keyless_plan(body)
    assert out == case["plan"], json.dumps(out, indent=1)
    # and it survives everything a live plan survives
    plan = plan_board(out, context=body["context"])
    assert len(plan.objects) == len(case["plan"]["objects"]) and plan.refusals == []
    assert plan.presentation == "full"  # the course route is a lesson: the board is the screen


def test_the_keyless_plan_names_the_entry_the_words_name_never_the_container() -> None:
    case = json.loads((FIXTURES / "circle-the-effect.json").read_text(encoding="utf-8"))
    entries = glass.entries_of({"context": case["context"]})
    assert glass.named_entry("circle the effect circle in the diagram", entries).id == "d1.effect"
    assert glass.named_entry("what is the cause here?", entries).id == "d1.cause"
    assert glass.named_entry("what is this about?", entries) is None


def test_which_step_is_wrong_needs_the_verifier_or_the_content_model_never_a_guess() -> None:
    ungrounded = payload("which step is wrong here?")
    assert glass.keyless_plan(ungrounded) is None
    modelled = payload(
        "which step is wrong here?",
        glass_map=[
            *GLASS[:2],
            {"id": "w2", "role": "step", "meaning": "step:2 misconception:moves-term-without-sign", "text": "2x = 15 + 5"},
        ],
    )  # fmt: skip
    out = glass.keyless_plan(modelled)
    assert out is not None and out["objects"][0]["anchor"] == {"target": "w2"}


def test_a_question_that_names_nothing_on_the_map_is_a_conversation() -> None:
    assert glass.keyless_plan(payload("what is this about?")) is None
    assert glass.keyless_plan(payload("hello")) is None
    assert glass.keyless_plan(payload("which side is the hypotenuse?", glass_map=None)) is None


def test_a_request_to_build_is_never_a_ring_round_the_nearest_thing_named() -> None:
    """The harness case place.plane.pythagoras-squares: the hypotenuse chip is on the screen and
    the ask is to draw the squares on the sides. The old target plan rang the chip because "show
    me" was in the sentence; a build verb with no marking word is not a mark on the glass."""
    triangle = [{"id": "tri-hyp", "role": "side", "text": "the hypotenuse"}]
    ask = "draw the right triangle with legs 3 cm and 4 cm and show me why the square on the hypotenuse equals the other two squares"
    assert glass.keyless_plan(payload(ask, glass_map=triangle)) is None
    # a marking word beside the build verb is still a mark: "draw a ring round the hypotenuse"
    out = glass.keyless_plan(payload("draw a ring round the hypotenuse", glass_map=triangle))
    assert out is not None and out["objects"][0]["anchor"] == {"target": "tri-hyp"}


def test_a_number_in_the_question_names_the_line_it_is_on() -> None:
    """The doubt harness case: "I do not get how the 5 moves to the other side" over a photo whose
    lines are an exercise number, an equation and an instruction. The 5 is on one line."""
    page = [
        {"id": "r1", "role": "photo-line", "text": "Exercise 4.2"},
        {"id": "r2", "role": "photo-line", "text": "3x + 5 = 20"},
        {"id": "r3", "role": "photo-line", "text": "Solve for x. Show each step."},
    ]
    body = payload("I do not get how the 5 moves to the other side", glass_map=page)
    assert (
        glass.named_entry(body["context"]["turn"]["lastUserInput"], glass.entries_of(body)).id
        == "r2"
    )
    out = glass.keyless_plan(body)
    assert out is not None and out["objects"][0]["anchor"] == {"target": "r2"}
    assert not out.get("refused"), out.get("refused")


def test_the_keyless_plan_marks_what_the_learner_circled() -> None:
    body = payload(
        "why?", glass_map=None, packet={"focus": {"id": "f7", "kind": "lasso", "text": "2x = 10"}}
    )
    out = glass.keyless_plan(body)
    assert out is not None
    assert [o["anchor"] for o in out["objects"]] == [{"focus": "f7"}, {"focus": "f7"}]
    assert out["ask"]["targets"] == ["f7"]
    plan = plan_board(out, context=body["context"])
    assert len(plan.objects) == 2 and plan.presentation == "screen"
    # a statement with a region in hand is not a drawing
    assert (
        glass.keyless_plan(
            payload("thanks, that helped", glass_map=None, packet={"focus": {"id": "f7"}})
        )
        is None
    )


def test_every_keyless_line_obeys_the_grammar_it_is_held_to() -> None:
    """The keyless say goes through the same validator as a model's: no read-back, no pointer
    without a mark, no number nobody gave, and the say names what it draws."""
    for name in ("which-step-is-wrong", "circle-the-effect"):
        case = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
        body = {"context": {**case["context"], "turn": {"lastUserInput": case["question"]}}}
        out = glass.keyless_plan(body)
        assert out is not None and not out.get("refused"), out.get("refused")


# --- the given numbers include the glass ---------------------------------------------------------


def test_a_number_on_the_glass_is_given() -> None:
    from wobo_gateway import spoken

    given = spoken.given_numbers(payload("why?")["context"])
    assert {15.0, 5.0, 20.0, 2.0, 1.0, 3.0} <= given


# --- through the real door ------------------------------------------------------------------------


def test_through_the_door_the_marks_ride_on_their_sentences(client: TestClient, auth) -> None:
    body = payload("circle the effect circle in the diagram")
    case = json.loads((FIXTURES / "circle-the-effect.json").read_text(encoding="utf-8"))
    body["context"]["packet"] = case["context"]["packet"]
    body["context"]["page"] = {"route": "practice", "state": {}}
    res = client.post("/v1/capability/wobo.turn", json={"payload": body}, headers={**auth(), **SSE})
    assert res.status_code == 200, res.text
    events = frames(res.text)
    kinds = [k for k, _ in events]
    assert kinds[0] == "say" and "ink" in kinds and kinds[-1] == "done"
    ink = [d for k, d in events if k == "ink"]
    say0 = next(d for k, d in events if k == "say")
    assert ink[0]["object"]["anchor"] == {"target": "d1.effect"}
    assert ink[0]["t"] == say0["t"]
    done = events[-1][1]
    assert done["presentation"] == "screen" and done["objects"] == 1
    assert "refused" not in done


def test_through_the_door_more_than_ten_marks_is_served_as_ten_never_a_413(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    import wobo_gateway.wobo as wobo_module

    crowded = {
        "sentences": [
            sentence(f"Step {i % 3 + 1} once more.", *[mark("ring", f"w{i % 3 + 1}", f"step {i % 3 + 1}")] * 5)
            for i in range(4)
        ]
    }  # fmt: skip

    def live(_payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
        body = _payload
        entries = glass.entries_of(body)
        return glass.compile(
            glass.validate(glass.parse(crowded), entries=entries, context=body["context"])
        )

    monkeypatch.setattr(wobo_module, "board_plan_for", live)
    res = client.post(
        "/v1/capability/wobo.turn", json={"payload": payload("why?")}, headers={**auth(), **SSE}
    )
    assert res.status_code == 200, res.text
    events = frames(res.text)
    assert sum(k == "ink" for k, _ in events) == 8
    done = events[-1][1]
    assert any("more than two marks" in r for r in done["refused"])


def test_a_plan_whose_ink_is_all_refused_falls_to_the_spoken_answer_with_its_reasons(
    client: TestClient, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    import wobo_gateway.wobo as wobo_module

    def live(_payload: dict[str, Any], *, live: bool) -> dict[str, Any] | None:
        return {
            "say": "Step 9 is the one.",
            "intents": [],
            "objects": [{"id": "s0m0", "kind": "ring", "anchor": {"target": "w9"}, "pad": 8}],
            "refused": ["ring on 'w9': not on the glass"],
        }

    monkeypatch.setattr(wobo_module, "board_plan_for", live)
    res = client.post(
        "/v1/capability/wobo.turn", json={"payload": payload("why?")}, headers={**auth(), **SSE}
    )
    assert res.status_code == 200, res.text
    events = frames(res.text)
    assert [k for k, _ in events if k == "ink"] == []
    done = events[-1][1]
    assert done["objects"] == 0 and done["presentation"] == "screen"
    assert any("not on the glass" in r for r in done["refused"])
    assert "Step 9" not in res.text  # the plan's words went with its ink


# --- the live path: one call, the grammar parsed, the keyless twin behind it ---------------------


class _FakeResponse:
    def __init__(self, text: str) -> None:
        self.choices = [type("C", (), {"message": type("M", (), {"content": text})()})()]
        self.usage = type("U", (), {"total_tokens": 42})()


def test_the_live_plan_is_parsed_from_the_grammar_and_compiled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import litellm
    from wobo_gateway.wobo import run_board_plan

    seen: list[dict[str, Any]] = []

    def fake(**kw: Any) -> _FakeResponse:
        seen.append(kw)
        return _FakeResponse(
            json.dumps(
                {
                    "sentences": [
                        sentence(
                            "Step 2 kept the plus when the 5 crossed over.",
                            mark("ring", "w2", "step 2"),
                        ),
                        sentence("What should the 5 become?"),
                    ],
                    "ask": {"prompt": "What should the 5 become?", "targets": ["w2"]},
                }
            )
        )

    monkeypatch.setattr(litellm, "completion", fake)
    plan, tokens = run_board_plan(provider_model="a-model", payload=payload("which step is wrong?"))
    assert tokens == 42 and len(seen) == 1
    assert plan["objects"][0]["anchor"] == {"target": "w2"}
    assert plan["say"].startswith("Step 2 kept the plus")
    prompt = seen[0]["messages"][-1]["content"]
    assert "w2 | step | step:2 | 2x = 15 + 5" in prompt
    assert 'Learner just said: "which step is wrong?"' in prompt
    assert len(prompt) < 8000
    assert "Targets you may draw on" not in prompt


def test_a_live_plan_that_is_not_json_falls_to_the_keyless_twin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import litellm
    from wobo_gateway.wobo import board_plan_for

    monkeypatch.setattr(litellm, "completion", lambda **_kw: _FakeResponse("sorry, no"))
    body = payload("graph y = x^2 from -3 to 3")
    plan = board_plan_for(body, live=True)
    assert plan is not None and plan["intents"][0]["op"] == "graph"


def test_a_silent_live_plan_is_not_floored_it_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    import litellm
    from wobo_gateway.wobo import run_board_plan

    monkeypatch.setattr(
        litellm,
        "completion",
        lambda **_kw: _FakeResponse(
            json.dumps({"sentences": [], "open": {"kind": "graph", "intent": {"pipeline": "math", "op": "graph", "expr": "x**2"}}})
        ),
    )  # fmt: skip
    plan, _ = run_board_plan(provider_model="a-model", payload=payload("graph y = x^2"))
    assert plan == {}, "ink with no words is not a board turn, and no floor is put under it"


def test_the_board_prompt_is_the_map_and_the_state_inside_the_fence() -> None:
    from wobo_gateway.wobo import _build_board_prompt

    case = json.loads((FIXTURES / "which-step-is-wrong.json").read_text(encoding="utf-8"))
    context = {**case["context"], "turn": {"lastUserInput": case["question"]}}
    prompt = _build_board_prompt(context, glass.entries_of({"context": context}))
    assert prompt.startswith("<<<LEARNER_CONTEXT")
    assert "worked-example" in prompt and "moves-term-without-sign" in prompt
    assert "first_form_that_breaks='2x = 15 + 5'" in prompt
    assert prompt.index("LEARNER_CONTEXT>>>") > prompt.index("w4 | step")
    assert "which step is wrong here?" in prompt


# --- the fixer, wave 34: what the adversary's lab found ------------------------------------------

TRIANGLE = [
    {"id": "l-q-0", "role": "line", "text": "circle the hypotenuse", "box": [1219, 167, 190, 20]},
    {"id": "l-w-0", "role": "line", "text": "Wobo", "box": [1097, 90, 48, 23]},
    {"id": "fig", "role": "figure", "text": "the triangle", "box": [345, 96, 273, 256]},
    {"id": "fig.square-on-the-hypotenuse", "role": "figure-part", "meaning": "part:square-on-the-hypotenuse", "text": "square on the hypotenuse", "box": [345, 96, 273, 256]},
    {"id": "fig.right-angle", "role": "figure-part", "meaning": "part:right-angle", "text": "right angle", "box": [345, 126, 34, 34]},
    {"id": "l-r-0", "role": "line", "text": "feel the rule", "box": [1041, 301, 100, 20]},
    {"id": "course-outline-2", "role": "step", "meaning": "step:2 concept:feel-the-rule", "text": "Feel the rule: the squares add up", "box": [194, 394, 512, 24]},
]  # fmt: skip


def test_the_words_never_name_the_learners_own_bubble() -> None:
    """The learner's chat bubble repeats every word of the question; it is never the thing named."""
    entries = glass.entries_of({"context": {"packet": {"glass": TRIANGLE}}})
    assert glass.named_entry("circle the hypotenuse", entries).id == "fig.square-on-the-hypotenuse"
    # a line that IS the question, and a line the question contains whole, are the question
    only_bubble = glass.entries_of({"context": {"packet": {"glass": TRIANGLE[:2]}}})
    assert glass.named_entry("circle the hypotenuse", only_bubble) is None


def test_a_step_outranks_a_shorter_prose_line_that_repeats_the_words() -> None:
    entries = glass.entries_of({"context": {"packet": {"glass": TRIANGLE}}})
    assert glass.named_entry("explain feel the rule", entries).id == "course-outline-2"


def test_a_mark_request_never_opens_a_drawing_over_its_own_subject() -> None:
    """Live, 'circle the hypotenuse' rang the square and then a y = x^2 graph replaced the page."""
    data = {
        "sentences": [
            sentence(
                "The square on the hypotenuse is the big one.",
                mark("ring", "fig.square-on-the-hypotenuse", "the square on the hypotenuse"),
            ),
            sentence("What do you notice about it?"),
        ],
        "ask": {"prompt": "What do you notice about it?", "targets": []},
        "open": {"kind": "graph", "intent": {"pipeline": "math", "op": "graph", "expr": "x**2"}},
    }
    out = planned(data, "circle the hypotenuse", glass_map=TRIANGLE)
    assert out is not None
    assert out["intents"] == [] and len(out["objects"]) == 1
    assert any("open" in r and "mark" in r for r in out["refused"])
    # a request to BUILD, with nothing marked on the glass, keeps its open: the plane's pipelines
    # build it as they always did
    silent = {**data, "sentences": [sentence("Watch what the curve does on both sides.")]}
    built = planned(silent, "draw the graph of x squared for me", glass_map=TRIANGLE)
    assert built is not None and built["intents"] == [data["open"]["intent"]]


def test_a_mark_is_drawn_however_its_sentence_words_it() -> None:
    """Luna: 'the corner to face' was refused because the say said 'face the corner', and on the
    live lasso turn both rings went the same way and Wobo asked 'What is being marked?'. A
    sentence is prose, not a checksum."""
    data = {
        "sentences": [
            sentence(
                "Face the corner first: the right angle sits there.",
                mark("ring", "fig.right-angle", "the corner to face"),
            ),
            sentence("Which side is opposite it?"),
        ]
    }
    out = planned(data, "show me the right angle", glass_map=TRIANGLE)
    assert out is not None and len(out["objects"]) == 1, out
    unsaid = {
        "sentences": [
            sentence("Look at the triangle.", mark("ring", "fig.right-angle", "the corner")),
        ]
    }
    out = planned(unsaid, "show me the right angle", glass_map=TRIANGLE)
    assert out is not None and [o["anchor"]["target"] for o in out["objects"]] == [
        "fig.right-angle"
    ], out


def test_a_step_number_is_a_count_not_a_quantity() -> None:
    """'Compare it with step 2' names a line; nobody has to have given the number 2."""
    data = {
        "sentences": [
            sentence("Step 2 is where the sign was lost.", mark("ring", "w2", "step 2")),
            sentence("Compare it with line 1 above.", mark("underline", "w1", "line 1")),
            sentence("What changed?"),
        ]
    }
    out = planned(data, "where is my mistake?", glass_map=[
        {"id": "w1", "role": "step", "meaning": "step:1", "text": "ax + b = c"},
        {"id": "w2", "role": "step", "meaning": "step:2", "text": "ax = c + b"},
    ])  # fmt: skip
    assert out is not None and len(out["objects"]) == 2, out
    # a bare quantity nobody gave is still refused
    data2 = {"sentences": [sentence("The angle is 90.", mark("ring", "w1", "the angle"))]}
    out2 = planned(data2, "where is my mistake?", glass_map=[
        {"id": "w1", "role": "step", "meaning": "step:1", "text": "the angle"},
    ])  # fmt: skip
    assert out2 is None


def test_the_keyless_doubt_plan_starts_on_the_first_line_of_the_photo() -> None:
    """'Explain this to me. Where do I start?' over a photo names no line by its words; the plan
    still starts somewhere: the first line, ringed, and a question about it."""
    photo = [
        {"id": "r1", "role": "photo-line", "text": "3x + 5 = 20", "box": [40, 220, 200, 40]},
        {"id": "r2", "role": "photo-line", "text": "3x = 20 + 5", "box": [40, 270, 200, 40]},
        {"id": "r3", "role": "photo-line", "text": "3x = 25", "box": [40, 320, 200, 40]},
    ]
    body = payload(
        "Explain this to me. Where do I start?",
        glass_map=photo,
        canvas={"equation": "3x + 5 = 20", "steps": ["r1: 3x + 5 = 20", "r2: 3x = 20 + 5", "r3: 3x = 25"]},
    )  # fmt: skip
    out = glass.keyless_plan(body)
    assert out is not None, "a doubt with no name in it still starts on the first line"
    targets = [o["anchor"]["target"] for o in out["objects"]]
    assert targets[0] == "r1"
    assert out["ask"]["targets"][0] == "r1"
    assert out["refused"] == [] if "refused" in out else True


def test_the_keyless_plan_marks_before_the_pipelines_guess() -> None:
    """'circle the hypotenuse' with the square on the map is a ring, never the pythagoras plane;
    'which step is wrong here?' is never a number line."""
    from wobo_gateway.wobo import mock_board_plan

    ring = mock_board_plan(payload("circle the hypotenuse", glass_map=TRIANGLE))
    assert ring is not None and ring["intents"] == [] and ring["objects"], ring
    step = mock_board_plan(
        payload(
            "which step is wrong here?",
            glass_map=[
                *GLASS[:2],
                {"id": "w2", "role": "step", "meaning": "step:2 misconception:moves-term-without-sign", "text": "2x = 15 + 5"},
            ],
        )
    )  # fmt: skip
    assert step is not None and step["intents"] == [] and step["objects"], step
    # a build word with no mark word is still the plane's
    graph = mock_board_plan(payload("graph y = x**2", glass_map=TRIANGLE))
    assert graph is not None and graph["intents"]


# --- wave 40: the aim, the words, and what a validator may refuse --------------------------------
#
# Wave 39 built the machinery and aimed it at the learner's own words. Three laws come out of that
# lab (docs/INK-FREEZE-PLAN-TRACE.md §3, and the adversary's findings 1, 7, 8):
#
#   the aim      the content model's meaning first, then the SUBJECT of the question, never the
#                whole question's word overlap, and never Wobo's own surfaces;
#   the words    the validator refuses SINS (a target not on the map, a mark with no words, a
#                number nobody gave) and keeps the WORK: on Luna it threw away five of nine live
#                drawing turns because a sentence said "face the corner" and the mark said "the
#                corner to face";
#   the verb     an open never runs on a turn whose marks landed, and never over the lesson's card.

#: The glass wave 39 actually sent at 1440 for "circle the effect circle in the diagram", with
#: Wobo's own transcript on it (turns/course/1440-c5/03-*/turn.json).
WAVE39_GLASS = [
    {"id": "l-1daka1i-0", "role": "line", "text": "A Square and A Cube", "box": [279, 29, 333, 45]},
    {"id": "l-1klzo3m-0", "role": "line", "text": "which step is wrong here?", "box": [1219, 167, 190, 20]},
    {"id": "card-c4", "role": "card", "meaning": "concept:predict-then-check", "text": "predict, then check", "box": [374, 189, 572, 460]},
    {"id": "l-1toghpt-0", "role": "line", "text": "The line that says why does that step work? is this one.", "box": [1041, 301, 333, 20]},
    {"id": "diagram-c4", "role": "figure", "text": "diagram: Predict, then check", "box": [510, 343, 300, 169]},
    {"id": "l-lpr7ee-0", "role": "line", "text": "circle the effect circle in the diagram", "box": [1139, 393, 270, 20]},
    {"id": "diagram-c4.idea", "role": "figure-part", "meaning": "part:idea", "text": "idea", "box": [564, 411, 64, 64]},
    {"id": "diagram-c4.effect", "role": "figure-part", "meaning": "part:effect", "text": "effect", "box": [698, 411, 64, 64]},
]  # fmt: skip


def _named(question: str, glass_map: list[dict[str, Any]], **more: Any) -> str | None:
    body = payload(question, glass_map=glass_map, **more)
    entry = glass.named_entry(
        question, glass.entries_of(body), context=body["context"]
    )
    return entry.id if entry else None


def test_the_aim_is_the_content_models_meaning_before_any_word_count() -> None:
    """A figure part the content model named beats a prose line that happens to share more words."""
    glass_map = [
        {"id": "prose", "role": "line", "text": "the effect of the effect is the effect again"},
        {"id": "fig.effect", "role": "figure-part", "meaning": "part:effect", "text": "effect"},
    ]
    assert _named("circle the effect in the diagram", glass_map) == "fig.effect"


def test_the_three_aims_the_lab_asked_for() -> None:
    assert _named("circle the effect circle in the diagram", WAVE39_GLASS) == "diagram-c4.effect"
    assert _named("circle the hypotenuse", TRIANGLE) == "fig.square-on-the-hypotenuse"
    # a computation is not a place on the glass: it names nothing and it is not a drawing turn
    assert _named("what is 2 to the power 5?", GLASS) is None
    assert glass.keyless_plan(payload("what is 2 to the power 5?", glass_map=GLASS)) is None


def test_wobos_own_surfaces_can_never_be_named_however_many_words_they_share() -> None:
    """Belt and braces: the client is taking the companion off the map, and the brain refuses it
    anyway. 15 of 23 course turns and 14 of 18 world turns rang one of these in wave 39."""
    # the learner's own bubble, quoted whole
    assert _named("circle the effect circle in the diagram", WAVE39_GLASS) != "l-lpr7ee-0"
    # a bubble from an EARLIER turn, which this question does not contain
    assert (
        _named(
            "why does that step work?",
            WAVE39_GLASS,
            turn={
                "lastUserInput": "why does that step work?",
                "recentTurns": [{"role": "user", "text": "which step is wrong here?"}],
            },
        )
        != "l-1klzo3m-0"
    )
    # Wobo's own reply, which quotes the learner back at them
    assert _named("what line says why does that step work", WAVE39_GLASS) != "l-1toghpt-0"
    # the gesture layer's visually hidden announcement
    sr = [
        {"id": "sr", "role": "status", "text": "circled the circle being drawn. Ask Wobo about this."},
        {"id": "c2", "role": "step", "meaning": "step:2", "text": "the circle being drawn"},
    ]  # fmt: skip
    assert _named("explain this: the circle being drawn", sr) == "c2"
    # and a surface the client labels as Wobo's own is out whatever it says
    own = [{"id": "wobo-transcript-3", "role": "line", "text": "the hypotenuse", "meaning": "wobo:transcript"}]
    assert _named("circle the hypotenuse", own) is None


def test_the_validator_keeps_the_work_when_the_sentence_words_it_differently() -> None:
    """Luna drew a ring on the right angle and said 'Face the corner first'; wave 39 threw the
    ring away for 'does not name what it draws'. The mark's words ride with the mark."""
    data = {
        "sentences": [
            sentence(
                "Look at the corner where the two shorter sides meet.",
                mark("ring", "fig.right-angle", "the corner to face"),
            ),
            sentence(
                "The square drawn on the longest side is the big one.",
                mark("underline", "fig.square-on-the-hypotenuse", "the square on the hypotenuse"),
            ),
        ]
    }
    out = planned(data, "draw this for me", glass_map=TRIANGLE)
    assert out is not None
    assert [o["anchor"]["target"] for o in out["objects"]] == [
        "fig.right-angle",
        "fig.square-on-the-hypotenuse",
    ], out
    assert not any("does not name" in r for r in out.get("refused", [])), out.get("refused")


def test_the_three_refusals_that_stay() -> None:
    """A target not on the map, a mark with no words, a number nobody gave: still refused."""
    out = planned(
        {"sentences": [sentence("Step two lost the sign.", mark("ring", "nowhere", "step two"))]},
        text="which step is wrong?",
    )
    assert out is None
    out = planned(
        {"sentences": [sentence("Step two lost the sign.", mark("ring", "w2", "  "))]},
        text="which step is wrong?",
    )
    assert out is None
    out = planned(
        {"sentences": [sentence("Step two lost the sign.", mark("ring", "w2", "the 90 degrees"))]},
        text="why is my answer wrong?",
    )
    assert out is not None and out["objects"] == []
    assert any("nobody gave" in r for r in out["refused"]), out["refused"]


def test_one_good_mark_and_one_bad_one_draws_the_good_one() -> None:
    data = {
        "sentences": [
            sentence(
                "Step 2 kept the plus when it crossed.",
                mark("ring", "w2", "step 2"),
                mark("ring", "nowhere", "the other side"),
            )
        ]
    }
    out = planned(data, text="which step is wrong?")
    assert out is not None
    assert [o["anchor"]["target"] for o in out["objects"]] == ["w2"]
    assert any("not on the glass" in r for r in out["refused"]), out["refused"]


def test_a_sentence_lost_to_the_number_law_still_lands_its_marks() -> None:
    """Live, a '2' nobody gave killed the lens plan's second sentence and both its marks with it.
    The words are not said; the ink is still drawn, and the done frame says why."""
    data = {
        "sentences": [
            sentence("The line above it still balances.", mark("ring", "w1", "the line above")),
            sentence("The image lands 30 cm away.", mark("ring", "w2", "this line")),
        ]
    }
    out = planned(data, text="which step is wrong?")
    assert out is not None
    assert sorted(o["anchor"]["target"] for o in out["objects"]) == ["w1", "w2"], out
    assert "30" not in out["say"]
    assert any("nobody gave" in r for r in out["refused"]), out["refused"]


def test_an_open_never_runs_on_a_turn_whose_marks_landed() -> None:
    """'circle the hypotenuse' rang the square and then a y = x^2 graph replaced the triangle."""
    data = {
        "sentences": [
            sentence(
                "The square on the hypotenuse is the big one.",
                mark("ring", "fig.square-on-the-hypotenuse", "the square on the hypotenuse"),
            )
        ],
        "open": {"kind": "graph", "intent": {"pipeline": "math", "op": "graph", "expr": "x**2"}},
    }
    for ask in ("circle the hypotenuse", "draw the graph of x squared for me"):
        out = planned(data, ask, glass_map=TRIANGLE)
        assert out is not None and out["intents"] == [], (ask, out)
        assert len(out["objects"]) == 1
        assert any("mark" in r and "open" in r for r in out["refused"]), out["refused"]


def test_an_open_is_only_planned_for_something_that_is_not_on_the_glass() -> None:
    silent = {"sentences": [sentence("Watch what the curve does on both sides.")],
              "open": {"kind": "graph", "intent": {"pipeline": "math", "op": "graph", "expr": "x**2"}}}  # fmt: skip
    # the subject is on the glass: the answer is on the glass too
    out = planned(silent, "why is the right angle there?", glass_map=TRIANGLE)
    assert out is not None and out["intents"] == []
    assert any("on the glass" in r for r in out["refused"]), out["refused"]
    # nothing on the glass answers it: the plane opens, as it always did
    out = planned(silent, "graph y = x squared", glass_map=TRIANGLE)
    assert out is not None and out["intents"] == [silent["open"]["intent"]]


def test_an_open_never_replaces_the_lessons_own_card() -> None:
    """'which step is wrong here?' at 390 drew a number line over the lesson's own card."""
    silent = {"sentences": [sentence("Where does the line cross?")],
              "open": {"kind": "number-line", "intent": {"pipeline": "math", "op": "number_line", "from": 0, "to": 10}}}  # fmt: skip
    out = planned(silent, "which step is wrong here?", glass_map=WAVE39_GLASS)
    assert out is not None and out["intents"] == []
    assert any("lesson" in r for r in out["refused"]), out["refused"]
    # the same plan on a page with no lesson card of its own still opens
    out = planned(silent, "which step is wrong here?", glass_map=GLASS)
    assert out is not None and out["intents"] == [silent["open"]["intent"]]
    # and a question the lesson's page cannot answer at all still opens the plane over it
    out = planned(silent, "explain photosynthesis to me", glass_map=WAVE39_GLASS)
    assert out is not None and out["intents"] == [silent["open"]["intent"]], out


def test_a_fallback_is_never_raw_json_read_aloud() -> None:
    """Live on 2026-09-08 the spoken answer for "Prove Pythagoras theorem, draw the squares" was
    the model's own envelope, cut at the token cap: the say frame carried it, the Gemini voice
    read it out at $0.0094, the transcript printed it, and nothing was drawn."""
    from wobo_gateway.wobo import _salvaged_say, is_jsonish

    wave39 = '{"path":"visualization",\n "viz":{"kind":"diagram","concept":"Pythag'
    assert is_jsonish(wave39)
    assert _salvaged_say(wave39) == ""
    # prose is still prose, however it is punctuated
    assert not is_jsonish("The square on the hypotenuse is the big one. What do you notice?")
    assert not is_jsonish("")
    # and a plan whose sentence is machinery is refused before it reaches the voice
    out = planned({"sentences": [sentence(wave39, mark("ring", "w2", "step 2"))]}, "show me why")
    assert out is None or wave39 not in out["say"]


def test_the_turn_never_speaks_an_envelope_even_when_it_parses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A model that puts its whole answer inside the ``say`` field is still machinery."""
    from wobo_gateway import wobo

    class _Msg:
        content = '{"say": "{\\"path\\": \\"visualization\\", \\"viz\\": {\\"kind\\": \\"diagram\\"}}"}'

    class _Choice:
        message = _Msg()

    class _Response:
        choices = [_Choice()]
        usage = None

    monkeypatch.setattr(wobo, "model_complete", lambda **_kw: _Response())
    monkeypatch.setattr(wobo, "record_cost", lambda **_kw: None)
    out, _tokens = wobo.run_wobo_turn(
        provider_model="openai/gpt-5.6-luna", payload=payload("prove pythagoras theorem")
    )
    assert not wobo.is_jsonish(out["say"]), out["say"]
    assert out["say"] == "Let us look at your working together."


def test_the_lasso_falls_back_to_the_region_when_the_only_words_are_wobos_own() -> None:
    """World 01: the gesture layer's hidden announcement was the only entry sharing the chip's
    words, so every lasso turn rang a 1x1 px element at the top-left corner. With Wobo's own
    words out of the running, the thing the learner drew around is what gets marked."""
    body = payload(
        "explain this: the circle being drawn",
        glass_map=[
            {"id": "l-10s73wc-0", "role": "line", "text": "circled the circle being drawn. Ask Wobo about this.", "box": [0, 0, 411, 23]},
        ],
        packet={"focus": {"id": "f-lasso", "kind": "lasso", "text": "the squares add up"}},
    )  # fmt: skip
    out = glass.keyless_plan(body)
    assert out is not None, "a lasso with a region in hand always has somewhere to mark"
    assert {o["anchor"].get("focus") for o in out["objects"]} == {"f-lasso"}, out


def test_a_refused_mark_says_why_on_the_done_frame_while_the_rest_is_drawn() -> None:
    """One good mark and one bad one: the good one is drawn, and the reason for the other rides
    to the done frame, where the learner's own surface can show it."""
    body = payload("which step is wrong?")
    body["board"] = {"presentation": "screen"}
    body["plan"] = {
        "sentences": [
            sentence(
                "Step 2 kept the plus when it crossed.",
                mark("ring", "w2", "step 2"),
                mark("ring", "nowhere", "the other side"),
            ),
            sentence("What changed?"),
        ]
    }
    out = glass.compile(
        glass.validate(
            glass.parse(body["plan"]), entries=glass.entries_of(body), context=body["context"]
        )
    )
    assert out is not None and len(out["objects"]) == 1
    plan = plan_board(out, context=body["context"])
    done = [e for e in stream.build_events(plan) if e.type == "done"]
    assert done and any("not on the glass" in r for r in done[0].data["refused"]), done[0].data
    assert len(plan.objects) == 1, "the mark that passed is still drawn"


# --- the closer, wave 41: what the adversary's lab found ------------------------------------------


def test_a_wrapped_learner_bubble_is_own_words_however_the_reader_split_it() -> None:
    """The adversary, 2026-09-09, finding 1.

    The glass reader splits a text node at its LINE BOXES, so a two-line bubble arrives as two
    entries. Wave 40's exact test matched neither, and on /chat at 390 Wobo rang the learner's own
    question and said "The line that says Draw a labelled map of India is this one."
    """
    question = "Draw a labelled map of India and mark Maharashtra"
    first = glass.Entry(id="l-ceilpw-0", role="line", text="Draw a labelled map of India and")
    assert glass.is_own_words(first, question) is True
    # the whole bubble on one line, and the question quoted whole inside a longer line
    assert glass.is_own_words(glass.Entry(id="l-1", role="line", text=question), question) is True
    assert (
        glass.is_own_words(
            glass.Entry(id="l-2", role="line", text=f"You asked {question} just now"), question
        )
        is True
    )
    # ...and a LESSON line the question happens to quote still wins its ring: it starts somewhere
    # else. This is the entry the nineteen turns that aimed correctly rang.
    lesson = glass.Entry(id="l-3", role="line", text="the square on the hypotenuse")
    assert glass.is_own_words(lesson, "circle the square on the hypotenuse") is False
    # two words is not a readback, it is a coincidence
    assert glass.is_own_words(glass.Entry(id="l-4", role="line", text="draw a"), question) is False


def test_the_named_plan_teaches_rather_than_reading_the_question_back() -> None:
    """The adversary, 2026-09-09, finding 6: every one of the nineteen turns that aimed correctly
    said "<the thing> is this one. What do you notice about it?" and nothing else, and spoke a
    step's glued ordinal aloud as "2feel"."""
    entries = [
        glass.Entry(id="s1", role="step", meaning="step:1", text="1see the shape"),
        glass.Entry(id="s2", role="step", meaning="step:2", text="2feel the rule"),
    ]
    plan = glass._named_plan("circle feel the rule", entries)
    assert plan is not None
    said = " ".join(s["say"] for s in plan["sentences"])
    # the ordinal glued to the words is never spoken
    assert "2feel" not in said
    # it says where the step SITS, which is the thing that can be taught with no model at all
    assert "step 2" in said.lower() and "step 1" in said.lower()
    assert plan["ask"]["prompt"] == "What changed between step 1 and step 2?"
    assert plan["ask"]["targets"] == ["s2", "s1"]
    # and the generic ending is gone
    assert "What do you notice about it?" not in said


def test_the_glued_ordinal_never_eats_a_line_of_algebra() -> None:
    assert glass._readable(glass.Entry(id="a", role="step", text="2feel the rule")) == (
        "feel the rule"
    )
    for kept in ("3x + 5 = 20", "12 apples", "2nd law of motion"):
        assert glass._readable(glass.Entry(id="a", role="step", text=kept)) == kept


# --- wave 45: the closer's nine ------------------------------------------------------------------


def test_a_meaning_is_a_slug_and_is_never_spoken_as_one() -> None:
    """Finding 1, 2026-09-09. `part:square-on-the-hypotenuse` reached a child's ears as
    "The square-on-the-hypotenuse is this one. What is the square-on-the-hypotenuse for?" —
    twice, hyphens and all, at both widths and under reduced motion. `meaningSlug` in
    `packages/wobo/src/glass/map.ts` writes every meaning with `[^a-z0-9]+` collapsed to a
    hyphen, so a hyphen in a meaning is a SPACE the client took out, never a word's own hyphen.
    """
    plan = glass.keyless_plan(payload("circle the hypotenuse", glass_map=TRIANGLE))
    assert plan is not None
    assert "square-on-the-hypotenuse" not in plan["say"]
    assert "The square on the hypotenuse is this one." in plan["say"]
    assert plan["ask"]["prompt"] == "What is the square on the hypotenuse for?"
    # and the mark's own words, which the ink object carries, are the same words
    assert [o["words"] for o in plan["objects"]] == ["the square on the hypotenuse"]


def test_a_meaning_with_no_words_of_its_own_still_reads_as_words() -> None:
    """A part whose text the client never captured is still named from its meaning alone."""
    glass_map = [
        {"id": "d.upper-epidermis", "role": "figure-part", "meaning": "part:upper-epidermis"},
    ]
    plan = glass.keyless_plan(payload("circle the upper epidermis", glass_map=glass_map))
    assert plan is not None
    assert "The upper epidermis is this one." in plan["say"]


# --- wave 46: the closer's seven -----------------------------------------------------------------


def test_a_list_number_is_furniture_whether_or_not_it_is_glued_to_its_words() -> None:
    """Finding 2, 2026-09-09. Wave 45 fixed the GLUED spelling in `read.ts` — the outline's
    `<span>2</span>feel the rule` now reaches the glass as "2 feel the rule" — and this module
    only ever stripped the glued form, so all fourteen world lasso turns went back to saying the
    list number out loud: "This is the line: 2 feel the rule."

    A leading number is furniture when the lines around it say so: a run of same-role entries
    numbered one after another is a numbered list, and its numbers are drawn, not spoken. One
    line beginning with a digit on its own is a number the page means ("12 apples"), and it is
    read exactly as it is written.
    """
    outline = [
        glass.Entry(id="o1", role="line", text="1 see the shape", box=(40, 100, 300, 22)),
        glass.Entry(id="o2", role="line", text="2 feel the rule", box=(40, 130, 300, 22)),
        glass.Entry(id="o3", role="line", text="3 use the rule", box=(40, 160, 300, 22)),
    ]
    plan = glass._named_plan("explain feel the rule", outline)
    assert plan is not None
    said = " ".join(s["say"] for s in plan["sentences"])
    assert "2 feel the rule" not in said, said
    assert "feel the rule" in said

    # and the same words with no list around them keep their number
    alone = [glass.Entry(id="a1", role="line", text="12 apples cost 60 rupees")]
    plan = glass._named_plan("explain 12 apples", alone)
    assert plan is not None
    assert "12 apples" in " ".join(s["say"] for s in plan["sentences"])


def test_the_list_number_is_stripped_in_both_spellings_and_nowhere_else() -> None:
    numbered = [
        glass.Entry(id="s1", role="step", text="1 see the shape"),
        glass.Entry(id="s2", role="step", text="2 feel the rule"),
    ]
    assert glass._readable(numbered[1], numbered) == "feel the rule"
    glued = [
        glass.Entry(id="s1", role="step", text="1see the shape"),
        glass.Entry(id="s2", role="step", text="2feel the rule"),
    ]
    assert glass._readable(glued[1], glued) == "feel the rule"
    # a run of two is a list; a single line is not, and a measurement is never a list number
    for kept in ("3x + 5 = 20", "12 apples", "2nd law of motion", "5 cm"):
        entry = glass.Entry(id="a", role="step", text=kept)
        assert glass._readable(entry, [entry]) == kept
        assert glass._readable(entry) == kept
