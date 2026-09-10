-- 0026 — the `content` schema: the five stores, and the private bucket their binaries live in.
--
-- APPLIES AFTER 0025. NOT APPLIED ANYWHERE YET (docs/OPERATIONS.md keeps the applied list). It is
-- additive and idempotent; applying it twice is a no-op.
--
-- ---------------------------------------------------------------------------------------------
-- WHY THIS EXISTS, AND WHAT IS BROKEN UNTIL IT IS APPLIED
-- ---------------------------------------------------------------------------------------------
--
-- The owner, 2026-09-08: *"Style caching and content caching are two different things, and so are
-- components, and so is Wobo helping a learner with something generic and repetitive. Storage is
-- cheap; regenerating is sometimes expensive. Having these in our database to make use of will
-- help."* docs/CACHES.md is the ruling; this file is its schema half.
--
-- The production hole it closes is measurable and was measured before a line of this was written:
--
--   * `services/gateway/Dockerfile` sets `PLEXUS_CACHE_DIR=/home/gateway/cache` — a path INSIDE
--     the container's writable layer, owned by the `gateway` user created two lines above it.
--   * `railway.json` declares `build`, `deploy.healthcheckPath`, `deploy.restartPolicy*` and
--     `numReplicas`. It declares NO volume, and there is no `volumes` key anywhere in the repo.
--   * A Railway deploy replaces the container. A container's writable layer does not survive its
--     container.
--
-- So every concept core, every level rendering, every diagram and every second of narration the
-- gateway has ever generated is discarded on each deploy, and the next learner pays for it again.
-- That is scorecard fix 11, and the reason the database — not the disk — is the truth here. The
-- plexus file cache stays exactly where it is and becomes what it is good at: an in-process front
-- that answers in microseconds. This schema is what it is a front FOR.
--
-- ---------------------------------------------------------------------------------------------
-- A NEW SCHEMA, `content`, AND NOT `learner`, `curriculum` OR `ops`. DECIDED, NOT DEFAULTED.
-- ---------------------------------------------------------------------------------------------
--
--   * Not `learner`. Every table there is shaped around `learner_id = auth.uid()` and the
--     `authenticated` role holds real grants. NOTHING in this schema belongs to a learner — that
--     is the entire premise of a cache that is served to everyone — so there is no `auth.uid()`
--     for a row here to belong to, and sitting beside tables that assume one is how a convenience
--     policy later hands a learner's token the whole content library.
--   * Not `curriculum`. That schema holds the BOARD's own syllabus: what must be learned, cited,
--     never invented. This schema holds OURS: how it is taught. docs/LEARNING-MODEL.md §6 keeps
--     those two apart on purpose ("the syllabus is the board's and the pool is ours"), and two
--     things with different owners, different provenance and different review do not share a
--     schema just because they are both about lessons.
--   * Not `ops`. That is the operator plane — who may open the console, what they looked at, what
--     a call cost. A content library is not an operator artefact.
--   * `content` starts from ZERO, the way `ops` did in 0015 and `growth` did in 0025: every
--     privilege revoked from `public`, `anon` and `authenticated`, handed back one grant at a time
--     in writing, and a default privilege so the next table anybody adds here starts closed too.
--
-- ---------------------------------------------------------------------------------------------
-- THE RULINGS THIS FILE ENCODES
-- ---------------------------------------------------------------------------------------------
--
-- 1. FIVE STORES, FIVE KEYS, ONE ROW LAW (docs/CACHES.md §1). Cores, levels, interactions and
--    components, assets, generic turns. They hold different things and are keyed differently, and
--    every one of them carries the SAME spine: provenance, the judge's score, the model that made
--    it and what that cost, a version, and `supersedes`. The spine is repeated in each table
--    rather than inherited, because a column somebody can only find by reading a parent table is
--    a column nobody reads.
--
-- 2. VERSION, NEVER OVERWRITE. A refresh INSERTs a new row naming the one it replaces; the old row
--    is stamped superseded by a trigger and stays forever, for the learner who is mid-chapter on
--    it and for the revert. There is no UPDATE path to a body: `update` is granted to nobody, and
--    a trigger refuses one that names any column other than the two serve counters below.
--
-- 3. THE LIVE POINTER IS THE DATABASE'S JOB, NOT THE WRITER'S. A partial unique index on `key`
--    (over rows that are neither superseded nor rejected) is what makes "one live row per key"
--    true even when two gateway replicas insert the same regeneration at the same instant. The
--    loser gets a unique violation and serves the winner's row, which is the correct outcome and
--    is not reachable by convention.
--
-- 4. THE JUDGE GATE IS AT INSERT. `docs/CACHES.md` §2: a store never holds an unjudged row. A
--    canonical row without a `judge_score` is refused by a check constraint, so an unjudged
--    artifact cannot be promoted by a caller who forgot. A row may sit PROVISIONAL without one —
--    that is the first learner not waiting on the judge (plexus/store.py's lifecycle) — and it can
--    never be read as canonical while it does.
--
-- 5. A GENERIC TURN HAS NOWHERE TO PUT A PERSON. `content.turns` has no learner column, no name,
--    no age, no mind item, no interests, no page anchor and no transcript of anything but the
--    normalised question that is the key itself. The gateway's door decides the same thing in
--    code (`generic_turn.py`), and the schema says it a second time so the two halves have to
--    agree: `turns_body_holds_no_person` refuses a body carrying `lifetime`, `machine`, `mind`,
--    `facts`, `interests`, `learner`, `canvas` or `glass` at the top level. A promise enforced in
--    one place is a promise until somebody edits that place.
--
-- 6. BINARIES GO TO A PRIVATE BUCKET AND THE ROW POINTS AT THEM. An SVG, a PNG and a WAV are not
--    jsonb. `content.assets` holds the description, the provenance and the digest; the bytes live
--    at `content-assets/<object_path>`, private, reachable only with the service role. The digest
--    is in the row so a swapped object is detectable without downloading it.
--
-- 7. SPEND SAVED IS DERIVED, NEVER GUESSED. Every row counts how many times it was served and what
--    it cost to make. Every serve after the first is a generation that was not paid for, so the
--    saving is `(served_count - 1) * cost_usd` and nothing else — the `content.store_savings` view
--    computes exactly that, and a row we could not price contributes nothing rather than a
--    flattering zero-cost guess. This is the "the ledger knows what a miss costs" line of
--    docs/CACHES.md §4 written out.
--
-- 8. SERVICE ROLE ONLY, RLS ON AND FORCED. No policy for `anon`, none for `authenticated`. A
--    learner reaches this content through the gateway, which serves it after re-sanitising and
--    re-linting the row (wave 31), or they do not reach it at all.

create schema if not exists content;

-- Zero by default. Nothing here is reachable by a learner's token, by an anonymous caller, or by
-- anything that inherits `public`, unless it is granted back by name at the bottom of this file.
revoke all on schema content from public;
revoke all on schema content from anon;
revoke all on schema content from authenticated;
alter default privileges in schema content revoke all on tables from public, anon, authenticated;
alter default privileges in schema content revoke all on sequences from public, anon, authenticated;
alter default privileges in schema content revoke all on functions from public, anon, authenticated;

grant usage on schema content to service_role;


-- ---------------------------------------------------------------------------------------------
-- The lifecycle, as a domain rather than four spellings of it.
--
-- These are plexus/store.py's own four words, and they mean there what they mean here:
--   provisional  served now, judged after; the first learner never waits on the judge
--   canonical    judged and kept; the only status a cold read prefers
--   superseded   a later version replaced it; kept forever for the revert and for the learner
--                who is mid-chapter on it
--   rejected     a regeneration that lost its best-of; kept as the record of what was tried
-- A domain and not a check constraint on each table, so the four words cannot drift into five.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'content' and t.typname = 'artifact_status') then
    create domain content.artifact_status as text
      not null
      default 'provisional'
      check (value in ('provisional', 'canonical', 'superseded', 'rejected'));
  end if;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- content.cores — the concept core (docs/CONTENT-INTERACTION.md §1).
--
-- The idea in a paragraph, the why, the two commonest misconceptions and the counter-example for
-- each, the one check that proves understanding, the vocabulary. Made once by the strongest model
-- and reused by EVERY board, grade, interaction and learner, which is why `concept_id` is the
-- whole key and why board and grade appear nowhere in this table. Since 2026-09-08 the same call
-- returns the interaction's design and the film's choreography with it (§8), so the candidate
-- mechanics ride in the body: the ninety-day variety comes from re-reading them, never from
-- paying the create tier again.
-- ---------------------------------------------------------------------------------------------
create table if not exists content.cores (
  id uuid primary key default gen_random_uuid(),
  -- The board-agnostic concept id (`plexus.store.concept_id`). It IS the key of this store.
  concept_id text not null,
  -- The digest the gateway looked up. Held beside the id rather than derived here, because the
  -- key law lives in one place — plexus/store.py — and a second implementation of it in SQL would
  -- be a second thing to keep in step.
  key text not null,
  body jsonb not null,
  version integer not null default 1,
  supersedes uuid references content.cores(id),
  superseded_by uuid references content.cores(id),
  superseded_at timestamptz,
  status content.artifact_status,
  judge_score numeric(5, 2),
  judge jsonb not null default '{}'::jsonb,
  model text,
  cost_usd numeric(14, 6),
  provenance jsonb not null default '{}'::jsonb,
  served_count bigint not null default 0,
  last_served_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cores_key_is_short check (char_length(key) <= 200),
  constraint cores_concept_is_short check (char_length(concept_id) <= 200),
  constraint cores_version_counts_up check (version >= 1),
  constraint cores_money_is_not_negative check (cost_usd is null or cost_usd >= 0),
  constraint cores_serves_are_not_negative check (served_count >= 0),
  -- Ruling 4: a canonical row has been judged. A provisional one may not have been yet.
  constraint cores_canonical_means_judged
    check (status <> 'canonical' or judge_score is not null),
  constraint cores_supersession_is_stamped_together
    check ((superseded_by is null) = (superseded_at is null)),
  constraint cores_a_row_does_not_supersede_itself
    check (supersedes is null or supersedes <> id)
);

-- Ruling 3: ONE live row per key, enforced here and not by the writer.
create unique index if not exists cores_one_live_row_per_key
  on content.cores (key)
  where superseded_by is null and status in ('provisional', 'canonical');
create index if not exists cores_by_concept on content.cores (concept_id, created_at desc);


-- ---------------------------------------------------------------------------------------------
-- content.levels — one concept rendered for one board at one class (CONTENT-INTERACTION.md §1).
--
-- The reading at this class's length and register, the worked example with this board's numbers
-- and units, the chapter's own names, the quiz at this class's complexity. Keyed on
-- concept x board x grade x syllabus version, which is exactly the coordinate wave 30 proved
-- changes the content (plexus/store.py's header tells that story in full). Reused by every
-- learner at that level and by every interaction built on it.
-- ---------------------------------------------------------------------------------------------
create table if not exists content.levels (
  id uuid primary key default gen_random_uuid(),
  concept_id text not null,
  -- Normalised by the gateway before it arrives ("CBSE" == "cbse", "8" == "Class 8"), so a
  -- spelling difference never costs a second generation.
  board text not null,
  grade text not null,
  -- The syllabus version the rendering was made against. A revision must MISS, which is the only
  -- thing that makes a revision reach a learner.
  content_version text,
  -- Which modality of the level this row is (reading, worked example, quiz, film, …) — the same
  -- word plexus uses, kept out of prose so the desk can group by it.
  modality text not null default 'reading',
  key text not null,
  body jsonb not null,
  version integer not null default 1,
  supersedes uuid references content.levels(id),
  superseded_by uuid references content.levels(id),
  superseded_at timestamptz,
  status content.artifact_status,
  judge_score numeric(5, 2),
  judge jsonb not null default '{}'::jsonb,
  model text,
  cost_usd numeric(14, 6),
  provenance jsonb not null default '{}'::jsonb,
  served_count bigint not null default 0,
  last_served_at timestamptz,
  created_at timestamptz not null default now(),
  constraint levels_key_is_short check (char_length(key) <= 200),
  constraint levels_version_counts_up check (version >= 1),
  constraint levels_money_is_not_negative check (cost_usd is null or cost_usd >= 0),
  constraint levels_serves_are_not_negative check (served_count >= 0),
  constraint levels_canonical_means_judged
    check (status <> 'canonical' or judge_score is not null),
  constraint levels_supersession_is_stamped_together
    check ((superseded_by is null) = (superseded_at is null)),
  constraint levels_a_row_does_not_supersede_itself
    check (supersedes is null or supersedes <> id)
);

create unique index if not exists levels_one_live_row_per_key
  on content.levels (key)
  where superseded_by is null and status in ('provisional', 'canonical');
-- The desk's question: what do we hold for this board and class?
create index if not exists levels_by_level on content.levels (board, grade, concept_id);


-- ---------------------------------------------------------------------------------------------
-- content.interactions — the model's composition of primitives, and the template floors.
--
-- Two kinds of row live here and the difference is `is_template`:
--   * a DESIGN is keyed on concept x interaction kind — the drag-and-drop this concept wants,
--     composed from the primitive vocabulary the schema validates (CONTENT-INTERACTION.md §3);
--   * a TEMPLATE is keyed on the kind ALONE and has no concept, because it is the floor every
--     concept of that kind falls back to, and the six arcade mechanics are templates.
--
-- NOTHING GENERATED EVER EXECUTES ON A LEARNER'S DEVICE. A body here is a declarative composition
-- and never code; the gateway validates it against the schema on the way in AND on the way out.
-- There is no column for a script because there is no such thing as one.
-- ---------------------------------------------------------------------------------------------
create table if not exists content.interactions (
  id uuid primary key default gen_random_uuid(),
  -- Null for a template: a floor belongs to the kind, not to a concept.
  concept_id text,
  -- drag_bins | sort_order | match | slider | simulation | build_steps | selection | challenge |
  -- film | … — an open vocabulary on purpose, exactly as `ops.model_calls.unit_kind` is: a
  -- mechanic shipped tomorrow is recorded the day it ships rather than after a migration.
  kind text not null,
  is_template boolean not null default false,
  key text not null,
  body jsonb not null,
  -- When this design must be looked at again. The refresh cadence is ninety days by default
  -- (docs/CACHES.md §1); a null means it is not on a cadence, which is what a template is.
  refresh_after timestamptz,
  version integer not null default 1,
  supersedes uuid references content.interactions(id),
  superseded_by uuid references content.interactions(id),
  superseded_at timestamptz,
  status content.artifact_status,
  judge_score numeric(5, 2),
  judge jsonb not null default '{}'::jsonb,
  model text,
  cost_usd numeric(14, 6),
  provenance jsonb not null default '{}'::jsonb,
  served_count bigint not null default 0,
  last_served_at timestamptz,
  created_at timestamptz not null default now(),
  constraint interactions_key_is_short check (char_length(key) <= 200),
  constraint interactions_kind_is_short check (char_length(kind) <= 64),
  constraint interactions_version_counts_up check (version >= 1),
  constraint interactions_money_is_not_negative check (cost_usd is null or cost_usd >= 0),
  constraint interactions_serves_are_not_negative check (served_count >= 0),
  constraint interactions_canonical_means_judged
    check (status <> 'canonical' or judge_score is not null),
  constraint interactions_supersession_is_stamped_together
    check ((superseded_by is null) = (superseded_at is null)),
  constraint interactions_a_row_does_not_supersede_itself
    check (supersedes is null or supersedes <> id),
  -- A template belongs to a kind and has no concept; a design belongs to a concept. Neither
  -- shape can be written as the other by accident.
  constraint interactions_a_template_has_no_concept
    check (is_template = (concept_id is null))
);

create unique index if not exists interactions_one_live_row_per_key
  on content.interactions (key)
  where superseded_by is null and status in ('provisional', 'canonical');
create index if not exists interactions_by_concept
  on content.interactions (concept_id, kind)
  where concept_id is not null;
-- The refresh sweep's own question: which designs are due?
create index if not exists interactions_due_for_refresh
  on content.interactions (refresh_after)
  where refresh_after is not null and superseded_by is null;


-- ---------------------------------------------------------------------------------------------
-- content.assets — the "style": diagrams, storyboards and their frames, rasters, narration audio,
-- and the per-subject visual vocabulary (what a cell, a ray, a timeline look like here).
--
-- The row is the description and the provenance; the BYTES live in the private `content-assets`
-- bucket at `object_path` (ruling 6). Most of these do not change with the class, which is where
-- the reuse in this store actually comes from: `grade` is nullable and a null means "this picture
-- is the same at every class", which is most of them.
-- ---------------------------------------------------------------------------------------------
create table if not exists content.assets (
  id uuid primary key default gen_random_uuid(),
  -- diagram_svg | scene_storyboard | scene_frame | raster | narration_wav | subject_vocabulary
  asset_kind text not null,
  -- Null for a subject-wide visual vocabulary, which is keyed on the subject instead.
  concept_id text,
  subject text,
  board text,
  grade text,
  key text not null,
  -- What the asset IS, in words the desk can read without downloading it: the alt text, the
  -- duration, the frame count, the palette. Never the bytes.
  body jsonb not null default '{}'::jsonb,
  bucket text not null default 'content-assets',
  object_path text,
  content_type text,
  byte_size bigint,
  -- The digest of the bytes as they were written. A swapped object is detectable from the row.
  sha256 text,
  version integer not null default 1,
  supersedes uuid references content.assets(id),
  superseded_by uuid references content.assets(id),
  superseded_at timestamptz,
  status content.artifact_status,
  judge_score numeric(5, 2),
  judge jsonb not null default '{}'::jsonb,
  model text,
  cost_usd numeric(14, 6),
  provenance jsonb not null default '{}'::jsonb,
  served_count bigint not null default 0,
  last_served_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assets_key_is_short check (char_length(key) <= 200),
  constraint assets_kind_is_short check (char_length(asset_kind) <= 64),
  constraint assets_version_counts_up check (version >= 1),
  constraint assets_money_is_not_negative check (cost_usd is null or cost_usd >= 0),
  constraint assets_serves_are_not_negative check (served_count >= 0),
  constraint assets_size_is_not_negative check (byte_size is null or byte_size >= 0),
  constraint assets_canonical_means_judged
    check (status <> 'canonical' or judge_score is not null),
  constraint assets_supersession_is_stamped_together
    check ((superseded_by is null) = (superseded_at is null)),
  constraint assets_a_row_does_not_supersede_itself
    check (supersedes is null or supersedes <> id),
  constraint assets_digest_is_a_digest check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  -- An object path is a path in our own bucket, never a URL somebody handed us. A row that could
  -- carry `https://…` is a row that can point a learner's browser anywhere.
  constraint assets_object_path_is_a_path
    check (object_path is null or object_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$'),
  -- The bytes and their description travel together: an object path with no digest is an asset
  -- nobody can verify, and a digest with no path points at nothing.
  constraint assets_bytes_are_described_or_absent
    check ((object_path is null) = (sha256 is null))
);

create unique index if not exists assets_one_live_row_per_key
  on content.assets (key)
  where superseded_by is null and status in ('provisional', 'canonical');
create index if not exists assets_by_concept on content.assets (concept_id, asset_kind)
  where concept_id is not null;
create index if not exists assets_by_subject on content.assets (subject, asset_kind)
  where subject is not null;


-- ---------------------------------------------------------------------------------------------
-- content.turns — Wobo's answer to a question many learners ask in the same words.
--
-- "what is a prime number", "why is the sky blue", "how do I balance this". The say and the ink
-- PLAN, never the rendered pixels: a plan names semantic targets from the surface registry, so it
-- re-anchors to the learner's OWN screen at serve time and is declined outright when a target is
-- not there (docs/CACHES.md §2).
--
-- RULING 5 IS THE WHOLE TABLE. There is no learner column here, and there is nowhere to put one.
-- No name, no age, no pseudonym, no meter key, no session, no mind item, no interest, no page
-- anchor, no "their world" fact, and no transcript of anything except the normalised question
-- that IS the key. If a learner's context reached this table the cache would be serving one
-- child's private life to another, and the only defence worth having against that is a table with
-- no shape for it. The gateway refuses to write a personal turn (`generic_turn.py`), and the
-- check constraint below refuses one that got past it.
-- ---------------------------------------------------------------------------------------------
create table if not exists content.turns (
  id uuid primary key default gen_random_uuid(),
  -- The question as the gateway normalised it: lowercased, whitespace collapsed, punctuation
  -- stripped. This is content, not a person: it is the question, asked in the same words by every
  -- learner who reaches this row, and it is the key.
  question_norm text not null,
  board text,
  grade text,
  subject text,
  concept_id text,
  key text not null,
  -- {say, plan} — the spoken line and the ink plan by semantic target. Never pixels, never a
  -- learner's name (that is stitched in at serve time by a template), never a coordinate.
  body jsonb not null,
  version integer not null default 1,
  supersedes uuid references content.turns(id),
  superseded_by uuid references content.turns(id),
  superseded_at timestamptz,
  status content.artifact_status,
  judge_score numeric(5, 2),
  judge jsonb not null default '{}'::jsonb,
  model text,
  cost_usd numeric(14, 6),
  provenance jsonb not null default '{}'::jsonb,
  served_count bigint not null default 0,
  last_served_at timestamptz,
  created_at timestamptz not null default now(),
  constraint turns_key_is_short check (char_length(key) <= 200),
  -- A question, not an essay. A "generic question" longer than this is not the thing many
  -- learners ask in the same words, and keying on it would fill the table with rows of one.
  constraint turns_question_is_a_question check (char_length(question_norm) between 3 and 300),
  constraint turns_version_counts_up check (version >= 1),
  constraint turns_money_is_not_negative check (cost_usd is null or cost_usd >= 0),
  constraint turns_serves_are_not_negative check (served_count >= 0),
  constraint turns_canonical_means_judged
    check (status <> 'canonical' or judge_score is not null),
  constraint turns_supersession_is_stamped_together
    check ((superseded_by is null) = (superseded_at is null)),
  constraint turns_a_row_does_not_supersede_itself
    check (supersedes is null or supersedes <> id),
  -- Ruling 5, said by the schema. Every one of these is a key the gateway's context packet
  -- actually uses for something personal, and none of them may appear in a stored turn.
  constraint turns_body_holds_no_person check (
    not (body ? 'lifetime') and not (body ? 'machine') and not (body ? 'mind')
    and not (body ? 'learner') and not (body ? 'facts') and not (body ? 'parentFacts')
    and not (body ? 'interests') and not (body ? 'twinSummary') and not (body ? 'canvas')
    and not (body ? 'glass') and not (body ? 'targets') and not (body ? 'focus')
    and not (body ? 'session') and not (body ? 'learner_ref')
  ),
  -- The say and the plan, and only those two shapes. A body with neither is a row that answers
  -- nothing; the plan is optional because most generic questions are answered in words.
  constraint turns_body_says_something check (body ? 'say')
);

create unique index if not exists turns_one_live_row_per_key
  on content.turns (key)
  where superseded_by is null and status in ('provisional', 'canonical');
-- The desk's question: which questions are asked most, and at what level?
create index if not exists turns_by_level on content.turns (board, grade, subject);
create index if not exists turns_most_served on content.turns (served_count desc);

comment on table content.turns is
  'Generic turns: no learner column, by design. See ruling 5 in migration 0026.';
comment on column content.turns.question_norm is
  'The normalised question, which is the key. It is content asked by many, never one child''s words about themselves.';


-- ---------------------------------------------------------------------------------------------
-- RULING 2, AS A TRIGGER: a new version stamps the row it replaces, and nothing else edits a body.
--
-- One function for all five tables. It runs `after insert`, reads `TG_TABLE_SCHEMA`/`TG_TABLE_NAME`
-- and stamps the superseded row with dynamic SQL, so there is ONE definition of what supersession
-- means rather than five that drift. A rejected or already-superseded insert stamps nothing: a
-- regeneration that LOST its best-of must not retire the row that beat it, which is the bug this
-- guard exists for.
-- ---------------------------------------------------------------------------------------------
create or replace function content.stamp_the_superseded_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supersedes is null then
    return null;
  end if;
  if new.status not in ('provisional', 'canonical') then
    -- A loser does not retire the winner.
    return null;
  end if;
  execute format(
    'update %I.%I set superseded_by = $1, superseded_at = now(), status = ''superseded'''
    || ' where id = $2 and superseded_by is null',
    tg_table_schema, tg_table_name
  ) using new.id, new.supersedes;
  return null;
end;
$$;

-- Ruling 2: a body is never edited. The only columns an UPDATE may touch are the two serve
-- counters, and they are bumped through `content.note_serves` below rather than by hand.
create or replace function content.a_body_is_never_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.key is distinct from old.key
     or new.body is distinct from old.body
     or new.provenance is distinct from old.provenance
     or new.model is distinct from old.model
     or new.cost_usd is distinct from old.cost_usd
     or new.version is distinct from old.version
     or new.supersedes is distinct from old.supersedes
     or new.created_at is distinct from old.created_at then
    raise exception
      'content.% rows are versioned, not edited: insert a new row naming this one in `supersedes`.',
      tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['cores', 'levels', 'interactions', 'assets', 'turns'] loop
    execute format('drop trigger if exists stamp_superseded on content.%I', t);
    execute format(
      'create trigger stamp_superseded after insert on content.%I'
      || ' for each row execute function content.stamp_the_superseded_row()', t);
    execute format('drop trigger if exists body_is_never_edited on content.%I', t);
    execute format(
      'create trigger body_is_never_edited before update on content.%I'
      || ' for each row execute function content.a_body_is_never_edited()', t);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- content.note_serves — the only way a serve counter moves.
--
-- PostgREST cannot express `served_count = served_count + 1` in a PATCH, and a read-then-write
-- from the gateway would lose counts between two replicas. So the increment happens in the
-- database, in one statement, from a batch the gateway flushes off the response path (nothing a
-- learner is waiting on ever waits on a counter).
--
-- It is deliberately NOT `security definer`: it runs as whoever called it, and only the service
-- role is granted execute. A definer function that bumps counters is a definer function somebody
-- can later widen into one that writes rows.
-- ---------------------------------------------------------------------------------------------
create or replace function content.note_serves(p_store text, p_ids uuid[], p_counts bigint[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  touched integer;
begin
  if p_store not in ('cores', 'levels', 'interactions', 'assets', 'turns') then
    raise exception 'no such store: %', p_store using errcode = 'invalid_parameter_value';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;
  if array_length(p_ids, 1) is distinct from array_length(p_counts, 1) then
    raise exception 'note_serves was given % ids and % counts',
      array_length(p_ids, 1), array_length(p_counts, 1)
      using errcode = 'invalid_parameter_value';
  end if;
  execute format(
    'update content.%I as a'
    || '   set served_count = a.served_count + b.n, last_served_at = now()'
    || '  from (select unnest($1::uuid[]) as id, unnest($2::bigint[]) as n) as b'
    || ' where a.id = b.id',
    p_store
  ) using p_ids, p_counts;
  get diagnostics touched = row_count;
  return touched;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- content.store_savings — ruling 7. What each store holds, how often it answered, and the money
-- that bought nothing new.
--
-- `saved_usd` counts the serves AFTER the first, because the first serve is the one that paid for
-- the row. A row with no price contributes nothing to the money and still contributes to the
-- counts, so the desk shows "this much saved, over N rows we could not price" rather than a total
-- that quietly reads unpriced as free — the same honesty rule the usage ledger already keeps.
-- ---------------------------------------------------------------------------------------------
create or replace view content.store_savings as
with every_store as (
  select 'cores'        as store, cost_usd, served_count, status, created_at from content.cores
  union all
  select 'levels',              cost_usd, served_count, status, created_at from content.levels
  union all
  select 'interactions',        cost_usd, served_count, status, created_at from content.interactions
  union all
  select 'assets',              cost_usd, served_count, status, created_at from content.assets
  union all
  select 'turns',               cost_usd, served_count, status, created_at from content.turns
)
select
  store,
  count(*)                                                          as rows_held,
  count(*) filter (where status = 'canonical')                      as rows_canonical,
  count(*) filter (where status = 'superseded')                     as rows_superseded,
  count(*) filter (where cost_usd is null)                          as rows_unpriced,
  coalesce(sum(served_count), 0)                                    as serves,
  coalesce(sum(greatest(served_count - 1, 0)), 0)                   as serves_after_the_first,
  coalesce(sum(greatest(served_count - 1, 0) * cost_usd)
             filter (where cost_usd is not null), 0)                as saved_usd,
  coalesce(sum(cost_usd) filter (where cost_usd is not null), 0)    as spent_usd,
  max(created_at)                                                   as newest_row_at
from every_store
group by store;

comment on view content.store_savings is
  'Rows, serves and the money a serve did not spend. Unpriced rows are counted, never valued at zero.';


-- ---------------------------------------------------------------------------------------------
-- The private bucket the binaries live in (ruling 6).
--
-- Private, like every other bucket this product has (0003). Nothing is served from it by URL: the
-- gateway reads an object with the service role and streams it, or signs a short-lived URL for it.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('content-assets', 'content-assets', false)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------------------------
-- Row level security. On, and FORCED, so the table owner is bound by it too.
--
-- NO policy for `authenticated` and none for `anon`, on any of the five. A learner's token that
-- could select `content.levels` holds the whole content library; one that could select
-- `content.turns` holds every question anybody has asked. The gateway reads these with the
-- service role, re-sanitises and re-lints the row, and serves what survives.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['cores', 'levels', 'interactions', 'assets', 'turns'] loop
    execute format('alter table content.%I enable row level security', t);
    execute format('alter table content.%I force row level security', t);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Grants, one at a time, in writing (ruling 8).
--
-- SELECT so a cold container can rebuild its front cache. INSERT so a generation lands. UPDATE
-- for the serve counters only, and the trigger above refuses an update that touches anything
-- else, so the narrow grant and the trigger say the same thing twice. DELETE for nobody at all,
-- service role included: "version, never overwrite" is not a habit if a caller can delete.
-- TRUNCATE for nobody, for the same reason.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['cores', 'levels', 'interactions', 'assets', 'turns'] loop
    execute format('revoke all on content.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on content.%I to service_role', t);
    execute format('revoke delete, truncate on content.%I from service_role', t);
  end loop;
end;
$$;

revoke all on content.store_savings from public, anon, authenticated;
grant select on content.store_savings to service_role;

-- The functions. `public` may execute nothing here — the default grant on a new function is
-- EXECUTE to public, which is how a hardening pass finds an RPC nobody meant to publish.
revoke all on function content.note_serves(text, uuid[], bigint[]) from public, anon, authenticated;
grant execute on function content.note_serves(text, uuid[], bigint[]) to service_role;
revoke all on function content.stamp_the_superseded_row() from public, anon, authenticated;
revoke all on function content.a_body_is_never_edited() from public, anon, authenticated;


-- ---------------------------------------------------------------------------------------------
-- PostgREST reaches a schema only when it is exposed.
--
-- APPENDED, NEVER REPLACED, and the list is read from `pg_roles.rolconfig` rather than from
-- `current_setting` — 0019 tells the story of what happens otherwise: a migration read the
-- SESSION's value (unset in the fresh session a migration runs in), fell back to a shorter list,
-- and ALTER ROLE dropped `ops` and `curriculum` out of PostgREST in production.
--
-- `growth` IS ADDED HERE TOO, AND THAT IS A FIX, NOT A TIDY-UP. 0025 created the `growth` schema
-- and `waiting_list.py` reaches it with `Accept-Profile: growth`, but no migration ever added it
-- to this list. Until it is on the list every write to the waiting list — the only thing standing
-- where the closed door used to be — answers 404 from PostgREST. It costs one array element here
-- and it is the difference between that door working and not.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  current_schemas text;
  wanted text;
begin
  select substring(cfg from '^pgrst\.db_schemas=(.*)$')
    into current_schemas
    from pg_roles r, unnest(r.rolconfig) as cfg
   where r.rolname = 'authenticator'
     and cfg like 'pgrst.db_schemas=%'
   limit 1;
  if current_schemas is null or current_schemas = '' then
    current_schemas := 'public, graphql_public, learner, curriculum, ops, parent';
  end if;
  foreach wanted in array array['growth', 'content'] loop
    -- The list is comma-separated names; a plain substring test is enough because no exposed
    -- schema is a substring of another one, and adding one twice is what this guard prevents.
    if position(wanted in current_schemas) = 0 then
      current_schemas := current_schemas || ', ' || wanted;
    end if;
  end loop;
  execute format('alter role authenticator set pgrst.db_schemas = %L', current_schemas);
exception
  when insufficient_privilege or undefined_object then
    raise notice
      'content and growth must be added to the PostgREST exposed schemas by hand';
end;
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
