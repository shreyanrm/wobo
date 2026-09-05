"""The 2026-09-05 review of the teaching, closed one finding at a time.

The owner asked "how is the explaining quality and content and context relevance? is everything on
point?" and the honest answer was: the nature is right and the consistency is not. Each test here
is one finding from that review, driven against the exact transcript that exposed it and against
the line that closes it. Nothing here calls a model.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness import cases as case_bank  # noqa: E402
from harness import checks, ladder, runner  # noqa: E402
from harness.runner import Transcript  # noqa: E402


def _transcript(**over: Any) -> Transcript:
    base: dict[str, Any] = {
        "case_id": "under-test",
        "mode": "board",
        "status": 200,
        "say": "",
        "objects": [],
        "verified": [],
        "refused": [],
    }
    base.update(over)
    return Transcript(**base)


def _number(value: float, check: str, *, label: str = "", ident: str = "n") -> dict[str, Any]:
    obj: dict[str, Any] = {
        "id": ident,
        "kind": "number",
        "anchor": {"board": [200, 300]},
        "value": value,
        "verified": True,
        "check": check,
    }
    if label:
        obj["label"] = label
    return obj


# --- 5. a number spelled out is still a number ------------------------------------------------


def test_a_number_written_as_a_word_does_not_walk_round_the_law() -> None:
    """The cricket turn: "half an over is the same amount as three balls out of six". Two numbers
    Wobo made up, invisible to a check that read digits only."""
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Think cricket scores. Half an over is the same amount as three balls out of six.",
        ),
    )
    unsigned = [f for f in scored.wrong if f.dimension == "verified"]
    assert {f.detail.split("'")[1] for f in unsigned} == {"3", "6"}, scored.findings
    assert scored.scores["verified"] == 0


def test_a_count_in_prose_is_not_a_quantity() -> None:
    """"Try these two" and "the three parts I labelled" are prose, not arithmetic."""
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(
        case, _transcript(mode="prose", say="Try these two. Here are the three parts I labelled.")
    )
    assert not [f for f in scored.wrong if f.dimension == "verified"], scored.wrong


# --- 1, 15. the answer they asked for is said, and the working is said ----------------------


def _pythagoras_board() -> list[dict[str, Any]]:
    return [
        _number(3.0, "board.numbers_agree:hypotenuse", ident="a"),
        _number(4.0, "board.numbers_agree:hypotenuse", ident="b"),
        _number(5.0, "board.numbers_agree:hypotenuse", label="hypotenuse", ident="c"),
    ]


def test_restating_the_theorem_as_its_own_reason_is_not_working_it_out() -> None:
    """The recorded line scored 4 on the word "because" and never reached 9 + 16 = 25 or the 5."""
    case = case_bank.by_id("math.icse.9.pythagoras")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Let's build it. The long side follows Pythagoras because the squares on the two "
            "legs add to the square on the hypotenuse.",
            objects=_pythagoras_board(),
            verified=["board.numbers_agree:hypotenuse"],
            ask={"prompt": "If the legs were 6 cm and 8 cm, what would the long side be?"},
        ),
    )
    weak = [f.detail for f in scored.weak if f.dimension == "teaches"]
    assert any("asked to work it out" in d for d in weak), weak
    assert any("asked for the number and never told it" in d for d in weak), weak
    assert scored.scores["teaches"] == 0


def test_the_corrected_pythagoras_recording_teaches_in_full() -> None:
    case = case_bank.by_id("math.icse.9.pythagoras")
    recorded = runner.load(case.id)
    assert recorded is not None and recorded.note, "the fixture says it was corrected"
    scored = checks.score_transcript(case, recorded)
    assert not scored.wrong, scored.wrong
    assert scored.scores["teaches"] == 4, [f.detail for f in scored.weak]
    assert scored.scores["voice"] == 4
    assert "say.arithmetic:3**2 + 4**2 = 9 + 16 = 25 = 5**2" in recorded.verified
    assert "5 cm" in recorded.say
    assert "the right angle is the one it is about" not in recorded.board_text()


def test_handing_the_height_to_the_curve_is_not_telling_them() -> None:
    """"the curve will show the greatest height" scored full teaching marks."""
    case = case_bank.by_id("physics.cbse.11.projectile")
    board = [
        _number(10.197162, "board.numbers_agree:apex height", ident="h"),
        _number(40.788649, "board.numbers_agree:range", ident="r"),
    ]
    flat = _transcript(
        say="Let's map the flight. The ball rises then falls because gravity keeps pulling it "
        "downward, and the curve will show the greatest height.",
        objects=board,
        verified=["board.numbers_agree:apex height", "board.numbers_agree:range"],
    )
    scored = checks.score_transcript(case, flat)
    assert any("never told it" in f.detail for f in scored.weak), scored.weak
    told = _transcript(
        say="Let's map the flight. It gets to about 10.2 m high, because only the up part of "
        "the speed fights gravity.",
        objects=board,
        verified=["board.numbers_agree:apex height", "board.numbers_agree:range"],
        ask={"prompt": "If it were thrown at 30 degrees instead, would it go higher or lower, and why?"},
    )
    scored = checks.score_transcript(case, told)
    assert scored.scores["teaches"] == 4, [f.detail for f in scored.weak]
    assert not scored.wrong


# --- 14, B. a right number under the wrong name -----------------------------------------------


def _punnett_board() -> list[dict[str, Any]]:
    return [
        _number(3.0, "board.numbers_agree:punnett cells", label="dominant", ident="d"),
        _number(1.0, "board.numbers_agree:punnett cells", label="recessive", ident="r"),
    ]


def test_calling_3_to_1_the_genotype_ratio_is_wrong() -> None:
    """The live turn of 08:39: "The square shows the genotype ratio for the offspring." over a
    board reading 3 and 1. Every number verified; the name wrong; factual 0/4 from the judge and
    a clean sheet from the checks."""
    case = case_bank.by_id("bio.cbse.10.punnett")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="The square shows the genotype ratio for the offspring.",
            objects=_punnett_board(),
            verified=["board.numbers_agree:punnett cells"],
        ),
    )
    assert any("genotype ratio" in f.detail for f in scored.wrong), scored.findings
    assert scored.scores["correct"] == 0


def test_3_to_1_beside_genotype_ratio_in_one_sentence_is_wrong_too() -> None:
    case = case_bank.by_id("bio.cbse.10.punnett")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="The genotype ratio is 3 : 1, and the boxes show 1 AA : 2 Aa : 1 aa.",
            objects=_punnett_board(),
            verified=["board.numbers_agree:punnett cells"],
        ),
    )
    assert any("genotype ratio" in f.detail and "3 : 1" in f.detail for f in scored.wrong)


def test_naming_both_ratios_correctly_is_not_caught() -> None:
    case = case_bank.by_id("bio.cbse.10.punnett")
    board = [
        *_punnett_board(),
        {
            "id": "g",
            "kind": "write",
            "anchor": {"board": [200, 400]},
            "text": "genotypes 1 AA : 2 Aa : 1 aa",
            "check": "board.numbers_agree:genotype counts",
        },
    ]
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Each parent hands over one letter, so the genotype ratio is 1 AA : 2 Aa : 1 aa. "
            "A beats a wherever it appears, which is why the phenotype ratio is 3 : 1.",
            objects=board,
            verified=["board.numbers_agree:punnett cells", "board.numbers_agree:genotype counts"],
        ),
    )
    assert not scored.wrong, scored.wrong


def test_the_corrected_punnett_recording_is_right_and_teaches() -> None:
    case = case_bank.by_id("bio.cbse.10.punnett")
    recorded = runner.load(case.id)
    assert recorded is not None
    scored = checks.score_transcript(case, recorded)
    assert not scored.wrong, scored.wrong
    assert scored.scores["correct"] == 4
    assert scored.scores["teaches"] == 4, [f.detail for f in scored.weak]
    assert "genotypes 1 AA : 2 Aa : 1 aa" in recorded.board_text()


# --- 6. their world is the world's own words -------------------------------------------------


@pytest.mark.parametrize(
    "say",
    ["Let us go over this again.", "I will run through it once more.", "Grab a bat of butter."],
)
def test_going_over_it_again_is_not_cricket(say: str) -> None:
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(case, _transcript(mode="prose", say=say))
    assert scored.scores["their world"] == 0, scored.findings


def test_bowling_an_over_is_cricket() -> None:
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(
        case, _transcript(mode="prose", say="Think of one over. Bowl 3 balls of it and 3/6 = 1/2.")
    )
    assert scored.scores["their world"] == 4


def test_the_corrected_cricket_recording_is_the_target_shape() -> None:
    """A real thing a cricketer does, a because, a sum the CAS signed, a check that is work."""
    case = case_bank.by_id("teach.their-world.cricket")
    recorded = runner.load(case.id)
    assert recorded is not None
    scored = checks.score_transcript(case, recorded)
    assert not scored.wrong, scored.wrong
    assert scored.scores["teaches"] == 4, [f.detail for f in scored.weak]
    assert scored.scores["their world"] == 4
    assert scored.scores["voice"] == 4
    assert any(v.startswith("say.arithmetic:3/6 = 1/2") for v in recorded.verified)


# --- 3. the lecture built of ordinary words ---------------------------------------------------

TIMELINE_LECTURE = (
    "Here's the movement's main spine. I've linked the key turning points because each one "
    "widened the struggle, from protest against colonial violence to the demand for complete "
    "freedom. Notice how mass movements, negotiations, and sacrifice all pushed Britain towards "
    "leaving India."
)


def test_the_timeline_lecture_is_too_professional() -> None:
    out = checks.Scored()
    checks.check_voice(_transcript(say=TIMELINE_LECTURE), out)
    assert out.scores["voice"] <= 2
    assert any("a lecture in ordinary words" in f.detail for f in out.weak), out.findings


def test_the_target_line_and_a_plain_history_line_are_not_lectures() -> None:
    for say in (
        "Totally fixable. Think of negatives as a tug-of-war: if the signs match, add the sizes "
        "and keep that sign; if they differ, subtract the smaller from the bigger and keep the "
        "bigger number's sign. Try this tiny one: what is -5 + 3?",
        "Here's the timeline. It starts in 1919 at Jallianwala Bagh, because that massacre is "
        "what turned anger into a mass movement. Watch how each big push comes about a decade "
        "apart: Non-Cooperation in 1920, the salt march in 1930, Quit India in 1942, and then "
        "freedom in 1947.",
    ):
        assert checks.lecture_reason(say) == "", say


def test_a_list_of_abstractions_is_a_lecture_on_its_own() -> None:
    assert "essay" in checks.lecture_reason(
        "Notice how movements, negotiations and sacrifice all pushed Britain out."
    )


# --- 10, 22. the em dash -----------------------------------------------------------------------


def test_an_em_dash_in_what_a_learner_reads_is_marked_down() -> None:
    out = checks.Scored()
    checks.check_voice(_transcript(say="Your turn — what do we do to both sides?"), out)
    assert out.scores["voice"] <= 2
    assert any("em dash" in f.detail for f in out.weak)


def test_no_canned_line_a_learner_reads_carries_an_em_dash() -> None:
    from wobo_gateway import wobo

    lines = [*wobo._MOCK_SAY.values(), *wobo._BOARD_SAY.values(), wobo.SILENT_BOARD_SAY]
    focus = wobo._focus_plan({"focus": {"id": "f1", "text": "2x = 10"}}, "why is this wrong?")
    target = wobo._target_plan(
        {"targets": [{"id": "course-advance", "label": "the button that moves this lesson on"}]},
        "which button moves this lesson on?",
    )
    lines += [focus["say"], focus["ask"]["prompt"], target["say"], target["ask"]["prompt"]]
    # The worked examples the model is told to adapt model the dash for the live tutor.
    lines += re.findall(r'"say":"([^"]*)"', wobo.WOBO_SYSTEM)
    # The keyless dossier lines: "You're {name} — of course I remember" and its family.
    source = Path(wobo.__file__).read_text(encoding="utf-8")
    lines += re.findall(r'"say": f?"([^"\n]*)"', source)
    dashed = [line for line in lines if "—" in line]
    assert not dashed, dashed


# --- 11, 12. the register laws the harness enforces against the product ----------------------


def test_let_us_look_and_utilising_are_the_textbook_voice() -> None:
    for say in ("Let us look at what it is doing.", "We are utilising the same rule here."):
        out = checks.Scored()
        checks.check_voice(_transcript(say=say), out)
        assert out.scores["voice"] <= 2, say


def test_quiz_is_the_products_own_word_and_not_the_textbook_voice() -> None:
    """``WOBO_SYSTEM`` tells Wobo to set component kind "quiz" for "quiz me". A register law
    that failed the product's own noun was a contradiction."""
    from wobo_gateway.wobo import WOBO_PERSONA

    out = checks.Scored()
    checks.check_voice(_transcript(say="Want a quick quiz on this before we move on?"), out)
    assert out.scores["voice"] == 4, out.findings
    assert "never grade, quiz or semester" not in WOBO_PERSONA
    assert "grade 8 topic" not in WOBO_PERSONA


def test_the_keyless_lines_use_contractions_and_claim_only_what_they_draw() -> None:
    from wobo_gateway import wobo

    focus = wobo._focus_plan({"focus": {"id": "f1", "text": "2x = 10"}}, "why is this wrong?")
    assert "Let us" not in focus["say"]
    assert "Let's" in focus["say"]
    # The maths line used to promise a curve and a tangent over every maths board.
    assert "curve" not in wobo._BOARD_SAY["math"]
    assert "touches" not in wobo._BOARD_SAY["math"]
    for line in wobo._BOARD_SAY.values():
        assert "I will" not in line, line


# --- 7. hollow checks, and the checks that are work --------------------------------------------


def test_a_different_case_from_the_board_is_work_not_a_lookup() -> None:
    board = _punnett_board()
    transcript = _transcript(objects=board, verified=["board.numbers_agree:punnett cells"])
    assert (
        checks.hollow_reason(
            "If one parent were aa instead, how many of the boxes would show the recessive look?",
            transcript,
        )
        == ""
    )
    assert checks.hollow_reason("How many are recessive?", transcript) != ""


def test_a_why_over_a_dated_label_is_reasoning_not_a_reading() -> None:
    timeline = runner.load("social.cbse.10.timeline")
    assert timeline is not None
    assert checks.hollow_reason("Why do you think the Quit India call came in 1942?", timeline) == ""
    assert checks.hollow_reason("Which year is written beside Quit India?", timeline) != ""


# --- 8. the ladder is held to the turn laws ----------------------------------------------------


def test_every_rung_of_the_ladder_is_scored_like_a_turn() -> None:
    case = ladder._case_for("explain equivalent fractions with cricket", mode="prose", case_id="ladder.2.their_world")
    out = checks.Scored()
    ladder.score_rung(
        case,
        _transcript(
            mode="prose",
            say="If a batter scores in 1/2 of an over, that is the same part as 2/4 of an over. "
            "Both numbers have been scaled. Is that clear?",
        ),
        out,
        rung="their_world",
    )
    assert out.scores["teaches"] is not None and out.scores["teaches"] < 4
    assert any(f.detail.startswith("their_world rung:") for f in out.findings)
    # The worst rung wins each dimension.
    ladder.score_rung(
        case,
        _transcript(mode="prose", say="Try this one: what is 1/2 as quarters?"),
        out,
        rung="draw",
    )
    assert out.scores["teaches"] < 4


def test_the_ladder_report_carries_every_rung_in_full() -> None:
    source = (Path(ladder.__file__).parent / "__main__.py").read_text(encoding="utf-8")
    assert "t.say[:160]" not in source


# --- 4. the board writes algebra as a hand writes it -----------------------------------------


@pytest.mark.parametrize(
    ("cas", "hand"),
    [
        ("x**2 - 5*x + 6 = 0", "x^2 - 5x + 6 = 0"),
        ("(x - (2))*(x - (3)) = 0", "(x - 2)(x - 3) = 0"),
        ("(x - (-2))*(x - (3)) = 0", "(x + 2)(x - 3) = 0"),
        ("x*(x - 3) - 2*(x - 3) = 0", "x(x - 3) - 2(x - 3) = 0"),
        ("2*x + 3 = 7", "2x + 3 = 7"),
        ("3 * 4 = 12", "3 × 4 = 12"),
    ],
)
def test_python_notation_never_reaches_the_board(cas: str, hand: str) -> None:
    from wobo_gateway.board.pipelines.math import pretty_algebra

    assert pretty_algebra(cas) == hand


def test_the_middle_term_is_actually_split_on_the_board() -> None:
    from wobo_gateway.board import planner, schema

    plan = planner.plan_board(
        {
            "say": "s",
            "intents": [
                {"pipeline": "math", "op": "derivation", "equation": "x**2 - 5*x + 6 = 0", "steps": []}
            ],
        }
    )
    written = [schema.visible_text(o) for o in plan.objects if o["kind"] == "write"]
    assert written == [
        "x^2 - 5x + 6 = 0",
        "x^2 - 2x - 3x + 6 = 0",
        "x(x - 3) - 2(x - 3) = 0",
        "(x - 2)(x - 3) = 0",
    ]
    assert all(c.passed for c in plan.ledger.checks)


# --- 2. the squares are drawn when the squares are the point ---------------------------------


def test_the_squares_on_the_sides_are_drawn_with_their_areas() -> None:
    from wobo_gateway.board import planner

    plan = planner.plan_board(
        {
            "say": "s",
            "intents": [
                {
                    "pipeline": "math",
                    "op": "construction",
                    "what": "right_triangle",
                    "legs": [3, 4],
                    "unit": "cm",
                    "squares": True,
                }
            ],
        }
    )
    polygons = [o for o in plan.objects if o["kind"] == "polygon"]
    assert len(polygons) == 4, "the triangle and three squares"
    areas = [o["value"] for o in plan.objects if o.get("check") == "board.numbers_agree:square areas"]
    assert sorted(areas) == [9.0, 16.0, 25.0]
    assert any(c.name == "board.numbers_agree:square areas" and c.passed for c in plan.ledger.checks)
    plain = planner.plan_board(
        {
            "say": "s",
            "intents": [
                {"pipeline": "math", "op": "construction", "what": "right_triangle", "legs": [3, 4]}
            ],
        }
    )
    assert len([o for o in plain.objects if o["kind"] == "polygon"]) == 1
    labels = [o.get("text") for o in plain.objects if o["kind"] == "label"]
    assert labels == ["the right angle sits between the two legs"]


def test_the_corrected_squares_recording_shows_what_it_says() -> None:
    case = case_bank.by_id("place.plane.pythagoras-squares")
    recorded = runner.load(case.id)
    assert recorded is not None
    scored = checks.score_transcript(case, recorded)
    assert not scored.wrong, scored.wrong
    assert scored.scores["correct"] == 4
    assert scored.scores["teaches"] == 4, [f.detail for f in scored.weak]
    assert scored.scores["in place"] == 4


# --- 17. "draw a ring round the button" marks the button ------------------------------------


def test_a_request_to_mark_a_thing_on_the_screen_marks_it_keylessly() -> None:
    from wobo_gateway.wobo import mock_board_plan

    payload = {
        "context": {
            "turn": {"lastUserInput": "draw a ring round the button that starts the course"},
            "targets": [
                {"id": "download-center", "kind": "queue", "label": "the courses being composed"},
                {"id": "course-advance", "kind": "control", "label": "the button that moves this lesson on"},
            ],
        }
    }
    plan = mock_board_plan(payload)
    assert plan is not None, "the turn fell to the ordinary path and claimed a drawing"
    assert plan["objects"][0]["anchor"] == {"target": "course-advance"}
    assert plan.get("presentation") == "screen"
    assert mock_board_plan({"context": {"turn": {"lastUserInput": "hello"}, "targets": payload["context"]["targets"]}}) is None


# --- A. a classifier outage is never the crisis script ---------------------------------------


class _Raises:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, *_: Any, **__: Any) -> Any:
        self.calls += 1
        raise RuntimeError("Unsupported value: 'temperature' does not support 0.2 with this model")


def _layered_with(model_call: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    from wobo_gateway import safety, safety_model

    monkeypatch.setenv("SAFETY_MODEL", "on")
    monkeypatch.setenv("SAFETY_MODEL_SCOPE", "all")
    safety_model.reset_breaker()
    model = safety_model.ModelClassifier()
    model._call = model_call  # type: ignore[method-assign]
    return safety.LayeredClassifier(model=model, model_enabled=lambda: True)


PLANT_CELL = {
    "say": "Let's build it. A plant cell has a cell wall because it needs a firm outer layer.",
    "actions": [],
    "objects": [{"id": "c1", "kind": "label", "anchor": {"board": [1, 1]}, "text": "cell wall"}],
    "ask": {"prompt": "Which part makes the cell green?", "targets": []},
}


def test_a_classifier_that_raises_on_the_plant_cell_yields_the_lesson(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import safety

    down = _Raises()
    screened = safety.screen_outbound(PLANT_CELL, _layered_with(down, monkeypatch))
    assert screened == PLANT_CELL, screened.get("say")
    assert "1098" not in screened["say"]


def test_a_classifier_that_raises_on_an_ambiguous_text_yields_the_plain_line_and_no_helpline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wobo_gateway import safety

    held = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": "what is the suicide rate in india, for civics"}}},
        _layered_with(_Raises(), monkeypatch),
    )
    assert held is not None, "an unchecked concern-adjacent message is still held"
    assert held["say"] == safety.UNCHECKED_SAY
    assert "Childline" not in held["say"] and "1098" not in held["say"] and "14416" not in held["say"]
    assert held["safety"]["category"] != "crisis"


def test_a_classifier_that_answers_crisis_still_yields_the_crisis_line(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import safety

    clf = _layered_with(lambda text: ("crisis", "high"), monkeypatch)
    held = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": "what is the suicide rate in india, for civics"}}}, clf
    )
    assert held is not None and held["say"] == safety.CRISIS_SAY


def test_a_disclosure_the_rules_settle_is_a_crisis_whatever_the_provider_does(monkeypatch: pytest.MonkeyPatch) -> None:
    from wobo_gateway import safety

    held = safety.screen_inbound(
        {"context": {"turn": {"lastUserInput": "my dad hits me"}}}, _layered_with(_Raises(), monkeypatch)
    )
    assert held is not None and held["say"] == safety.CRISIS_SAY


def test_the_moderation_call_sends_no_temperature(monkeypatch: pytest.MonkeyPatch) -> None:
    """A model in the tiny tier's chain answered 400 to temperature=0.0 at the moment the
    plant-cell lesson was screened. A strict-JSON classification does not need the knob."""
    from wobo_gateway import safety_model

    seen: dict[str, Any] = {}

    class _Message:
        content = '{"category": "ok", "severity": "low"}'

    class _Choice:
        message = _Message()

    class _Response:
        choices = [_Choice()]

    def fake_complete(**kwargs: Any) -> Any:
        seen.update(kwargs)
        return _Response()

    monkeypatch.setattr("wobo_gateway.model_call.complete", fake_complete)
    monkeypatch.setenv("SAFETY_MODEL", "on")
    safety_model.reset_breaker()
    model = safety_model.ModelClassifier()
    from wobo_gateway.safety_signals import screen

    model.adjudicate("what is the suicide rate in india, for civics", screen("what is the suicide rate in india, for civics"))
    assert seen, "the call was made"
    assert "temperature" not in seen


# --- 13. the safety lines read as a steady adult ---------------------------------------------


def test_the_safety_lines_are_in_sentence_case() -> None:
    from wobo_gateway import safety

    for name in ("CRISIS_SAY", "MODERATION_SAY", "OUTBOUND_REPLACEMENT_SAY", "OUTAGE_SAY", "UNCHECKED_SAY"):
        line = getattr(safety, name)
        for sentence in re.split(r"(?<=[.?!])\s+", line):
            assert sentence[0].isupper(), f"{name}: {sentence!r} opens in lowercase"
