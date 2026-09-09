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
import { BRAND_DESCRIPTION, HOME_TITLE } from '../../shell/head';
import { headFor } from '../../shell/router';

/** The tags by what each one declares, so a test can read one without counting the others. */
function tagged(head: ReturnType<typeof headFor>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of head.tags) out[tag.key] = tag.value;
  return out;
}

describe('the head of an address that is not ours', () => {
  it('says the page was not found, asks not to be indexed, and claims no canonical', () => {
    const head = headFor({ name: 'notfound', path: '/for-schools' });
    expect(head.title).toBe('Page not found · Wobo');
    expect(head.robots).toBe('noindex');
    expect(head.canonical).toBeNull();
  });

  it('offers a crawler no address and no share card to carry away either', () => {
    const tags = tagged(headFor({ name: 'notfound', path: '/for-schools' }));
    expect(tags.robots).toBe('noindex');
    expect(tags.canonical).toBeUndefined();
    expect(tags['og:url']).toBeUndefined();
    expect(tags['og:image']).toBeUndefined();
  });

  it('is the same for a 404 with no address of its own', () => {
    expect(headFor({ name: 'notfound' }).robots).toBe('noindex');
    expect(headFor({ name: 'notfound' }).canonical).toBeNull();
  });
});

describe('the head of a real page', () => {
  it('declares its own address and leaves the title to the page', () => {
    const head = headFor({ name: 'about' });
    expect(head.title).toBeNull();
    expect(head.robots).toBeNull();
    expect(head.canonical).toBe('https://heywobo.com/about');
  });

  it('canonicalises the front door to the root the sitemap publishes', () => {
    expect(headFor({ name: 'landing' }).canonical).toBe('https://heywobo.com/');
  });
});

describe('the tags the pre-render writes into the file', () => {
  it('names the page the build actually rendered, in every tag', () => {
    const tags = tagged(
      headFor({ name: 'about' }, undefined, {
        title: 'About Wobo',
        description: 'Wobo is a small company with one job.',
        image: 'https://heywobo.com/og/about.png',
      }),
    );
    expect(tags.title).toBe('About Wobo');
    expect(tags.description).toBe('Wobo is a small company with one job.');
    expect(tags.canonical).toBe('https://heywobo.com/about');
    expect(tags['og:title']).toBe('About Wobo');
    expect(tags['og:url']).toBe('https://heywobo.com/about');
    expect(tags['og:image']).toBe('https://heywobo.com/og/about.png');
    expect(tags['twitter:card']).toBe('summary_large_image');
    expect(tags['twitter:description']).toBe('Wobo is a small company with one job.');
  });

  it('gives the front page a title of its own and the one line every listing repeats', () => {
    const head = headFor({ name: 'landing' }, undefined, { title: 'Wobo' });
    expect(head.title).toBe(HOME_TITLE);
    const tags = tagged(head);
    expect(tags.title).toBe(HOME_TITLE);
    expect(tags.description).toBe(BRAND_DESCRIPTION);
    expect(tags.canonical).toBe('https://heywobo.com/');
  });

  it('follows the origin it is given, so a preview build never claims the live domain', () => {
    expect(headFor({ name: 'plans' }, 'https://staging.example.com/').canonical).toBe(
      'https://staging.example.com/plans',
    );
  });
});
