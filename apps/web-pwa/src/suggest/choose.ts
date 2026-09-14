/**
 * THE ARBITER: at most one suggestion on screen at a time.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §2. Four kinds can be true at the same moment on the same screen
 * — a learner who has been held up twice, on a page with two answerable questions, at the end of a
 * topic that sits beside a bonus level — and four offers at once is not four suggestions, it is a
 * menu. So the choosing is a rule, held here, and the screen is handed one or nothing.
 *
 * THE ORDER, AND WHY IT IS THAT ORDER.
 *
 *   the way back   first, because it is the only one offered to somebody who cannot get in. A
 *                  learner held up on an idea has no use for what comes after it.
 *   the question   second, because it is about the page they are looking at right now, and it is
 *                  the only kind that hands the next move to the learner rather than taking it.
 *   the next thing third: it is about what comes after this, so it can wait for this.
 *   the side door  last, always. It is the only one off the climb, and it is the only one whose
 *                  whole promise is that nothing is lost by ignoring it.
 *
 * A declined suggestion is dropped here rather than at the point it is built, so a screen never has
 * to remember what it already offered.
 */

import type { Suggestion, SuggestionKind } from './kind';
import { wasDeclined } from './session';

export const PRIORITY: readonly SuggestionKind[] = ['way_back', 'ask', 'next', 'side_door'];

/**
 * One suggestion, or nothing. Nothing is the ordinary answer on most screens most of the time, and
 * it is the right one: silence is what a tutor does when there is nothing worth saying.
 */
export function choose(
  candidates: readonly (Suggestion | null | undefined)[],
): Suggestion | null {
  const live = candidates.filter((s): s is Suggestion => !!s && !wasDeclined(s.id));
  for (const kind of PRIORITY) {
    const found = live.find((s) => s.kind === kind);
    if (found) return found;
  }
  return null;
}
