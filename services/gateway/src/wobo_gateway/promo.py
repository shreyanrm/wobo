"""Promo codes: what a code grants, who may mint one, and who may take it once.

``docs/ALLOWANCE.md`` section 3 is the law. The owner creates codes in the console; a learner
types one on the You page, or at checkout. Three kinds and no more:

============================ ==========================================================
``plan_days``                N days of a named plan, free. A row in ``learner.subscriptions``
                             with ``origin = 'promo'``: nothing charges it, and it runs out.
``allowance_boost_days``     Extra daily allowance, in paise a day, for N days. Read by the
                             allowance through :func:`allowance_boost_paise`.
``percent_off_first``        A percentage off the FIRST payment, applied at checkout by the
                             payment provider (``billing/payments.py``). Never a refund.
============================ ==========================================================

**The refusals are deliberately uneven, and that is the design.** A code nobody issued, and a
code that was disabled, get the SAME answer — "I do not know that code" — because telling the two
apart is a way to find out which codes exist. A code that has expired, or been used up, or been
taken already by this account gets its own line, because the person holding it already knew a
real code and deserves to be told which of the three happened.

**Nothing is spent on a refusal.** Every rule is checked before a single grant is written, and a
grant that cannot be applied (a paid plan already running, a provider that would not take the
offer) leaves the code exactly as unspent as it was.

**The count of uses is counted, never decremented** (migration 0027, ruling 2): there is no
``uses_left`` column to drift from the redemptions that actually happened. The database holds the
once-per-account promise as a partial unique index, and :class:`AlreadyRedeemed` is what that
constraint feels like from here — the route checks first for a kind line, and the constraint is
what makes the answer true when two replicas check at the same moment.

**A percentage happens at the provider or it does not happen.** ``provider_offer_id`` is required
on that kind, so a code that would show a learner a discount and then charge them the full price
cannot be created. If the code cannot be applied, the checkout is REFUSED rather than quietly
completed at full price: somebody who typed a code and pressed pay must never be charged as
though they had not.

Every line a learner can read here keeps the register (``docs/copy/voice.md`` section 10a): plain
words, no em dash, no exclamation, no provider name, and no money at the learner's end — a boost
is "a bigger day", never a number of rupees (``docs/ALLOWANCE.md`` section 2).
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field

from wobo_gateway import billing
from wobo_gateway.admin_auth import (
    ADMIN_MANAGE,
    CONSOLE_READ,
    AdminContext,
    admin_router,
    requires,
)
from wobo_gateway.reports import handle

logger = logging.getLogger("wobo.gateway.promo")

SCHEMA = "ops"
CODES_TABLE = "promo_codes"
REDEMPTIONS_TABLE = "promo_redemptions"
_HTTP_TIMEOUT_S = 5.0

#: The learner's door. One route, and it writes, so it rides the per-caller limiter (app.py).
REDEEM_PATH = "/v1/promo/redeem"
LIMITED_PATHS = frozenset({REDEEM_PATH})

#: The three kinds, closed, and the same list migration 0027 checks in the database.
KINDS: tuple[str, ...] = ("plan_days", "allowance_boost_days", "percent_off_first")

#: The one shape a code may have, and the same expression the column's check constraint carries.
#: Upper case, a letter or digit first, then letters, digits and hyphens, three to thirty two.
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,31}$")
MAX_CODE = 32
MAX_NOTE = 500

#: The widest page the desk may ask for. A code list is read, not scrolled.
MAX_PAGE = 200
DEFAULT_PAGE = 50

#: The plans a ``plan_days`` code may grant, smallest first. The order is what stops a code for a
#: smaller plan quietly demoting a learner who already has a bigger one.
PLAN_ORDER: tuple[str, ...] = ("plus", "pro", "max")
PLAN_WORDS: dict[str, str] = {"plus": "Plus", "pro": "Pro", "max": "Max"}


#: What the learner reads. Copy law: DESIGN.md section 0, voice.md section 10a.
LINES: dict[str, str] = {
    "not_a_code": "That does not look like a code. Check it and try again.",
    # A code nobody issued and a code that was switched off read the same on purpose: the
    # difference between them is a way to find out which codes exist.
    "unknown_code": "I do not know that code. Check it and try again.",
    "expired": "That code has run out. It was only good for a while.",
    "used_up": "That code has been taken as many times as it could be.",
    "already_used": "You have used that code already. It only works once on an account.",
    "use_at_checkout": (
        "That code comes off your first payment, so use it on the plans page when you pay."
    ),
    "not_at_checkout": (
        "That code is not one that comes off a payment. Use it on your profile page instead."
    ),
    "already_subscribed": (
        "You are already on a paid plan, so this code has nothing to add right now. Keep it for "
        "when that plan ends."
    ),
    "unavailable": (
        "I could not check that code just now. Nothing has changed. Try again in a moment."
    ),
    "sign_in_required": "Sign in on your own account first, then the code has somewhere to go.",
    "granted_plan": "That code worked. {plan} is on until {date}, and nothing is charged for it.",
    "granted_boost": "That code worked. You have a bigger day until {date}.",
}

#: What actually feeds this desk, in one plain line, served with the codes for the same reason
#: ``desks_api.FEEDS`` is: an empty desk must say what would fill it rather than read as broken.
FEED: dict[str, str] = {
    "what": (
        "Every promo code that has been minted, what it grants, how many times it has been "
        "taken, and whether it is still live."
    ),
    "feeds": (
        "This desk is the only thing that mints one. A code is taken at POST /v1/promo/redeem "
        "(a plan's days, or extra allowance) or at POST /v1/billing/checkout (a percentage off "
        "the first payment, applied by the payment provider)."
    ),
    "missing": (
        "There is no campaign, no landing page that carries a code, and no mail that sends one: "
        "a code reaches a person because somebody typed it to them. Nothing here reverses a "
        "charge, and no kind of code can: the percentage comes off the first payment before it "
        "is taken, and never afterwards."
    ),
}


# --- the errors -----------------------------------------------------------------------------------
class BadCode(Exception):
    """A string that is not the shape of any code we issue. Refused before a filter sees it."""


class StoreUnavailable(Exception):
    """The codes could not be reached. Callers say so; they never guess at a grant."""


class AlreadyRedeemed(Exception):
    """The database refused a second redemption on a once-per-account code. Ruling 1."""


class Refused(Exception):
    """A rule said no. ``code`` picks the line and the status; nothing has been granted."""

    def __init__(self, code: str, *, status: int = 409, **fields: Any) -> None:
        self.code = code
        self.status = status
        self.fields = fields
        self.message = LINES.get(code, LINES["unavailable"])
        super().__init__(f"{code}: {self.message}")

    def http(self) -> HTTPException:
        return HTTPException(
            status_code=self.status,
            detail={"code": self.code, "message": self.message, **self.fields},
        )


_STATUS: dict[str, int] = {
    "not_a_code": 422,
    "unknown_code": 404,
    "sign_in_required": 403,
    "unavailable": 503,
}


def refuse(code: str, **fields: Any) -> Refused:
    return Refused(code, status=_STATUS.get(code, 409), **fields)


# --- the model ------------------------------------------------------------------------------------
def normalise(raw: str | None) -> str:
    """The one string a code becomes. Raises :class:`BadCode` on anything else.

    Case and surrounding space are a person typing, not a different code, so both are removed.
    Everything else is refused here rather than looked up: the value is about to key a database
    filter, and a shape nobody issues has no business reaching one.
    """
    text = (raw or "").strip().upper()
    if not text or len(text) > MAX_CODE or not CODE_RE.match(text):
        raise BadCode("that is not the shape of a code")
    return text


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


@dataclass(frozen=True)
class PromoCode:
    """One row of ``ops.promo_codes`` as the gateway reads and writes it."""

    id: str
    code: str
    kind: str
    #: Days for ``plan_days``, paise a day for ``allowance_boost_days``, a whole percent for
    #: ``percent_off_first``. One column, checked per kind, as the migration has it.
    value: int
    days: int | None = None
    plan: str | None = None
    provider_offer_id: str | None = None
    expires_at: datetime | None = None
    #: ``None`` is unlimited. Counted against the redemptions, never decremented.
    max_uses: int | None = None
    once_per_account: bool = True
    created_by: str | None = None
    disabled_at: datetime | None = None
    disabled_by: str | None = None
    note: str | None = None
    created_at: datetime | None = None

    def live(self, now: datetime) -> bool:
        """Not switched off and not past its date. Says nothing about uses."""
        if self.disabled_at is not None:
            return False
        return self.expires_at is None or now < self.expires_at


@dataclass(frozen=True)
class Redemption:
    """One row of ``ops.promo_redemptions``: who took what, when, and what it granted."""

    id: str
    code_id: str
    code: str
    kind: str
    learner_id: str
    once_per_account: bool = True
    #: The grant RESOLVED at the moment it was taken (migration 0027, ruling 3). A code edited
    #: afterwards cannot change the story of what somebody was already given.
    granted: dict[str, Any] = field(default_factory=dict)
    provider_subscription_id: str | None = None
    redeemed_at: datetime | None = None

    @classmethod
    def make(
        cls,
        code: PromoCode,
        learner_id: str,
        granted: dict[str, Any],
        *,
        at: datetime | None = None,
        provider_subscription_id: str | None = None,
    ) -> Redemption:
        return cls(
            id=str(uuid.uuid4()),
            code_id=code.id,
            code=code.code,
            kind=code.kind,
            learner_id=learner_id,
            once_per_account=code.once_per_account,
            granted=dict(granted),
            provider_subscription_id=provider_subscription_id,
            redeemed_at=at or datetime.now(UTC),
        )


def code_from_row(row: dict[str, Any]) -> PromoCode:
    value = row.get("value")
    return PromoCode(
        id=str(row.get("id") or ""),
        code=str(row.get("code") or "").strip().upper(),
        kind=str(row.get("kind") or "").strip().lower(),
        value=int(value) if isinstance(value, int) and not isinstance(value, bool) else 0,
        days=int(row["days"]) if isinstance(row.get("days"), int) else None,
        plan=(str(row["plan"]).strip().lower() or None) if row.get("plan") else None,
        provider_offer_id=(str(row["provider_offer_id"]) or None)
        if row.get("provider_offer_id")
        else None,
        expires_at=_when(row.get("expires_at")),
        max_uses=int(row["max_uses"]) if isinstance(row.get("max_uses"), int) else None,
        once_per_account=bool(row.get("once_per_account", True)),
        created_by=str(row["created_by"]) if row.get("created_by") else None,
        disabled_at=_when(row.get("disabled_at")),
        disabled_by=str(row["disabled_by"]) if row.get("disabled_by") else None,
        note=str(row["note"]) if row.get("note") else None,
        created_at=_when(row.get("created_at")),
    )


def code_to_row(code: PromoCode) -> dict[str, Any]:
    return {
        "id": code.id,
        "code": code.code,
        "kind": code.kind,
        "value": code.value,
        "days": code.days,
        "plan": code.plan,
        "provider_offer_id": code.provider_offer_id,
        "expires_at": _iso(code.expires_at),
        "max_uses": code.max_uses,
        "once_per_account": code.once_per_account,
        "created_by": code.created_by,
        "disabled_at": _iso(code.disabled_at),
        "disabled_by": code.disabled_by,
        "note": code.note,
    }


def redemption_from_row(row: dict[str, Any]) -> Redemption:
    granted = row.get("granted")
    return Redemption(
        id=str(row.get("id") or ""),
        code_id=str(row.get("code_id") or ""),
        code=str(row.get("code") or "").strip().upper(),
        kind=str(row.get("kind") or "").strip().lower(),
        learner_id=str(row.get("learner_id") or ""),
        once_per_account=bool(row.get("once_per_account", True)),
        granted=dict(granted) if isinstance(granted, dict) else {},
        provider_subscription_id=str(row["provider_subscription_id"])
        if row.get("provider_subscription_id")
        else None,
        redeemed_at=_when(row.get("redeemed_at")),
    )


def redemption_to_row(taken: Redemption) -> dict[str, Any]:
    return {
        "id": taken.id,
        "code_id": taken.code_id,
        "code": taken.code,
        "kind": taken.kind,
        "learner_id": taken.learner_id,
        "once_per_account": taken.once_per_account,
        "granted": taken.granted,
        "provider_subscription_id": taken.provider_subscription_id,
        "redeemed_at": _iso(taken.redeemed_at),
    }


# --- the store seam -------------------------------------------------------------------------------
class PromoStore(Protocol):
    def by_code(self, code: str) -> PromoCode | None: ...

    def insert_code(self, code: PromoCode) -> PromoCode: ...

    def disable(self, code_id: str, *, by: str | None, at: datetime) -> PromoCode | None: ...

    def codes(self, *, limit: int) -> list[PromoCode]: ...

    def uses(self, code_id: str) -> int: ...

    def taken_by(self, code_id: str, learner_id: str) -> Redemption | None: ...

    def record(self, taken: Redemption) -> Redemption: ...

    def redemptions(
        self, *, code_id: str | None = ..., learner_id: str | None = ..., limit: int = ...
    ) -> list[Redemption]: ...


class InMemoryPromoStore:
    """The suite's store and a local run's. The unique index of ruling 1 is honoured here too."""

    def __init__(self) -> None:
        self.rows: dict[str, PromoCode] = {}
        self.taken: list[Redemption] = []
        self._lock = threading.Lock()

    def by_code(self, code: str) -> PromoCode | None:
        with self._lock:
            for row in self.rows.values():
                if row.code == code:
                    return row
            return None

    def insert_code(self, code: PromoCode) -> PromoCode:
        with self._lock:
            if any(row.code == code.code for row in self.rows.values()):
                raise AlreadyRedeemed(f"{code.code} already exists")
            stamped = replace(code, created_at=code.created_at or datetime.now(UTC))
            self.rows[stamped.id] = stamped
            return stamped

    def disable(self, code_id: str, *, by: str | None, at: datetime) -> PromoCode | None:
        with self._lock:
            found = self.rows.get(code_id)
            if found is None:
                return None
            # Already off stays off, with the moment it first went off: switching a switched-off
            # code again is not a new fact and must not rewrite when it happened.
            if found.disabled_at is not None:
                return found
            moved = replace(found, disabled_at=at, disabled_by=by)
            self.rows[code_id] = moved
            return moved

    def codes(self, *, limit: int) -> list[PromoCode]:
        with self._lock:
            rows = list(self.rows.values())
        rows.sort(key=lambda row: (row.created_at or datetime.now(UTC)), reverse=True)
        return rows[:limit]

    def uses(self, code_id: str) -> int:
        with self._lock:
            return sum(1 for row in self.taken if row.code_id == code_id)

    def taken_by(self, code_id: str, learner_id: str) -> Redemption | None:
        with self._lock:
            for row in self.taken:
                if row.code_id == code_id and row.learner_id == learner_id:
                    return row
            return None

    def record(self, taken: Redemption) -> Redemption:
        with self._lock:
            if taken.once_per_account and any(
                row.code_id == taken.code_id and row.learner_id == taken.learner_id
                for row in self.taken
            ):
                raise AlreadyRedeemed("that account has taken that code already")
            stamped = replace(taken, redeemed_at=taken.redeemed_at or datetime.now(UTC))
            self.taken.append(stamped)
            return stamped

    def redemptions(
        self,
        *,
        code_id: str | None = None,
        learner_id: str | None = None,
        limit: int = DEFAULT_PAGE,
    ) -> list[Redemption]:
        with self._lock:
            rows = list(self.taken)
        rows = [r for r in rows if code_id is None or r.code_id == code_id]
        rows = [r for r in rows if learner_id is None or r.learner_id == learner_id]
        rows.sort(key=lambda row: (row.redeemed_at or datetime.now(UTC)), reverse=True)
        return rows[:limit]


class UnconfiguredPromoStore:
    """No project and no explicit memory store: every call refuses.

    The alternative — an empty dictionary — would let a production gateway that lost its project
    answer "I do not know that code" to a learner holding a real one, and answer "no codes" to an
    owner looking at a desk. Both are worse than being unavailable and saying so.
    """

    def _no(self) -> Any:
        raise StoreUnavailable("no project is configured, so there are no codes to read or write")

    def by_code(self, code: str) -> PromoCode | None:
        return self._no()

    def insert_code(self, code: PromoCode) -> PromoCode:
        return self._no()

    def disable(self, code_id: str, *, by: str | None, at: datetime) -> PromoCode | None:
        return self._no()

    def codes(self, *, limit: int) -> list[PromoCode]:
        return self._no()

    def uses(self, code_id: str) -> int:
        return self._no()

    def taken_by(self, code_id: str, learner_id: str) -> Redemption | None:
        return self._no()

    def record(self, taken: Redemption) -> Redemption:
        return self._no()

    def redemptions(
        self,
        *,
        code_id: str | None = None,
        learner_id: str | None = None,
        limit: int = DEFAULT_PAGE,
    ) -> list[Redemption]:
        return self._no()


Request_ = Callable[..., Any]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call against ``ops``. The shape ``reports._request`` shares."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": SCHEMA,
        "Content-Profile": SCHEMA,
        "Prefer": "return=representation" if want_rows else "return=minimal",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    prepared = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(prepared, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)
#: PostgREST's code for a unique violation, which here is only ever the once-per-account index.
_UNIQUE_VIOLATION = "23505"


class PostgrestPromoStore:
    """``ops.promo_codes`` and ``ops.promo_redemptions`` over PostgREST with the service-role key.

    A publishable key cannot reach ``ops`` at all — migration 0027 revokes it — so a store built
    with one would fail in a way that looked like "no such code" rather than "no access". That is
    why the key is not a parameter with a fallback.
    """

    def __init__(self, base_url: str, service_key: str, *, request: Request_ | None = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestPromoStore needs a project URL and a service-role key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, table: str, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{table}?{encoded}"

    def _call(
        self, table: str, method: str, params: dict[str, str], *, body: Any = None
    ) -> list[dict[str, Any]]:
        try:
            rows = self._request(
                self._url(table, params), self._key, method, body=body, want_rows=True
            )
        except urllib.error.HTTPError as exc:  # the once-only, as the database enforces it
            detail = ""
            try:
                detail = exc.read().decode()[:500]
            except Exception:  # noqa: BLE001 - a body we cannot read is still a refusal
                detail = ""
            if exc.code == 409 or _UNIQUE_VIOLATION in detail:
                raise AlreadyRedeemed("the database refused a second redemption") from exc
            logger.warning(
                "promo: store call failed",
                extra={"fields": {"table": table, "method": method, "status": exc.code}},
            )
            raise StoreUnavailable(f"{table}: {exc.code}") from exc
        except _NETWORK_ERRORS as exc:
            # The query string is not logged: a filter here can carry a learner's id or a code.
            logger.warning(
                "promo: store call failed",
                extra={"fields": {"table": table, "method": method, "error": str(exc)}},
            )
            raise StoreUnavailable(str(exc)) from exc
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    @staticmethod
    def _uuid(value: str) -> str:
        try:
            return str(uuid.UUID(str(value)))
        except (ValueError, AttributeError, TypeError) as exc:
            raise StoreUnavailable("that is not an id this store can look up") from exc

    def by_code(self, code: str) -> PromoCode | None:
        rows = self._call(
            CODES_TABLE, "GET", {"code": f"eq.{normalise(code)}", "select": "*", "limit": "1"}
        )
        return code_from_row(rows[0]) if rows else None

    def insert_code(self, code: PromoCode) -> PromoCode:
        rows = self._call(CODES_TABLE, "POST", {"select": "*"}, body=code_to_row(code))
        return code_from_row(rows[0]) if rows else code

    def disable(self, code_id: str, *, by: str | None, at: datetime) -> PromoCode | None:
        rows = self._call(
            CODES_TABLE,
            "PATCH",
            {"id": f"eq.{self._uuid(code_id)}", "disabled_at": "is.null", "select": "*"},
            body={"disabled_at": _iso(at), "disabled_by": by},
        )
        if rows:
            return code_from_row(rows[0])
        # Nothing matched: either there is no such code, or it was already off. Read it back, so
        # "already off" is an answer rather than an invented failure.
        found = self._call(CODES_TABLE, "GET", {"id": f"eq.{self._uuid(code_id)}", "select": "*"})
        return code_from_row(found[0]) if found else None

    def codes(self, *, limit: int) -> list[PromoCode]:
        rows = self._call(
            CODES_TABLE,
            "GET",
            {"select": "*", "order": "created_at.desc", "limit": str(max(1, min(limit, MAX_PAGE)))},
        )
        return [code_from_row(row) for row in rows]

    def uses(self, code_id: str) -> int:
        # RULING 2: the count IS the trail. `select=id` keeps the body small; the rows are the
        # answer, so a count header that a proxy strips cannot silently become a zero.
        rows = self._call(
            REDEMPTIONS_TABLE,
            "GET",
            {"code_id": f"eq.{self._uuid(code_id)}", "select": "id", "limit": str(MAX_PAGE)},
        )
        return len(rows)

    def taken_by(self, code_id: str, learner_id: str) -> Redemption | None:
        rows = self._call(
            REDEMPTIONS_TABLE,
            "GET",
            {
                "code_id": f"eq.{self._uuid(code_id)}",
                "learner_id": f"eq.{self._uuid(learner_id)}",
                "select": "*",
                "limit": "1",
            },
        )
        return redemption_from_row(rows[0]) if rows else None

    def record(self, taken: Redemption) -> Redemption:
        rows = self._call(
            REDEMPTIONS_TABLE, "POST", {"select": "*"}, body=redemption_to_row(taken)
        )
        return redemption_from_row(rows[0]) if rows else taken

    def redemptions(
        self,
        *,
        code_id: str | None = None,
        learner_id: str | None = None,
        limit: int = DEFAULT_PAGE,
    ) -> list[Redemption]:
        params: dict[str, str] = {
            "select": "*",
            "order": "redeemed_at.desc",
            "limit": str(max(1, min(limit, MAX_PAGE))),
        }
        if code_id is not None:
            params["code_id"] = f"eq.{self._uuid(code_id)}"
        if learner_id is not None:
            params["learner_id"] = f"eq.{self._uuid(learner_id)}"
        rows = self._call(REDEMPTIONS_TABLE, "GET", params)
        return [redemption_from_row(row) for row in rows]


_store: PromoStore | None = None
_store_lock = threading.Lock()


def build_store() -> PromoStore:
    """The project store when configured, the memory store when it is asked for BY NAME."""
    if (os.getenv("PROMO_STORE") or "").strip().lower() == "memory":
        return InMemoryPromoStore()
    base = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or ""
    ).strip()
    if base and key:
        return PostgrestPromoStore(base, key)
    logger.warning("promo: no project configured — codes refuse rather than reading as unknown")
    return UnconfiguredPromoStore()


def get_store() -> PromoStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: PromoStore | None) -> None:
    """Test seam. ``None`` drops the singleton so the next call rebuilds from the environment."""
    global _store
    with _store_lock:
        _store = store


# --- the rules ------------------------------------------------------------------------------------
def find(raw: str | None) -> PromoCode:
    """The code, or the refusal. Never ``None``: every caller would have to invent the same line.

    A disabled code and a code nobody issued raise the SAME refusal, on purpose.
    """
    try:
        wanted = normalise(raw)
    except BadCode as exc:
        raise refuse("not_a_code") from exc
    try:
        found = get_store().by_code(wanted)
    except StoreUnavailable as exc:
        raise refuse("unavailable") from exc
    if found is None or found.disabled_at is not None:
        return _unknown()
    return found


def _unknown() -> PromoCode:
    raise refuse("unknown_code")


def check(code: PromoCode, learner_id: str, *, now: datetime) -> None:
    """Every rule that can refuse a code, before a single grant is written.

    In this order on purpose: the date first (it is about the code), the account second (it is
    about this person), the ceiling last (it is the one that costs a count).
    """
    if not code.live(now):
        raise refuse("expired")
    store = get_store()
    try:
        already = store.taken_by(code.id, learner_id)
        if already is not None and code.once_per_account:
            raise refuse("already_used")
        if code.max_uses is not None and store.uses(code.id) >= code.max_uses:
            raise refuse("used_up")
    except StoreUnavailable as exc:
        raise refuse("unavailable") from exc


def _day(moment: datetime) -> str:
    """A date a learner reads: "12 October". No year, because every grant is inside one."""
    return f"{moment.day} {moment.strftime('%B')}"


# --- the grants -----------------------------------------------------------------------------------
def _rank(plan: str | None) -> int:
    return PLAN_ORDER.index(plan) if plan in PLAN_ORDER else -1


def grant_plan_days(code: PromoCode, learner_id: str, *, now: datetime) -> dict[str, Any]:
    """N days of a plan, as a row nothing is charging.

    THE ROW IS EXTENDED, NEVER REPLACED. Days already granted are never taken back, and a code
    for a smaller plan never lowers a plan the learner already has: it adds its days and leaves
    the bigger word where it is.

    REFUSED WHILE A PROVIDER IS CHARGING. Moving ``current_period_end`` on a row a provider is
    charging would put the next charge and the plan out of step, and the learner would either be
    charged for days they were given or keep days nobody paid for. The honest answer is that the
    code has nothing to add right now, and it stays unspent for the day that plan ends.
    """
    days = max(1, int(code.value))
    plan = code.plan if code.plan in PLAN_ORDER else "plus"
    store = billing.get_store()
    try:
        current = billing.read(store, learner_id)
    except billing.StoreUnavailable as exc:
        raise refuse("unavailable") from exc

    if current is not None and current.provider_managed and current.running(now):
        raise refuse("already_subscribed")
    if current is not None and current.store_managed and current.running(now):
        raise refuse("already_subscribed")

    was = current.current_period_end if current is not None and current.running(now) else None
    ends = (was or now) + timedelta(days=days)
    granted = {
        "plan": plan,
        "days": days,
        "period_end": _iso(ends),
        "extended_from": _iso(was),
    }
    if current is None:
        store.insert(
            billing.Subscription(
                id=str(uuid.uuid4()),
                learner_id=learner_id,
                plan=plan,
                status="active",
                # Migration 0027 adds this word. A promo row was not bought anywhere: nothing
                # charges it and it simply runs out, which `plan_view` already renders correctly.
                origin="promo",
                current_period_end=ends,
                started_at=now,
            )
        )
    else:
        kept = plan if _rank(plan) > _rank(current.plan) else current.plan
        granted["plan"] = kept
        written = store.update(
            learner_id,
            {
                "plan": kept,
                "status": "active",
                "cancelled_at": None,
                "current_period_end": billing._iso(ends),
            },
        )
        if written is None:
            raise refuse("unavailable")
    # The effective plan is cached for five minutes; a learner who just redeemed must not have to
    # wait for it.
    billing.forget(learner_id)
    return granted


def grant_allowance_boost(code: PromoCode, learner_id: str, *, now: datetime) -> dict[str, Any]:
    """Extra daily allowance, in paise a day, for N days.

    Nothing is written to a meter here. The redemption row IS the grant, and
    :func:`allowance_boost_paise` is what the daily allowance reads: a boost cannot drift from
    its own record, and a boost that has run out stops on its date without anything having to
    remember to remove it.
    """
    days = max(1, int(code.days or 1))
    until = now + timedelta(days=days)
    return {
        "paise_per_day": max(0, int(code.value)),
        "days": days,
        "until": _iso(until),
    }


def allowance_boost_paise(learner_id: str, *, now: datetime | None = None) -> int:
    """THE SEAM THE DAILY ALLOWANCE READS (``docs/ALLOWANCE.md`` section 4).

    How many paise to add to this learner's allowance today, from every boost still running.
    Boosts add up; a learner with two of them has both. Returns ``0`` when the codes cannot be
    reached, because a boost nobody can confirm is not a boost — and the learner still has the
    allowance their plan already bought.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    try:
        rows = get_store().redemptions(learner_id=learner_id, limit=MAX_PAGE)
    except StoreUnavailable:
        logger.warning("promo: the boost could not be read; the allowance stands as it is")
        return 0
    total = 0
    for row in rows:
        if row.kind != "allowance_boost_days":
            continue
        until = _when(row.granted.get("until"))
        paise = row.granted.get("paise_per_day")
        if until is None or not isinstance(paise, int) or isinstance(paise, bool):
            continue
        if (row.redeemed_at or moment) <= moment < until:
            total += max(0, paise)
    return total


# --- redeeming ------------------------------------------------------------------------------------
def redeem(learner_id: str, raw: str | None, *, now: datetime | None = None) -> dict[str, Any]:
    """Validate, apply, record. In that order, and the record is last for a reason: a grant that
    did not land must not leave a use behind it."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    code = find(raw)
    if code.kind == "percent_off_first":
        # It comes off a payment, so it is used where the payment is. Never as a refund.
        raise refuse("use_at_checkout")
    check(code, learner_id, now=moment)

    if code.kind == "plan_days":
        granted = grant_plan_days(code, learner_id, now=moment)
        ends = _when(granted.get("period_end")) or moment
        line = LINES["granted_plan"].format(
            plan=PLAN_WORDS.get(str(granted.get("plan")), "Your plan"), date=_day(ends)
        )
    elif code.kind == "allowance_boost_days":
        granted = grant_allowance_boost(code, learner_id, now=moment)
        until = _when(granted.get("until")) or moment
        line = LINES["granted_boost"].format(date=_day(until))
    else:  # a kind the database allows and this file has not learnt
        logger.error("promo: a code of an unknown kind", extra={"fields": {"kind": code.kind}})
        raise refuse("unknown_code")

    try:
        get_store().record(Redemption.make(code, learner_id, granted, at=moment))
    except AlreadyRedeemed as exc:
        # The database refused what the check above allowed: two calls arrived together. The
        # grant is idempotent by shape (the period end is a maximum, the boost is a row), so the
        # honest answer is the one the second caller would have got a moment earlier.
        raise refuse("already_used") from exc
    except StoreUnavailable as exc:
        # The grant landed and the record did not. Logged loudly rather than hidden: the learner
        # has what they were promised, and the use count is short by one until somebody looks.
        logger.error(
            "promo: a code was applied but not recorded",
            extra={"fields": {"code": code.code, "kind": code.kind}},
        )
        raise refuse("unavailable") from exc

    return {"ok": True, "kind": code.kind, "granted": granted, "line": line}


# --- the checkout seam ----------------------------------------------------------------------------
@dataclass(frozen=True)
class Offer:
    """A validated ``percent_off_first``, ready for the provider and for the browser."""

    code: PromoCode
    percent: int
    offer_id: str
    #: The redemption this learner already has for this code, if any. Re-opening the same
    #: checkout must not spend a second use: a modal closed over dinner is not a redemption.
    existing: Redemption | None = None

    def first_amount_paise(self, full_paise: int) -> int:
        return max(0, round(full_paise * (100 - self.percent) / 100))


def offer_for_checkout(learner_id: str, raw: str | None, *, now: datetime | None = None) -> Offer:
    """The offer, or the refusal. Called BEFORE anything is created at the provider, so a code
    that cannot be applied costs a refusal rather than a full-price subscription."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    code = find(raw)
    if code.kind != "percent_off_first":
        raise refuse("not_at_checkout")
    if not code.provider_offer_id:
        # Migration 0027 makes this impossible to store; it is still checked, because a row
        # written by hand in the SQL editor is a row this constraint was not asked about.
        logger.error(
            "promo: a percentage code carries no provider offer",
            extra={"fields": {"code": code.code}},
        )
        raise refuse("unknown_code")
    try:
        existing = get_store().taken_by(code.id, learner_id)
    except StoreUnavailable as exc:
        raise refuse("unavailable") from exc
    if existing is None:
        check(code, learner_id, now=moment)
    elif not code.live(moment):
        # The same learner, coming back to a code that has since expired. The discount is over.
        raise refuse("expired")
    return Offer(
        code=code, percent=int(code.value), offer_id=code.provider_offer_id, existing=existing
    )


def bind_checkout(
    offer: Offer, learner_id: str, subscription_id: str, *, now: datetime | None = None
) -> None:
    """Record the use against the subscription the discount was attached to.

    The same learner re-opening the same checkout reuses the redemption they already have: one
    row, one use, and ``provider_subscription_id`` stays the first subscription the discount was
    put on. The table is append-only (migration 0027), so there is nothing to update and nothing
    that would pretend a second checkout was a second person.
    """
    if offer.existing is not None:
        return
    granted = {
        "percent": offer.percent,
        "offer_id": offer.offer_id,
        "subscription_id": subscription_id,
    }
    try:
        get_store().record(
            Redemption.make(
                offer.code,
                learner_id,
                granted,
                at=(now or datetime.now(UTC)),
                provider_subscription_id=subscription_id,
            )
        )
    except AlreadyRedeemed:
        # Two checkouts at once. The discount is attached to both provider subscriptions, only
        # one of which can ever be paid (`payments._open_checkout` refuses a second payable one).
        logger.info("promo: a second checkout reused an existing redemption")
    except StoreUnavailable:
        # The subscription exists at the provider with the offer on it, so the learner still gets
        # what they were shown. The missing row is logged, not hidden.
        logger.error(
            "promo: a discount was applied but not recorded",
            extra={"fields": {"code": offer.code.code}},
        )


# --- the learner's door ---------------------------------------------------------------------------
class RedeemBody(BaseModel):
    code: str = Field(max_length=MAX_CODE)


def register_promo(app: FastAPI) -> None:
    @app.post(REDEEM_PATH)
    def redeem_code(request: Request, body: RedeemBody) -> dict[str, Any]:
        """Take one code on the signed-in learner's own account."""
        principal = getattr(request.state, "principal", None)
        # An anonymous subject IS a freshly minted account: it costs one public call to make, so a
        # code redeemed on one has no limit at all. The door is the same one the checkout uses.
        if principal is None or principal.anonymous:
            raise refuse("sign_in_required").http()
        try:
            return redeem(principal.subject, body.code)
        except Refused as refused:
            raise refused.http() from refused


# --- the console desk -----------------------------------------------------------------------------
class CreateBody(BaseModel):
    code: str = Field(max_length=MAX_CODE)
    kind: str = Field(max_length=32)
    value: int = Field(ge=1, le=100000)
    days: int | None = Field(default=None, ge=1, le=366)
    plan: str | None = Field(default=None, max_length=8)
    provider_offer_id: str | None = Field(default=None, max_length=128)
    expires_at: str | None = Field(default=None, max_length=64)
    max_uses: int | None = Field(default=None, ge=1, le=1000000)
    once_per_account: bool = True
    note: str | None = Field(default=None, max_length=MAX_NOTE)


class DisableBody(BaseModel):
    code: str = Field(max_length=MAX_CODE)


def _bad(code: str, message: str, *, status: int = 422) -> HTTPException:
    """The operator's register: plainly, with the numbers. Never the learner's voice."""
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def code_view(code: PromoCode, uses: int, *, now: datetime) -> dict[str, Any]:
    """One code as the desk shows it. Everything an owner needs to decide, and no learner."""
    return {
        "id": code.id,
        "code": code.code,
        "kind": code.kind,
        "value": code.value,
        "days": code.days,
        "plan": code.plan,
        # The provider's own object id. Not a secret (a plan id is not either, 0023), and the one
        # thing that says whether a percentage can actually come off a payment.
        "provider_offer_id": code.provider_offer_id,
        "expires_at": _iso(code.expires_at),
        "max_uses": code.max_uses,
        "uses": uses,
        # Uses left, or null for unlimited. Derived here so two screens cannot disagree.
        "uses_left": None if code.max_uses is None else max(0, code.max_uses - uses),
        "once_per_account": code.once_per_account,
        # Live means a learner typing it right now would get past every rule except the count.
        "live": code.live(now) and (code.max_uses is None or uses < code.max_uses),
        "disabled_at": _iso(code.disabled_at),
        "note": code.note,
        "created_at": _iso(code.created_at),
    }


def redemption_view(taken: Redemption) -> dict[str, Any]:
    """One redemption as the desk shows it. A keyed digest stands in for the learner, exactly as
    on the four queues: enough to notice the same account twice, never enough to look them up."""
    return {
        "id": taken.id,
        "code": taken.code,
        "kind": taken.kind,
        "handle": handle(taken.learner_id),
        "granted": taken.granted,
        "subscription_id": taken.provider_subscription_id,
        "redeemed_at": _iso(taken.redeemed_at),
    }


def _built(body: CreateBody, *, by: str | None) -> PromoCode:
    """One code from what an owner typed, or the refusal that says which field is wrong."""
    try:
        code = normalise(body.code)
    except BadCode as exc:
        raise _bad(
            "not_a_code",
            "A code is three to thirty two characters: letters, digits and the hyphen.",
        ) from exc
    kind = (body.kind or "").strip().lower()
    if kind not in KINDS:
        raise _bad("unknown_kind", f"A code is one of: {', '.join(KINDS)}.")

    plan = (body.plan or "").strip().lower() or None
    days = body.days
    offer = (body.provider_offer_id or "").strip() or None

    if kind == "plan_days":
        if plan not in PLAN_ORDER:
            raise _bad("needs_plan", "Days of which plan? One of: plus, pro, max.")
        if body.value > 366:
            raise _bad("too_many_days", "A code grants at most three hundred and sixty six days.")
        days, offer = None, None
    elif kind == "allowance_boost_days":
        if days is None:
            raise _bad("needs_days", "A boost runs for a number of days. Say how many.")
        plan, offer = None, None
    else:  # percent_off_first
        if body.value > 100:
            raise _bad("bad_percent", "A percentage off is between one and one hundred.")
        if not offer:
            # RULING 4. A discount that cannot come off a payment is a lie waiting to be told.
            raise _bad(
                "needs_provider_offer",
                "A percentage off has to point at the payment provider's own offer, or it cannot "
                "actually come off the payment. Create the offer first and paste its id here.",
            )
        plan, days = None, None

    expires = _when(body.expires_at) if body.expires_at else None
    if body.expires_at and expires is None:
        raise _bad("bad_expiry", "I could not read that date. Use an ISO moment, or leave it out.")

    return PromoCode(
        id=str(uuid.uuid4()),
        code=code,
        kind=kind,
        value=int(body.value),
        days=days,
        plan=plan,
        provider_offer_id=offer,
        expires_at=expires,
        max_uses=body.max_uses,
        once_per_account=bool(body.once_per_account),
        created_by=by,
        note=(body.note or "").strip() or None,
    )


def register_promo_desk(app: FastAPI) -> None:
    """The promo desk. Reads on ``console.read``; writes on ``admin.manage``, which only an owner
    carries and which the guard has already demanded a step-up for."""
    router = admin_router(tags=["admin", "promo"])

    @router.get("/promo")
    def codes_desk(
        limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
        ctx: AdminContext = Depends(requires(CONSOLE_READ)),
    ) -> dict[str, Any]:
        """Every code, newest first, with how many times it has actually been taken."""
        ctx.audit("promo.desk.read", resource_type="promo_codes")
        now = datetime.now(UTC)
        store = get_store()
        try:
            rows = store.codes(limit=limit)
            # No zeros on an unreachable store. A zero would say "nobody has taken it".
            views = [code_view(row, store.uses(row.id), now=now) for row in rows]
        except StoreUnavailable:
            return {"readable": False, "codes": [], "kinds": list(KINDS), "feed": FEED}
        return {
            "readable": True,
            "codes": views,
            "kinds": list(KINDS),
            "plans": list(PLAN_ORDER),
            "feed": FEED,
            "limit": limit,
            "shown": len(views),
            "more": len(views) >= limit,
        }

    @router.get("/promo/redemptions")
    def redemptions_desk(
        code: str | None = Query(None, max_length=MAX_CODE),
        limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
        ctx: AdminContext = Depends(requires(CONSOLE_READ)),
    ) -> dict[str, Any]:
        """Who has taken a code, as a keyed handle, and what it granted them."""
        ctx.audit("promo.redemptions.read", resource_type="promo_codes", resource_id=code)
        store = get_store()
        code_id: str | None = None
        try:
            if code:
                found = store.by_code(normalise(code))
                if found is None:
                    return {"readable": True, "redemptions": [], "code": code.upper()}
                code_id = found.id
            rows = store.redemptions(code_id=code_id, limit=limit)
        except BadCode:
            return {"readable": True, "redemptions": [], "code": None}
        except StoreUnavailable:
            return {"readable": False, "redemptions": [], "code": code}
        return {
            "readable": True,
            "redemptions": [redemption_view(row) for row in rows],
            "code": code.upper() if code else None,
            "limit": limit,
            "shown": len(rows),
            "more": len(rows) >= limit,
        }

    @router.post("/promo/create")
    def create_code(
        body: CreateBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Mint one code. Owner only, stepped up, and the trail says what was minted."""
        built = _built(body, by=ctx.admin.subject_id)
        store = get_store()
        try:
            # A code that already exists is never quietly replaced: the one in the wild is the
            # one people were told about, and changing what it grants underneath them is how a
            # learner is given something different from what they were promised.
            if store.by_code(built.code) is not None:
                raise _bad(
                    "already_exists",
                    "There is already a code with that name. Disable it, or pick another name.",
                    status=409,
                )
            made = store.insert_code(built)
        except AlreadyRedeemed as exc:  # the unique index got there first
            raise _bad(
                "already_exists",
                "There is already a code with that name. Disable it, or pick another name.",
                status=409,
            ) from exc
        except StoreUnavailable as exc:
            raise _bad(
                "unavailable",
                "The codes could not be reached, so nothing was minted.",
                status=503,
            ) from exc
        ctx.audit(
            "promo.code.create",
            resource_type="promo_code",
            resource_id=made.code,
            detail={
                "kind": made.kind,
                "value": made.value,
                "days": made.days,
                "plan": made.plan,
                "max_uses": made.max_uses,
                "once_per_account": made.once_per_account,
                "expires_at": _iso(made.expires_at),
            },
        )
        return code_view(made, 0, now=datetime.now(UTC))

    @router.post("/promo/disable")
    def disable_code(
        body: DisableBody, ctx: AdminContext = Depends(requires(ADMIN_MANAGE))
    ) -> dict[str, Any]:
        """Switch one code off. It is never deleted: the redemptions point at it."""
        try:
            wanted = normalise(body.code)
        except BadCode as exc:
            raise _bad("not_a_code", "That is not the shape of a code.") from exc
        store = get_store()
        now = datetime.now(UTC)
        try:
            found = store.by_code(wanted)
            if found is None:
                raise _bad("unknown_code", "There is no code with that name.", status=404)
            off = store.disable(found.id, by=ctx.admin.subject_id, at=now)
            uses = store.uses(found.id)
        except StoreUnavailable as exc:
            raise _bad(
                "unavailable",
                "The codes could not be reached, so nothing was switched off.",
                status=503,
            ) from exc
        ctx.audit(
            "promo.code.disable",
            resource_type="promo_code",
            resource_id=wanted,
            detail={"kind": found.kind, "uses": uses},
        )
        return code_view(off or found, uses, now=now)

    app.include_router(router)


__all__ = [
    "KINDS",
    "LIMITED_PATHS",
    "REDEEM_PATH",
    "AlreadyRedeemed",
    "BadCode",
    "InMemoryPromoStore",
    "Offer",
    "PostgrestPromoStore",
    "PromoCode",
    "Redemption",
    "Refused",
    "StoreUnavailable",
    "UnconfiguredPromoStore",
    "allowance_boost_paise",
    "bind_checkout",
    "code_view",
    "get_store",
    "normalise",
    "offer_for_checkout",
    "redeem",
    "redemption_view",
    "register_promo",
    "register_promo_desk",
    "set_store",
]
