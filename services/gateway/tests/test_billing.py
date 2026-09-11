"""The cancel, driven through the real app with the real door.

The plans page already promises this in the learner's own words — "You → Your plan → Cancel. Two
taps, no call, no 'are you sure' maze. You keep the plan until the month you paid for ends" — and
there are no refunds, so it is the only door out. Every requirement in that sentence is a test
here: nothing taken away early, nothing charged after, everything learnt kept, reversible before
the period ends, idempotent, honest under failure, and a store subscription refused clearly enough
that the app can say where it IS cancelled.

No network: the in-memory store, and the PostgREST store driven through a substituted request.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import TEST_SUBJECT, mint
from fastapi.testclient import TestClient
from wobo_gateway import app as app_mod
from wobo_gateway import billing, budget, consent
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.billing import (
    InMemorySubscriptionStore,
    PostgrestSubscriptionStore,
    Refused,
    StoreUnavailable,
    Subscription,
)
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import ConsentTier
from wobo_gateway.telemetry import MetricsSink

PLAN = "/v1/me/subscription"
CANCEL = "/v1/me/subscription/cancel"
RESUME = "/v1/me/subscription/resume"
ME = "/v1/me"

#: What the app's own parser accepts (apps/web-pwa/src/screens/you/billing.ts).
APP_STATES = {"free", "active", "cancelling", "ended"}
APP_SOURCES = {"web", "app_store", "play_store"}

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
DAY = timedelta(days=1)


@pytest.fixture
def store() -> Any:
    fresh = InMemorySubscriptionStore()
    billing.set_store(fresh)
    yield fresh
    billing.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def seed(
    store: InMemorySubscriptionStore,
    *,
    learner: str = TEST_SUBJECT,
    plan: str = "pro",
    status: str = "active",
    origin: str = "web",
    ends: datetime | None = None,
    cancelled_at: datetime | None = None,
) -> Subscription:
    sub = Subscription(
        id=f"sub-{learner}",
        learner_id=learner,
        plan=plan,
        status=status,
        origin=origin,
        current_period_end=ends or (datetime.now(UTC) + 30 * DAY),
        started_at=datetime.now(UTC) - DAY,
        cancelled_at=cancelled_at,
    )
    return store.insert(sub)


# --- the meter follows the record -----------------------------------------------------------------
def test_a_cancelled_plan_meters_at_the_paid_rate_the_day_before_and_free_the_day_after() -> None:
    """The requirement in one test: nothing is taken away early, and nothing renews after.

    No cron and no sweep touches this — the plan is derived from the period end at read time, so
    the allowance changes by itself as the clock passes it.
    """
    ends = NOW
    sub = Subscription(
        id="sub-1",
        learner_id="learner-1",
        plan="pro",
        status="cancelled",
        origin="web",
        current_period_end=ends,
        started_at=ends - 30 * DAY,
        cancelled_at=ends - 3 * DAY,
    )

    before, after = ends - DAY, ends + DAY
    assert billing.effective_plan(sub, now=before) == "pro"
    assert billing.effective_plan(sub, now=after) == "free"

    # …and the meter that reads it hands out the two different allowances.
    assert budget.limits_for(billing.effective_plan(sub, now=before)) == budget.limits_for("pro")
    assert budget.limits_for(billing.effective_plan(sub, now=after)) == budget.limits_for("free")
    assert budget.limits_for("pro")[budget.TURN] > budget.limits_for("free")[budget.TURN]


def test_an_active_plan_whose_period_has_passed_is_free_too() -> None:
    """A renewal is a write to this row. Until it lands there is no evidence anyone paid for
    today, and budget.py's rule holds: never hand out an allowance nobody paid for."""
    lapsed = Subscription(
        id="sub-2",
        learner_id="learner-2",
        plan="max",
        status="active",
        origin="web",
        current_period_end=NOW,
        started_at=NOW - 30 * DAY,
    )
    assert billing.effective_plan(lapsed, now=NOW - DAY) == "max"
    assert billing.effective_plan(lapsed, now=NOW + DAY) == "free"


def test_no_subscription_keeps_the_plan_on_the_profile() -> None:
    assert billing.effective_plan(None) == "free"
    assert billing.effective_plan(None, fallback="plus") == "plus"


def test_the_gateway_meters_a_signed_in_learner_on_their_subscription(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    """/v1/me is the number the client renders, so it is the number that has to move."""
    free = client.get(ME, headers=auth()).json()
    assert free["plan"] == "free"

    seed(store, plan="max", ends=datetime.now(UTC) + DAY)
    billing.reset_cache()
    paid = client.get(ME, headers=auth()).json()
    assert paid["plan"] == "max"
    assert paid["budget"]["turns_remaining"] > free["budget"]["turns_remaining"]


def test_the_allowance_falls_back_the_day_after_the_period_ends(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    seed(store, plan="pro", status="cancelled", ends=datetime.now(UTC) - DAY, cancelled_at=NOW)
    billing.reset_cache()
    body = client.get(ME, headers=auth()).json()
    assert body["plan"] == "free"
    assert body["budget"]["turns_remaining"] == budget.limits_for("free")[budget.TURN]


def test_a_capability_call_is_charged_at_the_subscription_rate(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    seed(store, plan="pro", ends=datetime.now(UTC) + DAY)
    billing.reset_cache()
    res = client.post(
        "/v1/capability/wobo.turn", json={"payload": {"say": "hello"}}, headers=auth()
    )
    assert res.status_code == 200
    remaining = int(res.headers["X-Wobo-Budget-Remaining"])
    assert remaining == budget.limits_for("pro")[budget.TURN] - 1


def test_the_voice_meter_follows_the_subscription_too(
    client: TestClient,
    auth: Any,
    store: InMemorySubscriptionStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Voice is a paid API and charges the meter in its own place. A plan that lifted the
    capability route and not this one would cut a paying learner off mid-sentence."""
    monkeypatch.setattr(
        "wobo_gateway.plexus.media.synthesize_narration",
        lambda text, *, instruction=None, **_: {"mime": "audio/wav", "b64": "AAAA"},
    )
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-one")
    monkeypatch.setenv("FREE_DAILY_TURNS", "1")
    monkeypatch.setenv("PRO_DAILY_TURNS", "5")
    seed(store, plan="pro", ends=datetime.now(UTC) + DAY)
    billing.reset_cache()

    line = {"text": "Here."}
    assert client.post("/v1/voice/tts", json=line, headers=auth()).status_code == 200
    # The second one is past the FREE allowance and well inside the paid one.
    assert client.post("/v1/voice/tts", json=line, headers=auth()).status_code == 200


def test_an_anonymous_learner_is_never_lifted_by_anyone_elses_plan(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    seed(store, learner="anon-device", plan="max", ends=datetime.now(UTC) + DAY)
    billing.reset_cache()
    body = client.get(ME, headers=auth("anon-device", anonymous=True)).json()
    assert body["plan"] == "free"
    assert body["budget"]["turns_remaining"] == budget.limits_for("free", anonymous=True)[
        budget.TURN
    ]


def test_an_unreachable_store_leaves_the_learner_on_the_plan_their_profile_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Our outage must not cut a paying learner's allowance; it degrades to the stored plan."""

    class Broken:
        def get(self, learner_id: str) -> Subscription | None:
            raise StoreUnavailable("down")

    billing.set_store(Broken())  # type: ignore[arg-type]
    try:
        assert billing.plan_for("learner-3", fallback="plus") == "plus"
        assert billing.plan_for("learner-3") == "free"
    finally:
        billing.set_store(None)


def test_the_cached_row_is_still_read_against_the_current_clock(
    store: InMemorySubscriptionStore,
) -> None:
    """The row is cached, never the answer — otherwise a plan cached a minute before its period
    ends would keep metering as paid for the rest of the cache's five minutes."""
    seed(store, learner="learner-4", plan="pro", ends=NOW)
    assert billing.plan_for("learner-4", now=NOW - DAY) == "pro"
    assert billing.plan_for("learner-4", now=NOW + DAY) == "free"


# --- the door -------------------------------------------------------------------------------------
def test_every_route_is_behind_the_door(client: TestClient, auth: Any) -> None:
    assert client.get(PLAN).status_code == 401
    assert client.post(CANCEL).status_code == 401
    assert client.post(RESUME).status_code == 401
    anon = auth("anon-device", anonymous=True)
    assert client.get(PLAN, headers=anon).json()["status"] == "free"
    for path in (CANCEL, RESUME):
        refused = client.post(path, headers=anon)
        assert refused.status_code == 403
        assert refused.json()["detail"]["code"] == "sign_in_required"


def test_the_routes_are_limited_but_never_metered(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    """Reading or ending what you pay for never costs a turn — and is still bounded per caller."""
    assert {PLAN, CANCEL, RESUME} >= billing.LIMITED_PATHS
    assert app_mod.BILLING_LIMITED_PATHS >= billing.LIMITED_PATHS
    seed(store)
    before = client.get(ME, headers=auth()).json()["budget"]["turns_remaining"]
    client.get(PLAN, headers=auth())
    client.post(CANCEL, headers=auth())
    after = client.get(ME, headers=auth()).json()["budget"]["turns_remaining"]
    assert after == before


def test_a_learner_can_never_reach_another_learners_subscription(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    """There is no learner id in a path, a query or a body — the door's subject is the only key."""
    mine = seed(store, learner="learner-a", plan="pro")
    stranger = auth("learner-b")

    assert client.get(PLAN, headers=stranger).json()["status"] == "free"
    refused = client.post(CANCEL, headers=stranger, json={"learner_id": "learner-a"})
    assert refused.status_code == 404
    # Nothing of the other learner's moved.
    assert store.get("learner-a") == mine


# --- the cancel -----------------------------------------------------------------------------------
def test_cancel_keeps_the_plan_to_the_end_of_the_period_and_stops_the_renewal(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    ends = datetime.now(UTC) + 20 * DAY
    seed(store, plan="pro", ends=ends)

    res = client.post(CANCEL, headers=auth())
    assert res.status_code == 200
    body = res.json()
    assert body["cancelled"] is True
    assert body["status"] == "cancelling"
    assert body["cancel_at_period_end"] is True
    # A cancelled row is charged no more, whatever it was before: `renews` is the fact, and it is
    # false the moment the cancel lands. (This assertion used to be `"renews" not in body`, from
    # the days before `billing/plans.py` created subscriptions the provider charges on its own.)
    assert body["renews"] is False
    assert body["plan"] == "pro"
    # Nothing taken away early: the meter is still the paid one until the period ends.
    assert body["effective_plan"] == "pro"
    assert body["period_end"] == ends.isoformat()
    assert client.get(ME, headers=auth()).json()["plan"] == "pro"

    row = store.get(TEST_SUBJECT)
    assert row is not None and row.status == "cancelled" and row.current_period_end == ends
    assert row.cancelled_at is not None


def test_cancel_is_idempotent_and_never_moves_the_end_date(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    ends = datetime.now(UTC) + 10 * DAY
    seed(store, ends=ends)

    first = client.post(CANCEL, headers=auth()).json()
    again = client.post(CANCEL, headers=auth()).json()
    assert first["period_end"] == again["period_end"] == ends.isoformat()
    assert again["status"] == "cancelling" and again["cancelled"] is True
    row = store.get(TEST_SUBJECT)
    assert row is not None and row.current_period_end == ends


def test_cancelling_nothing_says_so_rather_than_pretending(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    res = client.post(CANCEL, headers=auth())
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "no_subscription"


def test_a_store_subscription_is_refused_clearly_enough_to_show_the_right_instruction(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    """We cannot cancel in a store we do not own, so we say where it is done — never a generic
    failure, and never a claim that it was cancelled."""
    seed(store, origin="ios")
    res = client.post(CANCEL, headers=auth())
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "store_managed"
    assert detail["source"] == "app_store"
    assert "cancelled" in detail["message"] and "phone" in detail["message"]
    assert store.get(TEST_SUBJECT).status == "active"  # untouched

    view = client.get(PLAN, headers=auth()).json()
    assert view["can_cancel"] is False and view["source"] == "app_store"

    store.forget(TEST_SUBJECT)
    seed(store, origin="android")
    billing.reset_cache()
    assert client.post(CANCEL, headers=auth()).json()["detail"]["source"] == "play_store"


def test_a_cancel_that_did_not_land_says_the_plan_is_unchanged(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Never "cancelled" for a cancel that did not happen."""

    class Failing(InMemorySubscriptionStore):
        def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None:
            raise StoreUnavailable("the write did not land")

    failing = Failing()
    billing.set_store(failing)
    try:
        seed(failing)
        res = client.post(CANCEL, headers=auth())
        assert res.status_code == 503
        detail = res.json()["detail"]
        assert detail["code"] == "store_unavailable"
        assert "Nothing has changed" in detail["message"]
        assert "cancelled" not in detail["message"].lower()
        assert failing.get(TEST_SUBJECT).status == "active"
    finally:
        billing.set_store(None)


def test_a_write_that_touches_no_row_is_not_reported_as_a_cancel() -> None:
    """A store that answers "nothing updated" is a failure, not a success."""

    class Silent(InMemorySubscriptionStore):
        def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None:
            return None

    store = Silent()
    seed(store)
    with pytest.raises(StoreUnavailable):
        billing.cancel(store, TEST_SUBJECT)


# --- the resume -----------------------------------------------------------------------------------
def test_a_cancel_is_reversible_in_one_tap_while_the_period_runs(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    ends = datetime.now(UTC) + 5 * DAY
    seed(store, plan="max", ends=ends)

    cancelled = client.post(CANCEL, headers=auth()).json()
    assert cancelled["can_resume"] is True

    res = client.post(RESUME, headers=auth())
    assert res.status_code == 200
    body = res.json()
    assert body["resumed"] is True
    assert body["status"] == "active"
    # Resumed, and no provider behind this row: it runs to the day paid for and is charged no more.
    assert body["renews"] is False
    assert body["cancel_at_period_end"] is False
    assert body["period_end"] == ends.isoformat()
    row = store.get(TEST_SUBJECT)
    assert row is not None and row.status == "active" and row.cancelled_at is None


def test_resume_is_idempotent_and_refuses_a_period_that_has_ended(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    seed(store, ends=datetime.now(UTC) + DAY)
    assert client.post(RESUME, headers=auth()).json()["status"] == "active"  # already running

    store.forget(TEST_SUBJECT)
    seed(store, status="cancelled", ends=datetime.now(UTC) - DAY, cancelled_at=NOW)
    billing.reset_cache()
    res = client.post(RESUME, headers=auth())
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "period_ended"
    assert store.get(TEST_SUBJECT).status == "cancelled"


# --- what the screen is handed --------------------------------------------------------------------
def test_the_body_is_the_shape_the_app_already_parses(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    """apps/web-pwa/src/screens/you/billing.ts reads status, plan, period_end and source. A body
    it cannot parse is drawn as "I could not read your plan", so the vocabulary is a contract."""
    for body in (
        client.get(PLAN, headers=auth()).json(),  # free
        (seed(store, ends=datetime.now(UTC) + DAY), client.get(PLAN, headers=auth()).json())[1],
        client.post(CANCEL, headers=auth()).json(),
        client.post(RESUME, headers=auth()).json(),
    ):
        assert body["status"] in APP_STATES, body["status"]
        assert body["source"] in APP_SOURCES, body["source"]
        assert isinstance(body["plan"], str) and body["plan"]
        assert isinstance(body["line"], str) and body["line"]


def test_the_view_offers_a_cancel_only_where_a_cancel_would_work(
    store: InMemorySubscriptionStore,
) -> None:
    running = datetime.now(UTC) + DAY
    active = seed(store, ends=running)
    view = billing.plan_view(active)
    assert view["can_cancel"] is True and view["can_resume"] is False
    assert view["confirm"] == billing.CONFIRM

    ended = billing.plan_view(seed(store, learner="l2", ends=datetime.now(UTC) - DAY))
    assert ended["status"] == "ended"
    assert ended["can_cancel"] is False and ended["can_resume"] is False
    assert "confirm" not in ended


def test_the_view_says_whether_the_card_is_charged_again(
    store: InMemorySubscriptionStore,
) -> None:
    """``billing/plans.py`` creates every subscription with a ``total_count`` — five years, or
    sixty months — so a provider-backed row IS charged again on ``period_end``, on its own, until
    somebody cancels. Not one surface a payer read said so: the checkout consent box said "I am
    paying for a year" and the plan card said "Your plan runs until 7 September 2027." and stopped.

    A screen cannot work this out: an operator's grant and a bought subscription are the same shape
    from the app. So the body answers it, and only where it is true."""
    running = datetime.now(UTC) + DAY

    bought = store.insert(
        Subscription(
            id="sub-bought",
            learner_id="l-bought",
            plan="pro",
            status="active",
            origin="web",
            current_period_end=running,
            started_at=datetime.now(UTC) - DAY,
            razorpay_subscription_id="sub_XYZ",
        )
    )
    assert billing.plan_view(bought)["renews"] is True

    # cancelled at the provider: it runs to the day paid for and is charged no more
    stopped = store.update("l-bought", {"status": "cancelled"})
    assert stopped is not None
    view = billing.plan_view(stopped)
    assert view["status"] == "cancelling" and view["renews"] is False

    # an operator's grant, with no provider behind it, simply runs out
    granted = seed(store, learner="l-granted", ends=running)
    assert billing.plan_view(granted)["renews"] is False

    # a plan bought in a store renews in that store, and that store's words say so, not ours
    from_store = store.insert(
        Subscription(
            id="sub-store",
            learner_id="l-store",
            plan="pro",
            status="active",
            origin="ios",
            current_period_end=running,
            started_at=datetime.now(UTC) - DAY,
            razorpay_subscription_id="sub_ABC",
        )
    )
    assert billing.plan_view(from_store)["renews"] is False

    # and a learner with no row at all is never told anything renews
    assert billing.plan_view(None)["renews"] is False
    assert billing.plan_view(None, profile_plan="plus")["renews"] is False


def test_a_paid_plan_with_no_record_is_admitted_rather_than_pretended(
    client: TestClient, auth: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A plan set on the profile before this table existed: we can neither show its period nor end
    it, so we say exactly that and name the one mailbox."""
    monkeypatch.setattr(
        consent,
        "fetch_profile",
        lambda subject: consent.Profile(tier=ConsentTier.UN_ELEVATED, plan="plus"),
    )
    consent.reset_cache()
    view = client.get(PLAN, headers=auth()).json()
    assert view["plan"] == "plus" and view["can_cancel"] is False
    assert billing.SUPPORT in view["line"]

    res = client.post(CANCEL, headers=auth())
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "unmanaged" and detail["support"] == billing.SUPPORT


def test_every_line_the_learner_reads_keeps_the_copy_law() -> None:
    """No em dash, no invented person, no grade range, no raw allowance, one mailbox — and the
    two promises the brief demands in words: nothing early, nothing kept back."""
    lines = [*billing._LINES.values(), billing.CONFIRM, billing._STORE_MANAGED, billing._ENDED]
    for line in lines:
        assert "—" not in line and "--" not in line, line
        assert not re.search(r"\d", line.replace(billing.SUPPORT, "")), line
        assert "?" not in line, line  # no "are you sure" anywhere in this module
    mailboxes = {m for line in lines for m in re.findall(r"[\w.+-]+@[\w.-]+", line)}
    assert mailboxes <= {billing.SUPPORT}
    assert "everything you have learnt stays" in billing.CONFIRM.lower()
    assert "nothing is charged after that" in billing.CONFIRM.lower()
    assert "still here" in billing._LINES["ended"].lower()


def test_no_retention_offer_is_put_in_front_of_a_learner_cancelling(
    client: TestClient, auth: Any, store: InMemorySubscriptionStore
) -> None:
    """The owner's ruling: two taps, no discount to stay, no survey, no gauntlet.

    Every word the cancel path can put in front of a learner is scanned, and the path itself is
    one call: the screen shows CONFIRM, the learner taps, and the plan is cancelled. There is no
    second endpoint to walk through and nothing to decline on the way.
    """
    facing = [
        *billing._LINES.values(),
        billing.CONFIRM,
        billing._STORE_MANAGED,
        billing._ENDED,
        billing._UNMANAGED,
        billing._NO_PLAN,
        billing._UNCHANGED,
    ]
    for line in facing:
        low = line.lower()
        for word in ("discount", "survey", "offer", "instead", "before you go", "stay with"):
            assert word not in low, (word, line)

    seed(store, ends=datetime.now(UTC) + DAY)
    body = client.post(CANCEL, headers=auth()).json()
    assert body["cancelled"] is True and body["status"] == "cancelling"


# --- the record itself ----------------------------------------------------------------------------
def test_a_row_without_a_period_end_is_not_a_subscription() -> None:
    """It would otherwise read as "ends now", which silently downgrades someone who has paid."""
    assert billing.from_row({"plan": "pro", "status": "active"}) is None
    good = billing.from_row(
        {"plan": "pro", "status": "active", "current_period_end": "2026-10-04T00:00:00Z"}
    )
    assert good is not None and good.current_period_end.tzinfo is not None


def test_an_unknown_word_never_buys_a_bigger_allowance_or_a_cancel_we_cannot_do() -> None:
    row = {"plan": "enterprise", "origin": "carrier", "current_period_end": "2026-10-04T00:00:00Z"}
    sub = billing.from_row(row)
    assert sub is not None
    assert sub.plan == "plus"  # the smallest paid tier, never the largest
    assert sub.store_managed is True  # and never a cancel we cannot actually perform


def test_one_subscription_per_learner(store: InMemorySubscriptionStore) -> None:
    seed(store)
    with pytest.raises(StoreUnavailable):
        seed(store)


def test_the_postgrest_store_reads_and_writes_only_this_learners_row() -> None:
    seen: list[tuple[str, str, Any]] = []

    def fake(url: str, key: str, method: str, *, body: Any = None, want_rows: bool = True) -> Any:
        seen.append((method, url, body))
        return [
            {
                "id": "row-1",
                "learner_id": "learner-9",
                "plan": "pro",
                "status": "cancelled" if method == "PATCH" else "active",
                "origin": "web",
                "current_period_end": "2026-10-04T00:00:00+00:00",
                "started_at": "2026-09-04T00:00:00+00:00",
            }
        ]

    store = PostgrestSubscriptionStore("https://project.test", "service-key", request=fake)
    assert store.get("learner-9") is not None
    assert store.update("learner-9", {"status": "cancelled"}) is not None
    for _method, url, _body in seen:
        assert "learner_id=eq.learner-9" in url
    # An id that could carry a filter of its own never reaches one.
    with pytest.raises(StoreUnavailable):
        store.get("learner-9&plan=eq.max")


def test_a_store_that_cannot_be_reached_raises_rather_than_answering_free() -> None:
    def broken(*_args: Any, **_kwargs: Any) -> Any:
        raise TimeoutError("no route to host")

    store = PostgrestSubscriptionStore("https://project.test", "k", request=broken)
    with pytest.raises(StoreUnavailable):
        store.get("learner-9")


def test_refused_carries_what_the_app_needs_to_say_the_right_thing() -> None:
    exc = Refused(409, "store_managed", "message", extra={"source": "play_store"})
    assert exc.body() == {"code": "store_managed", "message": "message", "source": "play_store"}


# --- a store that was never configured is not a learner who is free -------------------------------
def test_an_unconfigured_deployment_refuses_rather_than_answering_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The failure that would only ever be seen in production, by somebody who paid.

    ``build_store`` used to fall back to the in-memory store whenever SUPABASE_URL or the service
    key was missing. That store is empty at boot and private to one process, so a prod deploy that
    lost the key answered every paying learner ``status: "free"`` on the read and "you are on the
    free plan, so there is nothing to cancel" on the cancel — and said nothing about being
    misconfigured. With no refund behind it that is a trap, so an unconfigured store now raises and
    both routes answer 503 with the plan unchanged.
    """
    for key in (
        "SUBSCRIPTIONS_STORE",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
    ):
        monkeypatch.delenv(key, raising=False)

    built = billing.build_store()
    assert isinstance(built, billing.UnconfiguredSubscriptionStore)
    with pytest.raises(StoreUnavailable):
        built.get(TEST_SUBJECT)
    with pytest.raises(StoreUnavailable):
        built.update(TEST_SUBJECT, {"status": "cancelled"})

    billing.set_store(built)
    try:
        client = TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))
        headers = {"Authorization": f"Bearer {mint(TEST_SUBJECT)}"}
        read = client.get(PLAN, headers=headers)
        assert read.status_code == 503
        assert read.json()["detail"]["code"] == "store_unavailable"
        assert "could not read" in read.json()["detail"]["message"].lower()

        cancelled = client.post(CANCEL, headers=headers)
        assert cancelled.status_code == 503
        assert "nothing has changed" in cancelled.json()["detail"]["message"].lower()
    finally:
        billing.set_store(None)


def test_the_in_memory_store_is_only_ever_asked_for_on_purpose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUBSCRIPTIONS_STORE", "memory")
    assert isinstance(billing.build_store(), InMemorySubscriptionStore)


# --- an unreachable table costs one call a minute, not one a turn ---------------------------------
def test_a_failed_read_is_remembered_so_every_metered_turn_does_not_pay_for_it() -> None:
    """``metered_plan`` is on every charging path. Before this, a store that could not be reached
    was re-asked on EVERY request — one blocking HTTP call of up to five seconds a turn — because
    only successes were cached. consent.get_profile caches its failure for the same reason."""
    calls: list[str] = []

    class Broken:
        def get(self, learner_id: str) -> Subscription | None:
            calls.append(learner_id)
            raise StoreUnavailable("no route to host")

        def insert(self, sub: Subscription) -> Subscription:  # pragma: no cover - unused
            raise StoreUnavailable("no route to host")

        def update(self, learner_id: str, fields: dict[str, Any]) -> Subscription | None:
            raise StoreUnavailable("no route to host")

    billing.set_store(Broken())
    try:
        for _ in range(5):
            # The turn still serves: the plan falls back to the profile row, which is evidence.
            assert billing.plan_for(TEST_SUBJECT, fallback="pro") == "pro"
        assert len(calls) == 1
    finally:
        billing.set_store(None)


def test_the_failed_read_is_forgotten_again_quickly() -> None:
    assert billing._FAIL_TTL_S <= 60.0
    assert billing._FAIL_TTL_S < billing._CACHE_TTL_S


# --- the copy law: no mechanism we cannot show ----------------------------------------------------
def test_no_line_a_learner_reads_claims_a_renewal_or_a_response_time() -> None:
    """Nothing in this repo renews a subscription: there is no payment provider, no webhook and no
    sweep, and ``current_period_end`` has one writer. So no line may say a plan renews. And nothing
    supports a same-day support reply — there is no rota and no SLA — so no line may promise one.
    """
    lines = [
        *billing._LINES.values(),
        billing.CONFIRM,
        billing._NO_PLAN,
        billing._NOTHING_TO_RESUME,
        billing._STORE_MANAGED,
        billing._ENDED,
        billing._UNMANAGED,
        billing._UNCHANGED,
        billing._UNREADABLE,
    ]
    for line in lines:
        assert not re.search(r"\brenew", line, re.I), line
        assert "same day" not in line.lower(), line
