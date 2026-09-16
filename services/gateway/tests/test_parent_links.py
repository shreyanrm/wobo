"""The parent link (WOBO-PLAN §14, §14.1 "confirm everything") — invite, accept, decline, revoke.

Driven through the real app with the real door: the learner's routes need a verified token, the
parent's pages need none — the signed, single-use invite token is the whole authority. No network
anywhere: console mail, the in-memory stores, the checked-in calendar.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import app as app_mod
from wobo_gateway import parents
from wobo_gateway.app import Gateway, create_app
from wobo_gateway.cache import InMemoryCache
from wobo_gateway.email import mail_log, to_hash
from wobo_gateway.email_templates import HAND_KINDS, KINDS, PAPER_KINDS, render
from wobo_gateway.hospitality import festivals as fest
from wobo_gateway.hospitality import jobs
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.tokens import parse_stop_token
from wobo_gateway.parents import (
    InMemoryParentLinkStore,
    ParentLink,
    PostgrestParentLinkStore,
    Refused,
    StoreUnavailable,
)
from wobo_gateway.providers import MockProvider
from wobo_gateway.telemetry import MetricsSink

INVITE = "/v1/me/parent-invite"
LINK = "/v1/me/parent-link"
ACCEPT = "/v1/parent/accept"
DECLINE = "/v1/parent/decline"
PARENT = "parent@example.test"
# WOBO-PLAN §17: nothing a reader sees names a provider, a model or a vendor.
VENDOR = re.compile(
    r"\b(gemini|openai|anthropic|claude|litellm|supabase|railway|vercel|resend|postgrest)\b", re.I
)
# §19 and §20: no gendered pronoun anywhere in the invite — not for Wobo, not for the learner.
GENDERED = re.compile(r"\b(she|he|her|him|his|hers)\b", re.I)
KINSHIP = re.compile(r"\b(amma|ammi|mummy|mum|mom|papa|appa|abbu|dada|dadi|nana|nani)\b", re.I)


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("PARENT_LINKS_STORE", "memory")
    monkeypatch.setenv("MAIL_PREFERENCES_STORE", "memory")
    monkeypatch.delenv("MAIL_TOKEN_SECRET", raising=False)
    monkeypatch.delenv("GATEWAY_URL", raising=False)
    monkeypatch.delenv("PARENT_INVITE_DAYS", raising=False)
    store = InMemoryParentLinkStore()
    parents.set_store(store)
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    fest.set_calendar(None)
    yield store
    parents.set_store(None)
    prefs_mod.set_store(None)
    fest.set_calendar(None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Gateway(MockProvider(), InMemoryCache(), MetricsSink())))


def only_link(store: InMemoryParentLinkStore) -> ParentLink:
    [link] = store.rows.values()
    return link


def token_for(link: ParentLink) -> str:
    """The token the invite carried, re-minted from the row (same id, learner and moment)."""
    token = parents.invite_token(link.id, link.learner_id, issued=link.invited_at)
    assert token and parents.token_hash(token) == link.invite_token_hash
    return token


def invite(client: TestClient, auth: Any, **extra: Any) -> Any:
    return client.post(
        INVITE, json={"email": PARENT, "learner_name": "Learner One", **extra}, headers=auth()
    )


# --- the door -------------------------------------------------------------------------------------
def test_the_learners_routes_are_behind_the_door_and_the_parents_pages_are_not(
    client: TestClient, auth: Any
) -> None:
    assert client.post(INVITE, json={"email": PARENT}).status_code == 401
    assert client.get(LINK).status_code == 401
    assert client.delete(LINK).status_code == 401
    assert {ACCEPT, DECLINE} <= app_mod._OPEN_PATHS
    assert client.get(ACCEPT).status_code == 400  # open, and honest about a missing token
    assert client.get(DECLINE).status_code == 400
    anon = auth("anon-device", anonymous=True)
    assert client.get(LINK, headers=anon).json()["status"] == "none"
    res = client.post(INVITE, json={"email": PARENT}, headers=anon)
    assert res.status_code == 403 and res.json()["detail"]["code"] == "sign_in_required"
    assert client.delete(LINK, headers=anon).status_code == 403


# --- the invite -----------------------------------------------------------------------------------
def test_an_invite_writes_one_row_sends_one_mail_and_reports_the_status(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    res = client.post(
        INVITE,
        json={
            "email": " Parent@Example.test ",
            "learner_name": "Learner One",
            "timezone": "Asia/Kolkata",
        },
        headers=auth(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "invited" and body["sent"] is True
    assert body["parent_email"] == "p***@example.test"  # recognisable, not readable
    assert body["learner_name"] == "Learner" and body["timezone"] == "Asia/Kolkata"
    assert "Nothing goes out until they say yes" in body["line"]
    link = only_link(_fresh)
    assert link.learner_id == "learner-under-test" and link.status == "invited"
    assert link.parent_email == PARENT  # normalised: lower case, trimmed
    assert re.fullmatch(r"[0-9a-f]{64}", link.parent_email_hash)
    assert link.parent_email_hash != to_hash(PARENT)  # keyed, not the plain digest
    assert link.invite_token_hash and link.linked_at is None and link.unsubscribe_url is None
    [record] = mail_log().records()
    assert (record.kind, record.learner_id) == ("parent_invite", "learner-under-test")
    assert record.period == f"invite:{link.id}" and record.to_hash == to_hash(PARENT)
    assert client.get(LINK, headers=auth()).json()["status"] == "invited"


def test_the_invite_renders_in_the_hand_with_no_vendor_and_no_gendered_pronoun(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[tuple[str, dict[str, Any]]] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append((to, data))
        return {"ok": True, "mode": "console"}

    monkeypatch.setattr(parents, "send_email", capture)
    assert invite(client, auth).status_code == 200
    [(to, data)] = sent
    assert to == PARENT
    token = token_for(only_link(_fresh))
    assert data["accept_url"] == f"https://api.heywobo.com{ACCEPT}?token={token}"
    assert data["decline_url"] == f"https://api.heywobo.com{DECLINE}?token={token}"
    out = render("parent_invite", data)
    assert out["subject"] == "Learner asked me to send you their Sunday notes"
    assert out["preheader"] == "One page a week. No dashboard, nothing to check daily."
    html, text = out["html"], out["text"]
    # the same paper as the welcome, one button each way, and no unsubscribe link in the body:
    # "Not me" is the way out a person reads
    assert "background:#FAF7F0;border-radius:24px" in html and ">wobo<" in html
    assert "background:#14142B;border-radius:22px" in html and "color:#FFB629" in html
    assert ">See how it works<" in html and ">Not me<" in html
    assert "What you will not get" in html and "a window into the work, not a monitor" in html
    assert f'href="{data["accept_url"]}"' in html and f'href="{data["decline_url"]}"' in html
    assert data["accept_url"] in text and data["decline_url"] in text
    # docs/MAIL-PRIMARY.md §2: the invite is a cold message to an adult who never gave us their
    # address, so it gets the subscribed treatment: List-Unsubscribe pointing at the signed
    # decline route, one-click because that route honours a bare POST with no login. It used to
    # ship headers: {} and the law names that as the single riskiest mail we send.
    assert out["headers"] == {
        "List-Unsubscribe": f"<{data['decline_url']}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    assert "unsubscribe" not in html.lower()
    assert "<img" not in html and "http://" not in html and "<script" not in html
    for blob in (out["subject"], out["preheader"], text, html):
        assert not VENDOR.search(blob), VENDOR.search(blob)
        assert not GENDERED.search(blob), GENDERED.search(blob)
        assert not KINSHIP.search(blob)
        # The register law is about prose a person reads, which is why `<!DOCTYPE` was already
        # carved out of this check. The dark-mode stylesheet is carved out for the same reason:
        # CSS's `!important` is a keyword in a declaration nobody reads, and the invite needs it
        # to beat its own inline colours when a client darkens the mail (the five nudges have
        # shipped the same block since they were written). Every word a reader sees is still
        # scanned, including the whole body, the subject and the preheader.
        prose = blob.replace("<!DOCTYPE", "")
        if "<style>" in prose:
            head, _, rest = prose.partition("<style>")
            _, _, tail = rest.partition("</style>")
            prose = head + tail
        assert "!" not in prose
    # no plan pitch, nothing that implies the learner is behind (the spec's rules)
    for word in ("Plus", "Pro", "offer", "behind", "at risk", "struggl"):
        assert word not in text, word
    # the default render points "Not me" at our own decline route, never nowhere
    bare = render("parent_invite")
    assert f'href="https://api.heywobo.com{DECLINE}"' in bare["html"]
    assert "A learner asked me" in bare["subject"]
    # a hostile link falls back to us
    hostile = render("parent_invite", {"accept_url": "https://evil.example/x"})
    assert "evil.example" not in hostile["html"] and "evil.example" not in hostile["text"]


def test_the_invite_is_account_mail_on_the_paper_not_hospitality_mail() -> None:
    """It is drawn on the paper (PAPER_KINDS) but it is not one of the hospitality kinds
    (HAND_KINDS): those must carry a stop link before a live send; a one-off invite has "Not me"
    instead, and it is never sendable through the internal relay by a bare key."""
    from wobo_gateway.email import LIFECYCLE_KINDS

    assert "parent_invite" in KINDS and "parent_invite" in PAPER_KINDS
    assert "parent_invite" not in HAND_KINDS and "parent_invite" not in LIFECYCLE_KINDS


def test_a_second_invite_while_one_is_active_is_refused(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    assert invite(client, auth).status_code == 200
    again = invite(client, auth, email="other@example.test")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "link_active"
    assert "already out" in again.json()["detail"]["message"]
    assert len(_fresh.rows) == 1 and len(mail_log().records()) == 1
    # linked: still one, with the other message
    client.post(ACCEPT, data={"token": token_for(only_link(_fresh))})
    again = invite(client, auth, email="other@example.test")
    assert again.status_code == 409 and "already linked" in again.json()["detail"]["message"]
    # ended by the learner: a fresh invite is a fresh row; the old one stays revoked
    assert client.delete(LINK, headers=auth()).json()["ended"] is True
    assert invite(client, auth, email="other@example.test").status_code == 200
    statuses = sorted(r.status for r in _fresh.rows.values())
    assert statuses == ["invited", "revoked"]


def test_what_the_learner_typed_is_validated(client: TestClient, auth: Any) -> None:
    for body, field in (
        ({"email": "not an address"}, "email"),
        ({"email": "a@b"}, "email"),
        ({"email": "a@b..com"}, "email"),
        ({"email": '"quoted"@example.test'}, "email"),
        ({"email": "a@.example.test"}, "email"),
        ({"email": PARENT, "learner_name": "<script>alert(1)</script>"}, "learner_name"),
        ({"email": PARENT, "learner_name": "42"}, "learner_name"),
        # the name reaches the subject line of a mail to a stranger: a name, never a sentence
        ({"email": PARENT, "learner_name": "Win-a-free-iPhone-at-bit.ly"}, "learner_name"),
        ({"email": PARENT, "learner_name": "A.B"}, "learner_name"),
        ({"email": PARENT, "timezone": "Mars/Olympus"}, "timezone"),
        ({"email": PARENT, "timezone": "../etc"}, "timezone"),
    ):
        res = client.post(INVITE, json=body, headers=auth())
        assert res.status_code == 422, (body, res.text)
        detail = res.json()["detail"]
        assert detail["code"] == "not_kept" and detail["field"] == field
        assert not VENDOR.search(detail["message"])
    assert (
        client.post(INVITE, json={"email": PARENT, "plan": "plus"}, headers=auth()).status_code
        == 422
    )
    assert mail_log().records() == []


def test_a_name_is_a_name_an_address_is_an_address_and_a_zone_is_canonical(
    client: TestClient, auth: Any
) -> None:
    assert parents.normalise_name("O'Brien Kelly") == "O'Brien"
    assert parents.normalise_name("Mary-Jane") == "Mary-Jane"
    assert parents.normalise_name("Learner One") == "Learner"
    assert parents.normalise_name("  ") is None
    for bad in ("Win-a-free-iPhone-at-bit.ly", "A.B", "Mary--Jane", "O''Brien", "42", "<b>"):
        with pytest.raises(parents.NotKept):
            parents.normalise_name(bad)
    assert parents.normalise_email(" A@B.C ") == "a@b.c"
    for bad in ("a@b..com", '"quoted"@x.com', "a@.b.com", "a@b.com.", "a@b", "not an address"):
        with pytest.raises(parents.NotKept):
            parents.normalise_email(bad)
    # the zone is stored as the IANA key, whatever case it was typed in: macOS resolves
    # "asia/kolkata", the Linux host running the Sunday job does not
    assert parents.normalise_timezone("asia/kolkata") == "Asia/Kolkata"
    assert parents.normalise_timezone("UTC") == "UTC"
    assert parents.normalise_timezone("") is None
    res = invite(client, auth, timezone="asia/kolkata")
    assert res.status_code == 200 and res.json()["timezone"] == "Asia/Kolkata"


def test_a_learner_cannot_invite_their_own_address(client: TestClient, auth: Any) -> None:
    res = client.post(
        INVITE, json={"email": "Me@Example.test"}, headers=auth(email="me@example.test")
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "not_kept" and detail["field"] == "email"
    assert "your own address" in detail["message"]
    assert mail_log().records() == []


# --- the sender is bounded: an account is not a licence to aim Wobo's mail ------------------------
def test_a_learner_may_send_a_few_invites_a_day_and_no_more(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    """Invite, revoke, invite again: every row written in the last day counts, whatever became of
    it, and the one past the allowance is a 429 in Wobo's words with the time it lifts."""
    for n in range(3):
        assert invite(client, auth, email=f"parent{n}@example.test").status_code == 200, n
        assert client.delete(LINK, headers=auth()).json()["ended"] is True
    res = invite(client, auth, email="parent3@example.test")
    assert res.status_code == 429 and res.json()["detail"]["code"] == "invite_limit"
    assert "one day" in res.json()["detail"]["message"] and not VENDOR.search(res.text)
    assert 0 < int(res.headers["Retry-After"]) <= 86400
    assert len(_fresh.rows) == 3 and len(mail_log().records()) == 3
    # another learner's day is their own
    other = client.post(
        INVITE, json={"email": "parent3@example.test"}, headers=auth("someone-else")
    )
    assert other.status_code == 200


def test_the_same_address_is_never_written_to_twice_in_a_day(
    _fresh: InMemoryParentLinkStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Revoke and invite the same address again is not a second mail — for a day. After it, the
    address may be written to once more, and the daily count runs on the same window."""
    sent: list[str] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append(to)
        return {"ok": True}

    t0 = datetime(2026, 9, 4, 12, tzinfo=UTC)
    parents.invite(_fresh, learner_id="L", email=PARENT, now=t0, send=capture)
    parents.revoke(_fresh, "L", now=t0 + timedelta(minutes=1))
    with pytest.raises(Refused) as err:
        parents.invite(
            _fresh, learner_id="L", email=PARENT, now=t0 + timedelta(hours=23), send=capture
        )
    assert err.value.status == 429 and err.value.code == "invite_recent"
    assert err.value.retry_after == 3600
    assert sent == [PARENT] and len(_fresh.rows) == 1
    later = t0 + timedelta(hours=24, seconds=1)
    link, _ = parents.invite(_fresh, learner_id="L", email=PARENT, now=later, send=capture)
    assert link.status == "invited" and sent == [PARENT, PARENT]
    parents.revoke(_fresh, "L", now=later + timedelta(seconds=1))
    monkeypatch.setenv("PARENT_INVITES_PER_DAY", "1")
    with pytest.raises(Refused) as err:
        parents.invite(
            _fresh,
            learner_id="L",
            email="other@example.test",
            now=later + timedelta(hours=1),
            send=capture,
        )
    assert err.value.code == "invite_limit" and err.value.retry_after == 23 * 3600
    assert sent == [PARENT, PARENT]


def test_an_invite_nobody_answered_reads_as_expired_and_a_fresh_one_replaces_it(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The token dies at PARENT_INVITE_DAYS; the row must not keep saying "invite sent" after
    it, and a fresh invite must not be a 409 that only DELETE can clear."""
    invite(client, auth)
    old = only_link(_fresh)
    stale = replace(old, invited_at=old.invited_at - timedelta(days=15))
    _fresh.rows[old.id] = stale
    token = parents.invite_token(stale.id, stale.learner_id, issued=stale.invited_at)
    assert token and "did not work" in client.get(ACCEPT, params={"token": token}).text
    view = client.get(LINK, headers=auth()).json()
    assert view["status"] == "expired" and "run out" in view["line"]
    assert view["parent_email"] == "p***@example.test"
    # the window is one number for the token and the row
    monkeypatch.setenv("PARENT_INVITE_DAYS", "30")
    assert client.get(LINK, headers=auth()).json()["status"] == "invited"
    assert parents.parse_invite_token(token) is not None
    monkeypatch.delenv("PARENT_INVITE_DAYS")
    # the same address, fifteen days on: the stale row makes way rather than blocking
    res = invite(client, auth)
    assert res.status_code == 200 and res.json()["status"] == "invited"
    ended = _fresh.rows[old.id]
    assert ended.status == "revoked" and ended.revoked_by == "expired"
    assert ended.parent_email is None and ended.invite_token_hash is None
    assert parents.status_view(ended)["line"].startswith("That invite ran out")
    assert ended.revoked_by in parents.ENDED_BY
    fresh = next(r for r in _fresh.rows.values() if r.status == "invited")
    assert fresh.id != old.id and len(mail_log().records()) == 2


def test_without_a_name_the_pages_read_as_sentences(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    client.post(INVITE, json={"email": PARENT}, headers=auth())
    token = token_for(only_link(_fresh))
    page = client.get(ACCEPT, params={"token": token}).text
    assert "The learner asked me to send you their Sunday notes" in page
    assert "what the learner studied" in page and "The learner studied" not in page
    done = client.post(ACCEPT, data={"token": token}).text
    assert "when the learner has had a week" in done
    assert (
        "The Sunday notes about the learner are already"
        in client.post(ACCEPT, data={"token": token}).text
    )
    client.delete(LINK, headers=auth())
    assert (
        "the learner can send a fresh invite" in client.get(DECLINE, params={"token": token}).text
    )
    # the invite mail keeps the same rule
    out = render("parent_invite", {})
    assert "A learner learns with me" in out["text"] and "what a learner studied" in out["text"]
    assert "because a learner typed" in out["text"] and "A learner asked me" in out["subject"]
    assert "A learner studied" not in out["html"] and "because A learner" not in out["html"]


def test_a_send_that_fails_outright_leaves_no_row_behind(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A learner told "invite sent" while the parent heard nothing is the one thing this route
    must never do. A would-send held by config is different: the row stays, and the answer says
    it did not go."""
    monkeypatch.setattr(
        parents, "send_email", lambda *a, **k: {"ok": False, "error": "send_failed"}
    )
    res = invite(client, auth)
    assert res.status_code == 502 and res.json()["detail"]["code"] == "invite_not_sent"
    assert _fresh.rows == {}
    assert client.get(LINK, headers=auth()).json()["status"] == "none"
    monkeypatch.setattr(
        parents, "send_email", lambda *a, **k: {"ok": False, "queued": True, "error": "no_api_key"}
    )
    res = invite(client, auth)
    assert res.status_code == 200 and res.json()["sent"] is False
    assert only_link(_fresh).status == "invited"


def test_without_a_signing_key_no_invite_is_sent(
    _fresh: InMemoryParentLinkStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    assert not parents.signing_available()
    with pytest.raises(Refused) as err:
        parents.invite(_fresh, learner_id="L", email=PARENT)
    assert err.value.status == 503 and err.value.code == "not_ready"
    assert _fresh.rows == {} and mail_log().records() == []


def test_the_address_never_lands_in_a_log(
    client: TestClient, auth: Any, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("DEBUG")
    assert invite(client, auth).status_code == 200
    for record in caplog.records:
        assert PARENT not in record.getMessage()
        assert PARENT not in json.dumps(getattr(record, "fields", {}), default=str)


# --- accept ---------------------------------------------------------------------------------------
def test_the_parents_tap_links_the_family_once(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    invite(client, auth)
    token = token_for(only_link(_fresh))
    # a GET is a question: the page says what the parent will get, and nothing changes
    page = client.get(ACCEPT, params={"token": token})  # no Authorization header at all
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    assert "Learner asked me to send you their Sunday notes" in page.text
    assert "Send me the Sunday notes" in page.text and 'method="post"' in page.text
    assert "Not their conversations with me" in page.text
    assert not VENDOR.search(page.text) and not GENDERED.search(page.text)
    assert "<script" not in page.text and "!" not in page.text.split("<body")[1]
    assert only_link(_fresh).status == "invited"
    # the button's POST does the thing
    done = client.post(ACCEPT, data={"token": token})
    assert done.status_code == 200 and "Done. The Sunday notes will come here." in done.text
    link = only_link(_fresh)
    assert link.status == "linked" and link.linked_at is not None
    assert link.invite_token_hash is None and link.parent_email == PARENT
    # the parent's own stop link for the Sunday note is minted onto the row
    assert link.unsubscribe_url and link.unsubscribe_url.startswith(
        "https://api.heywobo.com/v1/mail/stop?token="
    )
    claim = parse_stop_token(unquote(urlparse(link.unsubscribe_url).query[len("token=") :]))
    assert claim and claim.learner_id == "learner-under-test" and claim.kinds == ("sunday_note",)
    view = client.get(LINK, headers=auth()).json()
    assert view["status"] == "linked" and view["linked_at"] == link.linked_at.isoformat()
    assert "gets a note every Sunday" in view["line"]
    # single use: the same token again is "done already", the row is untouched
    again = client.post(ACCEPT, data={"token": token})
    assert again.status_code == 200 and "Done already" in again.text
    assert only_link(_fresh) == link
    # and "Not me" from the same mail cannot undo a link that already started
    assert "Done already" in client.post(DECLINE, data={"token": token}).text
    assert only_link(_fresh).status == "linked"


def test_the_token_rides_in_the_query_string_too(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    invite(client, auth)
    token = token_for(only_link(_fresh))
    assert client.post(f"{ACCEPT}?token={token}").status_code == 200
    assert only_link(_fresh).status == "linked"


# --- decline --------------------------------------------------------------------------------------
def test_not_me_revokes_forgets_the_address_and_the_learner_is_told(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    invite(client, auth)
    token = token_for(only_link(_fresh))
    page = client.get(DECLINE, params={"token": token})
    assert page.status_code == 200 and "Not you?" in page.text and 'method="post"' in page.text
    assert only_link(_fresh).status == "invited"  # a GET changes nothing
    done = client.post(DECLINE, data={"token": token})
    assert done.status_code == 200 and "I have forgotten this address" in done.text
    assert not VENDOR.search(done.text)
    link = only_link(_fresh)
    assert link.status == "revoked" and link.revoked_by == "parent"
    assert link.parent_email is None and link.invite_token_hash is None
    assert link.revoked_at is not None and link.parent_email_hash  # the digest is all that stays
    # the learner's notice channel: the status the You screen reads, in Wobo's words
    view = client.get(LINK, headers=auth()).json()
    assert view["status"] == "revoked" and view["revoked_by"] == "parent"
    assert view["parent_email"] is None
    assert "said it was not them" in view["line"]
    # the spent token opens nothing
    assert "This invite was ended" in client.post(ACCEPT, data={"token": token}).text
    assert "This invite was ended" in client.get(DECLINE, params={"token": token}).text
    # a fresh invite is allowed afterwards — to a corrected address. The same address again
    # within a day is not a second mail: that address just said it was not them.
    again = invite(client, auth)
    assert again.status_code == 429 and again.json()["detail"]["code"] == "invite_recent"
    assert "in the last day" in again.json()["detail"]["message"]
    assert invite(client, auth, email="parent2@example.test").status_code == 200


# --- the learner ends it --------------------------------------------------------------------------
def test_the_learner_ends_it_and_the_token_dies_with_it(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    invite(client, auth)
    token = token_for(only_link(_fresh))
    res = client.delete(LINK, headers=auth())
    assert res.status_code == 200
    body = res.json()
    assert body["ended"] is True and body["status"] == "revoked" and body["revoked_by"] == "learner"
    assert body["parent_email"] is None and "You ended the parent link" in body["line"]
    link = only_link(_fresh)
    assert link.parent_email is None and link.invite_token_hash is None
    assert "This invite was ended" in client.post(ACCEPT, data={"token": token}).text
    assert only_link(_fresh).status == "revoked"
    # nothing left to end
    again = client.delete(LINK, headers=auth()).json()
    assert again["ended"] is False and again["status"] == "revoked"
    # ending a linked parent works the same way
    invite(client, auth, email="other@example.test")
    fresh = next(r for r in _fresh.rows.values() if r.status == "invited")
    client.post(ACCEPT, data={"token": token_for(fresh)})
    assert client.delete(LINK, headers=auth()).json()["ended"] is True
    assert _fresh.rows[fresh.id].status == "revoked" and _fresh.rows[fresh.id].parent_email is None


def test_one_learners_link_is_never_anothers(
    client: TestClient, auth: Any, _fresh: InMemoryParentLinkStore
) -> None:
    invite(client, auth)
    other = auth("someone-else")
    assert client.get(LINK, headers=other).json()["status"] == "none"
    assert client.delete(LINK, headers=other).json()["ended"] is False
    assert only_link(_fresh).status == "invited"
    # a token minted for one learner does not open a link of another
    link = only_link(_fresh)
    forged = parents.invite_token(link.id, "someone-else", issued=link.invited_at)
    assert forged and "did not work" in client.post(ACCEPT, data={"token": forged}).text
    assert only_link(_fresh).status == "invited"


# --- the token ------------------------------------------------------------------------------------
def test_the_token_is_ours_alone_and_expires_in_fourteen_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issued = datetime(2026, 9, 1, 12, tzinfo=UTC)
    token = parents.invite_token("link-1", "learner-1", issued=issued)
    assert token
    assert parents.parse_invite_token(token, now=issued) == parents.InviteClaim(
        "link-1", "learner-1"
    )
    head, sig = token.split(".")
    assert parents.parse_invite_token(f"{head}.{sig[:-2]}AA", now=issued) is None
    assert parents.parse_invite_token(f"{head}x.{sig}", now=issued) is None
    assert parents.parse_invite_token("", now=issued) is None
    assert parents.parse_invite_token("a.b.c", now=issued) is None
    # fourteen days, not fifteen
    assert parents.parse_invite_token(token, now=issued + timedelta(days=13, hours=23))
    assert parents.parse_invite_token(token, now=issued + timedelta(days=14, hours=1)) is None
    monkeypatch.setenv("PARENT_INVITE_DAYS", "30")
    assert parents.parse_invite_token(token, now=issued + timedelta(days=20))
    # a different key is a different signature; the stop token's key is not this one
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "another-key-entirely-and-long-enough")
    assert parents.parse_invite_token(token, now=issued) is None
    from wobo_gateway.hospitality.tokens import parse_stop_token, stop_token

    assert parse_stop_token(token) is None
    assert parents.parse_invite_token(stop_token("learner-1", "learner"), now=issued) is None
    # the row keeps a digest, never the token
    assert re.fullmatch(r"[0-9a-f]{64}", parents.token_hash(token))
    assert parents.token_hash(token) != parents.token_hash(token + "x")


def test_the_email_digest_is_keyed_and_the_mask_shows_little() -> None:
    digest = parents.email_hash(" Parent@Example.test ")
    assert digest == parents.email_hash(PARENT) and re.fullmatch(r"[0-9a-f]{64}", digest or "")
    assert digest != to_hash(PARENT)
    assert parents.mask_email(PARENT) == "p***@example.test"
    assert parents.mask_email("x") == "***"


# --- the PostgREST store, against a fake ----------------------------------------------------------
class FakeRequest:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []
        self.calls: list[dict[str, Any]] = []
        self.fail = False

    def __call__(
        self, url: str, key: str, method: str, *, body: Any = None, want_rows: bool
    ) -> Any:
        self.calls.append(
            {"url": url, "key": key, "method": method, "body": body, "rows": want_rows}
        )
        if self.fail:
            raise OSError("no route to host")
        if method == "POST":
            return list(body)
        if method == "PATCH":
            return [{**self.rows[0], **body}] if self.rows else []
        return list(self.rows)


def _query(call: dict[str, Any]) -> dict[str, list[str]]:
    parsed = urlparse(call["url"])
    assert parsed.path == "/rest/v1/parent_links"
    return parse_qs(parsed.query)


ROW = {
    "id": "8f1c",
    "learner_id": "L",
    "parent_email_hash": "0" * 64,
    "parent_email": PARENT,
    "learner_name": "Learner",
    "timezone": None,
    "status": "linked",
    "invited_at": "2026-09-01T12:00:00Z",
    "linked_at": "2026-09-02T12:00:00+00:00",
    "unsubscribe_url": "https://api.heywobo.com/v1/mail/stop?token=t",
}


def test_the_store_reads_and_writes_the_learner_schema_by_the_right_filters() -> None:
    fake = FakeRequest([ROW])
    store = PostgrestParentLinkStore("https://project.example/", "svc-key", request=fake)
    link = store.active("L")
    assert link and link.status == "linked" and link.parent_email == PARENT
    assert link.invited_at == datetime(2026, 9, 1, 12, tzinfo=UTC)
    assert _query(fake.calls[0]) == {
        "select": ["*"],
        "learner_id": ["eq.L"],
        "status": ["in.(invited,linked)"],
        "limit": ["1"],
    }
    assert fake.calls[0]["method"] == "GET" and fake.calls[0]["key"] == "svc-key"
    store.latest("L")
    assert _query(fake.calls[1]) == {
        "select": ["*"],
        "learner_id": ["eq.L"],
        "order": ["invited_at.desc"],
        "limit": ["1"],
    }
    store.get("8f1c")
    assert _query(fake.calls[2]) == {"select": ["*"], "id": ["eq.8f1c"], "limit": ["1"]}
    store.linked()
    assert _query(fake.calls[3]) == {"select": ["*"], "status": ["eq.linked"], "limit": ["5000"]}
    inserted = store.insert(parents.from_row({**ROW, "status": "invited", "linked_at": None}))
    assert fake.calls[4]["method"] == "POST" and fake.calls[4]["body"] == [parents.to_row(inserted)]
    updated = store.update("8f1c", {"status": "revoked", "parent_email": None})
    assert fake.calls[5]["method"] == "PATCH" and _query(fake.calls[5])["id"] == ["eq.8f1c"]
    assert fake.calls[5]["body"] == {"status": "revoked", "parent_email": None}
    assert updated and updated.status == "revoked" and updated.parent_email is None
    assert store.delete("8f1c") is True and fake.calls[6]["method"] == "DELETE"
    assert _query(fake.calls[6])["id"] == ["eq.8f1c"]
    store.recent("L", since=datetime(2026, 9, 3, 12, tzinfo=UTC))
    assert _query(fake.calls[7]) == {
        "select": ["*"],
        "learner_id": ["eq.L"],
        "invited_at": ["gte.2026-09-03T12:00:00+00:00"],
        "order": ["invited_at.desc"],
        "limit": ["50"],
    }


def test_the_store_is_unavailable_never_a_default_and_a_bad_id_never_reaches_a_filter() -> None:
    fake = FakeRequest()
    fake.fail = True
    store = PostgrestParentLinkStore("https://project.example", "svc-key", request=fake)
    with pytest.raises(StoreUnavailable):
        store.active("L")
    with pytest.raises(StoreUnavailable):
        store.linked()
    fake.fail = False
    with pytest.raises(StoreUnavailable):
        store.get("not an id; drop table")
    assert all("drop" not in c["url"] for c in fake.calls)
    with pytest.raises(ValueError):
        PostgrestParentLinkStore("", "k")


def test_the_real_transport_sends_the_schema_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    class Response:
        def __init__(self, request: Any) -> None:
            seen["headers"] = dict(request.header_items())
            seen["method"] = request.get_method()

        def __enter__(self) -> Response:
            return self

        def __exit__(self, *exc: Any) -> None:
            return None

        def read(self) -> bytes:
            return b'[{"id":"x"}]'

    monkeypatch.setattr(
        parents.urllib.request, "urlopen", lambda request, timeout: Response(request)
    )
    rows = parents._request(
        "https://p/rest/v1/parent_links", "k", "PATCH", body={"a": 1}, want_rows=True
    )
    assert rows == [{"id": "x"}]
    headers = {k.lower(): v for k, v in seen["headers"].items()}
    assert headers["accept-profile"] == "learner" and headers["content-profile"] == "learner"
    assert headers["authorization"] == "Bearer k" and headers["prefer"] == "return=representation"
    assert seen["method"] == "PATCH"


def test_build_store_picks_memory_without_a_project(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PARENT_LINKS_STORE", raising=False)
    assert isinstance(parents.build_store(), InMemoryParentLinkStore)
    monkeypatch.setenv("SUPABASE_URL", "https://project.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-not-a-real-one")
    assert isinstance(parents.build_store(), PostgrestParentLinkStore)
    monkeypatch.setenv("PARENT_LINKS_STORE", "memory")
    assert isinstance(parents.build_store(), InMemoryParentLinkStore)


def test_a_store_outage_is_said_out_loud(client: TestClient, auth: Any) -> None:
    class Down:
        def __getattr__(self, name: str) -> Any:
            def _raise(*a: Any, **k: Any) -> Any:
                raise StoreUnavailable("no route to host")

            return _raise

    parents.set_store(Down())
    res = client.get(LINK, headers=auth())
    assert res.status_code == 503 and res.json()["detail"]["code"] == "store_unavailable"
    assert invite(client, auth).status_code == 503
    assert client.delete(LINK, headers=auth()).status_code == 503
    token = parents.invite_token("x", "y")
    page = client.post(ACCEPT, data={"token": token})
    assert (
        page.status_code == 503
        and "Try the link again" in page.text
        and not VENDOR.search(page.text)
    )


# --- the Sunday job sees a linked family ----------------------------------------------------------
KOLKATA_SUNDAY_EVENING = datetime(2026, 9, 6, 13, 0, tzinfo=UTC)  # 18:30 in Kolkata


class FixedWeek:
    def week(self, learner_id: str, *, start: Any, end: Any) -> dict[str, Any]:
        return {"lessons": 3, "problems": 14, "days_active": 5}


def _row(learner: str, status: str, **extra: Any) -> ParentLink:
    return parents.from_row(
        {
            "id": f"link-{learner}-{status}",
            "learner_id": learner,
            "parent_email_hash": "0" * 64,
            "parent_email": f"{learner}-parent@example.test",
            "learner_name": learner.title(),
            "status": status,
            "invited_at": "2026-08-30T12:00:00Z",
            "linked_at": "2026-08-31T12:00:00Z" if status == "linked" else None,
            "revoked_at": "2026-09-01T12:00:00Z" if status == "revoked" else None,
            **extra,
        }
    )


def test_the_sunday_job_sees_a_linked_family_and_only_a_linked_one(
    _fresh: InMemoryParentLinkStore,
) -> None:
    """The job reads the table the routes write: a linked row is a family, an invited or revoked
    one is not, and the parent's own stop link on the row rides into the note."""
    stop = "https://api.heywobo.com/v1/mail/stop?token=parents-own"
    for link in (
        _row("learner", "linked", timezone="Asia/Kolkata", unsubscribe_url=stop),
        _row("other", "invited", timezone="Asia/Kolkata"),
        _row("zara", "revoked", parent_email=None, timezone="Asia/Kolkata"),
    ):
        _fresh.rows[link.id] = link
    sent: list[tuple[str, dict[str, Any]]] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append((to, data))
        return {"ok": True}

    families = jobs.LinkedFamilies()
    assert [f.learner_id for f in families.linked_families()] == ["learner"]
    assert jobs.PostgrestFamilies is jobs.LinkedFamilies  # the cron door's default source
    report = jobs.run_sunday(
        KOLKATA_SUNDAY_EVENING, week_source=FixedWeek(), digest=None, send=capture
    )
    assert report["checked"] == 1 and report["sent"] == 1, report
    [(to, data)] = sent
    assert to == "learner-parent@example.test"
    assert data["learner_name"] == "Learner" and data["unsubscribe_url"] == stop
    assert data["stamp"] == "Sunday, 6:30 pm"


def test_a_linked_parents_zone_comes_from_the_dials_when_the_link_has_none(
    _fresh: InMemoryParentLinkStore,
) -> None:
    link = _row("learner", "linked")
    _fresh.rows[link.id] = link
    kwargs: dict[str, Any] = {"week_source": FixedWeek(), "digest": None, "dry_run": True}
    assert jobs.run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)["skipped"] == {"no_locality": 1}
    prefs_mod.get_store().put("learner", prefs_mod.MailPreferences(timezone="Asia/Kolkata"))
    assert jobs.run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)["would_send"] == 1
    # the family's dials decide the Sunday switch, and the stop link in the note flips it
    prefs_mod.get_store().put(
        "learner", prefs_mod.MailPreferences(timezone="Asia/Kolkata", sunday_note=False)
    )
    assert jobs.run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)["skipped"] == {"opted_out": 1}


def test_an_unreachable_link_store_means_nobody_is_due() -> None:
    class Down:
        def linked(self) -> Any:
            raise StoreUnavailable("no store")

    parents.set_store(Down())
    assert list(jobs.LinkedFamilies().linked_families()) == []
    report = jobs.run_sunday(KOLKATA_SUNDAY_EVENING, week_source=FixedWeek(), digest=None)
    assert report["checked"] == 0 and report["sent"] == 0
