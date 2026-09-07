import { describe, expect, it } from 'bun:test';
import { DEV_DEFAULTS } from '../src/config';
import { InMemoryEventProvider, SupabaseOutboxEventProvider } from '../src/events';
import {
  emptyLearnerState,
  type KVStorage,
  type LearnerState,
  LocalStateProvider,
  mergeLearnerState,
  mergeThread,
  normalizeLearnerState,
  STATE_CACHE_KEY,
  SupabaseStateProvider,
  type ThreadSnapshot,
} from '../src/state';
import type { RestFilter } from '../src/supabase';
import { SYNC_TROUBLE_AFTER, SyncHealth } from '../src/sync-health';

function state(partial: Partial<LearnerState>): LearnerState {
  return { ...emptyLearnerState(), ...partial };
}

class FakeStorage implements KVStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('mergeLearnerState reconciliation', () => {
  it('takes the max of monotonic counters and unions the sets', () => {
    const a = state({
      xp: 300,
      completedTopics: ['m1-1'],
      awardedOnce: ['account'],
      topicProgress: { 'm1-1': 1, 'm2-1': 0.4 },
    });
    const b = state({
      xp: 220,
      completedTopics: ['m2-1'],
      awardedOnce: ['profile_photo'],
      topicProgress: { 'm2-1': 0.7 },
    });
    const merged = mergeLearnerState(a, b);
    expect(merged.xp).toBe(300);
    expect(merged.completedTopics.sort()).toEqual(['m1-1', 'm2-1']);
    expect(merged.awardedOnce.sort()).toEqual(['account', 'profile_photo']);
    expect(merged.topicProgress).toEqual({ 'm1-1': 1, 'm2-1': 0.7 });
  });

  it('is order-independent on the union/max fields', () => {
    const a = state({ xp: 10, completedTopics: ['x'], topicProgress: { x: 0.2 } });
    const b = state({ xp: 90, completedTopics: ['y'], topicProgress: { x: 0.9 } });
    const ab = mergeLearnerState(a, b);
    const ba = mergeLearnerState(b, a);
    expect(ab.xp).toBe(ba.xp);
    expect(ab.topicProgress).toEqual(ba.topicProgress);
    expect(new Set(ab.completedTopics)).toEqual(new Set(ba.completedTopics));
  });

  it('keeps the larger streak when both copies share the active day', () => {
    const merged = mergeLearnerState(
      state({ streakDays: 4, lastActiveDay: '2026-07-06' }),
      state({ streakDays: 9, lastActiveDay: '2026-07-06' }),
    );
    expect(merged.streakDays).toBe(9);
    expect(merged.lastActiveDay).toBe('2026-07-06');
  });

  it('continues the chain when the other device was active the day before', () => {
    // Remote device kept a 10-day streak through yesterday; this device started fresh today.
    const merged = mergeLearnerState(
      state({ streakDays: 1, lastActiveDay: '2026-07-06' }),
      state({ streakDays: 10, lastActiveDay: '2026-07-05' }),
    );
    expect(merged.streakDays).toBe(11);
    expect(merged.lastActiveDay).toBe('2026-07-06');
  });

  it('resets honestly when the copies are more than a day apart', () => {
    const merged = mergeLearnerState(
      state({ streakDays: 2, lastActiveDay: '2026-07-06' }),
      state({ streakDays: 30, lastActiveDay: '2026-06-20' }),
    );
    expect(merged.streakDays).toBe(2);
  });

  it('lets the fresher mind win key conflicts while keeping the union', () => {
    const merged = mergeLearnerState(
      state({ mind: { voice: 'on', theme: 'dusk' }, updatedAt: '2026-07-06T10:00:00Z' }),
      state({ mind: { voice: 'off' }, updatedAt: '2026-07-06T12:00:00Z' }),
    );
    expect(merged.mind).toEqual({ voice: 'off', theme: 'dusk' });
    expect(merged.updatedAt).toBe('2026-07-06T12:00:00Z');
  });

  it('normalizes a legacy cache shape (no mind/updatedAt) without losing progress', () => {
    const legacy = normalizeLearnerState({
      xp: 120,
      streakDays: 3,
      lastActiveDay: '2026-07-01',
      completedTopics: ['m1-1'],
      awardedOnce: [],
    } as Partial<LearnerState>);
    expect(legacy.xp).toBe(120);
    expect(legacy.mind).toEqual({});
    expect(legacy.topicProgress).toEqual({});
    expect(legacy.updatedAt).toBeTruthy();
  });
});

describe('mergeThread reconciliation', () => {
  const turnsA = [{ id: '1', role: 'wobo' as const, text: 'hello' }];
  const turnsB = [
    { id: '1', role: 'wobo' as const, text: 'hello' },
    { id: '2', role: 'user' as const, text: 'hi' },
  ];

  it('newer snapshot wins whole', () => {
    const older: ThreadSnapshot = { turns: turnsB, updatedAt: '2026-07-06T09:00:00Z' };
    const newer: ThreadSnapshot = { turns: turnsA, updatedAt: '2026-07-06T11:00:00Z' };
    expect(mergeThread(older, newer)).toBe(newer);
    expect(mergeThread(newer, older)).toBe(newer);
  });

  it('on an equal stamp the longer transcript wins', () => {
    const a: ThreadSnapshot = { turns: turnsA, updatedAt: '2026-07-06T09:00:00Z' };
    const b: ThreadSnapshot = { turns: turnsB, updatedAt: '2026-07-06T09:00:00Z' };
    expect(mergeThread(a, b)).toBe(b);
  });
});

describe('LocalStateProvider', () => {
  it('round-trips state and threads through the cache keys', async () => {
    const storage = new FakeStorage();
    const provider = new LocalStateProvider(storage);
    const s = state({ xp: 42, completedTopics: ['m1-1'] });
    provider.save(s);
    expect((await provider.hydrate()).xp).toBe(42);
    provider.saveThread('wobo', [{ id: 't1', role: 'user', text: 'hey' }]);
    const thread = provider.loadThreadCache('wobo');
    expect(thread?.turns[0]?.text).toBe('hey');
    // Same keys the app has always used.
    expect(storage.map.has(STATE_CACHE_KEY)).toBe(true);
    expect(storage.map.has('wobo-conversation-v1')).toBe(true);
  });

  it('reads a legacy bare-array conversation cache', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'wobo-conversation-v1',
      JSON.stringify([{ id: 'seed', role: 'wobo', text: 'ask me anything' }]),
    );
    const thread = new LocalStateProvider(storage).loadThreadCache('wobo');
    expect(thread?.turns).toHaveLength(1);
  });

  it("carries a pre-rebrand conversation over: the old key and the old 'vidya' role both read", () => {
    const storage = new FakeStorage();
    storage.setItem(
      'wobo-vidya-conversation-v1',
      JSON.stringify({
        turns: [{ id: 'a', role: 'vidya', text: 'from before the rename' }],
        updatedAt: '2026-07-06T08:00:00Z',
      }),
    );
    const provider = new LocalStateProvider(storage);
    const thread = provider.loadThreadCache('wobo');
    expect(thread?.turns).toEqual([{ id: 'a', role: 'wobo', text: 'from before the rename' }]);
    // The next save migrates it onto the new key; the legacy one is left untouched.
    provider.saveThread('wobo', thread?.turns ?? []);
    expect(storage.map.has('wobo-conversation-v1')).toBe(true);
  });
});

describe('SupabaseStateProvider hydration', () => {
  const SUBJECT = '00000000-0000-7000-8000-000000000001';
  // Live mode scopes the local cache to the account so two users on one browser never share a
  // bucket — the provider reads/writes under these per-subject keys, not the bare legacy keys.
  const SCOPED_STATE = `${STATE_CACHE_KEY}:${SUBJECT}`;
  const SCOPED_WOBO = `wobo-conversation-v1:${SUBJECT}`;

  function fakeRest(remoteRow: Record<string, unknown> | null) {
    const upserts: { table: string; row: Record<string, unknown> }[] = [];
    return {
      upserts,
      rest: {
        selectOne: async () => remoteRow,
        upsert: async (table: string, row: Record<string, unknown>) => {
          upserts.push({ table, row });
        },
      },
    };
  }

  it('merges the remote row over the local cache and pushes the merged truth back', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      SCOPED_STATE,
      JSON.stringify(state({ xp: 100, completedTopics: ['m1-1'], lastActiveDay: '2026-07-06' })),
    );
    const { rest, upserts } = fakeRest({
      subject_id: SUBJECT,
      xp: 250,
      streak_days: 6,
      last_active_day: '2026-07-05',
      completed_topics: ['m2-1'],
      topic_progress: { 'm2-1': 0.5 },
      awarded_once: ['account'],
      mind: {},
      client_updated_at: '2026-07-05T10:00:00Z',
    });
    const provider = new SupabaseStateProvider(rest, SUBJECT, storage, 1);
    const merged = await provider.hydrate();
    expect(merged.xp).toBe(250);
    expect(merged.completedTopics.sort()).toEqual(['m1-1', 'm2-1']);
    expect(merged.streakDays).toBe(7); // remote chain through yesterday continues today
    // Cache now holds the merged truth; the merged row went back up.
    expect(JSON.parse(storage.map.get(SCOPED_STATE) ?? '{}').xp).toBe(250);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.row.xp).toBe(250);
  });

  it('degrades to the local cache when the network is down', async () => {
    const storage = new FakeStorage();
    storage.setItem(SCOPED_STATE, JSON.stringify(state({ xp: 77 })));
    const provider = new SupabaseStateProvider(
      {
        selectOne: async () => {
          throw new Error('offline');
        },
        upsert: async () => {
          throw new Error('offline');
        },
      },
      SUBJECT,
      storage,
      1,
    );
    expect((await provider.hydrate()).xp).toBe(77);
  });

  it('prefers the fresher remote conversation on thread hydrate', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      SCOPED_WOBO,
      JSON.stringify({
        turns: [{ id: 'a', role: 'wobo', text: 'old' }],
        updatedAt: '2026-07-06T08:00:00Z',
      }),
    );
    const { rest } = fakeRest({
      subject_id: SUBJECT,
      thread: 'wobo',
      turns: [
        { id: 'a', role: 'wobo', text: 'old' },
        { id: 'b', role: 'user', text: 'new from the other device' },
      ],
      client_updated_at: '2026-07-06T09:30:00Z',
    });
    const provider = new SupabaseStateProvider(rest, SUBJECT, storage, 1);
    const merged = await provider.hydrateThread('wobo');
    expect(merged?.turns).toHaveLength(2);
    // The cache was reconciled too.
    expect((JSON.parse(storage.map.get(SCOPED_WOBO) ?? '{}') as ThreadSnapshot).turns).toHaveLength(
      2,
    );
  });

  it("falls back to the pre-rebrand 'vidya' thread row when no 'wobo' row exists yet", async () => {
    const queries: RestFilter[] = [];
    const rest = {
      selectOne: async (_table: string, filter: RestFilter) => {
        queries.push(filter);
        if (filter.match.thread === 'vidya') {
          return {
            subject_id: SUBJECT,
            thread: 'vidya',
            turns: [{ id: 'a', role: 'vidya', text: 'from before the rename' }],
            client_updated_at: '2026-07-06T09:30:00Z',
          };
        }
        return null;
      },
      upsert: async () => {},
    };
    const merged = await new SupabaseStateProvider(
      rest,
      SUBJECT,
      new FakeStorage(),
      1,
    ).hydrateThread('wobo');
    expect(merged?.turns).toEqual([{ id: 'a', role: 'wobo', text: 'from before the rename' }]);
    expect(queries.some((q) => q.match.thread === 'wobo')).toBe(true);
  });
});

describe('SupabaseOutboxEventProvider batching', () => {
  it('flushes recorded events to the outbox in one batch and re-queues on failure', async () => {
    const calls: unknown[][] = [];
    let fail = true;
    const rest = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        if (fail) throw new Error('offline');
        calls.push(args.p_events as unknown[]);
        return calls.length;
      },
    };
    const kgtopg = { consume: async () => ({ accepted: true, deduped: false }) };
    const provider = new SupabaseOutboxEventProvider(DEV_DEFAULTS, kgtopg, rest, 60_000);

    const payload = {
      surface: 'pwa' as const,
      app_version: '0.0.0',
      locale: 'en-IN',
      resumed: false,
    };
    provider.record('session.started.v1', payload);
    provider.record('session.started.v1', { ...payload, resumed: true });

    // Offline: the batch is kept, nothing lost.
    expect(await provider.flush()).toBe(0);
    expect(provider.pendingCount).toBe(2);

    // Back online: one rpc call carries the whole batch, in order.
    fail = false;
    expect(await provider.flush()).toBe(2);
    expect(provider.pendingCount).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);

    // The local log/mastery path was never blocked.
    expect(provider.getLog()).toHaveLength(2);
  });

  /**
   * A refusal that will never stop being a refusal (RLS, or an outbox row whose subject no longer
   * matches the session) used to re-arm the same 800ms timer forever: a hot loop against a server
   * that had already said no, for as long as the tab stayed open. Each failure now waits longer
   * than the last, and the wait is capped so a genuinely-returning network is still picked up.
   */
  it('backs off instead of hammering a store that keeps refusing', async () => {
    const rest = {
      rpc: async () => {
        throw new Error('remote store rpc outbox_append_batch failed: 403 permission denied');
      },
    };
    const kgtopg = { consume: async () => ({ accepted: true, deduped: false }) };
    const provider = new SupabaseOutboxEventProvider(DEV_DEFAULTS, kgtopg, rest, 800);
    provider.record('session.started.v1', {
      surface: 'pwa' as const,
      app_version: '0.0.0',
      locale: 'en-IN',
      resumed: false,
    });

    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await provider.flush();
      waits.push(provider.nextAttemptInMs);
    }
    expect(waits[0]).toBe(1_600);
    expect(waits[1]).toBe(3_200);
    expect(waits[3]).toBeGreaterThan(waits[2] as number);
    expect(provider.pendingCount).toBe(1); // nothing was thrown away
    provider.stop();
  });

  it('counts a refused flush so the learner can be told, and clears it when one lands', async () => {
    let fail = true;
    const rest = {
      rpc: async () => {
        if (fail) throw new Error('offline');
        return 1;
      },
    };
    const kgtopg = { consume: async () => ({ accepted: true, deduped: false }) };
    const health = new SyncHealth();
    const provider = new SupabaseOutboxEventProvider(
      DEV_DEFAULTS,
      kgtopg,
      rest,
      60_000,
      20,
      health,
    );
    provider.record('session.started.v1', {
      surface: 'pwa' as const,
      app_version: '0.0.0',
      locale: 'en-IN',
      resumed: false,
    });
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) await provider.flush();
    expect(health.status().stores).toContain('events');

    fail = false;
    await health.retry();
    expect(health.status().troubled).toBe(false);
    provider.stop();
  });
});

// --- Wave 3: the local cache is per-account, and the pre-scope bucket is adopted exactly once ----

describe('LocalStateProvider account scoping', () => {
  const SUB_A = '00000000-0000-7000-8000-00000000000a';
  const SUB_B = '00000000-0000-7000-8000-00000000000b';

  it('keys the cache to the signed-in subject, so a second learner reads their own bucket', () => {
    const storage = new FakeStorage();
    new LocalStateProvider(storage, SUB_A).save(state({ xp: 400 }));
    expect(storage.map.has(`${STATE_CACHE_KEY}:${SUB_A}`)).toBe(true);
    expect(new LocalStateProvider(storage, SUB_B).loadCache().xp).toBe(0);
    expect(new LocalStateProvider(storage, SUB_A).loadCache().xp).toBe(400);
  });

  it('the FIRST subject inherits the pre-scope bucket; the next one starts clean', () => {
    const storage = new FakeStorage();
    // A device that was already in use before it had a session: unscoped keys, no marker.
    storage.setItem(STATE_CACHE_KEY, JSON.stringify(state({ xp: 900 })));
    storage.setItem(
      'wobo-conversation-v1',
      JSON.stringify([{ id: 'a', role: 'wobo', text: 'from before the sign-in' }]),
    );

    const first = new LocalStateProvider(storage, SUB_A);
    expect(first.loadCache().xp).toBe(900);
    expect(first.loadThreadCache('wobo')?.turns).toHaveLength(1);

    // The sibling who signs in next on the same browser gets nothing of theirs.
    const second = new LocalStateProvider(storage, SUB_B);
    expect(second.loadCache().xp).toBe(0);
    expect(second.loadThreadCache('wobo')).toBeNull();
  });

  /**
   * THE SHARED-DEVICE LEAK. Adoption used to COPY: the pre-scope bucket was left sitting under the
   * plain key holding one learner's XP, streak, mind and whole conversation. Every later boot is
   * unscoped for the moment before the session resolves, so the next person to open this browser
   * read it as their own.
   */
  it('takes the pre-scope bucket OFF the device, so the next person reads nothing of theirs', () => {
    const storage = new FakeStorage();
    storage.setItem(STATE_CACHE_KEY, JSON.stringify(state({ xp: 900 })));
    storage.setItem(
      'wobo-conversation-v1',
      JSON.stringify([{ id: 'a', role: 'wobo', text: 'what A told me' }]),
    );

    const first = new LocalStateProvider(storage, SUB_A);
    expect(first.loadCache().xp).toBe(900);
    expect(first.loadThreadCache('wobo')?.turns).toHaveLength(1);

    // Somebody else opens the browser. Their session has not landed yet, so nothing scopes them.
    const beforeAnySession = new LocalStateProvider(storage);
    expect(beforeAnySession.loadCache().xp).toBe(0);
    expect(beforeAnySession.loadThreadCache('wobo')).toBeNull();
  });

  it('adopts once and never re-adopts: a cleared bucket stays cleared', () => {
    const storage = new FakeStorage();
    storage.setItem(STATE_CACHE_KEY, JSON.stringify(state({ xp: 900 })));
    expect(new LocalStateProvider(storage, SUB_A).loadCache().xp).toBe(900);
    // The learner wipes their own progress; the legacy bucket is still sitting there untouched.
    storage.map.delete(`${STATE_CACHE_KEY}:${SUB_A}`);
    expect(new LocalStateProvider(storage, SUB_A).loadCache().xp).toBe(0);
  });

  it('never clobbers a scoped value that already exists', () => {
    const storage = new FakeStorage();
    storage.setItem(STATE_CACHE_KEY, JSON.stringify(state({ xp: 900 })));
    storage.setItem(`${STATE_CACHE_KEY}:${SUB_A}`, JSON.stringify(state({ xp: 12 })));
    expect(new LocalStateProvider(storage, SUB_A).loadCache().xp).toBe(12);
  });

  it('keeps the historical key in a keyless build (no session, no scope)', () => {
    const storage = new FakeStorage();
    new LocalStateProvider(storage).save(state({ xp: 5 }));
    expect(storage.map.has(STATE_CACHE_KEY)).toBe(true);
  });
});

// --- The fixer, 2026-09-07: adoption is per bucket, not once per device; a session that lands
// after the provider was built re-keys it; a sign-out can ask for what is still owed to land ---

describe('the plain bucket belongs to whoever writes it next', () => {
  const SUB_A = '00000000-0000-7000-8000-00000000000a';
  const SUB_B = '00000000-0000-7000-8000-00000000000b';
  const RETIRED_MARKER = 'wobo-state-adopted-v1';

  /**
   * THE SECOND STRANGER. Adoption used to be gated on a once-per-device marker naming the first
   * subject, so the second anonymous learner on the phone wrote the plain bucket for a whole
   * session and lost it on their own reload: their id was not the one on the marker. The plain
   * bucket is always the work of whoever's session has not resolved yet, and it moves under the
   * next subject the device is keyed to, every time.
   */
  it('a second learner on the device adopts the plain bucket their own door-time SDK wrote', () => {
    const storage = new FakeStorage();
    storage.setItem(STATE_CACHE_KEY, JSON.stringify(state({ xp: 900 })));
    expect(new LocalStateProvider(storage, SUB_A).loadCache().xp).toBe(900);
    // A stranger, before their session lands: the plain key again.
    new LocalStateProvider(storage).save(state({ xp: 15 }));
    storage.setItem(
      'wobo-conversation-v1',
      JSON.stringify([{ id: 'b', role: 'user', text: 'mine' }]),
    );
    const second = new LocalStateProvider(storage, SUB_B);
    expect(second.loadCache().xp).toBe(15);
    expect(second.loadThreadCache('wobo')?.turns[0]?.text).toBe('mine');
    expect(storage.map.has(STATE_CACHE_KEY)).toBe(false);
    expect(new LocalStateProvider(storage, SUB_A).loadCache().xp).toBe(900);
  });

  it('takes the retired once-per-device marker off the device: it named a previous learner', () => {
    const storage = new FakeStorage();
    storage.setItem(RETIRED_MARKER, SUB_A);
    new LocalStateProvider(storage, SUB_B);
    expect(storage.map.has(RETIRED_MARKER)).toBe(false);
  });

  /**
   * THE FIRST SESSION. A first visitor's SDK is built before their anonymous session is minted,
   * so until a reload every XP change and every turn landed under the plain key, and nothing
   * moved it. The session tells the provider who it is now, and what was written plain moves.
   */
  it('rekey: a session that lands after the build moves the plain bucket under the new subject', () => {
    const storage = new FakeStorage();
    const provider = new LocalStateProvider(storage);
    provider.save(state({ xp: 40 }));
    provider.saveThread('wobo', [{ id: 't', role: 'user', text: 'my dog is Bruno' }]);
    provider.rekey(SUB_A);
    expect(provider.loadCache().xp).toBe(40);
    expect(provider.loadThreadCache('wobo')?.turns[0]?.text).toBe('my dog is Bruno');
    expect(storage.map.has(STATE_CACHE_KEY)).toBe(false);
    expect(storage.map.has('wobo-conversation-v1')).toBe(false);
    provider.save(state({ xp: 55 }));
    expect(JSON.parse(storage.map.get(`${STATE_CACHE_KEY}:${SUB_A}`) ?? '{}').xp).toBe(55);
    expect(storage.map.has(STATE_CACHE_KEY)).toBe(false);
  });

  it('rekey to the same subject re-reads what was moved under it meanwhile', () => {
    const storage = new FakeStorage();
    const provider = new LocalStateProvider(storage, SUB_A);
    expect(provider.loadCache().xp).toBe(0);
    storage.setItem(`${STATE_CACHE_KEY}:${SUB_A}`, JSON.stringify(state({ xp: 40 })));
    provider.rekey(SUB_A);
    expect(provider.loadCache().xp).toBe(40);
  });
});

describe('flush: what the debounce still owes lands now, or the caller hears that it did not', () => {
  const SUBJECT = '00000000-0000-7000-8000-000000000001';

  it('pushes the pending state and thread at once and resolves', async () => {
    const storage = new FakeStorage();
    const upserts: string[] = [];
    const provider = new SupabaseStateProvider(
      {
        selectOne: async () => null,
        upsert: async (table: string) => {
          upserts.push(table);
        },
      },
      SUBJECT,
      storage,
      60_000, // a debounce nothing in this test waits for
    );
    provider.save(state({ xp: 777 }));
    provider.saveThread('wobo', [{ id: 't', role: 'user', text: 'offline line' }]);
    expect(upserts).toEqual([]);
    await provider.flush();
    expect(upserts.sort()).toEqual(['learner_state', 'learner_threads']);
  });

  it('rejects when the store cannot be reached, so a sign-out can refuse', async () => {
    const provider = new SupabaseStateProvider(
      {
        selectOne: async () => null,
        upsert: async () => {
          throw new Error('offline');
        },
      },
      SUBJECT,
      new FakeStorage(),
      60_000,
    );
    provider.save(state({ xp: 777 }));
    await expect(provider.flush()).rejects.toThrow('offline');
  });

  it('re-arms the debounce when the push fails, so the next flush sends the work again', async () => {
    let down = true;
    const upserts: string[] = [];
    const provider = new SupabaseStateProvider(
      {
        selectOne: async () => null,
        upsert: async (table: string) => {
          if (down) throw new Error('offline');
          upserts.push(table);
        },
      },
      SUBJECT,
      new FakeStorage(),
      60_000,
    );
    provider.save(state({ xp: 777 }));
    provider.saveThread('wobo', [{ id: 't', role: 'user', text: 'offline line' }]);
    await expect(provider.flush()).rejects.toThrow('offline');
    down = false;
    await provider.flush();
    expect(upserts.sort()).toEqual(['learner_state', 'learner_threads']);
  });

  it('is a resolved no-op with nothing pending, and on the local provider', async () => {
    await expect(new LocalStateProvider(new FakeStorage()).flush()).resolves.toBeUndefined();
    const provider = new SupabaseStateProvider(
      { selectOne: async () => null, upsert: async () => {} },
      SUBJECT,
      new FakeStorage(),
      60_000,
    );
    await expect(provider.flush()).resolves.toBeUndefined();
  });
});

describe('streak-freeze persistence (migration 0007)', () => {
  const SUBJECT = '00000000-0000-7000-8000-000000000007';

  it('round-trips the freeze budget and the pending break through the row', async () => {
    const upserts: Record<string, unknown>[] = [];
    const rest = {
      selectOne: async () => ({
        subject_id: SUBJECT,
        xp: 10,
        streak_days: 4,
        last_active_day: '2026-07-06',
        completed_topics: [],
        topic_progress: {},
        awarded_once: [],
        streak_freezes: { month: '2026-07', used: 2 },
        broken_streak: { days: 9, brokenOn: '2026-07-04' },
        mind: {},
        client_updated_at: '2026-07-06T10:00:00Z',
      }),
      upsert: async (_t: string, row: Record<string, unknown>) => {
        upserts.push(row);
      },
    };
    // A local cache that is older than the row, so the remote copy is the fresher truth.
    const storage = new FakeStorage();
    storage.setItem(
      `${STATE_CACHE_KEY}:${SUBJECT}`,
      JSON.stringify(
        state({
          updatedAt: '2026-01-01T00:00:00Z',
          streakFreezes: { month: '2026-07', used: 0 },
        }),
      ),
    );
    const provider = new SupabaseStateProvider(rest, SUBJECT, storage, 1);
    const merged = await provider.hydrate();
    expect(merged.streakFreezes).toEqual({ month: '2026-07', used: 2 });
    expect(merged.brokenStreak).toEqual({ days: 9, brokenOn: '2026-07-04' });
    expect(upserts[0]?.streak_freezes).toEqual({ month: '2026-07', used: 2 });
    expect(upserts[0]?.broken_streak).toEqual({ days: 9, brokenOn: '2026-07-04' });
  });

  it('falls back to the local defaults when the columns are absent from the row', () => {
    // stateFromRow is exercised through hydrate; a pre-0007 row simply carries neither column.
    const normalized = normalizeLearnerState({ xp: 3 });
    expect(normalized.streakFreezes.used).toBe(0);
    expect(normalized.brokenStreak).toBeUndefined();
  });

  it('degrades to the pre-0007 row shape when the database rejects the new columns', async () => {
    const accepted: Record<string, unknown>[] = [];
    let rejections = 0;
    const rest = {
      selectOne: async () => null,
      upsert: async (_t: string, row: Record<string, unknown>) => {
        if ('streak_freezes' in row) {
          rejections += 1;
          throw new Error(
            "PGRST204: Could not find the 'streak_freezes' column in the schema cache",
          );
        }
        accepted.push(row);
      },
    };
    const provider = new SupabaseStateProvider(rest, SUBJECT, new FakeStorage(), 1);
    const hydrated = await provider.hydrate(); // must not throw, must not lose the row
    expect(hydrated.xp).toBe(0);
    expect(rejections).toBe(1);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).not.toHaveProperty('streak_freezes');
    // The provider remembers: the next write skips the attempt it already knows fails.
    await provider.hydrate();
    expect(rejections).toBe(1);
    expect(accepted).toHaveLength(2);
  });

  it('does not mistake a real write failure for a missing column (no blind retry)', async () => {
    let attempts = 0;
    const rest = {
      selectOne: async () => null,
      upsert: async () => {
        attempts += 1;
        throw new Error('row level security policy violation');
      },
    };
    const provider = new SupabaseStateProvider(rest, SUBJECT, new FakeStorage(), 1);
    // hydrate catches everything (the offline law) — the cache is still the session's truth —
    // but the row is attempted exactly once: only a missing-column error earns the second shape.
    expect((await provider.hydrate()).xp).toBe(0);
    expect(attempts).toBe(1);
  });
});

describe('the event backbone answers for its floating promises', () => {
  const payload = {
    surface: 'pwa' as const,
    app_version: '0.0.0',
    locale: 'en-IN',
    resumed: false,
  };

  it('records a consumer rejection as a diagnostic instead of an unhandled rejection', async () => {
    const provider = new InMemoryEventProvider(DEV_DEFAULTS, {
      consume: async () => {
        throw new Error('mastery view unreachable');
      },
    });
    const event = provider.record('session.started.v1', payload);
    await Promise.resolve(); // let the floating consume settle
    await Promise.resolve();
    expect(provider.consumeFailures).toHaveLength(1);
    expect(provider.consumeFailures[0]?.eventId).toBe(event.event_id);
    expect(provider.consumeFailures[0]?.error).toContain('mastery view unreachable');
    expect(provider.getLog()).toHaveLength(1); // the local log is never blocked by the consumer
  });

  it('re-arms its own timer after a failed flush, so a batch retries without another tap', async () => {
    let attempts = 0;
    let fail = true;
    const rest = {
      rpc: async () => {
        attempts += 1;
        if (fail) throw new Error('offline');
        return 1;
      },
    };
    const kgtopg = { consume: async () => ({ accepted: true, deduped: false }) };
    const provider = new SupabaseOutboxEventProvider(DEV_DEFAULTS, kgtopg, rest, 3);
    provider.record('session.started.v1', payload);

    // One recorded event, nothing else happens on this device: the armed timer fires, fails, and
    // arms itself again — without the re-arm the batch would sit here until the tab closed.
    await Bun.sleep(30);
    expect(attempts).toBeGreaterThan(1);
    expect(provider.pendingCount).toBe(1);

    fail = false;
    await Bun.sleep(30);
    expect(provider.pendingCount).toBe(0);
  });
});
