import { describe, expect, it } from 'bun:test';
import type { MindState } from '../../store/mind';
import {
  asHeading,
  calendarWeek,
  continueLine,
  HOME_QUESTION,
  markedRun,
  type NoticedInput,
  noticed,
  relativeDay,
  todayLine,
  words,
} from './today';

const topic = (id: string, name: string, chapterId = 'c6') => ({
  id,
  chapterId,
  name,
  blurb: '',
  prereqTopicIds: [],
  kind: 'syllabus' as const,
  xp: 120,
});

const chapter = {
  id: 'c6',
  subjectId: 'Mathematics',
  index: 6,
  name: 'Triangles and the hypotenuse',
  topics: [topic('t1', 'A'), topic('t2', 'B'), topic('t3', 'Pythagoras, the hypotenuse')],
};

describe('the situational line', () => {
  it('says the board is missing before anything else', () => {
    expect(todayLine({ world: false, continue: null, next: null })).toBe(
      'Tell me your board. Then your own syllabus lands here.',
    );
  });

  it('counts the lessons walked in the chapter under way', () => {
    const line = todayLine({
      world: true,
      continue: {
        topic: chapter.topics[2] as ReturnType<typeof topic>,
        chapter,
        lesson: 3,
        total: 5,
        done: 2,
        progress: 0.4,
      },
      next: null,
    });
    expect(line).toBe("Triangles and the hypotenuse. You're two lessons in.");
  });

  it('names the lesson when none is finished yet', () => {
    const line = todayLine({
      world: true,
      continue: {
        topic: chapter.topics[0] as ReturnType<typeof topic>,
        chapter,
        lesson: 1,
        total: 3,
        done: 0,
        progress: 0.2,
      },
      next: null,
    });
    expect(line).toBe('Triangles and the hypotenuse. Lesson 1 of 3.');
  });

  it('points at what is next when nothing is in flight', () => {
    const line = todayLine({
      world: true,
      continue: null,
      next: {
        topic: topic('t9', 'Data handling'),
        chapter: null,
        lesson: 0,
        total: 0,
        done: 0,
        progress: 0,
      },
    });
    expect(line).toBe('Next: Data handling.');
  });

  it('opens the subjects when the world has no topics loaded', () => {
    expect(todayLine({ world: true, continue: null, next: null })).toBe(
      'Open your subjects. Your chapters come from your board when you open one.',
    );
  });

  it('spells the small numbers', () => {
    expect(words(2)).toBe('two');
    expect(words(14)).toBe('14');
  });
});

describe('the continue card’s line', () => {
  it('is the chapter and the lesson of the total', () => {
    expect(
      continueLine({
        topic: chapter.topics[2] as ReturnType<typeof topic>,
        chapter,
        lesson: 3,
        total: 5,
        done: 2,
        progress: 0.4,
      }),
    ).toBe('Chapter 6 · lesson 3 of 5.');
  });
  it('says nothing it does not know', () => {
    expect(
      continueLine({
        topic: topic('x', 'X'),
        chapter: null,
        lesson: 0,
        total: 0,
        done: 0,
        progress: 0,
      }),
    ).toBe('');
  });
});

describe('the streak’s week', () => {
  it('runs Monday to Sunday and lights the days the learner showed up', () => {
    // 2026-09-03 is a Thursday
    const now = new Date('2026-09-03T10:00:00Z');
    const week = calendarWeek(['2026-08-31', '2026-09-02', '2026-09-03', '2026-08-30'], now);
    expect(week.map((d) => d.label).join('')).toBe('MTWTFSS');
    expect(week.map((d) => d.on)).toEqual([true, false, true, true, false, false, false]);
  });
});

describe('when something happened', () => {
  const now = new Date('2026-09-03T10:00:00Z');
  it('is today, yesterday, or the weekday', () => {
    expect(relativeDay('2026-09-03T02:00:00Z', now)).toBe('today');
    expect(relativeDay('2026-09-02T22:00:00Z', now)).toBe('yesterday');
    expect(relativeDay('2026-08-30T12:00:00Z', now)).toBe('Sunday');
    expect(relativeDay('nonsense', now)).toBe('');
  });
});

describe('what Wobo noticed', () => {
  const empty: MindState = {
    latenciesMs: [],
    slips: [],
    dwellSec: {},
    sessionDays: [],
    interests: [],
    facts: [],
  };
  const now = new Date('2026-09-03T10:00:00Z'); // a Thursday
  const look = (patch: Partial<NoticedInput> = {}) =>
    noticed({ mind: empty, marks: [], streakDays: 0, chapter: null, now, ...patch });

  it('is nothing until Wobo has watched something', () => {
    expect(look()).toBeNull();
  });

  it('is the prototype’s card once help was asked for after a miss', () => {
    expect(look({ mind: { ...empty, helpedAt: '2026-09-02T18:00:00Z' } })).toEqual({
      id: 'helped',
      title: 'You asked for help after a miss',
      body: "That's exactly how learning looks. It goes in the Sunday note.",
      when: 'yesterday',
    });
  });

  it('names the chapter the learner actually finished, and counts its lessons', () => {
    const seen = look({ chapter });
    expect(seen?.id).toBe('chapter');
    expect(seen?.title).toBe('You finished Triangles and the hypotenuse');
    expect(seen?.body).toBe('Every lesson in chapter 6, done.');
    expect(seen?.when).toBe('');
  });

  it('sees a quiet day the chain survived — the streak outruns the days marked', () => {
    const seen = look({ marks: ['2026-09-01', '2026-09-02', '2026-09-03'], streakDays: 5 });
    expect(seen?.id).toBe('rest');
    expect(seen?.title).toBe('A rest day did not break your streak');
    expect(seen?.body).toBe("five days still in a row. Rest days don't break it.");
  });

  it('says nothing about a streak the marks already account for', () => {
    expect(look({ marks: ['2026-09-01', '2026-09-02', '2026-09-03'], streakDays: 3 })).toBeNull();
    expect(look({ marks: ['2026-09-03'], streakDays: 1 })).toBeNull();
  });

  it('says nothing about a wrong answer or a day shown up on its own', () => {
    expect(
      look({ mind: { ...empty, slips: [{ nodeId: 'n1', value: 4, at: '2026-09-02' }] } }),
    ).toBeNull();
    expect(look({ mind: { ...empty, sessionDays: ['2026-09-01', '2026-09-03'] } })).toBeNull();
  });

  it('carries its own words — no observation shares a body with another', () => {
    const bodies = [
      look({ mind: { ...empty, helpedAt: '2026-09-03T09:00:00Z' } })?.body,
      look({ chapter })?.body,
      look({ marks: ['2026-09-03'], streakDays: 4 })?.body,
    ];
    expect(bodies.every(Boolean)).toBe(true);
    expect(new Set(bodies).size).toBe(3);
  });
});

describe('the run of days actually marked', () => {
  const now = new Date('2026-09-03T10:00:00Z');
  it('counts back from today', () => {
    expect(markedRun(['2026-09-03', '2026-09-02', '2026-09-01'], now)).toBe(3);
  });
  it('counts back from yesterday when today has no mark yet', () => {
    expect(markedRun(['2026-09-02', '2026-09-01'], now)).toBe(2);
  });
  it('stops at the first gap', () => {
    expect(markedRun(['2026-09-03', '2026-09-01'], now)).toBe(1);
    expect(markedRun([], now)).toBe(0);
  });
});

describe('the home’s own words', () => {
  it('asks one question, and the card opens it as a sentence', () => {
    expect(HOME_QUESTION).toBe('what are we figuring out this evening?');
    expect(asHeading(HOME_QUESTION)).toBe('What are we figuring out this evening?');
    expect(asHeading('')).toBe('');
  });
});
