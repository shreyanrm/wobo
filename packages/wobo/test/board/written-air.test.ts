import { beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { inkBoxOf, tallestGlyphUnits } from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, INK_NIB_PX, MARK_AIR_PX } from '../../src/board/layout';
import { boardPxPerUnit, buildObjects, settleBoardScales } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * THE THIRD CLAUSE OF THE SAME CRAFT SENTENCE (the adversary, wave 58; INK-FOUR craft).
 *
 * "Labels at least 12 px on the glass, ... a note in the margin within 24 px of its subject AND
 * NEVER OVER THE TEXT IT EXPLAINS." `written-placement.test.ts` holds the first two clauses. It
 * cannot see the third, and the third is exactly what wave 57's solver spent to buy the second:
 * measured on the running app, the minimum clear air between two written marks fell from 22 / 16 /
 * 17 / 9 / 13 / 18 px to 2.4 / 4.6 / 6.8 / 0.0 / 1.5 / 3.9 px, with one outright collision —
 * 'magnification -1.00' printed through 'image' on the lens at 1440, 53 px² of shared glyph — and
 * 'apex' 2.4 px from 'up-speed is zero here' on the projectile at 390, which reads as one word:
 * 'apexup-speed is zero here'.
 *
 * A solver that satisfies two counts by spending the third is not closing the law; it is moving
 * the failure to whichever number nobody is counting. So this file counts the third, on the same
 * sixteen real plans, at the same two widths, through the same renderer and camera.
 *
 * WHAT IS MEASURED: PAINTED INK, NOT RESERVATIONS. Two things separate a board's boxes from what a
 * learner sees. A mark's box is what it RESERVES; `inkBoxOf` is what it PAINTS. And the nib has
 * width — `NIB_PX`, a non-scaling stroke — so every painted edge stands half a nib proud of the
 * path it traces, on both sides of both marks. Air measured between reservations is therefore a
 * whole nib more generous than the air a learner gets, which is how a ladder whose last rung was
 * "boxes may touch" printed one word through another.
 *
 * THE THREE THINGS ASSERTED, all in screen pixels on a real surface:
 *   1. no two written marks' painted ink overlap, anywhere, on any board;
 *   2. two written marks keep `MARK_AIR_PX` of painted air between them;
 *   3. no written mark is painted across a drawn stroke — a tick struck through a timeline label
 *      is the same defect as one word printed through another. Writing INSIDE a region that holds
 *      it (the 9 inside the square whose area is nine) is not that defect and is not counted.
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

/** The board plane's own canvas, measured on the running app — the same two as wave 57. */
const SURFACE: Record<string, BoardFrame> = {
  '390': frameOf({ x: 12, y: 438.73, width: 366, height: 333.27 }),
  '1440': frameOf({ x: 828, y: 474, width: 496, height: 282 }),
};

const PLANS = readdirSync(BOARDS)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f.replace(/\.json$/, ''),
    plan: JSON.parse(readFileSync(`${BOARDS}/${f}`, 'utf8')) as BoardObject[],
  }));

function lay(plan: BoardObject[], frame: BoardFrame, typeScale: number, glassScale = 0) {
  const states = plan.map((object, i) => ({ object, generation: 0, seq: i }));
  const boxes = new Map<string, BoardRect>();
  const built = buildObjects(states as never, {
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
  return { built, boxes };
}

function settle(plan: BoardObject[], frame: BoardFrame) {
  return settleBoardScales(
    (typeScale, glassScale) => lay(plan, frame, typeScale, glassScale).built,
    frame,
    true,
    CAMERA_FILL_MAX,
  );
}

interface Painted {
  id: string;
  text: string;
  written: boolean;
  subject: string;
  /** What the browser paints, in SCREEN px, nib included: the whole of it. */
  ink: BoardRect;
  /**
   * THE PIECES, not one loose union.
   *
   * A written mark's pieces are its glyphs; a drawn object's are the segments of its strokes. The
   * union box of a parabola is a large rectangle with almost nothing in it, and a note written in
   * the empty corner under the curve is not a note written over the curve. Overlap is therefore
   * measured piece by piece, exactly as the lab probe measures the painted DOM.
   */
  pieces: BoardRect[];
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
    // Q: sample the curve itself rather than its control hull.
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

/** Clear air between two boxes. */
function gapOf(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function overlapOf(a: BoardRect, b: BoardRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function holds(outer: BoardRect, inner: BoardRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Every object on a board as the browser paints it: ink box in screen px, half a nib proud. */
function painted(plan: BoardObject[], frame: BoardFrame): Painted[] {
  const { typeScale, glassScale } = settle(plan, frame);
  const { built } = lay(plan, frame, typeScale, glassScale);
  const k = boardPxPerUnit(built, frame, true, CAMERA_FILL_MAX);
  const out: Painted[] = [];
  for (const b of built) {
    const g = b.geometry;
    if (!g) continue;
    const ink = inkBoxOf(g);
    if (!(ink.w > 0 || ink.h > 0)) continue;
    const object = b.state.object as BoardObject & {
      anchor?: { object?: string };
      text?: string;
      label?: string;
    };
    const half = INK_NIB_PX / 2;
    const paint = (b: BoardRect): BoardRect => ({
      x: b.x * k - half,
      y: b.y * k - half,
      w: b.w * k + INK_NIB_PX,
      h: b.h * k + INK_NIB_PX,
    });
    const pieces: BoardRect[] = g.glyphs.map((glyph) => paint(glyph.box));
    for (const stroke of g.strokes) {
      const pts = polyOf(stroke.d);
      for (let n = 1; n < pts.length; n += 1) {
        const a = pts[n - 1] as { x: number; y: number };
        const b = pts[n] as { x: number; y: number };
        // A long diagonal's bounding box is mostly empty air, so the segment is cut into pieces
        // no longer than a couple of units: a box that small IS the stroke.
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
        for (let s = 0; s < steps; s += 1) {
          const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
          const q = {
            x: a.x + ((b.x - a.x) * (s + 1)) / steps,
            y: a.y + ((b.y - a.y) * (s + 1)) / steps,
          };
          pieces.push(
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
    if (g.image) pieces.push(paint(g.image.box));
    out.push({
      id: object.id,
      text: String(object.text ?? object.label ?? '').slice(0, 40),
      written: tallestGlyphUnits(g) > 0,
      subject: typeof object.anchor?.object === 'string' ? object.anchor.object : '',
      ink: paint(ink),
      pieces: pieces.length > 0 ? pieces : [paint(ink)],
    });
  }
  return out;
}

interface AirReading {
  /** Pairs of written marks whose painted ink overlaps. */
  collisions: string[];
  /** Written marks closer than the air law to another written mark. */
  tight: string[];
  /** Written marks painted across a drawn stroke that does not hold them. */
  struck: string[];
  /** The least painted air between two written marks on this board, in px. */
  minAir: number | null;
}

function readAir(plan: BoardObject[], frame: BoardFrame): AirReading {
  const marks = painted(plan, frame);
  const written = marks.filter((m) => m.written);
  const drawn = marks.filter((m) => !m.written);
  const collisions: string[] = [];
  const tight: string[] = [];
  const struck: string[] = [];
  let minAir: number | null = null;
  const shared = (a: Painted, b: Painted): number => {
    let sum = 0;
    for (const p of a.pieces) for (const q of b.pieces) sum += overlapOf(p, q);
    return sum;
  };
  for (let i = 0; i < written.length; i += 1) {
    const a = written[i] as Painted;
    for (let j = i + 1; j < written.length; j += 1) {
      const b = written[j] as Painted;
      const over = shared(a, b);
      if (over > 1) {
        collisions.push(`"${a.text}" x "${b.text}" ${over.toFixed(0)}px2`);
        minAir = 0;
        continue;
      }
      const air = gapOf(a.ink, b.ink);
      if (minAir === null || air < minAir) minAir = air;
      if (air + 1e-6 < MARK_AIR_PX) {
        tight.push(`"${a.text}" ${air.toFixed(1)}px from "${b.text}"`);
      }
    }
    for (const d of drawn) {
      // Its own subject is what it names; a region that HOLDS the words is a map label or a nine
      // written inside the square whose area is nine, not a mark painted over the working.
      if (d.id === a.subject) continue;
      if (holds(d.ink, a.ink)) continue;
      const over = shared(a, d);
      if (over > 1) struck.push(`"${a.text}" over ${d.id} ${over.toFixed(0)}px2`);
    }
  }
  return { collisions, tight, struck, minAir };
}

describe('the air between two written marks is a law, not the solver’s small change', () => {
  for (const { name, plan } of PLANS) {
    const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;

    it(`${name}: no two written marks are painted over each other`, () => {
      expect(readAir(plan, frame).collisions).toEqual([]);
    });

    it(`${name}: two written marks keep ${MARK_AIR_PX} px of painted air`, () => {
      expect(readAir(plan, frame).tight).toEqual([]);
    });

    it(`${name}: no written mark is painted across a drawn stroke`, () => {
      expect(readAir(plan, frame).struck).toEqual([]);
    });
  }

  it('the third clause holds over all sixteen boards at once', () => {
    let collisions = 0;
    let tight = 0;
    let struck = 0;
    let worst = Number.POSITIVE_INFINITY;
    for (const { name, plan } of PLANS) {
      const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;
      const read = readAir(plan, frame);
      collisions += read.collisions.length;
      tight += read.tight.length;
      struck += read.struck.length;
      if (read.minAir !== null && read.minAir < worst) worst = read.minAir;
    }
    expect({ collisions, tight, struck }).toEqual({ collisions: 0, tight: 0, struck: 0 });
    expect(worst).toBeGreaterThanOrEqual(MARK_AIR_PX);
  });
});
