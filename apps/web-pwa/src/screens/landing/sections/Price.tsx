'use client';

/**
 * "It costs nothing to start, and nothing to keep going." — the price, on the front page.
 *
 * WHY IT IS HERE AT ALL. It was on another page, reached by a link, which is friction (SELL.md §8)
 * and reads as something being hidden. Our price story is unusually good — the free plan is a real
 * product used every day, not a trial that runs out — and a good story behind a click converts
 * worse than a plain one in front of the reader.
 *
 * NOT ONE FIGURE IS TYPED IN THIS FILE. Every amount, unit, allowance and plan name is read from
 * `screens/plans/prices.ts`, the same table the plans page and the checkout read, so the homepage
 * can never quote a price we do not charge. The market is inferred from the browser and never
 * asked for (law v5's copy law), and it is a display choice only: the price is the same for
 * everyone inside a market.
 *
 * THE PERIOD IS YEARLY, and that is deliberate rather than a default left where it fell. Yearly is
 * the better deal (`docs/PRICING.md`: a year costs ten months), so putting the worse one in front
 * of it would be the kind of thing this product exists not to do. The card says the per-month
 * figure because that is how a family compares it, and it says "billed annually" beside it so
 * nobody is surprised by what is actually taken.
 *
 * The last block answers "what if it does not work out" in the same breath, because that is the
 * same fear with a second face. It is the cancel, never a refund (DESIGN.md §0).
 */

import { useMemo } from 'react';
import {
  BEST_FOR,
  BILLED,
  fineLine,
  PERIOD_SAVING,
  PLAN_TIERS,
  priceLabel,
  priceUnit,
  readMarket,
} from '../../plans/prices';
import { LandingLink } from '../link';
import { PRICE } from '../page-copy';

export function Price() {
  // Read once per mount: the browser's region does not change while someone reads a page, and
  // asking Intl on every render would be work done for nothing.
  const market = useMemo(() => readMarket(), []);

  return (
    <section id="price">
      <div className="wrap">
        <div className="eyebrow reveal">{PRICE.eyebrow}</div>
        <h2 className="t reveal">
          {PRICE.title.lead}
          <span className="hl">{PRICE.title.mark}</span>
        </h2>
        <p className="lede reveal">{PRICE.lede}</p>

        <div className="prices reveal">
          {PLAN_TIERS.map((tier) => (
            <div className={tier.recommended ? 'plan lead' : 'plan'} key={tier.id}>
              <div className="pl-name">
                {tier.name}
                {tier.recommended ? <em>{BEST_FOR}</em> : null}
              </div>
              <div className="pl-amount">
                {priceLabel(tier, market, 'yearly')}
                <span>{priceUnit(tier)}</span>
              </div>
              <div className="pl-said">{tier.blurb}</div>
              {/* The free tier has no period, so it keeps its own line rather than being given
                  one that would be true of a plan it is not. */}
              <div className="pl-fine">
                {tier.price ? `${BILLED.yearly} · ${PERIOD_SAVING}` : fineLine(tier, 'yearly')}
              </div>
            </div>
          ))}
        </div>

        <div className="cancel reveal">
          <b>{PRICE.cancel.title}</b>
          <p>{PRICE.cancel.body}</p>
          <LandingLink href={PRICE.cancel.link.href}>{PRICE.cancel.link.label}</LandingLink>
        </div>
      </div>
    </section>
  );
}
