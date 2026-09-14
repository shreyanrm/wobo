-- 0030 — the pace, and the two pools the platform pays for itself.
--
-- APPLIES AFTER 0018 (ops.model_calls, ops.usage_daily) and 0024/0028 (ops.settings and the
-- allowance dials). It adds ONE view and TWO dial rows and changes nothing that exists.
--
-- WHY IT EXISTS. docs/ALLOWANCE.md §3: "the pace — today's spend against today's allowance across
-- all learners; how many hit the bar and at what hour of their day; the median fraction used. This
-- is how the owner watches the pace." The console's models desk (docs/CONSOLE-MODELS.md) asks the
-- neighbouring question about the platform's own money: what did the creative pool cost today, and
-- what did the free lane cost today, each against a cap the owner can turn.
--
-- WHY A VIEW AND NOT A TABLE. ops.usage_daily is the permanent rollup and it deliberately does NOT
-- carry learner_ref: 0018 says so in its own header, because a distinct-learner count cannot be
-- summed and a per-learner row in a permanent table is a per-learner record nobody asked for. The
-- pace is a question about TODAY, and today's raw rows are in ops.model_calls for 45 days. So this
-- is a view over the raw rows, computed when it is asked for, holding nothing of its own — the
-- pace desk keeps no learner record that outlives the ledger's own retention.
--
-- WHAT IS IN IT AND WHAT IS NOT. learner_ref is the ledger's SALTED ONE-WAY PSEUDONYM of the meter
-- key (gateway `ledger.pseudonym`), never a subject id and never an address: enough to count
-- people and to notice a heavy account, and deliberately not enough to name anybody. There is no
-- capability here, no model, and no unit: "which learner studied what" is not a question this desk
-- is allowed to ask, and a view that could answer it would eventually be asked.
--
-- WHAT IT STILL CANNOT SAY, and this is the honest part. ops.model_calls carries a UTC `day` and
-- no time zone, so "at what LOCAL hour did a learner hit the bar" has no answer here. The gateway
-- (`pace.py`) prints that absence in words rather than showing a UTC hour under a heading that
-- says the learner's own. The allowance meter is what knows a learner's midnight
-- (`allowance.local_day`); the day it writes down the moment a learner meets the bar, that line
-- becomes a number and this file grows a column.
--
-- Additive and idempotent. Applying it twice is a no-op, and the two dial rows are seeded with
-- `on conflict do nothing`, so re-applying never overwrites a cap the owner has moved.

create schema if not exists ops;


-- --------------------------------------------------------------------------------------------
-- ops.learner_day — one row per (day, learner_ref, plan). The pace desk's only source.
-- --------------------------------------------------------------------------------------------
--
-- `security_invoker` so the view carries the caller's own rights rather than its owner's: the
-- gateway reads it with the service role and nothing else can reach the `ops` schema at all
-- (0015 revoked it from anon and authenticated by default privilege).
--
-- Delivery rows are excluded. They carry a unit the learner received and no provider charge, and
-- counting them as calls would inflate every per-call figure the desk derives — the same rule
-- ops.roll_up_usage keeps in 0018.
--
-- An unpriced call contributes NOTHING to cost_usd (coalesce to 0 would be a claim that it was
-- free), so `unpriced_calls` rides beside the money and the desk reads every total as a floor.
create or replace view ops.learner_day
with (security_invoker = true) as
  select
    c.day,
    c.learner_ref,
    c.plan,
    count(*) filter (where c.kind = 'model_call')                        as calls,
    count(*) filter (where c.kind = 'model_call' and c.cost_usd is null) as unpriced_calls,
    count(*) filter (where c.kind = 'model_call' and c.cache_hit)        as cache_hits,
    coalesce(sum(c.cost_usd) filter (where c.kind = 'model_call'), 0)    as cost_usd
  from ops.model_calls c
  where c.learner_ref is not null
  group by c.day, c.learner_ref, c.plan;

comment on view ops.learner_day is
  'One row per (day, learner_ref, plan) over the raw ledger, for the console''s pace desk only. '
  'learner_ref is a salted one-way pseudonym: enough to count learners, not enough to name one. '
  'Holds nothing of its own and expires with ops.model_calls (45 days).';

revoke all on ops.learner_day from public, anon, authenticated;
grant select on ops.learner_day to service_role;


-- --------------------------------------------------------------------------------------------
-- creative.pool.daily_usd — the platform's OWN cap, and the one pool no learner pays for.
-- --------------------------------------------------------------------------------------------
-- docs/ALLOWANCE.md, "Creative work is never on the allowance", and docs/CONSOLE-MODELS.md, "The
-- creative pool". `create.core` and `create.blueprint` run on GPT-6 Astra once per concept and are
-- then cached for every learner who ever opens that cell, so the cost is the platform's, paid
-- once, and per learner it rounds to nothing. The allowance code asks `registry.platform_paid`
-- before it counts anything, so these calls never touch a child's day.
--
-- 40 USD is the owner's starting figure. The console alerts at 50, 80 and 100 percent of it and
-- shows the day's creations, their cost and the cache hit rate beside it, so the impressive work
-- can be seen being paid for exactly once.
--
--   update ops.settings set value = '60'::jsonb, note = 'a heavier week of authoring'
--    where key = 'creative.pool.daily_usd';
insert into ops.settings (key, value, description, note)
values (
  'creative.pool.daily_usd',
  '40'::jsonb,
  'The platform''s own daily cap for the create tier, in USD. Never a learner''s allowance.',
  'The owner''s starting figure. Alerts at 50/80/100 percent on the models desk.'
)
on conflict (key) do nothing;


-- --------------------------------------------------------------------------------------------
-- free.pool.daily_paise — the day's ceiling on every free learner together.
-- --------------------------------------------------------------------------------------------
-- docs/ALLOWANCE.md, "Best of both worlds", point 4: "the owner's exposure is bounded twice. Per
-- learner by the daily allowance ... and in total by a free pool cap on the console: the day's
-- spend on free learners, with a dial and an alert, so growth cannot outrun the money."
--
-- SEEDED AS `null`, WHICH IS NOT ZERO AND NOT INFINITY. Null means no cap has been set, and the
-- desk prints those words; zero would close the free lane entirely and is a legal value the owner
-- can type. The document gives this dial no default, so neither does this file: a number invented
-- here would be a cap nobody chose, discovered by a free learner meeting it.
--
--   update ops.settings set value = '500000'::jsonb, note = 'five thousand rupees a day of goodwill'
--    where key = 'free.pool.daily_paise';
insert into ops.settings (key, value, description, note)
values (
  'free.pool.daily_paise',
  'null'::jsonb,
  'The day''s ceiling on all free learners together, in paise. null means no cap is set.',
  'docs/ALLOWANCE.md: growth must not outrun the money. Alerts at 50/80/100 percent.'
)
on conflict (key) do nothing;


-- --------------------------------------------------------------------------------------------
-- The tier dials are DELIBERATELY NOT SEEDED.
-- --------------------------------------------------------------------------------------------
-- `tier.<name>.primary`, `tier.<name>.chain` and `generation.ladder` (docs/CONSOLE-MODELS.md §3)
-- are read by the gateway (`dials.py`), and their ABSENCE is what means "the owner's table"
-- — routing.DEFAULT_TABLE, the nine rows of docs/OPERATIONS.md §11.1. Seeding them with the
-- defaults would make every tier look overridden on the desk and would turn "back to the owner's
-- table" into a row that has to be kept in step with the code by hand. The console writes a row
-- when the owner moves a tier and writes json `null` back when he clears it, which leaves a
-- proper before-and-after in ops.settings_audit that a delete would not.

notify pgrst, 'reload schema';
