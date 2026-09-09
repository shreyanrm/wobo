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
import { HANDMADE, handmade, handmadePaths } from './handmade';
import { releasedPages } from './pages';

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
