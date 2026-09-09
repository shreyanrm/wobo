'use client';

/**
 * `/compare` and `/compare/<slug>` — side by side, sourced and dated.
 *
 * THE SHAPE IS THE ARGUMENT. Not a feature grid with ticks and crosses, which is a verdict wearing
 * a table's clothes: a tick means "this is the good one" and nothing else. One question per block,
 * two columns of prose inside it, each with the page it was read off and the day it was read. A
 * reader can disagree with a cell by clicking it, which is the only kind of comparison worth
 * publishing.
 *
 * The two columns are the same weight, the same type and the same colour. Ours is on the left
 * because a reader is on our site, not because it wins.
 *
 * Every sentence comes from `compare.ts`, which is where the law lives and where the test looks.
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
import type { CompareCell, ComparePage, Fact } from './comparisons';
import { compareIndex, comparePage, comparisonBySlug } from './comparisons';
import { ensureGrowthStyles } from './styles';

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

/** One side of one question. A quotation is marked as one so a reader can see whose words these are. */
function Column({ name, fact }: { name: string; fact: Fact }) {
  return (
    <div className="gw-col">
      <b>{name}</b>
      <p>{fact.quoted ? <q>{fact.value}</q> : fact.value}</p>
      <span className="gw-src">
        <a href={fact.source.url} rel="nofollow noopener" target="_blank">
          {fact.source.title}
        </a>
      </span>
    </div>
  );
}

function Row({ cell, otherName }: { cell: CompareCell; otherName: string }) {
  return (
    <li className="gw-fact">
      <h3>{cell.label}</h3>
      <div className="gw-cols">
        <Column name="Wobo" fact={cell.ours} />
        <Column name={otherName} fact={cell.theirs} />
      </div>
    </li>
  );
}

export function CompareEntry({ slug }: { slug: string }) {
  const comparison = comparisonBySlug(slug);
  if (!comparison) return <Missing />;
  const page = comparePage(comparison);
  if (!page.verdict.publishable) return <Missing />;
  return <Entry page={page} />;
}

function Entry({ page }: { page: ComparePage }) {
  return (
    <SiteShell title={page.title} label={page.heading}>
      <div className="st-wrap">
        <nav className="st-crumb" aria-label="Where this sits">
          <SiteLink href="/compare">Side by side</SiteLink>
          <b>/</b>
          <b>{page.otherName}</b>
        </nav>
        <header className="gw-head">
          <Label>Side by side</Label>
          <h1>{page.heading}</h1>
        </header>
        <p className="gw-lead">{page.lead}</p>
        <p className="gw-standing">{page.standing}</p>

        <ul className="gw-facts">
          {page.cells.map((cell) => (
            <Row key={cell.label} cell={cell} otherName={page.otherName} />
          ))}
        </ul>

        <section className="st-section" aria-labelledby="gw-sources">
          <div className="st-head">
            <h2 id="gw-sources">{page.sourcesHeading}</h2>
          </div>
          <ul className="gw-docs">
            {page.sources.map((source) => (
              <li key={source.url}>
                <a className="gw-doc" href={source.url} rel="nofollow noopener" target="_blank">
                  {source.title}
                </a>
                <span className="gw-src">
                  <span>{source.read}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="st-section" aria-labelledby="gw-decide">
          <div className="st-head">
            <h2 id="gw-decide">{page.closingHeading}</h2>
          </div>
          <ul className="gw-limits">
            {page.closing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="st-section">
          <PitchAsk
            page="compare"
            heading={page.askHeading}
            placeholder={page.askPlaceholder}
            chips={page.askChips}
          />
        </section>
      </div>
      <ClosePanel page="compare" />
    </SiteShell>
  );
}

export function Compare() {
  const index = compareIndex();
  if (!index.verdict.publishable) return <Missing />;
  return (
    <SiteShell title={index.title} label={index.heading}>
      <div className="st-wrap">
        <header className="gw-head">
          <Label>Side by side</Label>
          <h1>{index.heading}</h1>
        </header>
        <p className="gw-lead">{index.lead}</p>
        <p className="gw-standing">{index.standing}</p>
        <div className="st-grid2">
          {index.entries.map((entry) => (
            <SiteLink className="st-tile" key={entry.slug} href={entry.path}>
              <h3>Wobo and {entry.name}</h3>
              <p>{entry.line}</p>
            </SiteLink>
          ))}
        </div>
        <section className="st-section">
          <PitchAsk
            page="compare"
            heading={index.askHeading}
            placeholder={index.askPlaceholder}
            chips={index.askChips}
          />
        </section>
      </div>
      <ClosePanel page="compare" />
    </SiteShell>
  );
}
