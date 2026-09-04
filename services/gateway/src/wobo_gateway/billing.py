"""The plan a learner is on, and the cancel the site already promises.

The plans page says it in the learner's own words: "You → Your plan → Cancel. Two taps, no call,
no 'are you sure' maze. You keep the plan until the month you paid for ends." There are no refunds
(owner, 2026-09-04), which makes this the ONLY door out — so it works, or the learner is trapped.
This module is the record and the three routes behind that sentence:

* ``GET /v1/me/subscription`` — which plan, until when, where it was bought.
* ``POST /v1/me/subscription/cancel`` — end the plan at the end of the period already paid for.
  IDEMPOTENT: cancelling twice is not an
  error and does not move the end date. Nothing is taken away early, and nothing the learner
  learnt is touched.
* ``POST /v1/me/subscription/resume`` — undo it, while the period is still running. One tap.
  Offering that is not a dark pattern; making someone walk through it to cancel would be, so it is
  never on the cancel path.

All three answer with the SAME body, so the screen is left holding one truth rather than a guess
it has to reconcile. The shape is the one the app already reads
(``apps/web-pwa/src/screens/you/billing.ts``): ``status`` in free | active | cancelling | ended,
``plan``, ``period_end``, ``source`` in web | app_store | play_store, and a refusal that carries
its own ``message``.

Four rules this module keeps, because each is a promise the product has already made:

1. **The plan stays live until the end of the period already paid for.** Cancel writes a status
   and a time and never touches ``current_period_end``.
2. **Nothing is charged after that, and the meter follows by itself.** :func:`effective_plan` is
   derived from ``current_period_end`` every time it is read, so the allowance falls back to free
   the moment the period ends. No cron, no sweep, nothing to forget to run.

   NOTHING IN THIS REPO RENEWS A SUBSCRIPTION, and no user-facing line may say one does. There is
   no payment provider, no webhook and no scheduled sweep; ``current_period_end`` has exactly one
   writer, :meth:`SubscriptionStore.insert`. So a plan runs to its period end and then meters as
   free whether or not the learner cancelled, and every line the learner reads says exactly that.
   What cancelling does today is record the decision, keep the plan to the paid-for date, and stop
   anything from being sold to that row later; the day a provider lands, this is the row it reads
   before it charges. The copy law (DESIGN.md §0) forbids describing a mechanism we cannot show,
   and "renews by itself" was one.
3. **A store subscription is cancelled in the store.** A plan bought inside a phone's app store is
   refused here, with its ``source`` on the body, so the app shows the real instruction instead of
   a generic failure.
4. **Honest under failure.** A write that did not land raises, the route answers 503, and the
   learner is told the plan is unchanged. Nothing ever reports "cancelled" for a cancel that did
   not happen.

Scoping is the door's: every read and every write is keyed to ``principal.subject``. No route takes
a learner id from a path, a query or a body, so there is nothing to point at someone else.

Two stores behind one seam, exactly as :mod:`wobo_gateway.parents`: in memory for the suite and a
local run, PostgREST with the service-role key (never a client's) for the project. Nothing here
charges a card — there is no purchase route yet, so a row is written today by the operator or by
the suite, and the day checkout lands it writes through :meth:`SubscriptionStore.insert`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from fastapi import FastAPI, HTTPException, Request

from wobo_gateway.auth import Principal
from wobo_gateway.consent import Profile

logger = logging.getLogger("wobo.gateway.billing")

_HTTP_TIMEOUT_S = 5.0
_SCHEMA = "learner"
_TABLE = "subscriptions"

#: The one mailbox (DESIGN.md §0, the copy law).
SUPPORT = "support@heywobo.com"

#: What migration 0014 allows in each column. Read tolerantly, written exactly.
PLANS: tuple[str, ...] = ("plus", "pro", "max")
STATUSES: tuple[str, ...] = ("active", "cancelled")
ORIGINS: tuple[str, ...] = ("web", "ios", "android")
#: Bought inside a phone's app store: ours to read, the store's to cancel.
STORE_ORIGINS: frozenset[str] = frozenset({"ios", "android"})
#: The row says which platform; the app says which store. One map, so the two never drift.
SOURCE_OF_ORIGIN: dict[str, str] = {"web": "web", "ios": "app_store", "android": "play_store"}

#: A subject reaches a PostgREST filter, so it is checked before it is interpolated (the same rule
#: as :mod:`wobo_gateway.memory` and :mod:`wobo_gateway.parents`).
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

#: The two writes change the database and the read is a database read behind the door; all three
#: sit on the per-caller limiter (app.py adds this to its ``limited`` set).
LIMITED_PATHS = frozenset(
    {"/v1/me/subscription", "/v1/me/subscription/cancel", "/v1/me/subscription/resume"}
)


# --- the model ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Subscription:
    """One row of ``learner.subscriptions`` as the gateway reads and writes it."""

    id: str
    learner_id: str
    plan: str
    status: str
    origin: str
    current_period_end: datetime
    started_at: datetime
    cancelled_at: datetime | None = None

    @property
    def store_managed(self) -> bool:
        """Bought in a phone's app store, so cancelled there and not by us."""
        return self.origin in STORE_ORIGINS

    @property
    def source(self) -> str:
        """Where the learner bought it, in the words the app uses."""
        return SOURCE_OF_ORIGIN.get(self.origin, "app_store")

    def running(self, now: datetime) -> bool:
        """Is the period already paid for still running?"""
        return now < self.current_period_end


def _when(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value else None


def is_paid(plan: str | None) -> bool:
    return (plan or "free").strip().lower() in PLANS


def from_row(row: dict[str, Any]) -> Subscription | None:
    """A database row, read tolerantly — but a row without a period end is not a subscription.

    A missing or unreadable ``current_period_end`` would otherwise become "now", which is a silent
    downgrade to free for someone who has paid. It reads as no record at all, and the route says
    so rather than guessing at someone's money.
    """
    ends = _when(row.get("current_period_end"))
    if ends is None:
        logger.warning("subscription row carries no period end; ignored")
        return None
    plan = str(row.get("plan") or "").strip().lower()
    status = str(row.get("status") or "active").strip().lower()
    origin = str(row.get("origin") or "web").strip().lower()
    return Subscription(
        id=str(row.get("id") or ""),
        learner_id=str(row.get("learner_id") or ""),
        # An unknown word is not a bigger allowance: it falls to the smallest paid tier, the same
        # way budget.limits_for falls to free rather than guessing upwards.
        plan=plan if plan in PLANS else "plus",
        status=status if status in STATUSES else "active",
        # An origin we do not recognise is treated as a store's. Refusing a cancel we cannot
        # perform and telling the learner where to do it is the honest failure; claiming to have
        # cancelled something in a store we cannot reach is not.
        origin=origin if origin in ORIGINS else "ios",
        current_period_end=ends,
        started_at=_when(row.get("started_at")) or ends,
        cancelled_at=_when(row.get("cancelled_at")),
    )


def to_row(sub: Subscription) -> dict[str, Any]:
    return {
        "id": sub.id,
        "learner_id": sub.learner_id,
        "plan": sub.plan,
        "status": sub.status,
        "origin": sub.origin,
        "current_period_end": _iso(sub.current_period_end),
        "started_at": _iso(sub.started_at),
        "cancelled_at": _iso(sub.cancelled_at),
    }


# --- the store seam -----------------------------------------------------------------------------
class StoreUnavailable(Exception):
    """The subscription could not be reached. Callers say so; they never invent a plan."""


class SubscriptionStore(Protocol):
    def get(self, learner_id: str) -> Subscription | None: ...

    def insert(self, sub: Subscription) -> Subscription: ...

    def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None: ...


class InMemorySubscriptionStore:
    """The suite's store, and a local run without a project."""

    def __init__(self) -> None:
        self.rows: dict[str, Subscription] = {}
        self._lock = threading.Lock()

    def get(self, learner_id: str) -> Subscription | None:
        with self._lock:
            return self.rows.get(learner_id)

    def insert(self, sub: Subscription) -> Subscription:
        with self._lock:
            if sub.learner_id in self.rows:  # the unique index on learner_id
                raise StoreUnavailable("one subscription per learner")
            self.rows[sub.learner_id] = sub
            return sub

    def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None:
        with self._lock:
            current = self.rows.get(learner_id)
            if current is None:
                return None
            updated = from_row({**to_row(current), **fields})
            if updated is None:
                return None
            self.rows[learner_id] = updated
            return updated

    def forget(self, learner_id: str) -> int:
        """Test and operator seam — the row, gone. Returns how many."""
        with self._lock:
            return 1 if self.rows.pop(learner_id, None) is not None else 0


class UnconfiguredSubscriptionStore:
    """No project, and no permission to pretend there is one.

    A store that was never CONFIGURED is not the same thing as a learner with no plan, and the
    difference is somebody's money. An in-memory store in production is empty at boot and private
    to one process, so a paying learner would be answered ``status: "free"`` by the read and "you
    are on the free plan, so there is nothing to cancel" by the cancel — a lie in the one place
    the product has promised the truth, and with no refund behind it, a trap.

    So every call raises. The read answers 503 with "I could not read your plan", the cancel
    answers 503 with "nothing has changed", and both are true. Metering is untouched: ``plan_for``
    catches this and falls back to the plan on the learner's own profile row.
    """

    def _refuse(self) -> StoreUnavailable:
        return StoreUnavailable("no subscription store is configured")

    def get(self, learner_id: str) -> Subscription | None:
        raise self._refuse()

    def insert(self, sub: Subscription) -> Subscription:
        raise self._refuse()

    def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None:
        raise self._refuse()


Request_ = Callable[..., Any]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call. Split out so tests can substitute it without a database."""
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


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


class PostgrestSubscriptionStore:
    """``learner.subscriptions`` over PostgREST with the service-role key (never a client's).

    The client cannot write this table at all — migration 0014 withdraws insert, update and delete
    from ``authenticated`` — so every change has to come through here, behind the door.
    """

    def __init__(
        self, base_url: str, service_key: str, *, request: Request_ | None = None
    ) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestSubscriptionStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{_TABLE}?{encoded}"

    def _call(self, method: str, params: dict[str, str], *, body: Any = None) -> list[Any]:
        try:
            rows = self._request(self._url(params), self._key, method, body=body, want_rows=True)
        except _NETWORK_ERRORS as exc:
            logger.warning(
                "subscriptions: store call failed",
                extra={"fields": {"method": method, "error": str(exc)}},
            )
            raise StoreUnavailable(str(exc)) from exc
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    @staticmethod
    def _checked(value: str) -> str:
        if not _ID_RE.match(value or ""):
            raise StoreUnavailable("that is not a learner I can look up")
        return value

    def get(self, learner_id: str) -> Subscription | None:
        rows = self._call(
            "GET", {"select": "*", "learner_id": f"eq.{self._checked(learner_id)}", "limit": "1"}
        )
        return from_row(rows[0]) if rows else None

    def insert(self, sub: Subscription) -> Subscription:
        rows = self._call("POST", {"select": "*"}, body=[to_row(sub)])
        return (from_row(rows[0]) or sub) if rows else sub

    def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None:
        rows = self._call(
            "PATCH",
            {"learner_id": f"eq.{self._checked(learner_id)}", "select": "*"},
            body=fields,
        )
        return from_row(rows[0]) if rows else None


_store: SubscriptionStore | None = None
_store_lock = threading.Lock()


def build_store() -> SubscriptionStore:
    """The project store when configured; otherwise a store that refuses, not one that invents.

    ``SUBSCRIPTIONS_STORE=memory`` asks for the in-memory store explicitly — the suite and a local
    run. Nothing else gets it. An unconfigured deployment gets
    :class:`UnconfiguredSubscriptionStore`, which raises, because a subscription silently kept in
    one process's memory would tell a learner who paid that they have nothing to cancel. (This is
    where the house pattern in ``parents.py`` is deliberately NOT copied: a parent link quietly
    kept in memory is an inconvenience; a subscription quietly kept in memory is a trap.)
    """
    if (os.getenv("SUBSCRIPTIONS_STORE") or "").strip().lower() == "memory":
        return InMemorySubscriptionStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestSubscriptionStore(base, key)
    logger.error(
        "subscriptions: no project configured — plan reads and cancels will answer 503. "
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or SUBSCRIPTIONS_STORE=memory to "
        "ask for the in-memory store on purpose."
    )
    return UnconfiguredSubscriptionStore()


def get_store() -> SubscriptionStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: SubscriptionStore | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store
    reset_cache()


# --- the effective plan -------------------------------------------------------------------------
def effective_plan(
    sub: Subscription | None, *, fallback: str = "free", now: datetime | None = None
) -> str:
    """The plan the meter must count against RIGHT NOW.

    Derived, never stored: the allowance a learner has is the one their paid period still covers.
    A cancelled subscription therefore meters at the paid rate until ``current_period_end`` and at
    the free rate the moment after, with nothing scheduled to make that happen.

    A period that has ended without being renewed is free too, whatever the status says. A renewal
    is a write to this row; until that write lands there is no evidence anyone paid for the day in
    question, and budget.py's rule holds — a billing bug costs a learner questions rather than
    handing out an allowance nobody paid for.
    """
    if sub is None:
        return fallback
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    return sub.plan if sub.running(moment) else "free"


# The read every metered call makes, cached the way consent.get_profile is: five minutes, a hard
# entry ceiling, one process. The ROW is cached and never the answer, so the plan is still computed
# against the current clock — a subscription cached a minute before its period ends meters as free
# a minute later, not five.
_CACHE_TTL_S = 300.0
#: A FAILED read is remembered too, and for much less time. consent.get_profile caches its default
#: on failure for exactly this reason: without it, an unreachable table costs one blocking HTTP
#: call of up to ``_HTTP_TIMEOUT_S`` on EVERY metered turn — and metered_plan is on every charging
#: path (app.py invoke, the board stream, voice.py). A minute is short enough that a table coming
#: back is felt straight away, and long enough that a table that is down is asked once, not once
#: per question. The plan routes never read this cache: they call the store directly and answer
#: 503, so a learner is never told about their money out of a cached failure.
_FAIL_TTL_S = 60.0
_CACHE_MAX = 4096
#: subject -> (when, row, whether the read failed). A failed entry carries ``None`` for the row and
#: is re-raised rather than served, so the caller still falls back to the profile plan.
_cache: dict[str, tuple[float, Subscription | None, bool]] = {}
_cache_lock = threading.Lock()


def _remember(subject: str, sub: Subscription | None, *, failed: bool) -> None:
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()  # cheap prune; worst case one extra read per subject
        _cache[subject] = (time.monotonic(), sub, failed)


def _cached(subject: str) -> Subscription | None:
    entry = _cache.get(subject)
    if entry is not None:
        age = time.monotonic() - entry[0]
        if age < (_FAIL_TTL_S if entry[2] else _CACHE_TTL_S):
            if entry[2]:
                raise StoreUnavailable("the subscription store was unreachable a moment ago")
            return entry[1]
    try:
        sub = get_store().get(subject)
    except StoreUnavailable:
        _remember(subject, None, failed=True)
        raise
    _remember(subject, sub, failed=False)
    return sub


def forget(subject: str) -> None:
    """Drop one learner's cached row — called after every write, so the next read is the truth."""
    with _cache_lock:
        _cache.pop(subject, None)


def reset_cache() -> None:
    """Test seam, and the hook a future payment webhook calls."""
    with _cache_lock:
        _cache.clear()


def plan_for(subject: str, *, fallback: str = "free", now: datetime | None = None) -> str:
    """The effective plan for a verified subject. Never raises.

    An unreachable store answers with ``fallback`` — the plan on the learner's own profile row,
    which is stored evidence and not a guess. That degrades to exactly the behaviour before this
    module existed, rather than cutting a paying learner's allowance because our database blinked.
    """
    if not subject:
        return fallback
    try:
        sub = _cached(subject)
    except StoreUnavailable:
        return fallback
    except Exception:  # a store bug must never take a learner's turn down with it
        logger.exception("subscriptions: plan lookup failed")
        return fallback
    return effective_plan(sub, fallback=fallback, now=now)


def metered_plan(principal: Principal, profile: Profile) -> str:
    """The plan the METER counts against, for a principal the door has already verified.

    One definition, because there are two places that charge — the capability route and the voice
    routes (voice is a paid API and has its own meter call). A plan that lifted one and not the
    other would be a learner paying for turns and being cut off mid-sentence.

    An anonymous learner is metered per device address on the anonymous dial whatever any plan
    says: a fresh anonymous subject is one public HTTP call away.
    """
    if principal.anonymous or not principal.subject:
        return profile.plan
    return plan_for(principal.subject, fallback=profile.plan)


# --- the lifecycle ------------------------------------------------------------------------------
class Refused(Exception):
    """A change the gateway will not make. ``status`` is the HTTP answer, ``code`` the reason, and
    ``extra`` whatever the app needs to show the right instruction."""

    def __init__(
        self, status: int, code: str, message: str, *, extra: dict[str, Any] | None = None
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}
        super().__init__(message)

    def body(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.extra}


_NO_PLAN = "You are on the free plan, so there is nothing to cancel."
_NOTHING_TO_RESUME = "You are on the free plan. There is nothing to bring back."
_STORE_MANAGED = (
    "You bought this plan on your phone, so it has to be cancelled where you bought it, in your "
    "device's own subscription settings. Nothing I do here can change that one."
)
_ENDED = (
    "That plan has already ended, so there is nothing to bring back. You can start a new one "
    "whenever you like, and everything you learnt is still here."
)
_UNMANAGED = (
    "You are on a paid plan, but I cannot see the period it runs to, so I cannot end it from "
    f"here. Write to {SUPPORT} and we will end it for you."
)
_UNCHANGED = (
    "I could not change your plan just now. Nothing has changed. Try that again in a moment."
)
_UNREADABLE = "I could not read your plan just now. Nothing has changed. Try again in a moment."


def read(store: SubscriptionStore, learner_id: str) -> Subscription | None:
    """The learner's own subscription, or ``None``. Raises :class:`StoreUnavailable`."""
    if not learner_id:
        return None
    return store.get(learner_id)


def _missing(profile_plan: str, message: str) -> Refused:
    """No row. Either the learner is free, or a plan was set on their profile before this table
    existed — and then we can neither show a period nor end it, so we say exactly that."""
    if is_paid(profile_plan):
        return Refused(409, "unmanaged", _UNMANAGED, extra={"support": SUPPORT})
    return Refused(404, "no_subscription", message)


def cancel(
    store: SubscriptionStore,
    learner_id: str,
    *,
    profile_plan: str = "free",
    now: datetime | None = None,
) -> Subscription:
    """Stop the renewal. Nothing is taken away early and nothing is moved.

    Idempotent: a second cancel returns the same row, with the same end date, and is not an error —
    a learner who taps twice, or whose network retried for them, has cancelled once. Raises
    :class:`Refused` for a plan that is not ours to cancel and :class:`StoreUnavailable` when the
    write did not land, and then the caller says the plan is unchanged, because it is.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    sub = read(store, learner_id)
    if sub is None:
        raise _missing(profile_plan, _NO_PLAN)
    if sub.store_managed:
        raise Refused(409, "store_managed", _STORE_MANAGED, extra={"source": sub.source})
    if sub.status == "cancelled":
        return sub  # already done: same row, same end date, no error
    updated = store.update(learner_id, {"status": "cancelled", "cancelled_at": _iso(moment)})
    if updated is None:
        raise StoreUnavailable("the cancel did not land")
    forget(learner_id)
    logger.info(
        "subscription cancelled",
        extra={"fields": {"plan": updated.plan, "ends": _iso(updated.current_period_end)}},
    )
    return updated


def resume(
    store: SubscriptionStore,
    learner_id: str,
    *,
    profile_plan: str = "free",
    now: datetime | None = None,
) -> Subscription:
    """Undo a cancel, while the period already paid for is still running. One tap.

    Idempotent in the same way: resuming a plan that is already running returns it unchanged. A
    period that has ended cannot be resumed — that would be a purchase, and this route has never
    charged anyone.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    sub = read(store, learner_id)
    if sub is None:
        raise _missing(profile_plan, _NOTHING_TO_RESUME)
    if sub.store_managed:
        raise Refused(409, "store_managed", _STORE_MANAGED, extra={"source": sub.source})
    if not sub.running(moment):
        raise Refused(409, "period_ended", _ENDED)
    if sub.status == "active":
        return sub
    updated = store.update(learner_id, {"status": "active", "cancelled_at": None})
    if updated is None:
        raise StoreUnavailable("the resume did not land")
    forget(learner_id)
    logger.info("subscription resumed", extra={"fields": {"plan": updated.plan}})
    return updated


# --- what the screen renders ----------------------------------------------------------------------
#
# One body from all three routes, in the vocabulary the app already reads
# (apps/web-pwa/src/screens/you/billing.ts): free | active | cancelling | ended. The screen may use
# these lines or its own; what it must not do is work out the state, because the state is the
# promise.
_LINES: dict[str, str] = {
    "free": (
        "You are on the free plan. The tutor is exactly the same on every plan; a paid one only "
        "buys more of it each day."
    ),
    "active": (
        "Your plan is running, and it runs to the end of the period you have already paid for. "
        "You can end it any time, in two taps."
    ),
    "cancelling": (
        "Your plan is cancelled. Nothing changes until the day you have already paid for ends, "
        "and nothing is charged after that. Everything you have learnt stays either way."
    ),
    "ended": (
        "Your plan has ended and you are back on the free allowance. Everything you learnt is "
        "still here, exactly where you left it."
    ),
    "store": "Your plan came from your phone's app store, so it is cancelled there, not here.",
    "unmanaged": _UNMANAGED,
}

#: The one plain confirmation the cancel asks for. No retention offer, no discount, no survey: it
#: states exactly what is about to happen, and nothing else.
CONFIRM = (
    "Your plan stays exactly as it is until the day you have already paid for ends. Nothing is "
    "charged after that, and everything you have learnt stays. You can bring it back any time "
    "before then."
)


def plan_view(
    sub: Subscription | None, *, profile_plan: str = "free", now: datetime | None = None
) -> dict[str, Any]:
    """Everything the plan screen needs, and nothing it has to work out for itself."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    if sub is None:
        paid = is_paid(profile_plan)
        return {
            "plan": profile_plan.strip().lower() if paid else "free",
            "effective_plan": effective_plan(None, fallback=profile_plan, now=moment),
            # A paid plan with no record still reads as `active` — it IS running — but nothing
            # here can end it, and the line says where it can be.
            "status": "active" if paid else "free",
            "source": "web",
            "cancel_at_period_end": False,
            "period_end": None,
            "cancelled_at": None,
            "can_cancel": False,
            "can_resume": False,
            "line": _LINES["unmanaged"] if paid else _LINES["free"],
        }
    running = sub.running(moment)
    if not running:
        status = "ended"
    elif sub.status == "cancelled":
        status = "cancelling"
    else:
        status = "active"
    view: dict[str, Any] = {
        "plan": sub.plan,
        "effective_plan": effective_plan(sub, now=moment),
        "status": status,
        "source": sub.source,
        # The flag every processor speaks, said twice on purpose: a reader that keys on the status
        # and a reader that keys on the flag land on the same answer. There is deliberately no
        # ``renews`` key: nothing in this product renews a subscription, and a body that said one
        # did would be the same lie in JSON that the copy law forbids on screen.
        "cancel_at_period_end": status == "cancelling",
        "period_end": _iso(sub.current_period_end),
        "cancelled_at": _iso(sub.cancelled_at),
        # A store subscription is never cancelled or resumed here, and the line says where it is —
        # the app adds that store's own steps from ``source``.
        "can_cancel": status == "active" and not sub.store_managed,
        "can_resume": status == "cancelling" and not sub.store_managed,
        "line": _LINES["store"] if sub.store_managed and running else _LINES[status],
    }
    if view["can_cancel"]:
        view["confirm"] = CONFIRM
    return view


# --- the routes -----------------------------------------------------------------------------------
def _sign_in_required() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "sign_in_required",
            "message": "Sign in first, and your plan is right here.",
        },
    )


def _unavailable(message: str) -> HTTPException:
    """The honest failure: nothing landed, so the plan is exactly as it was."""
    return HTTPException(
        status_code=503, detail={"code": "store_unavailable", "message": message}
    )


def _refused(exc: Refused) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.body())


def _profile_plan(subject: str) -> str:
    from wobo_gateway import consent

    return consent.get_profile(subject).plan


def register_billing(app: FastAPI) -> None:
    @app.get("/v1/me/subscription")
    def read_subscription(request: Request) -> dict[str, Any]:
        """Which plan, does it renew, until when — and what this learner may do about it."""
        principal = request.state.principal
        if principal is None or principal.anonymous:
            # An anonymous learner has no record and cannot have bought anything.
            return plan_view(None)
        try:
            sub = read(get_store(), principal.subject)
        except StoreUnavailable as exc:
            raise _unavailable(_UNREADABLE) from exc
        return plan_view(sub, profile_plan=_profile_plan(principal.subject))

    @app.post("/v1/me/subscription/cancel")
    def cancel_subscription(request: Request) -> dict[str, Any]:
        """Two taps from settings, and this is the second one.

        No retention offer, no discount, no survey, no second confirmation: the screen showed the
        one plain sentence (:data:`CONFIRM`) and this is what it promised.
        """
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise _sign_in_required()
        plan = _profile_plan(principal.subject)
        try:
            sub = cancel(get_store(), principal.subject, profile_plan=plan)
        except Refused as exc:
            raise _refused(exc) from exc
        except StoreUnavailable as exc:
            raise _unavailable(_UNCHANGED) from exc
        return {**plan_view(sub, profile_plan=plan), "cancelled": True}

    @app.post("/v1/me/subscription/resume")
    def resume_subscription(request: Request) -> dict[str, Any]:
        """Cancelled by mistake, or changed their mind. One tap, while the period is running."""
        principal = request.state.principal
        if principal is None or principal.anonymous:
            raise _sign_in_required()
        plan = _profile_plan(principal.subject)
        try:
            sub = resume(get_store(), principal.subject, profile_plan=plan)
        except Refused as exc:
            raise _refused(exc) from exc
        except StoreUnavailable as exc:
            raise _unavailable(_UNCHANGED) from exc
        return {**plan_view(sub, profile_plan=plan), "resumed": True}


__all__ = [
    "CONFIRM",
    "LIMITED_PATHS",
    "InMemorySubscriptionStore",
    "PostgrestSubscriptionStore",
    "Refused",
    "StoreUnavailable",
    "Subscription",
    "SubscriptionStore",
    "cancel",
    "effective_plan",
    "forget",
    "get_store",
    "is_paid",
    "metered_plan",
    "plan_for",
    "plan_view",
    "read",
    "register_billing",
    "reset_cache",
    "resume",
    "set_store",
]
