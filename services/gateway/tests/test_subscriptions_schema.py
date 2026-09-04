"""Migration 0014 — ``learner.subscriptions``, read as a contract.

WHAT THESE TESTS ARE, SAID PLAINLY SO NOBODY READS THEM AS MORE. **No Postgres runs here.** Every
assertion below is a string match over the CHARACTERS of a .sql file that has not been applied to
any database and has never been executed. They cannot prove that RLS scopes a row, that a revoked
grant refuses a write, or that a check constraint holds — only that the file still SAYS the things
a reviewer decided it must say. They are a diff alarm, not a database test: they fail when someone
deletes a line that was argued for, which is the failure mode a text file actually has.

What that leaves uncovered is real, and the only way to close it is to apply 0014 to a Supabase
branch and drive the SQL. Two of those are worth doing before it reaches production, and are
recorded here so they are not lost:

1. The upsert in ``packages/sdk/src/client.ts`` syncProfile against the narrowed profiles_cache
   grants. PostgREST's generated ``on conflict ... do update set`` includes the conflict target, so
   the update leg needs UPDATE on ``subject_id``; the migration now grants it, and the round trip
   is the proof.
2. The RLS policy: two learners, each reading, and neither seeing the other's row.

They follow ``test_parent_links_schema.py`` in shape, and they still catch the things a grep can:
a table left without RLS, a policy dropped, a client write re-granted, a cancelled row with no time
on it, a check constraint that refuses a plan the product sells, and a table block that would
silently no-op over an existing table of another shape.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0014_subscriptions.sql"
TABLE = "learner.subscriptions"
PROFILES = "learner.profiles_cache"

COLUMNS = (
    "id uuid primary key default gen_random_uuid()",
    "learner_id uuid not null unique",
    "plan text not null",
    "status text not null default 'active'",
    "origin text not null default 'web'",
    "current_period_end timestamptz not null",
    "started_at timestamptz not null default now()",
    "cancelled_at timestamptz",
    "created_at timestamptz not null default now()",
    "updated_at timestamptz not null default now()",
)


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_exists_and_follows_the_one_before_it() -> None:
    assert MIGRATION.is_file()
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0014") == numbers.index("0013") + 1
    assert numbers.count("0014") == 1


def test_the_table_answers_the_four_questions_and_says_where_it_was_bought(sql: str) -> None:
    """Which plan, active or cancelled, when the paid period ends, when it was cancelled — and
    the origin, because a store subscription is not ours to cancel."""
    assert f"create table if not exists {TABLE}" in sql
    for column in COLUMNS:
        assert column in sql, column
    assert "check (status in ('active', 'cancelled'))" in sql
    assert "check (origin in ('web', 'ios', 'android'))" in sql
    assert "check (plan in ('plus', 'pro', 'max'))" in sql


def test_a_cancelled_row_carries_its_time_and_an_active_one_does_not(sql: str) -> None:
    assert "check (status <> 'cancelled' or cancelled_at is not null)" in sql
    assert "check (status <> 'active' or cancelled_at is null)" in sql


def test_one_subscription_per_learner(sql: str) -> None:
    """Cancel and resume never have to guess which row is meant."""
    assert "learner_id uuid not null unique" in sql


def test_the_updated_at_trigger_the_other_tables_use(sql: str) -> None:
    assert re.search(
        rf"create trigger subscriptions_set_updated_at before update on {re.escape(TABLE)}\s+"
        r"for each row execute function learner\.set_updated_at\(\);",
        sql,
    )


def test_row_level_security_is_on(sql: str) -> None:
    assert re.search(rf"alter table {re.escape(TABLE)}\s+enable row level security", sql)


def test_a_learner_reads_only_their_own_row_and_writes_none_of_it(sql: str) -> None:
    """The RLS proof, the way 0002, 0010 and 0011 write it — plus the half that matters here:
    a client that could write this table could sell itself a plan, so the three writes are
    withdrawn as well as unpolicied (0002's default privileges grant all four)."""
    policies = list(
        re.finditer(
            rf"create policy (\w+) on {re.escape(TABLE)} for (\w+) to authenticated\s+([^;]+);",
            sql,
        )
    )
    verbs = {m.group(2) for m in policies}
    assert verbs == {"select"}, verbs
    for match in policies:
        clause = match.group(3)
        assert "using (learner_id = auth.uid())" in clause, match.group(1)
        assert " or " not in clause and "true" not in clause, match.group(1)

    assert f"revoke insert, update, delete on {TABLE} from authenticated" in sql
    assert f"grant select on {TABLE} to authenticated" in sql
    assert f"grant all on {TABLE} to service_role" in sql


def test_the_plan_constraint_no_longer_refuses_a_plan_the_product_sells(sql: str) -> None:
    """0006 wrote check (plan in ('free','plus')); budget.py prices free, pro and max. Both old
    values stay legal, so no existing row breaks."""
    assert f"alter table {PROFILES} drop constraint if exists profiles_cache_plan_check" in sql
    assert "check (plan in ('free', 'plus', 'pro', 'max'))" in sql


def test_a_learner_can_no_longer_hand_themselves_a_plan_or_a_consent_tier(sql: str) -> None:
    """profiles_cache_own is `for all`, so before this migration a learner could PATCH their own
    row and set plan = the largest word the constraint allowed. Table-level UPDATE cannot be
    narrowed by revoking a column from it: it is withdrawn and re-granted per column."""
    assert f"revoke insert, update on {PROFILES} from authenticated" in sql
    grants = re.findall(
        rf"grant (insert|update) \(([^)]+)\)\s+on {re.escape(PROFILES)} to authenticated", sql
    )
    assert {verb for verb, _ in grants} == {"insert", "update"}
    for verb, columns in grants:
        named = {c.strip() for c in columns.split(",")}
        assert "plan" not in named, verb
        assert "consent_tier" not in named, verb
        # Everything the app actually writes keeps working (packages/sdk syncProfile).
        assert {"display_name", "grade", "board", "archetype_slot"} <= named, verb


def test_the_profile_upsert_keeps_the_column_it_conflicts_on(sql: str) -> None:
    """The failure this migration would otherwise ship, invisibly.

    The app's ONLY writer of profiles_cache is an upsert: client.ts syncProfile posts
    ``{ subject_id, display_name, grade, board }`` through ``SupabaseRest.upsert``, which sends
    ``Prefer: resolution=merge-duplicates`` with ``?on_conflict=subject_id``. PostgREST turns that
    into ``insert ... on conflict (subject_id) do update set`` over every column in the payload,
    and Postgres requires UPDATE privilege on every column named in a SET list. Without
    ``subject_id`` in the update grant, every sync for an EXISTING row is refused 403 — and
    client.ts swallows it in a bare ``catch {}`` marked best-effort, so display name, grade and
    board would stop reaching the account for every learner, with no error anywhere.

    Scope is unaffected: ``profiles_cache_own`` still scopes each row to ``auth.uid()``, so the
    only subject_id a learner can write is the one already theirs.

    (Text-only, like the rest of this file. The runtime proof is one round trip on a Supabase
    branch, and the module docstring records it as owed.)
    """
    update = re.search(
        rf"grant update \(([^)]+)\)\s+on {re.escape(PROFILES)} to authenticated", sql
    )
    assert update is not None
    named = {c.strip() for c in update.group(1).split(",")}
    assert "subject_id" in named
    # …and the reason is written down beside it, because the next reader will want to remove it.
    assert "on_conflict" in sql or "on conflict" in sql


def test_the_table_block_cannot_half_apply_over_a_table_of_another_shape(sql: str) -> None:
    """``create table if not exists`` is silent about a table that already exists with a different
    shape: the whole block would no-op while the profiles_cache changes at the foot of the file
    still applied, leaving a half-migrated project that greps clean — including by this file. The
    migration therefore checks the shape and raises with the missing column named."""
    guard = sql[sql.index("create table") :]
    assert "information_schema.columns" in guard
    assert "raise exception" in guard
    for column in ("learner_id", "plan", "status", "origin", "current_period_end", "cancelled_at"):
        assert f"'{column}'" in guard, column
    # The guard runs before anything is granted or altered, so a mismatch stops the whole file.
    assert sql.index("raise exception") < sql.index("revoke insert, update on")


def test_the_migration_writes_down_why_it_is_a_table_and_not_a_column(sql: str) -> None:
    """The brief asked for the decision in the migration's own comment, so it is asserted."""
    head = sql[: sql.index("create table")]
    assert "profiles_cache" in head
    assert "cache" in head.lower()
    assert re.search(r"why a table", head, re.I)


def test_postgrest_is_told_to_reload(sql: str) -> None:
    assert "notify pgrst, 'reload schema';" in sql
