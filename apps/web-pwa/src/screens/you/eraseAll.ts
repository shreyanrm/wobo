/**
 * "Erase and start over", as a sequence that can be PROVED rather than hoped for.
 *
 * The panel on the You screen promises three things in one breath: this device, the account on our
 * servers, and that it cannot be undone. Three doors have to open for that to be true, and only one
 * of them is on this phone:
 *
 *   1. the brain (`POST /v1/me/erase`) — the memory, the mail preferences, the parent link;
 *   2. the account's own rows (the SDK's `eraseRemoteData`) — state, threads, profile cache;
 *   3. the device (`wipeDevice`) — every `wobo-` key in both stores.
 *
 * TWO RULES, AND THE BUG THEY CLOSE.
 *
 *  · THE DEVICE IS EMPTIED WHATEVER THE NETWORK DID. An offline erase still empties this phone;
 *    a learner who asked to be forgotten does not stay on the screen holding their own name.
 *  · WHAT DID NOT LAND IS STILL OWED, AND THE RETRY MARKER SURVIVES THE WIPE. This is the whole
 *    reason this file exists. The screen used to chain the two network calls, ignore both answers
 *    and wipe regardless, so a refused or unreachable erase was dropped on the floor: the marker
 *    (`wobo-brain-erase-v1`) was never written, and `wipeDevice` removes every key starting with
 *    `wobo-`, so writing it BEFORE the wipe would have destroyed it anyway. The queue is therefore
 *    written AFTER the device is emptied, which is the only order in which the next boot can find
 *    it and `drainBrainErase` can finish the job.
 *
 * No React here on purpose: the order is the promise, and the order is testable.
 */

/** What the brain's own erase answered (`store/mind.ts`). */
export type BrainErase = 'erased' | 'local' | 'pending';

/** What the account's erase answered (`packages/sdk`, `ErasureResult`). */
export interface AccountErase {
  erased: string[];
  failed: string[];
}

export interface EraseDoors {
  /** The gateway's erase. Never throws in practice; a throw is read as owed. */
  eraseBrain: () => Promise<BrainErase>;
  /** The account's rows, or null where this build has no account layer at all. */
  eraseAccount: (() => Promise<AccountErase>) | null;
  /** Every `wobo-` key on this device, both stores. */
  wipeDevice: () => void;
  /** Remember that the brain still has to be told. Called only AFTER the wipe. */
  queueRetry: () => void;
  /** Start over on a clean device. */
  reload: () => void;
}

export interface EraseOutcome {
  /** True when something upstream still holds this learner, so the retry is queued. */
  owed: boolean;
  brain: BrainErase;
  /** The tables the account's erase could not take, in its own words. */
  accountFailed: readonly string[];
}

/**
 * Erase everything, in the one order that keeps the promise. Resolves to what actually happened,
 * so a caller can say the true thing; it never throws.
 */
export async function eraseEverything(doors: EraseDoors): Promise<EraseOutcome> {
  let brain: BrainErase = 'pending';
  try {
    brain = await doors.eraseBrain();
  } catch {
    brain = 'pending';
  }
  let accountFailed: readonly string[] = [];
  if (doors.eraseAccount) {
    try {
      const result = await doors.eraseAccount();
      accountFailed = result.failed ?? [];
    } catch {
      // A thrown erase is a table we cannot name and certainly did not empty.
      accountFailed = ['account'];
    }
  }
  const owed = brain === 'pending' || accountFailed.length > 0;
  doors.wipeDevice();
  // AFTER the wipe, never before: `wipeDevice` takes every `wobo-` key, and the marker is one.
  if (owed) doors.queueRetry();
  doors.reload();
  return { owed, brain, accountFailed };
}
