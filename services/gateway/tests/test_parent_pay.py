"""A parent paying for a child: the child's row, the parent's money, and no way round the link.

The owner, 2026-09-05: a parent account "get[s] to pay for the subscriptions" of the children who
linked it, and nothing else. So the checkout gains one field, ``for_learner``, and three things are
held here, all at the endpoint and none in a UI:

* the subscription a parent opens is the CHILD's: the provider's notes name the child as the
  learner (so the webhook lands on the child's row, unchanged) and the parent as the payer;
* the child named in the body must be the child this parent has SELECTED, re-checked against the
  live consent on the same request. A student account, a child who never linked, a child whose
  link ended, and a child who is linked but not the one on screen are all refused before any
  provider call. It must never be possible to pay for an unlinked child;
* the parent's side of "Your plan" shows the child's plan, and the two-tap cancel works only on a
  plan THIS parent paid for. A plan the child or somebody else paid for is not the parent's to end.

The provider is the fake from ``test_razorpay``; no key is live and no money moves.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import mint
from fastapi.testclient import TestClient
from test_razorpay import FakeRazorpay, deliver, event, with_plans
from wobo_gateway import billing, parents
from wobo_gateway import parent_account as accounts
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.billing import InMemorySubscriptionStore, payments, razorpay, records
from wobo_gateway.billing.records import InMemoryBillingRecords
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

CHECKOUT = "/v1/billing/checkout"
PLAN = "/v1/parent/plan"
CANCEL = "/v1/parent/plan/cancel"

PARENT = "parent-who-pays"
PARENT_EMAIL = "paying.parent@example.test"
CHILD = "child-one"
SIBLING = "child-two"
STRANGER_CHILD = "somebody-elses-child"
WEBHOOK_SECRET = "a-webhook-secret-for-the-suite"


@pytest.fixture(autouse=True)
def _stores() -> Any:
    parents.set_store(parents.InMemoryParentLinkStore())
    accounts.set_store(accounts.InMemoryParentStore())
    yield
    parents.set_store(None)
    accounts.set_store(None)


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_notarealkey")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "not-a-real-secret")
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    fake = FakeRazorpay()
    razorpay.set_client(fake)
    yield fake
    razorpay.set_client(None)


@pytest.fixture
def store() -> Any:
    fresh = InMemorySubscriptionStore()
    billing.set_store(fresh)
    yield fresh
    billing.set_store(None)


@pytest.fixture
def ledger() -> Any:
    fresh = InMemoryBillingRecords()
    records.set_store(fresh)
    yield fresh
    records.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def auth(subject: str, email: str | None = None) -> dict[str, str]:
    claims: dict[str, Any] = {"email": email, "email_verified": True} if email else {}
    return {"Authorization": f"Bearer {mint(subject, **claims)}"}


PARENT_AUTH = auth(PARENT, PARENT_EMAIL)


def link(learner_id: str, name: str = "Learner", email: str = PARENT_EMAIL) -> None:
    from datetime import UTC, datetime

    digest = parents.email_hash(email)
    assert digest is not None
    now = datetime.now(UTC)
    parents.get_store().insert(
        parents.ParentLink(
            id=f"link-{learner_id}",
            learner_id=learner_id,
            parent_email_hash=digest,
            parent_email=email,
            learner_name=name,
            timezone="Asia/Kolkata",
            status="linked",
            invited_at=now,
            linked_at=now,
        )
    )


def a_family(client: TestClient, *children: str, choose: str | None = CHILD) -> None:
    for learner in children or (CHILD,):
        link(learner, name=learner.split("-")[-1].title())
    res = client.post("/v1/parent/sign-up", json={"display_name": "Parent"}, headers=PARENT_AUTH)
    assert res.status_code == 200, res.text
    if choose:
        chosen = client.post("/v1/parent/switch", json={"learner_id": choose}, headers=PARENT_AUTH)
        assert chosen.status_code == 200, chosen.text


def pay(client: TestClient, for_learner: str | None, headers: dict[str, str] = PARENT_AUTH) -> Any:
    body: dict[str, Any] = {"plan": "pro", "period": "yearly"}
    if for_learner is not None:
        body["for_learner"] = for_learner
    return client.post(CHECKOUT, json=body, headers=headers)


def creates(provider: FakeRazorpay) -> list[dict[str, Any]]:
    return [b for n, b in provider.calls if n == "create_subscription"]


def cancels(provider: FakeRazorpay) -> list[dict[str, Any]]:
    return [b for n, b in provider.calls if n == "cancel_subscription"]


# --- the checkout ----------------------------------------------------------------------------
def test_a_parent_opens_a_checkout_on_the_childs_row_with_themselves_as_payer(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    res = pay(client, CHILD)
    assert res.status_code == 200, res.text
    assert res.json()["amount_display"] == "₹19,992 billed annually"

    sent = creates(provider)
    assert len(sent) == 1
    notes = sent[0]["notes"]
    assert notes["wobo_learner_id"] == CHILD
    assert notes["wobo_payer_id"] == PARENT
    # Nothing flips on checkout, for the child or for the parent.
    assert store.get(CHILD) is None and store.get(PARENT) is None
    # The ledger's open checkout is the child's, so "one payable subscription" holds per child.
    rows = ledger.recent(10)
    assert [(r.kind, r.learner_id) for r in rows] == [("checkout", CHILD)]
    # And the parent plane has the trail.
    trail = accounts.get_store().trail
    row = next(r for r in trail if r["action"] == "pay.checkout")
    assert row["learner_id"] == CHILD and row["decision"] == "allowed"


def test_a_student_account_cannot_pay_for_anybody(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    link(CHILD)
    res = pay(client, CHILD, headers=auth("a-student-account", "student@example.test"))
    assert res.status_code == 403, res.text
    assert res.json()["detail"]["code"] == "not_a_parent_account"
    assert creates(provider) == []


def test_a_parent_can_never_pay_for_a_child_who_has_not_linked_them(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    # Somebody else's child, linked to somebody else.
    link(STRANGER_CHILD, email="another.parent@example.test")
    res = pay(client, STRANGER_CHILD)
    assert res.status_code == 404, res.text
    assert res.json()["detail"]["code"] == "no_such_child"
    assert creates(provider) == []
    denied = [r for r in accounts.get_store().trail if r["decision"] == "denied"]
    assert any(r["action"] == "pay.checkout" for r in denied)


def test_a_linked_child_who_is_not_the_one_chosen_is_not_paid_for(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    """Two children, the screen went stale after a switch: the body names the other one. The
    server's selection is the truth, so the payment waits for the parent to choose again."""
    with_plans(ledger)
    a_family(client, CHILD, SIBLING, choose=CHILD)
    res = pay(client, SIBLING)
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "no_child_selected"
    assert creates(provider) == []


def test_a_revoked_link_stops_the_payment_at_the_very_next_request(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    ended = client.delete("/v1/me/parent-link", headers=auth(CHILD))
    assert ended.status_code == 200, ended.text
    res = pay(client, CHILD)
    assert res.status_code in (404, 409), res.text
    assert creates(provider) == []


def test_a_parent_account_cannot_buy_a_plan_for_nobody(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    """A parent account never learns, so a plan on the parent's own row is money for nothing."""
    with_plans(ledger)
    a_family(client)
    res = pay(client, None)
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "no_child_selected"
    assert creates(provider) == []


def test_a_learner_checkout_is_exactly_what_it_was(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    res = pay(client, None, headers=auth("a-learner"))
    assert res.status_code == 200, res.text
    notes = creates(provider)[0]["notes"]
    assert notes["wobo_learner_id"] == "a-learner"
    assert "wobo_payer_id" not in notes


def test_a_child_already_on_a_plan_is_not_paid_for_twice(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    first = pay(client, CHILD).json()
    deliver(
        client,
        event(
            "subscription.activated",
            learner=CHILD,
            sub_id=first["subscription_id"],
            period="yearly",
        ),
    )
    again = pay(client, CHILD)
    assert again.status_code == 409, again.text
    assert again.json()["detail"]["code"] == "already_subscribed"
    assert len(creates(provider)) == 1


def test_payments_off_is_said_to_a_parent_too(client: TestClient, store: Any, ledger: Any) -> None:
    a_family(client)
    res = pay(client, CHILD)
    assert res.status_code == 503, res.text
    assert res.json()["detail"]["code"] == "payments_off"


def test_the_for_learner_field_is_part_of_the_checkout_body() -> None:
    assert "for_learner" in payments.CheckoutBody.model_fields


# --- the child's plan, on the parent's side ------------------------------------------------------
def _paid_by_parent(client: TestClient, provider: FakeRazorpay) -> str:
    sub_id = pay(client, CHILD).json()["subscription_id"]
    notes = creates(provider)[-1]["notes"]
    res = deliver(
        client,
        event(
            "subscription.activated",
            learner=CHILD,
            sub_id=sub_id,
            period="yearly",
            notes=notes,
        ),
    )
    assert res.status_code == 200, res.text
    return sub_id


def test_the_parent_reads_the_childs_plan_and_may_end_what_they_paid_for(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    free = client.get(PLAN, headers=PARENT_AUTH)
    assert free.status_code == 200, free.text
    assert free.json()["child"]["learner_id"] == CHILD
    assert free.json()["plan"]["status"] == "free"

    sub_id = _paid_by_parent(client, provider)
    body = client.get(PLAN, headers=PARENT_AUTH).json()
    plan = body["plan"]
    assert plan["status"] == "active" and plan["plan"] == "pro"
    assert plan["renews"] is True and plan["period_end"]
    assert body["paid_by_you"] is True and plan["can_cancel"] is True
    # The server's lines speak to the learner ("Your plan"), so none of them reach a parent.
    assert "line" not in plan and "confirm" not in plan

    ended = client.post(CANCEL, headers=PARENT_AUTH)
    assert ended.status_code == 200, ended.text
    assert ended.json()["plan"]["status"] == "cancelling"
    assert cancels(provider) == [{"id": sub_id, "cancel_at_cycle_end": True}]
    row = store.get(CHILD)
    assert row is not None and row.status == "cancelled"
    actions = [r["action"] for r in accounts.get_store().trail]
    assert "pay.plan.read" in actions and "pay.cancel" in actions


def test_a_plan_somebody_else_paid_for_is_not_the_parents_to_end(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    # The child paid on their own account: no payer in the notes.
    own = client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=auth(CHILD))
    assert own.status_code == 200, own.text
    sub_id = own.json()["subscription_id"]
    deliver(
        client,
        event(
            "subscription.activated",
            learner=CHILD,
            sub_id=sub_id,
            notes=creates(provider)[-1]["notes"],
        ),
    )
    body = client.get(PLAN, headers=PARENT_AUTH).json()
    assert body["plan"]["status"] == "active"
    assert body["paid_by_you"] is False and body["plan"]["can_cancel"] is False

    res = client.post(CANCEL, headers=PARENT_AUTH)
    assert res.status_code == 403, res.text
    assert res.json()["detail"]["code"] == "not_the_payer"
    assert "—" not in res.json()["detail"]["message"]
    assert cancels(provider) == []
    row = store.get(CHILD)
    assert row is not None and row.status == "active"


def test_nothing_to_end_on_a_free_child(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    res = client.post(CANCEL, headers=PARENT_AUTH)
    assert res.status_code == 404, res.text
    assert cancels(provider) == []


def test_the_plan_routes_are_behind_the_parent_door(client: TestClient, store: Any) -> None:
    student = auth("a-student-account", "student@example.test")
    assert client.get(PLAN, headers=student).status_code == 403
    assert client.post(CANCEL, headers=student).status_code == 403
    # A parent with nobody chosen is asked to choose.
    a_family(client, choose=None)
    assert client.get(PLAN, headers=PARENT_AUTH).status_code == 409


def test_the_parent_plan_read_works_with_payments_off(client: TestClient, store: Any) -> None:
    a_family(client)
    res = client.get(PLAN, headers=PARENT_AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["plan"]["status"] == "free"
    assert res.json()["payments"] == "off"


def test_the_four_actions_are_still_the_whole_of_it() -> None:
    assert accounts.PARENT_ACTIONS == ("ask", "pay", "refer", "donate")


# --- whose checkout is offered again (fixer, 2026-09-17) -----------------------------------------
def _activate(client: TestClient, provider: FakeRazorpay, sub_id: str, period: str) -> None:
    notes = next(s for s in provider.subscriptions if s["id"] == sub_id)["notes"]
    res = deliver(
        client,
        event("subscription.activated", learner=CHILD, sub_id=sub_id, period=period, notes=notes),
    )
    assert res.status_code == 200, res.text


def test_a_checkout_the_parent_abandoned_is_not_handed_to_the_child(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    """The open checkout was reused by learner alone, so a child pressing pay got the parent's
    subscription, whose notes name the parent as payer. The child paid; the parent could end it."""
    with_plans(ledger)
    a_family(client)
    parents_sub = pay(client, CHILD).json()["subscription_id"]
    own = client.post(CHECKOUT, json={"plan": "pro", "period": "yearly"}, headers=auth(CHILD))
    assert own.status_code == 200, own.text
    childs_sub = own.json()["subscription_id"]
    assert childs_sub != parents_sub
    assert "wobo_payer_id" not in creates(provider)[-1]["notes"]

    _activate(client, provider, childs_sub, "yearly")
    body = client.get(PLAN, headers=PARENT_AUTH).json()
    assert body["paid_by_you"] is False
    res = client.post(CANCEL, headers=PARENT_AUTH)
    assert res.status_code == 403, res.text
    assert cancels(provider) == []


def test_a_checkout_the_child_abandoned_is_not_handed_to_the_parent(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    with_plans(ledger)
    a_family(client)
    own = client.post(CHECKOUT, json={"plan": "pro", "period": "yearly"}, headers=auth(CHILD))
    childs_sub = own.json()["subscription_id"]
    opened = pay(client, CHILD)
    assert opened.status_code == 200, opened.text
    parents_sub = opened.json()["subscription_id"]
    assert parents_sub != childs_sub
    assert creates(provider)[-1]["notes"]["wobo_payer_id"] == PARENT

    _activate(client, provider, parents_sub, "yearly")
    assert client.get(PLAN, headers=PARENT_AUTH).json()["paid_by_you"] is True
    assert client.post(CANCEL, headers=PARENT_AUTH).status_code == 200


def test_each_payer_still_gets_their_own_open_checkout_back(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    """Reuse itself is kept: one payer pressing pay twice is offered the one subscription."""
    with_plans(ledger)
    a_family(client)
    first = pay(client, CHILD).json()["subscription_id"]
    again = pay(client, CHILD).json()["subscription_id"]
    assert first == again and len(creates(provider)) == 1


def test_a_plan_the_child_already_ended_is_still_not_the_parents(
    client: TestClient, provider: FakeRazorpay, store: Any, ledger: Any
) -> None:
    """The payer check was skipped for a cancelled row, so the parent's cancel answered 200 with
    ``paid_by_you: True`` and recorded a cancel for a plan they never paid for."""
    with_plans(ledger)
    a_family(client)
    own = client.post(CHECKOUT, json={"plan": "pro", "period": "monthly"}, headers=auth(CHILD))
    sub_id = own.json()["subscription_id"]
    _activate(client, provider, sub_id, "monthly")
    assert client.post("/v1/me/subscription/cancel", headers=auth(CHILD)).status_code == 200
    row = store.get(CHILD)
    assert row is not None and row.status == "cancelled"
    before = len(cancels(provider))

    res = client.post(CANCEL, headers=PARENT_AUTH)
    assert res.status_code == 403, res.text
    assert res.json()["detail"]["code"] == "not_the_payer"
    assert len(cancels(provider)) == before
