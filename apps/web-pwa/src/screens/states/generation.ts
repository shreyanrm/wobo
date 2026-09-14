/**
 * When a wait is worth the whole screen.
 *
 * This file used to hold the words a wait said: four stages ("Writing the lesson", "Drawing the
 * visuals", "Checking every answer", "Almost ready") and five handwritten lines about pencils and
 * ink. They are gone, and nothing replaced them in words. A wait shows the orb doing the subject's
 * thing and says nothing at all: never a percentage, never "generating", never a sentence about
 * what Wobo is doing (docs/EMAILS-AND-ANIMATIONS.md §3; DESIGN.md §0.x).
 *
 * What a wait is owed by its LENGTH — the breath under two seconds, the subject's scene up to ten,
 * the game past it — is the same law everywhere and lives with the scenes themselves, in
 * `@wobo/wobo` (`waitLength`, docs/THE-WAIT.md §1). What lives here is the one decision that is
 * this app's own: when a background compose stops being a pill in the corner and becomes a screen.
 */

/**
 * How long a wait has to run before it is worth taking over the screen for.
 *
 * Under this, the toast is the right amount of product: the learner is browsing and something is
 * being made for them in the background. Past it, a learner who has chosen to wait deserves Wobo's
 * company rather than a pill in the corner.
 */
export const LONG_WAIT_MS = 4_000;

/** True when a compose that started at `startedAt` has been running long enough to fill a screen. */
export function isLongWait(startedAt: number, now: number): boolean {
  return now - startedAt >= LONG_WAIT_MS;
}
