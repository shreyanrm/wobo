"""Wobo's mind, held in the database against the account (docs/MEMORY-LAW.md).

The law, in one line: **the database is the record, the account is the key, everything else is a
cache.** The mind was the one thing that never obeyed it. ``apps/web-pwa/src/store/mind.ts`` said
so in its own comment — *"localStorage until the mind syncs through KGtoPG"* — and the sync was
never built, so the most personal thing in the product was the least portable. A learner signing
in on a second device got a Wobo that had forgotten who they were. This module is that sync.

What the mind holds, and it holds no more than it held before this wave moved it:

* **The learner's own words** — ``interests`` (what they told onboarding they are into) and
  ``facts`` (durable details Wobo was told in conversation). Both are shown on the memory page
  and both are removable one at a time.
* **What Wobo watched** — ``latencies_ms`` (a rolling sample of answer times, consumed only as a
  median), ``slips`` (recent wrong answers), ``dwell_sec`` (seconds per surface), ``session_days``
  (cadence), ``days`` (one ledger of counts per day) and ``helped_at``. Read-only on the memory
  page: these regenerate as Wobo watches, so removing one item would mean nothing.

--------------------------------------------------------------------------------------------
THE WRITE RULE, AND WHY IT IS NOT A SNAPSHOT MERGE
--------------------------------------------------------------------------------------------

The first cut of this file took a whole-snapshot ``PUT`` from each device and unioned it into the
record. That reads well and is wrong, and it is wrong in the way the memory law names: **it lets a
cache decide what the record holds.** Two failures were demonstrated, not theorised:

* At the cap, a stale device's OLD facts arrived looking new and evicted live ones. A phone left
  in a drawer for a month put its twelve facts back one sync at a time until the record was the
  drawer phone's, and "exam on friday" — learned on the laptop yesterday — was gone.
* A day's counters were merged by taking the LARGER of the two. Three answers on the laptop and
  five on the phone is eight answers, and the record said five. Every offline stretch lost work.

So the record is the truth and a write says what CHANGED, in verbs:

``mind``
    The device's whole snapshot. It **seeds** the record on the very first write — that is how the
    work a child did before signing in follows them into their account — and afterwards it only
    CONFIRMS: a fact the record does not already hold is not added by a snapshot, ever. The fields
    that are safe to fold from a snapshot on every write are the ones with identity of their own:
    ``slips`` (keyed on node, item and time), ``sessionDays`` (a set of dates), ``helpedAt`` (the
    later stamp) and ``latenciesMs`` (an unordered sample; see below).
``remember``
    The only way to ADD a fact or an interest. The client sends this when the learner actually
    tells Wobo something, and it lifts a tombstone: a learner who says the same thing again gets
    it remembered again, which is what a person expects and what a tombstone must not prevent.
``forget``
    The memory page's per-item clear. It writes a TOMBSTONE so the item cannot come back from a
    device that still holds it. The tombstone is a digest, never the text: the record must not
    keep a copy of the sentence a learner asked it to forget.
``bump``
    The counters. A device sends what happened ON IT since its last successful write and the
    server ADDS it, so three answers here and five there is eight. ``write_id`` makes that safe to
    retry: a write id already in the record is answered from the record and counted once.

``latenciesMs`` is the one field a write still replaces, and only because a latency has no
identity and no timestamp of its own: two samples cannot be unioned without counting the same
answer twice. It is safe to lose — every number in either sample is a real observation, the only
consumer is a median, and a median of one device's most recent sixty answers is a true median. An
EMPTY incoming sample never replaces a real one.

**Two writers, one loser.** Concurrent writes are settled by compare-and-set on ``updated_at``:
the write is filtered on the row it merged against, so a writer whose row moved underneath it
merges again against the new one rather than overwriting it. An insert that collides re-reads and
merges too. Three attempts, then the caller is told the truth (:class:`StoreUnavailable`).

**An erase stays erased.** Deleting the row was not enough: the next ordinary sync from any device
that still held a local snapshot re-created the whole thing, so forget-me undid itself. So an
erase leaves a MARKER — the row, emptied, carrying ``erased_at`` and nothing about the learner —
and a write stamped at or before that moment contributes nothing and is told why. The device
learns the account was erased and drops its cache. Nothing about the learner is kept in the
marker; it is a date and an id, and it is what makes the erasure true across their devices.

--------------------------------------------------------------------------------------------
WHAT IS KEPT, AND WHAT FALLS AWAY
--------------------------------------------------------------------------------------------

A mind that grows forever becomes a prompt that costs a fortune and a table nobody can read. So
every list is bounded, and every bound is a check constraint in migration 0020 as well as a cap
here — a bug on either side cannot let one row grow without limit:

* 12 facts — a rolling window, the newest kept (``wobo.py:_dossier`` clips at twelve).
* 8 interests — the FIRST eight named, which is the order onboarding wrote them in
  (``store/mind.ts`` keeps ``slice(0, 8)``); an interest offered when eight are held is not kept,
  and the write says so rather than quietly evicting one the learner chose.
* 12 slips, 60 latencies, 30 session days — the working window Wobo reasons over.
* 32 surfaces of dwell, 380 days of ledger — a year of the You screen's view, and a little over.
* 400 tombstones per kind, as digests. The old cap of 64 aged out the tombstone it existed to
  keep: sixty-four clears is a year of ordinary tidying on the memory page, and the sixty-fifth
  put the first one back.

Nothing is summarised into prose here. The twin summary has always been derived from this
snapshot at the moment a prompt is built, never stored, so it exists exactly as long as the
snapshot does and cannot drift from it.

Transport is PostgREST with the service-role key, server-side only, ``learner`` schema by header
— the same seam :mod:`wobo_gateway.memory` and :mod:`wobo_gateway.hospitality.preferences` use.
With no project configured (a local run, the suite) the mind is held in this process instead, so
the routes behave the same and the erase path still empties it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("wobo.gateway.mind")

_HTTP_TIMEOUT_S = 5.0
_SCHEMA = "learner"
TABLE = "wobo_mind"
_ID_COLUMN = "subject_id"

#: The bounds. Each one matches the client's own cap in ``store/mind.ts`` and the check
#: constraint in migration 0020 — three places, one number, and a test holds them together.
MAX_FACTS = 12
MAX_INTERESTS = 8
MAX_SLIPS = 12
MAX_LATENCIES = 60
MAX_SESSION_DAYS = 30
MAX_DWELL_SURFACES = 32
MAX_DAYS = 380
#: Tombstones, as digests. A tombstone has to outlive stragglers, not history — and a straggler
#: device is covered for exactly as many clears as this number, so it is far above a year of
#: ordinary tidying rather than a little above the number of items a mind can hold.
MAX_TOMBSTONES = 400
#: How many recent write ids the row remembers, so a retried ``bump`` counts once. A client
#: retries the write in front of it, never a hundred of them.
MAX_WRITE_IDS = 16
#: How many items one write may name in ``remember`` or ``forget``.
MAX_NAMED = 32

#: One remembered line, at the length the dossier already clips to.
MAX_TEXT = 160
#: A surface name is a route name; anything longer is not one.
MAX_SURFACE = 48
#: An answer that took longer than this was a tab left open, not a learner thinking.
MAX_LATENCY_MS = 600_000
#: A day's counter. Nothing real reaches it; it is here so a bad client cannot write a number
#: that makes the ledger unreadable.
MAX_COUNT = 100_000
#: How much one write may add to a counter. A day of real work is nowhere near it.
MAX_BUMP = 10_000
#: How far ahead of our own clock a device's stamp may be and still be believed. A mis-set time
#: zone is hours; a device claiming next year is not a clock we can order writes by.
_SKEW_GRACE = timedelta(hours=24)
#: A tombstone digest: enough bits that two different sentences never collide, short enough that
#: four hundred of them are kilobytes rather than a second copy of the mind.
_DIGEST_CHARS = 16

#: Every C0/C1 control character, including the newlines that would forge a new prompt block.
#: The client flattens on the way in and on the way out; the record flattens too, because a fact
#: written by an older build or a second client must not reach a prompt with its breaks intact.
_CONTROL_CHARS = re.compile("[\u0000-\u001f\u007f-\u009f\u2028\u2029]+")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: A subject reaches a PostgREST filter, so it is checked before it is interpolated — the same
#: rule and the same expression as :mod:`wobo_gateway.memory`.
_SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_WRITE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
_DIGEST_RE = re.compile(rf"^[0-9a-f]{{{_DIGEST_CHARS}}}$")

#: The counters one day's ledger holds. ``evening`` is separate: it is a flag, merged by OR.
_DAY_COUNTERS = ("answered", "wrong", "asked", "helped", "kept", "entered", "seconds")


class StoreUnavailable(RuntimeError):
    """The mind could not be reached, or the write could not be settled. NOTHING WAS WRITTEN.

    Never swallowed: a failed write is told to the learner (memory law rule 4), because telling
    somebody their work is saved when it is not costs them the work. This one is worth retrying —
    it is a timeout, a refused connection, a row that would not settle.
    """


class StoreRefused(RuntimeError):
    """The store answered, and the answer was no: a constraint, a missing table, a bad grant.

    Split out from :class:`StoreUnavailable` because retrying cannot fix any of them, and telling
    a learner "try again in a moment" about something that will never work is a false claim with
    a friendly face on it.
    """


# --- the shape ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Mind:
    """One learner's mind. Immutable: every operation returns a new one."""

    interests: tuple[str, ...] = ()
    facts: tuple[str, ...] = ()
    latencies_ms: tuple[int, ...] = ()
    slips: tuple[dict[str, Any], ...] = ()
    dwell_sec: dict[str, int] = field(default_factory=dict)
    session_days: tuple[str, ...] = ()
    days: dict[str, dict[str, Any]] = field(default_factory=dict)
    helped_at: str | None = None
    #: ``{"facts": [...], "interests": [...]}`` — DIGESTS of what the learner cleared, never the
    #: text. The record does not keep a copy of the sentence somebody asked it to forget.
    forgotten: dict[str, tuple[str, ...]] = field(default_factory=dict)
    #: The writing device's own stamp. Used for exactly one tie-break (the latency sample), and
    #: for telling an erased account's stale cache from a live device.
    client_updated_at: str | None = None
    #: When this account's mind was erased. Set by forget-me and cleared by nothing.
    erased_at: str | None = None
    #: The last few write ids, so a retried ``bump`` is counted once.
    recent_writes: tuple[str, ...] = ()
    #: The row's server stamp. Not part of the mind; carried so a write can compare-and-set on it.
    updated_at: str | None = field(default=None, compare=False)

    @property
    def empty(self) -> bool:
        return not (
            self.interests
            or self.facts
            or self.latencies_ms
            or self.slips
            or self.dwell_sec
            or self.session_days
            or self.days
        )

    def as_dict(self) -> dict[str, Any]:
        """The wire shape — camelCase, matching ``MindState`` in ``store/mind.ts`` exactly, so a
        client can send what it loads and render what it gets without a translation layer."""
        return {
            "interests": list(self.interests),
            "facts": list(self.facts),
            "latenciesMs": list(self.latencies_ms),
            "slips": [dict(s) for s in self.slips],
            "dwellSec": dict(self.dwell_sec),
            "sessionDays": list(self.session_days),
            "days": {day: dict(led) for day, led in self.days.items()},
            "helpedAt": self.helped_at,
        }


EMPTY = Mind()


@dataclass(frozen=True)
class Write:
    """One device's write: the snapshot it holds, and what it says CHANGED."""

    mind: Mind = EMPTY
    remember_facts: tuple[str, ...] = ()
    remember_interests: tuple[str, ...] = ()
    forget_facts: tuple[str, ...] = ()
    forget_interests: tuple[str, ...] = ()
    bump_days: dict[str, dict[str, Any]] = field(default_factory=dict)
    bump_dwell: dict[str, int] = field(default_factory=dict)
    write_id: str | None = None
    client_updated_at: str | None = None


@dataclass(frozen=True)
class Result:
    """What became of a write, and the record as it now stands."""

    mind: Mind
    applied: bool = True
    #: ``erased`` (this device is talking from a cache the learner erased) or ``duplicate``
    #: (this exact write already landed). Neither is an error and neither is a silent drop.
    ignored: str | None = None
    #: Items the record could not take — today, only interests beyond the eighth.
    dropped: tuple[str, ...] = ()


# --- cleaning what arrives ----------------------------------------------------------------------


def flatten(text: Any) -> str:
    """One line of plain data, at the dossier's own length.

    A remembered fact is learner-supplied text that then rides every future prompt, and the prompt
    is assembled as lines — so a fact carrying newlines could open what reads as a new block. Every
    break, tab and control character collapses to a single space at the one point a fact enters
    the record, so a fact stays a fact no matter what was typed.
    """
    if not isinstance(text, str):
        return ""
    flat = _CONTROL_CHARS.sub(" ", text)
    return re.sub(r"\s+", " ", flat).strip()[:MAX_TEXT].strip()


def digest(text: Any) -> str:
    """The tombstone form of one item: short, stable, and not the text.

    Case and surrounding space are folded away so "Exam on Friday " and "exam on friday" are one
    item, which is the same folding the union already did when it deduped.
    """
    flat = flatten(text).lower()
    if not flat:
        return ""
    return hashlib.sha256(flat.encode()).hexdigest()[:_DIGEST_CHARS]


def _texts(raw: Any, cap: int, *, newest: bool = True) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    seen: set[str] = set()
    # Bounded before the work, so an absurd body costs an absurd body's worth of CPU and no more.
    for item in raw[: cap * 8]:
        text = flatten(item)
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        out.append(text)
    return tuple(out[-cap:] if newest else out[:cap])


def _named(raw: Any) -> tuple[str, ...]:
    """The items one write names in ``remember`` or ``forget``. Short, flat, deduped."""
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    seen: set[str] = set()
    for item in raw[:MAX_NAMED]:
        text = flatten(item)
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        out.append(text)
    return tuple(out)


def _number(value: Any, *, ceiling: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN and the infinities
        return None
    n = int(value)
    return n if 0 <= n <= ceiling else None


def _latencies(raw: Any) -> tuple[int, ...]:
    if not isinstance(raw, list):
        return ()
    out = [n for n in (_number(v, ceiling=MAX_LATENCY_MS) for v in raw[:400]) if n]
    return tuple(out[-MAX_LATENCIES:])


def _when(value: Any) -> str | None:
    """An ISO instant, or nothing. Stored as the string it arrived as once it parses."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value[:64]


def _slips(raw: Any) -> tuple[dict[str, Any], ...]:
    if not isinstance(raw, list):
        return ()
    out: list[dict[str, Any]] = []
    for item in raw[: MAX_SLIPS * 8]:
        if not isinstance(item, dict):
            continue
        at = _when(item.get("at"))
        if at is None:
            continue  # a slip with no time cannot be ordered, deduped or aged out
        slip: dict[str, Any] = {"nodeId": flatten(item.get("nodeId"))[:64], "at": at}
        item_id = flatten(item.get("itemId"))[:64]
        if item_id:
            slip["itemId"] = item_id
        value = item.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value:
            slip["value"] = value
        out.append(slip)
    return _slip_window(out)


def _slip_key(slip: dict[str, Any]) -> tuple[str, str, str]:
    return (str(slip.get("nodeId", "")), str(slip.get("itemId", "")), str(slip.get("at", "")))


def _slip_window(slips: Iterable[dict[str, Any]]) -> tuple[dict[str, Any], ...]:
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for slip in slips:
        unique[_slip_key(slip)] = slip
    ordered = sorted(unique.values(), key=lambda s: str(s.get("at", "")))
    return tuple(ordered[-MAX_SLIPS:])


def _days_list(raw: Any, cap: int) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    days = {d for d in raw[: cap * 8] if isinstance(d, str) and _ISO_DAY.match(d)}
    return tuple(sorted(days)[-cap:])


def _dwell(raw: Any, *, ceiling: int = MAX_COUNT) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for surface, seconds in list(raw.items())[: MAX_DWELL_SURFACES * 8]:
        if not isinstance(surface, str) or not surface.strip():
            continue
        value = _number(seconds, ceiling=ceiling)
        if value:
            out[flatten(surface)[:MAX_SURFACE]] = value
    return _dwell_window(out)


def _dwell_window(dwell: dict[str, int]) -> dict[str, int]:
    """The busiest surfaces. When there are too many, the smallest go: a surface with two seconds
    on it tells nobody anything, and the ones that shape an answer are the ones held longest."""
    if len(dwell) <= MAX_DWELL_SURFACES:
        return dict(dwell)
    kept = sorted(dwell.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_DWELL_SURFACES]
    return dict(sorted(kept))


def _ledger(raw: Any, *, ceiling: int = MAX_COUNT) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {c: (_number(src.get(c), ceiling=ceiling) or 0) for c in _DAY_COUNTERS}
    out["evening"] = src.get("evening") is True
    return out


def _ledgers(raw: Any, *, ceiling: int = MAX_COUNT) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}
    days = {
        day: _ledger(value, ceiling=ceiling)
        for day, value in list(raw.items())[: MAX_DAYS * 2]
        if isinstance(day, str) and _ISO_DAY.match(day)
    }
    return _days_window(days)


def _days_window(days: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The most recent year and a little over. Dates sort as strings because they are ISO."""
    if len(days) <= MAX_DAYS:
        return dict(sorted(days.items()))
    return dict(sorted(days.items())[-MAX_DAYS:])


def _tombstones(raw: Any) -> dict[str, tuple[str, ...]]:
    """Stored tombstones, back off a row. Digests only: anything else is dropped rather than
    trusted, so a row written by an older build cannot smuggle text back in here."""
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, tuple[str, ...]] = {}
    for kind in ("facts", "interests"):
        items = src.get(kind)
        if not isinstance(items, list):
            continue
        seen: set[str] = set()
        kept: list[str] = []
        for item in items[: MAX_TOMBSTONES * 2]:
            text = str(item or "").strip().lower()
            if not _DIGEST_RE.match(text) or text in seen:
                continue
            seen.add(text)
            kept.append(text)
        if kept:
            out[kind] = tuple(kept[-MAX_TOMBSTONES:])
    return out


def _write_ids(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    out = [str(v) for v in raw[: MAX_WRITE_IDS * 2] if isinstance(v, str) and _WRITE_ID_RE.match(v)]
    return tuple(out[-MAX_WRITE_IDS:])


def normalise(raw: Any) -> Mind:
    """An incoming snapshot, bounded and cleaned. Never raises: a field that makes no sense is
    simply not in the result, because a mind is not worth refusing a whole write over."""
    src = raw if isinstance(raw, dict) else {}
    return Mind(
        # The first eight named, because that is the order onboarding wrote them in and the
        # order the client keeps (``store/mind.ts`` slices 0..8).
        interests=_texts(src.get("interests"), MAX_INTERESTS, newest=False),
        facts=_texts(src.get("facts"), MAX_FACTS),
        latencies_ms=_latencies(src.get("latenciesMs")),
        slips=_slips(src.get("slips")),
        dwell_sec=_dwell(src.get("dwellSec")),
        session_days=_days_list(src.get("sessionDays"), MAX_SESSION_DAYS),
        days=_ledgers(src.get("days")),
        helped_at=_when(src.get("helpedAt")),
    )


# --- the merge ----------------------------------------------------------------------------------


def _instant(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _later(a: str | None, b: str | None) -> str | None:
    """The later of two stamps, tolerating either being missing or unparsable."""
    pa, pb = _instant(a), _instant(b)
    if pa is None:
        return b if pb else a
    if pb is None:
        return a
    return b if pb > pa else a


def _not_ahead_of(stamp: str | None, moment: datetime) -> str | None:
    """A device's own clock, refused when it claims to be far in the future.

    One phone set a year ahead used to freeze the latency sample for the life of the account: it
    wrote 2031 into the record and every honest write afterwards lost the ``theirs >= mine``
    comparison forever, and no client could tell. Device clocks drift by minutes and sometimes,
    through a mis-set zone, by hours; a stamp more than :data:`_SKEW_GRACE` ahead of ours is not
    drift, and the server's own clock stands in for it.
    """
    parsed = _instant(stamp)
    if parsed is None:
        return None
    return stamp if parsed <= moment + _SKEW_GRACE else moment.isoformat()


def _after(stamp: str | None, floor: str | None) -> bool:
    """Is this device's stamp strictly after that moment? A missing stamp is never after."""
    a, b = _instant(stamp), _instant(floor)
    if a is None or b is None:
        return b is None
    return a > b


def _union_texts(
    stored: tuple[str, ...], incoming: tuple[str, ...], dead: tuple[str, ...], cap: int
) -> tuple[str, ...]:
    """Two lists folded into one, minus the tombstones. Used only where a union is SAFE — the
    first write, which seeds the record from the device that has been holding it."""
    buried = set(dead)
    out: list[str] = []
    seen: set[str] = set()
    for text in (*stored, *incoming):
        low = text.lower()
        if digest(low) in buried or low in seen:
            continue
        seen.add(low)
        out.append(text)
    return tuple(out[-cap:])


def _merge_tombstones(
    stored: dict[str, tuple[str, ...]], incoming: dict[str, tuple[str, ...]]
) -> dict[str, tuple[str, ...]]:
    out: dict[str, tuple[str, ...]] = {}
    for kind in ("facts", "interests"):
        joined: list[str] = []
        seen: set[str] = set()
        for text in (*stored.get(kind, ()), *incoming.get(kind, ())):
            if text in seen:
                continue
            seen.add(text)
            joined.append(text)
        if joined:
            out[kind] = tuple(joined[-MAX_TOMBSTONES:])
    return out


def _sample(stored: Mind, incoming: Mind) -> tuple[int, ...]:
    """The latency sample that survives a merge — the one field a write replaces.

    An empty incoming sample never wins: a write that carries no observations is not a write that
    erases them. Otherwise the newer snapshot's sample wins, by the writing devices' own stamps,
    which are clamped to our clock first so one skewed device cannot win forever.
    """
    if not incoming.latencies_ms:
        return stored.latencies_ms
    if not stored.latencies_ms:
        return incoming.latencies_ms
    mine, theirs = _instant(stored.client_updated_at), _instant(incoming.client_updated_at)
    if mine is not None and theirs is not None:
        return incoming.latencies_ms if theirs >= mine else stored.latencies_ms
    if theirs is not None:
        return incoming.latencies_ms
    if mine is not None:
        return stored.latencies_ms
    if len(incoming.latencies_ms) > len(stored.latencies_ms):
        return incoming.latencies_ms
    return stored.latencies_ms


def merge(stored: Mind, incoming: Mind, *, seed: bool = False) -> Mind:
    """``stored`` and ``incoming`` snapshots, folded together.

    The fields with identity of their own — slips, session days, the help stamp and the latency
    sample — fold on every write. **Facts and interests do not**: a snapshot CONFIRMS them and
    never introduces one, because a device's cache may be a month out of date and the record is
    the truth. ``seed=True`` is the one exception, and it is the first write against an account:
    there is no record yet, so the device that has been holding the mind is where it comes from.

    The counters are not here at all. They arrive as deltas (:func:`apply_write`), because taking
    the larger of two devices' counts loses every answer given while the other one was offline.
    """
    dead = _merge_tombstones(stored.forgotten, incoming.forgotten)
    if seed:
        interests = _union_texts(
            stored.interests, incoming.interests, dead.get("interests", ()), MAX_INTERESTS
        )
        facts = _union_texts(stored.facts, incoming.facts, dead.get("facts", ()), MAX_FACTS)
        days = _days_window({**stored.days, **incoming.days})
        dwell = _dwell_window({**stored.dwell_sec, **incoming.dwell_sec})
    else:
        interests, facts = stored.interests, stored.facts
        days, dwell = stored.days, stored.dwell_sec
    return Mind(
        interests=interests,
        facts=facts,
        latencies_ms=_sample(stored, incoming),
        slips=_slip_window((*stored.slips, *incoming.slips)),
        dwell_sec=dict(dwell),
        session_days=tuple(
            sorted({*stored.session_days, *incoming.session_days})[-MAX_SESSION_DAYS:]
        ),
        days={day: dict(led) for day, led in days.items()},
        helped_at=_later(stored.helped_at, incoming.helped_at),
        forgotten=dead,
        client_updated_at=_later(stored.client_updated_at, incoming.client_updated_at),
        erased_at=stored.erased_at,
        recent_writes=stored.recent_writes,
        updated_at=stored.updated_at,
    )


def forget(mind: Mind, *, facts: Iterable[str] = (), interests: Iterable[str] = ()) -> Mind:
    """The memory page's per-item clear: drop these, and remember that they were dropped.

    The tombstone is the whole point. Without it the next sync from a device that still holds the
    item would put it straight back, and a learner would clear something and watch it return. It
    is stored as a digest: what the learner asked to be forgotten is not kept in another column.
    """
    asked = {
        "facts": tuple(d for d in (digest(f) for f in facts) if d),
        "interests": tuple(d for d in (digest(i) for i in interests) if d),
    }
    dead = _merge_tombstones(mind.forgotten, {k: v for k, v in asked.items() if v})
    return replace(
        mind,
        facts=tuple(f for f in mind.facts if digest(f) not in set(dead.get("facts", ()))),
        interests=tuple(
            i for i in mind.interests if digest(i) not in set(dead.get("interests", ()))
        ),
        forgotten=dead,
    )


def _remembered(
    current: tuple[str, ...],
    asked: tuple[str, ...],
    dead: tuple[str, ...],
    cap: int,
    *,
    newest: bool,
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    """Add what the learner just told Wobo. Returns the list, the tombstones that were lifted,
    and anything the cap would not take.

    Remembering lifts a tombstone. A learner who cleared "plays cricket" in March and tells Wobo
    in June that they play cricket has said it again, and a record that refuses to hear them the
    second time is not keeping a promise, it is holding a grudge.
    """
    lifted = {digest(t) for t in asked}
    dead_now = tuple(d for d in dead if d not in lifted)
    out = list(current)
    seen = {t.lower() for t in out}
    dropped: list[str] = []
    for text in asked:
        if text.lower() in seen:
            continue
        if not newest and len(out) >= cap:
            # The interests are the eight the learner named, in the order they named them. The
            # ninth is not kept, and the write says so rather than quietly evicting one of theirs.
            dropped.append(text)
            continue
        seen.add(text.lower())
        out.append(text)
    kept = tuple(out[-cap:]) if newest else tuple(out[:cap])
    return kept, dead_now, tuple(dropped)


def _bump_days(
    stored: dict[str, dict[str, Any]], delta: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    out = {day: dict(led) for day, led in stored.items()}
    for day, led in delta.items():
        mine = dict(out.get(day) or _ledger({}))
        for counter in _DAY_COUNTERS:
            mine[counter] = min(MAX_COUNT, int(mine.get(counter, 0)) + int(led.get(counter, 0)))
        mine["evening"] = bool(mine.get("evening")) or bool(led.get("evening"))
        out[day] = mine
    return _days_window(out)


def _bump_dwell(stored: dict[str, int], delta: dict[str, int]) -> dict[str, int]:
    out = dict(stored)
    for surface, seconds in delta.items():
        out[surface] = min(MAX_COUNT, int(out.get(surface, 0)) + int(seconds))
    return _dwell_window(out)


def apply_write(stored: Mind | None, write: Write, *, now: datetime | None = None) -> Result:
    """One device's write against the record. The whole rule, in one place.

    Order matters: the erase floor first (a device talking from a cache the learner erased is not
    heard at all), then the duplicate check (so a retried bump counts once), then the snapshot,
    then what the learner asked to remember, then what they asked to forget.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    stamp = _not_ahead_of(write.client_updated_at, moment)
    seeding = stored is None
    base = stored if stored is not None else EMPTY

    # An erase stays erased. A device still holding the old snapshot is not a second opinion; it
    # is the cache of an account whose owner asked us to forget them.
    if base.erased_at and not _after(stamp, base.erased_at):
        return Result(base, applied=False, ignored="erased")
    if write.write_id and write.write_id in base.recent_writes:
        return Result(base, applied=False, ignored="duplicate")

    merged = merge(base, replace(write.mind, client_updated_at=stamp), seed=seeding)
    dead_facts = merged.forgotten.get("facts", ())
    dead_interests = merged.forgotten.get("interests", ())
    facts, dead_facts, dropped_f = _remembered(
        merged.facts, write.remember_facts, dead_facts, MAX_FACTS, newest=True
    )
    interests, dead_interests, dropped_i = _remembered(
        merged.interests, write.remember_interests, dead_interests, MAX_INTERESTS, newest=False
    )
    dead = {k: v for k, v in (("facts", dead_facts), ("interests", dead_interests)) if v}
    merged = replace(
        merged,
        facts=facts,
        interests=interests,
        forgotten=dead,
        days=_bump_days(merged.days, write.bump_days),
        dwell_sec=_bump_dwell(merged.dwell_sec, write.bump_dwell),
        client_updated_at=_not_ahead_of(merged.client_updated_at, moment),
        recent_writes=(
            (*base.recent_writes, write.write_id)[-MAX_WRITE_IDS:]
            if write.write_id
            else base.recent_writes
        ),
    )
    merged = forget(merged, facts=write.forget_facts, interests=write.forget_interests)
    return Result(merged, dropped=(*dropped_f, *dropped_i))


def matching(mind: Mind, needle: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Every fact and interest in the RECORD that contains this text, case-insensitively.

    "Wobo, forget about my mother" has to be answered against the record and not against one
    device's cache. A fact the learner told Wobo on their phone, which this laptop has never held,
    is exactly the one a client-side substring match cannot see — and the learner was told it was
    forgotten. So the match happens here, where everything they have told Wobo actually is.
    """
    text = flatten(needle).lower()
    if not text:
        return ((), ())
    return (
        tuple(f for f in mind.facts if text in f.lower()),
        tuple(i for i in mind.interests if text in i.lower()),
    )


# --- the rows -----------------------------------------------------------------------------------


def to_row(subject: str, mind: Mind) -> dict[str, Any]:
    return {
        _ID_COLUMN: subject,
        "interests": list(mind.interests),
        "facts": list(mind.facts),
        "latencies_ms": list(mind.latencies_ms),
        "slips": [dict(s) for s in mind.slips],
        "dwell_sec": dict(mind.dwell_sec),
        "session_days": list(mind.session_days),
        "days": {day: dict(led) for day, led in mind.days.items()},
        "helped_at": mind.helped_at,
        "forgotten": {kind: list(items) for kind, items in mind.forgotten.items()},
        "client_updated_at": mind.client_updated_at,
        "erased_at": mind.erased_at,
        "recent_writes": list(mind.recent_writes),
    }


def from_row(row: dict[str, Any]) -> Mind:
    """A stored row, back through the same cleaning an incoming snapshot goes through.

    Deliberately not trusted: a row written by an older build, or by a client reaching PostgREST
    directly under its own RLS, is data like any other and is bounded and flattened here too.
    """
    mind = normalise(
        {
            "interests": row.get("interests"),
            "facts": row.get("facts"),
            "latenciesMs": row.get("latencies_ms"),
            "slips": row.get("slips"),
            "dwellSec": row.get("dwell_sec"),
            "sessionDays": row.get("session_days"),
            "days": row.get("days"),
            "helpedAt": row.get("helped_at"),
        }
    )
    return replace(
        mind,
        forgotten=_tombstones(row.get("forgotten")),
        client_updated_at=_when(row.get("client_updated_at")),
        erased_at=_when(row.get("erased_at")),
        recent_writes=_write_ids(row.get("recent_writes")),
        updated_at=row.get("updated_at") if isinstance(row.get("updated_at"), str) else None,
    )


def erased_marker(mind: Mind | None, *, now: datetime | None = None) -> Mind:
    """What is left after forget-me: a date and nothing about the learner.

    Not an empty table row and not a deleted row, because both of those let the next sync from a
    phone in a pocket put the whole mind back — which is what actually happened before this. The
    marker holds no fact, no interest, no counter and no tombstone: only the moment, which is the
    one thing a stale device has to be told.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    return Mind(erased_at=moment.isoformat(), updated_at=(mind.updated_at if mind else None))


# --- the stores ---------------------------------------------------------------------------------


class MindStore(Protocol):
    def get(self, subject: str) -> Mind | None: ...

    def put(self, subject: str, write: Write) -> Result: ...

    def forget_all(self, subject: str) -> int: ...


class InMemoryMindStore:
    """The mind held in this process — a local run and the suite. Same rules, no project."""

    def __init__(self) -> None:
        self._rows: dict[str, Mind] = {}
        self._lock = threading.Lock()

    def get(self, subject: str) -> Mind | None:
        with self._lock:
            return self._rows.get(subject)

    def put(self, subject: str, write: Write) -> Result:
        with self._lock:  # the lock IS the compare-and-set: nothing else can write between
            result = apply_write(self._rows.get(subject), write)
            if not result.applied:
                return result
            settled = replace(result.mind, updated_at=datetime.now(UTC).isoformat())
            self._rows[subject] = settled
            return replace(result, mind=settled)

    def forget_all(self, subject: str) -> int:
        with self._lock:
            held = self._rows.get(subject)
            self._rows[subject] = erased_marker(held)
            return 1 if held is not None and not held.empty else 0


#: A connection that never answered, a name that would not resolve, a read that timed out. All of
#: them are worth retrying, and none of them is the store saying no.
_NETWORK_ERRORS = (TimeoutError, ValueError, OSError)


def _request(url: str, key: str, method: str, *, body: Any | None = None, want_rows: bool) -> Any:
    """One PostgREST call. Split out so tests substitute it without a database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
        "Prefer": "return=representation" if want_rows else "return=minimal",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


#: How many times a write re-merges when the row moved underneath it. Three is generous: the
#: window is one round trip, and a learner's own devices do not write in lockstep.
_WRITE_ATTEMPTS = 3


def _classify(exc: Exception) -> Exception:
    """Which of the two failures this is, so the learner is told the true one.

    A refused connection is worth retrying. A check constraint, a missing table and a bad grant
    are not, and answering all three with "try again in a moment" is a false claim in a kind
    voice. The only 4xx that IS worth another go is the insert race (409), and that one never
    reaches here: the write loop re-reads and merges instead.
    """
    if isinstance(exc, urllib.error.HTTPError):
        return StoreRefused(f"the store answered {exc.code}")
    return StoreUnavailable(str(exc))


class PostgrestMindStore:
    """``learner.wobo_mind`` over PostgREST with the service-role key (never a client's)."""

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestMindStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{TABLE}?{encoded}"

    def _read(self, subject: str) -> Mind | None:
        url = self._url({"select": "*", _ID_COLUMN: f"eq.{subject}", "limit": "1"})
        try:
            rows = self._request(url, self._key, "GET", want_rows=True)
        except (urllib.error.HTTPError, *_NETWORK_ERRORS) as exc:
            logger.warning("mind: read failed", extra={"fields": {"error": str(exc)}})
            raise _classify(exc) from exc
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return from_row(rows[0])
        return None

    def get(self, subject: str) -> Mind | None:
        return self._read(subject)

    def _write(self, subject: str, stored: Mind | None, mind: Mind) -> Mind | None:
        """One attempt. ``None`` means the row moved underneath us and this must be tried again."""
        row = to_row(subject, mind)
        try:
            if stored is None or not stored.updated_at:
                # No row yet. A plain insert, so a device that inserted first collides here
                # rather than replacing what it never read.
                rows = self._request(self._url({}), self._key, "POST", body=[row], want_rows=True)
            else:
                rows = self._request(
                    self._url(
                        {_ID_COLUMN: f"eq.{subject}", "updated_at": f"eq.{stored.updated_at}"}
                    ),
                    self._key,
                    "PATCH",
                    body=row,
                    want_rows=True,
                )
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                # The insert race: another device of this learner's inserted the row between our
                # read and our write. That is not a refusal, it is the same "merge again" the
                # PATCH filter reports by matching nothing.
                logger.info("mind: insert raced", extra={"fields": {"subject": subject}})
                return None
            logger.warning("mind: write refused", extra={"fields": {"error": str(exc)}})
            raise _classify(exc) from exc
        except _NETWORK_ERRORS as exc:
            logger.warning("mind: write failed", extra={"fields": {"error": str(exc)}})
            raise StoreUnavailable(str(exc)) from exc
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return from_row(rows[0])
        return None

    def put(self, subject: str, write: Write) -> Result:
        """Read, apply, write — and write only against the row that was read.

        The write carries the ``updated_at`` it read, so a second device that landed in between
        does not have its work overwritten: the filter matches nothing, and this writer applies
        again against the newer row. That is the whole of "two devices will write, and neither
        may erase the other".
        """
        for _attempt in range(_WRITE_ATTEMPTS):
            stored = self._read(subject)
            result = apply_write(stored, write)
            if not result.applied:
                return result
            settled = self._write(subject, stored, result.mind)
            if settled is not None:
                return replace(result, mind=settled)
            logger.info("mind: write raced, merging again", extra={"fields": {"subject": subject}})
        raise StoreUnavailable("the mind changed underneath this write three times")

    def forget_all(self, subject: str) -> int:
        """Everything about this learner out of the row, and the marker left in its place.

        A DELETE alone was not an erasure: the next ordinary sync from any device that still held
        a local copy wrote the whole mind back, so a learner who pressed forget-me on the laptop
        with their phone open got their mind back. The marker is what makes it stay gone.
        """
        for _attempt in range(_WRITE_ATTEMPTS):
            stored = self._read(subject)
            marker = erased_marker(stored)
            settled = self._write(subject, stored, marker)
            if settled is not None:
                return 1 if stored is not None and not stored.empty else 0
        raise StoreUnavailable("the mind changed underneath this erase three times")


# --- the process-wide store ----------------------------------------------------------------------

_store: MindStore | None = None
_store_lock = threading.Lock()


def build_store() -> MindStore:
    """The project store when one is configured, else this process. ``WOBO_MIND_STORE=memory``
    forces the latter — what the suite and a local run use."""
    if (os.getenv("WOBO_MIND_STORE") or "").strip().lower() == "memory":
        return InMemoryMindStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestMindStore(base, key)
    logger.info("mind: no project configured, keeping the mind in memory")
    return InMemoryMindStore()


def get_store() -> MindStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: MindStore | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store


# --- the record reaching the prompt -------------------------------------------------------------


def ground_lifetime(payload: Any, *, subject: str, anonymous: bool) -> bool:
    """Put the RECORD into the turn the tutor is about to take, in place of the client's claim.

    ``wobo.py:_dossier`` built the whole "who you are teaching" block out of ``context.lifetime``
    as the browser sent it, so the row this module keeps reached not one prompt: a learner on a
    second device got a Wobo that had nothing about them, and a crafted payload could assert
    anything it liked — including that a sentence came from a parent when no parent ever said it.

    So the server fills these in from what it holds:

    * ``facts`` and ``interests`` — from the account's own row, whenever there IS one. When there
      is not (a learner whose client has not synced yet) the device's copy stands, because
      stripping it would make Wobo worse at teaching them for no gain in truth. An ERASED account
      has a row, so its prompt is empty, which is the point.
    * ``parentFacts`` — the facts this learner's parent offered and this learner's parent
      accepted, read from the offers store. Always replaced, even when there are none, so a
      client cannot claim a parent said something. They are rendered as their own line in the
      dossier, marked as coming from their parent, never as something Wobo worked out.

    Never raises and never fails a turn: a store we cannot read leaves the client's copy in place
    and the lesson goes ahead. Returns whether the record was reached.
    """
    if not isinstance(payload, dict):
        return False
    context = payload.get("context")
    if not isinstance(context, dict):
        context = {}
        payload["context"] = context
    lifetime = context.get("lifetime")
    if not isinstance(lifetime, dict):
        lifetime = {}
        context["lifetime"] = lifetime
    if anonymous or not _SUBJECT_RE.match(subject or ""):
        # Whatever the client said about provenance is not evidence of provenance, and there is
        # nobody here to check it against.
        lifetime["parentFacts"] = []
        return False
    grounded = False
    try:
        held = get_store().get(subject)
    except (StoreUnavailable, StoreRefused) as exc:
        logger.warning("mind: not grounded", extra={"fields": {"error": str(exc)}})
        held = None
    if held is not None:
        lifetime["facts"] = list(held.facts)
        lifetime["interests"] = list(held.interests)
        grounded = True
    # One assignment, always made, whatever happened above: a claim in the payload is never
    # evidence of a claim, and a parent plane we cannot read is a prompt with no parent in it.
    parent_facts: list[str] = []
    try:
        from wobo_gateway import parent_account, parent_mind

        offered = parent_mind.offered_to(parent_account.get_store(), subject)
        parent_facts = [flatten(o.body) for o in offered if flatten(o.body)][:MAX_FACTS]
    except Exception as exc:  # the parent plane is never allowed to cost a learner their turn
        logger.warning("mind: parent facts unread", extra={"fields": {"error": str(exc)}})
    lifetime["parentFacts"] = parent_facts
    return grounded


# --- the routes ----------------------------------------------------------------------------------


class ItemsRequest(BaseModel):
    """A short list of the learner's own lines — what to remember, or what to clear."""

    model_config = ConfigDict(extra="forbid")

    facts: list[str] = Field(default_factory=list, max_length=MAX_NAMED)
    interests: list[str] = Field(default_factory=list, max_length=MAX_NAMED)


class BumpRequest(BaseModel):
    """What happened on THIS device since its last successful write. Added, never compared."""

    model_config = ConfigDict(extra="forbid")

    days: dict[str, dict[str, Any]] = Field(default_factory=dict)
    dwell: dict[str, int] = Field(default_factory=dict)


class MindWrite(BaseModel):
    """One device's write. Every field optional: a write that only forgets carries no snapshot,
    and a write that only counts carries no words."""

    model_config = ConfigDict(extra="forbid")

    mind: dict[str, Any] | None = None
    remember: ItemsRequest | None = None
    forget: ItemsRequest | None = None
    bump: BumpRequest | None = None
    #: This write's own id. Send a fresh one per write and reuse it on a retry: it is what makes
    #: a counter safe to send again after a timeout.
    write_id: str | None = Field(default=None, max_length=64)
    #: The device's own last-mutation stamp. Send it on every write.
    client_updated_at: str | None = Field(default=None, max_length=64)


class ForgetMatchingRequest(BaseModel):
    """ "Wobo, forget about my mother" — resolved against the record, not against a cache."""

    model_config = ConfigDict(extra="forbid")

    contains: str = Field(min_length=1, max_length=MAX_TEXT)


def _view(mind: Mind | None, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    stored = mind is not None and not mind.empty
    return {
        "mind": (mind or EMPTY).as_dict(),
        "stored": stored,
        "updated_at": mind.updated_at if mind else None,
        "erased_at": mind.erased_at if mind else None,
        **(extra or {}),
    }


def _unavailable() -> HTTPException:
    """The honest 503. A learner is told, in one calm line, rather than shown a mind that is not
    theirs or told a write landed when it did not."""
    return HTTPException(
        status_code=503,
        detail={
            "code": "store_unavailable",
            "message": (
                "I could not reach what I remember about you just now. Try again in a moment."
            ),
        },
    )


def _refused() -> HTTPException:
    """The store said no, and it will say no again. Never "try again in a moment"."""
    return HTTPException(
        status_code=500,
        detail={
            "code": "store_refused",
            "message": (
                "I could not save that, and it is my end rather than yours. Your device keeps "
                "its copy. Write to support@heywobo.com if it keeps happening."
            ),
        },
    )


def _sign_in_required() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "sign_in_required",
            "message": "Sign in first, and then what I remember about you stays with you.",
        },
    )


def _not_a_learner() -> HTTPException:
    """A parent account has no mind of its own, and it may not grow one.

    The two kinds are mutually exclusive for life (migration 0019, ruling 1). The database refuses
    learner rows on a parent account; this refuses the route, so the answer is a sentence rather
    than a constraint violation.
    """
    return HTTPException(
        status_code=403,
        detail={
            "code": "not_a_learner_account",
            "message": "This is a parent account, so there is no learning of your own here.",
        },
    )


def _learner_subject(request: Request) -> str:
    """The subject behind this call, or the refusal that says why there is none.

    The subject comes from the door and from nowhere else: there is no learner id in a body or a
    query here, so this is only ever a learner reading and writing their own mind.
    """
    principal = getattr(request.state, "principal", None)
    if principal is None or principal.anonymous:
        raise _sign_in_required()
    subject = principal.subject or ""
    if not _SUBJECT_RE.match(subject):
        raise _sign_in_required()
    from wobo_gateway import parent_account

    if parent_account.is_parent_account(subject):
        raise _not_a_learner()
    return subject


def register_mind(app: FastAPI) -> None:
    """``GET`` and ``PUT /v1/me/mind``, and the substring forget — Wobo's memory of one learner.

    An anonymous learner is signed in to nothing, and their subject is derived from their address
    — two children behind one home connection would share it. So an anonymous mind is never
    stored: the ``GET`` answers with an empty one and every write asks them to sign in. Their
    device keeps its own copy, and the first signed-in write seeds it into their account, which is
    how the work a child did before signing up follows them in.
    """

    @app.get("/v1/me/mind")
    def read_mind(request: Request, since: str | None = None) -> dict[str, Any]:
        """The record. ``since=YYYY-MM-DD`` trims the day ledger, which is most of the bytes.

        A full year of counters is 46KB and only ever draws a chart, so a client that is only
        signing in and wants to know who this learner is does not have to carry it.
        """
        principal = getattr(request.state, "principal", None)
        if principal is None or principal.anonymous:
            return _view(None)
        if not _SUBJECT_RE.match(principal.subject or ""):
            return _view(None)
        try:
            held = get_store().get(principal.subject)
        except StoreRefused as exc:
            raise _refused() from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        if held is not None and since and _ISO_DAY.match(since):
            held = replace(held, days={d: v for d, v in held.days.items() if d >= since})
        return _view(held)

    @app.put("/v1/me/mind")
    def write_mind(body: MindWrite, request: Request) -> dict[str, Any]:
        """One device's write. See this module's docstring for what each verb does.

        The answer is always the record as it now stands, so a client that is behind reconciles
        to it without a second call.
        """
        subject = _learner_subject(request)
        remember = body.remember or ItemsRequest()
        gone = body.forget or ItemsRequest()
        bump = body.bump or BumpRequest()
        write = Write(
            mind=normalise(body.mind),
            remember_facts=_named(remember.facts),
            remember_interests=_named(remember.interests),
            forget_facts=_named(gone.facts),
            forget_interests=_named(gone.interests),
            bump_days=_ledgers(bump.days, ceiling=MAX_BUMP),
            bump_dwell=_dwell(bump.dwell, ceiling=MAX_BUMP),
            write_id=(body.write_id if _WRITE_ID_RE.match(body.write_id or "") else None),
            client_updated_at=_when(body.client_updated_at),
        )
        try:
            result = get_store().put(subject, write)
        except StoreRefused as exc:
            raise _refused() from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        logger.info(
            "mind written",
            extra={
                "fields": {
                    "subject": subject,
                    "facts": len(result.mind.facts),
                    "interests": len(result.mind.interests),
                    "remembered": len(write.remember_facts) + len(write.remember_interests),
                    "forgot": len(write.forget_facts) + len(write.forget_interests),
                    "applied": result.applied,
                    "ignored": result.ignored or "",
                }
            },
        )
        return _view(
            result.mind,
            extra={
                "applied": result.applied,
                "ignored": result.ignored,
                "dropped": list(result.dropped),
            },
        )

    @app.post("/v1/me/mind/forget")
    def forget_matching(body: ForgetMatchingRequest, request: Request) -> dict[str, Any]:
        """ "Forget about my mother" — matched against the RECORD and cleared everywhere.

        The in-conversation verb used to resolve the substring against the device's own copy, so a
        fact the learner told Wobo on their phone, which this laptop had never held, was not
        matched, not tombstoned, and pushed back to every device on the next sync. The learner
        asked to be forgotten, was told it was done, and it was not. This is that verb, answered
        where everything they have told Wobo actually is.
        """
        subject = _learner_subject(request)
        store = get_store()
        try:
            held = store.get(subject)
            facts, interests = matching(held or EMPTY, body.contains)
            result = store.put(subject, Write(forget_facts=facts, forget_interests=interests))
        except StoreRefused as exc:
            raise _refused() from exc
        except StoreUnavailable as exc:
            raise _unavailable() from exc
        return _view(
            result.mind,
            extra={"forgot": {"facts": list(facts), "interests": list(interests)}},
        )


__all__ = [
    "EMPTY",
    "MAX_DAYS",
    "MAX_DWELL_SURFACES",
    "MAX_FACTS",
    "MAX_INTERESTS",
    "MAX_LATENCIES",
    "MAX_SESSION_DAYS",
    "MAX_SLIPS",
    "MAX_TOMBSTONES",
    "InMemoryMindStore",
    "Mind",
    "MindStore",
    "PostgrestMindStore",
    "Result",
    "StoreRefused",
    "StoreUnavailable",
    "Write",
    "apply_write",
    "build_store",
    "digest",
    "erased_marker",
    "flatten",
    "forget",
    "from_row",
    "get_store",
    "ground_lifetime",
    "matching",
    "merge",
    "normalise",
    "register_mind",
    "set_store",
    "to_row",
]
