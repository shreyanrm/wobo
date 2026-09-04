'use client';

/**
 * `/plans/checkout` — the honest state.
 *
 * The payment page is not open, so there is no checkout. This page says that in one line rather
 * than showing a disabled payment form, and lists what will be on it when there is something to
 * buy, because those promises are already made in `docs/legal/refund-and-cancellation.md` §2 and a
 * visitor is entitled to read them before they trust us with a card. The document it links to is
 * named by `CHECKOUT_PAGE.cancelling`, so the checkout and the gift page cannot label it differently.
 */

import { legalPath } from '../legal/catalog';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { CHECKOUT_PAGE } from './copy';

export function Checkout() {
  return (
    <SiteShell current="plans" title="Checkout · Wobo">
      <section className="st-page-hero">
        <div className="st-wrap">
          <nav className="st-crumb" aria-label="Where this page sits">
            <SiteLink to={{ name: 'plans' }}>Plans</SiteLink>
            <span aria-hidden>/</span>
            <b>Checkout</b>
          </nav>
          <h1>{CHECKOUT_PAGE.title}</h1>
          <p className="st-sub">{CHECKOUT_PAGE.lead}</p>
          <ul className="pl-promises">
            {CHECKOUT_PAGE.promises.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="st-row">
            <SiteLink to={{ name: 'onboarding' }} className="st-btn st-pig">
              {CHECKOUT_PAGE.cta}
            </SiteLink>
            <SiteLink to={{ name: 'plans' }} className="st-btn st-quiet">
              {CHECKOUT_PAGE.back}
            </SiteLink>
          </div>
          <p className="st-hint" style={{ marginTop: 'var(--s3)' }}>
            <SiteLink href={legalPath('refund-and-cancellation')} className="st-link">
              {CHECKOUT_PAGE.cancelling}
            </SiteLink>
          </p>
        </div>
      </section>
      <ClosePanel page="checkout" />
    </SiteShell>
  );
}
