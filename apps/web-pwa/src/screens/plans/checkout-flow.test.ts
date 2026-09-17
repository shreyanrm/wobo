/**
 * THE CHECKOUT, held to the four promises the plans page makes about money (docs/PRICING.md,
 * DESIGN.md §0, voice.md 10a), with no browser and no provider in the room:
 *
 *  1. The button never lies. Payments off, the control says so and does nothing; on, it starts a
 *     checkout on the gateway and only then loads the provider's script.
 *  2. The handler does not flip the plan. Paying puts the screen into "Confirming with the bank",
 *     and only the plan endpoint saying `active` ends that, or the clock does, honestly.
 *  3. A dismissed modal changes nothing; a failed payment says the bank's reason, in plain words,
 *     and blames nobody.
 *  4. Every line obeys the register: no em dash, no exclamation mark, no vendor named to a learner.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureGatewayAuth } from '@wobo/sdk';
import type { Subscription, SubscriptionRead } from '../you/billing';
import {
  awaitConfirmation,
  CHECKOUT_JS,
  CHECKOUT_LINES,
  CHECKOUT_PATHS,
  type CheckoutState,
  CONFIRM_EVERY_MS,
  CONFIRM_FOR_MS,
  checkoutOptions,
  checkoutReducer,
  failureLine,
  initialCheckout,
  loadCheckoutJs,
  parseCheckoutSession,
  parsePaymentsConfig,
  readPaymentsConfig,
  showsCheckoutPreviewLink,
  startCheckout,
  WOBO_COLOUR,
} from './checkout-flow';

const GATEWAY = 'http://brain.test';

type Call = { url: string; init?: RequestInit };

/** A fetch that answers with one body and remembers what it was asked. */
function answering(status: number, body: unknown, calls: Call[] = []) {
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
  return { fetcher, calls };
}

const ACTIVE: Subscription = {
  state: 'active',
  planId: 'pro',
  planName: null,
  periodEnd: '2027-10-04T00:00:00Z',
  renews: true,
  source: 'web',
  canCancel: true,
  canResume: false,
  line: null,
};
const FREE: Subscription = { ...ACTIVE, state: 'free', planId: 'free', canCancel: false };

/** What `GET /healthz` answers when the provider keys are present (health.py, `_payments_check`). */
const ON = {
  status: 'healthy',
  checks: { payments: { status: 'ok', payments: 'on', last_webhook_at: null } },
};

// --- payments on or off --------------------------------------------------------------------------

describe('whether payments are switched on', () => {
  it("is on only when the gateway's health says the word, and off on every other shape", () => {
    expect(parsePaymentsConfig(ON)).toEqual({ on: true });
    expect(parsePaymentsConfig({ checks: { payments: { payments: 'off' } } })).toEqual({
      on: false,
    });
    expect(parsePaymentsConfig({ checks: { payments: { status: 'ok' } } })).toEqual({ on: false });
    expect(parsePaymentsConfig({ checks: {} })).toEqual({ on: false });
    expect(parsePaymentsConfig({ payments_on: true, key_id: 'rzp_test_abc' })).toEqual({
      on: false,
    });
    expect(parsePaymentsConfig(null)).toEqual({ on: false });
    expect(parsePaymentsConfig('yes')).toEqual({ on: false });
  });

  it('reads off with no gateway, a 404, a refusal or a body it cannot parse', async () => {
    expect(await readPaymentsConfig('', answering(200, {}).fetcher)).toEqual({ on: false });
    expect(await readPaymentsConfig(GATEWAY, answering(404, undefined).fetcher)).toEqual({
      on: false,
    });
    expect(await readPaymentsConfig(GATEWAY, answering(503, {}).fetcher)).toEqual({ on: false });
    const thrown = (async () => {
      throw new Error('offline');
    }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
    expect(await readPaymentsConfig(GATEWAY, thrown)).toEqual({ on: false });
  });

  it('reads on from the public health route, and nothing else', async () => {
    const { fetcher, calls } = answering(200, ON);
    expect(await readPaymentsConfig(GATEWAY, fetcher)).toEqual({ on: true });
    expect(calls.map((c) => c.url)).toEqual([`${GATEWAY}${CHECKOUT_PATHS.config}`]);
    expect(CHECKOUT_PATHS.config).toBe('/healthz');
  });

  /**
   * A HEALTH CHECK ASKS NOBODY WHO THEY ARE. The default fetcher used to be `gatewayFetch`, which
   * binds the learner's identity to every call, and binding it means establishing a session,
   * which is an anonymous sign-in against a project where anonymous sign-ins are off. So every
   * signed-out stranger who opened /plans got a 422 from POST /db/auth/v1/signup in their console
   * and Lighthouse's best-practices score dropped to 92 (wave 29, site-5). The guard on the
   * allowance card was holding; this call was the one that slipped past it. `/healthz` is public,
   * so it is fetched plain, and the identity layer is never consulted for it.
   */
  it('never asks the identity layer for a token to read the health route', async () => {
    let asked = 0;
    configureGatewayAuth({
      accessToken: async () => {
        asked += 1;
        return 'a-token-that-must-not-be-sent';
      },
    });
    const seen: { url: string; authorization: string | null }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), authorization: headers.get('authorization') });
      return new Response(JSON.stringify(ON), { status: 200 });
    }) as typeof fetch;
    try {
      expect(await readPaymentsConfig(GATEWAY)).toEqual({ on: true });
    } finally {
      globalThis.fetch = real;
      configureGatewayAuth({});
    }
    expect(seen).toEqual([{ url: `${GATEWAY}/healthz`, authorization: null }]);
    expect(asked).toBe(0);
  });
});

describe('the preview link under the door', () => {
  it('is drawn only while the card is a preview, never beside a live checkout', () => {
    // Payments on, the card IS the checkout; a link under it to a page headed "Paying is not
    // open yet" would be the dead door this file exists to remove.
    expect(showsCheckoutPreviewLink(null)).toBe(true);
    expect(showsCheckoutPreviewLink({ on: false })).toBe(true);
    expect(showsCheckoutPreviewLink({ on: true })).toBe(false);
  });
});

// --- starting a checkout -------------------------------------------------------------------------

describe('starting a checkout on the gateway', () => {
  it('posts the plan and the period, and reads the subscription id back', async () => {
    const { fetcher, calls } = answering(200, {
      subscription_id: 'sub_123',
      key_id: 'rzp_test_abc',
    });
    const out = await startCheckout('pro', 'yearly', null, GATEWAY, fetcher);
    expect(out).toEqual({
      ok: true,
      session: { subscriptionId: 'sub_123', keyId: 'rzp_test_abc' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${GATEWAY}${CHECKOUT_PATHS.start}`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ plan: 'pro', period: 'yearly' });
  });

  /**
   * A HONOURED PROMO CODE RIDES ALONG, and nothing else about it does. The browser never works out
   * what a code is worth (docs/ALLOWANCE.md §3: the gateway validates and applies), so the only
   * thing the session carries is the code itself, and only when there is one: with no code the
   * body is byte-for-byte what it was before this field existed.
   */
  it('carries a code the gateway already honoured, and no field at all without one', async () => {
    const withCode = answering(200, { subscription_id: 'sub_9', key_id: 'rzp_k' });
    await startCheckout('pro', 'yearly', 'WOBO50', GATEWAY, withCode.fetcher);
    expect(JSON.parse(String(withCode.calls[0]?.init?.body))).toEqual({
      plan: 'pro',
      period: 'yearly',
      promo: 'WOBO50',
    });
    const without = answering(200, { subscription_id: 'sub_9', key_id: 'rzp_k' });
    await startCheckout('pro', 'yearly', null, GATEWAY, without.fetcher);
    expect(Object.keys(JSON.parse(String(without.calls[0]?.init?.body)))).toEqual([
      'plan',
      'period',
    ]);
  });

  /**
   * The field name is the server's, not ours. The body once said `code`; the gateway's
   * CheckoutBody reads `promo` and ignores what it does not know, so the discount never reached
   * the provider and the full price was taken. Held against the Python source so a rename on
   * either side fails here.
   */
  it('names the promo field exactly as the gateway reads it', () => {
    const py = readFileSync(
      join(import.meta.dir, '../../../../../services/gateway/src/wobo_gateway/billing/payments.py'),
      'utf8',
    );
    const body = py.slice(py.indexOf('class CheckoutBody'), py.indexOf('def _refuse'));
    expect(body).toMatch(/^\s+promo: str \| None/m);
    expect(body).not.toMatch(/^\s+code: /m);
  });

  it('carries a key id of null when the gateway gives none, never an invented one', () => {
    expect(parseCheckoutSession({ subscription_id: 'sub_1' })).toEqual({
      subscriptionId: 'sub_1',
      keyId: null,
    });
    expect(parseCheckoutSession({ key_id: 'rzp_test_abc' })).toBeNull();
    expect(parseCheckoutSession(null)).toBeNull();
  });

  it('reports payments off when the gateway says so, with the server line', async () => {
    const { fetcher } = answering(503, {
      detail: { code: 'payments_off', message: 'Payments are not switched on yet.' },
    });
    expect(await startCheckout('max', 'monthly', null, GATEWAY, fetcher)).toEqual({
      ok: false,
      off: true,
      message: 'Payments are not switched on yet.',
    });
  });

  it('fails plainly on no gateway, a refusal, a body it cannot read, or a network that died', async () => {
    expect(await startCheckout('pro', 'yearly', null, '', answering(200, {}).fetcher)).toEqual({
      ok: false,
      off: true,
      message: null,
    });
    expect(
      await startCheckout('pro', 'yearly', null, GATEWAY, answering(401, { detail: 'no' }).fetcher),
    ).toEqual({ ok: false, off: false, message: null });
    expect(
      await startCheckout('pro', 'yearly', null, GATEWAY, answering(200, { nope: 1 }).fetcher),
    ).toEqual({ ok: false, off: false, message: null });
    const thrown = (async () => {
      throw new Error('offline');
    }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
    expect(await startCheckout('pro', 'yearly', null, GATEWAY, thrown)).toEqual({
      ok: false,
      off: false,
      message: null,
    });
  });
});

// --- the provider's script, loaded only when asked -----------------------------------------------

interface FakeScript {
  src: string;
  async: boolean;
  onload: null | (() => void);
  onerror: null | (() => void);
}

function fakeWindow(loads: boolean) {
  const scripts: FakeScript[] = [];
  const win = {
    Razorpay: undefined as unknown,
    document: {
      createElement: () => {
        const s: FakeScript = { src: '', async: false, onload: null, onerror: null };
        return s;
      },
      head: {
        appendChild: (s: FakeScript) => {
          scripts.push(s);
          queueMicrotask(() => {
            if (loads) {
              win.Razorpay = function Razorpay() {};
              s.onload?.();
            } else s.onerror?.();
          });
        },
      },
    },
  };
  return { win, scripts };
}

describe('the provider script', () => {
  it('is the standard checkout script, and is appended once, when asked, never on load', async () => {
    const { win, scripts } = fakeWindow(true);
    expect(scripts).toHaveLength(0);
    const ctor = await loadCheckoutJs(win as never);
    expect(typeof ctor).toBe('function');
    expect(scripts.map((s) => s.src)).toEqual([CHECKOUT_JS]);
    expect(CHECKOUT_JS).toBe('https://checkout.razorpay.com/v1/checkout.js');
    // asked twice, appended once
    await loadCheckoutJs(win as never);
    expect(scripts).toHaveLength(1);
  });

  it('says plainly when the script did not load', async () => {
    const { win } = fakeWindow(false);
    await expect(loadCheckoutJs(win as never)).rejects.toThrow(CHECKOUT_LINES.loadFailed);
  });
});

// --- what the modal is opened with ---------------------------------------------------------------

describe('the checkout options', () => {
  const paid: unknown[] = [];
  const dismissed: number[] = [];
  const options = checkoutOptions({
    keyId: 'rzp_test_abc',
    subscriptionId: 'sub_123',
    tierName: 'Pro',
    period: 'yearly',
    learnerName: 'Learner',
    onPaid: (r) => paid.push(r),
    onDismiss: () => dismissed.push(1),
  });

  it('carry the key, the subscription, the name and the colour, and nothing that sets an amount', () => {
    expect(options.key).toBe('rzp_test_abc');
    expect(options.subscription_id).toBe('sub_123');
    expect(options.name).toBe('Wobo');
    expect(options.description).toBe('Pro, yearly');
    expect(options.prefill).toEqual({ name: 'Learner' });
    expect(options.theme).toEqual({ color: WOBO_COLOUR });
    // the subscription carries its own amount; a client-set one would be a second opinion
    expect('amount' in options).toBe(false);
    expect('order_id' in options).toBe(false);
  });

  it('use the pointer colour from tokens.css, not a colour of their own', () => {
    const css = readFileSync(join(import.meta.dir, '..', '..', 'ui', 'tokens.css'), 'utf8');
    const pig = css.match(/--pig:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(pig?.toUpperCase()).toBe(WOBO_COLOUR.toUpperCase());
  });

  it('route the handler to onPaid and the modal dismissal to onDismiss', () => {
    options.handler({
      razorpay_payment_id: 'pay_1',
      razorpay_subscription_id: 'sub_123',
      razorpay_signature: 'sig',
    });
    options.modal.ondismiss();
    expect(paid).toHaveLength(1);
    expect(dismissed).toEqual([1]);
  });

  it('leave the name out when the learner has not given one', () => {
    const anon = checkoutOptions({
      keyId: 'k',
      subscriptionId: 's',
      tierName: 'Max',
      period: 'monthly',
      learnerName: '',
      onPaid: () => undefined,
      onDismiss: () => undefined,
    });
    expect(anon.prefill).toEqual({});
    expect(anon.description).toBe('Max, monthly');
  });
});

// --- the lines ----------------------------------------------------------------------------------

describe('the lines a learner reads', () => {
  const lines: string[] = [
    ...Object.values(CHECKOUT_LINES).filter((v) => typeof v === 'string'),
    CHECKOUT_LINES.confirmed('Pro', '4 October 2027'),
    CHECKOUT_LINES.confirmed('Pro', null),
    failureLine({ error: { description: 'Card declined by the bank' } }),
    failureLine({}),
  ];

  it('carry no em dash, no exclamation mark, no emoji and no vendor', () => {
    for (const line of lines) {
      expect([line, /—/.test(line)]).toEqual([line, false]);
      expect([line, /!/.test(line)]).toEqual([line, false]);
      expect([line, /\p{Extended_Pictographic}/u.test(line)]).toEqual([line, false]);
      expect([line, /razorpay|stripe/i.test(line)]).toEqual([line, false]);
    }
  });

  it('promise no refund and claim no renewal', () => {
    for (const line of lines) {
      expect([line, /refund|money back/i.test(line)]).toEqual([line, false]);
      expect([line, /\brenew/i.test(line)]).toEqual([line, false]);
    }
  });

  it('say the bank reason in plain words and blame nobody', () => {
    const said = failureLine({ error: { description: 'Card declined by the bank', reason: 'x' } });
    expect(said).toContain('Card declined by the bank');
    expect(said).toContain('Nothing was charged');
    expect(said).toMatch(/try again/i);
    expect(said).not.toMatch(/you entered|your fault|invalid/i);
    // no reason given: still plain, still nobody's fault
    expect(failureLine({})).toContain('Nothing was charged');
  });

  it('name the plan and the date on success, and no date when there is none', () => {
    expect(CHECKOUT_LINES.confirmed('Pro', '4 October 2027')).toBe(
      "You're on Pro. It runs until 4 October 2027.",
    );
    expect(CHECKOUT_LINES.confirmed('Max', null)).toBe("You're on Max.");
  });

  it('read the off state the way the brief says it', () => {
    expect(CHECKOUT_LINES.off).toBe('Payments are not switched on yet');
  });

  it('promise no email, because nothing on the gateway sends one when the webhook lands', () => {
    // billing/payments.py and billing/__init__.py carry no mail call on activated or charged.
    for (const line of lines) {
      expect([line, /e-?mail|we write to you|we will write/i.test(line)]).toEqual([line, false]);
    }
    expect(CHECKOUT_LINES.slow).toMatch(/updates by itself/);
    expect(CHECKOUT_LINES.slow).toMatch(/Your plan/);
  });
});

// --- the steps -----------------------------------------------------------------------------------

describe('the checkout steps', () => {
  const run = (...events: Parameters<typeof checkoutReducer>[1][]): CheckoutState =>
    events.reduce(checkoutReducer, initialCheckout());

  it('opens, then pays into confirming, and only a confirmation ends confirming', () => {
    expect(run({ type: 'choose' }).step).toBe('opening');
    expect(run({ type: 'choose' }, { type: 'opened' }).step).toBe('open');
    const confirming = run({ type: 'choose' }, { type: 'opened' }, { type: 'paid' });
    expect(confirming.step).toBe('confirming');
    expect(confirming.line).toBe(CHECKOUT_LINES.confirming);
    // the handler did NOT flip the plan: nothing in this state says the plan is on
    expect(confirming.line).not.toMatch(/you're on/i);
    const done = checkoutReducer(confirming, {
      type: 'confirmed',
      planName: 'Pro',
      until: '4 October 2027',
    });
    expect(done.step).toBe('confirmed');
    expect(done.line).toBe("You're on Pro. It runs until 4 October 2027.");
  });

  it('says the honest slow line when the bank has not confirmed in time', () => {
    const slow = run({ type: 'choose' }, { type: 'opened' }, { type: 'paid' }, { type: 'slow' });
    expect(slow.step).toBe('slow');
    expect(slow.line).toBe(CHECKOUT_LINES.slow);
  });

  it('changes nothing on a dismissed modal, in one calm line', () => {
    const closed = run({ type: 'choose' }, { type: 'opened' }, { type: 'dismissed' });
    expect(closed.step).toBe('idle');
    expect(closed.line).toBe(CHECKOUT_LINES.dismissed);
  });

  it('keeps the bank reason when the modal is closed after a failure', () => {
    const failed = run(
      { type: 'choose' },
      { type: 'opened' },
      { type: 'failed', failure: { error: { description: 'Card declined by the bank' } } },
    );
    expect(failed.step).toBe('failed');
    expect(failed.line).toContain('Card declined by the bank');
    const closed = checkoutReducer(failed, { type: 'dismissed' });
    expect(closed.step).toBe('idle');
    expect(closed.line).toContain('Card declined by the bank');
  });

  it('a dismissal after paying does not undo confirming', () => {
    const confirming = run({ type: 'choose' }, { type: 'opened' }, { type: 'paid' });
    expect(checkoutReducer(confirming, { type: 'dismissed' })).toEqual(confirming);
  });

  it('stops with the server line or the plain one when the checkout could not start', () => {
    expect(run({ type: 'choose' }, { type: 'stopped', message: 'Sign in first.' }).line).toBe(
      'Sign in first.',
    );
    expect(run({ type: 'choose' }, { type: 'stopped', message: null }).line).toBe(
      CHECKOUT_LINES.startFailed,
    );
    expect(run({ type: 'choose' }, { type: 'stopped', message: null }).step).toBe('idle');
  });

  it('ignores a second choose while one is in flight', () => {
    const opening = run({ type: 'choose' });
    expect(checkoutReducer(opening, { type: 'choose' })).toBe(opening);
  });
});

// --- waiting for the webhook ---------------------------------------------------------------------

describe('confirming with the bank', () => {
  const reads = (answers: SubscriptionRead[]) => {
    let i = 0;
    return async (): Promise<SubscriptionRead> =>
      answers[Math.min(i++, answers.length - 1)] as SubscriptionRead;
  };

  it('polls the plan endpoint until it says the chosen plan is active', async () => {
    const slept: number[] = [];
    const sub = await awaitConfirmation({
      read: reads([
        { ok: true, subscription: FREE },
        { ok: false, message: null },
        { ok: true, subscription: ACTIVE },
      ]),
      planId: 'pro',
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(sub).toEqual(ACTIVE);
    expect(slept).toEqual([CONFIRM_EVERY_MS, CONFIRM_EVERY_MS]);
  });

  it('gives up honestly after the deadline, with the plan still unclaimed', async () => {
    let clock = 0;
    const sub = await awaitConfirmation({
      read: reads([{ ok: true, subscription: FREE }]),
      planId: 'pro',
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(sub).toBeNull();
    expect(clock).toBeGreaterThanOrEqual(CONFIRM_FOR_MS);
    expect(clock).toBeLessThan(CONFIRM_FOR_MS + CONFIRM_EVERY_MS * 2);
  });

  it('does not take another plan for the one that was paid for', async () => {
    let clock = 0;
    const sub = await awaitConfirmation({
      read: reads([{ ok: true, subscription: ACTIVE }]),
      planId: 'max',
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(sub).toBeNull();
  });

  it('is sixty seconds, every two', () => {
    expect(CONFIRM_FOR_MS).toBe(60_000);
    expect(CONFIRM_EVERY_MS).toBe(2_000);
  });
});
