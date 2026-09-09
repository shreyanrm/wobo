'use client';

/**
 * The gesture layer — Wobo's second sense (docs/WOBO-PLAN.md §1, docs/WOBO-TASKS.md §5.2).
 *
 * One transparent layer over the whole app. It watches for the six ways a learner points at
 * something — a text selection, a freehand circle with the cursor, resting the pointer on a thing,
 * a long press, a two-finger circle, and the hold-to-talk hotkey — and turns each into one
 * `FocusObject`: which registered targets are inside it, their text, their numbers, their rect and
 * their owning surface's live state.
 *
 * Three laws hold here. It never takes a screenshot of our own UI — every read goes through the
 * surface registry, at code level. Every gesture has a keyboard path: select with the keyboard,
 * then press the hotkey, and the chip that appears is a real button in the tab order. And it stays
 * quiet: `pointer-events: none` until a circle is actually being drawn, so the app underneath is
 * never blocked, and Escape always clears.
 */

import { frost, hairline, ink, radius, space, typeScale, ultramarine, zIndex } from '@wobo/config';
import { useReducedMotion } from '@wobo/motion';
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  anchorRectOf,
  boundsOf,
  createFocus,
  describeFocus,
  type FocusKind,
  type FocusObject,
  focusRectNow,
  isClosedLoop,
  normaliseText,
  ownerStateOf,
  owningSurface,
  type Point,
  pageScroll,
  pointInPolygon,
  rectCenter,
  simplifyPath,
  textOfTargets,
} from './focus';
import { inkRng } from './freehand';
import { type GlassTextRun, WOBO_OWN, joinTextRuns, textRunsOf } from './glass/read';
import { type Rect, type SurfaceRegistry, surfaceRegistry } from './registry';

// --- The hotkey ----------------------------------------------------------------------------------

export interface Hotkey {
  /** `KeyboardEvent.code`, e.g. `Space`. Preferred, because it survives layout changes. */
  code?: string;
  /** `KeyboardEvent.key`, matched case-insensitively when `code` is absent. */
  key?: string;
  alt?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** Hold to talk. Alt+Space by default; configurable, because Alt+Space is a window menu on Windows. */
export const DEFAULT_HOTKEY: Hotkey = { code: 'Space', alt: true };

/** True when the event is exactly this chord — every named modifier on, every unnamed one off. */
export function matchesHotkey(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'>,
  hotkey: Hotkey = DEFAULT_HOTKEY,
): boolean {
  if (hotkey.code !== undefined && event.code !== hotkey.code) return false;
  if (hotkey.code === undefined && hotkey.key !== undefined) {
    if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) return false;
  }
  return (
    event.altKey === Boolean(hotkey.alt) &&
    event.ctrlKey === Boolean(hotkey.ctrl) &&
    event.shiftKey === Boolean(hotkey.shift) &&
    event.metaKey === Boolean(hotkey.meta)
  );
}

/** Typing into a field is typing, never a gesture. */
export function isTypingTarget(node: EventTarget | null): boolean {
  const element = node as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return element.isContentEditable === true;
}

// --- Arming the lasso ----------------------------------------------------------------------------

let armed = false;
const armListeners = new Set<() => void>();

/**
 * Arm the freehand circle for the next drag. The orb calls this when the learner asks to circle
 * something; holding Alt while dragging does the same without a round trip.
 */
export function armLasso(on = true): void {
  if (armed === on) return;
  armed = on;
  for (const listener of armListeners) listener();
}

export function lassoArmed(): boolean {
  return armed;
}

function subscribeArmed(listener: () => void): () => void {
  armListeners.add(listener);
  return () => {
    armListeners.delete(listener);
  };
}

// --- Resolving a gesture into a focus object -----------------------------------------------------

/** Wobo's own surfaces, by the mark on their roots (packages/wobo/src/glass/read.ts). */
const WOBO_OWN_SELECTOR = WOBO_OWN.join(', ');

/**
 * The topmost element under the pointer that is the LEARNER'S PAGE.
 *
 * While a lasso is being drawn the gesture layer is the topmost element under every point of it,
 * and its own text — the trace's `<title>` and the spoken announcement — was what came back. So a
 * lasso on a fresh page made a focus whose text read "the circle being drawn", the chip asked
 * "explain this: the circle being drawn", and the plan rang Wobo's own announcement in the corner
 * of the page (the adversary's lab, 2026-09-08, all fourteen lasso turns). Wobo's own surfaces are
 * skipped here for the same reason the glass read skips them, and by the same mark.
 */
export function firstPageElement<T extends { closest(selector: string): unknown }>(
  nodes: readonly T[],
): T | null {
  for (const node of nodes) {
    if (!node.closest(WOBO_OWN_SELECTOR)) return node;
  }
  return null;
}

/**
 * The words of an element, from the runs the page laid out (the adversary, wave 47, finding 6).
 *
 * `textContent` concatenates markup with no regard for layout, so a numbered line written as
 * `<span>2</span><p>feel the rule</p>` came back "2feel the rule" and the learner's own printed
 * ask read `explain this: “2feel the rule”` on the repeat, while the first ask — which reads the
 * glass — printed it correctly. This is the glass's own join: a markup boundary with real space
 * between the boxes, or a wrap onto the next line, is a word break; a boundary with the boxes
 * flush (c then ², one word in two elements) is not.
 */
export function textOfRuns(runs: readonly GlassTextRun[], fallback: string): string {
  return normaliseText(runs.length > 0 ? joinTextRuns(runs) : fallback, 200);
}

/** Text under a point when nothing there is registered — read from the DOM, never from pixels. */
function textUnder(x: number, y: number): string {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function')
    return '';
  const stack = document.elementsFromPoint(x, y).filter((node) => node instanceof HTMLElement);
  const element = firstPageElement(stack);
  if (!element) return '';
  return textOfRuns(textRunsOf(element), element.textContent ?? '');
}

export interface ResolveOptions {
  kind: FocusKind;
  rect: Rect;
  /** Target ids already resolved by the caller (a lasso resolves against its polygon). */
  targetIds?: string[];
  /** Text the gesture itself carries, e.g. the selected string. */
  text?: string;
  path?: readonly Point[];
  registry?: SurfaceRegistry;
  createdAt?: number;
}

/**
 * Assemble a focus from a region: the targets inside it, their text and numbers, and the live state
 * of the surface that owns them. Returns a focus even when nothing is registered — Wobo can still
 * be asked about a region — but with honest, empty target ids.
 */
export function resolveFocus(options: ResolveOptions): FocusObject {
  const registry = options.registry ?? surfaceRegistry;
  const centre = rectCenter(options.rect);
  const targetIds = options.targetIds ?? registry.targetIdsAt(centre.x, centre.y);
  const targets = registry.getTargets();
  const surface = owningSurface(registry.getSurfaces(), targetIds);
  const fromTargets = textOfTargets(targets, targetIds);
  const text = options.text?.trim() || fromTargets || textUnder(centre.x, centre.y);
  // Where the things under this gesture are RIGHT NOW. Re-reading them later is what lets the mark
  // travel with them: `focusRectNow` shifts the region the learner drew by however far they moved.
  const anchorRect = anchorRectOf(targetIds, (id) => registry.getTarget(id)?.rect() ?? null);
  return createFocus({
    kind: options.kind,
    rect: options.rect,
    targetIds,
    text,
    path: options.path,
    surfaceId: surface?.id,
    ownerState: ownerStateOf(targets, targetIds),
    createdAt: options.createdAt,
    ...(anchorRect ? { anchorRect } : {}),
  });
}

/** Targets whose centre falls inside a freehand loop — the circle's honest hit test. */
export function targetIdsInPath(polygon: readonly Point[], registry: SurfaceRegistry): string[] {
  const bounds = boundsOf(polygon);
  return registry.targetIdsIn(bounds).filter((id) => {
    const rect = registry.getTarget(id)?.rect();
    return rect ? pointInPolygon(rectCenter(rect), polygon) : false;
  });
}

// --- The layer -----------------------------------------------------------------------------------

export interface GestureLayerProps {
  /** A new focus was made. */
  onFocus?: (focus: FocusObject) => void;
  /** The focus was cleared (Escape, a fresh gesture, or the chip being dismissed). */
  onClear?: () => void;
  /** The chip was pressed, or the hotkey released with a focus in hand — take it to Wobo. */
  onAsk?: (focus: FocusObject | null) => void;
  /** Hold-to-talk began; the focus in hand, if any, rides with it. */
  onHoldStart?: (focus: FocusObject | null) => void;
  /** Hold-to-talk ended. */
  onHoldEnd?: () => void;
  hotkey?: Hotkey;
  registry?: SurfaceRegistry;
  enabled?: boolean;
  /** Hover-and-hold dwell, in milliseconds. */
  holdMs?: number;
  /** Long-press dwell on touch, in milliseconds. */
  longPressMs?: number;
  chipLabel?: string;
}

const HOVER_HOLD_MS = 700;
const LONG_PRESS_MS = 550;
/** How far the pointer may drift and still count as resting, or as a long press. */
const DRIFT_PX = 8;
const CHIP_WIDTH = 168;
const CHIP_HEIGHT = 30;

/**
 * The region the learner circled, drawn the way BOARD.md §8 describes it: Wobo's own line round it,
 * not a colour poured over it.
 *
 * A 1.5 px ultramarine ring on the path the finger actually took, hand-wobbled so it reads as ink
 * rather than as a selection rectangle, and inside it at most a 4% ultramarine frost — enough that
 * the region is legible as a region, faint enough that every word under it is still readable. A
 * warm fill was the failure this replaced: a salmon blob over the content, which hides the thing it
 * is about, the one thing §11 says kills the board.
 */
export const FOCUS_RING_WIDTH = 1.5;
export const FOCUS_FROST = 'rgba(31,53,224,0.04)';
/** The ring outlives the gesture and fades once the turn that used it is over. */
export const FOCUS_RING_FADE_MS = 420;
/** How far the ring's ink strays from the path the finger took, in px. */
const RING_WOBBLE = 1.1;
/** The clear air the ring keeps off a region that has no path of its own (a text selection). */
const RING_PAD = 8;

/**
 * The ring, as a closed path in viewport pixels: the lasso's own points when there are some, and a
 * hand-drawn loop round the region otherwise. `shift` is how far the thing has travelled since the
 * gesture was made (BOARD.md §3 — an anchor is re-resolved, never frozen).
 */
export function focusRingPath(
  focus: Pick<FocusObject, 'id' | 'rect'> & { path?: readonly Point[] },
  shift: Point = { x: 0, y: 0 },
): string {
  const rng = inkRng(focus.id, 'focus-ring', 'ultramarine');
  const source =
    focus.path && focus.path.length >= 3
      ? focus.path.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }))
      : loopAroundRect(focus.rect, shift, rng);
  return closedInk(source, rng);
}

/** A hand's loop round a region that never had a path — a selection, a hover, the hotkey. */
function loopAroundRect(rect: Rect, shift: Point, rng: () => number): Point[] {
  const cx = rect.x + rect.width / 2 + shift.x;
  const cy = rect.y + rect.height / 2 + shift.y;
  const rx = rect.width / 2 + RING_PAD;
  const ry = rect.height / 2 + RING_PAD;
  const start = rng() * Math.PI * 2;
  const steps = 30;
  const out: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = start + (i / steps) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

/**
 * A closed, smoothed, gently wobbled path through these points. The wobble is seeded on the focus
 * id, so the same region redraws identically rather than shimmering on every scroll frame.
 */
function closedInk(points: readonly Point[], rng: () => number): string {
  if (points.length < 3) return '';
  const wobbled = points.map((p) => ({
    x: p.x + (rng() * 2 - 1) * RING_WOBBLE,
    y: p.y + (rng() * 2 - 1) * RING_WOBBLE,
  }));
  const n = wobbled.length;
  const at = (i: number): Point => wobbled[((i % n) + n) % n] as Point;
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const r = (v: number): number => Math.round(v * 10) / 10;
  const first = mid(at(0), at(1));
  let d = `M ${r(first.x)} ${r(first.y)}`;
  for (let i = 1; i <= n; i += 1) {
    const control = at(i);
    const end = mid(at(i), at(i + 1));
    d += ` Q ${r(control.x)} ${r(control.y)} ${r(end.x)} ${r(end.y)}`;
  }
  return `${d} Z`;
}

export function GestureLayer(props: GestureLayerProps): ReactElement | null {
  const {
    onFocus,
    onClear,
    onAsk,
    onHoldStart,
    onHoldEnd,
    hotkey = DEFAULT_HOTKEY,
    registry = surfaceRegistry,
    enabled = true,
    holdMs = HOVER_HOLD_MS,
    longPressMs = LONG_PRESS_MS,
    chipLabel = 'Ask Wobo about this',
  } = props;

  const [focus, setFocus] = useState<FocusObject | null>(null);
  const [trace, setTrace] = useState<Point[] | null>(null);
  // The ring outlives the focus by one fade: the mark Wobo drew round the thing does not vanish the
  // instant the turn that used it closes, it goes the way ink goes.
  const [ring, setRing] = useState<{ focus: FocusObject; endedAt: number | null } | null>(null);
  const reduced = useReducedMotion();
  const isArmed = useSyncExternalStore(subscribeArmed, lassoArmed, () => false);

  const focusRef = useRef<FocusObject | null>(null);
  focusRef.current = focus;
  const handlers = useRef({ onFocus, onClear, onAsk, onHoldStart, onHoldEnd });
  handlers.current = { onFocus, onClear, onAsk, onHoldStart, onHoldEnd };

  const publish = useCallback((next: FocusObject) => {
    setFocus(next);
    setRing({ focus: next, endedAt: null });
    handlers.current.onFocus?.(next);
  }, []);

  /**
   * A STATE UPDATER IS A PURE FUNCTION OF THE STATE IT IS GIVEN (the adversary, wave 47, finding 9).
   *
   * `onClear` used to be called from inside `setFocus((current) => …)`. React runs an updater
   * during another component's render, so the surface's own setState landed in the middle of that
   * render and every escape-mid-stroke run logged 'Cannot update a component while rendering a
   * different component. WoboStage GestureLayer', keyless and live. The live focus is already
   * mirrored in `focusRef`, so the decision is taken here, in the event, and the updater goes back
   * to being pure.
   */
  const clear = useCallback(() => {
    setTrace(null);
    setRing((current) =>
      current && current.endedAt === null ? { ...current, endedAt: Date.now() } : current,
    );
    const had = focusRef.current !== null;
    focusRef.current = null;
    setFocus(null);
    if (had) handlers.current.onClear?.();
  }, []);

  // Once the ring has faded it leaves the DOM; until then it is still ink on the page.
  useEffect(() => {
    if (!ring || ring.endedAt === null) return;
    const timer = setTimeout(() => setRing(null), FOCUS_RING_FADE_MS);
    return () => clearTimeout(timer);
  }, [ring]);

  // --- pointer gestures --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    // Live gesture state kept outside React: these change per pointer event, and re-rendering the
    // whole app on every move would cost more than the gesture is worth.
    const touches = new Map<number, Point>();
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let hoverAt: Point | null = null;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressAt: Point | null = null;
    let lasso: Point[] | null = null;
    let lassoPointer: number | null = null;

    const cancelHover = () => {
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      hoverTimer = null;
      hoverAt = null;
    };
    const cancelPress = () => {
      if (pressTimer !== null) clearTimeout(pressTimer);
      pressTimer = null;
      pressAt = null;
    };
    const endLasso = () => {
      lasso = null;
      lassoPointer = null;
      setTrace(null);
      armLasso(false);
    };

    const emitLoop = (points: Point[], kind: FocusKind) => {
      const path = simplifyPath(points);
      if (path.length < 4 || !isClosedLoop(path)) return;
      publish(
        resolveFocus({
          kind,
          rect: boundsOf(path),
          targetIds: targetIdsInPath(path, registry),
          path,
          registry,
        }),
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      cancelHover();
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 2) {
          // Two fingers: the centroid traces the circle, so the content stays visible under it.
          cancelPress();
          lasso = [centroid(touches)];
          lassoPointer = null;
          setTrace(lasso);
          return;
        }
        if (touches.size === 1 && !isTypingTarget(event.target)) {
          pressAt = { x: event.clientX, y: event.clientY };
          pressTimer = setTimeout(() => {
            const at = pressAt;
            cancelPress();
            if (!at) return;
            const ids = registry.targetIdsAt(at.x, at.y);
            if (ids.length === 0) return; // nothing registered under the finger: stay quiet
            const rect = registry.getTarget(ids[0] as string)?.rect() ?? pointRect(at);
            publish(resolveFocus({ kind: 'longpress', rect, targetIds: ids, registry }));
          }, longPressMs);
        }
        return;
      }
      // Mouse or pen: a circle begins only when it was asked for — armed, or with Alt held — so an
      // ordinary drag in the app is never stolen.
      if ((isArmed || event.altKey) && event.button === 0) {
        lasso = [{ x: event.clientX, y: event.clientY }];
        lassoPointer = event.pointerId;
        setTrace(lasso);
        event.preventDefault();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pressAt && distance(pressAt, { x: event.clientX, y: event.clientY }) > DRIFT_PX) {
          cancelPress();
        }
        if (lasso && touches.size === 2) {
          lasso = [...lasso, centroid(touches)];
          setTrace(lasso);
        }
        return;
      }
      if (lasso && lassoPointer === event.pointerId) {
        lasso = [...lasso, { x: event.clientX, y: event.clientY }];
        setTrace(lasso);
        event.preventDefault();
        return;
      }
      if (event.pointerType !== 'mouse') return;
      const at = { x: event.clientX, y: event.clientY };
      if (hoverAt && distance(hoverAt, at) <= DRIFT_PX) return; // still resting: let the timer run
      cancelHover();
      if (isTypingTarget(event.target)) return;
      hoverAt = at;
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        const resting = hoverAt;
        if (!resting) return;
        const ids = registry.targetIdsAt(resting.x, resting.y);
        if (ids.length === 0) return; // Wobo does not comment on empty space
        const rect = registry.getTarget(ids[0] as string)?.rect() ?? pointRect(resting);
        publish(resolveFocus({ kind: 'hover', rect, targetIds: ids, registry }));
      }, holdMs);
    };

    const onPointerUp = (event: PointerEvent) => {
      cancelPress();
      if (event.pointerType === 'touch') {
        const wasTwo = touches.size === 2;
        touches.delete(event.pointerId);
        if (lasso && wasTwo) {
          const points = lasso;
          endLasso();
          emitLoop(points, 'circle');
        }
        return;
      }
      if (lasso && lassoPointer === event.pointerId) {
        const points = lasso;
        endLasso();
        emitLoop(points, 'lasso');
      }
    };

    const onSelectionEnd = (event: Event) => {
      if (lasso) return;
      const selection = window.getSelection?.();
      const text = selection?.toString() ?? '';
      if (!selection || selection.isCollapsed || text.trim().length === 0) return;
      if (isTypingTarget(event.target)) return;
      const range = selection.getRangeAt(0);
      const box = range.getBoundingClientRect();
      const rect: Rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      publish(resolveFocus({ kind: 'selection', rect, text, registry }));
    };

    const onScroll = () => {
      cancelHover();
      cancelPress();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('mouseup', onSelectionEnd, true);
    // The keyboard path: shift+arrow to select, release, and the same chip appears.
    window.addEventListener('keyup', onSelectionEnd, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    return () => {
      cancelHover();
      cancelPress();
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('mouseup', onSelectionEnd, true);
      window.removeEventListener('keyup', onSelectionEnd, true);
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    };
  }, [enabled, holdMs, longPressMs, isArmed, publish, registry]);

  // --- the hotkey and Escape ---------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let held = false;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clear();
        return;
      }
      if (isTypingTarget(event.target) || event.repeat || held) return;
      if (!matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      held = true;
      // Hold to talk with whatever is in hand: the live focus, or the current selection.
      let inHand = focusRef.current;
      if (!inHand) {
        const selection = window.getSelection?.();
        const text = selection?.toString() ?? '';
        if (selection && !selection.isCollapsed && text.trim().length > 0) {
          const box = selection.getRangeAt(0).getBoundingClientRect();
          inHand = resolveFocus({
            kind: 'hotkey',
            rect: { x: box.x, y: box.y, width: box.width, height: box.height },
            text,
            registry,
          });
          publish(inHand);
        }
      }
      handlers.current.onHoldStart?.(inHand);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!held) return;
      // Releasing either the key or its modifier ends the hold — a stuck modifier never traps Wobo.
      const releasedChord = hotkey.code ? event.code === hotkey.code : event.key === hotkey.key;
      if (
        !releasedChord &&
        event.key !== 'Alt' &&
        event.key !== 'Control' &&
        event.key !== 'Meta'
      ) {
        return;
      }
      held = false;
      handlers.current.onHoldEnd?.();
    };

    const onBlur = () => {
      if (!held) return;
      held = false;
      handlers.current.onHoldEnd?.();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled, hotkey, clear, publish, registry]);

  const traceD = useMemo(() => (trace ? pathD(trace) : null), [trace]);

  // The chip sits under the thing the learner pointed at, and the page moves under both. Reading
  // the focus's frozen rect left "Ask Wobo about this" pinned to a viewport position while the
  // thing it was about scrolled away — the visible half of a `{focus}` anchor that floats.
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    if ((!focus && !ring) || typeof window === 'undefined') return;
    const moved = () => setLayoutTick((n) => (n + 1) % 1_000_000);
    window.addEventListener('scroll', moved, { capture: true, passive: true });
    window.addEventListener('resize', moved, { passive: true });
    return () => {
      window.removeEventListener('scroll', moved, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', moved);
    };
  }, [focus, ring]);

  const liveRectOf = useCallback(
    (of: FocusObject): Rect =>
      focusRectNow(of, {
        target: (id) => registry.getTarget(id)?.rect() ?? null,
        scroll: pageScroll(),
      }),
    [registry],
  );

  const chipAt = useMemo(() => {
    void layoutTick;
    if (!focus) return null;
    return chipPosition(liveRectOf(focus));
  }, [focus, liveRectOf, layoutTick]);

  // The ring travels with what it is about: the shift is how far the region has moved since the
  // gesture, exactly the delta the chip is positioned by.
  const ringD = useMemo(() => {
    void layoutTick;
    if (!ring) return null;
    const now = liveRectOf(ring.focus);
    return focusRingPath(ring.focus, {
      x: now.x - ring.focus.rect.x,
      y: now.y - ring.focus.rect.y,
    });
  }, [ring, liveRectOf, layoutTick]);
  if (!enabled) return null;

  return (
    <div
      data-wobo-gesture-layer=""
      // Wobo's own layer, never the learner's page: the trace, the ring and the spoken
      // announcement are all skipped by the glass read (docs/INK-FREEZE-PLAN-TRACE.md §3).
      data-wobo-surface=""
      data-glass-ignore=""
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: zIndex.panel,
        // The layer is inert until a circle is actually being drawn; the app underneath is never
        // blocked. The chip re-enables pointer events on itself alone.
        pointerEvents: trace ? 'auto' : 'none',
        cursor: trace ? 'crosshair' : undefined,
      }}
    >
      {traceD ? (
        <svg
          aria-hidden="true"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <title>the circle being drawn</title>
          <path
            d={traceD}
            fill="none"
            stroke={ultramarine}
            strokeWidth={FOCUS_RING_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        </svg>
      ) : null}

      {ringD ? (
        <svg
          aria-hidden="true"
          width="100%"
          height="100%"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: ring?.endedAt === null ? 1 : 0,
            transition: reduced ? 'none' : `opacity ${FOCUS_RING_FADE_MS}ms linear`,
          }}
        >
          <title>the region you circled</title>
          <path
            d={ringD}
            fill={FOCUS_FROST}
            stroke={ultramarine}
            strokeWidth={FOCUS_RING_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}

      {/* Focus objects are announced, never only drawn — the gesture has a spoken equivalent. */}
      <div
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
        }}
      >
        {focus ? describeFocus(focus) : ''}
      </div>

      {focus && chipAt ? (
        <button
          type="button"
          onClick={() => handlers.current.onAsk?.(focusRef.current)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') clear();
          }}
          style={{
            position: 'fixed',
            left: chipAt.x,
            top: chipAt.y,
            minWidth: CHIP_WIDTH,
            height: CHIP_HEIGHT,
            padding: `0 ${space[2]}px`,
            pointerEvents: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: space.half,
            border: `1px solid ${hairline.onPaperStrong}`,
            borderRadius: radius.sm,
            background: frost.onPaper,
            backdropFilter: `blur(${frost.blur})`,
            WebkitBackdropFilter: `blur(${frost.blur})`,
            color: ink[900],
            font: `${typeScale.caption.weight} ${typeScale.caption.size}/1 inherit`,
            fontSize: typeScale.caption.size,
            cursor: 'pointer',
            transition: reduced ? 'none' : 'opacity 160ms cubic-bezier(0.2, 0, 0, 1)',
          }}
        >
          {chipLabel}
        </button>
      ) : null}
    </div>
  );
}

// --- geometry helpers ----------------------------------------------------------------------------

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: Map<number, Point>): Point {
  let x = 0;
  let y = 0;
  for (const p of points.values()) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, points.size);
  return { x: x / n, y: y / n };
}

function pointRect(at: Point): Rect {
  return { x: at.x - 12, y: at.y - 12, width: 24, height: 24 };
}

/** The chip sits under the focus, flipping above it near the bottom edge, always fully on screen. */
export function chipPosition(
  rect: Rect,
  viewport: { width: number; height: number } = {
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  },
): Point {
  const gap = space[1];
  const below = rect.y + rect.height + gap;
  const y =
    below + CHIP_HEIGHT + gap > viewport.height
      ? Math.max(gap, rect.y - CHIP_HEIGHT - gap)
      : Math.max(gap, below);
  const x = Math.min(Math.max(gap, rect.x), Math.max(gap, viewport.width - CHIP_WIDTH - gap));
  return { x, y };
}

/** A polyline `d` for the live trace — plain segments, so it draws exactly where the finger went. */
export function pathD(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${Math.round(p.x)} ${Math.round(p.y)}`)
    .join(' ');
}
