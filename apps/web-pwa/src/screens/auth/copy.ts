/**
 * Every word on the sign-in, sign-up and contact pages, in one file.
 *
 * Copy is law here (`docs/copy/voice.md`): sentence case, no emoji, no exclamation marks, the name
 * before any pronoun, the answer in the first line, and never a vendor named. Keeping it in one
 * module is what lets `copy.test.ts` assert all of that over the whole surface at once instead of a
 * reviewer having to catch it in JSX.
 *
 * Two things are deliberately NOT here. No provider is named beyond the two the buttons are for
 * (Google and Apple are the account a learner already has, not our infrastructure), and no promise
 * is made about a method that is not wired — the honest note for an unwired door is generated from
 * the door itself, so it cannot drift from what the client can actually do.
 */

export const SIGN_IN = {
  eyebrow: 'sign in',
  /** The tab's title. The headline is a sentence and reads badly in a tab. */
  tab: 'Sign in',
  /** Wobo's own greeting, in Wobo's hand, in the speech bubble beside the head. */
  hand: 'good to see you again',
  title: 'Welcome back.',
  lede: 'Everything picks up exactly where you left it, on whichever device you are holding.',
  switchPrompt: 'New here?',
  switchAction: 'Create an account',
} as const;

export const SIGN_UP = {
  eyebrow: 'create an account',
  tab: 'Create an account',
  hand: "Hi. I'm Wobo. Let's make this yours.",
  /**
   * THE HEADLINE ON THIS DOOR GREETS SOMEBODY WHO HAS NO ACCOUNT. It briefly read "Sign in so
   * everything stays with you", which instructed a brand-new visitor to do the thing the OTHER
   * door does, two inches from a bar link that reads "Already have an account? Sign in". The
   * headline states what creating an account is for; the lede says why we ask.
   */
  title: 'Everything you do stays with you.',
  lede: 'That is the only reason I am asking. No newsletter, no card, and nothing sold to anyone.',
  switchPrompt: 'Already have an account?',
  switchAction: 'Sign in',
} as const;

/** The name on each door, and what it does. */
export const METHODS = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
  password: 'Use an email and password',
  magicLink: 'Email me a sign-in link',
  phone: 'Use my phone number',
} as const;

/**
 * Said about a door that is not open yet. One line, and true.
 *
 * It is never printed under the button as an apology. The button keeps its shape and carries the
 * `SOON` chip, and this sentence is the button's accessible description — so a screen reader gets
 * the whole truth while the page stays a page rather than a list of excuses.
 */
export const NOT_WIRED = 'This way in is not switched on yet.';

/** The chip on a door that is coming. Lower case: it is a marker, not a word in a sentence. */
export const SOON = 'soon';

/** Said when this build has no working way in at all, in place of controls that cannot work. */
export const NO_WAY_IN =
  'No way in is switched on in this build yet. Nothing here can sign you in, so nothing here pretends to.';

export const FIELDS = {
  email: 'Email',
  password: 'Password',
  birth: 'Date of birth',
  birthWhy: 'I ask once, to know what a grown-up has to say yes to.',
  parentEmail: "A parent or guardian's email",
  /** The same field where a code is what this build can send. */
  parentPhone: "A parent or guardian's phone number",
  code: 'The code Wobo sent',
  phone: 'Phone number',
  /** The one field, named for whichever ways in are actually wired behind it. */
  who: 'Email or phone',
  /** What the one field says before anything is typed, for each of those three shapes. */
  placeholderWho: 'you@example.com or +91 …',
  placeholderEmail: 'you@example.com',
  placeholderPhone: '+91 …',
  /**
   * Under the one field. What happens when it is sent, so nothing is a surprise — and, where a
   * number is what goes in it, the country code ASKED FOR BEFORE the button is pressed. It was not,
   * and a number typed the way a learner says it out loud was accepted and then failed on submit
   * with a sentence that named nothing (`field.ts` hasCountryCode).
   */
  whoHintCode:
    'Start with your country code, like +91. I send a code to that number, and it works once, only for a short while.',
  whoHintLink: 'I send a link to that address. It works once, and only for a short while.',
  whoHintEither:
    'I send a code to a number, starting with its country code like +91, or a link to an address. Either one works once, and only for a short while.',
  /** Under the parent's field on the under-13 branch, for each shape it can take. */
  parentHintCode:
    'Start with the country code, like +91. I send one code to that number, and a parent reads it on their own phone.',
  parentHintLink: 'I send one link to that address, and a parent opens it on their own device.',
  codeHint: 'Six digits, from the message I just sent.',
} as const;

export const ACTIONS = {
  signIn: 'Sign in',
  signUp: 'Create my account',
  sendLink: 'Send the link',
  sendCode: 'Send me a code',
  verify: 'Check the code',
  askParent: 'Ask my parent',
  or: 'or',
  /** Back out of the code step to the field, without losing the run. */
  startOver: 'Use a different one',
  /** The way out of a branch that cannot go on: change the answer that opened it. */
  changeBirth: 'Change my date of birth',
} as const;

/** The consent tick. Never pre-ticked, and it links the pages it names. */
export const CONSENT = {
  lead: 'I agree to the',
  terms: 'terms of service',
  and: 'and the',
  privacy: 'privacy policy',
  termsHref: '/legal/terms',
  privacyHref: '/legal/privacy',
} as const;

/**
 * The standing legal line, on BOTH doors.
 *
 * These two pages carry their own chrome rather than SiteShell, because the bar holds the stepper
 * and SiteShell's does not. The cost of that was the site footer, and with it the terms and the
 * privacy policy, which SiteShell carried for a documented reason: a person standing on a sign-up
 * page is entitled to read what they are agreeing to from where they stand. On the way in, the
 * consent tick links both; on the way back, nothing did. This line restores it on both.
 */
export const DOOR_LEGAL = {
  lead: 'By continuing you agree to our',
  terms: 'terms',
  and: 'and',
  privacy: 'privacy policy',
} as const;

/**
 * What a parent is told, and what happens next. From `docs/legal/parental-consent.md` §2 and §3.
 *
 * THIS BLOCK IS THE UNDER-13 BRANCH AND NOTHING ELSE NOW. It used to appear for a teenager too,
 * under the title "I'll write to your parent" and the sentence "I send one message to that
 * address" — and no message was ever sent, because the only call site for the address was inside
 * the under-13 branch, which no shipped build could reach. A fourteen-year-old was asked for a
 * third party's email address under an explicit promise, and the address was dropped on the floor.
 * A teenager is now told what is true (`TEEN`), and asked for a parent at the run's own parent
 * step, which really does reach the gateway's invite door.
 *
 * Under 13 the account is the parent's, so the contact here is not a notice to send later: it is
 * the door the PARENT signs in through, on their own device. That is a thing the build can really
 * do, so it says so.
 */
export const PARENT = {
  title: 'A parent or guardian holds this account',
  /** The lead sentence, for whichever way this build can actually reach a parent. */
  sendLink: 'I send one link to that address, and a parent or guardian opens it on their own device.',
  sendCode:
    'I send one code to that number. A parent or guardian reads it on their own phone and types it in here.',
  body: 'The account is then theirs, held with you. Nothing is ticked already: memory, voice, photographs and sharing are each asked about on their own, later.',
  learning:
    'Your lessons work either way. Consent switches on memory, voice, photographs and sharing, never the teaching.',
  sentTitle: 'A message is on its way',
  sent: "Sent. I'll let you in the moment a parent says yes, and you can start learning now.",
  /** The code step, when the code went to a parent's phone rather than the learner's own. */
  codeTitle: 'Ask a parent for the code',
  codeBody:
    'The code is on its way to their phone. When they read it out, type it in below, and the account is theirs.',
  /** When there is no way to reach a parent at all. Nothing is claimed that did not happen. */
  cannotSend:
    'I cannot reach a parent from this build yet, so there is no way to make an account for somebody under 13 here. Nothing has been sent.',
} as const;

/**
 * WHAT A TEENAGER IS TOLD, which is what is true rather than what we intend.
 *
 * `childrens-privacy.md` §3 states it plainly: there is no consent mechanism in the product, no
 * screen asks a parent for permission, and no feature waits for one. So this door does not ask a
 * thirteen-to-seventeen-year-old for a parent's address. It says who holds the account, says that
 * a parent can be added, and leaves the asking to the run's parent step and the Parents card,
 * both of which reach the gateway's own invite door.
 */
export const TEEN = {
  title: 'A parent or guardian',
  body: 'I ask for a parent or guardian in a moment, and you can add or change one at any time from your own page. Nothing is sent to anybody before you say so.',
} as const;

/** What happens after a link, or a code, is sent. */
export const SENT = {
  title: 'Check your inbox',
  body: 'The link is on its way. It works once, and only for a short while, so nobody who finds it later can use it.',
  again: 'Send it again',
  codeTitle: 'Check your messages',
  codeBody: 'The code is on its way. Type it in below, and I will let you straight in.',
} as const;

/**
 * Every error a learner can meet here, in Wobo's voice.
 *
 * The rule from voice.md §6: say what we do not know, own what is ours, and never hand somebody a
 * provider's sentence. The last one is a catch-all — if we cannot name the problem, we say so
 * rather than guessing at it.
 */
export const ERRORS = {
  email: 'That address does not look finished. Check it and try again.',
  password: 'Passwords need at least eight characters. Longer is kinder to you, not to us.',
  credentials: 'That email and password do not match an account. Try again, or ask for a link.',
  birth: 'I need your date of birth to know what a grown-up has to say yes to.',
  birthInvalid: 'That date does not look right. Check it and try again.',
  parentEmail: "I need a parent or guardian's email to ask them.",
  parentPhone: "I need a parent or guardian's phone number to send the code to.",
  agree: 'I need you to agree to the terms and the privacy policy first.',
  phone: 'That number does not look finished. Check it and try again.',
  /**
   * The country code, named. It used to be the catch-all: a number with no code in front of it was
   * accepted by the field, sent verbatim, and refused by the service, and the only sentence the
   * learner ever met was "I could not finish that", which names nothing.
   */
  phoneCountry: 'I need the country code at the front too, like +91 before the number.',
  who: 'I need an email address or a phone number to go on.',
  code: 'That code did not check out. Ask for another one.',
  /**
   * The sign-in door does not make accounts. It asks no date of birth and takes no agreement to
   * the terms, so it must not: it used to, silently, because the client asked the service to
   * create a user for any number typed into it.
   */
  noAccount:
    'I could not find an account with that number. Create one first, and I will ask a couple of things before you come in.',
  offline: 'I cannot reach the account service from here. Check your connection and try again.',
  unknown: 'I could not finish that. Try once more, and if it keeps happening, write to us.',
} as const;

export const CONTACT = {
  eyebrow: 'contact',
  hand: 'a person reads every one',
  title: 'Write to Wobo',
  body: 'Tell us what happened, or what you wish Wobo did. A person reads every message, and you get an answer.',
  subject: 'What is this about',
  message: 'Your message',
  emailLabel: 'Your email, so we can answer',
  send: 'Send',
  /** Shown when there is no form endpoint: the honest path, not a form that goes nowhere. */
  mailtoNote:
    'This opens your own email app. There is no message form here yet, and a form that quietly went nowhere would be worse than saying so.',
  address: 'support@heywobo.com',
  privacy: 'For anything about your data, or a child’s, write to support@heywobo.com.',
  reasons: ['Something is broken', 'Something is wrong in a lesson', 'A question', 'Anything else'],
} as const;
