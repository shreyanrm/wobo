/**
 * The shell's words are the prototypes' words: the pill nav, the footer's four columns and its
 * line, read out of design/prototypes/site-about.html and held here, so a label cannot drift from
 * what the owner signed off.
 *
 * TWO of the shell's labels are held to LAW v5 instead (DESIGN.md §0), because the law outranks
 * the prototype and the prototype is still catching up to it: the loud door and the close panel.
 * "Get started" and "Begin tonight." both invite a reader into a product that has not opened —
 * promote before you invite — so the door asks for early access and the close is the promotion
 * landing-v8.html carries. The prototype's own words for those two are deliberately NOT asserted.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOSE } from './ClosePanel';
import { DOORS, FOOTER_COLUMNS, FOOTER_LINE, NAV_LINKS } from './nav';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const HTML = readFileSync(join(REPO, 'design', 'prototypes', 'site-about.html'), 'utf8');

const text = (s: string): string => s.replace(/<[^>]+>/g, '').trim();
const anchors = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => text(m[1] as string));

describe('the shell says what the prototype says', () => {
  it('lists the six pill-nav pages in order', () => {
    const nav = /<header>[\s\S]*?<nav>([\s\S]*?)<\/nav>/.exec(HTML)?.[1] ?? '';
    expect(NAV_LINKS.map((l) => l.label)).toEqual(anchors(nav));
  });

  it("keeps the quiet door the prototype names, and makes the loud one law v5's ask", () => {
    const cta = /<div class="cta">([\s\S]*?)<\/div>/.exec(HTML)?.[1] ?? '';
    const doors = anchors(cta);
    expect(doors).toHaveLength(2);
    expect(doors[0]).toBe(DOORS.signIn);
    expect(DOORS.getStarted).toBe('Get early access');
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

  it("closes on law v5's promotion, in the shape the prototype closes in", () => {
    const close = /<div class="close">([\s\S]*?)<\/div><\/div>/.exec(HTML)?.[1] ?? '';
    // the SHAPE is the prototype's: a headline, a line in Wobo's hand, a loud door and a quiet one
    expect(close).toMatch(/<h2>.+<\/h2>/);
    expect(close).toMatch(/<span class="hand">.+<\/span>/);
    const doors = anchors(close);
    expect(doors).toHaveLength(2);
    // the WORDS are the law's: promote before you invite (landing-v8.html's own close)
    expect(CLOSE.title).toBe('Wobo opens to families this term.');
    expect(CLOSE.primary.label).toBe('Get early access');
    expect(doors[1]).toBe(CLOSE.quiet.label);
  });
});
