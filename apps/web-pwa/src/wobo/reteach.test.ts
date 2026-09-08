import { beforeEach, describe, expect, it } from 'bun:test';
import { type EventType, makeEvent, type PayloadOf, type WoboEvent } from '@wobo/contracts';
import type { Sdk } from '@wobo/sdk';

// Bun has no localStorage, and what has already been tried is now DURABLE: it has to survive a
// reload, so the cases below need somewhere for it to survive in.
class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
(globalThis as unknown as { localStorage: Storage }).localStorage =
  (globalThis as unknown as { localStorage?: Storage }).localStorage ??
  (new MemoryStorage() as unknown as Storage);

import {
  APPROACHES,
  type ApproachId,
  chooseApproach,
  conceptMisses,
  dropReteachMemory,
  noteConceptCorrect,
  RETEACH_AFTER_MISSES,
  resetReteach,
  reteachNow,
  reteachOnMiss,
  seedConceptMisses,
  seedFromEvidence,
  triedApproaches,
} from './reteach';

/**
 * The audit's second finding, in one sentence: `learn.modality.switched.v1` has carried a
 * `repeated_miss` reason since the contract was written and nothing ever emitted it, so
 * "if one way does not land we try a different one" was true only when the learner asked.
 * These tests are that claim, written down.
 */

/**
 * An SDK whose recorder is the real contract factory, so a payload the app would reject is
 * rejected here too. Nothing else on the SDK is within this module's reach.
 */
function fakeSdk() {
  const log: WoboEvent[] = [];
  const record = <T extends EventType>(eventType: T, payload: PayloadOf<T>): WoboEvent<T> => {
    const event = makeEvent({
      event_type: eventType,
      payload,
      actor: {
        subject_id: crypto.randomUUID(),
        surface: 'pwa',
        session_id: crypto.randomUUID(),
      },
      context: { app: 'learner', env: 'dev', consent_tier: 'un_elevated' },
    });
    log.push(event as WoboEvent);
    return event;
  };
  const sdk = { events: { record } } as unknown as Sdk;
  return { sdk, log, nodeId: crypto.randomUUID() };
}

const switches = (log: WoboEvent[]) =>
  log.filter((e) => e.event_type === 'learn.modality.switched.v1');

const payloadOf = (e: WoboEvent | undefined) =>
  (e?.payload ?? {}) as { node_id?: string; from?: string; to?: string; reason?: string };

const ctx = (world?: string) => ({ topic: 'Linear equations', world });

/** Every rung the ladder can climb, i.e. everything but the pass that already failed. */
const RUNGS = APPROACHES.filter((a) => a.id !== 'explain');

beforeEach(resetReteach);

describe('repeated miss is detected', () => {
  it('one wrong answer is noise: nothing switches and nothing is recorded', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const turn = reteachOnMiss(sdk, {
      nodeId,
      conceptId: 'c1',
      from: 'worksheet',
      context: ctx(),
    });
    expect(turn).toBeNull();
    expect(switches(log)).toHaveLength(0);
    expect(conceptMisses('c1')).toBe(1);
  });

  it('two wrong on the SAME concept is the signal, and the threshold is the named constant', () => {
    expect(RETEACH_AFTER_MISSES).toBe(2);
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    expect(reteachOnMiss(sdk, opts)).toBeNull();
    expect(reteachOnMiss(sdk, opts)).not.toBeNull();
    expect(switches(log)).toHaveLength(1);
    expect(payloadOf(switches(log)[0]).reason).toBe('repeated_miss');
    expect(payloadOf(switches(log)[0]).node_id).toBe(nodeId);
  });

  it('misses on different concepts do not add up into a switch', () => {
    const { sdk, log, nodeId } = fakeSdk();
    reteachOnMiss(sdk, { nodeId, conceptId: 'c1', from: 'worksheet', context: ctx() });
    reteachOnMiss(sdk, { nodeId, conceptId: 'c2', from: 'worksheet', context: ctx() });
    expect(switches(log)).toHaveLength(0);
  });

  it('a clean answer clears the tally, so one miss either side of it is not a pattern', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    noteConceptCorrect('c1');
    expect(conceptMisses('c1')).toBe(0);
    expect(reteachOnMiss(sdk, opts)).toBeNull();
    expect(switches(log)).toHaveLength(0);
  });

  it('prior misses handed in from persistence count toward the same threshold', () => {
    const { sdk, log, nodeId } = fakeSdk();
    seedConceptMisses('c1', 1);
    const turn = reteachOnMiss(sdk, {
      nodeId,
      conceptId: 'c1',
      from: 'worksheet',
      context: ctx(),
    });
    expect(turn?.misses).toBe(RETEACH_AFTER_MISSES);
    expect(switches(log)).toHaveLength(1);
  });

  it('picks the tally up from the mastery cache, so a session that ended on two misses resumes', () => {
    const { sdk, log, nodeId } = fakeSdk();
    // Oldest first, the way the evidence is kept: a right answer, then two wrong ones.
    expect(
      seedFromEvidence('c1', [{ correct: true }, { correct: false }, { correct: false }]),
    ).toBe(2);
    const turn = reteachNow(sdk, {
      nodeId,
      conceptId: 'c1',
      from: 'worksheet',
      context: ctx(),
    });
    expect(turn?.misses).toBe(2);
    expect(switches(log)).toHaveLength(1);
  });

  it('the run stops at the last right answer, and a session already counting is left alone', () => {
    expect(seedFromEvidence('c1', [{ correct: false }, { correct: true }])).toBe(0);
    expect(conceptMisses('c1')).toBe(0);
    seedConceptMisses('c2', 1);
    // A re-mount mid-lesson must never reset a tally that is already counting.
    expect(seedFromEvidence('c2', [{ correct: true }])).toBe(1);
    expect(conceptMisses('c2')).toBe(1);
  });

  it('a switch resets the tally, so the next one needs its own pattern behind it', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    reteachOnMiss(sdk, opts);
    expect(switches(log)).toHaveLength(1);
    expect(reteachOnMiss(sdk, opts)).toBeNull(); // third miss overall, first since the switch
    expect(switches(log)).toHaveLength(1);
  });
});

describe('the re-teach changes an axis, never volume', () => {
  it('never hands back the explanation that just failed', () => {
    const { sdk, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'opener' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    const turn = reteachOnMiss(sdk, opts);
    expect(turn?.approach.id).not.toBe('explain');
    expect(turn?.to).not.toBe('opener');
    expect(triedApproaches('c1')).toContain('explain');
  });

  it('walks a different rung, on a different axis, each time', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'opener' as const, context: ctx('cricket') };
    const seen: string[] = [];
    for (let i = 0; i < RUNGS.length; i++) {
      reteachOnMiss(sdk, opts);
      const turn = reteachOnMiss(sdk, opts);
      expect(turn?.fresh).toBe(false);
      seen.push(turn?.approach.id ?? '');
    }
    expect(new Set(seen).size).toBe(RUNGS.length);
    const axes = seen.map((id) => APPROACHES.find((a) => a.id === id)?.axis);
    expect(new Set(axes).size).toBe(RUNGS.length);
    expect(switches(log)).toHaveLength(RUNGS.length);
  });

  it('reports an honest from: the second switch leaves where the first one arrived', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'opener' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    const first = reteachOnMiss(sdk, opts);
    reteachOnMiss(sdk, opts);
    const second = reteachOnMiss(sdk, opts);
    expect(first?.from).toBe('opener');
    expect(String(second?.from)).toBe(String(first?.to));
    expect(payloadOf(switches(log)[0]).to).toBe(payloadOf(switches(log)[1]).from);
  });

  it('once every rung is used it returns to the one used longest ago, with a different example', () => {
    const { sdk, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'opener' as const, context: ctx('cricket') };
    const order: (ApproachId | undefined)[] = [];
    for (let i = 0; i < RUNGS.length; i++) {
      reteachOnMiss(sdk, opts);
      order.push(reteachOnMiss(sdk, opts)?.approach.id);
    }
    reteachOnMiss(sdk, opts);
    const again = reteachOnMiss(sdk, opts);
    expect(again?.fresh).toBe(true);
    expect(again?.approach.id).toBe(order[0]); // used longest ago
    expect(again?.approach.id).not.toBe(order[order.length - 1]); // never the one that just failed
  });
});

describe('the learner’s own world is used, and never invented', () => {
  it('the analogy rung is skipped entirely when the learner has told us nothing', () => {
    const { sdk, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'opener' as const, context: ctx() };
    const chosen: string[] = [];
    for (let i = 0; i < RUNGS.length + 1; i++) {
      chosen.push(reteachNow(sdk, opts)?.approach.id ?? '');
    }
    expect(chosen).not.toContain('their_world');
    expect(chooseApproach('c2', ctx())?.approach.id).not.toBe('their_world');
  });

  it('the analogy rung is offered once a world is known', () => {
    const { sdk, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'opener' as const, context: ctx('cricket') };
    const chosen: string[] = [];
    for (let i = 0; i < RUNGS.length; i++) chosen.push(reteachNow(sdk, opts)?.approach.id ?? '');
    expect(chosen).toContain('their_world');
  });

  it('no rung carries a line of its own: the switch is never announced (DESIGN.md §0.x)', () => {
    for (const a of APPROACHES) expect('line' in a).toBe(false);
    const { sdk, nodeId } = fakeSdk();
    const turn = reteachNow(sdk, { nodeId, conceptId: 'c1', from: 'opener', context: ctx() });
    expect(turn && 'line' in turn).toBe(false);
  });
});

describe('the switch rides the routing that already exists', () => {
  it('every rung carries a sentence in the learner’s voice, not a command language', () => {
    for (const a of APPROACHES) {
      const ask = a.ask(ctx('cricket'));
      expect(ask.trim().length).toBeGreaterThan(0);
      expect(ask).not.toContain('{');
      expect(ask).not.toContain('—'); // copy law: no em dashes
    }
  });

  it('an explicit switch (a learner asking, or frustration read upstream) carries its own reason', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const turn = reteachNow(
      sdk,
      { nodeId, conceptId: 'c1', from: 'worksheet', context: ctx() },
      'frustration',
    );
    expect(turn?.reason).toBe('frustration');
    expect(payloadOf(switches(log)[0]).reason).toBe('frustration');
  });

  it('a node id the contract refuses loses the evidence, never the second explanation', () => {
    const { sdk, log } = fakeSdk();
    const opts = {
      nodeId: 'custom:black holes',
      conceptId: 'c1',
      from: 'worksheet' as const,
      context: ctx(),
    };
    expect(reteachOnMiss(sdk, opts)).toBeNull(); // first miss is still noise
    const second = reteachOnMiss(sdk, opts);
    expect(second).not.toBeNull(); // the teaching still happens
    expect((second?.ask.length ?? 0) > 0).toBe(true);
    expect(log).toHaveLength(0); // and nothing malformed reached the backbone
  });
});

/**
 * The first and by far most common rung recorded a switch from a modality to itself: the workbook
 * IS a `worksheet` and the `worked` rung declared `worksheet`, so two misses produced one event
 * whose payload said `from: worksheet, to: worksheet`. The event that is supposed to be the
 * evidence that Wobo taught it another way recorded no difference at all.
 */
describe('a switch is a switch', () => {
  it('never records a modality changing to itself, from any starting representation', () => {
    for (const from of ['worksheet', 'opener', 'canvas', 'reading', 'interactive'] as const) {
      resetReteach();
      const { sdk, log, nodeId } = fakeSdk();
      const opts = { nodeId, conceptId: 'c1', from, context: ctx('cricket') };
      for (let i = 0; i < RUNGS.length * 2 + 2; i++) reteachOnMiss(sdk, opts);
      expect(switches(log).length).toBeGreaterThan(0);
      for (const event of switches(log)) {
        const p = payloadOf(event);
        expect(p.from).not.toBe(p.to);
      }
    }
  });

  it('changes approach on the workbook rather than handing back another worksheet', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    reteachOnMiss(sdk, opts);
    expect(switches(log)).toHaveLength(1);
    expect(payloadOf(switches(log)[0]).from).toBe('worksheet');
    expect(payloadOf(switches(log)[0]).to).not.toBe('worksheet');
    expect(payloadOf(switches(log)[0]).reason).toBe('repeated_miss');
  });
});

/**
 * The tried-list lived in a module Map and died on reload, while the miss tally was deliberately
 * restored from durable mastery evidence. So a returning learner came back with misses at two and
 * `tried` reset to ['explain'], and was handed the worked example they had already failed.
 */
describe('what has already been tried survives a reload', () => {
  it('does not hand back a rung the learner already failed in an earlier session', () => {
    const { sdk, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    const first = reteachOnMiss(sdk, opts)?.approach.id;
    expect(first).toBeDefined();

    dropReteachMemory(); // the tab closed and opened again

    expect(triedApproaches('c1')).toContain(first as ApproachId);
    reteachOnMiss(sdk, opts);
    const second = reteachOnMiss(sdk, opts)?.approach.id;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('remembers where the teaching had got to, so the next from is honest', () => {
    const { sdk, log, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    reteachOnMiss(sdk, opts);
    dropReteachMemory();
    reteachOnMiss(sdk, opts);
    reteachOnMiss(sdk, opts);
    const [one, two] = switches(log);
    expect(payloadOf(one).to).toBe(payloadOf(two).from);
  });

  it('a learner who asked to be forgotten is forgotten, durably', () => {
    const { sdk, nodeId } = fakeSdk();
    const opts = { nodeId, conceptId: 'c1', from: 'worksheet' as const, context: ctx() };
    reteachOnMiss(sdk, opts);
    reteachOnMiss(sdk, opts);
    resetReteach();
    dropReteachMemory();
    expect(triedApproaches('c1')).toEqual([]);
    expect(conceptMisses('c1')).toBe(0);
  });
});

/**
 * Four rungs promised a medium the product cannot produce: a simulator to move, a video to replay,
 * a podcast to listen to. All of them resolved to a paragraph of text describing a thing that never
 * arrived, and the video rung's own sentence matched the show_me pattern in modes.ts, so a request
 * for an animation was answered by gliding a cursor at a button.
 */
describe('every rung lands somewhere the product can actually put it', () => {
  it('promises no medium nothing renders', () => {
    const promised = APPROACHES.map((a) => a.modality);
    expect(promised).not.toContain('simulator');
    expect(promised).not.toContain('video');
    expect(promised).not.toContain('podcast');
    expect(promised).not.toContain('minigame');
    expect(promised).not.toContain('flashcard');
  });

  it('no rung’s own sentence is diverted into the cursor-pointing branch', () => {
    // modes.ts classifies "show me ..." as the show_me mode, which points at a control on screen.
    for (const a of APPROACHES) {
      expect(a.ask(ctx('cricket')).toLowerCase()).not.toMatch(/\bshow\s+me\b/);
    }
  });

  it('still moves a different axis at every rung', () => {
    const axes = RUNGS.map((a) => a.axis);
    expect(new Set(axes).size).toBe(axes.length);
  });
});
