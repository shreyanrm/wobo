import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The parent's door and the switch, proved in a browser (tests/parent-door.spec.ts).
 *
 * It needs what no other config has at once: LIVE auth (so the doors draw their controls and a
 * Google round trip really leaves and comes back) AND a gateway address (the parent plane is the
 * gateway's). Both name places nothing serves: the auth keys point at a closed loopback port and
 * the gateway at a path on this server's own origin, and the spec answers every request to either
 * in the browser (`page.route`). Nothing leaves the machine, no key is live, and no model is called.
 *
 * Its own port, so it never attaches to another suite's dev server. The server runs from the app
 * root (see doubt.config.ts for why `cwd` matters).
 */

const PORT = Number(process.env.WOBO_PARENT_PORT ?? 5331);
const AUTH_PORT = PORT + 1;

export default defineConfig({
  testDir: '.',
  testMatch: /parent-door\.spec\.ts$/,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A LAB IS SILENT (the owner, 2026-09-09): every browser this config launches has no audio.
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
      'VITE_DEV_AUTH=false',
      'VITE_PERSIST_MODE=local',
      `VITE_SUPABASE_URL=http://127.0.0.1:${AUTH_PORT}`,
      'VITE_SUPABASE_ANON_KEY=e2e-not-a-real-key',
      'VITE_SUPABASE_DEV_JWT=',
      `bunx vite --port ${PORT} --strictPort`,
    ].join(' '),
    url: `http://localhost:${PORT}/`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
