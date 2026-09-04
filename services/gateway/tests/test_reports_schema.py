"""Migration 0017 — ``ops.reports``, read as a contract.

No Postgres runs here (this repo's migrations are applied through the project, never locally), so
this follows ``test_parent_links_schema.py`` and ``test_admin_auth``'s schema half: a grep for
exactly the failures that would be invisible until the day somebody is working the queue and
something has gone wrong.

The five that matter, each one line away from being silently untrue:

1. The table is not reachable with a client key. The admin register grants ``usage`` on ``ops`` to
   ``authenticated`` so an admin can read the trail through a policy; if this table's privileges
   are not revoked by name, that grant reaches every flag a child has ever raised.
2. A refund reason can only be one of the five the law gives, so a queue can never imply the
   goodwill policy ``docs/legal/refund-and-cancellation.md`` §5 says we do not have.
3. A report past ``new`` names who moved it. There is no anonymous triage.
4. Only a safety flag can be urgent, so nothing can be made to outrank a child saying they were
   upset.
5. There is no DELETE. A queue an operator can empty is a queue that can hide a flag.
"""

from __future__ import annotations

from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0017_ops_reports.sql"
TABLE = "ops.reports"

COLUMNS = (
    "id uuid primary key default gen_random_uuid()",
    "kind text not null",
    "state text not null default 'new'",
    "reason text not null",
    "note text",
    "learner_id uuid",
    "contact_email text",
    "about jsonb not null default '{}'::jsonb",
    "source text not null default 'app'",
    "urgent boolean not null default false",
    "acted_by uuid",
    "acted_by_email text",
    "acted_at timestamptz",
    "resolution text",
)


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_exists_and_its_number_is_its_own() -> None:
    assert MIGRATION.is_file()
    numbers = [p.name[:4] for p in MIGRATIONS.glob("*.sql")]
    assert numbers.count("0017") == 1, "another migration has taken 0017"


def test_it_applies_after_the_admin_register_that_owns_the_schema() -> None:
    """The desks hang off that door and ``acted_by`` names a row in its register, so this file
    must never be applied first."""
    register = next(MIGRATIONS.glob("*_admin_register_and_audit.sql"), None)
    assert register is not None, "the admin register migration is gone"
    assert register.name[:4] < "0017"


def test_the_table_and_every_column_the_desks_read(sql: str) -> None:
    assert f"create table if not exists {TABLE}" in sql
    for column in COLUMNS:
        assert column in sql, column


def test_no_client_key_reaches_the_queue(sql: str) -> None:
    """The register grants `usage` on `ops` to `authenticated`. This table takes it back by name."""
    assert f"alter table {TABLE} enable row level security" in sql
    assert f"revoke all on {TABLE} from public, anon, authenticated" in sql
    assert f"grant select, insert, update on {TABLE} to service_role" in sql
    # RLS with no policy is deny-all. A policy here would have to be argued for, so its absence
    # is asserted rather than assumed.
    assert "create policy" not in sql


def test_nothing_can_delete_a_report(sql: str) -> None:
    """Closing is a state, not a removal: a queue an operator can empty can hide a flag."""
    assert "delete" not in sql.split("grant select, insert, update")[1].split(";")[0]
    assert "grant all on ops.reports" not in sql


def test_a_refund_reason_can_only_be_one_the_law_gives(sql: str) -> None:
    constraint = sql[sql.index("reports_reason_belongs_to_kind") :].split("),\n\n")[0]
    for owed in (
        "charged_after_cancelling",
        "charged_twice",
        "not_authorised",
        "not_supplied",
        "cooling_off",
    ):
        assert owed in constraint, owed
    # The goodwill refund this product does not do, in every spelling somebody might reach for.
    # Checked against the CONSTRAINT, not the file: the header discusses goodwill at length and
    # must be free to.
    for never in ("changed_my_mind", "goodwill", "not_using_it", "too_expensive", "unhappy"):
        assert never not in constraint, never


def test_the_flag_reasons_cover_a_child_who_is_upset(sql: str) -> None:
    constraint = sql[sql.index("reports_reason_belongs_to_kind") :].split("),\n\n")[0]
    for reason in ("wrong", "confusing", "upsetting", "unsafe", "not_my_syllabus", "other"):
        assert f"'{reason}'" in constraint, reason


def test_a_report_that_moved_names_who_moved_it(sql: str) -> None:
    assert "reports_moved_names_who" in sql
    assert "check (state = 'new' or (acted_by is not null and acted_at is not null))" in sql
    assert "reports_new_names_nobody" in sql


def test_only_a_safety_flag_can_be_urgent(sql: str) -> None:
    assert "check (not urgent or (kind = 'flag' and reason in ('upsetting', 'unsafe')))" in sql


def test_a_settled_refund_says_in_words_what_happened(sql: str) -> None:
    assert "reports_settled_refund_says_what_happened" in sql
    assert "char_length(resolution) >= 3" in sql


def test_the_queue_is_indexed_the_way_a_desk_reads_it(sql: str) -> None:
    assert "on ops.reports (kind, state, created_at desc)" in sql
    assert "where urgent and state in ('new', 'looked_at')" in sql
    assert "on ops.reports (learner_id, created_at desc)" in sql


def test_the_reason_lists_agree_with_the_gateway(sql: str) -> None:
    """Two copies on purpose — the route refuses with a sentence, the constraint refuses whatever
    the route does — so they are checked against each other rather than left to drift."""
    from wobo_gateway.reports import REASONS

    constraint = sql[sql.index("reports_reason_belongs_to_kind") :].split("),\n\n")[0]
    for kind, reasons in REASONS.items():
        assert f"kind = '{kind}'" in constraint, kind
        for reason in reasons:
            assert f"'{reason}'" in constraint, f"{kind}/{reason}"
