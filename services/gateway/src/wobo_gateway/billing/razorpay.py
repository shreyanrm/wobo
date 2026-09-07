"""The one place the gateway talks to Razorpay, and the one place it checks Razorpay's signature.

Three environment variables and nothing else: ``RAZORPAY_KEY_ID``, ``RAZORPAY_KEY_SECRET`` and
``RAZORPAY_WEBHOOK_SECRET``. No key is compiled in, no key is logged (only whether one is present),
and with any of the three missing :func:`configured` is False and every payment route answers
``503 payments_off`` rather than pretending. The owner supplies the keys later; until then this
module is built and tested against a fake and against the signature vector Razorpay's own SDK
ships with.

What the API contract is, and where it was read (2026-09-05, the current official pages):

* Authentication: every request is HTTP Basic with ``key_id:key_secret``
  (razorpay.com/docs/api/authentication/).
* Plans: ``POST /v1/plans`` with ``period`` (monthly | yearly ...), ``interval``, ``item.name``,
  ``item.amount`` in the currency's subunit (paise), ``item.currency`` and ``notes``; ids are
  ``plan_...``. ``GET /v1/plans?count=&skip=`` lists them, ``count`` at most 100
  (razorpay.com/docs/api/payments/subscriptions/create-plan/ and fetch-all-plans/).
* Subscriptions: ``POST /v1/subscriptions`` with ``plan_id``, ``total_count`` (mandatory: the
  number of billing cycles), ``customer_notify`` and ``notes``; the answer carries ``id``
  (``sub_...``), ``status``, ``current_start``, ``current_end`` and ``short_url``. Statuses are
  created | authenticated | active | pending | halted | cancelled | completed | expired, plus
  paused (razorpay.com/docs/api/payments/subscriptions/create-subscription/ and
  razorpay.com/docs/payments/subscriptions/states/).
* Fetch: ``GET /v1/subscriptions/{id}`` answers the same entity with its current ``status``
  (razorpay.com/docs/api/payments/subscriptions/fetch-subscription-id/, read 2026-09-07). The
  checkout asks this about a learner's open subscription before it would create a second.
* Cancel: ``POST /v1/subscriptions/{id}/cancel`` with ``cancel_at_cycle_end`` (boolean, default
  false): true ends it when the current cycle ends, which is the only way this product ever
  cancels (razorpay.com/docs/api/payments/subscriptions/cancel-subscription/). The states page
  says plainly "Once cancelled, a Subscription cannot be restarted", and the only revert endpoint
  (``/cancel_scheduled_changes``) is for scheduled plan UPDATES, not for a cancellation
  (razorpay.com/docs/api/payments/subscriptions/cancel-update/). So there is no un-cancel here,
  and the resume route says so.
* Webhooks: the signature rides in ``X-Razorpay-Signature`` and is "HMAC with SHA256 algorithm;
  with your webhook secret set as the key and the webhook request body as the message", hex
  encoded, over the RAW body, "Do not parse or cast the webhook request body". The event id is
  ``X-Razorpay-Event-Id``, "unique per event" (razorpay.com/docs/webhooks/validate-test/). The
  event names and when each fires are on
  razorpay.com/docs/payments/subscriptions/subscribe-to-webhooks/.

The transport is ``urllib`` from the standard library, the way every other outbound call in this
gateway is made (billing, parents, reports). No SDK: the five calls this product makes fit in
forty lines, and a dependency is a thing to patch.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

logger = logging.getLogger("wobo.gateway.billing.razorpay")

BASE_URL = "https://api.razorpay.com/v1"
KEY_ID_ENV = "RAZORPAY_KEY_ID"
KEY_SECRET_ENV = "RAZORPAY_KEY_SECRET"
WEBHOOK_SECRET_ENV = "RAZORPAY_WEBHOOK_SECRET"
SIGNATURE_HEADER = "x-razorpay-signature"
EVENT_ID_HEADER = "x-razorpay-event-id"
_HTTP_TIMEOUT_S = 10.0
#: The largest page ``GET /v1/plans`` serves.
PLAN_PAGE = 100


# --- the keys, by presence only ----------------------------------------------------------------
def _env(name: str) -> str | None:
    value = (os.getenv(name) or "").strip()
    return value or None


def key_id() -> str | None:
    """The public half of the key pair: it goes to the browser, so it is not a secret."""
    return _env(KEY_ID_ENV)


def keys_present() -> bool:
    return bool(key_id() and _env(KEY_SECRET_ENV))


def webhook_secret() -> str | None:
    return _env(WEBHOOK_SECRET_ENV)


def configured() -> bool:
    """All three, or payments are off. A checkout without a webhook secret would take money and
    never learn about it, so two out of three is off as well."""
    return keys_present() and bool(webhook_secret())


# --- the signature -----------------------------------------------------------------------------
def verify_webhook_signature(body: bytes, signature: str | None, secret: str) -> bool:
    """HMAC-SHA256 of the RAW body under the webhook secret, hex, compared in constant time.

    This is exactly what razorpay-python's ``Utility.verify_webhook_signature`` does
    (``hmac.new(key, msg, sha256).hexdigest()`` then ``hmac.compare_digest``), and it is proved
    here against that SDK's own test vector. The body is the bytes off the wire: a body that has
    been parsed and re-serialised is a different byte string with a different digest.
    """
    if not body or not signature or not secret:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(expected, signature.strip())
    except TypeError:  # a non-ASCII header value: not a hex digest, not a match
        return False


# --- the client --------------------------------------------------------------------------------
class RazorpayError(Exception):
    """The provider refused or could not be reached. ``status`` 0 means it was never reached."""

    def __init__(self, status: int, code: str, description: str) -> None:
        self.status = status
        self.code = code
        self.description = description
        super().__init__(f"{status} {code}: {description}")


class Provider(Protocol):
    """The five calls this product makes. A test's fake implements the same five."""

    def create_plan(self, body: dict[str, Any]) -> dict[str, Any]: ...

    def list_plans(self, *, count: int, skip: int) -> dict[str, Any]: ...

    def create_subscription(self, body: dict[str, Any]) -> dict[str, Any]: ...

    def cancel_subscription(self, subscription_id: str, body: dict[str, Any]) -> dict[str, Any]: ...

    def fetch_subscription(self, subscription_id: str) -> dict[str, Any]: ...


Request_ = Callable[..., Any]


def _request(url: str, method: str, headers: dict[str, str], data: bytes | None) -> str:
    """One HTTPS call. Split out so the client can be driven without a network."""
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        return response.read().decode() or ""


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, OSError, ValueError)
_ID_SAFE = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


class RazorpayClient:
    """Basic auth, JSON in, JSON out, and every failure as one :class:`RazorpayError`."""

    def __init__(self, key_id: str, key_secret: str, *, request: Request_ | None = None) -> None:
        if not key_id or not key_secret:
            raise ValueError("RazorpayClient needs a key id and a key secret")
        token = base64.b64encode(f"{key_id}:{key_secret}".encode()).decode()
        self._auth = f"Basic {token}"
        self._request = request or _request

    def _call(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{BASE_URL}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        headers = {
            "Authorization": self._auth,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        data = json.dumps(body).encode() if body is not None else None
        try:
            raw = self._request(url, method, headers, data)
        except urllib.error.HTTPError as exc:
            detail = _error_detail(exc)
            logger.warning(
                "razorpay refused a call",
                extra={"fields": {"method": method, "path": path, "status": exc.code, **detail}},
            )
            raise RazorpayError(exc.code, detail["code"], detail["description"]) from exc
        except _NETWORK_ERRORS as exc:
            logger.warning(
                "razorpay could not be reached",
                extra={"fields": {"method": method, "path": path, "error": type(exc).__name__}},
            )
            raise RazorpayError(0, "unreachable", str(exc)) from exc
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except ValueError as exc:
            raise RazorpayError(0, "bad_answer", "the provider's answer was not JSON") from exc
        return parsed if isinstance(parsed, dict) else {}

    def create_plan(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/plans", body=body)

    def list_plans(self, *, count: int = PLAN_PAGE, skip: int = 0) -> dict[str, Any]:
        return self._call("GET", "/plans", params={"count": min(count, PLAN_PAGE), "skip": skip})

    def create_subscription(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/subscriptions", body=body)

    @staticmethod
    def _path_id(subscription_id: str) -> str:
        # The id goes into a path, so it is checked before it does: a provider id is [A-Za-z0-9_].
        if not subscription_id or any(ch not in _ID_SAFE for ch in subscription_id):
            raise RazorpayError(0, "bad_id", "that is not a provider subscription id")
        return subscription_id

    def cancel_subscription(self, subscription_id: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._call(
            "POST", f"/subscriptions/{self._path_id(subscription_id)}/cancel", body=body
        )

    def fetch_subscription(self, subscription_id: str) -> dict[str, Any]:
        return self._call("GET", f"/subscriptions/{self._path_id(subscription_id)}")


#: The cancel page's own refusals for a subscription that will take nothing more whatever we do:
#: "Subscription is not cancellable in cancelled status", "... in expired status", and "The
#: subscription is in its final cycle and cannot be cancelled now" (a cycle-end cancel in the last
#: paid cycle, which completes by itself). Every other 400 ("another subscription operation is in
#: progress", a bad id) is a refusal to act, not a promise, and is never read as one.
_NOTHING_MORE = (
    "not cancellable in cancelled status",
    "not cancellable in expired status",
    "not cancellable in completed status",
    "in its final cycle",
)


def takes_nothing_more(exc: RazorpayError) -> bool:
    """Did the provider refuse a cancel because there is nothing left to cancel? Then the card is
    safe and the row may say cancelled with the period end exactly where it was."""
    if exc.status != 400:
        return False
    text = (exc.description or "").lower()
    return any(phrase in text for phrase in _NOTHING_MORE)


def _error_detail(exc: urllib.error.HTTPError) -> dict[str, str]:
    try:
        payload = json.loads(exc.read().decode() or "{}")
    except (ValueError, OSError):
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return {"code": "http_error", "description": f"HTTP {exc.code}"}
    return {
        "code": str(error.get("code") or "http_error"),
        "description": str(error.get("description") or f"HTTP {exc.code}"),
    }


# --- the seam ----------------------------------------------------------------------------------
_override: Provider | None = None
_lock = threading.Lock()


def set_client(provider: Provider | None) -> None:
    """Test seam: the object the gateway talks to instead of the network."""
    global _override
    with _lock:
        _override = provider


def get_client() -> Provider | None:
    """The provider, or ``None`` when the keys are not there. A test's fake still needs the keys
    present, so the no-key path is the same path production takes."""
    if not keys_present():
        return None
    with _lock:
        if _override is not None:
            return _override
    secret = _env(KEY_SECRET_ENV)
    return RazorpayClient(key_id() or "", secret or "")


# --- the last webhook, for /healthz -------------------------------------------------------------
# In-process on purpose: the health probe reads no database, so the ledger (records.py) is not
# the place it looks. A restart forgets it, which reads as "none since boot" and is true.
_last_webhook: datetime | None = None


def note_webhook(now: datetime | None = None) -> None:
    global _last_webhook
    with _lock:
        _last_webhook = (now or datetime.now(UTC)).astimezone(UTC)


def last_webhook() -> datetime | None:
    with _lock:
        return _last_webhook


def reset() -> None:
    """Test seam."""
    global _last_webhook
    with _lock:
        _last_webhook = None


__all__ = [
    "BASE_URL",
    "EVENT_ID_HEADER",
    "KEY_ID_ENV",
    "KEY_SECRET_ENV",
    "SIGNATURE_HEADER",
    "WEBHOOK_SECRET_ENV",
    "Provider",
    "RazorpayClient",
    "RazorpayError",
    "configured",
    "get_client",
    "key_id",
    "keys_present",
    "last_webhook",
    "note_webhook",
    "reset",
    "set_client",
    "takes_nothing_more",
    "verify_webhook_signature",
    "webhook_secret",
]
