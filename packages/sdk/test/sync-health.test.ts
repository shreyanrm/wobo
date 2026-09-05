import { afterEach, describe, expect, it } from 'bun:test';
import { LocalMasteryProvider, SupabaseMasteryProvider } from '../src/mastery';
import { emptyLearnerState, type KVStorage, SupabaseStateProvider } from '../src/state';
import { SupabaseRest } from '../src/supabase';
import { SYNC_TROUBLE_AFTER, SyncHealth } from '../src/sync-health';

class Mem implements KVStorage {
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

const SUBJECT = '00000000-0000-7000-8000-0000000000f1';
const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * The counter itself. One failure is weather; a run of them is a fact about the learner's work that
 * they are entitled to be told, because the boot loader has been promising them the opposite.
 */
describe('a run of failed saves stops being silent', () => {
  it('says nothing about one failure, and never before the threshold', () => {
    const health = new SyncHealth();
    for (let i = 0; i < SYNC_TROUBLE_AFTER - 1; i += 1)
      health.failed('progress', new Error('offline'));
    expect(health.status().troubled).toBe(false);
  });

  it('tells the truth once the run reaches the threshold, and names what is waiting', () => {
    const health = new SyncHealth();
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) health.failed('progress', new Error('offline'));
    const status = health.status();
    expect(status.troubled).toBe(true);
    expect(status.stores).toEqual(['progress']);
    expect(status.since).not.toBeNull();
  });

  it('goes quiet the moment a write lands, without the learner doing anything', () => {
    const health = new SyncHealth();
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) health.failed('mastery');
    expect(health.status().troubled).toBe(true);
    health.succeeded('mastery');
    expect(health.status().troubled).toBe(false);
    expect(health.status().since).toBeNull();
  });

  it('tells its subscribers when the answer changes, and only then', () => {
    const health = new SyncHealth();
    let beats = 0;
    health.subscribe(() => {
      beats += 1;
    });
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) health.failed('events');
    expect(beats).toBe(1); // the crossing, not each failure under it
    health.failed('events');
    expect(beats).toBe(1); // still troubled, still the same sentence
    health.succeeded('events');
    expect(beats).toBe(2);
  });

  it('retries the real push, and a retry that fails is just another failure, never a throw', async () => {
    const health = new SyncHealth();
    let attempts = 0;
    health.register('progress', async () => {
      attempts += 1;
      throw new Error('still offline');
    });
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) health.failed('progress');
    await health.retry();
    expect(attempts).toBe(1);
    expect(health.status().troubled).toBe(true);
    expect(health.status().retrying).toBe(false);
  });

  it('clears once the retry lands', async () => {
    const health = new SyncHealth();
    health.register('conversation', async () => undefined);
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) health.failed('conversation');
    await health.retry();
    expect(health.status().troubled).toBe(false);
  });

  it('never retries a store that is working', async () => {
    const health = new SyncHealth();
    let attempts = 0;
    health.register('progress', async () => {
      attempts += 1;
    });
    await health.retry();
    expect(attempts).toBe(0);
  });
});

/**
 * The wiring. These are the exact five swallowed failures from the register: `state.ts:443`,
 * `mastery.ts:303` and the flush in `events.ts:149`. Each one still degrades to the local cache and
 * still never throws at a learner. It just no longer does it in silence.
 */
describe('every remote write answers for itself', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const refusing = () => {
    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;
    return new SupabaseRest({ url: 'https://p.supabase.co', anonKey: 'anon', accessToken: 'jwt' });
  };

  it('counts a refused learner-state push instead of dropping it', async () => {
    const health = new SyncHealth();
    const provider = new SupabaseStateProvider(refusing(), SUBJECT, new Mem(), 0, health);
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) {
      provider.save({ ...emptyLearnerState(), xp: (i + 1) * 10 });
      await settle();
    }
    expect(health.consecutiveFailures('progress')).toBeGreaterThanOrEqual(SYNC_TROUBLE_AFTER);
    expect(health.status().stores).toContain('progress');
    // The learner's work is still on this device. Nothing was lost, only unshared.
    expect(provider.loadCache().xp).toBe(SYNC_TROUBLE_AFTER * 10);
  });

  it('counts a refused conversation push', async () => {
    const health = new SyncHealth();
    const provider = new SupabaseStateProvider(refusing(), SUBJECT, new Mem(), 0, health);
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) {
      provider.saveThread('wobo', [{ id: `t${i}`, role: 'user', text: 'hello' }]);
      await settle();
    }
    expect(health.status().stores).toContain('conversation');
    expect(provider.loadThreadCache('wobo')?.turns).toHaveLength(1);
  });

  it('counts a refused mastery push, the one that has never once landed', async () => {
    const health = new SyncHealth();
    const provider = new SupabaseMasteryProvider(refusing(), SUBJECT, new Mem(), 0, health);
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) {
      provider.save({
        nodes: {
          n1: {
            band: 'secure',
            evidence: [
              { event_id: `e${i}`, correct: true, independence: 1, at: '2026-09-05T00:00:00.000Z' },
            ],
          },
        },
      });
      await settle();
    }
    expect(health.status().stores).toContain('mastery');
  });

  it('reports a store as working again once it starts accepting writes', async () => {
    const health = new SyncHealth();
    const provider = new SupabaseMasteryProvider(refusing(), SUBJECT, new Mem(), 0, health);
    for (let i = 0; i < SYNC_TROUBLE_AFTER; i += 1) {
      provider.save({ nodes: { n1: { band: 'secure', evidence: [] } } });
      await settle();
    }
    expect(health.status().troubled).toBe(true);

    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 201 }))) as typeof fetch;
    await health.retry();
    expect(health.status().troubled).toBe(false);
  });

  it('leaves a local-only build with nothing to report', () => {
    const health = new SyncHealth();
    new LocalMasteryProvider(new Mem(), SUBJECT).save({ nodes: {} });
    expect(health.status().troubled).toBe(false);
  });
});
