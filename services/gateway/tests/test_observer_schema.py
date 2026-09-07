"""Migration 0022, the observer's anonymous counts, read as a contract.

No Postgres runs here, so this follows ``test_reports_schema``: a grep for exactly the failures
that would be invisible until the day the counts were being read.

1. Neither counting table has a column that could hold a subject id, and the hash columns are
   checked to be digests. "Never who" is a property of the schema, not of the code that writes it.
2. One vote per learner per (node, op) is a UNIQUE constraint, so a hundred edits are one row.
3. The signal view joins votes to real use, so an account that never used the syllabus is
   counted nowhere.
4. 0008 grants SELECT on every new table in ``curriculum`` to learners by default privilege;
   every table and view here revokes it by name and turns RLS on with no policy.
5. The review queue accepts the consensus dossier.
6. The number is the next one in the sequence, and no other file took it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0022_curriculum_observer.sql"
TABLES = ("observer_use", "observer_votes", "observer_actions", "observer_settings")
VIEWS = ("observer_learners", "observer_signals")


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_exists_and_its_number_is_its_own() -> None:
    assert MIGRATION.is_file()
    numbers = [p.name[:4] for p in MIGRATIONS.glob("*.sql")]
    assert numbers.count("0022") == 1, "another migration has taken 0022"
    # 0023 (the payment provider's ids and the billing ledger) now follows this one; the sequence
    # itself is held by test_migration_sequence.py, so this only asks that 0022 is still reached.
    assert max(numbers) >= "0022"


def test_it_applies_after_the_curriculum_schema_and_the_review_kinds() -> None:
    assert (MIGRATIONS / "0008_curriculum.sql").is_file()
    assert (MIGRATIONS / "0009_curriculum_review_offers.sql").is_file()


def test_every_table_and_view_exists(sql: str) -> None:
    for table in TABLES:
        assert f"create table if not exists curriculum.{table}" in sql, table
    for view in VIEWS:
        assert f"create or replace view curriculum.{view} with (security_invoker = true)" in sql, (
            view
        )


def test_never_who(sql: str) -> None:
    """No subject column, and the two hash columns are checked to be digests."""
    for table in TABLES:
        block = sql.split(f"create table if not exists curriculum.{table}", 1)[1].split(");", 1)[0]
        assert "subject_id" not in block and "learner_id" not in block, table
    assert "constraint observer_use_hash_is_a_digest check (learner_hash ~ '^[0-9a-f]{32}$')" in sql
    assert "constraint observer_votes_hash_is_a_digest check (voter_hash ~ '^[0-9a-f]{32}$')" in sql


def test_one_vote_per_learner_per_node_and_op_is_a_constraint(sql: str) -> None:
    assert (
        "constraint observer_votes_one_per_learner unique (version_id, node_key, op, voter_hash)"
        in sql
    )
    assert "node_key text generated always as (coalesce(node_id::text, '')) stored" in sql


def test_a_vote_counts_only_joined_to_real_use(sql: str) -> None:
    view = sql.split("create or replace view curriculum.observer_signals", 1)[1].split(";", 1)[0]
    assert "join curriculum.observer_use u" in view
    assert "u.learner_hash = v.voter_hash" in view
    assert "count(distinct v.voter_hash)" in view


def test_no_learner_reads_the_counts(sql: str) -> None:
    for table in TABLES:
        assert f"alter table curriculum.{table}" in sql and "enable row level security" in sql
        assert f"revoke all on curriculum.{table} from public, anon, authenticated" in sql, table
        assert not re.search(rf"create policy \w+ on curriculum\.{table}", sql), table
    for view in VIEWS:
        assert f"revoke all on curriculum.{view} from public, anon, authenticated" in sql, view
        assert f"grant select on curriculum.{view} to service_role" in sql, view
    # What the observer did is a record: no DELETE on actions.
    assert "grant select, insert, update on curriculum.observer_actions to service_role" in sql
    assert "delete on curriculum.observer_actions" not in sql


def test_the_review_queue_takes_a_consensus_dossier(sql: str) -> None:
    assert (
        "check (kind in ('node_flag', 'framework_offer', 'promotion_request', 'consensus'))" in sql
    )


def test_the_actions_column_matches_the_code(sql: str) -> None:
    from wobo_gateway.curriculum import observer

    block = sql.split("check (action in", 1)[1].split("))", 1)[0]
    for action in observer.ACTIONS:
        assert f"'{action}'" in block, action


def test_the_ops_column_matches_the_code(sql: str) -> None:
    from wobo_gateway.curriculum import observer

    for op in observer.OPS:
        assert f"'{op}'" in sql, op
