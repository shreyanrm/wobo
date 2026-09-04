'use client';

/**
 * OPENING WOBO'S DRAWER FROM SOMEWHERE ELSE.
 *
 * The drawer had exactly one opener: a tap on the orb. That was fine while every turn in it was
 * one the learner had started. It stopped being fine the moment the re-teach ladder began asking
 * Wobo for a second explanation on the learner's behalf: the child read "let me show this a
 * different way, I will work one all the way through" on the workbook, the same three items stayed
 * on screen, and the worked example landed in a closed drawer they had no reason to open. Six of
 * the seven rungs went there. The teaching was real and the learner never saw it.
 *
 * So the drawer has a second opener, and it is this. A signal, not a store: whoever is showing the
 * drawer subscribes, and anything that has just put something in it for the learner to read calls
 * `openCompanion`. It carries a reason so the drawer can be told apart from a tap later if it ever
 * needs to be, and so this file never becomes a general remote control for the UI.
 *
 * It deliberately holds no state. A surface that mounts after the call has missed it, which is
 * correct: a request to open a drawer is about this moment, and replaying it on the next mount
 * would pop the drawer open at random.
 */

/** Why the drawer is being opened for the learner rather than by them. */
export type CompanionOpenReason = 'reteach';

export interface CompanionOpenRequest {
  reason: CompanionOpenReason;
  /** What Wobo has just been asked, for a surface that wants to say why it opened. */
  ask?: string;
}

const listeners = new Set<(request: CompanionOpenRequest) => void>();

/**
 * Show the learner the drawer, because something has just been put in it for them.
 *
 * Never call this to get attention: it takes the screen away from whatever the learner was doing.
 * The one caller today is the re-teach ladder, which has just written a new explanation there.
 */
export function openCompanion(request: CompanionOpenRequest): void {
  for (const listener of [...listeners]) {
    try {
      listener(request);
    } catch {
      // one surface refusing to open must never stop another, and must never fail the lesson
    }
  }
}

/** The drawer subscribes here. Returns the unsubscribe. */
export function subscribeCompanionOpen(
  listener: (request: CompanionOpenRequest) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: nothing is listening between one case and the next. */
export function resetCompanionOpen(): void {
  listeners.clear();
}
