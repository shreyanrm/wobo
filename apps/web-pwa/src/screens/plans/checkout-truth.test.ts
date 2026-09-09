/**
 * The four things the checkout route says about somebody's money, held to what it does.
 *
 * 1. THE MONEY DOCUMENT MATCHES THE PRODUCT IT GOVERNS. `/plans/checkout` and the plans FAQ both
 *    send a paying parent to `docs/legal/refund-and-cancellation.md`, and it contradicted the
 *    product in four places: it sold only monthly plans and said "There is no annual plan" while
 *    yearly is the page's default and the gateway's catalogue sells `pro_yearly` and `max_yearly`;
 *    it gave Max "two learners on one plan" after `prices.ts` had fixed that to one on every plan;
 *    and it promised "one tap puts the plan back on and it renews as it did before", which the
 *    gateway refuses with 409 `cannot_resume`.
 * 2. THE CHECKOUT PAGE PROMISES ONLY WHAT THE CHECKOUT DOES. Its list promised a tax line and "a
 *    receipt by email with the same information again"; the card has no tax line and nothing on
 *    the gateway sends a mail when the webhook lands.
 * 3. "GO TO THE CHECKOUT" ARRIVES AT THE CHECKOUT. Its address is `/plans#checkout` and the router
 *    has no hash in it anywhere, so the reader landed at the top of a long plans page.
 * 4. A PRICE IS TWO WORDS. `<span>₹1,666</span><small>a month</small>` with nothing between them
 *    is one word in the accessibility tree: "₹1,666a month".
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT_PAGE } from './copy';
import { PLAN_TIERS } from './prices';

const HERE = import.meta.dir;
const REPO = new URL('../../../../../', import.meta.url).pathname;
const read = (...parts: string[]): string => readFileSync(join(REPO, ...parts), 'utf8');

const MONEY = read('docs', 'legal', 'refund-and-cancellation.md');
const GATEWAY_PLANS = read('services', 'gateway', 'src', 'wobo_gateway', 'billing', 'plans.py');
const PAGE = readFileSync(join(HERE, 'Plans.tsx'), 'utf8');
const CHECKOUT = readFileSync(join(HERE, 'Checkout.tsx'), 'utf8');

describe('the money document describes the product it governs', () => {
  it('sells the periods the gateway actually has a plan for', () => {
    // the catalogue's own keys, built as `${plan}_${period}`
    expect(GATEWAY_PLANS).toContain('PERIODS: tuple[str, ...] = ("monthly", "yearly")');
    expect(MONEY).toContain('| Pro, yearly |');
    expect(MONEY).toContain('| Max, yearly |');
    expect(MONEY).not.toContain('There is no annual plan');
    expect(MONEY).not.toContain('Every plan we sell is monthly.');
  });

  it('gives every plan one learner, which is what every plan carries', () => {
    for (const tier of PLAN_TIERS) expect([tier.id, tier.learners]).toEqual([tier.id, 1]);
    expect(MONEY).toContain('exactly one learner, on every plan and every period');
    expect(MONEY).not.toContain('two learners on one plan');
  });

  it('does not promise a resume the gateway refuses', () => {
    const billing = read('services', 'gateway', 'src', 'wobo_gateway', 'billing', '__init__.py');
    expect(billing).toContain('cannot_resume');
    expect(MONEY).not.toContain('one tap puts the plan back on and it renews as it did before');
    expect(MONEY).not.toContain('one tap puts the plan back.');
    expect(MONEY).toContain('cannot be switched back on');
  });

  it('promises no receipt while nothing sends one', () => {
    const gatewaySrc = join(REPO, 'services', 'gateway', 'src', 'wobo_gateway');
    const webhook = readFileSync(join(gatewaySrc, 'billing', 'payments.py'), 'utf8');
    expect(webhook).not.toContain('send_receipt');
    expect(MONEY).toContain('We do not email a receipt today.');
    expect(MONEY).not.toContain('we email you the same information again, with the receipt');
  });
});

describe('the checkout page promises only what the checkout does', () => {
  it('names no tax line and no email, because the card has neither', () => {
    for (const line of CHECKOUT_PAGE.promises) {
      expect([line, /\btax\b/i.test(line)]).toEqual([line, false]);
      expect([line, /\breceipt\b|\bemail\b/i.test(line)]).toEqual([line, false]);
    }
    expect(CHECKOUT_PAGE.lead).not.toMatch(/\btax\b/i);
  });

  it('names the things the card does draw, on both of its rows', () => {
    const promised = CHECKOUT_PAGE.promises.join(' ');
    expect(promised).toContain('the day it is taken');
    expect(promised).toContain('comes round again');
    expect(promised).toContain('both unticked');
    // and the card draws them
    expect(PAGE).toContain('{c.today}');
    expect(PAGE).toContain('{c.renews}');
  });
});

describe('"Go to the checkout" arrives at the checkout', () => {
  it('carries the fragment past a router that drops it', () => {
    const router = read('apps', 'web-pwa', 'src', 'shell', 'router.tsx');
    const nav = read('apps', 'web-pwa', 'src', 'screens', 'site', 'nav.tsx');
    // the two reasons the fragment never arrived, still true, and still not this file's to fix
    expect(nav).toContain("href.split('#')[0]");
    expect(router).not.toContain('location.hash');
    // so the page that owns the link brings it along itself
    expect(CHECKOUT_PAGE.open.cta).toBe('Go to the checkout');
    expect(CHECKOUT).toContain('onNavigate={() => revealHash(');
  });

  it('scrolls the section the fragment names, once it exists', async () => {
    const { revealHash } = await import('./Checkout');
    const found: string[] = [];
    let raf: (() => void) | null = null;
    const globals = globalThis as { requestAnimationFrame?: unknown };
    const before = globals.requestAnimationFrame;
    globals.requestAnimationFrame = ((fn: () => void) => {
      raf = fn;
      return 0;
    }) as unknown as typeof requestAnimationFrame;

    // the first look finds nothing: the plans page has not mounted yet
    const doc = {
      getElementById: (id: string) =>
        found.length === 0 ? null : { scrollIntoView: () => found.push(`scrolled:${id}`) },
    } as unknown as Document;
    revealHash('/plans#checkout', doc);
    (raf as unknown as () => void)();
    expect(found).toEqual([]);
    found.push('mounted');
    (raf as unknown as () => void)();
    expect(found).toEqual(['mounted', 'scrolled:checkout']);

    // an address with no fragment asks for nothing at all
    raf = null;
    revealHash('/plans', doc);
    expect(raf).toBeNull();
    globals.requestAnimationFrame = before;
  });
});

describe('a price is read as two words', () => {
  it('separates the amount from its unit on the cards, as the checkout row already did', () => {
    /**
     * Two spellings mean the same thing to React, and the formatter picks between them by line
     * length: `</span>{' '}` on its own line, and a literal space where both elements fit on one.
     * What matters is that SOMETHING separates them, because a line break between two JSX
     * elements is dropped and the cards were read out as one word.
     */
    expect(PAGE).toMatch(
      /<span>\{priceLabel\(tier, market, period\)\}<\/span>(?:\{' '\}| <small>)/,
    );
    expect(PAGE).not.toContain('</span>\n                  <small>{priceUnit(tier)}</small>');
    // the row that always got it right
    expect(PAGE).toContain('{priceLabel(preview, market, period)} {c.perMonth}');
  });
});
