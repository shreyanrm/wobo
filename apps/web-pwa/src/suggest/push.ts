/**
 * PUSH NOTIFICATIONS: THE DESIGN, AND NOT THE THING.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §3: *"Push notifications do not exist and are not built. When
 * they are, they inherit the inbox law exactly, plus four rules of their own, because a push is
 * more intrusive than mail and the same cadence would be a different thing."*
 *
 * THIS FILE SENDS NOTHING. It asks for no permission, registers no worker, posts no notification
 * and calls nothing. It holds four decisions and the inbox law they inherit, as functions, so that
 * the day somebody wires a real push they wire it to rules that were already written down and
 * already under test — rather than deciding cadence at four in the afternoon with a deadline on.
 * `push.test.ts` reads this source and fails if anything in it could reach a phone, which is what
 * makes "not built" a fact rather than an intention.
 *
 * WHY IT IS LAST AT ALL. *"Push is last on purpose. It is the most intrusive thing we could ship
 * and the easiest to get wrong, and a product that has not yet earned a learner's return has not
 * earned the right to interrupt them."*
 */

/** Nothing here is wired. Read it before you build on it. */
export const PUSH_BUILT = false;

// --- rule 4: only three kinds ever ------------------------------------------------------------------

/**
 * *"Only three kinds ever: the lesson they left half done, the answer to a doubt they photographed,
 * and the day their streak would end, which is the only one that is a reminder rather than a
 * result. No product news, no offers, no 'we miss you', no re-engagement campaign."*
 *
 * The list is closed on purpose, and it is a union rather than a string, so a fourth kind cannot be
 * added by typing one: it has to be added here, where the sentence above is sitting next to it.
 */
export type PushKind = 'left_half_done' | 'doubt_answered' | 'streak_ends_today';

export const PUSH_KINDS: readonly PushKind[] = [
  'left_half_done',
  'doubt_answered',
  'streak_ends_today',
];

export function isAPushKind(kind: string): kind is PushKind {
  return (PUSH_KINDS as readonly string[]).includes(kind);
}

/**
 * Two of the three are RESULTS of something the learner did themselves: they left a lesson open,
 * they photographed a page. Only the streak is a reminder, and the distinction matters because the
 * inbox law's "never on a day the learner came" is about reminders. An answer somebody asked for
 * is not an interruption just because they also came today.
 */
export function isReminder(kind: PushKind): boolean {
  return kind === 'streak_ends_today';
}

/**
 * *"Cadence is the learner's: each kind is its own dial with its own one-click unsubscribe"*
 * (docs/EMAILS-AND-ANIMATIONS.md §1). One dial per kind, so switching off the streak reminder never
 * switches off the answer to a question they asked.
 */
export const DIAL_FOR: Record<PushKind, string> = {
  left_half_done: 'push.left_half_done',
  doubt_answered: 'push.doubt_answered',
  streak_ends_today: 'push.streak_ends_today',
};

// --- rule 1: off until asked for --------------------------------------------------------------------

export interface ReturnHistory {
  /** Times they came back on their own. Not opens we caused; returns they chose. */
  selfDirectedReturns: number;
  /** Have we already put the question to them? It is asked once in a lifetime. */
  offered: boolean;
  /** Did they say no? Then it is never asked again, at any number of returns. */
  declined: boolean;
}

/** Three returns of their own before we ask for anything. */
export const RETURNS_BEFORE_ASKING = 3;

/**
 * *"Off until asked for. No permission prompt on arrival. The offer appears once, after a learner
 * has come back on their own at least three times, and never again if declined."*
 *
 * The arrival case is the one this is really for. A permission prompt on a first visit is a browser
 * dialog from a stranger, it is refused by almost everyone, and a refusal in that dialog is
 * permanent at the browser level — so asking early does not merely annoy, it destroys the
 * possibility for the learners who would have said yes later.
 */
export function mayAskToTurnOn(h: ReturnHistory): boolean {
  if (h.declined || h.offered) return false;
  return h.selfDirectedReturns >= RETURNS_BEFORE_ASKING;
}

// --- rule 2: fewer than mail, never more ------------------------------------------------------------

/** The inbox law's own number: one address hears from Wobo at most once in twenty-four hours. */
export const MAIL_MAX_PER_24H = 1;
/** And a push is never allowed a wider cadence than mail has. */
export const PUSH_MAX_PER_24H = 1;

export interface Message {
  kind: PushKind;
  /** What it is about: the lesson, the doubt, the streak. Two messages about one thing is one. */
  about: string;
}

/**
 * *"A push and a mail about the same thing is one message, not two, and the push wins because it is
 * the lighter one."*
 *
 * A push is lighter than mail: it is a line on a lock screen that costs a swipe, where a mail sits
 * in an inbox until it is dealt with and counts against a sender's standing for ever. So when both
 * are queued for one thing, the push goes and the mail is dropped, never the other way round.
 */
export function oneMessage(queued: { push: readonly Message[]; mail: readonly Message[] }): {
  push: Message[];
  mail: Message[];
} {
  const push = queued.push.slice(0, PUSH_MAX_PER_24H);
  const taken = new Set(push.map((m) => `${m.kind}:${m.about}`));
  const mail = queued.mail
    .filter((m) => !taken.has(`${m.kind}:${m.about}`))
    .slice(0, MAIL_MAX_PER_24H);
  return { push, mail };
}

// --- rule 3: never at a late hour, never during school ----------------------------------------------

/** The hours law, as docs/EMAILS-AND-ANIMATIONS.md §1 states it: never after eight in the evening. */
export const DAY_OPENS = 8;
export const DAY_CLOSES = 20;
/**
 * School hours, until locality carries real ones. docs/WOBO-PLAN.md makes school hours a property of
 * the learner's country and region; this is the conservative default that holds until that lands,
 * and widening it is a decision somebody has to make here rather than a default nobody chose.
 */
export const SCHOOL_OPENS = 8;
export const SCHOOL_CLOSES = 15;

export interface Moment {
  /** The hour where the learner is, never where a server is. */
  hourLocal: number;
  schoolDay: boolean;
  /** *"When locality is unknown or ambiguous, nothing sends"* (docs/WOBO-PLAN.md). */
  localityKnown: boolean;
}

/**
 * *"Never at a late hour, by the hours law, in the learner's own timezone, and never during school
 * hours on a school day."*
 *
 * The school clause is the one a mail law did not need: a mail waits in an inbox until the reader
 * is free, and a push arrives in a classroom with a teacher standing at the front of it.
 */
export function mayPushAt(at: Moment): boolean {
  if (!at.localityKnown) return false;
  if (at.hourLocal < DAY_OPENS || at.hourLocal >= DAY_CLOSES) return false;
  if (at.schoolDay && at.hourLocal >= SCHOOL_OPENS && at.hourLocal < SCHOOL_CLOSES) return false;
  return true;
}

// --- the inbox law, inherited exactly ----------------------------------------------------------------

export interface Standing {
  /** Has this person heard from Wobo, by any channel, in the last twenty-four hours? */
  messagedWithin24h: boolean;
  /** Did the learner come today? A reminder to somebody who came is a reminder about nothing. */
  cameToday: boolean;
}

/**
 * *"Nothing here loosens that."* The twenty-four hour gap is counted across BOTH channels, because
 * a person does not experience a mail and a push as two separate relationships, and the point of
 * the gap is the person rather than the channel.
 */
export function inboxLawAllows(kind: PushKind, standing: Standing): boolean {
  if (standing.messagedWithin24h) return false;
  if (isReminder(kind) && standing.cameToday) return false;
  return true;
}
