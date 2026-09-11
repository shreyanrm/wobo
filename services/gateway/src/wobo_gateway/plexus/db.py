"""The five stores in Postgres — the truth the file cache is a front for (docs/CACHES.md).

WHAT WAS TRUE BEFORE THIS FILE, AND IS THE REASON FOR IT. ``plexus/store.py`` writes generated
content to a directory. In production that directory is ``/home/gateway/cache`` (the Dockerfile's
``PLEXUS_CACHE_DIR``), which lives in the container's writable layer, and ``railway.json`` mounts
no volume at it — there is no ``volumes`` key anywhere in the repository. A Railway deploy replaces
the container, and a container's writable layer does not survive its container. So every concept
core, level rendering, diagram and second of narration the platform has ever generated is discarded
on each deploy and the next learner pays for it again. That is scorecard fix 11, and
``tests/test_content_stores.py`` proves it from the two committed files rather than asserting it.

WHAT THIS FILE CHANGES, AND WHAT IT DELIBERATELY DOES NOT. The file cache stays exactly where it
is and keeps doing the thing it is good at: answering in microseconds, in-process, with no network.
It stops being the truth. On a miss the gateway asks Postgres, which is tens of milliseconds and
survives everything, and re-indexes what it finds onto the file front so the second read is fast
again. Nothing about the key changes; ``store.artifact_path`` remains the single definition of what
a key is, and this module never derives one.

THE ORDER, WRITTEN OUT, BECAUSE IT IS THE WHOLE DESIGN:

    file front   hit   -> serve, microseconds, no network
    file front   miss  -> database
    database     hit   -> serve, tens of milliseconds, AND write the file front
    database     miss  -> generate, then write BOTH

FAILURE IS NEVER FATAL. Every function here answers ``None`` or ``False`` when the database is
unreachable, unconfigured, or answers something unexpected. An unreachable store means a cache miss
and a regeneration — expensive, and correct. It never means a learner sees an error, and it never
raises into a request. That is the same posture ``ledger.py`` takes and for the same reason.

WHAT A ROW IS. :data:`FIELDS` is the complete list of what this module ever sends. There is no
field for a learner, a name, a session, a meter key or a pseudonym in ANY of the five stores, and
in ``content.turns`` the migration refuses a body carrying one. A store row is content: it is made
once and served to everybody, so anything in it that belonged to one child would be a leak by
construction rather than by accident.

SPEND SAVED. Every row counts its serves and remembers what it cost to make, so the saving is
``(served_count - 1) * cost_usd`` — every serve after the first is a generation nobody paid for.
The counting happens in the database (``content.note_serves``), from a batch flushed off the
response path: nothing a learner is waiting on ever waits on a counter. A row we could not price
contributes to the counts and not to the money, because an unpriced row rendered as zero
understates the bill forever.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("wobo.gateway.plexus.db")

SCHEMA = "content"

#: The five stores of docs/CACHES.md §1, spelled the way the migration spells them. A name not in
#: this set is refused here as well as by ``content.note_serves``, so a typo is a loud error and
#: never a silent write to the wrong table.
CORES = "cores"
LEVELS = "levels"
INTERACTIONS = "interactions"
ASSETS = "assets"
TURNS = "turns"
STORES: tuple[str, ...] = (CORES, LEVELS, INTERACTIONS, ASSETS, TURNS)

#: The lifecycle words, shared with ``plexus/store.py`` so there is one vocabulary and not two.
PROVISIONAL = "provisional"
CANONICAL = "canonical"
SUPERSEDED = "superseded"
REJECTED = "rejected"

#: A row at the live pointer is one of these two. The database's partial unique index says the
#: same thing; this is what the SELECT filters on.
LIVE = (PROVISIONAL, CANONICAL)

#: The COMPLETE set of columns this module ever writes. Per store, because the five differ in
#: their key columns and in nothing else. A column absent from a store's tuple is never sent, so
#: widening what we persist is a deliberate edit here with a test to change.
_SPINE: tuple[str, ...] = (
    "key",
    "body",
    "version",
    "supersedes",
    "status",
    "judge_score",
    "judge",
    "model",
    "cost_usd",
    "provenance",
)
FIELDS: dict[str, tuple[str, ...]] = {
    CORES: (*_SPINE, "concept_id"),
    LEVELS: (*_SPINE, "concept_id", "board", "grade", "content_version", "modality"),
    INTERACTIONS: (*_SPINE, "concept_id", "kind", "is_template", "refresh_after"),
    ASSETS: (
        *_SPINE,
        "asset_kind",
        "concept_id",
        "subject",
        "board",
        "grade",
        "bucket",
        "object_path",
        "content_type",
        "byte_size",
        "sha256",
    ),
    TURNS: (*_SPINE, "question_norm", "board", "grade", "subject", "concept_id"),
}

_HTTP_TIMEOUT_S = 8.0
#: How long a serve counter may sit unflushed. Counters are not money and nothing waits on them,
#: so the flush is lazy and batched; a restart in the window loses at most this much counting,
#: which is the right thing to lose.
_SERVE_FLUSH_S = 20.0
_SERVE_BUFFER_MAX = 2000


# --- the transport --------------------------------------------------------------------------------
#
# The same shape ``ledger.py`` uses, and injectable for exactly the same reason: the suite must
# exercise every row and every code path in this module without a network and without a Postgres.

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


# --- what an operator can see about the stores themselves -----------------------------------------


@dataclass
class _Counters:
    """Where every answer came from, and what it saved.

    Honesty about our own cache: a hit rate computed by a cache that cannot say how many reads it
    dropped is a number nobody should act on. ``front`` and ``database`` are the two tiers of
    docs/CACHES.md §2; ``miss`` is a generation somebody paid for.
    """

    front: Counter[str] = field(default_factory=Counter)
    database: Counter[str] = field(default_factory=Counter)
    miss: Counter[str] = field(default_factory=Counter)
    written: Counter[str] = field(default_factory=Counter)
    #: What the rows served from the database cost to make. Every one of these is money a
    #: regeneration would have spent and did not.
    saved_usd: defaultdict[str, float] = field(default_factory=lambda: defaultdict(float))
    #: Rows served that carry no price. Counted, never valued at zero.
    saved_unpriced: Counter[str] = field(default_factory=Counter)
    errors: int = 0
    last_error: str | None = None
    serves_pending: int = 0
    serves_noted: int = 0
    serves_dropped: int = 0

    def as_dict(self) -> dict[str, Any]:
        stores: dict[str, Any] = {}
        for store in STORES:
            front = self.front[store]
            db = self.database[store]
            miss = self.miss[store]
            reads = front + db + miss
            stores[store] = {
                "reads": reads,
                "front_hits": front,
                "database_hits": db,
                "misses": miss,
                "written": self.written[store],
                # Two decimals is a hit rate; more is a false precision on counts this small.
                "hit_rate": round((front + db) / reads, 4) if reads else None,
                "saved_usd": round(self.saved_usd[store], 6),
                "saved_unpriced": self.saved_unpriced[store],
            }
        return {
            "stores": stores,
            "saved_usd_total": round(sum(self.saved_usd.values()), 6),
            "errors": self.errors,
            "last_error": self.last_error,
            "serves_pending": self.serves_pending,
            "serves_noted": self.serves_noted,
            "serves_dropped": self.serves_dropped,
        }


class _Stores:
    """One instance per process: the PostgREST client, the serve-counter buffer, the counters."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._transport: Transport | None = None
        self._base: str | None = None
        self._key: str | None = None
        self._counters = _Counters()
        self._serves: deque[tuple[str, str]] = deque()
        # NOW, not zero. A zero here made the very first serve "overdue" and flushed it
        # synchronously on the read path — the one thing this buffer exists to avoid.
        self._last_flush = time.monotonic()
        self._autoflush = True

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
            self._transport = None
            self._base = None
            self._key = None
            self._counters = _Counters()
            self._serves.clear()
            self._last_flush = time.monotonic()
            self._autoflush = True

    def _resolve(self) -> tuple[str | None, str | None, Transport | None]:
        """Configuration, explicit first and the environment second, read on every call.

        Read rather than cached at import for the reason ``ledger.py`` gives: the suite sets and
        clears the Supabase variables per test, and a value frozen at import time would make this
        module's behaviour depend on import order.
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
        """Is there a database to talk to at all?

        ``PLEXUS_STORES=off`` turns the whole seam off, which is how a deploy that suspects the
        stores of serving something wrong falls back to generating everything: dear, and always
        available. An injected transport counts as configured even with no URL — that is how the
        suite exercises every row this module builds without a network.
        """
        if (os.getenv("PLEXUS_STORES") or "").strip().lower() in {"off", "0", "false"}:
            return False
        base, key, transport = self._resolve()
        return bool(transport) and (self._transport is not None or bool(base and key))

    # -- the wire
    def _headers(self, *, write: bool) -> dict[str, str]:
        _base, key, _transport = self._resolve()
        headers = {
            "Content-Type": "application/json",
            # PostgREST picks the schema by header. Reads use Accept-Profile and writes
            # Content-Profile; both are sent because a single request may do either.
            "Accept-Profile": SCHEMA,
            "Content-Profile": SCHEMA,
        }
        if key:
            headers["apikey"] = key
            headers["Authorization"] = f"Bearer {key}"
        if write:
            # Return the inserted row so the caller learns its id without a second round trip —
            # the id is what a later ``supersedes`` and every serve count name.
            headers["Prefer"] = "return=representation"
        return headers

    def _call(
        self, method: str, path: str, *, body: Any = None, write: bool = False
    ) -> tuple[int, Any]:
        base, _key, transport = self._resolve()
        if transport is None:
            return 0, "no transport"
        url = f"{base or ''}{path}"
        payload = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        try:
            status, data = transport(method, url, self._headers(write=write), payload)
        except Exception as exc:  # a transport must never take a request down with it
            self._note_error(f"{type(exc).__name__}: {exc}")
            return 0, str(exc)
        if status >= 400 or status == 0:
            self._note_error(f"{method} {path} -> {status}: {str(data)[:200]}")
        return status, data

    def _note_error(self, detail: str) -> None:
        with self._lock:
            self._counters.errors += 1
            self._counters.last_error = detail[:300]
        logger.warning("plexus stores: %s", detail)

    # -- reading
    def read(self, store: str, key: str) -> dict[str, Any] | None:
        """The live row for a key, or None.

        CANONICAL BEFORE PROVISIONAL, and never a superseded or rejected row. The database's
        partial unique index already guarantees at most one live row per key, so the ordering is
        belt and braces for the window in which a promotion has inserted the canonical row and the
        trigger has not yet stamped the provisional one.
        """
        if store not in STORES or not key or not self.configured():
            return None
        query = urllib.parse.urlencode(
            {
                "key": f"eq.{key}",
                "status": f"in.({','.join(LIVE)})",
                "superseded_by": "is.null",
                # canonical sorts before provisional alphabetically, which is luck rather than
                # design, so the order is spelled out instead of relied upon.
                "order": "status.asc,created_at.desc",
                "limit": "1",
            }
        )
        status, data = self._call("GET", f"/rest/v1/{store}?{query}")
        if status != 200 or not isinstance(data, list) or not data:
            return None
        row = data[0]
        return row if isinstance(row, dict) else None

    def savings(self) -> list[dict[str, Any]] | None:
        """``content.store_savings``, as rows. None when the view could not be read at all —
        which a console must render as "we cannot see", never as a table of zeroes."""
        if not self.configured():
            return None
        status, data = self._call("GET", "/rest/v1/store_savings?order=store.asc")
        if status != 200 or not isinstance(data, list):
            return None
        return [row for row in data if isinstance(row, dict)]

    # -- writing
    def write(self, store: str, row: dict[str, Any]) -> dict[str, Any] | None:
        """Insert one row. Returns the inserted row (with its id) or None.

        Only the columns in :data:`FIELDS` for this store are sent, and a key the caller left
        empty is refused here rather than by the database — an insert with no key would sit in the
        table forever and never be found by a read.

        A UNIQUE VIOLATION IS A NORMAL OUTCOME, NOT AN ERROR. Two replicas that generated the same
        artifact at the same instant both try to insert it; one wins the partial unique index and
        the other is told 409. The loser reads the winner's row and serves it, which is the
        correct result and is why this returns the live row on a conflict rather than None.
        """
        if store not in STORES or not self.configured():
            return None
        key = str(row.get("key") or "").strip()
        if not key:
            logger.warning("plexus stores: refusing a %s row with no key", store)
            return None
        payload = {name: row.get(name) for name in FIELDS[store] if name in row}
        payload["key"] = key
        status, data = self._call("POST", f"/rest/v1/{store}", body=[payload], write=True)
        if status in (200, 201) and isinstance(data, list) and data:
            written = data[0]
            if isinstance(written, dict):
                with self._lock:
                    self._counters.written[store] += 1
                return written
            return None
        if status == 409:
            # Somebody else got there first. Their row is the live one.
            return self.read(store, key)
        return None

    # -- the serve counters
    def note_serve(self, store: str, row_id: str | None) -> None:
        """Remember that one stored row answered a request. Never blocks, never raises.

        Buffered and flushed in a batch, because a counter is worth strictly less than the answer
        the learner is waiting for. When the buffer is full the OLDEST entry is dropped and the
        drop is counted, so "the serve counts are low" is a thing an operator can see rather than
        a thing they assume.
        """
        if store not in STORES or not row_id or not self.configured():
            return
        with self._lock:
            if len(self._serves) >= _SERVE_BUFFER_MAX:
                self._serves.popleft()
                self._counters.serves_dropped += 1
            self._serves.append((store, str(row_id)))
            self._counters.serves_pending = len(self._serves)
            due = (time.monotonic() - self._last_flush) >= _SERVE_FLUSH_S
        if due and self._autoflush:
            # OFF THIS THREAD. A learner's request is what called us, and a counter is worth
            # strictly less than their answer: the flush goes to a short-lived daemon so a slow
            # database can never add itself to a turn's latency. A daemon dying with the process
            # loses at most one batch of counts, which is the right thing to lose.
            threading.Thread(
                target=self._flush_quietly, name="wobo-stores-serves", daemon=True
            ).start()

    def _flush_quietly(self) -> None:
        with contextlib.suppress(Exception):
            self.flush_serves()

    def flush_serves(self) -> int:
        """Send the buffered serve counts. Returns how many (store, id) pairs were sent.

        Called on a cadence from :func:`note_serve` and explicitly by the suite. It runs on
        whichever thread happened to trip the cadence, which is acceptable precisely because
        nothing is waiting on the result: the read has already been served by the time this runs.
        """
        with self._lock:
            pending = list(self._serves)
            self._serves.clear()
            self._counters.serves_pending = 0
            self._last_flush = time.monotonic()
        if not pending:
            return 0
        batched: dict[str, Counter[str]] = defaultdict(Counter)
        for store, row_id in pending:
            batched[store][row_id] += 1
        sent = 0
        for store, counts in batched.items():
            ids = list(counts)
            body = {
                "p_store": store,
                "p_ids": ids,
                "p_counts": [counts[i] for i in ids],
            }
            status, _data = self._call("POST", "/rest/v1/rpc/note_serves", body=body, write=False)
            if status in (200, 204):
                sent += len(ids)
                with self._lock:
                    self._counters.serves_noted += sum(counts.values())
            else:
                with self._lock:
                    self._counters.serves_dropped += sum(counts.values())
        return sent

    # -- the counters an operator reads
    def note_front_hit(self, store: str) -> None:
        with self._lock:
            self._counters.front[store] += 1

    def note_database_hit(self, store: str, cost_usd: float | None) -> None:
        """A database hit is money not spent: the row already exists, so nothing was generated."""
        with self._lock:
            self._counters.database[store] += 1
            if cost_usd is None:
                self._counters.saved_unpriced[store] += 1
            else:
                self._counters.saved_usd[store] += float(cost_usd)

    def note_miss(self, store: str) -> None:
        with self._lock:
            self._counters.miss[store] += 1

    def state(self) -> dict[str, Any]:
        with self._lock:
            snapshot = self._counters.as_dict()
        snapshot["configured"] = self.configured()
        return snapshot


_STORES = _Stores()


# --- the module surface ---------------------------------------------------------------------------
#
# Module-level functions over one instance, the way ``ledger.py`` and ``spend.py`` are reached.
# Callers never hold the object, so there is no way for two halves of the gateway to end up with
# two different sets of counters.


def configure(**kwargs: Any) -> None:
    _STORES.configure(**kwargs)


def reset() -> None:
    _STORES.reset()


def configured() -> bool:
    return _STORES.configured()


def read(store: str, key: str) -> dict[str, Any] | None:
    return _STORES.read(store, key)


def write(store: str, row: dict[str, Any]) -> dict[str, Any] | None:
    return _STORES.write(store, row)


def note_serve(store: str, row_id: str | None) -> None:
    _STORES.note_serve(store, row_id)


def flush_serves() -> int:
    return _STORES.flush_serves()


def note_front_hit(store: str) -> None:
    _STORES.note_front_hit(store)


def note_database_hit(store: str, cost_usd: float | None = None) -> None:
    _STORES.note_database_hit(store, cost_usd)


def note_miss(store: str) -> None:
    _STORES.note_miss(store)


def savings() -> list[dict[str, Any]] | None:
    return _STORES.savings()


def state() -> dict[str, Any]:
    return _STORES.state()


# --- turning a plexus record into a store row --------------------------------------------------
#
# The file cache's record shape (concept, modality, difficulty, provenance, status, …) and the
# store's column shape are not the same thing, and the translation lives here rather than in
# ``store.py`` so that file keeps knowing only about files.


def _cost_of(record: dict[str, Any]) -> float | None:
    """What this artifact cost to make, from wherever the generator recorded it.

    ``None`` and not ``0.0`` when nobody recorded a figure. A zero here would flow straight into
    ``saved_usd`` and every store would look free forever, which is the exact dishonesty
    ``ledger.py`` refuses when it keeps ``unpriced`` as its own answer.
    """
    for holder in (record, record.get("provenance") or {}):
        if not isinstance(holder, dict):
            continue
        for name in ("cost_usd", "costUsd", "cost"):
            raw = holder.get(name)
            if raw is None:
                continue
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            if value >= 0:
                return value
    return None


def _judge_of(record: dict[str, Any]) -> tuple[float | None, dict[str, Any]]:
    """The judge's score and the judge's own record, or ``(None, {})`` when it has not run.

    The migration refuses a CANONICAL row with no score (ruling 4), so a record promoted without
    one is refused at the database rather than stored unjudged — which is the point of the gate.
    """
    judge = record.get("validation") or record.get("judge") or {}
    if not isinstance(judge, dict):
        return None, {}
    for name in ("score", "judge_score", "overall"):
        raw = judge.get(name)
        if raw is None:
            continue
        try:
            return float(raw), judge
        except (TypeError, ValueError):
            continue
    return None, judge


def row_for_level(
    key: str, record: dict[str, Any], *, concept_id: str, scope: dict[str, str] | None
) -> dict[str, Any]:
    """A ``content.levels`` row built from one plexus artifact record.

    Levels is where the file cache's artifacts land, because a plexus artifact IS a level
    rendering: one concept, at one board and one class, in one modality. Cores, interactions,
    assets and turns are written by their own producers through :func:`write`.
    """
    s = scope or {}
    score, judge = _judge_of(record)
    provenance = record.get("provenance") if isinstance(record.get("provenance"), dict) else {}
    return {
        "key": key,
        "concept_id": concept_id,
        # The migration requires a board and a grade. An unscoped call (a test, an internal
        # reindex) has neither, and "" is the honest spelling of that: it keys distinctly from
        # every real board and never masquerades as one.
        "board": str(s.get("board") or ""),
        "grade": str(s.get("grade") or ""),
        "content_version": str(s.get("contentVersion") or "") or None,
        "modality": str(record.get("modality") or "reading"),
        "body": record,
        "status": str(record.get("status") or CANONICAL),
        "judge_score": score,
        "judge": judge,
        "model": str((provenance or {}).get("model") or "") or None,
        "cost_usd": _cost_of(record),
        "provenance": provenance,
    }
