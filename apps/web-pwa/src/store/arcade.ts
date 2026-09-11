'use client';

/**
 * THE ARCADE'S LEDGER — what a bonus level pays, and everything that stops it being farmed.
 *
 * docs/CONTENT-INTERACTION.md §7: *"bonus XP is capped per day and separate from the XP that
 * unlocks levels; a reward, never a shortcut past the learning."* docs/LEVELS.md §1 puts the
 * number at fifteen and §4 puts the cap on the chapter.
 *
 * THE REASON THIS IS ITS OWN STORE. `store/progress.tsx` holds one `xp` number and `levelInfo`
 * reads it, so any award routed through it climbs the curve. An afternoon in the arcade would then
 * be worth more than an afternoon learning, which is the exact thing the owner's law forbids. So
 * the arcade keeps its own number, in its own key, and nothing here can reach the climb. The test
 * beside this file reads the source and fails if it ever does.
 *
 * Three gates, in the order they are asked:
 *   1. **once, ever** — a door pays the first time it is cleared and never again, however often a
 *      learner comes back to play it (they may; it is theirs, it just does not pay twice).
 *   2. **the chapter cap** — forty five, so a learner cannot skip the learning and play.
 *   3. **the daily cap** — sixty, across every chapter, so a long day is still a day of learning.
 *
 * Nothing is ever deducted (docs/LEVELS.md §4). A cap is a ceiling, never a penalty, and hitting
 * one is said plainly rather than dressed up as a failure.
 */

import { scoped } from './scope';

/** What one cleared bonus level pays. */
export const BONUS_XP = 15;
/** The most the arcade pays inside one chapter. */
export const BONUS_XP_CHAPTER_CAP = 45;
/** The most it pays in one day, across every chapter. */
export const BONUS_XP_DAILY_CAP = 60;

export const ARCADE_LEDGER_KEY = 'wobo-arcade-v1';

export interface ArcadeLedger {
  /** The day the count below belongs to (YYYY-MM-DD). A new day starts the count again. */
  day: string;
  /** Bonus XP earned today, across every chapter. */
  earnedToday: number;
  /** Bonus XP earned in each chapter, for the life of the account. */
  perChapter: Record<string, number>;
  /** The doors already cleared, as `chapter:level`. A door on this list never pays again. */
  cleared: string[];
  /** The arcade's own running number. It is shown beside the climb's, never inside it. */
  total: number;
  /**
   * The doors this learner has actually been offered, newest last. It exists so the day's quest on
   * the home thread can point at a bonus level that IS open rather than at a game we hope exists.
   * Nothing here is a claim about the syllabus: a door lands on this list only when a real course
   * carried a real spec and the learner was shown it.
   */
  doors: OpenDoor[];
}

export interface OpenDoor {
  chapterId: string;
  topicId: string;
  levelId: string;
  title: string;
  /**
   * The level itself, exactly as it was served. It is kept UNPARSED on purpose: this store must not
   * reach the engines (it would drag the whole arcade into every chunk that reads the ledger), and
   * a blob that has been sitting in a learner's storage is untrusted anyway. Whoever plays it runs
   * it back through `parseArcade`, which refuses anything the six mechanics cannot render.
   */
  spec: unknown;
}

/** How many doors are remembered. Enough for the day's quest to have something true to point at. */
const DOORS_KEPT = 8;

export type BonusOutcome = {
  granted: number;
  reason: 'paid' | 'already' | 'chapter-cap' | 'daily-cap';
};

const today = (): string => new Date().toISOString().slice(0, 10);

const EMPTY: ArcadeLedger = {
  day: today(),
  earnedToday: 0,
  perChapter: {},
  cleared: [],
  total: 0,
  doors: [],
};

const nonNegative = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

/** The ledger, or an empty one. Unreadable storage is an empty ledger, never a half-built one. */
export function readArcade(): ArcadeLedger {
  try {
    const raw = scoped.getItem(ARCADE_LEDGER_KEY);
    if (!raw) return { ...EMPTY, day: today() };
    const p = JSON.parse(raw) as Partial<ArcadeLedger>;
    const perChapter: Record<string, number> = {};
    if (p.perChapter && typeof p.perChapter === 'object') {
      for (const [id, value] of Object.entries(p.perChapter)) perChapter[id] = nonNegative(value);
    }
    return {
      day: typeof p.day === 'string' ? p.day : today(),
      earnedToday: nonNegative(p.earnedToday),
      perChapter,
      cleared: Array.isArray(p.cleared) ? p.cleared.filter((s) => typeof s === 'string') : [],
      total: nonNegative(p.total),
      doors: Array.isArray(p.doors)
        ? p.doors
            .filter(
              (d): d is OpenDoor =>
                !!d &&
                typeof d === 'object' &&
                typeof (d as OpenDoor).chapterId === 'string' &&
                typeof (d as OpenDoor).topicId === 'string' &&
                typeof (d as OpenDoor).levelId === 'string' &&
                (d as OpenDoor).spec !== undefined,
            )
            .slice(-DOORS_KEPT)
        : [],
    };
  } catch {
    return { ...EMPTY, day: today() };
  }
}

export function writeArcade(ledger: ArcadeLedger): void {
  try {
    scoped.setItem(ARCADE_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // the play still counted for this session; a full disk never costs a learner their game
  }
}

/** The day's count, rolled forward. Yesterday's number is not today's. */
function rolled(ledger: ArcadeLedger): ArcadeLedger {
  return ledger.day === today() ? ledger : { ...ledger, day: today(), earnedToday: 0 };
}

const keyOf = (chapterId: string, levelId: string) => `${chapterId}:${levelId}`;

/** Has this door already been cleared? A cleared door still opens; it just no longer pays. */
export function clearedBonus(chapterId: string, levelId: string, ledger = readArcade()): boolean {
  return ledger.cleared.includes(keyOf(chapterId, levelId));
}

export function bonusLeftToday(ledger = readArcade()): number {
  return Math.max(0, BONUS_XP_DAILY_CAP - rolled(ledger).earnedToday);
}

export function bonusLeftInChapter(chapterId: string, ledger = readArcade()): number {
  return Math.max(0, BONUS_XP_CHAPTER_CAP - (ledger.perChapter[chapterId] ?? 0));
}

/**
 * Clear a bonus level. Returns what was actually paid and why, so the surface can say the true
 * thing: "that one is already yours", or "the arcade is done paying today", never a silent zero.
 *
 * An award is paid whole or not at all. Paying a part of one to land exactly on a cap would put a
 * number on the screen that means nothing, and the cap is a ceiling rather than an accountant.
 */
export function awardBonus(chapterId: string, levelId: string): BonusOutcome {
  const ledger = rolled(readArcade());
  if (clearedBonus(chapterId, levelId, ledger)) return { granted: 0, reason: 'already' };
  if (bonusLeftInChapter(chapterId, ledger) < BONUS_XP)
    return { granted: 0, reason: 'chapter-cap' };
  if (bonusLeftToday(ledger) < BONUS_XP) return { granted: 0, reason: 'daily-cap' };
  writeArcade({
    ...ledger,
    earnedToday: ledger.earnedToday + BONUS_XP,
    perChapter: {
      ...ledger.perChapter,
      [chapterId]: (ledger.perChapter[chapterId] ?? 0) + BONUS_XP,
    },
    cleared: [...ledger.cleared, keyOf(chapterId, levelId)],
    total: ledger.total + BONUS_XP,
  });
  return { granted: BONUS_XP, reason: 'paid' };
}

/**
 * Remember that a door was offered. Called by the door itself, so the list can only ever hold
 * bonus levels a real course really carried.
 */
export function rememberDoor(door: OpenDoor): void {
  const ledger = readArcade();
  const key = keyOf(door.chapterId, door.levelId);
  const kept = ledger.doors.filter((d) => keyOf(d.chapterId, d.levelId) !== key);
  writeArcade({ ...ledger, doors: [...kept, door].slice(-DOORS_KEPT) });
}

/**
 * The doors still worth walking through: offered, not yet cleared, and the day still paying. An
 * empty list is the honest answer, and the surface that asked simply offers something else.
 */
export function openDoors(ledger = readArcade()): OpenDoor[] {
  if (bonusLeftToday(ledger) < BONUS_XP) return [];
  return ledger.doors.filter((d) => !clearedBonus(d.chapterId, d.levelId, ledger));
}

/**
 * What the surface says when a play paid nothing. Plainly, in the register: a cap is not a
 * telling-off, and a door already cleared is a thing the learner did rather than a thing they
 * cannot do.
 */
export const BONUS_LINES: Record<BonusOutcome['reason'], string> = {
  paid: `${BONUS_XP} bonus xp`,
  already: 'already yours. play it again any time, it just does not pay twice.',
  'chapter-cap': 'the arcade has paid all it pays in this chapter. the climb is where the rest is.',
  'daily-cap': 'that is the arcade done for today. it comes back tomorrow.',
};
