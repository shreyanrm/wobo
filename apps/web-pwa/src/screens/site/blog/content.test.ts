/**
 * THE SHIPPED BLOG, held to the gate that let it through.
 *
 * `post.test.ts` proves the gate. This proves the FILE: that `content/blog.json` in this working
 * tree is what the compiler would write from `docs/copy/blog/**`, that every page it promises
 * would clear the gate again today, that the count it publishes is the count of files that
 * actually passed (the honest-count law, WOBO-TASKS §10.21), and that every address it publishes
 * is one the router answers and the sitemap carries.
 *
 * The two are separate on purpose. A gate that is only tested against fixtures is a gate nobody
 * has run over the real corpus, and the real corpus is the thing that gets published.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESCRIPTION_FLOOR } from '../../../../scripts/prerender-check';
import { pathToRoute } from '../../../shell/router';
import { expandPublicRoutes, PUBLIC_ROUTES } from '../../states/routes';
import { BLOG, blogAddresses } from './blog-content';
import {
  BLOG_PATH,
  blogViolations,
  FEED_PATH,
  feedXml,
  postPath,
  postsWithTag,
  postViolations,
  SUMMARY_MAX,
  tagPath,
  tagViolations,
} from './post';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..', '..');
const SOURCE = join(REPO, 'docs', 'copy', 'blog');
const APP = join(import.meta.dir, '..', '..', '..', '..');

function sourceFiles(): string[] {
  return readdirSync(SOURCE).filter((name) => name.endsWith('.md') && name !== 'README.md');
}

describe('the compiled blog', () => {
  it('holds the shape the pages import', () => {
    expect(typeof BLOG.title).toBe('string');
    expect(BLOG.blurb.length).toBeGreaterThan(40);
    expect(BLOG.note.length).toBeGreaterThan(40);
    expect(BLOG.authors.length).toBeGreaterThan(0);
    expect(BLOG.tags.length).toBeGreaterThan(0);
    expect(BLOG.posts.length).toBeGreaterThan(0);
  });

  /**
   * THE HONEST COUNT. The index page prints `posts.length`, so this is the assertion that makes
   * that number mean something: every source file the writer put in the folder is published, or
   * the build refused it and nobody may claim it anyway.
   */
  it('publishes exactly the posts the source folder holds, and no more', () => {
    expect(BLOG.posts.length).toBe(sourceFiles().length);
  });

  it('would let every published post through the gate again today', () => {
    const ctx = { authors: BLOG.authors, tags: BLOG.tags };
    for (const post of BLOG.posts) {
      expect([post.slug, postViolations(post, ctx)]).toEqual([post.slug, []]);
    }
  });

  it('would let every published tag page through the gate again today', () => {
    for (const tag of BLOG.tags) {
      expect([tag.slug, tagViolations(tag, postsWithTag(BLOG, tag.slug))]).toEqual([tag.slug, []]);
    }
  });

  it('holds together as a set: no two posts at one address, one title or one summary', () => {
    expect(blogViolations(BLOG)).toEqual([]);
  });

  it('is newest first, which is the order the index and the feed both show', () => {
    const dates = BLOG.posts.map((post) => post.published);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('names an author who exists for every post, and a tag that is published', () => {
    const authors = new Set(BLOG.authors.map((author) => author.key));
    const tags = new Set(BLOG.tags.map((tag) => tag.slug));
    for (const post of BLOG.posts) {
      expect([post.slug, authors.has(post.author)]).toEqual([post.slug, true]);
      for (const tag of post.tags)
        expect([post.slug, tag, tags.has(tag)]).toEqual([post.slug, tag, true]);
    }
  });

  /**
   * Every post here was drafted with a machine's help, so every one of them says so. The field is
   * a decision rather than a default (`parsePost` throws on anything but true or false), and the
   * note itself lives in one place so it cannot be worded differently on different posts.
   */
  it('carries an assistance note wherever a post says a machine helped', () => {
    expect(BLOG.posts.some((post) => post.aiAssisted)).toBe(true);
    expect(BLOG.note.trim().length).toBeGreaterThan(0);
  });

  it('carries no em dash anywhere a reader could meet one', () => {
    expect(JSON.stringify(BLOG)).not.toContain('—');
  });

  it('summarises every post in something a search result can show whole', () => {
    for (const post of BLOG.posts) {
      expect([post.slug, post.summary.length >= DESCRIPTION_FLOOR]).toEqual([post.slug, true]);
      expect([post.slug, post.summary.length <= SUMMARY_MAX]).toEqual([post.slug, true]);
    }
  });
});

describe('the addresses the blog publishes', () => {
  const addresses = blogAddresses();

  it('are all addresses the router answers, at the routes they name', () => {
    expect(pathToRoute(BLOG_PATH)).toEqual({ name: 'blog' });
    for (const post of BLOG.posts) {
      expect(pathToRoute(postPath(post.slug))).toEqual({ name: 'blogPost', slug: post.slug });
    }
    for (const tag of BLOG.tags) {
      expect(pathToRoute(tagPath(tag.slug))).toEqual({ name: 'blogTag', tag: tag.slug });
    }
  });

  /**
   * The sitemap and the pre-render read one list (`screens/states/routes.ts`). A post that is
   * published and not in that list is a page no crawler is ever told about, which for a blog whose
   * whole job is to be the origin would be the one failure that matters.
   */
  it('are every one of them in the list the sitemap and the pre-render walk', () => {
    const published = new Set(expandPublicRoutes().map((route) => route.path));
    for (const address of addresses)
      expect([address, published.has(address)]).toEqual([address, true]);
    expect(PUBLIC_ROUTES.some((route) => route.path === BLOG_PATH)).toBe(true);
  });

  it('keeps the tag segment out of reach of a post, so the two families cannot collide', () => {
    // The gate refuses a post called "tag", and the router reads that segment as the tag family:
    // `/blog/tag` on its own names no tag, so it is a 404 rather than a post with an empty name.
    expect(BLOG.posts.some((post) => post.slug === 'tag')).toBe(false);
    expect(pathToRoute('/blog/tag')).toBeNull();
    expect(pathToRoute('/blog/tag/syllabus/extra')).toBeNull();
  });
});

describe('the feed', () => {
  const onDisk = readFileSync(join(APP, 'public', 'blog', 'feed.xml'), 'utf8');

  it('is the file the compiler would write from the blog that is shipped', () => {
    expect(onDisk).toBe(feedXml('https://heywobo.com', BLOG));
  });

  it('points at itself and at the blog, and carries every post once', () => {
    expect(onDisk).toContain(`href="https://heywobo.com${FEED_PATH}"`);
    expect(onDisk).toContain(`<link>https://heywobo.com${BLOG_PATH}</link>`);
    expect(onDisk.match(/<item>/g)?.length).toBe(BLOG.posts.length);
    for (const post of BLOG.posts) {
      expect(onDisk).toContain(`https://heywobo.com${postPath(post.slug)}`);
    }
  });

  /**
   * The summary and never the body. A feed carrying the whole post hands a scraper a complete copy
   * to publish, and the copy that ranks stops being ours (docs/GROWTH-DESK.md §3).
   */
  it('carries the summary of a post and not its body', () => {
    const first = BLOG.posts[0];
    expect(first).toBeDefined();
    expect(onDisk).toContain((first as { summary: string }).summary);
    expect(onDisk).not.toContain((first as { plain: string }).plain);
  });
});
