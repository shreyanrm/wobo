/**
 * The honesty rules on the two doors, held as rules rather than as a screenshot.
 *
 * Every case below is one of the things the owner saw wrong on the screen this replaces: a greyed
 * out provider with an apology under it, an `or` rule with nothing after it, and a control that
 * could not do anything drawn as though it could.
 */

import { describe, expect, it } from 'bun:test';
import { mergeSeams, methodStates } from './client';
import { PROVIDER_ORDER, waysIn } from './doors';

/** The ways in this build has, given a client that exposes exactly these seams. */
function ways(...names: string[]) {
  const seams: Record<string, unknown> = {};
  for (const name of names) seams[name] = () => {};
  return waysIn(methodStates(mergeSeams(seams)));
}

describe('which doors this build actually has', () => {
  it('asks for a number when a code is all that can be sent', () => {
    const built = ways('requestPhoneOtp');
    expect(built.identifier).toBe('phone');
    expect(built.emailSeam).toBeNull();
  });

  it('asks for an address when a link is all that can be sent', () => {
    const built = ways('signInWithMagicLink');
    expect(built.identifier).toBe('email');
    expect(built.emailSeam).toBe('magicLink');
  });

  it('asks for either only when either one can really be sent', () => {
    expect(ways('requestPhoneOtp', 'signInWithMagicLink').identifier).toBe('both');
  });

  it('prefers a password over a link, because a password is one step and a link is three', () => {
    const built = ways('signInWithPassword', 'signInWithMagicLink');
    expect(built.emailSeam).toBe('password');
    expect(built.identifier).toBe('email');
  });

  it('draws no field at all when nothing is behind one', () => {
    // A field with no seam is a form that fails on submit, which is the worst way to find out.
    expect(ways('signInWithGoogle').identifier).toBe('none');
  });
});

describe('a way in that is not open yet', () => {
  it('keeps its shape and carries the soon chip rather than vanishing', () => {
    const built = ways('requestPhoneOtp');
    expect(built.providers.map((door) => door.name)).toEqual([...PROVIDER_ORDER]);
    expect(built.providers.every((door) => door.status === 'soon')).toBe(true);
  });

  it('opens on its own the day the client grows the seam', () => {
    const built = ways('signInWithGoogle');
    expect(built.providers.find((door) => door.name === 'google')?.status).toBe('open');
    expect(built.providers.find((door) => door.name === 'apple')?.status).toBe('soon');
  });
});

describe('the rule with a word in it', () => {
  it('is drawn only when there is something on both sides of it', () => {
    expect(ways('requestPhoneOtp').divider).toBe(true);
    expect(ways('signInWithGoogle').divider).toBe(false);
    // the exact screen the owner saw: an `or` rule with nothing under it but a line saying the
    // other way was switched off
    expect(ways().divider).toBe(false);
  });
});

describe('a build with no way in at all', () => {
  it('says so instead of drawing controls that cannot work', () => {
    const built = ways();
    expect(built.anyOpen).toBe(false);
    expect(built.identifier).toBe('none');
  });

  it('counts one open provider as a way in, and a soon one as not', () => {
    expect(ways('signInWithGoogle').anyOpen).toBe(true);
    expect(ways('requestPhoneOtp').anyOpen).toBe(true);
    expect(ways('verifyPhoneOtp').anyOpen).toBe(false);
  });
});

/**
 * THE UNDER-13 BRANCH, IN THE BUILD THAT ACTUALLY SHIPS.
 *
 * Below 13 the account is a parent's, so the door the parent signs in through is a message to
 * their own device. The branch called the magic-link seam and nothing else, and no build has ever
 * had one: the SDK exposes requestPhoneOtp, verifyPhoneOtp and signInWithGoogle. So in every
 * shipped build the branch removed the field and both provider buttons, drew zero controls in the
 * action column, and ended on "Writing to a parent is not switched on yet". A child under 13 could
 * not make an account and could not get back either. `parental-consent.md` §2 names a message to
 * the parent's "email address or phone number": both, in one sentence.
 */
describe('how a parent can be reached, on the branch that needs one', () => {
  it('has a way in the build that ships, where a code is all there is', () => {
    expect(ways('requestPhoneOtp').parentWay).toBe('code');
    expect(ways('requestPhoneOtp', 'signInWithGoogle').parentWay).toBe('code');
  });

  it('prefers a link, where a parent can read a page on their own device', () => {
    expect(ways('requestPhoneOtp', 'signInWithMagicLink').parentWay).toBe('link');
    expect(ways('signInWithMagicLink').parentWay).toBe('link');
  });

  it('says so honestly when a parent cannot be reached at all', () => {
    // Google alone signs a grown-up in; it cannot carry a message to somebody else's device.
    expect(ways('signInWithGoogle').parentWay).toBeNull();
    // and a password is the learner's own way in, not a way to reach anybody
    expect(ways('signInWithPassword').parentWay).toBeNull();
  });
});
