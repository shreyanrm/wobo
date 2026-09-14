/**
 * THE PRESS KIT, WORD FOR WORD, AS THE PAGE READS IT.
 *
 * `docs/copy/press-kit.md` is the law and this is its only transcription. Not a paraphrase, not a
 * version improved for the web: the whole point of the kit is that an answer engine decides what
 * "Wobo" refers to by what independent sources AGREE on, and today they agree it is a job-search
 * app (docs/GROWTH-ENTITY.md). Three products share the name and the other two have app store
 * listings, reviews and a Product Hunt page. Sameness across every surface is the only lever we
 * have, so a writer who improves one of these strings for one surface has spent the lever.
 *
 * `press.test.ts` reads `docs/copy/press-kit.md` off disk and holds every string below to the
 * blockquote it came from. Edit the law, the test fails, the page follows. Edit the page, the test
 * fails, the law wins. There is no third way to change a word here, and that is deliberate.
 *
 * WHAT IS NOT TYPED HERE, and is read from where it already lives:
 *   · the one line          `shell/head.ts`'s BRAND_DESCRIPTION, which is the meta description of
 *                           every page and the sentence llms.txt opens with
 *   · the company, the      `site/identity.ts`, which is held to `docs/legal/**`
 *     registered office
 *   · the contact           `site/identity.ts`'s MAILBOXES, the one box the legal set publishes
 *   · the listings          `shell/profiles.ts`, the single home for what is claimed
 *   · the founding year     `shell/jsonld.ts`'s FOUNDING_YEAR, which the markup already publishes
 *
 * No React and no app imports below the identity modules: the page, the tests and the asset script
 * all read this file.
 */

import { FOUNDING_YEAR } from '../../shell/jsonld';
import { BRAND_DESCRIPTION } from '../../shell/head';
import { COMPANY, MAILBOXES } from '../site/identity';

/** The one line, everywhere: listings, app stores, social bios, the meta description. */
export const ONE_LINE = BRAND_DESCRIPTION;

/** The hundred words: Crunchbase, Product Hunt, LinkedIn, and the top of this page. */
export const HUNDRED_WORDS =
  'Wobo is an AI tutor for Indian school students, across CBSE, ICSE and the state boards, for ' +
  'every subject their board sets. It teaches the way a good teacher does: it draws. Ask a ' +
  'question and Wobo marks the page in front of you, circles the step that went wrong, builds ' +
  'the diagram stroke by stroke, and explains as it goes. Photograph a page of homework and it ' +
  'reads the page and works on it with you. It is free every day, it never judges, and it does ' +
  'not stop at one explanation: when one way does not land, it tries another. Wobo is made by ' +
  'Dot eVentures Pvt Ltd in Hyderabad.';

/**
 * The three hundred words, as the seven paragraphs the law sets them in. A journalist lifts one
 * paragraph or all seven, so the page prints them as paragraphs rather than as one block, and the
 * copy button hands over the same seven separated by blank lines.
 */
export const THREE_HUNDRED_WORDS: readonly string[] = [
  'Most learning apps hand a child a video and a quiz. A good teacher does something else ' +
    'entirely: they pick up a pen and draw on the page in front of you, and they keep going until ' +
    'you have it.',
  'Wobo is an AI tutor built on that idea. It sees the page the learner is on, and it draws ' +
    'there: a ring around the step where the sign flipped, a number line built as it is ' +
    'explained, a labelled diagram appearing stroke by stroke while it talks. Photograph a page ' +
    'of homework and it reads the page, marks the line that went wrong, and works through it with ' +
    'the learner rather than handing over an answer.',
  'It follows the syllabus the learner’s board actually sets, whatever that board is, across ' +
    'CBSE, ICSE and the state boards, and it adapts: no two learners get the same lesson, and ' +
    'when one explanation does not land it tries another, and another, until the topic is theirs.',
  'Wobo is free every day. Every learner gets the same tutor and the same lessons; a paid plan ' +
    'buys more time with it, never a better version of it.',
  'It is built for children by design: no advertising, no behavioural tracking of learners, no ' +
    'data sold, parental consent for under-13s, and a parent view that shows what their child is ' +
    'learning without showing every keystroke.',
  'Wobo is made by Dot eVentures Pvt Ltd, Hyderabad, India, at heywobo.com.',
];

/**
 * THE FOUNDER'S NAME, IN ONE PLACE.
 *
 * It is the owner's own name and it is spelled identically here, on every listing and in the page's
 * Organization markup, for exactly the reason every other string on this page is: an engine builds
 * confidence out of agreement. A photograph belongs beside it and there is not one yet. The page
 * names the founder without one rather than shipping a grey placeholder of a person, and the
 * photograph drops in the day the owner supplies a file.
 */
export const FOUNDER = { name: 'Shreyan Reddy', role: 'Founder' } as const;

/** The facts box, in the order the law sets it. Printed as a table, lifted as a block. */
export const FACTS: readonly { label: string; value: string }[] = [
  { label: 'What', value: 'An AI tutor that draws its explanations live on the learner’s page' },
  { label: 'For', value: 'School students in India, and their parents' },
  { label: 'Boards', value: 'CBSE, ICSE, and state boards' },
  { label: 'Price', value: 'Free every day; paid plans buy more time, not better teaching' },
  { label: 'Made by', value: `${COMPANY}, Hyderabad, India` },
  { label: 'Site', value: 'heywobo.com' },
  { label: 'Founded', value: FOUNDING_YEAR },
];

/**
 * The address a person writes to, read off the list the legal set publishes rather than typed. A
 * press@ box would be a second address for the same human and one more thing to go unread.
 */
export const PRESS_MAILBOX = MAILBOXES[0]?.address ?? 'support@heywobo.com';

/** One file a journalist downloads. `bytes` is filled by the build, never guessed. */
export interface PressAsset {
  /** The address under `public/`, which is the address it is published at. */
  href: string;
  title: string;
  /** What it is, and what it is for. One sentence, no em dash (voice.md). */
  note: string;
}

/**
 * The logos, written by `scripts/press-assets.ts` from the very wordmark the site's own header
 * wears (`ui/primitives/Wordmark.tsx`). A press kit whose logo is a redraw of the product's logo
 * is two logos, and the second one is the one that ends up in print.
 */
export const LOGOS: readonly PressAsset[] = [
  {
    href: '/press/wobo-wordmark.svg',
    title: 'Wordmark, SVG',
    note: 'The name as it is set on the site. Scales to any size and prints at any size.',
  },
  {
    href: '/press/wobo-wordmark.png',
    title: 'Wordmark, PNG',
    note: '2048px wide on a transparent ground, for anywhere an SVG will not go.',
  },
  {
    href: '/press/wobo-mark.svg',
    title: 'The mark, SVG',
    note: 'Wobo’s own face, for a square avatar or a favicon where the name will not fit.',
  },
];

/** One screenshot, and the page it was taken from. */
export interface Screenshot extends PressAsset {
  /** The address on this site the picture was captured from, so a reader can go and see it live. */
  from: string;
}

/**
 * The three screenshots, captured by the build from the REAL pre-rendered site at 1440. Nothing
 * here is a mock-up drawn for the press kit: a picture that shows something the product does not do
 * is the one thing that costs more trust than it buys attention (docs/GROWTH-PRESS.md §3).
 */
export const SCREENSHOTS: readonly Screenshot[] = [
  {
    href: '/press/wobo-drawn-answer.png',
    title: 'The answer, drawn',
    note: 'One question, answered on the page in front of the learner rather than in a paragraph.',
    from: '/',
  },
  {
    href: '/press/wobo-four-forms.png',
    title: 'The same question, four ways',
    note: 'Drawn, filmed, handed over to drag, or said out loud, whichever the idea needs.',
    from: '/',
  },
  {
    href: '/press/wobo-reteach.png',
    title: 'When one explanation does not land',
    note: 'The second attempt is a different route in, never the same explanation louder.',
    from: '/how-it-works',
  },
];

/**
 * THE ONE GAP, NAMED RATHER THAN LINKED.
 *
 * The kit asks for sixty seconds of a real lesson being drawn. It has to be recorded, not built,
 * and it does not exist yet. A dead link or a "coming soon" button would be worse than this
 * sentence, so the page says it plainly and gives the address to write to.
 */
export const FILM_NOTE =
  'A sixty-second film of a real lesson being drawn is being recorded. Write to us and we will ' +
  'send it the day it is cut, along with anything else you need.';

/** The page's own head, and the heading a reader and a crawler both land on. */
export const PRESS_HEAD = {
  title: 'Press kit · Wobo',
  eyebrow: 'Press',
  heading: 'Everything you need to write about Wobo, in one page.',
  /**
   * The line under the heading. It says what the page IS and what the discipline behind it is,
   * because the first question a journalist has is whether the copy can be trusted to be current.
   */
  sub:
    'The descriptions below are the ones we use everywhere else, word for word, so whatever you ' +
    'lift will match every listing and every store. Take any of it without asking.',
} as const;
