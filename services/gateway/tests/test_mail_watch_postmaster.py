"""Reading Google (wave 56, the deliverability watch).

Gmail sends no complaint to the mail provider: a Gmail reader pressing "Report spam" is visible to
us only through Google Postmaster Tools, and Gmail is most of the addresses we write to. So the
reader here is not an extra. It is the complaint rate for most families.

Google retired Postmaster Tools API v1 on 2025-10-31, and with it the domain reputation grade. The
reader speaks v2: ``domainStats:query`` for the spam rate overall and per Feedback-ID, and the
authentication success rates; ``getComplianceStatus`` for the verdict that replaced the grade.
"Reputation below medium" is therefore read as a verdict that names a problem, or a compliance
row that needs work, and the desk says which.

Inert until configured: with no credentials the reader makes no call and says "not configured".
Every call in this file goes to a fake transport.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pytest
from wobo_gateway import doors
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog
from wobo_gateway.mailwatch import postmaster, respond, store

NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)
YESTERDAY = date(2026, 9, 15)
ENV = {
    "POSTMASTER_CLIENT_ID": "client-id.apps.example.test",
    "POSTMASTER_CLIENT_SECRET": "client-secret-not-real",
    "POSTMASTER_REFRESH_TOKEN": "refresh-token-not-real",
}


class Google:
    """The two Google hosts, answered from a script. Every request is kept."""

    def __init__(
        self,
        *,
        spam_rate: float | None = 0.0004,
        fbl: dict[str, float] | None = None,
        auth: dict[str, float] | None = None,
        rows: dict[str, str] | None = None,
        verdict: str = "USER_FEEDBACK_POSITIVE",
        empty: bool = False,
        fail: bool = False,
    ) -> None:
        self.spam_rate = spam_rate
        self.fbl = fbl or {}
        self.auth = auth or {"spf": 1.0, "dkim": 1.0, "dmarc": 1.0}
        self.rows = rows or {"SPF": "COMPLIANT", "DKIM": "COMPLIANT", "DMARC_POLICY": "COMPLIANT"}
        self.verdict = verdict
        self.empty = empty
        self.fail = fail
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        body: Any = None,
        form: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        self.calls.append(
            {"method": method, "url": url, "headers": headers or {}, "body": body, "form": form}
        )
        if self.fail:
            return 503, {"error": "unavailable"}
        if url == postmaster.TOKEN_URL:
            assert form and form["grant_type"] == "refresh_token"
            return 200, {"access_token": "ya29.not-real", "expires_in": 3599}
        assert (headers or {}).get("Authorization") == "Bearer ya29.not-real"
        if url.endswith(":getComplianceStatus"):
            return 200, {
                "name": "domains/heywobo.com/complianceStatus",
                "complianceData": {
                    "domainId": "heywobo.com",
                    "rowData": [
                        {"requirement": k, "status": {"status": v}} for k, v in self.rows.items()
                    ],
                    "deliverabilityStatusVerdict": {
                        "state": {"status": "COMPLIANT"},
                        "reason": self.verdict,
                    },
                },
            }
        assert url.endswith("/domainStats:query"), url
        if self.empty:
            return 200, {}
        stats: list[dict[str, Any]] = []
        day = {"year": YESTERDAY.year, "month": YESTERDAY.month, "day": YESTERDAY.day}
        for definition in body["metricDefinitions"]:
            name = definition["name"]
            metric = definition["baseMetric"]["standardMetric"]
            flt = definition.get("filter", "")
            value: dict[str, Any] | None = None
            if metric == "SPAM_RATE" and self.spam_rate is not None:
                value = {"doubleValue": self.spam_rate}
            elif metric == "FEEDBACK_LOOP_ID":
                value = {"stringList": {"values": list(self.fbl)}}
            elif metric == "FEEDBACK_LOOP_SPAM_RATE":
                fbl_id = flt.split('"')[1]
                value = {"doubleValue": self.fbl[fbl_id]}
            elif metric == "AUTH_SUCCESS_RATE":
                mechanism = flt.split('"')[1]
                value = {"doubleValue": self.auth[mechanism]}
            if value is not None:
                stats.append({"name": name, "metric": name, "date": day, "value": value})
        return 200, {"domainStats": stats}


@pytest.fixture(autouse=True)
def _watch(monkeypatch: pytest.MonkeyPatch) -> Any:
    for key in (*ENV, "POSTMASTER_DOMAIN"):
        monkeypatch.delenv(key, raising=False)
    watch = store.WatchStore()
    store.set_store(watch)
    doors.set_store(doors.InMemorySettingsStore())
    email_mod.set_mail_log(MailLog())
    yield watch
    store.set_store(None)
    doors.set_store(None)
    email_mod.reset_mail_log()


def configure(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)


def refuse(*args: Any, **kwargs: Any) -> tuple[int, Any]:
    raise AssertionError("no call may be made while the reader is not configured")


# === 1. inert until configured ====================================================================
def test_with_no_credentials_nothing_is_called_and_the_desk_says_not_configured() -> None:
    assert postmaster.configured() is False
    report = postmaster.run_postmaster(NOW, http=refuse)
    assert report == {"configured": False}
    assert postmaster.desk_view() == {"configured": False, "reading": None, "note": postmaster.NOTE}


def test_two_of_three_credentials_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTMASTER_CLIENT_ID", ENV["POSTMASTER_CLIENT_ID"])
    monkeypatch.setenv("POSTMASTER_REFRESH_TOKEN", ENV["POSTMASTER_REFRESH_TOKEN"])
    assert postmaster.configured() is False
    assert postmaster.run_postmaster(NOW, http=refuse) == {"configured": False}


# === 2. the reading ===============================================================================
def test_a_day_is_read_from_the_v2_api(monkeypatch: pytest.MonkeyPatch) -> None:
    configure(monkeypatch)
    google = Google(
        fbl={"learning_note": 0.0002, "sunday-note": 0.0},
        auth={"spf": 0.999, "dkim": 1.0, "dmarc": 1.0},
    )
    report = postmaster.run_postmaster(NOW, http=google)
    assert report["configured"] is True and report["read"] == YESTERDAY.isoformat()

    reading = postmaster.desk_view()["reading"]
    assert reading["day"] == YESTERDAY.isoformat()
    assert reading["domain"] == "mail.heywobo.com"
    assert reading["spam_rate"] == 0.0004
    assert reading["kinds"] == {"learning_note": 0.0002, "sunday_note": 0.0}
    assert reading["auth"] == {"spf": 0.999, "dkim": 1.0, "dmarc": 1.0}
    assert reading["verdict"] == {"state": "COMPLIANT", "reason": "USER_FEEDBACK_POSITIVE"}
    assert reading["needs_work"] == []

    urls = [c["url"] for c in google.calls]
    assert urls[0] == postmaster.TOKEN_URL
    assert all(
        u == postmaster.TOKEN_URL or u.startswith(f"{postmaster.API}/domains/mail.heywobo.com")
        for u in urls
    )
    # The FBL spam rate is asked for by the identifiers Google itself reported.
    asked = [
        d.get("filter", "")
        for c in google.calls
        if c["body"]
        for d in c["body"]["metricDefinitions"]
        if d["baseMetric"]["standardMetric"] == "FEEDBACK_LOOP_SPAM_RATE"
    ]
    assert sorted(asked) == [
        'feedback_loop_id = "learning_note"',
        'feedback_loop_id = "sunday-note"',
    ]
    # One day, once: a second pass the same day calls nothing.
    assert postmaster.run_postmaster(NOW, http=refuse)["read"] is None


def test_the_domain_is_a_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    configure(monkeypatch)
    monkeypatch.setenv("POSTMASTER_DOMAIN", "heywobo.com")
    google = Google()
    postmaster.run_postmaster(NOW, http=google)
    assert any("/domains/heywobo.com/" in c["url"] for c in google.calls)


def test_a_day_google_has_not_published_is_tried_again_later(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(monkeypatch)
    report = postmaster.run_postmaster(NOW, http=Google(empty=True))
    assert report["read"] is None
    assert postmaster.desk_view()["reading"] is None
    later = postmaster.run_postmaster(NOW.replace(hour=11), http=Google())
    assert later["read"] == YESTERDAY.isoformat()


def test_google_unavailable_is_a_reason_and_never_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    configure(monkeypatch)
    report = postmaster.run_postmaster(NOW, http=Google(fail=True))
    assert report["read"] is None and report["error"] == "unavailable"
    for secret in ENV.values():
        assert secret not in str(report)
        assert secret not in str(postmaster.desk_view())


# === 3. the response ==============================================================================
def test_a_gmail_complaint_rate_over_the_target_pauses_that_kind_only(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    configure(monkeypatch)
    postmaster.run_postmaster(
        NOW, http=Google(spam_rate=0.0011, fbl={"learning_note": 0.0015, "quick-one": 0.0004})
    )
    assert set(respond.paused()) == {"learning_note"}
    assert respond.paused()["learning_note"]["source"] == "postmaster"
    assert [(a.event, a.kind) for a in _watch.rows(store.ALERT)] == [
        ("complaint_rate", "learning_note")
    ]


def test_at_gmails_cliff_every_kind_that_crossed_pauses(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    configure(monkeypatch)
    postmaster.run_postmaster(
        NOW,
        http=Google(
            spam_rate=0.0035,
            fbl={"learning_note": 0.004, "streak": 0.0012, "doubt": 0.0009, "verify_email": 0.01},
        ),
    )
    assert set(respond.paused()) == {"learning_note", "streak"}
    assert {a.detail["severity"] for a in _watch.rows(store.ALERT)} == {"critical"}


def test_a_gmail_rate_with_no_kind_named_alerts_and_pauses_nothing(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    """Without a Feedback-ID to point at, pausing any one kind would be a guess, and pausing all
    of them would be the across-the-board slowdown the owner ruled out."""
    configure(monkeypatch)
    postmaster.run_postmaster(NOW, http=Google(spam_rate=0.002, fbl={}))
    assert respond.paused() == {}
    assert [a.event for a in _watch.rows(store.ALERT)] == ["gmail_spam_rate"]


def test_a_verdict_that_names_a_problem_is_an_alert_with_the_cause(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    configure(monkeypatch)
    postmaster.run_postmaster(
        NOW,
        http=Google(
            verdict="SPAM_RATE_HIGH", rows={"SPF": "COMPLIANT", "DMARC_ALIGNMENT": "NEEDS_WORK"}
        ),
    )
    rows = _watch.rows(store.ALERT)
    assert {a.event for a in rows} == {"reputation"}
    message = rows[0].detail["message"]
    assert "SPAM_RATE_HIGH" in message or "spam rate high" in message.lower()
    assert "DMARC_ALIGNMENT" in message or "dmarc alignment" in message.lower()
    assert postmaster.desk_view()["reading"]["needs_work"] == ["DMARC_ALIGNMENT"]


def test_authentication_below_the_floor_is_an_alert(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    configure(monkeypatch)
    postmaster.run_postmaster(NOW, http=Google(auth={"spf": 1.0, "dkim": 0.91, "dmarc": 0.9}))
    rows = [a for a in _watch.rows(store.ALERT) if a.event == "authentication"]
    assert len(rows) == 1
    assert "dkim" in rows[0].detail["message"].lower()


def test_a_healthy_day_raises_nothing(
    monkeypatch: pytest.MonkeyPatch, _watch: store.WatchStore
) -> None:
    configure(monkeypatch)
    postmaster.run_postmaster(NOW, http=Google())
    assert _watch.rows(store.ALERT) == []
    assert respond.paused() == {}
