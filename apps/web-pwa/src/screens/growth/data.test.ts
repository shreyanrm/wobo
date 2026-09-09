/**
 * THE COMPILED DATA CANNOT DRIFT FROM THE SYLLABUS IT CLAIMS TO DESCRIBE.
 *
 * `data/glossary.json` and `data/boards.json` are committed so a clone type-checks and tests
 * without running a build. That convenience is also the risk: a syllabus corrected in
 * `content/curriculum/syllabi/**` and a data file nobody regenerated would leave a hundred public
 * pages citing a page number and a hash that no longer match the document, which is the one
 * failure this whole family is built to be incapable of.
 *
 * So this test re-runs the compiler and compares. It compares the DATA rather than the bytes, which
 * is what lets the emitted files be run through the repo formatter after the compiler writes them
 * without the comparison becoming a lie about whitespace. It is skipped, loudly, where python3 is
 * not on the path, because a machine without it must not silently pass a check it did not run.
 *
 * It also holds the two files to the counts published in docs/GROWTH-SEARCH.md §3, which is the
 * honest-count law working in the direction that matters: the document quotes the code, and if the
 * code changes, the document is what has to be corrected.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const TOOLS = join(REPO, 'content', 'curriculum', 'syllabi', 'tools');
const HERE = join(import.meta.dir, 'data');

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const havePython = python.status === 0;

/** Run the compiler in memory and read back what it would have written to disk. */
function rebuild(): { glossary: unknown; boards: unknown } {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
    'import build_growth_data as b',
    'g, s = b.build()',
    'print(json.dumps({"glossary": g, "boards": s}))',
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`the compiler failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as { glossary: unknown; boards: unknown };
}

const committed = {
  glossary: JSON.parse(readFileSync(join(HERE, 'glossary.json'), 'utf8')) as Record<
    string,
    unknown
  >,
  boards: JSON.parse(readFileSync(join(HERE, 'boards.json'), 'utf8')) as Record<string, unknown>,
};

describe('the committed data is the syllabus', () => {
  it.skipIf(!havePython)('matches what the compiler produces from the seed today', () => {
    const fresh = rebuild() as {
      glossary: Record<string, unknown>;
      boards: Record<string, unknown>;
    };
    // `note` is the only field the file adds on the way to disk, and it is identical either side.
    expect(fresh.glossary.concepts).toEqual(committed.glossary.concepts);
    expect(fresh.glossary.documents).toEqual(committed.glossary.documents);
    expect(fresh.glossary.boards).toEqual(committed.glossary.boards);
    expect(fresh.boards.boards).toEqual(committed.boards.boards);
    expect(fresh.boards.documents).toEqual(committed.boards.documents);
  });

  it('says on its face that it is compiled and must not be edited by hand', () => {
    expect(String(committed.glossary.note)).toContain('build_growth_data.py');
    expect(String(committed.boards.note)).toContain('Do not edit by hand');
  });
});

describe('the counts we publish are the counts we can prove', () => {
  const boards = committed.boards.boards as { id: string; chapters: number; topics: number }[];

  /** The numbers in docs/GROWTH-SEARCH.md §3, asserted against the shipped seed. */
  it('holds four boards, 333 chapters and 711 topics', () => {
    expect(boards.map((b) => b.id).sort()).toEqual(['cbse', 'icse', 'isc', 'nios']);
    expect(boards.reduce((n, b) => n + b.chapters, 0)).toBe(333);
    expect(boards.reduce((n, b) => n + b.topics, 0)).toBe(711);
  });

  /** The honest limit that must stay honest: ICSE and ISC publish no topic layer. */
  it('gives ICSE and ISC no topics, and invents none', () => {
    for (const id of ['icse', 'isc']) {
      const board = boards.find((b) => b.id === id);
      expect([id, board?.topics]).toEqual([id, 0]);
    }
  });

  it('lets no board into the file without a chapter under it', () => {
    for (const board of boards) expect([board.id, board.chapters > 0]).toEqual([board.id, true]);
  });
});
