import { beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type BoardFrame, type BoardRect, frameOf } from '../../src/board/anchors';
import { INK_AIR_PX, MIN_TYPE_PX, inkBoxOf, tallestGlyphUnits } from '../../src/board/geometry';
import { type HandFont, parseHandFont } from '../../src/board/handwriting';
import { CAMERA_FILL_MAX, NOTE_REACH } from '../../src/board/layout';
import { boardPxPerUnit, buildObjects, settleBoardScales } from '../../src/board/renderer';
import type { BoardObject } from '../../src/board/schema';

/**
 * THE HARSHER RULER: THE INK, NOT THE BOX (the adversary, wave 58, the timeline).
 *
 * `written-placement.test.ts` holds both craft laws box-to-box, says so in its own header, and
 * names what that ruler cannot see. This file is that ruler.
 *
 * WHAT THE BOX HIDES, measured on the timeline at 390 before this file was green:
 *
 *  · A written mark's box is its LINE BOX. '1919' at 45 units reports 81 x 55 and paints 77 x 27,
 *    sitting nine units below its box's top with nineteen units of empty leading under it. So a
 *    number solved to a lawful twelve units from its tick painted twenty-seven pixels from it. The
 *    reach was kept against a quantity nobody can see.
 *  · The same box is NARROWER than the ink on the right — Caveat slants, and the last glyph
 *    overhangs its own advance. Two numbers the solver had cleared by five units of box were eight
 *    pixels of ink apart, and '1919' and '1920' read on the glass as '19191920'.
 *  · A mark's neighbours are boxes too, so the air between two marks was never measured where a
 *    learner reads it. The solver's roomiest rung of clearance was `margin * 0.5` — under four
 *    pixels on every board here.
 *
 * And one thing no ruler hides: a mark placed clear of everything already drawn can still be drawn
 * THROUGH by a mark that comes after it. 'Non-Cooperation begins' was struck by the tick for 1922,
 * which had not been built when the label chose its spot.
 *
 * Every number below is measured on the sixteen real plans captured off the wire, on the real
 * surfaces the plane gives them at 390 and 1440, through the renderer's own two scalars and its
 * own camera — the same plumbing `written-placement.test.ts` uses, read off the glyphs instead of
 * the boxes.
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
  return built;
}

function gapBetween(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function overlapPx2(a: BoardRect, b: BoardRect, k: number): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * k * h * k : 0;
}

/**
 * The kinds whose position this file is about: the ones `geometry.ts` hands to the written solver.
 *
 * A table writes its own cells inside its own rules and an axis writes its own name beside its own
 * arrowhead; neither asked the solver for a place, so neither is judged on where the solver would
 * have put it. A fraction-pair `at` is a pipeline naming a point in its own drawing, and is the
 * same exemption.
 */
const SOLVED_KINDS: ReadonlySet<string> = new Set(['label', 'write', 'number', 'note']);

interface Mark {
  id: string;
  text: string;
  /** The glyphs, as painted. */
  ink: BoardRect;
  /** The tallest glyph, on the glass. */
  px: number;
  /** True when `geometry.ts` chose this mark's position with the written solver. */
  solved: boolean;
  /** The ink of what it names, when it names something the solver measured to. */
  subject: { id: string; ink: BoardRect } | null;
}

function measure(plan: BoardObject[], frame: BoardFrame) {
  const rung = settleBoardScales(
    (typeScale, glassScale) => lay(plan, frame, typeScale, glassScale),
    frame,
    true,
    CAMERA_FILL_MAX,
  );
  const built = lay(plan, frame, rung.typeScale, rung.glassScale);
  const k = boardPxPerUnit(built, frame, true, CAMERA_FILL_MAX);
  const ink = new Map<string, BoardRect>();
  for (const b of built) if (b.geometry) ink.set(b.state.object.id, inkBoxOf(b.geometry));
  const marks: Mark[] = [];
  const drawn: { id: string; ink: BoardRect }[] = [];
  for (const b of built) {
    const g = b.geometry;
    if (!g) continue;
    const object = b.state.object as BoardObject & {
      anchor?: { object?: string; at?: unknown };
      text?: string;
      label?: string;
      value?: number;
    };
    const mine = ink.get(object.id) as BoardRect;
    if (tallestGlyphUnits(g) <= 0) {
      drawn.push({ id: object.id, ink: mine });
      continue;
    }
    const host = typeof object.anchor?.object === 'string' ? object.anchor.object : '';
    const solved =
      SOLVED_KINDS.has(String(object.kind)) && host !== '' && !Array.isArray(object.anchor?.at);
    marks.push({
      id: object.id,
      text: String(object.text ?? object.label ?? object.value ?? object.id),
      ink: mine,
      px: tallestGlyphUnits(g) * k,
      solved,
      subject: solved && ink.has(host) ? { id: host, ink: ink.get(host) as BoardRect } : null,
    });
  }
  return { marks, drawn, k };
}

describe('the written mark, measured on the ink a learner actually reads', () => {
  for (const { name, plan } of PLANS) {
    const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;

    it(`${name}: every written mark paints at least ${MIN_TYPE_PX} px`, () => {
      const { marks } = measure(plan, frame);
      expect(
        marks.filter((m) => m.px < MIN_TYPE_PX).map((m) => `${m.text} ${m.px.toFixed(1)}px`),
      ).toEqual([]);
    });

    it(`${name}: every solved mark's ink is within ${NOTE_REACH} px of its subject's ink`, () => {
      const { marks, k } = measure(plan, frame);
      const far = marks
        .filter((m) => m.subject && gapBetween(m.ink, m.subject.ink) * k > NOTE_REACH)
        .map(
          (m) =>
            `${m.text} ${(gapBetween(m.ink, (m.subject as { ink: BoardRect }).ink) * k).toFixed(1)}px from ${(m.subject as { id: string }).id}`,
        );
      expect(far).toEqual([]);
    });

    it(`${name}: two solved marks keep ${INK_AIR_PX} px of clear air`, () => {
      const { marks, k } = measure(plan, frame);
      const solved = marks.filter((m) => m.solved);
      const tight: string[] = [];
      for (let i = 0; i < solved.length; i += 1) {
        for (let j = i + 1; j < solved.length; j += 1) {
          const a = solved[i] as Mark;
          const b = solved[j] as Mark;
          const air = gapBetween(a.ink, b.ink) * k;
          if (air < INK_AIR_PX) tight.push(`${a.text} | ${b.text} ${air.toFixed(1)}px`);
        }
      }
      expect(tight).toEqual([]);
    });

    it(`${name}: nothing is drawn through a solved mark`, () => {
      const { marks, drawn, k } = measure(plan, frame);
      const struck: string[] = [];
      for (const m of marks) {
        if (!m.solved) continue;
        for (const d of drawn) {
          if (d.id === m.subject?.id) continue;
          const over = overlapPx2(m.ink, d.ink, k);
          if (over > 0) struck.push(`${m.text} struck by ${d.id} ${over.toFixed(0)}px2`);
        }
      }
      expect(struck).toEqual([]);
    });
  }

  it('the three laws hold over all sixteen boards at once', () => {
    let under = 0;
    let far = 0;
    let tight = 0;
    let struck = 0;
    let solved = 0;
    for (const { name, plan } of PLANS) {
      const frame = SURFACE[name.endsWith('1440') ? '1440' : '390'] as BoardFrame;
      const { marks, drawn, k } = measure(plan, frame);
      for (const m of marks) {
        if (m.px < MIN_TYPE_PX) under += 1;
        if (!m.solved) continue;
        solved += 1;
        if (m.subject && gapBetween(m.ink, m.subject.ink) * k > NOTE_REACH) far += 1;
        for (const d of drawn) {
          if (d.id !== m.subject?.id && overlapPx2(m.ink, d.ink, k) > 0) struck += 1;
        }
      }
      const list = marks.filter((m) => m.solved);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i] as Mark;
          const b = list[j] as Mark;
          if (gapBetween(a.ink, b.ink) * k < INK_AIR_PX) tight += 1;
        }
      }
    }
    expect(solved).toBeGreaterThan(40);
    expect({ under12px: under, beyond24px: far, tooTight: tight, drawnThrough: struck }).toEqual({
      under12px: 0,
      beyond24px: 0,
      tooTight: 0,
      drawnThrough: 0,
    });
  });
});
