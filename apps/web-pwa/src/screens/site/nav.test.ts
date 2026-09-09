/**
 * The shell's words are the prototypes' words: the pill nav, the footer's four columns and its
 * line, read out of design/prototypes/site-about.html and held here, so a label cannot drift from
 * what the owner signed off.
 *
 * TWO of the shell's labels are held to LAW v5 instead (DESIGN.md §0), because the law outranks
 * the prototype and the prototype is still catching up to it: the loud door and the close panel.
 * The prototype says "Get started" in the header and "Begin tonight." in the close. The law says
 * the door is "Start free" everywhere and it is read from `cta.ts`, and it says no surface may say
 * "tonight". The prototype's own words for those two are deliberately NOT asserted.
 *
 * The close panel is no longer one shared block of words either: every page closes on its own job
 * (`site/handoffs.ts`), so what is asserted here is the SHAPE the prototype closes in and the front
 * page's own entry in that table.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CTA } from './cta';
import { handoff } from './handoffs';
import { DOORS, FOOTER_COLUMNS, FOOTER_LINE, hrefRoute, NAV_LINKS } from './nav';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const HTML = readFileSync(join(REPO, 'design', 'prototypes', 'site-about.html'), 'utf8');

const text = (s: string): string => s.replace(/<[^>]+>/g, '').trim();
const anchors = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => text(m[1] as string));

describe('the shell says what the prototype says', () => {
  /**
   * The pill nav carries the prototype's SIX PAGES, and it carries them in the FUNNEL'S order, not
   * the prototype's (docs/SELL.md §3, and the note above `NAV_LINKS`). The doubts arrive in a fixed
   * sequence and "will it work for MY board" arrives second, so Subjects moved from fifth to
   * second. The set is asserted against the prototype; the order is asserted in `handoffs.test.ts`,
   * where the reason for it lives.
   */
  it('carries the six pill-nav pages the prototype names', () => {
    const nav = /<header>[\s\S]*?<nav>([\s\S]*?)<\/nav>/.exec(HTML)?.[1] ?? '';
    expect([...NAV_LINKS.map((l) => l.label)].sort()).toEqual([...anchors(nav)].sort());
  });

  it("keeps the quiet door the prototype names, and makes the loud one law v5's ask", () => {
    const cta = /<div class="cta">([\s\S]*?)<\/div>/.exec(HTML)?.[1] ?? '';
    const doors = anchors(cta);
    expect(doors).toHaveLength(2);
    expect(doors[0]).toBe(DOORS.signIn);
    // law v5: we are open, and the loud door says so in the one phrase every surface reads
    expect(DOORS.getStarted).toBe(CTA.label);
    expect(CTA.label).toBe('Start free');
  });

  it('carries the footer, column for column', () => {
    const footer = /<footer>[\s\S]*?<\/footer>/.exec(HTML)?.[0] ?? '';
    const columns = [...footer.matchAll(/<div><b>([^<]*)<\/b>([\s\S]*?)<\/div>/g)].map((m) => ({
      title: m[1] as string,
      links: anchors(m[2] as string),
    }));
    expect(FOOTER_COLUMNS.map((c) => c.title)).toEqual(columns.map((c) => c.title));
    // every link the prototype's footer names is in ours, in its order; ours may carry one the
    // prototype has not caught up to (the router knows about a page before the mock-up does)
    for (const [i, column] of columns.entries()) {
      const ours = FOOTER_COLUMNS[i]?.links.map((l) => l.label) ?? [];
      expect([column.title, column.links.filter((l) => !ours.includes(l))]).toEqual([
        column.title,
        [],
      ]);
    }
    expect(footer).toContain(FOOTER_LINE);
  });

  it('gives every link a distinct address, and every address a leading slash', () => {
    const hrefs = [...NAV_LINKS, ...FOOTER_COLUMNS.flatMap((c) => c.links)].map((l) => l.href);
    for (const href of hrefs) expect(href.startsWith('/')).toBe(true);
    const footerHrefs = FOOTER_COLUMNS.flatMap((c) => c.links).map((l) => l.href);
    expect(new Set(footerHrefs).size).toBe(footerHrefs.length);
  });

  /**
   * A DEAD CONTROL IN THE FOOTER OF EVERY PUBLIC PAGE. "Questions" pointed at `/#questions`, and
   * the `#questions` section does not live on the landing page at all: it is the parents page's
   * (`pitch/ForParents.tsx`). `SiteLink` stripped the hash, `/` resolved to the landing route, and
   * the reader was deposited at the top of the front page at `/landing`, the address the page's
   * own canonical disowns (wave 29, site-1). So every address here is walked through the router
   * AND every hash it carries must be an id on the source of the page it names.
   */
  it('sends every address to a route the router answers, and every anchor to an id on that page', () => {
    const REPO_SRC = join(import.meta.dir, '..');
    const PAGE_SOURCE: Record<string, string> = {
      'for-parents': join('pitch', 'ForParents.tsx'),
      'for-students': join('pitch', 'ForStudents.tsx'),
      'meet-wobo': join('pitch', 'MeetWobo.tsx'),
      'how-it-works': join('pitch', 'HowItWorks.tsx'),
      subjects: join('pitch', 'Subjects.tsx'),
      security: join('pitch', 'Security.tsx'),
      about: join('site', 'About.tsx'),
    };
    for (const link of [...NAV_LINKS, ...FOOTER_COLUMNS.flatMap((c) => c.links)]) {
      const route = hrefRoute(link.href);
      expect([link.label, link.href, route?.name ?? null]).not.toEqual([
        link.label,
        link.href,
        null,
      ]);
      const hash = link.href.split('#')[1];
      if (!hash || !route) continue;
      const file = PAGE_SOURCE[route.name];
      expect([link.href, file]).not.toEqual([link.href, undefined]);
      const source = readFileSync(join(REPO_SRC, file as string), 'utf8');
      expect([link.href, source.includes(`id="${hash}"`)]).toEqual([link.href, true]);
    }
  });

  it('points "Questions" at the page that carries the questions', () => {
    const questions = FOOTER_COLUMNS.flatMap((c) => c.links).find((l) => l.label === 'Questions');
    expect(questions?.href).toBe('/for-parents#questions');
  });

  it('closes in the shape the prototype closes in, on the words law v5 allows', () => {
    const close = /<div class="close">([\s\S]*?)<\/div><\/div>/.exec(HTML)?.[1] ?? '';
    // the SHAPE is the prototype's: a headline, a line in Wobo's hand, a loud door and a quiet one
    expect(close).toMatch(/<h2>.+<\/h2>/);
    expect(close).toMatch(/<span class="hand">.+<\/span>/);
    const doors = anchors(close);
    expect(doors).toHaveLength(2);
    // the WORDS are the law's, and each page's are its own: the front page's close invites, and
    // neither of its two doors asks anybody to wait for a product that is already open
    const home = handoff('home', true);
    expect(home.primary.label).toBe(CTA.label);
    expect(`${home.title} ${home.hand ?? ''} ${home.quiet.label}`).not.toMatch(
      /early access|waitlist|tonight/i,
    );
  });
});
