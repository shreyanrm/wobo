/**
 * WHICH CONTROL an error belongs to.
 *
 * The doors used to hold one `error` string and paint every field from it. That is wrong in a way
 * a sighted reader can shrug off and a screen-reader user cannot: pressing "Create my account"
 * with a perfectly good phone number and an unticked consent box set `aria-invalid` on the PHONE
 * FIELD, pointed its `aria-describedby` at a sentence about the terms, and left the box that was
 * actually wrong unmarked. The person is told their correct answer is invalid and handed an
 * explanation of something else.
 *
 * So an error carries a place as well as a sentence. `Where` is the control the sentence is about;
 * `'form'` is the honest answer for a failure that belongs to no single field (the network went
 * away, a seam is missing), and nothing is marked invalid for one of those, because nothing the
 * learner typed was.
 */

import type { BlockReason } from './age';
import type { FieldProblem } from './field';

/** The controls on these two doors that can be wrong, plus the whole-form case. */
export type Where = 'who' | 'password' | 'birth' | 'parent-contact' | 'consent' | 'code' | 'form';

/** A sentence, and the control it is about. */
export interface Problem {
  message: string;
  where: Where;
}

/**
 * Where a sign-up gate's refusal belongs. `blockedBy` names the reason; this names the control,
 * and they are deliberately not the same word: both missing and malformed dates are the birth
 * field, and "agree" is a checkbox rather than a field at all.
 */
export function whereBlocked(reason: Exclude<BlockReason, null>): Where {
  switch (reason) {
    case 'birth':
    case 'birth-invalid':
      return 'birth';
    case 'parent-contact':
      return 'parent-contact';
    case 'agree':
      return 'consent';
  }
}

/** Where a problem with the one ruled field belongs. Every one of them is that field. */
export function whereField(_problem: FieldProblem): Where {
  return 'who';
}

/** Whether a control should be marked invalid, given the problem the page is holding. */
export function marks(problem: Problem | null, where: Where): boolean {
  return problem !== null && problem.where === where;
}

/**
 * THE CONTROL A REFUSAL SENDS FOCUS TO, by its id on the page.
 *
 * A sentence with nobody's attention on it is a sentence a learner can miss. Pressing the button
 * with an empty field used to say nothing at all; now it says one line and puts the caret in the
 * field the line is about, so the next keystroke is the fix. A failure that belongs to the whole
 * form has nowhere to send focus, and sends it nowhere.
 */
export function controlOf(where: Where): string | null {
  switch (where) {
    case 'who':
      return 'au-who';
    case 'password':
      return 'au-password';
    case 'birth':
      return 'au-birth';
    case 'parent-contact':
      return 'au-parent';
    case 'consent':
      return 'au-agree';
    case 'code':
      return 'au-code';
    case 'form':
      return null;
  }
}
