/**
 * "Turns left today", read from the brain rather than guessed.
 *
 * WOBO-PLAN §16 asks for an allowance widget with a real reset time. The client never computes a
 * limit — `sdk.me()` asks the gateway, which answers with what is left of the day and the instant
 * the window rolls over (`packages/sdk/src/gateway.ts`). Everything here is the honest reading of
 * that answer, including the two cases where there is no answer: a build with no gateway
 * configured, and a learner the gateway has not met yet.
 */

import type { Me } from '@wobo/sdk';

export interface Allowance {
  /** False when nothing could be read — the widget then says so instead of showing a number. */
  known: boolean;
  remaining: number | null;
  limit: number | null;
  /** When the day's allowance comes back. */
  resetsAt: Date | null;
}

/** Read the allowance out of what the brain said about this learner. */
export function readAllowance(me: Me | null | undefined): Allowance {
  if (!me) return { known: false, remaining: null, limit: null, resetsAt: null };
  const { remaining, limit, used } = me.budget.turns;
  const left = remaining ?? (limit !== null && used !== null ? Math.max(limit - used, 0) : null);
  const at = me.budget.resetAt ? new Date(me.budget.resetAt) : null;
  return {
    known: left !== null || limit !== null,
    remaining: left,
    limit,
    resetsAt: at && !Number.isNaN(at.getTime()) ? at : null,
  };
}

/**
 * The clock time an allowance comes back, in the reader's own locale.
 *
 * Lower-cased, because DESIGN.md's very first line is "sentence case" and a locale that returns
 * "6:00 AM" would shout the meridiem in the middle of a calm sentence. Locales that do not use one
 * are untouched. This used to be lower-cased at one call site only, which is how the rail said
 * "6:00 am" while the plans page said "6:00 AM" about the same instant.
 */
export function resetTime(at: Date): string {
  return at
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\b(AM|PM)\b/, (m) => m.toLowerCase());
}

/**
 * How much of today is left, in words. Law v5's copy law (DESIGN.md §0) bans a raw allowance on a
 * public surface — "40 questions a day" is a number nobody asked for and it makes a generous
 * allowance sound like a meter — so this says what the day FEELS like and lets the drawn bar carry
 * the proportion exactly. The reading is still the brain's, never a guess: an allowance nothing
 * could be read for says so rather than inventing a share.
 */
export function allowanceShare(allowance: Allowance): number | null {
  if (!allowance.known || allowance.remaining === null || !allowance.limit) return null;
  return Math.max(0, Math.min(1, allowance.remaining / allowance.limit));
}

/**
 * What the widget says. One sentence, sentence case, no exclamation, and never a figure we did not
 * read — an unknown allowance says it is unknown.
 */
export function allowanceLine(
  allowance: Allowance,
  format: (at: Date) => string = resetTime,
): string {
  if (!allowance.known || allowance.remaining === null) {
    return 'Sign in and this shows how much of today is left, and when it comes back.';
  }
  const back = allowance.resetsAt
    ? ` It comes back at ${format(allowance.resetsAt)}.`
    : ' It comes back when the day rolls over.';
  if (allowance.remaining === 0) return `Today's allowance is used up.${back}`;
  const share = allowanceShare(allowance);
  if (share === null) return `There is still allowance left today.${back}`;
  if (share > 0.66) return `Most of today's allowance is still there.${back}`;
  if (share > 0.33) return `About half of today's allowance is left.${back}`;
  return `Today's allowance is nearly used up.${back}`;
}
