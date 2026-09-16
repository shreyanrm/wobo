"""Migration 0035 — the weekly cadence's two stored facts, read as a contract.

No Postgres runs here. The file is written and never applied by the suite; these checks keep it
honest against the code that reads what it stores: the good-news note's dial on the family's row
(``hospitality/preferences.py``) and the ladder dial in ``ops.settings`` (``dials.py``, read by
``activity.ladder``).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from wobo_gateway import activity, dials
from wobo_gateway.hospitality import preferences as prefs_mod

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0035_mail_cadence.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_it_is_the_next_number_after_the_activity_record() -> None:
    assert MIGRATION.is_file()
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0035") == numbers.index("0034") + 1


def test_every_dial_the_code_reads_has_a_column(sql: str) -> None:
    """A dial in ``MAIL_KINDS`` with no column would read as its default for ever, and a family's
    one-click stop on it would be written into nothing."""
    assert "learning_note" in prefs_mod.MAIL_KINDS
    assert re.search(
        r"alter table learner\.mail_preferences\s+add column if not exists learning_note "
        r"boolean not null default true",
        sql,
    )


def test_the_ladder_is_seeded_with_the_owners_default_and_never_overwrites_a_turned_dial(
    sql: str,
) -> None:
    match = re.search(
        r"insert into ops\.settings \(key, value, description, note\)\s+values \(\s*"
        r"'(?P<key>[^']+)',\s*'(?P<value>[^']+)'::jsonb,",
        sql,
    )
    assert match, "the ladder is not seeded"
    assert match["key"] == dials.MAIL_LADDER_KEY
    seeded = json.loads(match["value"])
    assert dials.valid_mail_ladder(seeded) == activity.LADDER_BOUNDS
    statement = sql[match.start() :].split(";", 1)[0]
    assert statement.rstrip().endswith("on conflict (key) do nothing")


def test_it_is_additive_and_says_what_the_record_is_for(sql: str) -> None:
    code = "\n".join(line for line in sql.lower().splitlines() if not line.strip().startswith("--"))
    for never in ("drop table", "drop column", "delete from", "truncate", "update "):
        assert never not in code, never
    header = sql.lower()
    assert "s.9(3)" in header
    assert "pixel" in header
