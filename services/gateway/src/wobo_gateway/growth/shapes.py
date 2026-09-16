"""The five shapes of one piece, and the channels each one may go to.

``docs/GROWTH-DESK.md`` section 4.2: *"five shapes from the one piece: the blog post, the Medium
repost, a LinkedIn document, an X thread, a Short."* Every shape is built from the
:class:`~wobo_gateway.growth.piece.Piece` and never from another shape, so a correction to the
piece reaches all five and a mistake in one shape cannot copy itself into the next.

**One shape, several channels, one campaign id per channel.** The thread is the same thread on X,
Threads and Telegram; the Short is the same film on YouTube, Instagram and the Facebook page; the
document is the same pages on LinkedIn and on Pinterest. What differs per channel is who sends it
(:mod:`.channels`) and the ``utm_id`` on its link (:mod:`.campaigns`), so a :class:`Post` is one
shape on one channel and carries its own id. Reddit and Quora appear in no destination list, and
:func:`posts_for` calls :func:`channels.refuse` on every key it is handed, so a table edit that
added one would fail before a single word was built for it.

**The two rules that are properties of a shape, not of a writer's taste.**

1. *X's price puts the link in the last reply.* A post with a link costs about thirteen times one
   without, so on a channel whose :attr:`~.channels.Channel.link_in_last_reply` is set, every unit
   but the last is refused if it carries an address, and the last one carries it. The same order
   is used on Threads and Telegram, where it costs nothing and reads the same.
2. *A syndicated copy points home.* Every channel with ``canonical_back`` carries the origin
   address, and Medium's copy carries the assistance note from ``docs/copy/blog/README.md``, word
   for word, because Medium demotes an undisclosed machine-written piece and because it is true.

**The Short needs a film.** A piece with no film builds four shapes and records the fifth as owed,
with the reason, rather than cutting a Short out of a still figure.

Every word a reader would see in a shape is screened (:mod:`.screen`) as it is built, and a shape
that fails the screen is owed with the screen's own reasons, not posted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from wobo_gateway.growth import campaigns, channels, screen
from wobo_gateway.growth.piece import Piece

#: The site the origin lives on. An address, never a name a person reads as the brand.
SITE = "https://heywobo.com"
BLOG_PATH = "/blog"

BLOG = "blog"
MEDIUM = "medium"
DOCUMENT = "document"
THREAD = "thread"
SHORT = "short"
#: The five, in the order a piece is released: the origin first, always.
KINDS: tuple[str, ...] = (BLOG, MEDIUM, DOCUMENT, THREAD, SHORT)

#: Where each shape may go. Tier 3 is in none of these lists and never will be.
DESTINATIONS: dict[str, tuple[str, ...]] = {
    BLOG: (channels.ORIGIN,),
    MEDIUM: ("medium", "newsletter"),
    DOCUMENT: ("linkedin", "pinterest"),
    THREAD: ("x", "threads", "telegram"),
    SHORT: ("youtube", "instagram", "facebook"),
}

#: X counts characters and so do we. Threads allows more; the thread is written to the tighter one.
THREAD_UNIT_MAX = 280
#: A LinkedIn document page carries a heading and a paragraph a phone can read without zooming.
DOCUMENT_PAGE_WORDS = 45
#: The note, verbatim from ``docs/copy/blog/README.md`` "The assistance note". Not new copy.
ASSISTANCE_NOTE = (
    "Drafted with AI help, from source documents and notes a person gathered, then read and "
    "edited by a person before it went up. Every figure in it is one we can show you the source of."
)

#: The sentences the shapes add of their own. Every one is listed for the owner's review.
LAST_REPLY = "The whole explanation, with the drawn figure and where every fact comes from: {link}"
FIRST_APPEARED = "This piece first appeared on the Wobo blog: {link}"
SOURCES_HEADING = "Where this comes from"
SOURCE_LINE = "{document}, published by {publisher}{page}, read on {read_on}."
FIGURE_LINE = "The figure: {alt}"
DOCUMENT_LAST_PAGE = (
    "The whole explanation, with the drawn figure and where every fact comes from, is on the Wobo "
    "blog."
)

_URL = re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(?:com|in|org|net|co)\b", re.I)


class ShapeRefused(ValueError):
    """A shape that could not be built honestly. The reason goes on the desk as owed."""


def origin_url(slug: str) -> str:
    return f"{SITE}{BLOG_PATH}/{slug}"


def blog_file_name(slug: str, number: int) -> str:
    """``docs/copy/blog/NN-slug.md``, the blog compiler's own naming."""
    return f"{number:02d}-{slug}.md"


@dataclass(frozen=True)
class Post:
    """One shape, on one channel, with its own campaign id. What the outbox holds."""

    kind: str
    channel: str
    campaign_id: str
    title: str
    #: The units in order: one for a blog post or a Medium copy, one per reply for a thread, one
    #: per page for a document, one per scene for a Short.
    units: tuple[str, ...]
    #: The tagged address this post points at, or ``""`` for the origin itself.
    link: str = ""
    #: The origin address, on every copy that republishes the piece.
    canonical: str = ""
    #: Attachments by reference: the figure's board turn, the film's asset.
    media: dict[str, str] = field(default_factory=dict)

    @property
    def tier(self) -> channels.Tier:
        return channels.tier_of(self.channel)

    def text(self) -> str:
        return "\n\n".join(self.units)

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "channel": self.channel,
            "campaign_id": self.campaign_id,
            "title": self.title,
            "units": list(self.units),
            "link": self.link,
            "canonical": self.canonical,
            "media": dict(self.media),
            "tier": self.tier.value,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Post:
        return cls(
            kind=str(raw.get("kind") or ""),
            channel=str(raw.get("channel") or ""),
            campaign_id=str(raw.get("campaign_id") or ""),
            title=str(raw.get("title") or ""),
            units=tuple(str(u) for u in raw.get("units") or ()),
            link=str(raw.get("link") or ""),
            canonical=str(raw.get("canonical") or ""),
            media={str(k): str(v) for k, v in (raw.get("media") or {}).items()},
        )


@dataclass(frozen=True)
class Built:
    """Every post a piece produced, and every shape it could not, with the reason in words."""

    posts: tuple[Post, ...]
    owed: dict[str, str]


# --- the words of each shape ----------------------------------------------------------------------
def _sources(piece: Piece) -> list[str]:
    out: list[str] = []
    for source in piece.provenance:
        if not source.complete():
            continue
        page = f", {source.page}" if source.page.strip() else ""
        out.append(
            SOURCE_LINE.format(
                document=source.document.strip(),
                publisher=source.publisher.strip(),
                page=page,
                read_on=source.read_on.strip(),
            )
            + f" {source.url.strip()}"
        )
    return out


def blog_markdown(piece: Piece, *, published: str) -> str:
    """The origin, as a file the blog compiler reads (``docs/copy/blog/README.md``)."""
    lines = [
        "---",
        f"title: {piece.title.strip()}",
        f"summary: {piece.summary.strip()}",
        f"published: {published}",
        f"author: {piece.author}",
        f"tags: {', '.join(piece.tags)}",
        f"ai-assisted: {'true' if piece.ai_assisted else 'false'}",
        "---",
        "",
        f"**{piece.lead.strip()}**",
        "",
    ]
    for section in piece.sections:
        lines += [f"## {section.heading.strip()}", "", section.body.strip(), ""]
    if piece.figure is not None:
        lines += [FIGURE_LINE.format(alt=piece.figure.alt.strip()), ""]
    sources = _sources(piece)
    if sources:
        lines += [f"## {SOURCES_HEADING}", ""]
        lines += [f"- {line}" for line in sources]
        lines.append("")
    return "\n".join(lines)


def _medium(piece: Piece, origin: str) -> str:
    """The whole piece, pointing home, disclosed. A person imports it with the origin address,
    which is what makes Medium set the canonical; the line at the foot says so to a reader."""
    parts = [piece.title.strip(), piece.lead.strip()]
    for section in piece.sections:
        parts += [section.heading.strip(), section.body.strip()]
    parts += [FIRST_APPEARED.format(link=origin), ASSISTANCE_NOTE]
    return "\n\n".join(parts)


def _first_words(text: str, limit: int) -> str:
    """The opening of a paragraph, cut on a sentence where one fits and on a word where not."""
    flat = re.sub(r"\s+", " ", (text or "").strip())
    sentences = re.split(r"(?<=[.?])\s+", flat)
    out = ""
    for sentence in sentences:
        candidate = f"{out} {sentence}".strip()
        if len(candidate.split()) > limit:
            break
        out = candidate
    if out:
        return out
    words = flat.split()[:limit]
    return " ".join(words).rstrip(",;:") + "."


def _fit(text: str, limit: int) -> str:
    """One thread unit under ``limit`` characters, ended on a sentence."""
    flat = re.sub(r"\s+", " ", (text or "").strip())
    if len(flat) <= limit:
        return flat
    out = ""
    for sentence in re.split(r"(?<=[.?])\s+", flat):
        candidate = f"{out} {sentence}".strip()
        if len(candidate) > limit:
            break
        out = candidate
    if not out:
        raise ShapeRefused(f"a sentence is longer than one post can carry ({limit} characters)")
    return out


def _thread(piece: Piece, link: str) -> tuple[str, ...]:
    units = [_fit(piece.lead, THREAD_UNIT_MAX)]
    for section in piece.sections:
        units.append(_fit(_first_words(section.body, 60), THREAD_UNIT_MAX))
    last = LAST_REPLY.format(link=link)
    if len(last) > THREAD_UNIT_MAX:
        raise ShapeRefused("the address is too long for the last reply")
    units.append(last)
    return tuple(units)


def _document(piece: Piece) -> tuple[str, ...]:
    pages = [f"{piece.title.strip()}\n\n{piece.lead.strip()}"]
    for section in piece.sections:
        pages.append(
            f"{section.heading.strip()}\n\n{_first_words(section.body, DOCUMENT_PAGE_WORDS)}"
        )
    pages.append(DOCUMENT_LAST_PAGE)
    return tuple(pages)


def _short(piece: Piece, link: str) -> tuple[str, ...]:
    if piece.film is None:
        raise ShapeRefused(
            "no film: the film pipeline has not made one for this concept, and a Short cut from "
            "a still figure would be a picture pretending to move"
        )
    script = piece.film.script.strip()
    if not script:
        raise ShapeRefused("the film has no script to caption")
    return (script, f"{piece.title.strip()}. {LAST_REPLY.format(link=link)}")


# --- building -------------------------------------------------------------------------------------
def _units_for(
    kind: str, piece: Piece, *, link: str, origin: str, published: str
) -> tuple[str, ...]:
    if kind == BLOG:
        return (blog_markdown(piece, published=published),)
    if kind == MEDIUM:
        return (_medium(piece, origin),)
    if kind == DOCUMENT:
        return _document(piece)
    if kind == THREAD:
        return _thread(piece, link)
    if kind == SHORT:
        return _short(piece, link)
    raise ShapeRefused(f"no such shape: {kind}")


def _check_links(post: Post) -> None:
    """X's rule, and the origin's: the link lives in the last unit and nowhere before it."""
    if channels.channel(post.channel).link_in_last_reply or post.kind == THREAD:
        for unit in post.units[:-1]:
            if _URL.search(unit):
                raise ShapeRefused(
                    f"{post.channel}: an address appears before the last reply, which is the "
                    "expensive post and not the one the platform rewards"
                )
        if post.link and post.link not in post.units[-1]:
            raise ShapeRefused(f"{post.channel}: the last reply does not carry the link")


def _screen_text(kind: str, units: tuple[str, ...]) -> str:
    """What a reader sees. The blog file's front matter keys and its bare source addresses are
    furniture, not prose, so they are left out of the screen rather than tripping it."""
    text = "\n\n".join(units)
    if kind == BLOG:
        text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
    return re.sub(r"https?://\S+", "", text)


def posts_for(
    piece: Piece,
    *,
    when: date | datetime | None = None,
    attempt: int = 1,
    only: tuple[str, ...] | None = None,
) -> Built:
    """Every post this piece makes, one per shape per destination, each with its campaign id.

    ``only`` limits the channels (the dials turn a channel off); a tier 3 key in it raises.
    """
    for key in only or ():
        channels.refuse(key)
    origin = origin_url(piece.slug)
    day = when.date() if isinstance(when, datetime) else when
    published = (day or date.fromisoformat(piece.drafted_on)).isoformat()
    posts: list[Post] = []
    owed: dict[str, str] = {}
    for kind in KINDS:
        for key in DESTINATIONS[kind]:
            channels.refuse(key)
            if only is not None and key not in only:
                continue
            campaign = campaigns.build(key, piece.slug, attempt=attempt, when=when)
            link = "" if key == channels.ORIGIN else campaigns.tag(origin, campaign)
            label = f"{kind} on {key}"
            try:
                units = _units_for(kind, piece, link=link, origin=origin, published=published)
            except ShapeRefused as refused:
                owed[label] = str(refused)
                continue
            media: dict[str, str] = {}
            if piece.figure is not None:
                media["figure_turn"] = piece.figure.turn_id
            if kind == SHORT and piece.film is not None:
                media["film_asset"] = piece.film.asset_id
            post = Post(
                kind=kind,
                channel=key,
                campaign_id=campaign,
                title=piece.title.strip(),
                units=units,
                link=link,
                canonical="" if key == channels.ORIGIN else origin,
                media=media,
            )
            try:
                _check_links(post)
            except ShapeRefused as refused:
                owed[label] = str(refused)
                continue
            found = screen.screen(_screen_text(kind, units), where=label)
            if found:
                owed[label] = "; ".join(v.says for v in found)
                continue
            posts.append(post)
    return Built(posts=tuple(posts), owed=owed)


__all__ = [
    "ASSISTANCE_NOTE",
    "BLOG",
    "DESTINATIONS",
    "DOCUMENT",
    "DOCUMENT_LAST_PAGE",
    "FIGURE_LINE",
    "FIRST_APPEARED",
    "KINDS",
    "LAST_REPLY",
    "MEDIUM",
    "SHORT",
    "SITE",
    "SOURCES_HEADING",
    "SOURCE_LINE",
    "THREAD",
    "THREAD_UNIT_MAX",
    "Built",
    "Post",
    "ShapeRefused",
    "blog_file_name",
    "blog_markdown",
    "origin_url",
    "posts_for",
]
