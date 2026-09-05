-- 0019 — the parent account, and the two minds (docs/MEMORY-LAW.md, docs/TWO-MINDS.md).
--
-- THE LAW THIS FILE SERVES: the database is the record, the account is the key, everything else
-- is a cache. Until now a "parent" was an address in `learner.parent_links` (0011) that received
-- the Sunday note and could click "not me". There was no auth user behind it, no way for a parent
-- to sign in as themselves, and no way for one parent to hold two children. This file makes the
-- parent a real account, gives it a mind of its own, and writes the boundary between the two
-- minds into the database rather than only into the prompt.
--
-- TWO KINDS OF ACCOUNT, AND THEY ARE NOT VARIATIONS OF ONE THING (owner, 2026-09-05):
--   "the student accounts are completely different, they have no switching, its only signup/login
--    and logout."
-- So a STUDENT account is an account with no row in `parent.accounts`, and that is the whole of
-- it: no profile list, no chooser, no generic account-with-profiles model that a student happens
-- to use with exactly one profile. A PARENT account is a row here, and it may do exactly four
-- things for a child who has linked it (owner, same day): ask Wobo about that child's academics,
-- pay, refer, donate — and switch between linked children to do the same four again.
--
-- WHY A SEPARATE SCHEMA, AND NOT `learner`. Every table in `learner` is shaped around
-- `learner_id = auth.uid()` and the `authenticated` role holds real grants there. A parent's
-- tables living beside them inherit that posture the first time somebody writes a convenience
-- policy, and the posture is exactly wrong here: the whole design is an ALLOW-LIST enforced at
-- the endpoint, and an allow-list is worthless if a parent's token can read the tables directly
-- over PostgREST. So `parent` starts from zero, the way `ops` does in 0015: every privilege
-- revoked from `public`, `anon` and `authenticated`, handed back to `service_role` alone. There
-- is no learner-role policy on any table in this file, on purpose. The gateway is the only door.
--
-- THE SIX RULINGS THIS FILE ENCODES, each a decision and not a default:
--
-- 1. WHICH KIND AN ACCOUNT IS, IS A SERVER-SIDE FACT, AND AN ACCOUNT IS ONE KIND FOR LIFE.
--    A row in `parent.accounts` is the only way to be a parent, it is written with the service
--    role, and two triggers below make the two kinds mutually exclusive in both directions: an
--    account with learner state can never become a parent, and a parent account can never grow
--    learner state. A parent account therefore has no mastery, no courses and no board, because
--    there is no row it could hang them on.
--
-- 2. CONSENT LIVES IN ONE PLACE AND IS NEVER COPIED.
--    `parent.child_links` binds a parent ACCOUNT to a `learner.parent_links` row; it does not
--    carry its own status. Whether a parent may see anything about a child is read from that
--    one row's `status = 'linked'`, so the learner ending it from the You screen and the parent
--    ending it from "not me" both stop access at the very next request. A duplicated status
--    column would be a cached permission, and a cached permission is a revocation that did not
--    happen.
--
-- 3. THE PARENT'S MIND HAS EXACTLY TWO SOURCES, AND THE CHECK CONSTRAINT IS THE ALLOW-LIST.
--    `source in ('parent', 'report')`: what the parent themselves said, and the report-level
--    facts about the child a parent is already allowed to see. The child's own words, their
--    conversation, their work, their boards and their mind have no column to arrive in. The
--    subtle failure this guards against is a parent asking "is he struggling" and a carelessly
--    built prompt answering with a sentence the child actually said.
--
-- 4. RETIREMENT IS ONE-WAY, BECAUSE CONSENT TO BE TALKED ABOUT IS NOT RETROACTIVE.
--    When a link ends, the parent's mind of that child is retired by the gateway and a trigger
--    refuses to bring it back. Re-making the link makes a new link row; it does not resurrect
--    what the parent knew.
--
-- 5. A PARENT CANNOT RE-ADD WHAT A CHILD REMOVED.
--    A parent may OFFER a fact to the child's mind, never inject one. `parent.offers` carries a
--    `fact_key` (a digest of the normalised text) and a unique index on (learner_id, fact_key)
--    that survives the child removing it — so the same sentence cannot come back, and a
--    genuinely different sentence is a new offer the child sees appear. That rule is what makes
--    the whole direction safe, because the child's memory page is already the promise that
--    Wobo's memory of them is steerable and never hidden.
--
-- 6. EVERY PARENT READ OF A CHILD IS AUDITED, AND THE TRAIL IS ITS OWN TABLE.
--    Not `ops.admin_audit`. That trail is the operator's, over every learner, and only an active
--    admin may read it. This trail is about ONE family and the person it protects is the child,
--    who must never be able to read the operator's trail and should one day be able to read
--    their own. Two different subjects, two different readers, two tables. Append-only by grant
--    and by trigger, exactly as 0015's is.
--
-- Additive and idempotent. Applying it twice is a no-op.

create schema if not exists parent;

-- Zero by default, the 0015 posture. Nothing in this schema is reachable by a learner's token,
-- by a parent's token, or by anything that inherits `public`. The gateway's service role is the
-- only reader and the only writer, because the four-action limit is enforced at the endpoint and
-- an endpoint limit that a direct PostgREST call can walk around is not a limit.
revoke all on schema parent from public;
revoke all on schema parent from anon;
revoke all on schema parent from authenticated;
alter default privileges in schema parent revoke all on tables from public, anon, authenticated;
alter default privileges in schema parent revoke all on sequences from public, anon, authenticated;
alter default privileges in schema parent revoke all on functions from public, anon, authenticated;

grant usage on schema parent to service_role;


-- --------------------------------------------------------------------------------------------
-- The shared updated_at trigger. `learner.set_updated_at` exists (0002) but lives in a schema
-- this one must not depend on; a local copy keeps `parent` standing on its own.
-- --------------------------------------------------------------------------------------------
create or replace function parent.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- --------------------------------------------------------------------------------------------
-- parent.accounts — a parent is a real account, signed in the same way anyone else signs in.
--
-- `email_hash` is the same keyed digest `learner.parent_links.parent_email_hash` carries
-- (parents.py's `email_hash`, HMAC under the gateway's mail key). It is what lets a family that
-- was linked by address before this file existed be picked up by the parent who signs up with
-- that address: the digest matches, and the gateway claims the link. It is not reversible by a
-- reader of this table, and the address itself is never stored here at all.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.accounts (
  -- The auth user id. Primary key, not a surrogate: one account, one row, and no way to hold two.
  account_id uuid primary key,
  -- The keyed digest of the address this account signed up with. Matched against the digest on
  -- an existing `learner.parent_links` row to migrate a family that predates this file.
  email_hash text not null,
  -- What Wobo calls them. A first name, never more; it reaches a prompt and a page.
  display_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_status_is_known check (status in ('active', 'closed')),
  constraint accounts_email_hash_is_a_digest check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint accounts_display_name_is_short
    check (display_name is null or char_length(display_name) <= 40)
);

create index if not exists accounts_email_hash_idx on parent.accounts (email_hash);

comment on table parent.accounts is
  'A parent account. A student account has NO row here, and that absence is the whole of what '
  'makes it a student account: there is no profile list and no switcher to find.';


-- --------------------------------------------------------------------------------------------
-- Ruling 1, enforced in the database and in both directions. A parent is not a learner with a
-- flag, and a learner cannot be quietly promoted into a parent to reach their own data twice.
--
-- Security definer with an empty search_path: the trigger must read a table in the other schema
-- without granting anybody select on it, and a definer function that resolves an unqualified
-- name through the caller's search_path is the classic way to hand out its own privileges.
-- --------------------------------------------------------------------------------------------
create or replace function parent.assert_not_a_learner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Every learner table, not `learner_state` alone. The first cut looked at one table, and a
  -- signed-in learner who had not yet written a state row could POST /v1/parent/sign-up and get
  -- a 200 — after which 0019's other trigger refused them learner state forever and there is no
  -- route that deletes a parent account. One unlucky call was a permanently bricked learner.
  if exists (select 1 from learner.learner_state s where s.subject_id = new.account_id)
     or exists (select 1 from learner.wobo_mind m where m.subject_id = new.account_id)
     or exists (select 1 from learner.learner_threads t where t.subject_id = new.account_id)
     or exists (select 1 from learner.attempts a where a.subject_id = new.account_id)
     or exists (select 1 from learner.canvas_state c where c.subject_id = new.account_id)
     or exists (select 1 from learner.mastery_cache k where k.subject_id = new.account_id)
     or exists (select 1 from learner.profiles_cache p where p.subject_id = new.account_id)
  then
    raise exception 'account % already holds learner data and cannot be a parent account',
      new.account_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function parent.assert_not_a_learner() from public;

drop trigger if exists accounts_are_not_learners on parent.accounts;
create trigger accounts_are_not_learners
  before insert on parent.accounts
  for each row execute function parent.assert_not_a_learner();

create or replace function parent.assert_not_a_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from parent.accounts a where a.account_id = new.subject_id) then
    raise exception 'account % is a parent account and holds no learner state', new.subject_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function parent.assert_not_a_parent() from public;

-- One trigger per learner table, because "the two kinds are mutually exclusive" was one table
-- per direction before this: `learner.learner_state` and nothing else. A parent account could
-- still grow threads, attempts, a canvas, a mastery cache and a profile.
drop trigger if exists learner_state_is_not_a_parent on learner.learner_state;
create trigger learner_state_is_not_a_parent
  before insert on learner.learner_state
  for each row execute function parent.assert_not_a_parent();

drop trigger if exists learner_threads_is_not_a_parent on learner.learner_threads;
create trigger learner_threads_is_not_a_parent
  before insert on learner.learner_threads
  for each row execute function parent.assert_not_a_parent();

drop trigger if exists attempts_is_not_a_parent on learner.attempts;
create trigger attempts_is_not_a_parent
  before insert on learner.attempts
  for each row execute function parent.assert_not_a_parent();

drop trigger if exists canvas_state_is_not_a_parent on learner.canvas_state;
create trigger canvas_state_is_not_a_parent
  before insert on learner.canvas_state
  for each row execute function parent.assert_not_a_parent();

drop trigger if exists mastery_cache_is_not_a_parent on learner.mastery_cache;
create trigger mastery_cache_is_not_a_parent
  before insert on learner.mastery_cache
  for each row execute function parent.assert_not_a_parent();

drop trigger if exists profiles_cache_is_not_a_parent on learner.profiles_cache;
create trigger profiles_cache_is_not_a_parent
  before insert on learner.profiles_cache
  for each row execute function parent.assert_not_a_parent();


-- --------------------------------------------------------------------------------------------
-- parent.child_links — one parent, several children. Ruling 2: no status column here.
--
-- `link_id` names the `learner.parent_links` row that carries the consent, and it is UNIQUE, so
-- one link belongs to exactly one parent account. Whether the parent may see anything today is
-- read from that row's `status`, never from this one. A child may link one parent (0011's
-- partial unique index already says so); a parent may hold several children.
--
-- `relationship` records WHICH relationship this is, and it grants nothing extra. `linked_parent`
-- is the parent of a learner who holds their own account. `account_holder` is the under-13 case
-- (docs/legal/parental-consent.md §1, apps/web-pwa/src/screens/auth/age.ts) where a parent or
-- guardian holds the account WITH the child. The READ allow-list is IDENTICAL for both — that is
-- the point of recording it — so a guardian of a small child cannot quietly become a reader of a
-- teenager's private work, and cannot become a reader of a small child's conversation either.
-- What `account_holder` adds is the account-holding actions (the consent switches, closing the
-- account), which are not reads of the child at all.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.child_links (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references parent.accounts (account_id) on delete cascade,
  -- The `learner.parent_links` row this claims. No foreign key across schemas on purpose: the
  -- erase path deletes those rows outright (memory.py), and a cascade would be fine, but a
  -- restrict would let a dangling parent row block a learner asking to be forgotten. The
  -- gateway deletes both.
  link_id uuid not null,
  learner_id uuid not null,
  relationship text not null default 'linked_parent',
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint child_links_relationship_is_known
    check (relationship in ('linked_parent', 'account_holder'))
);

-- One consent row, one parent account. Two parents cannot claim the same link.
create unique index if not exists child_links_one_parent_per_link_idx
  on parent.child_links (link_id);
-- A parent holds a child once. Re-linking after a revoke reuses this row against a new link_id.
create unique index if not exists child_links_one_row_per_pair_idx
  on parent.child_links (parent_account_id, learner_id);
create index if not exists child_links_parent_idx on parent.child_links (parent_account_id);
create index if not exists child_links_learner_idx on parent.child_links (learner_id);

drop trigger if exists child_links_set_updated_at on parent.child_links;
create trigger child_links_set_updated_at before update on parent.child_links
  for each row execute function parent.set_updated_at();

comment on table parent.child_links is
  'Binds a parent account to a learner.parent_links row. Carries NO status: whether the link is '
  'live is read from that row, so a revoke on either side stops access at the next request.';
comment on column parent.child_links.relationship is
  'linked_parent: the parent of a learner who holds their own account. account_holder: the '
  'under-13 case where a guardian holds the account with the child. The read allow-list is the '
  'same for both; account_holder adds account-holding actions, never a wider view of the child.';


-- --------------------------------------------------------------------------------------------
-- parent.selections — THE SWITCH, and it is a server-side selection rather than a client claim.
--
-- One row per parent account, so exactly one child is selected at a time, which is what the
-- owner described: "switch between their children in the same account to perform the same tasks
-- individually". Every scoped read re-derives the child from this row; nothing downstream ever
-- takes a learner id from a request body.
--
-- `scope` changes on every switch. A parent switching children puts two learners on ONE DEVICE
-- by design, so the client is handed a new scope id and must drop everything keyed to the old
-- one. That is the memory law again: the record is here, the device holds a cache, and the cache
-- is told when it is stale.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.selections (
  parent_account_id uuid primary key references parent.accounts (account_id) on delete cascade,
  learner_id uuid not null,
  scope uuid not null default gen_random_uuid(),
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists selections_set_updated_at on parent.selections;
create trigger selections_set_updated_at before update on parent.selections
  for each row execute function parent.set_updated_at();

comment on table parent.selections is
  'Which child a parent is looking at, decided on the server. One row per parent, so one child '
  'at a time; `scope` changes on every switch so a device knows to drop the last child cache.';


-- --------------------------------------------------------------------------------------------
-- parent.mind_facts — the parent's mind. One per linked child, plus a family layer.
--
-- Ruling 3. `source` is the allow-list and it is a check constraint, not a convention:
--   * 'parent' — what the parent themselves said. "She has dyslexia." "We are moving in July."
--     This is the reason the parent side needs a mind at all.
--   * 'report'  — the report-level facts about the child a parent is ALREADY allowed to see
--     (docs/copy/help-centre/product-features/11-the-parent-link.md names the ceiling: the
--     strengths the work showed, the two or three things worth a nudge, one line about the term).
-- Nothing below that line. There is no third value and no column for one.
--
-- `learner_id` NULL is the family layer: what is true of the household rather than one child, so
-- a parent with two children does not have to say "we are moving in July" twice.
--
-- Ruling 4: `status` goes 'active' -> 'retired' and never back. When a link ends the gateway
-- retires this parent's facts about that child, and the trigger below refuses to revive them.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.mind_facts (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references parent.accounts (account_id) on delete cascade,
  -- NULL is the family layer.
  learner_id uuid,
  body text not null,
  source text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint mind_facts_source_is_allowed check (source in ('parent', 'report')),
  constraint mind_facts_status_is_known check (status in ('active', 'retired')),
  constraint mind_facts_body_is_short check (char_length(body) between 1 and 500),
  constraint mind_facts_retired_has_a_time
    check (status <> 'retired' or retired_at is not null),
  -- The family layer is the parent's own knowledge of the household. A report-level fact is
  -- always about one child, so it may not hide there.
  constraint mind_facts_family_layer_is_the_parents_own
    check (learner_id is not null or source = 'parent')
);

create index if not exists mind_facts_scope_idx
  on parent.mind_facts (parent_account_id, learner_id, status);
create index if not exists mind_facts_learner_idx on parent.mind_facts (learner_id);

drop trigger if exists mind_facts_set_updated_at on parent.mind_facts;
create trigger mind_facts_set_updated_at before update on parent.mind_facts
  for each row execute function parent.set_updated_at();

create or replace function parent.mind_facts_retirement_is_one_way()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'a retired parent memory does not come back: consent to be talked about is '
      'not retroactive' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists mind_facts_no_revival on parent.mind_facts;
create trigger mind_facts_no_revival
  before update on parent.mind_facts
  for each row execute function parent.mind_facts_retirement_is_one_way();

comment on table parent.mind_facts is
  'The parent mind: what the parent said, and the report-level facts a parent may already see. '
  'Two sources, enforced by check constraint. The child own words, conversation, work, boards '
  'and mind never reach this table.';


-- --------------------------------------------------------------------------------------------
-- parent.offers — parent to child is OFFERED, never injected (docs/TWO-MINDS.md).
--
-- A parent saying "she has dyslexia" is exactly the context that makes the tutor kinder, so it
-- must be able to get through. But the child never asked their parent to shape their tutor. So
-- Wobo asks the parent whether to pass it on; if it goes, it lands in the CHILD's mind, marked as
-- having come from their parent, visible on the child's memory page beside every other fact, and
-- removable by the child for good.
--
-- Ruling 5 is `fact_key` plus the unique index. The row SURVIVES the child removing the fact,
-- with `status = 'removed_by_child'`, and the index refuses a second row with the same key —
-- so a parent cannot re-add what a child removed. A genuinely different sentence is a new offer,
-- and the child sees it appear.
--
-- A parent-offered fact is never a directive. "Tell her to work harder" is not a fact about a
-- learner and must not become one; the gateway fences this text exactly as it fences a learner's
-- own words, and harder, because it arrives from somebody with authority over the child.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.offers (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references parent.accounts (account_id) on delete cascade,
  learner_id uuid not null,
  body text not null,
  -- SHA-256 of the normalised text. The whole of ruling 5 hangs on this being stable.
  fact_key text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  removed_at timestamptz,
  constraint offers_status_is_known
    check (status in ('pending', 'accepted', 'withdrawn', 'removed_by_child')),
  constraint offers_body_is_short check (char_length(body) between 1 and 500),
  constraint offers_fact_key_is_a_digest check (fact_key ~ '^[0-9a-f]{64}$'),
  constraint offers_removed_has_a_time
    check (status <> 'removed_by_child' or removed_at is not null)
);

-- Ruling 5, in one line. Scoped to the LEARNER and not to the parent, so a second parent account
-- cannot post what the child already removed either.
create unique index if not exists offers_one_per_fact_per_learner_idx
  on parent.offers (learner_id, fact_key);
create index if not exists offers_learner_idx on parent.offers (learner_id, status);
create index if not exists offers_parent_idx on parent.offers (parent_account_id);

drop trigger if exists offers_set_updated_at on parent.offers;
create trigger offers_set_updated_at before update on parent.offers
  for each row execute function parent.set_updated_at();

create or replace function parent.offers_removal_is_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'removed_by_child' and new.status <> 'removed_by_child' then
    raise exception 'a fact the child removed does not come back'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists offers_removal_is_final on parent.offers;
create trigger offers_removal_is_final
  before update on parent.offers
  for each row execute function parent.offers_removal_is_final();

-- THE SECOND LOCK ON A REVOKED LINK, and it is here because the first one was missed.
--
-- Every parent READ re-reads `learner.parent_links` and stops the moment a child revokes. The
-- one parent WRITE that did not was accepting an offer: a parent could create an offer, be cut
-- off by the child, and still POST the decision — putting one permanent sentence into the mind
-- of a child who had just removed them. Nothing in this file stopped it, so nothing in this file
-- was the whole rule. An offer may only become `accepted` while the link is live.
create or replace function parent.assert_offer_link_is_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    if not exists (
      select 1
      from parent.child_links cl
      join learner.parent_links pl on pl.id = cl.link_id
      where cl.parent_account_id = new.parent_account_id
        and cl.learner_id = new.learner_id
        and pl.learner_id = new.learner_id
        and pl.status = 'linked'
    ) then
      raise exception 'the link to learner % has ended, so nothing more may be passed on',
        new.learner_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function parent.assert_offer_link_is_live() from public;

drop trigger if exists offers_need_a_live_link on parent.offers;
create trigger offers_need_a_live_link
  before insert or update on parent.offers
  for each row execute function parent.assert_offer_link_is_live();

comment on table parent.offers is
  'A fact a parent offered to the child mind. The row outlives the child removing it, and the '
  'unique index on (learner_id, fact_key) is what stops a parent re-adding what a child removed.';


-- --------------------------------------------------------------------------------------------
-- parent.threads — the parent's conversation with Wobo, per child.
--
-- It is NOT the child's conversation and it never touches `learner.learner_threads`. One row per
-- (parent, child), so switching children cannot carry a word of the last one across.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.threads (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references parent.accounts (account_id) on delete cascade,
  learner_id uuid not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threads_messages_is_an_array check (jsonb_typeof(messages) = 'array')
);

create unique index if not exists threads_one_per_pair_idx
  on parent.threads (parent_account_id, learner_id);

drop trigger if exists threads_set_updated_at on parent.threads;
create trigger threads_set_updated_at before update on parent.threads
  for each row execute function parent.set_updated_at();


-- --------------------------------------------------------------------------------------------
-- parent.access_audit — ruling 6. Who looked, at what, when.
--
-- Append-only by grant and by trigger, the 0015 shape. `detail` is counts, ids and filters; it is
-- NOT a place to copy a child's content into, and nothing in the gateway writes free text from a
-- learner or from a parent into it.
-- --------------------------------------------------------------------------------------------
create table if not exists parent.access_audit (
  -- Monotonic, not a uuid: the first question of any investigation is "in what order", and a gap
  -- in this sequence is itself evidence.
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Denormalised on purpose. If the account row is deleted the trail must still say who.
  parent_account_id uuid not null,
  learner_id uuid,
  -- Dotted and lower case: 'children.list', 'child.switch', 'child.ask', 'child.report.read',
  -- 'mind.read', 'mind.write', 'offer.create', 'offer.accept'. Reads are in this list on purpose:
  -- the risk in a parent surface is somebody LOOKING.
  action text not null,
  decision text not null default 'allowed',
  method text,
  path text,
  status_code int,
  ip_hash text,
  detail jsonb not null default '{}'::jsonb,
  constraint access_audit_decision_is_known check (decision in ('allowed', 'denied')),
  constraint access_audit_action_is_short check (char_length(action) between 1 and 120),
  constraint access_audit_path_is_short check (path is null or char_length(path) <= 512),
  constraint access_audit_detail_is_an_object check (jsonb_typeof(detail) = 'object')
);

create index if not exists access_audit_at_idx on parent.access_audit (at desc);
create index if not exists access_audit_parent_idx
  on parent.access_audit (parent_account_id, at desc);
create index if not exists access_audit_learner_idx on parent.access_audit (learner_id, at desc);
create index if not exists access_audit_denied_idx
  on parent.access_audit (decision, at desc) where decision = 'denied';

create or replace function parent.access_audit_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'parent.access_audit is append-only: % is refused', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists access_audit_no_update on parent.access_audit;
create trigger access_audit_no_update
  before update on parent.access_audit
  for each row execute function parent.access_audit_is_append_only();

drop trigger if exists access_audit_no_delete on parent.access_audit;
create trigger access_audit_no_delete
  before delete on parent.access_audit
  for each row execute function parent.access_audit_is_append_only();

-- Truncate sidesteps row triggers entirely, so it gets its own statement-level one.
drop trigger if exists access_audit_no_truncate on parent.access_audit;
create trigger access_audit_no_truncate
  before truncate on parent.access_audit
  for each statement execute function parent.access_audit_is_append_only();

comment on table parent.access_audit is
  'Append-only trail of every parent read of a child. Its own table rather than ops.admin_audit: '
  'that trail is the operator one, over every learner, readable only by an admin. This one is '
  'about one family and the person it protects is the child.';


-- --------------------------------------------------------------------------------------------
-- Row level security. On and FORCED for all six, so the table owner is bound too — and NO policy
-- for `authenticated` on any of them. That absence is deliberate and is the security model: the
-- four things a parent may do are enforced at the gateway's endpoints, and a table a parent's own
-- token could read would walk straight around them.
-- --------------------------------------------------------------------------------------------
alter table parent.accounts enable row level security;
alter table parent.accounts force row level security;
alter table parent.child_links enable row level security;
alter table parent.child_links force row level security;
alter table parent.selections enable row level security;
alter table parent.selections force row level security;
alter table parent.mind_facts enable row level security;
alter table parent.mind_facts force row level security;
alter table parent.offers enable row level security;
alter table parent.offers force row level security;
alter table parent.threads enable row level security;
alter table parent.threads force row level security;
alter table parent.access_audit enable row level security;
alter table parent.access_audit force row level security;

-- The service role, and nothing else. The audit keeps insert and select only: update and delete
-- are revoked from every role including this one, which is the first of the two locks on it.
grant select, insert, update, delete on parent.accounts to service_role;
grant select, insert, update, delete on parent.child_links to service_role;
grant select, insert, update, delete on parent.selections to service_role;
grant select, insert, update, delete on parent.mind_facts to service_role;
grant select, insert, update, delete on parent.offers to service_role;
grant select, insert, update, delete on parent.threads to service_role;
grant select, insert on parent.access_audit to service_role;
revoke update, delete on parent.access_audit from service_role;

-- PostgREST reaches a schema only when it is exposed. `parent` is added to the list beside
-- `learner`; every table in it is still closed to `anon` and `authenticated` by the grants above,
-- so exposing it costs nothing and is what lets the gateway's service-role calls select it with
-- the Accept-Profile header.
do $$
declare
  current_schemas text;
begin
  select coalesce(current_setting('pgrst.db_schemas', true), '') into current_schemas;
  if current_schemas is null or current_schemas = '' then
    current_schemas := 'public, learner';
  end if;
  if position('parent' in current_schemas) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L',
                   current_schemas || ', parent');
  end if;
exception
  when insufficient_privilege or undefined_object then
    -- A managed project where the role cannot be altered from a migration: the schema list is
    -- set in the dashboard instead. Say so rather than failing the whole file.
    raise notice 'parent schema must be added to the PostgREST exposed schemas by hand';
end;
$$;

notify pgrst, 'reload schema';
