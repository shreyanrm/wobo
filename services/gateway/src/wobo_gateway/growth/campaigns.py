"""The campaign id: one durable string per shape, used as ``utm_id``, and written once.

``docs/GROWTH-DESK.md`` section 4.4: *"every piece gets one durable campaign id, used as utm_id,
of the shape channel-yyyymm-slug-nn. The gateway writes that id on the account at sign-up, once,
and the cookie dies there."*

**The shape, and why each part of it is there.**

    ``blog-202609-how-a-syllabus-is-read-01``
     |     |      |                         |
     |     |      |                         the attempt: 01 for the first shape of this piece on
     |     |      |                         this channel, 02 when the same piece is posted again
     |     |      the piece's slug, which is also the address of the origin post
     |     the month, so a year of campaigns sorts and groups without a join
     the channel key, from :mod:`wobo_gateway.growth.channels`

It is one field rather than the usual five because one field is what survives. A ``utm_source`` and
``utm_medium`` pair gets rewritten by every link shortener, app browser and referrer stripper
between a post and a sign-up; ``utm_id`` is a single opaque token that either arrives or does not,
and the thing we actually want to know is which piece brought somebody, not which taxonomy row.

**Two rules that are not about formatting.**

1. **A NEVER channel has no campaign id.** :func:`build` refuses one, for the same reason
   :mod:`wobo_gateway.growth.shapes` refuses a shape: an id is the first thing a later outbox
   would look for.
2. **It is written on the account exactly once, by the gateway.** Migration 0038 puts
   ``campaign_id`` on ``learner.profiles_cache``, leaves it out of the learner's column grants,
   and adds a trigger that refuses a second value. The column cannot be written by the browser
   that carried the link, so the attribution on an account is what our own server saw at sign-up
   and is not a claim anybody can edit afterwards. :func:`is_well_formed` is what the gateway
   checks before it writes, so a junk query string never reaches the column.

**Nothing here identifies anybody.** A campaign id names a piece of ours, not a person. It carries
no device id, no address digest and no click id, and there is no per-visitor token anywhere in
this package. That is not caution, it is ``docs/GROWTH-DESK.md`` section 1: the learner side of
the product is never measured by a third party, and the first-party version has to be worth less
than a tracking cookie or it would be a tracking cookie with our name on it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime

from wobo_gateway.growth import channels

#: The whole grammar, in one place, anchored at both ends. Channel keys are lower case letters and
#: hyphens (``business-profile``), the month is six digits, the slug is lower case words separated
#: by single hyphens, and the attempt is exactly two digits.
PATTERN = re.compile(r"^([a-z][a-z-]{0,23})-(\d{6})-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{2})$")

#: The longest a campaign id may be. A ``utm_id`` rides in a query string that also has to survive
#: being pasted into a phone keyboard, and a column somewhere has to hold it.
MAX_LENGTH = 96
#: The longest slug part. Left generous: it is the post's own address, which is written for a
#: reader and not for this file.
MAX_SLUG = 60
#: The query parameter. One, and this is it.
PARAM = "utm_id"


class BadCampaign(ValueError):
    """A campaign id that does not fit the grammar, or names a channel that may not carry one."""


@dataclass(frozen=True)
class Campaign:
    """A parsed campaign id. Every field is read back out of the string, never stored beside it."""

    id: str
    channel: str
    month: str
    slug: str
    attempt: int

    @property
    def year(self) -> int:
        return int(self.month[:4])

    @property
    def month_number(self) -> int:
        return int(self.month[4:])


def slugify(text: str) -> str:
    """A title into the slug half of a campaign id, and into the post's address.

    Lower case, letters and digits kept, everything else collapsed to a single hyphen, trimmed,
    then cut to :data:`MAX_SLUG` on a word boundary so an id never ends mid-word. Returns an empty
    string for input with nothing in it, which every caller treats as a refusal rather than
    inventing a slug of its own.
    """
    plain = re.sub(r"[^a-z0-9]+", "-", (text or "").strip().lower()).strip("-")
    if len(plain) <= MAX_SLUG:
        return plain
    cut = plain[: MAX_SLUG + 1]
    return cut[: cut.rindex("-")] if "-" in cut else plain[:MAX_SLUG]


def month_of(when: date | datetime | None = None) -> str:
    """``yyyymm`` in UTC. The desk's day is UTC everywhere, as the ledger's and the spend
    ceiling's are, so a campaign minted at the turn of a month lands in one month on every
    screen that ever reads it."""
    moment = when or datetime.now(UTC)
    if isinstance(moment, datetime):
        moment = moment.astimezone(UTC).date()
    return f"{moment.year:04d}{moment.month:02d}"


def build(
    channel_key: str, slug: str, *, attempt: int = 1, when: date | datetime | None = None
) -> str:
    """The id for one shape of one piece on one channel. Refuses a tier 3 channel outright."""
    channels.refuse(channel_key)
    channel = channels.channel(channel_key)
    clean = slugify(slug)
    if not clean:
        raise BadCampaign("a campaign id needs a slug, and this piece has nothing to make one of")
    if not 1 <= attempt <= 99:
        raise BadCampaign(f"attempt {attempt} is outside 01 to 99")
    built = f"{channel.key}-{month_of(when)}-{clean}-{attempt:02d}"
    if len(built) > MAX_LENGTH:
        raise BadCampaign(f"campaign id is {len(built)} characters, over {MAX_LENGTH}: {built}")
    return built


def parse(value: str) -> Campaign:
    """A campaign id back into its parts, or :class:`BadCampaign`.

    Checks the channel as well as the grammar, so a well shaped id naming a channel that does not
    exist is refused rather than counted. A tier 3 key is refused here too, which means a row that
    somehow reached the store naming one cannot be read back into a measurement.
    """
    raw = (value or "").strip()
    if len(raw) > MAX_LENGTH:
        raise BadCampaign(f"campaign id is {len(raw)} characters, over {MAX_LENGTH}")
    found = PATTERN.match(raw)
    if not found:
        raise BadCampaign(f"not a campaign id: {raw!r}")
    channel_key, month, slug, attempt = found.groups()
    channels.refuse(channel_key)
    channels.channel(channel_key)
    if not 1 <= int(month[4:]) <= 12:
        raise BadCampaign(f"{month} is not a month")
    return Campaign(id=raw, channel=channel_key, month=month, slug=slug, attempt=int(attempt))


def is_well_formed(value: str | None) -> bool:
    """The check the sign-up path makes before it writes the column. Never raises."""
    if not value:
        return False
    try:
        parse(value)
    except (BadCampaign, channels.NeverAutomated, channels.UnknownChannel):
        return False
    return True


def tag(url: str, campaign_id: str) -> str:
    """Put the campaign on an address, without a second query parameter and without a fragment
    reorder. Refuses an id that is not well formed rather than posting an untagged link quietly.
    """
    if not is_well_formed(campaign_id):
        raise BadCampaign(f"not a campaign id: {campaign_id!r}")
    base, _, fragment = (url or "").partition("#")
    if not base:
        raise BadCampaign("there is no address to tag")
    joined = f"{base}{'&' if '?' in base else '?'}{PARAM}={campaign_id}"
    return f"{joined}#{fragment}" if fragment else joined


def from_query(query: str | None) -> str | None:
    """The campaign id out of a query string, or ``None``. What the sign-up path calls.

    Deliberately forgiving about the query string and strict about the value: a browser can hand
    us anything, and the answer to anything we do not recognise is no attribution rather than a
    guess. Only the FIRST ``utm_id`` is read, so a second copy appended by a redirect chain cannot
    overwrite the one the reader actually clicked.
    """
    if not query:
        return None
    for part in query.lstrip("?").split("&"):
        name, _, value = part.partition("=")
        if name.strip().lower() != PARAM:
            continue
        from urllib.parse import unquote_plus

        candidate = unquote_plus(value.strip())
        return candidate if is_well_formed(candidate) else None
    return None


__all__ = [
    "MAX_LENGTH",
    "MAX_SLUG",
    "PARAM",
    "PATTERN",
    "BadCampaign",
    "Campaign",
    "build",
    "from_query",
    "is_well_formed",
    "month_of",
    "parse",
    "slugify",
    "tag",
]
