/**
 * A chapter's pool, as data, for the suggestion tests.
 *
 * It is the same cell the blueprint suite uses (CBSE class 8 Science, "Force and Pressure") so the
 * two files cannot drift into disagreeing about what a pool looks like. Nothing here is rendered
 * and nothing here reaches the network: a blueprint is data, and every suggestion in this folder is
 * a selection over data that already exists.
 */

import type { Blueprint, BlueprintModule } from '../curriculum/blueprint';

function mech(id: string): BlueprintModule['mechanics'] {
  return [
    {
      id: `${id}-m1`,
      name: 'push the block',
      primitives: ['drag', 'drop'],
      moves: 'the block along the table',
      responds: 'the arrow under it grows with the push',
      wrongMoveTeaches: 'a pull is still a force, so the arrow flips rather than vanishing',
    },
  ] as BlueprintModule['mechanics'];
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
    cores: ['pressure'],
    repairs: null,
    assumes: [],
    minutes: 7,
    mechanics: mech(id),
    ...extra,
  };
}

export function pool(): Blueprint {
  const modules: BlueprintModule[] = [
    mod('q2', 'worked', 'prerequisite', ['t4'], ['i5'], { assumes: ['a2'], minutes: 5 }),
    mod('p9', 'simulation', 'way_in', ['t4'], ['i5'], {
      aim: 'spread the same push over more area',
    }),
    mod('p10', 'worked', 'way_in', ['t4'], ['i5'], { aim: 'work out the pressure under a brick' }),
    mod('p11', 'film', 'way_in', ['t5'], ['i6']),
    mod('r2', 'simulation', 'repair', ['t4'], ['i5'], {
      repairs: 'x2',
      aim: 'weigh two blocks that press the same',
    }),
    mod('c2', 'items', 'check', ['t4', 't5'], ['i5', 'i6'], {
      minutes: 6,
      aim: 'six of them, mixed',
    }),
    mod('s1', 'simulation', 'stretch', ['t4'], ['i5'], { minutes: 9, aim: 'the snowshoe problem' }),
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
      {
        id: 'i5',
        what: 'pressure is the force spread over the area it presses on',
        topics: ['t4'],
      },
      { id: 'i6', what: 'a liquid presses on every wall it touches', topics: ['t5'] },
    ],
    misconceptions: [
      { id: 'x2', what: 'a heavier object always presses harder', topics: ['t4'] },
      { id: 'x3', what: 'a liquid presses only downwards', topics: ['t5'] },
    ],
    assumptions: [
      { id: 'a2', what: 'the area of a rectangle', fromChapter: 'Mensuration, class 7' },
    ],
    modules,
    flow: {
      order: ['q2', 'p9', 'p10', 'r2', 'c2', 's1', 'p11', 'b1'],
      why: 'the area comes before the pressure that needs it',
      sideDoors: [{ after: 'p11', module: 'g2', rehearses: 'how pressure climbs with depth' }],
      boss: 'b1',
      bossProves: 'the shape that survives the load, and why',
      skippable: ['p10'],
      neverSkip: ['p9', 'b1'],
      stuck: [
        {
          module: 'p9',
          instead: 'p10',
          why: 'the numbers land for some learners before the picture does',
        },
      ],
    },
  };
}
