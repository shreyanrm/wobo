/**
 * Object → geometry. The pure half of the hand: a board object plus the rects its anchor resolves
 * to becomes strokes, written glyphs and a bounding box, all in board units.
 *
 * Nothing here touches React or the DOM, so every kind in the grammar is testable, and the renderer
 * can cache a result for as long as the anchor's signature is unchanged — which is what keeps two
 * thousand strokes at sixty frames.
 */

import {
  type AnchorContext,
  type BoardFrame,
  type BoardRect,
  boxesOverlap,
  padBox,
  pointBox,
  pointOn,
  pxPerUnit,
  resolveAnchorBox,
  unionBox,
} from './anchors';
import {
  glyphAt,
  type HandFont,
  type HandGlyph,
  hasScripts,
  layoutTex,
  measureText,
  scriptText,
  tallestGlyphRatio,
  texPlainText,
  wrapText,
  writeScripted,
  writeText,
} from './handwriting';
import {
  LABEL_MARGIN,
  REACH_AIM,
  placeLabel,
  placeLabelAt,
  placeNote,

  solveWritten,
  type WrittenFit,
} from './layout';
import { fillStroke, penRng, penStroke, polylineLength, ruledStroke, type Stroke } from './pen';
import { type AnchorAt, BOARD_UNITS, type BoardObject, type BoardPoint } from './schema';

/** Everything the renderer needs to paint one object. */
export interface ObjectGeometry {
  /** Pen strokes, in the order the hand makes them. */
  strokes: Stroke[];
  /** Written glyphs (a note, a number, an equation). */
  glyphs: HandGlyph[];
  /** Type size in board units, when anything is written — sizes the pen mask. */
  size?: number;
  /** The written text, for the no-font fallback and for the accessible label. */
  text?: { lines: string[]; x: number; y: number; size: number; lineHeight: number };
  /** An embedded image, placed in board units. */
  image?: { href: string; alt: string; box: BoardRect };
  /** A control's live geometry, so the renderer can attach the interaction. */
  control?: {
    variable: string;
    kind: 'slider' | 'toggle' | 'input' | 'drag';
    hit: BoardRect;
    /** The knob or handle, for a drag. */
    knob?: BoardRect;
  };
  box: BoardRect;
  /** Total pen travel in board units — the object's own clock. */
  length: number;
}

const empty = (box: BoardRect): ObjectGeometry => ({ strokes: [], glyphs: [], box, length: 0 });

function totalLength(strokes: Stroke[], glyphs: HandGlyph[]): number {
  let n = 0;
  for (const s of strokes) n += s.length;
  for (const g of glyphs) for (const t of g.trace) n += t.length;
  return n;
}

/** Format a verified quantity for the board — the value as computed, never re-derived here. */
export function formatQuantity(value: number, precision?: number, unit?: string): string {
  const shown = precision === undefined ? String(value) : value.toFixed(precision);
  return unit ? `${shown} ${unit}` : shown;
}

/** Default type size for a written note, in board units. */
export const WRITE_SIZE = 30;
export const LABEL_SIZE = 22;

/**
 * THE FLOOR TYPE LANDS ON, IN SCREEN PIXELS (docs/INK-FOUR.md, craft; the adversary, wave 47,
 * finding 3).
 *
 * "Labels at least 12 px on the glass." `WRITE_SIZE` and `LABEL_SIZE` are BOARD UNITS, and a
 * board's units are scaled to the surface and then again by the camera, while strokes already
 * render in screen pixels (`vectorEffect="non-scaling-stroke"`). So the hand's weight held while
 * its writing shrank: 37 of 78 written objects across 9 of the 16 from-scratch boards measured
 * under 12 px — 7.0 px for 'image' on the lens board at 390, 7.2 px for 'apex' on the projectile
 * at 1440, 9.3 px for every plant-cell label at 390, 9.9 px for every written Punnett cell at
 * 1440.
 */
export const MIN_TYPE_PX = 12;

/**
 * WHAT THE HAND AIMS AT, against a law of `MIN_TYPE_PX`.
 *
 * The solvers work on the glyph boxes the hand laid and the board's settled scale; the browser
 * then re-measures the traced path it painted under the camera that actually arrived. They are the
 * same quantity to within a rounding, and a board solved to land EXACTLY on twelve lands at 11.9.
 * A pixel and a bit of headroom is the honest price of computing a thing the browser re-measures,
 * and it is set by the spread wave 49 measured (the lens at 1440: 12.8 with motion, 11.8 with
 * reduced motion, off one solve).
 */
export const TYPE_AIM = MIN_TYPE_PX + 1.2;

/**
 * The board-unit type size that renders at least `MIN_TYPE_PX` on this frame.
 *
 * NOT WIRED INTO `geometryOf`, AND HERE IS WHY (measured, wave 47). Applying it to every written
 * size closes a loop: the type grows, the ink box grows with it, the camera fits the bigger box by
 * zooming OUT, `pxPerUnit` falls, and the floor demands more units again. The geometry cache is
 * keyed on `frame.zoom`, so the loop runs once per camera frame and settles wherever the glide
 * happens to leave it — at 390 the Punnett square came out with its cells overflowing their own
 * grid and the same board measured 230 units wide on one path and 288 on another. A floor that
 * depends on the camera cannot live inside the geometry the camera is fitted to.
 *
 * The law is right and stays written down with its tests. Whoever closes finding 3 has to break
 * the loop, not tighten it: either the floor reads the surface at zoom 1 (`frame.scale`, or
 * `frame.width / BOARD_UNITS`) and never the live camera, or the camera carries a minimum zoom
 * derived from the smallest type and the pipelines size their drawings to the board.
 */
export function typeUnits(base: number, frame: BoardFrame): number {
  const k = pxPerUnit(frame);
  if (!(k > 0)) return base;
  return Math.max(base, MIN_TYPE_PX / k);
}

/**
 * THE FLOOR, WIRED IN AT LAST — as ONE factor for the whole board, resolved outside the geometry
 * (wave 48, finding 5; wave 47, finding 3).
 *
 * The loop the note above describes is real, and this is the shape that breaks it. Write out what
 * a glyph of `h` units actually measures on the glass under an auto-fitted camera:
 *
 *     px = h · pxPerUnit(zoom 1) · zoom,   zoom = CAMERA_FILL · BOARD_UNITS / inkWidth
 *        = h · (frame.width / BOARD_UNITS) · CAMERA_FILL · BOARD_UNITS / inkWidth
 *        = CAMERA_FILL · frame.width · h / inkWidth
 *
 * The camera cancels. What decides whether a label is legible is not the zoom at all — it is the
 * label's height as a FRACTION OF THE INK'S OWN EXTENT, against the surface's width in px. So the
 * floor never has to read the camera it moves, and there is no loop to settle: `typeScaleFor` in
 * the renderer solves that one fraction against the ink a pilot build measured, and hands the
 * answer down here as a single number.
 *
 * One factor for the whole board, and not a per-object rescue, because a board where one label
 * grew and its neighbour did not is no longer a hand — it is a ransom note. The hand's own
 * proportions (a note is bigger than a label, a title bigger than a cell) are kept exactly.
 */
export function scaledType(ctx: { typeScale?: number }, base: number): number {
  const k = ctx.typeScale ?? 1;
  return k > 1 ? base * k : base;
}

/**
 * A SURFACE FITTED BY A CAMERA — a board — as against the glass, where one unit is one pixel.
 *
 * The two laws below are about what a camera does to writing, so neither one applies to the glass:
 * there the hand's sizes ARE screen pixels, `pxPerUnit` reads `frame.scale`, and nothing shrinks.
 */
function onBoard(frame: BoardFrame): boolean {
  return frame.scale === undefined;
}

/**
 * THE HAND'S SMALLEST WRITING ON A BOARD, IN BOARD UNITS (the adversary, wave 51, finding 1;
 * INK-FOUR craft, "labels at least 12 px on the glass").
 *
 * `LABEL_SIZE` is two thirds of `WRITE_SIZE`, and that contrast is what fails the law: on every
 * board the writing that measures under twelve pixels is the LABEL-sized half, sitting beside
 * WRITE-sized numbers that clear it comfortably. Measured on the projectile board at 390: 'apex'
 * 9.6 px, 'up-speed is zero here' 9.8 px and the ground axis's own label 9.8 px, against 'range
 * 40.79 m' at 12.1 px right beside them — one hand, two legibilities, and only the small half is
 * illegible.
 *
 * A pipeline may ask for a size, and an explicit `size: 22` is exactly what the projectile's apex
 * label asks for. It may not ask for one the board cannot hold. So a board's writing has a floor
 * of its own, whoever chose the size, and the hand's two sizes come within a whisker of each other
 * rather than a third apart — which is what a hand does at arm's length anyway.
 *
 * TWENTY-EIGHT, measured and not tuned. All sixteen from-scratch board plans were captured off
 * the wire and replayed through `buildObjects` and the renderer's own type ladder, on the real
 * surfaces the plane gives them (366 × 333 at 390, 496 × 282 at 1440). Under 27 the projectile
 * board falls back under the law; at 32 the type is large enough that notes start landing on one
 * another. 28 sits inside the band that clears both, with the worst of the sixteen at 13.2 px.
 */
export const MIN_WRITTEN_UNITS = 28;

/**
 * THE MEASURE A WRITTEN LINE IS HELD TO ON A BOARD, IN BOARD UNITS (same finding).
 *
 * WHY A FLOOR ALONE IS NOT ENOUGH, and why a measure is the other half. Take the algebra
 * `scaledType` is built on and put a text-dominated board through it. Under an auto fit
 *
 *     px = CAMERA_FILL · frame.width · h / inkWidth
 *
 * and when the widest thing on the board is a line of writing, `inkWidth ≈ c · h · characters`.
 * The `h` cancels:
 *
 *     px ≈ CAMERA_FILL · frame.width / (c · characters)
 *
 * — the size of the writing has dropped out of its own legibility, and so has every rung of the
 * type ladder. That is the projectile board at 390. Measured on its real plan and its real
 * surface, the ladder walks 1 → 1.25 → 1.5 → 1.75 → 2 and the smallest glyph goes 9.58 → 9.49 →
 * 9.37 → 9.28 → 9.38 px: every rung grows the type, the ink grows with it, the camera gives back
 * exactly what was gained, and the board ends where it started. `MAX_TYPE_SCALE`'s note in the
 * renderer calls this board "a pipeline's problem, not the hand's"; it is neither. It is a line of
 * writing wider than the drawing it belongs to, and the hand's own answer to that is to wrap.
 *
 * TWO FIFTHS OF THE BOARD, AND THE SURFACE'S OWN PROPORTION. Wrapping trades ink WIDTH for ink
 * HEIGHT, so it helps exactly while width is what the camera is fitted to. A board seen through a
 * wide window (496 × 282 at 1440) is already fitted on its HEIGHT, and wrapping there costs more
 * than it buys — measured: that board goes from 11.4 px to 8.5 px under a measure that does not
 * know the shape of the window. So the measure opens with the window: `LINE_MEASURE`, times how
 * much wider than tall the surface is. Across the sixteen boards a base of 360 to 450 all measure
 * the same, 13.2 px at the worst; 400 is the middle of that band. The surface at zoom 1 is a
 * stable input, unlike the gliding camera `typeUnits` warns about, so there is still no loop.
 *
 * A pipeline that asks for a narrower `maxWidth` still gets it; nothing gets a wider one.
 */
export const LINE_MEASURE = (BOARD_UNITS * 2) / 5;

/** The measure on this surface: `LINE_MEASURE`, opened out by a wide window. Infinite off-board. */
export function lineMeasure(frame: BoardFrame): number {
  if (!onBoard(frame)) return Number.POSITIVE_INFINITY;
  const w = frame.width > 0 ? frame.width : 1;
  const h = frame.height > 0 ? frame.height : 1;
  return LINE_MEASURE * Math.max(1, w / h);
}

/** The tallest single glyph in a built object, in board units — what the floor is measured on. */
export function tallestGlyphUnits(geometry: ObjectGeometry): number {
  let tall = 0;
  for (const g of geometry.glyphs) if (g.box.h > tall) tall = g.box.h;
  return tall;
}

interface BuildContext extends AnchorContext {
  font: HandFont | null;
  /**
   * The board's one written-type factor (`scaledType`). 1, or absent, is the hand's own sizes.
   * Resolved by the renderer against the ink's extent, never against the live camera.
   */
  typeScale?: number;
  /** Boxes already placed this frame, so a written label lands in free space. */
  occupied?: BoardRect[];
  /**
   * The surface's own area in units. A board is 1000 wide by its aspect; the glass is its own px.
   * Placement never leaves it. Unset, the 1000-unit board is assumed.
   */
  area?: BoardRect;
  /**
   * Boxes on the glass a note must not land on (the page's own text lines, from the glass map),
   * asked for lazily and only for the neighbourhood of a subject, in units.
   */
  avoid?: (near: BoardRect) => BoardRect[];
  /**
   * SCREEN PIXELS PER BOARD UNIT ON THIS BOARD, AS THE BOARD IS ACTUALLY SEEN (wave 58, finding 2).
   *
   * Both craft laws about a written mark are stated in pixels — at least twelve tall, no more than
   * twenty-four from its subject — and the solver that has to satisfy them both works in board
   * units. This is the one number that converts between them, and it is resolved OUTSIDE the
   * geometry for exactly the reason `typeUnits` gives: a scale read off the live camera closes a
   * loop, because what the geometry does with it moves the camera. The renderer settles it against
   * the ink the same way it settles `typeScale`, and hands it down. Unset, the frame's own
   * `pxPerUnit` stands — which is exact on the glass, where one unit is one pixel and no camera
   * ever moves it.
   */
  glassScale?: number;
}

/** The relative-points convention: a shape's `points` are offsets from its resolved anchor point. */
function offsetPoints(origin: BoardPoint, points: BoardPoint[]): BoardPoint[] {
  return points.map((p) => [origin[0] + p[0], origin[1] + p[1]] as BoardPoint);
}

/** A two-barb arrowhead at `tip`, opening back along `dir`. */
function arrowHead(tip: BoardPoint, dir: BoardPoint, len: number): Stroke {
  const nx = -dir[0];
  const ny = -dir[1];
  const cos = Math.cos(0.42);
  const sin = Math.sin(0.42);
  const a: BoardPoint = [
    tip[0] + (nx * cos - ny * sin) * len,
    tip[1] + (nx * sin + ny * cos) * len,
  ];
  const b: BoardPoint = [
    tip[0] + (nx * cos + ny * sin) * len,
    tip[1] + (-nx * sin + ny * cos) * len,
  ];
  const pts = [a, tip, b];
  return {
    d: `M ${a[0].toFixed(2)} ${a[1].toFixed(2)} L ${tip[0].toFixed(2)} ${tip[1].toFixed(2)} L ${b[0].toFixed(2)} ${b[1].toFixed(2)}`,
    length: polylineLength(pts),
    weight: 0.85,
  };
}

/** The clear air an arrowhead keeps off the thing it points at, in board units (BOARD.md §7). */
export const ARROW_GAP = 6;

/** The margin an axis's reported box keeps around its rule, its ticks and its label. */
const AXIS_BOX_PAD = 12;

/**
 * The point on `box`'s outline facing `towards`, backed off by `gap`.
 *
 * A zero-size box (a bare board coordinate) has no outline, so it is its own answer — an arrow to
 * a point lands on the point. Otherwise the ray from the box's centre towards `towards` is
 * intersected with the box's own sides; a `towards` inside the box degrades to the centre rather
 * than dividing by zero.
 */
export function edgePoint(box: BoardRect, towards: BoardPoint, gap = ARROW_GAP): BoardPoint {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (box.w <= 0 && box.h <= 0) return [box.x, box.y];
  const dx = towards[0] - cx;
  const dy = towards[1] - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [cx, cy];
  const ux = dx / len;
  const uy = dy / len;
  // How far along the ray the box's own outline is: the nearer of the two side crossings.
  const tx = Math.abs(ux) > 1e-6 ? box.w / 2 / Math.abs(ux) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(uy) > 1e-6 ? box.h / 2 / Math.abs(uy) : Number.POSITIVE_INFINITY;
  // Never reach past the thing pointing at it, and never fall back inside the box.
  const reach = Math.max(0, Math.min(Math.min(tx, ty) + gap, len));
  return [cx + ux * reach, cy + uy * reach];
}

function unit(from: BoardPoint, to: BoardPoint): BoardPoint {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  return len > 0 ? [dx / len, dy / len] : [1, 0];
}

/**
 * A circle around a box, drawn as a hand does it: a loop and a bit, not a compass arc.
 *
 * A wide short box (one row of text) gets a LOZENGE: two half-circles joined by nearly flat runs,
 * so the ring hugs the line instead of an ellipse whose top and bottom strike through the rows
 * either side of it (the scorecard's 72 to 83 px ellipse on a 36 px pitch).
 */
function loopAround(box: BoardRect, rng: () => number): Stroke {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = Math.max(box.w / 2, 12);
  const ry = Math.max(box.h / 2, 10);
  const start = rng() * Math.PI * 2;
  const turns = 1.12;
  const steps = 48;
  const pts: BoardPoint[] = [];
  const lozenge = rx > ry * 2.5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * turns * Math.PI * 2;
    const grow = 1 + t * 0.03;
    if (lozenge) {
      // Round ends of radius ry, flat runs between them: the loop stays inside the row's own pitch.
      const flat = rx - ry;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const x = cx + (c >= 0 ? flat : -flat) * grow + c * ry * grow;
      const y = cy + sn * ry * (1 + t * 0.02);
      pts.push([x, y]);
    } else {
      pts.push([cx + Math.cos(a) * rx * grow, cy + Math.sin(a) * ry * grow]);
    }
  }
  return penStroke(pts, rng, { wobble: lozenge ? 1.1 : 1.6, anticipation: 0.004, overshoot: 0 });
}

/**
 * Written text, placed and measured. Returns nothing drawable when the font never arrived.
 *
 * A line carrying `^` or `_` — `a^2`, `x_1`, `a^2 + b^2 = c^2` — is written as MATHS, not as its
 * source: the script layout raises the power and drops the index in Wobo's own hand, and the no-font
 * fallback shows the real characters (a², x₁) rather than the carets Wobo never says out loud.
 */
function written(
  ctx: BuildContext,
  text: string,
  origin: BoardPoint,
  size: number,
  maxWidth?: number,
): {
  glyphs: HandGlyph[];
  strokes: Stroke[];
  box: BoardRect;
  lines: string[];
  lineHeight: number;
} {
  const lineHeight = size * 1.22;
  const scripted = hasScripts(text);
  if (!ctx.font) {
    const plain = scripted ? scriptText(text) : text;
    const lines = plain.split('\n');
    const approx = Math.max(...lines.map((l) => l.length)) * size * 0.42;
    return {
      glyphs: [],
      strokes: [],
      box: { x: origin[0], y: origin[1], w: approx, h: lines.length * lineHeight },
      lines,
      lineHeight,
    };
  }
  if (scripted) {
    const laid = writeScripted(ctx.font, text, origin, size);
    return {
      glyphs: laid.glyphs,
      strokes: laid.rules,
      box: { x: origin[0], y: origin[1], w: laid.width, h: laid.height },
      lines: [scriptText(text)],
      lineHeight,
    };
  }
  const laid = writeText(ctx.font, text, origin, { size, maxWidth, lineHeight });
  return {
    glyphs: laid.glyphs,
    strokes: [],
    box: { x: origin[0], y: origin[1], w: laid.width, h: laid.height },
    // THE LINES AS WRITTEN, not as asked for. `lines` is what the no-font fallback paints and what
    // the accessible label reads; a note held to a measure that reported itself as one long line
    // told both of them something that is not on the glass.
    lines: wrapText(ctx.font, text, size, maxWidth),
    lineHeight,
  };
}

/**
 * WHERE A WRITTEN MARK GOES, AND HOW BIG — DECIDED TOGETHER (the adversary, wave 57, finding 2).
 *
 * This used to be a sequence: `sized()` chose a size, then `placeLabelAt`/`placeLabel` went looking
 * for somewhere a box that large would fit and, failing, walked away down the board. That is how
 * closing the twelve-pixel floor broke the twenty-four-pixel reach — the writing grew, the boxes
 * grew with it, and 29 of the 60 marks that hang off something ended up past the reach, worst
 * 'Chauri Chaura, called off' 111 px from its own tick.
 *
 * Now the legible sizes, the measures the line may be wrapped to, and the positions around the
 * subject are ONE search (`solveWritten`), and the reach is a constraint on every candidate rather
 * than something checked afterwards. The size never goes under the board's own floor, so the
 * twelve-pixel law is kept by construction; what gives instead is the line length (a long note
 * wraps), then the size within its legible band, and only then the distance.
 *
 * The side the anchor named is still the first thing tried, at both margins, before anything else.
 */
function notePlacement(
  ctx: BuildContext,
  anchorBox: BoardRect,
  text: string,
  size: number,
  maxWidth?: number,
  at?: AnchorAt,
  opts?: {
    allowInside?: boolean;
    floor?: number;
    /** The pipeline's `offset`, when the anchor named an OBJECT — see `WrittenSolve.nudge`. */
    nudge?: readonly [number, number];
    /** The subject's box as it sits in `occupied` — see `WrittenSolve.subjectBox`. */
    subjectBox?: BoardRect;
  },
): WrittenFit {
  const asked = maxWidth ?? measureOn(ctx.frame);
  if (anchorBox.w === 0 && anchorBox.h === 0) {
    const shape = noteSize(ctx, text, size, asked);
    return {
      box: { x: anchorBox.x, y: anchorBox.y, ...shape },
      size,
      maxWidth: asked,
      gap: 0,
      withinReach: true,
      inside: false,
    };
  }
  /**
   * A FRACTION PAIR IS A POINT, NOT A SIDE. `{at: [0.43, 0.39]}` is a pipeline writing in a named
   * cell of its own table; there is nothing to solve and nothing to dodge.
   */
  if (Array.isArray(at)) {
    const placed = placeLabelAt(anchorBox, noteSize(ctx, text, size, asked), at, [], LABEL_MARGIN);
    if (placed) {
      return {
        box: placed,
        size,
        maxWidth: asked,
        gap: 0,
        withinReach: true,
        inside: true,
      };
    }
  }
  const occupied = ctx.occupied ?? [];
  const floor = typeFloorFor(ctx, text, size);
  return solveWritten({
    subject: anchorBox,
    at: at as Exclude<AnchorAt, readonly number[]> | undefined,
    measure: (s, mw) => noteSize(ctx, text, s, mw),
    sizes: sizeLadder(size, floor),
    maxWidth: asked,
    occupied,
    ...(opts?.subjectBox ? { subjectBox: opts.subjectBox } : {}),
    area: ctx.area,
    margin: LABEL_MARGIN,
    reach: reachUnits(ctx),
    allowInside: opts?.allowInside ?? true,
    ...(opts?.nudge ? { nudge: opts.nudge } : {}),
  });
}

/**
 * THE REACH LAW IN BOARD UNITS: twenty-four pixels, converted by how big a unit actually is on
 * this board. See `BuildContext.glassScale`.
 */
function reachUnits(ctx: BuildContext): number {
  const k = ctx.glassScale ?? pxPerUnit(ctx.frame);
  return k > 0 ? REACH_AIM / k : REACH_AIM;
}

/**
 * THE LEGIBLE BAND FOR ONE MARK, largest first.
 *
 * The top is what the hand (or the pipeline) asked for; the bottom is the LAW — the size at which
 * this phrase's own tallest glyph measures `MIN_TYPE_PX` on this board (`typeFloorFor`). Nothing
 * here can take a mark under that, so the solver trades line length and distance, never
 * legibility; and nothing above it is defended, so there is real room to come down.
 *
 * WHY THE LAW AND NOT `MIN_WRITTEN_UNITS × typeScale`, which is what wave 51 left behind. That
 * proxy scales with the board's type factor, so a board the ladder had grown to a factor of two
 * offered the solver a band of 56 to 60 units — a seven per cent shrink, which is no room at all.
 * Measured on the projectile at 390: at a factor of two the true floor for 'greatest height' is
 * 44 units against an asked 60, and it is those sixteen units that let the note sit beside the
 * apex instead of 194 units under it.
 *
 * THE BAND GOES UP AS WELL AS DOWN. When the size a pipeline asked for would land UNDER the law,
 * the floor is above it and the floor is what gets written: a mark too small to read is not a
 * mark, whatever was asked. That is the whole of what `typeScale`'s ladder was for, done per mark
 * and against the measured law instead of as one global guess — which is why most boards now
 * settle at a factor of one.
 */
function sizeLadder(asked: number, floor: number): number[] {
  const low = Math.max(floor, 1);
  const top = Math.max(asked, low);
  if (!(top > low + 0.5)) return [low];
  const out = [top];
  for (const k of [0.88, 0.76, 0.64]) {
    const next = top * k;
    if (next > low + 0.5) out.push(next);
  }
  out.push(low);
  return out;
}

/**
 * THE SMALLEST THIS PHRASE MAY BE WRITTEN ON THIS BOARD, IN UNITS — the twelve-pixel law itself.
 *
 * The law is about the tallest glyph a mark actually writes, and that is a property of the phrase:
 * 'recessive' carries neither ascender nor cap and 'greatest height' carries both. So the floor is
 * measured off the phrase (`tallestGlyphRatio`) and converted by how big a unit is on this board
 * (`glassScale`). With neither a font nor a scale to measure with, the hand's own written floor
 * stands.
 */
function typeFloorFor(ctx: BuildContext, text: string, asked: number): number {
  const k = ctx.glassScale;
  if (!ctx.font || !k || !(k > 0)) return asked;
  const ratio = tallestGlyphRatio(ctx.font, text);
  if (!(ratio > 0)) return asked;
  /**
   * NEVER MORE THAN `MAX_GROWTH` TIMES WHAT WAS ASKED. Growing a mark widens the ink the camera is
   * fitted to, so on a board whose ink is mostly writing the camera gives back what the growth
   * won — `typeUnits`'s loop, seen from the one side where it is real. The cap is where that
   * stops being worth trying; a board that hits it is a drawing too dense for its surface, and it
   * is reported as such rather than rendered as a wall of type.
   */
  return Math.min(TYPE_AIM / (ratio * k), asked * MAX_GROWTH);
}

/** How much bigger than the size it was asked for a mark may be written to clear the law. */
export const MAX_GROWTH = 2.5;

/** The width a line of writing is held to on a surface, with no pipeline measure to narrow it. */
function measureOn(frame: BoardFrame): number {
  return lineMeasure(frame);
}

/**
 * The size a written note takes, measured without placing it.
 *
 * IT COUNTS THE LINES IT WILL ACTUALLY BE WRITTEN ON. Held to a measure a note wraps, and a
 * two-line note placed as though it were one line is placed over whatever sits under it. The wrap
 * costs one pass of glyph advances and it is the very wrap `written` lays.
 */
function noteSize(ctx: BuildContext, text: string, size: number, maxWidth?: number) {
  const cap = maxWidth ?? Number.POSITIVE_INFINITY;
  if (!ctx.font) {
    const lines = text.split('\n');
    return {
      w: Math.min(Math.max(...lines.map((l) => l.length)) * size * 0.42, cap),
      h: lines.length * size * 1.22,
    };
  }
  const font = ctx.font;
  const lines = wrapText(font, text, size, maxWidth);
  return {
    w: Math.min(Math.max(...lines.map((l) => measureText(font, l, size))), cap),
    h: lines.length * size * 1.22,
  };
}

/** A check mark: a short stroke down and a longer one up, the way a hand ticks. */
function tickStrokes(at: BoardPoint, size: number, rng: () => number): Stroke[] {
  const s = size;
  const pts: BoardPoint[] = [
    [at[0] - s * 0.45, at[1] + s * 0.05],
    [at[0] - s * 0.12, at[1] + s * 0.42],
    [at[0] + s * 0.55, at[1] - s * 0.45],
  ];
  return [penStroke(pts, rng, { wobble: 0.6, overshoot: 0.03 })];
}

/**
 * Build the geometry for one object. Returns null when the thing it anchors to is gone — the
 * renderer fades such a mark out rather than letting it float.
 */
/**
 * Chrome ink, in nib multiples — the renderer's nib is 3px (DESIGN.md: ink 3–4px, never under 2.5).
 * A graph's axes are the boldest rule on the board at 3.5px; the grid behind them is 2.5px, the
 * thinnest ink the law allows, so the curve on top is what the eye lands on.
 */
const AXIS_INK = 3.5 / 3;
const GRID_INK = 2.5 / 3;

/** A ruled stroke at a chrome weight — the grid and the axes, and nothing else. */
function chromeRule(points: BoardPoint[], weight: number): Stroke {
  return { ...ruledStroke(points), weight };
}

export function geometryOf(object: BoardObject, ctx: BuildContext): ObjectGeometry | null {
  // Every written size on this board: the hand's own size or the pipeline's, never under the
  // board's floor (`MIN_WRITTEN_UNITS`), then the board's one factor (`scaledType`).
  const sized = (asked: number | undefined, base: number) =>
    scaledType(ctx, Math.max(asked ?? base, onBoard(ctx.frame) ? MIN_WRITTEN_UNITS : 0));
  /**
   * THE SMALLEST THIS BOARD WRITES, and the bottom of every solved mark's legible band. On a board
   * it is `MIN_WRITTEN_UNITS` under the board's own type factor — the size the ladder settled as
   * twelve pixels. On the glass a unit is a pixel, so the law is the law.
   */
  const typeFloor = onBoard(ctx.frame) ? scaledType(ctx, MIN_WRITTEN_UNITS) : MIN_TYPE_PX;
  const LABEL = sized(undefined, LABEL_SIZE);
  const WRITE = sized(undefined, WRITE_SIZE);
  /**
   * THE LAW APPLIES TO EVERY WRITTEN GLYPH, NOT ONLY TO THE ONES THE SOLVER PLACES (wave 58).
   *
   * An axis's own label, a table's cells, a control's caption and a plotted title are all written
   * by hand right here rather than through `notePlacement`, and every one of them was outside the
   * twelve-pixel floor. Measured on the projectile at 390: the word 'ground' on the ground axis
   * came out at 7.8 px, and because the board's type ladder is settled on the SMALLEST glyph, that
   * one unsolved word was what dragged the whole board up to a factor of two — which is what then
   * pushed the notes off the apex. One law, applied wherever the hand writes.
   */
  const legible = (text: string, asked: number) =>
    Math.max(asked, Math.min(typeFloorFor(ctx, text, asked), asked * MAX_GROWTH));
  // The width a line of writing is held to on this surface (`lineMeasure`), never wider than what
  // the pipeline itself asked for.
  const measure = (asked?: number) =>
    asked !== undefined && asked > 0 ? Math.min(asked, lineMeasure(ctx.frame)) : lineMeasure(ctx.frame);
  const rng = penRng(object.id, object.kind);
  const anchor = 'anchor' in object ? object.anchor : undefined;
  const box = anchor ? resolveAnchorBox(anchor, ctx) : { x: 0, y: 0, w: 1000, h: 1000 };
  if (anchor && !box) return null;
  const at = anchor && 'at' in anchor ? anchor.at : undefined;
  const anchorBox = box as BoardRect;
  const p = pointOn(anchorBox, at);
  /**
   * THE SUBJECT, BEFORE THE PIPELINE NUDGED IT (the adversary, wave 57, finding 2).
   *
   * `resolveAnchorBox` folds an `offset` into the box it returns, so a written mark asking for
   * `{object: "tick", at: "bottom", offset: [-260, 0]}` used to be solved against a phantom box
   * 260 units from the tick it names — and 260 units is not a nudge on a board 1000 wide, it is
   * the timeline pipeline doing its own placement to stop the drift this solver now stops. The
   * reach law is measured to the THING, so the thing is what the solver is given; the nudge comes
   * along as a preference. Only for an `{object: …}` anchor: a nudge off a bare board coordinate
   * IS the position, and there is no subject behind it.
   */
  const nudge =
    anchor && 'object' in anchor && 'offset' in anchor && anchor.offset ? anchor.offset : undefined;
  const drawnBox = anchor && 'object' in anchor ? ctx.objectBox(anchor.object) : null;
  const subjectBox = nudge
    ? { ...anchorBox, x: anchorBox.x - nudge[0], y: anchorBox.y - nudge[1] }
    : anchorBox;
  /** What the subject is in `occupied`: the very box the renderer pushed when it drew it. */
  const drawn = drawnBox ?? undefined;

  switch (object.kind) {
    case 'point': {
      const tip: BoardPoint = [p[0], p[1]];
      const from: BoardPoint = [p[0] - 34, p[1] - 26];
      const shaft = penStroke([from, tip], rng, { wobble: 1.1 });
      const head = arrowHead(tip, unit(from, tip), 11);
      const strokes = [shaft, head];
      return {
        strokes,
        glyphs: [],
        box: {
          x: Math.min(from[0], tip[0]) - 6,
          y: Math.min(from[1], tip[1]) - 6,
          w: Math.abs(tip[0] - from[0]) + 12,
          h: Math.abs(tip[1] - from[1]) + 12,
        },
        length: totalLength(strokes, []),
      };
    }
    case 'ring':
    case 'circle': {
      const target = padBox(
        anchorBox.w + anchorBox.h > 0 ? anchorBox : padBox(pointBox(p), 34),
        object.pad ?? 9,
      );
      const stroke = loopAround(target, rng);
      return { strokes: [stroke], glyphs: [], box: padBox(target, 6), length: stroke.length };
    }
    case 'tick': {
      // Beside the thing, on its line, clear of its text: a tutor ticks in the margin. Clear of
      // any mark already beside the row too (a note, a bracket): it steps right past them.
      const size = Math.max(14, Math.min(28, anchorBox.h > 0 ? anchorBox.h * 0.9 : 20));
      const centre: BoardPoint =
        anchorBox.w + anchorBox.h > 0
          ? [anchorBox.x + anchorBox.w + 8 + size * 0.5, anchorBox.y + anchorBox.h / 2]
          : p;
      const tickBox = (): BoardRect => ({
        x: centre[0] - size * 0.5,
        y: centre[1] - size * 0.5,
        w: size * 1.1,
        h: size,
      });
      // Only what is genuinely beside the row moves it along: a mark on its own line. The padded
      // box of a ring round the row BELOW grazes this row's band, and stepping away from that
      // would take the tick off the line it is about.
      const onThisLine = (o: BoardRect): boolean =>
        Math.abs(o.y + o.h / 2 - centre[1]) < size * 0.75 && boxesOverlap(o, tickBox());
      let guard = 0;
      while ((ctx.occupied ?? []).some(onThisLine) && guard++ < 8) {
        centre[0] += size * 0.8;
      }
      const strokes = tickStrokes(centre, size, rng);
      return { strokes, glyphs: [], box: tickBox(), length: totalLength(strokes, []) };
    }
    case 'cross': {
      // Through the thing, corner to corner: two strokes, the second a beat after the first.
      const b = anchorBox.w + anchorBox.h > 0 ? padBox(anchorBox, 3) : padBox(pointBox(p), 12);
      const one = penStroke(
        [
          [b.x, b.y],
          [b.x + b.w, b.y + b.h],
        ],
        rng,
        { wobble: 0.9 },
      );
      const two = penStroke(
        [
          [b.x + b.w, b.y],
          [b.x, b.y + b.h],
        ],
        rng,
        { wobble: 0.9 },
      );
      const strokes = [one, two];
      return { strokes, glyphs: [], box: padBox(b, 4), length: totalLength(strokes, []) };
    }
    case 'note': {
      // In the margin, dodging the page's own text, within reach of its subject. A mark already
      // on the subject (a ring round it, a cross through it) is part of what the note is beside:
      // the note sits beside the ring on the ring's own line, rather than sliding up a row to
      // dodge the ring's box and reading as a note on the line above.
      const size = sized(object.size, LABEL_SIZE);
      const measured = noteSize(ctx, object.text, size, object.maxWidth);
      const around = padBox(anchorBox, 12);
      const hugging = (ctx.occupied ?? []).filter((o) => boxesOverlap(o, around));
      const subject = unionBox([anchorBox, ...hugging]) ?? anchorBox;
      const rest = (ctx.occupied ?? []).filter((o) => !hugging.includes(o));
      const pageText = ctx.avoid ? ctx.avoid(padBox(subject, 160)) : [];
      const occupied = [...rest, ...pageText];
      const frame = ctx.frame;
      // Beside a ring the ring's own pad is the air; the note keeps within reach of the row itself.
      const placed = placeNote(
        subject,
        measured,
        occupied,
        frame,
        hugging.length > 0 ? 4 : undefined,
      );
      const origin: BoardPoint = [placed.x, placed.y];
      const w = written(ctx, object.text, origin, size, object.maxWidth);
      return {
        strokes: w.strokes,
        glyphs: w.glyphs,
        size,
        text: { lines: w.lines, x: origin[0], y: origin[1], size, lineHeight: w.lineHeight },
        box: w.box,
        length: totalLength(w.strokes, w.glyphs),
      };
    }
    case 'underline': {
      const w = anchorBox.w > 0 ? anchorBox.w : 90;
      const x0 = anchorBox.w > 0 ? anchorBox.x : p[0] - w / 2;
      const y = anchorBox.h > 0 ? anchorBox.y + anchorBox.h + 5 : p[1] + 5;
      const pts: BoardPoint[] = [
        [x0 - 4, y],
        [x0 + w * 0.5, y + 2.2],
        [x0 + w + 4, y],
      ];
      const stroke = penStroke(pts, rng, { wobble: 1.4 });
      return {
        strokes: [stroke],
        glyphs: [],
        box: { x: x0 - 6, y: y - 4, w: w + 12, h: 10 },
        length: stroke.length,
      };
    }
    case 'strike': {
      const w = anchorBox.w > 0 ? anchorBox.w : 90;
      const x0 = anchorBox.w > 0 ? anchorBox.x : p[0] - w / 2;
      const y = anchorBox.h > 0 ? anchorBox.y + anchorBox.h * 0.55 : p[1];
      const stroke = penStroke(
        [
          [x0 - 5, y + 2],
          [x0 + w * 0.5, y - 1],
          [x0 + w + 5, y + 2],
        ],
        rng,
        { wobble: 1.5 },
      );
      return {
        strokes: [stroke],
        glyphs: [],
        box: { x: x0 - 6, y: y - 8, w: w + 12, h: 16 },
        length: stroke.length,
      };
    }
    case 'arrow': {
      const start = object.from ? resolveAnchorBox(object.from, ctx) : null;
      const fromAt = object.from && 'at' in object.from ? object.from.at : undefined;
      const rawFrom: BoardPoint = start ? pointOn(start, fromAt) : [p[0] - 120, p[1] - 80];
      // An arrow POINTS AT a thing; it does not run through it. The head stops on the outline of
      // the box it is about, with a hand's gap, and the tail leaves the outline of what it came
      // from — so a food web reads as arrows BETWEEN words rather than lines struck through them.
      // An `at` that named a point is that point, exactly: the tutor already chose where to land.
      const tip: BoardPoint =
        at === undefined ? edgePoint(anchorBox, rawFrom, ARROW_GAP) : (p as BoardPoint);
      const from: BoardPoint =
        start && fromAt === undefined ? edgePoint(start, tip, ARROW_GAP) : rawFrom;
      const bow = object.curve ?? 0;
      const mid: BoardPoint = [
        (from[0] + tip[0]) / 2 - (tip[1] - from[1]) * bow * 0.2,
        (from[1] + tip[1]) / 2 + (tip[0] - from[0]) * bow * 0.2,
      ];
      const shaft = penStroke([from, mid, tip], rng, { wobble: 1.3 });
      const head = arrowHead(tip, unit(mid, tip), 15);
      const strokes = [shaft, head];
      const bounds = unionBox([pointBox(from), pointBox(mid), pointBox(tip)]) ?? pointBox(tip);
      return { strokes, glyphs: [], box: padBox(bounds, 16), length: totalLength(strokes, []) };
    }
    case 'bracket': {
      const side = object.side ?? 'left';
      const b = anchorBox.w + anchorBox.h > 0 ? padBox(anchorBox, 8) : padBox(pointBox(p), 40);
      const vertical = side === 'left' || side === 'right';
      const nub = 9;
      let pts: BoardPoint[];
      if (side === 'left') {
        const x = b.x;
        pts = [
          [x + nub, b.y],
          [x, b.y + b.h * 0.25],
          [x - nub * 0.5, b.y + b.h / 2],
          [x, b.y + b.h * 0.75],
          [x + nub, b.y + b.h],
        ];
      } else if (side === 'right') {
        const x = b.x + b.w;
        pts = [
          [x - nub, b.y],
          [x, b.y + b.h * 0.25],
          [x + nub * 0.5, b.y + b.h / 2],
          [x, b.y + b.h * 0.75],
          [x - nub, b.y + b.h],
        ];
      } else if (side === 'top') {
        const y = b.y;
        pts = [
          [b.x, y + nub],
          [b.x + b.w * 0.25, y],
          [b.x + b.w / 2, y - nub * 0.5],
          [b.x + b.w * 0.75, y],
          [b.x + b.w, y + nub],
        ];
      } else {
        const y = b.y + b.h;
        pts = [
          [b.x, y - nub],
          [b.x + b.w * 0.25, y],
          [b.x + b.w / 2, y + nub * 0.5],
          [b.x + b.w * 0.75, y],
          [b.x + b.w, y - nub],
        ];
      }
      const stroke = penStroke(pts, rng, { wobble: 1.1 });
      const strokes = [stroke];
      let glyphs: HandGlyph[] = [];
      let boxes = [padBox(b, 12)];
      let text: ObjectGeometry['text'];
      if (object.label) {
        const labelBox: BoardRect = vertical
          ? { x: side === 'left' ? b.x - 16 : b.x + b.w, y: b.y, w: 1, h: b.h }
          : { x: b.x, y: side === 'top' ? b.y - 16 : b.y + b.h, w: b.w, h: 1 };
        const fit = notePlacement(ctx, labelBox, object.label, LABEL, undefined, undefined, {
          floor: typeFloor,
          allowInside: false,
        });
        const origin: BoardPoint = [fit.box.x, fit.box.y];
        const w = written(ctx, object.label, origin, fit.size, fit.maxWidth);
        glyphs = w.glyphs;
        boxes = [...boxes, w.box];
        text = {
          lines: w.lines,
          x: origin[0],
          y: origin[1],
          size: fit.size,
          lineHeight: w.lineHeight,
        };
      }
      return {
        strokes,
        glyphs,
        ...(text ? { text, size: LABEL } : {}),
        box: unionBox(boxes) ?? b,
        length: totalLength(strokes, glyphs),
      };
    }
    case 'number': {
      const label = formatQuantity(object.value, object.precision, object.unit);
      const full = object.label ? `${object.label} ${label}` : label;
      // A QUANTITY IS ONE WORD. Held to a measure, a greedy word wrap would happily leave '40.79'
      // on one line and 'm' on the next, which is not a number any more. So the break is chosen
      // here and not left to the wrap: when the whole will not sit on one line, the name takes a
      // line and the quantity goes under it, whole.
      const mw = measure();
      const fits = ctx.font
        ? measureText(ctx.font, full, WRITE) <= mw
        : full.length * WRITE * 0.42 <= mw;
      const laid = fits || !object.label ? full : `${object.label}\n${label}`;
      const fit = notePlacement(ctx, subjectBox, laid, WRITE, mw, at, {
        floor: typeFloor,
        ...(nudge ? { nudge } : {}),
        ...(drawn ? { subjectBox: drawn } : {}),
      });
      const origin: BoardPoint = [fit.box.x, fit.box.y];
      const w = written(ctx, laid, origin, fit.size, fit.maxWidth);
      return {
        strokes: w.strokes,
        glyphs: w.glyphs,
        size: fit.size,
        text: {
          lines: w.lines,
          x: origin[0],
          y: origin[1],
          size: fit.size,
          lineHeight: w.lineHeight,
        },
        box: w.box,
        length: totalLength(w.strokes, w.glyphs),
      };
    }
    case 'write': {
      const size = sized(object.size, WRITE_SIZE);
      const mw = measure(object.maxWidth);
      const fit = notePlacement(ctx, subjectBox, object.text, size, mw, at, {
        floor: typeFloor,
        ...(nudge ? { nudge } : {}),
        ...(drawn ? { subjectBox: drawn } : {}),
      });
      const origin: BoardPoint = [fit.box.x, fit.box.y];
      const w = written(ctx, object.text, origin, fit.size, fit.maxWidth);
      return {
        strokes: w.strokes,
        glyphs: w.glyphs,
        size: fit.size,
        text: {
          lines: w.lines,
          x: origin[0],
          y: origin[1],
          size: fit.size,
          lineHeight: w.lineHeight,
        },
        box: w.box,
        length: totalLength(w.strokes, w.glyphs),
      };
    }
    case 'label': {
      const size = sized(object.size, LABEL_SIZE);
      const mw = measure();
      const fit = notePlacement(ctx, subjectBox, object.text, size, mw, at, {
        floor: typeFloor,
        ...(nudge ? { nudge } : {}),
        ...(drawn ? { subjectBox: drawn } : {}),
      });
      const origin: BoardPoint = [fit.box.x, fit.box.y];
      const w = written(ctx, object.text, origin, fit.size, fit.maxWidth);
      return {
        strokes: w.strokes,
        glyphs: w.glyphs,
        size: fit.size,
        text: {
          lines: w.lines,
          x: origin[0],
          y: origin[1],
          size: fit.size,
          lineHeight: w.lineHeight,
        },
        box: w.box,
        length: totalLength(w.strokes, w.glyphs),
      };
    }
    case 'erase': {
      const target = ctx.objectBox(object.object);
      const b = target ? padBox(target, 8) : padBox(pointBox(p), 40);
      const y = b.y + b.h / 2;
      const stroke = penStroke(
        [
          [b.x - 10, y],
          [b.x + b.w + 10, y],
        ],
        rng,
        { wobble: 2.6, overshoot: 0.05 },
      );
      return {
        strokes: [{ ...stroke, weight: Math.max(2, b.h / 8) }],
        glyphs: [],
        box: b,
        length: stroke.length,
      };
    }
    case 'wipe': {
      const area = anchorBox.w > 0 ? anchorBox : { x: 0, y: 0, w: 1000, h: 620 };
      const strokes: Stroke[] = [];
      const passes = 3;
      for (let i = 0; i < passes; i++) {
        const y = area.y + (area.h * (i + 0.5)) / passes;
        const left = i % 2 === 0;
        const a: BoardPoint = [left ? area.x - 20 : area.x + area.w + 20, y];
        const b: BoardPoint = [left ? area.x + area.w + 20 : area.x - 20, y];
        strokes.push({
          ...penStroke([a, b], rng, { wobble: 3.5 }),
          weight: Math.max(3, area.h / passes / 9),
        });
      }
      return { strokes, glyphs: [], box: area, length: totalLength(strokes, []) };
    }
    case 'line': {
      const toBox = resolveAnchorBox(object.to, ctx);
      if (!toBox) return null;
      const to = pointOn(toBox, 'at' in object.to ? object.to.at : undefined);
      const stroke = penStroke([p, to], rng, { wobble: 1.1 });
      return {
        strokes: [stroke],
        glyphs: [],
        box: padBox(unionBox([pointBox(p), pointBox(to)]) ?? pointBox(p), 8),
        length: stroke.length,
      };
    }
    case 'polyline':
    case 'polygon':
    case 'curve': {
      const pts = offsetPoints(p, object.points);
      const closed = object.kind === 'polygon' || ('closed' in object && object.closed === true);
      const stroke = penStroke(pts, rng, {
        wobble: object.kind === 'curve' ? 0.9 : 1.2,
        closed,
        spacing: object.kind === 'curve' ? 10 : 18,
      });
      const strokes: Stroke[] = [];
      if (object.style?.fill && object.style.fill !== 'none' && closed)
        strokes.push(fillStroke(pts));
      strokes.push(stroke);
      return {
        strokes,
        glyphs: [],
        box: padBox(unionBox(pts.map(pointBox)) ?? pointBox(p), 8),
        length: stroke.length,
      };
    }
    case 'ellipse': {
      const pts: BoardPoint[] = [];
      const steps = 34;
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
        pts.push([p[0] + Math.cos(a) * object.rx, p[1] + Math.sin(a) * object.ry]);
      }
      const stroke = penStroke(pts, rng, { wobble: 1.1, anticipation: 0.004, overshoot: 0.004 });
      const strokes: Stroke[] = [];
      if (object.style?.fill && object.style.fill !== 'none') strokes.push(fillStroke(pts));
      strokes.push(stroke);
      return {
        strokes,
        glyphs: [],
        box: {
          x: p[0] - object.rx - 6,
          y: p[1] - object.ry - 6,
          w: object.rx * 2 + 12,
          h: object.ry * 2 + 12,
        },
        length: stroke.length,
      };
    }
    case 'axis': {
      const horizontal = object.orientation === 'x';
      const end: BoardPoint = horizontal
        ? [p[0] + object.length, p[1]]
        : [p[0], p[1] - object.length];
      const strokes: Stroke[] = [chromeRule([p, end], AXIS_INK)];
      strokes.push(arrowHead(end, unit(p, end), 12));
      const span = object.max - object.min;
      const glyphs: HandGlyph[] = [];
      if (object.ticks !== false && span > 0 && object.step > 0) {
        const count = Math.min(40, Math.floor(span / object.step));
        for (let i = 0; i <= count; i++) {
          const frac = (i * object.step) / span;
          const at: BoardPoint = horizontal
            ? [p[0] + object.length * frac, p[1]]
            : [p[0], p[1] - object.length * frac];
          const tick: BoardPoint[] = horizontal
            ? [
                [at[0], at[1] - 6],
                [at[0], at[1] + 6],
              ]
            : [
                [at[0] - 6, at[1]],
                [at[0] + 6, at[1]],
              ];
          strokes.push(chromeRule(tick, AXIS_INK));
        }
      }
      if (object.label && ctx.font) {
        // Past the arrowhead, unless past the arrowhead is past the BOARD. An x-axis 760 units
        // long starting at 120 ends at 880, so "distance in metres" was written from 890 and ran
        // to 1040 — off the right edge of a 1000-unit square, on every projectile board there is.
        // Measured there by the teaching harness, 2026-09-05. When it will not fit it goes under
        // the end of the axis instead, pulled back just far enough to sit on the board.
        const beside: BoardPoint = horizontal
          ? [end[0] + 10, end[1] + 4]
          : [end[0] + 10, end[1] - 8];
        const axisType = legible(object.label, LABEL);
        let written = writeText(ctx.font, object.label, beside, { size: axisType });
        // How far the GLYPHS actually reach, plus the pad this box reports, minus the board. An
        // estimated width is not good enough here: it is the measured ink that either fits or does
        // not, and a label two units over the edge is still a label over the edge.
        const inked = unionBox(written.glyphs.map((g) => g.box));
        const over = inked ? inked.x + inked.w + AXIS_BOX_PAD - BOARD_UNITS : 0;
        if (over > 0) {
          written = writeText(
            ctx.font,
            object.label,
            [Math.max(0, beside[0] - over), end[1] + axisType + 10],
            { size: axisType },
          );
        }
        glyphs.push(...written.glyphs);
      }
      const bounds =
        unionBox([pointBox(p), pointBox(end), ...glyphs.map((g) => g.box)]) ?? pointBox(p);
      return {
        strokes,
        glyphs,
        size: LABEL,
        box: padBox(bounds, AXIS_BOX_PAD),
        length: totalLength(strokes, glyphs),
      };
    }
    case 'grid': {
      const strokes: Stroke[] = [];
      const cw = object.w / object.cols;
      const ch = object.h / object.rows;
      for (let c = 0; c <= object.cols; c++) {
        const x = p[0] + c * cw;
        strokes.push(
          chromeRule(
            [
              [x, p[1]],
              [x, p[1] + object.h],
            ],
            GRID_INK,
          ),
        );
      }
      for (let r = 0; r <= object.rows; r++) {
        const y = p[1] + r * ch;
        strokes.push(
          chromeRule(
            [
              [p[0], y],
              [p[0] + object.w, y],
            ],
            GRID_INK,
          ),
        );
      }
      return {
        strokes,
        glyphs: [],
        box: { x: p[0], y: p[1], w: object.w, h: object.h },
        length: totalLength(strokes, []),
      };
    }
    case 'table': {
      const rowHeight = object.rowHeight ?? 40;
      const cols = Math.max(...object.rows.map((r) => r.length));
      const cw = object.w / cols;
      const h = object.rows.length * rowHeight;
      const strokes: Stroke[] = [];
      for (let c = 0; c <= cols; c++) {
        const x = p[0] + c * cw;
        strokes.push(
          ruledStroke([
            [x, p[1]],
            [x, p[1] + h],
          ]),
        );
      }
      for (let r = 0; r <= object.rows.length; r++) {
        const y = p[1] + r * rowHeight;
        strokes.push(
          ruledStroke([
            [p[0], y],
            [p[0] + object.w, y],
          ]),
        );
      }
      const glyphs: HandGlyph[] = [];
      if (ctx.font) {
        object.rows.forEach((row, r) => {
          row.forEach((cell, c) => {
            if (!cell) return;
            const origin: BoardPoint = [p[0] + c * cw + 8, p[1] + r * rowHeight + rowHeight * 0.16];
            glyphs.push(
              ...writeText(ctx.font as HandFont, cell, origin, {
                size: legible(cell, LABEL),
                maxWidth: cw - 16,
              }).glyphs,
            );
          });
        });
      }
      return {
        strokes,
        glyphs,
        size: LABEL,
        box: { x: p[0], y: p[1], w: object.w, h },
        length: totalLength(strokes, glyphs),
      };
    }
    case 'tex': {
      const size = legible(texPlainText(object.tex), sized(object.size, WRITE_SIZE));
      if (!ctx.font) {
        // No Caveat: Wobo still shows the EQUATION, with its powers and indices as real characters
        // (a² + b² = c²), never the TeX source Wobo would never say out loud.
        const plain = texPlainText(object.tex);
        const approx = plain.length * size * 0.4;
        return {
          strokes: [],
          glyphs: [],
          size,
          text: { lines: [plain], x: p[0], y: p[1], size, lineHeight: size * 1.3 },
          box: { x: p[0], y: p[1], w: approx, h: size * 1.4 },
          length: 0,
        };
      }
      const laid = layoutTex(ctx.font, object.tex, p, size);
      return {
        strokes: laid.rules,
        glyphs: laid.glyphs,
        size,
        box: { x: p[0], y: p[1], w: laid.width, h: laid.height },
        length: laid.length,
      };
    }
    case 'bond': {
      const to: BoardPoint = [p[0] + object.to[0], p[1] + object.to[1]];
      const dir = unit(p, to);
      const normal: BoardPoint = [-dir[1], dir[0]];
      const order = object.order ?? 1;
      const strokes: Stroke[] = [];
      if (object.wedge && object.wedge !== 'none') {
        const half = 7;
        const a: BoardPoint = [to[0] + normal[0] * half, to[1] + normal[1] * half];
        const b: BoardPoint = [to[0] - normal[0] * half, to[1] - normal[1] * half];
        if (object.wedge === 'up') strokes.push(fillStroke([p, a, b]));
        else {
          const rungs = 5;
          for (let i = 1; i <= rungs; i++) {
            const t = i / rungs;
            const w = half * t;
            const mx = p[0] + (to[0] - p[0]) * t;
            const my = p[1] + (to[1] - p[1]) * t;
            strokes.push(
              ruledStroke([
                [mx + normal[0] * w, my + normal[1] * w],
                [mx - normal[0] * w, my - normal[1] * w],
              ]),
            );
          }
        }
      } else {
        const gap = 5;
        const offsets = order === 1 ? [0] : order === 2 ? [-gap / 2, gap / 2] : [-gap, 0, gap];
        for (const o of offsets) {
          strokes.push(
            penStroke(
              [
                [p[0] + normal[0] * o, p[1] + normal[1] * o],
                [to[0] + normal[0] * o, to[1] + normal[1] * o],
              ],
              rng,
              { wobble: 0.7 },
            ),
          );
        }
      }
      return {
        strokes,
        glyphs: [],
        box: padBox(unionBox([pointBox(p), pointBox(to)]) ?? pointBox(p), 10),
        length: totalLength(strokes, []),
      };
    }
    case 'atom': {
      const size = sized(object.size, WRITE_SIZE);
      const glyphs: HandGlyph[] = [];
      let cursor: BoardPoint = [p[0], p[1] + size * 0.4];
      if (ctx.font) {
        for (const ch of object.symbol) {
          const { glyph, advance } = glyphAt(ctx.font, ch, size, cursor);
          if (glyph) glyphs.push(glyph);
          cursor = [cursor[0] + advance, cursor[1]];
        }
        if (object.charge) {
          const sign = object.charge > 0 ? '+' : '−';
          const n = Math.abs(object.charge);
          const superscript = n > 1 ? `${n}${sign}` : sign;
          let sx = cursor[0] + size * 0.04;
          for (const ch of superscript) {
            const { glyph, advance } = glyphAt(ctx.font, ch, size * 0.66, [
              sx,
              cursor[1] - size * 0.44,
            ]);
            if (glyph) glyphs.push(glyph);
            sx += advance;
          }
        }
      }
      const strokes: Stroke[] = [];
      const pairs = object.lonePairs ?? 0;
      for (let i = 0; i < pairs; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 2;
        const cx = p[0] + size * 0.3 + Math.cos(a) * size * 0.62;
        const cy = p[1] + size * 0.2 + Math.sin(a) * size * 0.62;
        for (const dx of [-3, 3]) {
          strokes.push(
            ruledStroke([
              [cx + dx, cy],
              [cx + dx + 0.5, cy],
            ]),
          );
        }
      }
      const bounds =
        unionBox([...glyphs.map((g) => g.box), pointBox(p), pointBox(cursor)]) ?? pointBox(p);
      return {
        strokes,
        glyphs,
        size,
        text: ctx.font
          ? undefined
          : { lines: [object.symbol], x: p[0], y: p[1], size, lineHeight: size * 1.2 },
        box: padBox(bounds, 6),
        length: totalLength(strokes, glyphs),
      };
    }
    case 'region': {
      const b: BoardRect = { x: p[0], y: p[1], w: object.w, h: object.h };
      const corners: BoardPoint[] = [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x + b.w, b.y + b.h],
        [b.x, b.y + b.h],
      ];
      const stroke = penStroke(corners, rng, { wobble: 0.8, closed: true, spacing: 40 });
      const glyphs: HandGlyph[] = [];
      if (object.title && ctx.font) {
        glyphs.push(
          ...writeText(ctx.font, object.title, [b.x + 12, b.y + 10], {
            size: legible(object.title, LABEL),
            maxWidth: b.w - 24,
          }).glyphs,
        );
      }
      return {
        strokes: [stroke],
        glyphs,
        size: LABEL,
        box: padBox(b, 6),
        length: totalLength([stroke], glyphs),
      };
    }
    case 'image': {
      const b: BoardRect = { x: p[0], y: p[1], w: object.w, h: object.h };
      return {
        strokes: [],
        glyphs: [],
        image: { href: object.href, alt: object.alt, box: b },
        box: b,
        length: 0,
      };
    }
    case 'slider': {
      const w = object.w ?? 200;
      const track: BoardPoint[] = [
        [p[0], p[1]],
        [p[0] + w, p[1]],
      ];
      const span = object.max - object.min;
      const frac = span > 0 ? (object.value - object.min) / span : 0;
      const knobX = p[0] + w * Math.max(0, Math.min(1, frac));
      const strokes: Stroke[] = [ruledStroke(track)];
      const knobPts: BoardPoint[] = [];
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        knobPts.push([knobX + Math.cos(a) * 11, p[1] + Math.sin(a) * 11]);
      }
      strokes.push(penStroke(knobPts, rng, { wobble: 0.6, anticipation: 0, overshoot: 0 }));
      const glyphs: HandGlyph[] = [];
      if (object.label && ctx.font) {
        glyphs.push(
          ...writeText(ctx.font, object.label, [p[0], p[1] - LABEL * 1.6], {
            size: legible(object.label, LABEL),
          }).glyphs,
        );
      }
      const b: BoardRect = {
        x: p[0] - 14,
        y: p[1] - LABEL * 1.8,
        w: w + 28,
        h: LABEL * 1.8 + 28,
      };
      return {
        strokes,
        glyphs,
        size: LABEL,
        control: {
          variable: object.variable,
          kind: 'slider',
          hit: { x: p[0] - 12, y: p[1] - 18, w: w + 24, h: 36 },
          knob: { x: knobX - 11, y: p[1] - 11, w: 22, h: 22 },
        },
        box: b,
        length: totalLength(strokes, glyphs),
      };
    }
    case 'toggle': {
      const w = 56;
      const h = 26;
      const b: BoardRect = { x: p[0], y: p[1], w, h };
      const corners: BoardPoint[] = [
        [b.x, b.y],
        [b.x + w, b.y],
        [b.x + w, b.y + h],
        [b.x, b.y + h],
      ];
      const strokes: Stroke[] = [
        penStroke(corners, rng, { wobble: 0.6, closed: true, spacing: 30 }),
      ];
      const knobX = object.value ? b.x + w * 0.72 : b.x + w * 0.28;
      const knobPts: BoardPoint[] = [];
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        knobPts.push([knobX + Math.cos(a) * 8, b.y + h / 2 + Math.sin(a) * 8]);
      }
      strokes.push(penStroke(knobPts, rng, { wobble: 0.5, anticipation: 0, overshoot: 0 }));
      const glyphs: HandGlyph[] = [];
      if (object.label && ctx.font) {
        glyphs.push(
          ...writeText(ctx.font, object.label, [b.x + w + 12, b.y], {
            size: legible(object.label, LABEL),
          }).glyphs,
        );
      }
      return {
        strokes,
        glyphs,
        size: LABEL,
        control: { variable: object.variable, kind: 'toggle', hit: padBox(b, 6) },
        box: padBox(unionBox([b, ...glyphs.map((g) => g.box)]) ?? b, 6),
        length: totalLength(strokes, glyphs),
      };
    }
    case 'input': {
      const w = object.w ?? 160;
      const rule: BoardPoint[] = [
        [p[0], p[1] + WRITE * 1.1],
        [p[0] + w, p[1] + WRITE * 1.1],
      ];
      const strokes: Stroke[] = [ruledStroke(rule)];
      const glyphs: HandGlyph[] = [];
      if (ctx.font) {
        if (object.label)
          glyphs.push(
            ...writeText(ctx.font, object.label, [p[0], p[1] - LABEL * 1.4], {
              size: legible(object.label, LABEL),
            }).glyphs,
          );
        if (object.value)
          glyphs.push(
            ...writeText(ctx.font, object.value, [p[0] + 6, p[1]], {
              size: WRITE,
              maxWidth: w - 12,
            }).glyphs,
          );
      }
      const b: BoardRect = {
        x: p[0],
        y: p[1] - LABEL * 1.6,
        w,
        h: WRITE * 1.4 + LABEL * 1.6,
      };
      return {
        strokes,
        glyphs,
        size: WRITE,
        control: {
          variable: object.variable,
          kind: 'input',
          hit: { x: p[0], y: p[1] - 4, w, h: WRITE * 1.3 },
        },
        box: b,
        length: totalLength(strokes, glyphs),
      };
    }
    default: {
      const handle: BoardPoint = [p[0] + object.value[0], p[1] + object.value[1]];
      const pts: BoardPoint[] = [];
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        pts.push([handle[0] + Math.cos(a) * 13, handle[1] + Math.sin(a) * 13]);
      }
      const strokes: Stroke[] = [
        penStroke(pts, rng, { wobble: 0.7, anticipation: 0, overshoot: 0 }),
      ];
      const glyphs: HandGlyph[] = [];
      if (object.label && ctx.font) {
        glyphs.push(
          ...writeText(ctx.font, object.label, [handle[0] + 18, handle[1] - LABEL * 0.6], {
            size: legible(object.label, LABEL),
          }).glyphs,
        );
      }
      const b: BoardRect = { x: handle[0] - 16, y: handle[1] - 16, w: 32, h: 32 };
      return {
        strokes,
        glyphs,
        size: LABEL,
        control: { variable: object.variable, kind: 'drag', hit: padBox(b, 6), knob: b },
        box: padBox(unionBox([b, ...glyphs.map((g) => g.box)]) ?? b, 6),
        length: totalLength(strokes, glyphs),
      };
    }
  }
}

/** The empty geometry, for an object whose anchor is gone but which must still be tracked. */
export const missingGeometry = (box: BoardRect): ObjectGeometry => empty(box);
