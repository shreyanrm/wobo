"""The activity record: when each learner last came, and what they did (migration 0034).

The owner, 2026-09-16: *"make sure you have a record of application activity and stuff"*. The
mail cadence (docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence") stands on this record, and
before it there was none: ``learner.meter_state`` and ``learner.sessions`` were written by
nothing, and the mail read thirty days back, so a learner gone forty-five days looked exactly
like one who never came.

WHAT IS RECORDED, AND WHY EACH ONE

* **The days they came**, on their own clock, one row per day (``learner.meter_state``), with a
  count of learning units and whether the day had a real win. "A come-back mail never goes on a
  day the learner came" and "days active this month" are read from here.
* **Their sessions** (``learner.sessions``): start, end, surface. Written from the app through
  ``POST /v1/me/activity``, the same seam the mind, the mail dials and the doubts use.
* **One summary row** (``learner.activity``): first and last came (ever, no horizon), their zone,
  days active, streak, the hour they usually start, the last day they learned, the latest twelve
  moments a mail may speak about, and where they are in the chapter.

WHAT IT IS FOR. To teach, and to write the learner's own mail. It is never shared, never used for
advertising, and never read by a third party: DPDP Act 2023 s.9(3) bars behavioural monitoring of
a child for any other purpose. So nothing here holds a campaign, a device, an address, an open or
a click; the console sees counts, and for one learner only the four facts a support task needs.
``POST /v1/me/erase`` sweeps every row (:mod:`wobo_gateway.memory`).

ONE RULE, TWO PLACES. :func:`fold` is the specification of what an event does to the record. The
project runs the same rule inside ``learner.note_activity`` (0034) so one event is one atomic
call; the in-process store runs :func:`fold` itself. ``tests/test_activity_record.py`` holds the
rule, ``tests/test_activity_schema.py`` holds the SQL to it.

THE LADDER. The step a learner sits on is a function of days away and nothing else
(:func:`step_for`): up to 14 the full cadence, 15 to 30 two a week, 31 to 60 one a week, 61 to 90
one a fortnight, beyond 90 one a month for as long as the address is reachable. The bounds are one
dial (``mail.ladder`` in ``ops.settings``). No step is below one a month, and the last never ends.

WRITES NEVER COST A TURN, AND A FAILED WRITE NEVER FAILS A TURN. The server marks a signed-in
learner's day itself on every capability call, off the request thread, at most once per ten
minutes (:func:`note_turn`). Anonymous callers are never recorded.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from wobo_gateway.admin_auth import LEARNER_READ, AdminContext, CanRead, admin_router, requires

logger = logging.getLogger("wobo.gateway.activity")

# --- the vocabulary -------------------------------------------------------------------------------
#: Every kind the record knows. ``turn`` is the server's own; the app may send the other five.
KINDS: tuple[str, ...] = (
    "turn",
    "session_start",
    "session_end",
    "module_finished",
    "topic_mastered",
    "progress",
)
#: Kinds that are learning, counted as units on the day row.
LEARNING: frozenset[str] = frozenset({"turn", "module_finished", "topic_mastered", "progress"})
#: Kinds that are a real win on the day, and a moment a mail may speak about.
WINS: frozenset[str] = frozenset({"module_finished", "topic_mastered"})
SESSION_KINDS: frozenset[str] = frozenset({"session_start", "session_end"})
SURFACES: tuple[str, ...] = ("pwa", "expo")

MAX_MOMENTS = 12
#: The hour-of-day counts are halved when their total passes this, so a changed routine wins.
HOURS_CEILING = 60
#: Three days before "the hour they usually learn" is anything but a guess.
USUAL_HOUR_MIN_DAYS = 3
#: Five before "the latest hour they start" is: a "come back" mail waits for it, and a guess too
#: early lands minutes before a learner who simply has not started that late yet.
LATEST_HOUR_MIN_DAYS = 5
TITLE_MAX = 120
REF_MAX = 128
CARDS_MAX = 500

#: Retention (0034's header states the same numbers, and its test holds them together).
DAY_KEEP_DAYS = 400
SESSION_KEEP_DAYS = 90

#: One recorded stretch of talking per this long. A turn inside it is the same stretch.
TURN_EVERY = timedelta(minutes=10)

#: The ladder's default bounds: the last day away of each step but the last.
LADDER_BOUNDS: tuple[int, ...] = (14, 30, 60, 90)

_TABLE = "activity"
_DAYS_TABLE = "meter_state"
_SCHEMA = "learner"
_HTTP_TIMEOUT_S = 5.0
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
UUID_PATTERN = _UUID_RE.pattern
#: What the in-process store accepts as a subject (the dev seam's are short slugs).
_SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class StoreUnavailable(RuntimeError):
    """The record could not be reached. Never a reason to fail a turn."""


# --- the shapes -----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Event:
    """One thing that happened. ``at`` is the server's clock, never the device's."""

    kind: str
    at: datetime
    zone: str = "UTC"
    ref: str = ""
    title: str = ""
    done: int | None = None
    total: int | None = None
    session: str = ""
    surface: str = "pwa"


@dataclass(frozen=True)
class Moment:
    kind: str
    ref: str
    title: str
    at: datetime


@dataclass(frozen=True)
class Progress:
    ref: str
    title: str
    done: int
    total: int
    at: datetime

    @property
    def left(self) -> int:
        return max(0, self.total - self.done)


@dataclass(frozen=True)
class Day:
    day: date
    units: int = 0
    win: bool = False


@dataclass(frozen=True)
class Session:
    id: str
    subject: str
    surface: str
    started_at: datetime
    ended_at: datetime | None = None


@dataclass(frozen=True, eq=False)
class Summary:
    """One learner's record: what the cadence reads (docs/EMAILS-AND-ANIMATIONS.md)."""

    subject: str
    first_came_on: date
    last_came_at: datetime
    last_came_on: date
    timezone: str = "UTC"
    days_active: int = 0
    streak_days: int = 0
    streak_best: int = 0
    hours: dict[str, int] = field(default_factory=dict)
    last_learned_on: date | None = None
    moments: tuple[Moment, ...] = ()
    progress: Progress | None = None
    sessions: int = 0

    def today(self, now: datetime) -> date:
        """The learner's own calendar day at ``now``."""
        return now.astimezone(_tz(self.timezone)).date()

    def days_away(self, now: datetime) -> int:
        """Whole days since they last came, on their own calendar. Zero means today."""
        return max(0, (self.today(now) - self.last_came_on).days)

    def came_today(self, now: datetime) -> bool:
        return self.days_away(now) == 0

    def current_streak(self, now: datetime) -> int:
        """The run still alive at ``now``: the stored run while they came today or yesterday,
        and zero once a whole day has gone by without them."""
        return self.streak_days if self.days_away(now) <= 1 else 0

    def _start_hours(self, least: int = USUAL_HOUR_MIN_DAYS) -> dict[int, int] | None:
        counts = {int(h): n for h, n in self.hours.items() if str(h).isdigit() and n > 0}
        return counts if sum(counts.values()) >= least else None

    def usual_hour(self) -> int | None:
        """The local hour they most often start in, once there are enough days to say."""
        counts = self._start_hours()
        if counts is None:
            return None
        return max(sorted(counts), key=lambda hour: counts[hour])

    def latest_hour(self) -> int | None:
        """The latest local hour they have started a day in, once there are enough days to say.

        What a "come back" mail waits for (``hospitality/cadence.py``): a learner who usually
        starts at four and sometimes at seven has not stayed away at half past six. The counts
        are halved as they grow (:data:`HOURS_CEILING`), so one late evening months ago ages out.
        """
        counts = self._start_hours(LATEST_HOUR_MIN_DAYS)
        return max(counts) if counts is not None else None

    def step(self, now: datetime, bounds: Sequence[int] | None = None) -> Step:
        return step_for(self.days_away(now), bounds)


@dataclass(frozen=True)
class Census:
    """How many learners came when, and how many sit on each step. Nobody is named."""

    learners: int
    today: int
    week: int
    month: int
    steps: tuple[int, ...]


# --- the zone -------------------------------------------------------------------------------------
def zone_name(name: str | None) -> str:
    """A real IANA zone name, or ``UTC``."""
    if isinstance(name, str) and name.strip():
        try:
            ZoneInfo(name.strip()[:64])
            return name.strip()[:64]
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            pass
    return "UTC"


def _tz(name: str) -> ZoneInfo:
    return ZoneInfo(zone_name(name))


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


# --- the rule -------------------------------------------------------------------------------------
def fold(
    stored: Summary | None,
    subject: str,
    event: Event,
    *,
    new_day: bool,
    new_session: bool = False,
) -> Summary:
    """What one event does to a learner's record. ``learner.note_activity`` is this, in SQL.

    ``new_day`` is whether the day row for the event's local day did not exist before this event;
    ``new_session`` whether a session start opened a session that was not already open. The store
    knows both, and passes them in, so this stays pure.
    """
    zone = zone_name(event.zone)
    at = _aware(event.at)
    local = at.astimezone(ZoneInfo(zone))
    day, hour = local.date(), local.hour
    row = stored or Summary(
        subject=subject, first_came_on=day, last_came_at=at, last_came_on=day, timezone=zone
    )

    if day > row.last_came_on:
        streak = row.streak_days + 1 if day == row.last_came_on + timedelta(days=1) else 1
    elif day == row.last_came_on:
        streak = max(row.streak_days, 1)
    else:
        streak = row.streak_days

    hours = dict(row.hours)
    if new_day:
        hours[str(hour)] = hours.get(str(hour), 0) + 1
        if sum(hours.values()) > HOURS_CEILING:
            hours = {key: count // 2 for key, count in hours.items() if count // 2 > 0}

    ref = (event.ref or "")[:REF_MAX]
    title = (event.title or "")[:TITLE_MAX]
    moments = row.moments
    if event.kind in WINS:
        kept = [m for m in row.moments if not (m.kind == event.kind and m.ref == ref)]
        moments = (Moment(kind=event.kind, ref=ref, title=title, at=at), *kept)[:MAX_MOMENTS]

    progress = row.progress
    total = event.total or 0
    if event.kind == "progress" and total > 0 and (progress is None or at >= progress.at):
        done = min(max(event.done or 0, 0), total)
        progress = Progress(ref=ref, title=title, done=done, total=total, at=at)
    elif event.kind == "module_finished" and progress is not None and progress.ref == ref:
        progress = None

    learned = row.last_learned_on
    if event.kind in LEARNING:
        learned = day if learned is None else max(learned, day)

    return Summary(
        subject=row.subject,
        first_came_on=min(row.first_came_on, day),
        last_came_at=max(row.last_came_at, at),
        last_came_on=max(row.last_came_on, day),
        timezone=zone if at >= row.last_came_at else row.timezone,
        days_active=max(row.days_active + (1 if new_day else 0), 1),
        streak_days=streak,
        streak_best=max(row.streak_best, streak),
        hours=hours,
        last_learned_on=learned,
        moments=moments,
        progress=progress,
        sessions=row.sessions + (1 if new_session else 0),
    )


# --- the ladder -----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Step:
    """One step of the step-down. ``mails`` per ``per_days`` is the floor on that step."""

    id: str
    label: str
    mails: int
    per_days: int
    since: int
    through: int | None


#: (id, at least this many mails, per this many days, what the desk calls it)
_SHAPES: tuple[tuple[str, int, int, str], ...] = (
    ("full", 3, 7, "The full cadence: at least three a week"),
    ("two_a_week", 2, 7, "Two a week"),
    ("one_a_week", 1, 7, "One a week"),
    ("one_a_fortnight", 1, 14, "One a fortnight"),
    ("one_a_month", 1, 30, "One a month, for as long as the address is reachable"),
)


def steps(bounds: Sequence[int] | None = None) -> tuple[Step, ...]:
    """The five steps under these bounds (the dial's, when none are given)."""
    held = tuple(bounds) if bounds is not None else ladder()[0]
    out: list[Step] = []
    since = 0
    for index, (step_id, mails, per_days, label) in enumerate(_SHAPES):
        through = held[index] if index < len(held) else None
        out.append(
            Step(
                id=step_id,
                label=label,
                mails=mails,
                per_days=per_days,
                since=since,
                through=through,
            )
        )
        since = (through or 0) + 1
    return tuple(out)


STEPS: tuple[Step, ...] = steps(LADDER_BOUNDS)


def ladder() -> tuple[tuple[int, ...], str]:
    """The bounds in force and where they came from: ``"dial"`` or ``"default"``."""
    from wobo_gateway import dials

    try:
        found = dials.valid_mail_ladder(dials.value(dials.MAIL_LADDER_KEY))
    except Exception as exc:  # noqa: BLE001 — a dial we cannot read is a dial that is not set
        logger.warning("activity: the ladder dial is unreadable (%s)", type(exc).__name__)
        found = None
    return (found, "dial") if found is not None else (LADDER_BOUNDS, "default")


def step_for(days_away: int, bounds: Sequence[int] | None = None) -> Step:
    """The step a learner this many days away sits on. Beyond the last bound, the last step."""
    held = tuple(bounds) if bounds is not None else ladder()[0]
    index = sum(1 for bound in held if days_away > bound)
    return steps(held)[min(index, len(_SHAPES) - 1)]


# --- the rows -------------------------------------------------------------------------------------
def _date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _moment_at(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return _aware(value)
    if isinstance(value, str) and value:
        try:
            return _aware(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def _count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def from_row(row: dict[str, Any]) -> Summary | None:
    """A ``learner.activity`` row as PostgREST returns it, or ``None`` when it is not one."""
    subject = str(row.get("subject_id") or "")
    first = _date(row.get("first_came_on"))
    last_on = _date(row.get("last_came_on"))
    last_at = _moment_at(row.get("last_came_at"))
    if not subject or first is None or last_on is None or last_at is None:
        return None
    raw_hours = row.get("hours") if isinstance(row.get("hours"), dict) else {}
    hours = {str(k): _count(v) for k, v in raw_hours.items() if _count(v) > 0}
    moments: list[Moment] = []
    for item in row.get("moments") or []:
        if not isinstance(item, dict):
            continue
        when = _moment_at(item.get("at"))
        if when is None or item.get("kind") not in WINS:
            continue
        moments.append(
            Moment(
                kind=str(item["kind"]),
                ref=str(item.get("ref") or "")[:REF_MAX],
                title=str(item.get("title") or "")[:TITLE_MAX],
                at=when,
            )
        )
    progress = None
    raw = row.get("progress")
    if isinstance(raw, dict) and _moment_at(raw.get("at")) is not None and _count(raw.get("total")):
        progress = Progress(
            ref=str(raw.get("ref") or "")[:REF_MAX],
            title=str(raw.get("title") or "")[:TITLE_MAX],
            done=min(_count(raw.get("done")), _count(raw.get("total"))),
            total=_count(raw.get("total")),
            at=_moment_at(raw.get("at")) or last_at,
        )
    return Summary(
        subject=subject,
        first_came_on=first,
        last_came_at=last_at,
        last_came_on=last_on,
        timezone=zone_name(row.get("timezone")),
        days_active=_count(row.get("days_active")),
        streak_days=_count(row.get("streak_days")),
        streak_best=_count(row.get("streak_best")),
        hours=hours,
        last_learned_on=_date(row.get("last_learned_on")),
        moments=tuple(moments[:MAX_MOMENTS]),
        progress=progress,
        sessions=_count(row.get("sessions")),
    )


# --- the stores -----------------------------------------------------------------------------------
class ActivityStore(Protocol):
    def note(self, subject: str, event: Event) -> Summary | None: ...

    def get(self, subject: str) -> Summary | None: ...

    def many(self, subjects: Sequence[str]) -> dict[str, Summary]: ...

    def days(self, subject: str, *, since: date) -> list[Day]: ...

    def census(self, now: datetime, bounds: tuple[int, ...]) -> Census: ...

    def expire(self, now: datetime) -> int: ...


class InMemoryActivityStore:
    """The record held in this process: a local run and the suite. The same rule, no project."""

    def __init__(self) -> None:
        self._rows: dict[str, Summary] = {}
        self._days: dict[str, dict[date, Day]] = {}
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def note(self, subject: str, event: Event) -> Summary | None:
        if not subject or not _SUBJECT_RE.match(subject) or event.kind not in KINDS:
            return None
        at = _aware(event.at)
        day = at.astimezone(ZoneInfo(zone_name(event.zone))).date()
        with self._lock:
            days = self._days.setdefault(subject, {})
            held = days.get(day)
            days[day] = Day(
                day=day,
                units=(held.units if held else 0) + (1 if event.kind in LEARNING else 0),
                win=(held.win if held else False) or event.kind in WINS,
            )
            new_session = False
            if event.session and event.kind == "session_start":
                if event.session not in self._sessions:
                    self._sessions[event.session] = Session(
                        id=event.session,
                        subject=subject,
                        surface=event.surface if event.surface in SURFACES else "pwa",
                        started_at=at,
                    )
                    new_session = True
            elif event.session and event.kind == "session_end":
                open_one = self._sessions.get(event.session)
                if open_one and open_one.subject == subject and open_one.ended_at is None:
                    self._sessions[event.session] = replace(
                        open_one, ended_at=max(open_one.started_at, at)
                    )
            summary = fold(
                self._rows.get(subject),
                subject,
                replace(event, at=at),
                new_day=held is None,
                new_session=new_session,
            )
            self._rows[subject] = summary
            return summary

    def get(self, subject: str) -> Summary | None:
        with self._lock:
            return self._rows.get(subject)

    def many(self, subjects: Sequence[str]) -> dict[str, Summary]:
        with self._lock:
            return {s: self._rows[s] for s in subjects if s in self._rows}

    def days(self, subject: str, *, since: date) -> list[Day]:
        with self._lock:
            held = self._days.get(subject, {})
            return [held[d] for d in sorted(held) if d >= since]

    def sessions(self, subject: str) -> list[Session]:
        with self._lock:
            rows = [s for s in self._sessions.values() if s.subject == subject]
        return sorted(rows, key=lambda s: s.started_at)

    def census(self, now: datetime, bounds: tuple[int, ...]) -> Census:
        with self._lock:
            rows = list(self._rows.values())
        away = [row.days_away(now) for row in rows]
        counts = [0] * (len(bounds) + 1)
        for days in away:
            counts[sum(1 for bound in bounds if days > bound)] += 1
        return Census(
            learners=len(rows),
            today=sum(1 for d in away if d == 0),
            week=sum(1 for d in away if d < 7),
            month=sum(1 for d in away if d < 30),
            steps=tuple(counts),
        )

    def expire(self, now: datetime) -> int:
        day_floor = _aware(now).astimezone(UTC).date() - timedelta(days=DAY_KEEP_DAYS)
        session_floor = _aware(now) - timedelta(days=SESSION_KEEP_DAYS)
        gone = 0
        with self._lock:
            for held in self._days.values():
                for day in [d for d in held if d < day_floor]:
                    del held[day]
                    gone += 1
            for key in [k for k, s in self._sessions.items() if s.started_at < session_floor]:
                del self._sessions[key]
                gone += 1
        return gone

    def forget_all(self, subject: str) -> int:
        """Every row of this learner's record, gone. The count is what left."""
        with self._lock:
            gone = 1 if self._rows.pop(subject, None) is not None else 0
            gone += len(self._days.pop(subject, {}))
            for key in [k for k, s in self._sessions.items() if s.subject == subject]:
                del self._sessions[key]
                gone += 1
        return gone


def _request(url: str, key: str, method: str, *, body: Any = None) -> Any:
    """One PostgREST call with the service-role key. Split out so tests substitute it."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    return json.loads(raw) if raw.strip() else None


_FAILURES = (urllib.error.URLError, TimeoutError, ValueError, OSError)


class PostgrestActivityStore:
    """The record in the project: ``learner.note_activity`` to write, plain reads to read.

    Every subject is an account id (a uuid) before it goes anywhere near a URL, so no filter here
    can be written by whoever chose the subject.
    """

    def __init__(self, base_url: str, service_key: str) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestActivityStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key

    def _call(
        self, method: str, path: str, *, params: dict[str, str] | None = None, body: Any = None
    ) -> Any:
        query = ""
        if params:
            query = "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        url = f"{self.base}/rest/v1/{path}{query}"
        try:
            return _request(url, self._key, method, body=body)
        except _FAILURES as exc:
            logger.warning(
                "activity: the project did not answer",
                extra={"fields": {"path": path, "error": type(exc).__name__}},
            )
            raise StoreUnavailable(str(exc)) from exc

    def note(self, subject: str, event: Event) -> Summary | None:
        if not _UUID_RE.match(subject or "") or event.kind not in KINDS:
            return None
        session = event.session if _UUID_RE.match(event.session or "") else None
        body = {
            "p_subject": subject,
            "p_kind": event.kind,
            "p_at": _aware(event.at).astimezone(UTC).isoformat(),
            "p_zone": zone_name(event.zone),
            "p_ref": (event.ref or "")[:REF_MAX] or None,
            "p_title": (event.title or "")[:TITLE_MAX] or None,
            "p_done": event.done,
            "p_total": event.total,
            "p_session": session,
            "p_surface": (event.surface if event.surface in SURFACES else "pwa")
            if session
            else None,
        }
        answer = self._call("POST", "rpc/note_activity", body=body)
        row = answer[0] if isinstance(answer, list) and answer else answer
        return from_row(row) if isinstance(row, dict) else None

    def get(self, subject: str) -> Summary | None:
        if not _UUID_RE.match(subject or ""):
            return None
        rows = self._call(
            "GET", _TABLE, params={"select": "*", "subject_id": f"eq.{subject}", "limit": "1"}
        )
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return from_row(rows[0])
        return None

    def many(self, subjects: Sequence[str]) -> dict[str, Summary]:
        wanted = sorted({s for s in subjects if isinstance(s, str) and _UUID_RE.match(s)})
        if not wanted:
            return {}
        rows = self._call(
            "GET",
            _TABLE,
            params={"select": "*", "subject_id": f"in.({','.join(wanted)})"},
        )
        out: dict[str, Summary] = {}
        for row in rows if isinstance(rows, list) else []:
            summary = from_row(row) if isinstance(row, dict) else None
            if summary is not None:
                out[summary.subject] = summary
        return out

    def days(self, subject: str, *, since: date) -> list[Day]:
        if not _UUID_RE.match(subject or ""):
            return []
        rows = self._call(
            "GET",
            _DAYS_TABLE,
            params={
                "select": "date,budget_consumed,day_had_real_win",
                "subject_id": f"eq.{subject}",
                "date": f"gte.{since.isoformat()}",
                "order": "date.asc",
            },
        )
        out: list[Day] = []
        for row in rows if isinstance(rows, list) else []:
            day = _date(row.get("date")) if isinstance(row, dict) else None
            if day is not None:
                out.append(
                    Day(
                        day=day,
                        units=_count(row.get("budget_consumed")),
                        win=row.get("day_had_real_win") is True,
                    )
                )
        return out

    def census(self, now: datetime, bounds: tuple[int, ...]) -> Census:
        """Counted in the project, on each learner's own calendar. ``now`` is the project's."""
        answer = self._call("POST", "rpc/activity_census", body={"p_bounds": list(bounds)})
        if not isinstance(answer, dict):
            raise StoreUnavailable("the census answered with nothing")
        found = answer.get("steps") if isinstance(answer.get("steps"), dict) else {}
        return Census(
            learners=_count(answer.get("learners")),
            today=_count(answer.get("today")),
            week=_count(answer.get("week")),
            month=_count(answer.get("month")),
            steps=tuple(_count(found.get(str(i))) for i in range(len(bounds) + 1)),
        )

    def expire(self, now: datetime) -> int:
        answer = self._call(
            "POST",
            "rpc/expire_activity",
            body={"p_day_keep": DAY_KEEP_DAYS, "p_session_keep": SESSION_KEEP_DAYS},
        )
        return _count(answer)


# --- the process-wide store, the clock, the runner ------------------------------------------------
_store: ActivityStore | None = None
_store_lock = threading.Lock()
_clock: Callable[[], datetime] | None = None


def _thread(go: Callable[[], None]) -> None:
    threading.Thread(target=go, name="wobo-activity", daemon=True).start()


_runner: Callable[[Callable[[], None]], None] = _thread


def build_store() -> ActivityStore:
    """The project when one is configured, else this process. ``ACTIVITY_STORE=memory`` forces
    the latter, which is what the suite and a local run use."""
    if (os.getenv("ACTIVITY_STORE") or "").strip().lower() == "memory":
        return InMemoryActivityStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestActivityStore(base, key)
    logger.info("activity: no project configured, keeping the record in memory")
    return InMemoryActivityStore()


def get_store() -> ActivityStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: ActivityStore | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store


def set_clock(clock: Callable[[], datetime] | None) -> None:
    """Test seam: the record's clock is handed in, never slept on."""
    global _clock
    _clock = clock


def set_runner(runner: Callable[[Callable[[], None]], None] | None) -> None:
    """Test seam: how a background note runs. The suite runs it inline."""
    global _runner
    _runner = runner or _thread


def now() -> datetime:
    return _aware(_clock()) if _clock is not None else datetime.now(UTC)


_turns: dict[str, tuple[datetime, date]] = {}
_turns_lock = threading.Lock()
_TURNS_MAX = 50_000
_expired_on: date | None = None


def reset() -> None:
    """Forget the throttle and the day's sweep. Per-process state, like the meters."""
    global _expired_on
    with _turns_lock:
        _turns.clear()
        _expired_on = None


def _maybe_expire(at: datetime) -> None:
    """The retention sweep, at most once a UTC day per process, on the way past."""
    global _expired_on
    day = at.astimezone(UTC).date()
    with _turns_lock:
        if _expired_on == day:
            return
        _expired_on = day
    try:
        gone = get_store().expire(at)
        if gone:
            logger.info("activity: old rows expired", extra={"fields": {"rows": gone}})
    except Exception as exc:  # noqa: BLE001 — a sweep that fails is tried again tomorrow
        logger.warning("activity: the sweep failed (%s)", type(exc).__name__)


def note_turn(subject: str | None, *, anonymous: bool, zone: str | None) -> bool:
    """A signed-in learner is learning right now. Recorded off the request thread, at most once
    per :data:`TURN_EVERY` (and again when their day turns over), and never for an anonymous
    caller. Never raises and never waits. True when a note was scheduled."""
    if anonymous or not subject:
        return False
    at = now()
    held_zone = zone_name(zone)
    day = at.astimezone(ZoneInfo(held_zone)).date()
    with _turns_lock:
        last = _turns.get(subject)
        if last is not None and at - last[0] < TURN_EVERY and last[1] == day:
            return False
        if len(_turns) >= _TURNS_MAX:
            _turns.clear()
        _turns[subject] = (at, day)
    event = Event(kind="turn", at=at, zone=held_zone)

    def go() -> None:
        try:
            get_store().note(subject, event)
        except Exception as exc:  # noqa: BLE001 — a record that failed never fails a turn
            logger.warning("activity: a turn was not recorded (%s)", type(exc).__name__)
        _maybe_expire(at)

    try:
        _runner(go)
    except Exception as exc:  # noqa: BLE001
        logger.warning("activity: could not schedule a note (%s)", type(exc).__name__)
        return False
    return True


# --- the console's views --------------------------------------------------------------------------
def learner_view(
    summary: Summary | None, subject: str, days: Iterable[Day], at: datetime
) -> dict[str, Any]:
    """One learner's page: the four facts a support task needs, and nothing a mail is made of."""
    if summary is None:
        return {"found": False, "learner_id": subject}
    today = summary.today(at)
    month = [d for d in days if (d.day.year, d.day.month) == (today.year, today.month)]
    step = summary.step(at)
    return {
        "found": True,
        "learner_id": subject,
        "last_came_at": summary.last_came_at.astimezone(UTC).isoformat(),
        "last_came_on": summary.last_came_on.isoformat(),
        "timezone": summary.timezone,
        "days_away": summary.days_away(at),
        "days_active_this_month": len({d.day for d in month}),
        "streak_days": summary.current_streak(at),
        "step": _step_view(step),
    }


def _step_view(
    step: Step, learners: int | None = None, *, with_count: bool = False
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": step.id,
        "label": step.label,
        "mails": step.mails,
        "per_days": step.per_days,
        "since": step.since,
        "through": step.through,
    }
    if with_count:
        out["learners"] = learners
    return out


def desk_view(
    census: Census | None, bounds: tuple[int, ...], source: str, at: datetime
) -> dict[str, Any]:
    ladder_steps = steps(bounds)
    return {
        "readable": census is not None,
        "census": None
        if census is None
        else {
            "learners": census.learners,
            "today": census.today,
            "week": census.week,
            "month": census.month,
        },
        "ladder": {
            "bounds": list(bounds),
            "source": source,
            "steps": [
                _step_view(
                    step,
                    None if census is None else census.steps[index],
                    with_count=True,
                )
                for index, step in enumerate(ladder_steps)
            ],
        },
        "feed": {
            "what": (
                "When each learner last came, counted on their own calendar, and the step of the "
                "mail ladder that puts them on. Nobody is named."
            ),
            "from": (
                "learner.activity (migration 0034), written by learner.note_activity from the "
                "gateway: every signed-in turn and the app's own sessions and learning moments"
            ),
        },
        "at": at.astimezone(UTC).isoformat(),
    }


# --- the doors ------------------------------------------------------------------------------------
ACTIVITY_PATH = "/v1/me/activity"


class ActivityWrite(BaseModel):
    """What the app may say happened. The subject is the door's, the moment is the server's."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["session_start", "session_end", "module_finished", "topic_mastered", "progress"]
    session: str | None = Field(default=None, pattern=UUID_PATTERN)
    surface: Literal["pwa", "expo"] = "pwa"
    ref: str | None = Field(default=None, min_length=1, max_length=REF_MAX)
    title: str | None = Field(default=None, max_length=TITLE_MAX * 4)
    done: int | None = Field(default=None, ge=0, le=CARDS_MAX)
    total: int | None = Field(default=None, ge=0, le=CARDS_MAX)

    @model_validator(mode="after")
    def _what_each_kind_needs(self) -> ActivityWrite:
        if self.kind in SESSION_KINDS and not self.session:
            raise ValueError("a session start or end names its session")
        if self.kind not in SESSION_KINDS and not self.ref:
            raise ValueError("a learning moment names what it was about")
        return self


def register_activity(app: FastAPI) -> None:
    @app.post(ACTIVITY_PATH, status_code=204)
    def record_activity(body: ActivityWrite, request: Request) -> Response:
        """The app's half of the record: a session opened or closed, a card reported, a module
        finished, a topic mastered. Free, bounded on its own bucket, keyed on the verified
        subject, and never kept for an anonymous caller."""
        principal = request.state.principal
        if principal is None or principal.anonymous or not principal.subject:
            return Response(status_code=204)
        from wobo_gateway import allowance

        at = now()
        event = Event(
            kind=body.kind,
            at=at,
            zone=allowance.zone_name(request.state.meter_key),
            ref=body.ref or "",
            title=" ".join((body.title or "").split())[:TITLE_MAX],
            done=body.done,
            total=body.total,
            session=body.session or "",
            surface=body.surface,
        )
        try:
            get_store().note(principal.subject, event)
        except StoreUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "not_kept", "message": "I could not note that just now."},
            ) from exc
        _maybe_expire(at)
        return Response(status_code=204)


def register_activity_desk(app: FastAPI) -> None:
    """The console's two reads. Mounted after the door, behind the same guarded router."""
    router = admin_router(tags=["admin", "activity"])

    @router.get("/activity")
    def activity_desk(ctx: CanRead) -> dict[str, Any]:
        """How many learners came today, in seven days, in thirty, and how many sit on each step
        of the mail ladder. On the mail panel, because the ladder is the mail's. Counts only."""
        at = now()
        bounds, source = ladder()
        try:
            census: Census | None = get_store().census(at, bounds)
        except StoreUnavailable:
            census = None
        ctx.audit("console.activity.read", resource_type="activity", detail={"source": source})
        return desk_view(census, bounds, source, at)

    @router.get("/learners/activity")
    def learner_activity(
        ctx: Annotated[AdminContext, Depends(requires(LEARNER_READ))],
        id: str = Query(pattern=UUID_PATTERN),
    ) -> dict[str, Any]:
        """One learner's page: when they last came, days active this month, their streak and
        the mail step they sit on. On ``learner.read`` and its own line in the trail."""
        at = now()
        store = get_store()
        try:
            summary = store.get(id)
            days = store.days(id, since=at.date() - timedelta(days=32)) if summary else []
        except StoreUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "unreadable", "message": "The record could not be read."},
            ) from exc
        ctx.audit(
            "console.learner.activity",
            resource_type="learner",
            resource_id=id,
            detail={"found": summary is not None},
        )
        return learner_view(summary, id, days, at)

    app.include_router(router)


__all__ = [
    "ACTIVITY_PATH",
    "CARDS_MAX",
    "DAY_KEEP_DAYS",
    "HOURS_CEILING",
    "KINDS",
    "LADDER_BOUNDS",
    "MAX_MOMENTS",
    "SESSION_KEEP_DAYS",
    "STEPS",
    "TITLE_MAX",
    "Census",
    "Day",
    "Event",
    "InMemoryActivityStore",
    "Moment",
    "PostgrestActivityStore",
    "Progress",
    "Session",
    "Step",
    "StoreUnavailable",
    "Summary",
    "build_store",
    "fold",
    "from_row",
    "get_store",
    "ladder",
    "note_turn",
    "now",
    "register_activity",
    "register_activity_desk",
    "reset",
    "set_clock",
    "set_runner",
    "set_store",
    "step_for",
    "steps",
]
