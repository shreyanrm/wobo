"""Migrations 0024 and 0025, read as a contract.

No Postgres runs here, so this follows ``test_observer_schema``: a grep for exactly the failures
that would be invisible until the day they mattered, and on these two files that day is the day
438 public pages start earning visitors.

0024, the dial:

1. ``doors_open`` is seeded FALSE, and re-applying the migration cannot re-open a door somebody
   opened on purpose.
2. Every change to any dial is audited by a TRIGGER, not by a code path, because the owner turns
   this one in the SQL editor and that change must leave a trail like any other.
3. Both trails are append-only, enforced by grant and by trigger, truncate included.
4. No client role can read a dial. A client that could read this table could read every dial the
   product will ever have.
5. The refusal trail cannot hold a subject or an address.

0025, the list:

6. A new schema, closed from zero, with a default privilege so the next table starts closed too.
7. No name, no date of birth, no age, anywhere. That is how "no child's address is ever stored"
   is true rather than promised.
8. De-duplication is a UNIQUE index on the DIGEST and not on the address, so the index is not an
   enumeration oracle.
9. A row cannot be edited, and CAN be deleted with the service role, because the address is
   deletable on request like everything else we hold.
10. Nothing in the table could ever be shown to a visitor as a queue position.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
SETTINGS = MIGRATIONS / "0024_ops_settings.sql"
LIST = MIGRATIONS / "0025_waiting_list.sql"


def _columns(sql: str, table: str) -> str:
    """The column block of one ``create table``, with the commentary taken out.

    The comments in these files explain what a column must NOT be, in words, so scanning them
    for a forbidden word finds the sentence that forbids it. Only the SQL is scanned.
    """
    body = sql[sql.index(f"create table if not exists {table}") :]
    block = body[: body.index("\n);")]
    return "\n".join(
        line for line in block.splitlines() if not line.lstrip().startswith("--")
    )


@pytest.fixture(scope="module")
def dial() -> str:
    return SETTINGS.read_text()


@pytest.fixture(scope="module")
def joined() -> str:
    return LIST.read_text()


def test_both_migrations_exist_and_their_numbers_are_their_own() -> None:
    assert SETTINGS.is_file() and LIST.is_file()
    numbers = [p.name[:4] for p in MIGRATIONS.glob("*.sql")]
    assert numbers.count("0024") == 1, "another migration has taken 0024"
    assert numbers.count("0025") == 1, "another migration has taken 0025"


def test_the_dial_applies_after_the_schema_that_sets_the_posture() -> None:
    """0015 revokes everything in ``ops`` from every client role by default privilege. A table
    added here inherits that, which is the whole reason it lives in ``ops``."""
    assert (MIGRATIONS / "0015_admin_register_and_audit.sql").is_file()


# --- 0024, the dial ------------------------------------------------------------------------------


def test_the_door_is_seeded_closed(dial: str) -> None:
    seed = re.search(r"insert into ops\.settings \(key.*?;", dial, re.S)
    assert seed, "the migration must seed the dial; a missing row is a dial nobody can find"
    assert "'doors_open'" in seed.group(0)
    assert "'false'::jsonb" in seed.group(0)


def test_re_applying_it_never_reopens_a_door(dial: str) -> None:
    """Idempotent means idempotent. ``do update`` here would shut a door the owner had opened,
    or open one they had shut, every time somebody re-ran the file."""
    seed = re.search(r"insert into ops\.settings \(key.*?;", dial, re.S)
    assert seed and "on conflict (key) do nothing" in seed.group(0)
    assert "on conflict (key) do update" not in dial


def test_a_change_is_audited_by_a_trigger_and_not_by_a_code_path(dial: str) -> None:
    assert "create trigger settings_audit_on_write" in dial
    assert "after insert or update on ops.settings" in dial
    assert "insert into ops.settings_audit" in dial
    # Both sides of the change, or the trail cannot be read without replaying it.
    assert "old_value" in dial and "new_value" in dial


def test_both_trails_are_append_only_including_truncate(dial: str) -> None:
    for table in ("settings_audit", "door_audit"):
        for op in ("update", "delete", "truncate"):
            assert f"create trigger {table}_no_{op}" in dial, f"{table}: {op}"
        assert re.search(
            rf"revoke update, delete, truncate on ops\.{table} from service_role", dial
        ), f"{table}: the gateway is not trusted to rewrite what the gateway wrote"


def test_no_client_role_can_read_a_dial(dial: str) -> None:
    assert "revoke all on ops.settings from public, anon, authenticated" in dial
    assert "alter table ops.settings enable row level security" in dial
    assert "alter table ops.settings force row level security" in dial
    # No policy at all for a client. Not even a read.
    assert not re.search(r"create policy .* on ops\.settings\b", dial)


def test_the_refusal_trail_cannot_hold_a_person(dial: str) -> None:
    """A refusal is a count and a shape, not a dossier on somebody who tried a door."""
    columns = _columns(dial, "ops.door_audit")
    for forbidden in ("subject", "email", "learner", "token", "user_id", "body"):
        assert forbidden not in columns, f"ops.door_audit must not carry {forbidden}"
    assert "ip_hash text" in columns
    assert re.search(r"ip_hash ~ '\^\[0-9a-f\]", columns), "the address is a digest or nothing"


def test_a_dial_is_turned_never_removed(dial: str) -> None:
    """A deleted row reads as the least-privilege default, so deleting one is a silent switch."""
    assert "grant select, insert, update on ops.settings to service_role" in dial
    assert "revoke delete, truncate on ops.settings from service_role" in dial


# --- 0025, the list ------------------------------------------------------------------------------


def test_the_list_has_its_own_schema_closed_from_zero(joined: str) -> None:
    assert "create schema if not exists growth" in joined
    for role in ("public", "anon", "authenticated"):
        assert f"revoke all on schema growth from {role}" in joined
    assert (
        "alter default privileges in schema growth revoke all on tables from "
        "public, anon, authenticated" in joined
    )


def test_no_child_can_be_described_in_this_table(joined: str) -> None:
    """Ruling 1. There is nowhere for a name, a date of birth or an age to land, so a future
    caller that tried to send one has nothing to write it to."""
    columns = _columns(joined, "growth.waiting_list")
    assert not re.search(r"^\s*(full_|first_|display_)?name\s", columns, re.M), "no name column"
    for forbidden in ("date_of_birth", "birthdate", "birth_date", "age", "dob", "year_of_birth"):
        assert forbidden not in columns, f"growth.waiting_list must not carry {forbidden}"
    # class_name is the class a person typed, not an age band, and it is bounded to sixteen
    # characters so it cannot become a sentence about a child.
    assert "class_name is null or char_length(class_name) <= 16" in columns


def test_de_duplication_is_on_the_digest_and_not_on_the_address(joined: str) -> None:
    assert "unique (email_hash)" in joined
    assert "unique (email)" not in joined
    assert re.search(r"email_hash ~ '\^\[0-9a-f\]\{64\}\$'", joined)


def test_a_row_cannot_be_edited_but_can_be_deleted(joined: str) -> None:
    """Ruling 3. A list somebody can quietly retarget is not a list of people who asked; a table
    that cannot honour an erasure request is a compliance failure wearing a security posture."""
    assert "create trigger waiting_list_no_update" in joined
    assert "create trigger waiting_list_no_truncate" in joined
    assert "grant select, insert, delete on growth.waiting_list to service_role" in joined
    assert "revoke update, truncate on growth.waiting_list from service_role" in joined


def test_nobody_holding_a_token_can_read_the_list(joined: str) -> None:
    assert "revoke all on growth.waiting_list from public, anon, authenticated" in joined
    assert "alter table growth.waiting_list enable row level security" in joined
    assert "alter table growth.waiting_list force row level security" in joined
    assert not re.search(r"create policy .* on growth\.waiting_list\b", joined)


def test_there_is_nothing_a_visitor_could_be_shown_as_a_position(joined: str) -> None:
    """DOORS-CLOSED §3: no waiting number, no queue position, no invented scarcity. The way to
    keep a promise like that is to have nothing to break it with."""
    columns = _columns(joined, "growth.waiting_list")
    for forbidden in ("position", "rank", "serial", "generated always as identity", "sequence"):
        assert forbidden not in columns, f"growth.waiting_list must not carry {forbidden}"


def test_the_source_is_a_path_and_never_an_address(joined: str) -> None:
    assert re.search(r"source_path ~ '\^/", joined)
