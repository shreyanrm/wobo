"""The door: ``doors_open`` in ``ops.settings``, and what the gateway refuses while it is off.

``docs/DOORS-CLOSED.md`` is the law and its section 4 is the sentence this module exists for:
*refusing at the gateway is what actually closes the door; the web copy is only what a person
sees.* A learner app can be rebuilt by anyone with a browser; the gateway cannot, so the gateway
is where the refusal lives.

**Why it is closed at all.** 438 public pages are about to start earning visitors from search. A
person who arrives, signs up, and meets a tutor that is not ready is lost permanently, because a
first impression is spent once. So new accounts stop until the owner has walked the web version.
Everything else stays exactly as it was.

**A dial, not a deploy.** The value lives in a row of ``ops.settings`` (migration 0024) and is
re-read on a short interval, so the owner turns it back on in one statement and the product
follows within under a minute, with nothing released and nothing restarted.
:data:`DEFAULT_REFRESH_S` is that interval and the law caps it at a minute.

**What is refused while it is off**, and it is three things rather than a list of routes:

1. :data:`ACCOUNT_PATHS` — the named doors that create an account or lead to one. The parent
   sign-up, a parent invitation, the parent's accept page (which is what a deep link from an
   invite mail is), the checkout, and the gift, which nothing serves yet and which is in the set
   already so that the day it is written it is already shut.
2. **Any anonymous principal.** An anonymous subject IS a freshly minted account: it costs one
   public call to make and it has no history. There is no such thing as an *existing* anonymous
   account, so there is nothing here to be careful about.
3. **A subject the product has never seen.** This is the sign-up door itself. The account is
   created at the auth server, which is not ours to refuse, so what the gateway refuses is the
   first thing that account tries to do. "Never seen" means a lookup that SUCCEEDED and found no
   record (:func:`wobo_gateway.consent.account_exists`); a lookup that could not be made is not
   an answer and lets the caller through, because an existing learner locked out by a database
   blip is a worse failure than a stranger let in for five minutes.

**What is never refused**, whatever the dial says: the public pages and the ask box (they carry
no principal and are the reason for all of this), the operator console (an operator has no
learner profile, and a console that shuts on the day it is needed is not a console), and
:data:`ALWAYS_OPEN` — erasing yourself, and the one-click mail stop. A data right is not a
feature and a closed door may not stand in front of one.

**The audit.** Every change to the dial is recorded by a trigger in the database, so a change
made in the SQL editor is caught as surely as one made here. Every refused attempt is recorded
by this module, coalesced to one row per shape per minute: an SDK retrying anonymously in a loop
must not be able to write the audit table full, and the count on the row it already wrote says
how many times it tried.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from fastapi import FastAPI
from fastapi.responses import JSONResponse

logger = logging.getLogger("wobo.gateway.doors")

SCHEMA = "ops"
TABLE = "settings"
AUDIT_TABLE = "door_audit"
_HTTP_TIMEOUT_S = 5.0

#: The one dial this module owns. ``ops.settings`` is the general home for live dials, and the
#: queued designs that need one (the daily allowance, the models desk) add their own key beside
#: this rather than another table.
DIAL = "doors_open"

#: The honest code, and the one sentence a person reads. Copy law: ``docs/copy/voice.md`` §3 (no
#: exclamation mark, sentence case), §6 (say what is true), §10a (no em dash, plain words). It
#: says what stands in the door's place rather than only what is shut, because a refusal that
#: offers nothing wastes every visitor the public pages earn.
CODE = "doors_closed"
LINE = (
    "Wobo is not open for new accounts just yet, and the list on the site is how you hear "
    "the day it is."
)

#: What the web app reads so the copy and the door follow the switch without a release. Open: a
#: stranger's browser asks this before it draws the door, and has no token to ask it with.
DOORS_PATH = "/v1/doors"
OPEN_PATHS: frozenset[str] = frozenset({DOORS_PATH})
#: Open is not free. It rides the door's per-address limiter like every other open path.
LIMITED_PATHS: frozenset[str] = OPEN_PATHS

#: Nothing serves this today. It is in :data:`ACCOUNT_PATHS` because DOORS-CLOSED §1 names a gift
#: among the paths that may not create an account, and a path that is shut before it is written
#: cannot be forgotten when it is.
GIFT_PATH = "/v1/billing/gift"

#: The named doors. Refused by path, before the route and before any principal is considered, so
#: an unauthenticated deep link is refused exactly as a signed-in invitation is.
ACCOUNT_PATHS: frozenset[str] = frozenset(
    {
        # A parent account is created here (parent_api.py).
        "/v1/parent/sign-up",
        # A learner inviting a parent starts a new person's account (parents.py).
        "/v1/me/parent-invite",
        # The parent's accept page. A deep link from an invite mail lands here, and accepting is
        # how the parent side begins. Declining is NOT here: a person removing themselves must
        # work whatever the dial says.
        "/v1/parent/accept",
        # The checkout creates an object at the payment provider (billing/payments.py). Payments
        # are off anyway; this is the door in front of that one.
        "/v1/billing/checkout",
        GIFT_PATH,
    }
)

#: Never behind the dial, for anybody, at any time.
ALWAYS_OPEN: frozenset[str] = frozenset(
    {
        # Taking your own data back. A right, not a feature.
        "/v1/me/erase",
        # The one-click stop in every mail. Refusing it would make us the thing we promise not
        # to be.
        "/v1/mail/stop",
    }
)

#: The operator console, by prefix. An operator has no learner profile row, so the first-touch
#: rule would lock the console out of its own product on the day it matters most.
ADMIN_PREFIX = "/v1/admin"

#: How long the gateway serves what it last read before asking again. The law says the switch is
#: followed "within a minute", so this is well under one and :func:`refresh_interval_s` caps it.
DEFAULT_REFRESH_S = 30.0
MAX_REFRESH_S = 60.0

#: One audit row per (reason, path, address digest) per this many seconds. A retry loop writes
#: one row a minute rather than one row a request.
REFUSAL_COALESCE_S = 60.0


# --- the store seam ------------------------------------------------------------------------------
class SettingsStore(Protocol):
    """``ops.settings`` as this module reads and writes it, plus the door's own audit."""

    def read(self, key: str) -> Any | None: ...

    def read_many(self, keys: Sequence[str]) -> dict[str, Any]:
        """Several dials in ONE round trip. Missing keys are simply absent from the answer.

        The door needs one dial and could live on :meth:`read`. The models desk and the allowance
        (``docs/CONSOLE-MODELS.md``, ``docs/ALLOWANCE.md``) need about twenty every refresh
        interval, and twenty round trips a minute against the project is a cost the table does not
        need to carry. Optional in practice: :mod:`wobo_gateway.dials` reaches for it with
        ``getattr`` and falls back to one read per key, so a store written before this existed
        still works.
        """
        return {key: value for key in keys if (value := self.read(key)) is not None}

    def write(self, key: str, value: Any, *, actor: str | None, note: str | None) -> None: ...

    def write_many(
        self, values: dict[str, Any], *, actor: str | None, note: str | None
    ) -> None:
        """Several dials as ONE write: all of them take, or none does.

        A desk that turns three dials and fails on the third must not leave the first two turned
        (the board-change dials, board_change.py). The project store does it in one upsert, which
        is one statement. This default is for a store written before it existed and is NOT
        atomic; every store in this file overrides it.
        """
        for key, value in values.items():
            self.write(key, value, actor=actor, note=note)

    def record_refusal(
        self, *, reason: str, path: str, ip_hash: str | None, count: int
    ) -> None: ...

    def changed_at(self, key: str) -> datetime | None:
        """When this dial last took the value it holds, or ``None`` when the store cannot say.

        Read by :func:`closed_since`, which is what makes "an existing account" mean an account
        the product held BEFORE the door shut, rather than any row a caller can write. It is
        optional in practice: :func:`closed_since` reaches for it with ``getattr``, so a store
        written before this rule existed still works and simply cannot answer.
        """
        return None


class InMemorySettingsStore:
    """The suite's store and a local run's. Asked for BY NAME (``DOORS_STORE=memory``).

    ``open_default`` is the value the dial starts at when nothing has written one. It is TRUE
    here and false everywhere else on purpose: this store only ever exists where there is no
    product to protect, and a local gateway that cannot sign anybody up is a local gateway
    nobody can develop against. Production never reaches this class.
    """

    def __init__(self, *, open_default: bool = True, changed_at: datetime | None = None) -> None:
        self.values: dict[str, Any] = {DIAL: bool(open_default)}
        self.changes: list[dict[str, Any]] = []
        self.refusals: list[dict[str, Any]] = []
        # What ``ops.settings.updated_at`` holds in the real store: when this dial last moved.
        self.changed: dict[str, datetime] = {DIAL: changed_at or datetime.now(UTC)}
        self._lock = threading.Lock()

    def read(self, key: str) -> Any | None:
        with self._lock:
            return self.values.get(key)

    def read_many(self, keys: Sequence[str]) -> dict[str, Any]:
        with self._lock:
            return {
                key: self.values[key] for key in keys if self.values.get(key) is not None
            }

    def write(self, key: str, value: Any, *, actor: str | None, note: str | None) -> None:
        with self._lock:
            self.values[key] = value
            self.changed[key] = datetime.now(UTC)
            self.changes.append({"key": key, "value": value, "actor": actor, "note": note})

    def write_many(
        self, values: dict[str, Any], *, actor: str | None, note: str | None
    ) -> None:
        now = datetime.now(UTC)
        with self._lock:
            for key, value in values.items():
                self.values[key] = value
                self.changed[key] = now
                self.changes.append({"key": key, "value": value, "actor": actor, "note": note})

    def changed_at(self, key: str) -> datetime | None:
        with self._lock:
            return self.changed.get(key)

    def record_refusal(
        self, *, reason: str, path: str, ip_hash: str | None, count: int
    ) -> None:
        with self._lock:
            self.refusals.append(
                {"reason": reason, "path": path, "ip_hash": ip_hash, "count": count}
            )


class UnconfiguredSettingsStore:
    """No project, and therefore no dial. Every read is ``None``, which reads as CLOSED.

    That is the whole posture of this file in one class. A gateway that has lost its project has
    also lost every way of knowing whether the door should be open, and the safe answer to a
    question you cannot ask is no.
    """

    def read(self, key: str) -> Any | None:
        return None

    def read_many(self, keys: Sequence[str]) -> dict[str, Any]:
        return {}

    def changed_at(self, key: str) -> datetime | None:
        return None

    def write(self, key: str, value: Any, *, actor: str | None, note: str | None) -> None:
        raise DoorsUnavailable("no project is configured, so there is no dial to turn")

    def write_many(
        self, values: dict[str, Any], *, actor: str | None, note: str | None
    ) -> None:
        raise DoorsUnavailable("no project is configured, so there is no dial to turn")

    def record_refusal(
        self, *, reason: str, path: str, ip_hash: str | None, count: int
    ) -> None:
        return None


class DoorsUnavailable(Exception):
    """The dial could not be reached. Read as closed; never as open."""


def _request(url: str, key: str, method: str, *, body: Any = None) -> Any:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Profile": SCHEMA,
        "Content-Profile": SCHEMA,
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode()
    return json.loads(raw) if raw.strip() else []


class PostgrestSettingsStore:
    """``ops.settings`` and ``ops.door_audit`` over PostgREST with the service-role key.

    Server-side only. The ``ops`` schema is closed to ``anon`` and ``authenticated`` by migration
    0015, so no client token can read the dial or write the trail even if one tried.
    """

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        self.base = base_url.rstrip("/")
        self.key = service_key
        self._request = request or _request

    def _url(self, table: str, params: dict[str, str] | None = None) -> str:
        query = f"?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else ""
        return f"{self.base}/rest/v1/{urllib.parse.quote(table)}{query}"

    def read(self, key: str) -> Any | None:
        rows = self._request(
            self._url(TABLE, {"select": "value", "key": f"eq.{key}", "limit": "1"}),
            self.key,
            "GET",
        )
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            return None
        return rows[0].get("value")

    def read_many(self, keys: Sequence[str]) -> dict[str, Any]:
        """One ``key=in.(...)`` for every dial the gateway holds. See the Protocol above."""
        wanted = [key for key in keys if key]
        if not wanted:
            return {}
        rows = self._request(
            self._url(
                TABLE,
                {
                    "select": "key,value",
                    "key": f"in.({','.join(wanted)})",
                    "limit": str(len(wanted)),
                },
            ),
            self.key,
            "GET",
        )
        if not isinstance(rows, list):
            return {}
        found: dict[str, Any] = {}
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("key"), str):
                if row.get("value") is not None:
                    found[row["key"]] = row["value"]
        return found

    def changed_at(self, key: str) -> datetime | None:
        """``ops.settings.updated_at``, which a trigger moves with the value (migration 0024).

        A separate read from :meth:`read` on purpose: it is asked for once per refresh interval
        rather than once per request, and keeping it out of the hot read means the dial itself
        stays one column.
        """
        rows = self._request(
            self._url(TABLE, {"select": "updated_at", "key": f"eq.{key}", "limit": "1"}),
            self.key,
            "GET",
        )
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            return None
        return _as_moment(rows[0].get("updated_at"))

    def write(self, key: str, value: Any, *, actor: str | None, note: str | None) -> None:
        # An upsert. The change audit is a trigger on the table (migration 0024), so a change made
        # in the SQL editor leaves the same row this one does.
        self._request(
            self._url(TABLE, {"on_conflict": "key"}),
            self.key,
            "POST",
            body=[{"key": key, "value": value, "updated_by": actor, "note": note}],
        )

    def write_many(
        self, values: dict[str, Any], *, actor: str | None, note: str | None
    ) -> None:
        """Every dial in one upsert, which Postgres runs as one statement: all or nothing."""
        if not values:
            return
        self._request(
            self._url(TABLE, {"on_conflict": "key"}),
            self.key,
            "POST",
            body=[
                {"key": key, "value": value, "updated_by": actor, "note": note}
                for key, value in values.items()
            ],
        )

    def record_refusal(
        self, *, reason: str, path: str, ip_hash: str | None, count: int
    ) -> None:
        self._request(
            self._url(AUDIT_TABLE),
            self.key,
            "POST",
            body=[{"reason": reason, "path": path, "ip_hash": ip_hash, "attempts": count}],
        )


_store: SettingsStore | None = None
_store_lock = threading.Lock()


def build_store() -> SettingsStore:
    """The project store when one is configured, the memory store when it is asked for BY NAME.

    ``DOORS_STORE=memory`` is the only way to the in-memory one, exactly as ``billing.py``
    requires ``SUBSCRIPTIONS_STORE=memory`` and for the same reason: a production deployment that
    lost its project must not silently answer from a dictionary. Here the consequence is sharper
    than an empty desk, because the dictionary's answer would be "the door is open".
    """
    if (os.getenv("DOORS_STORE") or "").strip().lower() == "memory":
        default = (os.getenv("DOORS_OPEN_DEFAULT") or "1").strip().lower() not in {
            "0",
            "false",
            "no",
            "off",
        }
        return InMemorySettingsStore(open_default=default)
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    if base and key:
        return PostgrestSettingsStore(base, key)
    logger.warning("doors: no project configured — the door reads as closed")
    return UnconfiguredSettingsStore()


def get_store() -> SettingsStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: SettingsStore | None) -> None:
    """Test seam. ``None`` drops the singleton so the next call rebuilds from the environment."""
    global _store
    with _store_lock:
        _store = store
    reset()


# --- the dial ------------------------------------------------------------------------------------
_monotonic: Callable[[], float] = time.monotonic
_cached: tuple[float, bool] | None = None
#: When the dial last moved, cached on the same interval as the dial itself.
_since_cached: tuple[float, datetime | None] | None = None
_cache_lock = threading.Lock()
#: (reason, path, ip_hash) -> (first seen at, attempts since). Bounded by the coalesce window.
_refusals: dict[tuple[str, str, str | None], tuple[float, int]] = {}
_refusal_lock = threading.Lock()


def set_clock(clock: Callable[[], float] | None) -> None:
    """Test seam: replace the monotonic clock so a test can cross the read interval at once."""
    global _monotonic
    _monotonic = clock or time.monotonic
    reset()


def reset() -> None:
    """Drop what was last read, and the refusal window. The next read asks the store."""
    global _cached, _since_cached
    with _cache_lock:
        _cached = None
        _since_cached = None
    with _refusal_lock:
        _refusals.clear()


def refresh_interval_s() -> float:
    """How long the gateway serves what it last read. Capped at a minute by the law itself."""
    raw = os.getenv("DOORS_REFRESH_S")
    try:
        wanted = float(raw) if raw is not None else DEFAULT_REFRESH_S
    except ValueError:
        wanted = DEFAULT_REFRESH_S
    return max(0.0, min(wanted, MAX_REFRESH_S))


def _as_moment(value: Any) -> datetime | None:
    """A timestamp as PostgREST hands it back, or ``None`` for anything we cannot read as one."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def closed_since() -> datetime | None:
    """When the dial last moved, or ``None`` when the store cannot say.

    This is what makes "an existing account" mean something a caller cannot mint. See
    :func:`refusal_for`. Cached beside the dial itself and never raising: a store that cannot
    answer leaves the rule off rather than locking an existing learner out.
    """
    global _since_cached
    now = _monotonic()
    with _cache_lock:
        if _since_cached is not None and (now - _since_cached[0]) < refresh_interval_s():
            return _since_cached[1]
    try:
        ask = getattr(get_store(), "changed_at", None)
        moment = _as_moment(ask(DIAL)) if callable(ask) else None
    except Exception as exc:  # noqa: BLE001 — a store that cannot say leaves the rule off
        logger.warning("doors: could not read when the dial moved", extra={"fields": {"error": str(exc)}})
        moment = None
    with _cache_lock:
        _since_cached = (now, moment)
    return moment


def _coerce(value: Any) -> bool:
    """What the stored value means. Anything we do not recognise is CLOSED.

    ``ops.settings.value`` is jsonb, so a boolean arrives as one; a string is read too, because
    an owner turning the dial by hand in a SQL editor writing ``'true'`` meant true.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def is_open() -> bool:
    """Is the door open right now? Cached for :func:`refresh_interval_s`, and never raising.

    A store that refuses, times out or has no row reads as CLOSED, and says so in the log once
    per interval rather than once per request.
    """
    global _cached
    now = _monotonic()
    with _cache_lock:
        if _cached is not None and (now - _cached[0]) < refresh_interval_s():
            return _cached[1]
    try:
        value = get_store().read(DIAL)
    except Exception as exc:  # noqa: BLE001 — a dial we cannot read is a dial that says no
        logger.warning("doors: could not read the dial", extra={"fields": {"error": str(exc)}})
        value = None
    answer = _coerce(value)
    with _cache_lock:
        _cached = (now, answer)
    return answer


def set_open(value: bool, *, actor: str | None = None, note: str | None = None) -> None:
    """Turn the dial, and take effect at once rather than at the end of the interval.

    The audit row for the change is written by the database (migration 0024), so a change made
    here and a change made in the SQL editor leave the same trail.
    """
    get_store().write(DIAL, bool(value), actor=actor, note=note)
    reset()


# --- the refusal ---------------------------------------------------------------------------------
@dataclass(frozen=True)
class Refusal:
    """Why this call may not proceed. ``reason`` is for the trail, never for the person."""

    reason: str

    def body(self) -> dict[str, str]:
        return {"code": CODE, "message": LINE}


def refusal_for(path: str, principal: Any) -> Refusal | None:
    """The one decision. ``None`` means the call proceeds exactly as it did before this wave.

    Ordered so the cheapest and most certain checks come first, and so the profile lookup — the
    only one that can reach a database — is never made while the door is open.
    """
    if path in ALWAYS_OPEN or path.startswith(ADMIN_PREFIX):
        return None
    account_path = path in ACCOUNT_PATHS
    if not account_path and principal is None:
        # An open public path, or a call the door has already refused for want of a token.
        return None
    if is_open():
        return None
    if account_path:
        return Refusal("account_path")
    if getattr(principal, "anonymous", False):
        return Refusal("anonymous")
    subject = getattr(principal, "subject", None)
    if not subject:
        return None
    from wobo_gateway import consent

    exists = consent.account_exists(str(subject))
    if exists is False:
        # A PARENT ACCOUNT HAS NO LEARNER RECORD, and never may (migration 0019's trigger
        # `profiles_cache_is_not_a_parent`). So a parent is looked for on the parent plane, whose
        # row only the server writes (service role, at /v1/parent/sign-up, itself shut while the
        # dial is off). A parent row younger than the closure is still a new account.
        return _parent_refusal(str(subject))
    # AND THE RECORD MUST PREDATE THE CLOSURE, because the record itself is writable by the
    # person it is about. `learner.profiles_cache` carries one policy, `profiles_cache_own ...
    # for all`, and migration 0014 re-granted INSERT on the columns the profile sync sends. So
    # the recipe was: sign in with a provider (an account minted at the auth server, which is not
    # ours to refuse), let the app upsert your own profile row with your own token, and the check
    # above reads you as an account the product has always had. One column on that row is not in
    # the grant and never has been: `created_at`, which is the database's own `now()`. A record
    # written after the dial last moved is therefore not an existing account; it is the sign-up
    # this door exists to refuse, wearing a row.
    #
    # Both unknowns leave the rule OFF and let the caller through, for the same reason the lookup
    # above does: an existing learner locked out by a store that cannot answer is a worse failure
    # than a stranger let in for five minutes.
    shut_at = closed_since()
    if shut_at is not None:
        first_seen = consent.account_created_at(str(subject))
        if first_seen is not None and first_seen >= shut_at:
            return Refusal("new_account")
    return None


def _parent_refusal(subject: str) -> Refusal | None:
    """The door's answer for a subject with no learner record: through when the parent plane holds
    an account that predates the closure, refused otherwise. A parent plane that cannot answer is
    the one case read as "new": there is no learner record either, so nothing says this is
    anybody the product already held."""
    from wobo_gateway import parent_account

    try:
        account = parent_account.get_store().account(subject)
    except parent_account.StoreUnavailable:
        return Refusal("new_account")
    if account is None:
        return Refusal("new_account")
    shut_at = closed_since()
    if shut_at is not None and account.created_at is not None and account.created_at >= shut_at:
        return Refusal("new_account")
    return None


def _write_refusal(reason: str, path: str, ip_hash: str | None, count: int) -> None:
    """One row, best effort. The refusal itself stands whether or not it was recorded."""
    try:
        get_store().record_refusal(reason=reason, path=path, ip_hash=ip_hash, count=count)
    except Exception as exc:  # noqa: BLE001
        logger.warning("doors: refusal not recorded", extra={"fields": {"error": str(exc)}})


def note_refusal(refusal: Refusal, *, path: str, ip_hash: str | None) -> None:
    """Record the attempt, coalesced to at most two rows per shape per minute.

    The row carries the reason, the path and the caller's address digest. Never the subject and
    never an address: a refusal is a count and a shape, not a dossier on somebody who tried a
    door.

    **Why it is coalesced.** An SDK retrying anonymously in a loop would otherwise write the
    audit table full, and a door whose own trail is a denial-of-service amplifier is a door that
    gets switched off by whoever is paged. So the FIRST refusal of a shape is written at once —
    nothing is ever silently unrecorded — and the rest of that minute is counted here. When the
    next one arrives after the window has closed, the ones that were held are written as a second
    row carrying their true count, so no attempt goes uncounted rather than being summarised into
    a number nobody wrote down. ``ops.door_audit`` is append-only, so a running total cannot be
    an update to the first row; two rows is what append-only costs, and it is cheap.

    The one loss, stated plainly: refusals held in a window whose shape never recurs, and which
    is never reached by the prune below, are never written as their own row. The FACT is still
    on the first row and in the request log, which carries every refusal individually; only a
    tail of the count can be lost, and only for a shape that stopped happening.
    """
    key = (refusal.reason, path, ip_hash)
    now = _monotonic()
    carried: list[tuple[str, str, str | None, int]] = []
    with _refusal_lock:
        # Prune expired windows, flushing anything they were holding on the way out.
        if len(_refusals) > 256:
            for stale in [k for k, (at, _) in _refusals.items() if now - at >= REFUSAL_COALESCE_S]:
                held = _refusals.pop(stale)[1]
                if held:
                    carried.append((stale[0], stale[1], stale[2], held))
        seen = _refusals.get(key)
        if seen is not None and (now - seen[0]) < REFUSAL_COALESCE_S:
            _refusals[key] = (seen[0], seen[1] + 1)
            for row in carried:
                _write_refusal(*row)
            return
        if seen is not None and seen[1]:
            carried.append((refusal.reason, path, ip_hash, seen[1]))
        # A new window, holding nothing: the one we are about to write is not held back.
        _refusals[key] = (now, 0)
    for row in carried:
        _write_refusal(*row)
    _write_refusal(refusal.reason, path, ip_hash, 1)


def refuse(refusal: Refusal, *, path: str, ip_hash: str | None) -> JSONResponse:
    """The response a refused caller gets, and the row the attempt leaves behind."""
    note_refusal(refusal, path=path, ip_hash=ip_hash)
    logger.info(
        "doors: refused",
        extra={"fields": {"reason": refusal.reason, "path": path, "ip_hash": ip_hash}},
    )
    return JSONResponse(status_code=403, content=refusal.body())


# --- the route the web app reads -----------------------------------------------------------------
#: The one key in the body, and it is the name of the dial itself. It was ``open`` here and
#: ``doors_open`` in the browser's parser, which made the dial a ONE-WAY VALVE: the owner could
#: shut the door and could never reopen it, silently, because closed is every failure on the web
#: side. ``contracts/doors.json`` now holds the name and both suites read it.
DIAL_KEY = DIAL


def register_doors(app: FastAPI) -> None:
    """``GET /v1/doors``. One boolean, open to anybody, so the site follows the switch."""

    @app.get(DOORS_PATH)
    def doors_state() -> dict[str, bool]:
        return {DIAL_KEY: is_open()}


__all__ = [
    "ACCOUNT_PATHS",
    "ADMIN_PREFIX",
    "ALWAYS_OPEN",
    "CODE",
    "DIAL",
    "DIAL_KEY",
    "DOORS_PATH",
    "GIFT_PATH",
    "LIMITED_PATHS",
    "LINE",
    "OPEN_PATHS",
    "DoorsUnavailable",
    "InMemorySettingsStore",
    "PostgrestSettingsStore",
    "Refusal",
    "SettingsStore",
    "UnconfiguredSettingsStore",
    "build_store",
    "closed_since",
    "get_store",
    "is_open",
    "note_refusal",
    "refresh_interval_s",
    "refusal_for",
    "refuse",
    "register_doors",
    "reset",
    "set_clock",
    "set_open",
    "set_store",
]
