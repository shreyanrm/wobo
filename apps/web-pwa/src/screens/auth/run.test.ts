/**
 * The run's three silent decisions, held: where a reload lands, where back goes, and which
 * finished steps the stepper may offer as a way back.
 */

import { describe, expect, it } from 'bun:test';
import {
  backOf,
  canReturnTo,
  clearStep,
  landingAfterDoor,
  profileComplete,
  providerReturn,
  RUN_STEP_KEY,
  RUN_STEPS,
  readSavedStep,
  restoreStep,
  STEP_NAMES,
  type StepStore,
  saveStep,
} from './run';

function memory(): StepStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const SAVED = { name: 'A', grade: 'Class 8', boardId: 'cbse' };
const BLANK = { name: '', grade: '', boardId: '' };

describe('where a reload lands', () => {
  it('is the door whenever there is a door and nobody is through it, whatever was saved', () => {
    for (const saved of [null, ...RUN_STEPS]) {
      expect(restoreStep(saved, { canAuth: true, signedIn: false, profileComplete: true })).toBe(1);
    }
  });

  it('is the second step when nothing was saved, or when only the door was', () => {
    const in_ = { canAuth: true, signedIn: true, profileComplete: false };
    expect(restoreStep(null, in_)).toBe(2);
    expect(restoreStep(1, in_)).toBe(2);
    // and a build with no account layer at all opens there too: the door is bypassed by config
    expect(restoreStep(null, { canAuth: false, signedIn: false, profileComplete: false })).toBe(2);
  });

  it('honours a saved later step only when the answers it rests on are saved', () => {
    const answered = { canAuth: true, signedIn: true, profileComplete: true };
    const unanswered = { canAuth: true, signedIn: true, profileComplete: false };
    for (const step of [3, 4, 5] as const) {
      expect(restoreStep(step, answered)).toBe(step);
      expect(restoreStep(step, unanswered)).toBe(2);
    }
  });

  it('counts a profile as complete only with a name, a class and a board', () => {
    expect(profileComplete(SAVED)).toBe(true);
    expect(profileComplete(BLANK)).toBe(false);
    expect(profileComplete({ ...SAVED, boardId: ' ' })).toBe(false);
    expect(profileComplete({ ...SAVED, name: '' })).toBe(false);
  });
});

describe('where back goes', () => {
  it('goes one step back from every step after the second', () => {
    expect(backOf(3)).toBe(2);
    expect(backOf(4)).toBe(3);
    expect(backOf(5)).toBe(4);
  });

  it('has nowhere to go from the door or from the first thing after it', () => {
    expect(backOf(1)).toBeNull();
    expect(backOf(2)).toBeNull();
  });

  it('lets the stepper offer a finished step, but never the door', () => {
    expect(canReturnTo(1, 4)).toBe(false);
    expect(canReturnTo(2, 4)).toBe(true);
    expect(canReturnTo(3, 4)).toBe(true);
    expect(canReturnTo(4, 4)).toBe(false);
    expect(canReturnTo(5, 4)).toBe(false);
  });
});

describe('what is written down', () => {
  it('saves a step past the door and reads it back', () => {
    const store = memory();
    saveStep(store, 3);
    expect(store.data.get(RUN_STEP_KEY)).toBe('3');
    expect(readSavedStep(store)).toBe(3);
  });

  it('never saves the door: a reload at the door is the door', () => {
    const store = memory();
    saveStep(store, 4);
    saveStep(store, 1);
    expect(readSavedStep(store)).toBeNull();
  });

  it('ignores anything that is not a step', () => {
    const store = memory();
    store.setItem(RUN_STEP_KEY, 'nine');
    expect(readSavedStep(store)).toBeNull();
    store.setItem(RUN_STEP_KEY, '7');
    expect(readSavedStep(store)).toBeNull();
  });

  it('clears on finish, and survives a storage that throws', () => {
    const store = memory();
    saveStep(store, 5);
    clearStep(store);
    expect(readSavedStep(store)).toBeNull();
    const broken: StepStore = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveStep(broken, 3)).not.toThrow();
    expect(() => clearStep(broken)).not.toThrow();
    expect(readSavedStep(broken)).toBeNull();
    expect(readSavedStep(null)).toBeNull();
  });

  it('names every beat in sentence case, with no invented learner in it', () => {
    for (const step of RUN_STEPS) {
      const name = STEP_NAMES[step];
      expect(name).toMatch(/^[a-z]/);
      expect(name).not.toMatch(/[A-Z]/);
    }
  });

  it("names every beat in a learner's words, never in this codebase's", () => {
    // "the door" is what this repo calls the sign-up screen; a screen reader on /sign-up announced
    // "Setting up, step 1 of 5, the door". A learner has no door; they have an account to make.
    for (const step of RUN_STEPS) {
      expect([step, /door|beat|aha|run\b/i.test(STEP_NAMES[step])]).toEqual([step, false]);
    }
    expect(STEP_NAMES[1]).toBe('your account');
  });
});

describe('what the door does the moment somebody is signed in', () => {
  const origin = 'https://wobo.example';
  it('under live auth, leaves the page: a new document is how the stores get keyed to the session', () => {
    // A provider round trip lands on the run's own address; a code typed at the door lands there too.
    expect(
      landingAfterDoor({
        devAuth: false,
        mode: 'sign-up',
        run: { redirectTo: `${origin}/onboarding` },
        origin,
      }),
    ).toEqual({ leave: `${origin}/onboarding` });
    expect(landingAfterDoor({ devAuth: false, mode: 'sign-in', run: null, origin })).toEqual({
      leave: `${origin}/onboarding`,
    });
    expect(landingAfterDoor({ devAuth: false, mode: 'sign-up', run: null, origin })).toEqual({
      leave: `${origin}/onboarding`,
    });
  });
  /**
   * THE PROVIDER COMES BACK WHERE THE CODE DOES. The doors handed the provider `${origin}/`, which
   * is a PUBLIC route: `App.tsx` picks the first screen from the onboarded sentinel alone, so a
   * phone with none — a new device, or the same device after a sign-out, which empties it — drew
   * the marketing page to somebody who had just signed in, with the app runtime never mounted.
   */
  it('sends a provider round trip to a route the runtime owns, never the bare origin', () => {
    expect(providerReturn({ run: null, origin })).toBe(`${origin}/onboarding`);
    expect(providerReturn({ run: null, origin })).not.toBe(`${origin}/`);
    // and the run's own address wins, so a door inside onboarding resumes itself
    expect(providerReturn({ run: { redirectTo: `${origin}/onboarding` }, origin })).toBe(
      `${origin}/onboarding`,
    );
  });

  it('is the same address a code or a password lands on', () => {
    const landing = landingAfterDoor({ devAuth: false, mode: 'sign-in', run: null, origin });
    expect(landing).toEqual({ leave: providerReturn({ run: null, origin }) });
  });

  it('under the dev mock, stays on the page: there is no session to re-key to', () => {
    expect(
      landingAfterDoor({
        devAuth: true,
        mode: 'sign-up',
        run: { redirectTo: `${origin}/onboarding` },
        origin,
      }),
    ).toEqual({ stay: 'run' });
    expect(landingAfterDoor({ devAuth: true, mode: 'sign-in', run: null, origin })).toEqual({
      stay: 'home',
    });
    expect(landingAfterDoor({ devAuth: true, mode: 'sign-up', run: null, origin })).toEqual({
      stay: 'onboarding',
    });
  });
});
