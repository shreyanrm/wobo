/**
 * "Change my class" has to be a thing a learner can actually do.
 *
 * THE BUG. The crumb on /you reads "You · Learner · Class 8 · CBSE" and opens the class and board
 * picker. Under "Your class" the picker was ALWAYS empty, for everyone whose board was already
 * pinned, and the line where the classes should be said "Pick your board and I will bring its
 * classes." — one line under a crumb naming the board. The screen built the picker's board inline
 * with `framework: null`, and `levelsFor` reads `board.framework.levels`, so there was never a
 * class to offer. The screen already held the real framework view; it was passing it to nothing
 * but the country string.
 *
 * So the board and its framework are built by one function now, and the line where a class list
 * would be tells the truth about which of the four reasons there is no list.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CurriculumFramework, CurriculumFrameworkView } from '@wobo/sdk';
import { chosenBoard, classesEmptyLine, levelsFor, unlistedBoard } from './GradeBoardPicker';

const CBSE: CurriculumFramework = {
  id: 'cbse',
  name: 'CBSE',
  kind: 'national',
  status: 'published',
  aliases: [],
  country: 'India',
  region: null,
  languages: ['en'],
  levels: ['6', '7', '8', '9', '10'],
  officialSite: null,
  personal: false,
  label: 'CBSE',
} as unknown as CurriculumFramework;

const VIEW = {
  framework: CBSE,
  version: null,
  label: 'CBSE',
  levels: CBSE.levels,
  subjects: [],
  level: '8',
  pinnedVersionId: null,
  notListed: null,
} as unknown as CurriculumFrameworkView;

const WORLD = { frameworkId: 'cbse', frameworkName: 'cbse' };

describe('the class picker on a board that is already pinned', () => {
  it('offers the classes the board teaches', () => {
    const board = chosenBoard(WORLD, VIEW);
    expect(levelsFor(board)).toEqual(['6', '7', '8', '9', '10']);
  });

  it('prefers the framework’s own name to the raw id a world was pinned from', () => {
    expect(chosenBoard(WORLD, VIEW)?.name).toBe('CBSE');
    // and falls back to the world's name while the view is still out
    expect(chosenBoard(WORLD, null)?.name).toBe('cbse');
  });

  it('is nothing at all when there is no world, which is the one empty state', () => {
    expect(chosenBoard(null, VIEW)).toBeNull();
    expect(levelsFor(null)).toEqual([]);
  });
});

describe('the line where a class list would be', () => {
  it('asks for a board only when there is no board', () => {
    expect(classesEmptyLine(null)).toBe('Pick your board and I will bring its classes.');
  });

  it('never asks for a board the learner has already given', () => {
    const board = chosenBoard(WORLD, null);
    for (const loading of [true, false]) {
      const line = classesEmptyLine(board, loading);
      expect([loading, line]).not.toEqual([
        loading,
        'Pick your board and I will bring its classes.',
      ]);
      expect(line).toContain('cbse');
    }
  });

  it('says it is fetching while it is fetching, and says so plainly when it is not', () => {
    const board = chosenBoard(WORLD, null);
    expect(classesEmptyLine(board, true)).toBe("Bringing cbse's classes.");
    expect(classesEmptyLine(board, false)).toContain('Ask me again in a moment.');
  });

  it('keeps the unlisted board its own line', () => {
    expect(classesEmptyLine(unlistedBoard('Kerala State'))).toContain('Pick your board first');
  });
});

describe('the You screen hands the picker the framework it reads classes off', () => {
  const YOU = readFileSync(join(import.meta.dir, '..', 'You.tsx'), 'utf8');

  it('builds the board through the one function, and passes no null framework', () => {
    expect(YOU).toContain('board={chosenBoard(world, framework.view)}');
    expect(YOU).toContain('loading={framework.loading}');
    // the shape that caused it: a board object typed out on the spot with no framework in it
    expect(YOU).not.toContain('framework: null,');
  });
});
