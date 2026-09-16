"""The copy screen over generated words: every rule fires on the banned line and stays silent on
the legitimate one beside it (docs/copy/voice.md, docs/CLAIMS.md)."""

from __future__ import annotations

import pytest
from wobo_gateway.growth import screen

#: A name from the screen's own list, never typed here: a typed one is a name somebody pastes.
SOMEONE = screen.INVENTED_NAMES[0]
#: A gendered pronoun, kept off any line that names the tutor so the brand gate stays meaningful.
PRONOUN = "she"


@pytest.mark.parametrize(
    ("rule", "banned", "fine"),
    [
        ("invented-person", f"{SOMEONE} found it hard.", "A learner found it hard."),
        ("grade-gate", "Built for class 6 to 10.", "Class 10 mathematics has a probability unit."),
        ("grade-gate", "For learners from class 4.", "The chapter sits in class 5 mathematics."),
        (
            "raw-allowance",
            "You get 20 questions a day.",
            "Ask as many questions as the day allows.",
        ),
        ("vendor", "Written with ChatGPT.", "Written with AI help."),
        ("narrates", "Let me show you the diagram.", "The diagram shows one shaded face."),
        ("wobo-pronoun", f"Wobo draws it, and {PRONOUN} says why.", "Wobo draws it and says why."),
        ("late-hour", "Stuck at 11 pm before the test?", "Stuck before the test?"),
        ("runs-down", "Better than a tutor.", "A tutor that draws."),
        ("em-dash", "The answer — one sixth.", "The answer is one sixth."),
        ("exclamation", "It works!", "It works."),
        ("emoji", "Probability \U0001f3b2", "Probability"),
        ("uncleared-claim", "The best AI tutor in the country.", "An AI tutor that draws."),
        ("promises-a-result", "This will improve your marks.", "This explains the idea."),
    ],
)
def test_each_rule_fires_and_its_neighbour_does_not(rule: str, banned: str, fine: str) -> None:
    assert rule in {v.rule for v in screen.screen(banned)}, banned
    assert rule not in {v.rule for v in screen.screen(fine)}, fine


def test_the_cleared_claim_passes_verbatim_and_its_drift_does_not() -> None:
    assert screen.is_clean("The world's first AI companion that shows you.")
    assert not screen.is_clean("The world's only AI companion that shows you.")


def test_every_violation_is_reported_not_just_the_first() -> None:
    found = screen.screen(f"{SOMEONE} says it works! The best app — guaranteed marks.")
    assert {"invented-person", "exclamation", "em-dash", "uncleared-claim"} <= {
        v.rule for v in found
    }
    assert all(v.says for v in found)
