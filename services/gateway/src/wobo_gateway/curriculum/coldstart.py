"""The first learner on a board never sees an empty shelf (``docs/BOARD-COLD-START.md``).

268 boards are named in the registry; four carry a syllabus. Until this module existed, a learner
from Maharashtra or Uttar Pradesh found their board named, asked for their class and subject, and
was handed one honest sentence — "no syllabus stored yet" — and a discovery job that no worker was
running. That is a dead end dressed as honesty, and most Indian school students are behind it.

**What happens instead**, and why it is affordable:

1. Picking a board we hold nothing for **starts the discovery job in that instant**, at the head of
   the queue because a learner is waiting on it, and one job serves every learner who picks that
   board in the same minute (``store.enqueue_discovery`` is the atomic claim; this module only
   makes sure the requester is on it, which is what puts it at the head).
2. The learner waits **at most about eight seconds** — :data:`WAIT_CEILING_S` — on the designed
   wait, not a spinner and not a sentence (``docs/EMAILS-AND-ANIMATIONS.md`` §3). The clock is the
   client's, because a gateway that blocked for eight seconds would hold a thread for every waiting
   learner; the ceiling travels on the wire so there is one number rather than two.
3. If the syllabus has not landed by then, **they start anyway**, on :func:`shared_plan` — the
   class-and-subject plan every board shares. This is the fact the whole design turns on: our
   concept cores are board-agnostic (``docs/LEARNING-MODEL.md``). A board's syllabus decides the
   ORDER and the COVERAGE of a climb, never what a concept is or how it is taught.
4. When their board's syllabus lands, minutes later, :func:`reanchor` moves the climb onto it
   **quietly**: same progress, same concepts, now in the board's order and under the board's own
   chapter names. Nothing is lost and nothing is announced.
5. Every learner after them arrives instantly, from the published version.

**What the shared plan is, and what it is very deliberately not.** It is concepts, drawn from
``content/catalogs/concepts.json`` — the board-agnostic graph built out of the syllabi we have
actually read — filtered to the learner's class and subject and to the concepts more than one board
teaches there. It names **no chapter**: chapters and topics come from the board and we never invent
one (``docs/LEARNING-MODEL.md`` §1). Its order is "most widely taught first", which is an honest
starting order and not a claim about any board's sequence — the board's own order replaces it at
the re-anchor, which is exactly what the re-anchor is for.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, TypeVar

from wobo_gateway.curriculum.concepts import (
    ConceptEntry,
    _level_number,
    _subject_key,
    registry,
)
from wobo_gateway.curriculum.models import Node, NodeKind

#: The whole budget of a fourteen-year-old's patience. A first extraction is thirty seconds to a
#: few minutes (search, fetch, read, second reader, publish), so the learner is never held to it —
#: this is how long they are willing to look at something beautiful before they want to begin.
WAIT_CEILING_S: float = 8.0

#: The same number on the wire, for the client that owns the clock.
WAIT_CEILING_MS: int = int(WAIT_CEILING_S * 1000)

#: How many concepts a shared plan carries. A class's worth of starting points, not a syllabus.
MAX_PLAN = 24

#: Below this a plan is too thin to start a learner on, and the board threshold is relaxed once
#: (see :func:`shared_plan`). Asserted per class and subject in ``test_board_cold_start.py``.
MIN_PLAN = 8

#: A concept is "shared" when more than one board teaches it in that class. Two boards is the
#: smallest number that can mean anything at all.
SHARED_BY_BOARDS = 2

#: Subject families in the registry's own keys. A board that teaches one science and a board that
#: teaches three are teaching the same concepts, and the registry records whichever name the
#: syllabus used. Membership is symmetric — asking for Physics may reach a concept the catalogs
#: filed under `science` — but specificity wins the ordering, so an exact match is always served
#: first and a family match only fills a plan that would otherwise be empty.
_FAMILIES: tuple[frozenset[str], ...] = (
    frozenset(
        {"science", "physical_science", "biological_science", "physics", "chemistry", "biology"}
    ),
    frozenset({"social", "history_civics", "geography", "economics", "history", "civics"}),
    frozenset({"computer", "cs", "computer_science"}),
    frozenset({"math", "mathematics"}),
    frozenset({"evs", "environmental_studies"}),
)


#: Names the catalogs carry that are section headings rather than things to learn. They are real
#: rows in real syllabi ("Applications", "Word problems" under a chapter), so the concept graph is
#: right to hold them, and a learner opening a cold board should not be met by them at the top of
#: their climb. Dropped from the shared plan only — nothing is removed from the graph, and a
#: board's own syllabus still names its chapters exactly as the board does.
_HEADINGS = frozenset(
    {
        "activities",
        "application",
        "applications",
        "examples",
        "exercises",
        "general",
        "introduction",
        "miscellaneous",
        "others",
        "problems",
        "projects",
        "revision",
        "summary",
        "word problems",
    }
)


def _family(key: str) -> frozenset[str]:
    for family in _FAMILIES:
        if key in family:
            return family
    return frozenset({key}) if key else frozenset()


# --- the class-and-subject plan every board shares ------------------------------------------------


@dataclass(frozen=True)
class SharedConcept:
    """One thing to learn, named as the concept graph names it. Never a chapter."""

    concept_id: str
    name: str
    boards: int
    order: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "concept_id": self.concept_id,
            "name": self.name,
            "boards": self.boards,
            "order": self.order,
        }


@dataclass(frozen=True)
class SharedPlan:
    """What a learner climbs while their board is being read, and after it if it cannot be."""

    level: str
    subject: str
    concepts: tuple[SharedConcept, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            # `source` is the whole honesty of this object: it says where the plan came from, and
            # it is never a framework id, because no board claims it.
            "source": "shared",
            "level": self.level,
            "subject": self.subject,
            "concepts": [item.as_dict() for item in self.concepts],
        }


def _candidates(level: str, subject: str) -> list[tuple[tuple[int, int, int, str], ConceptEntry]]:
    """Every registry concept taught in this class and this subject family, ranked.

    The rank is (exact subject before family, most boards first, most occurrences first, name) —
    deterministic, so two learners on two cold boards get the identical plan, which is what makes
    it the plan every board *shares* rather than a guess at one board's.
    """
    wanted = _subject_key(subject)
    family = _family(wanted)
    band = _level_number(level)
    if band is None or not family:
        return []
    out: list[tuple[tuple[int, int, int, str], ConceptEntry]] = []
    for entry in registry().values():
        if band not in entry.levels:
            continue
        if entry.canonical_name.strip().casefold() in _HEADINGS:
            continue
        subjects = {_subject_key(name) for name in entry.subjects}
        if not subjects & family:
            continue
        specificity = 0 if wanted in subjects else 1
        boards = len({board.strip().casefold() for board in entry.boards if board.strip()})
        out.append(
            ((specificity, -boards, -entry.occurrences, entry.canonical_name.casefold()), entry)
        )
    out.sort(key=lambda pair: pair[0])
    return out


@lru_cache(maxsize=256)
def shared_plan(level: str, subject: str, *, limit: int = MAX_PLAN) -> SharedPlan:
    """The plan a learner starts on when their board's syllabus has not landed yet.

    Concepts more than one board teaches in this class come first, because that is what "shared"
    means. If there are not :data:`MIN_PLAN` of those — classes 11 and 12 diverge hard between
    boards, and the graph is only as wide as the syllabi we have read — the threshold relaxes to
    one board, which is still a real concept a real board teaches at that class, and still not a
    chapter we invented.
    """
    ranked = _candidates(level, subject)
    shared = [
        (key, entry) for key, entry in ranked if -key[1] >= SHARED_BY_BOARDS
    ]  # -key[1] is the board count
    chosen = shared if len(shared) >= MIN_PLAN else ranked
    concepts = tuple(
        SharedConcept(
            concept_id=entry.concept_id,
            name=entry.canonical_name,
            boards=-key[1],
            order=index,
        )
        for index, (key, entry) in enumerate(chosen[: max(1, limit)])
    )
    return SharedPlan(level=level, subject=subject, concepts=concepts)


def forget_plans() -> None:
    """Drop the memoised plans — for a test that swaps the concept registry under us."""
    shared_plan.cache_clear()


# --- the quiet re-anchor --------------------------------------------------------------------------

T = TypeVar("T")


@dataclass(frozen=True)
class Anchor:
    """One concept of the shared plan, found again under the board's own name and order."""

    concept_id: str
    node_id: str
    name: str
    order: int
    parent_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "concept_id": self.concept_id,
            "node_id": self.node_id,
            "name": self.name,
            "order": self.order,
            "parent_id": self.parent_id,
        }


@dataclass(frozen=True)
class Reanchor:
    """The climb, moved onto the board. Same progress, same concepts, the board's order.

    ``announcements`` exists to be empty. It is the assertion in the type: the re-anchor is the
    one thing in this design the learner must never be told about, so there is a field a test can
    point at rather than an absence a refactor can quietly fill.
    """

    anchors: tuple[Anchor, ...]
    progress: dict[str, Any]
    kept: dict[str, Any]
    unmatched: tuple[str, ...] = ()
    announcements: tuple[str, ...] = ()


def reanchor(
    plan: SharedPlan,
    nodes: Sequence[Node],
    progress: Mapping[str, T] | None = None,
) -> Reanchor:
    """Move a learner from the shared plan onto their board's syllabus, losing nothing.

    ``progress`` is keyed by concept id, which is how it was earned on the shared plan. What comes
    back is the same progress under the board's node ids (``progress``) AND the original, whole,
    under the concept ids (``kept``) — because a concept the board does not name is still a thing
    the learner learned, and "nothing is lost" is the law rather than a hope.
    """
    held = dict(progress or {})
    wanted = {item.concept_id for item in plan.concepts}
    anchors: list[Anchor] = []
    seen: set[str] = set()
    for node in nodes:
        if node.kind not in (NodeKind.TOPIC, NodeKind.UNIT):
            continue
        for concept_id in node.concept_ids:
            if concept_id not in wanted or concept_id in seen:
                continue
            seen.add(concept_id)
            anchors.append(
                Anchor(
                    concept_id=concept_id,
                    node_id=node.id,
                    name=node.name,
                    order=node.order,
                    parent_id=node.parent_id,
                )
            )
    # The board's order, not ours. `order` is the framework's own; the name breaks ties so the
    # result is stable for a board that numbered nothing.
    anchors.sort(key=lambda anchor: (anchor.order, anchor.name.casefold()))
    carried = {
        anchor.node_id: held[anchor.concept_id]
        for anchor in anchors
        if anchor.concept_id in held
    }
    return Reanchor(
        anchors=tuple(anchors),
        progress=carried,
        kept=held,
        unmatched=tuple(sorted(wanted - seen)),
        announcements=(),
    )
