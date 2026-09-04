/**
 * WHICH doors this build actually has, and how each one is drawn.
 *
 * `client.ts` answers "is this seam wired"; this module turns that into the shape of the page. It
 * is separated out for one reason: the honesty rules on this screen are decisions, not styling, and
 * a decision that lives in JSX cannot be tested. Every rule below cost the owner a screenshot.
 *
 *  · A way in that works is rendered as a control that works.
 *  · A way in that does not work KEEPS ITS SHAPE and carries a `soon` chip. It is never a dead grey
 *    slab with an apology sentence printed underneath it — the same call the owner made for the
 *    app store buttons.
 *  · A rule with a word in it is drawn only when there is something on BOTH sides of it. A divider
 *    with nothing after it but a line saying the other way was switched off is the exact thing that
 *    was wrong with the screen this replaces.
 *  · When nothing at all is wired, no control is drawn. A button that cannot do anything is worse
 *    than a sentence saying so.
 *
 * The one field is the interesting case. Email and phone are two seams but ONE ruled line on the
 * page, so what the field is called, what keyboard it opens and what the button under it promises
 * all follow from which of the two are live — see `field.ts`.
 */

import type { MethodName, MethodState } from './client';

/** A door that is open, or one that is coming. There is no third state on this screen. */
export type DoorStatus = 'open' | 'soon';

/** The accounts a learner already has, in the order the page offers them. */
export const PROVIDER_ORDER = ['google', 'apple'] as const;
export type ProviderName = (typeof PROVIDER_ORDER)[number];

export interface ProviderDoor {
  name: ProviderName;
  status: DoorStatus;
}

/** What the one ruled field accepts, which is exactly what is wired behind it. */
export type IdentifierKind = 'both' | 'email' | 'phone' | 'none';

/** How an address typed into the field would be used, when one can be used at all. */
export type EmailSeam = 'password' | 'magicLink' | null;

export interface WaysIn {
  /** The one field, or `none` when neither an email nor a phone seam exists. */
  identifier: IdentifierKind;
  /**
   * Which seam the email half of the field would use. A password beats a link where both exist,
   * because signing in with a password you already have is one step and a link is three. Null when
   * no email seam is wired at all, which is what makes `identifier` drop the email half.
   */
  emailSeam: EmailSeam;
  /** The provider buttons, in order. Each one is open or carries `soon`. */
  providers: ProviderDoor[];
  /** Draw the rule with `or` in it. True only when both sides of it have something. */
  divider: boolean;
  /** False when this build cannot sign anybody in by any route. */
  anyOpen: boolean;
}

/** How this build's doors are drawn, from the states `methodStates` read off the one client. */
export function waysIn(states: readonly MethodState[]): WaysIn {
  const open = (name: MethodName): boolean =>
    states.some((state) => state.name === name && state.available);

  const phone = open('phone');
  const emailSeam: EmailSeam = open('password')
    ? 'password'
    : open('magicLink')
      ? 'magicLink'
      : null;
  const email = emailSeam !== null;
  const identifier: IdentifierKind =
    phone && email ? 'both' : phone ? 'phone' : email ? 'email' : 'none';

  const providers: ProviderDoor[] = PROVIDER_ORDER.map((name) => ({
    name,
    status: open(name) ? 'open' : 'soon',
  }));

  return {
    identifier,
    emailSeam,
    providers,
    // Both sides, or no rule. The providers keep their shape whether or not they work, so the
    // right-hand side is only empty when there are no providers to offer at all.
    divider: identifier !== 'none' && providers.length > 0,
    anyOpen: identifier !== 'none' || providers.some((door) => door.status === 'open'),
  };
}
