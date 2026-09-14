/**
 * THE LINK THAT LANDS (docs/EMAILS-AND-ANIMATIONS.md §4), on the app's side of it.
 *
 * A mail's one button carries a signed, expiring link to the exact card:
 * `https://heywobo.com/course/<course>/card/<card>?k=<token>`. Two things have to happen when a
 * learner presses it, and both of them live here as pure functions:
 *
 *  1. **The token never stays in the bar.** It is a credential minted for one inbox. Left in the
 *     address it would be in the history of a shared tablet, in the referrer of the next outbound
 *     link, and in every screenshot and share of the page. It is read once, at boot, and the
 *     address is corrected to the same page without it — one `replaceState`, no reload, no flash.
 *  2. **The destination survives the door.** Signed in on this device, the address IS the
 *     destination and nothing is needed. Not signed in, the app locks to the sign-in beat and — in
 *     live mode — reloads the document on the way out of it (`screens/Onboarding.tsx`), so the
 *     destination is written down on the device before the door and taken back once, after it.
 *
 * What is written down is a PATH THE ROUTER ANSWERS and nothing else. Not the token, which is a
 * credential and is never persisted; not an absolute URL, which is how a remembered destination
 * becomes an open redirect; not an address that is not ours, which would hand a learner a 404
 * after signing in and look like the sign-in failed.
 *
 * Device-level on purpose (`store/scope.ts` DEVICE_KEYS): it is written before there is a subject
 * to key it to. `sessionStorage`, so it dies with the tab — a destination that outlived the visit
 * it belongs to would grab a learner who came back the next morning for something else.
 */

import { pathToRoute } from './router';

/** Where the destination waits while the learner is at the door. */
export const ARRIVAL_KEY = 'wobo-arrival-v1';

/**
 * The query parameter the signed link carries. One letter, because the whole link is read aloud
 * by nobody and printed by no one, and a long name buys nothing in an inbox.
 */
export const LINK_PARAM = 'k';

/** What a link that just landed on this device is asking for. */
export interface Arrival {
  /** The path to land on: ours, absolute-from-root, already proven to be a route. */
  destination: string;
  /** The signed token, for the gateway to redeem — or null on a plain bookmark of the address. */
  token: string | null;
}

/** A storage this module will talk to. The real one, a fake in a test, or nothing at all. */
export interface ArrivalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sessionStore(): ArrivalStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // a browser with site data switched off throws on the property itself
  }
}

/**
 * Parse an address, relative or absolute, against our own origin.
 *
 * The base matters: `new URL('/course/…')` throws without one, and parsing an ABSOLUTE link from
 * somewhere else against our origin is exactly what keeps a destination ours — only the path
 * survives, whatever host the link claimed.
 */
function parse(href: string): URL | null {
  try {
    const base = typeof location === 'undefined' ? 'https://heywobo.com' : location.origin;
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** Is this a path of ours that the router will actually answer? */
function isOurs(path: string): boolean {
  // A single leading slash: `//host/x` is a protocol-relative URL, not a path, and `location`
  // would follow it off our origin.
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  return pathToRoute(path) !== null;
}

/**
 * What this address is asking for, or null when it is not a destination worth holding: the front
 * door, a page that is not ours, or a link that was cut short on its way through an inbox.
 */
export function arrivalFrom(href: string): Arrival | null {
  const url = parse(href);
  if (!url) return null;
  const destination = url.pathname;
  // `/` carries no intention (the router says so on every boot) — there is nothing to come back to.
  if (destination === '/' || !isOurs(destination)) return null;
  return { destination, token: url.searchParams.get(LINK_PARAM) || null };
}

/**
 * The same address without the token: what belongs in the bar once the token has been read.
 * Everything else about the address is kept — another parameter, the hash, the path — because the
 * only thing wrong with the address is that it carries a credential.
 */
export function withoutToken(href: string): string {
  const url = parse(href);
  if (!url) return href;
  url.searchParams.delete(LINK_PARAM);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}

/**
 * Hold a destination for the far side of the door. Returns whether it was held, so a caller can
 * tell a destination that will be honoured from one that silently will not.
 */
export function rememberArrival(
  destination: string,
  store: ArrivalStore | null = sessionStore(),
): boolean {
  if (!store || !isOurs(destination)) return false;
  try {
    store.setItem(ARRIVAL_KEY, destination);
    return true;
  } catch {
    return false; // storage unavailable: the learner lands home and walks, which is honest
  }
}

/**
 * The destination the door was walked through for, read ONCE and then gone. A second boot must not
 * drag a learner back into a card they already left.
 */
export function takeArrival(store: ArrivalStore | null = sessionStore()): string | null {
  if (!store) return null;
  try {
    const held = store.getItem(ARRIVAL_KEY);
    if (held) store.removeItem(ARRIVAL_KEY);
    // Re-checked on the way out, not only on the way in: the value came from storage, which a
    // second tab or an older build of this app could have written.
    return held && isOurs(held) ? held : null;
  } catch {
    return null;
  }
}

// --- telling the gateway the link was pressed -----------------------------------------------------

/** The gateway route that reads a pressed link (`hospitality/api.py`). */
export const LAND_PATH = '/v1/mail/land';

/** What the gateway said about a pressed link. */
export interface Landing {
  /** Where to land, as the signature says — not as the address bar says. */
  destination: string;
  /** Whether THIS press may open the door for the learner it was minted for. Once per link. */
  signIn: boolean;
}

export interface LandingDeps {
  gatewayUrl?: string | undefined;
  fetcher?: typeof fetch;
}

/**
 * Hand a pressed link's token to the gateway and get back what it says.
 *
 * Never throws and never guesses: with no gateway, no token, or an answer we cannot read, the
 * answer is null and the app lands on the address it already has. The one thing this call is FOR
 * is the half of the link that is a credential — redeeming it is what spends it, so a forwarded
 * mail cannot offer the same sign-in to the next reader.
 */
export async function redeemMailLink(
  token: string | null,
  deps: LandingDeps = {},
): Promise<Landing | null> {
  const base = (deps.gatewayUrl ?? import.meta.env?.VITE_GATEWAY_URL ?? '').replace(/\/$/, '');
  if (!base || !token) return null;
  const fetcher = deps.fetcher ?? fetch;
  try {
    const res = await fetcher(`${base}${LAND_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    const answer = (await res.json().catch(() => null)) as {
      destination?: unknown;
      sign_in?: unknown;
    } | null;
    const destination = answer?.destination;
    // Checked here too, not only at the gateway: what comes back over a wire is decided by this
    // app before it is handed to the router or to `location`.
    if (typeof destination !== 'string' || !isOurs(destination)) return null;
    return { destination, signIn: answer?.sign_in === true };
  } catch {
    return null;
  }
}
