/**
 * THE WIRE (docs/MEMORY-LAW.md, docs/MIND-SYNC-CONTRACT.md): the record is on the server, the
 * device's copy is a cache, and every remember / forget / bump is written through. A write that
 * cannot reach the server is queued, per learner, and replayed in order when it can, idempotent
 * by write id. Nothing here is ever a silent local-only write.
 *
 * The server in this file is a small model of `services/gateway/src/wobo_gateway/mind.py`'s
 * write rule: seed on the first write, confirm-never-introduce after, remember as the only add,
 * forget as a tombstone, bump as a delta, duplicates by write id, the erase floor. Every shape
 * on the wire is the one the contract names.
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
process.env.VITE_GATEWAY_URL = 'http://brain.test';

const { applyScope, forgetScope } = await import('./scope');
const { enqueueBump, readQueue, readSyncMeta } = await import('./mind-queue');
const {
  forgetItem,
  mindSyncStatus,
  resetMindSync,
  retryRefused,
  setMindSyncGate,
  syncMind,
  MIND_SYNC_COPY,
} = await import('./mind-sync');
const {
  dayOf,
  forgetMatching,
  lifetimeSnapshot,
  loadMind,
  MIND_KEY,
  rememberFact,
  rememberInterests,
  removeFact,
  removeInterest,
  saveMind,
} = await import('./mind');
type MindState = import('./mind').MindState;

// --- a small model of the gateway's write rule ---------------------------------------------------

interface Row {
  mind: MindState;
  recent: string[];
  dead: Set<string>;
  erased_at: string | null;
  updated_at: string;
}
const blank = (): MindState => ({
  latenciesMs: [],
  slips: [],
  dwellSec: {},
  sessionDays: [],
  interests: [],
  facts: [],
  days: {},
});
let row: Row | null = null;
type Call = { method: string; path: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
const control = {
  down: false,
  /** Apply the write and then lose the answer, as a dropped connection would. */
  loseAnswer: false,
  answer: null as null | { status: number; body: unknown },
  offered: [] as { id: string; body: string; status: string; source: string; created_at: string }[],
  /** What the device held at the moment each request arrived, for the order proofs. */
  seenLocalFacts: [] as string[][],
  /** A request the test holds open, so something can happen on the device while it is on the wire. */
  hold: null as Promise<void> | null,
};
const view = (extra: Record<string, unknown> = {}) => ({
  mind: row ? row.mind : blank(),
  stored: Boolean(
    row &&
      (row.mind.facts.length ||
        row.mind.interests.length ||
        Object.keys(row.mind.days ?? {}).length ||
        row.mind.latenciesMs.length),
  ),
  updated_at: row?.updated_at ?? null,
  erased_at: row?.erased_at ?? null,
  ...extra,
});
const lower = (s: string) => s.toLowerCase();
function apply(body: Record<string, unknown>): Record<string, unknown> {
  const at =
    typeof body.client_updated_at === 'string' ? body.client_updated_at : new Date().toISOString();
  const id = typeof body.write_id === 'string' ? body.write_id : null;
  if (row?.erased_at && Date.parse(at) <= Date.parse(row.erased_at)) {
    return view({ applied: false, ignored: 'erased', dropped: [] });
  }
  if (row && id && row.recent.includes(id)) {
    return view({ applied: false, ignored: 'duplicate', dropped: [] });
  }
  const snap = (body.mind ?? {}) as Partial<MindState>;
  if (!row) {
    row = {
      mind: { ...blank(), ...structuredClone(snap) } as MindState,
      recent: [],
      dead: new Set(),
      erased_at: null,
      updated_at: '',
    };
  } else {
    // confirm, never introduce: only fields with an identity fold from a snapshot
    row.mind.sessionDays = [...new Set([...row.mind.sessionDays, ...(snap.sessionDays ?? [])])];
    if ((snap.latenciesMs ?? []).length) row.mind.latenciesMs = [...(snap.latenciesMs ?? [])];
  }
  const rem = (body.remember ?? {}) as { facts?: string[]; interests?: string[] };
  for (const f of rem.facts ?? []) {
    row.dead.delete(lower(f));
    if (!row.mind.facts.some((x) => lower(x) === lower(f)))
      row.mind.facts = [...row.mind.facts, f].slice(-12);
  }
  for (const i of rem.interests ?? []) {
    row.dead.delete(lower(i));
    if (!row.mind.interests.some((x) => lower(x) === lower(i)) && row.mind.interests.length < 8)
      row.mind.interests = [...row.mind.interests, i];
  }
  const bump = (body.bump ?? {}) as {
    days?: Record<string, Record<string, unknown>>;
    dwell?: Record<string, number>;
  };
  const days = { ...(row.mind.days ?? {}) };
  for (const [day, led] of Object.entries(bump.days ?? {})) {
    const mine = { ...dayOf(row.mind, day) };
    for (const c of [
      'answered',
      'wrong',
      'asked',
      'helped',
      'kept',
      'entered',
      'seconds',
    ] as const) {
      const n = led[c];
      if (typeof n === 'number') {
        if (!Number.isInteger(n)) throw new Error(`422: ${c} is not an integer`);
        mine[c] += n;
      }
    }
    mine.evening = mine.evening || led.evening === true;
    days[day] = mine;
  }
  row.mind.days = days;
  for (const [s, n] of Object.entries(bump.dwell ?? {})) {
    if (!Number.isInteger(n)) throw new Error('422: dwell is not an integer');
    row.mind.dwellSec[s] = (row.mind.dwellSec[s] ?? 0) + n;
  }
  const gone = (body.forget ?? {}) as { facts?: string[]; interests?: string[] };
  for (const f of gone.facts ?? []) row.dead.add(lower(f));
  for (const i of gone.interests ?? []) row.dead.add(lower(i));
  row.mind.facts = row.mind.facts.filter((f) => !row?.dead.has(lower(f)));
  row.mind.interests = row.mind.interests.filter((i) => !row?.dead.has(lower(i)));
  if (id) row.recent = [...row.recent, id].slice(-16);
  row.updated_at = new Date().toISOString();
  return view({ applied: true, ignored: null, dropped: [] });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const path = new URL(String(url)).pathname;
  const body =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ method, path, body });
  control.seenLocalFacts.push([...loadMind().facts]);
  if (control.down) throw new TypeError('network down');
  if (control.hold) await control.hold;
  if (control.answer) {
    return new Response(JSON.stringify(control.answer.body), {
      status: control.answer.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/v1/me/mind' && method === 'GET') return json(view());
  if (path === '/v1/me/mind' && method === 'PUT' && body) {
    let out: Record<string, unknown>;
    try {
      out = apply(body);
    } catch (e) {
      return json({ detail: [{ msg: String(e) }] }, 422);
    }
    if (control.loseAnswer) throw new TypeError('connection reset');
    return json(out);
  }
  if (path === '/v1/me/mind/forget' && method === 'POST' && body) {
    const needle = lower(String(body.contains));
    const facts = row ? row.mind.facts.filter((f) => lower(f).includes(needle)) : [];
    const interests = row ? row.mind.interests.filter((i) => lower(i).includes(needle)) : [];
    apply({ forget: { facts, interests }, client_updated_at: new Date().toISOString() });
    return json(view({ forgot: { facts, interests } }));
  }
  if (path === '/v1/me/parent-offered' && method === 'GET') return json({ facts: control.offered });
  if (path.startsWith('/v1/me/parent-offered/') && method === 'DELETE') {
    const id = path.slice('/v1/me/parent-offered/'.length);
    const had = control.offered.some((o) => o.id === id);
    control.offered = control.offered.filter((o) => o.id !== id);
    return json({ removed: had, final: true });
  }
  return json({ code: 'not_found' }, 404);
}) as typeof globalThis.fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
  process.env.VITE_GATEWAY_URL = undefined;
});

/** A record another device wrote: the account's truth before this device says anything. */
function seedRecord(mind: Partial<MindState>): void {
  row = {
    mind: { ...blank(), ...mind },
    recent: [],
    dead: new Set(),
    erased_at: null,
    updated_at: '2026-09-05T09:00:00+00:00',
  };
}
const puts = () => calls.filter((c) => c.method === 'PUT' && c.path === '/v1/me/mind');

beforeEach(() => {
  storage.clear();
  row = null;
  calls.length = 0;
  control.down = false;
  control.loseAnswer = false;
  control.answer = null;
  control.offered = [];
  control.seenLocalFacts = [];
  applyScope('learner-a');
  resetMindSync();
  setMindSyncGate(() => 'ready');
});

describe('a) the wire: write-through, the server is the record', () => {
  it('a remembered fact is instant on the device, then one PUT with the remember verb, a write id and a stamp, and the answer is reconciled', async () => {
    seedRecord({ facts: ['hates loud rooms'] });
    rememberFact('exam on friday');
    expect(loadMind().facts).toEqual(['exam on friday']); // instant, before any network
    const outcome = await syncMind();
    expect(outcome).toBe('synced');
    const put = puts()[0];
    expect(put?.body?.remember).toEqual({ facts: ['exam on friday'], interests: [] });
    expect(typeof put?.body?.write_id).toBe('string');
    expect(typeof put?.body?.client_updated_at).toBe('string');
    // the record as it now stands, on the device: the laptop's fact AND this one
    expect(loadMind().facts).toEqual(['hates loud rooms', 'exam on friday']);
    expect(row?.mind.facts).toEqual(['hates loud rooms', 'exam on friday']);
    expect(readQueue()).toEqual([]);
    expect(mindSyncStatus().waiting).toBe(0);
  });

  it('a snapshot sent after the record exists carries no counters: they travel as deltas only', async () => {
    seedRecord({ facts: ['a'] });
    await syncMind({ pull: true });
    const mind = loadMind();
    mind.days = { '2026-09-05': { ...dayOf(mind, '2026-09-05'), answered: 9 } };
    saveMind(mind);
    rememberFact('b');
    await syncMind();
    const snap = puts()[0]?.body?.mind as MindState;
    expect(snap.days ?? {}).toEqual({});
    expect(snap.dwellSec).toEqual({});
  });

  it('offline, every write waits, is counted honestly, and lands in order when the network returns', async () => {
    seedRecord({ facts: [] });
    await syncMind({ pull: true });
    control.down = true;
    rememberFact('first');
    rememberFact('second');
    removeFact('first');
    expect(await syncMind()).toBe('trouble');
    // Three writes are owed, but the learner sees ONE fact waiting: the first was remembered and
    // removed before either reached the record, and the line counts what they can see.
    expect(mindSyncStatus().waiting).toBe(1);
    expect(mindSyncStatus().line).toBe(MIND_SYNC_COPY.trouble(1));
    expect(loadMind().facts).toEqual(['second']); // the device already shows the truth it will send
    control.down = false;
    calls.length = 0; // the attempt made while down is not a landing
    expect(await syncMind({ force: true })).toBe('synced');
    const verbs = puts().map((p) => (p.body?.remember ? 'remember' : 'forget'));
    expect(verbs).toEqual(['remember', 'remember', 'forget']);
    expect(row?.mind.facts).toEqual(['second']);
    expect(mindSyncStatus().waiting).toBe(0);
  });

  it('a write whose answer was lost is retried with the SAME id and counted once', async () => {
    seedRecord({ days: { '2026-09-05': { ...dayOf(blank(), '2026-09-05'), answered: 5 } } });
    await syncMind({ pull: true });
    enqueueBump({ days: { '2026-09-05': { answered: 3 } }, dwell: { practice: 12 } });
    control.loseAnswer = true;
    expect(await syncMind()).toBe('trouble');
    expect(row?.mind.days?.['2026-09-05']?.answered).toBe(8); // it did land
    expect(mindSyncStatus().waiting).toBe(1); // but the device cannot know that yet
    control.loseAnswer = false;
    expect(await syncMind({ force: true })).toBe('synced');
    const [a, b] = puts();
    expect(a?.body?.write_id).toBe(b?.body?.write_id);
    expect(row?.mind.days?.['2026-09-05']?.answered).toBe(8); // once, not eleven
    expect(row?.mind.dwellSec.practice).toBe(12);
    expect(loadMind().days?.['2026-09-05']?.answered).toBe(8);
    expect(mindSyncStatus().waiting).toBe(0);
  });

  it('counters are added on the server, never compared: three here and five there is eight', async () => {
    seedRecord({ days: { '2026-09-05': { ...dayOf(blank(), '2026-09-05'), answered: 5 } } });
    await syncMind({ pull: true });
    enqueueBump({ days: { '2026-09-05': { answered: 3, evening: true } }, dwell: {} });
    await syncMind();
    expect(row?.mind.days?.['2026-09-05']).toMatchObject({ answered: 8, evening: true });
    expect(loadMind().days?.['2026-09-05']?.answered).toBe(8);
  });

  it('the first write against a new account seeds it from the device, without counting the device’s own counters twice', async () => {
    // Anonymous work before sign-in: the local ledger already holds what the queued bump says.
    const mind = loadMind();
    mind.facts = ['exam on friday'];
    mind.days = { '2026-09-05': { ...dayOf(mind, '2026-09-05'), answered: 4 } };
    mind.dwellSec = { practice: 30 };
    saveMind(mind);
    enqueueBump({ days: { '2026-09-05': { answered: 4 } }, dwell: { practice: 30 } });
    rememberFact('plays cricket');
    expect(await syncMind({ pull: true })).toBe('synced');
    expect(row?.mind.facts).toEqual(['exam on friday', 'plays cricket']);
    expect(row?.mind.days?.['2026-09-05']?.answered).toBe(4);
    expect(row?.mind.dwellSec.practice).toBe(30);
    expect(readQueue()).toEqual([]);
    expect(readSyncMeta().stored).toBe(true);
    expect(loadMind().facts).toEqual(['exam on friday', 'plays cricket']);
  });

  /**
   * THE SEED KEPT NO ORDER. The first-ever write folded every queued remember and forget into two
   * unions, and the record applies forget after remember, so a first boot that was offline for
   * "remember X, forget X, remember X" ended with X tombstoned. The seed now carries the FIRST
   * owed write's verbs and the rest follow in order, like every write after it.
   */
  it('a first-ever write keeps the order of what was said: remember X, forget X, remember X ends with X on the record', async () => {
    control.down = true;
    rememberFact('my sister is riya');
    removeFact('my sister is riya');
    rememberFact('my sister is riya');
    expect(await syncMind({ pull: true })).toBe('trouble');
    control.down = false;
    expect(await syncMind({ pull: true, force: true })).toBe('synced');
    expect(row?.mind.facts).toEqual(['my sister is riya']);
    expect(loadMind().facts).toEqual(['my sister is riya']);
    expect(readQueue()).toEqual([]);
  });

  it('the pull before the first write never lets an empty record wipe the device that is about to seed it', async () => {
    const mind = loadMind();
    mind.facts = ['kept from before sign-in'];
    saveMind(mind);
    expect(await syncMind({ pull: true })).toBe('synced');
    expect(loadMind().facts).toEqual(['kept from before sign-in']);
    expect(row?.mind.facts).toEqual(['kept from before sign-in']);
  });

  it('dwell that grew by a fraction of a second goes over the wire as a whole number', async () => {
    seedRecord({ facts: ['a'] });
    await syncMind({ pull: true });
    enqueueBump({ days: {}, dwell: { practice: 12 } });
    expect(await syncMind()).toBe('synced');
    expect(row?.mind.dwellSec.practice).toBe(12);
  });
});

describe('b) forget: the server before the device', () => {
  it('a per-item forget reaches the record before the device lets go, and the record is the answer', async () => {
    seedRecord({ facts: ['plays cricket', 'exam on friday'], interests: ['cricket'] });
    await syncMind({ pull: true });
    calls.length = 0;
    control.seenLocalFacts = [];
    expect(await forgetItem('fact', 'plays cricket')).toBe('server');
    const put = puts()[0];
    expect(put?.body?.forget).toEqual({ facts: ['plays cricket'], interests: [] });
    // when that PUT arrived the device still held the fact: the server forgot first
    expect(control.seenLocalFacts[0]).toContain('plays cricket');
    expect(loadMind().facts).toEqual(['exam on friday']);
    expect(row?.mind.facts).toEqual(['exam on friday']);
    expect(await forgetItem('interest', 'cricket')).toBe('server');
    expect(row?.mind.interests).toEqual([]);
    expect(loadMind().interests).toEqual([]);
  });

  it('offline, the forget is owed and said so, the device forgets, and the tombstone lands later', async () => {
    seedRecord({ facts: ['plays cricket'] });
    await syncMind({ pull: true });
    control.down = true;
    expect(await forgetItem('fact', 'plays cricket')).toBe('queued');
    expect(loadMind().facts).toEqual([]);
    expect(mindSyncStatus().waiting).toBe(1);
    expect(row?.mind.facts).toEqual(['plays cricket']);
    // a pull while the forget is still owed must not put the fact back on the screen
    control.down = false;
    expect(await syncMind({ pull: true, force: true })).toBe('synced');
    expect(row?.mind.facts).toEqual([]);
    expect(row?.dead.has('plays cricket')).toBe(true);
    expect(loadMind().facts).toEqual([]);
    expect(mindSyncStatus().waiting).toBe(0);
  });

  it('“forget about my mother” is answered against the record, not this device’s copy', async () => {
    seedRecord({ facts: ['my mother is unwell', 'exam on friday'] });
    // this device has never held the first fact
    saveMind({ ...blank(), facts: ['exam on friday'] });
    const removed = await forgetMatching('mother');
    expect(removed).toEqual(['my mother is unwell']);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/me/mind/forget')).toBe(true);
    expect(row?.mind.facts).toEqual(['exam on friday']);
    expect(loadMind().facts).toEqual(['exam on friday']);
  });

  it('“forget about …” offline falls back to the device and queues the tombstone', async () => {
    seedRecord({ facts: ['exam on friday'] });
    await syncMind({ pull: true });
    control.down = true;
    expect(await forgetMatching('exam')).toEqual(['exam on friday']);
    expect(loadMind().facts).toEqual([]);
    expect(mindSyncStatus().waiting).toBe(1);
    control.down = false;
    await syncMind({ force: true });
    expect(row?.mind.facts).toEqual([]);
  });
});

describe('c) everything Wobo knows comes from the account', () => {
  it('a fresh device paints the record on sign-in', async () => {
    seedRecord({
      facts: ['exam on friday'],
      interests: ['cricket'],
      sessionDays: ['2026-09-04'],
      days: { '2026-09-04': { ...dayOf(blank(), '2026-09-04'), answered: 7 } },
    });
    expect(loadMind().facts).toEqual([]);
    expect(await syncMind({ pull: true })).toBe('synced');
    const mind = loadMind();
    expect(mind.facts).toEqual(['exam on friday']);
    expect(mind.interests).toEqual(['cricket']);
    expect(mind.days?.['2026-09-04']?.answered).toBe(7);
    expect(readSyncMeta().stored).toBe(true);
    expect(mindSyncStatus().syncedAt).not.toBeNull();
  });

  it('sign-out leaves nothing of the mind, the queue or the meta on the device', async () => {
    seedRecord({ facts: ['exam on friday'] });
    await syncMind({ pull: true });
    control.down = true;
    rememberFact('on the train');
    await syncMind();
    expect([...storage.map.keys()].some((k) => k.endsWith('::learner-a'))).toBe(true);
    forgetScope('learner-a');
    expect([...storage.map.keys()].filter((k) => k.endsWith('::learner-a'))).toEqual([]);
    expect(storage.getItem(MIND_KEY)).toBeNull();
    applyScope('learner-a');
    expect(loadMind().facts).toEqual([]);
    expect(readQueue()).toEqual([]);
  });

  it('a sign-out while a read is on the wire writes nothing: no plain key, no key under the old learner', async () => {
    // Seen in a browser: sign-out drops the session, the scope change starts a pass, the token
    // is gone by the time the request is built, and the empty answer was written under a PLAIN
    // key because nobody was scoped any more. The next person on the phone would read that as
    // their own. Nothing may land unless the learner the pass began for is still the one scoped.
    seedRecord({ facts: ['exam on friday'] });
    await syncMind({ pull: true });
    let release: () => void = () => {};
    control.hold = new Promise<void>((r) => {
      release = r;
    });
    const pass = syncMind({ pull: true, force: true });
    forgetScope('learner-a');
    release();
    await pass;
    const keys = [...storage.map.keys()];
    expect(keys.filter((k) => k.startsWith('wobo-mind') && !k.includes('::'))).toEqual([]);
    expect(keys.filter((k) => k.endsWith('::learner-a'))).toEqual([]);
    control.hold = null;
  });

  it('an erase from another device clears this one and drops the writes made before it', async () => {
    seedRecord({ facts: ['old life'] });
    await syncMind({ pull: true });
    control.down = true;
    rememberFact('stale'); // made before the erase, from the cache the learner then erased
    await syncMind();
    // the learner erases on their phone
    if (row) {
      row.mind = blank();
      row.erased_at = new Date(Date.now() + 1000).toISOString();
    }
    control.down = false;
    expect(await syncMind({ force: true })).toBe('synced');
    expect(loadMind().facts).toEqual([]);
    expect(readQueue()).toEqual([]);
    expect(row?.mind.facts).toEqual([]);
    expect(readSyncMeta().erasedAt).toBe(row?.erased_at ?? null);
  });

  it('an anonymous learner sends nothing, loses nothing, and their words follow them in', async () => {
    setMindSyncGate(() => 'anonymous');
    rememberFact('told wobo before signing up');
    expect(await syncMind({ pull: true })).toBe('sign_in');
    expect(calls).toEqual([]);
    expect(mindSyncStatus().waiting).toBe(1);
    expect(mindSyncStatus().line).toBe(MIND_SYNC_COPY.signIn);
    setMindSyncGate(() => 'ready');
    expect(await syncMind({ pull: true })).toBe('synced');
    expect(row?.mind.facts).toEqual(['told wobo before signing up']);
  });

  it('a keyless build keeps the device as the whole record and says nothing about saving', async () => {
    setMindSyncGate(() => 'none');
    rememberFact('local only build');
    expect(await syncMind()).toBe('none');
    expect(calls).toEqual([]);
    expect(mindSyncStatus().line).toBeNull();
  });

  it('a parent account has no learner mind: the wire stops for good', async () => {
    control.answer = {
      status: 403,
      body: { detail: { code: 'not_a_learner_account', message: 'no' } },
    };
    rememberFact('x');
    expect(await syncMind({ pull: true })).toBe('parent');
    expect(readSyncMeta().parent).toBe(true);
    control.answer = null;
    calls.length = 0;
    expect(await syncMind({ pull: true, force: true })).toBe('parent');
    expect(calls).toEqual([]);
  });
});

describe('failures are never silent, and each one means what the contract says', () => {
  it('a store that said no (500) keeps the write, says so with the support address, and is not retried on its own', async () => {
    seedRecord({ facts: [] });
    await syncMind({ pull: true });
    rememberFact('x');
    control.answer = { status: 500, body: { detail: { code: 'store_refused', message: 'no' } } };
    expect(await syncMind()).toBe('refused');
    expect(mindSyncStatus().refused).toBe(1);
    expect(mindSyncStatus().line).toContain('support@heywobo.com');
    control.answer = null;
    calls.length = 0;
    expect(await syncMind({ force: true })).toBe('synced'); // nothing to send: the refused write waits
    expect(puts()).toEqual([]);
    expect(await retryRefused()).toBe('synced');
    expect(row?.mind.facts).toEqual(['x']);
    expect(mindSyncStatus().refused).toBe(0);
  });

  it('a 503 keeps the write, tells the learner in one calm line, and retries later', async () => {
    seedRecord({ facts: [] });
    await syncMind({ pull: true });
    rememberFact('x');
    control.answer = {
      status: 503,
      body: { detail: { code: 'store_unavailable', message: 'later' } },
    };
    expect(await syncMind()).toBe('trouble');
    expect(mindSyncStatus().waiting).toBe(1);
    expect(mindSyncStatus().line).toBe(MIND_SYNC_COPY.trouble(1));
    control.answer = null;
    expect(await syncMind({ force: true })).toBe('synced');
    expect(row?.mind.facts).toEqual(['x']);
  });

  it('a 429 backs off: the next pulse sends nothing, a forced sync does', async () => {
    seedRecord({ facts: [] });
    await syncMind({ pull: true });
    rememberFact('x');
    control.answer = { status: 429, body: { detail: { code: 'rate_limited', message: 'slow' } } };
    expect(await syncMind()).toBe('rate_limited');
    control.answer = null;
    calls.length = 0;
    expect(await syncMind()).toBe('waiting');
    expect(calls).toEqual([]);
    expect(await syncMind({ force: true })).toBe('synced');
  });

  it('a sign-in-required answer keeps the queue and asks for a sign-in', async () => {
    rememberFact('x');
    control.answer = {
      status: 403,
      body: { detail: { code: 'sign_in_required', message: 'sign in' } },
    };
    expect(await syncMind({ pull: true })).toBe('sign_in');
    expect(mindSyncStatus().waiting).toBe(1);
    expect(readQueue()).toHaveLength(1);
  });

  it('one sync in flight at a time: a second call joins the first', async () => {
    seedRecord({ facts: [] });
    await syncMind({ pull: true });
    rememberFact('x');
    const [a, b] = await Promise.all([syncMind(), syncMind()]);
    expect(a).toBe('synced');
    expect(b).toBe('synced');
    expect(puts()).toHaveLength(1);
  });
});

describe('the interest list and the dossier', () => {
  it('rememberInterests sends what was added as remember and what left as forget', async () => {
    seedRecord({ interests: ['cricket', 'space'] });
    await syncMind({ pull: true });
    rememberInterests(['space', 'music']);
    await syncMind();
    expect(row?.mind.interests).toEqual(['space', 'music']);
    removeInterest('music');
    await syncMind();
    expect(row?.mind.interests).toEqual(['space']);
    expect(loadMind().interests).toEqual(['space']);
  });

  it('d) a remembered fact rides the next turn’s context, and a forgotten one leaves it', async () => {
    seedRecord({ facts: [] });
    await syncMind({ pull: true });
    rememberFact('exam on friday');
    await syncMind();
    expect(lifetimeSnapshot().facts).toContain('exam on friday');
    await forgetItem('fact', 'exam on friday');
    expect(lifetimeSnapshot().facts).not.toContain('exam on friday');
  });
});
