import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WOBO_PLAN_PORT ?? 5231);
const BRAIN = 'http://127.0.0.1:9987';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, actionTimeout: 15_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      'VITE_LLM_MODE=mock',
      `VITE_GATEWAY_URL=${BRAIN}`,
      'VITE_DEV_AUTH=true',
      'VITE_PERSIST_MODE=local',
      'VITE_SUPABASE_URL=',
      'VITE_SUPABASE_ANON_KEY=',
      'VITE_SUPABASE_DEV_JWT=',
      `bunx vite --port ${PORT} --strictPort`,
    ].join(' '),
    cwd: '..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
