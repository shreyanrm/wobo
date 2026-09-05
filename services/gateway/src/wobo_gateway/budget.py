"""The free tier, metered in the brain — the only place a limit is allowed to live.

Wobo is free by default. "Free" is a number, and the client must never hold it: the client
asks, the brain counts. Two counters per subject per UTC day — turns (the conversational
surface) and generations (the heavy composition surface) — with dials from the environment
so the owner can move them without a deploy of the client.

Classification is one dict, longest prefix wins, and anything unrecognised counts as a turn
rather than counting as nothing: a capability added tomorrow is metered the day it ships.

ponytail: the store is an in-process dict, so the ceiling is ONE gateway instance — two
Railway replicas would each grant a full day's budget. The upgrade path is Redis behind
:func:`charge`/:func:`refund`/:func:`snapshot`; no caller changes.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

TURN = "turn"
GENERATION = "generation"

# One dict, longest matching prefix wins. Generations are the expensive half: a whole lesson,
# a video, a podcast. Turns are the cheap, frequent half.
CAPABILITY_CLASS: dict[str, str] = {
    "engine.": GENERATION,
    "compose": GENERATION,
    "video": GENERATION,
    "podcast": GENERATION,
    "generate.course": GENERATION,
    "generate.digest": GENERATION,
    "voice.tts": TURN,
    "voice.session": TURN,
    "wobo.turn": TURN,
    # A board turn is a turn. It streams instead of returning one body, and it plans on the
    # generate tier rather than the turn tier, but the learner asked one question and gets
    # one answer — so it draws on the same counter, never on the generation counter (BOARD.md
    # §10). The streaming route rides "wobo.turn" itself; this entry is here so an internal
    # caller that names the plan step by its own name is metered rather than served free.
    "wobo.board": TURN,
    "vidya.turn": TURN,  # legacy alias, in case it is classified before canonicalisation
    "tutor.turn": TURN,
    # The curriculum registry (CURRICULUM.md §8). Reads of our own database, not model calls, so
    # they belong on the cheap counter — but they are still counted, because "free" is a number
    # the brain owns and an uncounted route is a way around it. Longest prefix wins, so one entry
    # covers curriculum.search, .units, .overlay.apply and everything added after them.
    "curriculum.": TURN,
    # …except discovery, which is the expensive half of the curriculum: a search, a document
    # fetch, an extraction on the generate tier and a re-reading on the verify tier, for one
    # learner who typed a board we had never heard of (CURRICULUM.md §4). Longer prefix, so it
    # wins over "curriculum." above and the whole job is metered as one generation.
    "curriculum.discovery": GENERATION,
    # …and except the own-syllabus intake, for the same reason: a learner's photo or PDF is read
    # and structured on the generate tier, which is a generation whoever asked for it. The three
    # taps that follow it — confirm, publish, offer — only move an object they already own, so
    # they stay on the cheap counter above.
    "curriculum.own.read": GENERATION,
    # The doubt solver (doubt.py). Reading a photograph is a vision call on the generate tier,
    # which is a generation whoever asked for it; the screen before it is a tiny-tier verdict,
    # and the answer that follows rides the board turn on "wobo.turn" and is metered there.
    "doubt.": TURN,
    "doubt.read": GENERATION,
    "grade.attempt": TURN,
    "generate.opener": TURN,
    "verify.math": TURN,
}

_PREFIXES: tuple[tuple[str, str], ...] = tuple(
    sorted(CAPABILITY_CLASS.items(), key=lambda item: len(item[0]), reverse=True)
)

# A plan buys MORE OF THE SAME TUTOR and nothing else (owner, 2026-09-04). There is no
# capability anywhere in this file, and there must never be one: every learner on every plan
# gets every capability, and a subscription covers exactly one learner. The only thing a plan
# changes is how many times a day they can ask.
_FREE_TURNS, _FREE_GENERATIONS = 40, 8
_MULTIPLIER: dict[str, int] = {"free": 1, "pro": 5, "max": 20}

_DIALS: dict[tuple[str, str], tuple[str, int]] = {
    # (plan, class) -> (env var, default)
    ("free", TURN): ("FREE_DAILY_TURNS", _FREE_TURNS),
    ("free", GENERATION): ("FREE_DAILY_GENERATIONS", _FREE_GENERATIONS),
    ("anon", TURN): ("ANON_DAILY_TURNS", 6),
    ("anon", GENERATION): ("ANON_DAILY_GENERATIONS", 1),
    # The priced plans are the free allowance multiplied, and nothing else.
    ("pro", TURN): ("PRO_DAILY_TURNS", _FREE_TURNS * _MULTIPLIER["pro"]),
    ("pro", GENERATION): ("PRO_DAILY_GENERATIONS", _FREE_GENERATIONS * _MULTIPLIER["pro"]),
    ("max", TURN): ("MAX_DAILY_TURNS", _FREE_TURNS * _MULTIPLIER["max"]),
    ("max", GENERATION): ("MAX_DAILY_GENERATIONS", _FREE_GENERATIONS * _MULTIPLIER["max"]),
    # ``plus`` is the name the first paid tier shipped under; it resolves to pro so an
    # existing subscriber's plan string keeps working.
    ("plus", TURN): ("PLUS_DAILY_TURNS", _FREE_TURNS * _MULTIPLIER["pro"]),
    ("plus", GENERATION): ("PLUS_DAILY_GENERATIONS", _FREE_GENERATIONS * _MULTIPLIER["pro"]),
}

_STORE_MAX = 20_000
_used: dict[tuple[str, str], dict[str, int]] = {}
# Check-and-increment is one operation or it is not a limit. Every route in the gateway is a
# plain ``def``, so FastAPI runs them on a threadpool and two calls genuinely interleave here;
# today the GIL closes the window at this instruction count, and the Redis upgrade this module's
# header names would open it wide. One lock, the same reason InMemoryCache holds one.
_lock = threading.Lock()


class BudgetExhausted(Exception):
    """Today's free allowance is spent. Wobo-voiced; no price is ever named here."""

    def __init__(self, kind: str, reset_at: datetime) -> None:
        self.kind = kind
        self.reset_at = reset_at
        self.message = (
            "That is all the lessons I can build for you today. I will be ready again tomorrow."
            if kind == GENERATION
            else "We have talked a lot today. I will be right here again tomorrow."
        )
        super().__init__(self.message)

    def body(self) -> dict[str, str]:
        return {"code": "budget_exhausted", "message": self.message}


@dataclass(frozen=True)
class Snapshot:
    turns_remaining: int
    generations_remaining: int
    reset_at: datetime

    def remaining(self, kind: str) -> int:
        return self.generations_remaining if kind == GENERATION else self.turns_remaining

    def as_dict(self) -> dict[str, object]:
        return {
            "turns_remaining": self.turns_remaining,
            "generations_remaining": self.generations_remaining,
            "reset_at": self.reset_at.isoformat(),
        }


def classify(capability: str) -> str:
    """Which counter this capability draws on. Unknown names are metered as turns, not free."""
    for prefix, kind in _PREFIXES:
        if capability.startswith(prefix):
            return kind
    return TURN


def _dial(plan: str, kind: str) -> int:
    name, default = _DIALS[(plan, kind)]
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def resolve_plan(plan: str = "free", *, anonymous: bool = False) -> str:
    """The dial set a plan name ACTUALLY lands on. Never a guess, and never silent.

    An unknown plan name falls to free, which is the right call for a learner — a billing bug
    should cost them questions rather than hand out an allowance nobody paid for — but it is the
    wrong thing to keep quiet about anywhere else. The console asks "what does a 1x day on the
    ``plus`` plan cost", and the answer used to be computed from the FREE dials and labelled
    "plus", because the route echoed the string it was handed. Whoever reads it can now be told
    which set of numbers the figure was actually built from.
    """
    if anonymous:
        return "anon"
    name = (plan or "free").strip().lower()
    return name if (name, TURN) in _DIALS else "free"


def limits_for(plan: str = "free", *, anonymous: bool = False) -> dict[str, int]:
    """The day's allowance, and the ONLY thing a plan changes.

    Anonymous readers get the small one whatever the plan says. An unknown plan name falls to
    free rather than to a guess (:func:`resolve_plan`, which says which set was used).
    """
    key = resolve_plan(plan, anonymous=anonymous)
    return {TURN: _dial(key, TURN), GENERATION: _dial(key, GENERATION)}


def reset_at(now: datetime | None = None) -> datetime:
    """The next UTC midnight — when both counters go back to full."""
    moment = now or datetime.now(UTC)
    return (moment + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def _bucket(subject: str, *, now: datetime | None = None) -> dict[str, int]:
    day = (now or datetime.now(UTC)).strftime("%Y-%m-%d")
    key = (subject, day)
    bucket = _used.get(key)
    if bucket is None:
        if len(_used) >= _STORE_MAX:  # ponytail: drop yesterday before growing further
            for stale in [k for k in _used if k[1] != day]:
                del _used[stale]
            if len(_used) >= _STORE_MAX:
                _used.clear()
        bucket = {TURN: 0, GENERATION: 0}
        _used[key] = bucket
    return bucket


def _snapshot_locked(bucket: dict[str, int], limits: dict[str, int]) -> Snapshot:
    return Snapshot(
        turns_remaining=max(0, limits[TURN] - bucket[TURN]),
        generations_remaining=max(0, limits[GENERATION] - bucket[GENERATION]),
        reset_at=reset_at(),
    )


def snapshot(subject: str, plan: str = "free", *, anonymous: bool = False) -> Snapshot:
    limits = limits_for(plan, anonymous=anonymous)
    with _lock:
        return _snapshot_locked(_bucket(subject), limits)


def charge(
    subject: str, capability: str, plan: str = "free", *, anonymous: bool = False
) -> Snapshot:
    """Count one call before it is served. Raises :class:`BudgetExhausted` when the day is spent.

    ``subject`` is the METER KEY the door derived (:func:`app.meter_key`), not necessarily a
    Supabase subject: an anonymous learner is counted per device address, because a fresh
    anonymous subject is one public HTTP call away and a counter you can mint your way out of
    is arithmetic, not a limit."""
    kind = classify(capability)
    limits = limits_for(plan, anonymous=anonymous)
    with _lock:  # read, compare and increment are one operation or they are not a limit
        bucket = _bucket(subject)
        if bucket[kind] >= limits[kind]:
            raise BudgetExhausted(kind, reset_at())
        bucket[kind] += 1
        return _snapshot_locked(bucket, limits)


def refund(subject: str, capability: str) -> None:
    """Give the call back — it failed before it reached a model, so it cost the learner nothing."""
    kind = classify(capability)
    with _lock:
        bucket = _bucket(subject)
        bucket[kind] = max(0, bucket[kind] - 1)


def headers(snap: Snapshot, kind: str) -> dict[str, str]:
    """What the client reads to show "you have some left" without ever knowing the limit."""
    return {
        "X-Wobo-Budget-Remaining": str(snap.remaining(kind)),
        "X-Wobo-Budget-Reset": snap.reset_at.isoformat(),
    }


def reset() -> None:
    """Test seam — clear every counter."""
    with _lock:
        _used.clear()
