import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The cold start on a cheap Android phone, measured against the BUILT site.
 *
 * Every other suite in this app drives the dev server, which is right for behaviour and useless for
 * this: in dev there is no chunking, no minification, no service worker and no precache, so a
 * measurement taken there describes a machine nobody owns. This config serves `dist/` through
 * `tests/cold-start-server.ts`, which executes `vercel.json`'s own rewrite table, so the page under
 * measurement is the page the host serves.
 *
 * Its own port, so it can never attach to another suite's server (see playwright.config.ts).
 *
 * THE SUITE IS NOT PART OF `test:e2e`. It needs a build to exist and it takes minutes on a
 * throttled profile, so `playwright.config.ts` ignores the spec and this config runs it:
 *
 *     cd apps/web-pwa && bun run build && bunx playwright test --config tests/cold-start.config.ts
 */

const PORT = Number(process.env.WOBO_COLD_PORT ?? 5321);

export default defineConfig({
  testDir: '.',
  testMatch: 'cold-start.spec.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // A cold load of the lesson route on 400 kbit/s with a 2 s round trip is minutes, not seconds,
  // and that is the measurement rather than a slow test. The budget is what the spec asserts; this
  // is only the room the stopwatch needs.
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A LAB IS SILENT (the owner, 2026-09-09). A headless browser plays through the owner's
    // speakers, and it did, while he was working. Every browser this config launches starts with
    // audio off; a voice timing is measured from the synthesis call and the wire, never from a
    // speaker. Each config declares its own `use:` and inherits nothing from the main one, so the
    // flag has to be here too (test/labs-are-muted.test.ts holds every config to it).
    launchOptions: { args: ['--mute-audio'] },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      // The phone the design is measured at, at its own device pixel ratio. CPU and network
      // throttling are chromium capabilities, so there is one engine here and the spec says so.
      name: 'phone',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    // `WOBO_COLD_DIST` names the build under measurement, and it matters that it is not plain
    // `dist`: that directory is rewritten by any other build running in this tree, and a
    // measurement that takes minutes on a throttled link had its bytes swapped underneath it
    // exactly that way. Unset, both the server and the spec fall back to `dist`.
    command: `PORT=${PORT} bun tests/cold-start-server.ts`,
    env: process.env.WOBO_COLD_DIST ? { WOBO_COLD_DIST: process.env.WOBO_COLD_DIST } : {},
    // The server is started from the app root, not from tests/ — Playwright spawns a web server
    // with the CONFIG's directory as its cwd unless told otherwise, and `dist` is one level up.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    // The root, not `/app.html`: the shell is only called that after `scripts/prerender.ts` has
    // run, and a measurement build is a plain `vite build`, where `index.html` IS the shell. A
    // readiness probe aimed at a file that build never writes answers 404, and Playwright then
    // reports sixty seconds of waiting for a server that was up the whole time.
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
