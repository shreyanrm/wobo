import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The daily allowance's own proof run (tests/allowance-bar.spec.ts).
 *
 * It needs what the journey config deliberately does not have: a gateway address. The bar under
 * the plan is filled from `GET /v1/me` and the promo field posts to `POST /v1/promo/redeem`, and both
 * go through `VITE_GATEWAY_URL` — so the server here is pointed at a path on its own origin
 * (`/gw`) that nothing serves, and the spec answers every request to it in the browser
 * (`page.route`). Nothing leaves the machine, and the app's real SDK, parser and components run.
 *
 * Its own port, so it never attaches to another suite's server (see playwright.config.ts). The
 * server runs from the app root (`cwd`), or vite would serve `tests/` and answer 404 for the whole
 * readiness timeout (the lesson tests/doubt.config.ts already paid for).
 */

const PORT = Number(process.env.WOBO_ALLOWANCE_PORT ?? 5331);

export default defineConfig({
  testDir: '.',
  testMatch: /allowance-bar\.spec\.ts$/,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // EVERY LAB IS MUTED (the owner, 2026-09-09). A headless browser plays through the owner's
    // speakers; this config declares its own `use:` block and inherits nothing, so the flag has to
    // be here too (test/labs-are-muted.test.ts holds every config in the app to it).
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'off',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      'VITE_LLM_MODE=mock',
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
    timeout: 120_000,
  },
});
