/**
 * SIGN-OUT ASKS FIRST (docs/MEMORY-LAW.md rule 4: a failed write is never silent).
 *
 * Sign-out sweeps everything of the learner's off the device (`store/scope.ts` forgetScope), and
 * that is right: the record is in the account. It is only right once the account HAS it. With the
 * network gone, a learner who signed out used to lose the fact they had just remembered, the line
 * they had just sent and the XP they had just earned, silently, because the queue and the caches
 * were swept with nothing pushed (seen in a browser, 2026-09-07).
 *
 * So the order is: push what is owed, then count what still is, and refuse in one plain line while
 * anything is. The count is in the learner's own units (a fact, a line, their progress), not in
 * queue entries.
 */

import type { Sdk, SyncStore } from '@wobo/sdk';
import { isOffline } from '../shell/resilience';
import { mindSyncStatus, syncMind } from './mind-sync';

/**
 * The stores whose debounced push the flush below owns. The others (the event outbox, the profile
 * row) re-arm their own timers after a failure and are counted here only once they are troubled.
 */
const FLUSHED: readonly SyncStore[] = ['progress', 'conversation', 'mastery'];

function things(n: number): string {
  return n === 1 ? 'One thing has' : `${n} things have`;
}

/** The lines. Exported so the words are held by a test and never rewritten beside the screen. */
export const SIGN_OUT_COPY = {
  owed: (n: number) =>
    `${things(n)} not reached your account yet. Stay online a moment and try again.`,
  offline: (n: number) =>
    `You're offline, and ${things(n).toLowerCase()} not reached your account yet. Sign out once you're back online.`,
} as const;

export interface SignOutVerdict {
  /** What is still on this device and nowhere else. Zero means the sweep is safe. */
  owed: number;
  /** The one line to show while `owed` is not zero, else null. */
  line: string | null;
}

/**
 * Push everything this device owes the account, then say whether anything is still owed. Never
 * throws: a push that fails is counted, not raised, and the caller reads the verdict.
 */
export async function settleBeforeSignOut(
  sdk: Pick<Sdk, 'sync'> & {
    state: Pick<Sdk['state'], 'flush'>;
    mastery: Pick<Sdk['mastery'], 'flush'>;
  },
): Promise<SignOutVerdict> {
  // The SDK's debounces (XP, the thread, the mastery evidence), then anything a past push left
  // behind, however few times it failed: "try again" has to carry it, or it is not true.
  await Promise.all([
    sdk.state.flush().catch(() => undefined),
    sdk.mastery.flush().catch(() => undefined),
  ]);
  await sdk.sync.retry(1);
  const failing = new Set<SyncStore>(sdk.sync.status().stores);
  for (const store of FLUSHED) if (sdk.sync.consecutiveFailures(store) > 0) failing.add(store);
  const stores = failing.size;
  // The mind's queue, drained now regardless of its back-off. Behind a closed wire (a keyless
  // build, or an anonymous learner with no account to owe) the queue is not owed to anyone, and
  // counting it would refuse every sign-out for good.
  await syncMind({ force: true });
  const mind = mindSyncStatus();
  const owed = stores + (mind.gate === 'ready' ? mind.waiting + mind.refused : 0);
  if (owed === 0) return { owed: 0, line: null };
  return { owed, line: isOffline() ? SIGN_OUT_COPY.offline(owed) : SIGN_OUT_COPY.owed(owed) };
}
