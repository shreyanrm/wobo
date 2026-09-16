"""The learning notes: a quick one, mid-chapter, the streak, a bonus level, your doubt, and the
good-news note the weekly cadence fills its floor with.

``docs/EMAILS-AND-ANIMATIONS.md`` §1 is the design and ``docs/MAIL-PRIMARY.md`` is the law. The
templates are in :mod:`wobo_gateway.email_templates`; this module is the part that decides
whether a mail may go at all, and it is written so that every rule is one function a test can
hand a clock to.

The rules, in the order a nudge meets them:

1. **The dial.** Each kind is its own switch with its own one-click stop
   (:mod:`.preferences`, :mod:`.tokens`). A store that cannot answer sends nothing: a default is
   not a family's choice.
2. **Locality.** No zone, no mail. Never a guess at what hour it is where they are (§14.1 rule 5).
3. **The hours law.** At the hour they usually learn, else four in the afternoon; never before
   eight in the morning and never after eight at night, on their own clock. A pass that runs
   later the same day still sends, up to eight; after that the day is over.
4. **Quiet days.** A day of mourning where they are holds every nudge (the calendar decides).
   **The Sunday note's time** holds every nudge to the address it goes to: all of Sunday, and
   Saturday from six (:func:`sunday_note_first`).
5. **A "come back" mail never goes on a day they came**, and a learner who came three days this
   week gets no "come back" mail that week. The first gate holds every mail that asks for a
   return (:func:`asks_to_return`: the COME-BACK kinds, and the streak's "keep it going" form);
   the second holds the come-back kinds only, since a streak alive is days they came. Good news
   about the learner's own work may go on a day they came (the owner, 2026-09-16), and
   silencing it would make a good week delete the mail about it. When a come-back mail may go
   at all is the cadence's (``cadence.comeback_hour``): after the latest hour they start.
6. **The inbox law.** No address hears from Wobo twice in twenty-four hours, whatever the mail
   was about and whoever it was about (:func:`.jobs.gap_until` reads the log by address),
   measured from the start of the pass's hour (:func:`hour_start`), so a cron a few seconds
   early never decides whether a day gets its mail. That is the ceiling: one a day. Three a
   week is a FLOOR, kept by :mod:`.cadence`, and below the full cadence the step of the ladder
   is a ceiling too (the ``ladder`` hold), except for the floor's own mail on its last day.
7. **Who it goes to.** Under thirteen, the mail goes to the parent, about the child, in the
   parent's register (``docs/legal/childrens-privacy.md`` §2). An age we do not know is treated
   as under thirteen: the conservative direction is the only defensible one when the product has
   no age field yet. A child with no parent on file is not mailed at all.
8. **Once only.** Every nudge carries what makes it unrepeatable (the chapter, the streak day,
   the doubt's id) and that becomes the idempotency period, so a cron that runs twice, or a
   source that yields the same thing tomorrow, does not send a second copy.

Sources. :class:`InMemoryNudges` is the suite's and a local run's. The wired one is
:class:`.cadence.CadenceNudges`, which reads the activity record (migration 0034) and decides what
each address is owed and what each learner earned. Nothing here guesses a fact it does not hold.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from fastapi import FastAPI, Request

from wobo_gateway.email import send_email
from wobo_gateway.email_templates import NUDGE_KINDS, ORB_MOVES, brand_orb_url
from wobo_gateway.hospitality import jobs
from wobo_gateway.hospitality.festivals import get_calendar
from wobo_gateway.hospitality.links import card_link
from wobo_gateway.hospitality.tokens import stop_link

logger = logging.getLogger("wobo.gateway.hospitality")

#: The hour a nudge goes when we do not know the learner's own (§1: "or 4 pm local").
DEFAULT_HOUR = 16
#: Never before this hour, and never at or after that one, on the family's clock (the hours law).
FIRST_HOUR = 8
LAST_HOUR = 20
#: Three days in a week and the week is theirs: no "come back" mail that week (§1).
ENOUGH_DAYS = 3

#: The kinds whose whole purpose is to bring a learner back, and the only kinds the two
#: "they came" gates hold. The streak celebrates days that happened, the doubt answers a question
#: the learner asked, the side door is news about their own climb ("Optional" is in its first
#: line), and the good-news note is the learner's work said back: none of them asks for a return.
RETURN_NUDGES: frozenset[str] = frozenset({"quick_one", "mid_chapter"})
#: The streak note in its "keep it going" form: sent on a day the learner has not come yet, so it
#: is held by the "they came today" gate exactly as a come-back mail is (2026-09-16: an evening
#: learner who never missed a day was sent it nearly every evening, minutes before arriving).
#: The milestone the morning after celebrates days that happened and is not held.
STREAK_KEEP = "keep"


def asks_to_return(nudge: Nudge) -> bool:
    """Is this a mail that only makes sense to someone who has not come today?"""
    return nudge.kind in RETURN_NUDGES or (
        nudge.kind == "streak" and nudge.data.get("angle") == STREAK_KEEP
    )


#: THE CADENCE (the owner, 2026-09-16, revised the same day). Three a week was once a ceiling
#: here, counted by address over a rolling seven days. It is a FLOOR now, kept by :mod:`.cadence`;
#: the ceiling is the inbox law's one a day, and, for a learner away past the full cadence, the
#: step of the ladder (``activity.step_for``). What stops a lapsed family hearing from us every
#: day is that step, not a cap on the engaged.

#: The kinds whose own sentence names a card ("the next card is waiting", "two cards are left").
#: Design §4 is that the button lands on the exact card; without one these five fell back to
#: /learn, /doubt or the home page, so the mail promised a place and delivered a front door.
#: A nudge that cannot say where it goes is HELD rather than sent somewhere generic: the streak
#: is the one kind exempt, because it is about the days and home is where the days are.
NEEDS_A_DESTINATION: frozenset[str] = frozenset(
    {"quick_one", "mid_chapter", "bonus_level", "doubt"}
)


@dataclass(frozen=True)
class Learner:
    """Who a nudge is about, and everything the rules need to know about them.

    ``under_13`` is ``None`` when the product cannot say, which today is almost always: there is
    no age field (docs/legal/childrens-privacy.md §3 says so plainly). Unknown is treated as a
    child, so the mail goes to the parent.
    """

    learner_id: str
    name: str = ""
    #: The learner's own address, when the product holds one.
    email: str = ""
    #: The linked parent's address, when there is a link.
    parent_email: str = ""
    under_13: bool | None = None
    #: IANA zone. Empty means the locality is unknown, and nothing sends.
    timezone: str = ""
    #: The hour they usually learn, on their own clock. ``None`` means four in the afternoon.
    usual_hour: int | None = None
    #: The latest hour they have started a day in. A "come back" mail waits until it has passed
    #: (``cadence.comeback_hour``); ``None`` means it is not known yet, and none goes.
    latest_hour: int | None = None
    #: The last day they came in, on their own clock.
    last_seen: date | None = None
    #: How many days they have come in this week. Three is enough (§1).
    days_this_week: int = 0
    #: Whole days since they last came, on their own calendar: the step of the ladder they sit
    #: on (``activity.step_for``). ``None`` when the source cannot say, and then the full cadence.
    days_away: int | None = None
    #: Whether a Sunday note is on its way to the parent this week. A Sunday with no note coming
    #: is not a day to keep the parent's inbox empty for.
    sunday_note_expected: bool = True


@dataclass(frozen=True)
class Nudge:
    """One mail that might go: its kind, who it is about, what makes it once-only, its facts."""

    kind: str
    learner: Learner
    #: What must never repeat: the chapter id, the streak's day, the doubt's id.
    once_key: str
    data: dict[str, Any] = field(default_factory=dict)
    #: The hour this one wants, when the kind has an opinion (the streak goes in the morning).
    hour: int | None = None
    #: The floor's own mail on the last day it can go, below the full cadence: the step's
    #: ceiling yields to it, because one a month is the owner's bare minimum (``cadence.plan``).
    floor_forced: bool = False


class NudgeSource(Protocol):
    def due(self, *, at: datetime) -> Iterable[Nudge]: ...


class InMemoryNudges:
    """The suite's source, and the seam a surface hands a nudge to in a local run."""

    def __init__(self, nudges: Iterable[Nudge] = ()) -> None:
        self._nudges = tuple(nudges)

    def due(self, *, at: datetime) -> Iterable[Nudge]:
        return self._nudges


# The dials, the clock and the inbox gap are the Sunday note's, read from one place so there is
# one definition of each. jobs.py owns them because it was written first; they belong to the
# family, not to a kind.
dials = jobs.dials


def _target_hour(nudge: Nudge) -> int:
    if nudge.hour is not None:
        return max(FIRST_HOUR, min(LAST_HOUR - 1, nudge.hour))
    usual = nudge.learner.usual_hour
    if usual is None:
        return DEFAULT_HOUR
    return max(FIRST_HOUR, min(LAST_HOUR - 1, int(usual)))


def hour_start(local: datetime) -> datetime:
    """The start of ``local``'s hour, in UTC: what the inbox gap is measured against."""
    return local.replace(minute=0, second=0, microsecond=0).astimezone(UTC)


def sunday_note_first(local: datetime) -> bool:
    """Is this a moment that belongs to the Sunday note, at an address the note goes to?

    All of Sunday, because the nudge window opens at eight and the note's at six. And Saturday
    from the note's own hour, because a Saturday mail after six pushes Sunday's twenty-four hours
    past the note's first pass, and a pass a second or two late then loses the evening
    (2026-09-16: the note went at half past eight).
    """
    if local.weekday() == jobs.SUNDAY:
        return True
    return local.weekday() == jobs.SATURDAY and local.hour >= jobs.NOTE_HOUR


def in_the_hours(nudge: Nudge, local: datetime) -> bool:
    """The hours law: at their hour or after it, never before eight, never at eight at night.

    A window rather than one hour because the cron runs hourly and a deploy, a pause or a queue
    can eat an hour. A window that ended at the target hour would mean a missed pass is a missed
    day, and a window with no end would mean a nudge at midnight.
    """
    return _target_hour(nudge) <= local.hour < LAST_HOUR and local.hour >= FIRST_HOUR


def recipient(learner: Learner) -> tuple[str, str] | None:
    """Where this mail goes and in whose register, or ``None`` when it may not be sent at all.

    Under thirteen (and an age we do not know is under thirteen) it is the parent's address and
    the parent's register. Otherwise the learner's own address; and if the product does not hold
    one, the parent's, because a linked parent is an address the family gave us for exactly this.
    """
    child = learner.under_13 is not False
    if child:
        return (learner.parent_email, "parent") if learner.parent_email else None
    if learner.email:
        return (learner.email, "learner")
    return (learner.parent_email, "parent") if learner.parent_email else None


def destination(nudge: Nudge, *, at: datetime) -> str | None:
    """The signed link to the exact card this nudge is about, or ``None`` when there is none.

    One definition, read by the rule that HOLDS a nudge with no destination and by the facts
    handed to the template, so the mail a reader gets and the rule that let it go can never
    disagree about where the button points.
    """
    course_id = str(nudge.data.get("course_id") or "").strip()
    card_id = str(nudge.data.get("card_id") or "").strip()
    if not (course_id and card_id):
        return None
    return card_link(nudge.learner.learner_id, course_id, card_id, issued=at)


def _facts(nudge: Nudge, audience: str, *, at: datetime) -> dict[str, Any]:
    """What the template is given: the kind's own facts, who is reading, and the two links."""
    learner = nudge.learner
    data: dict[str, Any] = {
        k: v for k, v in nudge.data.items() if k not in {"course_id", "card_id"}
    }
    data["audience"] = audience
    data["learner_name"] = learner.name
    if audience == "learner":
        data["name"] = learner.name
    # Which footer sentence is true of this send: the full cadence, or a step below it.
    from wobo_gateway.hospitality import cadence

    data["cadence"] = "full" if cadence.step_of(learner).id == cadence.FLOOR.id else "away"
    # The move this kind carries, and the picture of it. ``orb_move`` was written here and read
    # by nothing; ``orb_url`` was read by the template and written by nothing, so the two halves
    # of the owner's whole brief — one animated character doing one thing — never met and not a
    # single mail carried an orb. They meet here. The URL is empty until the seed test has
    # measured what an image does to our placement, which is the law's own gate on shipping it.
    move = ORB_MOVES[nudge.kind]
    data["orb_move"] = move
    orb = brand_orb_url(move)
    if orb:
        data["orb_url"] = orb
    link = destination(nudge, at=at)
    if link:
        data["cta_url"] = link
    to_parent = audience == "parent"
    stop = stop_link(learner.learner_id, nudge.kind, to_parent=to_parent)
    if stop:
        data["unsubscribe_url"] = stop
    # "Stop all of these": everything this address is sent about this learner, in one tap. For a
    # parent, who has no account to sign in to, it reaches every child of theirs whose notes come
    # to the same address; for a learner, it is their own notes, wins and wishes and nobody
    # else's (hospitality/tokens.py).
    stop_all = stop_link(
        learner.learner_id, "parent" if to_parent else "learner_all", to_parent=to_parent
    )
    if stop_all:
        data["stop_all_url"] = stop_all
    return data


def send_nudge(
    nudge: Nudge,
    *,
    now: datetime | None = None,
    send: Callable[..., dict[str, Any]] = send_email,
) -> dict[str, Any]:
    """One nudge, against every rule. Returns the send's result, or the reason it did not go.

    Never raises: a rule that cannot be checked is a mail that does not go, and neither is an
    error for a cron to fall over on.
    """
    if nudge.kind not in NUDGE_KINDS:
        return {"ok": False, "error": "not_a_nudge", "kind": nudge.kind}
    learner = nudge.learner
    prefs = dials(learner.learner_id)
    if prefs is None:
        return {"ok": False, "error": "prefs_unavailable"}
    if not prefs.allows(nudge.kind):
        return {"ok": False, "error": "opted_out"}

    moment = (now or datetime.now(UTC)).astimezone(UTC)
    calendar = get_calendar()
    local = jobs.family_local(
        prefs, moment, fallback_zone=learner.timezone, calendar=calendar
    )
    if local is None:
        return {"ok": False, "error": "no_locality"}
    if not in_the_hours(nudge, local):
        return {"ok": False, "error": "not_the_hour"}
    if calendar.is_quiet_day(prefs.country, local.date()):
        return {"ok": False, "error": "quiet_day"}
    where = recipient(learner)
    if where is None:
        return {"ok": False, "error": "no_recipient"}
    to, audience = where
    # SUNDAY BELONGS TO THE NOTE. The nudge window opens at eight in the morning and the note is
    # pinned to six in the evening, so a nudge to the PARENT on a Sunday took the address's one
    # twenty-four-hour slot before the note was even eligible, and the note was dropped. The hold
    # is for the address the note goes to, in a week it is coming: a learner's own inbox is not
    # the note's, and a week with nothing to report sends no note to wait for.
    if audience == "parent" and learner.sunday_note_expected and sunday_note_first(local):
        return {"ok": False, "error": "sunday_note_first"}
    if asks_to_return(nudge):
        if learner.last_seen is not None and learner.last_seen >= local.date():
            return {"ok": False, "error": "came_today"}
        if nudge.kind in RETURN_NUDGES and learner.days_this_week >= ENOUGH_DAYS:
            return {"ok": False, "error": "came_enough"}
    if nudge.kind in NEEDS_A_DESTINATION and destination(nudge, at=moment) is None:
        # The mail says a card is waiting. If we cannot say which, we do not say it.
        return {"ok": False, "error": "no_destination"}

    # THE INBOX GAP, BY THE HOUR (2026-09-16). Measured from the start of this pass's hour, not
    # from the second the pass began: a cron a few seconds earlier than yesterday's used to find
    # the gap a few seconds short, lose that hour, and at the day's last hour lose the day (and
    # with it the floor). From the hour's start, a mail the day after a mail goes at least one
    # hour later, whatever the seconds say, so the cadence can plan for it and never guess.
    gap = jobs.gap_until(to, hour_start(local))
    if gap is not None:
        return {"ok": False, "error": "gap", "next_at": gap.isoformat()}
    # Below the full cadence the step is a ceiling as well as a floor (the ladder down), except
    # for the floor's own mail on the last day it can go (``cadence.plan`` says so).
    from wobo_gateway.hospitality import cadence

    step = cadence.step_of(learner)
    if not nudge.floor_forced and cadence.over_the_step(
        step,
        cadence.sent_days(to, local.tzinfo, since=local.date() - timedelta(days=step.per_days)),
        local.date(),
        since=cadence.step_began(learner, step, local.date()),
    ):
        return {"ok": False, "error": "ladder"}

    period = f"{nudge.kind}:{nudge.once_key}"
    return send(
        nudge.kind,
        to,
        _facts(nudge, audience, at=moment),
        learner_id=learner.learner_id,
        period=period,
        at=moment,
    )


def run_nudges(
    now: datetime | None = None,
    *,
    source: NudgeSource | None = None,
    send: Callable[..., dict[str, Any]] = send_email,
    dry_run: bool = False,
) -> dict[str, Any]:
    """One pass over everything a source says is due. Safe to run every hour.

    Nothing is lost by running it again: the hours law holds what is early, the log refuses what
    already went, and the inbox gap refuses what would be a second mail today.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    if source is None:
        from wobo_gateway.hospitality.cadence import CadenceNudges

        source = CadenceNudges()
    report = jobs._report(moment, dry_run)
    # One mail per address per pass. The log refuses a second inside a day anyway; this keeps a
    # pass honest when its send does not write the log (a dry run, a recorder), and it is what
    # lets the cadence offer each family its candidates in order and stop at the first that goes.
    heard: set[str] = set()
    for nudge in source.due(at=moment):
        report["checked"] += 1
        where = recipient(nudge.learner)
        if where is not None and where[0].strip().lower() in heard:
            jobs._skip(report, "one_a_day")
            continue
        if dry_run:
            # The same rules, but the send itself is replaced by a count, so an operator can ask
            # "who is due tonight" without anybody's inbox finding out.
            probe = send_nudge(nudge, now=moment, send=lambda *a, **k: {"ok": True, "dry": True})
            if probe.get("ok"):
                report["due"] += 1
                report["would_send"] += 1
                if where is not None:
                    heard.add(where[0].strip().lower())
            else:
                jobs._skip(report, str(probe.get("error") or "held"))
            continue
        result = send_nudge(nudge, now=moment, send=send)
        if result.get("ok") or result.get("queued"):
            report["due"] += 1
            jobs._count_result(report, result)
            # A duplicate went on an earlier day, so it takes nothing from today's slot and the
            # family's next candidate is still offered.
            if result.get("ok") and not result.get("duplicate") and where is not None:
                heard.add(where[0].strip().lower())
        elif result.get("duplicate"):
            report["duplicate"] += 1
        else:
            jobs._skip(report, str(result.get("error") or "held"))
    logger.info("hospitality: nudges pass", extra={"fields": report})
    return report


# --- the cron door --------------------------------------------------------------------------------
def register_nudges(app: FastAPI) -> None:
    @app.post("/v1/internal/mail/nudges")
    def nudges(request: Request, body: jobs.RunRequest | None = None) -> dict[str, Any]:
        """The nudge pass. Hourly from the same cron as the Sunday note and the wishes: the
        family's clock decides who is due, and the mail log makes a second run a no-op."""
        jobs.require_internal_key(request)
        body = body or jobs.RunRequest()
        moment = jobs._moment(body)
        if moment == "bad":
            return {"ok": False, "error": "bad_now"}
        report = run_nudges(moment, dry_run=body.dry_run)
        return {"ok": True, **report}
