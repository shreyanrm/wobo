"""Hearing the provider (wave 56, the deliverability watch): docs/MAIL-PRIMARY.md, "Watching where
we land".

The owner: *"we need to keep a track if we went to spam or not"*. The first thing that tells us is
the provider's own delivery events: delivered, bounced, complained, delayed. Until this file they
reached nothing, so a parent who pressed "Report spam" kept getting three notes a week, and a
dead address kept being written to once a month for ever.

What is proved here, every one with the clock handed in and nothing sent:

1. **The door is the signature.** ``POST /v1/mail/events`` takes the provider's signed body
   (Svix: ``id.timestamp.body``, HMAC-SHA256 under the ``whsec_`` key) and refuses anything
   unsigned, mis-signed, tampered or stale. With no secret set, the route is shut.
2. **A complaint or a hard bounce suppresses that address at once**, for every non-transactional
   kind. A sign-in code or a receipt still reaches it. A soft bounce stops nothing.
3. **Every event is counted once**, per day and per Feedback-ID kind, and the kind is found from
   the tag the send carried, the Feedback-ID header, or our own send log.
4. **Never an address.** What is kept is a digest.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import alerts
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog, MailRecord, send_email, to_hash
from wobo_gateway.mailwatch import events, store

NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)
KEY = b"a-test-webhook-key-of-32-bytes!!"
SECRET = "whsec_" + base64.b64encode(KEY).decode()
PARENT = "parent@example.test"


def signed(
    body: bytes,
    *,
    secret: str = SECRET,
    msg_id: str = "msg_1",
    at: datetime = NOW,
) -> dict[str, str]:
    """The three headers the provider sends, computed here from the published scheme rather than
    borrowed from the code under test, so the two can only agree by both being right."""
    stamp = str(int(at.timestamp()))
    key = base64.b64decode(secret.split("_", 1)[1])
    digest = hmac.new(key, f"{msg_id}.{stamp}.".encode() + body, hashlib.sha256).digest()
    return {
        "svix-id": msg_id,
        "svix-timestamp": stamp,
        "svix-signature": f"v1,{base64.b64encode(digest).decode()}",
    }


def an_event(
    kind_of_event: str,
    *,
    to: str = PARENT,
    kind: str | None = "learning_note",
    email_id: str = "em_1",
    at: datetime = NOW,
    **data: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email_id": email_id,
        "created_at": at.isoformat(),
        "from": "Wobo <hello@mail.heywobo.com>",
        "to": [to],
        "subject": "Learner, you finished Fractions",
        **data,
    }
    if kind is not None:
        body["tags"] = {"kind": kind}
    return {"type": kind_of_event, "created_at": at.isoformat(), "data": body}


@pytest.fixture(autouse=True)
def _watch(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("RESEND_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    watch = store.WatchStore()
    store.set_store(watch)
    events.set_clock(lambda: NOW)
    email_mod.set_mail_log(MailLog())
    yield watch
    events.set_clock(None)
    store.set_store(None)
    email_mod.reset_mail_log()


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


def post(client: TestClient, payload: dict[str, Any], **kw: Any) -> Any:
    body = json.dumps(payload).encode()
    headers = kw.pop("headers", None)
    if headers is None:
        headers = signed(body, **kw)
    return client.post(
        events.EVENTS_PATH,
        content=body,
        headers={"content-type": "application/json", **headers},
    )


# === 1. the door ==================================================================================
def test_the_route_is_open_to_the_provider_and_nobody_else_is_trusted(client: TestClient) -> None:
    from wobo_gateway import app as app_mod

    assert events.EVENTS_PATH in app_mod._OPEN_PATHS
    assert post(client, an_event("email.delivered")).status_code == 200


def test_an_unsigned_event_is_refused(client: TestClient, _watch: store.WatchStore) -> None:
    response = post(client, an_event("email.complained"), headers={})
    assert response.status_code == 401
    assert _watch.rows(store.DELIVERY) == []
    assert not _watch.is_suppressed(to_hash(PARENT))


def test_a_mis_signed_event_is_refused(client: TestClient, _watch: store.WatchStore) -> None:
    other = "whsec_" + base64.b64encode(b"somebody-else-s-key-32-bytes-ok!").decode()
    assert post(client, an_event("email.complained"), secret=other).status_code == 401
    # The right key over different bytes is a forgery too.
    body = json.dumps(an_event("email.delivered")).encode()
    tampered = json.dumps(an_event("email.complained")).encode()
    response = client.post(
        events.EVENTS_PATH,
        content=tampered,
        headers={"content-type": "application/json", **signed(body)},
    )
    assert response.status_code == 401
    assert _watch.rows(store.DELIVERY) == []


def test_a_stale_or_future_signature_is_refused(client: TestClient) -> None:
    """A captured delivery replayed later is refused on its timestamp, which is signed."""
    late = NOW - timedelta(seconds=events.TOLERANCE_S + 60)
    early = NOW + timedelta(seconds=events.TOLERANCE_S + 60)
    assert post(client, an_event("email.complained"), at=late).status_code == 401
    assert post(client, an_event("email.complained"), at=early).status_code == 401


def test_with_no_secret_the_route_is_shut(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    monkeypatch.delenv(events.SECRET_ENV, raising=False)
    response = post(client, an_event("email.complained"))
    assert response.status_code == 503
    assert _watch.rows(store.DELIVERY) == []


def test_verify_accepts_any_of_several_signatures_and_only_v1() -> None:
    body = b'{"type":"email.delivered"}'
    good = signed(body)
    rotated = {**good, "svix-signature": f"v1,bm90LWl0 {good['svix-signature']}"}
    assert events.verify(body, rotated, SECRET, now=NOW) == "msg_1"
    wrong_version = {**good, "svix-signature": good["svix-signature"].replace("v1,", "v2,")}
    assert events.verify(body, wrong_version, SECRET, now=NOW) is None
    assert events.verify(body, {}, SECRET, now=NOW) is None
    assert events.verify(body, good, "not-a-secret", now=NOW) is None


# === 2. suppression ===============================================================================
def test_a_complaint_suppresses_the_address_for_every_non_transactional_kind(
    client: TestClient, _watch: store.WatchStore
) -> None:
    assert post(client, an_event("email.complained")).status_code == 200
    assert _watch.is_suppressed(to_hash(PARENT))

    for kind in ("learning_note", "quick_one", "sunday_note", "wish", "parent_invite"):
        held = send_email(kind, PARENT, {"name": "Learner"}, learner_id="L1", period=f"p-{kind}")
        assert held["ok"] is False and held["error"] == "suppressed", (kind, held)
    # Nothing was recorded as a send or a would-send: a suppression is not "try again later".
    assert [r for r in email_mod.mail_log().records() if r.to_hash == to_hash(PARENT)] == []

    # A sign-in code and a receipt still reach the address.
    for kind in ("verify_email", "plan_opened"):
        assert send_email(kind, PARENT, {}, period=f"t-{kind}")["ok"] is True, kind
    # And every other address is untouched.
    assert send_email("learning_note", "other@example.test", {}, period="x")["ok"] is True


def test_a_hard_bounce_suppresses_and_a_soft_one_does_not(
    client: TestClient, _watch: store.WatchStore
) -> None:
    soft = an_event(
        "email.bounced",
        to="soft@example.test",
        bounce={"type": "Temporary", "subType": "MailboxFull", "message": "mailbox full"},
    )
    assert post(client, soft, msg_id="msg_soft").status_code == 200
    assert not _watch.is_suppressed(to_hash("soft@example.test"))

    hard = an_event(
        "email.bounced",
        to="gone@example.test",
        bounce={"type": "Permanent", "subType": "General", "message": "no such user"},
    )
    assert post(client, hard, msg_id="msg_hard").status_code == 200
    assert _watch.is_suppressed(to_hash("gone@example.test"))
    rows = _watch.rows(store.SUPPRESSION)
    assert [(r.event, r.kind) for r in rows] == [("hard_bounce", "learning_note")]


def test_the_providers_own_suppression_list_is_honoured_too(
    client: TestClient, _watch: store.WatchStore
) -> None:
    """The provider suppresses an address only after a hard bounce or a complaint, and will not
    deliver to it; writing to it again only adds noise to the counts."""
    event = an_event(
        "email.suppressed",
        to="listed@example.test",
        suppressed={"type": "OnAccountSuppressionList", "message": "on the list"},
    )
    assert post(client, event).status_code == 200
    assert _watch.is_suppressed(to_hash("listed@example.test"))


def test_a_delay_and_a_delivery_stop_nothing(client: TestClient, _watch: store.WatchStore) -> None:
    assert post(client, an_event("email.delivery_delayed"), msg_id="a").status_code == 200
    assert post(client, an_event("email.delivered"), msg_id="b").status_code == 200
    assert _watch.suppressed_count() == 0


# === 3. counting ==================================================================================
def test_a_replayed_delivery_is_counted_once(client: TestClient, _watch: store.WatchStore) -> None:
    """The provider retries anything that did not answer 2xx; the message id is signed, so a
    retry is the same event and never a second one."""
    for _ in range(3):
        assert post(client, an_event("email.complained"), msg_id="msg_same").status_code == 200
    assert len(_watch.rows(store.DELIVERY)) == 1
    assert _watch.suppressed_count() == 1


def test_events_are_counted_per_day_and_per_kind(client: TestClient) -> None:
    yesterday = NOW - timedelta(days=1)
    plan: list[tuple[str, str, datetime]] = [
        ("email.delivered", "learning_note", NOW),
        ("email.delivered", "learning_note", NOW),
        ("email.delivered", "sunday_note", yesterday),
        ("email.complained", "sunday_note", yesterday),
        ("email.delivery_delayed", "quick_one", NOW),
    ]
    for n, (name, kind, when) in enumerate(plan):
        payload = an_event(name, kind=kind, at=when, to=f"r{n}@example.test")
        assert post(client, payload, msg_id=f"m{n}").status_code == 200
    counts = events.daily_counts(since=yesterday.date())
    assert counts == [
        {
            "day": yesterday.date().isoformat(),
            "kind": "sunday_note",
            "event": "complained",
            "count": 1,
        },
        {
            "day": yesterday.date().isoformat(),
            "kind": "sunday_note",
            "event": "delivered",
            "count": 1,
        },
        {"day": NOW.date().isoformat(), "kind": "learning_note", "event": "delivered", "count": 2},
        {"day": NOW.date().isoformat(), "kind": "quick_one", "event": "delayed", "count": 1},
    ]


def test_the_kind_is_the_tag_else_the_feedback_id_else_our_own_send_log() -> None:
    tagged = an_event("email.delivered", kind="streak")["data"]
    assert events.kind_of(tagged) == "streak"

    headed = an_event("email.delivered", kind=None)["data"]
    headed["headers"] = [{"name": "Feedback-ID", "value": "doubt:subscribed:p1:wobomail"}]
    assert events.kind_of(headed) == "doubt"

    email_mod.mail_log().record(
        MailRecord(
            key="k1",
            learner_id="L1",
            kind="mid_chapter",
            to_hash=to_hash(PARENT),
            period="p",
            sent_at=NOW.isoformat(),
            provider_id="em_logged",
        )
    )
    logged = an_event("email.delivered", kind=None, email_id="em_logged")["data"]
    assert events.kind_of(logged) == "mid_chapter"

    stranger = an_event("email.delivered", kind=None, email_id="em_nobody")["data"]
    assert events.kind_of(stranger) == "unknown"
    # A tag that is not one of our kinds is not trusted as one.
    forged = an_event("email.delivered", kind="<script>")["data"]
    assert events.kind_of(forged) == "unknown"


def test_no_address_is_ever_kept(client: TestClient, _watch: store.WatchStore) -> None:
    assert post(client, an_event("email.complained"), msg_id="m1").status_code == 200
    kept = repr(_watch.rows(store.DELIVERY)) + repr(_watch.rows(store.SUPPRESSION))
    assert "@" not in kept
    assert "example.test" not in kept
    assert to_hash(PARENT) in kept


def test_an_open_or_a_click_event_means_tracking_is_on_and_the_owner_is_told(
    client: TestClient, _watch: store.WatchStore
) -> None:
    """The law keeps the provider's open and click tracking off. An open event arriving at all is
    the proof that somebody turned it on, and that is an alert, never a metric."""
    assert post(client, an_event("email.opened"), msg_id="o1").status_code == 200
    assert _watch.rows(store.DELIVERY) == []
    causes = [row.event for row in _watch.rows(store.ALERT)]
    assert causes == ["tracking_on"]


def test_a_bounce_that_names_authentication_raises_that_alert(
    client: TestClient, _watch: store.WatchStore
) -> None:
    bounced = an_event(
        "email.bounced",
        to="strict@example.test",
        bounce={
            "type": "Permanent",
            "subType": "General",
            "message": "550 5.7.26 Unauthenticated email is not accepted from this domain",
        },
    )
    assert post(client, bounced).status_code == 200
    assert "authentication" in [row.event for row in _watch.rows(store.ALERT)]


def test_a_body_that_is_not_an_event_is_answered_without_a_crash(client: TestClient) -> None:
    for junk in ([], {"type": 7}, {"type": "email.delivered", "data": "nope"}):
        response = post(client, junk, msg_id=f"j{len(str(junk))}")  # type: ignore[arg-type]
        assert response.status_code in (200, 400), response.text


def test_the_send_names_its_kind_to_the_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """The tag is what lets a complaint find its kind with no header parsing at all. It is
    provider metadata and never appears in the message a person reads."""
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.setenv("RESEND_API_KEY", "test-key-never-logged")
    wire: list[dict[str, Any]] = []

    def fake_post(body: bytes, key: str, idem: str | None) -> Any:
        wire.append(json.loads(body.decode()))
        return email_mod._Reply(ok=True, status=200, result={"id": "em_t"})

    monkeypatch.setattr(email_mod, "_post", fake_post)
    send_email("verify_email", PARENT, {}, period="tag")
    assert wire[-1]["tags"] == [{"name": "kind", "value": "verify_email"}]
    alerts.reset()
