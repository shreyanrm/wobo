/**
 * NO PANEL MAY SHOW A NUMBER IT CANNOT SOURCE. The owner's hardest standing law, held here.
 *
 * Three ways this console could break it, and one test each:
 *   1. A figure with no provenance. Impossible by type, and proved by walking every panel every
 *      reading can produce and asserting the source and the freshness are on it.
 *   2. A desk with nothing behind it drawing an empty chart, or saying "coming soon" instead of
 *      what would fill it.
 *   3. A fixture. A sample row, a demo mode, a seeded figure that looks real — the thing this
 *      repo has been caught doing three times. The source of the whole console is scanned for it.
 *
 * And the distinction the desks live or die by: "we could not ask" is never rendered as a zero.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { Economics, HealthSnapshot, UsageDay, UsageWindow } from './contract';
import { DESKS } from './desks';
import type { Panel } from './panels';
import { healthPanels, modelPanels, pacingPanels, spendPanels, summary } from './readings';

// --- a reading, built by hand, so the assertions are about the mapping and not about a fixture --
const SPEND_NOW = { day: '2026-09-04', spent_usd: 4.5, ceiling_usd: 25, fraction: 0.18, calls: 90 };

function usageWindow(days: Partial<UsageDay>[], readable = true): UsageWindow {
  return {
    since: '2026-08-06',
    until: '2026-09-04',
    readable,
    days: days.map((day) => ({
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
      ...day,
    })),
    ledger: {},
    spend_now: SPEND_NOW,
    ceiling_usd: 25,
  };
}

const HEALTH: HealthSnapshot = {
  status: 'degraded',
  mode: 'live',
  version: 'abc1234',
  checks: {
    config: { status: 'ok', env: 'prod' },
    spend: { status: 'degraded', reason: 'the day’s spend ceiling is shedding load' },
  },
};

const ECONOMICS: Economics = {
  since: '2026-08-06',
  until: '2026-09-04',
  plan: 'free',
  days: 0,
  rows: 0,
  per_unit: [],
  attach: {},
  free_day: { usd: null, complete: false, components: [], gaps: ['the usage ledger is empty'] },
  gaps: ['the usage ledger is empty'],
};

/** Every panel this console can produce, from a full reading and from an absent one. */
function everyPanel(): Panel[] {
  const full = usageWindow([{ calls: 10, cost_usd: 1.25, fallback_calls: 3, unit_count: 40 }]);
  return [
    ...spendPanels(full, '2026-09-04T10:00:00.000Z'),
    ...spendPanels(usageWindow([]), null),
    ...spendPanels(usageWindow([], false), null),
    ...spendPanels(null, null),
    ...modelPanels(full, null),
    ...modelPanels(null, null),
    ...pacingPanels(full, ECONOMICS, null),
    ...pacingPanels(null, null, null),
    ...healthPanels(HEALTH, null),
    ...healthPanels(null, null),
  ];
}

describe('every number carries its provenance', () => {
  it('names a source on every panel that shows one', () => {
    for (const panel of everyPanel()) {
      if (panel.kind === 'absent') continue;
      expect(panel.provenance.source.length).toBeGreaterThan(12);
      // Chaseable: an endpoint or a module, never "the system".
      expect(panel.provenance.source).toMatch(/\/v1\/admin\/|wobo_gateway|ops\./);
    }
  });

  it('and every panel with no number says what would fill it', () => {
    const absent = everyPanel().filter((panel) => panel.kind === 'absent');
    expect(absent.length).toBeGreaterThan(0);
    for (const panel of absent) {
      if (panel.kind !== 'absent') continue;
      // `because` may be a sentence the SERVER wrote (unit_economics hands back its own gaps in
      // words), so it is held to being present and specific rather than to a length this console
      // does not control. `wouldFill` is always ours, and is held to being a piece of work.
      expect(panel.because.trim().length).toBeGreaterThan(15);
      expect(panel.because.toLowerCase()).not.toMatch(/coming soon|not available|no data yet\.?$/);
      expect(panel.wouldFill.length).toBeGreaterThan(40);
      expect(panel.wouldFill.toLowerCase()).not.toContain('coming soon');
      // An absent panel has no `value` field at all — the type has no room for one.
      expect('value' in panel).toBe(false);
    }
  });

  it('and every desk with no supplier says why and what would end it', () => {
    const unsupplied = DESKS.filter((desk) => desk.supply.kind === 'none');
    expect(unsupplied.length).toBeGreaterThan(0);
    for (const desk of unsupplied) {
      if (desk.supply.kind !== 'none') continue;
      // Specific enough to name a module or a table an engineer can open.
      expect(desk.supply.because).toMatch(/wobo_gateway|learner\.|ops\.|migration|row-level/);
      expect(desk.supply.wouldFill.length).toBeGreaterThan(60);
    }
  });
});

describe('"could not ask" is never rendered as "nothing happened"', () => {
  it('shows an unreachable ledger as an absence, not as a zero', () => {
    const panels = spendPanels(usageWindow([], false), null);
    const window = panels.find(
      (panel) => panel.id.startsWith('The ledger') || panel.kind === 'absent',
    );
    expect(window?.kind).toBe('absent');
    if (window?.kind === 'absent') expect(window.because).toContain('could not reach');
    // And no figure anywhere in that desk claims a recorded total.
    expect(panels.some((panel) => panel.kind === 'figure' && panel.id === 'spend-window')).toBe(
      false,
    );
  });

  it('shows a readable but empty ledger as its own, different absence', () => {
    const panels = spendPanels(usageWindow([]), null);
    const absent = panels.find((panel) => panel.kind === 'absent');
    expect(absent?.kind).toBe('absent');
    if (absent?.kind === 'absent') {
      expect(absent.because).toContain('readable');
      expect(absent.because).toContain('nothing');
      expect(absent.because).not.toContain('could not reach');
    }
  });

  it('never summarises an unread source as ok', () => {
    for (const tile of summary(null, null, null)) {
      expect(tile.tone).not.toBe('ok');
      expect(tile.value).toBe('not read');
    }
  });

  it('and calls no trend when there is only one day to look at', () => {
    const oneDay = spendPanels(usageWindow([{ calls: 1, cost_usd: 1 }]), null);
    const against = oneDay.find((panel) => panel.id === 'spend-today-vs');
    // It may say WHY there is no comparison — that is the honest empty state — but it may never
    // put a figure and a percentage on one day of weather.
    expect(against === undefined || against.kind === 'absent').toBe(true);
  });
});

describe('there is no fixture anywhere in the console', () => {
  const CONSOLE = import.meta.dir;
  const files = readdirSync(CONSOLE, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
    .filter((entry) => !entry.name.endsWith('.test.ts'))
    .map((entry) => join(CONSOLE, entry.name));

  /** Comments are stripped first, so a note that names a banned word in order to ban it — as this
   *  file's own neighbours do — is not itself a violation. */
  function shipped(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
  }

  it('holds no sample, demo, seed or placeholder data', () => {
    // No trailing \b on the PREFIXES: `\bSAMPLE_\b` never matches `SAMPLE_SPEND`, because a
    // word boundary needs a non-word character and `_S` is two word characters. That mistake
    // would have made this whole test pass on exactly the thing it exists to catch.
    const banned =
      /\b(sampleData|sampleRows|SAMPLE_[A-Z]|DEMO_[A-Z]|demoMode|FIXTURE|MOCK_[A-Z]|placeholder(Data|Rows)|fakeRows|seedRows|STUB_[A-Z])/;
    const guilty = files
      .filter((path) => banned.test(shipped(path)))
      .map((path) => relative(CONSOLE, path));
    expect(guilty).toEqual([]);
  });

  it('and no module outside the readings does arithmetic on a figure', () => {
    // The whole console sums in exactly one place (`readings.groupBy`/`totals`). A second one
    // would be a second answer to the same question, which is how two panels come to disagree.
    const arithmetic = files
      // `readings` sums, `panels` formats, and `contract` only DECLARES the row's field names —
      // a type is not arithmetic. Everything else must not touch a figure at all.
      .filter(
        (path) => !['readings.ts', 'panels.ts', 'contract.ts'].includes(relative(CONSOLE, path)),
      )
      .filter((path) => /\breduce\(|\bcost_usd\b|\bcalls\s*[+\-*/]/.test(shipped(path)))
      .map((path) => relative(CONSOLE, path));
    expect(arithmetic).toEqual([]);
  });
});
