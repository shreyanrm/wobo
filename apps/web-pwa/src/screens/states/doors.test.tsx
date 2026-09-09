/**
 * THE WAY OUT OF A STATE PAGE HAS TO BE A LINK.
 *
 * `dist/404.html` is written as the real 404 screen so that "the person who mistyped the address
 * has to be able to read their way out of it with nothing running" (scripts/notfound.ts). It
 * contained ZERO `<a>` elements: both doors were `<button type="button">`, and a button does
 * nothing at all with JavaScript off. So the one page on the site written for a reader with
 * nothing running was the one page with no way out of it — 27 words, no links in, no links out —
 * while /about renders 34 real hrefs.
 *
 * A door that goes to an address is an anchor with that address in it. The click still belongs to
 * the router, so nothing about the running app changes; the href is what a crawler follows, what a
 * right-click copies, and what works when the bundle does not.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { type SceneAction, StateScene } from './Scene';

function markup(actions: SceneAction[]): string {
  return renderToStaticMarkup(
    <StateScene
      code="404"
      title="This page isn't here"
      body="Wobo looked around and could not find it."
      actions={actions}
      art={null}
    />,
  );
}

describe('a door on a state page', () => {
  it('is an anchor carrying its address when it goes to one', () => {
    const html = markup([
      { label: 'Start free', onSelect: () => {}, href: '/onboarding' },
      { label: 'Back to the front page', onSelect: () => {}, href: '/' },
    ]);
    expect(html).toContain('<a href="/onboarding"');
    expect(html).toContain('<a href="/"');
    expect(html).not.toContain('<button');
  });

  it('stays a button where the door does something rather than goes somewhere', () => {
    const html = markup([{ label: 'Try again', onSelect: () => {} }]);
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain('<a href');
  });
});
