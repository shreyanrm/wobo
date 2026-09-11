'use client';

/**
 * The photo as a surface — the doubt solver's half of the registry law (owner, 2026-09-05:
 * "they can upload or take a photo of their book ... and wobo can annotate on that and explain").
 *
 * Everything we render is registered, never photographed; a photo of a page is the one thing in
 * the product with no structure of its own. This module gives it some. The gateway's reading
 * (services/gateway doubt.py) returns LINES — each with a box in fractions of the upright page and
 * an id (`r1`, `r2`, ...) — and its board turn anchors ink to those ids: `{ target: "r2" }` on the
 * surface `doubt:<id>`. So each line becomes a target on that surface, with the SAME id the gateway
 * used and a live `rect()` that maps the page box through the photo's rendered content rect. The
 * target survives zoom, rotation and resize exactly as a button on a screen does, and the stage's
 * fixed screen surface (which reads `surfaceRegistry.getTargets()`) lands the ink on the photo with
 * no change to the renderer or to the registry's own file: this CONSUMES the registry.
 *
 * A region from a vision model is approximate. So ink circles a region rather than pointing at a
 * pixel, and `offPageStrokes` measures the failure case: a mark that resolves outside the page.
 *
 * The owner's second law for the feature lives here too, as a check over recorded frames: "it
 * shouldnt just draw on the image, it should explain while drawing on that photo". `checkBeats`
 * holds that every ink frame on the photo lands inside the window of a say frame. Pure, so the
 * harness can hold a real turn's frame order to it.
 */

import type { Rect, SurfaceDefinition, SurfaceRegistry, SurfaceTarget } from '@wobo/wobo';
import type { BoardDone, BoardTurnHandlers } from './board-stream';

// --- Regions -------------------------------------------------------------------------------------

/** A box on the page as photographed, in fractions of the upright image. */
export interface PageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One thing vision found on the page: where it is and what it says. */
export interface DoubtRegion {
  /** The gateway's own line id — the ink anchors to this string, so it is never rewritten. */
  id: string;
  /** What Wobo calls it. */
  label: string;
  /** The text read inside it, verbatim. Empty for a figure. */
  text: string;
  box: PageBox;
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Where the photo's pixels are on screen right now: the rendered image's content rect (after
 * `object-fit: contain` letterboxing and after rotation) in viewport px, and the rotation applied.
 */
export interface PhotoFrame {
  rect: Rect;
  rotation: Rotation;
}

/** The registry surface of one photo: `doubt:<id>`, as the gateway names it in its own packet. */
export const DOUBT_SURFACE_PREFIX = 'doubt:';

export function doubtSurfaceId(photoId: string): string {
  return `${DOUBT_SURFACE_PREFIX}${photoId}`;
}

/**
 * The registry id of a region target. It IS the gateway's line id: the ink frames say
 * `{ target: "r2" }` and nothing on the way may rename it. The photo id is taken so a call site
 * reads as what it is, and so the seam is one function should the gateway ever namespace them.
 */
export function regionTargetId(_photoId: string, regionId: string): string {
  return regionId;
}

/**
 * The content rect of an image drawn with `object-fit: contain` inside `box`, with `rotation`
 * applied to the image first. A quarter turn swaps the natural width and height.
 */
export function contentRect(
  box: Rect,
  natural: { width: number; height: number },
  rotation: Rotation,
): Rect {
  const turned = rotation === 90 || rotation === 270;
  const w = turned ? natural.height : natural.width;
  const h = turned ? natural.width : natural.height;
  if (w <= 0 || h <= 0 || box.width <= 0 || box.height <= 0) {
    return { x: box.x, y: box.y, width: 0, height: 0 };
  }
  const scale = Math.min(box.width / w, box.height / h);
  const width = w * scale;
  const height = h * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** An upright normalised point, rotated clockwise by `rotation` into rendered normalised space. */
function turnPoint(u: number, v: number, rotation: Rotation): [number, number] {
  switch (rotation) {
    case 90:
      return [1 - v, u];
    case 180:
      return [1 - u, 1 - v];
    case 270:
      return [v, 1 - u];
    default:
      return [u, v];
  }
}

/** The viewport rect a region occupies inside the rendered photo right now. */
export function regionRect(region: Pick<DoubtRegion, 'box'>, frame: PhotoFrame): Rect {
  const { box } = region;
  const corners = [
    turnPoint(box.x, box.y, frame.rotation),
    turnPoint(box.x + box.w, box.y, frame.rotation),
    turnPoint(box.x, box.y + box.h, frame.rotation),
    turnPoint(box.x + box.w, box.y + box.h, frame.rotation),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const { rect } = frame;
  return round({
    x: rect.x + left * rect.width,
    y: rect.y + top * rect.height,
    width: (right - left) * rect.width,
    height: (bottom - top) * rect.height,
  });
}

/** Sub-pixel noise out of the four multiplications, so a test can say `toEqual`. */
function round(r: Rect): Rect {
  const k = (n: number) => Math.round(n * 1000) / 1000;
  return { x: k(r.x), y: k(r.y), width: k(r.width), height: k(r.height) };
}

// --- One measurement: the thumb's band and the ink's box are not the same box ---------------------

/** The thumb's floor: nothing a learner has to press is smaller than this (WCAG 2.5.8, and hands). */
export const MIN_HIT_PX = 44;

/**
 * How far a line's pressable area may reach past the line itself, on each side, in px.
 */
export interface Reach {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where one line of the page sits, and how far a thumb may miss it by. */
export interface RegionPlacement {
  id: string;
  /** The line's own box, exactly as `regionRect` resolves it — what the ink anchors to. */
  box: Rect;
  /** The pressable area, past the box's edges. Never smaller than the box. */
  reach: Reach;
}

/**
 * WHY THESE ARE TWO BOXES AND NOT ONE (the adversary, wave 57, finding 1).
 *
 * A line of a photographed page is about seven pixels tall at 390. A thumb is forty-four. Until
 * 2026-09-11 the region BUTTON was grown to the thumb's floor and the button's box was therefore
 * what the glass walk read (`readGlass` reads a registered target's own element by identity), so
 * the ink resolved `{target: "r2"}` to a 44 px slab centred on a 7 px line. Live at 390 that drew
 * one ellipse and one struck cross across lines 1 to 3 together, over a caption that named two of
 * them: "the marks sprawl across the whole page instead of on the two lines they name". `offPage`
 * read 0 throughout, because a slab inside the photo is inside the photo.
 *
 * So the line keeps its own box — the button IS the line, and the glass, the registry and the pen
 * all read the same rect — and the thumb gets a band around it, painted by a pseudo-element that
 * has no box of its own on the glass (`doubt.css`, `.db-region::after`).
 *
 * THE BAND NEVER STEALS A NEIGHBOUR'S TAP. Six lines thirteen pixels apart, each grown to 44,
 * overlap three ways and the topmost in the DOM wins — tapping line 2 lit line 6. A band stops at
 * the halfway line to the next line's centre, so the page is partitioned: every tap goes to the
 * line nearest it, and no tap is lost between two of them.
 */
export function placeRegions(
  regions: readonly Pick<DoubtRegion, 'id' | 'box'>[],
  frame: PhotoFrame,
  options: { minHit?: number; bounds?: Rect } = {},
): RegionPlacement[] {
  const minHit = options.minHit ?? MIN_HIT_PX;
  const boxes = regions.map((region) => regionRect(region, frame));
  const centreY = boxes.map((b) => b.y + b.height / 2);
  const order = boxes.map((_, i) => i).sort((a, b) => (centreY[a] as number) - (centreY[b] as number));
  const limitUp = new Array<number>(boxes.length).fill(Number.NEGATIVE_INFINITY);
  const limitDown = new Array<number>(boxes.length).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < order.length; i += 1) {
    const here = order[i] as number;
    const above = i > 0 ? (order[i - 1] as number) : null;
    const below = i < order.length - 1 ? (order[i + 1] as number) : null;
    if (above !== null) {
      limitUp[here] = ((centreY[above] as number) + (centreY[here] as number)) / 2;
    }
    if (below !== null) {
      limitDown[here] = ((centreY[here] as number) + (centreY[below] as number)) / 2;
    }
  }
  const bounds = options.bounds;
  return regions.map((region, i) => {
    const box = boxes[i] as Rect;
    const cy = centreY[i] as number;
    const cx = box.x + box.width / 2;
    const half = Math.max(box.height, minHit) / 2;
    const halfX = Math.max(box.width, minHit) / 2;
    // Never inside the line, never past the halfway line to a neighbour, never off the photo.
    const top = clamp(cy - half, limitUp[i] as number, box.y, bounds ? bounds.y : undefined, 'min');
    const bottom = clamp(
      cy + half,
      limitDown[i] as number,
      box.y + box.height,
      bounds ? bounds.y + bounds.height : undefined,
      'max',
    );
    const left = clamp(
      cx - halfX,
      Number.NEGATIVE_INFINITY,
      box.x,
      bounds ? bounds.x : undefined,
      'min',
    );
    const right = clamp(
      cx + halfX,
      Number.POSITIVE_INFINITY,
      box.x + box.width,
      bounds ? bounds.x + bounds.width : undefined,
      'max',
    );
    return {
      id: region.id,
      box,
      reach: {
        top: round1(box.y - top),
        bottom: round1(bottom - (box.y + box.height)),
        left: round1(box.x - left),
        right: round1(right - (box.x + box.width)),
      },
    };
  });
}

/**
 * One edge of a band: the wanted position, held off the neighbour's half-way line and off the
 * photo's edge, and never allowed inside the line itself.
 */
function clamp(
  wanted: number,
  limit: number,
  own: number,
  edge: number | undefined,
  side: 'min' | 'max',
): number {
  let value = side === 'min' ? Math.max(wanted, limit) : Math.min(wanted, limit);
  if (edge !== undefined) value = side === 'min' ? Math.max(value, edge) : Math.min(value, edge);
  return side === 'min' ? Math.min(value, own) : Math.max(value, own);
}

const round1 = (n: number): number => Math.round(n * 1000) / 1000;

// --- The probe that would have caught it: a mark on the line it names ------------------------------

export interface StrayMark {
  id: string;
  target: string;
  why: 'off its line' | 'over another line' | 'unknown target';
  /** The other line this mark covers, when that is what is wrong with it. */
  over?: string;
}

/**
 * EVERY MARK SITS ON THE LINE IT NAMES (docs/INK-FOUR.md, craft; the adversary, wave 57).
 *
 * `offPageStrokes` asks whether a mark is inside the photo, and a mark drawn across the whole
 * photograph passes that: live at 390 one ellipse and one struck cross covered lines 1 to 3
 * together while `offPage` read 0. This asks the question a learner actually asks of the ink —
 * *which line is it about?* — off the marks' real boxes on the glass. Two ways to fail it:
 *
 * · **off its line** — the line it names is further than a note's reach away, so the mark is not
 *   about anything a learner can see it against.
 * · **over another line** — it swallows a line it does not name. A ring that covers most of the
 *   line above and the line below says nothing about which of the three is wrong, whatever the
 *   caption says. This is the one the sprawl fails, and the one nothing measured.
 *
 * NEARNESS, NOT CONTAINMENT, AND NO NEAREST-LINE TEST. An underline sits UNDER its line and a
 * note beside it, so a mark never has to contain what it is about. Nor can the nearest line
 * decide: at 390 a photographed page's lines are thirteen pixels apart, an underline lands in the
 * gap between two of them, and nearest-centre is then a coin toss. What is not a coin toss is
 * whether the mark reaches its own line and whether it swallows a different one — and a mark that
 * rang the wrong line covers that wrong line, so the second rule catches it. `reach` is how far a
 * mark may sit from its own line (24 px, the note law's own number) and `share` how much of
 * another line it has to cover before it is over that line rather than reaching past it.
 */
export function strayMarks(
  marks: readonly { id: string; target: string; rect: Rect }[],
  lines: readonly { id: string; rect: Rect }[],
  options: { share?: number; reach?: number } = {},
): StrayMark[] {
  const share = options.share ?? 0.6;
  const reach = options.reach ?? 24;
  const by = new Map(lines.map((l) => [l.id, l.rect]));
  const out: StrayMark[] = [];
  for (const mark of marks) {
    const own = by.get(mark.target);
    if (!own) {
      out.push({ id: mark.id, target: mark.target, why: 'unknown target' });
      continue;
    }
    if (gap(mark.rect, own) > reach) {
      out.push({ id: mark.id, target: mark.target, why: 'off its line' });
      continue;
    }
    const swallowed = lines.find(
      (line) => line.id !== mark.target && covered(mark.rect, line.rect) >= share,
    );
    if (swallowed) {
      out.push({ id: mark.id, target: mark.target, why: 'over another line', over: swallowed.id });
    }
  }
  return out;
}

/** How far two boxes are apart, in px; 0 where they overlap or touch. */
function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}

/** How much of `line` lies inside `mark`, as a share of the line's own area. */
function covered(mark: Rect, line: Rect): number {
  const area = line.width * line.height;
  if (area <= 0) return 0;
  const w = Math.max(0, Math.min(mark.x + mark.width, line.x + line.width) - Math.max(mark.x, line.x));
  const h = Math.max(
    0,
    Math.min(mark.y + mark.height, line.y + line.height) - Math.max(mark.y, line.y),
  );
  return (w * h) / area;
}

/**
 * The surface definition for one photo. `frame` is read at resolve time, never cached: the photo
 * can be zoomed, turned or re-laid-out between two reads and the target has to be where the pixels
 * are now. Register it with `surfaceRegistry.registerSurface` (or `useSurface`).
 */
export function photoSurface(
  photoId: string,
  regions: readonly DoubtRegion[],
  frame: () => PhotoFrame | null,
  options: { reading?: string; element?: (regionId: string) => Element | null } = {},
): SurfaceDefinition {
  const targets: SurfaceTarget[] = regions.map((region) => ({
    id: regionTargetId(photoId, region.id),
    kind: 'photo-region',
    label: region.label,
    description: region.text ? `reads: ${region.text}` : undefined,
    rect: () => {
      const f = frame();
      return f ? regionRect(region, f) : null;
    },
    element: options.element ? () => options.element?.(region.id) ?? null : undefined,
    text: () => region.text,
    priority: 1,
  }));
  return {
    id: doubtSurfaceId(photoId),
    title: 'the photo the learner took of their doubt',
    description: options.reading ? `Wobo read it as: ${options.reading}` : undefined,
    targets,
    priority: 10,
  };
}

/** Register and hand back the unregister — for code that is not a component. */
export function registerPhotoSurface(
  registry: SurfaceRegistry,
  photoId: string,
  regions: readonly DoubtRegion[],
  frame: () => PhotoFrame | null,
  options?: { reading?: string },
): () => void {
  return registry.registerSurface(photoSurface(photoId, regions, frame, options));
}

// --- Law 3, measured: a stroke that lands off the page --------------------------------------------

export interface OffPageStroke {
  id: string;
  why: 'unknown target' | 'off the page';
}

/**
 * Every object anchored to a photo region whose resolved rect (plus its pad, in px) falls outside
 * the page's rect. Objects anchored elsewhere (board space, another object, a target of some other
 * screen when `targets` names the photo's) are not the photo's to judge and are skipped; a target
 * the reading never had is a failure of its own. `resolve` reads a target's live rect — the
 * registry's own `rect()`.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT. Containment: that a mark sits inside the photo. A
 * region's rect is built from a box in page fractions (0..1), so it is inside the photo by
 * construction, and only an unknown target or a pad past the edge can fail here. Whether a box sits
 * on the RIGHT line (a vision box that drifted onto the line above) is measured by nothing on
 * either side; the learner sees it on the confirm step, where focusing a line lights its box on
 * the photo, and that is the only check there is.
 */
export function offPageStrokes(
  objects: readonly { id: string; anchor?: unknown; pad?: number }[],
  resolve: (targetId: string) => Rect | null,
  page: Rect,
  options: { padPx?: number; targets?: ReadonlySet<string> } = {},
): OffPageStroke[] {
  const out: OffPageStroke[] = [];
  for (const object of objects) {
    const anchor = object.anchor as { target?: unknown } | undefined;
    const target = typeof anchor?.target === 'string' ? anchor.target : null;
    if (!target) continue;
    if (options.targets && !options.targets.has(target)) {
      out.push({ id: object.id, why: 'unknown target' });
      continue;
    }
    const rect = resolve(target);
    if (!rect) {
      out.push({ id: object.id, why: 'unknown target' });
      continue;
    }
    const pad = (object.pad ?? 0) + (options.padPx ?? 0);
    const inside =
      rect.x - pad >= page.x &&
      rect.y - pad >= page.y &&
      rect.x + rect.width + pad <= page.x + page.width &&
      rect.y + rect.height + pad <= page.y + page.height;
    if (!inside) out.push({ id: object.id, why: 'off the page' });
  }
  return out;
}

// --- Law 5, measured: every stroke inside its sentence --------------------------------------------

export interface RecordedFrame {
  type: 'say' | 'ink' | 'ask' | 'action' | 'card' | 'done';
  /** Milliseconds on the utterance clock, as the wire carried it. */
  t: number;
  /** A say frame's spoken duration, when the gateway sent one. */
  dur?: number;
  text?: string;
  /** An ink frame's anchor target, when it anchors to one. */
  target?: string;
  id?: string;
}

/** The same estimate `speech.tsx` reads a line on: 60 ms a character, never under 900 ms. */
export function spokenMs(text: string): number {
  return Math.max(900, text.trim().length * 60);
}

export interface BeatReport {
  ok: boolean;
  /** Ink frames that landed with no sentence around them. */
  orphans: RecordedFrame[];
  inks: number;
  says: number;
}

/**
 * The owner's law as arithmetic: an ink frame is in a beat when some say frame's window
 * `[t, t + dur]` contains it. Held to it: ink anchored to a target (`targets`, when given, names
 * the photo's own), because a diagram built from scratch in board space is the board law's
 * business; `every: true` holds all ink.
 */
export function checkBeats(
  frames: readonly RecordedFrame[],
  options: { every?: boolean; targets?: ReadonlySet<string> } = {},
): BeatReport {
  const says = frames.filter((f) => f.type === 'say');
  const windows = says.map((s) => ({
    from: s.t,
    to: s.t + (s.dur ?? spokenMs(s.text ?? '')),
  }));
  const held = (f: RecordedFrame): boolean => {
    if (f.type !== 'ink') return false;
    if (options.every) return true;
    if (!f.target) return false;
    return options.targets ? options.targets.has(f.target) : true;
  };
  const inks = frames.filter(held);
  const orphans = inks.filter((ink) => !windows.some((w) => ink.t >= w.from && ink.t <= w.to));
  return { ok: orphans.length === 0, orphans, inks: inks.length, says: says.length };
}

/**
 * Handlers that record the frame order exactly as `dispatchFrame` delivers it, so a real turn can
 * be held to `checkBeats`. Spread them into the conductor's handlers, or use them alone.
 */
export function frameRecorder(): { handlers: BoardTurnHandlers; frames: () => RecordedFrame[] } {
  const frames: RecordedFrame[] = [];
  const handlers: BoardTurnHandlers = {
    onSay: (text, t, dur) =>
      frames.push({ type: 'say', t, text, ...(dur === undefined ? {} : { dur }) }),
    onInk: (event, t) => {
      const object = (event as { object?: { id?: unknown; anchor?: { target?: unknown } } }).object;
      const target = object?.anchor?.target;
      frames.push({
        type: 'ink',
        t,
        ...(typeof object?.id === 'string' ? { id: object.id } : {}),
        ...(typeof target === 'string' ? { target } : {}),
      });
    },
    onAsk: (prompt, _targets, t) => frames.push({ type: 'ask', t, text: prompt }),
    onAction: (_action, t) => frames.push({ type: 'action', t }),
    onCard: (_card, t) => frames.push({ type: 'card', t }),
    onDone: (_done: BoardDone) =>
      frames.push({ type: 'done', t: frames.length > 0 ? (frames.at(-1)?.t ?? 0) : 0 }),
  };
  return { handlers, frames: () => frames.slice() };
}

// --- The scroll holds during a stroke -------------------------------------------------------------

export interface StrokeHold {
  /** A stroke began and will take `durMs`; hold the page until it lands. */
  onStroke: (durMs: number) => void;
  dispose: () => void;
}

/**
 * One lock across overlapping strokes, released when the LAST of them ends. Pure of the DOM: the
 * screen hands in the lock (touch-action / overflow on the page) and a timer.
 */
export function strokeHold(deps: {
  lock: () => void;
  unlock: () => void;
  now: () => number;
  after: (ms: number, fn: () => void) => () => void;
}): StrokeHold {
  let until = 0;
  let held = false;
  let cancel: (() => void) | null = null;
  const release = () => {
    cancel = null;
    if (!held) return;
    held = false;
    deps.unlock();
  };
  return {
    onStroke(durMs) {
      const end = deps.now() + Math.max(0, durMs);
      if (!held) {
        held = true;
        deps.lock();
      }
      if (end <= until) return; // already holding past this stroke's end
      until = end;
      cancel?.();
      cancel = deps.after(until - deps.now(), release);
    },
    dispose() {
      cancel?.();
      release();
    },
  };
}

// --- Law 1's line ----------------------------------------------------------------------------------

/** What Wobo says before anything is computed. One sentence, a question, no dash of any kind. */
export function readingLine(reading: string): string {
  const clean = reading.replace(/\s+/g, ' ').replace(/[—–]/g, '-').trim();
  if (!clean) return 'I could not read anything on this page. Tell me what it says?';
  const ended = /[.?!]$/.test(clean);
  return `I read this as ${clean}${ended ? '' : '.'} Is that right?`;
}
