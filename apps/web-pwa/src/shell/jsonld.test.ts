/**
 * THE FOUR SHAPES A PAGE DECLARES, AND THE NAMING LAW THEY ARE HELD TO.
 *
 * Google retired FAQ rich results in May 2026, HowTo in 2023, Course information in September 2025
 * and practice-problem markup in November 2025, so this module builds only what still earns
 * something: Organization (the entity and its `sameAs` graph), WebSite (so a result is headed
 * "Wobo" and not "heywobo.com"), BreadcrumbList (every page below the root) and
 * SoftwareApplication (the home and plans pages).
 *
 * The law being tested is docs/GROWTH-ENTITY.md §2, which is not a preference: **the brand is
 * Wobo, and heywobo.com is an address.** A `name` field that reads "HeyWobo" teaches an engine the
 * wrong string on the one surface built to teach it the right one.
 */

import { describe, expect, it } from 'bun:test';
import { BRAND_DESCRIPTION, BRAND_NAME, DEFAULT_ORIGIN } from './head';
import {
  APP_FRAGMENT,
  APP_PAGES,
  breadcrumbLd,
  breadcrumbTrail,
  crumbName,
  type JsonLd,
  namingViolations,
  ORG_ADDRESS,
  ORG_COUNTRY_NAME,
  ORG_FRAGMENT,
  organizationLd,
  POSTAL_ADDRESS,
  planOffers,
  RETIRED_TYPES,
  renderJsonLd,
  SITE_FRAGMENT,
  softwareApplicationLd,
  structuredDataFor,
  webSiteLd,
} from './jsonld';
import { sameAs } from './profiles';

const ORIGIN = DEFAULT_ORIGIN;

/** Every page in the fixture set, with the name each one's own heading gives it. */
const NAMES = new Map<string, string>([
  ['/', 'Home'],
  ['/help', 'Help'],
  ['/help/getting-started/what-is-wobo', 'What is Wobo'],
  ['/plans', 'Plans'],
  ['/legal', 'The legal set'],
]);

describe('Organization: the entity itself', () => {
  const org = organizationLd(ORIGIN);

  it('is called Wobo and lives at heywobo.com', () => {
    expect(org.name).toBe(BRAND_NAME);
    expect(org.name).toBe('Wobo');
    expect(org.url).toBe(`${ORIGIN}/`);
    expect(org['@id']).toBe(`${ORIGIN}/${ORG_FRAGMENT}`);
  });

  it('describes itself in the press kit’s one line, word for word', () => {
    // Sameness across every source is the whole lever (docs/copy/press-kit.md).
    expect(org.description).toBe(BRAND_DESCRIPTION);
  });

  it('carries a logo an engine can fetch', () => {
    const logo = org.logo as JsonLd;
    expect(logo['@type']).toBe('ImageObject');
    expect(String(logo.url).startsWith(`${ORIGIN}/`)).toBe(true);
  });

  it('names the company behind it as its parent, not as itself', () => {
    const parent = org.parentOrganization as JsonLd;
    expect(parent.name).toBe('Dot eVentures Pvt Ltd');
    expect(parent['@type']).toBe('Organization');
    expect(parent['@id']).toBeUndefined();
  });

  it('writes the registered office as the legal pages write it, field for field', () => {
    // The structured fields are spelled out rather than parsed out of POSTAL_ADDRESS, so this is
    // the guard that stops the two drifting: reassemble them and they must be that one string.
    const a = ORG_ADDRESS as Record<string, string>;
    expect(
      `${a.streetAddress}, ${a.addressLocality}, ${a.addressRegion} ${a.postalCode}, ${ORG_COUNTRY_NAME}`,
    ).toBe(POSTAL_ADDRESS);
    expect((org.parentOrganization as JsonLd).address).toEqual(ORG_ADDRESS);
  });

  it('publishes exactly the listings the ledger says are ours', () => {
    if (sameAs().length === 0) expect(org.sameAs).toBeUndefined();
    else expect(org.sameAs).toEqual(sameAs());
  });

  it('claims no rating, no review and no count of anything', () => {
    // docs/CLAIMS.md: no market-share, user-count or ranking figure of any kind.
    for (const forbidden of [
      'aggregateRating',
      'review',
      'numberOfEmployees',
      'interactionStatistic',
    ])
      expect(org[forbidden]).toBeUndefined();
  });
});

describe('WebSite: what a search result is headed', () => {
  const site = webSiteLd(ORIGIN);

  it('gives the site the brand’s name so a result says Wobo, not the domain', () => {
    expect(site.name).toBe('Wobo');
    expect(site['@type']).toBe('WebSite');
    expect(site.url).toBe(`${ORIGIN}/`);
    expect(site['@id']).toBe(`${ORIGIN}/${SITE_FRAGMENT}`);
  });

  it('points back at the one Organization rather than describing a second one', () => {
    expect(site.publisher).toEqual({ '@id': `${ORIGIN}/${ORG_FRAGMENT}` });
  });

  it('offers no site search, because there is none to offer', () => {
    expect(site.potentialAction).toBeUndefined();
  });
});

describe('BreadcrumbList: where a page sits', () => {
  it('gives the root no trail, because it is the root', () => {
    expect(breadcrumbTrail('/', NAMES)).toEqual([]);
    expect(breadcrumbLd(ORIGIN, breadcrumbTrail('/', NAMES))).toBeNull();
  });

  it('walks a page back to the home page through the pages that exist', () => {
    expect(breadcrumbTrail('/help/getting-started/what-is-wobo', NAMES)).toEqual([
      { path: '/', name: 'Home' },
      { path: '/help', name: 'Help' },
      { path: '/help/getting-started/what-is-wobo', name: 'What is Wobo' },
    ]);
  });

  it('skips an ancestor segment that is not a page, so every crumb is a real address', () => {
    // There is no /help/getting-started page: the group is a heading inside /help.
    const trail = breadcrumbTrail('/help/getting-started/what-is-wobo', NAMES);
    expect(trail.map((c) => c.path)).not.toContain('/help/getting-started');
  });

  it('names a page the build has never heard of from its own address', () => {
    const trail = breadcrumbTrail('/blog/why-we-draw', NAMES);
    expect(trail.map((c) => c.path)).toEqual(['/', '/blog/why-we-draw']);
    expect(trail[1]?.name).toBe('Why we draw');
  });

  it('names a crumb by what the page calls itself, not by its headline', () => {
    // The plans page's heading is a sentence about price; its title is its name plus its context.
    expect(
      crumbName({
        path: '/plans',
        title: 'Wobo plans',
        heading: 'Free every day. More when exams get close.',
      }),
    ).toBe('Wobo plans');
    expect(
      crumbName({
        path: '/learn/cbse/class-7/mathematics',
        title: 'Class 7 maths syllabus, CBSE \u00b7 Wobo',
        heading: 'MathematicsCBSE class 7',
      }),
    ).toBe('Class 7 maths syllabus, CBSE');
  });

  it('falls back to the heading, and then to the address, so a crumb is never empty', () => {
    expect(crumbName({ path: '/gift', title: '', heading: 'Give someone a tutor' })).toBe(
      'Give someone a tutor',
    );
    expect(crumbName({ path: '/blog/why-we-draw' })).toBe('Why we draw');
  });

  it('numbers the crumbs from one and points each at its own absolute address', () => {
    const ld = breadcrumbLd(ORIGIN, breadcrumbTrail('/help/getting-started/what-is-wobo', NAMES));
    const items = ld?.itemListElement as JsonLd[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.item)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/help`,
      `${ORIGIN}/help/getting-started/what-is-wobo`,
    ]);
    expect(items.every((i) => i['@type'] === 'ListItem')).toBe(true);
  });
});

describe('SoftwareApplication: what the thing is, and what it costs', () => {
  const app = softwareApplicationLd(ORIGIN);

  it('is on the home page and the plans page, and on no other', () => {
    expect([...APP_PAGES].sort()).toEqual(['/', '/plans']);
  });

  it('says what category of software it is, in schema.org’s own word', () => {
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app.applicationCategory).toBe('EducationalApplication');
    expect(app.name).toBe('Wobo');
    expect(app['@id']).toBe(`${ORIGIN}/${APP_FRAGMENT}`);
    expect(app.publisher).toEqual({ '@id': `${ORIGIN}/${ORG_FRAGMENT}` });
  });

  it('states the free tier as free, at zero, and not as a trial', () => {
    const offers = app.offers as JsonLd[];
    const free = offers.find((o) => o.name === 'Free') as JsonLd;
    expect(free.price).toBe('0');
    expect(free.priceCurrency).toBe('INR');
    expect(String(free.description)).not.toMatch(/trial/i);
    expect(free.priceValidUntil).toBeUndefined();
  });

  it('quotes every paid tier at the price the plans page quotes', () => {
    const offers = planOffers(ORIGIN);
    const inr = offers.filter((o) => o.priceCurrency === 'INR' && o.price !== '0');
    expect(inr.map((o) => o.price).sort()).toEqual(['1999', '3999']);
    const usd = offers.filter((o) => o.priceCurrency === 'USD');
    expect(usd.map((o) => o.price).sort()).toEqual(['20', '50']);
  });

  it('never quotes a yearly total, which the plans page may not show', () => {
    // docs/PRICING.md (owner, 2026-09-04): the annual total belongs at checkout and nowhere else.
    const quoted = planOffers(ORIGIN).map((o) => String(o.price));
    for (const total of ['19992', '39996', '200', '500']) expect(quoted).not.toContain(total);
  });

  it('says every paid offer is a month at a time', () => {
    for (const offer of planOffers(ORIGIN)) {
      if (offer.price === '0') continue;
      const spec = offer.priceSpecification as JsonLd;
      expect(spec['@type']).toBe('UnitPriceSpecification');
      expect(spec.billingDuration).toBe('P1M');
    }
  });
});

describe('the graph one page carries', () => {
  it('puts the Organization and the WebSite on every page', () => {
    for (const path of ['/', '/plans', '/help', '/legal']) {
      const nodes = structuredDataFor({ path }, ORIGIN, NAMES);
      expect(nodes.map((n) => n['@type'])).toContain('Organization');
      expect(nodes.map((n) => n['@type'])).toContain('WebSite');
    }
  });

  it('puts a breadcrumb on every page below the root and none on the root', () => {
    expect(structuredDataFor({ path: '/' }, ORIGIN, NAMES).map((n) => n['@type'])).not.toContain(
      'BreadcrumbList',
    );
    expect(structuredDataFor({ path: '/help' }, ORIGIN, NAMES).map((n) => n['@type'])).toContain(
      'BreadcrumbList',
    );
  });

  it('leaves a page that already declares its own trail alone', () => {
    // The blog renders its own BreadcrumbList into its body, with its own labels. Two trails on
    // one page is an engine being asked which of two answers is where the page sits.
    const nodes = structuredDataFor(
      { path: '/blog/why-we-draw', hasOwnBreadcrumb: true },
      ORIGIN,
      NAMES,
    );
    expect(nodes.map((n) => n['@type'])).not.toContain('BreadcrumbList');
    expect(nodes.map((n) => n['@type'])).toContain('Organization');
    expect(nodes.map((n) => n['@type'])).toContain('WebSite');
  });

  it('puts the application on the home and plans pages only', () => {
    const has = (path: string) =>
      structuredDataFor({ path }, ORIGIN, NAMES).some((n) => n['@type'] === 'SoftwareApplication');
    expect(has('/')).toBe(true);
    expect(has('/plans')).toBe(true);
    expect(has('/help')).toBe(false);
  });

  it('declares none of the schemas Google has retired', () => {
    for (const path of ['/', '/plans', '/help']) {
      for (const node of structuredDataFor({ path }, ORIGIN, NAMES)) {
        expect(RETIRED_TYPES.has(String(node['@type']))).toBe(false);
      }
    }
  });
});

describe('the naming law, over any graph', () => {
  it('passes the graph the site actually ships', () => {
    for (const path of ['/', '/plans', '/help/getting-started/what-is-wobo']) {
      expect(namingViolations(structuredDataFor({ path }, ORIGIN, NAMES))).toEqual([]);
    }
  });

  it('catches a name field that says HeyWobo', () => {
    expect(namingViolations([{ '@type': 'Organization', name: 'HeyWobo' }])).toHaveLength(1);
    expect(namingViolations([{ '@type': 'WebSite', name: 'Hey Wobo' }])).toHaveLength(1);
  });

  it('lets a page quote the wake phrase, because that is the one place it is allowed', () => {
    // GROWTH-ENTITY §2: "The one place 'Hey Wobo' is allowed is as speech, because that is how a
    // learner summons the tutor." A help article called `Saying "Hey Wobo"` is that page, and its
    // own heading becomes its breadcrumb name.
    expect(namingViolations([{ '@type': 'WebPage', name: 'Saying \u201cHey Wobo\u201d' }])).toEqual(
      [],
    );
    expect(namingViolations([{ '@type': 'ListItem', name: 'Saying "Hey Wobo"' }])).toEqual([]);
  });

  it('still refuses Hey Wobo as the whole of a name, however it is punctuated', () => {
    expect(namingViolations([{ '@type': 'WebSite', name: '"Hey Wobo"' }])).toHaveLength(1);
    expect(namingViolations([{ '@type': 'WebSite', name: 'hey  wobo' }])).toHaveLength(1);
  });

  it('catches the domain used as a name anywhere in the graph', () => {
    const bad = namingViolations([
      { '@type': 'Organization', name: 'Wobo', description: 'heywobo.com is an AI tutor.' },
    ]);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/description/);
  });

  it('allows the domain in an address, which is what an address is for', () => {
    expect(
      namingViolations([
        {
          '@type': 'Organization',
          '@id': 'https://heywobo.com/#organization',
          name: 'Wobo',
          url: 'https://heywobo.com/',
          logo: { '@type': 'ImageObject', url: 'https://heywobo.com/pwa-512.png' },
          sameAs: ['https://www.youtube.com/@heywobo'],
        },
      ]),
    ).toEqual([]);
  });

  it('catches a node that is us but calls itself something else', () => {
    expect(
      namingViolations([
        { '@type': 'WebSite', '@id': `${ORIGIN}/${SITE_FRAGMENT}`, name: 'Wobo Learning' },
      ]),
    ).toHaveLength(1);
  });

  it('leaves the parent company its own name', () => {
    expect(
      namingViolations([
        {
          '@type': 'Organization',
          '@id': `${ORIGIN}/${ORG_FRAGMENT}`,
          name: 'Wobo',
          parentOrganization: { '@type': 'Organization', name: 'Dot eVentures Pvt Ltd' },
        },
      ]),
    ).toEqual([]);
  });

  it('catches an em dash, which nothing a person reads may carry', () => {
    expect(
      namingViolations([{ '@type': 'WebSite', name: 'Wobo', description: 'a — b' }]),
    ).toHaveLength(1);
  });
});

describe('the script the page carries', () => {
  const html = renderJsonLd(structuredDataFor({ path: '/plans' }, ORIGIN, NAMES));

  it('is one script, typed as linked data, that parses back to the graph', () => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('type="application/ld+json"');
    const json = html.replace(/^[\s\S]*?>/, '').replace(/<\/script>[\s\S]*$/, '');
    const parsed = JSON.parse(json) as { '@context': string; '@graph': JsonLd[] };
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph'].length).toBeGreaterThan(2);
  });

  it('cannot close its own script tag, whatever a page is called', () => {
    const out = renderJsonLd([{ '@type': 'WebSite', name: 'Wobo', headline: '</script><b>' }]);
    expect(out).not.toContain('</script><b>');
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });
});
