import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The doubt solver's own proof run (tests/doubt.spec.ts).
 *
 * It needs what the journey config deliberately does not have: a gateway address. The reading of a
 * photo and the streamed explanation both go through `VITE_GATEWAY_URL`, so the server here is
 * started LIVE and pointed at a path on its own origin (`/gw`) that nothing serves — the spec
 * intercepts every request to it in the browser (`page.route`) and answers as the gateway would.
 * Nothing leaves the machine, and the app's real SDK, parser, conductor and renderer all run.
 *
 * Its own port, so it never attaches to another suite's server (see playwright.config.ts).
 *
 * THE SERVER RUNS FROM THE APP ROOT. This config lives in tests/, and Playwright spawns the web
 * server with the config's directory as its cwd unless told otherwise, so vite served tests/ (no
 * index.html), answered 404 to the readiness URL for the whole timeout, and the proof could not
 * start cold: it only ever passed against a dev server somebody already had running. `cwd` below
 * is the fix; the 180 s was never the pre-bundle (vite boots in about a second here).
 */

const PORT = Number(process.env.WOBO_DOUBT_PORT ?? 5311);

export default defineConfig({
  testDir: '.',
  // The doubt solver's specs: the whole flow (doubt.spec.ts) and the fixer's cases
  // (doubt-fixes.spec.ts), both against the browser-answered gateway this config exists for.
  testMatch: /doubt(-[a-z]+)?\.spec\.ts$/,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A LAB IS SILENT (the owner, 2026-09-09). A headless browser plays through the owner's
    // speakers, and it did, while he was working. Every browser this config launches starts with
    // audio off; a voice timing is measured from the synthesis call and the wire, never from a
    // speaker. The main playwright.config.ts has carried this since the law was written — these
    // configs declare their own `use:` and their own projects and inherit none of it, so the
    // flag has to be here too (test/labs-are-muted.test.ts holds all four to it).
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'off',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      'VITE_LLM_MODE=live',
      `VITE_GATEWAY_URL=http://localhost:${PORT}/gw`,
      'VITE_DEV_AUTH=true',
      'VITE_PERSIST_MODE=local',
      'VITE_SUPABASE_URL=',
      'VITE_SUPABASE_ANON_KEY=',
      'VITE_SUPABASE_DEV_JWT=',
      `bunx vite --port ${PORT} --strictPort`,
    ].join(' '),
    url: `http://localhost:${PORT}/`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
