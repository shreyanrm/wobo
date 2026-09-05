'use client';

/**
 * THE ONE STEPPER, on the door and on every step after it.
 *
 * The sign-up door drew its own five pips and onboarding drew another five with different classes,
 * so the two were free to disagree about what step one looked like, and did. This is the only
 * stepper now, and it is a real control rather than a picture: a list, with the current beat marked
 * `aria-current`, and every finished beat a learner may return to drawn as a button that says where
 * it goes. A screen reader hears "setting up, step 3 of 5, a first question"; a keyboard reaches the
 * way back without hunting for it.
 *
 * The door is finished and is not a button. `run.ts` decides that, and is tested on it.
 */

import { canReturnTo, RUN_STEPS, type RunStep, STEP_NAMES } from './run';
import { ensureAuthStyles } from './styles';

ensureAuthStyles();

export function Steps({
  current,
  onBack,
}: {
  current: RunStep;
  /** Go back to a finished step. Without it, no pip is a button. */
  onBack?: (step: RunStep) => void;
}) {
  return (
    <nav
      className="au-steps"
      aria-label={`Setting up, step ${current} of 5, ${STEP_NAMES[current]}`}
    >
      <ol>
        {RUN_STEPS.map((step) => {
          const done = step < current;
          const on = step === current;
          const back = done && onBack && canReturnTo(step, current);
          const pip = <i className={on ? 'au-on' : done ? 'au-done' : undefined} />;
          return (
            <li key={step} {...(on ? { 'aria-current': 'step' as const } : {})}>
              {back ? (
                <button
                  type="button"
                  onClick={() => onBack(step)}
                  aria-label={`Back to step ${step}, ${STEP_NAMES[step]}`}
                >
                  {pip}
                </button>
              ) : (
                <span>
                  {pip}
                  <span className="au-sr">{`step ${step}, ${STEP_NAMES[step]}`}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
