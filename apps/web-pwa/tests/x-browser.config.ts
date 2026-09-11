import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser × responsive matrix config. Three engines (chromium, webkit, firefox) run the
 * same walk at four widths × two themes. Hermetic: its own vite on a dedicated strict port with
 * the keyless mock provider, so no gateway and no collision with the dev server on 5173 or the
 * journey suite on 5199.
 */

const PORT = 5211;

export default defineConfig({
  testDir: '.',
  testMatch: 'x-browser.spec.ts',
  fullyParallel: true,
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: 1, // animation-timing flake on cold engines; a real break fails twice
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 120_000,
  expect: { timeout: 12_000 },
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
    screenshot: 'off', // the spec takes its own, named per matrix cell
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    // Blank Supabase vars too (.env.local carries real keys): with no account layer the walk
    // never fires an auth request, so the console-clean gate measures the app, not the network.
    command: [
      'VITE_LLM_MODE=mock',
      'VITE_GATEWAY_URL=',
      'VITE_DEV_AUTH=true',
      'VITE_PERSIST_MODE=local',
      'VITE_SUPABASE_URL=',
      'VITE_SUPABASE_ANON_KEY=',
      'VITE_SUPABASE_DEV_JWT=',
      `bunx vite --port ${PORT} --strictPort`,
    ].join(' '),
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
