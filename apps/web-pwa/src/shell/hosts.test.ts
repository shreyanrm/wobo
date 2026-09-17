/**
 * THREE HOSTS, AND WHICH ONE AN ADDRESS OPENS (App.tsx).
 *
 * The public site, the learner's app, and now the parent account's own small host. The parent's
 * host is separate on purpose: the learner runtime mints an anonymous session on mount, starts the
 * mind, the activity record and the voice, and locks every address behind the learner's setup. A
 * parent account can hold no learner state at all (migration 0019), so it must never mount any of
 * that, and a student account must never be shown the parent's screens.
 */

import { describe, expect, it } from 'bun:test';
import { bootRouteFor, hostFor } from './public-routes';

describe('which host an address opens', () => {
  it('opens the parent account’s host for its own addresses and nothing else', () => {
    expect(hostFor('parent')).toBe('parent');
    expect(hostFor('parent-preview')).toBe('app');
    expect(hostFor('you')).toBe('app');
    expect(hostFor('home')).toBe('app');
  });

  it('keeps the public site the public site, the doors included', () => {
    expect(hostFor('landing')).toBe('site');
    expect(hostFor('sign-in')).toBe('site');
    expect(hostFor('for-parents')).toBe('site');
    expect(hostFor('donate')).toBe('site');
  });
});

describe('what a bare / opens', () => {
  it('is the front door for somebody new', () => {
    expect(bootRouteFor({ onboarded: false, parent: false })).toEqual({ name: 'landing' });
  });

  it('is the learner’s home for a learner who finished setup', () => {
    expect(bootRouteFor({ onboarded: true, parent: false })).toEqual({ name: 'home' });
  });

  it('is the parent’s home for the parent account this device was last keyed to', () => {
    expect(bootRouteFor({ onboarded: false, parent: true })).toEqual({ name: 'parent' });
    // the two can never both be true of one account (migration 0019); if a stale device says so,
    // the parent's host asks the server and sends a student back to their own app
    expect(bootRouteFor({ onboarded: true, parent: true })).toEqual({ name: 'parent' });
  });
});
