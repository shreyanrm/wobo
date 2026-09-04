'use client';

/**
 * The bridge: teaching the ground under a topic before the topic itself.
 *
 * The product claim is "every main topic which has prerequisites will be tested to see their past
 * learning levels ... to bring them up to pace so that they can learn the actual topics of their
 * grade better". `masteredGround` and `composeBridge` in tutor.ts have been the plan for that since
 * they were written, and until now nothing called either of them. This is the half that calls them.
 *
 * The seam is `GroundCheck`. Whoever decides that a learner lacks the ground beneath a topic (the
 * prerequisite check, a placement diagnostic, the concept graph) hands one of these over; the tutor
 * asks for a bridge lesson scaffolded only on ground the learner already owns, and the lesson opens
 * with it. The learner never sees a detour: they see one lesson that starts a little lower down.
 */

import type { Sdk } from '@wobo/sdk';
import type { GroundPiece, GroundReport } from '../curriculum/placement';
import type { Topic } from '../data/model';
import { type BridgePlan, type BridgeStep, composeBridge, masteredGround } from './tutor';

/**
 * What the prerequisite check hands the tutor.
 *
 * `unmet` is the seam's real payload: the prerequisite owner may know from a diagnostic that the
 * ground is missing even when the static graph says otherwise, so an explicit list always wins. Left
 * out, it falls back to the topic's own declared prerequisites minus whatever is completed.
 */
export interface GroundCheck {
  topic: Topic;
  /** Topic ids the learner has finished. */
  completed: ReadonlySet<string>;
  /** How to resolve a prerequisite id into a topic. */
  lookup: (id: string) => Topic | undefined;
  /** The ground the learner does NOT have. Computed from the graph when the caller does not know. */
  unmet?: readonly Topic[];
}

export interface BridgeLesson {
  topic: Topic;
  /** The solid stones, deepest first: prerequisites the learner has already finished. */
  ground: Topic[];
  /** The ground that is missing, which is why this bridge exists. */
  unmet: Topic[];
  /** The bridge's own steps, from the engine or from the honest local outline. */
  steps: BridgeStep[];
  /** True when the steps are the local floor rather than a composed lesson. */
  seeded: boolean;
  /** Wobo's line as the bridge opens. It never says the learner is behind. */
  opening: string;
  /** Wobo's line as the bridge lands and the topic itself starts. */
  arrival: string;
}

/** "a, b and c" without inventing an Oxford comma the copy law does not use. */
function names(topics: readonly Topic[]): string {
  const list = topics.map((t) => t.name.toLowerCase());
  if (list.length === 0) return '';
  if (list.length === 1) return list[0] as string;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The prerequisites of a topic the learner has not finished, resolved through the caller's lookup. */
export function missingGround(check: GroundCheck): Topic[] {
  if (check.unmet) return [...check.unmet];
  return check.topic.prereqTopicIds
    .map((id) => check.lookup(id))
    .filter((t): t is Topic => Boolean(t) && !check.completed.has((t as Topic).id));
}

/**
 * The bridge lesson for a topic whose ground is missing, or null when the learner already stands on
 * everything this topic needs and the lesson should simply begin.
 *
 * The model call is `engine.compose` through the SDK's own provider, so the routing is untouched;
 * `composeBridge` floors to an outline built from the learner's completed topics when the engine has
 * nothing verified to offer, which is why this never throws and never returns an error state.
 */
export async function bridgeFor(sdk: Sdk, check: GroundCheck): Promise<BridgeLesson | null> {
  const unmet = missingGround(check);
  if (unmet.length === 0) return null;

  const ground = masteredGround(check.topic, check.completed, check.lookup);
  const plan: BridgePlan = await composeBridge(sdk, check.topic, ground);
  const topicName = check.topic.name.toLowerCase();

  // Never "you are behind": the sentence names what the topic stands on, not what the learner lacks.
  const opening =
    ground.length > 0
      ? `${topicName} stands on ${names(unmet)}, and you already have ${names(ground)}. we start there and walk straight up into it.`
      : `${topicName} stands on ${names(unmet)}, so that is where we start, and we walk straight up into it.`;

  return {
    topic: check.topic,
    ground,
    unmet,
    steps: plan.steps,
    seeded: plan.seeded,
    opening,
    // THE ARRIVAL LINE HAS TO BE TRUE WHEN IT IS SAID.
    //
    // A composed bridge has walked the learner through the ground, so "you are carrying what it
    // needs" is a report of what just happened. A SEEDED bridge is the local floor: it names the
    // ground and teaches none of it, and a child who has just told the check three times that the
    // ground is new to them must not read two sentences and be told they are carrying it. So the
    // seeded line promises only what the seeded bridge can deliver, which is company.
    arrival: plan.seeded
      ? `that is what ${topicName} stands on. we go into it from here, and anything new we meet, we do together.`
      : `that is the ground under it. now ${topicName}, and you are carrying what it needs.`,
  };
}

/**
 * A piece of ground as a topic. The placement check found it in the learner's own loaded syllabus,
 * so this resolves the same topic through the registry; the fallback below carries the check's own
 * name rather than inventing one, for the case where a topic left the registry between the check
 * settling and the lesson opening.
 */
function pieceAsTopic(piece: GroundPiece, lookup: (id: string) => Topic | undefined): Topic {
  return (
    lookup(piece.topicId) ?? {
      id: piece.topicId,
      chapterId: '',
      name: piece.name,
      blurb: '',
      prereqTopicIds: [],
      kind: 'syllabus',
      xp: 0,
    }
  );
}

/**
 * The bridge for a settled ground report (curriculum/placement.ts), which is the seam the
 * prerequisite check hands the tutor: what it found missing, and what it found solid.
 *
 * Only SOLID ground carries the bridge. Ground the learner merely claimed is real and is not
 * ignored, but a bridge stood on an unchecked claim is a bridge stood on a guess, so it is left out
 * of what the lesson is built over.
 *
 * THE CHECK'S THREE ANSWERS DO NOT REPLACE THE LEARNER'S HISTORY, THEY CORRECT IT.
 *
 * This used to pass `completed` as exactly the pieces this one check happened to ask about: at most
 * three. `masteredGround` walks that set, so a learner who had genuinely finished twenty topics had
 * all twenty discarded, `ground` came back empty, the engine was asked with `bridge_from: []` and
 * the whole bridge collapsed to the seeded floor, at the very moment it most needed to know what
 * the learner already had. The learner's real `completed` set is the ground here; the check's
 * answers are the correction on top of it, in both directions: what it found solid is added, and
 * what it found MISSING is removed even when the topic is marked finished, because a check that
 * just watched the learner fail it outranks a tick from months ago.
 */
export async function bridgeFromReport(
  sdk: Sdk,
  topic: Topic,
  report: GroundReport,
  lookup: (id: string) => Topic | undefined,
  /** Everything the learner has finished. Omitted means the check's own answers are all we know. */
  completed: ReadonlySet<string> = new Set(),
): Promise<BridgeLesson | null> {
  const standing = new Set([...completed, ...report.solid.map((p) => p.topicId)]);
  for (const piece of report.unmet) standing.delete(piece.topicId);
  return bridgeFor(sdk, {
    topic,
    completed: standing,
    lookup,
    unmet: report.unmet.map((p) => pieceAsTopic(p, lookup)),
  });
}

/** One card's worth of the bridge, for a player that lays lessons out as cards. */
export interface BridgeCard {
  title: string;
  /** Wobo's opening line. The steps are their own field, because they are their own elements. */
  idea: string;
  /** The steps, still steps. A player renders them as a list; nothing joins them into prose. */
  steps: BridgeStep[];
  /** What the card asks of the learner, in words the card's own controls can answer. */
  prompt: string;
  reveal: string;
  /** True when the steps are the local floor. A player says so rather than pretending otherwise. */
  seeded: boolean;
}

/**
 * The bridge as the one card a course player puts in front of its own first card. One card rather
 * than one per step: the bridge is the run-up to the lesson, not a lesson of its own, and a run-up
 * that costs four taps stops being a run-up.
 *
 * The steps used to be folded into `idea` with newlines and rendered through a style that sets no
 * `white-space`, so HTML collapsed every one of them and the bullets ran together as a single
 * paragraph. And the prompt used to be "Tap the step you are least sure of." while the steps were
 * inside that paragraph and the card's only control was Check: a question the card could not hear
 * the answer to. The steps are now steps, and the prompt asks for the tap that actually exists.
 */
export function bridgeCard(lesson: BridgeLesson): BridgeCard {
  return {
    title: `First, the ground under ${lesson.topic.name.toLowerCase()}`,
    idea: lesson.opening,
    steps: lesson.steps,
    prompt: 'Read it through, then carry on when this feels like ground you can stand on.',
    reveal: lesson.arrival,
    seeded: lesson.seeded,
  };
}
