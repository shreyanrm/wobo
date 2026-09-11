'use client';

/**
 * The placement check: a short look at the ground under a topic, before the topic is taught.
 *
 * The owner's promise is "every main topic which has prerequisites will be tested to see their
 * past learning levels ... to bring them up to pace so that they can learn the actual topics of
 * their grade better". This is that check, and three rules shape it.
 *
 *   It is fast. At most three questions (MAX_PLACEMENT_QUESTIONS), one per piece of unmet ground,
 *   and past learning is asked about before the lesson immediately behind this one: an edge the
 *   graph drew from another chapter is what "past" means, a printed order inside this chapter is
 *   not. A check that feels like an exam is a check nobody finishes.
 *
 *   It is honest. A question is only ever a real item with a verifier-frozen answer, or the
 *   learner's own word about their own past. Nothing here writes a question, because a question
 *   this client invented would be a syllabus fact this client invented.
 *
 *   It is skippable, and the skip is not a trapdoor. "I know this" claims the question on screen
 *   and nothing else; "I know all of this" is offered separately, labelled with how many it covers;
 *   "not now" settles nothing at all. A claim is recorded as a claim (evidence: 'claimed') rather
 *   than argued with, so the tutor knows the ground is asserted and not checked, and the learner is
 *   not asked it again. Not asked again is only safe because it is REVERSIBLE: `forgetPlacement`
 *   takes one claim back, `clearPlacements` takes them all, Wobo's "forget everything" capability
 *   calls it, and sign-out carries the key off the device with the rest of the learner's world.
 *   Before that, one tap deleted up to three prerequisites from the learner's picture for good.
 *
 * The output is a GroundReport, not a score: which prerequisites are unmet, how far under they
 * sit, and how we know. That is the shape a teacher can act on, and it is what the tutor gets
 * through the seam at the bottom of this file.
 */

import type { MasteryBand } from '@wobo/contracts';
import { newId, type PayloadOf } from '@wobo/contracts';
import type { PracticeItem } from '@wobo/sdk';
import type { Topic } from '../data/model';
import { scoped } from '../store/scope';
import { addOntologyPrereqs, type PrereqReason } from './prereq';
import { type GroundStep, groundBeneath, loadedTopics } from './registry';

type DiagnosticPayload = PayloadOf<'onboarding.diagnostic.answered.v1'>;

// --- what the check produces ----------------------------------------------------------------------

/** How a band was arrived at. The tutor reads this before it decides how much to trust the band. */
export type PlacementEvidence = 'checked' | 'self_reported' | 'claimed';

/** How far under the floor a piece of ground sits. A word, not a number: a teacher reads words. */
export type GroundGap = 'wide' | 'shaky' | 'thin';

/** What one placement established about one prerequisite. Persisted, so it is asked once only. */
export interface PlacementRecord {
  prereqId: string;
  band: MasteryBand;
  evidence: PlacementEvidence;
  /** ISO-8601 UTC, the moment it was established. */
  at: string;
}

/** One piece of ground under a topic, as the tutor receives it. */
export interface GroundPiece {
  topicId: string;
  name: string;
  /** The canonical concept the brain mapped this topic onto, when it mapped one. */
  conceptId?: string;
  /** Why the graph put this under the topic (curriculum/prereq.ts). */
  reason: PrereqReason;
  /** 1 for ground directly under the topic, 2 for the ground under that. */
  depth: number;
  band: MasteryBand;
  evidence: PlacementEvidence;
  /** Present on unmet ground only: how much of it is missing. */
  gap?: GroundGap;
}

/**
 * The handoff. Everything the tutor needs to teach a topic to a learner who is not yet standing
 * on all of it, and nothing it does not: no score, no percentage, no ranking.
 */
export interface GroundReport {
  topicId: string;
  topicName: string;
  /** Ground the lesson has to carry, nearest first. This is the list to teach over. */
  unmet: GroundPiece[];
  /** Ground the check found solid. This is what a bridge is allowed to stand on. */
  solid: GroundPiece[];
  /** Ground the learner claimed without a check. Real, and to be treated as thinner than solid. */
  claimed: GroundPiece[];
  /** ISO-8601 UTC. */
  at: string;
}

// --- the questions --------------------------------------------------------------------------------

/** The three replies to "how is this ground". No fourth: a longer list is a form, not a check. */
export interface PlacementOption {
  id: 'solid' | 'rusty' | 'new';
  label: string;
  band: MasteryBand;
}

export const SELF_OPTIONS: readonly PlacementOption[] = [
  { id: 'solid', label: 'I can do this', band: 'secure' },
  { id: 'rusty', label: "I've seen it, but it's rusty", band: 'developing' },
  { id: 'new', label: 'This is new to me', band: 'not_started' },
];

export interface PlacementQuestion {
  /** Minted per serve. This is the event's `item_id`. */
  id: string;
  prereqId: string;
  prereqName: string;
  /** The canonical concept the brain mapped the prerequisite onto, when it mapped one. */
  conceptId?: string;
  reason: PrereqReason;
  depth: number;
  /** The line the learner reads. */
  prompt: string;
  /** `item` carries a verifier-frozen answer; `self` asks the learner about their own past. */
  kind: 'item' | 'self';
  /** `item` only: the problem itself, as the content plane froze it. */
  equation?: string;
  /** `item` only: the verifier-established answer. Never shown before a reply. */
  answer?: string;
  /** `self` only. */
  options?: readonly PlacementOption[];
}

export interface PlacementPlan {
  topicId: string;
  topicName: string;
  questions: PlacementQuestion[];
}

/** A check, not an exam. */
export const MAX_PLACEMENT_QUESTIONS = 3;

/**
 * Where the check gets its material. Every field is optional and every one of them degrades to
 * "ask the learner" rather than to an error, so the check works offline, keyless, and on a board
 * whose content plane has nothing frozen for it yet.
 */
export interface PlacementSources {
  /** Verifier-frozen practice items for a concept node (sdk.content.getPracticeItems). */
  items?: (nodeId: string) => Promise<PracticeItem[]>;
  /** The platform's own confirmed prerequisites (sdk.kgtopg.ontology.getPrerequisites). */
  ontology?: (nodeId: string) => Promise<readonly { name: string }[]>;
  /** Every topic in memory, as candidates for an ontology name match. Defaults to the registry. */
  loaded?: () => Topic[];
  /**
   * The ARCHITECT's own statement of what this topic assumes: `groundUnder(blueprint, topicId)`
   * from `curriculum/blueprint.ts`, when a blueprint exists for the chapter.
   *
   * It wins over everything below it and is labelled `blueprint` rather than laundered into a
   * derived reason, because it is a different kind of claim. The graph in `curriculum/prereq.ts`
   * is this client reading the board's printed order; this is the architect saying, in so many
   * words, that the chapter leans on this and the board does not re-teach it, and putting a
   * prerequisite module in the pool for it. What the learner answers here is what pulls that
   * module into their group (`unmetAssumptions`), which is the whole point of asking.
   */
  assumptions?: (topic: Topic) => readonly PlacementAssumption[];
}

/** One thing the chapter assumes, as the blueprint declares it. */
export interface PlacementAssumption {
  id: string;
  what: string;
  fromChapter?: string | null;
}

/**
 * How an assumption is named among the placements. Prefixed so it can never collide with a topic
 * id, and so `unmetAssumptions` can pick its own rows back out of the one persisted store.
 */
export const ASSUMPTION_PREFIX = 'assume:';

/** Cross-chapter ground is "past learning"; the lesson printed just before this one is not. */
const PAST_LEARNING: ReadonlySet<PrereqReason> = new Set<PrereqReason>([
  'blueprint',
  'ontology',
  'editorial',
  'name',
]);

function rank(step: GroundStep): number {
  return (PAST_LEARNING.has(step.reason) ? 0 : 100) + step.depth;
}

/**
 * Build the check for a topic, or null when there is nothing to check: no unmet ground, or ground
 * that has already been placed once. A learner is never asked the same placement twice.
 */
export async function planPlacement(
  topic: Topic,
  completed: ReadonlySet<string>,
  sources: PlacementSources = {},
): Promise<PlacementPlan | null> {
  // THE ARCHITECT FIRST. A blueprint states what the chapter assumes; nothing this client derives
  // can outrank that, so when there is one it IS the check. It is still capped at three questions,
  // and an assumption already settled is never asked twice.
  const placedAlready = load();
  const declared = (sources.assumptions?.(topic) ?? []).filter(
    (a) => a.id && !placedAlready[ASSUMPTION_PREFIX + a.id],
  );
  if (declared.length > 0) {
    return {
      topicId: topic.id,
      topicName: topic.name,
      questions: declared.slice(0, MAX_PLACEMENT_QUESTIONS).map((a) => assumptionQuestion(topic, a)),
    };
  }

  // The platform's own edges first, when this topic reaches a concept the platform knows. Anything
  // it names that this learner's syllabus does not contain is dropped, never invented.
  if (topic.nodeId && sources.ontology) {
    try {
      const named = await sources.ontology(topic.nodeId);
      if (named.length > 0) addOntologyPrereqs(topic, named, (sources.loaded ?? loadedTopics)());
    } catch {
      // The platform is unreachable. The derived graph still stands; the check is just narrower.
    }
  }

  const placed = load();
  const ground = groundBeneath(topic, completed).filter((s) => !placed[s.topic.id]);
  if (ground.length === 0) return null;

  const chosen = [...ground].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_PLACEMENT_QUESTIONS);
  const questions: PlacementQuestion[] = [];
  for (const step of chosen) questions.push(await question(step, sources));
  return { topicId: topic.id, topicName: topic.name, questions };
}

/**
 * One question about one declared assumption.
 *
 * It is a `self` question and it can be nothing else: an assumption is a piece of past learning
 * named in words ("area of a rectangle"), not a syllabus node with a verifier-frozen item behind
 * it. Writing a question for it here would be inventing a syllabus fact, which is the one thing
 * this module never does. The learner's own word about their own past is the honest instrument,
 * and `fromChapter` is said out loud so they are placing a real memory and not a phrase.
 */
function assumptionQuestion(topic: Topic, assumption: PlacementAssumption): PlacementQuestion {
  const where = assumption.fromChapter ? ` (${assumption.fromChapter})` : '';
  return {
    id: newId(),
    prereqId: ASSUMPTION_PREFIX + assumption.id,
    prereqName: assumption.what,
    reason: 'blueprint',
    depth: 1,
    prompt: `Before ${topic.name.toLowerCase()}: how is ${assumption.what}${where} for you?`,
    kind: 'self',
    options: SELF_OPTIONS,
  };
}

/**
 * The assumption ids this learner has not shown, for `LearnerState.unmetAssumptions`.
 *
 * This is the loop closing: the check asked what the architect said the chapter leans on, and this
 * hands the answer straight to `groupFor`, which pulls the matching prerequisite module into their
 * group. A claim ("I know this") is not a gap, exactly as everywhere else in this module: it is
 * recorded as a claim and taken at its word until something says otherwise.
 */
export function unmetAssumptions(): string[] {
  return Object.values(load())
    .filter((r) => r.prereqId.startsWith(ASSUMPTION_PREFIX) && gapFor(r.band) !== undefined)
    .map((r) => r.prereqId.slice(ASSUMPTION_PREFIX.length));
}

async function question(step: GroundStep, sources: PlacementSources): Promise<PlacementQuestion> {
  const base = {
    id: newId(),
    prereqId: step.topic.id,
    prereqName: step.topic.name,
    reason: step.reason,
    depth: step.depth,
    ...(step.topic.nodeId ? { conceptId: step.topic.nodeId } : {}),
  };
  const nodeId = step.topic.nodeId;
  if (nodeId && sources.items) {
    try {
      const items = await sources.items(nodeId);
      // The easiest frozen item: a placement asks whether the floor holds, not how high they climb.
      const easiest = [...items].sort((a, b) => a.difficulty - b.difficulty)[0];
      if (easiest) {
        return {
          ...base,
          kind: 'item',
          prompt: `Before ${step.topic.name.toLowerCase()}: find x.`,
          equation: easiest.equation,
          answer: easiest.answer,
        };
      }
    } catch {
      // No frozen item to serve. The learner's own word is the honest fallback, below.
    }
  }
  return {
    ...base,
    kind: 'self',
    prompt: `How is ${step.topic.name.toLowerCase()} for you?`,
    options: SELF_OPTIONS,
  };
}

// --- grading --------------------------------------------------------------------------------------

export interface PlacementAnswer {
  question: PlacementQuestion;
  /** What the learner typed (an item) or which option they tapped (a self report). */
  value: string;
  latencyMs: number;
  /** True when this answer came from "I know this" rather than from the question. */
  claimed?: boolean;
}

export interface PlacementGrade {
  band: MasteryBand;
  correct: boolean;
  evidence: PlacementEvidence;
}

const flat = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, '');

/**
 * One answer, read as a band.
 *
 * A checked item that comes back right is `secure`: a prior, not a verdict, and the strongest one
 * a single question can support. Nothing here ever returns `independent`, which is earned over
 * time and cannot be established by a check. `correct` on a self report means the learner said the
 * ground is solid, because a self report has no right answer to be wrong about.
 */
export function gradePlacement(answer: PlacementAnswer): PlacementGrade {
  const { question: q, value } = answer;
  // "I know this" walks past whatever the question was, including a frozen item it never saw.
  if (answer.claimed) return { band: 'secure', correct: true, evidence: 'claimed' };
  if (q.kind === 'item') {
    const correct = flat(value) !== '' && flat(value) === flat(q.answer ?? '');
    return { band: correct ? 'secure' : 'emerging', correct, evidence: 'checked' };
  }
  const option = (q.options ?? SELF_OPTIONS).find((o) => o.id === value) ?? SELF_OPTIONS[0];
  const band = option?.band ?? 'secure';
  return {
    band,
    correct: band === 'secure',
    evidence: answer.claimed ? 'claimed' : 'self_reported',
  };
}

/** The band, as a word about the ground. `secure` and above is not a gap at all. */
export function gapFor(band: MasteryBand): GroundGap | undefined {
  if (band === 'not_started') return 'wide';
  if (band === 'emerging') return 'shaky';
  if (band === 'developing') return 'thin';
  return undefined;
}

// --- persistence ----------------------------------------------------------------------------------

/** Scoped per learner: a sibling on the same tablet is placed on their own past, not this one's. */
export const PLACEMENT_KEY = 'wobo-placement-v1';

type Placements = Record<string, PlacementRecord>;

function load(): Placements {
  try {
    const raw = scoped.getItem(PLACEMENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Placements = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const row = value as Partial<PlacementRecord>;
      if (typeof row?.band !== 'string' || typeof row.at !== 'string') continue;
      out[id] = {
        prereqId: id,
        band: row.band as MasteryBand,
        evidence: (row.evidence as PlacementEvidence) ?? 'self_reported',
        at: row.at,
      };
    }
    return out;
  } catch {
    return {}; // unreadable storage is no placement history, never a half-built one
  }
}

function save(next: Placements): void {
  scoped.setItem(PLACEMENT_KEY, JSON.stringify(next));
}

/** What a past check established about one prerequisite, or undefined if it was never asked. */
export function placementOf(prereqId: string): PlacementRecord | undefined {
  return load()[prereqId];
}

/** Every placement this learner has on this device. */
export function placements(): PlacementRecord[] {
  return Object.values(load());
}

/**
 * Take back what a check established about ONE piece of ground, so it is asked about again.
 *
 * "I know this" is a claim, and a child claims things. Without this, one tap deleted a prerequisite
 * from the learner's picture permanently: `planPlacement` filters placed ground out of every future
 * check, so the question could never come round again and nothing in the product could put it back.
 * A claim has to be takeable back, and this is how.
 */
export function forgetPlacement(prereqId: string): void {
  const store = load();
  if (!(prereqId in store)) return;
  delete store[prereqId];
  save(store);
}

/**
 * Forget every placement. Wobo's "forget everything" capability reaches this (wobo/capabilities.ts),
 * and sign-out takes the key with the rest of the learner's world (store/scope.ts SCOPED_KEYS).
 */
export function clearPlacements(): void {
  scoped.removeItem(PLACEMENT_KEY);
  reports.clear();
}

// --- the event ------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id this topic can be named by on the contract, or null.
 *
 * `onboarding.diagnostic.answered.v1` takes a UUID node id. A board's syllabus node IS one
 * (curriculum.nodes.id), and a node the learner added themselves is `own:<uuid>`, so both can be
 * named. A concept id is a slug and cannot, which is why the concept travels in the ground report
 * and not in the event.
 */
export function eventNodeId(topic: { id: string }): string | null {
  if (UUID.test(topic.id)) return topic.id;
  const own = topic.id.startsWith('own:') ? topic.id.slice('own:'.length) : '';
  return UUID.test(own) ? own : null;
}

/** The one method of `sdk.events` this module uses. Injected, so the check is testable offline. */
export interface PlacementEvents {
  record(
    eventType: 'onboarding.diagnostic.answered.v1',
    payload: DiagnosticPayload,
    context?: { ontologyNodeId?: string; courseId?: string },
  ): unknown;
}

/** The payload for one answered check question, or null when the node cannot be named on contract. */
export function diagnosticPayload(
  answer: PlacementAnswer,
  grade: PlacementGrade,
  nodeId: string,
): DiagnosticPayload {
  const q = answer.question;
  return {
    item_id: q.id,
    node_id: nodeId,
    response: answer.claimed
      ? { kind: 'choice', selected: ['i_know_this'] }
      : q.kind === 'item'
        ? { kind: 'text', text: answer.value }
        : { kind: 'choice', selected: [answer.value] },
    correct: grade.correct,
    latency_ms: Math.max(0, Math.round(answer.latencyMs)),
    placement_band: grade.band,
  };
}

// --- the handoff ----------------------------------------------------------------------------------

const reports = new Map<string, GroundReport>();
const listeners = new Set<(report: GroundReport) => void>();

/**
 * THE SEAM. The tutor reads the ground through this, and never through the placement screen.
 *
 * `groundFor` is the last report settled for a topic in this session; `subscribeGround` fires the
 * moment a check settles, so a tutor already on screen learns what the floor turned out to be.
 * Nothing in this module composes a lesson: shaping a bridge out of this report is the tutor's
 * job (wobo/tutor.ts), and this module deliberately does not call it.
 */
export function groundFor(topicId: string): GroundReport | null {
  return reports.get(topicId) ?? null;
}

export function subscribeGround(listener: (report: GroundReport) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function pieceOf(question: PlacementQuestion, record: PlacementRecord): GroundPiece {
  const piece: GroundPiece = {
    topicId: question.prereqId,
    name: question.prereqName,
    reason: question.reason,
    depth: question.depth,
    band: record.band,
    evidence: record.evidence,
  };
  if (question.conceptId) piece.conceptId = question.conceptId;
  const gap = gapFor(record.band);
  if (gap) piece.gap = gap;
  return piece;
}

export interface SettleOptions {
  /** Where the diagnostic events go. Omitted (a test, a keyless build) means nothing is emitted. */
  events?: PlacementEvents;
}

/**
 * Settle a check: grade every answer, persist each band so it is never asked again, emit one
 * `onboarding.diagnostic.answered.v1` per answer, and publish the ground report to the tutor.
 *
 * A question whose node cannot be named on the contract (a personal node with no UUID inside it)
 * is still persisted and still reaches the tutor; only the upstream event is skipped, because an
 * event carrying an invented node id is worse than no event.
 */
export function settlePlacement(
  plan: PlacementPlan,
  answers: readonly PlacementAnswer[],
  options: SettleOptions = {},
): GroundReport {
  const at = new Date().toISOString();
  const store = load();
  const report: GroundReport = {
    topicId: plan.topicId,
    topicName: plan.topicName,
    unmet: [],
    solid: [],
    claimed: [],
    at,
  };

  for (const answer of answers) {
    const grade = gradePlacement(answer);
    const record: PlacementRecord = {
      prereqId: answer.question.prereqId,
      band: grade.band,
      evidence: grade.evidence,
      at,
    };
    store[record.prereqId] = record;

    const nodeId = eventNodeId({ id: record.prereqId });
    if (nodeId && options.events) {
      try {
        options.events.record(
          'onboarding.diagnostic.answered.v1',
          diagnosticPayload(answer, grade, nodeId),
          { ontologyNodeId: nodeId },
        );
      } catch {
        // Telemetry never blocks a learner. The band is already persisted above.
      }
    }

    const piece = pieceOf(answer.question, record);
    if (record.evidence === 'claimed') report.claimed.push(piece);
    else if (piece.gap) report.unmet.push(piece);
    else report.solid.push(piece);
  }

  save(store);
  // Deepest first: the ground furthest under the topic is the ground a teacher lays first.
  report.unmet.sort((a, b) => b.depth - a.depth);
  reports.set(plan.topicId, report);
  for (const listener of listeners) listener(report);
  return report;
}

export interface SkipOptions extends SettleOptions {
  /** Questions the learner already answered. They are settled exactly as they were answered. */
  answered?: readonly PlacementAnswer[];
  /** The first question the claim covers. Everything before it is in `answered`. */
  from?: number;
  latencyMs?: number;
}

/**
 * "I know this." Every question from `from` onward is settled as a claim: band `secure`, evidence
 * `claimed`, recorded rather than argued with, and never asked again.
 *
 * The screen used to build this list inline, which is how the two drifted: the module's version had
 * no way to keep the answers already given, so the screen wrote its own and this one was dead code.
 * `answered` and `from` are what the screen actually needs, so there is one implementation again.
 */
export function skipPlacement(plan: PlacementPlan, options: SkipOptions = {}): GroundReport {
  const { answered = [], from = 0, latencyMs = 0, ...settle } = options;
  const claims = plan.questions.slice(Math.max(0, from)).map((question) => ({
    question,
    value: 'solid',
    latencyMs,
    claimed: true,
  }));
  return settlePlacement(plan, [...answered, ...claims], settle);
}
