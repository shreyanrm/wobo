/**
 * THE WORDMARK GOES TO THE FRONT PAGE, WHICH IS `/`.
 *
 * The header's wordmark and the footer's are `SiteLink to={{ name: 'landing' }}`, and the href
 * used to come from `routeToPath`, which answers `/landing`. `/landing` is a rewrite into the SPA
 * shell: 3,833 bytes, no words, no heading, `noindex`. So 604 of the 605 published pages spent
 * their most-repeated internal link on a wordless page, and only 3 linked the front page at all.
 * `addressOf` answers with the address of record — the one the sitemap publishes and the one the
 * canonical declares — and that is what an href has to carry.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider } from '../../shell/router';
import { SiteLink } from './nav';

describe('the wordmark', () => {
  const html = renderToStaticMarkup(
    <RouterProvider initial={{ name: 'landing' }}>
      <SiteLink to={{ name: 'landing' }}>Wobo</SiteLink>
    </RouterProvider>,
  );

  it('is a real link to the page the build wrote a file for', () => {
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/landing"');
  });
});
