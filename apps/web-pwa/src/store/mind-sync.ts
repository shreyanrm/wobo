/**
 * THE WIRE FOR WOBO'S MIND — the client half of docs/MEMORY-LAW.md, built to
 * docs/MIND-SYNC-CONTRACT.md and to `services/gateway/src/wobo_gateway/mind.py`.
 *
 * The database is the record, the account is the key, the copy in this browser is a cache. So:
 *
 *   - every remember, forget and bump is written THROUGH: the device paints first so the screen
 *     is instant, the write is queued (`mind-queue.ts`, scoped per learner), and the queue is
 *     drained in order, each write under its own id so a retry after a lost answer counts once;
 *   - the answer to every write is the record as it now stands, and the device reconciles to it,
 *     with what it still owes laid over the top so a fact cleared offline does not reappear;
 *   - on sign-in the record is read and painted over whatever this device held, except when there
 *     is no record yet, in which case the device is about to seed it (the anonymous work a child
 *     did before signing up follows them in on the first write);
 *   - a write that cannot land is never silent: the memory page reads `mindSyncStatus()` and says,
 *     in one calm line, how many things are waiting and why.
 *
 * What each refusal means is the contract's own table (§4): a 503 is retried, a 500 is not, a
 * 403 keeps the queue for a sign-in, a parent account stops the wire for good.
 */

import { gatewayFetch } from '@wobo/sdk';
import { isOffline } from '../shell/resilience';
import { dropLocally, loadMind, MIND_KEY, type MindState, mindFrom, saveMind } from './mind';
import {
  clearSyncMeta,
  dropBumps,
  enqueueWrite,
  markRefused,
  type Named,
  overlayPending,
  readQueue,
  readSyncMeta,
  removeQueued,
  type SyncMeta,
  thingsOwed,
  writeSyncMeta,
} from './mind-queue';
import { currentScope, scoped } from './scope';

const MIND_PATH = '/v1/me/mind';
const FORGET_PATH = '/v1/me/mind/forget';
/** A sync is a small JSON round trip; a learner is never waiting on it, so the deadline is short. */
const SYNC_TIMEOUT_MS = 15_000;
/** How long the kick waits so a burst of writes drains as one pass. */
const KICK_MS = 800;
/** Back-off after trouble: the pulse keeps calling, the wire answers "waiting" until this passes. */
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const RATE_LIMIT_BACKOFF_MS = 60_000;

export type SyncOutcome =
  | 'synced'
  | 'none'
  | 'sign_in'
  | 'parent'
  | 'waiting'
  | 'trouble'
  | 'rate_limited'
  | 'refused';

/** Whether this device may talk to the record at all. */
export type SyncGate = 'ready' | 'anonymous' | 'none';

export interface MindSyncStatus {
  /** Things still owed to the record, in the learner's units (`thingsOwed`), the refused apart. */
  waiting: number;
  /** Things the store refused (500). Kept, shown, retried only when asked. */
  refused: number;
  syncedAt: string | null;
  stored: boolean | null;
  /** True while a pass is on the wire. */
  busy: boolean;
  /** The one calm line for the memory page, or null when there is nothing to say. */
  line: string | null;
  last: SyncOutcome | null;
  /** Whether the wire is open at all: a queue behind a closed wire is owed to nobody. */
  gate: SyncGate;
}

function count(n: number, thing = 'thing'): string {
  return n === 1 ? `one ${thing}` : `${n} ${thing}s`;
}

/** The lines. Exported so the words are held by a test and never rewritten beside the screen. */
export const MIND_SYNC_COPY = {
  signIn: 'Sign in and what Wobo remembers stays with you, on every device.',
  offline: (n: number) =>
    `${n === 1 ? 'One thing is' : `${n} things are`} waiting to save. ${n === 1 ? 'It goes' : 'They go'} the moment you are back online.`,
  trouble: (n: number) =>
    `${n === 1 ? 'One thing is' : `${n} things are`} waiting to save. I could not reach my memory just now, so I will keep trying.`,
  refused: (n: number) =>
    `I could not save ${count(n)}, and it is my end rather than yours. This device keeps its copy. Write to support@heywobo.com if it keeps happening.`,
} as const;

// --- state held in memory: one device, one tab ---------------------------------------------------

function gatewayUrl(): string | undefined {
  return import.meta.env.VITE_GATEWAY_URL || undefined;
}

let gate: () => SyncGate = () => (gatewayUrl() ? 'ready' : 'none');
let inflight: Promise<SyncOutcome> | null = null;
let notBefore = 0;
let strikes = 0;
let last: SyncOutcome | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
const sending = new Set<string>();
const listeners = new Set<() => void>();

/** The account decides whether the wire is open. Set once by the observer, from the SDK. */
export function setMindSyncGate(fn: () => SyncGate): void {
  gate = fn;
}

/** The ids on the wire right now: a bump must not fold into one of these. */
export function inFlightIds(): ReadonlySet<string> {
  return sending;
}

/** Told whenever the status changes. Returns the unsubscribe. */
export function onMindSyncChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

/** A new learner on this device, or a test: forget the back-off and the last answer. */
export function resetMindSync(): void {
  notBefore = 0;
  strikes = 0;
  last = null;
  sending.clear();
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
}

/** Something was just written locally: drain soon, once, however many writes arrive meanwhile. */
export function kickMindSync(): void {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void syncMind();
  }, KICK_MS);
  (kickTimer as { unref?: () => void }).unref?.();
}

export function mindSyncStatus(): MindSyncStatus {
  const queue = readQueue();
  const waiting = thingsOwed(queue.filter((w) => !w.refused));
  const refused = thingsOwed(queue.filter((w) => w.refused));
  const meta = readSyncMeta();
  const g = gate();
  let line: string | null = null;
  if (g !== 'none' && !meta.parent) {
    if (g === 'anonymous' || last === 'sign_in') line = waiting > 0 ? MIND_SYNC_COPY.signIn : null;
    else if (refused > 0) line = MIND_SYNC_COPY.refused(refused);
    else if (waiting > 0) {
      line = isOffline() ? MIND_SYNC_COPY.offline(waiting) : MIND_SYNC_COPY.trouble(waiting);
    }
  }
  return {
    waiting,
    refused,
    syncedAt: meta.syncedAt,
    stored: meta.stored,
    busy: inflight !== null,
    line,
    last,
    gate: g,
  };
}

// --- the wire ------------------------------------------------------------------------------------

/** The gateway's view of the record, as the contract draws it. */
interface MindView {
  mind: unknown;
  stored: boolean;
  updated_at: string | null;
  erased_at: string | null;
  applied?: boolean;
  ignored?: string | null;
  dropped?: string[];
  forgot?: { facts?: string[]; interests?: string[] };
}

type Reply =
  | { kind: 'ok'; view: MindView }
  | { kind: Exclude<SyncOutcome, 'synced' | 'none' | 'waiting'> | 'bad_request' };

async function refusalCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown; detail?: { code?: unknown } };
    const code = body?.detail?.code ?? body?.code;
    return typeof code === 'string' ? code : '';
  } catch {
    return '';
  }
}

async function call(path: string, init: RequestInit): Promise<Reply> {
  const base = gatewayUrl();
  if (!base) return { kind: 'trouble' };
  let res: Response;
  try {
    res = await gatewayFetch(`${base}${path}`, init, SYNC_TIMEOUT_MS);
  } catch {
    return { kind: 'trouble' }; // offline, a dropped connection, or the deadline: retried later
  }
  if (res.ok) {
    try {
      return { kind: 'ok', view: (await res.json()) as MindView };
    } catch {
      return { kind: 'trouble' };
    }
  }
  const code = await refusalCode(res);
  if (res.status === 401 || code === 'sign_in_required') return { kind: 'sign_in' };
  if (code === 'not_a_learner_account') {
    writeSyncMeta({ ...readSyncMeta(), parent: true });
    return { kind: 'parent' };
  }
  if (res.status === 403) return { kind: 'sign_in' };
  if (res.status === 422) return { kind: 'bad_request' };
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status === 500 || code === 'store_refused') return { kind: 'refused' };
  return { kind: 'trouble' };
}

const json = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Reconcile this device to the record. The record is the truth; what this device still owes is
 * laid over it so the screen does not flicker back to a state the queue is about to change.
 *
 * Two exceptions, both in the contract. An erase this device has not honoured yet clears the
 * cache and drops every write made before it (they came from the cache the learner erased). And
 * when there is no row at all, the device is about to SEED the record, so the empty answer must
 * not wipe what it is about to send.
 */
function applyView(view: MindView, owner: string): boolean {
  // THE ANSWER LANDS ONLY FOR THE LEARNER THE PASS BEGAN FOR. A sign-out while a read was on the
  // wire used to write the empty answer under a PLAIN key (nobody was scoped any more), and the
  // next person on the phone would have read it as their own. Seen in a browser; held by a test.
  if (currentScope() !== owner) return false;
  let meta: SyncMeta = readSyncMeta();
  if (view.erased_at && view.erased_at !== meta.erasedAt) {
    const floor = Date.parse(view.erased_at);
    scoped.removeItem(MIND_KEY);
    removeQueued(
      readQueue()
        .filter((w) => Date.parse(w.at) <= floor)
        .map((w) => w.id),
    );
    meta = { ...meta, erasedAt: view.erased_at };
  }
  if (view.updated_at !== null) {
    saveMind(overlayPending(mindFrom(view.mind), readQueue()));
  }
  writeSyncMeta({
    ...meta,
    stored: view.stored === true,
    updatedAt: typeof view.updated_at === 'string' ? view.updated_at : null,
    syncedAt: new Date().toISOString(),
  });
  notify();
  return true;
}

async function pullRecord(owner: string): Promise<'ok' | Exclude<Reply, { kind: 'ok' }>['kind']> {
  const reply = await call(MIND_PATH, { method: 'GET' });
  if (reply.kind !== 'ok') return reply.kind;
  return applyView(reply.view, owner) ? 'ok' : 'sign_in';
}

function mindEmpty(m: MindState): boolean {
  return !(
    m.facts.length ||
    m.interests.length ||
    m.latenciesMs.length ||
    m.slips.length ||
    m.sessionDays.length ||
    Object.keys(m.dwellSec).length ||
    Object.keys(m.days ?? {}).length
  );
}

function freshId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `seed-${Date.now().toString(36)}`;
  }
}

/** The snapshot that CONFIRMS: no counters, which travel as deltas once a record exists. */
function confirmSnapshot(): MindState {
  return { ...loadMind(), days: {}, dwellSec: {} };
}

/**
 * Send what is owed, in order. Returns why it stopped, or `synced` when the queue is empty.
 *
 * The first write against an account with no row SEEDS it from the device's whole snapshot: the
 * local ledger already holds every count the queued bumps describe, so those bumps are not sent
 * on top (the record would count them twice). The seed carries the FIRST owed write's words and
 * the rest follow in order like any other write. Folding every queued remember and forget into
 * the seed lost the order: the record applies forget after remember, so "remember X, forget X,
 * remember X" ended with X tombstoned.
 */
async function drain(owner: string): Promise<SyncOutcome> {
  if (currentScope() !== owner) return 'sign_in';
  const meta = readSyncMeta();
  const owed = readQueue().filter((w) => !w.refused);
  const seeding = meta.updatedAt === null && !meta.erasedAt;
  if (owed.length === 0 && !(seeding && !mindEmpty(loadMind()))) return 'synced';

  if (seeding) {
    // A mind with nothing queued (an older build's cache) still seeds: it is the work a child did
    // before signing up, and the account is where it belongs.
    const first = owed[0];
    const ids = owed.map((w) => w.id);
    if (first) sending.add(first.id);
    const reply = await call(
      MIND_PATH,
      json({
        mind: loadMind(),
        remember: first?.remember,
        forget: first?.forget,
        write_id: first?.id ?? freshId(),
        client_updated_at: first?.at ?? new Date().toISOString(),
      }),
    );
    if (first) sending.delete(first.id);
    if (currentScope() !== owner) return 'sign_in'; // the learner left mid-flight: touch nothing
    if (reply.kind !== 'ok') {
      if (reply.kind === 'refused' || reply.kind === 'bad_request') {
        markRefused(first ? [first.id] : [], true);
        return 'refused';
      }
      return reply.kind;
    }
    if (first) removeQueued([first.id]);
    dropBumps(ids); // the snapshot carried every count; the rest of the queue keeps its words
    applyView(reply.view, owner);
    return drain(owner);
  }

  for (const stale of owed) {
    const w = readQueue().find((x) => x.id === stale.id);
    if (!w || w.refused) continue;
    sending.add(w.id);
    const reply = await call(
      MIND_PATH,
      json({
        mind: confirmSnapshot(),
        remember: w.remember,
        forget: w.forget,
        bump: w.bump,
        write_id: w.id,
        client_updated_at: w.at,
      }),
    );
    sending.delete(w.id);
    if (currentScope() !== owner) return 'sign_in'; // the learner left mid-flight: touch nothing
    if (reply.kind !== 'ok') {
      if (reply.kind === 'refused' || reply.kind === 'bad_request') {
        markRefused([w.id], true);
        return 'refused';
      }
      return reply.kind;
    }
    // Landed, or already had (`ignored: duplicate`), or made from a cache the learner has since
    // erased (`ignored: erased`): in every case this write is not owed any more.
    removeQueued([w.id]);
    applyView(reply.view, owner);
  }
  return 'synced';
}

function settle(outcome: SyncOutcome): SyncOutcome {
  last = outcome;
  if (outcome === 'synced' || outcome === 'none' || outcome === 'parent') {
    strikes = 0;
    notBefore = 0;
  } else if (outcome === 'rate_limited') {
    notBefore = Date.now() + RATE_LIMIT_BACKOFF_MS;
  } else if (outcome === 'trouble') {
    notBefore = Date.now() + (BACKOFF_MS[Math.min(strikes, BACKOFF_MS.length - 1)] ?? 0);
    strikes += 1;
  }
  return outcome;
}

async function pass(opts: { pull?: boolean; force?: boolean }): Promise<SyncOutcome> {
  const g = gate();
  if (g === 'none') return settle('none');
  if (g === 'anonymous') return settle('sign_in');
  // Nobody scoped is nobody to read or write for: the moment between a sign-out's forgetScope
  // and its signOut looks signed in to the gate and must not reach the wire.
  const owner = currentScope();
  if (!owner) return settle('sign_in');
  const meta = readSyncMeta();
  if (meta.parent) return settle('parent');
  if (!opts.force && Date.now() < notBefore) return 'waiting';
  if (opts.pull || meta.stored === null) {
    const pulled = await pullRecord(owner);
    if (pulled !== 'ok') return settle(pulled === 'bad_request' ? 'refused' : pulled);
  }
  return settle(await drain(owner));
}

/**
 * One pass: read the record if this device has never seen it (or was asked to), then send what is
 * owed, in order. One pass in flight per device; a second call joins the first. Cheap when there
 * is nothing to do, so the observer's pulse can call it freely.
 */
export function syncMind(opts: { pull?: boolean; force?: boolean } = {}): Promise<SyncOutcome> {
  if (inflight) return inflight;
  notify();
  inflight = pass(opts).finally(() => {
    inflight = null;
    notify();
  });
  return inflight;
}

/** Send the writes the store refused, once more, because the learner asked. */
export async function retryRefused(): Promise<SyncOutcome> {
  markRefused(
    readQueue().map((w) => w.id),
    false,
  );
  return syncMind({ force: true });
}

/**
 * The memory page's per-item remove: the server FIRST, then the device.
 *
 * The forget is queued behind anything already owed (so a remember of the same words made a
 * moment earlier cannot land after it) and the queue is drained now. When the tombstone landed
 * the answer already reconciled this device; when it could not, the device forgets anyway and
 * the page says the removal is waiting, which is the truth.
 */
export async function forgetItem(
  kind: 'fact' | 'interest',
  text: string,
): Promise<'server' | 'queued' | 'local'> {
  const g = gate();
  if (g === 'none') {
    dropLocally(kind, text);
    return 'local';
  }
  const entry = enqueueWrite({
    forget: kind === 'fact' ? { facts: [text], interests: [] } : { facts: [], interests: [text] },
  });
  if (g === 'anonymous') {
    dropLocally(kind, text);
    notify();
    return 'queued';
  }
  await syncMind({ force: true });
  const landed = !readQueue().some((w) => w.id === entry.id);
  if (!landed) dropLocally(kind, text);
  notify();
  return landed ? 'server' : 'queued';
}

/**
 * "Wobo, forget about my mother": matched against the RECORD (contract §3), so a fact told to
 * Wobo on another device is found too. Null when the record could not be asked; the caller then
 * falls back to the device's own copy and queues what it removed.
 */
export async function forgetOnRecord(contains: string): Promise<Named | null> {
  const g = gate();
  const owner = currentScope();
  if (g !== 'ready' || !owner || readSyncMeta().parent) return null;
  const reply = await call(FORGET_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contains }),
  });
  if (reply.kind !== 'ok' || !applyView(reply.view, owner)) return null;
  return {
    facts: reply.view.forgot?.facts ?? [],
    interests: reply.view.forgot?.interests ?? [],
  };
}

/** The learner erased everything: nothing is owed and nothing is known about the record. */
export function forgetSyncState(): void {
  clearSyncMeta();
  resetMindSync();
}
