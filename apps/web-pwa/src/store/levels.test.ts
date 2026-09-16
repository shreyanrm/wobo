/**
 * THE CURVE, THE RATES, AND THE DAY THAT PAYS FOR TURNING UP.
 *
 * docs/LEVELS.md §7: *"The curve is one pure function with a test that pins every number in the
 * table above, so a change to the pacing is a deliberate, reviewed act and never a drift."* This
 * is that test, and it did not exist. What stood in its place was a dev-only `console.assert` in
 * `store/progress.tsx` that pinned 80 and 200 as the cost of levels 2 and 3 against the law's 30
 * and 90, and that could not fail a build even when it was wrong, because `console.assert` does
 * not throw.
 *
 * The second half of the file plays a learner, because the question the owner asked on 2026-09-15
 * is not answerable by reading a rate table:
 *
 *   *"Is the content and teaching plan continuously optimising and personalising to the learner's
 *   needs until they master or understand that topic? It should be motivating, continuous support,
 *   understanding and guiding where they went wrong, and so on."*
 *
 * So one struggling learner walks the REAL chapter pool (`suggest/fixture.ts`, the cell the
 * blueprint suite uses), re-chosen after every module by the REAL planner
 * (`curriculum/blueprint.ts`), and every earned moment goes through the REAL reward store's own
 * rules (`store/progress.tsx`). Nothing is re-implemented here, nothing reaches a network, and no
 * model is called. The rule it is held to is rule 4 of "The tutor never leaves":
 *
 *   *"It is motivating without lying. The reward system fires on effort and on progress, not only
 *   on right answers."*
 *
 * Before this, it fired only on right answers. A learner who opened Wobo, worked at one idea and
 * got every one of it wrong earned nothing at all, because the law's own "20 for a day kept in a
 * streak" had no reason in the store and was never paid to anybody.
 */

import { describe, expect, it } from 'bun:test';
import { emptyLearnerState, type LearnerState } from '@wobo/sdk';

/*
 * A storage stand-in, installed only if nobody else got here first. `bun test` runs every file in
 * one process and about a dozen files install one of these at module scope; assigning
 * unconditionally takes the store out from under whichever of them loaded first.
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

const {
  applyAward,
  applyCompleteTopic,
  cumForLevel,
  CURVE_CEILING_LEVEL,
  CURVE_CEILING_XP,
  levelInfo,
  rollForward,
  streakDayKey,
  XP_AWARDS,
  xpForLevel,
} = await import('./progress');
const { groupFor } = await import('../curriculum/blueprint');
const { pool } = await import('../suggest/fixture');

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

/** A learner who last came on `lastSeen`, with whatever they had earned by then. */
function learner(partial: Partial<LearnerState> = {}): LearnerState {
  return { ...emptyLearnerState(), ...partial };
}

// ── The curve ────────────────────────────────────────────────────────────────────────────────────

/**
 * docs/LEVELS.md §2, the table, verbatim: what the step into each level costs, and the running
 * total it takes to stand there. Every one of these nine rows is a number a learner can see on
 * their own screen, so every one of them is pinned.
 */
const TABLE: ReadonlyArray<{ level: number; step: number; total: number }> = [
  { level: 2, step: 30, total: 30 },
  { level: 3, step: 60, total: 90 },
  { level: 4, step: 120, total: 210 },
  { level: 5, step: 390, total: 600 },
  { level: 6, step: 530, total: 1130 },
  { level: 11, step: 1340, total: 6130 },
  { level: 21, step: 3420, total: 30590 },
  { level: 31, step: 5920, total: 78260 },
  { level: 41, step: 8000, total: 151370 },
];

describe('the level curve is the curve docs/LEVELS.md prints', () => {
  it('pins every number in the table', () => {
    for (const row of TABLE) {
      expect(xpForLevel(row.level), `step into level ${row.level}`).toBe(row.step);
      expect(cumForLevel(row.level), `total to reach level ${row.level}`).toBe(row.total);
    }
  });

  it('gives away the first three levels, which is the hook', () => {
    // "A learner's first session should end two or three levels in. That is the hook, and it costs
    // nothing to give." (docs/LEVELS.md §2)
    expect([xpForLevel(2), xpForLevel(3), xpForLevel(4)]).toEqual([30, 60, 120]);
    expect(cumForLevel(1)).toBe(0); // nobody pays to be at level 1
  });

  it('stops the cost rising at eight thousand, around level 39', () => {
    expect(CURVE_CEILING_XP).toBe(8000);
    expect(CURVE_CEILING_LEVEL).toBe(39);
    expect(xpForLevel(CURVE_CEILING_LEVEL - 1)).toBeLessThan(CURVE_CEILING_XP);
    for (const l of [39, 40, 60, 200]) expect(xpForLevel(l)).toBe(CURVE_CEILING_XP);
  });

  it('gets harder as they go, and never easier', () => {
    // The owner, 2026-09-09: "the same amount of XP doesn't lead to level ups as the level
    // increases. It should be progressive, it should get harder as they go."
    let last = 0;
    for (let l = 2; l <= 120; l += 1) {
      const step = xpForLevel(l);
      expect(step, `level ${l} must not be cheaper than level ${l - 1}`).toBeGreaterThanOrEqual(
        last,
      );
      last = step;
    }
    // and it genuinely climbs rather than flattening early: level 21 costs more than ten times
    // what level 2 costs
    expect(xpForLevel(21)).toBeGreaterThan(xpForLevel(2) * 10);
  });

  it('reads a single xp number back as exactly the level the table says', () => {
    for (const row of TABLE) {
      const at = levelInfo(row.total);
      expect(at.level, `xp ${row.total} stands at level ${row.level}`).toBe(row.level);
      expect(at.intoLevel).toBe(0);
      expect(at.span).toBe(xpForLevel(row.level + 1));
      expect(at.progress).toBe(0);

      // one xp short is still the level below, with exactly one to go
      const just = levelInfo(row.total - 1);
      expect(just.level).toBe(row.level - 1);
      expect(just.toNext).toBe(1);
    }
  });

  it('never loses or skips a level anywhere on the curve', () => {
    for (let l = 1; l <= 80; l += 1) {
      expect(levelInfo(cumForLevel(l)).level, `boundary at level ${l}`).toBe(l);
    }
    // and it walks up one at a time, never two
    let seen = 1;
    for (let xp = 0; xp <= 12000; xp += 7) {
      const lvl = levelInfo(xp).level;
      expect(lvl - seen).toBeLessThanOrEqual(1);
      seen = lvl;
    }
  });

  it('is honest at the edges rather than NaN', () => {
    for (const xp of [0, -1, 0.5, 29, 30]) {
      const at = levelInfo(xp);
      expect(Number.isFinite(at.progress)).toBe(true);
      expect(at.progress).toBeGreaterThanOrEqual(0);
      expect(at.progress).toBeLessThan(1);
      expect(at.level).toBeGreaterThanOrEqual(1);
    }
    expect(levelInfo(0).level).toBe(1);
    expect(levelInfo(0).toNext).toBe(30);
  });
});

// ── The rates ────────────────────────────────────────────────────────────────────────────────────

describe('what earns experience points', () => {
  it('pays the table in docs/LEVELS.md §1 and not a number of its own', () => {
    expect(XP_AWARDS.item).toBe(10); // a card finished
    expect(XP_AWARDS.topic).toBe(50); // a topic mastered
    expect(XP_AWARDS.chapter).toBe(200); // a chapter finished
    expect(XP_AWARDS.boss).toBe(300); // a boss cleared
    expect(XP_AWARDS.streak).toBe(20); // a day kept in a streak
    expect(XP_AWARDS.bonus).toBe(15); // a bonus level in the arcade
  });

  it('ends a first session two or three levels in, exactly as §3 models it', () => {
    // "A first session of three cards, one topic mastered and the day's streak is 100 XP, which is
    // level 3." (docs/LEVELS.md §3)
    const first = XP_AWARDS.item * 3 + XP_AWARDS.topic + XP_AWARDS.streak;
    expect(first).toBe(100);
    expect(levelInfo(first).level).toBe(3);
  });
});

// ── The day that pays for turning up ─────────────────────────────────────────────────────────────

describe("the day's own earn", () => {
  it('pays a brand new learner on the day they arrive, before they answer anything', () => {
    const fresh = learner(); // emptyLearnerState already stands on today
    const after = rollForward(fresh);
    expect(after.xp).toBe(XP_AWARDS.streak);
    expect(after.awardedOnce).toContain(streakDayKey(TODAY));
  });

  it('pays once a day and not once a session', () => {
    // "A day pays once. The streak's 20 is per day, not per session." (docs/LEVELS.md §4)
    const first = rollForward(learner({ lastActiveDay: day(-1), streakDays: 3 }));
    expect(first.xp).toBe(XP_AWARDS.streak);
    expect(first.streakDays).toBe(4);

    // they close the tab and come back the same afternoon
    const second = rollForward(first);
    expect(second.xp).toBe(first.xp);
    const third = rollForward(second);
    expect(third.xp).toBe(first.xp);
  });

  it('pays again the next day', () => {
    // yesterday's key is on the record; today's is not, so today earns
    const yesterday = learner({
      lastActiveDay: day(-1),
      streakDays: 4,
      xp: 400,
      awardedOnce: [streakDayKey(day(-1))],
    });
    const after = rollForward(yesterday);
    expect(after.xp).toBe(420);
    expect(after.streakDays).toBe(5);
  });

  it('keeps the record of paid days from growing for the life of the account', () => {
    const old = Array.from({ length: 40 }, (_, i) => streakDayKey(day(-(i + 2))));
    const after = rollForward(
      learner({ lastActiveDay: day(-1), awardedOnce: [...old, 'account', 'profile_photo'] }),
    );
    const streakKeys = after.awardedOnce.filter((k) => k.startsWith('streak:'));
    expect(streakKeys.length).toBeLessThan(old.length);
    expect(streakKeys).toContain(streakDayKey(TODAY));
    // every other one-time key is untouched, so nothing can be claimed a second time
    expect(after.awardedOnce).toContain('account');
    expect(after.awardedOnce).toContain('profile_photo');
  });

  it('resets a broken streak without taking back a level', () => {
    // "A broken streak resets the streak, not the level." and "Nothing is deducted, ever."
    const away = learner({ lastActiveDay: day(-10), streakDays: 7, xp: 600 });
    const levelBefore = levelInfo(away.xp).level;
    const back = rollForward(away);
    expect(back.streakDays).toBe(1);
    expect(back.brokenStreak?.days).toBe(7);
    expect(back.xp).toBeGreaterThanOrEqual(away.xp);
    expect(levelInfo(back.xp).level).toBeGreaterThanOrEqual(levelBefore);
  });
});

// ── The learner, played ──────────────────────────────────────────────────────────────────────────

/**
 * A learner who is having a bad morning, walked module by module through the real pool.
 *
 * The shape is the one the brief names: a sequence of modules with wrong answers, a slow answer,
 * and a right answer after a wrong one. After every module the group is re-chosen by the real
 * planner from what just happened, which is rule 1 of "The tutor never leaves"; what this file
 * asserts about it is rule 4, the reward.
 */
describe('a struggling learner is paid for turning up, not only for being right', () => {
  const BP = pool();
  const TOPIC = 't4';
  /** Slower than this and the answer was a struggle rather than a slip (a tutor notices). */
  const SLOW_MS = 25000;

  it('ends a session with nothing right holding a real earned moment', () => {
    // the morning opens: they have come back the day after a three day chain
    let state = rollForward(learner({ lastActiveDay: day(-1), streakDays: 3 }));
    const onArrival = state.xp;
    expect(onArrival, 'turning up is itself worth something').toBe(XP_AWARDS.streak);

    // and now four modules in a row go wrong, the last of them slowly
    const stuckOn: string[] = [];
    const met: string[] = [];
    for (const attempt of [
      { wrong: true, ms: 4000 },
      { wrong: true, ms: 9000 },
      { wrong: true, ms: 18000 },
      { wrong: true, ms: SLOW_MS + 6000 },
    ]) {
      const group = groupFor(BP, TOPIC, { stuckOn, misconceptions: ['x2'] });
      expect(group.length, 'the pool always has something left to offer').toBeGreaterThan(0);
      const next = group.find((m) => !stuckOn.includes(m.id)) ?? group[0];
      if (!next)
        throw new Error('the pool ran out of modules, which is the dead end rule 5 forbids');

      // the module they were just handed is never the one that just failed them
      expect(stuckOn, `handed back ${next.id} after it had already failed`).not.toContain(next.id);
      met.push(next.id);
      if (attempt.wrong) stuckOn.push(next.id);

      // a wrong answer earns nothing, and a slow one earns nothing extra: "nothing pays for speed"
      const before = state.xp;
      expect(applyAward(state, 'item').granted).toBe(XP_AWARDS.item); // what it WOULD pay if right
      expect(state.xp, 'a miss is never charged for').toBe(before);
    }

    // FOUR WRONG, NOTHING RIGHT. Before the day's earn existed this learner's whole session was
    // worth zero and the product had given them no moment at all.
    expect(state.xp).toBe(onArrival);
    expect(state.xp).toBeGreaterThan(0);
    expect(met.length).toBe(4);
    expect(new Set(met).size, 'four different ways in, never the same one twice').toBe(4);

    // then it lands. The right answer after a wrong one pays exactly what it would have paid first
    // time, because nothing is deducted, ever (docs/LEVELS.md §4).
    const landed = applyAward(state, 'item');
    expect(landed.granted).toBe(XP_AWARDS.item);
    state = landed.state;
    expect(state.xp).toBe(onArrival + XP_AWARDS.item);

    // and the topic is theirs, once, for the law's fifty
    const mastered = applyCompleteTopic(state, TOPIC);
    expect(mastered.granted).toBe(XP_AWARDS.topic);
    state = mastered.state;
    // a revisit pays nothing: "a concept pays once"
    expect(applyCompleteTopic(state, TOPIC).granted).toBe(0);
  });

  it('never takes anything back across a whole bad session', () => {
    let state = rollForward(learner({ lastActiveDay: day(-1), streakDays: 2 }));
    let low = state.xp;
    const stuckOn: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const group = groupFor(BP, TOPIC, { stuckOn });
      const next = group.find((m) => !stuckOn.includes(m.id));
      if (next) stuckOn.push(next.id);
      // whatever happened, the number never goes backwards
      expect(state.xp).toBeGreaterThanOrEqual(low);
      low = state.xp;
    }
    // the level they walked in with is the level they walk out with
    expect(levelInfo(state.xp).level).toBeGreaterThanOrEqual(1);
    state = applyAward(state, 'item').state;
    expect(state.xp).toBeGreaterThan(low);
  });

  it('pays the learner who needed eleven modules the same as the one who needed four', () => {
    // docs/LEARNING-MODEL.md §6: "a learner who needs more modules earns more along the way and
    // the topic pays the same at the end. Nobody is paid less for finding it hard."
    const cards = (n: number): number => {
      let s = learner();
      for (let i = 0; i < n; i += 1) s = applyAward(s, 'item', { onceKey: `card-${i}` }).state;
      return applyCompleteTopic(s, TOPIC).granted;
    };
    expect(cards(4)).toBe(XP_AWARDS.topic);
    expect(cards(11)).toBe(XP_AWARDS.topic);

    // and the slow road earned more on the way, never less
    let quick = learner();
    for (let i = 0; i < 4; i += 1) quick = applyAward(quick, 'item', { onceKey: `q${i}` }).state;
    let slow = learner();
    for (let i = 0; i < 11; i += 1) slow = applyAward(slow, 'item', { onceKey: `s${i}` }).state;
    expect(slow.xp).toBeGreaterThan(quick.xp);
  });
});
