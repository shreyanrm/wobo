/**
 * The report's arithmetic, held to its sources.
 *
 * Every test here exists because the alternative is a number on a parent's screen that came from
 * nowhere. So each one pins a function to the evidence it is allowed to read, and — just as
 * importantly — pins the cases where it must refuse to answer: too little time passed to measure
 * retention, no pace to project from, a span with nothing in it.
 */

import { describe, expect, it } from 'bun:test';
import type { MasterySnapshot } from '@wobo/sdk';
import type { Chapter, Topic } from '../../data/model';
import type { DayLedger } from '../../store/mind';
import type { MasteryView } from '../learn/mastery';
import {
  chapterRows,
  comingUp,
  coversWholeSyllabus,
  heldLater,
  MIN_HELD_ANSWERS,
  minuteBars,
  needsAnotherPass,
  peakMinutes,
  projectFinish,
  reportNote,
  standings,
  syllabusReach,
  tally,
  totalMinutes,
} from './evidence';

const DAY = 86_400_000;

function topic(id: string, chapterId: string, prereqTopicIds: string[] = []): Topic {
  return {
    id,
    chapterId,
    name: `Topic ${id}`,
    blurb: '',
    prereqTopicIds,
    kind: 'syllabus',
    xp: 120,
  };
}

function chapter(id: string, subjectId: string, index: number, topics: Topic[]): Chapter {
  return { id, subjectId, index, name: `Chapter ${index}`, topics };
}

const MATHS = [
  chapter('c1', 'Mathematics', 1, [topic('t1', 'c1'), topic('t2', 'c1', ['t1'])]),
  chapter('c2', 'Mathematics', 2, [topic('t3', 'c2', ['t2']), topic('t4', 'c2')]),
];

const SYLLABUS = {
  subjects: [{ id: 'Mathematics', name: 'Mathematics' }],
  chaptersOf: () => MATHS,
};

function view(completed: string[], bands: Record<string, string> = {}): MasteryView {
  return {
    completed: new Set(completed),
    bandOf: (t) => (bands[t.id] ?? 'not_started') as ReturnType<MasteryView['bandOf']>,
  };
}

function ledger(seconds: number): DayLedger {
  return {
    answered: 0,
    wrong: 0,
    asked: 0,
    helped: 0,
    kept: 0,
    entered: 0,
    seconds,
    evening: false,
  };
}

const iso = (at: number) => new Date(at).toISOString().slice(0, 10);

describe('standings — where each topic stands', () => {
  it('keeps the syllabus order and names the subject and chapter of every topic', () => {
    const rows = standings(SYLLABUS, view([]));
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(rows[0]?.subjectName).toBe('Mathematics');
    expect(rows[2]?.chapterName).toBe('Chapter 2');
  });

  it('reads learnt, debt, started and untouched from the learn flow, never from its own rules', () => {
    const rows = standings(
      SYLLABUS,
      // t1 completed and secure: learnt. t2 completed but emerging: a debt.
      // t3 completed with no evidence at all: still learnt — silence is not a failing grade.
      view(['t1', 't2', 't3'], { t1: 'secure', t2: 'emerging' }),
      { t4: 0.4 },
    );
    const state = Object.fromEntries(rows.map((r) => [r.id, r.state]));
    expect(state).toEqual({ t1: 'learnt', t2: 'debt', t3: 'learnt', t4: 'started' });
  });

  it('an untouched topic is untouched, not a failure', () => {
    const rows = standings(SYLLABUS, view([]));
    expect(rows.every((r) => r.state === 'untouched')).toBe(true);
    expect(tally(rows)).toEqual({ total: 4, learnt: 0, debt: 0, started: 0, untouched: 4 });
  });

  it('a learner with no world yet gets an empty list, never a seeded board', () => {
    expect(standings({ subjects: [], chaptersOf: () => [] }, view([]))).toEqual([]);
  });
});

describe('the lists a parent reads', () => {
  const rows = standings(SYLLABUS, view(['t1', 't2'], { t1: 'independent', t2: 'emerging' }), {
    t3: 0.5,
  });

  it('what was learnt shows only chapters with something behind them', () => {
    const chapters = chapterRows(rows);
    expect(chapters.map((c) => c.id)).toEqual(['c1']);
    expect(chapters[0]).toMatchObject({ total: 2, learnt: 1, debt: 1 });
  });

  it('what needed another pass is exactly the debts', () => {
    expect(needsAnotherPass(rows).map((r) => r.id)).toEqual(['t2']);
  });

  it('what is coming is the next few not yet behind them, in the board order', () => {
    expect(comingUp(rows).map((r) => r.id)).toEqual(['t3', 't4']);
  });
});

describe('minutes a day', () => {
  const monday = Date.UTC(2026, 8, 7); // a Monday
  const wednesday = new Date(monday + 2 * DAY);
  const days: Record<string, DayLedger> = {
    [iso(monday)]: ledger(42 * 60),
    [iso(monday + DAY)]: ledger(90),
    [iso(monday + 2 * DAY)]: ledger(10 * 60),
  };

  it('draws one bar a day, Monday to Sunday, from seconds actually recorded', () => {
    const bars = minuteBars(days, 'week', wednesday);
    expect(bars).toHaveLength(7);
    expect(bars.map((b) => b.minutes)).toEqual([42, 2, 10, 0, 0, 0, 0]);
    expect(bars.map((b) => b.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  it('a day still to come is marked as such and never counted as a zero', () => {
    const bars = minuteBars(days, 'week', wednesday);
    expect(bars.slice(0, 3).every((b) => !b.future)).toBe(true);
    expect(bars.slice(3).every((b) => b.future)).toBe(true);
    expect(bars[5]?.full).toContain('still to come');
  });

  it('the peak and the total are the values the chart reaches, and ignore days still to come', () => {
    const bars = minuteBars(days, 'week', wednesday);
    expect(peakMinutes(bars)).toBe(42);
    expect(totalMinutes(bars)).toBe(54);
  });

  it('a year is drawn month by month, because a phone cannot read 365 bars', () => {
    const bars = minuteBars(days, 'year', wednesday);
    expect(bars).toHaveLength(12);
    expect(bars[8]?.minutes).toBe(54);
    expect(bars[8]?.full).toContain('September');
  });
});

describe('held a week later', () => {
  const now = Date.UTC(2026, 8, 30);
  const point = (at: number, correct: boolean) => ({
    event_id: `e-${at}-${correct}`,
    correct,
    independence: 1,
    at: new Date(at).toISOString(),
  });
  const snapshot = (evidence: ReturnType<typeof point>[]): MasterySnapshot =>
    ({ nodes: { n1: { band: 'secure', evidence } } }) as unknown as MasterySnapshot;

  it('ignores answers given inside the first week — that is accuracy, not retention', () => {
    const first = now - 40 * DAY;
    const read = heldLater(
      snapshot([
        point(first, true),
        point(first + DAY, true),
        point(first + 2 * DAY, true),
        point(first + 6 * DAY, true),
      ]),
      now,
    );
    expect(read.recent).toBeNull();
    expect(read.earlier).toBeNull();
  });

  it('counts answers a week or more after the first, and says what percentage held', () => {
    const first = now - 20 * DAY;
    const later = Array.from({ length: 5 }, (_, i) => point(first + 8 * DAY + i, i < 4));
    const read = heldLater(snapshot([point(first, true), ...later]), now);
    expect(read.recent).toEqual({ held: 4, total: 5, percent: 80 });
  });

  it('refuses to print a percentage from too little evidence', () => {
    const first = now - 20 * DAY;
    const thin = Array.from({ length: MIN_HELD_ANSWERS - 1 }, (_, i) =>
      point(first + 8 * DAY + i, true),
    );
    expect(heldLater(snapshot([point(first, true), ...thin]), now).recent).toBeNull();
  });

  it('splits at thirty days so the one comparison it makes is a real one', () => {
    const first = now - 200 * DAY;
    const old = Array.from({ length: 5 }, (_, i) => point(first + 8 * DAY + i, i < 3));
    const fresh = Array.from({ length: 5 }, (_, i) => point(now - 5 * DAY + i, true));
    const read = heldLater(snapshot([point(first, true), ...old, ...fresh]), now);
    expect(read.earlier).toEqual({ held: 3, total: 5, percent: 60 });
    expect(read.recent).toEqual({ held: 5, total: 5, percent: 100 });
  });

  it('an empty or missing snapshot says nothing rather than zero', () => {
    expect(heldLater(null, now)).toEqual({ recent: null, earlier: null });
    expect(heldLater({ nodes: {} } as MasterySnapshot, now)).toEqual({
      recent: null,
      earlier: null,
    });
  });
});

describe('the line to the finish', () => {
  const now = Date.UTC(2026, 8, 30);
  const days = Array.from({ length: 10 }, (_, i) => iso(now - (9 - i) * DAY));

  it('refuses to draw a line before there is a single topic behind them', () => {
    const p = projectFinish(0, 12, days, now);
    expect(p.kind).toBe('none');
    expect(p.at).toBeUndefined();
  });

  it('acknowledges real progress it cannot pace, instead of showing the empty line', () => {
    const p = projectFinish(3, 12, [], now);
    expect(p.kind).toBe('building');
    expect(p.line).toContain('3 of 12');
  });

  it('projects a date from the learner own pace, and names the total it reaches', () => {
    const p = projectFinish(4, 12, days, now);
    expect(p.kind).toBe('projected');
    expect(p.at).toBeGreaterThan(now);
    expect(p.line).toContain('all 12 topics');
    expect(p.line).toContain(p.dateLabel as string);
    expect(p.from).toBe(Date.parse(`${days[0]}T00:00:00Z`));
  });

  it('a faster pace lands earlier — the line moves when the learner does', () => {
    const slow = projectFinish(2, 40, days, now);
    const fast = projectFinish(8, 40, days, now);
    expect(fast.at as number).toBeLessThan(slow.at as number);
  });

  it('says so when the syllabus is finished, and projects nothing', () => {
    const p = projectFinish(12, 12, days, now);
    expect(p.kind).toBe('complete');
    expect(p.at).toBeUndefined();
  });

  /**
   * THE CADENCE FLOOR TURNED "NO PACE" INTO A PACE. `cadence = Math.max(1, recentActive)` exists so
   * a learner who came back yesterday is not divided by zero. Applied to a count of ZERO it also
   * gave a learner who had not opened the app in three months a solid line and the sentence "at
   * this pace, all N topics are behind you by around <date>". Their pace is nothing.
   */
  it('draws no line for a learner who has not been here this week', () => {
    const stale = Array.from({ length: 10 }, (_, i) => iso(now - (100 - i) * DAY));
    const p = projectFinish(4, 12, stale, now);
    expect(p.kind).toBe('building');
    expect(p.at).toBeUndefined();
    expect(p.dateLabel).toBeUndefined();
    expect(p.line).not.toContain('At this pace');
    expect(p.line).toContain('nothing this past week');
  });

  it('draws one again as soon as there is a day in the last week', () => {
    const back = [...Array.from({ length: 9 }, (_, i) => iso(now - (100 - i) * DAY)), iso(now)];
    const p = projectFinish(4, 12, back, now);
    expect(p.kind).toBe('projected');
    expect(p.at).toBeGreaterThan(now);
  });

  /**
   * THE DENOMINATOR IS THE CHAPTERS OPENED, NOT THE BOARD. `standings` can only count topics the
   * registry holds, and it holds a chapter's topics once that chapter has been opened. So "all 8
   * topics are behind you by around 21 Oct" was a finish date for a syllabus nobody has, and the
   * date moved out every time a new chapter was opened. `reach` is how a caller says so.
   */
  it('never says "all" of a total that is only the chapters opened so far', () => {
    const partial = projectFinish(4, 12, days, now, { chapters: 12, opened: 3 });
    expect(partial.kind).toBe('projected');
    expect(partial.wholeSyllabus).toBe(false);
    expect(partial.line).not.toContain('all 12');
    expect(partial.line).toContain('the 12 topics you have opened');
    expect(partial.line).toContain('not in this line');
  });

  it('says "all" when the tally really is the whole board', () => {
    const whole = projectFinish(4, 12, days, now, { chapters: 12, opened: 12 });
    expect(whole.wholeSyllabus).toBe(true);
    expect(whole.line).toContain('all 12 topics');
    // and a caller that knows nothing about reach is asserting the total is everything
    expect(projectFinish(4, 12, days, now).wholeSyllabus).toBe(true);
  });

  it('does not tell a parent the syllabus is finished when three chapters are unopened', () => {
    const p = projectFinish(3, 3, days, now, { chapters: 12, opened: 1 });
    expect(p.kind).toBe('complete');
    expect(p.line).not.toContain('Every topic on this syllabus');
    expect(p.line).toContain('Every topic you have opened');
  });

  it('pluralises, even at one — the copy law does not stop at the projection', () => {
    const one = projectFinish(0, 1, days, now, { chapters: 12, opened: 1 });
    // nothing learnt yet, so this is the "learn one topic" line; the shape below is the one that
    // used to print "all 1 topics are behind you by around 12 Sep 2026"
    expect(one.line).not.toContain('1 topics');
    const built = projectFinish(1, 2, [], now);
    expect(built.line).toContain('1 of 2 topics');
    const single = projectFinish(0, 1, [], now, { chapters: 1, opened: 1 });
    expect(single.line).not.toContain('1 topics');
  });
});

/**
 * HOW MUCH OF THE BOARD THE NUMBERS COVER. `chapterOf` ships every chapter with `topics: []` and
 * only an opened chapter is ever filled in, so this is the difference between the syllabus and the
 * part of it that can be counted.
 */
describe('how much of the syllabus the counts cover', () => {
  it('counts the chapters the registry holds, and those actually opened', () => {
    expect(syllabusReach(SYLLABUS)).toEqual({ chapters: 2, opened: 2 });
  });

  it('reads an unopened chapter as unopened, however many the board has', () => {
    const half = {
      subjects: [{ id: 'Mathematics', name: 'Mathematics' }],
      chaptersOf: () => [MATHS[0] as Chapter, chapter('c9', 'Mathematics', 9, [])],
    };
    expect(syllabusReach(half)).toEqual({ chapters: 2, opened: 1 });
    expect(coversWholeSyllabus(syllabusReach(half))).toBe(false);
    expect(coversWholeSyllabus(syllabusReach(SYLLABUS))).toBe(true);
  });

  it('treats an empty world as covering nothing rather than as a partial claim', () => {
    const none = { subjects: [], chaptersOf: () => [] };
    expect(syllabusReach(none)).toEqual({ chapters: 0, opened: 0 });
    expect(coversWholeSyllabus(syllabusReach(none))).toBe(true);
  });
});

describe("the note in Wobo's hand", () => {
  const blank = {
    span: 'week' as const,
    tag: '',
    showedUp: 0,
    pastDays: 7,
    asked: 0,
    answered: 0,
    wrong: 0,
    helped: 0,
    kept: 0,
    entered: 0,
    evenings: 0,
    tenMinuteDays: 0,
    bars: [],
    inProgress: null,
    waiting: null,
    lessons: [],
  };

  it('a quiet span says it was quiet rather than inventing a good week', () => {
    expect(
      reportNote(blank)
        .map((s) => s.text)
        .join(''),
    ).toContain('quiet stretch');
  });

  it('counts the lessons and problems the ledger holds, and underlines asking for help', () => {
    const note = reportNote({ ...blank, showedUp: 5, entered: 3, answered: 14, helped: 2 });
    const text = note.map((s) => s.text).join('');
    expect(text).toContain('Three lessons and fourteen problems');
    expect(text).toContain('help was asked for twice after a miss');
    expect(note.some((s) => s.em)).toBe(true);
  });

  it('never puts a name in a parent report', () => {
    const text = reportNote({ ...blank, showedUp: 2, entered: 1, answered: 4 })
      .map((s) => s.text)
      .join('');
    expect(text).not.toMatch(/\bThey\b/);
    expect(text).toContain('two days of showing up');
  });
});
