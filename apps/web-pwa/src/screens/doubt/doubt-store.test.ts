/**
 * LAW 2 — the photo is the learner's own and obeys the memory law.
 *
 * Account-keyed (the store's key is in `SCOPED_KEYS`, so it moves with the learner and leaves on
 * sign-out), no bytes on the device (the gateway keeps the screened photo in its private bucket),
 * listed on the memory page, and erasable in a way that REACHES THE SERVER: `removeDoubt` sends
 * `DELETE /v1/doubt/{id}` before it forgets locally, and a delete the network refused is queued
 * and drained later rather than pretended.
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

const { SCOPED_KEYS } = await import('../../store/scope');
const {
  DOUBT_ERASE_QUEUE_KEY,
  DOUBTS_KEY,
  drainDoubtErasures,
  loadDoubts,
  MAX_DOUBTS,
  pendingErasures,
  reconcileDoubts,
  removeDoubt,
  saveDoubt,
  stashCapture,
  takeCapture,
  updateDoubt,
} = await import('./doubt-store');

const calls: { url: string; method: string }[] = [];
let answer = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), method: init?.method ?? 'GET' });
  if (answer === 0) throw new TypeError('network down');
  return new Response(
    answer === 200 ? '{"erased":{"doubts":1,"photos":1}}' : '{"code":"trouble"}',
    {
      status: answer,
    },
  );
}) as typeof globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const doubt = (id: string) => ({
  id,
  createdAt: '2026-09-05T10:00:00.000Z',
  reading: '3x + 5 = 20',
  lines: [{ id: 'r1', text: '3x + 5 = 20', box: { x: 0.1, y: 0.2, w: 0.5, h: 0.08 } }],
  width: 1200,
  height: 1600,
  explained: false,
});

beforeEach(() => {
  storage.clear();
  calls.length = 0;
  answer = 200;
});

describe('the store', () => {
  it("is keyed to the learner's account, not the device", () => {
    expect(SCOPED_KEYS).toContain(DOUBTS_KEY);
    expect(SCOPED_KEYS).toContain(DOUBT_ERASE_QUEUE_KEY);
  });

  it('keeps the newest first, one per id, and no more than the memory page shows', () => {
    saveDoubt(doubt('a'));
    saveDoubt(doubt('b'));
    saveDoubt({ ...doubt('a'), reading: 'edited' });
    expect(loadDoubts().map((d) => `${d.id}:${d.reading}`)).toEqual(['a:edited', 'b:3x + 5 = 20']);
    for (let i = 0; i < MAX_DOUBTS + 3; i += 1) saveDoubt(doubt(`n${i}`));
    expect(loadDoubts()).toHaveLength(MAX_DOUBTS);
    expect(loadDoubts()[0]?.id).toBe(`n${MAX_DOUBTS + 2}`);
  });

  it('keeps no bytes: a row is what the memory page needs to list a doubt, and nothing more', () => {
    saveDoubt(doubt('a'));
    expect(storage.map.size).toBe(1);
    const raw = [...storage.map.values()][0] ?? '';
    expect(raw).not.toContain('"data"');
    expect(raw).not.toContain('mediaType');
  });

  it('patches one doubt in place: the topic it was placed under, that it was explained', () => {
    saveDoubt(doubt('a'));
    updateDoubt('a', { topicId: 'm1-1', topicName: 'Linear equations', explained: true });
    expect(loadDoubts()[0]).toMatchObject({ topicId: 'm1-1', explained: true });
  });

  it("the gateway's list is the truth once it answers, and the device's own filing survives", () => {
    saveDoubt({ ...doubt('a'), topicId: 'm1-1', topicName: 'Linear equations' });
    saveDoubt(doubt('gone-elsewhere'));
    const list = reconcileDoubts([doubt('b'), { ...doubt('a'), explained: true }]);
    expect(list.map((d) => d.id)).toEqual(['b', 'a']);
    expect(list[1]).toMatchObject({
      topicId: 'm1-1',
      topicName: 'Linear equations',
      explained: true,
    });
    expect(loadDoubts().some((d) => d.id === 'gone-elsewhere')).toBe(false);
  });

  it('reads back nothing from a corrupt record rather than throwing', () => {
    storage.setItem(DOUBTS_KEY, '{not json');
    expect(loadDoubts()).toEqual([]);
    storage.setItem(DOUBTS_KEY, JSON.stringify([{ id: 'x' }, 42, null]));
    expect(loadDoubts()).toEqual([]);
  });

  it('hands a captured photo from the entry control to the screen exactly once', () => {
    expect(takeCapture()).toBeNull();
    stashCapture({ data: 'AAAA', mediaType: 'image/png', width: 10, height: 10 });
    expect(takeCapture()?.mediaType).toBe('image/png');
    expect(takeCapture()).toBeNull();
    // never written to storage: a photo that has not been read and confirmed is not a memory
    expect(storage.map.size).toBe(0);
  });
});

describe('removing a doubt reaches the server', () => {
  it('sends the delete first and forgets locally after', async () => {
    saveDoubt(doubt('a'));
    const out = await removeDoubt('a', { gatewayUrl: 'http://brain.test' });
    expect(calls).toEqual([{ url: 'http://brain.test/v1/doubt/a', method: 'DELETE' }]);
    expect(out).toEqual({ server: 'erased' });
    expect(loadDoubts()).toEqual([]);
    expect(pendingErasures()).toEqual([]);
  });

  it('a delete the network refused is queued, and drained on the next try', async () => {
    saveDoubt(doubt('a'));
    answer = 0;
    const out = await removeDoubt('a', { gatewayUrl: 'http://brain.test' });
    expect(out).toEqual({ server: 'pending' });
    expect(loadDoubts()).toEqual([]); // gone from this device regardless
    expect(pendingErasures()).toEqual(['a']);
    answer = 502;
    await drainDoubtErasures({ gatewayUrl: 'http://brain.test' });
    expect(pendingErasures()).toEqual(['a']); // the server said the bucket refused; it stays owed
    answer = 200;
    await drainDoubtErasures({ gatewayUrl: 'http://brain.test' });
    expect(pendingErasures()).toEqual([]);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(3);
  });

  it('without a gateway there is no server copy to reach, and it says so', async () => {
    saveDoubt(doubt('a'));
    const out = await removeDoubt('a', { gatewayUrl: null });
    expect(out).toEqual({ server: 'none' });
    expect(calls).toEqual([]);
    expect(loadDoubts()).toEqual([]);
  });

  it('a doubt id never escapes the path unescaped', async () => {
    saveDoubt(doubt('a/../b'));
    await removeDoubt('a/../b', { gatewayUrl: 'http://brain.test' });
    expect(calls[0]?.url).toBe('http://brain.test/v1/doubt/a%2F..%2Fb');
  });
});
