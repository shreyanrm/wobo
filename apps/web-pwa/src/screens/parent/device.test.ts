/**
 * WHAT THE PARENT SIDE KEEPS ON A PHONE, and that it is almost nothing.
 *
 * Two keys, and each is on the right list in `store/scope.ts`:
 *  · the door that was pressed, written BEFORE anyone is signed in (a Google round trip leaves the
 *    page), so it is device-level, read once on the far side, and gone; and it goes stale, so a
 *    press that was abandoned cannot turn a later sign-in into a parent account;
 *  · which kind this account is, keyed to the account like every other thing about a person, so
 *    a sibling on the same phone never inherits "this device is a parent's", and sign-out takes it.
 * Nothing about any child is kept on the device at all: the server holds the selection.
 */

import { describe, expect, it } from 'bun:test';
import { DEVICE_KEYS, SCOPED_KEYS } from '../../store/scope';
import {
  INTENT_KEY,
  INTENT_TTL_MS,
  isParentDevice,
  KIND_KEY,
  markKind,
  pressParentDoor,
  takeParentIntent,
} from './device';

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('the door that was pressed', () => {
  it('is kept across the round trip and taken exactly once', () => {
    const store = memory();
    pressParentDoor(store, 1_000);
    expect(takeParentIntent(store, 1_000 + 60_000)).toBe(true);
    expect(takeParentIntent(store, 1_000 + 60_000)).toBe(false);
    expect(store.data.has(INTENT_KEY)).toBe(false);
  });

  it('goes stale: an abandoned press never makes a later sign-in a parent account', () => {
    const store = memory();
    pressParentDoor(store, 1_000);
    expect(takeParentIntent(store, 1_000 + INTENT_TTL_MS + 1)).toBe(false);
    expect(store.data.has(INTENT_KEY)).toBe(false);
  });

  it('reads nothing it did not write', () => {
    const store = memory();
    store.setItem(INTENT_KEY, 'yes please');
    expect(takeParentIntent(store, 5)).toBe(false);
    expect(takeParentIntent(null, 5)).toBe(false);
  });

  it('survives a storage that throws', () => {
    const angry = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => pressParentDoor(angry, 1)).not.toThrow();
    expect(takeParentIntent(angry, 1)).toBe(false);
  });

  it('is on the device list, with a reason, and is nobody’s key', () => {
    const entry = DEVICE_KEYS.find((d) => d.key === INTENT_KEY);
    expect(entry?.file).toBe('apps/web-pwa/src/screens/parent/device.ts');
    expect((SCOPED_KEYS as readonly string[]).includes(INTENT_KEY)).toBe(false);
  });
});

describe('which kind this account is', () => {
  it('is keyed to the account, so sign-out sweeps it and a sibling never inherits it', () => {
    expect((SCOPED_KEYS as readonly string[]).includes(KIND_KEY)).toBe(true);
    expect(DEVICE_KEYS.some((d) => d.key === KIND_KEY)).toBe(false);
  });

  it('is written as a parent and taken back as anything else', () => {
    const store = memory();
    expect(isParentDevice(store)).toBe(false);
    markKind(store, true);
    expect(isParentDevice(store)).toBe(true);
    markKind(store, false);
    expect(isParentDevice(store)).toBe(false);
    expect(store.data.has(KIND_KEY)).toBe(false);
  });
});
