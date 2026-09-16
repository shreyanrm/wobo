'use client';

/**
 * The machine-room selector (WOBO-CAPABILITIES.md family J — the total-context law). Folds the
 * system's internal truth into one lean digest Wobo reads every turn: a mastery-band snapshot, the
 * FSRS spaced-review due queue, XP/level/streak, the recent event-stream tail (what they clicked,
 * answered, hesitated on), and any in-flight content generation.
 *
 * Pure by design: the app gathers the raw inputs (the async mastery view, the progress store, the
 * event log) and hands them here, so the whole digest is testable without a DOM or a network.
 */

import type { MachineRoomContext } from '@wobo/wobo';
import { levelInfo } from './progress';

/** The event fields the machine room reads — a structural subset of the backbone envelope. */
export interface MachineEvent {
  event_type: string;
  occurred_at: string;
  payload?: unknown;
}

export interface MachineInput {
  /** The governed mastery view (only `band` is read). */
  bands: { band: string }[];
  eventLog: MachineEvent[];
  xp: number;
  streakDays: number;
  nowMs: number;
}

const SLOW_ANSWER_MS = 20_000; // past this, an answer reads as a hesitation
const DUE_SOON_MS = 3 * 86_400_000; // "coming up" horizon for the next-few list

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Mastery band snapshot: how many nodes sit in each band right now (not_started is silence). */
function bandCounts(bands: { band: string }[]): Record<string, number> | undefined {
  const counts: Record<string, number> = {};
  for (const b of bands) {
    if (b.band && b.band !== 'not_started') counts[b.band] = (counts[b.band] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/**
 * Reconstruct the spaced-review queue from the backbone: the latest schedule per item wins, due now
 * = due_at at or before now, and the soonest few (overdue first, within the horizon) ride as next.
 */
function reviewQueue(log: MachineEvent[], nowMs: number): MachineRoomContext['reviews'] {
  const latest = new Map<string, { node: string; dueMs: number }>();
  for (const e of log) {
    if (e.event_type !== 'practice.retrieval.scheduled.v1') continue;
    const p = rec(e.payload);
    const item = String(p.item_id ?? p.node_id ?? '');
    const dueMs = Date.parse(String(p.due_at ?? ''));
    if (!item || Number.isNaN(dueMs)) continue;
    latest.set(item, { node: String(p.node_id ?? item), dueMs }); // later events overwrite earlier
  }
  if (latest.size === 0) return undefined;
  const cards = [...latest.values()].sort((a, b) => a.dueMs - b.dueMs);
  const dueCount = cards.filter((c) => c.dueMs <= nowMs).length;
  const next = cards
    .filter((c) => c.dueMs <= nowMs + DUE_SOON_MS)
    .slice(0, 3)
    .map((c) => ({ node: c.node, inMinutes: Math.max(0, Math.round((c.dueMs - nowMs) / 60000)) }));
  return { dueCount, scheduled: cards.length, next: next.length > 0 ? next : undefined };
}

/** In-flight generation: the most recent create request no later compile has answered. */
function generating(log: MachineEvent[]): MachineRoomContext['generating'] {
  let lastRequest: MachineEvent | undefined;
  let lastCompiledMs = 0;
  for (const e of log) {
    if (e.event_type === 'create.request.submitted.v1') lastRequest = e;
    else if (e.event_type === 'create.course.compiled.v1')
      lastCompiledMs = Math.max(lastCompiledMs, Date.parse(e.occurred_at) || 0);
  }
  if (!lastRequest) return undefined;
  const reqMs = Date.parse(lastRequest.occurred_at) || 0;
  if (reqMs <= lastCompiledMs) return undefined; // already answered — nothing in flight
  const prompt = String(rec(lastRequest.payload).prompt_text ?? '').trim();
  return { what: prompt || 'a course' };
}

/** The event-stream tail (~8), richest last: what they clicked, answered, hesitated on. */
function eventTail(log: MachineEvent[]): string[] | undefined {
  const tail = log.slice(-8).map((e) => {
    const p = rec(e.payload);
    const name = e.event_type.replace(/\.v1$/, '');
    if (p.correct !== undefined) {
      const latency = typeof p.latency_ms === 'number' ? p.latency_ms : undefined;
      const slow = latency !== undefined && latency > SLOW_ANSWER_MS ? ', hesitated' : '';
      return `${name} (${p.correct ? 'correct' : 'wrong'}${slow})`;
    }
    if (typeof p.assistance_level === 'string') return `${name} (${p.assistance_level})`;
    return name;
  });
  return tail.length > 0 ? tail : undefined;
}

/** Fold the raw inputs into the machine-room digest the gateway renders. */
export function machineRoomSnapshot(input: MachineInput): MachineRoomContext {
  const lvl = levelInfo(input.xp);
  return {
    masteryBands: bandCounts(input.bands),
    reviews: reviewQueue(input.eventLog, input.nowMs),
    progress: {
      xp: input.xp,
      level: lvl.level,
      intoLevel: lvl.intoLevel,
      toNext: lvl.toNext,
      streakDays: input.streakDays,
    },
    eventTail: eventTail(input.eventLog),
    generating: generating(input.eventLog),
  };
}

// ponytail: one runnable check — dev-only, console.assert never throws, a wrong digest just logs.
if (import.meta.env.DEV) {
  const now = 1_700_000_000_000;
  const iso = (dtMs: number) => new Date(dtMs).toISOString();
  const snap = machineRoomSnapshot({
    xp: 100,
    streakDays: 3,
    nowMs: now,
    bands: [
      { band: 'developing' },
      { band: 'developing' },
      { band: 'secure' },
      { band: 'not_started' },
    ],
    eventLog: [
      {
        event_type: 'create.request.submitted.v1',
        occurred_at: iso(now - 5000),
        payload: { prompt_text: 'photosynthesis' },
      },
      {
        event_type: 'practice.retrieval.scheduled.v1',
        occurred_at: iso(now - 4000),
        payload: { item_id: 'i1', node_id: 'n1', due_at: iso(now - 60000) },
      },
      {
        event_type: 'practice.item.answered.v1',
        occurred_at: iso(now - 1000),
        payload: { correct: false, latency_ms: 25000 },
      },
    ],
  });
  console.assert(
    snap.masteryBands?.developing === 2 && snap.masteryBands?.secure === 1,
    'band counts',
  );
  console.assert(snap.masteryBands?.not_started === undefined, 'not_started excluded');
  // docs/LEVELS.md §2: 90 xp reaches level 3 and 210 reaches level 4, so 100 is level 3 with 110
  // still to go. Pinned for real, against the law's own table, in `store/levels.test.ts`.
  console.assert(snap.progress?.level === 3 && snap.progress?.toNext === 110, 'level@100');
  console.assert(snap.reviews?.dueCount === 1 && snap.reviews?.scheduled === 1, 'one review due');
  console.assert(snap.generating?.what === 'photosynthesis', 'generation in flight');
  console.assert(
    snap.eventTail?.some((l) => l.includes('hesitated')) ?? false,
    'hesitation marked',
  );
}
