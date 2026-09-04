/**
 * The You screen's own rules are a port of board 05 of design/prototypes/app-v1.html and the
 * parent-view mock in design/prototypes/site-parents.html, rule for rule. This holds every `wy-`
 * rule to its source — the same declarations, the same values — and keeps the sheet free of any
 * line, corner or colour of its own.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO_DIR = join(REPO, 'design', 'prototypes');
const APP = readFileSync(join(PROTO_DIR, 'app-v1.html'), 'utf8');
const PARENTS = readFileSync(join(PROTO_DIR, 'site-parents.html'), 'utf8');
const SHEET = readFileSync(join(import.meta.dir, 'you.css'), 'utf8');

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
    out.set(selector, [...(out.get(selector) ?? []), ...decls]);
  }
  return out;
}

const app = rules(APP);
const parents = rules(PARENTS);
const sheet = rules(SHEET);

/** wy- selector → its source and the selector there. */
const PORT: Record<string, [Map<string, string[]>, string]> = {
  '.wy-you': [app, '.you'],
  '.wy-strengths': [app, '.strengths'],
  '.wy-strengths > div': [app, '.strengths > div'],
  '.wy-strengths b': [app, '.strengths b'],
  '.wy-strengths svg': [app, '.strengths svg'],
  '.wy-chart': [app, '.chart'],
  '.wy-chart i': [app, '.chart i'],
  '.wy-chart i.wy-k': [app, '.chart i.k'],
  '.wy-mock': [parents, '.mock'],
  '.wy-mock .wy-top': [parents, '.mock .top'],
  '.wy-mock .wy-top b': [parents, '.mock .top b'],
  '.wy-mock .wy-row': [parents, '.mock .row'],
  '.wy-mock .wy-row b': [parents, '.mock .row b'],
  '.wy-mock .wy-row span': [parents, '.mock .row span'],
  '.wy-mock .wy-row .wy-ok': [parents, '.mock .row .ok'],
  '.wy-mock .wy-row .wy-now': [parents, '.mock .row .now'],
  '.wy-mock .wy-note': [parents, '.mock .note'],
  '.wy-mock .wy-note em': [parents, '.mock .note em'],
  '.wy-mock .wy-lock': [parents, '.mock .lock'],
  '.wy-mock .wy-lock svg': [parents, '.mock .lock svg'],
  '.wy-art': [parents, '.art'],
};

/*
 * LAW v5 (DESIGN.md §0) over site-parents.html, on COLOUR alone.
 *
 * The prototype wraps the parent's report in a lilac panel. On the white ground a wash behind a
 * whole report is a section marking itself, and lilac is doing none of the four jobs a pigment is
 * allowed — so the panel is a tonal surface here and `.art.lilac` has no counterpart at all. The
 * report still floats on it on white paper under its own shadow, which is what makes it read as a
 * thing a parent is handed.
 *
 * The prototype has already said this itself once, in its own words ("a wash tints a pill, a tick
 * or a selected row — never a card, a tile, a panel or a section"), and has since been regenerated
 * back to the cream set. THE LAW IS THE AUTHORITY, not whichever way the file last landed: this
 * test holds the sheet to the prototype's SHAPE and to law v5's colour, and passes either way.
 *
 * A selector listed here is one this sheet adds to its source; everything else is held exactly.
 */
const V5_ADDED: Record<string, string[]> = {
  '.wy-art': ['background:var(--paper-2)'],
};

/** Element resets, the two lines the screen needs that the prototype drew as chrome, and the rail
 * kept in view on a page taller than the artboard. */
const OWN = new Set([
  '.wy-crumb-btn',
  '.wy-strengths p',
  '.wy-you .wk-card>p a',
  '.wy-shell .wk-rail',
]);

describe('you.css is board 05, rule for rule', () => {
  it('ports every rule declaration for declaration', () => {
    for (const [mine, [source, theirs]] of Object.entries(PORT)) {
      const added = V5_ADDED[mine] ?? [];
      const ported = (sheet.get(mine) ?? []).filter((d) => !added.includes(d));
      // the prototype may already declare what law v5 asks for; either way it must not be missing
      const want = (source.get(theirs) ?? []).filter((d) => !added.includes(d));
      expect(ported, mine).toEqual(want);
      for (const d of added) expect(sheet.get(mine), mine).toContain(d);
    }
  });
  it('law v5: the report panel is a tonal surface, and no rule washes anything in lilac', () => {
    expect(sheet.get('.wy-art')).toContain('background:var(--paper-2)');
    for (const [selector, decls] of sheet) {
      for (const d of decls) expect(`${selector}{${d}}`).not.toContain('lilac');
    }
  });
  it('has no rule the prototype does not, beyond element resets', () => {
    for (const selector of sheet.keys()) {
      expect(selector in PORT || OWN.has(selector), selector).toBe(true);
    }
  });
  it('keeps the phone block', () => {
    expect(SHEET).toContain('@media (max-width:900px){\n  .wy-you{grid-template-columns:1fr}');
    expect(SHEET).toContain('.wy-art{min-height:0}');
  });
  it('draws no hairline, no border on a surface, and no colour of its own', () => {
    expect(SHEET).not.toMatch(/0\.5px|1px solid|hairline/);
    const colours = SHEET.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    // the prototype's own two: the pigment's white text, and the ink under the floating mock
    expect(new Set(colours.map((c) => c.toLowerCase()))).toEqual(new Set(['#fff']));
  });
});
