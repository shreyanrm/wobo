import { describe, expect, it } from 'bun:test';
import type { DayLedger } from '../../store/mind';
import {
  barHeight,
  spanDays,
  strengths,
  summarise,
  sundayNote,
  times,
  verbFor,
  type WeekInput,
  weekSentence,
  word,
} from './week';

const NOW = new Date('2026-09-03T15:00:00Z'); // a Thursday

const day = (patch: Partial<DayLedger>): DayLedger => ({
  answered: 0,
  wrong: 0,
  asked: 0,
  helped: 0,
  kept: 0,
  entered: 0,
  seconds: 0,
  evening: false,
  ...patch,
});

const TOPICS = [
  { id: 't1', name: 'Understanding quadrilaterals', chapterId: 'c1', subject: 'Mathematics' },
  { id: 't2', name: 'Triangles', chapterId: 'c1', subject: 'Mathematics' },
  { id: 't3', name: 'Sound', chapterId: 'c2', subject: 'Science' },
];

function input(patch: Partial<WeekInput> = {}): WeekInput {
  return {
    now: NOW,
    span: 'week',
    marks: [],
    counts: {},
    days: {},
    topics: TOPICS,
    topicProgress: {},
    completed: new Set(),
    ...patch,
  };
}

describe('spanDays', () => {
  it('draws the week Monday to Sunday with today in it', () => {
    const { days, todayIndex } = spanDays(NOW, 'week');
    expect(days).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(todayIndex).toBe(3);
  });
  it('draws the calendar month and the calendar year', () => {
    expect(spanDays(NOW, 'month').days.length).toBe(30);
    expect(spanDays(NOW, 'year').days.length).toBe(365);
  });
});

describe('summarise', () => {
  it('counts the ledger over the past days of the span only', () => {
    const s = summarise(
      input({
        marks: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-08-30'],
        days: {
          '2026-09-01': day({ asked: 4, answered: 6, wrong: 2, helped: 1, kept: 1, evening: true }),
          '2026-09-03': day({ asked: 7, seconds: 700, entered: 2 }),
          '2026-08-30': day({ asked: 100 }), // last week
          '2026-09-05': day({ asked: 100 }), // not yet
        },
      }),
    );
    expect(s.showedUp).toBe(4);
    expect(s.pastDays).toBe(4);
    expect(s.asked).toBe(11);
    expect(s.answered).toBe(6);
    expect(s.helped).toBe(1);
    expect(s.evenings).toBe(1);
    expect(s.tenMinuteDays).toBe(1);
    expect(s.entered).toBe(2);
    expect(s.bars.length).toBe(7);
    expect(s.bars.filter((b) => b.future).length).toBe(3);
    expect(s.bars[4]?.value).toBe(0);
  });

  it('rolls the year up by month', () => {
    const s = summarise(input({ span: 'year', days: { '2026-03-02': day({ asked: 3 }) } }));
    expect(s.bars.length).toBe(12);
    expect(s.bars[2]?.value).toBe(3);
    expect(s.bars[9]?.future).toBe(true);
    expect(s.bars[8]?.future).toBe(false);
  });

  it('finds the furthest open topic and the one waiting after it', () => {
    const s = summarise(
      input({ topicProgress: { t2: 0.5 }, completed: new Set(['t1']), marks: ['2026-09-03'] }),
    );
    expect(s.inProgress).toEqual({ name: 'Triangles', fraction: 0.5 });
    expect(s.waiting).toEqual({ name: 'Sound' });
    expect(s.lessons.map((l) => `${l.name}:${l.state}`)).toEqual([
      'Triangles:in progress',
      'Understanding quadrilaterals:mastered',
      'Sound:next',
    ]);
  });
});

describe('the words', () => {
  it('writes numbers the way the prototype does', () => {
    expect(word(5)).toBe('five');
    expect(word(11)).toBe('eleven');
    expect(word(23)).toBe('23');
    expect(times(1)).toBe('once');
    expect(times(2)).toBe('twice');
    expect(times(3)).toBe('three times');
    expect(verbFor('Triangles')).toBe('are');
    expect(verbFor('Sound')).toBe('is');
    expect(verbFor('Mass')).toBe('is');
    expect(verbFor('Understanding quadrilaterals')).toBe('is');
  });

  it("writes the prototype's sentence from the learner's own numbers", () => {
    const s = summarise(
      input({
        marks: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'],
        days: { '2026-09-01': day({ asked: 11 }) },
        topicProgress: { t2: 0.5 },
      }),
    );
    // four past days only this week — the marks decide showing up, never a guess
    const line = weekSentence(s)
      .map((x) => x.text)
      .join('');
    expect(line).toBe(
      "You showed up four days and asked me eleven questions, which tells me you're working through problems instead of skipping them. Triangles are half done. Sound is waiting.",
    );
    expect(weekSentence(s)[1]?.em).toBe(true);
  });

  it('never praises the empty week, and never claims a question that was not asked', () => {
    expect(weekSentence(summarise(input()))[0]?.text).toBe(
      'Rest is part of learning. Quiet days are allowed.',
    );
    const quiet = summarise(input({ marks: ['2026-09-03'] }));
    expect(
      weekSentence(quiet)
        .map((x) => x.text)
        .join(''),
    ).toBe('You showed up one day. Understanding quadrilaterals is waiting.');
    expect(strengths(quiet)).toEqual([]);
  });

  it('praises behaviour only where the ledger holds it', () => {
    const s = summarise(
      input({
        marks: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'],
        days: {
          '2026-08-31': day({ helped: 2, kept: 2, evening: true, seconds: 900 }),
          '2026-09-01': day({ evening: true, seconds: 900 }),
          '2026-09-02': day({ evening: true }),
        },
      }),
    );
    expect(strengths(s).map((x) => x.line)).toEqual([
      'Asked for help after a wrong answer, twice. Kept going both times.',
      'Opened Wobo on your own three evenings this week.',
      'Ten minutes a day, most days. That is the whole trick.',
    ]);
  });

  it('writes the Sunday note in the same hand', () => {
    const s = summarise(
      input({
        marks: ['2026-09-01'],
        days: { '2026-09-01': day({ entered: 3, answered: 14, helped: 2 }) },
      }),
    );
    expect(
      sundayNote(s, 'the learner')
        .map((x) => x.text)
        .join(''),
    ).toBe(
      'Three lessons, fourteen problems, and the learner asked for help twice after a miss, which is exactly how learning looks.',
    );
  });

  it('draws a quiet bar for a day still to come', () => {
    const bars = [
      { key: 'a', value: 2, future: false },
      { key: 'b', value: 4, future: false },
      { key: 'c', value: 0, future: true },
    ];
    expect(barHeight(bars[0] as never, bars)).toBe(50);
    expect(barHeight(bars[1] as never, bars)).toBe(100);
    expect(barHeight(bars[2] as never, bars)).toBe(20);
  });
});
