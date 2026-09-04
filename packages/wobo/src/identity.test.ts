import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIG_CSS, RIG_DARK, RIG_LIGHT } from './body/palette';
import { WOBO_BLUE, WOBO_BLUE_NIGHT, WOBO_IDENTITY, WOBO_TONES, type WoboMood } from './identity';

/**
 * Wobo's identity is law (DESIGN.md §4), and law that only lives in prose drifts. This file is the
 * lock: the palette-v4 tones are asserted literally against DESIGN.md §2/§4, the rig is asserted to
 * read its default colours from here rather than restating them, and the retired jelly-orb
 * vocabulary — the molten body, the squircle, the flame, and the warm hexes they were drawn in — is
 * banned from every source file in the package.
 *
 * Every assertion below fails on the pre-palette-v4 identity module, which exported a
 * `round_squircle_jelly` form in a `molten` family coloured `#FF5A1F`, plus a `MOLTEN` ramp and a
 * `FlameState` union. That is the regression this file exists to prevent.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * The retired vocabulary. Deliberately NOT including "orb": DESIGN.md §4 still calls docked Wobo
 * the orb, so banning the word would ban the shipped name for a real thing.
 */
const RETIRED_WORDS = ['jelly', 'squircle', 'molten', 'flame', 'ember'];

/** The warm hexes palette v4 retired — Wobo's old body ramp and the face it carried. */
const RETIRED_HEXES = ['#FF5A1F', '#FF9E62', '#D63E07', '#F0619B', '#D8437F', '#FFC93C', '#2A1510'];

/** Every `.ts`/`.tsx` source file in the package, tests excluded — the ban binds shipped code. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

/**
 * Strip comments and doc blocks. The ban is on what the code DOES, so a lock file is still free to
 * write down, in prose, the vocabulary it retired — which is exactly what `identity.ts` does.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe("Wobo's identity lock", () => {
  it('is the ink-visor wobot — no jelly body, no molten family, no flame', () => {
    expect(WOBO_IDENTITY.form).toBe('ink_visor_wobot');
    expect(WOBO_IDENTITY.colorFamily).toBe('ink_visor');
    expect(WOBO_IDENTITY.visor).toBe('always');
    expect(WOBO_IDENTITY.pen).toBe('always');
    expect(WOBO_IDENTITY.hairline).toBe('always');
    expect(WOBO_IDENTITY.eyes).toBe(2);
    // The retired keys are gone from the frozen record, not merely unused.
    const keys = Object.keys(WOBO_IDENTITY);
    expect(keys).not.toContain('flame');
    expect(keys).not.toContain('glow');
  });

  it('is frozen, so no page can redress Wobo at runtime', () => {
    expect(Object.isFrozen(WOBO_IDENTITY)).toBe(true);
    expect(Object.isFrozen(WOBO_TONES)).toBe(true);
    expect(Object.isFrozen(WOBO_TONES.light)).toBe(true);
    expect(Object.isFrozen(WOBO_TONES.dark)).toBe(true);
  });

  it('carries palette v4 exactly as DESIGN.md §2/§4 writes it', () => {
    expect(WOBO_TONES.light.body).toBe('#14142B');
    expect(WOBO_TONES.light.visor).toBe('#FFFFFF');
    expect(WOBO_TONES.light.eye).toBe('#2B45FF');
    expect(WOBO_TONES.dark.body).toBe('#F4F4F7');
    expect(WOBO_TONES.dark.visor).toBe('#0E0E16');
    expect(WOBO_TONES.dark.eye).toBe('#7C8CFF');
    expect(WOBO_BLUE).toBe('#2B45FF');
    expect(WOBO_BLUE_NIGHT).toBe('#7C8CFF');
    expect(WOBO_IDENTITY.color).toBe(WOBO_BLUE);
  });

  it('swaps the body and visor tones between the two grounds, never repeating one', () => {
    // The visor is always the tone the body is not — that is what keeps the eyes readable.
    expect(WOBO_TONES.light.visor).not.toBe(WOBO_TONES.light.body);
    expect(WOBO_TONES.dark.visor).not.toBe(WOBO_TONES.dark.body);
    // Light's body is night's visor family and vice versa: ink on cream, cream on night.
    expect(WOBO_TONES.light.body.toUpperCase()).not.toBe(WOBO_TONES.dark.body.toUpperCase());
    for (const tones of [WOBO_TONES.light, WOBO_TONES.dark]) {
      expect(tones.hairline.startsWith('rgba(')).toBe(true);
    }
  });

  it("is the source of the rig's default colours — the rig restates nothing", () => {
    expect(RIG_LIGHT).toBe(WOBO_TONES.light);
    expect(RIG_DARK).toBe(WOBO_TONES.dark);
    expect(RIG_CSS).toContain(`--wr-body:${WOBO_TONES.light.body}`);
    expect(RIG_CSS).toContain(`--wr-eye:${WOBO_TONES.light.eye}`);
    expect(RIG_CSS).toContain(`--wr-body:${WOBO_TONES.dark.body}`);
    expect(RIG_CSS).toContain(`--wr-eye:${WOBO_TONES.dark.eye}`);
  });

  it('keeps the moods the pages already cue, since choreography is the free surface', () => {
    const moods: WoboMood[] = [
      'idle',
      'thinking',
      'listening',
      'correct',
      'celebrate',
      'waiting',
      'hint',
      'explaining',
      'resting',
      'oops',
    ];
    expect(moods).toHaveLength(10);
  });
});

describe('the retired jelly-orb vocabulary', () => {
  const files = sources(SRC);

  it('finds sources to police at all', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('is gone from every hex in the package', () => {
    for (const file of files) {
      const body = readFileSync(file, 'utf8');
      for (const hex of RETIRED_HEXES) {
        expect(`${file}: ${body.toUpperCase().includes(hex) ? hex : 'clean'}`).toBe(
          `${file}: clean`,
        );
      }
    }
  });

  it('is gone from every identifier and string in the package', () => {
    for (const file of files) {
      const body = code(readFileSync(file, 'utf8')).toLowerCase();
      for (const word of RETIRED_WORDS) {
        // Anchored at the start of a word so `remember` is not an ember and `assemble` is not one
        // either, but `flameForMood` and `MOLTEN` still are.
        const found = new RegExp(`(^|[^a-z])${word}`).test(body);
        expect(`${file}: ${found ? word : 'clean'}`).toBe(`${file}: clean`);
      }
    }
  });

  it('leaves nothing importing the old molten token out of @wobo/config', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toContain('woboMolten');
    }
  });
});

describe('Wobo has no gender (WOBO-PLAN.md §19)', () => {
  /** Whole words only, so "his" never matches "history" and "her" never matches "there". */
  const GENDERED = /\b(he|him|his|she|her|hers|boy|boys|girl|girls|man|woman|male|female)\b/i;

  it('is not signalled anywhere in the identity lock or the rig it drives', () => {
    for (const file of [join(SRC, 'identity.ts'), ...sources(join(SRC, 'body'))]) {
      const body = readFileSync(file, 'utf8');
      // The one sanctioned mention is the law itself, which says Wobo is neither.
      const lines = body
        .split('\n')
        .filter((line) => GENDERED.test(line) && !/no gender|a boy or a girl/.test(line));
      expect(`${file}: ${lines.join(' | ') || 'clean'}`).toBe(`${file}: clean`);
    }
  });
});
