'use client';

/**
 * The ink close panel every site page ends on: a headline, a line in Wobo's hand in marigold, the
 * marigold door and the quiet one.
 *
 * IT NAMES ITSELF, IT DOES NOT WRITE ITSELF. A page passes `page="parents"` and nothing else; the
 * headline, the handwritten line and both actions come from `handoffs.ts`. That is the whole point
 * of the rewrite: when every page could pass its own `primary`, fourteen of them ended on the same
 * template while the plans page quietly said something different, and the words drifted apart
 * exactly where a visitor would notice. Now a page cannot type a door.
 *
 * The primary is loud and the second is quiet, always in that order and never at equal weight
 * (docs/SELL.md §6).
 */

import type { ReactNode } from 'react';
import { useDoorsOpen } from './dial';
import { type CtaAction, handoff, type PublicPage } from './handoffs';
import { hrefRoute, SiteLink } from './nav';

export type { CtaAction };

function Action({ action, className }: { action: CtaAction; className: string }) {
  return (
    <SiteLink className={className} {...(action.to ? { to: action.to } : { href: action.href })}>
      {action.label}
    </SiteLink>
  );
}

export function ClosePanel({
  page,
  title,
  children,
}: {
  /** Which page is closing. Everything the panel says is read from that. */
  page: PublicPage;
  /** A page whose close headline is built from its own data (gift, donate) may pass one. */
  title?: string;
  /** A short honest note under the doors, where a page has one. */
  children?: ReactNode;
}) {
  // The door in the close follows the dial; the quiet second is the page's own argument and does
  // not move (docs/DOORS-CLOSED.md §5).
  const close = handoff(page, useDoorsOpen());
  return (
    <div className="st-close">
      <div className="st-wrap">
        <h2>{title ?? close.title}</h2>
        {close.hand ? <span className="hand">{close.hand}</span> : null}
        <div className="st-row">
          <Action action={close.primary} className="st-btn" />
          <Action action={close.quiet} className="st-btn st-q" />
        </div>
        {children ? <div className="st-fine">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * Every address either action in the table points at, for the walk that proves no page dead-ends.
 * An in-page anchor is left out: it is this page, not a way off it.
 */
export function closeDestinations(page: PublicPage, open = true): string[] {
  const close = handoff(page, open);
  return [close.primary, close.quiet]
    .map((action) => (action.to ? action.to.name : (action.href ?? '')))
    .filter((address) => address !== '' && !address.startsWith('#'));
}

/** True where a path in the table is one the router actually answers. */
export function resolves(href: string): boolean {
  return href.startsWith('#') || hrefRoute(href) !== null;
}
