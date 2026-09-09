/**
 * THE INVITATION, IN A REAL BROWSER, AT BOTH ENDS OF THE RANGE AND IN BOTH THEMES.
 *
 * `docs/DOORS-CLOSED.md`: while the dial is off, what stands where the door was is a form asking
 * for an email address and, optionally, a class and board. It is the single most important surface
 * on the site for the next few weeks, because it is what every one of the 438 public pages now
 * hands a visitor to, and it is the only thing standing between a stranger who found us in a
 * search and being told the day we open.
 *
 * The unit suites hold the words and the markup (`site/join-list.test.tsx`, `site/doors-closed.
 * test.ts`). What only a browser can say is whether it is USABLE: whether it fits a 390px phone
 * without a sideways scroll, whether a thumb can hit the field and the button, whether it reads in
 * the dark, and whether the whole thing works with the gateway absent, which is exactly the state
 * the dial defaults to.
 *
 * This runs on the suite's own hermetic server, which has no gateway URL at all — so the dial
 * cannot be read, closed is the answer, and the page under test is the page a stranger meets.
 */

import { expect, type Page, test } from '@playwright/test';

const WIDTHS = [
  { name: '390', w: 390, h: 844 },
  { name: '1440', w: 1440, h: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;

/** The touch floor the plan sets (WOBO-PLAN §18). */
const THUMB = 44;

test.describe.configure({ mode: 'serial' });

async function wear(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(60);
}

test('the sign-up address is the invitation, and offers no way to create an account', async ({
  page,
}) => {
  await page.goto('/sign-up', { waitUntil: 'networkidle' });
  // A cold vite pre-bundles this route's chunk on the first hit of the run.
  await expect(page.locator('.jl-form')).toBeVisible({ timeout: 45_000 });

  await expect(page.locator('.jl-title')).toContainText('not open yet');
  // two fields, and the second is not required
  await expect(page.locator('.jl-form input:not([type="hidden"])')).toHaveCount(2);
  await expect(page.locator('.jl-form input[type="email"]')).toHaveAttribute('required', '');
  expect(await page.locator('.jl-form input[name="where"]').getAttribute('required')).toBeNull();
  // nothing that creates an account: no password, no provider, no address for the first run
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('a[href="/onboarding"]')).toHaveCount(0);
  // and the door for someone who already has an account is still open, at the same address
  await expect(page.locator('a[href="/sign-in"]').first()).toBeVisible();
});

test('the front page hands a visitor to the list rather than to a first run', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('header a.btn.pig')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('header a.btn.pig')).toHaveAttribute('href', '/sign-up');
  await expect(page.locator('a[href="/onboarding"]')).toHaveCount(0);
});

for (const size of WIDTHS) {
  for (const theme of THEMES) {
    test(`the invitation reads and can be used at ${size.name} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto('/sign-up', { waitUntil: 'networkidle' });
      await expect(page.locator('.jl-form')).toBeVisible({ timeout: 45_000 });
      await wear(page, theme);

      // 1. the page never asks the reader to scroll sideways to finish a sentence
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${size.name} ${theme} scrolls sideways`).toBeLessThanOrEqual(1);

      // 2. a thumb can hit every control
      for (const selector of [
        '.jl-form input[type="email"]',
        '.jl-form input[name="where"]',
        '.jl-go',
      ]) {
        const box = await page.locator(selector).boundingBox();
        expect(box, `${selector} is not on the page`).not.toBeNull();
        expect(box?.height ?? 0, `${selector} at ${size.name}`).toBeGreaterThanOrEqual(THUMB);
      }

      // 3. the words are readable: nothing under the label size the design law sets
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('.jl *'))) {
          const text = (el.textContent ?? '').trim();
          if (!text || el.children.length > 0) continue;
          const px = Number.parseFloat(getComputedStyle(el).fontSize);
          if (px < 13) out.push(`${el.className || el.tagName}: ${px}px`);
        }
        return out;
      });
      expect(small, `${size.name} ${theme} sets type below the floor`).toEqual([]);

      // 4. it is legible in this theme: ink and paper are not the same colour
      const contrast = await page.evaluate(() => {
        const title = document.querySelector('.jl-title');
        const field = document.querySelector('.jl-field');
        if (!title || !field) return null;
        return {
          ink: getComputedStyle(title).color,
          field: getComputedStyle(field).backgroundColor,
          paper: getComputedStyle(document.body).backgroundColor,
        };
      });
      expect(contrast).not.toBeNull();
      expect(contrast?.ink).not.toBe(contrast?.paper);
      expect(contrast?.field).not.toBe(contrast?.paper);

      // 5. the form can actually be filled in and sent, and it says out loud that it could not
      //    reach anybody rather than thanking a reader whose address was never kept
      await page.locator('.jl-form input[type="email"]').fill('reader@example.com');
      await page.locator('.jl-form input[name="where"]').fill('the board I follow');
      await page.locator('.jl-go').click();
      await expect(page.locator('.jl-said')).toBeVisible();
      await expect(page.locator('.jl-said')).not.toContainText('on the list');
    });
  }
}
