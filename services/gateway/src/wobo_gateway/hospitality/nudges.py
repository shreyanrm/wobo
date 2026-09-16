"""The five nudges: a quick one, mid-chapter, the streak, a bonus level, your doubt.

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
5. **Never on a day they came**, and a learner who came three days this week hears nothing else
   this week but the Sunday note. THE ONE EXCEPTION, and it is named rather than hidden: the
   streak note, which exists because they came, is not a nudge to come back. Silencing it would
   make the three-days rule delete the mail that celebrates three days.
6. **The inbox law.** No address hears from Wobo twice in twenty-four hours, whatever the mail
   was about and whoever it was about (:func:`.jobs.gap_until` reads the log by address).
7. **Who it goes to.** Under thirteen, the mail goes to the parent, about the child, in the
   parent's register (``docs/legal/childrens-privacy.md`` §2). An age we do not know is treated
   as under thirteen: the conservative direction is the only defensible one when the product has
   no age field yet. A child with no parent on file is not mailed at all.
8. **Once only.** Every nudge carries what makes it unrepeatable (the chapter, the streak day,
   the doubt's id) and that becomes the idempotency period, so a cron that runs twice, or a
   source that yields the same thing tomorrow, does not send a second copy.

Sources. :class:`InMemoryNudges` is the suite's and a local run's. :class:`StoreNudges` reads
what the store can truthfully answer today (the days a learner came, from ``learner.meter_state``
— the same table the Sunday note's week comes from) and yields the two kinds that can be derived
from it. The other three are raised by the surfaces that know: a chapter left half done, a side
door opened, a photographed page answered. Nothing here guesses a fact it does not hold.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from fastapi import FastAPI, Request

from wobo_gateway.email import mail_log, send_email
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
#: Three days in a week and the week is theirs: nothing but the Sunday note (§1).
ENOUGH_DAYS = 3

#: The kinds whose whole purpose is to bring a learner back. The streak note is not one of them,
#: and the doubt answers a question the learner asked, so neither is silenced by a good week.
RETURN_NUDGES: frozenset[str] = frozenset({"quick_one", "mid_chapter", "bonus_level"})

#: THE CADENCE, which one-per-day was not. The inbox law caps a DAY, and a day cap is a licence
#: for thirty mails a month: driven with every surface raising its nudge, one lapsed learner's
#: parent got thirteen mails on thirteen of fourteen days and not one of the rules below stopped
#: it. ``came_enough`` silences only the learner who came three days this week, so the ENGAGED
#: family was capped and the LAPSED one was not, which is exactly backwards from the parent's
#: chair: the family hearing from us most was the one showing least interest in hearing from us.
#: Two a week, counted by ADDRESS over a rolling seven days and across every nudge kind, because
#: what a parent experiences is an inbox and not a taxonomy.
WEEKLY_NUDGE_CAP = 2
NUDGE_WEEK = timedelta(days=7)

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
    #: The last day they came in, on their own clock.
    last_seen: date | None = None
    #: How many days they have come in this week. Three is enough (§1).
    days_this_week: int = 0


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
    stop = stop_link(learner.learner_id, nudge.kind)
    if stop:
        data["unsubscribe_url"] = stop
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
    # SUNDAY BELONGS TO THE NOTE. The nudge window opens at eight in the morning and the default
    # hour is four in the afternoon; the Sunday note is pinned to six in the evening. So on any
    # Sunday where any nudge was due, the nudge took the address's one twenty-four-hour slot
    # hours before the note was even eligible, and the note — the single mail §1 guarantees a
    # family, and the one thing a learner who came three days running still gets — was dropped.
    # Driven with the clock handed in: a learner who came once got thirteen mails in fourteen
    # days and ZERO Sunday notes. A nudge is never the reason a family loses their note.
    if local.weekday() == jobs.SUNDAY:
        return {"ok": False, "error": "sunday_note_first"}
    if learner.last_seen is not None and learner.last_seen >= local.date():
        return {"ok": False, "error": "came_today"}
    if nudge.kind in RETURN_NUDGES and learner.days_this_week >= ENOUGH_DAYS:
        return {"ok": False, "error": "came_enough"}
    if nudge.kind in NEEDS_A_DESTINATION and destination(nudge, at=moment) is None:
        # The mail says a card is waiting. If we cannot say which, we do not say it.
        return {"ok": False, "error": "no_destination"}

    where = recipient(learner)
    if where is None:
        return {"ok": False, "error": "no_recipient"}
    to, audience = where
    gap = jobs.gap_until(to, moment)
    if gap is not None:
        return {"ok": False, "error": "gap", "next_at": gap.isoformat()}
    if mail_log().sent_to_since(to, moment - NUDGE_WEEK, kinds=NUDGE_KINDS) >= WEEKLY_NUDGE_CAP:
        return {"ok": False, "error": "weekly_cap"}

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
    feed = source if source is not None else StoreNudges()
    report = jobs._report(moment, dry_run)
    for nudge in feed.due(at=moment):
        report["checked"] += 1
        if dry_run:
            # The same rules, but the send itself is replaced by a count, so an operator can ask
            # "who is due tonight" without anybody's inbox finding out.
            probe = send_nudge(nudge, now=moment, send=lambda *a, **k: {"ok": True, "dry": True})
            if probe.get("ok"):
                report["due"] += 1
                report["would_send"] += 1
            else:
                jobs._skip(report, str(probe.get("error") or "held"))
            continue
        result = send_nudge(nudge, now=moment, send=send)
        if result.get("ok") or result.get("queued"):
            report["due"] += 1
            jobs._count_result(report, result)
        elif result.get("duplicate"):
            report["duplicate"] += 1
        else:
            jobs._skip(report, str(result.get("error") or "held"))
    logger.info("hospitality: nudges pass", extra={"fields": report})
    return report


# --- the source the store can actually answer ---------------------------------------------------
class StoreNudges:
    """The two kinds derivable from what the gateway holds today, and nothing invented.

    ``learner.meter_state`` carries one row per learner per active day (it is what
    :class:`.jobs.PostgrestWeek` reads), which answers "when did they last come" and "how many
    days in a row", and those are exactly the quick one and the streak. Mid-chapter, the side
    door and the answered doubt depend on progress, the arcade and the doubt store, and they are
    raised by those surfaces through :func:`send_nudge` rather than guessed at here.
    """

    #: The streak days §1 names, and no others: three, seven, thirty.
    MILESTONES: tuple[int, ...] = (3, 7, 30)
    #: The quiet stretch that earns a quick one.
    QUIET_DAYS = 2

    def __init__(self, families: jobs.FamilySource | None = None) -> None:
        self._families = families

    def due(self, *, at: datetime) -> Iterable[Nudge]:
        source = self._families if self._families is not None else jobs.PostgrestFamilies()
        week = jobs.PostgrestWeek()
        out: list[Nudge] = []
        for family in source.linked_families():
            learner = Learner(
                learner_id=family.learner_id,
                name=family.learner_name or "",
                parent_email=family.parent_email or "",
                timezone=family.timezone or "",
            )
            end = at.date()
            try:
                facts = week.week(family.learner_id, start=end - timedelta(days=30), end=end) or {}
            except Exception as exc:  # a week we cannot read is a week we do not act on
                logger.warning("nudges: week unreadable", extra={"fields": {"error": str(exc)}})
                continue
            days = facts.get("days") if isinstance(facts.get("days"), list) else []
            active = sorted({str(d) for d in days})
            last = date.fromisoformat(active[-1]) if active else None
            learner = replace(
                learner,
                last_seen=last,
                days_this_week=sum(
                    1 for d in active if date.fromisoformat(d) > end - timedelta(days=7)
                ),
            )
            if last is not None and (end - last).days >= self.QUIET_DAYS:
                out.append(
                    Nudge(
                        kind="quick_one",
                        learner=learner,
                        once_key=f"since-{last.isoformat()}",
                        data={},
                    )
                )
            run = _streak_length(active, end)
            if run in self.MILESTONES:
                out.append(
                    Nudge(
                        kind="streak",
                        learner=learner,
                        once_key=f"{run}-{end.isoformat()}",
                        data={"days": run},
                        hour=FIRST_HOUR,
                    )
                )
        return out


def _streak_length(active_days: list[str], end: date) -> int:
    """How many days in a row ending yesterday or today. Zero when the run is broken."""
    if not active_days:
        return 0
    have = {date.fromisoformat(d) for d in active_days}
    cursor = end if end in have else end - timedelta(days=1)
    run = 0
    while cursor in have:
        run += 1
        cursor -= timedelta(days=1)
    return run


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
