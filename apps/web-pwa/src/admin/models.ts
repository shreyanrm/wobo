/**
 * The models desk: the router's whole table, live, as panels.
 *
 * `docs/CONSOLE-MODELS.md` §1 — "the router's whole table, live, with the vendor's price beside
 * every id from the catalogue, and beside every tier the jobs that ride on it, what it cost
 * yesterday and today, and who is carrying it right now".
 *
 * Pure, like every other reading in this bundle: nothing here fetches, so no panel can hold a
 * figure that did not come from its argument. The three honesty rules this file keeps:
 *
 *   1. `readable: false` is "the ledger could not be reached" and produces NO money column,
 *      never a zero. The table of tiers is still drawn, because the router's table comes from the
 *      gateway's own memory and is known even when the ledger is not.
 *   2. WHO IS CARRYING is shown beside the primary and flagged when they differ. A tier whose
 *      primary is out is being served by its fallback, which is the single most useful fact on
 *      this screen during an incident and is invisible in the spend numbers.
 *   3. A dial the gateway REJECTED is critical, not a footnote. It means somebody typed a model
 *      into the SQL editor, believes the tier moved, and it did not.
 *   4. No money figure is parsed, ordered or defaulted HERE. The gateway sums (`models_api.group`),
 *      `contract.ts` declares the shape, and `readings.ts` is the one place that reads it
 *      (`rollupSpent`, `byRollupSpend`). This file only decides which words go in which cell.
 */

import type { RollupTotals } from './contract';
import { asOf, count, type Panel, percent, type Tone, usd } from './panels';
import { byRollupSpend, rollupSpent } from './readings';

/** One id's price from `routing.CATALOGUE`. `null` where the unit is not a token (voice, imagery:
 *  those seams price the unit the learner received, and a token figure for them would be a guess). */
export interface CataloguePrice {
  readonly per_million_in: number | null;
  readonly per_million_out: number | null;
  readonly page: string;
  readonly note: string;
}

export interface TierRow {
  readonly tier: string;
  readonly jobs: readonly string[];
  readonly platform_paid_jobs: readonly string[];
  readonly primary: string;
  readonly fallbacks: readonly string[];
  readonly chain: readonly string[];
  /** Absent, with the two spend fields below, for a seat without the money panel. */
  readonly price?: CataloguePrice | null;
  /** The model answering this tier right now, with the provider marks applied. `null` means every
   *  rung is out and a call on this tier would not be served at all. */
  readonly carrying: string | null;
  /** Which of the three is in force: a variable set on the host, the desk, or the owner's own table. */
  readonly source: 'env' | 'desk' | 'default';
  /** What the DESK holds, whether or not it is what the gateway is using. */
  readonly desk_value: string | null;
  readonly desk_chain: readonly string[] | null;
  readonly spend_today?: RollupTotals | null;
  readonly spend_yesterday?: RollupTotals | null;
}

export interface ModelsDesk {
  readonly readable: boolean;
  readonly since: string;
  readonly until: string;
  readonly tiers: readonly TierRow[];
  readonly ladder: {
    readonly rungs: readonly string[];
    readonly source: string;
    readonly since: string;
    readonly reached: readonly ({ readonly model: string } & RollupTotals)[] | null;
    /** Nobody counts this yet. `judge_not_known` says which piece of work would make it a number. */
    readonly judge_pass_rate: number | null;
    readonly judge_not_known: string;
  };
  /** The money half (cap, spend, the fractions of the cap) is absent for a seat without the
   *  money panel; the gateway cuts it (`console_panels.without_money`). */
  readonly creative_pool: {
    readonly cap_usd?: number;
    readonly spent_today_usd?: number | null;
    readonly created_today: number | null;
    readonly cache_hit_rate: number | null;
    readonly fraction?: number | null;
    readonly alert_fractions?: readonly number[];
    readonly capabilities: readonly string[];
  };
  /** Absent as a whole for a seat without the money panel. Its absence is how this file knows. */
  readonly spend?: {
    readonly by_tier: Readonly<Record<string, RollupTotals>> | null;
    readonly by_model: Readonly<Record<string, RollupTotals>> | null;
    readonly by_capability: Readonly<Record<string, RollupTotals>> | null;
    readonly by_payer: Readonly<Record<string, RollupTotals>> | null;
    readonly window: Readonly<Record<string, RollupTotals>> | null;
    readonly live_ceiling: Readonly<Record<string, unknown>>;
    readonly ceiling_usd: number;
  };
  readonly catalogue: Readonly<Record<string, CataloguePrice | null>>;
  readonly dials: {
    readonly applied_at: string | null;
    readonly refresh_interval_s: number;
    readonly rejected: Readonly<Record<string, string>>;
  };
  readonly rolled_at?: string | null;
  readonly rollup_interval_s?: number;
  readonly reconcile: string;
  /** Present on a POST answer only: whether anything was written, and the price preview. */
  readonly saved?: boolean;
  readonly cleared?: number;
  readonly preview?: PricePreview | null;
}

export interface PricePreview {
  readonly tier: string;
  readonly from: string;
  readonly to: string;
  readonly day: string;
  readonly readable: boolean;
  readonly why: string | null;
  readonly calls?: number;
  readonly now_usd?: number;
  readonly then_usd?: number;
  readonly delta_usd?: number;
  readonly per_thousand_calls?: {
    readonly now_usd: number;
    readonly then_usd: number;
    readonly delta_usd: number;
  };
}

const SOURCE = 'GET /v1/admin/models — wobo_gateway.routing, registry, health and the ledger';

const RECONCILE_CAVEAT =
  'The provider dashboards remain the authority for the bill. These are the gateway’s own ledger ' +
  'figures, a floor while any call is unpriced, and the rollup can be a quarter of an hour behind.';

// --- shape check ---------------------------------------------------------------------------------
export function isModelsDesk(value: unknown): value is ModelsDesk {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.readable !== 'boolean' || !Array.isArray(body.tiers)) return false;
  const ladder = body.ladder as Record<string, unknown> | undefined;
  const pool = body.creative_pool as Record<string, unknown> | undefined;
  if (typeof ladder !== 'object' || ladder === null || !Array.isArray(ladder.rungs)) return false;
  if (typeof pool !== 'object' || pool === null) return false;
  // The cap is required exactly when the money is there at all: a seat without the money panel
  // gets neither, and a desk with spend but no cap is malformed.
  if (body.spend !== undefined && typeof pool.cap_usd !== 'number') return false;
  return body.tiers.every(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as Record<string, unknown>).tier === 'string' &&
      typeof (row as Record<string, unknown>).primary === 'string',
  );
}

// --- the readings --------------------------------------------------------------------------------
/** Per-million in / out, or the honest reason there is no pair of numbers. */
export function priceWords(price: CataloguePrice | null | undefined): string {
  if (!price) return 'not in the catalogue';
  if (price.per_million_in === null || price.per_million_out === null) {
    // Voice and imagery are priced per unit received; a token figure for them would be invented.
    return 'priced per unit, not per token';
  }
  return `${price.per_million_in.toFixed(2)} / ${price.per_million_out.toFixed(2)}`;
}

/** A tier whose fallback is answering is the most useful fact on this screen during an outage. */
export function toneOfTier(row: TierRow): Tone {
  if (row.carrying === null) return 'critical';
  if (row.carrying !== row.primary) return 'warn';
  return 'ok';
}

export function carryingWords(row: TierRow): string {
  if (row.carrying === null) return 'nobody — every rung is out';
  return row.carrying === row.primary ? 'the primary' : row.carrying;
}

/** `env` beats `desk`, and when they disagree the desk's own value is named so the operator can
 *  see the saved value the gateway is ignoring rather than wondering why nothing moved. */
export function sourceWords(row: TierRow): string {
  if (row.source === 'env') {
    return row.desk_value && row.desk_value !== row.primary
      ? `a variable set on the host (the desk holds ${row.desk_value}, which is ignored)`
      : 'a variable set on the host';
  }
  if (row.source === 'desk') return 'this desk';
  return 'the owner’s table';
}

/** The calls column of a ladder rung: `cannot say` when the ledger could not be reached, the
 *  count when the rung is on the gateway's list, and `not reached` when it is not. */
export function ladderCount(
  reached: readonly RollupTotals[] | null,
  rung: RollupTotals | undefined,
): string {
  if (reached === null) return 'cannot say';
  return rung ? count(rung.calls) : 'not reached';
}

export function toneOfPool(fraction: number | null): Tone {
  if (fraction === null) return 'unknown';
  if (fraction >= 1) return 'critical';
  if (fraction >= 0.8) return 'warn';
  return 'ok';
}

export function routerPanels(desk: ModelsDesk | null, at: string | null): Panel[] {
  if (!desk) {
    return [
      {
        kind: 'absent',
        id: 'router-unreadable',
        label: 'The router’s table',
        because:
          'GET /v1/admin/models did not answer, so this console cannot say what is routing ' +
          'anything right now. That is a fact about this console, not about the gateway: the ' +
          'gateway routes from its own memory whether or not anybody is looking.',
        wouldFill: 'The gateway answering that read again, or a session that has not ended.',
      },
    ];
  }

  const provenance = { source: SOURCE, at, caveat: RECONCILE_CAVEAT };
  const panels: Panel[] = [];
  // A seat without the money panel is sent no money (`console_panels.without_money`), and the
  // spend block is the part that is always there when money is. Without it, every price and spend
  // column and the two money panels are left out: absent, not "cannot say", because the gateway
  // could say and this seat is not the one it says it to.
  const spend = desk.spend;

  // A rejected dial FIRST. Somebody typed a model into the SQL editor and believes a tier moved.
  const rejected = Object.entries(desk.dials.rejected);
  if (rejected.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'router-rejected',
      label: 'Dials the gateway refused, and is therefore ignoring',
      columns: ['Dial', 'Why it was dropped'],
      rows: rejected.map(([key, why]) => ({
        id: key,
        cells: [key, why],
        tone: 'critical' as Tone,
      })),
      provenance: {
        source: SOURCE,
        at,
        caveat:
          'The owner’s table is still standing for these. A dial the router cannot route to is ' +
          'dropped rather than taking the gateway down, so the change somebody made has not ' +
          'happened and nothing else says so.',
      },
    });
  }

  panels.push({
    kind: 'rows',
    id: 'router-table',
    label: 'The router’s table',
    columns: [
      'Tier',
      'Jobs on it',
      'Primary',
      'Behind it',
      ...(spend ? ['Price in / out per M', 'Spent today'] : []),
      'Carrying now',
      'Set by',
    ],
    rows: desk.tiers.map((row) => ({
      id: row.tier,
      tone: toneOfTier(row),
      cells: [
        row.tier,
        row.jobs.length === 0
          ? 'nothing declares it'
          : `${row.jobs.length}: ${row.jobs.join(', ')}`,
        row.primary,
        row.fallbacks.length === 0 ? 'nothing' : row.fallbacks.join(' → '),
        // No money column at all when the ledger could not be reached: a zero would say the tier
        // was idle, which is the opposite of what we know.
        ...(spend ? [priceWords(row.price), rollupSpent(row.spend_today ?? null)] : []),
        carryingWords(row),
        sourceWords(row),
      ],
    })),
    provenance,
  });

  panels.push({
    kind: 'rows',
    id: 'router-ladder',
    label: 'The generation ladder, cheapest rung first',
    columns: [
      'Rung',
      'Model',
      `Reached since ${desk.ladder.since}`,
      ...(spend ? ['Spent'] : []),
      'Judge’s pass rate',
    ],
    rows: desk.ladder.rungs.map((model, index) => {
      const reached = desk.ladder.reached?.find((entry) => entry.model === model);
      return {
        id: model,
        tone: 'plain' as Tone,
        cells: [
          String(index + 1),
          model,
          // The gateway lists only the rungs the window reached. A rung it left out was not
          // reached at all, and that is said in words rather than as a zero this file made up.
          ladderCount(desk.ladder.reached, reached),
          ...(spend
            ? [
                desk.ladder.reached === null
                  ? 'cannot say'
                  : reached
                    ? rollupSpent(reached)
                    : 'not reached',
              ]
            : []),
          // Never a number, and never a blank either: the absence is the reading.
          'not counted anywhere',
        ],
      };
    }),
    provenance: { source: SOURCE, at, caveat: desk.ladder.judge_not_known },
  });

  if (spend) {
    const pool = desk.creative_pool;
    panels.push({
      kind: 'figure',
      id: 'router-creative-pool',
      label: 'The creative pool today',
      value:
        pool.spent_today_usd == null
          ? 'cannot say'
          : `${usd(pool.spent_today_usd)} of ${usd(pool.cap_usd ?? 0)}`,
      note:
        pool.spent_today_usd == null
          ? 'The ledger could not be reached, so the day’s creative spend is unknown. The cap stands.'
          : `${count(pool.created_today)} creations, cache hit rate ` +
            `${pool.cache_hit_rate === null ? 'not yet meaningful' : percent(pool.cache_hit_rate)}. ` +
            'The platform pays for these and no learner’s day is touched by them.',
      tone: toneOfPool(pool.fraction ?? null),
      provenance: {
        source: SOURCE,
        at,
        caveat:
          `Paid once per concept and then cached for everyone: ${pool.capabilities.join(', ')}. ` +
          'Never mixed with the learners’ spend, and never subtracted from anyone’s day.',
      },
    });

    const payers = spend.by_payer;
    panels.push(
      payers === null
        ? {
            kind: 'absent',
            id: 'router-payers',
            label: 'Who paid for today',
            because:
              'The usage ledger could not be reached, so nothing can be said about what today ' +
              'cost or who it was booked to. A zero here would read as a quiet day.',
            wouldFill: 'The ledger answering — ops.usage_daily, behind GET /v1/admin/models.',
          }
        : {
            kind: 'rows',
            id: 'router-payers',
            label: 'Who paid for today',
            columns: ['Payer', 'Calls', 'Spent', 'Cache hits', 'Unpriced calls'],
            rows: byRollupSpend(Object.entries(payers)).map(([payer, totals]) => ({
              id: payer,
              tone: (totals.unpriced_calls > 0 ? 'warn' : 'plain') as Tone,
              cells: [
                payer === 'creative_pool' ? 'the creative pool' : payer,
                count(totals.calls),
                rollupSpent(totals),
                count(totals.cache_hits),
                count(totals.unpriced_calls),
              ],
            })),
            provenance: {
              source: SOURCE,
              at,
              caveat:
                'A platform-paid capability is booked to the creative pool whatever plan the ' +
                'learner who triggered it is on — that is the ruling, not a rounding. ' +
                RECONCILE_CAVEAT,
            },
          },
    );
  }

  panels.push({
    kind: 'figure',
    id: 'router-applied',
    label: 'The gateway last re-read its dials',
    value: desk.dials.applied_at ? asOf(desk.dials.applied_at).replace('as of ', '') : 'not yet',
    note:
      `It re-reads every ${desk.dials.refresh_interval_s} seconds, and at once when a dial is ` +
      'turned here. "Apply now" is for a change made in the SQL editor.',
    tone: desk.dials.applied_at ? 'ok' : 'unknown',
    provenance: { source: SOURCE, at },
  });

  return panels;
}
