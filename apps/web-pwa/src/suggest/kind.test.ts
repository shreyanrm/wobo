/**
 * THE FOUR KINDS (docs/SUGGESTIONS-AND-NOTICES.md §2).
 *
 * Every test below is one clause of the table in that law. The four kinds are built here as pure
 * selections over a chapter's own pool, which is what makes each of the law's "may never" clauses
 * something a test can hold rather than something a reviewer has to remember.
 */

import { describe, expect, it } from 'bun:test';
import { parseArcade } from '../engines/arcade/spec';
import type { DoorOffer } from '../screens/course/side-door';
import { pool } from './fixture';
import { nextThing, questionsToAsk, sideDoor, wayBack } from './kind';

const bp = pool();

// --- the next thing -------------------------------------------------------------------------------

/** A module of the fixture, by id. What the course hands over is played in `one-chooser.test.ts`. */
const mod = (id: string) => bp.modules.find((m) => m.id === id) ?? null;

describe('the next thing: one thing, named, and why it follows', () => {
  it('names the one module the course hands over, and nothing else', () => {
    const s = nextThing({ bp, topicId: 't4', next: mod('p9') });
    expect(s).not.toBeNull();
    expect(s?.kind).toBe('next');
    expect(s?.target).toEqual({ to: 'module', moduleId: 'p9' });
    expect(s?.title).toBe('spread the same push over more area');
  });

  it('says why ground comes first, in the pool’s own words for that ground', () => {
    const s = nextThing({ bp, topicId: 't4', next: mod('q2') });
    expect(s?.target).toEqual({ to: 'module', moduleId: 'q2' });
    expect(s?.why).toContain('the area of a rectangle');
  });

  it('says why it follows in the pool’s own words, never in a general one', () => {
    const s = nextThing({ bp, topicId: 't4', next: mod('p9') });
    expect(s?.why).toContain('pressure is the force spread over the area it presses on');
    expect(nextThing({ bp, topicId: 't4', next: mod('r2') })?.why).toContain(
      'a heavier object always presses harder',
    );
  });

  it('is nothing at all when the course has nothing to hand over', () => {
    expect(nextThing({ bp, topicId: 't4', next: null })).toBeNull();
  });

  it('is never a list to choose from and never a ranking', () => {
    const s = nextThing({ bp, topicId: 't4', next: mod('p9') });
    // one target, one title, and no second option anywhere in the shape
    expect(Array.isArray(s?.target)).toBe(false);
    expect(s?.questions).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('options');
  });

  it('never nudges anyone to keep going', () => {
    for (const id of ['q2', 'p9', 'p10', 'r2', 'c2', 's1']) {
      const s = nextThing({ bp, topicId: 't4', next: mod(id) });
      const said = `${s?.title} ${s?.why} ${s?.action}`.toLowerCase();
      for (const nag of [
        'keep going',
        'don’t stop',
        "don't stop",
        'streak',
        'almost there',
        'you can do it',
      ]) {
        expect(said).not.toContain(nag);
      }
    }
  });

  it('offers nothing for a module that does not serve this topic', () => {
    expect(nextThing({ bp, topicId: 'nope', next: mod('p9') })).toBeNull();
    expect(nextThing({ bp, topicId: 't4', next: mod('p11') })).toBeNull();
  });
});

// --- the way back ---------------------------------------------------------------------------------

describe('the way back: a different route into the same idea, and only after twice', () => {
  it('is not offered the first time', () => {
    expect(wayBack({ bp, topicId: 't4', from: 'p9', held: 1, next: mod('p10') })).toBeNull();
  });

  it('is offered the second time, naming the route the course takes', () => {
    const s = wayBack({ bp, topicId: 't4', from: 'p9', held: 2, next: mod('p10') });
    expect(s?.kind).toBe('way_back');
    expect(s?.target).toEqual({ to: 'module', moduleId: 'p10' });
    expect(bp.modules.some((m) => m.id === 'p10')).toBe(true);
  });

  it('is a DIFFERENT way in, never the same one again', () => {
    expect(wayBack({ bp, topicId: 't4', from: 'p9', held: 2, next: mod('p9') })).toBeNull();
  });

  it('says what the other route is, whichever the course took', () => {
    expect(wayBack({ bp, topicId: 't4', from: 'p10', held: 3, next: mod('p9') })?.why).toContain(
      'as something to push around',
    );
    expect(wayBack({ bp, topicId: 't4', from: 'p9', held: 2, next: mod('p10') })?.why).toContain(
      'worked through a number at a time',
    );
  });

  it('never says they are struggling, and never reads as a verdict', () => {
    for (const [from, to] of [
      ['p9', 'p10'],
      ['p10', 'p9'],
      ['c2', 'r2'],
      ['p9', 'q2'],
    ] as const) {
      const s = wayBack({ bp, topicId: 't4', from, held: 2, next: mod(to) });
      expect(s).not.toBeNull();
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
    }
  });

  it('names the same idea, so the learner knows it is the same thing from another side', () => {
    const s = wayBack({ bp, topicId: 't4', from: 'p9', held: 2, next: mod('p10') });
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
    for (const loss of [
      'lose',
      'expires',
      'only today',
      'last chance',
      'miss out',
      'before it closes',
    ]) {
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
    expect(s?.questions.every((q) => q !== 'why does water push on the side of the glass')).toBe(
      true,
    );
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
    const s = questionsToAsk({
      bp,
      topicId: 't4',
      asks: many,
      onGlass: new Set(['misconception:x2']),
    });
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
    nextThing({ bp, topicId: 't4', next: mod('p9') }),
    wayBack({ bp, topicId: 't4', from: 'p9', held: 2, next: mod('p10') }),
    sideDoor(offer),
    questionsToAsk({
      bp,
      topicId: 't4',
      asks,
      onGlass: new Set(['misconception:x2', 'misconception:x3']),
    }),
  ].filter((s) => s !== null);
}

describe('the rules that bind every kind', () => {
  it('there are four kinds, and every one of them was built', () => {
    expect(every().length).toBe(4);
    expect(
      every()
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['ask', 'next', 'side_door', 'way_back']);
  });

  it('every one carries a stable id, so a decline can stick to it', () => {
    const ids = every().map((s) => s.id);
    expect(new Set(ids).size).toBe(4);
    expect(every().map((s) => s.id)).toEqual(ids); // built twice, the same ids
  });

  it('is never an advertisement for a plan', () => {
    for (const s of every()) {
      const said =
        `${s.title} ${s.why} ${s.action} ${s.note ?? ''} ${s.questions.join(' ')}`.toLowerCase();
      for (const sell of [
        'upgrade',
        'pro',
        'max',
        'plan',
        'subscribe',
        'free trial',
        'unlock',
        'rupees',
        '₹',
      ]) {
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
