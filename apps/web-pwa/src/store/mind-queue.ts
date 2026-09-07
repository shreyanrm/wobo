/**
 * THE OFFLINE QUEUE FOR WOBO'S MIND (docs/MEMORY-LAW.md rule 2, docs/MIND-SYNC-CONTRACT.md §5).
 *
 * The record lives on the server against the account. This is the list of what THIS device still
 * owes it: every remember, every forget, and the counters that grew here since the last write
 * that landed. In order, each write with its own id, so the same write sent twice after a timeout
 * counts once. A write that could not reach the server sits here rather than vanishing into a
 * cache nobody would ever read back, which is the failure the memory law was written to end.
 *
 * Pure storage arithmetic, no network: `mind-sync.ts` is the wire. Both keys are scoped per
 * learner through `store/scope.ts`, so the queue moves with an anonymous learner who signs in and
 * leaves the device when they sign out.
 */

import { type DayLedger, flattenFact, foldFact, type MindState } from './mind';
import { scoped } from './scope';

/** What this device still owes the record. */
export const MIND_QUEUE_KEY = 'wobo-mind-queue-v1';
/** What this device knows about the record: whether one exists, and when it last agreed with it. */
export const MIND_SYNC_KEY = 'wobo-mind-sync-v1';

/** The learner's own lines, to add or to clear. Mirrors `ItemsRequest` on the gateway. */
export interface Named {
  facts: string[];
  interests: string[];
}

/** The counters that grew here, as deltas. Mirrors `BumpRequest` on the gateway. */
export interface Bump {
  days: Record<string, Partial<DayLedger>>;
  dwell: Record<string, number>;
}

export interface QueuedWrite {
  /** This write's own id: sent as `write_id`, the same one on every retry. */
  id: string;
  /** When it was made on this device: sent as `client_updated_at`. */
  at: string;
  remember?: Named;
  forget?: Named;
  bump?: Bump;
  /** The store said no and will say no again (500). Kept, shown, not retried on its own. */
  refused?: boolean;
}

export interface SyncMeta {
  /** Whether the account holds a record. Null until it has been read: nothing is written before. */
  stored: boolean | null;
  /** The record's own stamp the last time this device agreed with it. Null means no row yet. */
  updatedAt: string | null;
  /** The erase this device has already honoured, so one erase clears the cache once. */
  erasedAt: string | null;
  /** When this device last read or wrote the record successfully. */
  syncedAt: string | null;
  /** The gateway said this is a parent account: there is no learner mind here, for life. */
  parent: boolean;
}

const NO_META: SyncMeta = {
  stored: null,
  updatedAt: null,
  erasedAt: null,
  syncedAt: null,
  parent: false,
};

const COUNTERS = ['answered', 'wrong', 'asked', 'helped', 'kept', 'entered', 'seconds'] as const;

// --- the queue ------------------------------------------------------------------------------------

function named(raw: unknown): Named | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Named>;
  const clean = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const out = { facts: clean(r.facts), interests: clean(r.interests) };
  return out.facts.length || out.interests.length ? out : undefined;
}

function bump(raw: unknown): Bump | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Bump>;
  const out: Bump = { days: {}, dwell: {} };
  if (r.days && typeof r.days === 'object') {
    for (const [day, led] of Object.entries(r.days)) {
      if (led && typeof led === 'object') out.days[day] = { ...led };
    }
  }
  if (r.dwell && typeof r.dwell === 'object') {
    for (const [s, n] of Object.entries(r.dwell)) if (typeof n === 'number') out.dwell[s] = n;
  }
  return isEmptyBump(out) ? undefined : out;
}

function isEmptyBump(b: Bump): boolean {
  return Object.keys(b.days).length === 0 && Object.keys(b.dwell).length === 0;
}

export function readQueue(): QueuedWrite[] {
  try {
    const raw = scoped.getItem(MIND_QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const out: QueuedWrite[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const w = item as Partial<QueuedWrite>;
      if (typeof w.id !== 'string' || typeof w.at !== 'string') continue;
      const entry: QueuedWrite = { id: w.id, at: w.at };
      const rem = named(w.remember);
      const gone = named(w.forget);
      const b = bump(w.bump);
      if (rem) entry.remember = rem;
      if (gone) entry.forget = gone;
      if (b) entry.bump = b;
      if (w.refused === true) entry.refused = true;
      if (entry.remember || entry.forget || entry.bump) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedWrite[]): void {
  if (queue.length === 0) scoped.removeItem(MIND_QUEUE_KEY);
  else scoped.setItem(MIND_QUEUE_KEY, JSON.stringify(queue));
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Append one write. Returns it, with the id the retry will reuse. */
export function enqueueWrite(
  write: Omit<QueuedWrite, 'id' | 'at'>,
  now: Date = new Date(),
): QueuedWrite {
  const entry: QueuedWrite = { id: newId(), at: now.toISOString(), ...write };
  writeQueue([...readQueue(), entry]);
  return entry;
}

/** Two bumps, added. Counters sum; the evening flag is an OR. */
export function addBumps(a: Bump, b: Bump): Bump {
  const days: Bump['days'] = {};
  for (const src of [a.days, b.days]) {
    for (const [day, led] of Object.entries(src)) {
      const mine: Partial<DayLedger> = { ...(days[day] ?? {}) };
      for (const c of COUNTERS) {
        const n = led[c];
        if (typeof n === 'number' && n > 0) mine[c] = (mine[c] ?? 0) + n;
      }
      if (led.evening === true) mine.evening = true;
      days[day] = mine;
    }
  }
  const dwell: Bump['dwell'] = { ...a.dwell };
  for (const [s, n] of Object.entries(b.dwell)) dwell[s] = (dwell[s] ?? 0) + n;
  return { days, dwell };
}

/**
 * Add counters to the queue. They fold into the LAST queued write so a pulse every four seconds
 * does not grow the queue by one entry each, except when that write is already on the wire (its
 * id has to count once, so its body cannot change under it) or was refused.
 */
export function enqueueBump(
  delta: Bump,
  inFlight: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): QueuedWrite | null {
  if (isEmptyBump(delta)) return null;
  const queue = readQueue();
  const tail = queue[queue.length - 1];
  if (tail && !tail.refused && !inFlight.has(tail.id)) {
    tail.bump = tail.bump ? addBumps(tail.bump, delta) : delta;
    writeQueue(queue);
    return tail;
  }
  return enqueueWrite({ bump: delta }, now);
}

/** Drop these writes: they landed, or the record told us they never will. */
export function removeQueued(ids: Iterable<string>): void {
  const gone = new Set(ids);
  writeQueue(readQueue().filter((w) => !gone.has(w.id)));
}

/** Mark or unmark writes the store refused. */
export function markRefused(ids: Iterable<string>, refused: boolean): void {
  const chosen = new Set(ids);
  writeQueue(
    readQueue().map((w) => {
      if (!chosen.has(w.id)) return w;
      const { refused: _, ...rest } = w;
      return refused ? { ...rest, refused: true } : rest;
    }),
  );
}

export function clearMindQueue(): void {
  writeQueue([]);
}

/**
 * Take the counters off these writes; a write left with nothing to say leaves the queue. The seed
 * sends the device's whole ledger, so the deltas queued before it must not ride on top of it.
 */
export function dropBumps(ids: Iterable<string>): void {
  const chosen = new Set(ids);
  writeQueue(
    readQueue().flatMap((w) => {
      if (!chosen.has(w.id) || !w.bump) return [w];
      const { bump: _, ...rest } = w;
      return rest.remember || rest.forget ? [rest] : [];
    }),
  );
}

/**
 * How many things the LEARNER would count as waiting: each line to remember once, a line
 * remembered and then removed before either reached the record not at all, each removal of
 * something the record holds once, and the day's counts as one thing. The queue's entry count
 * is not that: two facts remembered and one removed, offline, showed one fact and said three.
 */
export function thingsOwed(queue: readonly QueuedWrite[]): number {
  const adds = new Set<string>();
  const removes = new Set<string>();
  let counts = false;
  for (const w of queue) {
    for (const text of [...(w.remember?.facts ?? []), ...(w.remember?.interests ?? [])]) {
      const key = text.toLowerCase();
      removes.delete(key);
      adds.add(key);
    }
    for (const text of [...(w.forget?.facts ?? []), ...(w.forget?.interests ?? [])]) {
      const key = text.toLowerCase();
      if (adds.has(key)) adds.delete(key);
      else removes.add(key);
    }
    if (w.bump) counts = true;
  }
  return adds.size + removes.size + (counts ? 1 : 0);
}

// --- the deltas ---------------------------------------------------------------------------------

/**
 * What grew on this device between two snapshots of its own mind: the counters as positive
 * deltas, the evening flag only when it turned on, dwell rounded to whole seconds (the wire
 * carries integers). Null when nothing did. A day that was pruned reads as a negative and is
 * ignored: it was already counted the day it happened.
 */
export function ledgerDelta(before: MindState, after: MindState): Bump | null {
  const out: Bump = { days: {}, dwell: {} };
  for (const [day, led] of Object.entries(after.days ?? {})) {
    const was = before.days?.[day];
    const d: Partial<DayLedger> = {};
    for (const c of COUNTERS) {
      const grew = Math.round(led[c] - (was?.[c] ?? 0));
      if (grew > 0) d[c] = grew;
    }
    if (led.evening && !was?.evening) d.evening = true;
    if (Object.keys(d).length > 0) out.days[day] = d;
  }
  for (const [surface, sec] of Object.entries(after.dwellSec)) {
    const grew = Math.round(sec - (before.dwellSec[surface] ?? 0));
    if (grew > 0) out.dwell[surface] = grew;
  }
  return isEmptyBump(out) ? null : out;
}

/**
 * The record, with what this device still owes laid over it: the shape the memory page paints
 * while the queue is waiting for a connection. Pure; the record it is given is not touched.
 */
export function overlayPending(record: MindState, queue: readonly QueuedWrite[]): MindState {
  let facts = [...record.facts];
  let interests = [...record.interests];
  let counters: Bump = { days: {}, dwell: {} };
  for (const w of queue) {
    if (w.forget) {
      const gone = new Set([...w.forget.facts, ...w.forget.interests].map((t) => t.toLowerCase()));
      facts = facts.filter((f) => !gone.has(f.toLowerCase()));
      interests = interests.filter((i) => !gone.has(i.toLowerCase()));
    }
    if (w.remember) {
      for (const f of w.remember.facts) facts = foldFact(facts, f);
      for (const i of w.remember.interests) {
        const clean = flattenFact(i);
        if (clean && !interests.some((x) => x.toLowerCase() === clean.toLowerCase()))
          interests = [...interests, clean].slice(0, 8);
      }
    }
    if (w.bump) counters = addBumps(counters, w.bump);
  }
  const days: Record<string, DayLedger> = {};
  for (const [day, led] of Object.entries(record.days ?? {})) days[day] = { ...led };
  for (const [day, led] of Object.entries(counters.days)) {
    const mine: DayLedger = days[day] ?? {
      answered: 0,
      wrong: 0,
      asked: 0,
      helped: 0,
      kept: 0,
      entered: 0,
      seconds: 0,
      evening: false,
    };
    for (const c of COUNTERS) mine[c] += led[c] ?? 0;
    mine.evening = mine.evening || led.evening === true;
    days[day] = mine;
  }
  const dwellSec = { ...record.dwellSec };
  for (const [s, n] of Object.entries(counters.dwell)) dwellSec[s] = (dwellSec[s] ?? 0) + n;
  return { ...record, facts, interests, days, dwellSec };
}

// --- the meta -------------------------------------------------------------------------------------

export function readSyncMeta(): SyncMeta {
  try {
    const raw = scoped.getItem(MIND_SYNC_KEY);
    if (!raw) return { ...NO_META };
    const m = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      stored: typeof m.stored === 'boolean' ? m.stored : null,
      updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : null,
      erasedAt: typeof m.erasedAt === 'string' ? m.erasedAt : null,
      syncedAt: typeof m.syncedAt === 'string' ? m.syncedAt : null,
      parent: m.parent === true,
    };
  } catch {
    return { ...NO_META };
  }
}

export function writeSyncMeta(meta: SyncMeta): void {
  scoped.setItem(MIND_SYNC_KEY, JSON.stringify(meta));
}

export function clearSyncMeta(): void {
  scoped.removeItem(MIND_SYNC_KEY);
}
