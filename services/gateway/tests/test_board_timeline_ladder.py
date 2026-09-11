"""A timeline's event names are a LADDER, not a row (the judge, wave 48, finding 1).

Measured on the real screens, before the fix, at 390 in light, in dark AND under reduced motion,
on "Draw a timeline of the non-cooperation movement":

    "Jallianwala Bagh massacre"  x 41-198  y 615
    "Chauri Chaura, called off"  x 205-352 y 615   <- SEVEN pixels from the one before it
    "Non-Cooperation begins"     x 97-234  y 642

Two different events' names, side by side on one row with seven pixels between them, read as one
run-on line; the third was bumped to a second row. The same board at 1440 put the same pair 55 px
apart and read fine, so nothing about the PLAN said which it would be — the plan hung all three
labels off their own ticks at ``bottom`` and left the client's collision walk to sort it out, and
that walk only moves a label when the boxes actually overlap. Seven pixels of clearance is not an
overlap, so it did not move.

It is not only the phone, either. The five-event "indian national movement" board, measured the
same way, ladders cleanly into five rows at 390 and puts "Dandi March" and "Independence and
Partition" THREE pixels apart on one row at 1440, in both themes. Which labels share a row was a
function of the screen, so the board a learner reads was a different board on their friend's
laptop.

The law here is the fix, and it is a property of the PLAN rather than of a screen: every event
label asks for the SAME left edge, so every pair of them overlaps where they are asked for, so the
client's own walk — which steps down by one real line height, at whatever type size that screen
chose — gives each event a row of its own. Rows in the order the years run. Identical at 390 and
1440, in both themes, under reduced motion, and at every rung of the type ladder.
"""

from __future__ import annotations

import pytest
from wobo_gateway.board.pipelines import run_intent
from wobo_gateway.board.pipelines.bio_social import SYLLABUS_TIMELINES, syllabus_timeline
from wobo_gateway.board.verify import Unverified

NON_COOPERATION = "Draw a timeline of the non-cooperation movement"


def _draft(events: list[dict], ask: str = NON_COOPERATION):
    return run_intent({"pipeline": "bio_social", "op": "timeline", "events": events}, ask=ask)


def _events(draft) -> list[dict]:
    return [o for o in draft.objects if o["kind"] == "label" and o["id"].endswith("event")]


def _ticks(draft) -> dict[str, list[float]]:
    return {o["id"]: o["anchor"]["board"] for o in draft.objects if o["id"].endswith("tick")}


def _asked_left(label: dict, ticks: dict[str, list[float]]) -> float:
    """The x the client is asked to write this label at: its tick's box, nudged by the offset.

    ``placeLabelAt`` (packages/wobo/src/board/layout.ts) left-aligns a ``bottom`` label to the
    anchor box, and ``resolveAnchorBox`` (anchors.ts) applies ``offset`` to that box first. So this
    is the label's asked-for left edge in board units, up to the constant width of a tick's own
    box, which is the same for every tick.
    """
    anchor = label["anchor"]
    dx = (anchor.get("offset") or [0.0, 0.0])[0]
    return round(ticks[anchor["object"]][0] + float(dx), 2)


@pytest.mark.parametrize("topic", sorted(SYLLABUS_TIMELINES))
def test_every_event_name_asks_for_the_same_left_edge_so_none_can_share_a_row(
    topic: str,
) -> None:
    """The ladder law. Before the fix each label asked for its own tick's x, which is why two of
    them landed seven pixels apart on one row at 390 and fifty-five apart at 1440."""
    events = [{"year": y, "label": text} for y, text in SYLLABUS_TIMELINES[topic]]
    draft = _draft(events)
    labels = _events(draft)
    assert len(labels) == len(events), f"{topic} drew {len(labels)} names for {len(events)} events"
    ticks = _ticks(draft)
    lefts = [_asked_left(label, ticks) for label in labels]
    assert len(set(lefts)) == 1, (
        f"{topic} asks for {sorted(set(lefts))} — two event names asked for different left edges, "
        "so whether they share a row is decided by the screen"
    )


def test_every_event_name_still_hangs_off_its_own_tick() -> None:
    """The ladder is a nudge on the anchor, never a re-anchoring: the name of the event still
    belongs to the tick of the event, which is what the say and the ledger are reconciled against
    and what the renderer's dependency order reads."""
    draft = _draft(syllabus_timeline(NON_COOPERATION))
    labels = _events(draft)
    ticks = [o["id"] for o in draft.objects if o["id"].endswith("tick")]
    assert [label["anchor"]["object"] for label in labels] == ticks
    for label in labels:
        assert label["anchor"]["at"] == "bottom"
        assert label["anchor"]["offset"][1] == 0.0, (
            "the ladder is the client's line height, not ours"
        )


def test_the_names_ladder_in_the_order_the_years_run() -> None:
    """Rows in time order, because the client's walk fills them in the order the plan is built."""
    draft = _draft(
        [
            {"year": 1922, "label": "Chauri Chaura, called off"},
            {"year": 1919, "label": "Jallianwala Bagh massacre"},
            {"year": 1920, "label": "Non-Cooperation begins"},
        ]
    )
    assert [o["text"] for o in _events(draft)] == [
        "Jallianwala Bagh massacre",
        "Non-Cooperation begins",
        "Chauri Chaura, called off",
    ]


def test_a_timeline_of_two_short_events_is_a_ladder_too() -> None:
    """One event, one row, whatever the labels measure.

    A rule that kept short names side by side would have to guess how wide they render, and it
    cannot: written type is scaled by the board's own type ladder, up to twice its planned size
    (``MAX_TYPE_SCALE`` in renderer.tsx), so the same two words are 120 board units wide on one
    screen and 240 on another. The guess is what put seven pixels between two events' names.
    """
    draft = _draft([{"year": 1930, "label": "salt"}, {"year": 1931, "label": "pact"}])
    ticks = _ticks(draft)
    lefts = {_asked_left(label, ticks) for label in _events(draft)}
    assert len(lefts) == 1


def test_the_line_sits_at_the_top_of_the_figure_box_so_the_ladder_has_its_rows() -> None:
    """A timeline hangs almost entirely below its own line — years staggering up off the ticks,
    names laddering down — so a line through the MIDDLE of the figure box spends half the box on
    air and costs the ladder the rows it needs. With the line centred, a six-event board put three
    names in a heap at 390; with it at the top, six ladder cleanly at both widths."""
    from wobo_gateway.board.pipelines import FIGURE, FIGURE_MID

    draft = _draft(syllabus_timeline(NON_COOPERATION))
    line = next(o for o in draft.objects if o["kind"] == "line")
    # The frame is one unit tall, so the line lands on its floor, a unit under the box's top edge.
    at_the_top = [FIGURE[1], FIGURE[1] + 1.0]
    ys = [
        line["anchor"]["board"][1],
        line["to"]["board"][1],
        *(a[1] for a in _ticks(draft).values()),
    ]
    assert all(at_the_top[0] <= y <= at_the_top[1] for y in ys), ys
    assert max(ys) < FIGURE_MID[1], "the line is centred again; the ladder has lost its rows"


def test_more_events_than_the_board_has_rows_is_refused_with_its_reason() -> None:
    """A ladder is rows, and the board runs out of them.

    Measured on the real screens on a seven-event ask, not reasoned about: at seven the ladder
    walks past the bottom of the board, ``placeLabelAt`` stops walking, and four names pile up on
    one row at 390; give it the room and the ink is tall enough that five of the seven measure 9.9
    to 11.7 px at 1440, under INK-FOUR's twelve. At six it is clean at both widths, in both themes
    and under reduced motion, and the smallest name measures 12.6 px. So the seventh is refused
    with the reason it always gave rather than silently stacked.
    """
    events = [{"year": 1900 + n, "label": f"event {n}"} for n in range(7)]
    with pytest.raises(Unverified, match="more than one board"):
        _draft(events, ask="Draw a timeline of seven things")
    six = [{"year": 1900 + n, "label": f"event {n}"} for n in range(6)]
    assert len(_events(_draft(six, ask="Draw a timeline of six things"))) == 6
