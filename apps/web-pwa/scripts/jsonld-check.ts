/**
 * WHAT A PAGE'S LINKED DATA HAS TO BE, CHECKED ON THE EMITTED BYTES.
 *
 * Two callers run exactly these rules, which is the point of them living in one place:
 *
 *   · `scripts/prerender.ts`, at the end of the build, which FAILS THE BUILD on any violation, so
 *     a page that declares the wrong entity, or the wrong name, can never be deployed;
 *   · `test/structured-data.test.ts`, over whatever is in `dist`, which parses each file the way a
 *     crawler that does not run JavaScript parses it: off disk, with nothing executed.
 *
 * The rules come from what was actually wrong (docs/GROWTH-SEARCH.md §2, 2026-09-09): `0` elements
 * matching `script[type="application/ld+json"]` on every page of the site, so nothing on
 * heywobo.com had ever told a machine which of the three products called Wobo this one is.
 */

import { BRAND_DESCRIPTION, BRAND_NAME } from '../src/shell/head';
import {
  APP_PAGES,
  type JsonLd,
  namingViolations,
  ORG_FRAGMENT,
  RETIRED_TYPES,
  SITE_FRAGMENT,
} from '../src/shell/jsonld';
import { sameAs } from '../src/shell/profiles';
import type { PageFile, Violation } from './prerender-check';

export type { PageFile, Violation };

const SCRIPTS = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Every linked-data node in a page's bytes, with any `@graph` flattened into the list.
 *
 * A parse failure is not swallowed: a script tag that is not JSON is markup a crawler will drop on
 * the floor without telling anyone, which is the silent version of having no markup at all.
 */
export function extractJsonLd(html: string): JsonLd[] {
  const nodes: JsonLd[] = [];
  for (const match of html.matchAll(SCRIPTS)) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`a ld+json script does not parse: ${(error as Error).message}`);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of list) {
      const node = entry as JsonLd;
      const graph = node['@graph'];
      if (Array.isArray(graph)) nodes.push(...(graph as JsonLd[]));
      else nodes.push(node);
    }
  }
  return nodes;
}

/** Every node of one type, in the order the graph declares them. */
export function nodesOfType(nodes: readonly JsonLd[], type: string): JsonLd[] {
  return nodes.filter((node) => node['@type'] === type);
}

function isAbsolute(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * Every rule, over every emitted page. Returns what is wrong, empty when nothing is.
 *
 * `origin` is the origin of record for this build, taken from what the app itself rendered, so a
 * preview deploy is checked against its own domain rather than against the production one.
 */
export function checkStructuredData(pages: readonly PageFile[], origin: string): Violation[] {
  const bad: Violation[] = [];
  const site = origin.replace(/\/+$/, '');
  const listings = sameAs();

  for (const page of pages) {
    const say = (what: string) => bad.push({ path: page.path, what });
    let nodes: JsonLd[];
    try {
      nodes = extractJsonLd(page.html);
    } catch (error) {
      say((error as Error).message);
      continue;
    }
    if (nodes.length === 0) {
      say('carries no linked data at all, so it says nothing about which Wobo it is');
      continue;
    }

    // --- the entity -------------------------------------------------------------------------
    const orgs = nodesOfType(nodes, 'Organization').filter((o) => typeof o['@id'] === 'string');
    if (orgs.length !== 1) say(`declares ${orgs.length} Organizations with an @id, and not one`);
    const org = orgs[0];
    if (org) {
      if (org['@id'] !== `${site}/${ORG_FRAGMENT}`) {
        say(`identifies its Organization as ${String(org['@id'])}, not ${site}/${ORG_FRAGMENT}`);
      }
      if (org.name !== BRAND_NAME) say(`calls the organisation ${JSON.stringify(org.name)}`);
      if (org.url !== `${site}/`) say(`gives the organisation the url ${String(org.url)}`);
      if (org.description !== BRAND_DESCRIPTION) {
        say('describes the organisation in words that are not the press kit’s one line');
      }
      const logo = (org.logo ?? {}) as JsonLd;
      if (!isAbsolute(logo.url))
        say(`names a logo that is not an absolute URL (${String(logo.url)})`);
      const parent = (org.parentOrganization ?? {}) as JsonLd;
      if (!parent.name) say('names no parent organisation, so nobody knows who publishes it');
      // The `sameAs` graph is the entity work's whole mechanism, and it is only as good as its
      // honesty: it must be exactly the listings the ledger says are claimed, and absent when
      // none are (`src/shell/profiles.ts`).
      if (listings.length === 0) {
        if (org.sameAs !== undefined) say('publishes a sameAs list while no listing is claimed');
      } else if (JSON.stringify(org.sameAs) !== JSON.stringify(listings)) {
        say(`publishes a sameAs list that is not the ledger's: ${JSON.stringify(org.sameAs)}`);
      }
      for (const invented of ['aggregateRating', 'review']) {
        if (org[invented] !== undefined) say(`claims a ${invented}, which we cannot show`);
      }
    }

    // --- the site ---------------------------------------------------------------------------
    const sites = nodesOfType(nodes, 'WebSite');
    if (sites.length !== 1) say(`declares ${sites.length} WebSites, and not one`);
    const web = sites[0];
    if (web) {
      if (web.name !== BRAND_NAME) say(`names the site ${JSON.stringify(web.name)}`);
      if (web['@id'] !== `${site}/${SITE_FRAGMENT}`) {
        say(`identifies the site as ${String(web['@id'])}, not ${site}/${SITE_FRAGMENT}`);
      }
      if (web.url !== `${site}/`) say(`gives the site the url ${String(web.url)}`);
    }

    // --- where the page sits ------------------------------------------------------------------
    const crumbs = nodesOfType(nodes, 'BreadcrumbList');
    if (page.path === '/') {
      if (crumbs.length > 0) say('carries a breadcrumb, and it is the root');
    } else if (crumbs.length !== 1) {
      say(`declares ${crumbs.length} breadcrumb trails, and it is not the root`);
    } else {
      const items = (crumbs[0]?.itemListElement ?? []) as JsonLd[];
      if (items.length < 2) say('carries a breadcrumb trail with nothing on it');
      items.forEach((item, index) => {
        if (item.position !== index + 1) say(`numbers a breadcrumb ${String(item.position)}`);
        if (!item.name) say('leaves a breadcrumb unnamed');
        if (!isAbsolute(item.item)) say(`points a breadcrumb at ${String(item.item)}`);
      });
      if (items[0]?.item !== `${site}/`) say('starts its trail somewhere other than the home page');
      if (items[items.length - 1]?.item !== `${site}${page.path}`) {
        say(`ends its trail at ${String(items[items.length - 1]?.item)} rather than at itself`);
      }
    }

    // --- the product --------------------------------------------------------------------------
    const apps = nodesOfType(nodes, 'SoftwareApplication');
    const wanted = APP_PAGES.has(page.path) ? 1 : 0;
    if (apps.length !== wanted) {
      say(`declares ${apps.length} SoftwareApplications where ${wanted} belongs`);
    }
    const app = apps[0];
    if (app) {
      if (app.applicationCategory !== 'EducationalApplication') {
        say(`files itself under ${String(app.applicationCategory)}`);
      }
      const offers = (app.offers ?? []) as JsonLd[];
      if (offers.length === 0) say('states no price at all, not even the free one');
      const free = offers.filter((o) => o.price === '0');
      if (free.length !== 1) say(`states ${free.length} free tiers, and there is one`);
      for (const offer of offers) {
        if (!offer.priceCurrency) say(`quotes ${String(offer.price)} in no currency`);
        if (/\btrial\b/i.test(String(offer.description ?? ''))) {
          say('calls a tier a trial, and none of them is one');
        }
      }
      if (app.aggregateRating !== undefined) say('claims a rating for the product');
    }

    // --- what we never declare ----------------------------------------------------------------
    for (const node of nodes) {
      const type = String(node['@type']);
      if (RETIRED_TYPES.has(type)) {
        say(`declares ${type}, a schema Google retired and which now earns nothing`);
      }
    }

    // --- the naming law -----------------------------------------------------------------------
    for (const what of namingViolations(nodes)) say(what);
  }
  return bad;
}

/** The violations as the lines a build log should print. */
export function reportViolations(bad: readonly Violation[]): string {
  return bad.map((v) => `  ${v.path} ${v.what}`).join('\n');
}
