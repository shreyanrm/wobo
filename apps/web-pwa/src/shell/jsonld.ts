/**
 * WHAT EVERY PAGE TELLS A MACHINE IT IS, IN THE ONE VOCABULARY THEY ALL READ.
 *
 * The audit of 2026-09-09 counted `0` elements matching `script[type="application/ld+json"]` on
 * every page of the site (docs/GROWTH-SEARCH.md §2). That is why an engine asked about "Wobo AI
 * tutor" answers about a job-search app: three products share the name, and ours was the only one
 * that never said, in a form a machine reads, what it is or who publishes it.
 *
 * ═══ WHAT IS HERE, AND WHAT IS DELIBERATELY NOT ═══
 *
 * Structured data is only worth adding where it still earns something, and most of the schemas a
 * 2024 checklist would name have been retired:
 *
 *   · FAQPage         retired as a rich result in May 2026
 *   · HowTo           retired in 2023
 *   · Course info     retired in September 2025
 *   · Practice problems retired in November 2025
 *
 * None of those are built here, and `RETIRED_TYPES` exists so a future wave cannot add one back by
 * accident: the build fails on any node carrying one. What is built is the four that still do
 * work:
 *
 *   · **Organization** on every page, with the `sameAs` graph (`profiles.ts`) that lets an engine
 *     walk from this site to the LinkedIn page to the app store to Wikidata and see ONE thing.
 *     This is the whole entity strategy expressed as markup (docs/GROWTH-ENTITY.md §4).
 *   · **WebSite** on every page, so a result is headed "Wobo" and not "heywobo.com". The domain is
 *     an address; the brand is the name (§2), and this is the tag that says so.
 *   · **BreadcrumbList** on every page below the root, so a result shows where a page sits rather
 *     than a URL with three slashes in it.
 *   · **SoftwareApplication** on the home and plans pages: what the thing is, what category it is
 *     in, and what it costs, with the free tier stated as free.
 *
 * ═══ THE NAMING LAW IS ENFORCED HERE, NOT ASSUMED ═══
 *
 * docs/GROWTH-ENTITY.md §2: **the brand is Wobo; heywobo.com is an address and @heywobo is a
 * handle.** A `name` field reading "HeyWobo" would teach an engine the wrong string on the exact
 * surface built to teach it the right one. `namingViolations` walks any graph and returns every
 * breach, and both the build and the tests run it.
 *
 * This module is read by `scripts/prerender.ts` and by the tests, never by the running app, so it
 * may import the plans table for its prices without costing a visitor anything.
 */

import { PLAN_TIERS } from '../screens/plans/prices';
import { COMPANY, POSTAL_ADDRESS } from '../screens/site/identity';
import { absoluteUrl, BRAND_DESCRIPTION, BRAND_NAME, normaliseOrigin, ogImagePath } from './head';
import { sameAs } from './profiles';

/** One node of linked data. Deliberately loose: schema.org is not a closed type system. */
export type JsonLd = Record<string, unknown>;

/**
 * The three fragments that identify US, so every page's nodes are the SAME entity rather than a
 * new Organization invented once per address. An engine merges by `@id`; without one it does not.
 */
export const ORG_FRAGMENT = '#organization';
export const SITE_FRAGMENT = '#website';
export const APP_FRAGMENT = '#app';

/** The two addresses that describe the product itself rather than a document about it. */
export const APP_PAGES: ReadonlySet<string> = new Set(['/', '/plans']);

/** The logo an engine fetches for a knowledge panel. 512px square, already in `public/`. */
export const LOGO_PATH = '/pwa-512.png';

/**
 * The registered office, structured. It is spelled out in fields rather than parsed out of
 * `POSTAL_ADDRESS`, because parsing an address is guesswork; `jsonld.test.ts` reassembles these
 * five values and asserts they are that one string, so the two can never drift apart.
 */
export const ORG_ADDRESS: JsonLd = {
  '@type': 'PostalAddress',
  streetAddress: '141 Prashasan Nagar, Jubilee Hills',
  addressLocality: 'Hyderabad',
  addressRegion: 'Telangana',
  postalCode: '500033',
  addressCountry: 'IN',
};
/** The country in words, which is how `POSTAL_ADDRESS` writes it. */
export const ORG_COUNTRY_NAME = 'India';

/** The press kit's facts box: Founded 2026. */
export const FOUNDING_YEAR = '2026';

/**
 * The press kit's founder (docs/copy/press-kit.md, "The founder"): one name, spelled the same way
 * on every listing, in every byline and in this markup. The press page reads it from here.
 */
export const FOUNDER_NAME = 'Shreyan Reddy';

/**
 * Schemas Google has retired. Adding one back costs a page nothing and gains it nothing, and it
 * makes a validator's report noisier for the next person reading it, so the build refuses them.
 */
export const RETIRED_TYPES: ReadonlySet<string> = new Set([
  'FAQPage',
  'HowTo',
  'HowToSection',
  'HowToStep',
  'Course',
  'CourseInstance',
  'Quiz',
  'PracticeProblem',
  'MathSolver',
]);

/** Keys whose value IS an address. The domain may appear in one of these and nowhere else. */
export const ADDRESS_KEYS: ReadonlySet<string> = new Set([
  '@id',
  'url',
  'logo',
  'image',
  'sameAs',
  'item',
  'contentUrl',
  'target',
  'urlTemplate',
  'installUrl',
  'downloadUrl',
]);

/** Keys that NAME something. What they say is what an engine learns the thing is called. */
export const NAME_KEYS: ReadonlySet<string> = new Set([
  'name',
  'alternateName',
  'legalName',
  'headline',
  'alternativeHeadline',
]);

const IDENTITY_FRAGMENTS = [ORG_FRAGMENT, SITE_FRAGMENT, APP_FRAGMENT];

// --- the four shapes ----------------------------------------------------------------------------

/** The entity. One `@id`, one name, one description, and every listing that is genuinely ours. */
export function organizationLd(rawOrigin: string): JsonLd {
  const origin = normaliseOrigin(rawOrigin);
  const listings = sameAs();
  return {
    '@type': 'Organization',
    '@id': `${origin}/${ORG_FRAGMENT}`,
    name: BRAND_NAME,
    url: `${origin}/`,
    // The press kit's one line, word for word. Sameness across every source is the entire lever
    // behind the entity work (docs/copy/press-kit.md, GROWTH-ENTITY §4), so this string is the
    // same one the meta description, the app store blurb and every listing carry.
    description: BRAND_DESCRIPTION,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl(origin, LOGO_PATH),
      width: 512,
      height: 512,
    },
    image: absoluteUrl(origin, ogImagePath('/')),
    foundingDate: FOUNDING_YEAR,
    // A Person with a name and nothing else: no photograph until the owner supplies one, and no
    // profile address until one is claimed (the same discipline as `sameAs`).
    founder: { '@type': 'Person', name: FOUNDER_NAME },
    // Who a parent is actually dealing with. Named on the legal pages already (identity.ts), so
    // naming it here publishes nothing new; it makes the relationship machine-readable.
    parentOrganization: {
      '@type': 'Organization',
      name: COMPANY,
      address: ORG_ADDRESS,
    },
    areaServed: { '@type': 'Country', name: ORG_COUNTRY_NAME },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      url: `${origin}/contact`,
      availableLanguage: 'English',
    },
    // Only listings that EXIST and are ours (`profiles.ts`). Empty means the key is left off
    // entirely rather than published as an empty array, because an empty array claims nothing and
    // still costs a reader of the graph a moment working that out.
    ...(listings.length > 0 ? { sameAs: listings } : {}),
  };
}

/**
 * The site. Its only job is the `name`: without it a result is headed by the domain, and the
 * domain is the half of our identity that belongs to the other two products' argument.
 */
export function webSiteLd(rawOrigin: string): JsonLd {
  const origin = normaliseOrigin(rawOrigin);
  return {
    '@type': 'WebSite',
    '@id': `${origin}/${SITE_FRAGMENT}`,
    name: BRAND_NAME,
    url: `${origin}/`,
    description: BRAND_DESCRIPTION,
    inLanguage: 'en-IN',
    publisher: { '@id': `${origin}/${ORG_FRAGMENT}` },
    // NO `potentialAction` / SearchAction. There is no site search, and declaring one would be
    // offering an engine a box that does not exist.
  };
}

/** One step of a trail: an address that is a real page, and what that page calls itself. */
export interface Crumb {
  path: string;
  name: string;
}

/** A slug read back as words, for a page whose own heading the caller does not have. */
function nameFromPath(path: string): string {
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  const words = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Page';
}

/** What the site's own titles put between a page's name and its context. */
export const TITLE_SEPARATOR = ' \u00b7 ';

/**
 * What ONE page is called in a trail, which is not the same question as what its headline says.
 *
 * A breadcrumb name shows up in a search result, so it wants to be the page's NAME. The site's
 * headings are not names: the plans page opens "Free every day. More when exams get close.", and a
 * chapter page's heading runs its title and its context together because the subtitle is inside
 * the same element ("Ganita Prakash, Grade 7, Part 1CBSE class 7 maths"). Neither reads as a place.
 *
 * The page's own TITLE is already the name plus its context, separated: "Class 7 maths syllabus,
 * CBSE \u00b7 Wobo". So the crumb is the part before the first separator, which is the page naming
 * itself. The heading is the fallback where a page has no title, and the slug the fallback after
 * that, so a crumb is never empty.
 */
export function crumbName(page: {
  path: string;
  title?: string | null;
  heading?: string | null;
}): string {
  const fromTitle = (page.title ?? '').split(TITLE_SEPARATOR)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (fromTitle) return fromTitle;
  const heading = (page.heading ?? '').replace(/\s+/g, ' ').trim();
  return heading || nameFromPath(page.path);
}

/**
 * The trail from the home page down to this one, THROUGH THE PAGES THAT EXIST.
 *
 * An ancestor segment with no page of its own is skipped rather than given a crumb: `/help/
 * getting-started` is a heading inside `/help`, not an address, and a breadcrumb item pointing at
 * it would send a crawler to the SPA fallback. Every crumb this returns is a real file.
 *
 * The root gets no trail at all, because it is the root.
 */
export function breadcrumbTrail(path: string, names: ReadonlyMap<string, string>): Crumb[] {
  if (path === '/') return [];
  const segments = path.split('/').filter(Boolean);
  const trail: Crumb[] = [{ path: '/', name: names.get('/') ?? 'Home' }];
  let walked = '';
  for (const [index, segment] of segments.entries()) {
    walked += `/${segment}`;
    const last = index === segments.length - 1;
    const name = names.get(walked);
    if (!last && name === undefined) continue;
    trail.push({ path: walked, name: name ?? nameFromPath(walked) });
  }
  return trail;
}

/** The trail as markup. Null for a trail with nothing to say, which is the home page's. */
export function breadcrumbLd(rawOrigin: string, trail: readonly Crumb[]): JsonLd | null {
  if (trail.length < 2) return null;
  const origin = normaliseOrigin(rawOrigin);
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.path === '/' ? `${origin}/` : `${origin}${crumb.path}`,
    })),
  };
}

/**
 * What the product costs, read from the plans table so a price can never be quoted here that the
 * page does not quote.
 *
 * THE FREE TIER IS STATED AS FREE: price 0, no `priceValidUntil`, and no word suggesting a trial,
 * because it is not one. Every paid offer carries `billingDuration: P1M`, and the ANNUAL TOTAL IS
 * NEVER HERE: docs/PRICING.md (owner, 2026-09-04) says the total belongs at checkout and may not
 * appear on the plans page, and this markup ships on the plans page.
 */
export function planOffers(rawOrigin: string): JsonLd[] {
  const origin = normaliseOrigin(rawOrigin);
  const url = `${origin}/plans`;
  const offers: JsonLd[] = [];
  for (const tier of PLAN_TIERS) {
    if (!tier.price) {
      offers.push({
        '@type': 'Offer',
        name: tier.name,
        // A price of nothing has no currency in reality; the home market's is named because a
        // currency is required beside a price and India is the market this is written for.
        price: '0',
        priceCurrency: 'INR',
        category: 'free',
        description: tier.blurb,
        availability: 'https://schema.org/InStock',
        url,
      });
      continue;
    }
    for (const [market, money] of Object.entries(tier.price)) {
      offers.push({
        '@type': 'Offer',
        name: tier.name,
        price: String(money.amount),
        priceCurrency: money.currency,
        category: 'subscription',
        description: tier.blurb,
        availability: 'https://schema.org/InStock',
        url,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: String(money.amount),
          priceCurrency: money.currency,
          billingDuration: 'P1M',
        },
        // The price never varies by who is looking, only by which country's money it is in
        // (prices.ts, WOBO-PLAN §14). Saying which country the rupee price is for is that fact.
        ...(market === 'IN'
          ? { eligibleRegion: { '@type': 'Country', name: ORG_COUNTRY_NAME } }
          : {}),
      });
    }
  }
  return offers;
}

/** The product itself: what it is, what category of software, and what it costs. */
export function softwareApplicationLd(rawOrigin: string): JsonLd {
  const origin = normaliseOrigin(rawOrigin);
  return {
    '@type': 'SoftwareApplication',
    '@id': `${origin}/${APP_FRAGMENT}`,
    name: BRAND_NAME,
    url: `${origin}/`,
    description: BRAND_DESCRIPTION,
    applicationCategory: 'EducationalApplication',
    // It runs in a browser and installs from one. There is no store build to claim yet, and
    // naming a platform we do not ship on would be the sort of claim docs/CLAIMS.md forbids.
    operatingSystem: 'Any',
    inLanguage: 'en-IN',
    image: absoluteUrl(origin, ogImagePath('/')),
    publisher: { '@id': `${origin}/${ORG_FRAGMENT}` },
    offers: planOffers(origin),
    // NO `aggregateRating` and NO `review`. We have no ratings, and inventing a number is the one
    // thing docs/CLAIMS.md rules out absolutely.
  };
}

// --- the graph one page carries -------------------------------------------------------------

/**
 * Everything one address declares about itself, in the order it should be read.
 *
 * `hasOwnBreadcrumb` is how a page that already declares its own trail keeps it. The blog family
 * renders a `BreadcrumbList` into its own body, with its own labels for a post and its tags, and
 * two BreadcrumbLists on one page is not twice the signal: it is an engine being asked which of
 * two answers is where the page sits. The page's own wins, because it knows more about itself
 * than a path can say, and this module adds nothing beside it.
 */
export function structuredDataFor(
  page: { path: string; hasOwnBreadcrumb?: boolean },
  origin: string,
  names: ReadonlyMap<string, string>,
): JsonLd[] {
  const nodes: JsonLd[] = [organizationLd(origin), webSiteLd(origin)];
  const crumbs = page.hasOwnBreadcrumb
    ? null
    : breadcrumbLd(origin, breadcrumbTrail(page.path, names));
  if (crumbs) nodes.push(crumbs);
  if (APP_PAGES.has(page.path)) nodes.push(softwareApplicationLd(origin));
  return nodes;
}

/**
 * The graph as the one script a page carries.
 *
 * `<`, `>` and `&` are written as escapes, so no value a page ever holds can close the script tag
 * it is inside. That is not theoretical: a page's own heading becomes a breadcrumb name, and a
 * heading is copy somebody may one day write angle brackets into.
 */
export function renderJsonLd(nodes: readonly JsonLd[], indent = '    '): string {
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `${indent}<script type="application/ld+json">${json}</script>`;
}

// --- the naming law ---------------------------------------------------------------------------

/**
 * Every breach of docs/GROWTH-ENTITY.md §2 in a graph, as sentences.
 *
 * Four rules, and each one is a way the site could quietly teach an engine the wrong name:
 *
 *  1. A NAME says "HeyWobo", or is "Hey Wobo" and nothing else. The brand is Wobo. The one place
 *     "Hey Wobo" is allowed is as speech, because that is how a learner summons the tutor, so a
 *     page called `Saying "Hey Wobo"` keeps its own heading and only a name that IS the phrase is
 *     a breach.
 *  2. The DOMAIN appears somewhere that is not an address. heywobo.com is how you reach the brand,
 *     not what it is called, so it belongs in `url`, `@id`, `logo`, `image`, `sameAs` and nowhere
 *     else in the graph.
 *  3. A node that IS US, identified by one of our three `@id` fragments, calls itself something
 *     other than Wobo. The parent company keeps its own name: it is a different organisation.
 *  4. An em dash, anywhere. Nothing a person reads carries one (docs/copy/voice.md), and these
 *     strings are read: a breadcrumb and a price show up in a result.
 */
export function namingViolations(nodes: readonly JsonLd[]): string[] {
  const bad: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (value.includes('—')) bad.push(`${key} carries an em dash: ${JSON.stringify(value)}`);
      if (NAME_KEYS.has(key)) {
        // The closed-up spelling is banned outright: it is not a name anyone should ever read.
        if (/heywobo/i.test(value)) {
          bad.push(`${key} names the brand ${JSON.stringify(value)}, and the brand is Wobo`);
        } else if (
          value
            .replace(/["'\u201c\u201d\s]+/g, ' ')
            .trim()
            .toLowerCase() === 'hey wobo'
        ) {
          // "Hey Wobo" as the WHOLE of a name is the brand misnamed. Inside a longer name it is
          // the wake phrase being quoted, which §2 expressly allows: "the one place 'Hey Wobo' is
          // allowed is as speech, because that is how a learner summons the tutor." A help
          // article called `Saying "Hey Wobo"` is that page, and renaming it would be worse.
          bad.push(`${key} names the brand ${JSON.stringify(value)}, and the brand is Wobo`);
        }
        return;
      }
      if (!ADDRESS_KEYS.has(key) && /heywobo/i.test(value)) {
        bad.push(`${key} carries the address where a name belongs: ${JSON.stringify(value)}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as JsonLd;
    const id = typeof node['@id'] === 'string' ? node['@id'] : '';
    // A node with an `@id` and no `@type` is a REFERENCE to an entity declared elsewhere in the
    // graph (`publisher: { "@id": … }`), not a second declaration of it. A reference carries no
    // name by design, and demanding one would make the graph's own cross-links illegal.
    const declares = typeof node['@type'] === 'string';
    if (
      declares &&
      IDENTITY_FRAGMENTS.some((fragment) => id.endsWith(fragment)) &&
      node.name !== BRAND_NAME
    ) {
      bad.push(`${id} is us and calls itself ${JSON.stringify(node.name)}, not ${BRAND_NAME}`);
    }
    for (const [childKey, child] of Object.entries(node)) walk(child, childKey);
  };
  for (const node of nodes) walk(node, '@root');
  return bad;
}

/** The one string the address fields are checked against, exported so the tests need not guess. */
export { POSTAL_ADDRESS };
