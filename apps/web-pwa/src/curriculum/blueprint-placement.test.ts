/**
 * The placement check walks the ARCHITECT'S ground, and its answer chooses the learner's group.
 *
 * Before this, the ground under a topic was this client's own reading of the board's printed order
 * (`curriculum/prereq.ts`), which is an honest guess and says so. A blueprint carries something
 * stronger: the architect stated, in so many words, what the chapter assumes and the board does not
 * re-teach, and it put a prerequisite module in the pool for each one. So when a blueprint is
 * there, that is what the check asks about, it is labelled `blueprint` so nothing pretends it was
 * derived, and what the learner answers is what pulls the prerequisite module into their group.
 *
 * That is the whole loop, and it is the point of the seam: the check is not a score, it is the
 * input to a selection that costs nothing.
 */

import { beforeEach, describe, expect, test } from 'bun:test';

class MemoryStorage {
  private map = new Map<string, string>();
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
  new MemoryStorage() as unknown as Storage;

const { blueprintWalk, groundUnder } = await import('./blueprint');
const {
  ASSUMPTION_PREFIX,
  clearPlacements,
  gradePlacement,
  planPlacement,
  settlePlacement,
  unmetAssumptions,
} = await import('./placement');
import type { Blueprint, BlueprintModule } from './blueprint';
import type { Topic } from '../data/model';

// --- one chapter's pool, cut to what a placement needs ---------------------------------------------

const mechanics = [
  {
    id: 'm1',
    name: 'push the block',
    primitives: ['drag'] as const,
    moves: 'the block',
    responds: 'the arrow grows',
    wrongMoveTeaches: 'a pull is still a force',
  },
  {
    id: 'm2',
    name: 'sort the pictures',
    primitives: ['sort'] as const,
    moves: 'each picture',
    responds: 'the bin answers',
    wrongMoveTeaches: 'a drawer opens by a pull',
  },
] as unknown as BlueprintModule['mechanics'];

function mod(over: Partial<BlueprintModule> & { id: string }): BlueprintModule {
  return {
    aim: `aim for ${over.id}`,
    kind: 'simulation',
    role: 'way_in',
    serves: ['t4'],
    teaches: ['i5'],
    cores: ['pressure'],
    repairs: null,
    assumes: [],
    minutes: 7,
    mechanics,
    ...over,
  };
}

function pool(): Blueprint {
  return {
    node: 'cbse-8-science-force-and-pressure',
    chapter: 'Force and Pressure',
    board: 'CBSE',
    grade: '8',
    subject: 'Science',
    contentVersion: '2026-27',
    thread: 'how hard it presses, and over how much of it',
    topics: [{ id: 't4', name: 'Pressure' }],
    ideas: [{ id: 'i5', what: 'pressure is force spread over area', topics: ['t4'] }],
    misconceptions: [{ id: 'x2', what: 'a heavier object always presses harder', topics: ['t4'] }],
    assumptions: [
      { id: 'a2', what: 'area of a rectangle', fromChapter: 'Mensuration, class 7' },
      { id: 'a1', what: 'reading a marked scale', fromChapter: 'Measurement' },
    ],
    modules: [
      mod({ id: 'p9' }),
      mod({ id: 'p10', kind: 'worked' }),
      mod({ id: 'q2', kind: 'worked', role: 'prerequisite', assumes: ['a2'], minutes: 5 }),
      mod({ id: 'q1', kind: 'worked', role: 'prerequisite', assumes: ['a1'], minutes: 5 }),
      mod({ id: 'c2', kind: 'items', role: 'check', minutes: 6 }),
    ],
    flow: {
      order: ['q1', 'q2', 'p9', 'p10', 'c2'],
      why: 'the area comes before the pressure that needs it',
      sideDoors: [],
      boss: 'c2',
      bossProves: 'nothing here; the boss is elsewhere in the real pool',
      skippable: ['p10'],
      neverSkip: ['p9'],
      stuck: [{ module: 'p9', instead: 'q2', why: 'the area is what is missing' }],
    },
  };
}

const topic: Topic = {
  id: 't4',
  chapterId: 'ch-force',
  name: 'Pressure',
  blurb: '',
  prereqTopicIds: [],
  kind: 'syllabus',
  xp: 120,
};

beforeEach(() => {
  clearPlacements();
});

// --- the check asks the architect's ground ---------------------------------------------------------

describe('the check asks what the architect said the chapter assumes', () => {
  test('a blueprint-backed check asks about the declared assumptions, in the flow’s order', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    expect(plan).not.toBeNull();
    expect(plan?.questions.map((q) => q.prereqId)).toEqual([
      `${ASSUMPTION_PREFIX}a2`,
      `${ASSUMPTION_PREFIX}a1`,
    ]);
  });

  test('the question says what the ground is, and where it was taught', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    const first = plan?.questions[0];
    expect(first?.prereqName).toBe('area of a rectangle');
    expect(first?.prompt).toContain('area of a rectangle');
    expect(first?.prompt).toContain('Mensuration, class 7');
  });

  test('it is labelled as the architect’s, never as this client’s reading of an order', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    expect(plan?.questions.every((q) => q.reason === 'blueprint')).toBe(true);
  });

  test('a check is still a check, never an exam', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, what: `ground ${i}` }));
    const plan = await planPlacement(topic, new Set(), { assumptions: () => many });
    expect(plan?.questions.length).toBe(3);
  });

  test('no blueprint means the old derived check, unchanged', async () => {
    const plan = await planPlacement(topic, new Set(), { assumptions: () => [] });
    expect(plan).toBeNull(); // this topic has no derived ground either
  });
});

// --- the answer chooses the group ------------------------------------------------------------------

describe('what the learner answers is what pulls a module into their group', () => {
  test('ground the learner says is new comes back as an unmet assumption', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    if (!plan) throw new Error('the plan is the point of the test');
    settlePlacement(plan, [
      { question: plan.questions[0]!, value: 'new', latencyMs: 900 },
      { question: plan.questions[1]!, value: 'solid', latencyMs: 700 },
    ]);
    expect(unmetAssumptions()).toEqual(['a2']);
  });

  test('and that is exactly what puts the prerequisite module in front of them', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    if (!plan) throw new Error('the plan is the point of the test');
    settlePlacement(plan, [
      { question: plan.questions[0]!, value: 'new', latencyMs: 900 },
      { question: plan.questions[1]!, value: 'solid', latencyMs: 700 },
    ]);
    const walk = blueprintWalk(pool(), 't4', { unmetAssumptions: unmetAssumptions() });
    expect(walk).toContain('q2');
    expect(walk).not.toContain('q1');
  });

  test('a learner who says the ground is solid is not shown the prerequisite at all', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    if (!plan) throw new Error('the plan is the point of the test');
    settlePlacement(
      plan,
      plan.questions.map((question) => ({ question, value: 'solid', latencyMs: 500 })),
    );
    expect(unmetAssumptions()).toEqual([]);
    expect(blueprintWalk(pool(), 't4', { unmetAssumptions: unmetAssumptions() })).toEqual([
      'p9',
      'c2',
    ]);
  });

  test('"I know this" is a claim, and a claim is not a gap', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    if (!plan) throw new Error('the plan is the point of the test');
    const claim = { question: plan.questions[0]!, value: 'solid', latencyMs: 0, claimed: true };
    expect(gradePlacement(claim).evidence).toBe('claimed');
    settlePlacement(plan, [claim]);
    expect(unmetAssumptions()).toEqual([]);
  });

  test('a settled assumption is never asked again', async () => {
    const first = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    if (!first) throw new Error('the plan is the point of the test');
    settlePlacement(first, [{ question: first.questions[0]!, value: 'new', latencyMs: 100 }]);
    const again = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    expect(again?.questions.map((q) => q.prereqId)).toEqual([`${ASSUMPTION_PREFIX}a1`]);
  });

  test('forgetting everything takes the assumptions with it, so it can be asked again', async () => {
    const plan = await planPlacement(topic, new Set(), {
      assumptions: () => groundUnder(pool(), 't4'),
    });
    if (!plan) throw new Error('the plan is the point of the test');
    settlePlacement(plan, [{ question: plan.questions[0]!, value: 'new', latencyMs: 100 }]);
    expect(unmetAssumptions()).toEqual(['a2']);
    clearPlacements();
    expect(unmetAssumptions()).toEqual([]);
  });
});
