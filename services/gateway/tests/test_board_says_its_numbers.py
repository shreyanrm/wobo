"""TWO LIVE BOARDS WHOSE OWN TEACHING SENTENCE WAS EATEN (the adversary, wave 47, finding 6).

The spoken-number law (``wobo_gateway.spoken``) is right and stays: a number Wobo says is one a
verifier produced, or it is not said. What bit live is the other half of the same law — *nothing is
spoken that was not drawn* — read backwards. Two boards TAUGHT about numbers they never put on the
glass, so the law took the sentences and left the turn with almost nothing:

* ``show me a number line`` drew a rule with unlabelled ticks. "Numbers grow larger towards 5
  because moving right means moving to greater values, while moving left towards -5 means smaller
  values" was refused for its 5 and its -5, and the whole teaching line came out as "The number
  line. Numbers have an order."
* ``solve 2x + 3 = 7 step by step`` drew "2x + 3 = 7" and "x = 2" and skipped the line between
  them. "Undo the +3 first ... so 2x = 4" was refused for its 4, so what survived was the answer
  first, then re-derived, then repeated.

Both are closed by DRAWING the thing being taught: a number line carries its numbers, and a
derivation asked for step by step shows the step. Then the sentence is licensed because it is true
of what is on the glass, which is the only reason a sentence is ever licensed here.
"""

from __future__ import annotations

from wobo_gateway import spoken
from wobo_gateway.board import schema
from wobo_gateway.board.pipelines import run_intent
from wobo_gateway.wobo import board_intents


def board_for(prompt: str):
    intents = board_intents(prompt)
    assert intents, prompt
    return run_intent(intents[0])


def licensed(draft) -> set[float]:
    ran = {c.name for c in draft.ledger.checks if c.passed}
    return spoken.verified_numbers(draft.objects, ran)


def said(draft, sentence: str) -> str:
    return spoken.audit(sentence, given=set(), verified=licensed(draft)).say


# --- the number line carries its numbers ----------------------------------------------------------


def test_the_number_line_writes_the_numbers_it_is_about() -> None:
    draft = board_for("show me a number line")
    written = {
        float(o["value"]) for o in draft.objects if o["kind"] == "number" and "value" in o
    }
    assert {-5.0, 0.0, 5.0} <= written, sorted(written)


def test_the_line_it_teaches_about_survives_the_law() -> None:
    draft = board_for("show me a number line")
    sentence = (
        "Numbers grow larger towards 5 because moving right means moving to greater values, "
        "while moving left towards -5 means smaller values."
    )
    assert said(draft, sentence) == sentence


def test_every_number_on_it_still_names_a_check_that_ran() -> None:
    draft = board_for("show me a number line")
    ran = {c.name for c in draft.ledger.checks}
    for obj in draft.objects:
        assert not schema.validate_object(obj), (obj["id"], schema.validate_object(obj))
        if obj.get("check"):
            assert obj["check"] in ran, obj


def test_a_number_that_is_not_on_the_line_is_still_refused() -> None:
    draft = board_for("show me a number line")
    assert said(draft, "The next one along is 11.") == ""


# --- the derivation shows the step ----------------------------------------------------------------


def test_step_by_step_writes_the_line_between_the_ask_and_the_answer() -> None:
    draft = board_for("solve 2*x + 3 = 7 step by step")
    lines = [str(o.get("text") or "") for o in draft.objects if o["kind"] == "write"]
    assert lines[0].replace(" ", "") == "2x+3=7"
    assert any(line.replace(" ", "") == "2x=4" for line in lines), lines
    assert lines[-1].replace(" ", "") == "x=2", lines


def test_the_sentence_about_that_step_survives_the_law() -> None:
    draft = board_for("solve 2*x + 3 = 7 step by step")
    sentence = (
        "Undo the +3 first, because subtraction leaves the x-term unchanged: "
        "2x + 3 - 3 = 7 - 3, so 2x = 4."
    )
    assert said(draft, sentence) == sentence


def test_the_chain_is_still_proved_end_to_end() -> None:
    draft = board_for("solve 2*x + 3 = 7 step by step")
    checks = {c.name: c for c in draft.ledger.checks}
    assert checks["cas.step_chain"].passed
