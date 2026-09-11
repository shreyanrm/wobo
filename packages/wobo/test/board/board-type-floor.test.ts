import { beforeAll, describe, expect, it } from 'bun:test';
import projectilePlan from './fixtures/projectile-board.json' with { type: 'json' };
import { type BoardFrame, frameOf } from '../../src/board/anchors';
import {
  geometryOf,
  LABEL_SIZE,
  lineMeasure,
  LINE_MEASURE,
  MIN_TYPE_PX,
  MIN_WRITTEN_UNITS,
  WRITE_SIZE,
} from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX } from '../../src/board/layout';
import { buildObjects, smallestTypePx, TYPE_LADDER } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * THE 12 PX LAW ON A BOARD THE TYPE LADDER CANNOT SAVE (the adversary, wave 51, finding 1;
 * INK-FOUR craft, "labels at least 12 px on the glass").
 *
 * `type-floor.test.ts` pins the one factor the renderer solves. These tests pin the two things
 * `geometry.ts` owns, and they are here because the factor alone does not close the law: on a
 * board whose ink is mostly writing, growing the type widens the ink the camera is fitted to and
 * the camera gives back exactly what was gained. The plan under test is the real projectile board,
 * captured off the wire, on the real surfaces the plane gives it at 390 and at 1440.
 */

const FONT_PATH = new URL(
  '../../../../apps/web-pwa/public/fonts/Caveat-Regular.ttf',
  import.meta.url,
).pathname;

let font: HandFont | null = null;
beforeAll(async () => {
  font = await parseHandFont(await Bun.file(FONT_PATH).arrayBuffer());
});

/** The board plane's own canvas, measured on the running app. */
const PHONE = frameOf({ x: 12, y: 438.73, width: 366, height: 333.27 });
const DESKTOP = frameOf({ x: 828, y: 474, width: 496, height: 282 });
/** The glass: one unit is one pixel, and no camera ever moves it. */
const GLASS = frameOf({ x: 0, y: 0, width: 1000, height: 620 }, { scale: 1 });

function ctxOn(frame: BoardFrame, over: Record<string, unknown> = {}) {
  return {
    frame,
    targetRect: () => null,
    focusRect: () => null,
    objectBox: () => null,
    font,
    occupied: [],
    ...over,
  } as never;
}

/** Lay the whole plan the way the renderer does, at one factor. */
function layBoard(frame: BoardFrame, typeScale: number) {
  const states = (projectilePlan as BoardObject[]).map((object, i) => ({
    object,
    generation: 0,
    seq: i,
  }));
  return buildObjects(states as never, {
    frame,
    font,
    store: { anchorOf: (s: { object: { anchor?: unknown } }) => s.object.anchor ?? null },
    cache: new Map(),
    targets: () => [],
    focus: () => [],
    boxes: new Map(),
    occupied: [],
    typeScale,
  } as never);
}

/** The rung the renderer settles on: the first that clears its aim, else the best-measuring one. */
function settledRung(frame: BoardFrame): { k: number; px: number } {
  let best = { k: 1, px: smallestTypePx(layBoard(frame, 1), frame, true, CAMERA_FILL_MAX) };
  if (best.px >= MIN_TYPE_PX + 1.2) return best;
  for (const k of TYPE_LADDER as readonly number[]) {
    const px = smallestTypePx(layBoard(frame, k), frame, true, CAMERA_FILL_MAX);
    if (px >= MIN_TYPE_PX + 1.2) return { k, px };
    if (px > best.px) best = { k, px };
  }
  return best;
}

function smallestWrittenPx(frame: BoardFrame): number {
  return settledRung(frame).px;
}

/** Pairs of WRITTEN marks whose boxes cross — never one wholly inside another (a cell in a table). */
function writtenClashes(frame: BoardFrame, typeScale: number): string[] {
  const built = layBoard(frame, typeScale) as unknown as {
    state: { object: { id: string } };
    geometry: { glyphs: unknown[]; box: { x: number; y: number; w: number; h: number } } | null;
  }[];
  const w = built.filter((b) => b.geometry && b.geometry.glyphs.length > 0);
  const out: string[] = [];
  for (let i = 0; i < w.length; i += 1)
    for (let j = i + 1; j < w.length; j += 1) {
      const a = w[i]?.geometry?.box;
      const b = w[j]?.geometry?.box;
      if (!a || !b) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const inside =
        (a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h) ||
        (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h);
      if (ox > 6 && oy > 6 && !inside)
        out.push(`${w[i]?.state.object.id}×${w[j]?.state.object.id}`);
    }
  return out;
}

describe('the real projectile board clears the law at both widths', () => {
  it('at 390, where the ladder is flat and only the measure moves it', () => {
    expect(smallestWrittenPx(PHONE)).toBeGreaterThanOrEqual(MIN_TYPE_PX);
  });

  it('at 1440, where the window is wide and only the floor moves it', () => {
    expect(smallestWrittenPx(DESKTOP)).toBeGreaterThanOrEqual(MIN_TYPE_PX);
  });

  it('writes nothing over anything else at the rung it settles on', () => {
    // The floor and the measure both make the writing bigger relative to the drawing, and two
    // notes hung off the same small mark can then run out of board and land on each other. They
    // must not: a side that is taken is not a side (`notePlacement`).
    expect(writtenClashes(PHONE, settledRung(PHONE).k)).toEqual([]);
    expect(writtenClashes(DESKTOP, settledRung(DESKTOP).k)).toEqual([]);
  });

  it('writes nothing over anything else at ANY rung of the ladder', () => {
    for (const k of [1, ...(TYPE_LADDER as readonly number[])]) {
      expect(writtenClashes(PHONE, k)).toEqual([]);
      expect(writtenClashes(DESKTOP, k)).toEqual([]);
    }
  });

  it('names the three objects the wave-51 judge measured under 12 px', () => {
    // 'apex', 'up-speed is zero here' and the ground axis's own label — the LABEL-sized half of
    // the board, beside WRITE-sized numbers that always cleared it.
    const ids = (projectilePlan as BoardObject[])
      .filter((o) => o.kind === 'label' || o.kind === 'write' || o.kind === 'axis')
      .map((o) => o.id);
    expect(ids).toEqual(['p0_1ground', 'p0_5apex', 'p0_7apexnote']);
  });
});

describe('the hand’s smallest writing on a board', () => {
  const label = {
    id: 'l',
    kind: 'label',
    anchor: { board: [400, 400] },
    text: 'apex',
    size: 22,
  } as BoardObject;

  it('floors a size the pipeline asked for, when the pipeline asked for too little', () => {
    expect(geometryOf(label, ctxOn(PHONE))?.size).toBe(MIN_WRITTEN_UNITS);
    expect(MIN_WRITTEN_UNITS).toBeGreaterThan(LABEL_SIZE);
  });

  it('leaves a size the pipeline asked for alone when it already clears the floor', () => {
    const big = { ...label, size: 44 } as BoardObject;
    expect(geometryOf(big, ctxOn(PHONE))?.size).toBe(44);
  });

  it('keeps the hand’s own proportion above the floor: a note is bigger than a label', () => {
    expect(WRITE_SIZE).toBeGreaterThan(MIN_WRITTEN_UNITS);
  });

  it('never touches the glass, where one unit is already one pixel', () => {
    expect(geometryOf(label, ctxOn(GLASS))?.size).toBe(22);
  });

  it('multiplies from the floor, not from what was asked for', () => {
    expect(geometryOf(label, ctxOn(PHONE, { typeScale: 1.5 }))?.size).toBeCloseTo(
      MIN_WRITTEN_UNITS * 1.5,
      5,
    );
  });
});

describe('a written line has a measure', () => {
  const long =
    'the ball leaves the ground at twenty metres a second and comes back down forty metres away';

  it('opens the measure with the window, and never closes it on the glass', () => {
    expect(lineMeasure(PHONE)).toBeCloseTo(LINE_MEASURE * (366 / 333.27), 3);
    expect(lineMeasure(DESKTOP)).toBeCloseTo(LINE_MEASURE * (496 / 282), 3);
    expect(lineMeasure(GLASS)).toBe(Number.POSITIVE_INFINITY);
  });

  it('holds a long note to it, and reports the lines it actually wrote', () => {
    const g = geometryOf(
      { id: 'w', kind: 'write', anchor: { board: [300, 300] }, text: long } as BoardObject,
      ctxOn(PHONE),
    );
    expect(g?.text?.lines.length).toBeGreaterThan(1);
    expect(g?.text?.lines.join(' ')).toBe(long);
    expect(g?.box.w).toBeLessThanOrEqual(lineMeasure(PHONE) + 1);
  });

  it('writes the same note as one line on the glass', () => {
    const g = geometryOf(
      { id: 'w', kind: 'write', anchor: { board: [300, 300] }, text: long } as BoardObject,
      ctxOn(GLASS),
    );
    expect(g?.text?.lines).toEqual([long]);
  });

  it('still honours a narrower measure the pipeline asked for', () => {
    const g = geometryOf(
      {
        id: 'w',
        kind: 'write',
        anchor: { board: [300, 300] },
        text: long,
        maxWidth: 120,
      } as BoardObject,
      ctxOn(PHONE),
    );
    expect(g?.box.w).toBeLessThanOrEqual(121);
  });

  it('never breaks a quantity across two lines', () => {
    const g = geometryOf(
      {
        id: 'n',
        kind: 'number',
        anchor: { board: [300, 300] },
        label: 'the greatest height it reaches on the way',
        value: 10.197162,
        precision: 2,
        unit: 'm',
      } as BoardObject,
      ctxOn(PHONE),
    );
    const lines = g?.text?.lines ?? [];
    expect(lines.length).toBeGreaterThan(1);
    // The quantity is one word: some line carries '10.20 m' whole, and none carries it in halves.
    expect(lines.some((l) => l.includes('10.20 m'))).toBe(true);
    expect(lines.filter((l) => l.includes('10.20') || /(^|\s)m$/.test(l)).length).toBe(1);
  });

  it('places a wrapped note as the box it will really be, not as one line', () => {
    // A two-line note reported as one line is placed over whatever sits under it.
    const anchor = { x: 300, y: 300, w: 40, h: 40 };
    const g = geometryOf(
      { id: 'w', kind: 'write', anchor: { board: [320, 320] }, text: long } as BoardObject,
      ctxOn(PHONE, { objectBox: () => anchor }),
    );
    const lineHeight = (g?.text?.size ?? 0) * 1.22;
    expect(g?.box.h).toBeGreaterThan(lineHeight * 1.5);
  });
});
