"""The concept map — board topics onto the one canonical concept graph.

`CURRICULUM.md` §7 in code. Two boards that teach "linear equations in one variable" are teaching
the same thing, and the whole free tier rests on our knowing that: the lesson generated for the
CBSE learner is cached against the *concept* and served to the Telangana learner for the price of
a personalisation pass. A board topic that fails to find its concept is not a small miss — it is a
full generation nobody needed.

**The graph already exists.** ``content/catalogs/concepts.json`` is the board-agnostic concept
registry (3948 concepts over 5300 catalogued topics, 767 of them already shared across boards) and
:mod:`wobo_gateway.plexus.store` is what keys the content cache off it. This module maps onto that
graph and resolves every id through :func:`wobo_gateway.plexus.store.concept_id`, which is not a
detail: a concept id computed any other way is a cache key that never hits, and the shared cache
quietly stops being shared.

**Three ways a topic gets its concept, cheapest first** (the cost rule, `WOBO-PLAN` §9):

1. **Exact.** The topic's own identity already resolves to a registry concept. No model call, no
   ambiguity, confidence 1.0. Most topics land here, which is the point.
2. **Proposed and confirmed.** Otherwise a shortlist of registry candidates is retrieved
   lexically, the generate tier picks *one of them or none*, and the structural checks decide
   whether the pick stands: the level bands have to overlap, the subject has to agree, and the
   names or objectives have to actually share words. The model can only ever choose from the
   shortlist — :func:`propose` refuses an id it did not offer — so the model cannot mint a
   concept, which is the same law as "refuse rather than invent" one layer down.
3. **Minted.** Nothing matched, so the topic becomes its own concept under the registry's own
   derivation rule (``conceptId = slug(topic name)``). This is honest rather than clever: it is a
   new concept, it says so with ``method: "minted"``, and the next board that names the topic the
   same way collapses onto it for free.

Below :data:`CONFIDENCE_FLOOR` nothing is stored as a match. A wrong mapping is worse than a
missing one — it serves one board's lesson to another board's learner — so a weak proposal is
minted as its own concept instead of forced onto a near neighbour.

**Storage.** Rows go to ``curriculum.concept_map`` (`CURRICULUM.md` §10) behind the
:class:`ConceptMapStore` protocol: in memory by default, PostgREST with the service role when the
gateway is wired to Supabase. Writes are service-role only, as everywhere else in the curriculum
plane. Nothing here mutates a published node in place — :func:`attach_concepts` returns new units.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

from wobo_gateway.plexus.store import concept_id, concept_identity
from wobo_gateway.routing import Tier, resolve_any, tier_fallbacks, tier_model

# --- thresholds ---------------------------------------------------------------------------------

#: Below this a proposal is not a mapping. Chosen so that the two structural checks that matter
#: (level band and a real name overlap) must BOTH hold before anything is stored.
CONFIDENCE_FLOOR = 0.55

#: How many registry candidates the generate tier is allowed to see. A shortlist, not a catalog:
#: a long list makes the pick worse and the call dearer.
MAX_CANDIDATES = 8

#: Word overlap below this is a coincidence ("the water cycle" vs "the rock cycle" share "the"
#: and "cycle"), so it does not count as a name overlap on its own.
MIN_TOKEN_OVERLAP = 0.34

#: The objective check asks a different question from the name check — not "are these two names
#: alike" but "do this topic's objectives talk about that concept" — so it is measured as the
#: share of the concept's own words the objectives cover, not as a symmetric overlap. A topic
#: whose objectives say "explain photosynthesis in green leaves" covers "Photosynthesis" fully
#: while sharing almost no words with it, and Jaccard would score that at 0.14.
MIN_CONCEPT_COVERAGE = 0.6

#: A concept taught two classes away is a different concept, however alike the names. One class
#: of slack absorbs the real disagreement between boards about when a topic lands.
LEVEL_BAND_SLACK = 1

_WS = re.compile(r"\s+")
_WORD = re.compile(r"[a-z0-9]+")
_LEVEL_NUM = re.compile(r"(\d{1,2})")

#: Words that carry no subject meaning. Kept small on purpose: an aggressive stop list makes two
#: unrelated topics look alike, which is the failure this module exists to avoid.
_STOP = frozenset({
    "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "its", "it", "as", "at",
    "by", "from", "into", "over", "under", "is", "are", "be", "being", "been", "that", "this",
    "these", "those", "or", "nor", "but", "if", "then", "than", "introduction", "basic",
    "basics", "chapter", "unit", "topic", "part", "study", "understanding",
})


class ConceptMappingError(Exception):
    """A mapping could not be attempted at all (a broken registry, a store that refused)."""


# --- the canonical registry ---------------------------------------------------------------------


@dataclass(frozen=True)
class ConceptEntry:
    """One node of the canonical concept graph, as the registry holds it."""

    concept_id: str
    canonical_name: str
    subjects: tuple[str, ...] = ()
    boards: tuple[str, ...] = ()
    grades: tuple[str, ...] = ()
    occurrences: int = 0

    @property
    def levels(self) -> tuple[int, ...]:
        return tuple(sorted({n for n in (_level_number(g) for g in self.grades) if n is not None}))


def _registry_path() -> Path:
    """The same file :mod:`wobo_gateway.plexus.store` reads, honouring the same override.

    Mirrored rather than imported because ``store._concepts_file`` is private to that module; the
    env var is the contract between them and it is asserted in the tests.
    """
    override = os.getenv("PLEXUS_CONCEPTS_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[5] / "content" / "catalogs" / "concepts.json"


@lru_cache(maxsize=1)
def registry() -> dict[str, ConceptEntry]:
    """The canonical concept graph, keyed by concept id. Empty when the file is missing.

    Empty is a survivable state and deliberately not an exception: with no registry every topic
    mints its own concept, which is exactly what the derivation rule says should happen, and the
    product keeps working on a slimmer cache instead of failing to open a chapter.
    """
    try:
        data = json.loads(_registry_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    raw = data.get("concepts") if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return {}
    out: dict[str, ConceptEntry] = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        name = str(value.get("canonicalName") or key)
        out[str(key)] = ConceptEntry(
            concept_id=str(key),
            canonical_name=name,
            subjects=tuple(str(s) for s in value.get("subjects") or ()),
            boards=tuple(str(b) for b in value.get("boards") or ()),
            grades=tuple(str(g) for g in value.get("grades") or ()),
            occurrences=int(value.get("occurrences") or 0),
        )
    return out


@lru_cache(maxsize=1)
def _index() -> dict[str, tuple[str, ...]]:
    """token -> concept ids. Built once; the shortlist is a set intersection over it."""
    index: dict[str, list[str]] = {}
    for entry in registry().values():
        for token in _tokens(entry.canonical_name):
            index.setdefault(token, []).append(entry.concept_id)
    return {token: tuple(ids) for token, ids in index.items()}


def reload_registry() -> None:
    """Drop the cached registry — for tests, and for a registry file swapped under a running
    process. Public because a test that points ``PLEXUS_CONCEPTS_PATH`` at a fixture needs it."""
    registry.cache_clear()
    _index.cache_clear()


# --- text and level helpers ---------------------------------------------------------------------


def _tokens(text: str) -> frozenset[str]:
    return frozenset(w for w in _WORD.findall((text or "").casefold()) if w not in _STOP)


def _overlap(left: frozenset[str], right: frozenset[str]) -> float:
    """Jaccard over content words. 0.0 when either side has nothing to say."""
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _coverage(text: frozenset[str], concept: frozenset[str]) -> float:
    """The share of a concept's own words that appear in some text. Asymmetric on purpose."""
    if not text or not concept:
        return 0.0
    return len(text & concept) / len(concept)


def _level_number(level: str | None) -> int | None:
    """``"Class 9"`` -> 9. Anything without a number in it has no band."""
    if not level:
        return None
    match = _LEVEL_NUM.search(str(level))
    return int(match.group(1)) if match else None


def _subject_key(subject: str | None) -> str:
    """Normalise a subject name onto the registry's short keys (``math``, ``science``, ...).

    The registry was built from the catalogs, which use short keys; a syllabus says
    "Mathematics". Unknown subjects fall through to their own slug, which simply fails to match
    a registry subject — a missed check, never a false one.
    """
    raw = _WS.sub(" ", (subject or "")).strip().casefold()
    if not raw:
        return ""
    table = {
        "math": "math",
        "maths": "math",
        "mathematics": "math",
        "science": "science",
        "physics": "physics",
        "chemistry": "chemistry",
        "biology": "biology",
        "social": "social",
        "social science": "social",
        "social studies": "social",
        "history": "history_civics",
        "civics": "history_civics",
        "history and civics": "history_civics",
        "geography": "geography",
        "evs": "evs",
        "environmental studies": "evs",
        "english": "english",
        "computer science": "computer_science",
    }
    return table.get(raw, re.sub(r"[^a-z0-9]+", "_", raw).strip("_"))


# --- the mapping --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Mapping:
    """One topic's place on the concept graph, and how much we believe it."""

    topic_id: str
    topic_name: str
    concept_id: str
    canonical_name: str
    confidence: float
    #: ``exact`` | ``proposed`` | ``minted``
    method: str
    checks_passed: tuple[str, ...] = ()
    #: The tier that proposed it, when one did. Never crosses the door to the client.
    proposed_by: str | None = None

    @property
    def minted(self) -> bool:
        return self.method == "minted"

    def as_row(self, *, version_id: str | None = None, now: datetime | None = None) -> dict:
        """A ``curriculum.concept_map`` row. Provenance travels with the mapping, as everywhere."""
        return {
            "node_id": self.topic_id,
            "version_id": version_id,
            "concept_id": self.concept_id,
            "canonical_name": self.canonical_name,
            "confidence": round(self.confidence, 4),
            "method": self.method,
            "checks_passed": list(self.checks_passed),
            "proposed_by": self.proposed_by,
            "mapped_at": (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }


@dataclass(frozen=True)
class Topic:
    """The half of a topic node this module needs. Built from an ontology node by
    :func:`topic_from_node`, so the caller does not have to reshape one."""

    id: str
    name: str
    objectives: tuple[str, ...] = ()
    level: str | None = None
    subject: str | None = None

    @property
    def text(self) -> frozenset[str]:
        return _tokens(" ".join((self.name, *self.objectives)))


def topic_from_node(
    node: dict[str, Any], *, level: str | None = None, subject: str | None = None
) -> Topic:
    return Topic(
        id=str(node.get("id") or ""),
        name=str(node.get("name") or node.get("title") or ""),
        objectives=tuple(str(o) for o in node.get("objectives") or ()),
        level=level,
        subject=subject,
    )


class Proposer(Protocol):
    """Picks ONE candidate concept id for a topic, or returns an empty string for none."""

    def choose(self, *, topic: Topic, candidates: list[ConceptEntry]) -> str: ...


_PROPOSE_SYSTEM = (
    "You match one school syllabus topic to a concept from a fixed list. Answer with strict "
    'JSON: {"concept_id": str} using an id COPIED from the list, or {"concept_id": ""} when '
    "none of them is the same concept. Two entries are the same concept only if a lesson "
    "written for one would teach the other. A similar-sounding topic from a different subject "
    "or a different school year is not the same concept. Never invent an id, never explain."
)


@dataclass(frozen=True)
class LiveProposer:
    """The generate tier (`WOBO-PLAN` §9). It chooses; it never mints."""

    timeout_s: float = 20.0

    @property
    def model_id(self) -> str:
        return tier_model(Tier.GENERATE).provider_model

    def choose(self, *, topic: Topic, candidates: list[ConceptEntry]) -> str:
        # Through ``model_call``, never ``litellm.completion`` directly: one model in the chain
        # refusing a knob must not read as the whole chain being down, and the ledger row that
        # names who answered is written on the way out.
        from wobo_gateway.model_call import complete
        from wobo_gateway.telemetry import record_cost

        chain = [resolve_any(name).provider_model for name in tier_fallbacks(Tier.GENERATE)]
        listing = "\n".join(
            f"- {c.concept_id}: {c.canonical_name}"
            + (f" (subjects: {', '.join(c.subjects)})" if c.subjects else "")
            for c in candidates
        )
        objectives = "\n".join(f"- {o}" for o in topic.objectives[:8])
        response = complete(
            model=self.model_id,
            messages=[
                {"role": "system", "content": _PROPOSE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Topic: {topic.name}\nSubject: {topic.subject or 'unknown'}\n"
                        f"Level: {topic.level or 'unknown'}\n"
                        f"Objectives:\n{objectives or '- none given'}\n\nCandidates:\n{listing}"
                    ),
                },
            ],
            fallbacks=chain or None,
            max_tokens=120,
            timeout=self.timeout_s,
        )
        record_cost(capability="curriculum.concepts", model=self.model_id, response=response)
        text = response.choices[0].message.content or ""
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return ""
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return ""
        return str(data.get("concept_id") or "").strip() if isinstance(data, dict) else ""


def candidates(topic: Topic, *, limit: int = MAX_CANDIDATES) -> list[ConceptEntry]:
    """The lexical shortlist: registry concepts sharing content words with the topic's name.

    Deterministic and cheap — an inverted index over the registry's canonical names, ranked by
    word overlap with occurrences as the tie-break, so the concept several boards already share
    wins a tie against a one-board near-namesake.
    """
    words = _tokens(topic.name)
    if not words:
        return []
    index = _index()
    reg = registry()
    hits: dict[str, int] = {}
    for word in words:
        for cid in index.get(word, ()):
            hits[cid] = hits.get(cid, 0) + 1
    scored: list[tuple[float, int, str]] = []
    for cid in hits:
        entry = reg.get(cid)
        if entry is None:
            continue
        scored.append((_overlap(words, _tokens(entry.canonical_name)), entry.occurrences, cid))
    scored.sort(key=lambda row: (-row[0], -row[1], row[2]))
    return [reg[cid] for _, _, cid in scored[:limit]]


def structural_checks(topic: Topic, entry: ConceptEntry) -> tuple[float, tuple[str, ...]]:
    """The confirmation half. Returns (confidence, checks that passed).

    Four checks, weighted by how much each one actually tells us:

    - ``name_overlap`` (0.40) — the topic and the concept share content words. The floor of the
      whole thing: without it the rest is two unrelated topics agreeing about a school year.
    - ``objective_overlap`` (0.20) — the topic's objectives cover the concept's own words
      (:data:`MIN_CONCEPT_COVERAGE`). Absent objectives simply do not earn this; they never cost.
    - ``level_band`` (0.25) — the registry's grades for the concept sit within
      :data:`LEVEL_BAND_SLACK` of the topic's level. A concept with no grades recorded cannot
      contradict, so it neither earns nor costs.
    - ``subject_match`` (0.15) — the subjects agree. Same rule when the registry has none.
    """
    passed: list[str] = []
    score = 0.0

    name_overlap = _overlap(_tokens(topic.name), _tokens(entry.canonical_name))
    if name_overlap >= MIN_TOKEN_OVERLAP:
        passed.append("name_overlap")
        score += 0.40 * min(1.0, name_overlap / 0.75)

    covers = _coverage(topic.text, _tokens(entry.canonical_name))
    if topic.objectives and covers >= MIN_CONCEPT_COVERAGE:
        passed.append("objective_overlap")
        score += 0.20

    levels = entry.levels
    topic_level = _level_number(topic.level)
    if not levels or topic_level is None:
        passed.append("level_band_unknown")
        score += 0.25 * 0.6  # unknown is not proof; it earns less than an agreement does
    elif min(abs(topic_level - level) for level in levels) <= LEVEL_BAND_SLACK:
        passed.append("level_band")
        score += 0.25
    else:
        # A real disagreement, and the one that most often makes a wrong cache hit.
        return 0.0, tuple(passed)

    subject = _subject_key(topic.subject)
    entry_subjects = {_subject_key(s) for s in entry.subjects}
    if not subject or not entry_subjects:
        passed.append("subject_unknown")
        score += 0.15 * 0.6
    elif subject in entry_subjects:
        passed.append("subject_match")
        score += 0.15
    else:
        return 0.0, tuple(passed)

    return min(1.0, score), tuple(passed)


def _scope(topic: Topic, board: str | None = None, chapter: str | None = None) -> dict[str, str]:
    """The curriculum coordinate ``plexus.store`` consults for registry overrides. It resolves the
    id; it is never part of the cache key (that is the whole point of a board-agnostic concept)."""
    return {
        "board": board or "",
        "grade": topic.level or "",
        "subject": topic.subject or "",
        "chapter": chapter or "",
    }


def propose(
    topic: Topic,
    *,
    board: str | None = None,
    chapter: str | None = None,
    model: Proposer | None = None,
) -> Mapping:
    """Map one topic. Exact first, the generate tier second, a minted concept last."""
    if not topic.name.strip():
        raise ConceptMappingError("a topic with no name cannot be mapped")

    scope = _scope(topic, board, chapter)
    reg = registry()

    # 1. Exact — the topic's own identity already IS a registry concept. No model, no doubt.
    direct = concept_id(topic.name, scope)
    entry = reg.get(direct)
    if entry is not None:
        return Mapping(
            topic_id=topic.id,
            topic_name=topic.name,
            concept_id=direct,
            canonical_name=entry.canonical_name,
            confidence=1.0,
            method="exact",
            checks_passed=("identity",),
        )

    # 2. Proposed — a shortlist, one pick from it, and the checks that decide whether it stands.
    shortlist = candidates(topic)
    if shortlist and model is not None:
        allowed = {c.concept_id: c for c in shortlist}
        try:
            picked = model.choose(topic=topic, candidates=shortlist)
        except Exception:  # noqa: BLE001 - a proposer that fails costs us a cache hit, not a lesson
            picked = ""
        chosen = allowed.get(picked.strip()) if picked else None
        if chosen is not None:
            confidence, checks = structural_checks(topic, chosen)
            if confidence >= CONFIDENCE_FLOOR:
                return Mapping(
                    topic_id=topic.id,
                    topic_name=topic.name,
                    concept_id=chosen.concept_id,
                    canonical_name=chosen.canonical_name,
                    confidence=confidence,
                    method="proposed",
                    checks_passed=checks,
                    proposed_by=getattr(model, "model_id", None),
                )

    # 3. Minted — its own concept, under the registry's own derivation rule, labelled as new.
    return Mapping(
        topic_id=topic.id,
        topic_name=topic.name,
        concept_id=direct,
        canonical_name=concept_identity(topic.name, scope) or topic.name,
        confidence=1.0,
        method="minted",
        checks_passed=("identity",),
    )


# --- attaching to a syllabus --------------------------------------------------------------------


def attach_concepts(
    units: list[dict[str, Any]],
    *,
    level: str | None = None,
    subject: str | None = None,
    board: str | None = None,
    model: Proposer | None = None,
) -> tuple[list[dict[str, Any]], list[Mapping]]:
    """Annotate a subject's units with ``concept_ids`` on every topic.

    Returns new units — nothing is edited in place — and the mappings, so the caller can write
    the ``concept_map`` rows and see how many topics found an existing concept rather than
    minting one. That ratio is the cache's reuse rate, and it is worth watching.
    """
    out: list[dict[str, Any]] = []
    mappings: list[Mapping] = []
    for unit in units:
        copied = dict(unit)
        topics: list[dict[str, Any]] = []
        for node in unit.get("topics", []) or []:
            topic = topic_from_node(node, level=level, subject=subject)
            if not topic.name.strip():
                topics.append(dict(node))
                continue
            mapping = propose(topic, board=board, chapter=str(unit.get("name") or ""), model=model)
            mappings.append(mapping)
            annotated = dict(node)
            annotated["concept_ids"] = [mapping.concept_id]
            topics.append(annotated)
        copied["topics"] = topics
        out.append(copied)
    return out, mappings


def reuse_rate(mappings: list[Mapping]) -> float:
    """The share of topics that landed on a concept the graph already had. The number the free
    tier lives on: at 0.0 every board pays full price for every lesson."""
    if not mappings:
        return 0.0
    return sum(1 for m in mappings if not m.minted) / len(mappings)


# --- storage ------------------------------------------------------------------------------------


class ConceptMapStore(Protocol):
    def write(self, rows: list[dict[str, Any]]) -> int: ...


@dataclass
class InMemoryConceptMap:
    """The default. One row per (node_id, version_id); a re-map replaces its own row and no other,
    which is the closest thing to "not edited in place" that a derived mapping can be — the
    curriculum node it points at is untouched either way."""

    rows: dict[tuple[str, str | None], dict[str, Any]] = field(default_factory=dict)

    def write(self, rows: list[dict[str, Any]]) -> int:
        for row in rows:
            self.rows[(str(row.get("node_id")), row.get("version_id"))] = dict(row)
        return len(rows)

    def for_node(self, node_id: str) -> list[dict[str, Any]]:
        return [row for key, row in self.rows.items() if key[0] == node_id]


@dataclass(frozen=True)
class PostgrestConceptMap:
    """``curriculum.concept_map`` over PostgREST, service role only.

    The schema is selected per request with ``Content-Profile``, the way
    :mod:`wobo_gateway.consent` selects ``learner`` with ``Accept-Profile``. Writes to the
    curriculum plane are service-role only (`CURRICULUM.md` §10), so a missing service key is a
    refusal to write rather than a quiet fall back to the publishable key.
    """

    schema: str = "curriculum"
    table: str = "concept_map"
    timeout_s: float = 5.0

    def write(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        base = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
        if not base or not key:
            raise ConceptMappingError("the concept map is written by the service role only")
        url = f"{base.rstrip('/')}/rest/v1/{urllib.parse.quote(self.table)}"
        request = urllib.request.Request(  # noqa: S310 - https URL from our own env
            url,
            data=json.dumps(rows).encode("utf-8"),
            method="POST",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Content-Profile": os.getenv("SUPABASE_CURRICULUM_SCHEMA", self.schema),
                "Prefer": "resolution=merge-duplicates",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as response:  # noqa: S310
                if response.status >= 300:
                    raise ConceptMappingError(f"concept map write returned {response.status}")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ConceptMappingError("the concept map could not be written") from exc
        return len(rows)


def store_mappings(
    mappings: list[Mapping],
    *,
    store: ConceptMapStore,
    version_id: str | None = None,
    now: datetime | None = None,
) -> int:
    """Write the mappings worth writing.

    A minted concept is a real row — it IS the graph growing, and the next board to name that
    topic the same way finds it there.
    """
    return store.write([m.as_row(version_id=version_id, now=now) for m in mappings])
