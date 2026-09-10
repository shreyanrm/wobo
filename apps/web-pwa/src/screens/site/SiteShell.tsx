'use client';

/**
 * THE shell every public page wears: the sticky blurred header with the wordmark, the pill nav
 * and the two doors; the page; the ink footer with its four columns. It is the shell of every site
 * prototype (design/prototypes/site-*.html), and every site page — /about, /help and every
 * article, /plans and its checkout, /gift, /contact, the legal set, /sitemap and the two doors —
 * is built inside it, so any page reaches any other.
 *
 * The two doors are pages of their own and wear a slimmer version: no pill nav, and the one quiet
 * button that is the other door (`door`). The footer stays; a person on a sign-up page is entitled
 * to the terms and the privacy policy from where they stand.
 *
 * No cursor is drawn here: the site prototypes use the native pointer, and inside the app the
 * cursor is native because learners are working (DESIGN.md §2).
 */

import { type ReactNode, useEffect } from 'react';
import type { Route } from '../../shell/router';
import { Wordmark } from '../../ui/primitives';
import { useDoorsOpen } from './dial';
import {
  FOOTER_COLUMNS,
  FOOTER_LINE,
  FOOTER_SOCIALS,
  headerDoors,
  NAV_LINKS,
  SiteLink,
  type SiteSection,
} from './nav';
import { ensureSiteStyles } from './styles';

// The chunk arriving IS the page being opened, so the stylesheet goes in at import time — an
// effect would let the first paint land unstyled for a frame.
ensureSiteStyles();

export type { SiteSection };

/** Set the tab's title while a public page is open, and put it back on the way out. */
function useTitle(title: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function SiteShell({
  children,
  current,
  title,
  label,
  door,
}: {
  children: ReactNode;
  /** Which page is being read, for `aria-current` in the nav and the footer. */
  current?: SiteSection;
  /** The tab's title. */
  title: string;
  /** The accessible name of the page's main region. Defaults to the title. */
  label?: string;
  /** A door's header: no pill nav, one quiet button leading to the other door. */
  door?: { label: string; to: Route };
}) {
  useTitle(title);

  // The two doors follow the dial: while new accounts are closed the loud one is the invitation
  // to the list, and the quiet one is untouched (docs/DOORS-CLOSED.md §2).
  const doors = headerDoors(useDoorsOpen());

  // A fresh document starts at its top. Without this, arriving from halfway down one page leaves
  // the reader halfway down the page they just opened.
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="st">
      <a className="st-skip" href="#site-main">
        Skip to the page
      </a>
      <header className="st-header st-print-hide">
        <div className="st-wrap">
          <SiteLink to={{ name: 'landing' }} className="st-wm" aria-label="Wobo, the front page">
            <Wordmark />
          </SiteLink>
          {door ? (
            <div className="st-cta st-door">
              <SiteLink to={door.to} className="st-btn st-quiet">
                {door.label}
              </SiteLink>
            </div>
          ) : (
            <>
              <nav aria-label="Wobo's public pages">
                {NAV_LINKS.map((link) => (
                  <SiteLink
                    key={link.href}
                    href={link.href}
                    current={current === link.section}
                    {...(current === link.section ? { className: 'st-on' } : {})}
                  >
                    {link.label}
                  </SiteLink>
                ))}
              </nav>
              <div className="st-cta">
                <SiteLink to={doors.signIn.to} className="st-btn st-quiet">
                  {doors.signIn.label}
                </SiteLink>
                <SiteLink to={doors.getStarted.to} className="st-btn st-pig">
                  {doors.getStarted.label}
                </SiteLink>
              </div>
            </>
          )}
        </div>
      </header>
      <main id="site-main" aria-label={label ?? title}>
        {children}
      </main>
      <footer className="st-footer st-print-hide">
        <div className="st-wrap">
          <div>
            <div className="st-wm">
              <SiteLink to={{ name: 'landing' }} aria-label="Wobo, the front page">
                <Wordmark />
              </SiteLink>
            </div>
            <p className="st-line">{FOOTER_LINE}</p>
            {/*
              The same listings the entity graph names, read from `shell/profiles.ts` rather than
              typed again, so the footer and the markup can never say two different things about
              where Wobo is. Nothing unclaimed appears (docs/GROWTH-ENTITY.md).
            */}
            {FOOTER_SOCIALS.length > 0 ? (
              <p className="st-social">
                {FOOTER_SOCIALS.map((social) => (
                  <a
                    key={social.href}
                    href={social.href}
                    rel="me noopener"
                    target="_blank"
                    aria-label={`Wobo on ${social.label}`}
                  >
                    {social.label}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <b>{column.title}</b>
              {column.links.map((link) => (
                <SiteLink key={link.href} href={link.href} current={current === link.section}>
                  {link.label}
                </SiteLink>
              ))}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
