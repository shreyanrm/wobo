/**
 * WHAT THE DOOR WRITES DOWN, so the two answers it asks for are not thrown away.
 *
 * The sign-up door asked for a date of birth and an agreement to the terms, ran the age gate on
 * both, and then dropped them: `fields.birth` and `fields.agreed` were component state, read by
 * `age.ts` and by nothing else. They were never saved to the profile, never sent to `syncProfile`,
 * never sent to the gateway. So the account carried no age and no record that the terms had been
 * accepted, and every consent gate `age.ts` describes — memory, voice, photographs, sharing under
 * 18 — had nothing to read. The gate was a question with no answer kept.
 *
 * The profile is where the age already lives: `StoredProfile.birthdate` is documented as the
 * source of truth for age, and `ageFromBirthdate` derives the band off it. Nothing wrote it. This
 * does, at the moment the learner answers, under the learner's own storage scope — the door runs
 * before there is a subject, so it lands on the plain key and `inheritScope` moves it under the
 * first subject to claim the device (`store/scope.ts`), which is this learner.
 *
 * WHAT THIS DOES NOT DO: reach the account. `AccountLayer.syncProfile` takes a display name, a
 * class, a board and the onboarding sentinel and nothing else, so there is no column for a date of
 * birth or a consent record to go in. That is a schema this file does not own. The device record
 * is what makes the gate answerable at all, and it is the same store every other age-dependent
 * screen already reads.
 */

import type { StoredProfile } from '../you/profile';
import { loadProfile, saveProfile } from '../you/profile';
import { ageOn, type SignUpFields } from './age';

/** The least of the profile store this needs. Passed in, so a test needs no browser. */
export interface ProfileStore {
  load(): StoredProfile;
  save(profile: StoredProfile): void;
}

/** The device's own profile, which is the default and the only one the screen uses. */
export const deviceProfile: ProfileStore = { load: loadProfile, save: saveProfile };

/**
 * The two answers, written on to whatever the profile already holds. Never destructive: a name, a
 * class and a board saved by an earlier run stay exactly as they were.
 *
 * `agreed` is written as an INSTANT rather than a flag, because "they ticked it" is not the useful
 * fact — "they ticked it on this date, against the terms as they stood then" is, and it is what
 * `parental-consent.md` §4 says a consent record has to be able to show.
 */
export function rememberSignUp(
  fields: SignUpFields,
  store: ProfileStore = deviceProfile,
  now: Date = new Date(),
): void {
  const held = store.load();
  const age = ageOn(fields.birth, now);
  store.save({
    ...held,
    ...(fields.birth ? { birthdate: fields.birth } : {}),
    ...(age === null ? {} : { age }),
    ...(fields.agreed ? { termsAcceptedAt: now.toISOString() } : {}),
  });
}
