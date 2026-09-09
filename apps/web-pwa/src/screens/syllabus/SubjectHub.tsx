'use client';

/**
 * `/subjects/<subject>` — one subject, board by board.
 *
 * It sits under the pitch page that already answers "do you cover mine", because a reader who
 * arrives having typed the subject and nothing else is asking that page's question with one more
 * word in it. What this page adds is the answer in full: every board whose chapter list we hold for
 * this subject, every class it is set in, and a way into each one.
 *
 * It claims nothing about the subject itself. The words are the board's names, the counts are
 * counted, and the sentence says out loud that the chapter list is the board's and not ours.
 */

import { lazy, Suspense } from 'react';
import { PitchAsk } from '../pitch/Ask';
import { ClosePanel } from '../site/ClosePanel';
import { syllabusClose } from '../site/handoffs';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { addressPath } from './address';
import { hubAsk, hubHeading, hubSummary, hubTail, hubTitle, linkNote } from './copy';
import { ensureSyllabusStyles } from './styles';
import { type Board, subjectHub } from './tree';

ensureSyllabusStyles();

const NotFoundScreen = lazy(() =>
  import('../states/StateHost').then((m) => ({ default: m.NotFoundScreen })),
);

export function SubjectHub({ subject }: { subject: string }) {
  const hub = subjectHub(subject);
  if (!hub) {
    return (
      <Suspense fallback={null}>
        <NotFoundScreen />
      </Suspense>
    );
  }
  const head = hubHeading(hub);
  const door = hubAsk(hub);
  // Grouped by board, in the order the tree holds them, so a reader finds their own board as a
  // heading rather than as one row among fifty.
  const byBoard = new Map<string, { board: Board; rows: typeof hub.places }>();
  for (const row of hub.places) {
    const found = byBoard.get(row.board.slug);
    if (found) (found.rows as (typeof hub.places)[number][]).push(row);
    else byBoard.set(row.board.slug, { board: row.board, rows: [row] });
  }
  return (
    <SiteShell current="subjects" title={hubTitle(hub)} label={head.name}>
      <div className="sy">
        <div className="st-wrap">
          <nav className="sy-crumbs" aria-label="Where this sits">
            <SiteLink href="/subjects">Subjects</SiteLink>
          </nav>
          <header className="sy-head">
            <h1>
              <span className="sy-name">{head.name}</span>{' '}
              <span className="sy-where">{head.where}</span>
            </h1>
          </header>
          {/* Outside the header, for the reason written on `Head` in Syllabus.tsx: the build reads
              a page's opening words off the render and skips a header, so a lead inside one gets
              the page described by whatever comes next. */}
          <p className="sy-lead">{hubSummary(hub)}</p>
          <div className="sy-hub">
            {[...byBoard.values()].map(({ board, rows }) => (
              <section key={board.slug}>
                <h2>
                  <SiteLink href={addressPath({ board: board.slug })}>{board.short}</SiteLink>
                </h2>
                <p>{board.label}</p>
                <div className="sy-links">
                  {rows.map((row) => {
                    const note = linkNote(row.subject);
                    return (
                      <SiteLink
                        key={`${board.slug}-${row.level.slug}`}
                        href={addressPath({
                          board: board.slug,
                          level: row.level.slug,
                          subject: row.subject.slug,
                        })}
                      >
                        {row.level.name}
                        {note ? `, ${note}` : ''}
                      </SiteLink>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <PitchAsk
            page="learn"
            heading={door.heading}
            placeholder={door.placeholder}
            chips={door.chips}
          />
          <nav className="sy-around" aria-label="The rest of the subjects">
            <SiteLink href="/subjects">
              <em>Up one</em>
              <b>Every subject Wobo teaches</b>
            </SiteLink>
          </nav>
          <p className="sy-none">{hubTail(hub)}</p>
        </div>
      </div>
      <ClosePanel page="syllabus" title={syllabusClose('hub')} />
    </SiteShell>
  );
}
