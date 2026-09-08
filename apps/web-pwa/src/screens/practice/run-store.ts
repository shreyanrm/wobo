'use client';

/**
 * The practice run, kept — where the learner is in the set, the marks on every item, what `check`
 * said about each, and which items have already earned their XP.
 *
 * Practice is one of the four doors in the bottom nav, and it used to hold all of this in plain
 * component state: four items answered, a tap on Home, and all four were gone with no "start over"
 * pressed. This is its store. It is keyed to the learner (store/scope.ts `scoped`, on SCOPED_KEYS)
 * because the marks are theirs and leave with them, and it is keyed by set so a second set never
 * reads the first one's answers. A record that does not fit the set it is asked for is no record.
 */

import type { AnswerCheck, AnswerSpec, AnswerState } from '@wobo/contracts';
import { scoped } from '../../store/scope';

export const PRACTICE_KEY = 'wobo-practice-v1';

export interface PracticeRun {
  /** The item the learner is standing on, 0-based. */
  pos: number;
  /** The learner's marks on each item, in set order. */
  states: AnswerState[];
  /** What `check` said about each item, or null where nothing has been checked. */
  results: (AnswerCheck | null)[];
  /** Items whose XP has been granted once already; a re-run of them earns nothing twice. */
  earned: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function loadAll(): Record<string, unknown> {
  try {
    const raw = JSON.parse(scoped.getItem(PRACTICE_KEY) ?? '{}') as unknown;
    return isRecord(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** The run for this set, or null when nothing fitting the set was kept. */
export function readRun(setId: string, set: readonly AnswerSpec[]): PracticeRun | null {
  const run = loadAll()[setId];
  if (!isRecord(run)) return null;
  const { pos, states, results, earned } = run;
  if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 0 || pos >= set.length) {
    return null;
  }
  if (!Array.isArray(states) || states.length !== set.length) return null;
  if (!Array.isArray(results) || results.length !== set.length) return null;
  // every mark must be a mark on the item at its place — the kind is the contract's own tag
  if (!states.every((s, i) => isRecord(s) && s.kind === set[i]?.kind)) return null;
  if (!results.every((r) => r === null || (isRecord(r) && typeof r.correct === 'boolean'))) {
    return null;
  }
  return {
    pos,
    states: states as AnswerState[],
    results: results as (AnswerCheck | null)[],
    earned: Array.isArray(earned)
      ? earned.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export function writeRun(setId: string, run: PracticeRun): void {
  try {
    scoped.setItem(PRACTICE_KEY, JSON.stringify({ ...loadAll(), [setId]: run }));
  } catch {
    // storage refused: the run lives for this mount only, which is what it always did
  }
}

/** The once-key an item's XP is granted under (store/progress.ts `award`), so it is never granted twice. */
export function practiceOnceKey(setId: string, itemId: string): string {
  return `practice:${setId}:${itemId}`;
}
