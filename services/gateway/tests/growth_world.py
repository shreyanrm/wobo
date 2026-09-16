"""A small world for the growth desk's tests: one piece that clears the gate, and recordings.

No test in the growth suite reaches a network. Every channel, Search Console and the content
stores are answered from ``tests/fixtures/growth/``, which hold answers in the shape each service
documents, and :class:`Recorder` keeps every request a poster made so a test can read it back.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wobo_gateway.growth.piece import Figure, Film, Piece, Provenance, Section

FIXTURES = Path(__file__).parent / "fixtures" / "growth"
DAY = "2026-09-16"


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


IDEA = (
    "Probability is a number between zero and one that says how likely an event is. You find it "
    "by counting the outcomes that make the event happen and dividing by all the outcomes that "
    "could happen, provided every outcome is equally likely. A fair coin has two faces, so the "
    "chance of heads is one out of two. A fair die has six faces, so the chance of rolling a four "
    "is one out of six. Zero means the event cannot happen, and one means it is certain.\n\n"
    "The counting only works when the outcomes really are equally likely. That condition is the "
    "whole reason the answer can be trusted, and it is the first thing to check whenever a "
    "question gives you a bag, a spinner or a pack of cards.\n\n"
    "It also helps to say the answer three ways. One out of six, as a fraction, is the same as "
    "roughly 0.17 as a decimal and roughly seventeen in a hundred. Each form is useful in a "
    "different place: the fraction shows the counting, the decimal lets you compare two events "
    "quickly, and the hundred makes it easy to picture how often the event turns up over many "
    "tries."
)
FIRST = (
    "Many learners believe that after five heads in a row, tails is now more likely. It feels "
    "fair that the coin should balance itself out. The coin has no memory, though. Each toss is a "
    "fresh event with the same two faces, so the chance of tails on the sixth toss is still one "
    "out of two.\n\n"
    "A quick way to see it is to imagine starting to watch at the sixth toss. You would have no "
    "idea what came before, and the coin would land exactly as it always does. Long runs of heads "
    "are rare to predict in advance, but once they have happened they change nothing about the "
    "next toss.\n\n"
    "What a long run does tell you is something about the coin itself. If a coin lands heads in "
    "almost every one of a thousand tosses, the sensible conclusion is that the coin is not fair, "
    "and then the counting above no longer applies to it at all."
)
SECOND = (
    "Another common belief is that if there are two possible results, each must have a chance of "
    "one half. Rolling a six on a die has two results, six or not six, yet the chance is one out "
    "of six and not one out of two. The two results are not equally likely, because not six "
    "covers five faces while six covers only one.\n\n"
    "So before dividing, list the outcomes that are truly equally likely, which for a die are the "
    "six faces, and only then count the ones you want. Grouping outcomes into two labels does not "
    "make the labels equally likely, and that is where the mistake hides."
)
CHECK = (
    "Here is one question that shows whether the idea is held rather than remembered. A bag holds "
    "three red counters and five blue ones, all the same size. What is the chance of drawing a "
    "red counter without looking? There are eight counters in all and three of them are red, so "
    "the chance is three out of eight.\n\n"
    "If you reached for one out of two because the counter is either red or blue, go back to the "
    "second belief above. If you wrote three out of eight and can say why each counter is equally "
    "likely to be drawn, the idea is yours. Try changing the numbers of counters and predicting "
    "the answer before you count, then check it."
)


def good_piece(slug: str = "probability", **changes: Any) -> Piece:
    base: dict[str, Any] = {
        "slug": slug,
        "title": "What probability means, and the two beliefs that trip learners up",
        "summary": (
            "Probability is favourable outcomes over all equally likely outcomes. Here is why "
            "the coin has no memory and why two results are not always half each."
        ),
        "lead": (
            "Probability is the number of outcomes that make an event happen divided by the "
            "number of equally likely outcomes, so it always sits between zero and one."
        ),
        "sections": [
            Section("What the number means", IDEA),
            Section("The coin has no memory", FIRST),
            Section("Two results are not always half each", SECOND),
            Section("One question that shows you hold it", CHECK),
        ],
        "provenance": [
            Provenance(
                document="CBSE Class 10 Mathematics, Probability",
                publisher="ncert.nic.in",
                url="https://ncert.nic.in/textbook/pdf/jemh114.pdf",
                sha256="a" * 64,
                read_on="2026-09-03",
                page="page 1",
            )
        ],
        "figure": Figure(
            concept="probability",
            alt="A die with one face shaded, and the fraction one over six beside it",
            turn_id="turn-probability-1",
            verified=True,
        ),
        "film": Film(
            concept="probability",
            seconds=40,
            script=(
                "A die has six faces. One of them is a four. So the chance of a four is one out "
                "of six, and the die does not remember the last roll."
            ),
            asset_id="asset-probability-1",
        ),
        "topic_slug": slug,
        "topic_name": "Probability",
        "boards": ["CBSE"],
        "drafted_on": DAY,
    }
    base.update(changes)
    return Piece(**base)


class Recorder:
    """A transport that answers from a queue of recorded answers and keeps every request."""

    def __init__(self, *answers: tuple[int, Any]) -> None:
        self.answers = list(answers)
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self, url: str, method: str, headers: dict[str, str], body: Any
    ) -> tuple[int, Any]:
        self.calls.append({"url": url, "method": method, "headers": headers, "body": body})
        if not self.answers:
            raise AssertionError(f"an unexpected request: {method} {url}")
        return self.answers.pop(0)
