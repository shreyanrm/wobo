/**
 * Build step: `public/sitemap.xml` and `public/robots.txt`.
 *
 * Also `public/llms.txt`, the short honest file an answer engine looks for first.
 *
 * All three are GENERATED, from the one list of addresses a crawler is allowed to know about
 * (`src/screens/states/routes.ts`). Hand-kept versions of these drift the moment a route is
 * renamed, and a sitemap that promises a page which 404s is worse for a site than no sitemap at
 * all — so the list lives beside the router, a unit test asserts every entry is an address the
 * router actually answers, and this script only writes them out.
 *
 * The fixed list is the front door and the index pages. The rest of the site is generated content:
 * one page per published help article and one per legal document. They are read here, from the
 * same two sources the app renders — the compiled help centre and the filenames in `docs/legal/` —
 * so a sitemap can never promise an article the build withheld or a document that was renamed.
 * An article the reviewer marked "do not ship" is not compiled, so it cannot reach this file.
 *
 * The origin comes from the environment (`VITE_APP_URL`), so the domain swap stays one change
 * (WOBO-PLAN §8). Nothing else is written, and nothing outside `public/` is touched.
 *
 * Run: `bun run scripts/sitemap.ts` (wired into `bun run build`, after `site:content`).
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import help from '../src/screens/site/content/help.json' with { type: 'json' };
import {
  expandPublicRoutes,
  llmsTxt,
  robotsTxt,
  sitemapXml,
  siteOrigin,
} from '../src/screens/states/routes';
import { BRAND_DESCRIPTION } from '../src/shell/head';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public');
const LEGAL_DIR = join(HERE, '..', '..', '..', 'docs', 'legal');

/** Every article the build published, group and slug. Withheld articles are simply not in here. */
function helpArticles(): { group: string; slug: string }[] {
  return (help.groups as { slug: string; articles: { slug: string }[] }[]).flatMap((group) =>
    group.articles.map((article) => ({ group: group.slug, slug: article.slug })),
  );
}

/** Every legal document's slug. The README is the index's source, not a page anyone reads. */
function legalSlugs(): string[] {
  return readdirSync(LEGAL_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function main(): void {
  const origin = siteOrigin(process.env as Record<string, string | undefined>);
  const routes = expandPublicRoutes({ helpArticles: helpArticles(), legalSlugs: legalSlugs() });
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_DIR, 'sitemap.xml'), sitemapXml(origin, routes), 'utf8');
  writeFileSync(join(PUBLIC_DIR, 'robots.txt'), robotsTxt(origin), 'utf8');
  // `/llms.txt` used to answer 200 with the app shell, so a crawler probing for it was told the
  // file was there and handed a page with no words in it. It is a real file now, generated from
  // the same route table, so it cannot promise an address the site does not serve.
  writeFileSync(join(PUBLIC_DIR, 'llms.txt'), llmsTxt(origin, BRAND_DESCRIPTION), 'utf8');
  console.log(
    `sitemap: ${routes.length} public ${routes.length === 1 ? 'address' : 'addresses'} at ${origin}, plus robots.txt and llms.txt`,
  );
}

main();
