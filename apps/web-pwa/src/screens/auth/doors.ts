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

import type { Route } from '../../shell/router';
import { LIST } from '../site/invitation';
import type { MethodName, MethodState } from './client';
import { SIGN_IN, SIGN_UP } from './copy';

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

/**
 * HOW THIS BUILD CAN REACH A PARENT on the under-13 branch, where the account is the parent's and
 * the door they sign in through is a message to their own device. A link to an address, a code to
 * a number, or nothing at all.
 *
 * It exists because the branch used to assume the first of the three. Its only submit called the
 * magic-link seam, and NO BUILD HAS EVER HAD ONE — the SDK exposes requestPhoneOtp, verifyPhoneOtp
 * and signInWithGoogle, so `emailSeam` is null in every live build. The branch stripped the field
 * and both provider buttons off the page, drew zero controls in the action column, and ended on
 * "Writing to a parent is not switched on yet". Under-13 sign-up was unreachable in production.
 * `docs/legal/parental-consent.md` §2 names both shapes of message in one sentence, so the branch
 * takes whichever one is really wired.
 */
export type ParentWay = 'link' | 'code' | null;

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
  /** How a parent can be reached where the branch needs one. Null when they cannot be. */
  parentWay: ParentWay;
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
    // A link beats a code where both exist: a parent reading a page on their own device is closer
    // to what §2 describes than a parent reading six digits out loud.
    parentWay: open('magicLink') ? 'link' : phone ? 'code' : null,
    providers,
    // Both sides, or no rule. The providers keep their shape whether or not they work, so the
    // right-hand side is only empty when there are no providers to offer at all.
    divider: identifier !== 'none' && providers.length > 0,
    anyOpen: identifier !== 'none' || providers.some((door) => door.status === 'open'),
  };
}

// --- the OTHER door, in the bar --------------------------------------------------------------

/** Which of the two doors a person is standing at. */
export type DoorMode = 'sign-in' | 'sign-up';

/** The one link in the bar: what it says, where it goes, and the words that lead into it. */
export interface OtherDoor {
  prompt: string | null;
  label: string;
  to: Route;
}

/**
 * THE ONE DOOR ON THIS WAVE THAT DID NOT READ THE DIAL, AND THE ONE EVERY CLOSED PAGE LINKS TO.
 *
 * The sign-in page drew its own opposite door by hand: "Create an account", in the markup, with
 * JavaScript off, on the page all 438 pre-rendered files send a reader to. So a person read
 * "Wobo is not open yet" on a chapter page, pressed "Sign in", and the top right of the very next
 * page invited them to make an account. The destination already showed the invitation, so the
 * label was a promise its own address broke.
 *
 * Now it reads the dial like everything else. The sign-in door itself never changes: closing the
 * door to new accounts is not locking anybody out (`docs/DOORS-CLOSED.md` §2), so from the
 * sign-up side the other door is "Sign in" whatever the dial says.
 */
export function otherDoor(mode: DoorMode, open: boolean): OtherDoor {
  if (mode === 'sign-up') {
    return { prompt: SIGN_UP.switchPrompt, label: SIGN_UP.switchAction, to: { name: 'sign-in' } };
  }
  if (open) {
    return { prompt: SIGN_IN.switchPrompt, label: SIGN_IN.switchAction, to: { name: 'sign-up' } };
  }
  // The same address, which is where the invitation now stands, and the same words every other
  // surface uses for it. No prompt: "New here? Join the list" reads as a queue for a product,
  // and the line under the panel it lands on already says what is true.
  return { prompt: null, label: LIST.label, to: { name: 'sign-up' } };
}
