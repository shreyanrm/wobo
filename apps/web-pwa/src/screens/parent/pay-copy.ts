/**
 * Every word the parent's pay and refer screens say.
 *
 * A parent is an adult who is busy and cares (docs/copy/voice.md 10a): the answer first, short
 * sentences, no em dash, no exclamation mark, never a late hour, and never a promise of money
 * back. The one line about where the money goes is docs/copy/money.md's, verbatim, one per screen:
 * `parentPay` on the pay screen (`money-voice.ts` is the copy of that table this reads). A parent's
 * donate door is the public /donate page, which carries the `donate` line itself. Wherever the plans page already says a thing, the sentence is ITS sentence,
 * imported, so the two places that take money cannot drift into two voices.
 *
 * The words that are new here are the ones only a parent reads: the child named in the third
 * person, the consent box in the payer's words, and the refusals the gateway sends in a learner's
 * voice ("You are already on a paid plan"), said again for the person who is paying.
 */

import { MONEY_LINES } from '../money-voice';
import { CHECKOUT_LINES } from '../plans/checkout-flow';
import { PLANS_PAGE } from '../plans/copy';
import type { Period } from '../plans/prices';

/** The child, by name when the server gave one. `start` capitalises the fallback for a sentence. */
export function who(name: string | null | undefined, start = false): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return start ? 'Your child' : 'your child';
}

/** "the name's" / "your child's". */
function whose(name: string | null | undefined, start = false): string {
  return `${who(name, start)}’s`;
}

export const PAY_COPY = {
  eyebrow: 'Pay',
  title: (name: string | null) => `A plan for ${who(name)}`,
  /** docs/copy/money.md, "parent's pay screen". The only money.md line on this screen. */
  money: MONEY_LINES.parentPay,
  unreadable: 'I could not read this plan just now. Nothing has changed. Try again in a moment.',
  retry: 'Try again',
  back: 'Back to your children',
  chooseChild: 'Choose a child',

  /** Where the child's plan stands, in the third person. The server gives the state, never these. */
  state: {
    free: (name: string | null) => `${who(name, true)} is on the free plan.`,
    running: (name: string | null, plan: string, day: string) =>
      `${who(name, true)} is on ${plan}. The same amount is taken again on ${day} unless you end it here.`,
    runningQuiet: (name: string | null, plan: string, day: string | null) =>
      day ? `${who(name, true)} is on ${plan} until ${day}.` : `${who(name, true)} is on ${plan}.`,
    ending: (name: string | null, plan: string, day: string | null) =>
      day
        ? `${who(name, true)} keeps ${plan} until ${day}. Nothing more is taken after that.`
        : `${who(name, true)} keeps ${plan} to the end of the period paid for. Nothing more is taken after that.`,
    ended: (name: string | null) =>
      `${whose(name, true)} plan has ended. Everything they learnt is still there.`,
    /** A running plan somebody else paid for: shown, never offered to end. */
    elsewhere: 'This plan was paid for from another account, so it is ended from there.',
    /** A plan bought in a phone's app store is ended in that store. */
    store: 'This plan was bought in a phone app store, so it is ended there.',
  },

  choose: {
    heading: 'Choose a plan',
    period: PLANS_PAGE.period.legend,
    plan: 'Which plan',
  },

  rows: {
    forWhom: 'For',
    /** The row's label; its value is the plans page's own words, "billed annually". */
    billed: 'How often',
    starts: PLANS_PAGE.checkout.starts,
    startsValue: PLANS_PAGE.checkout.startsValue,
    today: PLANS_PAGE.checkout.today,
    renews: PLANS_PAGE.checkout.renews,
    perMonth: PLANS_PAGE.checkout.perMonth,
    totalFor: PLANS_PAGE.checkout.totalFor,
  },

  /** The two boxes, unticked, and each one about THIS offer (plans/consent.ts). */
  consent: {
    terms: PLANS_PAGE.checkout.terms,
    termsNote: PLANS_PAGE.checkout.termsNote,
    renewal: {
      yearly:
        'I understand this renews every year and the same amount is taken again, until I end it on this page.',
      monthly:
        'I understand this renews every month and the same amount is taken again, until I end it on this page.',
    } as Readonly<Record<Period, string>>,
    renewalNote: {
      yearly: (name: string | null) =>
        `${who(name, true)} keeps the plan for the year paid for. Ending it stops the next one, in two taps.`,
      monthly: (name: string | null) =>
        `${who(name, true)} keeps the plan for the month paid for. Ending it stops the next one, in two taps.`,
    },
  },

  door: (name: string | null) => `Pay for ${who(name)}`,
  opening: PLANS_PAGE.checkout.opening,
  confirmingDoor: PLANS_PAGE.checkout.confirming,
  fine: PLANS_PAGE.checkout.fine,
  off: CHECKOUT_LINES.off,
  offNote: CHECKOUT_LINES.offNote,
  untick: 'Tick both boxes first.',
  confirming: CHECKOUT_LINES.confirming,
  confirmed: (name: string | null, plan: string, day: string | null) =>
    day
      ? `${who(name, true)} is on ${plan} now. It runs until ${day}.`
      : `${who(name, true)} is on ${plan} now.`,
  slow: 'It is taking a moment. The plan shows here by itself once the bank confirms.',
  dismissed: CHECKOUT_LINES.dismissed,
  loadFailed: CHECKOUT_LINES.loadFailed,
  startFailed: CHECKOUT_LINES.startFailed,

  /** The two-tap end. One plain sentence, no offer to stay. */
  end: {
    open: 'End this plan',
    confirm: 'Yes, end it',
    keep: 'Keep it',
    line: (name: string | null, day: string | null) =>
      `${who(name, true)} keeps the plan until ${day ?? 'the end of the period paid for'}. Nothing more is taken after that. Once it is ended it cannot be switched back on.`,
    done: (name: string | null, day: string | null) =>
      `Ended. ${who(name, true)} keeps the plan until ${day ?? 'the end of the period paid for'}, and nothing more is taken.`,
    failed: 'I could not end the plan just now. Nothing has changed. Try again in a moment.',
  },

  /** The server's refusals, said to the person paying. Keyed on the server's code. */
  refusals: {
    not_a_parent_account:
      'This page is for a parent account. Sign in with yours to pay for a child.',
    sign_in_required: 'Sign in with your parent account first.',
    no_child_selected: 'Choose which child this is for first.',
    no_such_child: 'That child is not linked to this account any more.',
    not_the_payer: 'This plan was paid for from another account, so it is ended from there.',
    already_subscribed: (name: string | null) =>
      `${who(name, true)} already has a plan, or a payment for one is still being confirmed. There is nothing more to pay.`,
    no_subscription: (name: string | null) =>
      `${who(name, true)} is on the free plan, so there is nothing to end.`,
  },
} as const;

export const REFER_COPY = {
  eyebrow: 'Refer',
  title: 'Tell another family',
  lede: 'Send this link to a parent you think Wobo would help. It opens Wobo for them, and nothing about your child goes with it.',
  code: 'Your code',
  link: 'Your link',
  copy: 'Copy the link',
  copied: 'Copied.',
  copyFailed: 'That did not copy. Press and hold the link to copy it.',
  share: 'Share',
  shareText: 'Wobo explains things by drawing them, until they make sense. Have a look.',
  back: PAY_COPY.back,
} as const;
