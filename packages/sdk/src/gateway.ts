/**
 * The one door to the brain.
 *
 * Every call the client makes to the gateway — capability posts, the voice-session mint, TTS, the
 * budget read — goes through here so identity is attached in exactly one place and the brain's
 * refusals come back as typed, Wobo-voiced errors instead of raw status codes.
 *
 * Identity is a Supabase JWT in `Authorization: Bearer <jwt>`. When no Supabase keys are
 * configured (mock/dev builds) the request instead carries `X-Wobo-Dev-Subject: <id>`, which the
 * gateway honours only outside production. The client never holds a provider key, a model name,
 * a consent tier, or a limit — it asks, and the brain decides.
 *
 * ponytail: plain fetch, no client — one auth header and two error shapes do not need a library.
 */

/** How the current access token is read. Async so a near-expiry token can refresh first. */
export type BearerSource = () => string | null | Promise<string | null>;

export interface GatewayAuthConfig {
  /** The signed-in (or anonymous) learner's Supabase access token. */
  accessToken?: BearerSource;
  /** Dev/mock seam: no Supabase keys, so the gateway is told which local subject is calling. */
  devSubject?: string;
}

/** Wobo's own words for the two refusals a learner can actually meet. Never a provider, never a price. */
export const GATEWAY_COPY = {
  signIn: 'I need to know it is you before we carry on. Sign in and we pick up exactly here.',
  budget: 'That is everything I can carry today. Come back in a bit and we keep going.',
  /** Same line, with the real moment Wobo is free again. */
  budgetAt: (when: string) =>
    `That is everything I can carry today. I am free again at ${when} — come back then and we keep going.`,
  trouble: 'Give me a moment, then ask me again.',
  /**
   * The call never came back. Plain, unalarming, and it hands the turn back to the learner instead
   * of leaving them watching a busy orb. No status code, no "timeout", no fault of theirs.
   */
  slow: 'That one is taking longer than it should. Ask me again and I will have another go.',
} as const;

let current: GatewayAuthConfig = {};

/** Bind the identity every gateway call carries. Called once, when the SDK is assembled. */
export function configureGatewayAuth(config: GatewayAuthConfig): void {
  current = config;
}

/** The headers that prove who is asking. Empty when nobody is established yet (the gateway 401s). */
export async function gatewayAuthHeaders(): Promise<Record<string, string>> {
  const source = current.accessToken;
  const token = typeof source === 'function' ? await source() : null;
  if (token) return { authorization: `Bearer ${token}` };
  if (current.devSubject) return { 'x-wobo-dev-subject': current.devSubject };
  return {};
}

/**
 * Whether anybody would be on the next call at all. False only under live auth with nobody
 * established; a question about the learner asked then is a 401 the client already knows the
 * answer to, so a caller that can answer locally (`sdk.me`) does, and the wire stays quiet.
 */
export async function gatewayIdentityKnown(): Promise<boolean> {
  return Object.keys(await gatewayAuthHeaders()).length > 0;
}

/** Sign-in is required (or the session expired). The app routes to Wobo's sign-in beat. */
export class SignInRequiredError extends Error {
  readonly code = 'sign_in_required';
  constructor(message: string = GATEWAY_COPY.signIn) {
    super(message);
    this.name = 'SignInRequiredError';
  }
}

/** The free daily meter is spent. Carries when it refills so Wobo can say it out loud. */
export class BudgetExhaustedError extends Error {
  readonly code = 'budget_exhausted';
  /** ISO instant the window resets, when the brain told us. */
  readonly resetAt: string | null;
  readonly remaining: number | null;
  constructor(message: string, resetAt: string | null, remaining: number | null) {
    super(message);
    this.name = 'BudgetExhaustedError';
    this.resetAt = resetAt;
    this.remaining = remaining;
  }
}

/**
 * THE CALL NEVER CAME BACK.
 *
 * Distinct from `GatewayError`, which is a refusal the brain actually sent. Nothing answered here,
 * so there is no status and nothing to report upward except that the learner should try again.
 */
export class GatewayTimeoutError extends Error {
  readonly code = 'gateway_timeout';
  /** The deadline that fired, in ms. For a log; the learner sees `message` and nothing else. */
  readonly afterMs: number;
  constructor(afterMs: number, message: string = GATEWAY_COPY.slow) {
    super(message);
    this.name = 'GatewayTimeoutError';
    this.afterMs = afterMs;
  }
}

/** Anything else the brain refused. The message is already in Wobo's voice — never a provider's. */
export class GatewayError extends Error {
  readonly status: number;
  constructor(status: number, message: string = GATEWAY_COPY.trouble) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

/** A body the gateway sends with a refusal: `{ code, message }`, both optional to us. */
async function refusal(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await res.json()) as { code?: string; message?: string; detail?: unknown };
    if (body && typeof body === 'object') {
      const detail = body.detail;
      // FastAPI wraps handler-raised bodies in `detail`; unwrap when it carries our shape.
      if (detail && typeof detail === 'object')
        return detail as { code?: string; message?: string };
      return body;
    }
  } catch {
    // no body, or not JSON — the defaults below carry the turn
  }
  return {};
}

/**
 * Turn a refusal into a typed error. Safe to call on any response; it returns for 2xx.
 * The learner never sees a status code, only Wobo's line.
 */
export async function throwForGatewayStatus(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await refusal(res);
  if (res.status === 401 || body.code === 'sign_in_required') {
    throw new SignInRequiredError(body.message || GATEWAY_COPY.signIn);
  }
  if (res.status === 429 || body.code === 'budget_exhausted') {
    const resetAt = res.headers.get('x-wobo-budget-reset');
    const remainingRaw = res.headers.get('x-wobo-budget-remaining');
    const remaining = remainingRaw !== null && remainingRaw !== '' ? Number(remainingRaw) : null;
    throw new BudgetExhaustedError(
      body.message || GATEWAY_COPY.budget,
      resetAt,
      remaining !== null && Number.isFinite(remaining) ? remaining : null,
    );
  }
  throw new GatewayError(res.status, body.message || GATEWAY_COPY.trouble);
}

// --- Deadlines -----------------------------------------------------------------------------------

/**
 * HOW LONG A LEARNER IS EVER ASKED TO WAIT.
 *
 * `fetch` has no deadline of its own, and nothing in this client supplied one: a gateway that
 * stopped answering left a child watching a busy orb past forty-five seconds with no sentence and
 * no way out. These two numbers sit just ABOVE the brain's own ceilings, so the deadline can never
 * fire before the server would have answered and turn a slow lesson into a false failure. Keep them
 * in step with `TURN_TIMEOUT_S` / `GENERATION_TIMEOUT_S` in
 * `services/gateway/src/wobo_gateway/providers.py` (60s and 180s).
 */
export const GATEWAY_TURN_TIMEOUT_MS = 65_000;
export const GATEWAY_GENERATION_TIMEOUT_MS = 190_000;

/**
 * The heavy capability class, mirroring `budget.py`'s `CAPABILITY_CLASS`: longest matching prefix
 * wins, and an unknown name is a turn — the same call the brain makes, so a capability can never be
 * metered as a generation here and timed out as a turn there.
 */
const GENERATION_PREFIXES = [
  'engine.',
  'compose',
  'video',
  'podcast',
  'generate.course',
  'generate.digest',
  'curriculum.discovery',
  'curriculum.own.read',
] as const;

/** The capability a gateway URL names, or null when the route is not a capability post. */
function capabilityOf(url: string): string | null {
  const match = /\/v1\/capability\/([^/?#]+)/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The deadline for one call to this URL. Exported so a caller can reason about it, and tested. */
export function gatewayTimeoutMs(url: string): number {
  const capability = capabilityOf(url);
  if (capability && GENERATION_PREFIXES.some((p) => capability.startsWith(p))) {
    return GATEWAY_GENERATION_TIMEOUT_MS;
  }
  return GATEWAY_TURN_TIMEOUT_MS;
}

/**
 * One signal that fires when either of two does. `AbortSignal.any` where the runtime has it; the
 * manual wiring otherwise, because a caller's own cancel (the learner stopping a turn) must keep
 * working on every browser this ships to, deadline or no deadline.
 */
function combineSignals(caller: AbortSignal | null | undefined, ours: AbortSignal): AbortSignal {
  if (!caller) return ours;
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([caller, ours]);
  const controller = new AbortController();
  const forward = (from: AbortSignal) => () => controller.abort(from.reason);
  if (caller.aborted) controller.abort(caller.reason);
  else if (ours.aborted) controller.abort(ours.reason);
  else {
    caller.addEventListener('abort', forward(caller), { once: true });
    ours.addEventListener('abort', forward(ours), { once: true });
  }
  return controller.signal;
}

/**
 * fetch, with identity attached and a deadline on the wait for the response. Returns the raw
 * response so silent-degrade callers (voice, TTS) can simply give up; callers that speak to the
 * learner pass it through `throwForGatewayStatus`.
 *
 * The deadline guards the wait for the HEADERS and is cleared the moment they arrive. That is
 * deliberate: the board turn streams its answer and holds the connection open long past any of
 * these numbers on purpose, and a deadline on the whole response would cut a lesson in half. What
 * the register found — a call hanging past forty-five seconds with nothing on screen — is a
 * response that never starts, and that is exactly what this catches.
 *
 * `timeoutMs` of `null` opts out entirely; a caller doing its own deadline should say so rather
 * than inherit two.
 */
export async function gatewayFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number | null = gatewayTimeoutMs(url),
): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await gatewayAuthHeaders())) headers.set(k, v);
  if (timeoutMs === null) return fetch(url, { ...init, headers });

  const deadline = new AbortController();
  const expired = new GatewayTimeoutError(timeoutMs);
  const timer = setTimeout(() => deadline.abort(expired), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: combineSignals(init.signal, deadline.signal),
    });
  } catch (err) {
    // Only OUR deadline becomes the "taking longer than it should" line. A learner who cancelled,
    // or a network that dropped, is a different fact and keeps its own error.
    if (deadline.signal.aborted) throw expired;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetch + identity + typed refusals + JSON. The path most callers want.
 *
 * One deadline covers the headers AND the body here, because this path reads a single body to
 * completion: a response that begins and then stalls mid-JSON is the same hang to a learner as one
 * that never begins.
 */
export async function gatewayJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs: number | null = gatewayTimeoutMs(url),
): Promise<T> {
  if (timeoutMs === null) {
    const res = await gatewayFetch(url, init, null);
    await throwForGatewayStatus(res);
    return (await res.json()) as T;
  }
  const deadline = new AbortController();
  const expired = new GatewayTimeoutError(timeoutMs);
  const timer = setTimeout(() => deadline.abort(expired), timeoutMs);
  try {
    const res = await gatewayFetch(
      url,
      { ...init, signal: combineSignals(init.signal, deadline.signal) },
      null,
    );
    await throwForGatewayStatus(res);
    return (await res.json()) as T;
  } catch (err) {
    if (deadline.signal.aborted) throw expired;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- The voice seam ------------------------------------------------------------------------------

export interface VoiceSessionToken {
  mode: string;
  /** Short-lived, single-use, bound to the subject. Both voice sockets consume one. */
  token: string;
}

/**
 * Mint the single-use token both voice websockets require. WebSockets carry no headers we control,
 * so identity is proved here, over authenticated HTTP, and handed to the socket as `?token=`.
 * Returns null whenever voice is simply not available (no gateway, not signed in, no key upstream)
 * — voice degrades silently; it is grace, never the help.
 */
export async function mintVoiceToken(gatewayUrl: string): Promise<VoiceSessionToken | null> {
  try {
    const res = await gatewayFetch(`${gatewayUrl}/v1/voice/session`);
    if (!res.ok) return null;
    const body = (await res.json()) as { mode?: string; token?: string };
    if (!body.token || !body.mode) return null;
    return { mode: body.mode, token: body.token };
  } catch {
    return null;
  }
}

/** Build a voice websocket URL from the gateway's http(s) origin plus a minted token. */
export function voiceSocketUrl(gatewayUrl: string, path: string, token: string): string {
  return `${gatewayUrl.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(token)}`;
}

// --- Who am I, and what is left today ------------------------------------------------------------

export interface BudgetMeter {
  used: number | null;
  limit: number | null;
  remaining: number | null;
}

/**
 * THE DAY'S ALLOWANCE, AS A SHARE OF ITSELF (docs/ALLOWANCE.md §2).
 *
 * The allowance is arithmetic in rupees inside the gateway and on the operator's desk, and it is
 * a proportion everywhere else: *"it's not money based at the users' end; that is only for
 * internal purposes"* (the owner, 2026-09-08). So the only number that crosses this wire into a
 * learner's browser is `used`, between 0 and 1, which is exactly what a bar needs and carries no
 * currency, no monthly figure and no generosity fraction.
 *
 * A gateway that sends the pair instead (a spent figure and a day's figure) is read as the same
 * share and neither figure is kept, so no amount can reach a screen through this type.
 */
export interface DayAllowance {
  /** 0..1 — how much of today has been spent. Null when the brain did not say. */
  used: number | null;
  /** ISO instant the day rolls over, when the brain named one. */
  resetsAt: string | null;
  /** The day is spent. The brain's own answer where it gave one, else a full share. */
  spent: boolean;
}

/** What `GET /v1/me` tells the client about itself. Never a model, never a price. */
export interface Me {
  subject: string | null;
  /** An anonymous learner (signed in without an account) — a smaller day, no elevated doors. */
  anonymous: boolean;
  plan: string;
  /** Server-derived; the client never declares it. */
  consentTier: string | null;
  budget: {
    turns: BudgetMeter;
    generations: BudgetMeter;
    /** ISO instant the daily window rolls over. */
    resetAt: string | null;
  };
  /**
   * The day's allowance as a share (docs/ALLOWANCE.md §2). Optional because a gateway that has not
   * shipped the meter yet answers without it, and the bar then draws nothing rather than a zero it
   * did not read. `parseMe` always sets it; only a hand-written `Me` in a test can leave it out.
   */
  allowance?: DayAllowance;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function meter(raw: unknown): BudgetMeter {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { used: num(r.used), limit: num(r.limit), remaining: num(r.remaining) };
}

/**
 * The day's allowance, read as a share and never as an amount.
 *
 * Lenient in one direction only, and deliberately: a `used` the gateway sends as a figure rather
 * than a fraction (paise spent against paise allowed) is divided here and the two figures are
 * dropped on the floor. That is the whole guard — money is internal (docs/ALLOWANCE.md §2), so the
 * shape the browser holds cannot carry an amount even if the wire does.
 */
function dayAllowance(raw: unknown): DayAllowance {
  const r = (raw ?? {}) as Record<string, unknown>;
  const used = num(r.used) ?? num(r.spent);
  const limit = num(r.limit) ?? num(r.allowed) ?? num(r.day);
  let share = used;
  if (share !== null && share > 1) share = limit !== null && limit > 0 ? share / limit : 1;
  if (share !== null) share = Math.max(0, Math.min(1, share));
  return {
    used: share,
    resetsAt: text(r.resets_at) ?? text(r.resetsAt) ?? text(r.reset_at),
    spent: r.spent === true || r.exhausted === true || share === 1,
  };
}

/**
 * Read the learner's own budget. Parsed leniently: the brain owns this shape and may grow it, and
 * a UI counter is never worth a crash.
 */
export function parseMe(raw: unknown): Me {
  const r = (raw ?? {}) as Record<string, unknown>;
  const budget = (r.budget ?? {}) as Record<string, unknown>;
  return {
    subject: text(r.subject) ?? text(r.sub),
    anonymous: r.anonymous === true || r.is_anonymous === true,
    plan: text(r.plan) ?? 'free',
    consentTier: text(r.consent_tier) ?? text(r.consentTier),
    budget: {
      turns: meter(budget.turns),
      generations: meter(budget.generations),
      resetAt: text(budget.reset_at) ?? text(budget.resetAt) ?? text(r.reset_at),
    },
    allowance: dayAllowance(r.allowance ?? budget.allowance),
  };
}

/** GET /v1/me — identity, plan, and what is left of today. Throws the same typed refusals. */
export async function fetchMe(gatewayUrl: string): Promise<Me> {
  return parseMe(await gatewayJson<unknown>(`${gatewayUrl}/v1/me`));
}
