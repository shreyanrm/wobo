import { describe, expect, it } from 'bun:test';
import type { MasteryBand } from '@wobo/contracts';
import type { Topic } from '../../data/model';
import {
  chooseNextTopic,
  isDebt,
  isLearnt,
  MASTERY_FLOOR,
  NO_MASTERY,
  topicIsNode,
  topicNodeId,
  topicNodeUuid,
} from './mastery';

const topic = (id: string, nodeId?: string): Topic => ({
  id,
  chapterId: 'c1',
  name: id,
  blurb: '',
  prereqTopicIds: [],
  kind: 'syllabus',
  xp: 120,
  ...(nodeId ? { nodeId } : {}),
});

const TOPICS = [topic('t1'), topic('t2'), topic('t3'), topic('t4')];

const view = (completed: string[], bands: Record<string, MasteryBand> = {}) => ({
  completed: new Set(completed),
  bandOf: (t: Topic) => bands[t.id] ?? 'not_started',
});

describe('the node a topic files its evidence under', () => {
  it('is the topic’s own deterministic id, mapped concept or not', () => {
    // `nodeId` is the brain's CONCEPT (registry.ts sets it to `node.conceptIds[0]`, a slug). Every
    // payload that records evidence types `node_id` as a UUID, so evidence can never land under a
    // slug: reading a band from one read a key nothing had ever written, and the band came back
    // `not_started`, which the rules read as silence rather than as a bad result.
    expect(topicNodeId(topic('t1', 'fractions'))).toBe(topicNodeUuid('t1'));
    expect(topicNodeId(topic('t1'))).toBe(topicNodeUuid('t1'));
    // Stable across calls and distinct per topic — a band must never be read off the wrong node.
    expect(topicNodeUuid('t1')).toBe(topicNodeUuid('t1'));
    expect(topicNodeUuid('t1')).not.toBe(topicNodeUuid('t2'));
    expect(topicNodeUuid('t1')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is still reachable by the concept the platform answers in', () => {
    const mapped = topic('t1', 'fractions');
    expect(topicIsNode(mapped, topicNodeUuid('t1'))).toBe(true);
    expect(topicIsNode(mapped, 'fractions')).toBe(true);
    expect(topicIsNode(mapped, 'decimals')).toBe(false);
    expect(topicIsNode(topic('t2'), 'fractions')).toBe(false);
  });
});

describe('what is learnt and what is owed', () => {
  it('puts the floor at secure', () => {
    expect(MASTERY_FLOOR).toBe('secure');
  });

  it('counts a completed topic at or above the floor as learnt', () => {
    const v = view(['t1', 't2'], { t1: 'secure', t2: 'independent' });
    expect(TOPICS.filter((t) => isLearnt(t, v)).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(TOPICS.some((t) => isDebt(t, v))).toBe(false);
  });

  it('counts a completed topic below the floor as a debt', () => {
    const v = view(['t1'], { t1: 'developing' });
    expect(isDebt(TOPICS[0] as Topic, v)).toBe(true);
    expect(isLearnt(TOPICS[0] as Topic, v)).toBe(false);
  });

  it('treats silence as silence: a completed topic with no evidence is not a debt', () => {
    const v = { completed: new Set(['t1']), bandOf: NO_MASTERY };
    expect(isDebt(TOPICS[0] as Topic, v)).toBe(false);
    expect(isLearnt(TOPICS[0] as Topic, v)).toBe(true);
  });

  it('never calls an unfinished topic learnt, however good the evidence is', () => {
    const v = view([], { t1: 'independent' });
    expect(isLearnt(TOPICS[0] as Topic, v)).toBe(false);
  });
});

describe('what to do next', () => {
  it('opens the first topic when nothing has begun', () => {
    expect(chooseNextTopic(TOPICS, view([]))?.id).toBe('t1');
  });

  it('sends the learner back to the topic they have not mastered', () => {
    // t1 and t2 are finished, t2 badly. Completion alone would hand over t3.
    const v = view(['t1', 't2'], { t1: 'secure', t2: 'emerging' });
    expect(chooseNextTopic(TOPICS, v)?.id).toBe('t2');
  });

  it('takes the weakest debt first', () => {
    const v = view(['t1', 't2', 't3'], { t1: 'developing', t2: 'emerging', t3: 'secure' });
    expect(chooseNextTopic(TOPICS, v)?.id).toBe('t2');
  });

  it('finishes an open course before it collects a debt', () => {
    const v = view(['t1'], { t1: 'emerging' });
    expect(chooseNextTopic(TOPICS, { ...v, inFlightTopicId: 't3' })?.id).toBe('t3');
  });

  it('ignores an in-flight id that names a topic already behind them', () => {
    const v = view(['t1', 't2'], { t1: 'secure', t2: 'secure' });
    expect(chooseNextTopic(TOPICS, { ...v, inFlightTopicId: 't1' })?.id).toBe('t3');
  });

  it('answers nothing once every topic is learnt', () => {
    const v = view(['t1', 't2', 't3', 't4'], {
      t1: 'secure',
      t2: 'secure',
      t3: 'secure',
      t4: 'secure',
    });
    expect(chooseNextTopic(TOPICS, v)).toBeNull();
    expect(chooseNextTopic([], view([]))).toBeNull();
  });
});

describe('the platform’s own answer', () => {
  it('outranks the syllabus order, because it knows prerequisites the client does not', () => {
    // Nothing begun. Syllabus order alone says t1; the platform says the concept behind t3 first.
    const v = view([]);
    expect(chooseNextTopic(TOPICS, v)?.id).toBe('t1');
    expect(chooseNextTopic(TOPICS, { ...v, platformNodeId: topicNodeUuid('t3') })?.id).toBe('t3');
  });

  it('is ignored when it names nothing on this board, or something already learnt', () => {
    const v = view(['t1'], { t1: 'secure' });
    expect(
      chooseNextTopic(TOPICS, { ...v, platformNodeId: 'a-concept-from-another-subject' })?.id,
    ).toBe('t2');
    expect(chooseNextTopic(TOPICS, { ...v, platformNodeId: topicNodeUuid('t1') })?.id).toBe('t2');
  });

  it('still yields to an open course', () => {
    const v = view([]);
    const pick = chooseNextTopic(TOPICS, {
      ...v,
      inFlightTopicId: 't4',
      platformNodeId: topicNodeUuid('t2'),
    });
    expect(pick?.id).toBe('t4');
  });
});

/**
 * THE HALF-BUILT SEAM.
 *
 * `curriculum/prereq.ts` derives a real prerequisite graph onto every topic (`prereqTopicIds`), and
 * the chooser handed the ordering law `prerequisite_ids: []` for every node, so step 1 of the law
 * ("below the floor, and every prerequisite is at or above it") was `[].every(...)`, always true,
 * and the whole first rule degenerated into the second. The board could send a learner straight into
 * a topic whose ground it had just decided was missing. Two halves of one seam, never joined.
 */
describe('the ground comes first', () => {
  const GROUND = topic('ground');
  const BUILT: Topic = { ...topic('built'), prereqTopicIds: ['ground'] };
  const PAIR = [GROUND, BUILT];

  it('sends the learner to the ground under a topic before the topic itself', () => {
    // `built` is begun and struggling, `ground` is untouched. Weakest-first alone picks `built`,
    // because a topic with evidence outranks one without. The graph says otherwise.
    const v = view([], { built: 'emerging' });
    expect(chooseNextTopic(PAIR, v)?.id).toBe('ground');
  });

  it('offers the topic itself once its ground is at the floor', () => {
    const v = view(['ground'], { ground: 'secure', built: 'emerging' });
    expect(chooseNextTopic(PAIR, v)?.id).toBe('built');
  });

  it('counts a finished prerequisite as ground even when nothing is known about it', () => {
    // Silence is not a failing grade: a topic the learner completed before mastery was persisted
    // must not block everything standing on it forever.
    const v = { completed: new Set(['ground']), bandOf: NO_MASTERY };
    expect(chooseNextTopic(PAIR, v)?.id).toBe('built');
  });

  it('is never a wall: a topic blocked by its own ground is still reachable', () => {
    // `ground` is finished but below the floor, so nothing is "ready". Step 2 of the law still
    // answers, and the answer is the debt itself rather than nothing at all.
    const v = view(['ground'], { ground: 'emerging', built: 'emerging' });
    expect(chooseNextTopic(PAIR, v)?.id).toBe('ground');
  });

  it('ignores an edge whose other end is not on this board', () => {
    const orphan: Topic = { ...topic('orphan'), prereqTopicIds: ['a-topic-in-another-subject'] };
    expect(chooseNextTopic([orphan], view([]))?.id).toBe('orphan');
  });
});
