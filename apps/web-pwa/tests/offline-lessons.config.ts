import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * A LESSON ALREADY OPENED PLAYS WITH THE NETWORK OFF (docs/PLATFORMS.md §5 and §6).
 *
 * This is the one law in the product that CANNOT be proved against the dev server, which is why it
 * has a config of its own. In dev there is no service worker, no precache and no built bundle, so a
 * run there would flip the network off and measure a page that was never going to need the network.
 *
 * SO THE SUITE BUILDS ITS OWN BUNDLE, and serves that. Three reasons it does not reuse `dist/`:
 *
 *  · `dist/` is built from `.env.production`, which is live auth against a real project. The spec
 *    would meet the sign-in beat before it ever reached a lesson, and a proof about offline lessons
 *    would be reporting on the door instead. The env below is the hermetic one every other suite
 *    uses — keyless, no account layer, no gateway — so the only thing answering the brain is the
 *    spec itself, in the browser.
 *  · A suite that overwrote `dist/` would leave a test build where the next `bun run gate` reads
 *    the shipped one.
 *  · It makes the run self-contained: `bunx playwright test --config tests/offline-lessons.config.ts`
 *    and nothing else, with no "build first" written down somewhere to be forgotten.
 *
 * WHY `app.html` IS COPIED. The precache names `app.html` (`vite.config.ts`,
 * `additionalManifestEntries`) but the file is written by `scripts/prerender.ts`, a later step. A
 * build without the pre-render therefore ships a worker whose precache lists a file that does not
 * exist, and a precache that 404s does not install AT ALL — the app would silently have no worker.
 * The pre-render's own `app.html` is the untouched shell plus a `noindex`, so the copy is the same
 * file for the purpose of a fetch, and one line here keeps the suite honest about what it measures.
 *
 * Its own port, so it can never attach to another suite's server (see playwright.config.ts), and
 * `playwright.config.ts` ignores the spec so `bun run test:e2e` does not run it against a dev
 * server with no worker in it.
 */

const PORT = Number(process.env.WOBO_OFFLINE_PORT ?? 5331);
const APP = fileURLToPath(new URL('..', import.meta.url));
/** Under `test-results/`, which is already ignored, so a proof never leaves a build behind. */
const OUT = fileURLToPath(new URL('../test-results/offline-dist', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: 'offline-lessons.spec.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Installing a worker, playing a lesson and opening it twice more with the network cut is minutes
  // on a phone profile, and the waiting is the measurement rather than a slow test.
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A LAB IS SILENT (the owner, 2026-09-09). A headless browser plays through the owner's
    // speakers, and a lesson READS ITSELF ALOUD, so this is the loudest suite there is. Every
    // browser it launches starts with audio off; each config declares its own `use:` and inherits
    // nothing from the main one, so the flag has to be here (test/labs-are-muted.test.ts holds
    // every config in the app to it).
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      // The phone the product is measured at, at its own device pixel ratio. Offline emulation is
      // a chromium capability, so there is one engine here.
      name: 'phone',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: [
      'VITE_LLM_MODE=live',
      // A closed loopback port: the SDK builds its gateway client and the spec answers every call
      // to it in the browser, so the app's real client, parsers and player all run and nothing can
      // reach a service even if something tried.
      'VITE_GATEWAY_URL=http://127.0.0.1:9931',
      'VITE_DEV_AUTH=true',
      'VITE_PERSIST_MODE=local',
      'VITE_SUPABASE_URL=',
      'VITE_SUPABASE_ANON_KEY=',
      'VITE_SUPABASE_DEV_JWT=',
      `bunx vite build --outDir ${OUT} --emptyOutDir`,
      `&& cp ${OUT}/index.html ${OUT}/app.html`,
      `&& bunx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    ].join(' '),
    // Started from the app root, not from tests/: Playwright spawns a web server with the CONFIG's
    // directory as its cwd unless told otherwise, and the vite config lives one level up.
    cwd: APP,
    url: `http://localhost:${PORT}/`,
    // Never attach to a server somebody else started: this one serves a build made from the env
    // above, and a dev server on the same port would answer every request with no worker at all.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
