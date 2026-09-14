/**
 * The promo desk, as pure functions from one gateway reading to its panels.
 *
 * The sibling of `queues.ts` and `readings.ts`: those turn the queues and the money into panels,
 * this one turns the codes into panels, and none of the three fetches. The gateway has already
 * counted — `GET /v1/admin/promo` sends each code's real use count, read from
 * `ops.promo_redemptions` rather than from a column that could drift — so this file chooses a
 * tone and formats, and never sums.
 *
 * THE THREE STATES OF A READ, kept apart exactly as the queues keep theirs:
 *
 *   readable: false      we could not ask. Not a zero, and not "no codes".
 *   readable, no rows    we asked, and nothing has been minted. The panel then prints what the
 *                        gateway says feeds this desk, verbatim, so an empty desk reads as a fact
 *                        about the product rather than as a panel somebody forgot to wire.
 *   readable, rows       the codes.
 *
 * WHAT A REDEMPTION ROW SHOWS, AND WHAT IT DOES NOT. The gateway sends the same keyed digest the
 * four queues use (`promo.redemption_view`) and never a learner id, so there is no field on this
 * screen that could name a child. "Who took this code" is not a control here, because unlike a
 * refund or a support message, nothing about a promo code needs a person to be found.
 *
 * MONEY IS INTERNAL (docs/ALLOWANCE.md). This desk is the owner's, and the owner is spoken to
 * plainly, with the numbers: an allowance boost is shown in rupees a day, because that is what
 * the dial actually is. Nothing on this screen is ever shown to a learner, whose own answer says
 * "a bigger day" and carries no currency at all.
 */

import { asOf, count, type Panel, type Tone } from './panels';

/** The three kinds, verbatim from `promo.KINDS` and from migration 0027's check constraint. */
export type PromoKind = 'plan_days' | 'allowance_boost_days' | 'percent_off_first';
export const PROMO_KINDS: readonly PromoKind[] = [
  'plan_days',
  'allowance_boost_days',
  'percent_off_first',
];

/** What an operator reads instead of a database enum. */
export const KIND_WORDS: Record<PromoKind, string> = {
  plan_days: 'Days of a plan',
  allowance_boost_days: 'A bigger day',
  percent_off_first: 'Off the first payment',
};

/** One code, as `promo.code_view` sends it. Every number here is the server's. */
export interface PromoCodeRow {
  readonly id: string;
  readonly code: string;
  readonly kind: PromoKind;
  readonly value: number;
  readonly days: number | null;
  readonly plan: string | null;
  readonly provider_offer_id: string | null;
  readonly expires_at: string | null;
  readonly max_uses: number | null;
  /** Counted over `ops.promo_redemptions`, never decremented from a column. */
  readonly uses: number;
  readonly uses_left: number | null;
  readonly once_per_account: boolean;
  /** Would a learner typing it right now get past every rule? Derived by the gateway, once. */
  readonly live: boolean;
  readonly disabled_at: string | null;
  readonly note: string | null;
  readonly created_at: string | null;
}

/** What feeds this desk, in the gateway's own words. Printed verbatim, never edited here. */
export interface PromoFeed {
  readonly what: string;
  readonly feeds: string;
  readonly missing: string;
}

export interface PromoPage {
  readonly readable: boolean;
  readonly codes: readonly PromoCodeRow[];
  readonly feed?: PromoFeed;
  readonly kinds?: readonly string[];
  readonly plans?: readonly string[];
  readonly limit?: number;
  readonly shown?: number;
  readonly more?: boolean;
}

/** One redemption. A keyed digest stands in for the learner, and there is no id field to leak. */
export interface RedemptionRow {
  readonly id: string;
  readonly code: string;
  readonly kind: PromoKind;
  readonly handle: string;
  readonly granted: Readonly<Record<string, unknown>>;
  readonly subscription_id: string | null;
  readonly redeemed_at: string | null;
}

export interface RedemptionPage {
  readonly readable: boolean;
  readonly redemptions: readonly RedemptionRow[];
  readonly code: string | null;
  readonly limit?: number;
  readonly shown?: number;
  readonly more?: boolean;
}

const CODES_SOURCE = 'GET /v1/admin/promo — ops.promo_codes, newest first, uses counted per code';
const TAKEN_SOURCE = 'GET /v1/admin/promo/redemptions — ops.promo_redemptions, newest first';

// --- shape checks ---------------------------------------------------------------------------------
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPromoPage(value: unknown): value is PromoPage {
  if (!isRecord(value)) return false;
  if (typeof value.readable !== 'boolean' || !Array.isArray(value.codes)) return false;
  return value.codes.every(
    (row) => isRecord(row) && typeof row.code === 'string' && typeof row.uses === 'number',
  );
}

export function isRedemptionPage(value: unknown): value is RedemptionPage {
  if (!isRecord(value)) return false;
  if (typeof value.readable !== 'boolean' || !Array.isArray(value.redemptions)) return false;
  return value.redemptions.every(
    (row) => isRecord(row) && typeof row.code === 'string' && typeof row.handle === 'string',
  );
}

/** One code, as `POST /v1/admin/promo/create` and `/disable` hand it back. */
export function isPromoCodeRow(value: unknown): value is PromoCodeRow {
  return isRecord(value) && typeof value.code === 'string' && typeof value.kind === 'string';
}

// --- words ----------------------------------------------------------------------------------------
/** What one code grants, in one line, in the operator's register: plainly, with the numbers. */
export function grantWords(row: PromoCodeRow): string {
  if (row.kind === 'plan_days') {
    return `${row.value} days of ${row.plan ?? 'a plan'}`;
  }
  if (row.kind === 'allowance_boost_days') {
    // The owner's screen, so the dial is shown as the dial: rupees a day, for a number of days.
    return `₹${(row.value / 100).toFixed(2)} a day extra, for ${row.days ?? '?'} days`;
  }
  return `${row.value}% off the first payment`;
}

/** Why a code is not live, or an empty string when it is. One reason, the first that applies. */
export function whyNotLive(row: PromoCodeRow, now: Date = new Date()): string {
  if (row.disabled_at) return 'switched off';
  if (row.expires_at && new Date(row.expires_at) <= now) return 'expired';
  if (row.max_uses !== null && row.uses >= row.max_uses) return 'used up';
  return '';
}

/** A code's tone. Live is plain, not `ok`: a promo code is never a health reading, and a screen
 *  full of green would say the platform is well when all it says is that money can be given away. */
export function toneOfCode(row: PromoCodeRow): Tone {
  if (!row.live) return 'plain';
  if (row.max_uses !== null && row.uses_left !== null && row.uses_left <= 0) return 'plain';
  // A live code with no ceiling and no date is the one an operator should look at twice.
  if (row.max_uses === null && !row.expires_at) return 'warn';
  return 'ok';
}

/** "4 Sep 09:12 UTC", the same clock every other desk prints, and UTC for the same reason. */
export function when(iso: string | null): string {
  if (!iso) return '—';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '—';
  return `${moment.toISOString().slice(5, 10).replace('-', '/')} ${moment
    .toISOString()
    .slice(11, 16)} UTC`;
}

/** The uses column: taken against the ceiling, or taken with no ceiling at all. */
export function usesWords(row: PromoCodeRow): string {
  if (row.max_uses === null) return `${count(row.uses)} of no limit`;
  return `${count(row.uses)} of ${count(row.max_uses)}`;
}

/** What one redemption granted, in one line, from the resolved grant the gateway recorded. */
export function grantedWords(row: RedemptionRow): string {
  const granted = row.granted ?? {};
  if (row.kind === 'plan_days') {
    return `${String(granted.plan ?? '—')} to ${when(
      typeof granted.period_end === 'string' ? granted.period_end : null,
    )}`;
  }
  if (row.kind === 'allowance_boost_days') {
    const paise = typeof granted.paise_per_day === 'number' ? granted.paise_per_day : 0;
    return `₹${(paise / 100).toFixed(2)} a day to ${when(
      typeof granted.until === 'string' ? granted.until : null,
    )}`;
  }
  return `${String(granted.percent ?? '—')}% off ${row.subscription_id ?? 'a checkout'}`;
}

// --- the panels -------------------------------------------------------------------------------------
/**
 * The desk. `page` carries the codes and `taken` the redemptions; either may have failed
 * independently, and a failure of either produces an absence rather than an empty table.
 */
export function promoPanels(
  page: PromoPage | null,
  taken: RedemptionPage | null,
  at: string | null,
): Panel[] {
  const panels: Panel[] = [];

  if (!page?.readable) {
    panels.push({
      kind: 'absent',
      id: 'promo-unreadable',
      label: 'Promo codes',
      because:
        'The console could not reach ops.promo_codes, so there is no list to show. This is not ' +
        '"no codes": nothing here says whether any exist.',
      wouldFill:
        'A gateway that can reach its project. Check the health desk first, then whether the ' +
        'gateway has SUPABASE_URL and a service-role key — without them the promo store refuses ' +
        'rather than answering from memory, which is why this reads as an absence.',
    });
  } else {
    const live = page.codes.filter((row) => row.live).length;
    panels.push({
      kind: 'figure',
      id: 'promo-live',
      label: 'Codes a learner could use right now',
      value: count(live),
      note: `${count(page.codes.length)} minted in total, including the ones switched off`,
      tone: live > 0 ? 'plain' : 'ok',
      provenance: { source: CODES_SOURCE, at },
    });

    if (page.codes.length > 0) {
      panels.push({
        kind: 'rows',
        id: 'promo-codes',
        label: 'Every code',
        columns: ['Code', 'Grants', 'Taken', 'Per account', 'Expires', 'State'],
        rows: page.codes.map((row) => ({
          id: row.id,
          cells: [
            row.code,
            grantWords(row),
            usesWords(row),
            row.once_per_account ? 'once' : 'any number',
            when(row.expires_at),
            row.live ? 'live' : whyNotLive(row) || 'not live',
          ],
          tone: toneOfCode(row),
        })),
        provenance: {
          source: CODES_SOURCE,
          at,
          caveat:
            page.more === true
              ? `This is the first ${count(page.shown)} codes, not all of them. Nothing here is a ` +
                'total.'
              : undefined,
        },
      });
    }
  }

  if (taken && !taken.readable) {
    panels.push({
      kind: 'absent',
      id: 'promo-taken-unreadable',
      label: 'Codes taken',
      because: 'The console could not reach ops.promo_redemptions, so there is no trail to show.',
      wouldFill: 'The same gateway that would fill the list above.',
    });
  } else if (taken?.readable && taken.redemptions.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'promo-taken',
      label: taken.code ? `Codes taken: ${taken.code}` : 'Codes taken',
      columns: ['Code', 'Kind', 'Account', 'Granted', 'When'],
      rows: taken.redemptions.map((row) => ({
        id: row.id,
        cells: [
          row.code,
          KIND_WORDS[row.kind] ?? row.kind,
          // A keyed digest, exactly as on the four queues: enough to notice the same account
          // twice, never enough to look anybody up. There is no field here that could be an id.
          row.handle,
          grantedWords(row),
          when(row.redeemed_at),
        ],
        tone: 'plain',
      })),
      provenance: { source: TAKEN_SOURCE, at },
    });
  }

  if (page?.feed) {
    // Always on the desk, full or empty, for the same reason the queues carry theirs: what does
    // and does not reach a desk is a fact about the product, and an operator looking at an empty
    // desk needs it more than one looking at a full desk does.
    panels.push({
      kind: 'absent',
      id: 'promo-feed',
      label: 'What reaches this desk',
      because: `${page.feed.what} It fills from ${page.feed.feeds}`,
      wouldFill: page.feed.missing,
    });
  }

  return panels;
}

/** The one-line summary the desk head prints. Exported so a test can hold it to the reading. */
export function promoSummary(page: PromoPage | null, at: string | null): string {
  if (!page?.readable) return `Codes could not be read. ${asOf(at)}.`;
  const live = page.codes.filter((row) => row.live).length;
  return `${count(live)} live of ${count(page.codes.length)} minted. ${asOf(at)}.`;
}
