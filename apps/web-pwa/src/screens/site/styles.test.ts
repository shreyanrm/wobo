/**
 * The site sheet is a port of the site prototypes (design/prototypes/site-plans.html for the shell
 * and the plans page, site-about.html for the ask block and the about page), rule for rule. This
 * holds every ported rule to its source — the same declarations, the same values, the same order —
 * and holds the whole sheet to the laws: no border lines, no corner under 10px, every colour a
 * token, reduced motion respected.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_CSS } from './styles';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO_DIR = join(REPO, 'design', 'prototypes');

/** The stylesheet of a prototype page. */
function sheet(file: string): string {
  const html = readFileSync(join(PROTO_DIR, file), 'utf8');
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
}

/**
 * The one spelling the sheet changes: the prototypes tint text on an ink panel with cream at N%,
 * which vanishes at night when the panel itself is cream. The sheet writes the same tint as a mix
 * of the page's paper, so both spellings are read as one here.
 */
function normalise(decl: string): string {
  return decl.replace(
    /rgba\((?:250,247,240|255,255,255),\.(\d+)\)/g,
    (_m, n: string) => `color-mix(in srgb,var(--paper) ${Number(`0.${n}`) * 100}%,transparent)`,
  );
}

/** Every `selector{declarations}` in a stylesheet, media blocks flattened, groups split. */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = (m[2] as string)
      .split(';')
      .map((d) =>
        normalise(
          d
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s*:\s*/, ':'),
        ),
      )
      .filter(Boolean);
    for (const raw of (m[1] as string).split(',')) {
      const selector = raw.replace(/\s+/g, ' ').trim();
      if (!selector || selector.startsWith('@')) continue;
      out.set(selector, [...(out.get(selector) ?? []), ...decls]);
    }
  }
  return out;
}

const plans = rules(sheet('site-plans.html'));
const about = rules(sheet('site-about.html'));
// the print block hides the chrome on paper; it is not a declaration the screen rules carry
const site = rules(SITE_CSS.replace(/@media print\{[\s\S]*?\n\}/, ''));

/**
 * Declarations the sheet may add on top of a ported rule: the ask box is the kit's box (its own
 * max-width comes off), and a heading the prototype spaced with an inline style is spaced here.
 */
const EXTRAS = new Set(['max-width:none', 'margin-top:8px']);

/** sheet selector → prototype selector, for the rules that are a straight port. */
const SHELL: Record<string, string> = {
  '.st-wrap': '.wrap',
  '.st-btn': '.btn',
  '.st-btn.st-pig': '.btn.pig',
  '.st-btn.st-quiet': '.btn.quiet',
  '.st-btn.st-marigold': '.btn.marigold',
  '.st-header': 'header',
  '.st-header .st-wrap': 'header .wrap',
  '.st-header .st-wm svg': 'header .wm svg',
  '.st-header nav': 'header nav',
  '.st-header nav a': 'header nav a',
  '.st-header nav a.st-on': 'header nav a.on',
  '.st-header .st-cta': 'header .cta',
  '.st-reveal': '.reveal',
  '.st-reveal.st-pre': '.reveal.pre',
  '.st-section': 'section',
  '.st-head': '.head',
  '.st-head h2': '.head h2',
  '.st-head p': '.head p',
  '.st-close': '.close',
  '.st-close h2': '.close h2',
  '.st-close .hand': '.close .hand',
  '.st-close .st-row': '.close .row',
  '.st-close .st-btn': '.close .btn',
  '.st-close .st-btn.st-q': '.close .btn.q',
  '.st-footer': 'footer',
  '.st-footer .st-wrap': 'footer .wrap',
  '.st-footer b': 'footer b',
  '.st-footer a': 'footer a',
  '.st-footer .st-wm svg': 'footer .wm svg',
};

const ASK: Record<string, string> = {
  '.st-ask': '.ask',
  '.st-ask h2': '.ask h2',
  '.st-ask .wk-ask': '.ask .box',
  '.st-ask .st-chips': '.ask .chips',
  '.st-ask .st-chips .wk-chip': '.ask .chips span',
  '.st-grid3': '.grid3',
  '.st-tile': '.tile',
  '.st-tile h3': '.tile h3',
  '.st-tile p': '.tile p',
  '.st-tile svg': '.tile svg',
};

const ABOUT: Record<string, string> = {
  '.ab-hero': '.hero',
  '.ab-hero .st-wrap': '.hero .wrap',
  '.ab-hero h1': '.hero h1',
  '.ab-hero h1 em': '.hero h1 em',
  '.ab-hero p.ab-sub': '.hero p.sub',
  '.ab-mission': '.mission',
  '.ab-mission .hand': '.mission .hand',
  '.ab-mission .hand em': '.mission .hand em',
  '.ab-mission .ab-sig': '.mission .sig',
  '.ab-mission .ab-pin': '.mission .pin',
  '.ab-story': '.story',
  '.ab-story p': '.story p',
  '.ab-story p+p': '.story p+p',
  // `.story .pull` is not here: the prototype washes the pull quote in marigold and law v5 puts
  // every card on paper-2. The law wins, and the divergence is asserted in `law-v5.test.ts`.
  '.ab-story .ab-pull em': '.story .pull em',
  '.ab-promises': '.promises',
  '.ab-promise': '.promise',
  '.ab-promise i': '.promise i',
  '.ab-promise b': '.promise b',
  '.ab-promise span': '.promise span',
  '.ab-team': '.team',
  '.ab-team h2': '.team h2',
  '.ab-team p': '.team p',
  '.ab-team .hand': '.team .hand',
  '.ab-team .ab-cards': '.team .cards',
  '.ab-team .ab-card': '.team .card',
  '.ab-team .ab-card .ab-a': '.team .card .a',
  '.ab-team .ab-card b': '.team .card b',
  '.ab-team .ab-card span': '.team .card span',
};

const PLANS: Record<string, string> = {
  '.pl-hero': '.hero',
  '.pl-hero h1': '.hero h1',
  '.pl-hero h1 em': '.hero h1 em',
  '.pl-hero p.pl-sub': '.hero p.sub',
  '.pl-allow': '.allow',
  '.pl-allow b': '.allow b',
  '.pl-allow .pl-bar': '.allow .bar',
  '.pl-allow .pl-bar i': '.allow .bar i',
  // NOT THE STICKER (DESIGN.md §0, trap 3). The prototype's `.allow span` reached its own sticker
  // too, and its `.allow .sticker` rule, written later and more specific, won. Ours is the kit's
  // `.wk-sticker` from an earlier sheet at lower specificity, so the bare rule painted "free,
  // every day" in --ink-3 on marigold at 1.92:1 (wave 29, site-6). The sticker is a child span
  // of the card as well, so a child selector alone is not enough: it is named out.
  '.pl-allow > span:not(.wk-sticker)': '.allow span',
  '.pl-allow .hand': '.allow .hand',
  '.pl-plans': '.plans',
  '.pl-plan': '.plan',
  // `.plan.pro` is not here for the same reason: the prototype washes the recommended card in
  // pig, and law v5 makes pig POINT at it — a ring on paper-2 — rather than tint it.
  '.pl-plan.pl-max': '.plan.max',
  '.pl-plan .pl-name': '.plan .name',
  '.pl-plan.pl-max .pl-name': '.plan.max .name',
  '.pl-plan .pl-price': '.plan .price',
  '.pl-plan .pl-price small': '.plan .price small',
  '.pl-plan.pl-max .pl-price small': '.plan.max .price small',
  '.pl-plan .pl-x': '.plan .x',
  '.pl-plan.pl-max .pl-x': '.plan.max .x',
  '.pl-plan p': '.plan p',
  '.pl-plan.pl-max p': '.plan.max p',
  '.pl-plan ul': '.plan ul',
  '.pl-plan li': '.plan li',
  '.pl-plan li i': '.plan li i',
  '.pl-plan li i svg': '.plan li i svg',
  '.pl-plan .st-btn': '.plan .btn',
  '.pl-plan.pl-max .st-btn': '.plan.max .btn',
  '.pl-plan .pl-best': '.plan .best',
  '.pl-plan .pl-fine': '.plan .fine',
  '.pl-plan.pl-max .pl-fine': '.plan.max .fine',
  '.pl-tbl': '.tbl',
  '.pl-tbl .pl-r': '.tbl .r',
  '.pl-tbl .pl-r+.pl-r': '.tbl .r+.r',
  '.pl-tbl .pl-r>div': '.tbl .r>div',
  '.pl-tbl .pl-r.pl-h>div': '.tbl .r.h>div',
  '.pl-tbl .pl-r>div:first-child': '.tbl .r>div:first-child',
  '.pl-tbl .pl-same': '.tbl .same',
  '.pl-tbl .pl-y': '.tbl .y',
  '.pl-tbl .pl-y i': '.tbl .y i',
  // The checkout preview's rules are the app's own. The prototype dropped that section in its
  // law-v5 pass; the app keeps it, because two unticked consent boxes shown before a payment
  // control is a promise the plans page makes in words and has to keep on screen.
  // `.gift` is not here either: the prototype washes the gift panel in marigold; law v5 sits it
  // on paper-2 like every other panel and keeps marigold for the ribbon it draws.
  '.pl-gift h2': '.gift h2',
  '.pl-gift p': '.gift p',
  '.pl-gift .pl-row': '.gift .row',
  '.pl-gift .st-btn.st-quiet': '.gift .btn.quiet',
  '.pl-gift svg': '.gift svg',
  '.pl-faq': '.faq',
  '.pl-faq details': '.faq details',
  '.pl-faq summary': '.faq summary',
  '.pl-faq summary::-webkit-details-marker': '.faq summary::-webkit-details-marker',
  '.pl-faq summary::after': '.faq summary::after',
  '.pl-faq details[open] summary::after': '.faq details[open] summary::after',
  '.pl-faq details p': '.faq details p',
};

/**
 * Declarations the law overrules the prototype on, one per selector, with the reason. The
 * prototype's declaration is what the port is held to; the sheet carries the lawful one instead.
 */
const LAWFUL: Record<string, { theirs: string; ours: string; why: string }> = {
  '.pl-allow > span:not(.wk-sticker)': {
    theirs: 'color:var(--ink-3)',
    ours: 'color:var(--ink-2)',
    why: '13px in --ink-3 on paper-2 measures 3.13:1 by day, and this is the sentence that says how much of today is left.',
  },
};

function holds(port: Record<string, string>, source: Map<string, string[]>): void {
  for (const [mine, theirs] of Object.entries(port)) {
    const expected = source.get(theirs);
    expect(expected, `${theirs} is in the prototype`).toBeDefined();
    const lawful = LAWFUL[mine];
    const got = (site.get(mine) ?? [])
      .filter((d) => !EXTRAS.has(d))
      .map((d) => (lawful && d === lawful.ours ? lawful.theirs : d));
    expect([mine, got]).toEqual([mine, expected ?? []]);
  }
}

describe('the site sheet is the prototypes, rule for rule', () => {
  it('ports the shell from site-plans.html', () => {
    holds(SHELL, plans);
  });

  it('ports the ask block and the tiles from site-about.html', () => {
    holds(ASK, about);
  });

  it('ports the about page from site-about.html', () => {
    holds(ABOUT, about);
  });

  it('ports the plans page from site-plans.html', () => {
    holds(PLANS, plans);
  });

  it("lets the allowance sticker keep the kit's ink on marigold", () => {
    // no descendant rule reaches into the sticker; the line under the bar is a child of the card
    expect(site.has('.pl-allow span')).toBe(false);
    expect(site.has('.pl-allow > span')).toBe(false);
    expect(site.get('.pl-allow > span:not(.wk-sticker)')).toContain('color:var(--ink-2)');
  });

  it('hides the pill nav on a phone, as the prototype does', () => {
    const phone = /@media \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(SITE_CSS)?.[1] ?? '';
    expect(phone).toContain('.st-header nav{display:none}');
    expect(phone).toContain('.st-footer .st-wrap{grid-template-columns:1fr 1fr}');
  });
});

describe('the laws hold over the whole sheet', () => {
  const screen = SITE_CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(
    /@media print\{[\s\S]*?\n\}/,
    '',
  );

  // DESIGN.md §2: no border lines. The only rules are Wobo's own, 2px at least.
  it('draws no hairline and no 1px border', () => {
    expect(screen).not.toMatch(/\b0?\.5px\b/);
    for (const m of screen.matchAll(/border(?:-top|-bottom|-left|-right)?:\s*([^;}]+)/g)) {
      const value = m[1] as string;
      expect([value, value === '0' || /^\d+px/.test(value)]).toEqual([value, true]);
      const width = /^(\d+)px/.exec(value);
      if (width) expect(Number(width[1])).toBeGreaterThanOrEqual(2);
    }
  });

  // DESIGN.md §2: nothing sharp, nothing 3px. Two shapes are not corners: the allowance bar is a
  // pill (its radius is half its own height), and the speech bubble on the doors has a tail — both
  // are the prototypes' own.
  it('keeps every corner at 10px or more', () => {
    const corners = screen.replace(/(?:\.pl-allow \.pl-bar|\.wa-bub)[^{]*\{[^}]*\}/g, '');
    for (const m of corners.matchAll(/border-radius:\s*([^;}]+)/g)) {
      for (const part of (m[1] as string).split(/[\s/]+/)) {
        const px = /^(\d+)px$/.exec(part);
        if (px) expect([m[0], Number(px[1]) >= 10]).toEqual([m[0], true]);
      }
    }
  });

  it("writes every colour as a token, apart from the prototype's own three", () => {
    const hexes = new Set([...screen.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]));
    expect([...hexes].sort()).toEqual(['#14142B', '#fff']);
    // the only rgba() left is a soft shadow under something that floats
    for (const m of screen.matchAll(/[^{;]*rgba\([^)]*\)[^;}]*/g)) {
      const decl = m[0].trim();
      expect([decl, /shadow/.test(decl)]).toEqual([decl, true]);
    }
  });

  it('uses no face but Poppins and Caveat', () => {
    expect(screen).not.toMatch(/font-family:\s*(?!var\(--hand\)|var\(--sans\))/);
    expect(screen).not.toMatch(/monospace|serif/);
  });

  it('keeps the reduced-motion escape hatch and the print rules', () => {
    expect(SITE_CSS).toContain('prefers-reduced-motion');
    expect(SITE_CSS).toContain('@media print');
  });

  it('carries no backtick that would end its own template literal', () => {
    expect(SITE_CSS).not.toContain('`');
  });
});

/**
 * WOBO-PLAN §18's touch floor, on the pages the responsive proof flagged: the help search field and
 * the consent boxes on /plans/checkout and /sign-up. Both are a 44×44 box a thumb can hit — and
 * NEITHER of them moves a type size to get there. (The two region pills that used to be here went
 * with the country switch: law v5 infers where a reader is and never asks.)
 */
describe('every control on the site clears the 44px floor', () => {
  const phone = /@media \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(SITE_CSS)?.[1] ?? '';

  it('grows the help search field on a phone', () => {
    expect(phone).toContain('.hp-search input{min-height:44px}');
  });

  it('leaves its type alone', () => {
    // the ported rules still carry the prototype's sizes; the floor adds height, never font-size
    expect(site.get('.hp-search input')).toContain('font:400 17px/1.4 var(--sans)');
    expect(phone).not.toMatch(/\.hp-search input\{[^}]*font/);
  });

  it('puts a 44px hit area around a 22px consent box', () => {
    const hit = site.get('.pl-checkout label>input[type=checkbox]') ?? [];
    expect(site.get('.wa-consent>input[type=checkbox]')).toEqual(hit);
    expect(hit).toContain('width:44px');
    expect(hit).toContain('height:44px');
    // the negative margin keeps the row exactly as tall as the 22px box it was
    expect(hit).toContain('margin:-11px 0 -11px -11px');

    const box = site.get('.pl-checkout label>input[type=checkbox]::before') ?? [];
    expect(box).toContain('width:22px');
    expect(box).toContain('height:22px');
  });

  it('draws the box in tone, and the tick with no line of its own', () => {
    const box = site.get('.pl-checkout label>input[type=checkbox]::before') ?? [];
    expect(box).toContain('background:var(--paper-3)');
    expect(site.get('.pl-checkout label>input[type=checkbox]:checked::before')).toContain(
      'background:var(--pig)',
    );
    const tick = site.get('.pl-checkout label>input[type=checkbox]::after') ?? [];
    expect(tick).toContain('background:var(--paper)');
    expect(tick.some((d) => d.startsWith('clip-path:'))).toBe(true);
    expect(tick.some((d) => d.startsWith('border'))).toBe(false);
  });
});
