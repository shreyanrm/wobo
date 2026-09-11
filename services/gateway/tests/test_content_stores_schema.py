"""Migration 0026 — the five `content` stores, read as a contract.

WHAT THESE TESTS ARE, SAID PLAINLY SO NOBODY READS THEM AS MORE. **No Postgres runs here.** Every
assertion below is a string match over the CHARACTERS of a .sql file that has not been applied to
any database and has never been executed. They cannot prove that a revoked grant refuses a write,
that RLS denies a role, that the supersession trigger fires, or that the savings view's arithmetic
is right — only that the file still SAYS the things that were argued for. They are a diff alarm,
not a database test, and they follow `test_usage_ledger_schema.py` in shape for exactly that
reason.

What that leaves uncovered is real, and is recorded here so it is not lost. Against a Supabase
branch, before this reaches production:

1. A learner's token against `/rest/v1/turns` with `Accept-Profile: content` must be refused. It is
   the single most important property in the file and a grep cannot prove it.
2. Inserting a second live row for one key must fail on `*_one_live_row_per_key`, and inserting a
   successor must leave exactly one live row and one superseded one.
3. An insert whose `status` is 'rejected' and which names `supersedes` must leave the row it names
   ALONE — a regeneration that lost its best-of does not retire the row that beat it.
4. `update` on a body must raise, and `update` on `served_count` through `content.note_serves` must
   not.
5. `content.store_savings` over rows with a null `cost_usd` must count them and value them at
   nothing.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0026_content_stores.sql"

#: The five stores of docs/CACHES.md §1. Every structural assertion below runs over all of them,
#: so a sixth table added without the row law fails rather than passing quietly.
STORES = ("cores", "levels", "interactions", "assets", "turns")


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_number_is_not_taken_twice() -> None:
    """0025 (the waiting list) was the last number taken. Two files claiming a number is a merge
    that applies exactly one of them."""
    numbered = [p.name for p in MIGRATIONS.glob("0026_*.sql")]
    assert numbered == ["0026_content_stores.sql"], numbered


# --- five stores, one row law -------------------------------------------------------------------
@pytest.mark.parametrize("store", STORES)
def test_every_store_exists(sql: str, store: str) -> None:
    assert f"create table if not exists content.{store} (" in sql


@pytest.mark.parametrize("store", STORES)
def test_every_store_carries_the_same_spine(sql: str, store: str) -> None:
    """docs/CACHES.md §1: 'every row with provenance, the judge's score, the model and its cost, a
    version and supersedes'. A store missing one of these is a store whose rows cannot be audited,
    reverted or costed, and the whole point of putting this in Postgres was that they can be."""
    body = _table(sql, store)
    for column in (
        "body jsonb not null",
        "version integer not null default 1",
        f"supersedes uuid references content.{store}(id)",
        f"superseded_by uuid references content.{store}(id)",
        "superseded_at timestamptz",
        "status content.artifact_status",
        "judge_score numeric(5, 2)",
        "judge jsonb not null default '{}'::jsonb",
        "model text",
        "cost_usd numeric(14, 6)",
        "provenance jsonb not null default '{}'::jsonb",
        "served_count bigint not null default 0",
        "last_served_at timestamptz",
        "created_at timestamptz not null default now()",
    ):
        assert column in body, f"content.{store} lost `{column}`"


def _table(sql: str, store: str) -> str:
    """The text of one create-table statement, so a column found in a NEIGHBOURING table does not
    satisfy an assertion about this one."""
    start = sql.index(f"create table if not exists content.{store} (")
    end = sql.index("\n);", start)
    return sql[start:end]


def _columns(sql: str, store: str) -> str:
    """Only the COLUMN definitions of a table — no comments and no constraints.

    A constraint may legitimately name a word that must never be a column: `content.turns`
    REFUSES a body carrying `learner_ref`, and it has to spell it to refuse it.
    """
    lines = []
    for line in _table(sql, store).splitlines()[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith(("--", "constraint ", "check ", "and ", "not ")):
            continue
        lines.append(stripped)
    return "\n".join(lines)


# --- ruling 3: the live pointer is the database's job -------------------------------------------
@pytest.mark.parametrize("store", STORES)
def test_one_live_row_per_key_is_a_unique_index(sql: str, store: str) -> None:
    """Two replicas inserting the same regeneration at the same instant is not a hypothetical:
    `numReplicas` is a dial in railway.json. A convention cannot make one of them lose."""
    index = f"create unique index if not exists {store}_one_live_row_per_key"
    assert index in sql
    clause = sql[sql.index(index) : sql.index(index) + 400]
    assert "where superseded_by is null" in clause
    assert "status in ('provisional', 'canonical')" in clause, (
        f"{store}: a rejected or superseded row must be able to share a key with the live one"
    )


# --- ruling 4: the judge gate is at insert -------------------------------------------------------
@pytest.mark.parametrize("store", STORES)
def test_a_canonical_row_has_been_judged(sql: str, store: str) -> None:
    """docs/CACHES.md §2: 'A store never holds an unjudged core, level or design.'"""
    assert f"constraint {store}_canonical_means_judged" in sql
    assert "check (status <> 'canonical' or judge_score is not null)" in _table(sql, store)


# --- ruling 2: version, never overwrite ----------------------------------------------------------
def test_a_body_is_never_edited(sql: str) -> None:
    for column in (
        "new.body is distinct from old.body",
        "new.cost_usd is distinct from old.cost_usd",
    ):
        assert column in sql
    assert "create or replace function content.a_body_is_never_edited()" in sql
    assert "before update on content.%I" in sql


def test_a_loser_does_not_retire_the_winner(sql: str) -> None:
    """A regeneration that lost its best-of is inserted REJECTED and names what it tried to
    replace. Stamping that row superseded would retire the better artifact on the strength of the
    worse one, which is exactly backwards."""
    trigger = sql[sql.index("function content.stamp_the_superseded_row()") :]
    assert (
        "if new.supersedes is null or new.status not in ('provisional', 'canonical') then"
        in trigger
    )
    assert "A loser does not retire the winner" in trigger


def test_the_supersession_stamp_runs_before_the_insert(sql: str) -> None:
    """`after insert` could never have worked: the partial unique index on `key` is checked as the
    row goes in, so a successor arriving while its predecessor is still live is a unique violation
    and the trigger that would have retired the predecessor never runs. A regeneration could not be
    stored at all. Found by `test_a_superseding_row_retires_the_one_it_names`."""
    assert "create trigger stamp_superseded before insert on content.%I" in sql
    assert "after insert on content.%I" not in sql


def test_nothing_may_be_deleted_from_a_store(sql: str) -> None:
    """'Version, never overwrite' is not a habit if a caller can delete. The old row is what a
    learner mid-chapter is still being served and what a revert restores."""
    assert "revoke delete, truncate on content.%I from service_role" in sql
    assert "grant select, insert on content.%I to service_role" in sql


def test_update_is_granted_on_the_two_serve_counters_and_nothing_else(sql: str) -> None:
    """The grant and the trigger say the same thing in two languages. A blanket UPDATE grant would
    leave "version, never overwrite" resting on a trigger alone, and a trigger is one careless
    `drop trigger` from being a comment."""
    assert "grant update (served_count, last_served_at) on content.%I to service_role" in sql
    assert "grant select, insert, update on content.%I" not in sql


def test_the_savings_view_runs_with_the_callers_rights(sql: str) -> None:
    """A view without `security_invoker` runs as its owner, which on a managed project is a
    superuser — a way around the RLS forced on the five tables it reads."""
    assert (
        "create or replace view content.store_savings with (security_invoker = true) as" in sql
    )


# --- ruling 5: a generic turn has nowhere to put a person -----------------------------------------
def test_the_turns_table_has_no_learner_column(sql: str) -> None:
    """The privacy promise in executable form. Not one of these words may appear as a column in
    `content.turns`, because a column is where a leak would live."""
    body = _columns(sql, "turns")
    for banned in (
        "learner_id",
        "learner_ref",
        "subject_id",
        "user_id",
        "auth.uid",
        "meter_key",
        "session_id",
        "pseudonym",
        "name text",
        "age ",
        "email",
        "ip_",
    ):
        assert banned not in body, f"content.turns grew `{banned}` — a generic turn has no person"


def test_a_stored_turn_body_is_refused_if_it_carries_a_person(sql: str) -> None:
    """The gateway's door decides this in code; the schema says it a second time so the two halves
    have to agree. Every name here is a block the context packet actually uses for something
    personal (`generic_turn.REASONS` and `wobo._dossier`)."""
    assert "constraint turns_body_holds_no_person check (" in sql
    clause = sql[sql.index("constraint turns_body_holds_no_person check (") :][:900]
    for personal in (
        "lifetime",
        "machine",
        "mind",
        "learner",
        "facts",
        "parentFacts",
        "interests",
        "twinSummary",
        "canvas",
        "glass",
        "targets",
        "focus",
        "session",
    ):
        assert f"not (body ? '{personal}')" in clause, (
            f"a stored turn may now carry {personal!r}"
        )


def test_a_stored_turn_must_actually_say_something(sql: str) -> None:
    assert "constraint turns_body_says_something check (body ? 'say')" in sql


def test_a_question_is_a_question_and_not_an_essay(sql: str) -> None:
    """Keying on a paragraph would fill the table with rows of one: a long question is not the
    thing many learners ask in the same words."""
    assert "check (char_length(question_norm) between 3 and 300)" in sql


# --- ruling 6: binaries go to a private bucket ----------------------------------------------------
def test_the_asset_bucket_exists_and_is_private(sql: str) -> None:
    assert "insert into storage.buckets (id, name, public)" in sql
    assert "('content-assets', 'content-assets', false)" in sql


def test_an_asset_row_cannot_point_at_somebody_elses_server(sql: str) -> None:
    """A row that could carry `https://…` is a row that can point a learner's browser anywhere."""
    assert "constraint assets_object_path_is_a_path" in sql
    assert "object_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$'" in sql


def test_an_asset_carries_a_digest_of_its_own_bytes(sql: str) -> None:
    """So a swapped object is detectable from the row, without downloading it."""
    assert (
        "constraint assets_digest_is_a_digest "
        "check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')" in sql
    )
    assert "constraint assets_bytes_are_described_or_absent" in sql


# --- ruling 7: spend saved is derived, never guessed ----------------------------------------------
def test_the_savings_view_counts_only_the_serves_after_the_first(sql: str) -> None:
    """The first serve is the one that PAID for the row. Counting it as a saving would report the
    generation we bought as money we did not spend."""
    assert "create or replace view content.store_savings" in sql
    assert "sum(greatest(served_count - 1, 0) * cost_usd)" in sql


def test_an_unpriced_row_is_counted_and_never_valued_at_zero(sql: str) -> None:
    """The same honesty rule the usage ledger keeps: a total computed by reading `unpriced` as
    `free` understates the bill forever."""
    assert "count(*) filter (where cost_usd is null)" in sql
    assert "as rows_unpriced" in sql
    assert "filter (where cost_usd is not null), 0)                as saved_usd" in sql


def test_the_serve_counter_is_bumped_in_the_database(sql: str) -> None:
    """PostgREST cannot express `served_count = served_count + 1` in a PATCH, and a read-then-write
    from two replicas loses counts between them."""
    assert (
        "create or replace function content.note_serves"
        "(p_store text, p_ids uuid[], p_counts bigint[])" in sql
    )
    assert "set served_count = a.served_count + b.n" in sql
    assert "security invoker" in sql


def test_note_serves_refuses_a_store_it_does_not_know(sql: str) -> None:
    """It builds a table name with `format`, so an unknown store name is refused before it can
    become one."""
    assert "if p_store not in ('cores', 'levels', 'interactions', 'assets', 'turns') then" in sql
    assert "raise exception 'no such store: %', p_store" in sql


# --- ruling 8: service role only ------------------------------------------------------------------
def test_rls_is_on_forced_and_has_no_policies_at_all(sql: str) -> None:
    """A policy for `authenticated` would hand a learner's token the whole content library. There
    is none, and FORCE means the table owner is bound by that too."""
    assert "alter table content.%I enable row level security" in sql
    assert "alter table content.%I force row level security" in sql
    assert "create policy" not in sql, "0026 grew a policy; every table here is service-role only"


def test_the_schema_starts_closed_and_stays_closed(sql: str) -> None:
    for line in (
        "revoke all on schema content from public;",
        "revoke all on schema content from anon;",
        "revoke all on schema content from authenticated;",
        "alter default privileges in schema content revoke all on tables from public, anon,"
        " authenticated;",
        "grant usage on schema content to service_role;",
    ):
        assert line in sql


def test_the_functions_are_search_path_hardened(sql: str) -> None:
    """A function without `set search_path = ''` resolves unqualified names against the caller's
    path, which is how a definer function is turned into somebody else's."""
    definitions = re.findall(r"create or replace function content\.[a-z_]+\(", sql)
    assert len(definitions) == 3, definitions
    assert sql.count("set search_path = ''") == 3


def test_no_function_is_left_executable_by_everybody(sql: str) -> None:
    """The default grant on a new function is EXECUTE to public — the thing a hardening pass finds
    as an RPC nobody meant to publish."""
    assert (
        "revoke all on function content.note_serves(text, uuid[], bigint[]) "
        "from public, anon, authenticated;" in sql
    )
    assert (
        "grant execute on function content.note_serves(text, uuid[], bigint[]) to service_role;"
        in sql
    )


# --- postgrest ------------------------------------------------------------------------------------
def test_the_exposed_schema_list_is_appended_and_never_replaced(sql: str) -> None:
    """0019 tells the story of what happens otherwise: a migration read the SESSION's value, fell
    back to a shorter list, and dropped `ops` and `curriculum` out of PostgREST in production."""
    assert "from pg_roles r, unnest(r.rolconfig) as cfg" in sql
    assert "where r.rolname = 'authenticator'" in sql
    assert "alter role authenticator set pgrst.db_schemas = %L" in sql


def test_growth_is_added_to_the_exposed_schemas_because_0025_forgot(sql: str) -> None:
    """`waiting_list.py` reaches the `growth` schema with `Accept-Profile: growth`, and 0025 never
    added it to `pgrst.db_schemas`. Until it is on the list every write to the list that stands
    where the closed door used to be answers 404."""
    assert "foreach wanted in array array['growth', 'content'] loop" in sql
    gateway = (
        Path(__file__).resolve().parents[1] / "src/wobo_gateway/waiting_list.py"
    ).read_text()
    assert 'SCHEMA = "growth"' in gateway, (
        "the waiting list moved off the `growth` schema — this migration should stop naming it"
    )


def test_it_is_additive_and_survives_being_applied_twice(sql: str) -> None:
    """Nothing here may fail on a second run: `create ... if not exists`, `create or replace`,
    `on conflict do nothing`, and a domain guarded by a catalogue lookup."""
    assert "create schema if not exists content;" in sql
    assert "on conflict (id) do nothing;" in sql
    assert "where n.nspname = 'content' and t.typname = 'artifact_status'" in sql
    for statement in re.findall(r"^create table (.*?) \(", sql, re.M):
        assert statement.startswith("if not exists"), statement
    for statement in re.findall(r"^create (?:unique )?index (.*?) on", sql, re.M):
        assert statement.startswith("if not exists"), statement


def test_the_file_explains_the_ephemeral_cache_it_replaces(sql: str) -> None:
    """The reason this schema exists is a production fact about two other committed files, and a
    reader of the migration alone must be able to find it."""
    assert "PLEXUS_CACHE_DIR=/home/gateway/cache" in sql
    assert "railway.json" in sql
    assert "docs/CACHES.md" in sql
