import type { MasteryBand } from '@wobo/contracts';
import type { MasterySnapshot } from '@wobo/kgtopg-contract-seed';
import type { KVStorage } from './state';
import type { SupabaseRest } from './supabase';

/**
 * WHERE MASTERY LIVES.
 *
 * Evidence used to sit in a Map inside the KGtoPG reference and die on reload, so "we keep teaching
 * them until they master a topic" restarted every session. It now rides the same seam learner state
 * does: localStorage is the always-on cache (offline and signed-out work exactly as before), and in
 * live mode `learner.mastery_cache` is the remote truth: one row per node, `band` in its own
 * column, the evidence it was derived from in `evidence` (migration 0013).
 *
 * The merge is a union by event id and nothing else. Two devices that saw different answers end up
 * holding both; the band is re-derived from the union, so it can never be stale relative to the
 * evidence and no clock has to be trusted. RLS (`mastery_cache_own`) keys every row to auth.uid().
 *
 * Every remote failure degrades to the cache without a word. Mastery must never block a lesson.
 */

/** The band each node stands at right now, keyed by node id. */
export type BandMap = Record<string, MasteryBand>;

export const MASTERY_CACHE_KEY = 'wobo-mastery-v1';

export function emptyMasterySnapshot(): MasterySnapshot {
  return { nodes: {} };
}

/**
 * How many answers are kept per node, newest first.
 *
 * The KGtoPG reference has always capped its own in-memory evidence at sixteen; the persisted
 * store did not, so `save` unioned every answer a learner had ever given and rewrote the whole
 * blob on every single one. Forty answers on one node came back as forty points and roughly five
 * kilobytes for that node alone, growing without limit until localStorage refused the write and
 * mastery persistence died inside a silent catch.
 *
 * Sixteen is the same number for the same reason: every band threshold reads at most the last ten
 * answers (the reliability window) or counts to four, so nothing above sixteen can change a band.
 * The cap is applied in the merge, which is the one place every write and every reconcile passes
 * through, so the cache, the remote rows and the derived bands can never disagree about it.
 */
export const MASTERY_EVIDENCE_CAP = 16;

/** Newest kept, oldest dropped. The reliability window reads the tail, so the tail must survive. */
function capEvidence(
  points: MasterySnapshot['nodes'][string]['evidence'],
): MasterySnapshot['nodes'][string]['evidence'] {
  if (points.length <= MASTERY_EVIDENCE_CAP) return points;
  const sorted = [...points].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return sorted.slice(sorted.length - MASTERY_EVIDENCE_CAP);
}

/** Fill defaults over a persisted (or partly corrupt) snapshot. Never throws on bad input. */
export function normalizeMasterySnapshot(raw: unknown): MasterySnapshot {
  const nodes: MasterySnapshot['nodes'] = {};
  const rawNodes =
    raw && typeof raw === 'object' ? (raw as Partial<MasterySnapshot>).nodes : undefined;
  if (!rawNodes || typeof rawNodes !== 'object') return { nodes };
  for (const [nodeId, record] of Object.entries(rawNodes)) {
    if (!record || typeof record !== 'object') continue;
    const evidence = Array.isArray(record.evidence) ? record.evidence : [];
    nodes[nodeId] = {
      band: (record.band as MasteryBand) ?? 'not_started',
      evidence: capEvidence(
        evidence.filter(
          (p) => p && typeof p.event_id === 'string' && typeof p.correct === 'boolean',
        ),
      ),
    };
  }
  return { nodes };
}

/**
 * Reconcile two copies. The evidence unions by event id, which is order-independent and lossless.
 *
 * The band is NOT clamped upward. A band can legitimately fall: the reference lowers one when a
 * learner's recent run stops holding up, which is the whole mechanism that brings a finished topic
 * back around, so a merge that always kept the higher of the two would quietly pin a topic at
 * "mastered" forever. Instead the band travels with the evidence it was derived from: whichever
 * side carries more points for that node speaks for it, and a tie goes to `b`, the incoming copy.
 *
 * That answer is a stand-in, never the last word. The band the app reads is re-derived from the
 * union by the KGtoPG binding immediately after every merge (`hydrateEvidence`, which then saves
 * the derived snapshot back). This function only has to avoid being wrong in a way that survives.
 */
export function mergeMasterySnapshot(a: MasterySnapshot, b: MasterySnapshot): MasterySnapshot {
  const nodes: MasterySnapshot['nodes'] = {};
  for (const nodeId of new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)])) {
    const left = a.nodes[nodeId];
    const right = b.nodes[nodeId];
    const points = new Map((left?.evidence ?? []).map((p) => [p.event_id, p]));
    for (const p of right?.evidence ?? []) if (!points.has(p.event_id)) points.set(p.event_id, p);
    const richer =
      right && (left?.evidence.length ?? -1) > right.evidence.length ? left : (right ?? left);
    nodes[nodeId] = {
      band: richer?.band ?? 'not_started',
      evidence: capEvidence([...points.values()]),
    };
  }
  return { nodes };
}

/** The bands alone: what the learn board reads to decide what is learnt. */
export function bandsOf(snapshot: MasterySnapshot): BandMap {
  const bands: BandMap = {};
  for (const [nodeId, record] of Object.entries(snapshot.nodes)) bands[nodeId] = record.band;
  return bands;
}

/**
 * The persistence seam for mastery, mirroring `StateProvider`: a synchronous cache read for boot,
 * an async reconcile, a merge-on-write, and a subscription so the screens repaint when a band moves.
 */
export interface MasteryProvider {
  /** The snapshot held right now: the boot value before any network. */
  loadCache(): MasterySnapshot;
  /** Bands as of the last write or hydrate. Cheap; safe to call in a render. */
  bands(): BandMap;
  /** Reconcile with the remote store (a no-op locally); resolves to the merged truth. */
  hydrate(): Promise<MasterySnapshot>;
  /** Merge-on-write: the cache updates immediately; the remote push is debounced. */
  save(snapshot: MasterySnapshot): void;
  /** Notified after every save and hydrate. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** localStorage-only persistence: mock/local mode and every signed-out learner. */
export class LocalMasteryProvider implements MasteryProvider {
  private held: MasterySnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    protected readonly storage: KVStorage = defaultStorage(),
    /** Scopes the cache to one account, exactly as the learner-state cache is scoped. */
    protected readonly scope = '',
  ) {
    this.held = this.readCache();
  }

  protected cacheKey(): string {
    return this.scope ? `${MASTERY_CACHE_KEY}:${this.scope}` : MASTERY_CACHE_KEY;
  }

  private readCache(): MasterySnapshot {
    try {
      const raw = this.storage.getItem(this.cacheKey());
      return raw ? normalizeMasterySnapshot(JSON.parse(raw)) : emptyMasterySnapshot();
    } catch {
      return emptyMasterySnapshot(); // unreadable storage is an empty history, never a broken boot
    }
  }

  loadCache(): MasterySnapshot {
    return this.held;
  }

  bands(): BandMap {
    return bandsOf(this.held);
  }

  async hydrate(): Promise<MasterySnapshot> {
    return this.held;
  }

  save(snapshot: MasterySnapshot): void {
    this.held = mergeMasterySnapshot(this.held, snapshot);
    try {
      this.storage.setItem(this.cacheKey(), JSON.stringify(this.held));
    } catch {
      // storage unavailable: session-only mastery is fine; the lesson still runs
    }
    this.announce();
  }

  protected announce(): void {
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** A storage that keeps nothing beyond the session: a non-DOM runtime, or a browser refusing it. */
class MemoryStorage implements KVStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function defaultStorage(): KVStorage {
  return (globalThis as { localStorage?: KVStorage }).localStorage ?? new MemoryStorage();
}

type MasteryRest = Pick<SupabaseRest, 'select' | 'upsert'>;

/** The column added by migration 0013; a project without it still stores bands. */
const EVIDENCE_COLUMN = 'evidence';

function isMissingEvidenceColumn(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes(EVIDENCE_COLUMN) || message.includes('pgrst204');
}

function snapshotFromRows(rows: Record<string, unknown>[]): MasterySnapshot {
  const nodes: MasterySnapshot['nodes'] = {};
  for (const row of rows) {
    const nodeId = row.node_id as string | undefined;
    if (!nodeId) continue;
    const evidence = Array.isArray(row.evidence)
      ? (row.evidence as MasterySnapshot['nodes'][string]['evidence'])
      : [];
    nodes[nodeId] = { band: (row.band as MasteryBand) ?? 'not_started', evidence };
  }
  return normalizeMasterySnapshot({ nodes });
}

function rowsFromSnapshot(subjectId: string, snapshot: MasterySnapshot): Record<string, unknown>[] {
  return Object.entries(snapshot.nodes).map(([nodeId, record]) => ({
    subject_id: subjectId,
    node_id: nodeId,
    band: record.band,
    scope: 'node',
    evidence: record.evidence,
  }));
}

/**
 * Live persistence: the local cache still answers every read; `learner.mastery_cache` is the remote
 * truth, reconciled through the pure merge above. A returning learner resumes mid-climb instead of
 * starting the topic over.
 */
export class SupabaseMasteryProvider extends LocalMasteryProvider implements MasteryProvider {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private evidenceColumnAbsent = false;

  constructor(
    private readonly rest: MasteryRest,
    private readonly subjectId: string,
    storage?: KVStorage,
    private readonly debounceMs = 1500,
  ) {
    super(storage ?? defaultStorage(), subjectId);
  }

  private async push(snapshot: MasterySnapshot): Promise<void> {
    const rows = rowsFromSnapshot(this.subjectId, snapshot);
    if (rows.length === 0) return;
    const conflict = 'subject_id,node_id,scope';
    if (this.evidenceColumnAbsent) {
      await this.rest.upsert(
        'mastery_cache',
        rows.map(({ evidence: _evidence, ...rest }) => rest),
        conflict,
      );
      return;
    }
    try {
      await this.rest.upsert('mastery_cache', rows, conflict);
    } catch (err) {
      if (!isMissingEvidenceColumn(err)) throw err;
      // The project predates migration 0013: keep the bands, and remember so every later write
      // skips the failed attempt. Evidence stays local-only until the migration lands.
      this.evidenceColumnAbsent = true;
      await this.rest.upsert(
        'mastery_cache',
        rows.map(({ evidence: _evidence, ...rest }) => rest),
        conflict,
      );
    }
  }

  override async hydrate(): Promise<MasterySnapshot> {
    const local = this.loadCache();
    try {
      const rows = await this.rest.select('mastery_cache', {
        match: { subject_id: this.subjectId, scope: 'node' },
        select: '*',
      });
      const merged = mergeMasterySnapshot(local, snapshotFromRows(rows));
      super.save(merged);
      await this.push(this.loadCache());
      return this.loadCache();
    } catch {
      return local; // offline: the cache is the session's truth; the next boot reconciles
    }
  }

  override save(snapshot: MasterySnapshot): void {
    super.save(snapshot);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push(this.loadCache()).catch(() => {}); // offline: the cache holds; next push
    }, this.debounceMs);
  }
}
