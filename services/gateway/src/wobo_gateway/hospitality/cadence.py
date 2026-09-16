"""The weekly cadence: what each address is owed, and what each learner has earned (wave 56).

docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence" (the owner, 2026-09-16, revised the same day):
*"we can honestly send more emails with a minimum of 3 a week depending on user behaviour and
streak ... we need to constantly remind people that we exist and we are doing good for them."*

THE FLOOR. Every reachable address hears from Wobo at least three times in any seven days
(:data:`FLOOR`, the first step of ``activity.STEPS``). When nothing the learner did has earned a
mail, the gap is filled with GOOD NEWS about their own work: the ``learning_note``, which says one
true thing from the activity record (what they cracked, what comes next, the days they learned,
what is waiting) and never the same thing twice.

THE EXTRAS. Behaviour earns more, on the full cadence only: a streak about to break (and a streak
milestone, the morning after), a chapter nearly done, a quiet spell measured against the
learner's own rhythm. The ceiling is the inbox law's one a day, which ``nudges.send_nudge`` and
the mail log already hold. A "come back" mail waits until the learner's usual hour has passed
(:data:`GRACE_HOURS`), because at the hour itself it lands fifteen minutes before they do.

THE LADDER DOWN, NEVER TO ZERO. By days since the learner last came, the step of
``activity.step_for`` (the ``mail.ladder`` dial) is both floor and ceiling below the full cadence:
two a week, one a week, one a fortnight, then one a month for as long as the address is
reachable. Coming back restores the full cadence at once, because the step is read from the day
they last came, every pass. Every mail on the way down says what is waiting for them.

WHAT STOPS IT. The family: each kind's own link, "Stop all of these" and "None at all"
(``tokens.AUDIENCES``), and the signed-in "stop everything". And the two things the law and Gmail
require: a spam complaint or a hard bounce suppresses that address, and a kind whose complaint
rate crosses the line is paused on its own (``wobo_gateway.mailwatch``). A dial that is off or a
kind that is paused is a candidate that is never offered. The signal that the mail is working is
whether the learner came back (the activity record), never an open pixel, a click rewrite or a
utm.

WHAT IT IS FOR. The learner's learning, and nothing else: DPDP Act 2023 s.9(3) bars behavioural
monitoring of a child for any other purpose, so the record is read here only to write the
learner's own mail about their own work.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta, tzinfo

from wobo_gateway import activity
from wobo_gateway.email import (
    NOT_A_SEND,
    address_is_suppressed,
    idempotency_key,
    kind_is_off,
    kind_is_paused,
    mail_log,
)
from wobo_gateway.email_templates import CADENCE_LINES
from wobo_gateway.hospitality import jobs, nudges
from wobo_gateway.hospitality.festivals import get_calendar
from wobo_gateway.hospitality.nudges import Learner, Nudge
from wobo_gateway.hospitality.preferences import MailPreferences

logger = logging.getLogger("wobo.gateway.hospitality")

#: The owner's floor: at least three in any seven days. The first step of the ladder.
FLOOR: activity.Step = activity.STEPS[0]
#: What every note's footer says about how often, on the full cadence and below it.
FOOTER_FULL = CADENCE_LINES["full"]
FOOTER_AWAY = CADENCE_LINES["away"]

#: A "come back" mail waits this long after the latest hour the learner starts a day in...
GRACE_HOURS = 2
#: ...and never goes before this hour, whatever their rhythm: a learner who has only ever started
#: in the morning may still start after school, and six leaves them the afternoon.
COMEBACK_FROM = 18
#: On the floor's last day and the day before it, nothing is planned later than this hour. The
#: inbox gap is measured by the hour (``nudges.hour_start``), so a mail at the day's last hour
#: makes the next day's first possible hour eight at night, which is no hour at all.
FLOOR_DAY_LAST_HOUR = nudges.LAST_HOUR - 2
#: On the eve of a day that belongs to another mail (a festival wish, the Sunday note), nothing
#: is planned later than the hour before that mail's own: its twenty-four hours must have run
#: before its first pass, whatever second the pass begins on.
EVE_LAST_HOUR = jobs.NOTE_HOUR - 1
#: A chapter with this many cards or fewer left is nearly done.
NEARLY_LEFT = 3
#: A run this long, alive yesterday and not yet today, is a streak about to break.
STREAK_AT_LEAST = 3
#: The streak days §1 names, celebrated the morning after.
STREAK_MILESTONES: tuple[int, ...] = (3, 7, 30)
#: A quiet spell is at least this many days, and longer for a learner whose rhythm is longer...
QUIET_DAYS = 2
#: ...but never longer than a week, so a learner with one long gap is still noticed.
QUIET_CAP_DAYS = 7
#: How far back the learner's rhythm is read.
RHYTHM_DAYS = 28
#: A moment this recent is still news.
FRESH_DAYS = 7
#: Mail the ladder does not count or hold: the festival wish is the family's own calendar.
NOT_COUNTED: frozenset[str] = frozenset({"wish"})

GOOD_NEWS = "learning_note"


# --- the rules, each one function a test hands a clock to ---------------------------------------
def spacing(step: activity.Step) -> int:
    """Whole days between two mails on this step: two on the full cadence, three at two a week."""
    return max(1, step.per_days // step.mails)


def _window_start(step: activity.Step, today: date, since: date | None) -> date:
    start = today - timedelta(days=step.per_days - 1)
    return max(start, since) if since is not None else start


def floor_deadline(
    step: activity.Step, sent: Iterable[date], today: date, *, since: date | None = None
) -> date:
    """The last day the next mail can go with every window of the step still holding its number.

    Any ``per_days`` in a row must hold ``mails``. So the next mail is due no later than
    ``per_days`` after the ``mails``-th most recent one: the window that opens the day after that
    one holds only the ones since, and needs this one to be whole. With fewer mails than that on
    record (a new address, or a step just begun on ``since``), the first window is the one to
    fill, and the remaining mails need a day each. And a window that reaches back past the day
    the step began still holds its number, so the mails before ``since`` bound the deadline too
    (2026-09-16: a family stepping down to one a month went thirty-one days without a note).
    """
    everything = sorted(d for d in sent if d < today)
    counted = [d for d in everything if since is None or d >= since]
    if len(counted) >= step.mails:
        return counted[-step.mails] + timedelta(days=step.per_days)
    first = since if since is not None else (counted[0] if counted else today)
    owed = step.mails - len(counted)
    deadline = first + timedelta(days=step.per_days - owed)
    if since is not None and len(everything) >= step.mails:
        deadline = min(deadline, everything[-step.mails] + timedelta(days=step.per_days))
    return deadline


Blocked = Callable[[date], bool]


def last_day(
    step: activity.Step,
    sent: Iterable[date],
    today: date,
    *,
    since: date | None = None,
    blocked: Blocked | None = None,
) -> tuple[date, date]:
    """The deadline, and the last day the next mail can actually go on: the deadline itself, or
    the nearest day before it that is not blocked (a quiet day, a festival wish's day, a Sunday
    the note is coming on), never earlier than today."""
    deadline = floor_deadline(step, sent, today, since=since)
    day = deadline
    while blocked is not None and day > today and blocked(day):
        day -= timedelta(days=1)
    return deadline, day


def floor_due(
    step: activity.Step,
    sent: Iterable[date],
    today: date,
    *,
    since: date | None = None,
    tomorrow_blocked: bool = False,
    blocked: Blocked | None = None,
) -> bool:
    """Is this address owed a mail today, on this step?

    Owed on the last day it can go (:func:`last_day`): its deadline, or the nearest day before
    that nothing else holds (2026-09-16: a quiet day on the deadline left a week with two and a
    month with none). On the full cadence, owed a usable day earlier still, so a day lost to
    anything the calendar cannot foresee leaves one more. Before that, owed at the step's pace:
    when it has heard fewer than the step's number in its window and the last mail was at least
    :func:`spacing` days ago, which is what keeps a week at three spread over it rather than
    three on Monday and silence after. ``since`` is the day the learner stepped onto this step,
    so a week of the full cadence does not starve the first week of the next step.
    """
    days = sorted(d for d in sent if d <= today)
    if today in days:
        return False
    tomorrow = today + timedelta(days=1)

    def unusable(day: date) -> bool:
        return (tomorrow_blocked and day == tomorrow) or (blocked is not None and blocked(day))

    _, last = last_day(step, days, today, since=since, blocked=unusable)
    if step.id == FLOOR.id:
        slack = last - timedelta(days=1)
        while slack > today and unusable(slack):
            slack -= timedelta(days=1)
        last = slack
    if today >= last:
        return True
    start = _window_start(step, today, since)
    if sum(1 for d in days if start <= d) >= step.mails:
        return False
    return not days or (today - days[-1]).days >= spacing(step)


def over_the_step(
    step: activity.Step, sent: Iterable[date], today: date, *, since: date | None = None
) -> bool:
    """Below the full cadence, the step is a ceiling too. On the full cadence the ceiling is the
    inbox law's one a day, which the mail log holds by itself."""
    if step.id == FLOOR.id:
        return False
    start = _window_start(step, today, since)
    return sum(1 for d in sent if start <= d <= today) >= step.mails


def step_of(learner: Learner) -> activity.Step:
    """The step a learner sits on, from the days since they last came and the ladder dial. A
    source that cannot say how long they have been away gets the full cadence."""
    return activity.step_for(learner.days_away if learner.days_away is not None else 0)


def step_began(learner: Learner, step: activity.Step, today: date) -> date | None:
    """The day the learner stepped onto ``step``, or None on the full cadence."""
    if step.id == FLOOR.id or learner.days_away is None:
        return None
    return today - timedelta(days=max(0, learner.days_away - step.since))


def sent_days(to: str, zone: tzinfo | None, *, since: date) -> list[date]:
    """The days, on the family's calendar, this address heard from us from ``since`` on."""
    where = zone or UTC
    floor = datetime.combine(since, time.min, tzinfo=where).astimezone(UTC)
    out: list[date] = []
    for record in mail_log().sent_to(to, since=floor):
        if record.kind in NOT_COUNTED:
            continue
        out.append(datetime.fromisoformat(record.sent_at).astimezone(where).date())
    return out


def comeback_hour(latest: int | None) -> int | None:
    """When a "come back" mail may go: two hours after the latest hour the learner starts a day
    in, or ``None`` when there is no such hour today.

    A "come back" mail never goes on a day the learner came, and a mail at their hour lands
    fifteen minutes before they do. So it waits until they would have come; and a learner who
    starts too late for that to fall inside the hours law, or whose hour is not known yet, is
    sent none at all (2026-09-16: learners who come after six were sent one most evenings, just
    before they arrived). They still hear the good news the floor is made of.
    """
    if latest is None:
        return None
    hour = max(COMEBACK_FROM, int(latest) + GRACE_HOURS)
    return hour if hour <= nudges.LAST_HOUR - 1 else None


def earliest_hour(to: str, day: date, zone: tzinfo) -> int | None:
    """The first hour of ``day`` whose start is a whole inbox gap after the last mail to ``to``,
    or ``None`` when no hour of that day is (``nudges.hour_start`` is what the send path checks)."""
    latest = mail_log().latest_to(to)
    if latest is None:
        return 0
    latest = latest if latest.tzinfo else latest.replace(tzinfo=UTC)
    opens = (latest + jobs.INBOX_GAP).astimezone(zone)
    if opens.date() < day:
        return 0
    if opens.date() > day:
        return None
    on_the_hour = opens == opens.replace(minute=0, second=0, microsecond=0)
    hour = opens.hour if on_the_hour else opens.hour + 1
    return hour if hour < 24 else None


def floor_hour(usual: int | None) -> int:
    """When good news may go: the hour they usually learn, else four in the afternoon."""
    base = nudges.DEFAULT_HOUR if usual is None else int(usual)
    return max(nudges.FIRST_HOUR, min(nudges.LAST_HOUR - 1, base))


def quiet_after(visits: Iterable[date]) -> int:
    """How many days away is a quiet spell for this learner: longer than the longest gap in
    their own recent rhythm, at least :data:`QUIET_DAYS`, never more than a week. Monday,
    Wednesday and Friday is a rhythm; Friday to Monday is not a quiet spell."""
    days = sorted(set(visits))
    longest = max(((b - a).days for a, b in zip(days, days[1:], strict=False)), default=0)
    return min(QUIET_CAP_DAYS, max(QUIET_DAYS, longest + 1))


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")[:48] or "one"


def _card(progress: activity.Progress) -> dict[str, str]:
    """Where the button lands: the course, and the card after the last one done."""
    card = max(1, min(progress.done + 1, progress.total))
    return {"course_id": progress.ref, "card_id": str(card)}


# --- what a learner earned ------------------------------------------------------------------------
def _extras(
    learner: Learner,
    summary: activity.Summary,
    visits: Sequence[date],
    today: date,
    moment: datetime,
) -> list[Nudge]:
    away = learner.days_away or 0
    later = comeback_hour(learner.latest_hour)
    out: list[Nudge] = []
    run = summary.current_streak(moment)
    if away == 1 and run >= STREAK_AT_LEAST:
        began = today - timedelta(days=run)
        if run in STREAK_MILESTONES:
            # The milestone, the morning after: days that happened, said back.
            out.append(
                Nudge(
                    kind="streak",
                    learner=learner,
                    once_key=f"milestone-{run}-{began.isoformat()}",
                    data={"days": run, "angle": "milestone"},
                    hour=nudges.FIRST_HOUR,
                )
            )
        elif later is not None:
            # A run about to break: once for the whole run, and only once they would have come.
            out.append(
                Nudge(
                    kind="streak",
                    learner=learner,
                    once_key=f"keep-{began.isoformat()}",
                    data={"days": run, "angle": nudges.STREAK_KEEP},
                    hour=later,
                )
            )
    progress = summary.progress
    if later is None:
        return out
    if progress is not None and away >= 1 and 0 < progress.left <= NEARLY_LEFT:
        out.append(
            Nudge(
                kind="mid_chapter",
                learner=learner,
                once_key=f"{_slug(progress.ref)}-{progress.done}-of-{progress.total}",
                data={"chapter": progress.title, "cards_left": progress.left, **_card(progress)},
                hour=later,
            )
        )
    if progress is not None and progress.left > 0 and away >= quiet_after(visits):
        out.append(
            Nudge(
                kind="quick_one",
                learner=learner,
                once_key=f"since-{summary.last_came_on.isoformat()}",
                data={"chapter": progress.title, **_card(progress)},
                hour=later,
            )
        )
    return out


# --- what an address is owed ----------------------------------------------------------------------
def _good_news(
    learner: Learner,
    summary: activity.Summary | None,
    days: Sequence[activity.Day],
    today: date,
    step: activity.Step,
    to: str,
    moment: datetime,
) -> Nudge | None:
    """The first true thing about the learner's own work that this address has not been told."""
    offers: list[tuple[str, str, dict[str, object]]] = []
    progress = summary.progress if summary is not None else None
    if summary is not None and step.id == FLOOR.id:
        fresh = moment - timedelta(days=FRESH_DAYS)
        for found in summary.moments:
            if found.title and found.at >= fresh:
                offers.append(
                    (
                        "cracked",
                        f"cracked-{found.kind}-{_slug(found.ref)}-{found.at.date().isoformat()}",
                        {"moment": found.kind, "title": found.title},
                    )
                )
        if progress is not None and progress.left > 0 and progress.title:
            offers.append(
                (
                    "next",
                    f"next-{_slug(progress.ref)}-{progress.done}-of-{progress.total}",
                    {
                        "title": progress.title,
                        "done": progress.done,
                        "cards_left": progress.left,
                        **_card(progress),
                    },
                )
            )
        week = today - timedelta(days=FLOOR.per_days - 1)
        learned = len({d.day for d in days if d.units > 0 and week <= d.day <= today})
        if learned >= 2:
            year, number, _ = today.isocalendar()
            offers.append(("days", f"days-{year}-W{number:02d}", {"days": learned}))
    waiting: dict[str, object] = {}
    if progress is not None and progress.left > 0 and progress.title:
        waiting = {
            "title": progress.title,
            "done": progress.done,
            "cards_left": progress.left,
            **_card(progress),
        }
    # What is waiting is often the same fact for weeks, so it is said a different way each time
    # (2026-09-16: one sentence went eight times in a month, twice on consecutive days). The
    # template holds the ways; this counts how many this learner has been sent.
    told = waiting_told(learner.learner_id, moment)
    offers.append(("waiting", f"waiting-{told}", {**waiting, "variant": told}))
    for angle, key, facts in offers:
        period = f"{GOOD_NEWS}:{key}"
        if mail_log().seen(idempotency_key(GOOD_NEWS, to, period, learner_id=learner.learner_id)):
            continue
        return Nudge(kind=GOOD_NEWS, learner=learner, once_key=key, data={"angle": angle, **facts})
    return None


def waiting_told(learner_id: str, moment: datetime) -> int:
    """How many "what is waiting" notes about this learner have actually gone."""
    since = moment - timedelta(days=activity.DAY_KEEP_DAYS)
    return sum(
        1
        for record in mail_log().recent(learner_id, GOOD_NEWS, since=since)
        if record.provider_id not in NOT_A_SEND
        and record.period.split(":", 1)[-1].startswith("waiting-")
    )


def _wish_prefs(family: jobs.Family, prefs: MailPreferences) -> MailPreferences:
    """The dials as the wish job reads them: the link's zone when the family gave none."""
    if not prefs.timezone and family.timezone.strip():
        return replace(prefs, timezone=family.timezone.strip())
    return prefs


def _wish_pending(
    family: jobs.Family, prefs: MailPreferences, moment: datetime, local: datetime, to: str
) -> bool:
    """Is a festival wish still to go to this address today? A wish day belongs to the wish: a
    note sent first would take the day's one slot and the wish would be lost."""
    if jobs.wish_recipient(family).strip().lower() != to.strip().lower():
        return False
    decision = get_calendar().decide(
        _wish_prefs(family, prefs),
        moment,
        last_email_at=mail_log().latest_to(to),
        confirmed=jobs.confirmed_festivals(local.date()),
    )
    wish = decision.wish
    if wish is None or not (decision.send_now or decision.send_after is not None):
        return False
    period = f"{wish.festival_id}:{wish.day.isoformat()}"
    return (
        mail_log().seen(idempotency_key("wish", to, period, learner_id=family.learner_id)) is None
    )


def _wish_on(
    family: jobs.Family, prefs: MailPreferences, day: date, zone: tzinfo, to: str
) -> bool:
    """Is ``day`` a wish's day at this address? Then it belongs to the wish, and a floor that
    falls due on it is kept earlier, because that day's one slot is the wish's."""
    if jobs.wish_recipient(family).strip().lower() != to.strip().lower():
        return False
    noon = datetime.combine(day, time(12), tzinfo=zone)
    decision = get_calendar().decide(
        _wish_prefs(family, prefs),
        noon.astimezone(UTC),
        confirmed=jobs.confirmed_festivals(day),
    )
    return decision.wish is not None


def plan(
    family: jobs.Family,
    summary: activity.Summary | None,
    days: Sequence[activity.Day],
    *,
    at: datetime,
) -> list[Nudge]:
    """This family's candidates for this pass, most earned first, the floor last.

    Every candidate still meets every rule in :func:`.nudges.send_nudge`; the pass sends the
    first that goes and offers the family nothing more today. Nothing is planned for a family
    whose dials cannot be read, whose locality is unknown, who can be reached by no address, or
    whom no record places at all.
    """
    prefs = jobs.dials(family.learner_id)
    if prefs is None or prefs.unsubscribed:
        return []
    moment = at.astimezone(UTC)
    zone_hint = family.timezone.strip()
    if not zone_hint and summary is not None and summary.timezone != "UTC":
        zone_hint = summary.timezone
    calendar = get_calendar()
    local = jobs.family_local(prefs, moment, fallback_zone=zone_hint, calendar=calendar)
    if local is None:
        return []
    today = local.date()
    if summary is not None:
        # On the family's own calendar, whatever zone the record was kept in (2026-09-16: every
        # record was kept in UTC, and a child who learned at 00:40 had "come" the day before).
        last_came = max(
            summary.last_came_on if summary.timezone == zone_name(local) else date.min,
            summary.last_came_at.astimezone(local.tzinfo).date(),
        )
    elif family.invited_at is not None and family.invited_at <= moment:
        # The record starts empty for a learner who has not come since it began. The invite is
        # a day they were certainly here, and a truer place to start than either end of the
        # ladder.
        last_came = family.invited_at.astimezone(local.tzinfo).date()
    else:
        return []
    visits = sorted({d.day for d in days if d.day <= today})
    week = today - timedelta(days=FLOOR.per_days - 1)
    # The Sunday note's week runs Monday to Sunday, and a week with no learning sends no note
    # (``jobs.compose_week``). On Saturday its evening is held for it whatever the week held,
    # because the learner may still come before Sunday evening.
    monday = today - timedelta(days=today.weekday())
    note_on = bool(
        family.sunday_note
        and prefs.allows("sunday_note")
        and not calendar.is_quiet_day(prefs.country, monday + timedelta(days=jobs.SUNDAY))
    )
    learned_this_week = any(d.units > 0 and monday <= d.day <= today for d in days)
    learner = Learner(
        learner_id=family.learner_id,
        name=family.learner_name or "",
        email=family.learner_email or "",
        parent_email=family.parent_email or "",
        under_13=family.under_13,
        timezone=zone_hint,
        usual_hour=summary.usual_hour() if summary is not None else None,
        latest_hour=summary.latest_hour() if summary is not None else None,
        last_seen=last_came if summary is not None else None,
        days_this_week=sum(1 for d in visits if d >= week),
        days_away=max(0, (today - last_came).days),
        sunday_note_expected=note_on
        and (learned_this_week or today.weekday() == jobs.SATURDAY),
    )
    where = nudges.recipient(learner)
    if where is None:
        return []
    to, audience = where
    # An address that complained or hard-bounced is planned nothing (mailwatch/events.py); the
    # send path would hold it anyway, and a plan it can never send only fills the pass report.
    if address_is_suppressed(to):
        return []
    if _wish_pending(family, prefs, moment, local, to):
        return []
    earliest = earliest_hour(to, today, local.tzinfo)
    if earliest is None or earliest > nudges.LAST_HOUR - 1:
        return []

    def allowed(kind: str) -> bool:
        # A kind the watch paused is a candidate never offered, exactly like one the family or the
        # superadmin switched off: the next one is offered instead, and the floor still holds.
        return prefs.allows(kind) and not kind_is_off(kind) and not kind_is_paused(kind)

    to_parent = audience == "parent"
    wishes: dict[date, bool] = {}

    def wish_day(day: date) -> bool:
        if day not in wishes:
            wishes[day] = _wish_on(family, prefs, day, local.tzinfo, to)
        return wishes[day]

    def blocked(day: date) -> bool:
        """A day the cadence cannot send on at this address."""
        if calendar.is_quiet_day(prefs.country, day):
            return True
        if day.weekday() == jobs.SUNDAY and to_parent and note_on and learned_this_week:
            return day - today < timedelta(days=7)
        return day != today and wish_day(day)

    step = step_of(learner)
    # Twice the step's days: the deadline reads back to the step's number-th most recent mail.
    history = sent_days(to, local.tzinfo, since=today - timedelta(days=2 * step.per_days))
    began = step_began(learner, step, today)
    deadline, last = last_day(step, history, today, since=began, blocked=blocked)

    # THE LAST HOUR ANYTHING IS PLANNED IN, TODAY (2026-09-16). The inbox gap runs by the hour,
    # so a mail at the day's last hour makes tomorrow's first possible hour eight at night. On the
    # floor's last day and the day before it, and on the eve of a day that belongs to a wish or
    # the Sunday note, a mail goes early enough that the next day keeps an hour.
    latest = nudges.LAST_HOUR - 1
    if today >= last - timedelta(days=1):
        latest = min(latest, FLOOR_DAY_LAST_HOUR)
    tomorrow = today + timedelta(days=1)
    if wish_day(tomorrow) or (
        to_parent and learner.sunday_note_expected and today.weekday() == jobs.SATURDAY
    ):
        latest = min(latest, EVE_LAST_HOUR)

    out: list[Nudge] = []
    if step.id == FLOOR.id and summary is not None:
        for extra in _extras(learner, summary, visits, today, moment):
            hour = max(extra.hour or floor_hour(learner.usual_hour), earliest)
            if allowed(extra.kind) and hour <= latest:
                out.append(replace(extra, hour=hour))
    forced = last < deadline and today >= last
    if (
        allowed(GOOD_NEWS)
        and floor_due(step, history, today, since=began, blocked=blocked)
        and (forced or not over_the_step(step, history, today, since=began))
    ):
        note = _good_news(learner, summary, days, today, step, to, moment)
        if note is not None:
            # Good news goes at their hour (earlier on a day that must leave the next one an
            # hour), but never ahead of an extra still to come today: the extra would find the
            # day's one slot taken, and it is the mail that was earned.
            hour = max(min(floor_hour(learner.usual_hour), latest), earliest)
            hour = max([hour, *(n.hour or 0 for n in out)])
            out.append(replace(note, hour=hour, floor_forced=forced and step.id != FLOOR.id))
    return out


def zone_name(local: datetime) -> str:
    """The IANA name of ``local``'s zone, or ``""``."""
    return str(getattr(local.tzinfo, "key", "") or "")


# --- the wired source -----------------------------------------------------------------------------
class CadenceNudges:
    """The families and their activity record, read once a pass, planned one family at a time.

    The families are the linked parents (``jobs.PostgrestFamilies``); the record is
    ``activity.get_store()``, read in one keyed batch. A record that cannot be read plans
    nothing: a default is not a family's week.
    """

    def __init__(
        self,
        families: jobs.FamilySource | None = None,
        store: activity.ActivityStore | None = None,
    ) -> None:
        self._families = families
        self._store = store

    def due(self, *, at: datetime) -> list[Nudge]:
        source = self._families if self._families is not None else jobs.PostgrestFamilies()
        store = self._store if self._store is not None else activity.get_store()
        families = list(source.linked_families())
        if not families:
            return []
        moment = at.astimezone(UTC)
        try:
            summaries = store.many([f.learner_id for f in families])
        except activity.StoreUnavailable:
            logger.warning("cadence: the activity record is unreadable, nobody is planned")
            return []
        out: list[Nudge] = []
        for family in families:
            summary = summaries.get(family.learner_id)
            days: list[activity.Day] = []
            if summary is not None:
                since = moment.date() - timedelta(days=RHYTHM_DAYS + 1)
                try:
                    days = store.days(family.learner_id, since=since)
                except activity.StoreUnavailable:
                    logger.warning("cadence: a learner's days are unreadable, skipped")
                    continue
            try:
                out.extend(plan(family, summary, days, at=moment))
            except Exception as exc:  # noqa: BLE001 — one family's bad row is not the pass's
                logger.warning("cadence: a family could not be planned (%s)", type(exc).__name__)
        return out


__all__ = [
    "FLOOR",
    "FOOTER_AWAY",
    "FOOTER_FULL",
    "COMEBACK_FROM",
    "GRACE_HOURS",
    "NEARLY_LEFT",
    "QUIET_CAP_DAYS",
    "QUIET_DAYS",
    "RHYTHM_DAYS",
    "STREAK_AT_LEAST",
    "STREAK_MILESTONES",
    "CadenceNudges",
    "comeback_hour",
    "floor_deadline",
    "floor_due",
    "floor_hour",
    "over_the_step",
    "plan",
    "quiet_after",
    "sent_days",
    "spacing",
    "step_began",
    "step_of",
]
