/**
 * THE TUTOR PROVES IT BEFORE IT SAYS IT (docs/LEARNING-MODEL.md, "The tutor never leaves").
 *
 * The seams under `tests/tutor-proves-it.spec.ts`, played without a browser, against the real
 * record (`@wobo/sdk`), the real atom items, the real registry and the real pool fetch.
 *
 *   1. one answer is one piece of evidence, however many planes report it;
 *   2. a worked module solves a twin of the item that beat the learner, never an item the course
 *      will ask them, so an answer copied off the card can never count as understanding;
 *   3. the topic closes at one decision: the band held AND the boss passed;
 *   4. the course and the Learn board read the band under one key;
 *   5. a pool request that failed is not remembered as "no pool".
 */

import { beforeEach, describe, expect, it } from 'bun:test';

/**
 * Bun has no browser storage and the record is durable on purpose. Installed before the imports
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
const { linearize } = await import('./equations');
const { topicOf } = await import('../../curriculum/registry');
const { topicNodeId, topicNodeUuid } = await import('../learn/mastery');
const pools = await import('../../curriculum/pool');
const { setCurriculumClient } = await import('../../curriculum/client');
const { pool } = await import('../../suggest/fixture');
const { ATOM_TARGET_NODE_ID, createCurriculumClient, createSdk, MASTERY_CACHE_KEY } = await import(
  '@wobo/sdk'
);

type Sdk = ReturnType<typeof createSdk>;

function freshSdk(): Sdk {
  globalThis.localStorage.removeItem(MASTERY_CACHE_KEY);
  return createSdk({ devAuth: true, persistMode: 'local' });
}

/** One answer, recorded exactly the way the practice run records it: on both planes. */
function answer(sdk: Sdk, node: string, correct: boolean): void {
  const item = crypto.randomUUID();
  const latency = 4000 + Math.floor(Math.random() * 1000);
  sdk.events.record(
    'learn.attempt.submitted.v1',
    {
      node_id: node,
      item_id: item,
      response: { kind: 'numeric', value: correct ? 5 : 9 },
      correct,
      aided: false,
      independence_signal: 0.95,
      latency_ms: latency,
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
      latency_ms: latency,
      independence_signal: 0.95,
    },
    { ontologyNodeId: node },
  );
}

describe('one answer is one piece of evidence', () => {
  it('does not call a topic held on two right answers', () => {
    const sdk = freshSdk();
    const node = crypto.randomUUID();
    answer(sdk, node, true);
    answer(sdk, node, true);
    expect(sdk.mastery.bands()[node]).toBe('developing');
    expect(climb.topicHeld(sdk.mastery.bands()[node])).toBe(false);
    expect(sdk.mastery.loadCache().nodes[node]?.evidence).toHaveLength(2);
    // the third is the evidence the floor asks for
    answer(sdk, node, true);
    expect(sdk.mastery.bands()[node]).toBe('secure');
  });

  it('still counts two different answers to the same item as two', () => {
    const sdk = freshSdk();
    const node = crypto.randomUUID();
    for (let i = 0; i < 3; i += 1) {
      sdk.events.record(
        'practice.item.answered.v1',
        {
          node_id: node,
          item_id: '00000000-0000-7000-8000-000000000101',
          response: { kind: 'numeric', value: 5 },
          correct: true,
          latency_ms: 4000,
          independence_signal: 0.95,
        },
        { ontologyNodeId: node },
      );
    }
    expect(sdk.mastery.loadCache().nodes[node]?.evidence).toHaveLength(3);
  });
});

describe('a worked module never solves what the course will ask', () => {
  it('works a twin of the item that beat them, with its own answer, for every atom item', async () => {
    const sdk = freshSdk();
    const items = await sdk.content.getPracticeItems(ATOM_TARGET_NODE_ID);
    expect(items.length).toBe(6);
    const asked = new Set(items.map((i) => i.equation.replace(/\s+/g, '')));
    for (const missed of items) {
      const worked = climb.workedFor(missed, items);
      expect(worked, `no worked module for ${missed.equation}`).not.toBeNull();
      const w = worked as NonNullable<typeof worked>;
      expect(asked.has(w.equation.replace(/\s+/g, '')), `${w.equation} is asked`).toBe(false);
      expect(w.id).not.toBe(missed.id);
      const lin = linearize(w.equation);
      expect(lin).not.toBeNull();
      // the same shape as the item that beat them
      expect(lin?.a).toBe(linearize(missed.equation)?.a);
      expect(lin?.b).toBe(linearize(missed.equation)?.b);
      // and its own answer, which is a whole number and not the answer to the item they will meet
      expect(Number.isInteger(lin?.x)).toBe(true);
      expect(String(lin?.x)).toBe(w.answer);
      expect(w.answer).not.toBe(missed.answer);
    }
  });

  it('has nothing to work when nothing beat them yet, rather than an item they will be asked', async () => {
    const sdk = freshSdk();
    const items = await sdk.content.getPracticeItems(ATOM_TARGET_NODE_ID);
    const worked = climb.workedFor(undefined, items.slice(0, 3));
    expect(worked).not.toBeNull();
    const eq = (worked as NonNullable<typeof worked>).equation.replace(/\s+/g, '');
    expect(items.map((i) => i.equation.replace(/\s+/g, ''))).not.toContain(eq);
  });
});

describe('the topic closes at one decision', () => {
  it('asks for the band AND the boss, and neither alone is enough', () => {
    expect(climb.topicClosed('independent', null)).toBe(false);
    expect(climb.topicClosed('secure', { correct: 1, total: 3 })).toBe(false);
    expect(climb.topicClosed('developing', { correct: 3, total: 3 })).toBe(false);
    expect(climb.topicClosed(undefined, { correct: 3, total: 3 })).toBe(false);
    expect(climb.topicClosed('secure', { correct: 2, total: 3 })).toBe(true);
    expect(climb.topicClosed('independent', { correct: 3, total: 3 })).toBe(true);
  });
});

describe('the course and the Learn board read one key', () => {
  const node = (conceptIds: string[]) => ({
    id: 'm2-1',
    kind: 'topic' as const,
    name: 'Solving equations with the variable on one side',
    parent_id: 'm2',
    order: 0,
    aliases: [],
    source_ref: null,
    concept_ids: conceptIds,
    conceptIds,
    objectives: [],
    own: true,
    not_in_my_school: false,
    textbook: null,
    renamed_from: null,
    source: null,
  });

  it('files the atom under the node the course records its answers against', () => {
    const topic = topicOf(node([ATOM_TARGET_NODE_ID]) as never, 'm2');
    expect(topic.nodeId).toBe(ATOM_TARGET_NODE_ID);
    // the course records every answer under `topic.nodeId`; the board must read the same key
    expect(topicNodeId(topic)).toBe(topic.nodeId as string);
  });

  it('keeps the derived key for a topic the brain mapped onto a concept name', () => {
    const topic = topicOf(node(['fractions']) as never, 'm2');
    expect(topicNodeId(topic)).toBe(topicNodeUuid('m2-1'));
    const unmapped = topicOf(node([]) as never, 'm2');
    expect(topicNodeId(unmapped)).toBe(topicNodeUuid('m2-1'));
  });
});

describe('a pool request that failed is asked again', () => {
  const cell = {
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

  beforeEach(() => {
    pools.clearPools();
    setCurriculumClient(null);
  });

  it('does not remember a refusal as "no pool"', async () => {
    let asked = 0;
    let refuse = true;
    setCurriculumClient(
      createCurriculumClient('', {
        post: async () => {
          asked += 1;
          if (refuse) {
            const e = new Error('We have talked a lot today.');
            e.name = 'BudgetExhaustedError';
            throw e;
          }
          return { blueprint: pool(), held: 0 };
        },
      }),
    );
    expect(await pools.fetchPool(cell)).toBeNull();
    refuse = false;
    const again = await pools.fetchPool(cell);
    expect(asked).toBe(2);
    expect(again?.node).toBe(cell.node);
    // and an answer, once had, is kept: the third ask goes nowhere
    await pools.fetchPool(cell);
    expect(asked).toBe(2);
    setCurriculumClient(null);
  });

  it('does remember the gateway saying there is no pool for this cell', async () => {
    let asked = 0;
    setCurriculumClient(
      createCurriculumClient('', {
        post: async () => {
          asked += 1;
          return { blueprint: null, held: 0 };
        },
      }),
    );
    expect(await pools.fetchPool(cell)).toBeNull();
    expect(await pools.fetchPool(cell)).toBeNull();
    expect(asked).toBe(1);
    setCurriculumClient(null);
  });
});
