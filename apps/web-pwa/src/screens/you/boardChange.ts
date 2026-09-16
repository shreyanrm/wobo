/**
 * The board change, as the You screen reaches it (docs/CONSOLE-ROLES-AND-BOARD.md §1).
 *
 * The rule is the gateway's (`services/gateway/src/wobo_gateway/board_change.py`): how many
 * changes are theirs, the refusal, the queue. A rule enforced in a bundle is a suggestion, so this
 * file decides nothing. It carries what the gateway answered, in the gateway's own words, and it
 * FAILS CLOSED: a standing it could not read is not "you may change", and a change that did not
 * land is not a change. The class on the same board is not policed and never waits on this.
 */

import { gatewayFetch } from '@wobo/sdk';
import { refusalMessage } from './parentLink';

/** The same sentence the gateway sends when its store is down, for when nothing answered at all. */
export const UNREACHABLE = 'I cannot reach your board right now. Try again in a moment.';

export interface BoardStanding {
  board: { frameworkId: string | null; level: string | null };
  mayChange: boolean;
  lastChangedAt: string | null;
  granted: boolean;
  /** The three facts, shown before a change. Empty once a person is needed. */
  cost: string[];
  /** The one line that replaces the picker once a person is needed. */
  line: string | null;
  /** The one button under it. */
  button: string | null;
  /** A request already with a person. */
  request: { wanted: string | null; message: string } | null;
  /** What the product says once a person has handed the change back. */
  message: string | null;
}

export type StandingOutcome =
  | { ok: true; standing: BoardStanding }
  | { ok: false; message: string };
export type ChangeOutcome =
  | { ok: true; standing: BoardStanding | null }
  | { ok: false; needsAPerson: boolean; message: string };
export type AskOutcome = { ok: true; message: string } | { ok: false; message: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseStanding(body: unknown): BoardStanding | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.may_change !== 'boolean') return null;
  const board = (b.board ?? {}) as Record<string, unknown>;
  const request =
    b.request && typeof b.request === 'object' ? (b.request as Record<string, unknown>) : null;
  const wanted =
    request?.wanted && typeof request.wanted === 'object'
      ? str((request.wanted as Record<string, unknown>).framework_id)
      : null;
  return {
    board: { frameworkId: str(board.framework_id), level: str(board.level) },
    mayChange: b.may_change,
    lastChangedAt: str(b.last_changed_at),
    granted: b.granted === true,
    cost: Array.isArray(b.cost) ? b.cost.filter((c): c is string => typeof c === 'string') : [],
    line: str(b.line),
    button: str(b.button),
    request: request ? { wanted, message: str(request.message) ?? '' } : null,
    message: str(b.message),
  };
}

type Fetch = typeof gatewayFetch;

export async function readStanding(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<StandingOutcome> {
  if (!gatewayUrl) return { ok: false, message: UNREACHABLE };
  try {
    const res = await fetcher(`${gatewayUrl}/v1/board/change`);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: refusalMessage(body, UNREACHABLE) };
    const standing = parseStanding(body);
    return standing ? { ok: true, standing } : { ok: false, message: UNREACHABLE };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

export interface Move {
  to: string;
  level: string | null;
  /** The board they are on now. The gateway reads it only while it holds no trail of its own. */
  from: string | null;
  fromLevel?: string | null;
}

function moveBody(move: Move): Record<string, unknown> {
  return {
    framework_id: move.to,
    level: move.level,
    ...(move.from ? { current_framework_id: move.from } : {}),
    ...(move.from ? { current_level: move.fromLevel ?? move.level } : {}),
  };
}

/** The change itself. Sent only after the learner has read the cost, so it always confirms. */
export async function changeBoard(
  move: Move,
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<ChangeOutcome> {
  if (!gatewayUrl) return { ok: false, needsAPerson: false, message: UNREACHABLE };
  try {
    const res = await fetcher(`${gatewayUrl}/v1/board/change`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...moveBody(move), confirm: true }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (body as { detail?: { code?: unknown } } | null)?.detail?.code;
      return {
        ok: false,
        needsAPerson: code === 'needs_a_person',
        message: refusalMessage(body, UNREACHABLE),
      };
    }
    return { ok: true, standing: parseStanding(body) };
  } catch {
    return { ok: false, needsAPerson: false, message: UNREACHABLE };
  }
}

/** The form behind the one button: the board they are on and the one they want. */
export async function askForChange(
  move: Move,
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<AskOutcome> {
  if (!gatewayUrl) return { ok: false, message: UNREACHABLE };
  try {
    const res = await fetcher(`${gatewayUrl}/v1/board/change/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(moveBody(move)),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: refusalMessage(body, UNREACHABLE) };
    const message = str((body as { message?: unknown } | null)?.message);
    return message ? { ok: true, message } : { ok: false, message: UNREACHABLE };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}
