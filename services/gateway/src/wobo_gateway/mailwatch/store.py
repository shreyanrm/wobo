"""What the watch knows, in one append-only table (``ops.mail_watch``, migration 0036).

ONE TABLE FOR EVERY FACT, as ``ops.mail_log`` is for every send: a provider's delivery event, a
suppressed address, a seed's placement, a Postmaster day and an alert are all "something the watch
learned about our mail at this time", and every one of them has exactly one natural key:

==============  ========================================  =====================================
``what``        ``key``                                   what makes it once-only
==============  ========================================  =====================================
delivery        ``delivery:<provider message id>``        the provider retries; the id is signed
suppression     ``suppression:<address digest>``          an address is suppressed once, for ever
placement       ``placement:<day>:<inbox>:<kind>:<step>`` one send and one read a day per seed
postmaster      ``postmaster:<day>:<domain>``             one reading of Google's day
alert           ``alert:<cause>:<kind>:<hour>``           one bad hour is one alert
==============  ========================================  =====================================

So a retried webhook and a second cron pass are harmless twice over: in memory, and in the table,
whose unique key the write asks PostgREST to ignore a duplicate of.

NEVER AN ADDRESS. ``to_hash`` is the same digest the mail log keeps (``email.to_hash``), and a
suppression is keyed on it. A suppression list of addresses would be a list of the parents who
complained about us, which is exactly the kind of table that must not exist.

Reads stay in memory: the instance primes EVERY suppression the table holds, however old, and the
last :data:`PRIME_DAYS` of everything else, so a deploy never makes a complainer reachable again
and no rule costs a network hop. The read is paged (:data:`PAGE_ROWS` a page, in the table's own
order), because the project answers at most its "max rows" to one request and a read that
stopped there forgot the newest complainers (2026-09-16).

A table that cannot be reached is ``readable = False``, never an exception into a send, and it is
read again at most every :data:`RETRY_S` until it answers. While it cannot be read, nobody can
say who complained, so the send path holds every mail but sign-in codes, receipts and the owner's
alert, and the owner is told (``email.suppression_list_unreadable``).
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger("wobo.gateway.mailwatch")

DELIVERY = "delivery"
SUPPRESSION = "suppression"
PLACEMENT = "placement"
POSTMASTER = "postmaster"
ALERT = "alert"
#: Everything a row can be. Migration 0036 checks the same list.
WHATS: tuple[str, ...] = (DELIVERY, SUPPRESSION, PLACEMENT, POSTMASTER, ALERT)
#: Every column the store writes. The table adds its own ``id`` and ``at``.
COLUMNS: tuple[str, ...] = ("what", "key", "happened_at", "kind", "event", "to_hash", "detail")
#: How far back an instance reads what is not a suppression. The widest rule looks back a week
#: (the complaint window); forty days leaves the desk a month and a clock that disagrees.
PRIME_DAYS = 40
#: One page of the startup read. Supabase's default "max rows" is 1000, and a page never asks for
#: more than the project will give.
PAGE_ROWS = 1000
#: A bound on the pages of one read, so a project that ignores the offset cannot hold a start.
MAX_PAGES = 1000
#: How often a table that could not be read is tried again.
RETRY_S = 30.0

_SCHEMA = "ops"
_TABLE = "mail_watch"
_HTTP_TIMEOUT_S = 10.0
_DIGEST = re.compile(r"^[0-9a-f]{8,64}$")


def _when(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


@dataclass(frozen=True)
class WatchRow:
    """One fact. ``at`` is when it HAPPENED (the provider's clock, or the clock a job was
    handed), which is what every window is measured on."""

    what: str
    key: str
    at: datetime
    kind: str = ""
    event: str = ""
    to_hash: str = ""
    detail: dict[str, Any] = field(default_factory=dict)

    def wire(self) -> dict[str, Any]:
        return {
            "what": self.what,
            "key": self.key,
            "happened_at": self.at.astimezone(UTC).isoformat(),
            "kind": self.kind,
            "event": self.event,
            "to_hash": self.to_hash or None,
            "detail": self.detail,
        }

    @classmethod
    def from_wire(cls, row: Any) -> WatchRow | None:
        if not isinstance(row, dict):
            return None
        what, key, at = row.get("what"), row.get("key"), _when(row.get("happened_at"))
        if what not in WHATS or not isinstance(key, str) or not key or at is None:
            return None
        detail = row.get("detail")
        return cls(
            what=str(what),
            key=key,
            at=at,
            kind=str(row.get("kind") or ""),
            event=str(row.get("event") or ""),
            to_hash=str(row.get("to_hash") or ""),
            detail=detail if isinstance(detail, dict) else {},
        )


class WatchStore:
    """The suite's store and a local run's, and the memory behind the project's."""

    #: Could the store be read when it started? The desk shows "unreadable" rather than zeroes.
    readable: bool = True

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_key: dict[str, WatchRow] = {}
        self._suppressed: set[str] = set()

    def _keep(self, row: WatchRow) -> bool:
        with self._lock:
            if row.key in self._by_key:
                return False
            self._by_key[row.key] = row
            if row.what == SUPPRESSION and row.to_hash:
                self._suppressed.add(row.to_hash)
            return True

    def add(self, row: WatchRow) -> bool:
        """Keep ``row``. ``False`` when its key is already known: the fact is already here."""
        return self._keep(row)

    def ensure_readable(self) -> bool:
        """Is what this store holds the whole truth? Always, in memory."""
        return bool(self.readable)

    def has(self, key: str) -> bool:
        with self._lock:
            return key in self._by_key

    def rows(self, what: str, *, since: datetime | None = None) -> list[WatchRow]:
        """Every row of one kind, oldest first, at or after ``since``."""
        floor = since.astimezone(UTC) if since is not None else None
        with self._lock:
            found = [
                r
                for r in self._by_key.values()
                if r.what == what and (floor is None or r.at >= floor)
            ]
        return sorted(found, key=lambda r: (r.at, r.key))

    def is_suppressed(self, digest: str) -> bool:
        with self._lock:
            return digest in self._suppressed

    def suppressed_count(self) -> int:
        with self._lock:
            return len(self._suppressed)

    def suppress(
        self,
        digest: str,
        *,
        reason: str,
        kind: str,
        at: datetime,
        detail: dict[str, Any] | None = None,
    ) -> bool:
        """Suppress one address, by digest, for every non-transactional kind, for ever.

        Refused for anything that is not a digest: a raw address must never reach this table.
        """
        if not _DIGEST.match(digest or ""):
            return False
        return self.add(
            WatchRow(
                what=SUPPRESSION,
                key=f"{SUPPRESSION}:{digest}",
                at=at,
                kind=kind,
                event=reason,
                to_hash=digest,
                detail=detail or {},
            )
        )


# --- the table ------------------------------------------------------------------------------------
def _rest(url: str, key: str, method: str, *, body: Any = None, prefer: str = "") -> Any:
    """One PostgREST call with the service-role key. Split out so tests need no database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
        "Prefer": prefer or "return=minimal",
    }
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
    return json.loads(raw) if raw.strip() else []


class DatabaseWatchStore(WatchStore):
    """The same store with ``ops.mail_watch`` behind it: primed at start, written through."""

    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        request: Callable[..., Any] | None = None,
        now: datetime | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        super().__init__()
        self.base = base_url.rstrip("/")
        self._key = service_key
        # Looked up at call time, so a test that replaces the module's transport replaces it here.
        self._request = request or (lambda *a, **k: _rest(*a, **k))
        self._clock = clock or time.monotonic
        self._primed_at = self._clock()
        self._priming = threading.Lock()
        self.readable = self._prime(now or datetime.now(UTC))

    def ensure_readable(self) -> bool:
        """Read the table again if the last read failed and :data:`RETRY_S` has passed.

        One blip at start used to leave the instance believing nobody had ever complained until
        the next restart (2026-09-16).
        """
        if self.readable:
            return True
        if not self._priming.acquire(blocking=False):
            return False
        try:
            if self.readable or self._clock() - self._primed_at < RETRY_S:
                return bool(self.readable)
            self._primed_at = self._clock()
            self.readable = self._prime(datetime.now(UTC))
            if self.readable:
                logger.info("mail watch: the table answered on a later read")
            return self.readable
        finally:
            self._priming.release()

    def is_suppressed(self, digest: str) -> bool:
        self.ensure_readable()
        return super().is_suppressed(digest)

    def suppressed_count(self) -> int:
        self.ensure_readable()
        return super().suppressed_count()

    def rows(self, what: str, *, since: datetime | None = None) -> list[WatchRow]:
        self.ensure_readable()
        return super().rows(what, since=since)

    def _read_all(self, params: dict[str, str]) -> list[Any]:
        """Every row the filter matches, a page at a time in the table's own order. Stops on an
        empty page, or on a page with nothing new (a project that ignores the offset)."""
        found: list[Any] = []
        keys: set[Any] = set()
        offset = 0
        for _ in range(MAX_PAGES):
            page = self._request(
                self._url(
                    {**params, "order": "id.asc", "limit": str(PAGE_ROWS), "offset": str(offset)}
                ),
                self._key,
                "GET",
            )
            if not isinstance(page, list):
                raise ValueError("the table answered with something that is not rows")
            fresh = [r for r in page if not (isinstance(r, dict) and r.get("key") in keys)]
            if not fresh:
                break
            for row in fresh:
                if isinstance(row, dict):
                    keys.add(row.get("key"))
            found.extend(fresh)
            offset += len(page)
        return found

    def _url(self, params: dict[str, str] | None = None) -> str:
        query = f"?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else ""
        return f"{self.base}/rest/v1/{_TABLE}{query}"

    def _prime(self, now: datetime) -> bool:
        select = ",".join(COLUMNS)
        floor = (now.astimezone(UTC) - timedelta(days=PRIME_DAYS)).isoformat()
        try:
            suppressed = self._read_all({"select": select, "what": f"eq.{SUPPRESSION}"})
            recent = self._read_all(
                {"select": select, "what": f"neq.{SUPPRESSION}", "happened_at": f"gte.{floor}"}
            )
        except Exception as exc:  # noqa: BLE001 — an unreachable table is an empty memory
            logger.warning(
                "mail watch: could not prime", extra={"fields": {"error": type(exc).__name__}}
            )
            return False
        for raw in (*suppressed, *recent):
            row = WatchRow.from_wire(raw)
            if row is not None:
                self._keep(row)
        return True

    def add(self, row: WatchRow) -> bool:
        new = self._keep(row)
        if new:
            try:
                self._request(
                    self._url({"on_conflict": "key"}),
                    self._key,
                    "POST",
                    body=[row.wire()],
                    prefer="resolution=ignore-duplicates,return=minimal",
                )
            except Exception as exc:  # noqa: BLE001 — the fact is kept; losing its record must not raise
                logger.warning(
                    "mail watch: could not write through",
                    extra={"fields": {"what": row.what, "error": type(exc).__name__}},
                )
        return new


def build_store() -> WatchStore:
    """The project's table when one is configured, memory otherwise.

    ``MAIL_WATCH_STORE=memory`` asks for memory BY NAME, which is what the suite uses. The default
    is the table because the default is what production gets, and production is where a
    forgotten suppression means mailing somebody who asked us to stop.
    """
    if (os.getenv("MAIL_WATCH_STORE") or "").strip().lower() == "memory":
        return WatchStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return DatabaseWatchStore(base, key)
    return WatchStore()


_store: WatchStore | None = None
_store_lock = threading.Lock()


def get_store() -> WatchStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = build_store()
        return _store


def set_store(value: WatchStore | None) -> None:
    """Test seam. ``None`` builds a fresh one on the next use."""
    global _store
    with _store_lock:
        _store = value


__all__ = [
    "ALERT",
    "COLUMNS",
    "DELIVERY",
    "MAX_PAGES",
    "PAGE_ROWS",
    "RETRY_S",
    "POSTMASTER",
    "PLACEMENT",
    "PRIME_DAYS",
    "SUPPRESSION",
    "WHATS",
    "DatabaseWatchStore",
    "WatchRow",
    "WatchStore",
    "build_store",
    "get_store",
    "set_store",
]
