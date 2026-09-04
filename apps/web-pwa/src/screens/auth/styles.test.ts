/**
 * The doors' sheet, held to design/prototypes/app-auth.html and to the laws in DESIGN.md §0.
 *
 * The rules that carry the design are compared declaration for declaration with the prototype's,
 * so "the field is a ruled line, not a box" cannot quietly become a box again. Three deviations are
 * deliberate and are named below; everything else must match.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_CSS } from './styles';

const PROTOTYPE = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  '..',
  'design',
  'prototypes',
  'app-auth.html',
);

/** Every `selector{declarations}` in a stylesheet, media blocks flattened, groups split. */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = (match[2] as string)
      .split(';')
      .map((d) =>
        d
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s*:\s*/, ':'),
      )
      .filter(Boolean);
    for (const raw of (match[1] as string).split(',')) {
      const selector = raw.replace(/\s+/g, ' ').trim();
      if (!selector || selector.startsWith('@')) continue;
      out.set(selector, [...(out.get(selector) ?? []), ...decls]);
    }
  }
  return out;
}

const html = readFileSync(PROTOTYPE, 'utf8');
const proto = rules(/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '');
const sheet = rules(AUTH_CSS);

/**
 * The three deliberate departures from Fable's file, each because a standing law outranks it:
 * DESIGN.md §3 law 2 sets the thinnest line in the interface at 2.5px, which raises the glyph's
 * stroke and the `or` rule; and trap 4 forbids `white-space:nowrap` on anything long, so the bar's
 * lead-in wraps and only the one word that is the link is held on its line.
 *
 * THIS MAP IS ONLY WORTH ANYTHING IF THE RULES IT NAMES ARE ACTUALLY COMPARED. It was written and
 * then never reached: `expected()` reads it, `portsFrom()` is the only caller of `expected()`, and
 * `portsFrom` was called with eight selectors, none of which was one of these three. Deleting the
 * whole map changed no test outcome. The three rules below are ported for real now, so a swap of
 * 2.5 back to 1.9 fails here rather than passing a declaration-for-declaration comparison that
 * never ran. `DEVIATION_RULES` is the list, and a key with no rule to apply it to is itself a
 * failure.
 */
const DEVIATIONS: Record<string, Record<string, string>> = {
  '.au-field>svg': { 'stroke-width:1.9': 'stroke-width:2.5' },
  '.au-or::before': { 'height:2px': 'height:3px' },
  '.au-or::after': { 'height:2px': 'height:3px' },
};

/** Each departure's rule here, and the prototype rule it departs from. */
const DEVIATION_RULES: [string, string][] = [
  // the prototype writes the child combinator with spaces; `rules()` keeps them
  ['.au-field>svg', '.dr-field > svg'],
  ['.au-or::before', '.dr-or::before'],
  ['.au-or::after', '.dr-or::after'],
];

/** A prototype rule as this sheet must carry it. */
function expected(auName: string, drName: string): string[] {
  const swaps = DEVIATIONS[auName] ?? {};
  return (proto.get(drName) ?? []).map((decl) => swaps[decl] ?? decl);
}

/** Every declaration of a prototype rule, present in the ported one. */
function portsFrom(auName: string, drName: string): void {
  const want = expected(auName, drName);
  expect([drName, want.length > 0]).toEqual([drName, true]);
  const got = sheet.get(auName) ?? [];
  expect([auName, want.filter((decl) => !got.includes(decl))]).toEqual([auName, []]);
}

describe('the field is a ruled line, not a box', () => {
  it('draws a neutral rule under a transparent input, with no border and no slab', () => {
    portsFrom('.au-field', '.dr-field');
    portsFrom('.au-field input', '.dr-field input');
    portsFrom('.au-field::before', '.dr-field::before');
    const input = sheet.get('.au-field input') ?? [];
    expect(input).toContain('background:transparent');
    expect(input).toContain('border:0');
    expect(sheet.get('.au-field::before')).toContain('background:var(--paper-3)');
  });

  it('takes the pigment on focus, drawn across from the left by a transform', () => {
    portsFrom('.au-field::after', '.dr-field::after');
    const after = sheet.get('.au-field::after') ?? [];
    expect(after).toContain('background:var(--pig)');
    expect(after).toContain('transform:scaleX(0)');
    expect(after).toContain('transform-origin:left');
    expect(sheet.get('.au-field:focus-within::after')).toContain('transform:scaleX(1)');
    expect(sheet.get('.au-field:focus-within>svg')).toContain('color:var(--pig)');
  });

  it('gives a keyboard visitor a real ring as well, not only a change of colour', () => {
    const ring = sheet.get('.au-field:has(input:focus-visible)') ?? [];
    expect(ring.some((decl) => decl.startsWith('outline:3px solid var(--marigold)'))).toBe(true);
  });

  it('marks an invalid field in a second way, never by colour alone', () => {
    // The rule turns rose AND the error is named in text next to it (Auth.tsx wires
    // `aria-invalid` and `aria-describedby` to the same sentence).
    expect(sheet.get('.au-field[data-invalid="true"]::before')).toContain('background:var(--rose)');
  });
});

describe('one saturated thing on the page', () => {
  it('is the primary action, and nothing else', () => {
    portsFrom('.au-go', '.dr-go');
    const saturated = [...sheet.entries()].filter(([, decls]) =>
      decls.some((decl) => decl === 'background:var(--pig)'),
    );
    expect(saturated.map(([selector]) => selector).sort()).toEqual([
      '.au-consent>input[type=checkbox]:checked::before',
      '.au-field::after',
      '.au-go',
      '.au-steps i.au-on',
    ]);
  });

  it('makes a provider a white surface that floats, with no border line', () => {
    portsFrom('.au-prov', '.dr-prov');
    const prov = sheet.get('.au-prov') ?? [];
    expect(prov).toContain('background:var(--paper)');
    expect(prov).toContain('box-shadow:var(--lift)');
    expect(sheet.get('.au-prov:hover')).toContain('box-shadow:var(--shadow)');
  });

  it('lifts that surface off the ground at night rather than inverting the day', () => {
    // `--paper` is the ground at night, so a provider painted with it would be an invisible button
    // wearing a shadow nobody can see on black.
    for (const rule of [
      '[data-theme="dark"] .au-prov',
      ':root:not([data-theme="light"]) .au-prov',
    ]) {
      expect([rule, sheet.get(rule)]).toEqual([rule, ['background:var(--paper-3)']]);
    }
    for (const rule of [
      '[data-theme="dark"] .au-prov[aria-disabled="true"]',
      ':root:not([data-theme="light"]) .au-prov[aria-disabled="true"]',
    ]) {
      expect([rule, sheet.get(rule)]).toEqual([rule, ['background:var(--paper-2)']]);
    }
  });
});

describe('a door that is not open keeps its shape', () => {
  it('carries the soon chip rather than an apology under a dead slab', () => {
    portsFrom('.au-soon', '.dr-soon');
    expect(sheet.get('.au-soon')).toContain('background:var(--marigold-w)');
    // and the chip reads on the night theme both ways a viewer can arrive at it
    expect(sheet.has('[data-theme="dark"] .au-soon')).toBe(true);
    expect(sheet.has(':root:not([data-theme="light"]) .au-soon')).toBe(true);
  });
});

describe('two columns, one rhythm, three widths', () => {
  it('lays the conversation out as one: Wobo on the left, the act on the right', () => {
    portsFrom('.au-grid', '.dr-grid');
    expect(sheet.get('.au-grid')).toContain('gap:var(--colgap)');
    expect(sheet.get('.au-say')).toContain('min-width:0');
    expect(sheet.get('.au-act')).toContain('min-width:0');
  });

  it('stacks below 900 and keeps only the name, the run and the link below 640', () => {
    expect(AUTH_CSS).toContain('@media (max-width:900px)');
    expect(AUTH_CSS).toContain('@media (max-width:640px)');
    const stacked = /@media \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(AUTH_CSS)?.[1] ?? '';
    expect(stacked).toContain('grid-template-columns:1fr');
    const phone = /@media \(max-width:640px\)\{([\s\S]*?)\n\}/.exec(AUTH_CSS)?.[1] ?? '';
    expect(phone).toContain('.au-lead{display:none}');
  });

  it('holds nothing long on one line — trap 4 cost this repo a 1731px page', () => {
    const nowrap = [...sheet.entries()]
      .filter(([, decls]) => decls.includes('white-space:nowrap'))
      .map(([selector]) => selector);
    expect(nowrap).toEqual(['.au-other b']);
  });
});

describe('the laws every surface in this product obeys', () => {
  it('draws no border line anywhere', () => {
    for (const [selector, decls] of sheet) {
      for (const decl of decls) {
        if (!/^border(-(top|right|bottom|left))?:/.test(decl)) continue;
        expect([selector, decl]).toEqual([selector, 'border:0']);
      }
    }
  });

  it('rounds every surface at 10px or more', () => {
    // The exceptions are marks rather than surfaces: the run's pips, the bubble's tail and the
    // ruled line's own cap, none of which is a box anybody reads content inside.
    const marks = new Set([
      '.au-steps i',
      '.au-steps i.au-on',
      '.au-bubble::before',
      '.au-field::before',
      '.au-field::after',
      '.au-or::before',
      '.au-or::after',
    ]);
    for (const [selector, decls] of sheet) {
      if (marks.has(selector)) continue;
      for (const decl of decls) {
        const radius = /^border-radius:(\d+)px$/.exec(decl);
        if (!radius) continue;
        expect([selector, Number(radius[1]) >= 10]).toEqual([selector, true]);
      }
    }
  });

  it('holds the three deliberate departures, declaration for declaration', () => {
    for (const [ours, theirs] of DEVIATION_RULES) portsFrom(ours, theirs);
    // and every key in the map is a rule that exists on both sides, so a stale key cannot sit
    // there pretending to enforce something
    expect(Object.keys(DEVIATIONS).sort()).toEqual(DEVIATION_RULES.map(([ours]) => ours).sort());
    for (const [ours, theirs] of DEVIATION_RULES) {
      const swaps = DEVIATIONS[ours] ?? {};
      const from = Object.keys(swaps);
      expect([theirs, from.filter((decl) => !(proto.get(theirs) ?? []).includes(decl))]).toEqual([
        theirs,
        [],
      ]);
      const to = Object.values(swaps);
      expect([ours, to.filter((decl) => !(sheet.get(ours) ?? []).includes(decl))]).toEqual([
        ours,
        [],
      ]);
    }
  });

  it('draws no line thinner than 2.5px', () => {
    for (const [selector, decls] of sheet) {
      for (const decl of decls) {
        const stroke = /^stroke-width:([\d.]+)$/.exec(decl);
        if (stroke) expect([selector, Number(stroke[1]) >= 2.5]).toEqual([selector, true]);
      }
    }
    for (const rule of ['.au-or::before', '.au-or::after', '.au-field::before', '.au-field::after'])
      expect([rule, sheet.get(rule)?.includes('height:3px')]).toEqual([rule, true]);
  });

  it('paints with tokens, and names a literal only where the prototype does', () => {
    // TWO HOLES THIS CLOSED. The allow-list used to be typed out here rather than read off the
    // prototype, so "only where the prototype does" was a sentence and not an assertion; and the
    // pattern only saw hex, so `rgba(43,69,255,.28)` — one of the three literals the comment
    // claimed it covered — was invisible to it, and any new rgb()/hsl() colour passed silently.
    // Now the prototype is the allow-list, and every colour notation is looked at.
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
    const literals = (rules: Map<string, string[]>): Set<string> => {
      const out = new Set<string>();
      for (const [, decls] of rules) {
        for (const decl of decls) {
          // A shadow's own geometry is not a colour; only the colour part is compared.
          for (const literal of decl.match(LITERAL) ?? []) out.add(literal.replace(/\s+/g, ''));
        }
      }
      return out;
    };
    const allowed = literals(proto);
    expect(allowed.size > 0).toBe(true);
    for (const [selector, decls] of sheet) {
      for (const decl of decls) {
        for (const raw of decl.match(LITERAL) ?? []) {
          const literal = raw.replace(/\s+/g, '');
          expect([selector, decl, literal, allowed.has(literal)]).toEqual([
            selector,
            decl,
            literal,
            true,
          ]);
        }
      }
    }
  });

  it('never transitions or animates a layout property, so nothing can stutter', () => {
    const layout = /\b(width|height|top|left|right|bottom|margin|padding|flex|grid)\b/;
    for (const [selector, decls] of sheet) {
      for (const decl of decls) {
        if (!decl.startsWith('transition:')) continue;
        // `top` on the skip link is the one exception and it is a jump on focus, not a scrub
        if (selector === '.au-skip') continue;
        expect([selector, layout.test(decl)]).toEqual([selector, false]);
      }
    }
  });

  it('stands still for anybody who asked for that, and only inside its own page', () => {
    expect(AUTH_CSS).toContain('@media (prefers-reduced-motion:reduce){.au *{');
  });

  it('gives every control a visible focus state', () => {
    for (const rule of [
      '.au-btn:focus-visible',
      '.au-field:has(input:focus-visible)',
      '.au-consent>input[type=checkbox]:focus-visible',
      '.au :where(a):focus-visible',
      '.au-skip:focus',
    ]) {
      expect([rule, sheet.has(rule)]).toEqual([rule, true]);
    }
  });

  it('keeps every touch target at 44px or more', () => {
    expect(sheet.get('.au-btn')).toContain('min-height:56px');
    expect(sheet.get('.au-quiet')).toContain('min-height:48px');
    expect(sheet.get('.au-other')).toContain('min-height:44px');
    expect(sheet.get('.au-consent>input[type=checkbox]')).toContain('width:44px');
  });
});
