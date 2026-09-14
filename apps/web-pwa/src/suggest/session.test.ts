/**
 * THE SESSION LEDGER (docs/SUGGESTIONS-AND-NOTICES.md §2): *"A suggestion declined is not offered
 * again that session."*
 *
 * A session, not a device and not a lifetime: the learner who said no to a bonus level this evening
 * may well want it tomorrow, and a product that remembers a no for ever is punishing the no. So it
 * lives in sessionStorage, keyed to the learner like everything else personal, and it forgets by
 * itself when the tab closes.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { declinedIds, decline, forgetDeclines, SUGGEST_SESSION_KEY, wasDeclined } from './session';
import { SCOPED_SESSION_KEYS } from '../store/scope';

beforeEach(() => {
  forgetDeclines();
});

describe('a suggestion declined is not offered again that session', () => {
  it('remembers the one that was declined, and nothing else', () => {
    decline('side_door:ch-1:bonus-3-sort');
    expect(wasDeclined('side_door:ch-1:bonus-3-sort')).toBe(true);
    expect(wasDeclined('next:t4:p9')).toBe(false);
  });

  it('remembers each decline once, however many times it is said', () => {
    decline('next:t4:p9');
    decline('next:t4:p9');
    expect(declinedIds()).toEqual(['next:t4:p9']);
  });

  it('starts empty, and a new session starts empty again', () => {
    expect(declinedIds()).toEqual([]);
    decline('ask:t4');
    forgetDeclines();
    expect(declinedIds()).toEqual([]);
  });

  it('never throws when there is no storage to reach', () => {
    expect(() => decline('next:t4:p9')).not.toThrow();
    expect(() => wasDeclined('next:t4:p9')).not.toThrow();
  });
});

describe('it is one learner’s, and it leaves with them', () => {
  it('is on the per-learner session list, so signing out sweeps it', () => {
    expect([...SCOPED_SESSION_KEYS]).toContain(SUGGEST_SESSION_KEY);
  });
});
