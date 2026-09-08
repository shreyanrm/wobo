/**
 * THE AGE GATE KEEPS ITS ANSWERS.
 *
 * The sign-up door asked for a date of birth and an agreement to the terms, ran the whole branch
 * off them, and then threw both away: `fields.birth` and `fields.agreed` were component state read
 * by `age.ts` and by nothing else, never saved to the profile and never sent anywhere. So the
 * account carried no age and no record that the terms were accepted, and every consent gate the
 * age module describes — memory, voice, photographs, sharing under 18 — had nothing to read. A
 * question whose answer is discarded is a decoration.
 */

import { describe, expect, it } from 'bun:test';
import type { StoredProfile } from '../you/profile';
import type { SignUpFields } from './age';
import { type ProfileStore, rememberSignUp } from './record';

const NOW = new Date('2026-09-07T10:00:00.000Z');

function store(seed: Partial<StoredProfile> = {}): ProfileStore & { held: StoredProfile } {
  const held: StoredProfile = { name: '', grade: '', boardId: '', ...seed };
  return {
    held,
    load: () => ({ ...held }),
    save: (p) => Object.assign(held, p),
  };
}

const answered = (over: Partial<SignUpFields> = {}): SignUpFields => ({
  birth: '2012-06-01',
  parentContact: '',
  agreed: true,
  ...over,
});

describe('what the door writes down', () => {
  it('keeps the date of birth, which is what every age branch reads back', () => {
    const s = store();
    rememberSignUp(answered(), s, NOW);
    expect(s.held.birthdate).toBe('2012-06-01');
    expect(s.held.age).toBe(14);
  });

  it('keeps WHEN the terms were agreed to, not merely that they were', () => {
    // parental-consent.md §4: a consent record has to be able to show what was agreed and when.
    const s = store();
    rememberSignUp(answered(), s, NOW);
    expect(s.held.termsAcceptedAt).toBe(NOW.toISOString());
  });

  it('writes no agreement where no box was ticked', () => {
    const s = store();
    rememberSignUp(answered({ agreed: false }), s, NOW);
    expect(s.held.termsAcceptedAt).toBeUndefined();
  });

  it('never overwrites what an earlier run already saved', () => {
    const s = store({ name: 'Asha', grade: '8', boardId: 'cbse' });
    rememberSignUp(answered(), s, NOW);
    expect([s.held.name, s.held.grade, s.held.boardId]).toEqual(['Asha', '8', 'cbse']);
  });

  it('holds its peace about an age it could not read', () => {
    const s = store();
    rememberSignUp(answered({ birth: 'nonsense' }), s, NOW);
    expect(s.held.age).toBeUndefined();
  });
});
