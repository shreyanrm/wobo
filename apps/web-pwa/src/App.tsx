'use client';

/**
 * The root, and the one decision it makes: is this a visitor on the public site, or a learner in
 * the app?
 *
 * Everything the app is — the identity layer, the Supabase client, Wobo's context bus, the board
 * and its hand, the answer library, the character rig's choreography, every screen behind a door —
 * lives in `AppRuntime`, behind a dynamic import. A stranger who opens the landing page, or a
 * parent following a link to /security, downloads the site and nothing else.
 *
 * The router sits ABOVE the swap on purpose: the address, the history stack and the back gesture
 * are the same objects either side of the door, so walking in from the front door costs no extra
 * history entry and back still lands where the visitor came from.
 */

import { lazy, Suspense, useEffect, useRef, useState, useTransition } from 'react';
import { PublicSite } from './PublicSite';
import { isPublicRoute, ONBOARDED_KEY } from './shell/public-routes';
import { type Route, RouterProvider, useRouter } from './shell/router';
import { scoped } from './store/scope';

// Re-exported so the screens that write these sentinels keep importing them from the root they
// have always imported them from. It is defined next to the routing law it belongs to.
export { isPublicSite, ONBOARDED_KEY } from './shell/public-routes';

/** Set by the sign-in beat; the next boot records identity.subject.created.v1 fully attributed. */
export const SIGNIN_SOURCE_KEY = 'wobo-signin-source-v1';

// The runtime is fetched; the site's own host is not. It is a page table and an error boundary —
// three kilobytes — and behind its own dynamic import it cost the public site a whole round trip
// before the page it names could even start downloading.
const AppRuntime = lazy(() => import('./AppRuntime').then((m) => ({ default: m.AppRuntime })));

/**
 * The first screen this load addresses. It is decided from one sentinel and the address alone,
 * with no identity layer and no SDK — asking who is signed in would pull the whole auth stack into
 * the entry chunk, which is the one thing a marketing page must not pay for. A started learner who
 * turns out to be signed out is corrected to `/onboarding` by the runtime, which can ask.
 *
 * ponytail: a dev preview hook — #engines boots straight into the engine gallery for QA.
 */
function bootIntent(): Route {
  if (typeof location !== 'undefined' && location.hash === '#engines') {
    return { name: 'concept', which: 'engines' };
  }
  // The learner's sentinel, read under the scope `bootScope()` set in main.tsx: after a sign-out
  // the device is unscoped and a bare `/` is the front door for whoever comes next.
  const started = scoped.getItem(ONBOARDED_KEY);
  return started ? { name: 'home' } : { name: 'landing' };
}

/**
 * Which host is on screen. It starts as whatever the address asks for, and it is one-way: once the
 * runtime is up it stays up, because it owns the app chrome, Wobo and the state pages — the public
 * site's own pages render inside it perfectly well (they always have).
 */
function Host() {
  const { route } = useRouter();
  const site = isPublicRoute(route.name);
  const [runtime, setRuntime] = useState(!site);
  const [, startTransition] = useTransition();
  // The last address the site itself could draw. It is what stays on screen while the runtime is
  // still arriving: a visitor who taps "Get started" keeps the page they tapped on until the app
  // is ready to replace it, instead of watching it blink out to nothing.
  const lastSite = useRef(route);
  if (site) lastSite.current = route;

  // Crossing from the site into the app. In a transition, so React holds the committed page up
  // until the runtime's chunk lands rather than tearing it down for a fallback.
  useEffect(() => {
    if (site || runtime) return;
    startTransition(() => setRuntime(true));
  }, [site, runtime]);

  // While the visitor reads, the runtime arrives behind them: a door then costs a render rather
  // than a download. It waits for a sign of a real person — a move, a tap, a key, a wheel — and
  // otherwise for a genuinely idle moment well after the page has settled. Measured on a throttled
  // 4G link, prefetching any earlier than this simply takes the bandwidth off the page somebody is
  // looking at: ~180 kB of runtime downloading beside the landing pushed its first paint out by
  // more than a second.
  useEffect(() => {
    if (runtime) return;
    let done = false;
    const pull = () => {
      if (done) return;
      done = true;
      stop();
      void import('./AppRuntime');
    };
    const SIGNS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    const later = window.setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(pull, { timeout: 4000 });
      else pull();
    }, 4000);
    const stop = () => {
      window.clearTimeout(later);
      for (const sign of SIGNS) window.removeEventListener(sign, pull);
    };
    for (const sign of SIGNS) window.addEventListener(sign, pull, { once: true, passive: true });
    return () => {
      done = true;
      stop();
    };
  }, [runtime]);

  return (
    // Nothing stands in for the app's own boot: main.tsx already has the one loader (WOBO-PLAN §16)
    // over the page, and a second thing under it would only be a second thing.
    <Suspense fallback={null}>
      {runtime ? (
        <AppRuntime />
      ) : (
        <PublicSite route={lastSite.current} onFailure={() => setRuntime(true)} />
      )}
    </Suspense>
  );
}

export function App() {
  return (
    <RouterProvider initial={bootIntent()}>
      <Host />
    </RouterProvider>
  );
}
