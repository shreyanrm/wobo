/**
 * THE ARBITER (docs/SUGGESTIONS-AND-NOTICES.md §2): *"At most one suggestion on screen at a time."*
 *
 * Four kinds can be true at the same moment on the same screen, so something has to choose, and the
 * choosing is the rule rather than the render: a screen that asks for a suggestion is handed one or
 * nothing, and cannot be handed two even by mistake.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { choose, PRIORITY } from './choose';
import { decline, forgetDeclines } from './session';
import { nextThing, questionsToAsk, sideDoor, wayBack } from './kind';
import { pool } from './fixture';
import { parseArcade } from '../engines/arcade/spec';
import type { DoorOffer } from '../screens/course/side-door';

const bp = pool();

const spec = parseArcade({
  id: 'bonus-3-sort',
  title: 'the pressure ladder',
  game: 'sort',
  skill: 'recall',
  seconds: 45,
  rounds: [{ id: 'r1', prompt: 'smallest first', order: ['1', '2', '3'] }],
});

const offer: DoorOffer = {
  chapterId: 'ch-1',
  chapterName: 'Force and Pressure',
  topicId: 't4',
  position: 3,
  spec: spec as NonNullable<typeof spec>,
  line: 'a side door, if you want it. the climb goes on without it.',
  why: 'holding these by heart is the skill here, so this one asks for them fast.',
};

const asks = [
  { text: 'why does the brick press harder on its edge', meaning: 'misconception:x2' },
  { text: 'does a heavier block always press harder', meaning: 'misconception:x2' },
];

function all() {
  return [
    nextThing({ bp, topicId: 't4', done: new Set<string>() }),
    wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 2, met: new Set(['p9']) }),
    sideDoor(offer),
    questionsToAsk({ bp, topicId: 't4', asks, onGlass: new Set(['misconception:x2']) }),
  ];
}

beforeEach(() => {
  forgetDeclines();
});

describe('at most one on screen at a time', () => {
  it('hands back one thing, never a list, however many are true at once', () => {
    const picked = choose(all());
    expect(picked).not.toBeNull();
    expect(Array.isArray(picked)).toBe(false);
  });

  it('lets the learner who cannot get in go first', () => {
    expect(choose(all())?.kind).toBe('way_back');
    expect(PRIORITY[0]).toBe('way_back');
  });

  it('puts the side door last, because it is the only one off the climb', () => {
    expect(PRIORITY[PRIORITY.length - 1]).toBe('side_door');
  });

  it('covers all four kinds in its order, so none can be silently unreachable', () => {
    expect([...PRIORITY].sort()).toEqual(['ask', 'next', 'side_door', 'way_back']);
  });

  it('hands back nothing when nothing is true, and nothing is an ordinary answer', () => {
    expect(choose([null, null, undefined])).toBeNull();
  });
});

describe('a declined suggestion is not offered again that session', () => {
  it('moves to the next kind once the first is declined', () => {
    const first = choose(all());
    expect(first?.kind).toBe('way_back');
    decline(first?.id ?? '');
    expect(choose(all())?.kind).toBe('ask');
  });

  it('ends in silence once every one of them has been declined', () => {
    for (let i = 0; i < 5; i++) {
      const s = choose(all());
      if (!s) break;
      decline(s.id);
    }
    expect(choose(all())).toBeNull();
  });

  it('declines the suggestion, not the kind: a different chapter’s door is still offered', () => {
    decline(sideDoor(offer).id);
    const elsewhere = sideDoor({ ...offer, chapterId: 'ch-2' });
    expect(choose([elsewhere])?.id).toBe(elsewhere.id);
  });
});
