"""Migration 0036 — the deliverability watch's one table and its one dial, read as a contract.

No Postgres runs here. The file is written and never applied by the suite; these checks keep it
honest against the code that reads and writes it (``mailwatch/store.py``, ``email.py``).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from wobo_gateway import email as email_mod
from wobo_gateway.mailwatch import store

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0036_mail_watch.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def _code(sql: str) -> str:
    return "\n".join(line for line in sql.lower().splitlines() if not line.strip().startswith("--"))


def test_it_is_the_next_number_after_the_cadence() -> None:
    assert MIGRATION.is_file()
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0036") == numbers.index("0035") + 1


def test_the_table_carries_every_column_the_store_writes(sql: str) -> None:
    table = re.search(r"create table if not exists ops\.mail_watch \((?P<body>.*?)\n\);", sql, re.S)
    assert table, "no ops.mail_watch"
    body = table["body"]
    for column in store.COLUMNS:
        assert re.search(rf"^\s*{column}\s", body, re.M), column
    # One key, unique, is what makes a retried webhook and a second cron pass harmless.
    assert re.search(r"key text not null unique", body)


def test_what_a_row_can_be_is_the_stores_own_list(sql: str) -> None:
    check = re.search(r"check \(what in \((?P<list>[^)]*)\)\)", sql)
    assert check
    listed = set(re.findall(r"'([a-z_]+)'", check["list"]))
    assert listed == set(store.WHATS)


def test_never_an_address(sql: str) -> None:
    code = _code(sql)
    assert "email text" not in code and "address text" not in code
    assert re.search(r"to_hash ~ '\^\[0-9a-f\]\{8,64\}\$'", sql)


def test_it_is_append_only_by_trigger_and_by_grant(sql: str) -> None:
    code = _code(sql)
    assert "before update on ops.mail_watch" in code
    assert "before delete on ops.mail_watch" in code
    assert "before truncate on ops.mail_watch" in code
    assert "enable row level security" in code
    assert "grant select, insert on ops.mail_watch to service_role" in code
    assert "revoke all on ops.mail_watch from authenticated" in code
    assert "revoke all on ops.mail_watch from anon" in code


def test_the_pause_dial_is_seeded_empty_and_never_overwrites_a_pause(sql: str) -> None:
    match = re.search(
        r"insert into ops\.settings \(key, value, description\)\s+values \(\s*"
        r"'(?P<key>[^']+)',\s*'(?P<value>[^']+)'::jsonb,",
        sql,
    )
    assert match
    assert match["key"] == email_mod.KINDS_PAUSED_DIAL
    assert match["value"] == "{}"
    statement = sql[match.start() :].split(";", 1)[0]
    assert statement.rstrip().endswith("on conflict (key) do nothing")


def test_it_is_additive_and_names_what_it_never_keeps(sql: str) -> None:
    code = _code(sql)
    for never in ("drop table", "drop column", "delete from", "update ops"):
        assert never not in code, never
    # The word appears in the guard that refuses it; a statement that truncates must not.
    assert not re.search(r"^\s*truncate\b", code, re.M)
    header = sql.lower()
    assert "pixel" in header
    assert "never an address" in header
    assert "notify pgrst" in code
