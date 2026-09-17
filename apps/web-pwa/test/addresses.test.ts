/**
 * WHAT THE HOST DOES WITH AN ADDRESS, held to what the app says about it.
 *
 * Three faults the search audit found, and the three things this file holds shut
 * (docs/GROWTH-SEARCH.md §2):
 *
 *  1. SOFT SUCCESS ON EVERYTHING. `vercel.json` rewrote `/(.*)` to the app shell, so
 *     `/this-does-not-exist`, `/favicon.ico`, `/wobo-logo.png`, `/og.png` and `/llms.txt` all
 *     answered 200 with a page that said nothing. A crawler probing for a file was told the file
 *     was there. The rewrite is now the list of addresses the APP answers and nothing else, so
 *     anything the build did not write and the app does not own falls through to `dist/404.html`,
 *     which Vercel serves with a real 404.
 *  2. TWO ADDRESSES FOR EVERY LEGAL DOCUMENT. `/legal/terms` and `/legal/terms-of-service` both
 *     answered 200 and each claimed to be the original, with the footer linking one and the
 *     sitemap publishing the other. One address per document now — the sitemap's, which is the
 *     document's own filename — and every short alias is a 301 to it.
 *  3. A LINK THAT POINTS AT THE ALIAS puts the site's own weight on the address we just gave up,
 *     so no shipped source file may link one.
 *
 * These are asserted against the two files that decide it — `vercel.json` and the router — rather
 * than against a deployment, so a regression fails here rather than in a crawl three weeks later.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SLUG_ALIASES } from '../src/screens/legal/catalog';
import help from '../src/screens/site/content/help.json' with { type: 'json' };
import { expandPublicRoutes, llmsTxt } from '../src/screens/states/routes';
import { BRAND_DESCRIPTION } from '../src/shell/head';
import {
  addressOf,
  canonicalUrl,
  PLAIN_ROUTES,
  pathToRoute,
  type Route,
  routeToPath,
} from '../src/shell/router';

const APP = join(import.meta.dir, '..');
const REPO = join(APP, '..', '..');
const LEGAL_DIR = join(REPO, 'docs', 'legal');

interface Vercel {
  redirects?: { source: string; destination: string; statusCode?: number; permanent?: boolean }[];
  rewrites: { source: string; destination: string }[];
}
const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')) as Vercel;

const ORIGIN = 'https://heywobo.com';

/** Every legal document's own slug — the address the sitemap publishes. */
const documents = readdirSync(LEGAL_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => f.replace(/\.md$/, ''))
  .sort();

const helpArticles = (help.groups as { slug: string; articles: { slug: string }[] }[]).flatMap(
  (group) => group.articles.map((article) => ({ group: group.slug, slug: article.slug })),
);

/** The addresses the build writes a real HTML file for. A file beats a rewrite on Vercel. */
const prerendered = new Set(
  expandPublicRoutes({ helpArticles, legalSlugs: documents }).map((route) => route.path),
);

/**
 * Does one `vercel.json` rewrite source match this path?
 *
 * Only the two shapes this file uses are understood, on purpose: an exact address (`/you`) and a
 * prefix that carries the rest of the path (`/course/:path*`). Anything cleverer in the config
 * would silently widen what the SPA swallows, which is the bug being fixed, so a source this
 * cannot read is a failure rather than a pass.
 */
function matches(source: string, path: string): boolean {
  if (source.endsWith('/:path*')) {
    const prefix = source.slice(0, -'/:path*'.length);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (/[:*(]/.test(source)) throw new Error(`unreadable rewrite source: ${source}`);
  return source === path;
}

/** Does the SPA shell answer this path? */
function spaAnswers(path: string): boolean {
  return vercel.rewrites.some(
    (rule) => rule.destination === '/app.html' && matches(rule.source, path),
  );
}

/** What the host does with an address: a real page, the app shell, or a 404. */
function served(path: string): 'file' | 'app' | '404' {
  if (prerendered.has(path)) return 'file';
  return spaAnswers(path) ? 'app' : '404';
}

describe('every legal document has ONE address', () => {
  it('publishes the document’s own filename, and knows an alias for each short form', () => {
    for (const [alias, slug] of Object.entries(SLUG_ALIASES)) {
      expect(documents).toContain(slug);
      expect(documents).not.toContain(alias);
    }
  });

  it('walks every legal route and finds one canonical address each', () => {
    const seen = new Map<string, string[]>();
    for (const path of ['/legal', ...documents.map((s) => `/legal/${s}`)]) {
      const route = pathToRoute(path);
      expect(route).not.toBeNull();
      const canonical = canonicalUrl(route as NonNullable<typeof route>, ORIGIN);
      // The address of record is the address asked for: a published page is its own original.
      expect(canonical).toBe(`${ORIGIN}${path}`);
      seen.set(canonical, [...(seen.get(canonical) ?? []), path]);
    }
    // And every short alias resolves to the SAME canonical as the document it is a nickname for,
    // rather than claiming to be an original of its own — which is what it used to do.
    for (const [alias, slug] of Object.entries(SLUG_ALIASES)) {
      const route = pathToRoute(`/legal/${alias}`);
      expect(route).toEqual({ name: 'legal', slug });
      expect(canonicalUrl(route as NonNullable<typeof route>, ORIGIN)).toBe(
        `${ORIGIN}/legal/${slug}`,
      );
      expect(routeToPath(route as NonNullable<typeof route>)).toBe(`/legal/${slug}`);
    }
    // One address per document, and no address claimed by two documents.
    for (const [canonical, paths] of seen)
      expect([canonical, paths.length]).toEqual([canonical, 1]);
  });

  it('301s every alias to the document, at the edge, before anything else runs', () => {
    const redirects = vercel.redirects ?? [];
    for (const [alias, slug] of Object.entries(SLUG_ALIASES)) {
      const rule = redirects.find((r) => r.source === `/legal/${alias}`);
      expect(rule).toBeDefined();
      expect(rule?.destination).toBe(`/legal/${slug}`);
      expect(rule?.statusCode).toBe(301);
    }
  });

  it('links no alias from any shipped source file — the weight goes to the one address', () => {
    const aliases = Object.keys(SLUG_ALIASES);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__snapshots__') continue;
          walk(full);
          continue;
        }
        if (!/\.(tsx?|css|json)$/.test(entry.name)) continue;
        if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
        // An href, never a sentence. The comments in these files discuss the old addresses by
        // name — that is the record of why they were given up — so they are taken out first.
        const source = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/^\s*\/\/.*$/gm, ' ');
        for (const alias of aliases) {
          if (new RegExp(`["']/legal/${alias}["']`).test(source)) {
            offenders.push(`${full.slice(APP.length + 1)} → /legal/${alias}`);
          }
        }
      }
    };
    walk(join(APP, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('a missing address is a 404, not a success', () => {
  it('no longer rewrites the whole site into the app shell', () => {
    expect(vercel.rewrites.some((r) => r.source === '/(.*)')).toBe(false);
    expect(vercel.rewrites[0]?.source).toBe('/db/:path*');
  });

  it('answers a path that is not ours with nothing, so the host serves 404.html', () => {
    for (const path of [
      '/this-does-not-exist-404',
      '/for-schools',
      '/help/nope/nothing',
      '/legal/not-a-document',
      '/blog/not-a-post',
      '/plans/pay',
    ]) {
      expect([path, served(path)]).toEqual([path, '404']);
    }
  });

  it('answers an asset that is not there with nothing either', () => {
    for (const file of [
      '/favicon.ico',
      '/wobo-logo.png',
      '/og.png',
      '/og-image.png',
      '/llms.txt',
    ]) {
      expect([file, spaAnswers(file)]).toEqual([file, false]);
    }
  });

  it('still boots the app for every address the app itself owns', () => {
    // The private app, whose screens only exist once someone has signed in.
    for (const path of [
      '/',
      '/landing',
      '/onboarding',
      '/building',
      '/chat',
      '/learn',
      '/practice',
      '/progress',
      '/you',
      '/doubt',
      '/parent',
      // the parent account's four doors, and the learner's own preview that moved off /parent
      '/parent/ask',
      '/parent/pay',
      '/parent/refer',
      '/parent/donate',
      '/you/parent',
      '/sandbox',
      '/sandbox/photosynthesis',
      '/subject/science/learn',
      '/course/photosynthesis',
      '/concept/engines',
      '/sitemap',
    ]) {
      expect([path, served(path)]).not.toEqual([path, '404']);
    }
  });

  it('covers every plain route the router answers, by a file or by the shell', () => {
    for (const name of PLAIN_ROUTES) {
      const path = `/${name}`;
      expect([path, served(path)]).not.toEqual([path, '404']);
    }
  });

  it('writes every public address as a real file, so a file always beats the shell', () => {
    for (const path of ['/', '/about', '/plans', '/help', '/legal', '/legal/terms-of-service']) {
      expect([path, prerendered.has(path)]).toEqual([path, true]);
    }
  });
});

describe('the files a crawler asks for by name are real files', () => {
  const PUBLIC_DIR = join(APP, 'public');

  it('serves an llms.txt that is generated, not typed, so it cannot promise a dead address', () => {
    const written = readFileSync(join(PUBLIC_DIR, 'llms.txt'), 'utf8');
    expect(written).toBe(llmsTxt(ORIGIN, BRAND_DESCRIPTION));
    expect(written.startsWith('# Wobo\n')).toBe(true);
    // The press kit's one line, word for word, the same sentence every other surface carries.
    expect(written).toContain(BRAND_DESCRIPTION);
    // The brand is Wobo; heywobo.com is only an address (docs/GROWTH-ENTITY.md §2).
    expect(written).not.toMatch(/HeyWobo|Hey Wobo/);
    expect(written).not.toContain('—');
    for (const link of written.matchAll(/\]\((https:\/\/[^)]+)\)/g)) {
      const path = new URL(link[1] as string).pathname;
      if (path === '/sitemap.xml' || path === '/robots.txt') continue;
      expect([path, prerendered.has(path)]).toEqual([path, true]);
    }
  });

  it('serves a favicon.ico that is an icon, at the sizes a browser picks from', () => {
    const ico = readFileSync(join(PUBLIC_DIR, 'favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1); // an icon, not a cursor
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);
    const sizes: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + 16 * i;
      sizes.push(ico.readUInt8(entry) || 256);
      const bytes = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset + bytes).toBeLessThanOrEqual(ico.length);
      // Each frame is a PNG, which is what every browser since IE11 reads out of an .ico.
      expect([...ico.subarray(offset, offset + 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it('names no asset in the install manifest that is not in public/', () => {
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
    const block = config.slice(config.indexOf('includeAssets: ['));
    const listed = [...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g)].map(
      (m) => m[1] as string,
    );
    expect(listed.length).toBeGreaterThan(3);
    const present = new Set(readdirSync(PUBLIC_DIR));
    for (const name of listed) expect([name, present.has(name)]).toEqual([name, true]);
  });

  it('preloads every face the first screen sets in, which is the whole of the layout shift', () => {
    // Measured on the built site (Pixel 7, 1.6 Mbps, 4x CPU): with only Poppins 700 and Caveat
    // preloaded, the hero reflowed 386ms after first paint as the other weights swapped in — one
    // shift of 0.2484, the site's entire CLS and more than twice the 0.1 a page is allowed. With
    // all five named it is 0.0000 (docs/GROWTH-SEARCH.md §2).
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
    for (const face of [
      '/fonts/Poppins-400-latin.woff2',
      '/fonts/Poppins-500-latin.woff2',
      '/fonts/Poppins-600-latin.woff2',
      '/fonts/Poppins-700-latin.woff2',
      '/fonts/Caveat-latin.woff2',
    ]) {
      expect(config).toContain(`'${face}'`);
      expect([
        face,
        readdirSync(join(PUBLIC_DIR, 'fonts')).includes(face.split('/').pop() as string),
      ]).toEqual([face, true]);
    }
  });
});

/**
 * THE ADDRESS THE SITE'S OWN LINKS CARRY.
 *
 * The front page is published at `/` — that is what `public/sitemap.xml` declares, what every
 * pre-rendered page's canonical points at, and the only one of the two that is a real file. But the
 * wordmark in the header and the wordmark in the footer are `SiteLink to={{ name: 'landing' }}`,
 * and the href came from `routeToPath`, which answers `/landing`. `/landing` is a rewrite into the
 * SPA shell: 3,833 bytes, no words, no heading, `noindex`. So 604 of the 605 published pages spent
 * their most-repeated internal link on a wordless page, and only 3 linked the front page at all.
 */
describe('every link on the site points at the address of record', () => {
  it('gives the front page one address, and it is the one the sitemap publishes', () => {
    expect(addressOf({ name: 'landing' })).toBe('/');
    expect(canonicalUrl({ name: 'landing' }, ORIGIN)).toBe(`${ORIGIN}/`);
    // `/landing` is still an address the app answers, so an old link never breaks. It simply is
    // not what anything on the site links to any more.
    expect(routeToPath({ name: 'landing' })).toBe('/landing');
    expect(spaAnswers('/landing')).toBe(true);
  });

  it('leaves every other route at its own path', () => {
    const others: Route[] = [
      { name: 'about' },
      { name: 'plans' },
      { name: 'legal', slug: 'terms-of-service' },
      { name: 'help' },
    ];
    for (const route of others) expect(addressOf(route)).toBe(routeToPath(route));
  });
});
