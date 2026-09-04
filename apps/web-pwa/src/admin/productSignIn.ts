/**
 * The product's own sign-in, driven from the console — the FIRST of the two proofs the guard
 * needs, and the only one this bundle can obtain.
 *
 * `admin_auth.py` is explicit that it invents no password store: the factor is the product's own
 * sign-in plus TOTP, and the gateway checks `aal2` on the token rather than holding anyone's
 * secret. So the console does what the guard's own docstring says it does — it runs the
 * challenge-and-verify itself and posts the resulting token — and that flow is here, in three
 * plain calls against GoTrue's REST API.
 *
 *   1. `POST /auth/v1/token?grant_type=password`   → a token at assurance level 1.
 *   2. `POST /auth/v1/factors/{id}/challenge`      → a challenge id, for the enrolled TOTP factor.
 *   3. `POST /auth/v1/factors/{id}/verify`         → a NEW token at assurance level 2.
 *
 * The token from step 3 is the one the gateway will accept in production. The token from step 1
 * is kept only long enough to run steps 2 and 3 and is then dropped.
 *
 * WHY REST AND NOT THE SUPABASE CLIENT LIBRARY. The library persists a session to localStorage by
 * default and refreshes it in the background — both of which are exactly what an operator
 * credential must not do. Three fetches with no persistence layer is less code, and the absence
 * of storage is the point rather than a setting somebody can flip back.
 *
 * WHAT THIS IS NOT. It is not a second authorisation. Getting a token here proves who somebody is
 * and that they hold their second factor; it says nothing at all about whether they may open the
 * console. That is decided by a row in `ops.admins`, server-side, on every single request.
 */

import { resolveSupabaseUrl } from '../config/supabaseUrl';

/** The publishable key GoTrue requires on every call. Not a secret and not an authorisation: it
 *  identifies the project, and every real check happens against the token. */
function anonKey(env: ImportMetaEnv = import.meta.env): string {
  return (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
}

export function authBase(env: ImportMetaEnv = import.meta.env): string | undefined {
  const base = resolveSupabaseUrl({
    projectUrl: env.VITE_SUPABASE_URL,
    proxy: env.VITE_SUPABASE_PROXY,
    appUrl: env.VITE_APP_URL,
  });
  return base ? `${base}/auth/v1` : undefined;
}

export type SignInOutcome =
  /** A token the gateway will accept. `assurance` says whether the second factor was actually
   *  used, so the console can warn rather than let somebody discover it at the door. */
  | { readonly ok: true; readonly token: string; readonly assurance: 'aal1' | 'aal2' }
  /** Wrong details, a missing code, an unreachable project, or no project configured at all. */
  | { readonly ok: false; readonly problem: SignInProblem };

export type SignInProblem =
  | 'unconfigured'
  | 'refused'
  | 'code_required'
  | 'code_refused'
  | 'unreachable';

export const SIGN_IN_COPY: Record<SignInProblem, string> = {
  unconfigured: 'This build has no account service configured, so nobody can sign in.',
  refused: 'That did not sign you in.',
  code_required: 'Enter the code from your authenticator.',
  code_refused: 'That code was not accepted. Try the next one.',
  unreachable: 'The account service did not answer.',
};

interface Factor {
  readonly id: string;
  readonly status?: string;
  readonly factor_type?: string;
}

async function post(url: string, token: string | null, body: unknown, fetcher: typeof fetch) {
  const key = anonKey();
  return fetcher(url, {
    method: 'POST',
    // Never a cookie: the session lives in memory for the length of this sign-in and no longer.
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(key ? { apikey: key } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The verified TOTP factor on this account, or null. Unverified factors are ignored: a factor
 *  half-enrolled is not a second factor, and treating it as one would be the whole point missed. */
export function verifiedTotp(user: unknown): Factor | null {
  const factors = (user as { factors?: unknown })?.factors;
  if (!Array.isArray(factors)) return null;
  const found = factors.find(
    (factor: Factor) => factor?.factor_type === 'totp' && factor?.status === 'verified',
  );
  return found && typeof found.id === 'string' ? found : null;
}

/**
 * Sign in, and step up to `aal2` when the account carries a verified authenticator.
 *
 * An account with no enrolled factor returns `aal1`. That is reported honestly rather than
 * silently: in production the gateway refuses it (`ADMIN_REQUIRE_MFA`), and telling somebody
 * "enrol your authenticator" beats letting them meet a refusal they cannot read.
 */
export async function signInToProduct(
  credentials: { readonly email: string; readonly password: string; readonly code: string },
  fetcher: typeof fetch = fetch,
): Promise<SignInOutcome> {
  const base = authBase();
  if (!base) return { ok: false, problem: 'unconfigured' };

  try {
    const first = await post(
      `${base}/token?grant_type=password`,
      null,
      { email: credentials.email, password: credentials.password },
      fetcher,
    );
    if (!first.ok) return { ok: false, problem: 'refused' };
    const session = (await first.json()) as { access_token?: string; user?: unknown };
    const aal1 = typeof session.access_token === 'string' ? session.access_token : '';
    if (!aal1) return { ok: false, problem: 'refused' };

    const factor = verifiedTotp(session.user);
    if (!factor) return { ok: true, token: aal1, assurance: 'aal1' };
    if (!credentials.code) return { ok: false, problem: 'code_required' };

    const challenge = await post(`${base}/factors/${factor.id}/challenge`, aal1, {}, fetcher);
    if (!challenge.ok) return { ok: false, problem: 'code_refused' };
    const { id } = (await challenge.json()) as { id?: string };
    if (!id) return { ok: false, problem: 'code_refused' };

    const verified = await post(
      `${base}/factors/${factor.id}/verify`,
      aal1,
      { challenge_id: id, code: credentials.code },
      fetcher,
    );
    if (!verified.ok) return { ok: false, problem: 'code_refused' };
    const stepped = (await verified.json()) as { access_token?: string };
    if (typeof stepped.access_token !== 'string' || !stepped.access_token) {
      return { ok: false, problem: 'code_refused' };
    }
    return { ok: true, token: stepped.access_token, assurance: 'aal2' };
  } catch {
    return { ok: false, problem: 'unreachable' };
  }
}
