/**
 * A parent paying for a child: the three gateway routes, the card's rows, and the words for a
 * refusal. No React here, so every promise the pay screen makes about money is proved in
 * `pay-flow.test.ts`.
 *
 * THE CONTRACT (services/gateway/src/wobo_gateway/billing/payments.py, parent_api.py):
 *
 *   POST /v1/billing/checkout      ← { plan, period, for_learner }
 *                                  → { subscription_id, key_id, ... }   the CHILD's subscription,
 *                                    with this parent as the payer in the provider's notes
 *                                  ✗ 403 not_a_parent_account · 404 no_such_child ·
 *                                    409 no_child_selected · 409 already_subscribed ·
 *                                    503 payments_off
 *   GET  /v1/parent/plan           → { child, plan, paid_by_you, payments }
 *   POST /v1/parent/plan/cancel    → the same body, with the plan ending; 403 not_the_payer on a
 *                                    plan this parent did not pay for
 *
 * `for_learner` is a candidate, not an instruction. The server pays only for the child this
 * account has SELECTED, re-read against the live link on the same request, so a stale screen after
 * a switch, a revoked link and a child who never linked are all refused before any money moves.
 *
 * Everything else is the plans page's own machinery, imported rather than copied: the provider's
 * script loader, the modal options, the reducer and the wait for the webhook
 * (`plans/checkout-flow.ts`), and the two consent boxes (`plans/consent.ts`).
 */

import { gatewayFetch } from '@wobo/sdk';
import { CHECKOUT_PATHS, type CheckoutSession, parseCheckoutSession } from '../plans/checkout-flow';
import { renewalValue } from '../plans/copy';
import {
  billedLine,
  chargeLabel,
  type Market,
  type Period,
  type PlanTier,
  priceLabel,
  renewalLabel,
  renewsOn,
} from '../plans/prices';
import { parseSubscription, type Subscription, type SubscriptionRead } from '../you/billing';
import { childOf, type ParentChild, refusalOf, TROUBLE_LINE } from './api';
import { PAY_COPY } from './pay-copy';

export const PAY_PATHS = {
  plan: '/v1/parent/plan',
  cancel: '/v1/parent/plan/cancel',
  checkout: CHECKOUT_PATHS.start,
} as const;

type Fetch = typeof gatewayFetch;
type PaidTier = Exclude<PlanTier['id'], 'free'>;
type Refusal = { ok: false; code: string; message: string };

const DEFAULT_GATEWAY = (): string | undefined => import.meta.env.VITE_GATEWAY_URL;
const unreachable: Refusal = { ok: false, code: 'unreachable', message: TROUBLE_LINE };

/** The selected child and their plan, as the parent is allowed to read it. */
export interface ChildPlan {
  child: ParentChild;
  plan: Subscription;
  /** The provider's notes name THIS parent as the payer. Only then is the end offered. */
  paidByYou: boolean;
  paymentsOn: boolean;
}

export type PlanAnswer = { ok: true; value: ChildPlan } | Refusal;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The body of either parent route, or null when it is not one. The server's `line` is written to
 * a learner ("Your plan is running"), so it is dropped here and the screen says its own; and the
 * end is offered only on a plan this parent paid for, whatever else the body says.
 */
export function parseChildPlan(body: unknown): ChildPlan | null {
  const b = record(body);
  const child = childOf(b?.child);
  const raw = record(b?.plan);
  if (!b || !child || !raw) return null;
  const parsed = parseSubscription({ ...raw, line: null });
  if (!parsed) return null;
  const paidByYou = b.paid_by_you === true;
  return {
    child,
    plan: { ...parsed, line: null, canCancel: parsed.canCancel && paidByYou, canResume: false },
    paidByYou,
    paymentsOn: b.payments === 'on',
  };
}

async function planCall(
  path: string,
  init: RequestInit | undefined,
  gatewayUrl: string | undefined,
  fetcher: Fetch,
): Promise<PlanAnswer> {
  if (!gatewayUrl) return unreachable;
  try {
    const res = await fetcher(`${gatewayUrl}${path}`, init);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, ...refusalOf(body) };
    const value = parseChildPlan(body);
    // A 200 we cannot read is not proof of anything: the plan stays as it was drawn.
    return value ? { ok: true, value } : unreachable;
  } catch {
    return unreachable;
  }
}

/** The selected child's plan. */
export function readChildPlan(
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<PlanAnswer> {
  return planCall(PAY_PATHS.plan, undefined, gatewayUrl, fetcher);
}

/** End it: the provider stops at the end of the period paid for, and nothing more is taken. */
export function endChildPlan(
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<PlanAnswer> {
  return planCall(
    PAY_PATHS.cancel,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    gatewayUrl,
    fetcher,
  );
}

/** The same read, in the shape the plans page's wait for the webhook takes. */
export async function readChildSubscription(
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<SubscriptionRead> {
  const got = await readChildPlan(gatewayUrl, fetcher);
  return got.ok ? { ok: true, subscription: got.value.plan } : { ok: false, message: got.message };
}

export type ChildCheckoutStart =
  | { ok: true; session: CheckoutSession }
  | { ok: false; off: boolean; code: string; message: string };

/**
 * Ask the gateway to open the CHILD's subscription, paid by this parent. The body names the plan,
 * the period and the child, and nothing else: no amount, no code, no payer. The server knows who
 * is paying from the token.
 */
export async function startChildCheckout(
  plan: PaidTier,
  period: Period,
  forLearner: string,
  gatewayUrl: string | undefined = DEFAULT_GATEWAY(),
  fetcher: Fetch = gatewayFetch,
): Promise<ChildCheckoutStart> {
  if (!gatewayUrl) return { ok: false, off: true, code: 'payments_off', message: PAY_COPY.offNote };
  try {
    const res = await fetcher(`${gatewayUrl}${PAY_PATHS.checkout}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan, period, for_learner: forLearner }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const { code, message } = refusalOf(body);
      return { ok: false, off: code === 'payments_off', code, message };
    }
    const session = parseCheckoutSession(body);
    if (!session)
      return { ok: false, off: false, code: 'unreadable', message: PAY_COPY.startFailed };
    return { ok: true, session };
  } catch {
    return { ok: false, off: false, code: 'unreachable', message: PAY_COPY.startFailed };
  }
}

// --- what the screen shows -----------------------------------------------------------------------

/**
 *  · choose   — nothing running (free, or a plan that ended): the plans and the checkout.
 *  · running  — a paid plan that renews or runs; the end is offered if this parent paid.
 *  · ending   — told to stop; it runs to the day paid for.
 *  · unknown  — nothing read yet, or the read failed. Never a guess about somebody's money.
 */
export type PayStage = 'choose' | 'running' | 'ending' | 'unknown';

export function payStage(value: ChildPlan | null): PayStage {
  if (!value) return 'unknown';
  switch (value.plan.state) {
    case 'active':
      return 'running';
    case 'cancelling':
      return 'ending';
    default:
      return 'choose';
  }
}

export interface CardRow {
  key: 'plan' | 'billed' | 'starts' | 'today' | 'renews';
  label: string;
  value: string;
}

/**
 * The rows of the checkout card. THE TOTAL AND THE DAY IT COMES ROUND are drawn only while payments
 * are on, which is when this card is the checkout (docs/PRICING.md: the total belongs to the
 * checkout and nowhere else). Off, the card states the per-month price and the words.
 */
export function checkoutRows(args: {
  tier: PlanTier;
  market: Market;
  period: Period;
  paymentsOn: boolean;
  now: Date;
}): CardRow[] {
  const { tier, market, period, paymentsOn, now } = args;
  const r = PAY_COPY.rows;
  const rows: CardRow[] = [
    { key: 'plan', label: tier.name, value: `${priceLabel(tier, market, period)} ${r.perMonth}` },
  ];
  const billed = billedLine(tier, period);
  if (billed) {
    rows.push({
      key: 'billed',
      label: r.billed,
      value: billed.charAt(0).toUpperCase() + billed.slice(1),
    });
  }
  rows.push({ key: 'starts', label: r.starts, value: r.startsValue });
  if (!paymentsOn) return rows;
  const charge = chargeLabel(tier, market, period);
  if (!charge) return rows;
  rows.push({ key: 'today', label: r.today, value: `${charge} ${r.totalFor[period]}` });
  rows.push({
    key: 'renews',
    label: r.renews,
    value: renewalValue(charge, renewalLabel(renewsOn(now, period), period)),
  });
  return rows;
}

/** A refusal, in a parent's words when this screen has them, else the server's own sentence. */
export function refusalLine(code: string, serverMessage: string, name: string | null): string {
  const said = PAY_COPY.refusals;
  switch (code) {
    case 'not_a_parent_account':
    case 'sign_in_required':
    case 'no_child_selected':
    case 'no_such_child':
    case 'not_the_payer':
      return said[code];
    case 'already_subscribed':
      return said.already_subscribed(name);
    case 'no_subscription':
      return said.no_subscription(name);
    default:
      return serverMessage || TROUBLE_LINE;
  }
}
