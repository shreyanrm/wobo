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
    name === 'meet-wobo' ||
    name === 'for-parents' ||
    name === 'for-students' ||
    name === 'how-it-works' ||
    name === 'subjects' ||
    name === 'notfound' ||
    name === 'ui-kit'
  );
}

/** Everything the public site renders: the front door plus the document pages behind it. */
export function isPublicRoute(name: Route['name']): boolean {
  return name === 'landing' || isPublicSite(name);
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
  // ponytail: a dev preview hook — #engines boots straight into the engine gallery for QA.
  if (window.location.hash === '#engines') return false;
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    try {
      return !localStorage.getItem(ONBOARDED_KEY);
    } catch {
      return true; // no storage to read: treat the visitor as new, which is the safe guess
    }
  }
  const route = pathToRoute(path);
  // An address that is not ours is the 404 — itself a public page.
  return route ? isPublicRoute(route.name) : true;
}
