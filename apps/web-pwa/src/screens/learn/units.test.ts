import { describe, expect, it } from 'bun:test';
import type { MasteryBand } from '@wobo/contracts';
import type { Chapter, Topic } from '../../data/model';
import { topicNodeId, topicNodeUuid } from './mastery';
import { defaultSubject, tileLine, unitLine, unitRows, unitState } from './units';

const topic = (id: string, chapterId: string) => ({
  id,
  chapterId,
  name: id,
  blurb: '',
  prereqTopicIds: [],
  kind: 'syllabus' as const,
  xp: 120,
});

const chapter = (index: number, name: string, n: number): Chapter => ({
  id: `c${index}`,
  subjectId: 'Mathematics',
  index,
  name,
  topics: Array.from({ length: n }, (_, i) => topic(`c${index}-t${i + 1}`, `c${index}`)),
});

const CHAPTERS = [
  chapter(5, 'Understanding quadrilaterals', 4),
  chapter(6, 'Triangles and the hypotenuse', 5),
  chapter(7, 'Data handling', 5),
  chapter(8, 'Squares and square roots', 4),
];

describe('the unit rows', () => {
  const rows = unitRows(CHAPTERS, {
    completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4', 'c6-t1', 'c6-t2']),
    topicProgress: { 'c6-t3': 0.5 },
  });

  it('are done, now, next and later — in that order for the prototype’s week', () => {
    expect(rows.map((r) => r.state)).toEqual(['done', 'now', 'next', 'later']);
  });

  it('say the lesson of the total on the chapter under way, and the bar is its fraction', () => {
    const now = rows[1];
    expect(now?.lesson).toBe(3);
    expect(unitLine(now as NonNullable<typeof now>)).toBe('Lesson 3 of 5');
    expect(now?.progress).toBe(0.5);
    expect(now?.topicId).toBe('c6-t3');
  });

  it('count the lessons of the others', () => {
    expect(rows.map((r) => unitLine(r))).toEqual([
      '4 lessons',
      'Lesson 3 of 5',
      '5 lessons',
      '4 lessons',
    ]);
    // the `now` row carries the Continue button, not a state word
    expect(rows.filter((r) => r.state !== 'now').map((r) => unitState(r.state))).toEqual([
      'Mastered',
      'Next',
      'Later',
    ]);
  });

  it('make the first chapter next when nothing has begun', () => {
    const fresh = unitRows(CHAPTERS, { completed: new Set(), topicProgress: {} });
    expect(fresh.map((r) => r.state)).toEqual(['next', 'later', 'later', 'later']);
    expect(fresh[0]?.topicId).toBe('c5-t1');
  });

  it('say nothing about lessons they have not loaded', () => {
    const unloaded = unitRows([{ ...chapter(9, 'Unknown', 0) }], {
      completed: new Set(),
      topicProgress: {},
    });
    expect(unitLine(unloaded[0] as NonNullable<(typeof unloaded)[0]>)).toBe('');
    expect(unloaded[0]?.state).toBe('next');
  });

  it('say nothing of an untouched chapter before the one under way', () => {
    const rows = unitRows([chapter(1, 'Rational numbers', 0), ...CHAPTERS], {
      completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4']),
      topicProgress: { 'c6-t1': 0.2 },
    });
    expect(rows.map((r) => r.state)).toEqual(['past', 'done', 'now', 'next', 'later']);
    expect(unitState('past')).toBe('');
  });

  it('treat a part-done chapter with no course in flight as under way', () => {
    const part = unitRows(CHAPTERS.slice(1, 2), {
      completed: new Set(['c6-t1']),
      topicProgress: {},
    });
    expect(part[0]?.state).toBe('now');
    expect(part[0]?.lesson).toBe(2);
    expect(part[0]?.topicId).toBe('c6-t2');
  });
});

describe('the tiles', () => {
  const maths = {
    id: 'Mathematics',
    name: 'Mathematics',
    line: 'patterns, structure, and certainty',
  };
  it('say where the class is', () => {
    const rows = unitRows(CHAPTERS, {
      completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4']),
      topicProgress: { 'c6-t1': 0.2 },
    });
    expect(tileLine(maths, rows)).toBe('Chapter 6 of 4 · Triangles and the hypotenuse');
  });
  it('fall back to the subject’s own line when nothing is loaded', () => {
    expect(tileLine(maths, [])).toBe('patterns, structure, and certainty');
  });
  it('open on the subject with a chapter under way, else the first', () => {
    const science = { id: 'Science', name: 'Science', line: '' };
    const rowsOf = (s: { id: string }) =>
      s.id === 'Science'
        ? unitRows(CHAPTERS.slice(0, 1), { completed: new Set(), topicProgress: { 'c5-t1': 0.3 } })
        : unitRows(CHAPTERS, { completed: new Set(), topicProgress: {} });
    expect(defaultSubject([maths, science], rowsOf)?.id).toBe('Science');
    expect(defaultSubject([maths, science], () => [])?.id).toBe('Mathematics');
    expect(defaultSubject([], () => [])).toBeNull();
  });
});

describe('mastery gates the rows', () => {
  const bands = (map: Record<string, MasteryBand>) => (t: { id: string }) =>
    map[t.id] ?? 'not_started';

  it('does not call a chapter mastered when the answers were wrong', () => {
    // Every topic of chapter 5 completed, every one of them answered badly. Completion alone used
    // to say "Mastered" here; the evidence says otherwise.
    const rows = unitRows(CHAPTERS, {
      completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4']),
      topicProgress: {},
      bandOf: bands({
        'c5-t1': 'secure',
        'c5-t2': 'emerging',
        'c5-t3': 'secure',
        'c5-t4': 'secure',
      }),
    });
    expect(rows[0]?.state).not.toBe('done');
    expect(rows[0]?.owes).toBe(true);
    expect(rows[0]?.done).toBe(3);
    // and Continue opens the topic that is owed, not the one after it
    expect(rows[0]?.topicId).toBe('c5-t2');
  });

  it('does not point next past a topic still owed behind the learner', () => {
    // Chapter 5 finished but shaky; chapter 6 is under way. "Next" is the debt, not chapter 7.
    const rows = unitRows(CHAPTERS, {
      completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4', 'c6-t1', 'c6-t2']),
      topicProgress: { 'c6-t3': 0.5 },
      bandOf: bands({
        'c5-t1': 'secure',
        'c5-t2': 'secure',
        'c5-t3': 'developing',
        'c5-t4': 'secure',
        'c6-t1': 'secure',
        'c6-t2': 'secure',
      }),
    });
    expect(rows.map((r) => r.state)).toEqual(['next', 'now', 'later', 'later']);
    expect(rows[0]?.topicId).toBe('c5-t3');
  });

  it('brings a finished chapter back around when it is neither in hand nor up next', () => {
    const rows = unitRows(CHAPTERS, {
      completed: new Set([
        'c5-t1',
        'c5-t2',
        'c5-t3',
        'c5-t4',
        'c6-t1',
        'c6-t2',
        'c6-t3',
        'c6-t4',
        'c6-t5',
      ]),
      topicProgress: { 'c7-t1': 0.4 },
      bandOf: bands({ 'c5-t1': 'emerging', 'c6-t5': 'developing' }),
    });
    // c7 is under way, c5 is the weakest debt and comes next, c6 waits its turn.
    expect(rows.map((r) => r.state)).toEqual(['next', 'revisit', 'now', 'later']);
    expect(unitState('revisit')).toBe('Come back to');
  });

  it('leaves a completed topic alone when there is no evidence either way', () => {
    // Silence is not a failing grade: progress made before mastery was persisted stays done.
    const rows = unitRows(CHAPTERS, {
      completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4']),
      topicProgress: {},
      bandOf: bands({}),
    });
    expect(rows[0]?.state).toBe('done');
    expect(rows[0]?.owes).toBe(false);
  });

  it('counts a topic at the floor as learnt and one below it as still owed', () => {
    const owed = unitRows(CHAPTERS.slice(0, 1), {
      completed: new Set(['c5-t1']),
      topicProgress: {},
      bandOf: bands({ 'c5-t1': 'developing' }),
    });
    expect(owed[0]?.done).toBe(0);
    const learnt = unitRows(CHAPTERS.slice(0, 1), {
      completed: new Set(['c5-t1']),
      topicProgress: {},
      bandOf: bands({ 'c5-t1': 'secure' }),
    });
    expect(learnt[0]?.done).toBe(1);
  });

  it('finishes the open course before it sends the learner back to a debt', () => {
    // Kindness beats bookkeeping: a lesson in flight is never interrupted by an older debt.
    const rows = unitRows(CHAPTERS.slice(0, 2), {
      completed: new Set(['c5-t1', 'c5-t2', 'c5-t3', 'c5-t4']),
      topicProgress: { 'c6-t1': 0.6 },
      bandOf: bands({ 'c5-t4': 'emerging' }),
    });
    expect(rows[1]?.state).toBe('now');
    expect(rows[1]?.topicId).toBe('c6-t1');
    expect(rows[0]?.state).toBe('next');
  });
});

describe('what comes next follows the law, not the list order', () => {
  it('sends the learner to the weakest debt, even when an earlier chapter also owes one', () => {
    const rows = unitRows(CHAPTERS, {
      completed: new Set([
        'c5-t1',
        'c5-t2',
        'c5-t3',
        'c5-t4',
        'c7-t1',
        'c7-t2',
        'c7-t3',
        'c7-t4',
        'c7-t5',
      ]),
      topicProgress: { 'c6-t1': 0.5 },
      // chapter 5 is shaky, chapter 7 is worse. Position says 5; the law says 7.
      bandOf: (t: { id: string }) =>
        (({ 'c5-t2': 'developing', 'c7-t4': 'emerging' }) as Record<string, MasteryBand>)[t.id] ??
        'not_started',
    });
    expect(rows.map((r) => r.state)).toEqual(['revisit', 'now', 'next', 'later']);
    expect(rows[2]?.topicId).toBe('c7-t4');
  });
});

/**
 * THE LIE THIS FILE EXISTS TO CATCH.
 *
 * `registry.ts` gives a topic `nodeId = node.conceptIds[0]`, a SLUG. Every payload that records
 * evidence types `node_id` as a UUID, and the course files everything it records under
 * `topicNodeUuid(topicId)`, so for every topic the brain had mapped, the band was read from a key
 * nothing had ever written. It came back `not_started`, the rules read that as silence rather than
 * as a bad result, and a chapter finished badly still said "Mastered". Bands gated nothing.
 */
describe('a mapped topic is judged by the evidence it actually produced', () => {
  const MAPPED: Chapter = {
    id: 'cm',
    subjectId: 'Mathematics',
    index: 1,
    // Shaped exactly as `topicOf` builds one from a curriculum node with a concept behind it.
    topics: [{ ...topic('cm-t1', 'cm'), name: 'Fractions', nodeId: 'fractions' }],
    name: 'Fractions',
  };

  // The bands as the mastery store actually holds them: keyed by the id the COURSE filed the
  // evidence under (`topicNodeUuid(topicId)`, because the contract types every evidence node_id as
  // a UUID). `bandOf` below is store/mastery.tsx's own line, verbatim: that is the read that was
  // looking up a key nothing had ever written.
  const bands: Record<string, MasteryBand> = { [topicNodeUuid('cm-t1')]: 'emerging' };
  const storeBandOf = (t: Topic): MasteryBand => bands[topicNodeId(t)] ?? 'not_started';

  it('brings a finished chapter back when its evidence puts it below the floor', () => {
    const rows = unitRows([MAPPED], {
      completed: new Set(['cm-t1']),
      topicProgress: {},
      bandOf: storeBandOf,
    });
    expect(rows[0]?.owes).toBe(true);
    expect(rows[0]?.state).not.toBe('done');
    expect(unitState(rows[0]?.state ?? 'later')).not.toBe('Mastered');
  });

  it('still says Mastered when the same evidence is at the floor', () => {
    const rows = unitRows([MAPPED], {
      completed: new Set(['cm-t1']),
      topicProgress: {},
      bandOf: () => 'secure',
    });
    expect(rows[0]?.owes).toBe(false);
    expect(unitState(rows[0]?.state ?? 'later')).toBe('Mastered');
  });
});

/**
 * The one place a learner is told they have gone backwards. It used to be two words and nothing
 * else: the tick vanished, the row said "Come back to", and no sentence named what fell or what to
 * do. That is the moment a child decides they are bad at a subject.
 */
describe('a chapter that fell back says what fell', () => {
  it('names the topic and what to do, instead of a lesson count', () => {
    const chapters = [
      chapter(1, 'Fractions', 2),
      chapter(2, 'Decimals', 2),
      chapter(3, 'Percentage', 2),
    ];
    const fallen = (chapters[0] as Chapter).topics[1];
    if (fallen) fallen.name = 'Multiplication of fractions';
    const bands: Record<string, MasteryBand> = { 'c1-t2': 'developing', 'c2-t1': 'emerging' };
    const rows = unitRows(chapters, {
      // Chapter 3 is in hand, chapter 2 carries the weaker debt (so it is what comes next), and
      // chapter 1 is the one that quietly stopped saying Mastered.
      completed: new Set(['c1-t1', 'c1-t2', 'c2-t1']),
      topicProgress: { 'c3-t1': 0.4 },
      bandOf: (t) => bands[t.id] ?? 'secure',
    });
    const revisit = rows.find((r) => r.state === 'revisit');
    expect(revisit).toBeDefined();
    expect(revisit?.owedName).toBe('Multiplication of fractions');
    const line = unitLine(revisit as NonNullable<typeof revisit>);
    expect(line).toContain('Multiplication of fractions');
    expect(line).not.toMatch(/^Lesson \d+ of \d+$/);
    expect(line.length).toBeGreaterThan(20);
  });
});
