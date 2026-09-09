"""The keyless twin does the arithmetic (the adversary, 2026-09-09, finding 12).

"What is 2 to the power 5?" was answered, at both widths and in both themes, with "Which step
feels shaky? Start there." — a sentence from a different question, and the arithmetic never done.
"""

from __future__ import annotations

import pytest
from wobo_gateway import arith
from wobo_gateway.wobo import mock_wobo_turn


@pytest.mark.parametrize(
    ("question", "said"),
    [
        ("what is 2 to the power 5?", "2 to the power 5 is 32."),
        ("What's 12 times 7", "12 times 7 is 84."),
        ("how much is 20% of 50", "20 percent of 50 is 10."),
        ("what is the square root of 144", "The square root of 144 is 12."),
        ("what is 7 squared?", "7 squared is 49."),
        ("calculate 45 plus 67", "45 plus 67 is 112."),
        ("what is 1 divided by 3", "1 divided by 3 is 1/3."),
    ],
)
def test_a_sum_is_answered_with_the_sum(question: str, said: str) -> None:
    line = arith.answer_in_words(question)
    assert line is not None and line.startswith(said)


@pytest.mark.parametrize(
    "question",
    [
        "why does that step work?",
        "which step is wrong here?",
        "what is x plus 5",
        "what is 5 divided by 0",
        "what is 2 to the power 0.5",
        "circle the hypotenuse",
        "",
    ],
)
def test_anything_it_is_not_sure_of_is_left_alone(question: str) -> None:
    """A wrong number said with confidence is worse than no number at all."""
    assert arith.answer_in_words(question) is None


def test_the_working_rides_with_a_power_because_the_number_is_never_the_point() -> None:
    line = arith.answer_in_words("what is 2 to the power 5?")
    assert line == "2 to the power 5 is 32. That is 2 multiplied by itself 5 times."


def test_through_the_keyless_turn_it_is_the_answer_and_not_the_wrong_step_line() -> None:
    out = mock_wobo_turn({"context": {"turn": {"lastUserInput": "what is 2 to the power 5?"}}})
    assert out["path"] == "inline"
    assert out["say"].startswith("2 to the power 5 is 32.")
    assert "Which step feels shaky" not in out["say"]


def test_a_second_instruction_is_not_part_of_the_concept() -> None:
    """The adversary, 2026-09-09, finding 1's tail. "Draw a labelled map of India and mark
    Maharashtra" split at "of" and took the whole tail, so the drawing was captioned "india and
    mark maharashtra" and Wobo SAID it: a fragment of the learner's own question spoken back as
    though it were a topic."""
    from wobo_gateway.wobo import _concept_from

    assert _concept_from("draw a labelled map of india and mark maharashtra", "x") == "india"
    assert _concept_from("tell me about photosynthesis and then explain it", "x") == (
        "photosynthesis"
    )
    # and a concept that simply has "and" in it is left whole
    assert _concept_from("show me a diagram of acids and bases", "x") == "acids and bases"
    assert _concept_from("draw a triangle", "x") == "triangle"
