/**
 * THE PERIOD, held to docs/PRICING.md — the one place every figure on this page lives.
 *
 * Four promises are made here rather than remembered, because each of them is one edit away from
 * being broken by somebody with good intentions:
 *
 *  1. A YEAR COSTS TEN MONTHS. Every figure in `prices.ts` is read back out of the canonical table
 *     in docs/PRICING.md, cell by cell, and then held to the rule the table is built on. A number
 *     changed in one place and not the other fails here.
 *  2. YEARLY IS FIRST AND YEARLY IS THE DEFAULT. It is the better deal, and putting the worse one
 *     in front of it would be the sort of thing this product exists not to do.
 *  3. THE PLANS PAGE SHOWS THE AMOUNT AND THE WORDS, NEVER THE TOTAL (owner, 2026-09-04). The
 *     annual total appears at checkout, with the day it is taken, and nowhere else.
 *  4. EVERY PRICE AND EVERY PROMISE READS FROM ONE CHOICE. On the monthly period nothing the page
 *     can render says "year" or "annual" — not a price, not a line of small print, not a consent
 *     box, not the closing sentence, and not the two answers about cancelling.
 *
 * `pageStrings` mirrors what `Plans.tsx` renders; the assertions at the bottom hold the component's
 * own source to it, so the mirror cannot quietly stop being one.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT_LINES } from './checkout-flow';
import { ALLOWANCE_WORDS, BENEFITS, faqItems, PLANS_PAGE } from './copy';
import {
  BEST_FOR,
  BILLED,
  billedLine,
  chargeLabel,
  DEFAULT_PERIOD,
  fineLine,
  formatMoney,
  type Market,
  MONTHS_A_YEAR_COSTS,
  MONTHS_IN_A_YEAR,
  PERIOD_LABELS,
  PERIOD_SAVING,
  PERIODS,
  type Period,
  PLAN_TIERS,
  type PlanTier,
  priceLabel,
  priceOf,
  priceUnit,
  renewalLabel,
  renewsOn,
  sellsOn,
  yearlyTotalLabel,
  yearlyTotalOf,
} from './prices';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PRICING = readFileSync(join(REPO, 'docs', 'PRICING.md'), 'utf8');
const PAGE_SOURCE = readFileSync(join(import.meta.dir, 'Plans.tsx'), 'utf8');

const MARKETS: Market[] = ['IN', 'INTL'];
const PAID = PLAN_TIERS.filter((t) => t.price !== null);

// --- the canonical table -------------------------------------------------------------------------

interface Row {
  plan: string;
  period: string;
  shownIN: string;
  billedIN: string;
  shownINTL: string;
  billedINTL: string;
}

/** docs/PRICING.md's table, parsed. Six columns; the separator row and the header are dropped. */
function canonicalTable(): Row[] {
  const rows: Row[] = [];
  for (const line of PRICING.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 6) continue;
    if (cells[0] === 'Plan' || /^-+$/.test(cells[0] ?? '')) continue;
    rows.push({
      plan: cells[0] as string,
      period: cells[1] as string,
      shownIN: cells[2] as string,
      billedIN: cells[3] as string,
      shownINTL: cells[4] as string,
      billedINTL: cells[5] as string,
    });
  }
  return rows;
}

const TABLE = canonicalTable();

describe('docs/PRICING.md is the one place every figure lives', () => {
  it('finds the table it claims to read', () => {
    // a guard on the guard: a doc that moves must fail here rather than pass in silence
    expect(TABLE.map((r) => `${r.plan} ${r.period}`)).toEqual([
      'Free —',
      'Pro Monthly',
      'Pro Yearly',
      'Max Monthly',
      'Max Yearly',
    ]);
  });

  it('shows the per-month figure the table shows, in both markets and on both periods', () => {
    for (const row of TABLE) {
      const tier = PLAN_TIERS.find((t) => t.name === row.plan) as PlanTier;
      const period: Period = row.period === 'Yearly' ? 'yearly' : 'monthly';
      expect([row.plan, row.period, 'IN', priceLabel(tier, 'IN', period)]).toEqual([
        row.plan,
        row.period,
        'IN',
        row.shownIN,
      ]);
      expect([row.plan, row.period, 'INTL', priceLabel(tier, 'INTL', period)]).toEqual([
        row.plan,
        row.period,
        'INTL',
        row.shownINTL,
      ]);
    }
  });

  it('bills the yearly rows at the total the table bills them at', () => {
    for (const row of TABLE.filter((r) => r.period === 'Yearly')) {
      const tier = PLAN_TIERS.find((t) => t.name === row.plan) as PlanTier;
      expect([row.plan, 'IN', `${yearlyTotalLabel(tier, 'IN')} annually`]).toEqual([
        row.plan,
        'IN',
        row.billedIN,
      ]);
      expect([row.plan, 'INTL', `${yearlyTotalLabel(tier, 'INTL')} annually`]).toEqual([
        row.plan,
        'INTL',
        row.billedINTL,
      ]);
    }
  });

  it('costs ten months for twelve, in every market', () => {
    for (const tier of PAID) {
      for (const market of MARKETS) {
        const month = priceOf(tier, market, 'monthly') as { amount: number };
        const total = yearlyTotalOf(tier, market) as { amount: number };
        const perMonth = priceOf(tier, market, 'yearly') as { amount: number };
        const tenMonths = month.amount * MONTHS_A_YEAR_COSTS;
        // ten months, to within the rounding the owner's own rupee figure carries
        expect([tier.id, market, Math.abs(total.amount - tenMonths) < tenMonths * 0.001]).toEqual([
          tier.id,
          market,
          true,
        ]);
        // and the per-month figure is that total, spread over the twelve
        expect([
          tier.id,
          market,
          Math.abs(perMonth.amount * MONTHS_IN_A_YEAR - total.amount) <= 0.5,
        ]).toEqual([tier.id, market, true]);
        // the yearly per-month figure is always the better deal
        expect([tier.id, market, perMonth.amount < month.amount]).toEqual([tier.id, market, true]);
      }
    }
  });

  it('writes a fractional amount in full rather than rounding it to a price nobody is charged', () => {
    expect(formatMoney({ currency: 'USD', amount: 16.67 })).toBe('$16.67');
    expect(formatMoney({ currency: 'USD', amount: 200 })).toBe('$200');
    expect(formatMoney({ currency: 'INR', amount: 19992 })).toBe('₹19,992');
  });
});

// --- the control ---------------------------------------------------------------------------------

describe('the period control', () => {
  it('lists yearly first and opens on it', () => {
    expect(PERIODS[0]).toBe('yearly');
    expect(DEFAULT_PERIOD).toBe('yearly');
    expect(PAGE_SOURCE).toContain('useState<Period>(DEFAULT_PERIOD)');
  });

  it('offers exactly two segments, both named', () => {
    expect(PERIODS).toHaveLength(2);
    for (const period of PERIODS) expect(PERIOD_LABELS[period].length).toBeGreaterThan(0);
    expect(PERIOD_SAVING).toBe('two months free');
    // never a percentage: a rounded percentage is a number we cannot show the working for
    expect(PERIOD_SAVING).not.toMatch(/%/);
  });

  it('moves its indicator with a transform and never with a width', () => {
    const css = readFileSync(join(import.meta.dir, 'styles.ts'), 'utf8');
    const pill = css.slice(css.indexOf('.pl-seg .pl-pill'), css.indexOf('.pl-seg>button'));
    expect(pill).toContain('transition:transform');
    expect(pill).not.toMatch(/transition:[^;]*width/);
    expect(css).toContain('translateX(100%)');
    // and it is still under reduced motion
    expect(css).toContain(
      '@media (prefers-reduced-motion:reduce){.pl-seg .pl-pill{transition:none}}',
    );
  });

  it('sells both periods of every paid tier, and neither of the free one', () => {
    for (const tier of PLAN_TIERS) {
      for (const period of PERIODS) {
        expect([tier.id, period, sellsOn(tier, period)]).toEqual([
          tier.id,
          period,
          tier.id !== 'free',
        ]);
      }
    }
    // a tier with one period priced and not the other could draw a card it cannot price
    for (const tier of PLAN_TIERS) {
      expect([tier.id, tier.price === null]).toEqual([tier.id, tier.yearly === null]);
    }
  });
});

// --- what a card says ----------------------------------------------------------------------------

/** Every string one card renders, in the order the card renders them. */
function cardStrings(tier: PlanTier, market: Market, period: Period): string[] {
  const multiple =
    tier.allowanceMultiple > 1
      ? `${ALLOWANCE_WORDS[tier.allowanceMultiple] ?? 'more'} the free allowance`
      : null;
  return [
    tier.recommended ? BEST_FOR : null,
    tier.name,
    priceLabel(tier, market, period),
    priceUnit(tier),
    billedLine(tier, period),
    multiple,
    tier.blurb,
    ...tier.lines,
    tier.cta,
    fineLine(tier, period),
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);
}

describe('a card shows the amount and the words, never the total', () => {
  it('carries a billed line on both periods, so the switch cannot change a card', () => {
    for (const tier of PAID) {
      expect([tier.id, billedLine(tier, 'yearly')]).toEqual([tier.id, BILLED.yearly]);
      expect([tier.id, billedLine(tier, 'monthly')]).toEqual([tier.id, BILLED.monthly]);
    }
    // the free tier has no period, so it has no line and nothing to keep in step
    expect(billedLine(PLAN_TIERS[0] as PlanTier, 'yearly')).toBe(null);
  });

  it('renders the same number of lines on both periods, none of them empty', () => {
    for (const market of MARKETS) {
      for (const tier of PLAN_TIERS) {
        const yearly = cardStrings(tier, market, 'yearly');
        const monthly = cardStrings(tier, market, 'monthly');
        expect([tier.id, market, yearly.length]).toEqual([tier.id, market, monthly.length]);
      }
    }
  });

  it('keeps the two small-print lines within a couple of characters of one another', () => {
    // the height a card takes is the height of its words: two lines that wrap differently are two
    // different cards. The e2e proof measures the real thing; this keeps the words in range.
    for (const tier of PLAN_TIERS) {
      const gap = Math.abs(fineLine(tier, 'yearly').length - fineLine(tier, 'monthly').length);
      expect([tier.id, gap <= 14]).toEqual([tier.id, true]);
    }
  });

  it('never states the annual total on a card, in any market, on either period', () => {
    for (const market of MARKETS) {
      const totals = PAID.map((t) => yearlyTotalLabel(t, market) as string);
      for (const period of PERIODS) {
        for (const tier of PLAN_TIERS) {
          for (const line of cardStrings(tier, market, period)) {
            for (const total of totals) {
              expect([tier.id, period, line, line.includes(total)]).toEqual([
                tier.id,
                period,
                line,
                false,
              ]);
            }
          }
        }
      }
    }
  });

  it('changes nothing at all about the free plan', () => {
    const free = PLAN_TIERS.find((t) => t.id === 'free') as PlanTier;
    for (const market of MARKETS) {
      expect(cardStrings(free, market, 'yearly')).toEqual(cardStrings(free, market, 'monthly'));
    }
    expect(free.allowanceMultiple).toBe(1);
    expect(free.yearly).toBe(null);
  });
});

// --- the whole page, from one choice -------------------------------------------------------------

const PREVIEW = PLAN_TIERS.find((t) => t.recommended) as PlanTier;

/**
 * Every string the page renders on one period, EXCEPT the control's own two segment labels — the
 * control has to name the period it is not on, which is the one place "Yearly" may appear beside a
 * monthly price. Everything else is the page speaking, and the page speaks in one period.
 */
function pageStrings(market: Market, period: Period): string[] {
  const c = PLANS_PAGE.checkout;
  return [
    PLANS_PAGE.eyebrow,
    PLANS_PAGE.title,
    PLANS_PAGE.titleEm,
    PLANS_PAGE.lead,
    ...Object.values(PLANS_PAGE.allowance),
    PLANS_PAGE.period.legend,
    PERIOD_SAVING,
    ...PLAN_TIERS.flatMap((tier) => cardStrings(tier, market, period)),
    PLANS_PAGE.same,
    PLANS_PAGE.keepIt[period],
    PLANS_PAGE.table.eyebrow,
    PLANS_PAGE.table.title,
    PLANS_PAGE.table.lead,
    ...PLANS_PAGE.table.head,
    ...BENEFITS.flatMap((row) => [row.label, row.free, row.pro, row.max]).filter(
      (cell): cell is string => typeof cell === 'string',
    ),
    c.eyebrow,
    c.title,
    c.lead[period],
    c.say,
    c.sayEm,
    `${priceLabel(PREVIEW, market, period)} ${c.perMonth}`,
    c.starts,
    c.startsValue,
    c.terms,
    c.termsNote,
    c.renewal[period],
    c.renewalNote[period].replace('{plan}', PREVIEW.name),
    c.billed,
    billedLine(PREVIEW, period) ?? '',
    // the off state, which is the state this page mirrors: the total row is not drawn and the
    // door reads the words (`checkout-flow.ts`); the on state is tests-plan/checkout.spec.ts
    c.today,
    c.totalFor[period],
    c.opening,
    c.confirming,
    CHECKOUT_LINES.off,
    CHECKOUT_LINES.offNote,
    c.payMore,
    c.fine,
    ...Object.values(PLANS_PAGE.gift),
    ...Object.values(PLANS_PAGE.faq),
    ...faqItems(period).flatMap((item) => [item.question, item.answer]),
    ...Object.values(PLANS_PAGE.close),
  ];
}

describe('every price and every promise reads from one choice', () => {
  it('says nothing about a year anywhere on the page, on the monthly period', () => {
    for (const market of MARKETS) {
      for (const line of pageStrings(market, 'monthly')) {
        expect([market, line, /year|annual/i.test(line)]).toEqual([market, line, false]);
      }
    }
  });

  it('says it on the yearly period, where it is true', () => {
    const yearly = pageStrings('IN', 'yearly');
    expect(yearly).toContain(BILLED.yearly);
    expect(yearly).toContain(PLANS_PAGE.keepIt.yearly);
    expect(PLANS_PAGE.keepIt.yearly).toContain('until the year you paid for ends');
  });

  it('quotes both periods by the month, because that is how a family compares them', () => {
    // the unit does not read from the period at all: a yearly plan is compared by the month too
    for (const tier of PAID) expect([tier.id, priceUnit(tier)]).toEqual([tier.id, 'a month']);
  });

  it('follows the period in the cancel wording, and in both cancel answers', () => {
    // what a canceller actually keeps is the period already paid for: screens/you/billing.ts
    // stores its end date and nothing else, so these words and that record say the same thing
    expect(fineLine(PREVIEW, 'yearly')).toContain('till the year you paid for ends');
    expect(fineLine(PREVIEW, 'monthly')).toContain('till the month');
    const cancel = (period: Period): string =>
      faqItems(period).find((i) => i.question === 'How do I cancel?')?.answer ?? '';
    expect(cancel('yearly')).toContain('until the year you paid for ends');
    expect(cancel('monthly')).toContain('until the month you paid for ends');
    // and neither offers money back, on either period
    for (const period of PERIODS) {
      for (const item of faqItems(period)) {
        if (item.question === 'Do you give money back?') continue;
        expect([period, item.question, /refund|money back/i.test(item.answer)]).toEqual([
          period,
          item.question,
          false,
        ]);
      }
    }
  });
});

// --- the annual total: not here ------------------------------------------------------------------

/**
 * docs/PRICING.md, "Where each number is allowed to appear" (owner, 2026-09-04): the plans page
 * shows the per-month amount and the words and NOT the total, and its Still-to-build item 2 is
 * explicit — "It must not appear on the plans page."
 *
 * It did. The checkout preview printed `Today  ₹19,992` and, under it, "₹19,992 today, billed
 * annually. The next is taken on 4 September 2027, unless you cancel." The second half broke a
 * second law: `services/gateway/src/wobo_gateway/billing.py` rule 2, in capitals — "NOTHING IN THIS
 * REPO RENEWS A SUBSCRIPTION, and no user-facing line may say one does" — and the date named a day
 * on which nothing in this repo can take anything.
 */
describe('the annual total is not on the plans page', () => {
  it('works the total out in one place, behind the payments-on guard, and nowhere else', () => {
    expect(PAGE_SOURCE).not.toContain('yearlyTotalLabel');
    expect(PAGE_SOURCE).not.toContain('yearlyTotalOf');
    expect(PAGE_SOURCE).not.toContain('dueToday');
    // The one row that states the amount taken today is drawn only when the gateway says the
    // deploy can take it: then this card IS the checkout, and docs/PRICING.md gives the checkout
    // the total. Off, it is a preview on the plans page, and the page shows no total at all.
    expect(PAGE_SOURCE.match(/chargeLabel\(/g)?.length).toBe(1);
    expect(PAGE_SOURCE).toMatch(/pay\?\.on \? \(\s*<div className="pl-total">/);
  });

  it('never names a future charge, because nothing here can take one', () => {
    expect(PAGE_SOURCE).not.toContain('renewsOn');
    expect(PAGE_SOURCE).not.toContain('renewalLabel');
  });

  it('renders no string carrying a total, on either period or in either market', () => {
    for (const market of MARKETS) {
      const totals = PAID.map((tier) => yearlyTotalLabel(tier, market) as string);
      for (const period of PERIODS) {
        for (const line of pageStrings(market, period)) {
          for (const total of totals) {
            expect([market, period, line, line.includes(total)]).toEqual([
              market,
              period,
              line,
              false,
            ]);
          }
        }
      }
    }
  });

  it('keeps the words, which is what the page IS allowed to say', () => {
    expect(pageStrings('IN', 'yearly')).toContain(BILLED.yearly);
    expect(pageStrings('IN', 'monthly')).toContain(BILLED.monthly);
  });

  it('knows the total the checkout states, and the amount taken on each period', () => {
    // `chargeLabel` is what the checkout card draws while payments are on: the whole year on the
    // yearly period, the month on the monthly one, and never a figure the table does not hold.
    expect(yearlyTotalLabel(PREVIEW, 'IN')).toBe('₹19,992');
    expect(chargeLabel(PREVIEW, 'IN', 'yearly')).toBe('₹19,992');
    expect(chargeLabel(PREVIEW, 'IN', 'monthly')).toBe('₹1,999');
    expect(chargeLabel(PREVIEW, 'INTL', 'yearly')).toBe('$200');
    expect(chargeLabel(PREVIEW, 'INTL', 'monthly')).toBe('$20');
    expect(chargeLabel(PLAN_TIERS[0] as PlanTier, 'IN', 'yearly')).toBeNull();
    expect(renewalLabel(renewsOn(new Date(2026, 8, 4), 'yearly'), 'yearly')).toBe(
      '4 September 2027',
    );
    expect(renewsOn(new Date(2024, 1, 29), 'yearly').getTime()).toBe(
      new Date(2025, 1, 28).getTime(),
    );
    expect(renewalLabel(new Date(2026, 9, 4), 'monthly')).toBe('4 October');
  });

  it('passes the chosen period to every price it draws', () => {
    for (const call of PAGE_SOURCE.match(/priceLabel\([^)]*\)/g) ?? []) {
      expect([call, /period|'monthly'/.test(call)]).toEqual([call, true]);
    }
  });
});
