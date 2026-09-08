/**
 * SMALL PRINT ON THE FRONT PAGE IS STILL TEXT SOMEBODY HAS TO READ, in both themes.
 *
 * Wave 29's walk (site-6) ran Lighthouse on / and found 34 elements under WCAG AA, and every one
 * of them was the same mistake in a different place: a token that is legible at night painted on
 * white paper by day. `--ink-3` (#8A8A9E) is 3.38:1 on paper and 3.13:1 on paper-2, and it was the
 * colour of every eyebrow, the hero rail's three unselected tabs, the answer-forms nav, the climb
 * switch, the KPI labels in the parent report, the price cards' small print and the footer's
 * tagline. The rose pull-quote (#FF6B57) was 2.59:1 on paper-2, and the report's "on track" tag
 * painted mint on a mint tint at 2.27:1.
 *
 * DESIGN.md §0 names the tokens and no contrast floor, so the fix is not a new palette: it is
 * painting information in `--ink-2` (7.0:1 by day) and keeping `--ink-3` for what is genuinely
 * decorative, and letting the rose and the mint be the HIGHLIGHT behind ink rather than the ink
 * itself, the same device the headline already uses with marigold. This measures the sheet, the
 * way `plans/contrast.test.ts` measures the plans sheet, so it cannot drift back.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANDING_CSS, ROOT } from './page-styles';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const LAW = readFileSync(join(REPO, 'DESIGN.md'), 'utf8');

type Theme = 'light' | 'night';
type Palette = Record<string, string>;

/** The token block for one theme, read off this sheet's own root and its night override. */
function palette(selector: string): Palette {
  const pattern = new RegExp(`${selector}\\{([\\s\\S]*?)\\n\\}`);
  const block = pattern.exec(LANDING_CSS)?.[1] ?? '';
  const out: Palette = {};
  for (const [, name, hex] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[name as string] = (hex as string).toUpperCase();
  }
  return out;
}

const PALETTE: Record<Theme, Palette> = {
  light: palette(`\\.${ROOT}`),
  night: palette(`\\[data-theme="dark"\\] \\.${ROOT}`),
};

// --- the maths -----------------------------------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fore` laid over `back` at `alpha`, which is what a browser actually composites. */
function over(fore: string, back: string, alpha: number): string {
  const f = rgb(fore);
  const b = rgb(back);
  return `#${f
    .map((v, i) => Math.round(alpha * v + (1 - alpha) * (b[i] as number)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/**
 * A colour value from this sheet, resolved to a hex against the ground it is painted on. Handles
 * the four shapes the sheet uses: a token, a `color-mix` toward transparency, a white `rgba` on
 * the dark price card, and a literal.
 */
function resolve(value: string, theme: Theme, ground: string): string {
  const mix = /^color-mix\(in srgb,\s*var\(--([a-z0-9-]+)\) (\d+)%,\s*transparent\)$/.exec(value);
  if (mix) {
    const token = PALETTE[theme][mix[1] as string];
    expect([theme, value, token]).not.toEqual([theme, value, undefined]);
    return over(token as string, ground, Number(mix[2]) / 100);
  }
  const white = /^rgba\(255,\s*255,\s*255,\s*(\.\d+|0?\.\d+|1)\)$/.exec(value);
  if (white) return over('#FFFFFF', ground, Number(white[1]));
  const token = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (token) {
    const hex = PALETTE[theme][token[1] as string];
    expect([theme, value, hex]).not.toEqual([theme, value, undefined]);
    return hex as string;
  }
  if (value === '#fff') return '#FFFFFF';
  expect([value, /^#[0-9A-Fa-f]{6}$/.test(value)]).toEqual([value, true]);
  return value.toUpperCase();
}

// --- the sheet -----------------------------------------------------------------------------------

/** Every `selector{declarations}` in the sheet, media blocks flattened, groups split. */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = (match[2] as string)
      .split(';')
      .map((d) => d.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (const raw of (match[1] as string).split(',')) {
      const selector = raw.replace(/\s+/g, ' ').trim();
      if (!selector || selector.startsWith('@')) continue;
      out.set(selector, [...(out.get(selector) ?? []), ...decls]);
    }
  }
  return out;
}

const SHEET = rules(LANDING_CSS);

/** One declaration off a rule, e.g. `color`. */
function decl(selector: string, property: string): string | null {
  const found = (SHEET.get(`.${ROOT} ${selector}`) ?? []).find((d) =>
    d.startsWith(`${property}:`),
  );
  return found ? found.slice(property.length + 1).trim() : null;
}

/**
 * A ground is a token, or an accent mixed toward transparency OVER a token: the highlight the
 * pull-quote and the report tag now paint behind ink. Where a row names a mix, the rule's own
 * `background` must be that mix, so the table cannot say one thing and the sheet another.
 */
type Ground = string | { token: string; mix: string; pct: number };

/**
 * Every piece of small print in this sheet, with the surface it sits on. A ground is named as
 * the token that paints it, so a card that is repainted moves this table rather than silently
 * dropping the text underneath AA.
 */
const TEXT: { name: string; selector: string; ground: Ground; paint?: string }[] = [
  { name: 'an eyebrow', selector: '.eyebrow', ground: 'paper' },
  { name: 'the line under the hero', selector: '#hero .under', ground: 'paper' },
  { name: "the device's top line", selector: '.device .top', ground: 'paper' },
  { name: 'an unselected rail tab', selector: '.device .rail button', ground: 'paper' },
  { name: 'an answer-forms nav pill', selector: '.formsnav > span', ground: 'paper-2' },
  { name: "the report's head line", selector: '.report .head', ground: 'paper' },
  {
    name: "the report's on-track tag",
    selector: '.report .head .tag',
    ground: { token: 'paper', mix: 'mint', pct: 14 },
  },
  { name: 'a KPI label in the report', selector: '.report .kpi > span', ground: 'paper-2' },
  {
    name: "the report note's emphasis",
    selector: '.report .note em',
    ground: { token: 'paper-2', mix: 'rose', pct: 24 },
  },
  {
    name: "a beat's spoken emphasis",
    selector: '.beat .said em',
    ground: { token: 'paper-2', mix: 'rose', pct: 24 },
  },
  { name: "the subjects stage's who line", selector: '.stage .who > span', ground: 'paper-2' },
  { name: 'the teaching-modes note', selector: '.tmodes-note', ground: 'paper' },
  { name: 'an unpressed climb switch', selector: '.climb .switch button', ground: 'paper' },
  { name: "a price card's amount suffix", selector: '.prices .plan > .pl-amount span', ground: 'paper-2' },
  { name: "a price card's fine print", selector: '.prices .plan > .pl-fine', ground: 'paper-2' },
  { name: "the lead card's name", selector: '.prices .plan.lead > .pl-name', ground: 'ink' },
  { name: "the lead card's tag", selector: '.prices .plan > .pl-name em', ground: 'marigold', paint: 'var(--marigold)' },
  { name: "the lead card's amount", selector: '.prices .plan.lead > .pl-amount', ground: 'ink' },
  { name: "the lead card's amount suffix", selector: '.prices .plan.lead > .pl-amount span', ground: 'ink' },
  { name: "the lead card's blurb", selector: '.prices .plan.lead > .pl-said', ground: 'ink' },
  { name: "the lead card's fine print", selector: '.prices .plan.lead > .pl-fine', ground: 'ink' },
  { name: "the footer's tagline", selector: 'footer', ground: 'paper' },
];

const AA_NORMAL = 4.5;

describe('the palette this is measured against is the law', () => {
  it('reads both themes off the sheet, whole', () => {
    for (const theme of ['light', 'night'] as Theme[]) {
      for (const name of ['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'ink-3', 'rose', 'mint', 'marigold']) {
        expect([theme, name, PALETTE[theme][name]]).not.toEqual([theme, name, undefined]);
      }
    }
  });

  it('and DESIGN.md §0 names the same values, so neither can drift alone', () => {
    const law = LAW.slice(0, LAW.indexOf('### Spacing and responsiveness'));
    for (const theme of ['light', 'night'] as Theme[]) {
      for (const name of ['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'ink-3']) {
        const hex = PALETTE[theme][name] as string;
        expect([theme, name, law.includes(`${name} ${hex}`)]).toEqual([theme, name, true]);
      }
    }
  });
});

describe('every word this sheet paints small clears WCAG AA, in both themes', () => {
  for (const row of TEXT) {
    for (const theme of ['light', 'night'] as Theme[]) {
      it(`${row.name}, ${theme}`, () => {
        const colour = decl(row.selector, 'color');
        expect([row.selector, colour]).not.toEqual([row.selector, null]);
        let ground: string;
        if (typeof row.ground === 'string') {
          ground = PALETTE[theme][row.ground] as string;
          expect([row.ground, ground]).not.toEqual([row.ground, undefined]);
          // a solid ground the rule paints itself (the marigold pill) is the one the table names
          if (row.paint) expect(decl(row.selector, 'background')).toBe(row.paint);
        } else {
          const under = PALETTE[theme][row.ground.token] as string;
          const accent = PALETTE[theme][row.ground.mix] as string;
          expect([row.ground, under, accent]).not.toContain(undefined);
          // the sheet paints the highlight this table says it does
          expect(decl(row.selector, 'background')).toBe(
            `color-mix(in srgb,var(--${row.ground.mix}) ${row.ground.pct}%,transparent)`,
          );
          ground = over(accent, under, row.ground.pct / 100);
        }
        const ink = resolve(colour as string, theme, ground);
        const measured = ratio(ink, ground);
        expect([row.name, theme, ink, Number(measured.toFixed(2)), measured >= AA_NORMAL]).toEqual([
          row.name,
          theme,
          ink,
          Number(measured.toFixed(2)),
          true,
        ]);
      });
    }
  }
});

describe('the grey that fails by day is kept for what is drawn, not what is read', () => {
  it('paints no running text in --ink-3', () => {
    const guilty: string[] = [];
    for (const [selector, decls] of SHEET) {
      if (!decls.includes('color:var(--ink-3)')) continue;
      guilty.push(selector);
    }
    expect(guilty).toEqual([]);
  });
});
