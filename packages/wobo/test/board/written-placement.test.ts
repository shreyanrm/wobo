import { beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { MIN_TYPE_PX, tallestGlyphUnits } from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, NOTE_REACH } from '../../src/board/layout';
import { boardPxPerUnit, buildObjects, settleBoardScales } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * THE TWO CRAFT LAWS ARE ONE CONSTRAINT (the adversary, wave 57, finding 2; INK-FOUR craft,
 * "labels at least 12 px on the glass" AND "a note in the margin within 24 px of its subject").
 *
 * Wave 51 closed the size law by growing the type, and the growing is what broke the position
 * law: 29 of the 60 written marks that hang off something on the sixteen from-scratch boards
 * landed more than 24 px from the thing they name — 'Chauri Chaura, called off' 111 px from its
 * own tick, 'greatest height' 101 px from the apex, 'magnification' 146 px from the arrow it
 * measures. A solution that satisfies one law by breaking the other is a failure, not a trade.
 *
 * So this file measures BOTH at once, on all sixteen real plans captured off the wire, laid on
 * the real surfaces the plane gives them at 390 and at 1440, through the renderer's own type
 * ladder and its own camera. Every written mark on every board: at least twelve pixels tall, and
 * within twenty-four pixels of its subject.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT (wave 58, measured).
 *
 * On the ruler below — geometry box to geometry box, converted by the board's own settled scale —
 * all sixteen boards at both widths clear BOTH laws: 0 written marks under 12 px (worst 13.1) and
 * 0 anchored marks past 24 px (worst 19.1), against wave 57's 29 of 60 past the law with a worst
 * of 111 px.
 *
 * On the harsher ruler — the ink the BROWSER paints, measured off the running app at 390 and 1440
 * in light, dark and reduced motion — 0 of 60 are under 12 px and 8 of 60 are still past 24, in a
 * band of 24.1 to 32.1 px. They are named here because a named defect is never quietly carried:
 *
 *   · 'greatest height' and 'up-speed is zero here' on the projectile's apex, both widths. Four
 *     written notes hang off ONE 46 x 38-unit point, on a board whose other ink is a 400-unit
 *     axis. Four boxes of that size cannot all sit inside 24 px of a point that small; this one is
 *     geometry, and the answer is a leader or a pipeline that does not hang four notes on a dot.
 *   · the timeline's three year numbers and its two event labels. A `point` tick reserves far more
 *     than the two strokes it paints, and `inkBoxOf` closes most but not all of that gap.
 *   · 'x² + bx/a + c/a = 0' on the quadratic. Three objects on the board, so the camera sits at its
 *     4x ceiling and one board unit is two pixels: the smallest margin the hand can keep is already
 *     most of the law's budget. `LABEL_GAP_PX` takes this from 39 px to 28; the rest needs the
 *     camera to stop blowing a three-object board up to the ceiling.
 *
 * WHICH RULER. The distance here is BOX to BOX — the quantity the geometry solves in, and the one
 * wave 57 reported its 110 px in. A mark's box is not always the ink it paints: a leader on the
 * plant cell reports 93 x 49 units and paints 62 x 19, because `arrow`, `point`, `ring` and
 * `axis` all pad the box they report. Measured on the running app at 1440, a label sitting at a
 * true 10-unit margin from that box is 28 units from the ink inside it, and reads on the glass as
 * 25 px rather than 9. So this file passing is not the whole law: see the note on `boxGap` in the
 * lab probe, and the finding it belongs to. The fix is a subject's INK box, reported alongside
 * its layout box, and the reach measured to that.
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

/** The board plane's own canvas, measured on the running app. */
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

/** The two scalars, settled exactly as `BoardSurface` settles them. */
function settle(plan: BoardObject[], frame: BoardFrame) {
  return settleBoardScales(
    (typeScale, glassScale) => lay(plan, frame, typeScale, glassScale).built,
    frame,
    true,
    CAMERA_FILL_MAX,
  );
}

/** The clear air between two boxes, in whatever units they are in. */
function gapBetween(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

export interface WrittenMark {
  id: string;
  kind: string;
  text: string;
  /** The tallest glyph, on the glass. */
  px: number;
  /** The clear air to the thing it names, on the glass. Zero when it names a bare coordinate. */
  gapPx: number;
  /** The object it hangs off, or '' for a mark placed at a board coordinate. */
  subject: string;
}

/**
 * Every written mark on a board, measured the way a learner sees it: the tallest glyph and the
 * distance to its subject, both in SCREEN PIXELS under the camera that board is fitted with.
 */
export function writtenMarks(
  plan: BoardObject[],
  frame: BoardFrame,
): { marks: WrittenMark[]; typeScale: number; pxPerBoardUnit: number } {
  const { typeScale, glassScale } = settle(plan, frame);
  const { built, boxes } = lay(plan, frame, typeScale, glassScale);
  const k = boardPxPerUnit(built, frame, true, CAMERA_FILL_MAX);
  const marks: WrittenMark[] = [];
  for (const b of built) {
    const g = b.geometry;
    if (!g) continue;
    const tall = tallestGlyphUnits(g);
    if (tall <= 0) continue;
    const object = b.state.object as BoardObject & {
      anchor?: { object?: string };
      text?: string;
      label?: string;
    };
    const subject = typeof object.anchor?.object === 'string' ? object.anchor.object : '';
    const host = subject ? (boxes.get(subject) ?? null) : null;
    marks.push({
      id: object.id,
      kind: String(object.kind),
      text: String(object.text ?? object.label ?? ''),
      px: tall * k,
      gapPx: host ? gapBetween(g.box, host) * k : 0,
      subject: host ? subject : '',
    });
  }
  return { marks, typeScale, pxPerBoardUnit: k };
}

describe('the written mark: legible AND beside what it names', () => {
  for (const { name, plan } of PLANS) {
    const width = name.endsWith('1440') ? '1440' : '390';
    const frame = SURFACE[width] as BoardFrame;

    it(`${name}: every written mark is at least ${MIN_TYPE_PX} px`, () => {
      const { marks } = writtenMarks(plan, frame);
      const under = marks.filter((m) => m.px < MIN_TYPE_PX);
      expect(
        under.map((m) => `${m.text || m.id} ${m.px.toFixed(1)}px`),
      ).toEqual([]);
    });

    it(`${name}: every written mark is within ${NOTE_REACH} px of its subject`, () => {
      const { marks } = writtenMarks(plan, frame);
      const far = marks.filter((m) => m.subject && m.gapPx > NOTE_REACH);
      expect(
        far.map((m) => `${m.text || m.id} ${m.gapPx.toFixed(1)}px from ${m.subject}`),
      ).toEqual([]);
    });
  }

  it('the joint law holds over all sixteen boards at once', () => {
    let under = 0;
    let far = 0;
    let anchored = 0;
    for (const { name, plan } of PLANS) {
      const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;
      for (const m of writtenMarks(plan, frame).marks) {
        if (m.px < MIN_TYPE_PX) under += 1;
        if (m.subject) {
          anchored += 1;
          if (m.gapPx > NOTE_REACH) far += 1;
        }
      }
    }
    expect(anchored).toBeGreaterThan(50);
    expect({ under12px: under, beyond24px: far }).toEqual({ under12px: 0, beyond24px: 0 });
  });
});
