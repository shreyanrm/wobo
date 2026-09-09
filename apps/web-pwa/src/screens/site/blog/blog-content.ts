/**
 * The compiled blog.
 *
 * `content/blog.json` is written by `blog/compile.ts` from `docs/copy/blog/**` on every build. It
 * is checked in so a clone type-checks and tests without running the build first, and regenerated
 * by the build so it cannot drift from the copy a reviewer edits. This is the same arrangement the
 * help centre has, for the same reason.
 *
 * It is a module of its own so the three blog pages share one import and no other page pays for
 * it: /about and /help have no use for a single word of the blog.
 */

import blogJson from '../content/blog.json';
import type { BlogDoc } from './post';

// The JSON is written by the compiler against this exact type; the assertion is where that
// contract is stated. `content.test.ts` checks the shipped file really does hold it, and that
// every page it promises would clear the gate that let it through.
export const BLOG = blogJson as unknown as BlogDoc;

/** Every address the blog publishes: the index, one per post, one per published tag. */
export function blogAddresses(doc: BlogDoc = BLOG): string[] {
  return [
    '/blog',
    ...doc.posts.map((post) => `/blog/${post.slug}`),
    ...doc.tags.map((tag) => `/blog/tag/${tag.slug}`),
  ];
}
