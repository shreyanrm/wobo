/**
 * MASTERY, IN THE LEARN FLOW: the one place the rule is written down.
 *
 * "We keep teaching them until they master a topic and then move onto the next." Until this module
 * existed, the learn board derived done/now/later from completion alone: a learner who answered
 * every question wrong walked forward exactly as fast as one who answered them all right. Bands were
 * computed and thrown away. This is where a band starts to mean something.
 *
 * THE STATE MACHINE
 *
 *   the bands    not_started < emerging < developing < secure < independent
 *   the floor    `secure` (MASTERY_FLOOR, shared with the platform's own chooser). A topic at or
 *                above it is learnt; below it, it is still owed work.
 *
 *   A topic is LEARNT     when it is completed AND it is at or above the floor:
 *                         or when it is completed and Wobo has NO evidence at all about it.
 *   A topic is a DEBT     when it is completed but the evidence puts it below the floor.
 *   A topic is OPEN       when it is not completed.
 *
 *   Silence is not a failing grade. A completed topic with no evidence behind it (progress carried
 *   over from before mastery was persisted, a course finished on a device that never answered a
 *   graded item) is left alone, exactly as an untouched chapter before the one under way is left
 *   alone: the class may have done it, Wobo has no record either way, and inventing a debt out of
 *   an absence would restart thousands of finished chapters on the day this shipped.
 *
 *   WHAT MOVES A TOPIC FROM NOW TO DONE   completing it while its band is at or above the floor.
 *   WHAT PULLS A DONE TOPIC BACK          its band falling below the floor. Bands are derived from
 *                                         the whole evidence run and the reliability of its tail
 *                                         (packages/kgtopg-contract-seed reference), so a topic the
 *                                         learner has started getting wrong again comes back around
 *                                         on its own. Nothing else pulls a topic back.
 *
 *   THE LEARNER IS NEVER BLOCKED. Every chapter and every topic stays tappable; a debt changes what
 *   "next" points at, never what the learner is allowed to open. If they deliberately skip ahead,
 *   they skip ahead, and the debt is still there when they come back, because it lives in the
 *   evidence and not in a lock.
 */

import type { MasteryBand } from '@wobo/contracts';
import { chooseNextNode, isAtFloor, MASTERY_FLOOR } from '@wobo/sdk';
import type { Chapter, Topic } from '../../data/model';

export { MASTERY_FLOOR };

/**
 * A deterministic node id per topic: the contract wants UUIDs and a composed topic has no mapped
 * concept. Every surface that records evidence, and every read of a band, goes through here, so the
 * band a topic is judged by is derived from the evidence that topic actually produced.
 */
export function topicNodeUuid(topicId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < topicId.length; i++) {
    h ^= topicId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = 0x1000193 ^ topicId.length;
  for (let i = topicId.length - 1; i >= 0; i--) {
    h2 = Math.imul(h2 ^ topicId.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const a = h.toString(16).padStart(8, '0');
  const b = h2.toString(16).padStart(8, '0').slice(0, 4);
  return `00000000-0000-7000-8000-${a}${b}`;
}

/**
 * THE ID A TOPIC'S EVIDENCE IS FILED UNDER. One id, derived from the topic id, always.
 *
 * This used to prefer `topic.nodeId`, the concept the brain mapped the topic onto (registry.ts sets
 * it to `node.conceptIds[0]`, a slug like `fractions`). That could never be right: every payload
 * that records evidence types `node_id` as `zUuid` (packages/contracts/src/payloads.ts), so a
 * concept slug can never appear as an evidence node id, and the course files everything it records
 * under `topicNodeUuid(topicId)`. The band was therefore being read from a key nothing ever wrote,
 * which came back `not_started`, which the rules read as silence: for every topic the brain had
 * mapped, a chapter finished badly still said "Mastered". The two ids are joined here instead.
 */
export function topicNodeId(topic: Pick<Topic, 'id'>): string {
  return topicNodeUuid(topic.id);
}

/**
 * True when a node id names this topic. The evidence id above, or the concept the brain mapped it
 * onto: the platform answers "what next" in its own id space, and this is where the two meet.
 */
export function topicIsNode(topic: Pick<Topic, 'id' | 'nodeId'>, nodeId: string): boolean {
  return nodeId === topicNodeUuid(topic.id) || nodeId === topic.nodeId;
}

/** What the rules need to know about a learner. */
export interface MasteryView {
  completed: ReadonlySet<string>;
  /** The band a topic stands at. Default: nothing is known, which is not a failing grade. */
  bandOf: (topic: Topic) => MasteryBand;
}

/** Nothing known about anyone: the shape every caller that has no mastery layer yet passes. */
export const NO_MASTERY: (topic: Topic) => MasteryBand = () => 'not_started';

/** Completed, and the evidence says so (or says nothing). This topic is behind them. */
export function isLearnt(topic: Topic, view: MasteryView): boolean {
  if (!view.completed.has(topic.id)) return false;
  return !isDebt(topic, view);
}

/** Completed, but the evidence puts it below the floor. It comes back around. */
export function isDebt(topic: Topic, view: MasteryView): boolean {
  if (!view.completed.has(topic.id)) return false;
  const band = view.bandOf(topic);
  return band !== 'not_started' && !isAtFloor(band);
}

/** Every topic still owed work: open, or completed-but-below-the-floor. */
export function owedTopics(topics: readonly Topic[], view: MasteryView): Topic[] {
  return topics.filter((t) => !isLearnt(t, view));
}

export interface NextTopicInput extends MasteryView {
  /** The topic whose course is open right now, if any. */
  inFlightTopicId?: string | null;
  /**
   * The platform's own answer: `KGtoPG.mastery.getNextBestNode`, read through the mastery store.
   * It outranks the syllabus order when it names a topic on this board that is still owed, because
   * the platform holds steward-validated prerequisite edges where the client holds only derived
   * ones (curriculum/prereq.ts, which labels every edge with where it came from). This is how
   * "every main topic which has prerequisites brings the learner up to pace first" reaches the
   * board: the platform can send them back to a prerequisite in an earlier chapter, and the board
   * follows. Where it says nothing, the derived graph below still orders the ground first.
   */
  platformNodeId?: string | null;
}

/**
 * Where a topic stands, for the purpose of ORDERING. Its band, except that a topic the client
 * already counts as learnt reads at the floor even when Wobo holds no evidence about it: silence is
 * not a failing grade here either, and a finished prerequisite that banded `not_started` would
 * otherwise block every topic standing on it out of step 1 of the law.
 */
function standingOf(topic: Topic, view: MasteryView): MasteryBand {
  const band = view.bandOf(topic);
  return isLearnt(topic, view) && !isAtFloor(band) ? MASTERY_FLOOR : band;
}

/**
 * THE SINGLE ANSWER TO "WHAT DO I DO NEXT" for the learn flow.
 *
 * The ordering itself is `chooseNextNode`: the same law the platform's own
 * `KGtoPG.mastery.getNextBestNode` runs, so the app and the platform can never drift into two
 * different answers. Two rules sit on top of it here, both of them kindness:
 *
 *   1. an open course wins. A learner mid-lesson is never yanked somewhere else.
 *   2. only topics still owed work are candidates. A learnt topic is not offered again.
 *
 * Between those two sits the platform's own answer, when it has one for a topic on this board: it
 * knows steward-validated edges the client does not. Failing that, the nodes handed to the law
 * carry the syllabus's own order AND the client's own derived prerequisite graph
 * (curriculum/prereq.ts), so step 1 of the law is real here: a topic whose ground is not yet under
 * it waits, the ground comes first, and among the ready ones a topic already begun and still short
 * of the floor sorts ahead of every untouched topic after it.
 */
export function chooseNextTopic(topics: readonly Topic[], input: NextTopicInput): Topic | null {
  const owed = owedTopics(topics, input);
  if (owed.length === 0) return null;
  const open = input.inFlightTopicId ? owed.find((t) => t.id === input.inFlightTopicId) : undefined;
  if (open) return open;

  const named = input.platformNodeId;
  const fromPlatform = named ? owed.find((t) => topicIsNode(t, named)) : undefined;
  if (fromPlatform) return fromPlatform;

  // Bands for EVERY topic in front of us, not only the owed ones: a prerequisite already behind the
  // learner has to read at the floor, or it would block everything standing on it out of step 1.
  const bands = new Map(topics.map((t) => [topicNodeId(t), standingOf(t, input)]));
  const byId = new Map(topics.map((t) => [t.id, t]));

  const byNode = new Map<string, Topic>();
  const nodes = owed.map((topic, index) => {
    const nodeId = topicNodeId(topic);
    // Two topics can share a concept; the first in syllabus order speaks for it.
    if (!byNode.has(nodeId)) byNode.set(nodeId, topic);
    return {
      node_id: nodeId,
      // The derived graph (curriculum/prereq.ts), resolved to node ids. Only edges whose other end
      // is on this board are carried: an edge to a topic that is not here says nothing we can act
      // on, and an unresolvable id would band `not_started` and block its topic for no reason.
      prerequisite_ids: topic.prereqTopicIds
        .map((id) => byId.get(id))
        .filter((p): p is Topic => Boolean(p))
        .map((p) => topicNodeId(p)),
      sequence: index,
    };
  });
  const picked = chooseNextNode(nodes, (id) => bands.get(id));
  return picked ? (byNode.get(picked.node_id) ?? null) : null;
}

/** Every topic of every chapter, in syllabus order. */
export function topicsOf(chapters: readonly Chapter[]): Topic[] {
  return chapters.flatMap((c) => c.topics);
}
