'use client';

/**
 * THE CLIMB, AT THE ONE PLACE A MODULE ENDS (docs/LEARNING-MODEL.md, "The tutor never leaves").
 *
 * `curriculum/blueprint.ts` can re-choose a learner's group from what just happened (`stuckOn`),
 * and `wobo/reteach.ts` already keeps the product's one tally of misses. Until this file, nothing
 * joined them: the course fetched the chapter's pool, handed it to the placement check and nothing
 * else, recorded its misses against the topic rather than a module, and never asked for the group
 * again. A learner beaten twice by a practice run was handed the next item of the same run.
 *
 * What the course does now, at the end of every module:
 *
 *   RECORD   a wrong answer inside a module is a miss against THAT module, in the product's own
 *            tally (`noteConceptMiss`), keyed on the pool and the module. Two is a pattern
 *            (`RETEACH_AFTER_MISSES`), exactly as it is everywhere else. No second opinion.
 *   ASK      the modules that have beaten this learner twice are what `stuckOn` names, and the group
 *            is asked for again through `groupInPool`. What follows is the first module of that
 *            group the learner has not yet landed.
 *   PROVE    when the learner's durable band holds (`topicHeld`), the next thing is the boss: three
 *            questions the course has never shown solved. A band is what the answers say, and it
 *            can be reached by answers the screen had just handed over; the boss is the proof.
 *   END      the topic ends at one decision, `topicClosed`: the band holds AND the boss is passed.
 *            Never at a count of modules, never at a module finishing, and a failed boss closes
 *            nothing: the walk is chosen again (`again`).
 *
 * TWO RULES THIS FILE ADDS, and why each is the product's rule rather than a new one.
 *
 *   A CHECK THAT BEAT THEM COMES BACK ONLY AFTER SOMETHING ELSE LANDED. The check is the module
 *   that gathers the evidence the band is made of; barred for good, it would be a topic that can
 *   never end. So when a different module lands, a check that had beaten them starts its tally
 *   again. That is what `reteach.ts` already does after every switch of approach ("the tally starts
 *   again so the next one needs its own pattern behind it"), applied to the switch of module. A way
 *   in that beat them is never lifted: another way in has taught the idea, and it is not needed.
 *
 *   WHEN THE GROUP IS SPENT AND THE TOPIC IS NOT HELD, the module played longest ago comes round
 *   again, and never the one just played: `chooseApproach`'s own rule for a ladder whose every rung
 *   has been tried. A learner who is still not there is given more, never nothing (rule 5).
 *
 * FREE, AND STRUCTURALLY SO. Everything below is a selection over a pool already in memory and a
 * tally already on the device. No model, no network, no generation.
 */

import type { MasteryBand } from '@wobo/contracts';
import { isAtFloor, type PracticeItem } from '@wobo/sdk';
import { useCallback, useMemo, useState } from 'react';
import type { Blueprint, BlueprintModule, LearnerState } from '../../curriculum/blueprint';
import { groupInPool } from '../../curriculum/pool';
import {
  conceptMisses,
  noteConceptCorrect,
  noteConceptMiss,
  RETEACH_AFTER_MISSES,
  seedConceptMisses,
} from '../../wobo/reteach';
import { fmt, twinEquation } from './equations';

// --- the tally, keyed on the module ---------------------------------------------------------------

/**
 * Where a module's misses are kept. The pool's cell and the module, so two syllabus versions that
 * both call a module `p9` never share a tally, and nothing is ever keyed on the topic.
 */
export function moduleKey(pool: Blueprint, moduleId: string): string {
  return `module:${pool.board}:${pool.grade}:${pool.contentVersion}:${pool.node}:${moduleId}`;
}

/** One wrong answer inside this module. Returns the tally that now stands against it. */
export function missIn(pool: Blueprint, moduleId: string): number {
  return noteConceptMiss(moduleKey(pool, moduleId));
}

/**
 * A miss the verifier overturned ("I think I'm right", upheld). The grade bent to the proof, so the
 * module was never missed that time; the misses before it still stand.
 */
export function unmissIn(pool: Blueprint, moduleId: string): void {
  const key = moduleKey(pool, moduleId);
  const left = conceptMisses(key) - 1;
  noteConceptCorrect(key);
  if (left > 0) seedConceptMisses(key, left);
}

/** Has this module beaten the learner? Two misses, by the product's own threshold. */
export function beatenBy(pool: Blueprint, moduleId: string): boolean {
  return conceptMisses(moduleKey(pool, moduleId)) >= RETEACH_AFTER_MISSES;
}

/** The modules of this pool that have beaten the learner: what `stuckOn` names. */
export function stuckIn(pool: Blueprint): string[] {
  return pool.modules.map((m) => m.id).filter((id) => beatenBy(pool, id));
}

// --- the walk -------------------------------------------------------------------------------------

/** What one sitting of a course has handed this learner, and which of those landed. */
export interface Walk {
  /** Module ids in the order they were put on stage. */
  handed: string[];
  /** Modules that ended with no miss in this sitting. */
  landed: Set<string>;
}

export function startWalk(): Walk {
  return { handed: [], landed: new Set() };
}

/** Which modules a player can put on screen. A module it cannot show is never chosen for it. */
export type Plays = (m: BlueprintModule) => unknown;

/** The group as it stands right now: re-chosen from what beat them, narrowed to what can be shown. */
function groupNow(
  pool: Blueprint,
  topicId: string,
  plays: Plays,
  state: LearnerState,
): BlueprintModule[] {
  return groupInPool(pool, topicId, { ...state, stuckOn: stuckIn(pool) }).filter((m) => plays(m));
}

function choose(
  pool: Blueprint,
  topicId: string,
  walk: Walk,
  plays: Plays,
  state: LearnerState,
  prefer?: (m: BlueprintModule) => boolean,
): BlueprintModule | null {
  const group = groupNow(pool, topicId, plays, state);
  const open = group.filter((m) => !walk.landed.has(m.id));
  const fresh = (prefer && open.find(prefer)) ?? open[0];
  if (fresh) return fresh;
  // Spent, and the topic is not held (a held topic never asks). The one played longest ago comes
  // round again, never the one just played. A group of one is that one: it landed, it did not beat
  // them, and it is the only road there is.
  const last = walk.handed.at(-1);
  const others = group.filter((m) => m.id !== last);
  if (others.length === 0) return group[0] ?? null;
  const at = (m: BlueprintModule) => walk.handed.lastIndexOf(m.id);
  return [...others].sort((a, b) => at(a) - at(b))[0] ?? null;
}

function hand(walk: Walk, m: BlueprintModule | null): BlueprintModule | null {
  if (m) walk.handed.push(m.id);
  return m;
}

/**
 * The first module of a sitting, or null when the pool holds nothing this player can show.
 *
 * `prefer` is where a returning learner was: when their group still holds a module played on that
 * card, the sitting starts there rather than at the top. It only ever picks among the modules the
 * group chose, so it can never bring back one that beat them.
 */
export function firstIn(
  pool: Blueprint,
  topicId: string,
  walk: Walk,
  plays: Plays,
  state: LearnerState = {},
  prefer?: (m: BlueprintModule) => boolean,
): BlueprintModule | null {
  return hand(walk, choose(pool, topicId, walk, plays, state, prefer));
}

/**
 * CHOSEN AGAIN WITH NOTHING ENDED: what follows something that is not a pool module, such as a
 * boss the learner did not pass. The same choice as at a module boundary, from the same tally.
 */
export function againIn(
  pool: Blueprint,
  topicId: string,
  walk: Walk,
  plays: Plays,
  state: LearnerState = {},
): BlueprintModule | null {
  return hand(walk, choose(pool, topicId, walk, plays, state));
}

/**
 * THE MODULE BOUNDARY. A module ended with `misses` in this sitting; record what that means and
 * hand back the module that follows, chosen again.
 */
export function endIn(
  pool: Blueprint,
  topicId: string,
  walk: Walk,
  moduleId: string,
  misses: number,
  plays: Plays,
  state: LearnerState = {},
): BlueprintModule | null {
  if (misses === 0) {
    walk.landed.add(moduleId);
    // A whole sitting came back clean: the way this module teaches it landed.
    noteConceptCorrect(moduleKey(pool, moduleId));
    // Something landed that is not the check that beat them, so the check's tally starts again.
    for (const m of pool.modules) {
      if (m.role === 'check' && m.id !== moduleId && beatenBy(pool, m.id)) {
        noteConceptCorrect(moduleKey(pool, m.id));
        walk.landed.delete(m.id);
      }
    }
  } else {
    walk.landed.delete(moduleId);
  }
  return hand(walk, choose(pool, topicId, walk, plays, state));
}

// --- the ending -----------------------------------------------------------------------------------

/**
 * DOES THE EVIDENCE HOLD? The band, and nothing else.
 *
 * The band is the learner's durable record: derived from every answer they have given (one point
 * per answer, however many planes report it), synced across devices, and what the learn board
 * reads to call a topic learnt or owed. The course reads it under the board's own key
 * (`screens/learn/mastery.ts`, `topicNodeId`), so the two read one record. (`masteryOf` read
 * ideas and misconceptions nothing in the product ever gathered; it is deleted rather than left as
 * a second answer.)
 *
 * Held is what opens the boss. It is not, alone, what closes the topic: see `topicClosed`.
 */
export function topicHeld(band: MasteryBand | undefined): boolean {
  return isAtFloor(band ?? 'not_started');
}

/** Two of the boss's three: the bar the boss has always set. */
export const BOSS_PASS = 2;

/**
 * IS THE TOPIC CLOSED? One decision, taken once, when a boss round has been checked.
 *
 * The band held, and the boss passed. The boss is three questions the course has never shown
 * solved, so it is the one place a learner who copied answers back cannot pass on what they were
 * just shown; the band after it includes the boss's own answers. Completion, the greeting, and the
 * board's "Mastered" all follow this and nothing else. A band alone, or a boss alone, closes
 * nothing.
 */
export function topicClosed(
  band: MasteryBand | undefined,
  boss: { correct: number; total: number } | null,
): boolean {
  if (!boss || boss.total <= 0) return false;
  return topicHeld(band) && boss.correct >= Math.min(BOSS_PASS, boss.total);
}

// --- the worked module ----------------------------------------------------------------------------

/**
 * WHAT A WORKED MODULE SOLVES: a twin of the item that beat the learner, never the item itself.
 *
 * A worked card that solved the very item the next check asks let a child copy the answer straight
 * back, and a copied answer counted as understanding. The twin has the same shape and other
 * numbers (`twinEquation`), every line computed, and it is never any of `items`, so nothing the
 * course will ask is ever shown solved. With nothing missed yet, the first item's twin. Null when no
 * twin can be computed, and the module then has nothing to show.
 */
export function workedFor(
  missed: PracticeItem | undefined,
  items: readonly PracticeItem[],
): PracticeItem | null {
  const source = missed ?? items[0];
  if (!source) return null;
  const twin = twinEquation(
    source.equation,
    items.map((i) => i.equation),
  );
  if (!twin) return null;
  return { ...source, id: `${source.id}:worked`, equation: twin.equation, answer: fmt(twin.x) };
}

// --- what the atom can play -----------------------------------------------------------------------

/** The atom's cards that can be a whole module. */
export type AtomModuleCard = 'scale' | 'worked' | 'practice';

/**
 * The module card a saved place or a link was on, for a walk that is picking up: the free play is
 * the second beat of a simulation module, so it resumes that module. Anything else is no module.
 */
export function atomResumeCard(place: unknown): AtomModuleCard | undefined {
  if (place === 'whatif') return 'scale';
  return place === 'scale' || place === 'worked' || place === 'practice' ? place : undefined;
}

/**
 * THE CARD A MODULE IS PLAYED ON, IN THE ATOM, by what the module IS.
 *
 *   simulation  the balance scale, then the free play beside it
 *   worked      one of the node's own verified items, solved move by move
 *   items       the practice run over the node's verified items
 *
 * Nothing else. A film or a reading has no card here, so it is never chosen for this screen. A
 * prerequisite is about different ground, and the atom already lays that ground with its bridge
 * (`wobo/bridge.ts`), so a worked card about THIS idea is never passed off as one.
 */
export function atomCardFor(m: BlueprintModule): AtomModuleCard | null {
  if (m.role === 'prerequisite') return null;
  switch (m.kind) {
    case 'simulation':
      return 'scale';
    case 'worked':
      return 'worked';
    case 'items':
      return 'practice';
    default:
      return null;
  }
}

// --- the hook -------------------------------------------------------------------------------------

/** The walk, as a course screen holds it. */
export interface Climb {
  /** The module on stage. */
  on: BlueprintModule;
  /** Module ids handed in this sitting, in order. */
  handed: readonly string[];
  /** A wrong answer inside the module on stage. */
  miss(): void;
  /** A wrong answer on stage that the verifier then overturned. */
  unmiss(): void;
  /** True once the module on stage has beaten the learner twice. */
  beaten(): boolean;
  /**
   * The module on stage ended. Returns what follows, or null when the pool can offer this screen
   * nothing more (a pool fault, judged elsewhere; the screen carries on as it did without a pool).
   */
  end(misses: number): BlueprintModule | null;
  /** Something that is not a module ended (a boss not passed): choose again, ending nothing. */
  again(): BlueprintModule | null;
}

/**
 * The climb for one topic on one screen, or null when there is no pool, no topic, or nothing in the
 * pool this screen can play. Null is the ordinary answer today and the screen is written for it.
 */
export function useClimb(
  pool: Blueprint | null | undefined,
  topicId: string | undefined,
  plays: Plays,
  /** Where a returning learner was, as whatever `plays` answers for that card. */
  resumeOn?: unknown,
): Climb | null {
  // A new pool or a new topic is a new sitting; the tally it reads is the durable one.
  const sitting = useMemo(() => {
    if (!pool || !topicId) return null;
    const walk = startWalk();
    const prefer =
      resumeOn === undefined ? undefined : (m: BlueprintModule) => plays(m) === resumeOn;
    return { pool, topicId, walk, first: firstIn(pool, topicId, walk, plays, {}, prefer) };
  }, [pool, topicId, plays, resumeOn]);
  const [moved, setMoved] = useState<{
    sitting: typeof sitting;
    module: BlueprintModule | null;
  } | null>(null);
  const module = moved && moved.sitting === sitting ? moved.module : (sitting?.first ?? null);

  const onStage = useCallback(() => sitting?.walk.handed.at(-1), [sitting]);
  const miss = useCallback(() => {
    const id = onStage();
    if (sitting && id) missIn(sitting.pool, id);
  }, [sitting, onStage]);
  const unmiss = useCallback(() => {
    const id = onStage();
    if (sitting && id) unmissIn(sitting.pool, id);
  }, [sitting, onStage]);
  const beaten = useCallback(() => {
    const id = onStage();
    return Boolean(sitting && id && beatenBy(sitting.pool, id));
  }, [sitting, onStage]);
  const end = useCallback(
    (misses: number) => {
      const id = onStage();
      if (!sitting || !id) return null;
      const next = endIn(sitting.pool, sitting.topicId, sitting.walk, id, misses, plays);
      setMoved({ sitting, module: next });
      return next;
    },
    [sitting, onStage, plays],
  );

  const again = useCallback(() => {
    if (!sitting) return null;
    const next = againIn(sitting.pool, sitting.topicId, sitting.walk, plays);
    setMoved({ sitting, module: next });
    return next;
  }, [sitting, plays]);

  return useMemo(
    () =>
      sitting && module
        ? { on: module, handed: sitting.walk.handed, miss, unmiss, beaten, end, again }
        : null,
    [sitting, module, miss, unmiss, beaten, end, again],
  );
}
