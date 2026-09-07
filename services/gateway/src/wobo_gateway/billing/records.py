"""The billing ledger and the billing config: ``ops.billing_events`` and ``ops.billing_config``.

Two jobs, one store, because both are "what the gateway knows about money that is not the
subscription row itself":

1. **Once only.** Every provider webhook carries an event id, and this store answers "have I seen
   it" before the gateway acts on it. The unique constraint in migration 0023 is the other half of
   the same promise. A replayed activation after a cancel is therefore refused by a lookup and,
   should two processes race, by the database.
2. **The ledger the desk reads.** Every checkout, webhook and cancel is a row, so the console's
   subscriptions desk shows what actually happened rather than a count somebody derived.
3. **The open checkout.** A learner's newest ``checkout`` row names the provider subscription they
   were last offered; the checkout route asks the provider what became of it before it would
   create another (:func:`latest_checkout`). Two payable subscriptions for one learner is a
   second bill, and the row is how the gateway remembers the first.

The once-only key is the SHA-256 of the signed body (``sha256:<hex>``), not the provider's
``X-Razorpay-Event-Id`` header: the signature covers the body and nothing else, so a captured body
replayed under a fresh header is the same delivery and must be refused as one. Checkout rows are
``checkout:<sub_id>`` and cancels ``cancel:<sub_id>:<time>``; none of the three can collide.

And the config: the four provider plan ids the admin command created, under one key. Not a
secret, but a record, so it lives here (docs/MEMORY-LAW.md) and not in an environment variable.

Two stores behind one seam, as :mod:`wobo_gateway.billing` and :mod:`wobo_gateway.reports`: in
memory when asked for BY NAME (``SUBSCRIPTIONS_STORE=memory``, the same switch the subscription
row uses, because the two are one feature), PostgREST with the service-role key for the project,
and a store that REFUSES when neither is configured. A refusing ledger matters here more than
anywhere: without a place to write the event id there is no once-only, so the webhook answers 503
and the provider retries later, rather than the gateway applying an event it could not record.
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
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Protocol

logger = logging.getLogger("wobo.gateway.billing.records")

SCHEMA = "ops"
EVENTS_TABLE = "billing_events"
CONFIG_TABLE = "billing_config"
_HTTP_TIMEOUT_S = 5.0

KINDS: tuple[str, ...] = ("checkout", "webhook", "cancel")
#: An event id reaches a PostgREST filter, so it is checked before it is interpolated.
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
MAX_RECENT = 200


@dataclass(frozen=True)
class BillingEvent:
    """One row of ``ops.billing_events``."""

    event_id: str
    kind: str
    event: str
    learner_id: str | None = None
    subscription_id: str | None = None
    plan: str | None = None
    period: str | None = None
    status: str | None = None
    amount_paise: int | None = None
    received_at: datetime | None = None
    id: str = ""


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


def from_row(row: dict[str, Any]) -> BillingEvent:
    amount = row.get("amount_paise")
    return BillingEvent(
        id=str(row.get("id") or ""),
        event_id=str(row.get("event_id") or ""),
        kind=str(row.get("kind") or "webhook"),
        event=str(row.get("event") or ""),
        learner_id=str(row["learner_id"]) if row.get("learner_id") else None,
        subscription_id=str(row["subscription_id"]) if row.get("subscription_id") else None,
        plan=str(row["plan"]) if row.get("plan") else None,
        period=str(row["period"]) if row.get("period") else None,
        status=str(row["status"]) if row.get("status") else None,
        amount_paise=int(amount)
        if isinstance(amount, int | float | str) and str(amount).lstrip("-").isdigit()
        else None,
        received_at=_when(row.get("received_at")),
    )


def to_row(event: BillingEvent) -> dict[str, Any]:
    row: dict[str, Any] = {
        "event_id": event.event_id,
        "kind": event.kind,
        "event": event.event,
        "learner_id": event.learner_id,
        "subscription_id": event.subscription_id,
        "plan": event.plan,
        "period": event.period,
        "status": event.status,
        "amount_paise": event.amount_paise,
    }
    if event.received_at is not None:
        row["received_at"] = _iso(event.received_at)
    return row


# --- the seam ------------------------------------------------------------------------------------
class RecordsUnavailable(Exception):
    """The ledger could not be reached. Callers refuse rather than act unrecorded."""


class BillingRecords(Protocol):
    def seen(self, event_id: str) -> bool: ...

    def record(self, event: BillingEvent) -> bool: ...

    def recent(self, limit: int = 50) -> list[BillingEvent]: ...

    def latest_checkout(self, learner_id: str) -> BillingEvent | None: ...

    def get_config(self, key: str) -> dict[str, Any] | None: ...

    def set_config(self, key: str, value: dict[str, Any]) -> None: ...


class InMemoryBillingRecords:
    """The suite's ledger, and a local run without a project."""

    def __init__(self) -> None:
        self.events: list[BillingEvent] = []
        self.config: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def seen(self, event_id: str) -> bool:
        with self._lock:
            return any(e.event_id == event_id for e in self.events)

    def record(self, event: BillingEvent) -> bool:
        with self._lock:
            if any(e.event_id == event.event_id for e in self.events):
                return False
            stamped = replace(
                event,
                id=f"evt-{len(self.events) + 1}",
                received_at=event.received_at or datetime.now(UTC),
            )
            self.events.append(stamped)
            return True

    def recent(self, limit: int = 50) -> list[BillingEvent]:
        with self._lock:
            return list(reversed(self.events))[: max(1, min(limit, MAX_RECENT))]

    def latest_checkout(self, learner_id: str) -> BillingEvent | None:
        with self._lock:
            for event in reversed(self.events):
                if event.kind == "checkout" and event.learner_id == learner_id:
                    return event
            return None

    def get_config(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            found = self.config.get(key)
            return dict(found) if found is not None else None

    def set_config(self, key: str, value: dict[str, Any]) -> None:
        with self._lock:
            self.config[key] = dict(value)


class UnconfiguredBillingRecords:
    """No project, and no permission to pretend there is one (see the module header)."""

    def _refuse(self) -> RecordsUnavailable:
        return RecordsUnavailable("no billing ledger is configured")

    def seen(self, event_id: str) -> bool:
        raise self._refuse()

    def record(self, event: BillingEvent) -> bool:
        raise self._refuse()

    def recent(self, limit: int = 50) -> list[BillingEvent]:
        raise self._refuse()

    def latest_checkout(self, learner_id: str) -> BillingEvent | None:
        raise self._refuse()

    def get_config(self, key: str) -> dict[str, Any] | None:
        raise self._refuse()

    def set_config(self, key: str, value: dict[str, Any]) -> None:
        raise self._refuse()


Request_ = Callable[..., Any]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call, the shape ``billing._request`` and ``reports._request`` share."""
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
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


class PostgrestBillingRecords:
    """``ops.billing_events`` and ``ops.billing_config`` over PostgREST with the service role."""

    def __init__(self, base_url: str, service_key: str, *, request: Request_ | None = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestBillingRecords needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, table: str, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{table}?{encoded}"

    def _call(self, method: str, table: str, params: dict[str, str], *, body: Any = None) -> Any:
        try:
            return self._request(
                self._url(table, params), self._key, method, body=body, want_rows=True
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                raise  # the caller decides what a conflict means
            logger.warning(
                "billing ledger: store call refused",
                extra={"fields": {"method": method, "table": table, "status": exc.code}},
            )
            raise RecordsUnavailable(f"HTTP {exc.code}") from exc
        except _NETWORK_ERRORS as exc:
            logger.warning(
                "billing ledger: store call failed",
                extra={"fields": {"method": method, "table": table, "error": str(exc)}},
            )
            raise RecordsUnavailable(str(exc)) from exc

    @staticmethod
    def _checked(value: str) -> str:
        if not _ID_RE.match(value or ""):
            raise RecordsUnavailable("that is not an id I can look up")
        return value

    def seen(self, event_id: str) -> bool:
        rows = self._call(
            "GET",
            EVENTS_TABLE,
            {"select": "event_id", "event_id": f"eq.{self._checked(event_id)}", "limit": "1"},
        )
        return bool(rows) if isinstance(rows, list) else False

    def record(self, event: BillingEvent) -> bool:
        self._checked(event.event_id)
        try:
            self._call("POST", EVENTS_TABLE, {"select": "id"}, body=[to_row(event)])
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                return False  # the unique constraint: already recorded
            raise RecordsUnavailable(f"HTTP {exc.code}") from exc
        return True

    def recent(self, limit: int = 50) -> list[BillingEvent]:
        rows = self._call(
            "GET",
            EVENTS_TABLE,
            {
                "select": "*",
                "order": "received_at.desc",
                "limit": str(max(1, min(limit, MAX_RECENT))),
            },
        )
        return [from_row(r) for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []

    def latest_checkout(self, learner_id: str) -> BillingEvent | None:
        """The newest ``checkout`` row for one learner: the provider subscription the checkout
        route offers again rather than creating a second one (``payments.py``)."""
        rows = self._call(
            "GET",
            EVENTS_TABLE,
            {
                "select": "*",
                "learner_id": f"eq.{self._checked(learner_id)}",
                "kind": "eq.checkout",
                "order": "received_at.desc",
                "limit": "1",
            },
        )
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            return None
        return from_row(rows[0])

    def get_config(self, key: str) -> dict[str, Any] | None:
        rows = self._call(
            "GET",
            CONFIG_TABLE,
            {"select": "key,value", "key": f"eq.{self._checked(key)}", "limit": "1"},
        )
        if not isinstance(rows, list) or not rows:
            return None
        value = rows[0].get("value") if isinstance(rows[0], dict) else None
        return dict(value) if isinstance(value, dict) else None

    def set_config(self, key: str, value: dict[str, Any]) -> None:
        self._checked(key)
        updated = self._call(
            "PATCH",
            CONFIG_TABLE,
            {"key": f"eq.{key}", "select": "key"},
            body={"value": value, "updated_at": _iso(datetime.now(UTC))},
        )
        if isinstance(updated, list) and updated:
            return
        try:
            self._call("POST", CONFIG_TABLE, {"select": "key"}, body=[{"key": key, "value": value}])
        except urllib.error.HTTPError as exc:
            if exc.code != 409:
                raise RecordsUnavailable(f"HTTP {exc.code}") from exc
            # Lost a race with another writer of the same key: theirs stands, and a second PATCH
            # would only fight over ids that are the same four objects at the provider.
            logger.info(
                "billing config: key written by another process", extra={"fields": {"key": key}}
            )


_store: BillingRecords | None = None
_store_lock = threading.Lock()


def build_store() -> BillingRecords:
    """The project ledger when configured, the memory one when asked for BY NAME, otherwise a
    ledger that refuses (see the module header for why refusing is the honest third)."""
    if (os.getenv("SUBSCRIPTIONS_STORE") or "").strip().lower() == "memory":
        return InMemoryBillingRecords()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestBillingRecords(base, key)
    logger.error(
        "billing ledger: no project configured; checkout and the webhook will answer 503. Set "
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or SUBSCRIPTIONS_STORE=memory on purpose."
    )
    return UnconfiguredBillingRecords()


def get_store() -> BillingRecords:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: BillingRecords | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store


__all__ = [
    "KINDS",
    "BillingEvent",
    "BillingRecords",
    "InMemoryBillingRecords",
    "PostgrestBillingRecords",
    "RecordsUnavailable",
    "UnconfiguredBillingRecords",
    "build_store",
    "from_row",
    "get_store",
    "set_store",
    "to_row",
]
