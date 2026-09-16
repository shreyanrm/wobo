/**
 * THE ACTIVITY RECORD, the app's half (services/gateway `activity.py`, migration 0034).
 *
 * The owner: "make sure you have a record of application activity and stuff". The mail cadence
 * stands on it — at least three a week, a step-down with time away that never falls below one a
 * month, and never a "come back" mail on a day the learner came — so the record has to know when
 * a learner was here and what they did. The server marks a signed-in turn by itself. What only
 * the app knows is said here, through the same door the mind and the mail dials use
 * (`POST /v1/me/activity`, behind the learner's own token):
 *
 *   - a SESSION: opened when the app is on screen, closed when it is hidden or the page goes.
 *     The id is this device's own uuid, so a retried open is the same session.
 *   - PROGRESS through a chapter: the cards done of the cards there are, held for a few seconds
 *     so a learner moving through a lesson is one note rather than one per tap.
 *   - a MODULE FINISHED, and a TOPIC MASTERED: the moments a mail may speak about.
 *
 * What it is for: teaching, and the learner's own mail. Nothing here is analytics, nothing goes to
 * a third party, and nothing is sent for a visitor who is not signed in (DPDP s.9(3)). A note that
 * cannot land is dropped, never retried in a loop and never shown to the learner: the record is
 * useful, and a lesson must never wait on it.
 */

import { gatewayFetch } from '@wobo/sdk';

export const ACTIVITY_PATH = '/v1/me/activity';
/** How long a progress report waits for the next one before it is sent. */
export const PROGRESS_SETTLE_MS = 8000;
/** A note is a small write; a learner is never waiting on it. */
const NOTE_TIMEOUT_MS = 8000;
/** The gateway's own bounds (`activity.TITLE_MAX`, `REF_MAX`, `CARDS_MAX`). */
export const TITLE_MAX = 120;
export const REF_MAX = 128;
export const CARDS_MAX = 500;

export type ActivityKind =
  | 'session_start'
  | 'session_end'
  | 'module_finished'
  | 'topic_mastered'
  | 'progress';

export interface ActivityNote {
  readonly kind: ActivityKind;
  readonly session?: string;
  readonly ref?: string;
  readonly title?: string;
  readonly done?: number;
  readonly total?: number;
}

type Fetch = (url: string, init?: RequestInit, timeoutMs?: number | null) => Promise<Response>;

function defaultGatewayUrl(): string | undefined {
  return import.meta.env.VITE_GATEWAY_URL || undefined;
}

let gatewayUrl: () => string | undefined = defaultGatewayUrl;
let fetcher: Fetch = gatewayFetch;
/** Whether this device may write the record: a signed-in learner, not a visitor. */
let gate: () => boolean = () => Boolean(gatewayUrl());
let session: string | null = null;

/** The clock progress settles on. Handed in by a test, so time moves when the test moves it. */
export interface ActivityScheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realScheduler: ActivityScheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
let scheduler: ActivityScheduler = realScheduler;
const waiting = new Map<string, { timer: unknown; note: ActivityNote }>();

/** Test seam: the timer progress settles on. `null` puts the real one back. */
export function setActivityScheduler(next: ActivityScheduler | null): void {
  scheduler = next ?? realScheduler;
}

/** Who may write the record: a signed-in learner, never a visitor. A build with no account layer
 *  (local mode) sends, and the gateway's own door decides, exactly as the mind's wire does. */
export function mayRecord(
  account: { isAuthenticated(): boolean; isAnonymous(): boolean } | null | undefined,
): boolean {
  if (!account) return true;
  return account.isAuthenticated() && !account.isAnonymous();
}

/** The account decides whether anything is sent. Set once by the observer, from the SDK. */
export function setActivityGate(fn: () => boolean): void {
  gate = fn;
}

/** Test seam: where notes go, and which gateway they go to. `null` puts the real ones back. */
export function setActivityTransport(
  fn: Fetch | null,
  url: (() => string | undefined) | null = null,
): void {
  fetcher = fn ?? gatewayFetch;
  gatewayUrl = url ?? defaultGatewayUrl;
}

/** Forget the open session and anything waiting. Nothing is sent. */
export function resetActivity(): void {
  for (const held of waiting.values()) scheduler.clear(held.timer);
  waiting.clear();
  session = null;
  gate = () => Boolean(gatewayUrl());
}

export function currentSession(): string | null {
  return session;
}

/** Whole cards passed, from the player's fraction: never the placeholder before the first card. */
export function cardsDone(fraction: number, cards: number): number {
  if (!Number.isFinite(fraction) || !Number.isFinite(cards) || cards <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(cards), Math.floor(fraction * cards)));
}

function whole(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(CARDS_MAX, Math.floor(value)));
}

/** The body the gateway accepts, and nothing else: bounded, trimmed, no field it would refuse. */
export function bodyFor(note: ActivityNote): Record<string, string | number> {
  const body: Record<string, string | number> = { kind: note.kind };
  if (note.session) {
    body.session = note.session;
    if (note.kind === 'session_start') body.surface = 'pwa';
  }
  const ref = note.ref?.trim().slice(0, REF_MAX);
  if (ref) body.ref = ref;
  const title = note.title?.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (title) body.title = title;
  const done = whole(note.done);
  const total = whole(note.total);
  if (done !== undefined) body.done = done;
  if (total !== undefined) body.total = total;
  return body;
}

/** One note to the record. True when the gateway kept it. Never throws. */
export async function noteActivity(
  note: ActivityNote,
  options: { readonly keepalive?: boolean } = {},
): Promise<boolean> {
  const base = gatewayUrl();
  if (!base || !gate()) return false;
  try {
    const res = await fetcher(
      `${base}${ACTIVITY_PATH}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyFor(note)),
        // A note sent as the page goes away has to outlive the page.
        keepalive: options.keepalive === true,
      },
      NOTE_TIMEOUT_MS,
    );
    return res.ok;
  } catch {
    return false;
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Open a session if none is open. Returns its id, or null when nothing may be recorded. */
export function openSession(): string | null {
  if (!gate() || !gatewayUrl()) return null;
  if (session) return session;
  session = newId();
  void noteActivity({ kind: 'session_start', session });
  return session;
}

/** Close the open session, and send whatever progress was waiting, as the page goes. */
export function closeSession(): void {
  flushProgress({ keepalive: true });
  if (!session) return;
  const id = session;
  session = null;
  void noteActivity({ kind: 'session_end', session: id }, { keepalive: true });
}

/** Where the learner is in a chapter. Settles for a few seconds; the latest report wins. */
export function noteProgress(ref: string, title: string, done: number, total: number): void {
  if (!ref || !gate() || !gatewayUrl()) return;
  if (!(total > 0)) return;
  const held = waiting.get(ref);
  if (held) scheduler.clear(held.timer);
  const note: ActivityNote = { kind: 'progress', ref, title, done, total };
  const timer = scheduler.set(() => {
    waiting.delete(ref);
    void noteActivity(note);
  }, PROGRESS_SETTLE_MS);
  waiting.set(ref, { timer, note });
}

/** Send every waiting progress report now. */
export function flushProgress(options: { readonly keepalive?: boolean } = {}): void {
  for (const [ref, held] of [...waiting]) {
    scheduler.clear(held.timer);
    waiting.delete(ref);
    void noteActivity(held.note, options);
  }
}

/** A module finished. Any progress still waiting for it is dropped: there are no cards left. */
export function noteModuleFinished(ref: string, title: string): void {
  const held = waiting.get(ref);
  if (held) {
    scheduler.clear(held.timer);
    waiting.delete(ref);
  }
  if (!ref) return;
  void noteActivity({ kind: 'module_finished', ref, title });
}

/** A topic mastered: the band the evidence earned is secure or better. */
export function noteTopicMastered(ref: string, title: string): void {
  if (!ref) return;
  void noteActivity({ kind: 'topic_mastered', ref, title });
}

/** The bands that count as mastered (`learner.mastery_cache.band`). */
export const MASTERED_BANDS: readonly string[] = ['secure', 'independent'];

interface Visible {
  readonly visibilityState: string;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

interface PageWindow {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/**
 * A session is the app on screen. Opened now if the page is visible, closed when it is hidden or
 * the page goes, opened again when it comes back. Returns the unsubscribe, which closes the
 * session too.
 */
export function watchSessions(doc: Visible, win: PageWindow): () => void {
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') openSession();
    else closeSession();
  };
  const onHide = () => closeSession();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onHide);
  if (doc.visibilityState === 'visible') openSession();
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onHide);
    closeSession();
  };
}
