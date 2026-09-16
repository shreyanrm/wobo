"""Migration 0038, applied to a real Postgres: its syntax, its idempotence and its trigger.

``test_growth_schema.py`` reads the SQL as text. This file runs it. It needs the Postgres server
binaries (``initdb``, ``pg_ctl``, ``psql``): on PATH, or in the folder ``WOBO_PG_BIN`` names. Any
Postgres 15 or later will do; the embedded build in the ``pgserver`` wheel is one way to get them
without installing a server:

    uv venv /tmp/pg && VIRTUAL_ENV=/tmp/pg uv pip install pgserver
    WOBO_PG_BIN=$(echo /tmp/pg/lib/python3.*/site-packages/pgserver/pginstall/bin) uv run pytest \\
        tests/test_growth_schema_live.py

Without them every test here is skipped, and says why. The cluster lives in a temporary folder,
listens on localhost only, and is stopped when the module ends.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

MIGRATION = Path(__file__).resolve().parents[3] / "infra/supabase/migrations/0038_growth_desk.sql"

# What 0038 stands on in Supabase: the three API roles, and the account table from 0002.
PRELUDE = """
do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin;
exception when duplicate_object then null; end $$;
create schema if not exists learner;
create table if not exists learner.profiles_cache (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null unique,
  display_name text
);
grant usage on schema learner to anon, authenticated, service_role;
grant select, insert, update on learner.profiles_cache to service_role;
"""


def _bin() -> Path | None:
    named = os.getenv("WOBO_PG_BIN")
    if named and (Path(named) / "initdb").exists():
        return Path(named)
    found = shutil.which("initdb")
    return Path(found).parent if found else None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class Postgres:
    def __init__(self, bin_dir: Path, port: int) -> None:
        self.bin = bin_dir
        self.port = port

    def run(self, sql: str, *, role: str | None = None) -> subprocess.CompletedProcess[str]:
        script = f"set role {role};\n{sql}" if role else sql
        return subprocess.run(
            [
                str(self.bin / "psql"),
                "-h",
                "127.0.0.1",
                "-p",
                str(self.port),
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
                "-X",
                "-q",
                "-A",
                "-t",
            ],
            input=script,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    def ok(self, sql: str, **kw: str) -> str:
        done = self.run(sql, **kw)
        assert done.returncode == 0, done.stderr
        return done.stdout.strip()

    def refused(self, sql: str, why: str, **kw: str) -> None:
        done = self.run(sql, **kw)
        assert done.returncode != 0, f"accepted: {sql}"
        assert why in done.stderr, done.stderr


@pytest.fixture(scope="module")
def pg(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Postgres]:
    bin_dir = _bin()
    if bin_dir is None:
        pytest.skip("no Postgres server binaries here (set WOBO_PG_BIN to run migration 0038)")
    data = tmp_path_factory.mktemp("pg") / "data"
    subprocess.run(
        [str(bin_dir / "initdb"), "-D", str(data), "-U", "postgres", "--auth=trust", "-E", "UTF8"],
        check=True,
        capture_output=True,
        timeout=120,
    )
    port = _free_port()
    log = data.parent / "server.log"
    subprocess.run(
        [
            str(bin_dir / "pg_ctl"),
            "-D",
            str(data),
            "-l",
            str(log),
            "-w",
            "-o",
            f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''",
            "start",
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    server = Postgres(bin_dir, port)
    try:
        server.ok(PRELUDE)
        yield server
    finally:
        subprocess.run(
            [str(bin_dir / "pg_ctl"), "-D", str(data), "-m", "fast", "stop"],
            capture_output=True,
            timeout=60,
            check=False,
        )


@pytest.fixture(scope="module")
def applied(pg: Postgres) -> Postgres:
    sql = MIGRATION.read_text()
    pg.ok(sql)
    pg.ok(sql)  # additive and idempotent: the second run is a no-op, not an error
    return pg


PIECE = (
    "insert into growth.pieces (slug, topic_slug, drafted_on, publishable, origin_url) "
    "values ('{slug}', '{slug}', '2026-09-16', true, 'https://heywobo.com/blog/{slug}')"
)


def _campaign(channel: str, slug: str, status: str, attempt: int = 1) -> str:
    tier = "person" if channel in {"medium", "pinterest", "newsletter"} else "script"
    return (
        "insert into growth.campaigns (id, piece_slug, shape, channel, tier, month, attempt, "
        f"status) values ('{channel}-202609-{slug}-{attempt:02d}', '{slug}', "
        f"'{'blog' if channel == 'blog' else 'thread'}', '{channel}', '{tier}', '202609', "
        f"{attempt}, '{status}')"
    )


def test_it_applies_twice(applied: Postgres) -> None:
    tables = applied.ok(
        "select string_agg(table_name, ',' order by table_name) from information_schema.tables "
        "where table_schema = 'growth'"
    )
    assert tables == "campaigns,pieces,signals,signups"


def test_a_copy_waits_for_the_indexed_stamp(applied: Postgres) -> None:
    applied.ok(PIECE.format(slug="probability"))
    applied.ok(_campaign("blog", "probability", "approved"))
    applied.refused(_campaign("x", "probability", "approved"), "publish then syndicate")
    applied.ok(_campaign("x", "probability", "held"))
    applied.refused(
        "update growth.campaigns set status = 'approved' where id = 'x-202609-probability-01'",
        "publish then syndicate",
    )
    applied.refused(
        "update growth.pieces set indexed_at = now() where slug = 'probability'",
        "pieces_indexed_after_published",
    )
    applied.ok(
        "update growth.pieces set published_at = now() - interval '1 day', indexed_at = now() "
        "where slug = 'probability'"
    )
    applied.ok(
        "update growth.campaigns set status = 'approved' where id = 'x-202609-probability-01'"
    )


def test_a_finished_post_does_not_move_and_is_never_deleted(applied: Postgres) -> None:
    applied.ok(PIECE.format(slug="motion"))
    applied.ok(_campaign("blog", "motion", "posted"))
    applied.refused(
        "update growth.campaigns set status = 'approved' where id = 'blog-202609-motion-01'",
        "a finished post does not move again",
    )
    applied.refused(
        "update growth.campaigns set channel = 'x' where id = 'blog-202609-motion-01'",
        "never change",
    )
    applied.refused(
        "delete from growth.campaigns where id = 'blog-202609-motion-01'", "never deleted"
    )
    applied.refused("truncate growth.campaigns cascade", "never deleted")
    # A page a redeploy wiped is posted again under the next attempt; the first row stays.
    applied.ok(_campaign("blog", "motion", "approved", attempt=2))


def test_reddit_and_quora_can_never_have_a_row(applied: Postgres) -> None:
    applied.ok(PIECE.format(slug="energy"))
    for channel in ("reddit", "quora"):
        applied.refused(_campaign(channel, "energy", "held"), "campaigns_")


def test_an_id_must_match_its_parts(applied: Postgres) -> None:
    applied.ok(PIECE.format(slug="force"))
    applied.refused(
        "insert into growth.campaigns (id, piece_slug, shape, channel, tier, month, attempt, "
        "status) values ('x-202609-force-01', 'force', 'thread', 'telegram', 'script', "
        "'202609', 1, 'held')",
        "campaigns_id_matches_its_parts",
    )


def test_an_account_carries_one_campaign_for_good(applied: Postgres) -> None:
    applied.ok(
        "insert into learner.profiles_cache (subject_id, campaign_id) values "
        "('73333333-3333-4333-8333-333333333333', 'x-202609-probability-01')"
    )
    applied.refused(
        "update learner.profiles_cache set campaign_id = 'blog-202609-motion-01' "
        "where subject_id = '73333333-3333-4333-8333-333333333333'",
        "written once",
    )
    assert applied.ok("select signups from growth.signups") == "1"


def test_a_browser_reads_nothing(applied: Postgres) -> None:
    for role in ("anon", "authenticated"):
        applied.refused("select count(*) from growth.pieces", "permission denied", role=role)
        applied.refused(
            "update learner.profiles_cache set campaign_id = null",
            "permission denied",
            role=role,
        )
    assert applied.ok("select count(*) >= 0 from growth.pieces", role="service_role") == "t"
