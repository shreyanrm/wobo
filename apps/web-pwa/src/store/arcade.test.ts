import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ARCADE_LEDGER_KEY,
  awardBonus,
  BONUS_XP,
  BONUS_XP_CHAPTER_CAP,
  BONUS_XP_DAILY_CAP,
  bonusLeftInChapter,
  bonusLeftToday,
  clearedBonus,
  readArcade,
  writeArcade,
} from './arcade';

/**
 * THE ARCADE'S MONEY (docs/LEVELS.md §1 and §4, docs/CONTENT-INTERACTION.md §7).
 *
 * Bonus XP is capped per chapter, capped per day, paid once per level, and — the load-bearing one
 * — it is NOT the XP that unlocks a level. A learner who plays all afternoon does not climb; a
 * learner who learns does. That is what keeps the arcade a reward rather than a shortcut past the
 * learning, and it is why this ledger is its own store instead of a reason on `store/progress`.
 */

/**
 * `bun test` runs without a DOM, and `store/scope.ts` reads `localStorage` when there is one. A
 * five-line in-memory Storage is the whole fixture: the ledger is written and read back through
 * the same seam the app uses, rather than through a stand-in that could disagree with it.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
});

const play = (chapter: string, level: string) => awardBonus(chapter, level);

describe('what one cleared bonus level pays', () => {
  it('pays fifteen, and says so', () => {
    expect(BONUS_XP).toBe(15);
    const first = play('ch-1', 'bonus-3-catch');
    expect(first).toEqual({ granted: 15, reason: 'paid' });
  });

  it('pays a level once, ever — a second clear of the same door earns nothing', () => {
    play('ch-1', 'bonus-3-catch');
    expect(play('ch-1', 'bonus-3-catch')).toEqual({ granted: 0, reason: 'already' });
    expect(clearedBonus('ch-1', 'bonus-3-catch')).toBe(true);
  });
});

describe('the caps', () => {
  it('stops at the chapter cap however many doors a chapter has', () => {
    expect(BONUS_XP_CHAPTER_CAP).toBe(45);
    for (const level of ['a', 'b', 'c']) expect(play('ch-1', level).granted).toBe(BONUS_XP);
    expect(bonusLeftInChapter('ch-1')).toBe(0);
    expect(play('ch-1', 'd')).toEqual({ granted: 0, reason: 'chapter-cap' });
  });

  it('stops at the daily cap even across chapters, and the day resets it', () => {
    expect(BONUS_XP_DAILY_CAP).toBe(60);
    for (const level of ['a', 'b', 'c']) play('ch-1', level);
    for (const level of ['a', 'b', 'c']) play('ch-2', level);
    expect(bonusLeftToday()).toBe(0);
    expect(play('ch-3', 'a')).toEqual({ granted: 0, reason: 'daily-cap' });

    // tomorrow: the day's count resets, and the levels already cleared still pay nothing
    const ledger = readArcade();
    writeArcade({ ...ledger, day: '2000-01-01' });
    expect(bonusLeftToday()).toBe(BONUS_XP_DAILY_CAP);
    expect(play('ch-1', 'a')).toEqual({ granted: 0, reason: 'already' });
    expect(play('ch-3', 'a').granted).toBe(BONUS_XP);
  });

  it('never pays past a cap by paying a part of an award', () => {
    // four chapters at three each would be 180; the day stops it at 60, on a level boundary
    for (const chapter of ['a', 'b', 'c', 'd']) {
      for (const level of ['1', '2', '3']) play(chapter, level);
    }
    expect(readArcade().earnedToday).toBe(BONUS_XP_DAILY_CAP);
    expect(readArcade().earnedToday % BONUS_XP).toBe(0);
  });
});

describe('the law that keeps it a reward', () => {
  it('keeps the arcade’s own total apart from the climb’s', () => {
    play('ch-1', 'a');
    play('ch-1', 'b');
    const ledger = readArcade();
    expect(ledger.total).toBe(30);
    // nothing in this store is the learner state the level curve reads
    expect(localStorage.getItem('wobo-progress-v1')).toBeNull();
  });

  it('is not wired to the XP that unlocks a level, and the source proves it', async () => {
    const source = await Bun.file(new URL('./arcade.ts', import.meta.url).pathname).text();
    for (const forbidden of ['useProgress', 'XP_AWARDS', 'completeTopic', "from './progress'"]) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it('survives a storage that refuses to be read', () => {
    localStorage.setItem(ARCADE_LEDGER_KEY, 'not json');
    expect(readArcade().total).toBe(0);
    expect(play('ch-1', 'a').granted).toBe(BONUS_XP);
  });
});
