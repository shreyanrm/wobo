/**
 * Wobo's capability registry — Wobo's governed hands in the product (WOBO.md §4). Wobo never
 * navigates or acts directly from a model reply: the orchestrator's action path names a
 * capability here, and the permission ladder decides how it runs:
 *
 *   recommend → prepare → execute_with_permission → safe_automatic
 *
 * execute_with_permission renders an inline approval card (approve / not now) before anything
 * happens; safe_automatic runs on its own but is still shown, explained, and recorded. Every
 * outcome — taken or ignored — lands on the event backbone as wobo.offer.outcome.v1.
 */

import type { Sdk } from '@wobo/sdk';
import {
  buildPacket,
  type ContextPacket,
  type FocusObject,
  type MindSummary,
  type PacketBudget,
  type PacketTurn,
  type SurfaceRegistry,
  surfaceRegistry,
  type TaskState,
  type WoboAssembledContext,
} from '@wobo/wobo';
import { clearPlacements } from '../curriculum/placement';
import { chaptersBySubject, topicById } from '../curriculum/registry';
import type { Topic } from '../data/model';
import type { Router } from '../shell/router';
import { clearMind, eraseFromBrain, preferredAnalogy } from '../store/mind';
import type { ActionAttachment } from './paths/types';
import { resetReteach } from './reteach';

export type PermissionRung = 'recommend' | 'prepare' | 'execute_with_permission' | 'safe_automatic';

export type CapabilityId =
  | 'open_course'
  | 'start_practice'
  | 'start_boss'
  | 'go_to_twin'
  | 'prepare_parent_note'
  | 'forget_all';

export interface CapabilityContext {
  router: Router;
  sdk: Sdk;
}

export interface WoboCapability {
  id: CapabilityId;
  rung: PermissionRung;
  /** What the approval button offers, e.g. "open Linear equations". */
  label: (params: Record<string, unknown>) => string;
  /** Executes; returns Wobo's one-line account of what happened. */
  run: (ctx: CapabilityContext, params: Record<string, unknown>) => Promise<string>;
}

/** The atom — the one fully proven course; the default stage when no query resolves. */
const ATOM_TOPIC_ID = 'm2-1';

/** Resolve a free-text course/topic query against the catalog: id first, then name substring. */
export function findTopic(query: string): Topic | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const direct = topicById(q);
  if (direct) return direct;
  for (const chapters of Object.values(chaptersBySubject)) {
    for (const chapter of chapters) {
      for (const topic of chapter.topics) {
        if (topic.name.toLowerCase().includes(q)) return topic;
      }
    }
  }
  return undefined;
}

const resolveTopic = (params: Record<string, unknown>): Topic | undefined =>
  findTopic(String(params.query ?? '')) ?? topicById(ATOM_TOPIC_ID);

const CAPABILITIES: Record<CapabilityId, WoboCapability> = {
  open_course: {
    id: 'open_course',
    rung: 'execute_with_permission',
    label: (p) => {
      const query = String(p.query ?? '').trim();
      const found = findTopic(query);
      if (found) return `open ${found.name}`;
      return query ? `compose a course on ${query}` : 'open the course';
    },
    // A learner can ask for anything — in-syllabus opens the catalog topic; out-of-syllabus
    // composes a fresh course for exactly what they named (Course reads the `custom:` prefix).
    run: async ({ router }, p) => {
      const query = String(p.query ?? '').trim();
      const found = findTopic(query);
      if (found) {
        router.navigate({ name: 'course', topicId: found.id });
        return `We are in ${found.name} — I am right here with you.`;
      }
      if (query) {
        router.navigate({ name: 'course', topicId: `custom:${query}` });
        return `Nothing in the syllabus matched that one — so I am dreaming up a fresh course on ${query}, just for you. Give me a moment.`;
      }
      router.navigate({ name: 'course', topicId: ATOM_TOPIC_ID });
      return 'Let us start where the whole idea clicks — I am right here with you.';
    },
  },

  start_practice: {
    id: 'start_practice',
    rung: 'execute_with_permission',
    label: () => 'start practice',
    run: async ({ router }) => {
      router.navigate({ name: 'practice' });
      return 'practice is open — no hints from me this time, so every answer counts as the real thing.';
    },
  },

  start_boss: {
    id: 'start_boss',
    rung: 'execute_with_permission',
    label: (p) => {
      const topic = resolveTopic(p);
      return topic ? `face the ${topic.name} boss` : 'start the boss';
    },
    run: async ({ router }, p) => {
      const topic = resolveTopic(p);
      if (!topic)
        return 'no boss to face just yet — open a course, and one will be waiting at the finish.';
      // land the journey at the boss door (the course player resumes from this position)
      try {
        const key = 'wobo-course-pos-v1';
        const pos = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>;
        pos[topic.id] = 'bossdoor';
        localStorage.setItem(key, JSON.stringify(pos));
      } catch {
        // position is a nicety; the course still opens
      }
      router.navigate({ name: 'course', topicId: topic.id });
      return `the boss door for ${topic.name} is open. take a breath, then step in.`;
    },
  },

  go_to_twin: {
    id: 'go_to_twin',
    // showing the learner their own map is reversible and harmless — Wobo just does it
    rung: 'safe_automatic',
    label: () => 'open your knowledge twin',
    run: async ({ router }) => {
      router.navigate({ name: 'progress' });
      return 'your twin is up — lit is independent, dim still leans on support.';
    },
  },

  forget_all: {
    id: 'forget_all',
    // The whole memory, gone, with nothing to undo it — the most destructive thing Wobo can do to
    // the learner's world. A model reply saying "forget everything" is never enough on its own: the
    // card asks in the thread, and the wipe happens on approval alone (WOBO.md §4, family E).
    rung: 'execute_with_permission',
    label: () => 'forget what Wobo remembers about you',
    // Erasure has to reach the BRAIN, not just this phone (WOBO-TASKS §5.7). `clearMind` drops the
    // device copy and queues the server-side erase; this awaits one attempt at it so Wobo's line is
    // the truth. A queued erase that has not landed is retried on every mind pulse until it does —
    // and until then Wobo says so, because "I forgot you" while a server still remembers is a lie.
    run: async () => {
      clearMind();
      // The mind is not the only thing Wobo keeps. The placement check's record decides which
      // ground is never asked about again (including anything the learner waved through with "I
      // know this"), and the re-teach ladder's record decides which explanation comes next. Both
      // are things Wobo knows about this learner, so "forget everything" has to reach both, or the
      // sentence below is not true.
      clearPlacements();
      resetReteach();
      // MindObserver republishes the (now empty) dossier on its next pulse, so Wobo's very next turn
      // reasons from a blank slate — no stale context surviving the erase.
      const outcome = await eraseFromBrain();
      if (outcome === 'pending') {
        return 'Done on this device — everything I was keeping here is gone. I could not reach the part of me that remembers across your devices, so I am still holding that request and I will finish it the moment I can.';
      }
      return 'Done — I cleared what I remember about you, here and on my side. Your progress record is separate; Settings, your data, erases that too.';
    },
  },

  prepare_parent_note: {
    id: 'prepare_parent_note',
    // it communicates beyond the learner — always explicit approval (WOBO.md §4)
    rung: 'execute_with_permission',
    label: () => 'prepare the parent note',
    run: async ({ sdk }) => {
      const res = await sdk.llm.invoke(
        'generate.digest',
        { audience: 'parent', tone: 'pride_first' },
        { consentTier: 'un_elevated' },
      );
      const out = res.output as { summary?: unknown };
      const note =
        typeof out.summary === 'string' && out.summary
          ? out.summary
          : 'a short note leading with what went well this week.';
      return `here is what I prepared — ${note} nothing is sent until you share it yourself.`;
    },
  },
};

/**
 * The confirm card for a whole-memory wipe. Wobo says their line; this rides under it as the approval
 * card, so nothing is erased until the learner taps approve (or walks away and it stays offered).
 */
export function forgetAllOffer(offerId: string): ActionAttachment {
  return {
    capability: 'forget_all',
    params: {},
    why: 'You asked me to forget everything I know about you.',
    evidence: [
      'this clears your whole memory page — preferences, facts, the twin marks',
      'it cannot be undone, and I will not have it back',
    ],
    confidence: 'high',
    offerId,
    status: 'offered',
  };
}

export const CAPABILITY_IDS: ReadonlySet<string> = new Set(Object.keys(CAPABILITIES));

export function capabilityById(id: string): WoboCapability | undefined {
  return CAPABILITY_IDS.has(id) ? CAPABILITIES[id as CapabilityId] : undefined;
}

// --- The context packet on the wobo.turn seam (docs/WOBO-PLAN.md §1, §5.3) -----------------------

/**
 * The focus the learner made most recently — set by the gesture layer, read by the next turn. One
 * value, because a learner points at one thing at a time; cleared when they clear the focus.
 */
let currentFocus: FocusObject | null = null;

export function setTurnFocus(focus: FocusObject | null): void {
  currentFocus = focus;
}

export function turnFocus(): FocusObject | null {
  return currentFocus;
}

export interface TurnPacketOptions {
  /** Overrides the live focus, when a caller has one in hand. */
  focus?: FocusObject | null;
  /**
   * What the caller knows about where the learner is (the rung of the assistance ladder Wobo is
   * on). It is merged over what the screen itself reports (`taskFrom`); an explicit `null` sends no
   * task state at all.
   */
  task?: TaskState | null;
  /** Overrides the mind summary derived from the assembled context. */
  mind?: MindSummary | null;
  budget?: PacketBudget;
  registry?: SurfaceRegistry;
}

const isRecordValue = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * What this device knows about the learner that the assembled context does not carry: the world
 * they asked to be taught in, and the two facts only the brain can state — the plan they are on and
 * the consent tier it derived. The client never DECIDES the last two; it only repeats what
 * `GET /v1/me` said, so Wobo never offers past the door the brain opened.
 */
export interface LearnerFacts {
  analogy?: string | undefined;
  consentTier?: string | undefined;
  plan?: string | undefined;
}

/** The last answer `GET /v1/me` gave. Null until it has answered, and on a keyless build forever. */
let account: { plan?: string | null; consentTier?: string | null } | null = null;

/**
 * Record what the brain says this learner is on. App.tsx calls this once the answer lands; the
 * packet then carries it every turn (WOBO-PLAN §5.3). Passing null forgets it — a sign-out.
 */
export function noteAccount(
  me: { plan?: string | null; consentTier?: string | null } | null,
): void {
  account = me;
}

/** Everything about the learner that comes from the device and the account, not from the screen. */
export function learnerFacts(): LearnerFacts {
  return {
    analogy: preferredAnalogy(),
    ...(account?.consentTier ? { consentTier: account.consentTier } : {}),
    ...(account?.plan ? { plan: account.plan } : {}),
  };
}

/**
 * The learner's mind, digested from the context the bus already assembles — mastery band for the
 * topic in front of them, the mistakes worth having in mind, the world they want analogies drawn
 * from, and the plan and consent tier the brain derived. Nothing new is invented here; this only
 * chooses what is worth the tokens. `facts` is injectable so the digest can be held to its full
 * shape in a test without a device behind it.
 */
export function mindFrom(
  context: Partial<WoboAssembledContext>,
  facts: LearnerFacts = learnerFacts(),
): MindSummary | undefined {
  const summary: MindSummary = {};
  if (context.curriculum?.band) summary.band = context.curriculum.band;
  if (context.curriculum?.nodeName) summary.topic = context.curriculum.nodeName;
  const mistakes = (context.session?.recentEvents ?? []).filter((e) => e.includes('correct=false'));
  if (mistakes.length > 0) summary.mistakes = mistakes.slice(-3);
  if (facts.analogy) summary.analogy = facts.analogy;
  if (facts.consentTier) summary.consentTier = facts.consentTier;
  if (facts.plan) summary.plan = facts.plan;
  return Object.keys(summary).length > 0 ? summary : undefined;
}

const numberAt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Where the learner is in what they are doing: the beat of the lesson, the attempt they are on, the
 * score so far (WOBO-PLAN §5.3). It is read off the LIVE SCREEN — every registered target publishes
 * its own state, so this is the beat the learner can see rather than a number the app remembered.
 * A caller with something the screen cannot know (the rung of the assistance ladder Wobo is on)
 * passes it as `options.task` and it wins.
 */
export function taskFrom(context: Partial<WoboAssembledContext>): TaskState | undefined {
  const task: TaskState = {};
  for (const target of context.targets ?? []) {
    const state = target.scene?.state;
    if (!isRecordValue(state)) continue;
    const beat = numberAt(state.beat);
    const of = numberAt(state.of);
    if (beat !== undefined && task.beat === undefined) {
      task.beat = of === undefined ? String(beat) : `${beat} of ${of}`;
    }
    const attempt = numberAt(state.attempt) ?? numberAt(state.attempts);
    if (attempt !== undefined && task.attempt === undefined) task.attempt = attempt;
    const score = numberAt(state.score) ?? numberAt(state.correct);
    if (score !== undefined && task.score === undefined) task.score = score;
  }
  const mode = context.page?.state?.mode;
  if (typeof mode === 'string' && mode) task.mode = mode;
  return Object.keys(task).length > 0 ? task : undefined;
}

function turnsFrom(context: Partial<WoboAssembledContext>): PacketTurn[] {
  return (context.turn?.recentTurns ?? []).map((t) => ({
    role: t.role === 'wobo' ? ('wobo' as const) : ('learner' as const),
    text: t.text,
  }));
}

/**
 * Build the context packet for this turn: what the learner pointed at, what is on screen, where
 * they are, what they are doing, Wobo's mind's summary, and the last few turns — all under the token
 * budget, trimmed by priority (packages/wobo/src/packet.ts).
 */
export function buildTurnPacket(
  context: Partial<WoboAssembledContext>,
  options: TurnPacketOptions = {},
): ContextPacket {
  const registry = options.registry ?? surfaceRegistry;
  // The screen's own account of where the learner is, with whatever the caller knows on top of it.
  // Derived here rather than left to callers: a turn that forgets to say which beat it is on is a
  // turn the brain has to guess about, and every caller forgot.
  const task = options.task === null ? {} : { ...taskFrom(context), ...(options.task ?? {}) };
  return buildPacket({
    focus: options.focus === undefined ? currentFocus : options.focus,
    registrySnapshot: registry.snapshot({ route: context.page?.route }),
    route: context.page?.route,
    task: Object.keys(task).length > 0 ? task : null,
    mind: options.mind === undefined ? (mindFrom(context) ?? null) : options.mind,
    turns: turnsFrom(context),
    budget: options.budget,
  });
}

/**
 * The one shape every `wobo.turn` invocation sends. The packet rides at `context.packet`, beside
 * the fields the bus already assembles — nothing existing moves, so the gateway keeps reading what
 * it always read while the brain gains the screen, the focus and the budget.
 *
 *   sdk.llm.invoke('wobo.turn', woboTurnPayload(bus.assembleContext()), { consentTier })
 */
export function woboTurnPayload<T extends object>(
  context: T,
  options: TurnPacketOptions = {},
): { context: T & { packet: ContextPacket } } {
  const source = isRecordValue(context) ? (context as Partial<WoboAssembledContext>) : {};
  return { context: { ...context, packet: buildTurnPacket(source, options) } };
}

/**
 * The same envelope, typed for the streaming board turn (`board-turn.ts` → `board-stream.ts`).
 *
 * A board turn posts `{ payload: { ...this, board } }`, and the gateway reads the learner's words
 * out of `payload.context.turn.lastUserInput` twice: once for the inbound safety screen and once to
 * extract the drawing intents. Handing it the INSIDE of the envelope silently emptied both — the
 * turn was screened against nothing and planned nothing — so the envelope is built in one named
 * place that a test can hold to the gateway's reading.
 */
export function boardTurnPayload<T extends object>(
  context: T,
  options: TurnPacketOptions = {},
): Record<string, unknown> {
  return woboTurnPayload(context, options) as unknown as Record<string, unknown>;
}

/**
 * Where the gateway reads the learner's words out of a turn payload
 * (`services/gateway/src/wobo_gateway/safety.py::inbound_text` and
 * `wobo.py::mock_board_plan`). Exported so the seam is asserted, not assumed.
 */
export function inboundTextOf(payload: Record<string, unknown>): string {
  const context = isRecordValue(payload.context) ? payload.context : {};
  const turn = isRecordValue(context.turn) ? context.turn : {};
  return typeof turn.lastUserInput === 'string' ? turn.lastUserInput : '';
}
