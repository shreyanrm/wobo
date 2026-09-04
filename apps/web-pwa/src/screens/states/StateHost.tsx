'use client';

/**
 * Where the state family actually appears.
 *
 * `StateLayer` wraps the screen slot and does two things. It catches a render that threw, so a
 * broken engine takes its own subtree down instead of the whole app, and it puts the page the
 * selector chose (`select.ts`) over the top of everything — header, Wobo, board and all — because
 * each of these scenes carries its own wordmark and a second one underneath would read as two
 * products at once.
 *
 * Recovery is real, not cosmetic. "Try again" clears the failure AND remounts the subtree under a
 * fresh key, so a component that threw gets a genuine second life rather than being handed straight
 * back its own broken state. Coming back online clears a network failure by itself.
 */

import { Component, type ReactNode, useCallback, useEffect, useState } from 'react';
import { ONBOARDED_KEY } from '../../shell/public-routes';
import { useConnectivity } from '../../shell/resilience';
import { type Route, useRouter } from '../../shell/router';
import { useProgress } from '../../store/progress';
import { readNotes } from '../../wobo/board-notes';
import { lessonView } from '../../wobo/lesson-view';
import { todayPlan } from '../home/today';
import { HANDOFFS } from '../site/handoffs';
import { hrefRoute } from '../site/nav';
import { DailyLimit, ExpiredLink, Maintenance, NotFound, Offline, ServerError } from './pages';
import { clearFailure, type Failure, reportFailure, selectState, useFailure } from './select';
import { ensureStateStyles } from './styles';

/**
 * Catches a render that threw and reports it. It renders nothing in place of the subtree — the
 * page the learner sees comes from the layer above, which knows about the network and the meter too
 * and would otherwise be showing a second apology beside this one.
 */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    // The console keeps the real error for whoever is debugging; the learner never sees it.
    console.error('a screen failed to render', error);
    const failure: Failure = { kind: 'server' };
    reportFailure(failure);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function StateLayer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { offline } = useConnectivity();
  const failure = useFailure();
  // Bumped by "try again": it re-keys the boundary, so a subtree that threw is built from scratch.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    ensureStateStyles();
  }, []);

  // The connection came back on its own. Nothing to apologise for any more.
  useEffect(() => {
    if (!offline && failure?.kind === 'network') clearFailure();
  }, [offline, failure]);

  // Moving somewhere else is the learner telling us they are past it. A spent day is the one thing
  // navigation does not fix, so it survives — and it clears itself when the meter refills.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route change IS the trigger
  useEffect(() => {
    if (failure && failure.kind !== 'budget') clearFailure();
  }, [router.route.name]);

  const retry = useCallback(() => {
    clearFailure();
    setAttempt((a) => a + 1);
  }, []);

  const home = useCallback(() => {
    clearFailure();
    router.navigate({ name: 'home' });
  }, [router]);

  const signIn = useCallback(() => {
    clearFailure();
    router.navigate({ name: 'sign-in' });
  }, [router]);

  // The plan ask at the one moment §14 allows it: a spent day, with the door beside "back to
  // learning" rather than in front of it.
  const plans = useCallback(() => {
    clearFailure();
    router.navigate({ name: 'plans' });
  }, [router]);

  // "Review today's notes": the boards the learner kept live on the lesson's notes view, so the
  // door opens the lesson in flight (the one the home would continue) on that view. Drawn only
  // when there is something kept and a lesson to open it in — a door onto nothing is worse than
  // no door.
  const progress = useProgress();
  const plan = todayPlan(progress);
  const lesson = plan.continue?.topic.id ?? plan.next?.topic.id ?? null;
  const hasNotes = lesson !== null && readNotes().length > 0;
  const notes = useCallback(() => {
    if (!lesson) return;
    clearFailure();
    lessonView.view('notes');
    router.navigate({ name: 'course', topicId: lesson });
  }, [router, lesson]);

  const kind = selectState({ routeName: router.route.name, online: !offline, failure });

  // 'not-found' is an ADDRESS, so it is rendered by the router as a screen of its own; everything
  // else here is something that happened to the screen the learner already had.
  const page =
    kind === 'expired-link' ? (
      <ExpiredLink onNewLink={signIn} />
    ) : kind === 'maintenance' ? (
      <Maintenance backAt={failure?.backAt} onRetry={retry} />
    ) : kind === 'daily-limit' ? (
      <DailyLimit
        resetAt={failure?.resetAt}
        onBack={home}
        onPlans={plans}
        onNotes={hasNotes ? notes : undefined}
      />
    ) : kind === 'offline' ? (
      <Offline onRetry={retry} />
    ) : kind === 'server-error' ? (
      <ServerError onRetry={retry} onHome={home} />
    ) : null;

  return (
    <>
      <Boundary key={attempt}>{children}</Boundary>
      {page ? <div className="ws-full">{page}</div> : null}
    </>
  );
}

/**
 * The 404 as a screen of its own, with its two doors wired to WHOEVER IS STANDING ON IT.
 *
 * It is a route rather than an overlay because it IS the address: the person asked for something
 * that is not here, and the back button should take them off it the way it takes them off any other
 * page. And it is a PUBLIC page — the address a mistyped link, a truncated share and every renamed
 * route lands on — so most of the people who reach it have no account.
 *
 * They used to be offered "Back to learning" and "Ask Wobo", which are both the inside of a product
 * they have never opened: the page dead-ended for exactly the visitor it exists to catch. Now the
 * doors are read from the same handoff table every other public page closes on (docs/SELL.md §6) —
 * the one call to action, and the front page — while a learner who has finished setup on this
 * device still gets their own two. One job, one primary, either way.
 *
 * WHICH ONE is decided by the same sentinel the root boots from (`shell/public-routes`), and by
 * that alone: asking the identity layer would be a question this screen has no business waiting on,
 * and a signed-out learner who has started before is still better served by "back to learning".
 */
export function NotFoundScreen() {
  const router = useRouter();
  useEffect(() => {
    ensureStateStyles();
  }, []);
  const started = hasStarted();
  const close = HANDOFFS.notfound;
  // `hrefRoute`, not `pathToRoute`: on the public site "/" is the FRONT DOOR, not a signed-in
  // learner's home screen, and this is the branch for somebody who has never signed in.
  const go = (action: { to?: Route; href?: string }) => () => {
    router.navigate(action.to ?? (action.href ? (hrefRoute(action.href) ?? LANDING) : LANDING));
  };
  const actions = started
    ? [
        {
          label: 'Back to learning',
          onSelect: () => router.navigate({ name: 'home' }),
          primary: true,
        },
        { label: 'Ask Wobo', onSelect: () => router.navigate({ name: 'chat' }) },
      ]
    : [
        { label: close.primary.label, onSelect: go(close.primary), primary: true },
        { label: close.quiet.label, onSelect: go(close.quiet) },
      ];
  return <NotFound actions={actions} />;
}

const LANDING: Route = { name: 'landing' };

/** Has anyone finished setup on this device? The one sentinel `App.tsx` boots from. */
function hasStarted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(ONBOARDED_KEY) !== null;
  } catch {
    return false; // storage blocked: treat the visitor as new, which is the safe guess
  }
}
