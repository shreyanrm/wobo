/**
 * THE FOUR KINDS (docs/SUGGESTIONS-AND-NOTICES.md §2).
 *
 * Every test below is one clause of the table in that law. The four kinds are built here as pure
 * selections over a chapter's own pool, which is what makes each of the law's "may never" clauses
 * something a test can hold rather than something a reviewer has to remember.
 */

import { describe, expect, it } from 'bun:test';
import { nextThing, questionsToAsk, sideDoor, wayBack } from './kind';
import { pool } from './fixture';
import type { DoorOffer } from '../screens/course/side-door';
import { parseArcade } from '../engines/arcade/spec';

const bp = pool();
const none = new Set<string>();

// --- the next thing -------------------------------------------------------------------------------

describe('the next thing: one thing, named, and why it follows', () => {
  it('names one module, and it is the first of THIS learner’s own group', () => {
    const s = nextThing({ bp, topicId: 't4', done: none });
    expect(s).not.toBeNull();
    expect(s?.kind).toBe('next');
    // the plain learner's group for t4 is the one way in, then the check
    expect(s?.target).toEqual({ to: 'module', moduleId: 'p9' });
    expect(s?.title).toBe('spread the same push over more area');
  });

  it('follows the learner rather than the pool: an unmet assumption puts the ground first', () => {
    const s = nextThing({ bp, topicId: 't4', done: none, state: { unmetAssumptions: ['a2'] } });
    expect(s?.target).toEqual({ to: 'module', moduleId: 'q2' });
    expect(s?.why).toContain('the area of a rectangle');
  });

  it('says why it follows in the pool’s own words, never in a general one', () => {
    const s = nextThing({ bp, topicId: 't4', done: none });
    expect(s?.why).toContain('pressure is the force spread over the area it presses on');
  });

  it('moves on as the learner does, and is nothing at all when the group is walked', () => {
    expect(nextThing({ bp, topicId: 't4', done: new Set(['p9']) })?.target).toEqual({
      to: 'module',
      moduleId: 'c2',
    });
    expect(nextThing({ bp, topicId: 't4', done: new Set(['p9', 'c2']) })).toBeNull();
  });

  it('is never a list to choose from and never a ranking', () => {
    const s = nextThing({ bp, topicId: 't4', done: none });
    // one target, one title, and no second option anywhere in the shape
    expect(Array.isArray(s?.target)).toBe(false);
    expect(s?.questions).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('options');
  });

  it('never nudges anyone to keep going', () => {
    const s = nextThing({ bp, topicId: 't4', done: none });
    const said = `${s?.title} ${s?.why} ${s?.action}`.toLowerCase();
    for (const nag of ['keep going', 'don’t stop', "don't stop", 'streak', 'almost there', 'you can do it']) {
      expect(said).not.toContain(nag);
    }
  });

  it('offers nothing at all for a topic this pool does not teach', () => {
    expect(nextThing({ bp, topicId: 'nope', done: none })).toBeNull();
  });
});

// --- the way back ---------------------------------------------------------------------------------

describe('the way back: a different route into the same idea, and only after twice', () => {
  it('is not offered the first time', () => {
    expect(wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 1, met: new Set(['p9']) })).toBeNull();
  });

  it('is offered the second time, from the chapter’s OWN pool', () => {
    const s = wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 2, met: new Set(['p9']) });
    expect(s?.kind).toBe('way_back');
    // the architect wrote the route: p9 stuck -> p10
    expect(s?.target).toEqual({ to: 'module', moduleId: 'p10' });
    expect(bp.modules.some((m) => m.id === 'p10')).toBe(true);
  });

  it('is a DIFFERENT way in, never the same one again', () => {
    const s = wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 2, met: new Set(['p9']) });
    expect(s?.target).not.toEqual({ to: 'module', moduleId: 'p9' });
  });

  it('falls to another way into the same idea when the architect’s route is already met', () => {
    const s = wayBack({ bp, topicId: 't4', moduleId: 'p10', held: 3, met: new Set(['p10']) });
    expect(s?.target).toEqual({ to: 'module', moduleId: 'p9' });
  });

  it('offers nothing rather than a route the learner has already walked', () => {
    const met = new Set(['p9', 'p10']);
    expect(wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 4, met })).toBeNull();
  });

  it('never says they are struggling, and never reads as a verdict', () => {
    const s = wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 2, met: new Set(['p9']) });
    const said = `${s?.title} ${s?.why} ${s?.action} ${s?.note ?? ''}`.toLowerCase();
    for (const verdict of [
      'stuck',
      'struggl',
      'wrong',
      'mistake',
      'missed',
      'failed',
      'trouble',
      'difficult',
      'too hard',
      'try again',
      'instead',
      'easier',
    ]) {
      expect(said).not.toContain(verdict);
    }
  });

  it('names the same idea, so the learner knows it is the same thing from another side', () => {
    const s = wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 2, met: new Set(['p9']) });
    expect(s?.why).toContain('pressure is the force spread over the area it presses on');
  });
});

// --- the side door --------------------------------------------------------------------------------

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

describe('the side door: the arcade opened, and it is optional', () => {
  it('says a game opened, and where', () => {
    const s = sideDoor(offer);
    expect(s.kind).toBe('side_door');
    expect(s.title).toBe('the pressure ladder');
    expect(s.target).toEqual({ to: 'arcade', topicId: 't4' });
  });

  it('says, in the offer itself, that nothing is lost by declining', () => {
    expect(sideDoor(offer).note).toContain('without it');
  });

  it('promises no reward that a learner loses by not taking it', () => {
    const s = sideDoor(offer);
    const said = `${s.title} ${s.why} ${s.action} ${s.note ?? ''}`.toLowerCase();
    for (const loss of ['lose', 'expires', 'only today', 'last chance', 'miss out', 'before it closes']) {
      expect(said).not.toContain(loss);
    }
  });
});

// --- the question to ask --------------------------------------------------------------------------

const asks = [
  { text: 'why does the brick press harder on its edge', meaning: 'misconception:x2' },
  { text: 'does a heavier block always press harder', meaning: 'misconception:x2' },
  { text: 'why does water push on the side of the glass', meaning: 'misconception:x3' },
  { text: 'what is the exam like', meaning: 'misconception:not-a-real-one' },
  { text: 'which part is this', meaning: 'part:lid' },
];

describe('the question to ask: two or three this page can genuinely answer', () => {
  it('draws them from the concept’s own misconceptions', () => {
    const s = questionsToAsk({
      bp,
      topicId: 't4',
      asks,
      onGlass: new Set(['misconception:x2', 'misconception:x3']),
    });
    expect(s?.kind).toBe('ask');
    expect(s?.questions).toEqual([
      'why does the brick press harder on its edge',
      'does a heavier block always press harder',
    ]);
  });

  it('never offers one the page cannot answer', () => {
    const s = questionsToAsk({ bp, topicId: 't4', asks, onGlass: new Set(['misconception:x2']) });
    expect(s?.questions.every((q) => q !== 'why does water push on the side of the glass')).toBe(true);
  });

  it('never offers one whose misconception this pool never declared', () => {
    const s = questionsToAsk({
      bp,
      topicId: 't4',
      asks,
      onGlass: new Set(['misconception:x2', 'misconception:not-a-real-one']),
    });
    expect(s?.questions).not.toContain('what is the exam like');
  });

  it('never offers one that belongs to another topic', () => {
    const s = questionsToAsk({
      bp,
      topicId: 't5',
      asks,
      onGlass: new Set(['misconception:x2', 'misconception:x3']),
    });
    expect(s).toBeNull(); // only one of them is t5's, and one is not two
  });

  it('is two or three, never one and never four', () => {
    const first = { text: 'a', meaning: 'misconception:x2' };
    const many = [
      first,
      { text: 'b', meaning: 'misconception:x2' },
      { text: 'c', meaning: 'misconception:x2' },
      { text: 'd', meaning: 'misconception:x2' },
    ];
    const s = questionsToAsk({ bp, topicId: 't4', asks: many, onGlass: new Set(['misconception:x2']) });
    expect(s?.questions.length).toBe(3);
    const one = questionsToAsk({
      bp,
      topicId: 't4',
      asks: [first],
      onGlass: new Set(['misconception:x2']),
    });
    expect(one).toBeNull();
  });

  it('offers nothing rather than a promise broken on the tap, when the glass carries nothing', () => {
    expect(questionsToAsk({ bp, topicId: 't4', asks, onGlass: new Set() })).toBeNull();
  });
});

// --- what binds all four --------------------------------------------------------------------------

function every() {
  return [
    nextThing({ bp, topicId: 't4', done: none }),
    wayBack({ bp, topicId: 't4', moduleId: 'p9', held: 2, met: new Set(['p9']) }),
    sideDoor(offer),
    questionsToAsk({ bp, topicId: 't4', asks, onGlass: new Set(['misconception:x2', 'misconception:x3']) }),
  ].filter((s) => s !== null);
}

describe('the rules that bind every kind', () => {
  it('there are four kinds, and every one of them was built', () => {
    expect(every().length).toBe(4);
    expect(every().map((s) => s.kind).sort()).toEqual(['ask', 'next', 'side_door', 'way_back']);
  });

  it('every one carries a stable id, so a decline can stick to it', () => {
    const ids = every().map((s) => s.id);
    expect(new Set(ids).size).toBe(4);
    expect(every().map((s) => s.id)).toEqual(ids); // built twice, the same ids
  });

  it('is never an advertisement for a plan', () => {
    for (const s of every()) {
      const said = `${s.title} ${s.why} ${s.action} ${s.note ?? ''} ${s.questions.join(' ')}`.toLowerCase();
      for (const sell of ['upgrade', 'pro', 'max', 'plan', 'subscribe', 'free trial', 'unlock', 'rupees', '₹']) {
        expect(said).not.toContain(sell);
      }
    }
  });

  it('writes in the register: sentence case, no emoji, no exclamation, no dash a person reads', () => {
    for (const s of every()) {
      const said = `${s.title} ${s.why} ${s.action} ${s.note ?? ''} ${s.questions.join(' ')}`;
      expect(said).not.toContain('!');
      expect(said).not.toContain('—');
      expect(/\p{Extended_Pictographic}/u.test(said)).toBe(false);
      // no Title Case Headline anywhere
      expect(/\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+/.test(said)).toBe(false);
    }
  });

  it('carries a decline in its own shape, because declining has to be as easy as taking it', () => {
    for (const s of every()) expect(s.decline.length).toBeGreaterThan(2);
  });
});
