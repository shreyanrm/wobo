import type { SupabaseRest } from './supabase';
import type { SyncHealth } from './sync-health';

/**
 * The learner-state persistence seam. One shape (`LearnerState`) backs XP, the identity streak,
 * topic progress, and the mind snapshot; one shape (`ThreadSnapshot`) backs Wobo's conversation.
 * Mock/local mode persists to localStorage only. Live mode keeps localStorage as the offline cache
 * and reconciles with `learner.learner_state` / `learner.learner_threads` (RLS: subject_id =
 * auth.uid()) — hydrate on boot, merge on write. The merge functions are pure and tested.
 */

export interface LearnerState {
  xp: number;
  streakDays: number;
  /** YYYY-MM-DD of the last earned moment — drives the identity streak roll-forward. */
  lastActiveDay: string;
  completedTopics: string[];
  /** Furthest fraction reached inside each topic's course (0..1). */
  topicProgress: Record<string, number>;
  /** One-time award keys already granted (account, profile_photo, …). */
  awardedOnce: string[];
  /** Streak-freeze budget: repairs of a broken streak against a monthly allowance (family P). */
  streakFreezes: { month: string; used: number };
  /** A recently-broken streak awaiting a possible freeze-repair (within the repair window). */
  brokenStreak?: { days: number; brokenOn: string };
  /** The per-learner mind snapshot (preferences, profile touches, twin marks) — free-form, no PII. */
  mind: Record<string, unknown>;
  /** ISO stamp of the last local mutation — latest-wins fields reconcile on it. */
  updatedAt: string;
}

export interface ThreadTurn {
  id: string;
  role: 'user' | 'wobo';
  text: string;
}

export interface ThreadSnapshot {
  turns: ThreadTurn[];
  updatedAt: string;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyLearnerState(): LearnerState {
  return {
    xp: 0,
    streakDays: 1,
    lastActiveDay: todayISO(),
    completedTopics: [],
    topicProgress: {},
    awardedOnce: [],
    streakFreezes: { month: todayISO().slice(0, 7), used: 0 },
    mind: {},
    updatedAt: new Date().toISOString(),
  };
}

/** Fill defaults over a legacy/partial persisted shape (pre-live caches lack mind/updatedAt). */
export function normalizeLearnerState(raw: Partial<LearnerState> | null | undefined): LearnerState {
  const empty = emptyLearnerState();
  if (!raw || typeof raw !== 'object') return empty;
  return {
    xp: typeof raw.xp === 'number' ? raw.xp : empty.xp,
    streakDays: typeof raw.streakDays === 'number' ? raw.streakDays : empty.streakDays,
    lastActiveDay: raw.lastActiveDay ?? empty.lastActiveDay,
    completedTopics: raw.completedTopics ?? [],
    topicProgress: raw.topicProgress ?? {},
    awardedOnce: raw.awardedOnce ?? [],
    streakFreezes:
      raw.streakFreezes && typeof raw.streakFreezes.month === 'string'
        ? { month: raw.streakFreezes.month, used: Math.max(0, raw.streakFreezes.used || 0) }
        : empty.streakFreezes,
    brokenStreak:
      raw.brokenStreak &&
      typeof raw.brokenStreak.days === 'number' &&
      typeof raw.brokenStreak.brokenOn === 'string'
        ? { days: raw.brokenStreak.days, brokenOn: raw.brokenStreak.brokenOn }
        : undefined,
    mind: raw.mind ?? {},
    updatedAt: raw.updatedAt ?? empty.updatedAt,
  };
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reconcile two copies of the learner's state (local cache vs remote row). Order-independent:
 * monotonic fields take the max, sets union, the streak follows the later active day (continuing
 * it when the other device kept the chain alive one day earlier), and the mind is a shallow merge
 * with the fresher copy on top.
 * ponytail: xp is max, not summed per-device deltas — two devices grinding simultaneously keep the
 * larger counter; switch to delta accounting if dual-device play becomes real.
 */
export function mergeLearnerState(a: LearnerState, b: LearnerState): LearnerState {
  const [earlier, later] = a.lastActiveDay <= b.lastActiveDay ? [a, b] : [b, a];
  let streakDays: number;
  if (earlier.lastActiveDay === later.lastActiveDay) {
    streakDays = Math.max(a.streakDays, b.streakDays);
  } else if (nextDay(earlier.lastActiveDay) === later.lastActiveDay) {
    // The other device was active the day before — the chain continues through it.
    streakDays = Math.max(later.streakDays, earlier.streakDays + 1);
  } else {
    streakDays = later.streakDays;
  }

  const topicProgress: Record<string, number> = { ...a.topicProgress };
  for (const [id, f] of Object.entries(b.topicProgress)) {
    topicProgress[id] = Math.max(topicProgress[id] ?? 0, f);
  }

  const [staler, fresher] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];

  // Streak-freeze budget: within one month keep the higher spend; a newer month resets naturally.
  const [fa, fb] = [a.streakFreezes, b.streakFreezes];
  const streakFreezes =
    fa.month === fb.month
      ? { month: fa.month, used: Math.max(fa.used, fb.used) }
      : fa.month > fb.month
        ? fa
        : fb;
  // ponytail: the fresher write wins on the pending break, so a repair (which clears it) propagates
  // across devices — the budget and the pending break both ride the row (migration 0007).
  const brokenStreak = fresher.brokenStreak;

  return {
    xp: Math.max(a.xp, b.xp),
    streakDays,
    lastActiveDay: later.lastActiveDay,
    completedTopics: [...new Set([...a.completedTopics, ...b.completedTopics])],
    topicProgress,
    awardedOnce: [...new Set([...a.awardedOnce, ...b.awardedOnce])],
    streakFreezes,
    brokenStreak,
    mind: { ...staler.mind, ...fresher.mind },
    updatedAt: fresher.updatedAt,
  };
}

/**
 * Reconcile two copies of a conversation. Whole-thread latest-wins (a conversation is one document,
 * not a CRDT); on an equal stamp the longer transcript wins.
 * ponytail: no per-turn merge — interleaving two devices' turns mid-flight isn't worth it yet.
 */
export function mergeThread(a: ThreadSnapshot, b: ThreadSnapshot): ThreadSnapshot {
  if (a.updatedAt === b.updatedAt) return a.turns.length >= b.turns.length ? a : b;
  return a.updatedAt > b.updatedAt ? a : b;
}

// --- Providers ------------------------------------------------------------------------------------

/** The slice of Web Storage the providers need (injectable for tests / non-DOM runtimes). */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /**
   * Optional so an older caller's plain `{get,set}` object still satisfies the seam. Adoption needs
   * a key to actually LEAVE the device, so `dropKey` below falls back to writing an empty value,
   * which every reader here already treats as "nothing stored".
   */
  removeItem?(key: string): void;
}

/**
 * Take a key off the device. `removeItem` when the storage has one; otherwise an empty value, which
 * `loadCache` and `loadThreadCache` both read as absent. Never throws: a storage that refuses the
 * write leaves the key, and the caller is no worse off than before it tried.
 */
function dropKey(storage: KVStorage, key: string): void {
  try {
    if (storage.removeItem) storage.removeItem(key);
    else storage.setItem(key, '');
  } catch {
    // private mode or quota — nothing to do, and never a broken boot
  }
}

class MemoryStorage implements KVStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function defaultStorage(): KVStorage {
  const ls = (globalThis as { localStorage?: KVStorage }).localStorage;
  return ls ?? new MemoryStorage();
}

/** The same keys the app has always used, so existing devices carry their progress over. */
export const STATE_CACHE_KEY = 'wobo-progress-v1';
function threadCacheKey(thread: string): string {
  return thread === 'wobo' ? 'wobo-conversation-v1' : `wobo-thread-${thread}-v1`;
}

/**
 * The unscoped buckets written before this device had a signed-in subject. The FIRST subject to
 * claim the device inherits them; everyone after starts clean (store/scope.ts holds the same law
 * for the app-side stores) — a sibling signing in on the family tablet must never be handed the
 * other learner's progress or conversation.
 */
const ADOPTABLE_KEYS: readonly string[] = [
  STATE_CACHE_KEY,
  threadCacheKey('wobo'),
  'wobo-vidya-conversation-v1',
];

/** Records WHICH subject adopted the legacy bucket, so adoption happens exactly once per device. */
export const ADOPTED_MARKER_KEY = 'wobo-state-adopted-v1';

/**
 * Pre-rebrand thread ids. The tutor was called Vidya, so Wobo's thread — its localStorage key, its
 * `learner_threads.thread` value, and the `role` on every turn Wobo spoke — was written as 'vidya'.
 * Reads fall back through this map so a device or account that predates the rename carries its
 * conversation over; writes only ever use the new id, so each thread migrates on first save.
 */
const LEGACY_THREAD_IDS: Record<string, string> = { wobo: 'vidya' };

/** The pre-rebrand localStorage key for a thread (unscoped); null when the thread has no past. */
function legacyThreadCacheKey(thread: string): string | null {
  return thread === 'wobo' ? 'wobo-vidya-conversation-v1' : null;
}

/** Rewrite the speaker on turns persisted before the rename. */
function normalizeTurns(turns: ThreadTurn[]): ThreadTurn[] {
  return turns.map((t) => ((t.role as string) === 'vidya' ? { ...t, role: 'wobo' as const } : t));
}

export interface StateProvider {
  /** Synchronous read of the local cache — the boot value before any network. */
  loadCache(): LearnerState;
  /** Reconcile with the remote store (a no-op locally); resolves to the merged truth. */
  hydrate(): Promise<LearnerState>;
  /** Merge-on-write: the cache updates immediately; the remote push is debounced. */
  save(state: LearnerState): void;
  loadThreadCache(thread: string): ThreadSnapshot | null;
  hydrateThread(thread: string): Promise<ThreadSnapshot | null>;
  saveThread(thread: string, turns: ThreadTurn[]): void;
}

/** localStorage-only persistence — mock/local mode, fully working keyless. */
export class LocalStateProvider implements StateProvider {
  constructor(
    protected readonly storage: KVStorage = defaultStorage(),
    // Scopes the cache to one account so two learners on the same browser never share a bucket.
    // Empty = legacy single-user local build (keeps the historical key so existing devices carry
    // over). Live mode passes the per-user subjectId, so a different account reads an empty bucket.
    protected readonly scope = '',
  ) {
    if (this.scope) this.adoptLegacyBucket();
  }

  /**
   * One-time, per-subject: MOVE the pre-scope bucket under this subject's keys. Gated on a marker
   * that names the claiming subject, so it runs once for the learner who was already using this
   * device and never again — a second account reads its own (empty) bucket.
   *
   * It moves rather than copies, and that is the isolation half. A copy left the learner's XP,
   * streak, mind snapshot and entire conversation sitting under the plain key. Every later boot is
   * unscoped for the moment before the session resolves, and an unscoped provider reads the plain
   * key — so the next person to open this browser was handed the previous learner's work as their
   * own. The source always leaves. A scoped value that already exists is the newer truth and is
   * never clobbered, but the plain key goes either way.
   */
  private adoptLegacyBucket(): void {
    try {
      // One-time, full stop: the marker is written before anything moves, so a learner who later
      // clears their own bucket is never handed the stale legacy copy back on the next boot.
      if (this.storage.getItem(ADOPTED_MARKER_KEY) !== null) return;
      this.storage.setItem(ADOPTED_MARKER_KEY, this.scope);
      for (const base of ADOPTABLE_KEYS) {
        const legacy = this.storage.getItem(base);
        if (legacy === null) continue;
        // Never clobber a scoped value that is already there; the plain key still leaves.
        if (this.storage.getItem(this.scoped(base)) === null) {
          this.storage.setItem(this.scoped(base), legacy);
        }
        dropKey(this.storage, base);
      }
    } catch {
      // storage unavailable — a fresh bucket is the correct outcome, never a broken boot
    }
  }

  protected stateKey(): string {
    return this.scope ? `${STATE_CACHE_KEY}:${this.scope}` : STATE_CACHE_KEY;
  }

  /** Apply the account scope to a cache key. */
  protected scoped(base: string): string {
    return this.scope ? `${base}:${this.scope}` : base;
  }

  protected threadKey(thread: string): string {
    return this.scoped(threadCacheKey(thread));
  }

  loadCache(): LearnerState {
    try {
      const raw = this.storage.getItem(this.stateKey());
      return normalizeLearnerState(raw ? (JSON.parse(raw) as Partial<LearnerState>) : null);
    } catch {
      return emptyLearnerState();
    }
  }

  async hydrate(): Promise<LearnerState> {
    return this.loadCache();
  }

  save(state: LearnerState): void {
    try {
      this.storage.setItem(this.stateKey(), JSON.stringify(state));
    } catch {
      // storage unavailable — session-only state is fine
    }
  }

  loadThreadCache(thread: string): ThreadSnapshot | null {
    try {
      const legacyKey = legacyThreadCacheKey(thread);
      const raw =
        this.storage.getItem(this.threadKey(thread)) ??
        (legacyKey ? this.storage.getItem(this.scoped(legacyKey)) : null);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ThreadSnapshot | ThreadTurn[];
      // The pre-live cache stored the bare turns array.
      if (Array.isArray(parsed))
        return { turns: normalizeTurns(parsed), updatedAt: new Date(0).toISOString() };
      return parsed.turns ? { ...parsed, turns: normalizeTurns(parsed.turns) } : null;
    } catch {
      return null;
    }
  }

  async hydrateThread(thread: string): Promise<ThreadSnapshot | null> {
    return this.loadThreadCache(thread);
  }

  saveThread(thread: string, turns: ThreadTurn[]): void {
    try {
      const snapshot: ThreadSnapshot = { turns, updatedAt: new Date().toISOString() };
      this.storage.setItem(this.threadKey(thread), JSON.stringify(snapshot));
    } catch {
      // storage unavailable — session-only is fine
    }
  }
}

type StateRest = Pick<SupabaseRest, 'selectOne' | 'upsert'>;

/**
 * Columns added by migration 0007. A project that has not applied it yet rejects the write with a
 * schema-cache error naming the column, so the writer degrades to the legacy shape (below) rather
 * than losing the whole row — the freeze budget is then local-only until the migration lands.
 */
const STREAK_COLUMNS = ['streak_freezes', 'broken_streak'] as const;

function stateToRow(subjectId: string, s: LearnerState): Record<string, unknown> {
  return {
    subject_id: subjectId,
    xp: s.xp,
    streak_days: s.streakDays,
    last_active_day: s.lastActiveDay,
    completed_topics: s.completedTopics,
    topic_progress: s.topicProgress,
    awarded_once: s.awardedOnce,
    // Family P: the streak-freeze budget and a pending break are the learner's, and must survive a
    // reinstall or a second device — they ride the row like every other counter.
    streak_freezes: s.streakFreezes,
    broken_streak: s.brokenStreak ?? null,
    mind: s.mind,
    client_updated_at: s.updatedAt,
  };
}

/** The same row without the 0007 columns — what a database that predates the migration accepts. */
function withoutStreakColumns(row: Record<string, unknown>): Record<string, unknown> {
  const trimmed = { ...row };
  for (const c of STREAK_COLUMNS) delete trimmed[c];
  return trimmed;
}

/**
 * True when a write failed BECAUSE the 0007 columns are absent, which PostgREST says by naming the
 * column in `PGRST204`.
 *
 * The bare code used to be accepted on its own, as a hope: the rest client discarded the response
 * body, so the column name never reached here and `pgrst204` was the only thing that could ever
 * have matched (it could not either — the message was the status and nothing else). The body is
 * carried now (`supabase.ts`), so the column name is the test. Accepting the bare code today would
 * be a false positive with teeth: a `PGRST204` about some other column would make every later write
 * silently drop the learner's streak-freeze budget for a reason that had nothing to do with it.
 */
function isMissingStreakColumn(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes('pgrst204') && STREAK_COLUMNS.some((c) => message.includes(c));
}

function stateFromRow(row: Record<string, unknown>): LearnerState {
  return normalizeLearnerState({
    xp: row.xp as number,
    streakDays: row.streak_days as number,
    lastActiveDay: (row.last_active_day as string) ?? undefined,
    completedTopics: (row.completed_topics as string[]) ?? [],
    topicProgress: (row.topic_progress as Record<string, number>) ?? {},
    awardedOnce: (row.awarded_once as string[]) ?? [],
    // Absent (pre-0007 database) or null => normalizeLearnerState fills the defaults.
    streakFreezes: (row.streak_freezes as LearnerState['streakFreezes']) ?? undefined,
    brokenStreak: (row.broken_streak as LearnerState['brokenStreak']) ?? undefined,
    mind: (row.mind as Record<string, unknown>) ?? {},
    updatedAt: (row.client_updated_at as string) ?? undefined,
  });
}

/**
 * Live persistence: localStorage stays the offline cache; `learner.learner_state` /
 * `learner.learner_threads` are the remote truth, reconciled through the pure merges above.
 * Remote failures degrade silently to the cache — the learner never loses a session to a network.
 * ponytail: the debounced push is a whole-row upsert (last writer wins inside the window); each
 * device's cache retains its own truth and the next hydrate re-merges, so nothing is lost for good.
 */
export class SupabaseStateProvider extends LocalStateProvider {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private threadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Flips once a write proves this project predates migration 0007; the row then omits them. */
  private streakColumnsAbsent = false;

  constructor(
    private readonly rest: StateRest,
    private readonly subjectId: string,
    storage?: KVStorage,
    private readonly debounceMs = 1500,
    /**
     * Where a failed push is COUNTED. Optional so a test or a local build can leave it out; when it
     * is there, a run of refusals stops being invisible and the app can tell the learner the truth
     * about work that is sitting on this device and nowhere else.
     */
    private readonly health?: SyncHealth,
  ) {
    // Scope the local cache to this account so a second signed-in user on the same browser starts
    // from an empty bucket (then hydrates their own remote row), never the previous user's progress.
    super(storage ?? defaultStorage(), subjectId);
    this.health?.register('progress', () => this.upsertState(this.loadCache()));
    // 'wobo' is the only thread the app writes (AppRuntime.tsx:414) and the only one a learner
    // would miss. Register each new thread here the day a second one exists, or its failures will
    // be counted by the debounced push and retried by nothing.
    this.health?.register('conversation', () => this.pushThread('wobo'));
  }

  /** Write the state row, degrading to the pre-0007 shape if the streak columns are not there. */
  private async upsertState(state: LearnerState): Promise<void> {
    const row = stateToRow(this.subjectId, state);
    try {
      if (this.streakColumnsAbsent) {
        await this.rest.upsert('learner_state', withoutStreakColumns(row), 'subject_id');
      } else {
        try {
          await this.rest.upsert('learner_state', row, 'subject_id');
        } catch (err) {
          if (!isMissingStreakColumn(err)) throw err;
          this.streakColumnsAbsent = true; // remember, so every later write skips the failed attempt
          await this.rest.upsert('learner_state', withoutStreakColumns(row), 'subject_id');
        }
      }
    } catch (err) {
      this.health?.failed('progress', err);
      throw err;
    }
    this.health?.succeeded('progress');
  }

  /**
   * Push one thread's cached snapshot. Split out of the debounce so the retry button runs the same
   * write the timer does, rather than a second copy of it that could drift.
   */
  private async pushThread(thread: string): Promise<void> {
    const snapshot = this.loadThreadCache(thread);
    if (!snapshot) return;
    try {
      await this.rest.upsert(
        'learner_threads',
        {
          subject_id: this.subjectId,
          thread,
          turns: snapshot.turns,
          client_updated_at: snapshot.updatedAt,
        },
        'subject_id,thread',
      );
    } catch (err) {
      this.health?.failed('conversation', err);
      throw err;
    }
    this.health?.succeeded('conversation');
  }

  override async hydrate(): Promise<LearnerState> {
    const local = this.loadCache();
    try {
      const row = await this.rest.selectOne('learner_state', {
        match: { subject_id: this.subjectId },
        select: '*',
      });
      const merged = row ? mergeLearnerState(local, stateFromRow(row)) : local;
      super.save(merged);
      await this.upsertState(merged);
      return merged;
    } catch {
      return local; // offline — the cache is the session's truth; the next boot reconciles
    }
  }

  override save(state: LearnerState): void {
    super.save(state);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.upsertState(this.loadCache()).catch(() => {}); // offline — cache holds; next push
    }, this.debounceMs);
  }

  /** The thread row, falling back to its pre-rebrand id so an existing account keeps its history. */
  private async selectThreadRow(thread: string): Promise<Record<string, unknown> | null> {
    const row = await this.rest.selectOne('learner_threads', {
      match: { subject_id: this.subjectId, thread },
      select: '*',
    });
    if (row) return row;
    const legacy = LEGACY_THREAD_IDS[thread];
    if (!legacy) return null;
    return this.rest.selectOne('learner_threads', {
      match: { subject_id: this.subjectId, thread: legacy },
      select: '*',
    });
  }

  override async hydrateThread(thread: string): Promise<ThreadSnapshot | null> {
    const local = this.loadThreadCache(thread);
    try {
      const row = await this.selectThreadRow(thread);
      const remote: ThreadSnapshot | null = row
        ? {
            turns: normalizeTurns((row.turns as ThreadTurn[]) ?? []),
            updatedAt: (row.client_updated_at as string) ?? new Date(0).toISOString(),
          }
        : null;
      const merged = local && remote ? mergeThread(local, remote) : (remote ?? local);
      if (merged) {
        this.storage.setItem(this.threadKey(thread), JSON.stringify(merged));
      }
      return merged;
    } catch {
      return local;
    }
  }

  override saveThread(thread: string, turns: ThreadTurn[]): void {
    super.saveThread(thread, turns);
    const prior = this.threadTimers.get(thread);
    if (prior) clearTimeout(prior);
    this.threadTimers.set(
      thread,
      setTimeout(() => {
        this.threadTimers.delete(thread);
        // Still never thrown at the learner: the conversation is already on this device and the
        // next push carries it. The difference is that the failure is now counted rather than
        // dropped, so nothing goes on claiming the transcript is safely away when it is not.
        void this.pushThread(thread).catch(() => {});
      }, this.debounceMs),
    );
  }
}
