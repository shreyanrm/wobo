-- 0024 — ops.settings: the live dials, and the two trails that keep them honest.
--
-- APPLIES AFTER the admin register (0015), which creates the `ops` schema and sets its posture:
-- everything in `ops` is revoked from `public`, `anon` and `authenticated` by default privilege,
-- so a table added here starts closed whichever file created it. This one adds three and changes
-- nothing about the schema.
--
-- WHY IT EXISTS, TODAY. `docs/DOORS-CLOSED.md`. The owner has closed the door on new accounts
-- until the web version has been walked, because 438 public pages are about to start earning
-- visitors and a person who arrives, signs up, and meets a tutor that is not ready is lost
-- permanently. The switch has to be A DIAL AND NOT A DEPLOY: the gateway re-reads it on a short
-- interval, so it goes back on in one statement with nothing released and nothing restarted.
--
-- WHY A TABLE OF DIALS RATHER THAN ONE `doors_open` COLUMN SOMEWHERE. Several queued designs
-- need exactly this shape and would otherwise each invent their own: the daily allowance
-- (docs/ALLOWANCE.md), the models desk (docs/CONSOLE-MODELS.md), the spend ceiling. A key and a
-- jsonb value is the smallest thing that serves all of them, and one audit trigger then covers
-- every dial anybody adds later rather than the one the author of the next wave remembers.
--
-- THE THREE RULINGS THIS FILE ENCODES:
--
-- 1. `doors_open` DEFAULTS TO FALSE, AND SO DOES EVERY WAY OF FAILING TO READ IT.
--    The seeded row below is `false`. The gateway (`services/gateway .../doors.py`) reads a
--    missing row, an unreachable database and an unconfigured deployment all as CLOSED. A door
--    that opens itself when the database blinks is not a door, and the only cost of being wrong
--    in this direction is a person who has to come back later.
--
-- 2. THE CHANGE AUDIT IS A TRIGGER, NOT A CODE PATH.
--    The owner turns this dial in the SQL editor. If the audit row were written by the gateway,
--    the one change that matters most would be the one change with no trail behind it. So the
--    trail is written by the database, on every insert and every update, whoever made it and
--    through whatever client.
--
-- 3. BOTH TRAILS ARE APPEND-ONLY, ENFORCED TWICE — by grant and by trigger — exactly as
--    `ops.admin_audit` is in 0015, and for the same reason: a record of what was switched that
--    the switcher can edit is not a record, it is a diary.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No `enabled boolean` per feature and no feature-flag framework. Three columns and a jsonb
--     value. The day a dial needs a rollout percentage is the day it earns a schema.
--   * No client-side read of any kind. The web app learns whether the door is open from the
--     gateway's own `GET /v1/doors`, never from the database, so the dial is never a value a
--     browser can be handed early or cached wrong.
--   * No row for any dial except this one. A key that nothing reads is a key somebody will
--     later assume something reads.
--
-- Additive and idempotent. Applying it twice is a no-op, and re-applying it does NOT re-open the
-- door: the seed is an `on conflict do nothing`.

-- 0015 and 0017 both create this; repeated so the file can be read and applied on its own.
create schema if not exists ops;
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
grant usage on schema ops to service_role;


-- --------------------------------------------------------------------------------------------
-- ops.settings — the live dials. One row per dial, read by the gateway on a short interval.
-- --------------------------------------------------------------------------------------------
create table if not exists ops.settings (
  -- Dotted or plain, lower case, and stable forever: it is read by name in code.
  key text primary key,
  -- jsonb rather than text, so a dial can be a boolean today and an object the day one needs to
  -- be (a ceiling with a currency, an allowance with a plan breakdown) without a migration.
  value jsonb not null,
  -- What this dial is, in one line, for the person who finds it at three in the morning.
  description text,
  -- The Supabase auth user id of whoever last turned it, when it was turned through a signed-in
  -- surface. Null when it was turned in the SQL editor, which is honest rather than a gap: the
  -- audit row below still records that it changed, and when.
  updated_by uuid,
  -- Why. Free text, and the one place in this table a person writes a sentence.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_key_is_a_name check (key ~ '^[a-z][a-z0-9_.]{0,63}$')
);

comment on table ops.settings is
  'Live dials, read by the gateway on a short interval. A change here takes effect without a deploy.';
comment on column ops.settings.value is
  'jsonb. doors_open is a boolean; a later dial may be an object without a migration.';


-- --------------------------------------------------------------------------------------------
-- ops.settings_audit — append-only. Every change to every dial, however it was made.
-- --------------------------------------------------------------------------------------------
create table if not exists ops.settings_audit (
  -- Monotonic, not a uuid: the first question is "in what order", and a gap is itself evidence.
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  key text not null,
  -- Both sides of the change, so a trail can be read without replaying it.
  old_value jsonb,
  new_value jsonb not null,
  -- Who, as well as we can know. `actor_subject` is what the row carried; `actor_role` is the
  -- database role that ran the statement, which is the half nobody can forge from a client.
  actor_subject uuid,
  actor_role text not null default current_user,
  note text,
  constraint settings_audit_key_is_short check (char_length(key) between 1 and 64)
);

create index if not exists settings_audit_at_idx on ops.settings_audit (at desc);
create index if not exists settings_audit_key_idx on ops.settings_audit (key, at desc);

comment on table ops.settings_audit is
  'Append-only trail of every dial change, written by trigger so a change made in the SQL editor is caught too.';


-- --------------------------------------------------------------------------------------------
-- ops.door_audit — append-only. Every refused attempt to create an account while the door is shut.
-- --------------------------------------------------------------------------------------------
--
-- WHY A SECOND TABLE, AND NOT A ROW IN settings_audit: a change is rare and deliberate and has a
-- before and an after; a refusal is frequent, anonymous, and has neither. Mixing them would make
-- the trail of the first unreadable inside the volume of the second.
--
-- WHAT IS NOT IN IT, and this is the point: no subject, no email address, no token, no body.
-- A refusal is a count and a shape, not a dossier on somebody who tried a door. `ip_hash` is the
-- same keyed digest the request log takes (app.py `_ip_fingerprint`), which answers "the same
-- caller or not" and answers nothing else.
--
-- The gateway COALESCES, and `attempts` is what makes that honest. The first refusal of a shape
-- is written at once, with `attempts` 1, so nothing is ever silently unrecorded; the rest of that
-- minute is held in the process and written as a SECOND row carrying its true count when the
-- window closes. This table is append-only, so a running total cannot be an update to the first
-- row, and two rows a minute is what append-only costs. Reading it, `sum(attempts)` is the number
-- of attempts and `count(*)` is the number of bursts.
--
-- Why not one row per attempt: an SDK retrying anonymously in a loop would write this table full,
-- and a door whose own audit is a denial-of-service amplifier is a door that gets switched off by
-- whoever is paged.
create table if not exists ops.door_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Which rule refused it, dotted and lower case, from a closed list the gateway shares:
  --   account_path — one of the named doors that creates an account
  --   anonymous    — the anonymous path the SDK uses, which is always a fresh account
  --   new_account  — a verified subject the product has never seen
  reason text not null,
  path text,
  ip_hash text,
  attempts int not null default 1,
  constraint door_audit_reason_is_known check (reason in ('account_path', 'anonymous', 'new_account')),
  constraint door_audit_path_is_short check (path is null or char_length(path) <= 512),
  constraint door_audit_ip_hash_is_a_digest check (ip_hash is null or ip_hash ~ '^[0-9a-f]{8,64}$'),
  constraint door_audit_attempts_is_positive check (attempts >= 1)
);

create index if not exists door_audit_at_idx on ops.door_audit (at desc);
create index if not exists door_audit_reason_idx on ops.door_audit (reason, at desc);

comment on table ops.door_audit is
  'Append-only. One row per refused account creation shape per minute. No subject, no address, ever.';


-- --------------------------------------------------------------------------------------------
-- The change audit, as a trigger. This is ruling 2.
-- --------------------------------------------------------------------------------------------
create or replace function ops.settings_write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An update that changes nothing is not a change, and a trail full of no-ops is a trail nobody
  -- reads. PostgREST upserts the whole row on every write, so this is not a rare case.
  if tg_op = 'UPDATE' and old.value is not distinct from new.value then
    return new;
  end if;
  insert into ops.settings_audit (key, old_value, new_value, actor_subject, actor_role, note)
  values (
    new.key,
    case when tg_op = 'UPDATE' then old.value else null end,
    new.value,
    new.updated_by,
    current_user,
    new.note
  );
  return new;
end;
$$;

revoke all on function ops.settings_write_audit() from public;

drop trigger if exists settings_audit_on_write on ops.settings;
create trigger settings_audit_on_write
  after insert or update on ops.settings
  for each row execute function ops.settings_write_audit();

-- `updated_at` moves with the value, so "when did this last change" is answerable from the
-- settings table alone without joining the trail.
create or replace function ops.settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists settings_set_updated_at on ops.settings;
create trigger settings_set_updated_at
  before update on ops.settings
  for each row execute function ops.settings_touch();


-- --------------------------------------------------------------------------------------------
-- Both trails are append-only, enforced twice. Ruling 3.
-- --------------------------------------------------------------------------------------------
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

drop trigger if exists settings_audit_no_update on ops.settings_audit;
create trigger settings_audit_no_update
  before update on ops.settings_audit
  for each row execute function ops.audit_is_append_only();

drop trigger if exists settings_audit_no_delete on ops.settings_audit;
create trigger settings_audit_no_delete
  before delete on ops.settings_audit
  for each row execute function ops.audit_is_append_only();

-- Truncate sidesteps row triggers entirely, so it gets its own statement-level one. Without this
-- the whole trail is one `truncate` away from gone.
drop trigger if exists settings_audit_no_truncate on ops.settings_audit;
create trigger settings_audit_no_truncate
  before truncate on ops.settings_audit
  for each statement execute function ops.audit_is_append_only();

drop trigger if exists door_audit_no_update on ops.door_audit;
create trigger door_audit_no_update
  before update on ops.door_audit
  for each row execute function ops.audit_is_append_only();

drop trigger if exists door_audit_no_delete on ops.door_audit;
create trigger door_audit_no_delete
  before delete on ops.door_audit
  for each row execute function ops.audit_is_append_only();

drop trigger if exists door_audit_no_truncate on ops.door_audit;
create trigger door_audit_no_truncate
  before truncate on ops.door_audit
  for each statement execute function ops.audit_is_append_only();


-- --------------------------------------------------------------------------------------------
-- Row level security. On for all three, and FORCED, so the table owner is bound too.
-- --------------------------------------------------------------------------------------------
alter table ops.settings enable row level security;
alter table ops.settings force row level security;
alter table ops.settings_audit enable row level security;
alter table ops.settings_audit force row level security;
alter table ops.door_audit enable row level security;
alter table ops.door_audit force row level security;

-- NO policy for `authenticated` on any of the three. The dial is read by the gateway with the
-- service role and served to the web app as one boolean on `GET /v1/doors`; a client that can
-- read this table can read every dial the product will ever have, including ones about money.
--
-- The one client-side read in `ops` stays what 0015 made it: an active admin reading
-- `ops.admin_audit`. The console reads these three through the gateway, like every other desk.


-- --------------------------------------------------------------------------------------------
-- Grants, one at a time, in writing.
-- --------------------------------------------------------------------------------------------
revoke all on ops.settings from public, anon, authenticated;
revoke all on ops.settings_audit from public, anon, authenticated;
revoke all on ops.door_audit from public, anon, authenticated;

-- The dials: the server reads and writes them. No delete: a dial is turned, never removed, and a
-- missing row reads as the least-privilege default, so deleting one is a silent switch.
grant select, insert, update on ops.settings to service_role;
revoke delete, truncate on ops.settings from service_role;

-- The trails: insert and select. Update and delete for nobody, service_role included — the
-- gateway itself is not trusted to rewrite what the gateway wrote.
grant select, insert on ops.settings_audit to service_role;
revoke update, delete, truncate on ops.settings_audit from service_role;
grant select, insert on ops.door_audit to service_role;
revoke update, delete, truncate on ops.door_audit from service_role;


-- --------------------------------------------------------------------------------------------
-- The seed. The door is CLOSED from now (docs/DOORS-CLOSED.md, owner 2026-09-09).
-- --------------------------------------------------------------------------------------------
-- `do nothing` on conflict, so re-applying this migration never re-opens a door somebody opened
-- on purpose, and never closes one either.
insert into ops.settings (key, value, description, note)
values (
  'doors_open',
  'false'::jsonb,
  'New accounts. False refuses every path that creates one. Existing accounts are unaffected.',
  'Closed for launch readiness. docs/DOORS-CLOSED.md.'
)
on conflict (key) do nothing;

-- TO OPEN THE DOOR, on the day the owner has walked the web version (docs/PLATFORMS.md), one
-- statement in the SQL editor. The gateway follows within under a minute, with nothing released:
--
--   update ops.settings
--      set value = 'true'::jsonb, note = 'walked the web version'
--    where key = 'doors_open';
--
-- And to shut it again, the same statement with 'false'. Either way the trigger above writes the
-- row in ops.settings_audit that says it happened.
