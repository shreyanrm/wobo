/**
 * The four queue desks, held to the same law as the money desks: NO PANEL MAY SHOW A NUMBER IT
 * CANNOT SOURCE, and "we could not ask" is never drawn as "nothing came in".
 *
 * `honesty.test.ts` proves that for the readings that existed before this wave. These are the
 * same proofs for the four this wave added, plus the two that are particular to a queue over
 * children's reports:
 *
 *   * a safety flag is `critical` and reaches the strip above every desk, because a child saying
 *     something upset them outranks every other reading on this console;
 *   * a queue row never carries a learner id, an address, or anything the learner was studying —
 *     asserted against the panel a full page produces, not against the type.
 */

import { describe, expect, it } from 'bun:test';
import { DESKS } from './desks';
import type { Panel } from './panels';
import {
  type DeskCounts,
  type DeskSummary,
  KIND_WORDS,
  QUEUE_KINDS,
  type QueueKind,
  type QueuePage,
  type QueueRow,
  queuePanels,
  toneOfDesk,
  toneOfRow,
  urgentTile,
} from './queues';

const LEARNER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

function counts(over: { open?: number; urgent?: number; total?: number } = {}): DeskCounts {
  return {
    states: { new: over.open ?? 0, looked_at: 0, acted_on: 0, closed: 0 },
    open: over.open ?? 0,
    urgent: over.urgent ?? 0,
    total: over.total ?? over.open ?? 0,
  };
}

function summaryOf(over: Partial<DeskSummary> = {}): DeskSummary {
  return {
    readable: true,
    desks: {},
    feeds: {
      flag: {
        what: 'A learner telling us something Wobo produced is wrong, confusing or upsetting.',
        feeds: 'POST /v1/flags, from the flag control in the learner app.',
        missing:
          'A report carries the reason, the words if any, and pointers at what was on screen. ' +
          'There is no picture of the screen and no message back when one is settled.',
      },
    },
    ...over,
  } as DeskSummary;
}

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 'r1',
    kind: 'flag',
    state: 'new',
    reason: 'wrong',
    urgent: false,
    note: 'it said 7 times 8 was 54',
    handle: LEARNER_ID.slice(0, 8),
    about: { surface: 'board', content_id: 'concept-42' },
    source: 'app',
    raised_at: '2026-09-04T09:12:00.000Z',
    moved_at: null,
    moved_by: null,
    resolution: null,
    ...over,
  };
}

function page(rows: QueueRow[], readable = true): QueuePage {
  return { readable, reports: rows, kind: 'flag', state: null };
}

/** Every panel these four desks can produce, from a full reading and from each failure. */
function everyPanel(): Panel[] {
  const full = summaryOf({ desks: { flag: counts({ open: 3, urgent: 1, total: 9 }) } });
  const out: Panel[] = [];
  for (const kind of QUEUE_KINDS) {
    out.push(
      ...queuePanels(
        kind,
        full,
        page([row(), row({ id: 'r2', urgent: true })]),
        '2026-09-04T10:00:00.000Z',
      ),
    );
    out.push(...queuePanels(kind, full, page([]), null));
    out.push(...queuePanels(kind, full, page([], false), null));
    out.push(...queuePanels(kind, summaryOf({ readable: false }), null, null));
    out.push(...queuePanels(kind, null, null, null));
  }
  return out;
}

describe('every queue panel carries its provenance', () => {
  it('names a chaseable source on every panel that shows a number', () => {
    for (const panel of everyPanel()) {
      if (panel.kind === 'absent') continue;
      expect(panel.provenance.source).toMatch(/\/v1\/admin\/|ops\./);
      expect(panel.provenance.source.length).toBeGreaterThan(12);
    }
  });

  it('and every panel with no number says why and what would fill it', () => {
    const absent = everyPanel().filter((panel) => panel.kind === 'absent');
    expect(absent.length).toBeGreaterThan(0);
    for (const panel of absent) {
      if (panel.kind !== 'absent') continue;
      expect(panel.because.trim().length).toBeGreaterThan(15);
      expect(panel.because.toLowerCase()).not.toMatch(/coming soon|not available|no data yet\.?$/);
      expect(panel.wouldFill.length).toBeGreaterThan(40);
      expect('value' in panel).toBe(false);
    }
  });

  it('and each of the four desks declares a live supplier naming ops.reports', () => {
    for (const kind of QUEUE_KINDS) {
      const desk = DESKS.find((entry) => entry.id === kind);
      expect(desk).toBeDefined();
      expect(desk?.supply.kind).toBe('live');
      if (desk?.supply.kind === 'live') expect(desk.supply.from).toContain('ops.reports');
    }
  });
});

describe('"could not ask" is never drawn as "nothing came in"', () => {
  it('shows an unreadable summary as an absence rather than as zero waiting', () => {
    const panels = queuePanels('flag', summaryOf({ readable: false }), null, null);
    expect(panels.every((panel) => panel.kind === 'absent')).toBe(true);
    const first = panels[0];
    if (first?.kind === 'absent') expect(first.because).toContain('could not reach');
  });

  it('shows a readable but empty queue as its own, different absence', () => {
    const panels = queuePanels('flag', summaryOf({ desks: { flag: counts() } }), page([]), null);
    const empty = panels.find((panel) => panel.id === 'flag-queue-empty');
    expect(empty?.kind).toBe('absent');
    if (empty?.kind === 'absent') {
      expect(empty.because).toContain('readable');
      expect(empty.because).not.toContain('could not reach');
    }
    // And the count beside it IS a figure, because zero is a fact once the read succeeded.
    const waiting = panels.find((panel) => panel.id === 'flag-open');
    expect(waiting?.kind).toBe('figure');
  });

  it('never summarises an unread queue as none open', () => {
    const tile = urgentTile(null, null);
    expect(tile.value).toBe('not read');
    expect(tile.tone).toBe('unknown');
    expect(urgentTile(summaryOf({ readable: false }), null).tone).toBe('unknown');
  });

  it('and a desk with no counts is unknown rather than ok', () => {
    expect(toneOfDesk(undefined)).toBe('unknown');
    expect(toneOfDesk(counts())).toBe('ok');
    expect(toneOfDesk(counts({ open: 2 }))).toBe('warn');
    expect(toneOfDesk(counts({ open: 2, urgent: 1 }))).toBe('critical');
  });
});

describe('a child who is upset outranks everything else on this console', () => {
  it('puts an open safety flag on the strip as critical, with a count', () => {
    const tile = urgentTile(summaryOf({ desks: { flag: counts({ open: 2, urgent: 2 }) } }), null);
    expect(tile.tone).toBe('critical');
    expect(tile.value).toBe('2');
    expect(tile.detail.toLowerCase()).toContain('before anything else');
  });

  it('and says none open, quietly, when there are none', () => {
    const tile = urgentTile(summaryOf({ desks: { flag: counts({ total: 4 }) } }), null);
    expect(tile.tone).toBe('ok');
    expect(tile.value).toBe('none open');
  });

  it('and marks an urgent row critical until it is closed', () => {
    expect(toneOfRow(row({ urgent: true }))).toBe('critical');
    expect(toneOfRow(row({ urgent: true, state: 'looked_at' }))).toBe('critical');
    expect(toneOfRow(row({ urgent: true, state: 'closed' }))).toBe('plain');
    expect(toneOfRow(row({ state: 'new' }))).toBe('warn');
  });
});

describe('a queue row identifies nobody', () => {
  it('carries a short handle and never the learner id or an address', () => {
    const panels = queuePanels(
      'support',
      summaryOf({ desks: { support: counts({ open: 1, total: 1 }) } }),
      page([row({ kind: 'support', reason: 'plan', note: 'cannot cancel' })]),
      null,
    );
    const table = panels.find((panel) => panel.kind === 'rows');
    expect(table?.kind).toBe('rows');
    const printed = JSON.stringify(table);
    expect(printed).not.toContain(LEARNER_ID);
    expect(printed).toContain(LEARNER_ID.slice(0, 8));
    expect(printed).not.toContain('@');
    // And the panel says out loud that it is not an identity, rather than leaving it implied.
    if (table?.kind === 'rows') {
      expect(table.provenance.caveat).toContain('No learner id');
    }
  });

  it('and the desk always prints what actually reaches it, full or empty', () => {
    for (const rows of [[], [row()]]) {
      const panels = queuePanels(
        'flag',
        summaryOf({ desks: { flag: counts({ open: rows.length }) } }),
        page(rows),
        null,
      );
      const feed = panels.find((panel) => panel.id === 'flag-feed');
      expect(feed?.kind).toBe('absent');
      if (feed?.kind === 'absent') {
        // Verbatim from the gateway (desks_api.FEEDS), never a second copy written here.
        expect(feed.because).toContain('POST /v1/flags');
        // Whatever the gateway says is missing, rendered verbatim. This used to assert the exact
        // sentence 'not in the app yet', which pinned a claim that stopped being true the day the
        // flag control shipped (5 September 2026).
        expect(feed.wouldFill).toBe(summaryOf().feeds?.flag?.missing ?? '');
        expect(feed.wouldFill).not.toContain('not in the app yet');
      }
    }
  });

  it('and every desk has a name a person would use', () => {
    for (const kind of QUEUE_KINDS) {
      expect(KIND_WORDS[kind as QueueKind].length).toBeGreaterThan(3);
    }
  });
});

// =================================================================================================
// The second pass: the counts and the page were both floors that did not say so.
// =================================================================================================
describe('a truncated tally is never drawn as a count', () => {
  it('says the count is a floor, and refuses to paint "none open" in mint over it', () => {
    // ops.reports only ever grows — closing is a state, and migration 0017 grants no delete — so a
    // count that stopped scanning dropped the OLDEST rows: exactly where an old, still-open,
    // urgent safety flag would be. The tile used to say "none open" over it.
    const partial = summaryOf({
      desks: { flag: counts({ open: 0, urgent: 0, total: 0 }) },
      complete: false,
      scanned: 50000,
    });
    const panels = queuePanels('flag', partial, page([]), null);
    const waiting = panels.find((panel) => panel.id === 'flag-open');
    expect(waiting?.kind === 'figure' && waiting.tone).toBe('unknown');
    expect(waiting?.kind === 'figure' && waiting.provenance.caveat).toContain('FLOOR');

    const tile = urgentTile(partial, null);
    expect(tile.tone).toBe('unknown');
    expect(tile.value).not.toBe('none open');
  });

  it('and says nothing of the sort when the count reached the end of the table', () => {
    const whole = summaryOf({
      desks: { flag: counts({ open: 0, urgent: 0, total: 0 }) },
      complete: true,
    });
    const tile = urgentTile(whole, null);
    expect(tile.tone).toBe('ok');
    expect(tile.value).toBe('none open');
  });
});

describe('a queue page says it is a page', () => {
  it('names how many of how many are drawn when the page came back full', () => {
    // A desk with 200 open reports looked like a desk with 50, under a count from a different,
    // separately-truncated source that disagreed with no explanation.
    const full = summaryOf({ desks: { flag: counts({ open: 200, total: 240 }) } });
    const panels = queuePanels(
      'flag',
      full,
      { ...page([row(), row({ id: 'r2' })]), limit: 2, shown: 2, more: true },
      null,
    );
    const queue = panels.find((panel) => panel.id === 'flag-queue');
    expect(queue?.kind === 'rows' && queue.label).toContain('showing the first 2');
    expect(queue?.kind === 'rows' && queue.label).toContain('of 240');
    expect(queue?.kind === 'rows' && queue.provenance.caveat).toContain('more rows');
  });

  it('and says it is the whole queue when it is', () => {
    const panels = queuePanels(
      'flag',
      summaryOf({ desks: { flag: counts({ open: 1, total: 1 }) } }),
      { ...page([row()]), limit: 50, shown: 1, more: false },
      null,
    );
    const queue = panels.find((panel) => panel.id === 'flag-queue');
    expect(queue?.kind === 'rows' && queue.label).toContain('all 1');
    expect(queue?.kind === 'rows' && queue.provenance.caveat).not.toContain('more rows');
  });
});

describe('two identical rows are two rows', () => {
  it('carries each row’s own id, so nothing keyed on content can drop one', () => {
    // Rows were keyed on their joined cell text. Two identical rows — same minute, same handle,
    // same reason, no note — collided and React dropped one from the DOM: precisely the shape of a
    // duplicate submit, or of a script burying a real flag under repeats.
    const twins = [row({ id: 'first', note: null }), row({ id: 'second', note: null })];
    const panels = queuePanels('flag', summaryOf(), page(twins), null);
    const queue = panels.find((panel) => panel.id === 'flag-queue');
    const ids = queue?.kind === 'rows' ? queue.rows.map((entry) => entry.id) : [];
    expect(ids).toEqual(['first', 'second']);
    // And the cells really are identical, which is what made the old key collide.
    const cells = queue?.kind === 'rows' ? queue.rows.map((entry) => entry.cells.join('|')) : [];
    expect(cells[0]).toBe(cells[1]);
  });
});
