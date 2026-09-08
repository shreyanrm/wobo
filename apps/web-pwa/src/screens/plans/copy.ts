/**
 * The plans page, in words — design/prototypes/site-plans.html, word for word: the hero, the
 * allowance drawing, the honest table, the checkout preview with its two consent boxes, the gift
 * block, the money questions and the close. The prices themselves are never written here: every
 * number is read from `prices.ts`, so the one answer that quotes a price quotes the tiers.
 *
 * Copy laws (DESIGN.md): sentence case, no emoji, no exclamation marks. A tick is drawn, never
 * typed, so the table reads the same in a screen reader as it does on screen.
 */

import { CTA } from '../site/cta';
import { DEFAULT_PERIOD, type Period, PLAN_TIERS, type PlanTier, tierById } from './prices';

/** A cell: included, not included, the same on every plan, or a figure in words. */
export type Benefit = boolean | 'same' | string;

export interface BenefitRow {
  label: string;
  free: Benefit;
  pro: Benefit;
  max: Benefit;
}

const tier = (id: PlanTier['id']): PlanTier => tierById(id) ?? (PLAN_TIERS[0] as PlanTier);

/**
 * The honest table: what changes between plans, and what never does. The figures come from the
 * tiers; the rows that never change say so.
 *
 * The allowance row says what a day FEELS like rather than how many questions it holds — law v5's
 * copy law (DESIGN.md §0) bans the raw number, and free carries no multiplier at all — so the two
 * paid cells are read off `allowanceMultiple` and the free one is the sentence the page opens on.
 */
export const ALLOWANCE_WORDS: Record<number, string> = { 5: 'five times', 20: 'twenty times' };

export const BENEFITS: readonly BenefitRow[] = [
  {
    label: 'Daily allowance',
    free: 'enough for an evening',
    pro: ALLOWANCE_WORDS[tier('pro').allowanceMultiple] ?? 'more',
    max: ALLOWANCE_WORDS[tier('max').allowanceMultiple] ?? 'more',
  },
  {
    label: 'Learners on the plan',
    free: String(tier('free').learners),
    pro: String(tier('pro').learners),
    max: String(tier('max').learners),
  },
  { label: 'Voice replies', free: false, pro: true, max: true },
  { label: 'Past-paper sets', free: false, pro: false, max: true },
  { label: 'Every subject your board sets', free: 'same', pro: 'same', max: 'same' },
  { label: 'The drawn board, practice, the week', free: 'same', pro: 'same', max: 'same' },
  { label: 'The Sunday note and a linked parent', free: 'same', pro: 'same', max: 'same' },
  { label: 'No ads, no selling, no opinions', free: 'same', pro: 'same', max: 'same' },
];

export const PLANS_PAGE = {
  eyebrow: 'Plans',
  title: 'Free every day.',
  titleEm: 'More when exams get close.',
  lead: 'Every learner gets a daily allowance of questions, forever, with no card and no trial that ends. Pro and Max raise it for the weeks that need it. Cancelling takes as many taps as subscribing.',
  allowance: {
    sticker: 'free, every day',
    title: "Today's allowance",
    hand: 'enough for a normal evening, and the next one, and the one after',
  },
  /**
   * The sentence that closes the cards. Its second half reads from the period the reader chose, so
   * the page can never show a yearly price beside a monthly promise.
   */
  same: 'Same price for everyone in your country, never varied by behaviour or device.',
  keepIt: {
    yearly:
      'Cancelling takes as many taps as subscribing, and you keep the plan until the year you paid for ends.',
    monthly:
      'Cancelling takes as many taps as subscribing, and you keep the plan until the month you paid for ends.',
  } as Readonly<Record<Period, string>>,
  /** The control above the cards, in words. Yearly is first, and yearly is what the page opens on. */
  period: {
    legend: 'How you would like to pay',
  },
  table: {
    eyebrow: 'The honest table',
    title: 'What changes between plans, and what never does.',
    lead: "Most of Wobo is the same on every plan. The allowance changes. The tutor doesn't.",
    head: ['Every day', 'Free', 'Pro', 'Max'],
    yes: 'yes',
    same: 'same',
    /** A word, not an em dash (voice.md 10a): the law binds every cell a learner reads. */
    no: 'no',
  },
  /**
   * A PREVIEW OF THE CHECKOUT SCREEN while payments are off, and the CHECKOUT ITSELF the moment
   * they are on. What it may say changes with that, and only with that.
   *
   * docs/PRICING.md (owner, 2026-09-04): the plans page shows the per-month amount and the words
   * and NEVER the annual total — "The annual total ... must not appear on the plans page" — while
   * the checkout shows "the exact amount and the date of the charge". So the total and the renewal
   * are drawn behind the payments-on guard, where this card IS the checkout, and nowhere else.
   *
   * THE SECOND BOX SAYS IT RENEWS, because it does. It used to say the opposite, on the authority
   * of `services/gateway/src/wobo_gateway/billing.py` rule 2 — "NOTHING IN THIS REPO RENEWS A
   * SUBSCRIPTION ... There is no payment provider, no webhook and no scheduled sweep." That file
   * was deleted with commit 692affc and replaced by `services/gateway/src/wobo_gateway/billing/`,
   * which has all three: `billing/plans.py` creates every subscription with a `total_count` of 5
   * years or 60 months, so the provider takes the money again on its own. The copy law forbids
   * describing a mechanism we cannot show; it forbids just as flatly denying one we do. A payer is
   * told, in the box they tick, that it renews, and told the amount and the day beside it.
   */
  checkout: {
    eyebrow: 'At checkout',
    title: 'Two boxes, both in plain words.',
    lead: {
      yearly:
        'We ask for exactly two things before taking money: that the person paying is an adult who agrees to the terms, and that they know what a year costs, that it comes round again, and how to stop it. Nothing pre-ticked.',
      monthly:
        'We ask for exactly two things before taking money: that the person paying is an adult who agrees to the terms, and that they know what a month costs, that it comes round again, and how to stop it. Nothing pre-ticked.',
    } as Readonly<Record<Period, string>>,
    say: 'Same price for everyone in your country.',
    sayEm: 'Always.',
    /** docs/PRICING.md: "a subscription covers exactly one learner on every plan and every period". */
    learners: { 1: 'one learner' } as Record<number, string>,
    perMonth: '/ month',
    /** The words for the period, which is the whole of what this page may say about the money. */
    billed: 'Billed',
    starts: 'Starts',
    startsValue: 'today',
    terms: "I'm 18 or over and I agree to the terms.",
    termsNote: 'The terms, in plain words first, are one tap away.',
    /**
     * The second box: the recurring charge, acknowledged on its own. This is the box the
     * automatic-renewal rules are about, and `docs/legal/refund-and-cancellation.md` §2 promises
     * exactly it — "a separate, unticked box acknowledging the recurring charge, naming the
     * amount, the frequency and the cancellation route". The amount sits in the row above it,
     * which is drawn on the same guard.
     */
    renewal: {
      yearly:
        'I understand this renews every year at the same price until I cancel, and I can cancel in Settings, in two taps.',
      monthly:
        'I understand this renews every month at the same price until I cancel, and I can cancel in Settings, in two taps.',
    } as Readonly<Record<Period, string>>,
    /** `{plan}` is the tier's name. */
    renewalNote: {
      yearly:
        'You keep {plan} until the year you paid for ends, and it is taken again for the next year unless you cancel before then.',
      monthly:
        'You keep {plan} until the month you paid for ends, and it is taken again for the next month unless you cancel before then.',
    } as Readonly<Record<Period, string>>,
    /**
     * THE RENEWAL, IN FIGURES. Beside the amount taken today, and on the same payments-on guard,
     * because it is the annual total again and docs/PRICING.md keeps that off the plans page.
     */
    renews: 'Renews',
    /**
     * THE AMOUNT BEING AGREED TO. docs/PRICING.md gives the total to the checkout and keeps it off
     * the plans page, and this card is both: a preview while the deploy cannot take money, and
     * the checkout itself the moment it can. So the row below is drawn ONLY when payments are on
     * (`checkout-flow.ts` asks the gateway), and on the monthly period it names the month, never
     * a year. `tests/plans-period.spec.ts` holds the off state to "no total anywhere".
     */
    today: 'Today',
    totalFor: {
      yearly: 'for the year',
      monthly: 'for the month',
    } as Readonly<Record<Period, string>>,
    /**
     * THE DOOR. Payments on, it carries the tier's own words ("Choose Pro") and starts the
     * checkout; off, it reads "Payments are not switched on yet" and does nothing, in
     * `checkout-flow.ts`'s words. The label is the tier's `cta`, so the card and the checkout
     * cannot name the plan differently. What the door says while it works:
     */
    opening: 'Opening the payment page',
    confirming: 'Confirming with the bank',
    payMore: 'What checkout will ask for',
    fine: "Card or UPI, on the provider's own page. We never see or store the details.",
  },
  gift: {
    eyebrow: 'Gift Wobo',
    title: "The smartest gift for a child who's about to have a hard term.",
    lead: 'Three, six or twelve months of Pro, sent to a parent with a note in your words. No account needed to buy. It arrives the day you choose.',
    cta: 'Choose a gift',
    how: 'How gifting works',
  },
  faq: {
    eyebrow: 'Questions',
    title: 'The money questions, answered straight.',
  },
  /**
   * The plans close, as four plain strings. `Plans.tsx` RENDERS it from `site/handoffs.ts` — one
   * page, one job, one primary — and these mirror that entry so `period.test.ts` can hold the close
   * to the period rule alongside the rest of the page's copy. `handoffs.test.ts` fails if the two
   * ever say different things.
   */
  close: {
    title: 'Free every day, from the first day.',
    hand: 'No card now. No card later.',
    primary: 'Choose a plan',
    quiet: `${CTA.label} instead`,
  },
} as const;

/** "₹19,992 on 7 September 2027" — the amount that comes round, and the day it comes round on. */
export function renewalValue(amount: string, day: string): string {
  return `${amount} on ${day}`;
}

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * The money questions. The country answer says how the currency is chosen rather than reciting a
 * price per country: law v5 infers where a reader is from the browser and never offers a switch,
 * so the honest answer is that the page already shows the right money.
 *
 * The two answers about cancelling READ FROM THE PERIOD the reader chose, for the same reason the
 * cards do: a page showing a yearly price beside "you keep it until the month you paid for ends"
 * would be telling somebody the wrong thing about their own money. What a canceller actually keeps
 * is the period already paid for (screens/you/billing.ts stores its end date and nothing else), so
 * these words and that record say the same thing.
 */
export function faqItems(period: Period = DEFAULT_PERIOD): FaqItem[] {
  const kept = period === 'yearly' ? 'year' : 'month';
  return [
    {
      question: 'What happens when the free allowance runs out for the day?',
      answer:
        "Wobo tells you kindly, shows the time it resets (6 am), and offers to save your question for the morning. Nothing you've done is lost, and nothing nags you to upgrade mid-lesson.",
    },
    {
      question: 'Is the Sunday note only on paid plans?',
      answer:
        'No. The note, the parent link, the practice, the drawn board and every subject are on Free. Paid plans change the allowance, voice, and a few extras. They never change the tutor.',
    },
    {
      // The question a payer actually has, and the one no surface answered while every one of them
      // denied the renewal outright. `billing/plans.py` creates the subscription with a
      // `total_count`, so the provider takes it again on its own until it is cancelled.
      question: 'Does it renew by itself?',
      answer: `Yes. It renews at the end of every ${kept} at the same price, and the checkout shows the amount and the day it will be taken before you pay. Cancelling stops the next one, and you keep the plan until the ${kept} you have paid for ends.`,
    },
    {
      question: 'How do I cancel?',
      // Once cancelled, a subscription cannot be restarted at the provider, and the gateway says
      // so (billing/__init__.py, 409 cannot_resume). So no "one tap puts it back" here: the one
      // place a reader decides something irreversible is the one place the page may not soften it.
      answer: `You → Your plan → Cancel. Two taps, no call, no offer to stay, no reason to give. You keep the plan until the ${kept} you paid for ends, nothing renews after that, and everything you learnt stays. Once it is cancelled it cannot be switched back on, so you start a fresh plan after that date if you want one.`,
    },
    {
      question: 'Do you give money back?',
      answer: `No. Cancelling is the answer instead: you keep the plan to the end of the ${kept} you paid for and nothing renews. Where the law gives you a refund you still have it, and the cancellation document lists every case.`,
    },
    {
      question: 'Do prices change by country?',
      answer:
        "By country, never by person. The page shows your country's price without asking where you are. We never vary a price by behaviour, device or history.",
    },
    {
      question: 'Can two children share one plan?',
      answer:
        "No. A plan covers one learner, on every plan and every period, because the Sunday note and the memory are personal to the child they are about. A second child needs a second plan. Families with two or more: write to us and we'll sort it.",
    },
    {
      // There is no /schools route and there is no school product: CONTEXT.md:38 — "Learners only —
      // no teachers, no schools inside it." The answer used to describe a teacher's view and a
      // data-processing agreement and send the reader to a page that answers with the 404 screen.
      question: 'Are there discounts for schools?',
      answer:
        'Not yet. Wobo is built around one learner and the parent who reads their Sunday note, so there is no classroom plan to sell and no teacher view to show you. If you teach, write to us and we will tell you honestly where it stands.',
    },
  ];
}

export const CHECKOUT_PAGE = {
  /*
    It said "Checkout opens with launch." until 2026-09-04. We are open — anyone can sign up and
    use Wobo today (DESIGN.md §0) — so a page that dates itself to a launch is dating itself to
    something that has already happened, and a reader is left to work out which of the two is
    true. What is actually not built is PAYING, so that is what the page says.
  */
  title: 'Paying is not open yet.',
  lead: 'The prices are set and printed on the plans page, but the payment page is not open yet, so nothing can be charged. When it opens, this is where the amount, the day it is taken, the day it comes round again and the two consent boxes will sit, together, above the payment control.',
  /** What a visitor can actually do today, in the site's one phrase. */
  cta: CTA.label,
  back: 'Back to plans',
  /*
    WHAT THE CHECKOUT ACTUALLY DOES, and nothing else. This list used to promise a tax line and a
    receipt by email, and the checkout has neither: the card at the bottom of the plans page draws
    the plan, the price, the period, what is taken today and what comes round again, and nothing on
    the gateway sends a mail when the webhook lands (`checkout-flow.ts` says so in its own comment).
    A page that lists what a reader will be shown is a promise, and a promise nothing keeps is the
    same lie as a claim. Tax is stated where the law makes us state it separately, which is a thing
    the money document says (`docs/legal/refund-and-cancellation.md` §7) and this list must not
    promise on a screen that does not show one.
  */
  promises: [
    'One price for everyone in a country, on the same purchase route.',
    'The amount and the day it is taken, shown together, before the payment control.',
    'On a yearly plan, the whole sum for the year, before it is taken.',
    'The day it comes round again, and what will be taken then.',
    'Two separate consent boxes, both unticked, and neither pre-ticked for you.',
  ],
  /** The label every surface links the money document by. Cancelling leads, because it is the answer. */
  cancelling: 'Cancelling, renewals and refunds, in full',
  /**
   * THE SAME PAGE WHEN PAYMENTS ARE ON. The checkout is the card at the bottom of the plans page
   * (`Plans.tsx`, `checkout-flow.ts`), so a reader who reaches `/plans/checkout` from the gift or
   * the donate page must be sent there, not told that paying is not open. `checkoutPageWords`
   * picks between the two; a deploy that cannot say which is treated as off.
   */
  open: {
    title: 'The checkout is on the plans page.',
    lead: 'Pick a plan on the plans page and the amount, the two consent boxes and the payment control sit together on one card. Nothing is charged until you choose.',
    cta: 'Go to the checkout',
  },
} as const;

export interface CheckoutPageWords {
  title: string;
  lead: string;
  cta: { label: string; href?: string; to?: { name: 'onboarding' } };
}

/** What `/plans/checkout` says, given whether the gateway can take money. Unknown reads as off. */
export function checkoutPageWords(paymentsOn: boolean | null): CheckoutPageWords {
  if (paymentsOn === true) {
    return {
      title: CHECKOUT_PAGE.open.title,
      lead: CHECKOUT_PAGE.open.lead,
      cta: { label: CHECKOUT_PAGE.open.cta, href: '/plans#checkout' },
    };
  }
  return {
    title: CHECKOUT_PAGE.title,
    lead: CHECKOUT_PAGE.lead,
    cta: { label: CHECKOUT_PAGE.cta, to: { name: 'onboarding' } },
  };
}
