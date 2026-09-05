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
