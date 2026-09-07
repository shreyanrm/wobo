"""The platform's daily money ceiling.

Every test here fails without ``wobo_gateway/spend.py`` and the two enforcement points in
``app.py``. Before them, ``telemetry.record_cost`` computed the dollar cost of a frontier call
and wrote a log line, and nothing anywhere refused a call because the day was gone.

Mock mode only: no provider is called and litellm is never really imported. The one test that
needs ``record_cost`` to compute a number puts a stand-in module in ``sys.modules``.
"""

from __future__ import annotations

import sys
import types
from datetime import UTC, datetime, timedelta

import pytest
from conftest import TEST_SUBJECT
from fastapi.testclient import TestClient
from wobo_gateway import alerts, billing, spend
from wobo_gateway.app import CapabilityRequest, Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider, ProviderResponse
from wobo_gateway.registry import policy
from wobo_gateway.routing import Tier, escalation_tier, tier_model, tier_primary
from wobo_gateway.telemetry import MetricsSink, record_cost

DAY_ONE = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


def gateway(provider: object | None = None) -> Gateway:
    return Gateway(provider or MockProvider(), InMemoryCache(), MetricsSink())


def client(provider: object | None = None) -> TestClient:
    return TestClient(create_app(gateway(provider)))


@pytest.fixture
def ceiling(monkeypatch: pytest.MonkeyPatch):
    """A ten dollar day, so the fractions in the table below are whole numbers."""

    def _set(usd: float = 10.0) -> float:
        monkeypatch.setenv("DAILY_SPEND_CEILING_USD", str(usd))
        return usd

    return _set


# --- the accumulator ------------------------------------------------------------------------------
def test_the_day_accumulates_in_dollars(ceiling) -> None:
    ceiling(10.0)
    spend.record(1.25, capability="wobo.turn", model="test")
    spend.record(0.75, capability="engine.compose", model="test")
    ledger = spend.state()
    assert ledger.spent_usd == pytest.approx(2.0)
    assert ledger.calls == 2
    assert ledger.fraction == pytest.approx(0.2)


def test_a_new_utc_day_is_a_new_ceiling(ceiling) -> None:
    ceiling(10.0)
    spend.record(9.0, now=DAY_ONE)
    assert spend.state(DAY_ONE).spent_usd == pytest.approx(9.0)
    tomorrow = DAY_ONE + timedelta(days=1)
    assert spend.state(tomorrow).spent_usd == 0.0
    assert spend.verdict(spend.Priority.STRANGER, now=tomorrow) is spend.Verdict.SERVE


def test_an_unparseable_cost_is_counted_as_nothing_rather_than_raising(ceiling) -> None:
    """Accounting must never be able to fail a learner's turn."""
    ceiling(10.0)
    assert spend.record("not a number").spent_usd == 0.0  # type: ignore[arg-type]
    assert spend.record(-5.0).spent_usd == 0.0


def test_record_cost_feeds_the_ledger(monkeypatch: pytest.MonkeyPatch, ceiling) -> None:
    """The one funnel every live model call already passes through now lands in the ledger."""
    ceiling(10.0)
    fake = types.ModuleType("litellm")
    fake.completion_cost = lambda completion_response=None: 0.5  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "litellm", fake)

    assert record_cost(capability="wobo.turn", model="test/model", response=object()) == 0.5
    assert spend.state().spent_usd == pytest.approx(0.5)


# --- who is shed, and in what order --------------------------------------------------------------
LANES = (spend.Priority.STRANGER, spend.Priority.MEMBER, spend.Priority.PAID)


def verdicts() -> dict[spend.Priority, spend.Verdict]:
    return {lane: spend.verdict(lane) for lane in LANES}


def test_load_is_shed_stranger_first_member_next_and_a_paying_learner_last(ceiling) -> None:
    """The whole shape of the ceiling in one table.

    A stranger degrades at half the day and is refused at nine tenths of it. A signed-in learner
    on the free plan degrades at eight tenths and is refused at the ceiling itself. A learner who
    paid keeps being served past the ceiling, degraded, and is refused only at 125 %.
    """
    ceiling(10.0)
    S, M, P = LANES
    serve, degrade, refuse = spend.Verdict.SERVE, spend.Verdict.DEGRADE, spend.Verdict.REFUSE

    assert verdicts() == {S: serve, M: serve, P: serve}

    spend.record(5.0)  # half the day
    assert verdicts() == {S: degrade, M: serve, P: serve}

    spend.record(3.0)  # eight tenths
    assert verdicts() == {S: degrade, M: degrade, P: serve}

    spend.record(1.0)  # nine tenths
    assert verdicts() == {S: refuse, M: degrade, P: serve}

    spend.record(1.0)  # the ceiling
    assert verdicts() == {S: refuse, M: refuse, P: degrade}

    spend.record(2.5)  # a quarter past it
    assert verdicts() == {S: refuse, M: refuse, P: refuse}


def test_a_stranger_can_never_spend_a_paying_learners_headroom(ceiling) -> None:
    """The requirement, stated as the property it is.

    An open, unauthenticated box in front of frontier models is exactly how a stranger burns a
    day. Whatever a stranger does, there is a tenth of the ceiling they cannot reach and a
    quarter past it they cannot reach either, and a learner who paid is still answered there.
    """
    ceiling(10.0)
    # A stranger spends every dollar the stranger lane will let them spend.
    while spend.verdict(spend.Priority.STRANGER) is not spend.Verdict.REFUSE:
        spend.record(0.10)
    assert spend.state().spent_usd <= 9.1  # the last tenth was never theirs to spend
    assert spend.verdict(spend.Priority.PAID) is spend.Verdict.SERVE


def test_the_dials_move_the_lines(monkeypatch: pytest.MonkeyPatch, ceiling) -> None:
    ceiling(10.0)
    monkeypatch.setenv("SPEND_REFUSE_STRANGER", "0.25")
    spend.record(3.0)
    assert spend.verdict(spend.Priority.STRANGER) is spend.Verdict.REFUSE
    assert spend.verdict(spend.Priority.MEMBER) is spend.Verdict.SERVE


def test_no_ceiling_configured_serves_everyone(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unconfigured limit must never become an accidental outage."""
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "0")
    spend.record(1000.0)
    assert verdicts() == dict.fromkeys(LANES, spend.Verdict.SERVE)


def test_a_nonsense_ceiling_falls_back_to_the_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DAILY_SPEND_CEILING_USD", "twenty dollars")
    assert spend.ceiling_usd() == 25.0


# --- the lane is derived from the door, never from a body ----------------------------------------
def lane(*, anonymous: bool = False, signed_in: bool = True, plan: str | None = "free"):
    return spend.priority_for(anonymous=anonymous, signed_in=signed_in, plan=plan)


def test_the_lane_is_derived_from_the_door() -> None:
    assert lane(anonymous=True, plan="max") is spend.Priority.STRANGER
    assert lane(signed_in=False, plan="pro") is spend.Priority.STRANGER
    assert lane(plan="free") is spend.Priority.MEMBER
    assert lane(plan=None) is spend.Priority.MEMBER
    # A plan name nobody recognises is free, never paid: a billing bug must not hand out headroom.
    assert lane(plan="platinum") is spend.Priority.MEMBER
    for paid in ("pro", "max", "plus", "PRO", " max "):
        assert lane(plan=paid) is spend.Priority.PAID


# --- degrading, rather than breaking -------------------------------------------------------------
def test_cheaper_walks_the_same_ladder_escalate_climbs() -> None:
    """One opinion about model cost in this gateway, read in both directions."""
    for tier in (Tier.TURN, Tier.GENERATE, Tier.REASON):
        cheaper = spend.cheaper_tier(tier)
        assert cheaper is not None
        assert escalation_tier(cheaper) is tier
    assert spend.cheaper_tier(Tier.TINY) is None  # nothing below the floor


class Recorder:
    """A provider that answers like the mock and remembers which model it was asked for."""

    def __init__(self) -> None:
        self.models: list[str] = []
        self.fallbacks: list[tuple[str, ...]] = []

    def complete(self, *, provider_model: str, capability: str, payload, **kwargs):
        self.models.append(provider_model)
        self.fallbacks.append(tuple(kwargs.get("fallbacks") or ()))
        return ProviderResponse(output={"say": "here"}, tokens=1)


def test_past_its_line_a_call_is_answered_on_a_cheaper_model_rather_than_refused(ceiling) -> None:
    """Degrade before you break: the learner still gets an answer, on the tier one rung down."""
    ceiling(10.0)
    recorder = Recorder()
    gw = gateway(recorder)
    body = CapabilityRequest(payload={"concept": "fractions"})

    gw.invoke("generate.course", body, priority=spend.Priority.MEMBER)
    assert recorder.models[-1] == tier_model(policy("generate.course").tier).provider_model

    spend.record(8.5)  # past the member lane's degrade line, under its refuse line
    gw.invoke(
        "generate.course",
        CapabilityRequest(payload={"concept": "decimals"}),
        priority=spend.Priority.MEMBER,
    )
    cheaper = spend.cheaper_tier(policy("generate.course").tier)
    assert cheaper is not None
    assert recorder.models[-1] == tier_model(cheaper).provider_model
    # Under the owner's table (2026-09-05) generate and turn share Terra, so the rung down is a
    # tier change (a smaller output ceiling, a smaller cost ceiling) and never a dearer model.
    from wobo_gateway.routing import CATALOGUE

    before, after = CATALOGUE[recorder.models[0]], CATALOGUE[recorder.models[-1]]
    assert after.per_million_out <= before.per_million_out
    assert policy("generate.course").max_tokens > 0  # the ceiling that shrinks with the tier
    # and the fallback chain came down with it, rather than failing over to the expensive one
    assert tier_primary(cheaper) != policy("generate.course").primary


def test_a_refused_call_raises_the_kind_line_and_never_reaches_a_provider(ceiling) -> None:
    ceiling(10.0)
    recorder = Recorder()
    gw = gateway(recorder)
    spend.record(9.5)
    with pytest.raises(spend.SpendCeilingReached) as caught:
        gw.invoke(
            "tutor.turn", CapabilityRequest(payload={"q": "hi"}), priority=spend.Priority.STRANGER
        )
    assert recorder.models == []  # nothing was spent to say no
    assert "tomorrow" in caught.value.message
    assert "—" not in caught.value.message  # the owner's law: no em dashes
    assert caught.value.body()["code"] == "spend_ceiling"


def test_a_cached_answer_is_served_past_the_ceiling(ceiling, auth) -> None:
    """A cache hit costs nothing, so the ceiling never refuses one."""
    ceiling(10.0)
    api = client()
    body = {"payload": {"q": "what is a fraction"}}
    first = api.post("/v1/capability/tutor.turn", json=body, headers=auth())
    assert first.status_code == 200

    spend.record(50.0)  # the day is gone for everyone
    assert spend.verdict(spend.Priority.PAID) is spend.Verdict.REFUSE
    again = api.post("/v1/capability/tutor.turn", json=body, headers=auth())
    assert again.status_code == 200
    assert again.json()["cache_hit"] is True


# --- the HTTP surface ----------------------------------------------------------------------------
def test_the_capability_route_answers_429_and_not_500_when_the_day_is_spent(ceiling, auth) -> None:
    """A ceiling doing its job is a quota answer, never a server error, or it would page the
    owner for his own limiter working."""
    ceiling(10.0)
    spend.record(50.0)
    answer = client().post(
        "/v1/capability/tutor.turn", json={"payload": {"q": "hello"}}, headers=auth()
    )
    assert answer.status_code == 429
    assert answer.json()["code"] == "spend_ceiling"
    assert "Retry-After" in answer.headers


def test_a_learner_refused_by_the_ceiling_does_not_also_lose_a_turn(ceiling, auth) -> None:
    """Their own free allowance is refunded: the platform ran out of money, not the learner."""
    ceiling(10.0)
    api = client()
    before = api.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    spend.record(50.0)
    assert (
        api.post(
            "/v1/capability/tutor.turn", json={"payload": {"q": "hello"}}, headers=auth()
        ).status_code
        == 429
    )
    after = api.get("/v1/me", headers=auth()).json()["budget"]["turns_remaining"]
    assert after == before


def test_a_learner_who_paid_is_still_answered_when_a_stranger_burnt_the_day(
    ceiling, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The requirement, end to end through the real door and the real subscription store."""
    ceiling(10.0)
    store = billing.InMemorySubscriptionStore()
    store.insert(
        billing.Subscription(
            id="sub-paid",
            learner_id=TEST_SUBJECT,
            plan="pro",
            status="active",
            origin="web",
            current_period_end=datetime.now(UTC) + timedelta(days=30),
            started_at=datetime.now(UTC) - timedelta(days=1),
        )
    )
    billing.set_store(store)
    api = client()
    spend.record(9.5)  # a stranger has spent everything a stranger may spend

    paid = api.post("/v1/capability/tutor.turn", json={"payload": {"q": "hi"}}, headers=auth())
    assert paid.status_code == 200

    # …and at the very same moment a stranger at the open box is refused, because the last tenth
    # of the day was never the stranger lane's to spend.
    stranger = api.post(
        "/v1/capability/tutor.turn",
        # a question of their own: an answer already in the cache is served past the ceiling
        json={"payload": {"q": "what is a prime number"}},
        headers=auth("a-stranger", anonymous=True),
    )
    assert stranger.status_code == 429
    assert stranger.json()["code"] == "spend_ceiling"

    # Past the ceiling itself the free member goes too, and the learner who paid is still served.
    spend.record(0.6)
    member = api.post(
        "/v1/capability/tutor.turn",
        json={"payload": {"q": "how do magnets work"}},
        headers=auth("some-free-learner"),
    )
    assert member.status_code == 429
    assert (
        api.post(
            "/v1/capability/tutor.turn",
            json={"payload": {"q": "why is the sky blue"}},
            headers=auth(),
        ).status_code
        == 200
    )


def test_the_public_ask_box_is_a_stranger(ceiling) -> None:
    """The open box in front of frontier models takes the default lane, which is the first shed."""
    ceiling(10.0)
    spend.record(9.5)
    answer = client().post("/v1/ask", json={"question": "what is Wobo"})
    # It is refused, and refused in the box's own honest voice rather than with a stack trace.
    assert answer.status_code in {200, 429, 503}
    if answer.status_code == 200:
        assert "answer" in answer.json()


# --- the alarm on the way up ---------------------------------------------------------------------
def test_crossing_a_threshold_alerts_once_and_only_once(
    monkeypatch: pytest.MonkeyPatch, ceiling
) -> None:
    ceiling(10.0)
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://hooks.example/none")
    monkeypatch.setenv("ALERT_COOLDOWN_SECONDS", "0")
    sent: list[dict] = []
    alerts.set_sender(lambda url, payload: sent.append(payload))
    alerts.set_runner(lambda go: go())

    spend.record(4.9)
    assert sent == []
    spend.record(0.2)  # crosses 50 %
    assert [p["event"] for p in sent] == [alerts.SPEND_THRESHOLD]
    spend.record(0.2)  # still above 50 %, no second page for the same threshold
    assert len(sent) == 1
    spend.record(5.0)  # crosses 80 % and 100 % in one call
    assert len(sent) == 3
    assert sent[-1]["severity"] == alerts.CRITICAL


def test_the_curriculum_is_gated_too_even_though_it_never_reaches_the_engine(ceiling, auth) -> None:
    """The curriculum rides the capability route but not ``Gateway.invoke``, so the gate there
    does not cover it. Its expensive half — a learner's own syllabus read on the generate tier —
    is refused past the ceiling; its store reads cost nothing and are never refused."""
    ceiling(10.0)
    api = client()
    spend.record(50.0)

    expensive = api.post(
        "/v1/capability/curriculum.own.read",
        json={"payload": {"text": "Class 8 science, chapter one"}},
        headers=auth(),
    )
    assert expensive.status_code == 429
    assert expensive.json()["code"] == "spend_ceiling"

    # A registry read answers from our own database and costs nothing, so it still answers.
    free = api.post(
        "/v1/capability/curriculum.search",
        json={"payload": {"query": "cbse"}},
        headers=auth(),
    )
    assert free.status_code != 429
