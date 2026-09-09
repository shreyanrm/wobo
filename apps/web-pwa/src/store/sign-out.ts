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
import { forgetScope } from './scope';

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
export type SettleSdk = Pick<Sdk, 'sync'> & {
  state: Pick<Sdk['state'], 'flush'>;
  mastery: Pick<Sdk['mastery'], 'flush'>;
};

export async function settleBeforeSignOut(sdk: SettleSdk): Promise<SignOutVerdict> {
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

/** The least of the account layer a hand-over needs. */
export interface SignOutAccount {
  subjectId(): string | null;
  signOut(): Promise<void>;
}

export interface HandOverParts {
  sdk: SettleSdk;
  account: SignOutAccount;
  /** Where the device lands afterwards. Injected so a test needs no browser. */
  leave?: (url: string) => void;
}

/**
 * THE WHOLE HAND-OVER, IN ONE PLACE: settle what is owed, sweep this learner's keys off the
 * device, end the session, and land on the front door for whoever comes next.
 *
 * It lives here rather than inside a screen because there is now more than one way to reach it,
 * and there had to be. Sign-out existed only as a row in the ⌘K palette, and the palette has no
 * touch trigger — its own docblock says the OPEN_PALETTE_EVENT exists because "on a phone and in
 * the installed PWA there is no ⌘K", and nothing in the app ever dispatched it. So on a phone
 * there was NO way to sign out at all, which is exactly the family-tablet hand-over `forgetScope`
 * and `docs/ONE-LEARNER-ONE-WOBO.md` exist for: a sibling could not be given the device without
 * inheriting the last learner's Wobo.
 *
 * Returns the refusal line when the device still owes the account something, in which case
 * nothing is swept and nobody is signed out; null when the hand-over went through.
 */
export async function handOverDevice({
  sdk,
  account,
  leave,
}: HandOverParts): Promise<string | null> {
  const verdict = await settleBeforeSignOut(sdk);
  if (verdict.line) return verdict.line;
  const subject = account.subjectId();
  if (subject) forgetScope(subject);
  // The session ends whether or not the server can be told: the local sweep already happened, and
  // a device the learner has walked away from must not stay signed in waiting for a network.
  await account.signOut().catch(() => undefined);
  const go = leave ?? ((url: string) => window.location.assign(url));
  go('/');
  return null;
}
