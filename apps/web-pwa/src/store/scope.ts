/**
 * Per-learner storage scope.
 *
 * A device can carry more than one learner: a sibling signs in on the family tablet, a child hands
 * the phone back to a parent, an anonymous first session becomes a real account. Anything personal
 * — Wobo's whole transcript, the mind dossier, the face, the profile — is keyed by the subject who
 * owns it, so nothing of one learner is ever readable by the next. Signing out removes that
 * learner's keys from this device outright.
 *
 * The scope is set once at boot, BEFORE anything reads storage, and again whenever the session's
 * subject changes. Unscoped (no session yet) keeps the plain key so a keyless local build and every
 * already-installed device keep working; the first subject to claim the device inherits that data,
 * and everyone after starts clean.
 *
 * ponytail: localStorage with a suffixed key — no store rewrite, no migration script. The upgrade
 * path is the same keys under a per-subject IndexedDB database if a transcript ever outgrows quota.
 */

/** Everything that belongs to one learner and must never bleed between accounts. */
export const SCOPED_KEYS = [
  'wobo-archive-v1',
  'wobo-mind-v1',
  'wobo-avatar-v1',
  'wobo-learner-profile',
  'wobo-profile-photo-v1',
  // The boards Wobo and the learner drew together, kept as objects. They are the learner's work:
  // they carry across an anonymous-to-account upgrade, and they leave the device on sign-out.
  'wobo-board-notes-v1',
  // What the placement check established about the ground under each topic, including what the
  // learner claimed with "I know this". It decides which questions are never asked again, so it
  // must never outlive the learner it belongs to.
  'wobo-placement-v1',
  // What the re-teach ladder has already tried for each concept, and the misses standing against
  // it. The next explanation a learner is handed depends on it (wobo/reteach.ts).
  'wobo-reteach-v1',
] as const;

/** Where the last scope is remembered, so an upgrade (anonymous → account) can carry data across. */
const SCOPE_KEY = 'wobo-scope-v1';

/** The subject a device was last scoped to, and whether they were still anonymous. */
export interface RememberedScope {
  subject: string;
  anonymous: boolean;
}

let scope: string | null = null;

/** The subject everything personal is currently keyed to, or null before a session exists. */
export function currentScope(): string | null {
  return scope;
}

/** The storage key a base key actually lives under for the current learner. */
export function scopedKey(base: string): string {
  return scope ? `${base}::${scope}` : base;
}

function raw(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // private mode with storage denied — every read is a miss, every write a no-op
  }
}

/** localStorage, keyed to the learner. The only door the per-learner stores use. */
export const scoped = {
  getItem(base: string): string | null {
    try {
      return raw()?.getItem(scopedKey(base)) ?? null;
    } catch {
      return null;
    }
  },
  setItem(base: string, value: string): void {
    try {
      raw()?.setItem(scopedKey(base), value);
    } catch {
      // quota or private mode — the value lives for this session only
    }
  },
  removeItem(base: string): void {
    try {
      raw()?.removeItem(scopedKey(base));
    } catch {
      // nothing to do
    }
  },
};

function move(from: string, to: string): void {
  const store = raw();
  if (!store || from === to) return;
  try {
    const value = store.getItem(from);
    if (value === null || store.getItem(to) !== null) return; // nothing to move, or already there
    store.setItem(to, value);
    store.removeItem(from);
  } catch {
    // storage unavailable — the learner simply starts fresh under the new scope
  }
}

/**
 * Point every personal store at `subjectId`.
 *
 * The first subject this device ever sees claims whatever was written before there was a session
 * (an offline-first device, or a build that predates accounts) — the data moves under their key, so
 * the learner who was already here keeps their world and the next one starts empty.
 */
export function applyScope(subjectId: string | null, anonymous = false): void {
  scope = subjectId?.trim() ? subjectId.trim() : null;
  if (scope) for (const key of SCOPED_KEYS) move(key, `${key}::${scope}`);
  try {
    if (scope) raw()?.setItem(SCOPE_KEY, JSON.stringify({ subject: scope, anonymous }));
    else raw()?.removeItem(SCOPE_KEY);
  } catch {
    // remembering the scope is a convenience; an upgrade just inherits nothing
  }
}

/** The subject this device was last scoped to (across a sign-in redirect), or null. */
export function rememberedScope(): RememberedScope | null {
  try {
    const v = raw()?.getItem(SCOPE_KEY);
    if (!v?.trim()) return null;
    const parsed = JSON.parse(v) as Partial<RememberedScope>;
    return parsed.subject?.trim()
      ? { subject: parsed.subject, anonymous: parsed.anonymous === true }
      : null;
  } catch {
    return null;
  }
}

/**
 * The same person, a bigger identity: an anonymous learner signed in for real. Carry their work
 * across to the new subject before the app reads anything, so signing in never costs them the
 * conversation they just had.
 */
export function inheritScope(from: string, to: string, anonymous = false): void {
  if (from !== to) for (const key of SCOPED_KEYS) move(`${key}::${from}`, `${key}::${to}`);
  applyScope(to, anonymous);
}

/**
 * Sign-out: this learner's personal keys leave the device. Their progress lives in their account;
 * what stays here would only be readable by whoever picks the phone up next.
 */
export function forgetScope(subjectId: string): void {
  const store = raw();
  if (!store) return;
  for (const key of SCOPED_KEYS) {
    try {
      store.removeItem(`${key}::${subjectId}`);
    } catch {
      // best effort
    }
  }
  applyScope(null);
}
