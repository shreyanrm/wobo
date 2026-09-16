"""Where the deliverability watch was sound at the door and failed behind it (2026-09-16).

docs/MAIL-PRIMARY.md, "Watching where we land", and the owner: *"be tactical, dont slow down,
and change whats necessary but make sure i get alerted at shreyan@doteventures.com"*.

1. A bounce message naming an address carried that address into the alert row, the alarm, the
   owner's mail and the desk the lowest console seat reads.
2. One failed read at start forgot every complainer until the next restart, with no alarm.
3. A read capped by the project's row limit forgot the newest complainers and the week's
   complaints.
4. An alert that could not be mailed was never mailed, while the desk said it had been.
5. The day's cap held sign-in codes and receipts.
6. Complaints about mail sent before the owner lifted a pause paused the kind again.
7. A single complaint over Gmail's cliff paused nothing and told nobody.
8. The webhook did its database writes on the thread that serves every other request.

Nothing leaves the process: the provider call is a recorder, the project is a fake.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from conftest import TEST_JWT_SECRET, mint
from fastapi.testclient import TestClient
from test_mail_watch_events import SECRET, signed
from wobo_gateway import admin_auth, alerts, doors
from wobo_gateway import email as email_mod
from wobo_gateway.admin_auth import ADMIN_PREFIX, VIEWER, InMemoryAdminStore
from wobo_gateway.email import MailLog, send_email, to_hash
from wobo_gateway.mailwatch import api as watch_api
from wobo_gateway.mailwatch import events, respond, store

NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)
OWNER = "shreyan@doteventures.com"
ADDRESS = re.compile(r"[^\s<>@\"']+@[^\s<>@\"']+")
SUBJECT = "71111111-1111-4111-8111-111111111111"


@pytest.fixture(autouse=True)
def _watch(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("RESEND_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    monkeypatch.setenv("ADMIN_STORE", "memory")
    monkeypatch.setenv("ADMIN_REQUIRE_MFA", "0")
    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "internal-test-key")
    monkeypatch.delenv("MAIL_DAILY_CAP", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("ENV", raising=False)
    watch = store.WatchStore()
    store.set_store(watch)
    events.set_clock(lambda: NOW)
    doors.set_store(doors.InMemorySettingsStore())
    email_mod.set_mail_log(MailLog())
    admins = InMemoryAdminStore()
    admin_auth.set_store(admins)
    admin_auth.reset_limiter()
    yield watch, admins
    events.set_clock(None)
    store.set_store(None)
    doors.set_store(None)
    admin_auth.set_store(None)
    email_mod.reset_mail_log()


@pytest.fixture()
def client() -> TestClient:
    from wobo_gateway.app import create_app

    return TestClient(create_app())


@pytest.fixture()
def pages(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://hooks.example.test/alarm")
    sink: list[dict[str, Any]] = []
    alerts.set_sender(lambda url, payload: sink.append(payload))
    alerts.set_runner(lambda go: go())
    yield sink
    alerts.reset()


class Provider:
    """The provider's API, recorded. ``fail`` answers every send with a 500."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.sent: list[dict[str, Any]] = []

    def __call__(self, body: bytes, key: str, idem: str | None) -> Any:
        if self.fail:
            return email_mod._Reply(ok=False, status=500, detail="provider down")
        self.sent.append(json.loads(body))
        return email_mod._Reply(ok=True, status=200, result={"id": f"re_{len(self.sent)}"})


def live(monkeypatch: pytest.MonkeyPatch, provider: Provider | None, *, key: bool = True) -> None:
    monkeypatch.setenv("EMAIL_MODE", "live")
    monkeypatch.setenv("EMAIL_POSTAL_ADDRESS", "Wobo, 1 Test Street, Hyderabad 500001, India")
    if key:
        monkeypatch.setenv("RESEND_API_KEY", "re_test_not_a_real_key")
    else:
        monkeypatch.delenv("RESEND_API_KEY", raising=False)

    def refuse(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("nothing may reach the provider here")

    monkeypatch.setattr(email_mod, "_post", provider or refuse)


def event(
    name: str,
    kind: str,
    i: int,
    *,
    at: datetime = NOW,
    sent_at: datetime | None = None,
    **data: Any,
) -> None:
    body: dict[str, Any] = {
        "email_id": f"em_{name}_{i}",
        "created_at": (sent_at or at).isoformat(),
        "to": [f"reader{i}@example.test"],
        "tags": {"kind": kind},
        **data,
    }
    events.take(
        {"type": name, "created_at": at.isoformat(), "data": body},
        event_id=f"{name}-{kind}-{i}-{at.isoformat()}",
        now=max(at, NOW),
    )


def viewer(client: TestClient, admins: InMemoryAdminStore) -> dict[str, str]:
    bearer = {"Authorization": f"Bearer {mint(SUBJECT, secret=TEST_JWT_SECRET)}"}
    admins.upsert_admin(
        subject_id=SUBJECT,
        email="ops@example.com",
        role=VIEWER,
        granted_by=None,
        mfa_required=False,
    )
    opened = client.post(f"{ADMIN_PREFIX}/session", headers=bearer)
    assert opened.status_code == 200, opened.text
    return {**bearer, admin_auth.SESSION_HEADER: opened.json()["session_token"]}


# === 1. a bounce never carries an address anywhere ===============================================
def test_a_bounce_message_naming_an_address_leaks_it_nowhere(
    client: TestClient, _watch: Any, pages: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    watch, admins = _watch
    rendered: list[dict[str, Any]] = []
    real = email_mod.render
    monkeypatch.setattr(
        email_mod, "render", lambda kind, data: rendered.append(dict(data)) or real(kind, data)
    )
    payload = {
        "type": "email.bounced",
        "created_at": NOW.isoformat(),
        "data": {
            "email_id": "em_b",
            "created_at": NOW.isoformat(),
            "to": ["aarav.sharma2014@school.example"],
            "tags": {"kind": "learning_note"},
            "bounce": {
                "type": "Permanent",
                "subType": "General",
                "message": "550 5.7.26 Unauthenticated email from mail.heywobo.com to "
                "<aarav.sharma2014@school.example> is not accepted due to DMARC policy",
            },
        },
    }
    body = json.dumps(payload).encode()
    res = client.post(
        events.EVENTS_PATH,
        content=body,
        headers={"content-type": "application/json", **signed(body, msg_id="msg_leak")},
    )
    assert res.status_code == 200, res.text
    (row,) = watch.rows(store.ALERT)
    assert not ADDRESS.search(json.dumps(row.detail)), row.detail
    assert "DMARC" in row.detail["message"]
    assert pages and not ADDRESS.search(json.dumps(pages)), pages
    alert_mail = [d for d in rendered if "line" in d]
    assert alert_mail and not ADDRESS.search(json.dumps(alert_mail)), alert_mail
    desk = client.get(f"{ADMIN_PREFIX}/mail", headers=viewer(client, admins))
    assert desk.status_code == 200
    assert "aarav" not in desk.text and "school.example" not in desk.text


def test_an_address_already_kept_in_an_old_alert_is_not_shown(_watch: Any) -> None:
    watch, _ = _watch
    watch.add(
        store.WatchRow(
            store.ALERT,
            "alert:authentication:all:2026-09-16T08",
            NOW - timedelta(hours=1),
            event="authentication",
            detail={"message": "refused for <kid@school.example>", "severity": "critical"},
        )
    )
    shown = watch_api.desk_view(NOW)["alerts"]
    assert shown and not ADDRESS.search(json.dumps(shown)), shown


# === 2. a failed read at start is read again, and holds the mail meanwhile =======================
class Project:
    """``ops.mail_watch`` over PostgREST: fails its first ``fail_first`` reads, then answers,
    ``cap`` rows at most per read, honouring ``limit`` and ``offset`` as PostgREST does."""

    def __init__(self, rows: list[dict[str, Any]], *, fail_first: int = 0, cap: int = 1000) -> None:
        self.rows = rows
        self.fail_first = fail_first
        self.cap = cap
        self.gets = 0

    def __call__(
        self, url: str, key: str, method: str, *, body: Any = None, prefer: str = ""
    ) -> Any:
        if method != "GET":
            return []
        self.gets += 1
        if self.gets <= self.fail_first:
            raise TimeoutError("the project did not answer")
        query = parse_qs(urlsplit(url).query)
        what = query.get("what", [""])[0]
        found = [r for r in self.rows if (r["what"] == "suppression") == (what == "eq.suppression")]
        if "happened_at" in query:
            floor = datetime.fromisoformat(query["happened_at"][0].removeprefix("gte."))
            found = [r for r in found if datetime.fromisoformat(r["happened_at"]) >= floor]
        order = query.get("order", [""])[0]
        if order.startswith("id"):
            found.sort(key=lambda r: r["id"])
        else:
            found.sort(key=lambda r: r["happened_at"])
        offset = int(query.get("offset", ["0"])[0])
        limit = min(int(query.get("limit", [str(self.cap)])[0]), self.cap)
        return found[offset : offset + limit]


def a_row(n: int, what: str, key: str, at: datetime, **kw: Any) -> dict[str, Any]:
    return {
        "id": n,
        "what": what,
        "key": key,
        "happened_at": at.isoformat(),
        "kind": kw.get("kind", ""),
        "event": kw.get("event", ""),
        "to_hash": kw.get("to_hash"),
        "detail": kw.get("detail", {}),
    }


def test_a_failed_read_at_start_is_tried_again_and_the_complainer_stays_suppressed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    complainer = "complained@example.test"
    project = Project(
        [
            a_row(
                1,
                "suppression",
                f"suppression:{to_hash(complainer)}",
                NOW - timedelta(days=90),
                to_hash=to_hash(complainer),
                event="complained",
            )
        ],
        fail_first=1,
    )
    clock = [0.0]
    db = store.DatabaseWatchStore(
        "https://project.example", "k", request=project, now=NOW, clock=lambda: clock[0]
    )
    store.set_store(db)
    assert db.readable is False
    # While the list cannot be read, no learning mail goes to anybody: a complainer is unknown.
    held = send_email("learning_note", complainer, {}, period="p1")
    assert held.get("queued") and held["error"] == "suppression_unreadable"
    assert send_email("verify_email", complainer, {"code": "123456"}, period="v1")["ok"] is True
    clock[0] += store.RETRY_S + 1
    assert db.is_suppressed(to_hash(complainer)) is True
    assert db.readable is True
    assert send_email("learning_note", complainer, {}, period="p2")["error"] == "suppressed"


def test_an_unreadable_list_rings_the_owner(
    monkeypatch: pytest.MonkeyPatch, pages: list[dict[str, Any]]
) -> None:
    project = Project([], fail_first=10_000)
    db = store.DatabaseWatchStore("https://project.example", "k", request=project, now=NOW)
    store.set_store(db)
    send_email("learning_note", "someone@example.test", {}, period="p1", at=NOW)
    causes = [r.event for r in db.rows(store.ALERT)]
    assert respond.WATCH_UNREADABLE in causes
    assert any(p["fields"].get("cause") == respond.WATCH_UNREADABLE for p in pages), pages
    owner = [r for r in email_mod.mail_log().records() if r.kind == "mail_alert"]
    assert owner and owner[0].to_hash == to_hash(OWNER)
    # And the hourly pass rings it too, when no mail was even attempted.
    report = watch_api.run_watch(NOW + timedelta(hours=2))
    assert report["store"]["readable"] is False


# === 3. every row, however many =================================================================
def test_every_suppression_and_every_recent_row_is_read_past_the_row_cap() -> None:
    rows = [
        a_row(
            n,
            "suppression",
            f"suppression:{n:016x}",
            NOW - timedelta(days=500 - n // 10),
            to_hash=f"{n:016x}",
            event="complained",
        )
        for n in range(1, 1201)
    ]
    rows += [
        a_row(
            2000 + n,
            "delivery",
            f"delivery:d{n}",
            NOW - timedelta(days=39, minutes=-n),
            kind="learning_note",
            event="delivered",
        )
        for n in range(1500)
    ]
    rows += [
        a_row(
            9000 + n,
            "delivery",
            f"delivery:c{n}",
            NOW - timedelta(hours=5 - n),
            kind="learning_note",
            event="complained",
            to_hash=f"{9000 + n:016x}",
        )
        for n in range(3)
    ]
    project = Project(rows, cap=1000)
    db = store.DatabaseWatchStore("https://project.example", "k", request=project, now=NOW)
    assert db.readable is True
    assert db.suppressed_count() == 1200
    assert db.is_suppressed(f"{1200:016x}")
    recent = db.rows(store.DELIVERY)
    assert len(recent) == 1503
    assert sum(1 for r in recent if r.event == "complained") == 3


# === 4. an alert that was not mailed is mailed again, and the desk says which ===================
@pytest.mark.parametrize("why", ["no_key", "provider_500"])
def test_an_alert_that_could_not_be_mailed_is_retried_and_the_desk_says_so(
    monkeypatch: pytest.MonkeyPatch, why: str
) -> None:
    provider = Provider(fail=why == "provider_500")
    live(monkeypatch, provider, key=why != "no_key")
    for i in range(1000):
        event("email.delivered", "learning_note", i)
    for i in range(3):
        event("email.complained", "learning_note", 100 + i)
    respond.evaluate(NOW)
    assert "learning_note" in respond.paused()
    (shown,) = watch_api.desk_view(NOW)["alerts"]
    assert shown["mailed"] is False
    # The cause clears: the key is set, the provider answers.
    live(monkeypatch, Provider())
    healthy = Provider()
    monkeypatch.setattr(email_mod, "_post", healthy)
    watch_api.run_watch(NOW + timedelta(hours=1))
    assert [m["to"] for m in healthy.sent] == [[OWNER]]
    (shown,) = watch_api.desk_view(NOW + timedelta(hours=1))["alerts"]
    assert shown["mailed"] is True
    # Mailed once is mailed: the next pass sends nothing more.
    watch_api.run_watch(NOW + timedelta(hours=2))
    assert len(healthy.sent) == 1


# === 5. the cap never holds a sign-in code or a receipt ==========================================
@pytest.mark.parametrize("kind", ["verify_email", "plan_opened", "account_created"])
def test_the_days_cap_never_holds_a_sign_in_code_or_a_receipt(
    monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    provider = Provider()
    live(monkeypatch, provider)
    monkeypatch.setenv("MAIL_DAILY_CAP", "3")
    from wobo_gateway.hospitality.tokens import stop_link

    for i in range(3):
        facts = {"learner_name": "L", "unsubscribe_url": stop_link(f"L{i}", "sunday_note")}
        sent = send_email("sunday_note", f"p{i}@example.test", facts, period=f"s{i}", at=NOW)
        assert sent["ok"] is True, sent
    capped = send_email("learning_note", "x@example.test", {}, period="n", at=NOW)
    assert capped.get("queued") and capped["error"] == "daily_cap"
    got = send_email(kind, "new@example.test", {"code": "123456"}, period="t", at=NOW)
    assert got["ok"] is True, got


# === 6. a lifted pause is judged on mail sent after the lift =====================================
def test_complaints_about_mail_sent_before_the_lift_do_not_pause_it_again() -> None:
    for i in range(1000):
        event("email.delivered", "learning_note", i, at=NOW - timedelta(days=3))
    for i in range(3):
        event("email.complained", "learning_note", 5000 + i, at=NOW - timedelta(days=3))
    respond.evaluate(NOW - timedelta(days=3))
    assert "learning_note" in respond.paused()
    lifted_at = NOW - timedelta(days=1)
    assert respond.unpause("learning_note", actor="owner", note=None, at=lifted_at)
    for i in range(100):
        event("email.delivered", "learning_note", 2000 + i, at=NOW - timedelta(hours=10))
    for i in range(2):
        event(
            "email.complained",
            "learning_note",
            7000 + i,
            at=NOW - timedelta(hours=2),
            sent_at=NOW - timedelta(days=2),
        )
    respond.evaluate(NOW)
    assert "learning_note" not in respond.paused()


# === 7. one complaint over the cliff pauses its kind, and every crossing tells the owner =========
def test_a_single_complaint_over_the_cliff_pauses_its_kind_and_rings(
    pages: list[dict[str, Any]],
) -> None:
    for i in range(300):
        event("email.delivered", "learning_note", i)
    event("email.complained", "learning_note", 900)  # 0.33 percent, one complaint
    respond.evaluate(NOW)
    assert "learning_note" in respond.paused()
    assert [r.kind for r in store.get_store().rows(store.ALERT)] == ["learning_note"]
    assert any(p["fields"].get("cause") == respond.COMPLAINT_RATE for p in pages), pages
    owner = [r for r in email_mod.mail_log().records() if r.kind == "mail_alert"]
    assert len(owner) == 1


def test_one_complaint_between_the_lines_pauses_nothing_but_the_owner_hears(
    pages: list[dict[str, Any]],
) -> None:
    for i in range(500):
        event("email.delivered", "learning_note", i)
    event("email.complained", "learning_note", 900)  # 0.20 percent, one complaint
    report = respond.evaluate(NOW)
    assert respond.paused() == {}
    assert report["newly_paused"] == []
    rows = store.get_store().rows(store.ALERT)
    assert [(r.event, r.kind) for r in rows] == [(respond.COMPLAINT_WATCH, "learning_note")]
    assert "Nothing was paused" in rows[0].detail["action"]
    owner = [r for r in email_mod.mail_log().records() if r.kind == "mail_alert"]
    assert len(owner) == 1


# === 8. the webhook's writes are off the request loop ============================================
def test_the_webhook_does_its_writes_off_the_event_loop(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    where: list[str] = []
    real = events.take

    def spy(*a: Any, **k: Any) -> Any:
        try:
            asyncio.get_running_loop()
            where.append("event loop")
        except RuntimeError:
            where.append("worker thread")
        return real(*a, **k)

    monkeypatch.setattr(events, "take", spy)
    payload = {
        "type": "email.delivered",
        "created_at": NOW.isoformat(),
        "data": {"email_id": "em_x", "to": ["r@example.test"], "tags": {"kind": "welcome"}},
    }
    body = json.dumps(payload).encode()
    res = client.post(
        events.EVENTS_PATH,
        content=body,
        headers={"content-type": "application/json", **signed(body, msg_id="msg_loop")},
    )
    assert res.status_code == 200, res.text
    assert where == ["worker thread"]
