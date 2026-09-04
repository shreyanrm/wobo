'use client';

/**
 * /sitemap — every public page, on one page, for a person rather than a crawler.
 *
 * It lists what the footer lists, then every help article by group and every legal document,
 * read from the same compiled sources the pages render, so it can never name a page that is not
 * there. `public/sitemap.xml` is the crawler's version of the same list (`scripts/sitemap.ts`).
 */

import { legalPath } from '../legal/catalog';
import { documentSlugs, legalDocument } from '../legal/docs';
import { ClosePanel } from './ClosePanel';
import { HELP } from './help-content';
import { DOORS, FOOTER_COLUMNS, SiteLink } from './nav';
import { SiteShell } from './SiteShell';

export function Sitemap() {
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
                    <SiteLink to={{ name: 'sign-in' }}>{DOORS.signIn}</SiteLink>
                    <SiteLink to={{ name: 'onboarding' }}>{DOORS.getStarted}</SiteLink>
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
