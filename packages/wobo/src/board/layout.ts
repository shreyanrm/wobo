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

import {
  type BoardFrame,
  type BoardRect,
  boardHeight,
  boxesOverlap,
  unionBox,
  unitsHigh,
  unitsWide,
} from './anchors';
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
function withinBoard(box: BoardRect, area?: BoardRect): BoardRect {
  const left = area?.x ?? 0;
  const right = area ? area.x + area.w : BOARD_UNITS;
  return { ...box, x: Math.max(left, Math.min(box.x, right - box.w)) };
}

/**
 * The lowest a label's TOP may be placed and still leave the whole label on the board.
 *
 * Both placement loops below used to step down with no bound at all — 200 times in one, 60 in the
 * other — so a crowded board did not produce a tight fit, it produced a note nobody can read
 * because it is past the edge. Off the board is worse than beside something.
 */
function keepOnBoard(box: BoardRect, area?: BoardRect): BoardRect {
  const top = area?.y ?? 0;
  const bottom = area && Number.isFinite(area.h) ? area.y + area.h : BOARD_UNITS;
  return { ...box, y: Math.max(top, Math.min(box.y, bottom - box.h)) };
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
  const floor = Number.isFinite(bounds.h) ? bounds.y + bounds.h : BOARD_UNITS;
  let guard = 0;
  while (
    clashes(fallback, occupied, margin * 0.5) &&
    fallback.y + size.h + margin <= floor &&
    guard++ < 200
  ) {
    fallback.y += size.h + margin;
  }
  return keepOnBoard(fallback, area);
}

/**
 * Where a NOTE goes: in the margin beside the thing it is about, never on the page's own text,
 * and never more than `reach` px from its subject (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 *
 * The scorecard's "start here" landed 87 to 196 px from its row, over other rows and once in the
 * footer, because a label's search only dodged DRAWN boxes and could walk down the page until it
 * found air. A note on the glass has the glass map's text lines in `occupied` too, and its search
 * is bounded: right of the subject on its own line, then left, then under it, then over it, each
 * at `gap`; the first that fits the glass and clears everything wins. If nothing clears, the side
 * with the least overlap is taken, still within reach, rather than a note nobody can pair with
 * its subject.
 */
export function placeNote(
  subject: BoardRect,
  size: Size,
  occupied: BoardRect[],
  frame: BoardFrame,
  gap = NOTE_GAP,
  reach = NOTE_REACH,
): BoardRect {
  const area: BoardRect = {
    x: frame.panX,
    y: frame.panY,
    w: unitsWide(frame),
    h: unitsHigh(frame),
  };
  const near = Math.min(gap, reach);
  const midY = subject.y + subject.h / 2 - size.h / 2;
  const candidates: BoardRect[] = [
    { x: subject.x + subject.w + near, y: midY, ...size },
    { x: subject.x - near - size.w, y: midY, ...size },
    { x: subject.x, y: subject.y + subject.h + near, ...size },
    { x: subject.x, y: subject.y - near - size.h, ...size },
    { x: subject.x + subject.w + near, y: subject.y - near - size.h, ...size },
    { x: subject.x + subject.w + near, y: subject.y + subject.h + near, ...size },
  ];
  const onGlass = candidates.filter((c) => contains(area, c));
  for (const c of onGlass) if (!clashes(c, occupied, 2)) return c;
  // Nothing is clear. A note slid along its side within reach may still find air.
  for (const c of onGlass) {
    for (const dy of [size.h + near, -(size.h + near)]) {
      const slid = { ...c, y: c.y + dy };
      if (
        contains(area, slid) &&
        gapBetween(slid, subject) <= reach &&
        !clashes(slid, occupied, 2)
      ) {
        return slid;
      }
    }
  }
  // Take the least crowded spot rather than leaving the page.
  const pool = onGlass.length > 0 ? onGlass : candidates.map((c) => clampInto(c, area));
  let best = pool[0] as BoardRect;
  let least = Number.POSITIVE_INFINITY;
  for (const c of pool) {
    const crowd = occupied.reduce((sum, o) => sum + overlapArea(c, o), 0);
    if (crowd < least) {
      least = crowd;
      best = c;
    }
  }
  return best;
}

/** The clear air between a note and its subject, in units. */
export const NOTE_GAP = 8;
/** The farthest a note may sit from what it is about, in units (px on the glass). */
export const NOTE_REACH = 24;

/**
 * THE NIB HAS WIDTH, AND IT IS THE SAME WIDTH AT EVERY ZOOM (renderer `NIB_PX`).
 *
 * Every solver in this file reasons about boxes. The browser paints paths, with a three-pixel
 * non-scaling stroke, so every painted edge stands half a nib proud of the geometry it traces —
 * on both sides of both marks. Two boxes that merely touch therefore paint a three-pixel overlap,
 * which is how the wave 57 solver, whose last rung was "boxes may touch", printed 'magnification
 * -1.00' through 'image' with 53 px² of shared glyph and left 'apex' 2.4 px from 'up-speed is
 * zero here' — one word, as far as a learner is concerned.
 *
 * So the nib is part of the arithmetic, not a rendering detail downstream of it.
 */
export const INK_NIB_PX = 3;

/**
 * THE THIRD LAW IN THE CRAFT SENTENCE: the clear air between one written mark and the next, in px
 * on the glass (the adversary, wave 58).
 *
 * INK-FOUR asks for three things of a written mark in one breath — "labels at least 12 px on the
 * glass, ... within 24 px of its subject and never over the text it explains" — and the third is
 * the one nobody was counting, so it is the one a solver under pressure spends. It has to be a
 * number here for the same reason the other two are: a law that is not measured is a law that is
 * traded.
 *
 * WHY SIX. It is twice the nib and half the type floor, and it is the width at which two marks
 * stop being one. The space INSIDE a line of this hand measures three to four pixels at the
 * twelve-pixel floor, which is exactly why 'apex' at 2.4 px from the next note read as
 * 'apexup-speed is zero here'; air between two marks has to be plainly wider than the air between
 * two words of one mark, and six is. It is also the floor the boards that read well already keep:
 * the tightest pair on wave 57's frames measured 9 px box to box, which is 6 px of painted ink.
 */
export const MARK_AIR_PX = 6;

/**
 * WHAT THE SOLVER AIMS AT, against a law of `NOTE_REACH` — the sibling of `TYPE_FLOOR_PX`.
 *
 * The solver works in board units and converts with `glassScale`, which is settled against the ink
 * a moment before the ink is finally laid; the camera then re-fits what the solver's own tightening
 * produced, at its own fill, and the browser then paints paths with a nib that has width. Three
 * separate rulers, all agreeing to within a few pixels and none of them exactly.
 *
 * SIX, MEASURED ON THE RUNNING APP AND NOT GUESSED. Across the sixteen from-scratch boards at 390
 * and 1440, in light, dark and reduced motion, marks the solver had placed at or under its own aim
 * came back off the glass up to 3.8 px further out — `inkBoxOf` reads a quadratic's control point
 * as ink, the live camera fills 0.78 where the settle measured 0.85, and a painted path is half a
 * nib wider on each side than the path it traces. Six pixels covers that spread with room, and the
 * cost of the headroom is a slightly tighter hand, which is the right way to be wrong.
 */
export const REACH_AIM = NOTE_REACH - 6;

function gapBetween(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function overlapArea(a: BoardRect, b: BoardRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampInto(box: BoardRect, area: BoardRect): BoardRect {
  return {
    ...box,
    x: Math.max(area.x, Math.min(box.x, area.x + area.w - box.w)),
    y: Math.max(area.y, Math.min(box.y, area.y + area.h - box.h)),
  };
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
  area?: BoardRect,
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
  const box = withinBoard(asked, area);
  // Clear of anything already down, moving along the side it was asked for.
  const step = at.startsWith('top') ? -(size.h + margin) : size.h + margin;
  const out = { ...box };
  const top = area?.y ?? 0;
  const bottom = area && Number.isFinite(area.h) ? area.y + area.h : BOARD_UNITS;
  let guard = 0;
  while (clashes(out, occupied, margin * 0.5) && guard++ < 60) {
    const next = out.y + step;
    // Never off the board: a note past the edge is not a tighter fit, it is a note nobody reads.
    if (next < top || next + size.h > bottom) break;
    out.y = next;
  }
  return keepOnBoard(out, area);
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

/**
 * THE FIT IS MEASURED AGAINST THE INK (the adversary, wave 47, finding 4).
 *
 * The law above is stated of the drawing: the ink fills `CAMERA_FILL` of the limiting dimension.
 * The board measured it against `contentBounds` WITH its 28-unit layout padding on the settled
 * half, so the margin was charged twice and the camera stopped short of its own law. At 1440 the
 * Pythagoras ink (198 x 240 units) filled 27.9% of the visible width and 59.5% of its height, and
 * landed as 138 x 168 px on a 1440 screen; every 1440 board measured the same way.
 *
 * The two halves come in separately because the settled half is memoised across frames — a board
 * of two thousand strokes is not re-measured sixty times a second — but they are ONE box to the
 * camera, and it is the raw box, unpadded. The margin the fill already leaves is the margin.
 */
export function autoCameraTarget(
  settled: readonly BoardRect[],
  floating: readonly BoardRect[],
  frame: BoardFrame,
  opts?: { minZoom?: number; maxZoom?: number; fill?: number },
): Camera {
  return fitCamera(contentBounds([...settled, ...floating], 0), frame, opts);
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

// --- The joint solver: a written mark's SIZE and its POSITION, decided together -----------------

/**
 * ONE SOLVER, TWO LAWS (the adversary, wave 57, finding 2; INK-FOUR craft).
 *
 * The craft lens asks for two things of a written mark and they are not independent: "labels at
 * least 12 px on the glass", and "a note in the margin within 24 px of its subject". Wave 51
 * closed the first by growing the type. Growing the type is what broke the second — `geometry.ts`
 * picked a size, `placeLabel` then went looking for somewhere a box that large would fit, and
 * settled for far away. Measured on the sixteen from-scratch boards: 29 of the 60 marks that hang
 * off something landed past 24 px, worst 'Chauri Chaura, called off' at 111 px from its own tick.
 *
 * A person laying out a diagram does not do this in two steps. They look at the room beside the
 * thing and choose a size that fits there — wrapping a long note onto two lines, writing a little
 * smaller, tucking the words inside the shape's own region — and only when none of that works do
 * they go to the margin and draw a leader. So:
 *
 *  1. The legible SIZES and the legible MEASURES are candidates, not a decision already taken.
 *     The bottom of the size band is the LAW — the size at which this phrase's own tallest glyph
 *     measures twelve pixels on this board (`geometry.ts`, `typeFloorFor`) — so the size law is
 *     kept by construction and never traded away. The measures are fractions of the phrase's own
 *     natural width, so every phrase has a narrow, wrapped form to fall back on.
 *  2. The POSITIONS are the side the pipeline asked for, then the eight around the subject at two
 *     margins, then a fine ring round its outline, then inside the subject's own region where the
 *     words fit there, then a bounded sweep along each side — and every one of them is generated
 *     INSIDE the reach, so the reach is a constraint on the search rather than a check after it.
 *  3. A LARGER size close beats a larger size far: sizes are tried largest first, and the first
 *     size that has ANY within-reach answer wins. Prefer a smaller legible size near the subject
 *     over a larger one that has drifted.
 *  4. The AIR between one mark and the next is the one thing that gives before distance does, and
 *     it gives in three steps, never past nought.
 *  5. There is no unbounded walk. `placeLabel` stepped down 200 times and `placeLabelAt` 60; both
 *     could end anywhere. When nothing at all fits inside the reach, the solver takes the NEAREST
 *     clear spot and says so — `withinReach: false` — instead of quietly walking away.
 */
export interface WrittenFit {
  /** Where the mark goes, at the size and measure that let it go there. */
  box: BoardRect;
  size: number;
  maxWidth: number;
  /** Clear air between the mark and its subject, in board units. */
  gap: number;
  /** True when the mark honours the reach law at the size it was written. */
  withinReach: boolean;
  /** True when the mark sits inside the subject's own region rather than beside it. */
  inside: boolean;
}

export interface WrittenSolve {
  /** What the mark names — the box the reach law is measured to. */
  subject: BoardRect;
  /** The side the pipeline asked for, when it named one. */
  at?: Exclude<AnchorAt, readonly number[]> | undefined;
  /**
   * WHERE THE PIPELINE NUDGED THE MARK TO, when it asked for an `offset`.
   *
   * An offset is a nudge, and the solver honours it FIRST — but it is not a relocation. The
   * timeline pipeline shifts its last event 260 units left of the tick it belongs to, to keep the
   * words on the board; that is the pipeline doing placement, badly, because the drift this solver
   * exists to stop used to be the only other outcome. So the nudge biases the search and the
   * SUBJECT still decides the law: a nudge that puts a mark out of reach of what it names loses.
   */
  nudge?: readonly [number, number] | undefined;
  /** The real wrap: the box this text takes at a size, held to a measure. */
  measure: (size: number, maxWidth: number) => Size;
  /** Type sizes to try, LARGEST FIRST. The last is the legible floor. */
  sizes: readonly number[];
  /** The widest a line may be — the pipeline's measure, or the surface's. */
  maxWidth: number;
  occupied: readonly BoardRect[];
  /**
   * THE SUBJECT'S OWN BOX, AS IT SITS IN `occupied` — so the solver can take it out.
   *
   * Being beside the thing you name is the whole point, and `occupied` holds the thing you name.
   * Counting it as crowd meant every hugged candidate clashed with its own subject and the search
   * fell through to the escape hatch: measured, it is why 'greatest height' could not sit next to
   * the apex at any size. The candidates are generated outside the subject anyway (or knowingly
   * inside it), so the subject never needs to be dodged twice.
   */
  subjectBox?: BoardRect;
  /**
   * WHAT THE REACH IS MEASURED TO, when that is not the same box the candidates are built around.
   *
   * A subject's layout box is what it RESERVES; its ink is what it PAINTS, and half the grammar
   * pads the first on purpose (`geometry.ts`, `inkBoxOf`). The law is about the ink — so the
   * candidates still keep their margin from the reservation, and the distance that decides whether
   * a candidate is legal is the distance to the drawing.
   */
  reachTo?: BoardRect;
  area?: BoardRect;
  margin: number;
  /** The reach law in board units — 24 px, converted by the board's own scale. */
  reach: number;
  /** May the words sit inside the subject's own region? False for a mark on a thin leader. */
  allowInside?: boolean;
}

/** The clear air between two boxes, in units. */
export function boxGap(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** How tightly a tutor writes when the ordinary margin will not do. */
const HUG_MARGIN = 4;

/**
 * The positions a tutor would try for a box of this size beside this subject, in the order they
 * would try them, and NONE of them further than `reach`.
 *
 * AROUND THE RESERVATION, MEASURED TO THE INK. The box a mark reports is padded on purpose — an
 * arrow keeps `ARROW_GAP` clear of what it points at, a ring six units past its loop — and a note
 * written inside that padding is a note written on the arrowhead. Tried the other way (candidates
 * built around the ink), the projectile's 'greatest height' landed on the ground axis, because the
 * padding is also what keeps the next mark off a long thin rule. So the ring keeps its distance
 * from what is RESERVED, and the law is measured to what is DRAWN (`WrittenSolve.reachTo`).
 *
 * The side the anchor named comes first — `{object: "cell", at: "bottom"}` is the tutor saying
 * "write this under it", not a hint. Then the eight around it at the ordinary margin, then the
 * same eight hugged in close, then inside the subject where the words fit inside it, then a
 * bounded slide along each side. The slide is what `placeLabel`'s unbounded walk was reaching
 * for; here it takes at most two steps and every step is still inside the reach.
 */
function writtenCandidates(
  subject: BoardRect,
  size: Size,
  margin: number,
  reach: number,
  at: WrittenSolve['at'],
  allowInside: boolean,
  nudge: WrittenSolve['nudge'],
  reachTo: BoardRect,
): BoardRect[] {
  const out: BoardRect[] = [];
  const seen = new Set<string>();
  const push = (box: BoardRect) => {
    const key = `${Math.round(box.x * 4)},${Math.round(box.y * 4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(box);
  };
  const around = (m: number): Record<string, BoardRect> => {
    const midY = subject.y + subject.h / 2 - size.h / 2;
    const midX = subject.x + subject.w / 2 - size.w / 2;
    const right = subject.x + subject.w + m;
    const left = subject.x - m - size.w;
    const below = subject.y + subject.h + m;
    const above = subject.y - m - size.h;
    // Under and over are aligned to the subject's own margin; beside is centred on it — a caption
    // reads from the same edge as the thing it captions.
    return {
      right: { x: right, y: midY, ...size },
      left: { x: left, y: midY, ...size },
      bottom: { x: subject.x, y: below, ...size },
      bottomLeft: { x: subject.x, y: below, ...size },
      bottomRight: { x: subject.x + subject.w - size.w, y: below, ...size },
      top: { x: subject.x, y: above, ...size },
      topLeft: { x: subject.x, y: above, ...size },
      topRight: { x: subject.x + subject.w - size.w, y: above, ...size },
      centerBelow: { x: midX, y: below, ...size },
      centerAbove: { x: midX, y: above, ...size },
    };
  };
  const ORDER = [
    'right',
    'top',
    'bottom',
    'left',
    'centerAbove',
    'centerBelow',
    'topRight',
    'bottomRight',
    'topLeft',
    'bottomLeft',
  ] as const;
  for (const m of [margin, HUG_MARGIN]) {
    const sides = around(m);
    // The named side, nudged the way the pipeline asked, before anything else.
    if (at && sides[at]) {
      const asked = sides[at] as BoardRect;
      if (nudge) push({ ...asked, x: asked.x + nudge[0], y: asked.y + nudge[1] });
      push(asked);
    }
    for (const name of ORDER) push(sides[name] as BoardRect);
  }
  /**
   * INSIDE THE SUBJECT'S OWN REGION. A note written on a shape big enough to hold it is not a note
   * that has drifted — it is a label on a map, a total under a table's last row, a word written
   * across a wide band. Only where the words genuinely fit with air around them, so this never
   * turns into writing over a small mark.
   */
  if (allowInside && subject.w >= size.w + margin * 2 && subject.h >= size.h + margin * 2) {
    const cx = subject.x + subject.w / 2 - size.w / 2;
    const cy = subject.y + subject.h / 2 - size.h / 2;
    push({ x: cx, y: cy, ...size });
    push({ x: subject.x + margin, y: subject.y + margin, ...size });
    push({ x: subject.x + subject.w - size.w - margin, y: subject.y + margin, ...size });
    push({ x: subject.x + margin, y: subject.y + subject.h - size.h - margin, ...size });
    push({
      x: subject.x + subject.w - size.w - margin,
      y: subject.y + subject.h - size.h - margin,
      ...size,
    });
    push({ x: cx, y: subject.y + margin, ...size });
    push({ x: cx, y: subject.y + subject.h - size.h - margin, ...size });
  }
  /**
   * A BOUNDED SWEEP ALONG EACH SIDE. Beside the subject, moved along its own side to find air.
   *
   * This is what `placeLabel`'s unbounded walk was reaching for, done as a search instead of a
   * fall: the whole legal band along each side — everything the reach allows and nothing past it —
   * sampled finely enough to find a packing that exists. Four notes of 160 × 116 units around a
   * 46 × 38 apex have exactly one arrangement that keeps them all inside the reach and clear of
   * each other, and it is a vertical stack on one side; a slide of one note-height per step walks
   * straight past it.
   */
  const SWEEP = 12;
  /** The band walked OUTWARD from where the side naturally sits, so the least move wins. */
  const outward = (from: number, lo: number, hi: number): number[] => {
    const out: number[] = [];
    const step = Math.max((hi - lo) / SWEEP, 1);
    for (let i = 1; i <= SWEEP; i += 1) {
      for (const d of [from + i * step, from - i * step]) if (d >= lo && d <= hi) out.push(d);
    }
    return out;
  };
  for (const m of [margin, HUG_MARGIN]) {
    const sides = around(m);
    for (const name of ['right', 'left'] as const) {
      const base = sides[name] as BoardRect;
      for (const y of outward(base.y, subject.y - reach - size.h, subject.y + subject.h + reach))
        push({ ...base, y });
    }
    for (const name of ['top', 'bottom'] as const) {
      const base = sides[name] as BoardRect;
      for (const x of outward(base.x, subject.x - reach - size.w, subject.x + subject.w + reach))
        push({ ...base, x });
    }
  }
  return out.filter((box) => boxGap(box, reachTo) <= reach);
}

/**
 * Solve a written mark's size, measure and position together. See `WrittenFit`.
 *
 * THREE PHASES, AND THEY ARE THE LAWS IN PRIORITY ORDER.
 *
 *  1. THE LAW. Sizes largest first, measures widest first, positions in the order a tutor tries
 *     them, everything inside the reach: the first that is on the surface and clear of what is
 *     already drawn wins. This is the answer on every board that has one.
 *  2. CLEAR BEATS CLOSE. Nothing inside the reach is free. "Never over the text it explains" is
 *     the same craft sentence as "within 24 px of its subject", and of the two, writing ON the
 *     working is the one a learner cannot read past — so the search widens and takes the NEAREST
 *     clear spot, and says `withinReach: false` about it. That is a reportable exception, not a
 *     silent drift: the old code walked two hundred steps down the board and said nothing.
 *  3. Nothing is clear anywhere. The least-crowded box inside the reach, at the smallest legible
 *     size — beside the subject and slightly crowded beats out of sight.
 */
export function solveWritten(solve: WrittenSolve): WrittenFit {
  const bounds = solve.area ?? { x: 0, y: 0, w: BOARD_UNITS, h: Number.POSITIVE_INFINITY };
  const gapCheck = solve.margin * 0.5;
  const allowInside = solve.allowInside ?? true;
  /**
   * THE SHAPES THIS MARK MAY TAKE, in the order a person would try them: full size on one line,
   * then full size WRAPPED, then smaller, then smaller and wrapped.
   *
   * THE WRAP IS MEASURED AGAINST THE WORDS, NOT AGAINST THE SURFACE. Held to fractions of the
   * surface's own measure — 704 units on a 1440 plane — a 202-unit phrase never wrapped at all,
   * which is why 'greatest height' had no narrow shape to fall back on and went 33 px from the
   * apex. The fractions are of the phrase's own natural width, so every phrase has a narrow form.
   */
  const usable: { size: number; maxWidth: number; shape: Size }[] = [];
  for (const size of solve.sizes) {
    const wide = solve.measure(size, solve.maxWidth);
    if (!(wide.w > 0) || !(wide.h > 0)) continue;
    usable.push({ size, maxWidth: solve.maxWidth, shape: wide });
    for (const k of [0.62, 0.42]) {
      // Never narrower than a couple of characters: a quantity broken into a column of digits is
      // not a quantity any more.
      const mw = Math.max(size * 2.2, wide.w * k);
      if (mw >= wide.w * 0.95) continue;
      const shape = solve.measure(size, mw);
      if (shape.w > 0 && shape.h > 0) usable.push({ size, maxWidth: mw, shape });
    }
  }
  const others = solve.subjectBox
    ? solve.occupied.filter((o) => o !== solve.subjectBox)
    : solve.occupied;
  const crowdOf = (box: BoardRect, clearance: number) =>
    others.reduce((sum, o) => sum + overlapArea(padBy(box, clearance), o), 0);
  /**
   * THE AIR BETWEEN TWO MARKS IS THE MOST EXPENDABLE THING HERE.
   *
   * Half a margin of clear air between one mark and the next is a nicety; twelve pixels of type
   * and twenty-four pixels of reach are laws. So the clearance is a ladder too, tried roomy first
   * and tightened only when roomy has no answer inside the reach — and never past nought, because
   * two marks written over each other is a third law broken. Measured on the projectile at 1440:
   * 'greatest height' clears the reach by two tenths of a unit at a clearance of two, and misses
   * it by two tenths at a clearance of five. That is the whole of the difference.
   */
  const clearances = [gapCheck, gapCheck * 0.4, 0];
  const measuredTo = solve.reachTo ?? solve.subject;
  const fit = (box: BoardRect, size: number, maxWidth: number): WrittenFit => {
    const gap = boxGap(box, measuredTo);
    return { box, size, maxWidth, gap, withinReach: gap <= solve.reach, inside: gap === 0 };
  };

  /**
   * 1 — inside the reach, clear, the first a tutor would try.
   *
   * THE AIM FIRST, THEN THE LAW. `solve.reach` carries the headroom the three rulers cost
   * (`REACH_AIM`); the law itself is that headroom back. A mark that has no answer inside the aim
   * very often has one a pixel or two further out, and taking it is strictly better than the
   * escape below — which is free to go four times as far. Measured: aiming and then escaping put
   * 'cell wall' 31 px from its leader where the law's own reach had an answer at 20.
   */
  for (const reach of [solve.reach, solve.reach * (NOTE_REACH / REACH_AIM)]) {
    for (const { size, maxWidth, shape } of usable) {
      const candidates = writtenCandidates(
        solve.subject,
        shape,
        solve.margin,
        reach,
        solve.at,
        allowInside,
        solve.nudge,
        measuredTo,
      ).filter((box) => contains(bounds, box));
      for (const clearance of clearances) {
        for (const box of candidates) {
          if (crowdOf(box, clearance) === 0) return fit(box, size, maxWidth);
        }
      }
    }
  }

  // 2 — nothing inside the reach is free. The nearest clear spot, however far that is.
  let nearest: WrittenFit | null = null;
  for (const { size, maxWidth, shape } of usable) {
    for (const box of writtenCandidates(
      solve.subject,
      shape,
      solve.margin,
      solve.reach * ESCAPE_REACH,
      solve.at,
      allowInside,
      solve.nudge,
      measuredTo,
    )) {
      if (!contains(bounds, box)) continue;
      if (crowdOf(box, 0) > 0) continue;
      const candidate = fit(box, size, maxWidth);
      if (!nearest || candidate.gap < nearest.gap) nearest = candidate;
    }
  }
  if (nearest) return nearest;

  // 3 — nothing is clear anywhere. Beside the subject and a little crowded, at the smallest
  //     legible size, beats out of sight.
  let best: WrittenFit | null = null;
  let least = Number.POSITIVE_INFINITY;
  for (const { size, maxWidth, shape } of usable) {
    for (const box of writtenCandidates(
      solve.subject,
      shape,
      solve.margin,
      solve.reach,
      solve.at,
      allowInside,
      solve.nudge,
      measuredTo,
    )) {
      const cost = crowdOf(box, 0) + (contains(bounds, box) ? 0 : 1e6);
      if (cost < least) {
        least = cost;
        best = fit(box, size, maxWidth);
      }
    }
  }
  if (best) return best;
  const last = usable[usable.length - 1];
  const size = last?.size ?? (solve.sizes[solve.sizes.length - 1] as number) ?? 0;
  const shape = last?.shape ?? { w: 0, h: 0 };
  const box = { x: solve.subject.x, y: solve.subject.y + solve.subject.h + solve.margin, ...shape };
  return fit(box, size, last?.maxWidth ?? Number.POSITIVE_INFINITY);
}

/**
 * How much further than the law the escape hatch may look, when nothing inside the reach is free.
 *
 * Four times twenty-four pixels is about a hundred, which on every board measured is enough to
 * clear the crowd by going round it, and still tight enough that the answer reads as belonging to
 * the subject rather than as a note in the margin of a different drawing.
 */
const ESCAPE_REACH = 4;

function padBy(box: BoardRect, pad: number): BoardRect {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}
