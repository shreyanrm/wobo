'use client';

/**
 * The ink close panel every site page ends on: a headline, a line in Wobo's hand in marigold, the
 * marigold door and the quiet one.
 *
 * Law v5's copy law (DESIGN.md §0) sets what it says: PROMOTE BEFORE YOU INVITE. Until the product
 * opens, no surface may close on "begin tonight" — the product is not open, so the closing call is
 * early access, in landing-v8.html's own words. A page that closes differently (plans, security,
 * subjects) passes its own title; every one of them still asks for early access.
 */

import type { ReactNode } from 'react';
import type { Route } from '../../shell/router';
import { SiteLink } from './nav';

export interface CloseAction {
  label: string;
  /** A route or a path — the action is a real link. Give `onClick` instead for an action. */
  to?: Route;
  href?: string;
  onClick?: () => void;
}

/** The shared close, word for word from the prototypes. */
export const CLOSE = {
  title: 'Wobo opens to families this term.',
  hand: 'Free to use every day, not just the first.',
  primary: { label: 'Get early access', to: { name: 'onboarding' } as Route },
  quiet: { label: "I'm a parent", href: '/for-parents' },
} as const;

function Action({ action, className }: { action: CloseAction; className: string }) {
  if (action.to || action.href) {
    return (
      <SiteLink
        className={className}
        {...(action.to ? { to: action.to } : { href: action.href ?? '/' })}
      >
        {action.label}
      </SiteLink>
    );
  }
  return (
    <button type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

export function ClosePanel({
  title = CLOSE.title,
  hand = CLOSE.hand,
  primary = CLOSE.primary,
  quiet = CLOSE.quiet,
  children,
}: {
  title?: string;
  /** The line in Wobo's hand. Pass null for a close with no handwritten line. */
  hand?: string | null;
  primary?: CloseAction;
  quiet?: CloseAction | null;
  /** A short honest note under the doors, where a page has one. */
  children?: ReactNode;
}) {
  return (
    <div className="st-close">
      <div className="st-wrap">
        <h2>{title}</h2>
        {hand ? <span className="hand">{hand}</span> : null}
        <div className="st-row">
          <Action action={primary} className="st-btn" />
          {quiet ? <Action action={quiet} className="st-btn st-q" /> : null}
        </div>
        {children ? <div className="st-fine">{children}</div> : null}
      </div>
    </div>
  );
}
