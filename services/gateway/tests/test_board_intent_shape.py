"""The shape of an intent, and the empty board that came of never saying it.

``pipelines/__init__`` states the contract in its own docstring::

    {"pipeline": "math", "op": "graph", "expr": "x**2", "domain": [-3, 3], "tangent_at": 1}

``BOARD_SYSTEM`` — the prompt that is the only place a model ever learns that contract — printed a
TABLE of pipelines and ops and never once showed the object. So the model wrote the shape the
table implies, ``{"math": {"op": "graph", ...}}``; ``run_intent`` read ``intent["pipeline"]``,
found nothing, and refused it; and the turn streamed Wobo saying

    "I've drawn the parabola and its tangent at the requested point."

over a board with zero objects on it. Found by the teaching harness on the first live board turn
it ever ran, 2026-09-05.

Two tests, closing it from both ends:

* the prompt now carries the exact object, and the object it carries has to be one the planner can
  actually draw — so the two can never drift apart again while both keep passing;
* the planner accepts the nested shape as well, because an empty board under a sentence promising
  a drawing is the worst thing this product can do and a forgiving read costs one dictionary.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest
from wobo_gateway.board.pipelines import run_intent
from wobo_gateway.board.planner import plan_board
from wobo_gateway.wobo import BOARD_SYSTEM

#: The example intent as the prompt prints it.
_EXAMPLE = re.compile(r'\{"pipeline":[^\n]*\}')


def test_the_prompt_shows_an_intent_a_pipeline_can_actually_draw() -> None:
    match = _EXAMPLE.search(BOARD_SYSTEM)
    assert match, "BOARD_SYSTEM must show the intent object, not only a table of ops"
    intent: dict[str, Any] = json.loads(match.group(0))
    assert intent.get("pipeline"), "the example has to name its pipeline — that is the whole point"
    draft = run_intent(intent)
    assert draft.objects, "the prompt's own example intent must produce ink"


@pytest.mark.parametrize(
    "intent",
    [
        {"pipeline": "math", "op": "graph", "expr": "x**2", "var": "x", "domain": [-3, 3]},
        {"math": {"op": "graph", "expr": "x**2", "var": "x", "domain": [-3, 3]}},
    ],
    ids=["the contract's shape", "the shape a model writes from the table"],
)
def test_both_shapes_of_the_same_intent_reach_the_board(intent: dict[str, Any]) -> None:
    plan = plan_board({"say": "Here is the curve.", "intents": [intent]})
    assert plan.objects, f"nothing was drawn, and the planner said: {plan.refusals}"
    assert not plan.refusals


def test_an_intent_that_names_a_pipeline_nobody_has_is_still_refused() -> None:
    """The forgiving read has a floor: a key that is not a pipeline is not an intent."""
    plan = plan_board({"say": "x", "intents": [{"astrology": {"op": "chart"}}]})
    assert not plan.objects
    assert plan.refusals


def test_a_tangent_stays_inside_the_plot_it_belongs_to() -> None:
    """The tangent ran off the bottom of the whole board, not just off the graph.

    ``_tangent`` takes the two X extremes of the frame and computes y at each. For any slope
    steeper than the frame's aspect that y is far outside the plot, and ``Frame.at`` clamps it to
    the 1000-unit board rather than to the plot — so "graph y = x^2 with the tangent at x = 1"
    drew a line from inside the axes down to the very bottom edge of the board, across everything
    else on it. The teaching harness measured it there on 2026-09-05.

    A tangent is a line THROUGH a plot. Its endpoints are the edges of the plot, whichever edges
    those turn out to be.
    """
    plan = plan_board(
        {
            "say": "Here is the curve and its tangent.",
            "intents": [
                {
                    "pipeline": "math",
                    "op": "graph",
                    "expr": "x**2",
                    "var": "x",
                    "domain": [-3, 3],
                    "tangent_at": 1,
                }
            ],
        }
    )
    assert not plan.refusals
    grid = next(o for o in plan.objects if o["kind"] == "grid")
    top = grid["anchor"]["board"][1]
    bottom = top + grid["h"]
    tangent = next(o for o in plan.objects if o["kind"] == "line")
    for point in (tangent["anchor"]["board"], tangent["to"]["board"]):
        assert top - 1 <= point[1] <= bottom + 1, (
            f"the tangent reaches {point[1]:g} on a plot that runs {top:g} to {bottom:g}"
        )
