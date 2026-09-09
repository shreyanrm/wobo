'use client';

/**
 * /blog — the index.
 *
 * The whole blog is a handful of posts compiled into one JSON, so the index lists every one of
 * them and nothing paginates or collapses. The count it prints is `posts.length` and never a
 * number anybody typed: the count we publish is the count we can prove (WOBO-TASKS §10.21).
 *
 * `/blog` is the ORIGIN. Every syndicated copy of a post, anywhere, points its canonical back at
 * the address this page links to, and no copy is released before this one is indexed
 * (docs/GROWTH-DESK.md §3). The feed is linked in plain sight for the same reason: the version
 * somebody subscribes to should be ours.
 */

import { Label, Tag } from '../../../ui/primitives';
import { ClosePanel } from '../ClosePanel';
import { SiteLink } from '../nav';
import { Reveal } from '../Reveal';
import { SiteShell } from '../SiteShell';
import { BLOG } from './blog-content';
import { PostMeta } from './PostMeta';
import { blogJsonLd, breadcrumbJsonLd, FEED_PATH, tagPath } from './post';
import { Schema, siteBase } from './Schema';
import { ensureBlogStyles } from './styles';

ensureBlogStyles();

export function Blog() {
  const posts = BLOG.posts;
  const base = siteBase();

  return (
    <SiteShell current="blog" title={`${BLOG.title} · Wobo`} label={BLOG.title}>
      <section className="st-page-hero">
        <div className="st-wrap">
          <Label>Blog</Label>
          <h1>{BLOG.title}</h1>
          <p className="st-sub">{BLOG.blurb}</p>
          <div className="bl-tags">
            {BLOG.tags.map((tag) => (
              <SiteLink key={tag.slug} className="bl-tag" href={tagPath(tag.slug)}>
                {tag.title}
              </SiteLink>
            ))}
          </div>
          <p className="bl-count">
            {posts.length} {posts.length === 1 ? 'post' : 'posts'}, newest first.
          </p>
        </div>
      </section>

      <section className="st-section" style={{ paddingTop: 0 }} aria-label="Every post">
        <div className="st-wrap">
          <Reveal className="bl-list">
            {posts.map((post) => (
              <SiteLink
                key={post.slug}
                className="bl-card"
                to={{ name: 'blogPost', slug: post.slug }}
              >
                <PostMeta post={post} />
                <h2>{post.title}</h2>
                <p>{post.summary}</p>
              </SiteLink>
            ))}
          </Reveal>
          <p className="bl-feed">
            Every post here also goes out as a feed: <a href={FEED_PATH}>heywobo.com{FEED_PATH}</a>.
            Wherever else you read one of these, it was published here first and points back at this
            address.
          </p>
          <div className="bl-tags">
            {BLOG.tags.map((tag) => (
              <Tag key={tag.slug}>{tag.title}</Tag>
            ))}
          </div>
        </div>
      </section>

      <Schema
        data={[
          blogJsonLd(base, BLOG),
          breadcrumbJsonLd(base, [
            { name: 'Wobo', path: '/' },
            { name: BLOG.title, path: '/blog' },
          ]),
        ]}
      />
      <ClosePanel page="blog" />
    </SiteShell>
  );
}
