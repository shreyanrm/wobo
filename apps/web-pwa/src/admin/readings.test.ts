/**
 * The desks that have numbers: that they read the rollup the way the rollup is defined, and that
 * every number on the screen can be traced back to a row.
 *
 * The rollup is SUMS ONLY — the migration says a stored average cannot be re-averaged and a
 * stored distinct count cannot be added up — so the assertions below are about summing and about
 * dividing sums, and there is nothing here that reads an average off a row.
 *
 * The awkward case each test is really about: PostgREST returns `numeric` as a STRING. A silent
 * NaN would print "$NaN" on the owner's money screen, so the parsing is pinned here.
 */

import { describe, expect, it } from 'bun:test';
import type { Economics, UsageDay, UsageWindow } from './contract';
import { usd } from './panels';
import {
  droppedRows,
  groupBy,
  modelPanels,
  pacingPanels,
  rollupNote,
  spendPanels,
  summary,
  toneOfFallback,
  toneOfSpend,
  totals,
  unitValue,
} from './readings';

function row(fields: Partial<UsageDay>): UsageDay {
  return {
    day: '2026-09-04',
    capability: 'wobo.turn',
    model_served: 'a-model',
    plan: 'free',
    unit_kind: 'message',
    calls: 0,
    cache_hits: 0,
    fallback_calls: 0,
    anonymous_calls: 0,
    unpriced_calls: 0,
    configured_calls: 0,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    unit_count: 0,
    latency_ms_total: 0,
    // ops.usage_daily stamps this on every row it writes (migration 0018, not null default now()),
    // so a fixture without one is a shape the database cannot produce.
    rolled_at: '2026-09-04T00:00:00+00:00',
    ...fields,
  };
}

function windowOf(days: UsageDay[], spend: Partial<UsageWindow['spend_now']> = {}): UsageWindow {
  return {
    since: '2026-08-06',
    until: '2026-09-04',
    readable: true,
    days,
    ledger: {},
    spend_now: {
      day: '2026-09-04',
      spent_usd: 1,
      ceiling_usd: 25,
      fraction: 0.04,
      calls: 5,
      ...spend,
    },
    ceiling_usd: 25,
    rolled_at: days.length > 0 ? '2026-09-04T00:00:00+00:00' : null,
    rollup_interval_s: 900,
  };
}

/** A derivation as `GET /v1/admin/economics` sends it, with a spoken rate we priced ourselves. */
function economicsOf(over: Partial<Economics> = {}): Economics {
  return {
    since: '2026-08-06',
    until: '2026-09-04',
    plan: 'free',
    days: 30,
    rows: 12,
    per_unit: [
      { unit_kind: 'turn', usd_per_unit: 0.01, calls: 40, units: 40, cost_usd: 0.4, gap: null },
      {
        unit_kind: 'spoken_second',
        usd_per_unit: 0.00002,
        calls: 40,
        units: 400,
        cost_usd: 0.008,
        gap: '40 of 40 spoken_second calls were priced from a figure we entered',
      },
    ],
    attach: { spoken_second: 10 },
    free_day: {
      usd: 0.41,
      complete: true,
      components: [],
      gaps: [],
      configured_calls: 40,
    },
    gaps: [],
    ...over,
  } as Economics;
}

describe('the rollup is summed, never averaged', () => {
  it('adds a numeric that arrived as a string, rather than printing NaN at the owner', () => {
    const sums = totals([
      row({ cost_usd: '1.50' as unknown as number, calls: 2 }),
      row({ cost_usd: 0.25, calls: 1 }),
    ]);
    expect(sums.cost).toBeCloseTo(1.75, 6);
    expect(usd(sums.cost)).toBe('$1.75');
    expect(sums.calls).toBe(3);
  });

  it('groups by a key column and sorts the biggest spender first', () => {
    const grouped = groupBy(
      [
        row({ model_served: 'cheap', cost_usd: 0.1, calls: 9 }),
        row({ model_served: 'dear', cost_usd: 4, calls: 1 }),
        row({ model_served: 'dear', cost_usd: 1, calls: 1 }),
      ],
      'model_served',
    );
    expect(grouped.map(([name]) => name)).toEqual(['dear', 'cheap']);
    const dearest = grouped[0]?.[1];
    expect(dearest?.cost).toBeCloseTo(5, 6);
    expect(dearest?.calls).toBe(2);
  });
});

describe('a ledger that lost rows says so, in the shape the gateway actually reports', () => {
  it('adds the three drop counters the gateway names, not a field called "dropped"', () => {
    // ledger.state() has no `dropped`. Reading one would silently always be zero, and every
    // total on the money desk would then be shown as complete when it was a floor.
    expect(droppedRows({ dropped: 99 })).toBe(0);
    expect(
      droppedRows({ dropped_buffer_full: 2, dropped_write_failed: 3, dropped_unconfigured: 1 }),
    ).toBe(6);
    expect(droppedRows(undefined)).toBe(0);
  });

  it('puts the loss on the panel, naming which fault lost them', () => {
    const window = windowOf([row({ cost_usd: 5, calls: 5 })]);
    const lossy: UsageWindow = { ...window, ledger: { dropped_write_failed: 4 } };
    const panels = spendPanels(lossy, null);
    const figure = panels.find((panel) => panel.id === 'spend-window');
    expect(figure?.kind === 'figure' && figure.provenance.caveat).toContain('4 rows never reached');
    expect(figure?.kind === 'figure' && figure.provenance.caveat).toContain('write failed');
    expect(figure?.kind === 'figure' && figure.provenance.caveat).toContain('floor');
  });

  it('and says nothing about losses when nothing was lost', () => {
    const panels = spendPanels(windowOf([row({ cost_usd: 5, calls: 5 })]), null);
    const figure = panels.find((panel) => panel.id === 'spend-window');
    const caveat = figure?.kind === 'figure' ? (figure.provenance.caveat ?? '') : '';
    expect(caveat).not.toContain('never reached the ledger');
    expect(caveat).not.toContain('could not be read');
  });
});

describe('spend', () => {
  it('changes colour at the lines spend.py actually sheds load at', () => {
    // Below a member's degrade line, at it, and past the point a member is refused outright.
    expect(toneOfSpend(0.5)).toBe('ok');
    expect(toneOfSpend(0.8)).toBe('warn');
    expect(toneOfSpend(1)).toBe('critical');
  });

  it('shows the live ceiling and the recorded history as two different figures', () => {
    const panels = spendPanels(
      windowOf([row({ cost_usd: 2, calls: 4 })], { spent_usd: 9, fraction: 0.36 }),
      null,
    );
    const now = panels.find((panel) => panel.id === 'spend-now');
    const window = panels.find((panel) => panel.id === 'spend-window');
    expect(now?.kind === 'figure' && now.value).toBe('$9.00');
    expect(window?.kind === 'figure' && window.value).toBe('$2.00');
    // And the live one carries the restart caveat on the screen, not in a docstring.
    expect(now?.kind === 'figure' && now.provenance.caveat).toContain('reset by any restart');
  });

  it('puts the unpriced calls beside the money instead of folding them into it', () => {
    const panels = spendPanels(
      windowOf([row({ cost_usd: 1, calls: 10, unpriced_calls: 4 })]),
      null,
    );
    const window = panels.find((panel) => panel.id === 'spend-window');
    expect(window?.kind === 'figure' && window.note).toContain('4 calls could not be priced');
    expect(window?.kind === 'figure' && window.provenance.caveat).toContain('FLOOR');
  });

  it('compares the last COMPLETE day with the days before it, never the day still filling', () => {
    // `until` is the gateway's own UTC today, so 2026-09-04 is the day in progress. The comparison
    // is 09-03 against 09-02, and today's part-day is nowhere in it: a part-day measured against
    // whole days reads as a collapse every single morning, which is how an operator learns to
    // ignore the one panel that exists to catch a real anomaly.
    const three = spendPanels(
      windowOf([
        row({ day: '2026-09-02', cost_usd: 1, calls: 1 }),
        row({ day: '2026-09-03', cost_usd: 3, calls: 1 }),
        row({ day: '2026-09-04', cost_usd: 0.01, calls: 1 }),
      ]),
      null,
    );
    const against = three.find((panel) => panel.id === 'spend-today-vs');
    expect(against?.kind === 'figure' && against.label).toContain('2026-09-03');
    expect(against?.kind === 'figure' && against.value).toBe('$3.00');
    expect(against?.kind === 'figure' && against.note).toContain('up 200%');
    // A jump that size is worth a colour, because it is the owner's money.
    expect(against?.kind === 'figure' && against.tone).toBe('warn');
    // And it says out loud that today is left out, rather than leaving it to be inferred.
    expect(against?.kind === 'figure' && against.provenance.caveat).toContain('2026-09-04');
  });

  it('will not compare at all when the only day recorded is the one still filling', () => {
    const today = spendPanels(windowOf([row({ day: '2026-09-04', cost_usd: 3, calls: 1 })]), null);
    const against = today.find((panel) => panel.id === 'spend-today-vs');
    expect(against?.kind).toBe('absent');
  });
});

describe('models', () => {
  it('reads the fallback rate as an early warning, not as a cost line', () => {
    expect(toneOfFallback(0.01)).toBe('ok');
    expect(toneOfFallback(0.05)).toBe('warn');
    expect(toneOfFallback(0.2)).toBe('critical');
  });

  it('counts fallbacks over calls across the whole window', () => {
    const panels = modelPanels(
      windowOf([
        row({ model_served: 'primary', calls: 8, fallback_calls: 0 }),
        row({ model_served: 'stand-in', calls: 2, fallback_calls: 2 }),
      ]),
      null,
    );
    const rate = panels.find((panel) => panel.id === 'models-fallback');
    expect(rate?.kind === 'figure' && rate.value).toBe('20%');
    expect(rate?.kind === 'figure' && rate.tone).toBe('critical');
    const table = panels.find((panel) => panel.id === 'models-table');
    expect(table?.kind === 'rows' && table.rows.length).toBe(2);
  });
});

describe('pacing', () => {
  it('writes spoken and filmed units as time and everything else as a count', () => {
    expect(unitValue('speech_seconds', 90)).toBe('1m 30s');
    expect(unitValue('message', 90)).toBe('90');
  });

  it('labels the unit table as a share of COST and says the allowance is a different number', () => {
    const panels = pacingPanels(
      windowOf([
        row({ unit_kind: 'message', cost_usd: 1, unit_count: 100 }),
        row({ unit_kind: 'speech_seconds', cost_usd: 3, unit_count: 600 }),
      ]),
      null,
      null,
    );
    const units = panels.find((panel) => panel.id === 'pacing-units');
    expect(units?.kind === 'rows' && units.columns).toContain('Share of cost');
    expect(units?.kind === 'rows' && units.provenance.caveat).toContain('not share of allowance');
    // Biggest cost first, and time written as time.
    expect(units?.kind === 'rows' && units.rows[0]?.cells.slice(0, 4)).toEqual([
      'speech_seconds',
      '10m 00s',
      '$3.00',
      '75%',
    ]);
  });

  it('refuses to print an incomplete free-day cost as though it were the bill', () => {
    const economics: Economics = {
      since: '2026-08-06',
      until: '2026-09-04',
      plan: 'free',
      days: 3,
      rows: 12,
      per_unit: [],
      attach: {},
      free_day: { usd: 0.4, complete: false, components: [], gaps: ['no video seconds recorded'] },
      gaps: ['no video seconds recorded'],
    };
    const panels = pacingPanels(windowOf([row({ calls: 1 })]), economics, null);
    const free = panels.find((panel) => panel.id === 'pacing-free-day');
    expect(free?.kind === 'figure' && free.note).toContain('a FLOOR, not the bill');
    expect(free?.kind === 'figure' && free.tone).toBe('warn');
    expect(free?.kind === 'figure' && free.provenance.caveat).toContain(
      'no video seconds recorded',
    );
  });
});

describe('the summary strip', () => {
  it('puts the worst thing first', () => {
    const tiles = summary(
      { status: 'ok', mode: 'live', version: 'v', checks: { config: { status: 'ok' } } },
      windowOf([row({ calls: 10, fallback_calls: 5 })], { fraction: 0.1 }),
      null,
    );
    expect(tiles[0]?.id).toBe('fallbacks');
    expect(tiles[0]?.tone).toBe('critical');
    expect(tiles.at(-1)?.tone).toBe('ok');
  });

  it('and says "not read" rather than a healthy zero when a source did not answer', () => {
    const tiles = summary(null, null, null);
    expect(tiles.every((tile) => tile.value === 'not read')).toBe(true);
    expect(tiles.every((tile) => tile.tone === 'unknown')).toBe(true);
  });
});

// =================================================================================================
// The second pass: what the rollup panels were quietly getting wrong.
// =================================================================================================
describe('the rollup is a cache, and every panel now says how old it is', () => {
  it('prints when the rows were last rolled up, beside when they were fetched', () => {
    // Every panel stamped the moment of the FETCH, which reads as live. ops.usage_daily is rebuilt
    // on a cadence (a quarter of an hour by default) on top of a five second flush, so today's row
    // can be well behind reality. The stamp was already on the wire and was thrown away.
    const fresh = {
      ...windowOf([row({ cost_usd: 1, calls: 1 })]),
      rolled_at: new Date(Date.now() - 60_000).toISOString(),
      rollup_interval_s: 900,
    };
    expect(rollupNote(fresh)).toContain('rolled up');
    expect(rollupNote(fresh)).toContain('Rebuilt every 15 minutes');
  });

  it('warns when the newest row is older than the rollup interval allows', () => {
    const stale = {
      ...windowOf([row({ cost_usd: 1, calls: 1 })]),
      rolled_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      rollup_interval_s: 900,
    };
    expect(rollupNote(stale)).toContain('more than twice');
  });

  it('says the freshness is unknown rather than assuming it, when no row carries a stamp', () => {
    const unstamped = {
      ...windowOf([row({ cost_usd: 1, calls: 1 })]),
      rolled_at: null,
    };
    expect(rollupNote(unstamped)).toContain('unknown');
  });

  it('puts that note on every rollup panel, not only on two of them', () => {
    // `ledgerState` was attached to `spend-window` and `models-fallback` and to nothing else, so
    // the by-capability table, the model table and both pacing panels reported floors as totals.
    const lossy: UsageWindow = {
      ...windowOf([row({ cost_usd: 5, calls: 5, unit_kind: 'message' })]),
      ledger: { dropped_write_failed: 4 },
    };
    const ids = [
      ...spendPanels(lossy, null),
      ...modelPanels(lossy, null),
      ...pacingPanels(lossy, economicsOf(), null),
    ]
      // `spend-now` is the LIVE accumulator, not the rollup; it carries its own restart caveat and
      // has nothing to say about rows the ledger dropped.
      .filter((panel) => panel.kind !== 'absent' && panel.id !== 'spend-now');
    for (const panel of ids) {
      if (panel.kind === 'absent') continue;
      expect(panel.provenance.caveat ?? '').toContain('never reached the ledger');
    }
    expect(ids.length).toBeGreaterThan(4);
  });
});

describe('a figure that could not be read is counted, never swallowed', () => {
  it('leaves it out of the sum AND says how many were left out', () => {
    // `num()` counted anything unparseable as nothing, so a malformed cost vanished into a sum and
    // the panel presented the remainder as the whole: an understated money total with no counter.
    const sums = totals([
      row({ cost_usd: 1, calls: 1 }),
      row({ cost_usd: 'not-a-number' as unknown as number, calls: 1 }),
    ]);
    expect(sums.cost).toBe(1);
    expect(sums.unreadable).toBe(1);

    const panels = spendPanels(
      windowOf([
        row({ cost_usd: 1, calls: 1 }),
        row({ cost_usd: 'not-a-number' as unknown as number, calls: 1 }),
      ]),
      null,
    );
    const figure = panels.find((panel) => panel.id === 'spend-window');
    expect(figure?.kind === 'figure' && figure.note).toContain('could not be read');
    expect(figure?.kind === 'figure' && figure.provenance.caveat).toContain('floor');
  });

  it('does not count an absent column as a fault', () => {
    // An older rollup row may simply not carry a column. Absent and malformed are different facts.
    const sums = totals([{ ...row({ calls: 1 }), cache_hits: undefined as unknown as number }]);
    expect(sums.unreadable).toBe(0);
  });
});

describe('a model with no priced call is not a model that costs nothing', () => {
  it('says "no priced calls" instead of $0.00, and tones it unknown', () => {
    // engines.py records finished video seconds as a DELIVERY row carrying the real video model and
    // cost_usd null; the rollup coalesces that to 0 and counts 0 calls. Rendered as money, the
    // model that actually made the video read as "$0.00 · 0 calls", toned ok: "video is free".
    const panels = modelPanels(
      windowOf([
        row({ model_served: 'a-text-model', calls: 10, cost_usd: 2 }),
        row({ model_served: 'a-video-model', calls: 0, cost_usd: 0, unit_kind: 'video_second' }),
      ]),
      null,
    );
    const table = panels.find((panel) => panel.id === 'models-table');
    const video =
      table?.kind === 'rows'
        ? table.rows.find((entry) => entry.cells[0] === 'a-video-model')
        : null;
    expect(video?.cells[1]).toBe('no priced calls');
    expect(video?.cells[1]).not.toBe('$0.00');
    expect(video?.tone).toBe('unknown');
    expect(table?.kind === 'rows' && table.provenance.caveat).toContain('delivery rows only');
  });
});

describe('the pacing desk shows the rates the day was built from', () => {
  it('draws every per-unit rate, with its own gap beside it', () => {
    // `economics.per_unit` was computed, serialised over the wire, typed in contract.ts and never
    // drawn: the owner saw the day total and not the rates it was built from.
    const panels = pacingPanels(windowOf([row({ calls: 1 })]), economicsOf(), null);
    const rates = panels.find((panel) => panel.id === 'pacing-rates');
    expect(rates?.kind).toBe('rows');
    const kinds = rates?.kind === 'rows' ? rates.rows.map((entry) => entry.cells[0]) : [];
    expect(kinds).toContain('turn');
    expect(kinds).toContain('spoken_second');
    const spoken =
      rates?.kind === 'rows'
        ? rates.rows.find((entry) => entry.cells[0] === 'spoken_second')
        : null;
    expect(spoken?.cells[5]).toContain('a figure we entered');
  });

  it('names a price we typed on the free-day figure, even when nothing is missing', () => {
    // `complete` stayed true and the panel said nothing, on the one desk an owner prices from.
    const panels = pacingPanels(windowOf([row({ calls: 1 })]), economicsOf(), null);
    const day = panels.find((panel) => panel.id === 'pacing-free-day');
    expect(day?.kind === 'figure' && day.note).toContain('priced from a figure we entered');
    expect(day?.kind === 'figure' && day.tone).toBe('warn');
    expect(day?.kind === 'figure' && day.provenance.caveat).toContain(
      'only as good as that number',
    );
  });

  it('and stays plain when every rate came from a real price table', () => {
    const clean = economicsOf({
      per_unit: [{ unit_kind: 'turn', usd_per_unit: 0.01, calls: 40, units: 40, cost_usd: 0.4 }],
      free_day: { usd: 0.4, complete: true, components: [], gaps: [], configured_calls: 0 },
    });
    const panels = pacingPanels(windowOf([row({ calls: 1 })]), clean, null);
    const day = panels.find((panel) => panel.id === 'pacing-free-day');
    expect(day?.kind === 'figure' && day.tone).toBe('plain');
  });
});
