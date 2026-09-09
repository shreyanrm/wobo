'use client';

/**
 * `/exams` and `/exams/<board>` — what the board published, and when we last read it.
 *
 * Like the glossary, the component renders `examCycle.ts`'s page object and writes nothing of its own,
 * so the words the gate counted are the words that ship. The one thing it adds is the shape: the
 * documents as a list rather than a table, because a document has a title, a publisher, an extent,
 * a date and a hash, and five columns on a phone is a page nobody reads.
 *
 * The "last checked" line sits at the foot of every board page, not the head. A page whose whole
 * claim is currency is tempting to open with a date badge, and a badge is what a content farm puts
 * on a page it did not check. The date belongs beside the evidence, in the same quiet type.
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
import type { BoardPage } from './examCycle';
import { boardById, boardPage, examsIndex } from './examCycle';
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

export function ExamBoard({ board }: { board: string }) {
  const found = boardById(board);
  if (!found) return <Missing />;
  const page = boardPage(found);
  if (!page.verdict.publishable) return <Missing />;
  return <BoardScreen page={page} />;
}

function BoardScreen({ page }: { page: BoardPage }) {
  return (
    <SiteShell title={page.title} label={page.heading}>
      <div className="st-wrap">
        <nav className="st-crumb" aria-label="Where this sits">
          <SiteLink href="/exams">The syllabus, from the board</SiteLink>
          <b>/</b>
          <b>{page.short}</b>
        </nav>
        <header className="gw-head">
          <Label>{page.name}</Label>
          <h1>{page.heading}</h1>
        </header>
        <p className="gw-lead">{page.lead}</p>
        <p className="gw-standing">{page.standing}</p>

        <section className="st-section" aria-labelledby="gw-docs">
          <div className="st-head">
            <h2 id="gw-docs">{page.documentsHeading}</h2>
            <p>{page.documentsLead}</p>
          </div>
          <ul className="gw-docs">
            {page.documents.map((doc) => (
              <li key={doc.id}>
                <a className="gw-doc" href={doc.url} rel="nofollow noopener" target="_blank">
                  {doc.title}
                </a>
                <span className="gw-src">
                  <span>
                    {doc.publisher}
                    {doc.extent ? `, ${doc.extent}` : ''}
                  </span>
                  <span>{doc.read}</span>
                  <span className="gw-hash">{doc.hash}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="st-section" aria-labelledby="gw-subjects">
          <div className="st-head">
            <h2 id="gw-subjects">{page.subjectsHeading}</h2>
            <p>{page.subjectsLead}</p>
          </div>
          <div className="st-scroll">
            <table className="st-grid">
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Subject</th>
                  <th scope="col">What we hold</th>
                  <th scope="col">How well we know it</th>
                </tr>
              </thead>
              <tbody>
                {page.subjects.map((row) => (
                  <tr key={row.key}>
                    <td>{row.level}</td>
                    <td>{row.subject}</td>
                    <td>{row.size}</td>
                    <td>
                      {row.label}
                      {row.open ? <span className="gw-src">{row.open}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {page.official.length > 0 ? (
          <section className="st-section" aria-labelledby="gw-official">
            <div className="st-head">
              <h2 id="gw-official">{page.officialHeading}</h2>
              <p>{page.officialLead}</p>
            </div>
            <ul className="gw-docs">
              {page.official.map((entry) => (
                <li key={entry.url}>
                  <a className="gw-doc" href={entry.url} rel="nofollow noopener" target="_blank">
                    {entry.title}
                  </a>
                  <span className="gw-src">
                    <span>{entry.holds}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="st-section" aria-labelledby="gw-limits">
          <div className="st-head">
            <h2 id="gw-limits">{page.limitsHeading}</h2>
          </div>
          <ul className="gw-limits">
            {page.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <p className="gw-checked">{page.checked}</p>
        </section>

        <section className="st-section">
          <PitchAsk
            page="exams"
            heading={page.askHeading}
            placeholder={page.askPlaceholder}
            chips={page.askChips}
          />
        </section>
      </div>
      <ClosePanel page="exams" />
    </SiteShell>
  );
}

export function Exams() {
  const index = examsIndex();
  if (!index.verdict.publishable) return <Missing />;
  return (
    <SiteShell title={index.title} label={index.heading}>
      <div className="st-wrap">
        <header className="gw-head">
          <Label>The boards we hold</Label>
          <h1>{index.heading}</h1>
        </header>
        <p className="gw-lead">{index.lead}</p>
        <p className="gw-standing">{index.standing}</p>
        <div className="st-grid2">
          {index.boards.map((board) => (
            <SiteLink className="st-tile" key={board.id} href={board.path}>
              <h3>{board.short}</h3>
              <p>{board.name}</p>
              <p>{board.line}</p>
            </SiteLink>
          ))}
        </div>
        <section className="st-section">
          <PitchAsk
            page="exams"
            heading={index.askHeading}
            placeholder={index.askPlaceholder}
            chips={index.askChips}
          />
        </section>
      </div>
      <ClosePanel page="exams" />
    </SiteShell>
  );
}
