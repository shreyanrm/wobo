/**
 * The scroll hold — the page stands still while Wobo's pen is moving on it (the owner, 2026-09-05:
 * "make sure it locks scroll while it draws so that it doesn't become irrelevant").
 *
 * Ink that has landed does not need this: every mark is anchored to a registry target and the
 * registry re-measures on scroll, so finished ink follows the thing it is about wherever the page
 * goes. What does need it is a stroke IN PROGRESS. An arc drawn over three hundred milliseconds
 * while its target slides under it looks wrong, however faithfully the arc is re-anchored each
 * frame. So the hold is exactly as long as a stroke and not a millisecond more: a surface holds
 * while one of its page-anchored strokes is mid-flight and releases the frame it lands, and the
 * registry re-anchors on the release.
 *
 * Three limits keep it a courtesy rather than a cage. It never holds longer than `MAX_HOLD_MS`,
 * whatever a surface says, so a stroke that never reports landing cannot pin the page. Escape
 * releases it. And on a phone a finger that was already moving when the stroke began is left
 * alone: the hold only ever refuses a gesture that starts while it is holding.
 *
 * For that last rule to be true the fingers have to be watched BEFORE anything is drawing, which
 * is why the touch tracking is attached the moment the hold is made and never only while a
 * surface is mounted. It used to attach on `watch()`, which the overlay called on the frame the
 * first mark of a turn arrived, so a finger that landed a moment earlier was never recorded and
 * the first stroke of every turn refused it (measured in the app, 2026-09-05). The listeners are
 * passive and cost nothing while nothing is held.
 *
 * No DOM is assumed: the event target and the clock are injectable, so every rule here runs in a
 * plain test. `scrollHold` is the one instance the app shares.
 */

export interface HoldTarget {
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: EventListenerOptions | boolean,
  ): void;
}

/** Longer than the longest stroke the pen draws (1200 ms), shorter than a learner's patience. */
export const MAX_HOLD_MS = 1500;

/** The keys that scroll a page when nothing is typing. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

interface TouchLike {
  identifier: number;
}

function isTyping(node: EventTarget | null): boolean {
  const element = node as { tagName?: unknown; isContentEditable?: boolean } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true
  );
}

export interface ScrollHoldOptions {
  /** Where scroll events arrive. `window` in the app; a plain `EventTarget` in a test. */
  target?: HoldTarget | null;
  clock?: () => number;
  /**
   * The cap. `MAX_HOLD_MS` for a stroke; the glass hold (glass/hold.ts) makes its own instance
   * with a turn's cap, because it holds for a turn, not a stroke.
   */
  maxHoldMs?: number;
}

export class ScrollHold {
  private readonly target: HoldTarget | null;
  private readonly clock: () => number;
  private readonly maxHoldMs: number;
  /** Who is holding, and since when — a surface per in-flight stroke set. */
  private readonly holders = new Map<string, number>();
  private readonly listeners = new Set<(held: boolean) => void>();
  /** Fingers on the glass right now, and when each landed. */
  private readonly touches = new Map<number, number>();
  private watchers = 0;
  private attached = false;
  private heldSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ScrollHoldOptions = {}) {
    this.target =
      options.target === undefined
        ? typeof window === 'undefined'
          ? null
          : (window as unknown as HoldTarget)
        : options.target;
    this.clock =
      options.clock ??
      (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.maxHoldMs = options.maxHoldMs ?? MAX_HOLD_MS;
    this.track();
  }

  /** True while any surface is holding the page. */
  get held(): boolean {
    return this.heldSince !== null;
  }

  /** Board-clock instant the hold began, or null. */
  since(): number | null {
    return this.heldSince;
  }

  /**
   * A surface saying it is mounted. The fingers are watched from construction regardless (see the
   * header), so this changes nothing about what is tracked; it is kept so a surface can still
   * declare itself and so the count is there to read in a test.
   */
  watch(): () => void {
    this.watchers += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.watchers -= 1;
    };
  }

  /** How many surfaces have declared themselves. */
  get watching(): number {
    return this.watchers;
  }

  /** Touch tracking, on from the start and never off: it is what "already moving" is read from. */
  private track(): void {
    if (!this.target) return;
    this.target.addEventListener('touchstart', this.onTouchStart, {
      capture: true,
      passive: true,
    });
    this.target.addEventListener('touchend', this.onTouchEnd, { capture: true, passive: true });
    this.target.addEventListener('touchcancel', this.onTouchEnd, {
      capture: true,
      passive: true,
    });
  }

  /** A surface's strokes are mid-flight (`on`) or have all landed (`off`). Idempotent. */
  set(token: string, on: boolean): void {
    if (on) this.hold(token);
    else this.release(token);
  }

  hold(token: string): void {
    const now = this.clock();
    if (this.heldSince !== null && now - this.heldSince >= this.maxHoldMs) {
      // The cap: whatever is still holding has held long enough. Start over honestly.
      this.releaseAll();
    }
    const fresh = this.holders.size === 0;
    if (!this.holders.has(token)) this.holders.set(token, now);
    if (!fresh) return;
    this.heldSince = now;
    this.attach();
    this.armTimer();
    this.emit(true);
  }

  release(token: string): void {
    if (!this.holders.delete(token)) return;
    if (this.holders.size > 0) return;
    this.finish();
  }

  /** Every hold, at once — Escape, the cap, or a turn being cut off. */
  releaseAll(): void {
    if (this.holders.size === 0) return;
    this.holders.clear();
    this.finish();
  }

  /** Told on every change: `true` as the page is held, `false` the moment it is let go. */
  subscribe(listener: (held: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test seam. */
  reset(): void {
    this.releaseAll();
  }

  // --- internals ---------------------------------------------------------------------------------

  private finish(): void {
    this.heldSince = null;
    this.detach();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.emit(false);
  }

  private emit(held: boolean): void {
    for (const listener of this.listeners) listener(held);
  }

  private armTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (typeof setTimeout !== 'function') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.releaseAll();
    }, this.maxHoldMs);
  }

  /** True when the cap has passed — the hold lets go rather than refuse one more event. */
  private expired(): boolean {
    if (this.heldSince === null) return true;
    if (this.clock() - this.heldSince < this.maxHoldMs) return false;
    this.releaseAll();
    return true;
  }

  private attach(): void {
    if (this.attached || !this.target) return;
    this.attached = true;
    this.target.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    this.target.addEventListener('touchmove', this.onTouchMove, { capture: true, passive: false });
    this.target.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  private detach(): void {
    if (!this.attached || !this.target) return;
    this.attached = false;
    this.target.removeEventListener('wheel', this.onWheel, { capture: true });
    this.target.removeEventListener('touchmove', this.onTouchMove, { capture: true });
    this.target.removeEventListener('keydown', this.onKeyDown, { capture: true });
  }

  private readonly onWheel = (event: Event): void => {
    if (this.expired()) return;
    event.preventDefault();
  };

  private readonly onTouchMove = (event: Event): void => {
    if (this.expired()) return;
    const since = this.heldSince as number;
    const moving = Array.from(
      ((event as unknown as { changedTouches?: ArrayLike<TouchLike> }).changedTouches ??
        []) as ArrayLike<TouchLike>,
    );
    // A finger that was already moving when the stroke began keeps its scroll: the learner was
    // mid-gesture, and taking it from them is worse than a wobbly arc.
    const before = moving.some((t) => (this.touches.get(t.identifier) ?? since) < since);
    if (before) return;
    event.preventDefault();
  };

  private readonly onKeyDown = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Escape') {
      this.releaseAll();
      return;
    }
    if (this.expired()) return;
    const e = event as KeyboardEvent;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!SCROLL_KEYS.has(key) || isTyping(e.target)) return;
    event.preventDefault();
  };

  private readonly onTouchStart = (event: Event): void => {
    const now = this.clock();
    const changed = (event as unknown as { changedTouches?: ArrayLike<TouchLike> }).changedTouches;
    for (const t of Array.from(changed ?? [])) this.touches.set(t.identifier, now);
  };

  private readonly onTouchEnd = (event: Event): void => {
    const changed = (event as unknown as { changedTouches?: ArrayLike<TouchLike> }).changedTouches;
    for (const t of Array.from(changed ?? [])) this.touches.delete(t.identifier);
  };
}

/** The one hold the app shares: every surface that draws on the page holds and releases here. */
export const scrollHold = new ScrollHold();
