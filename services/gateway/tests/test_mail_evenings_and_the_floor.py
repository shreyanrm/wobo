"""The cadence against the hours law, the floor and the ladder, where the adversaries broke it.

docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence": at least three a week to every reachable
address, never twice in twenty-four hours, never after 8 pm, and a "come back" mail never on a
day the learner came. What was found (2026-09-16):

1. A learner who comes after six in the evening got "come back" and "keep it going" mails in the
   minutes before they arrived, nearly every day, instead of good news.
2. A Saturday-evening note pushed the Sunday note to half past eight, and a festival wish could
   go at half past eight because the calendar's quiet hours began at nine.
3. A cron a few seconds late, or a quiet day on the calendar, left a week with two mails.
4. A family away past three months went thirty days with nothing when the note's day was a
   quiet day.

Every run drives the wired passes hourly with the clock handed in (``mail_world``).
"""

from __future__ import annotations

from datetime import date, time, timedelta
from typing import Any

import pytest
from mail_world import (
    Plan,
    come_back_on_a_day_they_came,
    drive,
    falling_jitter,
    floor_breaks,
    inbox_law_breaks,
    install,
    local,
    seeded_jitter,
)
from wobo_gateway import activity
from wobo_gateway.email_templates import render
from wobo_gateway.hospitality import cadence, festivals, jobs, nudges

MONDAY = date(2026, 9, 21)
FULL = activity.STEPS[0]

FAMILIES = {
    "A": lambda d: True,
    "B": lambda d: (MONDAY + timedelta(days=d)).weekday() in (0, 2, 4),
    "C": lambda d: d in {0, 1, 3, 5, 8, 11, 15, 22},
    "E": lambda d: d != 9,
}
AGES = [pytest.param(True, id="under-13"), pytest.param(False, id="aged-15")]


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    prefs = install(monkeypatch)
    yield prefs, monkeypatch
    festivals.set_calendar(None)


def run(world: Any, **plan: Any) -> Any:
    prefs, monkeypatch = world
    return drive(Plan(**plan), prefs, monkeypatch)


# === 1. the evening learner =======================================================================
@pytest.mark.parametrize("under_13", AGES)
@pytest.mark.parametrize("visit", [time(18, 45), time(19, 45), time(20, 15)], ids=str)
@pytest.mark.parametrize("name", sorted(FAMILIES))
def test_an_evening_learner_never_gets_a_come_back_mail_on_a_day_they_come(
    world: Any, name: str, visit: time, under_13: bool
) -> None:
    got = run(world, start=MONDAY, days=28, came=FAMILIES[name], visit=visit, under_13=under_13)
    assert come_back_on_a_day_they_came(got) == []
    assert inbox_law_breaks(got) == []


@pytest.mark.parametrize("under_13", AGES)
@pytest.mark.parametrize("visit", [time(19, 45), time(20, 15)], ids=str)
def test_a_learner_who_never_misses_a_day_hears_good_news_not_a_daily_streak_push(
    world: Any, visit: time, under_13: bool
) -> None:
    got = run(world, start=MONDAY, days=28, came=FAMILIES["A"], visit=visit, under_13=under_13)
    box = got.reachable
    kinds = box.kinds()
    streaks = [s for s in box.sends if s.kind == "streak"]
    # The streak mails a learner who never lapses may get are the milestones, the morning after.
    assert all(s.asks_to_return is False for s in streaks), streaks
    assert len(streaks) <= len(cadence.STREAK_MILESTONES), streaks
    good = [k for k in kinds if k in {"learning_note", "sunday_note"}]
    assert len(good) * 2 > len(kinds), kinds


def test_the_come_back_hour_is_after_the_latest_they_start_or_there_is_none() -> None:
    """Two hours past the hour they start, inside the hours law. A learner who starts too late
    for that has no safe hour, and one whose hour is not known yet has none either: an hour
    guessed at is a mail that lands fifteen minutes before they do."""
    assert cadence.comeback_hour(9) == cadence.COMEBACK_FROM
    assert cadence.comeback_hour(16) == 16 + cadence.GRACE_HOURS == cadence.COMEBACK_FROM
    assert cadence.comeback_hour(17) == nudges.LAST_HOUR - 1
    assert cadence.comeback_hour(18) is None
    assert cadence.comeback_hour(19) is None
    assert cadence.comeback_hour(None) is None


def test_the_hour_that_counts_is_the_latest_they_have_started() -> None:
    summary = activity.Summary(
        subject="s",
        first_came_on=MONDAY,
        last_came_at=local(MONDAY, 17),
        last_came_on=MONDAY,
        hours={"16": 9, "19": 1},
    )
    assert summary.usual_hour() == 16
    assert summary.latest_hour() == 19
    # Five starts before the latest hour is trusted; three are enough for the usual one.
    early = activity.Summary(
        subject="s",
        first_came_on=MONDAY,
        last_came_at=local(MONDAY, 17),
        last_came_on=MONDAY,
        hours={"9": 4},
    )
    assert early.usual_hour() == 9 and early.latest_hour() is None


def test_a_streak_note_never_forecasts_a_day_that_has_not_happened() -> None:
    for audience in ("learner", "parent"):
        for angle in ("keep", "milestone"):
            text = render(
                "streak",
                {
                    "audience": audience,
                    "name": "Learner",
                    "learner_name": "Learner",
                    "days": 9,
                    "angle": angle,
                },
            )["text"]
            assert "Today makes" not in text, text
            assert "ten" not in text.split("\n\n", 1)[0].lower(), text


# === 2. nothing after eight ======================================================================
@pytest.mark.parametrize("lags", [(0.0, 0.0, 0.0), (0.0, 2.0, 4.0)], ids=["same-clock", "2s-apart"])
def test_the_sunday_note_goes_before_eight_whatever_saturday_evening_did(
    world: Any, lags: tuple[float, float, float]
) -> None:
    weekdays = lambda d: (MONDAY + timedelta(days=d)).weekday() < 5  # noqa: E731
    got = run(
        world, start=MONDAY, days=21, came=weekdays, visit=time(19, 45), under_13=True, lags=lags
    )
    notes = [s for s in got.parent.sends if s.kind == "sunday_note"]
    assert len(notes) == 3, got.parent.sends
    assert all(s.at.hour < nudges.LAST_HOUR for s in notes), notes
    assert inbox_law_breaks(got) == []


def test_the_sunday_note_window_closes_at_eight() -> None:
    sunday = MONDAY + timedelta(days=6)
    assert jobs.sunday_note_due(local(sunday, 19, 59))
    assert not jobs.sunday_note_due(local(sunday, 20, 0))
    assert not jobs.sunday_note_due(local(sunday, 20, 30))


def test_a_festival_wish_never_goes_after_eight() -> None:
    calendar = festivals.get_calendar()
    assert calendar.in_quiet_hours(local(MONDAY, 20, 0))
    assert calendar.in_quiet_hours(local(MONDAY, 20, 30))
    assert not calendar.in_quiet_hours(local(MONDAY, 19, 59))


@pytest.mark.parametrize(
    "jitter",
    [seeded_jitter(1), seeded_jitter(3), falling_jitter],
    ids=["seed1", "seed3", "falling"],
)
@pytest.mark.parametrize("name", ["A", "D", "E"])
def test_a_wish_after_a_late_note_still_goes_before_eight(
    world: Any, name: str, jitter: Any
) -> None:
    came = {"A": FAMILIES["A"], "D": lambda d: d == 0, "E": FAMILIES["E"]}[name]
    got = run(world, start=MONDAY, days=14, came=came, under_13=True, jitter=jitter)
    wishes = [s for s in got.parent.sends if s.kind == "wish"]
    assert [s.at.date() for s in wishes] == [date(2026, 10, 2)], got.parent.sends
    assert inbox_law_breaks(got) == []


# === 3. the floor holds when the cron drifts and on a quiet day ==================================
@pytest.mark.parametrize("under_13", AGES)
@pytest.mark.parametrize(
    "jitter",
    [seeded_jitter(1), seeded_jitter(3), falling_jitter],
    ids=["seed1", "seed3", "falling"],
)
@pytest.mark.parametrize("name", ["A", "C", "E"])
def test_a_drifting_cron_never_costs_the_floor(
    world: Any, name: str, jitter: Any, under_13: bool
) -> None:
    got = run(
        world,
        start=MONDAY,
        days=28,
        came=FAMILIES[name],
        under_13=under_13,
        jitter=jitter,
        lags=(0.0, 1.0, 2.0),
    )
    assert floor_breaks(got, 0, 28 - FULL.per_days) == []
    assert inbox_law_breaks(got) == []
    assert come_back_on_a_day_they_came(got) == []


@pytest.mark.parametrize("under_13", AGES)
@pytest.mark.parametrize(
    "start", [date(2026, 11, 17), date(2026, 11, 19), date(2026, 11, 21)], ids=str
)
@pytest.mark.parametrize("name", sorted(FAMILIES))
def test_a_quiet_day_never_costs_the_floor(
    world: Any, name: str, start: date, under_13: bool
) -> None:
    assert festivals.get_calendar().is_quiet_day("IN", date(2026, 11, 24))
    came = FAMILIES[name]
    shifted = lambda d: came(d + (start - MONDAY).days % 7)  # noqa: E731
    got = run(world, start=start, days=14, came=shifted, under_13=under_13)
    assert floor_breaks(got, 0, 14 - FULL.per_days) == []
    assert inbox_law_breaks(got) == []


def test_the_floor_is_kept_early_when_the_last_day_it_could_go_is_a_quiet_day() -> None:
    quiet = date(2026, 11, 24)
    sent = [quiet - timedelta(days=7), quiet - timedelta(days=5), quiet - timedelta(days=3)]
    assert cadence.floor_deadline(FULL, sent, quiet - timedelta(days=1)) == quiet
    blocked = {quiet}
    assert cadence.floor_due(FULL, sent, quiet - timedelta(days=1), blocked=blocked.__contains__)
    month = activity.STEPS[-1]
    last = [quiet - timedelta(days=30)]
    assert not cadence.floor_due(
        month, last, quiet - timedelta(days=2), blocked=blocked.__contains__
    )
    assert cadence.floor_due(month, last, quiet - timedelta(days=1), blocked=blocked.__contains__)


# === 4. away for months: never a month with nothing ==============================================
@pytest.mark.parametrize(
    ("left", "under_13"),
    [
        pytest.param(date(2026, 10, 29), True, id="left-10-29-under-13"),
        pytest.param(date(2026, 10, 29), False, id="left-10-29-aged-15"),
        pytest.param(date(2026, 11, 1), True, id="left-11-01-under-13"),
        pytest.param(date(2026, 10, 9), False, id="left-10-09-aged-15"),
        pytest.param(date(2027, 2, 21), True, id="left-02-21-under-13"),
    ],
)
def test_a_family_away_for_months_is_never_a_month_without_a_note(
    world: Any, left: date, under_13: bool
) -> None:
    start = left - timedelta(days=13)
    horizon = max((date(2027, 4, 10) - start).days, 165)
    got = run(
        world,
        start=start,
        days=horizon,
        came=lambda d: d <= 13,
        under_13=under_13,
        first_hour=8,
        last_hour=20,
    )
    box = got.reachable
    empty = [s for s in range(14, horizon - 30 + 1) if box.in_window(start, s, 30) < 1]
    assert empty == [], [(s.at.date(), s.kind) for s in box.sends]
    assert inbox_law_breaks(got) == []


def test_a_step_down_never_leaves_thirty_days_without_a_note() -> None:
    """The last one-a-fortnight note went on 31 December; the learner stepped onto one a month a
    week later; the thirtieth day after that note is Martyrs' Day. The month's note is owed the
    day before, not a week after the step began."""
    month = activity.STEPS[-1]
    last, began, quiet = date(2026, 12, 31), date(2027, 1, 7), date(2027, 1, 30)
    assert festivals.get_calendar().is_quiet_day("IN", quiet)
    assert cadence.floor_deadline(month, [last], quiet - timedelta(days=1), since=began) == quiet

    def blocked(day: date) -> bool:
        return day == quiet

    assert cadence.floor_due(month, [last], quiet - timedelta(days=1), since=began, blocked=blocked)
