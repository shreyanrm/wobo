/**
 * The unit rows of the learn screen: each chapter of the subject in front of the learner, in one
 * of six states, from the topics the registry holds, the progress store's truth, and the mastery
 * bands behind both.
 *
 *   done     every topic learnt (completed AND at or above the mastery floor)
 *   now      the chapter the next step is in: the row with the bar and the button
 *   next     the chapter after it, unless a topic is still owed somewhere behind: a debt comes
 *            first, so "next" never points past something unmastered
 *   revisit  a chapter the learner finished, whose evidence puts a topic back below the floor. The
 *            row NAMES the topic that fell (`owedName`, read by `unitLine`): this is the one place
 *            a learner is told they have gone backwards, and it is not spent on a two-word label
 *   later    every untouched chapter after the frontier
 *   past     an untouched chapter before the one under way: the class may have done it, Wobo has
 *            no record either way, so the row carries no word at all rather than "Later"
 *
 * The rule for what is learnt, what is a debt, and what comes next lives in ONE place, `mastery.ts`
 * beside this file: read it before changing anything here. This module paints rows around that
 * answer; it no longer decides anything on its own.
 *
 * A chapter whose topics are not loaded has no lesson count: the row says the name and nothing it
 * cannot know.
 */

import type { Chapter, Subject, Topic } from '../../data/model';
import {
  chooseNextTopic,
  isDebt,
  isLearnt,
  type MasteryView,
  NO_MASTERY,
  topicsOf,
} from './mastery';

export type UnitState = 'done' | 'now' | 'next' | 'revisit' | 'later' | 'past';

export interface UnitRow {
  chapter: Chapter;
  state: UnitState;
  /** Topics in the chapter; 0 when they have not been loaded. */
  lessons: number;
  /** Topics behind them: completed AND at or above the mastery floor. A debt is not counted. */
  done: number;
  /** The 1-based lesson the learner is on, when the chapter is under way. */
  lesson: number | null;
  /** Fraction of the chapter genuinely walked, 0..1: the bar on the `now` row. */
  progress: number;
  /** The topic "Continue" opens: the chooser's answer inside this chapter. */
  topicId: string | null;
  /** True when a finished topic here fell back below the floor and is owed again. */
  owes: boolean;
  /**
   * The name of the first topic here that fell back, when one has. This is the only place in the
   * whole flow where a learner is told they have gone backwards, and it used to be told with two
   * words and nothing else: the tick vanished, the row said "Come back to", and no sentence
   * anywhere named what fell, why the label changed, or what to do about it. That is the moment a
   * child decides they are bad at a subject, so the row says the name out loud.
   */
  owedName: string | null;
}

export interface ProgressInput {
  completed: ReadonlySet<string>;
  topicProgress: Record<string, number>;
  /**
   * The band each topic stands at. Omitted means nothing is known: which is silence, not failure:
   * every row then behaves exactly as it did before mastery was persisted.
   */
  bandOf?: MasteryView['bandOf'];
  /** The platform's own next-best node, when the governed view has one (see `mastery.ts`). */
  platformNodeId?: string | null;
}

/** The furthest-along course still open across the whole subject, if there is one. */
function inFlightTopic(topics: readonly Topic[], p: ProgressInput): Topic | null {
  let best: { topic: Topic; f: number } | null = null;
  for (const t of topics) {
    const f = p.topicProgress[t.id] ?? 0;
    if (p.completed.has(t.id) || f <= 0 || f >= 1) continue;
    if (!best || f > best.f) best = { topic: t, f };
  }
  return best?.topic ?? null;
}

export function unitRows(chapters: readonly Chapter[], p: ProgressInput): UnitRow[] {
  const view: MasteryView = { completed: p.completed, bandOf: p.bandOf ?? NO_MASTERY };
  const inFlight = inFlightTopic(topicsOf(chapters), p);

  // ONE call to the chooser for the whole subject: the topic this learner should be on. Every row
  // below is painted around that answer rather than around a second opinion.
  const nextTopic = chooseNextTopic(topicsOf(chapters), {
    ...view,
    inFlightTopicId: inFlight?.id ?? null,
    platformNodeId: p.platformNodeId ?? null,
  });

  // Has the learner been in this chapter at all? A row is only ever "now" once they have.
  const touched = (chapter: Chapter): boolean =>
    chapter.topics.some((t) => p.completed.has(t.id) || (p.topicProgress[t.id] ?? 0) > 0);

  const rows: UnitRow[] = chapters.map((chapter) => {
    const lessons = chapter.topics.length;
    const learnt = chapter.topics.filter((t) => isLearnt(t, view)).length;
    const owed = chapter.topics.find((t) => isDebt(t, view));
    const chapterInFlight = inFlight && inFlight.chapterId === chapter.id ? inFlight : null;
    // The same law, scoped to this chapter: what Continue opens from this row.
    const here = chooseNextTopic(chapter.topics, {
      ...view,
      inFlightTopicId: chapterInFlight?.id ?? null,
      platformNodeId: p.platformNodeId ?? null,
    });
    const openFraction = chapterInFlight ? (p.topicProgress[chapterInFlight.id] ?? 0) : 0;
    const index = here ? chapter.topics.findIndex((t) => t.id === here.id) : -1;
    return {
      chapter,
      state: lessons > 0 && learnt === lessons ? 'done' : 'later',
      lessons,
      done: learnt,
      lesson: touched(chapter) && learnt < lessons && index >= 0 ? index + 1 : null,
      progress: lessons > 0 ? (learnt + openFraction) / lessons : 0,
      topicId: here?.id ?? null,
      owes: Boolean(owed),
      owedName: owed?.name ?? null,
    };
  });

  // One row is "now": the chapter the chooser's answer lives in, when that chapter is already under
  // way. A chapter nothing has been touched in is never "now": it is what comes next.
  const answerIn = nextTopic ? rows.findIndex((r) => r.chapter.id === nextTopic.chapterId) : -1;
  const answerRow = answerIn >= 0 ? rows[answerIn] : undefined;
  const now = answerRow && answerRow.state !== 'done' && touched(answerRow.chapter) ? answerIn : -1;
  if (now >= 0) {
    const row = rows[now];
    if (row) row.state = 'now';
    // Untouched chapters before the one under way are not "later": nothing is known of them.
    for (const r of rows.slice(0, now)) if (r.state === 'later') r.state = 'past';
  }

  // One row is "next": the SAME law asked a second time, without the kindness that lets an open
  // course jump the queue: what the learner would be sent to once the lesson in hand is closed.
  // That is how "next" ends up on a chapter still owing a topic, wherever it sits in the list: the
  // product does not walk a learner past something they have not mastered. When the answer is the
  // chapter already in hand, "next" falls forward to the first chapter after it instead.
  const afterOpen = chooseNextTopic(topicsOf(chapters), {
    ...view,
    platformNodeId: p.platformNodeId ?? null,
  });
  const afterOpenIn = afterOpen ? rows.findIndex((r) => r.chapter.id === afterOpen.chapterId) : -1;
  const forward =
    now >= 0
      ? rows.findIndex((r, i) => i > now && r.state === 'later')
      : rows.findIndex((r) => r.state === 'later');
  const next = afterOpenIn >= 0 && afterOpenIn !== now ? afterOpenIn : forward;
  const nextRow = next >= 0 ? rows[next] : undefined;
  if (nextRow && nextRow.state !== 'now' && nextRow.state !== 'done') nextRow.state = 'next';

  // Whatever is still owed and is neither the row in hand nor the row up next comes back around.
  for (const r of rows) if (r.owes && r.state !== 'now' && r.state !== 'next') r.state = 'revisit';

  return rows;
}

/** "Lesson 3 of 5", "4 lessons": the quiet line under a chapter's name, from what is known. */
export function unitLine(row: UnitRow): string {
  // TODO(data): the prototype's lines carry a completion day ("Done on Sunday"), a practice score
  // ("practice 9 of 10") and the next test ("test on Friday", "starts after the test"). None of the
  // three is a field yet: completions are undated, practice sets do not report a score to the
  // chapter, and there is no test date.
  // A chapter that fell back says what fell and what to do, in the learner's own words. "Lesson 3
  // of 6" is what a chapter under way says; it is not an answer to "why did my tick disappear".
  if (row.state === 'revisit' && row.owedName) {
    return `${row.owedName} slipped back. Open it again when you want another go.`;
  }
  if ((row.state === 'now' || row.state === 'revisit') && row.lesson !== null && row.lessons > 0) {
    return `Lesson ${row.lesson} of ${row.lessons}`;
  }
  if (row.lessons === 0) return '';
  return `${row.lessons} ${row.lessons === 1 ? 'lesson' : 'lessons'}`;
}

/** The state word on the right of a row that has no button; nothing for a chapter Wobo knows nothing of. */
export function unitState(state: UnitState): string {
  switch (state) {
    case 'done':
      return 'Mastered';
    case 'next':
      return 'Next';
    case 'revisit':
      return 'Come back to';
    case 'later':
      return 'Later';
    default:
      return '';
  }
}

/** "Chapter 6 of 14 · Triangles and the hypotenuse": a subject tile's line; the subject's own line when nothing is loaded. */
export function tileLine(subject: Subject, rows: readonly UnitRow[]): string {
  if (rows.length === 0) return subject.line;
  const here = rows.find((r) => r.state === 'now') ?? rows.find((r) => r.state === 'next');
  if (!here) return `${rows.length} ${rows.length === 1 ? 'chapter' : 'chapters'}`;
  return `Chapter ${here.chapter.index} of ${rows.length} · ${here.chapter.name}`;
}

/** The subject to open on: the one with a chapter under way, else the first. */
export function defaultSubject(
  subjects: readonly Subject[],
  rowsOf: (subject: Subject) => readonly UnitRow[],
): Subject | null {
  for (const s of subjects) if (rowsOf(s).some((r) => r.state === 'now')) return s;
  return subjects[0] ?? null;
}
