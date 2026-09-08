/**
 * A PANEL THAT IS FADED OUT IS STILL IN THE TREE, and a screen reader reads the tree.
 *
 * The hero answers one question four ways and shows one at a time by crossfading on opacity; the
 * climb dresses one path two ways the same way. Opacity is the right tool for the eye (the swap
 * is a transition, not a cut) and the wrong tool for the ear: wave 29's walk (site-7) ran
 * `document.body.innerText` on the front page and got all four hero panels, both climb views and
 * all four answer-form cards as one run-on, with nothing saying which was on screen. So the
 * visual state is paired with `aria-hidden` on every panel that is not the one shown, and `inert`
 * so nothing inside one can take focus. The switch controls themselves were already right
 * (`aria-pressed`), so they are not re-proved here.
 *
 * No browser in this suite: the sections render to static markup from their initial state, and
 * the markup is read. The answer-forms cards are swapped by the scroll engine after mount, so that
 * one is held at the source of `mountForms` instead.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Climb } from './sections/Climb';
import { Hero } from './sections/Hero';

/** The opening tags of the direct children of `#id`, in order. */
function panelsOf(html: string, id: string, tag: string): string[] {
  const start = html.indexOf(`id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const from = html.indexOf('>', start) + 1;
  // walk the children: every `<tag ...>` at depth 0 until the container closes
  const out: string[] = [];
  let depth = 0;
  let i = from;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) break;
    const close = html.indexOf('>', open);
    const token = html.slice(open, close + 1);
    const closing = token.startsWith('</');
    const name = token.replace(/^<\/?/, '').split(/[\s>]/)[0] ?? '';
    if (closing) {
      if (depth === 0) break;
      depth -= 1;
    } else if (!token.endsWith('/>')) {
      if (depth === 0 && name === tag) out.push(token);
      depth += 1;
    }
    i = close + 1;
  }
  return out;
}

describe('the hero stage', () => {
  const html = renderToStaticMarkup(<Hero sectionRef={createRef<HTMLElement | null>()} />);
  const panels = panelsOf(html, 'heroStage', 'div');

  it('renders its four answers', () => {
    expect(panels).toHaveLength(4);
  });

  it('hides every answer but the one on screen from the accessibility tree', () => {
    const shown = panels.filter((p) => !p.includes('aria-hidden="true"'));
    const hidden = panels.filter((p) => p.includes('aria-hidden="true"'));
    expect([shown.length, hidden.length]).toEqual([1, 3]);
    expect(shown[0]).toContain('class="on"');
    for (const p of hidden) expect(p).toContain('inert');
    expect(shown[0]).not.toContain('inert');
  });
});

describe('the climb', () => {
  const html = renderToStaticMarkup(<Climb />);

  it('reads one dressing of the path at a time', () => {
    const svgs = [...html.matchAll(/<svg[^>]*data-vibe="[^"]+"[^>]*>/g)].map((m) => m[0]);
    expect(svgs).toHaveLength(2);
    const shown = svgs.filter((s) => !s.includes('aria-hidden="true"'));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('class="on"');
  });
});

describe('the answer-forms sequence', () => {
  const source = readFileSync(join(import.meta.dir, 'engine', 'motion.ts'), 'utf8');
  const body = source.slice(source.indexOf('export function mountForms'));
  const fn = body.slice(0, body.indexOf('\n}\n'));

  it('pairs every opacity swap with aria-hidden, and takes it back down on dispose', () => {
    expect(fn).toContain("setAttribute('aria-hidden'");
    expect(fn).toContain("removeAttribute('aria-hidden')");
  });
});
