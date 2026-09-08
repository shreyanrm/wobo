/**
 * WHAT THE DOORS ARE WIRED TO, held as source rather than as a screenshot.
 *
 * The rules below are each one thing that was true on production and could not be seen from any
 * unit test in this directory, because the decision lived in JSX: the under-13 branch calling a
 * seam no build has, the sign-in door minting accounts, a parent's address collected and dropped,
 * and a provider round trip aimed at the marketing page. The shapes and words they depend on are
 * held properly by `doors.test.ts`, `field.test.ts`, `record.test.ts` and `run.test.ts`; this file
 * holds the wiring between them, which is what actually broke.
 *
 * It reads the file with its comments stripped — what the screen DOES, not what it says about
 * itself — the same way `onboarding/onboarding.test.ts` holds the run's own first step.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;
/** A source with its comments stripped: what it does, not what it says about itself. */
function spoken(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const AUTH = spoken(readFileSync(join(HERE, 'Auth.tsx'), 'utf8'));
const PALETTE = spoken(readFileSync(join(HERE, '..', '..', 'shell', 'CommandPalette.tsx'), 'utf8'));

describe('the under-13 branch uses a way in that this build actually has', () => {
  it('asks doors.ts how a parent can be reached instead of assuming an email seam', () => {
    expect(AUTH).toContain('ways.parentWay');
    // the branch's only submit used to be the magic link, in a build that has never had one
    expect(AUTH).not.toContain("childHolds && !seamOf('magicLink')");
    expect(AUTH).toMatch(/parentWay === 'link' \? seamOf\('magicLink'\) : seamOf\('phone'\)/);
  });

  it('never leaves the action column with nothing in it', () => {
    // With no way to reach a parent the column held literally zero controls and no way back.
    expect(AUTH).toContain('ACTIONS.changeBirth');
    expect(AUTH).toMatch(/childHolds && !parentWay \?/);
  });
});

describe('the sign-in door does not make accounts', () => {
  it('says which door it is on every request for a code', () => {
    expect(AUTH).toContain("createUser: mode === 'sign-up'");
    // one place asks for a code, so there is one place this can be got wrong
    expect(AUTH.match(/callSeam\(seams, seam, number, \{ createUser/g)?.length).toBe(1);
  });

  it('has a sentence for a number with no account behind it', () => {
    expect(AUTH).toContain('NoSuchAccountError');
    expect(AUTH).toContain('ERRORS.noAccount');
  });
});

describe('the age gate keeps its answers', () => {
  it('writes the date of birth and the agreement down on every way through the sign-up door', () => {
    // the form path and the provider path, which is the one that used to walk past the gate
    expect(AUTH.match(/rememberSignUp\(fields\)/g)?.length).toBe(2);
  });
});

describe('a teenager is not asked for something that goes nowhere', () => {
  it('collects no parent address outside the branch that can really send to one', () => {
    // The block used to be drawn for every band under 18, promising "I send one message to that
    // address", and the address had exactly one call site: the under-13 branch, which no shipped
    // build could reach.
    expect(AUTH).not.toContain("branch.band !== 'adult'");
    expect(AUTH).toContain('TEEN.body');
    // one parent field on the page, and it is inside the childHolds branch
    expect(AUTH.match(/id="au-parent"/g)?.length).toBe(1);
    const child = AUTH.slice(AUTH.indexOf('{childHolds ? ('), AUTH.indexOf('TEEN.title'));
    expect(child).toContain('id="au-parent"');
  });
});

describe('a provider round trip comes back to a route the app owns', () => {
  it('aims the doors at the same address a code lands on', () => {
    expect(AUTH).toContain('providerReturn({');
    expect(AUTH).not.toContain('${window.location.origin}/`');
  });

  it('aims the palette’s own sign-in there too', () => {
    expect(PALETTE).toContain('${window.location.origin}/onboarding');
    expect(PALETTE).not.toMatch(/signInWithGoogle\(window\.location\.origin\)/);
  });
});
