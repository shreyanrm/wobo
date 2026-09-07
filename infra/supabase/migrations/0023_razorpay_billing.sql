-- 0023 — the payment provider's ids on the subscription, and the billing ledger.
--
-- APPLIES AFTER 0014 (learner.subscriptions) and 0015 (the `ops` schema and its posture). Adds
-- four columns to learner.subscriptions and two tables to `ops`. Nothing in 0014 changes shape.
--
-- WHY. 0014 said, at its head, that a subscription has "the day a payment provider lands, that
-- provider's own ids beside them". That day is this file. The gateway now creates a Razorpay
-- subscription at checkout (services/gateway billing/payments.py) and Razorpay tells us what
-- became of it through signed webhooks. A webhook has to find the row it is about, the row has to
-- remember which provider subscription is charging it, and the cancel has to know which id to
-- tell the provider to stop. Those are the four columns.
--
-- THE PLAN STILL FLIPS ON EVIDENCE OF MONEY, NEVER ON A CHECKOUT. Checkout writes NOTHING to
-- learner.subscriptions. The row is written when the provider says `subscription.activated` or
-- `subscription.charged`, and `current_period_end` is taken from the provider's own `current_end`.
-- Until then a learner who opened a checkout and closed it is exactly as free as before.
--
-- ops.billing_events IS THE ONCE-ONLY. Razorpay retries a webhook it did not get a 2xx for, and a
-- replay is also the cheapest attack on a billing endpoint ("play the activation again after the
-- cancel"). The gateway checks the signature first, then asks this table whether it has seen the
-- event id. The UNIQUE constraint is the half of that promise the database keeps: two gateways,
-- or one gateway twice, cannot both insert the same event. The same table is the ledger the
-- console's subscriptions desk reads: every checkout, every webhook, every cancel, as a row.
--
-- ops.billing_config holds the four Razorpay plan ids, written once by the admin command
-- (`uv run python -m wobo_gateway.billing.plans`). A plan id is not a secret, but it IS the
-- record of which provider object we sell, and docs/MEMORY-LAW.md says the record lives in the
-- database and not in an environment variable somebody retypes.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No card, no amount owed, no invoice. Razorpay is the system of record for money; this
--     ledger records that an event happened and which learner it was about. `amount_paise` is the
--     figure the provider reported on a charge, kept so the desk can show it, and nothing here
--     could be used to move money in either direction.
--   * No refund. There is no refund column, no refund state and no refund event mapping. The owner's
--     ruling (DESIGN.md §0, cancel never refund) stands; a charge failure is `provider_status =
--     'halted'`, a state, and not a refund.
--   * No learner content. The ledger names a learner by the same opaque id 0014 uses, and the desk
--     shows a keyed digest of it, never the id.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- ---------------------------------------------------------------------------------------------
-- learner.subscriptions — the provider's ids, the period, and what the provider last said.
-- ---------------------------------------------------------------------------------------------
alter table learner.subscriptions
  add column if not exists period text not null default 'monthly';
alter table learner.subscriptions
  add column if not exists razorpay_subscription_id text;
alter table learner.subscriptions
  add column if not exists razorpay_plan_id text;
-- The provider's own word for the subscription: authenticated | active | pending | halted |
-- paused | completed | cancelled. Ours (`status`) stays active | cancelled, because ours is the
-- promise to the learner and the provider's is the state of a card. A `halted` here with an
-- `active` there is a learner whose card failed and who keeps the plan to the day already paid for.
alter table learner.subscriptions
  add column if not exists provider_status text;

alter table learner.subscriptions drop constraint if exists subscriptions_period_is_known;
alter table learner.subscriptions
  add constraint subscriptions_period_is_known check (period in ('monthly', 'yearly'));

-- One row per provider subscription. Partial, because the rows 0014 shipped with (and any an
-- operator writes by hand) carry no provider id at all.
create unique index if not exists subscriptions_razorpay_subscription_idx
  on learner.subscriptions (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

comment on column learner.subscriptions.period is
  'monthly | yearly. Which of the two prices in docs/PRICING.md this row was bought at.';
comment on column learner.subscriptions.razorpay_subscription_id is
  'The provider subscription charging this row, or null for a row with no provider behind it. '
  'The cancel tells the provider to stop this id at cycle end.';
comment on column learner.subscriptions.provider_status is
  'What the provider last said about its subscription. A state, never a refund: halted keeps the '
  'plan to the period already paid for.';

-- ---------------------------------------------------------------------------------------------
-- ops.billing_events — every checkout, webhook and cancel, once.
-- ---------------------------------------------------------------------------------------------
create schema if not exists ops;

create table if not exists ops.billing_events (
  id uuid primary key default gen_random_uuid(),
  -- The provider's event id (the X-Razorpay-Event-Id header), `checkout:<sub_id>` for a checkout,
  -- `cancel:<sub_id>:<time>` for a cancel. UNIQUE is the once-only.
  event_id text not null unique,
  kind text not null,
  -- The provider's event name (subscription.charged ...), or the gateway's own for the other two.
  event text not null,
  learner_id uuid,
  subscription_id text,
  plan text,
  period text,
  -- For a webhook: what the gateway did with it (applied | unmatched | ignored | no_period_end).
  -- For a checkout: the provider's status on the new subscription. For a cancel: 'cancelled'.
  status text,
  amount_paise bigint,
  received_at timestamptz not null default now(),
  constraint billing_events_kind_is_known
    check (kind in ('checkout', 'webhook', 'cancel'))
);

create index if not exists billing_events_received_idx on ops.billing_events (received_at desc);
create index if not exists billing_events_learner_idx
  on ops.billing_events (learner_id, received_at desc) where learner_id is not null;

-- Append-only, the shape of ops.admin_audit. A ledger a process can edit is not a ledger.
create or replace function ops.billing_events_are_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops.billing_events is append-only: % is refused', tg_op
    using errcode = 'insufficient_privilege';
end
$$;

drop trigger if exists billing_events_no_update on ops.billing_events;
create trigger billing_events_no_update
  before update on ops.billing_events
  for each row execute function ops.billing_events_are_append_only();

drop trigger if exists billing_events_no_delete on ops.billing_events;
create trigger billing_events_no_delete
  before delete on ops.billing_events
  for each row execute function ops.billing_events_are_append_only();

alter table ops.billing_events enable row level security;
revoke all on ops.billing_events from authenticated;
revoke all on ops.billing_events from anon;
grant all on ops.billing_events to service_role;

comment on table ops.billing_events is
  'Every checkout, provider webhook and cancel, once: event_id is unique, so a replayed webhook '
  'is refused by this constraint as well as by the gateway. Written by the gateway with the '
  'service role; read by the console''s subscriptions desk. Append-only.';

-- ---------------------------------------------------------------------------------------------
-- ops.billing_config — the provider plan ids, and nothing secret.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.billing_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table ops.billing_config enable row level security;
revoke all on ops.billing_config from authenticated;
revoke all on ops.billing_config from anon;
grant all on ops.billing_config to service_role;

comment on table ops.billing_config is
  'Small, non-secret billing configuration: the key razorpay_plans holds the four provider plan '
  'ids the admin command created (pro_monthly, pro_yearly, max_monthly, max_yearly). Never a key '
  'or a secret; those are environment variables on the gateway host and nowhere else.';

notify pgrst, 'reload schema';
