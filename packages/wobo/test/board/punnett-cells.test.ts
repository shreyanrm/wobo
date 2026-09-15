import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { inkBoxOf } from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, INK_NIB_PX } from '../../src/board/layout';
import {
  boardPxPerUnit,
  buildObjects,
  settleBoardScales,
  TYPE_LADDER,
} from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * A WORD IN A RULED CELL BELONGS TO THAT CELL, AT EVERY RUNG OF THE LADDER (the judge, wave 64:
 * `bio-punnett-1440`, craft 3).
 *
 * `written-air.test.ts` counts the ink a mark is painted across — and it cannot count this one.
 * Its third clause exempts a drawn object that HOLDS a written mark, because a nine written inside
 * the square whose area is nine is not a nine painted over the square. A grid held every word on
 * the board that way: one `table` whose box is the whole square, so a genotype painted clean
 * through the rule between two cells was, to that ruler, a word written inside the thing it
 * belongs to. Measured on the real /chat glass at 1440, that is exactly what it was: 'TT' with
 * 12.0 px of air on its cell's left rule and 0.9 px on the right, the second T's crossbar 135 px2
 * into a 3 px rule, in six renders of seven.
 *
 * WHY IT HAPPENED, and why a bigger pad would not have fixed it. The pipeline placed those words
 * itself, by naming a fraction of the grid — which `geometry.ts` resolves as a left-aligned
 * WRITING ORIGIN, with no solver, no dodge and no measure of the ink. The pipeline cannot know how
 * wide the ink will be: the board's own floor writes at `MIN_WRITTEN_UNITS` rather than at the 22
 * a pipeline asks for, the renderer's `TYPE_LADDER` multiplies every written size on a board by up
 * to two, and the letters themselves are whatever the question named — 'M' is sixty per cent wider
 * than 'T'. So the pad was a constant against three things that move.
 *
 * WHAT THIS FILE HOLDS. The square is now built out of its cells: each cell rules its own two
 * edges as one stroke whose box is exactly that cell, and each word is `{object: <its cell>,
 * at: "center"}` — placed by the hand, inside the cell, at the size the hand actually writes. So
 * the law can be stated of the drawing rather than of a pad:
 *
 *   1. every word anchored to a cell paints its whole ink inside that cell;
 *   2. no word's glyphs touch a rule of the grid, anywhere, by a nib;
 *   3. both hold at EVERY rung of the type ladder, not only the one this board settles on — the
 *      rung is the renderer's answer to a surface, and the real glass settles a rung above the
 *      lab's on a plane seventeen per cent smaller;
 *   4. and the square is still exactly its eight rules — no rule drawn twice, which is what
 *      building a grid out of cells usually costs and what the tiling here is for.
 *
 * All four on the real plans, through the real renderer and camera, at both widths.
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

const PLANS = ['bio-punnett-390', 'bio-punnett-1440'].map((name) => ({
  name,
  plan: JSON.parse(readFileSync(`${BOARDS}/${name}.json`, 'utf8')) as BoardObject[],
}));

function lay(plan: BoardObject[], frame: BoardFrame, typeScale: number, glassScale = 0) {
  const states = plan.map((object, i) => ({ object, generation: 0, seq: i }));
  return buildObjects(
    states as never,
    {
      frame,
      font,
      store: { anchorOf: (s: { object: { anchor?: unknown } }) => s.object.anchor ?? null },
      cache: new Map(),
      targets: () => [],
      focus: () => [],
      boxes: new Map<string, BoardRect>(),
      occupied: [],
      typeScale,
      ...(glassScale > 0 ? { glassScale } : {}),
    } as never,
  );
}

function settle(plan: BoardObject[], frame: BoardFrame) {
  return settleBoardScales(
    (typeScale, glassScale) => lay(plan, frame, typeScale, glassScale),
    frame,
    true,
    CAMERA_FILL_MAX,
  );
}

/** The polyline a hand path traces, in board units. The hand emits only M, L and Q. */
function polyOf(d: string): { x: number; y: number }[] {
  const tokens = d.match(/[MLQmlq]|-?\d+(?:\.\d+)?/g) ?? [];
  const pts: { x: number; y: number }[] = [];
  let i = 0;
  let cmd = 'M';
  let cur = { x: 0, y: 0 };
  const num = () => Number(tokens[i++] ?? 0);
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (/[MLQmlq]/.test(t)) {
      cmd = t.toUpperCase();
      i += 1;
      continue;
    }
    if (cmd === 'M' || cmd === 'L') {
      cur = { x: num(), y: num() };
      pts.push(cur);
      if (cmd === 'M') cmd = 'L';
      continue;
    }
    const cx = num();
    const cy = num();
    const ex = num();
    const ey = num();
    const from = cur;
    for (const s of [0.25, 0.5, 0.75, 1]) {
      const u = 1 - s;
      pts.push({
        x: u * u * from.x + 2 * u * s * cx + s * s * ex,
        y: u * u * from.y + 2 * u * s * cy + s * s * ey,
      });
    }
    cur = { x: ex, y: ey };
  }
  return pts;
}

function overlapOf(a: BoardRect, b: BoardRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function gapOf(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

interface Reading {
  /** Words in the square the pipeline placed itself, instead of leaving to the hand. */
  unsolved: string[];
  /** Words whose ink leaves the cell of the grid they are written in. */
  strayed: string[];
  /** Words painted into a rule of the grid. */
  struck: string[];
  /** The least painted air between a word and any rule, in screen px. */
  worstAir: number;
}

/**
 * EVERY SEGMENT THE PLAN RULES, as `x1,y1 -> x2,y2` with the ends in order — the drawing's own
 * claim about itself, before a pen has wobbled it. A grid built out of cells is the obvious way to
 * give every word a box, and the obvious way to build one draws the rules between the cells twice.
 */
function ruledSegments(plan: BoardObject[]): string[] {
  const out: string[] = [];
  const key = (a: readonly number[], b: readonly number[]) => {
    const first =
      (a[0] as number) < (b[0] as number) ||
      ((a[0] as number) === (b[0] as number) && (a[1] as number) <= (b[1] as number));
    const [p, q] = first ? [a, b] : [b, a];
    return `${(p as number[])[0]},${(p as number[])[1]} -> ${(q as number[])[0]},${(q as number[])[1]}`;
  };
  for (const object of plan) {
    const at = (object as { anchor?: { board?: number[] } }).anchor?.board;
    if (!at) continue;
    if (object.kind === 'line') {
      const to = (object as unknown as { to: { board?: number[] } }).to.board;
      if (to) out.push(key(at, to));
      continue;
    }
    if (object.kind !== 'polyline') continue;
    // A path's points are OFFSETS from its anchor (`schema.ts`), which is the one reading the hand
    // has of them.
    const points = (object as unknown as { points: number[][] }).points.map((p) => [
      (at[0] as number) + (p[0] as number),
      (at[1] as number) + (p[1] as number),
    ]);
    for (let i = 1; i < points.length; i += 1) {
      out.push(key(points[i - 1] as number[], points[i] as number[]));
    }
  }
  return out;
}

/**
 * The square this board rules, in board units — the union of everything it DRAWS, whether that is
 * nine cells and two rules or one table. Read off the geometry rather than off the plan, so the
 * words below are found on any shape of Punnett square, including the one this file was written
 * against.
 */
function gridOf(built: readonly { geometry?: unknown }[]): BoardRect {
  const boxes = built
    .map(
      (b) => b.geometry as { glyphs: readonly unknown[]; strokes: readonly unknown[] } | undefined,
    )
    .filter((g): g is { glyphs: readonly unknown[]; strokes: readonly unknown[] } =>
      Boolean(g && g.glyphs.length === 0 && g.strokes.length > 0),
    )
    .map((g) => inkBoxOf(g as never));
  return {
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
    w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
    h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
  };
}

/** What the browser paints on this board at this rung, mark by mark, in screen pixels. */
function read(plan: BoardObject[], frame: BoardFrame, rung: number): Reading {
  const settled = settle(plan, frame);
  const built = lay(plan, frame, rung, settled.glassScale);
  const k = boardPxPerUnit(built, frame, true, CAMERA_FILL_MAX);
  const half = INK_NIB_PX / 2;
  // Every painted edge stands half a nib proud of the path it traces, on both sides of both marks,
  // so air measured between bare boxes is a whole nib more generous than the air a learner gets.
  const paint = (b: BoardRect): BoardRect => ({
    x: b.x * k - half,
    y: b.y * k - half,
    w: b.w * k + INK_NIB_PX,
    h: b.h * k + INK_NIB_PX,
  });
  /** A stroke cut into pieces no longer than a couple of units: a box that small IS the stroke. */
  const piecesOf = (geometry: { strokes: readonly { d: string }[] }): BoardRect[] => {
    const out: BoardRect[] = [];
    for (const stroke of geometry.strokes) {
      const pts = polyOf(stroke.d);
      for (let n = 1; n < pts.length; n += 1) {
        const a = pts[n - 1] as { x: number; y: number };
        const b = pts[n] as { x: number; y: number };
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
        for (let s = 0; s < steps; s += 1) {
          const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
          const q = {
            x: a.x + ((b.x - a.x) * (s + 1)) / steps,
            y: a.y + ((b.y - a.y) * (s + 1)) / steps,
          };
          out.push(
            paint({
              x: Math.min(p.x, q.x),
              y: Math.min(p.y, q.y),
              w: Math.abs(p.x - q.x),
              h: Math.abs(p.y - q.y),
            }),
          );
        }
      }
    }
    return out;
  };

  const grid = gridOf(built);
  const cell = { w: grid.w / 3, h: grid.h / 3 };
  const rules = new Map(
    built
      .filter((b) => b.geometry && b.geometry.glyphs.length === 0)
      .map((b) => [b.state.object.id, piecesOf(b.geometry as never)]),
  );

  const unsolved: string[] = [];
  const strayed: string[] = [];
  const struck: string[] = [];
  let worstAir = Number.POSITIVE_INFINITY;
  for (const b of built) {
    const object = b.state.object as BoardObject & {
      anchor?: { object?: string; at?: unknown };
      text?: string;
    };
    if (!b.geometry || b.geometry.glyphs.length === 0) continue;
    const raw = inkBoxOf(b.geometry);
    // EVERY WORD WRITTEN IN THE SQUARE, however it got there — not only the ones anchored the way
    // this file expects. A ruler that reads its own convention passes a board that abandons it.
    const mid = { x: raw.x + raw.w / 2, y: raw.y + raw.h / 2 };
    if (mid.x < grid.x || mid.x > grid.x + grid.w || mid.y < grid.y || mid.y > grid.y + grid.h) {
      continue;
    }
    const word = `"${object.text ?? object.id}"`;
    if (!object.anchor?.object || object.anchor.at !== 'center') {
      unsolved.push(`${word} is placed by its plan, not by the hand`);
    }
    const col = Math.min(2, Math.max(0, Math.floor((mid.x - grid.x) / cell.w)));
    const row = Math.min(2, Math.max(0, Math.floor((mid.y - grid.y) / cell.h)));
    const held = paint({
      x: grid.x + col * cell.w,
      y: grid.y + row * cell.h,
      ...cell,
    });
    const ink = paint(raw);
    if (
      ink.x < held.x ||
      ink.y < held.y ||
      ink.x + ink.w > held.x + held.w ||
      ink.y + ink.h > held.y + held.h
    ) {
      strayed.push(`${word} is written outside the cell at row ${row}, column ${col}`);
    }
    const glyphs = b.geometry.glyphs.map((g) => paint(g.box));
    for (const [id, pieces] of rules) {
      let over = 0;
      for (const piece of pieces) {
        for (const glyph of glyphs) over += overlapOf(glyph, piece);
        const air = gapOf(ink, piece);
        if (air < worstAir) worstAir = air;
      }
      if (over > 1) struck.push(`${word} over ${id} ${over.toFixed(0)}px2`);
    }
  }
  return { unsolved, strayed, struck, worstAir };
}

describe('a word written in a ruled cell belongs to that cell, at every rung', () => {
  for (const { name, plan } of PLANS) {
    const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;
    const rungs = [1, ...TYPE_LADDER];

    it(`${name}: every word in the square is placed by the hand, not by the plan`, () => {
      expect(rungs.flatMap((rung) => read(plan, frame, rung).unsolved)).toEqual([]);
    });

    it(`${name}: every word is written inside its own cell, at every rung`, () => {
      expect(rungs.flatMap((rung) => read(plan, frame, rung).strayed)).toEqual([]);
    });

    it(`${name}: no word is painted into a rule of the grid, at any rung`, () => {
      expect(rungs.flatMap((rung) => read(plan, frame, rung).struck)).toEqual([]);
    });

    it(`${name}: every word keeps a nib of air from every rule, at any rung`, () => {
      for (const rung of rungs) {
        const air = read(plan, frame, rung).worstAir;
        expect({ rung, air: air >= INK_NIB_PX }).toEqual({ rung, air: true });
      }
    });

    it(`${name}: the square is a three by three grid, every rule ruled exactly once`, () => {
      const segments = ruledSegments(plan);
      const twice = segments.filter((s, i) => segments.indexOf(s) !== i);
      expect(twice).toEqual([]);
      // Nine cells of two edges each, and the two rules no cell owns: the eight rules of a three
      // by three grid, in twenty-four cell-long segments and not one more.
      // Nine cells of two edges each and the two rules no cell owns, and they add up to the eight
      // rules of a three by three grid: no more ink than a table ruled, and no less.
      expect(segments.length).toBe(20);
      const ends = segments.map((s) => s.split(' -> ').map((p) => p.split(',').map(Number)));
      const xs = [...new Set(ends.flat().map((p) => p[0] as number))].sort((a, b) => a - b);
      const ys = [...new Set(ends.flat().map((p) => p[1] as number))].sort((a, b) => a - b);
      const side = (xs[3] as number) - (xs[0] as number);
      expect({
        xs: xs.length,
        ys: ys.length,
        square: (ys[3] as number) - (ys[0] as number),
      }).toEqual({ xs: 4, ys: 4, square: side });
      expect(xs).toEqual([0, 1, 2, 3].map((i) => (xs[0] as number) + (side / 3) * i));
      expect(ys).toEqual([0, 1, 2, 3].map((i) => (ys[0] as number) + (side / 3) * i));
      const ruled = ends.reduce((sum, pair) => {
        const [a, b] = pair as number[][];
        return (
          sum +
          Math.abs(((b as number[])[0] as number) - ((a as number[])[0] as number)) +
          Math.abs(((b as number[])[1] as number) - ((a as number[])[1] as number))
        );
      }, 0);
      expect(ruled).toBeCloseTo(8 * side, 6);
    });
  }
});
