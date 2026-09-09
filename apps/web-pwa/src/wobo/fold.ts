/**
 * When the phone sheet folds to its strip (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze and Trace).
 *
 * While the glass is held the page Wobo is drawing on is in front of the learner, not behind a
 * modal; and while the ink is still holding for an answer the sheet stays folded too, because
 * unfolding it puts the modal over the very marks the question is about (live at 390 the number
 * line ended behind the sheet on the turn's end). Never on a desktop, never when closed.
 */
export interface FoldSignals {
  open: boolean;
  held: boolean;
  inkHolding: boolean;
  width: number;
}

/** Narrower than this is a phone: the sheet is a modal there, so it folds. */
export const FOLD_BELOW_PX = 720;

export function sheetFolded({ open, held, inkHolding, width }: FoldSignals): boolean {
  return open && (held || inkHolding) && width < FOLD_BELOW_PX;
}

/** What the sheet is showing right now. */
export interface SheetParts {
  /** The header with Wobo's name, the mute and the two exits. */
  head: boolean;
  /** The transcript. */
  thread: boolean;
  /** The teach-it-back door. */
  teachBack: boolean;
  /** The row of mode chips. */
  modes: boolean;
  /** The ask row: the input, the mic, the ask button. */
  ask: boolean;
}

/**
 * A STRIP IS THE ASK ROW AND NOTHING ELSE (the adversary, 2026-09-09, finding 4).
 *
 * Wave 40 folded the sheet to a 128 px box pinned to the bottom of the screen and left every one
 * of its children mounted inside it: the transcript tail, the teach-back door and six mode chips.
 * They do not fit, so they pushed the ask row out of the bottom of the box — at 390 the input's
 * own rectangle was {x:15, y:904, w:321, h:43} in an 844 px viewport, 60 px BELOW the edge, and it
 * was still there after Escape and after scrolling the document to its end. The learner could not
 * ask a second question after Wobo drew: seven of the fifty-nine turns could not be taken at all,
 * and both 390 walks aborted with "Element is outside of the viewport" on a forced click.
 *
 * So the strip carries the one thing it is for. Everything else comes back the moment it unfolds.
 */
export function sheetParts(folded: boolean): SheetParts {
  return {
    head: !folded,
    thread: !folded,
    teachBack: !folded,
    modes: !folded,
    ask: true,
  };
}
