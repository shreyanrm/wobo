/**
 * The one field, and the detail that is the point of the design: the glyph becomes a phone the
 * moment what is typed reads like a number, and the keyboard changes with it.
 */

import { describe, expect, it } from 'bun:test';
import { fieldProblem, fieldShape, looksLikeFullPhone, looksLikePhone } from './field';

describe('the glyph follows what is being typed', () => {
  it('is an envelope until the value reads like a number', () => {
    expect(fieldShape('both', '').glyph).toBe('envelope');
    expect(fieldShape('both', 'me@example.com').glyph).toBe('envelope');
    expect(fieldShape('both', '+91 98765 43210').glyph).toBe('phone');
    expect(fieldShape('both', '9876543210').glyph).toBe('phone');
  });

  it('switches the keyboard with it, so the right one opens on a phone', () => {
    expect(fieldShape('both', 'me@example.com').inputMode).toBe('email');
    expect(fieldShape('both', '+91 98').inputMode).toBe('tel');
  });

  it('does not flicker half way through a number', () => {
    for (const partial of ['+', '+9', '+91', '+91 9', '+91 98765']) {
      expect([partial, looksLikePhone(partial)]).toEqual([partial, true]);
    }
  });

  it('lets a password manager fill either identity, where the field accepts either', () => {
    expect(fieldShape('both', '').autoComplete).toBe('username');
    expect(fieldShape('phone', '').autoComplete).toBe('tel');
    expect(fieldShape('email', '').autoComplete).toBe('email');
  });
});

describe('a field that can only send one thing says only that', () => {
  it('keeps the phone glyph and the tel keyboard when a code is all that can be sent', () => {
    // An address typed in here could not be sent anywhere, so the field never invites one.
    const shape = fieldShape('phone', 'me@example.com');
    expect([shape.glyph, shape.inputMode, shape.sends]).toEqual(['phone', 'tel', 'code']);
  });

  it('keeps the envelope when a link is all that can be sent', () => {
    const shape = fieldShape('email', '9876543210');
    expect([shape.glyph, shape.inputMode, shape.sends]).toEqual(['envelope', 'email', 'link']);
  });

  it('sends nothing when nothing is wired', () => {
    expect(fieldShape('none', 'me@example.com').sends).toBeNull();
  });
});

describe('what the field will not send', () => {
  it('wants a number that is long enough to be a number', () => {
    expect(looksLikeFullPhone('+91 98765 43210')).toBe(true);
    expect(looksLikeFullPhone('12345')).toBe(false);
    expect(looksLikeFullPhone('1234567890123456')).toBe(false);
  });

  it('names the problem in the words the field asked in', () => {
    expect(fieldProblem('phone', '')).toBe('phone');
    expect(fieldProblem('email', '')).toBe('email');
    expect(fieldProblem('both', '')).toBe('who');
    expect(fieldProblem('none', 'anything')).toBe('who');
  });

  it('lets a good value through', () => {
    expect(fieldProblem('phone', '+91 98765 43210')).toBeNull();
    expect(fieldProblem('email', 'me@example.com')).toBeNull();
    expect(fieldProblem('both', '+91 98765 43210')).toBeNull();
    expect(fieldProblem('both', 'me@example.com')).toBeNull();
  });

  it('catches the half-typed value that would fail at the service instead', () => {
    expect(fieldProblem('both', '+91 98')).toBe('phone');
    expect(fieldProblem('both', 'me@')).toBe('email');
  });
});
