-- 0037: the console invitation's link: a digest and a deadline on the register row.
--
-- The law (docs/CONSOLE-ROLES-AND-BOARD.md, "Accepting a seat proves the address twice",
-- 2026-09-15): "the invitation itself carries a signed, single-use, expiring link sent to the
-- invited address, and a seat binds only when the person arrives THROUGH that link with a token
-- whose verified address matches. A token alone, however verified, never binds a seat."
--
-- 0029 made an invitation a row (`status = 'invited'`, `subject_id` null) and bound it to whichever
-- account first proved the address. This file adds the other half: the row remembers WHICH LINK
-- it is waiting for, and until when.
--
--   * `invite_token_hash` is the SHA-256 of the token in the link, never the token. A reader of
--     this table cannot rebuild a link from it. The signature, the deadline and the address the
--     link was minted for live in the token itself (wobo_gateway.admin_invite).
--   * `invite_expires_at` is the same deadline the token carries, so either clock running out is
--     enough to refuse.
--   * SINGLE USE is a write, not a column: the gateway binds the seat with one PATCH whose filter
--     names this digest and a deadline still ahead, and whose body sets both columns back to null.
--     The second arrival through the same link matches no row. A fresh link from the owner
--     replaces the digest, which is how the old link dies.
--
-- The check below keeps the two states apart in the data itself: a seat that has its account holds
-- no link. The unique index keeps one link from ever naming two seats.
--
-- Nothing is granted here. `ops.admins` stays closed to every client role (0015); only the
-- gateway's service key reads or writes it.
--
-- Additive and idempotent. Applying it twice is a no-op.

alter table ops.admins add column if not exists invite_token_hash text;
alter table ops.admins add column if not exists invite_expires_at timestamptz;

comment on column ops.admins.invite_token_hash is
  'SHA-256 of the outstanding invitation link token. Cleared the moment the seat binds.';
comment on column ops.admins.invite_expires_at is
  'When the outstanding invitation link stops working. Cleared with the digest.';

alter table ops.admins drop constraint if exists admins_invite_token_hash_is_a_digest;
alter table ops.admins
  add constraint admins_invite_token_hash_is_a_digest
  check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$');

-- A link belongs to a seat nobody has taken. Rows written before this file carry no digest, so
-- the constraint holds for every existing row the moment it is added.
alter table ops.admins drop constraint if exists admins_invitation_only_while_invited;
alter table ops.admins
  add constraint admins_invitation_only_while_invited
  check (invite_token_hash is null or (status = 'invited' and subject_id is null));

create unique index if not exists admins_one_row_per_invitation
  on ops.admins (invite_token_hash)
  where invite_token_hash is not null;
