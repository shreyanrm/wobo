"""Migration 0023 — the provider's ids on the subscription, and the billing ledger.

No Postgres runs here (see ``test_subscriptions_schema.py`` for what that means and what it
leaves uncovered). A grep for the lines a reviewer argued for:

1. The subscription row can name its Razorpay subscription and plan, its period, and what the
   provider last said about it — without which no webhook can find the row it is about.
2. The ledger dedupes by event id IN THE DATABASE, so a replay is refused by a constraint and
   not only by code.
3. Neither new table is reachable with a client key, and the ledger is append-only.
"""

from __future__ import annotations

from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0023_razorpay_billing.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_the_migration_exists_and_its_number_is_its_own() -> None:
    """0023 was the next free number when this landed and it is still 0023's alone.

    It used to assert that 0023 was the HIGHEST number in the directory, which said "nobody may
    ever add a migration after this one" rather than what it meant. 0024 and 0025 (the door and
    the list it opens onto) are after it and neither touches billing. The sequence itself is held
    by test_migration_sequence.py, which is the file whose job that is.
    """
    assert MIGRATION.is_file()
    numbers = sorted(int(p.name[:4]) for p in MIGRATIONS.glob("*.sql"))
    assert numbers.count(23) == 1
    assert max(numbers) >= 23


def test_the_subscription_row_can_name_its_provider_ids(sql: str) -> None:
    for column in (
        "add column if not exists period text not null default 'monthly'",
        "add column if not exists razorpay_subscription_id text",
        "add column if not exists razorpay_plan_id text",
        "add column if not exists provider_status text",
    ):
        assert column in sql, column
    assert "check (period in ('monthly', 'yearly'))" in sql
    assert "unique" in sql and "razorpay_subscription_id" in sql


def test_the_ledger_dedupes_by_event_id_in_the_database(sql: str) -> None:
    assert "create table if not exists ops.billing_events" in sql
    assert "event_id text not null unique" in sql
    assert "check (kind in ('checkout', 'webhook', 'cancel'))" in sql


def test_the_config_holds_the_plan_ids(sql: str) -> None:
    assert "create table if not exists ops.billing_config" in sql
    assert "key text primary key" in sql
    assert "value jsonb not null" in sql


def test_no_client_key_reaches_either_table_and_the_ledger_is_append_only(sql: str) -> None:
    for table in ("ops.billing_events", "ops.billing_config"):
        assert f"alter table {table} enable row level security" in sql
        assert f"revoke all on {table} from authenticated" in sql
        assert f"grant all on {table} to service_role" in sql
    assert "billing_events_no_update" in sql and "billing_events_no_delete" in sql


def test_it_is_idempotent_on_its_face(sql: str) -> None:
    for verb in ("create table", "add column", "create unique index", "create trigger"):
        for line in sql.splitlines():
            stripped = line.strip().lower()
            if stripped.startswith(verb) and verb != "create trigger":
                assert "if not exists" in stripped, line
    assert "drop trigger if exists" in sql
