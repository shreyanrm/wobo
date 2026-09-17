/**
 * A parent signing out: the same hand-over a learner's sign-out is (store/sign-out.ts), minus the
 * settling, because a parent account owes the device nothing.
 *
 * `forgetScope` takes every key held for this account (the kind marker among them) and the wobo
 * Caches, and puts the device back to nobody's. The session ends whether or not the server can be
 * told. Then a FULL navigation to the front door, so nothing held in memory about any child, and no
 * selection, outlives the person who walked away.
 */

import { forgetScope } from '../../store/scope';

export interface ParentSignOut {
  account: { subjectId(): string | null; signOut(): Promise<void> } | null | undefined;
  /** Where the device lands. Injected so a test needs no browser. */
  leave?: (url: string) => void;
}

export async function signOutParent({ account, leave }: ParentSignOut): Promise<void> {
  const subject = account?.subjectId() ?? null;
  if (subject) forgetScope(subject);
  await account?.signOut().catch(() => undefined);
  const go = leave ?? ((url: string) => window.location.assign(url));
  go('/');
}
