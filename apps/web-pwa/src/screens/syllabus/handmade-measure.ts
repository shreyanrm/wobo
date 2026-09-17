/**
 * HOW WE TELL A WRITTEN PAGE FROM A TEMPLATE WITH A NAME SWAPPED.
 *
 * docs/GROWTH-SEARCH.md §6 forbids generating the 67 board, class and subject pages "from a
 * template with a name swapped". Counting shared word runs catches a copied paragraph, and it
 * misses the template it was written against: a sentence like "<board> class <n> sets <k>
 * chapters of <subject>" differs from its sibling every few words, so no long run ever repeats
 * and each page looks unique because the swapped name is itself the unique part.
 *
 * So before comparing, every name the syllabus tree knows (board, class, subject, chapter) and
 * every numeral is replaced by one placeholder. What is left is the page's own sentence shape.
 * Two pages written one at a time still differ; two pages poured from one mould become identical.
 *
 * Used by `handmade.test.ts` (the written paragraphs) and by `scripts/handmade-check.ts` (the
 * shipped HTML, at build time), so the two readings cannot drift apart.
 */

import { boards } from './tree';

const NAME = '_name_';
const NUMBER = '_n_';

/** Lowercase words, punctuation dropped: two paragraphs that differ only in a comma are one. */
export function plainWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

let names: string[] | null = null;

/** Every name in the published tree down to the chapter, longest first so none is half-replaced. */
function treeNames(): string[] {
  if (names) return names;
  const found = new Set<string>();
  const add = (name: string) => {
    const key = plainWords(name).join(' ');
    if (key.length > 1) found.add(key);
  };
  for (const board of boards()) {
    add(board.short);
    add(board.name);
    for (const level of board.children) {
      add(level.name);
      for (const subject of level.children) {
        add(subject.name);
        for (const chapter of subject.children) add(chapter.name);
      }
    }
  }
  names = [...found].sort((a, b) => b.length - a.length);
  return names;
}

/** The words of a text with every tree name and every number replaced by a placeholder. */
export function maskedWords(text: string): string[] {
  let joined = ` ${plainWords(text).join(' ')} `;
  for (const name of treeNames()) joined = joined.split(` ${name} `).join(` ${NAME} `);
  return joined
    .split(' ')
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? NUMBER : word));
}

/** Every run of `size` consecutive words. */
export function runsOf(words: readonly string[], size: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) out.add(words.slice(i, i + size).join(' '));
  return out;
}

/**
 * For each page, the share of its runs that appear on no other page in the set. A page that is
 * mostly its own words scores high; a page that is the shared frame plus a swapped name scores
 * close to nothing once the names are masked.
 */
export function ownShares(
  pages: readonly { path: string; runs: ReadonlySet<string> }[],
): { path: string; own: number }[] {
  const seen = new Map<string, number>();
  for (const page of pages) for (const run of page.runs) seen.set(run, (seen.get(run) ?? 0) + 1);
  return pages.map((page) => {
    if (page.runs.size === 0) return { path: page.path, own: 0 };
    let own = 0;
    for (const run of page.runs) if (seen.get(run) === 1) own += 1;
    return { path: page.path, own: own / page.runs.size };
  });
}
