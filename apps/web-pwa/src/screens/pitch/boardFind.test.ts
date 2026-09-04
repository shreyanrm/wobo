/**
 * The board finder, held to the two things it exists to do.
 *
 * ONE, it finds the board. A reader types what they call their board, not what the registry calls
 * it, so the aliases are the search keys and the first row has to be the one they meant.
 *
 * TWO, and this is the one the owner has caught this repo getting wrong twice, IT DOES NOT
 * OVERCLAIM. `content/curriculum/syllabi` holds official chapter lists for four boards and records
 * a blocked fetch for the rest. Every sentence this module produces has to be true of the board it
 * is about, and the counts under the finder have to be the sources' own rather than a number
 * somebody liked. So the generated file is rebuilt here from `content/` and compared: a syllabus
 * that lands, a board that leaves the registry, or a hand edit to `boards.json` fails this test.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPitchBoards,
  holdings,
  type Seed,
  type SyllabusFile,
  shortName,
  whereLine,
} from '../../../scripts/pitch-boards';
import {
  andList,
  BOARDS,
  boardAnswer,
  boardScore,
  findBoards,
  fold,
  HELD,
  isHeld,
  matchedName,
  NO_MATCH,
  nameScore,
  names,
  type PitchBoard,
  reachLine,
  statusWord,
} from './boardFind';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const CURRICULUM = join(REPO, 'content', 'curriculum');

function everySyllabus(dir: string, out: SyllabusFile[] = []): SyllabusFile[] {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) everySyllabus(path, out);
    else if (entry.endsWith('.json')) out.push(JSON.parse(readFileSync(path, 'utf8')));
  }
  return out;
}

describe('the finder reads the registry, and nothing is typed by hand', () => {
  it('is exactly what the curriculum sources build today', () => {
    const seed = JSON.parse(readFileSync(join(CURRICULUM, 'frameworks.seed.json'), 'utf8')) as Seed;
    const built = buildPitchBoards(seed, everySyllabus(join(CURRICULUM, 'syllabi')));
    expect(BOARDS).toEqual(built);
  });

  it('counts a board as held only where a chapter list actually landed', () => {
    const blocked: SyllabusFile[] = [
      { framework_id: 'cbse', subject: 'Mathematics', version: '2026-27', units: [{}, {}] },
      // the shape `content/curriculum/syllabi/telangana/**` is actually in: the document was
      // fetched, the chapter list could not be extracted, and the file records the blocker
      { framework_id: 'bse-telangana', subject: 'Mathematics', version: '2026-27', units: null },
    ];
    const held = holdings(blocked);
    expect(held.get('cbse')).toEqual({
      subjects: ['Mathematics'],
      year: '2026-27',
      chapters: 2,
      syllabuses: 1,
    });
    expect(held.has('bse-telangana')).toBe(false);
  });

  it('fails the build rather than showing a syllabus for a board the registry dropped', () => {
    const seed: Seed = {
      last_build: 'now',
      counts: { total: 1, countries: 1 },
      frameworks: [{ id: 'cbse', name: 'CBSE', kind: 'national', country: 'IN', region: null }],
    };
    const orphan = [{ framework_id: 'gone', subject: 'Maths', version: '1', units: [{}] }];
    expect(() => buildPitchBoards(seed, orphan)).toThrow(/not in the registry/);
  });

  it('takes a short name from the registry rather than coining one', () => {
    expect(
      shortName({
        id: 'x',
        name: 'A Very Long Board Name',
        kind: 'state',
        country: 'IN',
        region: null,
        aliases: ['AVLBN'],
      }),
    ).toBe('AVLBN');
    expect(shortName({ id: 'x', name: 'Short', kind: 'state', country: 'IN', region: null })).toBe(
      'Short',
    );
  });

  it('says where a board is in the registry’s own words', () => {
    expect(whereLine({ kind: 'state', country: 'IN', region: 'Telangana' })).toBe(
      'state board · Telangana',
    );
    expect(whereLine({ kind: 'national', country: 'IN', region: null })).toBe(
      'national board · India',
    );
  });
});

describe('a reader types what they call their board', () => {
  it('folds punctuation and case away before it compares', () => {
    expect(fold('  C.B.S.E!  ')).toBe('c b s e');
    expect(nameScore('CBSE', 'cbse')).toBe(0);
    expect(nameScore('CBSE board', 'cbse')).toBe(1);
    expect(nameScore('Board of Secondary Education', 'secondary')).toBe(2);
    expect(nameScore('Indian School Certificate', 'ndian')).toBe(3);
    expect(nameScore('CBSE', 'icse')).toBe(null);
  });

  it('answers an abbreviation, a full name and a place with the same board', () => {
    for (const typed of ['cbse', 'central board of secondary', 'CBSE board']) {
      expect([typed, findBoards(typed)[0]?.id]).toEqual([typed, 'cbse']);
    }
    expect(findBoards('telangana').map((b) => b.where)).toContain('state board · Telangana');
    // an alias the registry carries and the page never prints
    expect(findBoards('ts ssc')[0]?.id).toBe('bse-telangana');
  });

  it('puts the name that answered the query on the row, so the reason is visible', () => {
    const telangana = BOARDS.boards.find((b) => b.id === 'bse-telangana') as PitchBoard;
    // "Telangana SSC" is a registered alias and it STARTS with what was typed, so it beats the
    // full name, where "tel" only starts a word in the middle. The row shows Telangana SSC, marked.
    expect(matchedName(telangana, 'tel')).toBe('Telangana SSC');
    expect(matchedName(telangana, 'ts ssc')).toBe('TS SSC board');
    // no query, or a name that did not match, and the registry's full name stands
    expect(matchedName(telangana, '')).toBe(telangana.name);
    expect(matchedName(telangana, 'qzxwv')).toBe(telangana.name);
    // and it is always a name the registry recognises, never a coinage
    for (const board of BOARDS.boards) {
      expect([board.id, names(board)]).toEqual([
        board.id,
        expect.arrayContaining([matchedName(board, 'board')]),
      ]);
    }
  });

  it('scores a board on every name it answers to, best first', () => {
    const board = BOARDS.boards.find((b) => b.id === 'nios') as PitchBoard;
    expect(boardScore(board, 'nios')).toBe(0);
    expect(boardScore(board, 'open school india')).not.toBeNull();
    expect(boardScore(board, 'qqq')).toBeNull();
  });

  it('rests on the boards whose chapter lists are held, rather than on an empty box', () => {
    expect(findBoards('')).toEqual([...HELD].slice(0, 6));
    expect(findBoards('   ')).toEqual([...HELD].slice(0, 6));
    expect(HELD.every(isHeld)).toBe(true);
  });

  it('returns nothing rather than a guess when the registry has never heard the name', () => {
    expect(findBoards('qzxwv')).toEqual([]);
  });

  it('is stable: the same query returns the same rows in the same order', () => {
    expect(findBoards('board').map((b) => b.id)).toEqual(findBoards('board').map((b) => b.id));
  });
});

describe('nothing the finder says is stronger than what we hold', () => {
  it('promises a chapter list only for a board that has one', () => {
    for (const board of BOARDS.boards) {
      const answer = boardAnswer(board);
      if (isHeld(board)) {
        expect([board.id, answer]).toEqual([
          board.id,
          expect.stringContaining(`The official ${board.year} chapter list`),
        ]);
        expect(board.subjects.length).toBeGreaterThan(0);
        expect(board.year).not.toBeNull();
        expect(statusWord(board)).toBe('Syllabus held');
      } else {
        expect([board.id, answer]).toEqual([
          board.id,
          expect.stringContaining('does not hold the official chapter list'),
        ]);
        // never a dead end: the board we do not hold still gets the door that exists
        expect([board.id, answer]).toEqual([board.id, expect.stringContaining('syllabus')]);
        expect(board.subjects).toEqual([]);
        expect(board.chapters).toBe(0);
        expect(statusWord(board)).toBe('In the list');
      }
    }
  });

  it('gates nobody by class or grade, anywhere in the generated words', () => {
    const shown = BOARDS.boards.flatMap((b) => [b.short, b.name, b.where, boardAnswer(b)]);
    for (const line of [...shown, NO_MATCH, reachLine()]) {
      expect([line, /\bclass(?:es)? \d|\bgrades? \d|\bages? \d/i.test(line)]).toEqual([
        line,
        false,
      ]);
    }
  });

  it('counts the reach from the sources, not from a round number', () => {
    const line = reachLine();
    expect(line).toContain(`${BOARDS.total} boards`);
    expect(line).toContain(`${BOARDS.countries} countries`);
    expect(line).toContain(`${BOARDS.held.chapters} chapters`);
    for (const board of HELD) expect(line).toContain(board.short);
    // the sentence is a fact and then a way in, never an adjective
    expect(line).not.toMatch(
      /comprehensive|complete coverage|every subject on earth|world.?class/i,
    );
  });

  it('writes a list the way a sentence does', () => {
    expect(andList([])).toBe('');
    expect(andList(['one'])).toBe('one');
    expect(andList(['one', 'two'])).toBe('one and two');
    expect(andList(['one', 'two', 'three'])).toBe('one, two and three');
  });
});
