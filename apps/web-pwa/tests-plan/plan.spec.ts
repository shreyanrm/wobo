import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded, watchConsole } from '../tests/helpers';

const BRAIN = 'http://127.0.0.1:9987';
const END = '2099-10-04T00:00:00Z';

const ACTIVE = {
  plan: 'pro',
  effective_plan: 'pro',
  status: 'active',
  source: 'web',
  cancel_at_period_end: false,
  period_end: END,
  cancelled_at: null,
  can_cancel: true,
  can_resume: false,
  line: 'running',
};
const CANCELLING = {
  ...ACTIVE,
  status: 'cancelling',
  cancel_at_period_end: true,
  cancelled_at: '2026-09-04T00:00:00Z',
  can_cancel: false,
  can_resume: true,
  line: 'cancelled',
};

async function wire(page: Page, cancelPlan: () => unknown) {
  // Playwright matches handlers in REVERSE registration order, so the catch-all goes on first and
  // the specific routes on top of it. (Registered the other way round it swallows everything, and
  // the panel reads "Free" for a learner the brain says is on Pro — which is how this was found.)
  await page.route(`${BRAIN}/**`, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(`${BRAIN}/v1/me`, (r) =>
    r.fulfill({ json: { subject: 's1', anonymous: false, plan: 'pro', budget: {} } }),
  );
  await page.route(`${BRAIN}/v1/me/subscription`, (r) => r.fulfill({ json: ACTIVE }));
  await page.route(`${BRAIN}/v1/me/subscription/cancel`, (r) => {
    const out = cancelPlan() as { status: number; body: unknown };
    return r.fulfill({ status: out.status, json: out.body as object });
  });
}

test('two taps reach the confirmation and a refused cancel leaves the plan active', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  let calls = 0;
  await seedOnboarded(page);
  await wire(page, () => {
    calls += 1;
    return calls === 1
      ? {
          status: 503,
          body: {
            detail: {
              code: 'store_unavailable',
              message: 'I could not change your plan just now. Nothing has changed.',
            },
          },
        }
      : { status: 200, body: CANCELLING };
  });
  await page.goto('/you');

  const panel = page.locator('.wk-card', { has: page.getByText('Your plan', { exact: true }) });
  await expect(panel.getByRole('heading', { name: 'Pro' })).toBeVisible();
  await expect(panel.getByText(/Your plan runs until 4 October 2099\./)).toBeVisible();

  // TAP ONE — the Cancel control is on the panel itself.
  const cancel = panel.getByRole('button', { name: 'Cancel plan' });
  await expect(cancel).toBeEnabled();
  await cancel.click();

  const dialog = page.getByRole('dialog', { name: 'Cancel your plan' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveCount(2);
  await expect(dialog.getByText(/You keep Pro until 4 October 2099/)).toBeVisible();
  await expect(dialog.getByText(/Nothing is charged after that/)).toBeVisible();
  await expect(dialog.getByText(/Everything you have learnt stays/)).toBeVisible();
  // focus went in
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

  // the trap: Tab cycles between the two choices and never leaves
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }

  // TAP TWO — and the server refuses.
  await dialog.getByRole('button', { name: 'Cancel the plan' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Nothing has changed');
  // THE PLAN IS UNCHANGED behind it
  await expect(panel.getByText(/Your plan runs until 4 October 2099\./)).toBeVisible();
  await expect(panel.getByText('active', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Cancel plan' })).toBeVisible();

  // retry: one tap, and it lands
  await dialog.getByRole('button', { name: 'Cancel the plan' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText(/Pro until 4 October 2099, then free\./)).toBeVisible();
  await expect(panel.getByText(/Nothing will be charged again\./)).toBeVisible();
  await expect(panel.getByText(/Everything you have learnt stays/)).toBeVisible();
  await expect(panel.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Resume the plan' })).toBeVisible();
  expect(calls).toBe(2);
  // The 503 is the one this test STAGED; the browser logs every failed response as a resource
  // error. Anything else in here would be a real defect.
  expect(
    errors.filter((e) => !e.includes('503')),
    errors.join('\n'),
  ).toEqual([]);
  info.attach('ok', { body: 'ok', contentType: 'text/plain' });
});

test('escape leaves the confirmation and puts focus back on Cancel plan', async ({ page }) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await wire(page, () => ({ status: 200, body: CANCELLING }));
  await page.goto('/you');
  const panel = page.locator('.wk-card', { has: page.getByText('Your plan', { exact: true }) });
  await panel.getByRole('button', { name: 'Cancel plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel your plan' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('wp-cancel');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a gateway that is entirely down never draws the plan as Free', async ({ page }) => {
  // The failure this test exists for: `GET /v1/me` and `GET /v1/me/subscription` ride the same
  // gateway, so when it is down BOTH are silent. The panel used to read that silence as the free
  // plan and settle on it — heading "Free", the free allowance line, a door to the plans, no
  // error, no Cancel. A confident claim about somebody's money, assembled out of an outage, on
  // the only door out of a plan that cannot be refunded.
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await page.route(`${BRAIN}/**`, (r) => r.fulfill({ status: 503, body: '' }));
  await page.goto('/you');

  const panel = page.locator('.wk-card', { has: page.getByText('Your plan', { exact: true }) });
  await expect(panel.getByText(/I could not read your plan just now/)).toBeVisible();
  await expect(panel.getByText(/Nothing has changed/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
  // Not Free, and no free allowance line under it.
  await expect(panel.getByRole('heading', { name: 'Free' })).toHaveCount(0);
  await expect(panel.getByText(/Enough for a normal evening/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'See the plans' })).toHaveCount(0);
  // Every console error here is the 503 this test staged.
  expect(
    errors.filter((e) => !e.includes('503')),
    errors.join('\n'),
  ).toEqual([]);
});

for (const width of [390, 834, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`no horizontal scroll at ${width} in ${theme}, panel and confirmation`, async ({
      page,
    }) => {
      const errors = watchConsole(page);
      await seedOnboarded(page);
      await page.addInitScript((t) => localStorage.setItem('wobo-theme-v1', t), theme);
      await wire(page, () => ({ status: 200, body: CANCELLING }));
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/you');
      const panel = page.locator('.wk-card', { has: page.getByText('Your plan', { exact: true }) });
      await expect(panel.getByRole('button', { name: 'Cancel plan' })).toBeVisible();
      const flat = () =>
        page.evaluate(() => ({
          w: document.documentElement.scrollWidth,
          c: document.documentElement.clientWidth,
        }));
      expect(await flat()).toEqual({ w: width, c: width });
      await panel.getByRole('button', { name: 'Cancel plan' }).click();
      await expect(page.getByRole('dialog', { name: 'Cancel your plan' })).toBeVisible();
      expect(await flat()).toEqual({ w: width, c: width });
      await page.screenshot({
        path: `tests-plan/shots/plan-${width}-${theme}.png`,
        fullPage: false,
      });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}
