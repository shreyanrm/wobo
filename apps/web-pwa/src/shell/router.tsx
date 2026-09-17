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
// A leaf, like `syllabus/address` below it: pure functions and a table, with only type imports of
// its own, so the router stays the cheap module every page load reaches for first.
import { canonicalSlug } from '../screens/legal/catalog';
import {
  addressFrom,
  addressPath,
  HUB_ROOT,
  hubPath,
  isSlug,
  ROOT as SYLLABUS_ROOT,
} from '../screens/syllabus/address';
import { BRAND_DESCRIPTION, DEFAULT_ORIGIN, type HeadTag, HOME_TITLE, headTags } from './head';

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
  /**
   * A course, and — when a link says so — the exact card inside it to open at.
   *
   * THE LINK THAT LANDS (docs/EMAILS-AND-ANIMATIONS.md §4). A mail's one button carries
   * `/course/<course>/card/<card>`, so the learner arrives on the beat the mail was about rather
   * than at the top of a course they were halfway through. The card segment is optional and the
   * bare `/course/<course>` address is untouched, so every link already in an inbox, a bookmark or
   * a share still means what it meant.
   *
   * The card is carried as an opaque string because the two players number their cards
   * differently: the atom's are named (`scale`, `boss`), the generated player's are an index
   * (`4`). Which one a course is, and whether that card exists in it, is the PLAYER's question —
   * answering it here would drag the whole curriculum into the entry chunk, and a card that is not
   * there is a resume position, not a 404.
   */
  | { name: 'course'; topicId: string; cardId?: string }
  /**
   * A bonus level, opened from the side door in the middle of a chapter
   * (docs/CONTENT-INTERACTION.md §7). It is addressed by the topic the door hangs off, because that
   * is the thing the learner just finished; the level itself is the one that course carried, and it
   * is never fetched again. Optional and off the climb: nothing routes here on its own.
   */
  | { name: 'arcade'; topicId: string }
  | { name: 'sandbox'; topicId?: string }
  | { name: 'progress' }
  | { name: 'you' }
  /** The doubt solver: a photo of the page, read back, explained on the photo. */
  | { name: 'doubt' }
  /**
   * THE PARENT ACCOUNT (screens/parent). `/parent` is its home: the children, the switch, and the
   * four doors. `/parent/<action>` is one of the four, and there is no fifth address because a
   * parent account does four things (the owner, 2026-09-05; `parent_account.PARENT_ACTIONS`).
   * The action names are spelled here rather than imported so the router stays a leaf.
   */
  | { name: 'parent'; action?: 'ask' | 'pay' | 'refer' | 'donate' }
  /**
   * The LEARNER's own preview of what a parent is told, reached from the Parents card on You. It
   * lived at `/parent` until the parent account needed that address; it is the learner's page, so
   * it lives under theirs now.
   */
  | { name: 'parent-preview' }
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
  | { name: 'press' }
  | { name: 'meet-wobo' }
  | { name: 'for-parents' }
  | { name: 'for-students' }
  | { name: 'how-it-works' }
  | { name: 'subjects' }
  /**
   * The public syllabus pages: `/learn/<board>/<class>/<subject>/<chapter>/<topic>`, one address
   * per layer, each a prefix of the next (docs/GROWTH-SEARCH.md §3). `/learn` on its own stays the
   * app's own learn screen; this family starts one segment deeper. The route carries slugs and
   * nothing else — whether we HOLD that syllabus is the page's question, not the router's, because
   * answering it here would drag the whole syllabus into the entry chunk.
   */
  | {
      name: 'syllabus';
      board: string;
      level?: string | undefined;
      subject?: string | undefined;
      chapter?: string | undefined;
      topic?: string | undefined;
    }
  /** One subject across every board that sets it: `/subjects/<subject>`. */
  | { name: 'subjectHub'; subject: string }
  /**
   * The blog: the index, one post, and one tag. `/blog` is the ORIGIN every syndicated copy of a
   * post points its canonical back at (docs/GROWTH-DESK.md §3), so the address of a post is decided
   * here and nowhere else. The router carries the slug and nothing else: whether a post exists at
   * that slug is the page's question, because answering it here would drag the compiled blog into
   * the entry chunk.
   */
  | { name: 'blog' }
  | { name: 'blogPost'; slug: string }
  | { name: 'blogTag'; tag: string }
  /**
   * The three page families that answer a search a stranger types (docs/GROWTH-SEARCH.md §4.5).
   * Each has an index and one address per entry, and each carries the slug and nothing else:
   * whether we hold an entry at that slug is the page's question, because answering it here would
   * drag the compiled syllabus into the entry chunk.
   */
  | { name: 'glossary' }
  | { name: 'glossaryEntry'; slug: string }
  | { name: 'exams' }
  | { name: 'examBoard'; board: string }
  | { name: 'compare' }
  | { name: 'compareEntry'; slug: string }
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
      return route.cardId
        ? `/course/${encodeURIComponent(route.topicId)}/${CARD_SEGMENT}/${encodeURIComponent(route.cardId)}`
        : `/course/${encodeURIComponent(route.topicId)}`;
    case 'sandbox':
      return route.topicId ? `/sandbox/${encodeURIComponent(route.topicId)}` : '/sandbox';
    case 'arcade':
      return `/arcade/${encodeURIComponent(route.topicId)}`;
    case 'helpArticle':
      return `/help/${encodeURIComponent(route.group)}/${encodeURIComponent(route.slug)}`;
    case 'syllabus':
      return addressPath(route);
    case 'subjectHub':
      return hubPath(route.subject);
    case 'blog':
      return BLOG_ROOT_PATH;
    case 'blogPost':
      return `${BLOG_ROOT_PATH}/${encodeURIComponent(route.slug)}`;
    case 'blogTag':
      return `${BLOG_ROOT_PATH}/${BLOG_TAG_SEGMENT}/${encodeURIComponent(route.tag)}`;
    case 'glossaryEntry':
      return `/glossary/${encodeURIComponent(route.slug)}`;
    case 'examBoard':
      return `/exams/${encodeURIComponent(route.board)}`;
    case 'compareEntry':
      return `/compare/${encodeURIComponent(route.slug)}`;
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
    case 'parent':
      return route.action ? `/parent/${route.action}` : '/parent';
    case 'parent-preview':
      return PARENT_PREVIEW_PATH;
    default:
      return `/${route.name}`;
  }
}

/**
 * THE ADDRESS OF RECORD for a route, relative: the one the sitemap publishes, the one the canonical
 * declares, and therefore the one every href on the site has to carry.
 *
 * It is not the same thing as `routeToPath`, and the difference is the whole point of it.
 * `routeToPath` is a bijection — every route has its own path and every path parses back to its own
 * route — which is what the history and the back gesture are built on, so `landing` keeps
 * `/landing` there. But the front page is PUBLISHED at `/`: that is the address in
 * `public/sitemap.xml`, the address the pre-renderer writes a real file for, and the address every
 * page's canonical points at. `/landing` is a rewrite into the SPA shell, with no words, no
 * heading and a `noindex` on it.
 *
 * With the href taken from `routeToPath`, the wordmark in the header and the wordmark in the
 * footer sent every reader and every crawler to that shell: 604 of the 605 published pages spent
 * their most-repeated internal link on a wordless page, and only 3 pages linked the front page at
 * all. `/landing` still resolves, so an old link never breaks; it simply is not what we link.
 */
export function addressOf(route: Route): string {
  return route.name === 'landing' ? '/' : routeToPath(route);
}

/**
 * The one address a crawler should index this route at, absolute.
 *
 * `landing` and `home` are both the front door and both answer at `/`, which is the address
 * `public/sitemap.xml` publishes, so both canonicalise there.
 */
export function canonicalUrl(route: Route, origin?: string): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const base = (origin ?? env.VITE_APP_URL ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  return `${base}${addressOf(route)}`;
}

/** What the head says about a route: written by the provider on every route change. */
export interface Head {
  /** A title the ROUTER owns. Null for every real page, which sets its own. */
  title: string | null;
  /** `noindex` on a page that says nothing is here; null everywhere else. */
  robots: 'noindex' | null;
  /** The one address a crawler should index this route at; null where nothing should be indexed. */
  canonical: string | null;
  /**
   * Every tag this page's head should carry, from `shell/head.ts` — the title, the description,
   * the canonical, and the social tags a share card is drawn from. The RUNNING app writes only the
   * first three (a crawler never sees a tag JavaScript wrote, and the entry chunk is a stranger's
   * first download); `scripts/prerender.ts` writes all of them into the file it emits per address,
   * asking THIS function for them, so the file and the app can never disagree.
   */
  tags: HeadTag[];
}

/** What the page's own render told the build about itself. Absent while the app is running. */
export interface PageFacts {
  title?: string;
  description?: string;
  /** The absolute address of the share card drawn for this page. */
  image?: string | null;
}

const NOT_FOUND_TITLE = 'Page not found · Wobo';

/**
 * The two routes that do not write their own title, and what the ROUTER says for them.
 *
 * Every other public page sets its own title and opens with its own words, so its head is written
 * from what it actually says. These two cannot: the 404 exists to say nothing is here, and the
 * front page is a marketing screen whose tab read the bare product name, which tells an engine
 * nothing about which Wobo this is (three products share the name — docs/GROWTH-ENTITY.md).
 *
 * The home page's description is the press kit's one line rather than its own opening paragraph,
 * because that line is used verbatim on every listing, store and profile we own, and the sameness
 * across sources is the entire lever (docs/copy/press-kit.md).
 */
const ROUTER_OWNED: Partial<Record<Route['name'], { title: string; description: string }>> = {
  landing: { title: HOME_TITLE, description: BRAND_DESCRIPTION },
  notfound: { title: NOT_FOUND_TITLE, description: '' },
};

/** Titles the router put there, and may therefore take back on the way to a page that sets one. */
const ROUTER_TITLES = new Set(
  Object.values(ROUTER_OWNED)
    .map((owned) => owned.title)
    .filter(Boolean),
);

/**
 * ADDRESSES A PAGE HAS DISOWNED. The router cannot know which syllabus addresses the build wrote a
 * page for (answering that here would put the whole syllabus in the entry chunk), so the page
 * says so as it renders: an address with nothing published behind it (a topic, a chapter the gate
 * refused) still draws, and asks not to be indexed, with no canonical, exactly like a 404 does.
 */
const DISOWNED = new Set<string>();

export function disown(path: string, disowned: boolean): void {
  if (disowned) DISOWNED.add(path);
  else DISOWNED.delete(path);
}

/** Write the two head tags the running app owns: the canonical and the robots line. */
function writeHead(head: Head): void {
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (head.canonical) {
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = head.canonical;
  } else {
    canonical?.remove();
  }
  let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (head.robots) {
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = head.robots;
  } else {
    robots?.remove();
  }
}

/**
 * The page's half of the above. Registered during render, so the router's own head effect (which
 * runs after the page's in the same commit) reads it; and written from an effect too, for a page
 * that mounts after the router already wrote the head (a lazy screen).
 */
export function useDisowned(path: string, disowned: boolean): void {
  disown(path, disowned);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `headFor` reads the registry `disowned` just changed
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (window.location.pathname !== path) return;
    const route = routeFromPath(path);
    if (route) writeHead(headFor(route));
  }, [path, disowned]);
}

/**
 * A 404 KEEPS ITS ADDRESS AND DISOWNS IT. The bar shows what the learner typed or followed (the
 * comment on `routeToPath` says why), but the head used to be written from that address as though
 * the page were real: `/for-schools`, a surface removed on purpose, answered with a canonical
 * pointing at itself, no `noindex`, and a tab that read the bare "Wobo" because the 404 screen sets
 * no title (wave 29, site-8). So a crawler was invited to index a page whose only content is that
 * nothing exists there. Now the 404 carries a title that says so, asks not to be indexed, and
 * claims no canonical; every other route declares its own address and leaves the title to the page.
 */
export function headFor(route: Route, origin?: string, facts?: PageFacts): Head {
  const owned = ROUTER_OWNED[route.name];
  const gone = route.name === 'notfound';
  const unwritten = !gone && DISOWNED.has(addressOf(route));
  const canonical = gone || unwritten ? null : canonicalUrl(route, origin);
  const robots = gone || unwritten ? ('noindex' as const) : null;
  const title = (owned?.title ?? facts?.title ?? '').trim();
  const description = (owned ? owned.description : (facts?.description ?? '')).trim();
  return {
    title: owned?.title ?? null,
    robots,
    canonical,
    tags: headTags({
      title,
      description,
      canonical,
      robots,
      image: gone ? null : (facts?.image ?? null),
    }),
  };
}

/**
 * Every route whose address is just its own name. Exported so `test/addresses.test.ts` can hold
 * `vercel.json` to it: an address the router answers and the host serves nothing for is a 404 on a
 * page that exists, and an address the host rewrites into the app shell that the router does NOT
 * answer is a 200 on a page that does not.
 */
export const PLAIN_ROUTES = new Set([
  'landing',
  'onboarding',
  'building',
  'chat',
  'learn',
  'practice',
  'progress',
  'you',
  'doubt',
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
  // The press kit (docs/GROWTH-PRESS.md §2). It is a file the build writes, not a shell
  // rewrite: a journalist with JavaScript off and an answer engine that never runs any both have
  // to be able to read the whole kit off the page.
  'press',
  'meet-wobo',
  'for-parents',
  'for-students',
  'how-it-works',
  'subjects',
  // The three growth families' index pages. Their entry pages take a slug and are matched below.
  'glossary',
  'exams',
  'compare',
  'ui-kit',
]);

const INTENTS = new Set(['learn', 'practice']);
/** The four doors of a parent account, and nothing else, under `/parent`. */
const PARENT_ACTIONS = new Set(['ask', 'pay', 'refer', 'donate']);
/** The learner's own preview of the parent's week, under the learner's own page. */
const PARENT_PREVIEW_PATH = '/you/parent';
/**
 * The segment between a course and one of its cards. A course id may not BE this word at the
 * second position, which costs nothing: the segment only ever appears after a course id.
 */
const CARD_SEGMENT = 'card';
/**
 * The blog's root and the one segment under it that is not a post. They are spelled here rather
 * than imported from `site/blog/post.ts` so this module stays a leaf: the router is loaded before
 * anything else on the page, and it must not reach into a screen to answer an address.
 * `blog/routes.test.ts` holds the two spellings to each other.
 */
const BLOG_ROOT = 'blog';
const BLOG_ROOT_PATH = '/blog';
const BLOG_TAG_SEGMENT = 'tag';
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
  if (head === 'parent' && rest.length === 1) {
    const action = rest[0] ?? '';
    return PARENT_ACTIONS.has(action)
      ? { name: 'parent', action: action as 'ask' | 'pay' | 'refer' | 'donate' }
      : null;
  }
  if (head === 'you' && rest.length === 1 && rest[0] === 'parent')
    return { name: 'parent-preview' };
  if (head === 'subject') {
    const subjectId = decode(rest[0]);
    const intent = rest[1];
    if (!subjectId || !intent || !INTENTS.has(intent)) return null;
    return { name: 'subject', subjectId, intent: intent as 'learn' | 'practice' };
  }
  if (head === 'course') {
    const topicId = decode(rest[0]);
    if (!topicId) return null;
    if (rest.length === 1) return { name: 'course', topicId };
    // `/course/<course>/card/<card>` and nothing else: a deeper address, or a card segment with
    // nothing after it, is a link that was cut short, and a 404 says so rather than dropping the
    // learner at the top of a course as though the link had worked.
    if (rest.length === 3 && rest[1] === CARD_SEGMENT) {
      const cardId = decode(rest[2]);
      return cardId ? { name: 'course', topicId, cardId } : null;
    }
    return null;
  }
  if (head === 'sandbox') {
    if (rest.length === 0) return { name: 'sandbox' };
    const topicId = decode(rest[0]);
    return topicId && rest.length === 1 ? { name: 'sandbox', topicId } : null;
  }
  if (head === 'arcade') {
    const topicId = decode(rest[0]);
    return topicId && rest.length === 1 ? { name: 'arcade', topicId } : null;
  }
  // The public syllabus family. `/learn` on its own is the app's learn screen and was matched
  // above; one segment deeper is a board, and each segment after it is one layer down.
  if (head === SYLLABUS_ROOT && rest.length > 0) {
    const address = addressFrom(rest.map(decode));
    return address ? { name: 'syllabus', ...address } : null;
  }
  // `/subjects` is the pitch page and was matched above; `/subjects/<subject>` is that subject
  // across every board that sets it.
  if (head === HUB_ROOT && rest.length === 1) {
    const subject = decode(rest[0]);
    return isSlug(subject) ? { name: 'subjectHub', subject } : null;
  }
  // The blog. `/blog` is the index, `/blog/tag/<tag>` a tag page, and anything else one segment
  // deep is a post; a post may therefore never be called "tag", which the compiler's gate refuses.
  if (head === BLOG_ROOT) {
    if (rest.length === 0) return { name: 'blog' };
    if (rest[0] === BLOG_TAG_SEGMENT) {
      const tag = decode(rest[1]);
      return tag && rest.length === 2 ? { name: 'blogTag', tag } : null;
    }
    const slug = decode(rest[0]);
    return slug && rest.length === 1 ? { name: 'blogPost', slug } : null;
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
    // ONE ADDRESS PER DOCUMENT. The footer used to link `/legal/terms` while the sitemap published
    // `/legal/terms-of-service`; both answered 200 and each declared ITSELF the original, so the
    // same 2,610 words sat at two self-canonicalising URLs and the site's own links pointed at the
    // one it did not publish (docs/GROWTH-SEARCH.md §2). The address of record is the document's
    // own filename — what the sitemap publishes — so a short form is resolved to it here, before a
    // route exists to write a canonical from. `vercel.json` 301s the alias at the edge as well, so
    // a crawler is never served the second address at all.
    return slug && rest.length === 1 ? { name: 'legal', slug: canonicalSlug(slug) } : null;
  }
  // The three growth families. One segment under the index is an entry; anything deeper is not an
  // address of ours, so it falls through to the 404 rather than to a page with a name in it.
  if (head === 'glossary') {
    const slug = decode(rest[0]);
    return slug && rest.length === 1 ? { name: 'glossaryEntry', slug } : null;
  }
  if (head === 'exams') {
    const board = decode(rest[0]);
    return board && rest.length === 1 ? { name: 'examBoard', board } : null;
  }
  if (head === 'compare') {
    const slug = decode(rest[0]);
    return slug && rest.length === 1 ? { name: 'compareEntry', slug } : null;
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

/**
 * The first address the router writes, and what it keeps of the one it was given.
 *
 * A Google sign-in comes back with the session in the FRAGMENT, and a mail link comes with its
 * token in the QUERY. Both are read by code in a lazy chunk (the SDK adopts the fragment when it is
 * built; the runtime spends the token when it mounts), and both scrub their own piece once read.
 * So when the path is the one that was asked for, the rest of the address is kept for them; it is
 * dropped only when the address is being corrected to a different path.
 */
export function bootAddressFor(at: {
  here: string;
  target: string;
  search: string;
  hash: string;
}): string {
  return at.here === at.target ? `${at.target}${at.search}${at.hash}` : at.target;
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
  // The document's own title as served (index.html's, the product name), which a 404 borrows the
  // tab from and hands back on the way to any real page.
  const baseTitle = useRef(typeof document === 'undefined' ? 'Wobo' : document.title);

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
    const target = bare ? '/' : routeToPath(stack[0] as Route);
    writePath(
      bootAddressFor({
        here: bare ? '/' : here,
        target,
        search: typeof window === 'undefined' ? '' : window.location.search,
        hash: typeof window === 'undefined' ? '' : window.location.hash,
      }),
      1,
      'replace',
    );
  }, []);

  // ONE PAGE, ONE DECLARED ADDRESS. There was no <link rel="canonical"> anywhere in the app, so
  // the front page was reachable at both `/` and `/landing` with nothing saying which one it is,
  // and a crawler had to guess. The tag is written on every route change: `landing` canonicalises
  // to `/`, which is what the sitemap publishes, and every other page declares its own path.
  //
  // The 404 is the one route the head says something different about (`headFor`): no canonical,
  // a `noindex`, and a title of its own, put back to the document's base title on the way to any
  // real page, which then sets its own.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const route = stack[stack.length - 1] as Route | undefined;
    if (!route) return;
    const head = headFor(route);
    writeHead(head);
    if (head.title) document.title = head.title;
    else if (ROUTER_TITLES.has(document.title)) document.title = baseTitle.current;
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
