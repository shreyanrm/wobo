"""The five families, driven through the wired mail jobs with the clock handed in.

The owner's cadence (docs/EMAILS-AND-ANIMATIONS.md) is a promise about inboxes over weeks, so it
is asserted over weeks: every hour the cron's three passes run (the Sunday note, the nudges, the
wishes), a visit writes the activity record the way the app and the gateway do, and every send is
a console render in the mail log. Nothing leaves the process.

The families, each under 13 (mail to the parent) and aged 15 (mail to the learner):
  A learns every day; B learns Monday, Wednesday and Friday; C is brand new and comes on days
  0, 1, 3, 5, 8, 11, 15 and 22; D came once and never again; E learns nine days running, misses
  the tenth and is back the day after; F learns for two weeks, is gone for six months, and
  comes back on day 190.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from wobo_gateway import activity
from wobo_gateway import email as email_mod
from wobo_gateway.email import MailLog, mail_log, to_hash
from wobo_gateway.hospitality import festivals, jobs, nudges
from wobo_gateway.hospitality import preferences as prefs_mod
from wobo_gateway.hospitality.nudges import RETURN_NUDGES

IST = ZoneInfo("Asia/Kolkata")
ZONE = "Asia/Kolkata"
DAY0 = date(2026, 9, 21)  # a Monday
FULL = activity.STEPS[0]
FIRST_HOUR, LAST_HOUR = 7, 21  # the cron runs every hour; outside these nothing is ever due


def moment(day: int, hour: int, minute: int = 30) -> datetime:
    return datetime.combine(DAY0 + timedelta(days=day), time(hour, minute), tzinfo=IST)


def visit(learner_id: str, day: int, state: dict[str, int]) -> None:
    """Three cards a visit through ten-card modules, every module finished, every second one
    mastered: the same learning for every family."""
    store = activity.get_store()
    at = moment(day, 17, 45)
    session = str(uuid.uuid4())
    store.note(learner_id, activity.Event("session_start", at, ZONE, session=session))
    store.note(learner_id, activity.Event("turn", at + timedelta(minutes=1), ZONE))
    ref, title = f"module-{state['module']}", f"Module {state['module']}"
    state["done"] = min(10, state["done"] + 3)
    store.note(
        learner_id,
        activity.Event(
            "progress",
            at + timedelta(minutes=9),
            ZONE,
            ref=ref,
            title=title,
            done=state["done"],
            total=10,
        ),
    )
    if state["done"] == 10:
        store.note(
            learner_id,
            activity.Event(
                "module_finished", at + timedelta(minutes=10), ZONE, ref=ref, title=title
            ),
        )
        if state["module"] % 2 == 0:
            store.note(
                learner_id,
                activity.Event(
                    "topic_mastered", at + timedelta(minutes=11), ZONE, ref=ref, title=title
                ),
            )
        state["module"] += 1
        state["done"] = 0
    store.note(
        learner_id, activity.Event("session_end", at + timedelta(minutes=30), ZONE, session=session)
    )


@dataclass
class Inbox:
    """What one address received: (local moment, kind), oldest first."""

    sends: list[tuple[datetime, str]] = field(default_factory=list)

    def days(self) -> list[int]:
        return [(at.date() - DAY0).days for at, _ in self.sends]

    def in_window(self, start: int, length: int, *, without: tuple[str, ...] = ()) -> int:
        return sum(
            1
            for (at, kind) in self.sends
            if start <= (at.date() - DAY0).days < start + length and kind not in without
        )

    def kinds(self) -> list[str]:
        return [kind for _, kind in self.sends]


@dataclass
class Run:
    parent: Inbox
    learner: Inbox
    came: set[int]

    def reachable(self, under_13: bool) -> Inbox:
        return self.parent if under_13 else self.learner


FAMILIES: dict[str, tuple[Callable[[int], bool], int]] = {
    "A": (lambda d: True, 28),
    "B": (lambda d: (DAY0 + timedelta(days=d)).weekday() in (0, 2, 4), 28),
    "C": (lambda d: d in {0, 1, 3, 5, 8, 11, 15, 22}, 28),
    "D": (lambda d: d == 0, 28),
    "E": (lambda d: d != 9, 28),
    "F": (lambda d: d <= 13 or 190 <= d <= 203, 204),
}


@pytest.fixture(autouse=True)
def _world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.setenv("MAIL_DAILY_CAP", "1000000")
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    monkeypatch.delenv("MAIL_ORB_IMAGES", raising=False)

    def _no_network(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("the families never touch the network")

    monkeypatch.setattr(email_mod, "_post", _no_network)
    monkeypatch.setattr(jobs.urllib.request, "urlopen", _no_network)
    email_mod.set_mail_log(MailLog())
    prefs = prefs_mod.InMemoryPreferencesStore()
    prefs_mod.set_store(prefs)
    activity.set_store(activity.InMemoryActivityStore())

    def week_rows(table: str, query: dict[str, str]) -> list[dict[str, Any]] | None:
        # The Sunday note's read of learner.meter_state, answered from the same record.
        if table != "meter_state":
            return None
        since = date.fromisoformat(query["date"].removeprefix("gte."))
        subject = query["subject_id"].removeprefix("eq.")
        return [
            {"date": d.day.isoformat(), "budget_consumed": d.units, "day_had_real_win": d.win}
            for d in activity.get_store().days(subject, since=since)
        ]

    monkeypatch.setattr(jobs, "_postgrest", week_rows)
    yield prefs, monkeypatch
    prefs_mod.set_store(None)
    activity.set_store(None)
    email_mod.reset_mail_log()


def drive(name: str, under_13: bool, world: Any) -> Run:
    prefs, monkeypatch = world
    came, horizon = FAMILIES[name]
    learner_id = str(uuid.uuid4())
    learner_email = f"learner-{name.lower()}@example.test"
    parent_email = f"parent-{name.lower()}@example.test"
    prefs.put(learner_id, prefs_mod.MailPreferences(country="IN", timezone=ZONE))
    family = jobs.Family(
        learner_id=learner_id,
        learner_name="Learner",
        parent_email=parent_email,
        timezone=ZONE,
        under_13=under_13,
        learner_email="" if under_13 else learner_email,
        invited_at=moment(0, 18, 20).astimezone(UTC),
    )
    source = jobs.InMemoryFamilies([family])
    monkeypatch.setattr(jobs, "PostgrestFamilies", lambda: source)
    state = {"module": 1, "done": 0}
    for day in range(horizon):
        for hour in range(FIRST_HOUR, LAST_HOUR + 1):
            at = moment(day, hour).astimezone(UTC)
            jobs.run_sunday(at, families=source, digest=None)
            nudges.run_nudges(at)
            jobs.run_wishes(at, families=source)
            if hour == 17 and came(day):
                visit(learner_id, day, state)
                if day == 0:
                    arrived = moment(0, 17, 45).astimezone(UTC)
                    jobs.send_welcome(
                        learner_id=learner_id,
                        to=learner_email,
                        data={"name": "Learner"},
                        send=lambda kind, to, data, _at=arrived, **kw: email_mod.send_email(
                            kind, to, data, at=_at, **kw
                        ),
                    )
    boxes = {to_hash(parent_email): Inbox(), to_hash(learner_email): Inbox()}
    for record in mail_log().records():
        if record.provider_id == "queued":
            continue
        at = datetime.fromisoformat(record.sent_at).astimezone(IST)
        boxes[record.to_hash].sends.append((at, record.kind))
    for box in boxes.values():
        box.sends.sort()
    return Run(
        parent=boxes[to_hash(parent_email)],
        learner=boxes[to_hash(learner_email)],
        came={d for d in range(horizon) if came(d)},
    )


AGES = [pytest.param(True, id="under-13"), pytest.param(False, id="aged-15")]


# --- the laws that hold for every family, every address, every day --------------------------------
@pytest.mark.parametrize("under_13", AGES)
@pytest.mark.parametrize("name", sorted(FAMILIES))
def test_the_inbox_law_holds_for_every_family(name: str, under_13: bool, _world: Any) -> None:
    run = drive(name, under_13, _world)
    for box in (run.parent, run.learner):
        for (a, _), (b, _) in zip(box.sends, box.sends[1:], strict=False):
            assert b - a >= jobs.INBOX_GAP, (name, a, b)
        for at, kind in box.sends:
            assert at.hour < nudges.LAST_HOUR, (name, at, kind)
    come_back = [
        (at, kind)
        for at, kind in run.reachable(under_13).sends
        if kind in RETURN_NUDGES and (at.date() - DAY0).days in run.came
    ]
    assert come_back == [], f"{name}: a come-back mail on a day the learner came"
    box = run.reachable(under_13)
    good = [k for k in box.kinds() if k not in RETURN_NUDGES]
    assert len(good) * 2 > len(box.kinds()), f"{name}: good news is not most of the mail"


# --- the floor ------------------------------------------------------------------------------------
@pytest.mark.parametrize("under_13", AGES)
@pytest.mark.parametrize("name", ["A", "B", "C", "E"])
def test_every_reachable_address_hears_three_times_in_any_seven_days(
    name: str, under_13: bool, _world: Any
) -> None:
    box = drive(name, under_13, _world).reachable(under_13)
    short = [
        s for s in range(28 - FULL.per_days + 1) if box.in_window(s, FULL.per_days) < FULL.mails
    ]
    assert short == [], (
        f"{name}: windows starting on days {short} fell under the floor: {box.sends}"
    )


@pytest.mark.parametrize("under_13", AGES)
def test_a_parent_of_a_teenager_gets_the_sunday_note_and_nothing_about_the_cadence(
    under_13: bool, _world: Any
) -> None:
    run = drive("A", under_13, _world)
    if under_13:
        assert run.learner.kinds() == ["welcome"]
        assert "learning_note" in run.parent.kinds()
    else:
        assert set(run.parent.kinds()) <= {"sunday_note", "wish"}
        assert "learning_note" in run.learner.kinds()


# --- the ladder -----------------------------------------------------------------------------------
@pytest.mark.parametrize("under_13", AGES)
def test_the_learner_who_came_once_steps_down_and_is_never_dropped(
    under_13: bool, _world: Any
) -> None:
    box = drive("D", under_13, _world).reachable(under_13)
    full_through = activity.STEPS[0].through
    two = activity.STEPS[1]
    # While they are within the full cadence, the floor holds.
    for start in range(0, full_through - FULL.per_days + 2):
        assert box.in_window(start, FULL.per_days) >= FULL.mails, (start, box.sends)
    # On the next step, exactly its number.
    for start in range(two.since, 28 - two.per_days + 1):
        assert box.in_window(start, two.per_days) == two.mails, (start, box.sends)


@pytest.mark.parametrize("under_13", AGES)
def test_six_months_away_is_one_a_month_at_least_and_coming_back_is_the_full_cadence(
    under_13: bool, _world: Any
) -> None:
    run = drive("F", under_13, _world)
    box = run.reachable(under_13)
    last, back = 13, 190
    for start in range(last + 1, back - 30 + 1):
        assert box.in_window(start, 30) >= 1, f"30 days from day {start} with no mail"
    # The ladder is the learning mail's. A festival wish is the family's own calendar and is not
    # held to it, though the inbox law still spaces it.
    # Its number exactly, and one more only where the note's own day was a quiet day or a wish's
    # and the note was kept the day before: one a month is the owner's bare minimum, so the
    # floor wins over the step's ceiling there and nowhere else (2026-09-16).
    calendar = festivals.get_calendar()
    wish_days = {at.date() for at, kind in box.sends if kind == "wish"}
    kept_early = {
        (at.date() - DAY0).days
        for at, kind in box.sends
        if kind != "wish"
        and (
            calendar.is_quiet_day("IN", at.date() + timedelta(days=1))
            or at.date() + timedelta(days=1) in wish_days
        )
    }
    for step in activity.STEPS[1:]:
        lo = last + step.since
        hi = back if step.through is None else min(back, last + step.through + 1)
        for start in range(lo, hi - step.per_days + 1):
            held = box.in_window(start, step.per_days, without=("wish",))
            early = any(start <= day < start + step.per_days for day in kept_early)
            assert step.mails <= held <= step.mails + int(early), (step.id, start, box.sends)
    for start in range(back, back + 14 - FULL.per_days + 1):
        assert box.in_window(start, FULL.per_days) >= FULL.mails, (start, box.sends)
