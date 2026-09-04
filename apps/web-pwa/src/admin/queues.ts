/**
 * The four queue desks — flags, bugs, support, refund requests — as pure functions from one
 * gateway reading to its panels.
 *
 * The sibling of `readings.ts`: that file turns the money into panels, this one turns the queues
 * into panels, and neither fetches. Everything here is arithmetic-free on purpose — the gateway
 * has already counted (`GET /v1/admin/desks` returns per-state totals), so this file only chooses
 * a tone and formats. One place sums, and it is not this one.
 *
 * THE THREE STATES OF A QUEUE READ, kept apart exactly as the ledger's three are, because merging
 * any two of them would be a lie:
 *
 *   readable: false      we could not ask. Not a zero, and not an empty table.
 *   readable, no rows    we asked, and nothing has come in through the routes that feed it. The
 *                        panel then prints what those routes ARE, in the gateway's own words
 *                        (`feeds` and `missing`, served by the route rather than written here),
 *                        so "empty" reads as a fact about the product and not as a broken panel.
 *   readable, rows       the queue.
 *
 * WHAT A ROW SHOWS, AND WHAT IT DOES NOT. The gateway sends a queue row with no learner id and no
 * address on it — `desks_api.queue_view` justifies every field it does send. The identity of the
 * person behind a refund or a support message is a SECOND call, on a second permission, with its
 * own line in the audit trail, and this console never makes it on its own initiative: it is a
 * control an operator presses, and pressing it is recorded.
 *
 * A FLAG IS NOT A TICKET. `upsetting` and `unsafe` mean a child may be upset or at risk, so those
 * rows are `critical` and sit at the top, and the flag desk's own summary tile says so on the
 * strip above every desk. Nothing else on this console may outrank them.
 */

import type { Fetched } from './api';
import { asOf, count, type Panel, type Tone } from './panels';

/** The four queues. Their names here are the gateway's `kind` values, verbatim. */
export type QueueKind = 'flag' | 'bug' | 'support' | 'refund';
export const QUEUE_KINDS: readonly QueueKind[] = ['flag', 'bug', 'support', 'refund'];

/** `ops.reports.state`, in the order a report moves through them. */
export type ReportState = 'new' | 'looked_at' | 'acted_on' | 'closed';

/** What an operator reads instead of a database enum. The gateway's words, spelled for people. */
export const STATE_WORDS: Record<ReportState, string> = {
  new: 'Not opened',
  looked_at: 'Looked at',
  acted_on: 'Acted on',
  closed: 'Closed',
};

export const KIND_WORDS: Record<QueueKind, string> = {
  flag: 'Flags',
  bug: 'Bug reports',
  support: 'Support',
  refund: 'Refund requests',
};

/** One desk's counts, as `desks_api.desk_summary` sends them. Every number is the server's. */
export interface DeskCounts {
  readonly states: Readonly<Record<ReportState, number>>;
  readonly open: number;
  readonly urgent: number;
  readonly total: number;
}

/** What actually feeds a desk today, in the gateway's own words. Printed verbatim, never edited
 *  here: when a route is added, the sentence changes in `desks_api.FEEDS` and this console
 *  follows without a second copy to keep in step. */
export interface DeskFeed {
  readonly what: string;
  readonly feeds: string;
  readonly missing: string;
}

export interface DeskSummary {
  readonly readable: boolean;
  readonly desks: Partial<Readonly<Record<QueueKind, DeskCounts>>>;
  readonly feeds: Readonly<Record<string, DeskFeed>>;
  /** Did the gateway's count reach the end of ops.reports? `false` makes every count a FLOOR. */
  readonly complete?: boolean;
  /** How many rows it scanned to get there. */
  readonly scanned?: number;
}

/** One queue row. No learner id, no address — see the module note. */
export interface QueueRow {
  readonly id: string;
  readonly kind: QueueKind;
  readonly state: ReportState;
  readonly reason: string;
  readonly urgent: boolean;
  readonly note: string | null;
  /** Eight characters of a KEYED DIGEST of the learner id: enough to spot the same person twice
   *  on this desk, and not matchable against an id learned anywhere else. `—` when the gateway has
   *  no pepper configured, which is an absence and not an identity. */
  readonly handle: string;
  readonly about: Readonly<Record<string, string>>;
  readonly source: string;
  readonly raised_at: string | null;
  readonly moved_at: string | null;
  readonly moved_by: string | null;
  readonly resolution: string | null;
}

export interface QueuePage {
  readonly readable: boolean;
  readonly reports: readonly QueueRow[];
  readonly kind: string | null;
  readonly state: string | null;
  /** THIS IS A PAGE. The three fields say so, because a desk with 200 open reports used to look
   *  like a desk with 50, under a count from a different source that disagreed with no
   *  explanation. `more` is true when the page came back full. */
  readonly limit?: number;
  readonly shown?: number;
  readonly more?: boolean;
}

/** Who raised one report. Only ever the answer to a control an operator pressed. */
export interface RaisedBy {
  readonly id: string;
  readonly learner_id: string | null;
  readonly reply_to: string | null;
}

const SUMMARY_SOURCE = 'GET /v1/admin/desks — ops.reports, counted by the gateway';
const QUEUE_SOURCE = 'GET /v1/admin/reports — ops.reports, urgent first then newest';

// --- shape checks ---------------------------------------------------------------------------------
// An answer that fails one of these is `unrecognised` rather than trusted, which is the difference
// between an empty desk and a desk showing whatever a confused proxy happened to return.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isDeskSummary(value: unknown): value is DeskSummary {
  if (!isRecord(value)) return false;
  if (typeof value.readable !== 'boolean') return false;
  if (!isRecord(value.desks) || !isRecord(value.feeds)) return false;
  return Object.values(value.desks).every(
    (desk) => isRecord(desk) && typeof desk.total === 'number' && isRecord(desk.states),
  );
}

export function isQueuePage(value: unknown): value is QueuePage {
  if (!isRecord(value)) return false;
  if (typeof value.readable !== 'boolean' || !Array.isArray(value.reports)) return false;
  return value.reports.every(
    (row) => isRecord(row) && typeof row.id === 'string' && typeof row.reason === 'string',
  );
}

/** One row, as `POST /v1/admin/reports/state` hands the moved report back. */
export function isQueueRow(value: unknown): value is QueueRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.state === 'string' &&
    typeof value.reason === 'string'
  );
}

export function isRaisedBy(value: unknown): value is RaisedBy {
  return isRecord(value) && typeof value.id === 'string';
}

// --- tone -----------------------------------------------------------------------------------------
/** A queue's state, as a colour. `unknown` when the read failed, never `ok`: not knowing whether
 *  a child has flagged something is not the same as knowing nobody has. */
export function toneOfDesk(counts: DeskCounts | undefined): Tone {
  if (!counts) return 'unknown';
  if (counts.urgent > 0) return 'critical';
  if (counts.open > 0) return 'warn';
  return 'ok';
}

/** A row's tone. A safety flag is critical wherever it appears; a settled row is quiet. */
export function toneOfRow(row: QueueRow): Tone {
  if (row.urgent && row.state !== 'closed') return 'critical';
  if (row.state === 'new') return 'warn';
  return 'plain';
}

/** "4 Sep 09:12 UTC" — short, and UTC for the same reason every other clock on this console is. */
export function when(iso: string | null): string {
  if (!iso) return '—';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '—';
  return `${moment.toISOString().slice(5, 10).replace('-', '/')} ${moment
    .toISOString()
    .slice(11, 16)} UTC`;
}

/** A reason code as a person reads it. The gateway's vocabulary, unhyphenated, never invented. */
export function reasonWords(reason: string): string {
  return reason.replaceAll('_', ' ');
}

/** The `about` pointers on one line, or nothing. Never the learner's work — the gateway filters
 *  that at intake against an allow-list, and there is no field here that could hold it. */
export function aboutWords(about: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(about ?? {})) parts.push(`${key}: ${value}`);
  return parts.join(' · ');
}

// --- the panels -------------------------------------------------------------------------------------
/**
 * One desk. `summary` carries the counts, `page` the rows; either may have failed independently,
 * and a failure of either produces an absence rather than a zero.
 */
export function queuePanels(
  kind: QueueKind,
  summary: DeskSummary | null,
  page: QueuePage | null,
  at: string | null,
): Panel[] {
  const feed = summary?.feeds?.[kind];
  const panels: Panel[] = [];

  if (!summary?.readable) {
    panels.push({
      kind: 'absent',
      id: `${kind}-counts-unreadable`,
      label: `${KIND_WORDS[kind]} waiting`,
      because:
        'The console could not reach ops.reports, so there is no count to show. This is not ' +
        'zero: nothing here says whether anybody has raised one.',
      wouldFill:
        'A gateway that can reach its project. Check the health desk first, then whether the ' +
        'gateway has SUPABASE_URL and a service-role key — without them the reports store ' +
        'refuses rather than answering from memory, which is why this reads as an absence.',
    });
  } else {
    const counts = summary.desks[kind];
    // ops.reports only ever GROWS — migration 0017 grants no delete, because closing a report is a
    // state — so a count that had to stop scanning is a FLOOR, and the rows it missed are the
    // OLDEST: an old, still-open urgent flag would drop out while this tile said "none open".
    const partial = summary.complete === false;
    panels.push({
      kind: 'figure',
      id: `${kind}-open`,
      label: `${KIND_WORDS[kind]} waiting`,
      value: count(counts?.open),
      note:
        counts && counts.urgent > 0
          ? `${count(counts.urgent)} of them from a learner who said something upset them or was unsafe`
          : `${count(counts?.total)} in total, including the ones already settled`,
      // A truncated tally can never be read as "nothing waiting": not knowing is not fine.
      tone: partial && toneOfDesk(counts) === 'ok' ? 'unknown' : toneOfDesk(counts),
      provenance: {
        source: SUMMARY_SOURCE,
        at,
        caveat: partial
          ? `The gateway stopped after ${count(summary.scanned)} rows, so this is a FLOOR and not ` +
            'the count. The rows it did not reach are the oldest, which is where an old open ' +
            'report would be. ops.reports needs a real aggregate before this desk grows further.'
          : undefined,
      },
    });
  }

  if (feed) {
    // Always on the desk, full or empty. What reaches this queue is a fact about the PRODUCT, and
    // an operator looking at an empty desk needs it more than one looking at a full desk does.
    panels.push({
      kind: 'absent',
      id: `${kind}-feed`,
      label: 'What reaches this desk',
      because: `${feed.what} It fills from ${feed.feeds}`,
      wouldFill: feed.missing,
    });
  }

  if (!page?.readable) {
    panels.push({
      kind: 'absent',
      id: `${kind}-queue-unreadable`,
      label: 'The queue',
      because:
        'The console could not reach ops.reports, so the queue is not shown. An empty table ' +
        'here would say nobody has written in, and nothing on this screen knows that.',
      wouldFill:
        'The same fix as the count above: a gateway that can reach its project. Until then the ' +
        'honest position is that this console cannot see the queue, not that the queue is empty.',
    });
    return panels;
  }

  if (page.reports.length === 0) {
    panels.push({
      kind: 'absent',
      id: `${kind}-queue-empty`,
      label: 'The queue',
      because:
        'ops.reports is readable and nothing has come in through the routes above. This is a ' +
        'real empty queue rather than a failed read, and the two are drawn the same way on ' +
        'purpose: neither of them is a number.',
      wouldFill: feed
        ? feed.missing
        : 'Somebody raising one through the intake routes this desk reads.',
    });
    return panels;
  }

  const shown = page.reports.length;
  const waiting = summary?.desks?.[kind]?.total;
  panels.push({
    kind: 'rows',
    id: `${kind}-queue`,
    // The label is the page, stated. Open work sorts first (reports.py orders new and looked_at
    // above everything settled), so what is cut off the bottom is the settled tail and not
    // somebody still waiting — but how much was cut off is still a fact the desk has to carry.
    label: page.more
      ? `The queue — showing the first ${count(shown)}${
          typeof waiting === 'number' ? ` of ${count(waiting)}` : ''
        }, open work first`
      : `The queue — all ${count(shown)}, open work first`,
    columns: ['Raised', 'Reason', 'State', 'Who', 'What they said', 'About'],
    rows: page.reports.map((row) => ({
      id: row.id,
      cells: [
        when(row.raised_at),
        row.urgent ? `${reasonWords(row.reason)} · needs a person first` : reasonWords(row.reason),
        row.moved_by ? `${STATE_WORDS[row.state]} · ${row.moved_by}` : STATE_WORDS[row.state],
        row.handle,
        row.note ?? '—',
        aboutWords(row.about),
      ],
      tone: toneOfRow(row),
    })),
    provenance: {
      source: QUEUE_SOURCE,
      at,
      caveat: [
        'No learner id and no address on any row: a queue is read to work it, not to identify ' +
          'anybody. Who raised a refund or a support message is a separate, audited look, and ' +
          'the seat that may take it is an operator or an owner, never a viewer.',
        page.more
          ? 'This page is full, so there are more rows than are drawn here. A queue is worked, ' +
            'not scrolled: the answer to a full page is to close some.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  });
  return panels;
}

/**
 * The one tile the four queues put on the strip above every desk.
 *
 * Only one, and only about flags, because the strip answers "is anything wrong right now" and a
 * child saying they were upset is the only thing in these four queues that answers it. A bug
 * report and a support message are work; they belong on their desk and not in the alarm line.
 */
export function urgentTile(
  summary: DeskSummary | null,
  at: string | null,
): { id: string; label: string; value: string; detail: string; tone: Tone } {
  if (!summary?.readable) {
    return {
      id: 'flags-urgent',
      label: 'Safety flags',
      value: 'not read',
      detail: 'The console could not reach ops.reports. This is not the same as none.',
      tone: 'unknown',
    };
  }
  const flags = summary.desks.flag;
  const urgent = flags?.urgent ?? 0;
  // A tally that stopped early cannot say "none open" in mint. The rows it missed are the oldest,
  // and an old, still-open, urgent safety flag is precisely what would be missing.
  const partial = summary.complete === false;
  if (urgent === 0 && partial) {
    return {
      id: 'flags-urgent',
      label: 'Safety flags',
      value: 'not counted in full',
      detail:
        `The gateway stopped counting after ${count(summary.scanned)} rows, oldest last, so ` +
        'nothing here says no flag is waiting.',
      tone: 'unknown',
    };
  }
  return {
    id: 'flags-urgent',
    label: 'Safety flags',
    value: urgent > 0 ? count(urgent) : 'none open',
    detail:
      urgent > 0
        ? 'A learner said something upset them or was unsafe. Read these before anything else.'
        : `Nothing waiting. ${asOf(at)}.`,
    tone: urgent > 0 ? 'critical' : 'ok',
  };
}

/** What a failed identity look is called on screen. The console never guesses at a name. */
export function raisedByWords(result: Fetched<RaisedBy> | null): string {
  if (!result) return '';
  if (!result.ok) return 'The gateway did not answer that look.';
  return (
    [result.value.learner_id, result.value.reply_to].filter(Boolean).join(' · ') ||
    'nothing recorded'
  );
}
