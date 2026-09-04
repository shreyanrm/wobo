-- 0014 — learner.subscriptions: which plan, does it renew, until when, and where it was bought.
--
-- The site already promises the cancel (apps/web-pwa/src/screens/plans/copy.ts): "Settings → Your
-- plan → Cancel. Two taps, no call, no 'are you sure' maze. You keep the plan until the month you
-- paid for ends." Nothing in the database could answer any part of that sentence. This is the
-- record behind it, and the owner's ruling of 2026-09-04 is why it could not wait: there are no
-- refunds, so cancelling is the only door out. A learner who can neither cancel nor be refunded is
-- trapped, and a promise a product cannot keep is worse than one it never made.
--
-- WHY A TABLE, AND NOT COLUMNS ON profiles_cache (decided, not defaulted):
--   1. profiles_cache is a CACHE and says so in 0002 — "cache of the governed identity/profile
--      view". Whatever refreshes it from that view may overwrite what it holds. A period a learner
--      has already paid for must not be rebuildable from an identity view that never knew about it.
--   2. profiles_cache carries one policy, `profiles_cache_own ... for all`, so the learner writes
--      their own row. A `current_period_end` there is a date the learner can extend, and a `plan`
--      there is a word the learner can set to the largest one the check constraint allows. A
--      separate table takes SELECT and nothing else; the gateway writes it with the service role.
--      (The same hole exists today on `profiles_cache.plan` itself. It is closed at the foot of
--      this file, which is the other half of making a subscription mean anything.)
--   3. A subscription has a lifecycle a profile cache has no room for: where it was bought, when
--      the paid period ends, when it was cancelled — and, the day a payment provider lands, that
--      provider's own ids beside them.
-- profiles_cache.plan STAYS, as the cheap denormalised read the meter already does. The
-- subscription is the record: services/gateway billing.py derives the EFFECTIVE plan from this
-- table at read time, so when the paid period ends the allowance falls back to free by itself —
-- no cron, no sweep, nothing to forget to run.
--
-- The learner is named `learner_id` here, as in 0010 and 0011 beside it (the erase path in
-- services/gateway memory.py already knows both spellings the schema uses).
--
-- The erase path is deliberately NOT extended to this table. `/v1/me/erase` is a learner taking
-- their memory back; deleting the record of a period they have paid for would end a plan with no
-- money coming back, which is exactly the trap this whole file exists to close. The row holds no
-- personal data beyond the opaque learner id, and a record of money taken is the kind of thing a
-- business is required to keep. If that is ever revisited, it is a decision, not a tidy-up.
--
-- Additive and idempotent. Applying it twice is a no-op.

create table if not exists learner.subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- One subscription per learner: cancel and resume then never have to guess which one is meant.
  learner_id uuid not null unique,
  -- What was bought. A free learner has NO ROW — 'free' is the absence of a subscription, not a
  -- subscription to nothing. 'plus' is the name the first paid tier shipped under and resolves to
  -- pro in the meter (services/gateway budget.py).
  plan text not null,
  status text not null default 'active',
  -- Where it was bought. A subscription sold inside a phone's app store is cancelled in that
  -- store, not by us, and the app must be able to say so instead of pretending: the endpoint
  -- refuses it with this value on the body so the right instruction can be shown.
  origin text not null default 'web',
  -- The end of the period ALREADY PAID FOR. Nothing is taken away before this moment, and after
  -- it nothing is granted: the meter reads it every time it needs a plan.
  current_period_end timestamptz not null,
  started_at timestamptz not null default now(),
  -- When the learner cancelled. Set once; cancelling twice does not move it, and does not move
  -- current_period_end either.
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_plan_is_a_paid_one
    check (plan in ('plus', 'pro', 'max')),
  constraint subscriptions_status_is_known
    check (status in ('active', 'cancelled')),
  constraint subscriptions_origin_is_known
    check (origin in ('web', 'ios', 'android')),
  constraint subscriptions_cancelled_has_a_time
    check (status <> 'cancelled' or cancelled_at is not null),
  constraint subscriptions_active_keeps_no_cancel
    check (status <> 'active' or cancelled_at is null)
);

-- `create table if not exists` is silent about a table that already exists with a DIFFERENT
-- shape: the whole block above would be a no-op while the profiles_cache changes at the foot of
-- this file still applied, leaving a half-migrated project that greps clean. So the shape is
-- checked rather than assumed, and a mismatch stops the transaction here with the column named.
do $$
declare
  missing text;
begin
  select string_agg(needed, ', ')
    into missing
    from unnest(array[
      'learner_id', 'plan', 'status', 'origin',
      'current_period_end', 'started_at', 'cancelled_at'
    ]) as needed
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'learner'
        and table_name = 'subscriptions'
        and column_name = needed
   );
  if missing is not null then
    raise exception
      'learner.subscriptions already exists without: %. 0014 will not half-apply over it.',
      missing;
  end if;
end
$$;

drop trigger if exists subscriptions_set_updated_at on learner.subscriptions;
create trigger subscriptions_set_updated_at before update on learner.subscriptions
  for each row execute function learner.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS: a learner reads their own subscription and no one else's — the shape of 0002, 0010 and
-- 0011. They write NONE of it. Cancelling is a POST to the gateway, which writes this row with
-- the service role, because a client that could write here could sell itself a plan: set the
-- word to 'max', push current_period_end into the next decade, and the meter would believe it.
-- 0002's default privileges hand `authenticated` all four verbs on every new table in this
-- schema, so the three writes are withdrawn explicitly rather than left to the missing policies.
-- ---------------------------------------------------------------------------------------------
alter table learner.subscriptions enable row level security;

drop policy if exists subscriptions_read on learner.subscriptions;
create policy subscriptions_read on learner.subscriptions for select to authenticated
  using (learner_id = auth.uid());

revoke insert, update, delete on learner.subscriptions from authenticated;
grant select on learner.subscriptions to authenticated;
grant all on learner.subscriptions to service_role;

comment on table learner.subscriptions is
  'The subscription record: which plan, active or cancelled, when the paid period ends, and '
  'where it was bought. Written by the gateway (billing.py) with the service role; read by the '
  'learner and by the meter, which derives the effective plan from current_period_end.';
comment on column learner.subscriptions.current_period_end is
  'The end of the period already paid for. The plan stays live until this moment and the '
  'allowance falls to free after it, whatever the status says.';
comment on column learner.subscriptions.origin is
  'web | ios | android. A store subscription is cancelled in the store, not by us.';

-- ---------------------------------------------------------------------------------------------
-- profiles_cache.plan — widen the constraint, and stop the learner writing it.
--
-- 0006 added `check (plan in ('free','plus'))`. budget.py now prices free, pro and max, and keeps
-- 'plus' only as a legacy alias for pro, so the constraint refused a value the product sells.
-- Every existing row is 'free' or 'plus'; both stay legal, so no row breaks.
--
-- And the grants. `profiles_cache_own` is `for all`, and 0002 grants `authenticated` update on
-- every table in the schema, so today any learner can PATCH their own row and hand themselves a
-- paid plan (or an elevated consent tier, which is a capability door). Table-level UPDATE cannot
-- be narrowed by revoking a column from it, so it is withdrawn and re-granted on exactly the
-- columns the client legitimately writes — the four the SDK's profile sync sends
-- (packages/sdk/src/client.ts syncProfile) plus the two 0006 added for cross-device restore.
-- INSERT is narrowed the same way, because an upsert writes the same columns on the way in.
-- SELECT and DELETE are untouched: the client's own erase path deletes these rows.
-- ---------------------------------------------------------------------------------------------
alter table learner.profiles_cache drop constraint if exists profiles_cache_plan_check;
alter table learner.profiles_cache drop constraint if exists profiles_cache_plan_is_known;
alter table learner.profiles_cache
  add constraint profiles_cache_plan_is_known check (plan in ('free', 'plus', 'pro', 'max'));

revoke insert, update on learner.profiles_cache from authenticated;
grant insert (subject_id, display_name, grade, board, archetype_slot, birthdate, interests)
  on learner.profiles_cache to authenticated;
-- subject_id IS IN THIS LIST ON PURPOSE, and it is not a hole: `profiles_cache_own` still scopes
-- every row to `auth.uid()`, so the only value a learner can write there is the one already
-- theirs. It is here because the app's only writer is an UPSERT — packages/sdk/src/client.ts
-- syncProfile posts { subject_id, display_name, grade, board } through SupabaseRest.upsert, which
-- sends `Prefer: resolution=merge-duplicates` with `?on_conflict=subject_id`. PostgREST turns that
-- into `insert ... on conflict (subject_id) do update set` over every column in the payload, and
-- Postgres requires UPDATE privilege on every column named in a SET list. Without subject_id the
-- update leg is refused with a 403 — and client.ts swallows it in a bare `catch {}` marked
-- best-effort, so display name, grade and board would stop syncing for every learner with an
-- existing row, silently and forever. The plan and the consent tier are what this migration is
-- withdrawing, and they are still withdrawn.
grant update (subject_id, display_name, grade, board, archetype_slot, birthdate, interests)
  on learner.profiles_cache to authenticated;

comment on column learner.profiles_cache.plan is
  'The denormalised plan the meter reads when a learner has no subscription row. Written by the '
  'service role only: learner.subscriptions is the record, and a learner cannot write either.';

notify pgrst, 'reload schema';
