"""The curriculum store: the registry, read and written in exactly one place.

Two implementations behind one protocol.

* :class:`PostgrestStore` — the real one. Supabase over PostgREST with the SERVICE-ROLE key and
  ``Accept-Profile: curriculum`` (migration 0008 exposes the schema). Writes are service-role by
  law (§10): a learner's overlay is stored by the brain after it validated the patch, never by
  the client. The HTTP hop is one injectable callable, so the suite exercises every query string
  this module builds against a fake instead of a network.
* :class:`InMemoryStore` — mock mode, the test suite, and local development with no project.
  Seeded from ``content/curriculum/`` by :func:`load_seed`, so search, levels, subjects, units
  and topics all work before a database exists.

:func:`load_seed` is deliberately forgiving and deliberately loud: the seed is written by another
worker and will gain fields we do not know about. Unknown fields are ignored, missing ones fall
back, and anything we cannot read at all is SKIPPED and counted in one log line — never
half-loaded, and never invented (§11: refuse rather than fabricate).

Ids for seeded rows are uuid5 of their natural key, so two processes reading the same seed agree
on every id and a learner's overlay survives a restart.
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
import uuid
from collections.abc import Callable, Iterable, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from wobo_gateway.curriculum import versions as version_rules
from wobo_gateway.curriculum.models import (
    DiscoveryJob,
    Framework,
    JobState,
    Node,
    NodeKind,
    Overlay,
    Provenance,
    Status,
    Version,
    coerce_job_state,
    in_scope,
    job_is_open,
    level_order,
)

logger = logging.getLogger("wobo.gateway.curriculum")

# One namespace, so a seeded id is the same in every process and every environment.
SEED_NAMESPACE = uuid.UUID("6f1a5f7e-1c3d-5b6a-9d2e-0c4b8a7f3e11")

SCHEMA = "curriculum"
_HTTP_TIMEOUT_S = 6.0
_SEARCH_LIMIT = 10
_MAX_SEARCH_LIMIT = 25

#: How long one answered question about a syllabus stands. Inside this window a second learner —
#: or the same learner tapping again — reads the job that already ran rather than starting another
#: paid search (§12: "a second discovery for a framework that is already stored"). Outside it, a
#: refusal is worth retrying: the board may have published since.
DISCOVERY_COOLDOWN_S = 6 * 60 * 60

#: A subject id is a Supabase ``auth.uid()`` — a uuid. Anything else reaching a filter is a bug or
#: an attack: PostgREST reads ``,``, ``(``, ``)`` and ``.`` as syntax inside an ``or=(…)``
#: expression, so a subject carrying them can widen its own row filter to every learner's. In
#: production the subject is the verified JWT ``sub``; with ``DEV_AUTH=1`` it comes from a header,
#: which is where this matters.
_SUBJECT_RE = re.compile(r"^[A-Za-z0-9_:@-]{1,128}$")


def safe_subject(subject: str | None) -> str | None:
    """The subject as a filter value, or None when it is not one we will interpolate.

    None is served as "no subject": public rows only, no overlay, no pin. A learner whose id we
    will not put in a query gets the anonymous view rather than an error — and never a wider one.
    """
    if not subject or not _SUBJECT_RE.match(subject):
        if subject:
            logger.warning("curriculum: refusing to filter on a malformed subject id")
        return None
    return subject


def seed_id(*parts: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, "|".join(parts)))


def provenance_id(version_id: str, node_id: str | None) -> str:
    """The id of the provenance row for one node (or the version-level row when ``node_id`` is
    None). Deterministic, so a replayed write is the same row and ``on conflict do nothing`` is
    what makes the publish command idempotent rather than a duplicate."""
    return seed_id("provenance", version_id, node_id or "")


def content_root() -> Path:
    """Where the seed lives. Overridable so a test can point at a fixture directory."""
    override = os.getenv("WOBO_CURRICULUM_CONTENT")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[5] / "content" / "curriculum"


# --- ranking ----------------------------------------------------------------------------------
#
# Shared by both stores so type-ahead reads the same whether the rows came from Postgres or from
# the seed. The database narrows (an ILIKE against the trigram index); the ordering is decided
# here, because "which of these is the board you meant" is product judgement, not SQL.


def _fold(text: str) -> str:
    return " ".join(text.lower().split())


def match_rank(framework: Framework, query: str) -> int | None:
    """How well this framework answers the typed query. Lower is better; None is no match."""
    needle = _fold(query)
    if not needle:
        return 6
    name = _fold(framework.name)
    aliases = [_fold(alias) for alias in framework.aliases]
    if name == needle or needle in aliases:
        return 0
    if name.startswith(needle):
        return 1
    if any(alias.startswith(needle) for alias in aliases):
        return 2
    if needle in name:
        return 3
    if any(needle in alias for alias in aliases):
        return 4
    # Every word typed appears somewhere: "cbse class 9" still finds CBSE.
    words = needle.split()
    haystack = " ".join(
        [name, *aliases, _fold(framework.country or ""), _fold(framework.region or "")]
    )
    if words and all(word in haystack for word in words):
        return 5
    return None


def rank(
    frameworks: Iterable[Framework], query: str, *, country: str | None = None, limit: int = 10
) -> list[Framework]:
    """Type-ahead order: how well it matches, then the learner's own country, then the name.

    The country hint breaks ties only. A learner in India typing "cambridge" still gets Cambridge:
    a hint that could hide a match would be a filter, and §3 asks for a hint.
    """
    hint = (country or "").strip().upper()
    scored: list[tuple[tuple[int, int, int, str], Framework]] = []
    for framework in frameworks:
        rank_value = match_rank(framework, query)
        if rank_value is None:
            continue
        key = (
            rank_value,
            0 if hint and framework.country == hint else 1,
            # The learner's own syllabus sits with the boards, not below them.
            0 if framework.personal else 1,
            _fold(framework.name),
        )
        scored.append((key, framework))
    scored.sort(key=lambda item: item[0])
    return [framework for _, framework in scored[: max(1, limit)]]


# --- the seed ---------------------------------------------------------------------------------


@dataclass
class Seed:
    """Everything ``content/curriculum`` gave us, plus what it could not."""

    frameworks: list[Framework] = field(default_factory=list)
    versions: list[Version] = field(default_factory=list)
    nodes: list[Node] = field(default_factory=list)
    provenance: list[Provenance] = field(default_factory=list)
    skipped_frameworks: int = 0
    skipped_syllabi: int = 0
    skipped_nodes: int = 0
    # A stored negative result: a file that says, with a blocker code and a note, that no official
    # document could be read for this class and subject. It is a deliberate answer, not a failure
    # to read the seed, so it is counted apart from `skipped` and never raises the alarm below.
    blocked_syllabi: int = 0
    # Ids already emitted. A version's level node is the same row for every syllabus file of
    # that class (same version, same name, same order, so the same uuid5), and it used to be
    # emitted once per file: 37 duplicate rows in the real seed, which the in-memory store
    # silently folded and a database insert would have to skip. One row per id, at the source.
    _ids: set[str] = field(default_factory=set, repr=False, compare=False)

    @property
    def skipped(self) -> int:
        return self.skipped_frameworks + self.skipped_syllabi + self.skipped_nodes


def _read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning(
            "curriculum seed file unreadable",
            extra={"fields": {"path": str(path), "error": str(exc)}},
        )
        return None


def _load_frameworks(root: Path, seed: Seed) -> None:
    document = _read_json(root / "frameworks.seed.json")
    if document is None:
        logger.warning("curriculum seed missing", extra={"fields": {"path": str(root)}})
        return
    # Tolerate both shapes: {"frameworks": [...]} (what the builder writes today) and a bare list.
    rows = document.get("frameworks") if isinstance(document, dict) else document
    if not isinstance(rows, list):
        logger.warning("curriculum seed has no framework list")
        return
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            seed.skipped_frameworks += 1
            continue
        try:
            framework = Framework.from_row(row)
        except (ValueError, TypeError):
            seed.skipped_frameworks += 1
            continue
        if framework.id in seen:
            seed.skipped_frameworks += 1
            continue
        seen.add(framework.id)
        seed.frameworks.append(framework)


def _syllabus_nodes(document: dict[str, Any], version: Version, seed: Seed) -> int:
    """One stored syllabus -> level, subject, unit, topic and objective nodes. Returns the count."""
    level_name = str(document.get("level") or "").strip()
    subject_name = str(document.get("subject") or "").strip()
    units = document.get("units")
    if not level_name or not subject_name or not isinstance(units, list):
        return 0
    if not in_scope(level_name):  # grades 4 to 13, school level only (§11)
        return 0

    documents = document.get("documents")
    source_doc = documents[0] if isinstance(documents, list) and documents else {}
    source_url = source_doc.get("url") if isinstance(source_doc, dict) else None
    fetched_at = source_doc.get("fetched_at") if isinstance(source_doc, dict) else None
    doc_hash = source_doc.get("document_sha256") if isinstance(source_doc, dict) else None
    # The file's own provenance (CURRICULUM.md §5) is the record of who checked it and when.
    # This used to hard-code ``verified_by="owner"`` for any verified file, which would have
    # credited the owner with a verification the audit pass made in code or on the verify tier.
    file_provenance = (
        document.get("provenance") if isinstance(document.get("provenance"), dict) else {}
    )
    verifier_model = file_provenance.get("verifier") or None
    checks_passed = tuple(
        str(check) for check in (file_provenance.get("checks_passed") or []) if str(check).strip()
    ) or ("seeded", "source_attached")
    is_verified = version.status is Status.VERIFIED
    verified_by = (file_provenance.get("verified_by") or "owner") if is_verified else None
    verified_at = (file_provenance.get("verified_at") or fetched_at) if is_verified else None

    def emit(kind: NodeKind, name: str, parent: str | None, order: int, ref: Any) -> str:
        ident = seed_id(version.id, kind.value, parent or "", name, str(order))
        if ident in seed._ids:
            return ident
        seed._ids.add(ident)
        seed.nodes.append(
            Node(
                id=ident,
                version_id=version.id,
                kind=kind,
                name=name,
                parent_id=parent,
                order=order,
                source_ref=ref if isinstance(ref, dict) else None,
            )
        )
        seed.provenance.append(
            Provenance(
                version_id=version.id,
                node_id=ident,
                source_url=source_url,
                source_page_or_section=_section_of(ref),
                document_hash=doc_hash,
                fetched_at=fetched_at,
                verifier_model=verifier_model,
                checks_passed=checks_passed,
                verified_by=verified_by,
                verified_at=verified_at,
            )
        )
        return ident

    count = 0
    # The level's own number is its order, so "Class 9" comes before "Class 10" rather than after
    # it. Every syllabus file for the same class must agree on this or they would become two
    # level nodes, which is why the number and not the file's position decides it.
    level_id = emit(NodeKind.LEVEL, level_name, None, level_order(level_name) or 0, None)
    subject_id = emit(NodeKind.SUBJECT, subject_name, level_id, 0, None)
    count += 2
    for unit_index, unit in enumerate(units):
        if not isinstance(unit, dict):
            seed.skipped_nodes += 1
            continue
        unit_name = str(unit.get("title") or unit.get("name") or "").strip()
        if not unit_name:
            seed.skipped_nodes += 1
            continue
        unit_id = emit(NodeKind.UNIT, unit_name, subject_id, unit_index, unit.get("source_ref"))
        count += 1
        topics = unit.get("topics")
        if not isinstance(topics, list):
            continue
        for topic_index, topic in enumerate(topics):
            if not isinstance(topic, dict):
                seed.skipped_nodes += 1
                continue
            topic_name = str(topic.get("title") or topic.get("name") or "").strip()
            if not topic_name:
                seed.skipped_nodes += 1
                continue
            topic_id = emit(
                NodeKind.TOPIC, topic_name, unit_id, topic_index, topic.get("source_ref")
            )
            count += 1
            objectives = topic.get("objectives")
            if not isinstance(objectives, list):
                continue
            for objective_index, objective in enumerate(objectives):
                text = str(objective or "").strip()
                if not text:
                    seed.skipped_nodes += 1
                    continue
                emit(
                    NodeKind.OBJECTIVE,
                    text,
                    topic_id,
                    objective_index,
                    topic.get("source_ref"),
                )
                count += 1
    return count


def _section_of(ref: Any) -> str | None:
    if not isinstance(ref, dict):
        return None
    page = ref.get("page")
    section = ref.get("section")
    if page and section:
        return f"page {page}, {section}"
    if section:
        return str(section)
    if page:
        return f"page {page}"
    return None


def _framework_index(frameworks: Sequence[Framework]) -> dict[str, str]:
    """id, name and alias -> framework id, for resolving what a syllabus file calls its board.

    A stored syllabus is written against the board's common name ("icse", "isc"); the registry
    entry is the body that publishes it ("cisce", whose aliases include both). Resolving through
    the alias is a lookup, not a guess: an ambiguous key — one that two frameworks both claim —
    is dropped rather than resolved to whichever was read first.
    """
    index: dict[str, str] = {}
    ambiguous: set[str] = set()
    for framework in frameworks:
        for key in (framework.id, framework.name, *framework.aliases):
            folded = _fold(key)
            if not folded:
                continue
            if folded in index and index[folded] != framework.id:
                ambiguous.add(folded)
            index.setdefault(folded, framework.id)
    for key in ambiguous:
        index.pop(key, None)
    # An id always wins its own key back, even if an alias elsewhere collided with it.
    for framework in frameworks:
        index[_fold(framework.id)] = framework.id
    return index


def _is_blocked(document: dict[str, Any]) -> bool:
    """True for a stored negative result: no chapters, and a named reason why not.

    `units: null` plus a blocker code is how ``content/curriculum/syllabi`` records "the board
    publishes no document we could read for this class". A file with no chapters and no reason is
    malformed and is still counted as skipped, so a truncated write cannot hide behind this.
    """
    if isinstance(document.get("units"), list):
        return False
    if str(document.get("discovery_state") or "").strip() != "blocked":
        return False
    return bool(str(document.get("blocker") or "").strip())


def _load_syllabi(root: Path, seed: Seed) -> None:
    directory = root / "syllabi"
    if not directory.is_dir():
        return
    index = _framework_index(seed.frameworks)
    versions: dict[tuple[str, str], Version] = {}
    for path in sorted(directory.rglob("*.json")):
        document = _read_json(path)
        if not isinstance(document, dict):
            seed.skipped_syllabi += 1
            continue
        named = str(document.get("framework_id") or "").strip()
        framework_id = index.get(_fold(named)) or index.get(
            _fold(str(document.get("framework_name") or ""))
        )
        label = str(document.get("version") or "").strip()
        if not framework_id or not label:
            seed.skipped_syllabi += 1
            continue
        if _is_blocked(document):
            # We looked and found nothing official (§4.6). Recording that is the honest answer, so
            # the file is neither a syllabus nor a malformed one: no version is minted, because
            # there is nothing to pin a learner to, and the unit list falls through to discovery.
            seed.blocked_syllabi += 1
            continue
        key = (framework_id, label)
        version = versions.get(key)
        if version is None:
            documents = document.get("documents")
            first = documents[0] if isinstance(documents, list) and documents else {}
            version = Version(
                id=seed_id("version", framework_id, label),
                framework_id=framework_id,
                label=label,
                status=Status(document["status"])
                if document.get("status") in set(Status)
                else Status.PROVISIONAL,
                # Seeded syllabi ship published: they are what a learner studies, and §2 freezes
                # them the moment they are. A correction is a new version, never an edit here.
                published_at=(first.get("fetched_at") if isinstance(first, dict) else None)
                or datetime.now(UTC).isoformat(),
                document_hash=(first.get("document_sha256") if isinstance(first, dict) else None),
                source_url=(first.get("url") if isinstance(first, dict) else None),
            )
            versions[key] = version
            seed.versions.append(version)
        if _syllabus_nodes(document, version, seed) == 0:
            seed.skipped_syllabi += 1


def load_seed(root: Path | None = None) -> Seed:
    """Read ``content/curriculum`` into memory. Never raises; counts what it had to skip.

    A file that records "no official document exists for this class" is counted as blocked, not as
    skipped: it is an answer the discovery job stored on purpose (§4.6), and the capabilities fall
    through to discovery for it exactly as they do for a class nobody has asked about yet.

    The frameworks file is the contract (``frameworks.seed.json``, CURRICULUM.md §3). The stored
    syllabi under ``syllabi/`` are optional: without them the registry still answers search and
    levels, and a unit list falls through to discovery, which is exactly the on-demand law (§8).
    """
    base = root or content_root()
    seed = Seed()
    _load_frameworks(base, seed)
    _load_syllabi(base, seed)
    if seed.skipped:
        logger.warning(
            "curriculum seed entries skipped",
            extra={
                "fields": {
                    "frameworks": seed.skipped_frameworks,
                    "syllabi": seed.skipped_syllabi,
                    "nodes": seed.skipped_nodes,
                }
            },
        )
    logger.info(
        "curriculum seed loaded",
        extra={
            "fields": {
                "frameworks": len(seed.frameworks),
                "versions": len(seed.versions),
                "nodes": len(seed.nodes),
                "skipped": seed.skipped,
                "blocked": seed.blocked_syllabi,
            }
        },
    )
    return seed


# --- the protocol ------------------------------------------------------------------------------


class CurriculumStore(Protocol):
    """Everything the capabilities need, and nothing they do not."""

    def search_frameworks(
        self, query: str, *, country: str | None = ..., limit: int = ..., subject: str | None = ...
    ) -> list[Framework]: ...

    def get_framework(
        self, framework_id: str, *, subject: str | None = ...
    ) -> Framework | None: ...

    def put_framework(self, framework: Framework) -> Framework: ...

    def versions_for(self, framework_id: str) -> list[Version]: ...

    def get_version(self, version_id: str) -> Version | None: ...

    def latest_version(self, framework_id: str) -> Version | None: ...

    def latest_versions(self, framework_ids: Sequence[str]) -> dict[str, Version]: ...

    def put_version(self, version: Version) -> Version: ...

    def put_nodes(self, nodes: Sequence[Node]) -> None: ...

    def put_provenance(self, records: Sequence[Provenance]) -> None: ...

    def put_review_row(self, row: dict[str, Any]) -> dict[str, Any]: ...

    def review_queue(self, *, state: str | None = ...) -> list[dict[str, Any]]: ...

    def children(
        self, version_id: str, parent_id: str | None, *, kind: NodeKind | None = ...
    ) -> list[Node]: ...

    def all_nodes(self, version_id: str) -> list[Node]: ...

    def get_node(self, node_id: str) -> Node | None: ...

    def provenance_for(self, version_id: str, node_id: str | None = ...) -> Provenance | None: ...

    def all_provenance(self, version_id: str) -> list[Provenance]: ...

    def get_overlay(self, subject: str, version_id: str) -> Overlay | None: ...

    def put_overlay(self, overlay: Overlay) -> Overlay: ...

    def get_pin(self, subject: str, framework_id: str) -> str | None: ...

    def put_pin(self, subject: str, framework_id: str, version_id: str) -> None: ...

    def get_personal(self, subject: str, framework_id: str) -> dict[str, Any] | None: ...

    def put_personal(self, subject: str, framework: dict[str, Any]) -> dict[str, Any]: ...

    def list_personal(self, subject: str) -> list[dict[str, Any]]: ...

    def find_open_job(
        self, *, framework_id: str | None, query: str, level: str | None, subject: str | None
    ) -> DiscoveryJob | None: ...

    def find_recent_job(
        self,
        *,
        framework_id: str | None,
        query: str,
        level: str | None,
        subject: str | None,
        within_s: float = ...,
    ) -> DiscoveryJob | None: ...

    def enqueue_discovery(
        self,
        *,
        query: str,
        framework_id: str | None = ...,
        level: str | None = ...,
        subject: str | None = ...,
        requested_by: str | None = ...,
    ) -> DiscoveryJob: ...

    def get_job(self, job_id: str) -> DiscoveryJob | None: ...

    def update_job(
        self,
        job_id: str,
        *,
        state: JobState | str,
        message: str | None = ...,
        result: dict[str, Any] | None = ...,
    ) -> DiscoveryJob | None: ...

    def latest_job(
        self, *, framework_id: str | None, query: str, level: str | None, subject: str | None
    ) -> DiscoveryJob | None: ...

    def queued_jobs(self, *, limit: int = ...) -> list[DiscoveryJob]: ...

    def stale_open_jobs(self, *, older_than_s: float) -> list[DiscoveryJob]: ...

    def claim_job(
        self,
        job_id: str,
        *,
        state: JobState | str,
        message: str | None = ...,
        result: dict[str, Any] | None = ...,
    ) -> DiscoveryJob | None: ...

    def all_versions(self, *, limit: int = ...) -> list[Version]: ...


def _sorted_nodes(nodes: Iterable[Node]) -> list[Node]:
    return sorted(nodes, key=lambda node: (node.order, node.name))


def _grouped(items: Iterable[Any], *, key: Callable[[Any], Any]) -> dict[Any, list[Any]]:
    out: dict[Any, list[Any]] = {}
    for item in items:
        out.setdefault(key(item), []).append(item)
    return out


# --- in memory ---------------------------------------------------------------------------------


class _PersonalDrafts:
    """A learner's own syllabus between the paste and the tap that publishes it (§6).

    It is keyed by the VERIFIED subject and the framework id together, so one learner can never
    read or overwrite another's draft even by guessing an id. Every read and write returns a deep
    copy: a caller that mutates what it was handed must not reach in here, because `own.confirm`
    and `own.publish` are defined as returning a NEW framework and leaving the old one alone (§2).

    Held in the process, deliberately and with a known cost: `curriculum.frameworks` does not
    exist in Supabase yet (migration 0008 is written and not applied), so nothing curriculum-side
    is durable today. A draft crosses seconds and two taps, so this is honest for now; a PUBLISHED
    personal framework must move to the database with the rest of the schema, and until it does a
    restart loses it. That is recorded in the wave's open issues rather than hidden here.
    """

    _MAX_PER_LEARNER = 12

    def __init__(self) -> None:
        self._personal_lock = threading.Lock()
        self._personal: dict[tuple[str, str], dict[str, Any]] = {}

    def get_personal(self, subject: str, framework_id: str) -> dict[str, Any] | None:
        if not subject or not framework_id:
            return None
        with self._personal_lock:
            found = self._personal.get((subject, framework_id))
        return deepcopy(found) if found is not None else None

    def put_personal(self, subject: str, framework: dict[str, Any]) -> dict[str, Any]:
        framework_id = str((framework.get("framework") or {}).get("id") or "")
        if not subject or not framework_id:
            raise ValueError("a personal framework needs an owner and an id")
        stored = deepcopy(framework)
        with self._personal_lock:
            mine = [key for key in self._personal if key[0] == subject]
            # A learner who keeps pasting does not get to fill the process. The oldest draft goes,
            # never the one they are working on.
            while (
                len(mine) >= self._MAX_PER_LEARNER and (subject, framework_id) not in self._personal
            ):
                del self._personal[mine.pop(0)]
            self._personal[(subject, framework_id)] = stored
        return deepcopy(stored)

    def list_personal(self, subject: str) -> list[dict[str, Any]]:
        with self._personal_lock:
            return [deepcopy(v) for (owner, _), v in self._personal.items() if owner == subject]


class InMemoryStore(_PersonalDrafts):
    """The store the mock gateway and the suite run on. Seeded from ``content/curriculum``."""

    def __init__(self, seed: Seed | None = None) -> None:
        super().__init__()
        loaded = seed if seed is not None else load_seed()
        self._lock = threading.Lock()
        self._enqueue_lock = threading.Lock()
        self._reviews: list[dict[str, Any]] = []
        self._frameworks: dict[str, Framework] = {f.id: f for f in loaded.frameworks}
        self._versions: dict[str, Version] = {v.id: v for v in loaded.versions}
        self._nodes: dict[str, Node] = {n.id: n for n in loaded.nodes}
        self._provenance: dict[tuple[str, str | None], Provenance] = {
            (p.version_id, p.node_id): p for p in loaded.provenance
        }
        self._overlays: dict[tuple[str, str], Overlay] = {}
        self._pins: dict[tuple[str, str], str] = {}
        self._jobs: dict[str, DiscoveryJob] = {}
        self.seed = loaded

    # -- registry
    def search_frameworks(
        self,
        query: str,
        *,
        country: str | None = None,
        limit: int = _SEARCH_LIMIT,
        subject: str | None = None,
    ) -> list[Framework]:
        with self._lock:
            visible = [f for f in self._frameworks.values() if _visible(f, subject)]
        return rank(visible, query, country=country, limit=limit)

    def get_framework(self, framework_id: str, *, subject: str | None = None) -> Framework | None:
        with self._lock:
            framework = self._frameworks.get(framework_id)
        return framework if framework is not None and _visible(framework, subject) else None

    def put_framework(self, framework: Framework) -> Framework:
        """Used by discovery and the own-syllabus path (Worker 3), and by the tests."""
        with self._lock:
            self._frameworks[framework.id] = framework
        return framework

    def versions_for(self, framework_id: str) -> list[Version]:
        with self._lock:
            found = [v for v in self._versions.values() if v.framework_id == framework_id]
        return sorted(found, key=lambda v: (v.published_at or "", v.label), reverse=True)

    def get_version(self, version_id: str) -> Version | None:
        with self._lock:
            return self._versions.get(version_id)

    def latest_version(self, framework_id: str) -> Version | None:
        versions = self.versions_for(framework_id)
        return versions[0] if versions else None

    def latest_versions(self, framework_ids: Sequence[str]) -> dict[str, Version]:
        wanted = set(framework_ids)
        with self._lock:
            rows = [v for v in self._versions.values() if v.framework_id in wanted]
        out: dict[str, Version] = {}
        for version in sorted(rows, key=lambda v: (v.published_at or "", v.label)):
            out[version.framework_id] = version  # last write wins, so the newest survives
        return out

    def put_version(self, version: Version) -> Version:
        with self._lock:
            self._versions[version.id] = version
        return version

    def put_nodes(self, nodes: Sequence[Node]) -> None:
        with self._lock:
            for node in nodes:
                self._nodes[node.id] = node

    # -- the tree
    def children(
        self, version_id: str, parent_id: str | None, *, kind: NodeKind | None = None
    ) -> list[Node]:
        with self._lock:
            found = [
                node
                for node in self._nodes.values()
                if node.version_id == version_id
                and node.parent_id == parent_id
                and (kind is None or node.kind is kind)
            ]
        return _sorted_nodes(found)

    def all_nodes(self, version_id: str) -> list[Node]:
        with self._lock:
            found = [node for node in self._nodes.values() if node.version_id == version_id]
        return _sorted_nodes(found)

    def get_node(self, node_id: str) -> Node | None:
        with self._lock:
            return self._nodes.get(node_id)

    def provenance_for(self, version_id: str, node_id: str | None = None) -> Provenance | None:
        with self._lock:
            return self._provenance.get((version_id, node_id)) or self._provenance.get(
                (version_id, None)
            )

    def put_provenance(self, records: Sequence[Provenance]) -> None:
        with self._lock:
            for record in records:
                self._provenance[(record.version_id, record.node_id)] = record

    def all_provenance(self, version_id: str) -> list[Provenance]:
        with self._lock:
            return [p for (vid, _), p in self._provenance.items() if vid == version_id]

    # -- moderation (§6: an offered syllabus is checked by a person before anyone else sees it)
    def put_review_row(self, row: dict[str, Any]) -> dict[str, Any]:
        stored = deepcopy(row)
        stored.setdefault("state", "open")
        stored.setdefault("created_at", datetime.now(UTC).isoformat())
        with self._lock:
            self._reviews = [r for r in self._reviews if r.get("id") != stored.get("id")]
            self._reviews.append(stored)
        return deepcopy(stored)

    def review_queue(self, *, state: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            rows = [deepcopy(r) for r in self._reviews]
        return [r for r in rows if state is None or r.get("state") == state]

    # -- the learner
    def get_overlay(self, subject: str, version_id: str) -> Overlay | None:
        with self._lock:
            return self._overlays.get((subject, version_id))

    def put_overlay(self, overlay: Overlay) -> Overlay:
        overlay.updated_at = datetime.now(UTC).isoformat()
        with self._lock:
            self._overlays[(overlay.subject_id, overlay.version_id)] = overlay
        return overlay

    def get_pin(self, subject: str, framework_id: str) -> str | None:
        with self._lock:
            return self._pins.get((subject, framework_id))

    def put_pin(self, subject: str, framework_id: str, version_id: str) -> None:
        with self._lock:
            self._pins[(subject, framework_id)] = version_id

    # -- discovery
    def find_open_job(
        self,
        *,
        framework_id: str | None,
        query: str,
        level: str | None,
        subject: str | None,
    ) -> DiscoveryJob | None:
        key = _job_key(framework_id, query, level, subject)
        with self._lock:
            for job in self._jobs.values():
                if not job.open:
                    continue
                if _job_key(job.framework_id, job.query, job.level, job.subject) == key:
                    return job
        return None

    def find_recent_job(
        self,
        *,
        framework_id: str | None,
        query: str,
        level: str | None,
        subject: str | None,
        within_s: float = DISCOVERY_COOLDOWN_S,
    ) -> DiscoveryJob | None:
        """The last job about this syllabus, open or finished, inside the cooldown.

        A finished job is an answer, and re-asking the same question inside the window would run
        the same paid search to reach the same refusal. Outside the window it is worth asking
        again: the board may have published since.
        """
        key = _job_key(framework_id, query, level, subject)
        with self._lock:
            found = [
                job
                for job in self._jobs.values()
                if _job_key(job.framework_id, job.query, job.level, job.subject) == key
            ]
        recent = [
            job
            for job in found
            if job.open or ((_age_seconds(job.updated_at or job.created_at) or 0.0) <= within_s)
        ]
        recent.sort(key=lambda job: (job.open, job.updated_at or ""), reverse=True)
        return recent[0] if recent else None

    def enqueue_discovery(
        self,
        *,
        query: str,
        framework_id: str | None = None,
        level: str | None = None,
        subject: str | None = None,
        requested_by: str | None = None,
    ) -> DiscoveryJob:
        # One lock across the whole find-and-insert. Reading under one lock and writing under
        # another leaves a window, and eight learners opening the same class at once went through
        # it and started eight paid jobs (§12). A lock of its own rather than `self._lock`, so a
        # caller's `find_open_job` can still take that one without deadlocking against us.
        with self._enqueue_lock:
            existing = self.find_open_job(
                framework_id=framework_id, query=query, level=level, subject=subject
            )
            if existing is not None:
                return existing  # never a second discovery for the same thing (§12)
            recent = self.find_recent_job(
                framework_id=framework_id, query=query, level=level, subject=subject
            )
            if recent is not None:
                return recent
            now = datetime.now(UTC).isoformat()
            job = DiscoveryJob(
                id=str(uuid.uuid4()),
                query=query,
                state=JobState.QUEUED,
                framework_id=framework_id,
                level=level,
                subject=subject,
                requested_by=requested_by,
                created_at=now,
                updated_at=now,
            )
            with self._lock:
                self._jobs[job.id] = job
            return job

    def get_job(self, job_id: str) -> DiscoveryJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        *,
        state: JobState | str,
        message: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> DiscoveryJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.state = coerce_job_state(state)
            if message is not None:
                job.message = message
            if result is not None:
                job.result = result
            job.updated_at = datetime.now(UTC).isoformat()
            return job

    def latest_job(
        self, *, framework_id: str | None, query: str, level: str | None, subject: str | None
    ) -> DiscoveryJob | None:
        """The newest job about this syllabus, whatever its state and however old.

        This is the record of what was last done for a (framework, level, subject): the first
        learner's verify pass, or the discovery that stored it. ``find_recent_job`` answers "is
        it worth asking again"; this answers "what happened".
        """
        key = _job_key(framework_id, query, level, subject)
        with self._lock:
            found = [
                job
                for job in self._jobs.values()
                if _job_key(job.framework_id, job.query, job.level, job.subject) == key
            ]
        found.sort(key=lambda job: job.created_at or "", reverse=True)
        return found[0] if found else None

    def queued_jobs(self, *, limit: int = 20) -> list[DiscoveryJob]:
        with self._lock:
            queued = [job for job in self._jobs.values() if job.state is JobState.QUEUED]
        queued.sort(key=lambda job: job.created_at or "")
        return queued[: max(1, limit)]

    def stale_open_jobs(self, *, older_than_s: float) -> list[DiscoveryJob]:
        """Jobs a worker claimed and never finished: open, past ``queued``, and untouched for
        longer than a run is allowed to take. The process that owned them is gone."""
        with self._lock:
            open_jobs = [
                job for job in self._jobs.values() if job.open and job.state is not JobState.QUEUED
            ]
        return [
            job
            for job in open_jobs
            if (_age_seconds(job.updated_at or job.created_at) or 0.0) > older_than_s
        ]

    def claim_job(
        self,
        job_id: str,
        *,
        state: JobState | str,
        message: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> DiscoveryJob | None:
        """Take a queued job, atomically. None when it is not queued any more: another worker
        (or another replica) already has it, and two of them must never run one job."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.state is not JobState.QUEUED:
                return None
            job.state = coerce_job_state(state)
            job.attempts += 1
            if message is not None:
                job.message = message
            if result is not None:
                job.result = result
            job.updated_at = datetime.now(UTC).isoformat()
            return job

    def all_versions(self, *, limit: int = 500) -> list[Version]:
        with self._lock:
            rows = list(self._versions.values())
        rows.sort(key=lambda v: (v.published_at or "", v.label), reverse=True)
        return rows[: max(1, limit)]


def _visible(framework: Framework, subject: str | None) -> bool:
    """The RLS rule, mirrored: a public row, or this learner's own personal framework."""
    return framework.owner_subject is None or (
        subject is not None and framework.owner_subject == subject
    )


def job_key_parts(
    framework_id: str | None, query: str, level: str | None, subject: str | None
) -> tuple[str, str, str]:
    """One syllabus, however it was typed.

    "Class 9" and "class 9" and "CLASS 9" and " Mathematics " are one syllabus, and used to be
    four discovery jobs — four paid searches, four extractions, four verify-tier readings, for
    one question. Both stores and the partial unique index in 0008 key on this, so they dedupe
    identically whichever one is answering.
    """
    return (
        version_rules.normalise(framework_id or query),
        version_rules.normalise(level or ""),
        version_rules.normalise(subject or ""),
    )


def _job_key(
    framework_id: str | None, query: str, level: str | None, subject: str | None
) -> tuple[str, str, str]:
    return job_key_parts(framework_id, query, level, subject)


def _age_seconds(stamp: str | None, *, now: datetime | None = None) -> float | None:
    """How long ago an ISO timestamp was, or None when it cannot be read."""
    if not stamp:
        return None
    try:
        moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return ((now or datetime.now(UTC)) - moment).total_seconds()


# --- PostgREST ---------------------------------------------------------------------------------

# (method, url, headers, body) -> (status, decoded json). One seam, so the suite can drive every
# query this module builds without a network and without monkeypatching urllib.
Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, Any]]


class StoreUnavailable(Exception):
    """The registry could not be reached. Callers fail honestly rather than inventing a syllabus."""


def _urllib_transport(
    method: str, url: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, Any]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
            raw = response.read().decode()
            return response.status, (json.loads(raw) if raw.strip() else [])
    except urllib.error.HTTPError as exc:  # a 4xx carries a body worth logging
        return exc.code, None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        raise StoreUnavailable(str(exc)) from exc


class PostgrestStore(_PersonalDrafts):
    """Supabase over PostgREST with the service-role key, scoped to the ``curriculum`` schema.

    The key never leaves the brain, so the client asks a capability and the capability asks here.
    Reads select exactly the columns a capability serves; writes are upserts, which is what makes
    "apply my overlay" idempotent under a retry.
    """

    def __init__(
        self, base_url: str, service_key: str, *, transport: Transport | None = None
    ) -> None:
        super().__init__()
        if not base_url or not service_key:
            raise ValueError("PostgrestStore needs a Supabase URL and a service-role key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._transport = transport or _urllib_transport

    # -- plumbing
    def _headers(self, *, write: bool = False, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
        }
        # PostgREST selects the schema by header. Without it every read lands in `public`, where
        # none of this exists — a silent empty registry rather than an error.
        if write:
            headers["Content-Profile"] = SCHEMA
            headers["Content-Type"] = "application/json"
        else:
            headers["Accept-Profile"] = SCHEMA
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _url(self, table: str, params: Sequence[tuple[str, str]]) -> str:
        query = urllib.parse.urlencode(list(params), quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{urllib.parse.quote(table)}?{query}"

    def _call(
        self, method: str, url: str, headers: dict[str, str], body: bytes | None
    ) -> tuple[int, Any]:
        """Every hop to Supabase goes through here, so a transport that dies dies honestly.

        A network failure is the failure that actually happens, and it used to escape as a 500:
        the "I could not reach the syllabus list just now" line (api.handle) fired only for a 4xx
        and for a write, never for the timeout. One conversion, at the one seam (§11).
        """
        try:
            return self._transport(method, url, headers, body)
        except StoreUnavailable:
            raise
        except (OSError, TimeoutError) as exc:
            raise StoreUnavailable(f"{method} {url.split('?', 1)[0]}: {exc}") from exc

    def _rows(self, table: str, params: Sequence[tuple[str, str]]) -> list[dict[str, Any]]:
        status, body = self._call("GET", self._url(table, params), self._headers(), None)
        if status >= 400 or not isinstance(body, list):
            logger.warning(
                "curriculum read failed",
                extra={"fields": {"table": table, "status": status}},
            )
            return []
        return [row for row in body if isinstance(row, dict)]

    def _write(
        self,
        table: str,
        rows: list[dict[str, Any]],
        *,
        params: Sequence[tuple[str, str]] = (),
        on_conflict: str | None = None,
        resolution: str = "merge-duplicates",
    ) -> list[dict[str, Any]]:
        """One upsert. ``merge-duplicates`` is the ordinary upsert (``on conflict do update``);
        ``ignore-duplicates`` is ``on conflict do nothing``, which is the only write the immutable
        tables accept twice: 0008's ``refuse_published_edit`` trigger fires on the UPDATE half of
        a merge, so a replayed write of a published version's nodes must not update at all."""
        prefer = "return=representation"
        query = list(params)
        if on_conflict:
            prefer = f"resolution={resolution},{prefer}"
            query.append(("on_conflict", on_conflict))
        status, body = self._call(
            "POST",
            self._url(table, query),
            self._headers(write=True, prefer=prefer),
            json.dumps(rows).encode(),
        )
        if status >= 400:
            raise StoreUnavailable(f"{table} write refused with {status}")
        return [row for row in body if isinstance(row, dict)] if isinstance(body, list) else []

    # -- registry
    def search_frameworks(
        self,
        query: str,
        *,
        country: str | None = None,
        limit: int = _SEARCH_LIMIT,
        subject: str | None = None,
    ) -> list[Framework]:
        needle = query.strip()
        limit = max(1, min(limit, _MAX_SEARCH_LIMIT))
        params: list[tuple[str, str]] = [
            ("select", "*"),
            # The generated `search_text` column carries name, aliases, country and region, and
            # the trigram GIN index in 0008 serves this ILIKE. `*` is escaped out of the needle
            # so a learner typing one cannot widen their own query.
            ("search_text", f"ilike.*{_escape_like(needle)}*"),
            # Read a few more than we will serve: the ordering below is ours, not the database's.
            ("limit", str(limit * 4)),
        ]
        # A comma is a separator inside `or=(…)`, so the subject is checked against the shape a
        # subject actually has before it is interpolated. One that is not that shape reads the
        # public rows only — never a wider filter than it asked for (§10).
        safe = safe_subject(subject)
        if safe:
            params.append(("or", f"(owner_subject_id.is.null,owner_subject_id.eq.{safe})"))
        else:
            params.append(("owner_subject_id", "is.null"))
        return rank(
            _frameworks(self._rows("frameworks", params)), needle, country=country, limit=limit
        )

    def put_framework(self, framework: Framework) -> Framework:
        self._write(
            "frameworks",
            [
                {
                    "id": framework.id,
                    "name": framework.name,
                    "aliases": list(framework.aliases),
                    "kind": framework.kind.value,
                    "country": framework.country,
                    "region": framework.region,
                    "languages": list(framework.languages),
                    "levels": list(framework.levels),
                    "official_site": framework.official_site,
                    "status": framework.status.value,
                    "owner_subject_id": framework.owner_subject,
                }
            ],
            on_conflict="id",
        )
        return framework

    def get_framework(self, framework_id: str, *, subject: str | None = None) -> Framework | None:
        rows = self._rows(
            "frameworks", [("select", "*"), ("id", f"eq.{framework_id}"), ("limit", "1")]
        )
        found = _frameworks(rows)
        if not found:
            return None
        return found[0] if _visible(found[0], subject) else None

    def versions_for(self, framework_id: str) -> list[Version]:
        rows = self._rows(
            "versions",
            [
                ("select", "*"),
                ("framework_id", f"eq.{framework_id}"),
                ("order", "published_at.desc.nullslast,label.desc"),
                ("limit", "50"),
            ],
        )
        return _versions(rows)

    def get_version(self, version_id: str) -> Version | None:
        found = _versions(
            self._rows("versions", [("select", "*"), ("id", f"eq.{version_id}"), ("limit", "1")])
        )
        return found[0] if found else None

    def latest_version(self, framework_id: str) -> Version | None:
        versions = self.versions_for(framework_id)
        return versions[0] if versions else None

    def latest_versions(self, framework_ids: Sequence[str]) -> dict[str, Version]:
        """The newest version of each of these frameworks, in ONE query.

        Type-ahead labels a row by what we hold for it (§5), and a query per keystroke per result
        is not a type-ahead. Ordered oldest first so the dict keeps the newest per framework.
        """
        wanted = [ident for ident in dict.fromkeys(framework_ids) if _SUBJECT_RE.match(ident or "")]
        if not wanted:
            return {}
        rows = self._rows(
            "versions",
            [
                ("select", "*"),
                ("framework_id", "in.(" + ",".join(wanted) + ")"),
                ("order", "published_at.asc.nullsfirst,label.asc"),
                ("limit", str(len(wanted) * 20)),
            ],
        )
        return {version.framework_id: version for version in _versions(rows)}

    def put_version(self, version: Version) -> Version:
        self._write(
            "versions",
            [
                {
                    "id": version.id,
                    "framework_id": version.framework_id,
                    "label": version.label,
                    "status": version.status.value,
                    "supersedes": version.supersedes,
                    "published_at": version.published_at,
                    "document_hash": version.document_hash,
                    "source_url": version.source_url,
                }
            ],
            on_conflict="id",
        )
        return version

    def put_nodes(self, nodes: Sequence[Node]) -> None:
        if not nodes:
            return
        # Parents before children: `nodes.parent_id` is a foreign key onto this same table.
        depth = {NodeKind.LEVEL: 0, NodeKind.SUBJECT: 1, NodeKind.UNIT: 2, NodeKind.TOPIC: 3}
        for _, batch in sorted(_grouped(nodes, key=lambda node: depth.get(node.kind, 4)).items()):
            self._write(
                "nodes",
                [
                    {
                        "id": node.id,
                        "version_id": node.version_id,
                        "kind": node.kind.value,
                        "parent_id": node.parent_id,
                        "name": node.name,
                        "aliases": list(node.aliases),
                        "order_index": node.order,
                        "source_ref": node.source_ref,
                    }
                    for node in batch
                ],
                on_conflict="id",
                resolution="ignore-duplicates",
            )

    def put_provenance(self, records: Sequence[Provenance]) -> None:
        if not records:
            return
        self._write(
            "provenance",
            [
                {
                    "id": provenance_id(record.version_id, record.node_id),
                    "version_id": record.version_id,
                    "node_id": record.node_id,
                    "source_url": record.source_url,
                    "source_page_or_section": record.source_page_or_section,
                    "document_hash": record.document_hash,
                    "fetched_at": record.fetched_at,
                    "extractor_model": record.extractor_model,
                    "verifier_model": record.verifier_model,
                    "checks_passed": list(record.checks_passed),
                    "verified_at": record.verified_at,
                    "verified_by": record.verified_by,
                }
                for record in records
            ],
            on_conflict="id",
            resolution="ignore-duplicates",
        )

    # -- moderation
    def put_review_row(self, row: dict[str, Any]) -> dict[str, Any]:
        written = self._write("review_queue", [dict(row)], on_conflict="id")
        return written[0] if written else dict(row)

    def review_queue(self, *, state: str | None = None) -> list[dict[str, Any]]:
        params: list[tuple[str, str]] = [
            ("select", "*"),
            ("order", "created_at.desc"),
            ("limit", "200"),
        ]
        if state:
            params.append(("state", f"eq.{state}"))
        return self._rows("review_queue", params)

    # -- the tree
    def children(
        self, version_id: str, parent_id: str | None, *, kind: NodeKind | None = None
    ) -> list[Node]:
        params: list[tuple[str, str]] = [
            ("select", "*"),
            ("version_id", f"eq.{version_id}"),
            ("parent_id", f"eq.{parent_id}" if parent_id else "is.null"),
            ("order", "order_index.asc,name.asc"),
            ("limit", "1000"),
        ]
        if kind is not None:
            params.append(("kind", f"eq.{kind.value}"))
        return _nodes(self._rows("nodes", params))

    def all_nodes(self, version_id: str) -> list[Node]:
        return _nodes(
            self._rows(
                "nodes",
                [
                    ("select", "*"),
                    ("version_id", f"eq.{version_id}"),
                    ("order", "order_index.asc,name.asc"),
                    ("limit", "5000"),
                ],
            )
        )

    def get_node(self, node_id: str) -> Node | None:
        found = _nodes(
            self._rows("nodes", [("select", "*"), ("id", f"eq.{node_id}"), ("limit", "1")])
        )
        return found[0] if found else None

    def provenance_for(self, version_id: str, node_id: str | None = None) -> Provenance | None:
        params: list[tuple[str, str]] = [
            ("select", "*"),
            ("version_id", f"eq.{version_id}"),
            ("node_id", f"eq.{node_id}" if node_id else "is.null"),
            ("limit", "1"),
        ]
        rows = self._rows("provenance", params)
        if not rows and node_id:
            return self.provenance_for(version_id, None)
        return Provenance.from_row(rows[0]) if rows else None

    def all_provenance(self, version_id: str) -> list[Provenance]:
        rows = self._rows(
            "provenance",
            [("select", "*"), ("version_id", f"eq.{version_id}"), ("limit", "5000")],
        )
        return [Provenance.from_row(row) for row in rows]

    # -- the learner
    def get_overlay(self, subject: str, version_id: str) -> Overlay | None:
        safe = safe_subject(subject)
        if not safe:
            return None
        rows = self._rows(
            "overlays",
            [
                ("select", "*"),
                ("subject_id", f"eq.{safe}"),
                ("version_id", f"eq.{version_id}"),
                ("limit", "1"),
            ],
        )
        return Overlay.from_row(rows[0]) if rows else None

    def put_overlay(self, overlay: Overlay) -> Overlay:
        safe = safe_subject(overlay.subject_id)
        if not safe:
            raise StoreUnavailable("an overlay needs a subject id we can store")
        rows = self._write(
            "overlays",
            [
                {
                    "subject_id": safe,
                    "version_id": overlay.version_id,
                    "patch": overlay.patch,
                    "last_report": overlay.last_report,
                }
            ],
            on_conflict="subject_id,version_id",
        )
        return Overlay.from_row(rows[0]) if rows else overlay

    def get_pin(self, subject: str, framework_id: str) -> str | None:
        safe = safe_subject(subject)
        if not safe:
            return None
        rows = self._rows(
            "pins",
            [
                ("select", "version_id"),
                ("subject_id", f"eq.{safe}"),
                ("framework_id", f"eq.{framework_id}"),
                ("limit", "1"),
            ],
        )
        return str(rows[0]["version_id"]) if rows and rows[0].get("version_id") else None

    def put_pin(self, subject: str, framework_id: str, version_id: str) -> None:
        safe = safe_subject(subject)
        if not safe:
            raise StoreUnavailable("a pin needs a subject id we can store")
        self._write(
            "pins",
            [
                {
                    "subject_id": safe,
                    "framework_id": framework_id,
                    "version_id": version_id,
                }
            ],
            on_conflict="subject_id,framework_id",
        )

    # -- discovery
    def find_open_job(
        self,
        *,
        framework_id: str | None,
        query: str,
        level: str | None,
        subject: str | None,
    ) -> DiscoveryJob | None:
        rows = self._rows("discovery_jobs", self._job_params(framework_id, query, level, subject))
        return _job(rows[0]) if rows else None

    def _job_params(
        self,
        framework_id: str | None,
        query: str,
        level: str | None,
        subject: str | None,
        *,
        open_only: bool = True,
    ) -> list[tuple[str, str]]:
        """The key, normalised the same way :func:`job_key_parts` normalises it.

        The row stores the normalised level and subject rather than the learner's keystrokes, so
        "class 9" and "CLASS 9" are one job here exactly as they are in memory and under the
        partial unique index in 0008. What the learner typed is theirs and stays in their session;
        this row is a key.
        """
        _, level_key, subject_key = job_key_parts(framework_id, query, level, subject)
        params: list[tuple[str, str]] = [
            ("select", "*"),
            ("framework_id", f"eq.{framework_id}" if framework_id else "is.null"),
            ("level", f"eq.{level_key}" if level_key else "is.null"),
            ("subject", f"eq.{subject_key}" if subject_key else "is.null"),
            ("order", "created_at.desc"),
            ("limit", "1"),
        ]
        if open_only:
            params.insert(1, ("state", "in.(queued,searching,extracting,checking)"))
        if not framework_id:
            params.append(("query", f"eq.{version_rules.normalise(query)}"))
        return params

    def find_recent_job(
        self,
        *,
        framework_id: str | None,
        query: str,
        level: str | None,
        subject: str | None,
        within_s: float = DISCOVERY_COOLDOWN_S,
    ) -> DiscoveryJob | None:
        since = (datetime.now(UTC) - timedelta(seconds=within_s)).isoformat()
        params = self._job_params(framework_id, query, level, subject, open_only=False)
        params.append(("created_at", f"gte.{since}"))
        rows = self._rows("discovery_jobs", params)
        return _job(rows[0]) if rows else None

    def enqueue_discovery(
        self,
        *,
        query: str,
        framework_id: str | None = None,
        level: str | None = None,
        subject: str | None = None,
        requested_by: str | None = None,
    ) -> DiscoveryJob:
        existing = self.find_open_job(
            framework_id=framework_id, query=query, level=level, subject=subject
        )
        if existing is not None:
            return existing
        recent = self.find_recent_job(
            framework_id=framework_id, query=query, level=level, subject=subject
        )
        if recent is not None:
            return recent
        query_key, level_key, subject_key = job_key_parts(framework_id, query, level, subject)
        row = {
            "query": query_key,
            "framework_id": framework_id,
            "level": level_key or None,
            "subject": subject_key or None,
            "requested_by": safe_subject(requested_by),
            "state": JobState.QUEUED.value,
        }
        try:
            written = self._write("discovery_jobs", [row])
        except StoreUnavailable:
            # The partial unique index refused it: another learner asked for the same syllabus
            # between our read and our write. That is the law working, not a failure.
            existing = self.find_open_job(
                framework_id=framework_id, query=query, level=level, subject=subject
            )
            if existing is None:
                raise
            return existing
        return _job(written[0]) if written else _job(row | {"id": str(uuid.uuid4())})

    def get_job(self, job_id: str) -> DiscoveryJob | None:
        rows = self._rows(
            "discovery_jobs", [("select", "*"), ("id", f"eq.{job_id}"), ("limit", "1")]
        )
        return _job(rows[0]) if rows else None

    def update_job(
        self,
        job_id: str,
        *,
        state: JobState | str,
        message: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> DiscoveryJob | None:
        resolved = coerce_job_state(state)
        patch: dict[str, Any] = {"state": resolved.value}
        if message is not None:
            patch["message"] = message
        if result is not None:
            patch["result"] = result
        if not job_is_open(resolved):
            patch["finished_at"] = datetime.now(UTC).isoformat()
        status, body = self._call(
            "PATCH",
            self._url("discovery_jobs", [("id", f"eq.{job_id}")]),
            self._headers(write=True, prefer="return=representation"),
            json.dumps(patch).encode(),
        )
        if status >= 400 or not isinstance(body, list) or not body:
            return None
        return _job(body[0])

    def latest_job(
        self, *, framework_id: str | None, query: str, level: str | None, subject: str | None
    ) -> DiscoveryJob | None:
        params = self._job_params(framework_id, query, level, subject, open_only=False)
        rows = self._rows("discovery_jobs", params)
        return _job(rows[0]) if rows else None

    def queued_jobs(self, *, limit: int = 20) -> list[DiscoveryJob]:
        rows = self._rows(
            "discovery_jobs",
            [
                ("select", "*"),
                ("state", "eq.queued"),
                ("order", "created_at.asc"),
                ("limit", str(max(1, limit))),
            ],
        )
        return [_job(row) for row in rows]

    def stale_open_jobs(self, *, older_than_s: float) -> list[DiscoveryJob]:
        since = (datetime.now(UTC) - timedelta(seconds=older_than_s)).isoformat()
        rows = self._rows(
            "discovery_jobs",
            [
                ("select", "*"),
                ("state", "in.(searching,extracting,checking)"),
                ("updated_at", f"lt.{since}"),
                ("order", "updated_at.asc"),
                ("limit", "50"),
            ],
        )
        return [_job(row) for row in rows]

    def claim_job(
        self,
        job_id: str,
        *,
        state: JobState | str,
        message: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> DiscoveryJob | None:
        """One conditional PATCH: ``id = ? and state = 'queued'``. PostgREST answers with the rows
        it changed, so an empty answer means another worker got there first and this one must
        walk away. That is the whole of "two replicas cannot both run one job", and it lives in
        the database rather than in a lock one process holds."""
        current = self.get_job(job_id)
        if current is None or current.state is not JobState.QUEUED:
            return None
        patch: dict[str, Any] = {
            "state": coerce_job_state(state).value,
            "attempts": current.attempts + 1,
            "started_at": datetime.now(UTC).isoformat(),
        }
        if message is not None:
            patch["message"] = message
        if result is not None:
            patch["result"] = result
        status, body = self._call(
            "PATCH",
            self._url("discovery_jobs", [("id", f"eq.{job_id}"), ("state", "eq.queued")]),
            self._headers(write=True, prefer="return=representation"),
            json.dumps(patch).encode(),
        )
        if status >= 400 or not isinstance(body, list) or not body:
            return None
        return _job(body[0])

    def all_versions(self, *, limit: int = 500) -> list[Version]:
        return _versions(
            self._rows(
                "versions",
                [
                    ("select", "*"),
                    ("order", "published_at.desc.nullslast,label.desc"),
                    ("limit", str(max(1, limit))),
                ],
            )
        )


_LIKE_SPECIALS = str.maketrans({"*": " ", "%": " ", "_": " ", "(": " ", ")": " ", ",": " "})


def _escape_like(needle: str) -> str:
    """A learner's keystrokes are not a query language: wildcards and PostgREST's own separators
    are flattened to spaces before they reach the filter."""
    return " ".join(needle.translate(_LIKE_SPECIALS).split())


def _frameworks(rows: Iterable[dict[str, Any]]) -> list[Framework]:
    out: list[Framework] = []
    for row in rows:
        try:
            out.append(Framework.from_row(row))
        except (ValueError, TypeError):
            continue
    return out


def _versions(rows: Iterable[dict[str, Any]]) -> list[Version]:
    out: list[Version] = []
    for row in rows:
        try:
            out.append(Version.from_row(row))
        except (ValueError, TypeError):
            continue
    return out


def _nodes(rows: Iterable[dict[str, Any]]) -> list[Node]:
    out: list[Node] = []
    for row in rows:
        try:
            out.append(Node.from_row(row))
        except (ValueError, TypeError):
            continue
    return _sorted_nodes(out)


def _job(row: dict[str, Any]) -> DiscoveryJob:
    return DiscoveryJob.from_row(row)


# --- the one the app uses ------------------------------------------------------------------------

_store: CurriculumStore | None = None
_store_lock = threading.Lock()


def build_store() -> CurriculumStore:
    """The real store when a project and a service-role key are configured, else the seeded one.

    ``CURRICULUM_STORE=memory`` forces the in-memory store, which is what the suite and a local
    run without Supabase use. There is no third mode: a half-configured store would answer some
    reads and silently drop others.
    """
    if (os.getenv("CURRICULUM_STORE") or "").strip().lower() == "memory":
        return InMemoryStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestStore(base, key)
    logger.info("curriculum store: no Supabase project configured, serving the seeded registry")
    return InMemoryStore()


def get_store() -> CurriculumStore:
    """The process-wide store. Built once — the seed is a few hundred kilobytes of JSON."""
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: CurriculumStore | None) -> None:
    """Test seam, and the hook the discovery worker uses to share one store."""
    global _store
    with _store_lock:
        _store = store
