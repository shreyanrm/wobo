"""The family's mail preferences — the dials, the chosen calendars, the locality, the opt-out.

One row per learner in ``learner.mail_preferences`` (migration 0010), reached over PostgREST
with the service-role key exactly the way :mod:`wobo_gateway.memory` reaches the learner's
mind. The row is never trusted from a request body: the routes in :mod:`.api` validate every
field here first (:func:`normalise`), and the engine in :mod:`.festivals` reads only the
frozen :class:`MailPreferences` this module hands out.

What the row means (WOBO-PLAN §14.1):

* ``sunday_note`` / ``wins`` / ``festivals`` — the three kinds of mail a family can switch off
  one at a time. The one-click stop link in a mail's footer flips the dial for the mail it came
  from (the parent's link stops the Sunday note; the learner's stops wins and wishes) and
  nothing else. ``unsubscribed_at`` is the signed-in "stop everything" switch: it silences all
  three at once, and only a signed-in PUT clears it again.
* ``festival_calendar`` — the calendars the family CHOSE in "Festivals we can wish you on".
  Sensitive data: explicit opt-in, used for the wishes and for nothing else, cleared in one
  tap. Never inferred, never written by anything but the family's own hand.
* ``country`` / ``region`` / ``timezone`` — the locality the family told us. Codes, not names.
  Unknown locality sends nothing.

Two stores behind one seam: :class:`InMemoryPreferencesStore` for the suite and a local run,
:class:`PostgrestPreferencesStore` for the project. A store that cannot be reached raises
:class:`StoreUnavailable` so a route can say so honestly, rather than showing a family
defaults that are not theirs.
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
from collections.abc import Callable, Collection, Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger("wobo.gateway.hospitality")

_HTTP_TIMEOUT_S = 5.0
_SCHEMA = "learner"
_TABLE = "mail_preferences"
_ID_COLUMN = "learner_id"

MAX_CALENDARS = 12
_COUNTRY = re.compile(r"^[A-Z]{2}$")
_REGION = re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,3}$")
_TIMEZONE = re.compile(r"^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)*$")
_CALENDAR = re.compile(r"^[a-z][a-z0-9-]*$")

#: The five nudges (docs/EMAILS-AND-ANIMATIONS.md §1). Each is its own dial with its own
#: one-click stop, because a family that wants the doubt answered but not the streak must be able
#: to say exactly that: a single "fewer emails" switch is how a reader ends up pressing Block.
NUDGE_KINDS: tuple[str, ...] = ("quick_one", "mid_chapter", "streak", "bonus_level", "doubt")

MAIL_KINDS: tuple[str, ...] = ("sunday_note", "wins", "festivals", *NUDGE_KINDS)


@dataclass(frozen=True)
class MailPreferences:
    sunday_note: bool = True
    wins: bool = True
    festivals: bool = True
    # The five nudges, each its own dial (§1, "cadence is the learner's").
    quick_one: bool = True
    mid_chapter: bool = True
    streak: bool = True
    bonus_level: bool = True
    doubt: bool = True
    festival_calendar: tuple[str, ...] = ()
    country: str | None = None
    region: str | None = None
    timezone: str | None = None
    unsubscribed_at: datetime | None = None
    updated_at: datetime | None = field(default=None, compare=False)

    @property
    def unsubscribed(self) -> bool:
        return self.unsubscribed_at is not None

    def allows(self, kind: str) -> bool:
        """May mail of this kind go to this family? The stop link overrides every dial."""
        if self.unsubscribed:
            return False
        if kind not in MAIL_KINDS:
            return False
        return bool(getattr(self, kind))

    def as_dict(self) -> dict[str, Any]:
        return {
            **{kind: bool(getattr(self, kind)) for kind in MAIL_KINDS},
            "festival_calendar": list(self.festival_calendar),
            "country": self.country,
            "region": self.region,
            "timezone": self.timezone,
            "unsubscribed": self.unsubscribed,
            "unsubscribed_at": self.unsubscribed_at.isoformat() if self.unsubscribed_at else None,
        }


DEFAULT_PREFERENCES = MailPreferences()


class PreferenceError(ValueError):
    """A field the family sent that we cannot keep. ``field`` names it; ``message`` is Wobo's."""

    def __init__(self, field_name: str, message: str) -> None:
        self.field = field_name
        self.message = message
        super().__init__(f"{field_name}: {message}")


def _parse_when(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def normalise(
    raw: dict[str, Any],
    *,
    calendars: Collection[str],
    region_aliases: dict[str, str] | None = None,
    base: MailPreferences = DEFAULT_PREFERENCES,
) -> MailPreferences:
    """``base`` with the fields present in ``raw`` applied, every one validated.

    ``calendars`` is the closed list a family may choose from (the calendar file's catalogue);
    anything outside it is refused, never stored. Codes are upper-cased; a region must belong to
    the country it is sent with (or the one already on file); a timezone must be a real IANA
    name. ``unsubscribed: false`` clears the opt-out — that is the signed-in way back in.
    """
    aliases = region_aliases or {}
    out = base
    for kind in MAIL_KINDS:
        if kind in raw:
            value = raw[kind]
            if not isinstance(value, bool):
                raise PreferenceError(kind, "that one is on or off")
            out = replace(out, **{kind: value})

    if "festival_calendar" in raw:
        value = raw["festival_calendar"]
        if value is None:
            value = []
        if not isinstance(value, list | tuple):
            raise PreferenceError("festival_calendar", "send the calendars as a list")
        chosen: list[str] = []
        allowed = set(calendars)
        for item in value:
            slug = str(item).strip().lower()
            if not _CALENDAR.match(slug) or slug not in allowed:
                raise PreferenceError(
                    "festival_calendar", "that is not one of the calendars I can wish you on"
                )
            if slug not in chosen:
                chosen.append(slug)
        if len(chosen) > MAX_CALENDARS:
            raise PreferenceError("festival_calendar", "that is more calendars than I can keep")
        out = replace(out, festival_calendar=tuple(chosen))

    if "country" in raw:
        value = raw["country"]
        if value is None or value == "":
            out = replace(out, country=None, region=None)
        else:
            code = str(value).strip().upper()
            if not _COUNTRY.match(code):
                raise PreferenceError("country", "I need the two-letter country code")
            out = replace(out, country=code)
            if out.region and not out.region.startswith(code + "-"):
                out = replace(out, region=None)

    if "region" in raw:
        value = raw["region"]
        if value is None or value == "":
            out = replace(out, region=None)
        else:
            code = str(value).strip().upper()
            code = aliases.get(code, code)
            if not _REGION.match(code):
                raise PreferenceError("region", "I need the region as a code, like IN-TG")
            if not out.country or not code.startswith(out.country + "-"):
                raise PreferenceError("region", "that region is not in the country on file")
            out = replace(out, region=code)

    if "timezone" in raw:
        value = raw["timezone"]
        if value is None or value == "":
            out = replace(out, timezone=None)
        else:
            name = str(value).strip()
            if not _TIMEZONE.match(name):
                raise PreferenceError(
                    "timezone", "I need the timezone by its name, like Asia/Kolkata"
                )
            try:
                ZoneInfo(name)
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise PreferenceError("timezone", "I do not know that timezone") from exc
            out = replace(out, timezone=name)

    if "unsubscribed" in raw:
        value = raw["unsubscribed"]
        if not isinstance(value, bool):
            raise PreferenceError("unsubscribed", "that one is on or off")
        if value and out.unsubscribed_at is None:
            out = replace(out, unsubscribed_at=datetime.now(UTC))
        if not value:
            out = replace(out, unsubscribed_at=None)
    return out


def from_row(row: dict[str, Any]) -> MailPreferences:
    """A database row, read tolerantly: a column we do not recognise is ignored, a missing one
    is its default."""
    calendars = row.get("festival_calendar")
    if isinstance(calendars, str):  # PostgREST renders text[] as JSON; a raw pg literal is "{a,b}"
        calendars = [c for c in calendars.strip("{}").split(",") if c]
    return MailPreferences(
        **{kind: row.get(kind) is not False for kind in MAIL_KINDS},
        festival_calendar=tuple(str(c) for c in (calendars or [])),
        country=str(row["country"]).upper() if row.get("country") else None,
        region=str(row["region"]).upper() if row.get("region") else None,
        timezone=str(row["timezone"]) if row.get("timezone") else None,
        unsubscribed_at=_parse_when(row.get("unsubscribed_at")),
        updated_at=_parse_when(row.get("updated_at")),
    )


def to_row(learner_id: str, prefs: MailPreferences) -> dict[str, Any]:
    return {
        _ID_COLUMN: learner_id,
        **{kind: bool(getattr(prefs, kind)) for kind in MAIL_KINDS},
        "festival_calendar": list(prefs.festival_calendar),
        "country": prefs.country,
        "region": prefs.region,
        "timezone": prefs.timezone,
        "unsubscribed_at": prefs.unsubscribed_at.isoformat() if prefs.unsubscribed_at else None,
    }


# --- the store seam -------------------------------------------------------------------------------


class StoreUnavailable(Exception):
    """The preferences could not be reached. Callers say so; they never invent a family's dials."""


def _off(kinds: Iterable[str]) -> dict[str, bool]:
    """The dials a one-click stop flips, as row columns. Only the three mail kinds are dials;
    anything else in ``kinds`` is ignored rather than written."""
    return {kind: False for kind in kinds if kind in MAIL_KINDS}


class PreferencesStore(Protocol):
    def get(self, learner_id: str) -> MailPreferences | None: ...

    def put(self, learner_id: str, prefs: MailPreferences) -> MailPreferences: ...

    def stop(self, learner_id: str, kinds: Iterable[str]) -> MailPreferences: ...


class InMemoryPreferencesStore:
    """The suite's store, and a local run without a project."""

    def __init__(self) -> None:
        self.rows: dict[str, MailPreferences] = {}
        self._lock = threading.Lock()

    def get(self, learner_id: str) -> MailPreferences | None:
        with self._lock:
            return self.rows.get(learner_id)

    def put(self, learner_id: str, prefs: MailPreferences) -> MailPreferences:
        stored = replace(prefs, updated_at=datetime.now(UTC))
        with self._lock:
            self.rows[learner_id] = stored
        return stored

    def stop(self, learner_id: str, kinds: Iterable[str]) -> MailPreferences:
        with self._lock:
            current = self.rows.get(learner_id) or DEFAULT_PREFERENCES
            stored = replace(current, **_off(kinds), updated_at=datetime.now(UTC))
            self.rows[learner_id] = stored
            return stored

    def forget(self, learner_id: str) -> int:
        """The erase path (:mod:`wobo_gateway.memory`): the family's row, gone. 1 or 0."""
        with self._lock:
            return 1 if self.rows.pop(learner_id, None) is not None else 0


Request = Callable[..., Any]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call. Split out so tests can substitute it without a database."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
        "Prefer": (
            "resolution=merge-duplicates,return=representation"
            if want_rows
            else "resolution=merge-duplicates,return=minimal"
        ),
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


class PostgrestPreferencesStore:
    """``learner.mail_preferences`` over PostgREST with the service-role key (never a client's)."""

    def __init__(self, base_url: str, service_key: str, *, request: Request | None = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestPreferencesStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{_TABLE}?{encoded}"

    def get(self, learner_id: str) -> MailPreferences | None:
        url = self._url({"select": "*", _ID_COLUMN: f"eq.{learner_id}", "limit": "1"})
        try:
            rows = self._request(url, self._key, "GET", want_rows=True)
        except _NETWORK_ERRORS as exc:
            logger.warning("mail preferences: read failed", extra={"fields": {"error": str(exc)}})
            raise StoreUnavailable(str(exc)) from exc
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return from_row(rows[0])
        return None

    def _upsert(self, learner_id: str, row: dict[str, Any]) -> MailPreferences:
        url = self._url({"on_conflict": _ID_COLUMN})
        try:
            rows = self._request(url, self._key, "POST", body=[row], want_rows=True)
        except _NETWORK_ERRORS as exc:
            logger.warning("mail preferences: write failed", extra={"fields": {"error": str(exc)}})
            raise StoreUnavailable(str(exc)) from exc
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return from_row(rows[0])
        return from_row(row)

    def put(self, learner_id: str, prefs: MailPreferences) -> MailPreferences:
        return self._upsert(learner_id, to_row(learner_id, prefs))

    def stop(self, learner_id: str, kinds: Iterable[str]) -> MailPreferences:
        # Merge-duplicates writes only the columns sent, so an existing row keeps its other dials
        # and its chosen calendars, and a missing row gets the defaults with these dials off.
        return self._upsert(learner_id, {_ID_COLUMN: learner_id, **_off(kinds)})


# --- the process-wide store -----------------------------------------------------------------------

_store: PreferencesStore | None = None
_store_lock = threading.Lock()


def build_store() -> PreferencesStore:
    """The project store when configured, else the in-memory one. ``MAIL_PREFERENCES_STORE=memory``
    forces the latter — what the suite and a local run use."""
    if (os.getenv("MAIL_PREFERENCES_STORE") or "").strip().lower() == "memory":
        return InMemoryPreferencesStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestPreferencesStore(base, key)
    logger.info("mail preferences: no project configured, keeping preferences in memory")
    return InMemoryPreferencesStore()


def get_store() -> PreferencesStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: PreferencesStore | None) -> None:
    """Test seam."""
    global _store
    with _store_lock:
        _store = store


def preferences_for(learner_id: str) -> MailPreferences | None:
    """What the jobs read: the family's row, ``None`` when there is none. Raises
    :class:`StoreUnavailable` when the store cannot answer — a job must then send nothing,
    never assume the defaults."""
    return get_store().get(learner_id)
