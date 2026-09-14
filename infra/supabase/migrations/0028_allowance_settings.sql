-- 0028 — the daily allowance's dials: generosity, the free day, and the rate.
--
-- APPLIES AFTER 0024, which created `ops.settings` (the dial), `ops.settings_audit` (the
-- append-only trail, written by TRIGGER so a change made in the SQL editor is caught too) and the
-- `settings_touch` trigger that moves `updated_at` with the value. This file adds three ROWS and
-- no schema: that is the whole point of a key/jsonb table, and 0024 said so when it chose one.
--
-- WHAT THESE THREE DIALS DO (docs/ALLOWANCE.md §1 and §4.2; the reader is
-- services/gateway/src/wobo_gateway/allowance.py, which re-reads them on a short interval and on
-- `POST /v1/admin/settings/apply`, so the owner moves them WITHOUT A DEPLOY):
--
--   daily allowance (paise) = plan amount x generosity / the days in the learner's own month
--
-- The learner never sees any of it. One bar on the You page, filled by a fraction, and the line
-- "Resets at midnight." The rupees live in the gateway's arithmetic and on the owner's desk, and
-- nowhere a learner or a parent can reach (the owner, 2026-09-08: "it's not money based at the
-- users' end; that is only for internal purposes").
--
-- WHY `do nothing` ON CONFLICT: re-applying this file must never quietly put a dial back to its
-- default after the owner has turned it. The seed is the STARTING position, not the position.
--
-- WHY EVERY VALUE HERE IS ALSO A DEFAULT IN THE CODE: a gateway whose database blinks must not
-- decide that nobody has an allowance today. `allowance.py` reads a missing row, an unreadable
-- one and a nonsense one all as the number below, which is the only direction of failure that
-- does not lock a child out of a product their family paid for.

-- --------------------------------------------------------------------------------------------
-- allowance.generosity — the fraction of the plan amount given as model spend, per plan.
-- --------------------------------------------------------------------------------------------
-- The owner, 2026-09-08: "users get at most a quarter of the plan amount they selected for that
-- month. A ₹2,000 plan gives ₹500 to spend, technically their monthly limit, but we don't show
-- that anywhere. 500 is just a start; we watch the pace."
--
-- An OBJECT and not a number, so Max can be made more generous than Pro without a migration and
-- without a deploy. A bare number is also accepted by the reader and sets every plan at once.
-- Out of range (zero, negative, above 1) is read as the default: a generosity of 4 would hand a
-- learner four times what they paid, and a generosity of 0 would lock out everyone who did pay.
--
--   update ops.settings set value = '{"pro": 0.25, "max": 0.35}'::jsonb,
--          note = 'max gets more, we are watching the pace'
--    where key = 'allowance.generosity';
insert into ops.settings (key, value, description, note)
values (
  'allowance.generosity',
  '{"pro": 0.25, "max": 0.25}'::jsonb,
  'The fraction of the plan amount given as model spend, per plan. docs/ALLOWANCE.md §1.',
  'The owner''s starting position: a quarter, with a 4x buffer behind it.'
)
on conflict (key) do nothing;


-- --------------------------------------------------------------------------------------------
-- allowance.free_daily_paise — the free plan's day, in paise. ₹5.
-- --------------------------------------------------------------------------------------------
-- Free is not a fraction of anything: a free learner pays nothing, and a quarter of nothing is
-- nothing. ₹5 a day is about three hundred short turns on Luna (the free lane, `routing.lane_tier`),
-- which is far more than a twenty-minute session uses — free has to IMPRESS, or it sells nothing.
-- The content a free learner meets is identical: what a plan buys is quantity, never quality.
--
-- Zero is a legal value and is honoured: it is how the owner closes the free lane in one statement
-- if the goodwill ever outruns the money, and the free pool cap on the console is the softer dial
-- for the same worry.
insert into ops.settings (key, value, description, note)
values (
  'allowance.free_daily_paise',
  '500'::jsonb,
  'The free plan''s daily allowance in paise (₹5). Not a fraction of anything. docs/ALLOWANCE.md.',
  'Five rupees a day, on Luna: roughly three hundred short turns.'
)
on conflict (key) do nothing;


-- --------------------------------------------------------------------------------------------
-- allowance.inr_per_usd — rupees to the dollar, for converting the ledger's USD.
-- --------------------------------------------------------------------------------------------
-- The ledger prices every call in USD because that is what the vendors bill in; the allowance is
-- in rupees because that is what the family paid in. One number joins them, and it is a DIAL and
-- not a constant, because an exchange rate that is hard-coded is a lie with a date on it.
--
-- 83 is the rate docs/OPERATIONS.md §11.3 prices a turn at ("about 0.0078 USD, or roughly 0.65
-- rupees at 83 to the dollar"). The audit row records the day it was last moved, which is what
-- the console shows beside it.
insert into ops.settings (key, value, description, note)
values (
  'allowance.inr_per_usd',
  '83'::jsonb,
  'Rupees per US dollar, for converting the ledger''s cost into a learner''s allowance.',
  'The rate docs/OPERATIONS.md §11.3 prices a turn at. Move it when the rate moves.'
)
on conflict (key) do nothing;


-- --------------------------------------------------------------------------------------------
-- Reading the trail afterwards. Every change above leaves a row here, whoever made it and
-- however they made it (0024's trigger), which is what makes "how generous were we in July"
-- a question with an answer.
--
--   select at, key, old_value, new_value, actor_role, note
--     from ops.settings_audit
--    where key like 'allowance.%'
--    order by at desc;
