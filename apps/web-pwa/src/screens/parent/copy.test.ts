/**
 * The register, held over every line the parent's door and home say (docs/copy/voice.md 10a,
 * DESIGN.md §0 copy law, docs/copy/money.md).
 */

import { describe, expect, it } from 'bun:test';
import { FORBIDDEN, forbiddenWordsIn } from '../money-voice';
import { DOOR, everyLine, HOME } from './copy';

const lines = everyLine();

describe('the parent’s words', () => {
  it('has lines to hold', () => {
    expect(lines.length).toBeGreaterThan(20);
  });

  it('carries no em dash, no exclamation mark and no emoji', () => {
    for (const line of lines) {
      expect([line, /[—!]/.test(line)]).toEqual([line, false]);
      expect([line, /\p{Extended_Pictographic}/u.test(line)]).toEqual([line, false]);
    }
  });

  it('never names a late hour', () => {
    for (const line of lines) {
      expect([
        line,
        /\b(tonight|midnight|\d{1,2}\s?pm|late at night|asleep)\b/i.test(line),
      ]).toEqual([line, false]);
    }
  });

  it('says none of the words money.md forbids, anywhere a parent reads', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(0);
    expect(forbiddenWordsIn(lines.join('\n'))).toEqual([]);
  });

  it('describes no money on the home: the pay and give doors carry a label and nothing more', () => {
    const keys = Object.keys(HOME);
    expect(keys.includes('payLine')).toBe(false);
    expect(keys.includes('donateLine')).toBe(false);
  });

  // No vendor or model name: the white-label gate (`bun run gate`) holds every shipped file to that,
  // this one included, so the list is not repeated here.
  it('names no plumbing and no invented person', () => {
    for (const line of lines) {
      expect([line, /gateway|server|database|\bAPI\b|aanya/i.test(line)]).toEqual([line, false]);
    }
  });

  it('keeps the promise the product rests on, in a parent’s words', () => {
    expect(HOME.privacy('Asha')).toBe(
      'You see how Asha is doing. You never see their conversations with me.',
    );
  });
});

describe('the parent’s door says what its one button can do', () => {
  /*
   * The door draws one way in, Google, but its lede said "sign in with the email address your
   * child invited". A parent whose invited address is not a Google account had no way in and was
   * never told. The lede names the button's account, and the line under it says what to do when
   * the invited address is not one.
   */
  it('names the account the button signs in with', () => {
    expect(DOOR.lede).toMatch(/Google/);
  });

  it('tells a parent whose invited address is not a Google account what to do', () => {
    expect(DOOR.whyEmail).toMatch(/not a Google account/);
  });
});
