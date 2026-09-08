'use client';

/**
 * /help — the help centre index.
 *
 * Three groups, every article listed, and one search field. The whole help centre is thirty-three
 * short articles and they all arrive in this chunk, so search is a scan over strings already in
 * memory (`search.ts`) — no index, no request, and a result on the keystroke.
 *
 * The list is never hidden behind the search. Someone who does not know what to type sees every
 * article there is, grouped the way `help-centre/README.md` groups them, one tile per group in its
 * own wash; someone who does know types two words and the tiles give way to the answers. Nothing
 * collapses, nothing paginates.
 *
 * Every word — the groups' names, their one-line descriptions, every article title — is the
 * reviewed copy, compiled at build time. The only strings written here are the ones the copy has no
 * equivalent for: the search field's label and the line that says how many articles matched.
 */

import { useMemo, useState } from 'react';
import { Button, Label, Tag } from '../../ui/primitives';
import { ClosePanel } from './ClosePanel';
import { HELP } from './help-content';
import { GroupMark } from './marks';
import { SiteLink } from './nav';
import { Reveal } from './Reveal';
import { SiteShell } from './SiteShell';
import { searchArticles } from './search';

const TINTS = ['st-pig', 'st-mint', 'st-marigold'] as const;

export function Help() {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchArticles(HELP.groups, query), [query]);
  const searching = query.trim().length > 0;
  const total = HELP.groups.reduce((n, group) => n + group.articles.length, 0);

  return (
    <SiteShell current="help" title={`${HELP.title} · Wobo`} label={HELP.title}>
      <section className="st-page-hero">
        <div className="st-wrap">
          <Label>Help</Label>
          <h1>{HELP.title}</h1>
          <div className="hp-search">
            <input
              id="help-search"
              type="search"
              autoComplete="off"
              aria-label="Search"
              placeholder="What do you want to do"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {searching ? (
              <Button tone="quiet" size="sm" onClick={() => setQuery('')}>
                Clear
              </Button>
            ) : null}
          </div>
          {/* A live region, so a keyboard or screen-reader visitor hears the count change instead
              of typing into a field that appears to do nothing. */}
          <p className="hp-count" role="status">
            {searching
              ? `${results.length} of ${total} articles`
              : `${total} articles, in three groups`}
          </p>
        </div>
      </section>

      {searching ? (
        <section className="st-section" aria-label="Search results">
          <div className="st-wrap">
            {results.length === 0 ? (
              <p className="hp-empty">
                Nothing here matches that. Try one word instead of a sentence, or ask Wobo
                directly: Wobo answers from these same pages.
              </p>
            ) : (
              <div className="hp-results">
                {results.map((hit) => (
                  <SiteLink
                    key={`${hit.group}/${hit.slug}`}
                    className="hp-result"
                    to={{ name: 'helpArticle', group: hit.group, slug: hit.slug }}
                  >
                    <Tag>{hit.groupTitle}</Tag>
                    <b>{hit.title}</b>
                    <span>{hit.snippet}</span>
                  </SiteLink>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="st-section" aria-label="Every help article">
          <div className="st-wrap">
            <Reveal className="hp-groups">
              {HELP.groups.map((group, i) => (
                <div className={`hp-group ${TINTS[i % TINTS.length]}`} key={group.slug}>
                  <GroupMark group={group.slug} />
                  <h2>{group.title}</h2>
                  <p>{group.blurb}</p>
                  <div className="hp-list">
                    {group.articles.map((article) => (
                      <SiteLink
                        key={article.slug}
                        to={{ name: 'helpArticle', group: group.slug, slug: article.slug }}
                      >
                        {article.title}
                      </SiteLink>
                    ))}
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
        </section>
      )}

      <ClosePanel page="help" />
    </SiteShell>
  );
}
