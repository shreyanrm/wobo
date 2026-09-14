-- 0031 — the board a learner may change once, and the queue a person clears after that.
--
-- THE LAW: docs/CONSOLE-ROLES-AND-BOARD.md §1, the owner on 2026-09-09. *"If the user wants to
-- change their board in settings, they can, but only for the first time it lets them reselect.
-- The next time onwards when they want to change again, show them a button to contact support
-- and we will handle it from there."*
--
-- APPLIES AFTER 0002 (which creates the `learner` schema and its row-level-security posture),
-- 0015 (which creates `ops` and revokes it from every client role) and 0024 (which creates
-- `ops.settings`, the live dials this file seeds three rows into). Additive and idempotent:
-- applying it twice is a no-op and never hands anybody back a change they have spent.
--
-- WHY TWO TABLES AND NOT ONE. They answer two different questions, are read by two different
-- planes, and have two different privacy shapes.
--
--   `learner.board_changes` is the STAMP ON THE ACCOUNT. §1: "The change is stamped on the
--   account with when and from what." It is the learner's own record, it sits in the learner
--   plane behind row-level security scoped to the learner, and the learner may read it — it is
--   their history, and a person is entitled to see what happened to their own syllabus.
--
--   `ops.board_change_requests` is the CONSOLE'S QUEUE. §1: "every board-change request lands in
--   a queue with the learner's current board, the board they asked for, when they last changed,
--   and one button to grant it." It is operator work, it sits in `ops`, and no client role can
--   read one byte of it — a learner must not be able to read anybody's queue, including their own
--   position in it, because the row carries another plane's state machine.
--
-- WHY THERE IS NO THIRD TABLE FOR THE GRANT. Granting is a STATE on the request, and "resets
-- their allowance of one" is computed by counting only the changes made after the newest granted
-- request's `decided_at`. A grants table would be a second place to look for one fact, and the
-- day the two disagreed the learner would be the one who found out.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No counter column anywhere. "How many changes have they made" is COUNTED over the trail
--     every time it is asked, because a counter and a trail are two answers to one question and
--     a counter is the one that can be wrong without leaving a mark.
--   * No note, no free text and no reply address on a request. §1: the form carries "their
--     current board and the one they want and nothing else", so there is nowhere here to put
--     anything else, and nobody can later decide to.
--   * No delete on either table, for anybody, service_role included. A change is history and a
--     request is worked, never tidied away.

create schema if not exists learner;
create schema if not exists ops;
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
grant usage on schema ops to service_role;


-- ---------------------------------------------------------------------------------------------
-- learner.board_changes — every move of a board or a class, in order, on the account.
-- ---------------------------------------------------------------------------------------------
--
-- `from_framework_id` IS NULL ON EXACTLY ONE ROW PER ACCOUNT: the anchor, written the first time
-- a learner sets a board through the Settings route at all. A learner's first board is pinned in
-- onboarding, which does not come through this path, so the gateway writes the anchor from what
-- the app says the first time it is asked and reads the trail for ever afterwards. An anchor is
-- not a change and counts against nothing; see `board_change.py`'s ChangeBody for why the app is
-- trusted for that one field, once, and never again.
--
-- `by` is who made it, and it is the difference between a rule and an accident:
--   learner   — from Settings, on their own account. Counts.
--   parent    — from the parent's account, for a child. Counts while `board.parent_change_counts`
--               says it does (§1 gives the owner that dial).
--   operator  — a correction made from the console. NEVER counts: an operator putting somebody
--               back where they belong must not spend the change the learner is owed.
create table if not exists learner.board_changes (
  -- Monotonic rather than a uuid: the first question is always "in what order", and the answer
  -- has to be readable without joining anything.
  id bigint generated always as identity primary key,
  subject_id uuid not null,
  at timestamptz not null default now(),
  -- Where they were. Null only on the anchor row.
  from_framework_id text,
  from_level text,
  -- Where they went. Never null: a change with no destination is not a change.
  to_framework_id text not null,
  to_level text,
  by text not null default 'learner',
  -- The admin who granted the request this change was made under, when there was one. Kept so
  -- "why was this person allowed a third change" is answerable from the row itself.
  granted_by uuid,
  constraint board_changes_by_is_known check (by in ('learner', 'parent', 'operator')),
  constraint board_changes_from_is_short
    check (from_framework_id is null or char_length(from_framework_id) between 1 and 120),
  constraint board_changes_to_is_short check (char_length(to_framework_id) between 1 and 120),
  constraint board_changes_from_level_is_short
    check (from_level is null or char_length(from_level) <= 60),
  constraint board_changes_to_level_is_short
    check (to_level is null or char_length(to_level) <= 60)
);

create index if not exists board_changes_subject_idx
  on learner.board_changes (subject_id, at);

comment on table learner.board_changes is
  'Every board or class move on an account, in order. Append-only. The stamp docs/CONSOLE-ROLES-AND-BOARD.md §1 asks for.';
comment on column learner.board_changes.from_framework_id is
  'Null on the anchor row only: the first time Settings saw this account, before any change.';
comment on column learner.board_changes.by is
  'learner, parent or operator. An operator''s own correction never counts against the learner.';


-- ---------------------------------------------------------------------------------------------
-- ops.board_change_requests — the queue an operator clears. One open row per learner.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.board_change_requests (
  -- A hex id the gateway mints, not a database default, so the row the gateway wrote and the row
  -- it answers with are provably the same one on a retry.
  id text primary key,
  subject_id uuid not null,
  at timestamptz not null default now(),
  -- The three facts §1 puts in front of the operator.
  current_framework_id text,
  current_level text,
  wanted_framework_id text not null,
  wanted_level text,
  last_changed_at timestamptz,
  raised_by text not null default 'learner',
  state text not null default 'new',
  decided_at timestamptz,
  -- `ops.admins.id`, not a name: who granted it is a seat, and the register is where a seat has
  -- an email. No foreign key, so the trail survives a seat being removed.
  decided_by uuid,
  constraint board_change_requests_state_is_known check (state in ('new', 'granted', 'declined')),
  constraint board_change_requests_raised_by_is_known
    check (raised_by in ('learner', 'parent')),
  constraint board_change_requests_wanted_is_short
    check (char_length(wanted_framework_id) between 1 and 120),
  constraint board_change_requests_current_is_short
    check (current_framework_id is null or char_length(current_framework_id) between 1 and 120),
  constraint board_change_requests_levels_are_short
    check (
      (current_level is null or char_length(current_level) <= 60)
      and (wanted_level is null or char_length(wanted_level) <= 60)
    ),
  -- A decided row says when and by whom, or it says neither. A half-decided row is a row nobody
  -- can explain.
  constraint board_change_requests_decided_is_whole
    check ((state = 'new') = (decided_at is null))
);

-- ONE OPEN REQUEST PER LEARNER, enforced by the database rather than by the route. §1's queue is
-- worked one person at a time; a learner who taps the button four times must be one row with the
-- board they asked for last, not four rows an operator has to reconcile.
create unique index if not exists board_change_requests_one_open_idx
  on ops.board_change_requests (subject_id)
  where state = 'new';

create index if not exists board_change_requests_state_idx
  on ops.board_change_requests (state, at desc);

comment on table ops.board_change_requests is
  'The board-change queue. Two boards, when they last changed, and one button to grant it. No note, ever.';


-- ---------------------------------------------------------------------------------------------
-- Append-only where it matters, enforced by trigger as well as by grant.
-- ---------------------------------------------------------------------------------------------
--
-- `board_changes` takes inserts and nothing else: a history somebody can edit is not a history.
-- `board_change_requests` takes updates, because granting IS an update — but it may not be
-- deleted, and a granted row may not be walked back to `new` to be granted a second time.
create or replace function learner.board_changes_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'learner.board_changes is append-only: % is refused', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists board_changes_no_update on learner.board_changes;
create trigger board_changes_no_update
  before update on learner.board_changes
  for each row execute function learner.board_changes_are_append_only();

drop trigger if exists board_changes_no_delete on learner.board_changes;
create trigger board_changes_no_delete
  before delete on learner.board_changes
  for each row execute function learner.board_changes_are_append_only();

-- Truncate sidesteps row triggers entirely, so it gets its own statement-level one.
drop trigger if exists board_changes_no_truncate on learner.board_changes;
create trigger board_changes_no_truncate
  before truncate on learner.board_changes
  for each statement execute function learner.board_changes_are_append_only();

create or replace function ops.board_change_request_moves_forward()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state <> 'new' and new.state <> old.state then
    raise exception 'ops.board_change_requests: % was already %, and a decision is made once',
      old.id, old.state
      using errcode = 'insufficient_privilege';
  end if;
  if new.subject_id is distinct from old.subject_id then
    raise exception 'ops.board_change_requests: a request cannot change whose it is'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists board_change_requests_forward_only on ops.board_change_requests;
create trigger board_change_requests_forward_only
  before update on ops.board_change_requests
  for each row execute function ops.board_change_request_moves_forward();


-- ---------------------------------------------------------------------------------------------
-- Row level security. On and FORCED for both, so the table owner is bound too.
-- ---------------------------------------------------------------------------------------------
alter table learner.board_changes enable row level security;
alter table learner.board_changes force row level security;
alter table ops.board_change_requests enable row level security;
alter table ops.board_change_requests force row level security;

-- The learner READS their own history and writes none of it. `for select` and nothing else: the
-- policies in 0002 are `for all` on the learner's own tables, which is right for a draft and
-- wrong for a record of what they are allowed to do. The gateway writes this with the service
-- key, and the service key is not subject to policies.
drop policy if exists board_changes_own_read on learner.board_changes;
create policy board_changes_own_read on learner.board_changes
  for select to authenticated
  using (subject_id = auth.uid());

-- NO policy at all on the queue, for any client role. An operator reads it through the gateway's
-- console door like every other desk, and a learner has no business reading a row about anybody,
-- including themselves: the product tells them a person will look at it, and that is the whole
-- of what they are told.


-- ---------------------------------------------------------------------------------------------
-- Grants, one at a time, in writing.
-- ---------------------------------------------------------------------------------------------
revoke all on learner.board_changes from public, anon;
revoke all on ops.board_change_requests from public, anon, authenticated;

grant select on learner.board_changes to authenticated;
grant select, insert on learner.board_changes to service_role;
revoke update, delete, truncate on learner.board_changes from service_role, authenticated;

grant select, insert, update on ops.board_change_requests to service_role;
revoke delete, truncate on ops.board_change_requests from service_role;

grant usage, select on sequence learner.board_changes_id_seq to service_role;


-- ---------------------------------------------------------------------------------------------
-- The dials. §1: "how many free changes a learner gets before support is needed (default 1),
-- whether a parent's change counts against the learner's, and whether the whole rule is off for
-- a cohort." Live and audited, in the table 0024 built for exactly this.
-- ---------------------------------------------------------------------------------------------
--
-- `do nothing` on conflict, so re-applying this migration never resets a dial somebody turned.
insert into ops.settings (key, value, description, note)
values
  (
    'board.free_changes',
    '1'::jsonb,
    'How many board changes a learner makes before a person is needed. docs/CONSOLE-ROLES-AND-BOARD.md §1.',
    'The law''s own default.'
  ),
  (
    'board.parent_change_counts',
    'true'::jsonb,
    'Whether a change made from a parent''s account counts against the learner''s.',
    'The law''s own default.'
  ),
  (
    'board.rule_off_for',
    '[]'::jsonb,
    'Cohorts the rule is off for: everyone, board:<framework_id>, plan:<plan>. A name outside that set matches nobody.',
    'Off for nobody until the owner says otherwise.'
  )
on conflict (key) do nothing;

-- TO GIVE ONE COHORT A FREE HAND, for instance a school that has changed affiliation and whose
-- whole intake needs to move, one statement in the SQL editor and no deploy:
--
--   update ops.settings
--      set value = '["board:cbse"]'::jsonb, note = 'the school moved to the state board'
--    where key = 'board.rule_off_for';
--
-- And back to the rule with '[]'. Either way the trigger in 0024 writes the row in
-- ops.settings_audit that says it happened, whoever made the change and through whatever client.
