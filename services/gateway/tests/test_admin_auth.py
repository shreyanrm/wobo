"""The console's door, driven end to end: the register, the session, the levels, the trail.

Every test here fails without ``admin_auth.py`` and migration 0015 — there was no admin role in
this codebase before them. The suite mints REAL Supabase-shaped tokens (conftest.mint) and sends
them through the app's real middleware, so the identity path under test is the one that runs in
production, not a bypass.

The threat these tests are shaped around is not "does the happy path work". It is: can somebody
who is signed in as an ordinary learner reach any of this, can a stolen session token be replayed
against a different admin, can an admin act without proving themselves again, and can an admin
touch the record of what they looked at.
"""

from __future__ import annotations

import pathlib
import time
from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    OWNER,
    VIEWER,
    Admin,
    InMemoryAdminStore,
)

OWNER_SUBJECT = "11111111-1111-4111-8111-111111111111"
VIEWER_SUBJECT = "22222222-2222-4222-8222-222222222222"
OPERATOR_SUBJECT = "33333333-3333-4333-8333-333333333333"
LEARNER_SUBJECT = "44444444-4444-4444-8444-444444444444"


@pytest.fixture(autouse=True)
def _admin_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    """A fresh in-memory register per test, MFA off, limiter empty.

    MFA is off by default HERE so that most tests exercise the register and the session rather
    than the factor; the tests that are about the factor turn it back on explicitly. It can only
    be off because ENV is not prod — ``test_mfa_cannot_be_switched_off_in_prod`` is the proof.
    """
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


def _register(store: InMemoryAdminStore, subject: str, role: str, email: str) -> Admin:
    return store.upsert_admin(
        subject_id=subject, email=email, role=role, granted_by=None, mfa_required=False
    )


def _bearer(subject: str, **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET, **claims)}"}


def _sign_in(client: TestClient, subject: str, **claims: Any) -> str:
    response = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(subject, **claims))
    assert response.status_code == 200, response.text
    return response.json()["session_token"]


def _console(subject: str, token: str, **claims: Any) -> dict[str, str]:
    return {**_bearer(subject, **claims), admin_auth.SESSION_HEADER: token}


# --- the register is the authorisation -----------------------------------------------------------
def test_a_signed_in_learner_is_not_an_admin(client: TestClient) -> None:
    """The whole point. A real, verified, non-anonymous learner token opens nothing."""
    response = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(LEARNER_SUBJECT))
    assert response.status_code == 403
    body = response.json()["detail"]
    # And it says nothing about why: a stranger learns only that this is not for them.
    assert body["message"] == admin_auth.NOT_FOR_YOU
    assert "admin" not in body["message"].lower()


def test_a_token_that_claims_to_be_an_admin_is_still_not_one(client: TestClient) -> None:
    """Supabase user_metadata is writable by the user, so a role claim is self-asserted.

    This is the attack the register exists to defeat: the token below is correctly signed by our
    own project secret, has a valid audience, and says ``role: owner``. It is worth nothing.
    """
    headers = _bearer(
        LEARNER_SUBJECT,
        app_metadata={"role": "owner"},
        user_metadata={"is_admin": True, "role": "owner"},
        admin=True,
    )
    assert client.post(f"{ADMIN_PREFIX}/session", headers=headers).status_code == 403
    # 403 and not 401: the door does not distinguish "no session" from "not an admin" for
    # somebody who is not in the register, so a probe learns nothing from the status either.
    assert client.get(f"{ADMIN_PREFIX}/whoami", headers=headers).status_code == 403


def test_an_unauthenticated_caller_cannot_reach_the_console(client: TestClient) -> None:
    assert client.get(f"{ADMIN_PREFIX}/whoami").status_code == 401
    assert client.post(f"{ADMIN_PREFIX}/session").status_code == 401


def test_a_suspended_admin_is_refused(client: TestClient, _admin_env: InMemoryAdminStore) -> None:
    admin = _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    _admin_env.set_admin_status(admin.id, "suspended")
    assert (
        client.get(f"{ADMIN_PREFIX}/whoami", headers=_console(OWNER_SUBJECT, token)).status_code
        == 403
    )


def test_an_unconfigured_store_refuses_rather_than_guesses(client: TestClient) -> None:
    """Fail closed. The billing store's posture is deliberately NOT copied here."""
    admin_auth.set_store(admin_auth.UnconfiguredAdminStore())
    response = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "register_unavailable"


# --- the console session ------------------------------------------------------------------------
def test_being_in_the_register_is_not_enough_without_a_session(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """A verified admin token with no console session opens nothing. Three things, not two."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    response = client.get(f"{ADMIN_PREFIX}/whoami", headers=_bearer(OWNER_SUBJECT))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "admin_session_required"


def test_the_session_token_is_never_stored_in_the_clear(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    assert token not in _admin_env.sessions
    assert admin_auth.hash_token(token) in _admin_env.sessions


def test_another_admins_session_token_does_not_work(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """A leaked session token bound to one admin must not authorise a different signed-in admin.

    Without the ``session.admin_id != admin.id`` check, a viewer holding an owner's stolen token
    would have been treated as a viewer with a valid session — and worse, an owner holding a
    viewer's token would have kept owner powers. Sessions belong to a person, not to the console.
    """
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    _register(_admin_env, VIEWER_SUBJECT, VIEWER, "viewer@example.com")
    owner_token = _sign_in(client, OWNER_SUBJECT)
    response = client.get(f"{ADMIN_PREFIX}/whoami", headers=_console(VIEWER_SUBJECT, owner_token))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "admin_session_expired"


def test_a_session_expires_and_does_not_refresh_itself(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ADMIN_SESSION_TTL_S", "60")
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    held = _admin_env.sessions[admin_auth.hash_token(token)]
    from datetime import UTC, datetime, timedelta

    from wobo_gateway.admin_auth import AdminSession

    stale = held["session"]
    held["session"] = AdminSession(
        id=stale.id,
        admin_id=stale.admin_id,
        issued_at=stale.issued_at,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
        reauth_at=stale.reauth_at,
    )
    assert (
        client.get(f"{ADMIN_PREFIX}/whoami", headers=_console(OWNER_SUBJECT, token)).status_code
        == 401
    )


def test_ending_a_session_kills_the_token(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    headers = _console(OWNER_SUBJECT, token)
    assert client.delete(f"{ADMIN_PREFIX}/session", headers=headers).status_code == 200
    assert client.get(f"{ADMIN_PREFIX}/whoami", headers=headers).status_code == 401


def _paths(routes: Any) -> set[str]:
    """Every path this app can serve, descending through the routers that were included."""
    found: set[str] = set()
    for route in routes:
        path = getattr(route, "path", None)
        if isinstance(path, str):
            found.add(path)
            continue
        nested = getattr(route, "effective_candidates", None) or getattr(route, "routes", None)
        if nested:
            found |= _paths(nested() if callable(nested) else nested)
    return found


def test_every_path_the_console_names_is_a_route_this_gateway_serves(client: TestClient) -> None:
    """The console cannot tell a route that is missing from a console that is not deployed.

    ``api.statusToReason`` maps 404 to 'not_deployed' on purpose — ``ops`` and ``admin_auth`` both
    answer a not-for-you with Starlette's own Not Found, because the existence of a console is
    itself information. That is right, and it is also why a MISTYPED path went unnoticed for as
    long as it did: ``POST /v1/admin/session/end`` had never been registered, so sign-out 404'd,
    the failure was discarded, and the session token stayed live until its TTL.

    So the two halves are compared here, from the console's own contract file.
    """
    import re

    contract = pathlib.Path(__file__).resolve().parents[3] / (
        "apps/web-pwa/src/admin/contract.ts"
    )
    if not contract.exists():  # the gateway is deployable on its own
        pytest.skip("the web app is not in this checkout")
    named = set(re.findall(r"^\s*\w+: '(/v1/admin[^']*)',", contract.read_text(), re.M))
    assert named, "the console's ENDPOINT map did not parse"
    served = _paths(client.app.routes)
    assert named <= served, f"the console names paths this gateway does not serve: {named - served}"


# --- levels -------------------------------------------------------------------------------------
def test_a_viewer_may_look_and_may_not_act(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, VIEWER_SUBJECT, VIEWER, "viewer@example.com")
    token = _sign_in(client, VIEWER_SUBJECT)
    headers = _console(VIEWER_SUBJECT, token)
    assert client.get(f"{ADMIN_PREFIX}/audit", headers=headers).status_code == 200
    # The register is an owner's list, and changing it is an owner's power.
    assert client.get(f"{ADMIN_PREFIX}/admins", headers=headers).status_code == 403
    grant = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=headers,
        json={"subject_id": OPERATOR_SUBJECT, "email": "new@example.com", "role": OWNER},
    )
    assert grant.status_code == 403


def test_an_operator_may_act_on_a_learner_but_not_on_the_register() -> None:
    """The permission map, read directly: "see the spend" and "add an admin" are not one power."""
    assert admin_auth.LEARNER_ACT in admin_auth.permissions_for(OPERATOR)
    assert admin_auth.ADMIN_MANAGE not in admin_auth.permissions_for(OPERATOR)
    assert admin_auth.ADMIN_MANAGE in admin_auth.permissions_for(OWNER)
    assert admin_auth.permissions_for(VIEWER).isdisjoint(admin_auth.WRITE_PERMISSIONS)
    assert admin_auth.permissions_for("nonsense") == frozenset()


def test_an_owner_grants_and_suspends_and_cannot_suspend_himself(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    headers = _console(OWNER_SUBJECT, token)

    granted = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=headers,
        json={"subject_id": OPERATOR_SUBJECT, "email": "op@example.com", "role": OPERATOR},
    )
    assert granted.status_code == 200, granted.text
    new_id = granted.json()["admin"]["id"]
    # A new admin is always created needing a second factor, whoever granted them.
    assert granted.json()["admin"]["mfa_required"] is True

    assert (
        client.post(f"{ADMIN_PREFIX}/admins/{owner.id}/suspend", headers=headers).status_code == 400
    )
    assert (
        client.post(f"{ADMIN_PREFIX}/admins/{new_id}/suspend", headers=headers).status_code == 200
    )
    assert _admin_env.admin_by_id(new_id).status == "suspended"


def test_a_grant_refuses_a_role_that_is_not_one_of_the_three(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    headers = _console(OWNER_SUBJECT, _sign_in(client, OWNER_SUBJECT))
    response = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=headers,
        json={"subject_id": OPERATOR_SUBJECT, "email": "op@example.com", "role": "superuser"},
    )
    assert response.status_code == 400


# --- step-up ------------------------------------------------------------------------------------
def test_a_write_needs_a_step_up_inside_the_window(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A walked-away laptop can still look. It cannot change anything."""
    monkeypatch.setenv("ADMIN_REAUTH_WINDOW_S", "30")
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    headers = _console(OWNER_SUBJECT, token)

    from datetime import UTC, datetime, timedelta

    from wobo_gateway.admin_auth import AdminSession

    held = _admin_env.sessions[admin_auth.hash_token(token)]
    fresh = held["session"]
    held["session"] = AdminSession(
        id=fresh.id,
        admin_id=fresh.admin_id,
        issued_at=fresh.issued_at,
        expires_at=fresh.expires_at,
        reauth_at=datetime.now(UTC) - timedelta(seconds=120),
    )
    # Looking still works.
    assert client.get(f"{ADMIN_PREFIX}/audit", headers=headers).status_code == 200
    # Changing the register does not.
    stale = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=headers,
        json={"subject_id": OPERATOR_SUBJECT, "email": "op@example.com", "role": OPERATOR},
    )
    assert stale.status_code == 401
    assert stale.json()["detail"]["code"] == "reauth_required"

    # A fresh proof re-opens the window, and only a fresh one: the reauth route refuses a token
    # that was minted long ago even though it is still perfectly valid.
    old = client.post(
        f"{ADMIN_PREFIX}/session/reauth",
        headers=_console(OWNER_SUBJECT, token, iat=int(time.time()) - 3600),
    )
    assert old.status_code == 401
    assert old.json()["detail"]["code"] == "reauth_required"

    again = client.post(f"{ADMIN_PREFIX}/session/reauth", headers=headers)
    assert again.status_code == 200
    assert (
        client.post(
            f"{ADMIN_PREFIX}/admins",
            headers=headers,
            json={"subject_id": OPERATOR_SUBJECT, "email": "op@example.com", "role": OPERATOR},
        ).status_code
        == 200
    )


# --- the second factor ---------------------------------------------------------------------------
def test_mfa_is_required_when_the_register_row_says_so(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "1")
    _admin_env.upsert_admin(
        subject_id=OWNER_SUBJECT,
        email="owner@example.com",
        role=OWNER,
        granted_by=None,
        mfa_required=True,
    )
    weak = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT, aal="aal1"))
    assert weak.status_code == 401
    assert weak.json()["detail"]["code"] == "mfa_required"

    strong = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT, aal="aal2"))
    assert strong.status_code == 200


def test_mfa_cannot_be_switched_off_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    """The one switch, and it does not exist where it would matter."""
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    assert admin_auth.mfa_enforced() is True
    with pytest.raises(RuntimeError, match="ADMIN_REQUIRE_MFA"):
        admin_auth.validate_admin_env()


def test_a_memory_register_is_refused_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "1")
    monkeypatch.setenv("ADMIN_STORE", "memory")
    with pytest.raises(RuntimeError, match="ADMIN_STORE=memory"):
        admin_auth.build_store()


# --- the trail -----------------------------------------------------------------------------------
def test_every_request_leaves_a_row_including_the_reads(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """Looking is the risk, so looking is what is recorded."""
    _register(_admin_env, VIEWER_SUBJECT, VIEWER, "viewer@example.com")
    token = _sign_in(client, VIEWER_SUBJECT)
    client.get(f"{ADMIN_PREFIX}/whoami", headers=_console(VIEWER_SUBJECT, token))

    actions = [row["action"] for row in _admin_env.audit]
    assert "admin.session.open" in actions
    assert "admin.request" in actions
    row = next(r for r in _admin_env.audit if r["action"] == "admin.request")
    assert row["actor_subject"] == VIEWER_SUBJECT
    assert row["actor_role"] == VIEWER
    assert row["path"] == f"{ADMIN_PREFIX}/whoami"
    assert row["decision"] == "allowed"
    # Who, what, when, and FROM WHERE — as a digest, never as an address.
    assert row["ip_hash"] and row["ip_hash"] != "testclient"


def test_a_refused_write_is_recorded_as_denied(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, VIEWER_SUBJECT, VIEWER, "viewer@example.com")
    token = _sign_in(client, VIEWER_SUBJECT)
    client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=_console(VIEWER_SUBJECT, token),
        json={"subject_id": OPERATOR_SUBJECT, "email": "op@example.com", "role": OWNER},
    )
    denied = [r for r in _admin_env.audit if r["decision"] == "denied"]
    assert denied, "a refused attempt to change the register left no trace"
    assert any("not_permitted" in r["action"] for r in denied)


def test_a_stranger_cannot_write_to_the_trail(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """A failed knock by somebody who is not in the register must not append a row.

    The trail is append-only, so anything a stranger can put in it, nobody can take out — an
    unauthenticated flood would be a permanent denial of service on the record itself.
    """
    for _ in range(3):
        client.get(f"{ADMIN_PREFIX}/whoami", headers=_bearer(LEARNER_SUBJECT))
    assert _admin_env.audit == []


def test_there_is_no_route_that_edits_or_deletes_the_trail(client: TestClient) -> None:
    """An admin cannot reach their own trail to change it, because no such endpoint exists."""
    from wobo_gateway.admin_auth import iter_api_routes

    audit_paths = sorted(
        (path, sorted(route.methods))
        for path, route, _ in iter_api_routes(client.app)
        if path.startswith(f"{ADMIN_PREFIX}/audit")
    )
    assert audit_paths == [(f"{ADMIN_PREFIX}/audit", ["GET"])]


def test_reading_the_trail_is_itself_recorded(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    response = client.get(f"{ADMIN_PREFIX}/audit", headers=_console(OWNER_SUBJECT, token))
    assert response.status_code == 200
    assert response.json()["append_only"] is True
    assert any(r["action"] == "admin.audit.read" for r in _admin_env.audit)


def test_no_audit_means_no_access(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the trail cannot be written, the door does not open. Not a best-effort log."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)

    def refuse(_row: dict[str, Any]) -> None:
        raise admin_auth.StoreUnavailable("the trail is down")

    monkeypatch.setattr(_admin_env, "insert_audit", refuse)
    response = client.get(f"{ADMIN_PREFIX}/whoami", headers=_console(OWNER_SUBJECT, token))
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "audit_unavailable"


# --- the hardened login path ----------------------------------------------------------------------
def test_the_login_is_rate_limited(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Trying tokens is bounded, and the bound is much tighter than an ordinary route's."""
    monkeypatch.setenv("ADMIN_LOGIN_LIMIT_PER_MINUTE", "3")
    codes = [
        client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(LEARNER_SUBJECT)).status_code
        for _ in range(6)
    ]
    assert 429 in codes
    assert codes[-1] == 429


def test_the_address_is_kept_as_a_digest_and_never_in_the_clear(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    _sign_in(client, OWNER_SUBJECT)
    held = next(iter(_admin_env.sessions.values()))
    assert held["ip_hash"]
    assert "." not in held["ip_hash"] and ":" not in held["ip_hash"]
    assert held["ip_hash"] != "testclient"


def test_a_postgrest_store_refuses_a_filter_value_that_is_not_an_id() -> None:
    """PostgREST filters have their own metacharacters, so ids are checked before interpolation."""
    store = admin_auth.PostgrestAdminStore("https://example.supabase.co", "service-key")
    with pytest.raises(admin_auth.StoreUnavailable):
        store.admin_by_subject("00000000-0000-0000-0000-000000000000,role.eq.owner")
    with pytest.raises(admin_auth.StoreUnavailable):
        store.session_by_token_hash("not-a-digest")


# --- the cookie, and why it is not a CSRF exposure ------------------------------------------------
def test_the_session_cookie_is_httponly_strict_and_scoped_to_the_console(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    response = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    raw = response.headers["set-cookie"]
    assert raw.startswith(f"{admin_auth.SESSION_COOKIE}=")
    assert "HttpOnly" in raw
    assert "SameSite=strict" in raw
    # Scoped to the admin prefix, so it is never attached to a learner route by accident.
    assert f"Path={ADMIN_PREFIX}" in raw


def test_the_cookie_alone_authorises_the_console(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The console does not have to hold the token in script for the session to work."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert admin_auth.SESSION_COOKIE in client.cookies
    # No session header on this request: the cookie the login set is the whole credential.
    response = client.get(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert response.status_code == 200
    assert response.json()["admin"]["role"] == OWNER


def test_a_cookie_without_a_verified_token_gets_nowhere(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """Why CSRF is structurally impossible here, rather than defended against.

    A browser attaches the cookie by itself; it cannot attach ``Authorization``. Every admin
    request needs a verified Supabase access token as well, so a form post from another site
    arrives with a perfectly good session cookie and is refused at the front door.
    """
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert admin_auth.SESSION_COOKIE in client.cookies
    assert client.get(f"{ADMIN_PREFIX}/session").status_code == 401
    assert client.post(f"{ADMIN_PREFIX}/admins", json={}).status_code == 401


def test_the_identity_the_shell_renders_carries_no_address(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """Show the least that does the job: a corner of a shell needs a name, not a mailbox."""
    _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "priya.n@example.com")
    token = _sign_in(client, OPERATOR_SUBJECT)
    identity = client.get(
        f"{ADMIN_PREFIX}/session", headers=_console(OPERATOR_SUBJECT, token)
    ).json()["identity"]
    assert identity["display"] == "priya.n"
    assert "@" not in identity["display"]
    assert identity["scopes"] == sorted(admin_auth.permissions_for(OPERATOR))


def test_the_register_is_re_read_on_every_request_not_only_at_login(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """A level change takes effect on the next request, not on the next sign-in."""
    admin = _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    headers = _console(OWNER_SUBJECT, token)
    assert client.get(f"{ADMIN_PREFIX}/admins", headers=headers).status_code == 200
    _admin_env.upsert_admin(
        subject_id=OWNER_SUBJECT,
        email=admin.email,
        role=VIEWER,
        granted_by=None,
        mfa_required=False,
    )
    assert client.get(f"{ADMIN_PREFIX}/admins", headers=headers).status_code == 403
