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

import copy
import json
import logging
import re
import secrets
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from wobo_gateway.board import naming
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
#: Nor slower. A stroke stretched to a second and a half is not a hand, it is a slide changing:
#: pythagoras drew ten objects at 1064 ms each and took 10.8 s over a figure a teacher draws in
#: three (the adversary, 2026-09-09, finding 5).
MAX_INK_MS = 900

#: How many marks the client may say it has standing on the glass, and how long each one's words
#: may be. A turn draws at most ten marks (INK-FREEZE §3, Plan) and the instant mark is ONE; this
#: is the ceiling on a field the client writes and Wobo then speaks, not a target.
MAX_STANDING = 4
MAX_STANDING_WORDS = 120

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

    def extend(self, events: list[Event]) -> list[Event]:
        """Append a later phase of the same turn, numbering it on from the last frame.

        A turn reaches the wire in two phases when its drawing was resolved without the model
        (``board.scaffold``): the scaffold goes out at once and the model's words follow. Both
        halves are ONE turn — one id, one sequence that only ever grows — so a reconnect resumes
        a two-phase turn exactly as it resumes a one-phase one.
        """
        next_seq = (self.events[-1].seq + 1) if self.events else 0
        added = [
            Event(seq=next_seq + i, type=e.type, t=e.t, data=e.data)
            for i, e in enumerate(events)
        ]
        self.events.extend(added)
        return added


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
        start, length = clock[index]
        lag = beat.get("lag")
        if isinstance(lag, (int, float)) and not isinstance(lag, bool):
            # The plan of marks on the glass (board.glass): two marks in one sentence are drawn
            # one after the other by one pen, the second lagging the first by its duration, and
            # every stroke of a sentence ENDS inside that sentence. A mark that cannot fit after
            # the first is pulled forward, never pushed past the full stop.
            own = min(own, length)
            return max(start, min(start + int(lag), start + length - own)), own
        # AHEAD OF THE WORD (INK-FOUR, Timing at 4). ``board.naming.keep_time`` records WHERE in
        # the sentence the name falls; the pace lives here, so this is where a word becomes a
        # millisecond. The stroke lands so that it is finishing as the word is said, and never
        # after the sentence it belongs to has ended.
        word, words = beat.get("word"), beat.get("words")
        if isinstance(word, int) and isinstance(words, int) and words > 0:
            own = min(own, length)
            at = int(length * max(0, min(word, words - 1)) / words)
            return max(start, min(start + at - own, start + length - own)), own
        return start, own
    if isinstance(beat.get("after"), int):
        index = max(0, min(len(clock) - 1, beat["after"]))
        return clock[index][0], max(own, clock[index][1])
    return None


def _runs(slots: list[tuple[int, int] | None]) -> list[tuple[int, int]]:
    """The half-open spans of consecutive unbeaten objects, in drawing order."""
    out: list[tuple[int, int]] = []
    start: int | None = None
    for index, slot in enumerate(slots):
        if slot is None and start is None:
            start = index
        elif slot is not None and start is not None:
            out.append((start, index))
            start = None
    if start is not None:
        out.append((start, len(slots)))
    return out


def _end_of(slot: tuple[int, int] | None) -> int:
    return 0 if slot is None else slot[0] + slot[1]


def _authored(obj: dict[str, Any]) -> bool:
    """Was this beat CHOSEN — by the plan, or by the glass planner — rather than derived here?

    ``board.naming.keep_time`` records the word a name falls on and stamps ``words`` with it. A
    beat without that stamp came from somebody who meant it, and is placed exactly as written.
    """
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else {}):
        beat = holder.get("beat") if isinstance(holder, dict) else None
        if isinstance(beat, dict) and (
            isinstance(beat.get("with"), int) or isinstance(beat.get("after"), int)
        ):
            return not isinstance(beat.get("words"), int)
    return False


def _sentence_index_of(obj: dict[str, Any], clock: list[tuple[int, int]]) -> int | None:
    """WHICH sentence this object keeps time with, or None when it keeps time with none."""
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else {}):
        beat = holder.get("beat") if isinstance(holder, dict) else None
        if not isinstance(beat, dict) or not clock:
            continue
        for key in ("with", "after"):
            if isinstance(beat.get(key), int) and not isinstance(beat.get(key), bool):
                return max(0, min(len(clock) - 1, beat[key]))
    return None


def _sentence_of(obj: dict[str, Any], clock: list[tuple[int, int]]) -> tuple[int, int] | None:
    """The window of the sentence this object keeps time with, or None when it keeps time with
    none of them."""
    for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else {}):
        beat = holder.get("beat") if isinstance(holder, dict) else None
        if not isinstance(beat, dict) or not clock:
            continue
        for key in ("with", "after"):
            if isinstance(beat.get(key), int):
                return clock[max(0, min(len(clock) - 1, beat[key]))]
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
    durations = [
        max(MIN_INK_MS, min(MAX_INK_MS, int((o.get("t") or {}).get("dur") or DEFAULT_INK_MS)))
        for o in objects
    ]
    origin = min(starts)
    first_end = (clock[0][0] + clock[0][1]) if clock else INK_LEAD_MS + 1
    lead = min(INK_LEAD_MS, max(0, first_end - 1))
    spoken = (clock[-1][0] + clock[-1][1]) if clock else 0

    slots: list[tuple[int, int] | None] = [_beat_slot(o, clock) for o in objects]
    free = [i for i, slot in enumerate(slots) if slot is None]
    if not clock or not free:
        pass
    elif all(slot is None for slot in slots):
        # Nothing on this board is named by a sentence, so there is no word to keep time with.
        # The hand draws through the utterance, evenly, at a hand's pace.
        span = max(0, spoken - lead)
        step = span / len(free) if span > 0 else 0.0
        for place, index in enumerate(free):
            start = lead + int(round(place * step))
            slots[index] = (start, min(MAX_INK_MS, max(durations[index], int(round(step)))))
    else:
        # THE FREE INK FILLS THE GAPS BETWEEN THE BEATS, IN DRAWING ORDER. A construction stroke
        # is not named by anything — the triangle's two legs, a leader, a pointer — so it belongs
        # in the space before the first thing that IS named, and between one named thing and the
        # next. Spreading it across the whole utterance instead is what made the board a
        # slideshow, and what drew the figure after the labels hanging off it.
        for run_start, run_end in _runs(slots):
            window_start = lead if run_start == 0 else _end_of(slots[run_start - 1])
            after = slots[run_end] if run_end < len(slots) else None
            window_end = after[0] if after is not None else spoken
            count = run_end - run_start
            room = max(0, window_end - window_start)
            step = room / count if room > 0 else 0.0
            for place in range(count):
                index = run_start + place
                start = window_start + int(round(place * step))
                slots[index] = (start, min(durations[index], max(MIN_INK_MS, int(round(step)))))

    for index in free:
        if slots[index] is None:
            slots[index] = (lead + (starts[index] - origin), durations[index])

    out = [slot for slot in slots if slot is not None]
    # DRAWING ORDER IS THE PEN'S ORDER. A beat says which word a mark keeps time with; it never
    # says the label may be drawn before the thing it labels. One forward pass over the ink this
    # module placed — a stroke is delayed rather than moved off its sentence, and never pushed
    # past that sentence's own full stop.
    #
    # A beat the PLAN wrote is not touched by it. `{"with": n}`, `{"after": n}` and `lag` are
    # choreography somebody chose, two marks may legitimately land on one beat, and the cursor
    # only reads past them (:func:`_authored`).
    cursor = lead
    opened: set[int] = set()
    for index, (start, dur) in enumerate(out):
        if _authored(objects[index]):
            cursor = max(cursor, start + dur)
            continue
        begin = max(start, cursor)
        window = _sentence_of(objects[index], clock)
        which = _sentence_index_of(objects[index], clock)
        if window is not None and which is not None and which not in opened:
            # THE FIRST MARK OF A SENTENCE LANDS AS THE SENTENCE BEGINS (INK-FREEZE §3, Trace:
            # "the first stroke of a sentence starts within 150 ms of its first word or ahead of
            # it"). The word inside the sentence orders the marks AFTER it; applying it to the
            # first one puts the pen down mid-sentence and nothing on the board before then. The
            # graph is beaten entirely to one sentence whose first name falls on word four, so
            # its first stroke landed at 1 194 ms — past BOARD.md §10's one second before the
            # brain's own time is added (measured 2026-09-10).
            opened.add(which)
            begin = max(cursor, lead, window[0])
        elif window is not None:
            # Inside its own sentence where it fits. THE CURSOR STILL WINS: a label pulled back
            # behind the leader it hangs off paints nothing at all (BOARD.md §4, a reference
            # always points backwards; measured on the plant cell at 1440, 2026-09-09). Late is a
            # blemish; before the thing it is about is not a mark.
            begin = max(cursor, min(begin, max(start, window[0] + window[1] - dur)))
        out[index] = (begin, dur)
        cursor = begin + dur
    # The law, enforced rather than assumed: something is on the board before Wobo finishes the
    # first sentence, whatever the plan or the beats asked for. Only the EARLIEST stroke is pulled
    # forward — shifting the whole plan would drag every other mark off the word it belongs to,
    # and the choreography is the point of the beats. It is pulled forward only if it hangs off
    # NOTHING: a mark dragged in front of its own anchor is not an early mark, it is a lost one.
    if out and min(start for start, _ in out) >= first_end:
        loose = [
            i
            for i in range(len(out))
            if not any(
                other in {str(o.get("id")) for o in objects}
                for other in naming.anchor_ids(objects[i])
            )
        ]
        if loose:
            first = min(loose, key=lambda i: out[i][0])
            out[first] = (lead, out[first][1])
    return _after_their_anchors(objects, out)


def _after_their_anchors(
    objects: list[dict[str, Any]], slots: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """A MARK NEVER STARTS BEFORE THE THING IT HANGS OFF HAS FINISHED.

    BOARD.md §3: an anchor is resolved from the anchored object's real box. A label that starts on
    the frame its leader begins is a label hung off a box one point wide, and one that starts
    BEFORE it is hung off nothing at all — ``renderer.tsx`` resolves the anchor to null, caches the
    empty geometry under a signature that can never change, and the mark is lost for good rather
    than merely late (the adversary, wave 42, finding (a)). The plant cell rendered three labels
    for a five-label ask, with two arrows pointing at empty space.

    So the last word on the clock is this: every dependent is pushed to the end of what it hangs
    off, relaxed to a fixed point because a plan may anchor forwards as well as back. It only ever
    delays a mark. Late is a blemish; before the thing it is about is not a mark.
    """
    if not slots:
        return slots
    index_of = {str(o.get("id")): i for i, o in enumerate(objects) if o.get("id")}
    out = list(slots)
    for _ in range(len(out) + 1):
        moved = False
        for i, obj in enumerate(objects):
            for other in naming.anchor_ids(obj):
                j = index_of.get(other)
                if j is None or j == i:
                    continue
                end = out[j][0] + out[j][1]
                if out[i][0] < end:
                    out[i] = (end, out[i][1])
                    moved = True
        if not moved:
            break
    return out


def _board_ids(on_board: Iterable[Any]) -> list[str]:
    """The ids of everything already on the glass, however the caller named it.

    Two shapes reach ``on_board`` and both are ids as far as anchoring is concerned: a bare string
    (``board.drawn`` from the client, ``scaffold.ids()`` from phase one) and a whole mark the
    client laid for THIS ask (:func:`_standing`).
    """
    out: list[str] = []
    for entry in on_board:
        if isinstance(entry, dict):
            if entry.get("id"):
                out.append(str(entry["id"]))
        elif isinstance(entry, str) and entry:
            out.append(entry)
    return out


def _standing(on_board: Iterable[Any]) -> list[dict[str, Any]]:
    """THE MARKS THE CLIENT PUT ON THE GLASS FOR THIS ASK, in the client's own words.

    The instant mark (docs/INK-FOUR.md, "the one thing we do not have"): the learner's question
    named something the glass map declares, so ``apps/web-pwa/src/wobo/instant.ts`` resolves the
    target with no model call and the pen starts inside 200 ms, while the request is still in
    flight. The client reports what it laid at ``board.standing``, and this is where the brain
    reads it.

    Only a WHOLE mark counts. An id on its own (``board.drawn``, the scaffold's first phase) is
    the older contract and stays exactly as it was: it anchors a mark, and it is never narrated,
    because the sentence naming it was spoken on the turn — or the phase — that drew it. A mark
    handed up here is one this turn owes words to and has not spoken yet.

    IT IS REBUILT, NEVER TAKEN AS SENT. This is the only thing on the wire that a client writes
    and Wobo then SAYS, so it is read the way the plan grammar reads the model: four marks at
    most, one of the kinds a mark can be, an id and a target of a sane length, and words that are
    words. Nothing else survives the read — a field this pass does not name cannot reach the say,
    the ledger or the ink.
    """
    out: list[dict[str, Any]] = []
    for entry in on_board:
        if len(out) >= MAX_STANDING or not isinstance(entry, dict):
            continue
        mark_id = str(entry.get("id") or "")[:64]
        kind = str(entry.get("kind") or "")
        if not mark_id or kind not in naming.MARK_KINDS:
            continue
        anchor = entry.get("anchor")
        target = str((anchor or {}).get("target") or "")[:120] if isinstance(anchor, dict) else ""
        mark: dict[str, Any] = {"id": mark_id, "kind": kind}
        if target:
            mark["anchor"] = {"target": target}
        words = str(entry.get("words") or "").strip()[:MAX_STANDING_WORDS]
        if words:
            mark["words"] = words
        out.append(mark)
    return out


def _spoken_first(standing: list[dict[str, Any]], line: str) -> list[str]:
    """A sentence for every mark already on the glass that the line never names — AT THE FRONT.

    A standing mark is the turn's FIRST ink: it was down before the request left, and the model's
    own mark may move it (``board-turn.ts``, "the ONE ring moves there and goes again from the new
    box, the way a teacher corrects a stroke"). Measured live at 1440 on "circle the hypotenuse":
    the ring lands on the square on the hypotenuse at 155 ms and moves to the right angle at
    4 567 ms. A sentence about the square spoken third is spoken over a ring that has already
    moved, which is the word/ink contradiction read from the other side. So it keeps time with the
    first sentence, which is where the ink actually is.
    """
    out: list[str] = []
    for obj in standing:
        subject = naming.mark_subject(obj)
        if not subject or naming.names(line, subject):
            continue
        if any(naming.names(said, subject) for said in out):
            continue
        sentence = naming.in_register(subject)
        if sentence:
            out.append(sentence)
    return out


def _shift_beats(objects: list[dict[str, Any]], by: int) -> None:
    """Move every beat on by ``by`` sentences, in place, because that many went in ahead of them.

    ``naming.rebeat_after_dropping`` is the same rule for sentences that GO; this is the rule for
    sentences that arrive. Without it a mark the plan beat to its own first sentence keeps time
    with a sentence about something else entirely.
    """
    if by <= 0:
        return
    for obj in objects:
        for holder in (obj, obj.get("meta") if isinstance(obj.get("meta"), dict) else None):
            beat = holder.get("beat") if isinstance(holder, dict) else None
            if not isinstance(beat, dict):
                continue
            for key in ("with", "after"):
                index = beat.get(key)
                if isinstance(index, int) and not isinstance(index, bool):
                    beat[key] = index + by


def _on_the_wire(
    objects: list[dict[str, Any]], on_board: Iterable[Any] = ()
) -> tuple[list[dict[str, Any]], list[str]]:
    """The objects that may be drawn, and one refusal for each that may not.

    A mark hung off an id that is nowhere points at empty space, and the client cannot tell the
    difference between "not yet" and "never" — ``renderer.tsx`` resolves the anchor once, caches
    the emptiness under a signature that can never change, and the mark is gone for good.
    ``planner._resolve_anchors`` already refuses a MARK whose anchor is missing and re-anchors a
    shape to board space; nothing caught a mark hung off a mark that the planner then refused, or
    off an object that never existed. A dangling chain goes down whole: if the leader is refused,
    so is the label on the end of it.

    ``on_board`` is what the learner is already looking at — the marks of an earlier turn, or of
    the scaffold's own first phase. A mark may hang off those, and does: that is how the model's
    half of a two-phase turn points at the figure the scaffold drew.
    """
    kept: list[dict[str, Any]] = []
    refused: list[str] = []
    alive = {str(o.get("id")) for o in objects if isinstance(o, dict) and o.get("id")}
    alive |= set(_board_ids(on_board))
    for _ in range(len(objects) + 1):
        gone = {
            str(o.get("id"))
            for o in objects
            if isinstance(o, dict)
            and str(o.get("id")) in alive
            and any(a not in alive for a in naming.anchor_ids(o))
        }
        if not gone:
            break
        alive -= gone
    for obj in objects:
        if not isinstance(obj, dict):
            continue
        if str(obj.get("id")) in alive:
            kept.append(obj)
            continue
        missing = [a for a in naming.anchor_ids(obj) if a not in alive]
        hangs_off = repr(missing[0]) if missing else "nothing"
        refused.append(
            f"{obj.get('kind', 'mark')} {obj.get('id', '?')} was not drawn: it hangs off "
            f"{hangs_off}, which is not on this board"
        )
    return kept, refused


def _signed(plan: Plan, drawn: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """The checks this turn may sign, and one refusal for each it may not.

    INK-FOUR, correctness at 4: *"Nothing carries ``verified`` unless a check ran and passed."*
    The ``done`` frame listed every check the ledger held — including the ones that came back
    FALSE, because ``planner._run_intents`` records a refused draft's failed checks so the refusal
    can be explained. The keyless plant cell therefore signed ``board.fact_supported`` verified on
    every run while that check had failed (measured 2026-09-10). And a check is signed FOR a
    thing: ``board.in_bounds:year 1922`` belongs to one number on the timeline, so if that number
    never reaches the wire the signature goes with it. A check no object stands on — a fact about
    the ask, or about the board as a whole — is signed for the board and stays signed.

    AND ONE NAME IS THE WHOLE SIGNATURE, SO ONE FAILURE UNSIGNS IT. Most check names carry no
    subject — every cell on a board runs ``board.fact_supported``, every formula runs
    ``board.formula_readable`` — and two intents of the same family on one board is an ordinary
    ask ("draw a plant cell and an animal cell"). Where one comes back True and the other False,
    signing the name off the back of the one that passed tells the learner the board's facts are
    verified while the other half's labels stand on the glass unsupported, and nothing in the
    frame says which half was meant. So a name that failed ANYWHERE in this turn is signed
    nowhere: it is refused once, with its reason.
    """
    claimed = {str(o["check"]) for o in plan.objects if isinstance(o, dict) and o.get("check")}
    standing = {str(o["check"]) for o in drawn if o.get("check")}
    fell = {str(c.name) for c in plan.ledger.checks if not c.passed}
    verified: list[str] = []
    refused: list[str] = []
    for check in plan.ledger.checks:
        if not check.passed:
            refused.append(
                f"not verified: {check.name} ran and did not pass"
                + (f" ({check.detail})" if check.detail else "")
            )
            continue
        if check.name in fell:
            continue
        if check.name in claimed and check.name not in standing:
            refused.append(
                f"not verified: {check.name} was signed for a mark that is not on the board"
            )
            continue
        if check.name not in verified:
            verified.append(check.name)
    return verified, refused


def _stamp_free_beats(
    objects: list[dict[str, Any]],
    paced: list[tuple[int, int]],
    parts: list[str],
    clock: list[tuple[int, int]],
) -> None:
    """NOTHING REACHES THE WIRE WITHOUT A SENTENCE TO KEEP TIME WITH.

    The beat is the CLIENT's clock, not this module's: ``apps/web-pwa/src/wobo/beat.ts`` holds
    every ink frame until the voice reaches the sentence its beat names, and a frame with NO beat
    falls back to ``planned - 1`` — the last sentence queued so far, which on a fast wire is the
    LAST sentence of the turn. A board nothing names (the number line, the circuit) therefore had
    its whole figure waiting on Wobo's final full stop, and a board only PARTLY named had its
    construction strokes waiting there while its labels went down first, which is how the plant
    cell lost three of five labels for good (the adversary, wave 42, findings (a) and (b)).

    ``board.naming.settle_beats`` beats everything a sentence names, and everything hanging off
    it. This is the remainder: a mark the words never touch keeps time with the sentence the hand
    is already drawing it under. It changes no timing — the schedule is settled by now — it only
    tells the client the truth about it, and the sentence it names is never later than the one the
    client would have guessed.
    """
    if not clock or not parts:
        return
    for obj, (start, _dur) in zip(objects, paced, strict=True):
        if _sentence_index_of(obj, clock) is not None:
            continue
        index = 0
        for i, (begin, _length) in enumerate(clock):
            if start >= begin:
                index = i
        begin, length = clock[index]
        words = max(1, len(parts[index].split()))
        word = 0 if length <= 0 else max(0, min(words - 1, int(words * (start - begin) / length)))
        meta = obj.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            obj["meta"] = meta
        meta["beat"] = {"with": index, "word": word, "words": words}


def build_events(
    plan: Plan,
    *,
    actions: list[dict[str, Any]] | None = None,
    card: dict[str, Any] | None = None,
    on_board: Iterable[Any] = (),
    accent: str | None = None,
) -> list[Event]:
    """The whole turn as an ordered, timestamped event list (BOARD.md §4).

    Ordered by timestamp, so the hand can play it straight through, and ``done`` is always last.

    THE SAY NAMES WHAT IT DRAWS. This is the one place a turn's words and its ink are both in hand,
    so it is where the law is kept (``board/naming.py``): every drawn mark the say never named gets
    a sentence from its own words, every beat after an inserted sentence moves with it, and a line
    that came back as machinery rather than words is not spoken at all.

    AND NOTHING IS SPOKEN OR SIGNED THAT WAS NOT DRAWN. The say and the ledger used to be built
    from the PLAN; this is the wire, so it is where both are reconciled against what actually goes
    out on it — a mark hung off nothing does not go, the sentence about it is not spoken, and no
    check is signed for it (the adversary, wave 42, finding (b)).

    AND NOTHING STANDS ON THE GLASS UNSPOKEN, which is the same law read the other way round. The
    plan is not the only thing that draws: the client resolves what the learner named from the
    glass map and puts the pen down inside 200 ms, with no model call at all (docs/INK-FOUR.md,
    the instant mark). Live at 1440 "circle the hypotenuse" rang the square on the hypotenuse at
    158 ms, the model came back with nothing to draw, both of its sentences were refused for want
    of a mark — the refusal reads the model's own empty plan and never saw the ring — and the
    turn went out with a ring standing on the glass and not one word about it. So the marks the
    client laid for THIS ask (``board.standing``) are named here exactly as the plan's own are:
    they are the board too. They are spoken, never re-streamed; the glass already has them.
    """
    # On COPIES. A cached plan may be built twice (``board.scaffold`` streams a turn in two
    # phases), and a pass that moved a beat on the caller's own objects would move it again.
    planned = [copy.deepcopy(o) for o in plan.objects if isinstance(o, dict)]
    on_wire, unmade = _on_the_wire(planned, on_board)
    kept = {id(o) for o in on_wire}
    # The glass is the plan's ink PLUS what the client already put down for this ask. Both halves
    # are what the learner is looking at, so both are what the say is reconciled against.
    #
    # THE PLAN'S MARK IS THE SAME MARK. When the model rings what the client already ringed, the
    # client swallows the second frame and one ring stands (``board-turn.ts``, "the model refines,
    # it does not gate"). So the standing copy stands down here too, or the say would name the one
    # ring twice, once in the plan's words and once in the client's.
    on_wire_ids = {str(w.get("id")) for w in on_wire}
    on_wire_targets = {
        str(a["target"])
        for w in on_wire
        if isinstance(a := w.get("anchor"), dict) and isinstance(a.get("target"), str)
    }
    standing = [
        o
        for o in _standing(on_board)
        if str(o.get("id")) not in on_wire_ids
        and str((o.get("anchor") or {}).get("target") or "") not in on_wire_targets
    ]
    glass = [*on_wire, *standing]
    line, cut = naming.only_what_is_drawn(
        plan.say, glass, [o for o in planned if id(o) not in kept]
    )
    if cut:
        naming.rebeat_after_dropping(on_wire, cut, len(sentences(plan.say)))
    opening = _spoken_first(standing, line)
    if opening:
        _shift_beats([*on_wire, *standing], len(opening))
        line = " ".join([*opening, line]).strip()
    said, named = naming.name_what_is_drawn(
        line,
        glass,
        ask=str((plan.ask or {}).get("prompt") or "") or None,
    )
    # A standing mark is spoken, not drawn again: it has been on the glass since before the
    # request left, and a second ring beside the first is not a correction, it is a mess.
    already = {str(o.get("id")) for o in standing}
    objects = [o for o in named if str(o.get("id")) not in already]
    parts = sentences(said)
    # AND THE VOICE IS TOLD WHAT IS COMING. These are the exact sentences the client will ask to
    # be spoken, one paid round trip each, in this order — and the last thing it speaks is the
    # ``ask``, as a question. Nowhere else knows the wire's own list (the naming law above adds
    # sentences and drops them), so this is where the voice is told, and it buys the sentences
    # behind the one being read while it is being read (``voice.buy_line_ahead``). Never raises:
    # a turn is a turn whether or not anything is ever read aloud.
    try:
        from wobo_gateway import voice

        voice.remember_parts(
            parts, ask=str((plan.ask or {}).get("prompt") or "") or None, accent=accent
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("the voice was not told the line (%s: %s)", type(exc).__name__, exc)
    clock = sentence_clock(parts)
    paced = _ink_clock(objects, clock)

    _stamp_free_beats(objects, paced, parts, clock)

    staged: list[tuple[int, int, str, dict[str, Any]]] = []
    for order, (part, (start, duration)) in enumerate(zip(parts, clock, strict=True)):
        staged.append((start, order, "say", {"text": part, "dur": duration}))
    for order, (obj, (start, dur)) in enumerate(zip(objects, paced, strict=True)):
        laid = {**obj, "t": {"start": start, "dur": dur}}
        staged.append((start, 1000 + order, "ink", {"object": laid}))

    verified, unsigned = _signed(plan, objects)
    refused = [*plan.refusals, *unmade, *unsigned]
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
                # What went out, not what was planned: the two differ exactly when something was
                # refused, which is the moment the count matters.
                "objects": len(objects),
                "verified": verified,
                **({"refused": refused} if refused else {}),
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


def iter_sse(
    turn: Turn, *, after: int = -1, then: Callable[[Turn], None] | None = None
) -> Iterator[str]:
    """The turn as an SSE body, from the event after ``after``.

    A comment frame goes first so a proxy flushes headers immediately — that is the difference
    between the pen starting in a second and the pen starting when the whole plan is done.

    ``then`` is the second phase of a turn whose drawing was resolved without the model
    (``board.scaffold``): everything already planned goes out FIRST, and only then is the model
    asked, its frames appended to this same turn and streamed on. The learner sees the figure
    while the model is still reading the question, which is the whole of docs/INK-FOUR.md's
    Timing at 4. It is skipped for a learner who has already stopped Wobo: a turn nobody is
    waiting for does not go on to spend a model call.

    The interrupt is checked BETWEEN frames rather than once at the top: the learner stops Wobo
    while the turn is on the wire, not before it starts. The first frame after the interrupt is
    the acknowledgement, and the body ends there — no ``done``, because the turn did not finish.
    """
    yield ": open\n\n"
    last_seq, last_t = after, 0
    phases = 0
    while True:
        for event in turn.after(last_seq):
            if turn.interrupted:
                yield frame(turn.id, acknowledgement(turn, max(last_seq, 0), last_t))
                return
            last_seq, last_t = event.seq, event.t
            yield frame(turn.id, event)
        phases += 1
        if then is None or phases > 1 or turn.interrupted:
            break
        then(turn)
    if turn.interrupted:
        # Interrupted after the last frame was written: still acknowledged, so the learner's stop
        # is never silently swallowed by a turn that happened to be nearly over.
        yield frame(turn.id, acknowledgement(turn, max(last_seq, 0), last_t))


def as_json(turn: Turn) -> dict[str, Any]:
    """The same turn for a client that did not ask for a stream — one JSON body, same order."""
    return {"turn": turn.id, "events": [e.payload() for e in turn.events]}
