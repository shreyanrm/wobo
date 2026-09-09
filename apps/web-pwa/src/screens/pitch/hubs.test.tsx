/**
 * /subjects LINKS THE NINE PAGES IT IS THE PARENT OF.
 *
 * The build writes a page for every subject hub — /subjects/biology through /subjects/social-science
 * — and not one of the 605 published pages linked one. /subjects itself linked /about, /blog,
 * /contact, five legal documents, /plans, /security and itself, and none of its own children; they
 * were reachable only from `sitemap.xml`, which is a list of addresses rather than a way anywhere.
 *
 * `test/hubs.test.ts` holds the list to what the build publishes. This holds the strip to the list.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider } from '../../shell/router';
import { SUBJECT_PAGES, SubjectPages, subjectPagePath } from './hubs';

const html = renderToStaticMarkup(
  <RouterProvider initial={{ name: 'subjects' }}>
    <SubjectPages />
  </RouterProvider>,
);

describe('the strip /subjects carries', () => {
  it('links every subject page /subjects is the parent of', () => {
    for (const hub of SUBJECT_PAGES) {
      expect([hub.slug, html.includes(`href="${subjectPagePath(hub.slug)}"`)]).toEqual([
        hub.slug,
        true,
      ]);
      expect(html).toContain(hub.name);
    }
  });

  it('names them and nothing else, so the strip cannot grow a link nobody meant', () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] as string);
    expect(hrefs.sort()).toEqual(SUBJECT_PAGES.map((hub) => subjectPagePath(hub.slug)).sort());
  });
});
