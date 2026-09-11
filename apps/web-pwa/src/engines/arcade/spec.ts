/**
 * THE ARCADE, AT THE CLIENT'S EDGE — the six bonus-level mechanics as one parsed spec.
 *
 * docs/CONTENT-INTERACTION.md §7: catch, sort against the clock, match pairs, defend the number
 * line, build the sequence, the running quiz with lives. Six mechanics, not one skin, so the same
 * game on two chapters reads like two games.
 *
 * The gateway gates a level before it serves it (`plexus/arcade.py`) and this gates it again on
 * arrival, because a spec can come off a cache written months ago. The two gates are the same
 * shape on purpose. Nothing generated ever executes here: a level is data, the mechanic is code,
 * and a game we do not render is REFUSED rather than guessed at.
 *
 * The shapes are the generated contract (`@wobo/contracts/plexus`), narrowed off null the way the
 * rest of the client narrows a wire type. Nothing is re-declared: a drift between this file and
 * `specs.py` would be a compile error rather than a surprise on a learner's phone.
 */

import type {
  ArcadeCatchRound,
  ArcadeLineRound,
  ArcadeMatchRound,
  ArcadeQuizRound,
  ArcadeSequenceRound,
  ArcadeSortRound,
} from '@wobo/contracts/plexus';

/** The owner's six, in his order. */
export const ARCADE_GAMES = ['catch', 'sort', 'match', 'numberline', 'sequence', 'quiz'] as const;

export type ArcadeGame = (typeof ARCADE_GAMES)[number];
export type ArcadeSkill = 'speed' | 'recall';

/**
 * A ROUND, AS THE CLIENT HOLDS IT: tagged with its game so the shell can switch on it, and with
 * the wire's nulls gone. The wire may say `why: null`; a parsed round either carries the line or
 * does not have the key, so nothing downstream has to ask which kind of absent it is.
 *
 * The drift guard is below: each of these must still satisfy the generated contract, so a field
 * added or renamed in `specs.py` fails the build here rather than on a learner's phone.
 */
interface RoundBase {
  id: string;
  prompt: string;
  /** What a wrong move teaches, in the concept's own words. Never "try again". */
  why?: string;
}

export interface CatchRound extends RoundBase {
  game: 'catch';
  answer: string;
  distractors: string[];
}
export interface QuizRound extends RoundBase {
  game: 'quiz';
  answer: string;
  options: string[];
}
export interface SortRound extends RoundBase {
  game: 'sort';
  /** The CORRECT order. What the learner is dealt is `deal()`, never this. */
  order: string[];
  by?: string;
}
export interface MatchRound extends RoundBase {
  game: 'match';
  pairs: { left: string; right: string }[];
}
export interface LineRound extends RoundBase {
  game: 'numberline';
  target: number;
  min: number;
  max: number;
  tolerance: number;
  unit?: string;
}
export interface SequenceRound extends RoundBase {
  game: 'sequence';
  steps: string[];
  distractors?: string[];
}

/** The guard. `never` here means this file and the generated contract have drifted apart. */
type Holds<Parsed extends Wire, Wire> = Parsed;
type _drift = [
  Holds<Omit<CatchRound, 'game'>, ArcadeCatchRound>,
  Holds<Omit<QuizRound, 'game'>, ArcadeQuizRound>,
  Holds<Omit<SortRound, 'game'>, ArcadeSortRound>,
  Holds<Omit<MatchRound, 'game'>, ArcadeMatchRound>,
  Holds<Omit<LineRound, 'game'>, ArcadeLineRound>,
  Holds<Omit<SequenceRound, 'game'>, ArcadeSequenceRound>,
];

export type ArcadeRound =
  | CatchRound
  | QuizRound
  | SortRound
  | MatchRound
  | LineRound
  | SequenceRound;

export interface ArcadeSpec {
  id: string;
  title: string;
  game: ArcadeGame;
  skill: ArcadeSkill;
  /** The clock, where the mechanic has one. Catch falls at its own pace; the sequence teaches. */
  seconds?: number;
  rounds: ArcadeRound[];
}

// --- reading the wire ------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strs = (v: unknown, least: number): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter(str).map((s) => s.trim());
  return out.length >= least && new Set(out).size === out.length ? out : null;
};

const base = (r: Record<string, unknown>, i: number) => ({
  id: str(r.id) ? r.id : `r${i + 1}`,
  prompt: (r.prompt as string).trim(),
  ...(str(r.why) ? { why: r.why.trim() } : {}),
});

/** Each mechanic's own round gate. A round that does not fit its game refuses the whole level. */
const GATES: Record<ArcadeGame, (r: Record<string, unknown>, i: number) => ArcadeRound | null> = {
  catch: (r, i) => {
    const distractors = strs(r.distractors, 1);
    if (!str(r.answer) || !distractors) return null;
    return {
      game: 'catch',
      ...base(r, i),
      answer: r.answer.trim(),
      distractors: distractors.slice(0, 3),
    };
  },
  quiz: (r, i) => {
    const options = strs(r.options, 2);
    if (!options || !str(r.answer) || !options.includes(r.answer.trim())) return null;
    return { game: 'quiz', ...base(r, i), answer: r.answer.trim(), options: options.slice(0, 4) };
  },
  sort: (r, i) => {
    const order = strs(r.order, 2);
    if (!order || order.length > 6) return null;
    return { game: 'sort', ...base(r, i), order, ...(str(r.by) ? { by: r.by.trim() } : {}) };
  },
  match: (r, i) => {
    if (!Array.isArray(r.pairs) || r.pairs.length < 2 || r.pairs.length > 6) return null;
    const pairs = r.pairs
      .filter((p): p is Record<string, unknown> => isRecord(p) && str(p.left) && str(p.right))
      .map((p) => ({ left: (p.left as string).trim(), right: (p.right as string).trim() }));
    if (pairs.length !== r.pairs.length) return null;
    return { game: 'match', ...base(r, i), pairs };
  },
  numberline: (r, i) => {
    if (!num(r.target) || !num(r.min) || !num(r.max) || !num(r.tolerance)) return null;
    const span = r.max - r.min;
    if (span <= 0 || r.target < r.min || r.target > r.max) return null;
    // A tolerance wide enough to swallow the line means no tap can be wrong, which is exactly what
    // the wave 30 judges scored engagement 1.12 for. A quarter of the line is the ceiling.
    if (r.tolerance <= 0 || r.tolerance > span * 0.25) return null;
    return {
      game: 'numberline',
      ...base(r, i),
      target: r.target,
      min: r.min,
      max: r.max,
      tolerance: r.tolerance,
      ...(str(r.unit) ? { unit: r.unit.trim() } : {}),
    };
  },
  sequence: (r, i) => {
    const steps = strs(r.steps, 2);
    if (!steps || steps.length > 6) return null;
    const distractors = strs(r.distractors, 1);
    return {
      game: 'sequence',
      ...base(r, i),
      steps,
      ...(distractors ? { distractors: distractors.slice(0, 2) } : {}),
    };
  },
};

const isGame = (v: unknown): v is ArcadeGame =>
  typeof v === 'string' && (ARCADE_GAMES as readonly string[]).includes(v);

/**
 * The served spec, or nothing. A refused level is simply not offered: the side door does not
 * appear, the climb is unchanged, and the learner is never shown a broken game.
 */
export function parseArcade(raw: unknown): ArcadeSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  // A spec from wave 32 carries no `game`. It was the catch, and it still plays as one.
  const game = src.game === undefined ? 'catch' : src.game;
  if (!isGame(game)) return null;
  const gate = GATES[game];
  const raws = Array.isArray(src.rounds) ? src.rounds : [];
  const rounds: ArcadeRound[] = [];
  for (const [i, entry] of raws.entries()) {
    if (!isRecord(entry) || !str(entry.prompt)) return null;
    const round = gate(entry, i);
    if (!round) return null;
    rounds.push(round);
  }
  if (rounds.length === 0 || rounds.length > 12) return null;
  const seconds = num(src.seconds) && src.seconds >= 10 && src.seconds <= 180 ? src.seconds : null;
  return {
    id: str(src.id) ? src.id.trim() : 'arcade',
    title: str(src.title) ? src.title.trim() : 'bonus level',
    game,
    skill: src.skill === 'speed' ? 'speed' : 'recall',
    ...(seconds ? { seconds } : {}),
    rounds,
  };
}

export function arcadeRounds(spec: ArcadeSpec): ArcadeRound[] {
  return spec.rounds;
}

// --- what the learner is shown ------------------------------------------------------------------

/** The chips of a round, in the order that is CORRECT. Never what is dealt. */
export function chipsFor(round: ArcadeRound): string[] {
  switch (round.game) {
    case 'sort':
      return round.order;
    case 'sequence':
      return [...round.steps, ...(round.distractors ?? [])];
    case 'catch':
      return [round.answer, ...round.distractors];
    case 'quiz':
      return round.options;
    case 'match':
      return round.pairs.flatMap((p) => [p.left, p.right]);
    case 'numberline':
      return [];
  }
}

/**
 * A deterministic shuffle. The seed is the run number, so one run deals one way (a re-render never
 * reshuffles the board under a learner's finger) and the next run deals another (a second play is
 * not the same puzzle). xorshift32, no dependency, no Math.random in the render path.
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  let h = (seed + 0x9e3779b9) >>> 0;
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** What a round puts on the board: its chips, shuffled for this run. */
export function deal(round: ArcadeRound, run: number): string[] {
  return shuffle(chipsFor(round), run * 31 + round.id.length);
}

/** Did a tap on the line land close enough to count? */
export function withinTolerance(at: number, target: number, tolerance: number): boolean {
  return Math.abs(at - target) <= tolerance + 1e-9;
}

/**
 * What the shell says over each mechanic. Our own words, and the whole of them: the register
 * (voice.md 10a) holds inside a game, so there is no hype here, no exclamation and no emoji, and
 * an older learner gets the lighter half.
 */
export const ARCADE_COPY: Record<ArcadeGame, { how: string; lite: string }> = {
  catch: {
    how: 'slide to catch the right one. let the rest fall past.',
    lite: 'slide to catch the right one.',
  },
  sort: {
    how: 'tap two to swap them. smallest on the left, before the clock runs out.',
    lite: 'tap two to swap. smallest on the left.',
  },
  match: {
    how: 'tap one, then tap what it goes with. clear the board before the clock does.',
    lite: 'tap one, then tap its pair.',
  },
  numberline: {
    how: 'tap where the value sits on the line. close enough counts, careless does not.',
    lite: 'tap where it sits on the line.',
  },
  sequence: {
    how: 'tap them in the order they happen. a step that does not belong stays where it is.',
    lite: 'tap them in order.',
  },
  quiz: {
    how: 'answer while the clock runs. three lives, and a wrong tap costs one.',
    lite: 'answer while the clock runs.',
  },
};
