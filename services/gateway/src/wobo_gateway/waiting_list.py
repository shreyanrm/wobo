"""The list that stands where the door was — ``POST /v1/waiting-list``.

``docs/DOORS-CLOSED.md`` §3. A closed door that says nothing wastes every visitor 438 public
pages earn, so the door does not close: it changes what it opens onto. Where "Start free" stands,
a person is asked for one thing, **an email address**, and optionally **their class and board**,
and is told plainly that Wobo is not open yet and that they will hear the day it is.

**What this door will and will not take.**

* Two fields at most, and the second is optional. There is no name, no date of birth and no age
  anywhere in the body, and an unknown field is REFUSED rather than quietly dropped. That is how
  "under 13 the address is the parent's, and no child's address is taken at all" is held: not by
  promising it, but by leaving nowhere for a child's details to land. The web door asks a parent
  for their own address; this door could not tell the difference and does not try to, because
  every field that would let it tell is a field about a child.
* The class and the board are worth having, and only those two: they say which boards to read
  first, which is exactly the queue in ``docs/BOARD-COLD-START.md``.
* The page they came from, as a PATH and never a full address with a query string on it.
* When they asked.
* A one-way digest of the address, for de-duplication. The same address twice is one person.

**Screened for shape and abuse exactly as the public ask box is** (:mod:`wobo_gateway.ask_public`):
a per-client allowance keyed on a salted hash of address and user agent, never on the address
itself; a global daily ceiling so a bot that rotates what it calls itself still cannot fill the
table; and the door's own per-address limiter in front of all of it. A repeat of an address
already on the list does not spend the allowance, because somebody pressing a button twice
because nothing seemed to happen has not abused anything.

**What it never says.** No waiting number, no queue position, no invented scarcity, and no
answer that differs between an address that is already on the list and one that is not — that
difference is an enumeration oracle over other people's addresses and it is free to build. The
console shows the size of the list; a visitor never does.

The row lands in ``growth.waiting_list`` (migration 0025), which takes the admin register's
posture: its schema is closed to every client role, RLS is on and forced, and a row cannot be
edited once written. It CAN be deleted with the service role, because the address is deletable on
request like everything else we hold.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import threading
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("wobo.gateway.waiting_list")

SCHEMA = "growth"
TABLE = "waiting_list"
_HTTP_TIMEOUT_S = 5.0

PATH = "/v1/waiting-list"
#: Open: nobody at this box has an account, and the whole point is that they cannot get one yet.
OPEN_PATHS: frozenset[str] = frozenset({PATH})
#: Open is not free. It rides the door's per-address limiter before its own allowance is asked.
LIMITED_PATHS: frozenset[str] = OPEN_PATHS

MAX_EMAIL = 320
MAX_CLASS = 16
MAX_BOARD = 64
MAX_PAGE = 200

#: An address we could actually write to: no quoted local part, exactly one ``@``, and a domain
#: of dot-separated labels with no empty one. The same expression :mod:`wobo_gateway.parents`
#: uses, and for the same reason: ``a@b..com`` is a typo, not a person.
_EMAIL_RE = re.compile(r'^[^@\s"]+@[^@\s.]+(?:\.[^@\s.]+)+$')
#: A class as a person writes it: "9", "class 9", "XII". Letters, digits and single spaces.
_CLASS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ]{0,15}$")
#: A board's name: CBSE, ICSE, Maharashtra State Board, Cambridge (IGCSE).
_BOARD_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .&()/-]{0,63}$")
#: The page they came from, as our own site writes it: a path, never a full address, never a
#: query string. A visitor's referrer is not to be trusted with either.
_PAGE_RE = re.compile(r"^/[A-Za-z0-9._~/-]{0,199}$")

# --- the dials -----------------------------------------------------------------------------------
_DIALS: dict[str, tuple[str, int]] = {
    "hour": ("WAITING_LIST_HOURLY_PER_CLIENT", 3),
    "day": ("WAITING_LIST_DAILY_PER_CLIENT", 10),
    "global": ("WAITING_LIST_DAILY_GLOBAL", 5000),
}


def _dial(name: str) -> int:
    env, default = _DIALS[name]
    raw = os.getenv(env)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


_clock: Callable[[], datetime] = lambda: datetime.now(UTC)  # noqa: E731


def set_clock(clock: Callable[[], datetime] | None) -> None:
    """Test seam: replace what "now" means. ``None`` restores the real clock."""
    global _clock
    _clock = clock or (lambda: datetime.now(UTC))


def _now() -> datetime:
    return _clock().astimezone(UTC)


# --- the one-way digest --------------------------------------------------------------------------
#: The domain string keeps this digest from ever being the same value as any other digest we take
#: of the same address, so a leak of one table cannot be joined to another by matching them.
_DIGEST_DOMAIN = b"wobo.waiting-list.email.v1"


def _pepper() -> bytes | None:
    """The key the digest is taken under. A digest with no key is not one.

    An unkeyed SHA-256 of an email address is one rainbow table away from being the address, and
    a table of them is a mailing list anybody who reads a backup can use. So a pepper is
    required, and without one the list REFUSES rather than storing a digest that protects
    nothing. The fallbacks are the secrets this process already holds and that are stable across
    restarts and replicas, which are the two properties a de-duplication key actually needs;
    ``MAIL_TOKEN_SECRET`` derives from the last of them in exactly the same way.
    """
    raw = (
        os.getenv("WAITING_LIST_PEPPER")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_JWT_SECRET")
        or ""
    ).strip()
    return raw.encode() if raw else None


def digest(email: str) -> str | None:
    """The de-duplication key for an address, or ``None`` when no pepper is configured."""
    pepper = _pepper()
    if not pepper:
        return None
    return hmac.new(pepper, _DIGEST_DOMAIN + email.encode(), hashlib.sha256).hexdigest()


#: Salted like ``app._IP_LOG_SALT`` and for the same reason: a bare digest of an IPv4 address is
#: a rainbow table away from the address. With no salt configured the key is per-process, which
#: is exactly as long as the in-process meter lives.
_SALT = os.getenv("IP_LOG_SALT", "").encode() or os.urandom(16)


def client_key(request: Request) -> str:
    """Who is asking, as the allowance counts them: a salted hash of address and user agent.

    The address comes from the door's own derivation (``request.state.meter_key``, which honours
    ``TRUST_PROXY`` and takes the LAST forwarded hop, the one our own platform wrote). This
    module never reads a forwarded header itself: the first hop is whatever the caller typed, and
    keying on it would hand a bot a fresh bucket for every request it made. Exactly
    ``ask_public.client_key``, so the two doors on a public page count the same visitor the same
    way, and the raw address is hashed rather than kept.
    """
    address = getattr(request.state, "meter_key", None) or (
        request.client.host if request.client else "unknown"
    )
    agent = (request.headers.get("user-agent") or "")[:256]
    return hashlib.blake2b(
        f"{address}\n{agent}".encode(), key=_SALT[:64], digest_size=12
    ).hexdigest()


# --- the row -------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Entry:
    """One row of ``growth.waiting_list`` as the gateway writes it."""

    id: str
    email: str
    email_hash: str
    klass: str | None = None
    board: str | None = None
    source_path: str | None = None
    created_at: datetime | None = None


def to_row(entry: Entry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "email": entry.email,
        "email_hash": entry.email_hash,
        # ``class`` is a reserved word in more places than it is worth arguing with, and the
        # column is named for what it holds.
        "class_name": entry.klass,
        "board": entry.board,
        "source_path": entry.source_path,
        "created_at": (entry.created_at or _now()).astimezone(UTC).isoformat(),
    }


# --- what somebody typed -------------------------------------------------------------------------
class NotAnAddress(ValueError):
    """The one thing we ask for was not the thing we asked for."""


def normalise_email(raw: Any) -> str:
    address = str(raw or "").strip().lower()
    if not address or len(address) > MAX_EMAIL or not _EMAIL_RE.match(address):
        raise NotAnAddress("I need an email address I can write to.")
    return address


def normalise_class(raw: Any) -> str | None:
    """Optional, and DROPPED rather than refused when it is not a class.

    A refusal here would lose the address, which is the field that matters, over a field the
    person was told was optional.
    """
    text = str(raw or "").strip()
    return text if text and len(text) <= MAX_CLASS and _CLASS_RE.match(text) else None


def normalise_board(raw: Any) -> str | None:
    text = str(raw or "").strip()
    return text if text and len(text) <= MAX_BOARD and _BOARD_RE.match(text) else None


def normalise_page(raw: Any) -> str | None:
    text = str(raw or "").strip()
    return text if text and len(text) <= MAX_PAGE and _PAGE_RE.match(text) else None


# --- the store seam ------------------------------------------------------------------------------
class ListUnavailable(Exception):
    """The list could not be reached. We say so; we never say we kept an address we did not."""


class WaitingListStore(Protocol):
    def insert(self, entry: Entry) -> bool:
        """``True`` when a row was written, ``False`` when this address was already on the list."""
        ...

    def size(self) -> int: ...

    def remove(self, entry_id: str) -> bool:
        """Delete one row by its id. ``True`` when a row went, ``False`` when there was none."""
        ...


class InMemoryWaitingListStore:
    """The suite's store and a local run's. Asked for BY NAME (``WAITING_LIST_STORE=memory``)."""

    def __init__(self) -> None:
        self.rows: list[Entry] = []
        self._seen: set[str] = set()
        self._lock = threading.Lock()

    def insert(self, entry: Entry) -> bool:
        with self._lock:
            if entry.email_hash in self._seen:
                return False
            self._seen.add(entry.email_hash)
            self.rows.append(entry)
            return True

    def size(self) -> int:
        with self._lock:
            return len(self.rows)

    def remove(self, entry_id: str) -> bool:
        with self._lock:
            gone = [row for row in self.rows if row.id == entry_id]
            self.rows = [row for row in self.rows if row.id != entry_id]
            for row in gone:
                self._seen.discard(row.email_hash)
            return bool(gone)


class UnconfiguredWaitingListStore:
    """No project. Every write REFUSES, and the person is told honestly."""

    def insert(self, entry: Entry) -> bool:
        raise ListUnavailable("no project is configured, so there is no list to join")

    def size(self) -> int:
        raise ListUnavailable("no project is configured, so there is no list to count")

    def remove(self, entry_id: str) -> bool:
        raise ListUnavailable("no project is configured, so there is no list to take anyone off")


def _request(url: str, key: str, method: str, *, body: Any = None) -> tuple[int, Any]:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Profile": SCHEMA,
        "Content-Profile": SCHEMA,
        # ``ignore-duplicates`` is the de-duplication, done by the unique index rather than by a
        # read-then-write pair that two requests can interleave through.
        "Prefer": "resolution=ignore-duplicates,return=representation",
    }
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
        return response.status, (json.loads(raw) if raw.strip() else [])


class PostgrestWaitingListStore:
    """``growth.waiting_list`` over PostgREST with the service-role key. Server-side only."""

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        self.base = base_url.rstrip("/")
        self.key = service_key
        self._request = request or _request

    def _url(self, params: dict[str, str] | None = None) -> str:
        query = f"?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else ""
        return f"{self.base}/rest/v1/{urllib.parse.quote(TABLE)}{query}"

    def insert(self, entry: Entry) -> bool:
        try:
            _status, rows = self._request(
                self._url({"on_conflict": "email_hash"}), self.key, "POST", body=[to_row(entry)]
            )
        except Exception as exc:  # noqa: BLE001 — every failure here is one failure to the caller
            raise ListUnavailable(str(exc)) from exc
        # Nothing came back: the unique index already held this address.
        return bool(isinstance(rows, list) and rows)

    def size(self) -> int:
        try:
            _status, rows = self._request(
                self._url({"select": "id", "limit": "1"}), self.key, "GET"
            )
        except Exception as exc:  # noqa: BLE001
            raise ListUnavailable(str(exc)) from exc
        return len(rows) if isinstance(rows, list) else 0

    def remove(self, entry_id: str) -> bool:
        try:
            _status, rows = self._request(self._url({"id": f"eq.{entry_id}"}), self.key, "DELETE")
        except Exception as exc:  # noqa: BLE001
            raise ListUnavailable(str(exc)) from exc
        return bool(isinstance(rows, list) and rows)


_store: WaitingListStore | None = None
_store_lock = threading.Lock()


def build_store() -> WaitingListStore:
    """The project store when one is configured, the memory store when it is asked for BY NAME."""
    if (os.getenv("WAITING_LIST_STORE") or "").strip().lower() == "memory":
        return InMemoryWaitingListStore()
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    if base and key:
        return PostgrestWaitingListStore(base, key)
    logger.warning("waiting list: no project configured — the door refuses rather than dropping")
    return UnconfiguredWaitingListStore()


def get_store() -> WaitingListStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: WaitingListStore | None) -> None:
    """Test seam. ``None`` drops the singleton so the next call rebuilds from the environment."""
    global _store
    with _store_lock:
        _store = store


# --- the allowance -------------------------------------------------------------------------------
class Refused(Exception):
    def __init__(self, code: str, message: str, *, status: int = 429) -> None:
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


@dataclass
class _Window:
    started: datetime
    count: int


class Meter:
    """Per client, and once globally. In process, exactly as ``ask_public``'s meter is.

    ponytail: one instance today. The upgrade path is the same Redis the budget meter takes, and
    the door's own per-address limiter is what bounds a flood across replicas until then.
    """

    def __init__(self) -> None:
        self._hour: dict[str, _Window] = {}
        self._day: dict[str, _Window] = {}
        self._global = _Window(started=_now(), count=0)
        self._lock = threading.Lock()

    @staticmethod
    def _step(window: _Window | None, span: timedelta, now: datetime) -> _Window:
        if window is None or (now - window.started) >= span:
            return _Window(started=now, count=0)
        return window

    def check(self, key: str) -> None:
        """Raise :class:`Refused` when this caller has had enough for now. Counts nothing."""
        now = _now()
        with self._lock:
            hour = self._step(self._hour.get(key), timedelta(hours=1), now)
            day = self._step(self._day.get(key), timedelta(days=1), now)
            world = self._step(self._global, timedelta(days=1), now)
            self._hour[key], self._day[key], self._global = hour, day, world
        if hour.count >= _dial("hour") or day.count >= _dial("day"):
            raise Refused(
                "enough_for_now",
                "I have taken a few from you already. Try me again a bit later.",
            )
        if world.count >= _dial("global"):
            raise Refused(
                "enough_for_now",
                "A lot of people are joining just now. Try me again a bit later.",
            )

    def spend(self, key: str) -> None:
        """Count one. Called only when a row was actually written, never for a repeat."""
        with self._lock:
            for bucket in (self._hour.get(key), self._day.get(key), self._global):
                if bucket is not None:
                    bucket.count += 1
            if len(self._hour) > 8192:
                self._hour.clear()
                self._day.clear()

    def reset(self) -> None:
        with self._lock:
            self._hour.clear()
            self._day.clear()
            self._global = _Window(started=_now(), count=0)


_meter = Meter()


def meter() -> Meter:
    return _meter


def reset_meter() -> None:
    """Test seam, and what a restart does anyway."""
    _meter.reset()


# --- joining -------------------------------------------------------------------------------------
def join(
    store: WaitingListStore,
    *,
    email: str,
    klass: str | None = None,
    board: str | None = None,
    page: str | None = None,
) -> bool:
    """Write one row, or notice the address is already there. Never says which to the caller."""
    key = digest(email)
    if key is None:
        raise ListUnavailable("no pepper is configured, so the de-duplication key cannot be taken")
    return store.insert(
        Entry(
            id=str(uuid.uuid4()),
            email=email,
            email_hash=key,
            klass=klass,
            board=board,
            source_path=page,
            created_at=_now(),
        )
    )


# --- the way off the list ------------------------------------------------------------------------
#: The stop token's audience for a list row (hospitality/tokens.py).
STOP_AUDIENCE = "waiting_list"


def stop_link(entry_id: str) -> str | None:
    """The launch mail's signed way out for one row, or ``None`` when no token can be minted.

    The people on this list have no account, so a page behind a sign-in is no way out for them
    and a bare stop route is a dead link (the closer's run, 2026-09-17). The link names the row,
    the stop route asks on a GET and deletes the row on a POST, and a launch send without one is
    held (``email.send_email``)."""
    from wobo_gateway.hospitality.tokens import stop_link as signed

    return signed(entry_id, STOP_AUDIENCE)


def remove(entry_id: str) -> bool:
    """Take one row off the list. :class:`ListUnavailable` when the list cannot be reached."""
    return get_store().remove(entry_id)


# --- the body ------------------------------------------------------------------------------------
class JoinBody(BaseModel):
    """Two fields at most, and the second is optional.

    ``extra="forbid"`` is the load-bearing line in this file. It is what makes it true that no
    date of birth, no name and no age can arrive at this door: not a promise, a refusal.

    No ``max_length`` on any field, deliberately. The bytes are already bounded by the door's own
    request ceiling (``app._MAX_BODY_BYTES``), and a length checked HERE would answer a long
    address with pydantic's own validation shape instead of this module's one honest code. Every
    normaliser below checks its length before it runs a pattern, so nothing long ever reaches a
    regular expression either.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    email: str
    klass: str | None = Field(default=None, alias="class")
    board: str | None = None
    page: str | None = None


#: What a person is told, and it promises exactly one thing because exactly one thing happens.
#: No number, no position, no "soon" (DOORS-CLOSED §3, docs/copy/voice.md §6).
KEPT_LINE = "You are on the list. I will write to you once, the day Wobo opens, and not otherwise."


def register_waiting_list(app: FastAPI) -> None:
    """``POST /v1/waiting-list``. Called once from ``app.create_app``."""

    @app.post(PATH)
    def join_the_list(body: JoinBody, request: Request) -> dict[str, str]:
        try:
            email = normalise_email(body.email)
        except NotAnAddress as exc:
            raise HTTPException(
                status_code=422, detail={"code": "not_an_address", "message": str(exc)}
            ) from exc
        key = client_key(request)
        try:
            _meter.check(key)
        except Refused as exc:
            raise HTTPException(
                status_code=exc.status, detail={"code": exc.code, "message": exc.message}
            ) from exc
        try:
            written = join(
                get_store(),
                email=email,
                klass=normalise_class(body.klass),
                board=normalise_board(body.board),
                page=normalise_page(body.page),
            )
        except ListUnavailable as exc:
            logger.warning("waiting list: not written", extra={"fields": {"error": str(exc)}})
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "list_unavailable",
                    "message": "I could not save that just now. Try me again in a moment.",
                },
            ) from exc
        if written:
            _meter.spend(key)
        # The same answer either way. A different one would tell a stranger whether an address is
        # already on the list, which is somebody else's business and nobody's to hand out.
        logger.info(
            "waiting list: joined",
            extra={"fields": {"new": written, "page": normalise_page(body.page)}},
        )
        return {"code": "on_the_list", "message": KEPT_LINE}


__all__ = [
    "LIMITED_PATHS",
    "MAX_EMAIL",
    "OPEN_PATHS",
    "PATH",
    "Entry",
    "InMemoryWaitingListStore",
    "JoinBody",
    "ListUnavailable",
    "Meter",
    "NotAnAddress",
    "STOP_AUDIENCE",
    "PostgrestWaitingListStore",
    "Refused",
    "UnconfiguredWaitingListStore",
    "WaitingListStore",
    "build_store",
    "client_key",
    "digest",
    "get_store",
    "join",
    "meter",
    "normalise_board",
    "normalise_class",
    "normalise_email",
    "normalise_page",
    "register_waiting_list",
    "remove",
    "reset_meter",
    "set_clock",
    "set_store",
    "stop_link",
]
