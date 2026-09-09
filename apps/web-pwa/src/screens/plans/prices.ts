/**
 * Every price on the plans page and the gift page, in one file.
 *
 * The numbers are the owner's, set in WOBO-PLAN §14 ("Prices", owner, 2026-09-03): free every day
 * with a daily allowance; Pro ₹1,999 a month for five times that allowance; Max ₹3,999 a month for
 * twenty times. Outside India, Pro is $20 and Max is $50, read from the reader's own browser.
 * Billed monthly, cancel any time. The words on each card are design/prototypes/site-plans.html.
 *
 * Three laws shape the file rather than decorate it:
 *
 *  · §14 — the price NEVER varies by who is looking. There is no behaviour, no cohort and no
 *    experiment in this module: `priceOf` takes a market and nothing else, and the market is the
 *    country the currency belongs to, not a segment. What varies by behaviour is the gift and the
 *    framing, and neither of those lives here.
 *  · LAW v5's copy law (DESIGN.md §0) — LOCATION IS INFERRED, NEVER ASKED. `readMarket` is the only
 *    way a surface learns which currency to show: the browser's locale, then its time zone. There
 *    is no country switch on the plans page or anywhere else, and no setter for a reader to reach.
 *  · LAW v5's copy law again — NO RAW ALLOWANCES. A tier states its allowance as a multiple of the
 *    free one and nothing else; free carries no multiplier at all. "Forty questions a day" is a
 *    number nobody asked for, and it is not in this file or on any surface that reads it.
 *  · §16 — the reference product's three price cards are kept as a SHAPE, and filled with §14's
 *    tiers rather than with its cadences: Free, Pro and Max, and there is no annual card to strike
 *    a price through.
 *  · docs/PRICING.md — A YEAR COSTS TEN MONTHS, and the canonical table there is the one this file
 *    mirrors. The yearly price is stated per month, because that is how a family compares it, and
 *    the annual total is the thing being agreed to rather than a selling number: `yearlyTotal` is
 *    read at checkout and nowhere else. `period.test.ts` holds every figure here to that rule.
 *
 * Everything that draws a price reads it from here, so a change to a number is one edit.
 */

import { ctaFor } from '../site/cta';

/** The two currency regions §14 names. Not a segment: it is the country the money is in. */
export type Market = 'IN' | 'INTL';

/**
 * How a family pays. YEARLY IS FIRST, here and in the control the page draws from this array and in
 * the period the page opens on, because it is the better deal and putting the worse one in front of
 * it would be the sort of thing this product exists not to do (docs/PRICING.md).
 */
export type Period = 'yearly' | 'monthly';
export const PERIODS = ['yearly', 'monthly'] as const;
export const DEFAULT_PERIOD: Period = 'yearly';

/** The two segments of the control, in the order `PERIODS` sets. */
export const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  yearly: 'Yearly',
  monthly: 'Monthly',
};

/**
 * What the yearly period is worth, said in months. Never a percentage: a rounded percentage is a
 * number we cannot show the working for, and two months is a number anyone can check.
 */
export const PERIOD_SAVING = 'two months free';

/** The rule, as numbers, so a test can hold every figure below to it. */
export const MONTHS_A_YEAR_COSTS = 10;
export const MONTHS_IN_A_YEAR = 12;

export interface Money {
  currency: 'INR' | 'USD';
  amount: number;
}

/**
 * What a year of one tier costs in one market — docs/PRICING.md's table, transcribed.
 *
 * Both figures are stored rather than one and a division, because the two markets round in opposite
 * directions: the rupee per-month figure is the owner's (₹1,666) and the total follows it, while the
 * dollar total is the derived one ($200, ten months of $20) and the per-month figure follows that.
 * A page that divides would show a figure the owner never wrote down. `period.test.ts` holds both
 * to the ten-months rule, so a number that drifts from the table fails rather than ships.
 */
export interface YearPrice {
  /** Shown per month on the yearly period, because that is how a family compares it. */
  perMonth: Money;
  /** Taken once, for the year. THE PLANS PAGE NEVER SHOWS THIS; the checkout always does. */
  total: Money;
}

export interface PlanTier {
  id: 'free' | 'pro' | 'max';
  name: string;
  /** What this tier's daily allowance is, as a multiple of the free one (§14). */
  allowanceMultiple: number;
  /**
   * How many learners the plan carries. ONE, ON EVERY PLAN AND EVERY PERIOD — docs/PRICING.md,
   * "The rule": "a subscription covers exactly one learner on every plan and every period". Max
   * carried two here, which put "Learners on the plan: 2", "two learners on one plan" and "two
   * learners" at checkout on the page that takes money, in both markets and on both periods,
   * against the canonical table. WOBO-PLAN §14 ("Prices", owner, 2026-09-03) does not mention
   * learners at all, so there was never a second canon to weigh this against — only a citation to
   * one. The field stays a number rather than becoming a constant so that the day the owner sells
   * a family plan, one edit here moves the card, the table and the checkout together.
   */
  learners: number;
  /** What a month costs. Null on the free tier, which has no price to state. */
  price: Readonly<Record<Market, Money>> | null;
  /**
   * What a year costs. Null exactly where `price` is null, and never on its own: a tier with one
   * and not the other could show a period the page cannot price.
   */
  yearly: Readonly<Record<Market, YearPrice>> | null;
  /** The line under the allowance. */
  blurb: string;
  /** What the card lists. */
  lines: readonly string[];
  /** The card's door. */
  cta: string;
  /**
   * The small print under the door, in the words of the period being bought. The free tier carries
   * the same line on both, because nothing about it changes with the switch.
   */
  fine: Readonly<Record<Period, string>>;
  /** The one card carrying pigment. §14 forbids a decoy, so this is the middle tier, not the top. */
  recommended: boolean;
}

/** What runs beside a price: the paid tiers are a month on BOTH periods, the free one is forever. */
export const PRICE_UNIT = { paid: 'a month', free: 'forever' } as const;

/**
 * The line under the per-month figure. It is the whole of what the plans page says about the
 * period: the amount and the words, never the total (docs/PRICING.md, owner, 2026-09-04). The
 * monthly period keeps its own line so the card cannot change height when the switch is used.
 */
export const BILLED: Readonly<Record<Period, string>> = {
  yearly: 'billed annually',
  monthly: 'billed monthly',
};

/** The sticker on the recommended card. */
export const BEST_FOR = 'most families';

/** Said under a gift's price: a gift is paid once and renews never (`gift-page.md`, rules). */
export const GIFT_CADENCE = 'paid once, renews never';

export const PLAN_TIERS: readonly PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    allowanceMultiple: 1,
    learners: 1,
    price: null,
    yearly: null,
    blurb:
      'The whole tutor. Every subject, the drawn board, the films, the practice, the Sunday note and a linked parent, with a daily allowance that refills once a day.',
    lines: [
      'A daily allowance, refilled once a day',
      'Every subject your board sets',
      'Practice, the week, the Sunday note',
      'One linked parent',
    ],
    cta: ctaFor(true).label,
    // The same line on both periods: the free plan has no period, so nothing about it changes.
    fine: { yearly: 'No card. No trial that ends.', monthly: 'No card. No trial that ends.' },
    recommended: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    allowanceMultiple: 5,
    learners: 1,
    price: { IN: { currency: 'INR', amount: 1999 }, INTL: { currency: 'USD', amount: 20 } },
    yearly: {
      IN: {
        perMonth: { currency: 'INR', amount: 1666 },
        total: { currency: 'INR', amount: 19992 },
      },
      INTL: {
        perMonth: { currency: 'USD', amount: 16.67 },
        total: { currency: 'USD', amount: 200 },
      },
    },
    blurb:
      'For a learner who leans on it most days: several times the questions, and Wobo reads its answers aloud.',
    lines: [
      'Five times the free allowance',
      'Voice replies, in your accent',
      'Longer lessons on the full board',
      'Everything in Free',
    ],
    cta: 'Choose Pro',
    fine: {
      yearly: 'Yearly. Cancel in two taps, keep it till the year you paid for ends.',
      monthly: 'Monthly. Cancel in two taps, keep it till the month ends.',
    },
    recommended: true,
  },
  {
    id: 'max',
    name: 'Max',
    allowanceMultiple: 20,
    learners: 1,
    price: { IN: { currency: 'INR', amount: 3999 }, INTL: { currency: 'USD', amount: 50 } },
    yearly: {
      IN: {
        perMonth: { currency: 'INR', amount: 3333 },
        total: { currency: 'INR', amount: 39996 },
      },
      INTL: {
        perMonth: { currency: 'USD', amount: 41.67 },
        total: { currency: 'USD', amount: 500 },
      },
    },
    // "Board year" was the prototype's word for this tier and it has been taken out: on the monthly
    // period the page must not say "year" anywhere, and a card that does makes the one test that
    // proves the page reads from a single choice unwritable.
    blurb:
      'For the boards. So many questions that nobody counts them, and every past paper your board has set.',
    lines: [
      'Twenty times the free allowance',
      'Past-paper practice sets',
      'Enough for a whole exam term',
      'Everything in Pro',
    ],
    cta: 'Choose Max',
    fine: {
      yearly: 'Yearly. Same two taps to cancel.',
      monthly: 'Monthly. Same two taps to cancel.',
    },
    recommended: false,
  },
];

/** The tier at `id`, or null. */
export function tierById(id: string): PlanTier | null {
  return PLAN_TIERS.find((t) => t.id === id) ?? null;
}

/**
 * Which market a reader is in. Law v5: where someone is reading from is not a question worth
 * asking, so it is never asked. The country comes from the browser's own region — the locale
 * first, then the time zone, because a phone set to `en-US` in Chennai still reports
 * `Asia/Kolkata`. It is a display choice and nothing more: the price is the same for everyone in a
 * market, and a reader shown the wrong currency sees a different symbol, never a different deal.
 */
export function marketFromRegion(locale?: string, timeZone?: string): Market {
  if (locale && /-IN\b/i.test(locale)) return 'IN';
  if (timeZone && /^Asia\/(Kolkata|Calcutta)$/i.test(timeZone)) return 'IN';
  return 'INTL';
}

/** The reader's market, read from the browser. `INTL` wherever there is no browser to ask. */
export function readMarket(): Market {
  if (typeof Intl === 'undefined') return 'INTL';
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    return marketFromRegion(resolved.locale, resolved.timeZone);
  } catch {
    return 'INTL';
  }
}

/**
 * What this tier costs A MONTH in this market, on this period, or null on the free tier.
 *
 * The period defaults to monthly rather than to `DEFAULT_PERIOD`, because the callers that pass no
 * period are the ones with no period to pass: a gift is a run of months bought at the monthly
 * price, and a plan quoted anywhere outside the plans page is quoted by the month.
 */
export function priceOf(tier: PlanTier, market: Market, period: Period = 'monthly'): Money | null {
  if (period === 'yearly') return tier.yearly ? tier.yearly[market].perMonth : null;
  return tier.price ? tier.price[market] : null;
}

/**
 * THE WHOLE YEAR, in one number. It belongs at checkout and nowhere else (docs/PRICING.md): it is
 * not a selling number, it is the thing being agreed to. Null on the free tier.
 */
export function yearlyTotalOf(tier: PlanTier, market: Market): Money | null {
  return tier.yearly ? tier.yearly[market].total : null;
}

/**
 * How an amount is written: `₹1,999` in India's own grouping, `$20` outside it.
 *
 * A whole amount shows no decimals and a fractional one shows both of them, so `$16.67` is not
 * rounded to `$17` — a per-month figure derived from a yearly total is fractional in dollars and
 * whole in rupees, and rounding it would print a price nobody is charged.
 */
export function formatMoney(money: Money): string {
  const locale = money.currency === 'INR' ? 'en-IN' : 'en-US';
  const digits = Number.isInteger(money.amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: money.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(money.amount);
  } catch {
    const symbol = money.currency === 'INR' ? '₹' : '$';
    return `${symbol}${money.amount.toFixed(digits)}`;
  }
}

/** The price a card shows. The free tier shows a zero in the market's own money: ₹0, $0. */
export function priceLabel(tier: PlanTier, market: Market, period: Period = 'monthly'): string {
  const money = priceOf(tier, market, period);
  return formatMoney(money ?? { currency: market === 'IN' ? 'INR' : 'USD', amount: 0 });
}

/** The whole year, written. Null wherever there is no year to write: the free tier. */
export function yearlyTotalLabel(tier: PlanTier, market: Market): string | null {
  const money = yearlyTotalOf(tier, market);
  return money ? formatMoney(money) : null;
}

/**
 * WHAT IS TAKEN TODAY for this tier on this period: the whole year on the yearly period, the
 * month on the monthly one. It is the number the checkout states and the plans cards never do
 * (docs/PRICING.md). Null on the free tier, which takes nothing.
 */
export function chargeOf(tier: PlanTier, market: Market, period: Period): Money | null {
  return period === 'yearly' ? yearlyTotalOf(tier, market) : priceOf(tier, market, 'monthly');
}

/** `chargeOf`, written. */
export function chargeLabel(tier: PlanTier, market: Market, period: Period): string | null {
  const money = chargeOf(tier, market, period);
  return money ? formatMoney(money) : null;
}

/** The line under the per-month figure, or null on the free tier, which has no period. */
export function billedLine(tier: PlanTier, period: Period): string | null {
  return tier.price ? BILLED[period] : null;
}

/** Whether a tier can be bought on this period at all. The free tier cannot be bought on either. */
export function sellsOn(tier: PlanTier, period: Period): boolean {
  return period === 'yearly' ? tier.yearly !== null : tier.price !== null;
}

/** The small print under a card's door, in the words of the period being bought. */
export function fineLine(tier: PlanTier, period: Period): string {
  return tier.fine[period];
}

/** What runs beside a card's price. */
export function priceUnit(tier: PlanTier): string {
  return tier.price ? PRICE_UNIT.paid : PRICE_UNIT.free;
}

/**
 * The day a plan bought today comes round again: the same day one month on, or twelve months on for
 * a yearly plan, and that month's last day where the day does not exist (a plan bought on the 31st
 * of January comes round on the last day of February; a yearly one bought on a 29th of February
 * comes round on the 28th).
 */
export function renewsOn(from: Date, period: Period = 'monthly'): Date {
  const next = new Date(from.getTime());
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + (period === 'yearly' ? MONTHS_IN_A_YEAR : 1));
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

/**
 * A date, written the way the card says it: "3 October" for a month away, and "3 October 2027" for
 * a year away, because a date a year out that does not name the year is not a date anyone can use.
 */
export function renewalLabel(date: Date, period: Period = 'monthly'): string {
  const options: Intl.DateTimeFormatOptions =
    period === 'yearly'
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'long' };
  try {
    return new Intl.DateTimeFormat('en-GB', options).format(date);
  } catch {
    return date.toDateString();
  }
}

// --- gifts ---------------------------------------------------------------------------------------

/**
 * A gift is a run of months of a paid tier, paid once, renewing never (`gift-page.md`, rules). The
 * length is the giver's choice at checkout rather than a fixed pack, which is what lets the page
 * keep §14's other rule — a gift costs the same as the equivalent plan, so a month of Pro given is
 * a month of Pro bought, and the gift is never a discount surface.
 */
export interface GiftOption {
  id: 'gift-pro' | 'gift-max';
  tier: PlanTier['id'];
  name: string;
  lines: readonly string[];
}

export const GIFT_OPTIONS: readonly GiftOption[] = [
  {
    id: 'gift-pro',
    tier: 'pro',
    name: 'Pro, by the month',
    lines: ['Five times the free daily allowance', 'Choose how many months when you pay'],
  },
  {
    id: 'gift-max',
    tier: 'max',
    name: 'Max, by the month',
    lines: ['Twenty times the free daily allowance', 'Choose how many months when you pay'],
  },
];

/** The tier a gift is a gift of. */
export function giftTier(option: GiftOption): PlanTier {
  return tierById(option.tier) ?? (PLAN_TIERS[0] as PlanTier);
}

// There is no refund window here any more. DESIGN.md §0 (owner, 4 September 2026) forbids a product
// surface promising money back: a subscriber cancels and keeps the plan to the end of the period
// already paid for, and a gift renews never, so neither has a window to state. The refunds the law
// still requires are listed in `docs/legal/refund-and-cancellation.md` section 5, not priced here.
