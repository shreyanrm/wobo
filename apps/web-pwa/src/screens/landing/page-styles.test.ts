/**
 * The stylesheet, held to the prototype and to law v5.
 *
 * The strongest assertion here is the first: every declaration block in
 * `design/prototypes/landing-v8.html`'s `<style>` has to appear, character for character, in
 * `LANDING_CSS`. A port that quietly rounds a radius or nudges a clamp is a different page, and the
 * only way to keep that honest over time is to read the source of truth rather than a copy of some
 * of its numbers. The blocks this build deliberately changed are listed in `CHANGED` with the
 * reason, so a change is a decision on the record.
 *
 * The rest is law: white paper in both themes, the one spacing rhythm, no font CDN, no line under
 * 2.5px, nothing leaking out of the page's own root, and §8's rule that no CSS transition may own a
 * property the engine animates.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANDING_CSS, ROOT } from './page-styles';

const PROTOTYPE = readFileSync(
  join(import.meta.dir, '../../../../../design/prototypes/landing-v8.html'),
  'utf8',
);

/** The prototype's own stylesheet, comments stripped. */
const PROTOTYPE_CSS = (PROTOTYPE.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const OURS = LANDING_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost declaration block, normalised so a line break cannot fail the comparison. */
function blocks(css: string): string[] {
  return [...css.matchAll(/\{([^{}]*)\}/g)]
    .map((m) => (m[1] ?? '').replace(/\s+/g, ' ').trim())
    .filter((body) => body.length > 0);
}

/**
 * The prototype blocks this build does not carry verbatim, each with its reason. Everything else
 * must match exactly.
 */
const CHANGED: readonly { body: string; why: string }[] = [
  {
    body: 'scroll-behavior:smooth',
    why: 'a document-level rule. Anchors are eased by the page itself (link.tsx), which also respects a reader who asked for less motion.',
  },
  {
    body: 'margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden',
    why: '`overflow-x: hidden` makes the element a scroll container, and a scroll container that is not the scroller kills `position: sticky` on its children — the whole header. `clip` clips without that side effect, and the margin belongs to the app, not to this page.',
  },
  {
    body: 'display:grid;grid-template-columns:repeat(2,104px);grid-template-rows:repeat(2,104px);gap:8px;padding:8px;border-radius:22px;background:var(--ink);position:relative',
    why: 'the same block plus `border:0;margin:0;min-inline-size:0`, because the puzzle is a `<fieldset>` here — four toggles answering one question are a named group of controls — and a fieldset needs those three resets to lay out like a plain div.',
  },
  {
    body: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px',
    why: "the chip row's own reset: the chips are real buttons here, not spans, so a reader can reach them from the keyboard.",
  },
  {
    body: 'font:500 13px/1 var(--sans);padding:9px 13px;border-radius:999px;background:var(--paper);color:var(--ink-2)',
    why: 'the same chip, as a button: `border:0;cursor:pointer` and a hover tone, so a keyboard reader can reach it.',
  },
  {
    body: 'display:inline-flex;background:var(--paper);border-radius:999px;padding:4px;gap:4px;justify-self:start',
    why: 'the same block plus `border:0;margin:0;min-inline-size:0`, because the climb\u2019s two-way switch is a `<fieldset>` here \u2014 two controls answering one question are a named group, which is the element a screen reader trusts \u2014 and a fieldset needs those three resets to lay out like a plain div.',
  },
  {
    body: 'transform-origin:center;animation:blink 5.5s infinite',
    why: '`@keyframes` names are document-scoped, not sheet-scoped, so a bare `blink` would be claimed by whichever stylesheet loaded last. The animation is identical; the name is `wb-blink`.',
  },
];

describe('the landing stylesheet', () => {
  it('is the prototype, declaration for declaration', () => {
    const mine = new Set(blocks(OURS));
    const excused = new Set(CHANGED.map((entry) => entry.body));
    const drifted = blocks(PROTOTYPE_CSS).filter(
      // The token block is checked declaration by declaration in the next test instead: the two
      // font stacks are ours (self-hosted), so the block can never match as a whole.
      (body) => !body.includes('--sans:') && !mine.has(body) && !excused.has(body),
    );
    expect(drifted).toEqual([]);
  });

  it('carries every token the prototype declares, except the two self-hosted faces', () => {
    const tokens = blocks(PROTOTYPE_CSS).find((body) => body.includes('--sans:')) ?? '';
    expect(tokens).not.toBe('');
    const drifted = tokens
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && !d.startsWith('--sans:') && !d.startsWith('--hand:'))
      .filter((d) => !OURS.includes(d));
    expect(drifted).toEqual([]);
  });

  it('writes down why every changed block changed', () => {
    for (const entry of CHANGED) expect(entry.why.length).toBeGreaterThan(40);
  });

  it('scopes every rule to the page root', () => {
    const selectors = OURS.split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((s) => s.length > 0 && !s.startsWith('@') && !/^\d/.test(s) && !s.includes(':root'));
    const leaking = selectors.filter((s) => !s.includes(`.${ROOT}`));
    expect(leaking).toEqual([]);
  });

  it('carries law v5’s white paper, character for character (DESIGN.md §0)', () => {
    for (const token of [
      '--paper:#FFFFFF',
      '--paper-2:#F6F6F8',
      '--paper-3:#ECECF0',
      '--line:#E4E4EA',
      '--ink:#14142B',
      '--ink-2:#55556B',
      '--ink-3:#8A8A9E',
      '--pig:#2B45FF',
      '--pig-soft:#EDF0FF',
      '--marigold:#FFB629',
      '--rose:#FF6B57',
      '--mint:#12B981',
      '--violet:#7C5CFF',
    ]) {
      expect(LANDING_CSS).toContain(token);
    }
  });

  it('designs night on its own rather than inverting it', () => {
    for (const token of [
      '--paper:#0E0E16',
      '--paper-2:#17171F',
      '--paper-3:#1F1F29',
      '--line:#26262F',
      '--ink:#F4F4F7',
      '--pig:#7C8CFF',
      '--marigold:#FFC85A',
      '--mint:#3DD9A4',
    ]) {
      expect(LANDING_CSS).toContain(token);
    }
    expect(LANDING_CSS).toContain(`[data-theme="dark"] .${ROOT}`);
  });

  it('holds the one spacing rhythm (DESIGN.md §0)', () => {
    // The three clamps come from the prototype, so a rhythm change there is a rhythm change here.
    for (const name of ['--gutter', '--band', '--colgap']) {
      const declared = PROTOTYPE_CSS.match(new RegExp(`\\${name}:[^;]+`))?.[0];
      expect(declared).toBeTruthy();
      expect(LANDING_CSS).toContain(declared as string);
    }
    // A section takes half a band from each side, so two of them never stack two bands of air.
    expect(LANDING_CSS).toContain('padding:calc(var(--band) / 2) 0');
  });

  it('gives every grid child min-width:0, so nothing can push the page sideways', () => {
    expect(LANDING_CSS).toContain(
      `.${ROOT} *,.${ROOT} *::before,.${ROOT} *::after{box-sizing:border-box;min-width:0}`,
    );
    // And the root itself clips rather than scrolls, in both directions of the same rule.
    expect(LANDING_CSS).toContain('overflow-x:clip');
    expect(LANDING_CSS).not.toContain('overflow-x:hidden');
  });

  it('never lets CSS own a property the engine animates (law v5 §8, cause 1)', () => {
    // The magnetic button's inner span, the answer cards, the film's track and the reveals are all
    // written by JavaScript every frame. A transition on any of them is the stutter itself.
    const owned = [
      `.${ROOT} .btn > span{`,
      `.${ROOT} .forms .card{`,
      `.${ROOT} .player .bar .track i{`,
      `.${ROOT} .bubble{`,
    ];
    for (const selector of owned) {
      const start = LANDING_CSS.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      const body = LANDING_CSS.slice(start + selector.length, LANDING_CSS.indexOf('}', start));
      expect(body).not.toContain('transition');
    }
  });

  it('transitions nothing that is scrubbed, anywhere in the sheet', () => {
    // Every `transition:` in the sheet, and the properties it claims. `transform` is allowed only
    // where nothing scrubs it: a hover lift, an underline sweep, a pressed tile.
    const scrubbed = /transition:[^;}]*\b(all|stroke-dashoffset|scale)\b/;
    expect(LANDING_CSS).not.toMatch(scrubbed);
  });

  it('draws no line thinner than 2.5px (DESIGN.md law 2)', () => {
    const widths = [...LANDING_CSS.matchAll(/stroke-width:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(2.5);
  });

  it('reaches no font CDN', () => {
    expect(LANDING_CSS).not.toContain('fonts.googleapis.com');
    expect(LANDING_CSS).not.toContain('fonts.gstatic.com');
    expect(LANDING_CSS).toContain('/fonts/Poppins-700-latin.woff2');
  });

  it('lays the pinned panel and the film out as ordinary content under reduced motion', () => {
    const at = LANDING_CSS.indexOf('@media (prefers-reduced-motion:reduce)');
    expect(at).toBeGreaterThan(-1);
    const still = LANDING_CSS.slice(at);
    expect(still).toContain(`.${ROOT} .forms{height:auto`);
    expect(still).toContain(`.${ROOT} .forms .card{position:relative`);
    expect(still).toContain(`.${ROOT} .bubble{opacity:1`);
  });
});
