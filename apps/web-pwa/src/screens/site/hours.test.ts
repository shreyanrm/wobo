/**
 * The clock law (DESIGN.md section 0, owner 2026-09-04, corrected twice).
 *
 * No public surface may picture a child studying late. Not "10pm", not "tonight", not "midnight",
 * not "when everyone is asleep". Children go to bed early, the parents we sell to do not want a
 * product that keeps them up, and a page that names a late hour is describing the problem rather
 * than the answer. What those lines were always reaching for is availability and choice, and the
 * vocabulary for that is not scarce: after school, over the weekend, on a holiday, between classes,
 * on the way home, whenever they want, wherever they are, the way they want it explained.
 *
 * This test exists because the rule was broken twice after being given. A law that depends on
 * remembering is not a law.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

/** The public surfaces. Behind the door a late hour may legitimately appear (a clock, a reminder). */
const PUBLIC_DIRS = ['screens/landing', 'screens/site', 'screens/pitch', 'screens/plans', 'screens/gift', 'screens/donate', 'screens/contact'];

/** Each pattern with the phrase that replaces it, so a failure teaches rather than only refusing. */
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(9|10|11|12)\s?(pm|p\.m\.)/i, 'say "after school", "over the weekend" or "whenever they want"'],
  [/\btonight\b/i, 'say "this evening" only if a time is needed at all'],
  [/\bmidnight\b/i, 'say "after hours", or drop the hour entirely'],
  [/\blate at night\b/i, 'say "whenever they want, wherever they are"'],
  [/\bwhen everyone (else )?is asleep\b/i, 'say "on their own time"'],
  [/\bthe night before (the |an )?exam/i, 'we are not a cramming tool: say "a bit at a time, so the exam is revision"'],
];

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out = out.concat(filesUnder(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments carry the reasoning and often quote the banned phrase to explain it. Only copy counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the clock law', () => {
  const files = PUBLIC_DIRS.flatMap((d) => filesUnder(join(ROOT, d)));

  it('has public surfaces to check', () => {
    expect(files.length > 0).toBe(true);
  });

  for (const [pattern, instead] of BANNED) {
    it(`never names ${pattern.source} on a public page`, () => {
      const guilty: string[] = [];
      for (const file of files) {
        const body = stripComments(readFileSync(file, 'utf8'));
        const hit = body.match(pattern);
        if (hit) guilty.push(`${file.slice(ROOT.length)}: "${hit[0]}" — ${instead}`);
      }
      expect(guilty).toEqual([]);
    });
  }
});
