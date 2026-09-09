/**
 * Every desk that has a number, as a pure function from one gateway reading to its panels.
 *
 * Nothing here fetches, so every reading is testable without a network and none of them can
 * produce a figure that did not come from its argument. Three sources, and each panel names
 * which one it came from on the screen:
 *
 *   `ops.usage_daily`   the permanent rollup, one row per (day, capability, model, plan, unit).
 *                       Sums only: the migration is explicit that a stored average cannot be
 *                       re-averaged and a stored distinct count cannot be added up, so this file
 *                       sums and divides sums, and never reads an average off a row.
 *   `wobo_gateway.spend` the in-process accumulator the ceiling actually enforces. It is a
 *                       different number from the ledger's today and it is labelled as one.
 *   `wobo_gateway.health` the four checks.
 *
 * THE THREE STATES OF A LEDGER READ, kept apart everywhere below because merging any two of them
 * would be a lie:
 *   readable: false          we could not ask. Not a zero.
 *   readable, no rows        we asked and nothing has been recorded yet. Also not a zero.
 *   readable, rows           a number, with its unpriced calls beside it.
 */

import type { Economics, HealthCheck, HealthSnapshot, UsageDay, UsageWindow } from './contract';
import { asOf, count, type Panel, percent, rank, seconds, type Tone, usd } from './panels';

const LEDGER_SOURCE = 'GET /v1/admin/usage — ops.usage_daily, the daily rollup';
const SPEND_SOURCE = 'GET /v1/admin/usage → spend_now — wobo_gateway.spend, the live accumulator';
const ECONOMICS_SOURCE = 'GET /v1/admin/economics — wobo_gateway.unit_economics';
const HEALTH_SOURCE = 'GET /v1/admin/health — wobo_gateway.health.snapshot()';

/** Rides every figure taken from the live accumulator. On the screen, not only in this file. */
const SPEND_NOW_CAVEAT =
  'Process-local, and reset by any restart or deploy — spend.py says so itself. This is the ' +
  'spend since the gateway last started, not the day’s true total, and the provider dashboards ' +
  'remain the authority. The ledger figures below survive a restart; this one does not.';

const UNPRICED_CAVEAT =
  'Some calls could not be priced, so every total here is a FLOOR. The count of unpriced calls ' +
  'is shown beside the money rather than folded into it.';

// --- shape checks -----------------------------------------------------------------------------
export function isHealthSnapshot(value: unknown): value is HealthSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (!['ok', 'degraded', 'unhealthy'].includes(String(body.status))) return false;
  if (typeof body.checks !== 'object' || body.checks === null) return false;
  return Object.values(body.checks as Record<string, unknown>).every(
    (check) =>
      typeof check === 'object' &&
      check !== null &&
      ['ok', 'degraded', 'fail'].includes(String((check as Record<string, unknown>).status)),
  );
}

export function isUsageWindow(value: unknown): value is UsageWindow {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.readable !== 'boolean' || !Array.isArray(body.days)) return false;
  const now = body.spend_now as Record<string, unknown> | undefined;
  return typeof now === 'object' && now !== null && typeof now.spent_usd === 'number';
}

export function isEconomics(value: unknown): value is Economics {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  const free = body.free_day as Record<string, unknown> | undefined;
  return (
    Array.isArray(body.per_unit) &&
    Array.isArray(body.gaps) &&
    typeof free === 'object' &&
    free !== null &&
    typeof free.complete === 'boolean'
  );
}

// --- sums over the rollup ----------------------------------------------------------------------
interface Totals {
  cost: number;
  calls: number;
  unpriced: number;
  configured: number;
  fallbacks: number;
  units: number;
  cacheHits: number;
  /** Values that arrived and could not be read as numbers. Counted, never folded into a sum. */
  unreadable: number;
}

const ZERO: Totals = {
  cost: 0,
  calls: 0,
  unpriced: 0,
  configured: 0,
  fallbacks: 0,
  units: 0,
  cacheHits: 0,
  unreadable: 0,
};

function num(value: unknown): number {
  // PostgREST returns `numeric` as a string. A silent NaN here would print "$NaN" on the owner's
  // money screen, so anything unparseable counts as nothing rather than poisoning a sum.
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The same parse, WITH the fact that it failed.
 *
 * `num` alone was the quiet version of the exact failure this console is written against: a
 * malformed `cost_usd` vanished into a sum and the panel presented the remainder as the whole —
 * an understated money total with no counter and no caveat. `count()` in panels.ts gets this right
 * for the same problem ("`—` when it is not a number, never `0`: absent and zero are different
 * facts"); this is that rule applied to arithmetic.
 *
 * An ABSENT field (null or undefined) is not a fault: an older rollup row simply may not carry a
 * column. A value that is THERE and unparseable is, and it is the only thing counted.
 */
function reading(value: unknown): { value: number; readable: boolean } {
  if (value === null || value === undefined) return { value: 0, readable: true };
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? { value: parsed, readable: true }
    : { value: 0, readable: false };
}

function add(into: Totals, row: UsageDay): Totals {
  const cost = reading(row.cost_usd);
  const calls = reading(row.calls);
  const unpriced = reading(row.unpriced_calls);
  const configured = reading(row.configured_calls);
  const fallbacks = reading(row.fallback_calls);
  const units = reading(row.unit_count);
  const cacheHits = reading(row.cache_hits);
  const unreadable = [cost, calls, unpriced, configured, fallbacks, units, cacheHits].filter(
    (field) => !field.readable,
  ).length;
  return {
    cost: into.cost + cost.value,
    calls: into.calls + calls.value,
    unpriced: into.unpriced + unpriced.value,
    configured: into.configured + configured.value,
    fallbacks: into.fallbacks + fallbacks.value,
    units: into.units + units.value,
    cacheHits: into.cacheHits + cacheHits.value,
    unreadable: into.unreadable + unreadable,
  };
}

export function totals(rows: readonly UsageDay[]): Totals {
  return rows.reduce(add, ZERO);
}

/** Sum the rollup by one of its key columns. The only aggregation in this console, in one place. */
export function groupBy(rows: readonly UsageDay[], key: keyof UsageDay): [string, Totals][] {
  const held = new Map<string, Totals>();
  for (const row of rows) {
    const name = String(row[key] ?? 'unknown');
    held.set(name, add(held.get(name) ?? ZERO, row));
  }
  return [...held.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].calls - a[1].calls);
}

/** The unpriced note that rides every money total. Empty when everything could be priced. */
function pricedNote(sums: Totals): string {
  const parts: string[] = [];
  if (sums.unpriced > 0) parts.push(`${count(sums.unpriced)} calls could not be priced`);
  if (sums.configured > 0) parts.push(`${count(sums.configured)} priced from a figure we entered`);
  if (sums.unreadable > 0) {
    parts.push(`${count(sums.unreadable)} values could not be read and are not in this total`);
  }
  return parts.join(' · ');
}

/** The caveat a malformed figure earns. Surfaced the way `unpriced_calls` is, and for the same
 *  reason: a total missing part of itself must not be printed as the whole. */
function unreadableCaveat(sums: Totals): string {
  if (sums.unreadable === 0) return '';
  return (
    `${count(sums.unreadable)} values in the rollup could not be read as numbers and were left ` +
    'out rather than guessed at, so this total is a floor. It usually means a column changed ' +
    'shape; the rows themselves are in ops.usage_daily.'
  );
}

/**
 * The one absent panel a ledger read can produce, and which of the two it is.
 * Returns null when there ARE rows and the desk should draw them.
 */
function ledgerGap(usage: UsageWindow | null, label: string): Panel | null {
  if (!usage) {
    return {
      kind: 'absent',
      id: `${label}-unread`,
      label,
      because: 'The console has not been able to read the usage ledger.',
      wouldFill:
        'A reachable gateway, a console session that has not expired, and a seat carrying ' +
        'console.read.',
    };
  }
  if (!usage.readable) {
    return {
      kind: 'absent',
      id: `${label}-unreachable`,
      label,
      because:
        'The gateway could not reach the usage ledger, so it has nothing to report. This is not ' +
        'the same as nothing having happened, and it is not shown as a zero.',
      wouldFill:
        'A reachable ops schema — the ledger names the reason in its own state, shown at the ' +
        'foot of this desk.',
    };
  }
  if (usage.days.length === 0) {
    return {
      kind: 'absent',
      id: `${label}-empty`,
      label,
      because:
        `The ledger is readable and holds nothing between ${usage.since} and ${usage.until}. ` +
        'It starts empty and nothing is backfilled, seeded or estimated, so until a model call ' +
        'is recorded there is genuinely nothing here.',
      wouldFill: 'The first model call after the ledger was deployed. Nothing else.',
    };
  }
  return null;
}

/**
 * The ledger's own account of what it lost, as a panel foot. A total from a ledger that dropped
 * rows is a FLOOR, and an operator has to be able to see that it is one.
 *
 * The three counters are named individually rather than summed by the gateway, and each is a
 * different fault an operator would act on differently: a full buffer means the flush is not
 * keeping up, a failed write means the database refused, and unconfigured means no ledger was
 * wired at all. They are added here for the headline and named underneath — reading one field
 * called `dropped` would have missed all three, which is exactly what this function did until a
 * test read the gateway's own state shape.
 */
export function droppedRows(ledger: Readonly<Record<string, unknown>> | undefined): number {
  if (!ledger) return 0;
  return (
    num(ledger.dropped_buffer_full) +
    num(ledger.dropped_write_failed) +
    num(ledger.dropped_unconfigured)
  );
}

/**
 * How stale the rollup behind these figures is, in words, or undefined when it is current.
 *
 * `ops.usage_daily` IS NOT LIVE. `ops.roll_up_usage` rebuilds it every `LEDGER_ROLLUP_INTERVAL_S`
 * seconds — a quarter of an hour by default — on top of a five second flush, and every panel
 * stamped the moment of the FETCH, so a cached figure went out under a fresh timestamp. The
 * gateway already stamped `rolled_at` on every row and now carries the newest one through the
 * envelope; this turns it into the sentence beside "as of HH:MM:SS UTC".
 */
export function rollupNote(usage: UsageWindow | null): string | undefined {
  if (!usage?.readable) return undefined;
  const stamp = usage.rolled_at;
  if (!stamp) {
    return usage.days.length === 0
      ? undefined
      : 'These rows carry no rollup stamp, so how current they are is unknown.';
  }
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return undefined;
  const clock = `rolled up ${when.toISOString().slice(11, 16)} UTC`;
  const interval = num(usage.rollup_interval_s);
  if (interval <= 0) return `${clock}. The rollup is a cache, not a live read.`;
  const behind = (Date.now() - when.getTime()) / 1000;
  const minutes = Math.round(interval / 60);
  if (behind > interval * 2) {
    return (
      `${clock} — more than twice the ${minutes} minute rollup interval ago. Either the gateway's ` +
      'maintenance loop has stopped or nothing has been recorded since; both are worth chasing ' +
      'before reading these figures as current.'
    );
  }
  return `${clock}. Rebuilt every ${minutes} minutes, so the newest figures lag by up to that.`;
}

/** The caveats a rollup panel always carries: dropped rows, unreadable values, staleness. */
function ledgerCaveat(usage: UsageWindow | null, sums?: Totals): string | undefined {
  return (
    [ledgerState(usage) ?? '', sums ? unreadableCaveat(sums) : '', rollupNote(usage) ?? '']
      .filter(Boolean)
      .join(' ') || undefined
  );
}

function ledgerState(usage: UsageWindow | null): string | undefined {
  if (!usage) return undefined;
  const dropped = droppedRows(usage.ledger);
  if (dropped === 0) return undefined;
  const named = (['dropped_buffer_full', 'dropped_write_failed', 'dropped_unconfigured'] as const)
    .filter((field) => num(usage.ledger[field]) > 0)
    .map(
      (field) =>
        `${field.replace('dropped_', '').replaceAll('_', ' ')} ${count(num(usage.ledger[field]))}`,
    )
    .join(', ');
  return `${count(dropped)} rows never reached the ledger (${named}), so every total here is a floor.`;
}

// --- SPEND --------------------------------------------------------------------------------------
/** The lanes `spend.py` actually sheds in, not a round number invented here: past 0.8 a member is
 *  degraded, past 1.0 a member is refused and only a paying learner is served. Those are the two
 *  moments an operator must act, so those are the two moments the figure changes colour. */
export function toneOfSpend(fraction: number): Tone {
  if (!Number.isFinite(fraction)) return 'unknown';
  if (fraction >= 1) return 'critical';
  if (fraction >= 0.8) return 'warn';
  return 'ok';
}

export function spendPanels(usage: UsageWindow | null, at: string | null): Panel[] {
  const panels: Panel[] = [];

  // The live ceiling first: it is the number that decides whether a child is answered right now.
  if (usage) {
    const now = usage.spend_now;
    const hasCeiling = num(now.ceiling_usd) > 0;
    panels.push({
      kind: 'figure',
      id: 'spend-now',
      label: `Against the ceiling, right now${now.day ? ` · UTC day ${now.day}` : ''}`,
      value: usd(num(now.spent_usd)),
      note: hasCeiling
        ? `${percent(num(now.fraction))} of the ${usd(num(now.ceiling_usd))} daily ceiling · ${count(num(now.calls))} model calls`
        : `no daily ceiling is configured · ${count(num(now.calls))} model calls`,
      tone: hasCeiling ? toneOfSpend(num(now.fraction)) : 'warn',
      provenance: { source: SPEND_SOURCE, at, caveat: SPEND_NOW_CAVEAT },
    });
  }

  const gap = ledgerGap(usage, 'The ledger’s own record');
  if (gap || !usage) return [...panels, ...(gap ? [gap] : [])];

  const sums = totals(usage.days);
  const byDay = groupBy(usage.days, 'day').sort((a, b) => a[0].localeCompare(b[0]));
  const perDay = byDay.length > 0 ? sums.cost / byDay.length : 0;
  const latest = byDay.at(-1);

  panels.push({
    kind: 'figure',
    id: 'spend-window',
    label: `Recorded spend, ${usage.since} to ${usage.until}`,
    value: usd(sums.cost),
    note: [
      `${count(byDay.length)} days with activity · ${count(sums.calls)} calls · ${usd(perDay)} a day on average`,
      pricedNote(sums),
    ]
      .filter(Boolean)
      .join(' · '),
    tone: 'plain',
    provenance: {
      source: LEDGER_SOURCE,
      at,
      caveat:
        [sums.unpriced > 0 ? UNPRICED_CAVEAT : '', ledgerCaveat(usage, sums) ?? '']
          .filter(Boolean)
          .join(' ') || undefined,
    },
  });

  // What is unusual, stated only when there IS a normal to measure against. One day of data is one
  // day's weather; calling it a trend would be the invention this console refuses.
  //
  // THE CURRENT UTC DAY IS EXCLUDED, and that is the whole point of this panel working at all. It
  // used to compare the LATEST recorded day — which is today, still filling, and up to a rollup
  // interval behind even so — against the mean of full 24-hour days. At 02:00 UTC that reads "down
  // 92% on a $X average day" and paints warn, every single morning, which trains an operator to
  // ignore the one panel that exists to catch a real anomaly. `usage.until` is the gateway's own
  // UTC today (console_api.window), so the console never has to guess at the boundary.
  const complete = byDay.filter(([day]) => day !== usage.until);
  const latestComplete = complete.at(-1);
  if (latestComplete && complete.length >= 2) {
    const others = complete.slice(0, -1);
    const baseline = others.reduce((held, [, entry]) => held + entry.cost, 0) / others.length;
    const shift = baseline > 0 ? (latestComplete[1].cost - baseline) / baseline : 0;
    panels.push({
      kind: 'figure',
      id: 'spend-today-vs',
      label: `The last full day, ${latestComplete[0]}, against the ${count(others.length)} before it`,
      value: usd(latestComplete[1].cost),
      note:
        baseline > 0
          ? `${shift >= 0 ? 'up' : 'down'} ${percent(Math.abs(shift))} on a ${usd(baseline)} average day`
          : 'no earlier day carried a priced call, so there is nothing to compare against',
      tone: baseline > 0 && Math.abs(shift) >= 0.5 ? 'warn' : 'plain',
      provenance: {
        source: LEDGER_SOURCE,
        at,
        caveat:
          `${usage.until} is still running and is left out of both sides of this comparison: a ` +
          'part-day against whole days would read as a collapse every morning. Today\u2019s own ' +
          'figure is on the live ceiling panel above.',
      },
    });
  } else if (latest) {
    panels.push({
      kind: 'absent',
      id: 'spend-today-vs',
      label: 'How this compares with an ordinary day',
      because:
        `The ledger holds ${count(complete.length)} full day(s) before ${usage.until}, which is ` +
        'not enough to say what an ordinary day costs. The current UTC day is excluded because it ' +
        'is still filling, and comparing a part-day with whole days is not a comparison.',
      wouldFill: 'Two complete UTC days of recorded calls before today.',
    });
  }

  panels.push({
    kind: 'rows',
    id: 'spend-by-capability',
    label: 'Where it went, by capability',
    columns: ['Capability', 'Cost', 'Share', 'Calls', 'Unpriced'],
    rows: groupBy(usage.days, 'capability').map(([name, entry]) => ({
      cells: [
        name,
        usd(entry.cost),
        sums.cost > 0 ? percent(entry.cost / sums.cost) : '—',
        count(entry.calls),
        count(entry.unpriced),
      ],
      tone: 'plain' as Tone,
    })),
    // The same caveat as the total above it: this table is the same arithmetic, split, so a
    // dropped row, an unreadable figure or a stale rollup makes every cell a floor too.
    provenance: { source: LEDGER_SOURCE, at, caveat: ledgerCaveat(usage, sums) },
  });

  return panels;
}

// --- MODELS -------------------------------------------------------------------------------------
/** A fallback means the model the policy asked for did not answer, so a rising rate is a provider
 *  problem before it is a cost problem. One in five is loud enough to act on. */
export function toneOfFallback(rate: number): Tone {
  if (!Number.isFinite(rate)) return 'unknown';
  if (rate >= 0.2) return 'critical';
  if (rate >= 0.05) return 'warn';
  return 'ok';
}

export function modelPanels(usage: UsageWindow | null, at: string | null): Panel[] {
  const gap = ledgerGap(usage, 'Which models answered');
  if (gap || !usage) return gap ? [gap] : [];

  const sums = totals(usage.days);
  const rate = sums.calls > 0 ? sums.fallbacks / sums.calls : 0;
  const byModel = groupBy(usage.days, 'model_served');
  // DELIVERY ROWS ARE NOT PRICED CALLS. `engines.py` records finished video seconds as a delivery
  // row carrying the real video model and `cost_usd: null`; the rollup coalesces that to 0 and
  // counts 0 calls. Rendered as money, the model that actually made the video appeared as
  // "$0.00 · 0 calls", toned ok — arithmetic over an empty set, reading as "video costs us
  // nothing". A group with no priced call gets words instead of zeroes, and the tone that means
  // "we do not know", not the tone that means "fine".
  const delivery = byModel.filter(([, entry]) => entry.calls === 0);

  return [
    {
      kind: 'figure',
      id: 'models-fallback',
      label: 'Calls a fallback had to answer',
      value: percent(rate),
      note: `${count(sums.fallbacks)} of ${count(sums.calls)} calls · the early warning of a provider problem`,
      tone: toneOfFallback(rate),
      provenance: { source: LEDGER_SOURCE, at, caveat: ledgerCaveat(usage, sums) },
    },
    {
      kind: 'rows',
      id: 'models-table',
      label: 'By the model that actually answered',
      columns: ['Model', 'Cost', 'Calls', 'Fallbacks', 'Cache hits', 'Unpriced'],
      rows: byModel.map(([name, entry]) => ({
        cells:
          entry.calls === 0
            ? [name, 'no priced calls', '—', '—', count(entry.cacheHits), count(entry.unpriced)]
            : [
                name,
                usd(entry.cost),
                count(entry.calls),
                count(entry.fallbacks),
                count(entry.cacheHits),
                count(entry.unpriced),
              ],
        // A model whose every call is a fallback is a model standing in for a broken one. A model
        // with no priced call at all is not fine and not alarming: it is unknown.
        tone:
          entry.calls === 0 ? ('unknown' as Tone) : toneOfFallback(entry.fallbacks / entry.calls),
      })),
      provenance: {
        source: LEDGER_SOURCE,
        at,
        caveat:
          [
            delivery.length > 0
              ? `${count(delivery.length)} model(s) here carry delivery rows only — seconds of video ` +
                'a learner received, which no provider bills per second. Their money sits on the ' +
                'calls that produced them, so a cost of $0.00 would have read as "this is free".'
              : '',
            ledgerCaveat(usage, sums) ?? '',
          ]
            .filter(Boolean)
            .join(' ') || undefined,
      },
    },
  ];
}

// --- PACING -------------------------------------------------------------------------------------
/** How a unit is written. The ledger's `unit_count` means seconds for the two spoken kinds and a
 *  plain count for the rest, so the label has to change with it or the column lies. */
export function unitValue(kind: string, value: number): string {
  return kind.includes('second') || kind === 'speech' || kind === 'video'
    ? seconds(value)
    : count(value);
}

export function pacingPanels(
  usage: UsageWindow | null,
  economics: Economics | null,
  at: string | null,
): Panel[] {
  const panels: Panel[] = [];
  const gap = ledgerGap(usage, 'What a day is spent on');

  if (!gap && usage) {
    const sums = totals(usage.days);
    panels.push({
      kind: 'rows',
      id: 'pacing-units',
      label: 'By what the learner actually received',
      columns: ['Unit', 'How much', 'Cost', 'Share of cost', 'Calls'],
      rows: groupBy(usage.days, 'unit_kind').map(([kind, entry]) => ({
        cells: [
          kind,
          unitValue(kind, entry.units),
          usd(entry.cost),
          sums.cost > 0 ? percent(entry.cost / sums.cost) : '—',
          count(entry.calls),
        ],
        tone: 'plain' as Tone,
      })),
      provenance: {
        source: LEDGER_SOURCE,
        at,
        caveat: [
          'Share of COST, which is not share of allowance. A plan’s allowance is counted in ' +
            'turns and generations by budget.py, and the two divide a day differently — this ' +
            'column is the money, and the panel below is the allowance.',
          ledgerCaveat(usage, sums) ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      },
    });
  } else if (gap) {
    panels.push(gap);
  }

  if (!economics) {
    panels.push({
      kind: 'absent',
      id: 'pacing-economics-unread',
      label: 'What one free day costs',
      because: 'The console has not been able to read the derivation.',
      wouldFill: 'A reachable gateway and a console session that has not expired.',
    });
    return panels;
  }

  // THE RATES THE DAY WAS BUILT FROM. `unit_economics._unit_costs` computes cost per turn, per
  // generation and per spoken second, each with its own gap and its own unpriced count; they were
  // serialised over the wire, typed in contract.ts and never drawn. The owner saw the day total
  // and not the rates underneath it, so he could not sanity-check the number he is about to price
  // a plan on. This is that table.
  if (economics.per_unit.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'pacing-rates',
      label: 'The rates this day was built from',
      columns: ['Unit', 'Rate', 'Measured over', 'Cost', 'Unpriced', 'What is missing'],
      rows: economics.per_unit.map((unit) => {
        const rate = unit.usd_per_unit;
        const units = num(unit.units);
        const gap = typeof unit.gap === 'string' ? unit.gap : '';
        return {
          cells: [
            unit.unit_kind,
            rate === null || rate === undefined ? 'no rate' : `${usd(rate)} per unit`,
            `${unitValue(unit.unit_kind, units)} over ${count(num(unit.calls))} calls`,
            usd(num(unit.cost_usd)),
            count(num(unit.unpriced_calls)),
            gap || '—',
          ],
          // A rate we could not derive is `unknown`, never `ok`: this is the pricing desk, and a
          // missing rate quietly rendered as calm is how a plan gets priced off a hole.
          tone: (rate === null || rate === undefined ? 'unknown' : gap ? 'warn' : 'plain') as Tone,
        };
      }),
      provenance: { source: ECONOMICS_SOURCE, at, caveat: ledgerCaveat(usage) },
    });
  }

  const free = economics.free_day;
  if (free.usd === null) {
    panels.push({
      kind: 'absent',
      id: 'pacing-free-day',
      label: 'What one free day costs',
      because:
        free.gaps.join(' ') ||
        'The derivation could not be completed and has not said why, which is itself worth chasing.',
      wouldFill:
        'Enough recorded calls of each kind for a per-unit rate to mean anything. The gaps above ' +
        'name exactly which kinds are missing.',
    });
    return panels;
  }

  // Priced from a number somebody TYPED, not from a vendor's table. Gemini's text-to-speech
  // publishes no per-second rate, so `plexus/media.py` multiplies LEDGER_PRICE_SPOKEN_SECOND_USD by
  // the seconds produced — and a per-unit rate derived back out of that is a restatement of the
  // typed figure. `complete` stays true, because nothing is missing, and the figure is still only
  // as good as that number: the Spend desk always said so and the PACING desk, the one an owner
  // will price from, said nothing.
  const configured = num(free.configured_calls);
  const typedNote =
    configured > 0
      ? `${count(configured)} of the calls under this figure were priced from a number we entered ` +
        'rather than a vendor price table, so it is only as good as that number. The rates table ' +
        'above names which unit.'
      : '';
  panels.push({
    kind: 'figure',
    id: 'pacing-free-day',
    label: `What one 1x day on the ${economics.plan} plan costs, at the rates measured`,
    value: usd(free.usd),
    note: [
      free.complete
        ? `derived from ${count(economics.rows)} rollup rows over ${count(economics.days)} days`
        : `a FLOOR, not the bill — ${count(free.gaps.length)} parts of it could not be derived`,
      configured > 0 ? `${count(configured)} priced from a figure we entered` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    // An incomplete derivation is never shown as though it were the answer, and neither is one
    // resting on a price we set ourselves.
    tone: free.complete && configured === 0 ? 'plain' : 'warn',
    provenance: {
      source: ECONOMICS_SOURCE,
      at,
      caveat:
        [free.complete ? '' : free.gaps.join(' '), typedNote, ledgerCaveat(usage) ?? '']
          .filter(Boolean)
          .join(' ') || undefined,
    },
  });

  if (economics.gaps.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'pacing-gaps',
      label: 'What this derivation cannot see',
      columns: ['Gap'],
      rows: economics.gaps.map((gapLine) => ({ cells: [gapLine], tone: 'warn' as Tone })),
      provenance: { source: ECONOMICS_SOURCE, at },
    });
  }

  return panels;
}

// --- HEALTH -------------------------------------------------------------------------------------
/** The gateway's three words in the console's five. `fail` is critical; there is no softer read
 *  of a check that says a request arriving now would not be served. */
export function toneOfCheck(status: string | undefined): Tone {
  if (status === 'ok') return 'ok';
  if (status === 'degraded') return 'warn';
  if (status === 'fail' || status === 'unhealthy') return 'critical';
  return 'unknown';
}

export function healthPanels(snapshot: HealthSnapshot | null, at: string | null): Panel[] {
  if (!snapshot) {
    return [
      {
        kind: 'absent',
        id: 'health-unread',
        label: 'The gateway',
        because: 'The health snapshot has not answered this console.',
        wouldFill:
          'A reachable gateway, a console session that has not expired, and a CORS policy that ' +
          'admits this console’s origin.',
      },
    ];
  }
  return [
    {
      kind: 'figure',
      id: 'health-overall',
      label: 'The gateway',
      value: snapshot.status,
      note: `mode ${snapshot.mode || 'unknown'} · build ${snapshot.version || 'unknown'}`,
      tone: toneOfCheck(snapshot.status),
      provenance: { source: HEALTH_SOURCE, at },
    },
    {
      kind: 'rows',
      id: 'health-checks',
      label: 'What each check says',
      columns: ['Check', 'State', 'Detail'],
      rows: Object.entries(snapshot.checks).map(([name, check]) => ({
        cells: [name, check.status, detailOf(check)],
        tone: toneOfCheck(check.status),
      })),
      provenance: { source: HEALTH_SOURCE, at },
    },
  ];
}

/** A check's own fields in one line. The gateway names a `reason` when something is wrong and
 *  that sentence is the most useful thing on the row; otherwise its fields are shown as they
 *  arrived. Nothing is invented and nothing is dropped silently. */
function detailOf(check: HealthCheck): string {
  if (typeof check.reason === 'string' && check.reason) return check.reason;
  const parts = Object.entries(check)
    .filter(([key]) => key !== 'status' && key !== 'reason')
    .map(
      ([key, value]) =>
        `${key} ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}`,
    );
  return parts.join(' · ') || 'nothing further';
}

// --- the strip that answers "is anything wrong right now" ----------------------------------------
export interface SummaryTile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: Tone;
  readonly detail: string;
}

/**
 * Worst first. It answers one question before any detail: is anything wrong.
 *
 * An unread source does not produce an `ok` tile — it produces an `unknown` one that says the
 * console could not read it. "We do not know" and "it is fine" are different facts, and a strip
 * that shows the second when it means the first is the exact failure this console exists to
 * avoid.
 */
export function summary(
  snapshot: HealthSnapshot | null,
  usage: UsageWindow | null,
  at: string | null,
): SummaryTile[] {
  const now = usage?.spend_now;
  const hasCeiling = now ? num(now.ceiling_usd) > 0 : false;
  const sums = usage?.readable ? totals(usage.days) : null;
  const fallbackRate = sums && sums.calls > 0 ? sums.fallbacks / sums.calls : null;

  const tiles: SummaryTile[] = [
    {
      id: 'gateway',
      label: 'Gateway',
      value: snapshot ? snapshot.status : 'not read',
      tone: snapshot ? toneOfCheck(snapshot.status) : 'unknown',
      detail: snapshot
        ? `${Object.keys(snapshot.checks).length} checks · build ${snapshot.version || 'unknown'}`
        : `the console could not read the health snapshot · ${asOf(at)}`,
    },
    {
      id: 'ceiling',
      label: 'Spend against ceiling',
      value: now ? (hasCeiling ? percent(num(now.fraction)) : 'no ceiling') : 'not read',
      tone: now ? (hasCeiling ? toneOfSpend(num(now.fraction)) : 'warn') : 'unknown',
      detail: now
        ? `${usd(num(now.spent_usd))} since this gateway started · ${count(num(now.calls))} calls`
        : 'the console could not read the live accumulator',
    },
    {
      id: 'fallbacks',
      label: 'Fallback rate',
      value: fallbackRate === null ? 'not read' : percent(fallbackRate),
      tone: fallbackRate === null ? 'unknown' : toneOfFallback(fallbackRate),
      detail:
        fallbackRate === null
          ? usage?.readable
            ? 'the ledger holds nothing for this window yet'
            : 'the console could not read the usage ledger'
          : `${count(sums?.fallbacks ?? 0)} of ${count(sums?.calls ?? 0)} recorded calls`,
    },
  ];

  // `sort` is stable in every engine this ships to, so tiles of equal tone keep the order above
  // rather than shuffling between reads.
  return [...tiles].sort((a, b) => rank(b.tone) - rank(a.tone));
}
