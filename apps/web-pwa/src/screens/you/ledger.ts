/**
 * The device-side inputs the week's arithmetic (`week.ts`) needs, and the one note built from them.
 *
 * The awards-per-day counter the progress store keeps, and the course map in syllabus order with
 * each topic's subject named. One reading, so the home, the You screen and the parent's view can
 * never count the same week three different ways — and `weeklyNote` below is the single place the
 * sentence under "This week, in Wobo's words" is computed, for whichever screen is asking.
 */

import { chapterById, loadedTopics, subjectById } from '../../curriculum/registry';
import { loadMind } from '../../store/mind';
import { scoped } from '../../store/scope';
import { type Span, summarise, type WeekSummary, type WeekTopic } from './week';

/** The awards-per-day counter the progress store keeps. */
export function activityCounts(): Record<string, number> {
  try {
    const raw = JSON.parse(scoped.getItem('wobo-activity-counts-v1') ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The course map in syllabus order, each topic with its subject's name. */
export function weekTopics(): WeekTopic[] {
  return loadedTopics().map((t) => {
    const chapter = chapterById(t.chapterId);
    const subject = chapter ? subjectById(chapter.subjectId) : undefined;
    return { id: t.id, name: t.name, chapterId: t.chapterId, subject: subject?.name ?? '' };
  });
}

/** What the caller holds and the ledger cannot read for itself. */
export interface NoteInput {
  /** Week, month or year — the You screen's segmented control; the home always asks for the week. */
  span: Span;
  /** The ISO days with a session, from `markToday()`. */
  marks: readonly string[];
  /** Furthest fraction reached inside each topic, from the progress store. */
  topicProgress: Readonly<Record<string, number>>;
  completed: ReadonlySet<string>;
  /** Overridable for a test; the real screens always mean now. */
  now?: Date;
}

/**
 * THE weekly note. One function, one set of facts, one sentence.
 *
 * "This week, in Wobo's words" appears on the home and on You, and there is exactly one place it
 * is computed: here, over the activity marks, the awards counter, the mind's day ledger and the
 * course map. A screen that assembled its own input could drift a day, a topic or a number away
 * from the other and the two would say different things under the same heading. Neither does.
 */
export function weeklyNote(input: NoteInput): WeekSummary {
  return summarise({
    now: input.now ?? new Date(),
    span: input.span,
    marks: input.marks,
    counts: activityCounts(),
    days: loadMind().days ?? {},
    topics: weekTopics(),
    topicProgress: input.topicProgress,
    completed: input.completed,
  });
}
