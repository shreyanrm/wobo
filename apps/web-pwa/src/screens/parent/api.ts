/**
 * The parent account's wire: the gateway's own routes (services/gateway/src/wobo_gateway/parent_api.py),
 * with identity riding `gatewayFetch` exactly as every learner call does.
 *
 * Four calls and no more on this side of the plane: who this account is, become a parent account
 * (which is also how a parent picks up a child who linked them since), the live list of children,
 * and the switch. The four actions a parent may take live behind their own doors, and nothing here
 * reads anything about a child beyond a name and an id: the server sends nothing more, and this
 * file keeps nothing it did not send.
 *
 * EVERY CALL ANSWERS. A refusal, a network that never replied and a build with no gateway are all
 * outcomes the screen says a true sentence about; nothing here throws, and nothing here invents a
 * family. The one distinction that matters most: a 403 is two things on this plane (see
 * `readParentMe`), and only one of them means "this is a student account".
 */

import { gatewayFetch } from '@wobo/sdk';

/** The four things a parent account may do. The server's `PARENT_ACTIONS`; there is no fifth. */
export const PARENT_ACTIONS = ['ask', 'pay', 'refer', 'donate'] as const;
export type ParentAction = (typeof PARENT_ACTIONS)[number];

/** One linked child, as a parent is allowed to see them: a name and a key, nothing else. */
export interface ParentChild {
  learnerId: string;
  name: string | null;
  linkedAt: string | null;
}

/** What the server said about the account behind this session. */
export type MeAnswer =
  | { kind: 'parent'; displayName: string | null; children: number; actions: ParentAction[] }
  /** The parent door's own 403: a student account, or one that has not become a parent's yet. */
  | { kind: 'not-parent' }
  /** Nobody signed in, as far as the gateway can tell. */
  | { kind: 'signed-out' }
  /** The dial (docs/DOORS-CLOSED.md). Its line is the server's. */
  | { kind: 'closed'; message: string }
  | { kind: 'trouble'; message: string }
  /** This build has no gateway, so it has no parent side to reach. */
  | { kind: 'unwired' };

export type Refusal = { ok: false; code: string; message: string };

export type SignUpOutcome = { ok: true; children: ParentChild[] } | Refusal;
export type ChildrenOutcome =
  | { ok: true; children: ParentChild[]; selected: string | null }
  | Refusal;
export type SwitchOutcome = { ok: true; child: ParentChild; scope: string } | Refusal;

/** Said when nothing answered, or an answer could not be read. The same line the server uses. */
export const TROUBLE_LINE = 'I could not reach that just now. Try again in a moment.';

/** The dial's code (services/gateway/src/wobo_gateway/doors.py `CODE`). */
export const DOORS_CLOSED = 'doors_closed';
/** The parent door's code (parent_account.NotAParentAccount). */
export const NOT_A_PARENT = 'not_a_parent_account';

type Fetch = typeof gatewayFetch;

const DEFAULT_GATEWAY = (): string | undefined => import.meta.env.VITE_GATEWAY_URL;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * A refusal, whichever of the two shapes it arrived in: FastAPI's `{detail: {code, message}}`,
 * or the dial's own top-level `{code, message}` (the door answers before any route does).
 */
export function refusalOf(body: unknown): { code: string; message: string } {
  const top = record(body);
  const inner = record(top?.detail) ?? top;
  const code = text(inner?.code) ?? 'unknown';
  const message = text(inner?.message) ?? TROUBLE_LINE;
  return { code, message };
}

/** One child row as the server writes it (`Child.as_dict`), or null when it is not one. */
export function childOf(row: unknown): ParentChild | null {
  const r = record(row);
  const learnerId = text(r?.learner_id);
  if (!r || !learnerId) return null;
  return { learnerId, name: text(r.name), linkedAt: text(r.linked_at) };
}

function childrenOf(rows: unknown): ParentChild[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(childOf).filter((c): c is ParentChild => c !== null);
}

async function bodyOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function refused(body: unknown): Refusal {
  return { ok: false, ...refusalOf(body) };
}

const unreachable: Refusal = { ok: false, code: 'unreachable', message: TROUBLE_LINE };

/**
 * Who is this account? The server's answer is the whole of the decision.
 *
 * A 403 is read by its CODE. `not_a_parent_account` is the parent door; `doors_closed` is the dial,
 * which refuses a new subject's first call before any route runs. Reading the dial as the parent
 * door would send a real parent into the learner app on the day the owner closes the door.
 */
export async function readParentMe(
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<MeAnswer> {
  if (!gatewayUrl) return { kind: 'unwired' };
  try {
    const res = await fetcher(`${gatewayUrl}/v1/parent/me`);
    const body = await bodyOf(res);
    if (res.ok) {
      const b = record(body);
      const actions = Array.isArray(b?.actions)
        ? (b.actions as unknown[]).filter((a): a is ParentAction =>
            (PARENT_ACTIONS as readonly unknown[]).includes(a),
          )
        : [];
      return {
        kind: 'parent',
        displayName: text(b?.display_name),
        children: typeof b?.children === 'number' ? b.children : 0,
        actions,
      };
    }
    if (res.status === 401) return { kind: 'signed-out' };
    const { code, message } = refusalOf(body);
    if (res.status === 403 && code === NOT_A_PARENT) return { kind: 'not-parent' };
    if (res.status === 403 && code === DOORS_CLOSED) return { kind: 'closed', message };
    if (res.status === 403 && code === 'sign_in_required') return { kind: 'signed-out' };
    return { kind: 'trouble', message };
  } catch {
    return { kind: 'trouble', message: TROUBLE_LINE };
  }
}

/**
 * Make this account a parent account, and pick up every child already linked to its address.
 *
 * The body carries a name to call them by and nothing else. The address that finds the family is
 * read by the server from the verified token, and a client that sent one would be refused (the
 * body model forbids extra fields). It is idempotent: an existing parent account calling it again
 * is how a child who linked them since is picked up (`parent_account.claim_links`).
 */
export async function signUpParent(
  displayName: string | null,
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<SignUpOutcome> {
  if (!gatewayUrl) return unreachable;
  try {
    const res = await fetcher(`${gatewayUrl}/v1/parent/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(displayName ? { display_name: displayName } : {}),
    });
    const body = await bodyOf(res);
    if (!res.ok) return refused(body);
    return { ok: true, children: childrenOf(record(body)?.children) };
  } catch {
    return unreachable;
  }
}

/** Every child whose link is live right now, and which one the server has selected. */
export async function readChildren(
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<ChildrenOutcome> {
  if (!gatewayUrl) return unreachable;
  try {
    const res = await fetcher(`${gatewayUrl}/v1/parent/children`);
    const body = await bodyOf(res);
    if (!res.ok) return refused(body);
    const b = record(body);
    return { ok: true, children: childrenOf(b?.children), selected: text(b?.selected) };
  } catch {
    return unreachable;
  }
}

/**
 * Choose which child everything after this is about. The id is a candidate; the server checks it
 * against the live list, writes the selection, and answers with a fresh scope. A 200 with no scope
 * is not a switch: without one the device has nothing to drop the last child's state by.
 */
export async function switchChild(
  learnerId: string,
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<SwitchOutcome> {
  if (!gatewayUrl) return unreachable;
  try {
    const res = await fetcher(`${gatewayUrl}/v1/parent/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ learner_id: learnerId }),
    });
    const body = await bodyOf(res);
    if (!res.ok) return refused(body);
    const b = record(body);
    const child = childOf(b?.child);
    const scope = text(b?.scope);
    if (!child || !scope) return unreachable;
    return { ok: true, child, scope };
  } catch {
    return unreachable;
  }
}
