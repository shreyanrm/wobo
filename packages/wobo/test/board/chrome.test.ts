/**
 * The board's chrome, held to DESIGN.md.
 *
 * The law the board kept breaking was not a colour: it was the 0.5px rules it drew around every
 * frame, the 3px corners, and the 1.5px strokes on things a finger has to find. This reads the
 * chrome stylesheet as rules — and the chrome sources as text — and refuses all three.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOARD_CHROME_CSS } from '../../src/board/chrome';

const SRC = join(import.meta.dir, '..', '..', 'src', 'board');
const read = (name: string): string => readFileSync(join(SRC, name), 'utf8');

/** Every `selector{declarations}` in a stylesheet, comments dropped. */
function rules(css: string): [string, string[]][] {
  const out: [string, string[]][] = [];
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).replace(/\s+/g, ' ').trim();
    const decls = (m[2] as string)
      .split(';')
      .map((d) => d.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (selector) out.push([selector, decls]);
  }
  return out;
}

const chrome = rules(BOARD_CHROME_CSS);
const decl = (selector: string): string[] =>
  chrome.find(([s]) => s === selector)?.[1] ?? [`no rule for ${selector}`];

/** The files that draw the chrome. Everything a learner sees around the ink lives in these. */
const CHROME_FILES = ['chrome.tsx', 'fullboard.tsx', 'plane.tsx'] as const;

describe('no border lines anywhere in the chrome', () => {
  it('the stylesheet never draws a rule — a surface is told apart by tone', () => {
    for (const [selector, decls] of chrome) {
      for (const d of decls) {
        // a focus ring is an outline and is meant to be seen; a border is a line and is not
        if (!/^border(-top|-right|-bottom|-left)?:/.test(d)) continue;
        expect(d, `${selector} { ${d} }`).toMatch(
          /^border(-top|-right|-bottom|-left)?:\s*(0|none)$/,
        );
      }
    }
  });

  it('no chrome source hands a border to an inline style either', () => {
    for (const file of CHROME_FILES) {
      const src = read(file);
      expect(src, file).not.toMatch(/border(Top|Right|Bottom|Left)?:\s*`?\d*\.?\d+px/);
      expect(src, file).not.toMatch(/hairline/);
    }
  });
});

describe('corners are 10, 16 or 24 — never 3', () => {
  const ALLOWED = new Set(['0', '10px', '16px', '24px', '999px', '50%']);

  it('every radius in the stylesheet is one the law names', () => {
    for (const [selector, decls] of chrome) {
      for (const d of decls) {
        if (!d.startsWith('border-radius:')) continue;
        const value = d.slice('border-radius:'.length).trim();
        for (const part of value.split(/\s+/)) {
          expect(ALLOWED.has(part), `${selector} { ${d} }`).toBe(true);
        }
      }
    }
  });

  it('no chrome source sets a radius under 10 inline', () => {
    for (const file of CHROME_FILES) {
      const src = read(file);
      for (const m of src.matchAll(/borderRadius:\s*(\d+)/g)) {
        expect(Number(m[1]), `${file}: borderRadius ${m[1]}`).toBeGreaterThanOrEqual(10);
      }
      // `radius.sm` is the old 3px token; the chrome must not reach for it at all
      expect(src, file).not.toMatch(/\bradius\.(sm|md)\b/);
    }
  });
});

describe('ink is 3–4px and never under 2.5', () => {
  it('the chrome stylesheet has no stroke or outline thinner than 2.5px', () => {
    for (const [selector, decls] of chrome) {
      for (const d of decls) {
        for (const m of d.matchAll(/(?:stroke-width|outline):\s*(\d*\.?\d+)px/g)) {
          expect(Number(m[1]), `${selector} { ${d} }`).toBeGreaterThanOrEqual(2.5);
        }
      }
    }
  });

  it('the surface stylesheet draws its focus ring in ink, not a hairline', () => {
    const surface = rules(read('renderer.tsx'));
    const hit = surface.find(([s]) => s.includes('.wobo-hit:focus-visible'))?.[1] ?? [];
    const width = hit.find((d) => d.startsWith('stroke-width:'));
    expect(width).toBeDefined();
    expect(Number((width as string).replace('stroke-width:', ''))).toBeGreaterThanOrEqual(2.5);
  });

  it('the nib itself is 3px, the same number on both themes', () => {
    // ONE number: the geometry owns it (a mark has to know how fat the pen is to stay off the
    // words it names) and the renderer paints with the same constant, never a copy of it.
    expect(read('geometry.ts')).toContain('export const NIB_PX = 3;');
    const src = read('renderer.tsx');
    expect(src).toContain('const NIB_PX = GEOMETRY_NIB_PX;');
    expect(src).not.toMatch(/const NIB_PX = \d/);
    expect(src).toContain('--wobo-nib:3;');
    expect(src).not.toContain('--wobo-nib:2.6');
  });

  it('a graph draws its axes at 3.5px and its grid at 2.5px', () => {
    const src = read('geometry.ts');
    expect(src).toContain('const AXIS_INK = 3.5 / NIB_PX;');
    expect(src).toContain('const GRID_INK = 2.5 / NIB_PX;');
    // the grid is chrome, so it reads ink-3 rather than fighting the curve on top of it
    expect(read('renderer.tsx')).toContain("{ grid: 'faint' }");
  });
});

describe('the scrubber is the Practice progress bar', () => {
  it('a 12px round track', () => {
    const track = decl('.wobo-chrome-track');
    expect(track).toContain('height:12px');
    expect(track).toContain('border-radius:999px');
  });

  it('filled marigold, round', () => {
    const fill = decl('.wobo-chrome-fill');
    expect(fill.join(' ')).toContain('background:var(--marigold');
    expect(fill).toContain('border-radius:999px');
  });

  it('the range that drives it is real, and clears the 44px tap floor', () => {
    expect(decl('.wobo-chrome-scrub')).toContain('height:44px');
    expect(read('chrome.tsx')).toContain('type="range"');
  });
});

describe('replay and share are the kit’s quiet button', () => {
  it('10px corners, no border, one tonal step off the bar it sits on', () => {
    const btn = decl('.wobo-chrome-btn');
    expect(btn).toContain('border:0');
    expect(btn).toContain('border-radius:10px');
    expect(btn.join(' ')).toContain('background:var(--paper');
    expect(decl('.wobo-chrome-bar').join(' ')).toContain('background:var(--paper-2');
  });

  it('and clears the 44px tap floor', () => {
    expect(decl('.wobo-chrome-btn')).toContain('min-height:44px');
    // the plane's title IS the drag handle — a control, and the only one that was under the floor
    expect(decl('.wobo-chrome-title')).toContain('min-height:44px');
  });
});

describe('night reads the same tokens', () => {
  it('the chrome stylesheet has no theme-specific rule of its own', () => {
    expect(BOARD_CHROME_CSS).not.toContain('data-theme');
    expect(BOARD_CHROME_CSS).not.toContain('prefers-color-scheme');
  });

  it('and no literal hex outside a var() fallback', () => {
    for (const [selector, decls] of chrome) {
      for (const d of decls) {
        for (const m of d.matchAll(/#[0-9A-Fa-f]{3,8}/g)) {
          const at = d.indexOf(m[0]);
          expect(d.slice(0, at), `${selector} { ${d} }`).toContain('var(--');
        }
      }
    }
  });
});
