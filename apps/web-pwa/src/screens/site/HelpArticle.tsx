'use client';

/**
 * /help/<group>/<slug> — one help article.
 *
 * The article obeys the shape `help-centre/README.md` sets: the first line is a complete answer on
 * its own, so it is set larger than the body and nothing sits above it but the breadcrumb. Under it
 * the body, then the article the copy itself points at next, resolved to a real address at build
 * time rather than being a sentence naming a page you then have to go and find.
 *
 * "Ask Wobo about this" is the entry the help centre is really for: the ask block under the
 * article hands Wobo the question and opens the conversation, or the door where signing in happens
 * for a visitor with no account (`AskWobo.tsx`).
 *
 * An address that names no article does not 404 into nothing: the help centre is one tap away and
 * the page says so.
 */

import { useSdk } from '../../store/sdk';
import { Label } from '../../ui/primitives';
import { AskWobo } from './AskWobo';
import { ClosePanel } from './ClosePanel';
import { Prose, Runs } from './Doc';
import { HELP } from './help-content';
import { SiteLink } from './nav';
import { Reveal } from './Reveal';
import { SiteShell } from './SiteShell';
import { findArticle } from './search';

export function HelpArticle({ group, slug }: { group: string; slug: string }) {
  const article = findArticle(HELP.groups, group, slug);
  const groupDoc = HELP.groups.find((g) => g.slug === group);
  const sdk = useSdk();

  if (!article || !groupDoc) {
    return (
      <SiteShell current="help" title={`${HELP.title} · Wobo`} label={HELP.title}>
        <section className="st-page-hero">
          <div className="st-wrap">
            <Label>{HELP.title}</Label>
            <h1>That page is not here</h1>
            <p className="st-sub">
              The address does not match an article we publish. Everything the help centre has is on
              one page.
            </p>
            <div className="st-row">
              <SiteLink className="st-btn st-pig" to={{ name: 'help' }}>
                Open the help centre
              </SiteLink>
            </div>
          </div>
        </section>
        <ClosePanel page="help" />
      </SiteShell>
    );
  }

  const signedIn = sdk.config.devAuth || sdk.identity.isAuthenticated();

  return (
    <SiteShell current="help" title={`${article.title} · Wobo`} label={article.title}>
      <div className="st-wrap hp-article">
        <article>
          <nav className="st-crumb" aria-label="Where this page sits">
            <SiteLink to={{ name: 'help' }}>{HELP.title}</SiteLink>
            <span aria-hidden>·</span>
            <b>{groupDoc.title}</b>
          </nav>
          <Reveal>
            <h1>{article.title}</h1>
            {article.lead.length > 0 ? (
              <p className="hp-lead">
                <Runs runs={article.lead} />
              </p>
            ) : null}
            <Prose blocks={article.blocks} />
            {article.next ? (
              <div className="hp-next">
                <Label>Next</Label>
                <SiteLink
                  to={{
                    name: 'helpArticle',
                    group: article.next.group,
                    slug: article.next.slug,
                  }}
                >
                  {article.next.title}
                </SiteLink>
              </div>
            ) : null}
          </Reveal>
          <Reveal>
            <AskWobo
              label="Ask Wobo about this"
              heading={
                signedIn
                  ? 'Wobo answers from these pages, and can show you on your own account.'
                  : 'Wobo answers from these pages. Sign in and ask on your own account.'
              }
              placeholder={article.title}
            />
          </Reveal>
        </article>

        <aside className="hp-aside" aria-label={`More in ${groupDoc.title.toLowerCase()}`}>
          <h2>More in {groupDoc.title.toLowerCase()}</h2>
          <div className="hp-list">
            {groupDoc.articles.map((other) => (
              <SiteLink
                key={other.slug}
                to={{ name: 'helpArticle', group: groupDoc.slug, slug: other.slug }}
                current={other.slug === article.slug}
              >
                {other.title}
              </SiteLink>
            ))}
          </div>
        </aside>
      </div>
      <ClosePanel page="help" />
    </SiteShell>
  );
}
