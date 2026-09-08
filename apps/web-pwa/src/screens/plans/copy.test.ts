/**
 * The plans page's words are design/prototypes/site-plans.html, word for word, and its numbers are
 * the tiers'. This holds both: every string the page can render obeys the copy laws (DESIGN.md:
 * sentence case, no emoji, no exclamation marks; WOBO-PLAN §19: Wobo has no gender), and every
 * card, table row, question and answer is in the prototype.
 *
 * It also holds law v5's copy law (DESIGN.md §0) over the whole page: no raw allowance anywhere
 * ("40 questions a day"), no grade gate ("class 4 to 12"), no invented learner, no country switch,
 * and a door that says what the product actually is. WE ARE OPEN (owner, 2026-09-04): "Get early
 * access" is retired, `screens/site/cta.ts` holds the one phrase every public surface uses, and
 * nothing here may imply a wait list.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GIFT_FOR, GIFT_PAGE } from '../gift/copy';
import { CTA, RETIRED_CTA } from '../site/cta';
import {
  BENEFITS,
  CHECKOUT_PAGE,
  checkoutPageWords,
  faqItems,
  PLANS_PAGE,
  renewalValue,
} from './copy';
import {
  BEST_FOR,
  formatMoney,
  GIFT_CADENCE,
  GIFT_OPTIONS,
  giftTier,
  type Market,
  PERIODS,
  type Period,
  PLAN_TIERS,
  type PlanTier,
  priceLabel,
  priceOf,
  priceUnit,
  renewalLabel,
  renewsOn,
  tierById,
} from './prices';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO = readFileSync(join(REPO, 'design', 'prototypes', 'site-plans.html'), 'utf8');

/** Every string these modules can render, with a label so a failure names its source. */
function everyString(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (label: string, value: unknown): void => {
    if (typeof value === 'string') out.push([label, value]);
    else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        walk(`${label}[${i}]`, v);
      });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(`${label}.${k}`, v);
    }
  };
  walk('PLANS_PAGE', PLANS_PAGE);
  walk('CHECKOUT_PAGE', CHECKOUT_PAGE);
  walk('BENEFITS', BENEFITS);
  for (const period of PERIODS) walk(`FAQ.${period}`, faqItems(period));
  walk('GIFT_PAGE', GIFT_PAGE);
  walk('GIFT_FOR', GIFT_FOR);
  walk('PLAN_TIERS', PLAN_TIERS);
  walk('GIFT_OPTIONS', GIFT_OPTIONS);
  walk('BEST_FOR', BEST_FOR);
  walk('GIFT_CADENCE', GIFT_CADENCE);
  return out;
}

const STRINGS = everyString();

describe('the copy laws', () => {
  it('carries no exclamation mark', () => {
    for (const [label, text] of STRINGS)
      expect([label, text.includes('!')]).toEqual([label, false]);
  });

  it('carries no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [label, text] of STRINGS) expect([label, emoji.test(text)]).toEqual([label, false]);
  });

  it('gives Wobo no gender', () => {
    const gendered = /\b(she|her|hers|he|him|his)\b/i;
    for (const [label, text] of STRINGS) {
      expect([label, gendered.test(text)]).toEqual([label, false]);
    }
  });

  it('is sentence case — no title-cased headline', () => {
    const titleCase = /^(?:[A-Z][a-z]+ ){2,}[A-Z][a-z]+/;
    for (const [label, text] of STRINGS) {
      expect([label, titleCase.test(text)]).toEqual([label, false]);
    }
  });
});

/**
 * The prototype is the page's STRUCTURE, and the anchors below hold the page to it: the hero, the
 * allowance drawing, the card and table shapes, the gift block and the money questions are all
 * still the prototype's.
 *
 * Its WORDING is held by the law rather than by a diff. The two differ on purpose in three
 * places.

 *  · Every DOOR and the CLOSE are law v5's: the prototype writes its own invitations, and the one
 *    phrase every public surface uses now lives in `screens/site/cta.ts` so that no two pages can
 *    disagree about whether we are open. Those strings are asserted against the law below, never
 *    against the mock-up.
 * And two more: the prototype's cards describe a product where nothing at all is gated, and voice
 * and past-paper sets are the paid extras here. ONE LEARNER PER PLAN IS THE PROTOTYPE'S AND THE
 * CANON'S. Max carried two here, cited to WOBO-PLAN §14 — which says nothing about learners at all
 * (its "Prices" paragraph, owner 2026-09-03, names the tiers, the figures and the cadence and
 * stops there). The one canonical sentence is docs/PRICING.md, "The rule": "a subscription covers
 * exactly one learner on every plan and every period", and it is asserted below. And the
 * prototype's phrasing for a multiple ("five times the questions") is written here in law v5's
 * own words ("five times the free allowance"). Everything the law does govern — no raw allowance,
 * no grade gate, no invented learner, no country switch, one call to action — is asserted in full
 * further down.
 */
describe('the plans page is the prototype', () => {
  const inProto = (label: string, text: string): void => {
    expect([label, PROTO.includes(text)]).toEqual([label, true]);
  };

  it('says the hero and the allowance the way the prototype says them', () => {
    inProto('title', PLANS_PAGE.title);
    inProto('titleEm', PLANS_PAGE.titleEm);
    inProto('lead', PLANS_PAGE.lead);
    for (const [k, v] of Object.entries(PLANS_PAGE.allowance)) inProto(`allowance.${k}`, v);
  });

  it("draws the three cards in the prototype's frame", () => {
    for (const tier of PLAN_TIERS) {
      inProto(`${tier.id}.name`, `<div class="name">${tier.name}</div>`);
      // the fine line is the prototype's words; the mock-up carries its cadences as data
      // attributes on that div, so the words are asserted rather than the tag around them — and
      // both periods' words are the mock-up's, since both are on that div
      for (const period of PERIODS) inProto(`${tier.id}.fine.${period}`, tier.fine[period]);
      expect([`${tier.id}.lines`, tier.lines.length]).toEqual([`${tier.id}.lines`, 4]);
      // The card's door is the law's, not the mock-up's. A paid tier's door names the plan it
      // buys; the free tier's door is THE call to action, read from `screens/site/cta.ts`, so the
      // plans page cannot say a different thing from the front page about whether we are open.
      const door = tier.price ? new RegExp(`^Choose ${tier.name}$`) : new RegExp(`^${CTA.label}$`);
      expect([`${tier.id}.cta`, tier.cta, door.test(tier.cta)]).toEqual([
        `${tier.id}.cta`,
        tier.cta,
        true,
      ]);
      expect([`${tier.id}.cta`, tier.cta.includes(RETIRED_CTA)]).toEqual([`${tier.id}.cta`, false]);
    }
    inProto('best', `<span class="best">${BEST_FOR}</span>`);
  });

  it("draws the honest table in the prototype's frame", () => {
    inProto('table.eyebrow', PLANS_PAGE.table.eyebrow);
    for (const head of PLANS_PAGE.table.head) inProto('table.head', `<div>${head}</div>`);
    // the rows themselves are §14's deal, not the prototype's — see the note above
    inProto('table.allowance', '<div>Daily allowance</div>');
    inProto('table.subjects', '<div>Every subject your board sets</div>');
  });

  it('carries the gift block, and asks the questions the prototype asks', () => {
    for (const [k, v] of Object.entries(PLANS_PAGE.gift)) inProto(`gift.${k}`, v);
    // every question the prototype asks is asked here; the page may ask one more (schools) that
    // the mock-up has dropped, and its answers are the product's rather than the mock-up's
    const theirs = [...PROTO.matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1] as string);
    const ours = faqItems().map((i) => i.question);
    expect(theirs.filter((q) => !ours.includes(q))).toEqual([]);
  });
});

const MARKETS: Market[] = ['IN', 'INTL'];

describe('the prices', () => {
  it('offers the three tiers §14 names, free first', () => {
    expect(PLAN_TIERS.map((t) => t.id)).toEqual(['free', 'pro', 'max']);
  });

  it('states a real number in every market a paid tier is sold in, and a zero on free', () => {
    for (const tier of PLAN_TIERS) {
      for (const market of MARKETS) {
        const money = priceOf(tier, market);
        if (tier.id === 'free') {
          expect(money).toBe(null);
          expect(priceLabel(tier, market)).toBe(market === 'IN' ? '₹0' : '$0');
          expect(priceUnit(tier)).toBe('forever');
        } else {
          expect(money?.amount).toBeGreaterThan(0);
          expect(priceLabel(tier, market)).toBe(formatMoney(money as NonNullable<typeof money>));
          expect(priceUnit(tier)).toBe('a month');
        }
      }
    }
  });

  it('carries pigment on exactly one card, and it is not the top one', () => {
    const recommended = PLAN_TIERS.filter((t) => t.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]?.id).not.toBe(PLAN_TIERS.at(-1)?.id);
  });

  it('keeps the allowance multiples §14 sets, and states no raw allowance at all', () => {
    expect(PLAN_TIERS.map((t) => t.allowanceMultiple)).toEqual([1, 5, 20]);
    // law v5: free carries no multiplier, and no tier states a number of questions.
    for (const [label, text] of STRINGS) {
      expect([label, /\b\d+\s*(questions|turns)\b/i.test(text)]).toEqual([label, false]);
      expect([label, /\b(forty|two hundred|eight hundred)\b/i.test(text)]).toEqual([label, false]);
    }
  });

  it('prices a gift at exactly what the same plan costs, never a discount', () => {
    // gift-page.md, rules: a month of Pro given is a month of Pro bought.
    for (const gift of GIFT_OPTIONS) {
      const tier = tierById(gift.tier);
      expect(tier).not.toBeNull();
      expect(tier?.price).not.toBeNull();
      for (const market of MARKETS) {
        expect(priceLabel(giftTier(gift), market)).toBe(priceLabel(tier as PlanTier, market));
      }
    }
    expect(GIFT_CADENCE).toContain('renews never');
  });

  it('renews a month on, or on the last day the next month has', () => {
    expect(renewsOn(new Date(2026, 8, 3)).getTime()).toBe(new Date(2026, 9, 3).getTime());
    expect(renewsOn(new Date(2026, 0, 31)).getTime()).toBe(new Date(2026, 1, 28).getTime());
    expect(renewsOn(new Date(2026, 11, 15)).getTime()).toBe(new Date(2027, 0, 15).getTime());
    expect(renewalLabel(new Date(2026, 9, 3))).toBe('3 October');
  });
});

describe('the honest table', () => {
  it('reads its figures from the tiers, and never leaves a cell undecided', () => {
    expect(BENEFITS.length).toBeGreaterThan(5);
    for (const row of BENEFITS) {
      for (const cell of [row.free, row.pro, row.max]) {
        expect(cell === true || cell === false || typeof cell === 'string').toBe(true);
      }
    }
    // law v5: the allowance row says what a day feels like, and free carries no multiplier
    const allowance = BENEFITS.find((r) => r.label === 'Daily allowance');
    expect([allowance?.free, allowance?.pro, allowance?.max]).toEqual([
      'enough for an evening',
      'five times',
      'twenty times',
    ]);
    const learners = BENEFITS.find((r) => r.label === 'Learners on the plan');
    expect([learners?.free, learners?.pro, learners?.max]).toEqual(
      PLAN_TIERS.map((t) => String(t.learners)),
    );
  });

  it('carries exactly one learner on every plan, which is the canonical rule', () => {
    // docs/PRICING.md, "The rule": "a subscription covers exactly one learner on every plan and
    // every period". Max carried two, so /plans said "Learners on the plan: 2", "two learners on
    // one plan" and, at checkout, "two learners" — on the page that takes money, in both markets
    // and on both periods, against the one document that is allowed to set that number.
    for (const tier of PLAN_TIERS) expect([tier.id, tier.learners]).toEqual([tier.id, 1]);
    for (const [label, text] of STRINGS) {
      expect([label, /\btwo learners\b/i.test(text)]).toEqual([label, false]);
    }
  });

  it('never offers free something a paid tier does not have', () => {
    for (const row of BENEFITS) {
      if (row.free === true || row.free === 'same') {
        expect(row.pro).not.toBe(false);
        expect(row.max).not.toBe(false);
      }
    }
  });
});

describe('the consent boxes', () => {
  it('say the adult agrees to the terms in one, and what is being paid for in the other', () => {
    expect(PLANS_PAGE.checkout.terms).toContain('agree to the terms');
    // the second box names the period being bought, so it can never consent to the other one
    expect(PLANS_PAGE.checkout.renewal.yearly).toContain('every year');
    expect(PLANS_PAGE.checkout.renewal.monthly).toContain('every month');
    for (const period of PERIODS) expect(PLANS_PAGE.checkout.renewal[period]).toContain('cancel');
  });

  /**
   * THE SECOND BOX ACKNOWLEDGES A RECURRING CHARGE, WHICH IS WHAT IT IS FOR.
   *
   * It used to say the opposite — "I understand I am paying for a year" and nothing about it
   * happening again — on the authority of `services/gateway/src/wobo_gateway/billing.py` rule 2,
   * in capitals: "NOTHING IN THIS REPO RENEWS A SUBSCRIPTION ... There is no payment provider, no
   * webhook and no scheduled sweep." Commit 692affc deleted that file. The package that replaced
   * it (`services/gateway/src/wobo_gateway/billing/`) has the provider, the webhook and the
   * charge: `plans.py` creates every subscription with a `total_count` of five years or sixty
   * months, so the card is taken again on its own until somebody cancels. Not one surface a payer
   * reads said so. `docs/legal/refund-and-cancellation.md` §2 already promised this box would name
   * "the amount, the frequency and the cancellation route"; these hold it to that.
   */
  it('acknowledges the recurring charge, names its frequency, and names the way out', () => {
    for (const period of PERIODS) {
      const box = PLANS_PAGE.checkout.renewal[period];
      expect([period, /\brenews\b/i.test(box)]).toEqual([period, true]);
      expect([period, /until i cancel/i.test(box)]).toEqual([period, true]);
      // the way out is the door the product has: You, not a Settings screen (wave 29, site-2)
      expect([period, /from You, in two taps/.test(box)]).toEqual([period, true]);
      expect([period, /settings/i.test(box)]).toEqual([period, false]);
      // and the note under it says what happens on the day, rather than stopping at the date
      expect(PLANS_PAGE.checkout.renewalNote[period]).toContain('taken again');
    }
    // the row beside the boxes carries the amount and the day; the words for it live here
    expect(PLANS_PAGE.checkout.renews).toBe('Renews');
    expect(renewalValue('₹19,992', '7 September 2027')).toBe('₹19,992 on 7 September 2027');
  });

  it('answers the question a payer actually has, in the money questions', () => {
    const answer = faqItems('yearly').find((item) => /renew/i.test(item.question));
    expect(answer?.answer).toContain('Yes.');
    expect(answer?.answer).toMatch(/cancel/i);
  });

  it('claims no renewal anywhere the product cannot make one', () => {
    // A gift is paid once and renews never, and the free plan has nothing to renew. The word may
    // appear on a paid, provider-backed subscription and on the lines that deny one, and nowhere
    // else — a page that says "renews" beside ₹0 is the same lie the other way round.
    const denies = /(nothing|never|no)\s+\w*\s*renew|renews\s+never/i;
    for (const [label, text] of STRINGS) {
      if (!/\brenew(s|ing|al|als)?\b/i.test(text) || denies.test(text)) continue;
      expect([label, /free|gift|\u20b90\b|\$0\b/i.test(text)]).toEqual([label, false]);
    }
  });
});

describe('the money questions', () => {
  it('sends nobody to a page that is not there', () => {
    // The schools answer used to end "It's on the Schools page, or write to us." There is no
    // /schools route: the address answers with the 404 screen. It also described a teacher's view
    // and a data-processing agreement, and CONTEXT.md:38 is "Learners only — no teachers, no
    // schools inside it", so it was selling a product this repo does not have.
    const schools = faqItems().find((i) => i.question === 'Are there discounts for schools?');
    expect(schools?.answer).not.toMatch(/schools page/i);
    expect(schools?.answer).not.toMatch(/teacher's view|data-processing agreement/i);
    expect(schools?.answer).toMatch(/^Not yet\./);
    // and no answer on the page names a page the site does not have
    for (const item of faqItems()) {
      expect([item.question, /\/schools\b/.test(item.answer)]).toEqual([item.question, false]);
    }
  });

  it('answer the country question without a switch and without reciting a price', () => {
    const answer = faqItems().find((i) => i.question === 'Do prices change by country?')?.answer;
    expect(answer).toContain('without asking where you are');
    expect(answer).not.toMatch(/[₹$]\d/);
  });
});

/**
 * "Cancel, never refund" (DESIGN.md §0, owner, 4 September 2026). No product surface may promise
 * money back; cancelling is the answer, and the page has to say what cancelling actually does,
 * because the site is what a buyer reads before there is a settings screen to try.
 */
describe('cancel, never refund', () => {
  const answer = (question: string, period: Period = 'monthly'): string =>
    faqItems(period).find((i) => i.question === question)?.answer ?? '';
  const cancel = answer('How do I cancel?');
  const money = answer('Do you give money back?');

  it('promises money back nowhere on the page', () => {
    // the two exceptions are the name of the legal document and the answer that says no
    const allowed = new Set<string>([
      CHECKOUT_PAGE.cancelling,
      'Do you give money back?',
      money,
      answer('Do you give money back?', 'yearly'),
    ]);
    for (const [label, text] of STRINGS) {
      if (allowed.has(text)) continue;
      expect([label, /refund|money back/i.test(text)]).toEqual([label, false]);
    }
  });

  it('answers the money question with a no, and states no window at all', () => {
    expect(money.startsWith('No.')).toBe(true);
    expect(money).toContain('Cancelling is the answer');
    expect(money).not.toMatch(/\b(\d+|fourteen|thirty) days\b/i);
  });

  it('tells a canceller everything that happens to them', () => {
    expect(cancel).toContain('Two taps');
    expect(cancel).toContain('until the month you paid for ends');
    // and the same answer, asked on the yearly period, keeps the plan for the year that was paid
    expect(answer('How do I cancel?', 'yearly')).toContain('until the year you paid for ends');
    expect(cancel).toContain('nothing renews');
    expect(cancel).toContain('everything you learnt stays');
    // The gateway refuses every provider-backed resume (billing/__init__.py: 409 cannot_resume),
    // so no answer here may promise a tap that puts the plan back.
    expect(cancel).not.toMatch(/puts? the plan back|bring it back|one tap.*back/i);
    expect(cancel).toMatch(/cannot be switched back on/);
  });

  it('draws a cross or says no in the table, never an em dash', () => {
    expect(PLANS_PAGE.table.no).not.toContain('\u2014');
    expect(PLANS_PAGE.table.no.trim().length).toBeGreaterThan(0);
  });

  it('tells a reader who came to pay where the checkout is, in both states', () => {
    // Off: paying is not open. On: the checkout is the card on the plans page, and this page
    // says so rather than denying a door that is open.
    expect(checkoutPageWords(false).title).toBe(CHECKOUT_PAGE.title);
    expect(checkoutPageWords(false).lead).toContain('nothing can be charged');
    const on = checkoutPageWords(true);
    expect(on.title).not.toMatch(/not open/i);
    expect(on.lead).not.toMatch(/not open|nothing can be charged/i);
    expect(on.lead).toMatch(/plans page/i);
    expect(on.cta.href).toBe('/plans#checkout');
    expect(checkoutPageWords(null)).toEqual(checkoutPageWords(false));
  });

  it('offers nothing on the way out', () => {
    for (const [label, text] of STRINGS) {
      expect([
        label,
        /are you sure|exit survey|discount to stay|pause instead/i.test(text),
      ]).toEqual([label, false]);
    }
  });

  it('names the money document by leading with cancelling', () => {
    expect(CHECKOUT_PAGE.cancelling.startsWith('Cancelling')).toBe(true);
    expect('refunds' in CHECKOUT_PAGE).toBe(false);
  });
});

/** Law v5's copy law (DESIGN.md §0), held over every string this page can render. */
describe('law v5 over the whole plans page', () => {
  it('gates nobody by grade', () => {
    for (const [label, text] of STRINGS) {
      expect([label, /class(es)? \d|grade \d|\bages? \d/i.test(text)]).toEqual([label, false]);
    }
  });

  it('names no learner and no parent', () => {
    for (const [label, text] of STRINGS) {
      expect([label, /aanya|arjun|riya|meera|priya/i.test(text)]).toEqual([label, false]);
    }
  });

  /**
   * We are open (DESIGN.md §0, owner, 2026-09-04). The plans page's own job is selling a plan, so
   * its primary is the transaction and "Start free" is the quiet second — never a wait list, and
   * never an invitation to a late night.
   */
  it('closes on the plan it sells, and asks nobody to wait or to stay up', () => {
    expect(PLANS_PAGE.close.primary).toBe('Choose a plan');
    expect(PLANS_PAGE.close.quiet).toBe('Start free instead');
    for (const [label, text] of STRINGS) {
      expect([label, /begin tonight|tonight|early access|waitlist/i.test(text)]).toEqual([
        label,
        false,
      ]);
    }
  });

  it('offers no country switch to render', () => {
    expect('regions' in PLANS_PAGE).toBe(false);
    expect('regionLabel' in PLANS_PAGE).toBe(false);
  });
});
