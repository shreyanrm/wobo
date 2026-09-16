/**
 * The activity desk's honesty, held to the rules every desk is held to.
 *
 *   1. "We could not ask" is never rendered as "nobody came". A failed or unreadable read is an
 *      absence that says so, and no figure at all.
 *   2. Every number is the server's: the census and the per-step counts are printed, never summed.
 *   3. One learner's page is four facts. Nothing on it can carry what the record holds for the
 *      learner's own mail — no title, no moment, no hour — because the type has no field for it.
 */

import { describe, expect, it } from 'bun:test';
import {
  type ActivityDesk,
  activityPanels,
  awayWords,
  floorWords,
  isActivityDesk,
  isLearnerActivity,
  type LearnerActivity,
  learnerPanels,
  spanWords,
} from './activity';
import { ENDPOINT } from './contract';
import { DESKS, desk } from './desks';

const AT = '2026-09-21T12:00:00.000Z';

const STEPS = [
  {
    id: 'full',
    label: 'The full cadence: at least three a week',
    mails: 3,
    per_days: 7,
    since: 0,
    through: 14,
  },
  { id: 'two_a_week', label: 'Two a week', mails: 2, per_days: 7, since: 15, through: 30 },
  { id: 'one_a_week', label: 'One a week', mails: 1, per_days: 7, since: 31, through: 60 },
  {
    id: 'one_a_fortnight',
    label: 'One a fortnight',
    mails: 1,
    per_days: 14,
    since: 61,
    through: 90,
  },
  {
    id: 'one_a_month',
    label: 'One a month, for as long as the address is reachable',
    mails: 1,
    per_days: 30,
    since: 91,
    through: null,
  },
];

function reading(over: Partial<ActivityDesk> = {}, learners: (number | null)[] = [2, 1, 1, 0, 1]) {
  return {
    readable: true,
    census: { learners: 5, today: 1, week: 2, month: 3 },
    ladder: {
      bounds: [14, 30, 60, 90],
      source: 'default' as const,
      steps: STEPS.map((step, i) => ({ ...step, learners: learners[i] ?? null })),
    },
    feed: { what: 'When each learner last came.', from: 'learner.activity (migration 0034)' },
    at: AT,
    ...over,
  };
}

const FOUND: LearnerActivity = {
  found: true,
  learner_id: '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  last_came_at: '2026-09-21T12:15:00+00:00',
  last_came_on: '2026-09-21',
  timezone: 'Asia/Kolkata',
  days_away: 0,
  days_active_this_month: 5,
  streak_days: 4,
  step: { id: 'full', label: 'The full cadence: at least three a week', mails: 3, per_days: 7 },
};

describe('the desk is on the console, and so is its door', () => {
  it('is a live desk with a source an engineer can chase', () => {
    const found = desk('activity');
    expect(found.supply.kind).toBe('live');
    expect(DESKS.map((d) => d.id)).toContain('activity');
    if (found.supply.kind === 'live') expect(found.supply.from).toContain('learner.activity');
  });

  it('reads the two gateway routes the desk and the lookup are served from', () => {
    expect(ENDPOINT.activity).toBe('/v1/admin/activity');
    expect(ENDPOINT.learnerActivity).toBe('/v1/admin/learners/activity');
  });
});

describe('the shape is checked before a number is shown', () => {
  it('takes the gateway’s answer', () => {
    expect(isActivityDesk(reading())).toBe(true);
    expect(
      isActivityDesk(reading({ readable: false, census: null }, [null, null, null, null, null])),
    ).toBe(true);
  });

  it('refuses a readable desk with no census, a census on an unreadable one, and nonsense', () => {
    expect(isActivityDesk(reading({ census: null }))).toBe(false);
    expect(isActivityDesk(reading({ readable: false }))).toBe(false);
    expect(
      isActivityDesk({ ...reading(), census: { learners: -1, today: 0, week: 0, month: 0 } }),
    ).toBe(false);
    expect(isActivityDesk({ ...reading(), ladder: { ...reading().ladder, source: 'guess' } })).toBe(
      false,
    );
    expect(isActivityDesk(null)).toBe(false);
    expect(isActivityDesk([])).toBe(false);
  });

  it('takes a learner page, found or not, and nothing else', () => {
    expect(isLearnerActivity(FOUND)).toBe(true);
    expect(isLearnerActivity({ found: false, learner_id: 'x' })).toBe(true);
    expect(isLearnerActivity({ ...FOUND, streak_days: 'four' })).toBe(false);
    expect(isLearnerActivity({ found: 'yes', learner_id: 'x' })).toBe(false);
  });
});

describe('could not ask is not nobody came', () => {
  it('a failed read is an absence with no figure', () => {
    const panels = activityPanels(null, AT);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.kind).toBe('absent');
  });

  it('an unreadable record shows no census and no step count', () => {
    const panels = activityPanels(
      reading({ readable: false, census: null }, [null, null, null, null, null]),
      AT,
    );
    expect(panels.some((p) => p.kind === 'figure')).toBe(false);
    expect(panels[0]?.kind).toBe('absent');
    const ladder = panels.find((p) => p.id === 'activity-ladder');
    expect(ladder?.kind).toBe('rows');
    if (ladder?.kind === 'rows') {
      expect(ladder.rows.every((row) => row.cells[3] === '—' && row.tone === 'unknown')).toBe(true);
    }
  });
});

describe('every number is the server’s', () => {
  it('prints the census and each step as counted', () => {
    const panels = activityPanels(reading(), AT);
    const figures = Object.fromEntries(
      panels.flatMap((p) => (p.kind === 'figure' ? [[p.id, p.value]] : [])),
    );
    expect(figures).toEqual({
      'activity-today': '1',
      'activity-week': '2',
      'activity-month': '3',
      'activity-learners': '5',
    });
    const ladder = panels.find((p) => p.id === 'activity-ladder');
    if (ladder?.kind !== 'rows') throw new Error('the ladder is rows');
    expect(ladder.columns).toEqual(['Step', 'Days away', 'At least', 'Learners']);
    expect(ladder.rows.map((r) => r.cells)).toEqual([
      ['The full cadence: at least three a week', 'up to day 14', 'at least 3 in 7 days', '2'],
      ['Two a week', 'days 15 to 30', '2 in 7 days', '1'],
      ['One a week', 'days 31 to 60', '1 in 7 days', '1'],
      ['One a fortnight', 'days 61 to 90', '1 in 14 days', '0'],
      ['One a month, for as long as the address is reachable', 'day 91 on', '1 in 30 days', '1'],
    ]);
    // every sourced panel says where it came from
    for (const panel of panels) {
      if (panel.kind !== 'absent') expect(panel.provenance.source).toContain('/v1/admin/activity');
    }
  });

  it('says whether the ladder is the dial or the owner’s default', () => {
    const dial = activityPanels(
      reading({ ladder: { ...reading().ladder, bounds: [7, 21, 45, 75], source: 'dial' } }),
      AT,
    ).find((p) => p.id === 'activity-ladder');
    expect(dial?.kind === 'rows' && dial.provenance.caveat).toContain(
      'mail.ladder) is set: 7, 21, 45, 75',
    );
    const fallback = activityPanels(reading(), AT).find((p) => p.id === 'activity-ladder');
    expect(fallback?.kind === 'rows' && fallback.provenance.caveat).toContain('default ladder');
  });
});

describe('one learner is four facts', () => {
  it('last came, days this month, streak, mail step', () => {
    const panels = learnerPanels(FOUND, AT);
    expect(panels.map((p) => p.label)).toEqual([
      'Last came',
      'Days active this month',
      'Streak',
      'Mail step',
    ]);
    const values = panels.map((p) => (p.kind === 'figure' ? p.value : ''));
    expect(values).toEqual(['today', '5', '4 days', 'The full cadence: at least three a week']);
    for (const panel of panels) {
      if (panel.kind !== 'absent') expect(panel.provenance.source).toContain('audited');
    }
  });

  it('a learner with no record is said to have none', () => {
    const panels = learnerPanels({ found: false, learner_id: 'abc' }, AT);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.kind).toBe('absent');
  });

  it('carries nothing a mail is made of', () => {
    const text = JSON.stringify(learnerPanels(FOUND, AT));
    for (const word of ['moment', 'progress', 'hours', 'title', 'chapter']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('writes time away the way a person says it', () => {
    expect(awayWords(0)).toBe('today');
    expect(awayWords(1)).toBe('yesterday');
    expect(awayWords(45)).toBe('45 days ago');
    expect(spanWords({ since: 0, through: 14 })).toBe('up to day 14');
    expect(floorWords({ mails: 1, per_days: 30 })).toBe('1 in 30 days');
  });
});
