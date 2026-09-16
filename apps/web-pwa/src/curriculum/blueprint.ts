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
 * Five lists of ids. No name, no age, no score, nothing that identifies a person: the group is a
 * selection over the pool's own declarations, which is exactly why choosing costs nothing and why
 * it can happen on the device with no call to the brain.
 *
 * Four of them say what the learner KNOWS. The fifth, `stuckOn`, says what just HAPPENED to them,
 * and it is the one that makes the group a re-choice rather than a plan made once at the door
 * (docs/LEARNING-MODEL.md, "The tutor never leaves", rule 1).
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
  /**
   * Module ids this learner has missed enough times for it to be a pattern rather than a slip.
   *
   * Two, not one, and the count is not kept here: `wobo/reteach.ts` already keeps the durable
   * per-concept tally the whole product uses (`conceptMisses`, `RETEACH_AFTER_MISSES`), and a
   * second tally in the curriculum layer would be a second place for the two to disagree about
   * whether a learner is struggling. This list is that tally's answer, read at the moment the
   * group is chosen.
   *
   * It is what "right, wrong, how wrong, how slow" reduces to for a SELECTION: the planner does
   * not need the answers, it needs to know which module stopped working. Still only ids, so the
   * property that makes this whole file free is untouched.
   */
  stuckOn?: readonly string[];
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
 * How far DOWN a module sits, so that "never a harder one" is a number this file can honour rather
 * than a sentence in a document (docs/LEARNING-MODEL.md, "The tutor never leaves", rule 1).
 *
 * A prerequisite lays the ground under the chapter; a repair goes under one idea; a way in teaches
 * it; a check asks for it back; a stretch goes past it; the boss asks for the whole chapter at
 * once. A learner who has just failed something is only ever moved sideways or further down this
 * list, never up it.
 */
const DEPTH: Record<ModuleRole, number> = {
  prerequisite: 0,
  repair: 1,
  way_in: 2,
  side_door: 2,
  check: 3,
  stretch: 4,
  boss: 5,
};

/**
 * The way out of a module that has stopped working for this learner, out of the pool and nowhere
 * else. Four roads, tried in the order a tutor beside them would try them, and the first one the
 * pool can actually supply is the one taken:
 *
 *   the architect's own   `flow.stuck` is the route they wrote for exactly this module, knowing
 *                         what it assumes and what it was for. Nothing on the client knows better.
 *   another way in        the same idea by a different road, which is the whole reason the pool
 *                         is required to hold at least two of them (docs/LEARNING-MODEL.md 5).
 *   under the idea        the repair. *"A module exists for each misconception a topic can
 *                         produce, and it enters a learner's group only when they show it"*, and a
 *                         learner who has now failed this idea by every road the pool holds has
 *                         shown it in the only other way a learner can.
 *   under the chapter     the prerequisite. Two failed ways in is the evidence a placement check
 *                         would have gathered, arriving late rather than never.
 *
 * Nothing is invented and nothing outside the pool is reached for, so whatever is offered is one
 * somebody designed to teach exactly this. A pool that can supply none of the four has not met
 * section 5 of the model, and that is a judgeable fault in the pool rather than a licence here.
 */
function routeOutOf(
  bp: Blueprint,
  topicId: string,
  from: BlueprintModule,
  usable: (m: BlueprintModule | undefined) => boolean,
): BlueprintModule | undefined {
  const said = bp.modules.find((m) => m.id === insteadOf(bp, from.id));
  if (usable(said)) return said;

  const here = bp.modules
    .filter((m) => m.serves.includes(topicId) && m.role !== 'side_door' && m.role !== 'boss')
    .sort((a, b) => positionOf(bp, a.id) - positionOf(bp, b.id));
  const sharesAnIdea = (m: BlueprintModule) => m.teaches.some((i) => from.teaches.includes(i));

  return (
    here.find((m) => m.role === 'way_in' && sharesAnIdea(m) && usable(m)) ??
    here.find((m) => m.role === 'repair' && sharesAnIdea(m) && usable(m)) ??
    here.find((m) => m.role === 'prerequisite' && usable(m))
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
 *
 * AND THEN IT IS RE-CHOSEN AGAINST WHAT JUST HAPPENED. `state.stuckOn` names the modules that have
 * stopped working for this learner; each one is taken out and the pool's own way out of it is put
 * in its place (`routeOutOf`). That is what makes this a thing to call after every module rather
 * than once at the door: two learners who opened the same topic on the same morning are on
 * different roads by the third card, and neither is ever handed back the module they just failed.
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

  // THE RE-CHOICE. Everything above reads what the learner KNOWS, and not one of those four lists
  // can change by doing a module and failing it. A group chosen from them alone hands back the
  // module that just failed, for as long as the learner keeps failing it, because a module nobody
  // finished is not finished: that is the shape of *"the module after my fourth wrong answer was
  // the same next card in the same fixed list"*, and it is what this step exists to end.
  const stuck = new Set(state.stuckOn ?? []);
  if (stuck.size > 0) {
    // The shallowest module the pool could not route this learner out of. Nothing harder than that
    // is offered while they are still standing on it: asking for an idea back is not a way to
    // teach it, and a check handed to a learner who cannot get in is the product testing what it
    // has just failed to teach.
    let floor = Number.POSITIVE_INFINITY;
    for (const m of [...chosen.values()]) {
      if (!stuck.has(m.id)) continue;
      chosen.delete(m.id);
      const route = routeOutOf(
        bp,
        topicId,
        m,
        (c): boolean =>
          !!c &&
          c.id !== m.id &&
          !stuck.has(c.id) &&
          !chosen.has(c.id) &&
          c.role !== 'side_door' &&
          c.role !== 'boss' &&
          DEPTH[c.role] <= DEPTH[m.role],
      );
      if (route) take(route);
      else floor = Math.min(floor, DEPTH[m.role]);
    }
    for (const m of [...chosen.values()]) if (DEPTH[m.role] > floor) chosen.delete(m.id);
  }

  return [...chosen.values()].sort((a, b) => positionOf(bp, a.id) - positionOf(bp, b.id));
}

/** The group as ids: what the course for this syllabus cell is built from, in order. */
export function blueprintWalk(bp: Blueprint, topicId: string, state: LearnerState = {}): string[] {
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
