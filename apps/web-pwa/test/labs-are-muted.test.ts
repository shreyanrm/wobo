import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY LAB IS MUTED (the owner, 2026-09-09).
 *
 * *"An agent's headless browser plays through the owner's speakers and did so today while he was
 * working. Launch every browser with audio off."* The main config carried `--mute-audio` from the
 * day the law was written. The other three did not: `tests/doubt.config.ts` (the read-aloud
 * solver's own suite, the one most likely to speak), `tests/x-browser.config.ts` and
 * `tests/palette.config.ts` each declare their own `use:` block and their own projects, inherit
 * nothing from the main config, and launched Chromium with its speakers live.
 *
 * A config is a file anyone can add, so this test does not name the four: it finds every
 * Playwright config in the app and requires the flag of each. A new lab is muted or it is red.
 */
const APP = join(import.meta.dir, '..');

function configs(): string[] {
  const here = readdirSync(APP).filter((f) => /^playwright.*\.config\.ts$/.test(f));
  const inTests = readdirSync(join(APP, 'tests'))
    .filter((f) => f.endsWith('.config.ts'))
    .map((f) => join('tests', f));
  return [...here, ...inTests];
}

describe('every browser a lab launches starts with its audio off', () => {
  const found = configs();

  it('finds every Playwright config in the app', () => {
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found).toContain('tests/doubt.config.ts');
  });

  for (const rel of found) {
    it(`${rel} launches muted`, () => {
      const source = readFileSync(join(APP, rel), 'utf8');
      expect(source).toContain('--mute-audio');
    });
  }
});
