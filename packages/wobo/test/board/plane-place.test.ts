/**
 * The board opens where the learner can see it (docs/BOARD.md §11): never under the drawer that
 * asked for it. Measured on 2026-09-05 at 1280x520: the plane opened at x 656 and the Companion
 * drawer (x 860 onward) covered its pin/hide/close controls and the right end of the number line.
 */

import { describe, expect, it } from 'bun:test';
import {
  ENTRANCE_FALL_PX,
  PHONE_SHEET_VH,
  placeClearOf,
  plane,
  planeEntrance,
  SHEET_ENTRANCE_SCALE,
  sheetReserve,
} from '../../src/board/plane';

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

/**
 * WHERE THE ENTRANCE BEGINS (the judge, wave 61, finding 1; INK-FOUR craft and timing).
 *
 * BOARD.md §5: "The plane slides in from the orb." The slide was aimed from the wrong centre. The
 * offset was `origin − centre(state.rect)`, and `state.rect` is the 520x360 box a plane is given on
 * a WIDE screen — on a phone the plane is a full-width sheet across the lower 62vh and never uses
 * that rect at all, and on a wide screen the rect is still {0,0} at first paint because the placer
 * is an effect. So the plane's first painted frame was nowhere near the glass.
 *
 * MEASURED ON 2026-09-15 on the running app, before a line of this changed
 * (`apps/web-pwa/tests/plane-entrance.spec.ts` holds the same law on a real screen):
 *   390x844  — first frame top 882, bottom 1337, right 418: the whole sheet below an 844 px screen,
 *              the board's first object painted at y = 1173, nothing on the glass for 79 ms.
 *   1440x900 — first frame top 1000, left 1859, right 2313: off the bottom AND 873 px off the right.
 * Reduced motion was already right at both widths and stays right: it has no entrance at all.
 *
 * THE LAW. A plane enters from the orb and never from off the glass: the offset aims its centre at
 * the orb and is then clamped so the box it starts in lies inside the viewport. And a SHEET does not
 * fly — it is anchored to an edge, so it grows off that edge and never translates, which is both
 * the platform's grammar and the only entrance that cannot take the ink off the screen.
 */
describe('the plane never enters from off the glass', () => {
  const phone = { w: 390, h: 844 };
  const sheet = {
    x: 0,
    y: 844 - Math.round((844 * PHONE_SHEET_VH) / 100),
    w: 390,
    h: Math.round((844 * PHONE_SHEET_VH) / 100),
  };
  const orb = { x: 318, y: 748 };

  const started = (box: typeof sheet, e: { x: number; y: number; scale: number }) => {
    const insetX = ((1 - e.scale) * box.w) / 2;
    const insetY = ((1 - e.scale) * box.h) / 2;
    return {
      left: box.x + e.x + insetX,
      right: box.x + box.w + e.x - insetX,
      top: box.y + e.y + insetY,
      bottom: box.y + box.h + e.y - insetY,
    };
  };

  it('a sheet grows off its own edge and never translates', () => {
    const e = planeEntrance(sheet, orb, phone, true);
    expect({ x: e.x, y: e.y }).toEqual({ x: 0, y: 0 });
    expect(e.scale).toBe(SHEET_ENTRANCE_SCALE);
    expect(e.transformOrigin).toBe('bottom center');
  });

  it('at 390 the sheet’s first frame is on the glass, where it used to start at 882 on an 844 px screen', () => {
    const e = planeEntrance(sheet, orb, phone, true);
    // Pinned to its own bottom edge and grown from under 1, so every edge of the first frame is
    // inside the resting box, which is itself inside the screen. Nothing can be off the glass.
    const first = {
      left: sheet.x + (sheet.w * (1 - e.scale)) / 2 + e.x,
      right: sheet.x + sheet.w - (sheet.w * (1 - e.scale)) / 2 + e.x,
      top: sheet.y + sheet.h * (1 - e.scale) + e.y,
      bottom: sheet.y + sheet.h + e.y,
    };
    expect({
      top: first.top >= 0,
      bottom: first.bottom <= phone.h,
      left: first.left >= 0,
      right: first.right <= phone.w,
    }).toEqual({ top: true, bottom: true, left: true, right: true });
  });

  it('a panel aims its centre at the orb', () => {
    const box = { x: 100, y: 100, w: 400, h: 300 };
    const e = planeEntrance(box, { x: 400, y: 400 }, { w: 1440, h: 900 }, false);
    // Centre (300,250) to the orb (400,400): 100 right and 150 down, with room to spare either way.
    expect({ x: e.x, y: e.y }).toEqual({ x: 100, y: 150 });
  });

  it('at 1440 the panel stops at the edge instead of flying past it', () => {
    const box = { x: 816, y: 408, w: 520, h: 360 };
    const viewport = { w: 1440, h: 900 };
    const e = planeEntrance(box, { x: 1368, y: 804 }, viewport, false);
    const s = started(box, e);
    expect({
      top: s.top >= 0,
      bottom: s.bottom <= viewport.h,
      left: s.left >= 0,
      right: s.right <= viewport.w,
    }).toEqual({ top: true, bottom: true, left: true, right: true });
    // It still travels — the clamp takes the excess, not the gesture.
    expect(e.y).toBeGreaterThan(0);
  });

  it('with no orb to come from it falls a hand’s width, and that is clamped too', () => {
    const box = { x: 100, y: 100, w: 400, h: 300 };
    expect(planeEntrance(box, null, { w: 1440, h: 900 }, false).y).toBe(ENTRANCE_FALL_PX);
    // A box already against the bottom falls only as far as the room under it allows.
    expect(
      planeEntrance({ x: 100, y: 600, w: 400, h: 300 }, null, { w: 1440, h: 900 }, false).y,
    ).toBeLessThan(ENTRANCE_FALL_PX);
  });

  it('a plane larger than the screen does not move at all', () => {
    const box = { x: -280, y: -250, w: 2000, h: 1400 };
    const e = planeEntrance(box, { x: 1368, y: 804 }, { w: 1440, h: 900 }, false);
    expect({ x: e.x, y: e.y }).toEqual({ x: 0, y: 0 });
  });
});

/**
 * A PLACE IS NOT A PAIR OF ZEROES (found while wiring the entrance, 2026-09-15).
 *
 * The placer asked `rect.x !== 0 || rect.y !== 0` to decide whether a plane had ever been put
 * somewhere. That is a sentinel a learner can reach: drag the panel until its corner sits on the
 * screen's corner and the plane reads as never placed, so the placer takes it back to the lower
 * right out from under the hand that was moving it. While only an effect read it that cost a frame
 * nobody saw; the entrance reads it during render now, and the snap would be on the first painted
 * frame. A flag cannot be dragged onto.
 */
describe('a plane knows it has been placed', () => {
  it('starts unplaced, and is placed the moment anything moves it', () => {
    plane.close();
    expect(plane.get().placed).toBe(false);
    plane.move({ x: 0, y: 0 });
    expect(plane.get().placed).toBe(true);
  });

  it('stays placed when the learner drags it onto the corner the sentinel used to mean', () => {
    plane.move({ x: 0, y: 0 });
    expect({ rect: plane.get().rect.x, placed: plane.get().placed }).toEqual({
      rect: 0,
      placed: true,
    });
  });
});
