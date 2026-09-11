/**
 * THE TYPE FLOOR IS THE PRODUCT'S OWN NUMBER (docs/INK-FOUR.md, craft: "labels at least 12 px on
 * the glass"; the adversary, wave 47, finding 11).
 *
 * Wave 47 measured the ink and found nothing under the floor — 88 written marks over 48 board
 * renders, the worst 13.2 px. Then it measured the APP: the tab-rail labels (Home, Learn,
 * Practice, You) and the section tags ("Ask about this", "Your place") render at 11 px at both
 * 390 and 1440 — six elements on /chat and four on /doubt. The ink law is about the ink, so it was
 * not scored against craft; it is still the smallest type a learner reads, and it is under the
 * number this product wrote down.
 *
 * This holds the floor where the product's shared furniture is defined. The admin console and the
 * landing page's picture-of-a-phone are deliberately out of scope: one is a staff tool, the other
 * is an illustration of a screen rather than a screen.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(import.meta.dir, 'ui.css'), 'utf8');

/** Every type size the sheet sets, however it spells it, with the rule it belongs to. */
function sizes(css: string): { size: number; where: string }[] {
  const found: { size: number; where: string }[] = [];
  const lines = css.split('\n');
  for (const line of lines) {
    for (const m of line.matchAll(/font(?:-size)?\s*:\s*(?:[^;{]*?\s)?(\d+(?:\.\d+)?)px/g)) {
      found.push({ size: Number(m[1]), where: line.trim().slice(0, 90) });
    }
  }
  return found;
}

describe('the app never writes under twelve pixels', () => {
  it('finds the type sizes it is measuring', () => {
    expect(sizes(CSS).length).toBeGreaterThan(20);
  });

  it('sets no type under 12 px anywhere in the shared furniture', () => {
    const small = sizes(CSS).filter((s) => s.size < 12);
    expect(small.map((s) => `${s.size}px — ${s.where}`)).toEqual([]);
  });
});
