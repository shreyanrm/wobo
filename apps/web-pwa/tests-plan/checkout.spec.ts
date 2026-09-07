/**
 * THE CHECKOUT, walked in a real browser against a fake gateway and a fake provider script.
 *
 * `src/screens/plans/checkout-flow.test.ts` proves the steps over the model; this proves them over
 * the page: choose, the provider's script loaded only then, the modal opened with the right
 * options, "Confirming with the bank" until the plan endpoint says active, and then the plan shown.
 * Plus the two states that must never lie: a dismissed modal, a failed payment; and the
 * payments-off door at 390 and 1440, photographed.
 *
 * The gateway is `page.route` (see plan.spec.ts for why this suite is the one with a brain), and
 * `checkout.js` is answered by a stub that records what it was opened with and exposes the
 * handler, `modal.ondismiss` and `payment.failed` so the test can play the bank.
 */

import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded, watchConsole } from '../tests/helpers';

const BRAIN = 'http://127.0.0.1:9987';
const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';
const END = '2027-10-04T00:00:00Z';

const FREE = {
  plan: 'free',
  status: 'free',
  source: 'web',
  period_end: null,
  can_cancel: false,
  can_resume: false,
};
const ACTIVE = {
  plan: 'pro',
  status: 'active',
  source: 'web',
  cancel_at_period_end: false,
  period_end: END,
  can_cancel: true,
  can_resume: false,
};

/** A stand-in for the provider's script: same constructor shape, no network, everything recorded. */
const STUB_JS = `
window.__rzp = { opened: 0, instance: null };
window.Razorpay = function (options) {
  this.options = options;
  this.handlers = {};
  window.__rzp.instance = this;
};
window.Razorpay.prototype.open = function () { window.__rzp.opened += 1; };
window.Razorpay.prototype.on = function (event, cb) { this.handlers[event] = cb; };
`;

interface Wiring {
  on: boolean;
  subscription: () => unknown;
  checkoutBodies?: unknown[];
}

async function wire(page: Page, w: Wiring): Promise<string[]> {
  const provider: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('razorpay')) provider.push(r.url());
  });
  await page.route(`${BRAIN}/**`, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(`${BRAIN}/v1/me`, (r) =>
    r.fulfill({ json: { subject: 's1', anonymous: false, plan: 'free', budget: {} } }),
  );
  // The gateway's public health carries the payments check (health.py, `_payments_check`).
  await page.route(`${BRAIN}/healthz`, (r) =>
    r.fulfill({
      json: {
        status: w.on ? 'healthy' : 'degraded',
        checks: { payments: { status: 'ok', payments: w.on ? 'on' : 'off' } },
      },
    }),
  );
  await page.route(`${BRAIN}/v1/billing/checkout`, (r) => {
    w.checkoutBodies?.push(r.request().postDataJSON());
    return r.fulfill({ json: { subscription_id: 'sub_e2e', key_id: 'rzp_test_e2e' } });
  });
  await page.route(`${BRAIN}/v1/me/subscription`, (r) =>
    r.fulfill({ json: w.subscription() as object }),
  );
  await page.route(CHECKOUT_JS, (r) =>
    r.fulfill({ contentType: 'application/javascript', body: STUB_JS }),
  );
  return provider;
}

const door = (page: Page) => page.locator('.pl-checkout .pl-pay');
const status = (page: Page) => page.locator('.pl-checkout .pl-status');

async function tickBoth(page: Page): Promise<void> {
  await page.locator('#consent-terms').check();
  await page.locator('#consent-renewal').check();
}

test('choose, the provider modal, confirming with the bank, then the plan shown', async ({
  page,
}) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  let reads = 0;
  const bodies: unknown[] = [];
  const provider = await wire(page, {
    on: true,
    // the webhook lands on the third read: two polls say free, the third says Pro is active
    subscription: () => (++reads >= 3 ? ACTIVE : FREE),
    checkoutBodies: bodies,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/plans');

  // ON: the door carries the tier's words, the amount taken today is stated, and the provider's
  // script has NOT been loaded for a reader who is only looking.
  await expect(door(page)).toHaveText('Choose Pro');
  await expect(door(page)).toBeEnabled();
  await expect(page.locator('.pl-checkout .pl-total')).toContainText(
    /(₹19,992|\$200) for the year/,
  );
  // and never on the cards
  await expect(page.locator('.pl-plans')).not.toContainText(/₹19,992|\$200\b/);
  expect(provider).toEqual([]);

  // Both boxes are the reader's to tick.
  await door(page).click();
  await expect(status(page)).toHaveText('Tick both boxes first, then choose your plan.');
  expect(provider).toEqual([]);

  await tickBoth(page);
  await door(page).click();

  // The gateway was asked for THIS plan on THIS period, and only then the script.
  await page.waitForFunction(
    () => (window as unknown as { __rzp?: { opened: number } }).__rzp?.opened === 1,
  );
  expect(bodies).toEqual([{ plan: 'pro', period: 'yearly' }]);
  expect(provider).toEqual([CHECKOUT_JS]);
  const opened = await page.evaluate(() => {
    const rzp = (window as unknown as { __rzp: { instance: { options: Record<string, unknown> } } })
      .__rzp;
    return rzp.instance.options;
  });
  expect(opened.key).toBe('rzp_test_e2e');
  expect(opened.subscription_id).toBe('sub_e2e');
  expect(opened.name).toBe('Wobo');
  expect(opened.description).toBe('Pro, yearly');
  expect(opened.prefill).toEqual({ name: 'Learner' });
  expect(opened.theme).toEqual({ color: '#2B45FF' });
  expect('amount' in opened).toBe(false);
  await expect(door(page)).toHaveText('Opening the payment page');
  await expect(door(page)).toBeDisabled();

  // The bank says yes. THE HANDLER DOES NOT FLIP THE PLAN: the screen confirms, then reads.
  await page.evaluate(() => {
    const rzp = (
      window as unknown as { __rzp: { instance: { options: { handler: (r: unknown) => void } } } }
    ).__rzp;
    rzp.instance.options.handler({
      razorpay_payment_id: 'pay_e2e',
      razorpay_subscription_id: 'sub_e2e',
      razorpay_signature: 'sig',
    });
  });
  await expect(status(page)).toHaveText('Confirming with the bank.');
  await expect(door(page)).toHaveText('Confirming with the bank');
  await expect(status(page)).toHaveText("You're on Pro. It runs until 4 October 2027.", {
    timeout: 15_000,
  });
  expect(reads).toBeGreaterThanOrEqual(3);
  await expect(door(page)).toHaveText('Choose Pro');
  await expect(door(page)).toBeEnabled();
  await page.locator('#checkout').scrollIntoViewIfNeeded();
  await page.locator('#checkout').screenshot({ path: 'shots/checkout/confirmed-1440.png' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a dismissed modal changes nothing, in one calm line', async ({ page }) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  let reads = 0;
  await wire(page, {
    on: true,
    subscription: () => {
      reads += 1;
      return FREE;
    },
  });
  await page.goto('/plans');
  await tickBoth(page);
  await door(page).click();
  await page.waitForFunction(
    () => (window as unknown as { __rzp?: { opened: number } }).__rzp?.opened === 1,
  );
  await page.evaluate(() => {
    const rzp = (
      window as unknown as {
        __rzp: { instance: { options: { modal: { ondismiss: () => void } } } };
      }
    ).__rzp;
    rzp.instance.options.modal.ondismiss();
  });
  await expect(status(page)).toHaveText(
    'Nothing was charged. Choose a plan whenever you are ready.',
  );
  await expect(door(page)).toHaveText('Choose Pro');
  await expect(door(page)).toBeEnabled();
  // nothing was polled, because nothing was paid
  expect(reads).toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test("a failed payment says the bank's reason, offers another try, blames nobody", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await wire(page, { on: true, subscription: () => FREE });
  await page.goto('/plans');
  await tickBoth(page);
  await door(page).click();
  await page.waitForFunction(
    () => (window as unknown as { __rzp?: { opened: number } }).__rzp?.opened === 1,
  );
  await page.evaluate(() => {
    const rzp = (
      window as unknown as {
        __rzp: { instance: { handlers: Record<string, (f: unknown) => void> } };
      }
    ).__rzp;
    rzp.instance.handlers['payment.failed']?.({
      error: { code: 'BAD_REQUEST_ERROR', description: 'Card declined by the bank', reason: 'x' },
    });
  });
  await expect(status(page)).toContainText(
    'The bank did not approve that payment: Card declined by the bank. Nothing was charged. Try again, or use another card or UPI.',
  );
  // the modal closes; the reason stays, and the door is open again
  await page.evaluate(() => {
    const rzp = (
      window as unknown as {
        __rzp: { instance: { options: { modal: { ondismiss: () => void } } } };
      }
    ).__rzp;
    rzp.instance.options.modal.ondismiss();
  });
  await expect(status(page)).toContainText('Card declined by the bank');
  await expect(door(page)).toHaveText('Choose Pro');
  await expect(door(page)).toBeEnabled();
  expect(errors, errors.join('\n')).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`payments off at ${width}: the door says so, does nothing, loads nothing`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await seedOnboarded(page);
    const provider = await wire(page, { on: false, subscription: () => FREE });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/plans');
    await expect(door(page)).toHaveText('Payments are not switched on yet');
    await expect(door(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.pl-checkout .pl-total')).toHaveCount(0);
    await tickBoth(page);
    await door(page).click({ force: true });
    await page.waitForTimeout(300);
    await expect(status(page)).toHaveCount(0);
    expect(provider).toEqual([]);
    const flat = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth,
    }));
    expect(flat).toEqual({ w: width, c: width });
    await page.locator('#checkout').scrollIntoViewIfNeeded();
    await page.locator('#checkout').screenshot({ path: `shots/checkout/off-${width}.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
