/**
 * THE OWNER'S TEST, WRITTEN OUT.
 *
 * docs/GROWTH-SEARCH.md §6: the 4 board pages, the 13 class pages and the 50 subject pages "are
 * never generated from a template with a name swapped, and a test asserts that no two of them
 * share a paragraph."
 *
 * That is the assertion below, and it is made stricter than the ruling asks, because "no two share
 * a paragraph" is cleared by two paragraphs that differ in one word. No two of the sixty-seven
 * share a paragraph, a sentence, or a run of six words. A page written from a template with a name
 * swapped fails the six-word rule on its first line, which is the point of having it.
 *
 * The other half is coverage: every page in those three layers that this build publishes has an
 * entry, and every entry names an address this build publishes. Either gap would mean the family
 * had quietly gone back to being generated.
 */

import { describe, expect, it } from 'bun:test';
import { addressFrom } from './address';
import { partsOf } from './copy';
import { HANDMADE, handmade, handmadePaths } from './handmade';
import { maskedWords, plainWords, runsOf } from './handmade-measure';
import { releasedPages } from './pages';
import { find } from './tree';

const ENTRIES = Object.entries(HANDMADE);
const PARAGRAPHS = ENTRIES.flatMap(([path, page]) =>
  [page.opening, page.question, page.answer].map((text) => ({ path, text })),
);

/** Words, lowercased, punctuation dropped: two paragraphs that differ only in a comma are one. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shared<T>(rows: readonly { path: string; key: string; body: T }[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const at = seen.get(row.key) ?? new Set<string>();
    at.add(row.path);
    seen.set(row.key, at);
  }
  return [...seen.entries()]
    .filter(([, paths]) => paths.size > 1)
    .map(([key, paths]) => `${[...paths].join(' and ')}: ${key.slice(0, 60)}`);
}

describe('the sixty-seven pages that are written rather than generated', () => {
  it('has one for every board, class and subject page this build publishes', () => {
    const wanted = releasedPages()
      .filter(
        (page) => page.layer === 'board' || page.layer === 'class' || page.layer === 'subject',
      )
      .map((page) => page.path);
    expect(wanted.length).toBe(67);
    expect(wanted.filter((path) => handmade(path) === null)).toEqual([]);
  });

  it('writes nothing for an address this build does not publish', () => {
    const published = new Set(releasedPages().map((page) => page.path));
    expect(handmadePaths().filter((path) => !published.has(path))).toEqual([]);
  });

  it('fills all three fields on every one of them', () => {
    for (const [path, page] of ENTRIES) {
      expect([path, page.opening.length > 80]).toEqual([path, true]);
      expect([path, page.question.trim().endsWith('?')]).toEqual([path, true]);
      expect([path, page.answer.length > 120]).toEqual([path, true]);
    }
  });

  it('lets no two of them share a paragraph', () => {
    expect(
      shared(PARAGRAPHS.map((row) => ({ ...row, key: words(row.text).join(' '), body: row }))),
    ).toEqual([]);
  });

  it('lets no two of them share a sentence', () => {
    const sentences = PARAGRAPHS.flatMap((row) =>
      row.text
        .split(/(?<=[.?])\s+/)
        .map((sentence) => words(sentence).join(' '))
        .filter((sentence) => sentence.length > 12)
        .map((key) => ({ path: row.path, key, body: row })),
    );
    // A sentence repeated inside ONE page is that page's business; across two it is a template.
    const perPage = new Map<string, Set<string>>();
    for (const row of sentences) {
      const at = perPage.get(row.key) ?? new Set<string>();
      at.add(row.path);
      perPage.set(row.key, at);
    }
    expect(
      [...perPage.entries()].filter(([, paths]) => paths.size > 1).map(([key]) => key.slice(0, 70)),
    ).toEqual([]);
  });

  it('lets no two of them share even a run of six words', () => {
    const runs = new Map<string, Set<string>>();
    for (const [path, page] of ENTRIES) {
      const all = words([page.opening, page.question, page.answer].join(' '));
      for (let i = 0; i + 6 <= all.length; i += 1) {
        const key = all.slice(i, i + 6).join(' ');
        const at = runs.get(key) ?? new Set<string>();
        at.add(path);
        runs.set(key, at);
      }
    }
    const echoes = [...runs.entries()]
      .filter(([, paths]) => paths.size > 1)
      .map(([key, paths]) => `${key} :: ${[...paths].join(' | ')}`);
    expect(echoes).toEqual([]);
  });

  /**
   * The copy law's own patterns, run over these paragraphs directly. `copy.test.ts` runs the whole
   * law over every line the family writes, this file included; the three below are repeated here
   * because they are the three a hand-written paragraph is most likely to break.
   */
  it('breaks none of the three rules a written paragraph most often breaks', () => {
    const lines = PARAGRAPHS.map((row) => row.text);
    // No class, grade or age range, in any direction (voice.md §8.2).
    expect(
      lines.filter((line) =>
        /\b(?:class(?:es)?|grades?|years?)\s*\d{1,2}\s*(?:to|through|until|-|–)\s*(?:class(?:es)?|grades?)?\s*\d{1,2}\b/i.test(
          line,
        ),
      ),
    ).toEqual([]);
    // No exclamation mark, no em dash (DESIGN.md §0).
    expect(lines.filter((line) => /[!—]/.test(line))).toEqual([]);
    // Never a word against anyone (SELL.md §2).
    expect(
      lines.filter((line) =>
        /\b(?:better than|worse than|cheaper than|unlike (?:a|your|the) (?:teacher|school|tutor))\b/i.test(
          line,
        ),
      ),
    ).toEqual([]);
  });

  /**
   * Wherever a paragraph says Wobo draws, the same paragraph names another of the forms
   * (docs/copy/voice.md §8.5). Drawing is one of the things Wobo does with a question and a page
   * that lets the board stand for the whole product is selling the product short.
   */
  it('never lets the board stand for the whole product', () => {
    // The trigger is Wobo DRAWING, not the word "board", which on these pages nearly always means
    // the examination board that published the syllabus.
    const offenders = ENTRIES.filter(([, page]) =>
      /\bdraw(s|n|ing)?\b|\bon the board\b/i.test(page.answer),
    )
      .filter(
        ([, page]) =>
          !/\b(?:aloud|out loud|talk\w*|says?|speaks?|spoken|narrates?|films?|drag|watch(?:ing)?|asks?|asking|practis\w*|remembers?|reports?|hands? (?:it|that|the|over))\b/i.test(
            page.answer,
          ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

/**
 * THE SAME RULE, WITH THE NAMES TAKEN OUT (2026-09-17).
 *
 * The six-word rule above is beaten by the template it was written against: a mould that swaps a
 * board, a class or a subject name every few words never repeats six words in a row. So every
 * name the tree knows and every numeral is masked first (`handmade-measure.ts`), and then no two
 * entries may share more than a small share of their five-word runs.
 *
 * THE THRESHOLD IS 10%, and it was measured. With names masked, the most any written entry shares
 * with its closest sibling is 3.7% (isc/class-11/mathematics against icse/class-9/mathematics:
 * both list the same unit names, which mask to the same placeholder run). A name-swapped copy
 * shares 100%. One templated paragraph out of three shares between roughly 7% (the question
 * alone) and 50% (the answer alone), so 10% sits under a templated opening or answer and well
 * clear of the honest ceiling. A templated question alone would slip under 10%, which is what the
 * masked-sentence rule below is for.
 */
describe('the sixty-seven, with every name masked', () => {
  const MASKED_SHARE_CEILING = 0.1;
  const masked = ENTRIES.map(([path, page]) => ({
    path,
    runs: runsOf(maskedWords([page.opening, page.question, page.answer].join(' ')), 5),
  }));

  it('lets no entry share more than a tenth of its shape with any other', () => {
    const over: string[] = [];
    for (const a of masked) {
      for (const b of masked) {
        if (a === b) continue;
        let common = 0;
        for (const run of a.runs) if (b.runs.has(run)) common += 1;
        const share = common / a.runs.size;
        if (share > MASKED_SHARE_CEILING) {
          over.push(`${a.path} shares ${(share * 100).toFixed(1)}% with ${b.path}`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it('lets no two of them share a sentence even once the names are swapped back', () => {
    const at = new Map<string, Set<string>>();
    for (const [path, page] of ENTRIES) {
      for (const text of [page.opening, page.question, page.answer]) {
        for (const sentence of text.split(/(?<=[.?:])\s+/)) {
          const key = maskedWords(sentence).join(' ');
          if (key.split(' ').length < 5) continue;
          const paths = at.get(key) ?? new Set<string>();
          paths.add(path);
          at.set(key, paths);
        }
      }
    }
    expect(
      [...at.entries()]
        .filter(([, paths]) => paths.size > 1)
        .map(([key, paths]) => `${key} :: ${[...paths].join(' | ')}`),
    ).toEqual([]);
  });

  it('can tell a template from a written page', () => {
    // The check is only worth having if it fails the thing it exists for. Pour one entry into
    // every address with the names swapped, and every pair must cross the ceiling.
    const mould = HANDMADE['/learn/cbse/class-9/mathematics'];
    if (!mould) throw new Error('the mould page is missing');
    const poured = (name: string, level: string) =>
      runsOf(
        maskedWords(
          [mould.opening, mould.question, mould.answer]
            .join(' ')
            .replaceAll('CBSE', name)
            .replaceAll('Class 9', level),
        ),
        5,
      );
    const a = poured('ICSE', 'Class 10');
    const b = poured('NIOS', 'Class 12');
    let common = 0;
    for (const run of a) if (b.has(run)) common += 1;
    expect(common / a.size).toBeGreaterThan(MASKED_SHARE_CEILING);
  });
});

/**
 * WHAT A PAGE SAYS ABOUT ITS OWN SYLLABUS IS TRUE OF THAT SYLLABUS (2026-09-17).
 *
 * Measured on 2026-09-17: the 67 were distinct, and a dozen of them described a syllabus the page
 * does not carry. The CBSE openings for the middle years named chapters from the textbooks the
 * board has since replaced, one subject opening called itself "the most examined" syllabus in the
 * country, and two pages printed a share of the paper the board never published. docs/CLAIMS.md
 * says nothing uncleared is published, so what can be checked against the tree is checked here.
 */
describe('the sixty-seven say only what their own syllabus bears out', () => {
  const NUMBERS: Readonly<Record<string, number>> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
  };

  function nodeAt(path: string) {
    const address = addressFrom(path.split('/').filter(Boolean).slice(1));
    const place = address ? find(address) : null;
    if (!place) throw new Error(`no place behind ${path}`);
    return place;
  }

  it('states every count as the count the page actually holds', () => {
    const wrong: string[] = [];
    for (const [path, page] of ENTRIES) {
      const place = nodeAt(path);
      // "Syllabuses" counts the subjects of the year the page sits in; the rest count its own list.
      const held = (unit: string) =>
        unit.toLowerCase() === 'syllabuses'
          ? (place.level ?? place.node).children.length
          : place.node.children.length;
      const text = [page.opening, page.question, page.answer].join(' ');
      const counted =
        /\b(\d+|[a-z]+)\s+(?:named\s+|senior\s+)?(chapters|units|syllabuses|themes)\b/gi;
      for (const match of text.matchAll(counted)) {
        const word = (match[1] ?? '').toLowerCase();
        const said = /^\d+$/.test(word) ? Number(word) : NUMBERS[word];
        if (said === undefined) continue;
        const holds = held(match[2] ?? '');
        if (said !== holds) wrong.push(`${path} says "${match[0]}" and holds ${holds}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * NO SUPERLATIVE, BECAUSE THE TREE CANNOT PROVE ONE (the closer's run, 2026-09-17).
   *
   * The layer under a subject holds whatever the board publishes at that level, and boards
   * publish different things there: CBSE class 12 chemistry lists ten chapters, its mathematics
   * and physics list units that each hold several chapters, CBSE class 10 social science lists
   * four whole books, and the class 6 to 8 subjects list themes or a textbook. So "the longest"
   * proven by counting children compared chapters with units and books, and passed while it was
   * not established. docs/CLAIMS.md: nothing uncleared is published. A superlative about a
   * syllabus comes back only with its own section in CLAIMS.md and a comparison of like with like.
   */
  const SUPERLATIVE =
    /\b(?:longest|largest|shortest|heaviest|biggest|widest|smallest|fewest|most examined|most chapters|more \w+ than (?:any|the)|only (?:syllabus|course))\b/i;

  it('makes no superlative about a syllabus', () => {
    const made = ENTRIES.flatMap(([path, page]) => {
      const found = [page.opening, page.question, page.answer].join(' ').match(SUPERLATIVE);
      return found ? [`${path} says "${found[0]}"`] : [];
    });
    expect(made).toEqual([]);
  });

  it('never calls a list of textbooks, theme sections or books a chapter list', () => {
    // CBSE class 8 science lists one textbook; its chapters are on the textbook's own page.
    const wrong = ENTRIES.flatMap(([path, page]) => {
      const place = nodeAt(path);
      if (place.kind !== 'subject' || partsOf(place.node) === 'chapter') return [];
      const text = [page.opening, page.question, page.answer].join(' ');
      const found = text.match(/chapter list on this page|\bchapters here\b|\bthese chapters\b/i);
      return found ? [`${path} says "${found[0]}"`] : [];
    });
    expect(wrong).toEqual([]);
  });

  it('would have caught the comparison that counted units against chapters', () => {
    // The proof the superlatives leaned on: CBSE class 12 chemistry has more children than its
    // siblings, and those siblings' children are units. Pinned so nobody re-proves a claim this way.
    const level = nodeAt('/learn/cbse/class-12').node;
    const physics = level.children.find((s) => s.slug === 'physics');
    const chemistry = level.children.find((s) => s.slug === 'chemistry');
    expect(chemistry?.children.length).toBe(10);
    expect(physics?.children.length).toBeLessThan(10);
    // a physics "chapter" here is a unit holding more than one textbook chapter
    expect(physics?.children.some((unit) => /\band\b/i.test(unit.name))).toBe(true);
    expect(SUPERLATIVE.test('Ten chapters, which makes it the longest of the four')).toBe(true);
    expect(SUPERLATIVE.test('runs to more chapters than any other year')).toBe(true);
    expect(SUPERLATIVE.test("It holds more chapters than the year's mathematics")).toBe(true);
  });

  it('never prints a share of a paper the board did not publish', () => {
    const weighting =
      /\b(?:half|a third|a quarter|most)\s+(?:of\s+)?the\s+(?:paper|marks)\b|\bdecides?\s+most\s+(?:papers|results)\b|\bper\s?cent\b|%/i;
    expect(
      ENTRIES.filter(([, page]) =>
        weighting.test([page.opening, page.question, page.answer].join(' ')),
      ).map(([path]) => path),
    ).toEqual([]);
  });

  /**
   * A subject opening names at least two things its own page lists. Two, because one shared word
   * ("mathematics", "earth") is the subject's name rather than its syllabus, and an opening that
   * can say nothing more specific than that is describing a subject in general, which is the
   * opening a template would write.
   */
  it('opens every subject page on things that page actually lists', () => {
    const STOP = new Set(
      'the and of in an to for its it is as on with by from their this that these what how our your some part basic study introduction general principles concepts world'.split(
        ' ',
      ),
    );
    const stems = (text: string) =>
      new Set(
        plainWords(text)
          .filter((word) => word.length > 3 && !STOP.has(word) && !/^\d+$/.test(word))
          .map((word) => word.replace(/(ies|es|s|ing|al|ic|y)$/, '').slice(0, 6)),
      );
    const thin: string[] = [];
    for (const [path, page] of ENTRIES) {
      const place = nodeAt(path);
      if (place.kind !== 'subject') continue;
      const listed = new Set<string>();
      for (const chapter of place.node.children) {
        for (const stem of stems(chapter.name)) listed.add(stem);
        for (const topic of chapter.children)
          for (const stem of stems(topic.name)) listed.add(stem);
      }
      const named = [...stems(page.opening)].filter((stem) => listed.has(stem));
      if (named.length < 2) thin.push(`${path} names only [${named.join(', ')}] from its own list`);
    }
    expect(thin).toEqual([]);
  });
});
