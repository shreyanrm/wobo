/**
 * THE RUN: the five beats a new learner walks, from the door to the first lesson.
 *
 * The sign-up door is the first of them and onboarding holds the other four, so the shape of the
 * run lives here, between the two, where both read it and neither can drift. It is a plain module
 * with no React in it, because three of its decisions are the kind that break silently:
 *
 *  · WHERE A RELOAD LANDS. A learner who reloads halfway through must land where they were, and
 *    never somewhere they have not earned: a step past the questions needs the answers saved, and
 *    a step past the door needs somebody actually signed in. An anonymous session is not somebody
 *    signed in; it is the brain's way of budgeting a stranger, and the door still has to be walked.
 *  · WHERE BACK GOES. Every step after the second has a way back to the one before it. The door
 *    is the exception: once you are in, there is no step "before" being in.
 *  · WHICH STEPS THE STEPPER MAY OFFER. A finished step is a place you can return to, and it is
 *    drawn as a button only when it is. The door is finished and is not.
 */

export const RUN_STEPS = [1, 2, 3, 4, 5] as const;
export type RunStep = (typeof RUN_STEPS)[number];

/**
 * What each beat is, for a screen reader and for the stepper's labels. Sentence case, no names, and
 * in a LEARNER's words: "the door" is what this codebase calls the sign-up screen, and a screen
 * reader on /sign-up announced it, so step one is named for what the learner is doing there.
 */
export const STEP_NAMES: Readonly<Record<RunStep, string>> = {
  1: 'your account',
  2: 'who is learning',
  3: 'a first question',
  4: 'a parent',
  5: 'ready',
};

/** Where the run is up to on this device. Cleared the moment the run finishes. */
export const RUN_STEP_KEY = 'wobo-onb-step-v1';

export function isRunStep(value: unknown): value is RunStep {
  return typeof value === 'number' && (RUN_STEPS as readonly number[]).includes(value);
}

/** The step before this one, or null when there is nothing to go back to. */
export function backOf(step: RunStep): RunStep | null {
  // The door is step one; step two is the first thing a signed-in learner does, and there is no
  // walking back out through a door you have already come in by.
  if (step <= 2) return null;
  return (step - 1) as RunStep;
}

/** Whether the stepper may offer a finished step as a place to return to. */
export function canReturnTo(step: RunStep, current: RunStep): boolean {
  return step >= 2 && step < current;
}

export interface Standing {
  /** This build has an account layer at all; without one the door is bypassed by configuration. */
  canAuth: boolean;
  /** Somebody is signed in. Not an anonymous session: that is a stranger with a budget. */
  signedIn: boolean;
  /** The second step's answers are saved: a name, a class and a board. */
  profileComplete: boolean;
}

/**
 * The step a fresh mount opens on, given what was saved and what is true.
 *
 * The door wins over everything: a build with an account layer and nobody signed in is at step
 * one whatever was saved, because a saved "4" from before a sign-out is not a place a signed-out
 * learner can stand. Past the door, a saved step is honoured as far as the answers allow.
 */
export function restoreStep(saved: RunStep | null, standing: Standing): RunStep {
  if (standing.canAuth && !standing.signedIn) return 1;
  if (saved === null || saved < 2) return 2;
  if (saved >= 3 && !standing.profileComplete) return 2;
  return saved;
}

/** The least of localStorage a screen needs. Passed in, so a test needs no window. */
export interface StepStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readSavedStep(store: StepStore | null): RunStep | null {
  if (!store) return null;
  try {
    const n = Number(store.getItem(RUN_STEP_KEY));
    return isRunStep(n) ? n : null;
  } catch {
    return null;
  }
}

/** Remember a step past the door. The door itself is never saved: a reload there is the door. */
export function saveStep(store: StepStore | null, step: RunStep): void {
  if (!store) return;
  try {
    if (step >= 2) store.setItem(RUN_STEP_KEY, String(step));
    else store.removeItem(RUN_STEP_KEY);
  } catch {
    // storage unavailable: the run lives for this session only
  }
}

export function clearStep(store: StepStore | null): void {
  if (!store) return;
  try {
    store.removeItem(RUN_STEP_KEY);
  } catch {
    // nothing to clear
  }
}

/** Where a name, a class and a board are all saved. The shape `loadProfile()` returns. */
export function profileComplete(p: { name: string; grade: string; boardId: string }): boolean {
  return p.name.trim().length > 0 && p.grade.trim().length > 0 && p.boardId.trim().length > 0;
}

/** What the door knows the moment a code or a password has signed somebody in. */
export interface DoorArrival {
  /** The dev mock is signed in by configuration; live auth has a real session that just landed. */
  devAuth: boolean;
  mode: 'sign-in' | 'sign-up';
  /** The run this door is the first step of, when it is one: where its provider round trip lands. */
  run: { redirectTo: string } | null;
  origin: string;
}

/**
 * Where the door goes once somebody is signed in: off the page, or on to the next screen.
 *
 * Under live auth it LEAVES THE PAGE, and that is the isolation half of the door. The SDK was built
 * before there was a session, so every store keyed to the subject (progress, the conversation, the
 * mastery evidence, the outbox) is still keyed to nobody: it writes the plain key, which is the key
 * the next learner's door-time SDK reads as their own, and none of it reaches the account. A new
 * document rebuilds the SDK on the session that just landed (`store/app-sdk.ts`), exactly as a
 * provider round trip already does; it lands on the run's own address, where `resumeAfterAuth`
 * reads the account back and sends a learner who has finished setup straight home.
 *
 * The dev mock has no session to re-key to, so it stays on the page as it always did.
 */
export function landingAfterDoor(
  arrival: DoorArrival,
): { leave: string } | { stay: 'run' | 'home' | 'onboarding' } {
  if (!arrival.devAuth) return { leave: arrival.run?.redirectTo ?? `${arrival.origin}/onboarding` };
  if (arrival.run) return { stay: 'run' };
  return { stay: arrival.mode === 'sign-up' ? 'onboarding' : 'home' };
}
