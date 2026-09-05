'use client';

/**
 * ONE CALM LINE WHEN THE LEARNER'S WORK IS NOT LANDING.
 *
 * The boot loader's last word is "Your place is saved", and until now that was said whether or not
 * a single remote write had succeeded. A child could work for an hour against a database refusing
 * every push, be told the whole time that their place was safe, and lose it.
 *
 * This is the other half of `sync-health.ts`: the counter decides when a run of failures has gone
 * past weather, and this says so, once, in a sentence a child can read.
 *
 * What it is careful never to be:
 *   - a wall. It is a strip at the bottom of the screen. Nothing behind it is blocked, no lesson
 *     pauses, and it takes no focus. On a phone it sits ABOVE the tab bar, never over it, because
 *     covering the navigation for a whole offline session is a wall however calm the wording is.
 *   - a lie. When the device itself is refusing writes it says so, rather than repeating that the
 *     work is safe here while the write is being thrown away.
 *   - an alarm. No red, no icon, no status code, no "error", no stack trace. Rose is this palette's
 *     "needs care", used here as a hairline and nothing more (DESIGN.md §0).
 *   - a blame. Nothing in the wording suggests the learner did anything, or that their work is
 *     gone, because it is not gone: it is on this device and waiting.
 *   - a nag. It appears once a run crosses the threshold and vanishes the instant a write lands,
 *     with no dismissal to remember and no second appearance to earn.
 *
 * Offline is a different sentence, because it is a different fact and the learner already knows it.
 *
 * Trap 1 (DESIGN.md §0): every class here is namespaced `wst-`, greppable and used nowhere else.
 */

import type { SyncStatus } from '@wobo/sdk';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useConnectivity } from '../shell/resilience';
import { deviceRefusingWrites, onWriteTroubleChange } from './scope';
import { useSdk } from './sdk';
import './SaveTrouble.css';

/** What the strip says. Exported so the copy is testable without a DOM. */
export const SAVE_TROUBLE_COPY = {
  offline:
    'Your work is safe on this device. I will put it in your account the moment you are back online.',
  online:
    'Your work is safe on this device, but I have not been able to put it in your account yet. Nothing is lost.',
  /*
   * THE SENTENCE THAT HAS TO BE DIFFERENT.
   *
   * Both lines above say the work is safe HERE, and on a device with no room left neither half of
   * that is true: `scoped.setItem` catches the quota refusal, the value is thrown away, and the
   * read back is empty. Telling a child their work is safe at the moment it is being discarded is
   * the failure this whole strip was built to prevent, so when the device itself is refusing
   * writes the strip says so plainly, and says the one thing that is actually at stake.
   */
  device:
    'I have not been able to put your work in your account, and this device is not letting me keep it either. Nothing here is blocked, but this piece may not be waiting for you next time.',
  retry: 'try again',
  retrying: 'trying…',
} as const;

/** The line for a given moment. Pure, so the wording is checked without rendering anything. */
export function saveTroubleLine(offline: boolean, deviceFull = false): string {
  if (deviceFull) return SAVE_TROUBLE_COPY.device;
  return offline ? SAVE_TROUBLE_COPY.offline : SAVE_TROUBLE_COPY.online;
}

/**
 * The live answer to "is the learner's work landing". Subscribed rather than polled: the counter
 * only announces when the answer actually changes, and it hands back the same object while it has
 * not, which is what `useSyncExternalStore` needs to avoid looping.
 */
export function useSyncStatus(): SyncStatus {
  const sdk = useSdk();
  const subscribe = useCallback((fn: () => void) => sdk.sync.subscribe(fn), [sdk]);
  const read = useCallback(() => sdk.sync.status(), [sdk]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Is this device throwing away what the learner does, right now? */
export function useDeviceRefusingWrites(): boolean {
  const subscribe = useCallback((fn: () => void) => onWriteTroubleChange(fn), []);
  return useSyncExternalStore(subscribe, deviceRefusingWrites, () => false);
}

export function SaveTrouble() {
  const sdk = useSdk();
  const status = useSyncStatus();
  const { offline } = useConnectivity();
  const deviceFull = useDeviceRefusingWrites();
  const bar = useRef<HTMLDivElement>(null);
  const showing = status.troubled || deviceFull;

  /*
   * The strip's own height, published to the page.
   *
   * On a phone the navigation is a fixed bottom bar, and anything else fixed to the bottom covers
   * it: a learner with a troubled save lost every way of moving between screens, for the whole
   * offline session. The strip now sits ABOVE the rail (SaveTrouble.css), and everything else that
   * lives at the bottom of a phone screen — the flag control, the page's own bottom padding — is
   * moved up by exactly this measurement rather than by a guess.
   */
  useEffect(() => {
    const root = document.documentElement;
    const node = bar.current;
    if (!showing || !node) {
      root.style.setProperty('--wst-height', '0px');
      return;
    }
    const publish = () => root.style.setProperty('--wst-height', `${node.offsetHeight}px`);
    publish();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => publish());
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      root.style.setProperty('--wst-height', '0px');
    };
  }, [showing]);

  if (!showing) return null;
  return (
    <div className="wst-bar" role="status" aria-live="polite" ref={bar}>
      <p className="wst-line">{saveTroubleLine(offline, deviceFull)}</p>
      <button
        type="button"
        className="wst-again"
        onClick={() => void sdk.sync.retry()}
        disabled={status.retrying}
      >
        {status.retrying ? SAVE_TROUBLE_COPY.retrying : SAVE_TROUBLE_COPY.retry}
      </button>
    </div>
  );
}
