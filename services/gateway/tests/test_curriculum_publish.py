"""The publish command: the seed into the registry, once, and again is nothing (CURRICULUM.md §3,
§10, §12).

The seed under test is the real one, because the numbers the operator reads in the SQL header
and the numbers a verification query returns have to be the same numbers this suite holds.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from wobo_gateway.curriculum import publish as publish_mod
from wobo_gateway.curriculum.models import (
    Framework,
    FrameworkKind,
    Node,
    NodeKind,
    Provenance,
    Status,
    Version,
)
from wobo_gateway.curriculum.store import (
    InMemoryStore,
    PostgrestStore,
    Seed,
    load_seed,
    provenance_id,
    seed_id,
)


@pytest.fixture(scope="module")
def seed() -> Seed:
    return load_seed()


def tiny_seed() -> Seed:
    framework = Framework(
        id="kings-interhigh",
        name="King's InterHigh",
        kind=FrameworkKind.ONLINE,
        status=Status.VERIFIED,
        aliases=("King's", "KIH"),
        country="GB",
        levels=("Year 7",),
        official_site="https://kingsinterhigh.co.uk",
    )
    version = Version(
        id=seed_id("version", "kings-interhigh", "2026-27"),
        framework_id="kings-interhigh",
        label="2026-27",
        status=Status.PROVISIONAL,
        published_at="2026-09-03T07:03:44Z",
        document_hash="abc",
        source_url="https://kingsinterhigh.co.uk/syllabus.pdf",
    )
    level = Node(
        id=seed_id(version.id, "level"),
        version_id=version.id,
        kind=NodeKind.LEVEL,
        name="Year 7",
        order=7,
    )
    subject = Node(
        id=seed_id(version.id, "subject"),
        version_id=version.id,
        kind=NodeKind.SUBJECT,
        name="Maths",
        parent_id=level.id,
    )
    unit = Node(
        id=seed_id(version.id, "unit"),
        version_id=version.id,
        kind=NodeKind.UNIT,
        name="Pythagoras' theorem",
        parent_id=subject.id,
        source_ref={"page": 3, "section": "Term 1"},
    )
    provenance = [
        Provenance(
            version_id=version.id,
            node_id=node.id,
            source_url=version.source_url,
            document_hash="abc",
        )
        for node in (level, subject, unit)
    ]
    # Deliberately children-first: the emitter must reorder parents before children.
    return Seed(
        frameworks=[framework],
        versions=[version],
        nodes=[unit, subject, level],
        provenance=provenance,
    )


def registry_counts(store: InMemoryStore) -> dict[str, int]:
    versions = store.all_versions()
    return {
        "frameworks": len(store._frameworks),
        "versions": len(versions),
        "nodes": sum(len(store.all_nodes(v.id)) for v in versions),
        "provenance": sum(len(store.all_provenance(v.id)) for v in versions),
    }


# --- through the store ------------------------------------------------------------------------
def test_publish_writes_every_row_and_a_second_run_writes_nothing_new(seed: Seed) -> None:
    store = InMemoryStore(Seed())
    first = publish_mod.publish(seed, store)
    assert first.as_dict() | {"already": {}} == {
        "dry_run": False,
        "frameworks": 268,
        "versions": 4,
        "nodes": 1493,
        "provenance": 1493,
        "already": {},
        "seed_skipped": 0,
        "seed_blocked": 71,
    }
    assert registry_counts(store) == publish_mod.counts(seed)
    second = publish_mod.publish(seed, store)
    assert second.versions == 0 and second.already == {"versions": 4}
    assert registry_counts(store) == publish_mod.counts(seed), "a second run duplicated rows"


def test_the_seed_is_real_and_the_numbers_are_these(seed: Seed) -> None:
    """The numbers the operator will compare against production, held here so they cannot drift
    silently. 121 files, 71 of them honest negative results with a blocker code, 50 syllabi."""
    assert publish_mod.counts(seed) == {
        "frameworks": 268,
        "versions": 4,
        "nodes": 1493,
        "provenance": 1493,
    }
    assert seed.blocked_syllabi == 71 and seed.skipped == 0
    assert len({n.id for n in seed.nodes}) == len(seed.nodes), "a level node emitted once per file"
    assert {(v.framework_id, v.label) for v in seed.versions} == {
        ("cbse", "2026-27"),
        ("icse", "2026-27"),
        ("isc", "2026-27"),
        ("nios", "2023"),
    }
    assert sum(1 for n in seed.nodes if n.kind is NodeKind.SUBJECT) == 50


def test_a_dry_run_writes_nothing(seed: Seed) -> None:
    store = InMemoryStore(Seed())
    report = publish_mod.publish(seed, store, dry_run=True)
    assert report.dry_run and report.nodes == 1493
    assert registry_counts(store) == {"frameworks": 0, "versions": 0, "nodes": 0, "provenance": 0}


def test_ids_are_the_uuid5_of_the_natural_key(seed: Seed) -> None:
    cbse = next(v for v in seed.versions if v.framework_id == "cbse")
    assert cbse.id == seed_id("version", "cbse", "2026-27")
    assert cbse.id == "d32b30fc-be73-5a75-b1d1-e19908a931fc", "the id a learner's pin already names"
    for record in seed.provenance[:5]:
        assert provenance_id(record.version_id, record.node_id) == provenance_id(
            record.version_id, record.node_id
        )


def test_an_existing_published_version_is_never_rewritten(seed: Seed) -> None:
    """§2: a version that is already in the registry is joined, not replaced."""
    store = InMemoryStore(Seed())
    cbse = next(v for v in seed.versions if v.framework_id == "cbse")
    already = Version(
        id=cbse.id,
        framework_id="cbse",
        label="2026-27",
        status=Status.VERIFIED,
        published_at="2026-01-01T00:00:00Z",
    )
    store.put_version(already)
    publish_mod.publish(seed, store)
    assert store.get_version(cbse.id) == already


def test_postgrest_writes_the_immutable_tables_with_do_nothing() -> None:
    """0008's trigger refuses an UPDATE on a published version's nodes and provenance, and a
    PostgREST merge is an UPDATE on conflict. The publish path must therefore say do nothing."""
    calls: list[tuple[str, str, dict[str, str], Any]] = []

    def transport(method: str, url: str, headers: dict[str, str], body: bytes | None):
        calls.append((method, url, headers, json.loads(body) if body else None))
        if method == "GET":
            return 200, []
        return 201, json.loads(body) if body else []

    store = PostgrestStore("https://p.supabase.co", "service-role-key", transport=transport)
    publish_mod.publish(tiny_seed(), store)
    writes = {
        url.split("/rest/v1/", 1)[1].split("?", 1)[0]: (url, headers, body)
        for m, url, headers, body in calls
        if m == "POST"
    }
    assert set(writes) == {"frameworks", "versions", "nodes", "provenance"}
    assert "resolution=merge-duplicates" in writes["frameworks"][1]["Prefer"]
    for table in ("nodes", "provenance"):
        assert "resolution=ignore-duplicates" in writes[table][1]["Prefer"], table
        assert "on_conflict=id" in writes[table][0]
    row = writes["provenance"][2][0]
    assert row["id"] == provenance_id(row["version_id"], row["node_id"])
    # Parents before children, because nodes.parent_id references nodes.
    node_posts = [body for m, url, _, body in calls if m == "POST" and "/nodes?" in url]
    kinds = [row["kind"] for body in node_posts for row in body]
    assert kinds == ["level", "subject", "unit"]


# --- as SQL ------------------------------------------------------------------------------------
INSERT = re.compile(r"^insert into curriculum\.(\w+) \(([^)]+)\)$", re.MULTILINE)


def statements(sql: str) -> list[str]:
    return [
        part.strip()
        for part in sql.split(";\n")
        if part.strip() and not part.strip().startswith("--")
    ]


def test_emit_sql_is_one_transaction_in_dependency_order_with_do_nothing_everywhere(
    seed: Seed,
) -> None:
    sql = publish_mod.emit_sql(seed, source="test")
    parts = statements(sql)
    assert parts[0].endswith("begin") and parts[-1] == "commit"
    tables = [INSERT.search(part).group(1) for part in parts[1:-1]]
    order = ["frameworks", "versions", "nodes", "provenance"]
    assert [t for t in order if t in tables] == order
    assert tables == sorted(tables, key=order.index), "an insert is out of dependency order"
    for part in parts[1:-1]:
        assert part.endswith("on conflict (id) do nothing"), part[-80:]
    lowered = sql.lower()
    assert " update " not in lowered and "delete " not in lowered and "truncate" not in lowered


def test_emit_sql_carries_exactly_the_rows_it_says_it_does(seed: Seed) -> None:
    sql = publish_mod.emit_sql(seed, source="test")
    carried: dict[str, int] = {}
    for part in statements(sql)[1:-1]:
        table = INSERT.search(part).group(1)
        carried[table] = carried.get(table, 0) + sum(
            1 for line in part.splitlines() if line.startswith("  (")
        )
    assert carried == publish_mod.counts(seed)
    for table, count in carried.items():
        assert f"--   {table:<11} {count:>6}" in sql, (
            "the header must state the count the file carries"
        )
    assert publish_mod.VERIFY_SQL.splitlines()[0] in sql


def test_emit_sql_writes_parents_before_children() -> None:
    sql = publish_mod.emit_sql(tiny_seed(), source="test")
    node_lines = [
        line
        for line in sql.splitlines()
        if line.startswith("  ('")
        and "::uuid, '" in line
        and any(k in line for k in ("'level'", "'subject'", "'unit'"))
    ]
    kinds = [re.search(r"::uuid, '(level|subject|unit)'", line).group(1) for line in node_lines]
    assert kinds == ["level", "subject", "unit"]


def test_emit_sql_quotes_apostrophes_and_arrays_and_json() -> None:
    sql = publish_mod.emit_sql(tiny_seed(), source="test")
    assert "'King''s InterHigh'" in sql
    assert "array['King''s', 'KIH']::text[]" in sql
    assert "'Pythagoras'' theorem'" in sql
    assert '\'{"page":3,"section":"Term 1"}\'::jsonb' in sql
    assert "'2026-09-03T07:03:44Z'::timestamptz" in sql
    assert "array[]::text[]" in sql  # the unit's empty aliases


def test_emit_sql_is_the_same_file_for_the_same_seed(seed: Seed) -> None:
    """Idempotent at the file level too: two emissions differ only in their timestamp line."""
    from datetime import UTC, datetime

    when = datetime(2026, 9, 5, tzinfo=UTC)
    assert publish_mod.emit_sql(seed, generated_at=when, source="x") == publish_mod.emit_sql(
        seed, generated_at=when, source="x"
    )


def test_emit_sql_parses_as_postgres(seed: Seed) -> None:
    sqlglot = pytest.importorskip("sqlglot")
    parsed = sqlglot.parse(publish_mod.emit_sql(seed, source="test"), read="postgres")
    inserts = [s for s in parsed if type(s).__name__ == "Insert"]
    assert len(inserts) == 19
    assert all(s.args.get("conflict") is not None for s in inserts)


# --- the command --------------------------------------------------------------------------------
def test_the_command_refuses_to_write_without_a_project(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "CURRICULUM_STORE",
    ):
        monkeypatch.delenv(name, raising=False)
    assert publish_mod.main([]) == 2
    assert "refusing" in capsys.readouterr().err


def test_the_command_dry_runs_against_an_empty_registry_when_keyless(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "CURRICULUM_STORE",
    ):
        monkeypatch.delenv(name, raising=False)
    assert publish_mod.main(["--dry-run"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["versions"] == 4 and out["already"] == {"versions": 0}
    assert "empty registry" in out["against"]


def test_the_command_emits_the_sql_file_where_it_is_told(tmp_path: Path, capsys) -> None:
    target = tmp_path / "publish-seed.sql"
    assert publish_mod.main(["--emit-sql", str(target)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["emitted"] == str(target) and out["nodes"] == 1493
    assert target.read_text(encoding="utf-8").startswith("-- publish-seed.sql")


def _without_stamp(sql: str) -> str:
    return "\n".join(line for line in sql.splitlines() if not line.startswith("-- generated "))


def test_the_checked_in_sql_carries_the_seed_as_it_is_now(seed: Seed) -> None:
    """The file under harness/reports is what an operator applies, and every insert in it says
    ``on conflict do nothing`` while migration 0008 refuses updates to published rows. So a stale
    file is worse than none: applied first, it freezes the status and provenance of an older
    seed in production, and a later correct publish cannot repair it. On 2026-09-05 the checked-in
    file was 2,990 lines behind the seed (cbse 2026-27 and nios 2023 still ``provisional``, every
    provenance row without its verifier and checks). The file and the seed move together, or
    this fails: regenerate with ``uv run python -m wobo_gateway.curriculum.publish --emit-sql``."""
    checked_in = _without_stamp(publish_mod.DEFAULT_SQL_PATH.read_text(encoding="utf-8"))
    fresh = _without_stamp(publish_mod.emit_sql(seed, source="test"))
    # Compared by hand, not by ``==`` under pytest's rewriting: two 2 MB strings that differ
    # send the assertion diff into difflib for minutes. The first differing line is the message.
    if checked_in != fresh:
        first = next(
            (
                n
                for n, (a, b) in enumerate(zip(checked_in.splitlines(), fresh.splitlines()))
                if a != b
            ),
            min(checked_in.count("\n"), fresh.count("\n")),
        )
        raise AssertionError(
            "harness/reports/publish-seed.sql is stale against content/curriculum "
            f"(first difference at line {first + 1} of {checked_in.count(chr(10)) + 1} against "
            f"{fresh.count(chr(10)) + 1}); regenerate it with "
            "uv run python -m wobo_gateway.curriculum.publish --emit-sql"
        )


def test_the_default_sql_path_is_the_harness_report() -> None:
    assert publish_mod.DEFAULT_SQL_PATH.as_posix().endswith(
        "services/gateway/harness/reports/publish-seed.sql"
    )
