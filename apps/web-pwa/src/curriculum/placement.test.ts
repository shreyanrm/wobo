/**
 * The placement check, end to end from an ingested syllabus.
 *
 * The audit found three holes and these cases are the floor under all three: `unmetPrereqs` had no
 * callers and would have returned nothing anyway, and `onboarding.diagnostic.answered.v1` was
 * never emitted by anything. So the first case here fails outright without the derivation wired
 * into the registry, and the last one puts the emitted payload back through the real contract.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CurriculumNode, CurriculumUnitsView } from '@wobo/sdk';

// Bun has no localStorage and the whole point of several cases below is what is written to it.
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
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;

const { eventSchema } = await import('@wobo/contracts');
const { resetWorldCache, saveWorld, worldFrom } = await import('./world');
const { ingestTopics, ingestUnits, resetRegistry, topicById, groundBeneath, unmetPrereqs } =
  await import('./registry');
const {
  clearPlacements,
  eventNodeId,
  forgetPlacement,
  gapFor,
  gradePlacement,
  groundFor,
  MAX_PLACEMENT_QUESTIONS,
  placementOf,
  planPlacement,
  settlePlacement,
  skipPlacement,
  subscribeGround,
} = await import('./placement');
type PlacementPlan = Awaited<ReturnType<typeof planPlacement>>;

// --- an ingested world ----------------------------------------------------------------------------

const node = (id: string, name: string, order: number, parentId: string): CurriculumNode => ({
  id,
  kind: 'topic',
  name,
  parentId,
  order,
  aliases: [],
  sourceRef: null,
  conceptIds: [],
  own: false,
  notInMySchool: false,
  textbook: null,
  renamedFrom: null,
  source: null,
  checksPassed: [],
  verifiedAt: null,
  objectives: [],
});

const framework = {
  id: 'cbse',
  name: 'CBSE',
  kind: 'national' as const,
  status: 'verified' as const,
  aliases: [],
  country: 'IN',
  region: null,
  languages: ['en'],
  levels: ['Class 8'],
  officialSite: null,
  personal: false,
  label: 'Official CBSE, verified',
};

const units: CurriculumUnitsView = {
  frameworkId: 'cbse',
  level: 'Class 8',
  subject: 'Mathematics',
  status: 'ready',
  subjectId: 'subject-1',
  units: [
    { ...node('u1', 'Integers', 0, 'subject-1'), kind: 'unit' },
    { ...node('u2', 'Rational numbers', 1, 'subject-1'), kind: 'unit' },
  ],
  placeholder: null,
  label: 'Official CBSE, verified',
  notListed: null,
};

/** A real UUID so the contract can name the node, as a board's own syllabus node id would. */
const RATIONAL = '00000000-0000-7000-8000-0000000000b1';
const INTEGERS = '00000000-0000-7000-8000-0000000000a1';

function ingestWorld(): void {
  saveWorld(
    worldFrom(framework, {
      version: { id: 'v1', name: '2026-27', status: 'verified', year: '2026-27' },
      level: 'Class 8',
      levels: ['Class 8'],
      subjects: ['Mathematics'],
    }),
  );
  ingestUnits(units);
  ingestTopics({
    frameworkId: 'cbse',
    unit: { id: 'u1', name: 'Integers', order: 0 },
    topics: [{ ...node(INTEGERS, 'Integers', 0, 'u1'), conceptIds: ['integers'] }],
  });
  ingestTopics({
    frameworkId: 'cbse',
    unit: { id: 'u2', name: 'Rational numbers', order: 1 },
    topics: [
      { ...node(RATIONAL, 'Rational numbers', 0, 'u2'), conceptIds: ['rational-numbers'] },
      {
        ...node('t-props', 'Properties of rational numbers', 1, 'u2'),
        conceptIds: ['properties-of-rational-numbers'],
      },
    ],
  });
}

beforeEach(() => {
  storage.clear();
  resetWorldCache();
  resetRegistry();
  clearPlacements();
  ingestWorld();
});

// --- the graph is real ----------------------------------------------------------------------------

describe('an ingested syllabus carries the ground under it', () => {
  test('unmetPrereqs finally returns something', () => {
    const rational = topicById(RATIONAL);
    expect(rational?.prereqTopicIds).toEqual([INTEGERS]);
    expect(unmetPrereqs(rational as never, new Set()).map((t) => t.name)).toEqual(['Integers']);
  });

  test('a prerequisite the learner has covered is not unmet', () => {
    const rational = topicById(RATIONAL);
    expect(unmetPrereqs(rational as never, new Set([INTEGERS]))).toEqual([]);
  });

  test('the walk goes deeper than one step, and stops at solid ground', () => {
    const props = topicById('t-props');
    const deep = groundBeneath(props as never, new Set());
    expect(deep.map((s) => [s.topic.name, s.depth])).toEqual([
      ['Rational numbers', 1],
      ['Integers', 2],
    ]);
    // Standing on rational numbers means what is under them is standing too.
    expect(groundBeneath(props as never, new Set([RATIONAL]))).toEqual([]);
  });
});

// --- the check ------------------------------------------------------------------------------------

describe('the placement check', () => {
  test('is planned only where there is unmet ground', async () => {
    expect(await planPlacement(topicById(INTEGERS) as never, new Set())).toBeNull();
    const plan = await planPlacement(topicById(RATIONAL) as never, new Set());
    expect(plan?.questions.map((q) => q.prereqName)).toEqual(['Integers']);
  });

  test('is a few questions, never an exam', async () => {
    const props = topicById('t-props');
    const plan = await planPlacement(props as never, new Set());
    expect(plan?.questions.length).toBeLessThanOrEqual(MAX_PLACEMENT_QUESTIONS);
    // Past learning is asked about before the lesson printed immediately behind this one.
    expect(plan?.questions[0]?.reason).not.toBe('sequence');
  });

  test('asks the learner in their own words when nothing is frozen to check them on', async () => {
    const plan = await planPlacement(topicById(RATIONAL) as never, new Set());
    const q = plan?.questions[0];
    expect(q?.kind).toBe('self');
    expect(q?.options?.map((o) => o.id)).toEqual(['solid', 'rusty', 'new']);
  });

  test('serves a verifier-frozen item when the content plane has one', async () => {
    const items = mock(async () => [
      { id: 'i2', node_id: 'integers', equation: '5x - 2 = 13', answer: '3', difficulty: 0.4 },
      { id: 'i1', node_id: 'integers', equation: 'x + 7 = 12', answer: '5', difficulty: 0.15 },
    ]);
    const plan = await planPlacement(topicById(RATIONAL) as never, new Set(), { items });
    expect(items).toHaveBeenCalledWith('integers');
    // The easiest frozen item: a placement asks whether the floor holds.
    expect(plan?.questions[0]).toMatchObject({ kind: 'item', equation: 'x + 7 = 12', answer: '5' });
  });

  test('a content plane that throws is a narrower check, never a broken one', async () => {
    const plan = await planPlacement(topicById(RATIONAL) as never, new Set(), {
      items: async () => {
        throw new Error('offline');
      },
    });
    expect(plan?.questions[0]?.kind).toBe('self');
  });

  test('folds in the platform’s own prerequisites, and drops what this syllabus lacks', async () => {
    const ontology = mock(async () => [{ name: 'Integers' }, { name: 'Set theory' }]);
    const plan = await planPlacement(topicById('t-props') as never, new Set(), { ontology });
    expect(ontology).toHaveBeenCalled();
    expect(plan?.questions.map((q) => q.prereqName)).toContain('Integers');
    expect(plan?.questions.map((q) => q.prereqName)).not.toContain('Set theory');
  });
});

// --- grading --------------------------------------------------------------------------------------

describe('one answer, read as a band', () => {
  const self = {
    id: 'q1',
    prereqId: INTEGERS,
    prereqName: 'Integers',
    reason: 'editorial' as const,
    depth: 1,
    prompt: 'How is integers for you?',
    kind: 'self' as const,
    options: [
      { id: 'solid' as const, label: 'I can do this', band: 'secure' as const },
      { id: 'rusty' as const, label: 'rusty', band: 'developing' as const },
      { id: 'new' as const, label: 'new', band: 'not_started' as const },
    ],
  };
  const item = { ...self, kind: 'item' as const, options: undefined, answer: '5', equation: 'x=5' };

  test('a checked item that comes back right is secure, and never independent', () => {
    expect(gradePlacement({ question: item, value: ' 5 ', latencyMs: 900 })).toEqual({
      band: 'secure',
      correct: true,
      evidence: 'checked',
    });
  });

  test('a checked item that comes back wrong is emerging, not a failure', () => {
    expect(gradePlacement({ question: item, value: '7', latencyMs: 900 })).toMatchObject({
      band: 'emerging',
      correct: false,
    });
  });

  test('a self report has no right answer to be wrong about', () => {
    expect(gradePlacement({ question: self, value: 'rusty', latencyMs: 400 })).toEqual({
      band: 'developing',
      correct: false,
      evidence: 'self_reported',
    });
    expect(gradePlacement({ question: self, value: 'new', latencyMs: 400 }).band).toBe(
      'not_started',
    );
  });

  test('"I know this" walks past even an item it never saw', () => {
    expect(gradePlacement({ question: item, value: '', latencyMs: 20, claimed: true })).toEqual({
      band: 'secure',
      correct: true,
      evidence: 'claimed',
    });
  });

  test('a band is a word about the ground, and secure is no gap at all', () => {
    expect(gapFor('not_started')).toBe('wide');
    expect(gapFor('emerging')).toBe('shaky');
    expect(gapFor('developing')).toBe('thin');
    expect(gapFor('secure')).toBeUndefined();
  });
});

// --- settling -------------------------------------------------------------------------------------

describe('settling a check', () => {
  async function planFor(topicId: string): Promise<NonNullable<PlacementPlan>> {
    const plan = await planPlacement(topicById(topicId) as never, new Set());
    if (!plan) throw new Error('expected a plan');
    return plan;
  }

  test('emits one diagnostic the real contract accepts, band and all', async () => {
    const plan = await planFor(RATIONAL);
    const seen: { type: string; payload: Record<string, unknown> }[] = [];
    settlePlacement(
      plan,
      [{ question: plan.questions[0] as never, value: 'rusty', latencyMs: 1200 }],
      { events: { record: (type, payload) => seen.push({ type, payload }) } },
    );

    expect(seen.length).toBe(1);
    expect(seen[0]?.type).toBe('onboarding.diagnostic.answered.v1');
    expect(seen[0]?.payload).toMatchObject({
      node_id: INTEGERS,
      correct: false,
      latency_ms: 1200,
      placement_band: 'developing',
    });
    // The payload is not merely shaped like the contract; it passes it.
    const parsed = eventSchema('onboarding.diagnostic.answered.v1').safeParse({
      event_id: '00000000-0000-7000-8000-00000000e001',
      event_type: 'onboarding.diagnostic.answered.v1',
      occurred_at: '2026-09-04T10:00:00Z',
      actor: {
        subject_id: '00000000-0000-7000-8000-00000000f001',
        surface: 'pwa',
        session_id: '00000000-0000-7000-8000-00000000f002',
      },
      context: { app: 'learner', env: 'dev', consent_tier: 'un_elevated' },
      trace: { request_id: '00000000-0000-7000-8000-00000000f003' },
      payload: seen[0]?.payload,
    });
    expect(parsed.success).toBe(true);
  });

  test('a learner is never asked the same placement twice', async () => {
    const plan = await planFor(RATIONAL);
    settlePlacement(plan, [
      { question: plan.questions[0] as never, value: 'solid', latencyMs: 300 },
    ]);
    expect(placementOf(INTEGERS)).toMatchObject({ band: 'secure', evidence: 'self_reported' });
    expect(await planPlacement(topicById(RATIONAL) as never, new Set())).toBeNull();
  });

  test('the ground report says what is unmet, how badly, and how we know', async () => {
    const plan = await planFor(RATIONAL);
    const report = settlePlacement(plan, [
      { question: plan.questions[0] as never, value: 'new', latencyMs: 500 },
    ]);
    expect(report.unmet).toEqual([
      {
        topicId: INTEGERS,
        name: 'Integers',
        conceptId: 'integers',
        reason: 'editorial',
        depth: 1,
        band: 'not_started',
        evidence: 'self_reported',
        gap: 'wide',
      },
    ]);
    expect(report.solid).toEqual([]);
    expect(groundFor(RATIONAL)).toEqual(report);
  });

  test('"I know this" records the debt rather than arguing with it', async () => {
    const plan = await planFor(RATIONAL);
    const report = skipPlacement(plan);
    expect(report.unmet).toEqual([]);
    expect(report.claimed.map((p) => [p.name, p.evidence])).toEqual([['Integers', 'claimed']]);
    expect(placementOf(INTEGERS)?.evidence).toBe('claimed');
  });

  test('the tutor is told the moment a check settles', async () => {
    const plan = await planFor(RATIONAL);
    const heard: string[] = [];
    const stop = subscribeGround((r) => heard.push(r.topicId));
    settlePlacement(plan, [
      { question: plan.questions[0] as never, value: 'solid', latencyMs: 200 },
    ]);
    stop();
    settlePlacement(plan, []);
    expect(heard).toEqual([RATIONAL]);
  });

  test('a node the contract cannot name is still persisted and still handed over', async () => {
    const plan = await planFor(RATIONAL);
    const first = plan.questions[0];
    if (!first) throw new Error('expected a question');
    const question = { ...first, prereqId: 'own-node' };
    const events = { record: mock(() => undefined) };
    const report = settlePlacement(
      { ...plan, questions: [question] },
      [{ question, value: 'new', latencyMs: 100 }],
      { events },
    );
    expect(events.record).not.toHaveBeenCalled();
    expect(report.unmet.length).toBe(1);
    expect(placementOf('own-node')?.band).toBe('not_started');
  });

  test('names a board node, a learner’s own node, and nothing it would have to invent', () => {
    expect(eventNodeId({ id: RATIONAL })).toBe(RATIONAL);
    expect(eventNodeId({ id: `own:${RATIONAL}` })).toBe(RATIONAL);
    expect(eventNodeId({ id: 'rational-numbers' })).toBeNull();
  });
});

/**
 * "I know this" was a one-way trapdoor. It settled EVERY remaining question as a permanent claim,
 * including ground the learner had never been shown; `planPlacement` then filters placed ground out
 * of every future check, so one tap deleted up to three prerequisites from the learner's picture and
 * nothing in the product could put them back. A claim a child makes has to be takeable back.
 */
describe('a claim is a claim, and a claim can be taken back', () => {
  const planOrNull = (topicId: string) => planPlacement(topicById(topicId) as never, new Set());
  async function planFor(topicId: string): Promise<NonNullable<PlacementPlan>> {
    const plan = await planOrNull(topicId);
    if (!plan) throw new Error('expected a plan');
    return plan;
  }

  test('an answer already given survives the claim that covers the rest', async () => {
    const plan = await planFor(RATIONAL);
    const only = plan.questions[0];
    if (!only) throw new Error('expected a question');
    const report = skipPlacement(plan, {
      answered: [{ question: only, value: 'new', latencyMs: 90 }],
      from: 1,
    });
    // The answer the learner gave is kept as an answer, not overwritten by the claim.
    expect(report.unmet.map((p) => p.name)).toEqual(['Integers']);
    expect(report.claimed).toEqual([]);
    expect(placementOf(INTEGERS)?.evidence).toBe('self_reported');
  });

  test('forgetting one placement puts the question back in the next check', async () => {
    skipPlacement(await planFor(RATIONAL));
    expect(placementOf(INTEGERS)?.evidence).toBe('claimed');
    // Placed ground is filtered out of every future check, so the question is gone...
    expect(await planOrNull(RATIONAL)).toBeNull();
    // ...until the claim is taken back.
    forgetPlacement(INTEGERS);
    expect(placementOf(INTEGERS)).toBeUndefined();
    expect((await planFor(RATIONAL)).questions.map((q) => q.prereqId)).toEqual([INTEGERS]);
  });

  test('forgetting something never placed is a no-op, not a wipe', async () => {
    skipPlacement(await planFor(RATIONAL));
    forgetPlacement('a-topic-nobody-was-asked-about');
    expect(placementOf(INTEGERS)?.evidence).toBe('claimed');
  });
});
