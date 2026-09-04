"""Migration 0015 — the admin register, the console session and the audit, read as a contract.

WHAT THESE TESTS ARE, SAID PLAINLY. **No Postgres runs here.** Every assertion below is a string
match over the CHARACTERS of a .sql file that has never been executed. They cannot prove that RLS
scopes a row, that a revoked grant refuses a write, or that the append-only trigger fires — only
that the file still SAYS the things a reviewer decided it must say. They are a diff alarm, not a
database test: they fail when somebody deletes a line that was argued for, which is the failure
mode a text file actually has. They follow ``test_subscriptions_schema.py`` in shape for that
reason.

WHAT THAT LEAVES UNCOVERED, and it matters more here than anywhere else in this repo, because the
thing under test is the door to every child's record. These four have to be driven against a real
Supabase branch before the console is opened to anybody:

  1. ``update ops.admin_audit set ...`` as the service role → must fail. Both the revoked grant
     and the trigger claim to stop it; only the database can say they do.
  2. ``delete from ops.admin_audit`` and ``truncate ops.admin_audit`` as the service role → must
     fail, for the same reason and by the same two locks.
  3. A learner's token doing ``select * from ops.admins`` → must return nothing and, better, be
     refused outright by the missing grant.
  4. An ADMIN's token doing ``select * from ops.admin_audit`` → must return rows (the policy), and
     the same token doing an ``insert`` into it → must fail.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0015_admin_register_and_audit.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


@pytest.fixture(scope="module")
def body(sql: str) -> str:
    """The migration with its comment lines removed.

    The file argues for its own decisions at length, so a bare "this word is not in the file"
    assertion would be answered by the paragraph explaining why the thing is not done. The
    negative checks below run against the STATEMENTS.
    """
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def test_the_migration_has_its_own_number_and_runs_before_the_ops_tables() -> None:
    """Ordering is a dependency here, not a formality.

    ``0017_ops_reports.sql`` adds a table to the ``ops`` schema and says so in its own comments:
    it relies on THIS file having set the schema's grant posture and the default privileges that
    close every table added to it later. So this migration must carry a lower number, and it must
    not share its number with anything — two files claiming one number is a project where half a
    schema silently never applied.
    """
    assert MIGRATION.is_file()
    ours = MIGRATION.name[:4]
    assert ours == "0015"
    numbers = [p.name[:4] for p in MIGRATIONS.glob("*.sql")]
    assert numbers.count(ours) == 1, "two migrations are claiming the same number"
    for later in MIGRATIONS.glob("*_ops_*.sql"):
        if later.name != MIGRATION.name:
            assert later.name[:4] > ours, f"{later.name} adds to ops before the schema is closed"


def test_admin_ness_lives_in_its_own_schema_and_not_beside_the_learners(
    sql: str, body: str
) -> None:
    """`learner` is shaped around `learner_id = auth.uid()`; an admin register there inherits
    that posture the first time somebody writes a convenience policy."""
    assert "create schema if not exists ops" in sql
    assert "create table if not exists ops.admins" in sql
    assert "create table if not exists ops.admin_sessions" in sql
    assert "create table if not exists ops.admin_audit" in sql
    assert "learner.admins" not in body
    # And nothing in this file touches the table a learner can write through.
    assert "profiles_cache" not in body


def test_the_schema_starts_closed(sql: str) -> None:
    for role in ("public", "anon", "authenticated"):
        assert f"revoke all on schema ops from {role};" in sql
    # A table added to this schema tomorrow is closed too, without anybody remembering.
    default_privileges = (
        "alter default privileges in schema ops revoke all on tables "
        "from public, anon, authenticated"
    )
    assert default_privileges in sql


def test_the_register_carries_levels_and_a_revocation(sql: str) -> None:
    assert "role text not null default 'viewer'" in sql
    assert "check (role in ('viewer', 'operator', 'owner'))" in sql
    assert "check (status in ('active', 'suspended'))" in sql
    assert "mfa_required boolean not null default true" in sql
    assert "subject_id uuid not null unique" in sql
    assert "granted_by uuid" in sql


def test_a_session_stores_only_a_digest_and_expires(sql: str) -> None:
    assert "token_hash text not null unique" in sql
    assert "check (expires_at > issued_at)" in sql
    assert "token_hash ~ '^[0-9a-f]{64}$'" in sql
    assert "reauth_at timestamptz" in sql
    assert "revoked_at timestamptz" in sql
    # The address is a keyed digest, never an address.
    assert "ip_hash ~ '^[0-9a-f]{16,64}$'" in sql


def test_the_audit_records_who_what_when_and_from_where(sql: str) -> None:
    for column in (
        "actor_subject uuid not null",
        "actor_admin_id uuid",
        "actor_role text",
        "action text not null",
        "resource_type text",
        "resource_id text",
        "ip_hash text",
        "session_id uuid",
    ):
        assert column in sql, column
    assert "at timestamptz not null default now()" in sql
    assert "check (decision in ('allowed', 'denied'))" in sql


def test_the_audit_has_no_foreign_key_that_could_erase_a_trail(body: str) -> None:
    """Deleting a person must never delete the record of what that person did."""
    audit_block = body[body.index("create table if not exists ops.admin_audit") :]
    audit_block = audit_block[: audit_block.index(");")]
    assert "references" not in audit_block
    assert "cascade" not in audit_block


def test_the_audit_is_append_only_by_grant_and_by_trigger(sql: str) -> None:
    """Two locks, because the attacker here is the person holding the console's own credentials."""
    assert "revoke update, delete, truncate on ops.admin_audit from service_role;" in sql
    assert "revoke insert, update, delete, truncate on ops.admin_audit from authenticated;" in sql
    assert "create or replace function ops.admin_audit_is_append_only()" in sql
    for trigger, event in (
        ("admin_audit_no_update", "before update"),
        ("admin_audit_no_delete", "before delete"),
        # Truncate sidesteps row triggers entirely, so it needs its own statement-level one.
        ("admin_audit_no_truncate", "before truncate"),
    ):
        assert f"create trigger {trigger}" in sql, trigger
        assert event in sql, event
    assert "raise exception 'ops.admin_audit is append-only" in sql


def test_row_level_security_is_on_and_forced_everywhere(sql: str) -> None:
    for table in ("ops.admins", "ops.admin_sessions", "ops.admin_audit"):
        assert f"alter table {table} enable row level security;" in sql, table
        # FORCE, so the table owner is bound by the policy too.
        assert f"alter table {table} force row level security;" in sql, table


def test_an_admin_may_read_the_trail_and_nobody_may_write_it_from_a_client(sql: str) -> None:
    assert "create policy admin_audit_read" in sql
    assert "for select" in sql
    assert "using (ops.is_admin())" in sql
    assert "grant select on ops.admin_audit to authenticated;" in sql
    # The only policy in the whole file is that one read: no client-side write anywhere.
    policies = re.findall(r"create policy (\w+)\s+on (\S+)\s+for (\w+)", sql)
    assert policies == [("admin_audit_read", "ops.admin_audit", "select")]


def test_the_register_itself_is_never_readable_with_a_learner_token(sql: str) -> None:
    """No policy on ops.admins at any tier: a client that can read it can enumerate the team."""
    assert "grant select, insert, update, delete on ops.admins to service_role;" in sql
    assert "grant select on ops.admins to authenticated" not in sql
    assert "grant select on ops.admin_sessions to authenticated" not in sql


def test_the_admin_check_cannot_be_talked_into_running_somewhere_else(sql: str) -> None:
    """A SECURITY DEFINER function that resolves unqualified names through the caller's
    search_path is the classic way to hand out its own privileges."""
    assert "create or replace function ops.is_admin()" in sql
    assert "security definer" in sql
    assert "set search_path = ''" in sql
    assert "revoke all on function ops.is_admin() from public;" in sql


def test_nothing_is_seeded_and_no_environment_variable_grants_access(body: str) -> None:
    """Applying this migration must grant nobody anything."""
    lowered = body.lower()
    # The one INSERT in the file is the bootstrap template, and it is commented out.
    inserts = [line for line in lowered.splitlines() if line.strip().startswith("insert into")]
    assert inserts == [], inserts
    assert "admin_emails" not in lowered
    assert "getenv" not in lowered
