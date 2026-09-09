import { describe, expect, it } from 'bun:test';
import { type BoardRect, boxesOverlap, frameOf } from '../../src/board/anchors';
import {
  autoCameraTarget,
  avoidCollisions,
  boardArea,
  CAMERA_FILL_MAX,
  CAMERA_FILL_MIN,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  cameraBox,
  contentBounds,
  fitCamera,
  flowRows,
  LABEL_MARGIN,
  needsCamera,
  placeLabel,
  RESTING_CAMERA,
} from '../../src/board/layout';

const frame = frameOf({ x: 0, y: 0, width: 1000, height: 620 });

describe('labels go beside the thing they name, never on it', () => {
  const anchor = { x: 100, y: 100, w: 80, h: 40 };

  it('takes the right-hand side when it is free', () => {
    const placed = placeLabel(anchor, { w: 60, h: 26 });
    expect(placed.x).toBe(anchor.x + anchor.w + LABEL_MARGIN);
    expect(boxesOverlap(placed, anchor)).toBe(false);
  });

  it('moves to another side when the right is taken', () => {
    const blocker = { x: 190, y: 100, w: 80, h: 40 };
    const placed = placeLabel(anchor, { w: 60, h: 26 }, [blocker]);
    expect(boxesOverlap(placed, blocker, LABEL_MARGIN * 0.5)).toBe(false);
    expect(boxesOverlap(placed, anchor)).toBe(false);
  });

  it('pushes down the margin when every side is taken', () => {
    const occupied = [
      { x: 0, y: 0, w: 400, h: 400 },
      { x: 0, y: 400, w: 400, h: 80 },
    ];
    const placed = placeLabel(anchor, { w: 60, h: 26 }, occupied);
    for (const o of occupied) expect(boxesOverlap(placed, o, LABEL_MARGIN * 0.5)).toBe(false);
  });

  it('stays inside the board it is given', () => {
    const area = { x: 0, y: 0, w: 200, h: 200 };
    const placed = placeLabel({ x: 160, y: 20, w: 30, h: 20 }, { w: 60, h: 26 }, [], area);
    expect(placed.x + placed.w).toBeLessThanOrEqual(area.x + area.w + 0.001);
  });
});

describe('objects are placed so nothing collides', () => {
  it('nudges a clash downward and keeps reading order', () => {
    const placed = avoidCollisions([
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 0, y: 10, w: 100, h: 40 },
    ]);
    expect(placed[0]).toEqual({ x: 0, y: 0, w: 100, h: 40 });
    expect(placed[1]?.y).toBeGreaterThanOrEqual(40);
  });

  it('flows a derivation left to right and wraps', () => {
    const rows = flowRows(
      [
        { w: 200, h: 40 },
        { w: 200, h: 40 },
        { w: 200, h: 40 },
      ],
      { x: 0, y: 0, w: 430, h: 400 },
      10,
    );
    expect(rows[0]?.x).toBe(0);
    expect(rows[1]?.x).toBe(210);
    expect(rows[2]).toEqual({ x: 0, y: 50, w: 200, h: 40 });
  });
});

describe('the camera follows the ink', () => {
  it('rests when the board is empty', () => {
    expect(contentBounds([])).toBeNull();
    expect(fitCamera(null, frame)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  /** How much of the visible box the ink actually fills, on its limiting axis. */
  const fillOf = (bounds: { x: number; y: number; w: number; h: number }) => {
    const cam = fitCamera(bounds, frame);
    const view = cameraBox(cam, frame);
    return { cam, view, fill: Math.max(bounds.w / view.w, bounds.h / view.h) };
  };

  it('fits three objects to the box instead of leaving them at a fifth of it', () => {
    // Three small marks in one corner — the failure this replaced showed them at ~0.2 of the box.
    const bounds = contentBounds([
      { x: 100, y: 100, w: 60, h: 30 },
      { x: 180, y: 100, w: 60, h: 30 },
      { x: 100, y: 150, w: 140, h: 30 },
    ]) as { x: number; y: number; w: number; h: number };
    const { cam, fill } = fillOf(bounds);
    expect(cam.zoom).toBeGreaterThan(1);
    expect(fill).toBeGreaterThanOrEqual(CAMERA_FILL_MIN);
    expect(fill).toBeLessThanOrEqual(CAMERA_FILL_MAX);
  });

  it('centres the ink in the box it shows', () => {
    const bounds = { x: 120, y: 90, w: 240, h: 120 };
    const { cam, view } = fillOf(bounds);
    expect(view.x + view.w / 2).toBeCloseTo(bounds.x + bounds.w / 2, 6);
    expect(view.y + view.h / 2).toBeCloseTo(bounds.y + bounds.h / 2, 6);
    expect(cam.zoom).toBeLessThanOrEqual(CAMERA_MAX_ZOOM);
  });

  it('keeps the aspect: one zoom for both axes, whatever the shape of the ink', () => {
    const wide = fitCamera({ x: 0, y: 0, w: 600, h: 40 }, frame);
    const tall = fitCamera({ x: 0, y: 0, w: 40, h: 400 }, frame);
    for (const cam of [wide, tall]) {
      const view = cameraBox(cam, frame);
      // The window keeps the surface's own aspect — nothing is stretched to make the ink fit.
      expect(view.w / view.h).toBeCloseTo(1000 / 620, 6);
    }
  });

  it('grows the camera as the ink grows, one board at a time', () => {
    const zooms = [
      fitCamera({ x: 400, y: 300, w: 80, h: 40 }, frame).zoom,
      fitCamera({ x: 400, y: 300, w: 300, h: 160 }, frame).zoom,
      fitCamera({ x: 400, y: 300, w: 700, h: 420 }, frame).zoom,
    ];
    expect(zooms[0]).toBeGreaterThan(zooms[1] as number);
    expect(zooms[1]).toBeGreaterThan(zooms[2] as number);
  });

  it('zooms out when the ink has outgrown the view', () => {
    const bounds = contentBounds([{ x: 0, y: 0, w: 2000, h: 300 }]);
    const cam = fitCamera(bounds, frame);
    expect(cam.zoom).toBeLessThan(1);
    expect(cam.zoom).toBeGreaterThanOrEqual(CAMERA_MIN_ZOOM);
  });

  it('knows when it has to move at all', () => {
    expect(needsCamera({ x: 10, y: 10, w: 100, h: 100 }, frame)).toBe(false);
    expect(needsCamera({ x: 900, y: 10, w: 300, h: 100 }, frame)).toBe(true);
    expect(needsCamera(null, frame)).toBe(false);
  });

  it('the board area is 1000 wide by the surface’s own aspect', () => {
    expect(boardArea(frame)).toEqual({ x: 0, y: 0, w: 1000, h: 620 });
  });
});

describe('the camera fits the INK, not the padding round it (the adversary, wave 47, finding 4)', () => {
  // layout.ts states the law of the ink: "it fills CAMERA_FILL of the limiting dimension, which
  // leaves an eighth of the box clear on each side". The renderer measured it against
  // `contentBounds(...)` WITH its default 28-unit padding on the settled half, so the margin was
  // charged twice. At 1440 the Pythagoras ink (198 x 240 units) filled 27.9% of the visible width
  // and 59.5% of its height against a law of 78%, and landed as 138 x 168 px on the screen.
  const PLANE_1440 = frameOf({ x: 0, y: 0, width: 496, height: 282 }, { zoom: 1 });
  const fill = (boxes: BoardRect[], frame = PLANE_1440) => {
    const view = cameraBox(autoCameraTarget(boxes, [], frame), frame);
    const ink = contentBounds(boxes, 0) as BoardRect;
    return Math.max(ink.w / view.w, ink.h / view.h);
  };

  it('puts the pythagoras ink inside the fill band at 1440', () => {
    const ink: BoardRect[] = [{ x: 400, y: 180, w: 198, h: 240 }];
    expect(fill(ink)).toBeGreaterThanOrEqual(CAMERA_FILL_MIN);
    expect(fill(ink)).toBeLessThanOrEqual(CAMERA_FILL_MAX);
  });

  it('does the same for a wide board where width is the limiting side', () => {
    const ink: BoardRect[] = [{ x: 0, y: 0, w: 620, h: 120 }];
    expect(fill(ink)).toBeGreaterThanOrEqual(CAMERA_FILL_MIN);
  });

  it('fits ink still being drawn together with the ink already settled', () => {
    const settled: BoardRect[] = [{ x: 400, y: 180, w: 198, h: 140 }];
    const floating: BoardRect[] = [{ x: 400, y: 320, w: 198, h: 100 }];
    const view = cameraBox(autoCameraTarget(settled, floating, PLANE_1440), PLANE_1440);
    const all = contentBounds([...settled, ...floating], 0) as BoardRect;
    expect(Math.max(all.w / view.w, all.h / view.h)).toBeGreaterThanOrEqual(CAMERA_FILL_MIN);
  });

  it('leaves a clear margin on every side — the fit is never a crop', () => {
    const ink: BoardRect[] = [{ x: 400, y: 180, w: 198, h: 240 }];
    const view = cameraBox(autoCameraTarget(ink, [], PLANE_1440), PLANE_1440);
    const box = ink[0] as BoardRect;
    expect(box.x).toBeGreaterThan(view.x);
    expect(box.y).toBeGreaterThan(view.y);
    expect(box.x + box.w).toBeLessThan(view.x + view.w);
    expect(box.y + box.h).toBeLessThan(view.y + view.h);
  });

  it('rests when there is nothing drawn at all', () => {
    expect(autoCameraTarget([], [], PLANE_1440)).toEqual(RESTING_CAMERA);
  });
});
