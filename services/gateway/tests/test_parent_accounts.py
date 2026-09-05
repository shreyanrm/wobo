"""The parent account: two kinds of account, four actions, and one server-side switch.

The owner, 2026-09-05, twice over:

    "the student accounts are completely different, they have no switching, its only signup/login
     and logout."
    "the switching is for the parent cause they have very little actions, that too if they are
     linked only. They get to ask Wobo about their children academics, they get to pay for the
     subscriptions, refer, donate and thats pretty much it, and switch between their children in
     the same account to perform the same tasks individually."

Every test here is one sentence of that, or one of the refusals it implies. The ones that matter
most are the negative ones: a student account is refused outright rather than handed an empty
list, a parent cannot reach a child who has not linked them, a revoked link stops at the very next
request, and the address that decides which family a parent inherits comes from the verified token
and never from the body.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import mint
from fastapi.testclient import TestClient
from wobo_gateway import parent_account as accounts
from wobo_gateway import parents
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

PARENT_EMAIL = "a.parent@example.test"
OTHER_EMAIL = "another.parent@example.test"
PARENT_SUBJECT = "parent-account-under-test"
LEARNER = "learner-one"
SECOND_LEARNER = "learner-two"


@pytest.fixture(autouse=True)
def _stores() -> Any:
    parents.set_store(parents.InMemoryParentLinkStore())
    accounts.set_store(accounts.InMemoryParentStore())
    yield
    parents.set_store(None)
    accounts.set_store(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def auth(
    subject: str, *, email: str | None = None, confirmed: bool = True
) -> dict[str, str]:
    """A token for this parent. ``confirmed`` is whether the identity provider says the address
    was actually proved — which is the difference between a parent and a stranger who typed a
    parent's address into their own sign-up."""
    claims: dict[str, Any] = {}
    if email:
        claims["email"] = email
        claims["email_verified"] = confirmed
    return {"Authorization": f"Bearer {mint(subject, **claims)}"}


def link_a_parent(
    learner_id: str = LEARNER, *, email: str = PARENT_EMAIL, name: str = "Learner"
) -> parents.ParentLink:
    """A family linked the OLD way: an address, a digest, and no parent account anywhere.

    This is the state every family is in before this wave, and it is the state the sign-up path
    has to pick up without anybody being re-invited.
    """
    from datetime import UTC, datetime

    store = parents.get_store()
    digest = parents.email_hash(email)
    assert digest is not None
    now = datetime.now(UTC)
    return store.insert(
        parents.ParentLink(
            id=f"link-{learner_id}",
            learner_id=learner_id,
            parent_email_hash=digest,
            parent_email=email,
            learner_name=name,
            timezone="Asia/Kolkata",
            status="linked",
            invited_at=now,
            linked_at=now,
        )
    )


def sign_up(
    client: TestClient,
    *,
    email: str = PARENT_EMAIL,
    subject: str = PARENT_SUBJECT,
    confirmed: bool = True,
) -> Any:
    return client.post(
        "/v1/parent/sign-up",
        json={"display_name": "Parent"},
        headers=auth(subject, email=email, confirmed=confirmed)
    )


# --- two kinds of account, and they are not variations of one thing ------------------------------
def test_a_student_account_is_refused_outright_and_never_handed_an_empty_list(
    client: TestClient,
) -> None:
    """The owner's ruling, enforced. A student account has no switching AT ALL.

    Answering "you have no children" would describe a chooser that does not exist and leave a seam
    for one. Every route on the parent surface answers 403 with the same code, including the list
    and the switch.
    """
    headers = auth("a-student-account", email="student@example.test")
    for method, path, body in (
        ("GET", "/v1/parent/me", None),
        ("GET", "/v1/parent/children", None),
        ("POST", "/v1/parent/switch", {"learner_id": LEARNER}),
        ("GET", "/v1/parent/child", None),
        ("POST", "/v1/parent/ask", {"question": "How is the week going?"}),
        ("GET", "/v1/parent/mind", None),
    ):
        res = client.request(method, path, json=body, headers=headers)
        assert res.status_code == 403, f"{method} {path} answered {res.status_code}"
        assert res.json()["detail"]["code"] == "not_a_parent_account", path
        assert "children" not in res.text and "[]" not in res.text


def test_an_anonymous_caller_is_never_a_parent(client: TestClient) -> None:
    token = mint("anon-visitor", anonymous=True)
    res = client.get("/v1/parent/children", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "not_a_parent_account"


def test_which_kind_an_account_is_is_a_server_side_fact(client: TestClient) -> None:
    """A client cannot assert its way into being a parent: the row is the whole of the decision.

    The body carries a display name and nothing else — no kind, no role, no learner ids — and the
    model refuses anything extra, so there is nothing to smuggle.
    """
    res = client.post(
        "/v1/parent/sign-up",
        json={"display_name": "Parent", "kind": "parent", "children": [LEARNER]},
        headers=auth(PARENT_SUBJECT, email=PARENT_EMAIL),
    )
    assert res.status_code == 422, res.text


# --- one parent, several children, and the families that predate this file ------------------------
def test_signing_up_picks_up_a_family_linked_by_address_before_parent_accounts_existed(
    client: TestClient,
) -> None:
    """Migration path (b): nobody is stranded and nobody is re-invited.

    The old link carries a keyed digest of the parent's address. The parent signs up with the same
    address, the digest matches, and the link becomes a real relationship between two accounts.
    """
    link_a_parent()
    res = sign_up(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["account"]["kind"] == "parent"
    assert [c["learner_id"] for c in body["children"]] == [LEARNER]

    listed = client.get("/v1/parent/children", headers=auth(PARENT_SUBJECT, email=PARENT_EMAIL))
    assert [c["learner_id"] for c in listed.json()["children"]] == [LEARNER]


def test_one_parent_may_hold_several_children(client: TestClient) -> None:
    link_a_parent(LEARNER, name="Learner")
    link_a_parent(SECOND_LEARNER, name="Sibling")
    sign_up(client)
    listed = client.get("/v1/parent/children", headers=auth(PARENT_SUBJECT, email=PARENT_EMAIL))
    assert sorted(c["learner_id"] for c in listed.json()["children"]) == [LEARNER, SECOND_LEARNER]


def test_a_child_linked_after_the_parent_signed_up_is_picked_up_on_the_next_look(
    client: TestClient,
) -> None:
    """Claiming runs on every sign-up call, not once. A learner who invites their parent after the
    parent already has an account is found the next time the parent looks."""
    link_a_parent(LEARNER)
    sign_up(client)
    link_a_parent(SECOND_LEARNER, name="Sibling")
    again = sign_up(client)
    assert sorted(c["learner_id"] for c in again.json()["children"]) == [LEARNER, SECOND_LEARNER]


def test_the_address_comes_from_the_token_and_never_from_the_body(client: TestClient) -> None:
    """The one that would be a catastrophe. If the address were read from the request, a
    signed-in stranger could type any parent's address and inherit their children."""
    link_a_parent(LEARNER, email=PARENT_EMAIL)
    res = client.post(
        "/v1/parent/sign-up",
        json={"display_name": "Parent", "email": PARENT_EMAIL},
        headers=auth("a-stranger", email=OTHER_EMAIL),
    )
    assert res.status_code == 422, "an email in the body must be refused outright"

    honest = sign_up(client, email=OTHER_EMAIL, subject="a-stranger")
    assert honest.status_code == 200
    assert honest.json()["children"] == [], "a stranger inherits nobody"


def test_a_token_with_no_address_claims_nothing(client: TestClient) -> None:
    link_a_parent()
    res = client.post("/v1/parent/sign-up", json={}, headers=auth(PARENT_SUBJECT))
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "no_address"


def test_two_parent_accounts_cannot_hold_the_same_link(client: TestClient) -> None:
    """The unique index on ``link_id``. One consent row, one parent account."""
    link_a_parent(LEARNER, email=PARENT_EMAIL)
    sign_up(client)
    store = accounts.get_store()
    intruder = store.put_account(
        accounts.ParentAccount(
            account_id="second-parent",
            email_hash=parents.email_hash(PARENT_EMAIL) or "",
        )
    )
    claimed = accounts.claim_links(store, intruder)
    assert claimed == [], "the link was already held; it is not theirs to take"


# --- the switch -----------------------------------------------------------------------------------
def test_the_switch_is_a_server_side_selection_and_mints_a_fresh_scope(client: TestClient) -> None:
    """Switching leaves nothing of the previous child behind.

    A parent switching children puts two learners on ONE DEVICE by design, so the server hands the
    client a new scope id on every switch and the client drops what it was holding.
    """
    link_a_parent(LEARNER, name="Learner")
    link_a_parent(SECOND_LEARNER, name="Sibling")
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)

    first = client.post("/v1/parent/switch", json={"learner_id": LEARNER}, headers=headers)
    assert first.status_code == 200, first.text
    second = client.post("/v1/parent/switch", json={"learner_id": SECOND_LEARNER}, headers=headers)
    assert second.status_code == 200
    assert first.json()["scope"] != second.json()["scope"], "a switch must invalidate the cache"

    now = client.get("/v1/parent/child", headers=headers)
    assert now.json()["child"]["learner_id"] == SECOND_LEARNER


def test_a_parent_cannot_switch_to_a_child_who_has_not_linked_them(client: TestClient) -> None:
    link_a_parent(LEARNER)
    sign_up(client)
    res = client.post(
        "/v1/parent/switch",
        json={"learner_id": "a-child-who-never-linked-anyone"},
        headers=auth(PARENT_SUBJECT, email=PARENT_EMAIL),
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "no_such_child"


def test_nothing_is_scoped_until_a_child_is_chosen(client: TestClient) -> None:
    link_a_parent(LEARNER)
    sign_up(client)
    res = client.get("/v1/parent/child", headers=auth(PARENT_SUBJECT, email=PARENT_EMAIL))
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "no_child_selected"


def test_the_scoped_read_never_takes_the_child_from_the_body(client: TestClient) -> None:
    """Every scoped route re-derives the child from the selection row. There is no learner id on
    any of their bodies, so an extra field is refused rather than honoured."""
    link_a_parent(LEARNER)
    link_a_parent(SECOND_LEARNER, name="Sibling")
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    client.post("/v1/parent/switch", json={"learner_id": LEARNER}, headers=headers)
    res = client.post(
        "/v1/parent/ask",
        json={"question": "How is the week?", "learner_id": SECOND_LEARNER},
        headers=headers,
    )
    assert res.status_code == 422, "a learner id in the body is not a thing this route accepts"


# --- revocation stops at once ---------------------------------------------------------------------
def test_a_learner_ending_the_link_stops_the_parent_at_the_very_next_request(
    client: TestClient,
) -> None:
    """Not on the next sign-in, not when a cache expires: the next request.

    The consent lives in one place and is re-read every time, which is why there is nothing left
    alive to serve.
    """
    link_a_parent(LEARNER)
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    client.post("/v1/parent/switch", json={"learner_id": LEARNER}, headers=headers)
    assert client.get("/v1/parent/child", headers=headers).status_code == 200

    ended = client.delete("/v1/me/parent-link", headers=auth(LEARNER))
    assert ended.status_code == 200 and ended.json()["ended"] is True

    assert client.get("/v1/parent/children", headers=headers).json()["children"] == []
    after = client.get("/v1/parent/child", headers=headers)
    assert after.status_code == 409, "a stale selection is exactly the cached view revoke kills"
    assert (
        client.post(
            "/v1/parent/ask", json={"question": "How is it going?"}, headers=headers
        ).status_code
        == 409
    )


def test_a_parent_saying_not_me_stops_their_own_access_too(client: TestClient) -> None:
    """Both sides of the consent still work, which was the promise before this wave and after."""
    from datetime import UTC, datetime

    store = parents.get_store()
    digest = parents.email_hash(PARENT_EMAIL)
    assert digest is not None
    now = datetime.now(UTC)
    token = parents.invite_token("link-decline", LEARNER, issued=now)
    assert token is not None
    store.insert(
        parents.ParentLink(
            id="link-decline",
            learner_id=LEARNER,
            parent_email_hash=digest,
            parent_email=PARENT_EMAIL,
            learner_name="Learner",
            timezone=None,
            status="invited",
            invited_at=now,
            invite_token_hash=parents.token_hash(token),
        )
    )
    assert parents.accept(store, token).kind == "done"
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    assert client.get("/v1/parent/children", headers=headers).json()["children"]

    # The parent's own "not me" on a fresh link, from the same address.
    parents.revoke(store, LEARNER)
    assert client.get("/v1/parent/children", headers=headers).json()["children"] == []


# --- the under-13 case is different, and is not flattened -----------------------------------------
def test_a_guardian_of_a_small_child_reads_no_more_than_a_linked_parent() -> None:
    """docs/legal/parental-consent.md §1 and screens/auth/age.ts: below thirteen a parent or
    guardian holds the account WITH the child. That is a different relationship, and it is
    recorded rather than flattened — but it grants NOTHING extra to read.

    If these two ever diverge, the guardian of a small child has quietly become a reader of a
    teenager's private work, which is the exact failure the brief names.
    """
    assert accounts.readable_for("account_holder") == accounts.readable_for("linked_parent")
    assert set(accounts.readable_for("account_holder")) == set(accounts.READABLE_OF_A_CHILD)
    # And what the holder does get is not a read of the child at all.
    # And the second relationship is a shape rather than a behaviour today: nothing writes it,
    # which is said out loud rather than implied, because a guarantee about a relationship that
    # cannot occur is not a guarantee about anything.
    assert accounts.DEFAULT_RELATIONSHIP == "linked_parent"


def test_the_read_ceiling_never_includes_the_things_a_parent_must_not_see() -> None:
    assert not set(accounts.READABLE_OF_A_CHILD) & set(accounts.FORBIDDEN_OF_A_CHILD)


def test_the_four_actions_are_the_whole_of_it() -> None:
    """A fifth action is a decision somebody has to make on purpose, not one that arrives."""
    assert accounts.PARENT_ACTIONS == ("ask", "pay", "refer", "donate")


def test_a_relationship_is_never_something_a_client_declares(client: TestClient) -> None:
    link_a_parent(LEARNER)
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    res = client.post(
        "/v1/parent/switch",
        json={"learner_id": LEARNER, "relationship": "account_holder"},
        headers=headers,
    )
    assert res.status_code == 422
    stored = accounts.get_store().links(PARENT_SUBJECT)
    assert [link.relationship for link in stored] == ["linked_parent"]


# --- the trail ------------------------------------------------------------------------------------
def test_every_parent_read_of_a_child_leaves_a_row(client: TestClient) -> None:
    """Who looked, at what, when. Reads are audited and not only writes: the risk on a surface
    over a child's data is somebody LOOKING."""
    link_a_parent(LEARNER)
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    client.post("/v1/parent/switch", json={"learner_id": LEARNER}, headers=headers)
    client.get("/v1/parent/child", headers=headers)
    client.get("/v1/parent/children", headers=headers)

    store = accounts.get_store()
    assert isinstance(store, accounts.InMemoryParentStore)
    actions = [row["action"] for row in store.trail]
    assert "child.switch" in actions
    assert "child.report.read" in actions
    assert "children.list" in actions
    read = next(r for r in store.trail if r["action"] == "child.report.read")
    assert read["learner_id"] == LEARNER and read["decision"] == "allowed"


def test_a_refusal_is_recorded_too(client: TestClient) -> None:
    """A wall of denied rows against one account is somebody trying doors."""
    client.get("/v1/parent/children", headers=auth("a-student-account", email="s@example.test"))
    store = accounts.get_store()
    assert isinstance(store, accounts.InMemoryParentStore)
    denied = [row for row in store.trail if row["decision"] == "denied"]
    assert denied and denied[0]["parent_account_id"] == "a-student-account"


def test_the_trail_never_carries_what_anybody_wrote(client: TestClient) -> None:
    """``detail`` is counts, ids and filters. Not a place to copy a child's content into, and not
    a place a parent's own sentence lands either."""
    link_a_parent(LEARNER)
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    client.post("/v1/parent/switch", json={"learner_id": LEARNER}, headers=headers)
    secret = "the household is moving to a new city in July"
    client.post("/v1/parent/mind", json={"body": secret, "scope": "family"}, headers=headers)
    store = accounts.get_store()
    assert isinstance(store, accounts.InMemoryParentStore)
    assert secret not in str(store.trail)


# --- the erase reaches the parent plane -----------------------------------------------------------
def test_a_learner_asking_to_be_forgotten_is_forgotten_by_their_parent_too(
    client: TestClient,
) -> None:
    """Erasure reaches every store (docs/MEMORY-LAW.md). The bindings go, the selection goes, and
    the parent's remembered picture of them is retired."""
    link_a_parent(LEARNER)
    sign_up(client)
    headers = auth(PARENT_SUBJECT, email=PARENT_EMAIL)
    client.post("/v1/parent/switch", json={"learner_id": LEARNER}, headers=headers)
    client.post("/v1/parent/mind", json={"body": "they go quiet when behind"}, headers=headers)

    erased = client.post("/v1/me/erase", headers=auth(LEARNER))
    assert erased.status_code == 200, erased.text
    assert erased.json()["erased"]["parent_plane"] == 1

    store = accounts.get_store()
    assert store.links(PARENT_SUBJECT) == []
    assert store.mind_facts(PARENT_SUBJECT, LEARNER) == []


# --- who may inherit a family ---------------------------------------------------------------------
def test_a_stranger_with_an_unconfirmed_address_cannot_inherit_a_family(
    client: TestClient,
) -> None:
    """PROVEN LEAK, and refusing an ``email`` field in the body only moved it an inch.

    "Verified" meant the token's SIGNATURE was verified, not the address. Nothing anywhere checked
    ``email_verified`` or ``email_confirmed_at``, so on a project with confirmations off — or
    through any flow that mints a token before confirmation — the address claim is chosen by
    whoever signs up. A stranger typing a parent's address held the family: switch to the child,
    read their week, offer facts into their mind. Every invite, expiry and replay check in
    parents.py is bypassed, because the claim is matched on its digest alone.
    """
    link_a_parent()
    stranger = client.post(
        "/v1/parent/sign-up",
        json={"display_name": "Not their parent"},
        headers=auth("a-total-stranger", email=PARENT_EMAIL, confirmed=False),
    )
    assert stranger.status_code == 403
    assert stranger.json()["detail"]["code"] == "address_not_confirmed"
    # and they hold nothing: no account, no children, no way to switch
    theirs = auth("a-total-stranger", email=PARENT_EMAIL)
    assert client.get("/v1/parent/me", headers=theirs).status_code == 403
    assert (
        client.post(
            "/v1/parent/switch",
            json={"learner_id": LEARNER},
            headers=auth("a-total-stranger", email=PARENT_EMAIL, confirmed=False),
        ).status_code
        == 403
    )


def test_the_parent_whose_address_it_actually_is_still_gets_their_family(
    client: TestClient,
) -> None:
    """The other direction, and the one that matters more: nothing about this makes a real parent
    do anything they were not already doing."""
    link_a_parent()
    res = sign_up(client)
    assert res.status_code == 200, res.text
    assert [c["learner_id"] for c in res.json()["children"]] == [LEARNER]


def test_an_account_that_is_already_learning_cannot_become_a_parent_account(
    client: TestClient,
) -> None:
    """The two kinds are mutually exclusive FOR LIFE, and 0019's trigger looked at one table. A
    signed-in learner who had not yet written a state row could sign up as a parent and be refused
    learner state forever afterwards — a fresh account bricked by one unlucky call, with no route
    that deletes a parent row and no way back."""
    from wobo_gateway import mind as child_mind

    child_mind.get_store().put(
        "a-learner-signing-up", child_mind.Write(remember_facts=("plays cricket",))
    )
    refused = client.post(
        "/v1/parent/sign-up",
        json={},
        headers=auth("a-learner-signing-up", email="learner@example.test"),
    )
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "already_a_learner"
    assert accounts.get_store().account("a-learner-signing-up") is None
