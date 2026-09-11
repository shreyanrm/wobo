"""The create tier is not a door a learner can knock on.

``create.core`` and ``create.blueprint`` are PLATFORM_PAID (``registry.py``): they run once per
concept or per cell, on the most expensive model the product owns, out of the platform's creative
pool, and every learner of that cell is then served the cached result for nothing.

They are in the registry because that is how a capability EXISTS at this gateway: it is what
``/v1/capabilities`` lists, what the consent gate reads, and what the meter classifies. Being in
the registry is not the same as being invokable, and until this wave it was: ``POST
/v1/capability/create.blueprint`` with any valid learner token would have started an Astra call
against the creative pool, as many times as the caller liked, off a body the caller wrote.

So the create tier refuses at this door, exactly as ``doubt.*`` does and for the same reason: it
is reached by the job that owns it, or it is not reached. The refusal is a 404 and not a 403,
because a learner has no business learning that this capability exists at all.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.registry import PLATFORM_PAID
from wobo_gateway.telemetry import MetricsSink


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


@pytest.mark.parametrize("capability", sorted(PLATFORM_PAID))
def test_a_learner_cannot_invoke_the_platform_s_creative_pool(
    client: TestClient, auth, capability: str
) -> None:
    response = client.post(
        f"/v1/capability/{capability}",
        json={"consent_tier": "elevated", "payload": {"concept": "force and pressure"}},
        headers=auth(),
    )
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_a_learner_capability"


def test_every_platform_paid_capability_is_refused_and_no_served_one_is(
    client: TestClient, auth
) -> None:
    """The guard is derived from PLATFORM_PAID, so a creative job added later is closed the day it
    is registered rather than the day somebody remembers this file."""
    served = client.post(
        "/v1/capability/generate.opener",
        json={"consent_tier": "un_elevated", "payload": {"topic": "fractions"}},
        headers=auth(),
    )
    assert served.status_code == 200, served.text


def test_the_creative_jobs_are_still_listed_and_still_carry_their_policy(
    client: TestClient, auth
) -> None:
    """Refusing to be invoked is not the same as not existing: the meter, the ledger and the models
    desk all read the policy, and the console lists it."""
    from wobo_gateway.registry import policy

    listed = client.get("/v1/capabilities", headers=auth()).json()
    names = {row["capability"] for row in listed}
    assert names >= PLATFORM_PAID
    for name in PLATFORM_PAID:
        assert policy(name).tier.value == "create"
