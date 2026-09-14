/**
 * The promo desk's honesty, held to the same three rules the queues are held to.
 *
 * What this file is shaped around, in order:
 *
 *   1. "We could not ask" is never rendered as "no codes". A failed read produces an absence that
 *      says so, and no figure at all — a zero here would tell an owner nobody has taken a code
 *      when the truth is that nothing was read.
 *   2. Every number on this desk is the server's. The use count comes from the gateway, which
 *      counts `ops.promo_redemptions`; this console never sums, so it can never disagree.
 *   3. NOT ONE FIELD ON A REDEMPTION ROW CAN NAME A CHILD. The gateway sends a keyed digest, and
 *      this file proves the row the console builds carries nothing else.
 */

import { describe, expect, it } from 'bun:test';
import {
  grantedWords,
  grantWords,
  isPromoPage,
  isRedemptionPage,
  type PromoCodeRow,
  type PromoPage,
  promoPanels,
  promoSummary,
  type RedemptionPage,
  toneOfCode,
  usesWords,
  whyNotLive,
} from './promo';

const AT = '2026-09-11T12:00:00.000Z';

function code(over: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: 'c1',
    code: 'WELCOME',
    kind: 'plan_days',
    value: 30,
    days: null,
    plan: 'pro',
    provider_offer_id: null,
    expires_at: null,
    max_uses: 100,
    uses: 3,
    uses_left: 97,
    once_per_account: true,
    live: true,
    disabled_at: null,
    note: null,
    created_at: '2026-09-10T09:00:00.000Z',
    ...over,
  };
}

function page(over: Partial<PromoPage> = {}): PromoPage {
  return {
    readable: true,
    codes: [code()],
    feed: {
      what: 'Every promo code that has been minted.',
      feeds: 'This desk is the only thing that mints one.',
      missing: 'There is no campaign and no mail that sends one.',
    },
    ...over,
  };
}

function taken(over: Partial<RedemptionPage> = {}): RedemptionPage {
  return {
    readable: true,
    code: 'WELCOME',
    redemptions: [
      {
        id: 'r1',
        code: 'WELCOME',
        kind: 'plan_days',
        handle: 'a1b2c3d4',
        granted: { plan: 'pro', days: 30, period_end: '2026-10-11T12:00:00.000Z' },
        subscription_id: null,
        redeemed_at: '2026-09-11T11:00:00.000Z',
      },
    ],
    ...over,
  };
}

describe('a read that failed is never a zero', () => {
  it('renders an absence that says what it could not reach, and no figure', () => {
    const panels = promoPanels({ readable: false, codes: [] }, null, AT);
    expect(panels.every((panel) => panel.kind === 'absent')).toBe(true);
    const [first] = panels;
    if (first?.kind !== 'absent') throw new Error('expected an absence');
    expect(first.because).toContain('ops.promo_codes');
    expect(first.because).not.toMatch(/^0/);
    expect(first.wouldFill.length).toBeGreaterThan(60);
  });

  it('and says so in the summary rather than claiming none exist', () => {
    expect(promoSummary({ readable: false, codes: [] }, AT)).toContain('could not be read');
  });

  it('keeps a failed redemptions read apart from a good code read', () => {
    const panels = promoPanels(page(), { readable: false, redemptions: [], code: null }, AT);
    const ids = panels.map((panel) => panel.id);
    // The codes still render; only the trail is absent, and it says which table it is about.
    expect(ids).toContain('promo-codes');
    expect(ids).toContain('promo-taken-unreadable');
  });
});

describe('every number on this desk is the server’s', () => {
  it('prints the gateway’s own use count and never recomputes one', () => {
    const panels = promoPanels(page({ codes: [code({ uses: 7, max_uses: 10 })] }), null, AT);
    const rows = panels.find((panel) => panel.id === 'promo-codes');
    if (rows?.kind !== 'rows') throw new Error('expected the code rows');
    expect(rows.rows[0]?.cells).toContain('7 of 10');
  });

  it('says "no limit" rather than inventing a ceiling', () => {
    expect(usesWords(code({ max_uses: null, uses: 4, uses_left: null }))).toBe('4 of no limit');
  });

  it('carries a caveat when the list is a page rather than the whole table', () => {
    const panels = promoPanels(page({ more: true, shown: 50 }), null, AT);
    const rows = panels.find((panel) => panel.id === 'promo-codes');
    if (rows?.kind !== 'rows') throw new Error('expected the code rows');
    expect(rows.provenance.caveat).toContain('not all of them');
  });
});

describe('a redemption row cannot name anybody', () => {
  it('shows the keyed handle and nothing that could be an account', () => {
    const panels = promoPanels(page(), taken(), AT);
    const rows = panels.find((panel) => panel.id === 'promo-taken');
    if (rows?.kind !== 'rows') throw new Error('expected the redemption rows');
    const cells = rows.rows.flatMap((row) => row.cells);
    expect(cells).toContain('a1b2c3d4');
    // Nothing that looks like a uuid, which is the shape a learner id has.
    expect(
      cells.some((cell) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(cell)),
    ).toBe(false);
  });

  it('reads the grant from the row the gateway recorded, not from the code', () => {
    expect(grantedWords(taken().redemptions[0]!)).toContain('pro');
    expect(
      grantedWords({
        ...taken().redemptions[0]!,
        kind: 'allowance_boost_days',
        granted: { paise_per_day: 500, until: '2026-09-18T12:00:00.000Z' },
      }),
    ).toContain('₹5.00 a day');
  });
});

describe('what a code grants, said plainly, with the numbers', () => {
  it('says days and a plan', () => {
    expect(grantWords(code({ kind: 'plan_days', value: 30, plan: 'pro' }))).toBe('30 days of pro');
  });

  it('says a boost as the dial actually is: rupees a day, for a number of days', () => {
    // The OWNER's screen. The learner's own answer says "a bigger day" and carries no currency
    // at all (docs/ALLOWANCE.md section 2); this is the internal side of the same fact.
    expect(
      grantWords(code({ kind: 'allowance_boost_days', value: 500, days: 7, plan: null })),
    ).toBe('₹5.00 a day extra, for 7 days');
  });

  it('says a percentage off the first payment, never a refund', () => {
    const words = grantWords(
      code({ kind: 'percent_off_first', value: 20, plan: null, provider_offer_id: 'offer_x' }),
    );
    expect(words).toBe('20% off the first payment');
    expect(words.toLowerCase()).not.toContain('refund');
  });
});

describe('why a code is not live is one reason, and the first that applies', () => {
  it('switched off beats every other reason', () => {
    expect(whyNotLive(code({ live: false, disabled_at: AT, max_uses: 1, uses: 5 }))).toBe(
      'switched off',
    );
  });

  it('names an expiry that has passed', () => {
    expect(whyNotLive(code({ live: false, expires_at: '2026-01-01T00:00:00.000Z' }))).toBe(
      'expired',
    );
  });

  it('names a ceiling that has been reached', () => {
    expect(whyNotLive(code({ live: false, max_uses: 3, uses: 3, uses_left: 0 }))).toBe('used up');
  });

  it('and says nothing at all about a live one', () => {
    expect(whyNotLive(code())).toBe('');
  });
});

describe('tone', () => {
  it('marks a live code with no ceiling and no date as the one to look at twice', () => {
    expect(toneOfCode(code({ max_uses: null, uses_left: null, expires_at: null }))).toBe('warn');
  });

  it('and never paints a promo code as a health reading', () => {
    expect(toneOfCode(code({ live: false, disabled_at: AT }))).toBe('plain');
  });
});

describe('an answer that is not a shape this console understands is refused', () => {
  it('refuses a page with no readable flag, or with rows that are not codes', () => {
    expect(isPromoPage({ codes: [] })).toBe(false);
    expect(isPromoPage({ readable: true, codes: [{ code: 'X' }] })).toBe(false);
    expect(isPromoPage(page())).toBe(true);
  });

  it('refuses a redemption page whose rows carry no handle', () => {
    expect(isRedemptionPage({ readable: true, redemptions: [{ code: 'X' }] })).toBe(false);
    expect(isRedemptionPage(taken())).toBe(true);
  });
});

describe('an empty desk says what would fill it', () => {
  it('prints the gateway’s own sentence rather than one written here', () => {
    const panels = promoPanels(page({ codes: [] }), null, AT);
    const feed = panels.find((panel) => panel.id === 'promo-feed');
    if (feed?.kind !== 'absent') throw new Error('expected the feed panel');
    expect(feed.because).toContain('Every promo code that has been minted.');
    expect(feed.wouldFill).toContain('no campaign');
  });
});
