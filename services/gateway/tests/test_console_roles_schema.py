"""Migration 0029 — one owner in the database, and the capabilities the owner shapes.

WHAT THESE TESTS ARE. No Postgres runs here: every assertion is a string match over the
characters of a .sql file that has never been executed, exactly as ``test_admin_schema.py`` says
of 0015. They are a diff alarm — they fail when somebody deletes a line that was argued for.

WHAT THAT LEAVES UNCOVERED, and it has to be driven against a real Supabase branch before this is
relied on:

  1. insert a second ``role='owner', status='active'`` row → must fail on the unique index;
  2. ``update ops.admins set status='suspended' where role='owner'`` as the service role → must
     fail on the trigger, and must SUCCEED inside a transaction that has set the break-glass;
  3. ``delete from ops.admins where role='owner'`` as the service role → must fail;
  4. a learner's token doing ``select * from ops.admin_capabilities`` → refused by the missing
     grant, the same way ``ops.admins`` is.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0029_console_owner_and_capabilities.sql"
OPERATIONS = ROOT / "docs/OPERATIONS.md"

#: The session setting the break-glass reads. Named once here so the migration and the operations
#: note cannot drift apart: a documented recovery that names a different switch is not a recovery.
BREAK_GLASS = "ops.break_glass"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


@pytest.fixture(scope="module")
def body(sql: str) -> str:
    """The file with its comment lines removed, so a negative check meets statements only."""
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def test_the_migration_exists_with_its_own_number() -> None:
    assert MIGRATION.is_file()
    numbers = [p.name[:4] for p in MIGRATIONS.glob("*.sql")]
    assert numbers.count("0029") == 1, "two migrations are claiming 0029"


def test_one_active_owner_is_a_constraint_and_not_a_convention(body: str) -> None:
    """"A constraint in the database, not a convention: at most one row with the owner role and
    the status active, and the register refuses a second." """
    assert "create unique index" in body
    assert "admins_one_active_owner" in body
    lowered = body.lower()
    index = lowered.index("admins_one_active_owner")
    clause = lowered[index : index + 400]
    assert "where" in clause and "role = 'owner'" in clause and "status = 'active'" in clause


def test_the_owner_cannot_be_demoted_suspended_or_deleted_by_anybody_else(body: str) -> None:
    """A trigger, because a grant cannot tell one UPDATE from another, and the console holds the
    service key. The gateway refuses first; this is what is left when the gateway is the problem."""
    assert "ops.the_owner_is_not_yours_to_take" in body
    assert "before update" in body.lower()
    assert "before delete" in body.lower()
    assert "insufficient_privilege" in body


def test_the_break_glass_is_a_session_setting_the_console_can_never_send(sql: str) -> None:
    """PostgREST cannot issue ``set local``, so no route, and no bug in one, can open this.

    That is the whole design: recovery needs a direct connection and the service key, which is
    the owner and nobody's cooperation but the owner's.
    """
    assert BREAK_GLASS in sql
    assert "current_setting" in sql
    assert "set local" in sql.lower()


def test_the_capabilities_are_a_table_beside_the_register(body: str) -> None:
    assert "create table if not exists ops.admin_capabilities" in body
    assert "references ops.admins(id) on delete cascade" in body
    assert "check (effect in ('grant', 'revoke'))" in body
    assert "unique (admin_id, capability)" in body
    assert "granted_by" in body


def test_the_capabilities_are_closed_to_everybody_but_the_server(body: str) -> None:
    """Same posture as ``ops.admins``: the learner role holds nothing, at any tier."""
    assert "alter table ops.admin_capabilities enable row level security" in body
    assert "alter table ops.admin_capabilities force row level security" in body
    assert "revoke all on ops.admin_capabilities from public, anon, authenticated" in body
    assert "grant select, insert, update, delete on ops.admin_capabilities to service_role" in body
    assert "to authenticated" not in body.split("admin_capabilities")[-1].split("grant usage")[0]


def test_an_invited_seat_can_exist_before_it_has_an_account(body: str) -> None:
    """Adding a person starts with an address, not with a Supabase user id: the id arrives when
    they accept, which is also where the second factor is proved."""
    assert "alter column subject_id drop not null" in body
    assert "'invited'" in body
    assert "admins_one_live_row_per_address" in body


def test_the_break_glass_is_written_down_where_an_operator_looks() -> None:
    """A recovery nobody can find is not a recovery. It lives in operations, with the SQL."""
    text = OPERATIONS.read_text()
    assert "break-glass" in text.lower()
    assert BREAK_GLASS in text
    assert "0029" in text
