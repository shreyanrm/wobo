/**
 * The register desk's reading: who has a seat, and what each person EFFECTIVELY holds.
 *
 * THE LAW (docs/CONSOLE-ROLES-AND-BOARD.md §2): "A person's capabilities are the union of their
 * role's defaults and the owner's explicit grants, minus their explicit revocations, and the screen
 * always shows the effective set rather than the theory." The gateway does that arithmetic
 * (`console_panels.effective`) and sends the result as `capabilities`; `granted` and `revoked` only
 * say which part of it was the owner's own doing. Nothing here recomputes who holds what.
 *
 * The invitation link is shown once, in the answer to the invite, and never read back: the register
 * keeps a digest of it and this desk never sees even that.
 */

import type { Panel, Tone } from './panels';

export interface VocabularyEntry {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly read: string;
  readonly act: string;
}

export interface RegisterSeat {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly mfa_required: boolean;
  readonly permissions: readonly string[];
  readonly capabilities: readonly string[];
  readonly granted: readonly string[];
  readonly revoked: readonly string[];
  readonly granted_by: string | null;
  readonly invitation_expires_at: string | null;
}

export interface Register {
  readonly admins: readonly RegisterSeat[];
  readonly roles: readonly string[];
  readonly vocabulary: readonly VocabularyEntry[];
  readonly defaults: Readonly<Record<string, readonly string[]>>;
  readonly owner_count: number;
}

export interface Invitation {
  readonly to: string;
  readonly link: string;
  readonly expires_at: string;
  readonly sent: boolean;
  readonly mail: { readonly subject: string; readonly text: string; readonly html: string };
}

export interface InvitationAnswer {
  readonly admin: RegisterSeat;
  readonly invitation: Invitation;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isText = (value: unknown): value is string => typeof value === 'string';
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const isTextOrNull = (value: unknown) => value === null || value === undefined || isText(value);

export function isSeat(value: unknown): value is RegisterSeat {
  if (!isObject(value)) return false;
  return (
    isText(value.id) &&
    value.id.length > 0 &&
    isText(value.email) &&
    isText(value.role) &&
    isText(value.status) &&
    typeof value.mfa_required === 'boolean' &&
    isTexts(value.permissions) &&
    isTexts(value.capabilities) &&
    isTexts(value.granted) &&
    isTexts(value.revoked) &&
    isTextOrNull(value.granted_by) &&
    isTextOrNull(value.invitation_expires_at)
  );
}

function isVocabulary(value: unknown): value is VocabularyEntry {
  return (
    isObject(value) &&
    isText(value.id) &&
    isText(value.name) &&
    isText(value.question) &&
    isText(value.read) &&
    isText(value.act)
  );
}

export function isRegister(value: unknown): value is Register {
  if (!isObject(value)) return false;
  const { admins, roles, vocabulary, defaults, owner_count: owners } = value;
  if (!Array.isArray(admins) || !admins.every(isSeat)) return false;
  if (!isTexts(roles)) return false;
  if (!Array.isArray(vocabulary) || !vocabulary.every(isVocabulary)) return false;
  if (!isObject(defaults) || !Object.values(defaults).every(isTexts)) return false;
  return typeof owners === 'number' && Number.isFinite(owners);
}

/** One seat, as the per-person writes answer with it. */
export function isSeatAnswer(value: unknown): value is { readonly admin: RegisterSeat } {
  return isObject(value) && isSeat(value.admin);
}

function isLink(value: unknown): value is string {
  if (!isText(value) || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isInvitationAnswer(value: unknown): value is InvitationAnswer {
  if (!isObject(value) || !isSeat(value.admin)) return false;
  const invitation = value.invitation;
  if (!isObject(invitation)) return false;
  const mail = invitation.mail;
  return (
    isText(invitation.to) &&
    isLink(invitation.link) &&
    isText(invitation.expires_at) &&
    typeof invitation.sent === 'boolean' &&
    isObject(mail) &&
    isText(mail.subject) &&
    isText(mail.text) &&
    isText(mail.html)
  );
}

// --- one cell of the grid ----------------------------------------------------------------------------
export type CellSource = 'role' | 'granted' | 'revoked';

export interface Cell {
  readonly held: boolean;
  readonly source: CellSource;
}

export function cellOf(seat: RegisterSeat, capability: string): Cell {
  const held = seat.capabilities.includes(capability);
  if (seat.granted.includes(capability)) return { held, source: 'granted' };
  if (seat.revoked.includes(capability)) return { held, source: 'revoked' };
  return { held, source: 'role' };
}

/** What one press asks for. The owner's own change is undone by putting the role back, so a
 *  person's row never piles up a grant on top of a revoke. */
export function changeFor(cell: Cell): 'grant' | 'revoke' | 'default' {
  if (cell.source !== 'role') return 'default';
  return cell.held ? 'revoke' : 'grant';
}

export const SOURCE_WORDS: Record<CellSource, string> = {
  role: 'from the role',
  granted: 'given by you',
  revoked: 'taken away by you',
};

export function startingSet(register: Register, role: string): string[] {
  return [...(register.defaults[role] ?? [])];
}

/** The tail `api.write` sends a per-person change to, or null for anything that is not an id. */
export function seatPath(
  id: string,
  tail: 'capabilities' | 'suspend' | 'invitation',
): string | null {
  return /^[0-9a-f-]{8,64}$/.test(id) ? `/${id}/${tail}` : null;
}

// --- the desk as panels ----------------------------------------------------------------------------
const SOURCE = 'GET /v1/admin/admins (ops.admins, ops.admin_capabilities)';

export const ROLE_WORDS: Record<string, string> = {
  viewer: 'viewer',
  operator: 'operator',
  owner: 'owner',
};

export function stamp(iso: string | null): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const day = when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${day}, ${when.toISOString().slice(11, 16)} UTC`;
}

export function stateWords(
  seat: RegisterSeat,
  now: Date = new Date(),
): { text: string; tone: Tone } {
  if (seat.status === 'active') return { text: 'active', tone: 'ok' };
  if (seat.status === 'suspended') return { text: 'suspended', tone: 'plain' };
  if (seat.status === 'invited') {
    const until = seat.invitation_expires_at ? new Date(seat.invitation_expires_at) : null;
    if (!until || Number.isNaN(until.getTime()) || until <= now) {
      return { text: 'waiting, the link has run out', tone: 'warn' };
    }
    return { text: `waiting, link open until ${stamp(seat.invitation_expires_at)}`, tone: 'plain' };
  }
  return { text: seat.status, tone: 'unknown' };
}

function names(register: Register, seat: RegisterSeat, side: 'read' | 'act'): string {
  const held = register.vocabulary
    .filter((entry) => seat.capabilities.includes(entry[side]))
    .map((entry) => entry.name);
  return held.length > 0 ? held.join(', ') : 'nothing';
}

export function registerPanels(register: Register | null, at: string | null): Panel[] {
  if (!register) {
    return [
      {
        kind: 'absent',
        id: 'register-unread',
        label: 'The register',
        because:
          'The register could not be read just now, so this desk shows nobody rather than a list ' +
          'that might be wrong.',
        wouldFill: 'A gateway that can reach ops.admins. Nothing about who has access is guessed.',
      },
    ];
  }
  const byId = new Map(register.admins.map((seat) => [seat.id, seat.email]));
  return [
    {
      kind: 'figure',
      id: 'register-owners',
      label: 'Owner accounts',
      value: String(register.owner_count),
      note:
        register.owner_count === 1
          ? 'Exactly one. The database refuses a second.'
          : 'There must be exactly one. The break-glass in docs/OPERATIONS.md section 13 fixes it.',
      tone: register.owner_count === 1 ? 'ok' : 'critical',
      provenance: { source: SOURCE, at },
    },
    {
      kind: 'rows',
      id: 'register-seats',
      label: 'Who has a seat',
      columns: ['Person', 'Started as', 'State', 'Can see', 'Can act on', 'Added by'],
      rows: register.admins.map((seat) => {
        const state = stateWords(seat);
        return {
          id: seat.id,
          tone: state.tone,
          cells: [
            seat.email,
            ROLE_WORDS[seat.role] ?? seat.role,
            state.text,
            names(register, seat, 'read'),
            names(register, seat, 'act'),
            seat.granted_by ? (byId.get(seat.granted_by) ?? 'a seat no longer listed') : 'nobody',
          ],
        };
      }),
      provenance: {
        source: SOURCE,
        at,
        caveat:
          'What each person can see and act on is what they hold now: their role, plus what you ' +
          'gave them, minus what you took away.',
      },
    },
  ];
}
