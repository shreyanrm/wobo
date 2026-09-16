/**
 * A seat without the money panel reads the models and syllabus desks with no money on them.
 *
 * The gateway now strips every money-named key from an admin answer when the seat does not hold
 * `panel.money.read` (`console_panels.without_money`, installed on every admin route). These desks
 * used to assume the figures were there: `isModelsDesk` demanded the creative pool's cap, and the
 * syllabus desk read `desk.cost.length` and the day's ceiling. So the seat the law protects got a
 * broken desk instead of a quieter one. And a missing job cost must not read as "not priced":
 * that sentence says nothing could price it, which is false when the figure was only withheld.
 */

import { describe, expect, it } from 'bun:test';
import type { SyllabusDesk } from './contract';
import { isModelsDesk, type ModelsDesk, routerPanels } from './models';
import { isSyllabusDesk, syllabusPanels } from './syllabus';

const AT = '2026-09-17T09:00:00.000Z';

/** The same rule the gateway applies (services/gateway/src/wobo_gateway/console_panels.py). */
const MONEY = /usd|paise|inr|rupee|price|cost|spend|spent|ceiling|saved|per_million/i;
function stripMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const carried = entries.some(([key]) => MONEY.test(key));
    return Object.fromEntries(
      entries
        .filter(([key]) => !MONEY.test(key) && !(carried && /fraction/i.test(key)))
        .map(([key, inner]) => [key, stripMoney(inner)]),
    );
  }
  return value;
}

const totals = { calls: 4, cost_usd: 0.12, unpriced_calls: 0, cache_hits: 1 };

const MODELS = {
  readable: true,
  since: '2026-08-18',
  until: '2026-09-17',
  tiers: [
    {
      tier: 'turn',
      jobs: ['doubt.answer'],
      platform_paid_jobs: [],
      primary: 'house/turn-model',
      fallbacks: ['house/second-model'],
      chain: ['house/turn-model', 'house/second-model'],
      price: {
        per_million_in: 2,
        per_million_out: 12,
        page: 'https://example.com',
        note: '',
      },
      carrying: 'house/turn-model',
      source: 'default',
      desk_value: null,
      desk_chain: null,
      spend_today: totals,
      spend_yesterday: totals,
    },
  ],
  ladder: {
    rungs: ['house/tiny-model'],
    source: 'default',
    since: '2026-09-10',
    reached: [{ model: 'house/tiny-model', ...totals }],
    judge_pass_rate: null,
    judge_not_known: 'Nobody counts this yet.',
  },
  creative_pool: {
    cap_usd: 40,
    spent_today_usd: 3.5,
    created_today: 7,
    cache_hit_rate: 0.5,
    fraction: 0.0875,
    alert_fractions: [0.5, 0.8, 1],
    capabilities: ['create.core'],
  },
  spend: {
    by_tier: { turn: totals },
    by_model: { 'house/turn-model': totals },
    by_capability: { 'doubt.answer': totals },
    by_payer: { learner: totals },
    window: null,
    live_ceiling: { spent_usd: 1, ceiling_usd: 25 },
    ceiling_usd: 25,
  },
  catalogue: {
    'house/turn-model': {
      per_million_in: 2,
      per_million_out: 12,
      page: '',
      note: '',
    },
  },
  dials: { applied_at: AT, refresh_interval_s: 30, rejected: {} },
  reconcile: 'The provider dashboards remain the authority for the bill.',
} as unknown as ModelsDesk;

const REFUSED_JOB = {
  job_id: 'j1',
  framework_id: 'upmsp',
  framework_name: 'Uttar Pradesh board',
  level: 'Class 10',
  subject: 'Mathematics',
  state: 'refused',
  message: 'I could not find an official syllabus for that.',
  reason: 'not_found',
  reason_plain: 'nothing official was found for it',
  attempts: 1,
  waiting_on: 'the prewarm',
  cost_usd: 0.04,
  detail: null,
  tried: [],
  created_at: AT,
  updated_at: AT,
};

const SYLLABUS = {
  readable: true,
  worker: { enabled: true, env: 'WOBO_DISCOVERY_WORKER', interval_s: 30 },
  prewarm: { enabled: false, order: [], next: [] },
  boards: [],
  queue: [],
  landed: [],
  refused: [REFUSED_JOB],
  cost: [
    {
      framework_id: 'upmsp',
      framework_name: 'Uttar Pradesh board',
      jobs: 1,
      usd: 0.04,
      unpriced: 0,
    },
  ],
  day: {
    spent_usd: 0.42,
    ceiling_usd: 25,
    fraction: 0.0168,
    lane: 'stranger',
    shedding: false,
  },
} as unknown as SyllabusDesk;

const text = (value: unknown) => JSON.stringify(value);

describe('the models desk without the money panel', () => {
  const hidden = stripMoney(MODELS);

  it('is still a models desk', () => {
    expect(isModelsDesk(MODELS)).toBe(true);
    expect(isModelsDesk(hidden)).toBe(true);
  });

  it('draws the routing and no money', () => {
    const panels = routerPanels(hidden as ModelsDesk, AT);
    const drawn = text(panels);
    expect(drawn).toContain('house/turn-model');
    expect(drawn).toContain('router-table');
    expect(drawn).not.toContain('$');
    expect(drawn).not.toMatch(/Price in|Spent|Who paid|creative pool today/);
  });

  it('keeps every figure for a seat that holds the panel', () => {
    const drawn = text(routerPanels(MODELS, AT));
    expect(drawn).toContain('Price in / out per M');
    expect(drawn).toContain('router-creative-pool');
    expect(drawn).toContain('router-payers');
  });
});

describe('the syllabus desk without the money panel', () => {
  const hidden = stripMoney(SYLLABUS);

  it('is still a syllabus desk, and draws', () => {
    expect(isSyllabusDesk(hidden)).toBe(true);
    const panels = syllabusPanels(hidden as SyllabusDesk, AT);
    const drawn = text(panels);
    expect(drawn).toContain('syllabus-day');
    expect(drawn).toContain('Uttar Pradesh board');
    expect(drawn).not.toContain('$');
    expect(drawn).not.toContain('NaN');
    expect(drawn).not.toContain('of the ceiling');
    // Withheld is not unpriced.
    expect(drawn).not.toContain('not priced');
    expect(drawn).not.toContain('syllabus-cost');
    expect(drawn).not.toContain('"Cost"');
  });

  it('keeps every figure for a seat that holds the panel', () => {
    const drawn = text(syllabusPanels(SYLLABUS, AT));
    expect(drawn).toContain('of the ceiling');
    expect(drawn).toContain('syllabus-cost');
    expect(drawn).toContain('"Cost"');
  });
});
