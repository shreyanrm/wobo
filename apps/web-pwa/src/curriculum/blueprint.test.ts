/**
 * The blueprint seam on the client: the course for a syllabus cell is built from the architect's
 * modules, not from a mechanical split, and the learner's progress is kept along them.
 *
 * The laws under test are docs/LEARNING-MODEL.md's: modules live in the CHAPTER'S pool, a GROUP of
 * them teaches a topic, the group is chosen per learner and choosing costs nothing, and mastery is
 * evidence the topic's ideas are held rather than a module count. Every case below is offline: a
 * blueprint is data, and nothing here calls the brain.
 */

import { describe, expect, test } from 'bun:test';
import {
  blueprintWalk,
  groundUnder,
  groupFor,
  insteadOf,
  isBlueprint,
  masteryOf,
  progressAlong,
  sideDoorsAfter,
} from './blueprint';
import type { Blueprint, BlueprintModule } from './blueprint';

// --- the same pool the gateway suite uses: CBSE class 8 Science, "Force and Pressure" ------------

function mech(id: string) {
  return [
    {
      id: `${id}-m1`,
      name: 'push the block',
      primitives: ['drag', 'drop'] as const,
      moves: 'the block along the table',
      responds: 'the arrow under it grows with the push',
      wrongMoveTeaches: 'a pull is still a force, so the arrow flips rather than vanishing',
    },
    {
      id: `${id}-m2`,
      name: 'sort the pictures',
      primitives: ['sort'] as const,
      moves: 'each picture into the push bin or the pull bin',
      responds: 'the bin shows the arrow the picture really needs',
      wrongMoveTeaches: 'opening a drawer is a pull even though your hand touches it',
    },
  ];
}

function mod(
  id: string,
  kind: BlueprintModule['kind'],
  role: BlueprintModule['role'],
  serves: string[],
  teaches: string[],
  extra: Partial<BlueprintModule> = {},
): BlueprintModule {
  return {
    id,
    aim: `aim for ${id}`,
    kind,
    role,
    serves,
    teaches,
    cores: ['force'],
    repairs: null,
    assumes: [],
    minutes: 7,
    mechanics: mech(id) as unknown as BlueprintModule['mechanics'],
    ...extra,
  };
}

function pool(): Blueprint {
  const modules: BlueprintModule[] = [
    mod('p9', 'simulation', 'way_in', ['t4'], ['i5']),
    mod('p10', 'worked', 'way_in', ['t4'], ['i5']),
    mod('p11', 'simulation', 'way_in', ['t5'], ['i6']),
    mod('p12', 'film', 'way_in', ['t5'], ['i6']),
    mod('r2', 'simulation', 'repair', ['t4'], ['i5'], { repairs: 'x2' }),
    mod('q2', 'worked', 'prerequisite', ['t4'], ['i5'], { assumes: ['a2'], minutes: 5 }),
    mod('s1', 'simulation', 'stretch', ['t4', 't5'], ['i5', 'i6'], { minutes: 9 }),
    mod('c2', 'items', 'check', ['t4', 't5'], ['i5', 'i6'], { minutes: 6 }),
    mod('g2', 'game', 'side_door', ['t5'], ['i6'], { minutes: 5 }),
    mod('b1', 'boss', 'boss', ['t4', 't5'], ['i5', 'i6'], { minutes: 10 }),
  ];
  return {
    node: 'cbse-8-science-force-and-pressure',
    chapter: 'Force and Pressure',
    board: 'CBSE',
    grade: '8',
    subject: 'Science',
    contentVersion: '2026-27',
    thread: 'how hard it presses, and over how much of it',
    topics: [
      { id: 't4', name: 'Pressure' },
      { id: 't5', name: 'Pressure in liquids and gases' },
    ],
    ideas: [
      { id: 'i5', what: 'pressure is the force spread over the area it presses on', topics: ['t4'] },
      { id: 'i6', what: 'a liquid presses on every wall it touches', topics: ['t5'] },
    ],
    misconceptions: [
      { id: 'x2', what: 'a heavier object always presses harder', topics: ['t4'] },
      { id: 'x3', what: 'a liquid presses only downwards', topics: ['t5'] },
    ],
    assumptions: [{ id: 'a2', what: 'area of a rectangle', fromChapter: 'Mensuration, class 7' }],
    modules,
    flow: {
      order: ['q2', 'p9', 'p10', 'r2', 'p11', 'p12', 'c2', 's1', 'b1'],
      why: 'the area comes before the pressure that needs it',
      sideDoors: [{ after: 'p12', module: 'g2', rehearses: 'how pressure climbs with depth' }],
      boss: 'b1',
      bossProves: 'the shape that survives the load, and why',
      skippable: ['p10'],
      neverSkip: ['p9', 'b1'],
      stuck: [{ module: 'p9', instead: 'q2', why: 'the area is what is missing, not the pressure' }],
    },
  };
}

// --- what a blueprint is --------------------------------------------------------------------------

describe('a blueprint is recognised, or it is not used at all', () => {
  test('a real one is', () => {
    expect(isBlueprint(pool())).toBe(true);
  });

  test('anything else is not, and nothing downstream guesses', () => {
    expect(isBlueprint(null)).toBe(false);
    expect(isBlueprint({ chapter: 'Force and Pressure' })).toBe(false);
    expect(isBlueprint({ ...pool(), modules: [] })).toBe(false);
    expect(isBlueprint({ ...pool(), flow: { ...pool().flow, order: [] } })).toBe(false);
  });
});

// --- the group ------------------------------------------------------------------------------------

describe('a group of modules teaches a topic, and the group is a selection', () => {
  test('the plain path is one way into each idea, then the check', () => {
    expect(blueprintWalk(pool(), 't4', {})).toEqual(['p9', 'c2']);
  });

  test('a module of the pool may serve two topics, which is why it lives at the chapter', () => {
    const t4 = blueprintWalk(pool(), 't4', {});
    const t5 = blueprintWalk(pool(), 't5', {});
    expect(t4).toContain('c2');
    expect(t5).toContain('c2');
  });

  test('a learner who has not shown the prerequisite gets it pulled in, first', () => {
    expect(blueprintWalk(pool(), 't4', { unmetAssumptions: ['a2'] })).toEqual(['q2', 'p9', 'c2']);
  });

  test('a learner who shows a misconception gets its repair, and nobody else does', () => {
    expect(blueprintWalk(pool(), 't4', { misconceptions: ['x2'] })).toContain('r2');
    expect(blueprintWalk(pool(), 't4', {})).not.toContain('r2');
  });

  test('a learner who already holds the idea is taken to the stretch, not the confirmations', () => {
    const fast = blueprintWalk(pool(), 't4', { heldIdeas: ['i5'] });
    expect(fast).toEqual(['s1']);
  });

  test('style changes the way in, and both ways teach the same idea', () => {
    const drawn = groupFor(pool(), 't4', { style: ['simulation'] });
    const worked = groupFor(pool(), 't4', { style: ['worked'] });
    expect(drawn.map((m) => m.id)).not.toEqual(worked.map((m) => m.id));
    for (const group of [drawn, worked]) {
      const taught = new Set(group.flatMap((m) => m.teaches));
      expect(taught.has('i5')).toBe(true);
    }
  });

  test('the boss belongs to the chapter and is never inside a topic group', () => {
    expect(blueprintWalk(pool(), 't4', {})).not.toContain('b1');
  });

  test('a side door is never in the path, and is offered off it', () => {
    expect(blueprintWalk(pool(), 't5', {})).not.toContain('g2');
    expect(sideDoorsAfter(pool(), 'p12')).toEqual(['g2']);
    expect(sideDoorsAfter(pool(), 'p9')).toEqual([]);
  });

  test('a group always runs in the flow’s own order', () => {
    const walk = blueprintWalk(pool(), 't4', { unmetAssumptions: ['a2'], misconceptions: ['x2'] });
    const order = pool().flow.order;
    const positions = walk.map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('an unknown topic is an empty group, never an invented one', () => {
    expect(blueprintWalk(pool(), 't99', {})).toEqual([]);
  });
});

// --- progress along the blueprint's levels ---------------------------------------------------------

describe('progress is kept along the blueprint’s own modules', () => {
  test('nothing done is nothing walked', () => {
    expect(progressAlong(pool(), 't4', {}, new Set())).toBe(0);
  });

  test('half the group done is half the walk', () => {
    expect(progressAlong(pool(), 't4', {}, new Set(['p9']))).toBeCloseTo(0.5);
  });

  test('the whole group done is a finished walk', () => {
    expect(progressAlong(pool(), 't4', {}, new Set(['p9', 'c2']))).toBe(1);
  });

  test('a module done that is not in this learner’s group does not move their bar', () => {
    expect(progressAlong(pool(), 't4', {}, new Set(['p10']))).toBe(0);
  });

  test('two learners take different numbers of modules to the same finished topic', () => {
    const behind = { unmetAssumptions: ['a2'], misconceptions: ['x2'] };
    const ahead = {};
    expect(blueprintWalk(pool(), 't4', behind).length).toBeGreaterThan(
      blueprintWalk(pool(), 't4', ahead).length,
    );
    expect(progressAlong(pool(), 't4', behind, new Set(['q2', 'p9', 'r2', 'c2']))).toBe(1);
    expect(progressAlong(pool(), 't4', ahead, new Set(['p9', 'c2']))).toBe(1);
  });
});

// --- mastery is evidence, never a module count ------------------------------------------------------

describe('mastery is the topic’s ideas held and its misconceptions gone', () => {
  test('a topic whose ideas are held and misconceptions gone is mastered', () => {
    expect(masteryOf(pool(), 't4', { heldIdeas: ['i5'] })).toBe(true);
  });

  test('a topic with a misconception still showing is not, whatever was finished', () => {
    expect(masteryOf(pool(), 't4', { heldIdeas: ['i5'], misconceptions: ['x2'] })).toBe(false);
  });

  test('an idea not held is not mastery, however many modules were done', () => {
    expect(masteryOf(pool(), 't4', {})).toBe(false);
  });
});

// --- the ground, and the stuck route -----------------------------------------------------------------

describe('the architect’s own statement of the ground', () => {
  test('a topic’s assumptions come back with the chapter they were taught in', () => {
    expect(groundUnder(pool(), 't4')).toEqual([
      { id: 'a2', what: 'area of a rectangle', fromChapter: 'Mensuration, class 7' },
    ]);
  });

  test('a topic that assumes nothing has no ground, and nothing is invented for it', () => {
    expect(groundUnder(pool(), 't5')).toEqual([]);
  });

  test('a stuck learner is shown something different, never the same module again', () => {
    expect(insteadOf(pool(), 'p9')).toBe('q2');
    expect(insteadOf(pool(), 'p10')).toBeNull();
  });
});
