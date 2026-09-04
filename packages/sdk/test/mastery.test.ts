import { describe, expect, it } from 'bun:test';
import { type Actor, type Context, makeEvent, type WoboEvent } from '@wobo/contracts';
import { ATOM_NODE_IDS, type MasterySnapshot } from '@wobo/kgtopg-contract-seed';
import { createSdk } from '../src/client';
import {
  bandsOf,
  LocalMasteryProvider,
  MASTERY_CACHE_KEY,
  MASTERY_EVIDENCE_CAP,
  mergeMasterySnapshot,
  normalizeMasterySnapshot,
  SupabaseMasteryProvider,
} from '../src/mastery';
import type { KVStorage } from '../src/state';

class Mem implements KVStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const SUBJECT = '00000000-0000-7000-8000-000000000001';
const actor: Actor = {
  subject_id: SUBJECT,
  surface: 'pwa',
  session_id: '00000000-0000-7000-8000-0000000000a1',
};
const context: Context = { app: 'learner', env: 'dev', consent_tier: 'un_elevated' };

function point(id: string, correct = true, independence = 0.95) {
  return { event_id: id, correct, independence, at: '2026-09-04T10:00:00.000Z' };
}

function snapshot(nodeId: string, band: MasterySnapshot['nodes'][string]['band'], ids: string[]) {
  return { nodes: { [nodeId]: { band, evidence: ids.map((id) => point(id)) } } };
}

/**
 * The persisted store used to be unbounded. `save` unioned by event id and never dropped anything,
 * then rewrote the whole blob on every answer: forty answers on one node came back as forty points
 * and roughly five kilobytes for that node alone, growing until localStorage refused the write and
 * mastery persistence died inside a silent catch with no signal at all.
 */
describe('the evidence a node carries is bounded', () => {
  it('keeps the newest answers and drops the rest, however many arrive', () => {
    const storage = new Mem();
    const provider = new LocalMasteryProvider(storage);
    for (let i = 0; i < 40; i++) {
      provider.save({
        nodes: {
          n1: {
            band: 'developing',
            evidence: [
              {
                event_id: `e${String(i).padStart(3, '0')}`,
                correct: true,
                independence: 0.95,
                // Ordered in time, so "newest kept" is a claim the test can actually check.
                at: `2026-09-04T10:${String(i).padStart(2, '0')}:00.000Z`,
              },
            ],
          },
        },
      });
    }
    const held = provider.loadCache().nodes.n1?.evidence ?? [];
    expect(held).toHaveLength(MASTERY_EVIDENCE_CAP);
    expect(held.map((p) => p.event_id)).toContain('e039');
    expect(held.map((p) => p.event_id)).not.toContain('e000');
    // And the blob that is rewritten on every answer stays small.
    expect((storage.map.get(MASTERY_CACHE_KEY) ?? '').length).toBeLessThan(2500);
  });

  it('caps what it reads back too, so a store written by an older build is bounded on load', () => {
    const bloated = {
      nodes: {
        n1: {
          band: 'secure',
          evidence: Array.from({ length: 60 }, (_, i) => ({
            event_id: `e${String(i).padStart(3, '0')}`,
            correct: true,
            independence: 0.95,
            at: `2026-09-04T10:${String(i).padStart(2, '0')}:00.000Z`,
          })),
        },
      },
    };
    const storage = new Mem();
    storage.setItem(MASTERY_CACHE_KEY, JSON.stringify(bloated));
    expect(new LocalMasteryProvider(storage).loadCache().nodes.n1?.evidence).toHaveLength(
      MASTERY_EVIDENCE_CAP,
    );
  });
});

describe('the mastery snapshot', () => {
  it('survives a round trip through storage, and shrugs off a corrupt one', () => {
    const storage = new Mem();
    const provider = new LocalMasteryProvider(storage);
    provider.save(snapshot('n1', 'developing', ['e1', 'e2']));
    expect(bandsOf(new LocalMasteryProvider(storage).loadCache())).toEqual({ n1: 'developing' });

    storage.map.set(MASTERY_CACHE_KEY, 'not json at all');
    expect(new LocalMasteryProvider(storage).loadCache().nodes).toEqual({});
    expect(normalizeMasterySnapshot(null).nodes).toEqual({});
    expect(
      normalizeMasterySnapshot({ nodes: { n: { band: 'secure', evidence: 'nope' } } }).nodes.n,
    ).toEqual({ band: 'secure', evidence: [] });
  });

  it('scopes the cache to the account, so a second learner on the device reads their own', () => {
    const storage = new Mem();
    new LocalMasteryProvider(storage, 'learner-a').save(snapshot('n1', 'secure', ['e1']));
    expect(new LocalMasteryProvider(storage, 'learner-b').loadCache().nodes).toEqual({});
    expect(bandsOf(new LocalMasteryProvider(storage, 'learner-a').loadCache())).toEqual({
      n1: 'secure',
    });
  });

  it('merges two devices by union of evidence, in either order', () => {
    const a = snapshot('n1', 'emerging', ['e1']);
    const b = snapshot('n1', 'developing', ['e2', 'e3']);
    const ab = mergeMasterySnapshot(a, b);
    const ba = mergeMasterySnapshot(b, a);
    expect(ab.nodes.n1?.evidence.map((p) => p.event_id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(ba.nodes.n1?.evidence.map((p) => p.event_id).sort()).toEqual(['e1', 'e2', 'e3']);
    // The band travels with the evidence it was derived from, whichever side that is.
    expect(ab.nodes.n1?.band).toBe('developing');
    expect(ba.nodes.n1?.band).toBe('developing');
  });

  it('lets a band fall, so a topic that stopped holding up can come back around', () => {
    // The richer copy says the learner slipped. Clamping to the higher band would pin the topic at
    // "mastered" forever and the learn board would never bring it back.
    const held = snapshot('n1', 'secure', ['e1', 'e2', 'e3']);
    const fresh = snapshot('n1', 'developing', ['e1', 'e2', 'e3', 'e4']);
    expect(mergeMasterySnapshot(held, fresh).nodes.n1?.band).toBe('developing');
    expect(mergeMasterySnapshot(fresh, held).nodes.n1?.band).toBe('developing');
  });

  it('keeps a fallen band through a save, so the cache never re-inflates it', () => {
    const provider = new LocalMasteryProvider(new Mem());
    provider.save(snapshot('n1', 'secure', ['e1', 'e2', 'e3']));
    provider.save(snapshot('n1', 'developing', ['e1', 'e2', 'e3', 'e4']));
    expect(provider.bands()).toEqual({ n1: 'developing' });
  });

  it('tells its subscribers when a band moves', () => {
    let beats = 0;
    const provider = new LocalMasteryProvider(new Mem());
    const stop = provider.subscribe(() => beats++);
    provider.save(snapshot('n1', 'emerging', ['e1']));
    expect(beats).toBe(1);
    stop();
    provider.save(snapshot('n1', 'developing', ['e2']));
    expect(beats).toBe(1);
  });
});

describe('the live mastery row', () => {
  const rest = (rows: Record<string, unknown>[], failOn?: string) => {
    const writes: Record<string, unknown>[][] = [];
    return {
      writes,
      select: async () => rows,
      upsert: async (_t: string, row: Record<string, unknown> | Record<string, unknown>[]) => {
        const batch = Array.isArray(row) ? row : [row];
        if (failOn && batch.some((r) => failOn in r)) {
          throw new Error(`PGRST204 Could not find the '${failOn}' column`);
        }
        writes.push(batch);
      },
    };
  };

  it('hydrates the remote rows into the cache and writes the union back', async () => {
    const remote = [
      { subject_id: SUBJECT, node_id: 'n1', band: 'developing', evidence: [point('e-remote')] },
    ];
    const store = rest(remote);
    const storage = new Mem();
    const provider = new SupabaseMasteryProvider(store, SUBJECT, storage, 0);
    provider.save(snapshot('n1', 'emerging', ['e-local']));
    const merged = await provider.hydrate();
    expect(merged.nodes.n1?.evidence.map((p) => p.event_id).sort()).toEqual([
      'e-local',
      'e-remote',
    ]);
    expect(store.writes.at(-1)?.[0]?.node_id).toBe('n1');
    expect(store.writes.at(-1)?.[0]?.scope).toBe('node');
  });

  it('keeps the band when the database predates migration 0013', async () => {
    const store = rest([], 'evidence');
    const provider = new SupabaseMasteryProvider(store, SUBJECT, new Mem(), 0);
    provider.save(snapshot('n1', 'secure', ['e1']));
    await provider.hydrate();
    const written = store.writes.at(-1)?.[0];
    expect(written?.band).toBe('secure');
    expect(written).not.toHaveProperty('evidence');
  });

  it('falls back to the cache when the remote read fails, and never throws at the learner', async () => {
    const store = {
      select: async () => {
        throw new Error('offline');
      },
      upsert: async () => {},
    };
    const provider = new SupabaseMasteryProvider(store, SUBJECT, new Mem(), 0);
    provider.save(snapshot('n1', 'secure', ['e1']));
    expect(bandsOf(await provider.hydrate())).toEqual({ n1: 'secure' });
  });
});

describe('the sdk, end to end', () => {
  const evidenceEvent = (nodeId: string, id: string): WoboEvent =>
    makeEvent({
      event_id: id,
      event_type: 'evidence.recorded.v1',
      actor,
      context,
      payload: {
        evidence_id: id,
        node_id: nodeId,
        source: 'practice',
        correct: true,
        independence: 0.95,
        gap_types: [],
      },
    });

  it('carries mastery across a reload instead of starting the topic over', async () => {
    const storage = new Mem();
    (globalThis as { localStorage?: KVStorage }).localStorage = storage;
    try {
      const first = createSdk({ devAuth: true, persistMode: 'local' });
      for (let i = 0; i < 3; i++) {
        await first.kgtopg.mastery.recordEvidence(
          evidenceEvent(ATOM_NODE_IDS.integers, `00000000-0000-7000-8000-00000000ba0${i}`),
        );
      }
      const before = await first.kgtopg.mastery.getBands(first.config.mockSubjectId);
      expect(before.find((b) => b.node_id === ATOM_NODE_IDS.integers)?.band).toBe('secure');

      // A new sdk over the same storage IS the reload. Before this wave it read an empty map.
      const second = createSdk({ devAuth: true, persistMode: 'local' });
      const after = await second.kgtopg.mastery.getBands(second.config.mockSubjectId);
      expect(after.find((b) => b.node_id === ATOM_NODE_IDS.integers)?.band).toBe('secure');
      // And the chooser has moved on with it: integers is done, variables is the next step.
      const next = await second.kgtopg.mastery.getNextBestNode(second.config.mockSubjectId);
      expect(next?.node_id).toBe(ATOM_NODE_IDS.variables);
    } finally {
      (globalThis as { localStorage?: KVStorage }).localStorage = undefined;
    }
  });

  it('emits mastery.band.changed.v1 for every crossing, igniting only at the floor', async () => {
    const sdk = createSdk({ devAuth: true, persistMode: 'local' });
    for (let i = 0; i < 3; i++) {
      await sdk.kgtopg.mastery.recordEvidence(
        evidenceEvent(ATOM_NODE_IDS.variables, `00000000-0000-7000-8000-00000000bb0${i}`),
      );
    }
    const crossings = sdk.events.getLog().filter((e) => e.event_type === 'mastery.band.changed.v1');
    expect(crossings.map((e) => (e.payload as { to_band: string }).to_band)).toEqual([
      'emerging',
      'developing',
      'secure',
    ]);
    expect(crossings.map((e) => (e.payload as { ignite: boolean }).ignite)).toEqual([
      false,
      false,
      true,
    ]);
  });
});
