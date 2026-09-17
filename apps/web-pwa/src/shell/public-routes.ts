/**
 * Which addresses belong to the PUBLIC SITE, and whether this page load starts on one.
 *
 * The split matters for more than routing: the public site is served to a stranger on a cheap
 * phone, and it must download the site and nothing else. Everything behind the door — the identity
 * layer, the Supabase client, Wobo's board, the answer library, the character rig's app-side
 * choreography, every app screen — is loaded only once one of these answers `false`.
 *
 * It is a plain module with no React and no app imports, so main.tsx can ask it before the app
 * exists.
 */

import { isParentDevice } from '../screens/parent/device';
import { scoped } from '../store/scope';
import { pathToRoute, type Route } from './router';

/**
 * The public document pages — /about, /help and every article under it, the legal set, the plans
 * page and the gift page, the two doors, /contact, and the 404. They are readable with no account,
 * so the sign-in lock lets them through, and they carry their own header, footer and cursor, so the
 * app chrome stays off them.
 *
 * The two doors and the 404 belong here for the same reason as the rest, and for one more: a
 * learner who is signed out and follows a link to `/sign-in` must land on the sign-in page, not be
 * bounced into onboarding by the very lock that link exists to open.
 */
export function isPublicSite(name: Route['name']): boolean {
  return (
    name === 'about' ||
    name === 'help' ||
    name === 'helpArticle' ||
    name === 'legal' ||
    name === 'plans' ||
    name === 'gift' ||
    name === 'donate' ||
    name === 'sign-in' ||
    name === 'sign-up' ||
    name === 'contact' ||
    name === 'sitemap' ||
    name === 'security' ||
    name === 'press' ||
    name === 'meet-wobo' ||
    name === 'for-parents' ||
    name === 'for-students' ||
    name === 'how-it-works' ||
    name === 'subjects' ||
    // The syllabus family: readable with no account, and the whole point of it is that a stranger
    // who arrived from a search can read the chapter and ask a question about it before they
    // decide anything (docs/GROWTH-SEARCH.md §3).
    name === 'syllabus' ||
    name === 'subjectHub' ||
    // The three growth families (docs/GROWTH-SEARCH.md §4.5): the glossary, the exam-cycle pages
    // and the side-by-side pages. All readable with no account, for the same reason.
    name === 'glossary' ||
    name === 'glossaryEntry' ||
    name === 'exams' ||
    name === 'examBoard' ||
    name === 'compare' ||
    name === 'compareEntry' ||
    // The blog, its posts and its tag pages. Read by a stranger who arrived from a search, so it
    // must cost them the site and nothing behind the door (docs/GROWTH-DESK.md).
    name === 'blog' ||
    name === 'blogPost' ||
    name === 'blogTag' ||
    name === 'notfound' ||
    name === 'ui-kit'
  );
}

/** Everything the public site renders: the front door plus the document pages behind it. */
export function isPublicRoute(name: Route['name']): boolean {
  return name === 'landing' || isPublicSite(name);
}

/**
 * WHICH OF THE THREE HOSTS an address opens: the public site, the learner's app, or the parent
 * account's own host (screens/parent/ParentRuntime.tsx).
 *
 * The parent's host is its own because a parent account can hold no learner state (migration
 * 0019), and the learner runtime starts writing some the moment it mounts: an anonymous session,
 * the mind, the activity record, the setup lock. `parent-preview` is the LEARNER's page and stays
 * in the learner's app.
 */
export function hostFor(name: Route['name']): 'site' | 'parent' | 'app' {
  if (name === 'parent') return 'parent';
  return isPublicRoute(name) ? 'site' : 'app';
}

/**
 * What a bare `/` opens, from the two sentinels this device holds for the account it was last
 * keyed to. A parent account's is its own home; the server is asked again the moment it opens.
 */
export function bootRouteFor(device: { onboarded: boolean; parent: boolean }): Route {
  if (device.parent) return { name: 'parent' };
  return device.onboarded ? { name: 'home' } : { name: 'landing' };
}

/** The learner has finished setup on this device — the sentinel App.tsx writes and reads. */
export const ONBOARDED_KEY = 'wobo-onboarded-v1';

/**
 * Does THIS page load open on the public site? Decided from the address alone (plus the one
 * sentinel that says whether a bare `/` is the front door or the app), because it has to be
 * answered before a single app module is fetched.
 */
export function bootIsPublic(): boolean {
  if (typeof window === 'undefined') return false;
  // DEV ONLY: the #engines preview hook, gated with the bench it opens (AppRuntime.tsx). In a
  // production build there is no gallery chunk, so sending a visitor into the app runtime for this
  // hash would cost them the whole runtime to arrive at a 404.
  if (import.meta.env.DEV && window.location.hash === '#engines') return false;
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    // No storage to read is a miss, and a miss is a new visitor, which is the safe guess.
    const boot = bootRouteFor({
      onboarded: Boolean(scoped.getItem(ONBOARDED_KEY)),
      parent: isParentDevice(),
    });
    return isPublicRoute(boot.name);
  }
  const route = pathToRoute(path);
  // An address that is not ours is the 404 — itself a public page.
  return route ? isPublicRoute(route.name) : true;
}
