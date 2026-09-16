/**
 * THE INSTALL PROMPT, IN THE RIGHT PLACE (docs/PLATFORMS.md §5 and §6).
 *
 * *"Everything that makes a store app good is web work we should do regardless ... offline lessons,
 * a fast cold start on a cheap Android phone, the camera path, the share targets, push
 * notifications, and the install prompt in the right place."* The right place is the whole of this
 * file, because a browser's own install banner is in the wrong one by default: it arrives on a
 * stranger's first paint, on the landing page, before anybody has been taught anything, and it is
 * refused by almost everyone who sees it there. A refusal is not free either. It teaches the
 * browser that this origin's offer is unwanted.
 *
 * SO THE EVENT IS CAUGHT AND HELD WHEREVER THIS RUNS. `beforeinstallprompt.preventDefault()` is
 * the one line that takes the banner off the page, and it has to run for the offer to be ours to
 * place. What we do with the held event is then a product decision rather than a browser's:
 *
 *   ARMED AT THE ENTRY, SO    The capture is armed by `src/main.tsx`, which boots the public site
 *   THE BANNER IS OURS        and the app alike, and it is armed there for two reasons that are
 *   EVERYWHERE.               really the same one: the browser fires this event ONCE per page load,
 *                            at a moment of its own choosing, and an event nobody is listening for
 *                            is gone for that load.
 *                              It used to be armed in an effect inside the app frame. The frame is
 *                            behind `App.tsx`'s `lazy(() => import('./AppRuntime'))`, whole seconds
 *                            of download and parse away, and on the cheap Android phone this offer
 *                            exists for the first interactive frame was measured at 33.9 seconds.
 *                            Chromium fired into an empty room: `routeFor()` answered null for the
 *                            entire load and the Android learner was offered nothing, silently, on
 *                            exactly the phone the work was for. It was the ordinary case and not a
 *                            corner, because the offer is only ever made to a learner who has
 *                            already mastered a topic — a RETURNING visitor, whose worker and
 *                            manifest are already on the device, which is precisely the visit on
 *                            which the browser can fire earliest.
 *                              And the public site, the two doors and onboarding render no frame at
 *                            all, so they armed nothing ever: the landing page was the one surface
 *                            where a browser could still put its own affordance in front of a
 *                            stranger's first paint, which is the single thing the paragraph above
 *                            says this file exists to prevent.
 *                              A public page HOLDING the event is safe, because holding is all that
 *                            happens there. Nothing outside the frame renders the offer, and the
 *                            gate below answers null off a public route anyway, so the event sits
 *                            unspent until a learner is behind the door and has earned something.
 *   AFTER AN EARNED MOMENT.  docs/FEEL.md §3 and docs/REWARDS.md §3: a topic mastered is the
 *                            product's own earned moment, the one the sigil ignites for. The offer
 *                            rides in after it, never before it. A learner who has been given
 *                            something is a learner with a reason to keep it; a learner who has not
 *                            is being asked for a favour.
 *   ANSWERED, NOT MERELY     docs/SUGGESTIONS-AND-NOTICES.md §2: declining is free, and *"a
 *   RENDERED.                suggestion declined is not offered again that session"*. So an offer is
 *                            spent when the learner ANSWERS it, never when the card is painted.
 *                            This card renders at the end of the main column, under the screen's own
 *                            content, and a learner who never scrolled that far has not been asked
 *                            anything: charging them their one chance for it would make the offer a
 *                            secret. Unanswered, it may go up on `INSTALL_SHOWINGS` separate days
 *                            and is then silent for good. That is the difference between an offer
 *                            and a nag at one end, and between an offer and a secret at the other.
 *
 * AND ON IOS, WHERE THE EVENT DOES NOT EXIST. Safari implements no `beforeinstallprompt` and no
 * programmatic install at all: the only route to a home screen is the share menu, which the learner
 * has to walk themselves. The same moment offers that route instead, as two steps drawn from the
 * app's own primitives (`suggest/InstallOffer.tsx`). Never a screenshot: a picture of somebody
 * else's phone, at the wrong size, in the wrong theme, going stale on the next OS release.
 *
 * WHAT IS NOT HERE, ON PURPOSE. No notification permission is requested, nothing is subscribed, and
 * no push is registered: push is held last by law (docs/SUGGESTIONS-AND-NOTICES.md §3, and
 * `suggest/push.ts` is the design that sends nothing). Installing an app and interrupting a child
 * are different questions and this file asks only the first.
 */

import { scoped } from '../store/scope';

/**
 * What this learner has already been asked, and what their device already is. Per account rather
 * than per device: two children on one tablet are two learners, and an offer one of them waved away
 * is not an answer the other gave. It goes through `scoped`, so it leaves with them on sign-out.
 */
export const INSTALL_KEY = 'wobo-install-v1';

/** How the app came to be installed. Recorded as a fact, never inferred later from a guess. */
export type InstalledHow = 'standalone' | 'home-screen' | 'event';

/**
 * How many separate days an UNANSWERED offer may go up before it goes quiet for ever.
 *
 * Not one, because one is the number that makes a card at the end of a column into a secret: the
 * learner who never scrolled to it has spent it. Not many, because the offer is the least important
 * thing on any screen it appears on. Three is a small, fixed budget that fits in a sentence, and
 * even the worst case it allows — a learner who ignores it every time — is three quiet cards in a
 * lifetime, against the one per day the inbox law already permits mail.
 */
export const INSTALL_SHOWINGS = 3;

export interface InstallRecord {
  /** When the offer FIRST went up, ISO. `null` means it never has. */
  offered: string | null;
  /**
   * The day of the most recent showing, `YYYY-MM-DD`. Two cards on one day are one showing: the
   * frame remounts on a route change, and a learner walking between screens has been asked once.
   * The day is the UTC one, which turns at half past five in the morning in India, so no ordinary
   * evening is cut in two by it.
   */
  lastDay: string | null;
  /** How many separate days it has gone up. Never past `INSTALL_SHOWINGS`. */
  shows: number;
  /**
   * When the learner ANSWERED it, ISO, by taking it or by turning the browser's own dialog down.
   * An answer ends the offer for good; a card they never reached is not one.
   */
  answered: string | null;
  /** When the app was first seen installed, ISO, and how. `null` means it has not been. */
  installed: string | null;
  how: InstalledHow | null;
  /**
   * The learner came back and asked for it from You. It re-opens the offer, which is the only way
   * it can ever be shown once its own budget is spent.
   */
  asked: boolean;
}

const NOTHING: InstallRecord = {
  offered: null,
  lastDay: null,
  shows: 0,
  answered: null,
  installed: null,
  how: null,
  asked: false,
};

/**
 * The event Chromium fires and no TypeScript lib declares. Declared as the two members we touch
 * rather than as a full type, so nothing here pretends to know more about it than it uses.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * The window this module talks to. A seam, not an abstraction: there is no DOM in the test runner,
 * and an install flow that can only be exercised in a browser is one that gets exercised by hand,
 * once, by whoever wrote it.
 */
export interface InstallWindow {
  addEventListener(type: string, fn: (event: Event) => void): void;
  removeEventListener(type: string, fn: (event: Event) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean; userAgent?: string };
}

function browser(): InstallWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as InstallWindow);
}

// --- the record ------------------------------------------------------------------------------------

export function readInstall(): InstallRecord {
  const raw = scoped.getItem(INSTALL_KEY);
  if (!raw) return NOTHING;
  try {
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    const offered = typeof parsed.offered === 'string' ? parsed.offered : null;
    return {
      offered,
      // A record written by the older rule carries no day and no count. It was one showing, so it
      // is read as one, and the account keeps the rest of its budget rather than being punished
      // for having been here before the rule was fixed.
      lastDay:
        typeof parsed.lastDay === 'string' ? parsed.lastDay : offered ? offered.slice(0, 10) : null,
      shows:
        typeof parsed.shows === 'number' && Number.isFinite(parsed.shows) && parsed.shows >= 0
          ? Math.floor(parsed.shows)
          : offered
            ? 1
            : 0,
      answered: typeof parsed.answered === 'string' ? parsed.answered : null,
      installed: typeof parsed.installed === 'string' ? parsed.installed : null,
      how:
        parsed.how === 'standalone' || parsed.how === 'home-screen' || parsed.how === 'event'
          ? parsed.how
          : null,
      asked: parsed.asked === true,
    };
  } catch {
    return NOTHING;
  }
}

function write(next: InstallRecord): void {
  scoped.setItem(INSTALL_KEY, JSON.stringify(next));
}

/**
 * The card went up. A SHOWING, which is not an answer.
 *
 * It counts one showing per day and stops counting at the budget, so the common cases are both
 * handled without the caller knowing anything: a learner walking between screens is asked once, and
 * a learner who never scrolls to the end of the column still gets another day rather than losing
 * their only chance to a card that was never on their screen.
 */
export function noteOffered(at: string = new Date().toISOString()): void {
  const held = readInstall();
  if (held.answered) return;
  const day = at.slice(0, 10);
  if (held.lastDay === day) return;
  if (held.shows >= INSTALL_SHOWINGS) return;
  write({ ...held, offered: held.offered ?? at, lastDay: day, shows: held.shows + 1 });
}

/**
 * The learner ANSWERED: they took it, or they turned the browser's own dialog down. Either way the
 * offer is over and nothing asks again, which is the half of the law a render could never satisfy.
 *
 * `takePrompt` below calls this for both outcomes, because the dialog is this module's own. The
 * card's "not now" is the arbiter's (`suggest/Suggestions.tsx` writes it to the session ledger, and
 * `suggest/session.ts` is deliberate that a no is *"a session, not a lifetime"*), so a learner who
 * waves this card away is not asked again this session by that ledger, and the showing budget above
 * is what keeps the later sessions quiet. The row that would make a decline permanent is a call to
 * this function from that card, and it belongs with the file that owns the card.
 */
export function noteAnswered(at: string = new Date().toISOString()): void {
  const held = readInstall();
  if (held.answered) return;
  write({ ...held, answered: at });
}

/** The app is installed, and how we know. Recorded once; the first answer stands. */
export function noteInstalled(how: InstalledHow, at: string = new Date().toISOString()): void {
  const held = readInstall();
  if (held.installed) return;
  write({ ...held, installed: at, how });
}

/**
 * THE DOOR BACK. The learner came and asked for it, so the offer opens again with a full budget.
 *
 * It is the learner's own action and the only thing that reopens an answered offer. What it is NOT
 * is the only protection against a card that was never seen: that job belongs to `INSTALL_SHOWINGS`
 * above, and it belongs there precisely because this door has no caller yet. The control that calls
 * this belongs on the You screen beside the other settings rows (`screens/You.tsx`), which is
 * outside this wave's files, so the honest state is that the door exists and nothing opens it. A
 * learner therefore depends on the budget rather than on this, which is why the budget is not one.
 */
export function askAgain(): void {
  const held = readInstall();
  write({ ...held, offered: null, lastDay: null, shows: 0, answered: null, asked: true });
}

// --- what the device already is ---------------------------------------------------------------------

/** Running from a home screen or a window of its own, rather than in a browser tab. */
export function standalone(win: InstallWindow | null = browser()): boolean {
  if (!win) return false;
  // iOS says so on the navigator and answers no media query about it.
  if (win.navigator?.standalone === true) return true;
  if (typeof win.matchMedia !== 'function') return false;
  try {
    return win.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * iOS, where there is no event and the share menu is the only route.
 *
 * Every browser on iOS is the same engine underneath, so this is the platform rather than one app,
 * and the route it names is the same in all of them. An iPad on a recent OS reports itself as a
 * desktop, which is why a touch-capable Mac-shaped agent counts: the cost of being wrong is that a
 * desktop Safari user reads two steps that do not apply, and the cost of missing it is that every
 * iPad learner is never offered the app at all.
 */
export function isIos(win: InstallWindow | null = browser()): boolean {
  const agent = win?.navigator?.userAgent ?? '';
  if (!agent) return false;
  if (/Android/i.test(agent)) return false;
  if (/iPhone|iPad|iPod/i.test(agent)) return true;
  return /Macintosh/i.test(agent) && win?.navigator?.standalone !== undefined;
}

/** The app is installed: seen standalone now, or recorded as installed earlier. */
export function installed(win: InstallWindow | null = browser()): boolean {
  return standalone(win) || readInstall().installed !== null;
}

// --- holding the event ------------------------------------------------------------------------------

let held: InstallPromptEvent | null = null;
let armed = false;

/** The captured event, or null where the browser has not offered one. */
export function heldPrompt(): InstallPromptEvent | null {
  return held;
}

/**
 * WHO IS TOLD WHEN THIS ANSWER CHANGES, and why anything has to be told at all.
 *
 * The browser fires `beforeinstallprompt` ONCE per page load, at a moment of its own choosing, and
 * it owes nobody a warning. So the capture can land at any point: before the frame is on screen,
 * or a second after it. The second case used to be a silent loss of its own — the card reads the
 * gate from the route, the earned moment and the trophies, and the arrival of the event changes
 * none of those, so an offer that became possible a moment late was an offer never made for that
 * whole load. This is the seam that closes it: a count that moves whenever the honest answer to
 * *"is there anything to offer, and by which route"* moves, and a way to be told it did.
 *
 * A count rather than the event itself, because a snapshot has to be cheap to compare and stable
 * between changes, which is what `useSyncExternalStore` asks of one (`suggest/InstallOffer.tsx`).
 */
const listeners = new Set<() => void>();
let generation = 0;

/** The snapshot: a number that moves when the capture does, and never otherwise. */
export function installGeneration(): number {
  return generation;
}

/** Told when the capture changes. Returns the unsubscribe, in the house's own shape. */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function changed(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

/**
 * Catch the event once and keep it, and record an install the moment one happens.
 *
 * Idempotent: React mounts an effect twice in development, the frame remounts on a route change,
 * and two listeners would mean two captures of one event. Returns the way to stop listening, which
 * a test uses and the app never needs, because the frame lives as long as the document does.
 */
export function armInstallCapture(win: InstallWindow | null = browser()): () => void {
  if (!win || armed) return () => undefined;
  armed = true;

  const onPrompt = (event: Event) => {
    // THE LINE THAT TAKES THE BANNER OFF THE PAGE. Without it the browser draws its own, wherever
    // the learner happens to be, which is the thing this whole file exists to replace.
    event.preventDefault();
    held = event as InstallPromptEvent;
    changed();
  };
  const onInstalled = () => {
    held = null;
    noteInstalled('event');
    changed();
  };

  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);

  // A device that is ALREADY installed says so on the first read, so an app opened from its own
  // icon never offers to be installed again, on any account that has not seen the offer.
  if (standalone(win))
    noteInstalled(win.navigator?.standalone === true ? 'home-screen' : 'standalone');

  return () => {
    win.removeEventListener('beforeinstallprompt', onPrompt);
    win.removeEventListener('appinstalled', onInstalled);
    armed = false;
    held = null;
  };
}

/**
 * For tests: forget the held event and the listeners, as a fresh document would. The subscribers go
 * too — a fresh document has none, and a listener left behind by an earlier test would be counted
 * by the next one.
 */
export function forgetCapture(): void {
  held = null;
  armed = false;
  listeners.clear();
}

/**
 * Show the browser's own install dialog, with the event we were holding for exactly this moment.
 * It can only be spent once, so it is dropped afterwards whatever the learner said, and a refusal
 * is recorded as an answer rather than retried.
 */
export async function takePrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = held;
  if (!event) return 'unavailable';
  held = null;
  // Spent. Anything still reading the gate is reading a stale yes until it is told.
  changed();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Taken or turned down, the learner has now answered, and this is the one place in the app
    // that can see them do it. A no here is an answer and is never asked about again.
    noteAnswered();
    if (outcome === 'accepted') noteInstalled('event');
    return outcome;
  } catch {
    return 'unavailable';
  }
}

// --- whether to offer, and by which route -------------------------------------------------------------

/** How this learner could install, or nothing, which is the ordinary answer and needs no words. */
export type InstallRoute = 'prompt' | 'share-sheet';

/**
 * The route, or null. Null is not a failure: a desktop browser that will not install, a device
 * already installed, a browser that never fired the event. There is nothing honest to offer, so
 * nothing is said.
 */
export function routeFor(win: InstallWindow | null = browser()): InstallRoute | null {
  if (installed(win)) return null;
  if (held) return 'prompt';
  return isIos(win) ? 'share-sheet' : null;
}

/** The routes a learner is never offered anything on: the celebration owns the screen there. */
export const IMMERSIVE: ReadonlySet<string> = new Set([
  'course',
  'sandbox',
  'onboarding',
  'building',
  'concept',
]);

export interface OfferCase {
  /** The route the learner is on, by name (`shell/router.tsx`). */
  route: string;
  /** Has this learner had their first earned moment? One mastered topic is the whole of it. */
  earned: boolean;
  /** Is a ceremony already on screen? Two moments at once is neither. */
  celebrating?: boolean;
  win?: InstallWindow | null;
}

/**
 * THE ONE GATE. Every clause is a sentence from a law, and the order is the order they would be
 * argued in: is there anything to offer, is this a moment, and have they already answered.
 */
export function mayOffer(now: OfferCase): InstallRoute | null {
  const win = now.win === undefined ? browser() : now.win;
  const route = routeFor(win);
  if (!route) return null;
  // docs/FEEL.md §3: the offer rides in after an earned moment, never in front of one.
  if (!now.earned) return null;
  if (now.celebrating) return null;
  if (IMMERSIVE.has(now.route)) return null;
  // docs/SUGGESTIONS-AND-NOTICES.md §2. Answered is answered, for good. Unanswered spends one day
  // of a small budget at a time, so the offer can be missed without being lost.
  const record = readInstall();
  if (record.answered) return null;
  if (record.shows >= INSTALL_SHOWINGS) return null;
  return route;
}

// --- what the console may read --------------------------------------------------------------------

/**
 * INSTALLED, AS A READING (docs/CONSOLE-ROLES-AND-BOARD.md, and the honesty test in
 * `src/admin/honesty.test.ts`).
 *
 * *"No panel may show a number it cannot source."* So this hands back a FACT and its provenance and
 * does no arithmetic of any kind: no rate, no share of devices, no count. A console that wants
 * "how many learners run it installed" sums its own rows in its own one place (`admin/readings.ts`),
 * from something that was reported; it never receives a figure this client worked out, because a
 * second place that sums is how two panels come to disagree.
 *
 * WHAT IS NOT BUILT, AND IS NOT PRETENDED. Nothing carries this to the gateway yet: there is no
 * `/v1` route that takes it and no panel that shows it, and both are outside this wave's files. The
 * honest state is that the fact exists, shaped for the desk, and the desk has no supplier for it.
 */
export interface InstalledReading {
  installed: boolean;
  how: InstalledHow | null;
  /** When it was first seen installed, ISO, or null. */
  at: string | null;
  /** Chaseable in words, the way every panel's provenance is. */
  source: string;
}

export const INSTALLED_SOURCE =
  'apps/web-pwa/src/shell/install.ts — display-mode: standalone and the appinstalled event, on the device';

export function installedReading(win: InstallWindow | null = browser()): InstalledReading {
  const record = readInstall();
  const live = standalone(win);
  return {
    installed: live || record.installed !== null,
    how: record.how ?? (live ? 'standalone' : null),
    at: record.installed,
    source: INSTALLED_SOURCE,
  };
}
