/** TEMPORARY (wave 62 closer). A lab against a keyless dev server I started myself, on 5391. */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['w62-hypotenuse.spec.ts', 'w62-probe.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5391',
    // A LAB IS SILENT (docs/INK-FOUR.md).
    launchOptions: { args: ['--mute-audio'] },
    actionTimeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
