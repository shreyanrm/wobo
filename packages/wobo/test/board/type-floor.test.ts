import { describe, expect, it } from 'bun:test';
import { frameOf, pxPerUnit } from '../../src/board/anchors';
import {
  geometryOf,
  LABEL_SIZE,
  MIN_TYPE_PX,
  MIN_WRITTEN_UNITS,
  scaledType,
  tallestGlyphUnits,
} from '../../src/board/geometry';
import { CAMERA_FILL, CAMERA_FILL_MAX } from '../../src/board/layout';
import {
  type Built,
  MAX_TYPE_SCALE,
  smallestTypePx,
  TYPE_LADDER,
  typeFillFor,
} from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * THE WRITTEN-TYPE FLOOR (INK-FOUR craft; the adversary, wave 47 finding 3 and wave 48 finding 5).
 *
 * "Labels at least 12 px on the glass." The trap `geometry.ts` documents is that a floor read off
 * the live camera closes a loop — the type it grows widens the ink the camera is fitted to. The
 * way out is in the algebra: under an auto fit the zoom cancels, and what decides legibility is
 * the glyph's height as a fraction of the ink's own extent. These tests pin that shape.
 */

const frame = frameOf({ x: 0, y: 0, width: 496, height: 282 });

const built = (box: { x: number; y: number; w: number; h: number }, glyphH: number): Built =>
  ({
    state: { object: { id: 'x', kind: 'label' } },
    geometry: {
      strokes: [],
      glyphs: glyphH ? [{ trace: [], box: { x: box.x, y: box.y, w: 10, h: glyphH } }] : [],
      box,
      length: 0,
    },
    durMs: 0,
    slots: [],
    sig: '',
    gone: false,
  }) as unknown as Built;

describe('one factor for the board’s writing', () => {
  it('leaves the hand’s own sizes alone at or below 1', () => {
    expect(scaledType({}, LABEL_SIZE)).toBe(LABEL_SIZE);
    expect(scaledType({ typeScale: 1 }, LABEL_SIZE)).toBe(LABEL_SIZE);
    expect(scaledType({ typeScale: 0.5 }, LABEL_SIZE)).toBe(LABEL_SIZE);
  });

  it('multiplies every written size by the same factor', () => {
    expect(scaledType({ typeScale: 1.5 }, LABEL_SIZE)).toBe(LABEL_SIZE * 1.5);
    expect(scaledType({ typeScale: 1.5 }, 30)).toBe(45);
  });

  it('the ladder only ever climbs, and never past the cap', () => {
    expect([...TYPE_LADDER]).toEqual([...TYPE_LADDER].sort((a, b) => a - b));
    expect(TYPE_LADDER[0]).toBeGreaterThan(1);
    expect(TYPE_LADDER[TYPE_LADDER.length - 1]).toBe(MAX_TYPE_SCALE);
  });

  it('writes bigger glyphs when the factor rises', () => {
    const label = {
      id: 'l',
      kind: 'label',
      anchor: { board: [200, 200] },
      text: 'vacuole',
    } as BoardObject;
    const ctx = { frame, font: null, targetRect: () => null, focusRect: () => null, objectBox: () => null };
    const small = geometryOf(label, ctx as never);
    const big = geometryOf(label, { ...ctx, typeScale: 1.75 } as never);
    // The factor multiplies what the board actually writes, and on a board that is the hand's own
    // label size held up to `MIN_WRITTEN_UNITS` (the adversary, wave 51, finding 1 — a label under
    // the floor is illegible whether or not a factor is applied to it). See board-type-floor.test.
    const base = Math.max(LABEL_SIZE, MIN_WRITTEN_UNITS);
    expect(small?.size).toBe(base);
    expect(big?.size).toBeCloseTo(base * 1.75, 5);
  });
});

describe('the ruler the law is written in', () => {
  it('reports the tallest single glyph, in board units', () => {
    expect(
      tallestGlyphUnits({
        strokes: [],
        glyphs: [
          { trace: [], box: { x: 0, y: 0, w: 4, h: 9 } },
          { trace: [], box: { x: 4, y: 0, w: 4, h: 14 } },
        ],
        box: { x: 0, y: 0, w: 8, h: 14 },
        length: 0,
      }),
    ).toBe(14);
  });

  it('measures the smallest written glyph through the camera the board is fitted with', () => {
    // One 200-unit-wide board of ink with a 14-unit glyph on a 496 px surface.
    const board = [built({ x: 0, y: 0, w: 200, h: 100 }, 14)];
    const px = smallestTypePx(board, { ...frame, zoom: 1 }, true, CAMERA_FILL);
    // px = fill · frame.width · glyphUnits / inkWidth — the camera cancels out (see geometry.ts).
    expect(px).toBeCloseTo((CAMERA_FILL * 496 * 14) / 200, 1);
  });

  it('falls back to the surface’s own scale when nothing is fitted', () => {
    const board = [built({ x: 0, y: 0, w: 200, h: 100 }, 14)];
    expect(smallestTypePx(board, { ...frame, zoom: 1 }, false)).toBeCloseTo(
      14 * pxPerUnit({ ...frame, zoom: 1 }),
      5,
    );
  });

  it('says nothing about a board with no writing on it', () => {
    expect(smallestTypePx([built({ x: 0, y: 0, w: 200, h: 100 }, 0)], frame, true)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('the margin gives before the type does', () => {
  it('keeps the ordinary fill when the writing already clears the floor', () => {
    // A big glyph on a small board: nothing to rescue.
    expect(typeFillFor([built({ x: 0, y: 0, w: 200, h: 100 }, 40)], frame, true)).toBe(CAMERA_FILL);
  });

  it('tightens the margin, within the band, when the writing is short of the floor', () => {
    const board = [built({ x: 0, y: 0, w: 900, h: 300 }, 14)];
    const fill = typeFillFor(board, frame, true);
    expect(fill).toBeGreaterThan(CAMERA_FILL);
    expect(fill).toBeLessThanOrEqual(CAMERA_FILL_MAX);
  });

  it('never touches the margin on a surface with no auto fit', () => {
    expect(typeFillFor([built({ x: 0, y: 0, w: 900, h: 300 }, 4)], frame, false)).toBe(CAMERA_FILL);
  });

  it('a board that clears the floor by this ruler clears the law', () => {
    const board = [built({ x: 0, y: 0, w: 200, h: 100 }, 14)];
    expect(smallestTypePx(board, { ...frame, zoom: 1 }, true, CAMERA_FILL)).toBeGreaterThan(
      MIN_TYPE_PX,
    );
  });
});
