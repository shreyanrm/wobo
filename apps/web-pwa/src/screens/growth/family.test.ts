/**
 * THE THREE FAMILIES, HELD TO THE SAME LAW.
 *
 * Each family has its own test for its own risks. This one asserts what is true of all three, and
 * every rule here is a rule that would be easy to break in one family while remembering it in the
 * other two.
 *
 *  1. NO TWO PAGES SHARE THEIR COUNTED COPY. The gate counts a page's own words and excludes the
 *     family's furniture (`gate.ts`), and this is the check that keeps the exclusion honest: if a
 *     standing note or a section lead were ever counted again, two sibling pages would share it and
 *     this fails. Without this test, the word floor slowly becomes a floor on boilerplate.
 *  2. EVERY PUBLISHED ADDRESS IS ONE THE ROUTER ANSWERS, and every published family reaches the
 *     sitemap. A page a crawler is told about and the app cannot render is worse than no page.
 *  3. THE COPY LAW, on every rendered string in all three families: no invented person, no class or
 *     age range, no count of questions a day, no vendor named, no exclamation mark, no em dash, no
 *     emoji, and no late hour (DESIGN.md §0, docs/copy/voice.md §8).
 *  4. EVERY PAGE HAS A WAY OFF IT that is not the header, through `site/handoffs.ts`.
 */

import { describe, expect, it } from 'bun:test';
import { pathToRoute } from '../../shell/router';
import { handoff, type PublicPage } from '../site/handoffs';
import { expandPublicRoutes } from '../states/routes';
import {
  compareIndex,
  comparePaths,
  publishableComparisons,
  ROW_LABELS,
  ROWS,
} from './comparisons';
import { glossaryIndex, glossaryPaths, publishable } from './concepts';
import { examPaths, examsIndex, publishableBoards } from './examCycle';

const glossary = publishable();
const boards = publishableBoards();
const comparisons = publishableComparisons();

/** Every rendered string in the three families, page by page, labelled by its address. */
function everyLine(): { at: string; line: string }[] {
  const out: { at: string; line: string }[] = [];
  const add = (at: string, ...lines: (string | string[] | undefined)[]) => {
    for (const line of lines.flat()) if (line) out.push({ at, line });
  };
  const gi = glossaryIndex();
  add(
    '/glossary',
    gi.title,
    gi.description,
    gi.heading,
    gi.lead,
    gi.count,
    gi.askHeading,
    gi.askPlaceholder,
    gi.askChips,
  );
  for (const page of glossary) {
    add(
      page.path,
      page.title,
      page.description,
      page.lead,
      page.standing,
      page.placesHeading,
      page.sourcesHeading,
      page.sourcesLead,
      page.askHeading,
      page.askPlaceholder,
      page.askChips,
      page.rows.flatMap((r) => [
        r.board,
        r.level,
        r.subject,
        r.kind,
        r.name,
        r.under,
        r.where,
        ...r.objectives,
      ]),
      page.docs.flatMap((d) => [d.title, d.publisher, d.read, d.hash]),
    );
  }
  const ei = examsIndex();
  add(
    '/exams',
    ei.title,
    ei.description,
    ei.heading,
    ei.lead,
    ei.standing,
    ei.askHeading,
    ei.askPlaceholder,
    ei.askChips,
  );
  for (const page of boards) {
    add(
      page.path,
      page.title,
      page.description,
      page.heading,
      page.lead,
      page.standing,
      page.documentsHeading,
      page.documentsLead,
      page.subjectsHeading,
      page.subjectsLead,
      page.officialHeading,
      page.officialLead,
      page.limitsHeading,
      page.limits,
      page.checked,
      page.askHeading,
      page.askPlaceholder,
      page.askChips,
      page.documents.flatMap((d) => [d.title, d.publisher, d.extent, d.read, d.hash]),
      page.subjects.flatMap((s) => [s.level, s.subject, s.size, s.label, s.open]),
      page.official.flatMap((o) => [o.title, o.holds]),
    );
  }
  const ci = compareIndex();
  add(
    '/compare',
    ci.title,
    ci.description,
    ci.heading,
    ci.lead,
    ci.standing,
    ci.askHeading,
    ci.askPlaceholder,
    ci.askChips,
  );
  for (const page of comparisons) {
    add(
      page.path,
      page.title,
      page.description,
      page.heading,
      page.lead,
      page.standing,
      page.sourcesHeading,
      page.closingHeading,
      page.closing,
      page.askHeading,
      page.askPlaceholder,
      page.askChips,
      page.cells.flatMap((c) => [c.label, c.ours.value, c.theirs.value]),
      page.sources.flatMap((s) => [s.title, s.read]),
    );
  }
  return out;
}

const lines = everyLine();

describe('the gate counts a page own words', () => {
  /**
   * The check that keeps the exclusion in `gate.ts` honest. Two sibling pages in a family may never
   * share the copy the gate counted, because copy two pages share is furniture and furniture is
   * exactly what a thin page would clear the floor on.
   */
  it('gives no two glossary pages the same counted copy', () => {
    const counted = glossary.map((p) =>
      [p.lead, p.sourcesLead, p.rows.map((r) => r.name + r.where).join('')].join(' '),
    );
    expect(new Set(counted).size).toBe(counted.length);
  });

  it('gives no two board pages the same counted copy', () => {
    const counted = boards.map((p) => [p.heading, p.lead, p.checked].join(' '));
    expect(new Set(counted).size).toBe(counted.length);
  });

  it('gives no two side-by-side pages the same counted copy', () => {
    const counted = comparisons.map((p) => p.cells.map((c) => c.theirs.value).join(' '));
    expect(new Set(counted).size).toBe(counted.length);
  });

  /** And the four questions are the same on every side-by-side page, by design. */
  it('asks the same questions on every side-by-side page, and never about price', () => {
    expect(ROWS.map((r) => ROW_LABELS[r])).toHaveLength(3);
    // docs/SELL.md §2, a standing owner ruling: not a price comparison, in any form.
    expect(ROWS).not.toContain('cost');
  });
});

describe('every address resolves, and every address is published', () => {
  const paths = [...glossaryPaths(), ...examPaths(), ...comparePaths()];

  it('gives every family address a route the router answers', () => {
    const dead = paths.filter((path) => pathToRoute(path) === null);
    expect(dead).toEqual([]);
  });

  it('answers nothing for an address a family does not hold', () => {
    // A slug the router shapes correctly but no family holds is still a real address to the
    // router; the PAGE answers with the 404. What must not resolve is a deeper path.
    expect(pathToRoute('/glossary/a/b')).toBeNull();
    expect(pathToRoute('/exams/cbse/2026')).toBeNull();
    expect(pathToRoute('/compare/a/b')).toBeNull();
  });

  it('puts every published page in the sitemap, and nothing that was refused', () => {
    const sitemap = new Set(expandPublicRoutes().map((r) => r.path));
    for (const path of paths) expect([path, sitemap.has(path)]).toEqual([path, true]);
    // The three glossary concepts the gate refused must not be promised to a crawler.
    const published = new Set(glossaryPaths());
    const promised = [...sitemap].filter((p) => p.startsWith('/glossary'));
    expect(promised.filter((p) => !published.has(p))).toEqual([]);
  });
});

describe('the copy law, on every line these families render', () => {
  const hits = (pattern: RegExp): string[] =>
    lines.filter(({ line }) => pattern.test(line)).map(({ at, line }) => `${at}: ${line}`);

  it('names no invented person', () => {
    const NAMES =
      /\b(?:Aanya|Aarav|Aditi|Advika|Amit|Ananya|Anjali|Anaya|Arjun|Asha|Ayesha|Deepak|Diya|Fatima|Imran|Isha|Ishaan|Kabir|Karan|Kavya|Kiran|Leela|Manav|Meera|Myra|Naina|Neel|Neha|Nikhil|Nisha|Pooja|Priya|Reyansh|Riya|Rohan|Saanvi|Sanya|Shreya|Siya|Sunita|Tanvi|Vihaan|Vikram|Varun|Yash|Zara|Zoya)\b/;
    expect(hits(NAMES)).toEqual([]);
  });

  it('writes no class or age range', () => {
    const LEVEL = 'class(?:es)?|grades?|years?|std|standards?';
    const JOIN = 'to|through|until|up\\s+to|–|—|-|\\.\\.';
    expect(
      hits(
        new RegExp(
          `\\b(?:${LEVEL})\\s*\\.?\\s*\\d{1,2}\\s*(?:${JOIN})\\s*(?:${LEVEL})?\\s*\\d{1,2}\\b`,
          'i',
        ),
      ),
    ).toEqual([]);
    expect(
      hits(
        new RegExp(
          `\\b(?:from|up\\s+to|below|above|under|over|beyond|starting\\s+(?:at|from))\\s+(?:about\\s+|around\\s+|roughly\\s+)?(?:${LEVEL})\\s*\\d{1,2}\\b`,
          'i',
        ),
      ),
    ).toEqual([]);
    expect(hits(/\bages?\s*\d{1,2}\s*(?:to|through|-|–)\s*\d{1,2}\b/i)).toEqual([]);
  });

  it('prints no count of questions a day', () => {
    expect(hits(/\b\d+\s+(?:questions?|asks?|turns?)\s+(?:a|per|each)\s+day\b/i)).toEqual([]);
    expect(hits(/\bunlimited\b/i)).toEqual([]);
  });

  /**
   * The vendor half of the copy law is NOT repeated here, and that is deliberate.
   * `scripts/gate_white_label.py` already scans every shipped source file for a provider's name,
   * this file included, so spelling the names out in a regex here made the release gate fail on
   * its own test. One rule, one place: the gate owns it and the pages are covered by it.
   */

  it('uses no exclamation mark, no em dash and no emoji', () => {
    expect(hits(/[!—]/)).toEqual([]);
    expect(hits(/\p{Extended_Pictographic}/u)).toEqual([]);
  });

  it('names no late hour', () => {
    expect(hits(/\b(?:tonight|midnight|10\s*pm|11\s*pm|late\s+at\s+night)\b/i)).toEqual([]);
  });

  /** Wherever a line says Wobo draws, a neighbouring line names another form (voice.md §8.5). */
  it('never lets the board stand for the whole product', () => {
    for (const page of glossary) {
      if (/draw|board/i.test(page.standing)) {
        expect([page.slug, /out loud|drag|film/i.test(page.standing)]).toEqual([page.slug, true]);
      }
    }
  });
});

describe('no page dead-ends', () => {
  it('gives each family a close with a way forward that is not the header', () => {
    for (const page of ['glossary', 'exams', 'compare'] as PublicPage[]) {
      const close = handoff(page, true);
      expect([page, close.primary.label]).not.toEqual([page, close.quiet.label]);
      for (const action of [close.primary, close.quiet]) {
        expect([page, action.label, Boolean(action.to) !== Boolean(action.href)]).toEqual([
          page,
          action.label,
          true,
        ]);
        if (action.href && !action.href.startsWith('#')) {
          expect([page, action.href, pathToRoute(action.href) !== null]).toEqual([
            page,
            action.href,
            true,
          ]);
        }
      }
    }
  });
});
