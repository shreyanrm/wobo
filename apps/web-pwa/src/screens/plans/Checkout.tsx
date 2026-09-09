'use client';

/**
 * `/plans/checkout` — the honest state, in both of them.
 *
 * The checkout itself is the card at the bottom of the plans page (`Plans.tsx`); this address is
 * where the gift and donate pages send a reader who came to pay. So it asks the gateway once
 * whether payments are on (`checkout-flow.ts`, the same question the plans page asks) and says
 * one of two true things: OFF, paying is not open and nothing can be charged, with the promises
 * the money document already makes (`docs/legal/refund-and-cancellation.md` §2); ON, the checkout
 * is on the plans page, and the primary takes the reader to it. It used to say "Paying is not open
 * yet" whatever the gateway said, which put a page denying the door directly under a live one. The
 * document it links to is named by `CHECKOUT_PAGE.cancelling`, so the checkout and the gift page
 * cannot label it differently.
 */

import { useEffect, useState } from 'react';
import type { Route } from '../../shell/router';
import { legalPath } from '../legal/catalog';
import { ClosePanel } from '../site/ClosePanel';
import { useDoorsOpen } from '../site/dial';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { type PaymentsConfig, readPaymentsConfig } from './checkout-flow';
import { CHECKOUT_PAGE, checkoutPageWords } from './copy';

/**
 * "Go to the checkout" has to arrive AT the checkout.
 *
 * Its address is `/plans#checkout`, and the router has no hash in it anywhere: `hrefRoute` splits
 * the fragment off and `routeToPath` emits `/plans`, so the reader who pressed it landed at the top
 * of a long plans page with the card they asked for several screens below. The router still owns
 * the navigation; this brings the fragment along after it, once the page it names has rendered.
 *
 * A few frames are given because the destination mounts after the route changes, and the walk
 * stops the moment it finds the section or runs out — never a loop that outlives the click.
 */
export function revealHash(href: string, doc: Document = document, frames = 12): void {
  const id = href.split('#')[1];
  if (!id) return;
  let left = frames;
  const look = () => {
    const target = doc.getElementById(id);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return;
    }
    left -= 1;
    if (left > 0) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

export function Checkout() {
  // Whether the deploy can take money: null until the gateway has answered, and off on every
  // answer but the word. The browser never decides (checkout-flow.ts).
  const [pay, setPay] = useState<PaymentsConfig | null>(null);
  useEffect(() => {
    let live = true;
    void readPaymentsConfig().then((config) => {
      if (live) setPay(config);
    });
    return () => {
      live = false;
    };
  }, []);
  // Two switches, read separately: whether money can be taken, and whether the door to new
  // accounts is open (docs/DOORS-CLOSED.md §4).
  const words = checkoutPageWords(pay?.on ?? null, useDoorsOpen());
  return (
    <SiteShell current="plans" title="Checkout · Wobo">
      <section className="st-page-hero">
        <div className="st-wrap">
          <nav className="st-crumb" aria-label="Where this page sits">
            <SiteLink to={{ name: 'plans' }}>Plans</SiteLink>
            <span aria-hidden>/</span>
            <b>Checkout</b>
          </nav>
          <h1>{words.title}</h1>
          <p className="st-sub">{words.lead}</p>
          {pay?.on ? null : (
            <ul className="pl-promises">
              {CHECKOUT_PAGE.promises.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="st-row">
            {words.cta.href ? (
              <SiteLink
                href={words.cta.href}
                className="st-btn st-pig"
                onNavigate={() => revealHash(words.cta.href ?? '')}
              >
                {words.cta.label}
              </SiteLink>
            ) : (
              <SiteLink to={words.cta.to as Route} className="st-btn st-pig">
                {words.cta.label}
              </SiteLink>
            )}
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
