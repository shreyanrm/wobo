/**
 * THE CALL TO ACTION. One phrase, one destination, one file.
 *
 * Owner, 2026-09-04 (DESIGN.md §0): **we are open.** Anyone can sign up and use Wobo today, so no
 * surface may imply a waitlist, and "Get early access" is retired. The site says "Start free",
 * everywhere.
 *
 * WHY IT LIVES IN A CONSTANT AND NOT IN EACH PAGE'S OWN COPY FILE. Before this file, the landing
 * page promised early access, the plans page promised early access, and seven other surfaces said
 * "Get started". A visitor who clicked one and read the other learned that we do not know whether
 * we are open, and that doubt costs more than either phrase gains (docs/SELL.md §7). Every public
 * surface now reads the phrase from here, so the next time it changes it changes once.
 *
 * The quiet second is here for the same reason. docs/SELL.md §6: every page has ONE primary action
 * and at most one quiet second, because two calls of equal weight convert worse than one.
 *
 * No React, no page import, and the router is imported as a TYPE only, which is erased at build
 * time: this module stays a leaf, so any surface can read it.
 */

import type { Route } from '../../shell/router';

/**
 * The words on the loud door, on every public surface.
 *
 * "Start free" and not "Start for free": it is two words, it is the offer and the price in one
 * breath, and it survives being the label on a 44px pill on a phone.
 */
export const START_FREE_LABEL = 'Start free';

/**
 * Where the loud door goes: the first run, which asks the board and the class once and then opens
 * the tutor. A route, so `SiteLink` renders a real `<a href="/onboarding">` a visitor can copy,
 * open in a new tab, and a crawler can follow.
 */
export const START_FREE_ROUTE: Route = { name: 'onboarding' };

/** The same address as a path, for the surfaces that link by `href` rather than by route. */
export const START_FREE_HREF = '/onboarding';

/**
 * THE call to action, as one object: the words, where it goes, and the one honest line that sits
 * under it.
 *
 * `under` is the only claim the door makes, and it is the claim the product can actually show: the
 * free plan is a real product used every day, not a trial that runs out after the first question
 * (docs/copy/README.md and the plans page's own "Free every day, from the first day").
 */
export const CTA = {
  label: START_FREE_LABEL,
  to: START_FREE_ROUTE,
  under: 'Free every day. No card to start.',
} as const;

/** The loud door as an action, for `handoffs.ts` and anything else that closes on a pair. */
export const START_FREE: { label: string; to: Route } = {
  label: CTA.label,
  to: CTA.to,
};

/** The quiet way in for someone who already has an account. Never at the same weight as the loud one. */
export const SIGN_IN = 'Sign in';

/**
 * The homepage's quiet second (docs/SELL.md §6). The learner reads the promise and the parent reads
 * the proof beside it, so the one alternative offered on the front door is the parent's page.
 */
export const PARENT_DOOR = { label: "I'm a parent", href: '/for-parents' } as const;

/**
 * The phrase no public surface may carry again, kept here so a test can look for it in one place
 * rather than each page's test looking for it separately.
 */
export const RETIRED_CTA = 'Get early access';
