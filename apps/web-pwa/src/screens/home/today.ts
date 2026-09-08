'use client';

/**
 * What the home says, from what the learner has actually done — every number and every name comes
 * from the registry, the progress store, the activity marks and the mind. Nothing here is a
 * catalog, a seed or a guess; where a field the prototype's copy needs does not exist yet, the
 * sentence that needs it is left out and the gap is named in a TODO.
 */

import { chapterById, loadedTopics, topicById } from '../../curriculum/registry';
import { loadWorld } from '../../curriculum/world';
import type { Chapter, Topic } from '../../data/model';
import type { MindState } from '../../store/mind';
import type { ProgressStore } from '../../store/progress';
import type { StreakDay } from '../../ui/primitives';
import { deriveStops } from './stops';

type Progress = Pick<ProgressStore, 'completed' | 'topicProgress' | 'streakDays'>;

/** A topic the learner is inside, placed in its chapter. */
export interface Lesson {
  topic: Topic;
  chapter: Chapter | null;
  /** This topic's 1-based place in its chapter; 0 when the chapter's topics are not loaded. */
  lesson: number;
  /** Topics in the chapter; 0 when not loaded. */
  total: number;
  /** Topics of the chapter already completed. */
  done: number;
  /** How far into this topic's course the learner has walked, 0..1. */
  progress: number;
}

export interface TodayPlan {
  /** False until a board and a class are chosen on this device. */
  world: boolean;
  continue: Lesson | null;
  next: Lesson | null;
  /**
   * Every topic this device holds is complete. Nothing to continue and nothing next is ALSO what
   * a learner who has opened nothing looks like, and the two need different sentences.
   */
  finished: boolean;
}

/** True when there are topics in hand and every one of them is done. */
export function finishedAll(topics: readonly Topic[], completed: ReadonlySet<string>): boolean {
  return topics.length > 0 && topics.every((t) => completed.has(t.id));
}

function lessonOf(topic: Topic, p: Progress): Lesson {
  const chapter = chapterById(topic.chapterId) ?? null;
  const index = chapter ? chapter.topics.findIndex((t) => t.id === topic.id) : -1;
  return {
    topic,
    chapter,
    lesson: index >= 0 ? index + 1 : 0,
    total: chapter?.topics.length ?? 0,
    done: chapter ? chapter.topics.filter((t) => p.completed.has(t.id)).length : 0,
    progress: p.topicProgress[topic.id] ?? 0,
  };
}

/** The day's two topics — the one in flight and the one after — from the same derivation the thread used. */
export function todayPlan(p: Progress): TodayPlan {
  const { stops } = deriveStops(p);
  const topicAt = (kind: 'continue' | 'next'): Topic | undefined => {
    const stop = stops.find((s) => s.kind === kind);
    if (stop?.route.name !== 'course') return undefined;
    return topicById(stop.route.topicId);
  };
  const cont = topicAt('continue');
  const next = topicAt('next');
  const world = loadWorld();
  return {
    world: Boolean(world),
    continue: cont ? lessonOf(cont, p) : null,
    next: next ? lessonOf(next, p) : null,
    finished: finishedAll(world ? loadedTopics() : [], p.completed),
  };
}

const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** "two", "ten", "14". */
export function words(n: number): string {
  return SMALL[n] ?? String(n);
}

/**
 * The one situational paragraph under the greeting.
 *
 * TODO(data): the prototype opens with the next test — "Friday's test is on triangles" — and closes
 * with a minutes-to-ready estimate — "Ten minutes on the hypotenuse and you're ready for the first
 * half". Neither the test (subject, day) nor the estimate is a field the app holds yet; both
 * sentences return when those fields exist. What is here is built from the fields that do.
 */
export function todayLine(plan: TodayPlan): string {
  if (!plan.world) return 'Tell me your board. Then your own syllabus lands here.';
  const c = plan.continue;
  if (c) {
    const name = c.chapter?.name ?? c.topic.name;
    if (c.done > 0) {
      return `${name}. You're ${words(c.done)} ${c.done === 1 ? 'lesson' : 'lessons'} in.`;
    }
    if (c.lesson > 0 && c.total > 0) return `${name}. Lesson ${c.lesson} of ${c.total}.`;
    return `${name}.`;
  }
  if (plan.next) return `Next: ${plan.next.topic.name}.`;
  if (plan.finished) return FINISHED_LINE;
  return 'Open your subjects. Your chapters come from your board when you open one.';
}

/**
 * The registry holds only the chapters opened so far (CURRICULUM.md §8), so "everything done" is
 * everything opened, and the next chapter is opened from Learn. The card says both.
 */
export const FINISHED_LINE =
  'Everything you have opened is done. Open the next chapter and it lands here.';

/** The practice card's second line: the fractions set's own sentence (board 01 of app-v1.html). */
export const FRACTIONS_LINE = "Shade, drag and draw. Wobo rings the gap when you're close.";

/**
 * What the practice card's button opens, in one line. With a topic above it the button opens the
 * free-play sandbox on that topic, so the line is the sandbox's own words (course/WhatIf.tsx); the
 * fractions sentence belongs to the fractions set and is drawn only when that is what opens.
 */
export function practiceLine(topic: Topic | null): string {
  if (!topic) return FRACTIONS_LINE;
  return 'Every number here is yours to drag. No task, no clock.';
}

/** "Chapter 6 · lesson 3 of 5." — the continue card's line. */
export function continueLine(l: Lesson): string {
  // TODO(data): the prototype adds the learner's last win — "Last time you found c = 5 yourself."
  // The course player does not yet report the moment a learner found something on their own.
  const parts: string[] = [];
  if (l.chapter) parts.push(`Chapter ${l.chapter.index}`);
  if (l.lesson > 0 && l.total > 0) parts.push(`lesson ${l.lesson} of ${l.total}`);
  return parts.length > 0 ? `${parts.join(' · ')}.` : '';
}

// "This week, in Wobo's words" is one sentence in one place (`you/ledger.ts`'s `weeklyNote`, over
// `you/week.ts`) — the home and You read the same note, so they can never say two different things
// under the same heading.

// --- the home's own words ----------------------------------------------------------------------

/** The one question the home asks, the way the greeting ends it. */
export const HOME_QUESTION = 'what are we figuring out today?';

/** The words in the ask box — the door to the one conversation. */
export const ASK_PLACEHOLDER = 'Ask anything from your syllabus, or paste question 7';

/** The same sentence, opening a card instead of closing a greeting. */
export function asHeading(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// --- the streak's week -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** ISO day, the way the activity marks are written. */
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Monday to Sunday of the current week, each lit if the learner showed up that day. */
export function calendarWeek(marks: readonly string[], now: Date = new Date()): StreakDay[] {
  const set = new Set(marks);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  return LABELS.map((label, i) => ({ label, on: set.has(isoDay(monday + i * DAY_MS)) }));
}

// --- Wobo noticed ------------------------------------------------------------------------------------

/** Which of the learner's own records the observation came from. */
export type NoticedId = 'helped' | 'chapter' | 'rest';

export interface Noticed {
  id: NoticedId;
  title: string;
  /** The observation in Wobo's words. Belongs to THIS observation; there is no default line. */
  body: string;
  /** "today", "yesterday", or the weekday. Empty when the record carries no date. */
  when: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "today", "yesterday", "Sunday" — when something happened, in the learner's own words for it. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const days = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) /
      DAY_MS,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return WEEKDAYS[at.getUTCDay()] ?? '';
}

/** What Wobo has to look at before it can claim to have noticed anything. */
export interface NoticedInput {
  mind: MindState;
  /** The ISO days the learner actually showed up — the activity marks. */
  marks: readonly string[];
  /** The chain of days the progress store is counting. */
  streakDays: number;
  /** The furthest chapter whose every lesson is done, or null — `finishedChapter` below. */
  chapter: Chapter | null;
  now?: Date;
}

/** The unbroken run of marked days ending today, or ending yesterday if today has no mark yet. */
export function markedRun(marks: readonly string[], now: Date = new Date()): number {
  const set = new Set(marks);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let start = today;
  if (!set.has(isoDay(start))) start -= DAY_MS;
  let run = 0;
  while (set.has(isoDay(start - run * DAY_MS))) run += 1;
  return run;
}

/**
 * The furthest chapter the learner has finished outright — every one of its lessons complete.
 * Reads the registry, so it only ever names a chapter this device actually holds.
 */
export function finishedChapter(completed: ReadonlySet<string>): Chapter | null {
  const seen = new Set<string>();
  let best: Chapter | null = null;
  for (const topic of loadedTopics()) {
    if (seen.has(topic.chapterId)) continue;
    seen.add(topic.chapterId);
    const chapter = chapterById(topic.chapterId);
    if (!chapter || chapter.topics.length === 0) continue;
    if (!chapter.topics.every((t) => completed.has(t.id))) continue;
    if (!best || chapter.index > best.index) best = chapter;
  }
  return best;
}

/**
 * The thing Wobo noticed — REAL, or nothing at all.
 *
 * Three observations, each one a record this device actually holds, and each one carrying its own
 * words. The card used to print one fixed second line under whatever it found, which made the line
 * a decoration rather than an observation; here the line IS the observation, so a card that cannot
 * say something true does not appear. The order is the order of what is worth saying: help asked
 * for after a miss (the prototype's own card), then a chapter finished, then a chain that held
 * through a quiet day.
 *
 * Only the first closes on the Sunday note, because that is the prototype's own sentence. Two
 * observations ending on the same clause read as one template with the middle swapped, which is
 * the decoration this function exists to avoid.
 */
export function noticed(input: NoticedInput): Noticed | null {
  const now = input.now ?? new Date();
  const { mind } = input;
  if (mind.helpedAt) {
    return {
      id: 'helped',
      title: 'You asked for help after a miss',
      body: "That's exactly how learning looks. It goes in the Sunday note.",
      when: relativeDay(mind.helpedAt, now),
    };
  }
  if (input.chapter) {
    return {
      id: 'chapter',
      title: `You finished ${input.chapter.name}`,
      body: `Every lesson in chapter ${input.chapter.index}, done.`,
      when: '',
    };
  }
  // The chain the store counts runs longer than the days actually marked: a quiet day was covered
  // and the streak held. Nothing to say until there is a chain worth keeping.
  const run = markedRun(input.marks, now);
  if (input.streakDays >= 2 && input.streakDays > run) {
    return {
      id: 'rest',
      title: 'A rest day did not break your streak',
      body: `${words(input.streakDays)} days still in a row. Rest days don't break it.`,
      when: '',
    };
  }
  return null;
}
