"""Migration 0020 — ``learner.wobo_mind``, read as a contract.

No Postgres runs here (migrations are applied through the project, never locally), so this
follows ``test_hospitality_schema.py``: the guard against the failures that would be invisible
until production. A table without RLS. A policy that lets one child read another child's mind —
the worst version of this product's worst bug. A cap that exists in Python and not in the
database, so one bad client can grow one row until the dossier is unreadable and the prompt
unaffordable. Each is one grep away from being caught.

It also holds the caps together: the number in the migration, the number in
:mod:`wobo_gateway.mind`, and the number in ``apps/web-pwa/src/store/mind.ts`` are the same
number in three places, and a wave that changes one of them has to change all three.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from wobo_gateway import mind

REPO = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0020_wobo_mind.sql"
TABLE = "learner.wobo_mind"

COLUMNS = (
    "subject_id uuid primary key",
    "interests jsonb not null default '[]'::jsonb",
    "facts jsonb not null default '[]'::jsonb",
    "latencies_ms jsonb not null default '[]'::jsonb",
    "slips jsonb not null default '[]'::jsonb",
    "dwell_sec jsonb not null default '{}'::jsonb",
    "session_days jsonb not null default '[]'::jsonb",
    "days jsonb not null default '{}'::jsonb",
    "helped_at timestamptz",
    "forgotten jsonb not null default '{}'::jsonb",
    "client_updated_at timestamptz",
)


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_exists_and_follows_the_one_before_it() -> None:
    assert MIGRATION.is_file()
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0020") == numbers.index("0019") + 1


def test_the_table_and_every_column_the_mind_needs(sql: str) -> None:
    assert f"create table if not exists {TABLE}" in sql
    for column in COLUMNS:
        assert column in sql, column


def test_row_level_security_is_on(sql: str) -> None:
    assert re.search(rf"alter table {re.escape(TABLE)}\s+enable row level security", sql)


def test_a_learner_reaches_their_own_mind_and_no_other(sql: str) -> None:
    """The RLS proof, the shape 0002 and 0005 write it in: pinned to ``auth.uid()`` on both
    sides, and nothing wider — no ``true``, no ``or``, no second predicate."""
    policies = list(
        re.finditer(
            rf"create policy (\w+) on {re.escape(TABLE)} for (\w+) to authenticated\s+([^;]+);", sql
        )
    )
    assert policies, (
        "the mind has no policy at all, which means nobody may read it and RLS is a lie"
    )
    for match in policies:
        clause = match.group(3)
        assert "using (subject_id = auth.uid())" in clause, match.group(1)
        assert " or " not in clause and "true" not in clause, match.group(1)


def test_a_client_may_read_and_erase_its_own_row_and_may_not_write_it(sql: str) -> None:
    """The policy used to be ``for all``, which let a learner's own token PATCH the row over
    PostgREST — past the merge rule, past the tombstones, past the flattening that stops a fact
    forging a line of the prompt, and past every count and length bound the gateway applies. The
    two verbs a client actually needs are select (read your own record) and delete (the
    client-side erase that runs when the gateway is unreachable). Writing is the gateway's."""
    written = re.finditer(rf"create policy \w+ on {re.escape(TABLE)} for (\w+) ", sql)
    verbs = {m.group(1) for m in written}
    assert verbs == {"select", "delete"}, verbs
    assert f"grant select, delete on {TABLE} to authenticated" in sql
    assert f"grant all on {TABLE} to service_role" in sql
    assert f"grant select, insert, update, delete on {TABLE} to authenticated" not in sql


def test_the_size_of_a_row_is_bounded_and_not_only_its_count(sql: str) -> None:
    """Every cap was on how MANY items a row held and none on how BIG one was, so a learner's own
    token could have written twelve one-megabyte strings into its own row. The lengths are the
    gateway's own, in the database, where they hold whoever is writing."""
    assert f"check (learner.jsonb_max_text_len(facts) <= {mind.MAX_TEXT})" in sql
    assert f"check (learner.jsonb_max_text_len(interests) <= {mind.MAX_TEXT})" in sql
    assert "jsonb_array_len(forgotten -> 'facts') <= " f"{mind.MAX_TOMBSTONES}" in sql
    assert "octet_length(days::text)" in sql


def test_a_parent_account_cannot_grow_a_mind_row(sql: str) -> None:
    """0019 put the cross-kind guard on ``learner.learner_state`` alone, so the most personal
    learner table in the product had none at all."""
    assert "wobo_mind_is_not_a_parents" in sql
    assert "execute function parent.assert_not_a_parent()" in sql


def test_updated_at_moves_on_every_write(sql: str) -> None:
    """The write is a compare-and-set on this column. A trigger that did not fire would turn
    every concurrent write into a silent overwrite, which is the failure the whole design is
    built to prevent."""
    assert "wobo_mind_set_updated_at before update on learner.wobo_mind" in sql
    assert "execute function learner.set_updated_at()" in sql


@pytest.mark.parametrize(
    ("constraint", "cap"),
    [
        (
            "wobo_mind_interests_are_few check (jsonb_array_length(interests) <= {}",
            mind.MAX_INTERESTS,
        ),
        ("wobo_mind_facts_are_few check (jsonb_array_length(facts) <= {}", mind.MAX_FACTS),
        (
            "wobo_mind_latencies_are_few check (jsonb_array_length(latencies_ms) <= {}",
            mind.MAX_LATENCIES,
        ),
        ("wobo_mind_slips_are_few check (jsonb_array_length(slips) <= {}", mind.MAX_SLIPS),
        (
            "wobo_mind_session_days_are_few check (jsonb_array_length(session_days) <= {}",
            mind.MAX_SESSION_DAYS,
        ),
        (
            "wobo_mind_dwell_is_few check (learner.jsonb_object_size(dwell_sec) <= {}",
            mind.MAX_DWELL_SURFACES,
        ),
        ("wobo_mind_days_are_a_year check (learner.jsonb_object_size(days) <= {}", mind.MAX_DAYS),
    ],
)
def test_every_bound_is_in_the_database_at_the_number_the_gateway_uses(
    sql: str, constraint: str, cap: int
) -> None:
    """A mind that grows forever is a prompt that costs a fortune and a table nobody can read.
    The cap lives in the database as well as in Python, so a bug on either side cannot let one
    row grow without limit — and they are the same number, held together here."""
    assert constraint.format(cap) in sql, constraint.format(cap)


def test_the_shapes_are_enforced_too(sql: str) -> None:
    for column in ("interests", "facts", "latencies_ms", "slips", "session_days"):
        assert f"check (jsonb_typeof({column}) = 'array')" in sql, column
    for column in ("dwell_sec", "days", "forgotten"):
        assert f"check (jsonb_typeof({column}) = 'object')" in sql, column


def test_the_gateway_and_the_client_keep_the_same_number_of_facts() -> None:
    """The web app's own cap (``store/mind.ts``) and the record's are one number. If they drift,
    a device quietly holds more than the account can, and the learner's second phone shows less
    than their first."""
    client = (REPO / "apps/web-pwa/src/store/mind.ts").read_text()
    assert f"const MAX_FACTS = {mind.MAX_FACTS};" in client
    assert f"const MAX_SLIPS = {mind.MAX_SLIPS};" in client
    assert f"const MAX_LATENCIES = {mind.MAX_LATENCIES};" in client
    assert f"const MAX_DAYS = {mind.MAX_SESSION_DAYS};" in client
    assert f"const MAX_LEDGER_DAYS = {mind.MAX_DAYS};" in client
    # The two the client keeps NO named constant for, so this is what can honestly be held
    # together: interests are capped where onboarding writes them, by keeping the FIRST eight,
    # and the record keeps the first eight for the same reason. Dwell has no client cap at all.
    assert f".slice(0, {mind.MAX_INTERESTS})" in client
    assert "MAX_DWELL" not in client


def test_the_erase_route_names_this_table() -> None:
    """Erasure reaches every store or the promise is a lie. The table this wave added is on the
    list the erase route works from, and it is on it by name."""
    from wobo_gateway import memory

    assert memory._MIND_TABLE == mind.TABLE
