import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Wobo journey suite. One browser (chromium), one dev server
 * (vite) on a dedicated strict port so it never collides with a fleet agent's server. Tests are
 * serial per-file and the whole run is single-worker: the journey mutates localStorage and shared
 * app state, and flakiness from parallel animation timing is not worth the speed.
 *
 * THE PORT IS OVERRIDABLE, and it has to be. A fixed `--strictPort` plus `reuseExistingServer`
 * means the second workflow to start an e2e run silently attaches to the FIRST one's dev server —
 * built from a different working tree, at a different moment — and both runs then report findings
 * about a page neither of them served. It fails as flakiness rather than as an error, which is the
 * expensive way to find out. Set `WOBO_E2E_PORT` per workflow and the two runs cannot see each
 * other; leave it unset and nothing changes for a single run.
 */

const PORT = Number(process.env.WOBO_E2E_PORT ?? 5199);

/**
 * THE DOORS NEED A SECOND SERVER, and that is why there are two.
 *
 * The hermetic server below runs `VITE_DEV_AUTH=true` with blank Supabase vars, which is exactly
 * right for every other spec — no account layer, so onboarding skips the sign-in beat and no auth
 * request leaves the browser. But `client.ts` reads those same vars, so under them `/sign-in` and
 * `/sign-up` render ZERO controls: no field, no rule, no providers, no form, and a tab order of
 * skip link, wordmark, other door. Everything the two doors are — the ruled line, the pigment
 * drawn across on focus, the invalid state, the `soon` chips, the tab order — is unreachable from
 * this suite, so a regression to any of it would have shipped in silence.
 *
 * The auth server flips `VITE_DEV_AUTH=false` and gives the keys a shape rather than a project:
 * the URL is a closed loopback port, so `sdk.account` exists and the doors light up, and nothing
 * can reach a real service even if something tried. `auth-doors.spec.ts` runs against this one and
 * nothing else does. `globalSetup` still checks `projects[0]`, which is the hermetic project.
 */
const AUTH_PORT = PORT + 1;
const AUTH_ORIGIN = `http://localhost:${AUTH_PORT}`;

/**
 * ONE LEARNER, ONE WOBO needs a third: live auth AND live persistence, so the account is the record
 * (`docs/MEMORY-LAW.md`) and `isolation.spec.ts` can sign two learners in and out of one phone. The
 * keys again name a closed loopback port; the spec answers every GoTrue and PostgREST request
 * itself, in the page, so nothing leaves the machine.
 */
const ISOLATION_PORT = PORT + 3;
const ISOLATION_ORIGIN = `http://localhost:${ISOLATION_PORT}`;

export default defineConfig({
  testDir: './tests',
  // The cross-browser matrix lives beside the journey specs but is a separate suite with its own
  // config, port and engines (tests/x-browser.config.ts) — `test:e2e` must not pull it in.
  testIgnore: ['x-browser.spec.ts'],
  // Refuse to run against an app that can reach a gateway. `reuseExistingServer` below will attach
  // to whatever is already on the port, and a plain `bun run dev` is wired to the brain on 8081 —
  // which turns every console-error assertion in the suite into a CORS failure that says nothing
  // about the code. tests/global-setup.ts says so once, in words, instead.
  globalSetup: './tests/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // CI also emits an HTML report so the workflow can upload it as an artifact on failure.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A LAB IS SILENT (docs/INK-FOUR.md, 2026-09-09). A headless browser plays through the owner's
    // speakers, and on the day that law was written several live-voice runs made noise on his
    // machine while he was working. Every browser this suite launches starts with audio off; a
    // voice timing is measured from the synthesis call and the wire, never from a speaker.
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['auth-doors.spec.ts', 'isolation.spec.ts'],
    },
    {
      name: 'auth',
      testMatch: ['auth-doors.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: AUTH_ORIGIN },
    },
    {
      name: 'isolation',
      testMatch: ['isolation.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: ISOLATION_ORIGIN },
    },
  ],
  webServer: [
    {
      // Hermetic: force the keyless mock provider, no gateway and NO account layer so the suite
      // never touches a network service (dev's .env sets LLM_MODE=live + a gateway URL, and
      // .env.local carries real Supabase keys). Turns fall to the deterministic classifier;
      // TTS/voice no-op without a gateway URL; blank Supabase vars make `sdk.account` absent, so
      // onboarding skips the mandatory sign-in beat and no auth request ever leaves the browser.
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
    {
      // The doors, lit. Live auth with keys that name a closed loopback port: `sdk.account` is
      // built (so the ways in are wired and the page draws its controls) and no request can reach
      // anything. The anon key is a shape, not a secret.
      command: [
        'VITE_LLM_MODE=mock',
        'VITE_GATEWAY_URL=',
        'VITE_DEV_AUTH=false',
        'VITE_PERSIST_MODE=local',
        `VITE_SUPABASE_URL=http://127.0.0.1:${PORT + 2}`,
        'VITE_SUPABASE_ANON_KEY=e2e-not-a-real-key',
        'VITE_SUPABASE_DEV_JWT=',
        `bunx vite --port ${AUTH_PORT} --strictPort`,
      ].join(' '),
      url: `${AUTH_ORIGIN}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Two learners, one phone: live auth, live persistence, and a database that is answered by
      // the spec. The same closed loopback port as the doors; the anon key is a shape.
      command: [
        'VITE_LLM_MODE=mock',
        'VITE_GATEWAY_URL=',
        'VITE_DEV_AUTH=false',
        'VITE_PERSIST_MODE=live',
        `VITE_SUPABASE_URL=http://127.0.0.1:${PORT + 2}`,
        'VITE_SUPABASE_ANON_KEY=e2e-not-a-real-key',
        'VITE_SUPABASE_DEV_JWT=',
        `bunx vite --port ${ISOLATION_PORT} --strictPort`,
      ].join(' '),
      url: `${ISOLATION_ORIGIN}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
