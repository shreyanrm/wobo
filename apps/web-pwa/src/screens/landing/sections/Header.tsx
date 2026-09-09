'use client';

/**
 * The header: the wordmark, five real routes, the quiet sign-in, and the one call to action.
 *
 * Sticky, not fixed. The prototype's header is `position: sticky` and that is the right call inside
 * an app: a fixed header would resolve its offsets against whichever ancestor carries a transform
 * hint, which is why the previous build had to portal its header into `<body>`. Sticky needs no
 * containing block and no portal — the page root uses `overflow-x: clip` rather than `hidden` so it
 * never becomes a scroll container and kills it.
 *
 * Every address in the nav is a page that exists. Nothing here is a dead anchor.
 */

import { routeToPath } from '../../../shell/router';
import { SIGN_IN, useCta } from '../../site/cta';
import { Wordmark } from '../art';
import { LandingLink } from '../link';
import { NAV_LINKS } from '../page-copy';

export function Header() {
  // The loud door follows the dial; the quiet one never moves (docs/DOORS-CLOSED.md §2).
  const door = useCta();
  return (
    <header>
      <div className="wrap bar">
        <a className="wm" href="#hero" aria-label="Wobo">
          <Wordmark />
        </a>
        <nav aria-label="Site">
          {NAV_LINKS.map((link) => (
            <LandingLink key={link.href} href={link.href}>
              {link.label}
            </LandingLink>
          ))}
        </nav>
        <div className="right">
          <LandingLink className="sign" href="/sign-in">
            {SIGN_IN}
          </LandingLink>
          <LandingLink className="btn pig" href={routeToPath(door.to)}>
            <span>{door.label}</span>
          </LandingLink>
        </div>
      </div>
    </header>
  );
}
