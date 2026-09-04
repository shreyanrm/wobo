/**
 * THE CLIMB, AS THE CASCADE ACTUALLY RESOLVES IT.
 *
 * Two failures got past a sheet that reads correctly line by line, because neither is visible in a
 * line — each is a property of the WHOLE sheet applied to one real element:
 *
 *   1. THE GATE WAS GREYED OUT. Every node carries a state class as well as its kind, and the
 *      gate's state is `ahead` (`cl-lock`) until the chapter is cleared, so
 *      `.cl-lock > .cl-card > b{color:var(--ink-3);font-weight:500}` won on it. In the drawing the
 *      gate is the one dark, confident card at the foot of the climb; in the build it read exactly
 *      like the topics nobody has reached. The prototype never hits this because its gate carries
 *      no state class at all — which is precisely the kind of difference a port introduces and a
 *      per-line reading cannot see.
 *   2. THE MAP WAS HALF A SCREEN WIDE. app-climb.html holds everything in
 *      `.cl-wrap{width:min(760px,…)}`; the port had no cap anywhere, so at 1440 the spine sat in
 *      the middle of a 1120px column with 532px cards, against the drawing's 352px.
 *
 * So this file resolves the cascade over the class lists the shipped component actually emits.
 * `Climb.tsx` is read too, so a rename there is caught rather than quietly making these assertions
 * true about markup nobody renders.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;
const CSS = readFileSync(join(HERE, 'Climb.css'), 'utf8');
const TSX = readFileSync(join(HERE, 'Climb.tsx'), 'utf8');

// --- just enough cascade ------------------------------------------------------------------------

/** One element in a chain: its tag, and the classes on it. */
interface El {
  tag: string;
  classes: string[];
}

const el = (tag: string, ...classes: string[]): El => ({ tag, classes });

/** `[a, b, c]` for `a b c` — every compound between combinators, plus how it was joined. */
function parts(selector: string): { compound: string; child: boolean }[] {
  const out: { compound: string; child: boolean }[] = [];
  let child = false;
  for (const token of selector.replace(/>/g, ' > ').split(/\s+/).filter(Boolean)) {
    if (token === '>') {
      child = true;
      continue;
    }
    out.push({ compound: token, child });
    child = false;
  }
  return out;
}

/** Does one compound (`li.cl-n.cl-boss`, `.cl-card`, `b`) describe this element? */
function matches(compound: string, node: El): boolean {
  // pseudo-classes and pseudo-elements are not part of what these cases ask about
  if (/[:[]/.test(compound)) return false;
  const tag = compound.match(/^[a-z]+/)?.[0];
  if (tag && tag !== node.tag) return false;
  return [...compound.matchAll(/\.([\w-]+)/g)].every((m) => node.classes.includes(m[1] as string));
}

/** Right-to-left, the way a browser does it. Descendant combinators may skip; child may not. */
function selectorMatches(selector: string, chain: readonly El[]): boolean {
  const seq = parts(selector);
  let at = chain.length - 1;
  const last = seq[seq.length - 1];
  if (!last || at < 0 || !matches(last.compound, chain[at] as El)) return false;
  for (let i = seq.length - 2; i >= 0; i -= 1) {
    const step = seq[i + 1] as { compound: string; child: boolean };
    const want = seq[i] as { compound: string; child: boolean };
    at -= 1;
    if (step.child) {
      if (at < 0 || !matches(want.compound, chain[at] as El)) return false;
    } else {
      while (at >= 0 && !matches(want.compound, chain[at] as El)) at -= 1;
      if (at < 0) return false;
    }
  }
  return true;
}

/** (ids, classes, elements) as one comparable number. No id is used in this sheet. */
function specificity(selector: string): number {
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(^|[\s>])[a-z]+/g) ?? []).length;
  return classes * 100 + elements;
}

/** The declarations of the sheet, in source order, media blocks stripped. */
function flatRules(css: string): { selector: string; decls: string; order: number }[] {
  const out: { selector: string; decls: string; order: number }[] = [];
  let order = 0;
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = (m[1] as string).replace(/\s+/g, ' ').trim();
    if (!head || head.startsWith('@')) continue;
    for (const selector of head.split(',').map((s) => s.trim())) {
      order += 1;
      out.push({ selector, decls: m[2] as string, order });
    }
  }
  return out;
}

const RULES = flatRules(CSS);

/** What this sheet finally says about one property on one element. */
function computed(chain: readonly El[], prop: string): string | null {
  let best: { spec: number; order: number; value: string } | null = null;
  for (const rule of RULES) {
    if (!selectorMatches(rule.selector, chain)) continue;
    const found = rule.decls.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`));
    if (!found) continue;
    const spec = specificity(rule.selector);
    if (!best || spec > best.spec || (spec === best.spec && rule.order >= best.order)) {
      best = { spec, order: rule.order, value: (found[1] as string).trim() };
    }
  }
  return best?.value ?? null;
}

// --- the chains the component actually emits ------------------------------------------------------

const node = (...state: string[]): El[] => [
  el('li', 'cl-n', 'cl-r', ...state),
  el('div', 'cl-card'),
  el('b'),
];

describe('the little cascade this file runs is a cascade', () => {
  it('takes the later of two rules of equal specificity, and the more specific of two', () => {
    expect(computed(node('cl-lock'), 'color')).toBe('var(--ink-3)');
    expect(computed([el('li', 'cl-n', 'cl-r'), el('div', 'cl-card'), el('b')], 'color')).toBeNull();
  });

  it('does not let a child combinator skip a level', () => {
    // `.cl-lock > .cl-card > b` must not reach a `b` nested one deeper than the card's own child
    const deeper = [el('li', 'cl-n', 'cl-lock'), el('div', 'cl-card'), el('span'), el('b')];
    expect(computed(deeper, 'color')).toBeNull();
  });
});

describe('the gate is the confident card at the foot of the climb', () => {
  // `Climb.tsx` emits `cl-n cl-<side> cl-lock cl-boss` for the gate of any chapter not yet cleared
  // (`climb-map.ts` gives it the state `ahead`), which is the ordinary case for every learner.
  it('keeps its ink while the chapter is still owed', () => {
    expect(computed(node('cl-lock', 'cl-boss'), 'color')).toBe('var(--ink)');
    expect(computed(node('cl-lock', 'cl-boss'), 'font-weight')).toBe('600');
  });

  it('keeps it once the chapter is cleared, too', () => {
    expect(computed(node('cl-done', 'cl-boss'), 'color')).toBe('var(--ink)');
  });

  it('and the reward keeps its ink in every state it can be in', () => {
    for (const state of ['cl-lock', 'cl-unsure', 'cl-done', 'cl-now', 'cl-debt']) {
      expect({ state, color: computed(node(state, 'cl-chest'), 'color') }).toEqual({
        state,
        color: 'var(--ink)',
      });
    }
  });

  it('leaves an ordinary node nobody has reached greyed, which is its job', () => {
    expect(computed(node('cl-lock'), 'color')).toBe('var(--ink-3)');
    expect(computed(node('cl-unsure'), 'color')).toBe('var(--ink-3)');
  });
});

describe('the climb is the measure the drawing is', () => {
  it('caps the column at the prototype’s 760px', () => {
    const wrap = RULES.find((r) => r.selector === '.cl-climb');
    expect(wrap?.decls).toContain('width:min(760px,100%)');
    // and left-aligned to the same edge as the ledger below it, not centred in the column
    expect(wrap?.decls).not.toContain('margin-inline:auto');
  });

  it('puts that cap on the element that holds the head, the stats and the path', () => {
    // both returns of `ClimbView` — the fetching state and the map itself
    expect([...TSX.matchAll(/className="cl-climb/g)]).toHaveLength(2);
    // and the path is inside it, not beside it
    const section = TSX.slice(TSX.indexOf('<section className="cl-climb" aria-label'));
    expect(section.indexOf('className="cl-path"')).toBeGreaterThan(0);
    expect(section.indexOf('</section>')).toBeGreaterThan(section.indexOf('className="cl-path"'));
  });
});
