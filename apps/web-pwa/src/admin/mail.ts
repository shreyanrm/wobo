/**
 * The mail desk (wave 56, the deliverability watch), as pure functions from one gateway reading to
 * its panels.
 *
 * `GET /v1/admin/mail` (services/gateway `mailwatch/api.py`) has already counted: the complaint
 * rate overall and per kind over the last seven days, set against the two lines the law draws
 * (0.10 percent pauses that kind, 0.30 percent is Gmail's cliff), the bounces, how many addresses
 * are suppressed, where each seed landed, Gmail's own day from Postmaster Tools, which kinds are
 * paused and why, and every alert. This file formats and never sums.
 *
 * NOBODY IS NAMED. A suppressed address is a count, and no type here has a field that could carry
 * an address or a digest.
 *
 * THE THREE STATES OF A READ, kept apart as every desk keeps them: a read that failed is an absence
 * that says so, a check nobody configured says "not configured" and names what would configure
 * it, and a number is never invented for either.
 */

import { asOf, count, type Panel, type Tone } from './panels';

export type RateState = 'ok' | 'over_pause' | 'over_cliff' | 'no_mail';

export interface KindRate {
  readonly kind: string;
  readonly delivered: number;
  readonly complained: number;
  readonly rate: number | null;
  readonly state: RateState;
  readonly paused: boolean;
}

export interface SeedResult {
  readonly provider: string;
  readonly kind: string;
  readonly tab: string;
  readonly folder: string | null;
  readonly day: string | null;
  readonly auth: Readonly<Record<string, string>>;
  readonly at: string;
}

export interface PostmasterReading {
  readonly day: string;
  readonly domain: string;
  readonly spam_rate: number | null;
  readonly kinds: Readonly<Record<string, number>>;
  readonly auth: Readonly<Record<string, number>>;
  readonly verdict: { readonly state: string; readonly reason: string };
  readonly needs_work: readonly string[];
  readonly read_at?: string;
}

export interface MailDesk {
  readonly at: string;
  readonly readable: boolean;
  readonly thresholds: {
    readonly pause: number;
    readonly cliff: number;
    readonly window_days: number;
    readonly min_complaints: number;
  };
  readonly complaints: {
    readonly overall: {
      readonly delivered: number;
      readonly complained: number;
      readonly rate: number | null;
      readonly hard_bounces: number;
      readonly soft_bounces: number;
      readonly delayed: number;
      readonly state: RateState;
    };
    readonly kinds: readonly KindRate[];
  };
  readonly bounces: {
    readonly hard: number;
    readonly soft: number;
    readonly delayed: number;
    readonly suppressed_by_provider: number;
    readonly failed: number;
  };
  readonly days: readonly {
    readonly day: string;
    readonly kind: string;
    readonly event: string;
    readonly count: number;
  }[];
  readonly suppressed: { readonly count: number };
  readonly paused: readonly {
    readonly kind: string;
    readonly since: string | null;
    readonly reason: string | null;
    readonly source: string | null;
    readonly rate: number | null;
    readonly threshold: number | null;
  }[];
  readonly never_paused: readonly string[];
  readonly placement: {
    readonly configured: boolean;
    readonly live: boolean;
    readonly providers: readonly { readonly provider: string; readonly configured: boolean }[];
    readonly kinds: readonly string[];
    readonly send_hour: number;
    readonly zone: string;
    readonly results: readonly SeedResult[];
  };
  readonly postmaster: {
    readonly configured: boolean;
    readonly reading: PostmasterReading | null;
    readonly note: string;
  };
  readonly webhook: {
    readonly configured: boolean;
    readonly path: string;
    readonly last_event_at: string | null;
  };
  readonly alerts: readonly {
    readonly at: string;
    readonly cause: string;
    readonly kind: string | null;
    readonly severity: string | null;
    readonly message: string | null;
    readonly action: string | null;
    /** Whether the owner's mail about it actually went. One that did not is tried every hour. */
    readonly mailed: boolean;
  }[];
  readonly alert_to_set: boolean;
  readonly streams: {
    readonly learning: string;
    readonly transactional: string;
    readonly separate: boolean;
    readonly variable: string;
  };
}

// --- the shape ------------------------------------------------------------------------------------
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isRate = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const STATES: readonly RateState[] = ['ok', 'over_pause', 'over_cliff', 'no_mail'];
const isState = (value: unknown): value is RateState =>
  typeof value === 'string' && (STATES as readonly string[]).includes(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function isKindRate(value: unknown): value is KindRate {
  return (
    isRecord(value) &&
    isText(value.kind) &&
    isCount(value.delivered) &&
    isCount(value.complained) &&
    isRate(value.rate) &&
    isState(value.state) &&
    typeof value.paused === 'boolean'
  );
}

function isSeedResult(value: unknown): value is SeedResult {
  return (
    isRecord(value) &&
    isText(value.provider) &&
    isText(value.kind) &&
    isText(value.tab) &&
    isTextOrNull(value.folder) &&
    isTextOrNull(value.day) &&
    isRecord(value.auth) &&
    isText(value.at)
  );
}

function isReading(value: unknown): value is PostmasterReading {
  if (value === null) return true;
  return (
    isRecord(value) &&
    isText(value.day) &&
    isText(value.domain) &&
    isRate(value.spam_rate) &&
    isRecord(value.kinds) &&
    isRecord(value.auth) &&
    isRecord(value.verdict) &&
    Array.isArray(value.needs_work)
  );
}

export function isMailDesk(body: unknown): body is MailDesk {
  if (!isRecord(body) || !isText(body.at) || typeof body.readable !== 'boolean') return false;
  const { thresholds, complaints, bounces, suppressed, placement, postmaster, webhook, streams } =
    body;
  if (!isRecord(thresholds) || !isRate(thresholds.pause) || !isRate(thresholds.cliff)) return false;
  if (!isRecord(complaints) || !isRecord(complaints.overall)) return false;
  const overall = complaints.overall;
  if (!isCount(overall.delivered) || !isCount(overall.complained) || !isRate(overall.rate)) {
    return false;
  }
  if (!isState(overall.state)) return false;
  if (!Array.isArray(complaints.kinds) || !complaints.kinds.every(isKindRate)) return false;
  if (!isRecord(bounces) || !['hard', 'soft', 'delayed'].every((k) => isCount(bounces[k]))) {
    return false;
  }
  if (!Array.isArray(body.days)) return false;
  if (!isRecord(suppressed) || !isCount(suppressed.count)) return false;
  if (!Array.isArray(body.paused) || !body.paused.every((p) => isRecord(p) && isText(p.kind))) {
    return false;
  }
  if (!Array.isArray(body.never_paused)) return false;
  if (
    !isRecord(placement) ||
    typeof placement.configured !== 'boolean' ||
    !Array.isArray(placement.results) ||
    !placement.results.every(isSeedResult) ||
    !Array.isArray(placement.providers)
  ) {
    return false;
  }
  if (
    !isRecord(postmaster) ||
    typeof postmaster.configured !== 'boolean' ||
    !isReading(postmaster.reading ?? null) ||
    !isText(postmaster.note)
  ) {
    return false;
  }
  if (!isRecord(webhook) || typeof webhook.configured !== 'boolean') return false;
  if (!isTextOrNull(webhook.last_event_at ?? null)) return false;
  if (
    !Array.isArray(body.alerts) ||
    !body.alerts.every((a) => isRecord(a) && isText(a.cause) && typeof a.mailed === 'boolean')
  ) {
    return false;
  }
  return isRecord(streams) && typeof streams.separate === 'boolean';
}

// --- the words ------------------------------------------------------------------------------------
/** A complaint rate to two places, because the lines are 0.10 and 0.30. */
export function rateWords(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(2)}%`;
}

const STATE_WORDS: Record<RateState, string> = {
  ok: 'under both',
  over_pause: 'over 0.10%',
  over_cliff: 'over 0.30%',
  no_mail: 'no mail counted',
};

const STATE_TONE: Record<RateState, Tone> = {
  ok: 'ok',
  over_pause: 'warn',
  over_cliff: 'critical',
  no_mail: 'unknown',
};

/** "complaint_rate" -> "complaint rate". Causes and reasons are the gateway's own words. */
function spaced(value: string | null): string {
  return (value ?? '').replaceAll('_', ' ');
}

function severityTone(severity: string | null): Tone {
  if (severity === 'critical') return 'critical';
  if (severity === 'warn') return 'warn';
  return 'plain';
}

const GOOD_TABS = new Set(['primary', 'inbox']);

/** Where a seed landed, as a tone: spam or missing, or a failed check, is critical; any tab but
 *  Primary is worth a look; Primary, or the inbox where no tab is shown, is fine. */
export function placementTone(tab: string, auth: Readonly<Record<string, string>>): Tone {
  if (tab === 'spam' || tab === 'missing') return 'critical';
  if (Object.values(auth).some((verdict) => verdict !== 'pass')) return 'critical';
  if (GOOD_TABS.has(tab)) return 'ok';
  return tab === 'unknown' ? 'unknown' : 'warn';
}

function authWords(auth: Readonly<Record<string, string>>): string {
  const order = ['spf', 'dkim', 'dmarc'].filter((m) => m in auth);
  return order.length ? order.map((m) => `${m} ${auth[m]}`).join(', ') : 'not reported';
}

/** The kinds the one control may lift. */
export function pausedKinds(desk: MailDesk | null): string[] {
  return desk ? desk.paused.map((p) => p.kind) : [];
}

const SOURCE = 'GET /v1/admin/mail · ops.mail_watch (0036)';

// --- the panels -----------------------------------------------------------------------------------
export function mailPanels(desk: MailDesk | null, at: string | null): Panel[] {
  if (!desk) {
    return [
      {
        kind: 'absent',
        id: 'mail-unread',
        label: 'Mail',
        because: 'The mail desk did not answer, so there is nothing to show from here.',
        wouldFill: 'The gateway answering GET /v1/admin/mail.',
      },
    ];
  }
  const provenance = {
    source: SOURCE,
    at: desk.at || at,
    caveat:
      `Over the last ${desk.thresholds.window_days} days. A kind is paused over 0.10%, and ` +
      'at 0.30% (Gmail’s cliff) every kind that crossed is. Sign-in codes and receipts never are.',
  };
  const panels: Panel[] = [];

  if (!desk.readable) {
    panels.push({
      kind: 'absent',
      id: 'mail-unreadable',
      label: 'Complaint rate',
      because:
        'The gateway answered but could not read ops.mail_watch when it started, so these ' +
        'rates are not zero, they are unknown.',
      wouldFill: 'The project answering, with migration 0036 applied, and the gateway restarted.',
    });
  } else {
    const overall = desk.complaints.overall;
    panels.push(
      {
        kind: 'figure',
        id: 'mail-complaints',
        label: 'Complaint rate, every kind',
        value: rateWords(overall.rate),
        note: `${count(overall.complained)} complaints in ${count(overall.delivered)} delivered.`,
        tone: STATE_TONE[overall.state],
        provenance,
      },
      {
        kind: 'rows',
        id: 'mail-kinds',
        label: 'Complaint rate by kind',
        columns: ['Kind', 'Delivered', 'Complaints', 'Rate', 'Against 0.10% and 0.30%', 'Paused'],
        rows: desk.complaints.kinds.map((row) => ({
          id: row.kind,
          cells: [
            row.kind,
            count(row.delivered),
            count(row.complained),
            rateWords(row.rate),
            STATE_WORDS[row.state],
            row.paused ? 'paused' : '',
          ],
          tone: STATE_TONE[row.state],
        })),
        provenance,
      },
      {
        kind: 'figure',
        id: 'mail-bounces',
        label: 'Hard bounces',
        value: count(desk.bounces.hard),
        note:
          `${count(desk.bounces.soft)} soft, ${count(desk.bounces.delayed)} delayed, ` +
          `${count(desk.bounces.suppressed_by_provider)} refused by the provider’s own list.`,
        tone: desk.bounces.hard > 0 ? 'warn' : 'ok',
        provenance,
      },
      {
        kind: 'figure',
        id: 'mail-suppressed',
        label: 'Suppressed addresses',
        value: count(desk.suppressed.count),
        note:
          'Every address that complained or hard-bounced, for good. A count, never a list. ' +
          'They still get sign-in codes and receipts.',
        tone: 'plain',
        provenance: { source: SOURCE, at: desk.at || at },
      },
    );
  }

  if (desk.paused.length === 0) {
    panels.push({
      kind: 'figure',
      id: 'mail-paused',
      label: 'Paused kinds',
      value: 'none',
      note: 'Every kind is going out at its usual pace.',
      tone: 'ok',
      provenance,
    });
  } else {
    panels.push({
      kind: 'rows',
      id: 'mail-paused',
      label: 'Paused kinds',
      columns: ['Kind', 'Why', 'From', 'Rate', 'Since'],
      rows: desk.paused.map((row) => ({
        id: row.kind,
        cells: [
          row.kind,
          spaced(row.reason),
          row.source === 'postmaster' ? 'Gmail (Postmaster)' : 'the provider’s events',
          rateWords(row.rate),
          row.since ?? '—',
        ],
        tone: 'warn' as Tone,
      })),
      provenance: {
        ...provenance,
        caveat: 'Only the owner lifts a pause, below. Every other kind carried on throughout.',
      },
    });
  }

  if (desk.alerts.length === 0) {
    panels.push({
      kind: 'figure',
      id: 'mail-alerts',
      label: 'Alerts',
      value: 'none',
      note: 'Nothing about the mail has been raised in the rows this gateway holds.',
      tone: 'ok',
      provenance,
    });
  } else {
    // WHETHER EACH WAS MAILED, row by row (2026-09-16). The caveat used to say every alert had
    // been mailed while a missing provider key or an outage had held every one of them.
    const inbox = desk.alert_to_set
      ? 'DELIVERABILITY_ALERT_TO'
      : 'the owner’s default inbox (DELIVERABILITY_ALERT_TO is unset)';
    panels.push({
      kind: 'rows',
      id: 'mail-alerts',
      label: 'Alerts',
      columns: ['When', 'Cause', 'Kind', 'What happened', 'What was done', 'Mailed'],
      rows: desk.alerts.map((row, index) => ({
        id: `${row.at}-${row.cause}-${row.kind ?? 'all'}-${index}`,
        cells: [
          row.at,
          spaced(row.cause),
          row.kind ?? '',
          row.message ?? '',
          row.action ?? '',
          row.mailed ? 'yes' : 'not yet, tried again every hour',
        ],
        tone: row.mailed ? severityTone(row.severity) : ('critical' as Tone),
      })),
      provenance: {
        ...provenance,
        caveat:
          `Mailed says whether the mail to ${inbox} went. Every alert was also raised on the ` +
          'alarm and kept here, whether or not its mail went.',
      },
    });
  }

  if (!desk.placement.configured) {
    panels.push({
      kind: 'absent',
      id: 'mail-placement',
      label: 'Seed inboxes',
      because:
        'The placement check is not configured: no seed inbox is set, so nothing is sent to one ' +
        'and nothing is read.',
      wouldFill:
        'MAIL_SEED_GMAIL_ADDRESS and MAIL_SEED_GMAIL_PASSWORD (an app password), and the same ' +
        'pair for OUTLOOK, YAHOO and APPLE, for inboxes we own.',
    });
  } else if (desk.placement.results.length === 0) {
    panels.push({
      kind: 'absent',
      id: 'mail-placement',
      label: 'Seed inboxes',
      because: desk.placement.live
        ? 'No seed has been read yet.'
        : 'The gateway is not sending live mail, so no seed can land anywhere.',
      wouldFill:
        `The first pass after ${desk.placement.send_hour}:00 in ${desk.placement.zone}, and ` +
        'the read that follows fifteen minutes later.',
    });
  } else {
    panels.push({
      kind: 'rows',
      id: 'mail-placement',
      label: 'Seed inboxes',
      columns: ['Inbox', 'Kind', 'Landed in', 'Day', 'Authentication'],
      rows: desk.placement.results.map((row) => ({
        id: `${row.provider}-${row.kind}`,
        cells: [row.provider, row.kind, row.tab, row.day ?? '—', authWords(row.auth)],
        tone: placementTone(row.tab, row.auth),
      })),
      provenance: {
        ...provenance,
        caveat:
          'One real mail of each kind a day, to inboxes we own. Outlook, Yahoo and Apple show no ' +
          'tab over IMAP, so "inbox" is the most they say.',
      },
    });
  }

  const google = desk.postmaster;
  if (!google.configured) {
    panels.push({
      kind: 'absent',
      id: 'mail-postmaster',
      label: 'Gmail, from Postmaster Tools',
      because: `Postmaster Tools is not configured. ${google.note}`,
      wouldFill:
        'POSTMASTER_CLIENT_ID, POSTMASTER_CLIENT_SECRET and POSTMASTER_REFRESH_TOKEN, and ' +
        'POSTMASTER_DOMAIN when the registered domain is not the sending one.',
    });
  } else if (!google.reading) {
    panels.push({
      kind: 'absent',
      id: 'mail-postmaster',
      label: 'Gmail, from Postmaster Tools',
      because: `No day has been published yet. ${google.note}`,
      wouldFill: 'A day with enough Gmail volume for Postmaster Tools to report it.',
    });
  } else {
    const day = google.reading;
    const rate = day.spam_rate;
    const tone: Tone =
      rate === null
        ? 'unknown'
        : rate > desk.thresholds.cliff
          ? 'critical'
          : rate > desk.thresholds.pause
            ? 'warn'
            : 'ok';
    const problems = day.needs_work.length ? `; needs work: ${day.needs_work.join(', ')}` : '';
    panels.push({
      kind: 'figure',
      id: 'mail-postmaster',
      label: `Gmail spam rate, ${day.day}`,
      value: rateWords(rate),
      note:
        `${day.domain}. Verdict: ${spaced(day.verdict.reason) || 'none'}` +
        ` (${day.verdict.state || 'no state'})${problems}.`,
      tone: day.needs_work.length ? 'warn' : tone,
      provenance: { ...provenance, caveat: google.note },
    });
  }

  panels.push(
    {
      kind: 'figure',
      id: 'mail-webhook',
      label: 'Provider events',
      value: desk.webhook.configured ? asOf(desk.webhook.last_event_at) : 'not configured',
      note: desk.webhook.configured
        ? `Signed events arrive at ${desk.webhook.path}.`
        : `RESEND_WEBHOOK_SECRET is unset, so ${desk.webhook.path} refuses every event.`,
      tone: desk.webhook.configured ? (desk.webhook.last_event_at ? 'ok' : 'unknown') : 'warn',
      provenance,
    },
    {
      kind: 'figure',
      id: 'mail-streams',
      label: 'Sender for sign-in codes and receipts',
      value: desk.streams.separate ? 'its own stream' : 'shared',
      note: desk.streams.separate
        ? `${desk.streams.transactional}; learning notes stay on ${desk.streams.learning}.`
        : `${desk.streams.variable} is unset, so every mail goes from ${desk.streams.learning}. ` +
          'A sender changes only by hand.',
      tone: 'plain',
      provenance,
    },
  );
  return panels;
}
