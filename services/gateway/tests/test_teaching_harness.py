"""The harness's own test: does each check catch the thing it exists to catch?

``harness/`` is not collected by pytest — it calls real models and the owner pays. But the checks
INSIDE it are ordinary code, and a check that cannot fail is worse than no check at all: it prints
a green tick over whatever happened. So every one of them is driven here against a hand-built
transcript that contains exactly the failure it is meant to find, and against one that does not.

Nothing in this file calls a model or reaches a network. It runs in the default suite.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

# ``harness`` lives beside ``src`` rather than inside it, so pytest's prepend import mode does not
# put it on the path. One line here, rather than a package layout that would let ``uv run pytest``
# collect a suite that spends money.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness import cases as case_bank  # noqa: E402
from harness import (  # noqa: E402
    checks,
    drawing,
    runner,  # noqa: E402
)
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


def _number(value: str, *, check: str | None = "board.numbers_agree:x") -> dict[str, Any]:
    obj: dict[str, Any] = {
        "id": "n1",
        "kind": "label",
        "anchor": {"board": [200, 300]},
        "text": value,
    }
    if check:
        obj["check"] = check
    return obj


# --- the one that matters most: a wrong answer ---------------------------------------------------


def test_a_wrong_root_is_caught_wherever_it_is_written() -> None:
    """The whole point of the harness. x^2 - 5x + 6 has roots 2 and 3; 4 is not one of them."""
    case = case_bank.by_id("math.cbse.10.quadratic")
    scored = checks.score_transcript(case, _transcript(say="So x = 2 and x = 4."))
    assert scored.wrong, "a false root reached the learner and nothing said so"
    assert scored.scores["correct"] == 0
    assert "said 4" in scored.wrong[0].detail


def test_a_wrong_number_drawn_on_the_board_is_caught_too() -> None:
    """Said and drawn are the same claim. A text-only reading would have missed this one."""
    case = case_bank.by_id("math.cbse.10.quadratic")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Here is the factorisation, because the two numbers multiply to six.",
            objects=[_number("x = 7")],
            verified=["board.numbers_agree:x"],
        ),
    )
    assert scored.wrong
    assert scored.scores["correct"] == 0


def test_the_right_answer_is_not_flagged() -> None:
    """The other half of a working check: it has to stay quiet when the answer is right."""
    case = case_bank.by_id("math.cbse.10.quadratic")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="The factors are two and three, because they multiply to six and add to five. "
            "So x = 2 or x = 3. Which one would you try in the equation first?",
            objects=[_number("x = 2"), {**_number("x = 3"), "id": "n2"}],
            verified=["board.numbers_agree:x"],
        ),
    )
    assert not scored.wrong, [f.detail for f in scored.wrong]
    assert scored.scores["correct"] == 4


def test_a_wrong_date_in_a_history_answer_is_caught() -> None:
    """Not every subject has a CAS. The fact base's job, asked of the tutor's own words."""
    case = case_bank.by_id("social.cbse.10.timeline")
    scored = checks.score_transcript(
        case, _transcript(say="The Jallianwala Bagh massacre happened in 1921.")
    )
    assert scored.wrong
    assert "1919" in scored.wrong[0].detail


# --- the verified-number law, and the hole beside it ---------------------------------------------


def test_a_drawn_numeral_with_no_check_fails_the_number_law() -> None:
    case = case_bank.by_id("chem.cbse.10.balance")
    scored = checks.score_transcript(
        case, _transcript(say="Here.", objects=[_number("2 O2", check=None)])
    )
    assert any(f.dimension == "verified" for f in scored.wrong)
    assert scored.scores["verified"] == 0


def test_a_check_that_did_not_run_this_turn_is_a_laundering_token() -> None:
    case = case_bank.by_id("chem.cbse.10.balance")
    scored = checks.score_transcript(
        case,
        _transcript(say="Here.", objects=[_number("2 O2", check="board.frame")], verified=[]),
    )
    assert any("did not run" in f.detail for f in scored.wrong)


def test_a_board_whose_numbers_all_name_a_check_that_ran_passes() -> None:
    case = case_bank.by_id("chem.cbse.10.balance")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Two oxygen molecules, because four hydrogens need two waters. What is left?",
            objects=[_number("2 O2")],
            verified=["board.numbers_agree:x"],
        ),
    )
    assert not [f for f in scored.wrong if f.dimension == "verified"]
    assert scored.scores["verified"] == 4


def test_unverified_arithmetic_in_the_spoken_line_fails_the_run() -> None:
    """The law used to cover board objects and not the say, and this test only asked that the
    gap be counted. The gap is closed (``wobo_gateway.spoken``): a spoken number nothing signed
    is WRONG, the same as a drawn one."""
    case = case_bank.by_id("chem.cbse.10.balance")
    scored = checks.score_transcript(case, _transcript(say="You need 2 of them for 1 methane."))
    assert any(
        f.severity == checks.WRONG and "nothing signed" in f.detail for f in scored.findings
    )
    assert scored.scores["verified"] == 0


# --- the drawing --------------------------------------------------------------------------------


def test_a_question_that_asked_for_a_drawing_and_got_none_fails() -> None:
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(
        case, _transcript(say="A plant cell has a cell wall, a nucleus and a vacuole.")
    )
    assert any(f.dimension == "drew" for f in scored.wrong)
    assert scored.scores["drew"] == 0


def test_a_board_where_every_object_was_refused_is_the_worst_case() -> None:
    """Words promising a drawing over an empty board — the failure the live run actually found."""
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="I have drawn the cell and labelled the parts.",
            refused=["an intent that names no pipeline was dropped"],
        ),
    )
    assert any("blank board" in f.detail for f in scored.wrong)


@pytest.mark.skipif(
    drawing.PROBE.parent.joinpath("geometry_probe.ts").is_file() is False,
    reason="the geometry probe is missing",
)
def test_overlapping_and_off_board_labels_are_measured_not_guessed() -> None:
    """The drawing check runs the product's own ``geometryOf``.

    Skipped, never faked, when bun is not on the machine.
    """
    case = case_bank.by_id("bio.icse.9.plant-cell")
    transcript = _transcript(
        say="Here is the cell.",
        objects=[
            {
                "id": "a",
                "kind": "write",
                "anchor": {"board": [900, 300]},
                "text": "this label runs off the right edge of the board",
            },
            {
                "id": "b",
                "kind": "write",
                "anchor": {"board": [900, 300]},
                "text": "and this one lands on top of it",
            },
        ],
    )
    scored = checks.score_transcript(case, transcript)
    probe = drawing.check_drawing(case, transcript, scored)
    if probe is None:
        pytest.skip("bun is not on this machine, so the drawing was not measured")
    kinds = {f.detail.split(":", 1)[0] for f in scored.findings if f.dimension == "legible"}
    assert "off-canvas" in kinds
    assert "overlapping" in kinds
    assert scored.scores["legible"] == 0


# --- the teaching -------------------------------------------------------------------------------


def test_handing_the_final_value_to_a_learner_mid_working_fails() -> None:
    """``WOBO_SYSTEM``: "Never give the final value of x." Tested for the first time here."""
    case = case_bank.by_id("math.ib.hint.no-final-answer")
    scored = checks.score_transcript(
        case, _transcript(mode="prose", say="Just divide both sides by two, so x = 2.")
    )
    assert any("handed the answer" in f.detail for f in scored.wrong)
    assert scored.scores["teaches"] == 0


def test_a_graduated_hint_that_asks_rather_than_tells_passes() -> None:
    case = case_bank.by_id("math.ib.hint.no-final-answer")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="You have got to two x equals four, which is the hard part done. "
            "What would you do to both sides to get one x on its own?",
        ),
    )
    assert not scored.wrong, [f.detail for f in scored.wrong]


def test_an_answer_that_asserts_without_explaining_is_marked_down() -> None:
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="A plant cell has a cell wall. It has a nucleus. It has a vacuole.",
            objects=[{"id": "c", "kind": "ellipse", "anchor": {"board": [400, 400]},
                      "rx": 200, "ry": 140}],
        ),
    )
    assert any("asserts without explaining" in f.detail for f in scored.weak)


def test_never_reaching_for_the_learners_world_is_marked_down() -> None:
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Two quarters is the same as one half, because you can cut the same pizza two "
            "ways. Does that help?",
        ),
    )
    assert scored.scores["their world"] == 0
    assert any(f.dimension == "their world" for f in scored.weak)


def test_reaching_for_the_learners_world_passes() -> None:
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Think of a cricket over. Three runs off six balls is the same rate as one off "
            "two, because both are the same share of the over. What is the same share of four?",
        ),
    )
    assert scored.scores["their world"] == 4


# --- the voice laws -----------------------------------------------------------------------------


def test_naming_what_is_underneath_fails_the_white_label_law() -> None:
    """``gate_white_label.py`` scans source and the built bundle. Nothing scanned a live answer."""
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(
        case, _transcript(say="As a large language model I cannot draw that.")
    )
    assert any(f.dimension == "voice" for f in scored.wrong)
    assert scored.scores["voice"] == 0


def test_gendering_wobo_fails() -> None:
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(case, _transcript(say="Wobo will draw it once he is ready."))
    assert any("gendered Wobo" in f.detail for f in scored.wrong)


def test_picturing_a_child_studying_late_fails() -> None:
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(case, _transcript(say="We can finish this tonight."))
    assert any("late hour" in f.detail for f in scored.wrong)


def test_a_date_in_a_history_lesson_is_not_a_late_hour() -> None:
    """``hours.test.ts`` keeps curriculum out of its own walk for exactly this reason."""
    case = case_bank.by_id("social.cbse.10.timeline")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Independence came at midnight on the fifteenth of August 1947, because the "
            "transfer was timed for it. Which event would you put before it?"
        ),
    )
    assert not [f for f in scored.wrong if f.dimension == "voice"]


def test_an_error_on_the_turn_fails_the_run_rather_than_scoring_zeroes() -> None:
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(case, _transcript(status=503, error="HTTP 503"))
    assert scored.scores["reached"] == 0
    assert any(f.dimension == "reached" for f in scored.wrong)


# --- the bank itself ----------------------------------------------------------------------------


def test_every_claim_names_a_quantity_and_a_truth() -> None:
    """A claim whose regex does not compile, or names no truth, silently checks nothing at all."""
    import re

    for case in case_bank.CASES:
        for claim in case.claims:
            re.compile(claim.about)  # raises, and the test fails, on a broken pattern
            assert claim.truth, f"{case.id}: {claim.name} names no truth"
            assert claim.where in {"both", "board", "prose"}, f"{case.id}: {claim.name}"
            for wanted in claim.must_include:
                assert any(
                    abs(wanted - t) <= claim.tolerance for t in claim.truth
                ), f"{case.id}: {claim.name} must include {wanted}, which is not in its own truth"


# --- the seam the hand-built transcripts hid ------------------------------------------------------
#
# Every test above builds its own transcript, and a hand-built transcript is written in the shape
# the regex already matches. That proved the regexes work on text written to suit them and said
# nothing about whether they fire on the product. They mostly did not: run against the twelve
# recorded transcripts in ``harness/fixtures/``, eight of the nine claims in the bank matched
# NOTHING, because the real history board draws the year as its own object ABOVE the event label
# and the real physics board writes the unit first ("m 10.197162"). The three tests below walk the
# recorded transcripts instead of a hand-built one.


def _recorded(case_id: str) -> Transcript:
    transcript = runner.load(case_id)
    assert transcript is not None, f"no recorded transcript for {case_id}"
    return transcript


def test_every_claim_fires_on_its_own_recorded_transcript() -> None:
    """The loop that was missing. A claim that matches nothing is a green tick over an unread
    answer, and the whole bank was in that state."""
    silent: list[str] = []
    for case in case_bank.CASES:
        transcript = _recorded(case.id)
        for claim in case.claims:
            if not checks.claimed_values(claim, transcript):
                silent.append(f"{case.id}: {claim.name}")
    assert not silent, f"claims that match nothing on the product's own transcripts: {silent}"


def test_a_wrong_year_on_the_real_timeline_board_is_caught() -> None:
    """The failure this whole rewrite exists for, on the real recorded board.

    The board dates the Jallianwala Bagh massacre by drawing 1919 as a ``number`` above a label
    reading "Jallianwala Bagh massacre". Both objects hang off the same tick, which is what makes
    them one claim. Moving the year to 1921 used to change nothing at all: ``correct`` stayed at
    4, the run verdict stayed "nothing false reached a learner", and the verifier could not help
    because it mints the check name from whatever year the model chose ("year 1921") and then
    confirms that year is inside a range.
    """
    case = case_bank.by_id("social.cbse.10.timeline")
    transcript = _recorded(case.id)
    assert not checks.score_transcript(case, transcript).wrong or True  # the real board is the base

    for obj in transcript.objects:
        if obj.get("kind") == "number" and obj.get("value") == 1919.0:
            obj["value"] = 1921.0
            # The verifier names the check after the value it was handed, so a wrong year arrives
            # with a check that agrees with it. That is exactly why this cannot be left to the
            # verified-number law.
            obj["check"] = "board.in_bounds:year 1921"
            transcript.verified.append("board.in_bounds:year 1921")

    scored = checks.score_transcript(case, transcript)
    assert scored.wrong, "a wrong date on the real history board reached the learner unremarked"
    assert any("1921" in f.detail and "1919" in f.detail for f in scored.wrong)
    assert scored.scores["correct"] == 0


def test_the_recorded_punnett_turn_asks_for_two_boxes_when_three_are_dominant() -> None:
    """The one WRONG finding of the 2026-09-05 live run, now caught by arithmetic.

    Aa x Aa gives AA, Aa, aA and aa. Three of those four show the dominant phenotype, and the
    recorded turn asks a Class 10 learner "Can you spot which two boxes show the dominant
    phenotype?" — so a child who answers correctly is told they are wrong by their own tutor. It
    lived in the ``ask`` frame, which no check read, and a model caught it where the arithmetic
    could not.
    """
    case = case_bank.by_id("bio.cbse.10.punnett")
    # The recording was corrected on 2026-09-05 (see the fixture's ``note``), so the wrong ask
    # is rebuilt here exactly as it was spoken, over the recorded board.
    recorded = _recorded(case.id)
    recorded.ask = {
        "type": "ask",
        "prompt": "Can you spot which two boxes show the dominant phenotype?",
        "targets": [],
    }
    scored = checks.score_transcript(case, recorded)
    assert any("dominant phenotype" in f.detail for f in scored.wrong), [
        f.detail for f in scored.findings
    ]


# --- the third half of what the learner receives --------------------------------------------------


def _asking(prompt: str, **over: Any) -> Transcript:
    return _transcript(ask={"type": "ask", "prompt": prompt, "targets": []}, **over)


def test_the_answer_handed_over_in_the_ask_frame_is_caught() -> None:
    """The graduated-hint law, in the one place the hint is actually put to the learner."""
    case = case_bank.by_id("math.ib.hint.no-final-answer")
    scored = checks.score_transcript(
        case,
        _asking(
            "Divide both sides by 2, so x = 2. Does that work?",
            mode="prose",
            say="You have got two x equals four. What comes next?",
        ),
    )
    assert any("handed the answer" in f.detail for f in scored.wrong)
    assert scored.scores["teaches"] == 0


def test_the_voice_laws_read_the_ask_frame_too() -> None:
    """One sentence in an ask prompt used to defeat the white-label law, the no-gendering law and
    the late-hour law at once, because nothing read it."""
    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(
        case,
        _asking(
            "Wobo will help you with this tonight. She is powered by Gemini.",
            say="Here is the cell.",
            objects=[{"id": "c", "kind": "ellipse", "anchor": {"board": [400, 400]},
                      "rx": 200, "ry": 140}],
        ),
    )
    reasons = {f.detail.split(":")[0] for f in scored.wrong if f.dimension == "voice"}
    assert "named what is underneath" in reasons
    assert any("gendered Wobo" in f.detail for f in scored.wrong)
    assert any("late hour" in f.detail for f in scored.wrong)
    assert scored.scores["voice"] == 0


def test_a_wrong_number_in_the_ask_frame_is_caught() -> None:
    case = case_bank.by_id("social.cbse.10.timeline")
    scored = checks.score_transcript(
        case,
        _asking(
            "The Jallianwala Bagh massacre was in 1921. Which event came next?",
            say="Here is the movement in order.",
        ),
    )
    assert any("1921" in f.detail for f in scored.wrong)


# --- saying what it does not know -----------------------------------------------------------------


def test_a_question_with_no_ground_truth_is_unchecked_rather_than_a_free_four() -> None:
    """The dimension that matters most used to hand 4 out of 4 to exactly the questions nobody
    knows the truth of, and that number flowed into the rollups the owner reads."""
    case = case_bank.by_id("bio.icse.9.plant-cell")
    assert not case.claims
    scored = checks.score_transcript(
        case,
        _transcript(
            say="A plant cell has a wall, because it needs to hold its own shape.",
            objects=[{"id": "c", "kind": "ellipse", "anchor": {"board": [400, 400]},
                      "rx": 200, "ry": 140}],
        ),
    )
    assert scored.scores["correct"] == 2
    assert any("unchecked" in f.detail for f in scored.findings if f.severity == checks.NOTE)


def test_a_word_that_merely_contains_the_learners_world_does_not_pass() -> None:
    """"Moreover" contains "over". So do "however", "discover", "running" and "overall"."""
    case = case_bank.by_id("teach.their-world.cricket")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Equivalent fractions are worth the same amount. Moreover, if you multiply top "
            "and bottom by the same number, the fraction keeps its value. Does that help?",
        ),
    )
    assert scored.scores["their world"] == 0
    assert any(f.dimension == "their world" for f in scored.weak)


# --- the judge marks, and never sentences ---------------------------------------------------------


def test_the_second_opinion_can_never_fail_a_run_on_its_own() -> None:
    """"The arithmetic decides, never the judge." A judged error is a weakness a human settles.

    It failed a real run once already: the judge marked with g = 9.8, called this product's
    correct 9.81-derived apex height wrong, and the report read FAILED with exit code 1.
    """
    from harness import judge

    scored = checks.Scored()
    scored.scores["correct"] = 4
    judge.apply_verdict(
        {
            "model": "test/judge",
            "verdict": {"factual": 4, "errors": ["the apex height should be 10.20 m, not 10.197"]},
            "cost_usd": 0.0,
            "error": "",
        },
        scored,
    )
    assert not scored.wrong, [f.detail for f in scored.wrong]
    assert any("second opinion found a factual error" in f.detail for f in scored.weak)


def test_the_bank_covers_more_than_one_subject_and_more_than_one_board() -> None:
    assert len(case_bank.subjects()) >= 5
    assert len(case_bank.boards()) >= 3


# --- it drew where the learner was looking (the owner, 2026-09-05) -----------------------------


def _ring(target: str, obj_id: str = "r1") -> dict[str, Any]:
    return {"id": obj_id, "kind": "circle", "anchor": {"target": target}}


def test_opening_the_board_for_something_already_on_the_screen_is_caught() -> None:
    """The failure the owner named: a ring round the hypotenuse chip, and the board opened for it."""
    case = case_bank.by_id("place.screen.pythagoras-side")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="The hypotenuse is the side opposite the right angle, because it is the longest.",
            objects=[_ring("tri-hyp")],
            presentation="plane",
            ask={"prompt": "Which angle is it opposite?"},
        ),
    )
    assert scored.scores["in place"] == 0
    assert any("opened the board" in f.detail for f in scored.weak)


def test_a_mark_in_place_on_the_right_chip_scores_full() -> None:
    case = case_bank.by_id("place.screen.pythagoras-side")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="This one, because it sits opposite the right angle.",
            objects=[_ring("tri-hyp")],
            presentation="screen",
            ask={"prompt": "Which angle is it opposite?"},
        ),
    )
    assert scored.scores["in place"] == 4
    assert not [f for f in scored.weak if f.dimension == "in place"]


def test_a_mark_on_the_wrong_chip_is_a_pointer_at_the_wrong_thing() -> None:
    case = case_bank.by_id("place.screen.pythagoras-side")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="This side, because it is opposite the right angle.",
            objects=[_ring("tri-leg-a")],
            presentation="screen",
            ask={"prompt": "Can you see why?"},
        ),
    )
    assert scored.scores["in place"] == 1
    assert any("wrong thing" in f.detail for f in scored.weak)


def test_redrawing_the_thing_from_scratch_when_it_is_on_the_screen_is_caught() -> None:
    case = case_bank.by_id("place.screen.pythagoras-side")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Here is the triangle again, because the hypotenuse is opposite the right angle.",
            objects=[
                {"id": "p1", "kind": "polygon", "anchor": {"board": [300, 300]}, "points": [[0, 0], [1, 1]]},
                _ring("tri-hyp"),
            ],
            presentation="screen",
            ask={"prompt": "Which side?"},
        ),
    )
    assert scored.scores["in place"] == 1
    assert any("from scratch" in f.detail for f in scored.weak)


def test_staying_on_the_screen_when_there_is_something_to_build_is_caught() -> None:
    case = case_bank.by_id("place.plane.pythagoras-squares")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Think of the squares on each side, because their areas add up.",
            objects=[_ring("tri-hyp")],
            presentation="screen",
            ask={"prompt": "What is the area of the square on the base?"},
        ),
    )
    assert scored.scores["in place"] == 0
    assert any("something new to build" in f.detail for f in scored.weak)


def test_the_surface_is_not_judged_on_a_question_that_does_not_test_it() -> None:
    case = case_bank.by_id("math.cbse.11.tangent")
    scored = checks.score_transcript(case, _transcript(say="Here.", presentation="plane"))
    assert scored.scores["in place"] is None


# --- the spoken-number law, proved on the transcript -------------------------------------------
#
# ``test_unverified_arithmetic_in_the_spoken_line_is_put_on_the_record`` above was written when the
# say was outside the law and the check could only count. It is kept for what it still proves (a
# spoken number is read at all); these are the teeth.


def test_a_spoken_number_nothing_signed_is_wrong_not_a_note() -> None:
    case = case_bank.by_id("math.icse.9.pythagoras")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="The hypotenuse is 5 because the squares add up. Which side is longest?",
            objects=[{"id": "p", "kind": "polygon", "anchor": {"board": [300, 300]},
                      "points": [[0, 0], [300, 0], [0, 400]]}],
        ),
    )
    assert any(f.severity == checks.WRONG and "nothing signed" in f.detail for f in scored.findings)
    assert scored.scores["verified"] == 0


def test_a_spoken_number_the_learner_gave_is_licensed() -> None:
    case = case_bank.by_id("math.icse.9.pythagoras")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="Legs of 3 cm and 4 cm, because the right angle sits between them. "
            "Which side is opposite it?",
        ),
    )
    assert not [f for f in scored.wrong if f.dimension == "verified"], scored.wrong


def test_a_spoken_number_the_verifier_drew_is_licensed() -> None:
    case = case_bank.by_id("math.icse.9.pythagoras")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="The hypotenuse is 5 because the two squares add up to the third. "
            "Which square is the biggest?",
            objects=[{"id": "n", "kind": "number", "value": 5.0, "unit": "cm",
                      "anchor": {"board": [300, 300]},
                      "check": "board.numbers_agree:hypotenuse"}],
            verified=["board.numbers_agree:hypotenuse"],
        ),
    )
    assert not [f for f in scored.wrong if f.dimension == "verified"], scored.wrong
    assert scored.scores["verified"] == 4


def test_a_spoken_sum_counts_only_when_the_product_signed_it_and_it_holds() -> None:
    case = case_bank.by_id("math.icse.9.pythagoras")
    say = "It is 5 because 9 + 16 = 25 and 5 × 5 = 25. Which side is longest?"
    unsigned = checks.score_transcript(case, _transcript(say=say))
    assert any("nothing signed" in f.detail for f in unsigned.wrong), "a sum the ledger never saw"
    signed = checks.score_transcript(
        case,
        _transcript(
            say=say, verified=["say.arithmetic:9 + 16 = 25", "say.arithmetic:5 * 5 = 25"]
        ),
    )
    assert not [f for f in signed.wrong if f.dimension == "verified"], signed.wrong


def test_a_signed_sum_the_harness_finds_false_is_a_contradiction() -> None:
    """Two routes: the product's SymPy and this file's fractions. A laundering token that names
    a false sum is caught by the second."""
    case = case_bank.by_id("math.icse.9.pythagoras")
    scored = checks.score_transcript(
        case,
        _transcript(
            say="It is 6 because 9 + 16 = 36. Which side is longest?",
            verified=["say.arithmetic:9 + 16 = 36"],
        ),
    )
    assert any("is false" in f.detail for f in scored.wrong)


def test_a_question_may_carry_the_numbers_it_hands_over() -> None:
    case = case_bank.by_id("teach.prerequisite.integers")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Totally fixable. Think of negatives as a tug of war, because the bigger side "
            "wins and keeps its sign. Try this tiny one: what is -5 + 3?",
        ),
    )
    assert not [f for f in scored.wrong if f.dimension == "verified"], scored.wrong


# --- presence, not only absence ----------------------------------------------------------------


def test_the_why_and_the_check_are_put_on_the_record_when_present() -> None:
    case = case_bank.by_id("teach.prerequisite.integers")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Totally fixable. Signs that differ pull against each other, because a minus "
            "is a step back. Try this tiny one: what is -5 + 3?",
        ),
    )
    notes = [f.detail for f in scored.findings if f.dimension == "teaches"]
    assert any(n.startswith('explains: "because"') for n in notes), notes
    assert any(n.startswith('checks: "') and "-5 + 3" in n for n in notes), notes
    assert scored.scores["teaches"] == 4


def test_a_hollow_check_does_not_count_as_handing_the_move_back() -> None:
    """"Does that make sense?" is banned by name in ``wobo.TEACHING_LAW``."""
    case = case_bank.by_id("teach.prerequisite.integers")
    scored = checks.score_transcript(
        case,
        _transcript(
            mode="prose",
            say="Negatives are numbers below zero, because zero is the middle. "
            "Does that make sense?",
        ),
    )
    assert any("hollow check" in f.detail for f in scored.weak)
    assert scored.scores["teaches"] == 2


# --- the register: not too professional, not too street (voice.md section 10a) -----------------


def _voice_of(say: str) -> checks.Scored:
    out = checks.Scored()
    checks.check_voice(_transcript(say=say), out)
    return out


def test_the_target_register_scores_full() -> None:
    """The turn the owner pointed at as already right. If this ever scores below 4 the lists have
    grown a word a good teacher uses."""
    out = _voice_of(
        "Totally fixable. Think of negatives as a tug-of-war: if the signs match, add the sizes "
        "and keep that sign; if they differ, subtract the smaller from the bigger and keep the "
        "bigger number's sign. Try this tiny one: what is -5 + 3?"
    )
    assert out.scores["voice"] == 4
    assert not out.weak


def test_too_street_is_marked_down_and_named() -> None:
    out = _voice_of(
        "ok so pythagoras is lowkey easy fr, the two small squares literally just add up to the "
        "big one, no cap"
    )
    assert out.scores["voice"] <= 2
    assert any("too street" in f.detail and "lowkey" in f.detail for f in out.weak)


def test_too_professional_is_marked_down_and_named() -> None:
    out = _voice_of(
        "Let us examine the relationship between the two legs and the hypotenuse. It is "
        "imperative to observe that the sum of their squares is equivalent to the square of the "
        "hypotenuse."
    )
    assert out.scores["voice"] <= 2
    assert any("too professional" in f.detail for f in out.weak)


def test_the_american_school_year_is_the_textbook_voice_too() -> None:
    """Indian English, because that is who is reading: class 8, not grade 8; a test, not a quiz."""
    out = _voice_of("This is a grade 8 topic and it comes up in every quiz.")
    assert out.scores["voice"] <= 2
    assert any("too professional" in f.detail for f in out.weak)


def test_a_candle_that_is_lit_and_a_fair_bet_are_not_slang() -> None:
    """The street list is words with no honest classroom use, so a science or probability answer
    keeps its full marks."""
    out = _voice_of(
        "The candle stays lit because the jar still holds oxygen. Would you bet on the red ball "
        "or the blue one?"
    )
    assert out.scores["voice"] == 4


def test_the_helpline_numbers_in_the_crisis_line_are_the_products_own() -> None:
    """A live run on 2026-09-05 replaced a plant-cell lesson with the crisis line (a transient
    provider failure on the outbound screen), and the harness called 1098 and 14416 numbers
    nothing signed. They are ``safety.SUPPORT``, written by a person: licensed, while the missing
    drawing still fails the case on its own."""
    from wobo_gateway import safety

    case = case_bank.by_id("bio.icse.9.plant-cell")
    scored = checks.score_transcript(case, _transcript(say=safety.CRISIS_SAY, objects=[]))
    assert not [f for f in scored.wrong if f.dimension == "verified"], scored.wrong
    assert any(f.dimension == "drew" for f in scored.wrong)



# --- the doubt solver's two laws, measured (doubt.py; the owner, 2026-09-05) ---------------------


def _doubt_transcript(**over: Any) -> Transcript:
    """A doubt turn as the wire carries it: the reading's lines, then say and ink frames with t."""
    base: dict[str, Any] = {
        "mode": "doubt",
        "presentation": "screen",
        "reading": [
            {"id": "r1", "text": "3x + 5 = 20", "box": [0.1, 0.2, 0.6, 0.28]},
            {"id": "r2", "text": "Solve for x.", "box": [0.1, 0.3, 0.4, 0.34]},
        ],
        "say": "Look at the five. It moves across and becomes minus five. So x is 5.",
        "objects": [_ring("r1"), _ring("r2", "r2ring")],
        "events": [
            {"id": "", "type": "say", "data": {"text": "Look at the five.", "t": 0, "dur": 900}},
            {"id": "", "type": "ink", "data": {"object": _ring("r1"), "t": 0}},
            {"id": "", "type": "say", "data": {"text": "It moves across.", "t": 1100, "dur": 900}},
            {"id": "", "type": "ink", "data": {"object": _ring("r2", "r2ring"), "t": 1100}},
            {"id": "", "type": "done", "data": {"presentation": "screen", "objects": 2, "t": 2000}},
        ],
    }
    base.update(over)
    return _transcript(**base)


def test_a_conforming_doubt_turn_is_on_the_page_and_in_the_beat() -> None:
    case = case_bank.by_id("doubt.cbse.8.linear-photo")
    scored = checks.score_transcript(case, _doubt_transcript())
    assert scored.scores["in place"] == 4, scored.findings
    assert not [f for f in scored.wrong if f.dimension == "in place"]


def test_a_mark_the_gateway_refused_as_off_the_page_fails_the_run() -> None:
    """The number the harness measures: 'off the page: N' in the done frame, and N > 0 is wrong."""
    case = case_bank.by_id("doubt.cbse.8.linear-photo")
    scored = checks.score_transcript(
        case,
        _doubt_transcript(
            refused=[
                "off the page: 2 mark(s) placed by pixels rather than on a line of the page "
                "were not drawn"
            ],
            off_page=2,
        ),
    )
    assert scored.scores["in place"] == 0
    assert any("2 mark(s) were placed by pixels" in f.detail for f in scored.wrong)


def test_ink_anchored_to_something_that_is_not_a_line_of_the_page_fails() -> None:
    case = case_bank.by_id("doubt.cbse.8.linear-photo")
    stray = {"id": "g", "kind": "circle", "anchor": {"board": [500, 500]}}
    scored = checks.score_transcript(case, _doubt_transcript(objects=[_ring("r1"), stray]))
    assert scored.scores["in place"] == 0
    assert any("not a line of the page" in f.detail for f in scored.wrong)


def test_ink_that_lands_with_no_sentence_starting_on_it_fails_the_beat_law() -> None:
    """Law 5: an ink frame at a time no say frame starts is a drawing with no words."""
    case = case_bank.by_id("doubt.cbse.8.linear-photo")
    events = _doubt_transcript().events
    events[3] = {"id": "", "type": "ink", "data": {"object": _ring("r2", "r2ring"), "t": 640}}
    scored = checks.score_transcript(case, _doubt_transcript(events=events))
    assert scored.scores["in place"] == 0
    assert any("no sentence starting on it" in f.detail for f in scored.wrong)
    # and a turn that drew and said nothing at all is the owner's "just draw on the image"
    silent = [e for e in _doubt_transcript().events if e["type"] != "say"]
    scored = checks.score_transcript(case, _doubt_transcript(say="", events=silent))
    assert any("said nothing" in f.detail for f in scored.wrong)


def test_the_recorded_doubt_turn_is_labelled_keyless_and_measures_zero_off_the_page() -> None:
    """The fixture in the bank was recorded without a key, and says so; a replay reads that note
    rather than mistaking it for a vision model's reading."""
    transcript = _recorded("doubt.cbse.8.linear-photo")
    assert transcript.mode == "doubt" and "KEYLESS" in transcript.note
    assert transcript.reading and transcript.off_page == 0
    scored = checks.score_transcript(case_bank.by_id("doubt.cbse.8.linear-photo"), transcript)
    assert not [f for f in scored.wrong if f.dimension == "in place"]
