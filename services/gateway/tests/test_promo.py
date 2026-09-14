"""Promo codes, end to end: what a code grants, who may create one, and who may take it once.

Everything here fails without ``wobo_gateway/promo.py``, migration 0027, and the two changes
promo codes make to billing (a fourth origin on ``learner.subscriptions``, and the optional code
on the checkout). The suite mints REAL Supabase-shaped tokens and drives the real admin door
(``admin_auth.admin_router``), so what is under test is the path that runs in production.

The failures these are shaped around, in the brief's own order (docs/ALLOWANCE.md section 3):

* a code that still works after it expired, or after it was disabled;
* a code that can be used past its limit, or twice by the same account;
* a code that grants the wrong thing, or grants nothing while saying it worked;
* a forged code — a shape nobody issued — treated as a lookup rather than as a refusal;
* a percentage off the first payment that shows a learner a discount and then charges them the
  full price, or that arrives as a refund (there is no refund in this product);
* a console that lets a seat which is not the owner mint money, or that mints it with no trail;
* a desk that puts a child's learner id on the screen beside the code they redeemed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, billing, promo
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    OWNER,
    VIEWER,
    Admin,
    InMemoryAdminStore,
)
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.billing import InMemorySubscriptionStore, Subscription, plans, razorpay, records
from wobo_gateway.billing.records import InMemoryBillingRecords
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.promo import InMemoryPromoStore, PromoCode, UnconfiguredPromoStore
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

REDEEM = "/v1/promo/redeem"
CHECKOUT = "/v1/billing/checkout"
DESK = f"{ADMIN_PREFIX}/promo"
CREATE = f"{ADMIN_PREFIX}/promo/create"
DISABLE = f"{ADMIN_PREFIX}/promo/disable"
REDEMPTIONS = f"{ADMIN_PREFIX}/promo/redemptions"

LEARNER = "aaaaaaaa-1111-4111-8111-111111111111"
OTHER = "bbbbbbbb-2222-4222-8222-222222222222"
OWNER_SUBJECT = "cccccccc-3333-4333-8333-333333333333"
OPERATOR_SUBJECT = "dddddddd-4444-4444-8444-444444444444"
VIEWER_SUBJECT = "eeeeeeee-5555-4555-8555-555555555555"

DAY = timedelta(days=1)
NOW = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)

WEBHOOK_SECRET = "a-webhook-secret-for-the-suite"


# --- the fixtures ---------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _promo_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    """Fresh codes, a fresh register, and every store asked for BY NAME."""
    monkeypatch.setenv("PROMO_STORE", "memory")
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    # The desk's learner handle is an HMAC; the suite gives it the key production takes from the
    # service role, so a row without a handle is a failure rather than the unconfigured default.
    monkeypatch.setenv("REPORTS_HANDLE_PEPPER", "a-test-pepper-for-the-promo-handle")
    monkeypatch.delenv("ENV", raising=False)
    register = InMemoryAdminStore()
    admin_auth.set_store(register)
    admin_auth.reset_limiter()
    promo.set_store(InMemoryPromoStore())
    yield register
    admin_auth.set_store(None)
    promo.set_store(None)


@pytest.fixture
def codes() -> InMemoryPromoStore:
    fresh = InMemoryPromoStore()
    promo.set_store(fresh)
    yield fresh
    promo.set_store(None)


@pytest.fixture
def subs() -> InMemorySubscriptionStore:
    fresh = InMemorySubscriptionStore()
    billing.set_store(fresh)
    yield fresh
    billing.set_store(None)
    billing.reset_cache()


@pytest.fixture
def ledger() -> InMemoryBillingRecords:
    fresh = InMemoryBillingRecords()
    records.set_store(fresh)
    yield fresh
    records.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


class FakeRazorpay:
    """Every call the gateway makes, recorded, and nothing on the wire."""

    def __init__(self) -> None:
        self.subscriptions: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.status_of: dict[str, str] = {}
        self._n = 0

    def create_plan(self, body: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover - unused
        raise AssertionError("the checkout never creates a plan")

    def list_plans(self, *, count: int, skip: int) -> dict[str, Any]:  # pragma: no cover - unused
        return {"entity": "collection", "count": 0, "items": []}

    def create_subscription(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("create_subscription", body))
        self._n += 1
        created = {
            "id": f"sub_{self._n:014d}",
            "entity": "subscription",
            "status": "created",
            **body,
        }
        self.subscriptions.append(created)
        return created

    def cancel_subscription(self, subscription_id: str, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("cancel_subscription", {"id": subscription_id, **body}))
        return {"id": subscription_id, "entity": "subscription", "status": "cancelled"}

    def fetch_subscription(self, subscription_id: str) -> dict[str, Any]:
        self.calls.append(("fetch_subscription", {"id": subscription_id}))
        for sub in self.subscriptions:
            if sub["id"] == subscription_id:
                return {**sub, "status": self.status_of.get(subscription_id, sub["status"])}
        raise razorpay.RazorpayError(400, "BAD_REQUEST_ERROR", "The id provided does not exist")


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> FakeRazorpay:
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_notarealkey")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "not-a-real-secret")
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    fake = FakeRazorpay()
    razorpay.set_client(fake)
    yield fake
    razorpay.set_client(None)


def _bearer(subject: str, **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET, **claims)}"}


def _seat(client: TestClient, store: InMemoryAdminStore, subject: str, role: str) -> dict[str, str]:
    """Register somebody, sign them into the console, and hand back the headers a desk needs.

    A freshly opened session is already stepped up (``admin_auth.open_session`` stamps
    ``reauth_at``), which is what makes a write reachable in one call here.
    """
    store.upsert_admin(
        subject_id=subject,
        email=f"{role}@heywobo.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(subject))
    assert opened.status_code == 200, opened.text
    return {**_bearer(subject), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _code(
    *,
    code: str = "WELCOME",
    kind: str = "plan_days",
    value: int = 30,
    days: int | None = None,
    plan: str | None = "pro",
    provider_offer_id: str | None = None,
    expires_at: datetime | None = None,
    max_uses: int | None = None,
    once_per_account: bool = True,
    disabled_at: datetime | None = None,
) -> PromoCode:
    return PromoCode(
        id=str(uuid.uuid4()),
        code=code,
        kind=kind,
        value=value,
        days=days,
        plan=plan,
        provider_offer_id=provider_offer_id,
        expires_at=expires_at,
        max_uses=max_uses,
        once_per_account=once_per_account,
        created_by=OWNER_SUBJECT,
        disabled_at=disabled_at,
        created_at=NOW - DAY,
    )


def with_plans(ledger: InMemoryBillingRecords) -> dict[str, str]:
    ids = {key: f"plan_{key}" for key in plans.CATALOGUE}
    ledger.set_config(plans.CONFIG_KEY, ids)
    return ids


# --- the shape of a code --------------------------------------------------------------------------
def test_a_code_is_normalised_before_anything_looks_it_up() -> None:
    """Typed however it is typed, it is one string by the time it reaches a filter."""
    assert promo.normalise("  welcome-10 ") == "WELCOME-10"
    assert promo.normalise("Welcome10") == "WELCOME10"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "ab",  # too short to be anything but a typo
        "a" * 33,  # longer than the column
        "WELCOME 10",  # a space is not part of the alphabet
        "WELCOME'--",  # the shape a filter injection would arrive in
        "WELCOME,10",
        "-LEADING",
    ],
)
def test_a_shape_nobody_issues_is_refused_before_the_store(raw: str) -> None:
    with pytest.raises(promo.BadCode):
        promo.normalise(raw)


def test_the_kinds_match_the_migrations_check_constraint() -> None:
    """The three kinds are a closed list in both places, and this fails when one drifts."""
    from pathlib import Path

    sql = (
        Path(__file__).resolve().parents[3] / "infra/supabase/migrations/0027_promo_codes.sql"
    ).read_text()
    for kind in promo.KINDS:
        assert f"'{kind}'" in sql
    assert promo.KINDS == ("plan_days", "allowance_boost_days", "percent_off_first")


# --- redeeming: the refusals ----------------------------------------------------------------------
def test_a_forged_code_is_refused_and_nothing_is_granted(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    answer = client.post(REDEEM, json={"code": "NOTACODE"}, headers=_bearer(LEARNER))
    assert answer.status_code == 404
    assert answer.json()["detail"]["code"] == "unknown_code"
    assert subs.get(LEARNER) is None
    assert codes.redemptions() == []


def test_a_malformed_code_never_reaches_the_store(client: TestClient) -> None:
    """The refusal happens in the gateway, so a filter never sees a string nobody issued."""
    promo.set_store(UnconfiguredPromoStore())
    answer = client.post(REDEEM, json={"code": "'; drop--"}, headers=_bearer(LEARNER))
    assert answer.status_code == 422
    assert answer.json()["detail"]["code"] == "not_a_code"


def test_a_disabled_code_reads_as_no_code_at_all(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    """One line for "I do not know that", so a disabled code cannot be told from a wrong one."""
    codes.insert_code(_code(code="RETIRED", disabled_at=NOW - DAY))
    answer = client.post(REDEEM, json={"code": "retired"}, headers=_bearer(LEARNER))
    assert answer.status_code == 404
    assert answer.json()["detail"]["code"] == "unknown_code"
    assert codes.redemptions() == []


def test_an_expired_code_is_refused(client: TestClient, codes: InMemoryPromoStore) -> None:
    codes.insert_code(_code(code="LASTTERM", expires_at=datetime.now(UTC) - DAY))
    answer = client.post(REDEEM, json={"code": "LASTTERM"}, headers=_bearer(LEARNER))
    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "expired"


def test_a_code_past_its_use_limit_is_refused(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    codes.insert_code(_code(code="FIRSTTEN", max_uses=1))
    first = client.post(REDEEM, json={"code": "FIRSTTEN"}, headers=_bearer(LEARNER))
    assert first.status_code == 200, first.text
    second = client.post(REDEEM, json={"code": "FIRSTTEN"}, headers=_bearer(OTHER))
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "used_up"
    assert subs.get(OTHER) is None
    assert len(codes.redemptions()) == 1


def test_once_per_account_holds_for_the_same_learner_and_not_for_another(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    codes.insert_code(_code(code="ONCEONLY", max_uses=None))
    assert client.post(REDEEM, json={"code": "ONCEONLY"}, headers=_bearer(LEARNER)).status_code == 200
    again = client.post(REDEEM, json={"code": "ONCEONLY"}, headers=_bearer(LEARNER))
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_used"
    assert client.post(REDEEM, json={"code": "ONCEONLY"}, headers=_bearer(OTHER)).status_code == 200
    assert len(codes.redemptions()) == 2


def test_the_store_enforces_once_per_account_as_well_as_the_route(
    codes: InMemoryPromoStore,
) -> None:
    """Ruling 1 of migration 0027: two replicas both passing the read must not both write."""
    row = codes.insert_code(_code(code="RACED"))
    granted = {"plan": "pro", "days": 30}
    codes.record(promo.Redemption.make(row, LEARNER, granted, at=NOW))
    with pytest.raises(promo.AlreadyRedeemed):
        codes.record(promo.Redemption.make(row, LEARNER, granted, at=NOW))


def test_a_signed_out_caller_cannot_redeem_anything(client: TestClient) -> None:
    assert client.post(REDEEM, json={"code": "WELCOME"}).status_code in (401, 403)


def test_an_anonymous_caller_cannot_redeem_anything(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    """An anonymous subject is a fresh account, so a code redeemed on one is unlimited."""
    codes.insert_code(_code(code="WELCOME", max_uses=1))
    answer = client.post(
        REDEEM,
        json={"code": "WELCOME"},
        headers=_bearer(LEARNER, anonymous=True),
    )
    assert answer.status_code == 403
    assert codes.redemptions() == []


def test_an_unreachable_store_says_so_and_grants_nothing(client: TestClient) -> None:
    promo.set_store(UnconfiguredPromoStore())
    answer = client.post(REDEEM, json={"code": "WELCOME"}, headers=_bearer(LEARNER))
    assert answer.status_code == 503
    assert answer.json()["detail"]["code"] == "unavailable"


# --- redeeming: what each kind actually does ------------------------------------------------------
def test_plan_days_grants_a_plan_that_simply_runs_out(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    codes.insert_code(_code(code="TRYPRO", kind="plan_days", value=30, plan="pro"))
    answer = client.post(REDEEM, json={"code": "TRYPRO"}, headers=_bearer(LEARNER))
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["kind"] == "plan_days"
    assert body["granted"]["plan"] == "pro"
    assert body["granted"]["days"] == 30

    row = subs.get(LEARNER)
    assert row is not None
    assert row.plan == "pro"
    assert row.status == "active"
    # A promo row was not bought anywhere: the origin says so, nothing is charging it, and it
    # ends on its own. Migration 0027 widens the constraint for exactly this word.
    assert row.origin == "promo"
    assert row.razorpay_subscription_id is None
    assert row.current_period_end - datetime.now(UTC) > timedelta(days=29)
    assert row.current_period_end - datetime.now(UTC) < timedelta(days=31)


def test_the_plan_a_promo_grants_is_the_one_the_learner_is_metered_on(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    """The grant is worthless unless the meter reads it, so the meter is what is asserted."""
    codes.insert_code(_code(code="TRYMAX", kind="plan_days", value=7, plan="max"))
    assert client.post(REDEEM, json={"code": "TRYMAX"}, headers=_bearer(LEARNER)).status_code == 200
    billing.forget(LEARNER)
    assert billing.plan_for(LEARNER) == "max"


def test_plan_days_extends_a_promo_row_rather_than_replacing_it(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    """Days already granted are never taken back: the second code adds to the first."""
    ends = datetime.now(UTC) + 10 * DAY
    subs.insert(
        Subscription(
            id=str(uuid.uuid4()),
            learner_id=LEARNER,
            plan="pro",
            status="active",
            origin="promo",
            current_period_end=ends,
            started_at=datetime.now(UTC) - DAY,
        )
    )
    codes.insert_code(_code(code="SEVENMORE", kind="plan_days", value=7, plan="pro"))
    assert (
        client.post(REDEEM, json={"code": "SEVENMORE"}, headers=_bearer(LEARNER)).status_code == 200
    )
    row = subs.get(LEARNER)
    assert row is not None
    assert row.current_period_end - ends > timedelta(days=6, hours=23)


def test_plan_days_never_lowers_a_plan_a_learner_already_has(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    """A code for the smaller plan adds days and leaves the bigger plan where it is."""
    subs.insert(
        Subscription(
            id=str(uuid.uuid4()),
            learner_id=LEARNER,
            plan="max",
            status="active",
            origin="promo",
            current_period_end=datetime.now(UTC) + 5 * DAY,
            started_at=datetime.now(UTC) - DAY,
        )
    )
    codes.insert_code(_code(code="PLUSDAYS", kind="plan_days", value=5, plan="plus"))
    assert (
        client.post(REDEEM, json={"code": "PLUSDAYS"}, headers=_bearer(LEARNER)).status_code == 200
    )
    row = subs.get(LEARNER)
    assert row is not None
    assert row.plan == "max"


def test_plan_days_is_refused_while_a_provider_is_charging_the_learner(
    client: TestClient, codes: InMemoryPromoStore, subs: InMemorySubscriptionStore
) -> None:
    """Moving the period end on a row a provider is charging would desync the next charge from
    the plan. The honest answer is that the code has nothing to add right now."""
    subs.insert(
        Subscription(
            id=str(uuid.uuid4()),
            learner_id=LEARNER,
            plan="pro",
            status="active",
            origin="web",
            current_period_end=datetime.now(UTC) + 20 * DAY,
            started_at=datetime.now(UTC) - 10 * DAY,
            razorpay_subscription_id="sub_00000000000001",
            provider_status="active",
        )
    )
    codes.insert_code(_code(code="TRYPRO", kind="plan_days", value=30, plan="pro"))
    answer = client.post(REDEEM, json={"code": "TRYPRO"}, headers=_bearer(LEARNER))
    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "already_subscribed"
    # And the code is NOT spent: it can be used the day the paid period ends.
    assert codes.redemptions() == []


def test_an_allowance_boost_adds_to_the_day_for_the_days_it_says(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    codes.insert_code(
        _code(code="BIGWEEK", kind="allowance_boost_days", value=500, days=7, plan=None)
    )
    answer = client.post(REDEEM, json={"code": "BIGWEEK"}, headers=_bearer(LEARNER))
    assert answer.status_code == 200, answer.text
    assert answer.json()["kind"] == "allowance_boost_days"

    now = datetime.now(UTC)
    # The seam the daily allowance reads (docs/ALLOWANCE.md section 4): paise added to today.
    assert promo.allowance_boost_paise(LEARNER, now=now) == 500
    assert promo.allowance_boost_paise(LEARNER, now=now + 6 * DAY) == 500
    assert promo.allowance_boost_paise(LEARNER, now=now + 8 * DAY) == 0
    # And it is that learner's day, nobody else's.
    assert promo.allowance_boost_paise(OTHER, now=now) == 0


def test_two_boosts_on_one_day_add_up(client: TestClient, codes: InMemoryPromoStore) -> None:
    codes.insert_code(
        _code(code="BOOSTONE", kind="allowance_boost_days", value=300, days=3, plan=None)
    )
    codes.insert_code(
        _code(code="BOOSTTWO", kind="allowance_boost_days", value=200, days=3, plan=None)
    )
    for code in ("BOOSTONE", "BOOSTTWO"):
        assert client.post(REDEEM, json={"code": code}, headers=_bearer(LEARNER)).status_code == 200
    assert promo.allowance_boost_paise(LEARNER, now=datetime.now(UTC)) == 500


def test_a_boost_never_reads_as_money_to_the_learner(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    """docs/ALLOWANCE.md section 2: no money anywhere at the learner's end. The paise are in the
    gateway's arithmetic and never in the line the learner reads."""
    codes.insert_code(
        _code(code="BIGWEEK", kind="allowance_boost_days", value=500, days=7, plan=None)
    )
    body = client.post(REDEEM, json={"code": "BIGWEEK"}, headers=_bearer(LEARNER)).json()
    line = body["line"]
    assert "500" not in line
    for word in ("rupee", "paise", "₹", "$", "money"):
        assert word not in line.lower()
    assert "—" not in line  # the register: no em dash in anything a learner reads


def test_a_percentage_off_is_not_redeemed_at_this_door(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    """It comes off a payment, so it is used where the payment is. Never as a refund."""
    codes.insert_code(
        _code(
            code="TWENTYOFF",
            kind="percent_off_first",
            value=20,
            plan=None,
            provider_offer_id="offer_twenty",
        )
    )
    answer = client.post(REDEEM, json={"code": "TWENTYOFF"}, headers=_bearer(LEARNER))
    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "use_at_checkout"
    assert "refund" not in answer.json()["detail"]["message"].lower()
    assert codes.redemptions() == []


def test_a_redemption_records_what_it_granted_and_not_a_pointer_at_the_code(
    client: TestClient, codes: InMemoryPromoStore
) -> None:
    """Ruling 3 of migration 0027: a code edited later must not change the story of a grant."""
    codes.insert_code(_code(code="TRYPRO", kind="plan_days", value=30, plan="pro"))
    assert client.post(REDEEM, json={"code": "TRYPRO"}, headers=_bearer(LEARNER)).status_code == 200
    taken = codes.redemptions()
    assert len(taken) == 1
    assert taken[0].learner_id == LEARNER
    assert taken[0].kind == "plan_days"
    assert taken[0].granted["plan"] == "pro"
    assert taken[0].granted["days"] == 30
    assert taken[0].granted["period_end"]


# --- the percentage, at the checkout --------------------------------------------------------------
def test_a_valid_code_reaches_the_provider_as_its_offer(
    client: TestClient,
    codes: InMemoryPromoStore,
    subs: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    provider: FakeRazorpay,
) -> None:
    with_plans(ledger)
    codes.insert_code(
        _code(
            code="TWENTYOFF",
            kind="percent_off_first",
            value=20,
            plan=None,
            provider_offer_id="offer_twenty",
        )
    )
    answer = client.post(
        CHECKOUT,
        json={"plan": "pro", "period": "monthly", "promo": "twentyoff"},
        headers=_bearer(LEARNER),
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    # The discount is real at the provider, which is the only place it can be real.
    created = [call for name, call in provider.calls if name == "create_subscription"]
    assert created and created[0]["offer_id"] == "offer_twenty"
    # And what the browser is told to expect matches what will be charged.
    assert body["promo"]["code"] == "TWENTYOFF"
    assert body["promo"]["percent_off"] == 20
    assert body["promo"]["first_amount_paise"] == round(body["amount_paise"] * 0.8)
    # The use is recorded, against the subscription it was attached to.
    taken = codes.redemptions()
    assert len(taken) == 1
    assert taken[0].kind == "percent_off_first"
    assert taken[0].provider_subscription_id == body["subscription_id"]


def test_a_code_that_cannot_be_applied_refuses_the_checkout_rather_than_charging_full_price(
    client: TestClient,
    codes: InMemoryPromoStore,
    subs: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    provider: FakeRazorpay,
) -> None:
    with_plans(ledger)
    codes.insert_code(
        _code(
            code="TWENTYOFF",
            kind="percent_off_first",
            value=20,
            plan=None,
            provider_offer_id="offer_twenty",
            expires_at=datetime.now(UTC) - DAY,
        )
    )
    answer = client.post(
        CHECKOUT,
        json={"plan": "pro", "period": "monthly", "promo": "TWENTYOFF"},
        headers=_bearer(LEARNER),
    )
    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "expired"
    # Nothing was created at the provider: a learner who typed a code is never quietly charged
    # the full price instead.
    assert provider.calls == []
    assert ledger.recent(limit=10) == []


def test_the_wrong_kind_of_code_is_refused_at_the_checkout(
    client: TestClient,
    codes: InMemoryPromoStore,
    subs: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    provider: FakeRazorpay,
) -> None:
    with_plans(ledger)
    codes.insert_code(_code(code="TRYPRO", kind="plan_days", value=30, plan="pro"))
    answer = client.post(
        CHECKOUT,
        json={"plan": "pro", "period": "monthly", "promo": "TRYPRO"},
        headers=_bearer(LEARNER),
    )
    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "not_at_checkout"
    assert provider.calls == []


def test_reopening_the_same_checkout_with_the_same_code_does_not_spend_a_second_use(
    client: TestClient,
    codes: InMemoryPromoStore,
    subs: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    provider: FakeRazorpay,
) -> None:
    """A modal closed over dinner must not burn the one code the learner was given."""
    with_plans(ledger)
    codes.insert_code(
        _code(
            code="TWENTYOFF",
            kind="percent_off_first",
            value=20,
            plan=None,
            provider_offer_id="offer_twenty",
            max_uses=1,
        )
    )
    body = {"plan": "pro", "period": "monthly", "promo": "TWENTYOFF"}
    first = client.post(CHECKOUT, json=body, headers=_bearer(LEARNER))
    assert first.status_code == 200, first.text
    second = client.post(CHECKOUT, json=body, headers=_bearer(LEARNER))
    assert second.status_code == 200, second.text
    assert len(codes.redemptions()) == 1
    # And the limit still holds against a second account.
    third = client.post(CHECKOUT, json=body, headers=_bearer(OTHER))
    assert third.status_code == 409
    assert third.json()["detail"]["code"] == "used_up"


def test_a_checkout_with_no_code_is_exactly_what_it_was(
    client: TestClient,
    codes: InMemoryPromoStore,
    subs: InMemorySubscriptionStore,
    ledger: InMemoryBillingRecords,
    provider: FakeRazorpay,
) -> None:
    with_plans(ledger)
    answer = client.post(
        CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=_bearer(LEARNER)
    )
    assert answer.status_code == 200, answer.text
    assert "promo" not in answer.json()
    created = [call for name, call in provider.calls if name == "create_subscription"]
    assert created and "offer_id" not in created[0]
    assert codes.redemptions() == []


# --- the console desk -----------------------------------------------------------------------------
def test_only_the_owner_may_mint_a_code(
    client: TestClient, _promo_env: InMemoryAdminStore, codes: InMemoryPromoStore
) -> None:
    body = {"code": "TRYPRO", "kind": "plan_days", "value": 30, "plan": "pro"}
    for subject, role in ((VIEWER_SUBJECT, VIEWER), (OPERATOR_SUBJECT, OPERATOR)):
        refused = client.post(CREATE, json=body, headers=_seat(client, _promo_env, subject, role))
        assert refused.status_code in (401, 403), refused.text
    assert codes.codes(limit=10) == []

    made = client.post(CREATE, json=body, headers=_seat(client, _promo_env, OWNER_SUBJECT, OWNER))
    assert made.status_code == 200, made.text
    assert made.json()["code"] == "TRYPRO"
    assert len(codes.codes(limit=10)) == 1


def test_minting_a_code_leaves_a_trail(
    client: TestClient, _promo_env: InMemoryAdminStore, codes: InMemoryPromoStore
) -> None:
    headers = _seat(client, _promo_env, OWNER_SUBJECT, OWNER)
    made = client.post(
        CREATE,
        json={"code": "TRYPRO", "kind": "plan_days", "value": 30, "plan": "pro", "max_uses": 50},
        headers=headers,
    )
    assert made.status_code == 200, made.text
    actions = [row["action"] for row in _promo_env.audit]
    assert "promo.code.create" in actions
    row = next(r for r in _promo_env.audit if r["action"] == "promo.code.create")
    assert row["resource_id"] == "TRYPRO"
    assert row["detail"]["kind"] == "plan_days"


def test_a_percentage_code_with_no_provider_offer_cannot_be_created(
    client: TestClient, _promo_env: InMemoryAdminStore, codes: InMemoryPromoStore
) -> None:
    """Ruling 4 of migration 0027: a discount that cannot actually come off a payment is a lie
    waiting to be told, so it cannot be minted at all."""
    headers = _seat(client, _promo_env, OWNER_SUBJECT, OWNER)
    refused = client.post(
        CREATE,
        json={"code": "TWENTYOFF", "kind": "percent_off_first", "value": 20},
        headers=headers,
    )
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "needs_provider_offer"
    assert codes.codes(limit=10) == []


def test_a_code_that_already_exists_is_not_quietly_replaced(
    client: TestClient, _promo_env: InMemoryAdminStore, codes: InMemoryPromoStore
) -> None:
    codes.insert_code(_code(code="TRYPRO", value=30))
    headers = _seat(client, _promo_env, OWNER_SUBJECT, OWNER)
    refused = client.post(
        CREATE,
        json={"code": "trypro", "kind": "plan_days", "value": 365, "plan": "max"},
        headers=headers,
    )
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "already_exists"
    assert codes.by_code("TRYPRO").value == 30


def test_only_the_owner_may_disable_a_code_and_a_disabled_one_stops_working(
    client: TestClient,
    _promo_env: InMemoryAdminStore,
    codes: InMemoryPromoStore,
    subs: InMemorySubscriptionStore,
) -> None:
    codes.insert_code(_code(code="TRYPRO"))
    refused = client.post(
        DISABLE,
        json={"code": "TRYPRO"},
        headers=_seat(client, _promo_env, OPERATOR_SUBJECT, OPERATOR),
    )
    assert refused.status_code in (401, 403)
    assert codes.by_code("TRYPRO").disabled_at is None

    done = client.post(
        DISABLE,
        json={"code": "trypro"},
        headers=_seat(client, _promo_env, OWNER_SUBJECT, OWNER),
    )
    assert done.status_code == 200, done.text
    assert codes.by_code("TRYPRO").disabled_at is not None
    assert "promo.code.disable" in [row["action"] for row in _promo_env.audit]
    # Disabled, never deleted: the row is still there for the redemptions that point at it.
    assert len(codes.codes(limit=10)) == 1
    assert client.post(REDEEM, json={"code": "TRYPRO"}, headers=_bearer(LEARNER)).status_code == 404


def test_the_desk_lists_codes_with_their_use_counts(
    client: TestClient, _promo_env: InMemoryAdminStore, codes: InMemoryPromoStore
) -> None:
    codes.insert_code(_code(code="TRYPRO", max_uses=2))
    assert client.post(REDEEM, json={"code": "TRYPRO"}, headers=_bearer(LEARNER)).status_code == 200
    read = client.get(DESK, headers=_seat(client, _promo_env, VIEWER_SUBJECT, VIEWER))
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["readable"] is True
    row = next(entry for entry in body["codes"] if entry["code"] == "TRYPRO")
    assert row["uses"] == 1
    assert row["max_uses"] == 2
    assert row["live"] is True
    # The desk says in one plain line what actually reaches it, exactly as the four queues do.
    assert body["feed"]["what"]
    assert body["feed"]["feeds"]


def test_the_redemptions_desk_never_shows_a_learner_id(
    client: TestClient, _promo_env: InMemoryAdminStore, codes: InMemoryPromoStore
) -> None:
    codes.insert_code(_code(code="TRYPRO"))
    assert client.post(REDEEM, json={"code": "TRYPRO"}, headers=_bearer(LEARNER)).status_code == 200
    read = client.get(
        REDEMPTIONS,
        params={"code": "TRYPRO"},
        headers=_seat(client, _promo_env, VIEWER_SUBJECT, VIEWER),
    )
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["readable"] is True
    assert len(body["redemptions"]) == 1
    row = body["redemptions"][0]
    assert row["handle"] and row["handle"] != "—"
    assert LEARNER not in read.text
    assert "learner_id" not in row


def test_an_unreachable_store_makes_the_desk_say_so_rather_than_show_nothing(
    client: TestClient, _promo_env: InMemoryAdminStore
) -> None:
    promo.set_store(UnconfiguredPromoStore())
    read = client.get(DESK, headers=_seat(client, _promo_env, VIEWER_SUBJECT, VIEWER))
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["readable"] is False
    assert body["codes"] == []


def test_every_promo_route_is_behind_the_admin_door(client: TestClient) -> None:
    """The desk hangs off ``admin_router``, so it is guarded by construction and unpublished."""
    from wobo_gateway.admin_auth import (
        UNGUARDED_BY_DESIGN,
        iter_api_routes,
        schema_visible_admin_routes,
        unguarded_admin_routes,
    )

    loose = [r for r in unguarded_admin_routes(client.app) if r not in UNGUARDED_BY_DESIGN]
    assert loose == []
    assert schema_visible_admin_routes(client.app) == []
    # And the four promo paths are actually mounted, so the two assertions above are about them
    # rather than about an empty set.
    mounted = {path for path, _route, _inherited in iter_api_routes(client.app)}
    assert {DESK, CREATE, DISABLE, REDEMPTIONS} <= mounted
    for path in (DESK, CREATE, DISABLE, REDEMPTIONS):
        answer = client.get(path) if path in (DESK, REDEMPTIONS) else client.post(path, json={})
        assert answer.status_code in (401, 403, 404, 422)
