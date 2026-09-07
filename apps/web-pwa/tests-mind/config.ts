import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The memory law, proved in a browser (tests-mind/mind.spec.ts).
 *
 * It cannot live in `tests/`: that suite is hermetic (no gateway address at all) and its
 * `isolation` project has live auth but no gateway either, and the mind rides the gateway. So this
 * suite starts its own dev server with live auth AND a gateway address, and the spec answers both
 * in the page: GoTrue and PostgREST on a closed loopback port, the gateway on a path of the app's
 * own origin that nothing serves. Nothing leaves the machine; the app's real SDK, scope, wire and
 * memory page all run.
 *
 * Its own port, so it never attaches to another suite's server. The server runs from the app
 * root (`cwd`), the way tests/doubt.config.ts explains.
 *
 * Run: `cd apps/web-pwa && bunx playwright test --config tests-mind/config.ts`
 */

const PORT = Number(process.env.WOBO_MIND_PORT ?? 5341);

export default defineConfig({
  testDir: '.',
  testMatch: 'mind.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Its own artifacts, under the ignored shots/ tree: the shared test-results/ was being cleared
  // by another suite's run while this one was still writing its trace.
  outputDir: './shots/test-results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      'VITE_LLM_MODE=mock',
      `VITE_GATEWAY_URL=http://localhost:${PORT}/gw`,
      'VITE_DEV_AUTH=false',
      'VITE_PERSIST_MODE=live',
      `VITE_SUPABASE_URL=http://127.0.0.1:${PORT + 1}`,
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
