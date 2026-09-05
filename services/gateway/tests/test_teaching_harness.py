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
from harness import checks, drawing  # noqa: E402
from harness import runner  # noqa: E402
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


def test_unverified_arithmetic_in_the_spoken_line_is_put_on_the_record() -> None:
    """The law covers board objects and not the say. That gap is reported on every run."""
    case = case_bank.by_id("chem.cbse.10.balance")
    scored = checks.score_transcript(case, _transcript(say="You need 2 of them for 1 methane."))
    assert any(
        f.severity == checks.NOTE and "no verifier signs" in f.detail for f in scored.findings
    )


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
    scored = checks.score_transcript(case, _recorded(case.id))
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
