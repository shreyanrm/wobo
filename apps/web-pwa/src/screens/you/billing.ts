/**
 * The learner's own subscription, as the You screen reaches it — the app-side client for the
 * gateway's billing routes, with identity riding `gatewayFetch` exactly as the parent link and the
 * mail preferences do.
 *
 * Three doors, and nothing else. There is no upgrade here, no price, no card and no retention
 * offer: this module exists so that "You → Your plan → Cancel" is a thing a learner can
 * actually do, and so the sentence the plans page already prints is true.
 *
 *   GET  /v1/me/subscription          — what the plan is, when the period ends, where it was bought
 *   POST /v1/me/subscription/cancel   — end it; the plan runs to the end of the period paid for
 *   POST /v1/me/subscription/resume   — undo that, while the period is still running
 *
 * All three answer with the SAME body, so every call leaves the screen holding one truth rather
 * than a guess it has to reconcile. The routes live in `services/gateway/src/wobo_gateway/
 * billing.py`, which states the division plainly: the screen may use the server's lines or its
 * own, but it must never work out the STATE, because the state is the promise. So `state`,
 * `can_cancel` and `can_resume` are read off the body here and never derived.
 *
 * Two rules shape the file:
 *
 *  · NOTHING IS PRETENDED. No gateway, a refusal, a body we cannot parse, a network that never
 *    answered — every one of those is `null` or `{ ok: false }`, never a cheerful default. The
 *    panel then says the plan is unchanged, because it is. A cancel is claimed only when the
 *    server said, in its own body, that the subscription is now ending.
 *  · CANCELLING IS IDEMPOTENT. Cancelling a plan already set to end changes nothing and answers
 *    with the same body, so a learner who taps again after a failure is safe, and so is a retry
 *    after a reply that never arrived.
 */

import { gatewayFetch } from '@wobo/sdk';

/**
 * The paths, in one place. The gateway owns these routes; this is the only file in the app that
 * names them, so a rename upstream is one edit here.
 */
export const BILLING_PATHS = {
  read: '/v1/me/subscription',
  cancel: '/v1/me/subscription/cancel',
  resume: '/v1/me/subscription/resume',
} as const;

/**
 * Where a plan stands.
 *  · `free`       — no paid plan. The free allowance, which is a real plan and not a lack of one.
 *  · `active`     — paid, running to the end of the period, and not yet told to stop.
 *  · `cancelling` — paid, running to the end of the period already paid for, then stopping.
 *  · `ended`      — the period ran out; the meter is the free one again.
 */
export type PlanState = 'free' | 'active' | 'cancelling' | 'ended';

/** Where the subscription was bought. Only a plan bought here can be cancelled here. */
export type PlanSource = 'web' | 'app_store' | 'play_store';

export interface Subscription {
  state: PlanState;
  /** The tier the brain knows this plan by — 'free', 'plus', 'pro', 'max'. */
  planId: string;
  /** The tier's name in the server's words, when it gave one. The screen falls back to the tier. */
  planName: string | null;
  /**
   * ISO instant the paid period runs out — the day the plan STOPS, whether or not it was
   * cancelled. Nothing in this product renews a subscription (there is no payment provider, no
   * webhook and no sweep; the gateway's billing.py says so at the top), so no surface built on
   * this field may print the word. Null when the server did not give one, which the screen says
   * in words rather than inventing a date.
   */
  periodEnd: string | null;
  source: PlanSource;
  /**
   * Whether THIS door can end THIS plan, and whether it can bring it back. The server's answer,
   * not ours: it knows about a plan bought in a store, and about a paid plan whose period it
   * cannot see, and both of those look cancellable from here and are not. The gateway's own words
   * for the rule: "the screen may use these lines or its own; what it must not do is work out the
   * state, because the state is the promise."
   */
  canCancel: boolean;
  canResume: boolean;
  /**
   * One line about this plan in the server's voice. The panel writes its own for the states it was
   * given words for, and prints this one for the state only the server knows about — a paid plan
   * with no period on record, which can be ended but not from here.
   */
  line: string | null;
}

/** What a write answered. A cancel that cannot be confirmed is a failure, never a silent success. */
export type BillingOutcome =
  | { ok: true; subscription: Subscription }
  /** The server's own words when it sent any; null leaves the screen to say its plain line. */
  | { ok: false; message: string | null };

/**
 * What a READ answered, and the reason it is not just `Subscription | null`.
 *
 * A learner who is genuinely on Free and a learner whose paid plan we could not read are two very
 * different things to say to somebody about their money, and one value cannot carry both. The
 * gateway answers a free learner with a real, parseable body (`status: "free"`), so `ok: true`
 * always means the server told us where this learner stands — free included — and `ok: false`
 * always means we do not know. The panel prints "Free" only for the first.
 */
export type SubscriptionRead =
  | { ok: true; subscription: Subscription }
  | { ok: false; message: string | null };

const STATES: ReadonlySet<string> = new Set<PlanState>(['free', 'active', 'cancelling', 'ended']);
const SOURCES: ReadonlySet<string> = new Set<PlanSource>(['web', 'app_store', 'play_store']);

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The subscription the server described, or null when the body is not one.
 *
 * Lenient in exactly two directions, because the brain owns this shape and processors differ:
 * `none` is read as the free plan, and an `active` row carrying `cancel_at_period_end` is read as
 * cancelling. Anything else unrecognised is null — a plan we cannot read is not a plan we draw.
 */
export function parseSubscription(body: unknown): Subscription | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const raw = text(b.status) ?? text(b.state);
  if (!raw) return null;
  const named = raw === 'none' ? 'free' : raw;
  if (!STATES.has(named)) return null;
  let state = named as PlanState;

  // An active row already told to stop. Stripe and Razorpay both say it with the flag rather than
  // with a status, and a learner who has cancelled must never be shown an active plan's lines.
  if (state === 'active' && (b.cancel_at_period_end === true || b.cancelAtPeriodEnd === true)) {
    state = 'cancelling';
  }

  const planId = text(b.plan) ?? text(b.plan_id) ?? 'free';
  // The free tier is never "active": there is no period and nothing to cancel.
  if (planId === 'free' && state !== 'ended') state = 'free';

  const sourceRaw = text(b.source) ?? text(b.bought_through);
  const source = sourceRaw && SOURCES.has(sourceRaw) ? (sourceRaw as PlanSource) : 'web';

  // A server that did not answer the question falls back to the plainest reading of it: a plan
  // bought here, in the state it can move from. Guessing "no" would hide the only door out of a
  // paid plan, and with no refunds that is a trap — so the fallback opens the door rather than
  // closing it, and a cancel we should not have offered is refused with a line of its own.
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  return {
    state,
    planId,
    planName: text(b.plan_name) ?? text(b.planName),
    periodEnd: text(b.period_end) ?? text(b.periodEnd) ?? text(b.current_period_end),
    source,
    canCancel: flag(b.can_cancel ?? b.canCancel, state === 'active' && source === 'web'),
    canResume: flag(b.can_resume ?? b.canResume, state === 'cancelling' && source === 'web'),
    line: text(b.line),
  };
}

/** The line a refusal carried, in the server's voice, or null when it carried none of ours. */
export function refusalLine(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { detail?: unknown; message?: unknown };
  const direct = text(b.message);
  if (direct) return direct;
  const detail = b.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return text((detail as { message?: unknown }).message);
  }
  return null;
}

type Fetch = typeof gatewayFetch;

/**
 * What the plan is, as a tri-state.
 *
 * `{ ok: false }` when there is no gateway, when the read was refused, or when the body is not a
 * subscription — the screen says "I could not read your plan", which is the truth. `{ ok: true }`
 * carries whatever the server said this learner is on, and a free learner IS one of those: the
 * gateway answers them with a parseable `status: "free"` body, so the free state is a thing the
 * server told us and never a thing we assumed after a failure.
 *
 * This is the whole reason the shape is not `Subscription | null`. With one null for both, a
 * gateway that is entirely down made the panel print the heading "Free", the free allowance line
 * and no cancel — a settled, confident claim about somebody's money, made out of an outage.
 */
export async function readSubscription(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<SubscriptionRead> {
  if (!gatewayUrl) return { ok: false, message: null };
  try {
    const res = await fetcher(`${gatewayUrl}${BILLING_PATHS.read}`);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: refusalLine(body) };
    const subscription = parseSubscription(body);
    if (!subscription) return { ok: false, message: null };
    return { ok: true, subscription };
  } catch {
    return { ok: false, message: null };
  }
}

/** POST a write and read the subscription back out of it. Shared by cancel and resume. */
async function write(
  path: string,
  gatewayUrl: string | undefined,
  fetcher: Fetch,
): Promise<BillingOutcome> {
  if (!gatewayUrl) return { ok: false, message: null };
  try {
    const res = await fetcher(`${gatewayUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: refusalLine(body) };
    const subscription = parseSubscription(body);
    // A 200 whose body we cannot read is not proof of anything. The plan stays as it was drawn.
    if (!subscription) return { ok: false, message: null };
    return { ok: true, subscription };
  } catch {
    return { ok: false, message: null };
  }
}

/**
 * End the plan. It keeps running to the end of the period already paid for; nothing is taken away
 * early and nothing is charged again. Idempotent: cancelling a plan already ending answers with
 * the same body.
 */
export async function cancelSubscription(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<BillingOutcome> {
  return write(BILLING_PATHS.cancel, gatewayUrl, fetcher);
}

/** Undo a cancel, while the period is still running. One tap, for someone who changed their mind. */
export async function resumeSubscription(
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<BillingOutcome> {
  return write(BILLING_PATHS.resume, gatewayUrl, fetcher);
}
