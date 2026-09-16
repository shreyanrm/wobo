import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * THE WAIT, MEASURED (docs/EMAILS-AND-ANIMATIONS.md §3; docs/THE-WAIT.md §1).
 *
 * The design asks for the waiting states to be measured at 390 and 1440, in both themes, with
 * reduced motion respected. Everything else about the wait is already held by pure tests — the
 * geometry of the seven scenes (`packages/wobo/src/body/wait.test.ts`), the markup a screen reader
 * meets (`src/ui/WaitScene.test.tsx`), and the law that no waiting state carries a narrating word
 * (`src/screens/states/waiting-never-narrates.test.ts`). None of those opens a browser, so none of
 * them can see the three things a learner actually meets: whether the scene is DRAWN on the glass,
 * whether it MOVES, and whether it fits the phone it is drawn on.
 *
 * This config exists for that, and its own port, so it never attaches to another suite's server
 * (see playwright.config.ts).
 *
 * THE SERVER RUNS FROM THE APP ROOT. This config lives in tests/, and Playwright spawns the web
 * server with the config's directory as its cwd unless told otherwise — `cwd` below is what keeps
 * vite serving the app rather than the tests directory.
 *
 * KEYLESS AND HERMETIC, like the journey config: no gateway address, so `curriculumReady()` is
 * honest and the spec supplies the brain the app would have talked to, at the client's own seam.
 * Nothing leaves the machine.
 *
 * A LAB IS SILENT (the owner, 2026-09-09). A headless browser plays through the owner's speakers,
 * and it did, while he was working. Every browser this config launches starts with audio off; this
 * config declares its own `use:` and its own projects and inherits none of the main config's, so
 * the flag has to be here too (test/labs-are-muted.test.ts holds every lab in the app to it).
 */

const PORT = Number(process.env.WOBO_WAIT_PORT ?? 5331);

export default defineConfig({
  testDir: '.',
  testMatch: /wait-scenes\.spec\.ts$/,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'off',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
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
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
