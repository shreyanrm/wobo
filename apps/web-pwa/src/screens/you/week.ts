/**
 * The week, in Wobo's words — the numbers behind the You screen and the parent's view of it.
 *
 * Everything here is a pure function of what the device actually recorded: the activity marks, the
 * awards per day, the mind's day ledger (answers, misses, lines to Wobo, lessons opened, seconds,
 * evenings) and the course map. No sentence claims a number the ledger does not hold, and a span
 * with nothing in it says so rather than inventing a good week.
 *
 * The sentence shapes are the prototype's (design/prototypes/app-v1.html, board 05), with the
 * learner's own numbers in them. Unit-tested in `week.test.ts`.
 */

import type { DayLedger } from '../../store/mind';

export type Span = 'week' | 'month' | 'year';

export interface WeekTopic {
  id: string;
  name: string;
  chapterId: string;
  /** The subject's name, for the parent's view. */
  subject: string;
}

export interface WeekInput {
  now: Date;
  span: Span;
  /** ISO days with at least one session (the activity marks). */
  marks: readonly string[];
  /** Awards per ISO day — the older activity counter. */
  counts: Readonly<Record<string, number>>;
  /** The mind's day ledger. */
  days: Readonly<Record<string, DayLedger>>;
  /** The course map, in syllabus order. */
  topics: readonly WeekTopic[];
  /** Furthest fraction reached inside each topic. */
  topicProgress: Readonly<Record<string, number>>;
  completed: ReadonlySet<string>;
}

export interface Bar {
  /** The ISO day, or the month as YYYY-MM. */
  key: string;
  value: number;
  /** A day (or month) that has not come yet — drawn as the quiet bar. */
  future: boolean;
}

export type LessonState = 'in progress' | 'mastered' | 'next';

export interface LessonRow {
  id: string;
  name: string;
  subject: string;
  state: LessonState;
}

export interface WeekSummary {
  span: Span;
  /** "This week, in Wobo's words" */
  tag: string;
  /** Days that had a session in the span. */
  showedUp: number;
  /** Past days in the span, today included. */
  pastDays: number;
  asked: number;
  answered: number;
  wrong: number;
  helped: number;
  kept: number;
  entered: number;
  evenings: number;
  /** Days with ten minutes or more on the app. */
  tenMinuteDays: number;
  bars: Bar[];
  inProgress: { name: string; fraction: number } | null;
  waiting: { name: string } | null;
  lessons: LessonRow[];
}

const DAY_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The ISO days of the span, oldest first, with today's index — the calendar week, month or year. */
export function spanDays(now: Date, span: Span): { days: string[]; todayIndex: number } {
  const today = iso(now);
  if (span === 'week') {
    // Monday to Sunday, the way the prototype draws it: five bars behind, two ahead.
    const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(now.getTime() - dow * DAY_MS);
    const days = Array.from({ length: 7 }, (_, i) => iso(new Date(start.getTime() + i * DAY_MS)));
    return { days, todayIndex: days.indexOf(today) };
  }
  if (span === 'month') {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const days = Array.from({ length: n }, (_, i) => iso(new Date(Date.UTC(y, m, i + 1))));
    return { days, todayIndex: days.indexOf(today) };
  }
  const y = now.getUTCFullYear();
  const days: string[] = [];
  for (let m = 0; m < 12; m += 1) {
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= n; d += 1) days.push(iso(new Date(Date.UTC(y, m, d))));
  }
  return { days, todayIndex: days.indexOf(today) };
}

const TAG: Record<Span, string> = {
  week: "This week, in Wobo's words",
  month: "This month, in Wobo's words",
  year: "This year, in Wobo's words",
};

const BLANK: DayLedger = {
  answered: 0,
  wrong: 0,
  asked: 0,
  helped: 0,
  kept: 0,
  entered: 0,
  seconds: 0,
  evening: false,
};

/** Every number the span holds. */
export function summarise(input: WeekInput): WeekSummary {
  const { days, todayIndex } = spanDays(input.now, input.span);
  const past = todayIndex >= 0 ? days.slice(0, todayIndex + 1) : days;
  const marks = new Set(input.marks);
  const totals = { ...BLANK };
  let showedUp = 0;
  let evenings = 0;
  let tenMinuteDays = 0;
  const value = (day: string): number => {
    const l = input.days[day] ?? BLANK;
    const v = (input.counts[day] ?? 0) + l.asked + l.answered + l.entered;
    return v === 0 && marks.has(day) ? 1 : v;
  };
  for (const day of past) {
    const l = input.days[day] ?? BLANK;
    if (marks.has(day) || value(day) > 0) showedUp += 1;
    if (l.evening) evenings += 1;
    if (l.seconds >= 600) tenMinuteDays += 1;
    totals.answered += l.answered;
    totals.wrong += l.wrong;
    totals.asked += l.asked;
    totals.helped += l.helped;
    totals.kept += l.kept;
    totals.entered += l.entered;
  }

  // The bars: one per day for a week or a month, one per month for a year.
  let bars: Bar[];
  if (input.span === 'year') {
    const byMonth = new Map<string, { value: number; future: boolean }>();
    days.forEach((day, i) => {
      const key = day.slice(0, 7);
      const cur = byMonth.get(key) ?? { value: 0, future: true };
      const future = todayIndex >= 0 && i > todayIndex;
      byMonth.set(key, {
        value: cur.value + (future ? 0 : value(day)),
        future: cur.future && future,
      });
    });
    bars = [...byMonth.entries()].map(([key, v]) => ({ key, ...v }));
  } else {
    bars = days.map((day, i) => ({
      key: day,
      value: todayIndex >= 0 && i > todayIndex ? 0 : value(day),
      future: todayIndex >= 0 && i > todayIndex,
    }));
  }

  // The course map: the furthest topic still open, and the one after it.
  const open = input.topics
    .filter((t) => !input.completed.has(t.id))
    .map((t) => ({ t, f: input.topicProgress[t.id] ?? 0 }))
    .filter((x) => x.f > 0 && x.f < 1)
    .sort((a, b) => b.f - a.f);
  const lead = open[0] ?? null;
  let waiting: WeekTopic | null = null;
  if (lead) {
    const after = input.topics.slice(input.topics.findIndex((t) => t.id === lead.t.id) + 1);
    waiting =
      after.find((t) => !input.completed.has(t.id) && !(input.topicProgress[t.id] ?? 0)) ?? null;
  } else {
    waiting = input.topics.find((t) => !input.completed.has(t.id)) ?? null;
  }

  const lessons: LessonRow[] = [];
  for (const { t } of open.slice(0, 2)) {
    lessons.push({ id: t.id, name: t.name, subject: t.subject, state: 'in progress' });
  }
  for (const t of [...input.topics].reverse()) {
    if (lessons.length >= 4) break;
    if (input.completed.has(t.id))
      lessons.push({ id: t.id, name: t.name, subject: t.subject, state: 'mastered' });
  }
  if (waiting)
    lessons.push({ id: waiting.id, name: waiting.name, subject: waiting.subject, state: 'next' });

  return {
    span: input.span,
    tag: TAG[input.span],
    showedUp,
    pastDays: past.length,
    asked: totals.asked,
    answered: totals.answered,
    wrong: totals.wrong,
    helped: totals.helped,
    kept: totals.kept,
    entered: totals.entered,
    evenings,
    tenMinuteDays,
    bars,
    inProgress: lead ? { name: lead.t.name, fraction: lead.f } : null,
    waiting: waiting ? { name: waiting.name } : null,
    lessons,
  };
}

/** The height of a bar, as the prototype draws it: a quiet 20% for a day still to come. */
export function barHeight(bar: Bar, bars: readonly Bar[]): number {
  if (bar.future) return 20;
  const max = Math.max(0, ...bars.filter((b) => !b.future).map((b) => b.value));
  if (max === 0 || bar.value === 0) return 8;
  return Math.max(8, Math.round((bar.value / max) * 100));
}

// --- the words ------------------------------------------------------------------------------------

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
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** A number the way Wobo writes it in a sentence: words to twenty, digits after. */
export function word(n: number): string {
  return SMALL[n] ?? String(n);
}

/** "once", "twice", "three times". */
export function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${word(n)} times`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * "is" or "are" for a topic's name — "Triangles are half done", "Sound is waiting". Only a
 * one-word plural takes "are"; a longer title ("Understanding quadrilaterals") reads as one thing.
 */
export function verbFor(name: string): 'is' | 'are' {
  const words = name.trim().split(/\s+/);
  return words.length === 1 && /[^s]s$/i.test(words[0] ?? '') ? 'are' : 'is';
}

function stage(fraction: number): string {
  if (fraction >= 0.85) return 'nearly done';
  if (fraction >= 0.35) return 'half done';
  return 'just started';
}

export interface Segment {
  text: string;
  /** The line worth underlining — set in coral. */
  em?: boolean;
}

/** The line at the top of the You screen. Every number is the ledger's. */
export function weekSentence(s: WeekSummary): Segment[] {
  if (s.showedUp === 0) return [{ text: 'Rest is part of learning. Quiet days are allowed.' }];
  const out: Segment[] = [];
  const days = `You showed up ${word(s.showedUp)} ${plural(s.showedUp, 'day', 'days')}`;
  if (s.asked > 0) {
    out.push({
      text: `${days} and asked me ${word(s.asked)} ${plural(s.asked, 'question', 'questions')}, `,
    });
    out.push({
      text: "which tells me you're working through problems instead of skipping them.",
      em: true,
    });
  } else {
    out.push({ text: `${days}.` });
  }
  if (s.inProgress) {
    out.push({
      text: ` ${s.inProgress.name} ${verbFor(s.inProgress.name)} ${stage(s.inProgress.fraction)}.`,
    });
  }
  if (s.waiting) out.push({ text: ` ${s.waiting.name} ${verbFor(s.waiting.name)} waiting.` });
  return out;
}

export type StrengthId = 'resilience' | 'initiative' | 'consistency';

export interface Strength {
  id: StrengthId;
  title: string;
  line: string;
}

const SPAN_WORD: Record<Span, string> = {
  week: 'this week',
  month: 'this month',
  year: 'this year',
};

/**
 * Behaviour-based praise, only where the ledger holds the behaviour. An empty list means Wobo has
 * not seen enough yet, and the screen says that in the existing line rather than inventing praise.
 */
export function strengths(s: WeekSummary): Strength[] {
  const out: Strength[] = [];
  if (s.helped > 0) {
    const kept =
      s.kept >= s.helped
        ? s.helped === 1
          ? ' Kept going.'
          : ` Kept going ${s.helped === 2 ? 'both' : 'every'} times.`
        : s.kept > 0
          ? ` Kept going ${word(s.kept)} of those times.`
          : '';
    out.push({
      id: 'resilience',
      title: 'Resilience',
      line: `Asked for help after a wrong answer, ${times(s.helped)}.${kept}`,
    });
  }
  if (s.evenings > 0) {
    out.push({
      id: 'initiative',
      title: 'Initiative',
      line: `Opened Wobo on your own ${word(s.evenings)} ${plural(s.evenings, 'evening', 'evenings')} ${SPAN_WORD[s.span]}.`,
    });
  }
  if (s.tenMinuteDays > 0) {
    const most = s.pastDays >= 3 && s.tenMinuteDays * 2 >= s.pastDays;
    out.push({
      id: 'consistency',
      title: 'Consistency',
      line: most
        ? 'Ten minutes a day, most days. That is the whole trick.'
        : `Ten minutes a day, ${word(s.tenMinuteDays)} ${plural(s.tenMinuteDays, 'day', 'days')}. That is the whole trick.`,
    });
  }
  return out;
}

/** The Sunday note, as the parent reads it. The shape is the site's; the numbers are the week's. */
export function sundayNote(s: WeekSummary, name: string): Segment[] {
  if (s.showedUp === 0) return [{ text: 'Rest is part of learning. Quiet days are allowed.' }];
  const who = name.trim() || 'They';
  const lessons = `${word(s.entered)} ${plural(s.entered, 'lesson', 'lessons')}`;
  const problems = `${word(s.answered)} ${plural(s.answered, 'problem', 'problems')}`;
  const head = `${lessons[0]?.toUpperCase() ?? ''}${lessons.slice(1)}, ${problems}`;
  if (s.helped > 0) {
    return [
      { text: `${head}, and ${who} asked for help ${times(s.helped)} after a miss, ` },
      { text: 'which is exactly how learning looks.', em: true },
    ];
  }
  return [
    {
      text: `${head}, and ${who} showed up ${word(s.showedUp)} ${plural(s.showedUp, 'day', 'days')}.`,
    },
  ];
}
