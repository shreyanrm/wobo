/**
 * THE NEXT THING AND THE WAY BACK ASK THE ONE CHOOSER (docs/LEARNING-MODEL.md, "Who chooses";
 * docs/SUGGESTIONS-AND-NOTICES.md §2).
 *
 * Measured 2026-09-17 before this file: `nextThing` called `groupFor` itself with no `stuckOn`, and
 * `wayBack` read the pool's `flow.stuck` itself. On the chapter fixture, after p9 had beaten a
 * learner twice and the course had moved them to p10, the next thing still named p9: the module
 * that had just beaten them, which the course was not going to show. Two choosers, disagreeing on
 * the first miss that mattered.
 *
 * What holds now, played against the course's own seam (`screens/course/climb.ts`):
 *
 *   1. what either suggestion names is exactly what the course hands over next, on every step of a
 *      walk with misses, slips and a module that beats the learner twice;
 *   2. asking costs nothing and records nothing: the tally and the walk are the same afterwards;
 *   3. `suggest/kind.ts` has no chooser of its own to reach for.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const climb = await import('../screens/course/climb');
const { nextThing, wayBack } = await import('./kind');
const { pool } = await import('./fixture');
const { conceptMisses, resetReteach } = await import('../wobo/reteach');

const BP = pool();
const TOPIC = 't4';
const plays = () => true;

beforeEach(() => {
  resetReteach();
});

/** The tally the course keeps, for every module, as numbers. */
function tally(): Record<string, number> {
  return Object.fromEntries(
    BP.modules.map((m) => [m.id, conceptMisses(climb.moduleKey(BP, m.id))]),
  );
}

/**
 * One learner, one sitting. `answers[i]` is how many times module i of the walk is missed before
 * it ends. Before every module boundary both suggestions are asked what they would name, and then
 * the course is asked what it hands over. They must be the same module.
 */
function play(answers: number[]): { handed: string[]; checked: number } {
  const walk = climb.startWalk();
  let on = climb.firstIn(BP, TOPIC, walk, plays);
  let checked = 0;
  for (const misses of answers) {
    if (!on) break;
    for (let i = 0; i < misses; i += 1) climb.missIn(BP, on.id);

    const beforeTally = tally();
    const beforeWalk = { handed: [...walk.handed], landed: [...walk.landed] };
    const peeked = climb.nextIn(BP, TOPIC, walk, on.id, misses, plays);
    // asking recorded nothing
    expect(tally()).toEqual(beforeTally);
    expect({ handed: [...walk.handed], landed: [...walk.landed] }).toEqual(beforeWalk);

    const next = nextThing({ bp: BP, topicId: TOPIC, next: peeked });
    const back = wayBack({
      bp: BP,
      topicId: TOPIC,
      from: on.id,
      held: conceptMisses(climb.moduleKey(BP, on.id)),
      next: peeked,
    });

    const handed = climb.endIn(BP, TOPIC, walk, on.id, misses, plays);
    expect(peeked?.id ?? null).toBe(handed?.id ?? null);
    if (next) expect(next.target).toEqual({ to: 'module', moduleId: handed?.id as string });
    if (back) expect(back.target).toEqual({ to: 'module', moduleId: handed?.id as string });
    checked += 1;
    on = handed;
  }
  return { handed: [...walk.handed], checked };
}

describe('the next thing and the way back name what the course hands over', () => {
  it('a clean walk', () => {
    const { checked } = play([0, 0, 0, 0]);
    expect(checked).toBe(4);
  });

  it('a slip, then a module that beats them twice, then a recovery', () => {
    const { handed } = play([1, 2, 0, 0, 2, 0, 0]);
    expect(handed.length).toBeGreaterThan(3);
  });

  it('every mixture of nought, one and two misses over five modules', () => {
    for (let n = 0; n < 3 ** 5; n += 1) {
      resetReteach();
      const answers = [0, 1, 2, 3, 4].map((i) => Math.floor(n / 3 ** i) % 3);
      play(answers);
    }
  });

  it('the case that was measured wrong: after p9 beats them, the next thing is never p9', () => {
    const walk = climb.startWalk();
    const first = climb.firstIn(BP, TOPIC, walk, plays);
    expect(first?.id).toBe('p9');
    climb.missIn(BP, 'p9');
    climb.missIn(BP, 'p9');
    const peeked = climb.nextIn(BP, TOPIC, walk, 'p9', 2, plays);
    const back = wayBack({ bp: BP, topicId: TOPIC, from: 'p9', held: 2, next: peeked });
    expect(back?.target).toEqual({ to: 'module', moduleId: 'p10' });
    const on = climb.endIn(BP, TOPIC, walk, 'p9', 2, plays);
    expect(on?.id).toBe('p10');
    const after = climb.nextIn(BP, TOPIC, walk, 'p10', 0, plays);
    const next = nextThing({ bp: BP, topicId: TOPIC, next: after });
    expect(next?.target).not.toEqual({ to: 'module', moduleId: 'p9' });
    expect(next?.target).toEqual({
      to: 'module',
      moduleId: climb.endIn(BP, TOPIC, walk, 'p10', 0, plays)?.id as string,
    });
  });
});

describe('the way back is offered only when what the course hands over IS another way in', () => {
  const p9 = BP.modules.find((m) => m.id === 'p9');
  const p10 = BP.modules.find((m) => m.id === 'p10');
  const p11 = BP.modules.find((m) => m.id === 'p11');

  it('not after one miss, whatever comes next', () => {
    expect(wayBack({ bp: BP, topicId: TOPIC, from: 'p9', held: 1, next: p10 ?? null })).toBeNull();
  });

  it('not when the course hands over the same module again', () => {
    expect(wayBack({ bp: BP, topicId: TOPIC, from: 'p9', held: 2, next: p9 ?? null })).toBeNull();
  });

  it('not when what follows teaches another idea: that is not a way back into this one', () => {
    expect(wayBack({ bp: BP, topicId: TOPIC, from: 'p9', held: 2, next: p11 ?? null })).toBeNull();
  });

  it('not when the course has nothing to hand over', () => {
    expect(wayBack({ bp: BP, topicId: TOPIC, from: 'p9', held: 2, next: null })).toBeNull();
  });
});

describe('the suggestions have no chooser of their own', () => {
  const src = readFileSync(fileURLToPath(new URL('./kind.ts', import.meta.url)), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');

  it('never calls groupFor, groupInPool or the pool’s stuck routes', () => {
    const found = [
      'groupFor',
      'groupInPool',
      'insteadOf',
      'routeOutOf',
      'flow.stuck',
      'flow.order',
    ].filter((chooser) => code.includes(chooser));
    expect(found).toEqual([]);
  });

  it('the screen asks the course, and the course’s hook carries the question', () => {
    const hook = readFileSync(
      fileURLToPath(new URL('../screens/course/climb.ts', import.meta.url)),
      'utf8',
    );
    expect(hook.includes('peek(misses: number): BlueprintModule | null')).toBe(true);
  });
});
