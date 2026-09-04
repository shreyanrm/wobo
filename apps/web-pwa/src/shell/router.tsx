'use client';

/**
 * A dependency-free router. Routes are a discriminated union; navigation keeps a stack so `back`
 * is real. ponytail: no react-router — a handful of intentions don't need a routing library.
 *
 * Navigation is intention-first (DESIGN.md §6): the home has two doors (learn, practice), the
 * command palette reaches everything, and Wobo reaches everything by name.
 *
 * Every route also has an ADDRESS. The stack is mirrored into the History API, so:
 *   · the Android system back gesture pops a screen instead of quitting the installed PWA,
 *   · a course, a subject or the twin can be linked, bookmarked and reloaded,
 *   · the browser's own back/forward buttons drive the same stack.
 * The API above is untouched — every caller (the palette, the header, Wobo's nav, every "back"
 * affordance) still just calls navigate/replace/back, and gets history for free.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type Route =
  // The unauthenticated front door: the marketing page a visitor with no account lands on.
  | { name: 'landing' }
  | { name: 'onboarding' }
  | { name: 'building' }
  | { name: 'home' }
  | { name: 'chat' }
  | { name: 'learn' }
  | { name: 'practice' }
  | { name: 'subject'; subjectId: string; intent: 'learn' | 'practice' }
  | { name: 'course'; topicId: string }
  | { name: 'sandbox'; topicId?: string }
  | { name: 'progress' }
  | { name: 'you' }
  // The parent's view of the week — read-only, the page the Sunday note links to (WOBO-PLAN §14).
  | { name: 'parent' }
  // The public document pages: what Wobo is, and how to use it. Readable signed out.
  | { name: 'about' }
  | { name: 'help' }
  | { name: 'helpArticle'; group: string; slug: string }
  // The two doors, addressable so a link in an email or a share can land straight on one.
  | { name: 'sign-in' }
  | { name: 'sign-up' }
  | { name: 'contact' }
  // Money and the legal set, all public and all readable signed out. `plans/checkout` is one route
  // rather than two because it is the same page's second beat, and `legal` carries the document's
  // own slug so every one of the ten is linkable.
  | { name: 'plans'; checkout?: boolean }
  | { name: 'gift' }
  // A place bought for a family who cannot pay for one. Public, readable signed out.
  | { name: 'donate' }
  | { name: 'legal'; slug?: string }
  // Every public page on one page, for a person rather than a crawler.
  | { name: 'sitemap' }
  // The six pitch pages of the public site (SITE.md §2), readable signed out.
  | { name: 'security' }
  | { name: 'meet-wobo' }
  | { name: 'for-parents' }
  | { name: 'for-students' }
  | { name: 'how-it-works' }
  | { name: 'subjects' }
  // An address that is not ours. It keeps the path it was asked for, so the URL bar still shows
  // what the learner typed or followed and they can see the slip in it for themselves.
  | { name: 'notfound'; path?: string }
  | { name: 'concept'; which: 'engines' }
  // The kit gallery — every primitive in both themes. Mounted in a dev build only (App.tsx); in a
  // production build the address answers with the 404, like any page that is not there.
  | { name: 'ui-kit' };

const HOME: Route = { name: 'home' };

// --- the address of a route ---------------------------------------------------------------------

/** The URL path a route lives at. Every named route round-trips through pathToRoute. */
export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'subject':
      return `/subject/${encodeURIComponent(route.subjectId)}/${route.intent}`;
    case 'course':
      return `/course/${encodeURIComponent(route.topicId)}`;
    case 'sandbox':
      return route.topicId ? `/sandbox/${encodeURIComponent(route.topicId)}` : '/sandbox';
    case 'helpArticle':
      return `/help/${encodeURIComponent(route.group)}/${encodeURIComponent(route.slug)}`;
    case 'plans':
      return route.checkout ? '/plans/checkout' : '/plans';
    case 'legal':
      return route.slug ? `/legal/${encodeURIComponent(route.slug)}` : '/legal';
    // A 404 keeps the address that produced it. Rewriting the bar to /404 would hide the very
    // thing the learner needs to see — the typo, or the link that was cut short.
    case 'notfound':
      return route.path ?? '/404';
    case 'concept':
      return `/concept/${route.which}`;
    default:
      return `/${route.name}`;
  }
}

/**
 * The one address a crawler should index this route at, absolute.
 *
 * `landing` and `home` are both the front door and both answer at `/`, which is the address
 * `public/sitemap.xml` publishes, so both canonicalise there. `/landing` still resolves — an old
 * link never breaks — it simply is not the address of record any more.
 */
export function canonicalUrl(route: Route, origin?: string): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const base = (origin ?? env.VITE_APP_URL ?? 'https://heywobo.com').replace(/\/+$/, '');
  const path = route.name === 'landing' ? '/' : routeToPath(route);
  return `${base}${path}`;
}

const PLAIN_ROUTES = new Set([
  'landing',
  'onboarding',
  'building',
  'chat',
  'learn',
  'practice',
  'progress',
  'you',
  'parent',
  'about',
  'help',
  'sign-in',
  'sign-up',
  'contact',
  'gift',
  'donate',
  'sitemap',
  'security',
  'meet-wobo',
  'for-parents',
  'for-students',
  'how-it-works',
  'subjects',
  'ui-kit',
]);

const INTENTS = new Set(['learn', 'practice']);
// The A/B/C design prototypes are gone (Home is Concept B, productionised); the engine gallery is
// the only /concept address left, and an old bookmark to /concept/a now falls through to home.
const CONCEPTS = new Set(['engines']);

/** The route a path addresses, or null when the path is not one of ours. */
export function pathToRoute(path: string): Route | null {
  const [head, ...rest] = path.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean) ?? [];
  if (!head) return HOME;
  const decode = (s: string | undefined): string => {
    if (!s) return '';
    try {
      return decodeURIComponent(s);
    } catch {
      return s; // a malformed escape is not worth a dead end; take the raw segment
    }
  };
  if (PLAIN_ROUTES.has(head) && rest.length === 0) return { name: head } as Route;
  if (head === 'subject') {
    const subjectId = decode(rest[0]);
    const intent = rest[1];
    if (!subjectId || !intent || !INTENTS.has(intent)) return null;
    return { name: 'subject', subjectId, intent: intent as 'learn' | 'practice' };
  }
  if (head === 'course') {
    const topicId = decode(rest[0]);
    return topicId && rest.length === 1 ? { name: 'course', topicId } : null;
  }
  if (head === 'sandbox') {
    if (rest.length === 0) return { name: 'sandbox' };
    const topicId = decode(rest[0]);
    return topicId && rest.length === 1 ? { name: 'sandbox', topicId } : null;
  }
  if (head === 'help') {
    const group = decode(rest[0]);
    const slug = decode(rest[1]);
    return group && slug && rest.length === 2 ? { name: 'helpArticle', group, slug } : null;
  }
  if (head === 'plans') {
    if (rest.length === 0) return { name: 'plans' };
    return rest.length === 1 && rest[0] === 'checkout' ? { name: 'plans', checkout: true } : null;
  }
  if (head === 'legal') {
    if (rest.length === 0) return { name: 'legal' };
    const slug = decode(rest[0]);
    return slug && rest.length === 1 ? { name: 'legal', slug } : null;
  }
  if (head === 'concept') {
    const which = rest[0];
    if (!which || rest.length !== 1 || !CONCEPTS.has(which)) return null;
    return { name: 'concept', which: 'engines' };
  }
  return null;
}

/**
 * The route a path addresses. An address that is not ours is a 404 — a real page that says so, in
 * Wobo's own voice, keeping the address it was asked for.
 *
 * It used to land home, which was silent: a mistyped link, a truncated share and a route we
 * renamed all arrived at the home screen looking like nothing had happened, and nobody — learner
 * or maintainer — ever found out the link was broken.
 */
export function routeFromPath(path: string): Route {
  return pathToRoute(path) ?? { name: 'notfound', path: path.split('?')[0]?.split('#')[0] || '/' };
}

/**
 * The stack after the browser moved through history. Back (the system gesture, the hardware key,
 * the browser button) lands on the entry below the top, so it pops; anything else — a forward, a
 * jump — is entered as a new top so the transition still reads in the right direction.
 */
export function applyPop(stack: Route[], path: string): Route[] {
  // A BARE '/' CARRIES NO INTENTION, going back as much as coming in. `bootRoute` already reads it
  // that way on a cold load — the app's own initial wins — and a pop has to agree, or a visitor who
  // arrived on the front page, walked to /for-parents and pressed back would land on the app's home
  // screen instead of the page they came from. The front door of this session is `stack[0]`.
  const next =
    path === '/' || path === '' ? ((stack[0] as Route | undefined) ?? HOME) : routeFromPath(path);
  const top = stack[stack.length - 1];
  if (top && routeToPath(top) === routeToPath(next)) return stack;
  const below = stack[stack.length - 2];
  if (below && routeToPath(below) === routeToPath(next)) return stack.slice(0, -1);
  return [...stack, next];
}

// --- the History API seam (a no-op wherever there is no window) ----------------------------------

interface HistoryMark {
  /** How deep the stack was when this entry was written — tells our entries from anyone else's. */
  woboDepth?: number;
}

function hasHistory(): boolean {
  return typeof window !== 'undefined' && typeof window.history !== 'undefined';
}

function currentDepth(): number {
  if (!hasHistory()) return 0;
  return (window.history.state as HistoryMark | null)?.woboDepth ?? 0;
}

function writePath(path: string, depth: number, mode: 'push' | 'replace'): void {
  if (!hasHistory()) return;
  const mark: HistoryMark = { woboDepth: depth };
  if (mode === 'push') window.history.pushState(mark, '', path);
  else window.history.replaceState(mark, '', path);
}

/** The route this load addresses. A bare '/' carries no intention — the app's own initial wins. */
function bootRoute(initial: Route): Route {
  if (typeof window === 'undefined') return initial;
  const path = window.location.pathname;
  if (path === '/' || path === '') return initial;
  // A cold load on an address that is not ours is the clearest 404 there is: somebody followed a
  // link that does not exist, and dropping them on the home screen would hide that from them.
  return routeFromPath(path);
}

// --- the provider --------------------------------------------------------------------------------

export interface Router {
  route: Route;
  navigate: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
  canGoBack: boolean;
  /** Stack depth — the route-transition layer reads it to tell forward from back (MOTION.md §2). */
  depth: number;
}

const RouterContext = createContext<Router | null>(null);

export function useRouter(): Router {
  const r = useContext(RouterContext);
  if (!r) throw new Error('useRouter must be used within a <RouterProvider>');
  return r;
}

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(() => [bootRoute(initial)]);

  // How deep the history entry we last wrote is. A ref, not state: writing history is a side
  // effect of the ACTION, never of a render — a setState updater must stay pure (React may run it
  // twice, and two pushState calls would take two backs to undo).
  const depth = useRef(1);

  // The address of the first screen, written once: a deep link keeps its URL, and a boot that was
  // locked to another screen corrects the bar to what is actually shown.
  //
  // A BARE '/' IS LEFT ALONE. It used to be rewritten to the booted route's own path, so a stranger
  // who typed heywobo.com got `/landing` in the bar — an address `public/sitemap.xml` does not
  // contain (the sitemap declares `https://heywobo.com/`), which every share and every bookmark of
  // the front page then propagated. `/` is the address we publish, so `/` is the address they keep.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the boot entry is written once, on mount
  useEffect(() => {
    const here = typeof window === 'undefined' ? '' : window.location.pathname;
    const bare = here === '/' || here === '';
    writePath(bare ? '/' : routeToPath(stack[0] as Route), 1, 'replace');
  }, []);

  // ONE PAGE, ONE DECLARED ADDRESS. There was no <link rel="canonical"> anywhere in the app, so
  // the front page was reachable at both `/` and `/landing` with nothing saying which one it is,
  // and a crawler had to guess. The tag is written on every route change: `landing` canonicalises
  // to `/`, which is what the sitemap publishes, and every other page declares its own path.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const route = stack[stack.length - 1] as Route | undefined;
    if (!route) return;
    let tag = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!tag) {
      tag = document.createElement('link');
      tag.rel = 'canonical';
      document.head.appendChild(tag);
    }
    tag.href = canonicalUrl(route);
  }, [stack]);

  // The browser (or Android) moved through history — the stack follows it, never the other way.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      depth.current = currentDepth() || 1;
      setStack((s) => applyPop(s, window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((route: Route) => {
    const path = routeToPath(route);
    // Already here (the header's own tab, a palette entry for this screen): minting an entry would
    // spend one press of the system back button on going nowhere. Nothing changes, so do nothing.
    if (typeof window !== 'undefined' && window.location.pathname === path) return;
    depth.current += 1;
    writePath(path, depth.current, 'push');
    setStack((s) => [...s, route]);
  }, []);

  const replace = useCallback((route: Route) => {
    writePath(routeToPath(route), depth.current, 'replace');
    setStack((s) => [...s.slice(0, -1), route]);
  }, []);

  // Back never dead-ends. With an entry of ours behind us the browser owns the move (so the system
  // gesture and this button are the same action); on a cold deep link there is nothing to pop, and
  // home is the honest destination.
  const back = useCallback(() => {
    if (currentDepth() > 1) {
      window.history.back();
      return;
    }
    depth.current = 1;
    writePath(routeToPath(HOME), 1, 'replace');
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : [HOME]));
  }, []);

  const router = useMemo<Router>(
    () => ({
      route: stack[stack.length - 1] as Route,
      navigate,
      replace,
      back,
      canGoBack: stack.length > 1,
      depth: stack.length,
    }),
    [stack, navigate, replace, back],
  );

  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}
