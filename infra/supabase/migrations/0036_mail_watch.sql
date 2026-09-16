-- 0036 — ops.mail_watch: what the deliverability watch learns, append-only; and its pause dial.
--
-- docs/MAIL-PRIMARY.md, "Watching where we land" (the owner, 2026-09-16): "we need to keep a track
-- if we went to spam or not", and "be tactical, dont slow down, and change whats necessary but make
-- sure i get alerted". The gateway keeps it (services/gateway src/wobo_gateway/mailwatch/). Five
-- kinds of fact land here, each with one natural key, which is the table's unique key:
--
--   delivery     the mail provider's signed delivery events (delivered, bounced, complained,
--                delayed, suppressed, failed), keyed on the provider's signed message id, so a
--                retried webhook is one row. Counted per day and per Feedback-ID kind.
--   suppression  an address that complained or hard-bounced, keyed on its DIGEST. It hears
--                nothing more but a sign-in code or a receipt. Primed at every start however old,
--                so a deploy never makes a complainer reachable again.
--   placement    a seed inbox's check: the send, then where it landed (a Gmail tab, the inbox, the
--                spam folder, or missing) and what SPF, DKIM and DMARC said.
--   postmaster   one day of Google Postmaster Tools (v2): the spam rate overall and per
--                Feedback-ID, the authentication rates, the compliance verdict.
--   alert        one cause in one hour, which is what "one bad hour is one alert" means as data.
--                The same alert is mailed to DELIVERABILITY_ALERT_TO and logged; this row is what
--                the console's mail desk shows, so an alert about mail never depends on mail alone.
--
-- NEVER AN ADDRESS. `to_hash` is the mail log's own non-reversible digest (0032), checked by
-- shape. There is no column for an address, a subject line, a body, a sender or a password, and
-- no open-tracking pixel, click rewrite or utm exists anywhere to be recorded: an open or click
-- event arriving at all is an alert that the provider's tracking was switched on, never a row.
--
-- APPEND-ONLY, ENFORCED TWICE — by grant and by trigger — as ops.mail_log (0032) and
-- ops.billing_events (0023) are. A suppression is lifted by nobody here; a person who asked us to
-- stop is not re-subscribed by a statement.
--
-- THE DIAL. ops.settings 'mail.kinds_paused' is the watch's own switch (the superadmin's is
-- mail_kinds_off, 0032): the kinds whose complaint rate crossed 0.10 percent, each with why and
-- since when. The gateway never pauses a sign-in code, a receipt or the owner's alert whatever the
-- dial says, and only the owner lifts a pause (POST /v1/admin/mail/unpause), which the settings
-- audit trigger (0024) records with the owner as its actor. Seeded empty, `on conflict do
-- nothing`, so a replay of this file never lifts a pause.
--
-- APPLIES AFTER 0015 (the ops schema, closed by default privilege), 0024 (ops.settings and its
-- audit trigger) and 0032. Additive and idempotent: applying it twice is a no-op. THE OWNER
-- APPLIES THIS; nothing in the repo applies a migration.

create schema if not exists ops;
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
grant usage on schema ops to service_role;


create table if not exists ops.mail_watch (
  -- Monotonic, not a uuid: the first question is "in what order", and a gap is itself evidence.
  id bigint generated always as identity primary key,
  -- When the row was written.
  at timestamptz not null default now(),
  -- When the fact HAPPENED: the provider's clock for an event, the job's handed-in clock for the
  -- rest. Every window the watch measures (the seven-day complaint rate) is on this column.
  happened_at timestamptz not null,
  what text not null,
  -- One per fact, for ever. The write asks PostgREST to ignore a duplicate of it.
  key text not null unique,
  -- The mail kind ("learning_note", "sunday_note", ...), or '' when the fact is about no one kind.
  kind text not null default '',
  -- What happened: the delivery event, the suppression's reason, the tab a seed landed in, the
  -- alert's cause.
  event text not null default '',
  -- The recipient, as a digest, when the fact is about one. NEVER an address.
  to_hash text,
  -- Everything that is one fact's business: the bounce type, the seed's inbox and folder and
  -- authentication, Google's numbers, the alert's message.
  detail jsonb not null default '{}'::jsonb,

  constraint mail_watch_what_is_known
    check (what in ('delivery', 'suppression', 'placement', 'postmaster', 'alert')),
  constraint mail_watch_key_is_short check (char_length(key) between 1 and 256),
  constraint mail_watch_kind_is_short check (char_length(kind) <= 64),
  constraint mail_watch_event_is_short check (char_length(event) <= 64),
  constraint mail_watch_to_hash_is_a_digest check (to_hash is null or to_hash ~ '^[0-9a-f]{8,64}$')
);

create index if not exists mail_watch_what_idx on ops.mail_watch (what, happened_at desc);
create index if not exists mail_watch_kind_idx on ops.mail_watch (kind, happened_at desc);
-- The one lookup a send makes, primed at start: is this address suppressed.
create index if not exists mail_watch_suppressed_idx
  on ops.mail_watch (to_hash) where what = 'suppression';

comment on table ops.mail_watch is
  'Append-only. What the deliverability watch learned: delivery events, suppressions, seed placements, Postmaster days, alerts. Never an address.';
comment on column ops.mail_watch.to_hash is
  'A non-reversible digest of the recipient, as in ops.mail_log. The raw address never lands here.';


-- --------------------------------------------------------------------------------------------
-- Append-only, by trigger as well as by grant.
-- --------------------------------------------------------------------------------------------
create or replace function ops.mail_watch_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'ops.mail_watch is append-only: % is refused', tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function ops.mail_watch_is_append_only() from public;

drop trigger if exists mail_watch_no_update on ops.mail_watch;
create trigger mail_watch_no_update
  before update on ops.mail_watch
  for each row execute function ops.mail_watch_is_append_only();

drop trigger if exists mail_watch_no_delete on ops.mail_watch;
create trigger mail_watch_no_delete
  before delete on ops.mail_watch
  for each row execute function ops.mail_watch_is_append_only();

-- Truncate sidesteps row triggers, and one truncate would make every complainer reachable again,
-- so it gets its own statement-level refusal (as ops.settings_audit does in 0024).
drop trigger if exists mail_watch_no_truncate on ops.mail_watch;
create trigger mail_watch_no_truncate
  before truncate on ops.mail_watch
  for each statement execute function ops.mail_watch_is_append_only();

-- Row level security on, and NO policy for `authenticated` or `anon`: every client role is denied
-- outright and the gateway's service role is the only reader (docs/OPERATIONS.md, "the findings
-- that are the design").
alter table ops.mail_watch enable row level security;
alter table ops.mail_watch force row level security;
revoke all on ops.mail_watch from authenticated;
revoke all on ops.mail_watch from anon;
grant select, insert on ops.mail_watch to service_role;
grant usage, select on all sequences in schema ops to service_role;


-- --------------------------------------------------------------------------------------------
-- The watch's pause dial, seeded empty.
-- --------------------------------------------------------------------------------------------
-- To lift a pause by hand (the console does this for the owner, with a note):
--   set the kind's "paused" to false and "lifted_at" to now() in the mail.kinds_paused value.
insert into ops.settings (key, value, description)
values (
  'mail.kinds_paused',
  '{}'::jsonb,
  'Kinds the deliverability watch paused because their complaint rate crossed 0.10 percent, each with why and since when. Only the owner lifts one. Sign-in codes and receipts are never paused.'
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
