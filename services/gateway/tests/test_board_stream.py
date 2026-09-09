"""The turn protocol — ordering, the ink-before-the-word law, interrupt and resume."""

from __future__ import annotations

import json

import pytest
from wobo_gateway.board import naming, planner, stream
from wobo_gateway.board.planner import Plan, plan_board


@pytest.fixture(autouse=True)
def _empty_turn_store() -> None:
    stream.reset()


def board(say: str, objects: list[dict] | None = None) -> Plan:
    return Plan(say=say, presentation="plane", objects=objects or [])


def marks(n: int) -> list[dict]:
    return [
        {
            "id": f"v{i}",
            "kind": "circle",
            "anchor": {"board": [100 + i, 100]},
            "t": {"start": i * 300, "dur": 240},
        }
        for i in range(n)
    ]


def test_wobos_line_is_split_the_way_wobo_speaks_it() -> None:
    assert stream.sentences("Look at this. The curve turns here.") == [
        "Look at this.",
        "The curve turns here.",
    ]
    assert stream.sentences("   ") == []


def test_the_clock_runs_forward_at_a_speaking_pace() -> None:
    clock = stream.sentence_clock(stream.sentences("Look. Now watch the tangent land on it."))
    assert clock[0][0] == 0
    assert clock[1][0] > clock[0][0] + clock[0][1]
    assert clock[1][1] > clock[0][1]  # the longer sentence takes longer


def test_the_first_stroke_lands_before_the_first_sentence_ends() -> None:
    events = stream.build_events(board("Look at this. The curve turns here.", marks(3)))
    first_say = next(e for e in events if e.type == "say")
    first_ink = next(e for e in events if e.type == "ink")
    assert first_ink.t < first_say.t + first_say.data["dur"]


def test_the_law_holds_even_when_the_plan_starts_late() -> None:
    late = marks(2)
    for obj in late:
        obj["t"]["start"] += 9000
    events = stream.build_events(board("Look.", late))
    first_say = next(e for e in events if e.type == "say")
    first_ink = next(e for e in events if e.type == "ink")
    assert first_ink.t < first_say.t + first_say.data["dur"]


def test_an_object_may_claim_the_beat_it_lands_on() -> None:
    """The two words the prompt gives the model, meaning exactly what it says they mean.

    `{"with": n}` lands as Wobo BEGINS sentence n; `{"after": n}` starts there too and is FINISHED
    as Wobo finishes it. `after` used to start where the sentence ended, which is ink landing a
    whole sentence after the word it belongs to.
    """
    objects = marks(3)
    objects[0]["meta"] = {"beat": {"with": 0}}
    objects[1]["meta"] = {"beat": {"after": 0}}
    objects[2]["meta"] = {"beat": {"with": 1}}
    plan = board("Look at this. Watch the tangent.", objects)
    clock = stream.sentence_clock(stream.sentences(plan.say))
    events = [e for e in stream.build_events(plan) if e.type == "ink"]
    assert [e.t for e in events] == [clock[0][0], clock[0][0], clock[1][0]]
    # The `after` object is complete on the full stop of the sentence it named.
    finished = events[1].data["object"]["t"]
    assert finished["start"] + finished["dur"] == clock[0][0] + clock[0][1]


def test_only_the_earliest_stroke_is_pulled_forward_to_keep_the_law() -> None:
    """Every beat sits after the first full stop, so exactly one mark moves and the rest keep
    the word they were written for."""
    objects = marks(2)
    objects[0]["meta"] = {"beat": {"with": 1}}
    objects[1]["meta"] = {"beat": {"after": 1}}
    plan = board("Look at this. Watch the tangent.", objects)
    clock = stream.sentence_clock(stream.sentences(plan.say))
    events = [e for e in stream.build_events(plan) if e.type == "ink"]
    assert events[0].t == stream.INK_LEAD_MS
    assert events[1].t == clock[1][0]
    late = events[1].data["object"]["t"]
    assert late["start"] + late["dur"] == clock[1][0] + clock[1][1]


def test_ink_with_no_beat_is_spread_across_wobos_whole_line() -> None:
    """The planner's default is 240 ms an object. Streamed as-is, a whole board drew itself in
    under three seconds and then sat still while Wobo talked over it — so the hand draws THROUGH
    the utterance instead: evenly from the lead-in to Wobo's last full stop, in the planner's order.
    """
    objects = marks(6)
    for obj in objects:  # exactly what `planner._schedule` produces
        obj["t"] = {"start": 240 * objects.index(obj), "dur": 240}
    plan = board(
        "Look at this. The curve turns here. Then it comes back down to the axis again.",
        objects,
    )
    clock = stream.sentence_clock(stream.sentences(plan.say))
    spoken = clock[-1][0] + clock[-1][1]
    ink = [e for e in stream.build_events(plan) if e.type == "ink"]

    starts = [e.t for e in ink]
    assert starts == sorted(starts)
    assert starts[0] <= stream.INK_LEAD_MS  # the first stroke still beats the first full stop
    # The last mark begins in the last third of Wobo's line, not in its first second.
    assert starts[-1] > spoken * 0.6
    # Nothing is packed at the grammar's 240 ms default any more.
    assert min(e.data["object"]["t"]["dur"] for e in ink) > stream.DEFAULT_INK_MS
    # Evenly: no gap between consecutive marks is more than a shade off the average.
    gaps = [b - a for a, b in zip(starts, starts[1:], strict=False)]
    assert max(gaps) - min(gaps) <= 2
    # And the hand is still drawing as Wobo stops speaking, rather than long finished. It ends
    # within one stroke of the last full stop: no stroke is longer than a hand's move
    # (:data:`stream.MAX_INK_MS`, wave 46 finding 5), so "still drawing" is the last stroke's
    # start, not a stroke stretched to cover the silence.
    last = ink[-1].data["object"]["t"]
    assert last["start"] + last["dur"] >= spoken - stream.MAX_INK_MS
    assert last["start"] < spoken


def test_a_turn_with_no_words_still_paces_its_ink_by_the_plan() -> None:
    """No sentences means no clock to spread against: the planner's own order is all there is."""
    events = [e for e in stream.build_events(board("", marks(3))) if e.type == "ink"]
    assert [e.t for e in events] == [stream.INK_LEAD_MS + n for n in (0, 300, 600)]


def test_events_are_ordered_and_done_is_last() -> None:
    plan = board("Look at this. Watch it.", marks(4))
    plan.ask = {"prompt": "What changed?", "targets": ["v1"]}
    events = stream.build_events(plan, actions=[{"type": "setMood", "mood": "thinking"}])
    assert [e.seq for e in events] == list(range(len(events)))
    assert [e.t for e in events] == sorted(e.t for e in events)
    assert events[-1].type == "done"
    kinds = [e.type for e in events]
    assert kinds.count("say") == 2
    assert kinds.count("ink") == 4
    assert "ask" in kinds and "action" in kinds
    assert kinds.index("ask") < kinds.index("done")


def test_done_reports_what_was_verified_and_what_was_refused() -> None:
    plan = plan_board(
        {
            "intents": [{"pipeline": "math", "op": "graph", "expr": "x**2", "tangent_at": 1}],
            "objects": [{"id": "m1", "kind": "circle", "anchor": {"target": "gone"}}],
        },
        context={"targets": []},
    )
    done = stream.build_events(plan)[-1]
    assert done.type == "done"
    assert "board.numbers_agree:tangent slope" in done.data["verified"]
    assert done.data["refused"]
    assert done.data["presentation"] == "plane"


# --- the wire ---------------------------------------------------------------------------------
def test_a_frame_carries_an_id_an_event_and_json() -> None:
    events = stream.build_events(board("Look at this.", marks(1)))
    turn = stream.new_turn("meter-1", events)
    text = stream.frame(turn.id, events[0])
    assert text.startswith(f"id: {turn.id}:0\nevent: say\ndata: ")
    assert text.endswith("\n\n")
    body = json.loads(text.split("data: ", 1)[1].strip())
    assert body["type"] == "say" and body["t"] == 0


def test_the_body_opens_immediately_so_a_proxy_flushes() -> None:
    turn = stream.new_turn("meter-1", stream.build_events(board("Look.", marks(1))))
    assert next(iter(stream.iter_sse(turn))).startswith(":")


def test_a_resume_replays_only_what_was_not_acknowledged() -> None:
    turn = stream.new_turn("meter-1", stream.build_events(board("Look. Watch.", marks(3))))
    total = len(list(stream.iter_sse(turn))) - 1  # minus the open comment
    tail = [f for f in stream.iter_sse(turn, after=1) if not f.startswith(":")]
    assert len(tail) == total - 2
    assert tail[0].startswith(f"id: {turn.id}:2\n")


def test_a_resume_belongs_to_the_learner_who_paid_for_it() -> None:
    turn = stream.new_turn("meter-1", stream.build_events(board("Look.", marks(1))))
    assert stream.recall(turn.id, "meter-1") is turn
    assert stream.recall(turn.id, "someone-else") is None
    assert stream.recall("not-a-turn", "meter-1") is None


def test_the_last_event_id_header_is_parsed_and_never_trusted_blindly() -> None:
    assert stream.parse_last_event_id("abc:7") == ("abc", 7)
    assert stream.parse_last_event_id("abc") is None
    assert stream.parse_last_event_id("abc:x") is None
    assert stream.parse_last_event_id("x" * 200 + ":1") is None
    assert stream.parse_last_event_id(None) is None


def test_an_expired_turn_is_not_replayable(monkeypatch: pytest.MonkeyPatch) -> None:
    turn = stream.new_turn("meter-1", stream.build_events(board("Look.", marks(1))))
    monkeypatch.setattr(stream, "TURN_TTL_S", -1.0)
    assert stream.recall(turn.id, "meter-1") is None


# --- wave 46, finding 5: the ink keeps time with the sentence that names it ----------------------


def _in_step(events: list[stream.Event]) -> list[str]:
    """Every drawn thing whose stroke does not keep time with the sentence naming it.

    THE CLAUSE (docs/INK-FOUR.md, Timing at 4): *each mark is drawn in step with the sentence that
    names it, ahead of the word, never after the sentence ends.* Measured off the wire: the say
    frames give each sentence its window, and every object whose name is in a sentence has to
    start inside that sentence's window.
    """
    says = [(e.t, e.t + int(e.data["dur"]), e.data["text"]) for e in events if e.type == "say"]
    broken: list[str] = []
    for event in events:
        if event.type != "ink":
            continue
        obj = event.data["object"]
        name = naming.part_name(obj) or naming.mark_subject(obj)
        if not name:
            continue
        windows = [(a, b) for a, b, text in says if naming.names(text, name)]
        if not windows:
            continue
        if not any(a <= event.t < b for a, b in windows):
            broken.append(f"{name!r} drawn at {event.t} ms, said at {windows}")
    return broken


def _pythagoras_events() -> list[stream.Event]:
    plan = planner.plan_board(
        {
            "say": "The squares on the two legs add to the square on the hypotenuse.",
            "intents": [
                {
                    "pipeline": "math",
                    "op": "construction",
                    "what": "right_triangle",
                    "legs": [3, 4],
                    "squares": True,
                    "unit": "cm",
                }
            ],
        },
        context={"turn": {"lastUserInput": "prove pythagoras theorem"}},
    )
    assert len(plan.objects) == 10, len(plan.objects)
    return stream.build_events(plan)


def test_a_from_scratch_board_is_not_a_slideshow_that_outlives_the_words() -> None:
    """Finding 5, 2026-09-09. Pythagoras scheduled its ten objects at 120, 1184, 2249 ... 9700 ms
    with dur 1064 each: every stroke a full second long, the last one starting 9.7 s in, and not
    one of them on the sentence that named it. The same shape on the projectile, the plant cell
    and the timeline. Unbeaten ink was spread from the lead-in to Wobo's LAST full stop, which is
    the whole utterance, so a from-scratch board could not keep this clause by construction.
    """
    events = _pythagoras_events()
    assert _in_step(events) == []

    ink = [e for e in events if e.type == "ink"]
    # A hand does not take a second over a line. Nothing draws slower than this.
    slow = [(e.data["object"].get("kind"), e.data["object"]["t"]["dur"]) for e in ink]
    assert all(d <= stream.MAX_INK_MS for _k, d in slow), slow
    # And the figure is on the glass early rather than a stroke a second for ten seconds.
    assert ink[-1].t < 6000, [e.t for e in ink]


def test_the_figure_is_drawn_before_the_parts_it_carries_are_named() -> None:
    """The triangle and its right angle come first: a label lands on a thing that is there."""
    events = _pythagoras_events()
    ink = [e for e in events if e.type == "ink"]
    order = [str(e.data["object"].get("id")) for e in ink]
    assert order[0].endswith("triangle") and order[1].endswith("rightangle"), order
    assert ink[0].t <= stream.INK_LEAD_MS
    # drawing order is never shuffled by the beats
    assert [e.t for e in ink] == sorted(e.t for e in ink), order


def test_a_label_is_never_drawn_before_the_thing_it_hangs_off() -> None:
    """BOARD.md §4: a reference always points backwards. Measured on a real screen at 1440 on
    2026-09-09: the plant cell's five labels were all beaten to the sentence that NAMES them,
    which the naming pass had put in front of the sentence that names the figure — so every label
    was streamed before the leader it hangs off and the outline it sits on, and not one of them
    painted. The board was five arrows pointing at nothing.
    """
    plan = planner.plan_board(
        {
            "say": "A plant cell, part by part.",
            "intents": [{"pipeline": "bio_social", "op": "cell", "subject": "plant cell"}],
        },
        context={"turn": {"lastUserInput": "Draw a plant cell with five labels"}},
    )
    events = [e for e in stream.build_events(plan) if e.type == "ink"]
    at = {str(e.data["object"]["id"]): e.t for e in events}
    for event in events:
        obj = event.data["object"]
        anchor = obj.get("anchor") or {}
        owner = anchor.get("object") if isinstance(anchor, dict) else None
        if isinstance(owner, str) and owner in at:
            assert at[owner] <= event.t, f"{obj['id']} is drawn before {owner}"
    # and the figure itself is on the glass before anything is said about its parts
    outline = next(e for e in events if str(e.data["object"]["id"]).endswith("outline"))
    assert outline.t <= stream.INK_LEAD_MS, outline.t
    said = [e for e in stream.build_events(plan) if e.type == "say"]
    parts_named = next(i for i, e in enumerate(said) if "vacuole" in e.data["text"])
    assert said[parts_named].t > outline.t
