'use client';

/**
 * The line under a post's title: who wrote it, when, and how long it takes to read.
 *
 * IT IS A ROW OF SPANS, NOT A PARAGRAPH, and that is load-bearing. `scripts/prerender.ts` writes
 * each page's meta description from the page's own opening paragraphs. A byline set as a `<p>`
 * would be the first paragraph on every post, so every post in a search result would be described
 * as "the syllabus desk at Wobo. 9 September 2026. 4 minutes" instead of by what the post says.
 * Set as a row of spans, the lead is the first paragraph on the page, which is what a description
 * should be.
 *
 * The reading time is computed from the post's own word count at build time, so it cannot claim a
 * length the page does not have.
 */

import { BLOG } from './blog-content';
import { type BlogPost, byline, findAuthor, formatDate } from './post';

const Dot = () => <span className="bl-dot" aria-hidden />;

export function PostMeta({ post, showUpdated = false }: { post: BlogPost; showUpdated?: boolean }) {
  const author = findAuthor(BLOG, post.author);
  return (
    <div className="bl-by">
      {author ? <span>By {byline(author)}</span> : null}
      {author ? <Dot /> : null}
      <time dateTime={post.published}>{formatDate(post.published)}</time>
      <Dot />
      <span>{post.minutes} minute read</span>
      {showUpdated && post.updated ? (
        <>
          <Dot />
          <time dateTime={post.updated}>Updated {formatDate(post.updated)}</time>
        </>
      ) : null}
    </div>
  );
}
