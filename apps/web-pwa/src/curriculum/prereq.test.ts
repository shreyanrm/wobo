/**
 * The prerequisite graph.
 *
 * Before this module every topic shipped `prereqTopicIds: []`, so the gate, the bridge and the
 * placement check all rested on an empty graph. These cases hold the derivation to the three
 * guards that make a derived graph safe to act on: no cross-chapter order is read as a
 * dependency, every edge points backwards in the board's own order, and both ends of an edge are
 * topics the brain actually served.
 */

import { describe, expect, test } from 'bun:test';
import type { Chapter, Topic } from '../data/model';
import {
  addOntologyPrereqs,
  applyPrereqs,
  deriveEdges,
  mentions,
  normalizeName,
  prereqReason,
  resetPrereqs,
} from './prereq';

let seq = 0;
function topic(name: string, id = `t${++seq}`): Topic {
  return { id, chapterId: '', name, blurb: '', prereqTopicIds: [], kind: 'syllabus', xp: 120 };
}

function chapter(index: number, name: string, names: string[]): Chapter {
  const topics = names.map((n) => topic(n));
  const ch: Chapter = { id: `u${index}`, subjectId: 'Mathematics', index, name, topics };
  for (const t of topics) t.chapterId = ch.id;
  return ch;
}

const edgesFor = (chapters: Chapter[], id: string) =>
  deriveEdges(chapters).filter((e) => e.topicId === id);

describe('names', () => {
  test('flattens to the same shape the brain derives a concept id from', () => {
    expect(normalizeName('Linear Equations in One Variable!')).toBe(
      'linear equations in one variable',
    );
    expect(normalizeName('  Ratio & Proportion  ')).toBe('ratio proportion');
  });

  test('a phrase is only spoken when it is spoken as whole words', () => {
    expect(mentions('multiplication of fractions', 'fractions')).toBe(true);
    expect(mentions('fractions', 'fractions')).toBe(false); // the same name is not its own ground
    expect(mentions('fractional distillation', 'fraction')).toBe(false);
  });

  test('a word that names no concept is never ground', () => {
    expect(mentions('introduction to trigonometry', 'introduction')).toBe(false);
    expect(mentions('the water cycle', 'the')).toBe(false);
  });
});

describe('the sequence rule reads a chapter, never a book', () => {
  test("a chapter's own printed order becomes one edge per step", () => {
    const chapters = [chapter(1, 'Fractions', ['What a fraction is', 'Equivalent fractions'])];
    const [first, second] = chapters[0]?.topics as [Topic, Topic];
    expect(edgesFor(chapters, first.id)).toEqual([]);
    expect(edgesFor(chapters, second.id)).toEqual([
      { topicId: second.id, prereqId: first.id, reason: 'sequence' },
    ]);
  });

  test('the order of CHAPTERS is not read as a dependency', () => {
    const chapters = [
      chapter(1, 'Data handling', ['Bar graphs']),
      chapter(2, 'Symmetry', ['Lines of symmetry']),
    ];
    const across = chapters[1]?.topics[0] as Topic;
    expect(edgesFor(chapters, across.id)).toEqual([]);
  });
});

describe('the name rule reads the framework’s own words', () => {
  test('an earlier topic this one names is ground under it', () => {
    const chapters = [
      chapter(1, 'Fractions', ['Fractions']),
      chapter(3, 'Operations', ['Multiplication of fractions']),
    ];
    const ground = chapters[0]?.topics[0] as Topic;
    const built = chapters[1]?.topics[0] as Topic;
    expect(edgesFor(chapters, built.id)).toEqual([
      { topicId: built.id, prereqId: ground.id, reason: 'name' },
    ]);
  });

  test('a LATER topic is never ground, however the names read', () => {
    const chapters = [
      chapter(1, 'Operations', ['Multiplication of fractions']),
      chapter(2, 'Fractions', ['Fractions']),
    ];
    const earlier = chapters[0]?.topics[0] as Topic;
    expect(edgesFor(chapters, earlier.id)).toEqual([]);
  });

  test('a phrase already covered by a longer one is not a second edge', () => {
    const chapters = [
      chapter(1, 'Equations', ['Linear equations']),
      chapter(2, 'Equations', ['Linear equations in one variable']),
      chapter(3, 'Equations', ['Solving linear equations in one variable']),
    ];
    const last = chapters[2]?.topics[0] as Topic;
    const names = edgesFor(chapters, last.id).map(
      (e) => [...chapters.flatMap((c) => c.topics)].find((t) => t.id === e.prereqId)?.name,
    );
    expect(names).toEqual(['Linear equations in one variable']);
  });
});

describe('the editorial table', () => {
  test('fires when the board teaches both, in the board’s own order', () => {
    const chapters = [
      chapter(1, 'Integers', ['Integers']),
      chapter(2, 'Rational numbers', ['Rational numbers']),
    ];
    const ground = chapters[0]?.topics[0] as Topic;
    const built = chapters[1]?.topics[0] as Topic;
    expect(edgesFor(chapters, built.id)).toEqual([
      { topicId: built.id, prereqId: ground.id, reason: 'editorial' },
    ]);
  });

  test('never contradicts a board that prints them the other way round', () => {
    const chapters = [
      chapter(1, 'Rational numbers', ['Rational numbers']),
      chapter(2, 'Integers', ['Integers']),
    ];
    const first = chapters[0]?.topics[0] as Topic;
    expect(edgesFor(chapters, first.id)).toEqual([]);
  });

  test('never asserts an edge to a topic the learner’s syllabus does not have', () => {
    const chapters = [chapter(1, 'Numbers', ['Rational numbers'])];
    expect(edgesFor(chapters, chapters[0]?.topics[0]?.id as string)).toEqual([]);
  });
});

describe('applyPrereqs puts the graph on the topics', () => {
  test('a topic that had an empty list now stands on the ground under it', () => {
    resetPrereqs();
    const chapters = [
      chapter(1, 'Integers', ['Integers']),
      chapter(2, 'Rational numbers', ['Rational numbers', 'Properties of rational numbers']),
    ];
    const integers = chapters[0]?.topics[0] as Topic;
    const rational = chapters[1]?.topics[0] as Topic;
    const properties = chapters[1]?.topics[1] as Topic;

    expect(rational.prereqTopicIds).toEqual([]);
    applyPrereqs(chapters);

    expect(integers.prereqTopicIds).toEqual([]);
    expect(rational.prereqTopicIds).toEqual([integers.id]);
    expect(prereqReason(rational.id, integers.id)).toBe('editorial');
    // The next lesson in the same chapter stands on the one before it AND on what it names.
    expect(properties.prereqTopicIds).toContain(rational.id);
    expect(prereqReason(properties.id, rational.id)).toBe('name');
  });

  test('re-deriving a subject clears an edge that no longer exists', () => {
    resetPrereqs();
    const full = [chapter(1, 'Fractions', ['Fractions', 'Adding fractions'])];
    applyPrereqs(full);
    const adding = full[0]?.topics[1] as Topic;
    expect(adding.prereqTopicIds.length).toBe(1);

    // The board reorders the chapter: the ground is now printed after what stood on it.
    const flipped: Chapter[] = [{ ...(full[0] as Chapter), topics: [adding] }];
    applyPrereqs(flipped);
    expect(adding.prereqTopicIds).toEqual([]);
    expect(prereqReason(adding.id, full[0]?.topics[0]?.id as string)).toBeUndefined();
  });
});

describe('the platform’s own edges', () => {
  test('a named prerequisite the learner’s syllabus has becomes an ontology edge', () => {
    resetPrereqs();
    const chapters = [
      chapter(1, 'Algebra', ['Variables and simple expressions']),
      chapter(2, 'Equations', ['Solving linear equations in one variable']),
    ];
    applyPrereqs(chapters);
    const variables = chapters[0]?.topics[0] as Topic;
    const solving = chapters[1]?.topics[0] as Topic;

    const added = addOntologyPrereqs(
      solving,
      [{ name: 'Variables and simple expressions' }, { name: 'Set theory' }],
      chapters.flatMap((c) => c.topics),
    );
    expect(added).toEqual([variables.id]);
    // "Set theory" is not in this learner's syllabus, so it is dropped rather than invented.
    expect(solving.prereqTopicIds).toEqual([variables.id]);
    expect(prereqReason(solving.id, variables.id)).toBe('ontology');
  });

  test('the platform outranks a weaker rule for the same edge', () => {
    resetPrereqs();
    const chapters = [chapter(1, 'Fractions', ['Fractions', 'Adding fractions'])];
    applyPrereqs(chapters);
    const fractions = chapters[0]?.topics[0] as Topic;
    const adding = chapters[0]?.topics[1] as Topic;
    expect(prereqReason(adding.id, fractions.id)).toBe('name');

    addOntologyPrereqs(adding, [{ name: 'Fractions' }], chapters[0]?.topics ?? []);
    expect(prereqReason(adding.id, fractions.id)).toBe('ontology');
    expect(adding.prereqTopicIds.filter((id) => id === fractions.id).length).toBe(1);
  });
});
