-- 0032 — ops.mail_log: every mail event, append-only, so the mail desk stands on something.
--
-- NUMBERING. docs/EMAILS-AND-ANIMATIONS.md §5 asks for this as "migration 0024". 0024 was taken
-- by ops.settings between that sentence being written and this file, 0025 and 0026 after it, and
-- 0027 through 0031 (promo codes, the allowance dials, the console owner, pace and pools, the
-- board change) by the waves that landed beside it, so this is 0032. Nothing else about the
-- design changes.
--
-- APPLIES AFTER the admin register (0015), which creates the `ops` schema and revokes it from
-- `public`, `anon` and `authenticated` by default privilege, so a table added here starts closed
-- whichever file created it.
--
-- WHY IT EXISTS. Today the mail log is a JSONL file (services/gateway .../email.py) on an
-- instance with no volume. Every record of a send, and every would-send held back by a missing
-- DNS record, dies on the next redeploy. Three laws rest on that log and all three are therefore
-- unenforceable across a deploy:
--
--   * the inbox law — no address hears from Wobo twice in twenty-four hours, read by address
--     from this log (docs/EMAILS-AND-ANIMATIONS.md §1);
--   * idempotency — the same (kind, recipient, period) is sent once, ever, which is what stops a
--     cron that fires twice from mailing a parent twice;
--   * the daily cap — the warm-up ceiling on a domain with no sending history, counted on the
--     day's rows (docs/MAIL-PRIMARY.md §5).
--
-- A mail desk cannot stand on a file that forgets. Neither can a spam rate.
--
-- WHAT IS IN A ROW, AND WHAT IS DELIBERATELY NOT. Never an address: `to_hash` is the same
-- non-reversible digest the logs take, which answers "the same recipient or not" and answers
-- nothing else. Our recipients are children and their guardians, and a durable table of who was
-- mailed when is exactly the kind of thing that must not exist. No subject line, no body, no
-- open pixel and no click-tracking id, because we have none of those either (§6: there is no
-- tracking pixel and no link rewriting, and children's mail must never carry them).
--
-- ONE TABLE FOR EVERY EVENT, not one per kind of event. A send, a held would-send, a click
-- measured at our own deep-link landing, an unsubscribe honoured, and the tab a seed-test mail
-- landed in are all "something happened to a mail of this kind at this time", and the desk asks
-- one question of them: what happened, per kind, over a window. Five tables would be five joins
-- and five migrations for the same answer.
--
-- APPEND-ONLY, ENFORCED TWICE — by grant and by trigger — exactly as `ops.billing_events` is in
-- 0023 and `ops.admin_audit` in 0015, and for the same reason: a record of what was sent that
-- the sender can edit is not a record, it is a diary.
--
-- Additive and idempotent. Applying it twice is a no-op. THE OWNER APPLIES THIS; nothing in the
-- repo applies a migration.

-- 0015 and 0017 both create this; repeated so the file can be read and applied on its own.
create schema if not exists ops;
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
grant usage on schema ops to service_role;


create table if not exists ops.mail_log (
  -- Monotonic, not a uuid: the first question is "in what order", and a gap is itself evidence.
  id bigint generated always as identity primary key,

  -- When the row was written. `sent_at` below is when the mail was STAMPED by the job that sent
  -- it, which is the clock the inbox law is measured on and is not always now: a pass replayed
  -- at a fixed moment must count against that moment, not against the container's.
  at timestamptz not null default now(),
  sent_at timestamptz not null,

  -- What happened. A closed list, checked, because the desk groups by it:
  --   sent        — it left, and the provider took it
  --   console     — rendered and logged, nothing left (the default transport in dev and CI)
  --   queued      — a would-send: held by config (no key, no postal line, no stop link, the
  --                 daily cap, an unverified sending domain). `detail->>'reason'` says which.
  --   click       — somebody opened the deep link in a mail of this kind, measured at our own
  --                 landing. Never a redirect and never a tracking pixel.
  --   unsubscribe — a one-click stop was honoured for this kind
  --   seed        — a seed-test mail, with the tab it landed in at `detail->>'tab'`
  event text not null,

  -- The mail kind ("sunday_note", "quick_one", …). Free text rather than an enum: a new kind is
  -- a deploy, and a migration to name it would be a migration nobody remembers to write.
  kind text not null,

  -- The idempotency key (kind:recipient-digest:learner:period). Unique for the events that must
  -- never repeat, which is what makes "sent once, ever" a database fact rather than a hope.
  key text,

  -- The subject the mail was ABOUT, when there is one. Text, not uuid: a subject id is whatever
  -- the identity provider minted, and this table must never refuse a row over its shape.
  learner_id text,

  -- The recipient, as a digest. NEVER an address.
  to_hash text not null,

  period text not null default '',

  -- The provider's id for a send, 'console', or 'queued'. Not a secret and not an address.
  provider_id text not null default '',

  -- Everything that is one kind's business: the held reason, the seed's tab, the click's path.
  detail jsonb not null default '{}'::jsonb,

  constraint mail_log_event_is_known
    check (event in ('sent', 'console', 'queued', 'click', 'unsubscribe', 'seed')),
  constraint mail_log_kind_is_short check (char_length(kind) between 1 and 64),
  constraint mail_log_key_is_short check (key is null or char_length(key) <= 256),
  constraint mail_log_to_hash_is_a_digest check (to_hash ~ '^[0-9a-f]{8,64}$'),
  constraint mail_log_period_is_short check (char_length(period) <= 64)
);

-- One row per idempotency key for the events that must never repeat. A click and an unsubscribe
-- carry no key, and two of those on the same mail are two facts, not a duplicate.
create unique index if not exists mail_log_key_once
  on ops.mail_log (key)
  where key is not null and event in ('sent', 'console', 'queued');

create index if not exists mail_log_sent_at_idx on ops.mail_log (sent_at desc);
create index if not exists mail_log_kind_idx on ops.mail_log (kind, sent_at desc);
-- The inbox law's own query: when did THIS address last hear from us, whatever it was about.
create index if not exists mail_log_recipient_idx on ops.mail_log (to_hash, sent_at desc);

comment on table ops.mail_log is
  'Append-only. Every mail event: sends, held would-sends, clicks, unsubscribes, seed placements. Never an address.';
comment on column ops.mail_log.to_hash is
  'A non-reversible digest of the recipient. The raw address never lands here.';


-- --------------------------------------------------------------------------------------------
-- Append-only, by trigger as well as by grant.
-- --------------------------------------------------------------------------------------------
create or replace function ops.mail_log_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'ops.mail_log is append-only: % is refused', tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function ops.mail_log_is_append_only() from public;

drop trigger if exists mail_log_no_update on ops.mail_log;
create trigger mail_log_no_update
  before update on ops.mail_log
  for each row execute function ops.mail_log_is_append_only();

drop trigger if exists mail_log_no_delete on ops.mail_log;
create trigger mail_log_no_delete
  before delete on ops.mail_log
  for each row execute function ops.mail_log_is_append_only();

alter table ops.mail_log enable row level security;
revoke all on ops.mail_log from authenticated;
revoke all on ops.mail_log from anon;
grant select, insert on ops.mail_log to service_role;
grant usage, select on all sequences in schema ops to service_role;


-- --------------------------------------------------------------------------------------------
-- The two dials this design needs, seeded so the desk has something to read on day one.
-- --------------------------------------------------------------------------------------------
-- `ops.settings` is 0024. Both rows are `on conflict do nothing`: re-applying this file never
-- resets a ceiling the owner has already raised.
insert into ops.settings (key, value, description)
values (
  'mail_daily_cap',
  '100'::jsonb,
  'How many mails may leave in one UTC day. The warm-up ceiling on a domain with no sending history; raised here, never in a deploy.'
)
on conflict (key) do nothing;

insert into ops.settings (key, value, description)
values (
  'mail_kinds_off',
  '[]'::jsonb,
  'Kinds the superadmin has switched off, by name. A kind nobody opens in a month is switched off here, not by a guess in code.'
)
on conflict (key) do nothing;
