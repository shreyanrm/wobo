'use client';

/**
 * Wobo the tutor (WOBO.md §8) — the assistance ladder, hint depths that never hand the answer
 * below check-my-work, the "I think I'm right" re-grade path, teach-back (the protégé effect),
 * and the concept-graph bridge that travels only over mastered ground.
 *
 * The ladder state lives here as one small module store shared by Wobo's drawer and the course
 * player — the conversation and the canvas always agree on how much support Wobo is giving.
 */

import type { PracticeItem, Sdk } from '@wobo/sdk';
import { useSyncExternalStore } from 'react';
import type { Topic } from '../data/model';
import { firstMove, fmt, linearize } from '../screens/course/equations';

// --- the assistance ladder (CONTEXT.md §8: show me → … → let me do it independently) -------------

export const LADDER = [
  'learn',
  'coach',
  'hint',
  'work_with_me',
  'check_my_work',
  'challenge',
  'assessment',
] as const;
export type AssistMode = (typeof LADDER)[number];

const idx = (m: AssistMode) => LADDER.indexOf(m);

/** Below this rung Wobo never hands the final answer — the hint ladder stops one move short. */
export const ANSWER_FLOOR: AssistMode = 'check_my_work';
export const canRevealAnswer = (m: AssistMode): boolean => idx(m) >= idx(ANSWER_FLOOR);
/** Hint depths run 1..4; depth 4 (the answer check) opens only at check-my-work and beyond. */
export const maxHintDepth = (m: AssistMode): number => (canRevealAnswer(m) ? 4 : 3);

interface TutorState {
  mode: AssistMode;
  correctStreak: number;
  missStreak: number;
}

let state: TutorState = { mode: 'coach', correctStreak: 0, missStreak: 0 };
const listeners = new Set<() => void>();
const emit = (next: TutorState) => {
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => state;

/** The shared ladder state — the drawer whisper and the course player both read this. */
export function useTutor(): TutorState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Two clean answers in a row and support visibly fades — one rung toward assessment. */
export function noteCorrect(): void {
  const streak = state.correctStreak + 1;
  if (streak >= 2 && idx(state.mode) < LADDER.length - 1) {
    emit({ mode: LADDER[idx(state.mode) + 1] as AssistMode, correctStreak: 0, missStreak: 0 });
  } else {
    emit({ ...state, correctStreak: streak, missStreak: 0 });
  }
}

/** Two misses in a row and Wobo steps closer — one rung toward learn. Never below it. */
export function noteMiss(): void {
  const streak = state.missStreak + 1;
  if (streak >= 2 && idx(state.mode) > 0) {
    emit({ mode: LADDER[idx(state.mode) - 1] as AssistMode, correctStreak: 0, missStreak: 0 });
  } else {
    emit({ ...state, missStreak: streak, correctStreak: 0 });
  }
}

// --- the hint ladder (escalating depth, computed from the equation, never asserted) ---------------

/**
 * A hint at the given depth (1..4), capped by the current mode. Depths 1-3 orient, name the
 * strategy, and show the honest first move (which itself withholds any answer-revealing result);
 * depth 4 — the substitution check against the true x — exists only at check-my-work and beyond.
 */
export function hintFor(item: PracticeItem, depth: number, mode: AssistMode): string {
  const d = Math.max(1, Math.min(depth, maxHintDepth(mode)));
  const lin = linearize(item.equation);
  if (!lin) return 'read it once aloud — which part is the unknown, and what has been done to it?';
  if (d === 1) {
    // Grounded in this item's own numbers, so consecutive problems never read identically.
    const term = lin.b > 0 ? `+ ${fmt(lin.b)}` : `− ${fmt(Math.abs(lin.b))}`;
    if (lin.a !== 1 && lin.b !== 0)
      return `two things wrap x here: a ×${fmt(lin.a)} and a ${term}. undo the ${term} first, same on both sides.`;
    if (lin.a !== 1)
      return `x is multiplied by ${fmt(lin.a)} — divide both sides by ${fmt(lin.a)} to free it.`;
    if (lin.b !== 0) return `peel the ${term} off first — do the opposite to both sides.`;
    return 'one honest move undoes this — whatever you do to one side, you do to the other.';
  }
  const move = firstMove(lin);
  if (d === 2) return `the move is: ${move.text}.`;
  if (d === 3) {
    return move.result
      ? `${move.text} → ${move.result}. the finish is yours.`
      : `${move.text} — that single move leaves x standing alone.`;
  }
  return `you may check now: put x = ${fmt(lin.x)} into both sides — they should land on the same number.`;
}

// --- the "I think I'm right" re-grade path --------------------------------------------------------

export interface Regrade {
  upheld: boolean;
  note: string;
}

/**
 * The learner contests an evaluated answer; the verifier looks again. The substitution proof is
 * deterministic and authoritative — the capability call rides along so the live gateway path is
 * exercised, but a mock stub can never overturn arithmetic.
 */
export async function regrade(sdk: Sdk, item: PracticeItem, value: number): Promise<Regrade> {
  const lin = linearize(item.equation);
  let upheld: boolean;
  let detail: string;
  if (lin) {
    const lhs = lin.lhs(value);
    const rhs = lin.rhs(value);
    upheld = Math.abs(lhs - rhs) < 1e-9;
    detail = `x = ${fmt(value)} makes the two sides ${fmt(lhs)} and ${fmt(rhs)}`;
  } else {
    upheld = Math.abs(value - Number(item.answer)) < 1e-9;
    detail = `x = ${fmt(value)} was re-checked against the verified answer`;
  }
  try {
    const res = await sdk.llm.invoke(
      'verify.math',
      { equation: item.equation, claimed_answer: String(value) },
      { consentTier: 'un_elevated' },
    );
    const out = res.output as { verified?: boolean };
    // ponytail: only when local linearization failed does the capability verdict decide
    if (!lin && typeof out.verified === 'boolean') upheld = out.verified;
  } catch {
    // the local proof already decided; the verifier being unreachable changes nothing
  }
  return {
    upheld,
    note: upheld
      ? `you were right — ${detail}. the grade bends to the proof.`
      : `looked again: ${detail} — still unequal. good instinct to contest, though.`,
  };
}

// --- teach-back (Wobo plays the student; one gap probed per turn) -----------------------------------

export interface TeachBackTurn {
  id: string;
  role: 'learner' | 'wobo';
  text: string;
}

interface Gap {
  id: 'mechanism' | 'example' | 'boundary';
  present: (t: string) => boolean;
  probe: string;
}

const GAPS: Gap[] = [
  {
    id: 'mechanism',
    present: (t) => /because|why|since|reason|keeps|stays|same|balance|equal|undo/i.test(t),
    probe: 'okay… but why does that work? what keeps it true when you do it?',
  },
  {
    id: 'example',
    present: (t) => /\d/.test(t),
    probe: 'can you show me with real numbers? pick small ones so I can follow.',
  },
  {
    id: 'boundary',
    present: (t) => /unless|except|negative|zero|but if|breaks|careful|only if/i.test(t),
    probe: 'is there a case where that stops working — a negative, a zero, something sneaky?',
  },
];

export const MAX_PROBES = 3;

export function teachBackOpening(topic: string): string {
  return `explain ${topic.toLowerCase()} to me like I have never seen it. Start anywhere.`;
}

/**
 * One learner explanation in; exactly one probe out — the first gap Wobo's student-self genuinely
 * cannot fill from what was said. When nothing is missing (or Wobo has probed their fill), the
 * teach-back is complete.
 */
export function probeTeachBack(
  explanation: string,
  probed: string[],
  topic: string,
): { reply: string; gap: string | null; complete: boolean } {
  if (explanation.trim().length < 20) {
    return {
      reply:
        'that was quick — pretend I have truly never seen this. start from the very beginning.',
      gap: null,
      complete: false,
    };
  }
  const gap =
    probed.length < MAX_PROBES
      ? GAPS.find((g) => !probed.includes(g.id) && !g.present(explanation))
      : undefined;
  if (gap) return { reply: gap.probe, gap: gap.id, complete: false };
  return {
    reply: `oh — I actually get it now. you taught me ${topic.toLowerCase()} properly, and teaching it is the strongest kind of knowing. bonus earned.`,
    gap: null,
    complete: true,
  };
}

// --- the concept-graph bridge (travels only over mastered ground) ----------------------------------

/**
 * Walk the prerequisite graph under a gated topic and keep what the learner has already
 * completed, deepest ground first — the solid stones the bridge is laid on.
 */
export function masteredGround(
  topic: Topic,
  completed: ReadonlySet<string>,
  lookup: (id: string) => Topic | undefined,
): Topic[] {
  const seen = new Set<string>();
  const out: Topic[] = [];
  const walk = (t: Topic) => {
    for (const id of t.prereqTopicIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = lookup(id);
      if (!p) continue;
      walk(p);
      if (completed.has(p.id)) out.push(p);
    }
  };
  walk(topic);
  return out;
}

/**
 * One step of a bridge. `title` names it; `idea` is what the step actually SAYS.
 *
 * The idea used to be thrown away: `composeBridge` kept `c.title` and dropped the card, so the
 * bridge rendered as a table of contents and the learner was then told they were carrying the
 * ground. A step with no body teaches nothing, and a card made of them is a list of promises.
 */
export interface BridgeStep {
  title: string;
  /** The step's own words. Empty when the engine gave a heading and nothing under it. */
  idea: string;
}

export interface BridgePlan {
  steps: BridgeStep[];
  /** True when the outline is the honest local floor rather than a composed course. */
  seeded: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Ask engine.compose for a bridge lesson scaffolded only on mastered ground; when the engine
 * has nothing verified to offer (seed mode, refusal, timeout), the floor is an honest outline
 * built from the learner's own completed topics — never an error, never an invention.
 */
export async function composeBridge(sdk: Sdk, topic: Topic, ground: Topic[]): Promise<BridgePlan> {
  try {
    const res = await sdk.llm.invoke(
      'engine.compose',
      {
        topic: `a bridge to ${topic.name}`,
        topic_id: topic.id,
        difficulty: 'core',
        bridge_to: topic.name,
        bridge_from: ground.map((g) => g.name),
      },
      { consentTier: 'un_elevated' },
    );
    if (isRecord(res.output)) {
      const src = isRecord(res.output.artifact) ? res.output.artifact : res.output;
      if (res.output.verified !== false && src.verified !== false && Array.isArray(src.cards)) {
        // The card's own body travels with its title. A bridge whose steps are headings is a table
        // of contents, and a table of contents is not a lesson the learner can be said to have had.
        const steps = src.cards
          .filter(isRecord)
          .map((c) => ({
            title: typeof c.title === 'string' ? c.title.trim() : '',
            idea: typeof c.idea === 'string' ? c.idea.trim() : '',
          }))
          .filter((step) => step.title !== '' || step.idea !== '');
        if (steps.length >= 3) return { steps, seeded: false };
      }
    }
  } catch {
    // the floor below is the outcome, never an error state
  }
  return {
    steps: [
      ...ground.map((g) => ({
        title: g.name.toLowerCase(),
        idea: 'already yours. we stand on it and go up from there.',
      })),
      {
        title: topic.name.toLowerCase(),
        idea: 'the new step. we take this one together, slowly, starting now.',
      },
    ],
    seeded: true,
  };
}
