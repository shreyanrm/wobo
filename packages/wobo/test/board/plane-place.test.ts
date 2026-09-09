/**
 * The board opens where the learner can see it (docs/BOARD.md §11): never under the drawer that
 * asked for it. Measured on 2026-09-05 at 1280x520: the plane opened at x 656 and the Companion
 * drawer (x 860 onward) covered its pin/hide/close controls and the right end of the number line.
 */

import { describe, expect, it } from 'bun:test';
import { PHONE_SHEET_VH, placeClearOf, sheetReserve } from '../../src/board/plane';

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

describe('the sheet never takes the sentence it is explaining (the adversary, wave 47, finding 10)', () => {
  // INK-FOUR, experience: "The page the learner is looking at is never taken away to make room for
  // the answer." At 390 the plane is a sheet across the lower 62vh, and it cut Wobo's own say in
  // half mid-line: on bio-punnett the learner read 'Dominant 3, recessive 1. Read the' and then
  // the sheet edge; on physics-lens the say was not on the screen at all. The reading surfaces
  // reserve the sheet's height while it is up, so the last line stays above its edge.
  it('reserves the sheet’s height while the sheet is up on a phone', () => {
    expect(sheetReserve({ open: true, minimized: false, phone: true })).toBe(`${PHONE_SHEET_VH}vh`);
  });

  it('reserves nothing on a wide screen, where the plane is a panel beside the page', () => {
    expect(sheetReserve({ open: true, minimized: false, phone: false })).toBe(null);
  });

  it('gives the page back the moment the sheet is minimised to its thumbnail', () => {
    expect(sheetReserve({ open: true, minimized: true, phone: true })).toBe(null);
  });

  it('reserves nothing when no board is open', () => {
    expect(sheetReserve({ open: false, minimized: false, phone: true })).toBe(null);
  });

  it('reserves exactly what the sheet takes, so nothing is scrolled further than it must be', () => {
    // The sheet's own frame is `height: 62vh` at `bottom: 0`; the reserve is the same number.
    expect(sheetReserve({ open: true, minimized: false, phone: true })).toBe('62vh');
  });
});
