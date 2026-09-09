/**
 * The glass hold (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze): the glass is held still for a turn
 * that may draw. Scroll is locked for the turn (a finger already scrolling finishes its scroll),
 * the phone sheet folds to a strip, route changes wait for the end of the turn, and layout is
 * held. Escape, a tap on the glass, the learner's voice, or the turn's end release everything in
 * one tick.
 *
 * The stroke hold (`scroll-hold.ts`) is a courtesy of at most 1.5 s around one stroke; this is the
 * pen's own freeze, taken while a stroke is in flight and let go the instant the last one lands. It keeps its
 * own `ScrollHold` instance for the scroll half, because that class already knows the one hard
 * rule about fingers, and adds the rest: the fold, the deferred routes, the release triggers.
 *
 * No DOM is assumed. The event target, the clock and the document root are injectable, so every
 * rule runs in a plain test; `glassHold` is the one instance the app shares.
 */

import { type HoldTarget, ScrollHold } from '../scroll-hold';

/**
 * THE CAP IS AN IDLE WINDOW, NOT A WALL CLOCK (docs/INK-FREEZE-PLAN-TRACE.md §3; the adversary,
 * 2026-09-08 and 2026-09-09).
 *
 * Wave 39 held the page for 45 s and pinned it through a whole utterance. Wave 40 answered with a
 * flat 6 s from the moment the hold was taken — and measured it against nothing. Live, the
 * wobo.turn stream's FIRST BYTE arrives 6.0-8.5 s after the ask, so the cap expired before the
 * answer began: every one of the three live course turns recorded `release:cap` at 6032-6034 ms,
 * the conductor read that release as the learner barging in, aborted the stream, and drew nothing
 * on a turn the gateway had already been paid for.
 *
 * So the cap now measures SILENCE. Every sign that the turn is alive — a frame off the wire, a
 * sentence, a mark landing — restarts the window (`alive()`), and the hold lets go only when
 * nothing has happened for `GLASS_HOLD_IDLE_MS`. A ceiling still stands over all of it, because a
 * stream that keeps talking forever cannot pin a child's page either.
 */
export const GLASS_HOLD_IDLE_MS = 6_000;

/**
 * THE OPENING WINDOW: HOW LONG THE PAGE IS STILL BEFORE ANY STROKE (docs/INK-FOUR.md, timing;
 * the adversary, 2026-09-09, finding 4).
 *
 * "The page is held still only while a stroke is in flight." The hold is taken at the ASK, before
 * anything is known about whether a stroke is coming, because the READ needs a still page: the
 * phone sheet folds to a strip, the layout settles, the map is walked. That is all the opening is
 * for, and it is over in a beat.
 *
 * It used to run on the idle window instead, and every sign that the turn was alive — a frame off
 * the wire, a sentence begun — put it back. So a turn that talked for twenty seconds and never
 * drew held a child's page for all twenty. Live on 2026-09-09 the page froze for the whole six
 * seconds and let go by `cap` on turns that never drew a thing: `hold@27, release:cap@6029`.
 *
 * Now a wire frame does not buy the page. Only a STROKE does (`drawing()`), and from the first
 * stroke on, the idle window and the conductor's own stroke-by-stroke release take over. If the
 * ink comes late, it takes the glass back for itself; nothing is lost by having let go, because
 * the conductor stopped reading `cap` as a barge-in (wobo/board-turn.ts).
 */
export const GLASS_HOLD_OPENING_MS = 1_200;

/** Whatever happens, the page is the learner's again by here. */
export const GLASS_HOLD_MAX_MS = 30_000;

/**
 * Kept under its old name for the callers and the tests that read it: the idle window is the cap
 * a caller means when it asks how long a quiet hold lasts.
 */
export const GLASS_HOLD_CAP_MS = GLASS_HOLD_IDLE_MS;

/** The attribute the root carries while held, so CSS and screens can hold their layout. */
export const GLASS_HELD_ATTRIBUTE = 'data-glass-held';

export type GlassRelease = 'escape' | 'tap' | 'voice' | 'end' | 'cap' | 'interrupt';

export interface GlassHoldState {
  held: boolean;
  /** Clock instant the hold began, or null. */
  since: number | null;
  /** Why it was taken: 'turn' from the conductor, anything else from a lab or a screen. */
  reason: string | null;
  /** What let go last. */
  released: GlassRelease | null;
  /** Route changes waiting for the release. */
  deferred: number;
}

/** The root the held attribute is written on. `document.documentElement` in the app. */
export interface HoldRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface GlassHoldOptions {
  target?: HoldTarget | null;
  root?: HoldRoot | null;
  clock?: () => number;
  /** How long the hold survives with no sign of life, once a stroke has landed. */
  capMs?: number;
  /** How long the page is held before the first stroke: the read's beat, and no more. */
  openingMs?: number;
  /** The ceiling over the whole hold, however alive the turn is. */
  maxMs?: number;
}

export class GlassHold {
  private readonly target: HoldTarget | null;
  private readonly root: HoldRoot | null;
  private readonly clock: () => number;
  private readonly capMs: number;
  private readonly openingMs: number;
  private readonly maxMs: number;
  private readonly scroll: ScrollHold;
  private readonly listeners = new Set<(state: GlassHoldState) => void>();
  private queue: (() => void)[] = [];
  private state: GlassHoldState = {
    held: false,
    since: null,
    reason: null,
    released: null,
    deferred: 0,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ceiling: ReturnType<typeof setTimeout> | null = null;
  /** The clock instant of the last sign that the turn is still alive. */
  private lastAlive: number | null = null;
  /** True once a stroke has been on the glass this hold: the window widens only then. */
  private drew = false;
  private attached = false;

  constructor(options: GlassHoldOptions = {}) {
    this.target =
      options.target === undefined
        ? typeof window === 'undefined'
          ? null
          : (window as unknown as HoldTarget)
        : options.target;
    this.root =
      options.root === undefined
        ? typeof document === 'undefined'
          ? null
          : document.documentElement
        : options.root;
    this.clock =
      options.clock ??
      (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.capMs = options.capMs ?? GLASS_HOLD_IDLE_MS;
    this.openingMs = Math.min(options.openingMs ?? GLASS_HOLD_OPENING_MS, this.capMs);
    this.maxMs = options.maxMs ?? Math.max(GLASS_HOLD_MAX_MS, this.capMs);
    this.scroll = new ScrollHold({
      target: this.target,
      clock: this.clock,
      // The scroll half keeps the IDLE window as its own cap, and `alive()` starts it again, so a
      // wheel that arrives after real silence is let through without waiting for anyone to read
      // `held`. The ceiling over the whole hold is this class's own.
      maxHoldMs: this.capMs,
    });
  }

  get held(): boolean {
    this.expire();
    return this.state.held;
  }

  /** Bound, so a React store subscription can take it by name (`useSyncExternalStore`). */
  get = (): GlassHoldState => {
    this.expire();
    return this.state;
  };

  /**
   * The cap, read off the clock as well as the timers, so a stalled timer cannot outhold it. Two
   * numbers: silence since the last sign of life, and the ceiling over the whole hold.
   */
  private expire(): void {
    if (!this.state.held || this.state.since === null) return;
    const now = this.clock();
    if (now - this.state.since >= this.maxMs) {
      this.release('cap');
      return;
    }
    if (now - (this.lastAlive ?? this.state.since) >= this.window()) this.release('cap');
  }

  /** The window that applies right now: the read's beat until a stroke lands, then silence. */
  private window(): number {
    return this.drew ? this.capMs : this.openingMs;
  }

  /** Take the glass. Idempotent: a second hold in the same turn changes nothing. */
  hold(reason = 'turn'): void {
    if (this.state.held) return;
    const now = this.clock();
    this.scroll.hold('glass');
    this.attach();
    this.root?.setAttribute(GLASS_HELD_ATTRIBUTE, reason);
    this.lastAlive = now;
    this.drew = false;
    this.arm();
    if (typeof setTimeout === 'function') {
      this.ceiling = setTimeout(() => {
        this.ceiling = null;
        this.release('cap');
      }, this.maxMs);
    }
    this.set({ held: true, since: now, reason, released: null });
  }

  /**
   * A SIGN THAT THE TURN IS STILL ALIVE — a frame off the wire, a sentence begun, a mark landing.
   *
   * The idle window starts again from here. Nothing else about the hold changes, and a call while
   * nothing is held does nothing at all, so a stream frame that arrives after the learner has
   * already barged in cannot take the page back off them.
   */
  alive(): void {
    if (!this.state.held) return;
    // BEFORE THE FIRST STROKE, THE WIRE DOES NOT BUY THE PAGE (docs/INK-FOUR.md, timing). A frame
    // and a sentence are signs the TURN is alive, not signs that a stroke is in flight, and the
    // page belongs to the learner until the pen is on it.
    if (!this.drew) return;
    this.lastAlive = this.clock();
    this.arm();
    // The scroll half runs its own cap off its own clock, so its window is restarted too.
    this.scroll.releaseAll();
    this.scroll.hold('glass');
  }

  /**
   * THE READ IS DONE, AND NOTHING IS IN FLIGHT (docs/INK-FOUR.md, timing; the adversary, wave 47,
   * finding 7).
   *
   * The opening window is for the read: fold the phone sheet to its strip, let the layout settle,
   * walk the map. It was a fixed 1.2 s, so a turn that resolved no local aim and drew nothing at
   * all still froze a child's page for the whole beat and let go by the cap — `hold@24
   * release:cap@1226` on nine keyless course turns, and the same live. The caller now says when
   * the read is finished; if no stroke has landed by then, the page goes straight back.
   *
   * It lets go as the turn's own `end`, never as a barge-in, so an answer still on the wire is
   * not aborted, and ink that arrives later takes the glass again for itself.
   */
  read(): void {
    if (!this.state.held || this.drew) return;
    this.release('end');
  }

  /**
   * A STROKE IS ON THE GLASS. This is the moment the freeze is for, and the only sign that widens
   * the window from the read's beat to the idle window (the conductor calls it as each mark
   * lands; wobo/board-turn.ts `holdGlass`).
   */
  drawing(): void {
    if (!this.state.held) return;
    this.drew = true;
    this.lastAlive = this.clock();
    this.arm();
    this.scroll.releaseAll();
    this.scroll.hold('glass');
  }

  /** True once a stroke has landed under this hold. */
  get drawn(): boolean {
    return this.drew;
  }

  /** (Re)start the idle timer. */
  private arm(): void {
    if (typeof setTimeout !== 'function') return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.release('cap');
    }, this.window());
  }

  /**
   * Let go, all of it, now: the scroll lock, the fold, the held layout; then the route changes
   * that waited, in the order they were asked for.
   */
  release(why: GlassRelease = 'end'): void {
    if (!this.state.held) {
      // Nothing was held, but something may still be waiting on a release that already happened.
      this.flush();
      return;
    }
    this.scroll.releaseAll();
    this.detach();
    this.root?.removeAttribute(GLASS_HELD_ATTRIBUTE);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ceiling !== null) clearTimeout(this.ceiling);
    this.ceiling = null;
    this.lastAlive = null;
    this.drew = false;
    this.set({ held: false, since: null, reason: null, released: why });
    this.flush();
  }

  /**
   * A route change while the glass is held waits for the turn's end. Not held: it runs now. The
   * order is kept, and a release runs every waiting change on the same tick it lets go.
   */
  defer(change: () => void): boolean {
    if (!this.state.held) {
      change();
      return false;
    }
    this.queue.push(change);
    this.set({ deferred: this.queue.length });
    return true;
  }

  /** Forget the waiting route changes without running them: the learner went somewhere else. */
  drop(): void {
    this.queue = [];
    this.set({ deferred: 0 });
  }

  subscribe = (listener: (state: GlassHoldState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Test seam. */
  reset(): void {
    this.queue = [];
    this.release('end');
    this.set({ released: null, deferred: 0 });
  }

  // --- internals ---------------------------------------------------------------------------------

  private flush(): void {
    if (this.queue.length === 0) return;
    const waiting = this.queue;
    this.queue = [];
    this.set({ deferred: 0 });
    for (const change of waiting) change();
  }

  private set(patch: Partial<GlassHoldState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener(this.state);
  }

  private attach(): void {
    if (this.attached || !this.target) return;
    this.attached = true;
    this.target.addEventListener('keydown', this.onKeyDown, { capture: true });
    this.target.addEventListener('pointerdown', this.onPointerDown, {
      capture: true,
      passive: true,
    });
  }

  private detach(): void {
    if (!this.attached || !this.target) return;
    this.attached = false;
    this.target.removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.target.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
  }

  private readonly onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Escape') this.release('escape');
  };

  /** A tap on the glass. The scroll half already lets a finger that was moving finish. */
  private readonly onPointerDown = (): void => {
    this.release('tap');
  };
}

/** The one glass hold the app shares. */
export const glassHold = new GlassHold();
