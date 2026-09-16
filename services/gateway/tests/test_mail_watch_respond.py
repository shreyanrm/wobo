"""Responding without slowing down, and telling the owner (wave 56, the deliverability watch).

The owner: *"be tactical, dont slow down, and change whats necessary but make sure i get alerted at
shreyan@doteventures.com"*. docs/MAIL-PRIMARY.md, "Watching where we land":

* The cadence is never lowered across the board. The response hits the cause.
* A kind whose complaint rate crosses 0.10 percent is paused on its own while every other kind
  carries on. At 0.30 percent (Gmail's cliff) every kind that crossed pauses.
* Sign-in codes and receipts are never paused.
* Every event mails ``DELIVERABILITY_ALERT_TO``, writes the alerts line and lands on the mail
  desk, because an alert about mail must not depend on mail alone. One bad hour is one alert.
* The sender name and address never change automatically.

Two decisions this file pins, named rather than hidden: ONE complaint never pauses a kind for
everybody (the complaining address is suppressed at once, and "one confused adult can report a
legitimate school notice"), and a kind the owner unpauses is judged only on what happens after.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from test_mail_cadence import Recorder, a_family, came, local
from wobo_gateway import alerts, dials, doors
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog, send_email, to_hash
from wobo_gateway.email_templates import TRANSACTIONAL_KINDS, render, text_of
from wobo_gateway.hospitality import cadence, jobs
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.nudges import run_nudges
from wobo_gateway.mailwatch import events, respond, store

NOW = datetime(2026, 9, 16, 9, 0, tzinfo=UTC)
MONDAY = date(2026, 9, 21)
OWNER_INBOX = "shreyan@doteventures.com"


@pytest.fixture(autouse=True)
def _watch(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "a-test-secret")
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    monkeypatch.delenv("MAIL_DAILY_CAP", raising=False)
    watch = store.WatchStore()
    store.set_store(watch)
    doors.set_store(doors.InMemorySettingsStore())
    email_mod.set_mail_log(MailLog())
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    from wobo_gateway import activity

    activity.set_store(activity.InMemoryActivityStore())
    yield watch
    store.set_store(None)
    doors.set_store(None)
    prefs_mod.set_store(None)
    activity.set_store(None)
    email_mod.reset_mail_log()


@pytest.fixture()
def pages(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """The alarm's webhook, captured inline rather than posted."""
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://hooks.example.test/alarm")
    sink: list[dict[str, Any]] = []
    alerts.set_sender(lambda url, payload: sink.append(payload))
    alerts.set_runner(lambda go: go())
    yield sink
    alerts.reset()


_serial = iter(range(1_000_000))


def happened(name: str, kind: str, n: int, *, at: datetime = NOW, bounce: str = "") -> None:
    """``n`` provider events of one kind, each to its own address, through the real intake."""
    for _ in range(n):
        i = next(_serial)
        data: dict[str, Any] = {
            "email_id": f"em_{i}",
            "to": [f"reader{i}@example.test"],
            "tags": {"kind": kind},
        }
        if bounce:
            data["bounce"] = {"type": bounce, "subType": "General", "message": "no"}
        events.take(
            {"type": name, "created_at": at.isoformat(), "data": data},
            event_id=f"e{i}",
            # The provider says when it happened; the watch hears it now. An old event arriving
            # today is judged against today's window, which is what the cron would do too.
            now=max(at, NOW),
        )


def delivered(kind: str, n: int, **kw: Any) -> None:
    happened("email.delivered", kind, n, **kw)


def complained(kind: str, n: int, **kw: Any) -> None:
    happened("email.complained", kind, n, **kw)


def alert_rows(watch: store.WatchStore) -> list[store.WatchRow]:
    return watch.rows(store.ALERT)


# === 1. the thresholds ============================================================================
def test_the_numbers_are_the_laws() -> None:
    assert respond.PAUSE_AT == 0.001
    assert respond.CLIFF == 0.003
    assert set(TRANSACTIONAL_KINDS) <= respond.NEVER_PAUSED
    assert {"verify_email", "plan_opened", "account_created"} <= respond.NEVER_PAUSED


def test_a_kind_over_the_operating_target_is_paused_on_its_own() -> None:
    delivered("learning_note", 2000)
    complained("learning_note", 3)  # 0.15 percent
    delivered("quick_one", 2000)
    complained("quick_one", 1)  # 0.05 percent
    report = respond.evaluate(NOW)

    assert set(respond.paused()) == {"learning_note"}
    assert report["paused"] == ["learning_note"]
    entry = respond.paused()["learning_note"]
    assert entry["reason"] == "complaint_rate"
    assert entry["threshold"] == respond.PAUSE_AT
    assert abs(entry["rate"] - 3 / 2003) < 1e-9 or abs(entry["rate"] - 3 / 2000) < 1e-9

    # The paused kind is held; every other kind carries on, to the same reader.
    held = send_email("learning_note", "x@example.test", {}, period="a")
    assert held.get("queued") and held["error"] == "kind_paused"
    assert send_email("quick_one", "x@example.test", {}, period="b")["ok"] is True
    assert send_email("sunday_note", "y@example.test", {"learner_name": "L"}, period="c")["ok"]


def test_one_complaint_over_the_cliff_pauses_its_kind_and_suppresses_only_its_sender() -> None:
    """Two percent is over Gmail's cliff, however few mails made it: the brief's rule is that at
    0.30 percent every kind that crossed pauses (2026-09-16: one complaint paused nothing)."""
    delivered("learning_note", 50)
    complained("learning_note", 1)  # two percent, and one person
    respond.evaluate(NOW)
    assert set(respond.paused()) == {"learning_note"}
    assert store.get_store().suppressed_count() == 1


def test_one_complaint_between_the_lines_pauses_nothing_and_the_owner_hears() -> None:
    delivered("learning_note", 500)
    complained("learning_note", 1)  # 0.2 percent: over the target, under the cliff
    respond.evaluate(NOW)
    assert respond.paused() == {}
    assert store.get_store().suppressed_count() == 1
    assert [r.event for r in store.get_store().rows(store.ALERT)] == [respond.COMPLAINT_WATCH]
    # One complaint is one alert, however many hourly passes read it.
    for hours in range(1, 30):
        respond.evaluate(NOW + timedelta(hours=hours))
    assert len(store.get_store().rows(store.ALERT)) == 1


def test_at_the_cliff_every_kind_that_crossed_pauses() -> None:
    delivered("learning_note", 1000)
    complained("learning_note", 5)  # 0.5 percent
    delivered("streak", 1000)
    complained("streak", 1)  # 0.1 percent exactly: not over
    delivered("quick_one", 500)
    complained("quick_one", 1)  # 0.2 percent, one complaint, but the domain is at the cliff
    delivered("doubt", 1000)  # nothing
    report = respond.evaluate(NOW)
    assert set(respond.paused()) == {"learning_note", "quick_one"}
    assert report["severity"] == alerts.CRITICAL


def test_below_the_cliff_an_overall_crossing_pauses_the_kind_driving_it() -> None:
    """Three kinds, one complaint each: none crosses on its own count, the whole does. The kind
    whose own rate is worst is the one paused, and only that one."""
    delivered("learning_note", 500)
    complained("learning_note", 1)  # 0.2 percent
    delivered("streak", 1000)
    complained("streak", 1)  # 0.1 percent
    delivered("mid_chapter", 1000)
    complained("mid_chapter", 1)  # 0.1 percent
    report = respond.evaluate(NOW)
    assert set(respond.paused()) == {"learning_note"}
    assert report["severity"] == alerts.WARN


def test_sign_in_codes_and_receipts_are_never_paused() -> None:
    for kind in ("verify_email", "plan_opened", "account_created"):
        delivered(kind, 100)
        complained(kind, 10)
    respond.evaluate(NOW)
    assert respond.paused() == {}
    assert respond.pause("verify_email", at=NOW, reason="complaint_rate") is False
    # Even a dial written by hand in the SQL editor cannot hold one.
    doors.get_store().write(
        email_mod.KINDS_PAUSED_DIAL,
        {"verify_email": {"paused": True}, "plan_opened": {"paused": True}},
        actor="sql",
        note=None,
    )
    assert send_email("verify_email", "z@example.test", {}, period="v")["ok"] is True
    assert send_email("plan_opened", "z@example.test", {}, period="r")["ok"] is True


def test_the_cadence_is_never_lowered_across_the_board(monkeypatch: pytest.MonkeyPatch) -> None:
    ladder_before = dials.value(dials.MAIL_LADDER_KEY)
    cap_before = email_mod.daily_cap()
    from_before = email_mod._FROM
    env_before = dict(os.environ)
    delivered("learning_note", 1000)
    complained("learning_note", 10)  # one percent, over the cliff
    respond.evaluate(NOW)
    assert set(respond.paused()) == {"learning_note"}
    assert dials.value(dials.MAIL_LADDER_KEY) == ladder_before
    assert email_mod.daily_cap() == cap_before
    assert from_before == email_mod._FROM
    assert dict(os.environ) == env_before
    assert email_mod.kind_is_off("quick_one") is False


def test_a_paused_kind_is_skipped_by_the_cadence_which_offers_the_next() -> None:
    """A quiet spell earns a quick one; with the quick one paused, the family still gets the
    floor's good news that day, exactly as if they had stopped that one kind themselves."""
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=cadence.QUIET_DAYS), done=3)
    respond.pause("quick_one", at=NOW, reason="complaint_rate")
    send = Recorder()
    run_nudges(
        local(MONDAY, 19), source=cadence.CadenceNudges(jobs.InMemoryFamilies([family])), send=send
    )
    assert [s["kind"] for s in send.sent] == ["learning_note"]


def test_a_suppressed_address_is_planned_nothing() -> None:
    family = a_family()
    came(family.learner_id, MONDAY - timedelta(days=1), done=3)
    store.get_store().suppress(
        to_hash(family.parent_email), reason="complained", kind="learning_note", at=NOW
    )
    send = Recorder()
    report = run_nudges(
        local(MONDAY, 16), source=cadence.CadenceNudges(jobs.InMemoryFamilies([family])), send=send
    )
    assert send.sent == []
    assert report["checked"] == 0


# === 2. the owner hears ===========================================================================
def test_an_alert_mails_the_owner_rings_the_alarm_and_lands_on_the_desk(
    pages: list[dict[str, Any]], _watch: store.WatchStore
) -> None:
    delivered("learning_note", 1000)
    complained("learning_note", 2)
    respond.evaluate(NOW)

    # The mail, through the ordinary send path, to the owner's inbox.
    sent = [r for r in email_mod.mail_log().records() if r.kind == respond.ALERT_KIND]
    assert [r.to_hash for r in sent] == [to_hash(OWNER_INBOX)]
    # The alarm, with its event name and the cause.
    assert [p["event"] for p in pages] == [alerts.MAIL_DELIVERABILITY]
    assert pages[0]["fields"]["cause"] == "complaint_rate"
    assert pages[0]["fields"]["kind"] == "learning_note"
    # The desk's own row, which stands whether or not the mail or the webhook worked.
    rows = alert_rows(_watch)
    assert [(r.event, r.kind) for r in rows] == [("complaint_rate", "learning_note")]
    assert (
        "learning_note" in rows[0].detail["message"]
        or "learning notes" in rows[0].detail["message"]
    )


def test_the_alert_address_is_a_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    assert respond.alert_to() == OWNER_INBOX
    monkeypatch.setenv(respond.ALERT_TO_ENV, "ops@example.test")
    respond.raise_alert("seed_in_spam", "a seed landed in spam", severity=alerts.WARN, at=NOW)
    sent = [r for r in email_mod.mail_log().records() if r.kind == respond.ALERT_KIND]
    assert [r.to_hash for r in sent] == [to_hash("ops@example.test")]


def test_an_alert_is_not_held_by_the_days_cap_or_a_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_DAILY_CAP", "0")
    doors.get_store().write(
        email_mod.KINDS_PAUSED_DIAL, {respond.ALERT_KIND: {"paused": True}}, actor="sql", note=None
    )
    assert respond.raise_alert("authentication", "dkim failed", severity=alerts.CRITICAL, at=NOW)
    sent = [r for r in email_mod.mail_log().records() if r.kind == respond.ALERT_KIND]
    assert sent and sent[0].provider_id == "console"


def test_one_bad_hour_is_one_alert(pages: list[dict[str, Any]], _watch: store.WatchStore) -> None:
    for _ in range(5):
        respond.raise_alert(
            "seed_in_spam", "gmail put it in spam", severity=alerts.WARN, kind="welcome", at=NOW
        )
    assert len(alert_rows(_watch)) == 1
    assert len([r for r in email_mod.mail_log().records() if r.kind == respond.ALERT_KIND]) == 1
    assert len(pages) == 1
    # A different cause in the same hour is its own alert, and is not swallowed by the first.
    assert respond.raise_alert("authentication", "dmarc failed", severity=alerts.CRITICAL, at=NOW)
    assert len(pages) == 2
    # The same cause the next hour is a new alert.
    later = NOW + timedelta(hours=1)
    assert respond.raise_alert(
        "seed_in_spam", "still in spam", severity=alerts.WARN, kind="welcome", at=later
    )
    assert len(alert_rows(_watch)) == 3


def test_the_alert_says_a_sender_change_is_a_manual_setting() -> None:
    mail = render(
        respond.ALERT_KIND,
        {
            "headline": "Learning notes paused",
            "line": "Complaints crossed the line.",
            "action": "Paused.",
        },
    )
    text = text_of(mail)
    assert "EMAIL_FROM" in text
    assert "by hand" in text
    assert mail["subject"].startswith("Mail watch")
    assert respond.ALERT_KIND in TRANSACTIONAL_KINDS


def test_nothing_in_the_watch_can_change_a_sender() -> None:
    """The response never touches the sender name or address. Held on the source, because the
    one way it could is an environment write, and there must be none to find."""
    root = Path(respond.__file__).parent
    for path in root.glob("*.py"):
        source = path.read_text()
        for forbidden in ("os.environ[", "os.putenv", "setenv(", "environ.update", "EMAIL_FROM ="):
            assert forbidden not in source, f"{path.name}: {forbidden}"


# === 3. the owner lifts a pause ===================================================================
def test_an_unpaused_kind_is_judged_only_on_what_happens_after() -> None:
    delivered("learning_note", 1000, at=NOW - timedelta(days=1))
    complained("learning_note", 3, at=NOW - timedelta(days=1))
    respond.evaluate(NOW)
    assert "learning_note" in respond.paused()

    assert respond.unpause("learning_note", actor="owner-1", note="copy fixed", at=NOW) is True
    assert respond.paused() == {}
    assert email_mod.kind_is_paused("learning_note") is False
    change = doors.get_store().changes[-1]
    assert change["actor"] == "owner-1" and change["note"] == "copy fixed"

    # The old complaints do not pause it again.
    respond.evaluate(NOW + timedelta(minutes=5))
    assert respond.paused() == {}
    # New ones do.
    later = NOW + timedelta(hours=2)
    delivered("learning_note", 500, at=later)
    complained("learning_note", 2, at=later)
    respond.evaluate(later)
    assert "learning_note" in respond.paused()


def test_unpausing_a_kind_that_is_not_paused_says_so() -> None:
    assert respond.unpause("streak", actor="owner-1", note=None, at=NOW) is False


def test_the_window_forgets_last_months_complaints() -> None:
    old = NOW - timedelta(days=respond.WINDOW_DAYS + 1)
    delivered("learning_note", 100, at=old)
    complained("learning_note", 5, at=old)
    respond.evaluate(NOW)
    assert respond.paused() == {}


def test_the_denominator_falls_back_to_our_own_sends_when_deliveries_are_not_reported() -> None:
    for i in range(1500):
        email_mod.mail_log().record(
            email_mod.MailRecord(
                key=f"k{i}",
                learner_id=None,
                kind="streak",
                to_hash=to_hash(f"s{i}@example.test"),
                period="p",
                sent_at=NOW.isoformat(),
                provider_id=f"em_s{i}",
            )
        )
    complained("streak", 2)  # 2 in 1500: 0.13 percent
    window = respond.window(NOW)
    assert window.kinds["streak"].delivered == 1500
    respond.evaluate(NOW)
    assert "streak" in respond.paused()
