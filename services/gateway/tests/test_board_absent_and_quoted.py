"""TWO KEYLESS TURNS THAT ANSWERED WITH A LINE NAMING NOTHING THEY COULD SEE.

The adversary, wave 47, finding 3 (docs/INK-FOUR.md, Relevance). Two of the fifty-nine turns came
back with ``_MOCK_SAY["inline"]`` — "Which step feels shaky? Start there." — and neither ask was
about a step at all.

1. **A LASSO THE LEARNER DREW ROUND TWO LINES OF THEIR OWN PAGE.** Under a 4x-slowed CPU the drag
   crossed both "2 feel the rule" and "3 make a move", so the ask read ``explain this: "2 feel the
   rule · 3 make a move"`` — and ``_BUILD_IT`` found the word "make" inside the learner's own
   QUOTED words and read the whole turn as a request to build something from scratch. No marks, no
   plan, and a sentence from a different question. The words a learner quotes off their page are
   the SUBJECT of the ask; only what they say themselves is the instruction.

2. **A QUESTION ABOUT A DIAGRAM ON A CARD THAT HAS NONE.** "circle the effect circle in the
   diagram" on the "make a move" card, whose glass holds a heading and three lines and no figure
   at all. Relevance at 4 says a question that names nothing on the glass gets no ink AND A USEFUL
   SENTENCE: say plainly that the thing asked about is not on this card, and name what is.
"""

from __future__ import annotations

from typing import Any

from wobo_gateway import wobo
from wobo_gateway.board import glass

#: The course outline at 1440, as the lab recorded it on the slow-machine turn.
OUTLINE = [
    {"id": "course-outline-1", "role": "step", "text": "1 meet a square and a cube",
     "box": [404, 653, 512, 24]},
    {"id": "course-outline-2", "role": "step", "text": "2 feel the rule", "box": [404, 689, 512, 24]},
    {"id": "course-outline-3", "role": "step", "text": "3 make a move", "box": [404, 726, 512, 24]},
    {"id": "course-outline-4", "role": "step", "text": "4 predict, then check",
     "box": [404, 763, 512, 24]},
]

#: The "make a move" card at 1440: a heading, three lines, and nothing to circle.
MAKE_A_MOVE = [
    {"id": "card-c3", "role": "card", "text": "make a move", "box": [374, 305, 572, 227],
     "meaning": "concept:make-a-move"},
    {"id": "h-mqqtc7-0", "role": "heading", "text": "make a move", "box": [374, 341, 572, 36]},
    {"id": "l-gn5r3q-0", "role": "line",
     "text": "Undo one operation at a time to expose what is hidden.", "box": [374, 395, 441, 23]},
    {"id": "l-1nr435b-0", "role": "line", "text": "Slide to peel one layer off.",
     "box": [390, 437, 204, 23]},
    {"id": "k-y5iljc-0", "role": "chip", "text": "Continue", "box": [927, 772, 93, 38]},
]

LASSO = {
    "id": "focus-1",
    "kind": "lasso",
    "targetIds": ["course-outline-2", "course-outline-3"],
    "text": "2 feel the rule · 3 make a move",
    "numbers": [2, 3],
    "rect": {"x": 390, "y": 692, "width": 540, "height": 52},
}


def payload(question: str, entries: list[dict[str, Any]], focus: Any = None) -> dict[str, Any]:
    packet: dict[str, Any] = {"glass": {"entries": entries}}
    if focus is not None:
        packet["focus"] = focus
    return {
        "context": {"turn": {"lastUserInput": question}, "packet": packet},
        "board": {"lesson": True},
    }


# --- 1. the words they quoted are the subject, never the instruction ------------------------------


def test_a_lasso_across_two_lines_is_answered_on_the_glass() -> None:
    ask = "explain this: “2 feel the rule · 3 make a move”"
    plan = glass.keyless_plan(payload(ask, OUTLINE, LASSO))
    assert plan is not None, "the learner circled two lines of their own page"
    assert plan.get("objects"), "and was answered with no ink at all"


def test_the_same_ask_still_reaches_the_board_plan() -> None:
    ask = "explain this: “2 feel the rule · 3 make a move”"
    plan = wobo.mock_board_plan(payload(ask, OUTLINE, LASSO))
    assert plan is not None
    assert plan.get("objects")


def test_a_real_request_to_build_is_still_the_planes() -> None:
    """The guard it was: "make a punnett square" builds, and gets no ring round the nearest line."""
    for ask in ("make a punnett square", "draw the triangle", "graph y = x²"):
        assert glass.keyless_plan(payload(ask, OUTLINE)) is None, ask


def test_a_build_word_the_learner_quoted_still_builds_when_they_asked_for_it() -> None:
    """Quoting is not an escape hatch: the instruction outside the quotes is still read."""
    assert glass.keyless_plan(payload('draw “2 feel the rule” for me', OUTLINE)) is None


# --- 2. the thing asked about is not on this card -------------------------------------------------


def say_for(question: str, entries: list[dict[str, Any]]) -> str:
    return str(wobo.mock_wobo_turn(payload(question, entries)).get("say") or "")


def test_it_says_plainly_that_the_thing_is_not_on_this_card() -> None:
    said = say_for("circle the effect circle in the diagram", MAKE_A_MOVE)
    assert "Which step feels shaky" not in said
    low = said.lower()
    assert "effect circle" in low or "diagram" in low, said
    assert "make a move" in low, said


def test_it_names_what_is_there_even_with_no_heading() -> None:
    lines = [e for e in MAKE_A_MOVE if e["role"] == "line"]
    said = say_for("circle the effect circle", lines)
    assert "Which step feels shaky" not in said
    assert "effect circle" in said.lower(), said


def test_a_thing_that_IS_on_the_card_is_never_called_absent() -> None:
    said = say_for("circle the continue button", MAKE_A_MOVE)
    assert "no continue" not in said.lower(), said


def test_an_ask_with_no_glass_at_all_is_left_as_it_was() -> None:
    said = say_for("circle the effect circle", [])
    assert "on this card" not in said.lower(), said
