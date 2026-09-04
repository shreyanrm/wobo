"""Migration 0018 — ``ops.model_calls`` and ``ops.usage_daily``, read as a contract.

WHAT THESE TESTS ARE, SAID PLAINLY SO NOBODY READS THEM AS MORE. **No Postgres runs here.** Every
assertion below is a string match over the CHARACTERS of a .sql file that has not been applied to
any database and has never been executed. They cannot prove that a revoked grant refuses a read,
that RLS denies a role, or that the rollup's arithmetic is right — only that the file still SAYS
the things a reviewer decided it must say. They are a diff alarm, not a database test, and they
follow ``test_subscriptions_schema.py`` in shape for exactly that reason.

What that leaves uncovered is real. Three things are worth doing against a Supabase branch before
this reaches production, recorded here so they are not lost:

1. A learner's token against ``/rest/v1/model_calls`` with ``Accept-Profile: ops`` must be
   refused. That is the single most important property in the file and a grep cannot prove it.
2. ``ops.roll_up_usage`` run twice over the same day must leave the same rollup, and must exclude
   delivery rows from ``calls`` while still summing their units.
3. ``ops.expire_model_calls`` must leave a day that has never been rolled up alone, however old.

The one thing a grep CAN prove is that nobody quietly deleted a line that was argued for, which is
the failure mode a text file actually has.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0018_usage_ledger.sql"
CALLS = "ops.model_calls"
ROLLUP = "ops.usage_daily"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_number_is_not_taken_twice() -> None:
    """0014 was the last one taken before this wave. 0015, 0016 and 0017 went to the console's own
    migrations as they landed beside this one, so the ledger is 0018. Two files claiming a number
    is a merge that applies exactly one of them."""
    numbered = [p.name for p in MIGRATIONS.glob("0018_*.sql")]
    assert numbered == ["0018_usage_ledger.sql"], numbered


# --- the ledger itself -------------------------------------------------------------------------
def test_every_column_the_console_needs_is_present(sql: str) -> None:
    """Each of these answers a question the owner asked out loud. Deleting one deletes a panel."""
    for column in (
        "occurred_at timestamptz not null",
        "day date not null",
        "capability text not null",
        "model_requested text",
        "model_served text",
        "fallback_used boolean not null default false",
        "tokens_in integer",
        "tokens_out integer",
        "cost_usd numeric(14, 6)",
        "cost_source text not null",
        "latency_ms integer",
        "cache_hit boolean not null default false",
        "anonymous boolean not null default false",
        "plan text not null",
        "learner_ref text",
        "unit_kind text not null",
        "unit_count numeric(12, 3) not null",
    ):
        assert column in sql, column


def _column_lines(sql: str, table: str) -> list[str]:
    """The column definitions of one CREATE TABLE, with every ``--`` comment stripped.

    The prose in this migration argues about questions and learners at length; the point of the
    test below is what the TABLE holds, so the commentary is removed before it is searched.
    """
    body = sql[sql.index(f"create table if not exists {table}") :]
    body = body[: body.index("\n);")]
    out = []
    for raw in body.splitlines()[1:]:
        line = raw.split("--", 1)[0].strip()
        if line:
            out.append(line)
    return out


def test_the_ledger_carries_no_column_that_could_hold_a_transcript(sql: str) -> None:
    """A table that can be joined into a reading history of a child is a different and far more
    dangerous object than a bill. The gateway enforces this on the write side too."""
    columns = " ".join(_column_lines(sql, CALLS)).lower()
    for forbidden in ("question", "answer", "prompt", "completion", "concept", "transcript"):
        assert forbidden not in columns, forbidden


def test_the_learner_is_a_pseudonym_and_the_file_says_so(sql: str) -> None:
    assert "learner_ref" in sql
    assert "never a subject id" in sql
    # No COLUMN that would carry the real identity into an accounting table. The learner tables
    # spell it `subject_id` and `learner_id`; neither belongs here.
    columns = " ".join(_column_lines(sql, CALLS))
    assert not re.search(r"\bsubject_id\b", columns)
    assert not re.search(r"\blearner_id\b", columns)


def test_money_and_counts_cannot_go_negative(sql: str) -> None:
    """A bug that wrote a negative cost would corrupt every total derived from this table, and
    would do it silently."""
    assert "check (cost_usd is null or cost_usd >= 0)" in sql
    assert "check (unit_count >= 0)" in sql
    assert "check (tokens_in is null or tokens_in >= 0)" in sql
    assert "check (latency_ms is null or latency_ms >= 0)" in sql


def test_the_two_row_kinds_are_a_closed_set(sql: str) -> None:
    """The rollup's arithmetic depends on it: a third kind nobody taught the GROUP BY about would
    silently land in the call counts."""
    assert "check (kind in ('model_call', 'delivery'))" in sql


def test_the_unit_is_deliberately_unconstrained(sql: str) -> None:
    """A capability shipped tomorrow must be recorded the day it ships, exactly as budget.py
    classifies an unknown capability rather than ignoring it. A check constraint here would turn
    a new unit into a rejected insert and a silently missing row."""
    assert not re.search(r"unit_kind text not null default 'turn' check", sql)
    assert "Intentionally unconstrained" in sql


def test_the_queries_the_console_runs_are_indexed(sql: str) -> None:
    assert "model_calls_day_idx" in sql
    assert "model_calls_day_capability_idx" in sql
    assert "model_calls_learner_idx" in sql


# --- the rollup ---------------------------------------------------------------------------------
def test_the_rollup_is_keyed_on_every_slice_the_owner_asked_for(sql: str) -> None:
    """By day, by model, by capability, by plan, by unit. All five, or a panel cannot be drawn."""
    assert "primary key (day, capability, model_served, plan, unit_kind)" in sql


def test_the_rollup_stores_sums_and_not_averages(sql: str) -> None:
    """A stored mean cannot be re-averaged across rows without lying, so the total is stored and
    the console divides."""
    assert "latency_ms_total bigint" in sql
    assert "avg" not in sql.lower().replace("average", "")


def test_a_delivery_row_is_not_counted_as_a_call(sql: str) -> None:
    assert "count(*) filter (where c.kind = 'model_call')" in sql


def test_unpriced_and_operator_entered_money_are_counted_separately(sql: str) -> None:
    """So a total is read as "this much, plus N we cannot price", never as the whole bill."""
    assert "count(*) filter (where c.kind = 'model_call' and c.cost_usd is null)" in sql
    assert "count(*) filter (where c.kind = 'model_call' and c.cost_source = 'configured')" in sql


def test_the_rollup_is_idempotent_and_safe_against_a_second_replica(sql: str) -> None:
    """Delete-then-insert is not safe against itself under READ COMMITTED: the second transaction
    never sees the rows the first has just inserted, so both insert and one dies on the key."""
    assert "delete from ops.usage_daily where day = p_day" in sql
    assert "pg_advisory_xact_lock" in sql


def test_retention_never_eats_a_day_that_was_never_summarised(sql: str) -> None:
    """Losing detail is a trade; losing history nobody rolled up is data loss."""
    assert "exists (select 1 from ops.usage_daily d where d.day = c.day)" in sql
    assert "p_keep_days integer default 45" in sql


def test_the_retention_window_agrees_with_the_gateway(sql: str) -> None:
    """A number that lives in two files drifts. This is the test that notices."""
    from wobo_gateway import ledger

    assert f"default {ledger.RETENTION_DAYS}" in sql
    assert f"{ledger.RETENTION_DAYS} DAYS" in sql  # and the header explains the choice


# --- the locks ----------------------------------------------------------------------------------
def test_only_the_service_role_can_reach_the_ledger(sql: str) -> None:
    """This table can see every learner in the product. The API roles get nothing."""
    assert "grant usage on schema ops to service_role;" in sql
    assert "revoke all on schema ops from anon, authenticated;" in sql
    for table in (CALLS, ROLLUP):
        assert f"grant all on {table} to service_role;" in sql
        assert f"revoke all on {table} from anon, authenticated;" in sql
    assert "revoke all on schema ops from public;" in sql


def test_the_functions_are_not_left_executable_by_everybody(sql: str) -> None:
    """A function's EXECUTE defaults to PUBLIC, which would hand a DELETE-shaped sweep to anyone
    holding a token."""
    assert "revoke all on function ops.roll_up_usage(date) from public, anon, authenticated;" in sql
    assert (
        "revoke all on function ops.expire_model_calls(integer) from public, anon, authenticated;"
        in sql
    )
    assert "grant execute on function ops.roll_up_usage(date) to service_role;" in sql
    assert "grant execute on function ops.expire_model_calls(integer) to service_role;" in sql


def test_rls_is_on_with_no_policies_at_all(sql: str) -> None:
    """Belt and braces: a grant edited by accident in some later migration should not be the only
    thing standing in the way."""
    assert f"alter table {CALLS} enable row level security;" in sql
    assert f"alter table {ROLLUP} enable row level security;" in sql
    assert "create policy" not in sql  # a policy here would GRANT access, not restrict it


def test_the_functions_are_search_path_hardened(sql: str) -> None:
    assert sql.count("set search_path = ''") == 2


def test_exposing_ops_to_postgrest_keeps_every_schema_already_exposed(sql: str) -> None:
    """The setting is replaced, not appended: dropping a schema here would take the app down."""
    line = "alter role authenticator set pgrst.db_schemas = "
    assert line in sql
    value = sql[sql.index(line) + len(line) :].split(";")[0]
    for schema in ("public", "graphql_public", "learner", "curriculum", "ops"):
        assert schema in value, schema


def test_it_is_additive_and_survives_being_applied_twice(sql: str) -> None:
    assert "create schema if not exists ops;" in sql
    assert sql.count("create table if not exists") == 2
    assert sql.count("create index if not exists") == 4
    assert "add column if not exists configured_calls" in sql


def test_the_file_explains_the_retention_choice_and_the_privacy_rule(sql: str) -> None:
    """The migration is where a decision is recorded. A reviewer six months from now reads this
    file, not a pull request."""
    head = sql[: sql.index("create schema")]
    assert "RETENTION" in head
    assert "NOT a transcript" in head
    assert "starts EMPTY" in head or "starts empty" in head.lower()
