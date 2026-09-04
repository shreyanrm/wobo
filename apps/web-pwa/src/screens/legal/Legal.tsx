'use client';

/**
 * The legal set on the web: an index at `/legal`, one page per document at `/legal/<slug>`, and a
 * contact page at `/legal/contact`.
 *
 * The pages render `docs/legal/**` and nothing else. Three things they add, and why each is
 * honest rather than decorative:
 *
 *  · a draft notice. `docs/legal/README.md` says plainly that none of these documents has been read
 *    by a lawyer and that nothing should be published until the review checklist is done. A site
 *    that showed them as settled terms would be the first lie in the product, so the state is
 *    stated at the top of every page, with the number of questions still open for counsel.
 *  · a table of contents. These are long documents and a reader usually arrives looking for one
 *    section — refunds, what happens to a child's data, how to cancel.
 *  · print rules. A parent who wants to keep the terms should get a clean page, not a screenshot of
 *    a navigation bar (`site/styles.ts`).
 *
 * The "in plain words" card every document opens with is lifted above the body, in the
 * highlighter and Wobo's hand, because it is the honest summary a reader should be able to stop at.
 */

import { useEffect } from 'react';
import { useRouter } from '../../shell/router';
import { Label, Pill, Tag } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink, type SiteSection } from '../site/nav';
import { Reveal } from '../site/Reveal';
import { SiteShell } from '../site/SiteShell';
import { canonicalSlug, legalPath, spansText } from './catalog';
import { documentSlugs, legalDocument, legalIndex, setDrafted } from './docs';
import { documentBody } from './markdown';
import { Markdown, PlainWords } from './Prose';

/** The one line that says what these pages are. */
const INTRO =
  'Everything Wobo has to tell a learner and a parent: how the product works, what it does with their information, what it costs, and what it will not do.';

/** The footer names five of the documents by their own link; the rest read as the legal set. */
const SECTIONS: Readonly<Record<string, SiteSection>> = {
  'terms-of-service': 'terms',
  'privacy-policy': 'privacy',
  'childrens-privacy': 'children',
  cookies: 'cookies',
  'accessibility-statement': 'accessibility',
};

/** Stated on every page, because it is true of every document here. */
function DraftNotice({ drafted, reviews }: { drafted: string | null; reviews?: number }) {
  return (
    <aside className="st-note" aria-label="The state of these documents">
      <Tag>Draft</Tag>
      <p>
        {drafted ? `Drafted ${drafted}. ` : ''}Written by the Wobo team and not yet reviewed by a
        lawyer.
        {typeof reviews === 'number' && reviews > 0
          ? ` ${reviews} question${reviews === 1 ? '' : 's'} in this document are still open for counsel, and they are not shown here.`
          : ' Nothing on this page can be relied on as final until that review is done.'}
      </p>
    </aside>
  );
}

/** `/legal` — the ten documents, described in the README's own words. */
function Index() {
  const rows = legalIndex();
  return (
    <>
      <section className="st-page-hero">
        <div className="st-wrap">
          <Label>Legal</Label>
          <h1>The legal set.</h1>
          <p className="st-sub">{INTRO}</p>
          <div style={{ marginTop: 'var(--s3)', maxWidth: 640 }}>
            <DraftNotice drafted={setDrafted()} />
          </div>
        </div>
      </section>
      <section className="st-section" style={{ paddingTop: 0 }}>
        <div className="st-wrap">
          <Reveal className="lg-rows">
            {rows.map((row) => {
              const doc = legalDocument(row.slug);
              return (
                <SiteLink key={row.slug} href={legalPath(row.slug)} className="lg-row">
                  <p className="lg-row-title">{doc?.shape.title ?? row.slug}</p>
                  <p className="lg-row-what">{spansText(row.what)}</p>
                  <p className="lg-row-who">{spansText(row.who)}</p>
                </SiteLink>
              );
            })}
            <SiteLink to={{ name: 'contact' }} className="lg-row">
              <p className="lg-row-title">How to reach us</p>
              <p className="lg-row-what">
                Every mailbox these documents name, and a message straight to a person.
              </p>
              <p className="lg-row-who">anyone with a question</p>
            </SiteLink>
          </Reveal>
        </div>
      </section>
    </>
  );
}

/** `/legal/<slug>` — one document, with its contents beside it. */
function Document({ slug }: { slug: string }) {
  const doc = legalDocument(slug);
  const known = documentSlugs();
  if (!doc) return <NotFound slug={slug} />;
  const { shape } = doc;
  return (
    <>
      <section className="st-page-hero">
        <div className="st-wrap">
          <nav className="st-crumb" aria-label="Where this page sits">
            <SiteLink to={{ name: 'legal' }}>Legal</SiteLink>
            <span aria-hidden>/</span>
            <b>{shape.title ?? slug}</b>
          </nav>
          <h1>{shape.title ?? slug}</h1>
          <div className="lg-meta">
            {shape.drafted ? <Pill>Drafted {shape.drafted}</Pill> : null}
            {shape.version ? <Pill>Version {shape.version}</Pill> : null}
            <Pill>
              {doc.reviews} question{doc.reviews === 1 ? '' : 's'} open for counsel
            </Pill>
          </div>
        </div>
      </section>
      <div className="st-wrap lg-doc">
        <nav className="lg-toc st-print-hide" aria-label="Sections of this document">
          <Label>Contents</Label>
          <ol>
            {shape.contents.map((heading) => (
              <li key={heading.id}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article>
          <div style={{ marginBottom: 'var(--s3)' }}>
            <DraftNotice drafted={shape.drafted} reviews={doc.reviews} />
          </div>
          {shape.plainWords ? <PlainWords paragraphs={shape.plainWords} known={known} /> : null}
          <div className="st-prose">
            <Markdown blocks={documentBody(doc.blocks)} known={known} />
          </div>
        </article>
      </div>
    </>
  );
}

/**
 * `/legal/contact` is an ALIAS of `/contact`, not a second contact page.
 *
 * The address is kept because it is published in the documents themselves; it replaces itself with
 * the real page, so nothing that already links here breaks and the back button does not bounce.
 */
function ContactAlias() {
  const router = useRouter();
  useEffect(() => {
    router.replace({ name: 'contact' });
  }, [router]);
  return (
    <section className="st-page-hero">
      <div className="st-wrap">
        <h1>How to reach us.</h1>
        <p className="st-sub">
          Taking you to the contact page, where every mailbox is listed and you can write to one.
        </p>
        <div className="st-row">
          <SiteLink to={{ name: 'contact' }} className="st-btn st-pig">
            Open the contact page
          </SiteLink>
        </div>
      </div>
    </section>
  );
}

/** An address that is not one of ours: say so, and offer the way back. */
function NotFound({ slug }: { slug: string }) {
  return (
    <section className="st-page-hero">
      <div className="st-wrap">
        <h1>There is no document at that address.</h1>
        <p className="st-sub">
          Nothing in the legal set is called <code>{slug}</code>. The ten documents are listed on
          the index.
        </p>
        <div className="st-row">
          <SiteLink to={{ name: 'legal' }} className="st-btn st-pig">
            The legal set
          </SiteLink>
        </div>
      </div>
    </section>
  );
}

/** The screen. No slug is the index; `contact` is the contact page; anything else is a document. */
export function Legal({ slug }: { slug?: string }) {
  const canonical = slug ? canonicalSlug(slug) : '';
  const title = canonical
    ? `${legalDocument(canonical)?.shape.title ?? 'Legal'} · Wobo`
    : 'The legal set · Wobo';
  return (
    <SiteShell current={SECTIONS[canonical] ?? 'legal'} title={title}>
      {!canonical ? (
        <Index />
      ) : canonical === 'contact' ? (
        <ContactAlias />
      ) : (
        <Document slug={canonical} />
      )}
      <ClosePanel page="legal" />
    </SiteShell>
  );
}
