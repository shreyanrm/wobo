"""A family's inboxes over weeks, driven through the wired mail passes with the clock handed in.

Shared by the tests that hold the weekly cadence to its laws under the conditions the
adversaries found broken (2026-09-16): a learner who comes after six in the evening, a cron
that drifts by a few seconds, the three passes called a moment apart, a quiet day on the
calendar, a family that leaves on any date.

Every hour the cron's three passes run (the Sunday note, the nudges, the wishes); a visit writes
the activity record the way the app and the gateway do; every send is a console render in the
mail log. Nothing leaves the process: the provider call and the network are replaced with
functions that raise.
"""

from __future__ import annotations

import random
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

IST = ZoneInfo("Asia/Kolkata")
ZONE = "Asia/Kolkata"
#: The kinds that ask a learner to come back. The streak is one of them when it is the "keep it
#: going" note rather than a milestone the morning after, and its period says which.
COME_BACK = frozenset({"quick_one", "mid_chapter"})


def local(day: date, hour: int, minute: int = 30, second: float = 0.0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=IST) + timedelta(seconds=second)


@dataclass(frozen=True)
class Sent:
    at: datetime  # on the family's clock
    kind: str
    period: str

    @property
    def asks_to_return(self) -> bool:
        return self.kind in COME_BACK or (
            self.kind == "streak" and ":milestone-" not in f":{self.period.split(':', 1)[-1]}"
        )


@dataclass
class Box:
    sends: list[Sent] = field(default_factory=list)

    def day(self, start: date, sent: Sent) -> int:
        return (sent.at.date() - start).days

    def in_window(
        self, start: date, first: int, length: int, *, without: tuple[str, ...] = ()
    ) -> int:
        return sum(
            1
            for s in self.sends
            if first <= self.day(start, s) < first + length and s.kind not in without
        )

    def kinds(self) -> list[str]:
        return [s.kind for s in self.sends]


@dataclass
class Run:
    start: date
    days: int
    parent: Box
    learner: Box
    visits: dict[int, datetime]
    under_13: bool

    @property
    def reachable(self) -> Box:
        return self.parent if self.under_13 else self.learner

    def came_on(self, day: int) -> bool:
        return day in self.visits


@dataclass(frozen=True)
class Plan:
    start: date
    days: int
    came: Callable[[int], bool]
    visit: time = time(17, 45)
    under_13: bool = True
    #: Seconds the whole pass is late by, per (day, hour): a cron that drifts.
    jitter: Callable[[int, int], float] | None = None
    #: Seconds after the pass's moment that each of the three calls starts (sunday, nudges,
    #: wishes): three cron calls in a row, each reading its own clock.
    lags: tuple[float, float, float] = (0.0, 0.0, 0.0)
    #: The zone the visits are recorded in. The family's own, unless a test says otherwise.
    record_zone: str = ZONE
    first_hour: int = 7
    last_hour: int = 21
    welcome: bool = True
    #: A different start each day, when a test wants an irregular learner.
    visit_on: Callable[[int], time] | None = None

    def visit_time(self, day: int) -> time:
        return self.visit_on(day) if self.visit_on is not None else self.visit


def seeded_jitter(seed: int, most: float = 40.0) -> Callable[[int, int], float]:
    rng = random.Random(seed)
    table: dict[tuple[int, int], float] = {}

    def jitter(day: int, hour: int) -> float:
        if (day, hour) not in table:
            table[(day, hour)] = rng.uniform(0.0, most)
        return table[(day, hour)]

    return jitter


def falling_jitter(day: int, hour: int) -> float:
    """The worst drift for a same-hour mail on consecutive days: every pass a little earlier than
    the same pass the day before, so a gap measured to the second is always a few seconds short."""
    return max(0.0, 60.0 - 2.0 * day)


def install(monkeypatch: pytest.MonkeyPatch) -> prefs_mod.InMemoryPreferencesStore:
    """The world every run needs: console mail, no network, fresh stores, the real calendar."""
    monkeypatch.setenv("MAIL_TOKEN_SECRET", "test-mail-secret")
    monkeypatch.setenv("MAIL_DAILY_CAP", "1000000")
    monkeypatch.delenv("MAIL_QUIET_HOURS", raising=False)
    monkeypatch.delenv("MAIL_ORB_IMAGES", raising=False)
    monkeypatch.delenv("MAIL_CONFIRMED_FESTIVALS", raising=False)

    def _no_network(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("a family run never touches the network")

    monkeypatch.setattr(email_mod, "_post", _no_network)
    monkeypatch.setattr(jobs.urllib.request, "urlopen", _no_network)
    email_mod.set_mail_log(MailLog())
    festivals.set_calendar(None)
    prefs = prefs_mod.InMemoryPreferencesStore()
    prefs_mod.set_store(prefs)
    activity.set_store(activity.InMemoryActivityStore())

    def week_rows(table: str, query: dict[str, str]) -> list[dict[str, Any]] | None:
        if table != "meter_state":
            return None
        since = date.fromisoformat(query["date"].removeprefix("gte."))
        subject = query["subject_id"].removeprefix("eq.")
        return [
            {"date": d.day.isoformat(), "budget_consumed": d.units, "day_had_real_win": d.win}
            for d in activity.get_store().days(subject, since=since)
        ]

    monkeypatch.setattr(jobs, "_postgrest", week_rows)
    return prefs


def _visit(learner_id: str, at: datetime, zone: str, state: dict[str, int]) -> None:
    """Three cards a visit through ten-card modules, every module finished, every second one
    mastered: the same learning for every family."""
    store = activity.get_store()
    session = str(uuid.uuid4())
    store.note(learner_id, activity.Event("session_start", at, zone, session=session))
    store.note(learner_id, activity.Event("turn", at + timedelta(minutes=1), zone))
    ref, title = f"module-{state['module']}", f"Module {state['module']}"
    state["done"] = min(10, state["done"] + 3)
    store.note(
        learner_id,
        activity.Event(
            "progress",
            at + timedelta(minutes=9),
            zone,
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
                "module_finished", at + timedelta(minutes=10), zone, ref=ref, title=title
            ),
        )
        if state["module"] % 2 == 0:
            store.note(
                learner_id,
                activity.Event(
                    "topic_mastered", at + timedelta(minutes=11), zone, ref=ref, title=title
                ),
            )
        state["module"] += 1
        state["done"] = 0
    store.note(
        learner_id, activity.Event("session_end", at + timedelta(minutes=20), zone, session=session)
    )


def drive(
    plan: Plan, prefs: prefs_mod.InMemoryPreferencesStore, monkeypatch: pytest.MonkeyPatch
) -> Run:
    learner_id = str(uuid.uuid4())
    learner_email = f"learner-{learner_id[:8]}@example.test"
    parent_email = f"parent-{learner_id[:8]}@example.test"
    prefs.put(learner_id, prefs_mod.MailPreferences(country="IN", timezone=ZONE))
    family = jobs.Family(
        learner_id=learner_id,
        learner_name="Learner",
        parent_email=parent_email,
        timezone=ZONE,
        under_13=plan.under_13,
        learner_email="" if plan.under_13 else learner_email,
        # The link is made after the account is, so no earlier than the first visit.
        invited_at=datetime.combine(plan.start, plan.visit_time(0), tzinfo=IST).astimezone(UTC),
    )
    source = jobs.InMemoryFamilies([family])
    monkeypatch.setattr(jobs, "PostgrestFamilies", lambda: source)
    state = {"module": 1, "done": 0}
    visits: dict[int, datetime] = {}
    lag_sunday, lag_nudges, lag_wishes = plan.lags

    def visit(day: int) -> None:
        at = datetime.combine(plan.start + timedelta(days=day), plan.visit_time(day), tzinfo=IST)
        visits[day] = at
        _visit(learner_id, at, plan.record_zone, state)
        if day == 0 and plan.welcome:
            jobs.send_welcome(
                learner_id=learner_id,
                to=learner_email,
                data={"name": "Learner"},
                send=lambda kind, to, data, _at=at.astimezone(UTC), **kw: email_mod.send_email(  # noqa: B008
                    kind, to, data, at=_at, **kw
                ),
            )

    for day in range(plan.days):
        today = plan.start + timedelta(days=day)
        due = plan.came(day)
        for hour in range(plan.first_hour, plan.last_hour + 1):
            drift = plan.jitter(day, hour) if plan.jitter else 0.0
            at = local(today, hour, 30, drift)
            if (
                due
                and day not in visits
                and datetime.combine(today, plan.visit_time(day), tzinfo=IST) <= at
            ):
                visit(day)
            base = at.astimezone(UTC)
            jobs.run_sunday(base + timedelta(seconds=lag_sunday), families=source, digest=None)
            nudges.run_nudges(base + timedelta(seconds=lag_nudges))
            jobs.run_wishes(base + timedelta(seconds=lag_wishes), families=source)
        if due and day not in visits:
            visit(day)

    boxes = {to_hash(parent_email): Box(), to_hash(learner_email): Box()}
    for record in mail_log().records():
        if record.provider_id == "queued" or record.to_hash not in boxes:
            continue
        boxes[record.to_hash].sends.append(
            Sent(
                at=datetime.fromisoformat(record.sent_at).astimezone(IST),
                kind=record.kind,
                period=record.period,
            )
        )
    for box in boxes.values():
        box.sends.sort(key=lambda s: s.at)
    return Run(
        start=plan.start,
        days=plan.days,
        parent=boxes[to_hash(parent_email)],
        learner=boxes[to_hash(learner_email)],
        visits=dict(visits),
        under_13=plan.under_13,
    )


# --- the laws, as assertions a test calls ---------------------------------------------------------
#: Mail that answers what the reader just did, at the moment they did it: the welcome goes when
#: the account is made, whatever the hour. The hours law is for mail we choose the time of.
ANSWERS = frozenset({"welcome"})


def inbox_law_breaks(run: Run) -> list[str]:
    """Every send that broke the inbox law or the hours law, in words."""
    out: list[str] = []
    for name, box in (("parent", run.parent), ("learner", run.learner)):
        for a, b in zip(box.sends, box.sends[1:], strict=False):
            if b.at - a.at < jobs.INBOX_GAP:
                out.append(f"{name}: {a.kind} {a.at} then {b.kind} {b.at}, inside a day")
        for s in box.sends:
            if s.kind not in ANSWERS and not (nudges.FIRST_HOUR <= s.at.hour < nudges.LAST_HOUR):
                out.append(f"{name}: {s.kind} at {s.at}, outside eight to eight")
    return out


def come_back_on_a_day_they_came(run: Run) -> list[str]:
    """Every "come back" mail that went on a day the learner came, before or after the visit."""
    return [
        f"{s.kind} ({s.period}) at {s.at}, visit at {run.visits[run.reachable.day(run.start, s)]}"
        for s in run.reachable.sends
        if s.asks_to_return and run.came_on(run.reachable.day(run.start, s))
    ]


def floor_breaks(run: Run, first: int, last: int, *, mails: int = 3, length: int = 7) -> list[str]:
    """Every window of ``length`` days starting between ``first`` and ``last`` that held fewer
    than ``mails``."""
    box = run.reachable
    return [
        f"days {s}-{s + length - 1}: {box.in_window(run.start, s, length)}"
        for s in range(first, last + 1)
        if box.in_window(run.start, s, length) < mails
    ]


__all__ = [
    "COME_BACK",
    "IST",
    "ZONE",
    "Box",
    "Plan",
    "Run",
    "Sent",
    "come_back_on_a_day_they_came",
    "drive",
    "falling_jitter",
    "floor_breaks",
    "inbox_law_breaks",
    "install",
    "local",
    "seeded_jitter",
]
