'use client';

/**
 * THE CHAPTER'S POOL, ON THE CLIENT (docs/LEARNING-MODEL.md).
 *
 * *"Chapters and topics come from the board and say WHAT must be learned; MODULES are ours, they
 * live in the CHAPTER'S POOL, and a GROUP of modules teaches a topic."* The architect builds the
 * pool once, on the platform's money; `curriculum/blueprint.ts` walks one; `placement.ts` asks
 * about the ground it declares. This is the piece that was missing between them: the fetch.
 *
 * Three rules it keeps.
 *
 * * **It never asks for a pool to be built.** `curriculum.blueprint` is a read. A chapter with no
 *   pool is an ordinary answer and every screen carries on exactly as it did — the derived
 *   prerequisite graph is still there, and it still says it is derived.
 * * **A document the app cannot read is refused**, by the same `isBlueprint` gate the walker uses.
 *   One parser, not two, and never half a pool.
 * * **One request per cell.** A pool is keyed on chapter x board x class x version and it changes
 *   about as often as a syllabus does, so it is fetched once per session per cell and shared by
 *   every screen that asks. The gateway's answer is remembered, "no pool" included.
 * * **A failure is not an answer.** A refused, stalled or dropped request is not "this chapter has
 *   no pool", and remembering it as one turned re-choosing off for the rest of the session: a
 *   learner who left the lesson and came back was never chosen for again (played 2026-09-16). It
 *   is forgotten, and the next screen that opens the chapter asks again: once per open, never once
 *   per render.
 */

import { useEffect, useState } from 'react';
import type { Chapter } from '../data/model';
import { type Blueprint, groupFor, isBlueprint, type LearnerState } from './blueprint';
import { curriculum, curriculumReady } from './client';
import { unmetAssumptions } from './placement';
import { loadWorld } from './world';

/** What the gateway needs to find a pool: one chapter, at one board, class and syllabus version. */
export interface PoolCell {
  node: string;
  chapter: string;
  board: string;
  grade: string;
  subject: string;
  contentVersion: string;
  topics: { id: string; name: string }[];
}

/**
 * The cell a chapter sits in, or null when the learner's world does not name one yet.
 *
 * A pool is keyed on the cell, so an incomplete cell is no cell at all: asking for "the pool for
 * Fractions" without a board and a class would either miss forever or, worse, hit another class's.
 */
export function cellFor(chapter: Chapter | undefined, subjectName?: string): PoolCell | null {
  const world = loadWorld();
  if (!chapter || !world?.level || !world.frameworkName) return null;
  const topics = chapter.topics.map((t) => ({ id: t.id, name: t.name }));
  if (topics.length === 0) return null;
  return {
    node: chapter.id,
    chapter: chapter.name,
    board: world.frameworkName,
    grade: world.level,
    subject: subjectName ?? chapter.subjectId,
    contentVersion: world.versionYear ?? world.versionId ?? 'pinned',
    topics,
  };
}

const keyOf = (cell: PoolCell) =>
  [cell.board, cell.grade, cell.subject, cell.contentVersion, cell.node].join('|');

/** The gateway's answers, and the requests in flight for them. "No pool" is remembered as null. */
const pools = new Map<string, Blueprint | null>();
const inFlight = new Map<string, Promise<Blueprint | null>>();

/**
 * The pool for a cell. An answer is asked for once; a failure resolves to null for the screen that
 * asked and is not remembered. Never throws.
 */
export async function fetchPool(cell: PoolCell): Promise<Blueprint | null> {
  const key = keyOf(cell);
  const known = pools.get(key);
  if (known !== undefined) return known;
  const already = inFlight.get(key);
  if (already) return already;
  if (!curriculumReady()) return null;

  const request = curriculum()
    .blueprint(cell)
    .then(({ blueprint }) => {
      const pool = isBlueprint(blueprint) ? blueprint : null;
      pools.set(key, pool);
      return pool;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/** Tests and a syllabus change both need the memory cleared; nothing else should touch it. */
export function clearPools(): void {
  pools.clear();
  inFlight.clear();
}

/**
 * What is already known about a cell's pool without asking: the answer this session already got,
 * null when there is no cell or no brain to ask, and undefined when the question is still open.
 */
function knownPool(cell: PoolCell | null): Blueprint | null | undefined {
  if (!cell) return null;
  const known = pools.get(keyOf(cell));
  if (known !== undefined) return known;
  return curriculumReady() ? undefined : null;
}

/**
 * The chapter's pool for a screen: the pool, null, or undefined while the one request for it is
 * still in flight.
 *
 * Null is the ordinary answer today and the screen must be written for it: most chapters have no
 * pool yet, and one that has none is taught exactly as it was. Undefined exists so a screen that
 * CHOOSES from the pool (the course, `screens/course/climb.ts`) can wait for the answer instead of
 * starting a learner down the unchosen road and changing it under them a moment later. A cell with
 * no brain behind it, or one this session has already asked about, is never undefined.
 */
export function usePool(
  chapter: Chapter | undefined,
  subjectName?: string,
): Blueprint | null | undefined {
  const cell = cellFor(chapter, subjectName);
  const key = cell ? keyOf(cell) : '';
  const [held, setHeld] = useState<{ key: string; pool: Blueprint | null }>({
    key: '',
    pool: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the cell, which is the identity
  useEffect(() => {
    if (!cell) return;
    let live = true;
    void fetchPool(cell).then((found) => {
      if (live) setHeld({ key, pool: found });
    });
    return () => {
      live = false;
    };
  }, [key]);

  return held.key === key && key !== '' ? held.pool : knownPool(cell);
}

/**
 * The GROUP of modules that teaches this topic, for this learner, out of the chapter's pool.
 *
 * This is the loop the placement check exists to close: what the learner answered about the
 * architect's declared ground (`unmetAssumptions`) is what pulls the prerequisite module in.
 * Choosing costs nothing — it is a selection out of a pool that was already paid for — so it is
 * done here, on the client, per learner, and never asked of a model.
 */
export function groupInPool(
  pool: Blueprint | null,
  topicId: string,
  state: LearnerState = {},
): ReturnType<typeof groupFor> {
  if (!pool) return [];
  return groupFor(pool, topicId, { unmetAssumptions: unmetAssumptions(), ...state });
}
