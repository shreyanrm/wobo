/**
 * Where a written note ends up when the board is already full, and the graph that pushed every
 * label it drew off the bottom of itself.
 *
 * The teaching harness ran a live board turn on 2026-09-05 — "graph y = x^2 and draw the tangent
 * at x = 1" — measured the ink with `geometryOf`, and found the slope value at y = 1024 and the
 * note reading "slope here" at y = 1071, on a board that is 1000 units tall. Both were written
 * where nobody can read them, on the surface this product's whole premise rests on.
 *
 * Two causes, and this file is one test for each.
 *
 * 1. THE GRID WAS AN OBSTACLE. `renderer.tsx` pushes every drawn box into `occupied`, and a plotted
 *    graph rules a `grid` across the whole plotting area first. So every note anchored inside that
 *    area collided with it, and the placement loops step DOWN until they are clear — which, for a
 *    grid 700 units tall, means down and out. A grid is ruling rather than ink: a tutor writes over
 *    graph paper, which is what graph paper is for.
 *
 * 2. NOTHING KEPT A LABEL ON THE BOARD. Both placement loops stepped down up to 60 and 200 times
 *    with no bound at all, so a crowded board wrote off the bottom edge rather than accepting a
 *    tighter fit.
 */

import { describe, expect, it } from 'bun:test';
import { BOARD_UNITS } from '../../src/board/schema';
import { blocksLayout, placeLabel, placeLabelAt } from '../../src/board/layout';

/** The plot a graph rules first: the whole drawing area, 700 units of it. */
const GRID = { x: 120, y: 120, w: 760, h: 700 };
/** The point a tangent touches the curve at, roughly where the live board put it. */
const TOUCH = { x: 620, y: 684, w: 12, h: 12 };
const NOTE = { w: 100, h: 37 };

describe('a grid is ruling, not ink', () => {
  it('does not block a label, so a note inside a plot stays inside it', () => {
    expect(blocksLayout('grid')).toBe(false);
    expect(blocksLayout('curve')).toBe(true);
    expect(blocksLayout('write')).toBe(true);
  });

  it('places the slope note beside the point it names rather than under the whole graph', () => {
    const placed = placeLabelAt(TOUCH, NOTE, 'right', []);
    expect(placed).not.toBeNull();
    expect((placed as { y: number }).y).toBeLessThan(GRID.y + GRID.h);
  });
});

describe('a label never leaves the board', () => {
  it('stays inside the square when the named side is crowded all the way down', () => {
    // A column of obstacles from the touch point to the bottom edge: every step down clashes.
    const wall = Array.from({ length: 30 }, (_, i) => ({
      x: 600,
      y: 690 + i * 40,
      w: 300,
      h: 40,
    }));
    const placed = placeLabelAt(TOUCH, NOTE, 'right', wall);
    expect(placed).not.toBeNull();
    const box = placed as { x: number; y: number };
    expect(box.y + NOTE.h).toBeLessThanOrEqual(BOARD_UNITS);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it('stays inside the square when every side is taken', () => {
    const wall = Array.from({ length: 30 }, (_, i) => ({
      x: 0,
      y: 600 + i * 40,
      w: BOARD_UNITS,
      h: 40,
    }));
    const placed = placeLabel({ x: 400, y: 620, w: 40, h: 40 }, NOTE, wall);
    expect(placed.y + NOTE.h).toBeLessThanOrEqual(BOARD_UNITS);
  });
});

describe('an axis label stays on the board', () => {
  it('does not write "distance in metres" past the right edge', async () => {
    const { parseHandFont } = await import('../../src/board/handwriting');
    const { geometryOf } = await import('../../src/board/geometry');
    const { frameOf } = await import('../../src/board/anchors');
    const font = await parseHandFont(
      await Bun.file(
        new URL('../../../../apps/web-pwa/public/fonts/Caveat-Regular.ttf', import.meta.url)
          .pathname,
      ).arrayBuffer(),
    );
    // The projectile board's ground axis, exactly as `pipelines/physics.py` mints it: it starts at
    // x = 120 and runs 760 units, so its label was written from x = 890 and ran to 1040. The
    // teaching harness measured it there on 2026-09-05.
    const geometry = geometryOf(
      {
        id: 'ground',
        kind: 'axis',
        anchor: { board: [120, 820] },
        orientation: 'x',
        min: 0,
        max: 40.8,
        step: 6.8,
        length: 760,
        label: 'distance in metres',
        ticks: true,
      },
      {
        frame: frameOf({ x: 0, y: 0, width: 1440, height: 760 }),
        targetRect: () => null,
        focusRect: () => null,
        objectBox: () => null,
        font,
        occupied: [],
      },
    );
    expect(geometry).not.toBeNull();
    const box = (geometry as { box: { x: number; w: number } }).box;
    // Rounded: the shift is computed from the measured ink, so it lands exactly on the edge and
    // floating point leaves a 1e-13 tail behind it.
    expect(Math.round(box.x + box.w)).toBeLessThanOrEqual(BOARD_UNITS);
  });
});

describe('pulling a label onto the board never pushes it onto another label', () => {
  it('places a wide label near the right edge clear of the one before it', () => {
    // The last two events of a real timeline: the earlier label is wide and already placed, and
    // the later tick sits so far right that its own label has to be pulled back onto the board.
    // Clamping it AFTER the collision search slid it left, on top of the earlier one.
    const earlier = { x: 378, y: 457, w: 349, h: 27 };
    const tick = { x: 900, y: 430, w: 12, h: 12 };
    const placed = placeLabelAt(tick, { w: 309, h: 27 }, 'bottom', [earlier]);
    expect(placed).not.toBeNull();
    const box = placed as { x: number; y: number; w: number; h: number };
    expect(box.x + box.w).toBeLessThanOrEqual(BOARD_UNITS);
    expect(
      box.x < earlier.x + earlier.w && earlier.x < box.x + box.w && box.y < earlier.y + earlier.h,
    ).toBe(false);
  });
});
