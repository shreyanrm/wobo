/**
 * Every word on the landing page, in one file.
 *
 * This is a PORT, not a draft. The copy below is `design/prototypes/landing-v8.html` character for
 * character — the page Fable handcrafted for law v5 and the owner approved — and it is the reason
 * this module exists: words that live in one place can be read end to end, checked against the law
 * that governs them (DESIGN.md §0), and proved by a test rather than by scrolling a page.
 *
 * The copy law, which every line here is held to and `page-copy.test.ts` enforces:
 *
 *  · NO NAMES. Never an invented learner or parent. "Your child", "the learner", or the reader.
 *  · NO GRADE GATE. Never "classes 4 to 12", never an age range. "Every subject your board sets."
 *  · NO RAW ALLOWANCES. Never "40 questions a day" — say what an evening feels like.
 *  · WE ARE OPEN, AND THE CALL IS "START FREE". The phrase is never typed here: it comes from
 *    `site/cta.ts`, so this page and the plans page can never again disagree about whether a
 *    stranger can get in today.
 *  · DRAWING IS ONE PART. The board is never the whole product: it also films, simulates, speaks,
 *    practises, remembers and reports. The teaching chapter names all six things a great teacher
 *    does and the drawn board is one of them.
 *  · NOTHING IS SOLD BY RUNNING ANYTHING DOWN (owner, 2026-09-04). Not a teacher, not a school,
 *    not a tuition centre, not another product. We say what Wobo can do and let the reader judge.
 *  · Wobo has no gender (§19), and no vendor or model is ever named as being underneath (§17).
 *
 * A headline is stored as `{ lead, mark }` because the marigold highlighter is painted on the
 * second half as it scrolls into view; the two run together as one sentence.
 */

import type { Route } from '../../shell/router';
import { ctaFor } from '../site/cta';
import { HANDOFFS, handoff } from '../site/handoffs';
import { LIST } from '../site/invitation';
import { FOOTER_COLUMNS } from '../site/nav';

export interface NavLink {
  label: string;
  /** A real route, always. Nothing in this nav is a dead anchor. */
  href: string;
}

/** The five doors in the header, each one a page that exists. */
/**
 * The nav, in the order the DOUBTS ARRIVE (docs/SELL.md §3), which is the same order the site
 * shell's pill nav now uses: "will it work for MY board" is the single biggest qualifier and it
 * arrives before "is this real teaching", so Subjects leads.
 */
export const NAV_LINKS: readonly NavLink[] = [
  { label: 'Subjects', href: '/subjects' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'For parents', href: '/for-parents' },
  { label: 'For students', href: '/for-students' },
  { label: 'Plans', href: '/plans' },
] as const;

/**
 * The two doors. The loud one is THE call to action and it is read from `site/cta.ts`, never typed
 * here: this page and the plans page once said different things about whether we were open.
 */
export function authDoors(open: boolean): { signIn: string; start: string } {
  return { signIn: 'Sign in', start: ctaFor(open).label };
}

/** The doors as they read with the dial ON, which is what `page-copy.test.ts` holds them to. */
export const AUTH = authDoors(true);

// --- The hero -----------------------------------------------------------------------------------

/** One of the four forms the hero's card answers its question in. */
export interface HeroForm {
  key: 'draw' | 'video' | 'try' | 'say';
  /** The rail's label. */
  label: string;
  /** What the live tag says while this form is up. */
  live: string;
}

export const HERO_FORMS: readonly HeroForm[] = [
  { key: 'draw', label: 'Drawn', live: 'drawing' },
  { key: 'video', label: 'Filmed', live: 'playing' },
  { key: 'try', label: 'Tried', live: 'your turn' },
  { key: 'say', label: 'Spoken', live: 'speaking' },
] as const;

/** How long each form holds before the rail moves on, in ms. Stopped the moment a reader taps. */
export const HERO_CYCLE_MS = 3800;

export const HERO = {
  // The accent's spaces are NON-BREAKING: at 390 it wrapped as "FREE EVERY / DAY", orphaning one word
  // of the promise the page is built on under the pigment run (wave 29, site-9).
  eyebrow: { lead: 'Every subject · every board · ', accent: 'free\u00a0every\u00a0day' },
  /**
   * THE HEADLINE IS THE OWNER'S, AND IT IS A DECISION RATHER THAN A DRAFT (2026-09-05).
   *
   * His words: "I want to use the line fall in love with learning while studying cause they
   * actually will; I dont care about 4 others saying the same thing or 3/10 people scrolling past;
   * who believe will believe."
   *
   * I argued against it and he overruled me, so here is the case FOR it, written down, because the
   * next person to read this file should not re-litigate a settled call:
   *   - The studying / learning distinction is real and almost nobody in this market names it.
   *     Studying is the obligation; learning is what happens when it finally lands. Saying you can
   *     have the second while doing the first is a promise this product actually keeps, because
   *     mastery gating and the re-teach ladder are the machinery that turns one into the other.
   *   - A conversion line is not obliged to be unusual. It is obliged to be TRUE and to be the
   *     thing the reader wants. Both hold here.
   *
   * What the three lines do between them, so none of them has to do everything:
   *   eyebrow  the qualifiers  — every subject, every board, free every day
   *   title    the promise     — why a reader would want it
   *   lede     the substance   — what it actually does, in four forms
   *
   * The category claim ("the world's first AI companion that shows you") is deliberately NOT here.
   * The owner put it mid-page on TEACHES, where the six things that substantiate it sit on the
   * same screen.
   *
   * The staged question stays OFF the headline whatever the headline says. It read
   * `Hey Wobo,` / `why do plants need sunlight?` as the largest element on the page, with a box
   * under it that answers questions about WOBO and refuses that one, and on a phone the drawn
   * answer sat 229px below the fold. The question now lives on the device card where its four
   * answers are, so the question and the answer are one object. That is a correction, not a
   * preference, and it is the one thing here that is not the owner's to trade away.
   */
  title: { lead: 'Fall in love with learning ', mark: 'while studying.' },
  /** The question the card answers, printed on the card. */
  staged: { wake: 'Hey Wobo,', question: 'why do plants need sunlight?' },
  lede: 'Ask it anything your syllabus sets and the answer arrives in front of you, line by line: drawn on a board, filmed, handed back for you to try, or said out loud when that is what the idea needs.',
  /**
   * The line over the try box, and it is careful on purpose. What a stranger can genuinely do
   * here with no account is ask Wobo about WOBO and be answered in Wobo's own voice (`ask.ts`),
   * so that is what it offers. A box that invited a syllabus question would be promising a
   * tutor this page has no gateway to reach, which is the one thing the copy law forbids.
   */
  tryNote: 'Ask Wobo about Wobo. It answers for itself, right here.',
  under: ['Free to use, every single day', 'No card, and no trial that runs out'],
  device: { who: 'Wobo', live: 'live' },
  /** The words inside the drawn answers — Wobo's own hand, so they belong with the copy. */
  drawn: {
    lightIn: 'light in',
    sugarOut: 'sugar out',
    caption: 'light + water + air → food the plant can use',
  },
  filmed: { caption: 'watch it happen, 40 seconds' },
  tried: {
    question: 'which one makes the food?',
    right: 'the leaf',
    wrong: 'the root',
    verdict: "that's it",
    caption: 'Wobo never says wrong. It rings the gap and waits.',
  },
  spoken: { line: '“The leaf is the kitchen. Sunlight is the stove.”' },
} as const;

// --- The four answer forms ------------------------------------------------------------------------

export const FORMS = {
  eyebrow: 'More than a whiteboard',
  title: { lead: 'Some ideas are drawn. Some are ', mark: 'filmed, built or spoken.' },
  lede: 'Wobo picks the form the idea needs, then keeps going until you have it. The same question, four ways, as you scroll.',
  nav: [
    'A drawn proof',
    'A short film',
    'A thing you can drag',
    'Said out loud',
  ] as readonly string[],
  labels: [
    'Geometry, drawn as it is reasoned',
    'A reaction you can watch happen',
    'A model that answers back',
    'The same idea, spoken, when hearing it is what lands',
  ] as readonly string[],
  /** The handwriting inside the four cards. */
  marks: {
    square: 'the big square',
    added: '= the two small ones, added',
    drag: 'drag me',
    dragUnder: 'every number under it moves',
    /**
     * WHAT THE FOURTH CARD USED TO BE, and why it is not that any more. It drew a paragraph of
     * prose with a highlighter, a simile tag and a correction on it, under the label "Your own
     * writing, with the pen on it". Nothing in this tree reads a learner's own writing: there is no
     * photo or file input for written work and no essay answer kind (`packages/contracts`'s eleven
     * kinds are choose_visual, draw, fill, label, match, number_pad, order, place_points,
     * shade_regions, text and workbook). It was a quarter of a four-up, so a reader counted it as a
     * quarter of the product, and the copy law forbids exactly that (docs/SELL.md §9).
     *
     * The fourth form is the one the hero has always named and the product actually has: spoken
     * aloud (`wobo/voice.ts`, `services/gateway/src/wobo_gateway/voice.py`). Four forms, four
     * engines, and the rail in the hero and this card now name the same four.
     */
    spoken: {
      line: '“Square the two short sides, add them, and that is the long one squared.”',
    },
  },
} as const;

// --- Everything a great teacher does -------------------------------------------------------------------

/**
 * One of the two jobs Wobo does. They are named separately because blurring them sells the product
 * short in one direction and misrepresents it in the other.
 */
export interface Mode {
  key: 'doubt' | 'learning';
  /** Which of the two this is, in two words. */
  kicker: string;
  /** Its rhythm — the answer to "when", and the whole difference between them. */
  when: string;
  body: string;
}

/** One of the three beats: a number, a claim, the argument for it, and what it comes down to. */
export interface Beat {
  n: string;
  title: string;
  body: string;
  /** The line in Wobo's own hand. The second half is set in rose. */
  said: { lead: string; em: string };
  /** What the drawing beside it is, for anyone who cannot see it. */
  art: string;
  /**
   * A line set beside the drawing rather than in the text column. Only the re-teach ladder carries
   * one: the adaptive line's proof (docs/copy/growth/lines.md, 2026-09-09, form 3).
   */
  proof?: string;
}

export const TEACHES = {
  /**
   * THE WORLD'S FIRST CLAIM LIVES HERE, and the position is the owner's (2026-09-05): the hero
   * carries the feeling, and this carries the category. It is the right home for a second reason.
   * A superlative in the first five seconds is a stranger being told; a superlative here is a
   * reader being shown, because the six things underneath it are the substantiation and they are
   * on the same screen.
   *
   * The wording is deliberate and is held by docs/CLAIMS.md §1. It is a claim about a COMBINATION
   * we can each demonstrate in the code, not about the market: visually explains as it works,
   * follows the learner in real time, and generates the explanation for that learner rather than
   * serving a pre-made one. Never "the first AI tutor" (untrue), never "the only" (no more
   * evidence, more exposure), and never a comparison to any named product, teacher or school.
   */
  eyebrow: "The world's first AI companion that shows you",
  /**
   * The banner of the whole argument (docs/SELL.md §2), and the reason it is phrased as a tribute
   * rather than a comparison: naming what a great teacher does honours the craft, where naming a
   * competitor borrows against somebody else's reputation and takes nothing away from it.
   */
  title: {
    lead: 'Everything a great teacher does, ',
    mark: 'for one child, whenever they want to learn.',
    trail: '',
  },
  /**
   * The six, in one breath. Each one is real in this codebase and was checked before it was
   * written: the four answer forms (`wobo/board-stream.ts`, `video.ts`, `voice.ts`, the engines),
   * the re-teach ladder that changes axis on a repeated miss (`wobo/reteach.ts`), the prerequisite
   * check (`curriculum/placement.ts`), the mastery floor (`screens/learn/mastery.ts`), the debt
   * that comes back first (`screens/learn/units.ts`), and the analogy built from what the learner
   * told us they are into (`reteach.ts`'s `their_world` rung, `store/mind.ts`).
   */
  lede: 'Drawing it while explaining, so you watch the idea appear. Trying a completely different way when the first one does not land. Knowing what is missing underneath before building on top of it. Not moving on until it stays learnt. Bringing back what slipped. Building the example out of what you already care about. Six things, and Wobo does all six. Three of them are drawn here, and the rest are further down the page.',
  /**
   * THE ADAPTIVE LINE (owner, 2026-09-09: *"not a fixed course or content, adapts and changes to
   * your learning style and pace, and it doesn't stop until the topic is mastered"*), in the form
   * docs/copy/growth/lines.md sets for a section line. This is the chapter that argues Wobo is a
   * tutor rather than a course, so the line is its thesis and the six above are its substantiation.
   * "Yours" is the word for mastered: a school-report word never lands on a learner-facing surface.
   * Its proof is beat 02's `proof`, beside the ladder.
   */
  adapts:
    'No two learners get the same lesson. It changes to your pace and your way of thinking, and it does not stop until the topic is yours.',
  /**
   * THE TWO MODES (owner, 2026-09-04; docs/SELL.md §2, and DESIGN.md §0's copy law).
   *
   * The owner's words: *"for doubt clarification yes, always any time but to learn its not a day
   * before the exams right"*. Wobo does two different jobs with two different rhythms, and a page
   * that runs them together sells the product short. A doubt is genuinely any time, so the doubt
   * card says so without naming an hour. Learning is deliberately NOT any time: it is a bit at a
   * time, across weeks, which is the thing that makes the week before an exam revision.
   *
   * WHY THIS IS A SELLING POINT AND NOT A CAVEAT. A product reached for the night before an exam is
   * used three times a year by a frightened child; one that clears a doubt on the day it turns up
   * and teaches steadily is used all year by a confident one. The second is what was engineered —
   * mastery gates progression (`screens/learn/mastery.ts`), the ground under a chapter is taught
   * first (`curriculum/placement.ts`), and what slipped comes back before it is lost
   * (`screens/learn/units.ts`) — and every one of those is an anti-cramming mechanism. Saying so is
   * a trust signal to a parent that we are not selling a shortcut.
   *
   * It sits at the TOP of the teaching chapter because it is the frame for the six beneath it, and
   * because it is the honest answer to "is this just a chatbot with a logo": a chat window does the
   * first of these two jobs and has no way to do the second.
   */
  modes: {
    note: 'Two different jobs, and Wobo is built for both.',
    items: [
      {
        key: 'doubt',
        kicker: 'A doubt',
        when: 'The moment it turns up',
        body: 'One thing in the chapter did not land. Ask it after school, between classes, on the way home, over the weekend, in the school break, wherever you are and in whatever form the idea needs. It gets cleared while it is still small, instead of piling up into the thing you are afraid of.',
      },
      {
        key: 'learning',
        kicker: 'A subject',
        when: 'A bit at a time, across weeks',
        body: 'Wobo checks the ground under a chapter, teaches the gap first, and does not move on until it stays learnt. That is the slow half, and it is on purpose: a subject built up steadily is a subject where the week before the test is revision rather than panic.',
      },
    ] as readonly Mode[],
    /** The line in Wobo's hand under the pair. The second half is the one that is easy to miss. */
    hand: { lead: 'A doubt is any time. ', em: 'Learning is every week.' },
  },
  beats: [
    {
      n: '01',
      title: 'It finds the hole before it builds on top of it.',
      body: 'Most chapters stand on something older. Before teaching one, Wobo asks two or three quick questions about what it rests on. If something from an earlier year is shaky, it patches that first, in minutes, and then teaches the chapter your class is actually on.',
      said: { lead: 'Nobody fails algebra. ', em: 'They failed fractions, two years earlier.' },
      art: 'A chapter resting on earlier ideas, with the weak one found and patched',
    },
    {
      n: '02',
      title: 'If one way does not land, it tries a different one.',
      body: 'Not the same explanation, louder. A second attempt is a different route: a drawing instead of a definition, a worked example instead of a rule, a thing to drag instead of a thing to read, and an analogy built from what you already care about.',
      said: { lead: 'The same idea, ', em: 'explained the way you happen to think.' },
      /** The adaptive line's proof, beside the ladder it describes (lines.md, 2026-09-09, form 3). */
      proof:
        'When one explanation does not land, it tries another. And another. It stays until it lands.',
      art: 'One idea, three different routes into it',
    },
    {
      n: '03',
      title: 'It does not move on until it stays learnt.',
      body: 'Getting it right once is not knowing it. A chapter counts as done when it has come back right enough times, without a hint, that the answer is not a guess. Until it does, the thing that slipped is what comes next, so nothing new is built on top of it and you are never carried past it.',
      said: { lead: 'Finished means ', em: 'it holds without help.' },
      art: 'A chapter is done only when it comes back right without a hint',
    },
  ] as readonly Beat[],
  /** The words inside the three drawings — Wobo's own hand, so they belong with the copy. */
  gap: {
    prerequisites: ['fractions', 'ratios', 'negatives'] as readonly string[],
    chapter: 'this chapter',
    weak: 'shaky, patched first',
  },
  routes: {
    idea: 'idea',
    ways: ['drawn', 'worked out', 'in your world'] as readonly string[],
  },
  mastery: {
    days: ['today', '+2 days', '+1 week', '+3 weeks'] as readonly string[],
    slipped: 'slipped, taught again',
    done: 'mastered',
  },
} as const;

// --- The climb -------------------------------------------------------------------------------------

/** The two ways the same path can be dressed. The content underneath is identical. */
export interface Vibe {
  key: 'quest' | 'focus';
  label: string;
  /** What the drawing is, for anyone who cannot see it. */
  art: string;
}

export const CLIMB = {
  eyebrow: 'The long game',
  title: { lead: 'A subject you can ', mark: 'see yourself climbing.' },
  lede: 'Every chapter is a checkpoint on a path you can see. Something is waiting at the ones you finish, what is behind you stays unlocked, and a hard week never costs you ground. The same path, dressed the way the learner wants it.',
  switchLabel: 'How it looks',
  vibes: [
    {
      key: 'quest',
      label: 'Quest',
      art: 'The path, as a climb with checkpoints, a chest and a final challenge',
    },
    {
      key: 'focus',
      label: 'Focused',
      art: 'The same path, as a plain progress list',
    },
  ] as readonly Vibe[],
  /** The three things the climb marks, in Wobo's hand. */
  marks: { reward: 'a reward', here: 'you are here', test: 'the whole chapter' },
  /** The same four chapters, as the plain list. */
  rows: [
    { title: 'Fractions on a number line', state: 'mastered' },
    { title: 'Equivalent fractions', state: 'mastered' },
    { title: 'Adding unlike denominators', state: 'in progress' },
    { title: 'Mixed numbers', state: 'next' },
  ],
  gate: 'The chapter is held when the four above hold',
  same: { lead: 'Same chapters, same tutor, same standard. ', em: 'Only the look changes.' },
  legend: [
    { tone: 'var(--mint)', label: 'right a week on' },
    { tone: 'var(--pig)', label: 'where you are' },
    { tone: 'var(--marigold)', label: 'waiting at the next checkpoint' },
    { tone: 'var(--ink)', label: 'the whole chapter' },
  ],
} as const;

// --- The film -------------------------------------------------------------------------------------

export const STUDENTS = {
  eyebrow: 'For students',
  title: { lead: 'Stop it anywhere. ', mark: 'Ask the thing you would not ask in class.' },
  lede: 'Pause the film halfway. Circle the bit that lost you. Wobo picks up exactly there, on the same frame, explains it again from the beginning, and tells nobody you asked.',
  claims: [
    {
      title: 'It answers on what you are looking at',
      body: 'Not a search result. The frame, the diagram, the line of your own working.',
    },
    {
      title: 'It knows what your class did this week',
      body: 'So the answer uses the words your teacher used.',
    },
    {
      title: 'It notices when you get it',
      body: 'A small, specific fuss. Never a leaderboard.',
    },
  ],
  film: {
    slate: 'Photosynthesis · 0:19',
    bars: ['light', 'dark', 'more light'] as readonly string[],
    prompt: 'Ask Wobo about this',
    question: 'why does more light make more?',
    answer:
      'Because light is the fuel. Past a point the leaf runs out of water, and the bar stops growing.',
    stamp: '0:07 / 0:19',
  },
} as const;

// --- Practice ---------------------------------------------------------------------------------------

export const PRACTICE = {
  question: { lead: 'Colour ', fraction: '½', trail: ' of the shape.' },
  check: 'Check',
  reset: 'Start over',
  /** What the hand under the puzzle says at rest, and at each outcome. */
  hint: 'tap two, then check',
  empty: 'colour something first',
  close: 'close. go again.',
  win: "that's half. nice.",
  /** Indexed by how many squares are coloured; two is the answer, so it is never read. */
  counts: [
    'nothing yet',
    "that's a quarter",
    '',
    "that's three quarters",
    "that's the whole thing",
  ] as readonly string[],
  /** The ring's own label, completed with the count above. */
  notHalf: 'not half',
  cells: ['top left', 'top right', 'bottom left', 'bottom right'] as readonly string[],
  eyebrow: 'Practice that plays fair',
  title: { lead: 'Try one. Wobo ', mark: 'never says wrong.' },
  lede: 'Shade it, drag it, draw it, order it, type it. When you are close, Wobo rings the difference on your own answer and waits. When you get it, it makes a small fuss and moves on. Go on, colour half.',
  claims: [
    {
      title: 'The kinds your exam uses',
      body: 'Not multiple choice pretending to be understanding.',
    },
    {
      title: 'Nothing to copy',
      body: 'The answer does not exist until you have done the thinking.',
    },
    {
      title: 'What you missed comes first',
      body: 'Before anything new is built on top of it, not weeks later.',
    },
  ],
} as const;

// --- The parent's report -------------------------------------------------------------------------

export const PARENTS = {
  eyebrow: 'For parents',
  title: { lead: 'Not a dashboard to decode. ', mark: 'A picture you can read in ten seconds.' },
  lede: "Minutes that actually happened, chapters that are genuinely done, what is getting stronger, and where this pace lands before the exam. Then one honest note, in Wobo's words.",
  claims: [
    {
      title: 'Progress, not points',
      body: 'Mastery per chapter, measured by what came back right without a hint.',
    },
    {
      title: 'A line to the exam',
      body: 'At this pace, here is where the syllabus stands on the day.',
    },
    {
      title: 'Nothing to police',
      body: 'No streak guilt, no nudges after hours, no scores your child did not ask for.',
    },
  ],
  report: {
    heading: 'This week',
    tag: 'on track',
    kpis: [
      { label: 'Minutes', to: 96, suffix: '', note: 'across five evenings' },
      { label: 'Chapters done', to: 7, suffix: '/14', note: 'maths, this term' },
      { label: 'Right a week on', to: 82, suffix: '%', note: 'up from 61%' },
    ],
    days: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as readonly string[],
    projection: ['ready by', 'the test'] as readonly string[],
    badges: [
      'Asked for help after a miss',
      'Chapter mastered',
      'Ten minutes, five days',
    ] as readonly string[],
    note: {
      lead: 'Three lessons and fourteen problems, and help was asked for twice after a miss, ',
      accent: 'which is exactly how learning looks.',
    },
  },
} as const;

// --- The subject families ----------------------------------------------------------------------

export interface SubjectFamily {
  name: string;
  /** The half-line under the family name. */
  gloss: string;
  /** The subjects Wobo leads with, in the pigment tint. */
  lead: readonly string[];
  /** The rest of the family, quieter. */
  rest: readonly string[];
}

export const SUBJECTS = {
  /**
   * THE ADAPTIVE LINE, SHORTEST FORM (owner, 2026-09-09; docs/copy/growth/lines.md, "Not a fixed
   * course"): the eyebrow on the landing's second chapter, which is this one. It belongs over
   * "Whatever your school sets, Wobo teaches it" because that is the claim in one breath: not a
   * course with content of its own, a tutor that teaches the syllabus your own board set. The
   * prototype's eyebrow, "Every subject your board sets", is not lost: the hero's eyebrow, this
   * title and the close's fine print still say it, and voice.md §8.2 is still kept.
   */
  eyebrow: 'Not a fixed course. A tutor.',
  title: { lead: 'Whatever your school sets, ', mark: 'Wobo teaches it.' },
  lede: 'Tell Wobo the board and the class once, and it follows that syllabus chapter by chapter, in the order your own textbook uses. The official chapter lists for CBSE, ICSE, ISC and NIOS are already loaded; for any other board you hand over your school\u2019s syllabus once and Wobo builds the plan from that.',
  families: [
    {
      name: 'Mathematics',
      gloss: 'counting to calculus',
      lead: ['Numbers and fractions', 'Algebra', 'Geometry', 'Trigonometry'],
      rest: ['Statistics', 'Probability', 'Calculus', 'Applied maths'],
    },
    {
      name: 'The sciences',
      gloss: 'seen, not recited',
      lead: ['Environmental studies', 'General science', 'Physics', 'Chemistry', 'Biology'],
      rest: ['Earth science'],
    },
    {
      name: 'Languages',
      gloss: 'reading, writing, grammar',
      lead: ['English', 'Hindi'],
      rest: [
        'Sanskrit',
        'Telugu',
        'Tamil',
        'Marathi',
        'Bengali',
        'Kannada',
        "and your school's second language",
      ],
    },
    {
      name: 'Humanities',
      gloss: 'the map before the story',
      lead: ['History', 'Geography', 'Civics', 'Political science'],
      rest: ['Sociology', 'Psychology'],
    },
    {
      name: 'Commerce and computing',
      gloss: 'the senior streams',
      lead: ['Accountancy', 'Business studies', 'Economics', 'Computer science'],
      rest: ['Information technology'],
    },
  ] as readonly SubjectFamily[],
  closing:
    "Yours not here? Paste your school's own list in and Wobo reads it and builds the plan from that. It teaches in English today, and more languages follow the boards that ask for them.",
} as const;

// --- What it costs ------------------------------------------------------------------------------

/**
 * The price, ON THE HOMEPAGE (docs/SELL.md §3, doubt 5, and §8).
 *
 * It used to be behind a link, which is friction and, worse, reads as something being hidden. Our
 * price story is a good one — a free plan that is a real product rather than a trial — and a good
 * price story hidden behind a click converts worse than a plain one shown.
 *
 * ONLY THE WORDS ARE HERE. Every figure, every allowance and every plan name is read from
 * `screens/plans/prices.ts` by `sections/Price.tsx`, so the homepage cannot quote a price the
 * plans page does not charge, and the market is inferred from the browser rather than asked for
 * (law v5's copy law: location is inferred, never asked).
 *
 * The cancel line answers doubt 7 in the same breath as doubt 5, because they are the same fear
 * with two faces: what happens to my money. It is the cancel, never a refund (DESIGN.md §0).
 */
export const PRICE = {
  eyebrow: 'What it costs',
  title: { lead: 'It costs nothing to start, ', mark: 'and nothing to keep going.' },
  lede: 'The whole tutor is free every day: every subject, the drawn board, the films, the practice, the memory and the Sunday note, with a daily allowance that refills once a day. A plan raises the daily allowance. It does not unlock the teacher.',
  cancel: {
    title: 'And if it does not work out',
    body: 'Cancel in two taps. There is no offer to stay, no reason to give and no survey. You keep the plan until the period you have already paid for ends, nothing renews after that, and everything learnt stays exactly where it is.',
    link: { label: 'See both periods, and what each plan carries →', href: '/plans' },
  },
} as const;

// --- Safe by design ------------------------------------------------------------------------------

export interface SafeItem {
  title: string;
  body: string;
  /** The link out of the claim, and the page that proves it. */
  proof: string;
  href: string;
}

export const SAFE = {
  eyebrow: 'Safe by design',
  title: {
    lead: 'A tutor a child talks to alone ',
    mark: 'has to be built differently.',
  },
  lede: 'Not a promise page. Six decisions, each one visible in the product, each one checkable.',
  items: [
    {
      title: "Your child's questions are not a product",
      body: 'No ads, no tracking pixels, no third-party cookies, nothing sold in aggregate. The company is paid by families, so there is nothing to monetise sideways.',
      proof: 'Read what we hold →',
      href: '/legal/privacy-policy',
    },
    {
      title: 'Neutral on everything but the chapter',
      body: 'Politics, religion, anything contested: Wobo takes no side, says so plainly, and comes back to the chapter. It has no opinions to give a child.',
      proof: 'The neutral rule →',
      href: '/security',
    },
    {
      title: 'A parent sees the learning, not the diary',
      body: 'Lessons, progress and the Sunday note, always. Questions word for word only if the child shares them. Trust runs both ways or it is not trust.',
      proof: 'Who sees what →',
      href: '/legal/childrens-privacy',
    },
    {
      title: 'Locked at the row',
      // "sits encrypted at rest" was here. Nothing in this repository evidences the cipher or the
      // key management, and `docs/legal/privacy-policy.md` section 10 — live on this same site —
      // says in as many words that we have not read the project's settings and make no claim of
      // our own about them. The row-level rule IS ours and IS in the migrations, so that is what
      // the card claims, and the transport claim stays because TLS is ours to state.
      body: 'Everything travels over TLS, and the database carries its own per-learner access rules underneath the app, so a row is scoped to the learner it belongs to rather than to whoever asks for it.',
      proof: 'How it is protected →',
      href: '/security',
    },
    {
      title: 'Erase the learning, in one tap',
      // "Memory, progress, account" — the account is not among them. POST /v1/me/erase clears
      // memory, the twin summary, threads, boards, mail preferences and parent links; nothing in
      // the gateway, the SDK or the app calls the auth admin API, so no code deletes an account.
      body: 'Memory, saved boards and threads, and the parent link. Gone from live systems at once, and out of the backups behind them as those roll over. Deleting the account itself is done by a person when you ask.',
      proof: 'The erase button →',
      href: '/legal/privacy-policy',
    },
    {
      title: 'The laws we are building to',
      // "The consent a family gives is the one their own law requires." No consent is taken from
      // any family, in any market: `consent_tier` is read on every capability call and written by
      // nothing, so every learner sits permanently on un_elevated. The sentence asserted
      // per-jurisdiction consent handling as a shipped property. The laws are still named,
      // because naming an obligation is not a claim to have met it, and the gap is named too.
      body: "India's Digital Personal Data Protection Act, COPPA for children in the United States, and the GDPR's rules for children in Europe and the United Kingdom. There is no consent gate in Wobo yet, and we say so on the security page rather than implying one here.",
      proof: 'How we comply →',
      href: '/security',
    },
  ] as readonly SafeItem[],
} as const;

// --- Ask Wobo -------------------------------------------------------------------------------------

/**
 * The try box, which lives in the HERO now (docs/SELL.md §4) rather than in a section of its own
 * eleven screens down.
 *
 * Its old heading and eyebrow ("Still wondering?" / "Ask Wobo. It answers for itself.") went with
 * the section: the hero introduces the box with `HERO.tryNote`, so a second title for the same
 * control would be the page saying one thing twice.
 */
export const ASK = {
  placeholder: 'Is Wobo any good for a child who hates maths?',
  go: 'Ask',
  chips: [
    "Does it follow my school's syllabus?",
    'What happens when my child gets stuck?',
    'Is it safe to use alone?',
    'What does free include?',
  ] as readonly string[],
  answers: {
    "Does it follow my school's syllabus?":
      "Yes. You pick the board and class once, and I teach the chapter your class is on, in your textbook's order.",
    'What happens when my child gets stuck?':
      'I draw the step they are missing, then hand the next one back to them. Close gets a ring, never a cross.',
    'Is it safe to use alone?':
      'That is what I am built for: school subjects only, no ads, no opinions, and nothing said that would make a child feel small.',
    'What does free include?':
      'The whole tutor, every day, with a daily allowance of questions that refills once a day.',
  } as Readonly<Record<string, string>>,
  fallback:
    'I answer from the help centre here. Ask me one of those, or write to a person at support@heywobo.com.',
  others:
    'Or ask an assistant you already trust. It will read the site and tell you what it finds.',
} as const;

/** How fast Wobo's reply types itself in, in ms per character. The prototype's own rate. */
export const ASK_TYPE_MS = 12;

/**
 * The question handed to whichever assistant the reader already uses.
 *
 * This is the ONE place on the product where another company's assistant is named, and it is named
 * because it belongs to the READER, not to us: §17 forbids revealing which models or vendors sit
 * underneath Wobo, and nothing here does that. The row says "ask someone you already trust to go
 * and read our site" — the modern version of asking a friend — and an assistant nobody can name is
 * an assistant nobody can click.
 */
export const ASK_ELSEWHERE =
  'Visit https://heywobo.com and tell me what Wobo is, who it is for, and whether it is any good for a school child.';

export interface Assistant {
  name: string;
  /** The deep link, with the question already in it. */
  href: string;
}

/** The prototype's five, with its exact deep links. */
export function assistants(question: string = ASK_ELSEWHERE): readonly Assistant[] {
  const q = encodeURIComponent(question);
  return [
    { name: 'ChatGPT', href: `https://chatgpt.com/?q=${q}&hints=search` },
    { name: 'Claude', href: `https://claude.ai/new?q=${q}` },
    { name: 'Gemini', href: `https://gemini.google.com/app?q=${q}` },
    { name: 'Perplexity', href: `https://www.perplexity.ai/search?q=${q}` },
    { name: 'Grok', href: `https://grok.com/?q=${q}` },
  ];
}

// --- The close ---------------------------------------------------------------------------------------

/**
 * The close.
 *
 * IT USED TO BE A WAITLIST. One email field, a button, and a line admitting the address was kept in
 * this browser because there was nowhere to post it — the most common lie a marketing page tells,
 * told honestly, which is still a form standing between a stranger and the product. We are open
 * (owner, 2026-09-04), so the field comes out: the last thing this page asks for is a first lesson,
 * not an address, and there is no field to fill in on the way.
 *
 * The words are `site/handoffs.ts`'s `home` entry, so the front page closes on the same one phrase
 * every other public page closes on and cannot drift from it.
 */
export interface CloseCopy {
  title: string;
  sub: string;
  hand: string | null;
  primary: string;
  primaryTo: Route;
  quiet: string;
  quietHref: string;
  fine: string;
}

/**
 * The front page's close, for the dial as it stands (`docs/DOORS-CLOSED.md` §5).
 *
 * Not only the button. While new accounts are closed, "free every day, and no card to start" is a
 * sentence about a product a reader cannot have, and a page whose last three lines describe an
 * open product under a button that says otherwise is a page arguing with itself. So the two lines
 * either side of the door change with it, and the argument stays honest at both settings.
 */
export function closeCopy(open: boolean): CloseCopy {
  const close = handoff('home', open);
  return {
    title: close.title,
    sub: open
      ? 'Every subject your board sets, drawn out line by line, as many times as you need. Free every day, and no card to start.'
      : LIST.what,
    hand: open ? close.hand : LIST.under,
    primary: close.primary.label,
    primaryTo: close.primary.to as Route,
    quiet: close.quiet.label,
    quietHref: close.quiet.href ?? '/for-parents',
    fine: open
      ? 'Free to use every day, not just the first · every subject · every major board'
      : LIST.promise,
  };
}

/** The close as it reads with the dial ON, which is what `page-copy.test.ts` holds it to. */
export const CLOSE = closeCopy(true);

// --- The footer -----------------------------------------------------------------------------------

/**
 * ONE LIST, READ BY BOTH FOOTERS. The columns are `site/nav.ts`'s `FOOTER_COLUMNS`, the same
 * four the site shell draws under every public page. This file used to carry its own copy of
 * them, and the two had drifted: the front page was missing Donate Wobo and Cookies, so the donate
 * page and one of the ten legal documents had no path from the door most visitors come through,
 * and "Questions" went to /help here and to a dead anchor there (wave 29, site-10 and site-1).
 * The tagline stays the prototype's own sentence; only the addresses are shared.
 */
export const FOOTER = {
  tagline: 'A tutor that draws, films, listens and never judges.',
  columns: FOOTER_COLUMNS.map((column) => ({
    heading: column.title,
    links: column.links.map(({ label, href }) => ({ label, href })),
  })),
} as const;
