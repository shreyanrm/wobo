/**
 * THE DIAL. One switch decides whether the site invites a stranger in or invites them to the list.
 *
 * `docs/DOORS-CLOSED.md` §4: **a dial, not a deploy.** `doors_open` lives in `ops.settings`, the
 * gateway refuses account creation while it is false, and the web app reads the same value so the
 * copy and the door follow the switch within a minute and without a release. Refusing at the
 * gateway is what actually closes the door; what this module owns is only what a person sees.
 *
 * FOUR DECISIONS, each of which is the difference between a dial and a hazard:
 *
 *  · **Closed is the default and closed is every failure.** No gateway configured, a request that
 *    times out, a 500, a body in a shape nobody expected: all of them read as closed. A dial that
 *    opens because a network blinked would put "Start free" in front of a stranger while the
 *    gateway is still refusing, which is the exact first impression this whole wave exists to
 *    protect.
 *  · **Only the word yes opens it.** `{ "doors_open": true }` and nothing else. Not "true", not 1,
 *    not a present key.
 *  · **The poll starts itself.** Nothing has to be wired into a host for the door to follow the
 *    switch: the first component that reads the dial starts the reading, and the last one to stop
 *    reading stops it. There is no place to forget.
 *  · **The pre-render can seed it.** `scripts/prerender.ts` reads the dial once, in the build, and
 *    sets `window.__WOBO_DOORS_OPEN__` before the page boots, so all 438 files agree with each
 *    other and with the switch as it stood when they were written. A visitor's own browser then
 *    corrects them within the minute.
 *
 * This module is a LEAF on purpose: React and nothing else. Every public surface reaches for it,
 * including the ones that load before anything else on the page.
 */

import { useSyncExternalStore } from 'react';

/** The gateway's route for the switch. */
export const DIAL_PATH = '/v1/doors';

/** How often the browser re-asks. The law says the copy follows "within a minute". */
export const DIAL_EVERY_MS = 60_000;

/** What the build writes onto the page, so a pre-rendered file and the switch cannot disagree. */
export const DIAL_SEED = '__WOBO_DOORS_OPEN__';

/**
 * The state. Seeded from the build's own reading where there is one, and closed everywhere else,
 * which is every browser that loads the shell rather than a pre-rendered file.
 */
let open = (globalThis as Record<string, unknown>)[DIAL_SEED] === true;

const readers = new Set<() => void>();
let stop: (() => void) | null = null;

/** Whether new accounts are open, as the browser last understood it. */
export function doorsOpen(): boolean {
  return open;
}

/** Record a reading. Nothing repaints when the answer has not changed. */
export function setDoorsOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const reader of [...readers]) reader();
}

/** Hear about a change. Returns the way to stop hearing about it. */
export function subscribeDoors(reader: () => void): () => void {
  readers.add(reader);
  if (readers.size === 1 && !stop) stop = watchDial();
  return () => {
    readers.delete(reader);
    if (readers.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/**
 * Ask the gateway once. Never throws, and answers `false` for everything that is not a plain yes.
 */
export async function readDial(
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const base = (gatewayUrl ?? '').replace(/\/$/, '');
  if (!base) return false;
  try {
    const res = await fetchImpl(`${base}${DIAL_PATH}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { doors_open?: unknown } | null;
    return body?.doors_open === true;
  } catch {
    return false;
  }
}

export interface DialDeps {
  gatewayUrl?: string | undefined;
  fetchImpl?: typeof fetch;
  every?: number;
}

/**
 * Read the dial now, and again every minute, until the returned function is called.
 *
 * Called for you by the first reader (`subscribeDoors`). Exported so a test can drive it and so a
 * host that wants the reading to start before anything renders can start it itself.
 */
export function watchDial(deps: DialDeps = {}): () => void {
  const gatewayUrl = deps.gatewayUrl ?? import.meta.env?.VITE_GATEWAY_URL ?? '';
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!gatewayUrl || !fetchImpl) return () => {};
  let live = true;
  const ask = () => {
    void readDial(gatewayUrl, fetchImpl).then((answer) => {
      if (live) setDoorsOpen(answer);
    });
  };
  ask();
  const timer = setInterval(ask, deps.every ?? DIAL_EVERY_MS);
  return () => {
    live = false;
    clearInterval(timer);
  };
}

/**
 * The dial, for a screen. Every door on every public page reads it here, which is what makes the
 * copy follow the switch with no release.
 */
export function useDoorsOpen(): boolean {
  return useSyncExternalStore(subscribeDoors, doorsOpen, doorsOpen);
}
