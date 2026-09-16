/**
 * THE CAMPAIGN A VISITOR ARRIVED BY, carried to the sign-up and no further (docs/GROWTH-DESK.md §4.4).
 *
 * Every link the growth desk posts carries one `utm_id` of the shape `channel-yyyymm-slug-nn`. It
 * names a piece of ours, never a person. This file does three things with it and nothing else:
 *
 *  1. **Read it once, at boot, and take it out of the bar.** The address a person copies and shares
 *     onward should be the page, not the page plus our bookkeeping, and the canonical address is the
 *     one without it.
 *  2. **Hold it on this device for a while.** A parent reads a post on the bus and signs a child up
 *     that evening. Held for {@link CAMPAIGN_DAYS} days, and the FIRST one kept: a second link
 *     followed in that window does not overwrite the piece that brought them.
 *  3. **Hand it to the gateway once, right after sign-up, and forget it.** `POST /v1/growth/arrival`
 *     writes it on the new account if the account is new and has none, and the gateway decides
 *     that, not this bundle. Whatever it answers, the id is gone from the device: the law's "the
 *     cookie dies there".
 *
 * Device-level on purpose (store/scope.ts DEVICE_KEYS): it is written before there is a subject.
 * No third party ever sees it, nothing is sent until sign-up, and nothing identifies the visitor.
 */

import { gatewayFetch } from '@wobo/sdk';

export const CAMPAIGN_KEY = 'wobo-campaign-v1';
export const CAMPAIGN_PARAM = 'utm_id';
export const CAMPAIGN_DAYS = 30;
export const ARRIVAL_PATH = '/v1/growth/arrival';

/** The gateway's own grammar (`growth/campaigns.py` PATTERN), anchored, with its length cap. */
export const CAMPAIGN_PATTERN = /^[a-z][a-z-]{0,23}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*-\d{2}$/;
const MAX_LENGTH = 96;

type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function localStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function isCampaign(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_LENGTH && CAMPAIGN_PATTERN.test(value);
}

/** The first `utm_id` on an address, when it is one of ours. */
export function campaignFrom(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const value = url.searchParams.get(CAMPAIGN_PARAM);
  return isCampaign(value) ? value : null;
}

/** The same address without the campaign, and without a `?` left dangling. */
export function withoutCampaign(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(CAMPAIGN_PARAM)) return href;
    url.searchParams.delete(CAMPAIGN_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}

interface Held {
  readonly id: string;
  readonly at: number;
}

function readHeld(store: Store): Held | null {
  try {
    const raw = store.getItem(CAMPAIGN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Held>;
    if (!isCampaign(parsed.id) || typeof parsed.at !== 'number') return null;
    return { id: parsed.id, at: parsed.at };
  } catch {
    return null;
  }
}

function fresh(held: Held | null, now: number): held is Held {
  return held !== null && now - held.at >= 0 && now - held.at <= CAMPAIGN_DAYS * 86_400_000;
}

/** Keep the campaign on this address, unless a fresh one is already kept. Returns what is kept. */
export function rememberCampaign(
  href: string,
  store: Store | null = localStore(),
  now: number = Date.now(),
): string | null {
  if (!store) return null;
  const held = readHeld(store);
  if (fresh(held, now)) return held.id;
  const id = campaignFrom(href);
  try {
    if (id) store.setItem(CAMPAIGN_KEY, JSON.stringify({ id, at: now }));
    else if (held) store.removeItem(CAMPAIGN_KEY);
  } catch {
    // storage refused: the visit is simply not attributed
  }
  return id;
}

/** The kept campaign, taken ONCE: it is gone from the device whatever happens next. */
export function takeCampaign(
  store: Store | null = localStore(),
  now: number = Date.now(),
): string | null {
  if (!store) return null;
  const held = readHeld(store);
  try {
    store.removeItem(CAMPAIGN_KEY);
  } catch {
    // nothing to do
  }
  return fresh(held, now) ? held.id : null;
}

/** Is a fresh campaign waiting? A read only: nothing is taken. */
export function hasCampaign(store: Store | null = localStore(), now: number = Date.now()): boolean {
  return store ? fresh(readHeld(store), now) : false;
}

/** At boot: remember the campaign and correct the bar. One `replaceState`, no reload. */
export function captureCampaign(): void {
  if (typeof window === 'undefined') return;
  const href = window.location.href;
  if (!campaignFrom(href) && !href.includes(`${CAMPAIGN_PARAM}=`)) return;
  rememberCampaign(href);
  const clean = withoutCampaign(href);
  if (clean !== href) {
    try {
      window.history.replaceState(window.history.state, '', clean);
    } catch {
      // a sandboxed frame: the address keeps its tag, which costs nothing
    }
  }
}

/**
 * After sign-up: hand the campaign to the gateway, once. Resolves to whether it was written, and
 * never throws; attribution is worth strictly less than the learner's first minute.
 */
export async function sendCampaign(
  gatewayUrl: string,
  deps: { fetcher?: typeof gatewayFetch; store?: Store | null; now?: number } = {},
): Promise<boolean> {
  const id = takeCampaign(deps.store === undefined ? localStore() : deps.store, deps.now);
  if (!id || !gatewayUrl) return false;
  try {
    const res = await (deps.fetcher ?? gatewayFetch)(
      `${gatewayUrl.replace(/\/$/, '')}${ARRIVAL_PATH}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utm_id: id }),
      },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { written?: unknown };
    return body.written === true;
  } catch {
    return false;
  }
}
