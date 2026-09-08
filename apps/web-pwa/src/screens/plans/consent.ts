/**
 * The two consent boxes at the checkout, as a value that CANNOT be left ticked for a sentence
 * nobody read.
 *
 * The section's own lead says "Nothing pre-ticked." It was, though not by a default: the boxes were
 * two plain booleans, and switching the period or the plan rewrote both sentences underneath them
 * and left both ticks where they were. A buyer who agreed to "I am paying for a year" and then
 * pressed Monthly arrived at a pre-ticked affirmation of a statement that had changed under them,
 * which is exactly the thing the two separate boxes exist to prevent.
 *
 * So a tick is not stored as "yes". It is stored as "yes, TO THIS OFFER" — the plan and the period
 * it was given for. Change either and the answer is no longer about the thing on the screen, so it
 * simply is not read. There is no reset to remember and no code path that can forget to call one.
 */

import type { Period } from './prices';

export interface ConsentState {
  /** The offer these answers were given for — `plan:period`. Empty before either box is touched. */
  offer: string;
  terms: boolean;
  renewal: boolean;
}

/** Which offer is on the card: the plan being bought, and the period it is bought for. */
export function offerKey(planId: string, period: Period): string {
  return `${planId}:${period}`;
}

export const NO_CONSENT: ConsentState = { offer: '', terms: false, renewal: false };

/** What the two boxes show for the offer currently on the card. Another offer's answers are not. */
export function ticked(state: ConsentState, offer: string): { terms: boolean; renewal: boolean } {
  if (state.offer !== offer) return { terms: false, renewal: false };
  return { terms: state.terms, renewal: state.renewal };
}

/** Both boxes ticked, for THIS offer. The only thing the payment door may act on. */
export function bothTicked(state: ConsentState, offer: string): boolean {
  const now = ticked(state, offer);
  return now.terms && now.renewal;
}

/** One box moved. The answers carry the offer they were given for, and never another one's. */
export function tick(
  state: ConsentState,
  offer: string,
  box: 'terms' | 'renewal',
  on: boolean,
): ConsentState {
  const base = ticked(state, offer);
  return { offer, terms: base.terms, renewal: base.renewal, [box]: on };
}
