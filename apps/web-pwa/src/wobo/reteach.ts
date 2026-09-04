'use client';

/**
 * The re-teach ladder: what Wobo tries when an explanation does not land, without being asked.
 *
 * The product claim is "we keep using different methods, different styles, examples and whatever it
 * may be, to help them understand it the right way". Until this module existed the claim was false:
 * `learn.modality.switched.v1` carried a `repeated_miss` reason that nothing ever emitted, so the
 * only way a learner got a second explanation was to ask for one. This is the half that asks for
 * them.
 *
 * THE LADDER. Changing approach means changing an AXIS, never volume. Each rung below moves a
 * different dimension of the teaching, and the cheapest move comes first:
 *
 *   0. explain      the lesson's own first pass. Never chosen as a re-teach: it is the thing that
 *                   just failed, and repeating it louder is the one move a good tutor never makes.
 *   1. worked       METHOD. Concrete before abstract: one problem worked all the way through
 *                   before the rule is stated again. The smallest honest change from an
 *                   explanation, so it is tried first.
 *   2. draw         REPRESENTATION. The same idea as a picture on the board. A learner who cannot
 *                   parse a sentence can very often read a shape.
 *   3. their_world  EXAMPLE. An analogy built out of what the learner already told us they are
 *                   into. Skipped entirely when they have told us nothing: Wobo explains plainly
 *                   rather than inventing a world for them.
 *   4. talk         VOICE. Out loud, then teach it back. The protege effect is the strongest of
 *                   these and also the most expensive, which is why it is last.
 *
 * EVERY RUNG HERE LANDS SOMEWHERE THE LEARNER CAN SEE.
 *
 * There were three more: a simulator to move, a video to replay, a podcast to listen to. Nothing in
 * this product renders any of the three, so all three resolved to a paragraph of text that
 * described a thing that never arrived, and the video rung's own sentence ("show me ... as a short
 * animation") matched the show_me pattern in modes.ts and was diverted into the cursor-pointing
 * branch, which answers a request for an animation by gliding a pointer at a button. A ladder whose
 * rungs promise media the product cannot produce is one voice saying different sentences. They are
 * gone until something renders them, and the four that remain each land: prose and the board.
 *
 * NO RUNG EVER SWITCHES A MODALITY TO ITSELF. `learn.modality.switched.v1` is the evidence that
 * Wobo taught it a different way, so a switch from `worksheet` to `worksheet` is not evidence of
 * anything. The current representation is excluded from the candidates before one is chosen.
 *
 * When every rung has been tried for a concept the ladder does not stop and it does not repeat the
 * one that just failed: it returns to the LEAST recently tried rung with a different example, and
 * says so. Nothing here names a model, a provider or a limit. Each rung carries the sentence Wobo
 * is asked with, in the learner's own voice, so the call rides the routing that already exists.
 *
 * WHAT HAS BEEN TRIED SURVIVES A RELOAD. The tally and the tried-list are one record per concept,
 * persisted under the learner's own storage scope. They used to live in a module Map: the tally was
 * restored from durable mastery evidence at the top of a session and the tried-list was not, so a
 * learner who came back after failing the worked example was handed the worked example again.
 */

import type { Modality } from '@wobo/contracts';
import type { Sdk } from '@wobo/sdk';
import { currentScope, scoped } from '../store/scope';
import { modePrompt, type WoboModeId } from './modes';

/**
 * How many misses on one concept before Wobo changes approach on its own.
 *
 * Two, not one. A single wrong answer is as often a slipped thumb, a misread sign or a guess the
 * learner already knew was a guess as it is a misunderstanding, and a tutor who changes tack on
 * every one of those teaches nothing and feels frantic. Two wrong on the SAME concept is a
 * pattern, and a pattern is the moment to try another way. Not three: by the third the learner has
 * already decided this is a thing they are bad at.
 */
export const RETEACH_AFTER_MISSES = 2;

export type ApproachId = 'explain' | 'worked' | 'draw' | 'their_world' | 'talk';

/** The dimension a rung moves. Two rungs never move the same one. */
export type ReteachAxis = 'method' | 'representation' | 'example' | 'voice';

/** Why a switch happened, exactly as the contract enumerates it. */
export type SwitchReason = 'repeated_miss' | 'frustration' | 'request' | 'orchestrator';

export interface ReteachContext {
  /** What is being taught, in the words the learner sees. */
  topic: string;
  /**
   * The world the learner already knows, from what they told us (store/mind's `preferredAnalogy`).
   * Undefined when they have told us nothing, and the analogy rung is then skipped rather than
   * invented.
   */
  world?: string | undefined;
}

export interface ReteachApproach {
  id: ApproachId;
  axis: ReteachAxis;
  /** The representation this rung lands in; carried straight into learn.modality.switched.v1. */
  modality: Modality;
  /** The Wobo mode this rung reaches for, when one already says it. */
  mode?: WoboModeId;
  /** False when this rung needs something we do not have. */
  ready: (ctx: ReteachContext) => boolean;
  /** Wobo's one warm line, said as the switch happens. */
  line: (ctx: ReteachContext) => string;
  /** The sentence Wobo is asked with. The learner's voice, so nothing about routing changes. */
  ask: (ctx: ReteachContext) => string;
}

const always = () => true;

/** The ladder, in the order it is climbed. Index 0 is the pass that already failed. */
export const APPROACHES: readonly ReteachApproach[] = [
  {
    id: 'explain',
    axis: 'method',
    modality: 'opener',
    ready: always,
    line: () => 'here is the idea.',
    ask: (c) => `explain ${c.topic.toLowerCase()}`,
  },
  {
    id: 'worked',
    // Not `worksheet`: the workbook the learner is stuck on IS a worksheet, so a switch to one
    // would record no difference at all. A worked example is Wobo's own prose, read.
    axis: 'method',
    modality: 'reading',
    ready: always,
    line: () =>
      'let me show this a different way: I will work one all the way through, and then the next one is yours.',
    ask: (c) =>
      `work one ${c.topic.toLowerCase()} problem all the way through, one step at a time, before the rule.`,
  },
  {
    id: 'draw',
    axis: 'representation',
    modality: 'canvas',
    ready: always,
    line: () => 'let me draw this one instead, so you can see the shape of it rather than read it.',
    ask: (c) => `draw ${c.topic.toLowerCase()} on the board so I can see it.`,
  },
  {
    id: 'their_world',
    axis: 'example',
    modality: 'reading',
    mode: 'my_world',
    // Never invented: no stated interest means this rung is not offered at all.
    ready: (c) => Boolean(c.world?.trim()),
    line: (c) => `let me put this in ${c.world?.trim()}, where you already know how things behave.`,
    // The mind already carries the world into every turn, so the existing phrase is enough.
    ask: () => modePrompt('my_world'),
  },
  {
    id: 'talk',
    axis: 'voice',
    // A teach-back is a live exchange in Wobo's drawer, not a recording: `interactive`, not
    // `podcast`. Nothing in this product plays audio down this path.
    modality: 'interactive',
    mode: 'teach_back',
    ready: always,
    line: () => 'let us talk this one out loud, and then you say it back to me in your own words.',
    ask: () => modePrompt('teach_back'),
  },
];

/** Everything the ladder remembers about one concept for the length of this session. */
interface ConceptRecord {
  /** Misses since the last clean answer (or since the last switch). */
  misses: number;
  /** Approach ids in the order they were tried, oldest first. The failed pass is always in here. */
  tried: ApproachId[];
  /** Where the teaching currently stands, so the next switch reports an honest `from`. */
  modality?: Modality;
}

/**
 * WHERE THE LADDER'S MEMORY LIVES.
 *
 * Scoped to the learner (store/scope.ts), like every other personal store: a sibling on the same
 * tablet climbs their own ladder. The map below is a cache over it, read lazily on the first
 * question of a session and written back after every change.
 */
export const RETEACH_KEY = 'wobo-reteach-v1';

type StoredRecord = { misses?: number; tried?: ApproachId[]; modality?: Modality };

let concepts: Map<string, ConceptRecord> | null = null;
/** Which learner the cache above was read for. A sibling signing in gets their own ladder. */
let scopeAt: string | null = null;

const VALID: ReadonlySet<string> = new Set(APPROACHES.map((a) => a.id));

/** The durable record, read once per session. Unreadable or corrupt storage is an empty ladder. */
function all(): Map<string, ConceptRecord> {
  // A scope change (a sibling signs in, an anonymous session becomes an account) is a different
  // learner's ladder, so the cache is dropped rather than carried across.
  if (concepts && scopeAt !== currentScope()) concepts = null;
  if (concepts) return concepts;
  scopeAt = currentScope();
  const held = new Map<string, ConceptRecord>();
  try {
    const raw = scoped.getItem(RETEACH_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [id, value] of Object.entries(parsed as Record<string, StoredRecord>)) {
        if (!value || typeof value !== 'object') continue;
        const tried = Array.isArray(value.tried)
          ? value.tried.filter((a): a is ApproachId => typeof a === 'string' && VALID.has(a))
          : [];
        const misses =
          typeof value.misses === 'number' && Number.isFinite(value.misses)
            ? Math.max(0, Math.floor(value.misses))
            : 0;
        // A rung that no longer exists is dropped above; `explain` is re-seeded so the pass that
        // failed can never come back even from a record written by an older build.
        held.set(id, {
          misses,
          tried: tried.includes('explain') ? tried : ['explain', ...tried],
          ...(value.modality ? { modality: value.modality } : {}),
        });
      }
    }
  } catch {
    // unreadable storage is a ladder nobody has climbed, never a broken lesson
  }
  concepts = held;
  return held;
}

function persist(): void {
  const out: Record<string, StoredRecord> = {};
  for (const [id, entry] of all()) {
    out[id] = {
      misses: entry.misses,
      tried: entry.tried,
      ...(entry.modality ? { modality: entry.modality } : {}),
    };
  }
  scoped.setItem(RETEACH_KEY, JSON.stringify(out));
}

function record(conceptId: string): ConceptRecord {
  const held = all();
  let entry = held.get(conceptId);
  if (!entry) {
    // The lesson's own explanation counts as tried the moment we first see the concept, so the
    // ladder can never hand back the pass that just failed.
    entry = { misses: 0, tried: ['explain'] };
    held.set(conceptId, entry);
    persist();
  }
  return entry;
}

/**
 * One wrong answer on this concept. Returns the running count, so a caller that wants the number
 * without the switch can have it.
 */
export function noteConceptMiss(conceptId: string): number {
  const entry = record(conceptId);
  entry.misses += 1;
  persist();
  return entry.misses;
}

/**
 * A clean answer on this concept: the tally goes back to zero, because a correct answer is the
 * evidence that the way we are teaching it landed. Callers that grade a SET should call this only
 * when the whole set came back clean, or one right answer would erase two wrong ones.
 */
export function noteConceptCorrect(conceptId: string): void {
  const entry = all().get(conceptId);
  if (!entry || entry.misses === 0) return;
  entry.misses = 0;
  persist();
}

/**
 * Prior misses carried in from somewhere durable. The tutor deliberately keeps no table of its
 * own: whoever owns persistence (mastery evidence, the learner's mind) hands the count in here at
 * the top of a session and the ladder picks up where it left off.
 */
export function seedConceptMisses(conceptId: string, misses: number): void {
  if (!Number.isFinite(misses) || misses <= 0) return;
  record(conceptId).misses = Math.floor(misses);
  persist();
}

/** One durable answer, in the shape the mastery cache keeps it. Only the verdict is read here. */
export interface EvidencePoint {
  correct: boolean;
}

/**
 * Pick the tally up where the last session dropped it.
 *
 * The tutor keeps no durable table of its own: mastery already persists per-node evidence, oldest
 * first, so the run of wrong answers since the last right one IS the miss count this concept
 * carries. A learner who closed the tab on two misses comes back to a tutor that already knows to
 * teach it another way. Ignored once this session has an opinion of its own about the concept, so a
 * re-mount mid-lesson can never reset a tally that is already counting.
 */
export function seedFromEvidence(conceptId: string, evidence: readonly EvidencePoint[]): number {
  // A durable record already knows both the tally and what has been tried, and it is the truer of
  // the two: its tally counts misses SINCE the last switch, where the evidence tail cannot.
  if (all().has(conceptId)) return conceptMisses(conceptId);
  let run = 0;
  for (let i = evidence.length - 1; i >= 0 && evidence[i]?.correct === false; i--) run += 1;
  if (run > 0) seedConceptMisses(conceptId, run);
  return run;
}

/** Misses standing against this concept right now. */
export function conceptMisses(conceptId: string): number {
  return all().get(conceptId)?.misses ?? 0;
}

/** What has already been tried for this concept, oldest first. */
export function triedApproaches(conceptId: string): readonly ApproachId[] {
  return all().get(conceptId)?.tried ?? [];
}

/** Tests, and a learner who asked to be forgotten: the durable record goes with the session's. */
export function resetReteach(): void {
  concepts = new Map();
  scopeAt = currentScope();
  scoped.removeItem(RETEACH_KEY);
}

/**
 * A RELOAD, in one call: the session's cache is dropped and the durable record is left alone, so
 * the next question re-reads it from storage. This is what the app does implicitly when the tab is
 * closed and opened again, and what a test does explicitly to prove that it survives.
 */
export function dropReteachMemory(): void {
  concepts = null;
}

export interface ApproachChoice {
  approach: ReteachApproach;
  /** True when every rung has been tried and this one returns with a different example. */
  fresh: boolean;
}

/**
 * The next thing to try for this concept: the first rung not yet used, or, when they have all been
 * used, the one used longest ago with a new example. Never the pass that just failed. Null only
 * when nothing on the ladder is available, which cannot happen while any rung is unconditional.
 */
export function chooseApproach(
  conceptId: string,
  ctx: ReteachContext,
  /** Where the teaching stands now. A rung that lands back in it is not a change of approach. */
  from?: Modality,
): ApproachChoice | null {
  const entry = record(conceptId);
  const ready = APPROACHES.filter((a) => a.id !== 'explain' && a.ready(ctx));
  // Never a switch to the representation already on screen: the event that says Wobo taught it
  // another way has to be able to show the difference.
  const candidates = from ? ready.filter((a) => a.modality !== from) : ready;
  if (candidates.length === 0) return null;
  const untried = candidates.find((a) => !entry.tried.includes(a.id));
  if (untried) return { approach: untried, fresh: false };
  // All tried: the one whose last outing is furthest back, so the failure just now is never it.
  let oldest = candidates[0] as ReteachApproach;
  let oldestAt = entry.tried.lastIndexOf(oldest.id);
  for (const a of candidates.slice(1)) {
    const at = entry.tried.lastIndexOf(a.id);
    if (at < oldestAt) {
      oldest = a;
      oldestAt = at;
    }
  }
  return { approach: oldest, fresh: true };
}

export interface ReteachTurn {
  approach: ReteachApproach;
  /** Wobo's one warm line, said as the switch happens. */
  line: string;
  /** The sentence Wobo is asked with, so the model call rides the routing that exists. */
  ask: string;
  from: Modality;
  to: Modality;
  reason: SwitchReason;
  /** Misses that stood against the concept when the switch fired. */
  misses: number;
  fresh: boolean;
}

export interface ReteachOptions {
  /** The ontology node the concept belongs to; the event's `node_id`. */
  nodeId: string;
  /** What is being re-taught. One tally and one tried-list per concept. */
  conceptId: string;
  /** Where the teaching stands now. Ignored once the ladder has moved this concept itself. */
  from: Modality;
  context: ReteachContext;
}

/**
 * Switch approach now, whatever the tally says: the learner asked, or something upstream read
 * frustration. Records learn.modality.switched.v1 and returns the turn to say and to ask with.
 */
export function reteachNow(
  sdk: Sdk,
  opts: ReteachOptions,
  reason: SwitchReason = 'request',
): ReteachTurn | null {
  const entry = record(opts.conceptId);
  const from = entry.modality ?? opts.from;
  const choice = chooseApproach(opts.conceptId, opts.context, from);
  if (!choice) return null;

  const to = choice.approach.modality;
  const misses = entry.misses;

  // The switch happened; the tally starts again so the next one needs its own pattern behind it,
  // and the rung goes to the back of the tried list so the ladder keeps moving.
  entry.misses = 0;
  entry.tried = [...entry.tried.filter((id) => id !== choice.approach.id), choice.approach.id];
  entry.modality = to;
  persist();

  const base = choice.approach.line(opts.context);
  const line = choice.fresh
    ? `we have tried a few ways, so let me come back to this one with a different example. ${base}`
    : base;

  try {
    sdk.events.record(
      'learn.modality.switched.v1',
      { node_id: opts.nodeId, from, to, reason },
      { ontologyNodeId: opts.nodeId },
    );
  } catch {
    // A node id the contract will not accept (a free-text course that has no ontology node yet)
    // must never cost the learner the second explanation. The evidence is lost, the teaching is not.
  }

  return {
    approach: choice.approach,
    line,
    ask: choice.approach.ask(opts.context),
    from,
    to,
    reason,
    misses,
    fresh: choice.fresh,
  };
}

/**
 * One wrong answer on this concept, and the ladder decides. Below the threshold nothing happens and
 * null comes back: the lesson carries on exactly as it did. At the threshold Wobo changes approach
 * on its own and hands back the line to say and the sentence to ask with.
 */
export function reteachOnMiss(sdk: Sdk, opts: ReteachOptions): ReteachTurn | null {
  const misses = noteConceptMiss(opts.conceptId);
  if (misses < RETEACH_AFTER_MISSES) return null;
  return reteachNow(sdk, opts, 'repeated_miss');
}
