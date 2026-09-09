/**
 * The board's memory. One ordered list of objects, an index by id, and the event log — so Wobo can
 * come back to anything Wobo drew ("this one"), the learner can scrub the history, and the board can
 * be saved as objects rather than pixels (docs/BOARD.md §2, §9).
 *
 * No React and no DOM: the store is a plain observable object, which is what lets the renderer
 * subscribe with `useSyncExternalStore` and lets every rule here be tested without a browser.
 *
 * **The utterance clock.** Every `t.start` in the grammar is relative to the start of the current
 * utterance. `beginUtterance()` sets that zero; `speech.tsx` owns the voice, so the integration
 * (Worker 4) calls it as a turn's first sentence begins. Until it is called the clock is simply
 * wall time, which is exactly right for ink with no timing of its own.
 */

import type {
  Anchor,
  BoardEvent,
  BoardObject,
  BoardPatch,
  BoardStyle,
  InkPayload,
  Presentation,
} from './schema';
import { isDrawable, isPatch } from './schema';

/** One object on the board, with everything that has happened to it since. */
export interface BoardObjectState {
  object: BoardObject;
  /** Insertion order — stable across patches, so redraws never jump the z-order. */
  seq: number;
  /** Board-clock ms when the pen starts this object. */
  startAt: number;
  /** Draw time in ms; undefined lets the pen decide from the stroke's own length. */
  durMs?: number;
  /** How long the ink lives after it lands; undefined = as long as the surface keeps it. */
  ttl?: number;
  /** An anchor set later by a repoint/move patch — the object's own anchor is never rewritten. */
  anchor?: Anchor;
  /** A style set later by a restyle patch. */
  style?: BoardStyle;
  /** Board-clock ms when a fade began (a `fade` patch, or the swipe of an `erase`). */
  fadingAt?: number;
  /** Bumped by `redraw`, so the pen genuinely goes again rather than re-showing the same ink. */
  generation: number;
  /** Off the board: wiped, erased, or removed. Kept for the timeline. */
  removed: boolean;
}

/** An event as it arrived, with the board-clock time it landed — the scrubbable history. */
export interface BoardLogEntry {
  at: number;
  event: BoardEvent;
}

export type Listener = () => void;

/**
 * How long ink lives by default on each surface. None of them expire on their own any more: screen
 * ink holds until the question it points at is answered, the learner interrupts, or the next turn
 * begins, and the conductor releases it then (`release`). The six-second screen life used to fade
 * a ring 234 ms before Wobo asked "what do you notice about it?" (docs/INK-FREEZE-PLAN-TRACE.md
 * §4). An explicit `t.ttl` on an object is still honoured.
 */
export const DEFAULT_TTL: Record<Presentation, number | undefined> = {
  screen: undefined,
  plane: undefined,
  full: undefined,
};

/** How long a fade takes once it starts. */
export const FADE_MS = 480;

/** The most objects the renderer paints at once; older ink is virtualised out of the DOM. */
export const RENDER_BUDGET = 2000;

/**
 * The most events one board's log keeps. The log is the scrubber's source (`timeline.ts`), and a
 * scrubber cannot show more than a board's worth of history anyway — but it is also the only thing
 * here that grows without bound, and it holds whole point arrays. Two hundred turns of twenty
 * objects left four thousand entries alive for the life of the tab with nothing reading them.
 */
export const MAX_LOG = 4000;
/** How much of the log is dropped when it is full — a slab, so the trim is not once per event. */
const LOG_TRIM = 512;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface BoardStoreOptions {
  presentation?: Presentation;
  /** Injectable clock, so the tests are not at the mercy of wall time. */
  clock?: () => number;
}

export class BoardStore {
  readonly presentation: Presentation;
  private readonly clock: () => number;
  private readonly order: BoardObjectState[] = [];
  private readonly index = new Map<string, BoardObjectState>();
  private readonly listeners = new Set<Listener>();
  private seq = 0;
  private utteranceAt: number | null = null;
  private snapshotCache: BoardObjectState[] | null = null;
  /** Every event this board has seen, for the timeline and for export. */
  readonly log: BoardLogEntry[] = [];
  /** Numbers the verifier never passed. The hand refuses them; QA reads them here. */
  readonly refused: BoardObject[] = [];
  /** The last `ask` Wobo is waiting on, if any. */
  pendingAsk: { prompt: string; targets: string[] } | null = null;
  /** True once `done` has landed for the current turn. */
  turnDone = false;

  constructor(opts: BoardStoreOptions = {}) {
    this.presentation = opts.presentation ?? 'plane';
    this.clock = opts.clock ?? now;
  }

  time(): number {
    return this.clock();
  }

  /** Zero the utterance clock: every `t.start` from here is measured from this instant. */
  beginUtterance(at: number = this.clock()): void {
    this.utteranceAt = at;
    this.turnDone = false;
    this.pendingAsk = null;
    this.emit();
  }

  /** The board-clock instant an object with this `t.start` should begin. */
  private startFor(startMs: number | undefined): number {
    const base = this.utteranceAt ?? this.clock();
    return startMs === undefined ? this.clock() : base + startMs;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    this.snapshotCache = null;
    for (const l of this.listeners) l();
  }

  /** A stable array of every object still on the board, oldest first. */
  snapshot(): BoardObjectState[] {
    if (!this.snapshotCache) this.snapshotCache = this.order.filter((s) => !s.removed);
    return this.snapshotCache;
  }

  /** Everything, including what has been wiped — the timeline's source. */
  history(): readonly BoardObjectState[] {
    return this.order;
  }

  get(id: string): BoardObjectState | undefined {
    return this.index.get(id);
  }

  /** The list the renderer paints: the newest `RENDER_BUDGET` objects. */
  renderable(budget = RENDER_BUDGET): BoardObjectState[] {
    const live = this.snapshot();
    return live.length > budget ? live.slice(live.length - budget) : live;
  }

  /** Apply one streamed event. Unknown or unverified content is refused, never drawn. */
  applyEvent(event: BoardEvent): void {
    this.log.push({ at: this.clock(), event });
    if (this.log.length > MAX_LOG) this.log.splice(0, LOG_TRIM);
    switch (event.type) {
      case 'ink':
        this.ink(event.object);
        return;
      case 'ask':
        this.pendingAsk = { prompt: event.prompt, targets: event.targets ?? [] };
        this.emit();
        return;
      case 'done':
        this.turnDone = true;
        this.emit();
        return;
      default:
        // say / action / card are the companion's business, not the hand's; the log keeps them so
        // the timeline can replay a whole turn.
        this.emit();
    }
  }

  /** Place an object, or apply a patch to one already drawn. */
  ink(payload: InkPayload): void {
    if (isPatch(payload)) {
      this.patch(payload);
      return;
    }
    this.place(payload);
  }

  private place(object: BoardObject): void {
    if (!isDrawable(object)) {
      // Law: every number on a board is computed by code and verified before it is drawn.
      this.refused.push(object);
      this.emit();
      return;
    }
    if (object.kind === 'wipe') {
      this.wipe(object);
      return;
    }
    const existing = this.index.get(object.id);
    const t = 't' in object ? object.t : undefined;
    const state: BoardObjectState = {
      object,
      seq: existing ? existing.seq : this.seq++,
      startAt: this.startFor(t?.start),
      ...(t?.dur !== undefined ? { durMs: t.dur } : {}),
      ttl: t?.ttl ?? DEFAULT_TTL[this.presentation],
      generation: existing ? existing.generation + 1 : 0,
      removed: false,
    };
    if (existing) {
      const at = this.order.indexOf(existing);
      if (at >= 0) this.order[at] = state;
      else this.order.push(state);
    } else {
      this.order.push(state);
    }
    this.index.set(object.id, state);
    if (object.kind === 'erase') {
      const target = this.index.get(object.object);
      if (target) target.fadingAt = state.startAt + (state.durMs ?? 420) * 0.5;
    }
    this.emit();
  }

  private wipe(object: BoardObject): void {
    const at = this.startFor('t' in object && object.t ? object.t.start : undefined);
    for (const s of this.order) {
      if (!s.removed && s.object.kind !== 'wipe') s.fadingAt = at + 220;
    }
    const state: BoardObjectState = {
      object,
      seq: this.seq++,
      startAt: at,
      ttl: 1400,
      generation: 0,
      removed: false,
    };
    this.order.push(state);
    this.index.set(object.id, state);
    this.emit();
  }

  private patch(patch: BoardPatch): void {
    const state = this.index.get(patch.id);
    if (!state) return;
    switch (patch.kind) {
      case 'fade':
        state.fadingAt = this.startFor(patch.t?.start);
        break;
      case 'remove':
        state.removed = true;
        break;
      case 'redraw':
        state.generation += 1;
        state.startAt = this.startFor(patch.t?.start);
        state.fadingAt = undefined;
        state.removed = false;
        if (patch.t?.dur !== undefined) state.durMs = patch.t.dur;
        break;
      case 'repoint':
      case 'move':
        state.anchor = patch.anchor;
        if (patch.kind === 'move') {
          state.generation += 1;
          state.startAt = this.startFor(patch.t?.start);
        }
        break;
      case 'restyle':
        state.style = patch.style;
        break;
    }
    this.emit();
  }

  /** The anchor in force for an object — a repoint wins over the anchor it was born with. */
  anchorOf(state: BoardObjectState): Anchor | undefined {
    if (state.anchor) return state.anchor;
    return 'anchor' in state.object ? state.object.anchor : undefined;
  }

  /** The style in force — a restyle wins over the style it was born with. */
  styleOf(state: BoardObjectState): BoardStyle | undefined {
    return state.style ?? state.object.style;
  }

  /**
   * Drop everything: a fresh board.
   *
   * The log goes with it. It used to be kept behind a `keepLog` flag every caller passed, and the
   * flag was a leak dressed as a feature: the timeline reads the log for its marks but the objects
   * and the range from `history()`, which reset clears — so a kept log described ink that no longer
   * existed and nothing could reach. A wipe the learner can scrub back through is the `wipe` OBJECT
   * (BOARD.md §2), which fades the board and keeps its history; this is "fresh board", which forgets.
   */
  reset(): void {
    this.order.length = 0;
    this.index.clear();
    this.refused.length = 0;
    this.log.length = 0;
    this.seq = 0;
    this.utteranceAt = null;
    this.pendingAsk = null;
    this.turnDone = false;
    this.emit();
  }

  /**
   * Let the ink go: everything live begins to fade at `at` (now by default, or a moment later for
   * the linger after a turn with no question). A fade already under way is left alone, so a second
   * release never restarts one. The objects stay until `sweep` forgets what has finished fading.
   */
  release(at: number = this.clock()): void {
    let changed = false;
    for (const s of this.order) {
      if (s.removed || s.object.kind === 'wipe') continue;
      if (s.fadingAt !== undefined && s.fadingAt <= at) continue;
      s.fadingAt = at;
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Forget ink whose fade finished before `now`, so a long session does not keep every turn. */
  sweep(now: number = this.clock()): void {
    let changed = false;
    for (const s of this.order) {
      if (s.removed || s.fadingAt === undefined) continue;
      if (s.fadingAt + FADE_MS <= now) {
        s.removed = true;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /**
   * The pen lifts where it is: everything still drawing stops mid-stroke and stays. Returns the id
   * of the object the nib was on, which is what the brain is told it was interrupted at.
   */
  interrupt(at: number = this.clock()): string | null {
    let interruptedAt: string | null = null;
    for (const s of this.snapshot()) {
      const dur = s.durMs ?? 0;
      if (at >= s.startAt && (dur === 0 || at <= s.startAt + dur)) interruptedAt = s.object.id;
      if (s.startAt > at) s.removed = true; // ink that had not begun never lands
    }
    this.emit();
    return interruptedAt;
  }
}

/** Serialise a board to objects (never pixels) — "save to notes". */
export function serializeBoard(store: BoardStore): { objects: BoardObject[] } {
  return { objects: store.snapshot().map((s) => s.object) };
}

/** Restore a saved board. Timings are dropped: restored ink is simply there. */
export function restoreBoard(store: BoardStore, objects: BoardObject[]): void {
  store.reset();
  for (const object of objects) store.ink({ ...object, t: { start: 0, dur: 1 } } as BoardObject);
}
