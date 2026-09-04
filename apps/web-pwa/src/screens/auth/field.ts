/**
 * THE one field, and what it becomes as you type in it.
 *
 * The field on this screen is not a box, it is a ruled line you write on — which is what this whole
 * product is about — and the glyph at the head of that line is not decoration. It follows what is
 * being typed: the moment the value reads like a number it BECOMES a phone, and the input's
 * `inputmode` changes with it so the right keyboard opens on a phone rather than the wrong one.
 * That detail is the point of the design, so it lives here where it can be tested, and not in an
 * event handler where it cannot.
 *
 * Everything else about the field follows from which seams are actually wired (`doors.ts`): a field
 * that can only send a code asks for a number and says so, a field that can only send a link asks
 * for an address, and only a build with both offers both. A field that accepts something the app
 * cannot act on is a form that fails on submit, which is the worst way for anybody to find out.
 */

import { looksLikeEmail } from './age';
import type { IdentifierKind } from './doors';

export type Glyph = 'envelope' | 'phone';
/** What pressing the primary button will actually send. */
export type Send = 'code' | 'link';

/**
 * A value that reads like a phone number: a digit or a leading `+`, then digits and the separators
 * people really type. Deliberately loose — this decides which GLYPH to draw, not whether the number
 * is real, and a learner half way through typing `+91 98` must not watch the glyph flicker.
 */
export const PHONE_SHAPE = /^[+\d][\d\s()-]*$/;

export function looksLikePhone(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && PHONE_SHAPE.test(v);
}

/** Digits only, which is the part of a number that has to be there. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A number long enough to be a number. Seven is the shortest national subscriber number in use and
 * fifteen is E.164's ceiling; between them we hand it to the service, which is the only thing that
 * can really say.
 */
export function looksLikeFullPhone(value: string): boolean {
  if (!looksLikePhone(value)) return false;
  const digits = phoneDigits(value);
  return digits.length >= 7 && digits.length <= 15;
}

export interface FieldShape {
  glyph: Glyph;
  /** Which keyboard opens on a phone. */
  inputMode: 'tel' | 'email';
  autoComplete: 'tel' | 'email' | 'username';
  /** What the button under the field will send, or null when the value cannot be sent at all. */
  sends: Send | null;
}

/**
 * The field as it stands right now, given what is wired and what has been typed.
 *
 * `kind` is the floor: a build with only a phone seam keeps the phone glyph and the tel keyboard
 * whatever is typed, because an address typed into it could not be sent anywhere.
 */
export function fieldShape(kind: IdentifierKind, value: string): FieldShape {
  if (kind === 'phone') {
    return { glyph: 'phone', inputMode: 'tel', autoComplete: 'tel', sends: 'code' };
  }
  if (kind === 'email') {
    return { glyph: 'envelope', inputMode: 'email', autoComplete: 'email', sends: 'link' };
  }
  if (kind === 'none') {
    return { glyph: 'envelope', inputMode: 'email', autoComplete: 'email', sends: null };
  }
  const phone = looksLikePhone(value);
  return {
    glyph: phone ? 'phone' : 'envelope',
    inputMode: phone ? 'tel' : 'email',
    // One field for two identities: `username` is the token that lets a password manager fill
    // either, where `tel` or `email` would make it offer only one of them.
    autoComplete: 'username',
    sends: phone ? 'code' : 'link',
  };
}

/** Which error a value in this field would raise, or null when it is good enough to send. */
export type FieldProblem = 'who' | 'email' | 'phone';

export function fieldProblem(kind: IdentifierKind, value: string): FieldProblem | null {
  const v = value.trim();
  const shape = fieldShape(kind, v);
  if (shape.sends === null) return 'who';
  if (!v) return kind === 'phone' ? 'phone' : kind === 'email' ? 'email' : 'who';
  if (shape.sends === 'code') return looksLikeFullPhone(v) ? null : 'phone';
  return looksLikeEmail(v) ? null : 'email';
}
