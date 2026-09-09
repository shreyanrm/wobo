'use client';

/**
 * The close: an invitation, because we are open.
 *
 * WHAT WAS HERE. An email field, a submit button, and an honest line saying the address was kept in
 * this browser because there was no waitlist endpoint to post it to. It was the truthful version of
 * the most common lie a marketing page tells, and it was still a form standing between a stranger
 * and a product they could have been using. Two costs, both real: a field is friction (SELL.md §8),
 * and a page that asks for an address tells the reader we are not open yet, which we are.
 *
 * WHAT IS HERE NOW. The one call to action, in the site's one phrase, and one quiet second for the
 * reader who is not the learner. Both come from `site/handoffs.ts` by way of `page-copy.ts`, so the
 * front page closes on exactly what every other public page closes on. No field, no submit, nothing
 * to remember, and nothing kept on the device.
 */

import { routeToPath } from '../../../shell/router';
import { useDoorsOpen } from '../../site/dial';
import { LandingLink } from '../link';
import { closeCopy } from '../page-copy';

export function Close() {
  // Both lines either side of the door follow it: while new accounts are closed, a close that
  // says "free every day" is describing a product the reader cannot have (docs/DOORS-CLOSED.md §5).
  const close = closeCopy(useDoorsOpen());
  return (
    <div className="wrap">
      <div id="close">
        <div className="glow" style={{ left: '-8%', top: '-20%' }} aria-hidden="true" />
        <div
          className="glow"
          style={{
            right: '-10%',
            bottom: '-30%',
            background: 'radial-gradient(circle,rgba(255,182,41,.28),transparent 70%)',
          }}
          aria-hidden="true"
        />
        <h2 className="reveal">{close.title}</h2>
        <p className="sub reveal">{close.sub}</p>
        <div className="cl-row reveal">
          <LandingLink className="btn" href={routeToPath(close.primaryTo)}>
            <span>{close.primary}</span>
          </LandingLink>
          <LandingLink className="btn cl-q" href={close.quietHref}>
            <span>{close.quiet}</span>
          </LandingLink>
        </div>
        {close.hand ? <p className="hand cl-hand reveal">{close.hand}</p> : null}
        <p className="fine reveal">{close.fine}</p>
      </div>
    </div>
  );
}
