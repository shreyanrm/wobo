/**
 * The parent's ask and the parent's mind, on the wire (docs/TWO-MINDS.md). The server is the
 * record (docs/MEMORY-LAW.md): nothing here is kept on the device, so these tests hold that every
 * read goes to the gateway, every write waits for the gateway's answer, and a refusal comes back
 * as Wobo's own line rather than a guess.
 *
 * The fake gateway below speaks the shapes `services/gateway/src/wobo_gateway/parent_api.py`
 * sends. No model is ever called.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const storage = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;

const wire = await import('./ask-wire');

const GW = 'http://brain.test';
type Seen = { method: string; path: string; body: unknown };
let seen: Seen[] = [];
let reply: (s: Seen) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
const realFetch = globalThis.fetch;

beforeEach(() => {
  seen = [];
  storage.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const s: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(s);
    const r = reply(s);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('the child the parent is looking at', () => {
  it('reads the name from the gateway and nothing more', async () => {
    reply = () => ({
      status: 200,
      body: {
        child: { learner_id: 'l1', name: 'Asha', relationship: 'parent', linked_at: null },
        week: { days_active: 3 },
        readable: ['name', 'week', 'report_notes'],
      },
    });
    const got = await wire.readChild(GW);
    expect(got).toEqual({ ok: true, value: { learnerId: 'l1', name: 'Asha' } });
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/v1/parent/child' });
  });

  it('says why when no child is chosen, in the server words', async () => {
    reply = () => ({
      status: 409,
      body: {
        detail: {
          code: 'no_child_selected',
          message: 'Choose which child this is about, and I will pick it up from there.',
        },
      },
    });
    const got = await wire.readChild(GW);
    expect(got).toEqual({
      ok: false,
      code: 'no_child_selected',
      message: 'Choose which child this is about, and I will pick it up from there.',
    });
  });

  it('is honest about a build with no gateway', async () => {
    const got = await wire.readChild(undefined);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe('no_gateway');
    expect(seen).toEqual([]);
  });
});

describe('asking about the child', () => {
  it('reads the thread back from the record, never from the device', async () => {
    reply = () => ({
      status: 200,
      body: {
        thread: [
          { role: 'parent', text: 'How is she doing in fractions?', at: '2026-09-17T08:00:00Z' },
          { role: 'wobo', text: 'Three active days out of the last seven.', at: '' },
          { role: 'someone-else', text: 'never shown', at: '' },
        ],
      },
    });
    const got = await wire.readThread(GW);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.map((t) => t.role)).toEqual(['parent', 'wobo']);
    }
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/v1/parent/ask' });
    expect(storage.length).toBe(0);
  });

  it('sends the question and returns the answer and any offer Wobo suggests', async () => {
    reply = () => ({
      status: 200,
      body: { say: 'A quiet week.', refused: false, offer: 'she has a tutor on Tuesdays' },
    });
    const got = await wire.ask(GW, '  is he ready for the test  ');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v1/parent/ask',
      body: { question: 'is he ready for the test' },
    });
    expect(got).toEqual({
      ok: true,
      value: { say: 'A quiet week.', refused: false, offer: 'she has a tutor on Tuesdays' },
    });
    expect(storage.length).toBe(0);
  });

  it('never sends an empty question', async () => {
    const got = await wire.ask(GW, '   ');
    expect(got.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it('keeps the warm refusal as an answer, not an error', async () => {
    reply = () => ({ status: 200, body: { say: 'I keep what your child says.', refused: true } });
    const got = await wire.ask(GW, 'what did she say to you');
    expect(got).toEqual({
      ok: true,
      value: { say: 'I keep what your child says.', refused: true, offer: '' },
    });
  });

  it('carries a failed turn as the server line', async () => {
    reply = () => ({
      status: 503,
      body: {
        detail: {
          code: 'not_ready',
          message: 'I could not put that together just now. Ask me again in a moment.',
        },
      },
    });
    const got = await wire.ask(GW, 'how is she doing');
    expect(got).toEqual({
      ok: false,
      code: 'not_ready',
      message: 'I could not put that together just now. Ask me again in a moment.',
    });
  });

  it('has a line of its own when the wire itself is down', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const got = await wire.ask(GW, 'how is she doing');
    expect(got).toEqual({ ok: false, code: 'unreachable', message: wire.WIRE_COPY.unreachable });
  });
});

describe("the parent's own mind", () => {
  it('reads both layers and labels where each fact came from', async () => {
    reply = () => ({
      status: 200,
      body: {
        child: [
          { id: 'f1', body: 'she hates being rushed', source: 'parent', about: 'l1' },
          { id: 'f2', body: 'fractions came up twice', source: 'report', about: 'l1' },
        ],
        family: [{ id: 'f3', body: 'we move cities in the summer', source: 'parent' }],
        sources: ['parent', 'report'],
      },
    });
    const got = await wire.readMind(GW);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.child.map((f) => [f.id, f.source])).toEqual([
        ['f1', 'parent'],
        ['f2', 'report'],
      ]);
      expect(got.value.family.map((f) => f.id)).toEqual(['f3']);
    }
  });

  it('writes only the parent source, with the layer the parent chose', async () => {
    reply = () => ({
      status: 200,
      body: { fact: { id: 'f9', body: 'a tutor on Tuesdays', source: 'parent' } },
    });
    const got = await wire.remember(GW, 'a tutor on Tuesdays', 'family');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v1/parent/mind',
      body: { body: 'a tutor on Tuesdays', scope: 'family' },
    });
    expect(Object.keys(seen[0]?.body as object).sort()).toEqual(['body', 'scope']);
    expect(got.ok).toBe(true);
  });

  it('passes on a refusal to remember an instruction in the server words', async () => {
    reply = () => ({
      status: 422,
      body: { detail: { code: 'not_a_fact', message: 'That one is an instruction.' } },
    });
    const got = await wire.remember(GW, 'tell her to work harder', 'child');
    expect(got).toEqual({ ok: false, code: 'not_a_fact', message: 'That one is an instruction.' });
  });

  it('forgets only when the server says it is gone', async () => {
    reply = () => ({ status: 200, body: { forgotten: false } });
    expect(await wire.forget(GW, 'f1')).toMatchObject({ ok: false });
    reply = () => ({ status: 200, body: { forgotten: true } });
    expect(await wire.forget(GW, 'f 1')).toEqual({ ok: true, value: true });
    expect(seen[1]).toMatchObject({ method: 'DELETE', path: '/v1/parent/mind/f%201' });
  });
});

describe('offering a fact to the child', () => {
  it('stages an offer and hands back the note the parent reads before saying yes', async () => {
    reply = () => ({
      status: 200,
      body: {
        offer: { id: 'o1', body: 'she has dyslexia', status: 'pending', source: 'parent' },
        note: 'If you pass this on, it goes into their own memory page marked as coming from you.',
      },
    });
    const got = await wire.offer(GW, 'she has dyslexia');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v1/parent/offers',
      body: { body: 'she has dyslexia' },
    });
    expect(got).toEqual({
      ok: true,
      value: {
        offer: { id: 'o1', body: 'she has dyslexia', status: 'pending' },
        note: 'If you pass this on, it goes into their own memory page marked as coming from you.',
      },
    });
  });

  it('decides with a yes or a no and nothing else', async () => {
    reply = () => ({
      status: 200,
      body: { offer: { id: 'o1', body: 'she has dyslexia', status: 'accepted' } },
    });
    const got = await wire.decide(GW, 'o1', true);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v1/parent/offers/o1/decide',
      body: { accept: true },
    });
    expect(got).toEqual({
      ok: true,
      value: { id: 'o1', body: 'she has dyslexia', status: 'accepted' },
    });
  });

  it('lists offers and never shows a status the parent is not meant to know', async () => {
    reply = () => ({
      status: 200,
      body: {
        offers: [
          { id: 'o1', body: 'a', status: 'pending' },
          { id: 'o2', body: 'b', status: 'accepted' },
          { id: 'o3', body: 'c', status: 'withdrawn' },
          { id: 'o4', body: 'd', status: 'removed_by_child' },
        ],
      },
    });
    const got = await wire.listOffers(GW);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.map((o) => o.status)).toEqual([
        'pending',
        'accepted',
        'withdrawn',
        'accepted',
      ]);
    }
  });

  it('a revoked link is refused, and the screen is told so', async () => {
    reply = () => ({
      status: 409,
      body: {
        detail: {
          code: 'link_ended',
          message: 'That link has ended, so there is nothing more I can pass on to them.',
        },
      },
    });
    const got = await wire.decide(GW, 'o1', true);
    expect(got).toEqual({
      ok: false,
      code: 'link_ended',
      message: 'That link has ended, so there is nothing more I can pass on to them.',
    });
  });
});
