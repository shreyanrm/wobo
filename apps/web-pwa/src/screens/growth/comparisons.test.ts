/**
 * THE SIDE-BY-SIDE PAGES' GATE, and it is mostly a gate on what we are allowed to SAY.
 *
 * These are the only public pages that name another company, so the risk is not thinness. It is
 * drift: a table becomes a verdict one adjective at a time, and by the time anybody notices, the
 * page is running a competitor down on a site whose standing owner ruling forbids exactly that
 * (docs/SELL.md §2, docs/CLAIMS.md).
 *
 * So the checks here are:
 *
 *  · NO COMPARATIVE, NO SUPERLATIVE, anywhere in a page's copy. Not "better", not "cheaper", not
 *    "the only", not "unlike". The one place a comparative word is allowed is a sentence that says
 *    we do not rank them, and even that is spelled without one.
 *  · NO QUALITY WORD about anyone. Not "stale", not "outdated", not "expensive", not "confusing".
 *  · EVERY FACT SOURCED TO THE PRODUCT'S OWN SITE, and checked on a day that has happened. A
 *    statement about a product may not come from a review site or a press report.
 *  · NO PRICE ROW AT ALL. docs/SELL.md §2 is a standing owner ruling that we do not publish a
 *    price comparison, and a row with two products' prices in it is one however the prose around
 *    it reads. Ours is on the plans page, in full.
 *  · NO ROW WITH AN ABSENCE ON ONE SIDE ONLY. "Not on the page we read" opposite a paragraph is
 *    adverse by selection: both halves are true and the pair of them draws the conclusion the
 *    page promises not to draw.
 *
 * AND THE FAMILY DOES NOT SHIP TODAY, which those two rules are what decided. With the price row
 * gone and the one-sided rows refused, each page has two sourced questions on it, around a
 * hundred words, and falls under the family's floor. That is the gate doing its job rather than
 * a failure: these pages ship when they hold enough questions BOTH sides answer, off each
 * product's own site, none of them about price. The tests below assert that outcome rather than
 * quietly asserting nothing.
 */

import { describe, expect, it } from 'bun:test';
import {
  COMPARISONS,
  compareIndex,
  comparePage,
  comparePaths,
  comparisonBySlug,
  evenHanded,
  type Fact,
  factOk,
  isAbsence,
  NOT_ON_THE_PAGE,
  ourColumn,
  publishableComparisons,
  ROW_LABELS,
  ROWS,
  STANDING_NOTE,
} from './comparisons';
import { WORD_FLOOR } from './gate';

const NOW = new Date('2026-09-09T23:00:00Z');
const pages = publishableComparisons(NOW);

/** Every string a reader sees on a page in this family. */
function copyOf(page: (typeof pages)[number]): string[] {
  return [
    page.title,
    page.description,
    page.heading,
    page.lead,
    page.standing,
    ...page.cells.flatMap((c) => [c.label, c.ours.value, c.theirs.value]),
    page.sourcesHeading,
    ...page.sources.map((s) => s.title),
    page.closingHeading,
    ...page.closing,
    page.askHeading,
    page.askPlaceholder,
    ...page.askChips,
  ];
}

describe('what these pages may never say', () => {
  const index = compareIndex(NOW);
  const everything = [
    ...pages.flatMap(copyOf),
    index.title,
    index.description,
    index.heading,
    index.lead,
    index.standing,
    ...index.entries.map((e) => e.line),
    index.askHeading,
    index.askPlaceholder,
    ...index.askChips,
  ];

  /**
   * The comparative and the superlative, in the forms that actually turn up in marketing copy.
   * `-er than` is caught by the "than" clause rather than by a suffix, because "other" and
   * "either" are ordinary English and a suffix rule would fire on both.
   */
  it('carries no comparative and no superlative, anywhere', () => {
    const BANNED = [
      /\bbetter\b/i,
      /\bbest\b/i,
      /\bworse\b/i,
      /\bworst\b/i,
      /\bcheaper\b/i,
      /\bcheapest\b/i,
      /\bfaster\b/i,
      /\bfastest\b/i,
      /\bsimpler\b/i,
      /\beasier\b/i,
      /\bmore\s+\w+\s+than\b/i,
      /\bless\s+\w+\s+than\b/i,
      /\bthe\s+only\b/i,
      /\bunlike\b/i,
      /\bwhereas\b/i,
      /\binstead\s+of\b/i,
      /\bwins?\b/i,
      /\bbeats?\b/i,
      /\bahead\s+of\b/i,
    ];
    const hits = everything.filter((line) => BANNED.some((p) => p.test(line)));
    expect(hits).toEqual([]);
  });

  /** A word about somebody else's quality is not ours to publish, in either direction. */
  it('carries no judgement of anyone quality', () => {
    const BANNED = [
      /\bstale\b/i,
      /\boutdated\b/i,
      /\bout\s+of\s+date\b/i,
      /\bexpensive\b/i,
      /\boverpriced\b/i,
      /\bconfusing\b/i,
      /\bpoor\b/i,
      /\bfailing\b/i,
      /\bcollapse[ds]?\b/i,
      /\bshut\s+down\b/i,
      /\bbroken\b/i,
      /\bmisleading\b/i,
    ];
    const hits = everything.filter((line) => BANNED.some((p) => p.test(line)));
    expect(hits).toEqual([]);
  });

  it('carries no exclamation mark and no em dash', () => {
    expect(everything.filter((line) => /[!—]/.test(line))).toEqual([]);
  });

  /** The same class-range law as every other public surface (docs/copy/voice.md §8.2). */
  it('writes no class range, not even inside a quotation', () => {
    const SPAN =
      /\b(?:class(?:es)?|grades?|years?|std|standards?)\s*\.?\s*\d{1,2}\s*(?:to|through|until|up\s+to|–|—|-|\.\.)\s*(?:class(?:es)?|grades?|years?|std|standards?)?\s*\d{1,2}\b/i;
    const BOUND =
      /\b(?:from|up\s+to|below|above|under|over|beyond|starting\s+(?:at|from))\s+(?:about\s+|around\s+|roughly\s+)?(?:class(?:es)?|grades?|years?|std|standards?)\s*\d{1,2}\b/i;
    expect(everything.filter((line) => SPAN.test(line) || BOUND.test(line))).toEqual([]);
  });

  it('says on every page that it is not ranking anyone', () => {
    for (const page of pages) {
      expect([page.slug, page.lead.includes('ranks')]).toEqual([page.slug, true]);
      expect([page.slug, page.standing]).toEqual([page.slug, STANDING_NOTE]);
    }
  });
});

describe('every fact is sourced and dated', () => {
  it('sources every cell to the product own site', () => {
    const ours = ourColumn();
    for (const comparison of COMPARISONS) {
      for (const key of ROWS) {
        const theirs = comparison.other.facts[key];
        expect([comparison.slug, key, factOk(theirs, comparison.other, NOW)]).toEqual([
          comparison.slug,
          key,
          true,
        ]);
        expect([key, factOk(ours.facts[key], ours, NOW)]).toEqual([key, true]);
      }
    }
  });

  /** The rule with teeth: a price read off a review site is not a price the product publishes. */
  it('drops a cell sourced anywhere but the product own site', () => {
    const comparison = COMPARISONS[0];
    if (!comparison) throw new Error('no comparison to build the negative case from');
    const borrowed = {
      ...comparison.other.facts.what,
      source: { title: 'a review site', url: 'https://example.com/review' },
    };
    expect(factOk(borrowed, comparison.other, NOW)).toBe(false);
  });

  it('drops a cell checked on a day that has not happened', () => {
    const comparison = COMPARISONS[0];
    if (!comparison) throw new Error('no comparison to build the negative case from');
    const future = { ...comparison.other.facts.what, checked: '2027-01-01' };
    expect(factOk(future, comparison.other, NOW)).toBe(false);
    const early = comparePage(comparison, new Date('2026-01-01T00:00:00Z'));
    expect(early.cells).toEqual([]);
    expect(early.verdict.publishable).toBe(false);
  });

  it('lists every source it used, once each, with the day it was read', () => {
    for (const page of pages) {
      const used = new Set(page.cells.flatMap((c) => [c.ours.source.url, c.theirs.source.url]));
      expect([page.slug, page.sources.map((s) => s.url).sort()]).toEqual([
        page.slug,
        [...used].sort(),
      ]);
      for (const source of page.sources) expect(source.read).toContain('2026');
    }
  });

  /** docs/SELL.md §2: "Not a price comparison". The row is gone, and it may not come back. */
  it('carries no price row, on any page, in either column', () => {
    expect(ROWS).not.toContain('cost');
    expect(Object.values(ROW_LABELS).join(' ')).not.toMatch(/cost|price|rupee|month/i);
    expect(Object.keys(ourColumn().facts)).toEqual([...ROWS]);
    for (const comparison of COMPARISONS) {
      expect([comparison.slug, Object.keys(comparison.other.facts).sort()]).toEqual([
        comparison.slug,
        [...ROWS].sort(),
      ]);
    }
  });

  /**
   * A blank beside a paragraph is a verdict, and a page that promises not to reach one may not
   * print it. An absence opposite an absence is fair: neither page answers, and that is a fact
   * about two pages rather than about two products.
   */
  it('refuses a row where only one side is an absence, and keeps one where both are', () => {
    const said: Fact = {
      value: 'A sentence off the page we read.',
      source: { title: 'ours', url: 'https://heywobo.com/' },
      checked: '2026-09-09',
    };
    const blank: Fact = { ...said, value: NOT_ON_THE_PAGE };
    expect(evenHanded(said, blank)).toBe(false);
    expect(evenHanded(blank, said)).toBe(false);
    expect(evenHanded(blank, blank)).toBe(true);
    expect(evenHanded(said, said)).toBe(true);
    for (const page of pages) {
      for (const cell of page.cells) {
        expect([page.slug, cell.label, isAbsence(cell.ours) === isAbsence(cell.theirs)]).toEqual([
          page.slug,
          cell.label,
          true,
        ]);
      }
    }
  });
});

describe('the gate', () => {
  /**
   * THE HONEST STATE OF THIS FAMILY, WRITTEN DOWN. Each comparison holds two questions both sides
   * answer, which is around a hundred words, and the floor is 140. So none of them is published,
   * the index has nothing to index, and the family puts no address in the sitemap. Everything the
   * pages need in order to ship is a matter of more sourced rows, not of lowering anything.
   */
  it('publishes nothing while a page has only two questions both sides answer', () => {
    for (const comparison of COMPARISONS) {
      const page = comparePage(comparison, NOW);
      expect([page.slug, page.cells.length]).toEqual([page.slug, 2]);
      expect([page.slug, page.evidence.words < WORD_FLOOR]).toEqual([page.slug, true]);
      expect([page.slug, page.verdict.publishable]).toEqual([page.slug, false]);
    }
    expect(pages).toEqual([]);
    expect(compareIndex(NOW).verdict.publishable).toBe(false);
    expect(comparePaths(NOW)).toEqual([]);
  });

  it('asks the same questions, in the same order, on every page it would ship', () => {
    for (const comparison of COMPARISONS) {
      const page = comparePage(comparison, NOW);
      const asked = page.cells.map((c) => c.label);
      expect([page.slug, asked]).toEqual([
        page.slug,
        ROWS.map((r) => ROW_LABELS[r]).filter((label) => asked.includes(label)),
      ]);
    }
  });

  it('answers with nothing for a slug we do not publish', () => {
    expect(comparisonBySlug('wobo-vs-nobody')).toBeNull();
  });
});

describe('the addresses', () => {
  it('carries the words people type, and gives the index first', () => {
    const paths = comparePaths(NOW);
    if (paths.length > 0) {
      expect(paths[0]).toBe('/compare');
      expect(paths.slice(1)).toEqual(pages.map((p) => p.path));
    }
    for (const comparison of COMPARISONS) expect(comparison.slug.startsWith('wobo-vs-')).toBe(true);
  });

  /** No address at all while the family has nothing to show, rather than an index of nothing. */
  it('puts no address in the sitemap while nothing clears the gate', () => {
    expect(comparePaths(NOW)).toEqual([]);
  });
});
