/**
 * "Your plan", as a model — every word the panel says and every tap it accepts, with no React in
 * it, so the two things that matter most about cancelling can be proved rather than asserted:
 * that the confirmation is one tap away, and that a failed request leaves the plan exactly where
 * it was.
 *
 * THE SENTENCE THIS EXISTS TO MAKE TRUE (screens/plans/copy.ts): "You → Your plan → Cancel. Two
 * taps, no call, no 'are you sure' maze. You keep the plan until the month you paid for ends."
 *
 * So the rules are the sentence's own, and they are enforced here rather than remembered:
 *  · TWO TAPS. Cancel opens the confirmation; the confirmation cancels. `planControls` is the
 *    whole set of controls on any surface of the panel, and the walk from an active plan to a
 *    cancelled one passes through exactly two of them.
 *  · NO MAZE. The confirmation offers exactly two choices, and `CONTROL_IDS` is closed: there is
 *    no discount, no pause, no survey, no reason picker, and no way to add one without changing
 *    this file and its test.
 *  · NOTHING IS TAKEN AWAY EARLY. A cancelled plan runs to the end of the period already paid
 *    for, and only reads as free once that date has passed.
 *  · NOTHING IS CLAIMED THAT DID NOT HAPPEN. `settled` with a failure keeps the subscription it
 *    already had. The only thing that changes a plan in this reducer is a server body — and a
 *    read that never landed is its own state, never the free plan.
 *
 * The copy law (DESIGN.md §0) applies to every line here: no invented person, no grade range, no
 * raw allowance — the free plan says what an evening feels like, a paid one says what it
 * multiplies, and neither says a number.
 */

import { multipleInWords } from '../allowance-words';
import { PLAN_TIERS } from '../plans/prices';
import type { BillingOutcome, PlanSource, Subscription, SubscriptionRead } from './billing';

// --- what the panel is showing -------------------------------------------------------------------

/**
 * The four states the panel has, plus the two it passes through.
 *  · `loading`    — the first read has not settled. Nothing is claimed yet.
 *  · `active`     — a paid plan that renews.
 *  · `cancelled`  — a paid plan that stops at the end of the period, and has not reached it.
 *  · `free`       — the free allowance. A cancelled plan past its end date reads as this.
 *  · `unreadable` — the read did not land, or the brain says this learner is on a paid plan and
 *                   the subscription could not be read. Saying "Free" here would be a guess about
 *                   someone's money made out of an outage.
 */
export type PanelView = 'loading' | 'active' | 'cancelled' | 'free' | 'unreadable';

/** Every control the panel can ever draw. The list is closed on purpose (see the header). */
export const CONTROL_IDS = ['cancel', 'confirm', 'back', 'resume', 'plans', 'retry'] as const;
export type ControlId = (typeof CONTROL_IDS)[number];

export interface PlanControl {
  id: ControlId;
  label: string;
  /** ink is the action; quiet is the way back. The pointer (pig) is never spent on cancelling. */
  tone: 'ink' | 'quiet';
  /** The Cancel control is never smaller than the other controls on the You screen. */
  size: 'md' | 'sm';
  /** A request is in flight. The control says so and cannot be pressed twice. */
  busy?: boolean;
}

/** Where the panel is between taps. */
export type PlanStep = 'idle' | 'confirming' | 'cancelling' | 'resuming';

export interface PlanModel {
  /** The subscription the server described, or null when it has not described one. */
  sub: Subscription | null;
  /**
   * THE READ DID NOT LAND. Kept apart from `sub` on purpose: a free learner and a learner whose
   * plan we could not read both arrive with no subscription in hand, and only one of them may be
   * told they are on Free. Before this flag the two were the same value, so a gateway that was
   * entirely down (both this read and `GET /v1/me` fail together) printed the heading "Free", the
   * free allowance line and no cancel — a settled claim about somebody's money made out of an
   * outage, with no way out of it, on the product's only door out.
   */
  unreadable: boolean;
  /** The plan `GET /v1/me` already told the screen. A second witness, never the only one. */
  planId: string | null;
  step: PlanStep;
  /** Set only by a failure, cleared by anything the learner does next. */
  error: string | null;
  loading: boolean;
}

export function initialModel(planId: string | null = null): PlanModel {
  return { sub: null, unreadable: false, planId, step: 'idle', error: null, loading: true };
}

// --- the words -----------------------------------------------------------------------------------

/** What a failed write says. The plan is unchanged, and the line says exactly that. */
export const CANCEL_FAILED =
  'That did not go through, so your plan has not changed. Try again in a moment.';
export const RESUME_FAILED =
  'That did not go through, so your plan has not changed. Try again in a moment.';
export const UNREADABLE =
  'I could not read your plan just now. Nothing has changed. Try again in a moment, or write to support@heywobo.com.';

/** What the learner keeps, said the same way in the panel and in the confirmation. */
export const WORK_STAYS =
  'Everything you have learnt stays: your history, your mastery, your climb.';

/**
 * THE ONE TAP THAT COUNTS. The gateway sends this sentence with every plan it says can be
 * cancelled (`billing/__init__.py`, `CONFIRM`) because a provider cannot restart a cancelled
 * subscription: the resume route answers 409 `cannot_resume`, and the plans FAQ says the same
 * thing to a reader who has not paid yet. The panel is where the decision is actually made, so
 * it says it too — in the confirmation before the tap, and on the cancelled card afterwards,
 * where it is the reason there is no Resume to press. `plan.test.ts` holds these words against
 * the gateway's own, so they cannot drift apart.
 */
export const NO_RESUME =
  'Once it is cancelled it cannot be switched back on, so this is the one tap that counts.';

/** Said beside a renewal, and only beside one: the way out, in the count the plans page prints. */
export const STOP_ANY_TIME = 'Cancel any time, in two taps, and nothing more is taken.';

/** Where a plan bought in a store is cancelled, and why it is cancelled there. No blame. */
export const STORE_LINES: Readonly<Record<Exclude<PlanSource, 'web'>, string>> = {
  app_store:
    'This plan was bought through the App Store, so the App Store is where it is cancelled: open Settings on your device, tap your name, then Subscriptions.',
  play_store:
    'This plan was bought through Google Play, so Google Play is where it is cancelled: open the Play Store, tap your picture, then Payments and subscriptions.',
};

/** "4 October 2026". Null when the server gave no date, which the copy then says in words. */
export function dayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toDateString();
  }
}

/**
 * A tier id, read as a name: the price list's word for it, else the id with a capital on it. A
 * tier the price list has not heard of ('plus' is one the gateway allows) is better shown by its
 * own id than by a raw string, and far better than by another tier's name. Empty in, empty out.
 */
export function tierName(planId: string | null): string {
  const id = planId?.trim();
  if (!id) return '';
  return PLAN_TIERS.find((t) => t.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** The tier's name: the price list's word for it, else the server's, else the id, made a name. */
export function planName(sub: Subscription | null): string {
  if (!sub) return 'Free';
  const tier = PLAN_TIERS.find((t) => t.id === sub.planId);
  return tier?.name ?? sub.planName ?? tierName(sub.planId);
}

/**
 * The heading over the panel. EMPTY while the first read is still out and nothing at all is known
 * — an empty heading is honest, and "Free" over someone's paid plan for a second is not. When the
 * screen already knows the tier from `GET /v1/me` it says that, because that is a server's answer
 * and not a guess.
 */
export function panelTitle(model: PlanModel, now: Date): string {
  const view = panelView(model, now);
  if (view === 'loading' || view === 'unreadable') return tierName(model.planId);
  if (view === 'free') return 'Free';
  return planName(model.sub);
}

/**
 * What the plan's day carries, in words. Free says what it feels like, a paid tier says what it
 * multiplies, and neither says a number (DESIGN.md §0). A paid tier the price list does not know
 * gets NO line at all: an allowance we cannot look up is one we must not describe.
 */
export function allowanceLine(sub: Subscription | null): string | null {
  const planId = sub?.planId ?? 'free';
  const tier = PLAN_TIERS.find((t) => t.id === planId);
  if (!tier) return null;
  const times = multipleInWords(tier.allowanceMultiple);
  if (!times) return 'Enough for a normal evening, every day, and it resets each morning.';
  return `${times.charAt(0).toUpperCase()}${times.slice(1)}, every day.`;
}

/** Whether the paid period is still running at `now`. A plan with no end date is still running. */
export function stillRunning(sub: Subscription | null, now: Date): boolean {
  if (!sub) return false;
  if (!sub.periodEnd) return true;
  const end = new Date(sub.periodEnd);
  return Number.isNaN(end.getTime()) ? true : end.getTime() > now.getTime();
}

/**
 * Whether this door can end this plan. The SERVER's answer, never ours: it knows about a plan
 * bought in a store, and about a paid plan whose period it cannot see, and both look cancellable
 * from here and are not. Offering a Cancel that will be refused is worse than saying where the
 * cancel actually lives, which is what the lines below do.
 */
export function cancellableHere(sub: Subscription | null): boolean {
  return sub?.canCancel === true;
}

/** What the panel is showing right now. */
export function panelView(model: PlanModel, now: Date): PanelView {
  if (model.loading) return 'loading';
  // A read that did not land is unreadable WHATEVER the tier said, because the tier came from the
  // same gateway: when it is down, both are silent, and silence is not evidence of a free plan.
  if (model.unreadable) return 'unreadable';
  const { sub } = model;
  if (!sub) {
    // No subscription and no paid plan on record is the free plan, said plainly. A paid plan we
    // could not read is neither free nor cancellable, and the panel says so instead of guessing.
    return model.planId && model.planId !== 'free' ? 'unreadable' : 'free';
  }
  if (sub.state === 'free' || sub.state === 'ended') return 'free';
  // After the end date a cancelled plan IS the free plan; the panel stops talking about a date
  // that has passed rather than leaving a stale "until" on the screen.
  if (sub.state === 'cancelling') return stillRunning(sub, now) ? 'cancelled' : 'free';
  return 'active';
}

/**
 * The line that says where a cancel this door cannot make actually lives. A plan bought in a
 * store gets the store's own steps, in one sentence and without blaming anyone; a paid plan the
 * gateway cannot see a period for gets the gateway's own line, which is the only place that state
 * is described. Null when the panel's own Cancel is the answer.
 */
export function elsewhereLine(sub: Subscription | null): string | null {
  if (!sub || sub.canCancel) return null;
  if (sub.source !== 'web') return STORE_LINES[sub.source as Exclude<PlanSource, 'web'>];
  return sub.line;
}

/** The lines under the heading, in the order they are read. */
export function panelLines(model: PlanModel, now: Date): readonly string[] {
  const view = panelView(model, now);
  const sub = model.sub;
  const when = dayLabel(sub?.periodEnd ?? null);
  if (view === 'active') {
    // WHAT HAPPENS ON THAT DATE, in the words for the plan this actually is. A provider-backed
    // subscription is charged again — `billing/plans.py` creates it with a `total_count` of five
    // years or sixty months, so the card is taken until somebody cancels — and this line was the
    // only thing a payer read about the date. It said "Your plan runs until 7 September 2027." and
    // stopped there. A plan nobody is charging (an operator's grant) genuinely does just run out,
    // and says so. Which of the two it is comes off the body (`renews`) and is never worked out
    // here, because the state is the promise.
    const runs = sub?.renews
      ? when
        ? `Your plan renews on ${when}, and the same amount is taken again.`
        : 'Your plan renews at the end of the period you have paid for, and the same amount is taken again.'
      : when
        ? `Your plan runs until ${when}.`
        : 'Your plan runs to the end of the period you have paid for.';
    const stop = sub?.renews && cancellableHere(sub) ? STOP_ANY_TIME : null;
    return [allowanceLine(sub), runs, stop, elsewhereLine(sub)].filter(
      (line): line is string => line !== null,
    );
  }
  if (view === 'cancelled') {
    // "Pro until 4 October 2026, then free." The whole of what happens, in one line: the date the
    // paid period ends and what the day is after it. No refund is promised here or anywhere on
    // this screen (DESIGN.md §0, cancel never refund; `no-refund.test.ts` greps).
    const until = when
      ? `${planName(sub)} until ${when}, then free.`
      : `${planName(sub)} until the end of the period you have paid for, then free.`;
    // WHY THERE IS NO BUTTON HERE. `panelControls` offers a Resume only where the server says one
    // is possible, and a provider-backed cancel cannot be undone (the gateway refuses it, 409
    // `cannot_resume`), so the panel used to go quiet: a cancelled plan, no control, and no reason
    // given for its absence. The sentence the confirmation already made is repeated where the
    // absence is felt.
    const back = sub?.canResume ? null : NO_RESUME;
    return [until, 'Nothing will be charged again.', back, WORK_STAYS].filter(
      (line): line is string => line !== null,
    );
  }
  if (view === 'unreadable') return [UNREADABLE];
  if (view === 'loading') return [];
  return [allowanceLine(null)].filter((line): line is string => line !== null);
}

/** The word in the pill. State is carried by a word, never by a colour (DESIGN.md §0). */
export function stateWord(model: PlanModel, now: Date): string | null {
  const view = panelView(model, now);
  if (view === 'active') return 'active';
  if (view === 'cancelled') return 'cancelled';
  if (view === 'free') return 'free';
  return null;
}

/**
 * The confirmation, in the learner's own terms: the date they keep it until, that nothing is
 * charged after it, that their work stays, and that there is no way back. Four sentences and no
 * fifth — there is no offer, no survey and no reason picker in this list, and the test holds it to
 * that.
 *
 * THE FOURTH ONE IS THE POINT. The gateway sends it in the plan body's `confirm` field and the
 * plans FAQ already prints it, so the one screen where the decision is actually made was the only
 * surface that left it out: a learner tapped "Cancel the plan" having been told three reassuring
 * things and nothing about the tap being final. `plan.test.ts` holds this sentence against the
 * gateway's own words, so the two cannot drift.
 */
export function confirmationLines(sub: Subscription | null): readonly string[] {
  const when = dayLabel(sub?.periodEnd ?? null);
  const keep = when
    ? `You keep ${planName(sub)} until ${when}. Nothing is taken away before then.`
    : `You keep ${planName(sub)} until the end of the period you have paid for. Nothing is taken away before then.`;
  return [
    keep,
    'Nothing is charged after that, and your day goes back to the free allowance on its own.',
    WORK_STAYS,
    NO_RESUME,
  ];
}

export const CONFIRM_TITLE = 'Cancel your plan';

// --- the controls --------------------------------------------------------------------------------

const CANCEL: PlanControl = { id: 'cancel', label: 'Cancel plan', tone: 'ink', size: 'md' };
const BACK: PlanControl = { id: 'back', label: 'Keep my plan', tone: 'quiet', size: 'md' };

/**
 * The controls on the CARD itself. One plain Cancel while the plan is active and was bought here;
 * a quiet Resume while it is ending; the door to the plans while it is free. Never more than one,
 * never behind a disclosure, and the Cancel is `md` — the other controls on the You screen are
 * `sm`, so it is the largest thing on the panel rather than the smallest.
 */
export function panelControls(model: PlanModel, now: Date): readonly PlanControl[] {
  const view = panelView(model, now);
  if (view === 'active') return cancellableHere(model.sub) ? [CANCEL] : [];
  if (view === 'cancelled') {
    if (!model.sub?.canResume) return [];
    return [
      {
        id: 'resume',
        label: model.step === 'resuming' ? 'Resuming…' : 'Resume the plan',
        tone: 'quiet',
        size: 'sm',
        busy: model.step === 'resuming',
      },
    ];
  }
  if (view === 'free') return [{ id: 'plans', label: 'See the plans', tone: 'quiet', size: 'sm' }];
  if (view === 'unreadable')
    return [{ id: 'retry', label: 'Try again', tone: 'quiet', size: 'sm' }];
  return [];
}

/** The confirmation's choices. EXACTLY two, always, in every state it can be in. */
export function confirmControls(model: PlanModel): readonly PlanControl[] {
  const busy = model.step === 'cancelling';
  return [
    {
      id: 'confirm',
      label: busy ? 'Cancelling…' : 'Cancel the plan',
      tone: 'ink',
      size: 'md',
      busy,
    },
    { ...BACK, busy },
  ];
}

/**
 * Every control on the surface the learner is looking at, in reading order. The component renders
 * this list and nothing else, so counting taps through it is counting taps on the screen.
 */
export function planControls(model: PlanModel, now: Date): readonly PlanControl[] {
  return isConfirming(model) ? confirmControls(model) : panelControls(model, now);
}

/** True while the confirmation is the surface the learner is looking at. */
export function isConfirming(model: PlanModel): boolean {
  return model.step === 'confirming' || model.step === 'cancelling';
}

// --- the reducer ---------------------------------------------------------------------------------

export type PlanAction =
  /**
   * A read settled. `{ ok: false }` means it could not be read, which is a state of its own and
   * not the free plan — the whole point of the tri-state (see `PlanModel.unreadable`).
   */
  | { type: 'read'; result: SubscriptionRead }
  /** The learner pressed one of `planControls`. */
  | { type: 'tap'; id: ControlId }
  /** A write answered. Only this, with `ok`, ever changes the subscription. */
  | { type: 'settled'; outcome: BillingOutcome };

function tapped(model: PlanModel, id: ControlId): PlanModel {
  switch (id) {
    // One tap from the panel to the confirmation. Nothing stands between them.
    case 'cancel':
      return model.step === 'idle' ? { ...model, step: 'confirming', error: null } : model;
    case 'confirm':
      return model.step === 'confirming' ? { ...model, step: 'cancelling', error: null } : model;
    case 'back':
      return isConfirming(model) ? { ...model, step: 'idle', error: null } : model;
    case 'resume':
      return model.step === 'idle' ? { ...model, step: 'resuming', error: null } : model;
    case 'retry':
      return model.step === 'idle' ? { ...model, loading: true, error: null } : model;
    // The plans page is a route, not a state change.
    default:
      return model;
  }
}

export function planReducer(model: PlanModel, action: PlanAction): PlanModel {
  if (action.type === 'read') {
    const read = action.result;
    return {
      ...model,
      sub: read.ok ? read.subscription : null,
      unreadable: !read.ok,
      loading: false,
      step: 'idle',
      error: null,
    };
  }
  if (action.type === 'tap') return tapped(model, action.id);
  if (action.outcome.ok) {
    // A write that answered with a body is also the freshest read we have.
    return {
      ...model,
      sub: action.outcome.subscription,
      unreadable: false,
      step: 'idle',
      error: null,
    };
  }
  // THE PLAN IS UNCHANGED. `sub` is carried through untouched, so the panel keeps drawing whatever
  // it drew before the tap, and the learner is told plainly why.
  const failed = model.step === 'resuming' ? RESUME_FAILED : CANCEL_FAILED;
  return {
    ...model,
    // A failed cancel stays in the confirmation, so trying again is one tap and the plan behind it
    // is visibly untouched. A failed resume drops back to the panel it came from.
    step: model.step === 'cancelling' ? 'confirming' : 'idle',
    error: action.outcome.message ?? failed,
  };
}
