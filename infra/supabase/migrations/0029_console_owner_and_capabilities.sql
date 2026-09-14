-- 0029 — one owner, enforced by the database, and the capabilities the owner shapes per person.
--
-- The owner's ruling (docs/CONSOLE-ROLES-AND-BOARD.md §2): "In the superadmin we one owner account
-- which only I will have access to, and the rest of the new users that get added by me, I should be
-- able to assign their roles and what all visible to them."
--
-- 0015 built the register: an admin is a row, in a schema the learner cannot read, written only
-- with the service key, every change audited, three roles with fixed permission sets. That posture
-- is right and is untouched here. This file changes three things and nothing else.
--
-- 1. THE OWNER IS EXACTLY ONE ACCOUNT, AND IT IS A CONSTRAINT.
--    A partial unique index allows at most one row with the owner role and the status active. It
--    is not a check in the gateway, because a check in the gateway is a rule that holds until the
--    next bug in the gateway; the console holds the service key, so the only place a rule about
--    the service key's own writes can live is under it. The gateway refuses a second owner first,
--    with a readable message, and this index is what is left when the gateway is the problem.
--
-- 2. THE OWNER'S SEAT IS NOT TAKEABLE BY ANYBODY ELSE, AND THE WAY BACK IS WRITTEN DOWN.
--    A grant cannot tell "suspend the operator" from "suspend the owner" — both are an UPDATE by
--    the service role — so the difference is a trigger. Demoting, suspending or deleting an active
--    owner is refused, whoever is asking, INCLUDING the service key the console runs on.
--
--    That would be a locked building with no key, so the trigger has exactly one bypass: a session
--    setting, `ops.break_glass`, that must be set inside the transaction doing the write. PostgREST
--    has no way to issue `set local`, so no console route, and no bug in one, can ever open it: it
--    takes a direct SQL connection and the service key, which is the owner and nobody else. The
--    procedure is written out in docs/OPERATIONS.md under "Break-glass: the owner's seat".
--
--    WHY THE ATTEMPT IS AUDITED IN THE GATEWAY AND NOT HERE. A trigger that raises aborts its
--    transaction, so an audit row written in the same statement would roll back with it — the
--    refusal would erase its own record. So the gateway audits the attempt before it tries and the
--    refusal after it fails (admin_auth: `admin.denied.owner`), and this trigger is the backstop
--    that does not depend on the gateway being honest.
--
-- 3. A ROLE IS A STARTING POINT, AND EVERY CAPABILITY IS GRANTABLE PER PERSON.
--    `ops.admin_capabilities` holds one row per person per capability, each an explicit grant or an
--    explicit revoke. A person's effective set is their role's defaults, plus their grants, minus
--    their revocations, computed in one place (wobo_gateway.console_panels.effective) and shown on
--    the screen as the effective set rather than the theory of a role. The capabilities are the
--    console's own panels, read and act separately, because seeing a learner's day is a different
--    thing from acting on it.
--
-- AND ONE SMALLER CHANGE THAT THE LAW REQUIRES: "Adding a person is the owner's action alone: an
-- email, a starting role, the capabilities; they receive an invitation, set up a second factor
-- before their first sign-in". An invitation is a row that exists before the person has ever signed
-- in, so `subject_id` becomes nullable and `status` gains `invited`. The account id is bound at the
-- first sign-in, to the account that proves the invited address — which is also the moment the
-- second factor is demanded, because the door (`admin_auth.open_session`) already demands it.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- --------------------------------------------------------------------------------------------
-- An invitation: a seat that exists before its account does.
-- --------------------------------------------------------------------------------------------
alter table ops.admins alter column subject_id drop not null;

-- `invited` joins the two states 0015 had. The door treats anything that is not `active` as no
-- access at all (admin_auth.resolve_context refuses on `not admin.active`), so an invited row
-- grants nothing until it is accepted.
alter table ops.admins drop constraint if exists admins_status_is_known;
alter table ops.admins
  add constraint admins_status_is_known check (status in ('active', 'suspended', 'invited'));

-- One live row per address. Without it an owner who invites the same person twice creates a second
-- seat, and revoking the one they can see leaves the other one live. Suspended rows are exempt
-- because they are kept forever so the audit trail has a name beside it, and the same person may be
-- re-invited later.
create unique index if not exists admins_one_live_row_per_address
  on ops.admins (lower(email))
  where status <> 'suspended';

comment on column ops.admins.subject_id is
  'The Supabase auth user id, bound at the first sign-in. Null while the row is an invitation.';


-- --------------------------------------------------------------------------------------------
-- One owner. The constraint, not the convention.
-- --------------------------------------------------------------------------------------------
-- A unique index on the literal role over the rows that match the predicate: since the predicate
-- already pins role = 'owner', uniqueness over that column permits exactly one such row.
--
-- IF THIS INDEX FAILS TO CREATE, the project already has two active owners, and that is the fact
-- worth stopping for. Suspend the one that should not be there (docs/OPERATIONS.md), then apply.
create unique index if not exists admins_one_active_owner
  on ops.admins (role)
  where role = 'owner' and status = 'active';

comment on index ops.admins_one_active_owner is
  'At most one active owner. The register refuses a second; this refuses it when the register does not.';


-- --------------------------------------------------------------------------------------------
-- The owner's seat is not anybody else's to take.
-- --------------------------------------------------------------------------------------------
create or replace function ops.the_owner_is_not_yours_to_take()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  glass text := current_setting('ops.break_glass', true);
begin
  -- The one bypass. `set local ops.break_glass = 'on'` inside the transaction doing the write,
  -- which PostgREST cannot send, so it is unreachable from the console at any tier.
  if glass = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      raise exception 'the owner''s row is not deletable: see docs/OPERATIONS.md break-glass'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if old.role = 'owner' and old.status = 'active' then
    if new.role is distinct from 'owner' then
      raise exception 'the owner cannot be demoted: see docs/OPERATIONS.md break-glass'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from 'active' then
      raise exception 'the owner cannot be suspended: see docs/OPERATIONS.md break-glass'
        using errcode = 'insufficient_privilege';
    end if;
    if new.subject_id is distinct from old.subject_id then
      -- Rebinding the owner's row to a different account is taking the seat by another route.
      raise exception 'the owner''s account cannot be changed: see docs/OPERATIONS.md break-glass'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists admins_owner_is_protected_on_update on ops.admins;
create trigger admins_owner_is_protected_on_update
  before update on ops.admins
  for each row execute function ops.the_owner_is_not_yours_to_take();

drop trigger if exists admins_owner_is_protected_on_delete on ops.admins;
create trigger admins_owner_is_protected_on_delete
  before delete on ops.admins
  for each row execute function ops.the_owner_is_not_yours_to_take();


-- --------------------------------------------------------------------------------------------
-- ops.admin_capabilities — what the owner has granted or revoked, per person, per panel.
-- --------------------------------------------------------------------------------------------
create table if not exists ops.admin_capabilities (
  id uuid primary key default gen_random_uuid(),
  -- Cascades on purpose, and only on delete of the seat itself: a capability row that outlived
  -- its person would be a grant with nobody to hold it. The AUDIT of the grant is in
  -- ops.admin_audit, which nothing cascades and nothing may delete.
  admin_id uuid not null references ops.admins(id) on delete cascade,
  -- `panel.<id>.read` or `panel.<id>.act`. The vocabulary lives in
  -- services/gateway/src/wobo_gateway/console_panels.py, which is also what the console draws its
  -- rail from, so "what they can see" and "what they can do" are one list and not two. An unknown
  -- capability here grants nothing: the effective set is intersected with the vocabulary.
  capability text not null,
  -- `grant` adds it to the role's defaults; `revoke` takes it away from them. A person with no row
  -- for a capability simply has whatever their role starts with — which is why "put it back" is a
  -- DELETE of the row and not a third value.
  effect text not null,
  granted_by uuid,
  at timestamptz not null default now(),
  note text,
  constraint admin_capabilities_effect_is_known check (effect in ('grant', 'revoke')),
  constraint admin_capabilities_name_is_short check (char_length(capability) between 1 and 120),
  constraint admin_capabilities_note_is_short check (note is null or char_length(note) <= 500),
  unique (admin_id, capability)
);

create index if not exists admin_capabilities_admin_idx on ops.admin_capabilities (admin_id);

comment on table ops.admin_capabilities is
  'Per-person grants and revocations over the console panels. Effective = role defaults + grants - revokes.';

alter table ops.admin_capabilities enable row level security;
alter table ops.admin_capabilities force row level security;

-- No policy for `authenticated`, and no grant either: exactly the posture ops.admins holds. A
-- client that could read this could enumerate who can do what, which is the shopping list for
-- choosing whom to target.
revoke all on ops.admin_capabilities from public, anon, authenticated;
grant select, insert, update, delete on ops.admin_capabilities to service_role;
