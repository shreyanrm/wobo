"""The hospitality calendar and the rule engine behind a festival wish (WOBO-PLAN §14.1, §20).

The data is ``content/hospitality/festivals.json`` — a sourced calendar with a ``rule_engine``
block that maps every festival to a *kind* (``civic``, ``seasonal``, ``religious``), the
calendars a family can choose it under, and ISO codes for its regions. This module reads that
block once and answers one question: for THIS learner on THIS day, which wish applies?

The rules, in the order they are checked:

1. **Locality first.** The learner's country must be one the festival is kept in, and the date
   entry's scope (``all``, a country, a subdivision) must cover the learner. A festival tagged to
   regions needs the learner's region to match. A learner with no country gets nothing.
2. **Kind.** ``civic`` and ``seasonal`` days follow locality and need no choice. ``religious``
   (religious *and* cultural) days are sent only when the family chose one of the festival's
   calendars in their mail preferences. Nothing is ever inferred from a name, a language, a
   board or a place. A chosen *community* calendar (Malayali, Bengali, ...) also stands in for
   the region, so a Malayali family in Dubai is wished on Onam.
3. **The date is real.** Only a date with a sendable confidence (official, official_reported,
   derived — or conventional where a human has checked it by name) is used, only on its first
   day, only where the entry says ``greet: true``. A festival that moves with the moon waits for
   that day's confirmation, whatever its stored date.
4. **One wish a day.** Where two apply, the family's own calendar wins, then the more specific
   scope, then the regional over the national.
5. **Timing.** Never inside another email's twenty-four hours; never in the family's quiet hours,
   read in the family's own timezone (or the country's, where the country has one).
6. **The line.** Plain English that names the day and wishes well, gated by :mod:`.copy`. A line
   that fails the gate is dropped, never sent.

Everything degrades to *nothing sends* — a missing file, an unknown locality, a date that could
not be sourced. Silence is invisible; a wrong wish is not.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from wobo_gateway.hospitality import copy as copy_gate
from wobo_gateway.hospitality.preferences import MailPreferences

logger = logging.getLogger("wobo.gateway.hospitality")

KINDS: tuple[str, ...] = ("civic", "seasonal", "religious")
#: Night on the family's clock. It began at nine until 2026-09-16, and a wish held all day by the
#: inbox gap then went at half past eight; the hours law is never after eight.
_DEFAULT_QUIET = ("20:00", "08:00")
_GAP = timedelta(hours=24)


def content_dir() -> Path:
    """Where the calendar lives. The image sets ``WOBO_HOSPITALITY_CONTENT``; a checkout walks
    up to ``content/hospitality``."""
    override = os.getenv("WOBO_HOSPITALITY_CONTENT")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[5] / "content" / "hospitality"


@dataclass(frozen=True)
class Occasion:
    """One dated entry of one festival, exactly as the file has it."""

    festival_id: str
    on: date
    end: date | None
    scope: str
    label: str | None
    greet: bool
    greeting: str | None  # the entry's own line, already gated (None if it failed or is absent)
    confidence: str


@dataclass(frozen=True)
class Festival:
    id: str
    name: str
    aliases: tuple[str, ...]
    tradition: str
    kind: str
    requires_opt_in: bool
    countries: frozenset[str]
    region_codes: frozenset[str]
    calendars: frozenset[str]
    community_calendars: frozenset[str]
    requires_confirmation: bool
    quiet_day: bool
    wish: str | None  # the rule_engine line, gated
    example: str | None  # greeting_style.example, gated
    occasions: tuple[Occasion, ...]


@dataclass(frozen=True)
class QuietDay:
    id: str
    name: str
    countries: frozenset[str]
    dates: frozenset[date]


@dataclass(frozen=True)
class Wish:
    """The one wish that applies. ``text`` still carries ``{name}``; see :meth:`line`."""

    festival_id: str
    name: str
    day: date
    text: str
    kind: str
    scope: str
    label: str | None
    chosen_calendar: str | None

    def line(self, name: str | None = None) -> str:
        """The line with the learner's name in, or the clause dropped cleanly without one."""
        given = (name or "").strip()
        if given:
            return self.text.replace("{name}", given)
        text = self.text
        for pattern in (", {name}", "{name}, ", " {name}", "{name}"):
            text = text.replace(pattern, "")
        return text


@dataclass(frozen=True)
class Decision:
    """What the job should do right now for one learner."""

    wish: Wish | None
    send_now: bool
    reason: str
    local_day: date | None = None
    send_after: datetime | None = None


def _parse_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_time(value: Any, fallback: str) -> time:
    try:
        return time.fromisoformat(str(value or fallback))
    except ValueError:
        return time.fromisoformat(fallback)


def _gated(text: Any, *, where: str) -> str | None:
    """A line the gate lets through, else None (with the reason logged once, at load)."""
    if not isinstance(text, str) or not text.strip():
        return None
    problems = copy_gate.wish_violations(text)
    if problems:
        logger.info(
            "hospitality: a greeting line is not sendable",
            extra={"fields": {"where": where, "problems": problems}},
        )
        return None
    return text.strip()


class Calendar:
    """The parsed calendar plus the rule engine. Build with :func:`load_calendar`."""

    def __init__(self, data: dict[str, Any] | None) -> None:
        data = data or {}
        rules: dict[str, Any] = data.get("rule_engine") or {}
        self.present = bool(data.get("festivals"))
        self.kind_by_tradition: dict[str, str] = dict(rules.get("kind_by_tradition") or {})
        self.kind_overrides: dict[str, str] = dict(rules.get("kind_overrides") or {})
        self.country_groups: dict[str, list[str]] = {
            k: list(v) for k, v in (rules.get("country_groups") or {}).items()
        }
        self.region_aliases: dict[str, str] = dict(rules.get("region_aliases") or {})
        self.scope_aliases: dict[str, list[str]] = {
            k: list(v) for k, v in (rules.get("scope_aliases") or {}).items()
        }
        self.send_confidences: frozenset[str] = frozenset(rules.get("send_confidences") or ())
        self.human_checked: frozenset[str] = frozenset(
            (rules.get("human_checked_conventional") or {}).keys()
        )
        # Festivals the file cannot yet wish correctly (the reason sits beside each id).
        self.suppressed: frozenset[str] = frozenset((rules.get("suppressed") or {}).keys())
        self.default_timezones: dict[str, str] = dict(rules.get("default_timezones") or {})
        quiet = rules.get("quiet_hours") or {}
        self.quiet_from, self.quiet_to = _quiet_hours(quiet)

        catalogue = rules.get("calendars") or []
        self.calendar_names: dict[str, str] = {
            str(c["id"]): str(c.get("name") or c["id"]) for c in catalogue if c.get("id")
        }
        self.calendar_ids: tuple[str, ...] = tuple(self.calendar_names)
        self.community_ids: frozenset[str] = frozenset(
            str(c["id"]) for c in catalogue if c.get("id") and c.get("community")
        )
        extra: dict[str, list[str]] = {
            k: list(v) for k, v in (rules.get("extra_calendars") or {}).items()
        }
        region_codes: dict[str, list[str]] = {
            k: list(v) for k, v in (rules.get("region_codes") or {}).items()
        }
        community_regions: dict[str, str | None] = dict(rules.get("community_regions") or {})
        wishes: dict[str, str | None] = {}
        for entry in rules.get("wishes") or []:
            fid = str(entry.get("festival") or "")
            if fid:
                wishes[fid] = _gated(entry.get("text"), where=f"rule_engine.wishes[{fid}]")

        self.festivals: dict[str, Festival] = {}
        for raw in data.get("festivals") or []:
            festival = self._festival(raw, extra, region_codes, community_regions, wishes)
            if festival is not None:
                self.festivals[festival.id] = festival

        self.quiet_days: tuple[QuietDay, ...] = tuple(
            self._quiet_days((data.get("quiet_days") or {}).get("days") or [])
        )

    # -- parsing -------------------------------------------------------------------------------

    def _expand_countries(self, codes: Iterable[Any]) -> frozenset[str]:
        out: set[str] = set()
        for code in codes:
            key = str(code).upper()
            out.update(self.country_groups.get(key, [key]))
        return frozenset(out)

    def _festival(
        self,
        raw: dict[str, Any],
        extra: dict[str, list[str]],
        region_codes: dict[str, list[str]],
        community_regions: dict[str, str | None],
        wishes: dict[str, str | None],
    ) -> Festival | None:
        fid = str(raw.get("id") or "")
        if not fid:
            return None
        tradition = str(raw.get("tradition") or "multi")
        kind = self.kind_overrides.get(fid) or self.kind_by_tradition.get(tradition, "religious")
        if kind not in KINDS:
            kind = "religious"
        requires_opt_in = kind == "religious"

        codes: set[str] = set()
        communities: set[str] = set()
        for region in raw.get("regions") or []:
            text = str(region)
            if text in region_codes:
                codes.update(region_codes[text])
            elif text in community_regions:
                if community_regions[text]:
                    communities.add(str(community_regions[text]))
            # an unmapped region narrows the festival (it stays regional with no matching code)
            else:
                codes.add(f"?{text}")
        calendars: set[str] = set(communities) | set(extra.get(fid, []))
        if requires_opt_in:
            calendars.add(tradition)
        community_calendars = frozenset(c for c in calendars if c in self.community_ids)

        style = raw.get("greeting_style") or {}
        example = _gated(style.get("example"), where=f"{fid}.greeting_style.example")
        occasions: list[Occasion] = []
        for year, entries in (raw.get("dates") or {}).items():
            for entry in entries or []:
                on = _parse_date(entry.get("date"))
                if on is None:
                    continue
                occasions.append(
                    Occasion(
                        festival_id=fid,
                        on=on,
                        end=_parse_date(entry.get("end")),
                        scope=str(entry.get("scope") or "all").upper()
                        if str(entry.get("scope") or "all") != "all"
                        else "all",
                        label=str(entry["label"]) if entry.get("label") else None,
                        greet=entry.get("greet") is True,
                        greeting=_gated(entry.get("greeting"), where=f"{fid}.dates[{year}]"),
                        confidence=str(entry.get("confidence") or "unverified"),
                    )
                )
        return Festival(
            id=fid,
            name=str(raw.get("name") or fid),
            aliases=tuple(str(a) for a in raw.get("aliases") or []),
            tradition=tradition,
            kind=kind,
            requires_opt_in=requires_opt_in,
            countries=self._expand_countries(raw.get("countries") or []),
            region_codes=frozenset(codes),
            calendars=frozenset(calendars),
            community_calendars=community_calendars,
            requires_confirmation=raw.get("requires_same_day_confirmation") is True,
            quiet_day=raw.get("quiet_day") is True,
            wish=wishes.get(fid),
            example=example,
            occasions=tuple(occasions),
        )

    def _quiet_days(self, raw: list[dict[str, Any]]) -> list[QuietDay]:
        out: list[QuietDay] = []
        for entry in raw:
            if entry.get("requires_same_day_confirmation") is True:
                continue  # a restraint window that moves with the moon; not a fixed quiet day
            dates: set[date] = set()
            for values in (entry.get("dates") or {}).values():
                for value in values or []:
                    parsed = _parse_date(value)
                    if parsed:
                        dates.add(parsed)
            out.append(
                QuietDay(
                    id=str(entry.get("id") or ""),
                    name=str(entry.get("name") or ""),
                    countries=self._expand_countries(entry.get("countries") or []),
                    dates=frozenset(dates),
                )
            )
        return out

    # -- locality --------------------------------------------------------------------------------

    def normalise_region(self, code: str | None) -> str | None:
        if not code:
            return None
        key = str(code).strip().upper()
        return self.region_aliases.get(key, key) or None

    def timezone_for(
        self, prefs: MailPreferences, *, at: datetime | None = None
    ) -> ZoneInfo | None:
        """The family's own timezone, else the country's if it has exactly one, else None.

        A family's zone that disagrees with their single-zone country (``country=IN`` with
        ``America/New_York``) is an ambiguous locality — one of the two is wrong, and we cannot
        tell which — so it is ``None`` (§14.1 rule 5: ambiguous means nothing sends). Two names
        for the same clock (``Asia/Calcutta`` for ``Asia/Kolkata``) agree and are fine.
        """
        country_zone = _zone(self.default_timezones.get((prefs.country or "").upper()))
        own = _zone(prefs.timezone)
        if own is None:
            return country_zone
        if country_zone is not None:
            moment = _aware(at or datetime.now(UTC))
            if own.utcoffset(moment) != country_zone.utcoffset(moment):
                logger.info(
                    "hospitality: timezone disagrees with the country; locality is ambiguous",
                    extra={"fields": {"country": prefs.country, "timezone": prefs.timezone}},
                )
                return None
        return own

    def quiet_day_ids(self, country: str | None, day: date) -> list[str]:
        """The quiet days (WOBO-PLAN §14.1, the calendar's §5) that apply to a country today.
        Marketing and lifecycle mail hold on these; a greetable festival wish still goes."""
        if not country:
            return []
        code = country.upper()
        ids = [q.id for q in self.quiet_days if code in q.countries and day in q.dates]
        for festival in self.festivals.values():
            kept = festival.quiet_day and code in festival.countries
            if kept and any(o.on == day for o in festival.occasions):
                ids.append(festival.id)
        return sorted(set(ids))

    def is_quiet_day(self, country: str | None, day: date) -> bool:
        return bool(self.quiet_day_ids(country, day))

    # -- the rule engine ------------------------------------------------------------------------

    def _covers(
        self,
        festival: Festival,
        occasion: Occasion,
        country: str,
        region: str | None,
        community: bool,
    ) -> bool:
        """Does this dated entry reach this learner? Locality only; the choice is checked apart."""
        if country not in festival.countries:
            return False
        scope = occasion.scope
        if scope != "all":
            if len(scope) == 2:
                if scope != country:
                    return False
            else:
                # A subdivision entry (Onam is dated IN-KL). The family's region must match —
                # or the family chose the community calendar, which reaches the same day
                # wherever the festival's own country list allows (a Malayali family in
                # Dubai; the country check above already said AE is in Onam's list).
                targets = self.scope_aliases.get(scope, [scope])
                if region not in targets and not community:
                    return False
        if festival.region_codes:
            if region in festival.region_codes or country in festival.region_codes:
                return True
            return community
        return True

    def _sendable_date(self, festival: Festival, occasion: Occasion) -> bool:
        if occasion.confidence in self.send_confidences:
            return True
        return occasion.confidence == "conventional" and festival.id in self.human_checked

    def candidates(
        self,
        prefs: MailPreferences,
        day: date,
        *,
        confirmed: Iterable[str] = (),
    ) -> list[Wish]:
        """Every wish that applies to this learner on ``day``, best first. Timing is not checked
        here — :meth:`decide` does that; this is the table the tests drive."""
        country = (prefs.country or "").strip().upper()
        if not country or prefs.unsubscribed_at is not None or not prefs.festivals:
            return []
        region = self.normalise_region(prefs.region)
        if region and not region.startswith(country + "-"):
            region = None  # a region from another country is no region
        chosen_all = {c.strip().lower() for c in prefs.festival_calendar if c}
        confirmed_ids = {str(c) for c in confirmed}

        ranked: list[tuple[tuple[int, int, int, int, str], Wish]] = []
        for festival in self.festivals.values():
            chosen = sorted(chosen_all & festival.calendars)
            community = bool(set(chosen) & festival.community_calendars)
            if festival.id in self.suppressed:
                continue
            if festival.requires_opt_in and not chosen:
                continue
            if festival.requires_confirmation and festival.id not in confirmed_ids:
                continue
            for occasion in festival.occasions:
                if occasion.on != day or not occasion.greet:
                    continue
                if not self._sendable_date(festival, occasion):
                    continue
                if not self._covers(festival, occasion, country, region, community):
                    continue
                text = festival.wish or occasion.greeting or festival.example
                if not text:
                    continue  # nothing sendable to say: silence, never an ungated line
                specificity = (
                    2 if occasion.scope == "all" else (1 if len(occasion.scope) == 2 else 0)
                )
                key = (
                    0 if chosen else 1,
                    0 if community else 1,
                    specificity,
                    0 if festival.region_codes else 1,
                    festival.id,
                )
                ranked.append(
                    (
                        key,
                        Wish(
                            festival_id=festival.id,
                            name=festival.name,
                            day=day,
                            text=text,
                            kind=festival.kind,
                            scope=occasion.scope,
                            label=occasion.label,
                            chosen_calendar=chosen[0] if chosen else None,
                        ),
                    )
                )
        ranked.sort(key=lambda item: item[0])
        return [wish for _, wish in ranked]

    def wish_for(
        self, prefs: MailPreferences, day: date, *, confirmed: Iterable[str] = ()
    ) -> Wish | None:
        """One wish a day: the first of :meth:`candidates`, or None."""
        found = self.candidates(prefs, day, confirmed=confirmed)
        return found[0] if found else None

    def in_quiet_hours(self, local: datetime) -> bool:
        t = local.timetz().replace(tzinfo=None)
        start, end = self.quiet_from, self.quiet_to
        if start <= end:  # a window inside one day
            return start <= t < end
        return t >= start or t < end  # a window across midnight

    def next_opening(self, local: datetime) -> datetime:
        """The first moment on or after ``local`` that is outside quiet hours."""
        if not self.in_quiet_hours(local):
            return local
        opens = local.replace(
            hour=self.quiet_to.hour, minute=self.quiet_to.minute, second=0, microsecond=0
        )
        if opens <= local:
            opens += timedelta(days=1)
        return opens

    def decide(
        self,
        prefs: MailPreferences,
        now: datetime,
        *,
        last_email_at: datetime | None = None,
        confirmed: Iterable[str] = (),
    ) -> Decision:
        """The whole rule, for one learner, right now."""
        now = _aware(now)
        if prefs.unsubscribed_at is not None:
            return Decision(None, False, "the family unsubscribed")
        if not prefs.festivals:
            return Decision(None, False, "festival wishes are switched off")
        if not (prefs.country or "").strip():
            return Decision(None, False, "locality unknown; nothing sends")
        tz = self.timezone_for(prefs, at=now)
        if tz is None:
            return Decision(None, False, "no timezone for this family; nothing is timed")
        local = now.astimezone(tz)
        day = local.date()
        wish = self.wish_for(prefs, day, confirmed=confirmed)
        if wish is None:
            return Decision(None, False, "nothing to wish today", local_day=day)

        if self.in_quiet_hours(local):
            opens = self.next_opening(local)
            if opens.date() != day:
                return Decision(wish, False, "quiet hours, and the day is over", local_day=day)
            return Decision(wish, False, "quiet hours", local_day=day, send_after=opens)

        if last_email_at is not None:
            since = now - _aware(last_email_at)
            if since < _GAP:
                after = _aware(last_email_at) + _GAP
                after_local = self.next_opening(after.astimezone(tz))
                if after_local.date() != day:
                    return Decision(
                        wish,
                        False,
                        "another email went out within the last day, and the day would be over",
                        local_day=day,
                    )
                return Decision(
                    wish,
                    False,
                    "another email went out within the last day",
                    local_day=day,
                    send_after=after_local,
                )
        return Decision(wish, True, "send", local_day=day)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _zone(name: Any) -> ZoneInfo | None:
    if not name:
        return None
    try:
        return ZoneInfo(str(name))
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _quiet_hours(raw: dict[str, Any]) -> tuple[time, time]:
    """``MAIL_QUIET_HOURS=21:00-08:00`` overrides the file; the file overrides the default."""
    start, end = str(raw.get("from") or _DEFAULT_QUIET[0]), str(raw.get("to") or _DEFAULT_QUIET[1])
    override = (os.getenv("MAIL_QUIET_HOURS") or "").strip()
    if override and "-" in override:
        start, end = (part.strip() for part in override.split("-", 1))
    return _parse_time(start, _DEFAULT_QUIET[0]), _parse_time(end, _DEFAULT_QUIET[1])


# -- loading ---------------------------------------------------------------------------------------

_calendar: Calendar | None = None
_lock = threading.Lock()


def load_calendar(path: Path | None = None) -> Calendar:
    """Read the file. A missing or unreadable file is an EMPTY calendar (nothing sends) and a
    warning, never an exception — a boot must not fail on hospitality."""
    target = path or (content_dir() / "festivals.json")
    try:
        data = json.loads(Path(target).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning(
            "hospitality: festival calendar unavailable; no wishes will send",
            extra={"fields": {"path": str(target), "error": str(exc)}},
        )
        return Calendar(None)
    if not isinstance(data, dict):
        return Calendar(None)
    return Calendar(data)


def get_calendar() -> Calendar:
    global _calendar
    if _calendar is None:
        with _lock:
            if _calendar is None:
                _calendar = load_calendar()
    return _calendar


def set_calendar(calendar: Calendar | None) -> None:
    """Test seam."""
    global _calendar
    with _lock:
        _calendar = calendar
