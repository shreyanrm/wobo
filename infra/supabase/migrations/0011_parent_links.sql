-- 0011 — the parent link: one invited or linked parent per learner (docs/WOBO-PLAN.md §14, §14.1
-- "confirm everything"; docs/copy/help-centre/product-features/11-the-parent-link.md).
--
-- One row per invite. A learner types a parent's address; the gateway writes the row as
-- `invited`, mails the parent a signed, single-use invite (services/gateway parents.py), and the
-- parent's own tap on the accept page turns it `linked`. Either side can end it: the learner from
-- the You screen, the parent from the "Not me" link in the invite (and every Sunday note carries
-- its own link that stops the notes — the dial in 0010, which leaves the link standing). The
-- Sunday note job (hospitality/jobs.py) reads exactly the `linked` rows of this table.
--
-- Why the address is stored in the clear (`parent_email`) rather than as a ciphertext:
--   * the gateway's privacy pattern is RLS plus a service-role erase, not application-layer
--     crypto — `profiles_cache`, `learner_state.mind` and `mail_preferences` all hold personal data
--     under a `learner_id = auth.uid()` policy, and `/v1/me/erase` deletes rows outright and
--     reports the count. A ciphertext column would add a key whose rotation silently loses every
--     linked parent, and gain nothing the erase path does not already give (the row is deleted,
--     never patched);
--   * a revoked link keeps no address: the check below empties `parent_email` the moment a row is
--     `revoked`, whoever ended it. Only the keyed digest survives, and that is not reversible by
--     anyone reading this table (the key is the gateway's, hospitality/tokens.py's derivation);
--   * nothing that logs sees the address: every log line and every idempotency key carries the
--     digest (email.to_hash), the same as every other recipient.
--
-- Laws this file enforces in the database rather than only in Python:
--   * a learner reads their own rows — RLS on `learner_id = auth.uid()`, the shape of 0002/0010
--   * a learner may insert an invite and update the two harmless columns (the name the note uses,
--     the family's zone). The status, the address, the token and the stop link are the gateway's
--     alone: column-level grants, so a client cannot write `linked` without the parent's tap
--   * a learner never deletes from the client: no delete policy, the grant withdrawn (the erase
--     path removes the rows with the service role, alongside everything else)
--   * one active link per learner — a partial unique index over `invited` and `linked`
--   * a `linked` row has a `linked_at`, a `revoked` row has a `revoked_at` and no address
--   * digests are digests (64 hex), a timezone is an IANA name, a name is short
--
-- Additive and idempotent. Applying it twice is a no-op.

create table if not exists learner.parent_links (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null,
  -- HMAC-SHA256 of the normalised address under the gateway's mail key: unlinkable by a reader
  -- of this table, stable for the gateway, and the only trace a revoked link keeps.
  parent_email_hash text not null,
  -- The address itself, present only while the link is invited or linked (see above).
  parent_email text,
  -- What the Sunday note calls the learner ("<name>'s week"). A first name, never more.
  learner_name text,
  -- The family's zone for the parent's mail when the mail dials (0010) carry none.
  timezone text,
  status text not null default 'invited',
  invited_at timestamptz not null default now(),
  linked_at timestamptz,
  revoked_at timestamptz,
  -- Who ended it: the learner from the You screen, or the parent from the "Not me" link. Read by
  -- the You screen so the learner is told when the address said it was not them.
  revoked_by text,
  -- SHA-256 of the signed invite token while it is outstanding. Compared on accept and decline
  -- and emptied on first use, so a link is single-use and a learner's revoke kills it early.
  invite_token_hash text,
  -- The parent's own one-click stop link, minted at link time (hospitality/tokens.py).
  unsubscribe_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_links_status_is_known
    check (status in ('invited', 'linked', 'revoked')),
  constraint parent_links_email_hash_is_a_digest
    check (parent_email_hash ~ '^[0-9a-f]{64}$'),
  constraint parent_links_token_hash_is_a_digest
    check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  constraint parent_links_timezone_is_a_name
    check (timezone is null or timezone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)*$'),
  constraint parent_links_learner_name_is_short
    check (learner_name is null or char_length(learner_name) <= 40),
  constraint parent_links_linked_has_a_time
    check (status <> 'linked' or linked_at is not null),
  constraint parent_links_revoked_has_a_time
    check (status <> 'revoked' or revoked_at is not null),
  constraint parent_links_revoked_names_who
    check (revoked_by is null or revoked_by in ('learner', 'parent')),
  constraint parent_links_revoked_keeps_no_address
    check (status <> 'revoked' or (parent_email is null and invite_token_hash is null)),
  constraint parent_links_linked_keeps_no_token
    check (status <> 'linked' or invite_token_hash is null)
);

-- One active link per learner: a second invite while one is out, or while a parent is linked, is
-- refused by the database too, not only by the route.
create unique index if not exists parent_links_one_active_idx
  on learner.parent_links (learner_id)
  where status in ('invited', 'linked');
-- The Sunday pass reads every linked row; the You screen reads a learner's latest.
create index if not exists parent_links_linked_idx
  on learner.parent_links (status)
  where status = 'linked';
create index if not exists parent_links_learner_idx
  on learner.parent_links (learner_id, invited_at desc);

drop trigger if exists parent_links_set_updated_at on learner.parent_links;
create trigger parent_links_set_updated_at before update on learner.parent_links
  for each row execute function learner.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS: a learner reads their own rows and nobody else's. Insert is allowed for the learner's own
-- id and only as a fresh invite; update is allowed for the learner's own rows and, by column
-- grant below, only on the name and the zone. Delete is the service role's alone.
-- ---------------------------------------------------------------------------------------------
alter table learner.parent_links enable row level security;

drop policy if exists parent_links_read on learner.parent_links;
create policy parent_links_read on learner.parent_links for select to authenticated
  using (learner_id = auth.uid());

drop policy if exists parent_links_insert on learner.parent_links;
create policy parent_links_insert on learner.parent_links for insert to authenticated
  with check (learner_id = auth.uid() and status = 'invited' and invite_token_hash is null);

drop policy if exists parent_links_update on learner.parent_links;
create policy parent_links_update on learner.parent_links for update to authenticated
  using (learner_id = auth.uid()) with check (learner_id = auth.uid());

-- 0002's default privileges grant the four verbs on new `learner` tables to `authenticated`.
-- Delete is withdrawn outright; update is withdrawn and re-granted on the two columns a client
-- may legitimately change, so the missing policy is not the only thing between a client and a
-- row that says `linked`. Service role keeps everything.
revoke delete on learner.parent_links from authenticated;
revoke update on learner.parent_links from authenticated;
grant select, insert on learner.parent_links to authenticated;
grant update (learner_name, timezone) on learner.parent_links to authenticated;
grant all on learner.parent_links to service_role;

comment on table learner.parent_links is
  'The parent link (WOBO-PLAN §14): one invited or linked parent per learner. Written by the '
  'gateway (parents.py); read by the Sunday note job. A revoked row keeps no address.';
comment on column learner.parent_links.parent_email_hash is
  'A keyed one-way digest of the address. Not recomputable by a reader of this table.';
comment on column learner.parent_links.revoked_by is
  'learner: ended from the You screen. parent: the "Not me" link in the invite.';

notify pgrst, 'reload schema';
