"""Publish the seed to the registry: ``uv run python -m wobo_gateway.curriculum.publish``.

``content/curriculum`` holds 268 frameworks and every stored syllabus, and until this command
existed nothing carried them past the in-memory store. In production the registry was empty:
picking any board yielded no syllabus, and the site's "every subject your board sets" was not true.

Three ways to run it, all reading the seed through :func:`store.load_seed` so what is published
is exactly what the mock gateway serves:

    python -m wobo_gateway.curriculum.publish --dry-run          what WOULD be written, and counts
    python -m wobo_gateway.curriculum.publish --emit-sql FILE     one idempotent SQL file
    python -m wobo_gateway.curriculum.publish                     write through the store

Idempotent, whichever way. Every id is the uuid5 of its natural key (:func:`store.seed_id`), so
the same seed is the same rows in every run and every process; the SQL says ``on conflict do
nothing`` on every insert and the store path writes the immutable tables with
``ignore-duplicates``. Run it twice and the second run writes nothing.

The SQL is emitted in dependency order (frameworks, versions, nodes parents-first, provenance),
inside one transaction, with the counts it carries and the verification query in its header. It
is what an operator applies to production, and it is the one artefact of this command that never
needs a key: this module never reads one, and ``--emit-sql`` touches no network.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wobo_gateway.curriculum.models import Node, NodeKind, Provenance, Version
from wobo_gateway.curriculum.store import (
    CurriculumStore,
    InMemoryStore,
    Seed,
    build_store,
    load_seed,
    provenance_id,
)

logger = logging.getLogger("wobo.gateway.curriculum.publish")

TABLES = ("frameworks", "versions", "nodes", "provenance")
#: Rows per ``insert`` statement. Small enough to read in a diff, large enough to be one round trip.
CHUNK = 200
DEFAULT_SQL_PATH = Path(__file__).resolve().parents[3] / "harness" / "reports" / "publish-seed.sql"

VERIFY_SQL = (
    "select (select count(*) from curriculum.frameworks) as frameworks,\n"
    "       (select count(*) from curriculum.versions)   as versions,\n"
    "       (select count(*) from curriculum.nodes)      as nodes,\n"
    "       (select count(*) from curriculum.provenance) as provenance;"
)

_DEPTH = {
    NodeKind.LEVEL: 0,
    NodeKind.SUBJECT: 1,
    NodeKind.UNIT: 2,
    NodeKind.TOPIC: 3,
    NodeKind.OBJECTIVE: 4,
}


@dataclass
class Report:
    """What a run wrote, or would have. ``already`` counts rows that were there before."""

    dry_run: bool
    frameworks: int = 0
    versions: int = 0
    nodes: int = 0
    provenance: int = 0
    already: dict[str, int] = field(default_factory=dict)
    skipped: int = 0
    blocked: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "dry_run": self.dry_run,
            "frameworks": self.frameworks,
            "versions": self.versions,
            "nodes": self.nodes,
            "provenance": self.provenance,
            "already": dict(self.already),
            "seed_skipped": self.skipped,
            "seed_blocked": self.blocked,
        }


def counts(seed: Seed) -> dict[str, int]:
    return {
        "frameworks": len(seed.frameworks),
        "versions": len(seed.versions),
        "nodes": len(seed.nodes),
        "provenance": len(seed.provenance),
    }


def ordered_nodes(nodes: Iterable[Node]) -> list[Node]:
    """Parents before children: ``nodes.parent_id`` references the same table."""
    return sorted(nodes, key=lambda node: (_DEPTH.get(node.kind, 5), node.order, node.name))


# --- through the store ---------------------------------------------------------------------------
def publish(seed: Seed, store: CurriculumStore, *, dry_run: bool = False) -> Report:
    """Write the seed through the store. Versions that already exist are left exactly as they
    are (a published version is immutable, §2); nodes and provenance are ``do nothing`` writes."""
    report = Report(dry_run=dry_run, skipped=seed.skipped, blocked=seed.blocked_syllabi)
    report.frameworks = len(seed.frameworks)
    report.nodes = len(seed.nodes)
    report.provenance = len(seed.provenance)
    existing = {
        version.id for version in seed.versions if store.get_version(version.id) is not None
    }
    report.versions = len(seed.versions) - len(existing)
    report.already["versions"] = len(existing)
    if dry_run:
        return report
    for framework in seed.frameworks:
        store.put_framework(framework)
    for version in seed.versions:
        if version.id not in existing:
            store.put_version(version)
    store.put_nodes(ordered_nodes(seed.nodes))
    store.put_provenance(seed.provenance)
    return report


# --- as SQL --------------------------------------------------------------------------------------
def q(value: Any) -> str:
    """One SQL literal. Strings are standard-quoted (``'`` doubled, backslashes literal), and
    None is NULL. Nothing here is ever interpolated unquoted."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def q_array(values: Sequence[str]) -> str:
    if not values:
        return "array[]::text[]"
    return "array[" + ", ".join(q(v) for v in values) + "]::text[]"


def q_json(value: Any) -> str:
    if value is None:
        return "null"
    return q(json.dumps(value, ensure_ascii=False, separators=(",", ":"))) + "::jsonb"


def q_time(value: str | None) -> str:
    return "null" if not value else q(value) + "::timestamptz"


def _insert(table: str, columns: Sequence[str], rows: list[str], conflict: str) -> str:
    return (
        f"insert into curriculum.{table} ({', '.join(columns)})\nvalues\n"
        + ",\n".join(rows)
        + f"\non conflict ({conflict}) do nothing;\n"
    )


def _chunks(rows: list[str]) -> Iterable[list[str]]:
    for start in range(0, len(rows), CHUNK):
        yield rows[start : start + CHUNK]


def _framework_rows(seed: Seed) -> list[str]:
    return [
        "  ("
        + ", ".join(
            [
                q(f.id),
                q(f.name),
                q_array(list(f.aliases)),
                q(f.kind.value),
                q(f.country),
                q(f.region),
                q_array(list(f.languages)),
                q_array(list(f.levels)),
                q(f.official_site),
                q(f.status.value),
                q(f.owner_subject),
            ]
        )
        + ")"
        for f in seed.frameworks
    ]


def _version_rows(versions: Sequence[Version]) -> list[str]:
    return [
        "  ("
        + ", ".join(
            [
                q(v.id) + "::uuid",
                q(v.framework_id),
                q(v.label),
                q(v.status.value),
                (q(v.supersedes) + "::uuid") if v.supersedes else "null",
                q_time(v.published_at),
                q(v.document_hash),
                q(v.source_url),
            ]
        )
        + ")"
        for v in versions
    ]


def _node_rows(nodes: Sequence[Node]) -> list[str]:
    return [
        "  ("
        + ", ".join(
            [
                q(n.id) + "::uuid",
                q(n.version_id) + "::uuid",
                q(n.kind.value),
                (q(n.parent_id) + "::uuid") if n.parent_id else "null",
                q(n.name),
                q_array(list(n.aliases)),
                str(int(n.order)),
                q_json(n.source_ref),
            ]
        )
        + ")"
        for n in nodes
    ]


def _provenance_rows(records: Sequence[Provenance]) -> list[str]:
    return [
        "  ("
        + ", ".join(
            [
                q(provenance_id(p.version_id, p.node_id)) + "::uuid",
                q(p.version_id) + "::uuid",
                (q(p.node_id) + "::uuid") if p.node_id else "null",
                q(p.source_url),
                q(p.source_page_or_section),
                q(p.document_hash),
                q_time(p.fetched_at),
                q(p.extractor_model),
                q(p.verifier_model),
                q_array(list(p.checks_passed)),
                q_time(p.verified_at),
                q(p.verified_by),
            ]
        )
        + ")"
        for p in records
    ]


def _git_sha() -> str:
    try:
        out = subprocess.run(  # noqa: S603, S607, a fixed argv, for the header only
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def emit_sql(seed: Seed, *, generated_at: datetime | None = None, source: str = "") -> str:
    """One idempotent SQL file: frameworks, versions, nodes (parents first), provenance."""
    stamp = (generated_at or datetime.now(UTC)).replace(microsecond=0).isoformat()
    total = counts(seed)
    nodes = ordered_nodes(seed.nodes)
    header = [
        "-- publish-seed.sql: content/curriculum into the curriculum schema (migration 0008).",
        f"-- generated {stamp} from commit {source or _git_sha()}",
        "-- by: uv run python -m wobo_gateway.curriculum.publish --emit-sql",
        "--",
        "-- Idempotent: every id is the uuid5 of its natural key, and every insert says",
        "-- `on conflict do nothing`. Apply it twice and the second run changes nothing.",
        "-- Dependency order: frameworks, versions, nodes (level, subject, unit, topic,",
        "-- objective), provenance. One transaction.",
        "--",
        "-- Rows carried:",
        *(f"--   {table:<11} {total[table]:>6}" for table in TABLES),
        "--",
        "-- Verify after applying (expect the counts above, or more if discovery has run):",
        *("-- " + line for line in VERIFY_SQL.splitlines()),
        "",
        "begin;",
        "",
    ]
    parts: list[str] = ["\n".join(header)]
    fw_cols = [
        "id", "name", "aliases", "kind", "country", "region", "languages", "levels",
        "official_site", "status", "owner_subject_id",
    ]  # fmt: skip
    for chunk in _chunks(_framework_rows(seed)):
        parts.append(_insert("frameworks", fw_cols, chunk, "id"))
    v_cols = [
        "id", "framework_id", "label", "status", "supersedes", "published_at",
        "document_hash", "source_url",
    ]  # fmt: skip
    for chunk in _chunks(_version_rows(seed.versions)):
        parts.append(_insert("versions", v_cols, chunk, "id"))
    n_cols = [
        "id", "version_id", "kind", "parent_id", "name", "aliases", "order_index", "source_ref",
    ]  # fmt: skip
    for chunk in _chunks(_node_rows(nodes)):
        parts.append(_insert("nodes", n_cols, chunk, "id"))
    p_cols = [
        "id", "version_id", "node_id", "source_url", "source_page_or_section", "document_hash",
        "fetched_at", "extractor_model", "verifier_model", "checks_passed", "verified_at",
        "verified_by",
    ]  # fmt: skip
    for chunk in _chunks(_provenance_rows(seed.provenance)):
        parts.append(_insert("provenance", p_cols, chunk, "id"))
    parts.append("commit;\n")
    return "\n".join(parts)


# --- the command ---------------------------------------------------------------------------------
def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m wobo_gateway.curriculum.publish",
        description="Publish content/curriculum to the curriculum registry, idempotently.",
    )
    parser.add_argument("--dry-run", action="store_true", help="print what would be written")
    parser.add_argument(
        "--emit-sql",
        nargs="?",
        const=str(DEFAULT_SQL_PATH),
        metavar="FILE",
        help=f"write one idempotent SQL file instead of writing through the store "
        f"(default {DEFAULT_SQL_PATH})",
    )
    parser.add_argument(
        "--content",
        metavar="DIR",
        help="the seed directory (default: content/curriculum, or WOBO_CURRICULUM_CONTENT)",
    )
    args = parser.parse_args(argv)

    seed = load_seed(Path(args.content) if args.content else None)
    if not seed.frameworks:
        print("refusing: the seed loaded no frameworks", file=sys.stderr)
        return 2
    if args.emit_sql:
        path = Path(args.emit_sql)
        path.parent.mkdir(parents=True, exist_ok=True)
        sql = emit_sql(seed)
        path.write_text(sql, encoding="utf-8")
        summary = {"emitted": str(path), "bytes": len(sql.encode("utf-8")), **counts(seed)}
        print(json.dumps(summary, indent=2))
        return 0
    if not args.dry_run and (os.getenv("CURRICULUM_STORE") or "").strip().lower() != "memory":
        base = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
        if not (base and key):
            print(
                "refusing: no SUPABASE_URL and service-role key in the environment; use --dry-run, "
                "--emit-sql, or CURRICULUM_STORE=memory",
                file=sys.stderr,
            )
            return 2
    configured = bool(
        os.getenv("SUPABASE_URL")
        and (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY"))
    )
    if args.dry_run and not configured:
        # No project to compare against: count what an EMPTY registry would receive, and say so,
        # rather than counting against the seeded memory store and reporting the seed as already
        # published.
        store: CurriculumStore = InMemoryStore(Seed())
        against = "an empty registry (no project configured)"
    else:
        store = build_store()
        against = type(store).__name__
    report = publish(seed, store, dry_run=args.dry_run)
    print(json.dumps({**report.as_dict(), "against": against}, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover, the command line
    sys.exit(main())
