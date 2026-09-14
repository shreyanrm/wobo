-- 0027 — promo codes: what a code grants, and the once-only record of who took it.
--
-- APPLIES AFTER 0014 (learner.subscriptions), 0015 (the `ops` schema and its posture) and 0023
-- (the billing ledger). Adds two tables to `ops` and widens exactly one check constraint on
-- `learner.subscriptions`. Nothing else changes shape.
--
-- WHY IT EXISTS. docs/ALLOWANCE.md §3: "Promo codes: create, list, disable. A code has a kind
-- (days of a plan free; extra allowance for N days; a percentage off the first payment), a value,
-- an expiry, a use limit, once per account, and an audit trail of who redeemed it." The owner
-- creates them in the console; a learner redeems one on You, or types one at checkout.
--
-- THE FOUR RULINGS THIS FILE ENCODES:
--
-- 1. ONCE PER ACCOUNT IS A UNIQUE INDEX, NOT A CHECK IN PYTHON.
--    A gateway with two replicas, or one replica answering a double-tap, will run the "have they
--    already?" read twice before either write lands. The partial unique index below is the half
--    of that promise the database keeps. The gateway still checks first, because a refusal with
--    a kind line is better than a refusal with a constraint violation — but the constraint is
--    what makes the answer true.
--
-- 2. `max_uses` IS COUNTED, NEVER DECREMENTED.
--    There is no `uses_left` column to drift away from the redemptions that actually happened.
--    The count is `count(*) from ops.promo_redemptions where code_id = ...`, which cannot
--    disagree with the trail because it IS the trail. The cost is one indexed count per redeem,
--    which is the correct price for a number about money.
--
-- 3. A REDEMPTION IS APPEND-ONLY AND CARRIES WHAT IT GRANTED, IN FULL.
--    `granted` is the resolved grant at the moment it was taken — the days, the plan, the paise,
--    the date it runs to — and not a pointer at the code. A code edited or disabled afterwards
--    must not be able to change the story of what somebody was already given. The code row is
--    disabled, never deleted, for the same reason: a redemption whose code has vanished is a row
--    that cannot be explained.
--
-- 4. `percent_off_first` CANNOT EXIST WITHOUT THE PROVIDER OBJECT THAT MAKES IT REAL.
--    A percentage off the first payment happens at the payment provider or it does not happen.
--    `provider_offer_id` is required for that kind (the check below), so a code that would show a
--    learner a discount and then charge them the full price cannot be created in the first place.
--    docs/ALLOWANCE.md: applied at checkout, NEVER as a refund.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No money column on a code and no currency on a redemption. A code grants days, paise of
--     daily allowance, or a percentage; it never moves money, in either direction.
--   * No `uses_left`, no `redeemed_count`, no cached tally of any kind. See ruling 2.
--   * No learner-readable policy. Both tables are `ops`: the gateway reads and writes them with
--     the service role, and a learner learns whether a code worked from the route's own answer.
--   * No free-text kind. Three kinds, in a check constraint, matching `wobo_gateway.promo.KINDS`.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- 0015, 0017, 0023 and 0024 all create this; repeated so the file can be read and applied alone.
create schema if not exists ops;
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
grant usage on schema ops to service_role;


-- ---------------------------------------------------------------------------------------------
-- learner.subscriptions — a fourth origin, because a promo row was not bought anywhere.
-- ---------------------------------------------------------------------------------------------
-- 0014 wrote `check (origin in ('web', 'ios', 'android'))`, and `billing.from_row` reads an
-- origin it does not recognise as a STORE origin — which would tell a learner holding a promo
-- code to go and cancel in an app store they never opened. So the word is added here rather than
-- borrowed from 'web': the row says what actually happened, and `billing.SOURCE_OF_ORIGIN` maps
-- it to 'web' on the wire, because `source` answers "where do I cancel this", and the answer for
-- a promo row is here.
alter table learner.subscriptions drop constraint if exists subscriptions_origin_is_known;
alter table learner.subscriptions
  add constraint subscriptions_origin_is_known
  check (origin in ('web', 'ios', 'android', 'promo'));

comment on column learner.subscriptions.origin is
  'web | ios | android | promo. Where the row came from. A promo row has no provider charging it '
  'and simply runs out at current_period_end; nothing renews it.';


-- ---------------------------------------------------------------------------------------------
-- ops.promo_codes — what a code is, what it grants, and when it stops being one.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.promo_codes (
  id uuid primary key default gen_random_uuid(),

  -- Stored in the one shape the gateway normalises to (`promo.normalise`): upper case, no
  -- spaces, A-Z 0-9 and the hyphen. Unique, so "the same code" is one row and never two.
  code text not null unique,

  -- plan_days            — N days of a named plan, free.
  -- allowance_boost_days — extra daily allowance (paise a day) for N days.
  -- percent_off_first    — a percentage off the first payment, applied at checkout.
  kind text not null,

  -- What `kind` means by a number. Days for plan_days; paise a day for allowance_boost_days;
  -- a whole percent for percent_off_first. One column rather than three nullable ones, with the
  -- range checked per kind below, because a value that means nothing for the kind it is on is a
  -- value somebody will one day read.
  value integer not null,

  -- How many days the boost runs for. Only allowance_boost_days uses it.
  days integer,

  -- Which plan plan_days grants. Only plan_days uses it.
  plan text,

  -- The provider offer that actually performs the discount. Required for percent_off_first
  -- (ruling 4) and forbidden on the other two, which never reach the provider at all.
  provider_offer_id text,

  -- Null means no expiry. A date in the past is how a code is retired without disabling it.
  expires_at timestamptz,

  -- Null means unlimited. Counted against ops.promo_redemptions, never decremented (ruling 2).
  max_uses integer,

  -- True: one redemption per account, ever, enforced by the partial unique index below.
  once_per_account boolean not null default true,

  -- The admin subject that created it, and the one that disabled it. Null when a row was written
  -- in the SQL editor, which is honest rather than a gap: ops.admin_audit still carries the act.
  created_by uuid,
  disabled_at timestamptz,
  disabled_by uuid,

  -- Why this code exists, in one line, for whoever finds it in six months.
  note text,
  created_at timestamptz not null default now(),

  constraint promo_codes_code_is_normalised
    check (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  constraint promo_codes_kind_is_known
    check (kind in ('plan_days', 'allowance_boost_days', 'percent_off_first')),
  constraint promo_codes_note_is_short
    check (note is null or char_length(note) <= 500),
  constraint promo_codes_max_uses_is_positive
    check (max_uses is null or max_uses >= 1),
  -- One constraint per kind, naming every column that kind may and may not carry. A code that
  -- half-describes itself cannot be inserted, so no reader downstream has to guess.
  constraint promo_codes_shape_matches_kind check (
    case kind
      when 'plan_days' then
        value between 1 and 366
        and days is null
        and plan in ('plus', 'pro', 'max')
        and provider_offer_id is null
      when 'allowance_boost_days' then
        value between 1 and 100000
        and days between 1 and 366
        and plan is null
        and provider_offer_id is null
      when 'percent_off_first' then
        value between 1 and 100
        and days is null
        and plan is null
        and provider_offer_id is not null
      else false
    end
  )
);

create index if not exists promo_codes_created_idx on ops.promo_codes (created_at desc);
create index if not exists promo_codes_live_idx
  on ops.promo_codes (code) where disabled_at is null;

comment on table ops.promo_codes is
  'What a promo code grants. Disabled, never deleted: a redemption whose code has vanished is a '
  'row nobody can explain. docs/ALLOWANCE.md section 3.';
comment on column ops.promo_codes.value is
  'Days for plan_days, paise a day for allowance_boost_days, a whole percent for '
  'percent_off_first. The range is checked per kind.';
comment on column ops.promo_codes.provider_offer_id is
  'The provider offer that performs the discount. Required for percent_off_first: a code that '
  'cannot actually take money off the first payment must not be creatable.';


-- ---------------------------------------------------------------------------------------------
-- ops.promo_redemptions — who took what, once. Append-only.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.promo_redemptions (
  id uuid primary key default gen_random_uuid(),

  -- The code as a row, and the code as it was typed. Both, on purpose: the id survives a rename
  -- and the text survives an operator reading the trail with no join in front of them.
  code_id uuid not null references ops.promo_codes (id) on delete restrict,
  code text not null,
  kind text not null,

  -- The learner. The console NEVER shows this: the desk shows the same keyed digest
  -- (`reports.handle`) every other desk shows, and this column exists so the gateway can answer
  -- "has this account already taken this code".
  learner_id uuid not null,

  -- Denormalised from the code so the partial unique index below can be per-code. A code whose
  -- once_per_account is later changed does not retroactively re-open the accounts that already
  -- took it, which is the correct direction for that mistake to fail in.
  once_per_account boolean not null default true,

  -- What was actually granted, resolved, at the moment it was taken (ruling 3). For plan_days:
  -- the plan, the days, the period end it produced. For allowance_boost_days: the paise a day,
  -- the days, the moment the boost stops. For percent_off_first: the percent, the provider
  -- subscription the discount was attached to.
  granted jsonb not null default '{}'::jsonb,

  -- The provider subscription a percent_off_first was attached to, so the owner can see which
  -- discounted checkouts actually converted. Null for the other two kinds.
  provider_subscription_id text,

  redeemed_at timestamptz not null default now(),

  constraint promo_redemptions_kind_is_known
    check (kind in ('plan_days', 'allowance_boost_days', 'percent_off_first'))
);

-- RULING 1. Partial, so a code whose `once_per_account` is false may be taken again by the same
-- account, and a code whose flag is true may not — enforced by the database and not by a read
-- that two replicas can both pass.
create unique index if not exists promo_redemptions_once_per_account_idx
  on ops.promo_redemptions (code_id, learner_id)
  where once_per_account;

create index if not exists promo_redemptions_code_idx
  on ops.promo_redemptions (code_id, redeemed_at desc);
create index if not exists promo_redemptions_learner_idx
  on ops.promo_redemptions (learner_id, redeemed_at desc);
create index if not exists promo_redemptions_at_idx
  on ops.promo_redemptions (redeemed_at desc);

comment on table ops.promo_redemptions is
  'Append-only: who took which code, when, and what it granted, resolved at that moment. The '
  'use count is count(*) over this table, so it can never disagree with the trail.';


-- ---------------------------------------------------------------------------------------------
-- Append-only, enforced twice — by grant and by trigger — as ops.settings_audit is in 0024.
-- ---------------------------------------------------------------------------------------------
-- 0024 defines this; repeated with `create or replace` so this file applies on its own too.
create or replace function ops.audit_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.% is append-only: % is refused', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists promo_redemptions_no_update on ops.promo_redemptions;
create trigger promo_redemptions_no_update
  before update on ops.promo_redemptions
  for each row execute function ops.audit_is_append_only();

drop trigger if exists promo_redemptions_no_delete on ops.promo_redemptions;
create trigger promo_redemptions_no_delete
  before delete on ops.promo_redemptions
  for each row execute function ops.audit_is_append_only();

-- Truncate sidesteps row triggers entirely, so it gets its own statement-level one.
drop trigger if exists promo_redemptions_no_truncate on ops.promo_redemptions;
create trigger promo_redemptions_no_truncate
  before truncate on ops.promo_redemptions
  for each statement execute function ops.audit_is_append_only();


-- ---------------------------------------------------------------------------------------------
-- Row level security. On for both, and FORCED, so the table owner is bound too.
-- ---------------------------------------------------------------------------------------------
alter table ops.promo_codes enable row level security;
alter table ops.promo_codes force row level security;
alter table ops.promo_redemptions enable row level security;
alter table ops.promo_redemptions force row level security;

-- NO policy for `authenticated` on either. A client that could read ops.promo_codes could read
-- every unredeemed code in the product, which is the whole value of a code; and a client that
-- could write ops.promo_redemptions could grant itself a plan. Both are read and written by the
-- gateway with the service role, and a learner learns whether their code worked from the route's
-- own answer and from nowhere else.


-- ---------------------------------------------------------------------------------------------
-- Grants, one at a time, in writing.
-- ---------------------------------------------------------------------------------------------
revoke all on ops.promo_codes from public, anon, authenticated;
revoke all on ops.promo_redemptions from public, anon, authenticated;

-- Codes: created, listed and disabled by the owner through the console. No delete: a code is
-- disabled, never removed, because a redemption pointing at nothing cannot be explained — and
-- the foreign key above (`on delete restrict`) refuses it a second time.
grant select, insert, update on ops.promo_codes to service_role;
revoke delete, truncate on ops.promo_codes from service_role;

-- Redemptions: insert and select. Update and delete for nobody, service_role included — the
-- gateway itself is not trusted to rewrite what the gateway wrote.
grant select, insert on ops.promo_redemptions to service_role;
revoke update, delete, truncate on ops.promo_redemptions from service_role;

-- No seed. A code that ships inside a migration is a code in a public repository.

notify pgrst, 'reload schema';
