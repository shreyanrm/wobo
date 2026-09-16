"""The growth desk's dials, in ``ops.settings``: live, audited, and closed when unread.

``docs/GROWTH-DESK.md`` section 4.6: *"cadence per channel, topics on and off, the approval queue,
and a kill switch, all live from the console with an audit row, never a deploy."*

Five keys, all under ``growth.`` so the settings audit trigger (migration 0024) records every turn
with its actor and note, exactly as it does for the door and the models desk:

=======================  ==========================================================================
``growth.running``       the kill switch. ``true`` lets the jobs make and post; anything else, a
                         missing row and an unreadable table included, stops both. Default off.
``growth.cadence``       ``{channel: posts a day}``. A channel at 0 is off. The origin is capped
                         at :data:`BLOG_CEILING` whatever is typed, because the measured pace is
                         the defence against scaled content abuse (section 3).
``growth.topics_off``    topic slugs the desk will not write about.
``growth.approval``      ``"every"`` (the default): every post waits for a person, tier 1 too.
                         ``"person"``: tier 1 posts on its own once released, as section 4.3
                         describes, and only tier 2 waits.
``growth.pieces_daily``  how many source pieces MAKE may draft in a day, at most
                         :data:`PIECES_CEILING`.
=======================  ==========================================================================

**Why reading fails closed.** A dial is read on a timer while posts are going out. A table that
cannot be read is a table that might say "stop", so an unreadable store reads as stopped, and the
desk says the store could not be read rather than printing the defaults as if they were chosen.

Keys use underscores, never hyphens: ``ops.settings`` refuses a hyphen in a key, and a cadence is
keyed on the channel inside the value, where ``business-profile`` is fine.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from wobo_gateway import doors
from wobo_gateway.growth import channels

logger = logging.getLogger("wobo.gateway.growth.settings")

RUNNING_KEY = "growth.running"
CADENCE_KEY = "growth.cadence"
TOPICS_OFF_KEY = "growth.topics_off"
APPROVAL_KEY = "growth.approval"
PIECES_KEY = "growth.pieces_daily"
KEYS: tuple[str, ...] = (RUNNING_KEY, CADENCE_KEY, TOPICS_OFF_KEY, APPROVAL_KEY, PIECES_KEY)

APPROVE_EVERY = "every"
APPROVE_PERSON_TIER = "person"
APPROVALS: tuple[str, ...] = (APPROVE_EVERY, APPROVE_PERSON_TIER)

#: A day's posts per channel before anybody turns a dial. One origin post a day at most: the pace
#: is part of the value argument, not a throttle to be tuned up.
DEFAULT_CADENCE: dict[str, int] = {
    "blog": 1,
    "telegram": 1,
    "threads": 1,
    "instagram": 1,
    "facebook": 1,
    "linkedin": 1,
    "youtube": 1,
    "x": 1,
    "medium": 1,
    "pinterest": 1,
    "newsletter": 1,
    "business-profile": 0,
}
#: The most any channel may be dialled to in a day.
CHANNEL_CEILING = 10
#: The most origin posts a day, whatever the dial says.
BLOG_CEILING = 3
DEFAULT_PIECES = 1
PIECES_CEILING = 3
#: How long a read is served before the store is asked again.
REFRESH_S = 30.0


class BadSetting(ValueError):
    """A dial outside what this file allows. Refused at the write; ignored at the read."""


@dataclass(frozen=True)
class Settings:
    running: bool = False
    cadence: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_CADENCE))
    topics_off: frozenset[str] = frozenset()
    approval: str = APPROVE_EVERY
    pieces_daily: int = DEFAULT_PIECES
    #: False when the store could not be read, and everything above is the closed default.
    readable: bool = True
    #: Keys that were read and could not be used, with the reason in words.
    ignored: dict[str, str] = field(default_factory=dict)

    def per_day(self, channel_key: str) -> int:
        return int(self.cadence.get(channel_key, 0))

    def needs_approval(self, channel_key: str) -> bool:
        """Does a post on this channel wait for a person? Always for tier 2. For tier 1, only
        when the dial says every post does, which is where it starts."""
        tier = channels.tier_of(channel_key)
        if tier is channels.Tier.NEVER:
            raise channels.NeverAutomated(f"{channel_key} is tier 3")
        return tier is channels.Tier.PERSON or self.approval == APPROVE_EVERY

    def as_dict(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "cadence": dict(sorted(self.cadence.items())),
            "topics_off": sorted(self.topics_off),
            "approval": self.approval,
            "pieces_daily": self.pieces_daily,
            "readable": self.readable,
            "ignored": dict(self.ignored),
            "ceilings": {
                "channel": CHANNEL_CEILING,
                "blog": BLOG_CEILING,
                "pieces_daily": PIECES_CEILING,
            },
        }


# --- validation, shared by the read and the write -------------------------------------------------
def valid_running(value: Any) -> bool:
    if not isinstance(value, bool):
        raise BadSetting("running is true or false")
    return value


def valid_cadence(value: Any) -> dict[str, int]:
    if not isinstance(value, Mapping):
        raise BadSetting("the cadence is a map of channel to posts a day")
    out = dict(DEFAULT_CADENCE)
    for key, count in value.items():
        name = str(key).strip().lower()
        channels.refuse(name)
        channels.channel(name)
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise BadSetting(f"{name}: posts a day is a whole number, zero or more")
        ceiling = BLOG_CEILING if name == channels.ORIGIN else CHANNEL_CEILING
        if count > ceiling:
            raise BadSetting(f"{name}: at most {ceiling} a day")
        out[name] = count
    return out


def valid_topics(value: Any) -> frozenset[str]:
    if not isinstance(value, list | tuple):
        raise BadSetting("topics off is a list of topic slugs")
    from wobo_gateway.growth import campaigns

    out: set[str] = set()
    for item in value:
        slug = str(item).strip()
        if not slug or campaigns.slugify(slug) != slug:
            raise BadSetting(f"{item!r} is not a topic slug")
        out.add(slug)
    if len(out) > 2000:
        raise BadSetting("too many topics")
    return frozenset(out)


def valid_approval(value: Any) -> str:
    if value not in APPROVALS:
        raise BadSetting(f"approval is one of {', '.join(APPROVALS)}")
    return str(value)


def valid_pieces(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= PIECES_CEILING:
        raise BadSetting(f"pieces a day is a whole number from 0 to {PIECES_CEILING}")
    return value


_VALIDATORS: dict[str, Callable[[Any], Any]] = {
    RUNNING_KEY: valid_running,
    CADENCE_KEY: valid_cadence,
    TOPICS_OFF_KEY: valid_topics,
    APPROVAL_KEY: valid_approval,
    PIECES_KEY: valid_pieces,
}


# --- reading --------------------------------------------------------------------------------------
_lock = threading.Lock()
_cached: tuple[float, Settings] | None = None
_clock: Callable[[], float] = time.monotonic


def set_clock(clock: Callable[[], float] | None) -> None:
    global _clock
    _clock = clock or time.monotonic
    forget()


def forget() -> None:
    global _cached
    with _lock:
        _cached = None


def _read_raw() -> dict[str, Any]:
    store = doors.get_store()
    bulk = getattr(store, "read_many", None)
    if callable(bulk):
        got = bulk(KEYS)
        return dict(got) if isinstance(got, dict) else {}
    return {key: value for key in KEYS if (value := store.read(key)) is not None}


def parse(raw: Mapping[str, Any]) -> Settings:
    """What a set of stored values means. A bad value is ignored, named, and the default kept."""
    ignored: dict[str, str] = {}
    picked: dict[str, Any] = {}
    for key in KEYS:
        if raw.get(key) is None:
            continue
        try:
            picked[key] = _VALIDATORS[key](raw[key])
        except (BadSetting, channels.UnknownChannel, channels.NeverAutomated) as exc:
            ignored[key] = str(exc)
    return Settings(
        running=bool(picked.get(RUNNING_KEY, False)),
        cadence=picked.get(CADENCE_KEY, dict(DEFAULT_CADENCE)),
        topics_off=picked.get(TOPICS_OFF_KEY, frozenset()),
        approval=picked.get(APPROVAL_KEY, APPROVE_EVERY),
        pieces_daily=picked.get(PIECES_KEY, DEFAULT_PIECES),
        ignored=ignored,
    )


def current(*, fresh: bool = False) -> Settings:
    """The dials as last read, re-read every :data:`REFRESH_S`. Never raises."""
    global _cached
    now = _clock()
    with _lock:
        if not fresh and _cached is not None and now - _cached[0] < REFRESH_S:
            return _cached[1]
    try:
        found = parse(_read_raw())
    except Exception as exc:  # noqa: BLE001 — an unreadable table stops the desk, it never crashes it
        logger.warning("growth: the dials could not be read (%s); the desk is stopped", exc)
        found = Settings(running=False, readable=False)
    with _lock:
        _cached = (now, found)
    return found


# --- writing --------------------------------------------------------------------------------------
def write(changes: Mapping[str, Any], *, actor: str | None, note: str | None) -> Settings:
    """Turn one or more dials, all or none. Every value is validated before anything is written."""
    clean: dict[str, Any] = {}
    for key, value in changes.items():
        if key not in _VALIDATORS:
            raise BadSetting(f"no such dial: {key}")
        checked = _VALIDATORS[key](value)
        if isinstance(checked, frozenset):
            checked = sorted(checked)
        clean[key] = checked
    if not clean:
        raise BadSetting("nothing to change")
    doors.get_store().write_many(clean, actor=actor, note=note)
    return current(fresh=True)


__all__ = [
    "APPROVALS",
    "APPROVAL_KEY",
    "APPROVE_EVERY",
    "APPROVE_PERSON_TIER",
    "BLOG_CEILING",
    "CADENCE_KEY",
    "CHANNEL_CEILING",
    "DEFAULT_CADENCE",
    "KEYS",
    "PIECES_CEILING",
    "PIECES_KEY",
    "RUNNING_KEY",
    "TOPICS_OFF_KEY",
    "BadSetting",
    "Settings",
    "current",
    "forget",
    "parse",
    "set_clock",
    "valid_cadence",
    "write",
]
