/**
 * AN ERROR BELONGS TO A CONTROL, and this holds the mapping that decides which.
 *
 * The bug this exists to stop is a real one, reproduced in Chromium on `/sign-up`: a valid phone
 * number, a valid date of birth, the consent box left unticked, and the button pressed. The page
 * marked the PHONE FIELD `aria-invalid`, pointed its `aria-describedby` at "I need you to agree to
 * the terms and the privacy policy first", and left the checkbox — the one thing that was actually
 * wrong — with no marking at all. A screen-reader user was told their correct answer was invalid
 * and handed an explanation of something else.
 *
 * So every refusal names its control, and a failure that belongs to no control says so.
 */

import { describe, expect, it } from 'bun:test';
import type { BlockReason } from './age';
import type { FieldProblem } from './field';
import { marks, type Problem, type Where, whereBlocked, whereField } from './problem';

describe('every refusal names the control it is about', () => {
  it('sends both kinds of birth-date refusal to the birth field', () => {
    expect(whereBlocked('birth')).toBe('birth');
    expect(whereBlocked('birth-invalid')).toBe('birth');
  });

  it('sends the consent refusal to the tick, and never to whatever else is on the page', () => {
    expect(whereBlocked('agree')).toBe('consent');
    expect(whereBlocked('agree')).not.toBe('who');
  });

  it("sends the parent's address to the parent's field", () => {
    expect(whereBlocked('parent-email')).toBe('parent-email');
  });

  it('gives every reason a place, so none of them can fall back on the ruled field', () => {
    const reasons: Exclude<BlockReason, null>[] = [
      'birth',
      'birth-invalid',
      'parent-email',
      'agree',
    ];
    for (const reason of reasons) {
      expect([reason, whereBlocked(reason)]).not.toEqual([reason, 'who']);
      expect([reason, whereBlocked(reason)]).not.toEqual([reason, 'form']);
    }
  });

  it('sends a problem with what was typed into the one ruled line to that line', () => {
    const problems: FieldProblem[] = ['who', 'email', 'phone'];
    for (const problem of problems) expect(whereField(problem)).toBe('who');
  });
});

describe('what gets marked invalid', () => {
  const consent: Problem = { message: 'I need you to agree.', where: 'consent' };

  it('marks the control the sentence is about, and only that one', () => {
    expect(marks(consent, 'consent')).toBe(true);
    for (const where of ['who', 'birth', 'parent-email', 'password', 'code', 'form'] as Where[]) {
      expect([where, marks(consent, where)]).toEqual([where, false]);
    }
  });

  it('marks nothing at all for a failure that belongs to no field', () => {
    // A network that never answered is not something the learner typed wrongly, so nothing they
    // typed is painted rose and no input claims to be invalid.
    const network: Problem = { message: 'I cannot reach the account service.', where: 'form' };
    for (const where of ['who', 'birth', 'parent-email', 'password', 'code'] as Where[]) {
      expect([where, marks(network, where)]).toEqual([where, false]);
    }
  });

  it('marks nothing when there is no problem', () => {
    for (const where of ['who', 'consent', 'birth', 'form'] as Where[]) {
      expect([where, marks(null, where)]).toEqual([where, false]);
    }
  });
});

describe('the screen cannot go back to one error for the whole page', () => {
  const SOURCE = Bun.file(new URL('./Auth.tsx', import.meta.url).pathname);

  it('never spreads data-invalid or aria-invalid from a bare error', async () => {
    const source = await SOURCE.text();
    // The exact shapes the bug wore: `{...(error ? { 'data-invalid': 'true' } : {})}` and its
    // aria twin. Every mark on this screen goes through `wrong()` / `invalid()`, which take a
    // place; there is nowhere for a bare `error` to reach a control from.
    expect(source).not.toMatch(/error \? \{ 'data-invalid'/);
    expect(source).not.toMatch(/error \? \{ 'aria-invalid'/);
    expect(source).not.toMatch(/aria-describedby=\{error \?/);
  });
});
