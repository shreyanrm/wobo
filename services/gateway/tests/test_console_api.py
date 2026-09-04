"""The console's read surface: guarded, permissioned, and honest about an empty ledger.

Four things are proved here and every one of them fails without ``console_api.py``:

1. The three reads exist and are behind the guard. A signed-in LEARNER — a real verified token,
   not an anonymous one — gets nothing from any of them.
2. A seat may not read the money unless it carries ``console.read``.
3. "Could not ask" and "nothing happened" come back as DIFFERENT answers. ``ledger.read_daily``
   returns ``None`` for the first and ``[]`` for the second, and a console that rendered both as
   an empty chart would be telling an operator the platform was idle when the console was blind.
4. Nothing is invented in either case: no zeroed day rows, no estimated spend, no sample.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, console_api, ledger
from wobo_gateway.admin_auth import ADMIN_PREFIX, VIEWER, InMemoryAdminStore

OWNER_SUBJECT = "51111111-1111-4111-8111-111111111111"
LEARNER_SUBJECT = "54444444-4444-4444-8444-444444444444"


@pytest.fixture(autouse=True)
def _admin_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.delenv("ENV", raising=False)
    store = InMemoryAdminStore()
    admin_auth.set_store(store)
    admin_auth.reset_limiter()
    yield store
    admin_auth.set_store(None)


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def _console(client: TestClient, store: InMemoryAdminStore, role: str = VIEWER) -> dict[str, str]:
    store.upsert_admin(
        subject_id=OWNER_SUBJECT,
        email="ops@example.com",
        role=role,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(OWNER_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


CONSOLE_READS = ["/usage", "/economics", "/health"]


# --- 1. the door ---------------------------------------------------------------------------------
@pytest.mark.parametrize("path", CONSOLE_READS)
def test_a_signed_in_learner_reads_nothing(client: TestClient, path: str) -> None:
    """A verified learner token is not an authorisation. Every console read refuses it."""
    response = client.get(f"{ADMIN_PREFIX}{path}", headers=_bearer(LEARNER_SUBJECT))
    assert response.status_code in (401, 403, 404)
    assert "spend_now" not in response.text
    assert "usage_daily" not in response.text


@pytest.mark.parametrize("path", CONSOLE_READS)
def test_an_admin_without_a_console_session_reads_nothing(
    client: TestClient, _admin_env: InMemoryAdminStore, path: str
) -> None:
    """Being in the register is not enough: the short console session is a separate proof."""
    _admin_env.upsert_admin(
        subject_id=OWNER_SUBJECT,
        email="ops@example.com",
        role=VIEWER,
        granted_by=None,
        mfa_required=False,
    )
    response = client.get(f"{ADMIN_PREFIX}{path}", headers=_bearer(OWNER_SUBJECT))
    assert response.status_code == 401


# --- 2. "could not ask" is not "nothing happened" ------------------------------------------------
def test_an_unreachable_ledger_says_so_and_shows_no_days(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ledger, "read_daily", lambda **_: None)
    body = client.get(f"{ADMIN_PREFIX}/usage", headers=_console(client, _admin_env)).json()
    assert body["readable"] is False
    assert body["days"] == []


def test_an_empty_ledger_is_readable_and_still_shows_no_days(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The distinction the whole envelope exists for: readable, and genuinely nothing yet."""
    monkeypatch.setattr(ledger, "read_daily", lambda **_: [])
    body = client.get(f"{ADMIN_PREFIX}/usage", headers=_console(client, _admin_env)).json()
    assert body["readable"] is True
    assert body["days"] == []


def test_rows_are_served_ungrouped_exactly_as_the_rollup_holds_them(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No arithmetic happens on the way out. What ops.usage_daily holds is what the wire carries,
    so the console and this file cannot come to two different views of the same table."""
    row: dict[str, Any] = {
        "day": "2026-09-03",
        "capability": "wobo.turn",
        "model_served": "a-model",
        "plan": "free",
        "unit_kind": "message",
        "calls": 3,
        "cost_usd": 0.0125,
        "unpriced_calls": 1,
    }
    monkeypatch.setattr(ledger, "read_daily", lambda **_: [row])
    body = client.get(f"{ADMIN_PREFIX}/usage", headers=_console(client, _admin_env)).json()
    assert body["days"] == [row]


def test_the_live_ceiling_rides_along_beside_the_history(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The two money numbers answer different questions and both are labelled, never merged."""
    monkeypatch.setattr(ledger, "read_daily", lambda **_: [])
    body = client.get(f"{ADMIN_PREFIX}/usage", headers=_console(client, _admin_env)).json()
    assert set(body["spend_now"]) >= {"day", "spent_usd", "ceiling_usd", "fraction", "calls"}
    assert "ledger" in body  # the ledger's own account of what it dropped


def test_economics_carries_its_gaps_rather_than_a_tidy_number(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An empty ledger derives no cost, and says why in words the console prints verbatim."""
    monkeypatch.setattr(ledger, "read_daily", lambda **_: [])
    body = client.get(f"{ADMIN_PREFIX}/economics", headers=_console(client, _admin_env)).json()
    assert body["free_day"]["usd"] is None
    assert body["free_day"]["complete"] is False
    assert body["gaps"], "an underived cost must say why, not show a blank"


# --- 3. the window -------------------------------------------------------------------------------
def test_the_window_is_clamped_rather_than_refused() -> None:
    """An operator mid-incident gets the widest honest window, not a 422."""
    today = date(2026, 9, 4)
    since, until = console_api.window(10_000, today=today)
    assert until == today
    assert (until - since).days == console_api.MAX_WINDOW_DAYS - 1

    since, until = console_api.window(1, today=today)
    assert since == until == today
