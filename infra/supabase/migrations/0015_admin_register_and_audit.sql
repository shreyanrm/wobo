-- 0015 — the admin register, the console session, and the append-only audit.
--
-- This is the security boundary of the operator console. Everything the console can see, it can
-- see because of a row in `ops.admins`; everything it does, it does inside a row in
-- `ops.admin_sessions`; and every one of those actions leaves a row in `ops.admin_audit` that the
-- person who took it cannot reach. The product serves children, so the console that can look at
-- all of them is the highest-value target in the system, and this file is written as if somebody
-- has already stolen a learner's phone, a learner's token, and one team member's laptop.
--
-- THE FOUR RULINGS THIS FILE ENCODES, each of which was a decision and not a default:
--
-- 1. AN ADMIN IS A ROW, NOT A CLAIM AND NOT AN ENVIRONMENT VARIABLE.
--    A JWT claim is minted by the auth server from the user's own metadata, and Supabase's
--    `user_metadata` is writable by the user it belongs to — `{"role":"admin"}` in a token would
--    be an authorisation the attacker fills in himself. An `ADMIN_EMAILS=` list in the environment
--    is barely better: it is edited by whoever can reach the deploy dashboard, it has no history,
--    it cannot say what a person may DO, and it cannot be revoked without a redeploy. So the
--    register is a table, in a schema the learner role cannot read, written only with the service
--    role, and every change to it is audited.
--
-- 2. A SEPARATE SCHEMA, `ops`, AND NOT `learner`.
--    Every table in `learner` is shaped around `learner_id = auth.uid()` and the `authenticated`
--    role holds real grants there. An admin register living beside them inherits that posture by
--    accident the first time somebody writes a convenience policy. `ops` starts from zero: all
--    privileges revoked from `public`, `anon` and `authenticated`, and handed back one grant at a
--    time, in writing, below.
--
-- 3. THE AUDIT IS APPEND-ONLY, ENFORCED TWICE.
--    Once by grant (UPDATE and DELETE are revoked from every role, service_role included) and once
--    by a trigger that raises on UPDATE or DELETE whoever is asking. Belt and braces, because the
--    thing this defends against is precisely the person who has the console's own credentials: an
--    admin who can edit the record of what he looked at has no audit at all, he has a diary.
--
-- 4. READS ARE AUDITED, NOT ONLY WRITES.
--    The risk in a console over children's data is somebody LOOKING. `action` therefore carries
--    reads (`learner.read`) alongside changes, and the gateway's admin router writes one row per
--    request rather than leaving it to the author of each endpoint to remember.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No password column, no password hash, no reset token. The factor is the product's existing
--     Supabase sign-in (services/gateway/src/wobo_gateway/auth.py verifies it), plus Supabase's own
--     TOTP at assurance level aal2. Inventing a second credential store would mean inventing a
--     second credential store to leak.
--   * No `is_admin boolean` on `learner.profiles_cache`. That table carries a policy the learner
--     writes through (`profiles_cache_own ... for all`), which would make admin-ness a column the
--     learner can set. It is the exact hole this file exists to avoid.
--   * No seeded rows. The first admin is one INSERT run by hand, and the template is at the foot
--     of this file, commented out, so that applying this migration grants nobody anything.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- `ops` is shared with 0017_ops_reports.sql (the intake wave), which also creates it if absent.
-- The grant posture below is set HERE, once, and the default privileges make it stick for every
-- table either wave adds: a new table in `ops` is closed to `public`, `anon` and `authenticated`
-- from the moment it exists, whichever file created it.
create schema if not exists ops;

-- Zero by default. Nothing in this schema is reachable by a learner's token, by an anonymous
-- caller, or by anything that inherits `public`, unless it is granted back by name below.
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
-- Future tables in this schema start closed too, so the next person to add one to `ops` does not
-- have to remember: a default grant is a rule, a remembered revoke is a hope.
alter default privileges in schema ops revoke all on tables from public, anon, authenticated;
alter default privileges in schema ops revoke all on sequences from public, anon, authenticated;
alter default privileges in schema ops revoke all on functions from public, anon, authenticated;

grant usage on schema ops to service_role;
-- The learner role gets USAGE on the schema and, further down, SELECT on exactly one table
-- (the audit) behind a policy that requires an active admin row. Nothing else in `ops` is
-- reachable with a learner token at any tier.
grant usage on schema ops to authenticated;


-- --------------------------------------------------------------------------------------------
-- ops.admins — who may open the console, and what they may do once they are in.
-- --------------------------------------------------------------------------------------------
create table if not exists ops.admins (
  id uuid primary key default gen_random_uuid(),
  -- The Supabase auth user id: the same value that arrives as the verified `sub` claim. One row
  -- per person, so a second grant to the same human is an UPDATE of their level, not a shadow row
  -- with a different one.
  subject_id uuid not null unique,
  -- The address the team knows each other by. Present because the register has to be
  -- administrable by a person ("who is 8f3c…?" is not a question an owner should have to answer
  -- with a database join), and because an audit trail that names only opaque ids is unreadable in
  -- the hour it matters. It is the ONLY personal detail in this schema.
  email text not null,
  -- What this person may do. Three levels, because "see the spend" and "change a learner's plan"
  -- are not one permission, and because somebody has to be able to add and remove the others:
  --   viewer   — may look. Every read desk in the console, and nothing that writes.
  --   operator — may look, and may act on a learner's support case, flag or plan.
  --   owner    — may look, may act, and may change this table.
  -- The gateway's permission map (admin_auth.py PERMISSIONS) is the readable half of this; the
  -- check constraint is the half that survives a bug in it.
  role text not null default 'viewer',
  -- Revocation without deletion. A removed admin's row stays `suspended` so their audit trail
  -- keeps a name beside it; deleting the row would leave the trail readable but anonymous.
  status text not null default 'active',
  -- Whether this person must present a second factor (Supabase TOTP, assurance level aal2) before
  -- a session opens. Defaults to true, and in prod the gateway refuses to turn it off at all.
  mfa_required boolean not null default true,
  -- Who granted this, so a surprise row has an author. Nullable only for the very first row,
  -- which by definition nobody granted from inside the console.
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Last time a session opened for this admin. The console's own "who is still using this?"
  -- question, and the one that finds the account nobody has closed.
  last_seen_at timestamptz,
  constraint admins_role_is_known check (role in ('viewer', 'operator', 'owner')),
  constraint admins_status_is_known check (status in ('active', 'suspended')),
  constraint admins_email_looks_like_one check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint admins_email_is_short check (char_length(email) <= 320)
);

comment on table ops.admins is
  'The admin register. Admin-ness is a row here and nowhere else: not a JWT claim, not an env var.';


-- --------------------------------------------------------------------------------------------
-- ops.admin_sessions — the short console session that sits ON TOP of the Supabase sign-in.
-- --------------------------------------------------------------------------------------------
--
-- WHY A SECOND SESSION AT ALL, when the Supabase access token is already verified:
--   * Length. A learner's token lives about an hour and refreshes itself for as long as the app is
--     open. A console that can read every child in the product should not stay open that way. This
--     session expires on a short clock (ADMIN_SESSION_TTL_S, default 30 minutes) and does not
--     refresh itself.
--   * Revocation. There is no way to kill a Supabase access token before its expiry. There is a
--     way to kill a row: `revoked_at`, set by an owner or by the person themselves, takes effect
--     on the next request.
--   * Step-up. `reauth_at` records the last time the person proved themselves again. Anything that
--     changes a learner's data or their money reads it, so a walked-away laptop cannot spend.
--   * It makes "signed in as a learner" structurally insufficient: an admin request needs a valid
--     token AND a live row here AND an active register row. Any one of the three missing is a 403.
create table if not exists ops.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references ops.admins(id) on delete cascade,
  -- The session token is opaque, minted by the gateway, and shown to the client exactly once.
  -- Only its SHA-256 lands here: a reader of this table (a backup, a support query, a leaked dump)
  -- learns nothing they can replay.
  token_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  -- The last successful step-up. Null means "opened, never re-proved" — which is fine for looking
  -- and never enough for acting.
  reauth_at timestamptz,
  -- Where from, as a keyed digest and never as an address: the same posture the request log takes
  -- (app.py _ip_fingerprint). "Same caller or not" is the whole question an investigation asks.
  ip_hash text,
  -- Truncated by the gateway. Kept because "a session opened from a browser nobody on the team
  -- uses" is the shape of a stolen token.
  user_agent text,
  revoked_at timestamptz,
  revoked_reason text,
  constraint admin_sessions_expires_after_issue check (expires_at > issued_at),
  constraint admin_sessions_token_hash_is_a_digest check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint admin_sessions_ip_hash_is_a_digest check (ip_hash is null or ip_hash ~ '^[0-9a-f]{16,64}$'),
  constraint admin_sessions_user_agent_is_short check (user_agent is null or char_length(user_agent) <= 256),
  constraint admin_sessions_revoked_has_a_time check (revoked_reason is null or revoked_at is not null)
);

create index if not exists admin_sessions_admin_idx on ops.admin_sessions (admin_id, issued_at desc);
create index if not exists admin_sessions_expiry_idx on ops.admin_sessions (expires_at);

comment on table ops.admin_sessions is
  'Short server-side console sessions. Only the SHA-256 of the token is stored; revocable; carries the step-up clock.';


-- --------------------------------------------------------------------------------------------
-- ops.admin_audit — append-only. Who looked, at what, when, and from where.
-- --------------------------------------------------------------------------------------------
create table if not exists ops.admin_audit (
  -- A monotonic id, not a uuid: the first question of any investigation is "in what order", and a
  -- gap in this sequence is itself evidence.
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The subject is DENORMALISED on purpose. If the admin row is ever deleted, the trail must still
  -- say who; a foreign key that cascades would let removing a person remove the record of what
  -- they did. `actor_admin_id` is kept beside it with no FK for the same reason.
  actor_subject uuid not null,
  actor_admin_id uuid,
  actor_email text,
  actor_role text,
  session_id uuid,
  -- What happened, dotted and lower case: 'admin.session.open', 'admin.session.denied',
  -- 'learner.read', 'subscription.change', 'admin.grant'. Reads are in this list on purpose.
  action text not null,
  -- What it was about, opaquely. A learner id, a subscription id. Never a name, never an address,
  -- never anything the learner wrote.
  resource_type text,
  resource_id text,
  -- Whether the guard let it through. A wall of `denied` rows against one subject is somebody
  -- trying doors, and it is the reason denials are recorded at all.
  decision text not null default 'allowed',
  -- The HTTP shape of it, so a trail can be read without the console that produced it.
  method text,
  path text,
  status_code int,
  ip_hash text,
  user_agent text,
  -- Structured extras. The gateway writes only what it can justify: counts, filters, ids. It is
  -- NOT a place to copy a learner's content into, and nothing in the gateway writes free text
  -- from a learner into it.
  detail jsonb not null default '{}'::jsonb,
  constraint admin_audit_decision_is_known check (decision in ('allowed', 'denied')),
  constraint admin_audit_action_is_short check (char_length(action) between 1 and 120),
  constraint admin_audit_resource_is_short check (resource_id is null or char_length(resource_id) <= 200),
  constraint admin_audit_path_is_short check (path is null or char_length(path) <= 512),
  constraint admin_audit_user_agent_is_short check (user_agent is null or char_length(user_agent) <= 256),
  constraint admin_audit_detail_is_an_object check (jsonb_typeof(detail) = 'object')
);

create index if not exists admin_audit_at_idx on ops.admin_audit (at desc);
create index if not exists admin_audit_actor_idx on ops.admin_audit (actor_subject, at desc);
create index if not exists admin_audit_resource_idx on ops.admin_audit (resource_type, resource_id, at desc);
create index if not exists admin_audit_decision_idx on ops.admin_audit (decision, at desc) where decision = 'denied';

comment on table ops.admin_audit is
  'Append-only admin trail. UPDATE and DELETE are revoked from every role and refused by trigger.';


-- The second lock. Grants stop a role; this stops the statement, whoever runs it, including a
-- session that has somehow acquired the table owner. An admin cannot edit or erase his own trail.
create or replace function ops.admin_audit_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops.admin_audit is append-only: % is refused', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists admin_audit_no_update on ops.admin_audit;
create trigger admin_audit_no_update
  before update on ops.admin_audit
  for each row execute function ops.admin_audit_is_append_only();

drop trigger if exists admin_audit_no_delete on ops.admin_audit;
create trigger admin_audit_no_delete
  before delete on ops.admin_audit
  for each row execute function ops.admin_audit_is_append_only();

-- Truncate sidesteps row triggers entirely, so it gets its own statement-level one. Without this
-- the whole trail is one `truncate` away from gone.
drop trigger if exists admin_audit_no_truncate on ops.admin_audit;
create trigger admin_audit_no_truncate
  before truncate on ops.admin_audit
  for each statement execute function ops.admin_audit_is_append_only();


-- --------------------------------------------------------------------------------------------
-- Row level security. On for all three, and FORCED, so the table owner is bound by it too.
-- --------------------------------------------------------------------------------------------
alter table ops.admins enable row level security;
alter table ops.admins force row level security;
alter table ops.admin_sessions enable row level security;
alter table ops.admin_sessions force row level security;
alter table ops.admin_audit enable row level security;
alter table ops.admin_audit force row level security;

-- Is the CALLER an active admin? Security definer so the check can read ops.admins without
-- granting anybody SELECT on the register, and so a policy on the audit does not recurse into a
-- policy on admins. `search_path = ''` is not decoration: a definer function that resolves an
-- unqualified name through the caller's search_path is the classic way to hand out its own
-- privileges, so every name inside is schema-qualified.
create or replace function ops.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from ops.admins a
    where a.subject_id = (select auth.uid())
      and a.status = 'active'
  );
$$;

revoke all on function ops.is_admin() from public;
grant execute on function ops.is_admin() to authenticated, service_role;

-- ops.admins: NO policy for `authenticated`. Not even a self-read. The console asks the gateway
-- "what am I allowed to do", and the gateway answers with the service role; a client that can read
-- the register can enumerate the team, which is the first step of targeting one of them.
--
-- ops.admin_sessions: NO policy for `authenticated`. A session row is the gateway's bookkeeping;
-- the client already holds the only copy of the token that matters.
--
-- ops.admin_audit: an active admin may READ the trail. That is the whole point of a trail — it is
-- checked by the people it is kept on. Nobody may write it from a client at any tier.
drop policy if exists admin_audit_read on ops.admin_audit;
create policy admin_audit_read
  on ops.admin_audit
  for select
  to authenticated
  using (ops.is_admin());


-- --------------------------------------------------------------------------------------------
-- Grants, one at a time, in writing.
-- --------------------------------------------------------------------------------------------
revoke all on ops.admins from public, anon, authenticated;
revoke all on ops.admin_sessions from public, anon, authenticated;
revoke all on ops.admin_audit from public, anon, authenticated;

-- The register and the sessions: the server, and nothing else.
grant select, insert, update, delete on ops.admins to service_role;
grant select, insert, update, delete on ops.admin_sessions to service_role;

-- The audit: INSERT and SELECT for the server. UPDATE and DELETE for nobody, service_role
-- included — the gateway itself is not trusted to rewrite what the gateway wrote.
grant select, insert on ops.admin_audit to service_role;
revoke update, delete, truncate on ops.admin_audit from service_role;

-- The one client-side grant in this schema: an admin reading the trail, gated by the policy above.
grant select on ops.admin_audit to authenticated;
revoke insert, update, delete, truncate on ops.admin_audit from authenticated;


-- --------------------------------------------------------------------------------------------
-- Bootstrap. THE ONLY WAY THE FIRST ADMIN EXISTS.
-- --------------------------------------------------------------------------------------------
-- Applying this migration grants nobody anything: there is no seeded row, and there is no
-- environment variable that would make one. The owner runs this once, by hand, in the project's
-- SQL editor, having looked up his own auth user id in Authentication → Users:
--
--   insert into ops.admins (subject_id, email, role, mfa_required)
--   values ('00000000-0000-0000-0000-000000000000', 'you@example.com', 'owner', true)
--   on conflict (subject_id) do update set role = excluded.role, status = 'active';
--
-- From that row, the team is added through the console, and every addition is audited. Note
-- `mfa_required` is true: with ENV=prod the gateway will refuse to open a session for this row
-- until a TOTP factor is enrolled for that user in Supabase (Authentication → Multi-factor). That
-- is deliberate — the account that can see every child in the product is not a one-password
-- account. Off prod, ADMIN_REQUIRE_MFA=0 relaxes it for local work; in prod that switch is refused.
