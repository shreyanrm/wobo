'use client';

/**
 * A link on the landing page.
 *
 * The page carries two kinds, and they must not be confused:
 *
 *  · an ANCHOR (`#why`, `#parents-note`) scrolls this page. It stays a plain `<a>` so the browser's
 *    own smooth scrolling, the middle-click, and the address bar all behave normally.
 *  · an ADDRESS (`/plans`, `/legal/terms`) is another screen. It renders a real `href` — so it can
 *    be opened in a new tab, copied, and crawled — and a plain click is intercepted and handed to
 *    the app's router, which is what makes it a single-page navigation rather than a full reload.
 *
 * A modified click (new tab, new window, download, a different target) is left to the browser, the
 * same rule `screens/site/nav.tsx` uses for the public site.
 */

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { pathToRoute, useRouter } from '../../shell/router';

/** True when the browser, not the router, should handle this click. */
export function browserOwnsClick(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** Whether an href is an in-page anchor rather than another screen. */
export function isAnchor(href: string): boolean {
  return href.startsWith('#');
}

export function LandingLink({
  href,
  children,
  className,
  style,
  ...rest
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** Carries the stagger index (`--i`) the scroll engine reads off a row of tiles. */
  style?: CSSProperties;
  'aria-label'?: string;
}) {
  const router = useRouter();
  if (isAnchor(href)) {
    return (
      <a href={href} className={className} style={style} {...rest}>
        {children}
      </a>
    );
  }
  const route = pathToRoute(href);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || browserOwnsClick(event) || !route) return;
    event.preventDefault();
    router.navigate(route);
  };
  return (
    <a href={href} className={className} style={style} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
