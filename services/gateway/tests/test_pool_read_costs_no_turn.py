"""READING THE CHAPTER'S POOL NEVER SPENDS A LEARNER'S DAY (docs/LEARNING-MODEL.md, "Who chooses").

The group that teaches a topic is chosen on the device, out of the pool ``curriculum.blueprint``
hands over. Choosing is free only if the one read it stands on is free too. Played on 2026-09-16
by an adversary against the gateway as wave 55 left it: an anonymous learner's pool read cost a
turn (five left of six), and once the day's six questions were asked the next pool read was a 429,
so the course on that learner's device could never re-choose again for the rest of the session. A
free learner met the same wall after forty questions. The struggling child, whose wrong answers
bring Wobo in most often, met it first.

What stands now, played through the real route and the real stored pool:

* the read draws on its own counter, never on the turns a learner asks Wobo with;
* a learner whose questions are spent can still read the pool;
* the money meter never refuses it, because it reaches no model and costs no money;
* it is still counted, so a runaway client cannot read without bound.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from blueprint_fixture import blueprint as good_blueprint
from blueprint_fixture import brief as good_brief
from fastapi.testclient import TestClient
from wobo_gateway import allowance, budget, doors
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

POOL = "curriculum.blueprint"
CELL: dict[str, Any] = good_brief()
ASK = {"payload": {"message": "why does the scale stay level?"}}


@pytest.fixture(autouse=True)
def _stored_pool(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """The real pool, in the real artifact store, so the read is a real read."""
    monkeypatch.setenv("PLEXUS_CACHE_DIR", str(tmp_path))
    from wobo_gateway.plexus import blueprint as architect
    from wobo_gateway.plexus import store as plexus_store

    brief = architect.NodeBrief.from_dict(CELL)
    plexus_store.save(
        brief.concept(),
        architect.MODALITY,
        architect.DIFFICULTY,
        {"status": architect.CANONICAL, "artifact": good_blueprint()},
        brief.scope(),
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def _read(client: TestClient, headers: dict[str, str]) -> Any:
    return client.post(f"/v1/capability/{POOL}", json={"payload": CELL}, headers=headers)


def test_the_pool_read_is_not_on_the_question_counter() -> None:
    assert budget.classify(POOL) != budget.TURN
    assert budget.classify(POOL) != budget.GENERATION
    # the rest of the curriculum stays where it was
    assert budget.classify("curriculum.units") == budget.TURN


def test_an_anonymous_learner_whose_questions_are_spent_still_gets_the_pool(
    client: TestClient, auth: Callable[..., dict[str, str]]
) -> None:
    headers = auth("anonymous-reader", anonymous=True)
    first = _read(client, headers)
    assert first.status_code == 200, first.text
    assert first.json()["output"]["blueprint"] is not None

    asked = [
        client.post("/v1/capability/wobo.turn", json=ASK, headers=headers).status_code
        for _ in range(7)
    ]
    # all six of the day's questions are still theirs after the read, and the seventh is refused
    assert asked == [200] * 6 + [429], asked

    again = _read(client, headers)
    assert again.status_code == 200, (
        f"the pool read was refused once the questions were spent: {again.status_code} "
        f"{again.text[:200]}"
    )
    assert again.json()["output"]["blueprint"] is not None


def test_reading_the_pool_leaves_a_signed_in_learners_turns_where_they_were(
    client: TestClient, auth: Callable[..., dict[str, str]]
) -> None:
    before = budget.snapshot("sub:pool-reader", "free").turns_remaining
    for _ in range(5):
        assert _read(client, auth("pool-reader")).status_code == 200
    assert budget.snapshot("sub:pool-reader", "free").turns_remaining == before


def test_a_spent_money_day_does_not_refuse_the_pool(
    client: TestClient, auth: Callable[..., dict[str, str]]
) -> None:
    doors.get_store().write(allowance.DIAL_INR_PER_USD, 100, actor=None, note="a test")
    allowance.apply()
    allowance.debit("sub:spent-reader", cost_usd=0.05, capability="wobo.turn")  # the whole free day
    with pytest.raises(budget.BudgetExhausted):
        budget.charge("sub:spent-reader", "wobo.turn")
    read = _read(client, auth("spent-reader"))
    assert read.status_code == 200, read.text


def test_the_read_is_still_counted_and_still_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    """Free to the learner is not unbounded: a client that loops on the read meets a cap."""
    kind = budget.classify(POOL)
    limit = budget.limits_for("free")[kind]
    assert limit > 40, "a learner opening chapters all day must never meet this cap"
    monkeypatch.setitem(
        budget._DIALS, ("free", kind), (budget._DIALS[("free", kind)][0], 2)
    )
    budget.charge("sub:looping", POOL)
    budget.charge("sub:looping", POOL)
    with pytest.raises(budget.BudgetExhausted) as refused:
        budget.charge("sub:looping", POOL)
    assert refused.value.kind == kind
    assert budget.snapshot("sub:looping").turns_remaining == 40
