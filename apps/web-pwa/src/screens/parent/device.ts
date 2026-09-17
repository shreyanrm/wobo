/**
 * What the parent side keeps on a phone: two small facts, and nothing about any child.
 *
 * THE DOOR THAT WAS PRESSED (`INTENT_KEY`). A Google sign-in leaves the page and comes back in a new
 * document, so "this person pressed the parent's door" has to be written down before anyone is
 * signed in. That makes it device-level (store/scope.ts DEVICE_KEYS), and three rules keep it
 * honest: it is sessionStorage, so it dies with the tab; it carries its own moment and goes stale
 * after `INTENT_TTL_MS`, so a press that was abandoned cannot turn a later sign-in into a parent
 * account; and it is taken exactly once. The server is the real guard (an account holding learner
 * data can never become a parent's, migration 0019), and this is only what keeps a student who
 * typed /parent from being asked.
 *
 * WHICH KIND THIS ACCOUNT IS (`KIND_KEY`). Keyed to the account through `scoped`, like every other
 * thing about a person, so a sibling on the same phone never inherits it and sign-out sweeps it.
 * The boot reads it before the runtime exists (shell/public-routes.ts, App.tsx) so a parent's bare
 * `/` opens the parent's home rather than the learner's front door. It is a cache of the server's
 * answer and nothing more: every visit asks the server again.
 *
 * THE SELECTED CHILD IS NOT HERE. The server holds the selection (parent.selections), and the
 * device keeps nothing keyed to a child, so there is nothing to leak from one child to the next.
 */

import { scoped } from '../../store/scope';

export const INTENT_KEY = 'wobo-parent-door-v1';
export const KIND_KEY = 'wobo-account-kind-v1';

/** How long a press of the parent's door stays good: a Google round trip, with room to spare. */
export const INTENT_TTL_MS = 15 * 60 * 1000;

const MARK = 'parent-door:';

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function session(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The parent's door was pressed. Written just before the round trip leaves the page. */
export function pressParentDoor(store: Store | null = session(), now: number = Date.now()): void {
  try {
    store?.setItem(INTENT_KEY, `${MARK}${now}`);
  } catch {
    // storage refused: the far side asks the server, finds no parent account, and shows the door
  }
}

/** Was the parent's door pressed, recently, on this tab? Read once, then gone either way. */
export function takeParentIntent(
  store: Store | null = session(),
  now: number = Date.now(),
): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(INTENT_KEY);
    if (raw === null) return false;
    store.removeItem(INTENT_KEY);
    if (!raw.startsWith(MARK)) return false;
    const at = Number(raw.slice(MARK.length));
    return Number.isFinite(at) && at <= now && now - at <= INTENT_TTL_MS;
  } catch {
    return false;
  }
}

/** This account is a parent's, as the server just said; or it is not, and the mark goes. */
export function markKind(store: Store = scoped, parent: boolean = true): void {
  try {
    if (parent) store.setItem(KIND_KEY, 'parent');
    else store.removeItem(KIND_KEY);
  } catch {
    // a cache: the next visit asks the server again
  }
}

/** Did the server last say the account on this device is a parent's? */
export function isParentDevice(store: Pick<Store, 'getItem'> = scoped): boolean {
  try {
    return store.getItem(KIND_KEY) === 'parent';
  } catch {
    return false;
  }
}
