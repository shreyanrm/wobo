'use client';

/**
 * Links on the public site, and the one list of where the public site goes.
 *
 * A link here is a real `<a href>` with a real address, because these are pages people bookmark,
 * share, open in a new tab and hand to a crawler — and a `<button>` styled as a link is none of
 * those things. A plain left click is taken over by the app's router so the navigation costs no
 * reload; a middle click, a modified click, or a right click is left to the browser, which is the
 * visitor asking for a tab and getting one. An address the router does not know yet (a page
 * another wave is still building) is left to the browser too, so the link is never dead.
 *
 * `NAV_LINKS` is the pill nav every site page carries and `FOOTER_COLUMNS` the four footer columns.
 * The WORDS are the site prototypes' (design/prototypes/site-*.html); the ORDER of the pill nav is
 * the funnel's, not the prototype's (docs/SELL.md §3, and the note above `NAV_LINKS`). `nav.test.ts`
 * holds the labels to that source, the order to the funnel, and every address to the router.
 */

import { PROFILES } from '../../shell/profiles';
import type { MouseEvent, ReactNode } from 'react';
import { addressOf, pathToRoute, type Route, useRouter } from '../../shell/router';
import { ctaFor } from './cta';

/** True where a click is the browser's to handle rather than the router's. */
export function browserOwnsClick(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/**
 * The route an in-app path addresses. `/` is the landing page rather than the home screen: on the
 * public site the wordmark goes to the front door, not into a signed-in learner's app.
 */
export function hrefRoute(href: string): Route | null {
  if (!href.startsWith('/')) return null;
  const clean = href.split('#')[0] ?? '/';
  if (clean === '/' || clean === '') return { name: 'landing' };
  return pathToRoute(clean);
}

/** The page of the public site being read, for `aria-current` in the header and the footer. */
export type SiteSection =
  | 'meet'
  | 'how'
  | 'parents'
  | 'students'
  | 'subjects'
  | 'plans'
  | 'gift'
  | 'donate'
  | 'help'
  | 'contact'
  | 'questions'
  | 'blog'
  | 'about'
  | 'security'
  | 'legal'
  | 'terms'
  | 'privacy'
  | 'children'
  | 'cookies'
  | 'accessibility'
  | 'sitemap';

export interface PublicLink {
  label: string;
  href: string;
  section: SiteSection;
}

/**
 * The pill nav, in the order the DOUBTS ARRIVE (docs/SELL.md §3), which is not the order the
 * prototype listed the pages in. A nav is not a sitemap: it carries the pages that move somebody
 * toward a decision, and it carries them in the order a stranger needs them.
 *
 *  1. "What even is this?"                  → Meet Wobo
 *  2. "Will it work for MY board?"          → Subjects, the single biggest qualifier, which sat
 *                                             fifth here and ninth on the homepage
 *  3. "Is this real teaching?"              → How it works
 *  4/5. whose page am I on                  → For parents, For students
 *  6. "What does it cost?"                  → Plans
 *
 * Six items is the ceiling. The security page answers doubt six and is one tap away from the
 * footer, from the parents page and from the legal set, so it stays out of the bar rather than
 * turning it into a menu.
 */
export const NAV_LINKS: readonly PublicLink[] = [
  { label: 'Meet Wobo', href: '/meet-wobo', section: 'meet' },
  { label: 'Subjects', href: '/subjects', section: 'subjects' },
  { label: 'How it works', href: '/how-it-works', section: 'how' },
  { label: 'For parents', href: '/for-parents', section: 'parents' },
  { label: 'For students', href: '/for-students', section: 'students' },
  { label: 'Plans', href: '/plans', section: 'plans' },
];

/**
 * The two doors in the header. The loud one is THE call to action and it is read from `cta.ts`,
 * never typed here: this constant is the reason the site once said "Get started" in the header and
 * "Get early access" on the plans page. We are open (DESIGN.md §0, owner 2026-09-04), so the door
 * invites rather than promotes.
 */
export const DOORS = { signIn: 'Sign in', getStarted: ctaFor(true).label } as const;

/**
 * The two doors, for the dial as it stands (`docs/DOORS-CLOSED.md` §4).
 *
 * The quiet one NEVER changes. Closing the door to new accounts is not locking anybody out, so
 * "Sign in" stays exactly where it was, in the same words, at the same weight, on every page. The
 * loud one becomes the invitation to the list while the dial is off, and is "Start free" again the
 * minute the owner turns it on.
 */
export function headerDoors(open: boolean): {
  signIn: { label: string; to: Route };
  getStarted: { label: string; to: Route };
} {
  const door = ctaFor(open);
  return {
    signIn: { label: DOORS.signIn, to: { name: 'sign-in' } },
    getStarted: { label: door.label, to: door.to },
  };
}

export interface FooterColumn {
  title: string;
  links: readonly PublicLink[];
}

/** The footer's four columns, word for word. */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Wobo',
    links: [
      { label: 'Meet Wobo', href: '/meet-wobo', section: 'meet' },
      { label: 'How it works', href: '/how-it-works', section: 'how' },
      { label: 'Subjects', href: '/subjects', section: 'subjects' },
      { label: 'Plans', href: '/plans', section: 'plans' },
      { label: 'Gift Wobo', href: '/gift', section: 'gift' },
      { label: 'Donate Wobo', href: '/donate', section: 'donate' },
    ],
  },
  /**
   * "Schools" used to sit here pointing at `/schools`. There is no such route, so every visitor who
   * clicked it landed on the 404 — a dead control in the footer of every public page, and the exact
   * friction SELL.md §8 names. The copy law carries no schools surface either, so the link comes
   * out rather than being pointed somewhere it does not belong. `nav.test.ts` now walks every
   * address in this file through the router, so a second one cannot be added by hand.
   */
  {
    title: 'For',
    links: [
      { label: 'Parents', href: '/for-parents', section: 'parents' },
      { label: 'Students', href: '/for-students', section: 'students' },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Help centre', href: '/help', section: 'help' },
      { label: 'Contact', href: '/contact', section: 'contact' },
      /**
       * The questions live on the PARENTS page (`pitch/ForParents.tsx`, ported from
       * `design/prototypes/site-parents.html`, the only prototype with the id). This pointed at
       * `/#questions`, an anchor the landing does not carry, so on thirteen pages the link put the
       * reader at the top of the front page at `/landing`. `nav.test.ts` now proves every hash is
       * an id on the source of the page it names.
       */
      { label: 'Questions', href: '/for-parents#questions', section: 'questions' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about', section: 'about' },
      // The blog is the origin every syndicated post points back at, so it is reachable from every
      // page rather than only from whatever linked to a post (docs/GROWTH-DESK.md §3).
      { label: 'Blog', href: '/blog', section: 'blog' },
      { label: 'Security and trust', href: '/security', section: 'security' },
      { label: 'Terms', href: '/legal/terms-of-service', section: 'terms' },
      { label: 'Privacy', href: '/legal/privacy-policy', section: 'privacy' },
      { label: "Children's privacy", href: '/legal/childrens-privacy', section: 'children' },
      { label: 'Cookies', href: '/legal/cookies', section: 'cookies' },
      { label: 'Accessibility', href: '/legal/accessibility-statement', section: 'accessibility' },
    ],
  },
];

/**
 * The places a reader can follow Wobo, in the footer of every public page.
 *
 * These are the SAME listings the entity graph names in `shell/profiles.ts`, read from it rather
 * than typed a second time: a footer that pointed somewhere the markup did not would be two
 * answers to "where is Wobo", which is the exact thing the entity work exists to stop
 * (docs/GROWTH-ENTITY.md). Nothing unclaimed appears here for the same reason it never reaches
 * `sameAs`: a link to a handle nobody holds is a broken promise, and one somebody else holds is
 * worse. The name is always Wobo and `heywobo` is only the handle (§2).
 */
export const FOOTER_SOCIALS: readonly { readonly label: string; readonly href: string }[] =
  PROFILES.filter((p) => p.claimed && p.kind === 'social' && p.url).map((p) => ({
    label: p.platform,
    href: p.url as string,
  }));

/** The line under the footer's wordmark. */
export const FOOTER_LINE = 'A tutor that draws, never judges, and is always there.';

/**
 * Put the reader on `#hash` of the page that has just been asked for.
 *
 * The router addresses ROUTES, and a route has no hash: `routeToPath` writes the bare path, so an
 * anchor on another page (`/for-parents#questions`) used to arrive at the top of that page with
 * the hash gone. The page's chunk is loaded lazily and its shell scrolls a fresh document to its
 * top on mount, so this waits for the id to exist, lets that mount settle, then scrolls to it and
 * writes the hash back into the bar (replace, never push: the entry is the page's own). A hash
 * that never turns up within a few seconds is left alone rather than scrolled anywhere.
 */
export function landOnAnchor(hash: string, doc: Document = document): void {
  if (!hash) return;
  const deadline = Date.now() + 4000;
  const look = () => {
    const target = doc.getElementById(hash);
    if (!target) {
      if (Date.now() < deadline) setTimeout(look, 50);
      return;
    }
    // one more tick, so a shell that scrolls to its top on mount has done so first
    setTimeout(() => {
      target.scrollIntoView({ block: 'start' });
      const win = doc.defaultView;
      if (win?.history && win.location.hash !== `#${hash}`) {
        win.history.replaceState(win.history.state, '', `${win.location.pathname}#${hash}`);
      }
    }, 0);
  };
  look();
}

export function SiteLink({
  to,
  href,
  children,
  className,
  current,
  onNavigate,
  ...rest
}: {
  /** A route, or a path string — both end up at the same address. */
  to?: Route;
  href?: string;
  children: ReactNode;
  className?: string;
  /** Marks this link as the page being read. */
  current?: boolean;
  /** Runs after the router moves — scrolling a fresh document back to its top, for instance. */
  onNavigate?: () => void;
  'aria-label'?: string;
}) {
  const router = useRouter();
  // The ADDRESS OF RECORD, never a second address for the same page: `addressOf` sends the
  // front page to `/`, which is what the sitemap publishes and what the build writes a file for.
  // `routeToPath` answers `/landing` there, which is a wordless rewrite into the SPA shell.
  const address = to ? addressOf(to) : (href ?? '/');
  const target = to ?? hrefRoute(address);
  const hash = address.split('#')[1] ?? '';
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || browserOwnsClick(event)) return;
    if (!target) return;
    event.preventDefault();
    onNavigate?.();
    router.navigate(target);
    if (hash) landOnAnchor(hash);
  };
  return (
    <a
      href={address}
      onClick={onClick}
      {...(className ? { className } : {})}
      {...(current ? { 'aria-current': 'page' as const } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}
