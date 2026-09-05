/**
 * The board opens where the learner can see it (docs/BOARD.md §11): never under the drawer that
 * asked for it. Measured on 2026-09-05 at 1280x520: the plane opened at x 656 and the Companion
 * drawer (x 860 onward) covered its pin/hide/close controls and the right end of the number line.
 */

import { describe, expect, it } from 'bun:test';
import { placeClearOf } from '../../src/board/plane';

const viewport = { w: 1280, h: 520 };
const size = { w: 520, h: 360 };
const drawer = { x: 860, y: 64, w: 420, h: 456 };

describe('where a fresh plane opens', () => {
  it('opens in the lower right when nothing is in the way', () => {
    expect(placeClearOf(viewport, size, [])).toEqual({ x: 656, y: 28 });
  });
  it('moves left of the Companion drawer rather than under it', () => {
    const at = placeClearOf(viewport, size, [drawer]);
    expect(at.x + size.w).toBeLessThanOrEqual(drawer.x);
    expect(at.x).toBe(860 - 520 - 16);
  });
  it('never leaves the screen on the left', () => {
    const at = placeClearOf({ w: 700, h: 520 }, size, [{ x: 280, y: 0, w: 420, h: 520 }]);
    expect(at.x).toBe(24);
  });
});
