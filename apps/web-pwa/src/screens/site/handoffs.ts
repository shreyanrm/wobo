/**
 * ONE PAGE, ONE JOB, ONE PRIMARY — the close every public page ends on (docs/SELL.md §6).
 *
 * WHAT WAS WRONG. Fourteen public pages ended on the SAME three-action panel, of the same weight,
 * in the same words. That is a template, not a funnel: a reader who has just finished the security
 * page and a reader who has just finished the gift page were handed the identical choice, and
 * neither was handed the next step in their own argument. Two actions of equal weight convert
 * worse than one, and a page whose only way forward is the header has dead-ended.
 *
 * WHAT THIS IS. Every page's close, in one table: the job the page is doing, the headline it closes
 * on, ONE primary action, and ONE quiet second that carries the reader to the next doubt in the
 * ladder rather than back to the top of the site. `ClosePanel` reads a page's entry by name, so a
 * page cannot type its own door and the table cannot drift from what is rendered.
 *
 * Read the `quiet` column downwards and it is the argument in order: the front page hands a parent
 * to the parent page, the parent page hands them to the price, the price hands them to a gift or
 * back to the free product, the security page hands them to the evidence, and every page whose
 * reader is already convinced hands them to the product.
 *
 * WHERE THE PRIMARY IS NOT "START FREE" — four pages, each for a stated reason:
 *  · HOME sells the demonstration, not the sign-up. The strongest thing this site owns is letting
 *    a stranger watch Wobo answer THEIR question with no account, and asking for a sign-up before
 *    the product has worked once is the order in reverse (SELL.md §4).
 *  · PLANS sells a plan, GIFT sells a gift, DONATE funds a place. Those are the transactions those
 *    pages exist for, and each still carries "Start free" as its quiet second or in its body.
 * Every other surface says `CTA.label`, from `cta.ts`, and never types the words itself.
 */

import type { Route } from '../../shell/router';
import { CTA, START_FREE } from './cta';

/** A control on a public page: a label, and either a route or a path/in-page anchor. */
export interface CtaAction {
  label: string;
  /** A route object. Exactly one of `to` and `href` is given. */
  to?: Route;
  /** A path (`/plans`) or an in-page anchor (`#collect`). */
  href?: string;
}

/**
 * A page's close. `job` is not decoration: it is the single thing the page is trying to achieve,
 * and it is the test a reviewer applies to the two actions underneath it.
 */
export interface Handoff {
  /** The page's one conversion goal, in the words of docs/SELL.md §6. */
  job: string;
  /** The headline this page closes on. Its own, never a shared one. */
  title: string;
  /** The line in Wobo's hand under it, or null where the page closes plainly. */
  hand: string | null;
  /** The one primary action. */
  primary: CtaAction;
  /** The quiet second: the NEXT step in the argument, never a second front door. */
  quiet: CtaAction;
}

/** Every public page that closes. The key is what a page passes to `<ClosePanel page="…" />`. */
export type PublicPage =
  | 'home'
  | 'meet'
  | 'how'
  | 'parents'
  | 'students'
  | 'subjects'
  | 'security'
  | 'plans'
  | 'checkout'
  | 'gift'
  | 'donate'
  | 'about'
  | 'help'
  | 'contact'
  | 'legal'
  | 'sitemap'
  | 'notfound';

export const HANDOFFS: Readonly<Record<PublicPage, Handoff>> = {
  /**
   * The front page's close, at the bottom of the whole argument. SELL.md §6 wants "ask a question
   * now" as the home primary, and that belongs in the HERO, where the ask box is going (SELL.md §4)
   * — not here: the ask section already sits above this panel, so a primary pointing back up at it
   * would be a loop rather than a handoff. From the bottom of the page the forward move is the
   * product, and the reader who is not the learner is handed to the page written for them.
   */
  home: {
    job: 'make them try it',
    // "tonight" is banned by the copy law: children go to bed, and a close that asks for a late
    // night is the one thing a parent reading this page is trying to avoid. So is "this evening",
    // which is the same close with a softer word on it — the parents entry below carried exactly
    // that for a while, twenty-eight lines under this note.
    title: 'Ask Wobo something you are stuck on.',
    hand: 'Free to use every day, not just the first.',
    primary: START_FREE,
    quiet: { label: "I'm a parent", href: '/for-parents' },
  },
  meet: {
    job: 'make the tutor real',
    title: 'You have met Wobo. Now let it teach you something.',
    hand: 'Free every day, and no card to start.',
    primary: START_FREE,
    quiet: { label: 'See how it works', href: '/how-it-works' },
  },
  /**
   * SELL.md asks for "try it on your own question" here, and now that we are open that IS starting.
   * The page's own try-it step sits directly above this close, so pointing back up at it would be a
   * loop rather than a handoff; the next doubt after "will this work" is "what does it cost".
   */
  how: {
    job: 'answer why this will work when nothing else did',
    title: 'That is the loop. Run it on your own question.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'See plans', href: '/plans' },
  },
  parents: {
    job: 'close the payer',
    title: 'Set it up once. It stays set up.',
    hand: 'Ten minutes, and your child has a tutor whenever they want one.',
    primary: START_FREE,
    quiet: { label: 'See plans', href: '/plans' },
  },
  students: {
    job: 'close the user',
    title: 'Ask the one you have been carrying around.',
    hand: 'It draws it again as many times as you ask, and no one else is in the room.',
    primary: START_FREE,
    quiet: { label: 'See subjects', href: '/subjects' },
  },
  /**
   * "Find your board and start" is exactly `START_FREE`: the board is asked once, inside the
   * product, which is the only place the copy law lets that question be asked at all.
   */
  subjects: {
    job: 'remove the "does it cover mine" objection',
    title: 'Your board, your book, your words.',
    hand: 'Tell Wobo your board once and it stays yours.',
    primary: START_FREE,
    quiet: { label: 'Ask about your subject', href: '#ask' },
  },
  /**
   * The quiet second used to be `#collect`, an anchor back up the page the reader has just
   * finished, so the only forward move off the trust page was the primary. docs/SELL.md §6 gives
   * this page "read what we hold" as its second, and what we hold in full is the legal set — which
   * is a step ONWARD, and the evidence the page has been citing all the way down.
   */
  security: {
    job: 'remove the fear',
    title: 'Now you know exactly what we hold.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Read the documents in full', href: '/legal' },
  },
  plans: {
    job: 'close the sale',
    title: 'Free every day, from the first day.',
    hand: 'No card now. No card later.',
    primary: { label: 'Choose a plan', href: '#plans' },
    quiet: { label: `${CTA.label} instead`, to: CTA.to },
  },
  checkout: {
    job: 'keep a reader who came to pay',
    title: 'The tutor is already open, and free.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Back to plans', href: '/plans' },
  },
  /**
   * The gift primary goes to the checkout page, which says plainly that paying is not open yet.
   * That is a control keeping its shape rather than a greyed button (SELL.md §8): the buyer reads
   * the price, the terms and the date, and the one thing not built says so in its own words.
   */
  gift: {
    job: 'a second buyer',
    title: 'Give a term of Wobo.',
    hand: null,
    primary: { label: 'Choose a gift', href: '/plans/checkout' },
    quiet: { label: 'How gifting works', href: '#how-it-works' },
  },
  donate: {
    job: 'a third buyer',
    title: 'Fund a place for a learner who cannot pay.',
    hand: null,
    primary: { label: 'Fund a place', href: '#fund' },
    quiet: { label: 'Ask for a place', href: '#ask' },
  },
  about: {
    job: 'build belief',
    title: 'That is us. Now meet the tutor.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Read the security page', href: '/security' },
  },
  help: {
    job: 'get a stuck reader unstuck, then back into the product',
    title: 'Wobo answers this sort of question inside the app too.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Write to us', href: '/contact' },
  },
  contact: {
    job: 'answer the person, and let them start while they wait',
    title: 'Wobo is open while you wait for a reply.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Help centre', href: '/help' },
  },
  legal: {
    job: 'turn a reader of the promises into a user of the product',
    title: 'The documents are the promise. Wobo is the thing.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Security and trust', href: '/security' },
  },
  sitemap: {
    job: 'send an orienting reader to the page that decides it',
    title: 'That is the whole site. This is the product.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Meet Wobo', href: '/meet-wobo' },
  },
  /**
   * The 404 is a public page, and it is where a lost visitor lands. It gets one job like every
   * other page — put them somewhere useful — and its quiet second is the front page rather than a
   * second dead end. Neither action is the header.
   */
  notfound: {
    job: 'put a lost visitor somewhere useful',
    title: 'That page is not here. Wobo is.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'Back to the front page', href: '/' },
  },
};

/** The close a page shows. A lookup, so a page names itself rather than inventing its own words. */
export function handoff(page: PublicPage): Handoff {
  return HANDOFFS[page];
}
