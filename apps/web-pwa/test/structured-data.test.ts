/**
 * THE ENTITY GRAPH, READ OFF THE BUILT FILES RATHER THAN OFF THE INTENTION.
 *
 * The audit of 2026-09-09 found `0` elements matching `script[type="application/ld+json"]` on
 * every page of the site (docs/GROWTH-SEARCH.md §2), which is the reason an answer engine asked
 * about "Wobo AI tutor" describes a job-search app: nothing on our site ever told it what the name
 * refers to. This reads the emitted HTML the way a crawler that does not run JavaScript reads it,
 * parses whatever JSON-LD is actually in the bytes, and holds it to four shapes and one law.
 *
 * The build runs exactly these rules too (`scripts/jsonld-check.ts`, called from
 * `scripts/prerender.ts`) and fails on any violation, so this is the second reading of the same
 * evidence rather than the only one.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkStructuredData,
  extractJsonLd,
  nodesOfType,
  reportViolations,
} from '../scripts/jsonld-check';
import { MANIFEST_FILE, type PrerenderManifest } from '../scripts/prerender-manifest';
import { BRAND_DESCRIPTION } from '../src/shell/head';
import { APP_PAGES, namingViolations, RETIRED_TYPES } from '../src/shell/jsonld';
import { sameAs } from '../src/shell/profiles';

const APP = join(import.meta.dir, '..');
const DIST = join(APP, 'dist');
const MANIFEST = join(APP, MANIFEST_FILE);

const manifest: PrerenderManifest | null = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as PrerenderManifest)
  : null;

const pages = (manifest?.pages ?? []).map((page) => ({
  path: page.path,
  file: page.file,
  html: readFileSync(join(DIST, page.file), 'utf8'),
}));

describe.skipIf(!manifest)('every built page declares the entity', () => {
  it('carries linked data a parser can read, on every single address', () => {
    const silent = pages.filter((page) => extractJsonLd(page.html).length === 0);
    expect(silent.map((p) => p.path)).toEqual([]);
    expect(pages.length).toBeGreaterThan(0);
  });

  it('passes every shape rule the build itself runs', () => {
    const bad = checkStructuredData(pages, manifest?.origin ?? '');
    expect(reportViolations(bad)).toBe('');
    expect(bad).toEqual([]);
  });

  it('names the same Organization on every page, in the press kit’s own words', () => {
    for (const page of pages) {
      const [org] = nodesOfType(extractJsonLd(page.html), 'Organization');
      expect(org?.name).toBe('Wobo');
      expect(org?.description).toBe(BRAND_DESCRIPTION);
      expect(org?.['@id']).toBe(`${manifest?.origin}/#organization`);
      expect((org?.parentOrganization as { name?: string })?.name).toBe('Dot eVentures Pvt Ltd');
    }
  });

  it('publishes exactly the listings the ledger says are ours, and no others', () => {
    const claimed = sameAs();
    for (const page of pages) {
      const [org] = nodesOfType(extractJsonLd(page.html), 'Organization');
      if (claimed.length === 0) expect(org?.sameAs).toBeUndefined();
      else expect(org?.sameAs).toEqual(claimed);
    }
  });

  it('heads a result with the site’s name rather than with the domain', () => {
    for (const page of pages) {
      const [site] = nodesOfType(extractJsonLd(page.html), 'WebSite');
      expect(site?.name).toBe('Wobo');
      expect(site?.url).toBe(`${manifest?.origin}/`);
    }
  });
});

describe.skipIf(!manifest)('where each page sits, and what the product is', () => {
  it('gives every page below the root a trail that ends at itself', () => {
    for (const page of pages) {
      const [crumbs] = nodesOfType(extractJsonLd(page.html), 'BreadcrumbList');
      if (page.path === '/') {
        expect(crumbs).toBeUndefined();
        continue;
      }
      const items = (crumbs?.itemListElement ?? []) as { position: number; item: string }[];
      expect(items.length).toBeGreaterThan(1);
      expect(items[0]?.item).toBe(`${manifest?.origin}/`);
      expect(items[items.length - 1]?.item).toBe(`${manifest?.origin}${page.path}`);
      expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
    }
  });

  it('declares the application on the home and plans pages, and nowhere else', () => {
    for (const page of pages) {
      const apps = nodesOfType(extractJsonLd(page.html), 'SoftwareApplication');
      expect(apps.length).toBe(APP_PAGES.has(page.path) ? 1 : 0);
    }
  });

  it('states the free tier honestly wherever it states a price', () => {
    for (const path of APP_PAGES) {
      const page = pages.find((p) => p.path === path);
      if (!page) continue;
      const [app] = nodesOfType(extractJsonLd(page.html), 'SoftwareApplication');
      const offers = (app?.offers ?? []) as { name?: string; price?: string }[];
      expect(offers.length).toBeGreaterThan(1);
      expect(offers.find((o) => o.name === 'Free')?.price).toBe('0');
    }
  });
});

describe.skipIf(!manifest)('the naming law, on the bytes that ship', () => {
  it('never lets a name field say HeyWobo, on any page', () => {
    const bad = pages.flatMap((page) =>
      namingViolations(extractJsonLd(page.html)).map((what) => `${page.path}: ${what}`),
    );
    expect(bad).toEqual([]);
  });

  it('lets heywobo.com appear only where an address belongs', () => {
    // Every occurrence of the domain in the graph, with the key it sits under. A `name` or a
    // `description` carrying it would be teaching an engine the address as the brand.
    const offenders: string[] = [];
    for (const page of pages) {
      for (const node of extractJsonLd(page.html)) {
        const walk = (value: unknown, key: string): void => {
          if (typeof value === 'string') {
            if (
              /heywobo/i.test(value) &&
              !/^(?:@id|url|logo|image|sameAs|item|contentUrl)$/.test(key)
            )
              offenders.push(`${page.path}: ${key}`);
            return;
          }
          if (Array.isArray(value)) {
            for (const item of value) walk(item, key);
            return;
          }
          if (value && typeof value === 'object')
            for (const [k, v] of Object.entries(value)) walk(v, k);
        };
        walk(node, '@root');
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

describe.skipIf(!manifest)('what we deliberately do not declare', () => {
  it('declares none of the schemas Google retired, on any page', () => {
    const found = new Set<string>();
    for (const page of pages) {
      for (const node of extractJsonLd(page.html)) {
        const type = String((node as { '@type'?: unknown })['@type']);
        if (RETIRED_TYPES.has(type)) found.add(`${page.path}: ${type}`);
      }
    }
    expect([...found]).toEqual([]);
  });
});
