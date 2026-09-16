"""Accepting a seat proves the address twice (docs/CONSOLE-ROLES-AND-BOARD.md, 2026-09-15).

THE LAW, in its own words: "the invitation itself carries a signed, single-use, expiring link sent
to the invited address, and a seat binds only when the person arrives THROUGH that link with a token
whose verified address matches. A token alone, however verified, never binds a seat."

So every test below is one clause of that sentence:

  * signed — a link we did not sign, or one whose bytes were changed, opens nothing;
  * single-use — the second arrival through the same link binds nothing;
  * expiring — a link past its hours opens nothing, and neither does a row whose clock has run out;
  * sent to the invited address — the link is minted for ONE address and is dead for any other;
  * through that link — a verified token with no link binds nothing;
  * whose verified address matches — the right link with an unverified or different address
    binds nothing.

No mail is sent here, or anywhere in the lab: the owner's screen is handed the link and the
message, and a person sends it.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from wobo_gateway import admin_auth, admin_invite
from wobo_gateway.admin_auth import ADMIN_PREFIX, OPERATOR, OWNER, VIEWER, InMemoryAdminStore

OWNER_SUBJECT = "11111111-1111-4111-8111-111111111111"
NEWCOMER_SUBJECT = "55555555-5555-4555-8555-555555555555"
STRANGER_SUBJECT = "66666666-6666-4666-8666-666666666666"
NEWCOMER = "newcomer@example.com"


@pytest.fixture(autouse=True)
def _admin_env(monkeypatch: pytest.MonkeyPatch) -> InMemoryAdminStore:
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.setenv("CONSOLE_URL", "https://console.example.test/admin.html")
    monkeypatch.delenv("ADMIN_INVITE_SECRET", raising=False)
    monkeypatch.delenv("ADMIN_INVITE_HOURS", raising=False)
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


def _bearer(subject: str, **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(subject, secret=TEST_JWT_SECRET, **claims)}"}


def _owner(client: TestClient, store: InMemoryAdminStore) -> dict[str, str]:
    store.upsert_admin(
        subject_id=OWNER_SUBJECT,
        email="owner@example.com",
        role=OWNER,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(OWNER_SUBJECT))
    assert opened.status_code == 200, opened.text
    return {**_bearer(OWNER_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}


def _invite(client: TestClient, owner: dict[str, str], email: str = NEWCOMER) -> dict[str, Any]:
    answer = client.post(
        f"{ADMIN_PREFIX}/admins", headers=owner, json={"email": email, "role": VIEWER}
    )
    assert answer.status_code == 200, answer.text
    return answer.json()


def _token_of(link: str) -> str:
    return parse_qs(urlparse(link).query)["invite"][0]


def _arrive(
    client: TestClient,
    subject: str,
    *,
    invitation: str | None,
    email: str = NEWCOMER,
    verified: bool = True,
) -> Any:
    claims: dict[str, Any] = {"email": email}
    if verified:
        claims["email_verified"] = True
    body = {} if invitation is None else {"invitation": invitation}
    return client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(subject, **claims), json=body)


def _seat(store: InMemoryAdminStore, email: str = NEWCOMER) -> admin_auth.Admin:
    return next(a for a in store.list_admins() if a.email == email)


# --- the token itself -----------------------------------------------------------------------------
def test_a_minted_link_verifies_for_its_own_address_and_no_other() -> None:
    made = admin_invite.mint(NEWCOMER)
    assert made is not None
    assert admin_invite.verify(made.token, NEWCOMER) == made.token_hash
    # Case is not identity: the provider may hand the address back capitalised.
    assert admin_invite.verify(made.token, "NewComer@Example.com") == made.token_hash
    assert admin_invite.verify(made.token, "someone-else@example.com") is None
    assert admin_invite.verify(made.token, "") is None


def test_a_link_we_did_not_sign_opens_nothing() -> None:
    made = admin_invite.mint(NEWCOMER)
    assert made is not None
    payload, signature = made.token.split(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
    assert admin_invite.verify(f"{payload}.{flipped}", NEWCOMER) is None
    assert admin_invite.verify("not-a-token", NEWCOMER) is None
    assert admin_invite.verify(None, NEWCOMER) is None
    assert admin_invite.verify("x" * 5000, NEWCOMER) is None


def test_a_link_signed_with_another_key_opens_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_INVITE_SECRET", "one-key-for-the-console-invitations")
    made = admin_invite.mint(NEWCOMER)
    assert made is not None
    monkeypatch.setenv("ADMIN_INVITE_SECRET", "a-different-key-entirely")
    assert admin_invite.verify(made.token, NEWCOMER) is None


def test_a_link_expires() -> None:
    issued = datetime.now(UTC) - timedelta(hours=admin_invite.invite_hours() + 1)
    made = admin_invite.mint(NEWCOMER, now=issued)
    assert made is not None
    assert made.expires_at < datetime.now(UTC)
    assert admin_invite.verify(made.token, NEWCOMER) is None


def test_the_link_does_not_carry_the_address_in_the_clear() -> None:
    made = admin_invite.mint(NEWCOMER)
    assert made is not None
    assert "newcomer" not in made.link.lower()
    assert "example" not in made.token.lower()


def test_without_a_signing_key_no_link_is_minted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("ADMIN_INVITE_SECRET", raising=False)
    assert admin_invite.mint(NEWCOMER) is None


def test_without_a_console_address_no_link_is_minted_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CONSOLE_URL", raising=False)
    monkeypatch.setenv("ENV", "prod")
    assert admin_invite.mint(NEWCOMER) is None
    monkeypatch.setenv("CONSOLE_URL", "http://console.example.test/admin.html")
    assert admin_invite.mint(NEWCOMER) is None, "a link to a staff seat never travels over http"


# --- the owner invites ----------------------------------------------------------------------------
def test_the_owner_is_handed_the_link_and_the_message_and_nothing_is_sent(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from wobo_gateway import email as email_module

    def refuse(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("an invitation must not send mail from the lab")

    monkeypatch.setattr(email_module, "send_email", refuse, raising=False)
    owner = _owner(client, _admin_env)
    body = _invite(client, owner)
    invitation = body["invitation"]
    assert invitation["sent"] is False
    assert invitation["to"] == NEWCOMER
    assert invitation["link"].startswith("https://console.example.test/admin.html?invite=")
    assert invitation["expires_at"]
    assert invitation["link"] in invitation["mail"]["text"]
    assert invitation["mail"]["subject"]

    # The row keeps a digest, never the link itself, and the trail keeps neither.
    seat = _seat(_admin_env)
    token = _token_of(invitation["link"])
    assert seat.invite_token_hash == admin_invite.token_hash(token)
    assert token not in json.dumps(_admin_env.audit, default=str)
    assert token not in json.dumps(body["admin"], default=str)


def test_nobody_is_added_when_no_link_can_be_made(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = _owner(client, _admin_env)
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("CONSOLE_URL", raising=False)
    # The session was opened before the switch; the grant itself is what is under test.
    monkeypatch.setattr(admin_auth, "is_prod", lambda: False)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins", headers=owner, json={"email": NEWCOMER, "role": VIEWER}
    )
    assert answer.status_code == 503
    assert answer.json()["detail"]["code"] == "invitation_unavailable"
    assert [a.email for a in _admin_env.list_admins()] == ["owner@example.com"]


def test_a_seat_is_only_ever_added_by_address_never_bound_to_an_account_by_the_owner(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    """The route used to take an account id and make the seat live on the spot, which is a seat
    that nobody ever arrived through a link to take."""
    owner = _owner(client, _admin_env)
    answer = client.post(
        f"{ADMIN_PREFIX}/admins",
        headers=owner,
        json={"subject_id": NEWCOMER_SUBJECT, "email": NEWCOMER, "role": OPERATOR},
    )
    assert answer.status_code == 200, answer.text
    seat = _seat(_admin_env)
    assert seat.status == "invited"
    assert seat.subject_id is None


def test_an_address_that_already_has_a_seat_is_not_invited_twice(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    _invite(client, owner)
    again = client.post(
        f"{ADMIN_PREFIX}/admins", headers=owner, json={"email": NEWCOMER.upper(), "role": OPERATOR}
    )
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_invited"
    seated = client.post(
        f"{ADMIN_PREFIX}/admins", headers=owner, json={"email": "owner@example.com", "role": VIEWER}
    )
    assert seated.status_code == 409
    assert seated.json()["detail"]["code"] == "already_seated"
    assert _seat(_admin_env, "owner@example.com").role == OWNER
    assert len(_admin_env.list_admins()) == 2


def test_the_address_is_kept_lower_case(client: TestClient, _admin_env: InMemoryAdminStore) -> None:
    owner = _owner(client, _admin_env)
    _invite(client, owner, email="  NewComer@Example.COM ")
    assert _seat(_admin_env).email == NEWCOMER


# --- arriving -------------------------------------------------------------------------------------
def test_a_verified_token_alone_never_binds_a_seat(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    _invite(client, owner)
    answer = _arrive(client, NEWCOMER_SUBJECT, invitation=None)
    assert answer.status_code == 403
    assert answer.json()["detail"]["code"] == "invitation_link_required"
    seat = _seat(_admin_env)
    assert seat.subject_id is None and seat.status == "invited"
    assert any(r["action"] == "admin.invite.denied" for r in _admin_env.audit)


def test_the_link_with_the_matching_verified_address_binds_the_seat_once(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    token = _token_of(_invite(client, owner)["invitation"]["link"])
    opened = _arrive(client, NEWCOMER_SUBJECT, invitation=token)
    assert opened.status_code == 200, opened.text
    seat = _seat(_admin_env)
    assert seat.subject_id == NEWCOMER_SUBJECT
    assert seat.status == "active"
    # Single use: the digest is gone the moment the seat is taken.
    assert seat.invite_token_hash is None
    accepted = [r for r in _admin_env.audit if r["action"] == "admin.invite.accepted"]
    assert len(accepted) == 1

    # The same person signs in again later: their seat is theirs by account now, link or no link.
    again = _arrive(client, NEWCOMER_SUBJECT, invitation=None)
    assert again.status_code == 200

    # A second account that also proves the address cannot use the same link again.
    reused = _arrive(client, STRANGER_SUBJECT, invitation=token)
    assert reused.status_code == 403
    assert _seat(_admin_env).subject_id == NEWCOMER_SUBJECT


def test_the_link_with_an_unverified_address_binds_nothing(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    token = _token_of(_invite(client, owner)["invitation"]["link"])
    answer = _arrive(client, NEWCOMER_SUBJECT, invitation=token, verified=False)
    assert answer.status_code == 403
    assert _seat(_admin_env).subject_id is None


def test_the_link_with_a_different_verified_address_binds_nothing(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    token = _token_of(_invite(client, owner)["invitation"]["link"])
    answer = _arrive(client, STRANGER_SUBJECT, invitation=token, email="stranger@example.com")
    assert answer.status_code == 403
    # A stranger is told what every stranger is told, and nothing about the seat.
    assert answer.json()["detail"]["message"] == admin_auth.NOT_FOR_YOU
    assert _seat(_admin_env).subject_id is None


def test_one_seats_link_cannot_open_another_seat(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    first = _token_of(_invite(client, owner)["invitation"]["link"])
    _invite(client, owner, email="second@example.com")
    answer = _arrive(client, STRANGER_SUBJECT, invitation=first, email="second@example.com")
    assert answer.status_code == 403
    assert _seat(_admin_env, "second@example.com").subject_id is None
    assert _seat(_admin_env).subject_id is None


def test_a_row_whose_clock_ran_out_binds_nothing_even_with_a_live_signature(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    token = _token_of(_invite(client, owner)["invitation"]["link"])
    seat = _seat(_admin_env)
    from dataclasses import replace

    _admin_env.admins[seat.id] = replace(
        _admin_env.admins[seat.id], invite_expires_at=datetime.now(UTC) - timedelta(minutes=1)
    )
    answer = _arrive(client, NEWCOMER_SUBJECT, invitation=token)
    assert answer.status_code == 403
    assert answer.json()["detail"]["code"] == "invitation_link_required"
    assert _seat(_admin_env).subject_id is None


def test_the_second_factor_is_still_demanded_before_the_seat_binds(
    client: TestClient, _admin_env: InMemoryAdminStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = _owner(client, _admin_env)
    token = _token_of(_invite(client, owner)["invitation"]["link"])
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "1")
    weak = client.post(
        f"{ADMIN_PREFIX}/session",
        headers=_bearer(NEWCOMER_SUBJECT, email=NEWCOMER, email_verified=True, aal="aal1"),
        json={"invitation": token},
    )
    assert weak.status_code == 401
    assert weak.json()["detail"]["code"] == "mfa_required"
    # The link is not spent by a refusal: the person enrols a factor and uses the same link.
    assert _seat(_admin_env).subject_id is None
    strong = client.post(
        f"{ADMIN_PREFIX}/session",
        headers=_bearer(NEWCOMER_SUBJECT, email=NEWCOMER, email_verified=True, aal="aal2"),
        json={"invitation": token},
    )
    assert strong.status_code == 200, strong.text


# --- a fresh link ---------------------------------------------------------------------------------
def test_the_owner_can_send_a_fresh_link_and_the_old_one_dies(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    old = _token_of(_invite(client, owner)["invitation"]["link"])
    seat = _seat(_admin_env)
    fresh = client.post(f"{ADMIN_PREFIX}/admins/{seat.id}/invitation", headers=owner)
    assert fresh.status_code == 200, fresh.text
    new = _token_of(fresh.json()["invitation"]["link"])
    assert new != old
    assert any(r["action"] == "admin.invite.renewed" for r in _admin_env.audit)

    assert _arrive(client, NEWCOMER_SUBJECT, invitation=old).status_code == 403
    assert _arrive(client, NEWCOMER_SUBJECT, invitation=new).status_code == 200


def test_a_fresh_link_is_only_for_a_seat_nobody_has_taken(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    mine = _seat(_admin_env, "owner@example.com")
    answer = client.post(f"{ADMIN_PREFIX}/admins/{mine.id}/invitation", headers=owner)
    assert answer.status_code == 400
    assert answer.json()["detail"]["code"] == "not_an_invitation"


def test_only_the_owner_may_send_a_fresh_link(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    _invite(client, owner)
    seat = _seat(_admin_env)
    _admin_env.upsert_admin(
        subject_id=STRANGER_SUBJECT,
        email="ops@example.com",
        role=OPERATOR,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=_bearer(STRANGER_SUBJECT))
    ops = {**_bearer(STRANGER_SUBJECT), admin_auth.SESSION_HEADER: opened.json()["session_token"]}
    assert (
        client.post(f"{ADMIN_PREFIX}/admins/{seat.id}/invitation", headers=ops).status_code == 403
    )


# --- the message a person sends -------------------------------------------------------------------
def test_the_invitation_message_says_what_it_is_and_nothing_else() -> None:
    link = "https://console.example.test/admin.html?invite=abc.def"
    mail = admin_invite.invitation_mail(
        {"link": link, "role": OPERATOR, "expires_at": datetime(2026, 9, 20, 9, 30, tzinfo=UTC)}
    )
    assert set(mail) >= {"subject", "html", "text"}
    for part in (mail["subject"], mail["text"]):
        assert "—" not in part, "no em dash where a person reads"
        assert "!" not in part
    assert link in mail["text"]
    assert link.replace("&", "&amp;") in mail["html"]
    assert "20 September 2026" in mail["text"]
    assert "second factor" in mail["text"].lower()
    lowered = (mail["subject"] + mail["text"]).lower()
    for word in ("price", "rupee", "plan", "free", "discount"):
        assert word not in lowered
    assert "<script" not in mail["html"].lower()


def test_the_message_escapes_what_it_is_given() -> None:
    mail = admin_invite.invitation_mail(
        {"link": 'https://console.example.test/admin.html?invite="><b>x', "role": "<i>"}
    )
    assert "<b>x" not in mail["html"]
    assert "<i>" not in mail["html"]


# --- the database store ---------------------------------------------------------------------------
class _Recorder:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.rows = rows if rows is not None else []

    def __call__(
        self, url: str, key: str, method: str, *, body: Any = None, want_rows: bool
    ) -> Any:
        self.calls.append({"url": url, "method": method, "body": body})
        return self.rows


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


ROW_ID = "77777777-7777-4777-8777-777777777777"


def test_the_database_store_can_find_an_invitation_by_a_real_address() -> None:
    """Every real address has a dot in it, and the store used to refuse every dot, so no
    invitation could ever be accepted against the real register."""
    recorder = _Recorder([{"id": ROW_ID, "email": NEWCOMER, "status": "invited", "role": VIEWER}])
    store = admin_auth.PostgrestAdminStore("https://p.example", "k", request=recorder)
    found = store.admin_by_email("NewComer@Example.com")
    assert found is not None and found.email == NEWCOMER
    query = _query(recorder.calls[0]["url"])
    # Exact, not a pattern: `ilike` reads `_` and `*` as wildcards, so a_b@x matched axb@x.
    assert query["email"] == [f"eq.{NEWCOMER}"]


@pytest.mark.parametrize("address", ["a*b@example.com", "a,b@example.com", "a b@example.com", "x"])
def test_the_database_store_refuses_an_address_it_cannot_look_up_safely(address: str) -> None:
    recorder = _Recorder()
    store = admin_auth.PostgrestAdminStore("https://p.example", "k", request=recorder)
    with pytest.raises(admin_auth.BadIdentifier):
        store.admin_by_email(address)
    assert recorder.calls == []


def test_the_database_store_writes_an_invitation_as_a_plain_insert() -> None:
    """``ops.admins`` has no unique constraint on the address (0029's index is partial and on
    lower(email)), so an upsert keyed on ``email`` is refused by Postgres every time."""
    recorder = _Recorder([{"id": ROW_ID, "email": NEWCOMER, "status": "invited", "role": VIEWER}])
    store = admin_auth.PostgrestAdminStore("https://p.example", "k", request=recorder)
    expires = datetime.now(UTC) + timedelta(hours=1)
    store.upsert_admin(
        subject_id=None,
        email=NEWCOMER,
        role=VIEWER,
        granted_by=None,
        mfa_required=True,
        status="invited",
        invite_token_hash="a" * 64,
        invite_expires_at=expires,
    )
    call = recorder.calls[0]
    assert call["method"] == "POST"
    assert "on_conflict" not in _query(call["url"])
    row = call["body"][0]
    assert row["invite_token_hash"] == "a" * 64
    assert row["invite_expires_at"] == expires.isoformat()
    assert row["subject_id"] is None


def test_the_database_store_binds_only_while_the_same_link_is_outstanding() -> None:
    recorder = _Recorder([{"id": ROW_ID, "email": NEWCOMER, "status": "active", "role": VIEWER}])
    store = admin_auth.PostgrestAdminStore("https://p.example", "k", request=recorder)
    store.bind_subject(ROW_ID, NEWCOMER_SUBJECT, "b" * 64)
    call = recorder.calls[0]
    query = _query(call["url"])
    assert call["method"] == "PATCH"
    assert query["subject_id"] == ["is.null"]
    assert query["status"] == ["eq.invited"]
    assert query["invite_token_hash"] == ["eq." + "b" * 64]
    assert query["invite_expires_at"][0].startswith("gt.")
    assert call["body"]["invite_token_hash"] is None
    assert call["body"]["subject_id"] == NEWCOMER_SUBJECT
    assert call["body"]["status"] == "active"


def test_the_database_store_renews_a_link_only_on_an_untaken_seat() -> None:
    recorder = _Recorder([{"id": ROW_ID, "email": NEWCOMER, "status": "invited", "role": VIEWER}])
    store = admin_auth.PostgrestAdminStore("https://p.example", "k", request=recorder)
    store.set_invitation(ROW_ID, "c" * 64, datetime.now(UTC))
    call = recorder.calls[0]
    query = _query(call["url"])
    assert call["method"] == "PATCH"
    assert query["status"] == ["eq.invited"]
    assert query["subject_id"] == ["is.null"]
    assert call["body"]["invite_token_hash"] == "c" * 64


def test_a_seat_row_never_hands_its_digest_to_a_screen() -> None:
    row = {
        "id": ROW_ID,
        "email": NEWCOMER,
        "status": "invited",
        "role": VIEWER,
        "invite_token_hash": "d" * 64,
        "invite_expires_at": "2026-09-20T09:30:00+00:00",
    }
    admin = admin_auth._admin_from_row(row)
    assert admin is not None and admin.invite_token_hash == "d" * 64
    view = admin_auth._admin_view(admin)
    assert "d" * 64 not in json.dumps(view)
    assert view["invitation_expires_at"] == "2026-09-20T09:30:00+00:00"


def test_suspending_a_seat_nobody_took_kills_its_link(
    client: TestClient, _admin_env: InMemoryAdminStore
) -> None:
    owner = _owner(client, _admin_env)
    token = _token_of(_invite(client, owner)["invitation"]["link"])
    seat = _seat(_admin_env)
    assert client.post(f"{ADMIN_PREFIX}/admins/{seat.id}/suspend", headers=owner).status_code == 200
    held = _admin_env.admin_by_id(seat.id)
    assert held is not None and held.invite_token_hash is None
    assert _arrive(client, NEWCOMER_SUBJECT, invitation=token).status_code == 403


def test_the_database_store_clears_the_link_when_it_suspends() -> None:
    recorder = _Recorder([{"id": ROW_ID, "email": NEWCOMER, "status": "suspended", "role": VIEWER}])
    store = admin_auth.PostgrestAdminStore("https://p.example", "k", request=recorder)
    store.set_admin_status(ROW_ID, "suspended")
    body = recorder.calls[0]["body"]
    assert body["status"] == "suspended"
    assert body["invite_token_hash"] is None and body["invite_expires_at"] is None
