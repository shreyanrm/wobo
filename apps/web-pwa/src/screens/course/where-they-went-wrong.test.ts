/**
 * WHERE THEY WENT WRONG, PLAYED RATHER THAN READ (docs/LEARNING-MODEL.md, "The tutor never
 * leaves", the owner 2026-09-15).
 *
 * *"Is the content and teaching plan continuously optimising and personalising to the learner's
 * needs until they master or understand that topic? It should be motivating, continuous support,
 * understanding and guiding where they went wrong, and so on."*
 *
 * This file answers rule 3 for the composed course's own workbook and boss, and the half of rule 4
 * the boss was missing. It plays ONE learner through a sequence of modules: the group is chosen
 * for them from the REAL chapter pool (`suggest/fixture.ts`) by the REAL climb
 * (`curriculum/blueprint.ts`), and on every module they work the REAL floor course
 * (`Composing.seedCourse`) through the REAL answer check (`answerIsCorrect`), the REAL round
 * verdict and the REAL reward sizing (`store/progress.bloomHold`). They get things wrong, they sit
 * with it, they get one right after a wrong one, and they finally clear the boss on the fourth
 * round. No model is called and no network is touched: a floor is code and a group is a selection.
 *
 * The three things it holds down, each of which was false in `Composing.tsx` before it:
 *
 *   1. RULE 3, on the floor. Every workbook and boss item the client floor draws carries the reason
 *      its answer is the answer. All six had none, so every miss on the one path that renders them
 *      was the answer and nothing else, which is the generic hint rule 3 forbids.
 *   2. RULE 4, on the screen. The three blocks a learner reads down one workbook never open with
 *      the same sentence. They all opened with the same six words, with a different tail hung off
 *      each, which is a form's sentence printed three times.
 *   3. RULE 4, at the boss. The largest moment in the product (docs/REWARDS.md §3) is sized by what
 *      it cost. It was held flat, so a fourth-round clear got the same breath as a first-try one.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

/**
 * Bun has no browser storage and several modules under here are durable on purpose. Installed
 * before the imports below, and with `??` rather than an assignment, because `bun test` runs every
 * file in ONE process and about ten of them install a stand-in like this at module scope: taking
 * the store out from under whichever loaded first breaks files nowhere near this one
 * (`tutor-never-leaves.test.ts` carries the measurement of exactly that).
 */
class MemoryStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
g.localStorage = g.localStorage ?? (new MemoryStorage() as unknown as Storage);
g.sessionStorage = g.sessionStorage ?? (new MemoryStorage() as unknown as Storage);

const { groupFor, masteryOf } = await import('../../curriculum/blueprint');
const { pool } = await import('../../suggest/fixture');
const { bloomHold } = await import('../../store/progress');
const {
  answerIsCorrect,
  BOSS_PASS_NEEDED,
  bossAward,
  MISS_ANSWER_CLAUSES,
  missLine,
  roundVerdict,
  seedCourse,
  WORKBOOK_PASS_NEEDED,
} = await import('./Composing');
const { TRY_AGAIN_RUNGS } = await import('./shared');

type Item = ReturnType<typeof seedCourse>['workbook'][number];

// --- the learner ----------------------------------------------------------------------------------

/** One checked round: what the learner put in, what came back, and what they read under it. */
interface Round {
  marks: boolean[];
  /** The line under each item they missed, in the order they appear down the screen. */
  lines: string[];
  verdict: ReturnType<typeof roundVerdict>;
}

/**
 * Check one round the way the screen checks it: the product's own answer comparison, the product's
 * own miss line per item position, the product's own verdict for the rung they are standing on.
 */
function check(items: readonly Item[], entries: readonly string[], round: number, pass: number): Round {
  const marks = items.map((item, i) => answerIsCorrect(item, entries[i] ?? ''));
  const lines = items.flatMap((item, i) => (marks[i] ? [] : [missLine(item, i)]));
  const correct = marks.filter(Boolean).length;
  return { marks, lines, verdict: roundVerdict(correct, items.length, pass, round) };
}

/** What a learner types when they have not got it. Never accidentally the answer. */
const WRONG = 'the one that looked right';

const allWrong = (items: readonly Item[]): string[] => items.map(() => WRONG);

/**
 * The words a tutor never uses, and the marks a Wobo line never carries (voice.md §3, §10a, and
 * docs/REWARDS.md §4: *"It never says they were wrong"*).
 *
 * "Try again" is deliberately NOT banned outright. What rule 3 forbids is the generic hint — a line
 * whose whole content is *"incorrect, try again"* — and the ladder's own first rung ends *"read it,
 * see why it is the answer, then try again"*, which is a tutor pointing at the teaching on the
 * screen and then asking for another go. The shape is what is forbidden, so the shape is what is
 * checked: `GENERIC` below refuses a line that OPENS as a verdict, which is the form's sentence.
 */
const GENERIC = /^(that is |)(wrong|incorrect|not quite|nope|try again|have another go)\b/i;

function speaksLikeATutor(line: string): void {
  expect(line).not.toContain('—');
  expect(line).not.toContain('!');
  expect(line.toLowerCase()).not.toContain('wrong');
  expect(line.toLowerCase()).not.toContain('incorrect');
  expect(line).not.toMatch(GENERIC);
  // never narrates itself (DESIGN.md §0.x, voice.md §10c)
  expect(line.toLowerCase()).not.toContain('let me');
  expect(line.toLowerCase()).not.toContain("i'll ");
}

/** The opening of a line, which is the half that was identical on every item on the screen. */
const opening = (line: string): string => line.split(/\s+/).slice(0, 6).join(' ');

const BP = pool();
const TOPIC = 't4';

/** The learner this file follows: behind on the ground, and carrying one misconception. */
const STRUGGLING = { unmetAssumptions: ['a2'], misconceptions: ['x2'] };

let floor: ReturnType<typeof seedCourse>;
beforeEach(() => {
  floor = seedCourse('Force and pressure');
});

// --- rule 3: the floor says where they went wrong -------------------------------------------------

describe('every item the floor draws carries the reason its answer is the answer', () => {
  /**
   * The defect in one line: all six of these had no `explanation` at all, so the branch that prints
   * one was dead for every one of them and a miss printed the answer by itself.
   */
  it('gives all six of its items a reason, not one of them bare', () => {
    const items = [...floor.workbook, ...floor.boss];
    expect(items.length).toBe(6);
    for (const item of items) {
      expect([item.id, (item.explanation ?? '').trim().length > 0]).toEqual([item.id, true]);
    }
  });

  it('never says the same thing about two different items', () => {
    const reasons = [...floor.workbook, ...floor.boss].map((i) => i.explanation);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('and every one of them reads like a tutor rather than a form', () => {
    for (const item of [...floor.workbook, ...floor.boss]) {
      speaksLikeATutor(item.explanation ?? '');
      // a reason is a sentence about the idea, never a code and never a hint stub
      expect((item.explanation ?? '').length).toBeGreaterThan(40);
    }
  });
});

// --- rule 4: the screen never says one sentence three times ---------------------------------------

describe('a learner who misses all three reads three different things', () => {
  it('opens each of the three blocks differently, on one screen', () => {
    const round = check(floor.workbook, allWrong(floor.workbook), 0, WORKBOOK_PASS_NEEDED);
    expect(round.lines.length).toBe(3);
    // the whole line, and the opening clause on its own: the opening is what was identical
    expect(new Set(round.lines).size).toBe(3);
    expect(new Set(round.lines.map(opening)).size).toBe(3);
  });

  it('puts the reason before the answer, so the new half is the half they read first', () => {
    const [first] = check(floor.workbook, allWrong(floor.workbook), 0, WORKBOOK_PASS_NEEDED).lines;
    const item = floor.workbook[0];
    expect(first?.startsWith((item?.explanation ?? '').slice(0, 30))).toBe(true);
    expect(first).toContain(item?.answer ?? '');
  });

  it('never says they were wrong, on any block, however many times they miss', () => {
    for (const round of [0, 1, 2, 3, 7]) {
      const played = check(floor.workbook, allWrong(floor.workbook), round, WORKBOOK_PASS_NEEDED);
      for (const line of played.lines) speaksLikeATutor(line);
      speaksLikeATutor(played.verdict.line);
    }
  });

  /**
   * An item that never got a reason (a course composed before the schema grew one, read back off
   * this device) still must not print the line its neighbours print.
   */
  it('keeps the three apart even when the reasons never arrived', () => {
    const bare = floor.workbook.map(({ explanation: _drop, ...rest }) => rest as Item);
    const round = check(bare, allWrong(bare), 0, WORKBOOK_PASS_NEEDED);
    expect(new Set(round.lines).size).toBe(3);
    expect(MISS_ANSWER_CLAUSES.length).toBeGreaterThanOrEqual(3);
  });

  /** It varies by attempt, never by randomness (docs/REWARDS.md §4): a re-read is a re-read. */
  it('says exactly the same thing when they look at it again', () => {
    const once = check(floor.workbook, allWrong(floor.workbook), 0, WORKBOOK_PASS_NEEDED).lines;
    const twice = check(floor.workbook, allWrong(floor.workbook), 1, WORKBOOK_PASS_NEEDED).lines;
    expect(twice).toEqual(once);
  });
});

// --- the walk: a sequence of modules, wrong answers, slow answers, a right one after a wrong one ---

describe('one struggling learner, a group of modules, end to end', () => {
  it('walks the group the pool chose for them, and never reads one line twice on a screen', () => {
    const group = groupFor(BP, TOPIC, STRUGGLING);
    expect(group.length).toBeGreaterThan(1);
    // the module that lays the ground they are missing comes first, and the repair for the mistake
    // they actually made is in the group at all
    expect(group[0]?.role).toBe('prerequisite');
    expect(group.map((m) => m.id)).toContain('r2');

    for (const module of group) {
      const course = seedCourse(module.id);
      const round = check(course.workbook, allWrong(course.workbook), 0, WORKBOOK_PASS_NEEDED);
      expect([module.id, round.lines.length]).toEqual([module.id, 3]);
      expect([module.id, new Set(round.lines).size]).toEqual([module.id, 3]);
      expect([module.id, new Set(round.lines.map(opening)).size]).toEqual([module.id, 3]);
      for (const line of round.lines) speaksLikeATutor(line);
      // and the round that missed everything never advances them past it
      expect([module.id, round.verdict.advance]).toEqual([module.id, false]);
    }
  });

  it('answers slowly and is told exactly what a quick answer is told', () => {
    // Nothing pays for speed and nothing charges for slowness (docs/LEVELS.md §4). The line a
    // learner reads is a function of the attempt and of the item, and of nothing else, so a
    // learner who sat with it for a minute reads what the learner who guessed at once reads.
    const quick = check(floor.workbook, allWrong(floor.workbook), 0, WORKBOOK_PASS_NEEDED);
    const slow = check(floor.workbook, allWrong(floor.workbook), 0, WORKBOOK_PASS_NEEDED);
    expect(slow.lines).toEqual(quick.lines);
    expect(slow.verdict).toEqual(quick.verdict);
  });

  it('stops talking about the one they got right, and keeps teaching the ones they missed', () => {
    const items = floor.workbook;
    const first = items[0];
    if (!first) throw new Error('the floor lost its workbook');
    // THE RIGHT ANSWER AFTER A WRONG ONE: they come back and get the first one.
    const entries = [first.answer, WRONG, WRONG];
    const round = check(items, entries, 1, WORKBOOK_PASS_NEEDED);

    expect(round.marks[0]).toBe(true);
    expect(round.lines.length).toBe(2);
    // nothing is said about the one that landed
    for (const line of round.lines) expect(line).not.toContain(first.answer);
    // and the two still open carry their own reasons rather than one shared line
    expect(new Set(round.lines).size).toBe(2);
    for (const line of round.lines) speaksLikeATutor(line);
    // still under the bar, so the set stays open and the ladder has somewhere left to climb
    expect(round.verdict.advance).toBe(false);
    expect(TRY_AGAIN_RUNGS).toBeGreaterThan(1);
  });

  it('lets them through the moment two of the three land, and says it is earned', () => {
    const items = floor.workbook;
    const entries = items.map((item, i) => (i < 2 ? item.answer : WRONG));
    const round = check(items, entries, 2, WORKBOOK_PASS_NEEDED);
    expect(round.verdict.advance).toBe(true);
    expect(round.verdict.line).toContain('earned');
    // the one they still missed is still taught on the way past it
    expect(round.lines.length).toBe(1);
    expect((round.lines[0] ?? '').length).toBeGreaterThan(40);
  });

  it('stops at the evidence rather than at a count of what they did', () => {
    // the misconception is still standing, so the topic is not held however many modules they did
    expect(masteryOf(BP, TOPIC, { heldIdeas: ['i5'], misconceptions: ['x2'] })).toBe(false);
    expect(masteryOf(BP, TOPIC, { heldIdeas: ['i5'] })).toBe(true);
  });
});

// --- rule 4 at the boss: the largest moment is sized by what it cost ------------------------------

describe('the boss they finally cleared is held longer than the one they walked', () => {
  /** They miss it, miss it again, miss it a third time, and clear it on the fourth round. */
  it('pays the fourth-round clear more of the moment than the first-try clear', () => {
    const boss = floor.boss;
    let round = 0;
    for (; round < 3; round += 1) {
      const played = check(boss, allWrong(boss), round, BOSS_PASS_NEEDED);
      expect(played.verdict.advance).toBe(false);
      for (const line of played.lines) speaksLikeATutor(line);
    }
    // the fourth round: they clear it
    const cleared = check(boss, boss.map((i) => i.answer), round, BOSS_PASS_NEEDED);
    expect(cleared.verdict.advance).toBe(true);
    const tries = round + 1;
    expect(tries).toBe(4);

    const late = bossAward('t4', 'var(--pig)', tries);
    const firstTime = bossAward('t4', 'var(--pig)', 1);
    expect(late.tries).toBe(4);
    expect(bloomHold(late.tries)).toBeGreaterThan(bloomHold(firstTime.tries));
    // it is the same award, banked once, whichever round it came on: nothing is deducted, ever
    expect(late.onceKey).toBe(firstTime.onceKey);
    expect(late.hue).toBe(firstTime.hue);
  });

  it('never shrinks the moment as the rounds climb, and never runs backwards', () => {
    let last = 0;
    for (const tries of [1, 2, 3, 4, 5, 9]) {
      const hold = bloomHold(bossAward('t4', 'var(--pig)', tries).tries);
      expect(hold).toBeGreaterThanOrEqual(last);
      last = hold;
    }
    // a caller that knows nothing about the rounds still earns the whole first-try moment
    expect(bossAward('t4', 'var(--pig)', 0).tries).toBe(1);
    expect(bloomHold(bossAward('t4', 'var(--pig)', 0).tries)).toBe(bloomHold(1));
  });

  it('and it is still a breath rather than a ceremony to sit through', () => {
    // REWARDS.md §7: under 400ms for everything except the three surfaces, and a bloom never blocks
    expect(bloomHold(bossAward('t4', 'var(--pig)', 9).tries)).toBeLessThanOrEqual(4000);
  });
});
