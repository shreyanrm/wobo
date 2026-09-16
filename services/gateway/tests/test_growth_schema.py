"""Migration 0038, read as a contract against the code that writes it (growth/store.py)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from wobo_gateway.growth import campaigns, channels, gather, shapes
from wobo_gateway.growth import store as store_mod

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0038_growth_desk.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def _code(sql: str) -> str:
    return "\n".join(line for line in sql.lower().splitlines() if not line.strip().startswith("--"))


def _table(sql: str, name: str) -> str:
    found = re.search(rf"create table if not exists growth\.{name} \((?P<body>.*?)\n\);", sql, re.S)
    assert found, name
    return found["body"]


def test_it_follows_the_last_number() -> None:
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0038") == numbers.index("0037") + 1


@pytest.mark.parametrize(
    ("table", "columns"),
    [
        ("pieces", store_mod.PIECE_COLUMNS),
        ("campaigns", store_mod.CAMPAIGN_COLUMNS),
        ("signals", store_mod.SIGNAL_COLUMNS),
    ],
)
def test_every_column_the_store_writes_exists(
    sql: str, table: str, columns: tuple[str, ...]
) -> None:
    body = _table(sql, table)
    for column in columns:
        assert re.search(rf"^\s*{column}\s", body, re.M), f"{table}.{column}"


def test_the_lists_are_the_codes_own(sql: str) -> None:
    body = _table(sql, "campaigns")

    def listed(constraint: str) -> set[str]:
        found = re.search(rf"constraint {constraint} check \(\w+ in \((?P<l>.*?)\)\)", body, re.S)
        assert found, constraint
        return set(re.findall(r"'([a-z_-]+)'", found["l"]))

    assert listed("campaigns_status_is_known") == set(store_mod.STATUSES)
    assert listed("campaigns_shape_is_known") == set(shapes.KINDS)
    assert listed("campaigns_channel_is_known") == {
        c.key for c in channels.CHANNELS if c.tier is not channels.Tier.NEVER
    }
    signals = _table(sql, "signals")
    found = re.search(r"source in \((?P<l>[^)]*)\)", signals)
    assert found and set(re.findall(r"'([a-z-]+)'", found["l"])) == set(store_mod.SIGNAL_SOURCES)
    assert set(store_mod.SIGNAL_SOURCES) == {
        gather.SEARCH_CONSOLE,
        gather.OUR_LEARNERS,
        gather.PERSON,
    }


def test_no_row_may_ever_name_reddit_or_quora(sql: str) -> None:
    assert "check (channel not in ('reddit', 'quora'))" in sql


def test_the_database_grammar_is_the_codes_grammar(sql: str) -> None:
    patterns = re.findall(r"~ '(\^\[a-z\]\[a-z-\][^']*)'", sql)
    assert len(patterns) == 2
    database = re.compile(patterns[0].replace("[0-9]", r"\d"))
    for good in ("x-202609-probability-01", "business-profile-202612-motion-and-time-99"):
        assert campaigns.is_well_formed(good) and database.match(good)
    for bad in ("x-202609-probability-1", "-202609-a-01", "x-2026-a-01"):
        assert not campaigns.PATTERN.match(bad) and not database.match(bad)


def test_publish_then_syndicate_is_enforced_by_the_database_too(sql: str) -> None:
    code = _code(sql)
    assert "indexed_at is null or (published_at is not null and indexed_at >= published_at)" in code
    assert "before insert or update on growth.campaigns" in code
    assert "new.channel <> 'blog'" in code
    assert "publish then syndicate" in code


def test_a_campaign_is_durable(sql: str) -> None:
    code = _code(sql)
    assert "before delete on growth.campaigns" in code
    assert "before truncate on growth.campaigns" in code
    assert "a campaign id, its piece, its shape and its channel never change" in code


def test_the_account_column_is_written_once_and_never_by_a_learner(sql: str) -> None:
    code = _code(sql)
    assert "add column if not exists campaign_id text" in code
    assert "before update of campaign_id on learner.profiles_cache" in code
    assert (
        "revoke insert (campaign_id), update (campaign_id) on learner.profiles_cache "
        "from authenticated" in code
    )
    grants = (MIGRATIONS / "0014_subscriptions.sql").read_text()
    for grant in re.findall(
        r"grant (?:insert|update) \(([^)]*)\)\s+on learner\.profiles_cache", grants
    ):
        assert "campaign_id" not in grant


def test_nothing_is_readable_from_a_browser_and_no_person_is_kept(sql: str) -> None:
    code = _code(sql)
    assert "from public, anon, authenticated" in code
    assert "grant select on growth.signups to service_role" in code
    for table in ("pieces", "campaigns", "signals"):
        assert f"alter table growth.{table} enable row level security" in code
    for column in ("email", "subject_id text", "ip ", "device", "user_agent"):
        for table in ("pieces", "campaigns", "signals"):
            assert column not in _table(sql, table).lower(), (table, column)
    view = re.search(r"create or replace view growth\.signups.*?;", sql, re.S)
    assert view and "subject_id" not in view.group(0)
