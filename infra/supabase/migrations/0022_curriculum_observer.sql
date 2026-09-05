-- 0022: the syllabus observer's anonymous counts (docs/CURRICULUM-OBSERVER.md §3, §6, §8).
--
-- APPLIES AFTER 0008 (the `curriculum` schema) and 0009 (the review queue's `kind`). Adds four
-- tables and two views to `curriculum`, and one value to the review queue's kind list. Nothing
-- in 0008 changes.
--
-- WHAT IT COUNTS. Every overlay op and every `not_my_syllabus` flag, per (version, node, op,
-- normalised value). The observer asks: of the learners on this syllabus, what share have done
-- the same thing to this chapter? When that share is large enough it re-reads the board's own
-- document; the document decides, never the count (§1, §5).
--
-- NEVER WHO. Neither table below holds a subject id. `voter_hash` and `learner_hash` are a keyed
-- one-way digest of the learner (HMAC under a server-side pepper, `observer.voter_hash`), the
-- same construction as `ops.reports.handle` and the usage ledger's pseudonym: enough to count a
-- learner once, not enough to name them, and not recomputable from the auth user table by anyone
-- reading these rows. The learner's overlay itself stays in `curriculum.overlays`, theirs under
-- the memory law; this is the count, and the count is ours.
--
-- ONE VOTE PER LEARNER PER (NODE, OP). The unique constraint on `observer_votes` is the poisoning
-- defence in the schema rather than in code: a hundred edits from one account are one row, and a
-- later edit of the same kind replaces it rather than adding to it (§6).
--
-- A VOTE COUNTS ONLY AFTER REAL USE. `observer_use` records that a learner had at least one turn
-- on a topic of that subject of that version. The `observer_signals` view joins votes to use, so
-- an account made to vote and never used counts for nothing. The rule lives in the view so the
-- gateway never sees a hash on a read and could not name a learner if it tried.
--
-- THE YEAR. Everything is keyed by `version_id`, and a new academic year is a new version, so
-- consensus from last year never reaches this year's chapters (§7).
--
-- Additive and idempotent. Applying it twice is a no-op.

create schema if not exists curriculum;

-- ---------------------------------------------------------------------------------------------
-- observer_use: one row per (version, subject, learner) once a learner has really used it.
-- ---------------------------------------------------------------------------------------------
create table if not exists curriculum.observer_use (
  version_id uuid not null references curriculum.versions(id) on delete cascade,
  subject_node_id uuid not null references curriculum.nodes(id) on delete cascade,
  learner_hash text not null,
  first_used_at timestamptz not null default now(),
  primary key (version_id, subject_node_id, learner_hash),
  constraint observer_use_hash_is_a_digest check (learner_hash ~ '^[0-9a-f]{32}$')
);

-- ---------------------------------------------------------------------------------------------
-- observer_votes: one learner's standing edit on one node of one version.
--   op          remove | add | rename | reorder | attach_textbook | flag
--   node_id     the chapter for remove/rename/attach; the PARENT for add/reorder; null for a flag
--               that named no chapter (it counts for the version and triggers nothing, §3)
--   value_key   the normalised value: the origin for remove (remove | not_in_my_school | flag,
--               told apart in the breakdown, §4), the normalised name for rename, kind:name for
--               add, the id order for reorder
--   node_key    node_id as text, '' when null, so the uniqueness below holds for a null node too
-- ---------------------------------------------------------------------------------------------
create table if not exists curriculum.observer_votes (
  version_id uuid not null references curriculum.versions(id) on delete cascade,
  subject_node_id uuid references curriculum.nodes(id) on delete cascade,
  node_id uuid references curriculum.nodes(id) on delete cascade,
  node_key text generated always as (coalesce(node_id::text, '')) stored,
  op text not null check (op in ('remove', 'add', 'rename', 'reorder', 'attach_textbook', 'flag')),
  value_key text not null default '',
  value_text text not null default '',
  voter_hash text not null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint observer_votes_one_per_learner unique (version_id, node_key, op, voter_hash),
  constraint observer_votes_hash_is_a_digest check (voter_hash ~ '^[0-9a-f]{32}$'),
  constraint observer_votes_value_is_bounded check (char_length(value_text) <= 200),
  -- A flag that named no chapter is the only vote with no subject; every other op names a node
  -- inside a subject.
  constraint observer_votes_op_has_a_node check (op = 'flag' or node_id is not null)
);

create index if not exists observer_votes_version_idx
  on curriculum.observer_votes (version_id, subject_node_id, node_key, op);

drop trigger if exists observer_votes_set_updated_at on curriculum.observer_votes;
create trigger observer_votes_set_updated_at before update on curriculum.observer_votes
  for each row execute function curriculum.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- observer_actions: what the observer did, on what signal, and the diff of anything it minted.
-- The console reads these (§8). `new_key` is the discovery record it minted, when it did.
-- ---------------------------------------------------------------------------------------------
create table if not exists curriculum.observer_actions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references curriculum.versions(id) on delete cascade,
  subject_node_id uuid references curriculum.nodes(id) on delete set null,
  action text not null check (action in
    ('reread_minted', 'reconciled_minted', 'community_minted', 'queued', 'queued_for_review',
     'nothing', 'budget_spent')),
  reason text not null,
  signal jsonb not null default '{}'::jsonb,
  dossier jsonb not null default '{}'::jsonb,
  new_key text,
  summary jsonb not null default '[]'::jsonb,
  diff jsonb,
  created_at timestamptz not null default now(),
  constraint observer_actions_reason_is_bounded check (char_length(reason) <= 1000)
);

create index if not exists observer_actions_version_idx
  on curriculum.observer_actions (version_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- observer_settings: the require-review switch (§8), default ON until the owner turns it off.
-- A missing row reads as ON; only an owner's write can make it OFF.
-- ---------------------------------------------------------------------------------------------
create table if not exists curriculum.observer_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- The two reads. A vote is counted only when its voter has real use on the same subject of the
-- same version (or, for a version-level flag, anywhere in the version). Distinct voters, never
-- rows, so the count is in learners. The gateway reads these views and never the vote rows.
-- ---------------------------------------------------------------------------------------------
create or replace view curriculum.observer_learners with (security_invoker = true) as
  select version_id, subject_node_id, count(*)::integer as learners
    from curriculum.observer_use
   group by version_id, subject_node_id;

create or replace view curriculum.observer_signals with (security_invoker = true) as
  select v.version_id,
         v.subject_node_id,
         v.node_id,
         v.op,
         v.value_key,
         min(v.value_text) as value_text,
         count(distinct v.voter_hash)::integer as votes
    from curriculum.observer_votes v
    join curriculum.observer_use u
      on u.version_id = v.version_id
     and u.learner_hash = v.voter_hash
     and (v.subject_node_id is null or u.subject_node_id = v.subject_node_id)
   group by v.version_id, v.subject_node_id, v.node_id, v.op, v.value_key;

-- ---------------------------------------------------------------------------------------------
-- The review queue takes a consensus dossier: a person decides when the document and the
-- learners disagree, or when review is required (§5.3, §8).
-- ---------------------------------------------------------------------------------------------
alter table curriculum.review_queue drop constraint if exists review_queue_kind_check;
alter table curriculum.review_queue add constraint review_queue_kind_check
  check (kind in ('node_flag', 'framework_offer', 'promotion_request', 'consensus'));

-- ---------------------------------------------------------------------------------------------
-- Locks. 0008 grants SELECT on every table in `curriculum` to `authenticated` by default
-- privilege, and none of these four is a learner's to read: a count of who edited what, even
-- under a digest, is an operator's object. Revoked by name, RLS on with NO policy (deny-all for
-- every role that does not bypass it), service role only. The views carry security_invoker, so
-- they inherit exactly these locks rather than the view owner's rights.
-- ---------------------------------------------------------------------------------------------
alter table curriculum.observer_use enable row level security;
alter table curriculum.observer_votes enable row level security;
alter table curriculum.observer_actions enable row level security;
alter table curriculum.observer_settings enable row level security;

revoke all on curriculum.observer_use from public, anon, authenticated;
revoke all on curriculum.observer_votes from public, anon, authenticated;
revoke all on curriculum.observer_actions from public, anon, authenticated;
revoke all on curriculum.observer_settings from public, anon, authenticated;
revoke all on curriculum.observer_learners from public, anon, authenticated;
revoke all on curriculum.observer_signals from public, anon, authenticated;

grant select, insert, update, delete on curriculum.observer_use to service_role;
grant select, insert, update, delete on curriculum.observer_votes to service_role;
grant select, insert, update on curriculum.observer_actions to service_role;
grant select, insert, update on curriculum.observer_settings to service_role;
grant select on curriculum.observer_learners to service_role;
grant select on curriculum.observer_signals to service_role;
-- DELETE on votes and use, deliberately: a learner un-marking "not in my school" withdraws their
-- vote (§3), and the DPDP erase path may clear a digest's rows. No DELETE on actions: what the
-- observer did is a record.

comment on table curriculum.observer_votes is
  'One learner''s standing edit on one node, under a keyed digest. Never a subject id. One row '
  'per (version, node, op, learner): a hundred edits from one account are one vote '
  '(CURRICULUM-OBSERVER.md §3, §6).';
comment on table curriculum.observer_use is
  'A learner had at least one turn on a topic of this subject of this version. A vote counts only '
  'joined to a row here (§6).';
comment on view curriculum.observer_signals is
  'Distinct voters with real use per (version, subject, node, op, value). The only thing the '
  'gateway reads to decide whether to re-read a document.';
comment on table curriculum.observer_actions is
  'What the observer did and on what evidence: re-read, minted, queued, nothing. Read by the '
  'console (§8).';
comment on table curriculum.observer_settings is
  'The require-review switch, default on. A missing row is on.';

notify pgrst, 'reload schema';
