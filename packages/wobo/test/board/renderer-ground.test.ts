import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frameOf } from '../../src/board/anchors';
import { buildObjects, type CacheEntry, spokenLabel } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';
import { BoardStore } from '../../src/board/store';

/**
 * INK TAKES THE COLOUR OF THE GROUND IT IS ON (docs/INK-FOUR.md, craft, both themes; wave 59, the
 * doubt turn at 390 and 1440 in the night theme).
 *
 * The board's ink token inverts with the theme — marker on paper by day, chalk on slate by night —
 * which is right for everything Wobo draws on the app's own surfaces. A photographed exercise book
 * is not one of those: it is white paper in both themes, and chalk on it is invisible. Measured on
 * the running doubt screen in the night theme, three marks were in the DOM at rest and a pixel diff
 * of the photo against the frame before the pen touched it found NOTHING — the learner was told
 * "The first step is not" and shown a page with no mark on it.
 *
 * So a target can declare its ground, and a mark on a paper ground (or hanging off a mark that is)
 * carries it into the tree, where one rule gives it the paper ink whatever the theme.
 */
const glass = frameOf({ x: 0, y: 0, width: 390, height: 844 }, { zoom: 1, scale: 1 });
const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h }) as DOMRect;

function built(objects: BoardObject[], targets: { id: string; getRect: () => DOMRect | null; ground?: 'paper' }[]) {
  const store = new BoardStore({ presentation: 'screen' });
  for (const o of objects) store.ink(o);
  return buildObjects(store.snapshot(), {
    frame: glass,
    font: null,
    store,
    cache: new Map<string, CacheEntry>(),
    targets: () => targets,
    focus: () => [],
    boxes: new Map(),
    occupied: [],
  });
}

describe('ink takes the colour of the ground it is on', () => {
  const line = { id: 'r3', getRect: () => rect(139, 142, 79, 6.6), ground: 'paper' as const };
  const button = { id: 'btn', getRect: () => rect(20, 600, 120, 40) };

  it('a mark on a photographed line is on paper', () => {
    const [cross] = built([{ id: 'x', kind: 'cross', anchor: { target: 'r3' } }], [line]);
    expect(cross?.ground).toBe('paper');
  });

  it('a mark hanging off a mark on paper is on paper too', () => {
    const out = built(
      [
        { id: 'x', kind: 'cross', anchor: { target: 'r3' } },
        { id: 'n', kind: 'note', anchor: { object: 'x' }, text: 'not quite' },
      ],
      [line],
    );
    expect(out.find((b) => b.state.object.id === 'n')?.ground).toBe('paper');
  });

  it('a mark on the app’s own surface declares nothing, and keeps the theme’s ink', () => {
    const [ring] = built([{ id: 'r', kind: 'ring', anchor: { target: 'btn' } }], [button, line]);
    expect(ring?.ground).toBeUndefined();
  });

  it('the tree carries the ground, and one rule gives paper the paper ink in both themes', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/board/renderer.tsx'), 'utf8');
    expect(src).toContain(`'data-wobo-ground'`);
    // the paper ink is a literal dark, never the theme token that inverts
    expect(src).toMatch(/\[data-wobo-ground="paper"\]\{[^}]*--wobo-ink:#0D0D10/);
  });
});

describe('a cross the hand placed beside its line says so', () => {
  it('the geometry of a cross on a photographed line is marked beside, and the label follows', () => {
    const cross: BoardObject = { id: 'x', kind: 'cross', anchor: { target: 'r3' } };
    const [b] = built([cross], [{ id: 'r3', getRect: () => rect(139, 142, 79, 6.6), ground: 'paper' }]);
    expect(b?.geometry?.beside).toBe(true);
    expect(spokenLabel(cross, undefined, { beside: true })).toBe('a cross beside r3');
    expect(spokenLabel(cross)).toBe('a cross through r3');
  });
});
