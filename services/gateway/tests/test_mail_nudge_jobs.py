"""The five nudges as SENDS: every law, with the clock handed in (docs/EMAILS-AND-ANIMATIONS.md).

Console transport only, no network, no wall clock. The shape follows test_hospitality_jobs.py:
a fake send that records, a fresh mail log and a fresh preferences store per test, and every
moment a value.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog, MailRecord, mail_log, to_hash
from wobo_gateway.hospitality import nudges as nudges_mod
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.nudges import (
    InMemoryNudges,
    Learner,
    Nudge,
    run_nudges,
    send_nudge,
)
from wobo_gateway.hospitality.preferences import DEFAULT_PREFERENCES
from wobo_gateway.hospitality.tokens import parse_stop_token

IST = ZoneInfo("Asia/Kolkata")

# 2026-09-09 is a Wednesday. 16:00 in Kolkata is 10:30 UTC.
FOUR_PM_IST = datetime(2026, 9, 9, 10, 30, tzinfo=UTC)
NINE_PM_IST = datetime(2026, 9, 9, 15, 30, tzinfo=UTC)
SEVEN_AM_IST = datetime(2026, 9, 9, 1, 30, tzinfo=UTC)

TEEN = Learner(
    learner_id="L-1",
    name="Learner",
    email="learner@example.test",
    parent_email="parent@example.test",
    under_13=False,
    timezone="Asia/Kolkata",
    last_seen=date(2026, 9, 6),
)
CHILD = replace(TEEN, learner_id="L-2", under_13=True)


class Recorder:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def __call__(
        self, kind: str, to: str, data: dict[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any]:
        self.sent.append({"kind": kind, "to": to, "data": data or {}, **kw})
        return {"ok": True, "mode": "console"}


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    email_mod.set_mail_log(MailLog())
    store = prefs_mod.InMemoryPreferencesStore()
    prefs_mod.set_store(store)
    yield store
    prefs_mod.set_store(None)
    email_mod.reset_mail_log()


def a_nudge(kind: str = "quick_one", learner: Learner = TEEN, **data: Any) -> Nudge:
    return Nudge(kind=kind, learner=learner, once_key=data.pop("once_key", "k1"), data=data)


# --- the dial --------------------------------------------------------------------------------
def test_each_kind_has_its_own_dial(_clean: Any) -> None:
    _clean.put("L-1", replace(DEFAULT_PREFERENCES, quick_one=False))
    send = Recorder()
    assert send_nudge(a_nudge("quick_one"), now=FOUR_PM_IST, send=send)["error"] == "opted_out"
    # The streak's own dial is untouched by the quick one's.
    assert send_nudge(a_nudge("streak", days=7), now=FOUR_PM_IST, send=send)["ok"]


def test_a_store_that_cannot_answer_sends_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nudges_mod, "dials", lambda _id: None)
    send = Recorder()
    assert send_nudge(a_nudge(), now=FOUR_PM_IST, send=send)["error"] == "prefs_unavailable"
    assert send.sent == []


def test_the_stop_link_stops_only_this_kind() -> None:
    send = Recorder()
    send_nudge(a_nudge("streak", days=7), now=FOUR_PM_IST, send=send)
    url = send.sent[0]["data"]["unsubscribe_url"]
    claim = parse_stop_token(url.split("token=")[1])
    assert claim is not None and claim.audience == "streak"
    assert claim.kinds == ("streak",)


# --- the hours law ----------------------------------------------------------------------------
def test_never_after_eight_in_the_evening() -> None:
    send = Recorder()
    out = send_nudge(a_nudge(), now=NINE_PM_IST, send=send)
    assert out["error"] == "not_the_hour" and send.sent == []


def test_never_before_the_morning() -> None:
    send = Recorder()
    assert send_nudge(a_nudge(), now=SEVEN_AM_IST, send=send)["error"] == "not_the_hour"


def test_four_in_the_afternoon_when_we_do_not_know_their_hour() -> None:
    send = Recorder()
    assert send_nudge(a_nudge(), now=FOUR_PM_IST, send=send)["ok"]


def test_the_hour_they_usually_learn_wins() -> None:
    early = replace(TEEN, usual_hour=10)
    ten_am_ist = datetime(2026, 9, 9, 4, 30, tzinfo=UTC)
    send = Recorder()
    assert send_nudge(a_nudge(learner=early), now=ten_am_ist, send=send)["ok"]
    # And before that hour it waits rather than arriving early.
    nine_am_ist = datetime(2026, 9, 9, 3, 30, tzinfo=UTC)
    assert send_nudge(a_nudge(learner=early), now=nine_am_ist, send=send)["error"] == "not_the_hour"


def test_a_family_whose_locality_we_do_not_know_hears_nothing() -> None:
    nowhere = replace(TEEN, timezone="")
    send = Recorder()
    result = send_nudge(a_nudge(learner=nowhere), now=FOUR_PM_IST, send=send)
    assert result["error"] == "no_locality"


# --- the inbox law ------------------------------------------------------------------------------
def test_never_twice_in_twenty_four_hours_to_one_address() -> None:
    mail_log().record(
        MailRecord(
            key="x",
            learner_id="L-other",
            kind="sunday_note",
            to_hash=to_hash(TEEN.email),
            period="p",
            sent_at=(FOUR_PM_IST - timedelta(hours=3)).isoformat(),
            provider_id="console",
        )
    )
    send = Recorder()
    assert send_nudge(a_nudge(), now=FOUR_PM_IST, send=send)["error"] == "gap"
    # A day later the same address may hear from us again.
    assert send_nudge(a_nudge(), now=FOUR_PM_IST + timedelta(days=1), send=send)["ok"]


def test_never_on_a_day_the_learner_came() -> None:
    came_today = replace(TEEN, last_seen=date(2026, 9, 9))
    send = Recorder()
    result = send_nudge(a_nudge(learner=came_today), now=FOUR_PM_IST, send=send)
    assert result["error"] == "came_today"


def test_three_days_running_and_the_week_is_quiet_but_for_the_sunday_note() -> None:
    keen = replace(TEEN, last_seen=date(2026, 9, 8), days_this_week=3)
    send = Recorder()
    assert send_nudge(a_nudge(learner=keen), now=FOUR_PM_IST, send=send)["error"] == "came_enough"
    result = send_nudge(a_nudge("mid_chapter", learner=keen), now=FOUR_PM_IST, send=send)
    assert result["error"] == "came_enough"
    # The streak note is what that week EARNED; it is not a nudge to come back.
    assert send_nudge(a_nudge("streak", learner=keen, days=3), now=FOUR_PM_IST, send=send)["ok"]


def test_the_same_nudge_is_never_sent_twice() -> None:
    # The real send path, in the console mode conftest sets: the mail log is what remembers.
    first = send_nudge(
        a_nudge(once_key="fractions-2"), now=FOUR_PM_IST, send=email_mod.send_email
    )
    assert first["ok"]
    again = send_nudge(
        a_nudge(once_key="fractions-2"),
        now=FOUR_PM_IST + timedelta(days=3),
        send=email_mod.send_email,
    )
    assert again.get("duplicate") is True


# --- who it goes to -------------------------------------------------------------------------------
def test_under_thirteen_the_mail_goes_to_the_parent_in_the_parents_register() -> None:
    send = Recorder()
    assert send_nudge(a_nudge(learner=CHILD), now=FOUR_PM_IST, send=send)["ok"]
    sent = send.sent[0]
    assert sent["to"] == "parent@example.test"
    assert sent["data"]["audience"] == "parent"
    assert sent["data"]["learner_name"] == "Learner"


def test_an_age_we_do_not_know_is_treated_as_under_thirteen() -> None:
    unknown = replace(TEEN, under_13=None)
    send = Recorder()
    assert send_nudge(a_nudge(learner=unknown), now=FOUR_PM_IST, send=send)["ok"]
    assert send.sent[0]["to"] == "parent@example.test"


def test_a_child_with_no_parent_on_file_is_not_mailed_at_all() -> None:
    alone = replace(CHILD, parent_email="")
    send = Recorder()
    assert send_nudge(a_nudge(learner=alone), now=FOUR_PM_IST, send=send)["error"] == "no_recipient"
    assert send.sent == []


def test_a_teenager_is_written_to_directly() -> None:
    send = Recorder()
    send_nudge(a_nudge(), now=FOUR_PM_IST, send=send)
    assert send.sent[0]["to"] == "learner@example.test"
    assert send.sent[0]["data"]["audience"] == "learner"
    assert send.sent[0]["data"]["name"] == "Learner"


# --- the deep link ----------------------------------------------------------------------------
def test_the_button_carries_a_signed_link_to_the_exact_card() -> None:
    send = Recorder()
    send_nudge(
        a_nudge(course_id="fractions", card_id="7"),
        now=FOUR_PM_IST,
        send=send,
    )
    cta = send.sent[0]["data"]["cta_url"]
    assert "/course/fractions/card/7?k=" in cta


def test_without_a_card_the_button_still_goes_somewhere_true() -> None:
    send = Recorder()
    send_nudge(a_nudge("streak", days=7), now=FOUR_PM_IST, send=send)
    assert "cta_url" not in send.sent[0]["data"] or "/card/" not in send.sent[0]["data"]["cta_url"]


# --- the pass ---------------------------------------------------------------------------------
def test_a_pass_counts_what_it_did_and_holds_the_rest() -> None:
    source = InMemoryNudges(
        [
            a_nudge("quick_one", once_key="a"),
            a_nudge(
                "doubt", replace(TEEN, learner_id="L-9", email="nine@example.test"), once_key="b"
            ),
        ]
    )
    send = Recorder()
    report = run_nudges(FOUR_PM_IST, source=source, send=send)
    assert report["checked"] == 2 and report["sent"] == 2
    held = run_nudges(NINE_PM_IST, source=source, send=send)
    assert held["sent"] == 0 and held["skipped"]["not_the_hour"] == 2


def test_a_dry_run_sends_nothing() -> None:
    source = InMemoryNudges([a_nudge("quick_one", once_key="a")])
    send = Recorder()
    report = run_nudges(FOUR_PM_IST, source=source, send=send, dry_run=True)
    assert report["would_send"] == 1 and send.sent == []


def test_the_cron_door_is_closed_without_the_internal_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient
    from wobo_gateway.app import create_app

    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    client = TestClient(create_app())
    assert client.post("/v1/internal/mail/nudges").status_code == 403
    ok = client.post(
        "/v1/internal/mail/nudges",
        headers={"X-Wobo-Internal": "test-internal-key"},
        json={"now": FOUR_PM_IST.isoformat(), "dry_run": True},
    )
    assert ok.status_code == 200 and ok.json()["ok"] is True
