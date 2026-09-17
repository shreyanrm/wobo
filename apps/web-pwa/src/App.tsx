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
import { isParentDevice } from './screens/parent/device';
import { bootRouteFor, hostFor, ONBOARDED_KEY } from './shell/public-routes';
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
// The parent account's own host (screens/parent/ParentRuntime.tsx). Its own chunk, and never the
// learner runtime: a parent account holds no learner state, and the learner runtime starts writing
// some the moment it mounts.
const ParentRuntime = lazy(() =>
  import('./screens/parent/ParentRuntime').then((m) => ({ default: m.ParentRuntime })),
);

/**
 * The first screen this load addresses. It is decided from one sentinel and the address alone,
 * with no identity layer and no SDK — asking who is signed in would pull the whole auth stack into
 * the entry chunk, which is the one thing a marketing page must not pay for. A started learner who
 * turns out to be signed out is corrected to `/onboarding` by the runtime, which can ask.
 *
 * DEV ONLY: #engines boots straight into the engine gallery for QA. It is gated with the bench it
 * opens (AppRuntime.tsx), because a production build has no gallery chunk to boot into: there the
 * hash is an ordinary hash and the boot falls through to the front door or the learner's home.
 */
function bootIntent(): Route {
  if (import.meta.env.DEV && typeof location !== 'undefined' && location.hash === '#engines') {
    return { name: 'concept', which: 'engines' };
  }
  // The two sentinels, read under the scope `bootScope()` set in main.tsx: after a sign-out the
  // device is unscoped and a bare `/` is the front door for whoever comes next. A parent account's
  // bare `/` is its own home.
  return bootRouteFor({
    onboarded: Boolean(scoped.getItem(ONBOARDED_KEY)),
    parent: isParentDevice(),
  });
}

/**
 * Which host is on screen. It starts as whatever the address asks for, and it is one-way: once the
 * runtime is up it stays up, because it owns the app chrome, Wobo and the state pages — the public
 * site's own pages render inside it perfectly well (they always have).
 */
function Host() {
  const { route } = useRouter();
  // A PARENT ACCOUNT IS NEVER SHOWN THE LEARNER'S APP. The server last said the account this device
  // is keyed to is a parent's (screens/parent/device.ts), and a parent account can hold no learner
  // state (migration 0019), so a learner address typed or bookmarked on this device opens the
  // parent's own host instead, which asks the server again the moment it opens.
  // The parent's host corrects the address itself once it has mounted (a replace from here would
  // run before the router's own first write and be overwritten by it).
  const host = hostFor(route.name) === 'app' && isParentDevice() ? 'parent' : hostFor(route.name);
  const site = host === 'site';
  // The learner runtime starts only for the learner's own addresses. A parent who walks from their
  // home to a public page (giving, the legal set) is shown the public site, never the learner's app.
  const [runtime, setRuntime] = useState(host === 'app');
  const [, startTransition] = useTransition();
  // The last address the site itself could draw. It is what stays on screen while the runtime is
  // still arriving: a visitor who taps "Get started" keeps the page they tapped on until the app
  // is ready to replace it, instead of watching it blink out to nothing.
  const lastSite = useRef(route);
  if (site) lastSite.current = route;

  // Crossing from the site into the app. In a transition, so React holds the committed page up
  // until the runtime's chunk lands rather than tearing it down for a fallback.
  useEffect(() => {
    if (site || runtime || host === 'parent') return;
    startTransition(() => setRuntime(true));
  }, [site, runtime, host]);

  // While the visitor reads, the runtime arrives behind them: a door then costs a render rather
  // than a download. It waits for a sign of a real person — a move, a tap, a key, a wheel — and
  // otherwise for a genuinely idle moment well after the page has settled. Measured on a throttled
  // 4G link, prefetching any earlier than this simply takes the bandwidth off the page somebody is
  // looking at: ~180 kB of runtime downloading beside the landing pushed its first paint out by
  // more than a second.
  useEffect(() => {
    if (runtime || host === 'parent') return;
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
  }, [runtime, host]);

  return (
    // Nothing stands in for the app's own boot: main.tsx already has the one loader (WOBO-PLAN §16)
    // over the page, and a second thing under it would only be a second thing.
    <Suspense fallback={null}>
      {host === 'parent' ? (
        <ParentRuntime />
      ) : runtime ? (
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
