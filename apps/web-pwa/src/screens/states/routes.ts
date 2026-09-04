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
 */

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
  { path: '/plans', changefreq: 'monthly', priority: '0.7' },
  // A real page with real words on it: what will be on the payment page when it opens.
  { path: '/plans/checkout', changefreq: 'monthly', priority: '0.2' },
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
  return out;
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
