"""Migration 0034 — the activity record, read as a contract.

No Postgres runs here (the migrations are applied through the project, never locally), so these
follow ``test_hospitality_schema.py``: the failures that would stay invisible until production,
each one a grep away. A record a learner's own token could rewrite, a day ledger with no end, a
function any caller could run, a retention promise with no sweep behind it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from wobo_gateway import activity

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0034_activity_record.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def _function(sql: str, name: str) -> str:
    match = re.search(rf"create or replace function learner\.{name}\((.*?)\n\$\$;", sql, flags=re.S)
    assert match, f"learner.{name} is not defined"
    return match.group(0)


def test_the_migration_is_the_next_number() -> None:
    assert MIGRATION.is_file()
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0034") == numbers.index("0033") + 1


def test_it_says_what_the_record_is_for_and_how_long_it_is_kept(sql: str) -> None:
    head = sql.split("create table", 1)[0].lower()
    # purpose, in the words the law uses
    assert "to teach" in head and "own mail" in head
    assert "never shared" in head and "advertising" in head and "third party" in head
    assert "9(3)" in head
    # retention, stated with the numbers the code keeps
    assert f"{activity.DAY_KEEP_DAYS} days" in head
    assert f"{activity.SESSION_KEEP_DAYS} days" in head
    assert "life of the account" in head
    # and the erase that sweeps it
    assert "/v1/me/erase" in head


def test_the_summary_table_and_its_columns(sql: str) -> None:
    assert "create table if not exists learner.activity (" in sql
    for column in (
        "subject_id uuid primary key",
        "first_came_on date not null",
        "last_came_at timestamptz not null",
        "last_came_on date not null",
        "timezone text not null default 'UTC'",
        "days_active integer not null default 0",
        "streak_days integer not null default 0",
        "streak_best integer not null default 0",
        "hours jsonb not null default '{}'::jsonb",
        "last_learned_on date",
        "moments jsonb not null default '[]'::jsonb",
        "progress jsonb",
        "sessions integer not null default 0",
    ):
        assert column in sql, column
    assert f"jsonb_array_length(moments) <= {activity.MAX_MOMENTS}" in sql
    assert "activity_last_came_idx" in sql


def test_nothing_on_the_record_is_a_tracking_field(sql: str) -> None:
    table = sql.split("create table if not exists learner.activity (", 1)[1].split(");", 1)[0]
    for banned in ("utm", "campaign", "open", "click", "ip_", "device", "email", "address"):
        assert banned not in table.lower(), banned


def test_a_learner_may_read_their_record_and_never_write_it(sql: str) -> None:
    """The streak and the last visit are computed by the gateway. A token that could write them
    could write its own mail schedule."""
    assert re.search(r"alter table learner\.activity\s+enable row level security", sql)
    assert re.search(
        r"create policy activity_own_read on learner\.activity for select to authenticated\s+"
        r"using \(subject_id = auth\.uid\(\)\);",
        sql,
    )
    assert "revoke insert, update, delete on learner.activity from anon, authenticated" in sql
    assert not re.search(r"create policy \w+ on learner\.activity for (all|insert|update)", sql)


def test_the_day_ledger_and_the_sessions_have_one_writer(sql: str) -> None:
    """0002 gave both tables a FOR ALL policy. The client may still read and delete its own rows
    (the SDK's own erase does), and may no longer write them."""
    for table in ("meter_state", "sessions"):
        assert f"drop policy if exists {table}_own on learner.{table};" in sql
        assert re.search(
            rf"create policy {table}_own_read on learner\.{table} for select to authenticated\s+"
            r"using \(subject_id = auth\.uid\(\)\);",
            sql,
        )
        assert re.search(
            rf"create policy {table}_own_erase on learner\.{table} for delete to authenticated\s+"
            r"using \(subject_id = auth\.uid\(\)\);",
            sql,
        )
        assert f"revoke insert, update on learner.{table} from anon, authenticated" in sql
    assert "revoke execute on function learner.op_start_session(jsonb) from authenticated" in sql
    assert "alter column budget_total set default 0" in sql


def test_note_activity_is_the_one_writer_and_only_the_gateway_runs_it(sql: str) -> None:
    body = _function(sql, "note_activity")
    assert "security invoker" in body and "set search_path = ''" in body
    # every kind the gateway sends, and no other
    for kind in activity.KINDS:
        assert f"'{kind}'" in body, kind
    # the learner's own calendar, and a zone that is not a zone falls back to UTC
    assert "at time zone v_zone" in body
    assert "v_zone := 'UTC'" in body
    # the day row is upserted and counted, and whether it is new decides the day count
    assert "on conflict (subject_id, date) do update" in body
    assert "budget_consumed = m.budget_consumed + excluded.budget_consumed" in body
    assert "(xmax = 0)" in body
    # a session is idempotent on its own id, and only its own learner closes it
    assert "on conflict (id) do nothing" in body
    assert "where id = p_session and subject_id = p_subject and ended_at is null" in body
    # one row per learner, locked while it is folded
    assert "for update" in body
    assert f"<= {activity.MAX_MOMENTS}" in body
    assert f"> {activity.HOURS_CEILING}" in body
    assert f"{activity.TITLE_MAX}" in body
    assert "revoke all on function learner.note_activity(" in sql
    assert re.search(
        r"grant execute on function learner\.note_activity\([^)]*\) to service_role;", sql
    )


def test_the_streak_rule_is_the_same_rule_as_the_gateways(sql: str) -> None:
    body = _function(sql, "note_activity")
    assert "v_day > v_row.last_came_on" in body
    assert "v_day = v_row.last_came_on + 1" in body
    assert "greatest(v_row.streak_days, 1)" in body
    assert "least(v_row.first_came_on, v_day)" in body
    assert "greatest(v_row.last_came_at, p_at)" in body


def test_the_census_counts_on_each_learners_own_calendar(sql: str) -> None:
    body = _function(sql, "activity_census")
    assert "p_bounds integer[]" in body
    assert "at time zone a.timezone" in body
    for key in ("'learners'", "'today'", "'week'", "'month'", "'steps'"):
        assert key in body
    assert "security invoker" in body
    assert re.search(
        r"grant execute on function learner\.activity_census\(integer\[\]\) to service_role;", sql
    )


def test_retention_has_a_sweep_behind_it(sql: str) -> None:
    body = _function(sql, "expire_activity")
    assert f"p_day_keep integer default {activity.DAY_KEEP_DAYS}" in body
    assert f"p_session_keep integer default {activity.SESSION_KEEP_DAYS}" in body
    assert "delete from learner.meter_state" in body
    assert "delete from learner.sessions" in body
    # the summary row is the account's, and a sweep never takes it
    assert "delete from learner.activity" not in body
    assert re.search(
        r"grant execute on function learner\.expire_activity\([^)]*\) to service_role;", sql
    )


def test_no_function_here_is_left_open_to_the_public(sql: str) -> None:
    for name in ("note_activity", "activity_census", "expire_activity"):
        assert re.search(rf"revoke all on function learner\.{name}\(", sql), name
        assert not re.search(rf"grant execute on function learner\.{name}\([^;]*authenticated", sql)


def test_it_is_additive_and_reloads_the_schema(sql: str) -> None:
    assert "drop table" not in sql.lower()
    assert "notify pgrst, 'reload schema';" in sql
