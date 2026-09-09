/**
 * NINE REAL PAGES THAT NOTHING LINKED.
 *
 * The build writes a page for every subject hub — /subjects/biology through /subjects/social-science
 * — and not one of the 605 published pages carried a link to one of them. /subjects, the page they
 * belong to, linked /about, /blog, /contact, five legal documents, /plans, /security and itself,
 * and none of its own children. They were reachable only from `sitemap.xml`.
 *
 * /subjects now links them, from a list typed in `screens/pitch/hubs.ts` rather than generated,
 * because generating it on that page would mean loading 292KB of syllabus JSON onto the site's
 * highest-intent page for nine links. This is the check that keeps the typed list true: it is
 * exactly the set the build publishes, in the same order, with the same names.
 */

import { describe, expect, it } from 'bun:test';
import { SUBJECT_PAGES, subjectPagePath } from '../src/screens/pitch/hubs';
import { releasedPages } from '../src/screens/syllabus/pages';
import { subjects } from '../src/screens/syllabus/tree';

describe('the subject pages /subjects offers', () => {
  it('is exactly the set the build publishes, in the build’s own order', () => {
    const published = releasedPages()
      .filter((page) => page.layer === 'hub')
      .map((page) => page.path);
    expect(SUBJECT_PAGES.map((hub) => subjectPagePath(hub.slug))).toEqual(published);
  });

  it('calls each one what its own page calls it', () => {
    const names = new Map(subjects().map((hub) => [hub.slug, hub.name]));
    for (const hub of SUBJECT_PAGES)
      expect([hub.slug, hub.name]).toEqual([hub.slug, names.get(hub.slug) as string]);
  });
});
