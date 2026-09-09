'use client';

/**
 * /blog/tag/<tag> — one tag.
 *
 * A tag page exists only where it is a page rather than a second address for one post: the
 * compiler publishes a tag with at least two posts under it AND a blurb of its own, and refuses
 * the rest (`post.ts`, `TAG_POST_FLOOR`). So the blurb here is never a list of the titles
 * underneath it; it is the page's own words, and it is what a search result shows.
 *
 * An address for a tag we do not publish is not a page that says nothing: it says so, and offers
 * the tags that do exist.
 */

import { Label } from '../../../ui/primitives';
import { ClosePanel } from '../ClosePanel';
import { SiteLink } from '../nav';
import { Reveal } from '../Reveal';
import { SiteShell } from '../SiteShell';
import { BLOG } from './blog-content';
import { PostMeta } from './PostMeta';
import { breadcrumbJsonLd, findTag, postsWithTag, tagJsonLd, tagPath } from './post';
import { Schema, siteBase } from './Schema';
import { ensureBlogStyles } from './styles';

ensureBlogStyles();

export function BlogTag({ tag: slug }: { tag: string }) {
  const tag = findTag(BLOG, slug);

  if (!tag) {
    // Its own title, for the reason `BlogPost` states: one title per address, always.
    return (
      <SiteShell current="blog" title="There is no such tag · Wobo" label={BLOG.title}>
        <section className="st-page-hero">
          <div className="st-wrap">
            <Label>{BLOG.title}</Label>
            <h1>There is no such tag</h1>
            <p className="st-sub">
              We publish a tag page once there is enough under it to be worth reading. These are the
              ones there are.
            </p>
            <div className="bl-tags">
              {BLOG.tags.map((one) => (
                <SiteLink key={one.slug} className="bl-tag" href={tagPath(one.slug)}>
                  {one.title}
                </SiteLink>
              ))}
            </div>
          </div>
        </section>
        <ClosePanel page="blog" />
      </SiteShell>
    );
  }

  const posts = postsWithTag(BLOG, tag.slug);
  const base = siteBase();

  return (
    <SiteShell
      current="blog"
      title={`${tag.title}, on the Wobo blog · Wobo`}
      label={`${tag.title}, on the blog`}
    >
      <section className="st-page-hero">
        <div className="st-wrap">
          <nav className="st-crumb" aria-label="Where this page sits">
            <SiteLink to={{ name: 'blog' }}>{BLOG.title}</SiteLink>
          </nav>
          <Label>Tag</Label>
          <h1>{tag.title}</h1>
          <p className="st-sub">{tag.blurb}</p>
          <p className="bl-count">
            {posts.length} {posts.length === 1 ? 'post' : 'posts'} under this tag, newest first.
          </p>
        </div>
      </section>

      <section
        className="st-section"
        style={{ paddingTop: 0 }}
        aria-label={`Posts on ${tag.title}`}
      >
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
          <div className="bl-tags">
            {BLOG.tags.map((one) => (
              <SiteLink
                key={one.slug}
                className="bl-tag"
                href={tagPath(one.slug)}
                current={one.slug === tag.slug}
              >
                {one.title}
              </SiteLink>
            ))}
          </div>
        </div>
      </section>

      <Schema
        data={[
          tagJsonLd(base, BLOG, tag),
          breadcrumbJsonLd(base, [
            { name: 'Wobo', path: '/' },
            { name: BLOG.title, path: '/blog' },
            { name: tag.title, path: tagPath(tag.slug) },
          ]),
        ]}
      />
      <ClosePanel page="blog" />
    </SiteShell>
  );
}
