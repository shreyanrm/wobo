import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * THE SHARE TARGET'S OWN PROOF RUN, and why it needs two servers.
 *
 * A share target is the one feature of the app that does not exist until the app is BUILT. The
 * phone offers Wobo in its share sheet because the install manifest says so, and the POST it makes
 * is answered by the service worker — neither of which a dev server has: vite-plugin-pwa writes no
 * worker in dev, and the manifest it serves is not the one workbox generated. So:
 *
 *  · `built` runs against a real `bun run build` served by `vite preview`, with the generated
 *    worker registered and controlling the page. It makes the POST the phone makes — a multipart
 *    form with a file on it — and measures what comes back: the redirect, its token, and the bytes
 *    in the device's own Cache. This is the only place the worker is the real one.
 *  · `arrival` runs against the ordinary dev server, where the app's own side of the handover can
 *    be driven with the gateway answered in the browser (the pattern tests/doubt.config.ts uses):
 *    a share is planted in the Cache the worker writes to, and the doubt solver is walked from the
 *    address the worker redirects to.
 *
 * THE BUILD IS PART OF THE RUN. It is minutes rather than seconds, and that is the price of
 * proving a service worker rather than a mock of one. `WOBO_SHARE_SKIP_BUILD=1` reuses the `dist`
 * already on disk when iterating; `reuseExistingServer` keeps the preview up between runs.
 *
 * Run: `bunx playwright test --config tests/share-target.config.ts` from apps/web-pwa.
 */

const PORT = Number(process.env.WOBO_SHARE_PORT ?? 5315);
const ARRIVAL_PORT = PORT + 1;
const ARRIVAL_ORIGIN = `http://localhost:${ARRIVAL_PORT}`;
const BUILD = process.env.WOBO_SHARE_SKIP_BUILD ? '' : 'bun run build && ';

export default defineConfig({
  testDir: '.',
  testMatch: /share-(target|arrival)\.spec\.ts$/,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A LAB IS SILENT (the owner, 2026-09-09). A headless browser plays through the owner's
    // speakers, and it did, while he was working. Every browser this config launches starts with
    // audio off; a voice timing is measured from the synthesis call and the wire, never from a
    // speaker. Each config declares its own `use:` and inherits nothing from the main one, so the
    // flag has to be here too (test/labs-are-muted.test.ts holds every lab in the app to it).
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'off',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'built',
      testMatch: 'share-target.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'arrival',
      testMatch: 'share-arrival.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: ARRIVAL_ORIGIN },
    },
  ],
  webServer: [
    {
      // The real build, served as it is deployed: the generated worker, the generated manifest.
      // Keyless and account-less is not available to a build (the flags are baked in at build
      // time from the env files), so this project measures the WORKER and never sends anything:
      // the spec aborts every request that is not this origin.
      command: `${BUILD}bunx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/`,
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      reuseExistingServer: !process.env.CI,
      timeout: 900_000,
    },
    {
      // The app's own side, with a gateway address on this origin that nothing serves: the spec
      // answers `/gw` in the browser as the gateway would (tests/doubt.config.ts does the same).
      command: [
        'VITE_LLM_MODE=live',
        `VITE_GATEWAY_URL=${ARRIVAL_ORIGIN}/gw`,
        'VITE_DEV_AUTH=true',
        'VITE_PERSIST_MODE=local',
        'VITE_SUPABASE_URL=',
        'VITE_SUPABASE_ANON_KEY=',
        'VITE_SUPABASE_DEV_JWT=',
        `bunx vite --port ${ARRIVAL_PORT} --strictPort`,
      ].join(' '),
      url: `${ARRIVAL_ORIGIN}/`,
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
