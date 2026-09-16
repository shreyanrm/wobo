/**
 * The activity desk, as pure functions from one gateway reading to its panels.
 *
 * `GET /v1/admin/activity` (services/gateway `activity.py`) counts, on each learner's own
 * calendar, how many came today, in the last seven days and in the last thirty, and how many sit
 * on each step of the mail ladder (docs/EMAILS-AND-ANIMATIONS.md, "The weekly cadence"). The
 * gateway has already counted; this file formats and never sums.
 *
 * `GET /v1/admin/learners/activity?id=` is one learner's page: when they last came, the days
 * they came this month, their streak and the mail step they sit on. It needs `learner.read`, and
 * every look is its own line in the audit trail. It never carries what the record holds for the
 * learner's own mail — no title, no moment, no hour — and this file has no field that could.
 *
 * THE THREE STATES OF A READ, kept apart as every desk keeps them: a read that failed is an
 * absence that says so, a readable desk with nobody on it is zeroes the server counted, and a
 * number is never invented for either.
 */

import { asOf, count, type Panel, type Tone } from './panels';

export interface LadderStep {
  readonly id: string;
  readonly label: string;
  readonly mails: number;
  readonly per_days: number;
  readonly since: number;
  readonly through: number | null;
  /** `null` when the record could not be read. Never a zero standing in for "unknown". */
  readonly learners: number | null;
}

export interface ActivityDesk {
  readonly readable: boolean;
  readonly census: {
    readonly learners: number;
    readonly today: number;
    readonly week: number;
    readonly month: number;
  } | null;
  readonly ladder: {
    readonly bounds: readonly number[];
    readonly source: 'dial' | 'default';
    readonly steps: readonly LadderStep[];
  };
  readonly feed: { readonly what: string; readonly from: string };
  readonly at: string;
}

export interface LearnerStep {
  readonly id: string;
  readonly label: string;
  readonly mails: number;
  readonly per_days: number;
}

export type LearnerActivity =
  | { readonly found: false; readonly learner_id: string }
  | {
      readonly found: true;
      readonly learner_id: string;
      readonly last_came_at: string;
      readonly last_came_on: string;
      readonly timezone: string;
      readonly days_away: number;
      readonly days_active_this_month: number;
      readonly streak_days: number;
      readonly step: LearnerStep;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isStep(value: unknown): value is LadderStep {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    isCount(value.mails) &&
    isCount(value.per_days) &&
    isCount(value.since) &&
    (value.through === null || isCount(value.through)) &&
    (value.learners === null || isCount(value.learners))
  );
}

export function isActivityDesk(body: unknown): body is ActivityDesk {
  if (!isRecord(body) || typeof body.readable !== 'boolean' || typeof body.at !== 'string') {
    return false;
  }
  const census = body.census;
  if (census !== null) {
    if (!isRecord(census)) return false;
    if (!['learners', 'today', 'week', 'month'].every((k) => isCount(census[k]))) return false;
  }
  if (body.readable !== (census !== null)) return false;
  const ladder = body.ladder;
  if (!isRecord(ladder) || !Array.isArray(ladder.steps) || !Array.isArray(ladder.bounds)) {
    return false;
  }
  if (ladder.source !== 'dial' && ladder.source !== 'default') return false;
  if (!ladder.bounds.every(isCount) || !ladder.steps.every(isStep)) return false;
  const feed = body.feed;
  return isRecord(feed) && typeof feed.what === 'string' && typeof feed.from === 'string';
}

export function isLearnerActivity(body: unknown): body is LearnerActivity {
  if (!isRecord(body) || typeof body.learner_id !== 'string') return false;
  if (body.found === false) return true;
  if (body.found !== true) return false;
  const step = body.step;
  return (
    typeof body.last_came_at === 'string' &&
    typeof body.last_came_on === 'string' &&
    typeof body.timezone === 'string' &&
    isCount(body.days_away) &&
    isCount(body.days_active_this_month) &&
    isCount(body.streak_days) &&
    isRecord(step) &&
    typeof step.id === 'string' &&
    typeof step.label === 'string' &&
    isCount(step.mails) &&
    isCount(step.per_days)
  );
}

/** "Days 15 to 30", "Day 91 on", in the words an operator reads. */
export function spanWords(step: Pick<LadderStep, 'since' | 'through'>): string {
  if (step.through === null) return `day ${step.since} on`;
  if (step.since === 0) return `up to day ${step.through}`;
  return `days ${step.since} to ${step.through}`;
}

/** "at least 3 in 7 days", "1 in 30 days". */
export function floorWords(step: Pick<LadderStep, 'mails' | 'per_days'>): string {
  if (step.mails >= 3) return `at least ${step.mails} in ${step.per_days} days`;
  return `${step.mails} in ${step.per_days} days`;
}

/** How long ago, on the learner's calendar. */
export function awayWords(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${count(days)} days ago`;
}

const SOURCE = 'GET /v1/admin/activity · learner.activity (0034)';
const CAVEAT =
  'Counted on each learner’s own calendar. A learner is on the record from their first signed-in ' +
  'visit after this migration; nobody before it is counted.';

export function activityPanels(desk: ActivityDesk | null, at: string | null): Panel[] {
  if (!desk) {
    return [
      {
        kind: 'absent',
        id: 'activity-unread',
        label: 'Activity',
        because: 'The activity desk did not answer, so there is nothing to count from here.',
        wouldFill: 'The gateway answering GET /v1/admin/activity.',
      },
    ];
  }
  const provenance = { source: SOURCE, at: desk.at || at, caveat: CAVEAT };
  const ladderSource =
    desk.ladder.source === 'dial'
      ? `The ladder dial (mail.ladder) is set: ${desk.ladder.bounds.join(', ')}.`
      : `The owner’s default ladder: ${desk.ladder.bounds.join(', ')}. The dial is mail.ladder.`;
  const panels: Panel[] = [];
  if (!desk.readable || !desk.census) {
    panels.push({
      kind: 'absent',
      id: 'activity-unreadable',
      label: 'Who came, and when',
      because:
        'The gateway answered but could not read learner.activity, so these counts are not ' +
        'zeroes, they are unknown.',
      wouldFill: 'The project answering, with migration 0034 applied.',
    });
  } else {
    const census = desk.census;
    const tone: Tone = census.learners === 0 ? 'plain' : 'ok';
    panels.push(
      {
        kind: 'figure',
        id: 'activity-today',
        label: 'Came today',
        value: count(census.today),
        tone,
        provenance,
      },
      {
        kind: 'figure',
        id: 'activity-week',
        label: 'Came in the last 7 days',
        value: count(census.week),
        tone,
        provenance,
      },
      {
        kind: 'figure',
        id: 'activity-month',
        label: 'Came in the last 30 days',
        value: count(census.month),
        tone,
        provenance,
      },
      {
        kind: 'figure',
        id: 'activity-learners',
        label: 'On the record',
        value: count(census.learners),
        note: 'Every learner who has come since the record began, however long ago.',
        tone: 'plain',
        provenance,
      },
    );
  }
  panels.push({
    kind: 'rows',
    id: 'activity-ladder',
    label: 'The mail ladder',
    columns: ['Step', 'Days away', 'At least', 'Learners'],
    rows: desk.ladder.steps.map((step) => ({
      id: step.id,
      cells: [
        step.label,
        spanWords(step),
        floorWords(step),
        step.learners === null ? '—' : count(step.learners),
      ],
      tone: step.learners === null ? ('unknown' as Tone) : ('plain' as Tone),
    })),
    provenance: { ...provenance, caveat: `${ladderSource} ${CAVEAT}` },
  });
  return panels;
}

/** One learner's four facts, or the plain statement that there is no record of them. */
export function learnerPanels(view: LearnerActivity, at: string | null): Panel[] {
  const provenance = {
    source: 'GET /v1/admin/learners/activity · learner.activity (0034) · this look is audited',
    at,
  };
  if (!view.found) {
    return [
      {
        kind: 'absent',
        id: 'learner-activity-none',
        label: 'No record',
        because: `There is no visit on the record for ${view.learner_id}.`,
        wouldFill: 'That learner signing in and using the app after migration 0034 is applied.',
      },
    ];
  }
  return [
    {
      kind: 'figure',
      id: 'learner-last-came',
      label: 'Last came',
      value: awayWords(view.days_away),
      note: `${view.last_came_on} on their calendar (${view.timezone})`,
      tone: view.days_away > 30 ? 'warn' : 'plain',
      provenance,
    },
    {
      kind: 'figure',
      id: 'learner-days-this-month',
      label: 'Days active this month',
      value: count(view.days_active_this_month),
      tone: 'plain',
      provenance,
    },
    {
      kind: 'figure',
      id: 'learner-streak',
      label: 'Streak',
      value: view.streak_days === 1 ? '1 day' : `${count(view.streak_days)} days`,
      tone: 'plain',
      provenance,
    },
    {
      kind: 'figure',
      id: 'learner-mail-step',
      label: 'Mail step',
      value: view.step.label,
      note: floorWords(view.step),
      tone: 'plain',
      provenance,
    },
  ];
}

/** The line under the lookup, in the words `asOf` uses for every other panel. */
export function lookedAt(at: string | null): string {
  return asOf(at);
}
