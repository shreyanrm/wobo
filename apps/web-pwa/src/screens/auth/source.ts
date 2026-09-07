/**
 * HOW somebody signed in, written down for the boot that follows.
 *
 * The first authenticated boot after a sign-in records `identity.subject.created.v1` with its
 * source (AppRuntime reads this key once and clears it). Onboarding's own copy of the sign-in wrote
 * it and the doors did not, so a learner who came in through the door was recorded as nobody in
 * particular. The doors write it now, from one place, in the two words the reader understands.
 */

import type { MethodName } from './client';

/** The same key `App.tsx` reads. Kept as a literal here so the doors do not import the root. */
export const SIGNIN_SOURCE_KEY = 'wobo-signin-source-v1';

export type SignInSource = 'google' | 'apple' | 'phone' | 'email';

/**
 * The word the boot after this one will read for a method. Each provider is written as itself:
 * Apple used to be written down as Google, which never fired while Apple was a `soon` chip and
 * would have mis-recorded every Apple sign-in the day it was wired.
 */
export function signInSourceOf(method: MethodName): SignInSource {
  switch (method) {
    case 'google':
      return 'google';
    case 'apple':
      return 'apple';
    case 'phone':
      return 'phone';
    case 'password':
    case 'magicLink':
      return 'email';
  }
}

/**
 * The word the last door wrote, read ONCE by the first authenticated boot after it and then
 * cleared. Device-level on purpose (store/scope.ts DEVICE_KEYS): it is written before there is a
 * subject to key it to, and it means nothing after the boot that reads it.
 */
export function takeSignInSource(
  store: {
    getItem(key: string): string | null;
    removeItem(key: string): void;
  } | null = typeof localStorage === 'undefined' ? null : localStorage,
): string | null {
  if (!store) return null;
  try {
    const source = store.getItem(SIGNIN_SOURCE_KEY);
    if (source) store.removeItem(SIGNIN_SOURCE_KEY);
    return source || null;
  } catch {
    return null;
  }
}

export function rememberSignInSource(
  method: MethodName,
  store: { setItem(key: string, value: string): void } | null = typeof localStorage === 'undefined'
    ? null
    : localStorage,
): void {
  if (!store) return;
  try {
    store.setItem(SIGNIN_SOURCE_KEY, signInSourceOf(method));
  } catch {
    // storage unavailable: the boot after this one records an unattributed subject
  }
}
