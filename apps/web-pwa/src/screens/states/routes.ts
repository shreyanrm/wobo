/**
 * Every address a crawler is allowed to know about.
 *
 * The rule: a route belongs here only when someone with no account can open it and read something.
 * Everything past the front door is a signed-in learner's own app, rendered client-side — listing
 * those paths would promise a crawler pages that do not exist for it, and a sitemap that lies is
 * worse than a short one.
 *
 * `scripts/sitemap.ts` builds `public/sitemap.xml` and `public/robots.txt` from this list, and
 * `routes.test.ts` asserts every entry is an address the router actually answers, so a route that
 * gets renamed cannot quietly leave a dead URL in the sitemap.
 *
 * Nothing in the running app imports this module, which is why it may import the syllabus family's
 * gate (`screens/syllabus/pages.ts`) and, through it, the whole frozen syllabus. A build script
 * pays that cost once; a visitor never sees it.
 */

import { comparePaths } from '../growth/comparisons';
import { glossaryPaths } from '../growth/concepts';
import { examPaths } from '../growth/examCycle';
import { BLOG } from '../site/blog/blog-content';
import { releasedPages } from '../syllabus/pages';

export interface PublicRoute {
  path: string;
  /** How often the page's content genuinely changes. */
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Relative to the other pages here, not an absolute claim. */
  priority: string;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/sign-up', changefreq: 'monthly', priority: '0.8' },
  { path: '/sign-in', changefreq: 'monthly', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.7' },
  // The six pitch pages (SITE.md §2): the pill nav's five and the security page the footer links.
  { path: '/meet-wobo', changefreq: 'monthly', priority: '0.8' },
  { path: '/how-it-works', changefreq: 'monthly', priority: '0.8' },
  { path: '/for-parents', changefreq: 'monthly', priority: '0.8' },
  { path: '/for-students', changefreq: 'monthly', priority: '0.8' },
  { path: '/subjects', changefreq: 'monthly', priority: '0.8' },
  { path: '/security', changefreq: 'monthly', priority: '0.6' },
  // The index pages of the two document sets. Every article and every legal document is addressable
  // too, and `expandPublicRoutes` adds them from the compiled content at build time — a crawler
  // that only knows the two index pages has to guess at forty-four addresses it could be told.
  { path: '/help', changefreq: 'weekly', priority: '0.7' },
  { path: '/legal', changefreq: 'monthly', priority: '0.4' },
  // The blog's index. Every post and every published tag is addressable too and is added by
  // `expandPublicRoutes` from the compiled blog, so the sitemap can never promise a post the gate
  // refused. This is the origin everything else syndicates from (docs/GROWTH-DESK.md §3).
  { path: '/blog', changefreq: 'weekly', priority: '0.7' },
  { path: '/plans', changefreq: 'monthly', priority: '0.7' },
  // NOT `/plans/checkout`, and that is a decision rather than an omission. It is a real page with
  // real words on it, and the words are that the thing does not work yet: "Paying is not open yet.
  // The prices are set and printed on the plans page, but the payment page is not open yet, so
  // nothing can be charged." Published, it carried a canonical of its own and no `noindex`, so the
  // site was asking an engine to index the page that says Wobo cannot be bought. It is a step in a
  // funnel, not an address to win: `vercel.json` rewrites it into the app shell like /onboarding,
  // /gift's "Choose a gift" still opens it, and it is not offered to a crawler.
  { path: '/gift', changefreq: 'monthly', priority: '0.5' },
  { path: '/donate', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact', changefreq: 'monthly', priority: '0.5' },
];

/** The addresses that exist only once the copy has been compiled. */
export interface SubAddresses {
  /** Every published help article, group and slug, from `site/content/help.json`. */
  helpArticles?: readonly { group: string; slug: string }[];
  /** Every legal document's own slug, from the filenames in `docs/legal/`. */
  legalSlugs?: readonly string[];
  /**
   * The syllabus family, from `screens/syllabus/pages.ts`. Defaults to the pages that pass that
   * family's own quality gate AND are released in this build; pass `[]` to publish none of them.
   * A caller never assembles this list by hand: the gate is what decides, so a page cannot reach
   * the sitemap without the provenance and the word count that make it worth indexing.
   */
  syllabus?: readonly PublicRoute[];
  /**
   * The blog: one address per published post and one per published tag. Defaults to the compiled
   * blog, so a post reaches the sitemap by being published and never by being listed here; pass
   * `[]` to publish none of them.
   */
  blog?: readonly PublicRoute[];
  /**
   * The three growth families: the glossary, the exam-cycle pages and the side-by-side pages.
   * Defaults to whatever passed each family's own quality gate, so an entry reaches the sitemap by
   * being publishable and never by being listed here; pass `[]` to publish none of them.
   */
  growth?: readonly PublicRoute[];
}

/**
 * The full list: the fixed addresses above, plus one entry per help article and per legal document.
 *
 * These are pages a person can open, bookmark and share, and they are exactly the pages somebody
 * searches for ("wobo refund policy", "wobo board not listed"). Leaving them out of the sitemap
 * while listing the two index pages tells a crawler the site is five pages deep when it is fifty.
 *
 * A duplicate is dropped rather than written twice, and the order is stable — the fixed addresses
 * first, then articles in the compiled order, then documents in the order they were given — so the
 * generated file only changes when the site does.
 */
export function expandPublicRoutes(
  sub: SubAddresses = {},
  base: readonly PublicRoute[] = PUBLIC_ROUTES,
): PublicRoute[] {
  const out: PublicRoute[] = [...base];
  const seen = new Set(out.map((r) => r.path));
  const add = (route: PublicRoute): void => {
    if (seen.has(route.path)) return;
    seen.add(route.path);
    out.push(route);
  };
  for (const article of sub.helpArticles ?? []) {
    add({
      path: `/help/${article.group}/${article.slug}`,
      changefreq: 'monthly',
      priority: '0.5',
    });
  }
  for (const slug of sub.legalSlugs ?? []) {
    add({ path: `/legal/${slug}`, changefreq: 'yearly', priority: '0.3' });
  }
  // The syllabus family. It is added LAST and it is the only family whose membership is decided by
  // a gate rather than by a directory listing: a chapter page reaches this list only if it carries
  // the official document it came from, the hash of the bytes we read, and real words on the page
  // (`screens/syllabus/pages.ts`). The count that ends up in the sitemap is therefore the count we
  // can prove, which is the honest-count law stated as code (WOBO-TASKS §10.21).
  for (const route of sub.syllabus ?? syllabusRoutes()) add(route);
  // The blog, from the compiled blog rather than from a list anybody keeps by hand. A post the
  // blog's own gate refused is not in `blog.json`, so it cannot reach the sitemap.
  for (const route of sub.blog ?? blogRoutes()) add(route);
  // The three growth families, on the same rule as the syllabus: each family's own gate decides
  // membership, so a page with nothing on it cannot be promised to a crawler.
  for (const route of sub.growth ?? growthRoutes()) add(route);
  return out;
}

/**
 * Every syllabus address this build publishes, as sitemap rows. Kept in a function rather than a
 * constant so nothing pays for the syllabus at import time, and so the process environment can set
 * the pace (`WOBO_SYLLABUS_LAYERS`) without a code change.
 */
export function syllabusRoutes(
  env: Record<string, string | undefined> = typeof process === 'undefined'
    ? {}
    : (process.env as Record<string, string | undefined>),
): PublicRoute[] {
  return releasedPages(env).map((page) => ({
    path: page.path,
    changefreq: page.changefreq,
    priority: page.priority,
  }));
}

/**
 * Every blog address this build publishes, as sitemap rows.
 *
 * It is read from the compiled blog rather than passed in by the two build scripts, because
 * `scripts/**` belongs to another wave for the length of this one: reading it here means
 * `sitemap.ts` and `prerender.ts` pick the blog up with no edit to either. A post is dated, so its
 * own page changes rarely; the tag pages change whenever a post joins them.
 */
function blogRoutes(): PublicRoute[] {
  return [
    ...BLOG.posts.map<PublicRoute>((post) => ({
      path: `/blog/${post.slug}`,
      changefreq: 'yearly',
      priority: '0.6',
    })),
    ...BLOG.tags.map<PublicRoute>((tag) => ({
      path: `/blog/tag/${tag.slug}`,
      changefreq: 'monthly',
      priority: '0.4',
    })),
  ];
}

/**
 * Every growth address this build publishes, as sitemap rows.
 *
 * The index of each family changes as its entries do; a glossary entry changes when the syllabus
 * behind it does, which is rarely; an exam-cycle page changes whenever a board publishes, which is
 * the whole point of it; a side-by-side page changes when a product's own page does, which is
 * often enough to say weekly and mean it.
 */
function growthRoutes(): PublicRoute[] {
  type Rest = Omit<PublicRoute, 'path'>;
  // Every family hands back its index first and its entries after, so the first row takes the
  // index's own rate and the rest take the entry's.
  const rows = (paths: string[], index: Rest, entry: Rest): PublicRoute[] =>
    paths.map((path, at) => ({ path, ...(at === 0 ? index : entry) }));
  return [
    ...rows(
      glossaryPaths(),
      { changefreq: 'monthly', priority: '0.6' },
      { changefreq: 'yearly', priority: '0.5' },
    ),
    ...rows(
      examPaths(),
      { changefreq: 'weekly', priority: '0.7' },
      { changefreq: 'weekly', priority: '0.7' },
    ),
    ...rows(
      comparePaths(),
      { changefreq: 'monthly', priority: '0.6' },
      { changefreq: 'weekly', priority: '0.6' },
    ),
  ];
}

/** Paths a crawler is told to leave alone. Nothing here is a page. */
export const DISALLOWED: readonly string[] = [
  // The database proxy (vercel.json rewrites /db/* to the project).
  '/db/',
];

/** The site's own origin, from the environment, so the domain swap stays one change (§8). */
export function siteOrigin(env: Record<string, string | undefined> = {}): string {
  const raw = env.VITE_APP_URL ?? env.APP_URL ?? 'https://heywobo.com';
  return raw.replace(/\/+$/, '');
}

export function sitemapXml(origin: string, routes: readonly PublicRoute[] = PUBLIC_ROUTES): string {
  const entries = routes
    .map(
      (r) =>
        `  <url>\n    <loc>${origin}${r.path}</loc>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generated by scripts/sitemap.ts from src/screens/states/routes.ts. Do not edit by hand. -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(origin: string, disallowed: readonly string[] = DISALLOWED): string {
  return [
    `# ${origin}`,
    '# Generated by scripts/sitemap.ts. Do not edit by hand.',
    'User-agent: *',
    'Allow: /',
    ...disallowed.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * `public/llms.txt`, the file an answer engine looks for before it reads anything else.
 *
 * WHY IT EXISTS. `/llms.txt` used to answer 200 with the app shell: an HTML page, of the wrong
 * type, containing no words (docs/GROWTH-SEARCH.md §2). A crawler probing for the file was told
 * the file was there and handed nothing, which is worse than a 404. No engine is known to read
 * this format today; it costs a few lines, it is what a machine expects to find at that address,
 * and it says plainly what this site is and where its pages are.
 *
 * WHAT IT MAY SAY. The one line is the press kit's, word for word, the same sentence the meta
 * description, the store blurbs and every listing carry, because sameness across sources is the
 * whole entity lever (docs/copy/press-kit.md, GROWTH-ENTITY.md §4). The name is Wobo; heywobo.com
 * is only the address. The links are built from the route table above rather than typed here, so a
 * renamed route cannot leave a dead link in the file, and nothing is promised that the sitemap
 * does not publish.
 */
const LLMS_LINES: readonly (readonly [path: string, name: string, line: string])[] = [
  ['/', 'Wobo', 'What Wobo is, and one question answered four ways.'],
  ['/meet-wobo', 'Meet Wobo', 'The tutor itself: how it draws, speaks and reads a page.'],
  ['/how-it-works', 'How Wobo works', 'What happens in a lesson, step by step.'],
  ['/subjects', 'Subjects', 'The boards, the classes and the subjects Wobo covers.'],
  ['/for-parents', 'For parents', 'What a parent sees, and what Wobo will not do.'],
  ['/for-students', 'For students', 'What a learner gets, and what it costs them.'],
  ['/plans', 'Plans', 'Free every day, and what a paid plan buys.'],
  ['/security', 'Security and trust', 'How the product is built, and what it does with data.'],
  ['/help', 'Help centre', 'One article per question a learner or a parent asks.'],
  ['/legal', 'Legal', 'Every legal document, each in plain words first.'],
  ['/blog', 'Blog', 'What we are building, and what we are learning.'],
  ['/about', 'About', 'Who makes Wobo, and why.'],
  ['/contact', 'Contact', 'How to reach a person here.'],
  ['/gift', 'Gift', 'Buying a place for someone else.'],
  ['/donate', 'Donate', 'Paying for a place for a family who cannot.'],
];

export function llmsTxt(
  origin: string,
  description: string,
  routes: readonly PublicRoute[] = PUBLIC_ROUTES,
): string {
  const known = new Set(routes.map((r) => r.path));
  const links = LLMS_LINES.filter(([path]) => known.has(path)).map(
    ([path, name, line]) => `- [${name}](${origin}${path}): ${line}`,
  );
  return [
    '# Wobo',
    '',
    `> ${description}`,
    '',
    'Wobo is made by Dot eVentures Pvt Ltd in Hyderabad, India. Every page listed below is public',
    'and readable without an account. Everything else on this site is a signed-in learner’s own',
    'work and is not published.',
    '',
    '## Pages',
    '',
    ...links,
    '',
    '## More',
    '',
    `- [Sitemap](${origin}/sitemap.xml): every published address on this site.`,
    `- [Robots](${origin}/robots.txt): what a crawler may read.`,
    '',
  ].join('\n');
}
