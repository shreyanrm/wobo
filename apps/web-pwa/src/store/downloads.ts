'use client';

/**
 * The course-download queue — on-first-start generation, one in flight per learner (CONTEXT.md
 * content law). A learner taps an ungenerated course; instead of dropping into a spinner, Wobo
 * composes it in the background and lands a notification the moment it is ready. Further taps
 * queue politely behind it (strict FIFO, one at a time), each showing its place in line.
 *
 * This is the pure store: localStorage-backed so the queue survives a reload, a window event so
 * every surface (the card that started it, the global toast) stays in sync. The generation call
 * itself and the notify moment live in DownloadCenter — this module never touches the SDK or the
 * DOM beyond storage. ponytail: a tiny event-emitter over localStorage, no state library.
 */

import { useEffect, useState } from 'react';
import { onScopeChange, scoped } from './scope';

export type DownloadStatus = 'queued' | 'downloading' | 'ready' | 'failed';

export interface Download {
  topicId: string;
  title: string;
  status: DownloadStatus;
  /** Enqueue time — FIFO order and the "one at a time" line are read off this. */
  at: number;
  /** A ready/failed download the learner has not yet acknowledged (drives the toast). */
  seen: boolean;
}

const KEY = 'wobo-downloads-v1';
const EVT = 'wobo-downloads-changed';

function load(): Download[] {
  try {
    const raw = JSON.parse(scoped.getItem(KEY) ?? '[]') as Download[];
    if (!Array.isArray(raw)) return [];
    // A generation lost to a reload was mid-flight and never finished — put it back in line so
    // the runner picks it up again. Nothing is ever stranded as "downloading" across a boot.
    return raw
      .filter((d) => d && typeof d.topicId === 'string' && typeof d.title === 'string')
      .map((d) => (d.status === 'downloading' ? { ...d, status: 'queued' as const } : d));
  } catch {
    return [];
  }
}

// Module-singleton mirror of storage. Every mutation goes through persist() so the on-disk copy
// and the in-memory copy never drift, and one window event fans the change to all listeners.
let items: Download[] = typeof window === 'undefined' ? [] : load();

// Read once at import, which is before the session resolves. Re-read whenever the device changes
// learner, or the mirror would carry the last learner's queue into the next one's storage.
if (typeof window !== 'undefined') {
  onScopeChange(() => {
    items = load();
    window.dispatchEvent(new Event(EVT));
  });
}

function persist(next: Download[]): void {
  items = next;
  try {
    scoped.setItem(KEY, JSON.stringify(items));
  } catch {
    // storage unavailable — the queue is session-only, still fully functional in memory
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}

export function getDownloads(): Download[] {
  return items;
}

export function getDownload(topicId: string): Download | undefined {
  return items.find((d) => d.topicId === topicId);
}

/** 1-based place in the "one at a time" line (queued + the one downloading); 0 if not waiting. */
export function positionOf(topicId: string): number {
  const waiting = items
    .filter((d) => d.status === 'queued' || d.status === 'downloading')
    .sort((a, b) => a.at - b.at);
  const i = waiting.findIndex((d) => d.topicId === topicId);
  return i < 0 ? 0 : i + 1;
}

/** Start (or restart) a download. A no-op while one is already queued/running/ready for this topic. */
export function enqueue(topicId: string, title: string): void {
  const existing = getDownload(topicId);
  if (existing && existing.status !== 'failed') return; // already in line, running, or ready
  const rest = items.filter((d) => d.topicId !== topicId); // drop a prior failed entry
  persist([...rest, { topicId, title, status: 'queued', at: Date.now(), seen: true }]);
}

/**
 * The runner's atomic claim: promote the oldest queued download to `downloading` and return it.
 * Returns undefined when one is already in flight (the one-at-a-time law) or the line is empty.
 */
export function claimNext(): Download | undefined {
  if (items.some((d) => d.status === 'downloading')) return undefined;
  const next = items.filter((d) => d.status === 'queued').sort((a, b) => a.at - b.at)[0];
  if (!next) return undefined;
  persist(items.map((d) => (d.topicId === next.topicId ? { ...d, status: 'downloading' } : d)));
  return next;
}

function settle(topicId: string, status: 'ready' | 'failed'): void {
  if (!getDownload(topicId)) return;
  // seen=false surfaces it in the toast; the card reads status directly.
  persist(items.map((d) => (d.topicId === topicId ? { ...d, status, seen: false } : d)));
}

export function markReady(topicId: string): void {
  settle(topicId, 'ready');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * What a settled compose is: this topic's course, or the honest floor the gateway serves when it
 * has nothing verified for it. The floor is named three ways (`seeded: true`, `provenance.placeholder:
 * true`, `provenance.source: "seed"`; the same reading as Composing.isPlaceholderEnvelope, kept
 * here so the pure store stays free of the player and its engines). The runner used to markReady
 * on ANY settled compose, so a placeholder landed as 'Your course is ready', Wobo said so aloud,
 * and the tap opened 'Still being made' (wave 29). A placeholder is not ready: it settles as failed,
 * which is the one state a later tap restarts from.
 */
export function composeOutcome(output: unknown): 'ready' | 'failed' {
  if (!isRecord(output)) return 'ready'; // an empty mock answer still floors to a real seed course
  if (output.seeded === true) return 'failed';
  const prov = isRecord(output.provenance) ? output.provenance : null;
  if (prov !== null && (prov.placeholder === true || prov.source === 'seed')) return 'failed';
  return 'ready';
}

/** Settle a compose by what it actually returned. */
export function settleCompose(topicId: string, output: unknown): void {
  settle(topicId, composeOutcome(output));
}

// The lines a learner reads on the toast or hears from Wobo. Sentence case, no em dash, no
// exclamation (DESIGN.md §0, voice.md 10a).
export const READY_TOAST = 'Your course is ready. Tap to dive in';
export const SLIPPED_TOAST = 'That one slipped away. Tap to try again';

export function readyLine(title: string): string {
  return `your course on ${title.toLowerCase()} is ready. tap to dive in whenever you like.`;
}

export function markFailed(topicId: string): void {
  settle(topicId, 'failed');
}

/**
 * The course page found a placeholder behind a 'ready' entry (settled by a build older than
 * composeOutcome). It was never ready: it becomes failed, the one state a later tap restarts from,
 * and already seen, so no second toast lands on the learner who is reading the honest line.
 */
export function reconcilePlaceholder(topicId: string): void {
  const d = getDownload(topicId);
  if (!d || d.status !== 'ready') return;
  persist(items.map((x) => (x.topicId === topicId ? { ...x, status: 'failed', seen: true } : x)));
}

/** Acknowledge a landed notification — the toast drops, the ready status stays for the card. */
export function acknowledge(topicId: string): void {
  persist(items.map((d) => (d.topicId === topicId ? { ...d, seen: true } : d)));
}

// --- Hooks ----------------------------------------------------------------------------------------

function useDownloadsRaw(): Download[] {
  const [snap, setSnap] = useState<Download[]>(items);
  useEffect(() => {
    const sync = () => setSnap(items);
    sync(); // catch a mutation that landed between module init and mount
    window.addEventListener(EVT, sync);
    // cross-tab: another tab's storage write reloads our mirror, then fans out
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        items = load();
        setSnap(items);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return snap;
}

/** Live view of the whole queue — the global toast and center subscribe here. */
export function useDownloads(): Download[] {
  return useDownloadsRaw();
}

/** One topic's live download state plus its place in line — a course card subscribes here. */
export function useDownload(topicId: string): { entry: Download | undefined; position: number } {
  const all = useDownloadsRaw();
  const entry = all.find((d) => d.topicId === topicId);
  // positionOf reads the same module mirror `all` is a snapshot of — recomputed each render.
  const position = positionOf(topicId);
  return { entry, position };
}
