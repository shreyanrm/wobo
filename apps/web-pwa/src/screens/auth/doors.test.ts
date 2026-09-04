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
