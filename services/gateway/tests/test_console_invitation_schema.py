"""Migration 0037: the invitation link's half of the register row.

A diff alarm over the text of a .sql file, exactly as ``test_console_roles_schema.py`` is for 0029.
What it cannot prove, and what the owner drives on a branch when applying it: an invited row can be
written with both columns, the partial unique index refuses two rows holding the same digest, and a
learner's token still reads nothing from ``ops.admins``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0037_console_invitation_link.sql"


@pytest.fixture(scope="module")
def body() -> str:
    text = MIGRATION.read_text()
    return "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("--")).lower()


def test_the_migration_exists_with_its_own_number() -> None:
    assert MIGRATION.is_file()
    assert [p.name[:4] for p in MIGRATIONS.glob("*.sql")].count("0037") == 1


def test_the_row_keeps_a_digest_and_a_deadline_and_never_the_link(body: str) -> None:
    assert "add column if not exists invite_token_hash text" in body
    assert "add column if not exists invite_expires_at timestamptz" in body
    assert "invite_token text" not in body.replace("invite_token_hash", "")


def test_the_digest_is_a_digest(body: str) -> None:
    assert "invite_token_hash ~ '^[0-9a-f]{64}$'" in body


def test_an_outstanding_link_belongs_to_an_untaken_seat(body: str) -> None:
    """A seat that has its account holds no link: the link is spent the moment it binds."""
    assert "admins_invitation_only_while_invited" in body
    assert "invite_token_hash is null or (status = 'invited' and subject_id is null)" in body


def test_no_two_seats_share_a_link(body: str) -> None:
    assert "create unique index if not exists admins_one_row_per_invitation" in body
    assert "where invite_token_hash is not null" in body


def test_it_grants_nothing_new(body: str) -> None:
    assert "grant " not in body
    assert "authenticated" not in body
