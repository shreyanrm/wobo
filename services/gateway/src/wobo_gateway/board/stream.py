"""The turn protocol — say, ink, action, ask, card, done, in order, with timestamps.

BOARD.md §4 is the wire. This module builds that sequence and serialises it as Server-Sent
Events over the SAME authenticated capability route as a non-streaming turn
(``POST /v1/capability/wobo.turn`` with ``Accept: text/event-stream``).

**Why SSE on the capability route and not a socket.** The gateway's door, its rate limiter and
its meter all live in one HTTP middleware keyed on the path prefix ``/v1/capability/``. A
WebSocket has no middleware — that is exactly why the voice relay had to mint its own short-lived
token — so a socket here would mean a second door, a second limiter and a second place a budget
could be forgotten. Streaming on the existing route means auth, consent, rate limiting and the
meter are the same code for a streamed turn and a plain one, and the only difference is the
response body. That is the whole argument.

**Ink before the word.** Wobo's sentences are laid out on a clock at a speaking pace, the plan's
objects are re-based against that clock, and :data:`INK_LEAD_MS` guarantees what BOARD.md §4
requires: the first ``ink`` event lands before the first sentence ends. Objects may claim a
particular beat with ``meta.beat`` (``{"with": 1}`` / ``{"after": 1}``), which is how "Wobo points
before saying *this*" is expressed as data rather than as hope.

**Resume.** Every frame carries an SSE ``id`` of ``<turn>:<seq>``. A client that loses the
connection reconnects with ``Last-Event-ID`` and the turn replays from the next event — from the
last event it acknowledged, not from the beginning, and without spending a second turn from the
learner's day, because the plan is still in the turn store.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import threading
import time
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from wobo_gateway.board.planner import Plan
from wobo_gateway.telemetry import MetricsSink, TelemetryEvent, emit

logger = logging.getLogger("wobo.gateway.board")

#: ``interrupted`` is the seventh: not part of the plan, but the acknowledgement BOARD.md §4 owes
#: the learner when they stop Wobo mid-sentence. It always ends the stream.
EVENT_TYPES = ("say", "ink", "action", "ask", "card", "done", "interrupted")

#: Wobo's speaking pace, in words per minute, and the breath between sentences. Used only to place
#: ink against speech — the voice itself is synthesised elsewhere and is the real clock.
WORDS_PER_MINUTE = 165
SENTENCE_GAP_MS = 220
MIN_SENTENCE_MS = 320

#: The first stroke starts this many milliseconds into the turn — ahead of the first full stop,
#: which is the law, and late enough that it reads as a hand rather than a paste.
INK_LEAD_MS = 120

#: The grammar's own default drawing time for an object that asked for none.
DEFAULT_INK_MS = 240
#: However crowded the board, a mark never draws faster than a hand can move.
MIN_INK_MS = 240

MAX_SENTENCES = 10
#: A finished turn is kept this long so a dropped connection can resume it without paying again.
TURN_TTL_S = 180.0
_MAX_TURNS = 512

_SENTENCE_SPLIT = re.compile(r"(?<=[.?!])\s+")


@dataclass(frozen=True)
class Event:
    """One event on the wire."""

    seq: int
    type: str
    t: int
    data: dict[str, Any]

    def payload(self) -> dict[str, Any]:
        return {"type": self.type, "t": self.t, **self.data}


@dataclass
class Turn:
    """One planned turn, replayable while it is still in the store."""

    id: str
    #: Who owns this turn — ``app.board_key``, not the meter key. An anonymous learner's meter is
    #: their device address (one string for a whole school), and ownership may not be, or two
    #: children on one connection can resume and interrupt each other's board.
    owner: str
    events: list[Event] = field(default_factory=list)
    created: float = field(default_factory=time.monotonic)
    #: Set when the learner cut Wobo off (BOARD.md §4). Once set, this turn never streams another
    #: planned event: what was drawn stays, and every reader gets the acknowledgement instead.
    interrupted: bool = False
    #: The object Wobo was on when they stopped — the client's own ``interrupted_at``, echoed back
    #: so both halves of Wobo agree on where the pen lifted.
    interrupted_at: str | None = None

    def after(self, seq: int) -> list[Event]:
        return [e for e in self.events if e.seq > seq]


_turns: dict[str, Turn] = {}
_lock = threading.Lock()


def remember(turn: Turn) -> None:
    """Keep a turn for the resume window, evicting expired ones and then the oldest."""
    now = time.monotonic()
    with _lock:
        for stale in [k for k, v in _turns.items() if now - v.created > TURN_TTL_S]:
            del _turns[stale]
        while len(_turns) >= _MAX_TURNS:
            del _turns[next(iter(_turns))]
        _turns[turn.id] = turn


def recall(turn_id: str, owner: str) -> Turn | None:
    """A turn this caller may resume. Ownership is the door's ``board_key`` — the meter key AND
    the verified subject — so a resume is never a way to read somebody else's board, not even
    another anonymous child's on the same address."""
    with _lock:
        turn = _turns.get(turn_id)
        if turn is None:
            return None
        if turn.owner != owner or time.monotonic() - turn.created > TURN_TTL_S:
            return None
        return turn


def interrupt(turn_id: str, owner: str, at: str | None = None) -> Turn | None:
    """The learner stopped Wobo. Mark the turn so the stream stops, and hand back what to say.

    BOARD.md §4: on an interrupt the hand stops the pen mid-stroke and the voice mid-sentence,
    what is already drawn stays, and the brain is told which object Wobo was on. The client half
    of that has always worked; this is the brain's half — before it, an interrupt was a local
    abort the brain never heard, so a reconnect happily carried on drawing over a learner who
    had asked Wobo to stop.

    Ownership is the ``board_key``, exactly as :func:`recall` has it: an interrupt is not a way
    to reach into somebody else's turn. An unknown or expired turn is ``None``, and interrupting an
    already-interrupted turn is a no-op that still acknowledges (a tap and a spoken "stop" that
    arrive together must not race into two different answers).
    """
    turn = recall(turn_id, owner)
    if turn is None:
        return None
    with _lock:
        if not turn.interrupted:
            turn.interrupted = True
            turn.interrupted_at = (at or "").strip() or turn.interrupted_at
        elif at and not turn.interrupted_at:
            turn.interrupted_at = at.strip()
    return turn


def forget(owner: str) -> int:
    """Drop every turn remembered for one learner, and say how many. The erase route calls this:
    a turn in the resume window is a cached generation with the learner's own words in it."""
    with _lock:
        mine = [k for k, v in _turns.items() if v.owner == owner]
        for key in mine:
            del _turns[key]
    return len(mine)


def reset() -> None:
    """Test seam — drop every remembered turn."""
    with _lock:
        _turns.clear()


def parse_last_event_id(raw: str | None) -> tuple[str, int] | None:
    """``<turn>:<seq>`` from a ``Last-Event-ID`` header, or None when it is not one of ours."""
    if not raw or ":" not in raw:
        return None
    turn_id, _, seq = raw.rpartition(":")
    if not turn_id or not seq.isdigit() or len(turn_id) > 64:
        return None
    return turn_id, int(seq)


def sentences(say: str) -> list[str]:
    """Wobo's line, split the way Wobo speaks it. The first one is short by design (the two-word
    rule) so the voice starts almost immediately."""
    text = (say or "").strip()
    if not text:
        return []
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()][:MAX_SENTENCES]


def sentence_clock(parts: list[str]) -> list[tuple[int, int]]:
    """``[(start, duration)]`` in milliseconds for each sentence, at Wobo's speaking pace."""
    per_word = 60_000 / WORDS_PER_MINUTE
    clock: list[tuple[int, int]] = []
    cursor = 0
    for part in parts:
        duration = max(MIN_SENTENCE_MS, int(per_word * max(1, len(part.split()))))
        clock.append((cursor, duration))
        cursor += duration + SENTENCE_GAP_MS
    return clock


def _beat_slot(obj: dict[str, Any], clock: list[tuple[int, int]]) -> tuple[int, int] | None:
    """The ``(start, dur)`` an object asked for by naming a sentence, or None if it named none.

    The prompt the model is given (``wobo.py``) says exactly two things, and this is the half that
    makes them true:

    * ``{"with": n}`` — *land it as you BEGIN that sentence*: the pen touches down on the first
      syllable of sentence *n* and takes whatever time the object itself asked for.
    * ``{"after": n}`` — *land it as you finish it*: the pen touches down on the first syllable of
      sentence *n* and the last stroke arrives on its full stop. The object is FINISHED as Wobo
      finishes the sentence, which is what "land it" means.

    ``after`` used to START the object when the sentence ended, which put the ink a whole sentence
    behind the word it belonged to — "ink that lands after the word", BOARD.md §11's own example of
    what kills the board.
    """
    meta = obj.get("meta")
    beat = meta.get("beat") if isinstance(meta, dict) else None
    if not isinstance(beat, dict) or not clock:
        return None
    own = int((obj.get("t") or {}).get("dur") or DEFAULT_INK_MS)
    if isinstance(beat.get("with"), int):
        index = max(0, min(len(clock) - 1, beat["with"]))
        return clock[index][0], own
    if isinstance(beat.get("after"), int):
        index = max(0, min(len(clock) - 1, beat["after"]))
        return clock[index][0], max(own, clock[index][1])
    return None


def _ink_clock(
    objects: list[dict[str, Any]], clock: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """``(start, dur)`` for each object: beats honoured, the rest spread across Wobo's whole line.

    An object that named no beat used to inherit the planner's cumulative schedule, whose default
    is 240 ms an object — so a twelve-object board finished drawing itself in under three seconds
    and then sat there while Wobo talked over it for fifteen. The hand draws THROUGH the utterance
    instead: the unbeaten objects are laid out evenly from the lead-in to Wobo's last full stop,
    each taking its own slice, in the order the planner put them in.
    """
    if not objects:
        return []
    starts = [int((o.get("t") or {}).get("start") or 0) for o in objects]
    durations = [int((o.get("t") or {}).get("dur") or DEFAULT_INK_MS) for o in objects]
    origin = min(starts)
    first_end = (clock[0][0] + clock[0][1]) if clock else INK_LEAD_MS + 1
    lead = min(INK_LEAD_MS, max(0, first_end - 1))
    spoken = (clock[-1][0] + clock[-1][1]) if clock else 0

    slots: list[tuple[int, int] | None] = [_beat_slot(o, clock) for o in objects]
    free = [i for i, slot in enumerate(slots) if slot is None]
    span = spoken - lead
    if clock and free and span > 0:
        # Evenly across what is left of Wobo's line — one slice each, in the planner's order.
        step = span / len(free)
        for place, index in enumerate(free):
            start = lead + int(round(place * step))
            slots[index] = (start, max(durations[index], MIN_INK_MS, int(round(step))))
    else:
        for index in free:
            slots[index] = (lead + (starts[index] - origin), durations[index])

    out = [slot for slot in slots if slot is not None]
    # The law, enforced rather than assumed: something is on the board before Wobo finishes the
    # first sentence, whatever the plan or the beats asked for. Only the EARLIEST stroke is pulled
    # forward — shifting the whole plan would drag every other mark off the word it belongs to,
    # and the choreography is the point of the beats.
    if out and min(start for start, _ in out) >= first_end:
        first = min(range(len(out)), key=lambda i: out[i][0])
        out[first] = (lead, out[first][1])
    return out


def build_events(
    plan: Plan,
    *,
    actions: list[dict[str, Any]] | None = None,
    card: dict[str, Any] | None = None,
) -> list[Event]:
    """The whole turn as an ordered, timestamped event list (BOARD.md §4).

    Ordered by timestamp, so the hand can play it straight through, and ``done`` is always last.
    """
    parts = sentences(plan.say)
    clock = sentence_clock(parts)
    paced = _ink_clock(plan.objects, clock)

    staged: list[tuple[int, int, str, dict[str, Any]]] = []
    for order, (part, (start, duration)) in enumerate(zip(parts, clock, strict=True)):
        staged.append((start, order, "say", {"text": part, "dur": duration}))
    for order, (obj, (start, dur)) in enumerate(zip(plan.objects, paced, strict=True)):
        drawn = {**obj, "t": {"start": start, "dur": dur}}
        staged.append((start, 1000 + order, "ink", {"object": drawn}))

    tail = max([s + d for s, d in clock] + [s + d for s, d in paced] + [0])
    for order, action in enumerate(actions or []):
        if isinstance(action, dict):
            staged.append((tail, 5000 + order, "action", {"action": action}))
    if card is not None:
        staged.append((tail, 6000, "card", {"card": card}))
    if plan.ask is not None:
        # ``ask`` pauses the performance, so it belongs after everything it refers to.
        staged.append((tail, 7000, "ask", plan.ask))

    staged.sort(key=lambda row: (row[0], row[1]))
    events = [
        Event(seq=i, type=kind, t=t, data=data) for i, (t, _order, kind, data) in enumerate(staged)
    ]
    events.append(
        Event(
            seq=len(events),
            type="done",
            t=tail,
            data={
                "presentation": plan.presentation,
                "objects": len(plan.objects),
                "verified": [c.name for c in plan.ledger.checks],
                **({"refused": plan.refusals} if plan.refusals else {}),
                **({"resumes_from": plan.resumes_from} if plan.resumes_from else {}),
            },
        )
    )
    return events


# --- the two onsets, measured (BOARD.md §10) --------------------------------------------------
#
# The budgets: the first spoken syllable inside 1.5 s, the first stroke inside 1 s. The first
# stroke was already measured end to end in the browser; the first SYLLABLE was measured nowhere
# at all, so half of the law was a hope. This is the brain's half of both, and it is the half the
# brain can be held to: from the moment the turn's work begins (``mark_turn_start``, called at the
# top of the plan) to the moment Wobo's first sentence — and first mark — are on the wire, plus the
# choreography offset each was scheduled at. It excludes the network and the voice's own start-up,
# which the client measures; a turn that misses the budget HERE can never make it there.

FIRST_SYLLABLE_BUDGET_MS = 1500.0
FIRST_STROKE_BUDGET_MS = 1000.0

#: Where the two onsets land for inspection in dev and assertion in tests. Its own sink, not the
#: Gateway's: the Gateway's sink records one model call each, and a turn's onsets are a property of
#: the whole turn — the plan, the pacing and the wire — not of any one call inside it.
LATENCY = MetricsSink()

#: When this turn's work began. A context variable, so it is per request even though every route
#: here runs on FastAPI's threadpool: each call gets its own copy of the context, so one learner's
#: clock can never be read as another's, and an unmarked turn measures nothing rather than lying.
_turn_started: ContextVar[float | None] = ContextVar("wobo_board_turn_started", default=None)


#: A wait longer than this is not a turn anybody sat through — it is a clock left running by an
#: earlier one (a worker thread that reused a context, a mark whose turn never reached the stream).
#: Past it the measurement is None: "not measured", never a fabricated three-hour first syllable.
STALE_CLOCK_MS = 60_000.0


def mark_turn_start() -> None:
    """Start this turn's clock. Called where the turn's work begins, before the model is asked."""
    _turn_started.set(time.monotonic())


def brain_ms() -> float | None:
    """Milliseconds since this turn's clock started, or None when nobody started one.

    One mark, one measurement: the clock is consumed here, so a turn can never be measured twice
    and a mark that outlived its turn cannot be charged to the next one.
    """
    started = _turn_started.get()
    if started is None:
        return None
    _turn_started.set(None)
    elapsed = (time.monotonic() - started) * 1000.0
    if elapsed < 0 or elapsed > STALE_CLOCK_MS:
        return None
    return elapsed


@dataclass(frozen=True)
class Onsets:
    """When the learner hears Wobo, and when they see the first mark — the brain's half."""

    first_syllable_ms: float | None
    first_stroke_ms: float | None

    def within_budget(self) -> bool:
        syllable = self.first_syllable_ms
        stroke = self.first_stroke_ms
        return (syllable is None or syllable <= FIRST_SYLLABLE_BUDGET_MS) and (
            stroke is None or stroke <= FIRST_STROKE_BUDGET_MS
        )


def onsets(events: list[Event], elapsed_ms: float | None = None) -> Onsets:
    """The two onsets for one planned turn: the brain's elapsed time plus the beat each was put on.

    A turn with nothing to say has no syllable and a turn with nothing to draw has no stroke;
    neither is reported as zero, because a measurement nobody took is not a measurement of nought.
    """
    if elapsed_ms is None:
        return Onsets(None, None)
    first_say = next((e.t for e in events if e.type == "say"), None)
    first_ink = next((e.t for e in events if e.type == "ink"), None)
    return Onsets(
        first_syllable_ms=None if first_say is None else round(elapsed_ms + first_say, 1),
        first_stroke_ms=None if first_ink is None else round(elapsed_ms + first_ink, 1),
    )


def record_onsets(turn: Turn, measured: Onsets) -> Onsets:
    """Log this turn's onsets and put them in the sink. A missed budget is a warning, by name."""
    emit(
        LATENCY,
        TelemetryEvent(
            capability="wobo.turn",
            track="turn",
            model="board.turn",
            # The headline number is the one the whole law is about: when Wobo starts speaking.
            latency_ms=measured.first_syllable_ms or 0.0,
            tokens=0,
            cache_hit=False,
            first_syllable_ms=measured.first_syllable_ms,
            first_stroke_ms=measured.first_stroke_ms,
        ),
    )
    if not measured.within_budget():
        logger.warning(
            "board turn over its onset budget",
            extra={
                "fields": {
                    "turn": turn.id,
                    "first_syllable_ms": measured.first_syllable_ms,
                    "first_stroke_ms": measured.first_stroke_ms,
                    "first_syllable_budget_ms": FIRST_SYLLABLE_BUDGET_MS,
                    "first_stroke_budget_ms": FIRST_STROKE_BUDGET_MS,
                }
            },
        )
    return measured


def new_turn(owner: str, events: list[Event]) -> Turn:
    turn = Turn(id=secrets.token_urlsafe(9), owner=owner, events=events)
    remember(turn)
    # Measured on the way out, on every turn, streamed or replayed from the same plan — a budget
    # nobody measures is a budget nobody keeps.
    record_onsets(turn, onsets(events, brain_ms()))
    return turn


def frame(turn_id: str, event: Event) -> str:
    """One SSE frame. The ``id`` is what a reconnect sends back as ``Last-Event-ID``."""
    body = json.dumps(event.payload(), separators=(",", ":"), default=str)
    return f"id: {turn_id}:{event.seq}\nevent: {event.type}\ndata: {body}\n\n"


def acknowledgement(turn: Turn, seq: int, t: int) -> Event:
    """The frame that closes an interrupted turn: what Wobo heard, and where the pen lifted."""
    return Event(
        seq=seq,
        type="interrupted",
        t=t,
        data={"at": turn.interrupted_at} if turn.interrupted_at else {},
    )


def iter_sse(turn: Turn, *, after: int = -1) -> Iterator[str]:
    """The turn as an SSE body, from the event after ``after``.

    A comment frame goes first so a proxy flushes headers immediately — that is the difference
    between the pen starting in a second and the pen starting when the whole plan is done.

    The interrupt is checked BETWEEN frames rather than once at the top: the learner stops Wobo
    while the turn is on the wire, not before it starts. The first frame after the interrupt is
    the acknowledgement, and the body ends there — no ``done``, because the turn did not finish.
    """
    yield ": open\n\n"
    last_seq, last_t = after, 0
    for event in turn.after(after):
        if turn.interrupted:
            yield frame(turn.id, acknowledgement(turn, max(last_seq, 0), last_t))
            return
        last_seq, last_t = event.seq, event.t
        yield frame(turn.id, event)
    if turn.interrupted:
        # Interrupted after the last frame was written: still acknowledged, so the learner's stop
        # is never silently swallowed by a turn that happened to be nearly over.
        yield frame(turn.id, acknowledgement(turn, max(last_seq, 0), last_t))


def as_json(turn: Turn) -> dict[str, Any]:
    """The same turn for a client that did not ask for a stream — one JSON body, same order."""
    return {"turn": turn.id, "events": [e.payload() for e in turn.events]}
