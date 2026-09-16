/**
 * What a learner did on a board they have moved off, kept and marked with where it came from.
 *
 * docs/CONSOLE-ROLES-AND-BOARD.md §1: on a board change "what does not exist in the new board is
 * kept and marked", never deleted. Completion is filed under each board's own topic ids
 * (`screens/learn/mastery.ts`), and changing board drops the old board's cached chapters
 * (`curriculum/adopt.ts` calls `cache.forget`), so without this file the NAMES of everything a
 * learner finished would leave the device with the cache, and the record would be ids nobody can
 * read. So the change takes a snapshot first: every topic of the old board this learner finished
 * or started, by name, under the board's name and the day they moved.
 *
 * It is a record, not a cache. Nothing here is ever dropped by a pin change, and the erase in
 * `you/eraseAll.ts` takes it with the rest of the learner's scope.
 */

import type { CurriculumTopicsView } from '@wobo/sdk';
import { scoped } from '../../store/scope';

export const KEPT_KEY = 'wobo-kept-boards-v1';
/** Enough for a record anybody reads, small enough that a scope never fills with it. */
const MAX_TOPICS = 400;
const MAX_RECORDS = 12;

export interface KeptTopic {
  id: string;
  name: string;
  /** Finished, or only started. */
  done: boolean;
}

export interface KeptBoard {
  boardId: string;
  boardName: string;
  /** When they moved off it, ISO. */
  at: string;
  topics: KeptTopic[];
}

/**
 * The topics a learner finished or started on a board, from the pages cached for it.
 * Pure over its inputs, so the rule is testable without storage.
 */
export function heldTopics(
  views: readonly CurriculumTopicsView[],
  completed: ReadonlySet<string>,
  progress: Readonly<Record<string, number>>,
): KeptTopic[] {
  const seen = new Set<string>();
  const out: KeptTopic[] = [];
  for (const view of views) {
    for (const node of view.topics) {
      if (seen.has(node.id)) continue;
      const done = completed.has(node.id);
      if (!done && !((progress[node.id] ?? 0) > 0)) continue;
      seen.add(node.id);
      out.push({ id: node.id, name: node.name, done });
    }
  }
  return out.slice(0, MAX_TOPICS);
}

export function loadKept(): KeptBoard[] {
  try {
    const raw = scoped.getItem(KEPT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as KeptBoard[]).filter(isKept) : [];
  } catch {
    return [];
  }
}

function isKept(row: unknown): row is KeptBoard {
  const r = row as KeptBoard;
  return Boolean(
    r &&
      typeof r.boardId === 'string' &&
      typeof r.boardName === 'string' &&
      Array.isArray(r.topics),
  );
}

/**
 * Add a board's snapshot to the record. A board with nothing done is not written, and a board
 * moved off twice keeps one entry holding everything from both stays, newest date.
 */
export function keepBoard(entry: KeptBoard): KeptBoard[] {
  const all = loadKept();
  if (entry.topics.length === 0) return all;
  const before = all.find((row) => row.boardId === entry.boardId);
  const merged: KeptBoard = before
    ? {
        ...entry,
        topics: [
          ...entry.topics,
          ...before.topics.filter((t) => !entry.topics.some((n) => n.id === t.id)),
        ].slice(0, MAX_TOPICS),
      }
    : entry;
  const next = [merged, ...all.filter((row) => row.boardId !== entry.boardId)].slice(
    0,
    MAX_RECORDS,
  );
  try {
    scoped.setItem(KEPT_KEY, JSON.stringify(next));
  } catch {
    // storage full or denied: the record is still returned for this session
  }
  return next;
}

/** The records a screen shows: every board but the one they are on now. */
export function keptExcept(
  records: readonly KeptBoard[],
  currentBoardId: string | null,
): KeptBoard[] {
  return records.filter((row) => row.boardId !== currentBoardId && row.topics.length > 0);
}

/** The mark a kept topic carries. It names where it came from and claims nothing else. */
export function keptMark(boardName: string): string {
  return `From ${boardName}`;
}
