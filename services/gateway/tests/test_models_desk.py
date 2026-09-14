"""The models desk and the pace desk: what the owner sees, and what he may change.

``docs/CONSOLE-MODELS.md`` and ``docs/ALLOWANCE.md`` §3. Six things are proved here:

1. Both reads are behind the guard and behind ``console.read``. A signed-in learner gets nothing.
2. ``GET /v1/admin/models`` carries the whole table: every tier's primary, its chain, the
   catalogue price, the jobs on it, who is carrying it now, and the ladder.
3. ``POST /v1/admin/models`` is OWNER ONLY, is audited, and takes effect with no restart.
4. An id off the catalogue is refused, and the table is unchanged afterwards.
5. "Back to the owner's table" clears every override.
6. ``GET/POST /v1/admin/allowance`` shows the generosity, the free rupees and the rate with the
   live effect beside them, and the pace is honest about what it cannot see (a learner's local
   hour is not in the ledger, and the desk says so rather than inventing one).
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, dials, doors, registry, routing
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    OWNER,
    VIEWER,
    InMemoryAdminStore,
)
from wobo_gateway.routing import Tier

OWNER_SUBJECT = "61111111-1111-4111-8111-111111111111"
LEARNER_SUBJECT = "64444444-4444-4444-8444-444444444444"

MODELS = f"{ADMIN_PREFIX}/models"
ALLOWANCE = f"{ADMIN_PREFIX}/allowance"
APPLY = f"{ADMIN_PREFIX}/settings/apply"


@pytest.fixture(autouse=True)
def _desk_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    store = InMemoryAdminStore()
    admin_auth.set_store(store)
    admin_auth.reset_limiter()
    doors.set_store(doors.InMemorySettingsStore())
    dials.reset()
    yield store
    admin_auth.set_store(None)
    doors.set_store(None)
    dials.reset()
    routing.configure({})
    registry.reload()


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def _seat(client: TestClient, store: InMemoryAdminStore, role: str = OWNER) -> dict[str, str]:
    store.upsert_admin(
        subject_id=OWNER_SUBJECT,
        email="owner@example.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(OWNER_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _actions(store: InMemoryAdminStore) -> list[str]:
    return [str(row.get("action")) for row in store.audit]


# --- 1. the door -------------------------------------------------------------------------------
@pytest.mark.parametrize("path", [MODELS, ALLOWANCE])
def test_a_signed_in_learner_reads_nothing(client: TestClient, path: str) -> None:
    response = client.get(path, headers=_bearer(LEARNER_SUBJECT))
    assert response.status_code in (401, 403, 404)
    assert "catalogue" not in response.text
    assert "generosity" not in response.text


# --- 2. the table ------------------------------------------------------------------------------
def test_the_desk_carries_the_whole_table(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, VIEWER)

    response = client.get(MODELS, headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    tiers = {row["tier"]: row for row in body["tiers"]}
    assert set(tiers) == {tier.value for tier in Tier}
    turn = tiers["turn"]
    assert turn["primary"] == "openai/gpt-5.6-terra"
    assert turn["chain"][0] == "openai/gpt-5.6-terra"
    assert turn["source"] == "default"
    # The vendor's own price, beside the id, from routing.CATALOGUE.
    assert turn["price"]["per_million_in"] == 2.00
    assert turn["price"]["per_million_out"] == 12.00
    # The jobs that ride on this tier, from registry.py.
    assert "wobo.turn" in turn["jobs"]
    # Who is carrying it right now, from the health snapshot.
    assert "carrying" in turn
    # The ladder, and the creative pool's own line.
    assert body["ladder"]["rungs"][0] == "openai/gpt-5.6-luna"
    assert body["creative_pool"]["cap_usd"] == dials.DEFAULT_CREATIVE_POOL_USD
    assert tiers["create"]["primary"] == "openai/gpt-6-astra"
    assert tiers["create"]["platform_paid_jobs"] == ["create.blueprint", "create.core"]


def test_the_desk_says_which_ids_it_will_accept(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """The closed list is the route's own vocabulary, so a screen cannot offer an id the
    gateway would refuse."""
    headers = _seat(client, _desk_env, VIEWER)

    body = client.get(MODELS, headers=headers).json()

    assert set(body["catalogue"]) == set(routing.CATALOGUE)


# --- 3. the write ------------------------------------------------------------------------------
def test_only_an_owner_may_move_a_tier(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, OPERATOR)

    response = client.post(
        MODELS, headers=headers, json={"tier": "turn", "primary": "openai/gpt-5.6-luna"}
    )

    assert response.status_code in (403, 404)
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"


def test_an_override_from_the_desk_changes_the_model_with_no_restart(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, OWNER)

    response = client.post(
        MODELS,
        headers=headers,
        json={"tier": "turn", "primary": "openai/gpt-5.6-luna", "note": "cheaper for a day"},
    )

    assert response.status_code == 200, response.text
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-luna"
    # The very next policy read routes there too — the registry followed the router.
    assert registry.policy("wobo.turn").primary == routing.tier_primary(Tier.TURN)
    assert "models.set" in _actions(_desk_env)
    assert response.json()["tiers"][0]["source"] in {"desk", "env", "default"}


def test_the_price_difference_is_previewed_before_it_is_saved(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """CONSOLE-MODELS §2: "with the effect previewed before saving: the price difference per
    thousand calls at yesterday's volume"."""
    headers = _seat(client, _desk_env, OWNER)

    response = client.post(
        MODELS,
        headers=headers,
        json={"tier": "turn", "primary": "openai/gpt-5.6-luna", "preview": True},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["saved"] is False
    preview = body["preview"]
    assert preview["from"] == "openai/gpt-5.6-terra"
    assert preview["to"] == "openai/gpt-5.6-luna"
    # Nothing was written and nothing moved.
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"
    assert "models.set" not in _actions(_desk_env)


# --- 4. an id off the catalogue ------------------------------------------------------------------
def test_an_id_off_the_catalogue_is_refused(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, OWNER)

    response = client.post(
        MODELS, headers=headers, json={"tier": "turn", "primary": "openai/gpt-9-nope"}
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "not_a_model"
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"


def test_a_chain_that_repeats_a_model_is_refused(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, OWNER)

    response = client.post(
        MODELS,
        headers=headers,
        json={
            "tier": "turn",
            "chain": ["openai/gpt-5.6-terra", "openai/gpt-5.6-terra"],
        },
    )

    assert response.status_code == 422, response.text


# --- 5. back to the owner's table -----------------------------------------------------------------
def test_back_to_the_owners_table(client: TestClient, _desk_env: InMemoryAdminStore) -> None:
    headers = _seat(client, _desk_env, OWNER)
    client.post(MODELS, headers=headers, json={"tier": "turn", "primary": "openai/gpt-5.6-luna"})
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-luna"

    response = client.post(MODELS, headers=headers, json={"reset": True})

    assert response.status_code == 200, response.text
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-terra"
    assert "models.reset" in _actions(_desk_env)


def test_the_env_wins_and_the_desk_says_so(
    client: TestClient, _desk_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("WOBO_TIER_TURN", "openai/gpt-5.6-sol")
    headers = _seat(client, _desk_env, OWNER)
    client.post(MODELS, headers=headers, json={"tier": "turn", "primary": "openai/gpt-5.6-luna"})

    body = client.get(MODELS, headers=headers).json()

    turn = next(row for row in body["tiers"] if row["tier"] == "turn")
    assert turn["primary"] == "openai/gpt-5.6-sol"
    assert turn["source"] == "env"
    assert turn["desk_value"] == "openai/gpt-5.6-luna"
    assert routing.tier_model(Tier.TURN).provider_model == "openai/gpt-5.6-sol"


def test_apply_re_reads_the_dials_at_once(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    """A dial turned in the SQL editor is followed within the interval; this is the button that
    does not wait for it."""
    headers = _seat(client, _desk_env, OWNER)
    doors.get_store().write(
        dials.tier_primary_key("tiny"), "gemini/gemini-2.5-flash", actor=None, note=None
    )

    response = client.post(APPLY, headers=headers, json={})

    assert response.status_code == 200, response.text
    assert routing.tier_model(Tier.TINY).provider_model == "gemini/gemini-2.5-flash"
    assert "settings.apply" in _actions(_desk_env)


# --- 6. the allowance and the pace -----------------------------------------------------------------
def test_the_allowance_desk_shows_the_dials_and_the_live_effect(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, VIEWER)

    response = client.get(ALLOWANCE, headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["generosity"]["pro"] == 0.25
    assert body["free_daily_paise"] == 500
    assert body["inr_per_usd"] == dials.DEFAULT_INR_PER_USD
    pro = next(
        row for row in body["effect"] if row["plan"] == "pro" and row["period"] == "yearly"
    )
    assert pro["a_day"].startswith("₹")
    # The pace: honest when the ledger cannot be reached.
    assert body["pace"]["readable"] in (True, False)
    assert "local hour" in body["pace"]["not_known"].lower()


def test_only_an_owner_may_turn_the_generosity(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, OPERATOR)

    response = client.post(ALLOWANCE, headers=headers, json={"generosity": {"pro": 0.5}})

    assert response.status_code in (403, 404)
    assert dials.generosity()["pro"] == 0.25


def test_the_owner_turns_the_generosity_and_it_applies_at_once(
    client: TestClient, _desk_env: InMemoryAdminStore
) -> None:
    headers = _seat(client, _desk_env, OWNER)

    response = client.post(
        ALLOWANCE,
        headers=headers,
        json={"generosity": {"pro": 0.5}, "free_daily_paise": 300, "inr_per_usd": 90},
    )

    assert response.status_code == 200, response.text
    assert dials.generosity()["pro"] == 0.5
    assert dials.free_daily_paise() == 300
    assert dials.inr_per_usd() == 90.0
    assert "allowance.set" in _actions(_desk_env)


@pytest.mark.parametrize(
    "body",
    [
        {"generosity": {"pro": 2.5}},
        {"generosity": {"pro": -0.1}},
        {"free_daily_paise": -1},
        {"inr_per_usd": 0},
    ],
)
def test_a_dial_outside_its_range_is_refused(
    client: TestClient, _desk_env: InMemoryAdminStore, body: dict[str, Any]
) -> None:
    headers = _seat(client, _desk_env, OWNER)

    response = client.post(ALLOWANCE, headers=headers, json=body)

    assert response.status_code == 422, response.text
    assert dials.generosity()["pro"] == 0.25
    assert dials.free_daily_paise() == 500
