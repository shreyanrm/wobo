/**
 * The allowance desk: how generous the day is, and the pace it is being spent at.
 *
 * `docs/ALLOWANCE.md` §3 — generosity per plan with the effect shown live before it is saved, the
 * INR rate with the day it was set, and the pace: today's spend against today's allowance across
 * learners, how many hit the bar, and the median fraction used.
 *
 * MONEY IS INTERNAL ONLY. The owner's ruling (docs/ALLOWANCE.md §5) is that no learner and no
 * parent ever sees a currency; the rupees exist in the gateway's arithmetic and on THIS screen and
 * nowhere else. That is why this file lives under `src/admin` and why nothing in it is exported to
 * a learner screen: the bar on the You page is drawn from a fraction, never from these numbers.
 *
 * Pure: nothing fetches, so no panel can hold a figure that did not come from its argument.
 *
 * The one thing this desk refuses to guess is the LOCAL HOUR. The usage ledger carries a UTC day
 * and no time zone, so "at what hour of their own day did a learner hit the bar" is rendered as an
 * absence with the work that would fill it, rather than as a UTC hour under a heading that says
 * otherwise.
 */

// The pool tone is the models desk's own (`toneOfPool`), imported rather than copied: the free
// pool and the creative pool are read against the same three fractions, and two desks disagreeing
// about what "amber" means for a cap would be two opinions about one number. `models.ts` imports
// nothing from here, so this is a one-way edge.
import { toneOfPool } from './models';
import { asOf, count, type Panel, percent, type Tone, usd } from './panels';

/**
 * One of the two pools the platform pays for ITSELF, as it stands today (`wobo_gateway.pools`).
 * Never added to the learners' spend and never shown beside it: the creative pool is an
 * investment whose per-learner cost falls every day the cache is warm, and the free pool is
 * recurring goodwill. One figure covering both would mislead about each.
 *
 * `fraction` is `null` when no cap is set — not `0`, which reads as "none of it used" rather
 * than "there is nothing to use it against".
 */
export interface PoolToday {
  readonly pool: string;
  readonly day: string;
  readonly spent_usd: number;
  readonly spent_paise: number;
  readonly cap_usd: number | null;
  readonly cap_paise: number | null;
  readonly fraction: number | null;
  readonly spent: boolean;
}

export interface AllowanceEffectRow {
  readonly plan: string;
  readonly period: string | null;
  readonly plan_amount_paise: number;
  readonly generosity: number | null;
  readonly daily_paise: number;
  /** Already formatted by the gateway, which owns the arithmetic the meter charges against. */
  readonly a_day: string;
}

export interface Pace {
  readonly day: string;
  /** `false` means the ledger could not be reached. Then there are NO counts, not zeroes. */
  readonly readable: boolean;
  readonly not_known: string;
  readonly by_hour: null;
  readonly inr_per_usd: number;
  readonly learners?: number;
  readonly calls?: number;
  readonly spent_usd?: number;
  readonly spent_paise?: number;
  readonly at_the_bar?: number;
  readonly median_fraction?: number | null;
  readonly bands?: {
    readonly under_quarter: number;
    readonly under_half: number;
    readonly under_all: number;
    readonly at_the_bar: number;
  };
  readonly complete?: boolean;
}

export interface AllowanceDesk {
  readonly day: string;
  readonly generosity: Readonly<Record<string, number>>;
  readonly free_daily_paise: number;
  readonly free_daily: string;
  readonly inr_per_usd: number;
  readonly inr_rate_set_at: string | null;
  readonly creative_pool_usd: number;
  /** `null` means NO CAP HAS BEEN SET, which is not zero and not unlimited-by-design. */
  readonly free_pool_paise: number | null;
  readonly free_pool: string | null;
  /**
   * THE DAY AS IT ACTUALLY STANDS, from the in-process accumulator that enforces the cap
   * (`wobo_gateway.pools`) rather than from the ledger's rollup, which can be a quarter of an
   * hour behind. Optional because a gateway older than that module answers without it, and an
   * older gateway must read as "not deployed" rather than as a quiet day.
   */
  readonly free_pool_today?: PoolToday;
  readonly creative_pool_today?: PoolToday;
  readonly alert_fractions: readonly number[];
  readonly days_in_month: number;
  readonly effect: readonly AllowanceEffectRow[];
  readonly pace: Pace;
  readonly applied_at: string | null;
  readonly refresh_interval_s: number;
  readonly internal_only: boolean;
  readonly reconcile: string;
  /** Present on a POST answer only. */
  readonly saved?: boolean;
  readonly preview?: readonly AllowanceEffectRow[];
}

const SOURCE = 'GET /v1/admin/allowance — ops.settings, and ops.learner_day for the pace';

const INTERNAL_ONLY =
  'Internal only. No learner and no parent surface shows a currency anywhere; the bar on the You ' +
  'page is a fraction of a day, and these rupees exist in the gateway’s arithmetic and here.';

/**
 * Paise as an operator reads them, in the gateway's own spelling (`dials.rupees`): two decimal
 * places, grouped. The console is the ONE place in this product money is written down, so the
 * figure is given exactly and never rounded up to a friendlier number.
 */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function isAllowanceDesk(value: unknown): value is AllowanceDesk {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  const pace = body.pace as Record<string, unknown> | undefined;
  return (
    typeof body.free_daily_paise === 'number' &&
    typeof body.inr_per_usd === 'number' &&
    typeof body.generosity === 'object' &&
    body.generosity !== null &&
    Array.isArray(body.effect) &&
    typeof pace === 'object' &&
    pace !== null &&
    typeof pace.readable === 'boolean'
  );
}

/** How close the median learner is to the end of their day. Amber past three quarters, because
 *  the median passing the bar means the allowance is under-set for the ordinary learner, not that
 *  one account is heavy. */
export function toneOfPace(median: number | null | undefined): Tone {
  if (median === null || median === undefined) return 'unknown';
  if (median >= 1) return 'critical';
  if (median >= 0.75) return 'warn';
  return 'ok';
}

export function planWords(row: AllowanceEffectRow): string {
  if (row.plan === 'free') return 'Free';
  const name = row.plan.charAt(0).toUpperCase() + row.plan.slice(1);
  return row.period ? `${name}, ${row.period}` : name;
}

export function allowancePanels(desk: AllowanceDesk | null, at: string | null): Panel[] {
  if (!desk) {
    return [
      {
        kind: 'absent',
        id: 'allowance-unreadable',
        label: 'Generosity and the pace',
        because:
          'GET /v1/admin/allowance did not answer, so this console cannot say how generous a day ' +
          'is or how fast it is being spent. The dials themselves are in ops.settings and are ' +
          'unaffected by whether anybody is looking at them.',
        wouldFill: 'The gateway answering that read again, or a session that has not ended.',
      },
    ];
  }

  const provenance = { source: SOURCE, at, caveat: INTERNAL_ONLY };
  const panels: Panel[] = [
    {
      kind: 'rows',
      id: 'allowance-effect',
      label: 'What a day buys, per plan',
      columns: ['Plan', 'Plan amount a month', 'Generosity', 'A day'],
      rows: desk.effect.map((row) => ({
        id: `${row.plan}-${row.period ?? 'none'}`,
        tone: 'plain' as Tone,
        cells: [
          planWords(row),
          row.plan === 'free' ? 'nothing' : `₹${(row.plan_amount_paise / 100).toLocaleString('en-IN')}`,
          row.generosity === null ? 'not a fraction of anything' : percent(row.generosity),
          row.a_day,
        ],
      })),
      provenance: {
        source: SOURCE,
        at,
        caveat:
          `Over ${desk.days_in_month} days, the length of this month. Nothing carries forward, ` +
          `and the learner never sees a number. ${INTERNAL_ONLY}`,
      },
    },
    {
      kind: 'figure',
      id: 'allowance-rate',
      label: 'Rupees to the dollar',
      value: desk.inr_per_usd.toFixed(2),
      note: desk.inr_rate_set_at
        ? `Set ${desk.inr_rate_set_at.slice(0, 10)}. Every allowance above is computed through it.`
        : 'Never moved from its seeded value. Every allowance above is computed through it.',
      tone: 'plain',
      provenance: {
        source: SOURCE,
        at,
        caveat:
          'The vendors bill in dollars and the family paid in rupees; this one number joins them. ' +
          'A rate left stale quietly moves every allowance on the screen above.',
      },
    },
  ];

  // The two pools the platform pays for itself, each with its cap or the honest absence of one.
  // THE GOODWILL, IN RUPEES, TODAY (docs/ALLOWANCE.md "Best of both worlds" point 4: "the day's
  // spend on free learners, with a dial and an alert, so growth cannot outrun the money"). The
  // cap alone was decoration until the gateway started counting the day against it; this shows
  // what has actually been spent, so the owner sees the goodwill rather than a setting.
  const freeToday = desk.free_pool_today;
  panels.push({
    kind: 'figure',
    id: 'allowance-free-pool',
    label: 'The free pool today',
    value:
      freeToday === undefined
        ? (desk.free_pool ?? 'no cap set')
        : desk.free_pool === null
          ? `${rupees(freeToday.spent_paise)} spent, no cap set`
          : `${rupees(freeToday.spent_paise)} of ${desk.free_pool}`,
    note:
      desk.free_pool === null
        ? 'Free learners are bounded only per learner, by the day above. Growth is not bounded in ' +
          'total until this dial is set.'
        : `Alerts at ${desk.alert_fractions.map((f) => percent(f)).join(', ')} of it. ` +
          (freeToday?.spent
            ? 'The day is spent: free learners meet the kind line until midnight.'
            : 'When it is spent, free learners meet one kind line and never a thinner answer.'),
    // No cap set is amber whatever has been spent: an unbounded free lane is the exposure, and
    // a comfortable-looking figure under no ceiling is exactly the thing not to reassure about.
    tone: desk.free_pool === null ? 'warn' : toneOfPool(freeToday?.fraction ?? null),
    provenance: { source: SOURCE, at, caveat: INTERNAL_ONLY },
  });

  const pace = desk.pace;
  if (!pace.readable) {
    panels.push({
      kind: 'absent',
      id: 'allowance-pace',
      label: 'The pace today',
      because:
        'ops.learner_day could not be read, so nothing can be said about how many learners spent ' +
        'their day. A zero here would read as "nobody studied today", which is the opposite of ' +
        'what we know.',
      wouldFill:
        'Migration 0030 applied (the view), and a project configured on the gateway this console ' +
        'points at.',
    });
  } else {
    panels.push(
      {
        kind: 'figure',
        id: 'allowance-pace-median',
        label: 'The median learner’s day',
        value: pace.median_fraction === null ? 'nobody studied yet' : percent(pace.median_fraction ?? 0),
        note:
          `${count(pace.learners)} learners, ${count(pace.at_the_bar)} at the bar. ` +
          `${usd(pace.spent_usd ?? 0)} spent, about ₹${((pace.spent_paise ?? 0) / 100).toFixed(2)}.`,
        tone: toneOfPace(pace.median_fraction),
        provenance: {
          source: SOURCE,
          at,
          caveat:
            'The MIDDLE learner, not the mean: one heavy account must not read as everybody ' +
            `being busy. ${pace.complete === false ? 'This is the first page of learners, so every count is a floor. ' : ''}` +
            INTERNAL_ONLY,
        },
      },
      {
        kind: 'rows',
        id: 'allowance-pace-bands',
        label: 'How far into the day learners got',
        columns: ['Band', 'Learners'],
        rows: [
          { id: 'q', cells: ['under a quarter', count(pace.bands?.under_quarter)], tone: 'plain' },
          { id: 'h', cells: ['a quarter to a half', count(pace.bands?.under_half)], tone: 'plain' },
          { id: 'a', cells: ['a half to all of it', count(pace.bands?.under_all)], tone: 'plain' },
          {
            id: 'bar',
            cells: ['the whole day', count(pace.bands?.at_the_bar)],
            tone: (pace.bands?.at_the_bar ?? 0) > 0 ? 'warn' : 'plain',
          },
        ],
        provenance: { source: SOURCE, at, caveat: INTERNAL_ONLY },
      },
      {
        // Not a chart with nothing in it. The absence IS the reading, and it says what would end it.
        kind: 'absent',
        id: 'allowance-pace-hour',
        label: 'At what hour of their own day they hit the bar',
        because: pace.not_known,
        wouldFill:
          'The allowance meter writing down the local hour at which a learner met the bar — it ' +
          'already resolves the learner’s midnight (wobo_gateway.allowance.local_day) — and a ' +
          'column for it on the pace view.',
      },
    );
  }

  panels.push({
    kind: 'figure',
    id: 'allowance-applied',
    label: 'These dials last reached the gateway',
    value: desk.applied_at ? asOf(desk.applied_at).replace('as of ', '') : 'not yet',
    note: `Re-read every ${desk.refresh_interval_s} seconds, and at once when one is turned here.`,
    tone: desk.applied_at ? 'ok' : 'unknown',
    provenance: { source: SOURCE, at, caveat: desk.reconcile },
  });

  return panels;
}
