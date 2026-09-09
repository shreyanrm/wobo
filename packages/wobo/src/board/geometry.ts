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
  texPlainText,
  writeScripted,
  writeText,
} from './handwriting';
import { LABEL_MARGIN, placeLabel, placeLabelAt, placeNote } from './layout';
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

interface BuildContext extends AnchorContext {
  font: HandFont | null;
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
    lines: [text],
    lineHeight,
  };
}

/**
 * Where a written note goes when it hangs off something.
 *
 * When the anchor NAMED a side — `{object: "cell", at: "bottom"}` — that side is the answer: under
 * the box, left-aligned to it. Only an anchor that named nothing gets the search for the first
 * free side. Either way it keeps a real margin and never lands on the thing it names.
 */
function notePlacement(
  ctx: BuildContext,
  anchorBox: BoardRect,
  text: string,
  size: number,
  maxWidth?: number,
  at?: AnchorAt,
): BoardPoint {
  if (anchorBox.w === 0 && anchorBox.h === 0) return [anchorBox.x, anchorBox.y];
  const width = ctx.font
    ? Math.min(measureText(ctx.font, text, size), maxWidth ?? Number.POSITIVE_INFINITY)
    : text.length * size * 0.42;
  const box = { w: width, h: size * 1.22 };
  const asked = placeLabelAt(anchorBox, box, at, ctx.occupied ?? [], LABEL_MARGIN, ctx.area);
  if (asked) return [asked.x, asked.y];
  const placed = placeLabel(anchorBox, box, ctx.occupied ?? [], ctx.area, LABEL_MARGIN);
  return [placed.x, placed.y];
}

/** The size a written note takes, measured without placing it. */
function noteSize(ctx: BuildContext, text: string, size: number, maxWidth?: number) {
  const width = ctx.font
    ? Math.min(measureText(ctx.font, text, size), maxWidth ?? Number.POSITIVE_INFINITY)
    : text.length * size * 0.42;
  return { w: width, h: size * 1.22 };
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
  const rng = penRng(object.id, object.kind);
  const anchor = 'anchor' in object ? object.anchor : undefined;
  const box = anchor ? resolveAnchorBox(anchor, ctx) : { x: 0, y: 0, w: 1000, h: 1000 };
  if (anchor && !box) return null;
  const at = anchor && 'at' in anchor ? anchor.at : undefined;
  const anchorBox = box as BoardRect;
  const p = pointOn(anchorBox, at);

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
      const size = object.size ?? LABEL_SIZE;
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
        const origin = notePlacement(ctx, labelBox, object.label, LABEL_SIZE);
        const w = written(ctx, object.label, origin, LABEL_SIZE);
        glyphs = w.glyphs;
        boxes = [...boxes, w.box];
        text = {
          lines: w.lines,
          x: origin[0],
          y: origin[1],
          size: LABEL_SIZE,
          lineHeight: w.lineHeight,
        };
      }
      return {
        strokes,
        glyphs,
        ...(text ? { text, size: LABEL_SIZE } : {}),
        box: unionBox(boxes) ?? b,
        length: totalLength(strokes, glyphs),
      };
    }
    case 'number': {
      const label = formatQuantity(object.value, object.precision, object.unit);
      const full = object.label ? `${object.label} ${label}` : label;
      const origin = notePlacement(ctx, anchorBox, full, WRITE_SIZE, undefined, at);
      const w = written(ctx, full, origin, WRITE_SIZE);
      return {
        strokes: w.strokes,
        glyphs: w.glyphs,
        size: WRITE_SIZE,
        text: {
          lines: w.lines,
          x: origin[0],
          y: origin[1],
          size: WRITE_SIZE,
          lineHeight: w.lineHeight,
        },
        box: w.box,
        length: totalLength(w.strokes, w.glyphs),
      };
    }
    case 'write': {
      const size = object.size ?? WRITE_SIZE;
      const origin = notePlacement(ctx, anchorBox, object.text, size, object.maxWidth, at);
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
    case 'label': {
      const size = object.size ?? LABEL_SIZE;
      const origin = notePlacement(ctx, anchorBox, object.text, size, undefined, at);
      const w = written(ctx, object.text, origin, size);
      return {
        strokes: w.strokes,
        glyphs: w.glyphs,
        size,
        text: { lines: w.lines, x: origin[0], y: origin[1], size, lineHeight: w.lineHeight },
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
        let written = writeText(ctx.font, object.label, beside, { size: LABEL_SIZE });
        // How far the GLYPHS actually reach, plus the pad this box reports, minus the board. An
        // estimated width is not good enough here: it is the measured ink that either fits or does
        // not, and a label two units over the edge is still a label over the edge.
        const inked = unionBox(written.glyphs.map((g) => g.box));
        const over = inked ? inked.x + inked.w + AXIS_BOX_PAD - BOARD_UNITS : 0;
        if (over > 0) {
          written = writeText(
            ctx.font,
            object.label,
            [Math.max(0, beside[0] - over), end[1] + LABEL_SIZE + 10],
            { size: LABEL_SIZE },
          );
        }
        glyphs.push(...written.glyphs);
      }
      const bounds =
        unionBox([pointBox(p), pointBox(end), ...glyphs.map((g) => g.box)]) ?? pointBox(p);
      return {
        strokes,
        glyphs,
        size: LABEL_SIZE,
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
                size: LABEL_SIZE,
                maxWidth: cw - 16,
              }).glyphs,
            );
          });
        });
      }
      return {
        strokes,
        glyphs,
        size: LABEL_SIZE,
        box: { x: p[0], y: p[1], w: object.w, h },
        length: totalLength(strokes, glyphs),
      };
    }
    case 'tex': {
      const size = object.size ?? WRITE_SIZE;
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
      const size = object.size ?? WRITE_SIZE;
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
            size: LABEL_SIZE,
            maxWidth: b.w - 24,
          }).glyphs,
        );
      }
      return {
        strokes: [stroke],
        glyphs,
        size: LABEL_SIZE,
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
          ...writeText(ctx.font, object.label, [p[0], p[1] - LABEL_SIZE * 1.6], {
            size: LABEL_SIZE,
          }).glyphs,
        );
      }
      const b: BoardRect = {
        x: p[0] - 14,
        y: p[1] - LABEL_SIZE * 1.8,
        w: w + 28,
        h: LABEL_SIZE * 1.8 + 28,
      };
      return {
        strokes,
        glyphs,
        size: LABEL_SIZE,
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
          ...writeText(ctx.font, object.label, [b.x + w + 12, b.y], { size: LABEL_SIZE }).glyphs,
        );
      }
      return {
        strokes,
        glyphs,
        size: LABEL_SIZE,
        control: { variable: object.variable, kind: 'toggle', hit: padBox(b, 6) },
        box: padBox(unionBox([b, ...glyphs.map((g) => g.box)]) ?? b, 6),
        length: totalLength(strokes, glyphs),
      };
    }
    case 'input': {
      const w = object.w ?? 160;
      const rule: BoardPoint[] = [
        [p[0], p[1] + WRITE_SIZE * 1.1],
        [p[0] + w, p[1] + WRITE_SIZE * 1.1],
      ];
      const strokes: Stroke[] = [ruledStroke(rule)];
      const glyphs: HandGlyph[] = [];
      if (ctx.font) {
        if (object.label)
          glyphs.push(
            ...writeText(ctx.font, object.label, [p[0], p[1] - LABEL_SIZE * 1.4], {
              size: LABEL_SIZE,
            }).glyphs,
          );
        if (object.value)
          glyphs.push(
            ...writeText(ctx.font, object.value, [p[0] + 6, p[1]], {
              size: WRITE_SIZE,
              maxWidth: w - 12,
            }).glyphs,
          );
      }
      const b: BoardRect = {
        x: p[0],
        y: p[1] - LABEL_SIZE * 1.6,
        w,
        h: WRITE_SIZE * 1.4 + LABEL_SIZE * 1.6,
      };
      return {
        strokes,
        glyphs,
        size: WRITE_SIZE,
        control: {
          variable: object.variable,
          kind: 'input',
          hit: { x: p[0], y: p[1] - 4, w, h: WRITE_SIZE * 1.3 },
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
          ...writeText(ctx.font, object.label, [handle[0] + 18, handle[1] - LABEL_SIZE * 0.6], {
            size: LABEL_SIZE,
          }).glyphs,
        );
      }
      const b: BoardRect = { x: handle[0] - 16, y: handle[1] - 16, w: 32, h: 32 };
      return {
        strokes,
        glyphs,
        size: LABEL_SIZE,
        control: { variable: object.variable, kind: 'drag', hit: padBox(b, 6), knob: b },
        box: padBox(unionBox([b, ...glyphs.map((g) => g.box)]) ?? b, 6),
        length: totalLength(strokes, glyphs),
      };
    }
  }
}

/** The empty geometry, for an object whose anchor is gone but which must still be tracked. */
export const missingGeometry = (box: BoardRect): ObjectGeometry => empty(box);
