"""Razorpay subscriptions on the gateway, with no live key and no money moving.

Everything here fails without ``wobo_gateway/billing/razorpay.py``, ``plans.py``, ``records.py``,
``payments.py``, migration 0023 and the changes to ``billing/__init__.py`` and ``health.py``. The
provider is a fake that records every call; the one thing borrowed from Razorpay itself is the
webhook signature vector its own Python SDK ships with (``tests/fixtures``), so the HMAC is proved
against a body and a digest Razorpay wrote rather than one this suite invented.

The failures these are shaped around, in the brief's own order:

* a plan whose amount drifts from ``docs/PRICING.md`` by a paisa;
* a checkout that flips a learner's plan before any money has been taken;
* a webhook accepted on a wrong or missing signature, or one processed twice;
* a charge failure treated as an ending rather than as a state;
* a cancel that says "cancelled" without telling the provider to stop charging, or that moves the
  period end;
* a gateway with no keys pretending it can sell or end a plan.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, TEST_SUBJECT, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, billing, health
from wobo_gateway import app as app_mod
from wobo_gateway.admin_auth import ADMIN_PREFIX, VIEWER, InMemoryAdminStore
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.billing import (
    InMemorySubscriptionStore,
    Subscription,
    payments,
    plans,
    razorpay,
    records,
)
from wobo_gateway.billing.records import InMemoryBillingRecords
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

REPO = Path(__file__).resolve().parents[3]
PRICING = REPO / "docs/PRICING.md"
VECTOR = Path(__file__).parent / "fixtures/razorpay_webhook_vector.json"
#: The secret and digest from razorpay-python's own suite (tests/helpers.py builds the client with
#: ``auth=('key_id', 'key_secret')``; tests/test_client_utility.py::test_verify_webhook_signature
#: expects this hex for the body in ``mocks/fake_payment_authorized_webhook.json``).
VECTOR_SECRET = "key_secret"
VECTOR_SIGNATURE = "d60e67fd884556c045e9be7dad57903e33efc7172c17c6e3ef77db42d2b366e9"

CHECKOUT = "/v1/billing/checkout"
WEBHOOK = "/v1/billing/razorpay/webhook"
PLAN = "/v1/me/subscription"
CANCEL = "/v1/me/subscription/cancel"
RESUME = "/v1/me/subscription/resume"
ME = "/v1/me"

WEBHOOK_SECRET = "a-webhook-secret-for-the-suite"
DAY = timedelta(days=1)
NOW = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)


# --- the fake provider ----------------------------------------------------------------------------
class FakeRazorpay:
    """Every call the gateway makes, recorded, and nothing on the wire."""

    def __init__(self) -> None:
        self.plans: list[dict[str, Any]] = []
        self.subscriptions: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_next: Exception | None = None
        self.status_of: dict[str, str] = {}
        self._n = 0

    def _next(self, prefix: str) -> str:
        self._n += 1
        return f"{prefix}_{self._n:014d}"

    def _maybe_fail(self) -> None:
        if self.fail_next is not None:
            exc, self.fail_next = self.fail_next, None
            raise exc

    def create_plan(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("create_plan", body))
        self._maybe_fail()
        created = {"id": self._next("plan"), "entity": "plan", **body}
        self.plans.append(created)
        return created

    def list_plans(self, *, count: int, skip: int) -> dict[str, Any]:
        self.calls.append(("list_plans", {"count": count, "skip": skip}))
        page = self.plans[skip : skip + count]
        return {"entity": "collection", "count": len(page), "items": page}

    def create_subscription(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("create_subscription", body))
        self._maybe_fail()
        created = {
            "id": self._next("sub"),
            "entity": "subscription",
            "status": "created",
            "current_start": None,
            "current_end": None,
            "short_url": "https://rzp.io/rzp/fake",
            **body,
        }
        self.subscriptions.append(created)
        return created

    def cancel_subscription(self, subscription_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("cancel_subscription", {"id": subscription_id, **body}))
        self._maybe_fail()
        return {"id": subscription_id, "entity": "subscription", "status": "active"}

    def fetch_subscription(self, subscription_id: str) -> dict[str, Any]:
        """``GET /v1/subscriptions/{id}``: what the provider says the subscription is now. A test
        moves one along with ``status_of``; unset, it is whatever it was created as."""
        self.calls.append(("fetch_subscription", {"id": subscription_id}))
        self._maybe_fail()
        for sub in self.subscriptions:
            if sub["id"] == subscription_id:
                return {**sub, "status": self.status_of.get(subscription_id, sub["status"])}
        raise razorpay.RazorpayError(400, "BAD_REQUEST_ERROR", "The id provided does not exist")


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> FakeRazorpay:
    """Keys present (test-shaped, never live) and the fake behind them."""
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_notarealkey")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "not-a-real-secret")
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    fake = FakeRazorpay()
    razorpay.set_client(fake)
    yield fake
    razorpay.set_client(None)


@pytest.fixture
def store() -> InMemorySubscriptionStore:
    fresh = InMemorySubscriptionStore()
    billing.set_store(fresh)
    yield fresh
    billing.set_store(None)


@pytest.fixture
def ledger() -> InMemoryBillingRecords:
    fresh = InMemoryBillingRecords()
    records.set_store(fresh)
    yield fresh
    records.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def with_plans(ledger: InMemoryBillingRecords) -> dict[str, str]:
    ids = {key: f"plan_{key}" for key in plans.CATALOGUE}
    ledger.set_config(plans.CONFIG_KEY, ids)
    return ids


def sign(body: bytes, secret: str = WEBHOOK_SECRET) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def event(
    name: str,
    *,
    learner: str = TEST_SUBJECT,
    sub_id: str = "sub_00000000000001",
    plan: str = "pro",
    period: str = "monthly",
    status: str = "active",
    current_end: datetime | None = NOW + 30 * DAY,
    amount: int | None = None,
    notes: dict[str, str] | None = None,
) -> dict[str, Any]:
    entity: dict[str, Any] = {
        "id": sub_id,
        "entity": "subscription",
        "plan_id": f"plan_{plan}_{period}",
        "status": status,
        "current_start": int((NOW - DAY).timestamp()),
        "current_end": int(current_end.timestamp()) if current_end else None,
        "paid_count": 1,
        "notes": notes
        if notes is not None
        else {"wobo_learner_id": learner, "wobo_plan": plan, "wobo_period": period},
    }
    payload: dict[str, Any] = {"subscription": {"entity": entity}}
    contains = ["subscription"]
    if amount is not None:
        payload["payment"] = {"entity": {"id": "pay_1", "amount": amount, "currency": "INR"}}
        contains.append("payment")
    return {
        "entity": "event",
        "account_id": "acc_fake",
        "event": name,
        "contains": contains,
        "payload": payload,
        "created_at": int(NOW.timestamp()),
    }


def deliver(
    client: TestClient,
    data: dict[str, Any],
    *,
    event_id: str | None = None,
    signature: str | None = "sign",
) -> Any:
    body = json.dumps(data).encode()
    headers = {"Content-Type": "application/json"}
    if signature == "sign":
        headers["X-Razorpay-Signature"] = sign(body)
    elif signature is not None:
        headers["X-Razorpay-Signature"] = signature
    headers["X-Razorpay-Event-Id"] = event_id or f"evt_{uuid.uuid4().hex[:12]}"
    return client.post(WEBHOOK, content=body, headers=headers)


def bearer(subject: str = TEST_SUBJECT) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


# --- a) the plans, to the paisa -------------------------------------------------------------------
def _pricing_table() -> dict[tuple[str, str], int]:
    """The 'Billed' column of docs/PRICING.md, in paise. Parsed, never retyped."""
    rows: dict[tuple[str, str], int] = {}
    for line in PRICING.read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] not in {"Pro", "Max"}:
            continue
        plan, period, billed = cells[0].lower(), cells[1].lower(), cells[3]
        match = re.match(r"₹([\d,]+)\s+(monthly|annually)", billed)
        assert match, billed
        rows[(plan, period)] = int(match.group(1).replace(",", "")) * 100
    return rows


def test_the_four_plans_match_pricing_md_to_the_paisa() -> None:
    table = _pricing_table()
    assert set(table) == {
        ("pro", "monthly"),
        ("pro", "yearly"),
        ("max", "monthly"),
        ("max", "yearly"),
    }
    for (plan, period), paise in table.items():
        spec = plans.CATALOGUE[f"{plan}_{period}"]
        assert spec.amount_paise == paise, (plan, period, spec.amount_paise, paise)
        assert spec.currency == "INR"
    # A year costs ten months, and the yearly plan is billed once a year.
    for plan in ("pro", "max"):
        yearly, monthly = plans.CATALOGUE[f"{plan}_yearly"], plans.CATALOGUE[f"{plan}_monthly"]
        assert yearly.period == "yearly" and monthly.period == "monthly"
        assert yearly.interval == monthly.interval == 1
        # Ten months to within the rounding PRICING.md itself allows (1,666 x 12 = 19,992).
        assert abs(yearly.amount_paise - 10 * monthly.amount_paise) < monthly.amount_paise


def test_the_amount_a_learner_is_shown_is_the_total_they_are_agreeing_to() -> None:
    """PRICING.md: the annual total appears at checkout and only there."""
    assert plans.amount_display("pro", "yearly") == "₹19,992 billed annually"
    assert plans.amount_display("max", "monthly") == "₹3,999 billed monthly"


def test_the_plans_command_creates_four_once_and_then_reuses_them(
    provider: FakeRazorpay, ledger: InMemoryBillingRecords, capsys: pytest.CaptureFixture[str]
) -> None:
    first = plans.ensure_plans(provider, ledger)
    assert set(first) == set(plans.CATALOGUE)
    created = [body for name, body in provider.calls if name == "create_plan"]
    assert len(created) == 4
    for body in created:
        spec = plans.CATALOGUE[body["notes"]["wobo_key"]]
        assert body["item"]["amount"] == spec.amount_paise
        assert body["item"]["currency"] == "INR"
        assert body["period"] == spec.period and body["interval"] == 1
    assert ledger.get_config(plans.CONFIG_KEY) == first

    again = plans.ensure_plans(provider, ledger)
    assert again == first
    assert len([1 for name, _ in provider.calls if name == "create_plan"]) == 4  # no fifth

    plans.main(["--dry-run"])
    out = capsys.readouterr().out
    assert "not-a-real-secret" not in out
    assert "1999200" in out or "19,992" in out


def test_the_command_refuses_without_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"):
        monkeypatch.delenv(key, raising=False)
    assert plans.main([]) != 0


# --- b) checkout ----------------------------------------------------------------------------------
def test_checkout_creates_a_subscription_with_the_learner_in_the_notes(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    ids = with_plans(ledger)
    res = client.post(CHECKOUT, json={"plan": "pro", "period": "yearly"}, headers=bearer())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["subscription_id"].startswith("sub_")
    assert body["key_id"] == "rzp_test_notarealkey"
    assert body["plan"] == "pro" and body["period"] == "yearly"
    assert body["amount_display"] == "₹19,992 billed annually"
    assert body["amount_paise"] == 1_999_200
    assert "not-a-real-secret" not in res.text

    sent = next(b for n, b in provider.calls if n == "create_subscription")
    assert sent["plan_id"] == ids["pro_yearly"]
    assert sent["notes"]["wobo_learner_id"] == TEST_SUBJECT
    assert sent["notes"]["wobo_plan"] == "pro" and sent["notes"]["wobo_period"] == "yearly"
    assert sent["total_count"] >= 1

    # Nothing flips on checkout: no money has moved.
    assert store.get(TEST_SUBJECT) is None
    assert client.get(ME, headers=bearer()).json()["plan"] == "free"
    # ...but the ledger has the attempt.
    kinds = [e.kind for e in ledger.recent(10)]
    assert kinds == ["checkout"]


def test_checkout_is_behind_the_door_and_refuses_anonymous(
    client: TestClient, provider: FakeRazorpay, ledger: InMemoryBillingRecords
) -> None:
    with_plans(ledger)
    assert client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}).status_code == 401
    anon = {"Authorization": f"Bearer {mint('anon-device', anonymous=True)}"}
    res = client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=anon)
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "sign_in_required"
    assert not [1 for n, _ in provider.calls if n == "create_subscription"]


def test_checkout_refuses_a_plan_or_period_it_does_not_sell(
    client: TestClient, provider: FakeRazorpay, ledger: InMemoryBillingRecords
) -> None:
    with_plans(ledger)
    for body in ({"plan": "free", "period": "monthly"}, {"plan": "pro", "period": "weekly"}):
        res = client.post(CHECKOUT, json=body, headers=bearer())
        assert res.status_code in (400, 422), res.text
    assert not [1 for n, _ in provider.calls if n == "create_subscription"]


def test_a_learner_already_on_a_paid_plan_gets_the_honest_line(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    with_plans(ledger)
    store.insert(
        Subscription(
            id="sub-row",
            learner_id=TEST_SUBJECT,
            plan="pro",
            status="active",
            origin="web",
            current_period_end=datetime.now(UTC) + 10 * DAY,
            started_at=datetime.now(UTC) - DAY,
        )
    )
    res = client.post(CHECKOUT, json={"plan": "max", "period": "monthly"}, headers=bearer())
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "already_subscribed"
    assert "already on a paid plan" in detail["message"]
    assert not [1 for n, _ in provider.calls if n == "create_subscription"]


def test_checkout_with_no_keys_answers_payments_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, ledger: InMemoryBillingRecords
) -> None:
    for key in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"):
        monkeypatch.delenv(key, raising=False)
    with_plans(ledger)
    res = client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=bearer())
    assert res.status_code == 503
    detail = res.json()["detail"]
    assert detail["code"] == "payments_off"
    assert "free plan" in detail["message"].lower()
    assert "—" not in detail["message"]


def test_checkout_with_keys_but_no_plans_created_yet_is_payments_off_too(
    client: TestClient, provider: FakeRazorpay, ledger: InMemoryBillingRecords
) -> None:
    res = client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=bearer())
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "payments_off"
    assert not [1 for n, _ in provider.calls if n == "create_subscription"]


def test_a_provider_that_cannot_be_reached_charges_nothing_and_says_so(
    client: TestClient, provider: FakeRazorpay, ledger: InMemoryBillingRecords
) -> None:
    with_plans(ledger)
    provider.fail_next = razorpay.RazorpayError(502, "gateway", "upstream")
    res = client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=bearer())
    assert res.status_code == 503
    detail = res.json()["detail"]
    assert detail["code"] == "provider_unavailable"
    assert "nothing has been charged" in detail["message"].lower()
    assert ledger.recent(10) == []


# --- c) the webhook -------------------------------------------------------------------------------
def test_the_signature_is_verified_against_razorpays_own_vector() -> None:
    body = VECTOR.read_bytes()
    assert razorpay.verify_webhook_signature(body, VECTOR_SIGNATURE, VECTOR_SECRET)
    assert not razorpay.verify_webhook_signature(body, VECTOR_SIGNATURE, "another-secret")
    assert not razorpay.verify_webhook_signature(body + b" ", VECTOR_SIGNATURE, VECTOR_SECRET)
    assert not razorpay.verify_webhook_signature(body, None, VECTOR_SECRET)
    assert not razorpay.verify_webhook_signature(body, "", VECTOR_SECRET)
    assert not razorpay.verify_webhook_signature(body, VECTOR_SIGNATURE.upper(), VECTOR_SECRET)


def test_a_wrong_or_missing_signature_is_refused_before_the_body_is_parsed(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    caplog: pytest.LogCaptureFixture,
) -> None:
    good = event("subscription.activated")
    # Wrong signature over a valid body.
    res = deliver(client, good, signature="0" * 64)
    assert res.status_code == 400 and res.json()["code"] == "bad_signature"
    # Missing signature.
    res = deliver(client, good, signature=None)
    assert res.status_code == 400 and res.json()["code"] == "bad_signature"
    # A body that is not even JSON, wrongly signed: refused for the signature, never parsed.
    res = client.post(WEBHOOK, content=b"{not json", headers={"X-Razorpay-Signature": "f" * 64})
    assert res.status_code == 400 and res.json()["code"] == "bad_signature"
    assert store.get(TEST_SUBJECT) is None
    assert ledger.recent(10) == []
    assert any("signature" in r.getMessage().lower() for r in caplog.records)


def test_a_webhook_with_no_secret_configured_is_not_processed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    monkeypatch.delenv("RAZORPAY_WEBHOOK_SECRET", raising=False)
    res = deliver(client, event("subscription.activated"))
    assert res.status_code == 503
    assert res.json()["code"] == "payments_off"
    assert store.get(TEST_SUBJECT) is None


def test_a_replayed_event_is_processed_once(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    body = event("subscription.activated")
    first = deliver(client, body, event_id="evt_same")
    assert first.status_code == 200 and first.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row is not None and row.plan == "pro"

    # The provider's own retry: the same bytes under the same header.
    again = deliver(client, body, event_id="evt_same")
    assert again.status_code == 200 and again.json()["outcome"] == "already_processed"
    assert len([e for e in ledger.recent(10) if e.kind == "webhook"]) == 1

    # A DIFFERENT event under a header somebody reused is a different event: the header is not
    # covered by the signature, so it is not the identity of a delivery. The body is.
    other = deliver(
        client, event("subscription.cancelled", status="cancelled"), event_id="evt_same"
    )
    assert other.status_code == 200 and other.json()["outcome"] == "applied"
    assert store.get(TEST_SUBJECT).status == "cancelled"


def test_the_plan_flips_on_activated_and_charged_and_on_nothing_earlier(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    with_plans(ledger)
    client.post(CHECKOUT, json={"plan": "max", "period": "yearly"}, headers=bearer())
    assert client.get(ME, headers=bearer()).json()["plan"] == "free"

    res = deliver(client, event("subscription.authenticated", plan="max", period="yearly"))
    assert res.status_code == 200
    assert store.get(TEST_SUBJECT) is None  # authenticated is a promise, not a payment
    assert client.get(ME, headers=bearer()).json()["plan"] == "free"

    ends = NOW + 365 * DAY
    res = deliver(
        client,
        event("subscription.activated", plan="max", period="yearly", current_end=ends),
    )
    assert res.status_code == 200 and res.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row is not None
    assert row.plan == "max" and row.period == "yearly" and row.status == "active"
    assert row.current_period_end == ends
    assert row.razorpay_subscription_id == "sub_00000000000001"
    assert row.origin == "web"
    billing.reset_cache()
    assert client.get(ME, headers=bearer()).json()["plan"] == "max"

    # The next charge moves the period end forward and nothing else.
    later = ends + 365 * DAY
    deliver(
        client,
        event(
            "subscription.charged", plan="max", period="yearly", current_end=later, amount=3999600
        ),
    )
    row = store.get(TEST_SUBJECT)
    assert row.current_period_end == later and row.status == "active"
    charged = [e for e in ledger.recent(10) if e.event == "subscription.charged"]
    assert charged and charged[0].amount_paise == 3999600


@pytest.mark.parametrize(
    ("name", "provider_status", "status"),
    [
        ("subscription.pending", "pending", "active"),
        ("subscription.halted", "halted", "active"),
        ("subscription.paused", "paused", "active"),
        ("subscription.resumed", "active", "active"),
        ("subscription.completed", "completed", "active"),
        ("subscription.cancelled", "cancelled", "cancelled"),
    ],
)
def test_each_event_lands_on_the_right_row_state(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    name: str,
    provider_status: str,
    status: str,
) -> None:
    ends = NOW + 20 * DAY
    deliver(client, event("subscription.activated", current_end=ends))
    res = deliver(client, event(name, status=provider_status))
    assert res.status_code == 200 and res.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row is not None
    assert row.provider_status == provider_status
    assert row.status == status
    # Whatever happened at the provider, the period already paid for is never shortened.
    assert row.current_period_end == ends
    assert (row.cancelled_at is not None) == (status == "cancelled")


def test_a_charge_failure_is_a_state_not_a_refund(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    ends = datetime.now(UTC) + 20 * DAY
    deliver(client, event("subscription.activated", current_end=ends))
    deliver(client, event("subscription.halted", status="halted"))
    billing.reset_cache()
    # Still paid for, so still metered as paid.
    assert client.get(ME, headers=bearer()).json()["plan"] == "pro"
    view = client.get(PLAN, headers=bearer()).json()
    assert view["status"] == "active"
    assert view["payment_state"] == "halted"
    assert "did not go through" in view["line"]
    assert "refund" not in view["line"].lower()


def test_an_event_for_a_subscription_we_do_not_know_is_recorded_and_ignored(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    res = deliver(client, event("subscription.activated", notes={}))
    assert res.status_code == 200 and res.json()["outcome"] == "unmatched"
    assert store.rows == {}
    assert [e.status for e in ledger.recent(10)] == ["unmatched"]
    # An event we have no mapping for is recorded too, and nothing moves.
    res = deliver(client, event("payment.captured"))
    assert res.status_code == 200 and res.json()["outcome"] == "ignored"


def test_a_learner_id_in_the_notes_that_could_carry_a_filter_never_reaches_a_store(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    res = deliver(client, event("subscription.activated", learner="x&plan=eq.max"))
    assert res.status_code == 200 and res.json()["outcome"] == "unmatched"
    assert store.rows == {}


def test_the_webhook_is_open_to_the_provider_and_nowhere_near_the_console() -> None:
    assert WEBHOOK in app_mod._OPEN_PATHS
    assert not WEBHOOK.startswith(ADMIN_PREFIX)
    assert CHECKOUT in payments.LIMITED_PATHS
    assert payments.LIMITED_PATHS <= app_mod.PAYMENTS_LIMITED_PATHS


# --- d) cancel, never refund ----------------------------------------------------------------------
def test_cancel_tells_razorpay_to_stop_at_cycle_end_and_keeps_the_plan_to_period_end(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    # The provider speaks in whole unix seconds, so the period end is one.
    ends = (datetime.now(UTC) + 20 * DAY).replace(microsecond=0)
    deliver(client, event("subscription.activated", current_end=ends))

    res = client.post(CANCEL, headers=bearer())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "cancelling" and body["cancelled"] is True
    assert body["period_end"] == ends.isoformat()
    assert body["effective_plan"] == "pro"

    sent = next(b for n, b in provider.calls if n == "cancel_subscription")
    assert sent["id"] == "sub_00000000000001"
    assert sent["cancel_at_cycle_end"] in (True, 1)
    row = store.get(TEST_SUBJECT)
    assert row.status == "cancelled" and row.current_period_end == ends
    assert [e.kind for e in ledger.recent(10)][0] == "cancel"

    # Razorpay's own cancelled event arrives later and moves nothing it should not.
    deliver(client, event("subscription.cancelled", status="cancelled", current_end=ends))
    row = store.get(TEST_SUBJECT)
    assert row.status == "cancelled" and row.current_period_end == ends
    # Cancelling again does not ask the provider twice.
    client.post(CANCEL, headers=bearer())
    assert len([1 for n, _ in provider.calls if n == "cancel_subscription"]) == 1


def test_a_cancel_the_provider_did_not_take_leaves_the_plan_unchanged(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    deliver(client, event("subscription.activated", current_end=datetime.now(UTC) + 20 * DAY))
    provider.fail_next = razorpay.RazorpayError(500, "server_error", "down")
    res = client.post(CANCEL, headers=bearer())
    assert res.status_code == 503
    assert "nothing has changed" in res.json()["detail"]["message"].lower()
    assert store.get(TEST_SUBJECT).status == "active"


@pytest.mark.parametrize(
    "description",
    [
        "Subscription is not cancellable in cancelled status.",
        "Subscription is not cancellable in expired status.",
        "The subscription is in its final cycle and cannot be cancelled now.",
    ],
)
def test_a_cancel_the_provider_calls_pointless_still_ends_the_plan_here(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    description: str,
) -> None:
    """The cancel page's own refusals for a subscription that will take nothing more: already
    cancelled or expired at the provider, or in its final paid cycle. The card is safe, so the row
    says cancelled, the period end stays, and the learner is not trapped behind a 503."""
    ends = (datetime.now(UTC) + 20 * DAY).replace(microsecond=0)
    deliver(client, event("subscription.activated", current_end=ends))
    provider.fail_next = razorpay.RazorpayError(400, "BAD_REQUEST_ERROR", description)
    res = client.post(CANCEL, headers=bearer())
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelling" and res.json()["period_end"] == ends.isoformat()
    row = store.get(TEST_SUBJECT)
    assert row.status == "cancelled" and row.current_period_end == ends
    assert [e.kind for e in ledger.recent(10)][0] == "cancel"


def test_a_cancel_the_provider_refuses_for_another_reason_changes_nothing_and_names_the_mailbox(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """'Another subscription operation is in progress' is a refusal to act, not a promise that
    nothing more will be taken. So the row stays active and the line says so, with the mailbox."""
    deliver(client, event("subscription.activated", current_end=datetime.now(UTC) + 20 * DAY))
    provider.fail_next = razorpay.RazorpayError(
        400,
        "BAD_REQUEST_ERROR",
        "Request failed because another subscription operation is in progress.",
    )
    res = client.post(CANCEL, headers=bearer())
    assert res.status_code == 503
    detail = res.json()["detail"]
    assert detail["code"] == "provider_unavailable"
    assert "nothing has changed" in detail["message"].lower()
    assert billing.SUPPORT in detail["message"]
    assert "—" not in detail["message"]
    assert store.get(TEST_SUBJECT).status == "active"
    assert not [e for e in ledger.recent(10) if e.kind == "cancel"]


def test_a_cancel_with_payments_off_refuses_rather_than_lying(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """A row the provider is charging cannot be ended here without the provider; saying
    'cancelled' while the card keeps being charged is the one thing this module must never do."""
    for key in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"):
        monkeypatch.delenv(key, raising=False)
    store.insert(
        Subscription(
            id="row",
            learner_id=TEST_SUBJECT,
            plan="pro",
            status="active",
            origin="web",
            current_period_end=datetime.now(UTC) + 10 * DAY,
            started_at=datetime.now(UTC) - DAY,
            razorpay_subscription_id="sub_live",
        )
    )
    res = client.post(CANCEL, headers=bearer())
    assert res.status_code == 503
    detail = res.json()["detail"]
    assert detail["code"] == "payments_off"
    assert billing.SUPPORT in detail["message"]
    assert store.get(TEST_SUBJECT).status == "active"


def test_a_row_with_no_provider_behind_it_still_cancels_as_before(
    client: TestClient, store: InMemorySubscriptionStore, ledger: InMemoryBillingRecords
) -> None:
    store.insert(
        Subscription(
            id="row",
            learner_id=TEST_SUBJECT,
            plan="pro",
            status="active",
            origin="web",
            current_period_end=datetime.now(UTC) + 10 * DAY,
            started_at=datetime.now(UTC) - DAY,
        )
    )
    assert client.post(CANCEL, headers=bearer()).json()["status"] == "cancelling"
    assert client.post(RESUME, headers=bearer()).json()["status"] == "active"


def test_resume_says_so_when_the_provider_cannot_bring_a_plan_back(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """Razorpay: 'Once cancelled, a Subscription cannot be restarted', and the only revert
    endpoint it offers is for scheduled plan updates. So the resume is honest about it."""
    deliver(client, event("subscription.activated", current_end=datetime.now(UTC) + 20 * DAY))
    cancelled = client.post(CANCEL, headers=bearer()).json()
    assert cancelled["can_resume"] is False
    res = client.post(RESUME, headers=bearer())
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "cannot_resume"
    assert "cannot be switched back on" in detail["message"]
    assert store.get(TEST_SUBJECT).status == "cancelled"


# --- e) the ledger and the console ----------------------------------------------------------------
@pytest.fixture
def register(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    fresh = InMemoryAdminStore()
    admin_auth.set_store(fresh)
    admin_auth.reset_limiter()
    yield fresh
    admin_auth.set_store(None)


OPERATOR_SUBJECT = "61111111-1111-4111-8111-111111111111"


def _console(client: TestClient, register: InMemoryAdminStore) -> dict[str, str]:
    register.upsert_admin(
        subject_id=OPERATOR_SUBJECT,
        email="ops@example.com",
        role=VIEWER,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=bearer(OPERATOR_SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**bearer(OPERATOR_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def test_every_checkout_and_webhook_is_on_the_subscriptions_desk(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    register: InMemoryAdminStore,
) -> None:
    with_plans(ledger)
    client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=bearer())
    deliver(client, event("subscription.activated"))
    deliver(client, event("subscription.charged", amount=199900))

    # A learner reads nothing here.
    assert client.get(f"{ADMIN_PREFIX}/billing", headers=bearer()).status_code == 403

    res = client.get(f"{ADMIN_PREFIX}/billing", headers=_console(client, register))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["readable"] is True
    assert body["payments"] == "on"
    assert body["last_webhook_at"] is not None
    events = body["events"]
    assert [e["kind"] for e in events] == ["webhook", "webhook", "checkout"]
    assert events[0]["event"] == "subscription.charged" and events[0]["amount_paise"] == 199900
    for row in events:
        # A handle, never the learner's id, on a console row.
        assert row.get("learner_id") is None
        assert isinstance(row["handle"], str) and row["handle"]
        assert TEST_SUBJECT not in json.dumps(row)


def test_an_unreadable_ledger_is_not_an_empty_desk(
    client: TestClient, provider: FakeRazorpay, register: InMemoryAdminStore
) -> None:
    records.set_store(records.UnconfiguredBillingRecords())
    try:
        res = client.get(f"{ADMIN_PREFIX}/billing", headers=_console(client, register))
        assert res.status_code == 200
        assert res.json()["readable"] is False and res.json()["events"] == []
    finally:
        records.set_store(None)


def test_an_unconfigured_ledger_makes_the_webhook_ask_the_provider_to_retry(
    client: TestClient, provider: FakeRazorpay, store: InMemorySubscriptionStore
) -> None:
    """Without a place to write the event id there is no once-only, so the event is not taken."""
    records.set_store(records.UnconfiguredBillingRecords())
    try:
        res = deliver(client, event("subscription.activated"))
        assert res.status_code == 503
    finally:
        records.set_store(None)


def test_health_shows_payments_on_or_off_and_the_last_webhook(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snap = client.get("/healthz").json()
    assert snap["checks"]["payments"]["payments"] == "on"
    assert snap["checks"]["payments"]["last_webhook_at"] is None
    deliver(client, event("subscription.activated"))
    snap = client.get("/healthz").json()
    assert snap["checks"]["payments"]["last_webhook_at"] is not None
    # No key names, no secrets, on an open probe.
    assert "not-a-real-secret" not in json.dumps(snap)
    assert WEBHOOK_SECRET not in json.dumps(snap)

    monkeypatch.delenv("RAZORPAY_KEY_SECRET", raising=False)
    snap = health.snapshot(public=True)
    assert snap["checks"]["payments"]["payments"] == "off"
    assert snap["checks"]["payments"]["status"] == "ok"  # off is not an outage off prod
    monkeypatch.setenv("ENV", "prod")
    assert health.snapshot(public=True)["checks"]["payments"]["status"] == "degraded"


# --- f) money first: one subscription per learner, and a period end that never goes back ----------
def _checkout(client: TestClient, plan: str = "pro", period: str = "yearly") -> Any:
    return client.post(CHECKOUT, json={"plan": plan, "period": period}, headers=bearer())


def _creates(provider: FakeRazorpay) -> list[dict[str, Any]]:
    return [b for n, b in provider.calls if n == "create_subscription"]


def _cancels(provider: FakeRazorpay) -> list[dict[str, Any]]:
    return [b for n, b in provider.calls if n == "cancel_subscription"]


def test_a_second_checkout_before_the_webhook_reuses_the_open_subscription(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """The learner closed the modal (or the tab) and pressed the door again. The provider still
    holds a payable ``created`` subscription for them; a second one would be a second bill."""
    with_plans(ledger)
    first = _checkout(client)
    second = _checkout(client)
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert second.json()["subscription_id"] == first.json()["subscription_id"]
    assert len(_creates(provider)) == 1
    # It asked the provider what became of the first one before answering.
    assert [n for n, _ in provider.calls if n == "fetch_subscription"]
    # Two checkouts, one ledger line: the row that is reused is the row that is there.
    assert [e.kind for e in ledger.recent(10)] == ["checkout"]


def test_a_second_checkout_after_paying_but_before_the_webhook_is_refused(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """The slow path: the bank took the money, the webhook has not landed, the row is still free.
    The old check read only the row and let the learner pay again."""
    with_plans(ledger)
    first = _checkout(client).json()
    for status in ("authenticated", "active", "pending"):
        provider.status_of[first["subscription_id"]] = status
        res = _checkout(client)
        assert res.status_code == 409, (status, res.text)
        detail = res.json()["detail"]
        assert detail["code"] == "already_subscribed"
        assert "still being confirmed" in detail["message"]
        assert "—" not in detail["message"]
    assert len(_creates(provider)) == 1


def test_a_checkout_for_a_different_plan_is_a_new_subscription(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """Pro yearly, closed; Max monthly chosen instead. The open Pro checkout is not what they
    asked for, so it is left to expire and a Max one is created."""
    with_plans(ledger)
    first = _checkout(client, "pro", "yearly").json()
    second = _checkout(client, "max", "monthly").json()
    assert second["subscription_id"] != first["subscription_id"]
    assert second["plan"] == "max" and second["period"] == "monthly"
    assert len(_creates(provider)) == 2
    # ...and pressing Max again reuses the Max one, not the Pro one.
    third = _checkout(client, "max", "monthly").json()
    assert third["subscription_id"] == second["subscription_id"]
    assert len(_creates(provider)) == 2


@pytest.mark.parametrize("status", ["expired", "cancelled", "completed"])
def test_an_open_checkout_the_provider_has_closed_is_replaced(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    status: str,
) -> None:
    with_plans(ledger)
    first = _checkout(client).json()
    provider.status_of[first["subscription_id"]] = status
    second = _checkout(client)
    assert second.status_code == 200
    assert second.json()["subscription_id"] != first["subscription_id"]
    assert len(_creates(provider)) == 2


def test_a_checkout_the_provider_cannot_describe_is_not_doubled(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """Asked what became of the open one and got no answer: refusing costs the learner a retry;
    creating another could cost them a second bill."""
    with_plans(ledger)
    _checkout(client)
    provider.fail_next = razorpay.RazorpayError(502, "gateway", "upstream")
    res = _checkout(client)
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "provider_unavailable"
    assert len(_creates(provider)) == 1


def test_a_created_subscription_expires_rather_than_staying_payable_forever(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """``expire_by`` (optional on the create-subscription page): an abandoned checkout stops
    being payable after a day instead of after thirty years."""
    with_plans(ledger)
    before = int(datetime.now(UTC).timestamp())
    _checkout(client)
    sent = _creates(provider)[0]
    assert isinstance(sent.get("expire_by"), int)
    assert before + payments.CHECKOUT_EXPIRES_S - 5 <= sent["expire_by"]
    assert sent["expire_by"] <= before + payments.CHECKOUT_EXPIRES_S + 5
    assert payments.CHECKOUT_EXPIRES_S <= 24 * 3600


def test_two_paid_subscriptions_for_one_learner_end_as_one(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """Both got paid (a race, a dashboard, a ledger that blinked). The learner keeps the one that
    runs longer and the other is told to stop at the provider, at cycle end, so it takes nothing
    more. Whichever order the two activations arrive in."""
    short, long_ = NOW + 30 * DAY, NOW + 365 * DAY
    # The shorter first: the longer one arriving replaces it, and the shorter is stopped.
    deliver(client, event("subscription.activated", sub_id="sub_a", current_end=short))
    res = deliver(
        client,
        event(
            "subscription.activated", sub_id="sub_b", plan="pro", period="yearly", current_end=long_
        ),
    )
    assert res.status_code == 200 and res.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row.razorpay_subscription_id == "sub_b" and row.current_period_end == long_
    assert row.period == "yearly" and row.status == "active"
    assert _cancels(provider) == [{"id": "sub_a", "cancel_at_cycle_end": True}]

    # The longer already on the row: a shorter one arriving is the extra, and it is stopped.
    res = deliver(client, event("subscription.activated", sub_id="sub_c", current_end=short))
    assert res.status_code == 200 and res.json()["outcome"] == "duplicate_cancelled"
    row = store.get(TEST_SUBJECT)
    assert row.razorpay_subscription_id == "sub_b" and row.current_period_end == long_
    assert _cancels(provider)[-1] == {"id": "sub_c", "cancel_at_cycle_end": True}
    # The desk sees what happened.
    assert [e.status for e in ledger.recent(10)][0] == "duplicate_cancelled"


def test_a_duplicate_the_provider_will_not_stop_is_not_taken(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """If the extra cannot be stopped, the event is refused so the provider sends it again, and
    the log says so at error level: the alert."""
    deliver(client, event("subscription.activated", sub_id="sub_a", current_end=NOW + 30 * DAY))
    provider.fail_next = razorpay.RazorpayError(500, "server_error", "down")
    res = deliver(
        client, event("subscription.activated", sub_id="sub_b", current_end=NOW + 60 * DAY)
    )
    assert res.status_code == 503
    row = store.get(TEST_SUBJECT)
    assert row.razorpay_subscription_id == "sub_a" and row.current_period_end == NOW + 30 * DAY
    assert len([e for e in ledger.recent(10) if e.kind == "webhook"]) == 1
    assert any(
        r.levelname == "ERROR" and "two provider subscriptions" in r.getMessage()
        for r in caplog.records
    )
    # The provider's retry, once the provider is back, lands.
    res = deliver(
        client, event("subscription.activated", sub_id="sub_b", current_end=NOW + 60 * DAY)
    )
    assert res.status_code == 200 and res.json()["outcome"] == "applied"
    assert store.get(TEST_SUBJECT).razorpay_subscription_id == "sub_b"


def test_a_new_subscription_after_the_old_one_ended_simply_replaces_it(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """Not a duplicate: the old period is over. Nothing is cancelled at the provider."""
    store.insert(
        Subscription(
            id="row",
            learner_id=TEST_SUBJECT,
            plan="pro",
            status="cancelled",
            origin="web",
            current_period_end=datetime.now(UTC) - DAY,
            started_at=datetime.now(UTC) - 40 * DAY,
            cancelled_at=datetime.now(UTC) - 20 * DAY,
            razorpay_subscription_id="sub_old",
        )
    )
    ends = (datetime.now(UTC) + 30 * DAY).replace(microsecond=0)
    res = deliver(client, event("subscription.activated", sub_id="sub_new", current_end=ends))
    assert res.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row.razorpay_subscription_id == "sub_new" and row.status == "active"
    assert row.cancelled_at is None and row.current_period_end == ends
    assert _cancels(provider) == []


def test_a_late_charged_never_moves_the_period_end_backwards(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """validate-test: 'you may not always receive the webhooks in the order'. Cycle two's charge
    lands, then cycle one's late retry: the learner has paid through cycle two."""
    cycle1, cycle2 = NOW + 30 * DAY, NOW + 60 * DAY
    deliver(client, event("subscription.activated", current_end=cycle1))
    deliver(client, event("subscription.charged", current_end=cycle2, amount=199900))
    assert store.get(TEST_SUBJECT).current_period_end == cycle2
    # A stale cycle-one charge: a new delivery (different amount, so different bytes).
    res = deliver(client, event("subscription.charged", current_end=cycle1, amount=199901))
    assert res.status_code == 200 and res.json()["outcome"] == "applied"
    assert store.get(TEST_SUBJECT).current_period_end == cycle2
    billing.reset_cache()
    assert billing.plan_for(TEST_SUBJECT, now=cycle1 + DAY) == "pro"


def test_a_replayed_activation_under_a_fresh_header_does_not_uncancel(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """The header is not covered by the signature. The same signed bytes under a new header, or
    under no header at all, are the same delivery, and are refused as one."""
    ends = (datetime.now(UTC) + 20 * DAY).replace(microsecond=0)
    body = event("subscription.activated", current_end=ends)
    deliver(client, body, event_id="evt_first")
    assert client.post(CANCEL, headers=bearer()).status_code == 200
    assert store.get(TEST_SUBJECT).status == "cancelled"

    replay = deliver(client, body, event_id="evt_fresh")
    assert replay.json()["outcome"] == "already_processed"
    raw = json.dumps(body).encode()
    bare = client.post(WEBHOOK, content=raw, headers={"X-Razorpay-Signature": sign(raw)})
    assert bare.json()["outcome"] == "already_processed"
    row = store.get(TEST_SUBJECT)
    assert row.status == "cancelled" and row.cancelled_at is not None
    assert len([e for e in ledger.recent(10) if e.kind == "webhook"]) == 1


def test_a_stale_charge_after_a_cancel_does_not_uncancel_either(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """A charge for the cycle already paid arrives after the cancel (out of order). The money is
    real, so the period end may move forward; the cancel is real too, and it stays."""
    ends = (datetime.now(UTC) + 20 * DAY).replace(microsecond=0)
    deliver(client, event("subscription.activated", current_end=ends))
    client.post(CANCEL, headers=bearer())
    later = ends + 30 * DAY
    res = deliver(client, event("subscription.charged", current_end=later, amount=199900))
    assert res.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row.status == "cancelled" and row.cancelled_at is not None
    assert row.current_period_end == later
    view = client.get(PLAN, headers=bearer()).json()
    assert view["status"] == "cancelling" and view["can_cancel"] is False
    assert len(_cancels(provider)) == 1


def test_a_header_shaped_like_a_checkout_row_is_not_swallowed(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    with_plans(ledger)
    sub_id = _checkout(client).json()["subscription_id"]
    res = deliver(
        client, event("subscription.activated", sub_id=sub_id), event_id=f"checkout:{sub_id}"
    )
    assert res.json()["outcome"] == "applied"
    assert store.get(TEST_SUBJECT) is not None


def test_the_plan_actually_charged_wins_over_the_notes(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """Notes are written once at checkout; ``plan_id`` is what the provider charges. A plan
    changed at the dashboard changes the second and never the first."""
    with_plans(ledger)
    body = event("subscription.activated", plan="max", period="yearly", current_end=NOW + 365 * DAY)
    body["payload"]["subscription"]["entity"]["notes"] = {
        "wobo_learner_id": TEST_SUBJECT,
        "wobo_plan": "pro",
        "wobo_period": "monthly",
    }
    res = deliver(client, body)
    assert res.json()["outcome"] == "applied"
    row = store.get(TEST_SUBJECT)
    assert row.plan == "max" and row.period == "yearly"
    # Notes still stand in when the plan id is not one we know (a plan created by hand).
    body = event("subscription.charged", current_end=NOW + 400 * DAY, amount=1)
    body["payload"]["subscription"]["entity"]["plan_id"] = "plan_handmade"
    assert deliver(client, body).json()["outcome"] == "applied"
    assert store.get(TEST_SUBJECT).plan == "pro"


def test_the_cancel_confirmation_promises_no_way_back(
    client: TestClient,
    provider: FakeRazorpay,
    store: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
) -> None:
    """The gateway refuses every provider-backed resume, so the line it sends with the cancel
    button must not promise one."""
    deliver(client, event("subscription.activated", current_end=datetime.now(UTC) + 20 * DAY))
    view = client.get(PLAN, headers=bearer()).json()
    assert view["can_cancel"] is True
    assert not re.search(
        r"bring it back|puts? the plan back|switch(ed)? .*back on any", view["confirm"], re.I
    )
    assert "cannot be switched back on" in view["confirm"]


# --- the record itself ----------------------------------------------------------------------------
def test_the_new_columns_round_trip_through_a_row() -> None:
    row = {
        "plan": "max",
        "status": "active",
        "origin": "web",
        "period": "yearly",
        "current_period_end": "2027-09-05T00:00:00Z",
        "razorpay_subscription_id": "sub_1",
        "razorpay_plan_id": "plan_1",
        "provider_status": "active",
    }
    sub = billing.from_row(row)
    assert sub is not None
    assert sub.period == "yearly" and sub.razorpay_subscription_id == "sub_1"
    assert sub.provider_managed is True
    back = billing.to_row(sub)
    assert back["period"] == "yearly" and back["provider_status"] == "active"
    # An unknown period is read as the shorter one, never the longer.
    assert billing.from_row({**row, "period": "decade"}).period == "monthly"
    assert (
        billing.from_row(
            {"plan": "pro", "current_period_end": "2027-01-01T00:00:00Z"}
        ).provider_managed
        is False
    )


def test_the_postgrest_ledger_writes_and_dedupes_by_event_id() -> None:
    seen: list[tuple[str, str, Any]] = []

    def fake(url: str, key: str, method: str, *, body: Any = None, want_rows: bool = True) -> Any:
        seen.append((method, url, body))
        if "billing_events" in url and method == "GET":
            return [{"event_id": "evt_1"}] if "evt_1" in url else []
        if "billing_config" in url and method == "GET":
            return [{"key": plans.CONFIG_KEY, "value": {"pro_monthly": "plan_x"}}]
        return [body[0] if isinstance(body, list) else body]

    ledger = records.PostgrestBillingRecords("https://project.test", "service-key", request=fake)
    assert ledger.seen("evt_1") is True
    assert ledger.seen("evt_2") is False
    assert ledger.get_config(plans.CONFIG_KEY) == {"pro_monthly": "plan_x"}
    with pytest.raises(records.RecordsUnavailable):
        ledger.seen("evt_1&kind=eq.checkout")


def test_the_ledger_is_never_the_memory_one_by_accident(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("SUBSCRIPTIONS_STORE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(key, raising=False)
    assert isinstance(records.build_store(), records.UnconfiguredBillingRecords)
    monkeypatch.setenv("SUBSCRIPTIONS_STORE", "memory")
    assert isinstance(records.build_store(), InMemoryBillingRecords)


# --- the copy law, and the one rule about this machine --------------------------------------------
def test_every_line_the_learner_reads_keeps_the_copy_law() -> None:
    lines = [
        *payments.LINES.values(),
        billing._LINES["payment_failed"],
        billing._LINES["payment_pending"],
        billing._NO_RESUME,
        billing._CANCEL_NEEDS_PAYMENTS,
        billing.CONFIRM,
        *billing._LINES.values(),
    ]
    for line in lines:
        assert "—" not in line and "--" not in line, line
        assert "!" not in line, line
        assert not re.search(r"\d", line.replace(billing.SUPPORT, "")), line
        assert not re.search(r"\b(razorpay|refund)\b", line, re.I), line
        assert not re.search(r"\b(tonight|midnight|pm)\b", line, re.I), line


def test_no_live_key_exists_on_this_machine() -> None:
    """No money moves in this suite, and this is the assertion that says so."""
    assert not os.environ.get("RAZORPAY_KEY_ID", "").startswith("rzp_live_")
    assert razorpay.BASE_URL.startswith("https://api.razorpay.com/")
