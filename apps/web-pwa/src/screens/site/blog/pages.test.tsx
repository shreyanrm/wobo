/**
 * The two pieces of a blog page whose markup is load-bearing rather than decorative.
 *
 * Neither is a matter of taste, and neither would be caught by looking at the page:
 *
 *  · THE BYLINE IS NOT A PARAGRAPH. `scripts/prerender.ts` writes each page's meta description
 *    from its opening `<p>` elements. A byline set as a paragraph would be the first one on every
 *    post, so all six would arrive in a search result described as "By the syllabus desk at Wobo.
 *    9 September 2026. 4 minute read" instead of by what they say. It is a row of spans, and this
 *    is the test that keeps it one.
 *  · THE STRUCTURED DATA CANNOT ESCAPE ITS OWN SCRIPT. It is the one place in this codebase that
 *    sets inner HTML, so the escaping is proved on the rendered markup and not only on the string.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BLOG } from './blog-content';
import { PostMeta } from './PostMeta';
import { type BlogPost, blogJsonLd, formatDate, postJsonLd } from './post';
import { Schema, siteBase } from './Schema';

const post = BLOG.posts[0] as BlogPost;

describe('the byline', () => {
  const html = renderToStaticMarkup(<PostMeta post={post} showUpdated />);

  it('is not a paragraph, so it cannot become the page description', () => {
    expect(html).not.toContain('<p');
    expect(html.startsWith('<div class="bl-by">')).toBe(true);
  });

  it('says who wrote it, when, and how long it takes to read', () => {
    expect(html).toContain('at Wobo');
    expect(html).toContain(formatDate(post.published));
    expect(html).toContain(`${post.minutes} minute read`);
  });

  it('gives the date to a machine as well as to a reader', () => {
    // HTML attribute names are case-insensitive and the static renderer emits the JSX spelling.
    expect(html.toLowerCase()).toContain(`datetime="${post.published}"`);
    expect(html).toContain('<time');
  });

  it('names no invented person: the desk stands in until the owner names one', () => {
    for (const author of BLOG.authors) {
      if (author.name === null) expect(html).not.toContain('undefined');
    }
  });
});

describe('the structured data', () => {
  const data = [postJsonLd(siteBase(), BLOG, post), blogJsonLd(siteBase(), BLOG)];
  const html = renderToStaticMarkup(<Schema data={data} />);

  it('is written into the body, where the pre-render carries it into the emitted file', () => {
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(html.match(/<script/g)?.length).toBe(2);
  });

  it('cannot close its own script element, whatever a post says', () => {
    const nasty = renderToStaticMarkup(
      <Schema data={[{ headline: '</script><script>alert(1)</script>' }]} />,
    );
    expect(nasty.match(/<\/script>/g)?.length).toBe(1);
    expect(nasty).toContain('\\u003c');
  });

  it('describes the post a reader is on, at our own origin', () => {
    const first = html.slice(html.indexOf('>') + 1, html.indexOf('</script>'));
    const parsed = JSON.parse(first) as Record<string, unknown>;
    expect(parsed['@type']).toBe('BlogPosting');
    expect(parsed.headline).toBe(post.title);
    expect(String(parsed.url)).toBe(`${siteBase()}/blog/${post.slug}`);
    expect((parsed.publisher as Record<string, unknown>).name).toBe('Wobo');
  });
});
