/**
 * The web half of the wave-30 content scorecard (SCORECARD.md 3.5, #2, #9, #18): the grading
 * must not pass a full miss, a placeholder must never be rendered as the lesson, and a card's
 * activity must be reachable once its discovery is done.
 */

import { describe, expect, it } from 'bun:test';
import {
  BOSS_PASS_NEEDED,
  cardBeat,
  type GenCard,
  isPlaceholderEnvelope,
  outlineSteps,
  parseGenCourse,
  roundVerdict,
  WORKBOOK_PASS_NEEDED,
} from './Composing';

const item = (i: number, extra: Record<string, unknown> = {}) => ({
  type: 'fill',
  prompt: `q${i}`,
  answer: 'a',
  ...extra,
});

function wireCard(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'text',
    title: `card ${id}`,
    idea: 'an idea worth a look',
    reveal: 'the reveal',
    interaction: { kind: 'tap', prompt: 'tap it' },
    ...extra,
  };
}

function wireCourse(
  cards: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    topic: 'Algebra Play',
    cards,
    workbook: [item(1), item(2), item(3)],
    boss: [item(4), item(5), item(6)],
    ...extra,
  };
}

const discovery = {
  id: 'd1',
  title: 'one idea',
  stages: [
    {
      visual: { marks: [{ id: 'm1', shape: 'circle', x: 50, y: 31, r: 4 }] },
      interaction: { kind: 'tap', prompt: 'tap the circle', targets: ['m1'] },
      reveal: 'the reveal',
      caption: 'the caption',
    },
  ],
};

const flashcards = {
  id: 'f1',
  title: 'recall',
  cards: [
    { id: 'a', front: 'what is 2 + 2', back: '4' },
    { id: 'b', front: 'what is 3 + 3', back: '6' },
    { id: 'c', front: 'what is 4 + 4', back: '8' },
  ],
};

describe('#2 zero of three is not a pass', () => {
  it('the workbook needs a real number right, and the boss still needs two', () => {
    expect(WORKBOOK_PASS_NEEDED).toBeGreaterThanOrEqual(2);
    expect(BOSS_PASS_NEEDED).toBe(2);
  });

  it('a full miss never advances, whatever the bar', () => {
    for (const passNeeded of [0, 1, 2, 3]) {
      expect(roundVerdict(0, 3, passNeeded).advance).toBe(false);
    }
  });

  it('below the bar the line teaches instead of congratulating', () => {
    const v = roundVerdict(0, 3, WORKBOOK_PASS_NEEDED);
    expect(v.advance).toBe(false);
    expect(v.line).not.toContain('pass');
    expect(v.line).not.toContain('earned');
    expect(v.line).toContain('0 of 3');
    expect(v.line).toMatch(/answer/i);
  });

  it('at or above the bar it passes, and a clean sweep is named', () => {
    expect(roundVerdict(2, 3, WORKBOOK_PASS_NEEDED).advance).toBe(true);
    expect(roundVerdict(3, 3, WORKBOOK_PASS_NEEDED)).toEqual({
      advance: true,
      line: 'All of them. Clean.',
      // A round that passed has no rung to climb, so it never asks for another way in
      // (`shared.tsx`, the try-again ladder).
      anotherWay: false,
    });
  });

  it('nothing a learner reads carries an em dash', () => {
    for (const [c, p] of [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
    ] as const) {
      expect(roundVerdict(c, 3, p).line).not.toContain('—');
    }
  });

  it('an explanation the gateway sends rides the item to the learner', () => {
    const course = parseGenCourse(
      wireCourse([wireCard('c1'), wireCard('c2'), wireCard('c3')], {
        workbook: [
          item(1, { explanation: 'because both sides change together' }),
          item(2),
          item(3),
        ],
      }),
      'x',
    );
    expect(course?.workbook[0]?.explanation).toBe('because both sides change together');
    expect(course?.workbook[1]?.explanation).toBeUndefined();
  });
});

describe('#9 a placeholder is never the lesson', () => {
  it('reads provenance.placeholder and provenance.source from the envelope', () => {
    expect(isPlaceholderEnvelope({ provenance: { placeholder: true } })).toBe(true);
    expect(isPlaceholderEnvelope({ provenance: { source: 'seed' } })).toBe(true);
    expect(isPlaceholderEnvelope({ seeded: true })).toBe(true);
    expect(isPlaceholderEnvelope({ provenance: { source: 'generated' } })).toBe(false);
    expect(isPlaceholderEnvelope({ artifact: {} })).toBe(false);
    expect(isPlaceholderEnvelope(null)).toBe(false);
  });

  it('a course whose provenance says seed is marked seeded even when the envelope claims verified', () => {
    const raw = {
      ...wireCourse([wireCard('c1'), wireCard('c2'), wireCard('c3')]),
      verified: true,
      status: 'canonical',
      provenance: { engine: 'engine.compose', source: 'seed', placeholder: true },
    };
    const course = parseGenCourse({ artifact: raw, ...raw }, 'x');
    expect(course).not.toBeNull();
    expect(course?.seeded).toBe(true);
  });
});

describe('#9 the side column', () => {
  it('lists nothing for a placeholder course, and the real steps for a real one', () => {
    const real = parseGenCourse(wireCourse([wireCard('c1'), wireCard('c2'), wireCard('c3')]), 'x');
    expect(real && outlineSteps(real)).toEqual([
      'card c1',
      'card c2',
      'card c3',
      'the workbook',
      'the boss',
    ]);
    expect(real && outlineSteps({ ...real, seeded: true })).toEqual([]);
  });
});

describe('#18 the activity behind a discovery is reachable', () => {
  it('a card keeps both its discovery and its activity', () => {
    const course = parseGenCourse(
      wireCourse([wireCard('c1', { discovery, flashcards }), wireCard('c2'), wireCard('c3')]),
      'x',
    );
    const c1 = course?.cards[0];
    expect(c1?.discovery).toBeDefined();
    expect(c1?.activity?.type).toBe('flashcards');
  });

  it('the discovery plays first, the activity after it, the idea card when there is neither', () => {
    const both = {
      discovery: { id: 'd', title: 't', stages: [] },
      activity: { type: 'flashcards' },
    };
    const card = (over: Partial<GenCard>): GenCard =>
      ({
        id: 'c1',
        kind: 'text',
        title: 't',
        idea: 'i',
        interaction: { kind: 'tap', prompt: 'p' },
        reveal: 'r',
        ...over,
      }) as GenCard;
    expect(cardBeat(card(both as unknown as Partial<GenCard>), false)).toBe('discovery');
    expect(cardBeat(card(both as unknown as Partial<GenCard>), true)).toBe('activity');
    expect(cardBeat(card({ activity: both.activity as GenCard['activity'] }), false)).toBe(
      'activity',
    );
    expect(cardBeat(card({ discovery: both.discovery as GenCard['discovery'] }), true)).toBe(
      'idea',
    );
    expect(cardBeat(card({}), false)).toBe('idea');
  });
});
