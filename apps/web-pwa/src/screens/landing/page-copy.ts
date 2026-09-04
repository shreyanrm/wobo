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

import { CTA } from '../site/cta';
import { HANDOFFS } from '../site/handoffs';

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
export const AUTH = {
  signIn: 'Sign in',
  start: CTA.label,
} as const;

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
  eyebrow: { lead: 'Every subject · every board · ', accent: 'free every day' },
  wake: 'Hey Wobo,',
  title: 'why do plants need sunlight?',
  lede: 'The first tutor that shows its working. Ask it anything your syllabus sets and the answer arrives in front of you, line by line: drawn on a board, filmed, handed back for you to try, or said out loud when that is what the idea needs.',
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
    'A page marked up',
  ] as readonly string[],
  labels: [
    'Geometry, drawn as it is reasoned',
    'A reaction you can watch happen',
    'A model that answers back',
    'Your own writing, with the pen on it',
  ] as readonly string[],
  /** The handwriting inside the four cards. */
  marks: {
    square: 'the big square',
    added: '= the two small ones, added',
    drag: 'drag me',
    dragUnder: 'every number under it moves',
    /**
     * The marked-up paragraph, in pieces, because every mark rides its OWN words: the highlighter
     * is a `<mark>`, the loop is a `::after` on the clause it circles, and neither can drift at
     * another width or in another theme the way the hand-placed SVG annotations it replaced did
     * (DESIGN.md §0, trap 5). The pieces run together as one sentence.
     */
    marked: {
      lead: 'The monsoon ',
      highlighted: 'arrived like a rumour',
      tag: 'simile ✓',
      mid: ', first in the smell of the air, then everywhere at once',
      circled: ', the streets were rivers',
      trail: ' by evening.',
      note: 'two sentences, one comma',
      fix: '→ “…at once. By evening the streets were rivers.”',
    },
  },
} as const;

// --- Everything a great teacher does -------------------------------------------------------------------

/** One of the three beats: a number, a claim, the argument for it, and what it comes down to. */
export interface Beat {
  n: string;
  title: string;
  body: string;
  /** The line in Wobo's own hand. The second half is set in rose. */
  said: { lead: string; em: string };
  /** What the drawing beside it is, for anyone who cannot see it. */
  art: string;
}

export const TEACHES = {
  eyebrow: 'Not a chatbot with a logo',
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
      art: 'One idea, three different routes into it',
    },
    {
      n: '03',
      title: 'It does not move on until it stays learnt.',
      body: 'Getting it right once is not knowing it. A chapter counts as done when it comes back right days later, unprompted. Until it does, the thing that slipped is what comes next, so nothing new is built on top of it and you are never carried past it.',
      said: { lead: 'Finished means ', em: 'still true next week.' },
      art: 'A chapter is done only when it comes back right days later',
    },
  ] as readonly Beat[],
  /** The words inside the three drawings — Wobo's own hand, so they belong with the copy. */
  gap: {
    prerequisites: ['fractions', 'ratios', 'negatives'] as readonly string[],
    chapter: 'this chapter',
    weak: 'shaky — patched first',
  },
  routes: {
    idea: 'idea',
    ways: ['drawn', 'worked out', 'in your world'] as readonly string[],
  },
  mastery: {
    days: ['today', '+2 days', '+1 week', '+3 weeks'] as readonly string[],
    slipped: 'slipped — taught again',
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
    { tone: 'var(--mint)', label: 'held a week later' },
    { tone: 'var(--pig)', label: 'where you are' },
    { tone: 'var(--marigold)', label: 'waiting at the next checkpoint' },
    { tone: 'var(--ink)', label: 'the whole chapter' },
  ],
} as const;

// --- The film -------------------------------------------------------------------------------------

export const STUDENTS = {
  eyebrow: 'For students',
  title: { lead: 'Stop it anywhere. ', mark: 'Ask the thing you would not ask in class.' },
  lede: 'Pause the film halfway. Circle the bit that lost you. Wobo picks up exactly there, on the same frame, and explains it without a sigh and without telling anyone.',
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
      body: 'Mastery per chapter, measured by what came back right a week later.',
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
      { label: 'Held a week later', to: 82, suffix: '%', note: 'up from 61%' },
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
  eyebrow: 'Every subject your board sets',
  title: { lead: 'If your school sets it, ', mark: 'Wobo teaches it.' },
  lede: 'Tell Wobo the board and the class once, and it follows that syllabus chapter by chapter, in the order your own textbook uses. CBSE, ICSE and every state board we hold the official syllabus for.',
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
  lede: 'The whole tutor is free every day: every subject, the drawn board, the films, the practice, the memory and the Sunday note, with a daily allowance that resets every morning. A plan raises the allowance for exam season. It does not unlock the teacher.',
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
    lead: 'A tutor a ten-year-old talks to alone ',
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
      body: "Politics, religion, anything contested: Wobo names the textbook's position and steers back. It has no opinions to give a child.",
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
      title: 'Encrypted, and locked at the row',
      body: "Everything travels over TLS and sits encrypted at rest, with access rules inside the database itself: a learner's rows are reachable only by that learner, even if our own code slipped.",
      proof: 'How it is protected →',
      href: '/security',
    },
    {
      title: 'Erase everything, in one tap',
      body: 'Memory, progress, account. Gone from live systems at once and from backups inside thirty days, for the learner or a linked parent.',
      proof: 'The erase button →',
      href: '/legal/privacy-policy',
    },
    {
      title: 'Built to the law wherever you are',
      body: "India's Digital Personal Data Protection Act, COPPA for children in the United States, and the GDPR's rules for children in Europe and the United Kingdom. The consent a family gives is the one their own law requires.",
      proof: 'How we comply →',
      href: '/security',
    },
  ] as readonly SafeItem[],
} as const;

// --- Ask Wobo -------------------------------------------------------------------------------------

export const ASK = {
  eyebrow: 'Still wondering?',
  title: 'Ask Wobo. It answers for itself.',
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
      'The whole tutor, every day, with a daily allowance of questions that resets each morning.',
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
export const CLOSE = {
  title: HANDOFFS.home.title,
  sub: 'Every subject your board sets, drawn out line by line, as many times as you need. Free every day, and no card to start.',
  hand: HANDOFFS.home.hand,
  primary: HANDOFFS.home.primary.label,
  quiet: HANDOFFS.home.quiet.label,
  quietHref: HANDOFFS.home.quiet.href ?? '/for-parents',
  fine: 'Free to use every day, not just the first · every subject · every major board',
} as const;

// --- The footer -----------------------------------------------------------------------------------

export const FOOTER = {
  tagline: 'A tutor that draws, films, listens and never judges.',
  columns: [
    {
      heading: 'Wobo',
      links: [
        { label: 'Meet Wobo', href: '/meet-wobo' },
        { label: 'How it works', href: '/how-it-works' },
        { label: 'Subjects', href: '/subjects' },
        { label: 'Plans', href: '/plans' },
        { label: 'Gift Wobo', href: '/gift' },
      ],
    },
    {
      heading: 'For',
      links: [
        { label: 'Parents', href: '/for-parents' },
        { label: 'Students', href: '/for-students' },
      ],
    },
    {
      heading: 'Help',
      links: [
        { label: 'Help centre', href: '/help' },
        { label: 'Contact', href: '/contact' },
        { label: 'Questions', href: '/help' },
      ],
    },
    {
      heading: 'Company',
      links: [
        { label: 'About', href: '/about' },
        { label: 'Security and trust', href: '/security' },
        { label: 'Terms', href: '/legal/terms-of-service' },
        { label: 'Privacy', href: '/legal/privacy-policy' },
        { label: "Children's privacy", href: '/legal/childrens-privacy' },
        { label: 'Accessibility', href: '/legal/accessibility-statement' },
      ],
    },
  ],
} as const;
