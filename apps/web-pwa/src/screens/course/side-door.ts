/**
 * THE SIDE DOOR — where a bonus level is allowed to appear, and where it is not.
 *
 * docs/CONTENT-INTERACTION.md §7 (the owner, 2026-09-08): *"In the middle, not the end. After every
 * second or third topic of a chapter, a bonus level appears as a side door off the climb:
 * optional, never in the path, never a nag. The boss level stays the summit."*
 *
 * This module is the placement rule and nothing else. It is a pure function of two numbers and a
 * skill, so it is the same answer on the gateway (`plexus/arcade.py` `door_positions`) and here,
 * and both are pinned to the same table by their own tests. It holds no opinion about what happens
 * next in a course: a door is an OFFER, and the offer object deliberately carries no route, so
 * nothing downstream can accidentally put a game in the learner's path.
 *
 * A door that has no level behind it is not drawn. Nothing here invents a game: the level came off
 * a card of the course the learner has just finished, which was generated once and cached, so a
 * play costs nothing and the words on it are words they have already met.
 */

import type { ArcadeSkill, ArcadeSpec } from '../../engines/arcade/spec';

/** The line the door says about itself. Optional, off the path, and never a nag about it. */
export const DOOR_LINE = 'a side door, if you want it. the climb goes on without it.';

/** What the door is called. A bonus level, never a "game" and never a "reward". */
export const DOOR_TITLE = 'bonus level';

/**
 * How often a door may appear. Where speed IS the skill it earns its place more often; everywhere
 * else, every third topic. Mirrors `arcade.stride_for` on the gateway.
 */
export function everyFor(skill: ArcadeSkill | null): number {
  return skill === 'speed' ? 2 : 3;
}

/**
 * The 1-based topic positions a door sits AFTER.
 *
 * Never after the last: the boss is the summit and a door beside it would be a detour from the
 * ending rather than a rest in the middle. A chapter of three or fewer has no middle worth
 * speaking of, so it gets nothing.
 */
export function doorPositions(topics: number, every: number): number[] {
  if (topics < 4 || every < 2) return [];
  const out: number[] = [];
  for (let p = every; p < topics; p += every) out.push(p);
  return out;
}

/** The same question asked one topic at a time, which is how a course asks it. */
export function sitsAtADoor(position: number, topics: number, skill: ArcadeSkill | null): boolean {
  return doorPositions(topics, everyFor(skill)).includes(position);
}

export interface DoorOffer {
  chapterId: string;
  chapterName: string;
  /** The topic the door hangs off — the one just finished, never the one coming next. */
  topicId: string;
  /** Its 1-based position in the chapter. */
  position: number;
  spec: ArcadeSpec;
  /** What the door says about itself. */
  line: string;
  /** Why this chapter earns a bonus level at all. */
  why: string;
}

const WHY: Record<ArcadeSkill, string> = {
  speed: 'speed is the skill here, so this one runs against the clock.',
  recall: 'holding these by heart is the skill here, so this one asks for them fast.',
};

/**
 * The offer, or nothing. Nothing is the common answer and it is not a failure: most topics carry
 * no door, and a course that carried no level simply ends the way it always did.
 */
export function offerFor(args: {
  chapterId: string;
  chapterName: string;
  topicId: string;
  position: number;
  topics: number;
  spec: ArcadeSpec | null;
}): DoorOffer | null {
  const { spec, position, topics } = args;
  if (!spec) return null;
  if (!sitsAtADoor(position, topics, spec.skill)) return null;
  return {
    chapterId: args.chapterId,
    chapterName: args.chapterName,
    topicId: args.topicId,
    position,
    spec,
    line: DOOR_LINE,
    why: WHY[spec.skill],
  };
}
