/**
 * THE BADGES, EXECUTED.
 *
 * This derivation had never run anywhere. It lived inline in `ProgressSurfaces.tsx`, which no test
 * mounts and no route reached; the screenshots offered as proof came from a bundle that passed
 * three hand-written badge literals instead — including `{ title: 'Rational numbers — every topic
 * behind you' }` beside a panel in the same image reading "Rational numbers · 2 of 3". The real
 * derivation cannot produce that pair, and the first case below is why.
 */

import { describe, expect, it } from 'bun:test';
import { MAX_CHAPTER_BADGES, reportBadges } from './badges';
import type { ChapterRow } from './evidence';

const row = (id: string, name: string, learnt: number, total: number): ChapterRow => ({
  id,
  name,
  subjectName: 'Mathematics',
  total,
  learnt,
  debt: 0,
});

const EMPTY = { strengths: [], chapters: [], trophy: null };

describe('a badge is a fact something else recorded', () => {
  it('never claims a chapter is finished until every topic in it is', () => {
    const badges = reportBadges({
      ...EMPTY,
      chapters: [row('c1', 'Rational numbers', 2, 3), row('c2', 'Squares', 4, 4)],
    });
    expect(badges.map((b) => b.title)).toEqual(['Squares — every topic behind you']);
  });

  it('says nothing at all about a chapter nobody has finished', () => {
    expect(reportBadges({ ...EMPTY, chapters: [row('c1', 'Rational numbers', 2, 3)] })).toEqual([]);
  });

  it('ignores an empty chapter, which is unopened rather than finished', () => {
    // `chapterOf` ships a chapter with `topics: []`; 0 of 0 is not an achievement
    expect(reportBadges({ ...EMPTY, chapters: [row('c9', 'Mensuration', 0, 0)] })).toEqual([]);
  });

  it('names at most two finished chapters, so a good term is a report and not a wall', () => {
    const many = Array.from({ length: 6 }, (_, i) => row(`c${i}`, `Chapter ${i}`, 3, 3));
    const badges = reportBadges({ ...EMPTY, chapters: many });
    expect(badges).toHaveLength(MAX_CHAPTER_BADGES);
    expect(badges.map((b) => b.id)).toEqual(['chapter-c0', 'chapter-c1']);
  });

  it('carries the week’s own strengths, in the words the You screen praises them with', () => {
    const badges = reportBadges({
      ...EMPTY,
      strengths: [
        { id: 'consistency', line: 'Four evenings in a row' },
        { id: 'recall', line: 'What came back after a week' },
      ],
    });
    expect(badges).toEqual([
      { id: 'consistency', title: 'Four evenings in a row', mark: 'rhythm' },
      { id: 'recall', title: 'What came back after a week', mark: 'held' },
    ]);
  });

  it('carries the trophy that was actually earned, and none when none was', () => {
    expect(
      reportBadges({ ...EMPTY, trophy: { key: 'streak-7', title: 'A week straight' } }),
    ).toEqual([{ id: 'streak-7', title: 'A week straight', mark: 'earned' }]);
    expect(reportBadges(EMPTY)).toEqual([]);
  });

  it('puts them in one order: behaviour, then chapters, then the trophy', () => {
    const badges = reportBadges({
      strengths: [{ id: 'consistency', line: 'Four evenings in a row' }],
      chapters: [row('c2', 'Squares', 4, 4)],
      trophy: { key: 'streak-7', title: 'A week straight' },
    });
    expect(badges.map((b) => b.id)).toEqual(['consistency', 'chapter-c2', 'streak-7']);
    expect(badges.map((b) => b.mark)).toEqual(['rhythm', 'earned', 'earned']);
  });

  it('invents nothing when the learner has done nothing yet', () => {
    expect(reportBadges(EMPTY)).toEqual([]);
  });
});
