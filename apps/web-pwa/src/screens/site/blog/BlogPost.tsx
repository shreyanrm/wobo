'use client';

/**
 * /blog/<slug> — one post, and the canonical address of everything that will ever be syndicated
 * from it (docs/GROWTH-DESK.md §3).
 *
 * The shape is the help centre's, because the help centre's shape is right: the opening line is a
 * complete answer on its own and is set larger than the body, nothing sits above it but the crumb,
 * and the ask block under the article is the door a reader who now has a question walks through.
 *
 * Three things this page carries that a help article does not, and each is a condition of the blog
 * being worth publishing at all:
 *
 *  · a byline, which names a person where the owner has named one and the desk where they have
 *    not, because inventing one would be inventing a person (docs/copy/voice.md §8.1);
 *  · an assistance note where a machine helped write the post, in the same size as the rest, said
 *    once, in one place, from the blog's own README;
 *  · structured data describing the post, its date, its publisher and where it sits, written into
 *    the body so the pre-render carries it into the emitted file.
 */

import { useSdk } from '../../../store/sdk';
import { Label } from '../../../ui/primitives';
import { AskWobo } from '../AskWobo';
import { ClosePanel } from '../ClosePanel';
import { Prose, Runs } from '../Doc';
import { SiteLink } from '../nav';
import { Reveal } from '../Reveal';
import { SiteShell } from '../SiteShell';
import { BLOG } from './blog-content';
import { PostMeta } from './PostMeta';
import {
  breadcrumbJsonLd,
  findAuthor,
  findPost,
  newestFirst,
  postJsonLd,
  tagPath,
  tagsOf,
} from './post';
import { Schema, siteBase } from './Schema';
import { ensureBlogStyles } from './styles';

ensureBlogStyles();

export function BlogPost({ slug }: { slug: string }) {
  const post = findPost(BLOG, slug);
  const sdk = useSdk();

  if (!post) {
    // Its own title, not the blog's. Two addresses under one title is the failure the whole search
    // audit turned on (docs/GROWTH-SEARCH.md §2), and a page that says nothing is here has to say
    // so in the tab as well. It is not in the sitemap and never pre-rendered, so in production an
    // unknown address is served the shell, which carries a `noindex`.
    return (
      <SiteShell current="blog" title="That post is not here · Wobo" label={BLOG.title}>
        <section className="st-page-hero">
          <div className="st-wrap">
            <Label>{BLOG.title}</Label>
            <h1>That post is not here</h1>
            <p className="st-sub">
              The address does not match anything we have published. Everything on the blog is on
              one page, and it is one tap away.
            </p>
            <div className="st-row">
              <SiteLink className="st-btn st-pig" to={{ name: 'blog' }}>
                Open the blog
              </SiteLink>
            </div>
          </div>
        </section>
        <ClosePanel page="blog" />
      </SiteShell>
    );
  }

  const base = siteBase();
  const author = findAuthor(BLOG, post.author);
  const tags = tagsOf(BLOG, post);
  const ordered = newestFirst(BLOG.posts);
  const at = ordered.findIndex((one) => one.slug === post.slug);
  const newer = at > 0 ? ordered[at - 1] : undefined;
  const older = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : undefined;
  const signedIn = sdk.config.devAuth || sdk.identity.isAuthenticated();

  return (
    <SiteShell current="blog" title={`${post.title} · Wobo`} label={post.title}>
      <article className="bl-article">
        <nav className="st-crumb" aria-label="Where this page sits">
          <SiteLink to={{ name: 'blog' }}>{BLOG.title}</SiteLink>
          {tags[0] ? <span aria-hidden>·</span> : null}
          {tags[0] ? <SiteLink href={tagPath(tags[0].slug)}>{tags[0].title}</SiteLink> : null}
        </nav>

        <Reveal>
          <h1>{post.title}</h1>
          <PostMeta post={post} showUpdated />
          {post.lead.length > 0 ? (
            <p className="bl-lead">
              <Runs runs={post.lead} />
            </p>
          ) : null}
          <Prose blocks={post.blocks} />
        </Reveal>

        <div className="bl-tags">
          {tags.map((tag) => (
            <SiteLink key={tag.slug} className="bl-tag" href={tagPath(tag.slug)}>
              {tag.title}
            </SiteLink>
          ))}
        </div>

        {post.aiAssisted ? (
          <div className="bl-note">
            <p>
              <b>How this was written.</b> {BLOG.note}
            </p>
          </div>
        ) : null}
        {author ? <p className="bl-about">{author.about}</p> : null}

        {newer || older ? (
          <div className="bl-next">
            {newer ? (
              <SiteLink to={{ name: 'blogPost', slug: newer.slug }}>
                Newer
                <b>{newer.title}</b>
              </SiteLink>
            ) : null}
            {older ? (
              <SiteLink to={{ name: 'blogPost', slug: older.slug }}>
                Older
                <b>{older.title}</b>
              </SiteLink>
            ) : null}
          </div>
        ) : null}

        <Reveal>
          <AskWobo
            label="Still wondering?"
            heading={
              signedIn
                ? 'Ask Wobo about this, and it will work through it with you.'
                : 'Ask Wobo about this. Sign in and it will work through it on your own account.'
            }
            placeholder={post.title}
          />
        </Reveal>
      </article>

      <Schema
        data={[
          postJsonLd(base, BLOG, post),
          breadcrumbJsonLd(base, [
            { name: 'Wobo', path: '/' },
            { name: BLOG.title, path: '/blog' },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
        ]}
      />
      <ClosePanel page="blog" />
    </SiteShell>
  );
}
