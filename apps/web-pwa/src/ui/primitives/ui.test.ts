/**
 * The kit is a port of design/prototypes/app-v1.html (and the site pages' sticker), rule for
 * rule. This holds every `wk-` rule to its source: the same declarations, the same values, the
 * same order where order decides — and no line, corner or colour of its own.
 *
 * The last block is law v5's motion rule (DESIGN.md §0): one owner per animated property, and the
 * magnetic control that moves its INNER span rather than itself.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO_DIR = join(REPO, 'design', 'prototypes');
const APP = readFileSync(join(PROTO_DIR, 'app-v1.html'), 'utf8');
const SITE = readFileSync(join(PROTO_DIR, 'site-plans.html'), 'utf8');
const KIT = readFileSync(join(import.meta.dir, 'ui.css'), 'utf8');

/** Every `selector{declarations}` in a stylesheet, media blocks flattened, comments dropped. */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).replace(/\s+/g, ' ').trim();
    const decls = (m[2] as string)
      .split(';')
      .map((d) =>
        d
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s*:\s*/, ':'),
      )
      .filter(Boolean);
    if (!selector || selector.startsWith('@')) continue;
    // a selector that repeats (the phone block) keeps every declaration it was ever given
    out.set(selector, [...(out.get(selector) ?? []), ...decls]);
  }
  return out;
}

const proto = rules(APP);
const site = rules(SITE);
const kit = rules(KIT);

/**
 * Element resets the kit is allowed on top of the prototype's declarations: a <button> or a <form>
 * where the prototype drew a <span> or a <div>. None of them moves a pixel.
 */
const RESETS = new Set([
  'border:0',
  'padding:0',
  'cursor:pointer',
  'background:transparent',
  'text-align:left',
  'font:inherit',
  'color:inherit',
  'width:100%',
  'flex:none',
  'display:contents',
]);

/**
 * The two floors DESIGN.md §2 sets that the prototype's boards, drawn at desktop size, do not
 * carry: "touch targets are 44 px or more", and no type under the 13px label size. On a phone the
 * kit grows a control's BOX to the touch floor and never moves its type; where the prototype wrote
 * a 12px line of prose the kit writes 13px. A long crumb keeps to one line with an ellipsis rather
 * than wrapping, and a chip never breaks across two lines. These, with the resets above, are the
 * only declarations the kit adds.
 */
const FLOOR = new Set([
  'min-height:44px',
  'min-width:44px',
  'width:44px',
  'height:44px',
  'line-height:44px',
  'white-space:nowrap',
  'overflow:hidden',
  'text-overflow:ellipsis',
  'min-width:0',
  'font-size:13px',
]);
/** A prototype declaration the 13px floor lifts. */
const LIFTED: Record<string, string> = { 'font-size:12px': 'font-size:13px' };

/** kit selector → prototype selector, for the rules that are a straight port. */
const PORT: Record<string, string> = {
  '.wk-btn': '.btn',
  '.wk-btn.wk-pig': '.btn.pig',
  '.wk-btn.wk-quiet': '.btn.quiet',
  '.wk-btn.wk-sm': '.btn.sm',
  '.wk-chip': '.chip',
  '.wk-chip.wk-on': '.chip.on',
  '.wk-tag': '.tag',
  '.wk-label': '.label',
  '.wk-card': '.card',
  '.wk-card.wk-pig': '.card.pig',
  '.wk-card.wk-mint': '.card.mint',
  '.wk-card.wk-rose': '.card.rose',
  '.wk-card.wk-marigold': '.card.marigold',
  '.wk-card.wk-lilac': '.card.lilac',
  '.wk-card h3': '.card h3',
  '.wk-card p': '.card p',
  '.wk-card .wk-foot': '.card .foot',
  '.wk-tile': '.subjects a',
  '.wk-tile.wk-on': '.subjects a.on',
  '.wk-tile b': '.subjects b',
  '.wk-tile span': '.subjects span',
  '.wk-pill': '.pill',
  '.wk-sw': '.sw',
  '.wk-sw.wk-on': '.sw.on',
  '.wk-sw::after': '.sw::after',
  '.wk-sw.wk-on::after': '.sw.on::after',
  '.wk-toggle': '.toggle',
  '.wk-toggle:first-child': '.toggle:first-child',
  '.wk-toggle b': '.toggle b',
  '.wk-toggle span': '.toggle span',
  '.wk-seg': '.seg',
  '.wk-seg button': '.seg span',
  '.wk-seg button.wk-on': '.seg span.on',
  '.wk-ask': '.ask',
  '.wk-ask input': '.ask input',
  '.wk-ask input::placeholder': '.ask input::placeholder',
  '.wk-ask .wk-mic': '.ask .mic',
  '.wk-hand': '.week .hand',
  '.wk-hand em': '.week .hand em',
  '.wk-streak': '.streak',
  '.wk-streak .wk-n': '.streak .n',
  '.wk-streak .wk-days i': '.streak .days i',
  '.wk-streak .wk-days i.wk-on': '.streak .days i.on',
  '.wk-allow': '.rail .allow',
  '.wk-allow b': '.rail .allow b',
  '.wk-allow .wk-bar': '.rail .allow .bar',
  '.wk-allow span': '.rail .allow span',
  '.wk-rail': '.rail',
  '.wk-rail .wk-wm': '.rail .wm',
  '.wk-rail .wk-wm svg': '.rail .wm svg',
  '.wk-rail a': '.rail a',
  '.wk-rail a.wk-on': '.rail a.on',
  '.wk-rail a svg': '.rail a svg',
  '.wk-rail .wk-spacer': '.rail .spacer',
  '.wk-main': '.main',
  '.wk-topbar': '.topbar',
  '.wk-topbar .wk-crumb': '.topbar .crumb',
  '.wk-topbar .wk-right': '.topbar .right',
  '.wk-avatar': '.avatar',
  '.wk-talk': '.talk',
  '.wk-talk .wk-k': '.talk .k',
  '.wk-talk span': '.talk span',
};

/**
 * LAW v5 (DESIGN.md §0) supersedes app-v1.html on COLOUR alone, and the site prototypes already
 * say the rule in their own words: "a wash tints a pill, a tick or a selected row — never a card,
 * a tile, a panel or a section. Surfaces are paper-2." One kit rule was on the wrong side of it —
 * the rail's allowance card, a marigold slab in the corner of every app screen — and its track was
 * an ink alpha that vanishes on night. Each entry is one declaration the prototype has and the kit
 * deliberately replaces; everything not listed is still held to the prototype exactly.
 */
const V5: Record<string, Record<string, string>> = {
  '.wk-allow': { 'background:var(--marigold-w)': 'background:var(--paper-2)' },
  '.wk-allow .wk-bar': { 'background:rgba(20,20,43,.08)': 'background:var(--paper-3)' },
};

/** The prototype's `.hand` base is folded into the one rule that builds on it. */
function source_(theirs: string): string[] | undefined {
  const own = proto.get(theirs);
  if (!own) return undefined;
  return theirs === '.week .hand' ? [...(proto.get('.hand') ?? []), ...own] : own;
}

describe('every kit rule is the prototype’s rule', () => {
  for (const [mine, theirs] of Object.entries(PORT)) {
    it(`${mine} ← ${theirs}`, () => {
      const source = source_(theirs);
      expect(source).toBeDefined();
      const ported = kit.get(mine);
      expect(ported).toBeDefined();
      // everything the prototype declares, the kit declares (a 12px line lifted to the floor)
      const v5 = V5[mine] ?? {};
      for (const d of source ?? []) expect(ported).toContain(v5[d] ?? LIFTED[d] ?? d);
      // and the kit adds nothing but an element reset, a floor, or a law v5 swap
      const swapped = new Set(Object.values(v5));
      for (const d of ported ?? []) {
        if (RESETS.has(d) || FLOOR.has(d) || swapped.has(d)) continue;
        expect(source).toContain(d);
      }
    });
  }

  it('the shell is the prototype’s, with the artboard height replaced by the viewport', () => {
    // the desktop block, then the phone block, both under `.shell`
    expect(proto.get('.shell')).toEqual([
      'display:grid',
      'grid-template-columns:240px 1fr',
      'min-height:900px',
      'grid-template-columns:1fr',
      'min-height:100vh',
    ]);
    expect(kit.get('.wk-shell')).toEqual([
      'display:grid',
      'grid-template-columns:240px 1fr',
      'min-height:100vh',
      'grid-template-columns:1fr',
      'min-height:100vh',
    ]);
  });

  it('the allowance bar takes its width from the data, not from the prototype’s 62%', () => {
    const bar = proto.get('.rail .allow .bar i') ?? [];
    expect(bar).toContain('width:62%');
    expect(kit.get('.wk-allow .wk-bar i')).toEqual(bar.filter((d) => d !== 'width:62%'));
  });

  it('law v5: the rail’s allowance card is a tonal surface, and only its fill is marigold', () => {
    expect(kit.get('.wk-allow')).toContain('background:var(--paper-2)');
    expect(kit.get('.wk-allow')).not.toContain('background:var(--marigold-w)');
    expect(kit.get('.wk-allow .wk-bar')).toContain('background:var(--paper-3)');
    expect(kit.get('.wk-allow .wk-bar i')).toContain('background:var(--marigold)');
  });

  it('the streak’s week and note carry the inline spacing the prototype set on them', () => {
    expect(kit.get('.wk-streak .wk-days')).toEqual([
      ...(proto.get('.streak .days') ?? []),
      'margin-top:8px',
    ]);
    // the note is prose, so its 12px is lifted to the 13px floor
    expect(kit.get('.wk-streak .wk-note')).toEqual([
      'font-size:13px',
      'color:var(--ink-3)',
      'display:block',
      'margin-top:8px',
    ]);
    expect(APP).toContain('<div class="days" style="margin-top:8px">');
    expect(APP).toContain('style="font-size:12px;color:var(--ink-3);display:block;margin-top:8px"');
  });

  it('the sticker is the site pages’ sticker', () => {
    // the allowance's own sticker turns +6 with an offset; the general one, -6 and placed by hand
    const general = site.get('.allow .sticker') ?? [];
    expect(general).toContain('background:var(--marigold)');
    const mine = kit.get('.wk-sticker') ?? [];
    for (const d of general) {
      if (d.startsWith('right:') || d.startsWith('top:')) continue;
      if (d === 'transform:rotate(6deg)') {
        expect(mine).toContain('transform:rotate(-6deg)');
        continue;
      }
      expect(mine).toContain(d);
    }
  });

  it('the head’s shadow is the hero head’s', () => {
    expect(APP).toContain('filter:drop-shadow(0 14px 20px rgba(20,20,43,.16))');
    expect(kit.get('.wk-head.wk-shadow')).toEqual([
      'filter:drop-shadow(0 14px 20px rgba(20,20,43,.16))',
    ]);
  });
});

describe('the phone block is the prototype’s phone block', () => {
  const phoneProto = APP.slice(APP.indexOf('@media (max-width:900px)'));
  const phoneKit = KIT.slice(KIT.indexOf('@media (max-width:900px)'));
  const p = rules(phoneProto);
  const k = rules(phoneKit);
  const PHONE: Record<string, string> = {
    '.wk-rail': '.rail',
    '.wk-rail a': '.rail a',
    '.wk-rail a svg': '.rail a svg',
    '.wk-main': '.main',
    '.wk-topbar .wk-crumb': '.topbar .crumb',
    '.wk-topbar .wk-seg': '.topbar .seg',
    '.wk-ask': '.ask',
    '.wk-ask input': '.ask input',
  };
  for (const [mine, theirs] of Object.entries(PHONE)) {
    it(`${mine} ← ${theirs}`, () => {
      const source = p.get(theirs) ?? [];
      const ported = k.get(mine) ?? [];
      for (const d of source) expect(ported).toContain(LIFTED[d] ?? d);
      for (const d of ported) {
        if (FLOOR.has(d)) continue;
        expect(source).toContain(d);
      }
    });
  }
  it('grows every control to the touch floor, and nothing else', () => {
    const grown = [
      '.wk-ask .wk-mic',
      '.wk-btn.wk-sm',
      'button.wk-chip',
      '.wk-seg button',
      '.wk-sw-hit',
      '.wk-ask input',
    ];
    for (const selector of grown) {
      const decls = k.get(selector) ?? [];
      expect(
        decls.some((d) => d === 'min-height:44px' || d === 'height:44px'),
        selector,
      ).toBe(true);
      for (const d of decls)
        expect(FLOOR.has(d) || (p.get('.ask input') ?? []).includes(d)).toBe(true);
    }
  });
  it('hides the wordmark, the spacer and the bottom slot, as the prototype does', () => {
    expect(p.get('.rail .wm,.rail .spacer,.rail .allow,.rail .talk')).toEqual(['display:none']);
    expect(k.get('.wk-rail .wk-wm,.wk-rail .wk-spacer,.wk-rail .wk-bottom')).toEqual([
      'display:none',
    ]);
  });
});

describe('the kit keeps the law (DESIGN.md §2, §3)', () => {
  it('prefixes every class, so nothing meets an older screen’s rule', () => {
    for (const selector of kit.keys()) {
      for (const cls of selector.matchAll(/\.([\w-]+)/g)) {
        expect(cls[1]?.startsWith('wk-') || cls[1] === 'wobo-rig').toBe(true);
      }
    }
  });

  it('draws no hairline: no 1px line, no border under 2px', () => {
    expect(KIT).not.toMatch(/border[^;]*:\s*1px/);
    expect(KIT).not.toMatch(/border[^;]*:\s*0?\.\d+px/);
  });

  it('names no colour of its own — every colour is a token, or one the prototype wrote', () => {
    const hexes = new Set([...KIT.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()));
    // `#fff` on the pig button and the switch knob, and the sticker's ink, are the prototype's
    expect([...hexes].sort()).toEqual(['#14142b', '#fff']);
    for (const rgba of KIT.matchAll(/rgba?\([^)]+\)/g)) {
      expect(APP.includes(rgba[0]) || SITE.includes(rgba[0])).toBe(true);
    }
  });

  it('uses the two faces only, through the tokens', () => {
    expect(KIT).not.toMatch(/font-family\s*:\s*['"]?(?!var\()/);
  });
});

describe('the kit keeps law v5’s motion rule (DESIGN.md §0)', () => {
  /** Every `transition` shorthand in the kit, as (selector, property). */
  const transitions = [...kit].flatMap(([selector, decls]) =>
    decls
      .flatMap((d) => [...d.matchAll(/^transition:\s*([a-z-]+)/g)])
      .map((m) => [selector, m[1] as string] as const),
  );

  /**
   * A pseudo-element is the one place a transform transition cannot have two owners: GSAP animates
   * elements, and `::after` is not one — there is no handle to scrub it with, from the scroll
   * engine or from anywhere else. So a knob that slides on `transform: translateX()` inside an
   * `::after` is the RIGHT answer to §8's second cause (never animate a layout property like
   * `left`), and the rule below stops short of it rather than pushing the switch back onto `left`.
   */
  const PSEUDO = /::(after|before)/;

  it('declares a transition on something, so the rules below are not vacuous', () => {
    expect(transitions.length).toBeGreaterThan(0);
    // And the parse reaches the declarations rather than an empty map.
    expect(kit.size).toBeGreaterThan(20);
  });

  it('never puts a CSS transition on transform or opacity — the two the scroll engine scrubs', () => {
    // Cause 1 of the jitter: two owners for one property. The browser eases toward a value GSAP
    // has already moved past, every frame, and the element stutters.
    const owned = transitions.filter(([selector]) => !PSEUDO.test(selector));
    for (const [, property] of owned) expect(property).not.toBe('transform');
    for (const [, property] of transitions) expect(property).not.toBe('opacity');
    // `all` is both of them, and everything else besides.
    for (const [, property] of transitions) expect(property).not.toBe('all');
    expect(KIT).not.toMatch(/transition-property:\s*(transform|opacity|all)/);
  });

  it('never animates a layout property, anywhere in the kit (law v5 §8, cause 2)', () => {
    // The switch knob used to slide on `left`, which relayouts the row on every frame of the
    // slide. Width, height, top, left, right, bottom and inset are all the same defect.
    const layout = /^(width|height|top|left|right|bottom|inset|margin|padding)$/;
    const offenders = transitions.filter(([, property]) => layout.test(property));
    expect(offenders).toEqual([]);
  });

  it('writes the rule down where the next person will read it', () => {
    expect(KIT).toContain('ONE OWNER PER ANIMATED PROPERTY');
    expect(KIT).toContain('never scrub a LAYOUT property');
  });

  it('.wk-mag moves an inner span, never the box', () => {
    const box = kit.get('.wk-mag') ?? [];
    const inner = kit.get('.wk-mag > span') ?? [];
    expect(box.length).toBeGreaterThan(0);
    // the box itself is never transformed and never transitions: it must not move out from under
    // the pointer, or the pointer leaves, the transform resets, and it comes back — the loop.
    for (const d of box)
      expect(d.startsWith('transform') || d.startsWith('transition')).toBe(false);
    expect(inner).toContain('will-change:transform');
    for (const d of inner) expect(d.startsWith('transition')).toBe(false);
  });

  it('carries the prototype’s own account of why', () => {
    expect(KIT).toContain('The INNER span moves, never the box');
    expect(KIT).toContain('Moving a child leaves the hit area exactly where it was');
  });

  it('the behaviour writes the span’s transform and nothing else’s', () => {
    const js = readFileSync(join(import.meta.dir, 'magnetic.ts'), 'utf8');
    expect(js).toContain("el.querySelector('span')");
    expect(js).toContain('inner.style.transform');
    expect(js).not.toMatch(/\bel\.style\.transform/);
    // it stands down where a finger cannot hover, and where the learner asked for less motion
    expect(js).toContain("'(pointer: fine)'");
    expect(js).toContain("'(prefers-reduced-motion: reduce)'");
    expect(js).toContain('data-motion');
  });

  it('rests the magnet under reduced motion, in the stylesheet too', () => {
    expect(KIT).toContain('@media (prefers-reduced-motion:reduce){.wk-mag > span{transform:none');
    expect(KIT).toContain('[data-motion="reduce"] .wk-mag > span{transform:none');
  });
});
