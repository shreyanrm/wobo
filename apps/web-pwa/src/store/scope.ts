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
  'wobo-practice-v1', // where they are in the practice set, and their marks on it (screens/practice/run-store.ts)
  'wobo-course-stars-v1', // what each course was worth when they first finished it
  'wobo-fsrs-v1', // the spaced-repetition model of this learner's memory
  'wobo-forged-v1', // the workbooks they built
  'wobo-downloads-v1', // what they asked to be generated
  'wobo-activity-v1', // the days they showed up
  'wobo-activity-counts-v1', // how much they did on each of them
  'wobo-trophies-celebrated-v1', // which ceremonies they have already had
  // The arcade's own ledger (store/arcade.ts): which bonus levels they cleared, what the day
  // and the chapter have already paid, and which side doors stand open for them. It is one
  // learner's play and one learner's caps, so a sibling on the same tablet never inherits a
  // spent day, and it leaves with the learner.
  'wobo-arcade-v1',
  'wobo-proactivity-v1', // how much Wobo speaks up, which is their dial and not the device's
  // The photos a learner took of their doubts, with what Wobo read on them, and the deletes still
  // owed to the server for the ones they removed (screens/doubt/doubt-store.ts). A photo of a
  // page can carry a face or a name; it is the learner's own and leaves with them.
  'wobo-doubts-v1',
  'wobo-doubts-erase-v1',
  /*
   * THE ONES THAT DESCRIBED THE DEVICE BY MISTAKE (docs/ONE-LEARNER-ONE-WOBO.md, 2026-09-05).
   *
   * Each of these was read straight from localStorage under a plain name, so on a family tablet
   * the second child inherited it: they were never introduced to Wobo because "the device" had
   * already met them, they carried their sibling's parent link and referral, and a bare `/`
   * opened the app instead of the front door because "the device" had finished setup.
   */
  'wobo-onboarded-v1', // whether THIS learner finished setup; the boot sentinel App.tsx reads
  'wobo-onb-step-v1', // where their setup run is up to, if they left in the middle of it
  'wobo-first-turn-v1', // whether Wobo has introduced themself to THIS learner (one introduction, ever)
  'wobo-parent-link-v1', // the parent they linked by phone
  'wobo-referral-code-v1', // the code that rides in their invite links
  // Whether THIS account is a parent's, as the server last said (screens/parent/device.ts). A
  // sibling on the same phone is a student, and must never inherit "this device is a parent's".
  'wobo-account-kind-v1',
  'wobo-curriculum-world-v1', // which board and class they follow (curriculum/world.ts)
  'wobo-kept-boards-v1', // what they did on a board they moved off, by name (screens/you/kept.ts)
  'wobo-brain-erase-v1', // an erase the brain still has to be told about (store/mind.ts)
  // The mind's offline queue and what this device knows about the record (store/mind-queue.ts).
  // The queue is the learner's own unsaved words and counts: it moves with an anonymous learner
  // who signs in, so nothing they told Wobo on the train is lost, and it leaves on sign-out.
  'wobo-mind-queue-v1',
  'wobo-mind-sync-v1',
  /*
   * TWO THAT WERE ON THE DEVICE LIST BY MISTAKE (the fixer, 2026-09-07).
   *
   * The palette's recent doors are door ids, and a door id is `topic-<id>` or `chap-<id>`: the
   * previous learner's last-opened chapter showed under RECENT in the next learner's palette.
   * Read aloud rides every turn as the LEARNER's accessibility need (`store/mind.ts`
   * lifetimeSnapshot), so it is theirs, not the phone's; mute stays the phone's.
   */
  'wobo-cmdk-recent-v1',
  'wobo-voice',
  // Whether this learner has been offered the app on their home screen, and whether it is there
  // (shell/install.ts). The offer is made once per ACCOUNT rather than once per device: two
  // children on one tablet are two learners, and an offer one of them waved away is not an answer
  // the other gave. Whether the device is installed is read live from the display mode besides.
  'wobo-install-v1',
] as const;

/**
 * Keys whose full name is only known at runtime — one per topic, one per whatever — matched by
 * their start instead of by their whole name. A scoped write already lands under `::<subject>`;
 * this is only how an already-installed device's unscoped copy is carried across.
 */
export const SCOPED_PREFIXES = [
  'wobo-forge-pool-v1:',
  // The offline copy of the syllabus they are pinned to (curriculum/cache.ts): one row per unit
  // list, per chapter list, per overlay, plus the index of them.
  'wobo-curriculum-v1:',
  // The concept core beside each level (wobo/core-store.ts): the true sentence for every part the
  // level declares, and the handful of questions its misconceptions say a learner will ask.
  'wobo-core-v1:',
  // The lesson itself, kept so a course a learner has already opened plays with the network off
  // (screens/course/kept.ts): the composed cards, its workbook and boss, and the pictures its
  // cards hydrated. It is content somebody's allowance paid for, so it is one learner's and it
  // leaves with them (docs/CACHES.md).
  'wobo-lesson-v1:',
] as const;

/**
 * Per-learner keys that live in sessionStorage rather than localStorage: they reset with the tab
 * on purpose, and they are still one learner's, so they are keyed and swept the same way.
 */
export const SCOPED_SESSION_KEYS = [
  'wobo-sky-seen-v1', // which stars have already caught light for this learner this session
  // The suggestions this learner has waved away (suggest/session.ts). It resets with the tab on
  // purpose: "a suggestion declined is not offered again that session", and a session is not a
  // lifetime, because remembering a no for ever is punishing the no.
  'wobo-suggest-v1',
] as const;

/**
 * The SDK keys its own caches with a `:<subject>` suffix (`packages/sdk/src/state.ts`,
 * `mastery.ts`): the learner's XP, streak and level, every thread of the conversation, and the
 * mastery evidence. It is the second scoping mechanism in the product, and it stays for now
 * because `@wobo/sdk` cannot import this module (`store/app-sdk.ts` says why). What this module
 * guarantees is that sign-out sweeps them too: `forgetScope` matches on the suffix, and
 * `::<subject>` ends in `:<subject>`, so one sweep covers both shapes. Named here so the source
 * scan (`isolation.test.ts`) can tell a classified key from a stray one; an entry ending in `-` is
 * a prefix (`wobo-thread-<id>-v1`).
 */
export const SDK_SCOPED = [
  'wobo-progress-v1',
  'wobo-conversation-v1',
  'wobo-vidya-conversation-v1',
  'wobo-thread-',
  'wobo-mastery-v1',
] as const;

/** One key the phone itself owns, the file that touches it, and the reason it is not a learner's. */
export interface DeviceKey {
  key: string;
  /** Repo-relative. The only files allowed to reach raw storage, besides this one. */
  file: string;
  why: string;
}

/**
 * THE DEVICE LIST. Everything a browser is allowed to hold under a plain, account-blind name.
 *
 * Per-learner by default, device-level by exception: a key is on this list because somebody wrote
 * down why two children on one phone SHOULD share it. Anything else is scoped or it is a bug, and
 * `isolation.test.ts` fails the build the moment a raw `localStorage` / `sessionStorage` /
 * IndexedDB use appears in a file that is not named here. The SDK's own per-learner caches are
 * listed under `SDK_SCOPED` above, not here: their files appear below only for the device-level
 * keys they hold.
 */
export const DEVICE_KEYS: readonly DeviceKey[] = [
  {
    key: 'wobo-theme-v1',
    file: 'apps/web-pwa/src/ui/theme.ts',
    why: 'light or dark is the screen’s, and it is painted before anyone is signed in',
  },
  {
    key: 'wobo-motion-v1',
    file: 'apps/web-pwa/src/ui/motion.ts',
    why: 'reduce motion is an accessibility setting of the phone, painted before the first frame',
  },
  {
    key: 'wobo-voice-muted-v1',
    file: 'apps/web-pwa/src/wobo/speech.tsx',
    why: 'mute is the phone’s speaker, not the learner’s ear; it is set by whoever is in the room',
  },
  {
    key: 'wobo-voice-muted-v1',
    file: 'apps/web-pwa/src/ui/sound.ts',
    why: 'the same mute, read fresh before every interface sound',
  },
  {
    key: 'wobo-voice-muted-v1',
    file: 'packages/wobo/src/board/pen.ts',
    why: 'the same mute, read by the pen (packages/wobo cannot import the app)',
  },
  {
    key: 'wobo-flew',
    file: 'apps/web-pwa/src/wobo/Flight.tsx',
    why: 'sessionStorage: Wobo’s grand arrival plays once per tab, whoever is watching',
  },
  {
    key: 'wobo-signin-source-v1',
    file: 'apps/web-pwa/src/screens/auth/source.ts',
    why: 'written at the door before there is a subject, read once on the next boot, then gone',
  },
  {
    key: 'wobo-parent-door-v1',
    file: 'apps/web-pwa/src/screens/parent/device.ts',
    why: 'sessionStorage: the parent’s door was pressed, written before there is a subject because a Google sign-in leaves the page; stale after fifteen minutes, taken once on the far side, then gone',
  },
  {
    key: 'wobo-arrival-v1',
    file: 'apps/web-pwa/src/shell/arrival.ts',
    why: 'sessionStorage: the card a mail link was pressed for, held across the door before there is a subject, taken once on the far side, then gone',
  },
  {
    key: 'wobo-campaign-v1',
    file: 'apps/web-pwa/src/shell/campaign.ts',
    why: 'the campaign id a visitor followed a link by, a piece of ours and never a person: kept before there is a subject, taken once at sign-up, then gone',
  },
  {
    key: 'wobo-auth-session-v1',
    file: 'packages/sdk/src/identity.ts',
    why: 'the session itself: it is the key everything else is scoped BY',
  },
  {
    key: 'wobo.dev.subject',
    file: 'apps/web-pwa/src/store/device.ts',
    why: 'the keyless dev identity of this browser: a random id so strangers never share one',
  },
  {
    key: 'wobo-key-rename-v1',
    file: 'apps/web-pwa/src/store/legacy-keys.ts',
    why: 'the rename migration marker; it runs before any session exists',
  },
  {
    key: 'wobo-scope-v1',
    file: 'apps/web-pwa/src/store/scope.ts',
    why: 'which learner this device was last keyed to, so a boot reads the right keys before the session resolves',
  },
  {
    key: 'wobo-inspect',
    file: 'packages/wobo/src/registry.ts',
    why: 'a developer’s flag that turns the inspector on; never written by the product',
  },
  {
    key: 'wobo-share-v1',
    file: 'apps/web-pwa/src/screens/doubt/capture.ts',
    why: 'the Cache a shared photo waits in for the seconds between the phone’s share sheet and the doubt screen collecting it (public/share-target.js puts it there, capture.ts empties it on arrival). The service worker that writes it runs with no session, so it CANNOT be keyed to a learner, and that is the reason it is here rather than the excuse it was read as until 2026-09-16: an unkeyed store on a family tablet is one every learner opens. So it is device-level and bounded to a single page load instead — a share belongs to the arrival the redirect opened (capture.ts `isThisArrival`), a share met by the sign-in card is DROPPED rather than kept for whoever signs in next (`takeSharedFile`, the door), and `wipeDeviceCaches` below takes it on a sign-out and on an erase, which no key walk could ever reach',
  },
];

/**
 * Files that reach raw storage for a reason that is not a device key: the SDK's own per-learner
 * caches (SDK_SCOPED), which take the browser's storage as a default and suffix it themselves.
 */
export const RAW_STORAGE_FILES: readonly { file: string; why: string }[] = [
  {
    file: 'packages/sdk/src/state.ts',
    why: 'the state and thread caches: localStorage by default, keyed `wobo-progress-v1:<subject>` and `wobo-conversation-v1:<subject>` by the SDK',
  },
  {
    file: 'packages/sdk/src/mastery.ts',
    why: 'the mastery cache: localStorage by default, keyed `wobo-mastery-v1:<subject>` by the SDK',
  },
];

/** Where the last scope is remembered, so an upgrade (anonymous → account) can carry data across. */
const SCOPE_KEY = 'wobo-scope-v1';

/** The subject a device was last scoped to, and whether they were still anonymous. */
export interface RememberedScope {
  subject: string;
  anonymous: boolean;
  /**
   * The anonymous id this learner upgraded from, when they did. Their pre-account work moved under
   * the account (`inheritScope`), but a write can still land under the old id afterwards (a
   * debounce firing late, a second tab), and that id is theirs too: sign-out sweeps it as well.
   */
  upgradedFrom?: string;
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

function rawSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The learner's door onto a store. `scoped` is localStorage, `scopedSession` is sessionStorage;
 * both key everything by the subject who owns it.
 */
function scopedStore(store: () => Storage | null, recordRefusals: boolean) {
  return {
    getItem(base: string): string | null {
      try {
        const s = store();
        if (!s) return null;
        const key = scopedKey(base);
        const value = s.getItem(key);
        if (value !== null || key === base) return value;
        /*
         * THE FIRST SCOPED READ CARRIES THE OLD VALUE ACROSS. `applyScope` moves every key on the
         * lists above the moment the learner is known, but a key can be read through this door
         * before it is on a list (a store that joined the scope after the device was already
         * keyed), and the day that ships nobody must lose a streak: an unscoped value found here
         * belongs to the learner who was on the device, so it moves under them and the plain
         * copy leaves. The plain key is never read back as anyone's after that.
         */
        const plain = s.getItem(base);
        if (plain === null) return null;
        s.setItem(key, plain);
        s.removeItem(base);
        return plain;
      } catch {
        return null;
      }
    },
    /** Did it land? A refused write is recorded, never silently discarded. */
    setItem(base: string, value: string): boolean {
      const s = store();
      // No storage object at all is a server render or a keyless build, not a device refusing a
      // learner's work. Only an actual throw from an actual store is trouble worth a sentence.
      if (!s) return false;
      try {
        s.setItem(scopedKey(base), value);
      } catch {
        if (recordRefusals) noteWrite(false); // quota or private mode — this session only
        return false;
      }
      if (recordRefusals) noteWrite(true);
      return true;
    },
    removeItem(base: string): void {
      try {
        store()?.removeItem(scopedKey(base));
      } catch {
        // nothing to do
      }
    },
  };
}

/** localStorage, keyed to the learner. The only door the per-learner stores use. */
export const scoped = scopedStore(raw, true);

/** sessionStorage, keyed to the learner: resets with the tab, and is still one learner's. */
export const scopedSession = scopedStore(rawSession, false);

/**
 * THE SAME localStorage DOOR, FOR A CACHE RATHER THAN FOR THE LEARNER'S WORK.
 *
 * Same keys, same scope, same sweep — the only difference is that a refusal here is not reported
 * as the learner failing to save. The refusal level above exists because a swallowed quota error
 * once let the strip say "your work is safe on this device" while the write was being thrown away.
 * The opposite is just as untrue: a lesson cache that cannot find room (screens/course/kept.ts)
 * costs the ordinary compose and nothing else, and routing it through `scoped` put a sentence in
 * front of a child saying this device would not keep their work and this piece might not be
 * waiting next time — about a file they never made, at a moment nothing of theirs was at risk.
 *
 * So a store whose miss is free writes here, and the strip keeps meaning what it says. A store
 * holding anything the learner would notice the loss of uses `scoped`, and that is the test for
 * which door a new store takes: would a child miss it if it vanished?
 */
export const scopedCache = scopedStore(raw, false);

/**
 * localStorage under a plain name, for the keys on DEVICE_KEYS and nothing else. A device key is
 * the phone's own (mute, motion, theme) and is the same whoever is signed in; this door exists so
 * a per-learner module holding one such key does not have to reach raw storage to do it.
 */
export const device = {
  getItem(key: string): string | null {
    try {
      return raw()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      raw()?.setItem(key, value);
    } catch {
      // the choice holds for this session
    }
  },
  removeItem(key: string): void {
    try {
      raw()?.removeItem(key);
    } catch {
      // nothing to do
    }
  },
};

/** Every key a store holds, or none if it refuses to be walked. */
function keysOf(store: Storage | null): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < (store?.length ?? 0); i += 1) {
      const key = store?.key(i);
      if (key) out.push(key);
    }
  } catch {
    // storage refused enumeration
  }
  return out;
}

/**
 * THE STORE NO KEY WALK CAN REACH: every Cache this device holds under our own name.
 *
 * Cache Storage is not a `Storage`. It has no `length`, no `key(i)` and no `removeItem`, so
 * `wipeDevice` below walked straight past it for as long as both have existed — and on
 * 2026-09-16 there was something in it: `wobo-share-v1`, the Cache a photo of a child's homework
 * waits in between the phone's share sheet and the doubt screen (screens/doubt/capture.ts). "Erase
 * and start over" promises this device, and it left that photo on the phone.
 *
 * Matched by the `wobo-` prefix rather than by a list, exactly as the key sweep is, so the next
 * Cache somebody adds is swept the day they add it rather than the day somebody notices. Workbox's
 * own caches are not ours and are not touched: emptying the precache would cost an offline learner
 * the whole product to no purpose, since it holds the app's code and nothing of anybody's.
 */
export async function wipeDeviceCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('wobo-') || name.startsWith('wobo.'))
        .map((name) => caches.delete(name).catch(() => false)),
    );
  } catch {
    // site data switched off, or a browser with no Cache at all: there is nothing to empty
  }
}

/**
 * Erase and start over: every wobo key this device holds, whoever's it is and the phone's own
 * settings included, from both stores, AND every wobo Cache. The You screen calls it last, after
 * the brain and the account, and reloads.
 *
 * The keys go synchronously, before the first await, so a caller that does not wait still empties
 * the two Storages exactly as this always did. The Caches need a promise, and `eraseEverything`
 * awaits this one BEFORE it reloads: a delete still in flight when the page goes is a delete that
 * may not have happened, and this is the one call in the product whose whole promise is that it
 * did.
 */
export async function wipeDevice(): Promise<void> {
  for (const store of [raw(), rawSession()]) {
    for (const key of keysOf(store)) {
      if (key.startsWith('wobo-') || key.startsWith('wobo.')) {
        try {
          store?.removeItem(key);
        } catch {
          // best effort
        }
      }
    }
  }
  await wipeDeviceCaches();
}

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
function move(from: string, to: string, store: Storage | null = raw()): void {
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
export function applyScope(
  subjectId: string | null,
  anonymous = false,
  upgradedFrom?: string,
): void {
  scope = subjectId?.trim() ? subjectId.trim() : null;
  if (scope) {
    for (const key of SCOPED_KEYS) move(key, `${key}::${scope}`);
    for (const prefix of SCOPED_PREFIXES) moveByPrefix(prefix, scope);
    for (const key of SCOPED_SESSION_KEYS) move(key, `${key}::${scope}`, rawSession());
  }
  try {
    if (scope) {
      // The same subject again keeps the id it upgraded from; a new one starts clean.
      const from =
        upgradedFrom ??
        (rememberedScope()?.subject === scope ? rememberedScope()?.upgradedFrom : undefined);
      const record: RememberedScope = { subject: scope, anonymous };
      if (from && from !== scope) record.upgradedFrom = from;
      raw()?.setItem(SCOPE_KEY, JSON.stringify(record));
    } else raw()?.removeItem(SCOPE_KEY);
  } catch {
    // remembering the scope is a convenience; an upgrade just inherits nothing
  }
  // Last, once the keys have moved and the scope is live, so a listener that re-reads sees the
  // learner it was told about rather than the one it is replacing.
  for (const l of scopeListeners) l();
}

/**
 * Boot: key the device to the learner it was last keyed to, before anything reads storage.
 *
 * `App.tsx` decides whether a bare `/` is the front door or the app from one sentinel, and it
 * decides it before the identity layer is loaded (a marketing page must not pay for the auth
 * stack). That sentinel is the learner's now, not the device's, so the boot has to know whose
 * keys to read: the subject remembered by the last `applyScope`. The session, once it resolves,
 * applies the real scope (`store/app-sdk.ts`), which is the same subject on every boot but a
 * sign-in, and `forgetScope` removed the memory on sign-out, so the boot after a sign-out is
 * unscoped and the bare `/` is the front door again for whoever comes next.
 */
export function bootScope(): void {
  const previous = rememberedScope();
  if (previous) applyScope(previous.subject, previous.anonymous);
}

/** The subject this device was last scoped to (across a sign-in redirect), or null. */
export function rememberedScope(): RememberedScope | null {
  try {
    const v = raw()?.getItem(SCOPE_KEY);
    if (!v?.trim()) return null;
    const parsed = JSON.parse(v) as Partial<RememberedScope>;
    if (!parsed.subject?.trim()) return null;
    const out: RememberedScope = { subject: parsed.subject, anonymous: parsed.anonymous === true };
    if (typeof parsed.upgradedFrom === 'string' && parsed.upgradedFrom.trim()) {
      out.upgradedFrom = parsed.upgradedFrom.trim();
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Every key under `subject`, in either scoping shape, in one store. The app's stores suffix
 * `::<subject>` and the SDK's caches suffix `:<subject>` (`packages/sdk/src/state.ts`,
 * `mastery.ts`); `::<subject>` ends with `:<subject>`, so one suffix finds both, and an exact
 * suffix on a subject id can only ever be that learner's own key.
 */
function keysUnder(store: Storage | null, subject: string): string[] {
  const suffix = `:${subject}`;
  return keysOf(store).filter((key) => key.endsWith(suffix));
}

/**
 * The same person, a bigger identity: an anonymous learner signed in for real. Carry their work
 * across to the new subject before the app reads anything, so signing in never costs them the
 * conversation they just had.
 *
 * EVERY key under the old id moves, the SDK's own caches included. Moving only this module's lists
 * left the SDK's `:<anon>` buckets (XP, the whole transcript, the mastery evidence) sitting under
 * the anonymous id: the learner read xp 0 after signing in, and nothing ever swept what they had
 * said before the door. The SDK re-reads its caches after this (`store/app-sdk.ts` calls
 * `sdk.rekey`), and the old id is remembered so sign-out sweeps a late write under it too.
 */
export function inheritScope(from: string, to: string, anonymous = false): void {
  if (from !== to) {
    for (const store of [raw(), rawSession()]) {
      for (const key of keysUnder(store, from)) {
        move(key, `${key.slice(0, -from.length)}${to}`, store);
      }
    }
  }
  applyScope(to, anonymous, from !== to ? from : undefined);
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
   * Every key this device holds for THIS learner, found by their id rather than by a list
   * (`keysUnder`: it cannot drift when a new cache is added, and it keeps this module free of an
   * `@wobo/sdk` import, which `store/app-sdk.ts` says must not reach the entry chunk). And the
   * anonymous id they upgraded from, when there is one: that was them too.
   */
  const remembered = rememberedScope();
  const theirs = [subject];
  if (remembered?.subject === subject && remembered.upgradedFrom)
    theirs.push(remembered.upgradedFrom);
  const doomed: string[] = theirs.flatMap((id) => keysUnder(store, id));
  /*
   * And the SDK's PLAIN keys, whoever wrote them. The SDK is built before a session exists, so its
   * door-time providers are keyed to nobody and write `wobo-progress-v1` bare (`state.ts`, scope
   * ''); the door now leaves the page the moment a session lands (`screens/auth/run.ts`), so that
   * window is closed, but anything that did land there is this learner's or nobody's, and either
   * way it must not be what the next learner's door-time SDK reads as their own.
   */
  const plain = SDK_SCOPED.filter((key) => !key.endsWith('-'));
  const plainPrefixes = SDK_SCOPED.filter((key) => key.endsWith('-'));
  for (const key of keysOf(store)) {
    if (plainPrefixes.some((p) => key.startsWith(p) && !key.includes(':'))) doomed.push(key);
  }
  for (const key of [...doomed, ...plain, ...SCOPED_KEYS.map((base) => `${base}::${subject}`)]) {
    try {
      store.removeItem(key);
    } catch {
      // best effort
    }
  }
  // The tab's own store too: the stars that caught light for them are theirs.
  const tab = rawSession();
  for (const key of theirs.flatMap((id) => keysUnder(tab, id))) {
    try {
      tab?.removeItem(key);
    } catch {
      // best effort
    }
  }
  /*
   * AND THE CACHES, WHICH CARRY NO SUFFIX TO FIND THEM BY. A sign-out is the family tablet being
   * handed over, and `wobo-share-v1` can be holding a photo of the page this learner just shared.
   * It is not awaited because this function is not async and its callers are mid-hand-over: the
   * sweep outlives the call, and `handOverDevice` has a network round trip and a full navigation
   * to run before anything could read the store again. The read side is closed regardless — a
   * share is only ever opened by the page load its redirect made (screens/doubt/capture.ts) — so
   * this is the second lock rather than the only one.
   */
  void wipeDeviceCaches();
  applyScope(null);
}
