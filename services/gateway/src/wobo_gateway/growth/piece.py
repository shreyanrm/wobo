"""MAKE: one answer-first source piece per topic, and the gate it has to clear to exist.

``docs/GROWTH-DESK.md`` section 4.2 and section 3. Section 3 is the one that decides the shape of
this file:

    *"Scaled content abuse is when many pages are generated for the primary purpose of
    manipulating search rankings and not helping users"*, and the named example is generating many
    pages with a generative model without adding value. The discriminator is not the machine and
    not the volume. It is the marginal value of each page.

So a piece does not exist because a topic could be ranked for it. It exists because it passes
:func:`check`, and every count this desk prints anywhere is a count of pieces that passed, which
is the honest-count law (``docs/WOBO-TASKS`` section 10.21) applied to the one place that could
manufacture a large number overnight.

**What a piece has to carry, and every one of the five is measured rather than declared.**

1. **An answer in the first line.** A reader who stops after the opening is not stranded
   (``docs/copy/voice.md`` section 4). It has to be a sentence, not a title, and it has to stand
   alone without the heading above it.
2. **Its own words, enough of them, in three sections at least.** The floor is the blog's own
   floor, because the blog post is one of the five shapes and a piece that cannot clear the build
   gate downstream must not be drafted at all. :func:`own_words` counts what this piece wrote and
   nothing it shares with its siblings.
3. **Provenance.** The official document each fact came from, the page inside it, the hash of the
   bytes we read and the day we read them. ``docs/GROWTH-SEARCH.md`` section 3: this is the rarest
   thing we own and no content farm can copy it.
4. **A drawn figure, from the board pipeline, with its numbers verified.** Not one competitor page
   in the audit carried an original explanatory figure. It is the wedge, so it is required, and
   **today nothing supplies it**: the concept cores are designed and not built. A piece therefore
   fails this rule by name rather than publishing without the thing that makes it worth reading.
   That is the desk being honest about its own state, and it is why :func:`check` reports every
   reason rather than the first.
5. **A screen over every word.** :mod:`wobo_gateway.growth.screen` holds the copy law, and it runs
   over everything a reader sees, including the headings and the figure's own description.

**The film is required for the Short and for nothing else.** The law asks for a short film as well
as a figure, and :mod:`wobo_gateway.growth.shapes` will not build a Short without one. A piece
with a figure and no film is a publishable piece that produces four shapes instead of five, and
the missing one is recorded as owed rather than faked, which is the same rule the tier-one
syllabus pages already follow: a page never implies it has a thing it does not have.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from wobo_gateway.growth import campaigns, screen

#: The word floor, and it is the blog's own (``blog/post.ts`` POST_WORD_FLOOR). Not padding to a
#: number: roughly the length at which a page can carry an answer, the working behind it and the
#: honest limit.
WORD_FLOOR = 600
#: The opening line has to be a sentence that answers, not a label.
LEAD_WORD_FLOOR = 10
#: Three sections at least, so a reader can jump through the page instead of scrolling it.
SECTION_FLOOR = 3
#: A section thinner than this is a heading with a sentence under it, which is furniture.
SECTION_WORD_FLOOR = 40
#: What a search result can actually show.
SUMMARY_MIN = 60
SUMMARY_MAX = 160
#: At least one document behind the piece, and every field of it filled.
SOURCE_FLOOR = 1

#: How alike two slugs may be before the second is the first at another address. Compared on the
#: content words, so ``work-and-energy`` and ``work-energy-and-power`` collide, which is exactly
#: the pair the live demand ranking produces and exactly the pair a content farm would publish
#: both of.
SLUG_OVERLAP_CEILING = 0.6


@dataclass(frozen=True)
class Provenance:
    """The official document a line came from. Every field required, none defaulted."""

    document: str
    publisher: str
    url: str
    sha256: str
    read_on: str
    page: str = ""

    def complete(self) -> bool:
        return bool(
            self.document.strip()
            and self.publisher.strip()
            and self.url.strip()
            and re.fullmatch(r"[0-9a-f]{64}", self.sha256.strip() or "")
            and _is_a_day(self.read_on)
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "document": self.document,
            "publisher": self.publisher,
            "url": self.url,
            "sha256": self.sha256,
            "read_on": self.read_on,
            "page": self.page,
        }


@dataclass(frozen=True)
class Figure:
    """A drawn explanation from the board pipeline, and whether its numbers crossed the verifier.

    ``verified`` is not a courtesy field. ``wobo_gateway.board.verify`` is the gate every number
    the board draws has to cross, and a figure that skipped it is a picture of an answer rather
    than an answer. The gate refuses an unverified figure the same way it refuses a missing one.
    """

    concept: str
    #: What the figure shows, in words, for the alt text and for the screen to read.
    alt: str
    #: The board turn this came out of, so a person can find it again.
    turn_id: str
    verified: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "concept": self.concept,
            "alt": self.alt,
            "turn_id": self.turn_id,
            "verified": self.verified,
        }


@dataclass(frozen=True)
class Film:
    """A short film from the film pipeline. Optional, and its absence is recorded, never hidden."""

    concept: str
    seconds: int
    #: The spoken script, screened like every other word.
    script: str
    asset_id: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "concept": self.concept,
            "seconds": self.seconds,
            "script": self.script,
            "asset_id": self.asset_id,
        }


@dataclass(frozen=True)
class Section:
    heading: str
    body: str

    def as_dict(self) -> dict[str, Any]:
        return {"heading": self.heading, "body": self.body}


@dataclass
class Piece:
    """One source piece. The five shapes are built from this and never from each other."""

    slug: str
    title: str
    #: The meta description, and the line under the title on the index.
    summary: str
    #: The opening line, which answers on its own.
    lead: str
    sections: list[Section] = field(default_factory=list)
    provenance: list[Provenance] = field(default_factory=list)
    figure: Figure | None = None
    film: Film | None = None
    #: The concept this is about, and where our syllabus teaches it. From
    #: :class:`wobo_gateway.growth.demand.Topic`.
    topic_slug: str = ""
    topic_name: str = ""
    boards: list[str] = field(default_factory=list)
    #: The blog's own tag keys. The blog gate refuses a post with no tag that exists.
    tags: list[str] = field(default_factory=lambda: ["how-wobo-teaches"])
    #: The blog's author key. A desk, never an invented person, until the owner names one.
    author: str = "teaching-desk"
    #: Stated every time, on the origin and on every syndicated copy. Section 3 requires it and
    #: Medium demotes an undisclosed machine-written piece.
    ai_assisted: bool = True
    drafted_on: str = ""

    # --- the words -----------------------------------------------------------------------------
    def reader_text(self) -> str:
        """Everything a reader sees, as one blob, for the screen. The figure's description is in
        here because alt text is read aloud and is copy like any other."""
        parts = [self.title, self.summary, self.lead]
        for section in self.sections:
            parts.append(section.heading)
            parts.append(section.body)
        if self.figure:
            parts.append(self.figure.alt)
        if self.film:
            parts.append(self.film.script)
        return "\n\n".join(p for p in parts if p)

    def own_words(self) -> int:
        """The words this piece wrote: the lead and the sections. Not the title, not the summary,
        not the standing note every sibling carries. The same qualification the syllabus families
        make, and for the same reason: counted furniture is a floor a blank page clears."""
        text = " ".join([self.lead, *(s.body for s in self.sections)])
        return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’-]*", text))

    def paragraphs(self) -> list[str]:
        """The piece's paragraphs, normalised, for the "no two pieces share one" check."""
        raw = [self.lead, *(s.body for s in self.sections)]
        out: list[str] = []
        for block in raw:
            for para in re.split(r"\n\s*\n", block or ""):
                flat = re.sub(r"\s+", " ", para).strip().lower()
                if len(flat) >= 40:
                    out.append(flat)
        return out

    def fingerprints(self) -> frozenset[str]:
        return frozenset(hashlib.sha256(p.encode()).hexdigest() for p in self.paragraphs())

    def as_dict(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "title": self.title,
            "summary": self.summary,
            "lead": self.lead,
            "sections": [s.as_dict() for s in self.sections],
            "provenance": [p.as_dict() for p in self.provenance],
            "figure": self.figure.as_dict() if self.figure else None,
            "film": self.film.as_dict() if self.film else None,
            "topic_slug": self.topic_slug,
            "topic_name": self.topic_name,
            "boards": list(self.boards),
            "tags": list(self.tags),
            "author": self.author,
            "ai_assisted": self.ai_assisted,
            "drafted_on": self.drafted_on,
            "words": self.own_words(),
        }


@dataclass(frozen=True)
class Published:
    """A piece that is already out, as much of it as the gate needs to compare against."""

    slug: str
    fingerprints: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Verdict:
    """Publishable, or every reason it is not. Plain sentences: they end up on a screen."""

    publishable: bool
    because: tuple[str, ...] = ()
    violations: tuple[screen.Violation, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "publishable": self.publishable,
            "because": list(self.because),
            "violations": [v.as_dict() for v in self.violations],
        }


def _is_a_day(value: str) -> bool:
    try:
        date.fromisoformat((value or "").strip())
    except ValueError:
        return False
    return True


def slug_words(slug: str) -> frozenset[str]:
    from wobo_gateway.growth import demand

    return frozenset(demand.content_words(slug.replace("-", " ")))


def too_alike(slug: str, other: str) -> bool:
    """Are these two the same page at two addresses? Jaccard over the content words.

    The live demand ranking really does produce ``work-and-energy``, ``work-energy-and-power`` and
    ``work-power-and-energy`` as three separate topics, because three boards title one chapter
    three ways. Publishing all three would be the duplicate a content farm publishes, so the
    second one through this check is refused and the piece that exists is widened instead.
    """
    left, right = slug_words(slug), slug_words(other)
    if not left or not right:
        return False
    return len(left & right) / len(left | right) >= SLUG_OVERLAP_CEILING


def check(piece: Piece, *, published: tuple[Published, ...] = ()) -> Verdict:
    """The gate. Every reason it fails, never just the first.

    ``published`` is what is already out, so this can refuse a second address for one idea and a
    paragraph that already exists elsewhere on our own site. An empty tuple means "nothing is out
    yet", which is true today and is not a way of skipping the check.
    """
    because: list[str] = []

    if not campaigns.slugify(piece.slug) or campaigns.slugify(piece.slug) != piece.slug:
        because.append(
            f"its address {piece.slug!r} is not a slug, so it cannot be an address or a campaign id"
        )
    if not piece.title.strip():
        because.append("has no title")

    lead = piece.lead.strip()
    lead_words = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’-]*", lead))
    if lead_words < LEAD_WORD_FLOOR:
        because.append(
            f"opens on {lead_words} words, under {LEAD_WORD_FLOOR}, which is a label rather than "
            "an answer a reader can stop at"
        )
    if lead and lead[-1] not in ".?":
        because.append("its opening line is not a sentence, so it does not answer on its own")

    if len(piece.summary.strip()) < SUMMARY_MIN:
        because.append(
            f"summarises itself in {len(piece.summary.strip())} characters, under {SUMMARY_MIN}, "
            "which is a label rather than something a search result can show"
        )
    elif len(piece.summary.strip()) > SUMMARY_MAX:
        because.append(
            f"summarises itself in {len(piece.summary.strip())} characters, over {SUMMARY_MAX}, "
            "which a search result cuts off mid-word"
        )

    if len(piece.sections) < SECTION_FLOOR:
        because.append(
            f"has {len(piece.sections)} sections, under {SECTION_FLOOR}, so a reader has to scroll "
            "it rather than jump through it"
        )
    headings = [s.heading.strip().lower() for s in piece.sections]
    if len(set(headings)) != len(headings):
        because.append("repeats a heading, so two of its sections are the same section")
    for section in piece.sections:
        if not section.heading.strip():
            because.append("has a section with no heading")
        words = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’-]*", section.body))
        if words < SECTION_WORD_FLOOR:
            because.append(
                f"the section {section.heading.strip()!r} carries {words} words, under "
                f"{SECTION_WORD_FLOOR}, which is a heading with furniture under it"
            )

    words = piece.own_words()
    if words < WORD_FLOOR:
        because.append(
            f"carries {words} of its own words, under {WORD_FLOOR}, which is below the length at "
            "which a page can hold an answer, the working behind it and the honest limit"
        )

    complete_sources = [p for p in piece.provenance if p.complete()]
    if len(complete_sources) < SOURCE_FLOOR:
        because.append(
            "carries no complete provenance: a source needs the document, the publisher, its "
            "address, the sha256 of the bytes we read and the day we read them"
        )
    incomplete = len(piece.provenance) - len(complete_sources)
    if incomplete:
        because.append(
            f"{incomplete} of its sources is missing a field, and a half-cited source is worse "
            "than none because it looks cited"
        )

    if piece.figure is None:
        because.append(
            "has no drawn figure. The concept cores the board pipeline draws from are designed "
            "and not built (docs/GROWTH-SEARCH.md section 3), so nothing supplies one yet, and "
            "the figure is the whole reason this page is worth more than a content farm's"
        )
    elif not piece.figure.verified:
        because.append(
            "its figure did not cross the verifier, so its numbers are a picture of an answer "
            "rather than an answer"
        )
    elif not piece.figure.alt.strip():
        because.append("its figure has no description, so it is unreadable to anyone not looking")

    if not piece.tags:
        because.append("declares no tag, and the blog gate refuses a post without one")
    if not piece.author.strip():
        because.append(
            "declares no author, and a byline nobody decided is a byline somebody invented"
        )
    if not _is_a_day(piece.drafted_on):
        because.append("carries no real date")

    for already in published:
        if already.slug != piece.slug and too_alike(piece.slug, already.slug):
            because.append(
                f"is the same idea as {already.slug!r} at a second address, which is the duplicate "
                "a content farm publishes; widen that piece instead"
            )
        shared = piece.fingerprints() & already.fingerprints
        if shared:
            because.append(
                f"shares {len(shared)} paragraph{'s' if len(shared) > 1 else ''} with "
                f"{already.slug!r}, and a paragraph at two addresses is one page pretending "
                "to be two"
            )

    violations = tuple(screen.screen(piece.reader_text(), where=f"piece {piece.slug}"))
    because.extend(f"{v.says}" for v in violations)

    return Verdict(publishable=not because, because=tuple(because), violations=violations)


def publishable(pieces: tuple[Piece, ...], *, published: tuple[Published, ...] = ()) -> list[Piece]:
    """The ones that passed, in order, each checked against the ones ahead of it.

    Checked cumulatively on purpose: two drafts of the same idea in one batch would both pass a
    check made against only what was already out, and the second one would go up an hour later.
    """
    out: list[Piece] = []
    seen = list(published)
    for piece in pieces:
        if check(piece, published=tuple(seen)).publishable:
            out.append(piece)
            seen.append(Published(slug=piece.slug, fingerprints=piece.fingerprints()))
    return out


__all__ = [
    "LEAD_WORD_FLOOR",
    "SECTION_FLOOR",
    "SECTION_WORD_FLOOR",
    "SLUG_OVERLAP_CEILING",
    "SOURCE_FLOOR",
    "SUMMARY_MAX",
    "SUMMARY_MIN",
    "WORD_FLOOR",
    "Figure",
    "Film",
    "Piece",
    "Provenance",
    "Published",
    "Section",
    "Verdict",
    "check",
    "publishable",
    "slug_words",
    "too_alike",
]
