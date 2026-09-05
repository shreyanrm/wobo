"""Where a syllabus the brain read becomes rows in the registry.

Three callers hand a finished :class:`JobRecord` in here and get a :class:`Version` back: the
discovery worker (a syllabus we did not hold), the freshness path (a document that changed under
us) and the first-selection check (the same path, one learner earlier). None of them writes a
node themselves, so the rules below are enforced once.

* **Ids are the natural key.** A version is ``uuid5(framework, label)`` and a node is
  ``uuid5(version, kind, parent, name, order)``, exactly as :func:`store.load_seed` mints them.
  A syllabus discovered for ``CBSE 2026-27 Class 9 Sanskrit`` therefore joins the seeded
  ``CBSE 2026-27`` version rather than starting a second one, and a replayed write is the same
  rows again, which ``on conflict do nothing`` turns into nothing (``CURRICULUM.md`` §12: never
  a second discovery for a framework that is already stored).
* **Nothing is edited in place** (§2). A version that already exists is joined, never rewritten;
  a re-read that found the document changed becomes a **successor** with ``supersedes``, and the
  successor carries the framework's every other subject forward under new ids, so a learner on
  Class 9 Science does not lose their chapter list because Class 10 Mathematics was re-read.
* **Every node carries provenance** (§5), copied forward for the carried subjects and taken from
  the run for the re-read one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

from wobo_gateway.curriculum import versions as version_rules
from wobo_gateway.curriculum.discovery.job import JobRecord
from wobo_gateway.curriculum.models import (
    Framework,
    Node,
    NodeKind,
    Provenance,
    Status,
    Version,
    coerce_status,
)
from wobo_gateway.curriculum.store import CurriculumStore, Seed, _syllabus_nodes, seed_id

logger = logging.getLogger("wobo.gateway.curriculum.discovery.persist")


@dataclass(frozen=True)
class Persisted:
    """What one write did. ``nodes_written`` is zero when the rows were already there."""

    version: Version
    created_version: bool
    subject_node_id: str | None
    nodes_written: int
    units: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "version_id": self.version.id,
            "label": self.version.label,
            "created_version": self.created_version,
            "subject_node_id": self.subject_node_id,
            "nodes_written": self.nodes_written,
            "units": self.units,
        }


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _document_of(syllabus: dict[str, Any]) -> dict[str, Any]:
    documents = syllabus.get("documents")
    first = documents[0] if isinstance(documents, list) and documents else {}
    return first if isinstance(first, dict) else {}


def _file_shape(record: JobRecord) -> dict[str, Any]:
    """The record's syllabus in the shape ``content/curriculum/syllabi`` files use, with the run's
    provenance folded in where the seed loader reads it, so one reader serves both."""
    syllabus = dict(record.syllabus or {})
    provenance = dict(record.provenance or {})
    syllabus["provenance"] = {
        "extractor": provenance.get("extractor_model"),
        "verifier": provenance.get("verifier_model"),
        "checks_passed": list(provenance.get("checks_passed") or []),
        "verified_at": provenance.get("verified_at"),
        "verified_by": provenance.get("verified_by"),
    }
    return syllabus


def rows_for(record: JobRecord, version: Version) -> tuple[list[Node], list[Provenance]]:
    """The level, subject, unit, topic and objective rows of one record under ``version``."""
    sink = Seed()
    _syllabus_nodes(_file_shape(record), version, sink)
    return sink.nodes, sink.provenance


def _locate(
    store: CurriculumStore, version: Version, level_name: str, subject_name: str
) -> tuple[Node | None, Node | None]:
    level_key = version_rules.normalise(level_name)
    level = next(
        (
            node
            for node in store.children(version.id, None, kind=NodeKind.LEVEL)
            if version_rules.normalise(node.name) == level_key
        ),
        None,
    )
    if level is None:
        return None, None
    subject_key = version_rules.normalise(subject_name)
    subject = next(
        (
            node
            for node in store.children(version.id, level.id, kind=NodeKind.SUBJECT)
            if version_rules.normalise(node.name) == subject_key
        ),
        None,
    )
    return level, subject


def _version_row(
    framework: Framework,
    label: str,
    syllabus: dict[str, Any],
    *,
    supersedes: str | None,
    status: Status,
) -> Version:
    document = _document_of(syllabus)
    return Version(
        id=seed_id("version", framework.id, label),
        framework_id=framework.id,
        label=label,
        status=status,
        supersedes=supersedes,
        # Published the moment it is written: it is what a learner studies, and §2 freezes it.
        published_at=str(document.get("fetched_at") or _now()),
        document_hash=(
            str(document["document_sha256"]) if document.get("document_sha256") else None
        ),
        source_url=(str(document["url"]) if document.get("url") else None),
    )


def persist_discovery(store: CurriculumStore, framework: Framework, record: JobRecord) -> Persisted:
    """A record at ``provisional`` -> the version it joined (or started) and its rows.

    Idempotent twice over: the version is looked up before it is written, and a (level, subject)
    that already has chapters in that version is left exactly as it is, because two readings of
    one syllabus in one version would be two chapter lists for one learner.
    """
    syllabus = record.syllabus or {}
    if not syllabus.get("units"):
        raise ValueError("a record with no units has nothing to persist")
    label = str(syllabus.get("version") or record.request.version or "undated").strip()
    ident = seed_id("version", framework.id, label)
    version = store.get_version(ident)
    created = version is None
    if version is None:
        version = _version_row(
            framework,
            label,
            syllabus,
            supersedes=None,
            status=coerce_status(syllabus.get("status") or record.status),
        )
        store.put_version(version)
    level_name = str(syllabus.get("level") or record.request.level)
    subject_name = str(syllabus.get("subject") or record.request.subject)
    _, existing = _locate(store, version, level_name, subject_name)
    if existing is not None and store.children(version.id, existing.id, kind=NodeKind.UNIT):
        logger.info(
            "persist.already stored",
            extra={"fields": {"version": version.id, "subject": existing.id}},
        )
        return Persisted(version, created, existing.id, 0, 0)
    nodes, provenance = rows_for(record, version)
    store.put_nodes(nodes)
    store.put_provenance(provenance)
    subject = next((n for n in nodes if n.kind is NodeKind.SUBJECT), None)
    units = sum(1 for n in nodes if n.kind is NodeKind.UNIT)
    logger.info(
        "persist.stored",
        extra={
            "fields": {"version": version.id, "label": label, "nodes": len(nodes), "units": units}
        },
    )
    return Persisted(version, created, subject.id if subject else None, len(nodes), units)


def _carry_forward(
    store: CurriculumStore, old: Version, new: Version, *, replaced_subject_id: str
) -> tuple[list[Node], list[Provenance]]:
    """Every node of ``old`` except the replaced subject's subtree, re-minted under ``new``.

    The id formula is the one :func:`store._syllabus_nodes` uses, so the level node the carried
    subjects hang from is the very row the re-read subject's level resolves to: one level, not
    two. Provenance rides along unchanged except for the ids, because nothing about where a
    carried chapter came from has changed.
    """
    old_nodes = store.all_nodes(old.id)
    old_provenance = {p.node_id: p for p in store.all_provenance(old.id) if p.node_id}
    children: dict[str | None, list[Node]] = {}
    for node in old_nodes:
        children.setdefault(node.parent_id, []).append(node)
    nodes: list[Node] = []
    provenance: list[Provenance] = []

    def walk(parent_old: str | None, parent_new: str | None) -> None:
        for node in sorted(children.get(parent_old, []), key=lambda n: (n.order, n.name)):
            if node.id == replaced_subject_id:
                continue
            ident = seed_id(new.id, node.kind.value, parent_new or "", node.name, str(node.order))
            nodes.append(replace(node, id=ident, version_id=new.id, parent_id=parent_new))
            source = old_provenance.get(node.id)
            if source is not None:
                provenance.append(replace(source, version_id=new.id, node_id=ident))
            walk(node.id, ident)

    walk(None, None)
    return nodes, provenance


def persist_successor(
    store: CurriculumStore,
    framework: Framework,
    old: Version,
    subject: Node,
    record: JobRecord,
) -> Persisted:
    """A re-read of ONE subject becomes a new version of the WHOLE framework, superseding ``old``.

    The old version is not touched: learners pinned to it keep it, their overlays stay keyed to
    it, and ``curriculum.upgrade`` offers them the diff (§2, §6). If a version with the successor's
    label already exists it is returned as it is, so a re-run cannot mint a second successor.
    """
    syllabus = record.syllabus or {}
    if not syllabus.get("units"):
        raise ValueError("a record with no units has nothing to persist")
    # The document's own year wins when it is a new one; a republished same-year document takes
    # the revision label the freshness path asked for ("2026-27 rev 2"). Never the old label.
    stated = str(syllabus.get("version") or "").strip()
    asked = str(record.request.version or "").strip()
    same = version_rules.normalise(stated) == version_rules.normalise(old.label)
    label = asked if (not stated or same) else stated
    if not label or version_rules.normalise(label) == version_rules.normalise(old.label):
        raise ValueError("a successor needs a label of its own")
    ident = seed_id("version", framework.id, label)
    existing = store.get_version(ident)
    if existing is not None:
        _, subject_node = _locate(store, existing, record.request.level, record.request.subject)
        return Persisted(existing, False, subject_node.id if subject_node else None, 0, 0)
    new = _version_row(
        framework,
        label,
        syllabus,
        supersedes=old.id,
        status=coerce_status(syllabus.get("status") or record.status),
    )
    carried, carried_provenance = _carry_forward(store, old, new, replaced_subject_id=subject.id)
    fresh, fresh_provenance = rows_for(record, new)
    # The level node appears in both lists with the same id; the dict keeps one of each.
    by_id = {node.id: node for node in [*carried, *fresh]}
    prov_by_id = {p.node_id: p for p in [*carried_provenance, *fresh_provenance]}
    store.put_version(new)
    store.put_nodes(list(by_id.values()))
    store.put_provenance(list(prov_by_id.values()))
    subject_node = next((n for n in fresh if n.kind is NodeKind.SUBJECT), None)
    units = sum(1 for n in fresh if n.kind is NodeKind.UNIT)
    logger.info(
        "persist.successor",
        extra={
            "fields": {
                "old": old.id,
                "new": new.id,
                "label": label,
                "carried": len(carried),
                "fresh": len(fresh),
            }
        },
    )
    return Persisted(new, True, subject_node.id if subject_node else None, len(by_id), units)


def subject_nodes(store: CurriculumStore, version: Version) -> list[tuple[Node, Node]]:
    """Every (level, subject) pair a version holds, in the framework's order."""
    pairs: list[tuple[Node, Node]] = []
    for level in store.children(version.id, None, kind=NodeKind.LEVEL):
        for subject in store.children(version.id, level.id, kind=NodeKind.SUBJECT):
            pairs.append((level, subject))
    return pairs


__all__ = [
    "Persisted",
    "persist_discovery",
    "persist_successor",
    "rows_for",
    "subject_nodes",
]
