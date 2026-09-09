/**
 * EVERY DIRECTION NAMES A DOOR THAT EXISTS.
 *
 * The app has four doors, Home, Learn, Practice and You (`ui/primitives/AppShell.tsx`), and
 * "Settings" is a card on the You screen, not a screen. `you/plan.test.ts` stamped "Settings →
 * Your plan" out of the plans page, one help article, the cancellation document and three emails,
 * and its guard is a regex that needs the words "your plan" to follow. Wave 29's walk (site-2,
 * site-3) then found the same container named, without those words, on the plans page's own
 * consent box ("cancel in Settings, in two taps"), in eight help articles ("Settings, then
 * account", "Settings, your data", "Settings, then the parent link", "Settings, then your board"),
 * on the security page ("You, in Settings"; "Settings → Your data") and in the terms and the
 * cookies document. A payer who ticks the box and goes looking for Settings finds nothing.
 *
 * This walks every public surface a reader can be sent from, the compiled help centre included,
 * and refuses "Settings" wherever it is used as a place to go rather than as the name of the card.
 * Comments are where a law is explained, so they are stripped before a source is read.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HELP } from './help-content';

const SRC = join(import.meta.dir, '..', '..');
const REPO = join(SRC, '..', '..', '..');

function shipped(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

const doc = (...parts: string[]) => readFileSync(join(REPO, 'docs', ...parts), 'utf8');

/** Every string in a JSON tree, which for the help centre is every sentence a reader sees. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
  return out;
}

/** Every Markdown file under a folder, so a new article is walked the day it is written. */
function markdown(dir: string): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...markdown(path));
    else if (entry.endsWith('.md'))
      out.push([path.slice(REPO.length + 1), readFileSync(path, 'utf8')]);
  }
  return out;
}

/**
 * "Settings" as a place: a sentence that OPENS on it and goes on with a comma, an arrow, "then",
 * or something it owns ("Settings has a memory page"), or a place reached with "in" or "from". The
 * card's own name is not a direction and is left alone: "# Settings", "Related: Settings.", and
 * "Open You, the last of the four doors. Under Settings, Your data", which names the door first.
 */
const AS_A_PLACE =
  /(?:^|[.!?:]\s+|['"“(])Settings\b\s*(?:,|→|>|then\b|has\b)|\b(?:in|from) [Ss]ettings\b/;

const SURFACES: [string, string][] = [
  ['plans/copy.ts', shipped('screens', 'plans', 'copy.ts')],
  ['pitch/Security.tsx', shipped('screens', 'pitch', 'Security.tsx')],
  ['legal/terms-of-service.md', doc('legal', 'terms-of-service.md')],
  ['legal/cookies.md', doc('legal', 'cookies.md')],
  ...markdown(join(REPO, 'docs', 'copy', 'help-centre')),
];

describe('no surface sends a reader to a Settings screen', () => {
  for (const [name, source] of SURFACES) {
    it(`${name} names no such door`, () => {
      const lines = source
        .split('\n')
        .map((line, i) => [i + 1, line.trim()] as const)
        .filter(([, line]) => AS_A_PLACE.test(line))
        .map(([n, line]) => `${n}: ${line.slice(0, 120)}`);
      expect(lines).toEqual([]);
    });
  }

  it('and the compiled help centre agrees with its source', () => {
    const guilty = strings(HELP).filter((s) => AS_A_PLACE.test(s));
    expect(guilty.map((s) => s.slice(0, 120))).toEqual([]);
  });
});

describe('the directions that replaced it name the door the product has', () => {
  it('the plans page tells a payer they cancel from You', () => {
    const copy = shipped('screens', 'plans', 'copy.ts');
    expect(copy).toContain('You → Your plan → Cancel');
    expect(copy).toMatch(/cancel[^.]*from You/);
  });

  it('the security page points the erase at You', () => {
    const page = shipped('screens', 'pitch', 'Security.tsx');
    expect(page).toContain('You → Settings → Your data');
  });

  it('the help centre opens every walk from the You door', () => {
    const text = strings(HELP).join('\n');
    for (const line of [
      'Open You, the last of the four doors',
      'Under Settings, Your data',
      'the card called Parents',
    ]) {
      expect([line, text.includes(line)]).toEqual([line, true]);
    }
  });
});
