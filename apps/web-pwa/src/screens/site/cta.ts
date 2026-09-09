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
import { useDoorsOpen } from './dial';
import { LIST } from './invitation';

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

// --- the door while the dial is off ---------------------------------------------------------

/**
 * THE SECOND DOOR, AND WHY THIS FILE NOW HOLDS TWO.
 *
 * Owner, 2026-09-09 (`docs/DOORS-CLOSED.md`): *"Block any account creations for now until further
 * notice, because we have SEO, AEO and GEO but no product yet."* 438 public pages are about to
 * start earning visitors from search, and a person who arrives, signs up and meets a tutor that is
 * not ready is lost permanently.
 *
 * So the door above is not deleted, and nothing about it is edited. It stays exactly as it was and
 * a second one is written beside it, and `ctaFor` picks between them from the dial. That is what
 * makes reopening a switch rather than a rebuild: the day `doors_open` goes true, every one of the
 * nineteen surfaces says "Start free" again, within a minute, with no release (§4).
 */

/** The words on the door while the door is closed. Plain, and exactly what pressing it does. */
export const JOIN_LIST_LABEL = LIST.label;

/**
 * Where it goes: the sign-up address, which is where the door has always been. The invitation
 * stands in its place, so every link a reader has bookmarked, and every pre-rendered file that
 * names it, lands on the right thing without a redirect.
 */
export const JOIN_LIST_ROUTE: Route = { name: 'sign-up' };

/** The same address as a path, for the surfaces that link by `href`. */
export const JOIN_LIST_HREF = '/sign-up';

/**
 * The call to action while the dial is off, in the same shape as `CTA` so no surface has to know
 * which one it is holding. `under` is the whole of what this door claims, and both halves of it
 * are facts.
 */
export const LIST_DOOR = {
  label: JOIN_LIST_LABEL,
  to: JOIN_LIST_ROUTE,
  under: LIST.under,
} as const;

/** The list door as an action, for `handoffs.ts` and anything else that closes on a pair. */
export const JOIN_LIST: { label: string; to: Route } = {
  label: LIST_DOOR.label,
  to: LIST_DOOR.to,
};

/** The one call to action, for the dial as it stands. */
export function ctaFor(open: boolean): { label: string; to: Route; under: string } {
  return open ? CTA : LIST_DOOR;
}

/**
 * Swap ONE action for the dial, and leave every other action untouched.
 *
 * A close panel's pair is a door and a next step (`docs/SELL.md` §6). Only the door changes when
 * the dial turns: "See plans" is still "See plans" on a site that is not taking accounts, and a
 * table that rewrote both would have quietly deleted the argument each page ends on.
 */
export function doorFor<T extends { label: string; to?: Route; href?: string }>(
  action: T,
  open: boolean,
): T | { label: string; to: Route } {
  if (open) return action;
  const path = action.href ?? (action.to?.name === 'onboarding' ? START_FREE_HREF : null);
  if (path !== START_FREE_HREF) return action;
  return action.label.toLowerCase().includes('instead')
    ? { label: `${LIST_DOOR.label} instead`, to: LIST_DOOR.to }
    : JOIN_LIST;
}

/** The call to action, for a screen. Reads the dial, so the words follow the switch. */
export function useCta(): { label: string; to: Route; under: string } {
  return ctaFor(useDoorsOpen());
}
