"""The hospitality mail jobs (WOBO-PLAN §14.1): the Sunday note, the welcome, the win, the wish.

Four jobs, one rule each:

* **The Sunday note** goes to every linked parent whose weekly-summaries switch is on, at 6 pm
  on Sunday in the family's own time zone. The week is built from what the store actually
  holds and from the existing weekly summary capability (``generate.digest``); a number we do not
  have is a tile that is not drawn, and a week with nothing in it is skipped in silence (the
  spec: we do not report absence to a parent). A family whose locality we do not know gets
  nothing — §14.1 rule 5, never a guess at the hour. One note per parent per learner per ISO
  week, ever: a parent of two learners is owed two notes.
* **The welcome** fires from the sign-up completion signal — the learner's first meeting with
  Wobo, which the client marks on the first turn — on a background thread that can never delay
  the turn. The address is the one the verified token carries, never one the client typed.
* **The win** is sent for real milestones only (a chapter mastered, the first week complete, a
  streak of fourteen with rest days counted), never for a streak alone under fourteen, at most
  one per learner per seven days, never in the learner's quiet hours, and never twice for the
  same milestone.
* **The wish** is the festival greeting: the calendar's rule engine (:mod:`.festivals`) decides,
  for one family on one morning, whether a day applies — locality first, the family's own
  choice for anything religious or cultural, a real date, one a day — and this job sends the
  gated line in Wobo's hand. A festival that moves with the moon waits for that day's
  confirmation in ``MAIL_CONFIRMED_FESTIVALS``.

Two clock rules the calendar owns and every job reads from it, so there is one definition of
night and one of a day to keep still: **quiet hours** (nothing between 20:00 and 08:00 on the
family's clock) and **quiet days** (a day of mourning or remembrance in the family's country —
the note and the win hold; a greetable wish still goes, alone). And one rule about the inbox:
**no address hears from Wobo twice in twenty-four hours** — every job checks the mail log for
the last send to that address, whatever it was about.

Every send is recorded in :func:`wobo_gateway.email.mail_log`, so nothing is ever sent twice.
The Sunday and wish jobs run from ``POST /v1/internal/mail/sunday`` and
``POST /v1/internal/mail/wishes`` behind the internal shared key — there is no in-process
scheduler in this gateway, so a Railway cron hits them hourly and the family's clock plus the
idempotency key decide who is due.

No person is ever called by a regional kinship word here: "your parent", "your family", or the
name the family gave us (§14.1 rule 4, §20). Wobo has no pronoun (§19).
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
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from wobo_gateway.email import (
    account_email,
    idempotency_key,
    mail_log,
    require_internal_key,
    send_email,
    to_hash,
)
from wobo_gateway.hospitality import copy as copy_gate
from wobo_gateway.hospitality.festivals import Calendar, get_calendar
from wobo_gateway.hospitality.preferences import (
    DEFAULT_PREFERENCES,
    MailPreferences,
    StoreUnavailable,
    preferences_for,
)
from wobo_gateway.hospitality.tokens import stop_link

logger = logging.getLogger("wobo.gateway.hospitality")

Send = Callable[..., dict[str, Any]]

SATURDAY = 5  # datetime.weekday()
SUNDAY = 6
NOTE_HOUR = 18  # 6 pm, the family's own clock
# A cron that missed the hour (a deploy, a pause) still sends the same evening — the idempotency
# key stops a second copy — but never at or after eight (the hours law, docs/EMAILS-AND-
# ANIMATIONS.md), and never on Monday morning. It was three hours, to nine, until 2026-09-16.
NOTE_WINDOW_HOURS = 2
WIN_GAP_DAYS = 7
STREAK_MILESTONE_DAYS = 14
# No inbox hears from Wobo twice in a day (the calendar's law: "never within twenty-four hours
# of another email"). Read from the mail log by address, whatever the mail was about.
INBOX_GAP = timedelta(hours=24)

_HTTP_TIMEOUT_S = 5.0
_SCHEMA = "learner"


# --- the families ---------------------------------------------------------------------
@dataclass(frozen=True)
class Family:
    """One linked parent and the learner they are linked to."""

    learner_id: str
    learner_name: str
    parent_email: str
    #: IANA zone ("Asia/Kolkata"). Empty or unknown means the locality is unknown: nothing sends.
    timezone: str = ""
    #: The parent's "weekly summaries" switch.
    sunday_note: bool = True
    parent_name: str = ""
    #: Per-recipient links (tokened); the configured defaults apply when empty.
    unsubscribe_url: str = ""
    preferences_url: str = ""
    #: The learner's own address, when the product holds one (it does not yet: the profile row
    #: carries none). Empty means the learner is not written to directly.
    learner_email: str = ""
    #: ``None`` when the product cannot say, which today is always: there is no age field. The
    #: nudges treat an unknown age as under thirteen and write to the parent.
    under_13: bool | None = None
    #: When the learner sent the invite, so a moment they were certainly here. The cadence places
    #: a family the activity record has not seen yet by it (``hospitality/cadence.py``).
    invited_at: datetime | None = None


class FamilySource(Protocol):
    def linked_families(self) -> Iterable[Family]: ...


class InMemoryFamilies:
    """Tests and local development."""

    def __init__(self, families: Iterable[Family] = ()) -> None:
        self._families = tuple(families)

    def linked_families(self) -> Iterable[Family]:
        return self._families


def _postgrest(table: str, query: dict[str, str]) -> list[dict[str, Any]] | None:
    """One service-role read from the ``learner`` schema. ``None`` when unconfigured or refused —
    the caller treats both as "nobody", never as an error to raise into a cron."""
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not base or not key:
        return None
    encoded = urllib.parse.urlencode(query, quote_via=urllib.parse.quote)
    url = f"{base.rstrip('/')}/rest/v1/{urllib.parse.quote(table)}?{encoded}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": _SCHEMA,
    }
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
            rows = json.loads(response.read().decode() or "[]")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning(
            "hospitality: store read failed", extra={"fields": {"table": table, "error": str(exc)}}
        )
        return None
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else None


class LinkedFamilies:
    """The parent links as the gateway writes them: the ``linked`` rows of
    ``learner.parent_links`` (migration 0011, :mod:`wobo_gateway.parents`), read through the same
    store seam the routes use — the project over PostgREST, or the in-memory store of a local
    run. A link is a family only while it holds an address; the Sunday switch is the family's
    dial in the mail preferences, which :func:`run_sunday` reads for every family, so every link
    starts with it on. A link's zone is the fallback when the family's dials carry none."""

    def linked_families(self) -> Iterable[Family]:
        from wobo_gateway import parents

        try:
            links = parents.get_store().linked()
        except parents.StoreUnavailable:
            logger.warning("hospitality: parent links unavailable, nobody is due")
            return []
        return [
            Family(
                learner_id=link.learner_id,
                learner_name=link.learner_name or "",
                parent_email=link.parent_email or "",
                timezone=link.timezone or "",
                unsubscribe_url=link.unsubscribe_url or "",
                invited_at=link.invited_at,
            )
            for link in links
            if link.parent_email and "@" in link.parent_email and link.learner_id
        ]


# The cron doors' tests patch this name; the store behind it is whatever is configured.
PostgrestFamilies = LinkedFamilies


# --- the week -------------------------------------------------------------------------
class WeekSource(Protocol):
    def week(self, learner_id: str, *, start: date, end: date) -> dict[str, Any]: ...


class NoWeek:
    """Nothing known: every week is empty, so nothing sends. The honest default."""

    def week(self, learner_id: str, *, start: date, end: date) -> dict[str, Any]:
        return {}


class PostgrestWeek:
    """What the store can truthfully say about a week today: the days the learner showed up,
    from ``learner.meter_state`` (one row per active day). Lessons and problems are not
    ledgered server-side yet, so those tiles stay undrawn rather than guessed."""

    def week(self, learner_id: str, *, start: date, end: date) -> dict[str, Any]:
        rows = _postgrest(
            "meter_state",
            {
                "select": "date,budget_consumed,day_had_real_win",
                "subject_id": f"eq.{learner_id}",
                "date": f"gte.{start.isoformat()}",
                "limit": "31",
            },
        )
        if rows is None:
            return {}
        active = {
            str(row.get("date"))
            for row in rows
            if str(row.get("date") or "") <= end.isoformat()
            and (row.get("budget_consumed") or 0) > 0
        }
        if not active:
            return {}
        return {
            "days_active": len(active),
            "days_of": (end - start).days + 1,
            "real_wins": sum(1 for row in rows if row.get("day_had_real_win") is True),
        }


Digest = Callable[[str, dict[str, Any]], dict[str, Any] | None]

_DIGEST_KEYS = (
    "headline",
    "headline_topic",
    "one_line_summary",
    "note",
    "note_accent",
    "note_after",
    "worth_saying",
    "lessons_note",
    "problems_note",
    "days_note",
)

_gateway: Any = None
_gateway_lock = threading.Lock()


def gateway_digest(learner_name: str, facts: dict[str, Any]) -> dict[str, Any] | None:
    """The existing weekly summary capability — ``generate.digest`` through the brain's own door,
    fed only the facts we hold. Its lines become the note; a failure means no note, never a
    made-up one."""
    global _gateway
    try:
        from wobo_gateway.app import CapabilityRequest, build_gateway

        with _gateway_lock:
            if _gateway is None:
                _gateway = build_gateway()
        payload = {"learner": learner_name, "period": "week", "facts": facts, "audience": "parent"}
        output = _gateway.invoke("generate.digest", CapabilityRequest(payload=payload)).output
    except Exception as exc:  # the digest is optional; the Sunday note is not
        logger.warning("hospitality: digest unavailable", extra={"fields": {"error": str(exc)}})
        return None
    if not isinstance(output, dict):
        return None
    lines = {k: str(output[k]).strip() for k in _DIGEST_KEYS if isinstance(output.get(k), str)}
    summary = output.get("summary")
    if "note" not in lines and isinstance(summary, str) and summary.strip():
        lines["note"] = summary.strip()
    return lines or None


def compose_week(
    family: Family,
    facts: dict[str, Any],
    digest: Digest | None,
    *,
    stamp: str = "Sunday, 6 pm",
) -> dict[str, Any] | None:
    """The Sunday note's data, or ``None`` when there is nothing true to say.

    Numbers are copied only when the source gave them; the digest may add words, never
    numbers. An empty week — no lessons, no problems, no active day — is not dressed up. Every
    digest line passes the copy gate (:func:`.copy.digest_violations`) before it is placed in
    Wobo's hand: a kinship word, a pronoun for Wobo, an exclamation mark or an emoji from the
    model drops that line, never ships it.
    """
    data: dict[str, Any] = {
        "learner_name": family.learner_name or "your child",
        "parent_name": family.parent_name,
        "stamp": stamp,
    }
    if family.unsubscribe_url:
        data["unsubscribe_url"] = family.unsubscribe_url
    if family.preferences_url:
        data["preferences_url"] = family.preferences_url
    substance = 0
    for key in ("lessons", "problems", "days_active", "days_of"):
        value = facts.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            data[key] = value
            if key != "days_of":
                substance += value
    for key in ("lessons_note", "problems_note", "days_note"):
        if isinstance(facts.get(key), str) and facts[key].strip():
            data[key] = facts[key].strip()
    if substance == 0:
        return None
    if digest is not None:
        lines = digest(data["learner_name"], dict(facts)) or {}
        for key in _DIGEST_KEYS:
            value = lines.get(key)
            if not isinstance(value, str) or not value.strip() or key in data:
                continue
            problems = copy_gate.digest_violations(value.strip())
            if problems:
                logger.info(
                    "hospitality: a digest line was dropped",
                    extra={"fields": {"line": key, "problems": problems}},
                )
                continue
            data[key] = value.strip()
    return data


# --- the dials (hospitality/preferences.py) -----------------------------------------------
def dials(learner_id: str) -> MailPreferences | None:
    """The family's stored dials, the defaults when they never set any, ``None`` when the store
    cannot answer — and then nothing sends, because a default is not the family's choice."""
    try:
        return preferences_for(learner_id) or DEFAULT_PREFERENCES
    except StoreUnavailable:
        logger.warning(
            "hospitality: preferences unavailable", extra={"fields": {"learner": learner_id}}
        )
        return None
    except Exception as exc:  # a store bug is still not a reason to mail a family
        logger.warning("hospitality: preferences unreadable", extra={"fields": {"error": str(exc)}})
        return None


def _stop_link(learner_id: str, audience: str, given: str = "") -> str:
    """The recipient's own one-click stop link for this audience: the one on the link row, else
    a freshly signed one, else empty (the template then uses the list-wide opt-out, and a live
    send is held until a link can be signed)."""
    return given or stop_link(learner_id, audience) or ""


# --- time, the family's own -------------------------------------------------------------
def family_local(
    prefs: MailPreferences, moment: datetime, *, fallback_zone: str = "", calendar: Calendar
) -> datetime | None:
    """``moment`` on the family's clock, or ``None`` when their locality is unknown or ambiguous
    (nothing sends). The zone is the family's own from the dials, else the one on the link row,
    else the country's where the country has exactly one; the calendar refuses a zone that
    disagrees with the country."""
    zone_name = prefs.timezone or (fallback_zone.strip() or None)
    zone = calendar.timezone_for(replace(prefs, timezone=zone_name), at=moment)
    return moment.astimezone(zone) if zone is not None else None


def stamp_for(local: datetime) -> str:
    """The moment as the design writes it: "Sunday, 6 pm", "Tuesday, 9:38 pm"."""
    hour = local.hour % 12 or 12
    half = "am" if local.hour < 12 else "pm"
    minutes = f":{local.minute:02d}" if local.minute else ""
    return f"{local:%A}, {hour}{minutes} {half}"


def note_period(local: datetime) -> str:
    """The ISO week of the local moment — one Sunday note per family per week."""
    year, week, _ = local.isocalendar()
    return f"{year}-W{week:02d}"


def sunday_note_due(local: datetime) -> bool:
    return local.weekday() == SUNDAY and NOTE_HOUR <= local.hour < NOTE_HOUR + NOTE_WINDOW_HOURS


def parent_gets_notes(family: Family) -> bool:
    """Do the learning notes about this learner come to the parent's address? Under thirteen,
    an age we do not know, or a learner with no address of their own: yes (``nudges.recipient``)."""
    from wobo_gateway.hospitality import nudges

    where = nudges.recipient(
        nudges.Learner(
            learner_id=family.learner_id,
            email=family.learner_email or "",
            parent_email=family.parent_email or "",
            under_13=family.under_13,
        )
    )
    return where is not None and where[1] == "parent"


def gap_until(to: str, moment: datetime) -> datetime | None:
    """When this address may next hear from us, or ``None`` when it may now: the last send to
    the address, whatever it was about, plus twenty-four hours."""
    latest = mail_log().latest_to(to)
    if latest is None:
        return None
    latest = latest if latest.tzinfo else latest.replace(tzinfo=UTC)
    return latest + INBOX_GAP if moment - latest < INBOX_GAP else None


def confirmed_festivals(day: date) -> frozenset[str]:
    """The moon-dated festivals a person has confirmed for exactly this day, from
    ``MAIL_CONFIRMED_FESTIVALS`` ("eid-al-fitr=2026-03-21,eid-al-adha=2026-05-27"). An entry
    for another date is not a confirmation for this one, so last year's setting never fires."""
    raw = (os.getenv("MAIL_CONFIRMED_FESTIVALS") or "").strip()
    out: set[str] = set()
    for entry in raw.split(","):
        festival, _, when = entry.strip().partition("=")
        if not festival or not when:
            continue
        try:
            confirmed_on = date.fromisoformat(when.strip())
        except ValueError:
            continue
        if confirmed_on == day:
            out.add(festival.strip())
    return frozenset(out)


def _report(moment: datetime, dry_run: bool) -> dict[str, Any]:
    return {
        "at": moment.isoformat(),
        "dry_run": dry_run,
        "checked": 0,
        "due": 0,
        "sent": 0,
        "queued": 0,
        "would_send": 0,
        "duplicate": 0,
        "failed": 0,
        "skipped": {},
    }


def _skip(report: dict[str, Any], reason: str) -> None:
    report["skipped"][reason] = report["skipped"].get(reason, 0) + 1


def _count_result(report: dict[str, Any], result: dict[str, Any]) -> None:
    if result.get("duplicate"):
        report["duplicate"] += 1
    elif result.get("error") == "suppressed":
        # The address complained or hard-bounced (mailwatch/events.py). Not a failure: the law.
        _skip(report, "suppressed")
    elif result.get("queued"):
        report["queued"] += 1
    elif result.get("ok"):
        report["sent"] += 1
    else:
        report["failed"] += 1


# --- job 1: the Sunday note ---------------------------------------------------------------
def run_sunday(
    now: datetime | None = None,
    *,
    families: FamilySource | None = None,
    week_source: WeekSource | None = None,
    digest: Digest | None = gateway_digest,
    send: Send = send_email,
    dry_run: bool = False,
) -> dict[str, Any]:
    """One pass over every linked family. Safe to run every hour: only the families whose clock
    says Sunday evening are due, and a family already noted this week is skipped by the log."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    gap_at_start: dict[str, datetime | None] = {}
    source = families if families is not None else PostgrestFamilies()
    weeks = week_source if week_source is not None else PostgrestWeek()
    calendar = get_calendar()
    report = _report(moment, dry_run)

    for family in source.linked_families():
        report["checked"] += 1
        prefs = dials(family.learner_id)
        if prefs is None:
            _skip(report, "prefs_unavailable")
            continue
        if not family.sunday_note or not prefs.allows("sunday_note"):
            _skip(report, "opted_out")
            continue
        local = family_local(prefs, moment, fallback_zone=family.timezone, calendar=calendar)
        if local is None:
            _skip(report, "no_locality")
            continue
        if not sunday_note_due(local):
            _skip(report, "not_due")
            continue
        report["due"] += 1
        if calendar.is_quiet_day(prefs.country, local.date()):
            _skip(report, "quiet_day")
            continue
        period = note_period(local)
        key = idempotency_key(
            "sunday_note", family.parent_email, period, learner_id=family.learner_id
        )
        if mail_log().seen(key):
            report["duplicate"] += 1
            continue
        # One reading of the inbox gap per address for the whole pass, taken BEFORE this pass
        # sends anything: two children with one parent address both get their note tonight,
        # and the twenty-four-hour rule still holds against everything sent before the pass.
        if family.parent_email not in gap_at_start:
            gap_at_start[family.parent_email] = gap_until(family.parent_email, moment)
        if gap_at_start[family.parent_email] is not None:
            _skip(report, "gap")
            continue
        end = local.date()
        start = end - timedelta(days=6)
        try:
            facts = weeks.week(family.learner_id, start=start, end=end) or {}
        except Exception as exc:  # a week we cannot read is a week we do not describe
            logger.warning("hospitality: week unreadable", extra={"fields": {"error": str(exc)}})
            facts = {}
        data = compose_week(family, facts, digest, stamp=stamp_for(local))
        if data is None:
            _skip(report, "empty_week")
            continue
        stop = _stop_link(family.learner_id, "sunday_note", family.unsubscribe_url)
        if stop:
            data["unsubscribe_url"] = stop
        # The footer says what else this address is sent, and offers the one tap that stops all
        # of it (2026-09-16: it said "nothing else comes" while three notes a week did).
        stop_all = stop_link(family.learner_id, "parent", to_parent=True)
        if stop_all:
            data["stop_all_url"] = stop_all
        data["parent_gets_notes"] = parent_gets_notes(family)
        if dry_run:
            report["would_send"] += 1
            continue
        result = send(
            "sunday_note",
            family.parent_email,
            data,
            learner_id=family.learner_id,
            period=period,
            at=moment,
        )
        _count_result(report, result)
    logger.info("hospitality: sunday pass", extra={"fields": report})
    return report


# --- job 2: the welcome ---------------------------------------------------------------------
def welcome_data(payload: dict[str, Any]) -> dict[str, Any]:
    """What the first-turn packet says about the learner, for the welcome. Board and class are
    the onboarding profile's; a missing one leaves the template's honest fallback in place."""
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    lifetime = context.get("lifetime") if isinstance(context.get("lifetime"), dict) else {}
    learner = lifetime.get("learner") if isinstance(lifetime.get("learner"), dict) else {}
    curriculum = context.get("curriculum") if isinstance(context.get("curriculum"), dict) else {}
    data: dict[str, Any] = {}
    name = str(learner.get("name") or "").strip()
    if name:
        data["name"] = name.split()[0][:40]
    board = str(learner.get("board") or curriculum.get("board") or "").strip()
    if board:
        data["board_short"] = board[:24]
    grade = str(learner.get("grade") or curriculum.get("grade") or "").strip()
    if grade:
        data["class_name"] = re.sub(r"(?i)^(class|grade|std\.?|standard)\s*", "", grade)[:16]
    subject = str(curriculum.get("subject") or curriculum.get("subjectName") or "").strip()
    if subject:
        data["subject"] = subject[:40].lower()
    chapter = str(curriculum.get("nodeName") or "").strip()
    if chapter:
        data["chapter"] = chapter[:80]
    return data


def send_welcome(
    *,
    learner_id: str,
    to: str,
    data: dict[str, Any] | None = None,
    now: datetime | None = None,
    send: Send = send_email,
) -> dict[str, Any]:
    """The welcome, once per learner: the period is fixed, so a replayed first turn is a no-op.

    The learner's own stop link rides along for the one-click header (the welcome itself is
    account mail with no off switch in its footer, but the header must name a real endpoint),
    and the stamp is the learner's local moment when the dials know their zone.
    """
    facts = dict(data or {})
    stop = _stop_link(learner_id, "learner", str(facts.get("unsubscribe_url") or ""))
    if stop:
        facts["unsubscribe_url"] = stop
    if "stamp" not in facts:
        prefs = dials(learner_id)
        if prefs is not None:
            local = family_local(prefs, (now or datetime.now(UTC)), calendar=get_calendar())
            if local is not None:
                facts["stamp"] = stamp_for(local)
    return send("welcome", to, facts, learner_id=learner_id, period="once")


def _in_background(target: Callable[[], Any]) -> None:
    threading.Thread(target=target, daemon=True, name="wobo-hospitality").start()


_runner: Callable[[Callable[[], Any]], None] = _in_background


def set_runner(runner: Callable[[Callable[[], Any]], None] | None) -> None:
    """Test seam: run background sends inline."""
    global _runner
    _runner = runner or _in_background


def welcome_after_first_meeting(principal: Any, payload: dict[str, Any]) -> bool:
    """The sign-up completion hook. Non-blocking: schedules the welcome and returns at once.

    Only a verified, non-anonymous token with an address on it qualifies — the address is the
    identity provider's claim, never a field the client put in the packet. Returns whether a
    send was scheduled; never raises into the turn.
    """
    try:
        if principal is None or getattr(principal, "anonymous", False):
            return False
        claims = getattr(principal, "claims", None) or {}
        to = str(claims.get("email") or "").strip()
        if "@" not in to:
            return False
        learner_id = str(getattr(principal, "subject", "") or "")
        data = welcome_data(payload)

        def go() -> None:
            try:
                send_welcome(learner_id=learner_id, to=to, data=data)
            except Exception:  # pragma: no cover - send_email never raises; belt and braces
                logger.warning(
                    "hospitality: welcome failed", extra={"fields": {"to_hash": to_hash(to)}}
                )

        _runner(go)
        return True
    except Exception as exc:  # never into the turn
        logger.warning("hospitality: welcome not scheduled", extra={"fields": {"error": str(exc)}})
        return False


# --- job 3: the win ---------------------------------------------------------------------------
REAL_MILESTONES = frozenset({"chapter_mastered", "first_week", "streak_14"})


def qualify_milestone(milestone: str, data: dict[str, Any]) -> str | None:
    """The milestone kind a win email may celebrate, or ``None``. A streak qualifies at fourteen
    days and not before; there is no such thing as a small-streak email."""
    kind = str(milestone or "").strip().lower()
    if kind in {"streak", "streak_14"}:
        try:
            days = int(data.get("days") or 0)
        except (TypeError, ValueError):
            days = 0
        return "streak_14" if days >= STREAK_MILESTONE_DAYS else None
    return kind if kind in REAL_MILESTONES else None


def _slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")[:60] or "one"


def send_win(
    *,
    learner_id: str,
    to: str,
    milestone: str,
    data: dict[str, Any] | None = None,
    timezone: str = "",
    now: datetime | None = None,
    send: Send = send_email,
) -> dict[str, Any]:
    """A win worth a line — with the frequency rule enforced before anything renders.

    The family's ``wins`` dial (and the one-click stop) is read first; ``timezone`` overrides
    the dials' zone. Quiet hours and quiet days apply when the learner's locality is known; when
    it is not, the win is sent, because a milestone is reached by the learner's own activity a
    moment ago — they are awake — and the once-a-week cap already bounds the volume. The inbox
    gap applies always. ``data`` may carry ``next_label``/``next_url`` (the next chapter from
    the curriculum) and ``then_line``/``note`` (the learner's own words back to them); nothing
    is invented for a field the caller did not give.
    """
    facts = dict(data or {})
    kind = qualify_milestone(milestone, facts)
    if kind is None:
        return {"ok": False, "error": "not_a_milestone", "milestone": milestone}
    prefs = dials(learner_id)
    if prefs is None:
        return {"ok": False, "error": "prefs_unavailable"}
    if not prefs.allows("wins"):
        return {"ok": False, "error": "opted_out"}
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    calendar = get_calendar()
    local = family_local(prefs, moment, fallback_zone=timezone, calendar=calendar)
    if local is not None:
        if calendar.in_quiet_hours(local):
            return {"ok": False, "error": "quiet_hours"}
        if calendar.is_quiet_day(prefs.country, local.date()):
            return {"ok": False, "error": "quiet_day"}
    recent = mail_log().recent(learner_id, "win", since=moment - timedelta(days=WIN_GAP_DAYS))
    if recent:
        latest = max(r.sent_at for r in recent)
        next_at = datetime.fromisoformat(latest) + timedelta(days=WIN_GAP_DAYS)
        return {"ok": False, "error": "too_soon", "next_at": next_at.isoformat()}
    gap = gap_until(to, moment)
    if gap is not None:
        return {"ok": False, "error": "gap", "next_at": gap.isoformat()}
    if kind == "chapter_mastered":
        period = f"{kind}:{_slug(facts.get('chapter_id') or facts.get('chapter'))}"
    elif kind == "streak_14":
        started = facts.get("streak_id") or facts.get("started_on") or moment.date()
        period = f"{kind}:{_slug(started)}"
    else:
        period = kind
    facts["milestone"] = kind
    if "stamp" not in facts and local is not None:
        facts["stamp"] = stamp_for(local)
    stop = _stop_link(learner_id, "learner", str(facts.get("unsubscribe_url") or ""))
    if stop:
        facts["unsubscribe_url"] = stop
    return send("win", to, facts, learner_id=learner_id, period=period)


# --- job 4: the wish ---------------------------------------------------------------------------
_DECISION_CODES: tuple[tuple[str, str], ...] = (
    ("unsubscribed", "opted_out"),
    ("switched off", "opted_out"),
    ("locality", "no_locality"),
    ("timezone", "no_locality"),
    ("nothing to wish", "nothing_today"),
    ("quiet hours", "quiet_hours"),
    ("another email", "gap"),
)


def _decision_code(reason: str) -> str:
    for needle, code in _DECISION_CODES:
        if needle in reason:
            return code
    return "held"


def wish_subject(line: str) -> str:
    """ "Happy Diwali" from "Happy Diwali. I hope the house is full of light tonight." — the
    first sentence of the gated line, which by the copy law names the day."""
    first = line.split(". ", 1)[0].strip()
    return first.rstrip(".") or line


def wish_recipient(family: Family) -> str:
    """Where the wish goes: the learner's own address when the profile holds one
    (``email.account_email`` — it does not yet), else the family's linked address. Either way it
    is an address the family gave us, never one guessed."""
    return account_email(family.learner_id) or family.parent_email


def run_wishes(
    now: datetime | None = None,
    *,
    families: FamilySource | None = None,
    send: Send = send_email,
    dry_run: bool = False,
) -> dict[str, Any]:
    """One pass over every family: the calendar decides (locality, choice, date, one a day,
    quiet hours, the inbox gap), this sends. Safe hourly: a wish already sent for that festival
    and day is a duplicate, and a wish held by quiet hours is picked up by the next run."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    source = families if families is not None else PostgrestFamilies()
    calendar = get_calendar()
    report = _report(moment, dry_run)

    for family in source.linked_families():
        report["checked"] += 1
        prefs = dials(family.learner_id)
        if prefs is None:
            _skip(report, "prefs_unavailable")
            continue
        if not prefs.allows("festivals"):
            _skip(report, "opted_out")
            continue
        if not prefs.timezone and family.timezone.strip():
            prefs = replace(prefs, timezone=family.timezone.strip())
        local = family_local(prefs, moment, calendar=calendar)
        if local is None:
            _skip(report, "no_locality")
            continue
        to = wish_recipient(family)
        decision = calendar.decide(
            prefs,
            moment,
            last_email_at=mail_log().latest_to(to),
            confirmed=confirmed_festivals(local.date()),
        )
        wish = decision.wish
        if wish is None:
            _skip(report, _decision_code(decision.reason))
            continue
        # The day's wish is known even when the clock says hold; if it already went (it is the
        # mail the gap is counting from), that is a duplicate, not a held send.
        period = f"{wish.festival_id}:{wish.day.isoformat()}"
        key = idempotency_key("wish", to, period, learner_id=family.learner_id)
        if mail_log().seen(key):
            report["duplicate"] += 1
            continue
        if not decision.send_now:
            _skip(report, _decision_code(decision.reason))
            continue
        report["due"] += 1
        line = wish.line(family.learner_name)
        data: dict[str, Any] = {
            "line": line,
            "subject": wish_subject(wish.line(None)),
            "festival_name": wish.name,
            "chosen_calendar": wish.chosen_calendar or "",
            "stamp": stamp_for(local),
        }
        if family.preferences_url:
            data["preferences_url"] = family.preferences_url
        # "None at all" stops what THIS address is sent: to a parent, everything about the child
        # (and about any sibling at the same address); to the learner's own address, their wins
        # and wishes. A parent's click never stops a child's mail, nor a child's a parent's.
        to_parent = to.strip().lower() == (family.parent_email or "").strip().lower()
        stop = (
            stop_link(family.learner_id, "parent", to_parent=True)
            if to_parent
            else _stop_link(family.learner_id, "learner")
        )
        if stop:
            data["unsubscribe_url"] = stop
        if dry_run:
            report["would_send"] += 1
            continue
        result = send("wish", to, data, learner_id=family.learner_id, period=period, at=moment)
        _count_result(report, result)
        logger.info(
            "hospitality: wish",
            extra={
                "fields": {
                    "festival": wish.festival_id,
                    "kind": wish.kind,
                    "calendar": wish.chosen_calendar,
                    "day": wish.day.isoformat(),
                    "ok": bool(result.get("ok")),
                }
            },
        )
    logger.info("hospitality: wishes pass", extra={"fields": report})
    return report


# --- the cron doors ------------------------------------------------------------------------
class RunRequest(BaseModel):
    #: The moment to evaluate against, ISO 8601 with offset. Absent: now. Lets an operator
    #: replay a missed evening without lying to the clock in the container.
    now: str | None = Field(default=None, max_length=40)
    dry_run: bool = False


SundayRunRequest = RunRequest


def _moment(body: RunRequest) -> datetime | None | str:
    """The clock the body names: ``None`` for now, a datetime, or ``"bad"`` when it is naive or
    unreadable — a guess at the offset is a guess at the family's evening."""
    if not body.now:
        return None
    try:
        moment = datetime.fromisoformat(body.now.replace("Z", "+00:00"))
    except ValueError:
        return "bad"
    return moment if moment.tzinfo is not None else "bad"


def register_hospitality(app: FastAPI) -> None:
    @app.post("/v1/internal/mail/sunday")
    def sunday(request: Request, body: RunRequest | None = None) -> dict[str, Any]:
        """The Sunday note pass. Hourly from a Railway cron; the family's clock decides who is
        due and the mail log makes a second run in the same hour a no-op."""
        require_internal_key(request)
        body = body or RunRequest()
        moment = _moment(body)
        if moment == "bad":
            return {"ok": False, "error": "bad_now"}
        report = run_sunday(moment, dry_run=body.dry_run)
        return {"ok": True, **report}

    # The five nudges of docs/EMAILS-AND-ANIMATIONS.md §1 mount their own door here, so the cron
    # has one place to call and this module stays the four hospitality jobs it was written for.
    # Imported inside the function because :mod:`.nudges` reads this module's clock and gap rules.
    from wobo_gateway.hospitality.nudges import register_nudges

    register_nudges(app)

    @app.post("/v1/internal/mail/wishes")
    def wishes(request: Request, body: RunRequest | None = None) -> dict[str, Any]:
        """The festival wish pass. Hourly from the same cron; the calendar decides, the log
        makes a second run a no-op, and quiet hours hold a wish for the next run."""
        require_internal_key(request)
        body = body or RunRequest()
        moment = _moment(body)
        if moment == "bad":
            return {"ok": False, "error": "bad_now"}
        report = run_wishes(moment, dry_run=body.dry_run)
        return {"ok": True, **report}
