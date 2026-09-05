/**
 * The layout engine (docs/BOARD.md §7, WOBO-TASKS 5.4) — Wobo gives layout *hints*; this places the
 * objects so nothing collides.
 *
 * Two jobs. Labels: a written note beside a shape goes to the first side that is free, with a real
 * margin, never on top of the thing it names. Flow: a derivation written line by line fills the
 * board in reading order, and when the board fills, the camera follows instead of the ink piling up.
 *
 * All pure, all in board units.
 */

import { type BoardFrame, type BoardRect, boardHeight, boxesOverlap, unionBox } from './anchors';
import { type AnchorAt, BOARD_UNITS } from './schema';

/** The clear space a label keeps from what it names, in board units. */
export const LABEL_MARGIN = 10;
/** The clear space two placed objects keep from each other. */
export const OBJECT_GAP = 14;
/** The board's own breathing room — the screen breathes (DESIGN.md §2). */
export const BOARD_PADDING = 28;

/**
 * Kinds that are GROUND rather than ink, and so never push a written note out of the way.
 *
 * A plotted graph rules a `grid` across its whole drawing area before it draws anything. The
 * renderer puts every drawn box into `occupied`, so that grid — 700 units of it — was an obstacle,
 * and every note anchored inside the plot stepped down until it was clear of it, which meant down
 * and off the bottom of the board. The teaching harness measured a live "graph y = x^2 with the
 * tangent at x = 1" on 2026-09-05 and found the slope value at y = 1024 and the words "slope here"
 * at y = 1071, on a board 1000 units tall.
 *
 * A tutor writes ON graph paper. That is what graph paper is for.
 */
const GROUND_KINDS: ReadonlySet<string> = new Set(['grid']);

/** Does an object of this kind push a label out of the way? */
export function blocksLayout(kind: string): boolean {
  return !GROUND_KINDS.has(kind);
}

/**
 * A box pulled back onto the board horizontally. Applied BEFORE the collision search, never after.
 *
 * After is a trap, and it cost a real board: a timeline's last events sit near the right edge, so
 * clamping their labels afterwards slid them left into labels the search had already cleared —
 * "Cabinet Mission and Interim Government" landed on top of "Civil Disobedience Movement and Dandi
 * March" on the live run of 2026-09-05. Whatever moves a box has to move before the search, or the
 * search is answering a question about a position the box does not end up in.
 */
function withinBoard(box: BoardRect): BoardRect {
  return { ...box, x: Math.max(0, Math.min(box.x, BOARD_UNITS - box.w)) };
}

/**
 * The lowest a label's TOP may be placed and still leave the whole label on the board.
 *
 * Both placement loops below used to step down with no bound at all — 200 times in one, 60 in the
 * other — so a crowded board did not produce a tight fit, it produced a note nobody can read
 * because it is past the edge. Off the board is worse than beside something.
 */
function keepOnBoard(box: BoardRect): BoardRect {
  return { ...box, y: Math.max(0, Math.min(box.y, BOARD_UNITS - box.h)) };
}

export interface Size {
  w: number;
  h: number;
}

/** The whole board as a box, for a surface of this frame. */
export function boardArea(frame: BoardFrame): BoardRect {
  return { x: 0, y: 0, w: BOARD_UNITS, h: boardHeight(frame) };
}

function contains(area: BoardRect, box: BoardRect): boolean {
  return (
    box.x >= area.x &&
    box.y >= area.y &&
    box.x + box.w <= area.x + area.w &&
    box.y + box.h <= area.y + area.h
  );
}

function clashes(box: BoardRect, occupied: BoardRect[], gap: number): boolean {
  return occupied.some((o) => boxesOverlap(box, o, gap));
}

/** The candidate positions for a label around what it names, in the order a tutor would try them. */
function labelCandidates(anchor: BoardRect, size: Size, margin: number): BoardRect[] {
  const midY = anchor.y + anchor.h / 2 - size.h / 2;
  const midX = anchor.x + anchor.w / 2 - size.w / 2;
  return [
    { x: anchor.x + anchor.w + margin, y: midY, ...size },
    { x: midX, y: anchor.y - margin - size.h, ...size },
    { x: midX, y: anchor.y + anchor.h + margin, ...size },
    { x: anchor.x - margin - size.w, y: midY, ...size },
    { x: anchor.x + anchor.w + margin, y: anchor.y - margin - size.h, ...size },
    { x: anchor.x + anchor.w + margin, y: anchor.y + anchor.h + margin, ...size },
  ];
}

/**
 * Place a label beside what it names: the first side that is inside the board and clear of
 * everything already drawn. If every side is taken, it goes to the right and is pushed down until
 * it is clear — a tutor writing in the margin, never over the working.
 */
export function placeLabel(
  anchor: BoardRect,
  size: Size,
  occupied: BoardRect[] = [],
  area?: BoardRect,
  margin = LABEL_MARGIN,
): BoardRect {
  const bounds = area ?? { x: 0, y: 0, w: BOARD_UNITS, h: Number.POSITIVE_INFINITY };
  for (const candidate of labelCandidates(anchor, size, margin)) {
    if (contains(bounds, candidate) && !clashes(candidate, occupied, margin * 0.5))
      return candidate;
  }
  const fallback: BoardRect = {
    x: Math.min(anchor.x + anchor.w + margin, bounds.x + bounds.w - size.w),
    y: anchor.y,
    ...size,
  };
  let guard = 0;
  while (
    clashes(fallback, occupied, margin * 0.5) &&
    fallback.y + size.h + margin <= BOARD_UNITS &&
    guard++ < 200
  ) {
    fallback.y += size.h + margin;
  }
  return keepOnBoard(fallback);
}

/**
 * Place a label on the side the anchor NAMED, rather than on the first side that happens to be
 * free.
 *
 * `{object: "cell", at: "bottom"}` is not a hint — it is the tutor saying "write this under it".
 * BOARD.md §3 makes `at` part of the anchor, so a note asking for `bottom` and landing beside the
 * shape is the anchor being ignored. Under and over are left-aligned to the box (a caption reads
 * from the same margin as the thing it captions); beside is centred on it. If the named side is
 * occupied the note moves FURTHER along that side, never round to another one.
 */
export function placeLabelAt(
  anchor: BoardRect,
  size: Size,
  at: AnchorAt | undefined,
  occupied: BoardRect[] = [],
  margin = LABEL_MARGIN,
): BoardRect | null {
  if (at === undefined || at === 'center') return null;
  if (Array.isArray(at)) {
    // A fraction pair names a point on the box: the note hangs off it, top-left at that point.
    const [fx, fy] = at;
    return { x: anchor.x + anchor.w * fx, y: anchor.y + anchor.h * fy + margin, ...size };
  }
  const midY = anchor.y + anchor.h / 2 - size.h / 2;
  const right = anchor.x + anchor.w - size.w;
  const below = anchor.y + anchor.h + margin;
  const above = anchor.y - margin - size.h;
  const placed: Record<string, BoardRect> = {
    bottom: { x: anchor.x, y: below, ...size },
    bottomLeft: { x: anchor.x, y: below, ...size },
    bottomRight: { x: right, y: below, ...size },
    top: { x: anchor.x, y: above, ...size },
    topLeft: { x: anchor.x, y: above, ...size },
    topRight: { x: right, y: above, ...size },
    left: { x: anchor.x - margin - size.w, y: midY, ...size },
    right: { x: anchor.x + anchor.w + margin, y: midY, ...size },
  };
  const asked = placed[at];
  if (!asked) return null;
  // Horizontally first, so the collision search below answers a question about where this label
  // is actually going to sit.
  const box = withinBoard(asked);
  // Clear of anything already down, moving along the side it was asked for.
  const step = at.startsWith('top') ? -(size.h + margin) : size.h + margin;
  const out = { ...box };
  let guard = 0;
  while (clashes(out, occupied, margin * 0.5) && guard++ < 60) {
    const next = out.y + step;
    // Never off the board: a note past the edge is not a tighter fit, it is a note nobody reads.
    if (next < 0 || next + size.h > BOARD_UNITS) break;
    out.y = next;
  }
  return keepOnBoard(out);
}

/**
 * Nudge already-sized boxes apart, keeping their reading order. Each box moves down (never up, so
 * a derivation stays in the order it was written) until it clears everything placed before it.
 */
export function avoidCollisions(boxes: BoardRect[], gap = OBJECT_GAP): BoardRect[] {
  const placed: BoardRect[] = [];
  for (const box of boxes) {
    const next = { ...box };
    let guard = 0;
    while (clashes(next, placed, gap) && guard++ < 400) {
      const blocker = placed.find((o) => boxesOverlap(next, o, gap));
      if (!blocker) break;
      next.y = blocker.y + blocker.h + gap;
    }
    placed.push(next);
  }
  return placed;
}

/**
 * Lay a sequence of sized items out in reading order inside an area: left to right, wrapping to a
 * new row when the row is full. A derivation, a row of cards, a table of terms.
 */
export function flowRows(items: Size[], area: BoardRect, gap = OBJECT_GAP): BoardRect[] {
  const out: BoardRect[] = [];
  let x = area.x;
  let y = area.y;
  let rowHeight = 0;
  for (const item of items) {
    if (x > area.x && x + item.w > area.x + area.w) {
      x = area.x;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    out.push({ x, y, w: item.w, h: item.h });
    x += item.w + gap;
    rowHeight = Math.max(rowHeight, item.h);
  }
  return out;
}

/** The box every drawn thing fits inside — what the camera has to show. */
export function contentBounds(boxes: BoardRect[], padding = BOARD_PADDING): BoardRect | null {
  const union = unionBox(boxes.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y)));
  if (!union) return null;
  return {
    x: union.x - padding,
    y: union.y - padding,
    w: union.w + padding * 2,
    h: union.h + padding * 2,
  };
}

export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

export const RESTING_CAMERA: Camera = { zoom: 1, panX: 0, panY: 0 };

/**
 * How much of the surface the drawn objects should fill once the camera has settled, and the band
 * either side of it the fit is allowed to land in.
 *
 * BOARD.md §5 says the plane is where a derivation or a diagram from scratch goes; §11 says a
 * plane that hides the thing it explains kills it — and a plane that shows three objects at a
 * fifth of its own box is the same failure from the other end. The camera therefore FITS the ink,
 * with a real margin: it fills `CAMERA_FILL` of the limiting dimension, which leaves an eighth of
 * the box clear on each side, and the aspect ratio is untouched because the zoom is one number.
 */
export const CAMERA_FILL = 0.78;
export const CAMERA_FILL_MIN = 0.7;
export const CAMERA_FILL_MAX = 0.85;
/**
 * Never blow one small mark up past this. Four is where a single 25-unit written word still reads
 * as writing on a board rather than as a poster of itself, and it is high enough that three
 * ordinary objects reach the fill band instead of sitting at a fifth of the box.
 */
export const CAMERA_MAX_ZOOM = 4;
/** Never shrink the ink past this; beyond it the board scrolls instead. */
export const CAMERA_MIN_ZOOM = 0.35;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/**
 * The camera that shows `bounds` on this surface: the ink fitted to the box with margins, centred,
 * aspect kept. It zooms IN on a board with a little on it and OUT on one that has outgrown the
 * view, and because it is recomputed from the live content bounds every frame, the move from one
 * to the other is the animation — the camera follows the ink as it grows.
 */
export function fitCamera(
  bounds: BoardRect | null,
  frame: BoardFrame,
  opts?: { minZoom?: number; maxZoom?: number; fill?: number },
): Camera {
  if (!bounds) return RESTING_CAMERA;
  const viewH = boardHeight({ ...frame, zoom: 1 });
  const fill = clamp(opts?.fill ?? CAMERA_FILL, CAMERA_FILL_MIN, CAMERA_FILL_MAX);
  const minZoom = opts?.minZoom ?? CAMERA_MIN_ZOOM;
  const maxZoom = opts?.maxZoom ?? CAMERA_MAX_ZOOM;
  // One zoom for both axes: the aspect ratio of what Wobo drew is never squashed to fit.
  const needed = Math.min(
    (BOARD_UNITS * fill) / Math.max(bounds.w, 1),
    (viewH * fill) / Math.max(bounds.h, 1),
  );
  const zoom = clamp(needed, minZoom, maxZoom);
  const shownW = BOARD_UNITS / zoom;
  const shownH = viewH / zoom;
  // Centred on the ink, whether it is smaller than the view or larger than it.
  return {
    zoom,
    panX: bounds.x - (shownW - bounds.w) / 2,
    panY: bounds.y - (shownH - bounds.h) / 2,
  };
}

/** How much of the remaining distance the camera closes each frame — a glide, not a cut. */
export const CAMERA_EASE = 0.16;

/**
 * One frame of the camera's move toward the fit. Exponential, so it leaves fast and arrives slowly,
 * which is how a board's own view behaves when someone leans in.
 */
export function easeCamera(from: Camera, to: Camera, ease = CAMERA_EASE): Camera {
  const k = clamp(ease, 0, 1);
  return {
    zoom: from.zoom + (to.zoom - from.zoom) * k,
    panX: from.panX + (to.panX - from.panX) * k,
    panY: from.panY + (to.panY - from.panY) * k,
  };
}

/** True when the glide is close enough to stop asking for frames. */
export function cameraArrived(now: Camera, to: Camera): boolean {
  return (
    Math.abs(now.zoom - to.zoom) < 0.002 &&
    Math.abs(now.panX - to.panX) < 0.5 &&
    Math.abs(now.panY - to.panY) < 0.5
  );
}

/** The board-unit window this camera shows — what the fit is measured against. */
export function cameraBox(camera: Camera, frame: BoardFrame): BoardRect {
  const viewH = boardHeight({ ...frame, zoom: 1 });
  return {
    x: camera.panX,
    y: camera.panY,
    w: BOARD_UNITS / camera.zoom,
    h: viewH / camera.zoom,
  };
}

/** True when the ink has outgrown the resting view and the camera has to move. */
export function needsCamera(bounds: BoardRect | null, frame: BoardFrame): boolean {
  if (!bounds) return false;
  const viewH = boardHeight({ ...frame, zoom: 1 });
  return (
    bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.w > BOARD_UNITS || bounds.y + bounds.h > viewH
  );
}
