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
  // How the climb looks to this learner — Quest or Focused (ui/viewPref.ts). Two learners on one
  // tablet do not share a taste, and the switch is theirs, not the device's.
  'wobo-vibe-v1',
  /*
   * THE ELEVEN THAT WERE NOT HERE.
   *
   * `forgetScope` finds a learner's keys by their `:<subject>` suffix, which is drift-proof for a
   * key that HAS one and structurally blind to a key that does not. Every store below wrote
   * through raw `localStorage`, so none of them carried a suffix, so none of them was ever swept:
   * learner A signed out and learner B read A's course stars back on the next screen. Proved in
   * `scope.test.ts`. They are the learner's own work and they leave with the learner.
   */
  'wobo-course-pos-v1', // where they are in each course
  'wobo-course-stars-v1', // what each course was worth when they first finished it
  'wobo-fsrs-v1', // the spaced-repetition model of this learner's memory
  'wobo-forged-v1', // the workbooks they built
  'wobo-downloads-v1', // what they asked to be generated
  'wobo-daily-quest-v1', // whether today's bonus was already claimed
  'wobo-activity-v1', // the days they showed up
  'wobo-activity-counts-v1', // how much they did on each of them
  'wobo-trophies-celebrated-v1', // which ceremonies they have already had
  'wobo-proactivity-v1', // how much Wobo speaks up, which is their dial and not the device's
  // The photos a learner took of their doubts, with what Wobo read on them, and the deletes still
  // owed to the server for the ones they removed (screens/doubt/doubt-store.ts). A photo of a
  // page can carry a face or a name; it is the learner's own and leaves with them.
  'wobo-doubts-v1',
  'wobo-doubts-erase-v1',
] as const;

/**
 * Keys whose full name is only known at runtime — one per topic, one per whatever — matched by
 * their start instead of by their whole name. A scoped write already lands under `::<subject>`;
 * this is only how an already-installed device's unscoped copy is carried across.
 */
export const SCOPED_PREFIXES = ['wobo-forge-pool-v1:'] as const;

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

const scopeListeners = new Set<() => void>();

/**
 * Told whenever this device changes which learner it is keyed to.
 *
 * A store that reads storage ONCE — at boot, before the session is resolved — has cached a value
 * from the wrong learner's keys, and nothing else would ever tell it. `ui/viewPref.ts` is the
 * first: the vibe has to be on the document root before the first paint, which is earlier than
 * anyone knows whose device this is, so it re-reads here. Returns the unsubscribe.
 */
export function onScopeChange(fn: () => void): () => void {
  scopeListeners.add(fn);
  return () => {
    scopeListeners.delete(fn);
  };
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

/*
 * WHETHER THE DEVICE IS TAKING WRITES AT ALL.
 *
 * A swallowed `QuotaExceededError` is the quietest way to lose a child's work. `sync-health.ts`
 * counts REMOTE failures, so on a full device the save-trouble strip said "Your work is safe on
 * this device" while the write it is talking about had just been thrown away — the exact failure
 * the strip exists to prevent, told as a reassurance. So a refused local write is recorded here,
 * where the refusal actually happens, and `SaveTrouble.tsx` says a different and true sentence.
 *
 * It is a level, not a counter: one refusal means the device is full or locked right now, and one
 * write landing means it is not any more.
 */
let deviceRefused = false;
const writeListeners = new Set<() => void>();

/** True when the last write to this device was thrown away rather than stored. */
export function deviceRefusingWrites(): boolean {
  return deviceRefused;
}

/** Told when that answer changes. Returns the unsubscribe. */
export function onWriteTroubleChange(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => {
    writeListeners.delete(fn);
  };
}

function noteWrite(landed: boolean): void {
  if (deviceRefused === !landed) return;
  deviceRefused = !landed;
  for (const l of writeListeners) l();
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
  /** Did it land? A refused write is recorded, never silently discarded. */
  setItem(base: string, value: string): boolean {
    const store = raw();
    // No storage object at all is a server render or a keyless build, not a device refusing a
    // learner's work. Only an actual throw from an actual store is trouble worth a sentence.
    if (!store) return false;
    try {
      store.setItem(scopedKey(base), value);
    } catch {
      noteWrite(false); // quota or private mode — the value lives for this session only
      return false;
    }
    noteWrite(true);
    return true;
  },
  removeItem(base: string): void {
    try {
      raw()?.removeItem(scopedKey(base));
    } catch {
      // nothing to do
    }
  },
};

/**
 * Move a key under the new scope. The source ALWAYS leaves, and that is the whole point.
 *
 * Every boot writes unscoped for the moment before the session resolves, so the plain key comes
 * back after the scoped one already exists. Giving up in that case (as this used to) left one
 * learner's conversation, mind and profile sitting under the plain key, where the next person to
 * open the browser reads it as their own, because before THEIR session lands they are unscoped too.
 * A destination that already exists is the newer truth (`legacy-keys.ts` settles the same tie the
 * same way), so the source is dropped rather than merged. Either way it does not stay on the device.
 */
function move(from: string, to: string): void {
  const store = raw();
  if (!store || from === to) return;
  try {
    const value = store.getItem(from);
    if (value === null) return; // nothing to move
    if (store.getItem(to) === null) store.setItem(to, value);
    store.removeItem(from);
  } catch {
    // storage unavailable — the learner simply starts fresh under the new scope
  }
}

/** The same move, for the keys whose names are made at runtime. */
function moveByPrefix(prefix: string, subject: string): void {
  const store = raw();
  if (!store) return;
  const found: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      // `::` means it is already somebody's, and moving it would be taking it off them.
      if (key?.startsWith(prefix) && !key.includes('::')) found.push(key);
    }
  } catch {
    return; // storage refused enumeration — the learner simply starts fresh under the new scope
  }
  for (const key of found) move(key, `${key}::${subject}`);
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
  if (scope) {
    for (const key of SCOPED_KEYS) move(key, `${key}::${scope}`);
    for (const prefix of SCOPED_PREFIXES) moveByPrefix(prefix, scope);
  }
  try {
    if (scope) raw()?.setItem(SCOPE_KEY, JSON.stringify({ subject: scope, anonymous }));
    else raw()?.removeItem(SCOPE_KEY);
  } catch {
    // remembering the scope is a convenience; an upgrade just inherits nothing
  }
  // Last, once the keys have moved and the scope is live, so a listener that re-reads sees the
  // learner it was told about rather than the one it is replacing.
  for (const l of scopeListeners) l();
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
  if (from !== to) {
    for (const key of SCOPED_KEYS) move(`${key}::${from}`, `${key}::${to}`);
    const store = raw();
    const suffix = `::${from}`;
    const carried: string[] = [];
    try {
      for (let i = 0; i < (store?.length ?? 0); i += 1) {
        const key = store?.key(i);
        if (key?.endsWith(suffix) && SCOPED_PREFIXES.some((p) => key.startsWith(p))) {
          carried.push(key);
        }
      }
    } catch {
      // storage refused enumeration — the named list above is still moved
    }
    for (const key of carried) move(key, `${key.slice(0, -suffix.length)}::${to}`);
  }
  applyScope(to, anonymous);
}

/**
 * Sign-out: this learner's personal keys leave the device. Their progress lives in their account;
 * what stays here would only be readable by whoever picks the phone up next.
 */
export function forgetScope(subjectId: string): void {
  const store = raw();
  if (!store) return;
  const subject = subjectId.trim();
  if (!subject) return;
  /*
   * Every key this device holds for THIS learner, found by their id rather than by a list.
   *
   * There are two scoping shapes in the product: the app's stores suffix `::<subject>` (this
   * module), and the SDK's own caches suffix `:<subject>` (progress, the whole transcript, the
   * mastery evidence — `packages/sdk/src/state.ts` and `mastery.ts`). Walking only this module's
   * SCOPED_KEYS list left the SDK half on the device, which on a family tablet is the learner's
   * XP, streak, mind snapshot and every word they said to Wobo, still sitting there after they
   * signed out.
   *
   * Matching on the suffix rather than importing the SDK's key names is deliberate twice over. It
   * cannot drift when a new cache is added, and it keeps this module dependency-free: it is
   * imported by `ui/viewPref.ts`, which runs before the first paint, so an import of `@wobo/sdk`
   * here would put the whole client (identity, the database adapter, the event backbone) into the
   * entry chunk that a visitor reading the landing page downloads. `store/app-sdk.ts` says why
   * that must not happen.
   *
   * `::<subject>` ends with `:<subject>`, so one suffix covers both shapes, and an exact suffix on
   * a subject id can only ever be that learner's own key.
   */
  const suffix = `:${subject}`;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.endsWith(suffix)) doomed.push(key);
    }
  } catch {
    // storage refused enumeration — the named list below is still attempted
  }
  for (const key of [...doomed, ...SCOPED_KEYS.map((base) => `${base}::${subject}`)]) {
    try {
      store.removeItem(key);
    } catch {
      // best effort
    }
  }
  applyScope(null);
}
