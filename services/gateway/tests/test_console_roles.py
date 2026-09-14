"""One owner, and the owner shapes every other seat (docs/CONSOLE-ROLES-AND-BOARD.md §2).

WHAT THE LAW ASKS FOR, and what each of these tests holds to it:

  * exactly ONE active owner, enforced by the database rather than by a convention, and a seat
    nobody but the owner can take away — ``test_console_roles_schema.py`` reads the constraint,
    and the register tests below prove the gateway refuses a second one before it ever gets there;
  * the three roles stay as STARTING POINTS, and the owner may grant or revoke each capability
    per person, with an audit row for every change;
  * the capabilities ARE the console's panels, read and act separately, because seeing a learner's
    day is not acting on it;
  * a panel a person cannot read is ABSENT rather than greyed, and its route refuses them exactly
    as it refuses a stranger — the same body, the same status, so nothing leaks through a
    remembered link;
  * adding a person is the owner's action alone, with a second factor before the first sign-in;
  * suspending is instant and ENDS THEIR SESSIONS.

The suite mints real Supabase-shaped tokens and sends them through the app's real middleware, so
what is under test is the door that runs in production.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, console_panels
from wobo_gateway.admin_auth import (
    ADMIN_PREFIX,
    OPERATOR,
    OWNER,
    VIEWER,
    Admin,
    InMemoryAdminStore,
)

OWNER_SUBJECT = "11111111-1111-4111-8111-111111111111"
OPERATOR_SUBJECT = "33333333-3333-4333-8333-333333333333"
NEWCOMER_SUBJECT = "55555555-5555-4555-8555-555555555555"


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


# --- the vocabulary: the capabilities are the panels ----------------------------------------------
def test_every_panel_the_law_names_is_a_capability() -> None:
    """The law lists the panels by name. Each is one capability to READ and one to ACT."""
    named = {
        "learner",
        "support",
        "curriculum",
        "models",
        "money",
        "growth",
        "mail",
        "content",
        "boards",
        "register",
    }
    have = {panel.id for panel in console_panels.PANELS}
    assert named <= have, f"the law names panels this console does not have: {named - have}"
    for panel in console_panels.PANELS:
        assert panel.read == f"panel.{panel.id}.read"
        assert panel.act == f"panel.{panel.id}.act"
        assert panel.read in console_panels.CAPABILITIES
        assert panel.act in console_panels.CAPABILITIES


def test_reading_a_panel_and_acting_on_it_are_two_different_capabilities() -> None:
    """ "Seeing a learner's day is a different thing from acting on it" — so is every other desk."""
    operator = console_panels.effective(OPERATOR, grants=(), revokes=())
    assert console_panels.panel("learner").read in operator
    assert console_panels.panel("register").read not in operator
    assert console_panels.panel("register").act not in operator

    viewer = console_panels.effective(VIEWER, grants=(), revokes=())
    assert console_panels.panel("money").read in viewer
    # The lowest seat looks and changes nothing, and identifies nobody.
    assert not any(cap.endswith(".act") for cap in viewer)
    assert console_panels.panel("learner").read not in viewer


def test_a_role_is_a_starting_point_and_the_owner_moves_it_per_person() -> None:
    """Effective = the role's defaults, plus what was granted, minus what was revoked."""
    grants = (console_panels.panel("register").read,)
    revokes = (console_panels.panel("money").read,)
    seat = console_panels.effective(OPERATOR, grants=grants, revokes=revokes)
    assert console_panels.panel("register").read in seat
    assert console_panels.panel("money").read not in seat
    # And the default is untouched for everybody else.
    assert console_panels.panel("money").read in console_panels.effective(
        OPERATOR, grants=(), revokes=()
    )


def test_the_owner_cannot_have_a_capability_taken_away() -> None:
    """The one seat that is not the owner's to lose. A revoke against it is nothing."""
    seat = console_panels.effective(OWNER, grants=(), revokes=tuple(console_panels.CAPABILITIES))
    assert seat == console_panels.CAPABILITIES


def test_an_unknown_capability_is_not_granted_by_writing_it_down() -> None:
    seat = console_panels.effective(VIEWER, grants=("panel.everything.act",), revokes=())
    assert "panel.everything.act" not in seat


# --- the map: every route belongs to a panel ------------------------------------------------------
def test_every_admin_route_is_either_identity_or_belongs_to_a_panel(client: TestClient) -> None:
    """A route nobody classified is a route the capability list does not govern.

    This is the test that keeps the law true as the console grows: a desk added tomorrow either
    names its panel here or it is refused to everybody, and there is no third outcome where it
    quietly answers to any seat that can open the console.
    """
    unmapped: list[str] = []
    for path, route, _deps in admin_auth.iter_api_routes(client.app):
        if not path.startswith(ADMIN_PREFIX):
            continue
        for method in sorted(getattr(route, "methods", set()) or set()):
            if method in {"HEAD", "OPTIONS"}:
                continue
            if console_panels.is_identity_path(path):
                continue
            if console_panels.capability_for(path, method) is None:
                unmapped.append(f"{method} {path}")
    assert not unmapped, f"admin routes with no panel: {unmapped}"


def test_a_read_needs_the_read_capability_and_a_write_needs_the_act_one() -> None:
    assert console_panels.capability_for("/v1/admin/usage", "GET") == "panel.money.read"
    assert console_panels.capability_for("/v1/admin/allowance", "POST") == "panel.money.act"
    assert console_panels.capability_for("/v1/admin/reports", "GET") == "panel.support.read"
    assert console_panels.capability_for("/v1/admin/reports/state", "POST") == "panel.support.act"
    # The one read on the support desk that names a person belongs to the learner panel instead.
    assert console_panels.capability_for("/v1/admin/reports/who", "GET") == "panel.learner.read"
    assert console_panels.capability_for("/v1/admin/admins", "GET") == "panel.register.read"
    assert console_panels.capability_for("/v1/admin/admins/abc/suspend", "POST") == (
        "panel.register.act"
    )


def test_a_path_nobody_mapped_belongs_to_no_panel() -> None:
    assert console_panels.capability_for("/v1/admin/something-new", "GET") is None
    assert not console_panels.is_identity_path("/v1/admin/something-new")


# --- the door: a panel you cannot read refuses you like a stranger --------------------------------
def test_a_revoked_panel_refuses_exactly_as_it_refuses_a_stranger(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    admin = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    _admin_env.set_capability(
        admin_id=admin.id,
        capability="panel.money.read",
        effect="revoke",
        granted_by=None,
    )
    token = _sign_in(client, OPERATOR_SUBJECT)
    refused = client.get(f"{ADMIN_PREFIX}/usage", headers=_console(OPERATOR_SUBJECT, token))
    assert refused.status_code == 403
    assert refused.json()["detail"]["message"] == admin_auth.NOT_FOR_YOU

    # The desks this seat still holds are untouched: a revoke is one panel, not the console.
    kept = client.get(f"{ADMIN_PREFIX}/reports", headers=_console(OPERATOR_SUBJECT, token))
    assert kept.status_code == 200

    # And the attempt is on the trail, because this caller IS in the register. The console has ONE
    # refusal code, ``not_permitted`` (docs/CONSOLE-ROLES-AND-BOARD.md §2 makes seeing and doing
    # one list, so a panel refusal and a permission refusal are one word on the wire and one
    # action in the audit); the detail names the panel that was missing.
    assert refused.json()["detail"]["code"] == admin_auth.NOT_PERMITTED
    actions = [row["action"] for row in _admin_env.audit]
    assert admin_auth.DENIED_ACTION in actions
    denied = [row for row in _admin_env.audit if row["action"] == admin_auth.DENIED_ACTION]
    assert denied[-1]["decision"] == "denied"
    assert denied[-1]["detail"]["capability"] == "panel.money.read"


def test_an_admin_route_nobody_mapped_is_refused_to_everybody(
    _admin_env: InMemoryAdminStore,
) -> None:
    """Fail closed. An unmapped desk is not a desk everybody can read."""
    from fastapi import FastAPI
    from wobo_gateway.app import create_app

    app: FastAPI = create_app()
    router = admin_auth.admin_router()

    @router.get("/unmapped-for-the-test")
    def _unmapped(ctx: admin_auth.Guarded) -> dict[str, bool]:  # pragma: no cover - refused
        return {"reached": True}

    app.include_router(router)
    unguarded = TestClient(app)
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(unguarded, OWNER_SUBJECT)
    answer = unguarded.get(
        f"{ADMIN_PREFIX}/unmapped-for-the-test", headers=_console(OWNER_SUBJECT, token)
    )
    assert answer.status_code == 403
    assert answer.json()["detail"]["message"] == admin_auth.NOT_FOR_YOU


def test_the_console_is_told_only_the_panels_this_seat_may_read(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """A panel a person cannot read is ABSENT. The screen cannot grey out what it never receives."""
    admin = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    _admin_env.set_capability(
        admin_id=admin.id, capability="panel.money.read", effect="revoke", granted_by=None
    )
    token = _sign_in(client, OPERATOR_SUBJECT)
    answer = client.get(f"{ADMIN_PREFIX}/panels", headers=_console(OPERATOR_SUBJECT, token))
    assert answer.status_code == 200
    body = answer.json()
    ids = {panel["id"] for panel in body["panels"]}
    assert "money" not in ids
    assert "register" not in ids
    assert "support" in ids
    support = next(panel for panel in body["panels"] if panel["id"] == "support")
    assert support["act"] is True
    # A desk an operator watches rather than works: the read is there, the act is not.
    models = next(panel for panel in body["panels"] if panel["id"] == "models")
    assert models["act"] is False


def test_the_identity_says_what_this_seat_effectively_holds(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The screen shows the EFFECTIVE set rather than the theory of a role."""
    admin = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    _admin_env.set_capability(
        admin_id=admin.id, capability="panel.register.read", effect="grant", granted_by=None
    )
    token = _sign_in(client, OPERATOR_SUBJECT)
    who = client.get(f"{ADMIN_PREFIX}/whoami", headers=_console(OPERATOR_SUBJECT, token))
    assert who.status_code == 200
    held = who.json()["admin"]["capabilities"]
    assert "panel.register.read" in held
    assert "panel.register.act" not in held


# --- the register: one owner, and the owner adds everybody else -----------------------------------
def test_a_second_owner_is_refused(client: TestClient, _admin_env: InMemoryAdminStore) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=_console(OWNER_SUBJECT, token),
        json={"email": "second@example.com", "role": OWNER},
    )
    assert answer.status_code == 400
    assert answer.json()["detail"]["code"] == "one_owner"
    assert len(_admin_env.list_admins()) == 1


def test_the_owner_adds_a_person_by_address_with_their_capabilities(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """An email, a starting role, the capabilities, and who granted them."""
    owner = _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=_console(OWNER_SUBJECT, token),
        json={
            "email": "newcomer@example.com",
            "role": VIEWER,
            "capabilities": [{"capability": "panel.support.act", "effect": "grant"}],
        },
    )
    assert answer.status_code == 200, answer.text
    added = answer.json()["admin"]
    assert added["status"] == "invited"
    assert added["email"] == "newcomer@example.com"
    # A second factor before the first sign-in, and never granted without one.
    assert added["mfa_required"] is True
    assert added["granted_by"] == owner.id
    assert "panel.support.act" in added["capabilities"]
    assert [row for row in _admin_env.audit if row["action"] == "admin.invite"]


def test_an_invitation_binds_to_the_account_that_accepts_it(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The invited row has no account id until the person signs in and proves the address."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=_console(OWNER_SUBJECT, token),
        json={"email": "newcomer@example.com", "role": VIEWER},
    )
    invited = next(a for a in _admin_env.list_admins() if a.email == "newcomer@example.com")
    assert invited.subject_id is None
    assert invited.status == "invited"

    # Somebody else's account cannot take the invitation.
    wrong = client.post(
        f"{ADMIN_PREFIX}/session",
        headers=_bearer(NEWCOMER_SUBJECT, email="someone-else@example.com"),
    )
    assert wrong.status_code == 403

    opened = client.post(
        f"{ADMIN_PREFIX}/session", headers=_bearer(NEWCOMER_SUBJECT, email="newcomer@example.com")
    )
    assert opened.status_code == 200, opened.text
    bound = next(a for a in _admin_env.list_admins() if a.email == "newcomer@example.com")
    assert bound.subject_id == NEWCOMER_SUBJECT
    assert bound.status == "active"
    assert [row for row in _admin_env.audit if row["action"] == "admin.invite.accepted"]


def test_only_the_owner_may_change_what_anybody_holds(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """Not even a seat that has been granted the register's own panel: the register ACT is the
    owner's alone, because a seat that can grant itself anything is an owner by another name."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    other = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    _admin_env.set_capability(
        admin_id=other.id, capability="panel.register.act", effect="grant", granted_by=None
    )
    token = _sign_in(client, OPERATOR_SUBJECT)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=_console(OPERATOR_SUBJECT, token),
        json={"email": "newcomer@example.com", "role": VIEWER},
    )
    assert answer.status_code == 403


def test_the_owner_grants_and_revokes_one_capability_with_a_row_to_show_for_it(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    other = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    token = _sign_in(client, OWNER_SUBJECT)

    revoked = client.post(
        f"{ADMIN_PREFIX}/admins/{other.id}/capabilities",
        headers=_console(OWNER_SUBJECT, token),
        json={"capability": "panel.money.read", "effect": "revoke"},
    )
    assert revoked.status_code == 200, revoked.text
    assert "panel.money.read" not in revoked.json()["admin"]["capabilities"]
    rows = [row for row in _admin_env.audit if row["action"] == "admin.capability"]
    assert rows and rows[-1]["detail"]["effect"] == "revoke"
    assert rows[-1]["detail"]["capability"] == "panel.money.read"
    assert rows[-1]["resource_id"] == other.id

    back = client.post(
        f"{ADMIN_PREFIX}/admins/{other.id}/capabilities",
        headers=_console(OWNER_SUBJECT, token),
        json={"capability": "panel.money.read", "effect": "default"},
    )
    assert back.status_code == 200
    assert "panel.money.read" in back.json()["admin"]["capabilities"]


def test_nothing_anybody_writes_can_take_the_owners_own_seat(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins/{owner.id}/capabilities",
        headers=_console(OWNER_SUBJECT, token),
        json={"capability": "panel.register.act", "effect": "revoke"},
    )
    assert answer.status_code == 400
    assert answer.json()["detail"]["code"] == "not_the_owners"
    still = _admin_env.admin_by_id(owner.id)
    assert console_panels.panel("register").act in admin_auth.capabilities_of(still)


def test_suspending_is_instant_and_ends_their_sessions(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    other = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    theirs = _sign_in(client, OPERATOR_SUBJECT)
    assert (
        client.get(
            f"{ADMIN_PREFIX}/reports", headers=_console(OPERATOR_SUBJECT, theirs)
        ).status_code
        == 200
    )

    owner_token = _sign_in(client, OWNER_SUBJECT)
    gone = client.post(
        f"{ADMIN_PREFIX}/admins/{other.id}/suspend", headers=_console(OWNER_SUBJECT, owner_token)
    )
    assert gone.status_code == 200
    assert gone.json()["sessions_ended"] == 1
    # Instant: the next request on the token they already hold is refused.
    after = client.get(f"{ADMIN_PREFIX}/reports", headers=_console(OPERATOR_SUBJECT, theirs))
    assert after.status_code == 403


def test_nobody_else_may_suspend_the_owner(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    other = _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    _admin_env.set_capability(
        admin_id=other.id, capability="panel.register.act", effect="grant", granted_by=None
    )
    token = _sign_in(client, OPERATOR_SUBJECT)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins/{owner.id}/suspend", headers=_console(OPERATOR_SUBJECT, token)
    )
    assert answer.status_code == 403
    assert _admin_env.admin_by_id(owner.id).status == "active"


def test_the_register_lists_the_effective_set_and_the_whole_vocabulary(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The owner's screen needs both: what each person holds, and everything grantable."""
    _register(_admin_env, OWNER_SUBJECT, OWNER, "owner@example.com")
    _register(_admin_env, OPERATOR_SUBJECT, OPERATOR, "ops@example.com")
    token = _sign_in(client, OWNER_SUBJECT)
    answer = client.get(f"{ADMIN_PREFIX}/admins", headers=_console(OWNER_SUBJECT, token))
    assert answer.status_code == 200
    body = answer.json()
    assert {panel["id"] for panel in body["vocabulary"]} == {p.id for p in console_panels.PANELS}
    seats = {row["email"]: row for row in body["admins"]}
    assert "panel.support.read" in seats["ops@example.com"]["capabilities"]
    assert "panel.register.act" not in seats["ops@example.com"]["capabilities"]
    assert body["owner_count"] == 1
