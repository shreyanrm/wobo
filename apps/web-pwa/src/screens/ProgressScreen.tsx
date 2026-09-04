'use client';

/**
 * PROGRESS — the knowledge map and the parent's report, at their own address.
 *
 * This screen used to be a redirect. `/progress` kept its address and handed every arrival to
 * `/you`, on the reasoning that progress IS the You screen (board 05 of
 * design/prototypes/app-v1.html) and a second screen of the same week counted twice.
 *
 * That reasoning was right about the old progress screen and wrong about this one. What lives here
 * now is not a second copy of the You screen's week: it is the constellation — every concept the
 * learner has opened, drawn with the ground under it — and the report a PARENT reads, which is a
 * different document for a different reader, with its own span control, its own arithmetic
 * (`progress/evidence.ts`) and its own honest empty states. Both were built, both were tested, and
 * neither was reachable from anywhere in the app: the whole folder was code no learner and no
 * parent could open. An address is what fixes that, and this is the address they already have.
 *
 * The You screen keeps its own week, its strengths and its parents card, and it is still where a
 * learner goes to look at themselves. Nothing here duplicates it: the minutes chart on this screen
 * is the report's, drawn from the same `store/mind.ts` ledger through the same functions the You
 * screen calls, so the two can never disagree about a number.
 */

import { AppFrame } from '../shell/AppFrame';
import { Label, TopBar } from '../ui/primitives';
import { ProgressSurfaces } from './progress';

export function ProgressScreen() {
  return (
    <AppFrame active="you">
      <TopBar crumb="Progress" />
      <div>
        <Label>Everything so far</Label>
      </div>
      <ProgressSurfaces />
    </AppFrame>
  );
}
