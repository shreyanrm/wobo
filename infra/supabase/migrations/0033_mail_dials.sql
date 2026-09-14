-- 0033 — the five nudges get their five dials on the family's own row.
--
-- docs/EMAILS-AND-ANIMATIONS.md §1: "each kind is its own dial with its own one-click
-- unsubscribe". 0010 created `learner.mail_preferences` with three dials (the Sunday note, the
-- wins, the festival wishes); the five nudges of §1 need five more, because a family that wants
-- to hear when a photographed page is answered and not when a streak reaches seven must be able
-- to say exactly that. One switch labelled "fewer emails" is how a reader ends up pressing Block
-- instead, which is far worse than any tab (docs/MAIL-PRIMARY.md §2).
--
-- Every one DEFAULTS TO TRUE, exactly as the three before them do, and every one is flipped by
-- its own signed one-click link (services/gateway .../hospitality/tokens.py: one audience per
-- kind, so a click on the streak mail stops the streak mail and nothing else).
--
-- The row's RLS, its own-row policies and its `updated_at` trigger are 0010's and are untouched:
-- a learner still reads and updates only their own row, and still cannot delete it from a client.
--
-- Additive and idempotent. Applying it twice is a no-op, and it cannot switch anything off: an
-- `add column ... default true` writes true into every existing row.

alter table learner.mail_preferences
  add column if not exists quick_one boolean not null default true,
  add column if not exists mid_chapter boolean not null default true,
  add column if not exists streak boolean not null default true,
  add column if not exists bonus_level boolean not null default true,
  add column if not exists doubt boolean not null default true;

comment on column learner.mail_preferences.quick_one is
  'The five-minute nudge: two quiet days, at the hour they usually learn.';
comment on column learner.mail_preferences.mid_chapter is
  'A chapter left half done, a day later.';
comment on column learner.mail_preferences.streak is
  'Day three, day seven, day thirty, the morning after.';
comment on column learner.mail_preferences.bonus_level is
  'A side door opened on the climb. Optional, and it says so.';
comment on column learner.mail_preferences.doubt is
  'A photographed page is answered and the answer was not read live.';
