import { beforeEach, describe, expect, it } from 'bun:test';

/** A localStorage stand-in — the app's stores talk to the real one; here we watch every key. */
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
}

const storage = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;

const { applyScope, forgetScope, inheritScope, rememberedScope, SCOPED_KEYS, scoped, scopedKey } =
  await import('./scope');
const { readArchive, writeArchive } = await import('../wobo/chat');
const { readCourseStars, writeCourseStars, readCoursePos, writeCoursePos } = await import(
  '../screens/course/shared'
);

const ARCHIVE = 'wobo-archive-v1';
const turn = (text: string) => [{ id: 't1', role: 'wobo' as const, text }];

beforeEach(() => {
  storage.clear();
  applyScope(null);
});

describe('per-learner storage scope', () => {
  it('keys personal stores to the subject who owns them', () => {
    applyScope('subject-a');
    expect(scopedKey(ARCHIVE)).toBe(`${ARCHIVE}::subject-a`);
    scoped.setItem(ARCHIVE, 'x');
    expect(storage.getItem(`${ARCHIVE}::subject-a`)).toBe('x');
    expect(storage.getItem(ARCHIVE)).toBeNull();
  });

  it('one learner can never read the other’s conversation on a shared device', () => {
    applyScope('subject-a');
    writeArchive(turn('what we talked about'));
    applyScope('subject-b');
    expect(readArchive()).toEqual([]);
    writeArchive(turn('a different learner'));
    applyScope('subject-a');
    expect(readArchive()[0]?.text).toBe('what we talked about');
  });

  it('the first subject to claim the device inherits what was written before there was a session', () => {
    writeArchive(turn('before anyone signed in')); // unscoped — a keyless boot
    expect(storage.getItem(ARCHIVE)).not.toBeNull();

    applyScope('subject-a');

    expect(readArchive()[0]?.text).toBe('before anyone signed in');
    expect(storage.getItem(ARCHIVE)).toBeNull(); // moved, not copied — the next learner starts clean
    applyScope('subject-b');
    expect(readArchive()).toEqual([]);
  });

  it('signing in for real carries the anonymous learner’s work across', () => {
    applyScope('anon-1', true);
    writeArchive(turn('the lesson before sign-up'));
    expect(rememberedScope()).toEqual({ subject: 'anon-1', anonymous: true });

    inheritScope('anon-1', 'real-1');

    expect(readArchive()[0]?.text).toBe('the lesson before sign-up');
    expect(rememberedScope()).toEqual({ subject: 'real-1', anonymous: false });
    expect(storage.getItem(`${ARCHIVE}::anon-1`)).toBeNull();
  });

  it('signing out takes that learner’s keys off the device', () => {
    applyScope('subject-a');
    writeArchive(turn('mine'));
    scoped.setItem('wobo-mind-v1', '{"facts":[]}');
    scoped.setItem('wobo-learner-profile', '{"name":"Learner"}');

    forgetScope('subject-a');

    expect(storage.getItem(`${ARCHIVE}::subject-a`)).toBeNull();
    expect(storage.getItem('wobo-mind-v1::subject-a')).toBeNull();
    expect(storage.getItem('wobo-learner-profile::subject-a')).toBeNull();
    expect(rememberedScope()).toBeNull();
    expect(readArchive()).toEqual([]);
  });

  /**
   * Sign-out has to reach the SDK's own caches too. They are scoped with a single colon rather than
   * the double colon this module uses, and they hold the learner's XP, streak, mind snapshot,
   * mastery evidence and the whole transcript — the most personal things on the device.
   */
  it('signing out also takes the SDK caches off the device', () => {
    applyScope('subject-a');
    storage.setItem('wobo-progress-v1:subject-a', '{"xp":400}');
    storage.setItem('wobo-conversation-v1:subject-a', '[]');
    storage.setItem('wobo-mastery-v1:subject-a', '{"nodes":{}}');
    // Another learner's bucket is not ours to touch.
    storage.setItem('wobo-progress-v1:subject-b', '{"xp":1}');

    forgetScope('subject-a');

    expect(storage.getItem('wobo-progress-v1:subject-a')).toBeNull();
    expect(storage.getItem('wobo-conversation-v1:subject-a')).toBeNull();
    expect(storage.getItem('wobo-mastery-v1:subject-a')).toBeNull();
    expect(storage.getItem('wobo-progress-v1:subject-b')).toBe('{"xp":1}');
  });

  /**
   * THE SHARED-DEVICE LEAK. Every boot writes unscoped for the moment before the session resolves,
   * so the plain key comes back after the scoped one already exists. `move` used to give up in
   * that case and leave the plain key sitting there, holding one learner's conversation where the
   * next person to open the browser reads it, because before THEIR session lands they are unscoped
   * too.
   */
  it('leaves nothing of a learner readable unscoped, even when the scoped copy already exists', () => {
    applyScope('subject-a');
    writeArchive(turn('a private lesson'));

    // The next boot: the app writes before anyone knows whose device this is.
    applyScope(null);
    writeArchive(turn('written before the session resolved'));
    expect(storage.getItem(ARCHIVE)).not.toBeNull();

    // The session resolves to the same learner. The unscoped copy must not survive it.
    applyScope('subject-a');
    expect(storage.getItem(ARCHIVE)).toBeNull();

    // Whoever opens the browser next, before their own session lands, reads nothing of theirs.
    applyScope(null);
    expect(readArchive()).toEqual([]);
  });

  /**
   * THE SUFFIX SWEEP'S BLIND SPOT.
   *
   * `forgetScope` finds a learner's keys by their `:<subject>` suffix, which protects only the
   * keys that already have one — so it was structurally unable to see the eleven stores that
   * wrote through raw `localStorage` and carried no suffix at all. Learner A signed out and their
   * course stars, course position, spaced-repetition schedule, workbooks, download queue, streak
   * marks and trophy ceremonies were all still sitting on the device for learner B to read as
   * their own.
   */
  it('one learner never reads the other’s course work on a shared device', () => {
    applyScope('learner-a');
    writeCourseStars('algebra-1', 3);
    writeCoursePos('algebra-1', 'card-7');
    expect(readCourseStars('algebra-1')).toBe(3);

    forgetScope('learner-a');
    applyScope('learner-b');

    expect(readCourseStars('algebra-1')).toBeUndefined();
    expect(readCoursePos('algebra-1')).toBeUndefined();
  });

  it('leaves nothing of a learner’s own work on the device after they sign out', () => {
    applyScope('learner-a');
    writeCourseStars('algebra-1', 2);
    for (const key of SCOPED_KEYS) scoped.setItem(key, 'theirs');
    scoped.setItem('wobo-forge-pool-v1:algebra-1', '[]');

    forgetScope('learner-a');

    const left = [...storage.map.keys()].filter((k) => k.includes('learner-a'));
    expect(left).toEqual([]);
  });

  it('carries an already-installed device’s work to the first learner who claims it', () => {
    // No session yet: the plain keys, exactly as an offline-first build wrote them.
    applyScope(null);
    writeCourseStars('algebra-1', 3);
    storage.setItem('wobo-forge-pool-v1:algebra-1', '["cached"]');

    applyScope('learner-a');
    expect(readCourseStars('algebra-1')).toBe(3);
    expect(storage.getItem('wobo-forge-pool-v1:algebra-1')).toBeNull();
    expect(storage.getItem('wobo-forge-pool-v1:algebra-1::learner-a')).toBe('["cached"]');
  });

  it('an unscoped build keeps the plain keys, exactly as it always did', () => {
    applyScope(null);
    writeArchive(turn('local only'));
    expect(storage.getItem(ARCHIVE)).not.toBeNull();
    expect(readArchive()[0]?.text).toBe('local only');
  });
});
