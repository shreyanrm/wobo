"""The activity record is dated on the family's calendar, not on UTC's (2026-09-16).

No client sent ``x-wobo-timezone`` and no family has a mail-preferences row, so every learner's
days, "last came", usual hour and summary zone were kept in UTC while the cadence worked out
"today" in Kolkata. A child who studies at 00:40 was recorded as having come the day before, and
a parent was mailed a streak note on a day the child had already learned.

Now the zone a family gave us on the parent link is the zone the record is kept in when the
family set none in its mail settings, and the cadence reads "last came" on the family's own
clock whatever zone an older record was kept in.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from wobo_gateway import activity, allowance, parents
from wobo_gateway.hospitality import cadence, jobs
from wobo_gateway.hospitality import preferences as prefs_mod

IST = ZoneInfo("Asia/Kolkata")
SUBJECT = "learner-under-test"
DAY = date(2026, 10, 18)


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("PARENT_LINKS_STORE", "memory")
    monkeypatch.setenv("MAIL_PREFERENCES_STORE", "memory")
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    links = parents.InMemoryParentLinkStore()
    parents.set_store(links)
    prefs_mod.set_store(prefs_mod.InMemoryPreferencesStore())
    record = activity.InMemoryActivityStore()
    activity.set_store(record)
    allowance.reset()
    yield links, record
    parents.set_store(None)
    prefs_mod.set_store(None)
    activity.set_store(None)
    activity.set_clock(None)
    allowance.reset()


def linked(links: parents.InMemoryParentLinkStore, learner_id: str = SUBJECT) -> None:
    links.insert(
        parents.ParentLink(
            id=str(uuid.uuid4()),
            learner_id=learner_id,
            parent_email_hash="a" * 64,
            parent_email="parent@example.test",
            learner_name="Learner",
            timezone="Asia/Kolkata",
            status="linked",
            invited_at=datetime(2026, 10, 1, tzinfo=UTC),
            linked_at=datetime(2026, 10, 1, tzinfo=UTC),
        )
    )


def at(day: date, hour: int, minute: int) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=IST)


def test_a_linked_familys_zone_dates_the_record_with_no_header_and_no_settings_row(
    world: Any, auth: Any
) -> None:
    from wobo_gateway.app import create_app

    links, record = world
    linked(links)
    client = TestClient(create_app())
    activity.set_clock(lambda: at(DAY, 0, 40).astimezone(UTC))
    res = client.post(
        "/v1/me/activity",
        json={"kind": "session_start", "session": str(uuid.uuid4())},
        headers=auth(SUBJECT),
    )
    assert res.status_code == 204, res.text
    held = record.get(SUBJECT)
    assert held is not None
    assert held.timezone == "Asia/Kolkata"
    assert held.last_came_on == DAY
    assert [d.day for d in record.days(SUBJECT, since=DAY - timedelta(days=2))] == [DAY]


def test_the_hour_they_usually_start_is_their_own(world: Any, auth: Any) -> None:
    from wobo_gateway.app import create_app

    links, record = world
    linked(links)
    client = TestClient(create_app())
    for back in range(3):
        activity.set_clock(lambda b=back: at(DAY - timedelta(days=b), 17, 45).astimezone(UTC))
        client.post(
            "/v1/me/activity",
            json={"kind": "session_start", "session": str(uuid.uuid4())},
            headers=auth(SUBJECT),
        )
    held = record.get(SUBJECT)
    assert held is not None and held.usual_hour() == 17


def test_the_family_zone_is_read_from_the_link_when_the_settings_hold_none(world: Any) -> None:
    links, _ = world
    linked(links)
    assert allowance.zone_name(f"sub:{SUBJECT}") == "Asia/Kolkata"
    assert allowance.zone_name("sub:nobody-linked") == "UTC"


def test_the_cadence_reads_last_came_on_the_familys_clock_whatever_the_record_was_kept_in(
    world: Any,
) -> None:
    """An older record kept in UTC: the learner came at 00:40 in Kolkata, which is the previous
    day in UTC. That evening they have come today, so no streak or come-back note is planned."""
    _, record = world
    learner = str(uuid.uuid4())
    for back in (3, 2, 1, 0):
        moment = at(DAY - timedelta(days=back), 0, 40)
        record.note(
            learner, activity.Event("session_start", moment, "UTC", session=str(uuid.uuid4()))
        )
        record.note(learner, activity.Event("turn", moment + timedelta(minutes=1), "UTC"))
    summary = record.get(learner)
    assert summary is not None and summary.last_came_on == DAY - timedelta(days=1)
    family = jobs.Family(
        learner_id=learner,
        learner_name="Learner",
        parent_email="p@example.test",
        timezone="Asia/Kolkata",
        under_13=True,
    )
    evening = at(DAY, 19, 30).astimezone(UTC)
    plan = cadence.plan(
        family, summary, record.days(learner, since=DAY - timedelta(days=28)), at=evening
    )
    assert all(n.learner.days_away == 0 for n in plan), plan
    assert [n.kind for n in plan if n.kind in {"streak", "quick_one", "mid_chapter"}] == []
