/**
 * SMALL PRINT IS STILL TEXT SOMEBODY HAS TO READ, in both themes.
 *
 * Four rules in this one small sheet failed WCAG AA, and every one of them failed in a way a
 * declaration-for-declaration port could not catch, because each declaration was individually
 * plausible:
 *
 *  · `.pl-plan .pl-billed` was ported at `--ink-3` where the prototype has `--ink-2`. 13px at
 *    weight 400 on `--paper-2` measures 3.13:1 by day. This is the line the whole period control
 *    exists to keep on the card, so it is the one line on it that must not be a light-mode grey.
 *  · `.pl-per[data-period="monthly"] .pl-save` dimmed live text to `opacity:.42`, taking "two
 *    months free" to 2.68:1 by day and 3.42:1 at night. It is not aria-hidden and it is not
 *    removed, so it is information, not an inactive component.
 *  · `.pl-plan.pl-max .pl-billed` mixed 55% of `--paper` into transparency, on a card painted
 *    `--ink`. The two tokens SWAP between themes, so that card is dark by day and light at night
 *    and one mix cannot serve both: it measured 4.11:1 on the night card. The prototype's own
 *    comment, "the Max card is dark in both themes", was wrong about the prototype too.
 *
 * So the sheet is measured rather than reviewed. The palette is read from the prototype this sheet
 * was ported from, and the seven law-v5 names in it are cross-checked against DESIGN.md §0, so
 * neither the test nor the prototype can drift from the law without failing here.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLANS_CSS } from './styles';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO = readFileSync(join(REPO, 'design', 'prototypes', 'site-plans.html'), 'utf8');
const LAW = readFileSync(join(REPO, 'DESIGN.md'), 'utf8');

type Theme = 'light' | 'night';
type Palette = Record<string, string>;

/** The token block for one theme, read off the prototype's own `:root` / `[data-theme="dark"]`. */
function palette(selector: string): Palette {
  const block = new RegExp(`${selector}\\{([\\s\\S]*?)\\n\\}`).exec(PROTO)?.[1] ?? '';
  const out: Palette = {};
  for (const [, name, hex] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[name as string] = (hex as string).toUpperCase();
  }
  return out;
}

const PALETTE: Record<Theme, Palette> = {
  light: palette(':root'),
  night: palette('\\[data-theme="dark"\\]'),
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
 * the three shapes the sheet uses: a token, a `color-mix` toward transparency, and a literal.
 */
function resolve(value: string, theme: Theme, ground: string): string {
  const mix = /^color-mix\(in srgb,var\(--([a-z0-9-]+)\) (\d+)%,transparent\)$/.exec(value);
  if (mix) {
    const token = PALETTE[theme][mix[1] as string];
    expect([theme, value, token]).not.toEqual([theme, value, undefined]);
    return over(token as string, ground, Number(mix[2]) / 100);
  }
  const token = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (token) {
    const hex = PALETTE[theme][token[1] as string];
    expect([theme, value, hex]).not.toEqual([theme, value, undefined]);
    return hex as string;
  }
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

const SHEET = rules(PLANS_CSS);

/** One declaration off a rule, e.g. `color`. */
function decl(selector: string, property: string): string | null {
  const found = (SHEET.get(selector) ?? []).find((d) => d.startsWith(`${property}:`));
  return found ? found.slice(property.length + 1).trim() : null;
}

/**
 * Every piece of small print in this sheet, with the surface it sits on. A ground is named as the
 * token that paints it, so a card that is repainted moves this table rather than silently dropping
 * the text underneath AA.
 */
const TEXT: { name: string; selector: string; ground: string }[] = [
  // the plan cards are `--paper-2`; the Max card is `--ink`, which is dark by day and light at night
  { name: 'billed line on a plan card', selector: '.pl-plan .pl-billed', ground: 'paper-2' },
  { name: 'billed line on the Max card', selector: '.pl-plan.pl-max .pl-billed', ground: 'ink' },
  { name: 'the saving pill', selector: '.pl-save', ground: 'marigold-w' },
  {
    name: 'the saving pill on the monthly period',
    selector: '.pl-per[data-period="monthly"] .pl-save',
    ground: 'paper-3',
  },
  // the segment control's track is `--paper-2`; the chosen segment sits on the `--ink` indicator
  { name: 'an unchosen segment', selector: '.pl-seg>button', ground: 'paper-2' },
  {
    name: 'the chosen segment',
    selector: '.pl-seg>button[aria-pressed="true"]',
    ground: 'ink',
  },
  // the sentence under the cards is on the page's own ground
  { name: 'the line that closes the cards', selector: '.pl-close-line', ground: 'paper' },
  // the soon marker on the payment door
  { name: 'the soon marker', selector: '.pl-checkout .pl-soon', ground: 'marigold-w' },
];

const AA_NORMAL = 4.5;

describe('the palette this is measured against is the law', () => {
  it('reads both themes off the prototype, whole', () => {
    for (const theme of ['light', 'night'] as Theme[]) {
      for (const name of ['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'ink-3', 'marigold-w']) {
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

describe('every word this sheet paints clears WCAG AA, in both themes', () => {
  for (const row of TEXT) {
    for (const theme of ['light', 'night'] as Theme[]) {
      it(`${row.name}, ${theme}`, () => {
        const colour = decl(row.selector, 'color');
        expect([row.selector, colour]).not.toEqual([row.selector, null]);
        const ground = PALETTE[theme][row.ground];
        expect([row.ground, ground]).not.toEqual([row.ground, undefined]);
        const ink = resolve(colour as string, theme, ground as string);
        const measured = ratio(ink, ground as string);
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

describe('nothing in this sheet dims text instead of removing it', () => {
  it('sets no opacity on a rule that paints or inherits words', () => {
    // The bug: "two months free" kept its colour tokens and lost its contrast to `opacity:.42`,
    // so a claim that the sheet was "correct in both themes without a dark override" was true of
    // the tokens and false of the pixels. A period that does not apply loses the highlighter; it
    // does not become 42% of a sentence.
    for (const [selector, decls] of SHEET) {
      for (const d of decls) {
        const opacity = /^opacity:([\d.]+)$/.exec(d);
        if (!opacity) continue;
        // `.pl-pill` is the indicator behind the segments: a painted shape with no text in it.
        expect([selector, d, selector === '.pl-seg .pl-pill']).toEqual([selector, d, true]);
      }
    }
  });
});
