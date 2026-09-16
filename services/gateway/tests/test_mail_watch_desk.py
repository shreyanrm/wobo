"""The mail desk and the watch's cron door (wave 56, the deliverability watch).

The desk shows what the watch knows, in counts: the complaint rate overall and per kind against
0.10 and 0.30 percent, bounces, how many addresses are suppressed (a number, never a list), where
each seed landed, what Google says, which kinds are paused and why, and every alert. The one
control on it lifts a pause, and only the owner holds it, with a step-up and a line in the trail.

The cron door runs the watch: the seed check, the Postmaster read and the rate check, with the
clock handed in, behind the same internal key as every other mail door.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, doors
from wobo_gateway import email as email_mod
from wobo_gateway.admin_auth import ADMIN_PREFIX, OPERATOR, OWNER, VIEWER, InMemoryAdminStore
from wobo_gateway.email import MailLog, to_hash
from wobo_gateway.mailwatch import events, respond, store

MAIL = f"{ADMIN_PREFIX}/mail"
UNPAUSE = f"{ADMIN_PREFIX}/mail/unpause"
WATCH = "/v1/internal/mail/watch"
SUBJECT = "71111111-1111-4111-8111-111111111111"
INTERNAL = {"X-Wobo-Internal": "internal-test-key"}
NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _desk(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "internal-test-key")
    monkeypatch.delenv("ENV", raising=False)
    admins = InMemoryAdminStore()
    admin_auth.set_store(admins)
    admin_auth.reset_limiter()
    watch = store.WatchStore()
    store.set_store(watch)
    doors.set_store(doors.InMemorySettingsStore())
    email_mod.set_mail_log(MailLog())
    yield admins
    admin_auth.set_store(None)
    store.set_store(None)
    doors.set_store(None)
    email_mod.reset_mail_log()


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def _bearer(subject: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET)}"}


def seat(client: TestClient, admins: InMemoryAdminStore, role: str) -> dict[str, str]:
    admins.upsert_admin(
        subject_id=SUBJECT, email="ops@example.com", role=role, granted_by=None, mfa_required=False
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def trouble(now: datetime = NOW) -> None:
    """A week of learning notes with complaints over the line, and a hard bounce."""
    for i in range(1000):
        events.take(
            {
                "type": "email.delivered",
                "created_at": now.isoformat(),
                "data": {
                    "email_id": f"d{i}",
                    "to": [f"r{i}@example.test"],
                    "tags": {"kind": "learning_note"},
                },
            },
            event_id=f"d{i}",
            now=now,
        )
    for i in range(2):
        events.take(
            {
                "type": "email.complained",
                "created_at": now.isoformat(),
                "data": {
                    "email_id": f"c{i}",
                    "to": [f"c{i}@example.test"],
                    "tags": {"kind": "learning_note"},
                },
            },
            event_id=f"c{i}",
            now=now,
        )
    events.take(
        {
            "type": "email.bounced",
            "created_at": now.isoformat(),
            "data": {
                "email_id": "b1",
                "to": ["gone@example.test"],
                "tags": {"kind": "quick_one"},
                "bounce": {"type": "Permanent", "subType": "General", "message": "no such user"},
            },
        },
        event_id="b1",
        now=now,
    )


# === 1. the read ==================================================================================
def test_a_learner_reads_no_desk(client: TestClient) -> None:
    response = client.get(MAIL, headers=_bearer("a-learner"))
    assert response.status_code in (401, 403, 404)


def test_the_desk_shows_the_watch_in_counts(client: TestClient, _desk: InMemoryAdminStore) -> None:
    trouble(datetime.now(UTC))
    response = client.get(MAIL, headers=seat(client, _desk, VIEWER))
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["thresholds"]["pause"] == respond.PAUSE_AT
    assert body["thresholds"]["cliff"] == respond.CLIFF
    overall = body["complaints"]["overall"]
    assert overall["complained"] == 2 and overall["delivered"] == 1000
    kinds = {row["kind"]: row for row in body["complaints"]["kinds"]}
    assert kinds["learning_note"]["state"] == "over_pause"
    assert kinds["learning_note"]["paused"] is True
    assert body["bounces"]["hard"] == 1
    assert body["suppressed"] == {"count": 3}
    assert [p["kind"] for p in body["paused"]] == ["learning_note"]
    assert "verify_email" in body["never_paused"]
    assert [a["cause"] for a in body["alerts"]] == ["complaint_rate"]
    assert body["placement"]["configured"] is False
    assert body["postmaster"]["configured"] is False
    assert body["webhook"]["configured"] is False
    assert body["streams"]["separate"] is False
    # Counts only: nobody's address, and no digest either.
    assert "@example.test" not in response.text
    assert to_hash("gone@example.test") not in response.text
    assert any(row.get("action") == "console.mail.read" for row in _desk.audit)


def test_an_unreadable_watch_says_so_rather_than_showing_zeroes(
    client: TestClient, _desk: InMemoryAdminStore
) -> None:
    class Blind(store.WatchStore):
        readable = False

    store.set_store(Blind())
    body = client.get(MAIL, headers=seat(client, _desk, VIEWER)).json()
    assert body["readable"] is False


# === 2. the one control ===========================================================================
def test_only_the_owner_lifts_a_pause(client: TestClient, _desk: InMemoryAdminStore) -> None:
    respond.pause("learning_note", at=NOW, reason="complaint_rate")
    for role in (VIEWER, OPERATOR):
        refused = client.post(
            UNPAUSE, headers=seat(client, _desk, role), json={"kind": "learning_note"}
        )
        assert refused.status_code == 403, (role, refused.text)
        assert "learning_note" in respond.paused()

    owner = seat(client, _desk, OWNER)
    lifted = client.post(
        UNPAUSE, headers=owner, json={"kind": "learning_note", "note": "copy fixed"}
    )
    assert lifted.status_code == 200, lifted.text
    assert lifted.json()["saved"] is True
    assert respond.paused() == {}
    assert lifted.json()["paused"] == []
    trail = [row for row in _desk.audit if row.get("action") == "mail.unpause"]
    assert trail and trail[-1]["resource_id"] == "learning_note"
    change = doors.get_store().changes[-1]
    assert change["key"] == email_mod.KINDS_PAUSED_DIAL and change["note"] == "copy fixed"
    assert change["actor"] == SUBJECT


def test_lifting_what_is_not_paused_is_a_clear_refusal(
    client: TestClient, _desk: InMemoryAdminStore
) -> None:
    owner = seat(client, _desk, OWNER)
    response = client.post(UNPAUSE, headers=owner, json={"kind": "streak"})
    assert response.status_code == 409
    response = client.post(UNPAUSE, headers=owner, json={"kind": "not a kind"})
    assert response.status_code in (404, 422)


# === 3. the cron door =============================================================================
def test_the_watch_door_is_shut_without_the_internal_key(client: TestClient) -> None:
    assert client.post(WATCH).status_code == 403
    assert client.post(WATCH, headers={"X-Wobo-Internal": "wrong"}).status_code == 403


def test_the_watch_door_runs_the_three_checks_with_the_clock_handed_in(
    client: TestClient,
) -> None:
    trouble(NOW - timedelta(hours=1))
    response = client.post(WATCH, headers=INTERNAL, json={"now": NOW.isoformat()})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["placement"]["configured"] is False
    assert body["postmaster"] == {"configured": False}
    assert body["rates"]["paused"] == ["learning_note"]
    assert client.post(WATCH, headers=INTERNAL, json={"now": "yesterday"}).json()["ok"] is False


def test_the_webhook_is_reported_configured_and_its_last_event_shown(
    client: TestClient, _desk: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = b"a-test-webhook-key-of-32-bytes!!"
    monkeypatch.setenv(events.SECRET_ENV, "whsec_" + base64.b64encode(key).decode())
    body = json.dumps(
        {
            "type": "email.delivered",
            "created_at": NOW.isoformat(),
            "data": {"email_id": "x", "to": ["a@example.test"], "tags": {"kind": "welcome"}},
        }
    ).encode()
    stamp = str(int(datetime.now(UTC).timestamp()))
    sig = base64.b64encode(hmac.new(key, f"m1.{stamp}.".encode() + body, hashlib.sha256).digest())
    posted = client.post(
        events.EVENTS_PATH,
        content=body,
        headers={
            "svix-id": "m1",
            "svix-timestamp": stamp,
            "svix-signature": f"v1,{sig.decode()}",
            "content-type": "application/json",
        },
    )
    assert posted.status_code == 200, posted.text
    desk = client.get(MAIL, headers=seat(client, _desk, VIEWER)).json()
    assert desk["webhook"]["configured"] is True
    assert desk["webhook"]["last_event_at"]
    assert "whsec_" not in json.dumps(desk)
