/**
 * The facts a parent offered and this learner's parent passed on (docs/TWO-MINDS.md): on the
 * learner's memory page, in the same list as everything else, marked as having come from their
 * parent, and removable for good. They live in the offers store on the gateway and nowhere on the
 * device: this is a read, and a remove that goes to the server or does not happen.
 */

import { gatewayFetch } from '@wobo/sdk';

const OFFERED_PATH = '/v1/me/parent-offered';
const TIMEOUT_MS = 15_000;

export interface OfferedFact {
  id: string;
  body: string;
  createdAt: string;
}

/** What the record holds, or null when it could not be asked (signed out, offline, no gateway). */
export async function listOffered(gatewayUrl: string | undefined): Promise<OfferedFact[] | null> {
  if (!gatewayUrl) return null;
  try {
    const res = await gatewayFetch(`${gatewayUrl}${OFFERED_PATH}`, { method: 'GET' }, TIMEOUT_MS);
    if (!res.ok) return null;
    const body = (await res.json()) as { facts?: unknown };
    if (!Array.isArray(body.facts)) return [];
    const out: OfferedFact[] = [];
    for (const raw of body.facts) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as { id?: unknown; body?: unknown; created_at?: unknown };
      if (typeof o.id !== 'string' || typeof o.body !== 'string' || !o.body.trim()) continue;
      out.push({
        id: o.id,
        body: o.body.trim(),
        createdAt: typeof o.created_at === 'string' ? o.created_at : '',
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Remove one, for good. True only when the server said it is gone; never assumed. */
export async function removeOffered(gatewayUrl: string | undefined, id: string): Promise<boolean> {
  if (!gatewayUrl) return false;
  try {
    const res = await gatewayFetch(
      `${gatewayUrl}${OFFERED_PATH}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      TIMEOUT_MS,
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { removed?: unknown };
    return body.removed === true;
  } catch {
    return false;
  }
}
