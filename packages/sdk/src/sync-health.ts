/**
 * WHETHER THE LEARNER'S WORK IS ACTUALLY LANDING.
 *
 * Five places used to catch a failed write and throw it away: the learner-state push, the thread
 * push, the mastery push, the outbox flush, and the profile sync. Meanwhile the boot loader's last
 * word is "Your place is saved". So a child could work for an hour against a database that was
 * refusing every write, be told the whole time that their place was safe, and lose it. That is the
 * same category of failure as a false claim on a page, except the cost is their work.
 *
 * This is the counter that makes the claim answerable. Every remote write reports here. One failure
 * is weather: a tunnel, a flaky minute, a token mid-refresh, and the very next push carries
 * everything anyway because the local cache is always the source. A RUN of failures is different in
 * kind, and past `SYNC_TROUBLE_AFTER` of them in a row the app is allowed to say one calm sentence
 * with a way to try again.
 *
 * What this deliberately is not:
 *   - a wall. Nothing here blocks a lesson, a turn, or a save to this device.
 *   - an alarm. No stack trace, no status code, no red. `lastError` exists for a developer reading
 *     a console, and is never rendered.
 *   - a queue. The cache is the queue; this only counts and remembers how to try again.
 */

/** The stores whose writes a learner would actually miss. */
export type SyncStore = 'progress' | 'conversation' | 'mastery' | 'events' | 'profile';

/**
 * How many consecutive failures before the learner is told. Three, because every write here is
 * debounced by roughly a second and a half, so three in a row is several seconds of a store
 * genuinely refusing rather than one bad packet.
 */
export const SYNC_TROUBLE_AFTER = 3;

export interface SyncStatus {
  /** True once any store has failed `SYNC_TROUBLE_AFTER` times running. */
  troubled: boolean;
  /** Which stores are past the threshold. Sorted, so a render never flickers on key order. */
  stores: SyncStore[];
  /** When the current run of failures began (ISO), or null when nothing is failing. */
  since: string | null;
  /** True while `retry()` is in flight, so a button can say so instead of looking dead. */
  retrying: boolean;
}

const NO_TROUBLE: SyncStatus = { troubled: false, stores: [], since: null, retrying: false };

interface StoreState {
  consecutive: number;
  since: string | null;
  lastError?: string;
  retry?: () => Promise<unknown>;
}

/**
 * The counter itself. One instance per SDK, handed to every provider that writes remotely.
 *
 * Deliberately synchronous and allocation-light: `note` runs on the failure path of a debounced
 * push, and `status()` is read from a React render.
 */
export class SyncHealth {
  private readonly stores = new Map<SyncStore, StoreState>();
  private readonly listeners = new Set<() => void>();
  private retrying = false;
  private cached: SyncStatus = NO_TROUBLE;

  constructor(private readonly threshold = SYNC_TROUBLE_AFTER) {}

  private stateOf(store: SyncStore): StoreState {
    let state = this.stores.get(store);
    if (!state) {
      state = { consecutive: 0, since: null };
      this.stores.set(store, state);
    }
    return state;
  }

  /**
   * How to push this store again, on demand. Registered by the provider that owns the write, so the
   * retry button runs the real push rather than a reimplementation of it that could drift.
   */
  register(store: SyncStore, retry: () => Promise<unknown>): void {
    this.stateOf(store).retry = retry;
  }

  /** A write landed. The run resets: a store that is working is not a store to warn about. */
  succeeded(store: SyncStore): void {
    const state = this.stateOf(store);
    if (state.consecutive === 0 && state.since === null) return;
    state.consecutive = 0;
    state.since = null;
    delete state.lastError;
    this.announce();
  }

  /** A write did not land. Counted, remembered, and never thrown at the learner. */
  failed(store: SyncStore, err?: unknown): void {
    const state = this.stateOf(store);
    state.consecutive += 1;
    state.since ??= new Date().toISOString();
    state.lastError =
      err instanceof Error ? err.message : err === undefined ? undefined : String(err);
    this.announce();
  }

  /** The last refusal this store saw. A developer's diagnostic; never shown to a learner. */
  lastError(store: SyncStore): string | undefined {
    return this.stores.get(store)?.lastError;
  }

  /** How many failures in a row this store has seen. Zero when it is working. */
  consecutiveFailures(store: SyncStore): number {
    return this.stores.get(store)?.consecutive ?? 0;
  }

  status(): SyncStatus {
    return this.cached;
  }

  private compute(): SyncStatus {
    const troubled: SyncStore[] = [];
    let since: string | null = null;
    for (const [store, state] of this.stores) {
      if (state.consecutive < this.threshold) continue;
      troubled.push(store);
      if (state.since && (since === null || state.since < since)) since = state.since;
    }
    troubled.sort();
    return { troubled: troubled.length > 0, stores: troubled, since, retrying: this.retrying };
  }

  private announce(): void {
    const next = this.compute();
    const prev = this.cached;
    const same =
      next.troubled === prev.troubled &&
      next.since === prev.since &&
      next.retrying === prev.retrying &&
      next.stores.length === prev.stores.length &&
      next.stores.every((s, i) => s === prev.stores[i]);
    // A stable object identity while nothing has changed keeps `useSyncExternalStore` from looping.
    if (same) return;
    this.cached = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Push everything that is behind, right now. Only the stores past the threshold are retried, so
   * the button does exactly what its sentence says and nothing extra.
   *
   * Never rejects: a retry that fails is another failure, counted like any other, and the learner
   * sees the same calm line rather than an error. At most one runs at a time.
   */
  async retry(): Promise<void> {
    if (this.retrying) return;
    const behind = [...this.stores.entries()].filter(
      ([, state]) => state.consecutive >= this.threshold && state.retry,
    );
    if (behind.length === 0) return;
    this.retrying = true;
    this.announce();
    try {
      await Promise.all(
        behind.map(async ([store, state]) => {
          try {
            await state.retry?.();
            // A retry that resolved without the provider reporting success still counts as landed:
            // the push path reports on its own, and a double report is a no-op.
            this.succeeded(store);
          } catch (err) {
            this.failed(store, err);
          }
        }),
      );
    } finally {
      this.retrying = false;
      this.announce();
    }
  }
}
