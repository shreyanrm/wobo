/**
 * THE FORGE IS REACHABLE (learn-3), AND THE PRACTICE DOOR KEEPS ITS RUN (learn-4).
 *
 * `ForgeBuilder` and `ForgeRun` shipped with a store, a queue in the download centre and a key on
 * SCOPED_KEYS, and nothing imported either of them: the bindery could not be opened from any screen,
 * so `wobo-forged-v1` could never gain a row. ProgressScreen.tsx's docblock records the same defect
 * paid for once already. A unit test of the builder cannot see whether a learner can reach it, so
 * this reads the wiring the way progress/mounted.test.ts does: each line is a fact about a file.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..');
const PRACTICE = readFileSync(join(SRC, 'screens', 'Practice.tsx'), 'utf8');

describe('a learner can open the forge from the practice door', () => {
  it('the practice screen mounts the bindery and the workbook runner', () => {
    expect(PRACTICE).toContain("from './practice/ForgeBuilder'");
    expect(PRACTICE).toContain("from './practice/ForgeRun'");
    expect(PRACTICE).toContain('<ForgeBuilder');
    expect(PRACTICE).toContain('<ForgeRun');
  });

  it('the shelf is drawn from the store, so a bound workbook has somewhere to land', () => {
    expect(PRACTICE).toContain('useForged()');
  });
});

describe('the practice door keeps what was done on it', () => {
  it('reads its run from the store on mount and writes it on every change', () => {
    expect(PRACTICE).toContain('readRun(');
    expect(PRACTICE).toContain('writeRun(');
  });

  it('a correct check reaches the account, once per item', () => {
    expect(PRACTICE).toMatch(/award\('item',\s*\{\s*onceKey: practiceOnceKey\(/);
  });
});
