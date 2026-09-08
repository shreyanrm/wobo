/**
 * The parent link, as the You screen and onboarding reach it — the gateway's own routes
 * (`services/gateway/src/wobo_gateway/parents.py`), with identity riding `gatewayFetch`.
 *
 * Three doors: read the status (with a line in Wobo's voice the server wrote), send one invite to
 * an email address, end the link. No gateway is a real state and every call says so rather than
 * pretending: the read answers `null`, and the two WRITES answer an outcome, because a write is a
 * thing a learner is told happened. `endParentLink` used to answer `null` for a refusal, for a
 * network that never replied and for a build with no gateway alike, and the screen read all three
 * as "gone" — so a 503 removed the parent from the card while the server kept the link and kept
 * mailing them. A phone number is not something the gateway can invite; the screen keeps the older
 * device-only link for it (`PARENT_KEY`, `phoneLink`), and that one is marked `local` so ending it
 * never knocks on a door that has never heard of it.
 */

import { gatewayFetch } from '@wobo/sdk';

export type ParentLinkState = 'none' | 'invited' | 'linked' | 'revoked';

export interface ParentLinkStatus {
  status: ParentLinkState;
  /** The address, masked by the server. */
  parent_email?: string | null;
  revoked_by?: string | null;
  /** One line in Wobo's voice, written by the server for exactly this state. */
  line: string;
  /**
   * True for the DEVICE-ONLY link a phone number makes. The gateway has never heard of it, so it
   * is ended by forgetting it here and never by a request that would answer "no such link" and be
   * read as a refusal.
   */
  local?: boolean;
}

export type InviteOutcome =
  | { ok: true; status: ParentLinkStatus; sent: boolean }
  | { ok: false; message: string };

/**
 * What ending a link answered. A refusal, a network that never replied and a build with no gateway
 * are all `{ ok: false }` — never a silent "gone". The screen used to read every one of those as
 * success and tell a learner their parent was unlinked while the server still held the link and
 * still sent the Sunday note to that address.
 */
export type EndOutcome =
  | { ok: true; status: ParentLinkStatus | null }
  | { ok: false; message: string };

/** What the screen says when ending the link did not land. The link is exactly as it was. */
export const END_FAILED = 'That did not go through, so the link has not changed. Try again.';

/**
 * The device-only link a phone number makes, and the plain truth about it: the Sunday note goes by
 * email and only by email (`services/gateway/src/wobo_gateway/parents.py` has no other channel), so
 * this line no longer promises a WhatsApp message, and no longer dates that promise to a launch
 * that has already happened. One writer, so the invite form and the You screen cannot differ.
 */
export const PHONE_LINK_LINE =
  'The Sunday note only goes by email, so add their email address when you can.';

export function phoneLink(phone: string): ParentLinkStatus {
  return {
    status: 'linked',
    parent_email: null,
    line: `Kept on this device · ${phone}. ${PHONE_LINK_LINE}`,
    local: true,
  };
}

const STATES = new Set<ParentLinkState>(['none', 'invited', 'linked', 'revoked']);
const SENT_ELSEWHERE = 'I could not send that just now. Try again in a moment.';

/** The status the server answered with, or null when the body is not one. */
export function parseStatus(body: unknown): ParentLinkStatus | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const status = typeof b.status === 'string' ? (b.status as ParentLinkState) : null;
  if (!status || !STATES.has(status) || typeof b.line !== 'string') return null;
  return {
    status,
    parent_email: typeof b.parent_email === 'string' ? b.parent_email : null,
    revoked_by: typeof b.revoked_by === 'string' ? b.revoked_by : null,
    line: b.line,
  };
}

/** The message a refusal carries, in Wobo's voice, or the one line for a refusal with none. */
export function refusalMessage(body: unknown, fallback: string = SENT_ELSEWHERE): string {
  if (body && typeof body === 'object') {
    const detail = (body as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const m = (detail as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m;
    }
  }
  return fallback;
}

export function looksLikeEmail(text: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text.trim());
}

type Fetch = typeof gatewayFetch;

export async function readParentLink(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<ParentLinkStatus | null> {
  if (!gatewayUrl) return null;
  try {
    const res = await fetcher(`${gatewayUrl}/v1/me/parent-link`);
    if (!res.ok) return null;
    return parseStatus(await res.json());
  } catch {
    return null;
  }
}

export async function inviteParent(
  input: { email: string; learnerName?: string; timezone?: string },
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<InviteOutcome> {
  if (!gatewayUrl) return { ok: false, message: SENT_ELSEWHERE };
  try {
    const res = await fetcher(`${gatewayUrl}/v1/me/parent-invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: input.email.trim(),
        ...(input.learnerName ? { learner_name: input.learnerName } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: refusalMessage(body) };
    const status = parseStatus(body);
    if (!status) return { ok: false, message: SENT_ELSEWHERE };
    const sent = (body as { sent?: unknown }).sent === true;
    return { ok: true, status, sent };
  } catch {
    return { ok: false, message: SENT_ELSEWHERE };
  }
}

export async function endParentLink(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<EndOutcome> {
  if (!gatewayUrl) return { ok: false, message: END_FAILED };
  try {
    const res = await fetcher(`${gatewayUrl}/v1/me/parent-link`, { method: 'DELETE' });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: refusalMessage(body, END_FAILED) };
    // A 200 the screen cannot parse is still a link the SERVER says is gone: the write landed,
    // and the only thing missing is the sentence for it.
    return { ok: true, status: parseStatus(body) };
  } catch {
    return { ok: false, message: END_FAILED };
  }
}

/** The learner's own timezone, by its IANA name, for the Sunday note's clock. */
export function ownTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
