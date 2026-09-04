/**
 * The plans page, in words — design/prototypes/site-plans.html, word for word: the hero, the
 * allowance drawing, the honest table, the checkout preview with its two consent boxes, the gift
 * block, the money questions and the close. The prices themselves are never written here: every
 * number is read from `prices.ts`, so the one answer that quotes a price quotes the tiers.
 *
 * Copy laws (DESIGN.md): sentence case, no emoji, no exclamation marks. A tick is drawn, never
 * typed, so the table reads the same in a screen reader as it does on screen.
 */

import { PLAN_TIERS, type PlanTier, tierById } from './prices';

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
  table: {
    eyebrow: 'The honest table',
    title: 'What changes between plans, and what never does.',
    lead: "Most of Wobo is the same on every plan. The allowance changes. The tutor doesn't.",
    head: ['Every day', 'Free', 'Pro', 'Max'],
    yes: 'yes',
    same: 'same',
    no: '—',
  },
  checkout: {
    eyebrow: 'At checkout',
    title: 'Two boxes, both in plain words.',
    lead: 'We ask for exactly two things before taking money: that the person paying is an adult who agrees to the terms, and that they know what a month costs and how to stop it. Nothing pre-ticked.',
    say: 'Same price for everyone in your country.',
    sayEm: 'Always.',
    learners: { 1: 'one learner', 2: 'two learners' } as Record<number, string>,
    perMonth: '/ month',
    starts: 'Starts',
    startsValue: 'today',
    renews: 'Renews',
    renewsSuffix: 'unless you cancel',
    terms: "I'm 18 or over and I agree to the terms.",
    termsNote: 'The terms, in plain words first, are one tap away.',
    renewal:
      'I understand this renews monthly and I can cancel in Settings, in two taps, any time.',
    /** `{plan}` is the tier's name. */
    renewalNote: 'You keep {plan} until the month you paid for ends.',
    today: 'Today',
    pay: 'Pay with the payment provider',
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
  close: {
    title: 'Free every day, from the day it opens.',
    hand: 'No card now. No card then either.',
    primary: 'Get early access',
    quiet: 'Gift Wobo',
  },
} as const;

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * The money questions. The country answer says how the currency is chosen rather than reciting a
 * price per country: law v5 infers where a reader is from the browser and never offers a switch,
 * so the honest answer is that the page already shows the right money.
 *
 * The parameter stays so a caller can ask the questions of a different set of tiers.
 */
export function faqItems(_tiers: readonly PlanTier[] = PLAN_TIERS): FaqItem[] {
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
      question: 'How do I cancel?',
      answer:
        'Settings → Your plan → Cancel. Two taps, no call, no offer to stay, no reason to give. You keep the plan until the month you paid for ends, nothing renews after that, and everything you learnt stays. Change your mind before that date and one tap puts the plan back.',
    },
    {
      question: 'Do you give money back?',
      answer:
        'No. Cancelling is the answer instead: you keep the plan to the end of the month you paid for and nothing renews. Where the law gives you a refund you still have it, and the cancellation document lists every case.',
    },
    {
      question: 'Do prices change by country?',
      answer:
        "By country, never by person. The page shows your country's price without asking where you are. We never vary a price by behaviour, device or history.",
    },
    {
      question: 'Can two children share one plan?',
      answer:
        "Pro is for one learner, because the Sunday note and the memory are personal. Max includes two learners, each with their own note. Families with three or more: write to us and we'll sort it.",
    },
    {
      question: 'Are there discounts for schools?',
      answer:
        "Schools get a separate plan with a teacher's view and a data-processing agreement. It's on the Schools page, or write to us.",
    },
  ];
}

export const CHECKOUT_PAGE = {
  title: 'Checkout opens with launch.',
  lead: 'The prices are set and printed on the plans page, but the payment page is not open yet, so nothing can be charged. When it opens, this is where the amount, the tax, the renewal date and the two consent boxes will sit, together, above the payment control.',
  /** What a visitor can actually do today. */
  cta: 'Get early access',
  back: 'Back to plans',
  promises: [
    'One price for everyone in a country, on the same purchase route.',
    'The amount, the tax and the renewal date shown together, before the payment control.',
    'Two separate consent boxes, both unticked, and neither pre-ticked for you.',
    'A receipt by email with the same information again.',
  ],
  /** The label every surface links the money document by. Cancelling leads, because it is the answer. */
  cancelling: 'Cancelling, renewals and refunds, in full',
} as const;
