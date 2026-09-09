-- 0025 — growth.waiting_list: the list that stands where the door was.
--
-- APPLIES AFTER 0024, which closes the door. This file is the other half of the same decision:
-- `docs/DOORS-CLOSED.md` §3. A closed door that says nothing wastes every visitor 438 public
-- pages earn, so where "Start free" stands a person is asked for one thing, an email address,
-- and optionally their class and board, and is told plainly that Wobo is not open yet and that
-- they will hear the day it is.
--
-- A NEW SCHEMA, `growth`, AND NOT `learner` OR `ops`. Decided, not defaulted:
--   * Not `learner`. Every table there is shaped around `learner_id = auth.uid()` and the
--     `authenticated` role holds real grants. Nobody on this list has an account — that is the
--     entire premise — so there is no `auth.uid()` for a row here to belong to, and putting it
--     beside tables that assume one is how a convenience policy later exposes it.
--   * Not `ops`. That schema is the operator plane: who may open the console, what they looked
--     at, and the queues they work. A marketing list is neither.
--   * `growth` starts from zero, exactly as `ops` did in 0015: every privilege revoked from
--     `public`, `anon` and `authenticated`, handed back one grant at a time, in writing, and a
--     default privilege so the next table anybody adds here starts closed too.
--
-- THE FOUR RULINGS THIS FILE ENCODES:
--
-- 1. NO CHILD'S ADDRESS IS EVER STORED, AND THE SCHEMA IS HOW THAT IS TRUE.
--    Under 13 the address is the parent's (`docs/legal/childrens-privacy.md`). This table has no
--    name, no date of birth, no age and no age band, so it cannot hold a child's details even if
--    a future caller tried to send them: there is nowhere for them to land. The gateway's door
--    (`waiting_list.py`) refuses an unknown field outright rather than dropping it, so the two
--    halves say the same thing.
--
-- 2. THE ADDRESS IS STORED, AND SO IS A ONE-WAY DIGEST OF IT, AND THEY DO DIFFERENT JOBS.
--    The address is stored because the whole promise is one mail on the day it opens, and a
--    promise you have no way to keep is a lie. The digest is the de-duplication key: a keyed
--    HMAC under a server-side pepper, taken by the gateway, unique here. Unique on the ADDRESS
--    would have worked too and would have been worse, because a unique index is a lookup, and a
--    lookup on a plain address is an enumeration oracle for anybody who reaches the database.
--
-- 3. APPEND-ONLY FOR UPDATES, DELETABLE BY THE SERVER. This is the posture of the admin register
--    (0015) bent by one deliberate degree. A row cannot be EDITED once written — a list somebody
--    can quietly retarget is not a list of people who asked — but it CAN be deleted with the
--    service role, because the address is deletable on request like everything else we hold, and
--    a table that cannot honour an erasure request is a compliance failure wearing a security
--    posture.
--
-- 4. THE SOURCE PAGE IS A PATH, NEVER AN ADDRESS. It says which chapter or syllabus page earned
--    the sign-up, which is the only reason to keep it. A full URL would carry whatever query
--    string a visitor arrived with, and a referrer is not to be trusted with either.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No position, no rank, no sequence anybody could show a visitor. DOORS-CLOSED §3 forbids a
--     waiting number, a queue position and any invented scarcity, and the way to keep a promise
--     like that is to have nothing to break it with. `created_at` orders the mail-out and is the
--     only ordering there is.
--   * No `invited_at`, `converted_at` or funnel column. On the day it opens everybody on this
--     list gets one mail. That is not a funnel and must not grow into one.
--   * No name field. The mail is addressed to nobody in particular, which is correct: we do not
--     know who they are and we did not ask.
--   * No consent or marketing-preference column. There is exactly one mail, it is the launch, and
--     its unsubscribe works from the first message. A preference matrix implies a second mail.
--
-- Additive and idempotent. Applying it twice is a no-op.

create schema if not exists growth;

-- Zero by default. Nothing here is reachable by a learner's token, by an anonymous caller, or by
-- anything that inherits `public`, unless it is granted back by name below.
revoke all on schema growth from public;
revoke all on schema growth from anon;
revoke all on schema growth from authenticated;
-- Future tables in this schema start closed too, so the next person to add one does not have to
-- remember: a default grant is a rule, a remembered revoke is a hope.
alter default privileges in schema growth revoke all on tables from public, anon, authenticated;
alter default privileges in schema growth revoke all on sequences from public, anon, authenticated;
alter default privileges in schema growth revoke all on functions from public, anon, authenticated;

grant usage on schema growth to service_role;


-- --------------------------------------------------------------------------------------------
-- growth.waiting_list — an address, optionally a class and a board, and where they came from.
-- --------------------------------------------------------------------------------------------
create table if not exists growth.waiting_list (
  id uuid primary key default gen_random_uuid(),
  -- The address we will write to, exactly once, on the day it opens. Lower-cased by the gateway
  -- before it arrives, because two capitalisations of one address are one person.
  email text not null,
  -- The de-duplication key: HMAC-SHA256 of the address under a server-side pepper, hex. One way,
  -- and under its own domain string so it can never be joined to another digest of the same
  -- address in another table.
  email_hash text not null,
  -- Optional, and worth having: together they say which boards to read first, which is exactly
  -- the queue in docs/BOARD-COLD-START.md. `class_name` and not `class`, which is a reserved
  -- word in more places than it is worth arguing with.
  class_name text,
  board text,
  -- The page they came from, as our own site writes it. A path, never a full address.
  source_path text,
  created_at timestamptz not null default now(),
  -- One person, one row. On the digest and not on the address: see ruling 2.
  constraint waiting_list_one_row_per_address unique (email_hash),
  constraint waiting_list_email_looks_like_one check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint waiting_list_email_is_short check (char_length(email) <= 320),
  constraint waiting_list_hash_is_a_digest check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint waiting_list_class_is_short check (class_name is null or char_length(class_name) <= 16),
  constraint waiting_list_board_is_short check (board is null or char_length(board) <= 64),
  constraint waiting_list_source_is_a_path check (source_path is null or source_path ~ '^/[A-Za-z0-9._~/-]{0,199}$')
);

-- The mail-out reads this in the order people asked, and the console counts it.
create index if not exists waiting_list_created_idx on growth.waiting_list (created_at desc);
-- Which boards to read first (docs/BOARD-COLD-START.md). Partial, because most rows have neither.
create index if not exists waiting_list_board_idx
  on growth.waiting_list (board, class_name)
  where board is not null;

comment on table growth.waiting_list is
  'Addresses given while the door is closed. One mail, on the day it opens, and nothing else, ever.';
comment on column growth.waiting_list.email_hash is
  'Keyed HMAC of the address. The de-duplication key, so the unique index is not a lookup on an address.';
comment on column growth.waiting_list.class_name is
  'Optional, as the person typed it. There is no age or date of birth in this table, by design.';


-- --------------------------------------------------------------------------------------------
-- A row cannot be edited once written. Ruling 3.
-- --------------------------------------------------------------------------------------------
create or replace function growth.waiting_list_is_not_editable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'growth.waiting_list rows are not editable: % is refused. Delete and re-add, which leaves the address deletable on request.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists waiting_list_no_update on growth.waiting_list;
create trigger waiting_list_no_update
  before update on growth.waiting_list
  for each row execute function growth.waiting_list_is_not_editable();

-- Truncate sidesteps row triggers, and a list of people who asked to be told is not a thing to
-- lose to one careless statement. A deletion request is one row, by address digest.
drop trigger if exists waiting_list_no_truncate on growth.waiting_list;
create trigger waiting_list_no_truncate
  before truncate on growth.waiting_list
  for each statement execute function growth.waiting_list_is_not_editable();


-- --------------------------------------------------------------------------------------------
-- Row level security. On, and FORCED, so the table owner is bound by it too.
-- --------------------------------------------------------------------------------------------
alter table growth.waiting_list enable row level security;
alter table growth.waiting_list force row level security;

-- NO policy for `authenticated`, and none for `anon`. Nobody on this list has an account, and
-- nobody with an account has any business reading it: a client that could select here holds a
-- mailing list of everyone waiting. The open POST that fills it is the gateway's
-- (`services/gateway .../waiting_list.py`), which writes with the service role, screens the
-- shape, and meters the caller before it writes a byte.


-- --------------------------------------------------------------------------------------------
-- Grants, one at a time, in writing.
-- --------------------------------------------------------------------------------------------
revoke all on growth.waiting_list from public, anon, authenticated;

-- Select, so the launch mail-out and the console's count can read it. Insert, so the door can
-- fill it. Delete, so an erasure request can be honoured. Update for nobody, service_role
-- included, and the trigger above refuses it a second time.
grant select, insert, delete on growth.waiting_list to service_role;
revoke update, truncate on growth.waiting_list from service_role;


-- --------------------------------------------------------------------------------------------
-- Honouring a deletion request. One statement, by digest, run by hand.
-- --------------------------------------------------------------------------------------------
-- The address is deletable on request like everything else we hold
-- (docs/legal/childrens-privacy.md §6). The digest is what the gateway stores, so removing
-- somebody does not require reading the list to find them:
--
--   delete from growth.waiting_list where email = lower('them@example.com');
--
-- And the whole list, on the day the launch mail has gone and it has done its job:
--
--   delete from growth.waiting_list where created_at < now() - interval '1 day';
