/**
 * A PAGE THAT SAYS NOTHING IS HERE MUST NOT INVITE A CRAWLER TO INDEX IT.
 *
 * The router keeps the requested address on a 404, which is right: the learner sees the slip in
 * the bar. But the head was written from that address as though the page were real, so wave 29's
 * walk (site-8) found https://heywobo.com/for-schools, a surface removed in 9f15d09, answering 200
 * with `<link rel="canonical">` pointing at itself, no `noindex`, and a tab that read the bare
 * "Wobo" because the 404 screen sets no title of its own. Every unknown address does the same.
 *
 * `headFor` is the one table the router writes the head from, so it is proved here: a 404 gets a
 * title that says so, a `noindex`, and no canonical; every real page keeps its own.
 */

import { describe, expect, it } from 'bun:test';
import { headFor } from '../../shell/router';

describe('the head of an address that is not ours', () => {
  it('says the page was not found, asks not to be indexed, and claims no canonical', () => {
    expect(headFor({ name: 'notfound', path: '/for-schools' })).toEqual({
      title: 'Page not found · Wobo',
      robots: 'noindex',
      canonical: null,
    });
  });

  it('is the same for a 404 with no address of its own', () => {
    expect(headFor({ name: 'notfound' }).robots).toBe('noindex');
    expect(headFor({ name: 'notfound' }).canonical).toBeNull();
  });
});

describe('the head of a real page', () => {
  it('declares its own address and leaves the title to the page', () => {
    expect(headFor({ name: 'about' })).toEqual({
      title: null,
      robots: null,
      canonical: 'https://heywobo.com/about',
    });
  });

  it('canonicalises the front door to the root the sitemap publishes', () => {
    expect(headFor({ name: 'landing' }).canonical).toBe('https://heywobo.com/');
  });
});
