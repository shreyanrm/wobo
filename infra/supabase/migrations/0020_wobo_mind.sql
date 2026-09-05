-- 0020 — Wobo's mind, in the database, against the account (docs/MEMORY-LAW.md).
--
-- The law, in the owner's own words: "Everything that user does in that account and everything
-- that user's memory has is the context for Wobo. We hold it in our database linked to their
-- account." The mind was the one thing that never followed the account. `store/mind.ts` said so
-- itself: "localStorage until the mind syncs through KGtoPG". The sync was intended and never
-- built, so the most personal thing in the product was the least portable — a learner signing in
-- on a second device got a Wobo that had forgotten who they were.
--
-- This is the record. The browser copy is a cache from here on.
--
-- WHAT THE COLUMNS ARE, and they are split by KIND because the merge rule differs by kind:
--
--   The learner's own words, removable one at a time on the memory page:
--     * interests — what they told onboarding they are into; grounds analogies
--     * facts     — durable details Wobo was told in conversation (a preferred name, an exam date)
--   What Wobo watched, derived and read-only on the memory page:
--     * latencies_ms — a rolling sample of answer times; the only consumer is a median
--     * slips        — recent wrong answers, each one the raw material of a detonation
--     * dwell_sec    — seconds per surface; which formats they linger on
--     * session_days — ISO dates they showed up; cadence
--     * days         — one ledger per day of what actually happened (the You screen's year)
--     * helped_at    — when help was last asked for after a miss
--   And the one column that exists only because two devices write:
--     * forgotten    — tombstones. A removal has to survive a merge with a device that still
--                      holds the item, or "clear this" would be undone by the next sync from a
--                      phone in a pocket. See `wobo_gateway.mind` for the whole merge rule.
--
-- BOUNDED IN THE DATABASE, not only in Python. A mind that grows forever is a prompt that costs a
-- fortune and a table nobody can read. Every cap below is a check constraint, so a bug in a client
-- or in the gateway cannot quietly let one learner's row grow without limit.
--
-- RLS is the shape of every neighbour in 0002 and 0005: one row per subject, `subject_id =
-- auth.uid()` on both sides of the policy, FOR ALL — so a client erase reaches it exactly the way
-- it reaches `learner.learner_state`.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- How many keys an object holds, as something a check constraint may call. Marked immutable
-- because it is: the same jsonb always has the same number of keys. A non-object counts zero
-- rather than raising, so the type check below is the thing that reports a bad shape.
create or replace function learner.jsonb_object_size(j jsonb)
returns integer language sql immutable strict parallel safe set search_path = '' as $$
  select case
    when jsonb_typeof(j) = 'object' then (select count(*)::integer from jsonb_object_keys(j))
    else 0
  end
$$;

-- The longest string in a json array, or in the array at a key, so a SIZE bound can be a check
-- constraint too. Immutable for the same reason as the one above: the same jsonb always answers
-- the same. A non-array, or a member that is not a string, counts zero rather than raising.
create or replace function learner.jsonb_max_text_len(j jsonb)
returns integer language sql immutable parallel safe set search_path = '' as $$
  select coalesce((
    select max(char_length(v))::integer
    from jsonb_array_elements(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) e(v0)
    cross join lateral (select case when jsonb_typeof(e.v0) = 'string' then e.v0 #>> '{}' end) t(v)
  ), 0)
$$;

-- How many members an array holds, zero for anything else (including a missing key).
create or replace function learner.jsonb_array_len(j jsonb)
returns integer language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(j) = 'array' then jsonb_array_length(j) else 0 end
$$;

create table if not exists learner.wobo_mind (
  subject_id uuid primary key,

  -- the learner's own words
  interests jsonb not null default '[]'::jsonb,
  facts jsonb not null default '[]'::jsonb,

  -- what Wobo watched
  latencies_ms jsonb not null default '[]'::jsonb,
  slips jsonb not null default '[]'::jsonb,
  dwell_sec jsonb not null default '{}'::jsonb,
  session_days jsonb not null default '[]'::jsonb,
  days jsonb not null default '{}'::jsonb,
  helped_at timestamptz,

  -- the tombstones that make a removal outlive a straggler device. DIGESTS, never the text:
  -- the record does not keep a copy of the sentence a learner asked it to forget.
  forgotten jsonb not null default '{}'::jsonb,

  -- when this account's mind was erased, and nothing else about the erase. A DELETE alone was
  -- not an erasure: the next ordinary sync from a phone that still held the old cache wrote the
  -- whole mind back, so forget-me undid itself. The row stays, emptied, holding this date, and a
  -- write stamped at or before it contributes nothing. It is the one thing a stale device has to
  -- be told, and it says nothing about the learner.
  erased_at timestamptz,

  -- the last few write ids. The counters are sent as deltas and added, so a write retried after
  -- a timeout would count twice; a write id already here is answered from the row instead.
  recent_writes jsonb not null default '[]'::jsonb,

  -- the writing device's own last-mutation stamp. Not the clock this row is ordered by (that is
  -- `updated_at`, set here); it is what the merge uses to break a tie on the one field that
  -- cannot be unioned, and it is the client's, so it is never trusted for anything else.
  client_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- shapes: an array is an array and an object is an object, or the row does not exist
  constraint wobo_mind_interests_is_an_array check (jsonb_typeof(interests) = 'array'),
  constraint wobo_mind_facts_is_an_array check (jsonb_typeof(facts) = 'array'),
  constraint wobo_mind_latencies_is_an_array check (jsonb_typeof(latencies_ms) = 'array'),
  constraint wobo_mind_slips_is_an_array check (jsonb_typeof(slips) = 'array'),
  constraint wobo_mind_session_days_is_an_array check (jsonb_typeof(session_days) = 'array'),
  constraint wobo_mind_dwell_is_an_object check (jsonb_typeof(dwell_sec) = 'object'),
  constraint wobo_mind_days_is_an_object check (jsonb_typeof(days) = 'object'),
  constraint wobo_mind_forgotten_is_an_object check (jsonb_typeof(forgotten) = 'object'),
  constraint wobo_mind_recent_writes_is_an_array check (jsonb_typeof(recent_writes) = 'array'),

  -- bounds, and each number is the one the client already keeps (store/mind.ts)
  constraint wobo_mind_interests_are_few check (jsonb_array_length(interests) <= 8),
  constraint wobo_mind_facts_are_few check (jsonb_array_length(facts) <= 12),
  constraint wobo_mind_latencies_are_few check (jsonb_array_length(latencies_ms) <= 60),
  constraint wobo_mind_slips_are_few check (jsonb_array_length(slips) <= 12),
  constraint wobo_mind_session_days_are_few check (jsonb_array_length(session_days) <= 30),
  constraint wobo_mind_dwell_is_few check (learner.jsonb_object_size(dwell_sec) <= 32),
  -- a year's view and a little over, the same window the client's ledger keeps
  constraint wobo_mind_days_are_a_year check (learner.jsonb_object_size(days) <= 380),
  constraint wobo_mind_recent_writes_are_few check (jsonb_array_length(recent_writes) <= 16),
  -- two lists of tombstones, and each has to outlive stragglers, not history. Four hundred is
  -- far past a year of ordinary tidying on the memory page; sixty-four was not, and the
  -- sixty-fifth clear used to put the first cleared item back.
  constraint wobo_mind_forgotten_is_bounded check (learner.jsonb_object_size(forgotten) <= 2),
  constraint wobo_mind_tombstones_are_bounded
    check (learner.jsonb_array_len(forgotten -> 'facts') <= 400
       and learner.jsonb_array_len(forgotten -> 'interests') <= 400),

  -- SIZE, not only count. Every cap above bounds how MANY items a row holds and none of them
  -- bounded how BIG one is, so a client's own token could PATCH twelve one-megabyte strings into
  -- its own row through PostgREST and the table would take them. The lengths below are the same
  -- ones the gateway applies (`wobo_gateway.mind.MAX_TEXT`, MAX_SURFACE, MAX_COUNT), so the
  -- database is not relying on the gateway to be the only writer.
  constraint wobo_mind_facts_are_short check (learner.jsonb_max_text_len(facts) <= 160),
  constraint wobo_mind_interests_are_short check (learner.jsonb_max_text_len(interests) <= 160),
  constraint wobo_mind_tombstones_are_digests
    check (learner.jsonb_max_text_len(forgotten -> 'facts') <= 16
       and learner.jsonb_max_text_len(forgotten -> 'interests') <= 16),
  constraint wobo_mind_write_ids_are_short check (learner.jsonb_max_text_len(recent_writes) <= 64),
  -- and the three objects whose members are not plain strings are bounded by the bytes they
  -- render to, which is the honest measure of what one learner's row can cost. `jsonb::text` is
  -- immutable, so this is a check constraint like any other.
  constraint wobo_mind_slips_are_small check (octet_length(slips::text) <= 4096),
  constraint wobo_mind_dwell_is_small check (octet_length(dwell_sec::text) <= 4096),
  -- a year of counters is the biggest thing here by far, and this is what it costs at the cap
  constraint wobo_mind_days_are_small check (octet_length(days::text) <= 131072)
);

drop trigger if exists wobo_mind_set_updated_at on learner.wobo_mind;
create trigger wobo_mind_set_updated_at before update on learner.wobo_mind
  for each row execute function learner.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS: a learner READS their own mind and ERASES it, and writes it through the gateway alone.
--
-- The first cut of this policy was `for all`, which let a learner's own token PATCH the row over
-- PostgREST — past the merge rule, past the tombstones, past the flattening that keeps a fact
-- from forging a line of the prompt. The two verbs a client genuinely needs are here and no more:
-- SELECT, so a client can read its own record, and DELETE, so the client-side erase
-- (`packages/sdk` `eraseRemoteData`, the path that runs when the gateway is unreachable) still
-- reaches this table. Writing is the gateway's, with the service role.
-- ---------------------------------------------------------------------------------------------
alter table learner.wobo_mind enable row level security;

drop policy if exists wobo_mind_own on learner.wobo_mind;
create policy wobo_mind_own on learner.wobo_mind for select to authenticated
  using (subject_id = auth.uid());

drop policy if exists wobo_mind_own_erase on learner.wobo_mind;
create policy wobo_mind_own_erase on learner.wobo_mind for delete to authenticated
  using (subject_id = auth.uid());

-- Explicit: 0002's default privileges may not cover a table created by a different role.
revoke all on learner.wobo_mind from authenticated;
grant select, delete on learner.wobo_mind to authenticated;
grant all on learner.wobo_mind to service_role;

-- Ruling 1 of migration 0019, on the most personal learner table there is. 0019 put the
-- cross-kind guard on `learner.learner_state` alone, so a parent account could still grow a full
-- mind row here — and a learner with no state row yet could still become a parent. One trigger
-- per learner table is the only version of that rule that is true.
drop trigger if exists wobo_mind_is_not_a_parents on learner.wobo_mind;
create trigger wobo_mind_is_not_a_parents
  before insert on learner.wobo_mind
  for each row execute function parent.assert_not_a_parent();

revoke all on function learner.jsonb_object_size(jsonb) from public;
revoke all on function learner.jsonb_max_text_len(jsonb) from public;
revoke all on function learner.jsonb_array_len(jsonb) from public;
grant execute on function learner.jsonb_object_size(jsonb) to authenticated, service_role;
grant execute on function learner.jsonb_max_text_len(jsonb) to authenticated, service_role;
grant execute on function learner.jsonb_array_len(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
