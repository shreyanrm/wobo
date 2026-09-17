/**
 * The parent's ask and the parent's own mind, on the wire (docs/TWO-MINDS.md).
 *
 * Every shape here is one `services/gateway/src/wobo_gateway/parent_api.py` sends. The record is
 * the gateway's (docs/MEMORY-LAW.md): nothing in this file writes to the device, every write waits
 * for the server's answer, and a refusal comes back carrying Wobo's own line from the server so
 * the screen never has to guess at one.
 *
 * What is NOT here, because the server has no route for it: the child's conversation, mind,
 * boards, answers or handwriting. A parent's screen cannot ask for what the gateway cannot give.
 */

import { gatewayFetch } from '@wobo/sdk';

const TIMEOUT_MS = 20_000;

/** The two lines this file owns. Every other refusal is the server's own words. */
export const WIRE_COPY = {
  unreachable: 'I could not reach that just now. Try again in a moment.',
  noGateway: 'This needs a connection to Wobo, and there is not one here.',
  empty: 'Write something first, and I will take it from there.',
} as const;

export type Wire<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export interface ChildInView {
  learnerId: string;
  name: string | null;
}

export interface Turn {
  role: 'parent' | 'wobo';
  text: string;
  at: string;
}

export interface Answer {
  say: string;
  /** True when Wobo declined to share the child's own words. Still an answer. */
  refused: boolean;
  /** A fact Wobo heard in the question and would like the parent's leave to pass on, or ''. */
  offer: string;
}

export type MindSource = 'parent' | 'report';

export interface MindFact {
  id: string;
  body: string;
  source: MindSource;
}

export interface ParentMind {
  child: MindFact[];
  family: MindFact[];
}

/** What a parent may know of an offer. What the child did with it afterwards is not one of them. */
export type OfferStatus = 'pending' | 'accepted' | 'withdrawn';

export interface OfferRow {
  id: string;
  body: string;
  status: OfferStatus;
}

export interface Staged {
  offer: OfferRow;
  /** Said by the server at the moment of offering, so nothing is a surprise later. */
  note: string;
}

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function call(
  gatewayUrl: string | undefined,
  path: string,
  init: RequestInit,
): Promise<Wire<Json>> {
  if (!gatewayUrl) return { ok: false, code: 'no_gateway', message: WIRE_COPY.noGateway };
  let res: Response;
  try {
    const headers = init.body ? { 'content-type': 'application/json' } : undefined;
    res = await gatewayFetch(`${gatewayUrl}${path}`, { ...init, headers }, TIMEOUT_MS);
  } catch {
    return { ok: false, code: 'unreachable', message: WIRE_COPY.unreachable };
  }
  let body: Json = {};
  try {
    const parsed = (await res.json()) as unknown;
    if (parsed && typeof parsed === 'object') body = parsed as Json;
  } catch {
    // an unreadable body is treated as the status says
  }
  if (res.ok) return { ok: true, value: body };
  const detail = body.detail && typeof body.detail === 'object' ? (body.detail as Json) : {};
  const code = str(detail.code) || (res.status === 401 ? 'sign_in_required' : 'unreachable');
  const message = str(detail.message).trim() || WIRE_COPY.unreachable;
  return { ok: false, code, message };
}

function map<A, B>(r: Wire<A>, f: (a: A) => B): Wire<B> {
  return r.ok ? { ok: true, value: f(r.value) } : r;
}

function asStatus(v: unknown): OfferStatus {
  // `removed_by_child` reads as passed on: the server already says so, and the screen agrees
  // even if an older gateway does not.
  if (v === 'pending' || v === 'withdrawn') return v;
  return 'accepted';
}

function asOffer(raw: unknown): OfferRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Json;
  const id = str(o.id);
  const body = str(o.body).trim();
  if (!id || !body) return null;
  return { id, body, status: asStatus(o.status) };
}

function asFacts(raw: unknown): MindFact[] {
  if (!Array.isArray(raw)) return [];
  const out: MindFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Json;
    const id = str(f.id);
    const body = str(f.body).trim();
    if (!id || !body) continue;
    out.push({ id, body, source: f.source === 'report' ? 'report' : 'parent' });
  }
  return out;
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

// --- the child in view -------------------------------------------------------------------------
export async function readChild(gatewayUrl: string | undefined): Promise<Wire<ChildInView>> {
  const r = await call(gatewayUrl, '/v1/parent/child', { method: 'GET' });
  if (!r.ok) return r;
  const child = r.value.child && typeof r.value.child === 'object' ? (r.value.child as Json) : {};
  const learnerId = str(child.learner_id);
  if (!learnerId) return { ok: false, code: 'unreachable', message: WIRE_COPY.unreachable };
  const name = str(child.name).trim();
  return { ok: true, value: { learnerId, name: name || null } };
}

// --- the ask -----------------------------------------------------------------------------------
export async function readThread(gatewayUrl: string | undefined): Promise<Wire<Turn[]>> {
  const r = await call(gatewayUrl, '/v1/parent/ask', { method: 'GET' });
  return map(r, (body) => {
    const raw = Array.isArray(body.thread) ? body.thread : [];
    const out: Turn[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Json;
      const text = str(t.text).trim();
      if ((t.role !== 'parent' && t.role !== 'wobo') || !text) continue;
      out.push({ role: t.role, text, at: str(t.at) });
    }
    return out;
  });
}

export async function ask(gatewayUrl: string | undefined, question: string): Promise<Wire<Answer>> {
  const text = question.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, code: 'empty', message: WIRE_COPY.empty };
  const r = await call(gatewayUrl, '/v1/parent/ask', {
    method: 'POST',
    ...json({ question: text }),
  });
  if (!r.ok) return r;
  const say = str(r.value.say).trim();
  if (!say) return { ok: false, code: 'not_ready', message: WIRE_COPY.unreachable };
  return {
    ok: true,
    value: { say, refused: r.value.refused === true, offer: str(r.value.offer).trim() },
  };
}

// --- the parent's own mind ---------------------------------------------------------------------
export async function readMind(gatewayUrl: string | undefined): Promise<Wire<ParentMind>> {
  const r = await call(gatewayUrl, '/v1/parent/mind', { method: 'GET' });
  return map(r, (body) => ({ child: asFacts(body.child), family: asFacts(body.family) }));
}

export async function remember(
  gatewayUrl: string | undefined,
  body: string,
  scope: 'child' | 'family',
): Promise<Wire<MindFact>> {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, code: 'empty', message: WIRE_COPY.empty };
  const r = await call(gatewayUrl, '/v1/parent/mind', {
    method: 'POST',
    ...json({ body: text, scope }),
  });
  if (!r.ok) return r;
  const [fact] = asFacts([r.value.fact]);
  return fact
    ? { ok: true, value: fact }
    : { ok: false, code: 'unreachable', message: WIRE_COPY.unreachable };
}

export async function forget(gatewayUrl: string | undefined, id: string): Promise<Wire<true>> {
  const r = await call(gatewayUrl, `/v1/parent/mind/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!r.ok) return r;
  return r.value.forgotten === true
    ? { ok: true, value: true }
    : { ok: false, code: 'not_forgotten', message: WIRE_COPY.unreachable };
}

// --- offering to the child ---------------------------------------------------------------------
export async function listOffers(gatewayUrl: string | undefined): Promise<Wire<OfferRow[]>> {
  const r = await call(gatewayUrl, '/v1/parent/offers', { method: 'GET' });
  return map(r, (body) =>
    (Array.isArray(body.offers) ? body.offers : [])
      .map(asOffer)
      .filter((o): o is OfferRow => o !== null),
  );
}

export async function offer(gatewayUrl: string | undefined, body: string): Promise<Wire<Staged>> {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, code: 'empty', message: WIRE_COPY.empty };
  const r = await call(gatewayUrl, '/v1/parent/offers', {
    method: 'POST',
    ...json({ body: text }),
  });
  if (!r.ok) return r;
  const row = asOffer(r.value.offer);
  if (!row) return { ok: false, code: 'unreachable', message: WIRE_COPY.unreachable };
  return { ok: true, value: { offer: row, note: str(r.value.note).trim() } };
}

export async function decide(
  gatewayUrl: string | undefined,
  id: string,
  accept: boolean,
): Promise<Wire<OfferRow>> {
  const r = await call(gatewayUrl, `/v1/parent/offers/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    ...json({ accept }),
  });
  if (!r.ok) return r;
  const row = asOffer(r.value.offer);
  return row
    ? { ok: true, value: row }
    : { ok: false, code: 'unreachable', message: WIRE_COPY.unreachable };
}
