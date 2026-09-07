"""Hospitality jobs (WOBO-PLAN §14.1) — the Sunday note, the welcome, the win, the wish.

Console transport only: nothing touches the network, background sends run inline (conftest),
and every clock is a value handed in.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import email as email_mod
from wobo_gateway.app import create_app
from wobo_gateway.email import MailRecord, idempotency_key, mail_log
from wobo_gateway.email_templates import APP_NAME, APP_URL, HAND_KINDS, render
from wobo_gateway.hospitality import festivals as fest
from wobo_gateway.hospitality import jobs
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.jobs import (
    Family,
    InMemoryFamilies,
    compose_week,
    run_sunday,
    run_wishes,
    send_win,
    stamp_for,
    welcome_after_first_meeting,
    welcome_data,
)
from wobo_gateway.hospitality.tokens import parse_stop_token

INTERNAL = {"X-Wobo-Internal": "test-internal-key"}
STOP = "https://api.heywobo.com/v1/mail/stop?token="
IST = ZoneInfo("Asia/Kolkata")
REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _dials(monkeypatch: pytest.MonkeyPatch) -> Any:
    """A fresh in-memory preferences store per test: no row means the defaults. The calendar is
    the checked-in file, and no festival is confirmed unless a test says so."""
    monkeypatch.delenv("MAIL_CONFIRMED_FESTIVALS", raising=False)
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    fest.set_calendar(None)
    store = prefs_mod.InMemoryPreferencesStore()
    prefs_mod.set_store(store)
    yield store
    prefs_mod.set_store(None)
    fest.set_calendar(None)


def token_of(url: str) -> Any:
    """The claim behind a stop link, so a test can say whose mail it stops."""
    query = urlparse(url).query
    assert query.startswith("token=")
    from urllib.parse import unquote

    return parse_stop_token(unquote(query[len("token=") :]))


# 2026-09-06 is a Sunday. 18:30 in Kolkata is 13:00 UTC; 18:30 in London (BST) is 17:30 UTC.
KOLKATA_SUNDAY_EVENING = datetime(2026, 9, 6, 13, 0, tzinfo=UTC)
LONDON_SUNDAY_EVENING = datetime(2026, 9, 6, 17, 30, tzinfo=UTC)

KOLKATA = Family("L-learner", "Learner", "parent@example.test", timezone="Asia/Kolkata")
LONDON = Family("L-sam", "Sam", "sam-parent@example.test", timezone="Europe/London")


class FixedWeek:
    def __init__(self, facts: dict[str, Any]) -> None:
        self.facts = facts
        self.asked: list[tuple[str, str, str]] = []

    def week(self, learner_id: str, *, start: Any, end: Any) -> dict[str, Any]:
        self.asked.append((learner_id, start.isoformat(), end.isoformat()))
        return dict(self.facts)


FULL_WEEK = {
    "lessons": 3,
    "lessons_note": "Triangles, ch. 6",
    "problems": 14,
    "problems_note": "11 right, 2 close, 1 skipped",
    "days_active": 5,
    "days_note": "Ten minutes, most evenings",
}


def wobo_digest(name: str, facts: dict[str, Any]) -> dict[str, Any]:
    return {
        "headline": "Three lessons, and the right kind of stuck.",
        "note": f"{name} did three lessons and asked for help twice after a miss,",
        "note_accent": "which is exactly how learning looks.",
        "note_after": "Triangles: half done.",
        "worth_saying": (
            f"On Tuesday {name} got the hypotenuse wrong, asked why, and then got the next two "
            "alone. If you get a moment tonight, say you noticed."
        ),
    }


def sends() -> list[MailRecord]:
    return sorted(mail_log().records(), key=lambda r: r.sent_at)


# --- the Sunday note ---------------------------------------------------------------------------
def test_the_note_goes_out_at_six_pm_on_the_familys_own_clock() -> None:
    families = InMemoryFamilies([KOLKATA, LONDON])
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=families,
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert report["sent"] == 1 and report["due"] == 1
    assert report["skipped"] == {"not_due": 1}
    [record] = sends()
    assert (record.kind, record.learner_id, record.period) == (
        "sunday_note",
        "L-learner",
        "2026-W36",
    )

    # four and a half hours later it is London's evening; Kolkata's note is already in the log
    later = run_sunday(
        LONDON_SUNDAY_EVENING,
        families=families,
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert later["sent"] == 1 and later["skipped"] == {"not_due": 1}
    assert {r.learner_id for r in sends()} == {"L-learner", "L-sam"}


def test_a_second_run_in_the_same_evening_sends_nothing_twice() -> None:
    kwargs: dict[str, Any] = {
        "families": InMemoryFamilies([KOLKATA]),
        "week_source": FixedWeek(FULL_WEEK),
        "digest": wobo_digest,
    }
    assert run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)["sent"] == 1
    again = run_sunday(KOLKATA_SUNDAY_EVENING + timedelta(minutes=45), **kwargs)
    assert again["sent"] == 0 and again["duplicate"] == 1
    assert len(sends()) == 1
    # the next Sunday is a new period
    next_week = run_sunday(KOLKATA_SUNDAY_EVENING + timedelta(days=7), **kwargs)
    assert next_week["sent"] == 1
    assert [r.period for r in sends()] == ["2026-W36", "2026-W37"]


def test_the_week_asked_for_is_the_familys_last_seven_days() -> None:
    week = FixedWeek(FULL_WEEK)
    run_sunday(
        KOLKATA_SUNDAY_EVENING, families=InMemoryFamilies([KOLKATA]), week_source=week, digest=None
    )
    assert week.asked == [("L-learner", "2026-08-31", "2026-09-06")]


def test_unknown_locality_means_nothing_sends() -> None:
    """§14.1 rule 5: when the family's zone is unknown or nonsense, no hour is guessed."""
    families = InMemoryFamilies(
        [
            Family("L1", "A", "a@example.test", timezone=""),
            Family("L2", "B", "b@example.test", timezone="Mars/Olympus"),
        ]
    )
    for moment in (
        KOLKATA_SUNDAY_EVENING,
        LONDON_SUNDAY_EVENING,
        datetime(2026, 9, 6, 18, tzinfo=UTC),
    ):
        report = run_sunday(
            moment, families=families, week_source=FixedWeek(FULL_WEEK), digest=wobo_digest
        )
        assert report["sent"] == 0 and report["skipped"] == {"no_locality": 2}
    assert sends() == []


def test_the_switch_is_respected() -> None:
    off = Family("L1", "Learner", "parent@example.test", timezone="Asia/Kolkata", sunday_note=False)
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=InMemoryFamilies([off]),
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert report["skipped"] == {"opted_out": 1} and sends() == []


def test_an_empty_week_is_skipped_in_silence() -> None:
    """We do not report absence to a parent, and a zero is never dressed as an achievement."""
    for facts in (
        {},
        {"lessons": 0, "problems": 0, "days_active": 0},
        {"lessons_note": "words only"},
    ):
        report = run_sunday(
            KOLKATA_SUNDAY_EVENING,
            families=InMemoryFamilies([KOLKATA]),
            week_source=FixedWeek(facts),
            digest=wobo_digest,
        )
        assert report["sent"] == 0 and report["skipped"] == {"empty_week": 1}, facts
    assert sends() == []


def test_a_missing_number_is_a_tile_not_drawn_never_a_guess() -> None:
    data = compose_week(KOLKATA, {"days_active": 4}, None)
    assert data is not None
    assert data["days_active"] == 4 and "lessons" not in data and "problems" not in data
    html = render("sunday_note", data)["html"]
    assert ">Days<" in html and ">4 of 7<" in html
    assert ">Lessons<" not in html and ">Problems<" not in html
    assert 'width="100%" style="background:#FFE7E2' in html  # the one tile takes the row


def test_the_digest_may_add_words_never_numbers() -> None:
    def greedy(name: str, facts: dict[str, Any]) -> dict[str, Any]:
        return {
            "lessons": 99,
            "problems": "40",
            "note": "asked why twice after a miss.",
            "days_active": 7,
        }

    data = compose_week(KOLKATA, {"days_active": 2}, greedy)
    assert data is not None
    assert data["days_active"] == 2 and "lessons" not in data and "problems" not in data
    assert data["note"] == "asked why twice after a miss."


def test_an_unreadable_week_or_digest_never_breaks_the_pass() -> None:
    class Broken:
        def week(self, learner_id: str, *, start: Any, end: Any) -> dict[str, Any]:
            raise RuntimeError("store down")

    def broken_digest(name: str, facts: dict[str, Any]) -> dict[str, Any] | None:
        raise RuntimeError("model down")

    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=InMemoryFamilies([KOLKATA]),
        week_source=Broken(),
        digest=None,
    )
    assert report["skipped"] == {"empty_week": 1}
    # the digest is optional: the numbers still go out without it
    with pytest.raises(RuntimeError):
        compose_week(KOLKATA, FULL_WEEK, broken_digest)
    assert jobs.gateway_digest("Learner", {"days_active": 3}) == {"note": "mock digest summary"}


def test_dry_run_reports_without_sending() -> None:
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=InMemoryFamilies([KOLKATA]),
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
        dry_run=True,
    )
    assert report["would_send"] == 1 and report["sent"] == 0 and sends() == []


def test_the_note_reads_as_the_design_and_says_nothing_it_was_not_told() -> None:
    data = compose_week(KOLKATA, FULL_WEEK, wobo_digest)
    assert data is not None
    out = render("sunday_note", data)
    html, text = out["html"], out["text"]
    assert out["subject"] == "Learner's week"
    assert out["preheader"] == "Three lessons, and the right kind of stuck."
    # the design, verbatim where it is not a family's own words
    assert "Learner&#8217;s week" in html
    assert "font:600 27px/1.2 Caveat,'Comic Sans MS',cursive" in html  # Wobo's hand
    assert "background:#FFF1D6;border-radius:18px" in html  # the marigold card
    assert 'style="color:#FF6B57">which is exactly how learning looks.</span>' in html
    assert "Something worth saying" in html
    assert ">See the week<" in html and ">Reply to Wobo<" in html
    assert "linked you as a parent. It comes once a week, on Sunday." in html
    assert ">Stop the notes<" in html
    # the parent has no account to sign in to: "Change when it arrives" is drawn only when the
    # send path gave a page the parent can open, never as a link to a learner's sign-in
    assert ">Change when it arrives<" not in html and "Change when it arrives" not in text
    with_page = render("sunday_note", data | {"preferences_url": f"{APP_URL}/you?p=tok3n"})
    assert ">Change when it arrives<" in with_page["html"]
    assert ">Sunday, 6 pm<" in html  # the default stamp; the job stamps the real moment
    for tile in (">3<", ">14<", ">5 of 7<", "11 right, 2 close, 1 skipped"):
        assert tile in html
    # the text twin carries the same facts
    for line in (
        "Lessons: 3 (Triangles, ch. 6)",
        "Problems: 14",
        "Days: 5 of 7",
        "Something worth saying",
    ):
        assert line in text
    assert "https://api.heywobo.com/v1/mail/stop" in text  # the list-wide fallback: our route


def test_the_familys_dials_decide_and_the_stop_link_rides_along(_dials: Any) -> None:
    """The preferences row (hospitality/preferences.py) is the switch and the clock; the
    footer and the one-click header carry that learner's signed stop link."""
    # the dial off, in the store rather than on the link row
    _dials.put("L-learner", prefs_mod.MailPreferences(sunday_note=False, timezone="Asia/Kolkata"))
    kwargs: dict[str, Any] = {"week_source": FixedWeek(FULL_WEEK), "digest": wobo_digest}
    report = run_sunday(KOLKATA_SUNDAY_EVENING, families=InMemoryFamilies([KOLKATA]), **kwargs)
    assert report["skipped"] == {"opted_out": 1}
    # the one-click stop overrides every dial
    _dials.put("L-learner", prefs_mod.MailPreferences(unsubscribed_at=KOLKATA_SUNDAY_EVENING))
    report = run_sunday(KOLKATA_SUNDAY_EVENING, families=InMemoryFamilies([KOLKATA]), **kwargs)
    assert report["skipped"] == {"opted_out": 1}
    # the zone comes from the dials when the link row has none
    _dials.put("L-learner", prefs_mod.MailPreferences(timezone="Asia/Kolkata"))
    unzoned = Family("L-learner", "Learner", "parent@example.test")
    sent: list[tuple[str, dict[str, Any]]] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append((to, data))
        return {"ok": True}

    report = run_sunday(
        KOLKATA_SUNDAY_EVENING, families=InMemoryFamilies([unzoned]), send=capture, **kwargs
    )
    assert report["sent"] == 1
    [(to, data)] = sent
    assert to == "parent@example.test" and data["unsubscribe_url"].startswith(STOP)
    # the parent's link stops the parent's mail: the Sunday note, and only that
    assert token_of(data["unsubscribe_url"]).kinds == ("sunday_note",)
    assert data["stamp"] == "Sunday, 6:30 pm"  # the family's own clock, as the design writes it
    out = render("sunday_note", data)
    assert f'href="{data["unsubscribe_url"].replace("&", "&amp;")}"' in out["html"]
    assert out["headers"]["List-Unsubscribe"] == f"<{data['unsubscribe_url']}>"
    assert out["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert data["unsubscribe_url"] in out["text"]


def test_a_parent_of_two_learners_gets_two_notes(_dials: Any) -> None:
    """The idempotency key names the learner: one address linked to two children hears about
    both, every week, and neither note is ever mistaken for the other's duplicate."""
    learner = Family("L-learner", "Learner", "parent@example.test", timezone="Asia/Kolkata")
    other = Family("L-other", "Learner Two", "parent@example.test", timezone="Asia/Kolkata")
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=InMemoryFamilies([learner, other]),
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert report["sent"] == 2 and report["duplicate"] == 0
    assert sorted(r.learner_id for r in sends()) == ["L-learner", "L-other"]
    assert len({r.key for r in sends()}) == 2
    # a second run is a duplicate for both, and neither is sent again
    again = run_sunday(
        KOLKATA_SUNDAY_EVENING + timedelta(minutes=30),
        families=InMemoryFamilies([learner, other]),
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert again["duplicate"] == 2 and len(sends()) == 2


def test_the_note_holds_on_a_quiet_day_and_when_the_inbox_heard_from_wobo_today(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The calendar's quiet days (a day of mourning in the family's country) hold the note; so
    does the twenty-four-hour rule when anything at all went to that address today."""
    kwargs: dict[str, Any] = {
        "families": InMemoryFamilies([KOLKATA]),
        "week_source": FixedWeek(FULL_WEEK),
        "digest": wobo_digest,
    }
    real = fest.get_calendar()
    monkeypatch.setattr(real, "quiet_day_ids", lambda country, day: ["in-quiet"])
    report = run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)
    assert report["skipped"] == {"quiet_day": 1} and sends() == []
    monkeypatch.undo()
    # a wish went to the same address at 9 am; the inbox is not written to twice in a day
    mail_log().record(
        MailRecord(
            key="wish:x",
            learner_id="L-learner",
            kind="wish",
            to_hash=email_mod.to_hash("parent@example.test"),
            period="diwali:2026-09-06",
            sent_at=(KOLKATA_SUNDAY_EVENING - timedelta(hours=9, minutes=30)).isoformat(),
            provider_id="console",
        )
    )
    report = run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)
    assert report["skipped"] == {"gap": 1} and len(sends()) == 1
    # a different address is a different inbox
    other = Family("L-sam", "Sam", "sam-parent@example.test", timezone="Asia/Kolkata")
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING, **(kwargs | {"families": InMemoryFamilies([other])})
    )
    assert report["sent"] == 1


def test_a_digest_line_the_copy_law_forbids_is_dropped_not_sent() -> None:
    """The digest is a model's words in Wobo's hand: a kinship word, an exclamation mark, an
    emoji, or a pronoun for Wobo drops that line. The numbers still go."""

    def loud(name: str, facts: dict[str, Any]) -> dict[str, Any]:
        return {
            "headline": "Three lessons, and the right kind of stuck!",
            "note": f"{name} asked why twice after a miss.",
            "note_accent": "Tell Amma I said so.",
            "worth_saying": f"{APP_NAME} did what she does best and waited.",
            "days_note": "Ten minutes, most evenings \U0001f389",
        }

    data = compose_week(KOLKATA, {"days_active": 4}, loud)
    assert data is not None
    assert data["note"] == "Learner asked why twice after a miss."
    for key in ("headline", "note_accent", "worth_saying", "days_note"):
        assert key not in data, key
    assert render("sunday_note", data)["subject"] == "Learner's week"


def test_the_stamp_reads_like_the_design() -> None:
    assert stamp_for(datetime(2026, 9, 6, 18, 0, tzinfo=IST)) == "Sunday, 6 pm"
    assert stamp_for(datetime(2026, 9, 1, 21, 38, tzinfo=IST)) == "Tuesday, 9:38 pm"
    assert stamp_for(datetime(2026, 9, 4, 16, 10, tzinfo=IST)) == "Friday, 4:10 pm"
    assert stamp_for(datetime(2026, 9, 4, 0, 5, tzinfo=IST)) == "Friday, 12:05 am"


def test_an_unreachable_preferences_store_sends_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    class Down:
        def get(self, learner_id: str) -> Any:
            raise prefs_mod.StoreUnavailable("no store")

    prefs_mod.set_store(Down())
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=InMemoryFamilies([KOLKATA]),
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert report["skipped"] == {"prefs_unavailable": 1} and sends() == []
    assert send_win(learner_id="L1", to="kid@example.test", milestone="first_week", now=NOON) == {
        "ok": False,
        "error": "prefs_unavailable",
    }


# --- the cron door ------------------------------------------------------------------------------
@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_EMAIL_KEY", "test-internal-key")
    return TestClient(create_app())


def test_the_cron_door_fails_closed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.post("/v1/internal/mail/sunday").status_code == 403
    assert (
        client.post("/v1/internal/mail/sunday", headers={"X-Wobo-Internal": "wrong"}).status_code
        == 403
    )
    monkeypatch.delenv("INTERNAL_EMAIL_KEY", raising=False)
    assert client.post("/v1/internal/mail/sunday", headers=INTERNAL).status_code == 403


def test_the_cron_door_runs_the_pass(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jobs, "PostgrestFamilies", lambda: InMemoryFamilies([KOLKATA, LONDON]))
    monkeypatch.setattr(jobs, "PostgrestWeek", lambda: FixedWeek(FULL_WEEK))
    monkeypatch.setattr(jobs, "gateway_digest", wobo_digest)
    r = client.post(
        "/v1/internal/mail/sunday",
        json={"now": KOLKATA_SUNDAY_EVENING.isoformat()},
        headers=INTERNAL,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["sent"] == 1 and body["checked"] == 2
    assert "resend" not in r.text.lower()
    # an empty body means "now"; no families configured means nobody, not an error
    monkeypatch.setattr(jobs, "PostgrestFamilies", lambda: InMemoryFamilies([]))
    r = client.post("/v1/internal/mail/sunday", headers=INTERNAL)
    assert r.status_code == 200 and r.json()["checked"] == 0
    # a naive or unparsable clock is refused rather than guessed
    r = client.post(
        "/v1/internal/mail/sunday", json={"now": "2026-09-06T18:00:00"}, headers=INTERNAL
    )
    assert r.json() == {"ok": False, "error": "bad_now"}


def test_with_no_store_configured_the_pass_finds_nobody(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real sources, unconfigured: no network, no families, no error."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)

    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("unconfigured means no network")

    monkeypatch.setattr(jobs.urllib.request, "urlopen", _boom)
    report = run_sunday(KOLKATA_SUNDAY_EVENING)
    assert report["checked"] == 0 and report["sent"] == 0
    assert (
        jobs.PostgrestWeek().week(
            "L1", start=KOLKATA_SUNDAY_EVENING.date(), end=KOLKATA_SUNDAY_EVENING.date()
        )
        == {}
    )


# --- the welcome ---------------------------------------------------------------------------------
FIRST_TURN = {
    "first_meeting": True,
    "context": {
        "lifetime": {"learner": {"name": "Learner One", "grade": "Class 8", "board": "CBSE"}},
        "curriculum": {"nodeName": "Triangles", "subject": "Mathematics"},
        "turn": {"lastUserInput": "hi"},
    },
}


def test_welcome_data_reads_the_first_turn_packet() -> None:
    assert welcome_data(FIRST_TURN) == {
        "name": "Learner",
        "board_short": "CBSE",
        "class_name": "8",
        "subject": "mathematics",
        "chapter": "Triangles",
    }
    assert welcome_data({}) == {}
    assert welcome_data({"context": {"lifetime": {"learner": "not a dict"}}}) == {}


def test_the_first_meeting_sends_the_welcome_once(client: TestClient, auth: Any) -> None:
    """The sign-up completion signal is the first turn; the address is the token's, and a
    replayed first turn (a cleared browser) is a no-op."""
    headers = auth("sub-learner", email="learner@example.test")
    r = client.post("/v1/capability/wobo.turn", json={"payload": FIRST_TURN}, headers=headers)
    assert r.status_code == 200, r.text
    [record] = sends()
    assert (record.kind, record.learner_id, record.period) == ("welcome", "sub-learner", "once")
    assert record.key == idempotency_key(
        "welcome", "learner@example.test", "once", learner_id="sub-learner"
    )
    r = client.post("/v1/capability/wobo.turn", json={"payload": FIRST_TURN}, headers=headers)
    assert r.status_code == 200
    assert len(sends()) == 1
    # a returning learner's turn is not a sign-up
    returning = {**FIRST_TURN, "first_meeting": False}
    client.post(
        "/v1/capability/wobo.turn",
        json={"payload": returning},
        headers=auth("sub-else", email="e@example.test"),
    )
    assert len(sends()) == 1


def test_no_address_on_the_token_means_no_welcome(client: TestClient, auth: Any) -> None:
    r = client.post(
        "/v1/capability/wobo.turn", json={"payload": FIRST_TURN}, headers=auth("sub-quiet")
    )
    assert r.status_code == 200
    anon = auth("anon-1", anonymous=True, email="anon@example.test")
    r = client.post("/v1/capability/wobo.turn", json={"payload": FIRST_TURN}, headers=anon)
    assert r.status_code == 200
    assert sends() == []


def test_the_welcome_never_blocks_or_breaks_the_turn() -> None:
    class Principal:
        subject = "sub-1"
        anonymous = False
        claims = {"email": "kid@example.test"}

    scheduled: list[Any] = []
    jobs.set_runner(scheduled.append)  # a runner that only queues: the caller returns at once
    assert welcome_after_first_meeting(Principal(), FIRST_TURN) is True
    assert len(scheduled) == 1 and sends() == []
    scheduled[0]()
    assert [r.kind for r in sends()] == ["welcome"]

    def exploding(go: Any) -> None:
        raise RuntimeError("thread pool gone")

    jobs.set_runner(exploding)
    assert welcome_after_first_meeting(Principal(), FIRST_TURN) is False  # swallowed, never raised


def test_the_welcome_carries_the_learners_own_one_click_link_and_their_clock(
    _dials: Any,
) -> None:
    """Account mail has no off switch in its footer, but the List-Unsubscribe header must name
    a real one-click endpoint (RFC 8058): the learner's own signed link, which stops wins and
    wishes. The stamp is the learner's local moment when the dials know their zone."""
    _dials.put("sub-1", prefs_mod.MailPreferences(timezone="Asia/Kolkata"))
    sent: list[dict[str, Any]] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append(data)
        return {"ok": True}

    jobs.send_welcome(
        learner_id="sub-1",
        to="kid@example.test",
        data=welcome_data(FIRST_TURN),
        now=datetime(2026, 9, 1, 16, 8, tzinfo=UTC),
        send=capture,
    )
    [data] = sent
    assert data["unsubscribe_url"].startswith(STOP)
    assert token_of(data["unsubscribe_url"]).kinds == ("wins", "festivals")
    assert data["stamp"] == "Tuesday, 9:38 pm"
    out = render("welcome", data)
    assert out["headers"]["List-Unsubscribe"] == f"<{data['unsubscribe_url']}>"
    assert out["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert ">Tuesday, 9:38 pm<" in out["html"]
    # the footer still links the settings, as the design has it — no "stop" in account mail
    assert ">Email settings<" in out["html"] and "None at all" not in out["html"]


def test_the_welcome_reads_as_the_design() -> None:
    out = render("welcome", welcome_data(FIRST_TURN))
    assert out["subject"] == "Wobo is set up for CBSE class 8"
    html = out["html"]
    assert "Hi Learner. I’m Wobo." in html
    assert (
        "Class 8, CBSE, mathematics first. I’ve already found this week’s chapter: Triangles."
        in html
    )
    # NEVER A LATE HOUR (owner's standing law; ``hours.test.ts`` is the guard on the web side).
    # This line used to read "Three things to try tonight" and the shipped template was correctly
    # changed to "first" — leaving a test that demanded the banned word come back. A test is not
    # allowed to be the last place a broken law survives.
    assert "Three things to try first" in html
    assert "tonight" not in html.lower() and "tonight" not in out["text"].lower()
    for line in ("Ask the basic thing.", "Hold space and just talk.", "Try one."):
        assert line in html and line in out["text"]
    assert ">Ask your first question<" in html
    # the copy law forbids a count of questions a day, in digits or in words: the free line says
    # what the allowance feels like, and says the same thing whatever the account's allowance is
    assert "Free every day, a fresh allowance each morning, no card and no trial that ends." in html
    assert "questions a day" not in html and "questions a day" not in out["text"]
    assert 'href="https://heywobo.com/"' in html  # the button lands on home, a route that exists
    assert "background:#14142B;border-radius:22px" in html  # the navy hero card
    assert "color:#FFB629" in html  # marigold greeting
    # no board, no class: the honest fallback, and no chapter is claimed
    bare = render("welcome", {"name": "Sam"})
    assert bare["subject"] == "You are in, Sam"
    assert "Tell me what you are studying and I will load your syllabus." in bare["html"]
    assert "already found" not in bare["html"]
    free_line = "Free every day, a fresh allowance each morning, no card and no trial that ends."
    assert free_line in bare["html"]


# --- the win -------------------------------------------------------------------------------------
NOON = datetime(2026, 9, 3, 6, 30, tzinfo=UTC)  # noon in Kolkata


def test_only_real_milestones_earn_a_win() -> None:
    for milestone, data in (("streak", {"days": 13}), ("streak", {}), ("logged_in", {}), ("", {})):
        result = send_win(
            learner_id="L1", to="kid@example.test", milestone=milestone, data=data, now=NOON
        )
        assert result == {"ok": False, "error": "not_a_milestone", "milestone": milestone}
    assert sends() == []
    ok = send_win(
        learner_id="L1", to="kid@example.test", milestone="streak", data={"days": 14}, now=NOON
    )
    assert ok["ok"] is True
    [record] = sends()
    assert record.kind == "win" and record.period.startswith("streak_14:")


def test_at_most_one_win_per_learner_per_seven_days() -> None:
    first = send_win(
        learner_id="L1",
        to="kid@example.test",
        milestone="chapter_mastered",
        data={"chapter": "Triangles"},
        now=NOON,
    )
    assert first["ok"] is True
    second = send_win(
        learner_id="L1", to="kid@example.test", milestone="first_week", now=NOON + timedelta(days=6)
    )
    assert second["ok"] is False and second["error"] == "too_soon" and "next_at" in second
    # another learner is another dial
    assert (
        send_win(learner_id="L2", to="other@example.test", milestone="first_week", now=NOON)["ok"]
        is True
    )
    assert len(sends()) == 2
    # eight days on, the first learner may hear from Wobo again
    email_mod.set_mail_log(email_mod.MailLog())
    mail_log().record(
        MailRecord(
            key="win:old:x",
            learner_id="L1",
            kind="win",
            to_hash="x",
            period="x",
            sent_at=(datetime.now(UTC) - timedelta(days=8)).isoformat(),
            provider_id="console",
        )
    )
    assert send_win(learner_id="L1", to="kid@example.test", milestone="first_week")["ok"] is True


def test_the_same_chapter_is_never_celebrated_twice() -> None:
    kwargs: dict[str, Any] = {
        "learner_id": "L1",
        "to": "kid@example.test",
        "milestone": "chapter_mastered",
    }
    assert send_win(**kwargs, data={"chapter": "Triangles"}, now=NOON)["ok"] is True
    email_mod.set_mail_log(
        email_mod.MailLog()
    )  # forget the frequency, keep the question of "again"
    mail_log().record(
        MailRecord(
            key=idempotency_key(
                "win", "kid@example.test", "chapter_mastered:triangles", learner_id="L1"
            ),
            learner_id="L1",
            kind="win",
            to_hash="x",
            period="chapter_mastered:triangles",
            sent_at=(NOON - timedelta(days=30)).isoformat(),
            provider_id="em_old",
        )
    )
    again = send_win(**kwargs, data={"chapter": "Triangles"}, now=NOON)
    assert again["duplicate"] is True
    assert send_win(**kwargs, data={"chapter": "Data handling"}, now=NOON)["ok"] is True


def test_the_wins_dial_is_respected(_dials: Any) -> None:
    _dials.put("L1", prefs_mod.MailPreferences(wins=False))
    result = send_win(learner_id="L1", to="kid@example.test", milestone="first_week", now=NOON)
    assert result == {"ok": False, "error": "opted_out"}
    _dials.put("L1", prefs_mod.MailPreferences(wins=True, timezone="Asia/Kolkata"))
    late = datetime(2026, 9, 3, 18, 0, tzinfo=UTC)  # 23:30 in Kolkata, from the dials' zone
    assert (
        send_win(learner_id="L1", to="kid@example.test", milestone="first_week", now=late)["error"]
        == "quiet_hours"
    )
    ok = send_win(learner_id="L1", to="kid@example.test", milestone="first_week", now=NOON)
    assert ok["ok"] is True
    assert sends()[0].kind == "win"


def test_a_win_waits_out_the_quiet_hours_when_the_zone_is_known() -> None:
    late = datetime(2026, 9, 3, 18, 0, tzinfo=UTC)  # 23:30 in Kolkata
    result = send_win(
        learner_id="L1",
        to="kid@example.test",
        milestone="first_week",
        timezone="Asia/Kolkata",
        now=late,
    )
    assert result == {"ok": False, "error": "quiet_hours"}
    early = datetime(2026, 9, 3, 0, 30, tzinfo=UTC)  # 06:00 in Kolkata
    assert (
        send_win(
            learner_id="L1",
            to="kid@example.test",
            milestone="first_week",
            timezone="Asia/Kolkata",
            now=early,
        )["error"]
        == "quiet_hours"
    )
    # an unknown zone does not block a win the learner just earned
    assert (
        send_win(learner_id="L1", to="kid@example.test", milestone="first_week", now=late)["ok"]
        is True
    )


def test_the_win_reads_the_calendars_quiet_hours_not_its_own(_dials: Any) -> None:
    """One definition of night: the calendar's 21:00–08:00 (MAIL_QUIET_HOURS overrides it), so a
    win at half past nine is held exactly as a wish would be."""
    half_past_nine = datetime(2026, 9, 3, 16, 0, tzinfo=UTC)  # 21:30 in Kolkata
    result = send_win(
        learner_id="L1",
        to="kid@example.test",
        milestone="first_week",
        timezone="Asia/Kolkata",
        now=half_past_nine,
    )
    assert result == {"ok": False, "error": "quiet_hours"}


def test_the_win_holds_on_a_quiet_day_and_carries_the_learners_link_and_clock(
    _dials: Any,
) -> None:
    """30 January is Martyrs' Day in India: the calendar says celebration mail holds. The
    country comes from the dials; India's one zone times it."""
    _dials.put("L1", prefs_mod.MailPreferences(country="IN"))
    martyrs_noon = datetime(2026, 1, 30, 6, 30, tzinfo=UTC)
    result = send_win(
        learner_id="L1", to="kid@example.test", milestone="first_week", now=martyrs_noon
    )
    assert result == {"ok": False, "error": "quiet_day"}
    sent: list[dict[str, Any]] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append(data)
        return {"ok": True}

    ok = send_win(
        learner_id="L1",
        to="kid@example.test",
        milestone="chapter_mastered",
        data={"chapter": "Triangles", "next_label": "Start data handling"},
        now=NOON,
        send=capture,
    )
    assert ok["ok"] is True
    [data] = sent
    assert data["stamp"] == "Thursday, 12 pm"
    assert token_of(data["unsubscribe_url"]).kinds == ("wins", "festivals")
    out = render("win", data)
    assert out["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_the_win_waits_out_the_inbox_gap() -> None:
    """Anything sent to that address in the last day — a wish this morning — holds the win."""
    mail_log().record(
        MailRecord(
            key="wish:x",
            learner_id="L1",
            kind="wish",
            to_hash=email_mod.to_hash("kid@example.test"),
            period="diwali:2026-09-03",
            sent_at=(NOON - timedelta(hours=3)).isoformat(),
            provider_id="console",
        )
    )
    result = send_win(learner_id="L1", to="kid@example.test", milestone="first_week", now=NOON)
    assert result["ok"] is False and result["error"] == "gap"
    assert result["next_at"] == (NOON + timedelta(hours=21)).isoformat()


def test_the_win_reads_as_the_design() -> None:
    out = render(
        "win",
        {
            "milestone": "chapter_mastered",
            "chapter": "Triangles",
            "lessons": 5,
            "then_line": "Ten days ago you asked what a hypotenuse was.",
            "note": (
                "You finished the practice set at 9 of 10, and the one you missed you came "
                "back for the next day."
            ),
            "next_label": "Start data handling",
            "next_url": "https://heywobo.com/learn/data-handling",
        },
    )
    assert out["subject"] == "Triangles is finished"
    html = out["html"]
    assert ">chapter done<" in html and "transform:rotate(-4deg)" in html  # the marigold tag
    assert "Triangles. All five lessons. Done." in html
    assert 'color:#2B45FF;margin-top:10px">Ten days ago you asked what a hypotenuse was.' in html
    assert ">Start data handling<" in html and ">Take the weekend<" in html
    assert "never more than once a week" in html
    assert ">Fewer emails<" in html and ">None at all<" in html
    assert "Start data handling: https://heywobo.com/learn/data-handling" in out["text"]
    # without words from the caller, nothing is invented: no then-line, no note card
    bare = render("win", {"milestone": "first_week"})
    assert bare["subject"] == "Your first week with me"
    assert "One week with Wobo. Done." in bare["html"]
    assert 'margin-top:10px">' not in bare["html"].split("Done.")[1][:200]
    assert "background:#F1EDE3;border-radius:18px" not in bare["html"]


# --- the laws every hand-drawn email keeps --------------------------------------------------------
KINSHIP = re.compile(
    r"\b(amma|ammi|mummy|mum|mom|papa|appa|abbu|dada|dadi|nana|nani)\b", re.IGNORECASE
)
# §19: the wobot has no gender. No hand-drawn mail uses any of these at all.
GENDERED_WORDS = re.compile(r"\b(she|he|her|him|his|hers)\b", re.IGNORECASE)


@pytest.mark.parametrize("kind", sorted(HAND_KINDS))
def test_plain_english_no_kinship_words_no_gendered_wobo_no_shouting(kind: str) -> None:
    samples = [render(kind), render(kind, compose_week(KOLKATA, FULL_WEEK, wobo_digest) or {})]
    samples.append(render(kind, welcome_data(FIRST_TURN) | {"chapter": "Triangles", "lessons": 5}))
    for out in samples:
        blob = " ".join([out["subject"], out["preheader"], out["text"]])
        assert not KINSHIP.search(blob), (kind, KINSHIP.search(blob))
        assert not GENDERED_WORDS.search(blob), (kind, GENDERED_WORDS.search(blob))
        assert "!" not in blob
        assert "✅" not in blob and "\U0001f389" not in blob


@pytest.mark.parametrize("kind", sorted(HAND_KINDS))
def test_the_one_click_promise_is_made_only_for_a_signed_stop_link(kind: str) -> None:
    """RFC 8058: ``List-Unsubscribe-Post`` says a bare POST to the target unsubscribes. Only a
    tokened link on the stop route can keep that promise; a sign-in page cannot, and the bulk
    sender checks at the big mailbox providers POST to whatever we name."""
    default = render(kind)["headers"]
    assert default == {"List-Unsubscribe": "<https://api.heywobo.com/v1/mail/stop>"}
    link = jobs.stop_link("L1", "learner")
    assert link
    signed = render(kind, {"unsubscribe_url": link})["headers"]
    assert signed == {
        "List-Unsubscribe": f"<{link}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    page = render(kind, {"unsubscribe_url": "https://heywobo.com/you"})["headers"]
    assert "List-Unsubscribe-Post" not in page
    hostile = render(kind, {"unsubscribe_url": "https://evil.example/u"})["headers"]
    assert "evil.example" not in hostile["List-Unsubscribe"]


def _router_heads() -> set[str]:
    """The path segments the web app's router serves (PLAIN_ROUTES plus the parameterised
    heads), read from the router itself so this test cannot drift from it."""
    source = (REPO / "apps/web-pwa/src/shell/router.tsx").read_text(encoding="utf-8")
    plain = re.search(r"const PLAIN_ROUTES = new Set\(\[(.*?)\]\)", source, re.S)
    assert plain, "PLAIN_ROUTES not found in the router"
    heads = set(re.findall(r"'([a-z-]+)'", plain.group(1)))
    heads |= set(re.findall(r"if \(head === '([a-z-]+)'\)", source))
    return heads


@pytest.mark.parametrize("kind", sorted(HAND_KINDS))
def test_every_default_link_lands_on_a_page_the_router_serves(kind: str) -> None:
    """A button that lands on the not-found screen is worse than no button. Every APP_URL link
    a hand-drawn mail draws by default is a route the web app's router actually has."""
    heads = _router_heads()
    out = render(kind)
    links = set(re.findall(re.escape(APP_URL) + r"(/[^\s\"'<>]*)?", out["html"] + out["text"]))
    assert links
    for path in links:
        head = (path or "/").split("?")[0].strip("/").split("/")[0]
        assert head == "" or head in heads, (kind, path)


# --- the wish ------------------------------------------------------------------------------------
REPUBLIC_MORNING = datetime(2026, 1, 26, 3, 30, tzinfo=UTC)  # 09:00 in Kolkata
TELANGANA = Family("L-learner", "Learner", "parent@example.test", timezone="Asia/Kolkata")


def test_a_wish_goes_in_the_morning_of_the_familys_own_day(_dials: Any) -> None:
    """Republic Day, a civic day: follows the country the family told us, needs no choice, goes
    once, in Wobo's hand, with the learner's own off switch."""
    _dials.put("L-learner", prefs_mod.MailPreferences(country="IN", region="IN-TG"))
    sent: list[tuple[str, dict[str, Any]]] = []

    def capture(kind: str, to: str, data: dict[str, Any], **kw: Any) -> dict[str, Any]:
        sent.append((to, data))
        return email_mod.send_email(kind, to, data, **kw)

    report = run_wishes(REPUBLIC_MORNING, families=InMemoryFamilies([TELANGANA]), send=capture)
    assert report["sent"] == 1 and report["due"] == 1, report
    [(to, data)] = sent
    assert to == "parent@example.test"
    assert data["line"] == (
        "Happy Republic Day, Learner. I hope the morning is bright and the day is an easy one."
    )
    assert data["subject"] == "Happy Republic Day" and data["stamp"] == "Monday, 9 am"
    assert data["chosen_calendar"] == "" and data["festival_name"] == "Republic Day"
    assert token_of(data["unsubscribe_url"]).kinds == ("wins", "festivals")
    [record] = sends()
    assert (record.kind, record.learner_id, record.period) == (
        "wish",
        "L-learner",
        "republic-day-india:2026-01-26",
    )
    # the same morning again is a duplicate; the next day there is nothing to wish
    again = run_wishes(
        REPUBLIC_MORNING + timedelta(hours=1), families=InMemoryFamilies([TELANGANA])
    )
    assert again["duplicate"] == 1 and len(sends()) == 1
    tomorrow = run_wishes(
        REPUBLIC_MORNING + timedelta(days=1), families=InMemoryFamilies([TELANGANA])
    )
    assert tomorrow["skipped"] == {"nothing_today": 1}


def test_the_wish_reads_as_wobos_hand() -> None:
    out = render(
        "wish",
        {
            "line": "Happy Diwali, Learner. I hope the house is full of light tonight.",
            "subject": "Happy Diwali",
            "festival_name": "Diwali",
            "chosen_calendar": "hindu",
            "stamp": "Sunday, 9 am",
        },
    )
    assert out["subject"] == "Happy Diwali"
    assert out["preheader"] == "Happy Diwali, Learner. I hope the house is full of light tonight."
    html = out["html"]
    assert "background:#FFF1D6;border-radius:18px" in html  # the marigold card
    assert "font:600 30px/1.2 Caveat,'Comic Sans MS',cursive" in html  # Wobo's hand
    assert "Happy Diwali, Learner. I hope the house is full of light tonight." in html
    assert "&mdash; Wobo" in html and ">Sunday, 9 am<" in html
    assert "Nothing to do today. Come back when you come back." in html
    assert "your family chose to be wished on these days" in html
    assert ">Fewer emails<" in html and ">None at all<" in html
    # a greeting is a greeting: no lesson, no streak, no plan, no button to anything
    for word in ("lesson", "streak", "plan", "Plus", "Pro", "offer"):
        assert word not in html.split("</table></td></tr></table></td></tr>")[0], word
    assert "!" not in out["text"] and "— Wobo" in out["text"]
    local = render("wish", {"line": "Happy Republic Day. I hope the day is an easy one."})
    assert "today is a holiday where your family told me you are" in local["html"]
    assert local["subject"] == "A small wish from me"


def test_a_religious_day_needs_the_familys_own_choice_and_the_moon_needs_a_person(
    _dials: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    diwali_morning = datetime(2026, 11, 8, 3, 30, tzinfo=UTC)
    _dials.put("L-learner", prefs_mod.MailPreferences(country="IN", region="IN-TG"))
    assert run_wishes(diwali_morning, families=InMemoryFamilies([TELANGANA]))["sent"] == 0
    _dials.put(
        "L-learner",
        prefs_mod.MailPreferences(country="IN", region="IN-TG", festival_calendar=("hindu",)),
    )
    report = run_wishes(diwali_morning, families=InMemoryFamilies([TELANGANA]))
    assert report["sent"] == 1 and sends()[0].period == "diwali:2026-11-08"
    # Eid moves with the moon: the stored date alone never sends; a person confirms the day
    email_mod.reset_mail_log()
    eid_morning = datetime(2026, 3, 21, 3, 30, tzinfo=UTC)
    _dials.put(
        "L-learner",
        prefs_mod.MailPreferences(country="IN", festival_calendar=("muslim",)),
    )
    learner = Family("L-learner", "Learner", "learner-parent@example.test")
    assert run_wishes(eid_morning, families=InMemoryFamilies([learner]))["sent"] == 0
    monkeypatch.setenv("MAIL_CONFIRMED_FESTIVALS", "eid-al-adha=2026-05-27, eid-al-fitr=2026-03-22")
    assert run_wishes(eid_morning, families=InMemoryFamilies([learner]))["sent"] == 0  # wrong day
    monkeypatch.setenv("MAIL_CONFIRMED_FESTIVALS", "eid-al-adha=2026-05-27,eid-al-fitr=2026-03-21")
    report = run_wishes(eid_morning, families=InMemoryFamilies([learner]))
    assert report["sent"] == 1 and sends()[0].period == "eid-al-fitr:2026-03-21"


def test_the_wish_keeps_the_familys_clock_and_the_inbox_gap(_dials: Any) -> None:
    _dials.put("L-learner", prefs_mod.MailPreferences(country="IN", region="IN-TG"))
    families = InMemoryFamilies([TELANGANA])
    small_hours = datetime(2026, 1, 25, 20, 0, tzinfo=UTC)  # 01:30 in Kolkata
    assert run_wishes(small_hours, families=families)["skipped"] == {"quiet_hours": 1}
    late = datetime(2026, 1, 26, 16, 30, tzinfo=UTC)  # 22:00 in Kolkata: the day is over
    assert run_wishes(late, families=families)["skipped"] == {"quiet_hours": 1}
    # a mail to the address an hour ago holds the wish; nothing sends, nothing is recorded
    mail_log().record(
        MailRecord(
            key="welcome:x",
            learner_id="L-learner",
            kind="welcome",
            to_hash=email_mod.to_hash("parent@example.test"),
            period="once",
            sent_at=(REPUBLIC_MORNING - timedelta(hours=1)).isoformat(),
            provider_id="console",
        )
    )
    assert run_wishes(REPUBLIC_MORNING, families=families)["skipped"] == {"gap": 1}
    # the dials decide: the festivals switch, the learner's one-click stop
    _dials.put("L-learner", prefs_mod.MailPreferences(country="IN", festivals=False))
    assert run_wishes(REPUBLIC_MORNING, families=families)["skipped"] == {"opted_out": 1}
    _dials.put("L-learner", prefs_mod.MailPreferences(country="IN"))
    _dials.stop("L-learner", ("wins", "festivals"))
    assert run_wishes(REPUBLIC_MORNING, families=families)["skipped"] == {"opted_out": 1}
    assert [r.kind for r in sends()] == ["welcome"]


def test_unknown_or_foreign_locality_gets_no_wish(_dials: Any) -> None:
    """§14.1 rule 5 and the hyperlocal law: no country, nothing; Nairobi, nothing Indian; a
    zone that disagrees with the country, nothing."""
    nobody = Family("L-x", "X", "x@example.test")
    assert run_wishes(REPUBLIC_MORNING, families=InMemoryFamilies([nobody]))["skipped"] == {
        "no_locality": 1
    }
    _dials.put("L-x", prefs_mod.MailPreferences(country="KE", festival_calendar=("hindu",)))
    assert run_wishes(REPUBLIC_MORNING, families=InMemoryFamilies([nobody]))["skipped"] == {
        "nothing_today": 1
    }
    _dials.put("L-x", prefs_mod.MailPreferences(country="IN", timezone="America/New_York"))
    assert run_wishes(REPUBLIC_MORNING, families=InMemoryFamilies([nobody]))["skipped"] == {
        "no_locality": 1
    }
    assert sends() == []


def test_the_wishes_door_runs_the_pass(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, _dials: Any
) -> None:
    assert client.post("/v1/internal/mail/wishes").status_code == 403
    _dials.put("L-learner", prefs_mod.MailPreferences(country="IN", region="IN-TG"))
    monkeypatch.setattr(jobs, "PostgrestFamilies", lambda: InMemoryFamilies([TELANGANA]))
    r = client.post(
        "/v1/internal/mail/wishes",
        json={"now": REPUBLIC_MORNING.isoformat(), "dry_run": True},
        headers=INTERNAL,
    )
    assert r.status_code == 200, r.text
    assert r.json()["would_send"] == 1 and r.json()["sent"] == 0 and sends() == []
    r = client.post(
        "/v1/internal/mail/wishes", json={"now": REPUBLIC_MORNING.isoformat()}, headers=INTERNAL
    )
    assert r.json()["ok"] is True and r.json()["sent"] == 1
    assert "resend" not in r.text.lower()
    r = client.post(
        "/v1/internal/mail/wishes", json={"now": "2026-01-26T09:00:00"}, headers=INTERNAL
    )
    assert r.json() == {"ok": False, "error": "bad_now"}


def test_the_log_is_stamped_with_the_jobs_own_clock_not_the_wall_clock(_dials: Any) -> None:
    """The mail log and the inbox gap must read the same clock. On 2026-09-05 the two-learner
    test passed only because the wall clock happened to sit more than a day before the fixed
    Sunday moment; two days later it sat after it and the second child's note was skipped as a
    gap. The record is stamped with the moment the pass ran on, whatever the wall says."""
    report = run_sunday(
        KOLKATA_SUNDAY_EVENING,
        families=InMemoryFamilies([KOLKATA]),
        week_source=FixedWeek(FULL_WEEK),
        digest=wobo_digest,
    )
    assert report["sent"] == 1
    (record,) = sends()
    assert record.sent_at == KOLKATA_SUNDAY_EVENING.isoformat()


def test_two_children_one_address_both_notes_go_whatever_the_wall_clock_says(_dials: Any) -> None:
    """The gap is read once per address before the pass sends: the first child's note never
    blocks the second's, and mail sent BEFORE the pass still holds both."""
    learner = Family("L-learner", "Learner", "parent@example.test", timezone="Asia/Kolkata")
    other = Family("L-other", "Learner Two", "parent@example.test", timezone="Asia/Kolkata")
    kwargs: dict[str, Any] = {
        "families": InMemoryFamilies([learner, other]),
        "week_source": FixedWeek(FULL_WEEK),
        "digest": wobo_digest,
    }
    assert run_sunday(KOLKATA_SUNDAY_EVENING, **kwargs)["sent"] == 2
    # a wish that went to the same address two hours before the pass holds both notes next week
    mail_log().record(
        MailRecord(
            key="wish:y",
            learner_id="L-learner",
            kind="wish",
            to_hash=email_mod.to_hash("parent@example.test"),
            period="x:2026-09-13",
            sent_at=(KOLKATA_SUNDAY_EVENING + timedelta(days=7, hours=-2)).isoformat(),
            provider_id="console",
        )
    )
    held = run_sunday(KOLKATA_SUNDAY_EVENING + timedelta(days=7), **kwargs)
    assert held["skipped"] == {"gap": 2} and held["sent"] == 0
