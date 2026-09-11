import { describe, expect, it } from 'bun:test';
import {
  ARCADE_GAMES,
  type ArcadeRound,
  type ArcadeSpec,
  arcadeRounds,
  chipsFor,
  deal,
  parseArcade,
  withinTolerance,
} from './spec';

/**
 * THE SIX MECHANICS, AT THE CLIENT'S EDGE (docs/CONTENT-INTERACTION.md §7).
 *
 * The gateway gates a bonus level before it is served (`plexus/arcade.py`), and this parser gates
 * it again on arrival, because a spec can also come off a cache written months ago. The two gates
 * are deliberately the same shape: a round the gateway would refuse must not play here either.
 *
 * Nothing generated executes on a learner's device. A game we do not render is refused, never
 * guessed at, and the card it rode on still teaches.
 */

const catchSpec = {
  id: 'a1',
  title: 'the sevens',
  game: 'catch',
  skill: 'recall',
  rounds: [
    { id: 'r1', prompt: '7 x 6', answer: '42', distractors: ['36', '48'] },
    { id: 'r2', prompt: '7 x 8', answer: '56', distractors: ['54', '64'] },
  ],
};

const specs: Record<string, unknown> = {
  catch: catchSpec,
  quiz: {
    id: 'a2',
    title: 'the sevens',
    game: 'quiz',
    skill: 'recall',
    seconds: 60,
    rounds: [{ id: 'r1', prompt: '7 x 6', answer: '42', options: ['42', '36', '48'] }],
  },
  sort: {
    id: 'a3',
    title: 'fractions',
    game: 'sort',
    skill: 'speed',
    seconds: 45,
    rounds: [{ id: 'r1', prompt: 'smallest first', order: ['1/4', '1/3', '1/2'] }],
  },
  match: {
    id: 'a4',
    title: 'the symbols',
    game: 'match',
    skill: 'recall',
    seconds: 60,
    rounds: [
      {
        id: 'r1',
        prompt: 'pair each one with what it is',
        pairs: [
          { left: 'Na', right: 'sodium' },
          { left: 'K', right: 'potassium' },
        ],
      },
    ],
  },
  numberline: {
    id: 'a5',
    title: 'fractions on the line',
    game: 'numberline',
    skill: 'speed',
    seconds: 40,
    rounds: [
      {
        id: 'r1',
        prompt: 'three quarters',
        target: 0.75,
        min: 0,
        max: 1,
        tolerance: 0.06,
      },
    ],
  },
  sequence: {
    id: 'a6',
    title: 'long multiplication',
    game: 'sequence',
    skill: 'recall',
    rounds: [
      {
        id: 'r1',
        prompt: 'put them back in order',
        steps: ['multiply the units', 'multiply the tens', 'add the rows'],
        why: 'the tens cannot be added before they are multiplied.',
      },
    ],
  },
};

describe('the menu', () => {
  it('is the owner’s six mechanics and no others', () => {
    expect(ARCADE_GAMES).toEqual(['catch', 'sort', 'match', 'numberline', 'sequence', 'quiz']);
  });
});

describe('the gate', () => {
  for (const game of ARCADE_GAMES) {
    it(`accepts a well-formed ${game}`, () => {
      const spec = parseArcade(specs[game]);
      expect(spec).not.toBeNull();
      expect(spec?.game).toBe(game);
    });
  }

  it('plays a wave-32 spec that names no game at all, as catch', () => {
    const old = {
      id: 'ar',
      title: 'catch it',
      rounds: [{ id: 'r1', prompt: '2 + 2', answer: '4', distractors: ['3', '5'] }],
    };
    expect(parseArcade(old)?.game).toBe('catch');
  });

  it('refuses a mechanic it cannot render rather than guessing at one', () => {
    expect(parseArcade({ ...catchSpec, game: 'platformer' })).toBeNull();
  });

  /** Mangle the first round of a spec, so a shape the gate must refuse can be written in a line. */
  const mangled = (game: string, patch: Record<string, unknown>): unknown => {
    const spec = structuredClone(specs[game]) as { rounds: Record<string, unknown>[] };
    spec.rounds = [{ ...spec.rounds[0], ...patch }];
    return spec;
  };

  it('refuses a quiz whose answer is not on the board', () => {
    expect(parseArcade(mangled('quiz', { answer: '41' }))).toBeNull();
  });

  it('refuses a number line whose tolerance swallows the line', () => {
    expect(parseArcade(mangled('numberline', { tolerance: 0.9 }))).toBeNull();
  });

  it('refuses a number line whose target is not on the line', () => {
    expect(parseArcade(mangled('numberline', { target: 4 }))).toBeNull();
  });

  it('refuses a sort or a sequence of one, which is not an ordering', () => {
    expect(parseArcade(mangled('sort', { order: ['1/2'] }))).toBeNull();
    expect(parseArcade(mangled('sequence', { steps: ['one'] }))).toBeNull();
  });

  it('refuses an unverified artifact outright', () => {
    expect(parseArcade({ verified: false, artifact: catchSpec })).toBeNull();
  });
});

describe('the deal — what the learner is shown', () => {
  it('shuffles a sort away from its answer, and the same round deals the same way twice', () => {
    const spec = parseArcade(specs.sort) as ArcadeSpec;
    const round = arcadeRounds(spec)[0] as ArcadeRound;
    const first = deal(round, 0);
    const again = deal(round, 0);
    expect(first).toEqual(again);
    expect([...first].sort()).toEqual([...chipsFor(round)].sort());
  });

  it('deals a different order on a second play, so it is not the same puzzle twice', () => {
    const spec = parseArcade(specs.sort) as ArcadeSpec;
    const round = arcadeRounds(spec)[0] as ArcadeRound;
    const runs = new Set([0, 1, 2, 3, 4].map((n) => deal(round, n).join('|')));
    expect(runs.size).toBeGreaterThan(1);
  });

  it('never deals the correct order back as the puzzle', () => {
    const spec = parseArcade(specs.sequence) as ArcadeSpec;
    const round = arcadeRounds(spec)[0] as ArcadeRound;
    const answer = chipsFor(round).join('|');
    // over many plays a shuffle may land on the answer by chance; it must not do so every time
    const dealt = [...Array(20).keys()].map((n) => deal(round, n).join('|'));
    expect(dealt.some((d) => d !== answer)).toBe(true);
  });
});

describe('defending the number line', () => {
  it('holds a tap inside the tolerance and lets a careless one through', () => {
    expect(withinTolerance(0.75, 0.75, 0.06)).toBe(true);
    expect(withinTolerance(0.79, 0.75, 0.06)).toBe(true);
    expect(withinTolerance(0.9, 0.75, 0.06)).toBe(false);
  });
});

describe('the register holds inside a game', () => {
  it('says nothing with an em dash, an exclamation or an emoji in it', () => {
    const said = Object.values(specs)
      .flatMap((s) => JSON.stringify(s))
      .join(' ');
    expect(said.includes('—')).toBe(false);
    expect(said.includes('!')).toBe(false);
  });
});
