/**
 * Build step: the blog, compiled from `docs/copy/blog/**`.
 *
 * It writes two files and nothing else:
 *
 *   · `src/screens/site/content/blog.json` — the compiled document the three blog pages import,
 *     checked in so a clone type-checks and tests without running the build first, and regenerated
 *     by every build so it cannot drift from the copy a reviewer edits;
 *   · `public/blog/feed.xml` — the feed, at the address the blog page points at.
 *
 * IT REFUSES TO PUBLISH A PAGE THAT WOULD NOT BE WORTH LANDING ON. Every gate lives in `post.ts`
 * and is proved in `post.test.ts`; this step applies them and, on any violation, prints the post
 * and the reason and exits non-zero. A build that shipped a thin page would be the exact thing
 * docs/GROWTH-SEARCH.md §3 says never to ship, and the check has to be the build's rather than
 * the writer's memory.
 *
 * WHY IT LIVES HERE AND NOT IN `scripts/`. It belongs beside `scripts/site-content.ts`, which does
 * the same job for /about and /help. It is here because `apps/web-pwa/scripts/**` is owned by the
 * pre-render wave for the length of this one, and two waves editing that directory would collide.
 * Moving it is one `git mv` and one line of `package.json` the day that wave lands.
 *
 * Run: `bun run blog:content` (wired into `bun run build`, before `sitemap`).
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseOrigin } from '../../../shell/head';
import {
  type BlogDoc,
  type BlogPost,
  blogViolations,
  feedXml,
  newestFirst,
  parseBlogIndex,
  parsePost,
  postsWithTag,
  postViolations,
  tagViolations,
} from './post';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', '..', '..');
const REPO = join(APP, '..', '..');
const SOURCE = join(REPO, 'docs', 'copy', 'blog');
const OUT_JSON = join(APP, 'src', 'screens', 'site', 'content', 'blog.json');
const OUT_FEED = join(APP, 'public', 'blog', 'feed.xml');

/** The origin the feed's absolute addresses are written at. One change moves the domain (§8). */
function origin(env: Record<string, string | undefined> = process.env): string {
  return normaliseOrigin(env.VITE_APP_URL ?? env.APP_URL ?? null);
}

export function buildBlog(): { doc: BlogDoc; refused: string[] } {
  const index = parseBlogIndex(readFileSync(join(SOURCE, 'README.md'), 'utf8'));
  const files = readdirSync(SOURCE)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();

  const posts: BlogPost[] = [];
  const refused: string[] = [];
  const ctx = { authors: index.authors, tags: index.tags };
  for (const file of files) {
    const post = parsePost(file, readFileSync(join(SOURCE, file), 'utf8'));
    const bad = postViolations(post, ctx);
    if (bad.length > 0) {
      refused.push(...bad.map((what) => `${file} ${what}`));
      continue;
    }
    posts.push(post);
  }

  // A tag with too few posts under it, or with nothing of its own to say, is not published as a
  // page. Its posts still carry the word; there is simply no address for it yet.
  const doc: BlogDoc = {
    title: index.title,
    blurb: index.blurb,
    note: index.note,
    authors: index.authors,
    tags: [],
    posts: newestFirst(posts),
  };
  const published = index.tags.filter((tag) => {
    const bad = tagViolations(tag, postsWithTag({ ...doc, tags: index.tags }, tag.slug));
    if (bad.length > 0) refused.push(...bad.map((what) => `tag "${tag.slug}" ${what}`));
    return bad.length === 0;
  });
  doc.tags = published;

  refused.push(...blogViolations(doc));
  return { doc, refused };
}

export function writeBlog(): void {
  const { doc, refused } = buildBlog();
  if (refused.length > 0) {
    console.error('blog: nothing was written. The gate refused:');
    for (const line of refused) console.error(`  ${line}`);
    process.exit(1);
  }
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  mkdirSync(dirname(OUT_FEED), { recursive: true });
  writeFileSync(OUT_FEED, feedXml(origin(), doc), 'utf8');

  const words = doc.posts.reduce((n, post) => n + post.words, 0);
  console.log(
    `blog: ${doc.posts.length} ${doc.posts.length === 1 ? 'post' : 'posts'}, ${doc.tags.length} tags, ${words} words, feed at ${origin()}/blog/feed.xml`,
  );
  const assisted = doc.posts.filter((post) => post.aiAssisted).length;
  console.log(`  ${assisted} of them carry the assistance note`);
}

if (import.meta.main) writeBlog();
