/**
 * THE CLIMB, DERIVED — one chapter as a map, built out of state that already exists.
 *
 * The owner's brief: "fully gamified learning experience like checkpoints, treassure chests or
 * whatever, boss levels and so on ... not too childish obviously, we keep it professional for kids
 * who dont want all that; experience remains the same but the UI changes ... same content, same
 * approach, but vibe depending on their interests."
 *
 * So this module answers ONE question: where does every topic of this chapter stand, in words, for
 * a map to draw. It is the same answer the chapter rows already give (`units.ts`), asked one level
 * down. The vibe never reaches this file: `ui/viewPref.ts` is the whole surface a look is allowed
 * to act through, and it can rewrite exactly two labels. Nothing here can be hidden, reordered or
 * renamed by a costume.
 *
 * EVERY FIELD BELOW COMES FROM SOMEWHERE REAL. Nothing on the map is a constant and nothing is a
 * fixture:
 *
 *   learnt / debt      `screens/learn/mastery.ts` — completion AND the mastery band together. A
 *                      chapter finished badly is not learnt, and a topic whose band fell back below
 *                      the floor is a DEBT, which is what draws the return arc.
 *   where you are      `chooseNextTopic`, the same law the board and the platform both run.
 *   the ground         `curriculum/registry.ts` `unmetPrereqs`, over the graph
 *                      `curriculum/prereq.ts` derives and labels. When a placement check has
 *                      actually settled for a topic (`curriculum/placement.ts` `groundFor`), THAT
 *                      is used instead and the panel says the check ran, because a check that ran
 *                      is a different claim from a syllabus's own order.
 *   ways tried         `wobo/reteach.ts` `triedApproaches` — how many different ways Wobo has
 *                      already explained this concept. Absent for a topic the brain never mapped
 *                      onto a concept, and then the line simply is not said.
 *
 * WHAT IS NOT HERE, AND WHY. There is no chapter test in this product: no module scores a chapter,
 * no event records one, and no screen runs one. So the node at the end of the climb is drawn from
 * the only thing that IS true about the end of a chapter — whether every topic in it is learnt —
 * and it promises no exam, no percentage and no stars. It is a marker, not a door.
 */

import { groundFor } from '../../curriculum/placement';
import { unmetPrereqs } from '../../curriculum/registry';
import type { Chapter, Topic } from '../../data/model';
import { triedApproaches } from '../../wobo/reteach';
import { chooseNextTopic, isDebt, isLearnt, type MasteryView, NO_MASTERY } from './mastery';

/**
 * What a node is, structurally. The vibe changes what a reward and the end of the chapter are
 * CALLED and what they are drawn as; it cannot change which of these a node is.
 */
export type ClimbKind = 'topic' | 'reward' | 'gate';

/**
 * Where a node stands. One state per node, and each one carries its own sentence, because colour
 * is never allowed to be the only thing saying it.
 */
export type ClimbState =
  /** Completed, and the evidence keeps it at or above the floor. */
  | 'learnt'
  /** The one the learner is on: the chooser's answer inside this chapter. */
  | 'now'
  /** Completed once, then the band fell back below the floor. It comes back around. */
  | 'debt'
  /** Not reached yet. */
  | 'ahead'
  /**
   * Not completed, never begun, and it sits BEFORE where the learner is standing. The class may
   * well have done it; Wobo has no record either way, and saying "not started" would be a claim
   * this product cannot make (the same silence `units.ts` calls a `past` chapter).
   */
  | 'unknown';

/** One piece of ground under a topic, as a chip on the bridge. */
export interface ClimbGround {
  topicId: string;
  name: string;
}

/** The bridge panel: what is under a topic that the learner is not standing on yet. */
export interface ClimbBridge {
  /**
   * True when a placement check actually settled for this topic. False means the ground is this
   * client's own reading of the board's order, and the panel says so rather than claiming a check.
   */
  checked: boolean;
  ground: ClimbGround[];
}

export interface ClimbNode {
  /** Stable across renders: the topic's own id, or the chapter's for the node at the end. */
  key: string;
  kind: ClimbKind;
  /** 1-based position on the spine. */
  index: number;
  /** Which side of the spine it hangs off above 640px. Below it, every node is on one rail. */
  side: 'l' | 'r';
  /** The topic's own name, in the syllabus's own words. The vibe never touches it. */
  name: string;
  state: ClimbState;
  /** The course this node opens, or null for the marker at the end. */
  topicId: string | null;
  /** True only when the mastery state says a completed topic slipped. Draws the return arc. */
  slipped: boolean;
  /** How many ways Wobo has already explained this one. 0 when the ladder holds no record. */
  ways: number;
  /** The ground under this one, when it is not under the learner yet. */
  bridge: ClimbBridge | null;
  /** The gate only: how many topics of this chapter are still owed work. */
  owed: number;
}

export interface ClimbMap {
  chapterId: string;
  chapterIndex: number;
  chapterName: string;
  nodes: ClimbNode[];
  /** Topics behind them: completed AND at or above the floor. */
  learnt: number;
  /** Topics that slipped back below the floor. */
  debts: number;
  /** Distinct prerequisites still to lay under the topics of this chapter. */
  ground: number;
  /** 0..1 — how far up the spine the learner stands. Drives the spine's fill, nothing else. */
  reached: number;
  /** How many topics this chapter holds. 0 when they have not been loaded yet. */
  topics: number;
  /** Every topic of the chapter learnt. */
  cleared: boolean;
}

/**
 * The three readers the map needs from outside the learn flow. Each defaults to the real module;
 * they are parameters so the derivation can be tested without a registry, a storage or a session.
 */
export interface ClimbSources {
  /** Prerequisites not yet behind the learner. Defaults to the registry's derived graph. */
  groundOf?: (topic: Topic, completed: ReadonlySet<string>) => readonly ClimbGround[];
  /**
   * What a settled placement check found under this topic, or null when none has run. A settled
   * check outranks the derived graph in both directions: it can add a bridge, and it can take one
   * away by having found the ground solid.
   */
  checkOf?: (topicId: string) => ClimbBridge | null;
  /** How many ways this one has been explained. Defaults to the re-teach ladder's own record. */
  waysOf?: (topic: Topic) => number;
}

export interface ClimbInput extends MasteryView, ClimbSources {
  /** Fraction walked into each topic, from the progress store. */
  topicProgress?: Record<string, number>;
  /** The course open right now, if any: a learner mid-lesson is never sent somewhere else. */
  inFlightTopicId?: string | null;
  /** The platform's own next-best node, when the governed view has one (`mastery.ts`). */
  platformNodeId?: string | null;
}

const chip = (t: Topic): ClimbGround => ({ topicId: t.id, name: t.name });

/** The registry's derived graph, in the shape a chip is drawn from. */
function registryGround(topic: Topic, completed: ReadonlySet<string>): ClimbGround[] {
  return unmetPrereqs(topic, completed).map(chip);
}

/**
 * The placement seam (`curriculum/placement.ts`). A report with nothing unmet is not "no answer":
 * it is the check saying the ground is solid, so it returns a bridge with no chips, which the
 * caller reads as "draw nothing here".
 */
function settledCheck(topicId: string): ClimbBridge | null {
  const report = groundFor(topicId);
  if (!report) return null;
  return { checked: true, ground: report.unmet.map((p) => ({ topicId: p.topicId, name: p.name })) };
}

/** The re-teach ladder's record for the concept this topic teaches, when the brain mapped one. */
function ladderWays(topic: Topic): number {
  return topic.nodeId ? triedApproaches(topic.nodeId).length : 0;
}

/**
 * THE REWARD NODE — the chest on the drawing, and the one node on the climb the syllabus did not
 * put there.
 *
 * It used to be `bonus` or `mystery` alone, and both of those kinds were unreachable: nothing in
 * this product has ever produced a topic of either kind, so the chest could not appear on any real
 * chapter and `RewardMark`, the `.cl-chest` rules and their vibe rules were all dead. `custom` is
 * the kind that IS real — `curriculum/registry.ts` `topicOf` reads it off the wire's `own` flag,
 * which the brain sets on any node the learner added to their own syllabus themselves — and it is
 * exactly what a reward on this map means: a stop that is theirs rather than the board's. The node
 * still carries the topic's own name, its own state and its own door; only the title above it is
 * the vibe's word, and the line beneath says in plain words where it came from.
 */
function kindOf(topic: Topic): ClimbKind {
  return topic.kind === 'bonus' || topic.kind === 'mystery' || topic.kind === 'custom'
    ? 'reward'
    : 'topic';
}

/**
 * The chapter, as a map.
 *
 * A chapter whose topics have not been loaded produces an empty map rather than an invented one:
 * `topics` is 0, `nodes` is empty, and the screen says it is fetching them. There is no seeded
 * climb anywhere in this product.
 */
export function buildClimb(chapter: Chapter, input: ClimbInput): ClimbMap {
  const view: MasteryView = { completed: input.completed, bandOf: input.bandOf ?? NO_MASTERY };
  const groundOf = input.groundOf ?? registryGround;
  const checkOf = input.checkOf ?? settledCheck;
  const waysOf = input.waysOf ?? ladderWays;
  const progress = input.topicProgress ?? {};
  const list = chapter.topics;

  const empty: ClimbMap = {
    chapterId: chapter.id,
    chapterIndex: chapter.index,
    chapterName: chapter.name,
    nodes: [],
    learnt: 0,
    debts: 0,
    ground: 0,
    reached: 0,
    topics: 0,
    cleared: false,
  };
  if (list.length === 0) return empty;

  // The same law, scoped to this chapter: the topic this learner should be on inside it. Asked once
  // and painted around, never re-decided per node.
  const ask = (from: readonly Topic[]) =>
    chooseNextTopic(from, {
      ...view,
      inFlightTopicId: input.inFlightTopicId ?? null,
      platformNodeId: input.platformNodeId ?? null,
    });

  /**
   * WHERE THE LEARNER IS STANDING, WHICH IS NOT THE SAME QUESTION AS WHAT COMES BACK AROUND.
   *
   * A debt is a topic already learnt whose evidence fell back below the floor, and the chooser
   * offers it first — correctly, because that is the next thing to work on. But `stateOf` answers
   * `debt` before it answers `now`, so asking one question and painting both jobs off it left the
   * map with a rose node and NO pointer at all for as long as any debt was outstanding: pig, the
   * one colour whose whole job is "you are here", was unreachable on a real chapter.
   *
   * The drawing (design/prototypes/app-climb.html) shows both at once — node 3 owed, node 7 where
   * you are — so the map asks twice: once over everything, and, when that answer is a debt, again
   * over the topics that are not debts. The rose node still says it comes back around, and the pig
   * node still says where the climb has reached.
   */
  const owedFirst = ask(list);
  const here =
    owedFirst && isDebt(owedFirst, view) ? ask(list.filter((t) => !isDebt(t, view))) : owedFirst;
  const nowAt = here ? list.findIndex((t) => t.id === here.id) : -1;

  // The ground still to lay under this chapter, counted once per prerequisite however many topics
  // rest on it: two topics waiting on the same idea is one thing to teach, not two.
  const owedGround = new Set<string>();
  for (const topic of list) {
    if (isLearnt(topic, view)) continue;
    const settled = checkOf(topic.id);
    for (const g of settled ? settled.ground : groundOf(topic, view.completed)) {
      owedGround.add(g.topicId);
    }
  }

  const stateOf = (topic: Topic, at: number): ClimbState => {
    if (isDebt(topic, view)) return 'debt';
    if (isLearnt(topic, view)) return 'learnt';
    if (at === nowAt) return 'now';
    const begun = (progress[topic.id] ?? 0) > 0;
    return !begun && nowAt >= 0 && at < nowAt ? 'unknown' : 'ahead';
  };

  const nodes: ClimbNode[] = list.map((topic, at) => {
    const state = stateOf(topic, at);
    return {
      key: topic.id,
      kind: kindOf(topic),
      index: at + 1,
      side: at % 2 === 0 ? 'l' : 'r',
      name: topic.name,
      state,
      topicId: topic.id,
      slipped: state === 'debt',
      ways: state === 'now' || state === 'debt' ? waysOf(topic) : 0,
      bridge: null,
      owed: 0,
    };
  });

  /**
   * THE BRIDGE IS DRAWN WHERE THE LEARNER IS ABOUT TO STAND: the node in hand, and the next node
   * whose ground is not under it yet. Not every locked node with a prerequisite — a panel under a
   * topic six stops away is a wall of advice about a week that has not happened, and the ground
   * under it will have moved by the time they reach it.
   */
  const bridgeAt = (at: number): ClimbBridge | null => {
    const topic = list[at];
    const node = nodes[at];
    if (!topic || !node || node.state === 'learnt') return null;
    const settled = checkOf(topic.id);
    if (settled) return settled.ground.length > 0 ? settled : null;
    const derived = groundOf(topic, view.completed);
    return derived.length > 0 ? { checked: false, ground: [...derived] } : null;
  };
  const spots: number[] = [];
  if (nowAt >= 0) spots.push(nowAt);
  for (let at = Math.max(nowAt, -1) + 1; at < list.length; at++) {
    const bridge = bridgeAt(at);
    if (bridge) {
      spots.push(at);
      break;
    }
  }
  for (const at of spots) {
    const node = nodes[at];
    if (node) node.bridge = bridgeAt(at);
  }

  const learnt = nodes.filter((n) => n.state === 'learnt').length;
  const debts = nodes.filter((n) => n.state === 'debt').length;
  const cleared = learnt === list.length;

  // The node at the end of the chapter. Not a test: this product runs none. It reports the one
  // thing that is true about the end of a chapter, and it opens nothing.
  nodes.push({
    key: `${chapter.id}:end`,
    kind: 'gate',
    index: nodes.length + 1,
    side: nodes.length % 2 === 0 ? 'l' : 'r',
    name: chapter.name,
    state: cleared ? 'learnt' : 'ahead',
    topicId: null,
    slipped: false,
    ways: 0,
    bridge: null,
    owed: list.length - learnt,
  });

  // How far up the spine they stand. The node in hand when there is one, else how much is behind
  // them. Never past the top.
  const walked = nowAt >= 0 ? nowAt + 0.5 : learnt;
  const reached = Math.max(0, Math.min(1, walked / nodes.length));

  return {
    ...empty,
    nodes,
    learnt,
    debts,
    ground: owedGround.size,
    reached,
    topics: list.length,
    cleared,
  };
}

// --- the words -------------------------------------------------------------------------------

/**
 * WHAT A NODE SAYS ABOUT ITSELF.
 *
 * One sentence per state, in one voice. These do NOT change with the vibe: `ui/viewPref.ts` may
 * rewrite the reward's label and the label on the node at the end of the chapter, and nothing
 * else. A learner who switches look reads the same status about the same topic.
 */
export const CLIMB_STATUS: Readonly<Record<ClimbState, string>> = {
  learnt: 'Learnt',
  now: 'You are here',
  debt: 'Learnt once, then it slipped. It comes back around.',
  ahead: 'Not reached yet',
  unknown: 'No record of this one either way',
};

/** The caption on the return arc. Said only where a topic actually slipped. */
export const CLIMB_LOOP = 'we go back for it';

/**
 * What a reward node says about itself. The vibe renames the TITLE above it; this line stays put in
 * both looks, so a learner is never left to work out from a colour why one stop looks different.
 */
export const CLIMB_REWARD = 'Not from the board — you added this one yourself';

/** "2 ways tried so far" — the re-teach ladder, in the learner's words. Empty when it holds none. */
export function waysLine(ways: number): string {
  if (ways <= 0) return '';
  return `${ways} ${ways === 1 ? 'way' : 'ways'} tried so far`;
}

/** The quiet line under a node: its status, and what else is known about it. */
export function nodeLine(node: ClimbNode): string {
  if (node.kind === 'gate') {
    return node.state === 'learnt'
      ? 'Every topic in this chapter is learnt.'
      : `${node.owed} ${node.owed === 1 ? 'topic' : 'topics'} of this chapter still owed.`;
  }
  const ways = waysLine(node.ways);
  const said = ways ? `${CLIMB_STATUS[node.state]} · ${ways}` : CLIMB_STATUS[node.state];
  return node.kind === 'reward' ? `${said} · ${CLIMB_REWARD}` : said;
}

/**
 * What the bridge says it knows. A settled check and this client's own reading of the board are
 * two different claims, and the panel never dresses the second one up as the first.
 */
export function bridgeLine(bridge: ClimbBridge): string {
  const n = bridge.ground.length;
  const things = `${n} ${n === 1 ? 'thing' : 'things'}`;
  return bridge.checked
    ? `Wobo checked what is under this one and found ${things} to lay first. Each takes a few minutes, and then this topic opens by itself.`
    : `Your syllabus puts ${things} under this one, and none of it is behind you yet. Wobo checks the ground before it teaches this.`;
}

/** The three counters at the top, each read off the map and never off a constant. */
export function climbStats(map: ClimbMap): { value: number; label: string }[] {
  return [
    { value: map.learnt, label: map.learnt === 1 ? 'topic learnt' : 'topics learnt' },
    { value: map.debts, label: 'to go back for' },
    { value: map.ground, label: 'ground to lay first' },
  ];
}
