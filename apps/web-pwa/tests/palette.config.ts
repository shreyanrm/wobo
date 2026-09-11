import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The palette's own proof run (tests/palette-ink.spec.ts).
 *
 * Like the doubt config, it needs what the journey config deliberately does not have: a gateway
 * address, because a board turn only streams when there is a brain to stream from. The server is
 * pointed at a path on its own origin (`/gw`) that nothing serves; the spec answers every request
 * to it in the browser (`page.route`) as the gateway would. Nothing leaves the machine, and the
 * app's real palette, runtime, glass, conductor and renderer all run.
 *
 * Its own port, so it never attaches to another suite's server (see playwright.config.ts).
 */

const PORT = Number(process.env.WOBO_PALETTE_PORT ?? 5317);

export default defineConfig({
  testDir: '.',
  testMatch: /palette-ink\.spec\.ts$/,
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
