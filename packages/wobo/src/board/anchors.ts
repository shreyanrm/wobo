/**
 * Anchors (docs/BOARD.md §3) — the law that nothing is placed by pixels, made mechanical.
 *
 * Every mark resolves through one of four anchors: a registry target, another board object, a
 * region the learner circled, or board space. Everything here is pure: rects in, board-unit
 * geometry out, so the renderer can re-resolve on scroll, resize, theme change and layout shift
 * without a DOM of its own and the whole thing is testable without a browser.
 *
 * One coordinate system rules: board units, a 1000-unit logical width. The frame maps board units
 * to the SVG's own viewport, and a target's viewport rect maps back into board units through the
 * same frame — so a mark on a button and a mark on the plane speak the same language.
 */

import { type Anchor, type AnchorAt, BOARD_UNITS, type BoardPoint } from './schema';

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An axis-aligned box in board units. */
export interface BoardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The mapping between board units and the surface the SVG covers.
 *
 * `left/top/width/height` is the SVG element's own rect in viewport px (what
 * `getBoundingClientRect` returns). `zoom` and `pan` are the board's own camera, used by the plane
 * and the full board when the ink outgrows the view.
 */
export interface BoardFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  /**
   * Viewport px per board unit at zoom 1. Unset, the surface is a BOARD: 1000 units across its own
   * width, whatever that width is (the plane, the full board). Set to 1, the surface is the GLASS:
   * one unit is one CSS px, so a 9 px pad is 9 px at 390 and at 1440 and a note is 22 px tall on
   * every phone (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace: one pen, CSS px, from the real box).
   */
  scale?: number;
}

/** A frame for a surface of the given viewport rect, with an optional camera. */
export function frameOf(
  rect: RectLike,
  camera?: { zoom?: number; panX?: number; panY?: number; scale?: number },
): BoardFrame {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    zoom: camera?.zoom ?? 1,
    panX: camera?.panX ?? 0,
    panY: camera?.panY ?? 0,
    ...(camera?.scale !== undefined ? { scale: camera.scale } : {}),
  };
}

/** Viewport px per board unit. A zero-width surface degrades to 1 rather than dividing by zero. */
export function pxPerUnit(frame: BoardFrame): number {
  const base =
    frame.scale !== undefined && frame.scale > 0
      ? frame.scale
      : frame.width > 0
        ? frame.width / BOARD_UNITS
        : 1;
  return base * (frame.zoom > 0 ? frame.zoom : 1);
}

/** How many units wide a surface is at zoom 1: 1000 for a board, its own px for the glass. */
export function unitsWide(frame: BoardFrame): number {
  return frame.width / pxPerUnit({ ...frame, zoom: 1 });
}

/** How many units tall a surface is at zoom 1. */
export function unitsHigh(frame: BoardFrame): number {
  return frame.height / pxPerUnit({ ...frame, zoom: 1 });
}

/** The board-unit height a surface can show — 1000 wide, this tall. */
export function boardHeight(frame: BoardFrame): number {
  return frame.height / pxPerUnit(frame);
}

/** The board-unit box currently visible (the camera's window). */
export function visibleBox(frame: BoardFrame): BoardRect {
  return {
    x: frame.panX,
    y: frame.panY,
    w: frame.width / pxPerUnit(frame),
    h: boardHeight(frame),
  };
}

/**
 * True when a target's viewport rect lies wholly outside the surface's own rect: the thing the
 * mark is about has left the glass. The mark then fades; it never floats and it is never dropped
 * on the frame the rect went (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 */
export function offGlass(
  rect: RectLike,
  frame: Pick<BoardFrame, 'left' | 'top' | 'width' | 'height'>,
): boolean {
  if (frame.width <= 0 || frame.height <= 0) return false;
  return (
    rect.x + rect.width <= frame.left ||
    rect.x >= frame.left + frame.width ||
    rect.y + rect.height <= frame.top ||
    rect.y >= frame.top + frame.height
  );
}

/** Viewport px → board units. */
export function viewportToBoard(frame: BoardFrame, x: number, y: number): BoardPoint {
  const k = pxPerUnit(frame);
  return [(x - frame.left) / k + frame.panX, (y - frame.top) / k + frame.panY];
}

/** Board units → viewport px. */
export function boardToViewport(frame: BoardFrame, x: number, y: number): BoardPoint {
  const k = pxPerUnit(frame);
  return [(x - frame.panX) * k + frame.left, (y - frame.panY) * k + frame.top];
}

/** A viewport rect (a registered target, a focus region) expressed in board units. */
export function rectToBoard(frame: BoardFrame, rect: RectLike): BoardRect {
  const k = pxPerUnit(frame);
  return {
    x: (rect.x - frame.left) / k + frame.panX,
    y: (rect.y - frame.top) / k + frame.panY,
    w: rect.width / k,
    h: rect.height / k,
  };
}

/** A board rect back in viewport px — used by the plane to keep its ink over the thing beneath. */
export function boardToRect(frame: BoardFrame, box: BoardRect): RectLike {
  const k = pxPerUnit(frame);
  return {
    x: (box.x - frame.panX) * k + frame.left,
    y: (box.y - frame.panY) * k + frame.top,
    width: box.w * k,
    height: box.h * k,
  };
}

// --- Points on a rect ------------------------------------------------------------------------------

const NAMED: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0],
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomLeft: [0, 1],
  bottomRight: [1, 1],
};

/** The point named by `at` on a box. Unnamed = its centre. */
export function pointOn(box: BoardRect, at?: AnchorAt): BoardPoint {
  const pair = Array.isArray(at) ? at : NAMED[at ?? 'center'];
  const [fx, fy] = pair ?? [0.5, 0.5];
  return [box.x + box.w * fx, box.y + box.h * fy];
}

/** Grow a box on every side. */
export function padBox(box: BoardRect, pad: number): BoardRect {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

/** A zero-size box at a point — what a board anchor resolves to before a shape gives it size. */
export function pointBox(p: BoardPoint): BoardRect {
  return { x: p[0], y: p[1], w: 0, h: 0 };
}

export function boxesOverlap(a: BoardRect, b: BoardRect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

export function unionBox(boxes: BoardRect[]): BoardRect | null {
  let out: BoardRect | null = null;
  for (const b of boxes) {
    if (!out) {
      out = { ...b };
      continue;
    }
    const x = Math.min(out.x, b.x);
    const y = Math.min(out.y, b.y);
    const right = Math.max(out.x + out.w, b.x + b.w);
    const bottom = Math.max(out.y + out.h, b.y + b.h);
    out = { x, y, w: right - x, h: bottom - y };
  }
  return out;
}

// --- Resolution ------------------------------------------------------------------------------------

/**
 * What the hand needs to turn an anchor into geometry. Every lookup returns a *viewport* rect
 * except `objectBox`, which is already in board units (an object's own resolved box).
 */
export interface AnchorContext {
  frame: BoardFrame;
  /** A registered surface target's live rect, in viewport px. */
  targetRect: (id: string) => RectLike | null;
  /** A learner focus region's rect, in viewport px. */
  focusRect: (id: string) => RectLike | null;
  /** An already-resolved board object's box, in board units. */
  objectBox: (id: string) => BoardRect | null;
}

/**
 * Resolve an anchor to a box in board units, or null when the thing it anchors to is gone —
 * a mark whose target disappears fades out; it never floats.
 */
export function resolveAnchorBox(anchor: Anchor, ctx: AnchorContext): BoardRect | null {
  const nudge = (box: BoardRect): BoardRect => {
    const off = 'offset' in anchor ? anchor.offset : undefined;
    if (!off) return box;
    return { ...box, x: box.x + off[0], y: box.y + off[1] };
  };
  if ('board' in anchor) return finite(nudge(pointBox(anchor.board)));
  if ('target' in anchor) {
    const rect = ctx.targetRect(anchor.target);
    return rect ? finite(nudge(rectToBoard(ctx.frame, rect))) : null;
  }
  if ('focus' in anchor) {
    const rect = ctx.focusRect(anchor.focus);
    return rect ? finite(nudge(rectToBoard(ctx.frame, rect))) : null;
  }
  const box = ctx.objectBox(anchor.object);
  return box ? finite(nudge(box)) : null;
}

/**
 * A box is a box only if all four numbers are real.
 *
 * A rect that arrives half-built — a `DOMRect` that was spread rather than read, a measurement
 * taken of an element that is not laid out — turns every coordinate downstream into `NaN`, and the
 * hand draws `M NaN NaN`: a mark that is in the DOM, is counted, and is invisible. BOARD.md §3 has
 * one answer for a thing that cannot be located, and this is it: there is no box, so the mark fades
 * rather than floating.
 */
function finite(box: BoardRect): BoardRect | null {
  return Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h)
    ? box
    : null;
}

/** Resolve an anchor to the single point the mark hangs from. */
export function resolveAnchorPoint(anchor: Anchor, ctx: AnchorContext): BoardPoint | null {
  const box = resolveAnchorBox(anchor, ctx);
  if (!box) return null;
  const at = 'at' in anchor ? anchor.at : undefined;
  return pointOn(box, at);
}

/**
 * A stable signature of everything an object's geometry depends on in the layout. When this string
 * is unchanged, the cached path is still correct and the frame can be skipped entirely — this is
 * what keeps 2,000 strokes at 60 fps.
 */
export function anchorSignature(box: BoardRect | null): string {
  if (!box) return 'gone';
  const r = (n: number) => Math.round(n * 4) / 4;
  return `${r(box.x)},${r(box.y)},${r(box.w)},${r(box.h)}`;
}

/** True when a mark is anchored to something that lives in the page rather than on the board. */
export function isScreenAnchored(anchor: Anchor | undefined): boolean {
  return Boolean(anchor && ('target' in anchor || 'focus' in anchor));
}
