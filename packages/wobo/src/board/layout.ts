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
  /**
   * THE INK INSIDE THE BOX, relative to the box's own top-left. Absent, the box is the ink.
   *
   * A written mark's box is its LINE BOX, and a line box carries leading a learner never sees:
   * '1919' at 45 units reports 81 x 55 and paints 77 x 27, nine units under the top of its box
   * with nineteen clear beneath (the adversary, wave 58, the timeline at 390). Every law about a
   * written mark is stated of what it paints, so a caller that can measure the ink says where it
   * is, and the solver reads reach and air off that.
   */
  ink?: BoardRect;
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
 * ONE SOLVER, THREE LAWS (the adversary, waves 57 and 58; INK-FOUR craft).
 *
 * The craft lens asks three things of a written mark in one breath — "labels at least 12 px on
 * the glass, a note in the margin within 24 px of its subject and never over the text it
 * explains" — and they are not independent. Wave 51 closed the first by growing the type, which
 * broke the second. Wave 57 closed the second with this solver, and bought it by spending the
 * third: its last rung of clearance was nought, so 'magnification -1.00' was printed through
 * 'image' and 'apex' sat 2.4 px from 'up-speed is zero here' and read as one word. A law that is
 * not in the arithmetic is a law the arithmetic trades away. So all three are in it:
 *
 *  1. SIZE. The legible sizes and measures are candidates, not a decision already taken. The
 *     bottom of the band is the LAW — the size at which this phrase's tallest glyph measures
 *     twelve pixels (`geometry.ts`, `typeFloorFor`) — so the floor is kept by construction.
 *     Shapes are tried one line first, largest size to smallest, then two lines, then more: a
 *     hand writes a caption a little smaller before it stacks it three high.
 *  2. REACH. Every position is generated INSIDE the reach, around the subject's reservation
 *     and measured to its ink (`reachTo`) — and measured from THIS mark's ink too (`Size.ink`),
 *     because a line box carries leading a learner never sees: '1919' at 45 units reports a
 *     55-unit box and paints 27, so a number solved to twelve units of box sat twenty-seven
 *     pixels from its tick.
 *  3. AIR. The clear space between this mark's ink and every other written mark's ink is
 *     `air`, and it is never spent: there is no rung below it. A drawn neighbour is a
 *     reservation already padded past its ink, so a mark need only keep a nib clear of it
 *     (`nib`) — and prefers the ordinary margin where the board allows.
 *
 * Whoever is already on the board says what it is: an entry in `occupied` that a written mark
 * reported carries `written: true` (`geometry.ts`, `isWrittenBox`), and that is the whole of
 * how the solver tells the two clearances apart. Nothing else is carried in a second list.
 *
 * WHAT GIVES, IN ORDER, WHEN THE BOARD IS FULL: the shape (a smaller size, then a wrap), then
 * the margin from drawn things (down to a nib), then the aim (down to the law). What never
 * gives: the floor, the air, and writing over a stroke. When nothing inside the reach keeps all
 * three, the solver takes the NEAREST clear spot and says so — `withinReach: false` — which is
 * a reportable exception rather than a silent drift; only when nothing on the board is clear at
 * all does it sit crowded, and then over drawn ink before ever over writing.
 *
 * ROOM FOR THE MARKS STILL TO COME. A solver that places one mark at a time cannot see the next
 * one, which is how the first event on the timeline took the whole underside of the axis and
 * left nothing for the second. `reserved` names the zones pending siblings will ask for — the
 * side of a subject a later caption is anchored to (`reservedStrip`) — and a candidate that
 * crosses one is ranked behind every candidate that does not, at any shape. Soft, because a
 * zone may be the only room there is.
 */
export interface WrittenFit {
  /** Where the mark goes, at the size and measure that let it go there. */
  box: BoardRect;
  /**
   * The ink the mark paints there — the box less its leading — which is what every law is read
   * on. Always set by the solver; optional only so a caller that places a mark itself (a point,
   * a named cell) can report a fit without measuring one.
   */
  ink?: BoardRect;
  size: number;
  maxWidth: number;
  /** Clear air between the mark's ink and its subject's ink, in board units. */
  gap: number;
  /** True when the mark honours the reach law at the size it was written. */
  withinReach: boolean;
  /** True when the mark sits inside the subject's own region rather than beside it. */
  inside: boolean;
}

/** A box already on the board. A written mark's entry is its ink, and says so. */
export interface Placed extends BoardRect {
  written?: boolean;
}

export interface WrittenSolve {
  /** What the mark names — the box the candidates are built around. */
  subject: BoardRect;
  /** The side the pipeline asked for, when it named one. */
  at?: Exclude<AnchorAt, readonly number[]> | 'centerAbove' | 'centerBelow' | undefined;
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
  /**
   * The real wrap: the box this text takes at a size, held to a measure — and, when the caller
   * can say, the ink inside that box (`Size.ink`). Without it the box is taken to be the ink.
   */
  measure: (size: number, maxWidth: number) => Size;
  /** Type sizes to try, LARGEST FIRST. The last is the legible floor. */
  sizes: readonly number[];
  /** The widest a line may be — the pipeline's measure, or the surface's. */
  maxWidth: number;
  /** Everything already placed. A written mark's entry is its ink and carries `written`. */
  occupied: readonly Placed[];
  /**
   * THE SUBJECT'S OWN BOX, AS IT SITS IN `occupied` — so the solver can take it out.
   *
   * Being beside the thing you name is the whole point, and `occupied` holds the thing you name.
   * Counting it as crowd meant every hugged candidate clashed with its own subject and the search
   * fell through to the escape hatch: measured, it is why 'greatest height' could not sit next to
   * the apex at any size. The subject's entries are the box itself and any written ink inside it.
   */
  subjectBox?: BoardRect;
  /**
   * WHAT THE REACH IS MEASURED TO, when that is not the same box the candidates are built around.
   *
   * A subject's layout box is what it RESERVES; its ink is what it PAINTS, and half the grammar
   * pads the first on purpose (`geometry.ts`, `inkBoxOf`). The law is about the ink — so the
   * candidates keep their margin from the reservation, and the distance that decides whether a
   * candidate is legal is the distance to the drawing. When the subject is itself WRITING, its
   * reservation is only leading, and the candidates are built around the ink as well.
   */
  reachTo?: BoardRect;
  area?: BoardRect;
  /** The clear space the mark keeps from its own subject's reservation, in units. */
  margin: number;
  /** The reach the solver AIMS at, in board units (`REACH_AIM`); the law is `NOTE_REACH`. */
  reach: number;
  /** May the words sit inside the subject's own region? False for a mark on a thin leader. */
  allowInside?: boolean;
  /**
   * THE AIR LAW, in board units: the least clear space between this mark's ink and any other
   * written mark's ink (`geometry.ts`, `INK_AIR_PX`, converted by the board's scale). Never spent.
   * Absent, the margin stands in for it.
   */
  air?: number;
  /** The nib in board units: the least a mark keeps from a drawn reservation. Absent, nought. */
  nib?: number;
  /** Zones pending siblings will want — see `reservedStrip`. Soft: crossed only when nothing else fits. */
  reserved?: readonly Reserved[];
}

/**
 * THE AIR LAW IN SCREEN PIXELS, when the caller does not state it: the clear space two placed
 * objects keep from each other (`OBJECT_GAP`, fourteen units) restated on the glass in the same
 * ratio as the label margin — ten units of `LABEL_MARGIN` are eight pixels of `geometry.ts`'s
 * `LABEL_GAP_PX`. The same number as `geometry.ts`'s `INK_AIR_PX`, stated here so the solver
 * keeps the law even when it is handed nothing but a reach.
 */
export const WRITTEN_AIR_PX = (8 * OBJECT_GAP) / LABEL_MARGIN;

/**
 * WHAT THE SOLVER AIMS AT FOR AIR, above a law of `WRITTEN_AIR_PX` — the sibling of `REACH_AIM`.
 *
 * The solver measures in the settled scale and the browser paints under the fitted camera, and
 * the two agree to a few percent, not exactly (the note on `REACH_AIM`). A pair solved to the
 * law exactly came back 10.5 and 10.8 px against 11.2 on the projectile at 390. So the air is
 * aimed an eighth above the law, and only when nothing inside the reach keeps the aim does the
 * solver settle for the law itself — and never a hair under it.
 */
export const AIR_HEADROOM = 1.125;

/**
 * WHAT ONE SOLVE COST: the candidate positions it carried, and the ones it actually judged against
 * the crowd. The ruler that does not change from one machine to the next, and so the one that says
 * whether the search has GROWN (`written-cost.test.ts`).
 */
export interface WrittenWork {
  /** Positions the search carried — inside the reach and not already offered — over every stage. */
  built: number;
  /** Of those, the ones taken as far as the crowd test, which is the work that costs. */
  graded: number;
}

/**
 * A SINK THE LAB CAN HANG ON THE SOLVER. Every solve reports what it was asked and what it
 * answered, so a frame that breaks a law can be traced to the candidates the solver had rather
 * than argued about. Null in production; nothing is retained.
 */
let writtenTrace: ((solve: WrittenSolve, fit: WrittenFit, work: WrittenWork) => void) | null = null;
export function traceWritten(
  sink: ((solve: WrittenSolve, fit: WrittenFit, work: WrittenWork) => void) | null,
): void {
  writtenTrace = sink;
}

/** The clear air between two boxes, in units. */
export function boxGap(a: BoardRect, b: BoardRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** A zone a pending caption will ask for, and the side of its subject it lies on. */
export interface Reserved extends BoardRect {
  side: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * THE ZONE A PENDING CAPTION WILL ASK FOR: the side of its subject it is anchored to, `depth`
 * deep, as wide as the subject. A fraction pair names a point inside the subject and reserves
 * nothing; an unnamed side reserves the right, which is the first side the solver tries.
 *
 * ONLY FOR A SIBLING ON ANOTHER SUBJECT. Two marks hung off the same thing on the same side
 * stack — the first takes the side and the second goes under it — so neither reserves against
 * the other; a caller that reserved a mark's own subject against it sent the second line of a
 * derivation above the first (measured, the quadratic at 1440).
 */
export function reservedStrip(
  subject: BoardRect,
  at: AnchorAt | 'centerAbove' | 'centerBelow' | undefined,
  depth: number,
): Reserved | null {
  if (Array.isArray(at) || at === 'center') return null;
  const side = (at as string | undefined) ?? 'right';
  if (side.startsWith('bottom') || side === 'centerBelow') {
    return { x: subject.x, y: subject.y + subject.h, w: subject.w, h: depth, side: 'bottom' };
  }
  if (side.startsWith('top') || side === 'centerAbove') {
    return { x: subject.x, y: subject.y - depth, w: subject.w, h: depth, side: 'top' };
  }
  if (side === 'left') {
    return { x: subject.x - depth, y: subject.y, w: depth, h: subject.h, side: 'left' };
  }
  return { x: subject.x + subject.w, y: subject.y, w: depth, h: subject.h, side: 'right' };
}

/**
 * HOW MUCH OF A RESERVED ZONE THIS INK TAKES: the fraction of the zone's width (for a zone under
 * or over its subject) or height (beside it) that the ink covers. A caption that runs the whole
 * way under the next tick scores one; one that clips the corner scores a tenth — and when every
 * shape has to cross, the one that leaves the neighbour the most room wins.
 */
function crossingOf(ink: BoardRect, zone: Reserved): number {
  const w = Math.min(ink.x + ink.w, zone.x + zone.w) - Math.max(ink.x, zone.x);
  const h = Math.min(ink.y + ink.h, zone.y + zone.h) - Math.max(ink.y, zone.y);
  if (w <= 0 || h <= 0) return 0;
  const across = zone.side === 'top' || zone.side === 'bottom';
  return across ? w / Math.max(zone.w, 1e-9) : h / Math.max(zone.h, 1e-9);
}

/** How tightly a tutor writes when the ordinary margin will not do. */
const HUG_MARGIN = 4;

/** The ink a shape paints when its box is placed at `box`. */
function inkIn(box: BoardRect, shape: Size): BoardRect {
  const r = shape.ink;
  return r ? { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h } : box;
}

/**
 * Is this ink the subject's own writing? Nine tenths of it inside the subject's box: a written
 * mark's ink runs PAST its line box on the right, because Caveat slants and the last glyph
 * overhangs its own advance, so "wholly inside" is a test the subject's own ink fails by a unit
 * or two — and then counts as crowd, and every candidate beside it is refused for want of air.
 * Measured: the quadratic's second line went ABOVE its first for exactly that.
 */
function mostlyWithin(inner: BoardRect, outer: BoardRect): boolean {
  const area = inner.w * inner.h;
  return area > 0 ? overlapArea(inner, outer) >= area * 0.9 : false;
}

/**
 * The positions a tutor would try for a shape beside a subject, in the order they would try
 * them, and NONE of them further than `reach` — measured from the shape's INK to `reachTo`.
 *
 * Every position is stated of the ink: "the ink sits `m` clear of the base, centred on it" —
 * and the box is put wherever that needs it to be. `bases` is the reservation, and for a written
 * subject its ink as well (first), because the reservation of a line of writing is only leading.
 *
 * The side the anchor named comes first — `{object: "cell", at: "bottom"}` is the tutor saying
 * "write this under it", not a hint. Then the eight around it at the ordinary margin, then the
 * same eight hugged in close, then inside the subject where the words fit inside it, then a
 * bounded sweep along each side: the whole legal band along each side — everything the reach
 * allows and nothing past it — sampled finely enough to find a packing that exists.
 */
/**
 * THE CANDIDATES, AS NUMBERS RATHER THAN AS OBJECTS (the adversary, wave 60, finding 1).
 *
 * A shape's position is two numbers; its width and height are the shape's, the same for every
 * position it could take. The solver used to hand the grader a fresh rectangle object for each —
 * 1.5 million of them on the projectile alone, for a board that is redrawn twenty-six times
 * before it is shown — and then a second object for the ink inside each one it looked at. The
 * positions live in three growing arrays instead, reused from one shape to the next, and a
 * rectangle is built only for the one position that wins.
 *
 * The distance to the subject comes out of the generator too, because the generator has already
 * worked it out to decide whether the position is inside the reach at all.
 */
class Candidates {
  xs: Float64Array<ArrayBuffer> = new Float64Array(256);
  ys: Float64Array<ArrayBuffer> = new Float64Array(256);
  gaps: Float64Array<ArrayBuffer> = new Float64Array(256);
  n = 0;

  reset(): void {
    this.n = 0;
  }

  add(x: number, y: number, gap: number): void {
    if (this.n === this.xs.length) {
      const grow = (a: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
        const next = new Float64Array(a.length * 2);
        next.set(a);
        return next;
      };
      this.xs = grow(this.xs);
      this.ys = grow(this.ys);
      this.gaps = grow(this.gaps);
    }
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.gaps[this.n] = gap;
    this.n += 1;
  }
}

/**
 * THE POSITIONS ALREADY OFFERED, without a `Set` and without a string.
 *
 * The generator offers a position two or three times over — the same side at two alignments, the
 * same sample from two rings — and dropping the repeats is what the dedupe is for. On a quarter-
 * unit grid the position is one integer, so the table is an integer table: open addressing over a
 * power-of-two span, with a stamp per slot so that clearing it between shapes is a counter and not
 * a walk. Measured on the sixteen boards, the `Set` this replaces was the single largest line in
 * the search's cost — two million lookups and two million inserts on the projectile.
 */
class SeenKeys {
  private static readonly SPAN = 8192;
  /** Never let the table fill: past half full, probing costs more than the repeats it saves. */
  private static readonly ROOM = SeenKeys.SPAN / 2;
  private keys = new Float64Array(SeenKeys.SPAN);
  private stamp = new Int32Array(SeenKeys.SPAN);
  private era = 0;
  private held = 0;

  reset(): void {
    this.held = 0;
    this.era += 1;
    if (this.era === 0x7fffffff) {
      this.stamp.fill(0);
      this.era = 1;
    }
  }

  /**
   * True when this quarter-unit position was already offered in this era; records it when it was
   * not. The generator offers some eight hundred positions, so the table never reaches its own
   * half; if some future board ever did, the repeats pass through rather than the probe running
   * the length of the table.
   */
  seen(rx: number, ry: number): boolean {
    if (this.held >= SeenKeys.ROOM) return false;
    const mask = SeenKeys.SPAN - 1;
    const key = rx * 1_000_000 + ry;
    let i = ((rx * 73856093) ^ (ry * 19349663)) & mask;
    for (;;) {
      if (this.stamp[i] !== this.era) {
        this.stamp[i] = this.era;
        this.keys[i] = key;
        this.held += 1;
        return false;
      }
      if (this.keys[i] === key) return true;
      i = (i + 1) & mask;
    }
  }
}

const CANDIDATES = new Candidates();
const SEEN = new SeenKeys();

/**
 * The ten places around a subject, at one ring, as twenty numbers: x then y, in `SIDE` order.
 * Under and over are aligned to the subject's own margin; beside is centred on it — a caption
 * reads from the same edge as the thing it captions.
 */
const SIDE = {
  right: 0,
  left: 1,
  bottom: 2,
  bottomLeft: 3,
  bottomRight: 4,
  top: 5,
  topLeft: 6,
  topRight: 7,
  centerBelow: 8,
  centerAbove: 9,
} as const;
/** The order a tutor tries the sides in, as indices into a ring. */
const SIDE_ORDER = [
  SIDE.right,
  SIDE.top,
  SIDE.bottom,
  SIDE.left,
  SIDE.centerAbove,
  SIDE.centerBelow,
  SIDE.topRight,
  SIDE.bottomRight,
  SIDE.topLeft,
  SIDE.bottomLeft,
] as const;

/**
 * The positions a tutor would try for a shape beside a subject, in the order they would try
 * them, and NONE of them further than `reach` — measured from the shape's INK to `reachTo`.
 *
 * Every position is stated of the ink: "the ink sits `m` clear of the base, centred on it" —
 * and the box is put wherever that needs it to be. `bases` is the reservation, and for a written
 * subject its ink as well (first), because the reservation of a line of writing is only leading.
 *
 * The side the anchor named comes first — `{object: "cell", at: "bottom"}` is the tutor saying
 * "write this under it", not a hint. Then the eight around it at the ordinary margin, then the
 * same eight hugged in close, then inside the subject where the words fit inside it, then a
 * bounded sweep along each side: the whole legal band along each side — everything the reach
 * allows and nothing past it — sampled finely enough to find a packing that exists.
 */
function writtenCandidates(
  bases: readonly BoardRect[],
  shape: Size,
  margin: number,
  reach: number,
  at: WrittenSolve['at'],
  allowInside: boolean,
  nudge: WrittenSolve['nudge'],
  reachTo: BoardRect,
): Candidates {
  const r = shape.ink ?? { x: 0, y: 0, w: shape.w, h: shape.h };
  const out = CANDIDATES;
  out.reset();
  SEEN.reset();
  /**
   * THE REACH IS TESTED AS THE CANDIDATE IS MADE, NOT AFTER THE WHOLE CROWD OF THEM IS.
   *
   * The sweep along four sides at seven rings offers some seven hundred positions a shape could
   * take, and the corners of that band are outside the reach by construction — a candidate a
   * margin out and a whole reach along is `hypot` away, not `reach` away. Building every one of
   * them, keying it, holding it and only then throwing two thirds away, was most of what the
   * search cost. Same positions, same order, same answer; two thirds of them never made.
   */
  const limit = reach + 1e-9;
  const limit2 = limit * limit;
  const rightEdge = reachTo.x + reachTo.w;
  const bottomEdge = reachTo.y + reachTo.h;
  /** How far this ink's edge sits from the subject's ink on each axis, at (x, y). */
  const offX = (x: number): number => Math.max(0, x + r.x - rightEdge, reachTo.x - (x + r.x + r.w));
  const offY = (y: number): number =>
    Math.max(0, y + r.y - bottomEdge, reachTo.y - (y + r.y + r.h));
  const pushAt = (x: number, y: number) => {
    const dx = offX(x);
    if (dx > limit) return;
    const dy = offY(y);
    if (dy > limit) return;
    const d2 = dx * dx + dy * dy;
    if (d2 > limit2) return;
    if (SEEN.seen(Math.round(x * 4), Math.round(y * 4))) return;
    out.add(x, y, Math.sqrt(d2));
  };
  /** The ten places around `base` at ring `m`, written into `into` as x, y pairs. */
  const around = (base: BoardRect, m: number, into: Float64Array): void => {
    const right = base.x + base.w + m - r.x;
    const left = base.x - m - (r.x + r.w);
    const below = base.y + base.h + m - r.y;
    const above = base.y - m - (r.y + r.h);
    const midY = base.y + base.h / 2 - (r.y + r.h / 2);
    const midX = base.x + base.w / 2 - (r.x + r.w / 2);
    const startX = base.x - r.x;
    const endX = base.x + base.w - (r.x + r.w);
    const put = (i: number, x: number, y: number) => {
      into[i * 2] = x;
      into[i * 2 + 1] = y;
    };
    put(SIDE.right, right, midY);
    put(SIDE.left, left, midY);
    put(SIDE.bottom, startX, below);
    put(SIDE.bottomLeft, startX, below);
    put(SIDE.bottomRight, endX, below);
    put(SIDE.top, startX, above);
    put(SIDE.topLeft, startX, above);
    put(SIDE.topRight, endX, above);
    put(SIDE.centerBelow, midX, below);
    put(SIDE.centerAbove, midX, above);
  };
  /**
   * THE NAMED SIDE, IN EVERY ALIGNMENT, BEFORE ANY OTHER SIDE. "Under it" is an instruction about
   * the side more than the alignment: the alignment asked for comes first, then the centred and
   * the right-aligned forms of the same side, and only then another side. The wave 58 solver
   * tried the one form and then left the side — so '1919', whose left-aligned form grazed the
   * next tick's zone, was written BESIDE its tick. (A caller that wants a caption centred under
   * a small mark asks for `centerBelow`; the reserved zones make the centred form win on their
   * own when the aligned form would take a neighbour's room.)
   */
  const family = (side: string): number[] => {
    const above = ['top', 'centerAbove', 'topRight'];
    const below = ['bottom', 'centerBelow', 'bottomRight'];
    const kin = above.includes(side) || side === 'topLeft'
      ? above
      : below.includes(side) || side === 'bottomLeft'
        ? below
        : [];
    return [side, ...kin.filter((n) => n !== side)]
      .map((n) => (SIDE as Record<string, number>)[n])
      .filter((i): i is number => i !== undefined);
  };
  const named = at ? family(at) : [];
  const askedSide = at ? ((SIDE as Record<string, number>)[at] ?? -1) : -1;
  /**
   * RINGS THAT WIDEN. The ordinary margin, the hug, then the margin widened in steps out to the
   * reach: a ring at one distance can be a hair inside a neighbouring reservation (the lens's
   * rays sat 0.3 px into the only ring above the focus) while the next ring out is clear and
   * still well inside the aim.
   */
  const rings: number[] = [margin, HUG_MARGIN];
  const step = Math.max((reach - margin) / 5, 1);
  for (let m = margin + step; m <= reach + 1e-9; m += step) rings.push(m);
  /**
   * THE RINGS ARE WORKED OUT ONCE, NOT ONCE PER PASS. The sides at a ring are ten places, and the
   * ring loop and the sweep below both used to build their own copy of every one — the same
   * fourteen sets, twice, on every shape of every stage of every solve.
   */
  const ringSides = new Float64Array(bases.length * rings.length * 20);
  for (let bi = 0; bi < bases.length; bi += 1) {
    for (let ri = 0; ri < rings.length; ri += 1) {
      around(
        bases[bi] as BoardRect,
        rings[ri] as number,
        ringSides.subarray((bi * rings.length + ri) * 20, (bi * rings.length + ri) * 20 + 20),
      );
    }
  }
  const sideX = (bi: number, ri: number, side: number): number =>
    ringSides[(bi * rings.length + ri) * 20 + side * 2] as number;
  const sideY = (bi: number, ri: number, side: number): number =>
    ringSides[(bi * rings.length + ri) * 20 + side * 2 + 1] as number;
  for (let bi = 0; bi < bases.length; bi += 1) {
    for (let ri = 0; ri < rings.length; ri += 1) {
      // The named side, nudged the way the pipeline asked, before anything else.
      for (const side of named) {
        const x = sideX(bi, ri, side);
        const y = sideY(bi, ri, side);
        if (nudge && side === askedSide) pushAt(x + nudge[0], y + nudge[1]);
        pushAt(x, y);
      }
      for (const side of SIDE_ORDER) pushAt(sideX(bi, ri, side), sideY(bi, ri, side));
    }
  }
  /**
   * INSIDE THE SUBJECT'S OWN REGION. A note written on a shape big enough to hold it is not a note
   * that has drifted — it is a label on a map, a total under a table's last row, a word written
   * across a wide band. Only where the words genuinely fit with air around them, so this never
   * turns into writing over a small mark.
   */
  for (const base of bases) {
    if (!allowInside || base.w < r.w + margin * 2 || base.h < r.h + margin * 2) continue;
    const x0 = base.x + margin - r.x;
    const x1 = base.x + base.w - margin - (r.x + r.w);
    const y0 = base.y + margin - r.y;
    const y1 = base.y + base.h - margin - (r.y + r.h);
    const cx = base.x + base.w / 2 - (r.x + r.w / 2);
    const cy = base.y + base.h / 2 - (r.y + r.h / 2);
    pushAt(cx, cy);
    pushAt(x0, y0);
    pushAt(x1, y0);
    pushAt(x0, y1);
    pushAt(x1, y1);
    pushAt(cx, y0);
    pushAt(cx, y1);
  }
  /**
   * A BOUNDED SWEEP ALONG EACH SIDE. Four notes of 160 × 116 units around a 46 × 38 apex have
   * exactly one arrangement that keeps them all inside the reach and clear of each other, and it
   * is a stack on one side; a slide of one note-height per step walks straight past it. So the
   * band is sampled, walked OUTWARD from where the side naturally sits so the least move wins.
   */
  const SWEEP = 12;
  const yLo = reachTo.y - reach - (r.y + r.h);
  const yHi = bottomEdge + reach - r.y;
  const xLo = reachTo.x - reach - (r.x + r.w);
  const xHi = rightEdge + reach - r.x;
  const yStep = Math.max((yHi - yLo) / SWEEP, 1);
  const xStep = Math.max((xHi - xLo) / SWEEP, 1);
  /**
   * A SIDE WHOSE OWN OFFSET IS ALREADY PAST THE REACH HAS NOTHING TO SWEEP. Sliding along the
   * right-hand band changes only the y of every sample, so the x-distance to the subject is the
   * same for all twenty-four of them; when that alone is past the reach, every one of them is,
   * and the band need not be walked at all. The outer rings on the far side of a small subject
   * are almost all of the sweep, and almost all of them are this.
   */
  for (let bi = 0; bi < bases.length; bi += 1) {
    for (let ri = 0; ri < rings.length; ri += 1) {
      for (const side of [SIDE.right, SIDE.left] as const) {
        const x = sideX(bi, ri, side);
        if (offX(x) > limit) continue;
        const from = sideY(bi, ri, side);
        for (let i = 1; i <= SWEEP; i += 1) {
          const up = from + i * yStep;
          if (up >= yLo && up <= yHi) pushAt(x, up);
          const down = from - i * yStep;
          if (down >= yLo && down <= yHi) pushAt(x, down);
        }
      }
      for (const side of [SIDE.top, SIDE.bottom] as const) {
        const y = sideY(bi, ri, side);
        if (offY(y) > limit) continue;
        const from = sideX(bi, ri, side);
        for (let i = 1; i <= SWEEP; i += 1) {
          const up = from + i * xStep;
          if (up >= xLo && up <= xHi) pushAt(up, y);
          const down = from - i * xStep;
          if (down >= xLo && down <= xHi) pushAt(down, y);
        }
      }
    }
  }
  workBuilt += out.n;
  return out;
}

/**
 * How much further than the law the escape hatch may look, when nothing inside the reach is
 * clear. Four times twenty-four pixels is about a hundred, which on every board measured is
 * enough to clear the crowd by going round it; twelve is the last resort before sitting crowded,
 * because a note nobody can pair with its subject is still better than a note written through
 * another note.
 */
const ESCAPE_REACH = [4, 12] as const;

/** The shapes a mark may take: every (size, measure) the wrap allows, with what it paints. */
interface Shape {
  size: number;
  maxWidth: number;
  shape: Size;
  lines: number;
}

/**
 * Solve a written mark's size, measure and position together. See the section note above.
 */
/** What the search has cost since the current solve began. Two integers; nothing is retained. */
let workBuilt = 0;
let workGraded = 0;

export function solveWritten(solve: WrittenSolve): WrittenFit {
  workBuilt = 0;
  workGraded = 0;
  const fit = solveWrittenInner(solve);
  if (writtenTrace) writtenTrace(solve, fit, { built: workBuilt, graded: workGraded });
  return fit;
}

function solveWrittenInner(solve: WrittenSolve): WrittenFit {
  const bounds = solve.area ?? { x: 0, y: 0, w: BOARD_UNITS, h: Number.POSITIVE_INFINITY };
  const allowInside = solve.allowInside ?? true;
  /**
   * THE REACH CARRIES THE SCALE. `reach` is `REACH_AIM` pixels in this board's units, so the
   * air and the nib, both laws in pixels, convert by the same ratio when the caller has not
   * converted them itself — the solver never falls back to a number in units that means a
   * different amount of white space on every board.
   */
  const perPx = solve.reach > 0 ? solve.reach / REACH_AIM : 1;
  const air = solve.air ?? WRITTEN_AIR_PX * perPx;
  const airAim = air * AIR_HEADROOM;
  const nib = solve.nib ?? INK_NIB_PX * perPx;
  const aim = solve.reach;
  const law = solve.reach * (NOTE_REACH / REACH_AIM);
  const reserved = solve.reserved ?? [];
  const measuredTo = solve.reachTo ?? solve.subject;

  /**
   * THE SHAPES THIS MARK MAY TAKE, in the order a hand would try them: one line at every legible
   * size, largest first; then wrapped to two lines, largest first; then three and more. A caption
   * written a little smaller on one line reads as a caption; the same words stacked three high
   * at the asked size read as a paragraph hung off a tick, and that is what the timeline at 390
   * showed when the wrap was tried before the next size down.
   *
   * THE WRAP IS MEASURED AGAINST THE WORDS, NOT AGAINST THE SURFACE. Held to fractions of the
   * surface's own measure — 704 units on a 1440 plane — a 202-unit phrase never wrapped at all,
   * which is why 'greatest height' had no narrow shape to fall back on and went 33 px from the
   * apex. The fractions are of the phrase's own natural width, so every phrase has a narrow form.
   */
  const shapes: Shape[] = [];
  for (const size of solve.sizes) {
    const wide = solve.measure(size, solve.maxWidth);
    if (!(wide.w > 0) || !(wide.h > 0)) continue;
    const lineHeight = size * 1.22;
    const linesOf = (s: Size) => Math.max(1, Math.round(s.h / lineHeight));
    shapes.push({ size, maxWidth: solve.maxWidth, shape: wide, lines: linesOf(wide) });
    for (const k of [0.62, 0.42]) {
      // Never narrower than a couple of characters: a quantity broken into a column of digits is
      // not a quantity any more.
      const mw = Math.max(size * 2.2, wide.w * k);
      if (mw >= wide.w * 0.95) continue;
      const shape = solve.measure(size, mw);
      if (shape.w > 0 && shape.h > 0) shapes.push({ size, maxWidth: mw, shape, lines: linesOf(shape) });
    }
  }
  // Stable: within a line count, the order the sizes came in (largest first).
  shapes.sort((a, b) => a.lines - b.lines);
  if (shapes.length === 0) {
    const size = solve.sizes[solve.sizes.length - 1] ?? 0;
    const box = { x: solve.subject.x, y: solve.subject.y + solve.subject.h + solve.margin, w: 0, h: 0 };
    return { box, ink: box, size, maxWidth: solve.maxWidth, gap: 0, withinReach: true, inside: false };
  }

  /** The crowd: everything placed except the subject itself and any writing inside it. */
  const own = solve.subjectBox;
  const others = own
    ? solve.occupied.filter((o) => o !== own && !(o.written && mostlyWithin(o, own)))
    : solve.occupied;
  const subjectWritten =
    own !== undefined && solve.occupied.some((o) => o.written && mostlyWithin(o, own));
  const bases: BoardRect[] =
    subjectWritten && solve.reachTo ? [solve.reachTo, solve.subject] : [solve.subject];
  /**
   * A NOTE ON A LINE OF WRITING IS TWO WRITTEN MARKS. The air law holds between them as between
   * any two, so beside a written subject the ring's margin is the air where the air is wider.
   */
  const ring = subjectWritten ? Math.max(solve.margin, air) : solve.margin;

  /**
   * THE CROWD, SORTED ONCE AND PADDED ONCE (the adversary, wave 60, finding 1).
   *
   * `judge` is the innermost loop in the file — it runs on every candidate of every shape of
   * every stage — and it used to ask each obstacle what kind it was, then build two fresh padded
   * rectangles around the CANDIDATE for every drawn one it met. A rectangle grown by a nib and
   * tested against another is the same test as the other grown by a nib and tested against it, so
   * the growing belongs to the obstacle, which does not move, and it happens once.
   *
   * The written marks come first for the same reason: a candidate is refused for want of air far
   * more often than for a stroke, and the loop that returns soonest is the loop that costs least.
   */
  const written: Placed[] = [];
  const drawnNib: BoardRect[] = [];
  const drawnMargin: BoardRect[] = [];
  for (const o of others) {
    if (o.written) written.push(o);
    else {
      drawnNib.push(padBy(o, nib));
      drawnMargin.push(padBy(o, solve.margin));
    }
  }

  /**
   * IS THIS INK LAWFUL HERE, and how roomy is it: `air` from every written mark, at least a nib
   * from every drawn reservation, and roomy when it keeps the ordinary margin from those too.
   *
   * Stated of four numbers rather than of a rectangle, and answered into three, because this runs
   * on every candidate of every shape of every stage and a rectangle made here is a rectangle
   * thrown away here. The air is compared as a SQUARE — the distance itself is a square root
   * taken only to be compared against a number that could have been squared instead.
   */
  const airLo = Math.max(0, air - 1e-9);
  const airLo2 = airLo * airLo;
  const airAimLo = Math.max(0, airAim - 1e-9);
  const airAimLo2 = airAimLo * airAimLo;
  let gradeAiry = true;
  let gradeRoomy = true;
  let gradeCrossing = 0;
  const judge = (ix: number, iy: number, iw: number, ih: number): boolean => {
    workGraded += 1;
    gradeAiry = true;
    for (let i = 0; i < written.length; i += 1) {
      const o = written[i] as Placed;
      const dx = Math.max(0, ix - (o.x + o.w), o.x - (ix + iw));
      const dy = Math.max(0, iy - (o.y + o.h), o.y - (iy + ih));
      const d2 = dx * dx + dy * dy;
      if (d2 < airLo2) return false;
      if (d2 < airAimLo2) gradeAiry = false;
    }
    gradeRoomy = true;
    for (let i = 0; i < drawnNib.length; i += 1) {
      const a = drawnNib[i] as BoardRect;
      if (ix < a.x + a.w && ix + iw > a.x && iy < a.y + a.h && iy + ih > a.y) return false;
      if (gradeRoomy) {
        const b = drawnMargin[i] as BoardRect;
        if (ix < b.x + b.w && ix + iw > b.x && iy < b.y + b.h && iy + ih > b.y) gradeRoomy = false;
      }
    }
    gradeCrossing = 0;
    for (const z of reserved) gradeCrossing += crossingOf({ x: ix, y: iy, w: iw, h: ih }, z);
    return true;
  };
  /** The ink a shape paints at (x, y), as four numbers. */
  const inkR = (sh: Size): BoardRect => sh.ink ?? { x: 0, y: 0, w: sh.w, h: sh.h };
  const onBoard = (x: number, y: number, sh: Size): boolean =>
    x >= bounds.x &&
    y >= bounds.y &&
    x + sh.w <= bounds.x + bounds.w &&
    y + sh.h <= bounds.y + bounds.h;

  /**
   * A NOTE THAT CAN SIT CLOSER, SITS CLOSER (the adversary, wave 60, finding 2).
   *
   * The search offers positions on rings and along sampled bands, and a sample is a sample. On the
   * lens at 1440 the ring that cleared the crowd put its note 19.1 px from what it names when a
   * lawful spot at 16.8 px lay between two samples; nineteen is inside the LAW and outside the AIM,
   * and the aim is the number the board's own settle reads before it decides whether to try another
   * rung of the type ladder. A sampled search cannot be made fine enough never to do that. What it
   * can do is finish the move it started.
   *
   * So a winner that missed the aim is PULLED toward what it names, straight at it, as far as it
   * will go: the whole remaining distance if that is clear, else half of it, else a quarter, and
   * again from wherever it lands. Nothing else may give — the position is re-judged at every step,
   * and a step is taken only when the mark is still `air` from every written neighbour, still a nib
   * clear of every stroke, still on the board, and no worse on the air it aims at, the room it
   * keeps, or the zones it crosses. Only a mark that missed the aim is pulled, so every mark the
   * search already placed well stands exactly where it stood.
   *
   * WHAT IT MOVED, MEASURED over the sixteen boards at both widths. The plant cell's worst mark
   * went from 6.0 px to 3.2 at 1440 and 3.7 at 390; the projectile's 'greatest height', which has
   * nowhere lawful to go at all, from 37.9 to 37.8 and from 46.7 to 46.3; and the lens note that
   * had sat at 19.1 came inside the aim. Nothing on any board got further from its subject.
   *
   * It does not make the lens settle on its first rung, and it was never going to: what holds that
   * board out is a different mark, a caption that sits 22 px from its subject because a scan of
   * every position at every shape the solver may take finds no lawful spot nearer. The pull closes
   * the gap a sample missed. It cannot make room that is not there.
   */
  const PULLS = [1, 0.5, 0.25, 0.125, 0.0625] as const;
  const pullIn = (x0: number, y0: number, sh: Size): { x: number; y: number } => {
    const r = inkR(sh);
    let x = x0;
    let y = y0;
    if (!judge(x + r.x, y + r.y, r.w, r.h)) return { x, y };
    const keepAiry = gradeAiry;
    const keepRoomy = gradeRoomy;
    const keepCrossing = gradeCrossing;
    for (let round = 0; round < 8; round += 1) {
      const ix = x + r.x;
      const iy = y + r.y;
      const right = measuredTo.x + measuredTo.w;
      const below = measuredTo.y + measuredTo.h;
      const dx = Math.max(0, ix - right, measuredTo.x - (ix + r.w));
      const dy = Math.max(0, iy - below, measuredTo.y - (iy + r.h));
      if (dx < 0.05 && dy < 0.05) break;
      const mx = ix > right ? -1 : ix + r.w < measuredTo.x ? 1 : 0;
      const my = iy > below ? -1 : iy + r.h < measuredTo.y ? 1 : 0;
      let moved = false;
      for (const t of PULLS) {
        const nx = x + mx * dx * t;
        const ny = y + my * dy * t;
        if (!onBoard(nx, ny, sh)) continue;
        if (!judge(nx + r.x, ny + r.y, r.w, r.h)) continue;
        if ((keepAiry && !gradeAiry) || (keepRoomy && !gradeRoomy) || gradeCrossing > keepCrossing)
          continue;
        x = nx;
        y = ny;
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return { x, y };
  };
  /** The same mark, pulled as close to what it names as the laws allow. */
  const closer = (had: WrittenFit, s: Shape): WrittenFit => {
    const to = pullIn(had.box.x, had.box.y, s.shape);
    if (to.x === had.box.x && to.y === had.box.y) return had;
    return fit({ x: to.x, y: to.y, w: had.box.w, h: had.box.h }, s);
  };
  const fit = (box: BoardRect, s: Shape): WrittenFit => {
    const ink = inkIn(box, s.shape);
    const gap = boxGap(ink, measuredTo);
    return {
      box,
      ink,
      size: s.size,
      maxWidth: s.maxWidth,
      gap,
      withinReach: gap <= law + 1e-9,
      inside: gap === 0,
    };
  };

  /**
   * 1 — INSIDE THE REACH AND CLEAR. Every lawful candidate is graded, and the best grade wins:
   *     inside the aim before inside the law; air at its aim before air at its law; the least of
   *     any reserved zone taken; the earlier shape; the roomier clearance from drawn things; the
   *     earlier position.
   */
  let best: WrittenFit | null = null;
  /** The grade in hand, as its six places: no array is made to hold one candidate's score. */
  let bestAim = 0;
  let bestAiry = 0;
  let bestCrossing = 0;
  let bestShape = 0;
  let bestRoomy = 0;
  let bestAt = 0;
  /**
   * THE SEARCH STOPS WHEN NOTHING LEFT CAN WIN, which is not the same as stopping early.
   *
   * The grade's fourth place is the shape's own index, largest shape first, so a later shape can
   * only beat what is already held by being better on one of the three places BEFORE it — inside
   * the aim, airy, and clear of every reserved zone. Once a candidate holds all three, the first
   * three places are at their floor and every shape still to be tried is worse on the fourth: the
   * remainder of the search cannot change the answer, and the only thing running it buys is time.
   * Within the shape in hand the same argument closes one place further down: a candidate that is
   * also roomy leaves only the position index, and the positions are visited in order, so the one
   * in hand is the earliest. That is the whole of the exit — the answer is bit for bit the answer
   * the exhaustive walk gave, on all sixteen boards at both widths, and the plant cell, punnett,
   * quadratic, timeline and map stopped paying for a walk whose result they already had.
   */
  for (let si = 0; si < shapes.length; si += 1) {
    const s = shapes[si] as Shape;
    const r = inkR(s.shape);
    const { xs, ys, gaps, n } = writtenCandidates(
      bases,
      s.shape,
      ring,
      law,
      solve.at,
      allowInside,
      solve.nudge,
      measuredTo,
    );
    for (let ci = 0; ci < n; ci += 1) {
      const x = xs[ci] as number;
      const y = ys[ci] as number;
      if (!onBoard(x, y, s.shape)) continue;
      if (!judge(x + r.x, y + r.y, r.w, r.h)) continue;
      const kAim = (gaps[ci] as number) <= aim + 1e-9 ? 0 : 1;
      const kAiry = gradeAiry ? 0 : 1;
      const kCrossing = gradeCrossing;
      const kRoomy = gradeRoomy ? 0 : 1;
      const takes =
        best === null ||
        kAim < bestAim ||
        (kAim === bestAim &&
          (kAiry < bestAiry ||
            (kAiry === bestAiry &&
              (kCrossing < bestCrossing ||
                (kCrossing === bestCrossing &&
                  (si < bestShape ||
                    (si === bestShape &&
                      (kRoomy < bestRoomy || (kRoomy === bestRoomy && ci < bestAt)))))))));
      if (takes) {
        best = fit({ x, y, w: s.shape.w, h: s.shape.h }, s);
        bestAim = kAim;
        bestAiry = kAiry;
        bestCrossing = kCrossing;
        bestShape = si;
        bestRoomy = kRoomy;
        bestAt = ci;
      }
      if (kAim === 0 && kAiry === 0 && kCrossing === 0 && kRoomy === 0) break;
    }
    if (best !== null && bestAim === 0 && bestAiry === 0 && bestCrossing === 0) break;
  }
  if (best) return bestAim === 0 ? best : closer(best, shapes[bestShape] as Shape);

  /**
   * 2 — NOTHING INSIDE THE REACH IS CLEAR. "Never over the text it explains" is the same craft
   *     sentence as "within 24 px of its subject", and of the two, writing ON the working is the
   *     one a learner cannot read past — so the search widens and takes the NEAREST clear spot,
   *     and says `withinReach: false` about it. A reportable exception, not a silent drift.
   */
  for (const times of ESCAPE_REACH) {
    let nearest: WrittenFit | null = null;
    for (const s of shapes) {
      const r = inkR(s.shape);
      const { xs, ys, gaps, n } = writtenCandidates(
        bases,
        s.shape,
        ring,
        law * times,
        solve.at,
        allowInside,
        solve.nudge,
        measuredTo,
      );
      for (let ci = 0; ci < n; ci += 1) {
        // The crowd test is the expensive one, and a spot no nearer than the one in hand could
        // not be taken even if it passed. The generator has already measured the distance to
        // decide the spot was inside the widened reach at all; read it, and judge only what can
        // win.
        if (nearest && (gaps[ci] as number) >= nearest.gap) continue;
        const x = xs[ci] as number;
        const y = ys[ci] as number;
        if (!onBoard(x, y, s.shape)) continue;
        if (!judge(x + r.x, y + r.y, r.w, r.h)) continue;
        const candidate = fit({ x, y, w: s.shape.w, h: s.shape.h }, s);
        if (!nearest || candidate.gap < nearest.gap) nearest = candidate;
      }
    }
    if (nearest) return nearest;
  }

  /**
   * 3 — NOTHING IS CLEAR ANYWHERE. Beside the subject and a little crowded, at the smallest
   *     shape, beats out of sight — and crowding a drawn stroke beats crowding writing, always.
   */
  let least: { cost: number; fit: WrittenFit } | null = null;
  const last = shapes[shapes.length - 1] as Shape;
  for (const s of [last, ...shapes]) {
    const { xs, ys, n } = writtenCandidates(
      bases,
      s.shape,
      ring,
      law,
      solve.at,
      allowInside,
      solve.nudge,
      measuredTo,
    );
    for (let ci = 0; ci < n; ci += 1) {
      const box = { x: xs[ci] as number, y: ys[ci] as number, w: s.shape.w, h: s.shape.h };
      const ink = inkIn(box, s.shape);
      let cost = contains(bounds, box) ? 0 : 1e9;
      for (const o of others) {
        const over = overlapArea(o.written ? padBy(ink, air) : ink, o);
        cost += o.written ? over * 1e3 : over;
      }
      if (!least || cost < least.cost) least = { cost, fit: fit(box, s) };
    }
  }
  if (least) return (least as { fit: WrittenFit }).fit;
  const box = { x: solve.subject.x, y: solve.subject.y + solve.subject.h + solve.margin, ...last.shape };
  return fit({ x: box.x, y: box.y, w: box.w, h: box.h }, last);
}

function padBy(box: BoardRect, pad: number): BoardRect {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}
