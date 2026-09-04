/**
 * THE BADGES ON THE REPORT — every one of them a fact something else already recorded.
 *
 * This lived inline in `ProgressSurfaces.tsx`, where nothing could execute it: the unit tests cover
 * `evidence.ts` and `sky.ts`, and the screenshots that "proved" the badges were taken from a bundle
 * that passed three hand-written literals in place of this function. One of those literals said
 * "every topic behind you" about a chapter the same image showed as 2 of 3 — a contradiction the
 * real derivation cannot produce, because it only ever names a chapter where `learnt === total`.
 * The derivation is here, and out here it can be tested; `badges.test.ts` is the test.
 *
 * THREE SOURCES, IN THIS ORDER, and nothing else may be added without a source of its own:
 *
 *   1. the week's own strengths (`screens/you/week.ts` `strengths`) — behaviour the ledger holds,
 *      the same ones the You screen praises, so the two screens can never praise different things.
 *   2. a chapter with every topic behind them (`chapterRows`), at most two, so a learner with
 *      twenty finished chapters gets a report and not a wall.
 *   3. the top trophy actually earned (`ui/trophies.ts`), from xp and streak — the same ladder the
 *      trophy room and the ceremony read.
 */

import type { ChapterRow } from './evidence';
import type { ReportBadge } from './Report';

/** What the derivation needs. Each field is read from a store by the caller and never invented. */
export interface BadgeInput {
  /** The week's strengths, in the shape `screens/you/week.ts` returns them. */
  strengths: readonly { id: string; line: string }[];
  chapters: readonly ChapterRow[];
  /** The trophy ladder's answer for this learner, or null when nothing is earned yet. */
  trophy: { key: string; title: string } | null;
}

/** At most this many finished chapters are named, oldest-first as `chapterRows` orders them. */
export const MAX_CHAPTER_BADGES = 2;

export function reportBadges(input: BadgeInput): ReportBadge[] {
  const out: ReportBadge[] = [];
  for (const strength of input.strengths) {
    out.push({
      id: strength.id,
      title: strength.line,
      mark: strength.id === 'consistency' ? 'rhythm' : 'held',
    });
  }
  // `learnt === total` and nothing looser: a chapter that is 2 of 3 has not had every topic behind
  // them, and a badge saying otherwise beside a panel saying "2 of 3" is the report contradicting
  // itself on one screen.
  for (const row of input.chapters
    .filter((r) => r.total > 0 && r.learnt === r.total)
    .slice(0, MAX_CHAPTER_BADGES)) {
    out.push({
      id: `chapter-${row.id}`,
      title: `${row.name} — every topic behind you`,
      mark: 'earned',
    });
  }
  if (input.trophy) {
    out.push({ id: input.trophy.key, title: input.trophy.title, mark: 'earned' });
  }
  return out;
}
