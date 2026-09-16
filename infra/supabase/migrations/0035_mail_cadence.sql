-- 0035 — the weekly cadence: the good-news note's dial, and the ladder dial seeded (wave 56).
--
-- docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence" (the owner, 2026-09-16, revised the same
-- day): three a week is a FLOOR, and most of those are good news about the learner's own work;
-- behaviour earns more, up to one a day; a learner who stops coming is never dropped, and the mail
-- steps down with time away to once a month, which never ends. The gateway keeps it
-- (services/gateway src/wobo_gateway/hospitality/cadence.py). Two facts it reads are stored:
--
--   * learner.mail_preferences.learning_note — the good-news note is a kind of its own, with its
--     own switch and its own one-click stop (hospitality/tokens.py), exactly as the five nudges of
--     0033 are. It DEFAULTS TO TRUE like every dial before it, and `add column ... default true`
--     can switch nothing off. The row's RLS, own-row policies and trigger are 0010's, untouched.
--
--   * ops.settings 'mail.ladder' — the step-down, by days since the learner last came: the last
--     day away on each step but the last. [14, 30, 60, 90] is the owner's own: up to 14 days the
--     full cadence, 15 to 30 two a week, 31 to 60 one a week, 61 to 90 one a fortnight, and beyond
--     90 one a month for as long as the address is reachable. The gateway reads it through
--     dials.py (valid_mail_ladder: four whole days, rising, the last within a year; anything else
--     is ignored and the default used) and the console's activity desk shows it with its source.
--     Seeded with `on conflict do nothing`, so a dial the owner has already turned is never put
--     back by a replay of this file.
--
-- WHAT THE CADENCE READS, AND WHAT IT NEVER DOES. It reads when the learner last came and what
-- they did (learner.activity, 0034) to write their own mail about their own learning, and nothing
-- else: DPDP Act 2023 s.9(3) bars behavioural monitoring of a child for any other purpose. The
-- signal that a mail worked is whether the learner came back. There is no open-tracking pixel, no
-- click rewrite and no utm, and this file adds no column that could hold one.
--
-- Additive and idempotent. Applying it twice is a no-op.

alter table learner.mail_preferences
  add column if not exists learning_note boolean not null default true;

comment on column learner.mail_preferences.learning_note is
  'The good-news note: what the learner did, cracked or has next. The floor of the weekly cadence.';

-- To turn the step-down later, through the console or by hand with a note:
--   the key is mail.ladder, the value four rising whole days, for example [21, 45, 75, 120]
insert into ops.settings (key, value, description, note)
values (
  'mail.ladder',
  '[14, 30, 60, 90]'::jsonb,
  'The mail step-down by days since a learner last came: the last day away of each step but the last.',
  'The owner, 2026-09-16: full cadence to day 14, two a week to 30, one a week to 60, one a fortnight to 90, then one a month for good.'
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
