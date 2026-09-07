"""The durable usage ledger — one row per model call, written where a restart cannot reach it.

WHAT THIS DOES THAT NOTHING ELSE HERE DOES. Three things in this service already count model
calls, and all three forget:

* ``telemetry.MetricsSink`` appends a :class:`~wobo_gateway.telemetry.TelemetryEvent` to an
  in-process ``deque`` bounded at a thousand entries.
* ``budget.py`` meters turns and generations per learner per day in a module-level dict, and says
  so in its own header: "the store is an in-process dict, so the ceiling is ONE gateway instance".
* ``spend.py`` accumulates the day's USD in a module-level float behind one lock, exactly like
  ``app.py``'s per-minute rate limiter and ``ask_public.AskMeter``, and its header spells out the
  two consequences: a restart forgets the day, and a second replica silently doubles the ceiling.

This module writes to Postgres instead, and that difference is the entire point:

1. **It survives a restart.** A Railway deploy resets every counter above to zero. It does not
   touch a row already in ``ops.model_calls``.
2. **It is correct with a second replica.** The three stores above are per-process, so N replicas
   means N independent counts that never meet. A row is a row whoever wrote it, and the rollup
   (``ops.roll_up_usage``) is a GROUP BY over all of them, so the ledger's totals are right at any
   replica count. It is the only accounting in this gateway of which that is true.
3. **It answers questions about the past.** The counters above can only answer "what has this
   container done since it started". Every question a usage console asks — spend by day, by model,
   by capability, by plan, how fast a free allowance is really consumed, what one free day costs —
   is a question about history, and none of them was answerable before this file existed.

It does NOT replace those three. ``budget`` and ``spend`` are gates: they decide, before a call,
whether to serve it, and a gate has to be fast and local. This is a record: it is written after a
call, off the response path, and nothing waits on it.

WHAT A ROW IS, AND WHAT IT IS NOT. A row is an accounting record — THAT a turn happened, which
model answered, what it cost, how long it took, and what the learner got for it. **A row is never
a transcript.** :data:`FIELDS` is the complete list of what is serialised, there is no field in it
for a question, an answer, a prompt, a completion, a concept, a title or a filename, and
``test_usage_ledger.py`` asserts that list character for character so the promise cannot be
widened by an absent-minded edit. The learner appears only as :func:`pseudonym` of their meter key:
a salted one-way digest, enough to count distinct learners and to spot one account consuming an
unreasonable share, not enough to turn a dump of the table back into a list of children.

WRITING THE LEDGER MUST NEVER BREAK A LESSON. :func:`record` takes a lock, appends to a bounded
deque and returns; it never touches the network on the caller's thread. A daemon thread flushes
batches to PostgREST. Every failure — an unreachable database, a schema that has not been migrated
yet, a full buffer — drops rows and counts the drops. There is no retry queue and no back-pressure
on the caller, because an accounting line is worth less than a child's answer and the code should
say so plainly rather than discovering it during an incident. :func:`state` reports the drops, so
"the ledger is missing rows" is a thing an operator can see instead of a thing they assume away.

IT STARTS EMPTY. Nothing is backfilled, seeded or estimated. Before the first call after this
ships, every query against it returns nothing, and a console reading it must say so.
"""

from __future__ import annotations

import contextlib
import contextvars
import hashlib
import hmac
import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

logger = logging.getLogger("wobo.gateway.ledger")

SCHEMA = "ops"
TABLE = "model_calls"
ROLLUP_TABLE = "usage_daily"
_HTTP_TIMEOUT_S = 8.0

#: The retention window the migration documents. Repeated here because the sweep is driven from
#: this process and a number that lives in only one of the two files drifts.
RETENTION_DAYS = 45

# --- the units -----------------------------------------------------------------------------------
#
# What the learner GOT for a call, which is not the same question as what the call cost. The
# owner's ask — "usage pacing based on how much of the 1x uses the video minutes and messages and
# content" — is unanswerable without it, because a one-line reply and a two-minute narrated
# explainer are both "one call" and nothing else in the row tells them apart.

TURN = "turn"
GENERATION = "generation"
VIDEO_SECOND = "video_second"
SPOKEN_SECOND = "spoken_second"
#: One second of the live microphone, in either direction (``voice.LiveMeter``): what the child
#: said and what Wobo said back both cost audio tokens, and the owner's question about that seam
#: is "how many minutes", not "how many calls".
LIVE_SECOND = "live_second"
IMAGE = "image"
#: One photographed doubt, read and answered (doubt.py). Its own unit because the owner asked what
#: one costs, and a vision call is dearer than a text turn: folding it into ``turn`` would hide the
#: one number this feature has to be priced on.
DOUBT = "doubt"

#: Where a cost figure came from. ``unpriced`` is a real answer and is never quietly rendered as
#: zero: a zero understates the bill forever, and the console shows unpriced calls beside the
#: money so a total is read as "this much, plus N we cannot price".
FROM_LITELLM = "litellm"
FROM_CONFIGURED = "configured"
#: A price copied from the vendor's own page into ``routing.CATALOGUE`` or the seam that calls
#: the model (the live microphone's audio-token rates in ``voice.py``): neither litellm's table
#: nor an operator's entry, and said so.
FROM_CATALOGUE = "catalogue"
UNPRICED = "unpriced"
NO_PROVIDER_CHARGE = "no_provider_charge"

MODEL_CALL = "model_call"
DELIVERY = "delivery"

#: Capability prefix -> unit, longest prefix wins. Mirrors the shape of ``budget.CAPABILITY_CLASS``
#: on purpose: there is one way to classify a capability in this gateway, not two dialects of it.
#: An unrecognised capability is a TURN rather than nothing, for the same reason the meter does it
#: — a capability shipped tomorrow is recorded the day it ships.
_UNIT_BY_PREFIX: dict[str, str] = {
    "engine.": GENERATION,
    "engine.image": IMAGE,
    "engine.video": GENERATION,  # the PLAN is a generation; the seconds arrive as a delivery row
    "generate.course": GENERATION,
    "generate.digest": GENERATION,
    "curriculum.discovery": GENERATION,
    "curriculum.own.read": GENERATION,
    "voice.tts": SPOKEN_SECOND,
    "voice.narration": SPOKEN_SECOND,
    "voice.relay": LIVE_SECOND,
    "doubt.": DOUBT,
}
_PREFIXES: tuple[tuple[str, str], ...] = tuple(
    sorted(_UNIT_BY_PREFIX.items(), key=lambda item: len(item[0]), reverse=True)
)


def unit_for(capability: str) -> str:
    """Which unit this capability's calls are measured in."""
    for prefix, unit in _PREFIXES:
        if capability.startswith(prefix):
            return unit
    return TURN


# --- configured prices ----------------------------------------------------------------------------
#
# litellm prices the chat completions, and ``telemetry.record_cost`` already asks it. It knows
# nothing about the seams that do not go through it — Gemini TTS is a raw HTTPS POST in
# plexus/media.py, and it has never been costed anywhere in this repo.
#
# So an operator may enter a price for those seams, and when they do the row says the number came
# from a person (``cost_source='configured'``) rather than from a price table. With no price
# entered the row is UNPRICED and stays unpriced: the derivation in unit_economics.py reports the
# gap in words rather than guessing at it, because the owner is going to price a product on this.

_PRICE_ENV: dict[str, str] = {
    SPOKEN_SECOND: "LEDGER_PRICE_SPOKEN_SECOND_USD",
    VIDEO_SECOND: "LEDGER_PRICE_VIDEO_SECOND_USD",
    IMAGE: "LEDGER_PRICE_IMAGE_USD",
}


def configured_price(unit_kind: str) -> float | None:
    """The operator-entered price for one unit, or None when nobody has entered one."""
    name = _PRICE_ENV.get(unit_kind)
    if not name:
        return None
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return None
    try:
        value = float(raw)
    except ValueError:
        logger.warning("ledger: %s is not a number, treating the unit as unpriced", name)
        return None
    return value if value >= 0 else None


# --- the pseudonym -------------------------------------------------------------------------------


def _pepper() -> str | None:
    """The salt the learner pseudonym is keyed on.

    ``USAGE_LEDGER_PEPPER`` when set. Otherwise the service-role key, which is already the most
    guarded secret in this process and is stable across restarts and replicas — the two properties
    the pseudonym actually needs. A random per-process salt would be worse than nothing: the same
    learner would land under a different reference after every deploy, and "how much did one
    account consume this week" would silently become unanswerable.
    """
    return (
        os.getenv("USAGE_LEDGER_PEPPER")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_KEY")
        or None
    )


def pseudonym(meter_key: str | None) -> str | None:
    """A stable one-way reference for a learner, or None when there is nothing to reference.

    The input is the METER KEY the door derived (``app.meter_key``) — ``sub:<subject>`` for a
    signed-in learner, ``anon:<address>`` or ``ip:<address>`` for everyone else — so the ledger
    never holds a subject id or an address, only a digest of one. An operator holding a subject id
    can hash it and find that learner's rows; nobody reading the table can go the other way.

    Returns None when no pepper is configured, which is the honest answer: an unsalted digest of a
    uuid is not a pseudonym, it is a lookup table away from being the uuid itself.
    """
    if not meter_key:
        return None
    pepper = _pepper()
    if not pepper:
        return None
    digest = hmac.new(pepper.encode(), meter_key.encode(), hashlib.sha256).hexdigest()
    # Half the digest. Still 128 bits — collisions are not a practical concern at any scale this
    # product will see — and it keeps the column narrow enough to index cheaply.
    return digest[:32]


# --- the call context ----------------------------------------------------------------------------
#
# ``telemetry.record_cost`` is the one funnel every live model call in this service already passes
# through, and it is called from deep inside providers.py, wobo.py, ask_public.py and the engines.
# It knows the capability, the model and the response. It has never known who was asking, what
# they pay, or whether they were anonymous — and those three are exactly what pacing is sliced by.
#
# A contextvar carries them from the door to the funnel without threading an argument through nine
# call sites in files other waves are editing. FastAPI copies the context into the threadpool it
# runs sync routes on, and the model call happens on that same thread, so the value set at the
# route boundary is the value the funnel reads. Nothing is ever read from a request body: the plan
# and the anonymity come from the verified principal, the same way the meter and the money ceiling
# already derive theirs.


@dataclass(frozen=True)
class CallContext:
    """Who the call in flight is for. Derived at the door, never declared by a caller."""

    plan: str = "unknown"
    anonymous: bool = False
    learner_ref: str | None = None


_EMPTY_CONTEXT = CallContext()
_context: contextvars.ContextVar[CallContext] = contextvars.ContextVar(
    "wobo_ledger_call_context", default=_EMPTY_CONTEXT
)


def current() -> CallContext:
    return _context.get()


def _context_for(plan: str | None, anonymous: bool, meter_key: str | None) -> CallContext:
    return CallContext(
        plan=(plan or "unknown").strip().lower() or "unknown",
        anonymous=bool(anonymous),
        learner_ref=pseudonym(meter_key),
    )


def mark(
    *, plan: str | None = None, anonymous: bool = False, meter_key: str | None = None
) -> None:
    """Name the caller for the rest of THIS request. One line at a door, and nothing to unwind.

    Safe without a reset because a contextvar is per-context, and Starlette gives every request
    its own: an async route runs in its own ``asyncio.Task`` (which copies the context at
    creation) and a sync route runs through ``anyio.to_thread.run_sync`` (which copies it into the
    worker). Neither can see what another request set, whichever thread the pool happens to reuse.
    A call made outside any request — a cron job, an internal sweep — reads the default context and
    is recorded as plan "unknown" with no learner, which is exactly what it is.
    """
    _context.set(_context_for(plan, anonymous, meter_key))


@contextlib.contextmanager
def calling(
    *, plan: str | None = None, anonymous: bool = False, meter_key: str | None = None
) -> Iterator[None]:
    """Mark the caller for every ledger row written inside this block, then put it back."""
    token = _context.set(_context_for(plan, anonymous, meter_key))
    try:
        yield
    finally:
        _context.reset(token)


# --- the provider round trip ----------------------------------------------------------------------
#
# How long the provider actually took. Only ``model_call.complete`` is in a position to measure it
# — it is the one function that wraps the litellm call itself — and ``telemetry.record_cost``, the
# funnel that writes the row, is called by the caller a frame or two later. The note passes the
# number between them without threading an argument through nine call sites in files other waves
# are editing.
#
# It is TAKEN, not read: the note is cleared on the way out, so a second call that was not measured
# can never inherit the first one's latency. A call nobody measured records NULL, which means "not
# measured here" and never "instantaneous".

_call_note: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "wobo_ledger_call_note", default=None
)


def note_latency(latency_ms: float) -> None:
    """Record how long the provider round trip that just finished took."""
    with contextlib.suppress(Exception):
        _call_note.set(max(0.0, float(latency_ms)))


def take_latency() -> float | None:
    """The measured round trip, consumed. ``None`` when nothing measured this one."""
    value = _call_note.get()
    if value is not None:
        _call_note.set(None)
    return value


# --- the row -------------------------------------------------------------------------------------

#: The COMPLETE list of what is written. This is the privacy promise in executable form: nothing
#: outside this tuple is ever serialised, there is no member of it that can hold a question or an
#: answer, and the suite asserts the tuple exactly. Widening it is a deliberate act with a test to
#: change, which is the point.
FIELDS: tuple[str, ...] = (
    "occurred_at",
    "day",
    "kind",
    "capability",
    "track",
    "provider",
    "model_requested",
    "model_served",
    "fallback_used",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "cost_source",
    "latency_ms",
    "cache_hit",
    "anonymous",
    "plan",
    "learner_ref",
    "unit_kind",
    "unit_count",
)


@dataclass(frozen=True)
class LedgerRow:
    capability: str
    occurred_at: datetime
    kind: str = MODEL_CALL
    track: str | None = None
    provider: str | None = None
    model_requested: str | None = None
    model_served: str | None = None
    fallback_used: bool = False
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: float | None = None
    cost_source: str = UNPRICED
    latency_ms: int | None = None
    cache_hit: bool = False
    anonymous: bool = False
    plan: str = "unknown"
    learner_ref: str | None = None
    unit_kind: str = TURN
    unit_count: float = 1.0

    @property
    def day(self) -> date:
        return self.occurred_at.astimezone(UTC).date()

    def as_row(self) -> dict[str, Any]:
        """The PostgREST payload. Built from :data:`FIELDS` so the allowlist is the code path,
        not a comment beside it — a field added to the dataclass and not to FIELDS is not sent."""
        source: dict[str, Any] = {
            **{name: getattr(self, name, None) for name in FIELDS if hasattr(self, name)},
            "occurred_at": self.occurred_at.astimezone(UTC).isoformat(),
            "day": self.day.isoformat(),
        }
        return {name: source.get(name) for name in FIELDS}


def _provider_of(model: str | None) -> str | None:
    """The provider half of a litellm model string (``anthropic/claude-…`` -> ``anthropic``).

    Best-effort and never fatal: a bare model name with no slash reports no provider rather than
    a guessed one, because "which vendor is the bill from" is a question the console must be able
    to answer honestly or not at all.
    """
    if not model:
        return None
    head, sep, _ = model.partition("/")
    return head if sep and head else None


# --- the buffer ----------------------------------------------------------------------------------

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, Any]]


def _urllib_transport(
    method: str, url: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, Any]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
            raw = response.read().decode()
            return response.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as exc:
        detail = ""
        with contextlib.suppress(Exception):
            detail = exc.read().decode(errors="replace")[:300]
        return exc.code, detail
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        return 0, str(exc)


def _int_env(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        return default


def _float_env(name: str, default: float, *, minimum: float = 0.1) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(minimum, float(raw))
    except ValueError:
        return default


@dataclass
class _Counters:
    """What an operator needs to know about the ledger itself. Honesty about our own accounting:
    a console that cannot say how many rows it lost is not a console you can price on."""

    buffered: int = 0
    written: int = 0
    dropped_full: int = 0
    dropped_write: int = 0
    dropped_unconfigured: int = 0
    last_error: str | None = None
    last_write_at: str | None = None


class _Ledger:
    """The buffer, the flusher and the transport. One instance per process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buffer: deque[LedgerRow] = deque()
        self._counters = _Counters()
        self._transport: Transport | None = None
        self._base: str | None = None
        self._key: str | None = None
        self._autoflush = True
        self._thread: threading.Thread | None = None
        self._wake = threading.Event()
        self._stopping = False
        self._last_maintenance = 0.0

    # -- configuration
    def configure(
        self,
        *,
        base_url: str | None = None,
        service_key: str | None = None,
        transport: Transport | None = None,
        autoflush: bool = True,
    ) -> None:
        with self._lock:
            self._base = (base_url or "").rstrip("/") or None
            self._key = service_key or None
            self._transport = transport
            self._autoflush = autoflush

    def reset(self) -> None:
        with self._lock:
            self._buffer.clear()
            self._counters = _Counters()
            self._transport = None
            self._base = None
            self._key = None
            self._autoflush = True

    def _resolve(self) -> tuple[str | None, str | None, Transport | None]:
        """Configuration, explicit first and the environment second.

        Read on every flush rather than cached at import: the suite sets and clears the Supabase
        variables per test (conftest deletes them so nothing touches the network), and a value
        frozen at import time would make the ledger's behaviour depend on import order.
        """
        base = self._base or os.getenv("SUPABASE_URL")
        key = (
            self._key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
        )
        transport = self._transport
        if transport is None and base and key:
            transport = _urllib_transport
        return (base.rstrip("/") if base else None), key, transport

    def configured(self) -> bool:
        if (os.getenv("USAGE_LEDGER") or "").strip().lower() in {"off", "0", "false"}:
            return False
        base, key, transport = self._resolve()
        # An injected transport is a configured ledger even without a URL: that is how the suite
        # exercises every row this module builds without a network.
        return bool(transport) and (self._transport is not None or bool(base and key))

    # -- writing
    def record(self, row: LedgerRow) -> None:
        """Buffer one row. Never blocks on IO, never raises, never lets a failure reach a turn."""
        if not self.configured():
            with self._lock:
                self._counters.dropped_unconfigured += 1
            return
        limit = _int_env("LEDGER_BUFFER_MAX", 5000, minimum=10)
        batch = _int_env("LEDGER_BATCH_MAX", 100, minimum=1)
        should_wake = False
        with self._lock:
            if len(self._buffer) >= limit:
                # Drop the OLDEST. Both ends lose a row; losing the oldest keeps the most recent
                # minutes intact, which is the window an operator is actually looking at when the
                # database is unreachable and the buffer is filling.
                self._buffer.popleft()
                self._counters.dropped_full += 1
            self._buffer.append(row)
            self._counters.buffered = len(self._buffer)
            should_wake = len(self._buffer) >= batch
        if self._autoflush:
            self._ensure_thread()
            if should_wake:
                self._wake.set()

    def _ensure_thread(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stopping = False
            self._thread = threading.Thread(
                target=self._run, name="wobo-ledger-flush", daemon=True
            )
            self._thread.start()

    def _run(self) -> None:
        interval = _float_env("LEDGER_FLUSH_INTERVAL_S", 5.0)
        while not self._stopping:
            self._wake.wait(timeout=interval)
            self._wake.clear()
            try:
                self.flush()
                self._maintenance()
            except Exception as exc:  # noqa: BLE001 — a flusher that dies stops all accounting
                logger.warning("ledger: flush loop error — %s: %s", type(exc).__name__, exc)

    def stop(self) -> None:
        self._stopping = True
        self._wake.set()

    def flush(self) -> int:
        """Send every buffered row. Returns how many the store accepted.

        A failure DROPS the batch. There is no retry queue on purpose: rows are worth less than
        the memory a growing queue would take from a process that also serves children, and a
        silent retry would hide a broken ledger behind an eventually-consistent story that is not
        true. The drop is counted and logged, so it is visible instead of assumed away.
        """
        base, key, transport = self._resolve()
        if transport is None:
            return 0
        batch_max = _int_env("LEDGER_BATCH_MAX", 100, minimum=1)
        written = 0
        while True:
            with self._lock:
                if not self._buffer:
                    self._counters.buffered = 0
                    return written
                batch = [self._buffer.popleft() for _ in range(min(batch_max, len(self._buffer)))]
                self._counters.buffered = len(self._buffer)
            payload = json.dumps([row.as_row() for row in batch]).encode()
            url = f"{base or ''}/rest/v1/{TABLE}"
            headers = {
                "apikey": key or "",
                "Authorization": f"Bearer {key or ''}",
                "Content-Type": "application/json",
                # PostgREST picks the schema by header. Without it the insert lands in `public`,
                # where none of this exists — a silent 404 instead of an error worth reading.
                "Content-Profile": SCHEMA,
                # Nothing here needs the rows echoed back, and asking for them would double the
                # bytes on a path that runs on every model call.
                "Prefer": "return=minimal",
            }
            status, detail = self._call(transport, "POST", url, headers, payload)
            if 200 <= status < 300:
                written += len(batch)
                with self._lock:
                    self._counters.written += len(batch)
                    self._counters.last_write_at = datetime.now(UTC).isoformat()
                    self._counters.last_error = None
            else:
                with self._lock:
                    self._counters.dropped_write += len(batch)
                    self._counters.last_error = f"{status}: {str(detail)[:200]}"
                logger.warning(
                    "ledger: dropped %d rows",
                    len(batch),
                    extra={"fields": {"status": status, "detail": str(detail)[:200]}},
                )
                return written

    def _call(
        self,
        transport: Transport,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, Any]:
        try:
            return transport(method, url, headers, body)
        except Exception as exc:  # noqa: BLE001 — a transport that throws is a dropped row, not an outage
            return 0, f"{type(exc).__name__}: {exc}"

    # -- maintenance
    def _maintenance(self) -> None:
        """Roll today and yesterday up, and expire what the window has passed.

        Yesterday as well as today because a call at 23:59:58 lands in a buffer that flushes into
        the next day, and a rollup that only ever rebuilt today would leave that row out of the
        permanent record forever. The rollup is idempotent (delete-then-insert for one day behind
        an advisory lock), so rebuilding yesterday every quarter of an hour costs a small query
        and buys correctness at the boundary.
        """
        import time

        interval = rollup_interval_s()
        now = time.monotonic()
        if self._last_maintenance and (now - self._last_maintenance) < interval:
            return
        self._last_maintenance = now
        today = datetime.now(UTC).date()
        for day in (today, date.fromordinal(today.toordinal() - 1)):
            self.roll_up(day)
        self.expire()

    def _rpc(self, name: str, args: dict[str, Any]) -> tuple[int, Any]:
        base, key, transport = self._resolve()
        if transport is None:
            return 0, "not configured"
        headers = {
            "apikey": key or "",
            "Authorization": f"Bearer {key or ''}",
            "Content-Type": "application/json",
            "Content-Profile": SCHEMA,
            "Accept": "application/json",
        }
        url = f"{base or ''}/rest/v1/rpc/{name}"
        return self._call(transport, "POST", url, headers, json.dumps(args).encode())

    def roll_up(self, day: date | None = None) -> int | None:
        """Rebuild one day of ``ops.usage_daily``. Returns the row count, or None on a failure."""
        target = day or datetime.now(UTC).date()
        status, body = self._rpc("roll_up_usage", {"p_day": target.isoformat()})
        if 200 <= status < 300:
            with contextlib.suppress(TypeError, ValueError):
                return int(body)
            return 0
        logger.warning("ledger: rollup failed for %s (%s)", target, status)
        return None

    def expire(self, keep_days: int | None = None) -> int | None:
        """Run the retention sweep. Returns rows deleted, or None on a failure."""
        keep = (
            keep_days
            if keep_days is not None
            else _int_env("LEDGER_RETENTION_DAYS", RETENTION_DAYS)
        )
        status, body = self._rpc("expire_model_calls", {"p_keep_days": keep})
        if 200 <= status < 300:
            with contextlib.suppress(TypeError, ValueError):
                return int(body)
            return 0
        logger.warning("ledger: retention sweep failed (%s)", status)
        return None

    # -- reading
    def read_daily(self, *, since: date, until: date) -> list[dict[str, Any]] | None:
        """The rollup for a date range, or None when the ledger cannot be reached.

        None and ``[]`` are different answers and the console must show them differently: ``[]``
        is "nothing happened", None is "we could not ask". Neither is a number to draw a chart on.
        """
        base, key, transport = self._resolve()
        if transport is None:
            return None
        # Two filters on the same column, which PostgREST reads as an AND. The dates are
        # ``date`` objects from the caller, never strings from a request, so nothing user-typed
        # reaches this query string.
        params = [
            ("select", "*"),
            ("day", f"gte.{since.isoformat()}"),
            ("day", f"lte.{until.isoformat()}"),
            ("order", "day.asc"),
        ]
        query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        url = f"{base or ''}/rest/v1/{ROLLUP_TABLE}?{query}"
        headers = {
            "apikey": key or "",
            "Authorization": f"Bearer {key or ''}",
            "Accept": "application/json",
            "Accept-Profile": SCHEMA,
        }
        status, body = self._call(transport, "GET", url, headers, None)
        if 200 <= status < 300 and isinstance(body, list):
            return body
        logger.warning("ledger: rollup read failed (%s)", status)
        return None

    def read_daily_safe(self, *, since: date, until: date) -> list[dict[str, Any]] | None:
        """:meth:`read_daily`, with nothing able to escape onto a request thread.

        The console calls this on an operator's HTTP request. A malformed argument or a transport
        that throws in an unexpected shape should show as "we could not ask" on the screen, which
        is a real answer, rather than as a 500 with a stack trace on a page about money.
        """
        try:
            return self.read_daily(since=since, until=until)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ledger: rollup read errored (%s: %s)", type(exc).__name__, exc)
            return None

    # -- introspection
    def state(self) -> dict[str, Any]:
        with self._lock:
            counters = self._counters
            return {
                "configured": self.configured(),
                "buffered": len(self._buffer),
                "written": counters.written,
                "dropped_buffer_full": counters.dropped_full,
                "dropped_write_failed": counters.dropped_write,
                "dropped_unconfigured": counters.dropped_unconfigured,
                "last_write_at": counters.last_write_at,
                "last_error": counters.last_error,
                "retention_days": _int_env("LEDGER_RETENTION_DAYS", RETENTION_DAYS),
            }


_LEDGER = _Ledger()


# --- the module surface ---------------------------------------------------------------------------


def configure(
    *,
    base_url: str | None = None,
    service_key: str | None = None,
    transport: Transport | None = None,
    autoflush: bool = True,
) -> None:
    """Point the ledger at a store. Called by the suite; production reads the environment."""
    _LEDGER.configure(
        base_url=base_url, service_key=service_key, transport=transport, autoflush=autoflush
    )


def reset() -> None:
    """Test seam — an empty buffer, zeroed counters, no transport."""
    _LEDGER.reset()


def configured() -> bool:
    return _LEDGER.configured()


def record(
    *,
    capability: str,
    model_served: str | None = None,
    model_requested: str | None = None,
    track: str | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    cost_usd: float | None = None,
    cost_source: str | None = None,
    latency_ms: float | None = None,
    cache_hit: bool = False,
    unit_kind: str | None = None,
    unit_count: float = 1.0,
    context: CallContext | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Record one paid model call. Buffered and returned from immediately; never raises.

    ``model_requested`` is what the policy asked for and ``model_served`` is who actually
    answered; when they differ the row is marked as a fallback, because a spend chart drawn on the
    requested model is a chart of our intentions rather than of our bill.
    """
    try:
        ctx = context or current()
        served = model_served or model_requested
        source = cost_source or (FROM_LITELLM if cost_usd is not None else UNPRICED)
        row = LedgerRow(
            capability=capability,
            occurred_at=occurred_at or datetime.now(UTC),
            kind=MODEL_CALL,
            track=track,
            provider=_provider_of(served),
            model_requested=model_requested,
            model_served=served,
            fallback_used=bool(
                model_requested and served and model_requested != served
            ),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=None if cost_usd is None else round(float(cost_usd), 6),
            cost_source=source,
            latency_ms=None if latency_ms is None else max(0, int(latency_ms)),
            cache_hit=bool(cache_hit),
            anonymous=ctx.anonymous,
            plan=ctx.plan,
            learner_ref=ctx.learner_ref,
            unit_kind=unit_kind or unit_for(capability),
            unit_count=max(0.0, float(unit_count)),
        )
        _LEDGER.record(row)
    except Exception as exc:  # noqa: BLE001 — an accounting line is worth less than a child's answer
        logger.debug("ledger: row not recorded (%s: %s)", type(exc).__name__, exc)


def record_delivery(
    *,
    capability: str,
    unit_kind: str,
    unit_count: float,
    model_served: str | None = None,
    context: CallContext | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Record something the learner RECEIVED that carries no separate provider charge.

    The seconds of finished video are the case this exists for: the provider billed us for the
    scene plan (its own row) and for each narration line (their own rows), and nothing billed us
    per second of the video itself — but "how many video minutes did a free allowance consume" is
    a question the owner asked directly, and it is unanswerable without a row that carries the
    seconds. Delivery rows are excluded from every call count and every cost sum in the rollup, so
    they cannot inflate a per-call figure.
    """
    try:
        ctx = context or current()
        _LEDGER.record(
            LedgerRow(
                capability=capability,
                occurred_at=occurred_at or datetime.now(UTC),
                kind=DELIVERY,
                model_served=model_served,
                provider=_provider_of(model_served),
                cost_usd=None,
                cost_source=NO_PROVIDER_CHARGE,
                anonymous=ctx.anonymous,
                plan=ctx.plan,
                learner_ref=ctx.learner_ref,
                unit_kind=unit_kind,
                unit_count=max(0.0, float(unit_count)),
            )
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("ledger: delivery not recorded (%s: %s)", type(exc).__name__, exc)


def flush_now() -> int:
    """Send everything buffered right now. The test seam, and what a shutdown hook would call."""
    return _LEDGER.flush()


def roll_up(day: date | None = None) -> int | None:
    return _LEDGER.roll_up(day)


def expire(keep_days: int | None = None) -> int | None:
    return _LEDGER.expire(keep_days)


def rollup_interval_s() -> float:
    """How often ``ops.usage_daily`` is rebuilt, in seconds. Default a quarter of an hour.

    Exported because the CONSOLE needs it, not only the loop that obeys it. Every rollup panel
    prints the moment it fetched, which reads as live — and ``usage_daily`` is a cache rebuilt on
    this cadence, so the newest figure on the money screen can be fifteen minutes old under a
    timestamp from a second ago. The console prints both, and warns when the newest row's
    ``rolled_at`` is older than this.
    """
    return _float_env("LEDGER_ROLLUP_INTERVAL_S", 900.0, minimum=30.0)


def read_daily(*, since: date, until: date) -> list[dict[str, Any]] | None:
    """The rollup for a date range, or None when it could not be read.

    ``None`` and ``[]`` are DIFFERENT answers and a console must render them differently: ``[]``
    is "nothing happened", ``None`` is "we could not ask". Neither is a number to draw a chart on.
    """
    return _LEDGER.read_daily_safe(since=since, until=until)


def state() -> dict[str, Any]:
    """What the ledger has done and what it has lost. Safe for ``/healthz`` to call."""
    return _LEDGER.state()


def stop() -> None:
    _LEDGER.stop()


__all__ = [
    "DELIVERY",
    "FIELDS",
    "FROM_CATALOGUE",
    "FROM_CONFIGURED",
    "FROM_LITELLM",
    "GENERATION",
    "IMAGE",
    "MODEL_CALL",
    "NO_PROVIDER_CHARGE",
    "RETENTION_DAYS",
    "LIVE_SECOND",
    "SPOKEN_SECOND",
    "TURN",
    "UNPRICED",
    "VIDEO_SECOND",
    "CallContext",
    "LedgerRow",
    "calling",
    "configure",
    "configured",
    "configured_price",
    "current",
    "mark",
    "note_latency",
    "expire",
    "flush_now",
    "pseudonym",
    "read_daily",
    "rollup_interval_s",
    "record",
    "record_delivery",
    "reset",
    "roll_up",
    "state",
    "stop",
    "take_latency",
    "unit_for",
]
