-- 0018 — ops.model_calls and ops.usage_daily: the durable usage ledger.
--
-- NUMBERED 0018, and the number moved twice while this was being written: 0015, 0016 and 0017 were
-- claimed by the console's own migrations (the desks, the admin register and audit, the reports)
-- as they landed in the same wave. They share the `ops` schema with this file and every one of
-- them creates it `if not exists`, so the four apply in any order. This file owns the two USAGE
-- tables and touches nothing else in that schema. It is also the only migration in the repo that
-- adds `ops` to `pgrst.db_schemas`, which the console's tables need as much as these do — so if
-- this file is ever dropped, that line has to move rather than disappear.
--
-- WHY THIS EXISTS AT ALL. Until this file, nothing in the product remembered what a model call
-- cost. `services/gateway telemetry.py` appended a TelemetryEvent to an in-process deque and
-- `telemetry.record_cost` computed a dollar figure and wrote a log line. `spend.py` accumulated
-- the day's USD in a module-level float, and says so in its own header: a restart forgets the
-- day, and a second replica silently doubles the ceiling. `learner.meter_state` (0002) was
-- written by nothing at all. So the honest description of the system before this migration is:
-- the gateway knew what the current container had spent since it last started, and nobody could
-- ask it anything else. On Railway that means "since the last deploy".
--
-- Every question the owner asked of a superadmin console — what did we spend, on which models,
-- for which capability, how fast is a free allowance actually consumed, what does one free day
-- cost us — is a question about HISTORY. There is no way to answer any of them from a process
-- that forgets. This is the record those answers come from, and it starts EMPTY: nothing here is
-- backfilled, seeded or estimated, because a console that shows an invented number is worse than
-- one that shows none.
--
-- WHAT A ROW IS, AND WHAT IT IS NOT. A row is an ACCOUNTING RECORD: that a turn happened, which
-- model answered it, what it cost, how long it took, and what the learner got for it. A row is
-- NOT a transcript. There is no column here for a question, an answer, a prompt, a completion, a
-- concept, a title or a filename, and there must never be one — a table that can be joined into a
-- reading history of a child is a different and far more dangerous object than a bill. The
-- gateway enforces the same rule on the write side (`ledger.py` serialises a fixed field list and
-- its test asserts the list), so the promise is kept in two places rather than one.
--
-- The learner is present only as `learner_ref`, a salted one-way pseudonym of the meter key (see
-- `ledger.pseudonym`). It is enough to count distinct learners, to spot one account consuming an
-- unreasonable share, and — for an operator who already holds a subject id — to look that
-- learner's rows up by hashing it. It is not enough to turn a dump of this table back into a list
-- of who they were.
--
-- WHY A SEPARATE SCHEMA. `learner` is exposed to PostgREST for the app and carries RLS policies
-- that let a signed-in learner read their own rows. Not one byte of this belongs on that surface.
-- `ops` is exposed to PostgREST because the gateway's only database transport is PostgREST (it
-- has no direct Postgres driver — see services/gateway/pyproject.toml), but it is granted to
-- `service_role` and to nobody else: `anon` and `authenticated` get no USAGE on the schema and no
-- privilege on any table in it, so a learner's token reaching /rest/v1 with `Accept-Profile: ops`
-- is refused by Postgres before RLS is even consulted. RLS is then enabled on both tables with NO
-- POLICIES, which is deny-all for every role that does not bypass it. Two independent locks.
--
-- RETENTION, AND WHY THIS WINDOW. Raw rows live 45 DAYS and the daily rollup lives forever.
--   * 45 days, not 7: a provider invoice arrives monthly and can be weeks behind, and
--     reconciling a bill against our own count is the one job that genuinely needs per-call
--     granularity. 45 covers a full month plus the lag.
--   * 45 days, not forever: this table gains a row per model call. At even a modest scale that is
--     millions of rows a year, and a console that scans a year of them to draw a chart is a
--     console nobody opens twice.
--   * The rollup is kept indefinitely because it is small — bounded by
--     (days x capabilities x models x plans x unit kinds), a few hundred rows on a busy day — and
--     it is what pricing decisions are actually made from. Losing a year of daily totals to save
--     a megabyte would be a bad trade.
-- `ops.expire_model_calls` will not delete a day that has not been rolled up yet, so the window
-- can never silently eat history that was never summarised.
--
-- Additive and idempotent. Applying it twice is a no-op.

create schema if not exists ops;

-- Withdraw the defaults BEFORE anything is created in here. `public` holds CREATE and USAGE on a
-- new schema in older Postgres defaults, and Supabase grants its API roles broadly by habit; the
-- ledger opts out of all of it and then grants exactly one role back, at the foot of this file.
revoke all on schema ops from public;

-- ---------------------------------------------------------------------------------------------
-- ops.model_calls — one row per paid call, plus one row per thing delivered.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.model_calls (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- The UTC day, stored rather than derived, because every rollup and every retention sweep
  -- groups on it and an expression index over a timestamptz is a slower way to say the same
  -- thing. The gateway sends it; the default is here so a hand-written row cannot be dayless.
  day date not null default (now() at time zone 'utc')::date,

  -- 'model_call' is a call we paid a provider for. 'delivery' is a unit the learner received
  -- that carries no separate provider charge of its own — the seconds of finished video assembled
  -- from a plan we already paid for on its own row. Delivery rows exist so "how many video
  -- minutes did the free tier consume" is answerable; they are excluded from every call count and
  -- contribute no cost, and the rollup below depends on that being a closed set of two.
  kind text not null default 'model_call' check (kind in ('model_call', 'delivery')),

  capability text not null,
  track text,
  provider text,
  -- What the policy asked for, and who actually answered. They differ whenever a fallback took
  -- over, and the difference is the whole point: a chart drawn on the requested model is a chart
  -- of our intentions, not of our bill.
  model_requested text,
  model_served text,
  fallback_used boolean not null default false,

  tokens_in integer check (tokens_in is null or tokens_in >= 0),
  tokens_out integer check (tokens_out is null or tokens_out >= 0),

  -- NULL means we could not price it, and that is a fact worth storing rather than a zero worth
  -- inventing: a zero here would quietly understate the bill forever. `cost_source` says where
  -- the number came from — 'litellm' (its price table), 'configured' (a price an operator
  -- entered for a seam litellm does not know, e.g. Gemini TTS), 'unpriced' (we do not know), or
  -- 'no_provider_charge' (a delivery row). Deliberately NOT a check constraint: a vocabulary the
  -- database refuses is a write the gateway loses, and a lost accounting row is the failure this
  -- whole file exists to end. The four values above are the contract; the gateway is its keeper.
  cost_usd numeric(14, 6) check (cost_usd is null or cost_usd >= 0),
  cost_source text not null default 'unpriced',

  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  cache_hit boolean not null default false,

  -- Who was on the other end, at the coarsest grain that answers the question. `anonymous` and
  -- `plan` are what pacing is sliced by; `learner_ref` is the pseudonym described in the header.
  anonymous boolean not null default false,
  plan text not null default 'unknown',
  learner_ref text,

  -- THE UNIT. Without it, "usage pacing based on how much of the 1x uses the video minutes and
  -- messages and content" cannot be answered, because a turn and a two-minute narrated explainer
  -- are both "one call". Known kinds today: 'turn', 'generation', 'video_second',
  -- 'spoken_second', 'image'. NOT constrained, on purpose and for a reason with precedent: the
  -- gateway's meter classifies an unrecognised capability rather than ignoring it
  -- (services/gateway budget.py), so a capability shipped tomorrow is counted the day it ships. A
  -- check constraint here would turn that new unit into a rejected insert and a silently missing
  -- row.
  unit_kind text not null default 'turn',
  unit_count numeric(12, 3) not null default 1 check (unit_count >= 0)
);

-- The three questions this table is asked. Everything the console draws is a window over a day
-- range, optionally narrowed to a capability; the third index serves "show me this one account",
-- which is how an abuse question is answered.
create index if not exists model_calls_day_idx on ops.model_calls (day);
create index if not exists model_calls_day_capability_idx on ops.model_calls (day, capability);
create index if not exists model_calls_learner_idx on ops.model_calls (learner_ref, day)
  where learner_ref is not null;

comment on table ops.model_calls is
  'The raw usage ledger: one row per paid model call, plus delivery rows for units that carry no '
  'separate provider charge. An accounting record, never a transcript — no prompt, no completion, '
  'no concept, no title. Raw rows expire after 45 days; ops.usage_daily is the permanent record.';
comment on column ops.model_calls.learner_ref is
  'A salted one-way pseudonym of the meter key (gateway ledger.pseudonym), never a subject id. '
  'Enough to count learners and find a heavy account; not enough to name anybody.';
comment on column ops.model_calls.cost_usd is
  'NULL means unpriced, which is a fact. It is never written as 0 to make a chart tidy.';
comment on column ops.model_calls.unit_kind is
  'What the learner got for this call: turn | generation | video_second | spoken_second | image. '
  'Intentionally unconstrained so a capability shipped tomorrow is recorded the day it ships.';

-- ---------------------------------------------------------------------------------------------
-- ops.usage_daily — the precomputed rollup the console reads.
--
-- The console never does arithmetic over raw rows. Every panel the owner asked for (spend by day,
-- by model, by capability, by plan, and pacing by unit) is a filter and a sum over THIS table,
-- which is small enough to scan in full for any range a person would ask for.
--
-- Sums, never averages: `latency_ms_total` beside `calls` lets a reader compute a mean over any
-- grouping they choose, whereas a stored mean cannot be re-averaged across rows without lying.
-- Distinct-learner counts are deliberately absent for the same reason — a distinct count does not
-- add up, so the console computes it from the raw rows inside the 45-day window and says so
-- outside it, rather than showing a number that is wrong by construction.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.usage_daily (
  day date not null,
  capability text not null,
  model_served text not null,
  plan text not null,
  unit_kind text not null,

  calls bigint not null default 0,
  cache_hits bigint not null default 0,
  fallback_calls bigint not null default 0,
  anonymous_calls bigint not null default 0,
  -- Calls we could not put a price on. The console shows this beside the money so a total is
  -- always read as "this much, plus N calls we cannot price" rather than as the whole truth.
  unpriced_calls bigint not null default 0,
  -- Calls whose money came from a price an OPERATOR entered (ops.model_calls.cost_source =
  -- 'configured') rather than from a vendor price table. Kept as a count beside the money for the
  -- same reason as the line above: a figure that rests partly on somebody's typed-in guess should
  -- never be shown as though a provider had quoted it.
  configured_calls bigint not null default 0,

  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd numeric(16, 6) not null default 0,
  unit_count numeric(16, 3) not null default 0,
  latency_ms_total bigint not null default 0,

  rolled_at timestamptz not null default now(),
  primary key (day, capability, model_served, plan, unit_kind)
);

alter table ops.usage_daily add column if not exists configured_calls bigint not null default 0;

create index if not exists usage_daily_day_idx on ops.usage_daily (day);

comment on table ops.usage_daily is
  'The permanent rollup: one row per (day, capability, model, plan, unit kind). Rebuilt for a day '
  'by ops.roll_up_usage. Sums only — a stored average cannot be re-averaged, and a stored '
  'distinct count cannot be added up.';
comment on column ops.usage_daily.unpriced_calls is
  'Calls whose cost is unknown. Shown beside the money so a total is never read as the whole bill.';

-- ---------------------------------------------------------------------------------------------
-- ops.roll_up_usage(day) — rebuild one day's rollup from the raw rows.
--
-- Delete-then-insert for that day only, so it is idempotent and safe to run repeatedly while the
-- day is still filling. The gateway calls it on a cadence from its flush thread; pg_cron can call
-- it too, and neither needs to know about the other.
-- ---------------------------------------------------------------------------------------------
create or replace function ops.roll_up_usage(p_day date)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_rows integer;
begin
  -- Two gateway replicas both roll up on their own cadence, and delete-then-insert is not safe
  -- against itself: under READ COMMITTED the second transaction's DELETE never sees the rows the
  -- first one has just inserted, so both would insert and the loser would die on the primary key.
  -- One transaction-scoped advisory lock per day serialises them, and it is released on commit
  -- whatever happens. Concurrency is the reason this ledger exists rather than a process-local
  -- counter, so it has to be correct when a second replica starts.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ops.roll_up_usage:' || p_day::text));

  delete from ops.usage_daily where day = p_day;

  insert into ops.usage_daily (
    day, capability, model_served, plan, unit_kind,
    calls, cache_hits, fallback_calls, anonymous_calls, unpriced_calls, configured_calls,
    tokens_in, tokens_out, cost_usd, unit_count, latency_ms_total, rolled_at
  )
  select
    c.day,
    c.capability,
    coalesce(c.model_served, ''),
    c.plan,
    c.unit_kind,
    -- A delivery row is not a call. It carries the unit and nothing else, so counting it here
    -- would inflate every per-call figure the console derives.
    count(*) filter (where c.kind = 'model_call'),
    count(*) filter (where c.kind = 'model_call' and c.cache_hit),
    count(*) filter (where c.kind = 'model_call' and c.fallback_used),
    count(*) filter (where c.kind = 'model_call' and c.anonymous),
    count(*) filter (where c.kind = 'model_call' and c.cost_usd is null),
    count(*) filter (where c.kind = 'model_call' and c.cost_source = 'configured'),
    coalesce(sum(c.tokens_in), 0),
    coalesce(sum(c.tokens_out), 0),
    coalesce(sum(c.cost_usd), 0),
    coalesce(sum(c.unit_count), 0),
    coalesce(sum(c.latency_ms), 0),
    now()
  from ops.model_calls c
  where c.day = p_day
  group by c.day, c.capability, coalesce(c.model_served, ''), c.plan, c.unit_kind;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function ops.roll_up_usage(date) is
  'Rebuild ops.usage_daily for one day from ops.model_calls. Idempotent: safe to run repeatedly '
  'while the day is still filling.';

-- ---------------------------------------------------------------------------------------------
-- ops.expire_model_calls(keep_days) — the retention sweep.
--
-- Deletes raw rows older than the window, and ONLY for days that have already been rolled up. A
-- day the rollup never ran for is left alone however old it is: losing summarised detail is a
-- trade, losing history that was never summarised is data loss.
-- ---------------------------------------------------------------------------------------------
create or replace function ops.expire_model_calls(p_keep_days integer default 45)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_rows integer;
  v_cutoff date := ((now() at time zone 'utc')::date - greatest(p_keep_days, 1));
begin
  delete from ops.model_calls c
  where c.day < v_cutoff
    and exists (select 1 from ops.usage_daily d where d.day = c.day);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function ops.expire_model_calls(integer) is
  'Delete raw ledger rows older than the retention window, but only for days already rolled up.';

-- ---------------------------------------------------------------------------------------------
-- The locks.
--
-- Lock one: privileges. Only service_role — the key that lives in the gateway's environment and
-- never in a client bundle — can see this schema at all. A function's EXECUTE defaults to PUBLIC,
-- which would hand a rollup and a DELETE-shaped sweep to anyone with a token, so both are
-- revoked explicitly before being granted back to the one role that should hold them.
--
-- Lock two: RLS with no policies, which denies every role that does not bypass it. Belt and
-- braces on purpose: this table can see every learner in the product, and a grant edited by
-- accident in some later migration should not be the only thing standing in the way.
-- ---------------------------------------------------------------------------------------------
grant usage on schema ops to service_role;
grant all on ops.model_calls to service_role;
grant all on ops.usage_daily to service_role;

revoke all on schema ops from anon, authenticated;
-- 0015 grants USAGE on this schema to `authenticated` on purpose: `admin_audit_read` lets an admin
-- read their own trail through `ops.is_admin()`, and a policy cannot be reached without usage on
-- the schema holding it. The blanket revoke above would take that back and silently break the
-- audit read, so it is restored here. Table privileges stay revoked; usage on a schema grants
-- nothing by itself.
grant usage on schema ops to authenticated;
revoke all on ops.model_calls from anon, authenticated;
revoke all on ops.usage_daily from anon, authenticated;

revoke all on function ops.roll_up_usage(date) from public, anon, authenticated;
revoke all on function ops.expire_model_calls(integer) from public, anon, authenticated;
grant execute on function ops.roll_up_usage(date) to service_role;
grant execute on function ops.expire_model_calls(integer) to service_role;

alter table ops.model_calls enable row level security;
alter table ops.usage_daily enable row level security;

-- PostgREST selects a schema by header and only serves schemas listed here. `ops` joins the list
-- because the gateway has no other transport to Postgres; the grants above are what make that
-- safe. Every schema already exposed is repeated because this setting is replaced, not appended.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, learner, curriculum, ops';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
