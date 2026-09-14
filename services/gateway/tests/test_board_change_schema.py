"""Migration 0031, read as a contract.

No Postgres runs here, so this follows ``test_doors_schema``: a grep for exactly the failures
that would be invisible until the day they mattered. On this file that day is the day a learner
finds their board change has been quietly taken from them, or an operator finds a queue with four
rows from one child in it.

1. **The trail is append-only**, by grant and by trigger, truncate included. A history somebody
   can edit is not a history, and this one decides what a learner is allowed to do.
2. **The learner reads their own history and writes none of it.** The 0002 policies are ``for
   all``, which is right for a draft and wrong for a record of an entitlement, so this one is
   ``for select``.
3. **No client role can read the queue.** Not a stranger, not an operator's browser, not the
   learner the row is about.
4. **One open request per learner**, enforced by a unique index and not by the route.
5. **No note, no reply address, no free text on a request.** §1 says the form carries two boards
   and nothing else, so there is nowhere here for anything else to be put.
6. **No counter column anywhere.** How many changes somebody has made is counted over the trail,
   because a counter and a trail are two answers to one question.
7. **The three dials are seeded with the law's own defaults**, and re-applying the migration
   cannot reset one somebody has turned.
8. **A decision is made once.** A granted row cannot be walked back to new and granted again.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
BOARD = MIGRATIONS / "0031_board_change.sql"

CHANGES = "learner.board_changes"
REQUESTS = "ops.board_change_requests"


@pytest.fixture(scope="module")
def sql() -> str:
    return BOARD.read_text()


def _columns(text: str, table: str) -> str:
    """One ``create table`` block with its commentary stripped: the SQL, not the prose about it."""
    body = text[text.index(f"create table if not exists {table}") :]
    block = body[: body.index("\n);")]
    return "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("--"))


# --- 1. the trail is append-only -----------------------------------------------------------------
@pytest.mark.parametrize("verb", ["update", "delete", "truncate"])
def test_the_trail_refuses_every_way_of_rewriting_it(sql: str, verb: str) -> None:
    assert f"board_changes_no_{verb}" in sql
    assert re.search(rf"before {verb} on {CHANGES}", sql)


def test_not_even_the_gateway_may_rewrite_what_the_gateway_wrote(sql: str) -> None:
    assert re.search(
        r"revoke update, delete, truncate on learner\.board_changes from service_role", sql
    )


# --- 2. the learner reads their own history and writes none of it -----------------------------------
def test_the_learner_may_read_their_own_trail_and_only_read_it(sql: str) -> None:
    policy = sql[sql.index("create policy board_changes_own_read") :]
    policy = policy[: policy.index(";")]
    assert "for select" in policy
    assert "for all" not in policy
    assert "auth.uid()" in policy
    assert "grant select on learner.board_changes to authenticated" in sql
    assert "insert on learner.board_changes to authenticated" not in sql


# --- 3. nobody's client reads the queue --------------------------------------------------------------
def test_no_policy_exists_on_the_queue_for_any_client_role(sql: str) -> None:
    """``docs/CONSOLE-ROLES-AND-BOARD.md`` §1: the queue is worked by a person through the console,
    so the only key that ever touches ``ops.board_change_requests`` is the service role. Row level
    security is on and forced, and with no policy on the table no client role reads a row.

    The policy that IS in this file is on ``learner.board_changes``, the stamp on the account,
    and item 2 above wants it there. It is declared in the shared row-level-security section after
    both tables, so the check is for a policy ON the queue, not for the word anywhere below the
    queue's ``create table``.
    """
    assert not re.search(r"create policy .* on ops\.board_change_requests\b", sql)
    assert f"alter table {REQUESTS} enable row level security" in sql
    assert re.search(
        r"revoke all on ops\.board_change_requests from public, anon, authenticated", sql
    )
    assert f"alter table {REQUESTS} force row level security" in sql


# --- 4. one open request per learner ------------------------------------------------------------------
def test_one_open_request_per_learner_is_the_database_s_rule(sql: str) -> None:
    index = sql[sql.index("board_change_requests_one_open_idx") :]
    index = index[: index.index(";")]
    assert "unique index" in sql[: sql.index("board_change_requests_one_open_idx")].rsplit(
        "create ", 1
    )[-1] or "create unique index" in sql
    assert "(subject_id)" in index
    assert "where state = 'new'" in index


# --- 5 and 6. nothing on a row that should not be on it ------------------------------------------------
@pytest.mark.parametrize("forbidden", ["note", "message", "reply_to", "email", "body", "comment"])
def test_a_request_carries_two_boards_and_nowhere_to_put_anything_else(
    sql: str, forbidden: str
) -> None:
    assert forbidden not in _columns(sql, REQUESTS)


@pytest.mark.parametrize("forbidden", ["count", "used", "changes_made", "remaining"])
def test_no_counter_column_exists_to_disagree_with_the_trail(sql: str, forbidden: str) -> None:
    assert forbidden not in _columns(sql, CHANGES)
    assert forbidden not in _columns(sql, REQUESTS)


def test_an_anchor_is_the_only_row_without_a_board_behind_it(sql: str) -> None:
    columns = _columns(sql, CHANGES)
    assert "from_framework_id text," in columns
    assert "to_framework_id text not null," in columns


def test_who_made_a_change_is_a_closed_list_with_the_operator_in_it(sql: str) -> None:
    assert "check (by in ('learner', 'parent', 'operator'))" in sql


# --- 7. the dials ---------------------------------------------------------------------------------------
def test_the_three_dials_are_seeded_with_the_law_s_own_defaults(sql: str) -> None:
    seed = sql[sql.index("insert into ops.settings") :]
    assert "'board.free_changes'" in seed and "'1'::jsonb" in seed
    assert "'board.parent_change_counts'" in seed and "'true'::jsonb" in seed
    assert "'board.rule_off_for'" in seed and "'[]'::jsonb" in seed


def test_re_applying_the_migration_never_resets_a_dial_somebody_turned(sql: str) -> None:
    assert "on conflict (key) do nothing" in sql


# --- 8. a decision is made once ---------------------------------------------------------------------------
def test_a_granted_request_cannot_be_granted_a_second_time(sql: str) -> None:
    assert "board_change_requests_forward_only" in sql
    guard = sql[sql.index("function ops.board_change_request_moves_forward") :]
    assert "old.state <> 'new'" in guard
    assert "a request cannot change whose it is" in guard


def test_a_decided_row_says_when_or_says_neither(sql: str) -> None:
    assert "check ((state = 'new') = (decided_at is null))" in sql


def test_a_request_is_never_deleted(sql: str) -> None:
    assert re.search(r"revoke delete, truncate on ops\.board_change_requests from service_role", sql)
