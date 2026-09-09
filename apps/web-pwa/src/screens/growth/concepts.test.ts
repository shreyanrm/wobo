/**
 * THE GLOSSARY'S QUALITY GATE, as a test rather than as an intention.
 *
 * The family is generated, so the only thing standing between it and a penalty is that every page
 * it publishes has something real on it. That is asserted here against the SHIPPED data, not
 * against a fixture: if the syllabus changes and a page goes thin, this fails.
 *
 * The count is asserted the other way round from the usual: the test does not say "there are 118
 * pages", it says "every page that ships passes, and the number that pass is the number we may
 * publish anywhere" (docs/WOBO-TASKS §10.21).
 */

import { describe, expect, it } from 'bun:test';
import {
  BOARDS,
  CONCEPTS,
  classesOf,
  conceptBySlug,
  conceptPage,
  DOCUMENTS,
  glossaryIndex,
  glossaryPaths,
  listOf,
  lowerFirst,
  MIN_PLACEMENTS,
  publishable,
} from './concepts';
import { WORD_FLOOR } from './gate';

const pages = publishable();

describe('the data behind the family', () => {
  it('publishes only the four boards whose syllabus we have read', () => {
    expect(Object.keys(BOARDS).sort()).toEqual(['cbse', 'icse', 'isc', 'nios']);
  });

  /**
   * The rule that keeps this family out of the spam bracket. A concept the seed teaches once
   * already has a chapter page; a glossary page for it would be that page at a second address.
   */
  it('carries no concept the syllabus teaches in fewer than two distinct places', () => {
    const thin = CONCEPTS.filter((concept) => {
      const distinct = new Set(concept.places.map((p) => `${p.board}/${p.level}/${p.subject}`));
      return distinct.size < MIN_PLACEMENTS;
    });
    expect(thin.map((c) => c.slug)).toEqual([]);
  });

  /** Provenance is the reason these pages are allowed to exist, so it is not optional anywhere. */
  it('gives every placement a document with a URL, a hash and the day we read it', () => {
    const missing: string[] = [];
    for (const concept of CONCEPTS) {
      for (const place of concept.places) {
        const doc = DOCUMENTS[place.doc];
        if (!doc?.url || !doc.sha256 || !doc.fetchedAt)
          missing.push(`${concept.slug}/${place.doc}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('names a document by the board that published it, never by us', () => {
    for (const doc of Object.values(DOCUMENTS)) {
      expect([doc.id, doc.publisher.length > 3]).toEqual([doc.id, true]);
      expect([doc.id, doc.url.startsWith('https://')]).toEqual([doc.id, true]);
    }
  });
});

describe('the gate, on the pages that actually ship', () => {
  it('publishes at least one page, or the family is not a family', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('passes every published page, with the words counted from the page itself', () => {
    const failed = pages.filter((page) => !page.verdict.publishable);
    expect(failed.map((p) => `${p.slug}: ${p.verdict.because.join('; ')}`)).toEqual([]);
    for (const page of pages) {
      expect([page.slug, page.evidence.words >= WORD_FLOOR]).toEqual([page.slug, true]);
    }
  });

  it('never claims a drawn explanation, because tier one does not have one', () => {
    expect(pages.every((page) => page.evidence.drawn === false)).toBe(true);
  });

  it('gives every page a tutor door and at least one source', () => {
    for (const page of pages) {
      expect([page.slug, page.evidence.door]).toEqual([page.slug, true]);
      expect([page.slug, page.evidence.sources > 0]).toEqual([page.slug, true]);
    }
  });

  /**
   * A concept whose every placement lost its document would fall below the gate rather than
   * publish an empty page. Built by hand because the shipped data has no such concept, which is
   * the point: the gate has to be provably able to say no.
   */
  it('refuses a concept stripped of everything a reader would come for', () => {
    const real = CONCEPTS[0];
    if (!real) throw new Error('no concepts to build the negative case from');
    const empty = conceptPage({ ...real, name: 'X', subjects: [], boards: [], places: [] });
    expect(empty.verdict.publishable).toBe(false);
    expect(empty.verdict.because.join(' ')).toContain('words');
  });
});

describe('the words on a page', () => {
  const page = pages[0];
  if (!page) throw new Error('no published page to read');

  it('says which boards, which subjects and which classes, in the lead', () => {
    const concept = conceptBySlug(page.slug);
    if (!concept) throw new Error('a published page with no concept behind it');
    for (const board of concept.boards) expect(page.lead).toContain(board);
    expect(page.lead).toContain(concept.name);
  });

  /**
   * THE COPY LAW, ON EVERY PAGE IN THE FAMILY. A class range on a public surface reads as a gate on
   * who may sign up (docs/copy/voice.md §8.2), and it is the rule most easily broken by a page that
   * is generated from a syllabus: "class 9 to class 12" is one join word away at all times. The
   * patterns are the gateway's own (`services/gateway/tests/test_copy_law.py`).
   */
  it('never writes a class range, on any page in the family', () => {
    const SPAN =
      /\b(?:class(?:es)?|grades?|years?|std|standards?)\s*\.?\s*\d{1,2}\s*(?:to|through|until|up\s+to|–|—|-|\.\.)\s*(?:class(?:es)?|grades?|years?|std|standards?)?\s*\d{1,2}\b/i;
    const BOUND =
      /\b(?:from|up\s+to|below|above|under|over|beyond|starting\s+(?:at|from))\s+(?:about\s+|around\s+|roughly\s+)?(?:class(?:es)?|grades?|years?|std|standards?)\s*\d{1,2}\b/i;
    const hits = pages
      .flatMap((p) => [p.title, p.description, p.lead, p.standing, p.sourcesLead, p.askPlaceholder])
      .filter((line) => SPAN.test(line) || BOUND.test(line));
    expect(hits).toEqual([]);
  });

  it('lists the classes rather than spanning them', () => {
    expect(
      classesOf([
        { levelOrder: 9, level: 'Class 9' },
        { levelOrder: 12, level: 'Class 12' },
      ] as never),
    ).toBe('Class 9 and Class 12');
  });

  /**
   * The page must not imply an explanation it does not carry, and wherever it says Wobo draws it
   * has to name another form in the same breath (docs/copy/voice.md §8.5).
   */
  it('says plainly that the explanation is not on the page, and names three forms', () => {
    expect(page.standing).toContain('not a lesson');
    expect(page.standing).toContain('out loud');
    expect(page.standing).toContain('drag');
  });

  it('carries no exclamation mark and no em dash, anywhere', () => {
    const all = pages.flatMap((p) => [
      p.title,
      p.description,
      p.lead,
      p.standing,
      p.sourcesLead,
      p.askHeading,
      p.askPlaceholder,
      ...p.askChips,
    ]);
    expect(all.filter((line) => /[!—]/.test(line))).toEqual([]);
  });
});

describe('the index', () => {
  const index = glossaryIndex();

  it('publishes and states a count it can prove', () => {
    expect(index.verdict.publishable).toBe(true);
    expect(index.count.startsWith(`${pages.length} ideas`)).toBe(true);
  });

  it('lists every published page at least once, and nothing that was refused', () => {
    const listed = new Set(index.groups.flatMap((g) => g.entries.map((e) => e.slug)));
    expect([...listed].sort()).toEqual(pages.map((p) => p.slug).sort());
  });

  it('groups by subject and sorts inside each group', () => {
    for (const group of index.groups) {
      const names = group.entries.map((e) => e.name);
      expect([group.subject, names]).toEqual([
        group.subject,
        [...names].sort((a, b) => a.localeCompare(b)),
      ]);
    }
  });
});

describe('the addresses', () => {
  it('gives the index first, then one per page that passed', () => {
    const paths = glossaryPaths();
    expect(paths[0]).toBe('/glossary');
    expect(paths).toHaveLength(pages.length + 1);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every slug a lowercase, hyphenated address', () => {
    for (const page of pages)
      expect([page.slug, /^[a-z0-9-]+$/.test(page.slug)]).toEqual([page.slug, true]);
  });
});

describe('small words', () => {
  it('joins a list the way a person says one', () => {
    expect(listOf(['CBSE'])).toBe('CBSE');
    expect(listOf(['CBSE', 'ICSE'])).toBe('CBSE and ICSE');
    expect(listOf(['CBSE', 'ICSE', 'ISC'])).toBe('CBSE, ICSE and ISC');
  });

  it('lowercases an ordinary name inside a sentence and leaves an initialism alone', () => {
    expect(lowerFirst('Laws of Motion')).toBe('laws of Motion');
    expect(lowerFirst('DNA and its structure')).toBe('DNA and its structure');
  });
});
