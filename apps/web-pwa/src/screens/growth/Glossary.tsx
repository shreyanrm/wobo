'use client';

/**
 * `/glossary` and `/glossary/<concept>` — the board-agnostic pages.
 *
 * The component renders `concepts.ts`'s page object and nothing else. It writes no sentence of its
 * own, which is not a style preference: the quality gate counts the words in that object, so a
 * paragraph typed here would be a paragraph the gate never saw, and the count we publish would
 * stop being the count we can prove.
 *
 * A slug we do not hold is a real 404 with the address kept, exactly as the syllabus family does
 * it, because a glossary entry that has not been built is not a page that says nothing — it is a
 * page that is not there.
 *
 * THE LEAD PARAGRAPH SITS OUTSIDE THE `<header>`, on purpose, and it is not cosmetic.
 * `scripts/prerender.ts` reads a page's own opening words back off the render to write its meta
 * description, and it skips anything inside a `header` because on every other page that is chrome.
 * Left inside, the four board pages were all described to a search engine by the standing note,
 * which is identical on all four, and `/compare` and its children shared a second one. Eight
 * indexable pages, two descriptions. The lead is the page's own opening sentence rather than part
 * of its heading, so outside the header is where it belonged anyway.
 */

import { lazy, Suspense } from 'react';
import { Label } from '../../ui/primitives';
import { PitchAsk } from '../pitch/Ask';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import type { ConceptPage, PlaceRow } from './concepts';
import { conceptBySlug, conceptPage, glossaryIndex, publishable } from './concepts';
import { ensureGrowthStyles } from './styles';

// The chunk arriving IS the page being opened, so the sheet goes in at import time.
ensureGrowthStyles();

const NotFoundScreen = lazy(() =>
  import('../states/StateHost').then((m) => ({ default: m.NotFoundScreen })),
);

function Missing() {
  return (
    <Suspense fallback={null}>
      <NotFoundScreen />
    </Suspense>
  );
}

/** One placement: the board, the chapter it files this under, its objectives, and the document. */
function Placement({ row }: { row: PlaceRow }) {
  return (
    <li className="gw-place">
      <span className="gw-board">
        {row.board} · {row.level} · {row.subject}
      </span>
      <h3>{row.name}</h3>
      <p className="gw-where">
        {row.kind}
        {row.under ? `, ${row.under}` : ''}
      </p>
      {row.objectives.length > 0 ? (
        <ul>
          {row.objectives.map((objective) => (
            <li key={objective}>{objective}</li>
          ))}
        </ul>
      ) : null}
      <span className="gw-src">
        <a href={row.doc.url} rel="nofollow noopener" target="_blank">
          {row.doc.title}
        </a>
        <span>{row.where}</span>
      </span>
    </li>
  );
}

export function GlossaryEntry({ slug }: { slug: string }) {
  const concept = conceptBySlug(slug);
  if (!concept) return <Missing />;
  const page = conceptPage(concept);
  // The gate is not advice. A concept that does not clear it has no page, and the address answers
  // the way any address we do not hold answers.
  if (!page.verdict.publishable) return <Missing />;
  return <Entry page={page} />;
}

function Entry({ page }: { page: ConceptPage }) {
  return (
    <SiteShell title={page.title} label={page.name}>
      <div className="st-wrap">
        <nav className="st-crumb" aria-label="Where this sits">
          <SiteLink href="/glossary">The glossary</SiteLink>
          <b>/</b>
          <b>{page.name}</b>
        </nav>
        <header className="gw-head">
          <Label>Glossary</Label>
          <h1>{page.name}</h1>
        </header>
        <p className="gw-lead">{page.lead}</p>
        <p className="gw-standing">{page.standing}</p>

        <section className="st-section" aria-labelledby="gw-places">
          <div className="st-head">
            <h2 id="gw-places">{page.placesHeading}</h2>
          </div>
          <ul className="gw-places">
            {page.rows.map((row) => (
              <Placement key={row.key} row={row} />
            ))}
          </ul>
        </section>

        <section className="st-section" aria-labelledby="gw-sources">
          <div className="st-head">
            <h2 id="gw-sources">{page.sourcesHeading}</h2>
            <p>{page.sourcesLead}</p>
          </div>
          <ul className="gw-docs">
            {page.docs.map((doc) => (
              <li key={doc.id}>
                <a className="gw-doc" href={doc.url} rel="nofollow noopener" target="_blank">
                  {doc.title}
                </a>
                <span className="gw-src">
                  <span>{doc.publisher}</span>
                  <span>{doc.read}</span>
                  <span className="gw-hash">{doc.hash}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="st-section">
          <PitchAsk
            page="glossary"
            heading={page.askHeading}
            placeholder={page.askPlaceholder}
            chips={page.askChips}
          />
        </section>
      </div>
      <ClosePanel page="glossary" />
    </SiteShell>
  );
}

export function Glossary() {
  const index = glossaryIndex();
  if (!index.verdict.publishable) return <Missing />;
  const pages = publishable();
  const listed = index.groups.reduce((n, group) => n + group.entries.length, 0);
  return (
    <SiteShell title={index.title} label={index.heading}>
      <div className="st-wrap">
        <header className="gw-head">
          <Label>Glossary</Label>
          <h1>{index.heading}</h1>
        </header>
        <p className="gw-lead">{index.lead}</p>
        <p className="gw-standing">{index.count}</p>
        {index.groups.map((group) => {
          const id = `gw-${group.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          return (
            <section className="gw-group" key={group.subject} aria-labelledby={id}>
              <h2 id={id}>{group.subject}</h2>
              <ul className="gw-list">
                {group.entries.map((entry) => (
                  <li key={entry.slug}>
                    <SiteLink href={entry.path}>
                      <b>{entry.name}</b>
                      <span>{entry.boards}</span>
                    </SiteLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {listed > pages.length ? (
          <p className="gw-checked">An idea set in two subjects is listed under both.</p>
        ) : null}
        <section className="st-section">
          <PitchAsk
            page="glossary"
            heading={index.askHeading}
            placeholder={index.askPlaceholder}
            chips={index.askChips}
          />
        </section>
      </div>
      <ClosePanel page="glossary" />
    </SiteShell>
  );
}
