/**
 * EVERY TAP ON A WEIGHT TAKES A WEIGHT OFF, with reduced motion and without.
 *
 * Measured 2026-09-17 while writing suggestions.spec.ts: under reduced motion every other tap on a
 * weight was lost. A weight that has just been taken off stays in the page while it leaves, still
 * named "take this weight off" and still answering a tap, so the next tap landed on the one already
 * gone and did nothing. A learner who taps three times and sees two weights move is being told the
 * scale did not hear them.
 *
 * Frames land in `tests/shots/balance-scale/`. EVERY LAB IS MUTED: the browser comes from
 * playwright.config.ts (`--mute-audio`), and nothing here adds launch options.
 */

import { expect, test } from '@playwright/test';
import { assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { seedAtomWorld } from './helpers/brain';
import { installAtomPoolBrain, openTheAtom } from './helpers/walk';

for (const motion of ['reduce', 'no-preference'] as const) {
  for (const width of [390, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`three taps take three weights off (${motion}, ${width}, ${theme})`, async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const errors = watchConsole(page);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: motion });
        await seedOnboarded(page);
        await seedAtomWorld(page);
        await page.goto('/');
        await installAtomPoolBrain(page);
        await openTheAtom(page);

        const stage = page.locator('main.ls-stage');
        const on = stage.getByLabel('take this weight off');
        const off = stage.getByLabel('put this weight back');
        await expect(on.first()).toBeVisible({ timeout: 20_000 });
        await expect(on).toHaveCount(11);

        for (let i = 0; i < 3; i += 1) {
          await on.first().click();
          await page.waitForTimeout(250);
        }
        await expect(off).toHaveCount(3, { timeout: 5_000 });
        await expect(on).toHaveCount(8, { timeout: 5_000 });
        await page.screenshot({
          path: `tests/shots/balance-scale/three-off-${motion}-${width}-${theme}.png`,
          fullPage: true,
        });
        assertNoErrors(errors, test.info());
      });
    }
  }
}

test('the scale speaks without a dash', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../src/screens/course/BalanceScale.tsx', import.meta.url),
    'utf8',
  );
  // Only the strings a learner reads: JSX text between tags, and the three lines of the card.
  const said = [...source.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)].map((m) => m[1]);
  for (const line of said) expect(line, line).not.toContain('—');
});
