/**
 * SIGN-OUT ASKS FIRST (docs/MEMORY-LAW.md rule 4: a failed write is never silent).
 *
 * Seen in a browser, 2026-09-07: with the gateway and the database unreachable, a learner
 * remembered a fact, sent a chat line, reached a new XP total, and signed out. Sign-out swept the
 * queue, the thread cache and the progress cache with nothing pushed and no warning, and the
 * account had none of it when they signed back in. So before anything is swept, what the device
 * still owes is pushed, and if any of it cannot land the sign-out is refused in one plain line.
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

const { SyncHealth } = await import('@wobo/sdk');
const { applyScope } = await import('./scope');
const { resetMindSync, setMindSyncGate } = await import('./mind-sync');
const { rememberFact } = await import('./mind');
const { settleBeforeSignOut, SIGN_OUT_COPY } = await import('./sign-out');

const net = { down: false };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  if (net.down) throw new TypeError('network down');
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  const facts = method === 'PUT' ? (body?.remember?.facts ?? body?.mind?.facts ?? []) : [];
  return new Response(
    JSON.stringify({
      mind: {
        facts,
        interests: [],
        latenciesMs: [],
        slips: [],
        dwellSec: {},
        sessionDays: [],
        days: {},
      },
      stored: true,
      updated_at: new Date().toISOString(),
      erased_at: null,
      applied: true,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}) as typeof globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  process.env.VITE_GATEWAY_URL = undefined;
});

/**
 * The slice of the SDK the settle needs: a flush that lands or does not, and the retries the
 * providers register with the health counter (the real ones push the cache again).
 */
function fakeSdk(opts: { flushFails?: string[] } = {}) {
  const sync = new SyncHealth();
  let flushes = 0;
  const pushed: string[] = [];
  const failing = new Set(opts.flushFails ?? []);
  for (const store of ['progress', 'conversation', 'mastery'] as const) {
    sync.register(store, async () => {
      if (failing.has(store)) throw new Error('offline');
      pushed.push(store);
    });
  }
  return {
    flushes: () => flushes,
    pushed,
    /** The network comes back: the same pushes land from now on. */
    online: () => failing.clear(),
    sdk: {
      sync,
      state: {
        flush: async () => {
          flushes += 1;
          for (const store of failing) {
            sync.failed(store as 'progress' | 'conversation', new Error('offline'));
          }
          if (failing.size) throw new Error('offline');
        },
      },
      mastery: { flush: async () => undefined },
    },
  };
}

beforeEach(() => {
  storage.clear();
  net.down = false;
  applyScope('learner-a');
  resetMindSync();
  setMindSyncGate(() => 'ready');
});

describe('settleBeforeSignOut', () => {
  it('pushes what is owed and clears the way when everything lands', async () => {
    const { sdk, flushes } = fakeSdk();
    rememberFact('on the way out');
    const verdict = await settleBeforeSignOut(sdk);
    expect(flushes()).toBe(1);
    expect(verdict).toEqual({ owed: 0, line: null });
  });

  it('refuses when the account has not received the work, and says how much and why', async () => {
    net.down = true;
    const { sdk } = fakeSdk({ flushFails: ['progress', 'conversation'] });
    rememberFact('a fact the gateway never saw');
    const verdict = await settleBeforeSignOut(sdk);
    expect(verdict.owed).toBe(3); // the progress, the conversation, the one fact
    expect(verdict.line).toBe(SIGN_OUT_COPY.owed(3));
  });

  /**
   * Seen in a browser, 2026-09-07: the refusal was right, and the second attempt (back online) was
   * refused too, because the failed push was never sent again. One failure is not "trouble" to the
   * health counter, so its button would not have fired either. The settle asks for everything.
   */
  it('"try again" is true: a push that failed once is sent again on the next attempt, and lands', async () => {
    net.down = true;
    const { sdk, online, pushed } = fakeSdk({ flushFails: ['progress', 'conversation'] });
    rememberFact('a fact from the train');
    expect((await settleBeforeSignOut(sdk)).owed).toBe(3);
    net.down = false;
    online();
    expect(await settleBeforeSignOut(sdk)).toEqual({ owed: 0, line: null });
    expect(pushed.sort()).toEqual(['conversation', 'progress']);
  });

  it('says it is the connection when the browser knows it is offline', async () => {
    net.down = true;
    const nav = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
    });
    try {
      const { sdk } = fakeSdk({ flushFails: ['progress'] });
      const verdict = await settleBeforeSignOut(sdk);
      expect(verdict.owed).toBe(1);
      expect(verdict.line).toBe(SIGN_OUT_COPY.offline(1));
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    }
  });

  it('is nothing to say in a keyless build, even with words in the queue: they are owed to nobody', async () => {
    setMindSyncGate(() => 'none');
    rememberFact('a fact in a build with no brain');
    const { sdk } = fakeSdk();
    expect(await settleBeforeSignOut(sdk)).toEqual({ owed: 0, line: null });
  });

  it('never traps an anonymous learner: their queue waits for a sign-in, not for a sign-out', async () => {
    setMindSyncGate(() => 'anonymous');
    rememberFact('told wobo before signing up');
    const { sdk } = fakeSdk();
    expect(await settleBeforeSignOut(sdk)).toEqual({ owed: 0, line: null });
  });
});

describe('the lines', () => {
  it('carry no em dash, no exclamation mark, and count in plain words', () => {
    for (const line of [
      SIGN_OUT_COPY.owed(1),
      SIGN_OUT_COPY.owed(3),
      SIGN_OUT_COPY.offline(1),
      SIGN_OUT_COPY.offline(2),
    ]) {
      expect(line).not.toContain('—');
      expect(line).not.toContain('!');
    }
    expect(SIGN_OUT_COPY.owed(1)).toContain('One thing');
    expect(SIGN_OUT_COPY.owed(3)).toContain('3 things');
  });
});
