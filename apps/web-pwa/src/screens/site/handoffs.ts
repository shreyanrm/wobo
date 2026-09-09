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
import { CTA, doorFor, START_FREE } from './cta';
import { LIST } from './invitation';

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
  | 'syllabus'
  | 'glossary'
  | 'exams'
  | 'compare'
  | 'security'
  | 'plans'
  | 'checkout'
  | 'gift'
  | 'donate'
  | 'about'
  | 'blog'
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
   * The syllabus pages — a board, a class, a subject, a chapter, a topic. A reader here arrived
   * from a search on their own chapter, has just read what it covers and where we got it, and has
   * an ask box on the page they can use with no account. The forward step is therefore the product
   * itself; the quiet second is the page that answers the objection they have not raised yet ("is
   * MY board in here"), which is the one page that lists all four.
   */
  syllabus: {
    job: 'turn a reader who found their own chapter into someone who asks Wobo about it',
    title: 'That is the chapter. Wobo can teach it.',
    hand: 'Your board, your book, your words.',
    primary: START_FREE,
    quiet: { label: 'See every board we hold', href: '/subjects' },
  },
  /**
   * The glossary. A reader here came for one idea, has just seen it on four boards with the
   * document behind each, and the honest thing this page does NOT have is the explanation. So the
   * forward step is the product, where the explanation is; the quiet second is their own chapter,
   * which is the same idea in the words their exam will use.
   */
  glossary: {
    job: 'turn a reader who came for one idea into someone who watches Wobo explain it',
    title: 'That is where it sits. Wobo can explain it.',
    hand: 'Drawn, spoken, or as a thing to drag.',
    primary: START_FREE,
    quiet: { label: 'Find it on your board', href: '/exams' },
  },
  /**
   * The exam-cycle pages. A reader here is checking whether we really hold their board, and has
   * just read the documents and the dates. The next doubt is whether their SUBJECT is in there,
   * which is the page that lists every board we hold and opens the finder.
   */
  exams: {
    job: "prove the syllabus is the board's own, then open it",
    title: 'That is the syllabus. Open it with Wobo beside you.',
    hand: 'Your board, from the board.',
    primary: START_FREE,
    quiet: { label: 'See every subject', href: '/subjects' },
  },
  /**
   * The side-by-side pages. A reader here is deciding where money goes, so the honest second is
   * the price, in full, on our own page. Nothing in this close refers to the other product: a
   * page that reports on somebody else must not close by selling against them.
   */
  compare: {
    job: 'let somebody deciding read four sourced facts and go and check them',
    title: 'Read both, then decide.',
    hand: null,
    primary: START_FREE,
    quiet: { label: 'See what it costs', href: '/plans' },
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
  /**
   * The blog's reader arrived from a search, on a page about how a syllabus is read or what a
   * machine cannot do. They have not been sold anything and should not be: the forward move is
   * the product itself, and the quiet second is the evidence behind whatever they just read, which
   * is the syllabus the pages are built on.
   */
  blog: {
    job: 'turn a reader who arrived from a search into someone who tries it',
    title: 'That is how it works. Try it on something you are stuck on.',
    hand: 'Free every day, and no card to start.',
    primary: START_FREE,
    quiet: { label: 'See the subjects', href: '/subjects' },
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
/**
 * THE CLOSE ON A SYLLABUS PAGE KNOWS WHICH PAGE IT IS ON.
 *
 * One line, "That is the chapter. Wobo can teach it.", used to end all 409 of them, and 76 were
 * not chapters: four boards, thirteen classes, fifty subjects and nine subject hubs all closed by
 * calling themselves a chapter. On a page whose own lead two paragraphs earlier says "is a unit of
 * the ICSE class 9 history and civics syllabus", it is the exact tell of a template with a name
 * swapped, at the point of the page where a reader is deciding.
 *
 * The table stays in this file and the page passes only its layer, so the words are still owned
 * here and a page still cannot type its own door.
 */
export const SYLLABUS_CLOSE: Readonly<Record<string, string>> = {
  board: 'That is the board. Wobo can teach it.',
  class: 'That is the year. Wobo can teach it.',
  subject: 'That is the subject. Wobo can teach it.',
  chapter: 'That is the chapter. Wobo can teach it.',
  topic: 'That is the topic. Wobo can teach it.',
  hub: 'That is where it is taught. Wobo can teach it.',
};

/** The close headline for one layer of the syllabus family, or the family's own where unknown. */
export function syllabusClose(layer: string): string {
  return SYLLABUS_CLOSE[layer] ?? HANDOFFS.syllabus.title;
}

/**
 * A page's close, for the dial as it stands.
 *
 * The table above is the OPEN site and is never edited to close it (`docs/DOORS-CLOSED.md` §4:
 * a dial, not a deploy). While the dial is off, `doorFor` swaps the one action that is a door and
 * leaves the quiet second alone, so each page still hands the reader the next step in its own
 * argument rather than collapsing every close onto the same one.
 */
export function handoff(page: PublicPage, open: boolean): Handoff {
  const close = HANDOFFS[page];
  if (open) return close;
  const primary = doorFor(close.primary, open);
  // The handwritten line under a door says what the door does. Where the door has become the
  // invitation, "free every day, and no card to start" is a sentence about a product the reader
  // cannot have yet, so the one true sentence about when takes its place (DOORS-CLOSED §5).
  // A page whose primary is a TRANSACTION keeps its own line: the price has not changed.
  const swapped = primary !== close.primary;
  return {
    ...close,
    hand: swapped ? LIST.under : close.hand,
    primary,
    quiet: doorFor(close.quiet, open),
  };
}
