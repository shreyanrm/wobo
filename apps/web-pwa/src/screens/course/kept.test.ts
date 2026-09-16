/**
 * The lesson kept on the device (screens/course/kept.ts), held to the three rules its header
 * states: one learner's, only what was real, and never a promise.
 *
 * The storage stand-in is installed BEFORE `scope.ts` is imported, the way `store/isolation.test.ts`
 * does it, because the module reads the browser's storage the moment it is evaluated.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { GenCourse } from './Composing';

class FakeStorage {
  readonly map = new Map<string, string>();
  /**
   * What this device will hold in total, in characters. Unlimited unless a test says otherwise,
   * and a write past it throws exactly as a real browser does when the origin is full — which is
   * the only way to reach the quota path that used to raise the learner's save-trouble strip.
   */
  limit = Number.POSITIVE_INFINITY;
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
    const value = String(v);
    let total = value.length;
    for (const [key, held] of this.map) if (key !== k) total += held.length;
    if (total > this.limit) {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, value);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  /** Everything on the device right now, in characters. */
  get bytes(): number {
    let total = 0;
    for (const v of this.map.values()) total += v.length;
    return total;
  }
  /** Only this store's rows, which is what the shelf's budget is about. */
  lessonBytes(prefix: string): number {
    let total = 0;
    for (const [k, v] of this.map) if (k.startsWith(prefix)) total += v.length;
    return total;
  }
}

const local = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = local;

const { applyScope, deviceRefusingWrites, scoped, SCOPED_PREFIXES } = await import(
  '../../store/scope'
);
const {
  hasKeptLesson,
  keepArtifact,
  keepFilm,
  keepLesson,
  keptArtifact,
  keptFilm,
  keptLesson,
  KEPT_LESSON_PREFIX,
  MAX_LESSONS,
  MAX_RECORD_BYTES,
  MAX_STORE_BYTES,
} = await import('./kept');

/** A film small enough to keep: drawn scenes, no narration track. */
const silentFilm = (id: string) =>
  ({
    id,
    title: 'the film',
    steps: [{ id: 's1', visual: { kind: 'svg', src: '<svg/>' } }],
  }) as never;

/** A composed course, the shape `parseGenCourse` hands back. */
function course(id: string, overrides: Partial<GenCourse> = {}): GenCourse {
  return {
    courseId: id,
    title: 'Solving equations on one side',
    seeded: false,
    cards: [
      {
        id: 'c1',
        kind: 'text',
        title: 'Meet the balance',
        idea: 'Both sides of an equation weigh the same.',
        interaction: { kind: 'tap', prompt: 'Tap the part that looks unknown.' },
        reveal: 'Whatever you do to one side, you do to the other.',
      },
    ],
    workbook: [{ id: 'w1', type: 'fill', prompt: 'x + 1 = 3', answer: '2' }],
    boss: [{ id: 'b1', type: 'fill', prompt: 'x + 2 = 5', answer: '3' }],
    ...overrides,
  } as GenCourse;
}

beforeEach(() => {
  local.clear();
  local.limit = Number.POSITIVE_INFINITY;
  applyScope(null);
  // The refusal level is module state in `scope.ts` and outlives a test. One write that lands
  // clears it, so each test below starts from a device that is behaving.
  scoped.setItem('wobo-archive-v1', 'x');
  scoped.removeItem('wobo-archive-v1');
});

describe('a lesson already opened is on the device', () => {
  it('gives back the course it was handed', () => {
    expect(keepLesson('t1', course('a'))).toBe(true);
    expect(keptLesson('t1')?.courseId).toBe('a');
    expect(hasKeptLesson('t1')).toBe(true);
  });

  it('has nothing for a topic nobody opened, and says so rather than inventing one', () => {
    expect(keptLesson('never-opened')).toBeNull();
    expect(hasKeptLesson('never-opened')).toBe(false);
  });

  /** Rule two: the floor the player draws when the engine refused is not this topic's lesson. */
  it('refuses the seeded floor, so a placeholder can never become the lesson', () => {
    expect(keepLesson('t1', course('a', { seeded: true }))).toBe(false);
    expect(keptLesson('t1')).toBeNull();
  });

  it('refuses a course with no cards', () => {
    expect(keepLesson('t1', course('a', { cards: [] }))).toBe(false);
    expect(keptLesson('t1')).toBeNull();
  });
});

describe('it is one learner’s, and it leaves with them', () => {
  it('never shows one learner the lesson another learner paid for', () => {
    applyScope('learner-a');
    keepLesson('t1', course('a'));
    expect(keptLesson('t1')?.courseId).toBe('a');

    applyScope('learner-b');
    expect(keptLesson('t1')).toBeNull();
    expect(hasKeptLesson('t1')).toBe(false);

    applyScope('learner-a');
    expect(keptLesson('t1')?.courseId).toBe('a');
  });

  it('is on SCOPED_PREFIXES, so signing out sweeps every lesson with it', () => {
    expect(SCOPED_PREFIXES as readonly string[]).toContain(KEPT_LESSON_PREFIX);
  });
});

describe('a cache, never a filing cabinet', () => {
  it('keeps the newest lessons and lets the oldest go', () => {
    for (let i = 0; i < MAX_LESSONS + 3; i++) keepLesson(`t${i}`, course(`c${i}`));
    expect(keptLesson('t0')).toBeNull();
    expect(keptLesson('t2')).toBeNull();
    expect(keptLesson(`t${MAX_LESSONS + 2}`)?.courseId).toBe(`c${MAX_LESSONS + 2}`);
  });

  /** A raster card's base64 picture is bigger than a lesson's whole budget: it is not kept. */
  it('refuses a record over the ceiling instead of filling the phone', () => {
    const huge = course('a', {
      cards: [
        {
          id: 'c1',
          kind: 'diagram',
          title: 'A photograph of a cell',
          idea: 'x'.repeat(MAX_RECORD_BYTES + 1),
          interaction: { kind: 'tap', prompt: 'Tap the nucleus.' },
          reveal: 'The nucleus holds the instructions.',
        },
      ],
    } as Partial<GenCourse>);
    expect(keepLesson('t1', huge)).toBe(false);
    expect(keptLesson('t1')).toBeNull();
  });
});

describe('the pictures a card hydrated stay beside it', () => {
  it('keeps an artifact for the course it was made for', () => {
    keepLesson('t1', course('a'));
    expect(keepArtifact('t1', 'a', 'c1', { kind: 'diagram', svg: '<svg/>' })).toBe(true);
    expect(keptArtifact('t1', 'a', 'c1')).toEqual({ kind: 'diagram', svg: '<svg/>' });
  });

  it('never hands a course the picture drawn for a different one', () => {
    keepLesson('t1', course('a'));
    keepArtifact('t1', 'a', 'c1', { kind: 'diagram', svg: '<svg/>' });
    expect(keepArtifact('t1', 'b', 'c1', { kind: 'diagram', svg: '<svg/>' })).toBe(false);
    expect(keptArtifact('t1', 'b', 'c1')).toBeNull();
  });

  it('keeps the course’s film when it fits, and never gives it to another course', () => {
    keepLesson('t1', course('a'));
    expect(keepFilm('a', silentFilm('f1'))).toBe(true);
    expect(keptFilm('a')).not.toBeNull();
    expect(keptFilm('b')).toBeNull();
  });

  /** A film with its narration inline is bigger than a lesson's budget: refused, never half kept. */
  it('refuses a film over the ceiling and leaves the lesson itself intact', () => {
    keepLesson('t1', course('a'));
    const loud = { id: 'f1', title: 'the film', audio: 'x'.repeat(MAX_RECORD_BYTES + 1) } as never;
    expect(keepFilm('a', loud)).toBe(false);
    expect(keptFilm('a')).toBeNull();
    expect(keptLesson('t1')?.courseId).toBe('a');
  });

  it('keeps the pictures when the same course is kept again, and drops them when it changed', () => {
    keepLesson('t1', course('a'));
    keepArtifact('t1', 'a', 'c1', { kind: 'diagram', svg: '<svg/>' });
    keepLesson('t1', course('a'));
    expect(keptArtifact('t1', 'a', 'c1')).not.toBeNull();
    keepLesson('t1', course('b'));
    expect(keptArtifact('t1', 'b', 'c1')).toBeNull();
  });
});

/**
 * A LESSON CACHE IS NOT THE LEARNER'S WORK, AND MUST NEVER BE REPORTED AS IT.
 *
 * `scoped.setItem` records a refused write through `noteWrite(false)`, which raises the level
 * `SaveTrouble.tsx` reads and puts a sentence in front of a child saying this device is not letting
 * their work be kept and this piece may not be waiting next time. True of a board they drew. False
 * of a lesson whose miss costs the ordinary compose, and the exact false alarm that strip exists to
 * prevent, told the other way round.
 */
describe('a cache that cannot find room never tells a child their work is at risk', () => {
  it('raises no save-trouble notice when a lesson will not fit on the device', () => {
    local.limit = 200; // room for almost nothing, so every write here is refused
    expect(keepLesson('t1', course('a'))).toBe(false);
    expect(deviceRefusingWrites()).toBe(false);
  });

  it('raises none while filling the shelf to its budget either', () => {
    local.limit = 2500;
    for (let i = 0; i < 8; i += 1) keepLesson(`t${i}`, course(`c${i}`));
    expect(deviceRefusingWrites()).toBe(false);
  });

  /** The mechanism is untouched: a real save on a full device still says so. */
  it('still lets the learner’s own work raise it, so the strip is not quietly disabled', () => {
    local.limit = 10;
    expect(scoped.setItem('wobo-archive-v1', 'x'.repeat(50))).toBe(false);
    expect(deviceRefusingWrites()).toBe(true);
  });
});

describe('the shelf lives inside a budget, and inside whatever room the phone actually has', () => {
  /**
   * The per-row ceiling alone permitted 8 x 400 kB = 3.2 MB of a roughly 5 MB origin. Measured:
   * a composed lesson is 518 characters before any card has hydrated and 40,576 once a single
   * diagram has, so the shelf climbs toward its ceiling as the learner works. The cap is the shelf.
   */
  it('never lets every lesson together outgrow the share of the device it is allowed', () => {
    const fat = (id: string) =>
      course(id, {
        cards: [
          {
            id: 'c1',
            kind: 'text',
            title: 'A long one',
            idea: 'x'.repeat(200_000),
            interaction: { kind: 'tap', prompt: 'Tap it.' },
            reveal: 'There.',
          },
        ],
      } as Partial<GenCourse>);
    for (let i = 0; i < MAX_LESSONS; i += 1) keepLesson(`t${i}`, fat(`c${i}`));
    expect(local.lessonBytes(KEPT_LESSON_PREFIX)).toBeLessThanOrEqual(MAX_STORE_BYTES);
    // and the lesson the learner just opened is the one that survived
    expect(keptLesson(`t${MAX_LESSONS - 1}`)?.courseId).toBe(`c${MAX_LESSONS - 1}`);
  });

  /** A cache that stops at the first refusal is not a cache: the oldest yields and it tries again. */
  it('gives up the oldest lesson when the device is full rather than failing shut', () => {
    local.limit = 2500; // a few lessons' worth, measured at 518 characters each
    for (let i = 0; i < 8; i += 1) keepLesson(`t${i}`, course(`c${i}`));
    expect(keptLesson('t7')?.courseId).toBe('c7');
    expect(keptLesson('t0')).toBeNull();
    expect(local.lessonBytes(KEPT_LESSON_PREFIX)).toBeLessThanOrEqual(2500);
  });

  it('refuses a single row bigger than the whole shelf without emptying the shelf for it', () => {
    keepLesson('t1', course('a'));
    const enormous = course('b', {
      cards: [
        {
          id: 'c1',
          kind: 'text',
          title: 'Bigger than the budget',
          idea: 'x'.repeat(MAX_RECORD_BYTES + 1),
          interaction: { kind: 'tap', prompt: 'Tap it.' },
          reveal: 'There.',
        },
      ],
    } as Partial<GenCourse>);
    expect(keepLesson('t2', enormous)).toBe(false);
    expect(keptLesson('t1')?.courseId).toBe('a'); // the lesson already there is untouched
  });
});

/**
 * WHAT KEEPING FREEZES. `Composing.tsx` reads a kept lesson BEFORE it calls `engine.compose`, with
 * a network or without one, which is what saves the second compose on every opening of a course the
 * download queue already paid for. The cost is that the topic's content is frozen at the kept
 * composition until the shelf evicts it, and that a kept opening records no
 * `create.course.compiled.v1` because nothing was compiled and no allowance was spent.
 *
 * That is a content decision for the owner, not one to take quietly inside a cache. It is pinned
 * here so it cannot be changed by accident or lost, and so the day it is decided, this test is the
 * thing that fails and says where.
 */
describe('a kept lesson is preferred to a fresh compose, and that is a decision, not an accident', () => {
  it('serves a kept lesson however old it is: nothing here expires on its own', () => {
    keepLesson('t1', course('a'));
    const key = `${KEPT_LESSON_PREFIX}t1`; // unscoped in this test, so the plain key is the row
    const row = JSON.parse(local.getItem(key) as string) as { at: number };
    row.at = Date.now() - 365 * 24 * 60 * 60 * 1000;
    local.setItem(key, JSON.stringify(row));
    expect(keptLesson('t1')?.courseId).toBe('a');
    expect(hasKeptLesson('t1')).toBe(true);
  });

  it('lets go of a frozen lesson only by eviction, which is the one bound on how stale it gets', () => {
    for (let i = 0; i < MAX_LESSONS + 1; i += 1) keepLesson(`t${i}`, course(`c${i}`));
    expect(keptLesson('t0')).toBeNull();
  });
});
