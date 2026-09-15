import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { inkBoxOf } from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, INK_NIB_PX } from '../../src/board/layout';
import { boardPxPerUnit, buildObjects, settleBoardScales } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * `{at: "center"}` MEANS INSIDE THE THING IT NAMES (the judge, 2026-09-15: pythagoras, both widths).
 *
 * The nine belongs inside the square whose area is nine. The pipeline used to say that by working
 * out the middle itself and handing over a bare `board(x, y)` — which is the WRITING ORIGIN, not a
 * centre, and goes nowhere near the solver — so the nine was painted low in its square and across
 * its bottom stroke, and the sixteen was painted through the triangle's upright. Now the numeral is
 * anchored to its square and `notePlacement` solves it in that square, from the middle outwards.
 *
 * `written-air.test.ts` counts what is STRUCK. It cannot count this, because a numeral written a
 * margin to the right of its square strikes nothing at all and is still the wrong drawing: the
 * square is what says the number is an area. So this file counts the other half of the same law —
 * every mark anchored `{object, at: "center"}` paints its whole ink inside that object's own ink,
 * a nib clear of every edge — on the same real plans, through the same renderer and camera, at both
 * widths.
 */

const FONT_PATH = new URL(
  '../../../../apps/web-pwa/public/fonts/Caveat-Regular.ttf',
  import.meta.url,
).pathname;
const BOARDS = new URL('./fixtures/boards', import.meta.url).pathname;

let font: HandFont | null = null;
beforeAll(async () => {
  font = await parseHandFont(await Bun.file(FONT_PATH).arrayBuffer());
});

/** The board plane's own canvas, measured on the running app — the same two as `written-air`. */
const SURFACE: Record<string, BoardFrame> = {
  '390': frameOf({ x: 12, y: 438.73, width: 366, height: 333.27 }),
  '1440': frameOf({ x: 828, y: 474, width: 496, height: 282 }),
};

const PLANS = ['maths-pythagoras-390', 'maths-pythagoras-1440'].map((name) => ({
  name,
  plan: JSON.parse(readFileSync(`${BOARDS}/${name}.json`, 'utf8')) as BoardObject[],
}));

function lay(plan: BoardObject[], frame: BoardFrame, typeScale: number, glassScale = 0) {
  const states = plan.map((object, i) => ({ object, generation: 0, seq: i }));
  const boxes = new Map<string, BoardRect>();
  return buildObjects(states as never, {
    frame,
    font,
    store: { anchorOf: (s: { object: { anchor?: unknown } }) => s.object.anchor ?? null },
    cache: new Map(),
    targets: () => [],
    focus: () => [],
    boxes,
    occupied: [],
    typeScale,
    ...(glassScale > 0 ? { glassScale } : {}),
  } as never);
}

/** Every centred mark, and the clear paper between its ink and its region's ink, in screen px. */
function centred(plan: BoardObject[], frame: BoardFrame) {
  const { typeScale, glassScale } = settleBoardScales(
    (t, g) => lay(plan, frame, t, g),
    frame,
    true,
    CAMERA_FILL_MAX,
  );
  const built = lay(plan, frame, typeScale, glassScale);
  const k = boardPxPerUnit(built, frame, true, CAMERA_FILL_MAX);
  const ink = new Map<string, BoardRect>();
  for (const b of built) {
    const g = (b as { geometry?: Parameters<typeof inkBoxOf>[0] }).geometry;
    if (g) ink.set(((b as { state: { object: BoardObject } }).state.object as { id: string }).id, inkBoxOf(g));
  }
  const out: { id: string; region: string; clearPx: number }[] = [];
  for (const object of plan) {
    const anchor = (object as { anchor?: { object?: string; at?: unknown } }).anchor;
    if (!anchor || anchor.at !== 'center' || typeof anchor.object !== 'string') continue;
    const mine = ink.get((object as { id: string }).id);
    const region = ink.get(anchor.object);
    if (!mine || !region) continue;
    out.push({
      id: (object as { id: string }).id,
      region: anchor.object,
      clearPx:
        Math.min(
          mine.x - region.x,
          region.x + region.w - (mine.x + mine.w),
          mine.y - region.y,
          region.y + region.h - (mine.y + mine.h),
        ) * k,
    });
  }
  return out;
}

describe('a centred mark is written inside the thing it names', () => {
  for (const { name, plan } of PLANS) {
    const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;

    it(`${name}: every {at: "center"} mark sits inside its own region, a nib clear of its edges`, () => {
      const marks = centred(plan, frame);
      // The three area numerals: nine, sixteen and twenty-five.
      expect(marks.map((m) => `${m.id} in ${m.region}`)).toEqual([
        'm0_4num in m0_3sqbase',
        'm0_6num in m0_5sqside',
        'm0_8num in m0_7sqhyp',
      ]);
      expect(
        marks.filter((m) => m.clearPx < INK_NIB_PX).map((m) => `${m.id} ${m.clearPx.toFixed(1)}px`),
      ).toEqual([]);
    });
  }
});
