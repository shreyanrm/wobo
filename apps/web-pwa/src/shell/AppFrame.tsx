'use client';

/**
 * The authenticated app's frame — the kit's AppShell wired to the router and to the learner's real
 * allowance. A screen behind one of the four doors mounts this and puts a <TopBar> first.
 *
 *   <AppFrame active="home">
 *     <TopBar crumb="…" right={…} />
 *     …
 *   </AppFrame>
 *
 * It also carries the one thing that has to be on EVERY screen behind the door: the quiet flag
 * (`ui/FlagControl`). The help centre published "there is a quiet flag on every lesson, question,
 * board and diagram" while no such control existed anywhere; mounting it in the frame rather than
 * on each screen is what makes that sentence true of all of them at once, and keeps it true of the
 * next screen somebody adds. It rides in the rail's bottom slot beside whatever that slot is
 * already holding, so a lesson's hold-to-talk pill never takes the flag away with it.
 */

import type { ReactNode } from 'react';
import { DoubtEntry } from '../screens/doubt/DoubtEntry';
import { InstallOffer } from '../suggest/InstallOffer';
import { FlagControl } from '../ui/FlagControl';
import type { FlagAbout } from '../ui/flag';
import { AllowanceCard, AppShell, type NavId } from '../ui/primitives';
import { type Route, useRouter } from './router';
import { allowanceNote, allowanceProgress, useAllowance } from './useAllowance';

export interface AppFrameProps {
  active: NavId;
  children: ReactNode;
  /** What the rail's bottom slot holds instead of the allowance — a lesson's hold-to-talk pill. */
  bottom?: ReactNode;
  /**
   * What the quiet flag should report from this screen, where the screen knows more than its own
   * address does: which practice item is being answered, which board is open. The route's own
   * answer stands when nothing is passed, so no screen has to remember this.
   */
  about?: FlagAbout;
}

/**
 * What the flag reports when a screen has published nothing of its own: the route, and the one
 * thing in it that names a piece of content. Nothing here is a learner's own work.
 */
export function aboutOfRoute(route: Route): { surface: string; content_id?: string } {
  if (route.name === 'course') return { surface: 'lesson', content_id: route.topicId };
  if (route.name === 'subject') return { surface: 'subject', content_id: route.subjectId };
  if (route.name === 'sandbox' && route.topicId)
    return { surface: 'sandbox', content_id: route.topicId };
  return { surface: route.name };
}

export function AppFrame({ active, children, bottom, about }: AppFrameProps) {
  const router = useRouter();
  const allowance = useAllowance();
  const progress = allowanceProgress(allowance);
  return (
    <AppShell
      active={active}
      onNavigate={(id) => router.navigate({ name: id })}
      bottom={
        <>
          {bottom ?? (
            <AllowanceCard
              title="Today's allowance"
              {...(progress === undefined ? {} : { progress })}
              note={allowanceNote(allowance)}
            />
          )}
          <FlagControl about={{ ...aboutOfRoute(router.route), ...(about ?? {}) }} />
        </>
      }
    >
      {children}
      {/* The doubt solver's door, one tap from every screen behind the frame (screens/doubt).
          The doubt screen carries its own camera control, so the floating one stands down there. */}
      {router.route.name !== 'doubt' ? <DoubtEntry /> : null}
      {/* The install offer, which is why it is HERE and nowhere else: the frame is behind the door,
          so the landing pages, the two doors and onboarding — which render no frame — can never
          show it. It draws nothing until a learner has earned something (shell/install.ts). */}
      <InstallOffer />
    </AppShell>
  );
}
