/**
 * THE TWO DOORS, IN A REAL BROWSER, REPEATABLY.
 *
 * The auth wave's browser proof was real and none of it was repeatable: it was taken by starting a
 * second vite server by hand with `VITE_DEV_AUTH=false` and stand-in Supabase keys. Under the
 * suite's own server (`VITE_DEV_AUTH=true`, blank keys) `client.ts` finds no wired seam, so both
 * doors render zero controls — no field, no rule, no providers, no form — and there was no spec in
 * this directory that opened either address. A regression to the ruled line, the pigment drawn
 * across on focus, the invalid state or the tab order would have shipped in silence.
 *
 * So the config now runs a second dev server with live auth and keys that name a closed loopback
 * port, and this file is the only spec pointed at it (`projects[1]`, "auth"). What is proved here
 * is what only a browser can prove; the shapes and the words are held by the unit suites
 * (`doors.test.ts`, `field.test.ts`, `problem.test.ts`, `styles.test.ts`, `copy.test.ts`).
 */

import { expect, type Page, test } from '@playwright/test';

const WIDTHS = [
  { name: '1440', w: 1440, h: 900 },
  { name: '834', w: 834, h: 1112 },
  { name: '390', w: 390, h: 844 },
];

const THEMES = ['light', 'dark'] as const;

test.describe.configure({ mode: 'serial' });

/** Stamp a theme the way a reader's own choice does, and let the sheet settle. */
async function wear(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(60);
}

/** Everything a keyboard can land on, in document order, as `tag:identity`. */
async function tabbable(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const selector =
      'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.offsetParent !== null || el.classList.contains('au-skip'))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}:${el.id || (el.textContent ?? '').trim().slice(0, 28)}`,
      );
  });
}

test('both doors are actually wired here, which is the point of this server', async ({ page }) => {
  for (const door of ['/sign-in', '/sign-up']) {
    await page.goto(door, { waitUntil: 'networkidle' });
    // A cold vite pre-bundles this route's chunk on the first hit of the run, which can take
    // longer than the suite's 10s expect timeout; every assertion after this one is warm.
    await expect(page.locator('.au-field').first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#au-who')).toBeVisible();
    // a rule with a word in it is drawn only when both sides have something, and both do
    await expect(page.locator('.au-or')).toBeVisible();
    await expect(page.locator('.au-prov')).toHaveCount(2);
    await expect(page.locator('.au-btn.au-go')).toBeVisible();
  }
});

test('the ruled line takes the pigment on focus, drawn across from the left', async ({ page }) => {
  await page.goto('/sign-in', { waitUntil: 'networkidle' });
  const at_rest = await page.evaluate(() => {
    const field = document.querySelector('.au-field') as HTMLElement;
    return getComputedStyle(field, '::after').transform;
  });
  // scaleX(0) is matrix(0, 0, 0, 1, 0, 0); nothing is parked mid-animation on the first paint
  expect(at_rest.startsWith('matrix(0,')).toBe(true);

  await page.locator('#au-who').focus();
  await page.waitForTimeout(500);
  const focused = await page.evaluate(() => {
    const field = document.querySelector('.au-field') as HTMLElement;
    const glyph = field.querySelector('svg') as SVGElement;
    return {
      rule: getComputedStyle(field, '::after').transform,
      glyph: getComputedStyle(glyph).color,
      // the field is not a box: no border on it or on the input inside it
      border: getComputedStyle(field).borderTopWidth,
      inputBorder: getComputedStyle(field.querySelector('input') as HTMLElement).borderTopWidth,
      inputBackground: getComputedStyle(field.querySelector('input') as HTMLElement)
        .backgroundColor,
    };
  });
  expect(focused.rule).toBe('matrix(1, 0, 0, 1, 0, 0)');
  expect(focused.glyph).toBe('rgb(43, 69, 255)');
  expect(focused.border).toBe('0px');
  expect(focused.inputBorder).toBe('0px');
  expect(focused.inputBackground).toBe('rgba(0, 0, 0, 0)');
});

/**
 * THE BUG THIS FILE EXISTS FOR, reproduced and then held shut.
 *
 * A valid phone number, a valid date of birth, the consent box left unticked. The page used to
 * mark the PHONE FIELD `aria-invalid`, point its `aria-describedby` at "I need you to agree to the
 * terms and the privacy policy first", paint its rule rose — and leave the checkbox that was
 * actually wrong with nothing at all. A screen-reader user was told their correct answer was
 * invalid and handed a sentence about something else.
 */
test('marks the control that is wrong, and not the one that is right', async ({ page }) => {
  await page.goto('/sign-up', { waitUntil: 'networkidle' });
  await page.locator('#au-who').fill('9876543210');
  await page.locator('#au-birth').fill('2005-04-11');
  await expect(page.locator('#au-agree')).not.toBeChecked();
  await page.locator('.au-btn.au-go').click();

  await expect(page.locator('.au-error')).toBeVisible();
  await expect(page.locator('.au-error')).toContainText('agree to the terms');

  // the tick is the thing in the way, and it says so in two ways: the mark and the sentence
  await expect(page.locator('.au-consent')).toHaveAttribute('data-invalid', 'true');
  await expect(page.locator('#au-agree')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#au-agree')).toHaveAttribute('aria-describedby', 'au-error');

  // and the number that was fine is not called wrong
  const who = page.locator('#au-who');
  expect(await who.getAttribute('aria-invalid')).toBeNull();
  expect(await who.getAttribute('aria-describedby')).toBe('au-who-hint');
  await expect(page.locator('.au-field[data-invalid="true"]')).toHaveCount(0);
});

test('marks the ruled line when the ruled line is what is wrong', async ({ page }) => {
  await page.goto('/sign-up', { waitUntil: 'networkidle' });
  await page.locator('#au-birth').fill('2005-04-11');
  await page.locator('#au-agree').check();
  await page.locator('#au-who').fill('12');
  await page.locator('.au-btn.au-go').click();

  await expect(page.locator('.au-error')).toBeVisible();
  await expect(page.locator('#au-who')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#au-who')).toHaveAttribute('aria-describedby', 'au-who-hint au-error');
  // the rose rule, and the consent box left alone
  const rule = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector('.au-field') as HTMLElement, '::before')
        .backgroundColor,
  );
  expect(rule).toBe('rgb(255, 107, 87)');
  expect(await page.locator('.au-consent').getAttribute('data-invalid')).toBeNull();
});

test('a door that is not open keeps its shape, carries soon, and is still reachable', async ({
  page,
}) => {
  await page.goto('/sign-in', { waitUntil: 'networkidle' });
  const shut = page.locator('.au-prov[aria-disabled="true"]');
  await expect(shut).toHaveCount(1);
  await expect(shut.locator('.au-soon')).toHaveText('soon');
  // the whole truth is the button's description, not an apology printed under a dead slab
  const describedBy = await shut.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toHaveText('This way in is not switched on yet.');

  const order = await tabbable(page);
  // the skip link, the wordmark, the other door, the field, the open provider and the shut one
  expect(order.some((item) => item.includes('Skip to the page'))).toBe(true);
  expect(order.some((item) => item === 'input:au-who')).toBe(true);
  expect(order.filter((item) => item.startsWith('button:Continue with'))).toHaveLength(2);
});

for (const size of WIDTHS) {
  for (const theme of THEMES) {
    test(`stands still at ${size.name} in ${theme}, with nothing hidden and nothing sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto('/sign-up', { waitUntil: 'networkidle' });
      await wear(page, theme);
      await page.evaluate(() => document.fonts.ready);

      // The first paint is the page at rest: nothing parked at opacity 0 waiting for a scroll.
      // Wobo's own drawing is left out — the rig keeps a blink and a couple of moods folded away
      // inside its SVG, which is the character being alive rather than the page being unpainted.
      const faded = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('.au *')).filter(
            (el) => el.closest('svg') === null && Number(getComputedStyle(el).opacity) === 0,
          ).length,
      );
      expect(faded).toBe(0);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await expect(page.locator('#au-who')).toBeVisible();
      await expect(page.locator('.au-btn.au-go')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}
