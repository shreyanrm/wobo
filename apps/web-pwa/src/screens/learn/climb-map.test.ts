/**
 * THE CLIMB'S DERIVATION.
 *
 * The map is the one surface that claims "we do not move on until it is mastered", so the two
 * drawings that make the claim are what these cases are mostly about: the return arc appears if
 * and only if the mastery state says a completed topic slipped, and the bridge appears if and only
 * if the real prerequisite state says the ground is not under the learner yet. A map that drew
 * either of them for decoration would be lying about the teaching.
 *
 * Every source is injected here so the derivation is tested without a registry, a storage or a
 * session; the defaults it uses in the app are the real modules, named in `climb.ts`.
 */

import { describe, expect, it } from 'bun:test';
import type { MasteryBand } from '@wobo/contracts';
import type { CurriculumNode } from '@wobo/sdk';
import { topicOf } from '../../curriculum/registry';
import { saveWorld, type World } from '../../curriculum/world';
import type { Chapter, Topic, TopicKind } from '../../data/model';
import {
  bridgeLine,
  buildClimb,
  CLIMB_REWARD,
  type ClimbGround,
  type ClimbInput,
  climbStats,
  nodeLine,
  waysLine,
} from './climb-map';

const topic = (id: string, name = id, kind: TopicKind = 'syllabus'): Topic => ({
  id,
  chapterId: 'c4',
  name,
  blurb: '',
  prereqTopicIds: [],
  kind,
  xp: 120,
});

const chapter = (topics: Topic[]): Chapter => ({
  id: 'c4',
  subjectId: 'Mathematics',
  index: 4,
  name: 'Fractions that are not whole',
  topics,
});

const FIVE = chapter([
  topic('t1', 'What the bottom number counts'),
  topic('t2', 'Halves, thirds, quarters'),
  topic('t3', 'Same size, different name'),
  topic('t4', 'Adding when the bottoms match'),
  topic('t5', 'A fraction of a fraction'),
]);

/** Nothing known, nothing under anything, nothing explained twice: the quietest possible learner. */
const bare = (over: Partial<ClimbInput> = {}): ClimbInput => ({
  completed: new Set<string>(),
  bandOf: () => 'not_started',
  groundOf: () => [],
  checkOf: () => null,
  waysOf: () => 0,
  ...over,
});

const bands =
  (map: Record<string, MasteryBand>) =>
  (t: Topic): MasteryBand =>
    map[t.id] ?? 'not_started';

describe('the climb', () => {
  it('is every topic of the chapter, in the syllabus order, and one node at the end', () => {
    const map = buildClimb(FIVE, bare());
    expect(map.nodes.map((n) => n.name)).toEqual([
      'What the bottom number counts',
      'Halves, thirds, quarters',
      'Same size, different name',
      'Adding when the bottoms match',
      'A fraction of a fraction',
      'Fractions that are not whole',
    ]);
    expect(map.nodes.map((n) => n.kind)).toEqual([
      'topic',
      'topic',
      'topic',
      'topic',
      'topic',
      'gate',
    ]);
    // the spine alternates sides above 640px; below it every node sits on one rail, in CSS
    expect(map.nodes.map((n) => n.side)).toEqual(['l', 'r', 'l', 'r', 'l', 'r']);
  });

  it('has no nodes at all for a chapter whose topics are not loaded', () => {
    const map = buildClimb(chapter([]), bare());
    expect(map.nodes).toEqual([]);
    expect(map.topics).toBe(0);
    expect(map.cleared).toBe(false);
  });

  it('reads learnt, where you are, and not reached yet from completion and the band together', () => {
    const map = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1', 't2']),
        bandOf: bands({ t1: 'independent', t2: 'secure' }),
      }),
    );
    expect(map.nodes.map((n) => n.state)).toEqual([
      'learnt',
      'learnt',
      'now',
      'ahead',
      'ahead',
      'ahead',
    ]);
    expect(map.nodes[2]?.topicId).toBe('t3');
  });

  it('calls a completed topic learnt when Wobo holds no evidence: silence is not a failing grade', () => {
    const map = buildClimb(FIVE, bare({ completed: new Set(['t1']) }));
    expect(map.nodes[0]?.state).toBe('learnt');
    expect(map.nodes[0]?.slipped).toBe(false);
  });

  it('says nothing is known of an untouched topic the learner has already walked past', () => {
    // the platform sent them to t4; t3 was never begun and never completed
    const map = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1', 't2']),
        bandOf: bands({ t1: 'secure', t2: 'secure' }),
        platformNodeId: null,
        topicProgress: { t4: 0.4 },
        inFlightTopicId: 't4',
      }),
    );
    expect(map.nodes[3]?.state).toBe('now');
    expect(map.nodes[2]?.state).toBe('unknown');
    expect(nodeLine(map.nodes[2] as NonNullable<(typeof map.nodes)[number]>)).toBe(
      'No record of this one either way',
    );
  });
});

describe('the debt loop', () => {
  const slipped = buildClimb(
    FIVE,
    bare({
      completed: new Set(['t1', 't2', 't3']),
      bandOf: bands({ t1: 'secure', t2: 'secure', t3: 'emerging' }),
    }),
  );

  it('is drawn on a topic the mastery state says fell back below the floor, and only there', () => {
    expect(slipped.nodes.map((n) => n.slipped)).toEqual([false, false, true, false, false, false]);
    expect(slipped.nodes[2]?.state).toBe('debt');
  });

  /**
   * THE MAP CARRIES BOTH, WHICH IS THE WHOLE POINT OF DRAWING IT.
   *
   * A debt is what comes back around; "you are here" is where the climb has reached. They are two
   * different facts and the drawing (design/prototypes/app-climb.html) shows both at once — node 3
   * owed, node 7 the pointer. `stateOf` answers `debt` before it answers `now`, so when the map
   * took the chooser's single answer for both jobs the debt swallowed the pointer and pig, the one
   * colour whose whole job is "you are here", never appeared on any chapter with a debt in it.
   */
  it('still says where the learner is standing while a debt is outstanding', () => {
    expect(slipped.nodes[2]?.state).toBe('debt');
    const now = slipped.nodes.filter((n) => n.state === 'now');
    expect(now).toHaveLength(1);
    // not the debt itself, and not a topic already behind them
    expect(now[0]?.key).toBe('t4');
    expect(nodeLine(now[0] as NonNullable<(typeof now)[number]>)).toContain('You are here');
  });

  it('draws the drawing: an owed node behind the pointer, and the pointer ahead of it', () => {
    const states = slipped.nodes.map((n) => n.state);
    expect(states).toEqual(['learnt', 'learnt', 'debt', 'now', 'ahead', 'ahead']);
    // and the spine reaches the pointer, not the debt: `--reached` is walked/nodes, and a map that
    // put `now` on node 3 stopped the mint fill a third of the way up a chapter half done.
    expect(slipped.reached).toBeCloseTo(3.5 / 6, 5);
  });

  it('says out loud what happened, so a vanished tick is never the only explanation', () => {
    expect(nodeLine(slipped.nodes[2] as NonNullable<(typeof slipped.nodes)[number]>)).toContain(
      'slipped',
    );
  });

  it('is drawn nowhere when every completed topic held', () => {
    const held = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1', 't2', 't3']),
        bandOf: bands({ t1: 'secure', t2: 'independent', t3: 'secure' }),
      }),
    );
    expect(held.nodes.some((n) => n.slipped)).toBe(false);
  });
});

describe('the bridge', () => {
  const ground: ClimbGround[] = [
    { topicId: 'g1', name: 'Multiplying whole numbers by parts' },
    { topicId: 'g2', name: 'What "of" means in a sum' },
  ];

  it('is drawn under the topic in hand when its ground is not under the learner', () => {
    const map = buildClimb(FIVE, bare({ groundOf: (t) => (t.id === 't1' ? ground : []) }));
    expect(map.nodes[0]?.bridge?.ground.map((g) => g.name)).toEqual([
      'Multiplying whole numbers by parts',
      'What "of" means in a sum',
    ]);
    expect(map.nodes[0]?.bridge?.checked).toBe(false);
  });

  it('is drawn under the next topic that needs ground, and under nothing further ahead', () => {
    const map = buildClimb(
      FIVE,
      bare({ groundOf: (t) => (t.id === 't3' || t.id === 't5' ? ground : []) }),
    );
    // t1 is where they are and needs nothing; t3 is the next that does; t5 is a week away
    expect(map.nodes.map((n) => Boolean(n.bridge))).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('is never drawn under a topic already learnt', () => {
    const map = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1']),
        bandOf: bands({ t1: 'secure' }),
        groundOf: () => ground,
      }),
    );
    expect(map.nodes[0]?.bridge).toBeNull();
  });

  it('lets a settled placement check outrank the syllabus, in both directions', () => {
    const found = buildClimb(
      FIVE,
      bare({
        groundOf: () => [],
        checkOf: (id) =>
          id === 't1' ? { checked: true, ground: [ground[0] as ClimbGround] } : null,
      }),
    );
    expect(found.nodes[0]?.bridge?.checked).toBe(true);
    expect(found.nodes[0]?.bridge?.ground).toHaveLength(1);

    // the same check, having found the ground solid: the derived graph does not get to argue
    const solid = buildClimb(
      FIVE,
      bare({
        groundOf: () => ground,
        checkOf: (id) => (id === 't1' ? { checked: true, ground: [] } : null),
      }),
    );
    expect(solid.nodes[0]?.bridge).toBeNull();
  });

  it('never claims a check that did not run', () => {
    expect(bridgeLine({ checked: false, ground })).toContain('Your syllabus puts');
    expect(bridgeLine({ checked: false, ground })).not.toContain('checked');
    expect(bridgeLine({ checked: true, ground })).toContain('Wobo checked');
  });
});

describe('the three counters', () => {
  it('are read off the state, never off a constant', () => {
    const map = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1', 't2', 't3']),
        bandOf: bands({ t1: 'secure', t2: 'independent', t3: 'developing' }),
        groundOf: (t) =>
          t.id === 't4' || t.id === 't5'
            ? [{ topicId: 'g1', name: 'Multiplying whole numbers by parts' }]
            : [],
      }),
    );
    expect(climbStats(map).map((s) => [s.value, s.label])).toEqual([
      [2, 'topics learnt'],
      [1, 'to go back for'],
      // one prerequisite, wanted by two topics, is one thing to teach
      [1, 'ground to lay first'],
    ]);
  });

  it('start at zero on a chapter nobody has opened', () => {
    expect(climbStats(buildClimb(FIVE, bare())).map((s) => s.value)).toEqual([0, 0, 0]);
  });
});

describe('the node at the end of the chapter', () => {
  it('says how many topics are still owed, and promises no test', () => {
    const map = buildClimb(FIVE, bare({ completed: new Set(['t1']) }));
    const end = map.nodes[map.nodes.length - 1] as NonNullable<(typeof map.nodes)[number]>;
    expect(end.kind).toBe('gate');
    expect(end.topicId).toBeNull();
    expect(nodeLine(end)).toBe('4 topics of this chapter still owed.');
  });

  it('is earned only when every topic of the chapter is learnt', () => {
    const map = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1', 't2', 't3', 't4', 't5']),
        bandOf: () => 'secure',
      }),
    );
    const end = map.nodes[map.nodes.length - 1] as NonNullable<(typeof map.nodes)[number]>;
    expect(map.cleared).toBe(true);
    expect(end.state).toBe('learnt');
    expect(nodeLine(end)).toBe('Every topic in this chapter is learnt.');
  });
});

describe('what the map says out loud', () => {
  it('draws a bonus or a mystery as a reward, and every other topic as a topic', () => {
    const map = buildClimb(chapter([topic('t1'), topic('t2', 'A curious aside', 'bonus')]), bare());
    expect(map.nodes.map((n) => n.kind)).toEqual(['topic', 'reward', 'gate']);
  });

  it('counts the ways Wobo has already explained the one in hand, and says nothing when it holds no record', () => {
    const tried = buildClimb(FIVE, bare({ waysOf: (t) => (t.id === 't1' ? 2 : 0) }));
    expect(nodeLine(tried.nodes[0] as NonNullable<(typeof tried.nodes)[number]>)).toBe(
      'You are here · 2 ways tried so far',
    );
    const silent = buildClimb(FIVE, bare());
    expect(nodeLine(silent.nodes[0] as NonNullable<(typeof silent.nodes)[number]>)).toBe(
      'You are here',
    );
    expect(waysLine(1)).toBe('1 way tried so far');
    expect(waysLine(0)).toBe('');
  });

  it('gives every node a sentence, so colour is never the only thing saying it', () => {
    const map = buildClimb(
      FIVE,
      bare({
        completed: new Set(['t1', 't2']),
        bandOf: bands({ t1: 'secure', t2: 'emerging' }),
      }),
    );
    for (const node of map.nodes) expect(nodeLine(node).length).toBeGreaterThan(0);
  });

  it('fills the spine only as far as the learner has actually walked', () => {
    expect(buildClimb(FIVE, bare()).reached).toBeCloseTo(0.5 / 6, 5);
    const walked = buildClimb(
      FIVE,
      bare({ completed: new Set(['t1', 't2', 't3']), bandOf: () => 'secure' }),
    );
    expect(walked.reached).toBeCloseTo(3.5 / 6, 5);
    const done = buildClimb(
      FIVE,
      bare({ completed: new Set(['t1', 't2', 't3', 't4', 't5']), bandOf: () => 'secure' }),
    );
    expect(done.reached).toBeLessThanOrEqual(1);
  });
});

/**
 * THE REWARD NODE — the chest in the drawing, and the one part of the map that was drawn but could
 * never appear.
 *
 * `kindOf` only ever answered `reward` for a topic of kind `bonus` or `mystery`, and nothing in
 * this product has ever produced either: `curriculum/registry.ts` `topicOf` stamped `'syllabus'` on
 * every node the brain served. So `RewardMark`, `.cl-chest` and its vibe rules were unreachable
 * code on every real chapter. These cases go through the REAL shaping function, not a hand-made
 * topic, so the seam that was broken is the seam under test.
 */
describe('the reward node comes from a real chapter', () => {
  const wireNode = (id: string, name: string, own: boolean): CurriculumNode => ({
    id,
    kind: 'topic',
    name,
    parentId: 'c4',
    order: 0,
    aliases: [],
    sourceRef: null,
    conceptIds: [],
    own,
    notInMySchool: false,
    textbook: null,
    renamedFrom: null,
    source: null,
    checksPassed: [],
    verifiedAt: null,
    objectives: [],
  });

  it('shapes a node the learner added themselves as their own topic, not the board’s', () => {
    expect(topicOf(wireNode('own:1', 'Why zero factorial is one', true), 'c4').kind).toBe('custom');
    expect(topicOf(wireNode('t9', 'Dividing by a fraction', false), 'c4').kind).toBe('syllabus');
  });

  it('says nothing is extra on a syllabus the learner wrote themselves', () => {
    // A personal framework is theirs top to bottom, so `own` marks nothing out on it — and a climb
    // where every stop is a chest says nothing at all. This is the seeded atom journey's own case
    // (`tests/helpers/brain.ts` publishes `own:atom-journey` with `own: true` on every node).
    const own: World = {
      frameworkId: 'own:atom-journey',
      frameworkName: 'My own chapter list',
      versionId: 'own-v1',
      versionYear: null,
      status: 'personal',
      label: 'Your own chapter list',
      level: 'Class 8',
      levels: ['Class 8'],
      subjects: ['Mathematics'],
      personal: true,
    };
    try {
      // both the way `adoptOwnSyllabus` records it and the way an older build did — the seeded
      // world in tests/helpers/brain.ts carries only the second
      for (const world of [own, { ...own, personal: false }]) {
        saveWorld(world);
        const shaped = topicOf(wireNode('own:1', 'Why zero factorial is one', true), 'c4');
        expect(shaped.kind).toBe('syllabus');
        // and the climb draws it as an ordinary stop, not as a chest
        const map = buildClimb(chapter([shaped]), bare());
        expect(map.nodes.filter((n) => n.kind === 'reward')).toHaveLength(0);
      }
    } finally {
      saveWorld(null);
    }
  });

  it('draws it as the reward on the climb, with its own name and its own door kept', () => {
    const added = topicOf(wireNode('own:1', 'Why zero factorial is one', true), 'c4');
    const board = topicOf(wireNode('t9', 'Dividing by a fraction', false), 'c4');
    const map = buildClimb(chapter([board, added]), bare());
    const reward = map.nodes.filter((n) => n.kind === 'reward');
    expect(reward).toHaveLength(1);
    expect(reward[0]?.name).toBe('Why zero factorial is one');
    expect(reward[0]?.topicId).toBe('own:1');
    // its state is the state any topic in that position would have — a costume, never a gate
    expect(reward[0]?.state).toBe(map.nodes[1]?.state);
  });

  it('says in words where it came from, so marigold is never the only thing saying it', () => {
    const added = topicOf(wireNode('own:1', 'Why zero factorial is one', true), 'c4');
    const map = buildClimb(chapter([added]), bare());
    const line = nodeLine(map.nodes[0] as NonNullable<(typeof map.nodes)[number]>);
    expect(line).toContain(CLIMB_REWARD);
    expect(line).toContain('you added this one yourself');
  });

  it('leaves every board topic alone', () => {
    const map = buildClimb(FIVE, bare());
    expect(map.nodes.filter((n) => n.kind === 'reward')).toHaveLength(0);
  });
});
