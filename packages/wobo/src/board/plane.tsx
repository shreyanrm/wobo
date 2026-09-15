'use client';

/**
 * The plane (docs/BOARD.md §5) — a board that slides in from Wobo's orb and floats over the screen,
 * so the thing being explained stays visible underneath.
 *
 * It can be dragged, resized, pinned, and minimised to a thumbnail that keeps its ink; on a phone
 * it is a sheet. A session can hold several boards ("fresh board" starts another), and any code can
 * summon one by name — that is the summon API the word "board" and the gesture layer both call.
 *
 * Its frame is the chrome in `chrome.tsx`: a 24px card, one tonal step off the paper, lifted by a
 * soft shadow because it floats. No border line, on either theme (DESIGN.md).
 */

import { zIndex } from '@wobo/config';
import { useReducedMotion } from '@wobo/motion';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { BoardChromeStyle, ChromeButton } from './chrome';
import { BoardSurface, type BoardSurfaceProps } from './renderer';
import { BoardStore } from './store';

// --- The book of boards ---------------------------------------------------------------------------

/** Several boards per session; a fresh board never wipes the one before it. */
class BoardBook {
  private readonly boards = new Map<string, BoardStore>();
  private readonly listeners = new Set<() => void>();
  private order: string[] = [];
  private n = 0;
  /**
   * How many boards a session keeps. "Fresh board" minted a new store every time and the book kept
   * every one of them, ink and all, for the life of the tab; fifty cycles left fifty boards alive.
   * A handful is what a session can actually come back to.
   */
  private static readonly MAX_BOARDS = 8;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** The board with this id, created on first ask. */
  get(id: string): BoardStore {
    const existing = this.boards.get(id);
    if (existing) return existing;
    const store = new BoardStore({ presentation: 'plane' });
    this.boards.set(id, store);
    this.order = [...this.order, id];
    this.evict();
    this.emit();
    return store;
  }

  /** A new, empty board. Returns its id. */
  fresh(): string {
    const id = `board-${++this.n}`;
    this.get(id);
    return id;
  }

  ids(): readonly string[] {
    return this.order;
  }

  /** Forget a board entirely — the learner closed it and did not save it. */
  drop(id: string): void {
    if (!this.boards.has(id)) return;
    this.boards.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.emit();
  }

  /** Forget a board that was closed with nothing on it. It was never a board Wobo kept. */
  dropIfEmpty(id: string): void {
    if ((this.boards.get(id)?.snapshot().length ?? 0) === 0) this.drop(id);
  }

  /** Over the cap: the oldest empty board goes, then the oldest board, never the one on screen. */
  private evict(): void {
    while (this.order.length > BoardBook.MAX_BOARDS) {
      const open = plane.get().boardId;
      const spare = this.order.filter((id) => id !== open);
      const empty = spare.find((id) => (this.boards.get(id)?.snapshot().length ?? 0) === 0);
      const going = empty ?? spare[0];
      if (!going) return;
      this.boards.delete(going);
      this.order = this.order.filter((x) => x !== going);
    }
  }
}

export const boardBook = new BoardBook();

// --- The summon API -----------------------------------------------------------------------------------

export interface PlaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlaneState {
  open: boolean;
  minimized: boolean;
  pinned: boolean;
  boardId: string;
  rect: PlaneRect;
  /**
   * WHETHER `rect` IS A PLACE OR A DEFAULT.
   *
   * The placer used to ask `rect.x !== 0 || rect.y !== 0` instead, which is a sentinel a learner can
   * reach: drag the panel until its corner is on the screen's corner and the plane reads as never
   * placed, so the placer snaps it back to the lower right under the hand that was moving it. It
   * cost nothing to see while only an effect read it; the entrance reads it during render now, so
   * the snap would be on the first painted frame. A flag cannot be dragged onto.
   */
  placed: boolean;
  /** Where it slides from — Wobo's orb. */
  origin: { x: number; y: number } | null;
  title: string;
}

const RESTING: PlaneState = {
  open: false,
  minimized: false,
  pinned: false,
  boardId: 'board-1',
  rect: { x: 0, y: 0, w: 520, h: 360 },
  placed: false,
  origin: null,
  title: 'board',
};

class PlaneController {
  private state: PlaneState = RESTING;
  private readonly listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = (): PlaneState => this.state;

  private set(patch: Partial<PlaneState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Bring a board in. With no id it reopens the one Wobo was last on. */
  summon(opts?: { boardId?: string; origin?: { x: number; y: number }; title?: string }): string {
    const boardId = opts?.boardId ?? this.state.boardId;
    boardBook.get(boardId);
    this.set({
      open: true,
      minimized: false,
      boardId,
      ...(opts?.origin ? { origin: opts.origin } : {}),
      ...(opts?.title ? { title: opts.title } : {}),
    });
    return boardId;
  }

  /** A fresh board, summoned. */
  fresh(origin?: { x: number; y: number }): string {
    const id = boardBook.fresh();
    return this.summon(origin ? { boardId: id, origin } : { boardId: id });
  }

  /**
   * Put the board away, unless the learner pinned it. Returns whether it actually went.
   *
   * The return value is the point: callers used to say "Put away." straight after this call, and a
   * pinned board made that sentence false. A pin is there to survive the ACCIDENTAL dismissal (a
   * stray Escape, a turn that moves on), so this one keeps honouring it and `close` below is the
   * door for a learner who asked outright.
   */
  dismiss(): boolean {
    if (this.state.pinned) return false;
    const closing = this.state.boardId;
    this.set({ open: false, minimized: false });
    // Closed with nothing on it: forget it rather than keeping an empty store per dismissal.
    boardBook.dropIfEmpty(closing);
    return true;
  }

  /**
   * The learner asked for the board to go: the word "close the board", or the close button under
   * their own finger. Nothing about that is accidental, so the pin is lifted rather than obeyed —
   * a control that announces itself and then does nothing is worse than no control at all.
   * Returns whether a board was open to close.
   */
  close(): boolean {
    if (!this.state.open) return false;
    if (this.state.pinned) this.set({ pinned: false });
    return this.dismiss();
  }

  /** Away, but with its ink — the thumbnail by the orb. */
  minimize(): void {
    this.set({ minimized: true });
  }
  restore(): void {
    this.set({ minimized: false, open: true });
  }
  togglePin(): void {
    this.set({ pinned: !this.state.pinned });
  }
  /** Moved or resized — by the placer, by a drag, or by the keyboard. Either way it is placed. */
  move(rect: Partial<PlaneRect>): void {
    this.set({ rect: { ...this.state.rect, ...rect }, placed: true });
  }
  /** Wipe the board Wobo is on, keeping the plane open. */
  wipe(): void {
    boardBook.get(this.state.boardId).reset();
  }
}

/** How much of a phone screen the sheet takes, in vh. Its frame and its reserve are one number. */
export const PHONE_SHEET_VH = 62;

/** The attribute the root carries while the sheet is up, so a scroll surface can reserve room. */
export const SHEET_ATTRIBUTE = 'data-wobo-sheet';
/** The custom property that carries the reserve to CSS. */
export const SHEET_VAR = '--wobo-sheet-h';

/**
 * HOW MUCH ROOM THE SHEET NEEDS RESERVED (docs/INK-FOUR.md, experience; the adversary, wave 47,
 * finding 10).
 *
 * "The page the learner is looking at is never taken away to make room for the answer." On a phone
 * the plane is a sheet across the lower 62vh of the screen, and Wobo's own say sits above it in
 * the transcript. It was cut in half mid-line: on the Punnett turn the learner read 'Dominant 3,
 * recessive 1. Read the' and then the sheet edge; on the lens turn the say was off the screen
 * altogether. Nothing is hidden and nothing shrinks — the reading surface simply keeps the sheet's
 * height clear at its foot, so scrolling to the end lands the last line above the edge.
 *
 * Null wherever the sheet is not taking the screen: on a wide screen the plane is a panel beside
 * the page, and a minimised board is a thumbnail.
 */
export function sheetReserve(state: {
  open: boolean;
  minimized: boolean;
  phone: boolean;
}): string | null {
  if (!state.open || state.minimized || !state.phone) return null;
  return `${PHONE_SHEET_VH}vh`;
}

/**
 * WHERE A PLANE'S ENTRANCE BEGINS (the judge, wave 61, finding 1; INK-FOUR craft and timing).
 *
 * BOARD.md §5 says the plane "slides in from the orb", and it did — from the wrong centre. The
 * offset was `origin − centre(state.rect)`, and `state.rect` is the 520x360 box a plane is given on
 * a WIDE screen. On a phone the plane is a full-width sheet across the lower 62vh and never uses
 * that rect; on a wide screen the rect is still {0,0} on the frame the plane first paints, because
 * the placer is an effect. So the gesture was aimed from a box the plane does not occupy, and the
 * first painted frame landed off the screen.
 *
 * MEASURED ON THE RUNNING APP, 2026-09-15, before a line of this changed:
 *   390x844  — first frame top 882, bottom 1337, right 418; the board's first object painted at
 *              y = 1173, three hundred px under an 844 px screen, and nothing of it on the glass
 *              for 79 ms while the surface flew 561 px and took 446 to come to rest.
 *   1440x900 — first frame top 1000, left 1859, right 2313: off the bottom AND 873 px off the right.
 * Reduced motion had no entrance at either width and still has none.
 *
 * THE LAW, and it is the craft law "nothing off the viewport" applied to the surface as well as to
 * the ink: a plane aims its centre at the orb and the offset is then CLAMPED so the box it starts
 * in lies inside the viewport. A plane with no room to travel simply does not travel.
 *
 * AND A SHEET DOES NOT FLY. It is anchored to an edge, so it grows off that edge — scaled about its
 * own bottom, never translated — which is the platform's grammar for a sheet and the only entrance
 * that cannot take the board's ink off the screen at all.
 */
export interface PlaneEntrance {
  x: number;
  y: number;
  scale: number;
  /** The point the scale is taken about; a sheet grows off the edge it is anchored to. */
  transformOrigin: string;
}

/** The least a panel shrinks to as it comes in from the orb. */
export const PANEL_ENTRANCE_SCALE = 0.86;
/** How far off its own edge a sheet grows. Small, because the edge is where it already lives. */
export const SHEET_ENTRANCE_SCALE = 0.96;
/** Where a plane with no orb to come from starts: a hand's width below its place. */
export const ENTRANCE_FALL_PX = 24;

export function planeEntrance(
  box: PlaneRect,
  origin: { x: number; y: number } | null,
  viewport: { w: number; h: number },
  sheet: boolean,
): PlaneEntrance {
  if (sheet) return { x: 0, y: 0, scale: SHEET_ENTRANCE_SCALE, transformOrigin: 'bottom center' };
  const scale = PANEL_ENTRANCE_SCALE;
  const insetX = ((1 - scale) * box.w) / 2;
  const insetY = ((1 - scale) * box.h) / 2;
  const want = origin
    ? { x: origin.x - (box.x + box.w / 2), y: origin.y - (box.y + box.h / 2) }
    : { x: 0, y: ENTRANCE_FALL_PX };
  // A box with no room in an axis does not move in that axis, rather than being pushed somewhere
  // arbitrary: `lo > hi` is a plane at least as large as the screen it is opening on.
  const held = (v: number, lo: number, hi: number) => (lo > hi ? 0 : Math.min(hi, Math.max(lo, v)));
  return {
    x: held(want.x, -(box.x + insetX), viewport.w - (box.x + box.w - insetX)),
    y: held(want.y, -(box.y + insetY), viewport.h - (box.y + box.h - insetY)),
    scale,
    transformOrigin: 'center',
  };
}

/** Publish the reserve on the document root, and take it back the moment the sheet goes. */
function useSheetReserve(reserve: string | null): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (reserve === null) {
      root.removeAttribute(SHEET_ATTRIBUTE);
      root.style.removeProperty(SHEET_VAR);
      return;
    }
    root.setAttribute(SHEET_ATTRIBUTE, 'phone');
    root.style.setProperty(SHEET_VAR, reserve);
    return () => {
      root.removeAttribute(SHEET_ATTRIBUTE);
      root.style.removeProperty(SHEET_VAR);
    };
  }, [reserve]);
}

/** The one plane. Summon it from anywhere: `plane.summon()`, `plane.fresh()`. */
export const plane = new PlaneController();

/** Subscribe a component to the plane's state. */
export function usePlane(): PlaneState {
  return useSyncExternalStore(plane.subscribe, plane.get, plane.get);
}

/** The store behind a board id, subscribed so a fresh board re-renders its surface. */
export function useBoard(boardId: string): BoardStore {
  useSyncExternalStore(
    boardBook.subscribe,
    () => boardBook.ids().length,
    () => boardBook.ids().length,
  );
  return boardBook.get(boardId);
}

// --- The surface ------------------------------------------------------------------------------------------

const PHONE_WIDTH = 640;
const MIN_W = 320;
const MIN_H = 220;
const THUMB = 96;

/**
 * The screen, as the plane's own arithmetic needs it. One listener, and a new object only when the
 * numbers actually change, so nothing downstream re-runs on a resize that did not resize anything.
 */
function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState(() =>
    typeof window === 'undefined'
      ? { w: 0, h: 0 }
      : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const on = () =>
      setSize((was) =>
        was.w === window.innerWidth && was.h === window.innerHeight
          ? was
          : { w: window.innerWidth, h: window.innerHeight },
      );
    on();
    window.addEventListener('resize', on, { passive: true });
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

const chromeButton = (label: string, onClick: () => void, glyph: string) => (
  <ChromeButton key={label} aria-label={label} onClick={onClick}>
    {glyph}
  </ChromeButton>
);

export interface WoboPlaneProps
  extends Pick<
    BoardSurfaceProps,
    'targets' | 'focusRegions' | 'onLearnerFocus' | 'onVariableChange' | 'fontUrl'
  > {
  /** Let the learner draw on the plane. On by default — the board is bidirectional. */
  capture?: boolean;
}

/**
 * The floating board. Mount once, near the root, beside the orb. Everything about where it is and
 * whether it is here is on the `plane` controller, so a word ("board"), a gesture, or a turn can
 * summon it without prop drilling.
 */
/** The panels a plane must not open underneath: the Companion drawer, and any other open dialog. */
const DRAWER_SELECTOR = 'aside[role="dialog"]';

/**
 * Where a plane that has never been placed opens: the lower right, above Wobo's orb, and to the
 * LEFT of anything already open on the right. At 1280 wide the plane used to open at x 656 with
 * the Companion drawer (x 860 onward) sitting on top of its controls and the right end of its
 * drawing (the 2026-09-05 review): the drawn answer was half covered by the composer that asked
 * for it. Pure, so the rule is testable without a window.
 */
export function placeClearOf(
  viewport: { w: number; h: number },
  size: { w: number; h: number },
  blocked: PlaneRect[],
): { x: number; y: number } {
  let x = Math.max(24, viewport.w - size.w - 104);
  const y = Math.max(24, viewport.h - size.h - 132);
  for (const b of blocked) {
    const overlapsX = x < b.x + b.w && x + size.w > b.x;
    const overlapsY = y < b.y + b.h && y + size.h > b.y;
    if (overlapsX && overlapsY) x = Math.min(x, b.x - size.w - 16);
  }
  return { x: Math.max(24, x), y };
}

export function WoboPlane(props: WoboPlaneProps) {
  const state = usePlane();
  const store = useBoard(state.boardId);
  const reduced = useReducedMotion();
  const viewport = useViewport();
  const phone = viewport.w > 0 && viewport.w < PHONE_WIDTH;
  const dragging = useRef<{ dx: number; dy: number } | null>(null);
  const resizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // A plane that has never been placed opens in the lower right, above Wobo's orb, and clear of
  // whatever is already open on that side (the Companion drawer the learner asked from).
  //
  // BEFORE IT PAINTS, and not after (the judge, wave 61, finding 1). As a plain effect this ran
  // after the browser had already painted the plane at its unplaced {0,0}: measured at 1440x900 on
  // 2026-09-15, the first painted frame sat at left 1859 and top 1000 — 419 px off the right of the
  // screen and a hundred below it — and the entrance was then computed from that same unplaced box,
  // so the slide was aimed from nowhere. A layout effect places it on the frame it mounts.
  useLayoutEffect(() => {
    if (!state.open || phone) return;
    if (state.placed) return;
    plane.move(
      placeClearOf(
        { w: window.innerWidth, h: window.innerHeight },
        { w: state.rect.w, h: state.rect.h },
        Array.from(document.querySelectorAll(DRAWER_SELECTOR)).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }),
      ),
    );
  }, [state.open, state.placed, state.rect.w, state.rect.h, phone]);

  useEffect(() => {
    if (!state.open || state.minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') plane.dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, state.minimized]);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (phone) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragging.current = { dx: e.clientX - state.rect.x, dy: e.clientY - state.rect.y };
    },
    [phone, state.rect.x, state.rect.y],
  );
  const onDragMove = useCallback((e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    plane.move({ x: e.clientX - d.dx, y: e.clientY - d.dy });
  }, []);
  const onDragEnd = useCallback(() => {
    dragging.current = null;
    resizing.current = null;
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      resizing.current = { x: e.clientX, y: e.clientY, w: state.rect.w, h: state.rect.h };
    },
    [state.rect.w, state.rect.h],
  );
  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    plane.move({
      w: Math.max(MIN_W, r.w + (e.clientX - r.x)),
      h: Math.max(MIN_H, r.h + (e.clientY - r.y)),
    });
  }, []);

  /** Keyboard path for every interaction: the header moves and resizes with the arrow keys. */
  const onChromeKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8;
    const map: Record<string, Partial<PlaneRect>> = {
      ArrowLeft: e.altKey ? { w: state.rect.w - step } : { x: state.rect.x - step },
      ArrowRight: e.altKey ? { w: state.rect.w + step } : { x: state.rect.x + step },
      ArrowUp: e.altKey ? { h: state.rect.h - step } : { y: state.rect.y - step },
      ArrowDown: e.altKey ? { h: state.rect.h + step } : { y: state.rect.y + step },
    };
    const patch = map[e.key];
    if (!patch) return;
    e.preventDefault();
    plane.move({
      ...patch,
      ...(patch.w !== undefined ? { w: Math.max(MIN_W, patch.w) } : {}),
      ...(patch.h !== undefined ? { h: Math.max(MIN_H, patch.h) } : {}),
    });
  };

  /**
   * The resize handle's own keyboard path. It is a focusable, labelled button, so it has to DO
   * something when it is pressed: a control that announces itself and then ignores every key is
   * worse than no control at all.
   */
  const onResizeKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8;
    const map: Record<string, Partial<PlaneRect>> = {
      ArrowLeft: { w: state.rect.w - step },
      ArrowRight: { w: state.rect.w + step },
      ArrowUp: { h: state.rect.h - step },
      ArrowDown: { h: state.rect.h + step },
    };
    const patch = map[e.key];
    if (!patch) return;
    e.preventDefault();
    plane.move({
      ...(patch.w !== undefined ? { w: Math.max(MIN_W, patch.w) } : {}),
      ...(patch.h !== undefined ? { h: Math.max(MIN_H, patch.h) } : {}),
    });
  };

  const spring = reduced
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 } as const);

  /**
   * THE BOX THE PLANE ACTUALLY OCCUPIES, ON THE FRAME IT FIRST PAINTS.
   *
   * On a phone that is the sheet across the lower 62vh, never `state.rect` — aiming the entrance
   * from a rect the sheet does not use was the whole of the bug at 390. On a wide screen it is
   * `state.rect` once the placer has run, and BEFORE it has run it is where the placer is about to
   * put it: a plane that has never been placed is still {0,0} on its first render, and an entrance
   * is captured on the first render and never recomputed, so reading the store there aimed the
   * panel's slide from the top-left corner and sent its first painted frame 419 px off the right of
   * a 1440 screen. The drawers are not consulted here — they only ever shift the panel LEFT, and an
   * entrance clamped to the glass cannot be hurt by an aim that is a drawer's width out.
   */
  const sheetH = Math.round((viewport.h * PHONE_SHEET_VH) / 100);
  const resting: PlaneRect = phone
    ? { x: 0, y: viewport.h - sheetH, w: viewport.w, h: sheetH }
    : !state.placed && viewport.w > 0
      ? { ...state.rect, ...placeClearOf(viewport, state.rect, []) }
      : state.rect;
  const from = planeEntrance(resting, state.origin, viewport, phone);

  // Painted from the same box the entrance was aimed from, so the first frame cannot disagree with
  // the slide that starts on it.
  const frame: React.CSSProperties = phone
    ? { left: 0, right: 0, bottom: 0, width: '100%', height: `${PHONE_SHEET_VH}vh` }
    : { left: resting.x, top: resting.y, width: resting.w, height: resting.h };

  // THE SHEET NEVER TAKES THE SENTENCE IT IS EXPLAINING (the adversary, wave 47, finding 10).
  // While it is up, the reading surfaces are told how much of the screen it holds, so the last
  // line of Wobo's say stays above its edge instead of being cut in half mid-word.
  useSheetReserve(sheetReserve({ open: state.open, minimized: state.minimized, phone }));

  return (
    <AnimatePresence>
      {state.open && !state.minimized ? (
        <motion.section
          key="plane"
          role="dialog"
          aria-label={`${state.title}, Wobo's board`}
          // Wobo's own board is never on the glass map: the mark is on its root, and the read
          // skips the subtree (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
          data-wobo-surface=""
          className={`wobo-chrome wobo-chrome-plane${phone ? ' wobo-chrome-sheet' : ''}`}
          initial={reduced ? false : { opacity: 0, scale: from.scale, x: from.x, y: from.y }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: from.scale, x: from.x, y: from.y }}
          transition={spring}
          style={{
            position: 'fixed',
            ...frame,
            // A sheet grows off the edge it is anchored to; a panel scales about its middle.
            transformOrigin: from.transformOrigin,
            zIndex: zIndex.panel,
          }}
        >
          <BoardChromeStyle />
          <header className="wobo-chrome-head">
            {/* The drag handle is a real button, so the board can be moved and resized from the
                keyboard exactly as it can with a pointer. */}
            <button
              type="button"
              className="wobo-chrome-title"
              aria-label={`${state.title} — drag to move, arrows to move, alt and arrows to resize`}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onKeyDown={onChromeKey}
              style={phone ? { cursor: 'default' } : undefined}
            >
              {state.title}
            </button>
            {chromeButton('fresh board', () => plane.fresh(), 'fresh')}
            {chromeButton('wipe the board', () => plane.wipe(), 'wipe')}
            {chromeButton(
              state.pinned ? 'unpin the board' : 'pin the board',
              () => plane.togglePin(),
              state.pinned ? 'pinned' : 'pin',
            )}
            {chromeButton('minimise the board', () => plane.minimize(), 'hide')}
            {chromeButton('close the board', () => plane.close(), 'close')}
          </header>
          <div className="wobo-chrome-canvas">
            <BoardSurface
              store={store}
              capture={props.capture ?? true}
              {...(props.targets ? { targets: props.targets } : {})}
              {...(props.focusRegions ? { focusRegions: props.focusRegions } : {})}
              {...(props.onLearnerFocus ? { onLearnerFocus: props.onLearnerFocus } : {})}
              {...(props.onVariableChange ? { onVariableChange: props.onVariableChange } : {})}
              {...(props.fontUrl ? { fontUrl: props.fontUrl } : {})}
              autoCamera
              label="Wobo's board"
            />
          </div>
          {phone ? null : (
            <button
              type="button"
              className="wobo-chrome-grip"
              aria-label="resize the board — drag, or the arrow keys"
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onDragEnd}
              onKeyDown={onResizeKey}
            />
          )}
        </motion.section>
      ) : null}
      {state.open && state.minimized ? (
        <motion.button
          key="thumb"
          type="button"
          className="wobo-chrome wobo-chrome-thumb"
          aria-label={`open ${state.title}`}
          onClick={() => plane.restore()}
          initial={reduced ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={spring}
          style={{
            bottom: 132,
            height: THUMB * 0.68,
            right: 24,
            width: THUMB,
            zIndex: zIndex.panel,
          }}
        >
          <BoardChromeStyle />
          <div style={{ inset: 0, position: 'absolute' }}>
            <BoardSurface store={store} label={`${state.title}, minimised`} />
          </div>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
