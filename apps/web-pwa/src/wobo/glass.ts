/**
 * The app's glass (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
 *
 * One read per turn: `takeGlass` walks the page through `readGlass` (packages/wobo/src/glass)
 * with what the app knows, which is Wobo's own layers to ignore, the sheets that occlude, the
 * things a screen still registers because they have no element of their own (a photo's lines, a
 * paused frame's parts), the question, and the focus. The read is kept: the hand traces every mark
 * from `rectOf` on its live handle, a resize or a theme flip re-measures the same ids, and a note
 * asks for the lines near its subject so it lands in the margin.
 *
 * Nothing here registers anything. A component may label a thing (`useRegisterTarget`, or a
 * `data-glass` attribute from the content model); the map is read off the page either way.
 */

import {
  DEFAULT_IGNORE,
  type GlassBox,
  type GlassEntry,
  type GlassMap,
  type GlassRead,
  type GlassRegistered,
  glassHold,
  readGlass,
  type SurfaceTarget,
  surfaceRegistry,
  watchGlass,
} from '@wobo/wobo';

/** The renderer's target: an id and a live rect (`BoardTarget` in packages/wobo/src/board). */
export interface GlassTarget {
  id: string;
  getRect: () => DOMRect | null;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * WOBO'S OWN SURFACES ARE NEVER ON THE GLASS, and the app says so by construction: every surface
 * Wobo owns carries `data-wobo-surface` at its root (Companion's sheet, orb, lean-in and note;
 * the plane and the full board; the ink; the gesture layer; the flag pill; the ceremony toast),
 * and the reader skips the subtree. There is no list of Wobo's copy here to fall out of date — a
 * renamed button stays off the glass because the mark is on the element, not in a string.
 *
 * The adversary's lab (2026-09-08) found the learner's own bubble ringed on fifteen of twenty-three
 * course turns because the companion's lines were on the map, and the lasso's hidden announcement
 * ringed in the corner of the page on fourteen of eighteen world turns.
 */
export const IGNORE: readonly string[] = DEFAULT_IGNORE;

/**
 * The page's own furniture: a header, a nav, a footer. On the glass, but rarely what a question is
 * about, so the lesson's own lines win the map when the bytes run short. Wobo's own controls are
 * not here — they are not on the glass at all.
 */
const CHROME: readonly string[] = [
  'header',
  'nav',
  'footer',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

/** A note may not land on a line this close to the thing it is about, in CSS px. */
const NOTE_REACH_PX = 220;

let current: GlassRead | null = null;
let stopWatch: (() => void) | null = null;

// ONE REGISTRY (docs/INK-FREEZE-PLAN-TRACE.md §4): the registry lends the last read's entries as
// the page's targets, with their live measure and element, so the gestures, the hands and the
// focus resolve against what is on the glass. It keeps by hand only what has no element of its
// own (a photo's lines, a paused frame's parts, the plane). Nothing mirrors the bus any more.
// Before the first turn there is no read, so one is taken on demand: a lasso on a fresh page
// resolved nothing at all (the lab's fourteen world turns) because nothing had read the page.
let taking = false;
surfaceRegistry.readGlass(() => {
  if (!current && !taking) {
    taking = true;
    try {
      takeGlass();
    } finally {
      taking = false;
    }
  }
  return current;
});

/** The page changed under the read (a route change): the next reader takes a fresh one. */
export function forgetGlass(): void {
  stopWatch?.();
  stopWatch = null;
  current = null;
}

/** The registry targets a reader is lent: everything with a live rect, element where there is one. */
export function registeredOf(targets: readonly SurfaceTarget[]): GlassRegistered[] {
  return targets.map((t) => {
    let words: string | undefined;
    try {
      words = t.text?.() || undefined;
    } catch {
      words = undefined;
    }
    return {
      id: t.id,
      kind: t.kind,
      label: t.label,
      ...(words ? { text: words } : {}),
      ...(t.description ? { meaning: t.description } : {}),
      rect: () => {
        try {
          return t.rect();
        } catch {
          return null;
        }
      },
      ...(t.element ? { element: t.element } : {}),
    };
  });
}

export interface TakeGlassOptions {
  question?: string;
  route?: string;
  focusId?: string | null;
}

function themeNow(): 'light' | 'dark' | undefined {
  if (typeof document === 'undefined') return undefined;
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'dark' || set === 'light') return set;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return undefined;
}

function reducedNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Read the glass for this turn. The previous read is replaced; its handles are no longer
 * re-measured. Ink that is still holding from the last question keeps tracing from the new read,
 * because the ids are stable across reads.
 */
export function takeGlass(options: TakeGlassOptions = {}): GlassMap {
  stopWatch?.();
  stopWatch = null;
  const theme = themeNow();
  const reduced = reducedNow();
  const read = readGlass({
    ignore: IGNORE,
    chrome: CHROME,
    registered: registeredOf(surfaceRegistry.ownTargets()),
    // The freeze may scroll the thing the question names onto the glass before it reads, and it
    // does so only on a turn that HAS frozen — the hold is taken before the read (the law's
    // Freeze). A read taken to decide what kind of turn this is, or to ground a plain spoken
    // answer, never moves the page under the learner.
    scroll: glassHold.held,
    ...(options.question ? { question: options.question } : {}),
    ...(options.route ? { route: options.route } : {}),
    ...(options.focusId ? { focusId: options.focusId } : {}),
    ...(theme ? { theme } : {}),
    ...(reduced ? { reduced: true } : {}),
  });
  current = read;
  stopWatch = watchGlass(read);
  return read.map;
}

/** The map of the last read, or null before the first turn. */
export function currentGlass(): GlassMap | null {
  return current?.map ?? null;
}

/** Wholly above, below or beside the viewport: nothing of it shows. Half in is on the glass. */
export function offGlass(box: GlassBox, vp: { w: number; h: number }): boolean {
  const [x, y, w, h] = box;
  return x + w <= 0 || y + h <= 0 || x >= vp.w || y >= vp.h;
}

/**
 * Bring one entry into view by id. The FREEZE does this for itself now — a held read scrolls the
 * thing the question names onto the glass and walks the settled page again (readGlass's
 * `scrollTarget`) — so this only ever fires for an id a caller found some other way, and it
 * answers false for everything already on the glass. A programmatic scroll is not a finger; the
 * hold lets it through. True when the page moved, so the caller re-reads.
 */
export function bringOntoGlass(id: string): boolean {
  const read = current;
  if (!read || typeof window === 'undefined') return false;
  const box = read.rectOf(id);
  if (!box) return false;
  const vp = { w: window.innerWidth, h: window.innerHeight };
  if (!offGlass(box, vp)) return false;
  const element = read.elementOf(id);
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  } else {
    window.scrollBy({ top: box[1] + box[3] / 2 - vp.h / 2, behavior: 'auto' });
  }
  return true;
}

/** The live box of one entry on the last read, in CSS px, or null once it has left the glass. */
export function glassRectOf(id: string): DOMRect | null {
  const box = current?.rectOf(id);
  return box ? toDomRect(box) : null;
}

function toDomRect(box: readonly [number, number, number, number]): DOMRect {
  const [x, y, w, h] = box;
  if (typeof DOMRect === 'function') return new DOMRect(x, y, w, h);
  return { x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h } as DOMRect;
}

/**
 * The targets the hand traces from: every entry on the map with its live measure, then whatever
 * the registry still holds under an id the map does not (a target that scrolled off before the
 * read, a plane, a frame). The glass's own measure wins for an id on the map.
 */
export function mergeTargets(
  map: GlassMap | null,
  rectOf: (id: string) => readonly [number, number, number, number] | null,
  registry: readonly { id: string; rect: () => RectLike | null }[],
): GlassTarget[] {
  const out: GlassTarget[] = [];
  const seen = new Set<string>();
  for (const entry of map?.entries ?? []) {
    seen.add(entry.id);
    out.push({
      id: entry.id,
      getRect: () => {
        const box = rectOf(entry.id);
        return box ? toDomRect(box) : null;
      },
    });
  }
  for (const target of registry) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    out.push({
      id: target.id,
      getRect: () => {
        let rect: RectLike | null = null;
        try {
          rect = target.rect();
        } catch {
          rect = null;
        }
        return rect ? toDomRect([rect.x, rect.y, rect.width, rect.height]) : null;
      },
    });
  }
  return out;
}

/** The renderer's lookup, live. */
export function glassTargets(): readonly GlassTarget[] {
  return mergeTargets(
    current?.map ?? null,
    (id) => current?.rectOf(id) ?? null,
    surfaceRegistry.ownTargets(),
  );
}

/** The page's text lines within a note's reach of a subject, as boxes on the last read. */
export function linesNear(map: GlassMap | null, near: RectLike): RectLike[] {
  const out: RectLike[] = [];
  const top = near.y - NOTE_REACH_PX;
  const bottom = near.y + near.height + NOTE_REACH_PX;
  for (const entry of map?.entries ?? []) {
    if (!isText(entry)) continue;
    const [x, y, w, h] = entry.box;
    if (y + h < top || y > bottom) continue;
    out.push({ x, y, width: w, height: h });
  }
  return out;
}

function isText(entry: GlassEntry): boolean {
  return (
    entry.role === 'line' ||
    entry.role === 'heading' ||
    entry.role === 'step' ||
    entry.role === 'photo-line'
  );
}

/** The renderer's `avoid`: the lines near a subject, re-measured on the live handles. */
export function glassLinesNear(near: RectLike): readonly RectLike[] {
  const read = current;
  if (!read) return [];
  const live = read.map.entries.flatMap((e) => {
    if (!isText(e)) return [];
    const box = read.rectOf(e.id);
    return box ? [{ ...e, box }] : [];
  });
  return linesNear({ ...read.map, entries: live }, near);
}

/** The most the read waits for the fold to finish before it gives up and reads anyway. */
const SETTLE_MS = 400;
/** Narrower than this and the sheet is a modal over the page, so it folds (wobo/fold.ts). */
const PHONE_PX = 720;

function frame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** The companion sheet, by its own mark rather than by its accessible name. */
function sheetNow(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-wobo-sheet]');
}

/** The sheet's box this frame, as the number the fold changes: its top and its height. */
function sheetBox(sheet: Element | null): string | null {
  if (!sheet) return null;
  const r = sheet.getBoundingClientRect();
  return `${Math.round(r.y)}x${Math.round(r.height)}`;
}

/**
 * THE FOLD IS SETTLED BEFORE THE READ (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
 *
 * React commits in a frame; the fold does not. The sheet's height is a motion style driven on the
 * animation library's own loop, so two rAFs read a HALF-folded page: at 390 the map still carried
 * the learner's bubble at its unfolded y and the ring landed on that ghost (the adversary's lab,
 * 2026-09-08, `held.png` at 390). So the read waits for the fold to FINISH — not for a count of
 * frames, but for the sheet's own box to stop moving: two frames with the same top and the same
 * height, and, while the glass is held on a phone, the strip actually committed. Capped, so a
 * sheet that never settles cannot hold the brain.
 */
export async function nextLayout(): Promise<void> {
  await frame();
  await frame();
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const started = now();
  let last: string | null = null;
  let stable = 0;
  while (now() - started < SETTLE_MS) {
    const sheet = sheetNow();
    if (!sheet) return;
    // Held, on a phone, with the sheet open: the fold is not even begun until the strip is
    // committed, whatever the box says this frame.
    const folding =
      glassHold.held && window.innerWidth < PHONE_PX && !sheet.hasAttribute('data-glass-strip');
    const box = sheetBox(sheet);
    stable = !folding && box !== null && box === last ? stable + 1 : 0;
    last = box;
    if (stable >= 2) return;
    await frame();
  }
}

/**
 * The inspector a lab reads the glass through (`window.__woboGlassRead`): the map, a fresh take,
 * and the hold's state. Not in a production bundle.
 */
export interface GlassInspector {
  take: (options?: TakeGlassOptions) => GlassMap;
  current: () => GlassMap | null;
  rectOf: (id: string) => DOMRect | null;
  hold: () => ReturnType<typeof glassHold.get>;
  /** Wait for the fold to finish, exactly as a turn does before it reads. */
  settle: () => Promise<void>;
  /** True when the last read scrolled the thing the question named onto the glass. */
  scrolled: () => boolean;
  /** Take the glass by hand, as a turn would, so the freeze can be watched without a brain. */
  freeze: (reason?: string) => void;
  release: (why?: 'escape' | 'tap' | 'voice' | 'end') => void;
}

declare global {
  interface Window {
    __woboGlassRead?: GlassInspector;
  }
}

if (typeof window !== 'undefined' && import.meta.env?.MODE !== 'production') {
  window.__woboGlassRead = {
    take: takeGlass,
    current: currentGlass,
    rectOf: glassRectOf,
    hold: () => glassHold.get(),
    settle: nextLayout,
    scrolled: () => current?.scrolled ?? false,
    freeze: (reason) => glassHold.hold(reason ?? 'lab'),
    release: (why) => glassHold.release(why ?? 'end'),
  };
}
