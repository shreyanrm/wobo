/**
 * THE COLD START ON A CHEAP ANDROID PHONE.
 *
 * The owner's standard (docs/PLATFORMS.md §5, §6): the web version has to be something a child
 * keeps, walked end to end on a real phone before any store build begins, and "a fast cold start on
 * a cheap Android phone" is named there as web work that must happen anyway. This is the stopwatch
 * for it, and it exists so that a change which quietly puts the number back is caught by a test
 * rather than by a learner.
 *
 * WHAT IS MEASURED, and why each number is the one that matters:
 *
 *   1. **time to first paint** — when the phone stops showing a blank page. Read from the browser's
 *      own PerformancePaintTiming, not from a screenshot.
 *   2. **time to the first interactive lesson frame** — when the lesson's own action is on screen
 *      and the learner can begin. This is the number a child feels; first paint only ends the blank
 *      page. It is stamped by a MutationObserver installed before the app's first byte runs, so it
 *      is the browser's clock rather than a test runner's polling interval.
 *   3. **the JS shipped on the lesson route** — every script actually fetched, over the wire and
 *      decoded, counted up to the instant that frame arrives. Bytes that land afterwards are not
 *      what the learner waited for, and are reported separately rather than folded in.
 *
 * THE MACHINE. The profile the brief names: a 390-wide phone, Chromium's CPU throttling at 4x, and
 * DevTools' own Slow 3G. Cold cache and cold storage every time (a fresh context per test), because
 * the first visit is the one that decides whether there is a second.
 *
 * AND IT IS THE BUILT SITE, served through `vercel.json`'s own rewrite table
 * (tests/cold-start-server.ts). In dev there is no chunking, no minification and no precache, so a
 * number taken there describes a machine nobody owns.
 *
 * A LAB IS SILENT (the owner, 2026-09-09): the browser is launched muted by
 * tests/cold-start.config.ts, and nothing here asks for a voice.
 *
 * WHICH BUILD IS VALID TO MEASURE, and it is not the ordinary one. A production build has its
 * doors closed (docs/DOORS-CLOSED.md) and `devAuth` off, so `AppRuntime`'s lock
 * (`!devAuth && !isAuthenticated()`) answers every app address with the invitation to the list:
 * there is no lesson on the other side and nothing to time. The measurement build is the same
 * hermetic shape every other suite here uses, and it is built into a directory of its own, because
 * `dist` is rewritten by any other build running in this tree and a run of this suite takes
 * minutes.
 *
 * Run it:
 *     cd apps/web-pwa
 *     VITE_LLM_MODE=mock VITE_GATEWAY_URL= VITE_DEV_AUTH=true VITE_PERSIST_MODE=local \
 *       VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_SUPABASE_DEV_JWT= \
 *       bunx vite build --outDir /tmp/cold-dist --emptyOutDir
 *     WOBO_COLD_DIST=/tmp/cold-dist bunx playwright test --config tests/cold-start.config.ts
 *
 * Nothing else may run on the machine while it does: the profile is a 4x CPU throttle, and a build
 * beside it is measured as if it were the product.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { ATOM_WORLD } from './helpers/brain';

const APP = fileURLToPath(new URL('..', import.meta.url));

/**
 * The build under measurement. `dist` is shared mutable state — any other build in this tree
 * rewrites it, and one run of this spec had its bytes replaced halfway through by a build that
 * landed beside it, which is how a lesson that had rendered a minute earlier came back as the
 * closed door. `WOBO_COLD_DIST` lets the measurement own a directory nobody else writes to; the
 * server (tests/cold-start-server.ts) reads the same variable, so both read the same bytes.
 */
const DIST = process.env.WOBO_COLD_DIST
  ? (process.env.WOBO_COLD_DIST.startsWith('/')
      ? process.env.WOBO_COLD_DIST
      : join(APP, process.env.WOBO_COLD_DIST))
  : join(APP, 'dist');

// --- the machine the law names -------------------------------------------------------------------

/** The same 4x the frame-rate and board-latency specs use, so one phone is described everywhere. */
const CPU_THROTTLE = 4;

/**
 * Chrome DevTools' "Slow 3G" preset, verbatim: 500 kbit/s each way with DevTools' own 0.8
 * throughput factor (50 kB/s), and a 400 ms round trip multiplied by DevTools' 5x factor. Written
 * out rather than named because CDP has no named profiles.
 */
const SLOW_3G = {
  offline: false,
  downloadThroughput: ((500 * 1000) / 8) * 0.8,
  uploadThroughput: ((500 * 1000) / 8) * 0.8,
  latency: 400 * 5,
};

// --- the budget ----------------------------------------------------------------------------------

/**
 * THE BUDGET A CHILD ON A TWO-YEAR-OLD 2 GB PHONE CAN LIVE WITH.
 *
 * These are not aspirations; they are what this build actually does, with enough headroom that
 * ordinary work does not trip them and a regression of any size does. Raising one is a decision
 * somebody makes on purpose, in a commit that says why, rather than a number that drifts.
 */
const BUDGET = {
  /** The blank page ends. */
  firstPaintMs: 5_000,
  /** The lesson's own action is on screen and the learner can begin. */
  lessonFrameMs: 20_000,
  /** Script bytes over the wire, up to that frame. The one number that drives the other two. */
  lessonWireJsKb: 450,
  /** What a first visit downloads before it has opened anything: the precache. */
  precacheKb: 1_800,
};

/**
 * WHERE THIS BUILD ACTUALLY STANDS, measured 2026-09-16 on the profile above, so the gap is a
 * number rather than an impression. The budget above is NOT what the product does today; it is
 * what a child on a two-year-old 2 GB phone can live with, and this suite is red until it is met.
 * The law is kept and the machine is what changes, exactly as `board-latency-throttled.spec.ts`
 * keeps BOARD.md's second on a phone that cannot yet manage it.
 *
 *   first paint                     33 792 ms
 *   first interactive lesson frame  33 893 ms
 *   JS on the lesson route          1 195 kB over the wire, 1 924 kB decoded, 50 files
 *   service worker precache         4 696 kB in 173 files
 *
 * THE FOUR CAUSES, each found by this suite and each fixable without changing what any screen
 * looks like:
 *
 *  1. **Nothing paints until the whole app has booted.** First paint and the lesson frame are 100 ms
 *     apart: the shell carries no contentful markup at all, and the boot scene that WOULD paint is
 *     itself behind a dynamic import (`main.tsx` fetches `screens/states/Scene`), so a slow link
 *     shows a blank page for the entire download. A first paint that does not wait on a chunk is
 *     the single biggest number here.
 *  2. **The lesson route pays for every engine.** `screens/Course.tsx` imports `./course/Composing`
 *     statically, and `Composing` imports some twenty-five engines the same way, so `mathscene`
 *     (334 kB) and `WordProblemBreakdown` (135 kB) are static dependencies of every lesson —
 *     including the atom course, which renders neither. `Composing` is only ever mounted when
 *     `mode === 'composing'`, so it is a `lazy()` away from being paid for only when it is used.
 *  3. **First paint is so late that the deliberate prefetch lands inside it.** This cause was
 *     written here as "the public site carries Wobo's hand", blaming a barrel import in
 *     `screens/states/StateHost.tsx`. That mechanism is not real and the correction is kept rather
 *     than quietly deleted, because the wrong version was written as measured and somebody would
 *     have gone looking for a leak that is not there. Read off the built graph of a hermetic
 *     build: the landing's own closure is 10 files and 485 kB, and it reaches none of
 *     `wobo-board`, `wobo-answers` or `zod`. `StateHost.tsx` does not import the barrel at all, it
 *     imports `../../wobo/board-notes`, which does; `screens/states/Scene.tsx` DOES import the
 *     barrel, for `WaitScene` and `WoboLoader`, and Rollup tree-shakes it, so that chunk is 19 kB
 *     and its whole closure is `Scene WoboBody motion-kit react wordmark`. The `handoff` chunk
 *     that carries `zod` is not on the landing either; the landing's `handoffs` is a different
 *     5 kB module.
 *
 *     What actually happens is a consequence of cause 1. A measurement build has no pre-render,
 *     so nothing paints until the app has booted, and first paint is 20 to 34 seconds out.
 *     `App.tsx` deliberately prefetches the runtime on a 4 second idle timer, so `AppRuntime` is
 *     requested around 15 s, and its static closure (24 files, 1 190 kB) reaches `wobo-board`,
 *     `wobo-answers`, `zod` and `StateHost`. Every one of them is initiated by Vite's preload
 *     helper, which is the prefetch, not a dependency of the landing. So "before first paint"
 *     never excluded the prefetch the way the comment below it claimed; it only appeared to,
 *     against a pre-rendered `dist`, where first paint is immediate. Measured both ways, the same
 *     assertion passed against `dist` and failed against the build this file's own header
 *     prescribes. The landing test below is anchored to the prefetch instead, so its verdict is
 *     about the site rather than about which build it was pointed at.
 *  4. **The precache is most of a megabyte of things a first visit will never open**, the largest
 *     single entry being the engine gallery (486 kB), which is reachable only at `/concept/engines`
 *     and is a QA surface.
 */

// --- the lesson a cold phone opens ---------------------------------------------------------------

/**
 * The atom's own course, reached by its address the way a mail link or a bookmark reaches it
 * (docs/EMAILS-AND-ANIMATIONS.md §4). Nothing is walked to: a cold start is a cold start.
 */
const LESSON = '/course/m2-1';
const UNIT_ID = 'm2';
const TOPIC_ID = 'm2-1';

/**
 * The syllabus this phone already holds, written into the offline cache the way the app itself
 * writes it (`src/curriculum/cache.ts`), in the PARSED shape the cache stores — not the wire shape.
 *
 * This is what makes the measurement honest with no network at all: the app's own `warmFromCache`
 * reads these three keys, the registry ingests them, the topic carries the atom's canonical concept
 * id, and the course player opens the real lesson. A measurement that had to reach a gateway would
 * be measuring the gateway.
 */
const CACHE_PREFIX = 'wobo-curriculum-v1';
const UNITS_KEY = `${CACHE_PREFIX}:units:${ATOM_WORLD.frameworkId}:${ATOM_WORLD.versionId}:${ATOM_WORLD.level}:Mathematics`;
const TOPICS_KEY = `${CACHE_PREFIX}:topics:${ATOM_WORLD.frameworkId}:${ATOM_WORLD.versionId}:${UNIT_ID}`;

function node(over: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'unit',
    parentId: null,
    order: 0,
    aliases: [],
    sourceRef: null,
    conceptIds: [],
    own: true,
    notInMySchool: false,
    textbook: null,
    renamedFrom: null,
    source: null,
    checksPassed: [],
    verifiedAt: null,
    objectives: [],
    ...over,
  };
}

const UNITS_VIEW = {
  frameworkId: ATOM_WORLD.frameworkId,
  level: ATOM_WORLD.level,
  subject: 'Mathematics',
  status: 'ready',
  subjectId: 'subject-node',
  units: [node({ id: UNIT_ID, name: 'Linear equations in one variable', parentId: 'subject-node' })],
  placeholder: null,
  plan: null,
  jobId: null,
  waitMs: 0,
  label: ATOM_WORLD.label,
  notListed: null,
};

const TOPICS_VIEW = {
  frameworkId: ATOM_WORLD.frameworkId,
  unit: { id: UNIT_ID, name: 'Linear equations in one variable', order: 0 },
  topics: [
    node({
      id: TOPIC_ID,
      kind: 'topic',
      name: 'Solving equations with the variable on one side',
      parentId: UNIT_ID,
      conceptIds: [ATOM_TARGET_NODE_ID],
    }),
  ],
};

// --- the stopwatch, installed before the app's first byte ----------------------------------------

interface ColdMarks {
  firstPaintMs: number | null;
  firstContentfulPaintMs: number | null;
  /** The lesson's own action is on screen. */
  lessonFrameMs: number | null;
  /** …and is no longer held closed (Wobo's reading clock, lesson.css's gate). */
  lessonReadyMs: number | null;
}

declare global {
  interface Window {
    __cold?: ColdMarks;
  }
}

/**
 * Everything the phone already knows, plus the stopwatch, written at document start so the app's
 * own first render is inside the measurement rather than after it.
 */
async function prepare(page: Page, seedLesson: boolean): Promise<void> {
  await page.addInitScript(
    (seed: {
      lesson: boolean;
      world: unknown;
      unitsKey: string;
      units: unknown;
      topicsKey: string;
      topics: unknown;
    }) => {
      try {
        /**
         * A STRANGER IS SEEDED WITH NOTHING, and that is the whole of the landing measurement.
         *
         * `bootIsPublic()` (src/shell/public-routes.ts) decides from the address and ONE sentinel
         * whether a bare `/` is the front door or the app. Writing `wobo-onboarded-v1` here for
         * every case made `/` boot straight into the app runtime, so the landing test was
         * measuring a returning learner's home screen and calling it the front door — it then
         * failed on finding the runtime there, which was the harness's own doing rather than the
         * product's. A visitor arriving from a search has none of these keys, so neither does this.
         */
        if (!seed.lesson) return;
        localStorage.setItem('wobo-onboarded-v1', '1');
        localStorage.setItem('wobo-met-v1', '1'); // an old friend; Wobo never re-introduces themself
        localStorage.setItem(
          'wobo-learner-profile',
          // The copy law (DESIGN.md §0): no invented learner, not even in a fixture.
          JSON.stringify({ name: 'Learner', grade: 'Class 8', boardId: 'cbse' }),
        );
        {
          localStorage.setItem('wobo-curriculum-world-v1', JSON.stringify(seed.world));
          localStorage.setItem(seed.unitsKey, JSON.stringify(seed.units));
          localStorage.setItem(seed.topicsKey, JSON.stringify(seed.topics));
          localStorage.setItem(
            'wobo-curriculum-v1:index',
            JSON.stringify([seed.unitsKey, seed.topicsKey]),
          );
        }
        sessionStorage.setItem('wobo-home-opened', '1');
      } catch {
        /* a private window; the measurement still stands */
      }
    },
    {
      lesson: seedLesson,
      world: ATOM_WORLD,
      unitsKey: UNITS_KEY,
      units: UNITS_VIEW,
      topicsKey: TOPICS_KEY,
      topics: TOPICS_VIEW,
    },
  );

  await page.addInitScript(() => {
    const marks: ColdMarks = {
      firstPaintMs: null,
      firstContentfulPaintMs: null,
      lessonFrameMs: null,
      lessonReadyMs: null,
    };
    window.__cold = marks;

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-paint' && marks.firstPaintMs === null) {
            marks.firstPaintMs = entry.startTime;
          }
          if (entry.name === 'first-contentful-paint' && marks.firstContentfulPaintMs === null) {
            marks.firstContentfulPaintMs = entry.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {
      /* an engine without paint timing; the lesson frame is still measured */
    }

    /**
     * The lesson's own action. Every player's action bar ends in one primary button, and on the
     * arrival card of a course it reads "Begin" (screens/course/shared.tsx). Seeing it is the
     * moment the learner can act, which is the moment the lesson has actually arrived; the
     * separate `ready` mark is when it stops being held closed by Wobo's reading clock, so a
     * deliberate pause is never charged to the cold start.
     */
    const look = (): void => {
      const marked = window.__cold;
      if (!marked) return;
      for (const button of Array.from(document.querySelectorAll('button'))) {
        if (!/^begin$/i.test((button.textContent ?? '').trim())) continue;
        const box = button.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (marked.lessonFrameMs === null) marked.lessonFrameMs = performance.now();
        if (!button.disabled && marked.lessonReadyMs === null) {
          marked.lessonReadyMs = performance.now();
        }
      }
    };
    const start = (): void => {
      look();
      new MutationObserver(look).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['disabled', 'class', 'style'],
      });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
}

// --- what came down the wire ---------------------------------------------------------------------

interface Fetched {
  url: string;
  /** Bytes on the wire, compression included, as the phone's radio counted them. */
  wire: number;
  /** Bytes the engine had to parse, read off the built file. */
  raw: number;
  /** Milliseconds after the tape started, at the moment the response finished arriving. */
  at: number;
  /**
   * Milliseconds after the tape started, at the moment the browser ASKED for it.
   *
   * A window over `at` is a window over what FINISHED, which on a throttled link is not the same
   * set as what was asked for: a large chunk requested first can land after a small one requested
   * later. A boundary that means "before the runtime was fetched" has to be drawn on this clock.
   */
  startedAt: number;
}

/**
 * Put the page on a cheap phone and keep the tape. The throttle goes on BEFORE the first
 * navigation, so the module fetching, the mount, the measure and the paint all happen on the slow
 * machine, which is the whole point.
 */
async function coldPhone(
  context: BrowserContext,
  page: Page,
): Promise<{ fetched: Fetched[]; foreign: string[] }> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_3G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  // A cold phone has nothing kept from anybody else's run.
  await cdp.send('Network.clearBrowserCache');

  const fetched: Fetched[] = [];
  const urls = new Map<string, string>();
  const asked = new Map<string, number>();
  const began = Date.now();

  cdp.on('Network.requestWillBeSent', (event: { requestId: string }) => {
    if (!asked.has(event.requestId)) asked.set(event.requestId, Date.now() - began);
  });
  cdp.on('Network.responseReceived', (event: { requestId: string; response: { url: string } }) => {
    urls.set(event.requestId, event.response.url);
  });
  cdp.on(
    'Network.loadingFinished',
    (event: { requestId: string; encodedDataLength: number }) => {
      const url = urls.get(event.requestId);
      if (!url) return;
      const finished = Date.now() - began;
      fetched.push({
        url,
        wire: event.encodedDataLength,
        raw: rawBytesOf(url),
        at: finished,
        startedAt: asked.get(event.requestId) ?? finished,
      });
    },
  );

  /**
   * NOTHING LEAVES THE MACHINE, and it is WATCHED rather than intercepted.
   *
   * The obvious way to hold that is `page.route('**\/*')` with an abort for anything off-origin.
   * It was the first way this was written and it is the wrong one for a stopwatch: routing every
   * request hands each one to the test process and back before the browser may issue it, which on
   * a 2 000 ms round trip is a cost the product does not have. The number would then be partly a
   * measurement of Playwright.
   *
   * So the tape is passive. A measurement build is made with no gateway address in it (see the
   * header), so there is nothing off-origin to attempt; anything that appears here is listed and
   * the test fails on it rather than quietly measuring a network service.
   */
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http')) return; // data:, blob: — not the network
    if (!new URL(url).host.startsWith('localhost')) foreign.push(url);
  });

  return { fetched, foreign };
}

/** The decoded size of a built file, read off disk by its address. Nothing is guessed. */
function rawBytesOf(url: string): number {
  try {
    const { pathname } = new URL(url);
    const path = join(DIST, pathname);
    return path.startsWith(DIST) && existsSync(path) ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}

const isScript = (url: string): boolean => new URL(url).pathname.endsWith('.js');

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} kB`;

function tally(fetched: Fetched[], until: number | null): { wire: number; raw: number; n: number } {
  const scripts = fetched.filter(
    (f) => isScript(f.url) && (until === null || f.at <= until),
  );
  return {
    wire: scripts.reduce((sum, f) => sum + f.wire, 0),
    raw: scripts.reduce((sum, f) => sum + f.raw, 0),
    n: scripts.length,
  };
}

/** The chunk names a route pulled, short enough to read in a log line. */
function chunkNames(fetched: Fetched[]): string[] {
  return fetched
    .filter((f) => isScript(f.url))
    .map((f) => new URL(f.url).pathname.replace('/assets/', '').replace(/-[A-Za-z0-9_-]{8}\.js$/, ''))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
}

// --- the precache --------------------------------------------------------------------------------

/**
 * What a first visit downloads in the background before it has opened anything, read out of the
 * service worker's own manifest. A precache larger than the product is a first visit paying for
 * screens it may never open, on the phone whose data is the scarce thing.
 */
function precache(): { entries: number; raw: number; gzip: number; heaviest: [number, string][] } {
  const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
  const urls = [...sw.matchAll(/\{url:"([^"]+)",revision:/g)].map((m) => m[1] as string);
  let raw = 0;
  let gzip = 0;
  const heaviest: [number, string][] = [];
  for (const url of urls) {
    const path = join(DIST, url);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
    heaviest.push([bytes.length, url]);
  }
  heaviest.sort((a, b) => b[0] - a[0]);
  return { entries: urls.length, raw, gzip, heaviest: heaviest.slice(0, 8) };
}

// --- the measurement -----------------------------------------------------------------------------

/**
 * Is there a build here to measure?
 *
 * The shell is `app.html` only after `scripts/prerender.ts` has run, and a measurement build is a
 * plain `vite build`, where `index.html` is that same untouched shell. Requiring `app.html` made
 * this whole suite skip silently against exactly the build it is meant to measure — two green
 * skips that looked like a pass. Either shell counts; the service worker is what proves a real
 * build rather than a stray directory.
 */
const built =
  (existsSync(join(DIST, 'app.html')) || existsSync(join(DIST, 'index.html'))) &&
  existsSync(join(DIST, 'sw.js'));

test.describe('the cold start on a cheap Android phone: 390, 4x CPU, Slow 3G, cold cache', () => {
  test.skip(
    !built,
    'there is no build to measure. Run `bun run build` in apps/web-pwa first: this suite measures ' +
      'the bytes a phone actually downloads, and a dev server ships none of them.',
  );
  test.slow();

  test('the three numbers, on the lesson a cold phone opens by its address', async ({
    page,
    context,
    browserName,
  }, info) => {
    test.skip(browserName !== 'chromium', 'CPU and network throttling are chromium capabilities');

    const { fetched, foreign } = await coldPhone(context, page);
    await prepare(page, true);

    await page.goto(LESSON, { waitUntil: 'commit' });

    // The lesson's own action, seen by the observer that was installed before the app ran.
    //
    // WHEN IT NEVER ARRIVES, SAY WHAT IS ON SCREEN INSTEAD. The first run of this spec sat here
    // for the whole timeout and reported only that it had waited, when what had actually happened
    // was that the build under measurement had its doors closed (docs/DOORS-CLOSED.md): every app
    // address rendered the invitation, so there was no lesson and no action, and the timeout said
    // none of that. A stopwatch that cannot say why it never started is worse than no stopwatch.
    try {
      await page.waitForFunction(() => window.__cold?.lessonFrameMs !== null, undefined, {
        timeout: 4 * 60_000,
      });
    } catch {
      const seen = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent?.trim() ?? '(no heading)',
        words: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
      }));
      throw new Error(
        `the lesson never became actionable. What was on screen instead:\n` +
          `  heading: ${seen.heading}\n  words:   ${seen.words}\n\n` +
          'If that is the invitation to the list, this build has its doors closed and no app ' +
          'address can reach a lesson. Measure a build made the way the header describes:\n' +
          '  VITE_LLM_MODE=mock VITE_GATEWAY_URL= VITE_DEV_AUTH=true VITE_PERSIST_MODE=local \\\n' +
          '  VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_SUPABASE_DEV_JWT= bunx vite build',
      );
    }
    /**
     * The paint marks, with the timeline itself as the second witness.
     *
     * The observer is installed before the app's first byte and is the right instrument, but on
     * the throttled profile it came back empty while the lesson frame was stamped perfectly well,
     * and a number reported as NaN is a number nobody took. `performance.getEntriesByType('paint')`
     * is the same browser's own record of the same event, read at the end rather than subscribed
     * to at the start, so whichever of the two fired is the one reported and the measurement
     * cannot silently lose its first number again.
     */
    const marks = (await page.evaluate(() => {
      const cold = window.__cold as ColdMarks;
      const painted = performance.getEntriesByType('paint');
      const at = (name: string): number | null =>
        painted.find((entry) => entry.name === name)?.startTime ?? null;
      return {
        ...cold,
        firstPaintMs: cold.firstPaintMs ?? at('first-paint'),
        firstContentfulPaintMs: cold.firstContentfulPaintMs ?? at('first-contentful-paint'),
      };
    })) as ColdMarks;
    const upToFrame = tally(fetched, marks.lessonFrameMs);

    // Everything else is reported, never folded in: bytes that land after the learner could begin
    // are not what the learner waited for.
    await page.waitForTimeout(2_000);
    const everything = tally(fetched, null);
    const store = precache();

    const lines = [
      `first paint                     ${Math.round(marks.firstContentfulPaintMs ?? Number.NaN)} ms`,
      `first interactive lesson frame  ${Math.round(marks.lessonFrameMs ?? Number.NaN)} ms`,
      `  (its action unheld at         ${
        marks.lessonReadyMs === null ? 'still held' : `${Math.round(marks.lessonReadyMs)} ms`
      })`,
      `JS on the lesson route          ${kb(upToFrame.wire)} over the wire, ${kb(upToFrame.raw)} decoded, in ${upToFrame.n} files`,
      `  (after it settles             ${kb(everything.wire)} over the wire, in ${everything.n} files)`,
      `service worker precache         ${kb(store.raw)} in ${store.entries} files, ${kb(store.gzip)} over the wire`,
      `  heaviest precached            ${store.heaviest.map(([b, u]) => `${u.replace('assets/', '')} ${kb(b)}`).join(', ')}`,
      `chunks fetched                  ${chunkNames(fetched).join(' ')}`,
    ];
    // eslint-disable-next-line no-console
    console.log(`\n[390 · ${CPU_THROTTLE}x CPU · Slow 3G · cold cache]\n${lines.join('\n')}\n`);
    await info.attach('cold-start', { body: lines.join('\n'), contentType: 'text/plain' });

    expect(foreign, `the measurement reached off its own origin:\n${foreign.join('\n')}`).toEqual(
      [],
    );

    expect(
      Math.round(marks.firstContentfulPaintMs ?? Number.NaN),
      'time to first paint on the lesson route',
    ).toBeLessThan(BUDGET.firstPaintMs);

    expect(
      Math.round(marks.lessonFrameMs ?? Number.NaN),
      'time to the first interactive lesson frame',
    ).toBeLessThan(BUDGET.lessonFrameMs);

    expect(
      Math.round(upToFrame.wire / 1024),
      `script bytes over the wire before a learner can begin. Fetched:\n${chunkNames(fetched).join('\n')}`,
    ).toBeLessThan(BUDGET.lessonWireJsKb);

    expect(
      Math.round(store.raw / 1024),
      `the service worker precache, which every first visit pays for in the background:\n${store.heaviest
        .map(([b, u]) => `${kb(b)}  ${u}`)
        .join('\n')}`,
    ).toBeLessThan(BUDGET.precacheKb);
  });

  test('the landing pays for the site alone until the runtime is deliberately prefetched, and never for the console', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU and network throttling are chromium capabilities');

    const { fetched } = await coldPhone(context, page);
    await prepare(page, false);

    // A stranger on the front door. Nothing is seeded, so this is the visitor the public site is
    // built for (src/App.tsx: the runtime is fetched only once an address stops being public).
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__cold?.firstContentfulPaintMs !== null, undefined, {
      timeout: 5 * 60_000,
    });
    const paintedAt = (await page.evaluate(() => window.__cold?.firstContentfulPaintMs)) as number;

    const named = (f: Fetched): string => chunkNames([f])[0] ?? '';

    /**
     * WHY THE BOUNDARY IS THE PREFETCH AND NOT FIRST PAINT.
     *
     * This assertion used to filter by `f.at <= paintedAt`, on the reasoning that the runtime is
     * prefetched "a few seconds later" and so falls outside the window. That reasoning holds only
     * when first paint is fast. On a build with no pre-render, which is the build this file's
     * header prescribes, nothing paints until the app has booted (cause 1) and first paint is 20
     * to 34 seconds out, while `App.tsx` asks for the runtime on a 4 second idle timer. The
     * prefetch therefore lands INSIDE the window, and the test failed on `wobo-board` because the
     * product did exactly what it is documented to do. Pointed at a pre-rendered `dist`, where
     * first paint is immediate, the identical assertion passed. A test whose verdict is decided by
     * which directory it was given is not measuring the site.
     *
     * So the window ends where the deliberate prefetch begins. Everything asked for before that is
     * the landing's own cost, which is the thing the law in `src/PublicSite.tsx` is actually about,
     * and it reads the same on either build.
     */
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !fetched.some((f) => named(f) === 'AppRuntime')) {
      await page.waitForTimeout(500);
    }
    // No prefetch on the tape means no boundary, and then the whole visit is the landing's own
    // cost. The assertions below only get stricter, never weaker, so this needs no assertion.
    const prefetchAt = Math.min(
      ...fetched.filter((f) => named(f) === 'AppRuntime').map((f) => f.startedAt),
    );

    const beforePrefetch = chunkNames(fetched.filter((f) => f.startedAt < prefetchAt));
    // eslint-disable-next-line no-console
    console.log(
      `\n[landing] first paint ${Math.round(paintedAt)} ms · runtime prefetched at ${
        Number.isFinite(prefetchAt) ? `${Math.round(prefetchAt)} ms` : 'never'
      }\n[landing, before the prefetch] ${beforePrefetch.join(' ')}\n`,
    );

    // The app runtime carries Wobo's board, the answer library and the schema validator. A visitor
    // reading a marketing page must not pay for any of it to see the page. That the runtime
    // follows later is deliberate and is the boundary above, not a failure.
    expect(
      beforePrefetch,
      'the landing fetched the board renderer before the runtime was ever asked for',
    ).not.toContain('wobo-board');
    expect(beforePrefetch).not.toContain('wobo-answers');
    expect(beforePrefetch).not.toContain('zod');

    // The operator console is a separate build with its own entry (vite.admin.config.ts) and is
    // never produced by the public build. Nothing the learner or a visitor loads may name it, at
    // any point in the visit, so this one is not bounded by the prefetch.
    expect(chunkNames(fetched).some((name) => /admin|console/i.test(name))).toBe(false);
  });
});
