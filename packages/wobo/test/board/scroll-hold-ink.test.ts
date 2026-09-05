/**
 * The two halves of "scroll during a stroke" (the owner, 2026-09-05), measured on the product's own
 * geometry and renderer helpers rather than asserted.
 */

import { describe, expect, it } from 'bun:test';
import { frameOf } from '../../src/board/anchors';
import { geometryOf } from '../../src/board/geometry';
import { strokesInFlight } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';
import { overlayInFlight } from '../../src/highlight-overlay';
import { SurfaceRegistry } from '../../src/registry';
import { scrollHold } from '../../src/scroll-hold';

const ring: BoardObject = {
  id: 'ring',
  kind: 'circle',
  anchor: { target: 'tri-hyp' },
  pad: 8,
} as BoardObject;

/** The surface is the whole viewport; a target's rect is wherever the page has put it. */
function build(targetTop: number) {
  const frame = frameOf({ x: 0, y: 0, width: 1000, height: 800 });
  return geometryOf(ring, {
    frame,
    font: null,
    targetRect: () => ({ x: 300, y: targetTop, width: 120, height: 32 }),
    focusRect: () => null,
    objectBox: () => null,
  });
}

const numbers = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('a scroll mid-stroke does not tear the ink', () => {
  it('re-anchors the whole path by the scroll delta, so a half-drawn arc stays one arc', () => {
    // The page scrolls 120 px while the ring is half drawn. The ring's path is rebuilt from the
    // target's live rect every frame, so every point moves by the same delta: the drawn half and
    // the half still to come stay on one curve, rather than the first half being left behind.
    const before = build(400);
    const after = build(280);
    if (!before || !after) throw new Error('the ring has no geometry');
    expect(before.strokes.length).toBe(after.strokes.length);
    expect(before.strokes.length).toBeGreaterThan(0);
    const dy = after.box.y - before.box.y;
    expect(dy).toBeCloseTo(-120, 3); // 1000 px wide surface: one board unit is one pixel
    for (let i = 0; i < before.strokes.length; i += 1) {
      const a = numbers((before.strokes[i] as { d: string }).d);
      const b = numbers((after.strokes[i] as { d: string }).d);
      expect(a.length).toBe(b.length);
      expect((before.strokes[i] as { length: number }).length).toBeCloseTo(
        (after.strokes[i] as { length: number }).length,
        6,
      );
      for (let k = 0; k < a.length; k += 2) {
        expect((b[k] as number) - (a[k] as number)).toBeCloseTo(0, 1); // x unchanged
        expect((b[k + 1] as number) - (a[k + 1] as number)).toBeCloseTo(dy, 1); // y by the delta
      }
    }
  });
});

describe('the board holds the page only while a page-anchored stroke is mid-flight', () => {
  const built = (startAt: number, durMs: number, id = 'ring') => [
    { state: { object: { id }, startAt }, durMs },
  ];
  const onPage = new Set(['ring']);

  it('holds during the stroke and lets go on the frame it lands', () => {
    expect(strokesInFlight(built(1000, 300), onPage, 999, false)).toBe(false); // not started
    expect(strokesInFlight(built(1000, 300), onPage, 1001, false)).toBe(true);
    expect(strokesInFlight(built(1000, 300), onPage, 1299, false)).toBe(true);
    expect(strokesInFlight(built(1000, 300), onPage, 1300, false)).toBe(false); // landed
  });

  it('never holds for board-space ink — the page cannot move under it', () => {
    expect(strokesInFlight(built(1000, 300, 'axis'), onPage, 1100, false)).toBe(false);
  });

  it('never holds under reduced motion, where every stroke lands at once', () => {
    expect(strokesInFlight(built(1000, 300), onPage, 1100, true)).toBe(false);
  });
});

describe('the overlay holds the page only while a ring or a stroke is drawing on', () => {
  it('holds for a ring for its draw time and for a stroke for its own', () => {
    const marks = { highlights: [{ bornAt: 1000 }], annotations: [] };
    expect(overlayInFlight(marks, 1100, 0, false)).toBe(true);
    expect(overlayInFlight(marks, 1000 + 320, 0, false)).toBe(false);
    const stroke = { highlights: [], annotations: [{ bornAt: 1000, durationMs: 500 }] };
    expect(overlayInFlight(stroke, 1499, 0, false)).toBe(true);
    expect(overlayInFlight(stroke, 1500, 0, false)).toBe(false);
  });

  it('a pre-timeline turn ages from the dispatch clock', () => {
    const marks = { highlights: [{}], annotations: [] };
    expect(overlayInFlight(marks, 2100, 2000, false)).toBe(true);
    expect(overlayInFlight(marks, 2400, 2000, false)).toBe(false);
  });
});

describe('the registry re-anchors the instant the hold lets go', () => {
  it('through its own layout watch: a release bumps the version with no scroll event at all', () => {
    // The product wiring, not a hand-made subscription: give the registry a window to watch, so
    // `ensureLayoutWatch` arms, then hold and release with nothing scrolling. The release alone
    // must re-measure, because the scroll the hold could not refuse never fires a scroll event
    // the throttle would see in time.
    const g = globalThis as { window?: unknown };
    const had = g.window;
    g.window = new EventTarget();
    try {
      const registry = new SurfaceRegistry();
      const off = registry.addTarget('s', {
        id: 'chip',
        kind: 'chip',
        label: 'a chip',
        rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      });
      const before = registry.getVersion();
      scrollHold.set('stroke', true);
      expect(registry.getVersion()).toBe(before);
      scrollHold.set('stroke', false);
      expect(registry.getVersion()).toBe(before + 1);
      off();
    } finally {
      if (had === undefined) delete g.window;
      else g.window = had;
    }
  });

  it('bumps its version on release, so every consumer re-reads its rects', () => {
    // No window here, so the registry's layout watch is never armed; the seam it uses is the
    // shared hold's subscription, which is what is asserted.
    const registry = new SurfaceRegistry();
    const seen: boolean[] = [];
    const off = scrollHold.subscribe((held) => {
      seen.push(held);
      if (!held) registry.remeasure();
    });
    const before = registry.getVersion();
    scrollHold.set('t', true);
    expect(registry.getVersion()).toBe(before);
    scrollHold.set('t', false);
    expect(registry.getVersion()).toBe(before + 1);
    expect(seen).toEqual([true, false]);
    off();
  });
});
