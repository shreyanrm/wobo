'use client';

/**
 * /sitemap — every public page, on one page, for a person rather than a crawler.
 *
 * It lists what the footer lists, then every help article by group and every legal document,
 * read from the same compiled sources the pages render, so it can never name a page that is not
 * there. `public/sitemap.xml` is the crawler's version of the same list (`scripts/sitemap.ts`).
 */

import { publishableComparisons } from '../growth/comparisons';
import { publishableBoards } from '../growth/examCycle';
import { legalPath } from '../legal/catalog';
import { documentSlugs, legalDocument } from '../legal/docs';
import { addressPath, hubPath } from '../syllabus/address';
import { boards, subjects } from '../syllabus/tree';
import { BLOG } from './blog/blog-content';
import { tagPath } from './blog/post';
import { ClosePanel } from './ClosePanel';
import { useDoorsOpen } from './dial';
import { HELP } from './help-content';
import { FOOTER_COLUMNS, headerDoors, SiteLink } from './nav';
import { SiteShell } from './SiteShell';

export function Sitemap() {
  const doors = headerDoors(useDoorsOpen());
  const legal = documentSlugs().map((slug) => ({
    slug,
    title: legalDocument(slug)?.shape.title ?? slug,
  }));
  return (
    <SiteShell current="sitemap" title="Sitemap · Wobo" label="Sitemap">
      <section className="st-page-hero">
        <div className="st-wrap">
          <h1>Sitemap</h1>
        </div>
      </section>
      <section className="st-section" style={{ paddingTop: 0 }}>
        <div className="st-wrap">
          <div className="sm-grid">
            {FOOTER_COLUMNS.map((column) => (
              <div className="sm-col" key={column.title}>
                <h2>{column.title}</h2>
                {column.links.map((link) => (
                  <SiteLink key={link.href} href={link.href}>
                    {link.label}
                  </SiteLink>
                ))}
                {column.title === 'Wobo' ? (
                  <>
                    <SiteLink to={doors.signIn.to}>{doors.signIn.label}</SiteLink>
                    <SiteLink to={doors.getStarted.to}>{doors.getStarted.label}</SiteLink>
                  </>
                ) : null}
              </div>
            ))}
            {HELP.groups.map((group) => (
              <div className="sm-col" key={group.slug}>
                <h2>{group.title}</h2>
                {group.articles.map((article) => (
                  <SiteLink
                    key={article.slug}
                    to={{ name: 'helpArticle', group: group.slug, slug: article.slug }}
                  >
                    {article.title}
                  </SiteLink>
                ))}
              </div>
            ))}
            <div className="sm-col">
              <h2>{BLOG.title}</h2>
              <SiteLink to={{ name: 'blog' }}>Every post</SiteLink>
              {BLOG.posts.map((post) => (
                <SiteLink key={post.slug} to={{ name: 'blogPost', slug: post.slug }}>
                  {post.title}
                </SiteLink>
              ))}
              {BLOG.tags.map((tag) => (
                <SiteLink key={tag.slug} href={tagPath(tag.slug)}>
                  {tag.title}
                </SiteLink>
              ))}
            </div>
            {/* The syllabus family. The four boards and the nine subjects, and not the 409 pages
                under them: this page is for a person, and the crawler's list is
                `public/sitemap.xml`, which carries every one of them. Two clicks from here reaches
                any chapter we hold. */}
            <div className="sm-col">
              <h2>Syllabus</h2>
              {boards().map((board) => (
                <SiteLink key={board.slug} href={addressPath({ board: board.slug })}>
                  {board.short}
                </SiteLink>
              ))}
              {subjects().map((hub) => (
                <SiteLink key={hub.slug} href={hubPath(hub.slug)}>
                  {hub.name}
                </SiteLink>
              ))}
            </div>
            {/* The three growth families. Their indexes and the four board pages, and not the
                hundred and fifteen glossary entries: this page is for a person, and the crawler's
                list is `public/sitemap.xml`, which carries every one of them. */}
            <div className="sm-col">
              <h2>Answers</h2>
              <SiteLink to={{ name: 'glossary' }}>The glossary</SiteLink>
              <SiteLink to={{ name: 'exams' }}>The syllabus, from the board</SiteLink>
              {publishableBoards().map((board) => (
                <SiteLink key={board.id} href={board.path}>
                  {board.short}, what the board published
                </SiteLink>
              ))}
              {/* The side-by-side family is linked only while it has a page to link to. It holds
                  none today: with no price row (docs/SELL.md §2) and no row where one side is an
                  absence, each comparison has two sourced questions on it and falls under the
                  family's floor, so nothing is published and nothing is pointed at. */}
              {publishableComparisons().length > 0 ? (
                <SiteLink to={{ name: 'compare' }}>Side by side</SiteLink>
              ) : null}
              {publishableComparisons().map((page) => (
                <SiteLink key={page.slug} href={page.path}>
                  Wobo and {page.otherName}
                </SiteLink>
              ))}
            </div>
            <div className="sm-col">
              <h2>Legal</h2>
              <SiteLink to={{ name: 'legal' }}>The legal set</SiteLink>
              {legal.map((doc) => (
                <SiteLink key={doc.slug} href={legalPath(doc.slug)}>
                  {doc.title}
                </SiteLink>
              ))}
            </div>
          </div>
        </div>
      </section>
      <ClosePanel page="sitemap" />
    </SiteShell>
  );
}
