/**
 * The lock. Whether this console shows anything at all.
 *
 * THE RULE, and it is the whole file: an admin is not a learner with a flag set. Nothing in this
 * bundle may decide that somebody is an operator. The console asks the gateway's guard and opens
 * ONLY on an explicit, well-formed identity that the server minted from a row in `ops.admins`.
 * Every other outcome — a 401, a 403, the 404 a stranger is deliberately shown, a 502, a timeout,
 * a 200 carrying a body this code does not recognise — leaves the console LOCKED. That is the
 * fail-closed direction: a console that refuses to open when it cannot verify anyone is an
 * inconvenience; a console that opens because nothing said no is a breach.
 *
 * There is deliberately no persistence. No localStorage, no sessionStorage, no cookie, no
 * "remember me". `admin_auth.py` mints the console token once and says the console must keep it
 * in memory so that a script injected into another tab cannot read it, and `api.holdProofs` is
 * where that is kept true. A reload signs in again.
 */

import { clearProofs, holdProofs, read, write } from './api';
import { type AdminIdentity, CONSOLE_READ } from './contract';
import { type SignInProblem, signInToProduct } from './productSignIn';

export type Session =
  /** The first render, before anything has been asked. Shows nothing; opens nothing. */
  | { readonly state: 'checking' }
  /** Nobody is in. `why` is null when the operator has simply not signed in yet. */
  | { readonly state: 'locked'; readonly why: LockReason | null }
  /** The server said who this is. The only state that renders a desk. */
  | {
      readonly state: 'open';
      readonly admin: AdminIdentity;
      /** True when the account signed in without a second factor. Production refuses that, so
       *  the console says it out loud rather than letting somebody meet a silent refusal. */
      readonly weakFactor: boolean;
    };

export type LockReason =
  | SignInProblem
  | 'not_registered'
  | 'guard_unreachable'
  | 'guard_unrecognised'
  | 'guard_error';

export const LOCK_COPY: Record<LockReason, string> = {
  unconfigured: 'This build has no account service configured, so nobody can sign in.',
  refused: 'That did not sign you in.',
  code_required: 'Enter the code from your authenticator.',
  code_refused: 'That code was not accepted. Try the next one.',
  unreachable: 'The account service did not answer.',
  // The guard shows a stranger the same body a missing page shows, on purpose: the existence of
  // a console is itself information. So this console cannot tell "not registered" from "not
  // deployed", and it does not pretend to — it names both possibilities and neither as fact.
  not_registered:
    'The console did not open. Either this account is not in the operator register, or the ' +
    'console is not deployed on the gateway this build points at. The gateway will not say ' +
    'which, and that is deliberate.',
  guard_unreachable: 'The gateway is unreachable from here, so no sign-in could be checked.',
  guard_unrecognised: 'The gateway returned something this console does not recognise.',
  guard_error: 'The gateway answered with an error while opening the console.',
};

/**
 * The one shape check. An identity is an id, an email, a role and a list of permissions, all
 * present and all the right type. A body missing any of them is `unrecognised`, never trusted:
 * this function stands between "the server minted an operator" and "something returned JSON".
 */
export function isAdminEnvelope(value: unknown): value is { admin: AdminIdentity } {
  if (typeof value !== 'object' || value === null) return false;
  const admin = (value as { admin?: unknown }).admin as Record<string, unknown> | undefined;
  if (typeof admin !== 'object' || admin === null) return false;
  if (typeof admin.id !== 'string' || admin.id.length === 0) return false;
  if (typeof admin.email !== 'string' || admin.email.length === 0) return false;
  if (typeof admin.role !== 'string' || admin.role.length === 0) return false;
  if (!Array.isArray(admin.permissions)) return false;
  return admin.permissions.every((entry) => typeof entry === 'string');
}

/** The session envelope `POST /v1/admin/session` returns: the identity, plus the token. */
export function isOpenedSession(
  value: unknown,
): value is { admin: AdminIdentity; session_token: string } {
  if (!isAdminEnvelope(value)) return false;
  const token = (value as { session_token?: unknown }).session_token;
  return typeof token === 'string' && token.length > 0;
}

function identityOf(admin: AdminIdentity): AdminIdentity {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    permissions: [...admin.permissions],
  };
}

/** May this seat read the console's aggregates at all? Asked before a money desk is drawn, so a
 *  support seat sees a desk list it can actually use instead of a row of refusals. */
export function mayReadConsole(admin: AdminIdentity): boolean {
  return admin.permissions.includes(CONSOLE_READ);
}

/**
 * Sign in: the product's own factor, then the register. PURE of storage, and fail-closed at every
 * branch — the only path to `open` is a 200 from the guard carrying an identity AND a token.
 */
export async function signIn(
  credentials: { readonly email: string; readonly password: string; readonly code: string },
  fetcher: typeof fetch = fetch,
): Promise<Session> {
  const product = await signInToProduct(credentials, fetcher);
  if (!product.ok) {
    clearProofs();
    return { state: 'locked', why: product.problem };
  }

  // The product token alone opens nothing. It is held only so the next call can carry it.
  holdProofs(product.token, null);
  const opened = await write('session', {}, isOpenedSession, fetcher);
  if (!opened.ok) {
    clearProofs();
    switch (opened.reason) {
      case 'not_permitted':
      case 'not_deployed':
        return { state: 'locked', why: 'not_registered' };
      case 'unreachable':
      case 'unconfigured':
        return { state: 'locked', why: 'guard_unreachable' };
      case 'unrecognised':
        return { state: 'locked', why: 'guard_unrecognised' };
      default:
        return { state: 'locked', why: 'guard_error' };
    }
  }

  holdProofs(product.token, opened.value.session_token);
  return {
    state: 'open',
    admin: identityOf(opened.value.admin),
    weakFactor: product.assurance !== 'aal2',
  };
}

/**
 * Re-ask the guard who is looking. Called after any read comes back `not_permitted`, so an
 * expired console session closes the console rather than leaving desks refreshing into refusals.
 */
export async function stillOpen(fetcher: typeof fetch = fetch): Promise<boolean> {
  const answer = await read('whoami', isAdminEnvelope, {}, fetcher);
  return answer.ok;
}

/** End the session server-side, then forget both proofs whatever the server said. Forgetting is
 *  unconditional on purpose: a revoke that failed must still not leave a live token in this tab.
 *
 *  DELETE on `/v1/admin/session`, which is the route that actually revokes the row
 *  (`admin_auth.close_console_session`). The POST to `/v1/admin/session/end` this used to send
 *  reached a route that has never existed: it 404'd, `api.statusToReason` read the 404 as
 *  'not_deployed', and the result was thrown away here — so an operator pressed sign-out, saw a
 *  locked console, and left a live session token on the server. */
export async function signOut(fetcher: typeof fetch = fetch): Promise<Session> {
  await write(
    'sessionEnd',
    undefined,
    (value): value is unknown => value !== undefined,
    fetcher,
    'DELETE',
  );
  clearProofs();
  return { state: 'locked', why: null };
}
