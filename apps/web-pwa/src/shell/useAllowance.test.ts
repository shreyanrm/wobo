import { describe, expect, it } from 'bun:test';
import { allowanceNote, allowanceProgress } from './useAllowance';

/**
 * ONE VOICE FOR THE ALLOWANCE (DESIGN.md §0).
 *
 * The rail used to say "25 of 40 turns left" while the plans page said "about half of today's
 * allowance is left" about the identical reading — and the first of those is the raw count the law
 * bans. These tests now hold the rail to the same sentence the rest of the product speaks, and to
 * the thing that makes that honest rather than vague: the bar beside it still carries the exact
 * fraction, so nothing is hidden, it is simply drawn instead of counted.
 */
describe('the rail\u2019s allowance card', () => {
  const now = new Date('2026-09-03T20:00:00+05:30');

  it('says how much of today is left in words, and never the raw count', () => {
    const resetsAt = new Date('2026-09-04T06:00:00+05:30');
    const a = { known: true, remaining: 25, limit: 40, resetsAt };
    const note = allowanceNote(a, now);
    expect(note).toMatch(/^About half of today\u2019?'?s allowance is left\. It comes back at /);
    expect(note).not.toMatch(/\d+\s*(of|turns)/);
    // The share is not lost, it moves to the bar, which draws it exactly.
    expect(allowanceProgress(a)).toBe(0.625);
  });

  it('leaves the reset off when the brain gave none', () => {
    const note = allowanceNote({ known: true, remaining: 3, limit: null, resetsAt: null }, now);
    expect(note).toBe(
      'There is still allowance left today. It comes back when the day rolls over.',
    );
    expect(
      allowanceProgress({ known: true, remaining: 3, limit: null, resetsAt: null }),
    ).toBeUndefined();
  });

  it('does not promise a reset that has already gone', () => {
    const stale = new Date('2026-09-01T06:00:00+05:30');
    const note = allowanceNote({ known: true, remaining: 40, limit: 40, resetsAt: stale }, now);
    expect(note).toBe(
      "Most of today's allowance is still there. It comes back when the day rolls over.",
    );
  });

  it('says it could not read one rather than inventing a number', () => {
    expect(allowanceNote({ known: false, remaining: null, limit: null, resetsAt: null }, now)).toBe(
      'Sign in and this shows how much of today is left, and when it comes back.',
    );
  });
});
