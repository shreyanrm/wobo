"""GATHER: what people are actually asking, ranked by demand and by whether we can answer it.

``docs/GROWTH-DESK.md`` section 4.1 names four sources and one ranking. This module holds all
five, and it holds the two sources we do NOT have in exactly the same table as the two we do,
because a gather step that silently skips half its inputs is a gather step that looks finished.
:data:`SOURCES` is that table and the console prints it verbatim.

**What is live.**

* **The autocomplete harvest.** 17,928 real queries from Google and Bing for India, taken on
  2026-09-09, in ``content/growth/harvest.json`` with its hash and counts in ``manifest.json``.
  1,771 of them were suggested by BOTH engines, which is the strongest signal in the file.
* **The syllabus we have actually read.** 333 units and 711 topics across four boards, from the
  same seed the public syllabus pages are built from.

**What is not, and neither is faked.** Search Console is not verified, so we cannot see the
queries we nearly rank for. We hold no board's date sheet as a document, so there is no exam
calendar to rank against, and ``apps/web-pwa/src/screens/growth/examCycle.ts`` already refuses to
print a date we have not read off a board's own page; this module makes the same refusal for the
same reason. The study subreddits are read by a person and never by a crawler, because Reddit is
tier 3 (``docs/GROWTH-DESK.md`` section 2) and the cheapest way to keep a rule like that is to
have no code that touches the site at all. And our own learners' questions are in the product, but
nothing rolls them up for an operator yet.

**The ranking, and why it is two numbers rather than one.**

*Demand* is what the engines said: two engines suggesting a query outranks one, and nothing here
pretends to be a volume figure, because autocomplete is not one. *Answerability* is how squarely
the query lands on a node of the syllabus we hold, because the law ranks "by how well a cached
concept core already answers it" and a concept core is keyed on a syllabus node. A query with
enormous demand that our syllabus cannot answer is a query for a page family, not for a source
piece, and it ranks below a smaller one we can answer properly. :data:`ANSWERABILITY` carries the
four cases in one place.

A :class:`Topic` is what MAKE consumes: one syllabus node, the queries that landed on it, and the
demand they carry between them. One source piece per topic, in rank order, at the cadence the
dials allow.
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

# --- where the data lives -------------------------------------------------------------------------
#: ``services/gateway/src/wobo_gateway/growth/demand.py`` up to the repository root.
_REPO = Path(__file__).resolve().parents[5]
DATA_DIR = Path(os.getenv("GROWTH_DATA_DIR") or (_REPO / "content" / "growth"))
HARVEST_FILE = "harvest.json"
CURRICULUM_FILE = "curriculum.json"
MANIFEST_FILE = "manifest.json"


class DataUnavailable(Exception):
    """The demand data is not on disk. Read as "no demand to report", never as "no demand"."""


# --- the source table -----------------------------------------------------------------------------
@dataclass(frozen=True)
class Source:
    """One input to the gather step, and whether anything actually supplies it.

    ``because`` and ``would_fill`` are required on an absent source and both have to name a thing
    an engineer can open or a piece of work somebody can pick up. The console prints them where a
    count would otherwise sit, exactly as the operator desks do.
    """

    key: str
    what: str
    live: bool
    because: str = ""
    would_fill: str = ""

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"key": self.key, "what": self.what, "live": self.live}
        if not self.live:
            out["because"] = self.because
            out["would_fill"] = self.would_fill
        return out


SOURCES: tuple[Source, ...] = (
    Source(
        key="autocomplete",
        what="What Google and Bing suggest for India, harvested and hashed.",
        live=True,
    ),
    Source(
        key="syllabus",
        what="The units and topics of the boards whose documents we hold.",
        live=True,
    ),
    Source(
        key="search-console",
        what="The queries we nearly rank for, from our own Search Console property.",
        live=False,
        because=(
            "No Search Console property is verified for heywobo.com and no credential is "
            "configured, so there is nothing to read. docs/GROWTH-DESK.md section 5 puts this at "
            "twenty minutes of work: a domain property verified by a DNS record that stays, the "
            "sitemap submitted, and IndexNow on the Bing side."
        ),
        would_fill=(
            "A verified property, a service account with read access to the Search Analytics API, "
            "and a daily pull of query, impressions, clicks and average position for the pages "
            "already indexed. Positions between about five and twenty are the ones worth writing "
            "for, which is the whole point of this source."
        ),
    ),
    Source(
        key="exam-dates",
        what="Board examination and result dates, to rank the seasonal demand.",
        live=False,
        because=(
            "We hold no board's date sheet as a document. The exam-cycle pages already refuse to "
            "print a date we have not read off the board's own page, and inventing a calendar "
            "here to rank against would put that date back on a screen through the side door."
        ),
        would_fill=(
            "The same treatment every syllabus document gets: fetch the board's own date sheet, "
            "record the publisher, the address, the page, the hash of the bytes and the day we "
            "read it, and rank the seasonal queries against that."
        ),
    ),
    Source(
        key="study-subreddits",
        what="The questions being asked in the study subreddits, and People Also Ask.",
        live=False,
        because=(
            "Reddit is tier 3: no automation at all, ever, and the cheapest way to keep that rule "
            "is to have no code in this repository that touches the site. A person reads the "
            "subreddits and answers there in their own name. People Also Ask has no interface "
            "that may be read by a machine either."
        ),
        would_fill=(
            "A person's own notes, pasted into the desk as topics. That is deliberately a person's "
            "work and not a job, and it stays that way."
        ),
    ),
    Source(
        key="our-learners",
        what="What our own learners asked most, rolled up with no learner in it.",
        live=False,
        because=(
            "Nothing aggregates the questions learners ask. ops.usage_daily counts calls and "
            "knows a learner only as a salted one-way digest, which is deliberately not enough to "
            "group by what was asked."
        ),
        would_fill=(
            "A counts-only rollup of asked concepts per day, keyed on the syllabus node and never "
            "on a learner, written where the tutor already resolves a turn to a node."
        ),
    ),
)


def sources() -> list[dict[str, Any]]:
    return [source.as_dict() for source in SOURCES]


def live_sources() -> tuple[str, ...]:
    return tuple(source.key for source in SOURCES if source.live)


# --- reading the data -----------------------------------------------------------------------------
@dataclass(frozen=True)
class Node:
    """One node of the syllabus we hold: a unit, or a topic under one."""

    board: str
    level: str
    subject: str
    unit: str
    name: str
    kind: str  # "unit" or "topic"

    @property
    def key(self) -> str:
        return f"{self.board}/{self.level}/{self.subject}/{self.unit}/{self.name}".lower()


_lock = threading.Lock()


def _read(name: str) -> Any:
    path = DATA_DIR / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DataUnavailable(f"{path} is not there") from exc
    except (OSError, ValueError) as exc:
        raise DataUnavailable(f"{path} could not be read: {exc}") from exc


@lru_cache(maxsize=1)
def manifest() -> dict[str, Any]:
    """The counts, hashes and sources of the data files. Printed rather than summarised."""
    got = _read(MANIFEST_FILE)
    if not isinstance(got, dict):
        raise DataUnavailable(f"{MANIFEST_FILE} is not an object")
    return got


@lru_cache(maxsize=1)
def harvest() -> dict[str, tuple[str, ...]]:
    """``{query: (engines,)}``. Engines are ``g`` and ``b``, and both is the strong signal."""
    got = _read(HARVEST_FILE)
    if not isinstance(got, dict):
        raise DataUnavailable(f"{HARVEST_FILE} is not an object")
    out: dict[str, tuple[str, ...]] = {}
    for query, engines in got.items():
        if not isinstance(query, str) or not query.strip():
            continue
        found = (
            tuple(sorted({e for e in engines if e in {"g", "b"}}))
            if isinstance(engines, list)
            else ()
        )
        if found:
            out[query.strip().lower()] = found
    return out


@lru_cache(maxsize=1)
def nodes() -> tuple[Node, ...]:
    """The syllabus nodes, from the same seed the public syllabus pages are built from.

    DE-DUPLICATED on :attr:`Node.key`, and that is not tidiness. The seed carries a node twice
    wherever a board files one name in two documents, and a demand figure that added the same
    query once per duplicate row would rank a chapter by how many times it was catalogued rather
    than by how often it is asked about. It did exactly that before this line existed: one
    chapter read twice as popular as the identical chapter beside it, for no reason a reader
    would recognise.
    """
    got = _read(CURRICULUM_FILE)
    if not isinstance(got, list):
        raise DataUnavailable(f"{CURRICULUM_FILE} is not a list")
    seen: dict[str, Node] = {}
    for row in got:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        kind = str(row.get("kind") or "").strip()
        if not name or kind not in {"unit", "topic"}:
            continue
        node = Node(
            board=str(row.get("board") or "").strip(),
            level=str(row.get("class") or "").strip(),
            subject=str(row.get("subject") or "").strip(),
            unit=str(row.get("unit") or "").strip(),
            name=name,
            kind=kind,
        )
        seen.setdefault(node.key, node)
    return tuple(seen.values())


def forget() -> None:
    """Drop what was read. The test seam, and what ``GROWTH_DATA_DIR`` needs to be honoured."""
    global DATA_DIR, _all_ranked
    with _lock:
        DATA_DIR = Path(os.getenv("GROWTH_DATA_DIR") or (_REPO / "content" / "growth"))
        manifest.cache_clear()
        harvest.cache_clear()
        nodes.cache_clear()
        _node_tokens.cache_clear()
        _all_ranked = None


# --- what a query is asking for -------------------------------------------------------------------
#: Words that say which class, board or document a query is about. They are stripped before a
#: query is matched against a syllabus name, because every one of them appears in thousands of
#: queries and none of them narrows anything.
FURNITURE: frozenset[str] = frozenset(
    {
        "class",
        "std",
        "standard",
        "cbse",
        "icse",
        "isc",
        "nios",
        "ncert",
        "board",
        "chapter",
        "ch",
        "lesson",
        "unit",
        "topic",
        "part",
        "notes",
        "note",
        "solutions",
        "solution",
        "explained",
        "explanation",
        "explain",
        "pdf",
        "free",
        "best",
        "for",
        "the",
        "of",
        "and",
        "in",
        "a",
        "an",
        "to",
        "with",
        "how",
        "what",
        "is",
        "are",
        "questions",
        "question",
        "important",
        "exercise",
        "answers",
        "answer",
        "summary",
        "download",
        "online",
        "app",
        "video",
        "english",
        "hindi",
        "full",
        "short",
        "easy",
    }
)

#: A query that is about getting an app rather than about understanding an idea. A concept piece
#: cannot answer one of these, so the gather step ranks them down rather than pretending.
NAVIGATIONAL = re.compile(
    r"\b(apk|download|downloads|login|log in|sign in|install|play store|app store|"
    r"for pc|for laptop|for windows|mod|crack|coupon|price|subscription)\b"
)
#: A query that is about a product category rather than a syllabus idea.
PRODUCT = re.compile(r"\b(app|apps|application|website|site|tuition|coaching|tutor|tutors)\b")

#: How much each shape of query is worth as a source piece, before the engines are counted.
#: A concept query is what this desk exists to answer; a product query belongs to the pages the
#: site already has, and its weight says so without dropping it off the screen entirely.
INTENT_WEIGHT: dict[str, float] = {
    "concept": 1.0,
    "syllabus": 0.85,
    "product": 0.25,
    "navigational": 0.08,
}

#: How well a match on each kind of node says a cached concept core answers the query. The law
#: ranks on this, so it is a table rather than four numbers in a function.
ANSWERABILITY: dict[str, float] = {
    "topic": 1.0,
    "unit": 0.8,
    "subject": 0.4,
    "none": 0.0,
}

#: What two engines is worth against one. Not a volume figure, and nothing prints it as one.
ENGINE_WEIGHT: dict[int, float] = {1: 1.0, 2: 2.0}

_WORD = re.compile(r"[a-z0-9]+")


def words_of(text: str) -> list[str]:
    return _WORD.findall((text or "").lower())


def content_words(text: str) -> list[str]:
    """The words that actually narrow a query: everything but the furniture and bare numbers."""
    return [w for w in words_of(text) if w not in FURNITURE and not w.isdigit()]


def intent_of(query: str) -> str:
    """Which of the four shapes this query is. Checked in order of how little we can do about it."""
    if NAVIGATIONAL.search(query):
        return "navigational"
    if PRODUCT.search(query):
        return "product"
    if re.search(r"\b(syllabus|sample paper|question paper|date sheet|marking scheme)\b", query):
        return "syllabus"
    return "concept"


def level_in(query: str) -> str | None:
    """``Class 9`` out of a query that names one, or ``None``. Used to break a tie between two
    boards teaching the same chapter in different years."""
    found = re.search(r"\bclass\s*(\d{1,2})\b", query)
    return f"Class {int(found.group(1))}" if found else None


# --- matching a query to the syllabus -------------------------------------------------------------
#: The share of a node's own content words a query has to carry before it counts as a match. Set
#: at two thirds rather than at everything, because a board's chapter title carries words a person
#: searching never types, and set well above a half because two loose words in common is how a
#: matcher starts publishing a trigonometry page for a history query.
OVERLAP_FLOOR = 0.67
#: A single word only matches when it is long enough to be a real subject word. "Light" and
#: "Motion" are chapter titles; a three letter token is noise.
LONE_WORD_FLOOR = 6


@lru_cache(maxsize=4096)
def _node_tokens(name: str) -> frozenset[str]:
    return frozenset(content_words(name))


def matches(query: str, pool: Sequence[Node] | None = None) -> list[tuple[Node, float]]:
    """Every syllabus node this query lands on, with the share of that node's words it carried.

    Returns every match rather than the best one on purpose: four boards teach the same idea, and
    which of them a piece is written from is a decision for MAKE, not a decision to lose here.
    """
    asked = set(content_words(query))
    if not asked:
        return []
    found: list[tuple[Node, float]] = []
    for node in pool if pool is not None else nodes():
        tokens = _node_tokens(node.name)
        if not tokens:
            continue
        if len(tokens) == 1:
            only = next(iter(tokens))
            if len(only) >= LONE_WORD_FLOOR and only in asked:
                found.append((node, 1.0))
            continue
        share = len(tokens & asked) / len(tokens)
        if share >= OVERLAP_FLOOR:
            found.append((node, share))
    return found


# --- the ranked output ----------------------------------------------------------------------------
@dataclass(frozen=True)
class Query:
    """One harvested query, with everything the ranking decided about it."""

    text: str
    engines: tuple[str, ...]
    intent: str
    demand: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "engines": list(self.engines),
            "intent": self.intent,
            "demand": round(self.demand, 3),
        }


@dataclass
class Topic:
    """One CONCEPT, everywhere our syllabus teaches it, and the demand that landed on it.

    **One concept is one topic, not one topic per board, and that is the load-bearing decision in
    this file.** Four boards teach probability. Matching a query against the syllabus produces a
    node for each, and writing a source piece per node would put four near-identical addresses on
    our own site with a board name swapped, which is precisely what Google names as scaled content
    abuse and precisely what ``docs/GROWTH-SEARCH.md`` section 6 forbids. So the placements are
    collected onto one topic and the piece written from it says where the concept sits on every
    board we hold, with each board's document behind it. That page does not exist anywhere in this
    market, and it is the same ruling the glossary family already made.
    """

    #: The concept's own slug, which is also the address of the piece and half of its campaign id.
    slug: str
    #: The board's own name for it, taken from the first placement, never invented.
    name: str
    #: Every place our syllabus teaches it, strongest kind first.
    placements: list[Node] = field(default_factory=list)
    queries: list[Query] = field(default_factory=list)
    #: The sum of the demand of every query that matched, counted ONCE per query however many
    #: placements it landed on. A concept catalogued in five documents is not five times asked.
    demand: float = 0.0

    @property
    def node(self) -> Node:
        """The placement a piece is written from: a topic before a unit, then the earliest class,
        so the same concept always resolves to the same one and a piece is reproducible."""
        return self.placements[0]

    @property
    def kind(self) -> str:
        return self.node.kind

    @property
    def boards(self) -> list[str]:
        return sorted({p.board for p in self.placements if p.board})

    @property
    def subjects(self) -> list[str]:
        return sorted({p.subject for p in self.placements if p.subject})

    @property
    def answerability(self) -> float:
        """The best a cached concept core could do. A topic is keyed exactly; a unit is a chapter
        and a core keyed on it answers a query about that chapter less squarely."""
        return max((ANSWERABILITY[p.kind] for p in self.placements), default=0.0)

    @property
    def score(self) -> float:
        """Demand, weighted by how well a concept core answers it. The floor is 0.35 rather than
        zero so a high-demand chapter stays visible above a low-demand topic, which is what an
        operator reading the desk expects and what a bare multiply would hide."""
        return self.demand * (0.35 + 0.65 * self.answerability)

    def as_dict(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "name": self.name,
            "kind": self.kind,
            "boards": self.boards,
            "subjects": self.subjects,
            "placements": [
                {
                    "board": p.board,
                    "level": p.level,
                    "subject": p.subject,
                    "unit": p.unit,
                    "name": p.name,
                    "kind": p.kind,
                }
                for p in self.placements
            ],
            "placement_count": len(self.placements),
            "demand": round(self.demand, 3),
            "answerability": self.answerability,
            "score": round(self.score, 3),
            "queries": [q.as_dict() for q in self.queries[:12]],
            "query_count": len(self.queries),
        }


def demand_of(engines: Sequence[str], intent: str) -> float:
    """What one query is worth. Two engines beats one; a navigational query is worth almost
    nothing to a desk that writes explanations."""
    return ENGINE_WEIGHT.get(len(set(engines)), 1.0) * INTENT_WEIGHT.get(intent, 0.0)


def queries() -> list[Query]:
    """Every harvested query, scored. Ordered strongest first, so a caller that only wants the
    head of the list does not have to sort it again."""
    out = [
        Query(
            text=text,
            engines=engines,
            intent=(intent := intent_of(text)),
            demand=demand_of(engines, intent),
        )
        for text, engines in harvest().items()
    ]
    out.sort(key=lambda q: (-q.demand, q.text))
    return out


#: Which placement a piece is written from, when a concept sits in several. A topic beats a unit
#: because a concept core is keyed on it; then the earliest class, so the piece is written at the
#: level the idea is first taught rather than at whichever row the seed happened to list first.
def _placement_order(node: Node) -> tuple[int, int, str]:
    level = re.search(r"(\d+)", node.level or "")
    return (0 if node.kind == "topic" else 1, int(level.group(1)) if level else 99, node.key)


def rank(
    limit: int = 50,
    *,
    pool: Iterable[Query] | None = None,
    syllabus: Sequence[Node] | None = None,
) -> list[Topic]:
    """The ranked topics: what to write next, strongest first.

    Every query is matched against every syllabus node it lands on, and the nodes are collapsed by
    concept (see :class:`Topic`). A query's demand is added to a concept ONCE, however many
    placements it matched, so the ranking measures how often a thing is asked about and never how
    many times we catalogued it.

    The full ranking is computed once per process and sliced, because it is a few seconds of work
    over a static file and the console re-reads on a timer. ``pool`` bypasses the memo entirely,
    so a test hands its own queries in and gets its own answer. ``syllabus`` does the same for
    the nodes: the gather job hands in the curriculum store's live tree.
    """
    if pool is not None or syllabus is not None:
        chosen = tuple(pool) if pool is not None else tuple(queries())
        return _ranked(chosen, syllabus)[: max(0, limit)]
    with _lock:
        global _all_ranked
        if _all_ranked is None:
            _all_ranked = _ranked(tuple(queries()))
        return _all_ranked[: max(0, limit)]


#: The memoised full ranking. Dropped by :func:`forget` with everything else it was built from.
_all_ranked: list[Topic] | None = None


def _ranked(pool: tuple[Query, ...], syllabus: Sequence[Node] | None = None) -> list[Topic]:
    from wobo_gateway.growth import campaigns

    chosen: tuple[Node, ...] = tuple(syllabus) if syllabus is not None else nodes()
    found: dict[str, Topic] = {}
    for query in pool:
        if query.demand <= 0:
            continue
        landed: dict[str, list[Node]] = {}
        for node, _share in matches(query.text, chosen):
            slug = campaigns.slugify(node.name)
            if slug:
                landed.setdefault(slug, []).append(node)
        for slug, nodes_here in landed.items():
            topic = found.get(slug)
            if topic is None:
                topic = found[slug] = Topic(slug=slug, name=nodes_here[0].name)
            topic.queries.append(query)
            topic.demand += query.demand
            known = {p.key for p in topic.placements}
            topic.placements.extend(n for n in nodes_here if n.key not in known)
    for topic in found.values():
        topic.placements.sort(key=_placement_order)
        topic.name = topic.placements[0].name
        topic.queries.sort(key=lambda q: (-q.demand, q.text))
    return sorted(found.values(), key=lambda t: (-t.score, t.slug))


def counts() -> dict[str, Any]:
    """What the gather step actually read, for the console. Every number is counted here and
    none is typed, which is the honest-count law in one function."""
    everything = harvest()
    syllabus = nodes()
    return {
        "queries": len(everything),
        "both_engines": sum(1 for engines in everything.values() if len(engines) == 2),
        "units": sum(1 for node in syllabus if node.kind == "unit"),
        "topics": sum(1 for node in syllabus if node.kind == "topic"),
        "boards": sorted({node.board for node in syllabus if node.board}),
        "live_sources": list(live_sources()),
        "absent_sources": [s.key for s in SOURCES if not s.live],
        "harvested_on": str(manifest().get("harvest", {}).get("harvested_on") or ""),
    }


__all__ = [
    "ANSWERABILITY",
    "DATA_DIR",
    "ENGINE_WEIGHT",
    "INTENT_WEIGHT",
    "LONE_WORD_FLOOR",
    "OVERLAP_FLOOR",
    "SOURCES",
    "DataUnavailable",
    "Node",
    "Query",
    "Source",
    "Topic",
    "content_words",
    "counts",
    "demand_of",
    "forget",
    "harvest",
    "intent_of",
    "level_in",
    "live_sources",
    "manifest",
    "matches",
    "nodes",
    "queries",
    "rank",
    "sources",
    "words_of",
]
