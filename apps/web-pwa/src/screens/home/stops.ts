'use client';

/**
 * The day's stops — derived live from the learner's real syllabus and their real progress.
 *
 * The audit's finding was that this file invented a CBSE Class 8 maths syllabus for anyone whose
 * board we had no catalog for. That is now impossible: the stops are built from the curriculum
 * registry's in-memory nodes, which only ever hold what the brain served for the framework and
 * level this learner is pinned to. An empty world produces exactly one stop — the honest door to
 * choosing a board — and a world whose chapters have not been opened yet produces the stop that
 * opens them. Neither produces a topic.
 */

import { loadedTopics } from '../../curriculum/registry';
import { loadWorld } from '../../curriculum/world';
import type { Topic } from '../../data/model';
import type { Route } from '../../shell/router';
import { BONUS_XP, openDoors } from '../../store/arcade';
import type { ProgressStore } from '../../store/progress';
import { XP_AWARDS } from '../../store/progress';
import { hueForTopic } from '../../ui/hues';

export type StopKind =
  | 'landing'
  | 'done'
  | 'continue'
  | 'next'
  | 'review'
  | 'boss'
  | 'bonus'
  /** No board chosen yet, or no syllabus loaded yet — one honest door, never a fake topic. */
  | 'empty';

export interface ThreadStop {
  id: string;
  kind: StopKind;
  title: string;
  meta: string;
  /** The XP a quest pays out — shown as its bounty; pigment only once earned. */
  bounty?: number;
  /** True once the quest is genuinely earned — lights the stop and its bounty. */
  done?: boolean;
  /** The owning subject's hue — the pigment the earned burst arrives in. */
  hue?: string;
  /** Furthest fraction reached inside a continue topic — drawn as its filament. */
  progress?: number;
  /** Boss gate only: dashed until the day's topic finishes. */
  locked?: boolean;
  route: Route;
}

/** The bonus quest's colour — marigold, the earned moment (DESIGN.md §0), never a raw hex. */
const MOLTEN = 'var(--marigold)';
/** The one stop a learner with no syllabus in front of them sees. */
function emptyStop(hasWorld: boolean): ThreadStop {
  return hasWorld
    ? {
        id: 'empty-subjects',
        kind: 'empty',
        title: 'Open your subjects',
        meta: 'Your chapters come from your board when you open one',
        route: { name: 'learn' },
      }
    : {
        id: 'empty-world',
        kind: 'empty',
        title: 'Tell me your board',
        meta: 'Then your own syllabus lands here',
        route: { name: 'you' },
      };
}

export function deriveStops(p: Pick<ProgressStore, 'completed' | 'topicProgress' | 'streakDays'>): {
  stops: ThreadStop[];
  currentIndex: number;
} {
  const { completed, topicProgress, streakDays } = p;
  const world = loadWorld();
  // Every topic the brain has actually served for this learner's world. Never a bundled catalog.
  const worldTopics = world ? loadedTopics() : [];
  const known = new Map(worldTopics.map((t) => [t.id, t] as const));

  // The landing stop is always honest: showing up counts, and it needs no syllabus.
  const stops: ThreadStop[] = [
    {
      id: 'landing',
      kind: 'landing',
      title: 'Warm-up',
      meta: `Day ${streakDays} of being a learner · done`,
      done: true,
      route: { name: 'progress' },
    },
  ];

  if (worldTopics.length === 0) {
    stops.push(emptyStop(Boolean(world)));
    return { stops, currentIndex: stops.length - 1 };
  }

  // Continue — the furthest-along topic still in flight, and only one we can actually name.
  let continueTopic: Topic | undefined;
  let continueF = 0;
  for (const [id, f] of Object.entries(topicProgress)) {
    if (f > 0 && f < 1 && !completed.has(id) && f >= continueF) {
      const t = known.get(id);
      if (t) {
        continueTopic = t;
        continueF = f;
      }
    }
  }

  // Next up — the first uncompleted topic of the learner's own world.
  const nextTopic = worldTopics.find((t) => !completed.has(t.id) && t.id !== continueTopic?.id);

  // Recently lit — the last two completions we can still name from the loaded syllabus.
  const doneTopics = [...completed]
    .slice(-2)
    .map((id) => known.get(id))
    .filter((t): t is Topic => Boolean(t));

  // The boss gate belongs to the day's topic; it unlocks when that topic finishes.
  const gate = continueTopic ?? nextTopic;
  const gateDone = gate ? (topicProgress[gate.id] ?? 0) >= 1 || completed.has(gate.id) : false;

  for (const t of doneTopics) {
    stops.push({
      id: `done-${t.id}`,
      kind: 'done',
      title: t.name,
      meta: 'Done · revisit any time',
      done: true,
      hue: hueForTopic(t.id),
      route: { name: 'course', topicId: t.id },
    });
  }

  if (continueTopic) {
    stops.push({
      id: `continue-${continueTopic.id}`,
      kind: 'continue',
      title: continueTopic.name,
      meta: `Continue · ${Math.round(continueF * 100)}% walked`,
      bounty: continueTopic.xp,
      hue: hueForTopic(continueTopic.id),
      progress: continueF,
      route: { name: 'course', topicId: continueTopic.id },
    });
  }
  if (nextTopic) {
    stops.push({
      id: `next-${nextTopic.id}`,
      kind: 'next',
      title: nextTopic.name,
      meta: 'Next up · a fresh idea',
      bounty: nextTopic.xp,
      hue: hueForTopic(nextTopic.id),
      route: { name: 'course', topicId: nextTopic.id },
    });
  }
  if (completed.size > 0) {
    stops.push({
      id: 'review',
      kind: 'review',
      title: 'Review',
      meta: 'Refresh what’s fading',
      bounty: XP_AWARDS.item,
      route: { name: 'practice' },
    });
  }
  if (gate) {
    stops.push({
      id: `boss-${gate.id}`,
      kind: 'boss',
      title: 'Boss gate',
      meta: gateDone ? 'Unlocked · ready when you are' : 'Locked · finish today’s topic',
      bounty: gate.xp,
      hue: hueForTopic(gate.id),
      done: gateDone,
      locked: !gateDone,
      route: { name: 'course', topicId: gate.id },
    });
  }

  // The daily bonus quest — one date-seeded nudge drawn from real state. Eligibility is real (you
  // can only clear reviews if you've completed something; a mystery only shows if the learner's own
  // world holds an undiscovered one), and the day-of-year seed rotates the pick so it is stable
  // within a day and different across days.
  const mysteryTopic = worldTopics.find(
    (t) => (t.kind === 'mystery' || t.kind === 'bonus') && !completed.has(t.id),
  );
  /*
   * THE ARCADE'S QUEST (docs/CONTENT-INTERACTION.md §7). It is offered only when a side door is
   * genuinely open: a bonus level the learner has actually been shown, not yet cleared, and the
   * day's cap not yet spent (`store/arcade.ts` `openDoors`). An empty list means the quest is not
   * in the rotation at all, so this never sends anybody to a game that does not exist.
   *
   * Its bounty is the arcade's own fifteen, and it is the arcade that pays it. This stop cannot
   * award anything: the XP lands when the level is cleared, in the arcade's own ledger, where it
   * stays out of the climb.
   */
  const door = openDoors()[0];

  const quests = {
    arcade: {
      title: 'Play a bonus level',
      meta: 'Daily quest · a side door in the middle of a chapter',
      bounty: BONUS_XP,
      route: (door ? { name: 'arcade', topicId: door.topicId } : { name: 'learn' }) as Route,
    },
    reviews: {
      title: 'Clear your reviews',
      meta: 'Daily quest · refresh what is fading',
      bounty: XP_AWARDS.bonus,
      route: { name: 'practice' } as Route,
    },
    mystery: {
      title: 'Explore a mystery',
      meta: 'Daily quest · something out of syllabus',
      bounty: XP_AWARDS.mystery,
      route: (mysteryTopic
        ? { name: 'course', topicId: mysteryTopic.id }
        : { name: 'sandbox' }) as Route,
    },
    ask: {
      title: 'Ask Wobo something',
      meta: 'Daily quest · one good question',
      bounty: XP_AWARDS.bonus,
      route: { name: 'chat' } as Route,
    },
  };
  const eligible: (keyof typeof quests)[] = ['ask'];
  if (completed.size > 0) eligible.unshift('reviews');
  if (mysteryTopic) eligible.push('mystery');
  if (door) eligible.push('arcade');
  const seed = Math.floor(Date.now() / 86_400_000);
  const pick = eligible[seed % eligible.length] as keyof typeof quests;
  const q = quests[pick];
  // Nothing claims the bonus yet: the claim used to be a device-only flag nobody set, which on a
  // learner's return would have let today's award be taken twice. When a claim exists it belongs
  // in the account (docs/MEMORY-LAW.md), not under a device key.
  stops.push({
    id: 'bonus',
    kind: 'bonus',
    title: q.title,
    meta: q.meta,
    bounty: q.bounty,
    done: false,
    hue: MOLTEN,
    route: q.route,
  });

  const currentIndex = Math.max(
    stops.findIndex((s) => s.kind === (continueTopic ? 'continue' : 'next')),
    0,
  );
  return { stops, currentIndex };
}
