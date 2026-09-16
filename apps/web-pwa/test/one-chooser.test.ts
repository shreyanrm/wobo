/**
 * ONE CHOOSER, PLAYED: A STRUGGLING LEARNER WALKS A WHOLE CHAPTER ON ONE READ OF THE POOL.
 *
 * docs/LEARNING-MODEL.md, "Who chooses" (2026-09-16). The group that teaches a topic is chosen on
 * the device by `groupFor`, out of the pool `curriculum.blueprint` hands over once per cell per
 * session. It is the only chooser. The gateway's `curriculum.climb` is retired: every re-choice
 * through it cost a turn from the learner's day. Played before the retirement, an anonymous
 * learner was refused with a 429 on the seventh call, still inside the first topic, so the climb
 * ended at the meter and not at mastery.
 *
 * This test plays the chooser that remains, end to end. The real chapter pool
 * (`suggest/fixture.ts`) is read through the real SDK curriculum client, over a recording post
 * seam instead of the network. The group comes from the real `groupFor`, asked again before every
 * module, and misses go through the real tally (`wobo/reteach.ts`). The learner misses, misses
 * twice, shows a misconception and comes back. Before every module three things are checked:
 * there is a next thing, nothing has gone over the wire since the pool was read, and the client
 * the screen holds has no door that would choose for them.
 *
 * What ENDS a topic is the course's decision (the course builder is settling it at the module
 * boundary), and it is not this file's. So each walk plays the number of modules this learner
 * needed and then checks what they hold.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { CURRICULUM_CAPABILITIES, createCurriculumClient } from '@wobo/sdk';

/**
 * The tally is durable on purpose, and Bun has no browser storage. Installed before the imports
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

const { groupFor, isBlueprint } = await import('../src/curriculum/blueprint');
const { pool } = await import('../src/suggest/fixture');
const { conceptMisses, noteConceptCorrect, noteConceptMiss, RETEACH_AFTER_MISSES, resetReteach } =
  await import('../src/wobo/reteach');

type Blueprint = ReturnType<typeof pool>;
type Answer = { right: boolean; showed?: string[] };
type Answering = (moduleId: string, missedBefore: number) => Answer;
/** How many modules this learner plays in each topic before the topic is theirs. */
type Plays = Record<string, number>;

const CELL = {
  node: 'cbse-8-science-force-and-pressure',
  chapter: 'Force and Pressure',
  board: 'CBSE',
  grade: '8',
  subject: 'Science',
  contentVersion: '2026-27',
  topics: [
    { id: 't4', name: 'Pressure' },
    { id: 't5', name: 'Pressure in liquids and gases' },
  ],
};

/** Every door the SDK routes on whose name says it picks what a learner meets next. */
const CHOOSERS = /climb|next|group|choose/i;

beforeEach(() => {
  resetReteach();
});

/**
 * THE WALK. Reads the pool once through the SDK, then walks every topic of the chapter the way a
 * course screen does: ask the pool for the group as things stand, take the first module not yet
 * finished, answer it, and ask again.
 */
async function walkTheChapter(who: string, plays: Plays, answer: Answering) {
  const posted: string[] = [];
  const sdk = createCurriculumClient('https://brain.test', {
    post: async (capability: string) => {
      posted.push(capability);
      if (capability !== CURRICULUM_CAPABILITIES.blueprint) {
        throw new Error(`a walk asked the gateway for ${capability}`);
      }
      return { blueprint: pool(), held: 0 };
    },
  });
  const { blueprint } = await sdk.blueprint(CELL);
  expect(isBlueprint(blueprint)).toBe(true);
  const bp = blueprint as Blueprint;
  const readsForThePool = posted.length;

  const key = (id: string) => `${who}:${id}`;
  const missed = new Map<string, number>();
  const done = new Set<string>();
  const heldIdeas: string[] = [];
  let misconceptions: string[] = [];
  const met: Record<string, string[]> = {};

  for (const topic of CELL.topics.map((t) => t.id)) {
    met[topic] = [];
    for (let step = 0; step < (plays[topic] ?? 0); step++) {
      // Before every module: the pool is the only thing asked, and nothing crossed the wire.
      expect(posted.length).toBe(readsForThePool);
      expect('climb' in sdk, 'the screen holds a door that chooses over the network').toBe(false);
      expect(Object.values(CURRICULUM_CAPABILITIES).filter((c) => CHOOSERS.test(c))).toEqual([]);

      const stuckOn = bp.modules
        .map((m) => m.id)
        .filter((id) => conceptMisses(key(id)) >= RETEACH_AFTER_MISSES);
      const next = groupFor(bp, topic, { heldIdeas, misconceptions, stuckOn }).find(
        (m) => !done.has(m.id),
      );
      expect(next, `the learner was left with nothing to do inside ${topic}`).toBeDefined();
      if (!next) break;
      met[topic].push(next.id);

      const answered = answer(next.id, missed.get(next.id) ?? 0);
      if (answered.right) {
        noteConceptCorrect(key(next.id));
        done.add(next.id);
        for (const idea of next.teaches) if (!heldIdeas.includes(idea)) heldIdeas.push(idea);
        if (next.role === 'repair' && next.repairs) {
          misconceptions = misconceptions.filter((x) => x !== next.repairs);
        }
      } else {
        noteConceptMiss(key(next.id));
        missed.set(next.id, (missed.get(next.id) ?? 0) + 1);
        for (const x of answered.showed ?? []) {
          if (!misconceptions.includes(x)) misconceptions.push(x);
        }
      }
    }

    // What they hold when this topic's plays are done, read off the pool's own declarations.
    const ideas = bp.ideas.filter((i) => i.topics.includes(topic)).map((i) => i.id);
    const mistakes = bp.misconceptions.filter((x) => x.topics.includes(topic)).map((x) => x.id);
    expect(
      ideas.every((i) => heldIdeas.includes(i)),
      `${topic}'s ideas are not held`,
    ).toBe(true);
    expect(misconceptions.filter((x) => mistakes.includes(x))).toEqual([]);
  }
  return { met, posted };
}

describe('the one chooser carries a struggling learner through the chapter for free', () => {
  it('misses everything once, shows the heavier-presses-harder mistake, and still gets there', async () => {
    const { met, posted } = await walkTheChapter('slips', { t4: 4, t5: 2 }, (id, missedBefore) => {
      if (missedBefore >= 1) return { right: true };
      return id === 'p9' || id === 'r2' ? { right: false, showed: ['x2'] } : { right: false };
    });

    // One miss is a slip, so the same module comes back once. The mistake they showed pulls its
    // repair in, and the repair takes it away when it lands.
    expect(met).toEqual({ t4: ['p9', 'p9', 'r2', 'r2'], t5: ['c2', 'c2'] });
    // Six moments of choosing, and one read of the pool for all of them.
    expect(posted).toEqual(['curriculum.blueprint']);
  });

  it('is beaten by one module every time, is never handed it a third time, and still gets there', async () => {
    const { met, posted } = await walkTheChapter('beaten', { t4: 3, t5: 1 }, (id) => ({
      right: id !== 'p9',
    }));

    // Two misses on p9 are a pattern, and the architect's own route out of it comes next.
    expect(met).toEqual({ t4: ['p9', 'p9', 'p10'], t5: ['c2'] });
    expect(met.t4?.filter((id) => id === 'p9')).toHaveLength(RETEACH_AFTER_MISSES);
    expect(posted).toEqual(['curriculum.blueprint']);
  });
});
