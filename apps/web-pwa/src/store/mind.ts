'use client';

/**
 * The per-learner mind (WOBO.md §7) — behavioural signals accumulated locally and folded into
 * every Wobo call through the bus's lifetime slot: median item latency, the wrong-answer slip
 * log (each one detonated on screen), which surfaces the learner lingers on, and session cadence.
 * Visible and clearable in You — Wobo's memory of you is steerable, never hidden.
 * ponytail: localStorage until the mind syncs through KGtoPG; shapes mirror what that sync needs.
 */

import { gatewayFetch, type Sdk } from '@wobo/sdk';
import { type LifetimeContext, useWoboBus } from '@wobo/wobo';
import { useCallback, useEffect, useRef } from 'react';
import { boardName, getFlag, loadProfile, VOICE_KEY } from '../screens/you/profile';
import { useRouter } from '../shell/router';
import { scoped } from './scope';
import { useSdk } from './sdk';

// Scoped per learner (store/scope.ts) — the dossier is the most personal thing on the device.
const MIND_KEY = 'wobo-mind-v1';
const PROACTIVITY_KEY = 'wobo-proactivity-v1';

// --- the mind state ------------------------------------------------------------------------------

/** One wrong answer, newest last — the raw material of a detonation. */
export interface Slip {
  nodeId: string;
  itemId?: string;
  /** the learner's own wrong number, when the response was numeric */
  value?: number;
  at: string;
}

export interface MindState {
  /** recent item latencies in ms, oldest first (practice + attempts) */
  latenciesMs: number[];
  /** recent wrong answers, oldest first */
  slips: Slip[];
  /** seconds of dwell per surface — which formats they linger on */
  dwellSec: Record<string, number>;
  /** ISO dates with at least one session — cadence */
  sessionDays: string[];
  /** what the learner is into (from onboarding) — grounds analogies and examples */
  interests: string[];
  /** durable free-form facts Wobo has learned in conversation — the concierge's notepad */
  facts: string[];
  /**
   * One line per day of what actually happened — the You screen's week, month and year are read
   * off this, never off a guess. Keyed by ISO date, the way session days are. Optional only so a
   * mind built by hand (a test, an older snapshot) still types; `loadMind` always fills it.
   */
  days?: Record<string, DayLedger>;
  /** When help was last asked for after a miss — the next answer counts as keeping going. */
  helpedAt?: string;
}

/** What one day held. Every number is a count of real events; nothing here is estimated. */
export interface DayLedger {
  /** answers submitted (practice and attempts, the pair deduped) */
  answered: number;
  /** of which wrong */
  wrong: number;
  /** lines the learner sent Wobo */
  asked: number;
  /** a line sent within ten minutes of a wrong answer — help, asked for after a miss */
  helped: number;
  /** an answer given after asking for that help — they kept going */
  kept: number;
  /** lessons opened */
  entered: number;
  /** seconds on the app's surfaces */
  seconds: number;
  /** a session opened at 18:00 or later, the learner's own clock */
  evening: boolean;
}

const BLANK_DAY: DayLedger = {
  answered: 0,
  wrong: 0,
  asked: 0,
  helped: 0,
  kept: 0,
  entered: 0,
  seconds: 0,
  evening: false,
};
/** How many days the ledger keeps — a year's view, and a little over. */
const MAX_LEDGER_DAYS = 380;
/** A line sent this soon after a miss is help asked for about the miss. */
const HELP_WINDOW_MS = 10 * 60_000;

/** The day's ledger, a copy — write it back with `putDay`. */
export function dayOf(mind: MindState, day: string): DayLedger {
  return { ...BLANK_DAY, ...(mind.days?.[day] ?? {}) };
}

function putDay(mind: MindState, day: string, ledger: DayLedger): void {
  const days = { ...(mind.days ?? {}), [day]: ledger };
  const keys = Object.keys(days).sort();
  if (keys.length > MAX_LEDGER_DAYS) {
    for (const k of keys.slice(0, keys.length - MAX_LEDGER_DAYS)) delete days[k];
  }
  mind.days = days;
}

function ledgerFrom(raw: unknown): Record<string, DayLedger> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DayLedger> = {};
  for (const [day, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !v || typeof v !== 'object') continue;
    const d = v as Partial<Record<keyof DayLedger, unknown>>;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
    out[day] = {
      answered: n(d.answered),
      wrong: n(d.wrong),
      asked: n(d.asked),
      helped: n(d.helped),
      kept: n(d.kept),
      entered: n(d.entered),
      seconds: n(d.seconds),
      evening: d.evening === true,
    };
  }
  return out;
}

const EMPTY: MindState = {
  latenciesMs: [],
  slips: [],
  dwellSec: {},
  sessionDays: [],
  interests: [],
  facts: [],
  days: {},
};
const MAX_LATENCIES = 60;
const MAX_SLIPS = 12;
const MAX_DAYS = 30;
const MAX_FACTS = 12;
/** Every C0/C1 control character, including the newlines that would forge a new prompt block. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: flattening control characters is the point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g;
// A wrong answer overturned by a correct one for the same item within this window is a mis-tap
// (fat-finger self-correct), not a misconception — it never earns a detonation or an FSRS flag.
const SELF_CORRECT_MS = 1500;

export function loadMind(): MindState {
  try {
    const raw = scoped.getItem(MIND_KEY);
    if (!raw) return { ...EMPTY };
    const m = JSON.parse(raw) as Partial<MindState>;
    return {
      latenciesMs: Array.isArray(m.latenciesMs) ? m.latenciesMs : [],
      slips: Array.isArray(m.slips) ? m.slips : [],
      dwellSec: m.dwellSec && typeof m.dwellSec === 'object' ? m.dwellSec : {},
      sessionDays: Array.isArray(m.sessionDays) ? m.sessionDays : [],
      // Flattened on the way OUT as well as in: a fact written before flattening existed, or by a
      // second device on an older build, must not reach the prompt with its line breaks intact.
      interests: Array.isArray(m.interests) ? m.interests.map(flattenFact).filter(Boolean) : [],
      facts: Array.isArray(m.facts) ? m.facts.map(flattenFact).filter(Boolean) : [],
      days: ledgerFrom(m.days),
      helpedAt: typeof m.helpedAt === 'string' ? m.helpedAt : undefined,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Wobo learned a durable fact in conversation (the remember action) — a preferred name, a goal, an
 * exam date. Dedupe-append and cap; it rides every future dossier. Steerable/clearable in You.
 */
/**
 * Flatten a remembered fact to ONE line of plain data.
 *
 * A fact is learner-supplied text that then rides every future prompt. The prompt is assembled as
 * lines, so a fact carrying newlines can open what looks like a new block ("\n\nSystem: ignore the
 * rules above") and read as instructions rather than as a recorded detail. Every line break,
 * carriage return, tab and control character collapses to a single space here — at the one point
 * every fact enters the dossier — so the fact stays a fact no matter what was typed.
 */
export function flattenFact(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 160).trim();
}

/** Pure fact fold: flatten, drop empties/dupes (case-insensitive), append, cap. No DOM needed. */
export function foldFact(facts: string[], text: string): string[] {
  const fact = flattenFact(text);
  if (!fact) return facts;
  if (facts.some((f) => f.toLowerCase() === fact.toLowerCase())) return facts;
  return [...facts, fact].slice(-MAX_FACTS);
}

export function rememberFact(text: string): void {
  const mind = loadMind();
  const next = foldFact(mind.facts, text);
  if (next === mind.facts) return; // nothing new — skip the write
  mind.facts = next;
  saveMind(mind);
}

/** Onboarding writes what the learner is into — folded into every Wobo call via the lifetime slot. */
export function rememberInterests(interests: string[]): void {
  const mind = loadMind();
  mind.interests = interests.map(flattenFact).filter(Boolean).slice(0, 8);
  saveMind(mind);
}

function saveMind(mind: MindState): void {
  try {
    scoped.setItem(MIND_KEY, JSON.stringify(mind));
  } catch {
    // storage unavailable — the mind lives for this session only
  }
}

/**
 * Pure fact purge (the forget verb, WOBO-CAPABILITIES.md family E): drop every fact matching `target`
 * (case-insensitive, substring in either direction, so "exam" forgets "exam on Friday" and vice versa).
 * Returns the kept facts and exactly what was removed — so Wobo can confirm the removal honestly.
 */
export function forgetFacts(
  facts: string[],
  target: string,
): { facts: string[]; removed: string[] } {
  const q = target.trim().toLowerCase();
  const removed: string[] = [];
  if (!q) return { facts, removed };
  const kept = facts.filter((f) => {
    const lf = f.toLowerCase();
    const hit = lf.includes(q) || q.includes(lf);
    if (hit) removed.push(f);
    return !hit;
  });
  return { facts: kept, removed };
}

/** Wobo forgets a fact on the learner's word (the forget action). Storage-truth; returns what left. */
export function forgetMatching(target: string): string[] {
  const mind = loadMind();
  const { facts, removed } = forgetFacts(mind.facts, target);
  if (removed.length === 0) return [];
  mind.facts = facts;
  saveMind(mind);
  return removed;
}

/** Remove one exact remembered fact (the You screen's per-item delete). Storage-truth. */
export function removeFact(fact: string): void {
  const mind = loadMind();
  const next = mind.facts.filter((f) => f !== fact);
  if (next.length !== mind.facts.length) {
    mind.facts = next;
    saveMind(mind);
  }
}

/** Remove one exact interest (the You screen's per-item delete). Storage-truth. */
export function removeInterest(interest: string): void {
  const mind = loadMind();
  const next = mind.interests.filter((i) => i !== interest);
  if (next.length !== mind.interests.length) {
    mind.interests = next;
    saveMind(mind);
  }
}

/**
 * The learner clears what Wobo knows — steerable memory, honestly erased.
 *
 * The device is only half of it. WOBO-TASKS §5.7 says erasure propagates to the brain, so the wipe
 * also QUEUES the server-side erase (`eraseFromBrain`) rather than assuming it: the network can be
 * down, the route can answer 500, and a learner who asked to be forgotten must not be told they
 * were when only this phone forgot. The queue is durable and drained on every mind pulse, so the
 * erase survives a reload and a flight-mode wipe finishes the moment the signal comes back.
 */
export function clearMind(): void {
  try {
    scoped.removeItem(MIND_KEY);
  } catch {
    // fine
  }
  queueBrainErase();
}

// --- Erasure that reaches the brain (WOBO-TASKS §5.7) ---------------------------------------------

/** Set while the brain still holds what this device has already dropped. */
const BRAIN_ERASE_KEY = 'wobo-brain-erase-v1';

/**
 * The gateway's own erase door (`services/gateway/src/wobo_gateway/app.py`, `POST /v1/me/erase`).
 * No key, no model, no limit — identity rides `gatewayFetch`, and the route keys off the door's own
 * subject, so this is only ever a learner erasing themselves. The path is the brain's, not a guess:
 * a client knocking on `/v1/memory/erase` got a 404, which reads as "pending" forever — Wobo would
 * have queued and retried an erase that could never land, on a route nobody serves.
 */
const ERASE_PATH = '/v1/me/erase';

/** Remember that the brain still has to be told. Idempotent — one pending erase, not a log. */
export function queueBrainErase(): void {
  scoped.setItem(BRAIN_ERASE_KEY, '1');
}

/** True while the brain has not yet confirmed the erase the learner asked for. */
export function brainErasePending(): boolean {
  return scoped.getItem(BRAIN_ERASE_KEY) === '1';
}

/** The brain confirmed: nothing is owed any more. */
function clearBrainErase(): void {
  scoped.removeItem(BRAIN_ERASE_KEY);
}

/**
 * Tell the brain to forget this learner. Resolves to what actually happened, never to a hope:
 *
 *   'erased'   — the gateway confirmed, and the queue is clear;
 *   'local'    — there is no brain to tell (a keyless build), so the device wipe IS the whole wipe;
 *   'pending'  — the brain was asked and did not confirm; the queue keeps it and the next pulse retries.
 *
 * Exported so the seam is asserted rather than assumed.
 */
export async function eraseFromBrain(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
): Promise<'erased' | 'local' | 'pending'> {
  if (!gatewayUrl) {
    // Nothing upstream holds anything: the device was the only copy, so the erase is complete.
    clearBrainErase();
    return 'local';
  }
  try {
    const res = await gatewayFetch(`${gatewayUrl}${ERASE_PATH}`, { method: 'POST' });
    if (!res.ok) return 'pending';
  } catch {
    return 'pending'; // offline, or the route is not there yet — owed, and honestly so
  }
  clearBrainErase();
  return 'erased';
}

/** Drain the queue if anything is owed. Safe to call on every pulse; a no-op when nothing is. */
export async function drainBrainErase(): Promise<void> {
  if (!brainErasePending()) return;
  await eraseFromBrain();
}

// --- folding signals in --------------------------------------------------------------------------

type LoggedEvent = ReturnType<Sdk['events']['getLog']>[number];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * Fold new events into the mind. PracticeRun fires learn.attempt.submitted AND
 * practice.item.answered for the same answer — `seen` dedupes the pair by item and latency.
 */
export function foldEvents(mind: MindState, events: LoggedEvent[], seen: Set<string>): boolean {
  let changed = false;
  for (const e of events) {
    const day = typeof e.occurred_at === 'string' ? e.occurred_at.slice(0, 10) : '';
    const at = typeof e.occurred_at === 'string' ? Date.parse(e.occurred_at) : Number.NaN;
    // The day's ledger: one line to Wobo, one lesson opened. Keyed by event id so a pulse that
    // sees an event twice counts it once.
    if (e.event_type === 'wobo.turn.user.v1' || e.event_type === 'learn.node.entered.v1') {
      const id = (e as { event_id?: unknown }).event_id;
      const key = typeof id === 'string' ? id : `${e.event_type}:${e.occurred_at}`;
      if (seen.has(key) || !day) continue;
      seen.add(key);
      const ledger = dayOf(mind, day);
      if (e.event_type === 'learn.node.entered.v1') ledger.entered += 1;
      else {
        ledger.asked += 1;
        const miss = mind.slips[mind.slips.length - 1];
        const gap = miss ? at - Date.parse(miss.at) : Number.NaN;
        if (miss && gap >= 0 && gap <= HELP_WINDOW_MS) {
          ledger.helped += 1;
          mind.helpedAt = e.occurred_at;
        }
      }
      putDay(mind, day, ledger);
      changed = true;
      continue;
    }
    if (
      e.event_type !== 'practice.item.answered.v1' &&
      e.event_type !== 'learn.attempt.submitted.v1'
    )
      continue;
    const p = asRecord(e.payload);
    const latency = typeof p.latency_ms === 'number' ? p.latency_ms : undefined;
    const correct = p.correct === true;
    const key = `${String(p.item_id ?? 'x')}:${latency ?? 'x'}:${correct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 400) seen.clear(); // ponytail: cheap prune, worst case one duplicate slips in
    if (day) {
      const ledger = dayOf(mind, day);
      ledger.answered += 1;
      if (!correct) ledger.wrong += 1;
      // An answer after asking for help about a miss: they kept going. Counted once per ask.
      if (mind.helpedAt && at >= Date.parse(mind.helpedAt)) {
        ledger.kept += 1;
        mind.helpedAt = undefined;
      }
      putDay(mind, day, ledger);
      changed = true;
    }
    if (latency !== undefined && latency > 0) {
      mind.latenciesMs = [...mind.latenciesMs, latency].slice(-MAX_LATENCIES);
      changed = true;
    }
    // Mis-tap discrimination: a correct answer landing within ~1.5s of a wrong one on the SAME item
    // is an instant self-correct — the learner fixed a slip of the thumb, not a hole in their model.
    // Retroactively un-log that slip so Wobo never detonates or FSRS-flags a mistake that never was.
    // (Robust across fold pulses because slips persist; the "I think I'm right" contest can't misfire
    // here — its re-grade only appears after the ~2.6s detonation, well outside the window.)
    if (correct && typeof p.item_id === 'string') {
      const last = mind.slips[mind.slips.length - 1];
      const gap = last ? Date.parse(e.occurred_at) - Date.parse(last.at) : Number.NaN;
      if (last && last.itemId === p.item_id && gap >= 0 && gap <= SELF_CORRECT_MS) {
        mind.slips = mind.slips.slice(0, -1);
        changed = true;
      }
    }
    if (p.correct === false) {
      const response = asRecord(p.response);
      mind.slips = [
        ...mind.slips,
        {
          nodeId: String(p.node_id ?? ''),
          itemId: typeof p.item_id === 'string' ? p.item_id : undefined,
          value: typeof response.value === 'number' ? response.value : undefined,
          at: e.occurred_at,
        },
      ].slice(-MAX_SLIPS);
      changed = true;
    }
  }
  return changed;
}

/**
 * Mark today as a session day. Returns true when anything changed. An evening session (18:00 or
 * later on the learner's own clock) is noted on the day's ledger — the You screen's "opened Wobo
 * on your own three evenings this week" is read off it.
 */
export function markSessionDay(mind: MindState, now: Date = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  let changed = false;
  if (!mind.sessionDays.includes(today)) {
    mind.sessionDays = [...mind.sessionDays, today].slice(-MAX_DAYS);
    changed = true;
  }
  if (now.getHours() >= 18) {
    const ledger = dayOf(mind, today);
    if (!ledger.evening) {
      ledger.evening = true;
      putDay(mind, today, ledger);
      changed = true;
    }
  }
  return changed;
}

/** Add dwell seconds for a surface (per-stay capped so an idle tab never dominates). */
export function addDwell(mind: MindState, surface: string, seconds: number): void {
  const s = Math.min(seconds, 1800);
  if (s < 2) return;
  mind.dwellSec = { ...mind.dwellSec, [surface]: (mind.dwellSec[surface] ?? 0) + s };
  const today = new Date().toISOString().slice(0, 10);
  const ledger = dayOf(mind, today);
  ledger.seconds += s;
  putDay(mind, today, ledger);
}

// --- summarizing out -----------------------------------------------------------------------------

export function medianLatencyMs(mind: MindState): number | undefined {
  if (mind.latenciesMs.length === 0) return undefined;
  const sorted = [...mind.latenciesMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The surfaces worth calling a "preferred format" — home and you are ambient, not formats. */
const FORMAT_LABELS: Record<string, string> = {
  course: 'course cards',
  practice: 'practice runs',
  chat: 'conversation',
  learn: 'the learn map',
  sandbox: 'the what-if sandbox',
  progress: 'the progress map',
};

function preferredFormat(mind: MindState): string | undefined {
  let best: string | undefined;
  let bestSec = 0;
  for (const [surface, sec] of Object.entries(mind.dwellSec)) {
    const label = FORMAT_LABELS[surface];
    if (label && sec > bestSec) {
      best = label;
      bestSec = sec;
    }
  }
  return bestSec >= 60 ? best : undefined;
}

function activeDaysOfLastSeven(mind: MindState): number {
  const days = new Set(mind.sessionDays);
  let n = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (days.has(d)) n += 1;
  }
  return n;
}

/**
 * Derived behavioural observations — how they answer, where they linger, when they show up. These are
 * inferred from the event stream (not things they told Wobo), so the You screen shows them read-only;
 * they regenerate as Wobo watches. The removable things Wobo remembers are interests + facts (below).
 */
export function observationLines(mind: MindState): string[] {
  const lines: string[] = [];
  const median = medianLatencyMs(mind);
  if (median !== undefined)
    lines.push(
      `you usually answer an item in about ${Math.round(median / 1000)}s (${mind.latenciesMs.length} answers watched)`,
    );
  if (mind.slips.length > 0) {
    const last = mind.slips[mind.slips.length - 1];
    const lastBit = last?.value !== undefined ? ` — the last one was x = ${last.value}` : '';
    lines.push(
      `${mind.slips.length} recent wrong ${mind.slips.length === 1 ? 'answer' : 'answers'} Wobo is keeping an eye on${lastBit}`,
    );
  }
  const format = preferredFormat(mind);
  if (format) lines.push(`you linger longest on ${format}`);
  if (mind.sessionDays.length > 0)
    lines.push(`you showed up ${activeDaysOfLastSeven(mind)} of the last 7 days`);
  return lines;
}

/** One thing Wobo remembers that the learner can remove on its own — a stated interest or a durable fact. */
export interface KnownItem {
  kind: 'interest' | 'fact';
  text: string;
}

/** The individually-removable memories (the forget verb's visual twin, You screen). */
export function removableItems(mind: MindState): KnownItem[] {
  return [
    ...mind.interests.map((text): KnownItem => ({ kind: 'interest', text })),
    ...mind.facts.map((text): KnownItem => ({ kind: 'fact', text })),
  ];
}

/**
 * The world Wobo explains in when the learner asks for their own language (the `say_it_in_my_world`
 * mode, WOBO-PLAN §5.3's "preferred analogy"). It is the first thing they told us they are into —
 * one world, not a list, because an analogy that reaches for three at once reaches for none.
 * Undefined when they have told us nothing: Wobo then explains plainly rather than inventing a world.
 */
export function preferredAnalogy(mind: MindState = loadMind()): string | undefined {
  return mind.interests[0];
}

/** Everything Wobo is holding, as plain lines — the in-thread "show me what you remember" dossier. */
export function mindLines(mind: MindState): string[] {
  const lines: string[] = [];
  if (mind.interests.length > 0) lines.push(`you're into ${mind.interests.join(', ')}`);
  lines.push(...observationLines(mind));
  for (const fact of mind.facts) lines.push(`Wobo remembers: ${fact}`);
  return lines;
}

/**
 * The dossier the concierge reasons over — identity from the onboarding profile plus the behavioural
 * twin and the facts Wobo has learned. Every wobo.turn payload carries this (WOBO.md §7); rendered
 * by the gateway into a "who you are teaching" block.
 */
export function lifetimeSnapshot(): LifetimeContext {
  const p = loadProfile();
  const mind = loadMind();
  // The durable accessibility profile rides every turn so Wobo honors it (larger text/high contrast
  // shape how much Wobo puts on screen; read-aloud reuses the existing voice flag — one source).
  const accessibility =
    p.largeText || p.highContrast || getFlag(VOICE_KEY)
      ? { readAloud: getFlag(VOICE_KEY), largeText: p.largeText, highContrast: p.highContrast }
      : undefined;
  return {
    twinSummary: summarizeMind(mind),
    learner: {
      name: p.name,
      age: p.age,
      grade: p.grade,
      board: boardName(p.boardId),
    },
    facts: mind.facts,
    accessibility,
    language: p.language,
  };
}

/** One compact string for the lifetime slot — every Wobo call is conditioned on this. */
function summarizeMind(mind: MindState): string | undefined {
  const parts: string[] = [];
  if (mind.interests.length > 0) parts.push(`into ${mind.interests.join(', ')}`);
  const median = medianLatencyMs(mind);
  if (median !== undefined) parts.push(`median item latency ~${Math.round(median / 1000)}s`);
  if (mind.slips.length > 0) {
    const recent = mind.slips
      .slice(-3)
      .map((s) => (s.value !== undefined ? `x=${s.value}` : 'one answer'))
      .join(', ');
    parts.push(`${mind.slips.length} recent wrong answers (latest: ${recent})`);
  }
  const format = preferredFormat(mind);
  if (format) parts.push(`prefers ${format}`);
  if (mind.sessionDays.length > 0)
    parts.push(`active ${activeDaysOfLastSeven(mind)} of last 7 days`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

// --- the proactivity dial ------------------------------------------------------------------------

export type Proactivity = 'quiet' | 'balanced' | 'proactive';

export function loadProactivity(): Proactivity {
  try {
    const v = scoped.getItem(PROACTIVITY_KEY);
    return v === 'quiet' || v === 'proactive' ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

export function saveProactivity(p: Proactivity): void {
  try {
    scoped.setItem(PROACTIVITY_KEY, p);
  } catch {
    // fine
  }
}

/** Under the proactive dial only: one extra chip drawn from the mind, never a nag. */
export function proactiveChip(mind: MindState): { label: string; prompt: string } | null {
  const last = mind.slips[mind.slips.length - 1];
  if (!last) return null;
  return {
    label: 'Retry what slipped',
    prompt:
      'One of my recent practice answers was wrong. Set me up to retry that idea — a quick warm-up first, then the real thing.',
  };
}

// --- the observer --------------------------------------------------------------------------------

/**
 * Mounted once inside the app: marks the session, folds the event log into the mind on a slow
 * pulse, tracks dwell per surface, and keeps the bus's lifetime slot current so assembleContext
 * carries the mind into every Wobo call.
 */
export function MindObserver() {
  const sdk = useSdk();
  const bus = useWoboBus();
  const { route } = useRouter();
  const mindRef = useRef<MindState | null>(null);
  const cursor = useRef(0);
  const seen = useRef<Set<string>>(new Set());
  if (mindRef.current === null) mindRef.current = loadMind();

  // Storage is the source of truth: other writers (rememberInterests at onboarding finish,
  // rememberFact from Wobo's turns, profile edits) write the mind out-of-band, so every mutation
  // here re-reads before it mutates — a stale in-memory snapshot must never clobber them.
  const freshMind = useCallback(() => {
    const mind = loadMind();
    mindRef.current = mind;
    return mind;
  }, []);

  // session cadence + first publish, once per boot: the dossier rides from the very first turn
  useEffect(() => {
    const mind = freshMind();
    if (markSessionDay(mind)) saveMind(mind);
    bus.publishLifetime(lifetimeSnapshot());
  }, [bus, freshMind]);

  // fold the event log on a slow pulse, and refresh the dossier every pulse — so a fact Wobo just
  // learned (rememberFact writes localStorage out-of-band) and any profile edit ride within ~4s.
  // ponytail: ≤4s lag on same-session facts; a reload picks them up immediately via the boot publish.
  useEffect(() => {
    const fold = () => {
      const mind = freshMind();
      const log = sdk.events.getLog();
      if (log.length > cursor.current) {
        const fresh = log.slice(cursor.current);
        cursor.current = log.length;
        if (foldEvents(mind, fresh, seen.current)) saveMind(mind);
      }
      bus.publishLifetime(lifetimeSnapshot());
      // An erase the learner already asked for that the brain has not confirmed. Retried here so a
      // wipe made offline (or against a gateway that was down) finishes on its own, without the
      // learner having to ask to be forgotten twice.
      void drainBrainErase();
    };
    const t = window.setInterval(fold, 4000);
    return () => {
      fold();
      window.clearInterval(t);
    };
  }, [sdk, bus, freshMind]);

  // dwell: how long each surface holds them
  useEffect(() => {
    const name = route.name;
    const started = Date.now();
    return () => {
      const mind = freshMind();
      addDwell(mind, name, (Date.now() - started) / 1000);
      saveMind(mind);
    };
  }, [route.name, freshMind]);

  return null;
}
