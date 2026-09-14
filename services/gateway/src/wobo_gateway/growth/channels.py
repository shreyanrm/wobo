"""The channels, in three tiers that never mix, and the two nobody may automate. Ever.

``docs/GROWTH-DESK.md`` section 2 is the law. This module is the whole of it in one table, and
every other module in this package asks this one rather than carrying its own idea of where a
shape may go.

**The three tiers.**

* :data:`Tier.SCRIPT` — a script may post. Our own blog, Telegram, Threads, Instagram, the
  Facebook page, the LinkedIn page, YouTube, X.
* :data:`Tier.PERSON` — the machine drafts and a person sends. Medium (its API is closed to new
  tokens), Pinterest, the newsletter, the Google Business Profile. A shape for one of these
  reaches the approval queue and stops there.
* :data:`Tier.NEVER` — Reddit and Quora, and no automation ever. Not a draft that a person clicks
  through, not a queue, not a scheduled reminder. Reddit's shadowbans are tuned for exactly the
  pattern a scheduler produces and Quora has no write API at all. Our presence on both is a named
  person answering questions with the whole worked solution and no link, which is marketing time
  and not an integration.

**Why NEVER is a third tier rather than a flag on PERSON, and this is the design decision in the
file.** PERSON means "a person presses send on something the machine wrote", and everything in it
therefore has a drafted body sitting in a queue. If Reddit were in that tier, the desk would hold a
Reddit-shaped draft, and the day somebody wires an approval queue to an outbox that posts on
approval, Reddit goes out with everything else. So a NEVER channel has no shape, no draft, no
queue row and no outbox entry, and :func:`shape_for` refuses to build one. There is nothing for a
later wave to accidentally connect.

:func:`assert_no_automation` is the assertion the law asks for, and
``services/gateway/tests/test_growth_channels.py`` runs it over the whole repository rather than
over this file: a posting path added anywhere else is exactly the failure it exists to catch.

**X's price shapes the format, so it is a property of the channel and not of a writer's taste.**
A post costs about 1.5 cents and a post carrying a link costs about 20 cents, so
:data:`LINK_IN_LAST_REPLY` is set on X and :mod:`wobo_gateway.growth.shapes` puts the address in
the final reply of the thread. The platform rewards the same shape, so there is no tension to
resolve.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Tier(str, Enum):
    """Who may send. The value is what goes in the store and on the wire."""

    #: A script may post, unattended, on a cadence.
    SCRIPT = "script"
    #: The machine drafts it, a person sends it. The approval queue is the whole of the tier.
    PERSON = "person"
    #: No automation, ever. No draft, no queue, no outbox. See the module docstring.
    NEVER = "never"


@dataclass(frozen=True)
class Channel:
    """One place a piece can end up, and everything the desk needs to know about it."""

    #: The stable key. Lower case, no spaces: it is half of a campaign id.
    key: str
    #: What a person calls it on the console.
    name: str
    tier: Tier
    #: Why it is in the tier it is in, in one sentence, for the console to print. A tier with no
    #: reason on the screen is a tier somebody moves.
    because: str
    #: Whether a link may appear in the first unit of the piece, or has to wait for the last.
    link_in_last_reply: bool = False
    #: Whether a syndicated copy here has to carry a canonical address back to our own blog.
    #: True for every channel that republishes the source piece whole.
    canonical_back: bool = False
    #: Whether the piece is the origin itself. Exactly one channel may say true.
    is_origin: bool = False


#: The channel a piece is published AT first, and the only one that may be the origin. Section 3:
#: the blog post goes to heywobo.com first and nothing is released until it is indexed.
ORIGIN = "blog"

CHANNELS: tuple[Channel, ...] = (
    Channel(
        key=ORIGIN,
        name="The blog",
        tier=Tier.SCRIPT,
        because="Ours. It is the origin every other copy points back to.",
        is_origin=True,
    ),
    Channel(
        key="telegram",
        name="Telegram",
        tier=Tier.SCRIPT,
        because="Free, no approval regime, and its limits are far above a daily drop.",
    ),
    Channel(
        key="threads",
        name="Threads",
        tier=Tier.SCRIPT,
        because="A published API with a daily allowance far above our cadence.",
    ),
    Channel(
        key="instagram",
        name="Instagram",
        tier=Tier.SCRIPT,
        because="Reels and carousels post through the published content API.",
    ),
    Channel(
        key="facebook",
        name="The Facebook page",
        tier=Tier.SCRIPT,
        because="A page posts through the published API; a profile does not, and we have a page.",
    ),
    Channel(
        key="linkedin",
        name="The LinkedIn page",
        tier=Tier.SCRIPT,
        because="Document posts are the only real carousel available organically.",
        canonical_back=True,
    ),
    Channel(
        key="youtube",
        name="YouTube",
        tier=Tier.SCRIPT,
        because="Shorts and long form both upload through the published API.",
    ),
    Channel(
        key="x",
        name="X",
        tier=Tier.SCRIPT,
        because="Native threads post through the API, and the price decides where the link goes.",
        link_in_last_reply=True,
    ),
    Channel(
        key="medium",
        name="Medium",
        tier=Tier.PERSON,
        because="The write API is closed to new tokens, so the import tool and a person do it.",
        canonical_back=True,
    ),
    Channel(
        key="pinterest",
        name="Pinterest",
        tier=Tier.PERSON,
        because="A person decides what is worth pinning, and the volume never justified a wiring.",
    ),
    Channel(
        key="newsletter",
        name="The newsletter",
        tier=Tier.PERSON,
        because="Nothing reaches an inbox until a person has read it in full.",
    ),
    Channel(
        key="business-profile",
        name="The Google Business Profile",
        tier=Tier.PERSON,
        because="A posting surface a person keeps, and a machine has no business in a listing.",
    ),
    Channel(
        key="reddit",
        name="Reddit",
        tier=Tier.NEVER,
        because=(
            "The shadowbans are tuned for exactly the pattern a scheduler produces. Our presence "
            "is one named account answering with the whole worked solution and no link."
        ),
    ),
    Channel(
        key="quora",
        name="Quora",
        tier=Tier.NEVER,
        because="There is no write API at all, and answering well is a person's work.",
    ),
)

BY_KEY: dict[str, Channel] = {channel.key: channel for channel in CHANNELS}

#: The two, by name, so nothing downstream has to reconstruct the set from the tier. A test pins
#: this against :data:`CHANNELS` in both directions, so removing a channel from the tier without
#: removing it here fails, and the reverse fails too.
NEVER_AUTOMATED: frozenset[str] = frozenset({"reddit", "quora"})

#: Every spelling of the two that a hostname, a client name or an import would use. The
#: repository scan in the test reads this, so adding a lookalike domain here widens the net.
NEVER_AUTOMATED_MARKERS: frozenset[str] = frozenset(
    {
        "reddit.com",
        "oauth.reddit.com",
        "www.reddit.com",
        "old.reddit.com",
        "redd.it",
        "praw",
        "asyncpraw",
        "quora.com",
        "www.quora.com",
        "qoura.com",
    }
)


class NeverAutomated(Exception):
    """Something asked this package to produce, queue or send a shape for Reddit or Quora.

    Raised rather than returned, and never caught anywhere in this package. A caller that wanted
    a soft answer would be a caller building the queue this tier exists to not have.
    """


class UnknownChannel(ValueError):
    """A key that is not in :data:`CHANNELS`. Refused at the edge, never defaulted."""


def channel(key: str) -> Channel:
    """The channel, or :class:`UnknownChannel`. There is no permissive fallback on purpose."""
    found = BY_KEY.get((key or "").strip().lower())
    if found is None:
        raise UnknownChannel(f"no such channel: {key!r}")
    return found


def tier_of(key: str) -> Tier:
    return channel(key).tier


def may_a_script_post(key: str) -> bool:
    """True only for :data:`Tier.SCRIPT`. The one question the outbox asks."""
    return channel(key).tier is Tier.SCRIPT


def needs_a_person(key: str) -> bool:
    """True only for :data:`Tier.PERSON`. A NEVER channel does not 'need a person' here: it has
    no shape for a person to send, which is a different fact and is answered by :func:`refuse`."""
    return channel(key).tier is Tier.PERSON


def refuse(key: str) -> None:
    """Raise if this key may never be automated. Called at the top of every producing path.

    Takes the raw key rather than a :class:`Channel` so that a string from a dial, a request body
    or a store row is refused before anything has resolved it into an object.
    """
    if (key or "").strip().lower() in NEVER_AUTOMATED:
        raise NeverAutomated(
            f"{key} is tier 3: no automation, ever, not even a draft in a queue "
            "(docs/GROWTH-DESK.md section 2)"
        )


def script_channels() -> tuple[Channel, ...]:
    return tuple(c for c in CHANNELS if c.tier is Tier.SCRIPT)


def person_channels() -> tuple[Channel, ...]:
    return tuple(c for c in CHANNELS if c.tier is Tier.PERSON)


def never_channels() -> tuple[Channel, ...]:
    return tuple(c for c in CHANNELS if c.tier is Tier.NEVER)


def origin() -> Channel:
    """The one origin channel. Raises if the table ever grows a second, which would make
    'publish then syndicate' meaningless."""
    origins = [c for c in CHANNELS if c.is_origin]
    if len(origins) != 1:
        raise UnknownChannel(f"there must be exactly one origin channel, found {len(origins)}")
    return origins[0]


__all__ = [
    "BY_KEY",
    "CHANNELS",
    "NEVER_AUTOMATED",
    "NEVER_AUTOMATED_MARKERS",
    "ORIGIN",
    "Channel",
    "NeverAutomated",
    "Tier",
    "UnknownChannel",
    "channel",
    "may_a_script_post",
    "needs_a_person",
    "never_channels",
    "origin",
    "person_channels",
    "refuse",
    "script_channels",
    "tier_of",
]
