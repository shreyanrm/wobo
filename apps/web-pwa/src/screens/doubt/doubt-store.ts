/**
 * Where a learner's doubts live on the device — LAW 2, the memory law, for photographs.
 *
 * The photo itself is NOT here. A photo of a page can carry a face, another child's name, a home
 * address on a worksheet; the gateway screens it, re-encodes it with its metadata stripped, and
 * keeps it in a private bucket keyed to the account (services/gateway doubt.py, migration 0021).
 * The device keeps what the memory page needs to list a doubt offline — the id, when, what was
 * read, where it was filed — and asks the gateway for the picture (`GET /v1/doubt/{id}/photo`).
 *
 *  · ACCOUNT-KEYED. The two keys below are in `SCOPED_KEYS`: the store moves with the learner
 *    across an anonymous-to-account upgrade and leaves the device on sign-out.
 *  · NOTHING IS WRITTEN BEFORE IT IS READ AND CONFIRMED. The entry control hands a capture to the
 *    screen through `stashCapture`/`takeCapture`, in memory, once. Only a doubt the learner has
 *    confirmed and had explained is saved.
 *  · ERASABLE, AND THE ERASE REACHES THE SERVER. `removeDoubt` sends `DELETE /v1/doubt/<id>` —
 *    the row and the object in the bucket — before it forgets locally; a delete the network refused
 *    is queued under the learner's own scope and drained on the next visit, exactly as the brain
 *    erase is (mind.ts). The device copy goes regardless: a child who pressed remove has removed it
 *    from the phone in their hand. `POST /v1/me/erase` sweeps the same store on the gateway.
 *  · BOUNDED. `MAX_DOUBTS` is what the memory page shows.
 *
 * The You screen's "erase and start over" sweeps every `wobo-` key, so these leave with the rest.
 */

import { gatewayFetch } from '@wobo/sdk';
import { scoped } from '../../store/scope';
import { type Capture, type DoubtLine, doubtErasePath } from './api';

export const DOUBTS_KEY = 'wobo-doubts-v1';
export const DOUBT_ERASE_QUEUE_KEY = 'wobo-doubts-erase-v1';
/** The memory page lists this many; the oldest leaves when a new one arrives. */
export const MAX_DOUBTS = 12;

export interface StoredDoubt {
  /** The gateway's id: the key of the row, the object, and the remove. */
  id: string;
  createdAt: string;
  /** The reading in one line, as the learner left it. */
  reading: string;
  lines: DoubtLine[];
  /** The kept photo's size, for a thumbnail's box before the picture arrives. */
  width: number;
  height: number;
  topicId?: string;
  topicName?: string;
  explained: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isStoredDoubt(v: unknown): v is StoredDoubt {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.reading === 'string' &&
    Array.isArray(v.lines) &&
    typeof v.width === 'number' &&
    typeof v.height === 'number' &&
    typeof v.explained === 'boolean'
  );
}

/** Every doubt this learner kept, newest first. A corrupt record reads as nothing. */
export function loadDoubts(): StoredDoubt[] {
  try {
    const raw = scoped.getItem(DOUBTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // One bad row spoils the list: the shape is one array, and a list with a hole in it is not
    // something the memory page can show honestly.
    return parsed.every(isStoredDoubt) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: StoredDoubt[]): boolean {
  return scoped.setItem(DOUBTS_KEY, JSON.stringify(list));
}

/** Keep one doubt: newest first, one per id, capped. Returns the list as it now stands. */
export function saveDoubt(doubt: StoredDoubt): StoredDoubt[] {
  const rest = loadDoubts().filter((d) => d.id !== doubt.id);
  const list = [doubt, ...rest].slice(0, MAX_DOUBTS);
  persist(list);
  return list;
}

export function updateDoubt(id: string, patch: Partial<Omit<StoredDoubt, 'id'>>): void {
  const list = loadDoubts();
  const at = list.findIndex((d) => d.id === id);
  if (at < 0) return;
  list[at] = { ...(list[at] as StoredDoubt), ...patch };
  persist(list);
}

export function removeDoubtLocally(id: string): void {
  const list = loadDoubts();
  const kept = list.filter((d) => d.id !== id);
  if (kept.length !== list.length) persist(kept);
}

/**
 * The gateway's list is the truth once it has answered: a doubt removed from another device
 * leaves here, one kept there arrives here, and what only the device knows (where the learner
 * filed it) is kept on the rows that survive.
 */
export function reconcileDoubts(fromServer: readonly StoredDoubt[]): StoredDoubt[] {
  const local = new Map(loadDoubts().map((d) => [d.id, d]));
  const list = fromServer.slice(0, MAX_DOUBTS).map((d) => {
    const mine = local.get(d.id);
    return mine
      ? {
          ...d,
          ...(mine.topicId ? { topicId: mine.topicId } : {}),
          ...(mine.topicName ? { topicName: mine.topicName } : {}),
          explained: d.explained || mine.explained,
        }
      : d;
  });
  persist(list);
  return list;
}

// --- The capture handoff (never storage) ----------------------------------------------------------

let pendingCapture: Capture | null = null;

/** The entry control took a photo; the doubt screen collects it on mount. */
export function stashCapture(capture: Capture): void {
  pendingCapture = capture;
}

/** The screen collects the capture. Once: a photo is handed over, not kept around. */
export function takeCapture(): Capture | null {
  const out = pendingCapture;
  pendingCapture = null;
  return out;
}

// --- The erase that reaches the server -------------------------------------------------------------

export function pendingErasures(): string[] {
  try {
    const raw = scoped.getItem(DOUBT_ERASE_QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function setPending(ids: string[]): void {
  if (ids.length === 0) scoped.removeItem(DOUBT_ERASE_QUEUE_KEY);
  else scoped.setItem(DOUBT_ERASE_QUEUE_KEY, JSON.stringify(ids));
}

export interface EraseOptions {
  /** Null or empty on a keyless build: there is no server copy to reach, and that is reported. */
  gatewayUrl: string | null | undefined;
}

/** One delete on the wire. True when the server confirmed it is gone. */
async function eraseOnServer(id: string, gatewayUrl: string): Promise<boolean> {
  try {
    const res = await gatewayFetch(`${gatewayUrl}${doubtErasePath(id)}`, { method: 'DELETE' });
    // 404 is "already gone", which is the state we wanted.
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export type EraseOutcome = { server: 'erased' | 'pending' | 'none' };

/**
 * Remove one doubt. The server first, then the device, whatever the network said: a delete the
 * server did not confirm is owed, queued, and retried by `drainDoubtErasures`.
 */
export async function removeDoubt(id: string, opts: EraseOptions): Promise<EraseOutcome> {
  let outcome: EraseOutcome['server'] = 'none';
  if (opts.gatewayUrl) {
    const gone = await eraseOnServer(id, opts.gatewayUrl);
    if (gone) outcome = 'erased';
    else {
      const owed = pendingErasures();
      if (!owed.includes(id)) setPending([...owed, id]);
      outcome = 'pending';
    }
  }
  removeDoubtLocally(id);
  return { server: outcome };
}

/** Retry every delete still owed to the server. Quiet: a failure simply stays owed. */
export async function drainDoubtErasures(opts: EraseOptions): Promise<void> {
  if (!opts.gatewayUrl) return;
  const owed = pendingErasures();
  if (owed.length === 0) return;
  const still: string[] = [];
  for (const id of owed) {
    if (!(await eraseOnServer(id, opts.gatewayUrl))) still.push(id);
  }
  setPending(still);
}
