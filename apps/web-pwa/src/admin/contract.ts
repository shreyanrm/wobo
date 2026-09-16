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
  /** DELETE on the SAME path: close it. The row is revoked, so the token is dead on the next
   *  request. Until 2026-09-07 this named `/v1/admin/session/end`, a route the gateway has never
   *  registered — the POST 404'd, `signOut` discarded the failure, and the console showed a clean
   *  sign-out while the session stayed live on the server until its TTL. */
  sessionEnd: '/v1/admin/session',
  /** GET: who the console is talking to, and what this session may still do. */
  whoami: '/v1/admin/whoami',
  /** GET: the panels this seat may READ, each with whether it may also act, and the effective
   *  capability list. Only held panels are in the answer: the rail is drawn from it, and a panel
   *  that is not in it is not drawn at all (docs/CONSOLE-ROLES-AND-BOARD.md §2). */
  panels: '/v1/admin/panels',
  /** GET: the trail. Every seat reads its own rows; the owner reads everybody's. */
  audit: '/v1/admin/audit',
  /** GET: the register, owner only: every seat with its EFFECTIVE capabilities, what the owner
   *  granted and revoked by hand, the whole vocabulary, each role's defaults and the owner count.
   *  POST on the same path invites a person by address and answers with the invitation link and
   *  its message, which nothing sends. Per person, on `/<id>/capabilities`, `/<id>/suspend` and
   *  `/<id>/invitation` (a fresh link), through `api.write`'s checked tail. */
  admins: '/v1/admin/admins',
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
  /** GET: who came today, in seven days and in thirty, and how many sit on each step of the mail
   *  ladder, from `learner.activity` (migration 0034). Counts only; nobody is named. */
  activity: '/v1/admin/activity',
  /** GET: `?id=` — ONE learner's last visit, days active this month, streak and mail step, on
   *  `learner.read`, audited as its own action. Never called on its own initiative. */
  learnerActivity: '/v1/admin/learners/activity',
  /** GET: the mail desk — complaint rates overall and per kind against 0.10 and 0.30 percent,
   *  bounces, the COUNT of suppressed addresses, seed placement, Gmail's day from Postmaster Tools,
   *  paused kinds and every alert, from `ops.mail_watch` (migration 0036). Nobody is named. */
  mail: '/v1/admin/mail',
  /** POST: lift the deliverability watch's pause on one kind. `admin.manage`, which only an owner
   *  carries and which the guard demands a step-up for; audited, and the dial's own trail records
   *  the owner and the note. Answers with the desk as it now stands. */
  mailUnpause: '/v1/admin/mail/unpause',
  /** GET: every promo code with its real use count, from `ops.promo_codes` (migration 0027). */
  promo: '/v1/admin/promo',
  /** GET: who has taken a code, as a keyed digest, and what it granted. `?code=&limit=`. */
  promoRedemptions: '/v1/admin/promo/redemptions',
  /** POST: mint one code. On `admin.manage`, which ONLY an owner carries and which the guard
   *  demands a step-up for: a code is money, and minting one is the console's only route that
   *  creates something a learner can spend. */
  promoCreate: '/v1/admin/promo/create',
  /** POST: switch one code off. Also `admin.manage`. A code is never deleted — the redemptions
   *  point at it, and a grant whose code has vanished is a row nobody can explain. */
  promoDisable: '/v1/admin/promo/disable',
  /** GET: the router's whole table — every tier's primary and chain, the vendor's price beside
   *  each id, the jobs that ride it, who is carrying it right now, the generation ladder and the
   *  creative pool. POST on the SAME path moves a tier, moves the ladder, or clears every
   *  override; it needs `admin.manage`, which only an owner carries and which the guard demands a
   *  step-up for, because it changes what every child is answered by and what it costs. */
  models: '/v1/admin/models',
  /** GET: generosity per plan, the free plan's rupees, the INR rate, what each buys a learner in
   *  a day, and the pace across learners. POST on the same path turns those dials; owner only.
   *  MONEY IS INTERNAL ONLY (docs/ALLOWANCE.md §5): nothing read here may reach a learner or a
   *  parent surface, and no screen outside this console may call it. */
  allowance: '/v1/admin/allowance',
  /** POST: re-read every dial from `ops.settings` NOW rather than at the end of the interval. */
  settingsApply: '/v1/admin/settings/apply',
  /** GET: every board, the honest label each is showing a learner and WHY that one, the discovery
   *  queue in drain order, what landed, what refused and why, what each board cost, and the
   *  platform's day against its ceiling (docs/BOARD-COLD-START.md §4 and §5). */
  syllabus: '/v1/admin/syllabus',
  /** POST: send one refused board back to the queue. `support.act` — a refusal is REMEMBERED so a
   *  dead link is not re-fetched on every learner who picks that board, and this is the person
   *  overriding that memory. A job still running is refused with 409, never re-queued. */
  syllabusRetry: '/v1/admin/syllabus/retry',
  /** POST: promote one provisional reading to verified. `admin.manage`, and the body must SAY a
   *  person read it against the board's own document — "it is labelled provisional until a person
   *  confirms it. That gate already exists and does not move." */
  syllabusPromote: '/v1/admin/syllabus/promote',
  /** POST: the prewarm queue's order, its switch and its pace. `admin.manage`, because the order
   *  decides which boards the platform pays to read and in what order. */
  syllabusPrewarm: '/v1/admin/syllabus/prewarm',
  /** GET: every board-change request (the board a learner is on, the one they asked for, when
   *  they last changed, a keyed handle) and the three dials as the gateway obeys them
   *  (docs/CONSOLE-ROLES-AND-BOARD.md §1). `?state=&limit=`. */
  boardChanges: '/v1/admin/board-changes',
  /** POST: grant one request. `panel.boards.act`: Support work, so an operator clears the queue,
   *  and the owner may give it to or take it from any seat. */
  boardChangeGrant: '/v1/admin/board-changes/grant',
  /** POST: turn the three dials in ops.settings. `admin.manage`, owner only, audited. */
  boardChangeDials: '/v1/admin/board-changes/dials',
} as const;

export type EndpointName = keyof typeof ENDPOINT;

/** The three seats. A support seat that can work a queue has no business reading the money, so
 *  the console hides a desk the seat's permissions do not carry rather than showing a refusal. */
export const CONSOLE_READ = 'console.read';

/** The one permission ONLY an owner carries (`admin_auth.PERMISSIONS`). The console uses it to
 *  decide whether to draw the promo desk's minting form at all: a seat that cannot create a code
 *  is shown the list and not a form that would only ever answer 403. This is a courtesy, never a
 *  control — the gateway refuses the write whatever this bundle renders. */
export const ADMIN_MANAGE = 'admin.manage';

/** The permission that may turn an opaque learner id into that learner's record
 *  (`admin_auth.LEARNER_READ`). A viewer does not carry it; the console draws the lookup only for a
 *  seat that does. A courtesy, never a control: the gateway refuses everyone else. */
export const LEARNER_READ = 'learner.read';

/** Who the SERVER says is looking. Minted by the guard, never constructed in this bundle. */
export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
  /** The EFFECTIVE panel capabilities the gateway minted with the session (`panel.<id>.read` /
   *  `.act`). Replaced by every `GET /v1/admin/panels`. Missing means none: fail closed. */
  readonly capabilities?: readonly string[];
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
 * One grouping of the rollup, SUMMED BY THE GATEWAY (`models_api.group`) before it reaches this
 * console: what a tier, a model or a payer cost over a window. Declared here and read in
 * `readings.ts` only, so no desk module parses or orders a money figure on its own.
 */
export interface RollupTotals {
  readonly calls: number;
  readonly cost_usd: number;
  readonly cache_hits: number;
  readonly unpriced_calls: number;
  readonly tokens_in: number;
  readonly tokens_out: number;
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

// --- the boards (docs/BOARD-COLD-START.md §4 and §5) -----------------------------------------
// Wire shapes only. `cost_usd` is DECLARED here and READ in readings.ts, exactly as every other
// money field in this console is: the gateway sums (`curriculum/desk.py`), this file names the
// field, `readings.ts` is the one module that reads it, and no panel does arithmetic on it.

export interface BoardRow {
  readonly framework_id: string;
  readonly framework_name: string;
  readonly kind: string;
  readonly country: string | null;
  readonly region: string | null;
  readonly official_site: string | null;
  /** DERIVED BY THE GATEWAY (`curriculum/labels.py`). Never composed in this bundle. */
  readonly label: string;
  readonly status: string;
  /** The console's own explanation of why that label and not another. Internal, never a learner's. */
  readonly why: string;
  readonly has_syllabus: boolean;
  readonly version_id: string | null;
  readonly version_label: string | null;
  readonly source_url: string | null;
  readonly published_at: string | null;
  readonly subjects: number;
  readonly chapters: number;
  readonly may_promote: boolean;
}

export interface JobRow {
  readonly job_id: string;
  readonly framework_id: string | null;
  readonly framework_name: string;
  readonly level: string | null;
  readonly subject: string | null;
  readonly state: string;
  readonly message: string | null;
  readonly reason: string | null;
  readonly reason_plain: string | null;
  /** What the run actually saw, in the gateway's own words: the url, the checks that failed, the
   *  evidence behind the verdict. The reason above is a category, and a category can be the
   *  opposite of the fact — Uttar Pradesh's own Class 10 Mathematics pdf refused as "not the
   *  syllabus" because its legacy-font text layer matched nothing. Console only; the learner's
   *  own line is `message`. */
  readonly detail: string | null;
  /** Every candidate the run opened, with the title it was offered under and what became of it.
   *  The reason is the LAST thing that happened; this is the whole of it. */
  readonly tried: readonly string[];
  readonly attempts: number;
  /** "a learner", "the prewarm" or "nobody yet". Never who. */
  readonly waiting_on: string;
  /** Absent for a seat without the money panel (`console_panels.without_money`). */
  readonly cost_usd?: number | null;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}

export interface PrewarmRow {
  readonly rank: number;
  readonly framework_id: string;
  readonly framework_name: string;
  /** Approximate school enrolment, as the seeded order's own note. A rank-setter, not a claim. */
  readonly note: string;
  readonly has_syllabus: boolean;
}

export interface SyllabusDesk {
  readonly readable: boolean;
  readonly worker: { readonly enabled: boolean; readonly env: string; readonly interval_s: number };
  readonly prewarm: {
    readonly enabled: boolean;
    readonly source?: string;
    readonly editable_key?: string;
    readonly rejected?: readonly string[];
    readonly per_tick?: number;
    readonly order: readonly PrewarmRow[];
    readonly next: readonly {
      readonly framework_id: string;
      readonly framework_name: string;
      readonly level: string;
      readonly subject: string;
    }[];
    readonly targets?: readonly string[];
  };
  readonly boards: readonly BoardRow[];
  readonly queue: readonly JobRow[];
  readonly landed: readonly JobRow[];
  readonly refused: readonly JobRow[];
  /** Absent, with the day's figures, for a seat without the money panel. */
  readonly cost?: readonly {
    readonly framework_id: string;
    readonly framework_name: string;
    readonly jobs: number;
    readonly usd: number | null;
    readonly unpriced: number;
  }[];
  readonly day: {
    readonly spent_usd?: number;
    readonly ceiling_usd?: number;
    readonly fraction?: number | null;
    readonly lane: string;
    readonly shedding: boolean;
  };
  readonly counts?: {
    readonly boards: number;
    readonly with_syllabus: number;
    readonly queued: number;
    readonly refused: number;
  };
}
