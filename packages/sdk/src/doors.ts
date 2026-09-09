/**
 * THE DOOR, AS THE SDK OBEYS IT. One question, asked before anything mints an account.
 *
 * `docs/DOORS-CLOSED.md` §1: *"No sign-up, no anonymous account, no account created by any path."*
 * §4: *"a test proves an account cannot be created by any path while the dial is off, including
 * the anonymous path the public ask box would otherwise use."*
 *
 * THE HOLE THIS CLOSES. The gateway can refuse an anonymous principal's calls, and it does. What
 * it cannot refuse is the account being CREATED, because that happens at the auth server with the
 * public key and never touches the gateway at all. So the SDK asked for a fresh anonymous account
 * on every boot behind the door, unconditionally: a stranger who typed `/onboarding` or `/home`
 * had one minted for them before the invitation was even drawn, and rows were written under it.
 * Nothing was gained by it (every call that account made was refused) and a person who never
 * agreed to anything now existed.
 *
 * FOUR DECISIONS, the same four the browser's own dial makes, and for the same reasons:
 *
 *  · **Closed is every failure.** No answer, a 500, a shape nobody expected: no account is made.
 *    Nobody is locked out by that, because a session that already exists is never re-minted.
 *  · **Only the word yes opens it.** `{ "doors_open": true }` and nothing else.
 *  · **No gateway, no question.** A build with no brain to ask is a mock or a local build with no
 *    product to protect and nothing to sign up to. It behaves exactly as it always did.
 *  · **The answer is held for a minute**, which is what the law gives the whole product, so a
 *    boot does not ask twice and a reopened door is followed without a release.
 *
 * The path and the key are `contracts/doors.json`, which the gateway's own suite reads too. They
 * are repeated here rather than imported from the web app on purpose: this package is a leaf that
 * the app depends on, never the other way round, and the contract test is what holds the two
 * spellings together.
 */

/** The gateway's route for the switch. */
export const DOORS_PATH = '/v1/doors';

/** The one key in its answer. */
export const DOORS_KEY = 'doors_open';

/** How long an answer is held. The law says the product follows the switch "within a minute". */
export const DOORS_TTL_MS = 60_000;

let held: { url: string; at: number; open: boolean } | null = null;

/** Test seam, and what a reload does anyway. */
export function resetDoors(): void {
  held = null;
}

/**
 * Ask the gateway once. Never throws, and answers `false` for everything that is not a plain yes.
 */
export async function readDoorsOpen(
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const base = (gatewayUrl ?? '').replace(/\/$/, '');
  if (!base) return false;
  try {
    const res = await fetchImpl(`${base}${DOORS_PATH}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return body?.[DOORS_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * May this device create an account right now?
 *
 * The one question `client.ts` asks before an anonymous sign-in, and the only place in this
 * package that decides it.
 */
export async function mayCreateAccount(
  gatewayUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<boolean> {
  const base = (gatewayUrl ?? '').replace(/\/$/, '');
  // No brain to ask. A mock or local build has no product behind the door and nothing to protect;
  // the gateway is what actually refuses, and there is no gateway here.
  if (!base) return true;
  const at = now();
  if (held && held.url === base && at - held.at < DOORS_TTL_MS) return held.open;
  const open = await readDoorsOpen(base, fetchImpl);
  held = { url: base, at, open };
  return open;
}
