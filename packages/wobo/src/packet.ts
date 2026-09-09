/**
 * The context packet — everything Wobo is given for one turn (docs/WOBO-PLAN.md §1, §5.3).
 *
 * Per turn: what the learner pointed at, what is on screen, where they are, what they are doing,
 * what Wobo's mind holds about them, and the last few turns — assembled here, on the client, and sent
 * up through the one seam (`wobo.turn`). The client holds no key, no model id and no limit; this
 * file only decides what is worth saying and what has to be left out.
 *
 * The budget is real (docs/BOARD.md §10: 6 KB in total). When the packet does not fit, the
 * conversation and the mind's digest are trimmed by a fixed priority ladder. Two things are never
 * trimmed here: the focus, because it is what the learner asked about, and the glass, because it
 * is already a choice (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze: at most sixty entries and about
 * two kilobytes, chosen by visibility and relevance, never a trimming ladder). Pure and
 * deterministic: same input, same bytes.
 */

import type { FocusObject } from './focus';
import { normaliseText } from './focus';
import type { GlassEntry, GlassMap, GlassViewport } from './glass/map';
import { byteLength } from './registry';

/** One line of the recent conversation. */
export interface PacketTurn {
  role: 'learner' | 'wobo';
  text: string;
}

/** Where the learner is in whatever they are doing right now. */
export interface TaskState {
  /** The beat of a course, a practice run, a boss battle. */
  beat?: string;
  attempt?: number;
  score?: number;
  /** The rung of the assistance ladder Wobo is on. */
  mode?: string;
  [key: string]: unknown;
}

/** The learner's mind, digested to what this turn needs (WOBO.md §7). */
export interface MindSummary {
  /** Mastery band for the topic in front of them. */
  band?: string;
  topic?: string;
  /** The mistakes worth having in mind, most recent last. */
  mistakes?: string[];
  /** The world Wobo explains in when they ask for their own language. */
  analogy?: string;
  /** Server-derived; carried so Wobo never offers past the door the brain opened. */
  consentTier?: string;
  plan?: string;
}

export interface PacketBudget {
  /** Total token ceiling for the packet. Default 1500 ≈ 6 KB at 4 characters a token. */
  maxTokens?: number;
  /** Characters per token for the estimate. Default 4. */
  charsPerToken?: number;
}

export interface PacketInput {
  focus?: FocusObject | null;
  /** The glass map, as the reader chose it. */
  glass?: GlassMap | null;
  route?: string;
  task?: TaskState | null;
  mind?: MindSummary | null;
  turns?: readonly PacketTurn[] | null;
  budget?: PacketBudget;
}

/** The focus as it rides in the packet — the same object, with the heavy parts optional. */
export interface PacketFocus {
  id: string;
  kind: FocusObject['kind'];
  /** Absent rather than empty when the gesture landed on no registered target. */
  targetIds?: string[];
  text: string;
  numbers?: number[];
  rect: FocusObject['rect'];
  surfaceId?: string;
  ownerState?: Record<string, unknown>;
  path?: FocusObject['path'];
}

export interface ContextPacket {
  v: 1;
  route?: string;
  focus?: PacketFocus;
  task?: TaskState;
  mind?: MindSummary;
  /** What is on the glass: every entry the reader chose, whole, id for id. */
  glass?: GlassEntry[];
  /** The glass's own size and state, so a box is read in the right frame. */
  viewport?: GlassViewport;
  turns?: PacketTurn[];
  /** Which sections were trimmed to fit — honest, so the brain knows what it is not seeing. */
  truncated?: string[];
  /** The estimated token cost of this packet, as sent. */
  tokens: number;
}

export const DEFAULT_MAX_TOKENS = 1500;
export const DEFAULT_CHARS_PER_TOKEN = 4;
/** The recent conversation never crowds out the glass: this many turns at most, newest last. */
export const MAX_TURNS = 6;
/** Below this the conversation is dropped rather than shaved further. */
const MIN_TURNS = 2;
/** Turn text is shaved to this before turns start being dropped wholesale. */
const TURN_TEXT_CLAMP = 160;

/** Rough token count of a serialised value — 4 characters a token, as the plan estimates. */
export function estimateTokens(value: unknown, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  const json = JSON.stringify(value) ?? '';
  return Math.ceil(byteLength(json) / Math.max(1, charsPerToken));
}

function compact<T extends object>(object: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
}

function toPacketFocus(focus: FocusObject): PacketFocus {
  return compact({
    id: focus.id,
    kind: focus.kind,
    targetIds: focus.targetIds,
    text: focus.text,
    numbers: focus.numbers,
    rect: roundRect(focus.rect),
    surfaceId: focus.surfaceId,
    ownerState: focus.ownerState,
    path: focus.path?.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  });
}

/** Sub-pixel precision is bytes with no meaning; whole pixels anchor just as well. */
function roundRect(rect: FocusObject['rect']): FocusObject['rect'] {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

interface Reduction {
  label: string;
  apply: (packet: ContextPacket) => boolean;
}

/**
 * The priority ladder, least valuable first. Each step returns true when it actually changed
 * something; the builder re-measures after every step and stops as soon as the packet fits.
 */
const LADDER: Reduction[] = [
  {
    label: 'turns',
    apply: (p) => {
      if (!p.turns || p.turns.length <= MIN_TURNS) return false;
      p.turns = p.turns.slice(1); // the oldest line goes first
      return true;
    },
  },
  {
    label: 'turns.text',
    apply: (p) => {
      if (!p.turns) return false;
      let changed = false;
      p.turns = p.turns.map((turn) => {
        const text = normaliseText(turn.text, TURN_TEXT_CLAMP);
        if (text !== turn.text) changed = true;
        return { role: turn.role, text };
      });
      return changed;
    },
  },
  {
    label: 'turns',
    apply: (p) => {
      if (!p.turns) return false;
      p.turns = undefined;
      return true;
    },
  },
  {
    label: 'mind.mistakes',
    apply: (p) => {
      const mistakes = p.mind?.mistakes;
      if (!p.mind || !mistakes || mistakes.length === 0) return false;
      // Oldest mistake goes first; the most recent one is the one Wobo is teaching against.
      p.mind = { ...p.mind, mistakes: mistakes.length > 1 ? mistakes.slice(1) : undefined };
      p.mind = compact(p.mind);
      return true;
    },
  },
  {
    label: 'mind.plan',
    apply: (p) => {
      if (!p.mind?.plan) return false;
      p.mind = compact({ ...p.mind, plan: undefined });
      return true;
    },
  },
  {
    label: 'mind.analogy',
    apply: (p) => {
      if (!p.mind?.analogy) return false;
      p.mind = compact({ ...p.mind, analogy: undefined });
      return true;
    },
  },
  {
    label: 'focus.path',
    apply: (p) => {
      if (!p.focus?.path) return false;
      p.focus = compact({ ...p.focus, path: undefined });
      return true;
    },
  },
  {
    label: 'focus.state',
    apply: (p) => {
      if (!p.focus?.ownerState) return false;
      p.focus = compact({ ...p.focus, ownerState: undefined });
      return true;
    },
  },
  {
    label: 'focus.text',
    apply: (p) => {
      if (!p.focus) return false;
      const text = normaliseText(p.focus.text, 200);
      if (text === p.focus.text) return false;
      p.focus = compact({ ...p.focus, text, numbers: p.focus.numbers?.slice(0, 8) });
      return true;
    },
  },
  {
    label: 'task',
    apply: (p) => {
      if (!p.task) return false;
      const { beat, attempt, score, mode } = p.task;
      const trimmed = compact({ beat, attempt, score, mode });
      if (JSON.stringify(trimmed) === JSON.stringify(p.task)) return false;
      p.task = Object.keys(trimmed).length > 0 ? trimmed : undefined;
      return true;
    },
  },
  {
    label: 'focus.text',
    apply: (p) => {
      if (!p.focus) return false;
      const text = normaliseText(p.focus.text, 80);
      if (text === p.focus.text) return false;
      p.focus = { ...p.focus, text };
      return true;
    },
  },
  {
    label: 'mind',
    apply: (p) => {
      if (!p.mind) return false;
      const floor = compact({ band: p.mind.band, consentTier: p.mind.consentTier });
      if (JSON.stringify(floor) === JSON.stringify(p.mind)) return false;
      p.mind = Object.keys(floor).length > 0 ? floor : undefined;
      return true;
    },
  },
];

/**
 * Build the packet for one turn, under the budget.
 *
 * Priority, highest first: the focus (what they pointed at) and the glass (what is in front of
 * them), which are never trimmed; then the task, the mind, the recent turns. `truncated` names
 * every section that lost something, in the order it happened, so the brain is never guessing
 * about what it cannot see.
 */
export function buildPacket(input: PacketInput): ContextPacket {
  const charsPerToken = input.budget?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const maxTokens = input.budget?.maxTokens ?? DEFAULT_MAX_TOKENS;

  const turns = input.turns ? input.turns.slice(-MAX_TURNS).map((t) => ({ ...t })) : undefined;
  const glass = input.glass && input.glass.entries.length > 0 ? input.glass : undefined;

  const packet: ContextPacket = compact({
    v: 1 as const,
    route: input.route,
    focus: input.focus ? toPacketFocus(input.focus) : undefined,
    task: input.task ? compact({ ...input.task }) : undefined,
    mind: input.mind ? compact({ ...input.mind }) : undefined,
    glass: glass ? glass.entries.map((e) => ({ ...e })) : undefined,
    viewport: glass ? { ...glass.viewport } : undefined,
    turns: turns && turns.length > 0 ? turns : undefined,
    tokens: 0,
  });

  const truncated: string[] = [];
  const fits = () => estimateTokens(packet, charsPerToken) <= maxTokens;
  const note = (label: string) => {
    if (truncated.includes(label)) return;
    truncated.push(label);
    // Assigned as we go, so `truncated`'s own bytes are counted by the very next fit check.
    packet.truncated = truncated;
  };
  for (const step of LADDER) {
    if (fits()) break;
    if (!step.apply(packet)) continue;
    note(step.label);
    // `turns` shaves one slice at a time; stay on this rung while it still helps.
    while (!fits() && step.label === 'turns' && step.apply(packet)) {
      // each pass drops one more slice
    }
  }

  // The token count is part of the packet, so settle it: two passes always converge.
  packet.tokens = estimateTokens(packet, charsPerToken);
  packet.tokens = estimateTokens(packet, charsPerToken);
  return packet;
}

/** True when the packet fits its budget — the assertion the tests and the turn path both make. */
export function packetFits(packet: ContextPacket, budget?: PacketBudget): boolean {
  const charsPerToken = budget?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  return estimateTokens(packet, charsPerToken) <= (budget?.maxTokens ?? DEFAULT_MAX_TOKENS);
}
