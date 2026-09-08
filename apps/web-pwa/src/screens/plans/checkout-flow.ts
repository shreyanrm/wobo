/**
 * The checkout, as the plans page reaches it: the two gateway routes, the provider's script, the
 * words, the steps and the wait. No React in here, so every promise the page makes about money is
 * proved in `checkout-flow.test.ts` rather than asserted in a component.
 *
 * THE SHAPE OF IT (docs/PRICING.md; DESIGN.md §0; voice.md 10a):
 *
 *  · THE GATEWAY STARTS THE CHECKOUT, NEVER THE BROWSER. `POST /v1/billing/checkout` creates the
 *    subscription on the provider with the server's secret and answers with its id; the browser
 *    is handed the id and the public key id and nothing else. The key SECRET is never a `VITE_`
 *    variable, never in this file and never in the bundle (`test/bundle-secrets.test.ts` greps).
 *  · THE PROVIDER'S SCRIPT LOADS WHEN THE READER CHOOSES, not when the page does. A page that pulls
 *    a third-party script for every visitor who is only comparing prices is asking a stranger's
 *    server to watch people read. `loadCheckoutJs` is called from the click and nowhere else.
 *  · PAYING DOES NOT FLIP THE PLAN. The provider's handler says a payment went through; the
 *    gateway's webhook is what writes the subscription row (MEMORY-LAW: the database is the
 *    record). So the screen says "Confirming with the bank" and polls the plan endpoint until the
 *    row says `active`, for at most a minute, and then says the honest thing either way.
 *  · PAYMENTS OFF IS A STATE, NOT A BUG. With no key on the gateway the control reads "Payments
 *    are not switched on yet" and does nothing; it is never a dead button and never a fake
 *    success. The gateway says whether payments are on; the browser never decides.
 *  · A dismissed modal changes nothing and says so in one calm line. A failed payment says the
 *    bank's reason in plain words, offers another try, and blames nobody.
 *
 * WHAT THE GATEWAY ANSWERS, so the two sides cannot drift:
 *
 *   GET  /healthz               → { checks: { payments: { payments: 'on' | 'off' } } }
 *                                 public, on the gateway's unauthenticated allowlist; "on" means
 *                                 the provider keys are present (health.py, `_payments_check`)
 *   POST /v1/billing/checkout   ← { plan: 'pro' | 'max', period: 'yearly' | 'monthly' }
 *                               → { subscription_id, key_id, plan, period, amount_paise, ... }
 *                               ✗ 503 { detail: { code: 'payments_off', message } }
 *                               ✗ 403 { detail: { code: 'sign_in_required', message } }
 *   GET  /v1/me/subscription    — the plan endpoint `screens/you/billing.ts` already reads
 *
 * The public key id reaches the browser in the checkout answer and nowhere else.
 *
 * The provider's side is Razorpay's standard checkout with a subscription: `checkout.js` from
 * https://checkout.razorpay.com/v1/checkout.js, opened with `key` and `subscription_id`, a
 * `handler` that receives `razorpay_payment_id`, `razorpay_subscription_id` and
 * `razorpay_signature`, `modal.ondismiss` when the reader closes it, and `payment.failed` on the
 * instance with `error.code`, `error.description`, `error.source`, `error.step` and
 * `error.reason` (Razorpay Docs, read 2026-09-07: razorpay.com/docs/payments/payment-gateway/
 * web-integration/standard/build-integration/ for the script, the handler, `modal.ondismiss` and
 * `payment.failed`; razorpay.com/docs/payments/subscriptions/integration-guide/ for the
 * subscription options, which carry `subscription_id` and no amount, and whose handler answers
 * with `razorpay_subscription_id`). Nothing here names the provider to a learner (voice.md §7).
 */

import { gatewayFetch } from '@wobo/sdk';
import { refusalLine, type Subscription, type SubscriptionRead } from '../you/billing';
import type { Period, PlanTier } from './prices';

/** The routes, in one place. The gateway owns them; this is the only file that names them. */
export const CHECKOUT_PATHS = {
  /** The gateway's public health, whose `checks.payments` says whether the keys are present. */
  config: '/healthz',
  start: '/v1/billing/checkout',
} as const;

/** The provider's standard checkout script. Loaded by `loadCheckoutJs`, and only from the click. */
export const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * The pointer, DESIGN.md §0 (`--pig`). The modal is drawn on the provider's own page, where no
 * CSS variable of ours reaches, so the hex is written here and `checkout-flow.test.ts` holds it to
 * `tokens.css`.
 */
export const WOBO_COLOUR = '#2B45FF';

/** How the wait for the webhook is paced: every two seconds, for a minute. */
export const CONFIRM_EVERY_MS = 2_000;
export const CONFIRM_FOR_MS = 60_000;

type Fetch = typeof gatewayFetch;
type PaidTier = Exclude<PlanTier['id'], 'free'>;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// --- the words -----------------------------------------------------------------------------------

/**
 * Every line this flow can say. Register 10a: plain words, short sentences, no em dash, no
 * exclamation mark, no vendor, and read back as a fifteen year old and as the parent paying.
 */
export const CHECKOUT_LINES = {
  /** The control's label while the gateway has no key. It does nothing, and it says so. */
  off: 'Payments are not switched on yet',
  offNote:
    'Nothing can be charged and no card is asked for. The prices are set; the payment page is not switched on yet.',
  /** Both boxes are the reader's to tick; the button does not go until they have. */
  untick: 'Tick both boxes first, then choose your plan.',
  /** Signed out on a public page: the plan needs an account to land on. */
  signIn: 'Sign in first, so the plan lands on your account.',
  opening: 'Opening the payment page.',
  confirming: 'Confirming with the bank.',
  confirmed: (planName: string, until: string | null): string =>
    until ? `You're on ${planName}. It runs until ${until}.` : `You're on ${planName}.`,
  /**
   * No "and we email you": nothing on the gateway sends a mail when the webhook lands
   * (billing/payments.py, billing/__init__.py). The plan row is the record; the You screen reads it.
   */
  slow: 'It is taking a moment. Your plan updates by itself when the bank confirms. Look under You, Your plan, in a little while.',
  dismissed: 'Nothing was charged. Choose a plan whenever you are ready.',
  loadFailed: 'The payment page did not load. Check your connection and try again.',
  startFailed:
    'I could not start the checkout just now. Nothing was charged. Try again in a moment.',
} as const;

// --- payments on or off --------------------------------------------------------------------------

export type PaymentsConfig = { on: true } | { on: false };

/**
 * On only when the health body's `checks.payments.payments` is the word "on". Anything else,
 * including a health body from a gateway that has not grown the check, is off.
 */
export function parsePaymentsConfig(body: unknown): PaymentsConfig {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { on: false };
  const checks = (body as { checks?: unknown }).checks;
  if (!checks || typeof checks !== 'object') return { on: false };
  const payments = (checks as { payments?: unknown }).payments;
  if (!payments || typeof payments !== 'object') return { on: false };
  return (payments as { payments?: unknown }).payments === 'on' ? { on: true } : { on: false };
}

/**
 * Whether the deploy can take a payment. Off with no gateway, a 404 (a gateway that has not
 * grown the route yet), a refusal, a network that never answered, or a body that is not a
 * config: the default is the honest one, and the control says so rather than pretending.
 */
/**
 * A health check asks nobody who they are. `gatewayFetch` binds the learner's identity to every
 * call, and binding it means establishing a session, which on a signed-out visit is an anonymous
 * sign-in against a project where anonymous sign-ins are off: a 422 in every stranger's console
 * on /plans (wave 29, site-5). `/healthz` is public, so it is fetched plain.
 */
const plainFetch: Fetch = (url, init) => fetch(url, init);

export async function readPaymentsConfig(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = plainFetch,
): Promise<PaymentsConfig> {
  if (!gatewayUrl) return { on: false };
  try {
    const res = await fetcher(`${gatewayUrl}${CHECKOUT_PATHS.config}`);
    if (!res.ok) return { on: false };
    return parsePaymentsConfig(await res.json().catch(() => null));
  } catch {
    return { on: false };
  }
}

/**
 * Whether the plans page draws "What checkout will ask for" under the door. Only while the card
 * is a PREVIEW: once payments are on the card is the checkout, and a link beneath a live door to
 * a page that says paying is not open would be a dead door next to a real one.
 */
export function showsCheckoutPreviewLink(config: PaymentsConfig | null): boolean {
  return !config?.on;
}

// --- starting a checkout -------------------------------------------------------------------------

export interface CheckoutSession {
  subscriptionId: string;
  /** The public key id, as the gateway sent it with the session. Null is a session we cannot open. */
  keyId: string | null;
}

export type CheckoutStart =
  | { ok: true; session: CheckoutSession }
  /** `off` when the gateway said payments are off (or there is no gateway at all). */
  | { ok: false; off: boolean; message: string | null };

export function parseCheckoutSession(body: unknown): CheckoutSession | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const subscriptionId = text(b.subscription_id) ?? text(b.subscriptionId);
  if (!subscriptionId) return null;
  return { subscriptionId, keyId: text(b.key_id) ?? text(b.keyId) };
}

function refusalCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return text((detail as { code?: unknown }).code);
  }
  return text((body as { code?: unknown }).code);
}

/** Ask the gateway to create the subscription. The secret stays on the server; we get the id. */
export async function startCheckout(
  plan: PaidTier,
  period: Period,
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<CheckoutStart> {
  if (!gatewayUrl) return { ok: false, off: true, message: null };
  try {
    const res = await fetcher(`${gatewayUrl}${CHECKOUT_PATHS.start}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan, period }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, off: refusalCode(body) === 'payments_off', message: refusalLine(body) };
    }
    const session = parseCheckoutSession(body);
    if (!session) return { ok: false, off: false, message: null };
    return { ok: true, session };
  } catch {
    return { ok: false, off: false, message: null };
  }
}

// --- the provider's script -----------------------------------------------------------------------

export interface PaidResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

export interface PaymentFailure {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface CheckoutOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill: { name?: string };
  theme: { color: string };
  handler: (response: PaidResponse) => void;
  modal: { ondismiss: () => void };
}

export interface CheckoutInstance {
  open(): void;
  on(event: 'payment.failed', handler: (failure: PaymentFailure) => void): void;
}

export type CheckoutCtor = new (options: CheckoutOptions) => CheckoutInstance;

/** The little of `window` the loader needs, so a test can hand it a fake. */
export interface ScriptHost {
  Razorpay?: unknown;
  document: {
    createElement(tag: 'script'): {
      src: string;
      async: boolean;
      onload: null | (() => void);
      onerror: null | (() => void);
    };
    head: { appendChild(node: unknown): unknown };
  };
}

const pending = new WeakMap<object, Promise<CheckoutCtor>>();

/**
 * Append the provider's script and resolve with its constructor. Called from the click and from
 * nowhere else: nothing at module scope touches the document. Asked twice, it appends once.
 */
export function loadCheckoutJs(
  host: ScriptHost = window as unknown as ScriptHost,
): Promise<CheckoutCtor> {
  if (typeof host.Razorpay === 'function') return Promise.resolve(host.Razorpay as CheckoutCtor);
  const inFlight = pending.get(host);
  if (inFlight) return inFlight;
  const load = new Promise<CheckoutCtor>((resolve, reject) => {
    const script = host.document.createElement('script');
    script.src = CHECKOUT_JS;
    script.async = true;
    script.onload = () => {
      if (typeof host.Razorpay === 'function') resolve(host.Razorpay as CheckoutCtor);
      else reject(new Error(CHECKOUT_LINES.loadFailed));
    };
    script.onerror = () => reject(new Error(CHECKOUT_LINES.loadFailed));
    host.document.head.appendChild(script);
  }).finally(() => pending.delete(host));
  pending.set(host, load);
  return load;
}

/** What the modal opens with. No amount: the subscription carries its own, and one opinion is enough. */
export function checkoutOptions(args: {
  keyId: string;
  subscriptionId: string;
  tierName: string;
  period: Period;
  learnerName: string;
  onPaid: (response: PaidResponse) => void;
  onDismiss: () => void;
}): CheckoutOptions {
  const name = args.learnerName.trim();
  return {
    key: args.keyId,
    subscription_id: args.subscriptionId,
    name: 'Wobo',
    description: `${args.tierName}, ${args.period}`,
    prefill: name ? { name } : {},
    theme: { color: WOBO_COLOUR },
    handler: args.onPaid,
    modal: { ondismiss: args.onDismiss },
  };
}

/** The bank's reason, in plain words, and nobody's fault. */
export function failureLine(failure: PaymentFailure): string {
  const reason = text(failure.error?.description);
  const said = reason
    ? `The bank did not approve that payment: ${reason}.`
    : 'The bank did not approve that payment.';
  return `${said} Nothing was charged. Try again, or use another card or UPI.`;
}

// --- the steps -----------------------------------------------------------------------------------

/**
 *  · idle        — nothing in flight. `line` may carry the last thing that happened.
 *  · opening     — the gateway is creating the session and the script is loading.
 *  · open        — the provider's modal is up.
 *  · confirming  — paid; waiting for the plan endpoint to say `active`.
 *  · confirmed   — the row says so. The only step allowed to claim the plan.
 *  · slow        — a minute passed. The plan updates by itself; the line says so.
 *  · failed      — the bank said no. The modal may still be up, offering another try.
 */
export type CheckoutStep =
  | 'idle'
  | 'opening'
  | 'open'
  | 'confirming'
  | 'confirmed'
  | 'slow'
  | 'failed';

export interface CheckoutState {
  step: CheckoutStep;
  line: string | null;
}

export type CheckoutEvent =
  | { type: 'choose' }
  | { type: 'opened' }
  | { type: 'paid' }
  | { type: 'dismissed' }
  | { type: 'failed'; failure: PaymentFailure }
  | { type: 'confirmed'; planName: string; until: string | null }
  | { type: 'slow' }
  /** The checkout could not start. The server's line when it gave one, else the plain one. */
  | { type: 'stopped'; message: string | null };

export function initialCheckout(): CheckoutState {
  return { step: 'idle', line: null };
}

export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case 'choose':
      // One checkout at a time. A second press while one is in flight changes nothing.
      return state.step === 'idle' ||
        state.step === 'failed' ||
        state.step === 'slow' ||
        state.step === 'confirmed'
        ? { step: 'opening', line: CHECKOUT_LINES.opening }
        : state;
    case 'opened':
      return state.step === 'opening' ? { step: 'open', line: null } : state;
    case 'paid':
      // THE HANDLER DOES NOT FLIP THE PLAN. This step claims nothing; the poll does, or the clock.
      return state.step === 'open' || state.step === 'failed'
        ? { step: 'confirming', line: CHECKOUT_LINES.confirming }
        : state;
    case 'dismissed':
      // Closing the modal after paying is not un-paying: confirming carries on.
      if (state.step === 'confirming') return state;
      // Closing it after the bank said no keeps the bank's reason on the screen.
      if (state.step === 'failed') return { step: 'idle', line: state.line };
      return state.step === 'open' || state.step === 'opening'
        ? { step: 'idle', line: CHECKOUT_LINES.dismissed }
        : state;
    case 'failed':
      return { step: 'failed', line: failureLine(event.failure) };
    case 'confirmed':
      return { step: 'confirmed', line: CHECKOUT_LINES.confirmed(event.planName, event.until) };
    case 'slow':
      return state.step === 'confirming' ? { step: 'slow', line: CHECKOUT_LINES.slow } : state;
    case 'stopped':
      return { step: 'idle', line: event.message ?? CHECKOUT_LINES.startFailed };
    default:
      return state;
  }
}

// --- waiting for the webhook ---------------------------------------------------------------------

/**
 * Poll the plan endpoint until the row says the chosen plan is active, or the deadline passes.
 * Returns the subscription the server described, or null: never a plan it did not describe.
 */
export async function awaitConfirmation(args: {
  read: () => Promise<SubscriptionRead>;
  planId: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  everyMs?: number;
  forMs?: number;
}): Promise<Subscription | null> {
  const sleep = args.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = args.now ?? (() => Date.now());
  const every = args.everyMs ?? CONFIRM_EVERY_MS;
  const until = now() + (args.forMs ?? CONFIRM_FOR_MS);
  for (;;) {
    const read = await args.read();
    if (
      read.ok &&
      read.subscription.state === 'active' &&
      read.subscription.planId === args.planId
    ) {
      return read.subscription;
    }
    if (now() >= until) return null;
    await sleep(every);
  }
}
