/**
 * THE PERIOD SWITCH ON /plans, measured in a real browser.
 *
 * `src/screens/plans/period.test.ts` holds the words and the figures; two of the promises made
 * about this control can only be proved with layout, so they are proved here:
 *
 *  1. A CARD CANNOT CHANGE HEIGHT WHEN THE SWITCH IS USED. That is the whole reason the monthly
 *     period keeps a "billed monthly" line it does not strictly need (docs/PRICING.md, owner,
 *     2026-09-04): a card that grew or shrank would shove the page under the reader's thumb at the
 *     exact moment they are comparing two prices. Every card is measured on both periods, at all
 *     three contract widths.
 *  2. THE PAGE SPEAKS IN ONE PERIOD. With monthly chosen, nothing rendered outside the control
 *     itself says "year" or "annual" — not a price, not a line of small print, not a consent box,
 *     not the closing sentence and not an answer about cancelling.
 *
 * And the two rulings that go with them: yearly is selected on load, because it is the better deal;
 * and THE ANNUAL TOTAL IS NOWHERE ON THIS PAGE. docs/PRICING.md's table gives the plans page the
 * per-month amount and the words and gives the total to the checkout, and its Still-to-build item
 * 2 says it in one line: "It must not appear on the plans page." It did, twice — `Today ₹19,992`
 * in the checkout preview and, under it, a sentence naming the day the next charge would be taken.
 * The second half broke a second law as well: billing.py rule 2, in capitals, is "NOTHING IN THIS
 * REPO RENEWS A SUBSCRIPTION, and no user-facing line may say one does."
 */

import { expect, type Page, test } from '@playwright/test';

const WIDTHS = [
  { name: '1440', w: 1440, h: 900 },
  { name: '834', w: 834, h: 1112 },
  { name: '390', w: 390, h: 844 },
];

const CARDS = ['.pl-plan.pl-pro', '.pl-plan.pl-max', '.pl-plan:not(.pl-pro):not(.pl-max)'];

test.describe.configure({ mode: 'serial' });

/** Open every question, so nothing the page can say is hidden from the text assertions. */
async function openEverything(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll('details'))) d.open = true;
  });
}

async function choose(page: Page, label: 'Yearly' | 'Monthly'): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // the indicator only ever translates, so the settle is the transition and nothing relayouts
  await page.waitForTimeout(420);
}

/** The page's own words, with the control's two segment labels left out. */
async function spoken(page: Page): Promise<string> {
  const regions = ['.pl-plans', '.pl-close-line', '.pl-checkout', '.pl-faq'];
  const parts: string[] = [];
  for (const region of regions) parts.push(await page.locator(region).innerText());
  return parts.join('\n');
}

test('opens on yearly, because yearly is the better deal', async ({ page }) => {
  await page.goto('/plans', { waitUntil: 'networkidle' });
  const seg = page.locator('.pl-seg');
  await expect(seg).toBeVisible();
  const labels = await seg.locator('button').allInnerTexts();
  expect(labels).toEqual(['Yearly', 'Monthly']);
  await expect(seg.getByRole('button', { name: 'Yearly', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.pl-plan.pl-pro .pl-billed')).toHaveText('billed annually');
});

for (const size of WIDTHS) {
  test(`a card is the same height on both periods at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.goto('/plans', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const heights = async (): Promise<number[]> => {
      const out: number[] = [];
      for (const card of CARDS) {
        const box = await page.locator(card).first().boundingBox();
        out.push(box?.height ?? -1);
      }
      return out;
    };

    await choose(page, 'Yearly');
    const yearly = await heights();
    await choose(page, 'Monthly');
    const monthly = await heights();

    for (const [i, card] of CARDS.entries()) {
      expect(
        Math.abs((yearly[i] as number) - (monthly[i] as number)),
        `${card} at ${size.name}: yearly ${yearly[i]}px, monthly ${monthly[i]}px`,
      ).toBeLessThan(0.5);
      expect(yearly[i] as number).toBeGreaterThan(0);
    }

    // and the page never has to be scrolled sideways to finish a sentence
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('says nothing about a year once monthly is chosen', async ({ page }) => {
  await page.goto('/plans', { waitUntil: 'networkidle' });
  await openEverything(page);

  await choose(page, 'Yearly');
  const onYearly = await spoken(page);
  expect(onYearly).toContain('billed annually');
  expect(onYearly).toContain('until the year you paid for ends');

  await choose(page, 'Monthly');
  await openEverything(page);
  const onMonthly = await spoken(page);
  expect(onMonthly).toContain('billed monthly');
  expect(onMonthly).not.toMatch(/year|annual/i);
});

test('states no annual total anywhere, and names no future charge', async ({ page }) => {
  await page.goto('/plans', { waitUntil: 'networkidle' });
  await openEverything(page);
  await choose(page, 'Yearly');

  // The per-month figure IS on the page, so the total is looked for as twelve-ish times it rather
  // than as a fixed string: the market is the browser's and the currency follows it.
  await expect(page.locator('.pl-checkout .pl-total')).toHaveCount(0);
  await expect(page.locator('.pl-checkout .pl-taken')).toHaveCount(0);

  const words = await spoken(page);
  // The four annual totals docs/PRICING.md sets, named literally: the per-month figures are also
  // four-digit rupee amounts (₹1,999, ₹3,999), so a shape-based rule would catch the wrong thing.
  expect(words).not.toMatch(/₹19,992|₹39,996|\$200\b|\$500\b/);
  // and no sentence naming a day something will be taken
  expect(words).not.toMatch(/the next is taken/i);
  // and nothing CLAIMS a renewal. The word itself is allowed where a line denies one ("nothing
  // renews after that"), which is the cancel answer doing its job; copy.test.ts holds that rule
  // over every string, with the denials named.
  expect(words).not.toMatch(/this renews|renews (yearly|monthly)|will renew|auto-renew/i);
  // what it does say is the words for the period, which is what this page is allowed to say
  expect(words).toContain('billed annually');
});

test('offers no payment it cannot take: the door carries soon, not an apology', async ({
  page,
}) => {
  await page.goto('/plans', { waitUntil: 'networkidle' });
  const door = page.locator('.pl-checkout .pl-pay');
  await expect(door).toBeVisible();
  await expect(door).toHaveAttribute('aria-disabled', 'true');
  await expect(door.locator('.pl-soon')).toHaveText('soon');
  const describedBy = await door.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toContainText('not open yet');
  // it is not the loud one: the saturated control on this page is a plan's own door, not this
  await expect(door).not.toHaveClass(/st-pig/);
  // and pressing it goes nowhere, so nothing promises a payment and delivers an explanation
  const before = page.url();
  await door.click({ force: true });
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
});

test('says one learner, on every plan and both periods', async ({ page }) => {
  // docs/PRICING.md, "The rule": a subscription covers exactly one learner on every plan and every
  // period. The page said "Learners on the plan: 2" and "two learners" at checkout.
  await page.goto('/plans', { waitUntil: 'networkidle' });
  await openEverything(page);
  for (const label of ['Yearly', 'Monthly'] as const) {
    await choose(page, label);
    await openEverything(page);
    expect(await spoken(page)).not.toMatch(/two learners/i);
  }
});
