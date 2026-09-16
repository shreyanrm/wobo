/**
 * The console's one door to the gateway. Every admin request in this bundle goes through here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, and why each is a security decision rather than a style one:
 *
 *   Nothing is persisted. The two proofs — the product access token and the console session
 *   token — live in module memory and are handed in by `session.ts`. Neither reaches
 *   localStorage, sessionStorage, IndexedDB or a cookie this script can write. A reload signs in
 *   again; the alternative is a key to every learner in the product sitting in a store that any
 *   script on the origin can read.
 *
 *   No caching, ever. `cache: 'no-store'` on every call. An operator screen showing a figure from
 *   before an incident is how a wrong decision gets made, and a cached admin response in a shared
 *   browser cache is a disclosure.
 *
 *   No retries on its own initiative. A failed read is reported as a failed read. Silent retries
 *   turn one 502 into a burst against a gateway that is already unwell, and they hide the very
 *   failure the health desk exists to show.
 *
 *   `credentials: 'omit'`. The proofs are headers; sending cookies as well would only re-open
 *   the CSRF surface the guard chose a header to close.
 *
 *   Every outcome is a value, never a thrown surprise. Nothing in this file can produce a number,
 *   so nothing in this file can produce a number that is not sourced.
 */

import { ENDPOINT, type EndpointName, gatewayBase } from './contract';

/** How long a desk waits before it calls a read failed. Short: an operator watching an incident
 *  needs to know the gateway is not answering, not to watch a spinner for thirty seconds. */
export const READ_TIMEOUT_MS = 8000;

export type Fetched<T> =
  | { readonly ok: true; readonly value: T; readonly at: string }
  | {
      readonly ok: false;
      readonly reason: FailureReason;
      readonly status: number | null;
      /** The gateway's own refusal code (`detail.code`), when it gave one in a shape we trust.
       *  A word, never a sentence: the console chooses what to say about it. */
      readonly code?: string;
    };

/** Why a read did not produce a number. These words go on the screen; every one is about OUR
 *  system, none is about the operator, and none implies data that is not there. */
export type FailureReason =
  | 'not_deployed'
  | 'not_permitted'
  | 'gateway_error'
  | 'unreachable'
  | 'unrecognised'
  | 'unconfigured';

export const FAILURE_COPY: Record<FailureReason, string> = {
  not_deployed: 'this endpoint is not deployed on the gateway this console points at',
  not_permitted: 'the session has ended, or this seat may not read this',
  gateway_error: 'the gateway answered with an error',
  unreachable: 'nothing answered — the gateway is unreachable from here',
  unrecognised: 'the answer was not a shape this console understands',
  unconfigured: 'no gateway address is configured in this build',
};

/**
 * The two proofs, held in module memory for the life of the tab and nowhere else.
 *
 * `product` is the Supabase access token the admin signed in with; `console` is the short session
 * the guard minted. The guard needs both, and losing either — a reload, a closed tab, a sign-out
 * — means signing in again, which is the intended cost.
 */
let proofs: { product: string | null; console: string | null } = { product: null, console: null };

export function holdProofs(product: string | null, consoleToken: string | null): void {
  proofs = { product, console: consoleToken };
}

export function clearProofs(): void {
  proofs = { product: null, console: null };
}

/** The header this gateway's guard reads its console session from (`admin_auth.SESSION_HEADER`). */
export const SESSION_HEADER = 'x-wobo-admin-session';

function proofHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (proofs.product) headers.authorization = `Bearer ${proofs.product}`;
  if (proofs.console) headers[SESSION_HEADER] = proofs.console;
  return headers;
}

function statusToReason(status: number): FailureReason {
  // 404 is ALSO what a stranger is shown on purpose (`ops` and `admin_auth` both answer a
  // not-for-you with Starlette's own Not Found, because the existence of a console is itself
  // information). The console cannot tell the two apart from here and must not guess: it says
  // the endpoint did not answer, and the operator, who knows whether they are registered, can.
  if (status === 404) return 'not_deployed';
  if (status === 401 || status === 403) return 'not_permitted';
  return 'gateway_error';
}

/** `detail.code` from a refusal, when it is one short lower-case word. Anything else is dropped:
 *  a proxy's error page must not be able to put words on this screen. */
async function refusalCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: { code?: unknown } } | null;
    const code = body?.detail?.code;
    return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** A per-person tail on an endpoint: `/<uuid>` and at most one lower-case word after it. Nothing
 *  that could climb out of the endpoint, and nothing an operator typed. */
const SUBPATH = /^\/[0-9a-f-]{8,64}(\/[a-z]{1,32})?$/;

async function send<T>(
  url: string,
  init: RequestInit,
  guard: (body: unknown) => body is T,
  fetcher: typeof fetch,
): Promise<Fetched<T>> {
  const timer = new AbortController();
  const cancel = setTimeout(() => timer.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      signal: timer.signal,
    });
    if (!response.ok) {
      const code = await refusalCode(response);
      return {
        ok: false,
        reason: statusToReason(response.status),
        status: response.status,
        ...(code ? { code } : {}),
      };
    }
    const body: unknown = response.status === 204 ? {} : await response.json();
    if (!guard(body)) return { ok: false, reason: 'unrecognised', status: response.status };
    return { ok: true, value: body, at: new Date().toISOString() };
  } catch {
    // A DNS failure, a CORS refusal, an abort and a torn connection are the same fact to an
    // operator: nothing answered. Naming the browser's exception would say less, not more.
    return { ok: false, reason: 'unreachable', status: null };
  } finally {
    clearTimeout(cancel);
  }
}

/** One GET. `guard` is the shape check: an answer that fails it is `unrecognised` rather than
 *  trusted, which is the difference between an empty desk and a desk showing whatever a confused
 *  proxy happened to return. */
export async function read<T>(
  endpoint: EndpointName,
  guard: (body: unknown) => body is T,
  options: { readonly query?: Record<string, string> } = {},
  fetcher: typeof fetch = fetch,
): Promise<Fetched<T>> {
  const base = gatewayBase();
  if (!base) return { ok: false, reason: 'unconfigured', status: null };
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
  return send(
    `${base}${ENDPOINT[endpoint]}${query}`,
    { method: 'GET', headers: proofHeaders() },
    guard,
    fetcher,
  );
}

/**
 * One write. Separate from `read` because a write must never be retried and must never be issued
 * without an explicit operator action — and because the day this console grows an action that
 * changes a learner's data or their money, that action needs a second confirmation and a step-up
 * (`POST /v1/admin/session/reauth`). The confirmation belongs at the call site; this stays the
 * plumbing and never the policy.
 */
export async function write<T>(
  endpoint: EndpointName,
  body: unknown,
  guard: (value: unknown) => value is T,
  fetcher: typeof fetch = fetch,
  method: 'POST' | 'DELETE' = 'POST',
  subpath = '',
): Promise<Fetched<T>> {
  const base = gatewayBase();
  if (!base) return { ok: false, reason: 'unconfigured', status: null };
  if (subpath && !SUBPATH.test(subpath)) return { ok: false, reason: 'unrecognised', status: null };
  const headers = proofHeaders();
  if (body !== undefined) headers['content-type'] = 'application/json';
  return send(
    `${base}${ENDPOINT[endpoint]}${subpath}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    guard,
    fetcher,
  );
}
