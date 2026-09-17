/**
 * A PARENT SIGNING OUT hands the phone over exactly as a learner does (store/scope.ts,
 * docs/ONE-LEARNER-ONE-WOBO.md): everything keyed to the account leaves the device, the session
 * ends whether or not the server can be told, and the page goes to the front door for whoever is
 * next, which is a full navigation so nothing held in memory about any child survives it.
 *
 * There is nothing to settle first. A parent account holds no learner state (migration 0019), and
 * the parent's screens write nothing to the device but the one kind marker, which is scoped.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

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

const local = new FakeStorage();
const tab = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = local;
(globalThis as { sessionStorage?: unknown }).sessionStorage = tab;

const { applyScope } = await import('../../store/scope');
const { isParentDevice, markKind } = await import('./device');
const { signOutParent } = await import('./session');

const PARENT = 'b0b0b0b0-0000-4000-8000-00000000b0b0';

describe('a parent signing out', () => {
  beforeEach(() => {
    local.clear();
    tab.clear();
    applyScope(null);
  });

  it('takes the account’s keys off the phone, ends the session and leaves for the front door', async () => {
    applyScope(PARENT);
    markKind();
    expect(isParentDevice()).toBe(true);
    const calls: string[] = [];
    await signOutParent({
      account: {
        subjectId: () => PARENT,
        signOut: async () => {
          calls.push('signOut');
        },
      },
      leave: (url) => calls.push(`leave ${url}`),
    });
    expect(calls).toEqual(['signOut', 'leave /']);
    expect([...local.map.keys()].filter((k) => k.includes(PARENT))).toEqual([]);
    // and the next person on this phone is nobody's parent
    expect(isParentDevice()).toBe(false);
  });

  it('still leaves when the server cannot be told', async () => {
    applyScope(PARENT);
    markKind();
    const calls: string[] = [];
    await signOutParent({
      account: {
        subjectId: () => PARENT,
        signOut: async () => {
          throw new Error('offline');
        },
      },
      leave: (url) => calls.push(url),
    });
    expect(calls).toEqual(['/']);
    expect(isParentDevice()).toBe(false);
  });

  it('leaves even with no account layer at all', async () => {
    const calls: string[] = [];
    await signOutParent({ account: null, leave: (url) => calls.push(url) });
    expect(calls).toEqual(['/']);
  });
});
