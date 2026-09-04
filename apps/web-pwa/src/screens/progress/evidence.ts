/**
 * THE REPORT'S ARITHMETIC — every number a parent reads, and where it came from.
 *
 * Nothing in this file invents. Each function takes what the device actually recorded and returns
 * either a number it can source or `null`, and every caller is written so that `null` draws an
 * honest empty state rather than a placeholder. That is the whole point of the module: the landing
 * page promises a parent counting minutes, chapters genuinely done, what is holding a week later
 * and a line to the finish, and a promise the app does not keep is the worst bug this repo can
 * ship. So the promise is kept from real state or it is not drawn at all.
 *
 * WHERE EACH NUMBER COMES FROM
 *   minutes            the mind's day ledger (`store/mind.ts`, `DayLedger.seconds`) — seconds on
 *                      the app's surfaces, counted as they happen.
 *   topics learnt      the learn flow's own law (`screens/learn/mastery.ts`): completed AND at or
 *                      above the mastery floor, or completed with no evidence either way. This
 *                      module never re-decides what "learnt" means; it asks the one place that
 *                      knows, so the report and the board can never disagree.
 *   needs another pass the same law's `isDebt` — completed, but the evidence has fallen below the
 *                      floor. This is the topic that comes back around.
 *   right a week on    mastery evidence stamps (`MasterySnapshot.nodes[].evidence[].at`): of the
 *                      answers given at least a week after the FIRST answer on that concept, how
 *                      many were right. It is named for what it counts and nothing more. It is NOT
 *                      retention across a week without practice: nothing here requires a gap, so a
 *                      learner drilling a concept daily has every answer from day eight counted.
 *                      Measuring the stronger claim needs a gap in the evidence, and this module
 *                      will not print a claim its arithmetic does not make. Below
 *                      `MIN_HELD_ANSWERS` it returns null.
 *   the finish line    a straight-line pace: topics learnt over the days actually active, carried
 *                      forward at the last week's cadence. Labelled as an estimate wherever it is
 *                      drawn, withheld entirely until there is a pace to read, and withheld again
 *                      when there has been no pace for a week.
 *
 * THE DENOMINATOR IS NOT THE WHOLE SYLLABUS, AND IT SAYS SO. `standings` walks the registry, and
 * the registry holds a chapter's topics only once that chapter has been OPENED (`chapterOf` ships
 * every chapter with `topics: []`; `useTopics` fills one in, for the one chapter in front of the
 * learner). So `tally.total` counts the topics of chapters this learner has actually opened, and a
 * learner in chapter 1 of 12 has a total of a handful. That is not fixable here — the client has no
 * syllabus it did not fetch, and fetching every chapter to print a denominator would be the app
 * inventing one. What IS fixable is the claim: `syllabusReach` says how much of the syllabus the
 * number covers, `projectFinish` takes it, and no sentence says "all N topics" unless N is all of
 * them. This is the number a parent makes decisions on.
 *
 * No learner's name appears in anything this module returns (DESIGN.md §0, the copy law).
 * Unit-tested in `evidence.test.ts`.
 */

import type { MasterySnapshot } from '@wobo/sdk';
import type { Chapter, Topic } from '../../data/model';
import type { DayLedger } from '../../store/mind';
import { isDebt, isLearnt, type MasteryView } from '../learn/mastery';
import { type Segment, type Span, spanDays, times, type WeekSummary, word } from '../you/week';

const DAY_MS = 86_400_000;

// --- where each topic stands ---------------------------------------------------------------------

/** The four things a topic can be. Every one of them has words of its own; none is a colour. */
export type TopicState = 'learnt' | 'debt' | 'started' | 'untouched';

/** The status in words — read out by the map, the lists and every aria-label. */
export const STATE_WORDS: Record<TopicState, string> = {
  learnt: 'learnt',
  debt: 'needs another pass',
  started: 'in progress',
  untouched: 'not started',
};

export interface ProgressTopic {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  chapterId: string;
  chapterName: string;
  /** The chapter's own index in the syllabus, as the board orders it. */
  chapterIndex: number;
  /** Position within the chapter, as the board orders it. */
  order: number;
  prereqTopicIds: string[];
  state: TopicState;
}

/** The syllabus, in the two reads this module needs. A test hands it two arrays. */
export interface SyllabusInput {
  subjects: readonly { id: string; name: string }[];
  chaptersOf: (subjectId: string) => readonly Chapter[];
}

function stateOf(topic: Topic, view: MasteryView, fraction: number): TopicState {
  // debt first: both debt and learnt require a completed topic, and a debt is the one that matters
  if (isDebt(topic, view)) return 'debt';
  if (isLearnt(topic, view)) return 'learnt';
  return fraction > 0 ? 'started' : 'untouched';
}

/**
 * Every topic of the learner's own world, in syllabus order, each carrying where it stands.
 *
 * A learner who has not chosen a world yet gets an empty array — which is the honest empty state
 * every surface below is built for, never a seeded board.
 */
export function standings(
  syllabus: SyllabusInput,
  view: MasteryView,
  topicProgress: Readonly<Record<string, number>> = {},
): ProgressTopic[] {
  const out: ProgressTopic[] = [];
  for (const subject of syllabus.subjects) {
    for (const chapter of syllabus.chaptersOf(subject.id)) {
      chapter.topics.forEach((topic, order) => {
        out.push({
          id: topic.id,
          name: topic.name,
          subjectId: subject.id,
          subjectName: subject.name,
          chapterId: chapter.id,
          chapterName: chapter.name,
          chapterIndex: chapter.index,
          order,
          prereqTopicIds: topic.prereqTopicIds,
          state: stateOf(topic, view, topicProgress[topic.id] ?? 0),
        });
      });
    }
  }
  return out;
}

/** How much of the syllabus the counts above are drawn from. */
export interface SyllabusReach {
  /** Chapters the registry knows about, across every subject of the learner's world. */
  chapters: number;
  /** Of those, the ones whose topics have actually been fetched — the only ones that can count. */
  opened: number;
}

/**
 * What the numbers cover. A chapter with no topics in memory has never been opened, so nothing
 * inside it is in any tally; this is the honest way to say how much of the board that leaves out.
 */
export function syllabusReach(syllabus: SyllabusInput): SyllabusReach {
  let chapters = 0;
  let opened = 0;
  for (const subject of syllabus.subjects) {
    for (const chapter of syllabus.chaptersOf(subject.id)) {
      chapters += 1;
      if (chapter.topics.length > 0) opened += 1;
    }
  }
  return { chapters, opened };
}

/** True when the tally covers every chapter the learner's board holds. */
export function coversWholeSyllabus(reach: SyllabusReach | undefined): boolean {
  return reach === undefined || reach.chapters === 0 || reach.opened >= reach.chapters;
}

export interface Tally {
  total: number;
  learnt: number;
  debt: number;
  started: number;
  untouched: number;
}

export function tally(topics: readonly ProgressTopic[]): Tally {
  const out: Tally = { total: topics.length, learnt: 0, debt: 0, started: 0, untouched: 0 };
  for (const t of topics) out[t.state] += 1;
  return out;
}

export interface ChapterRow {
  id: string;
  name: string;
  subjectName: string;
  total: number;
  learnt: number;
  debt: number;
}

/** What was learnt, chapter by chapter — the row a parent reads first. Finished chapters lead. */
export function chapterRows(topics: readonly ProgressTopic[]): ChapterRow[] {
  const rows = new Map<string, ChapterRow>();
  const order: string[] = [];
  for (const t of topics) {
    let row = rows.get(t.chapterId);
    if (!row) {
      row = {
        id: t.chapterId,
        name: t.chapterName,
        subjectName: t.subjectName,
        total: 0,
        learnt: 0,
        debt: 0,
      };
      rows.set(t.chapterId, row);
      order.push(t.chapterId);
    }
    row.total += 1;
    if (t.state === 'learnt') row.learnt += 1;
    if (t.state === 'debt') row.debt += 1;
  }
  return order
    .map((id) => rows.get(id) as ChapterRow)
    .filter((r) => r.learnt > 0 || r.debt > 0)
    .sort((a, b) => b.learnt / b.total - a.learnt / a.total);
}

/** The topics the evidence has pulled back. Never a guess: `isDebt` is the only source. */
export function needsAnotherPass(topics: readonly ProgressTopic[]): ProgressTopic[] {
  return topics.filter((t) => t.state === 'debt');
}

/** What is coming: the next few not yet behind them, in the board's own order. */
export function comingUp(topics: readonly ProgressTopic[], limit = 4): ProgressTopic[] {
  return topics.filter((t) => t.state === 'started' || t.state === 'untouched').slice(0, limit);
}

// --- minutes -------------------------------------------------------------------------------------

const WEEKDAY_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface MinuteBar {
  /** The ISO day, or the month as YYYY-MM. */
  key: string;
  /** The axis mark under the bar — one character, or nothing where the axis would crowd. */
  label: string;
  /** What this bar says, in words, for the title and the reader who cannot see it. */
  full: string;
  minutes: number;
  /** A day (or month) that has not come yet. Drawn quiet, never as a zero. */
  future: boolean;
}

const minutesOf = (ledger: DayLedger | undefined): number =>
  Math.round(((ledger?.seconds ?? 0) as number) / 60);

function saidMinutes(n: number): string {
  if (n === 0) return 'nothing yet';
  return `${n} ${n === 1 ? 'minute' : 'minutes'}`;
}

/**
 * Minutes a day across the span — the bars the report draws. A week and a month count days; a
 * year counts months, because 365 bars on a phone is a smear rather than a chart.
 */
export function minuteBars(
  days: Readonly<Record<string, DayLedger>>,
  span: Span,
  now: Date = new Date(),
): MinuteBar[] {
  const { days: iso, todayIndex } = spanDays(now, span);
  const future = (i: number) => todayIndex >= 0 && i > todayIndex;
  if (span === 'year') {
    const byMonth = new Map<string, { minutes: number; future: boolean }>();
    iso.forEach((day, i) => {
      const key = day.slice(0, 7);
      const cur = byMonth.get(key) ?? { minutes: 0, future: true };
      byMonth.set(key, {
        minutes: cur.minutes + (future(i) ? 0 : minutesOf(days[day])),
        future: cur.future && future(i),
      });
    });
    return [...byMonth.entries()].map(([key, v]) => {
      const name = MONTH[Number(key.slice(5, 7)) - 1] ?? key;
      return {
        key,
        label: name.slice(0, 1),
        full: `${name} — ${v.future ? 'still to come' : saidMinutes(v.minutes)}`,
        minutes: v.minutes,
        future: v.future,
      };
    });
  }
  return iso.map((day, i) => {
    const d = new Date(`${day}T00:00:00Z`);
    const weekday = (d.getUTCDay() + 6) % 7;
    const dayNumber = d.getUTCDate();
    const month = MONTH[d.getUTCMonth()] ?? '';
    const minutes = future(i) ? 0 : minutesOf(days[day]);
    return {
      key: day,
      // A month's axis marks every seventh day; a week marks each one.
      label:
        span === 'week'
          ? (WEEKDAY_INITIAL[weekday] as string)
          : dayNumber === 1 || dayNumber % 7 === 0
            ? String(dayNumber)
            : '',
      full:
        span === 'week'
          ? `${WEEKDAY[weekday]} — ${future(i) ? 'still to come' : saidMinutes(minutes)}`
          : `${dayNumber} ${month} — ${future(i) ? 'still to come' : saidMinutes(minutes)}`,
      minutes,
      future: future(i),
    };
  });
}

/** The tallest bar the chart actually reaches — the one number the y-axis mark is allowed to name. */
export function peakMinutes(bars: readonly MinuteBar[]): number {
  return Math.max(0, ...bars.filter((b) => !b.future).map((b) => b.minutes));
}

/** Every minute in the span. */
export function totalMinutes(bars: readonly MinuteBar[]): number {
  return bars.reduce((sum, b) => sum + (b.future ? 0 : b.minutes), 0);
}

// --- what came back right, a week on ---------------------------------------------------------------------

/** An answer counts once this long has passed since the first one recorded on that concept. */
export const HELD_WINDOW_DAYS = 7;
/** Where "lately" ends and "before that" begins, for the one comparison this report makes. */
export const HELD_RECENT_DAYS = 30;
/** Below this many qualifying answers there is no percentage worth printing, so none is printed. */
export const MIN_HELD_ANSWERS = 4;

export interface Retention {
  held: number;
  total: number;
  percent: number;
}

export interface RetentionRead {
  /** The last thirty days, or null when the evidence is too thin to say anything. */
  recent: Retention | null;
  /** Everything before that, for the "up from" line — null unless it too is thick enough. */
  earlier: Retention | null;
}

function retention(held: number, total: number): Retention {
  return { held, total, percent: Math.round((held / total) * 100) };
}

/**
 * WHAT CAME BACK RIGHT A WEEK ON — and precisely that, which is less than it sounds.
 *
 * For each concept the evidence is ordered by its own stamps; an answer counts only if a week has
 * passed since the FIRST answer on that concept. So this is accuracy over the answers given from
 * day eight onward, and it is drawn under the label "Right a week on" for that reason.
 *
 * IT IS NOT RETENTION ACROSS A WEEK WITHOUT PRACTICE, and it was labelled as though it were. There
 * is no requirement of a GAP anywhere below: a learner who drills a concept every day has every
 * answer from day eight counted, which measures how well practice is going rather than what
 * survived a week of not practising. Measuring the stronger claim needs the gap in the evidence —
 * the first answer after a week of silence on that concept — and until something records that, this
 * module reports the weaker number under the weaker name rather than the stronger name under the
 * weaker number.
 *
 * Compounded by the evidence cap: the SDK keeps a bounded run per node, so "the first" is the
 * oldest surviving answer rather than the true first, which can only move the window later.
 *
 * The split at thirty days gives the one honest comparison the report makes, and either half
 * returns null unless it holds enough answers to mean something.
 */
export function heldLater(
  snapshot: MasterySnapshot | null,
  now: number = Date.now(),
): RetentionRead {
  let recentHeld = 0;
  let recentTotal = 0;
  let earlierHeld = 0;
  let earlierTotal = 0;
  const cut = now - HELD_RECENT_DAYS * DAY_MS;
  for (const record of Object.values(snapshot?.nodes ?? {})) {
    const points = (record?.evidence ?? [])
      .map((p) => ({ at: Date.parse(p.at), correct: p.correct === true }))
      .filter((p) => Number.isFinite(p.at) && p.at <= now)
      .sort((a, b) => a.at - b.at);
    const first = points[0];
    if (!first) continue;
    for (const p of points) {
      if (p.at - first.at < HELD_WINDOW_DAYS * DAY_MS) continue;
      if (p.at >= cut) {
        recentTotal += 1;
        if (p.correct) recentHeld += 1;
      } else {
        earlierTotal += 1;
        if (p.correct) earlierHeld += 1;
      }
    }
  }
  return {
    recent: recentTotal >= MIN_HELD_ANSWERS ? retention(recentHeld, recentTotal) : null,
    earlier: earlierTotal >= MIN_HELD_ANSWERS ? retention(earlierHeld, earlierTotal) : null,
  };
}

// --- the line to the finish ----------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "8 topics", "1 topic" — the copy law's pluralisation, which a template literal keeps forgetting. */
function topicsSaid(n: number): string {
  return `${n} ${plural(n, 'topic', 'topics')}`;
}

export type ProjectionKind = 'none' | 'building' | 'projected' | 'complete';

export interface Projection {
  kind: ProjectionKind;
  /** The sentence the report prints. Never a number the rest of this object does not hold. */
  line: string;
  learnt: number;
  total: number;
  activeDays: number;
  /** The first day with anything on it, in ms — the left end of the drawn line. */
  from?: number;
  /** The projected finish, in ms. Only ever set when `kind` is `projected`. */
  at?: number;
  /** That date, written the way the rest of the app writes dates. */
  dateLabel?: string;
  /** How much of the syllabus `total` covers, when the caller knows. */
  reach?: SyllabusReach;
  /** False when `total` is only the chapters opened so far — every surface has to say so. */
  wholeSyllabus: boolean;
}

function dateLabel(at: number): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${(MONTH[d.getUTCMonth()] ?? '').slice(0, 3)} ${d.getUTCFullYear()}`;
}

/**
 * Where this pace lands — a straight line, and said to be one wherever it is drawn.
 *
 * Topics learnt over the days actually active gives a rate per active day; the last week's cadence
 * turns the remaining active days into a calendar date. It is arithmetic on the learner's own
 * record, not a model of them, and it moves every time they do. With nothing learnt yet, or no day
 * to pace from, it refuses to draw a line and says why.
 *
 * TWO THINGS IT REFUSES TO SAY, both of them things it used to say.
 *
 *   1. "AT THIS PACE" WHEN THERE IS NO PACE. The cadence is active days in the last seven, floored
 *      at one — the floor is there so a learner who came back yesterday is not divided by zero. But
 *      the floor was applied to a count of ZERO as well, so a learner who had not opened the app
 *      since June still read "at this pace, all N topics are behind you by around <date>", drawn as
 *      a solid line. Their pace is nothing. The line is withheld and the sentence says what would
 *      bring it back.
 *   2. "ALL N TOPICS" WHEN N IS NOT ALL OF THEM. `total` counts the topics of chapters the learner
 *      has opened (see the note at the top of this file), so on a twelve-chapter syllabus with one
 *      chapter opened it is a handful, and the date it produced was a finish date for a syllabus
 *      nobody has. `reach` is how the caller says how much of the board that covers, and when it
 *      does not cover all of it the sentence names what it counted and says the rest is not in it.
 *      Without a `reach` the caller is asserting the total is the whole thing.
 */
export function projectFinish(
  learnt: number,
  total: number,
  activeDays: readonly string[],
  now: number = Date.now(),
  reach?: SyllabusReach,
): Projection {
  const sorted = [...new Set(activeDays)].sort();
  const whole = coversWholeSyllabus(reach);
  const base = {
    learnt,
    total,
    activeDays: sorted.length,
    wholeSyllabus: whole,
    ...(reach ? { reach } : {}),
  };
  /** "all 8 topics" when the tally is the whole board; "the 8 topics you have opened" when not. */
  const counted = whole ? `all ${topicsSaid(total)}` : `the ${topicsSaid(total)} you have opened`;
  /** The half-sentence that keeps a partial denominator from reading as a whole syllabus. */
  const rest = whole
    ? ''
    : ' Chapters you have not opened yet are not in this line, so it moves as you open them.';
  if (total <= 0)
    return {
      ...base,
      kind: 'none',
      line: 'Your syllabus lands here once a board and a class are set, and the line is drawn from it.',
    };
  if (learnt <= 0)
    return {
      ...base,
      kind: 'none',
      line: 'Learn one topic and a finish line appears here, drawn from your own pace and nothing else.',
    };
  if (learnt >= total)
    return {
      ...base,
      kind: 'complete',
      line: whole
        ? 'Every topic on this syllabus is behind you. The next one starts where this one ends.'
        : `Every topic you have opened is behind you. Open the next chapter and the line picks up from there.`,
    };
  if (sorted.length === 0)
    return {
      ...base,
      kind: 'building',
      line: `${learnt} of ${topicsSaid(total)} are behind you. Keep a rhythm and a finish date appears here.`,
    };
  const from = Date.parse(`${sorted[0]}T00:00:00Z`);
  const perActiveDay = learnt / sorted.length;
  const recentActive = sorted.filter((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return Number.isFinite(t) && now - t < 7 * DAY_MS;
  }).length;
  // Nothing in the last week is not a slow pace, it is no pace, and no arithmetic turns it into a
  // date. The line waits rather than inventing one.
  if (recentActive === 0)
    return {
      ...base,
      kind: 'building',
      line: `${learnt} of ${topicsSaid(total)} are behind you. There has been nothing this past week, so there is no pace to read; a few days back on it and the finish line returns.`,
    };
  const cadence = recentActive; // active days a week, and there is at least one
  const calendarDays = Math.ceil(((total - learnt) / perActiveDay) * (7 / cadence));
  const at = now + calendarDays * DAY_MS;
  const label = dateLabel(at);
  return {
    ...base,
    kind: 'projected',
    from: Number.isFinite(from) ? from : undefined,
    at,
    dateLabel: label,
    line: `At this pace, ${counted} are behind you by around ${label}.${rest}`,
  };
}

// --- the note ------------------------------------------------------------------------------------

function opening(n: number, one: string, many: string): string {
  const said = `${word(n)} ${plural(n, one, many)}`;
  return `${said.slice(0, 1).toUpperCase()}${said.slice(1)}`;
}

/**
 * The line at the foot of the report, in Wobo's hand — the site's own sentence
 * (design/prototypes/landing-v8.html, the parents section) with this learner's numbers in it and
 * nobody's name in it. A span with nothing in it says so instead of inventing a good week.
 */
export function reportNote(s: WeekSummary): Segment[] {
  if (s.showedUp === 0)
    return [{ text: 'A quiet stretch. Nothing here was missed that cannot be picked up.' }];
  const head =
    s.entered > 0
      ? `${opening(s.entered, 'lesson', 'lessons')} and ${word(s.answered)} ${plural(s.answered, 'problem', 'problems')}`
      : `${opening(s.answered, 'problem', 'problems')}`;
  if (s.helped > 0)
    return [
      { text: `${head}, and help was asked for ${times(s.helped)} after a miss, ` },
      { text: 'which is exactly how learning looks.', em: true },
    ];
  return [
    {
      text: `${head}, across ${word(s.showedUp)} ${plural(s.showedUp, 'day', 'days')} of showing up.`,
    },
  ];
}
