/**
 * THE INSTALL PROMPT IS OURS TO PLACE, AND IT IS PLACED WHERE THE LAWS SAY.
 *
 * Four things could go wrong here and each one is a clause of a law rather than a matter of taste,
 * so each one is a test:
 *
 *   1. The browser draws its own banner, on a landing page, at a stranger's first paint
 *      (docs/PLATFORMS.md §5: the install prompt belongs in the right PLACE).
 *   2. It is asked for before the learner has been given anything (docs/FEEL.md §3, REWARDS §3).
 *   3. It comes back after a no, or it is spent by a card the learner never reached
 *      (docs/SUGGESTIONS-AND-NOTICES.md §2: declining is free, and a suggestion declined is not
 *      offered again that session). An offer is spent by an ANSWER, never by a render.
 *   4. It offers a button on iOS, where no such button can exist, and a learner taps nothing.
 *
 * There is no browser in this suite, so the window is a seam and the storage is a stand-in, exactly
 * as `store/isolation.test.ts` does it. The card is rendered to static markup and read as markup.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// --- a storage stand-in, installed before anything reads it -----------------------------------------

class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const store = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = store;

const {
  INSTALLED_SOURCE,
  INSTALL_KEY,
  INSTALL_SHOWINGS,
  armInstallCapture,
  askAgain,
  forgetCapture,
  heldPrompt,
  installed,
  installedReading,
  installGeneration,
  isIos,
  mayOffer,
  onInstallChange,
  noteAnswered,
  noteInstalled,
  noteOffered,
  readInstall,
  routeFor,
  standalone,
  takePrompt,
} = await import('./install');
const { INSTALL_COPY, InstallCard, installSuggestion } = await import('../suggest/InstallOffer');
const { SCOPED_KEYS } = await import('../store/scope');

// --- the window seam ---------------------------------------------------------------------------------

interface Listeners {
  [type: string]: ((event: Event) => void)[];
}

function fakeWindow(opts: { display?: string; standalone?: boolean; agent?: string } = {}) {
  const listeners: Listeners = {};
  return {
    listeners,
    fire(type: string, event: Event) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
    addEventListener(type: string, fn: (event: Event) => void) {
      const held = listeners[type] ?? [];
      held.push(fn);
      listeners[type] = held;
    },
    removeEventListener(type: string, fn: (event: Event) => void) {
      listeners[type] = (listeners[type] ?? []).filter((held) => held !== fn);
    },
    matchMedia: (query: string) => ({ matches: query.includes(opts.display ?? 'never-matches') }),
    navigator: {
      ...(opts.standalone === undefined ? {} : { standalone: opts.standalone }),
      userAgent: opts.agent ?? 'Mozilla/5.0 (Linux; Android 11) Chrome/120',
    },
  };
}

/** A real, cancellable Event, so `preventDefault` is genuinely proved rather than counted. */
function promptEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<unknown>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    prompted: boolean;
  };
  event.prompted = false;
  event.prompt = async () => {
    event.prompted = true;
  };
  event.userChoice = Promise.resolve({ outcome: 'accepted' as const });
  return event;
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/605.1';

beforeEach(() => {
  store.clear();
  forgetCapture();
});

// --- 1. the browser never draws its own -----------------------------------------------------------

describe('the browser’s own banner never appears, because the event is caught and held', () => {
  it('prevents the default and keeps the event for later', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    const event = promptEvent();
    win.fire('beforeinstallprompt', event);

    expect(event.defaultPrevented).toBe(true);
    expect(heldPrompt()).toBe(event);
  });

  it('arms once, however many times it is asked to, so one event is never caught twice', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    armInstallCapture(win);
    armInstallCapture(win);
    expect(win.listeners.beforeinstallprompt?.length).toBe(1);
    expect(win.listeners.appinstalled?.length).toBe(1);
  });

  it('records an install the moment one happens, and lets the spent event go', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    win.fire('beforeinstallprompt', promptEvent());
    win.fire('appinstalled', new Event('appinstalled'));

    expect(heldPrompt()).toBeNull();
    expect(readInstall().installed).not.toBeNull();
    expect(readInstall().how).toBe('event');
  });

  it('knows an app opened from its own icon, by the display mode and by iOS’s own answer', () => {
    expect(standalone(fakeWindow({ display: 'display-mode: standalone' }))).toBe(true);
    expect(standalone(fakeWindow({ standalone: true }))).toBe(true);
    expect(standalone(fakeWindow())).toBe(false);
  });

  it('takes a device that is already installed as installed, with no offer left to make', () => {
    const win = fakeWindow({ display: 'display-mode: standalone' });
    armInstallCapture(win);
    expect(installed(win)).toBe(true);
    expect(routeFor(win)).toBeNull();
  });

  it('prevents the default where it is armed, and claims nothing about where it is not', () => {
    const behindTheDoor = fakeWindow();
    armInstallCapture(behindTheDoor);
    const caught = promptEvent();
    behindTheDoor.fire('beforeinstallprompt', caught);
    expect(caught.defaultPrevented).toBe(true);

    // And the seam's own boundary: a window nothing has armed never SEES the event, so it never
    // prevents it either. That is a fact about this module held in isolation, and it is no longer
    // a fact about the product — the capture is armed at the shared entry (`src/main.tsx`), so
    // every surface the app serves, the public pages included, has a listener before the first
    // chunk is even fetched. The tests for that are in section 5 below.
    forgetCapture();
    const publicPage = fakeWindow();
    const loose = promptEvent();
    publicPage.fire('beforeinstallprompt', loose);
    expect(loose.defaultPrevented).toBe(false);
    expect(heldPrompt()).toBeNull();
  });
});

// --- 2. never before the learner has been given something -------------------------------------------

describe('the offer rides in after an earned moment, and never in front of one', () => {
  function armed() {
    const win = fakeWindow();
    armInstallCapture(win);
    win.fire('beforeinstallprompt', promptEvent());
    return win;
  }

  it('says nothing at all until one topic is mastered', () => {
    const win = armed();
    expect(mayOffer({ route: 'home', earned: false, win })).toBeNull();
    expect(mayOffer({ route: 'home', earned: true, win })).toBe('prompt');
  });

  it('stands aside while a ceremony is on screen, because two moments at once is neither', () => {
    const win = armed();
    expect(mayOffer({ route: 'home', earned: true, celebrating: true, win })).toBeNull();
  });

  it('never interrupts a lesson, a sandbox, onboarding or a course being built', () => {
    const win = armed();
    for (const route of ['course', 'sandbox', 'onboarding', 'building', 'concept']) {
      expect(mayOffer({ route, earned: true, win })).toBeNull();
    }
    for (const route of ['home', 'learn', 'practice', 'you', 'progress']) {
      expect(mayOffer({ route, earned: true, win })).toBe('prompt');
    }
  });

  it('offers nothing where there is no honest route to offer', () => {
    // A desktop browser that fired no event and is not iOS: silence, not a set of instructions.
    const win = fakeWindow();
    armInstallCapture(win);
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
  });
});

// --- 3. answered once, and never spent by a card nobody reached --------------------------------------

describe('an offer is spent by an answer, and never by a render', () => {
  function armed() {
    const win = fakeWindow();
    armInstallCapture(win);
    win.fire('beforeinstallprompt', promptEvent());
    return win;
  }

  it('still stands after the card has merely gone up, because a render is not an answer', () => {
    const win = armed();
    expect(mayOffer({ route: 'home', earned: true, win })).toBe('prompt');
    noteOffered('2026-09-16T10:00:00.000Z');
    // The card goes up at the END of the main column, under the screen's own content. Nothing
    // here knows the learner ever scrolled to it, so nothing here may charge them for it.
    expect(mayOffer({ route: 'home', earned: true, win })).toBe('prompt');
  });

  it('counts two showings on one day as the one showing they are', () => {
    noteOffered('2026-09-16T10:00:00.000Z');
    noteOffered('2026-09-16T21:30:00.000Z');
    // A route change remounts the card. That is the same offer, not a second chance spent.
    expect(readInstall().shows).toBe(1);
    expect(readInstall().offered).toBe('2026-09-16T10:00:00.000Z');
  });

  it('goes up on a few separate days, and then is silent for good', () => {
    const win = armed();
    for (let day = 0; day < INSTALL_SHOWINGS; day += 1) {
      expect(mayOffer({ route: 'home', earned: true, win })).toBe('prompt');
      noteOffered(`2026-09-${16 + day}T10:00:00.000Z`);
    }
    expect(readInstall().shows).toBe(INSTALL_SHOWINGS);
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
  });

  it('stops the moment the learner answers, however many showings were left', () => {
    const win = armed();
    noteOffered('2026-09-16T10:00:00.000Z');
    noteAnswered('2026-09-16T10:00:05.000Z');
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
    // A later day does not reopen it. An answer is an answer.
    noteOffered('2026-09-17T10:00:00.000Z');
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
  });

  it('takes the browser dialog’s own no as the answer it is', async () => {
    const win = fakeWindow();
    armInstallCapture(win);
    const event = promptEvent();
    event.userChoice = Promise.resolve({ outcome: 'dismissed' as const });
    win.fire('beforeinstallprompt', event);

    expect(await takePrompt()).toBe('dismissed');
    expect(readInstall().answered).not.toBeNull();
    expect(readInstall().installed).toBeNull();
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
  });

  it('opens once more only when the learner asks for it themselves', () => {
    const win = armed();
    noteOffered('2026-09-16T10:00:00.000Z');
    noteAnswered('2026-09-16T10:00:05.000Z');
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
    askAgain();
    expect(mayOffer({ route: 'home', earned: true, win })).toBe('prompt');
    expect(readInstall().asked).toBe(true);
    expect(readInstall().shows).toBe(0);
  });

  it('carries a record written by the older rule forward as the one showing it was', () => {
    store.setItem(
      INSTALL_KEY,
      JSON.stringify({ offered: '2026-09-01T10:00:00.000Z', installed: null, how: null }),
    );
    expect(readInstall().shows).toBe(1);
    expect(readInstall().answered).toBeNull();
  });

  it('is one learner’s, so signing out takes it with them', () => {
    expect([...SCOPED_KEYS]).toContain(INSTALL_KEY);
  });

  it('survives a storage that holds nonsense, and offers rather than throwing', () => {
    store.setItem(INSTALL_KEY, '{ not json');
    expect(() => readInstall()).not.toThrow();
    expect(readInstall().offered).toBeNull();
  });
});

describe('the held event is spent once, and an accepted install is recorded', () => {
  it('prompts, reads the answer, and records the install', async () => {
    const win = fakeWindow();
    armInstallCapture(win);
    const event = promptEvent();
    win.fire('beforeinstallprompt', event);

    expect(await takePrompt()).toBe('accepted');
    expect(event.prompted).toBe(true);
    expect(readInstall().installed).not.toBeNull();
    // Spent: an event may be used once, so a second tap must not pretend it can be used again.
    expect(heldPrompt()).toBeNull();
    expect(await takePrompt()).toBe('unavailable');
  });
});

// --- 4. iOS, where no button could work -------------------------------------------------------------

describe('on iOS the same moment offers the route that exists there', () => {
  it('knows iOS, including an iPad that calls itself a desktop, and is not fooled by Android', () => {
    expect(isIos(fakeWindow({ agent: IPHONE }))).toBe(true);
    expect(isIos(fakeWindow({ agent: 'Mozilla/5.0 (Macintosh)', standalone: false }))).toBe(true);
    expect(isIos(fakeWindow())).toBe(false);
    expect(isIos(fakeWindow({ agent: 'Mozilla/5.0 (Macintosh) Chrome/120' }))).toBe(false);
  });

  it('offers the share-sheet route where there is no event to hold', () => {
    const win = fakeWindow({ agent: IPHONE, standalone: false });
    armInstallCapture(win);
    expect(mayOffer({ route: 'home', earned: true, win })).toBe('share-sheet');
  });

  it('offers nothing to an iPhone that already has it on the home screen', () => {
    const win = fakeWindow({ agent: IPHONE, standalone: true });
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
  });

  it('draws the two steps, and draws them rather than photographing them', () => {
    const html = renderToStaticMarkup(createElement(InstallCard, { route: 'share-sheet' }));
    expect(html).toContain(INSTALL_COPY.stepOne);
    expect(html).toContain(INSTALL_COPY.stepTwo);
    expect(html).toContain('<svg');
    // A screenshot is the wrong size on this phone, the wrong theme at night, and stale on the
    // next OS release. Nothing here is an image of somebody else's screen.
    expect(html).not.toContain('<img');
    // And no button that could not work: on iOS the learner performs the two steps themselves.
    expect(html).not.toContain('data-testid="install-take"');
  });

  it('gives the tappable route a real control, and the brand’s tap floor', () => {
    const html = renderToStaticMarkup(createElement(InstallCard, { route: 'prompt' }));
    expect(html).toContain('data-testid="install-take"');
    expect(html).toContain(INSTALL_COPY.action);
    expect(html).toContain('min-height:44px');
  });
});

// --- the register it belongs to, and the words it says ------------------------------------------------

const SRC = resolve(import.meta.dir, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');
const MODULE = read('shell', 'install.ts');
const CARD = read('suggest', 'InstallOffer.tsx');
const FRAME = read('shell', 'AppFrame.tsx');
const ENTRY = read('main.tsx');
const ROOT = read('App.tsx');

describe('it is a suggestion of the side door kind, held by the one arbiter', () => {
  it('is offered in the side door’s register: optional, and nothing is lost by declining', () => {
    const offer = installSuggestion();
    expect(offer.kind).toBe('side_door');
    expect(offer.decline.length).toBeGreaterThan(0);
    expect(offer.note).toBe(INSTALL_COPY.note);
    // No route of its own: it opens the browser's dialog or it draws two steps, never a page.
    expect(offer.target).toBeNull();
  });

  it('goes through the host that keeps at most one suggestion on screen', () => {
    expect(CARD).toContain('<Suggestions');
    expect(CARD).toContain('slotFor=');
  });

  it('paints only from the quiet sheet, so it is never the loudest thing on the page', () => {
    expect(CARD).toContain("from './quiet'");
    // The pointer colour belongs to the primary thing on the screen, and this is never it.
    expect(CARD).not.toContain('var(--pig)');
  });
});

describe('it is mounted behind the door and nowhere else', () => {
  it('is mounted by the app frame, which no public page, door or onboarding renders', () => {
    expect(FRAME).toContain('<InstallOffer />');
  });

  it('is imported by the frame alone, so no public surface can grow one', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        if (/from '[^']*InstallOffer'/.test(readFileSync(path, 'utf8'))) {
          importers.push(relative(SRC, path));
        }
      }
    };
    walk(SRC);
    expect(importers).toEqual(['shell/AppFrame.tsx']);
  });

  it('asks for no notification permission and subscribes to no push, which is held last by law', () => {
    for (const source of [MODULE, CARD]) {
      expect(source).not.toContain('requestPermission');
      expect(source).not.toContain('pushManager');
      expect(source).not.toContain('new Notification');
      expect(source).not.toContain('serviceWorker.register');
    }
  });
});

describe('the words a learner reads', () => {
  const WORDS = Object.values(INSTALL_COPY);

  it('carries no exclamation mark, no emoji and no em dash', () => {
    for (const line of WORDS) {
      expect(line).not.toContain('!');
      expect(line).not.toContain('—');
      expect(line, line).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('is sentence case, never title case', () => {
    // Sentence case means: the first word carries the capital, and after it only a proper noun
    // does (docs/copy/voice.md §3). "Add to Home Screen" is exempt because it is not our sentence
    // at all — it is the name of the device's own control, and a learner has to match it by eye.
    for (const line of WORDS.filter((w) => w !== INSTALL_COPY.stepTwo)) {
      const afterTheFirst = line.split(' ').slice(1);
      const capitalised = afterTheFirst.filter(
        (word) => /^[A-Z]/.test(word) && !word.startsWith('Wobo'),
      );
      expect(capitalised, line).toEqual([]);
    }
  });

  it('never describes the software, announces an action, or names what is underneath', () => {
    for (const line of WORDS) {
      expect(line).not.toMatch(/\b(I'll|I will|Let me|Wobo is (drawing|thinking))\b/);
      expect(line).not.toMatch(/\b(Safari|Chrome|Apple|Google|Android|iOS|PWA|browser app)\b/);
    }
  });

  it('promises nothing the product does not do', () => {
    // No offline claim, no speed claim, no notification claim: the one reason given is the one
    // that is true of both routes and true today.
    for (const line of WORDS) {
      expect(line.toLowerCase()).not.toContain('offline');
      expect(line.toLowerCase()).not.toContain('faster');
      expect(line.toLowerCase()).not.toContain('notification');
    }
  });
});

describe('what the console may read, and what it may not', () => {
  it('hands back a fact with its provenance, and no arithmetic of any kind', () => {
    const reading = installedReading(fakeWindow({ display: 'display-mode: standalone' }));
    expect(reading.installed).toBe(true);
    expect(reading.source).toBe(INSTALLED_SOURCE);
    expect(reading.source.length).toBeGreaterThan(12);
  });

  it('says not installed rather than nothing, which are different facts', () => {
    const reading = installedReading(fakeWindow());
    expect(reading.installed).toBe(false);
    expect(reading.at).toBeNull();
    expect(reading.how).toBeNull();
  });

  it('carries the recorded moment once there is one', () => {
    noteInstalled('home-screen', '2026-09-16T09:00:00.000Z');
    const reading = installedReading(fakeWindow());
    expect(reading.at).toBe('2026-09-16T09:00:00.000Z');
    expect(reading.how).toBe('home-screen');
  });

  it('works out no rate, no share and no count in the client', () => {
    const shipped = MODULE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(shipped).not.toContain('.reduce(');
    expect(shipped).not.toMatch(/\bpercent\b|\* 100\b|\/ total\b/);
  });
});

// --- 5. the listener exists before the app does -------------------------------------------------------

/**
 * THE EVENT IS FIRED ONCE AND IT IS NEVER REPEATED, which makes WHERE we start listening a
 * correctness question rather than a tidiness one.
 *
 * The listener used to be armed in an effect inside `suggest/InstallOffer`, which the app frame
 * mounts — and the frame is behind `App.tsx`'s `lazy(() => import('./AppRuntime'))`. On the cheap
 * Android phone this offer exists for, the first interactive frame was measured at 33.9 seconds, so
 * Chromium had whole seconds in which to fire into a room with nobody in it. `routeFor()` then
 * answers null for that entire load and the Android learner is offered nothing, silently.
 *
 * It is the ordinary case rather than a corner. The offer is only ever made to a learner who has
 * already mastered a topic, which makes them a RETURNING visitor, whose worker and manifest are
 * already on the device — precisely the visit on which the browser can fire earliest.
 */
describe('the capture is armed by the entry, because the frame is seconds too late', () => {
  it('is armed in main.tsx, the one module that runs before any lazy chunk is fetched', () => {
    expect(ENTRY).toContain("from './shell/install'");
    expect(ENTRY).toMatch(/^armInstallCapture\(\);$/m);
  });

  it('arms it after the device is keyed to its learner, so an install is recorded under them', () => {
    const keyed = ENTRY.indexOf('bootScope();');
    const arm = ENTRY.indexOf('armInstallCapture();');
    expect(keyed).toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(keyed);
  });

  it('does not depend on the frame, which arrives in a chunk of its own', () => {
    // The reason the entry has to do it: the runtime — and so the frame, and so the old listener —
    // is fetched separately. Anything armed only in there is armed after the event may have fired.
    expect(ROOT).toContain("import('./AppRuntime')");
    expect(ROOT).toContain('lazy(');
  });

  it('asks for no permission and subscribes to nothing by being early', () => {
    // Being at the entry must not turn into arriving and prompting: push is held last by law.
    const line = ENTRY.slice(ENTRY.indexOf('armInstallCapture();'));
    expect(line).not.toContain('requestPermission');
    expect(line).not.toContain('pushManager');
  });
});

// --- 6. a capture that lands late still reaches the screen ---------------------------------------------

/**
 * The other end of the same defect. Arming early stops the event being MISSED; this stops it being
 * missed by the screen. `mayOffer` is read from the route, the earned moment and the trophies, and
 * the arrival of the event changes none of those — so an event that landed a moment after the frame
 * painted was an offer never made for the whole of that load.
 */
describe('a capture that lands after the screen is up still reaches it', () => {
  it('tells whoever is listening when the browser finally hands the event over', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    let told = 0;
    const stop = onInstallChange(() => {
      told += 1;
    });
    const before = installGeneration();
    win.fire('beforeinstallprompt', promptEvent());
    expect(told).toBe(1);
    expect(installGeneration()).toBeGreaterThan(before);
    stop();
  });

  it('turns a silent load into an offer: nothing to give, then the event, then the route', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    // Android, no event yet. The honest answer is nothing at all, and it is not the final one.
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
    let told = 0;
    const stop = onInstallChange(() => {
      told += 1;
    });
    win.fire('beforeinstallprompt', promptEvent());
    expect(told).toBe(1);
    expect(mayOffer({ route: 'home', earned: true, win })).toBe('prompt');
    stop();
  });

  it('tells them when the app is installed, so a stale offer falls away', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    win.fire('beforeinstallprompt', promptEvent());
    let told = 0;
    const stop = onInstallChange(() => {
      told += 1;
    });
    win.fire('appinstalled', new Event('appinstalled'));
    expect(told).toBe(1);
    expect(mayOffer({ route: 'home', earned: true, win })).toBeNull();
    stop();
  });

  it('tells them when the held event is spent, so nothing keeps offering a used one', async () => {
    const win = fakeWindow();
    armInstallCapture(win);
    win.fire('beforeinstallprompt', promptEvent());
    let told = 0;
    const stop = onInstallChange(() => {
      told += 1;
    });
    await takePrompt();
    expect(told).toBeGreaterThanOrEqual(1);
    stop();
  });

  it('stops telling a listener that has gone', () => {
    const win = fakeWindow();
    armInstallCapture(win);
    let told = 0;
    onInstallChange(() => {
      told += 1;
    })();
    win.fire('beforeinstallprompt', promptEvent());
    expect(told).toBe(0);
  });

  it('is subscribed to by the card, which would otherwise render the stale answer', () => {
    expect(CARD).toContain('onInstallChange');
    expect(CARD).toContain('useSyncExternalStore');
  });
});

// --- 7. where the offer actually landed in the build --------------------------------------------------

/**
 * THE PLACEMENT CLAIM, MEASURED RATHER THAN TRANSCRIBED.
 *
 * Everything above this line reads source. The claim that finally matters is about the BUILD: the
 * card must travel in the frame's own chunk, so a stranger who opens a public address is never sent
 * the bytes of an offer they cannot be shown. Source can only suggest that. `dist` settles it.
 *
 * It was settled once by hand, and the reading named the chunks by their hashed filenames. Rollup
 * rehashes on every build, so that evidence expired the same day it was written while the claim it
 * supported stayed true: three separate readings of this one fact have now named three different
 * files (`AppFrame-CplasC7p.js`, then `AppFrame-BjRinxix.js`, then `AppFrame-BaOIlQtp.js`). A fact
 * worth reading three times is worth a test, so nothing below names a hash. The chunks the app
 * actually loads are read out of the HTML that loads them, the carrying chunk is found by its
 * contents, and every assertion is about WHICH chunk rather than about which build.
 *
 * It skips when nothing has been built, exactly as `test/no-workshop-bench-ships.test.ts` and
 * `test/prerender.test.ts` do: `bun run test` runs before `bun run build` in the gate, and a
 * skipped read is honest where an invented one is not.
 */
const DIST = resolve(SRC, '..', 'dist');
const ASSETS = join(DIST, 'assets');

/** Every HTML file the build wrote, at whatever depth the pre-render put it. */
function htmlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...htmlFiles(path));
      continue;
    }
    if (entry.endsWith('.html')) found.push(path);
  }
  return found;
}

/**
 * The marks the card leaves in a bundle: the words a learner reads, and the two test ids. They are
 * matched as plain strings because that is what survives minification; the JSX attribute spelling
 * does not.
 */
const MARKS = [INSTALL_COPY.title, INSTALL_COPY.stepTwo, 'install-offer', 'install-take'];

describe('the built offer travels in the frame’s chunk and reaches no public page', () => {
  const built = existsSync(ASSETS) && existsSync(join(DIST, 'index.html'));
  const chunks = built ? readdirSync(ASSETS).filter((name) => name.endsWith('.js')) : [];
  const text = new Map(chunks.map((name) => [name, readFileSync(join(ASSETS, name), 'utf8')]));

  it.skipIf(!built)('was read from a real build, so nothing below passes by being empty', () => {
    expect(chunks.length).toBeGreaterThan(50);
    expect(htmlFiles(DIST).length).toBeGreaterThan(0);
  });

  it.skipIf(!built)('puts every mark of the card in one chunk, and it is the frame’s', () => {
    for (const mark of MARKS) {
      const found = chunks.filter((name) => (text.get(name) ?? '').includes(mark));
      // Rollup names a chunk after the module it was split at, so the assertion is about the frame
      // and never about a hash: whatever the build calls it today, the offer rides behind the door.
      // Comparing the carriers to the frame chunks among them names the stray one when there is
      // one, instead of only reporting a count that does not say what went wrong.
      expect([mark, found]).toEqual([mark, found.filter((name) => /^AppFrame-/.test(name))]);
      expect([mark, found.length]).toEqual([mark, 1]);
    }
  });

  it.skipIf(!built)('keeps it out of every chunk the HTML itself loads', () => {
    // The entry is fetched by every visitor, a stranger on a public address included. If the card
    // were in there it would ship to people who can never be offered it, on the slow link this
    // standard is measured on (docs/PLATFORMS.md §5, §6).
    const loaded = new Set<string>();
    for (const file of htmlFiles(DIST)) {
      for (const hit of readFileSync(file, 'utf8').matchAll(/assets\/([A-Za-z0-9_-]+\.js)/g)) {
        if (text.has(hit[1] ?? '')) loaded.add(hit[1] ?? '');
      }
    }
    expect(loaded.size).toBeGreaterThan(0);
    for (const name of loaded) {
      for (const mark of MARKS) {
        expect([name, mark, (text.get(name) ?? '').includes(mark)]).toEqual([name, mark, false]);
      }
    }
  });

  it.skipIf(!built)('is written into no page, so no first paint can carry it', () => {
    for (const file of htmlFiles(DIST)) {
      const where = relative(DIST, file);
      const html = readFileSync(file, 'utf8');
      for (const mark of MARKS) {
        expect([where, mark, html.includes(mark)]).toEqual([where, mark, false]);
      }
    }
  });
});
