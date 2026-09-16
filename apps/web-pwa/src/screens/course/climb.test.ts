/**
 * THE CLIMB AT THE COURSE'S MODULE BOUNDARY (docs/LEARNING-MODEL.md, "The tutor never leaves").
 *
 * `curriculum/group-rechosen.test.ts` proves `groupFor` re-chooses when it is TOLD what beat a
 * learner. On 2026-09-16 nothing in the product told it: the course never recorded a miss against a
 * module, never set `stuckOn`, and never called `groupInPool`. This file plays the seam the course
 * now goes through (`screens/course/climb.ts`), against the real chapter pool, the real tally
 * (`wobo/reteach.ts`) and the real mastery record (`@wobo/sdk`), and proves three things:
 *
 *   1. a miss inside a module is recorded against THAT module, in the tally the product keeps;
 *   2. when a module ends, the modules that beat the learner twice are what `stuckOn` names, and the
 *      group is asked for again, so what follows is a different module and never a harder one;
 *   3. the topic ends at ONE answer: the durable band (`isAtFloor`), which a learner reaches by
 *      answering, and `masteryOf` is gone.
 *
 * Choosing stays free: the whole walk below runs with the network cut.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
// Type-only, so it is erased before this file runs and cannot evaluate the module early.
import type { Walk } from './climb';

/**
 * Bun has no browser storage and the tally is durable on purpose. Installed before the imports
 * below, with `??` so a store another file already installed in this process is left alone.
 */
class MemoryStorage {
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
const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
g.localStorage = g.localStorage ?? (new MemoryStorage() as unknown as Storage);
g.sessionStorage = g.sessionStorage ?? (new MemoryStorage() as unknown as Storage);

const climb = await import('./climb');
const blueprint = await import('../../curriculum/blueprint');
const { pool } = await import('../../suggest/fixture');
const { conceptMisses, RETEACH_AFTER_MISSES, resetReteach } = await import('../../wobo/reteach');
const { createSdk, MASTERY_CACHE_KEY } = await import('@wobo/sdk');

type Module = ReturnType<typeof pool>['modules'][number];

const BP = pool();
const TOPIC = 't4';
const DEPTH: Record<Module['role'], number> = {
  prerequisite: 0,
  repair: 1,
  way_in: 2,
  side_door: 2,
  check: 3,
  stretch: 4,
  boss: 5,
};
const byId = (id: string): Module => BP.modules.find((m) => m.id === id) as Module;

beforeEach(() => {
  resetReteach();
});

/**
 * A SITTING, played the way the course plays one: the module on stage takes the learner's answers,
 * each miss is recorded as it happens, the sitting ends when its answers run out or when the module
 * has beaten them twice, and the climb is asked what follows.
 */
function sit(walk: Walk, module: Module, answers: readonly boolean[]): Module | null {
  let misses = 0;
  for (const right of answers) {
    if (!right) {
      climb.missIn(BP, module.id);
      misses += 1;
    }
    if (climb.beatenBy(BP, module.id)) break;
  }
  return climb.endIn(BP, TOPIC, walk, module.id, misses, climb.atomCardFor);
}

/**
 * A LEARNER WHO GETS EVERY ANSWER WRONG, for `steps` modules. Only a module with answers in it can
 * be failed on the atom: the scale and a worked example ask for none. Returns the modules that beat
 * them, in order, and checks the two laws after every one of them.
 */
function allWrong(walk: Walk, steps: number): string[] {
  let on = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor);
  const beatenBy: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    expect(on, `left with nothing after ${walk.handed.join(' ')}`).not.toBeNull();
    const here = on as Module;
    const answers = climb.atomCardFor(here) === 'practice' ? [false, false, false] : [];
    on = sit(walk, here, answers);
    if (answers.length > 0) {
      beatenBy.push(here.id);
      expect(on?.id, `handed ${here.id} straight after it beat them`).not.toBe(here.id);
      expect(DEPTH[(on as Module).role]).toBeLessThanOrEqual(DEPTH[here.role]);
    }
  }
  return beatenBy;
}

describe('a miss is recorded against the module it happened in', () => {
  it('keys the tally on the pool and the module, never on the topic', () => {
    expect(climb.moduleKey(BP, 'c2')).toContain(BP.node);
    expect(climb.moduleKey(BP, 'c2')).toContain('c2');
    expect(climb.moduleKey(BP, 'c2')).not.toBe(climb.moduleKey(BP, 'p9'));
    climb.missIn(BP, 'c2');
    expect(conceptMisses(climb.moduleKey(BP, 'c2'))).toBe(1);
    expect(conceptMisses(climb.moduleKey(BP, 'p9'))).toBe(0);
  });

  it('calls one miss a slip and two a pattern, by the product’s own threshold', () => {
    climb.missIn(BP, 'c2');
    expect(climb.stuckIn(BP)).toEqual([]);
    expect(climb.beatenBy(BP, 'c2')).toBe(false);
    climb.missIn(BP, 'c2');
    expect(RETEACH_AFTER_MISSES).toBe(2);
    expect(climb.stuckIn(BP)).toEqual(['c2']);
    expect(climb.beatenBy(BP, 'c2')).toBe(true);
  });

  it('takes back a miss the verifier overturned, and only that one', () => {
    climb.missIn(BP, 'c2');
    climb.missIn(BP, 'c2');
    climb.unmissIn(BP, 'c2');
    expect(conceptMisses(climb.moduleKey(BP, 'c2'))).toBe(1);
    climb.unmissIn(BP, 'c2');
    expect(conceptMisses(climb.moduleKey(BP, 'c2'))).toBe(0);
    climb.unmissIn(BP, 'c2');
    expect(conceptMisses(climb.moduleKey(BP, 'c2'))).toBe(0);
  });
});

describe('when a module ends, the group is asked for again', () => {
  it('walks the pool’s own road for a learner nothing has happened to', () => {
    const walk = climb.startWalk();
    const first = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor);
    expect(first?.id).toBe('p9');
    const second = sit(walk, first as Module, []);
    expect(second?.id).toBe('c2');
    expect(walk.handed).toEqual(['p9', 'c2']);
  });

  it('follows a module that beat them twice with a different one, never a harder one', () => {
    const walk = climb.startWalk();
    const p9 = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor) as Module;
    const c2 = sit(walk, p9, []) as Module;
    expect(c2.id).toBe('c2');

    // Wrong, wrong: the check has beaten them, and it is not handed back.
    const after = sit(walk, c2, [false, false, true, true]) as Module;
    expect(after.id).not.toBe('c2');
    expect(DEPTH[after.role]).toBeLessThan(DEPTH.check);
    // It is the road the pool itself holds for this: another way into the same idea.
    expect(after.id).toBe('p10');
    expect(after.teaches.every((i) => byId('c2').teaches.includes(i))).toBe(true);
    expect(walk.handed).toEqual(['p9', 'c2', 'p10']);
  });

  it('asks for the idea back only after another way into it has landed', () => {
    const walk = climb.startWalk();
    const p9 = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor) as Module;
    const c2 = sit(walk, p9, []) as Module;
    const p10 = sit(walk, c2, [false, false]) as Module;
    expect(p10.id).toBe('p10');
    // the check is still barred while nothing else has landed
    expect(climb.stuckIn(BP)).toEqual(['c2']);
    const back = sit(walk, p10, []) as Module;
    expect(back.id).toBe('c2');
    expect(climb.stuckIn(BP)).toEqual([]);
  });

  it('never lifts the bar on a way in that beat them', () => {
    climb.missIn(BP, 'p9');
    climb.missIn(BP, 'p9');
    const walk = climb.startWalk();
    const first = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor) as Module;
    expect(first.id).toBe('p10');
    const next = sit(walk, first, []) as Module;
    expect(next.id).toBe('c2');
    expect(climb.stuckIn(BP)).toEqual(['p9']);
    const later = sit(walk, next, [true, true, true]);
    expect(later?.id).not.toBe('p9');
  });

  it('keeps a learner who gets everything wrong moving, and never on the module that beat them', () => {
    const walk = climb.startWalk();
    const beatenBy = allWrong(walk, 24);
    // the check came round again and again, always with a different module between
    expect(beatenBy.length).toBeGreaterThan(3);
    const handed = walk.handed;
    for (let i = 1; i < handed.length; i += 1) {
      if (handed[i - 1] === 'c2') expect(handed[i]).not.toBe('c2');
    }
    // and every road it took came out of the pool, never the boss and never a side door
    for (const id of handed) expect(['boss', 'side_door']).not.toContain(byId(id).role);
    expect(new Set(handed)).toEqual(new Set(['p9', 'c2', 'p10']));
  });

  it('hands a slipped module another go rather than moving on', () => {
    const walk = climb.startWalk();
    const p9 = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor) as Module;
    const c2 = sit(walk, p9, []) as Module;
    const again = sit(walk, c2, [false, true, true, true]);
    expect(again?.id).toBe('c2');
  });

  it('costs nothing: no network, no model, a selection out of the pool in hand', async () => {
    const cut = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('choosing reached the network');
    }) as unknown as typeof fetch;
    try {
      const walk = climb.startWalk();
      allWrong(walk, 10);
      expect(walk.handed.length).toBe(11);
    } finally {
      globalThis.fetch = cut;
    }
    expect(calls).toBe(0);
  });
});

describe('what the atom can play', () => {
  it('plays a module on the card that is what the module is, and nothing it has no card for', () => {
    expect(climb.atomCardFor(byId('p9'))).toBe('scale');
    expect(climb.atomCardFor(byId('p10'))).toBe('worked');
    expect(climb.atomCardFor(byId('c2'))).toBe('practice');
    // a film has no card on the atom, and the ground under the topic is the bridge's to lay
    expect(climb.atomCardFor(byId('p11'))).toBeNull();
    expect(climb.atomCardFor(byId('q2'))).toBeNull();
  });

  it('chooses only among what it can play, so the learner is never handed a blank', () => {
    const walk = climb.startWalk();
    // the ground is unmet, so the pool's own group starts with the prerequisite, a worked module
    // about a different idea; the atom leaves it to the bridge and starts with the way in
    const first = climb.firstIn(BP, TOPIC, walk, climb.atomCardFor, { unmetAssumptions: ['a2'] });
    expect(first?.id).toBe('p9');
  });

  it('says there is nothing to play when the pool holds nothing the atom can show', () => {
    const films: typeof BP = {
      ...BP,
      modules: BP.modules.map((m) => ({ ...m, kind: 'film' as const })),
    };
    const walk = climb.startWalk();
    expect(climb.firstIn(films, TOPIC, walk, climb.atomCardFor)).toBeNull();
  });
});

describe('one answer ends a topic, and it is the band', () => {
  it('has deleted the other answer', () => {
    expect('masteryOf' in blueprint).toBe(false);
  });

  it('ends the topic at the floor and nowhere below it', () => {
    for (const band of ['not_started', 'emerging', 'developing'] as const) {
      expect(climb.topicHeld(band)).toBe(false);
    }
    expect(climb.topicHeld(undefined)).toBe(false);
    expect(climb.topicHeld('secure')).toBe(true);
    expect(climb.topicHeld('independent')).toBe(true);
  });

  it('is reached by a learner who answers, through the real record the course writes to', () => {
    // A record of its own and a node of its own: every file in the suite shares one process.
    globalThis.localStorage.removeItem(MASTERY_CACHE_KEY);
    const sdk = createSdk({ devAuth: true, persistMode: 'local' });
    const node = crypto.randomUUID();
    const answer = (correct: boolean) => {
      const item = crypto.randomUUID();
      sdk.events.record(
        'learn.attempt.submitted.v1',
        {
          node_id: node,
          item_id: item,
          response: { kind: 'numeric', value: correct ? 5 : 9 },
          correct,
          aided: false,
          independence_signal: 0.95,
          latency_ms: 4000,
          attempt_index: 0,
        },
        { ontologyNodeId: node },
      );
      sdk.events.record(
        'practice.item.answered.v1',
        {
          node_id: node,
          item_id: item,
          response: { kind: 'numeric', value: correct ? 5 : 9 },
          correct,
          latency_ms: 4000,
          independence_signal: 0.95,
        },
        { ontologyNodeId: node },
      );
      return climb.topicHeld(sdk.mastery.bands()[node]);
    };
    // the course's played learner: wrong, wrong, and then it lands
    expect(answer(false)).toBe(false);
    expect(answer(false)).toBe(false);
    expect(answer(true)).toBe(false);
    expect(answer(true)).toBe(false);
    // the third clean answer is the evidence, and the record says so the moment it is given
    expect(answer(true)).toBe(true);
  });
});
