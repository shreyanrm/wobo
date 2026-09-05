"""Migration 0019 — the ``parent`` schema, read as a contract.

No Postgres runs here (the repo's migrations are applied through the project, never locally), so
these follow ``test_parent_links_schema.py`` and ``test_admin_schema.py``: a guard against the
failures that would be invisible until production, each one a grep away from being caught.

The failures this file is written against, in the order they would hurt:

* a parent's table readable with a LEARNER's token, which would walk straight around the four-
  action allow-list the endpoints enforce;
* the two kinds of account becoming one thing, so a learner could be promoted into a parent or a
  parent could grow learner state;
* the parent's mind growing a third source, which is how the child's own words would arrive;
* a retired memory coming back when a link is re-made, which would make revocation cosmetic;
* a parent re-adding a fact the child removed, which would break the memory page's promise;
* an audit trail its own subject can edit, which is a diary and not a trail.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
MIGRATION = MIGRATIONS / "0019_parent_accounts.sql"

TABLES = (
    "parent.accounts",
    "parent.child_links",
    "parent.selections",
    "parent.mind_facts",
    "parent.offers",
    "parent.threads",
    "parent.access_audit",
)


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text()


def test_the_migration_exists_and_is_in_sequence() -> None:
    assert MIGRATION.is_file()
    numbers = sorted(p.name[:4] for p in MIGRATIONS.glob("*.sql"))
    assert numbers.index("0019") == numbers.index("0018") + 1


def test_it_is_idempotent(sql: str) -> None:
    """Applying it twice is a no-op, the posture every migration in this directory keeps."""
    assert "create schema if not exists parent" in sql
    for table in TABLES:
        assert f"create table if not exists {table}" in sql, table
    # Every trigger is dropped before it is created, so a second run does not raise.
    created = set(re.findall(r"create trigger (\w+)", sql))
    dropped = set(re.findall(r"drop trigger if exists (\w+)", sql))
    assert created <= dropped, created - dropped


# --- the posture: a parent's tables are the gateway's alone ---------------------------------------
def test_the_schema_starts_from_zero(sql: str) -> None:
    """The 0015 posture. A parent's data is reachable only through the endpoints that enforce the
    four-action limit, so nothing is granted to a token of any kind."""
    for role in ("public", "anon", "authenticated"):
        assert f"revoke all on schema parent from {role}" in sql, role
    assert (
        "alter default privileges in schema parent revoke all on tables from "
        "public, anon, authenticated" in sql
    )
    assert "grant usage on schema parent to service_role" in sql
    assert "grant usage on schema parent to authenticated" not in sql


def test_not_one_table_is_granted_to_a_learners_token(sql: str) -> None:
    """The whole security model in one assertion. A UI-only limit is not a limit, and neither is
    an endpoint limit that a direct PostgREST call with a learner's token can walk around."""
    grants = re.findall(r"grant [^;]*? on (parent\.\w+) to (\w+)", sql)
    for table, role in grants:
        assert role == "service_role", f"{table} is granted to {role}"


def test_there_is_no_policy_for_authenticated_anywhere(sql: str) -> None:
    policies = re.findall(r"create policy [^;]*?to (\w+)", sql)
    assert not policies, f"the parent schema has no client-role policies, found: {policies}"


def test_row_level_security_is_on_and_forced_for_every_table(sql: str) -> None:
    for table in TABLES:
        assert f"alter table {table} enable row level security" in sql, table
        assert f"alter table {table} force row level security" in sql, table


# --- two kinds of account, and an account is one kind for life ------------------------------------
def test_a_parent_account_can_never_hold_learner_state_and_the_reverse(sql: str) -> None:
    """Both directions, in the database. A parent is not a learner with a flag, and a learner
    cannot be quietly promoted into a parent to reach their own data twice."""
    assert "create or replace function parent.assert_not_a_learner()" in sql
    assert "from learner.learner_state s where s.subject_id = new.account_id" in sql
    assert "create trigger accounts_are_not_learners" in sql

    assert "create or replace function parent.assert_not_a_parent()" in sql
    assert "from parent.accounts a where a.account_id = new.subject_id" in sql
    assert "create trigger learner_state_is_not_a_parent" in sql


def test_the_definer_functions_pin_their_search_path(sql: str) -> None:
    """A definer function that resolves an unqualified name through the caller's search_path is
    the classic way to hand out its own privileges (the rule 0015 sets)."""
    definers = re.findall(r"(security definer(?:.|\n){0,120}?)\$\$", sql)
    assert definers
    for body in definers:
        assert "set search_path = ''" in body, body[:80]


# --- consent lives in one place -------------------------------------------------------------------
def test_the_binding_carries_no_status_of_its_own(sql: str) -> None:
    """``parent.child_links`` binds a parent account to a ``learner.parent_links`` row and reads
    the consent from there every time. A duplicated status column would be a cached permission,
    and a cached permission is a revocation that did not happen."""
    body = sql[sql.index("create table if not exists parent.child_links") :]
    body = body[: body.index(");")]
    assert "status" not in body, "a status column here would let the link and its consent drift"
    assert "link_id uuid not null" in body


def test_one_consent_row_belongs_to_exactly_one_parent_account(sql: str) -> None:
    assert "create unique index if not exists child_links_one_parent_per_link_idx" in sql
    assert "on parent.child_links (link_id)" in sql


def test_the_switch_is_one_child_at_a_time_and_mints_a_scope(sql: str) -> None:
    body = sql[sql.index("create table if not exists parent.selections") :]
    body = body[: body.index(");")]
    assert "parent_account_id uuid primary key" in body, "one row per parent, so one child"
    assert "scope uuid not null default gen_random_uuid()" in body


# --- the parent's mind has exactly two sources ----------------------------------------------------
def test_the_mind_has_two_sources_and_the_check_constraint_is_the_allow_list(sql: str) -> None:
    """The child's own words, conversation, work, boards and mind have no column to arrive in."""
    assert "check (source in ('parent', 'report'))" in sql


def test_the_family_layer_holds_the_parents_own_knowledge_only(sql: str) -> None:
    assert "check (learner_id is not null or source = 'parent')" in sql


def test_a_retired_memory_does_not_come_back(sql: str) -> None:
    """Consent to be talked about is not retroactive, so retirement is one-way and the trigger
    refuses to revive a row whoever asks."""
    assert "create or replace function parent.mind_facts_retirement_is_one_way()" in sql
    assert "if old.status = 'retired' and new.status <> 'retired' then" in sql
    assert "create trigger mind_facts_no_revival" in sql


# --- a parent cannot re-add what a child removed --------------------------------------------------
def test_the_unique_index_that_makes_the_offer_direction_safe(sql: str) -> None:
    """Scoped to the LEARNER and not to the parent, so a second parent account cannot post what
    the child already removed either."""
    assert "create unique index if not exists offers_one_per_fact_per_learner_idx" in sql
    assert "on parent.offers (learner_id, fact_key)" in sql
    assert "fact_key ~ '^[0-9a-f]{64}$'" in sql, "the key is a digest and is checked as one"


def test_a_removed_offer_keeps_its_row_and_its_status(sql: str) -> None:
    assert "check (status in ('pending', 'accepted', 'withdrawn', 'removed_by_child'))" in sql
    assert "create or replace function parent.offers_removal_is_final()" in sql
    assert "create trigger offers_removal_is_final" in sql


# --- the trail ------------------------------------------------------------------------------------
def test_the_audit_is_append_only_twice_over(sql: str) -> None:
    """Once by grant and once by trigger, the 0015 shape. The thing this defends against is
    precisely the account whose own reads it records."""
    assert "grant select, insert on parent.access_audit to service_role" in sql
    assert "revoke update, delete on parent.access_audit from service_role" in sql
    assert "create or replace function parent.access_audit_is_append_only()" in sql
    for op in ("update", "delete", "truncate"):
        assert f"create trigger access_audit_no_{op}" in sql, op


def test_the_trail_is_not_in_the_operators_schema(sql: str) -> None:
    """Its own table rather than ``ops.admin_audit``. That trail is the operator's, over every
    learner, readable only by an active admin; this one is about one family and the person it
    protects is the child, who must never be able to read the operator's."""
    assert "create table if not exists parent.access_audit" in sql
    # Nothing in this file grants on, writes to, or alters the operator's trail. It is named in
    # prose, to say why it is the wrong home for this one, and nowhere else.
    for statement in ("on ops.admin_audit", "into ops.admin_audit", "table ops.admin_audit"):
        assert statement not in sql, statement


def test_reads_are_audited_and_not_only_writes(sql: str) -> None:
    assert "'child.report.read'" in sql or "child.report.read" in sql
    assert "'children.list'" in sql or "children.list" in sql


def test_the_trail_says_it_is_not_a_place_for_content(sql: str) -> None:
    assert "NOT a place to copy a child's content into" in sql
    assert "check (jsonb_typeof(detail) = 'object')" in sql
