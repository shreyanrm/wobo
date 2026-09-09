import { describe, expect, it } from 'bun:test';
import { pathToRoute } from '../../shell/router';
import {
  DISALLOWED,
  expandPublicRoutes,
  PUBLIC_ROUTES,
  robotsTxt,
  sitemapXml,
  siteOrigin,
} from './routes';

describe('the public routes a crawler is told about', () => {
  it('only lists addresses the router actually answers', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(pathToRoute(route.path)).not.toBeNull();
    }
  });

  it('lists each address once', () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('always includes the front door', () => {
    expect(PUBLIC_ROUTES.some((r) => r.path === '/')).toBe(true);
  });
});

describe('the generated files', () => {
  const origin = 'https://example.test';

  it('writes a well-formed sitemap with absolute addresses', () => {
    const xml = sitemapXml(origin);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    for (const route of PUBLIC_ROUTES) {
      expect(xml).toContain(`<loc>${origin}${route.path}</loc>`);
    }
    expect(xml.match(/<url>/g)?.length).toBe(PUBLIC_ROUTES.length);
  });

  it('points robots at the sitemap and keeps the proxy out of the index', () => {
    const txt = robotsTxt(origin);
    expect(txt).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(txt).toContain('User-agent: *');
    for (const path of DISALLOWED) expect(txt).toContain(`Disallow: ${path}`);
  });

  it('takes the origin from the environment, with no trailing slash', () => {
    expect(siteOrigin({ VITE_APP_URL: 'https://wobo.test/' })).toBe('https://wobo.test');
    expect(siteOrigin({})).toBe('https://heywobo.com');
  });
});

describe('the generated sub-addresses', () => {
  const sub = {
    helpArticles: [
      { group: 'wobo-basics', slug: 'what-is-wobo' },
      { group: 'product-features', slug: 'the-plane' },
    ],
    legalSlugs: ['terms-of-service', 'privacy-policy'],
  };

  it('lists every help article and every legal document, not just the two indexes', () => {
    const paths = expandPublicRoutes(sub).map((r) => r.path);
    expect(paths).toContain('/help/wobo-basics/what-is-wobo');
    expect(paths).toContain('/help/product-features/the-plane');
    expect(paths).toContain('/legal/terms-of-service');
    expect(paths).toContain('/legal/privacy-policy');
  });

  it('keeps the fixed addresses, in front, exactly once', () => {
    const paths = expandPublicRoutes(sub).map((r) => r.path);
    expect(paths.slice(0, PUBLIC_ROUTES.length)).toEqual(PUBLIC_ROUTES.map((r) => r.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('only produces addresses the router answers', () => {
    for (const route of expandPublicRoutes(sub)) {
      expect([route.path, pathToRoute(route.path)]).not.toEqual([route.path, null]);
    }
  });

  it('never writes the same address twice, even when handed a duplicate', () => {
    const twice = expandPublicRoutes({
      helpArticles: [...sub.helpArticles, ...sub.helpArticles],
      legalSlugs: [...sub.legalSlugs, ...sub.legalSlugs],
    });
    expect(new Set(twice.map((r) => r.path)).size).toBe(twice.length);
  });

  it('does not ask an engine to index the checkout, whose words are that it does not work yet', () => {
    // It was in the sitemap with a canonical of its own and no `noindex`, and its 237 words are
    // "Paying is not open yet. The prices are set and printed on the plans page, but the payment
    // page is not open yet, so nothing can be charged." That is a page to walk a buyer through,
    // not a page to win a search on, and asking Google to index it teaches an engine that Wobo is
    // a thing that cannot be bought. It is a door the app answers, like /onboarding: `vercel.json`
    // rewrites it to the shell, so /gift's "Choose a gift" still opens it.
    expect(PUBLIC_ROUTES.some((r) => r.path === '/plans/checkout')).toBe(false);
  });

  it('does not list /legal/contact, which is now an alias of /contact', () => {
    const paths = expandPublicRoutes(sub).map((r) => r.path);
    expect(paths).not.toContain('/legal/contact');
    expect(paths).toContain('/contact');
  });
});
