/**
 * THE CONTRACT THIS CONSOLE CONSUMES. One file, so realigning it is one edit and not a hunt.
 *
 * The console owns no source of truth. It renders what the gateway tells it, and where the
 * gateway has nothing to tell it, it says so in words instead of drawing a chart.
 *
 * TWO PROOFS, NOT ONE. `services/gateway/src/wobo_gateway/admin_auth.py` is the door, and it
 * needs both of these on every guarded request:
 *
 *   1. `Authorization: Bearer <supabase access token>` — the product's own sign-in, verified by
 *      signature, audience and issuer before the admin door is reached, and (in production)
 *      carrying `aal2`, which Supabase writes only after a TOTP factor has actually been used.
 *   2. `x-wobo-admin-session: <token>` — a short, server-side, revocable console session minted
 *      by `POST /v1/admin/session`. A HEADER AND NOT A COOKIE, and that is the guard's decision,
 *      not ours: a cookie rides along on any request a third-party page can cause, which is the
 *      whole CSRF problem, whereas a header has to be set by our own script.
 *
 * Being signed in is never enough for a byte behind this door. The role is a ROW in `ops.admins`,
 * read server-side on every request. Nothing in this bundle can make anybody an admin, and there
 * is no admin flag, role claim or `isAdmin` boolean anywhere in it to try.
 *
 * THE SESSION TOKEN NEVER TOUCHES STORAGE. `admin_auth.py` says it plainly — "the console keeps
 * it in memory, not in localStorage, so a script injected into any other tab cannot read it" —
 * and `session.ts` is where that is kept true. A reload signs in again. That is the cost, and it
 * is the correct one for a key to every learner in the product.
 */

/** Where the brain is. The console may be pointed at a different host from the learner app (a
 *  private origin, a tunnel), so it has its own variable and falls back to the app's. */
export function gatewayBase(env: ImportMetaEnv = import.meta.env): string {
  return (env.VITE_ADMIN_GATEWAY_URL ?? env.VITE_GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
}

/**
 * Every path the console calls, named so a desk cannot invent one inline.
 *
 * Everything under `/v1/admin` except `session` is behind `admin_auth.admin_router()`, which
 * carries the guard in its dependencies — a route mounted there is protected because of where it
 * lives, not because somebody remembered a decorator.
 */
export const ENDPOINT = {
  /** POST: exchange a verified, second-factored sign-in for a console session. The one admin
   *  path that cannot be behind the session guard, because it is what issues the session. */
  session: '/v1/admin/session',
  /** POST: close it. The row is revoked, so the token is dead on the next request. */
  sessionEnd: '/v1/admin/session/end',
  /** GET: who the console is talking to, and what this session may still do. */
  whoami: '/v1/admin/whoami',
  /** GET: `ops.usage_daily` rows for a window, plus the live in-process ceiling. */
  usage: '/v1/admin/usage',
  /** GET: what a 1x day costs, split by what consumed it, with its own list of holes. */
  economics: '/v1/admin/economics',
  /** GET: `wobo_gateway.health.snapshot()`, read through the door so the look is audited. */
  health: '/v1/admin/health',
  /** GET: the four queue desks' counts, and what feeds each one, from `ops.reports`. */
  deskSummary: '/v1/admin/desks',
  /** GET: one desk's queue. `?kind=&state=&limit=`. No learner id on any row. */
  reports: '/v1/admin/reports',
  /** GET: `?id=` — who raised ONE refund or support message, on `learner.read`, audited as its
   *  own action. Never called on its own initiative: it is a control an operator presses. */
  reportWho: '/v1/admin/reports/who',
  /** POST: move one report through its states, on `support.act`, so the guard demands a step-up.
   *  The id rides in the body because this transport calls static endpoint names — see api.ts. */
  reportState: '/v1/admin/reports/state',
} as const;

export type EndpointName = keyof typeof ENDPOINT;

/** The three seats. A support seat that can work a queue has no business reading the money, so
 *  the console hides a desk the seat's permissions do not carry rather than showing a refusal. */
export const CONSOLE_READ = 'console.read';

/** Who the SERVER says is looking. Minted by the guard, never constructed in this bundle. */
export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

/** `wobo_gateway.health.snapshot()` as it comes over the wire. */
export interface HealthSnapshot {
  readonly status: 'ok' | 'degraded' | 'unhealthy';
  readonly mode: string;
  readonly version: string;
  readonly checks: Readonly<Record<string, HealthCheck>>;
}

export interface HealthCheck {
  readonly status: 'ok' | 'degraded' | 'fail';
  readonly [field: string]: unknown;
}

/** `wobo_gateway.spend.Ledger.as_dict()` — the in-process accumulator the ceiling enforces. */
export interface SpendNow {
  readonly day: string;
  readonly spent_usd: number;
  readonly ceiling_usd: number;
  readonly fraction: number;
  readonly calls: number;
}

/**
 * One row of `ops.usage_daily`. The primary key is (day, capability, model_served, plan,
 * unit_kind) and every measure is a SUM — the migration is explicit that a stored average cannot
 * be re-averaged and a stored distinct count cannot be added up, so neither is here to be found.
 */
export interface UsageDay {
  readonly day: string;
  readonly capability: string;
  readonly model_served: string;
  readonly plan: string;
  readonly unit_kind: string;
  readonly calls: number;
  readonly cache_hits: number;
  readonly fallback_calls: number;
  readonly anonymous_calls: number;
  /** Calls we could not put a price on. Shown BESIDE the money, never folded into it. */
  readonly unpriced_calls: number;
  /** Calls priced from a figure an operator typed rather than a vendor's price table. */
  readonly configured_calls: number;
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
  readonly unit_count: number;
  readonly latency_ms_total: number;
  /**
   * When `ops.roll_up_usage` last rebuilt this row. THE ROLLUP IS NOT LIVE: it runs every
   * `LEDGER_ROLLUP_INTERVAL_S` seconds (a quarter of an hour by default) on top of a five second
   * flush, so today's row can be well behind what the platform has actually spent. Every panel
   * prints the moment it fetched, which reads as live, so it prints this beside it.
   */
  readonly rolled_at?: string | null;
}

/**
 * The envelope every rollup read shares. `readable: false` means the ledger could not be reached,
 * and then `days` is empty because there is nothing to report — NOT because nothing happened.
 * Those two are rendered differently and this flag is the only thing that separates them.
 */
export interface UsageWindow {
  readonly since: string;
  readonly until: string;
  readonly readable: boolean;
  readonly days: readonly UsageDay[];
  /** What the ledger knows about its own losses: buffered, dropped, whether a store is wired. */
  readonly ledger: Readonly<Record<string, unknown>>;
  readonly spend_now: SpendNow;
  readonly ceiling_usd: number;
  /** The newest `rolled_at` in the window: how old the freshest figure below actually is. */
  readonly rolled_at?: string | null;
  /** How often the rollup rebuilds, in seconds. What "older than this" means for the line above. */
  readonly rollup_interval_s?: number;
}

/** `wobo_gateway.unit_economics.Derivation.as_dict()`. `gaps` is why it is incomplete, in words
 *  the console prints verbatim — a derivation with gaps is a floor, never a bill. */
export interface Economics {
  readonly since: string;
  readonly until: string;
  /** The plan the figure was actually BUILT from. `budget.limits_for` falls back to the free
   *  plan's dials for a name it does not know, so this is the resolved name and not the request. */
  readonly plan: string;
  /** What the caller asked for. Differs from `plan` exactly when no such plan has dials. */
  readonly asked_plan?: string;
  /** What the ledger knows about its own losses, carried on this read as well as on `usage`. */
  readonly ledger?: Readonly<Record<string, unknown>>;
  readonly rolled_at?: string | null;
  readonly rollup_interval_s?: number;
  readonly days: number;
  readonly rows: number;
  readonly per_unit: readonly {
    readonly unit_kind: string;
    readonly usd_per_unit: number | null;
    readonly [field: string]: unknown;
  }[];
  readonly attach: Readonly<Record<string, number>>;
  readonly free_day: {
    readonly usd: number | null;
    readonly complete: boolean;
    readonly components: readonly { readonly [field: string]: unknown }[];
    readonly gaps: readonly string[];
    /** Calls under this figure priced from a number an operator TYPED, not a vendor's table.
     *  `complete` can be true and this non-zero: nothing is missing, and the figure is still only
     *  as good as `LEDGER_PRICE_SPOKEN_SECOND_USD`. Two different facts, printed as two. */
    readonly configured_calls?: number;
  };
  readonly gaps: readonly string[];
}
