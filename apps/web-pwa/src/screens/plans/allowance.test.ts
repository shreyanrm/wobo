/**
 * The allowance widget reads the real budget or says nothing. It must never invent a number.
 */

import { describe, expect, it } from 'bun:test';
import type { Me } from '@wobo/sdk';
import { allowanceLine, allowanceShare, readAllowance } from './allowance';

const me = (
  turns: { used: number | null; limit: number | null; remaining: number | null },
  resetAt: string | null,
): Me => ({
  subject: 'learner',
  anonymous: false,
  plan: 'free',
  consentTier: null,
  budget: { turns, generations: { used: null, limit: null, remaining: null }, resetAt },
});

const at = (d: Date): string => `${d.getUTCHours()}:00`;

describe('readAllowance', () => {
  it('reads what is left and when it comes back', () => {
    const a = readAllowance(me({ used: 8, limit: 20, remaining: 12 }, '2026-09-04T00:00:00Z'));
    expect(a).toMatchObject({ known: true, remaining: 12, limit: 20 });
    expect(a.resetsAt?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });

  it('works out what is left where the brain sent only a limit and a count', () => {
    expect(readAllowance(me({ used: 3, limit: 5, remaining: null }, null)).remaining).toBe(2);
  });

  it('never goes below zero', () => {
    expect(readAllowance(me({ used: 9, limit: 5, remaining: null }, null)).remaining).toBe(0);
  });

  it('is unknown where there is no answer at all', () => {
    expect(readAllowance(null)).toEqual({
      known: false,
      remaining: null,
      limit: null,
      resetsAt: null,
    });
  });

  it('ignores a reset instant it cannot read', () => {
    expect(readAllowance(me({ used: 1, limit: 2, remaining: 1 }, 'soon')).resetsAt).toBe(null);
  });
});

describe('allowanceLine', () => {
  it('says how much of today is left, and when it comes back', () => {
    const a = readAllowance(me({ used: 2, limit: 20, remaining: 18 }, '2026-09-04T05:00:00Z'));
    expect(allowanceLine(a, at)).toBe(
      "Most of today's allowance is still there. It comes back at 5:00.",
    );
  });

  it('drops a step as the day is spent', () => {
    const half = readAllowance(me({ used: 10, limit: 20, remaining: 10 }, null));
    expect(allowanceLine(half, at)).toBe(
      "About half of today's allowance is left. It comes back when the day rolls over.",
    );
    const nearly = readAllowance(me({ used: 19, limit: 20, remaining: 1 }, null));
    expect(allowanceLine(nearly, at)).toBe(
      "Today's allowance is nearly used up. It comes back when the day rolls over.",
    );
  });

  it('says the day is spent', () => {
    const a = readAllowance(me({ used: 20, limit: 20, remaining: 0 }, null));
    expect(allowanceLine(a, at)).toBe(
      "Today's allowance is used up. It comes back when the day rolls over.",
    );
  });

  it('admits when it cannot see the budget', () => {
    expect(allowanceLine(readAllowance(null), at)).toBe(
      'Sign in and this shows how much of today is left, and when it comes back.',
    );
  });

  it('lets a signed-in surface say the unknown in its own words, and never says "sign in" there', () => {
    // onboarding's last step is reached only through the door; "Sign in and this shows..." was
    // the sentence under its bar
    const own = 'This fills in as we go.';
    expect(allowanceLine(readAllowance(null), at, own)).toBe(own);
    expect(
      allowanceLine(readAllowance(me({ used: 3, limit: null, remaining: null }, null)), at, own),
    ).toBe(own);
    // a known reading ignores it
    const known = readAllowance(me({ used: 2, limit: 20, remaining: 18 }, null));
    expect(allowanceLine(known, at, own)).not.toBe(own);
    // and nothing could be drawn for the unknown, so a bar must not be
    expect(allowanceShare(readAllowance(null))).toBeNull();
  });

  /** Law v5 (DESIGN.md §0): no raw allowance reaches a reader, on any reading. */
  it('never states a raw allowance', () => {
    const readings = [
      readAllowance(null),
      readAllowance(me({ used: 0, limit: 40, remaining: 40 }, null)),
      readAllowance(me({ used: 20, limit: 40, remaining: 20 }, null)),
      readAllowance(me({ used: 39, limit: 40, remaining: 1 }, null)),
      readAllowance(me({ used: 40, limit: 40, remaining: 0 }, null)),
      readAllowance(me({ used: 3, limit: null, remaining: null }, null)),
    ];
    for (const reading of readings) {
      expect(allowanceLine(reading, at)).not.toMatch(/\d+\s*(turns?|questions?)|\bof \d+/);
    }
  });
});
