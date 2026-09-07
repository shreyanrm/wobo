/**
 * The referral code that travels in an invite link.
 *
 * An invite is copied into WhatsApp, pasted into a class group, forwarded on. Whatever rides in the
 * URL is public — so it must not be the child. The link used to carry the learner's real name
 * (`?via=asha-mehta`), which put a minor's name into every forwarded message and every referrer
 * header downstream. It now carries an opaque code that means nothing outside this device: it
 * identifies the invitation, never the person.
 *
 * The code is stable per learner (the same learner's links stay the same, so a re-copy is not a
 * new identity). For a signed-in learner it is the ACCOUNT's: derived from the subject id, so it is
 * the same on every phone and comes back after a sign-out, and every invite they ever forwarded
 * keeps attributing to them. It used to be minted per device scope and swept at sign-out, which
 * gave one learner a new code every time they signed back in (seen in a browser, 2026-09-07). An
 * anonymous learner has no account yet, so theirs is minted on the device, keyed to them through
 * store/scope.ts, and leaves with them.
 *
 * Derived, not stored: there is no account record for it yet, and a derivation needs none. It is a
 * one-way hash truncated to 40 bits, so the code says nothing about the subject id, and the id
 * alone opens nothing anyway.
 */

import { rememberedScope, scoped } from './scope';

const REFERRAL_KEY = 'wobo-referral-code-v1';
/** 8 chars of base32 — ~40 bits: collision-free at any plausible scale, still short enough to read. */
const CODE_LENGTH = 8;
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/i/l/o — a code gets read aloud

/** A fresh opaque code. Pure: pass the byte source, get the code. */
export function newReferralCode(bytes: Uint8Array): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return code;
}

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(CODE_LENGTH);
  try {
    crypto.getRandomValues(bytes);
    return bytes;
  } catch {
    // No WebCrypto (very old browser, exotic embedding): a code that is merely unguessable-enough
    // is still infinitely better than the learner's name.
    for (let i = 0; i < CODE_LENGTH; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }
}

/** FNV-1a, 64-bit, over the UTF-8 bytes. Pure and synchronous, which a render can call. */
function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

/** The account's code: the same subject id gives the same code, anywhere, forever. */
export function derivedReferralCode(subjectId: string): string {
  const hash = fnv1a64(`wobo-referral:${subjectId}`);
  const bytes = new Uint8Array(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i += 1) bytes[i] = Number((hash >> BigInt(i * 8)) & 0xffn);
  return newReferralCode(bytes);
}

/**
 * This learner's referral code: the account's when they have one, otherwise minted on the device
 * on first use. A refused write (private mode) means an anonymous code is per call rather than
 * stable; the invitation still works.
 */
export function referralCode(): string {
  const who = rememberedScope();
  if (who && !who.anonymous) return derivedReferralCode(who.subject);
  const existing = scoped.getItem(REFERRAL_KEY);
  if (existing) return existing;
  const code = newReferralCode(randomBytes());
  scoped.setItem(REFERRAL_KEY, code);
  return code;
}

/** The invite URL for a kind of guest. The only place an invite link is built. */
export function inviteLink(origin: string, kind: 'friend' | 'parent', code: string): string {
  const params = new URLSearchParams({ via: code, as: kind });
  return `${origin.replace(/\/+$/, '')}/join?${params.toString()}`;
}
