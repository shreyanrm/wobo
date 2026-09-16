/**
 * ONE LEARNER, ONE WOBO — the rule that survives (docs/ONE-LEARNER-ONE-WOBO.md §5, MEMORY-LAW rule 5).
 *
 * Two children share a phone. Every key that describes one of them is keyed to that one, through
 * `store/scope.ts`, and is gone the moment they sign out. Every key that describes the PHONE is on
 * a short list in the same file with a reason beside it. There is no third kind.
 *
 * The first half of this file reads the source and fails the moment a new `localStorage`,
 * `sessionStorage` or IndexedDB use appears anywhere but `scope.ts` and the files the device list
 * names. The second half proves the behaviour: an old unscoped value moves under the learner who
 * was here, the next learner sees none of it, and sign-out leaves nothing of theirs behind.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// --- a storage stand-in, installed before any module reads ---------------------------------------

class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const local = new FakeStorage();
const session = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = local;
(globalThis as { sessionStorage?: unknown }).sessionStorage = session;

const scopeModule = await import('./scope');
const {
  applyScope,
  DEVICE_KEYS,
  forgetScope,
  RAW_STORAGE_FILES,
  SCOPED_KEYS,
  SCOPED_PREFIXES,
  SCOPED_SESSION_KEYS,
  SDK_SCOPED,
  scoped,
  scopedSession,
  wipeDevice,
} = scopeModule;
const { referralCode } = await import('./referral');
const { readSeen, writeSeen } = await import('../screens/progress/sky');
const { getFlag, PARENT_KEY, setFlag, VOICE_KEY } = await import('../screens/you/profile');
const { ONBOARDED_KEY } = await import('../shell/public-routes');
const { RUN_STEP_KEY } = await import('../screens/auth/run');
const { rememberSignInSource, takeSignInSource } = await import('../screens/auth/source');

// --- the source scan -------------------------------------------------------------------------------

const REPO = resolve(import.meta.dir, '../../../..');
const ROOTS = ['apps/web-pwa/src', 'packages/sdk/src', 'packages/wobo/src'];
/** The one door. */
const SCOPE_FILE = 'apps/web-pwa/src/store/scope.ts';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') out.push(...sources(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

/** Code only: a comment that mentions storage is a sentence, not a use. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * A use, not a mention: the name followed by a member, a call, a type mark, or after `typeof`.
 *
 * CACHE STORAGE IS ON THIS LIST FOR EVERY VERB, not only `open`. It was `caches.open(` alone until
 * 2026-09-16, which is the same blindness the store it guards was built with: Cache Storage holds
 * a learner's data (a photograph of their homework, in `wobo-share-v1`) and is reachable by none
 * of the key walks, so a file that only ever DELETES or ENUMERATES caches was invisible to the one
 * test that exists to notice such a file.
 */
const STORAGE_USE =
  /\b(localStorage|sessionStorage|indexedDB)\b(?=\s*[.;?)])|typeof\s+(localStorage|sessionStorage|indexedDB)\b|\bopenDatabase\(|\bcaches\.(open|delete|keys|match|has)\(/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function storageUses(): Hit[] {
  const hits: Hit[] = [];
  for (const root of ROOTS) {
    for (const path of sources(join(REPO, root))) {
      const file = relative(REPO, path);
      const lines = withoutComments(readFileSync(path, 'utf8')).split('\n');
      lines.forEach((text, i) => {
        if (STORAGE_USE.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
      });
    }
  }
  return hits;
}

/** Every `'wobo-…-vN'` literal in the code: the product's own shape for a storage key. */
function keyLiterals(): { file: string; key: string }[] {
  const found: { file: string; key: string }[] = [];
  for (const root of ROOTS) {
    for (const path of sources(join(REPO, root))) {
      const file = relative(REPO, path);
      const code = withoutComments(readFileSync(path, 'utf8'));
      for (const m of code.matchAll(/'(wobo[-.][A-Za-z0-9._:-]*-v\d+:?)'/g)) {
        found.push({ file, key: m[1] as string });
      }
    }
  }
  return found;
}

/**
 * `wobo-…-vN` names that are not storage keys at all, each with the reason it is allowed to look
 * like one. Adding a line here means arguing it is not a key.
 */
const NOT_A_KEY: Record<string, string> = {
  'wobo-landing-v8': 'the id of the landing page stylesheet (screens/landing/page-styles.ts)',
  'wobo-view-pref-v1':
    'the vibe key this replaced; read once through scoped, written forward, gone',
  'wobo-state-adopted-v1':
    'the retired once-per-device adoption marker: it held a previous learner’s id under a plain key, and packages/sdk/src/state.ts now removes it on sight',
};

describe('the rule that survives: storage is reached through scope.ts or the device list', () => {
  const allowedFiles = new Set<string>([
    SCOPE_FILE,
    ...DEVICE_KEYS.map((d) => d.file),
    ...RAW_STORAGE_FILES.map((d) => d.file),
  ]);

  it('names every device-level key with a file and a reason', () => {
    for (const entry of DEVICE_KEYS) {
      expect(entry.key.length, `${entry.key} needs a key`).toBeGreaterThan(0);
      expect(entry.why.trim().length, `${entry.key} needs a reason`).toBeGreaterThan(8);
      const code = readFileSync(join(REPO, entry.file), 'utf8');
      expect(code.includes(`'${entry.key}'`), `${entry.file} no longer holds '${entry.key}'`).toBe(
        true,
      );
    }
  });

  it('never lets one key be both the device’s and a learner’s', () => {
    const device = new Set(DEVICE_KEYS.map((d) => d.key));
    for (const key of SCOPED_KEYS) expect(device.has(key), key).toBe(false);
    for (const key of SDK_SCOPED) expect(device.has(key), key).toBe(false);
  });

  it('finds no raw localStorage / sessionStorage / IndexedDB use outside scope.ts and the device list', () => {
    const strays = storageUses().filter((h) => !allowedFiles.has(h.file));
    const report = strays.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');
    expect(strays, `raw storage outside scope.ts and DEVICE_KEYS:\n${report}`).toEqual([]);
  });

  it('classifies every wobo-…-vN key literal as scoped, device-level, or SDK-scoped', () => {
    const scopedSet = new Set<string>([...SCOPED_KEYS, ...SCOPED_SESSION_KEYS, ...SDK_SCOPED]);
    const device = new Set(DEVICE_KEYS.map((d) => d.key));
    // A prefix is listed with its separator; the literal in the store is written without it.
    const prefixes = [...SCOPED_PREFIXES, ...SDK_SCOPED.filter((k) => k.endsWith('-'))].map((p) =>
      p.replace(/[:-]$/, ''),
    );
    const unclassified = keyLiterals().filter(
      ({ key }) =>
        !scopedSet.has(key) &&
        !device.has(key) &&
        !(key in NOT_A_KEY) &&
        !prefixes.some((p) => key.startsWith(p)),
    );
    const report = unclassified.map(({ file, key }) => `${file}  '${key}'`).join('\n');
    expect(unclassified, `keys on neither list:\n${report}`).toEqual([]);
  });
});

// --- the behaviour ---------------------------------------------------------------------------------

beforeEach(() => {
  local.clear();
  session.clear();
  applyScope(null);
});

// The module is shared with every other file in the run; leave the device unscoped, as found.
afterAll(() => applyScope(null));

/** The keys this wave moved under the learner, with a value each that a device could be carrying. */
const CARRIED: Record<string, string> = {
  [ONBOARDED_KEY]: '1',
  'wobo-first-turn-v1': '1',
  [PARENT_KEY]: JSON.stringify({ phone: '98765 43210' }),
  'wobo-referral-code-v1': 'abcd2345',
  [RUN_STEP_KEY]: '3',
  'wobo-activity-v1': JSON.stringify(['2026-09-04', '2026-09-05']),
  'wobo-curriculum-world-v1': JSON.stringify({ frameworkId: 'cbse', level: 'Class 8' }),
  'wobo-brain-erase-v1': '1',
};

describe('migration: the learner who was already here keeps their world', () => {
  it('moves every unscoped value under the first learner and leaves nothing for the second', () => {
    for (const [key, value] of Object.entries(CARRIED)) local.setItem(key, value);

    applyScope('learner-a');
    for (const [key, value] of Object.entries(CARRIED)) {
      expect(scoped.getItem(key), key).toBe(value);
      expect(local.getItem(key), `${key} still unscoped`).toBeNull();
    }

    applyScope('learner-b');
    for (const key of Object.keys(CARRIED)) expect(scoped.getItem(key), key).toBeNull();

    applyScope('learner-a');
    for (const [key, value] of Object.entries(CARRIED))
      expect(scoped.getItem(key), key).toBe(value);
  });

  it('moves a value on the first scoped read even when the key was not on the list at scope time', () => {
    applyScope('learner-a');
    local.setItem('wobo-late-v1', 'from before'); // written unscoped after the scope was applied
    expect(scoped.getItem('wobo-late-v1')).toBe('from before');
    expect(local.getItem('wobo-late-v1')).toBeNull();
    expect(local.getItem('wobo-late-v1::learner-a')).toBe('from before');
  });

  it('keeps an anonymous learner’s referral code with the learner it was minted for', () => {
    local.setItem('wobo-referral-code-v1', 'kept2345');
    applyScope('learner-a', true);
    expect(referralCode()).toBe('kept2345');
    applyScope('learner-b', true);
    const theirs = referralCode();
    expect(theirs).not.toBe('kept2345');
    applyScope('learner-a', true);
    expect(referralCode()).toBe('kept2345');
    applyScope('learner-b', true);
    expect(referralCode()).toBe(theirs);
  });

  /**
   * A signed-in learner's code was minted per device scope and swept at sign-out, so every invite
   * they had forwarded stopped attributing to them the moment they signed out, and a second phone
   * gave them a third code. The code is the ACCOUNT's now: derived from the subject id, the same on
   * every device, with nothing to sweep and nothing to lose. Seen in a browser, 2026-09-07.
   */
  it('a signed-in learner’s referral code is the account’s: the same after a sign-out and on another phone', () => {
    applyScope('a5aa0001-0000-4000-8000-00000000a5aa', false);
    const code = referralCode();
    expect(code).toMatch(/^[2-9a-z]{8}$/);
    forgetScope('a5aa0001-0000-4000-8000-00000000a5aa');
    applyScope('a5aa0001-0000-4000-8000-00000000a5aa', false);
    expect(referralCode()).toBe(code);
    local.clear(); // a second phone, never seen this learner
    applyScope('a5aa0001-0000-4000-8000-00000000a5aa', false);
    expect(referralCode()).toBe(code);
    applyScope('41a40002-0000-4000-8000-0000000041a4', false);
    expect(referralCode()).not.toBe(code);
    // Opaque: nothing of the subject id itself rides in it.
    expect(code).not.toContain('a5aa');
  });

  it('keeps the sign-in source with the device until the boot that reads it', () => {
    rememberSignInSource('google');
    applyScope('learner-a');
    expect(takeSignInSource()).toBe('google');
    expect(takeSignInSource()).toBeNull(); // read once, then gone
  });
});

describe('sessionStorage is the learner’s too', () => {
  it('keys the ignite replay to the learner who saw it', () => {
    applyScope('learner-a');
    writeSeen(['star-1']);
    expect([...readSeen()]).toEqual(['star-1']);
    applyScope('learner-b');
    expect(readSeen().size).toBe(0);
    applyScope('learner-a');
    expect([...readSeen()]).toEqual(['star-1']);
  });

  it('is swept at sign-out', () => {
    applyScope('learner-a');
    scopedSession.setItem('wobo-sky-seen-v1', '["x"]');
    forgetScope('learner-a');
    expect(session.keys().filter((k) => k.includes('learner-a'))).toEqual([]);
  });
});

describe('sign-out leaves nothing of the learner on the device', () => {
  it('removes every per-learner key, the SDK’s caches included, and keeps the device’s own', () => {
    local.setItem('wobo-theme-v1', 'dark');
    local.setItem('wobo-motion-v1', 'reduce');
    local.setItem('wobo-voice-muted-v1', '1');

    applyScope('learner-a');
    for (const key of SCOPED_KEYS) scoped.setItem(key, 'theirs');
    for (const prefix of SCOPED_PREFIXES) scoped.setItem(`${prefix}topic-1`, 'theirs');
    referralCode();
    local.setItem('wobo-progress-v1:learner-a', 'xp'); // the SDK's own suffix shape
    local.setItem('wobo-mastery-v1:learner-a', 'bands');
    scopedSession.setItem('wobo-sky-seen-v1', '["star-1"]');

    forgetScope('learner-a');

    const left = local.keys().filter((k) => k.includes('learner-a'));
    expect(left).toEqual([]);
    expect(session.keys().filter((k) => k.includes('learner-a'))).toEqual([]);
    // Unscoped, the next person would read it as their own; that must be nothing.
    for (const key of SCOPED_KEYS) expect(local.getItem(key), key).toBeNull();
    expect(local.getItem('wobo-referral-code-v1')).toBeNull();

    const device = new Set(DEVICE_KEYS.map((d) => d.key));
    for (const key of local.keys()) expect(device.has(key), `${key} outlived sign-out`).toBe(true);
    expect(local.getItem('wobo-theme-v1')).toBe('dark');
    expect(local.getItem('wobo-motion-v1')).toBe('reduce');
    expect(local.getItem('wobo-voice-muted-v1')).toBe('1');

    applyScope('learner-b');
    for (const key of SCOPED_KEYS) expect(scoped.getItem(key), key).toBeNull();
    expect(referralCode()).not.toBe('theirs');
  });
});

describe('the SDK’s plain bucket is nobody’s after a sign-out', () => {
  /*
   * THE DOOR'S OWN HOLE. The SDK is built before there is a session, so its state, thread and
   * mastery providers are keyed to nobody and write the PLAIN key (`packages/sdk/src/state.ts`
   * scope ''). Everything a learner did between the door and their next reload used to land
   * there, and the plain key is exactly what the next learner's door-time SDK reads as their own.
   * The door now leaves the page (`screens/auth/run.ts` landingAfterDoor) so that window is gone;
   * this is the second lock: whatever sits under the plain SDK keys at sign-out leaves too.
   */
  it('sweeps the plain SDK keys at sign-out, so the next door-time SDK reads nothing', () => {
    applyScope('learner-a');
    local.setItem('wobo-progress-v1', JSON.stringify({ xp: 120 }));
    local.setItem('wobo-conversation-v1', '[{"text":"hi"}]');
    local.setItem('wobo-mastery-v1', '{}');
    local.setItem('wobo-thread-notes-v1', '[]');
    forgetScope('learner-a');
    for (const key of SDK_SCOPED) {
      if (!key.endsWith('-')) expect(local.getItem(key), key).toBeNull();
    }
    expect(local.getItem('wobo-thread-notes-v1')).toBeNull();
  });
});

describe('erase and start over', () => {
  it('wipes every wobo key on the device, the phone’s own settings included', () => {
    local.setItem('wobo-theme-v1', 'dark');
    applyScope('learner-a');
    scoped.setItem('wobo-archive-v1', 'x');
    scopedSession.setItem('wobo-sky-seen-v1', '[]');
    local.setItem('unrelated', 'stays');
    // the keys go synchronously, before the first await, exactly as they always did
    void wipeDevice();
    expect(local.keys()).toEqual(['unrelated']);
    expect(session.keys()).toEqual([]);
  });
});

/**
 * THE STORE NO KEY WALK REACHED (the fixer, 2026-09-16).
 *
 * Cache Storage is not a `Storage`: no `length`, no `key(i)`, no `removeItem`. So `wipeDevice` and
 * `forgetScope` both walked straight past it for as long as both have existed, and there was
 * something in it — `wobo-share-v1`, the Cache a photograph of a child's homework waits in between
 * the phone's share sheet and the doubt screen (`screens/doubt/capture.ts`). "Erase and start
 * over" promises THIS DEVICE and left the photo on the phone; a sign-out is the family tablet
 * being handed to a sibling and left it there too.
 */
describe('the Caches go with the keys', () => {
  /** Cache Storage, small enough to reason about: names in, names out, names deleted. */
  function stubCaches(names: string[]): { left: () => string[]; restore: () => void } {
    const held = new Set(names);
    const had = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = {
      keys: async () => [...held],
      delete: async (name: string) => held.delete(name),
    };
    return {
      left: () => [...held],
      restore: () => {
        (globalThis as { caches?: unknown }).caches = had;
      },
    };
  }

  const ALL = ['wobo-share-v1', 'workbox-precache-v2-https://wobo.test/', 'rdkit-wasm'];

  it('erase and start over empties every wobo Cache, and leaves the app’s own precache alone', async () => {
    const store = stubCaches(ALL);
    try {
      await wipeDevice();
      // a photograph of somebody's homework is not left on a phone that was asked to forget them
      expect(store.left()).not.toContain('wobo-share-v1');
      // and the offline product survives: workbox's caches hold the app's code and nobody's data
      expect(store.left()).toEqual(['workbox-precache-v2-https://wobo.test/', 'rdkit-wasm']);
    } finally {
      store.restore();
    }
  });

  it('a sign-out takes the share Cache too: the tablet is being handed over', async () => {
    const store = stubCaches(ALL);
    try {
      applyScope('learner-a');
      forgetScope('learner-a');
      // fired rather than awaited (forgetScope is not async, and its caller has a navigation to
      // run before anything could read the store again), so let the sweep settle
      await Promise.resolve();
      await Promise.resolve();
      expect(store.left()).not.toContain('wobo-share-v1');
    } finally {
      store.restore();
    }
  });

  it('says nothing and breaks nothing in a browser with no Cache Storage at all', async () => {
    const had = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = undefined;
    try {
      local.setItem('wobo-theme-v1', 'dark');
      await wipeDevice();
      expect(local.keys()).toEqual([]);
    } finally {
      (globalThis as { caches?: unknown }).caches = had;
    }
  });
});

// --- The fixer, 2026-09-07 -------------------------------------------------------------------------

describe('what the device list no longer says', () => {
  it('has no once-per-device adoption marker: it was a previous learner’s id under a plain key', () => {
    expect(DEVICE_KEYS.some((d) => d.key === 'wobo-state-adopted-v1')).toBe(false);
  });

  it('keeps the palette’s recent doors with the learner: a door id names their last chapter', () => {
    expect(SCOPED_KEYS).toContain('wobo-cmdk-recent-v1');
    expect(DEVICE_KEYS.some((d) => d.key === 'wobo-cmdk-recent-v1')).toBe(false);
  });

  it('keeps read-aloud with the learner: it rides every turn as THEIR accessibility need', () => {
    expect(SCOPED_KEYS).toContain(VOICE_KEY);
    expect(DEVICE_KEYS.some((d) => d.key === VOICE_KEY)).toBe(false);
    applyScope('learner-a');
    expect(getFlag(VOICE_KEY)).toBe(true);
    setFlag(VOICE_KEY, false);
    expect(getFlag(VOICE_KEY)).toBe(false);
    applyScope('learner-b');
    expect(getFlag(VOICE_KEY)).toBe(true);
    applyScope('learner-a');
    expect(getFlag(VOICE_KEY)).toBe(false);
  });

  it('holds no daily-quest claim: nothing ever claimed it, and a device-only claim would double the award', () => {
    expect(SCOPED_KEYS).not.toContain('wobo-daily-quest-v1');
  });
});
