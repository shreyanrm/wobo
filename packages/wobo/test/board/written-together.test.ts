import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import {
  INK_AIR_PX,
  inkBoxOf,
  isWrittenBox,
  seeksRoom,
  tallestGlyphUnits,
} from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, INK_NIB_PX, NOTE_REACH } from '../../src/board/layout';
import {
  boardPxPerUnit,
  buildObjects,
  dependencyOrder,
  settleBoardScales,
} from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * WRITTEN MARKS ARE LAID TOGETHER, NOT ONE AT A TIME (wave 59, the timeline at 390).
 *
 * Wave 58's frame of the timeline at 390 was unreadable where wave 57's was merely far: '1919'
 * and '1920' printed flush and read as '19191920', 'Non-Cooperation begins' written on the axis
 * and struck through by the tick for 1922, 'Chauri Chaura, called off' stacked three lines high
 * above the years. Every one of those is the same defect: the solver placed each mark alone, in
 * arrival order, at the biggest size and the widest shape it could find room for — so the first
 * event took the whole underside of the axis in one 384-unit line, every later event was pushed
 * somewhere wrong, and a tick that had not been built yet was drawn through a label that had.
 *
 * A hand lays out a row of captions as a row: one size for all of them, each centred under its
 * own mark, each wrapped to a compact block rather than trailing away along the axis, and none of
 * them written where a later mark is going to land. This file holds each of those as its own
 * rule, on small boards built for the purpose, and then on the real timeline plans.
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

/** The board plane's own canvas at 390 and 1440, measured on the running app. */
const SURFACE: Record<string, BoardFrame> = {
  '390': frameOf({ x: 12, y: 438.73, width: 366, height: 333.27 }),
  '1440': frameOf({ x: 828, y: 474, width: 496, height: 282 }),
};

function lay(plan: BoardObject[], frame: BoardFrame, typeScale = 1, glassScale = 0) {
  const states = plan.map((object, i) => ({ object, generation: 0, seq: i }));
  const boxes = new Map<string, BoardRect>();
  const occupied: BoardRect[] = [];
  const built = buildObjects(states as never, {
    frame,
    font,
    store: { anchorOf: (s: { object: { anchor?: unknown } }) => s.object.anchor ?? null },
    cache: new Map(),
    targets: () => [],
    focus: () => [],
    boxes,
    occupied,
    typeScale,
    ...(glassScale > 0 ? { glassScale } : {}),
  } as never);
  return { built, boxes, occupied };
}

/** A plan laid exactly as the plane lays it: both scalars settled, then the camera fitted. */
function settled(plan: BoardObject[], frame: BoardFrame) {
  const rung = settleBoardScales(
    (typeScale, glassScale) => lay(plan, frame, typeScale, glassScale).built,
    frame,
    true,
    CAMERA_FILL_MAX,
  );
  const { built } = lay(plan, frame, rung.typeScale, rung.glassScale);
  const k = boardPxPerUnit(built, frame, true, CAMERA_FILL_MAX);
  const by = new Map<
    string,
    { object: BoardObject; ink: BoardRect; size: number; lines: string[]; px: number }
  >();
  for (const b of built) {
    if (!b.geometry) continue;
    by.set(b.state.object.id, {
      object: b.state.object as BoardObject,
      ink: inkBoxOf(b.geometry),
      size: b.geometry.size ?? 0,
      lines: b.geometry.text?.lines ?? [],
      px: tallestGlyphUnits(b.geometry) * k,
    });
  }
  return { built, by, k, rung };
}

function gap(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

const centreX = (b: BoardRect) => b.x + b.w / 2;

const plan = (name: string): BoardObject[] =>
  JSON.parse(readFileSync(`${BOARDS}/${name}.json`, 'utf8')) as BoardObject[];

/** A point tick on a line, with a caption under it — the timeline's own grammar, one bar of it. */
function tick(id: string, x: number): BoardObject {
  return { id, kind: 'point', anchor: { board: [x, 396] } } as BoardObject;
}
function caption(id: string, on: string, text: string, at: 'top' | 'bottom' = 'bottom'): BoardObject {
  return { id, kind: 'label', anchor: { object: on, at }, text } as BoardObject;
}
const AXIS: BoardObject = {
  id: 'axis',
  kind: 'line',
  anchor: { board: [370, 396] },
  to: { board: [630, 396] },
} as BoardObject;

describe('a written mark reports the ink it paints', () => {
  it('a label’s box is the union of its glyphs, not its line box', () => {
    const { built } = lay(
      [{ id: 'w', kind: 'label', anchor: { board: [200, 200] }, text: 'Jallianwala' } as BoardObject],
      SURFACE['390'] as BoardFrame,
    );
    const g = built[0]?.geometry;
    expect(g).not.toBeNull();
    const glyphs = g?.glyphs ?? [];
    expect(glyphs.length).toBeGreaterThan(0);
    const x0 = Math.min(...glyphs.map((q) => q.box.x));
    const y0 = Math.min(...glyphs.map((q) => q.box.y));
    const x1 = Math.max(...glyphs.map((q) => q.box.x + q.box.w));
    const y1 = Math.max(...glyphs.map((q) => q.box.y + q.box.h));
    const box = g?.box as BoardRect;
    expect(Math.abs(box.x - x0)).toBeLessThan(0.5);
    expect(Math.abs(box.y - y0)).toBeLessThan(0.5);
    expect(Math.abs(box.x + box.w - x1)).toBeLessThan(0.5);
    expect(Math.abs(box.y + box.h - y1)).toBeLessThan(0.5);
    // And the box the next mark dodges is marked as writing, so it keeps the air law from it.
    expect(isWrittenBox(box)).toBe(true);
  });

  it('a drawn mark’s box is not marked as writing', () => {
    const { built } = lay([tick('t', 400)], SURFACE['390'] as BoardFrame);
    expect(isWrittenBox(built[0]?.geometry?.box as BoardRect)).toBe(false);
  });
});

describe('a caption under a point is centred on it and written as a block', () => {
  it('a label asked for under a tick sits centred under the tick', () => {
    const frame = SURFACE['390'] as BoardFrame;
    const { by } = settled([AXIS, tick('t', 500), caption('c', 't', 'Chauri Chaura, called off')], frame);
    const t = by.get('t') as { ink: BoardRect };
    const c = by.get('c') as { ink: BoardRect };
    // The tick's ink is its arrow; the tip is on the line at x = 500.
    expect(Math.abs(centreX(c.ink) - 500)).toBeLessThan(c.ink.w * 0.25);
    expect(c.ink.y).toBeGreaterThan(t.ink.y + t.ink.h);
  });

  it('a long caption on a small mark is wrapped into a block rather than trailing past it', () => {
    const frame = SURFACE['390'] as BoardFrame;
    const { by } = settled([AXIS, tick('t', 500), caption('c', 't', 'Jallianwala Bagh massacre')], frame);
    const c = by.get('c') as { lines: string[]; ink: BoardRect };
    expect(c.lines.length).toBe(2);
    // Balanced: the widest line is the shorter of the two two-line splits.
    expect(c.lines).toEqual(['Jallianwala', 'Bagh massacre']);
  });

  it('a caption on something as wide as itself still runs on one line', () => {
    const frame = SURFACE['390'] as BoardFrame;
    const wide: BoardObject = {
      id: 'r',
      kind: 'region',
      anchor: { board: [300, 300] },
      w: 400,
      h: 60,
    } as BoardObject;
    const { by } = settled([wide, caption('c', 'r', 'Jallianwala Bagh massacre')], frame);
    expect((by.get('c') as { lines: string[] }).lines.length).toBe(1);
  });
});

describe('the air between written marks is kept by construction', () => {
  it(`two captions on neighbouring ticks keep ${INK_AIR_PX} px of ink air`, () => {
    const frame = SURFACE['390'] as BoardFrame;
    const { by, k } = settled(
      [AXIS, tick('a', 400), tick('b', 480), caption('x', 'a', 'Non-Cooperation begins'), caption('y', 'b', 'Chauri Chaura, called off')],
      frame,
    );
    const x = by.get('x') as { ink: BoardRect };
    const y = by.get('y') as { ink: BoardRect };
    expect(gap(x.ink, y.ink) * k).toBeGreaterThanOrEqual(INK_AIR_PX - 0.05);
  });

  it('a caption keeps a nib clear of a drawn stroke that is not its subject', () => {
    const frame = SURFACE['390'] as BoardFrame;
    const { by, k } = settled([AXIS, tick('t', 500), caption('c', 't', 'begins')], frame);
    const axis = by.get('axis') as { ink: BoardRect };
    const c = by.get('c') as { ink: BoardRect };
    expect(gap(c.ink, axis.ink) * k).toBeGreaterThanOrEqual(INK_NIB_PX - 0.05);
  });
});

describe('a mark that looks for room is built after everything whose place is fixed', () => {
  it('kinds that seek room are named', () => {
    for (const kind of ['label', 'write', 'number', 'note', 'tick', 'bracket']) {
      expect(seeksRoom(kind)).toBe(true);
    }
    for (const kind of ['point', 'line', 'arrow', 'ring', 'axis', 'polygon', 'table']) {
      expect(seeksRoom(kind)).toBe(false);
    }
  });

  it('the build order puts a later tick before an earlier label', () => {
    const states = [AXIS, tick('a', 400), caption('c', 'a', 'begins'), tick('b', 560)].map(
      (object, i) => ({ object, generation: 0, seq: i }),
    );
    const order = dependencyOrder(states as never, {
      anchorOf: (s: { object: { anchor?: unknown } }) => (s.object.anchor ?? null) as never,
    }).map((s) => s.object.id);
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    // And a label on a tick is still built after the tick it hangs off.
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
  });

  it('a label is never written where a tick that comes after it will land', () => {
    const frame = SURFACE['390'] as BoardFrame;
    // The caption on the first tick would run right, under the second, if it could not see it.
    const { by, k } = settled(
      [AXIS, tick('a', 400), caption('c', 'a', 'Non-Cooperation begins'), tick('b', 470)],
      frame,
    );
    const c = by.get('c') as { ink: BoardRect };
    const b = by.get('b') as { ink: BoardRect };
    expect(gap(c.ink, b.ink) * k).toBeGreaterThanOrEqual(INK_NIB_PX - 0.05);
  });
});

describe('the timeline, laid as a hand lays a row of captions', () => {
  for (const width of ['390', '1440']) {
    const name = `social-timeline-${width}`;
    it(`${name}: the three events are written at one size, in one row, each under its own tick`, () => {
      const frame = SURFACE[width] as BoardFrame;
      const { by, k, rung } = settled(plan(name), frame);
      const events = ['b0_4event', 'b0_7event', 'b0_10event'].map(
        (id) => by.get(id) as { ink: BoardRect; size: number; px: number },
      );
      const ticks = ['b0_2tick', 'b0_5tick', 'b0_8tick'].map((id) => by.get(id) as { ink: BoardRect });
      // One size: the board's own, or each phrase's legal floor where that is a hair above it —
      // never the first at 42 and the second at 24.
      const sizes = events.map((e) => e.size);
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(28 * rung.typeScale - 0.01);
      expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.05);
      // One row: every event's ink overlaps every other's in y.
      for (const a of events) for (const b of events) {
        expect(a.ink.y).toBeLessThan(b.ink.y + b.ink.h);
      }
      // Each within the reach of its own tick, measured ink to ink on the glass.
      events.forEach((e, i) => {
        const t = (ticks[i] as { ink: BoardRect }).ink;
        expect(gap(e.ink, t) * k).toBeLessThanOrEqual(NOTE_REACH);
        // And UNDER it, not beside it: the caption's top is below the tick's ink, and the caption
        // spans the tick's own x — the whole of the distance is the drop, none of it a slide.
        expect(e.ink.y).toBeGreaterThan(t.y + t.h);
        expect(e.ink.x).toBeLessThan(t.x + t.w);
        expect(e.ink.x + e.ink.w).toBeGreaterThan(t.x);
      });
      // And legible, at that one size.
      for (const e of events) expect(e.px).toBeGreaterThanOrEqual(12);
    });

    it(`${name}: the three years sit above their own ticks, apart from each other`, () => {
      const frame = SURFACE[width] as BoardFrame;
      const { by, k } = settled(plan(name), frame);
      const years = ['b0_3num', 'b0_6num', 'b0_9num'].map((id) => by.get(id) as { ink: BoardRect });
      const ticks = ['b0_2tick', 'b0_5tick', 'b0_8tick'].map((id) => by.get(id) as { ink: BoardRect });
      years.forEach((y, i) => {
        const t = ticks[i] as { ink: BoardRect };
        expect(y.ink.y + y.ink.h).toBeLessThanOrEqual(t.ink.y);
        expect(gap(y.ink, t.ink) * k).toBeLessThanOrEqual(NOTE_REACH);
      });
      for (let i = 0; i < years.length; i += 1) {
        for (let j = i + 1; j < years.length; j += 1) {
          expect(gap((years[i] as { ink: BoardRect }).ink, (years[j] as { ink: BoardRect }).ink) * k).toBeGreaterThanOrEqual(INK_AIR_PX - 0.05);
        }
      }
    });
  }
});
