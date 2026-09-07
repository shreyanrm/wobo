/**
 * The offline queue for Wobo's mind (docs/MEMORY-LAW.md rule 2, docs/MIND-SYNC-CONTRACT.md §5).
 *
 * The record is on the server; this is the list of what the device still owes it, in order, each
 * write with its own id so a retry counts once. Everything here is pure storage arithmetic: no
 * network, so it is held down to the byte.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

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

const { SCOPED_KEYS, applyScope } = await import('./scope');
const {
  addBumps,
  clearMindQueue,
  enqueueBump,
  enqueueWrite,
  ledgerDelta,
  MIND_QUEUE_KEY,
  MIND_SYNC_KEY,
  overlayPending,
  readQueue,
  readSyncMeta,
  removeQueued,
  thingsOwed,
  writeSyncMeta,
} = await import('./mind-queue');
const { dayOf } = await import('./mind');
type MindState = import('./mind').MindState;

const blank = (): MindState => ({
  latenciesMs: [],
  slips: [],
  dwellSec: {},
  sessionDays: [],
  interests: [],
  facts: [],
  days: {},
});

beforeEach(() => {
  storage.clear();
  applyScope('learner-a');
});

describe('the queue is the learner’s own, and leaves with them', () => {
  it('keeps both keys in SCOPED_KEYS so they move on sign-in and go on sign-out', () => {
    expect(SCOPED_KEYS).toContain(MIND_QUEUE_KEY);
    expect(SCOPED_KEYS).toContain(MIND_SYNC_KEY);
  });

  it('writes under the current learner’s scope and nowhere else', () => {
    enqueueWrite({ remember: { facts: ['exam on friday'], interests: [] } });
    expect(storage.getItem(`${MIND_QUEUE_KEY}::learner-a`)).not.toBeNull();
    expect(storage.getItem(MIND_QUEUE_KEY)).toBeNull();
  });
});

describe('enqueueWrite', () => {
  it('appends in order, with a fresh id and a stamp on each', () => {
    const a = enqueueWrite(
      { remember: { facts: ['a'], interests: [] } },
      new Date('2026-09-05T10:00:00Z'),
    );
    const b = enqueueWrite(
      { forget: { facts: ['b'], interests: [] } },
      new Date('2026-09-05T10:00:01Z'),
    );
    const q = readQueue();
    expect(q.map((w) => w.id)).toEqual([a.id, b.id]);
    expect(a.id).not.toBe(b.id);
    expect(a.at).toBe('2026-09-05T10:00:00.000Z');
    expect(q[1]?.forget?.facts).toEqual(['b']);
  });

  it('survives a corrupt store by starting an empty queue', () => {
    storage.setItem(`${MIND_QUEUE_KEY}::learner-a`, '{not json');
    expect(readQueue()).toEqual([]);
  });

  it('removeQueued drops exactly the ids it is given', () => {
    const a = enqueueWrite({ remember: { facts: ['a'], interests: [] } });
    const b = enqueueWrite({ remember: { facts: ['b'], interests: [] } });
    removeQueued([a.id]);
    expect(readQueue().map((w) => w.id)).toEqual([b.id]);
    clearMindQueue();
    expect(readQueue()).toEqual([]);
    expect(storage.getItem(`${MIND_QUEUE_KEY}::learner-a`)).toBeNull();
  });
});

describe('bumps: what happened on this device, added and never compared', () => {
  it('addBumps sums every counter and ORs the evening flag', () => {
    const sum = addBumps(
      { days: { '2026-09-05': { answered: 2, evening: false } }, dwell: { practice: 10 } },
      {
        days: {
          '2026-09-05': { answered: 3, wrong: 1, evening: true },
          '2026-09-06': { asked: 1 },
        },
        dwell: { practice: 5, chat: 7 },
      },
    );
    expect(sum.days['2026-09-05']).toEqual({ answered: 5, wrong: 1, evening: true });
    expect(sum.days['2026-09-06']).toEqual({ asked: 1 });
    expect(sum.dwell).toEqual({ practice: 15, chat: 7 });
  });

  it('coalesces into the tail write rather than growing the queue on every pulse', () => {
    enqueueBump({ days: { '2026-09-05': { answered: 1 } }, dwell: {} });
    enqueueBump({ days: { '2026-09-05': { answered: 2 } }, dwell: { practice: 4 } });
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.bump).toEqual({
      days: { '2026-09-05': { answered: 3 } },
      dwell: { practice: 4 },
    });
  });

  it('never coalesces into a write that is already on the wire (its id must count once)', () => {
    const first = enqueueBump({ days: { '2026-09-05': { answered: 1 } }, dwell: {} });
    enqueueBump({ days: { '2026-09-05': { answered: 2 } }, dwell: {} }, new Set([first?.id ?? '']));
    const q = readQueue();
    expect(q).toHaveLength(2);
    expect(q[0]?.bump?.days['2026-09-05']?.answered).toBe(1);
    expect(q[1]?.bump?.days['2026-09-05']?.answered).toBe(2);
  });

  it('never coalesces into a write the store refused', () => {
    const first = enqueueBump({ days: { '2026-09-05': { answered: 1 } }, dwell: {} });
    const q = readQueue();
    if (q[0]) q[0].refused = true;
    storage.setItem(`${MIND_QUEUE_KEY}::learner-a`, JSON.stringify(q));
    enqueueBump({ days: { '2026-09-05': { answered: 2 } }, dwell: {} });
    expect(readQueue().map((w) => w.id)[0]).toBe(first?.id);
    expect(readQueue()).toHaveLength(2);
  });

  it('an empty bump enqueues nothing', () => {
    expect(enqueueBump({ days: {}, dwell: {} })).toBeNull();
    expect(readQueue()).toEqual([]);
  });
});

describe('ledgerDelta: the difference between two snapshots of one device', () => {
  it('reports only what grew, the evening flag only when it turned on, and rounds dwell', () => {
    const before = blank();
    before.days = { '2026-09-05': { ...dayOf(before, '2026-09-05'), answered: 2, evening: true } };
    before.dwellSec = { practice: 10.2 };
    const after = blank();
    after.days = {
      '2026-09-05': { ...dayOf(after, '2026-09-05'), answered: 5, wrong: 1, evening: true },
      '2026-09-06': { ...dayOf(after, '2026-09-06'), entered: 1, evening: true },
    };
    after.dwellSec = { practice: 23.6, chat: 3.2 };
    expect(ledgerDelta(before, after)).toEqual({
      days: {
        '2026-09-05': { answered: 3, wrong: 1 },
        '2026-09-06': { entered: 1, evening: true },
      },
      dwell: { practice: 13, chat: 3 },
    });
  });

  it('is null when nothing changed, and ignores a day that was pruned (a negative)', () => {
    const before = blank();
    before.days = { '2025-01-01': { ...dayOf(before, '2025-01-01'), answered: 9 } };
    const after = blank();
    expect(ledgerDelta(before, after)).toBeNull();
    expect(ledgerDelta(blank(), blank())).toBeNull();
  });
});

describe('overlayPending: the record, with what this device still owes laid over it', () => {
  it('applies queued forgets, remembers and bumps over the server mind without mutating it', () => {
    enqueueWrite({ forget: { facts: ['plays cricket'], interests: ['cricket'] } });
    enqueueWrite({ remember: { facts: ['exam on friday'], interests: ['space'] } });
    enqueueBump({ days: { '2026-09-05': { answered: 3 } }, dwell: { practice: 5 } });
    const record = blank();
    record.facts = ['plays cricket', 'hates loud rooms'];
    record.interests = ['cricket'];
    record.days = { '2026-09-05': { ...dayOf(record, '2026-09-05'), answered: 5 } };
    record.dwellSec = { practice: 100 };
    const shown = overlayPending(record, readQueue());
    expect(shown.facts).toEqual(['hates loud rooms', 'exam on friday']);
    expect(shown.interests).toEqual(['space']);
    expect(shown.days?.['2026-09-05']?.answered).toBe(8);
    expect(shown.dwellSec.practice).toBe(105);
    expect(record.facts).toEqual(['plays cricket', 'hates loud rooms']);
    expect(record.days?.['2026-09-05']?.answered).toBe(5);
  });

  it('dedupes a remember the record already holds, case-insensitively', () => {
    enqueueWrite({ remember: { facts: ['Exam On Friday'], interests: [] } });
    const record = blank();
    record.facts = ['exam on friday'];
    expect(overlayPending(record, readQueue()).facts).toEqual(['exam on friday']);
  });
});

describe('the sync meta: what this device knows about the record', () => {
  it('is unknown until the record has been read', () => {
    expect(readSyncMeta()).toEqual({
      stored: null,
      updatedAt: null,
      erasedAt: null,
      syncedAt: null,
      parent: false,
    });
  });

  it('round-trips under the learner’s scope', () => {
    writeSyncMeta({
      stored: true,
      updatedAt: '2026-09-05T10:00:03+00:00',
      erasedAt: null,
      syncedAt: '2026-09-05T10:00:04.000Z',
      parent: false,
    });
    expect(readSyncMeta().stored).toBe(true);
    expect(storage.getItem(`${MIND_SYNC_KEY}::learner-a`)).not.toBeNull();
    applyScope('learner-b');
    expect(readSyncMeta().stored).toBeNull();
  });
});

/**
 * The memory page used to count queue ENTRIES: two facts remembered and one of them removed, all
 * offline, showed one fact and said "3 things are waiting to save". A learner counts what they can
 * see. Seen in a browser, 2026-09-07.
 */
describe('thingsOwed: what the learner would count, not how many entries the queue holds', () => {
  it('counts a line once, cancels it against its own forget, and counts the day’s counts as one thing', () => {
    clearMindQueue();
    enqueueWrite({ remember: { facts: ['my dog is bruno'], interests: [] } });
    enqueueWrite({ remember: { facts: ['exam on friday'], interests: [] } });
    enqueueWrite({ forget: { facts: ['my dog is bruno'], interests: [] } });
    expect(thingsOwed(readQueue())).toBe(1);
    // A removal of something the record already holds is a thing waiting too.
    enqueueWrite({ forget: { facts: [], interests: ['chess'] } });
    expect(thingsOwed(readQueue())).toBe(2);
    enqueueBump({ days: { '2026-09-07': { answered: 1 } }, dwell: {} });
    expect(thingsOwed(readQueue())).toBe(3);
    // Remembered again after a forget: back to one thing to save, no removal owed.
    enqueueWrite({ remember: { facts: [], interests: ['chess'] } });
    expect(thingsOwed(readQueue())).toBe(3);
  });

  it('is zero for an empty queue', () => {
    clearMindQueue();
    expect(thingsOwed(readQueue())).toBe(0);
  });
});
