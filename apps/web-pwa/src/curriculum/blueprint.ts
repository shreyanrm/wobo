/**
 * THE BLUEPRINT, ON THE CLIENT — the architect's design for a chapter, and the seam that turns it
 * into the course a learner actually walks.
 *
 * The model (docs/LEARNING-MODEL.md, which supersedes the flatter reading in
 * docs/CONTENT-INTERACTION.md section 9):
 *
 *     subject
 *       chapter                      from the board's own syllabus
 *         topic                      from the board's own syllabus: WHAT must be learned
 *         module ── module ── module  the chapter's pool: HOW it is taught
 *
 * Chapters and topics are the board's and are never invented here. MODULES are ours, they live in
 * the CHAPTER'S pool rather than inside a topic, and a GROUP of modules teaches a topic. A module
 * may serve several topics, which is exactly why it sits at the chapter: sign conventions serve
 * linear equations and quadratics both, and drawn once it counts for both.
 *
 * WHAT THIS FILE REPLACES. A syllabus cell used to be split mechanically: one topic, one composed
 * course, the same shape for every learner. The course is now built from the blueprint's own
 * modules, and `groupFor` is where the adaptation lives. It is a SELECTION out of a pool that
 * already exists, so it costs nothing: no model call, no network, no generation. That is what makes
 * "it does not stop until the topic is yours" affordable at five rupees a day.
 *
 * THREE RULES THIS FILE KEEPS.
 *   1. Nothing is invented. An unknown topic is an empty group, not a guessed one; an assumption
 *      the blueprint never declared is not ground; a blueprint that does not look like one is not
 *      used at all (`isBlueprint`).
 *   2. The boss belongs to the CHAPTER, not to a topic: it is the only thing that tests across
 *      topics, so it never appears inside one topic's group.
 *   3. A side door is optional and never in the path. It is offered off the climb (`sideDoorsAfter`)
 *      and can never be selected into a group.
 *
 * The shapes below mirror the gateway's strict Pydantic contract
 * (services/gateway/src/wobo_gateway/plexus/blueprint_spec.py) and the JSON Schema it emits at
 * packages/contracts/schemas/blueprint.schema.json. `blueprint-contract.test.ts` fails if the two
 * part company.
 */

// --- the contract ---------------------------------------------------------------------------------

/** The interaction primitives a mechanic composes. A composition, never code. */
export type BlueprintPrimitive =
  | 'tap'
  | 'drag'
  | 'slide'
  | 'drop'
  | 'sort'
  | 'match'
  | 'sequence'
  | 'branch'
  | 'mark'
  | 'timer'
  | 'score'
  | 'reveal';

/** What a module IS. */
export type ModuleKind = 'reading' | 'worked' | 'simulation' | 'film' | 'items' | 'game' | 'boss';

/**
 * What a module is FOR. This is the half of the pool a selection can read without opening any
 * content, which is precisely what makes choosing a group free.
 */
export type ModuleRole =
  | 'way_in'
  | 'check'
  | 'repair'
  | 'stretch'
  | 'prerequisite'
  | 'side_door'
  | 'boss';

export interface MechanicCandidate {
  id: string;
  name: string;
  primitives: readonly BlueprintPrimitive[];
  /** What the learner moves. */
  moves: string;
  /** What responds. */
  responds: string;
  /** What a wrong move teaches about the IDEA. Never about the game. */
  wrongMoveTeaches: string;
}

export interface BlueprintTopic {
  id: string;
  name: string;
}

export interface BlueprintIdea {
  id: string;
  what: string;
  topics: string[];
}

export interface BlueprintMisconception {
  id: string;
  what: string;
  topics: string[];
}

export interface BlueprintAssumption {
  id: string;
  what: string;
  fromChapter?: string | null;
}

export interface BlueprintModule {
  id: string;
  aim: string;
  kind: ModuleKind;
  role: ModuleRole;
  /** Topic ids this module can teach. The map that lets one module serve several topics. */
  serves: string[];
  /** Idea ids it carries. */
  teaches: string[];
  /** The concept cores `create.core` makes for it. */
  cores: string[];
  /** The misconception id it repairs, when repairing is what it is for. */
  repairs?: string | null;
  /** Assumption ids it leans on. */
  assumes: string[];
  minutes: number;
  /** Two or three, so the mechanic can rotate without paying for a new design. */
  mechanics: MechanicCandidate[];
}

export interface BlueprintSideDoor {
  after: string;
  module: string;
  rehearses: string;
}

export interface BlueprintStuckRoute {
  module: string;
  instead: string;
  why: string;
}

export interface BlueprintFlow {
  order: string[];
  why: string;
  sideDoors: BlueprintSideDoor[];
  boss: string;
  bossProves: string;
  skippable: string[];
  neverSkip: string[];
  stuck: BlueprintStuckRoute[];
}

export interface Blueprint {
  node: string;
  chapter: string;
  board: string;
  grade: string;
  subject: string;
  contentVersion: string;
  /** The one idea the chapter is really about, in a sentence a learner of that class would say. */
  thread: string;
  topics: BlueprintTopic[];
  ideas: BlueprintIdea[];
  misconceptions: BlueprintMisconception[];
  assumptions: BlueprintAssumption[];
  modules: BlueprintModule[];
  flow: BlueprintFlow;
}

/**
 * Is this really a blueprint? A wire object that is not one is not partially used: the caller falls
 * back to the mechanical split, which is what shipped before this file existed. The check is
 * structural rather than exhaustive on purpose — the gateway's schema is the gate, and a second
 * full validator here would only be a second place for the two to disagree.
 */
export function isBlueprint(value: unknown): value is Blueprint {
  if (typeof value !== 'object' || value === null) return false;
  const bp = value as Partial<Blueprint>;
  return (
    typeof bp.chapter === 'string' &&
    bp.chapter.length > 0 &&
    typeof bp.thread === 'string' &&
    Array.isArray(bp.topics) &&
    Array.isArray(bp.ideas) &&
    Array.isArray(bp.modules) &&
    bp.modules.length > 0 &&
    typeof bp.flow === 'object' &&
    bp.flow !== null &&
    Array.isArray(bp.flow.order) &&
    bp.flow.order.length > 0
  );
}

// --- the learner's side of the selection ------------------------------------------------------------

/**
 * Everything the planner reads to choose a group, and nothing else.
 *
 * Four lists of ids. No name, no age, no score, nothing that identifies a person: the group is a
 * selection over the pool's own declarations, which is exactly why choosing costs nothing and why
 * it can happen on the device with no call to the brain.
 */
export interface LearnerState {
  /** Assumption ids the learner has not shown. A placement check is where these come from. */
  unmetAssumptions?: readonly string[];
  /** Misconception ids the learner has actually shown. Never a guess. */
  misconceptions?: readonly string[];
  /** Idea ids the learner already holds. */
  heldIdeas?: readonly string[];
  /** Module kinds that have landed for this learner before, best first. */
  style?: readonly ModuleKind[];
}

function moduleOf(bp: Blueprint, id: string): BlueprintModule | undefined {
  return bp.modules.find((m) => m.id === id);
}

function positionOf(bp: Blueprint, id: string): number {
  const at = bp.flow.order.indexOf(id);
  return at === -1 ? bp.flow.order.length : at;
}

/** The ideas a topic is held by, minus the ones this learner already holds. */
function ideasStillNeeded(bp: Blueprint, topicId: string, state: LearnerState): Set<string> {
  const held = new Set(state.heldIdeas ?? []);
  return new Set(
    bp.ideas.filter((i) => i.topics.includes(topicId) && !held.has(i.id)).map((i) => i.id),
  );
}

/**
 * THE GROUP: the modules that teach ONE topic to ONE learner, in the flow's own order.
 *
 * A selection, never a generation. In order of what it puts in:
 *
 *   the prerequisite   a learner who has not shown the ground gets the module that lays it, and it
 *                      comes first because everything after it leans on it
 *   the way in         one per idea they do not hold yet, preferring the kind that has landed for
 *                      them before. The pool holds at least two ways into every idea, and this is
 *                      where "it adapts to your way of thinking" stops being a claim
 *   the repair         one per misconception they have actually SHOWN. Never shown to anyone else:
 *                      a repair for a mistake nobody made teaches a mistake
 *   the check          the evidence the topic is held. Skipped entirely for a learner who already
 *                      holds every idea, because a check only confirms
 *   the stretch        for exactly that learner, so the fast one is never idle
 *
 * The boss is the chapter's and never a topic's. A side door is never in a group, because it is
 * never in the path.
 */
export function groupFor(
  bp: Blueprint,
  topicId: string,
  state: LearnerState = {},
): BlueprintModule[] {
  const here = bp.modules.filter(
    (m) => m.serves.includes(topicId) && m.role !== 'side_door' && m.role !== 'boss',
  );
  const needed = ideasStillNeeded(bp, topicId, state);
  const holdsItAll = needed.size === 0;
  const unmet = new Set(state.unmetAssumptions ?? []);
  const shown = new Set(state.misconceptions ?? []);
  const style = state.style ?? [];
  const chosen = new Map<string, BlueprintModule>();
  const take = (m: BlueprintModule) => chosen.set(m.id, m);

  for (const m of here) {
    if (m.role === 'prerequisite' && m.assumes.some((a) => unmet.has(a))) take(m);
  }

  const styleRank = (m: BlueprintModule): number => {
    const at = style.indexOf(m.kind);
    return at === -1 ? style.length + 1 : at;
  };
  for (const ideaId of [...needed].sort()) {
    const ways = here.filter((m) => m.role === 'way_in' && m.teaches.includes(ideaId));
    if (ways.length === 0) continue;
    const best = [...ways].sort(
      (a, b) => styleRank(a) - styleRank(b) || positionOf(bp, a.id) - positionOf(bp, b.id),
    )[0];
    if (best) take(best);
  }

  for (const m of here) {
    if (m.role === 'repair' && m.repairs && shown.has(m.repairs)) take(m);
  }

  for (const m of here) {
    if (holdsItAll ? m.role === 'stretch' : m.role === 'check') take(m);
  }

  return [...chosen.values()].sort((a, b) => positionOf(bp, a.id) - positionOf(bp, b.id));
}

/** The group as ids: what the course for this syllabus cell is built from, in order. */
export function blueprintWalk(
  bp: Blueprint,
  topicId: string,
  state: LearnerState = {},
): string[] {
  return groupFor(bp, topicId, state).map((m) => m.id);
}

/**
 * How far along this learner's own walk they are, 0..1.
 *
 * Along THEIR group, not along the pool: two learners may reach the same mastered topic with four
 * modules and eleven, and neither bar should read as though the other one's road were the real
 * one. A module finished that is not in their group does not move it.
 */
export function progressAlong(
  bp: Blueprint,
  topicId: string,
  state: LearnerState,
  done: ReadonlySet<string>,
): number {
  const walk = blueprintWalk(bp, topicId, state);
  if (walk.length === 0) return 0;
  return walk.filter((id) => done.has(id)).length / walk.length;
}

/**
 * Is the topic held?
 *
 * "A topic declares what must be true for it to be held: the ideas that must be understood, and the
 * misconceptions that must be gone. Not a module count, and never a score."
 * (docs/LEARNING-MODEL.md section 3.) So this reads the evidence and never the walk.
 */
export function masteryOf(bp: Blueprint, topicId: string, state: LearnerState): boolean {
  const ideas = bp.ideas.filter((i) => i.topics.includes(topicId));
  if (ideas.length === 0) return false;
  const held = new Set(state.heldIdeas ?? []);
  if (!ideas.every((i) => held.has(i.id))) return false;
  const shown = new Set(state.misconceptions ?? []);
  return !bp.misconceptions.some((m) => m.topics.includes(topicId) && shown.has(m.id));
}

/** The bonus levels that open after a module. Off the path, optional, never a nag. */
export function sideDoorsAfter(bp: Blueprint, moduleId: string): string[] {
  return bp.flow.sideDoors.filter((d) => d.after === moduleId).map((d) => d.module);
}

/** What a stuck learner is shown INSTEAD of this module, or null when the architect said nothing. */
export function insteadOf(bp: Blueprint, moduleId: string): string | null {
  return bp.flow.stuck.find((s) => s.module === moduleId)?.instead ?? null;
}

/**
 * What a topic leans on, as the architect stated it.
 *
 * This is a stronger claim than the graph `curriculum/prereq.ts` derives from a printed order: the
 * architect said, in so many words, that this chapter assumes it and the board does not re-teach
 * it. The placement check reads it through `PlacementSources.assumptions`, which is why a
 * blueprint-backed check asks about the right ground rather than about whatever came before on the
 * page. An assumption a module names but the blueprint never declared is dropped, never guessed.
 */
export function groundUnder(bp: Blueprint, topicId: string): BlueprintAssumption[] {
  const wanted: string[] = [];
  for (const m of bp.modules) {
    if (!m.serves.includes(topicId)) continue;
    for (const a of m.assumes) if (!wanted.includes(a)) wanted.push(a);
  }
  const out: BlueprintAssumption[] = [];
  for (const id of wanted) {
    const found = bp.assumptions.find((a) => a.id === id);
    if (!found) continue;
    out.push(
      found.fromChapter
        ? { id: found.id, what: found.what, fromChapter: found.fromChapter }
        : { id: found.id, what: found.what },
    );
  }
  return out;
}

/** The module a level id names, or undefined. Nothing downstream guesses a missing one. */
export function moduleById(bp: Blueprint, moduleId: string): BlueprintModule | undefined {
  return moduleOf(bp, moduleId);
}

/**
 * The mechanic to render for a module today.
 *
 * The architect stored two or three candidates so the ninety-day rotation of
 * docs/CONTENT-INTERACTION.md section 3 is a pick out of what already exists rather than a second
 * bill on the create tier. `pick` is whatever the caller rotates on (a stored index, the chapter's
 * recent interactions); out of range wraps, so a rotation can only ever land on a real candidate.
 */
export function mechanicFor(m: BlueprintModule, pick = 0): MechanicCandidate | undefined {
  if (m.mechanics.length === 0) return undefined;
  const at = ((pick % m.mechanics.length) + m.mechanics.length) % m.mechanics.length;
  return m.mechanics[at];
}
