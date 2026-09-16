'use client';

/**
 * THE LESSON A LEARNER HAS ALREADY OPENED, KEPT ON THE DEVICE (docs/PLATFORMS.md §5 and §6).
 *
 * The law is one sentence: a lesson already opened plays without the network, in full. It did not,
 * and the word "offline" appearing in eighty-four files was not the same thing as a lesson playing.
 *
 * MEASURED, on the built app, at 390, with the network genuinely off and a course that had been
 * composed and played minutes earlier. `engine.compose` is the only place a course's cards have
 * ever existed; its answer was written nowhere; so the offline open fell through the whole path:
 *
 *   1. the compose call failed, and the player floored to the four generic scaffold cards
 *      ("Meet <topic>", "Feel the rule") that `seedCourse` draws when the engine refuses;
 *   2. that floor is `seeded`, so `reconcilePlaceholder` flipped this topic's download from
 *      `ready` to `failed` — the record that the learner had ever downloaded it, destroyed by
 *      the act of opening it with no signal;
 *   3. the download gate in `screens/Course.tsx` then read `failed`, enqueued the course again and
 *      bounced the learner back to the home screen.
 *
 * So the lesson did not merely degrade offline: it could not be opened at all, and being offline
 * once cost the learner the download they had already paid for. This module is where the course
 * lives now, beside the concept core the same lesson already keeps (`wobo/core-store.ts`), under
 * the same three rules that store holds itself to:
 *
 *  · **Per learner.** Every row is keyed to the subject who owns it through `scoped`, and sign-out
 *    sweeps it (`store/scope.ts`, `SCOPED_PREFIXES`). A composed course is content somebody's
 *    daily allowance paid for, and docs/CACHES.md is explicit that nothing bought is served to a
 *    learner it was not made for: a sibling on the same tablet reads none of this.
 *  · **Only what was real.** A `seeded` course is the honest floor, never this topic's lesson.
 *    Writing one here would make a placeholder permanent, which is the bug in step 2 with a longer
 *    life. A refused write is silence: the player behaves exactly as it did before.
 *  · **A cache, never a promise.** Every read may miss, and a miss costs nothing but the ordinary
 *    compose. Nothing here generates, asks for, or repairs anything.
 *
 * WHAT IS DELIBERATELY NOT KEPT. A card hydrated through the raster seam carries its picture as an
 * inline `data:image/png;base64,…` inside its SVG, and one of those is bigger than this whole
 * store's budget for a lesson. Those cards are not kept: `MAX_RECORD_BYTES` refuses the write, the
 * card falls to its idea and its act offline (the floor the player already draws), and nothing
 * else about the lesson is lost.
 *
 * THE BUDGET IS THE WHOLE SHELF, NOT ONE ROW. A phone's localStorage is about five megabytes for
 * everything the product owns, and a child's course is not allowed to be the thing that fills it.
 * The per-row ceiling alone did not say that: eight rows at `MAX_RECORD_BYTES` is 3.2 MB, roughly
 * two thirds of the origin, and `keepArtifact`/`keepFilm` rewrite the row on every card that
 * hydrates, so the shelf grows toward that ceiling as the learner works rather than sitting at the
 * one small lesson anybody measured. MEASURED on this store: a composed lesson is 518 characters
 * before a single card has hydrated, and 40,576 once one diagram has. The small number is the one a
 * first measurement sees; it is not the one the shelf tends to. So the real cap is
 * `MAX_STORE_BYTES` across every row, and the oldest lesson yields to make room for today's before
 * the device is ever asked for the space.
 *
 * AND A REFUSED WRITE HERE IS NOT THE LEARNER'S WORK. `scoped.setItem` records a refusal through
 * `noteWrite(false)` (store/scope.ts), which raises the level `SaveTrouble.tsx` reads, and that
 * strip tells a child "this device is not letting me keep it either... this piece may not be
 * waiting for you next time". That sentence is true of a board they drew and false of a lesson
 * cache whose miss costs nothing but the ordinary compose (rule three). Telling a child their work
 * is at risk because a convenience cache could not find room is the same false alarm that strip
 * exists to prevent, told the other way round, so this store writes through `scopedCache`
 * (store/scope.ts): the same door, the same scoped key, the same sweep, and no claim on the
 * learner's save state either way.
 *
 * WHAT IS FROZEN BY KEEPING, WHICH IS A PRODUCT DECISION AND IS NAMED HERE RATHER THAN IMPLIED.
 * `Composing.tsx` reads `keptLesson(topicId)` BEFORE it calls `engine.compose`, with a network or
 * without one, which is what saves the second compose the screen used to buy on every opening of a
 * course the download queue had just paid for. Two things follow and neither is an accident:
 *   · a topic's lesson is frozen at the composition that was kept, until the shelf evicts it. A
 *     better engine, or a syllabus that moved, reaches that learner only after the eviction.
 *   · `create.course.compiled.v1` is recorded only where a compose actually happened, so a kept
 *     opening records none. That is honest — nothing was compiled and no allowance was spent — but
 *     it does mean the event ledger counts compositions, never openings.
 * Both are bounded by the eviction above and by nothing else. Whether a kept lesson should expire
 * on its own is a content decision for the owner, not one to take quietly inside a cache: the
 * behaviour is pinned in `kept.test.ts` so it cannot be changed by accident or lost.
 */

import type { MotionScene } from '../../engines/MotionPlayer';
import type { SimScene } from '../../engines/SimRunner';
import { scoped, scopedCache } from '../../store/scope';
import type { GenCourse } from './Composing';

/** The prefix `store/scope.ts` carries on `SCOPED_PREFIXES`, so a sign-out takes every row. */
export const KEPT_LESSON_PREFIX = 'wobo-lesson-v1:';

const INDEX_KEY = `${KEPT_LESSON_PREFIX}index`;

/**
 * Lessons kept at once. A learner works through a handful at a time and the oldest yields to
 * today's, exactly as the concept cores do — this is a cache of what they are studying now, not an
 * archive of everything they ever opened.
 */
export const MAX_LESSONS = 8;

/**
 * The ceiling on one lesson, in characters of JSON. Comfortably more than a composed course of
 * cards, a workbook and a boss (a few tens of kilobytes), and comfortably less than a raster
 * card's base64 picture, which is why such a card is not kept rather than half kept.
 */
export const MAX_RECORD_BYTES = 400_000;

/**
 * The ceiling on the WHOLE shelf, in characters of JSON, and the one that keeps the header's
 * promise. `MAX_LESSONS` x `MAX_RECORD_BYTES` is 3.2 MB of a roughly 5 MB origin, which is not "a
 * few kilobytes": one lesson is small, and a learner working through eight of them while every
 * hydrated card rewrites its row is how a cache arrives at its ceiling without anybody deciding to.
 * A fifth of the origin is what a child's kept courses may have, and the oldest yields for today's.
 */
export const MAX_STORE_BYTES = 1_000_000;

/** A card's hydrated engine artifact, as the player renders it. */
export type KeptArtifact = { kind: 'diagram'; svg: string } | { kind: 'sim'; spec: SimScene };

interface KeptRecord {
  v: 1;
  /** When it was kept, so the oldest row is the one that yields. */
  at: number;
  course: GenCourse;
  /** The engines' answers for this course's cards, by card id. Absent until a card hydrates. */
  artifacts?: Record<string, KeptArtifact>;
  /**
   * The course's one film (`engine.video`). Often absent, and honestly so: a film's scenes carry
   * their narration inline as base64 audio, which is bigger on its own than a whole lesson's budget,
   * so `MAX_RECORD_BYTES` refuses those and the beat falls to the honest floor the player already
   * draws for a film it could not fetch. A silent film of small drawn scenes fits and is kept.
   */
  film?: MotionScene;
}

const keyFor = (topicId: string) => `${KEPT_LESSON_PREFIX}${topicId}`;

/**
 * Which topic a course id belongs to, learnt as lessons are kept and read.
 *
 * A card hydrating its picture knows the course it is part of and not the topic that course was
 * composed for (`useArtifact` is handed `course.courseId`), and drilling a topic id down through
 * the card tree to reach this store would be a prop on every card for the sake of a cache. The
 * lesson is always read or written before any of its cards hydrate — the same effect does both —
 * so this is warm by the time it is asked, and the scan below is the honest fallback when it is
 * not. Memory only: nothing here is written down, and a reload simply learns it again.
 */
const topicOfCourse = new Map<string, string>();

/** The topic a course was composed for: what we were told, then what the shelf can prove. */
function topicFor(courseId: string): string | null {
  const known = topicOfCourse.get(courseId);
  if (known) return known;
  for (const key of index()) {
    if (!key.startsWith(KEPT_LESSON_PREFIX) || key === INDEX_KEY) continue;
    const topicId = key.slice(KEPT_LESSON_PREFIX.length);
    if (readRecord(topicId)?.course.courseId === courseId) return topicId;
  }
  return null;
}

/**
 * THIS STORE'S OWN WRITE, AND THE REASON IT IS NOT `scoped.setItem`.
 *
 * `scopedCache` is the same localStorage door under the same scoped key, so a row written here
 * lands where `applyScope` moves it and where a sign-out takes it. The single difference is the one
 * the header names: a refusal is not reported as the learner's work failing to save, because it is
 * not. A miss here costs the ordinary compose and nothing else, and the caller decides what to do
 * about it. Storage is still reached through the one door (`store/isolation.test.ts`).
 */
function put(base: string, value: string): boolean {
  return scopedCache.setItem(base, value);
}

function index(): string[] {
  try {
    const raw = scoped.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** What this row costs on the device right now, or nothing when it is not there. */
function bytesOf(key: string): number {
  return scoped.getItem(key)?.length ?? 0;
}

/** Everything on the shelf except the row about to be rewritten, which is being replaced. */
function shelfBytesExcept(key: string): number {
  let total = 0;
  for (const k of index()) if (k !== key) total += bytesOf(k);
  return total;
}

/**
 * Let the oldest lesson go, so today's has room. False when there is nothing left to give up,
 * which is the end of the retry below rather than an error: the shelf is empty and the write is
 * simply bigger than this device will take.
 */
function dropOldest(except: string): boolean {
  const keys = index();
  const gone = keys.find((k) => k !== except);
  if (!gone) return false;
  scoped.removeItem(gone);
  put(INDEX_KEY, JSON.stringify(keys.filter((k) => k !== gone)));
  return true;
}

/** Newest last. The oldest row leaves when the shelf is full, and it leaves the index with it. */
function remember(key: string): void {
  const keys = index().filter((k) => k !== key);
  keys.push(key);
  while (keys.length > MAX_LESSONS) {
    const gone = keys.shift();
    if (gone) scoped.removeItem(gone);
  }
  put(INDEX_KEY, JSON.stringify(keys));
}

function readRecord(topicId: string): KeptRecord | null {
  try {
    const raw = scoped.getItem(keyFor(topicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KeptRecord>;
    if (parsed?.v !== 1) return null;
    const course = parsed.course;
    // A row with no cards is not a lesson. It can only have come from a build older than this one
    // or from a hand at the storage, and either way the ordinary compose is the honest answer.
    if (!course || !Array.isArray(course.cards) || course.cards.length === 0) return null;
    if (course.seeded === true) return null;
    topicOfCourse.set(course.courseId, topicId);
    return {
      v: 1,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
      course,
      ...(parsed.artifacts ? { artifacts: parsed.artifacts } : {}),
      ...(parsed.film ? { film: parsed.film } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Write the record, unless it is over the ceiling. Returns whether it landed.
 *
 * Room is made from inside the shelf first — the budget is ours to keep, so the oldest lesson
 * yields before the device is ever asked for space it may not have. Only then does the write go
 * down, and a device that refuses it anyway (a quota the shelf does not know about, filled by
 * everything else the product owns) is answered the same way: give up the oldest lesson and ask
 * again, until it lands or there is nothing left to give. A cache that stops at the first refusal
 * is not a cache, and on a full phone it would be the one store that both fails and stays full.
 */
function writeRecord(topicId: string, record: KeptRecord): boolean {
  let body: string;
  try {
    body = JSON.stringify(record);
  } catch {
    return false;
  }
  if (body.length > MAX_RECORD_BYTES) return false;
  const key = keyFor(topicId);
  // One row can never be worth more than the whole shelf, so this terminates at the empty shelf.
  while (shelfBytesExcept(key) + body.length > MAX_STORE_BYTES) {
    if (!dropOldest(key)) return false;
  }
  for (;;) {
    if (put(key, body)) {
      remember(key);
      return true;
    }
    if (!dropOldest(key)) return false;
  }
}

/**
 * Keep the course this learner just opened. A seeded floor is never kept (rule two above), so a
 * lesson that was composed for real is the only thing an offline open can ever find here.
 */
export function keepLesson(topicId: string, course: GenCourse): boolean {
  if (!topicId || course.seeded || course.cards.length === 0) return false;
  topicOfCourse.set(course.courseId, topicId);
  const existing = readRecord(topicId);
  return writeRecord(topicId, {
    v: 1,
    at: Date.now(),
    course,
    // A re-compose of the same course keeps the pictures and the film already made for it; a
    // different course id means different cards, and last lesson's pictures are not theirs.
    ...(existing && existing.course.courseId === course.courseId && existing.artifacts
      ? { artifacts: existing.artifacts }
      : {}),
    ...(existing && existing.course.courseId === course.courseId && existing.film
      ? { film: existing.film }
      : {}),
  });
}

/** The course kept for this topic, or nothing. Never a fetch, never a guess. */
export function keptLesson(topicId: string): GenCourse | null {
  return readRecord(topicId)?.course ?? null;
}

/** True when this topic's lesson will open with the network off. */
export function hasKeptLesson(topicId: string): boolean {
  return readRecord(topicId) !== null;
}

/**
 * Keep one card's hydrated engine artifact beside the course, so the diagram and the sandbox are
 * there on the second opening as well as the first. Keyed by the course it was made for: a card id
 * alone would hand last week's picture to a course that has since been composed again.
 */
export function keepArtifact(
  topicId: string,
  courseId: string,
  cardId: string,
  artifact: KeptArtifact,
): boolean {
  const record = readRecord(topicId);
  if (!record || record.course.courseId !== courseId) return false;
  return writeRecord(topicId, {
    ...record,
    at: Date.now(),
    artifacts: { ...(record.artifacts ?? {}), [cardId]: artifact },
  });
}

/** The artifact kept for this card of this course, or nothing. */
export function keptArtifact(
  topicId: string,
  courseId: string,
  cardId: string,
): KeptArtifact | null {
  const record = readRecord(topicId);
  if (!record || record.course.courseId !== courseId) return null;
  return record.artifacts?.[cardId] ?? null;
}

/**
 * The same two, for the card itself, which knows its course and not its topic. A course whose
 * lesson is not kept (a seeded floor, a record over the ceiling) has no shelf to put a picture on,
 * and both of these answer plainly rather than making one.
 */
export function keepCardArtifact(
  courseId: string,
  cardId: string,
  artifact: KeptArtifact,
): boolean {
  const topicId = topicFor(courseId);
  return topicId ? keepArtifact(topicId, courseId, cardId, artifact) : false;
}

export function keptCardArtifact(courseId: string, cardId: string): KeptArtifact | null {
  const topicId = topicFor(courseId);
  return topicId ? keptArtifact(topicId, courseId, cardId) : null;
}

/**
 * The course's film, kept beside it when it fits. A film whose scenes carry their narration as
 * base64 audio does not fit and is refused (the header says why), which is not a failure: the beat
 * falls to the same floor it already falls to when the engine has no film for this topic.
 */
export function keepFilm(courseId: string, film: MotionScene): boolean {
  const topicId = topicFor(courseId);
  if (!topicId) return false;
  const record = readRecord(topicId);
  if (!record || record.course.courseId !== courseId) return false;
  return writeRecord(topicId, { ...record, at: Date.now(), film });
}

/** The film kept for this course, or nothing. */
export function keptFilm(courseId: string): MotionScene | null {
  const topicId = topicFor(courseId);
  if (!topicId) return null;
  const record = readRecord(topicId);
  if (!record || record.course.courseId !== courseId) return null;
  return record.film ?? null;
}
