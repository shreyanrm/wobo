/**
 * "Today" — the one bar a learner ever sees of the daily allowance, as a model with no React in
 * it, so the rule that matters most about it can be proved rather than remembered.
 *
 * THE RULE (docs/ALLOWANCE.md §2, the owner, 2026-09-08: *"it's not money based at the users'
 * end; that is only for internal purposes"*): the allowance is rupees inside the gateway and on
 * the operator's desk, and it is a proportion everywhere a learner or a parent can see it. So this
 * file holds ONE number, `used`, between 0 and 1, and it never reaches a screen as a number: it
 * becomes the width of a bar. There is no currency here, no monthly figure, no daily figure, no
 * generosity fraction, and the word "budget" appears nowhere a learner reads. `today.test.ts`
 * greps the rendered words for all of it, so a figure cannot be added later without going red.
 *
 * WHAT IT SAYS. One caption, "Refills overnight." The day turns over at the start of the calendar
 * day in the learner's own zone (docs/ALLOWANCE.md §1), and the clock law (docs/copy/voice.md §8.7
 * and §10, DESIGN.md §0, the owner 2026-09-04; `screens/site/hours.test.ts` enforces it) says no
 * public surface names that hour, not even as the word for it. docs/ALLOWANCE.md §2 spelled the
 * caption with the hour in it when it paraphrased the owner, whose own words only say "resets every
 * day in the learner's own time zone"; the clock law is the older and the higher law, so the
 * caption says when in the learner's life the day refills and nothing about the clock.
 * When the bar is full it also says the line the question counter already
 * says, which is the gateway's own (`budget.py`, `_EXHAUSTED[TURN]`); `today.test.ts` holds the
 * two together so they cannot drift, and the gateway may override it per learner by sending its
 * own line with the allowance.
 *
 * WHAT IT DOES NOT DO. It never invents a reading. A gateway that has not shipped the meter, a
 * read that did not land, a learner the brain has not met: all of them are `known: false`, and the
 * panel then draws no bar at all rather than an empty one, which would say "you have spent
 * nothing today" on no evidence.
 */

import type { DayAllowance, Me } from '@wobo/sdk';

/** What the panel draws. `used` is 0..1 and is only ever a width. */
export interface Today {
  known: boolean;
  /** 0..1 — the share of today already spent. Null when nothing could be read. */
  used: number | null;
  /** The day is spent. */
  spent: boolean;
  /** The gateway's own words for a spent day, when it sent any. */
  line: string | null;
}

export const UNREAD: Today = { known: false, used: null, spent: false, line: null };

/** The name over the bar. One word, and the only heading it has. */
export const TODAY_TITLE = 'Today';

/**
 * The caption. The day turns over while the learner sleeps, in their own zone, and that is the
 * whole of what a learner needs to know about the boundary: no clock time, no zone name, no date.
 * "Refills" is the copy law's own word for the allowance (docs/copy/voice.md §8.3, "a daily
 * allowance that refills once a day"); "overnight" is the clock law's own remedy for the hour it
 * bans (`screens/site/hours.test.ts`, the midnight row).
 */
export const RESETS_LINE = 'Refills overnight.';

/**
 * THE SPENT LINE, and it is not this file's invention.
 *
 * docs/ALLOWANCE.md §2: "When the bar is full, Wobo says the same honest line the question counter
 * says today". The question counter is `services/gateway/src/wobo_gateway/budget.py`, whose
 * `_EXHAUSTED[TURN]` is the sentence below, word for word; `today.test.ts` reads that file and
 * holds the two equal, so a change to either one goes red rather than quietly giving the product
 * two voices for the same moment. A gateway that sends its own line with the allowance wins over
 * this one, because a per-learner line is a better answer than a constant.
 *
 * The sentence promises nothing about Wobo (DESIGN.md section 0.x, never narrate): it says the day is
 * spent and that tomorrow has room, and not what Wobo will do when it comes. "I will be right
 * here" was the shape the never-narrate scan caught on 2026-09-14.
 */
export const SPENT_LINE = 'We have talked a lot today. Tomorrow there is room for more.';

/** Read the day out of what the brain said about this learner. */
export function readToday(me: Me | null | undefined): Today {
  const allowance: DayAllowance | undefined = me?.allowance;
  if (!allowance) return UNREAD;
  const used = allowance.used;
  if (used === null)
    return allowance.spent ? { known: true, used: 1, spent: true, line: null } : UNREAD;
  const share = Math.max(0, Math.min(1, used));
  return { known: true, used: share, spent: allowance.spent || share >= 1, line: null };
}

/** The width of the fill, as a percentage. Null when there is nothing honest to draw. */
export function todayFill(today: Today): number | null {
  if (!today.known || today.used === null) return null;
  return Math.max(0, Math.min(1, today.used)) * 100;
}

/**
 * The lines under the bar, in reading order. The caption is first and stays first, so the one
 * thing under the bar does not move as the day is spent; the spent line arrives beneath it.
 */
export function todayLines(today: Today): readonly string[] {
  if (!today.known) return [];
  if (!today.spent) return [RESETS_LINE];
  return [RESETS_LINE, today.line ?? SPENT_LINE];
}

/**
 * The bar, in words, for somebody who cannot see it.
 *
 * The bar carries a proportion and the copy law forbids printing one (DESIGN.md §0: no raw
 * allowance), so the drawn bar is hidden from assistive technology and this sentence is read
 * instead. It is the same vocabulary the rail and the plans page already use for what is left of a
 * day (`screens/plans/allowance.ts`), pointed at the same fact from the other side, and it is a
 * word every time, never a percentage.
 */
export function todaySpoken(today: Today): string | null {
  if (!today.known || today.used === null) return null;
  if (today.spent) return 'Today is used up.';
  if (today.used < 0.34) return 'Most of today is still there.';
  if (today.used < 0.67) return 'About half of today is left.';
  return 'Today is nearly used up.';
}
