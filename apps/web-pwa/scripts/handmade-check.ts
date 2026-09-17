/**
 * THE SIXTY-SEVEN, READ OFF THE FILES WE SHIP.
 *
 * docs/GROWTH-SEARCH.md §6: the 4 board pages, the 13 class pages and the 50 subject pages are
 * written one at a time and "never generated from a template with a name swapped".
 * `handmade.test.ts` holds that over the written paragraphs and `handmade.rendered.test.tsx` over
 * the component. This holds it over the HTML the pre-renderer actually wrote, which is what a
 * crawler and a parent receive, so a page that ships as the shared frame fails the build even if
 * both of those still pass.
 *
 * WHAT IS MEASURED. The text of each page's <main>, with every name in the syllabus tree and every
 * numeral masked (`handmade-measure.ts`), cut into six-word runs; a page's score is the share of
 * its runs that no other page of the 67 ships.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT (the closer's run, 2026-09-17). It proves a page is not
 * the shared frame with the names swapped: a page poured from one mould scores near nothing once
 * the names are masked. It does not prove a person wrote the page. Sixty-seven pages each written
 * separately by a model would share few runs and pass. That the 67 were written one at a time is
 * a fact about how they were made, held in review; this check only keeps the mould out.
 *
 * THE FLOOR IS 25%. Re-measure with `bun run scripts/handmade-check.ts` after a build, which
 * prints the lowest and the median over the files in `dist`. On 2026-09-17:
 *
 *   · the 67 as shipped                                   36.0% at worst, 45.3% median
 *   · the same files with the written block removed       15.7% at worst, 0.0% median
 *   · every page given one written block, names swapped    8.3% at worst, 0.0% median
 *
 * The two simulated lines are name-swap frames and nothing else; they were measured once by hand
 * and are not re-run here. 25% sits under the thinnest honest page (an ISC unit page, whose unit
 * names mask to the same placeholder as its sibling year's) and over the most a frame scored.
 */

import { handmadePaths } from '../src/screens/syllabus/handmade';
import { maskedWords, ownShares, runsOf } from '../src/screens/syllabus/handmade-measure';
import type { PageFile, Violation } from './prerender-check';
import { visibleText } from './prerender-check';

export const HANDMADE_OWN_FLOOR = 0.25;
const RUN = 6;

/** A board, class or subject address: /learn/<board>, /learn/<board>/<class>, or one deeper. */
export function isHandmadePath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts[0] === 'learn' && parts.length >= 2 && parts.length <= 4;
}

/** The words inside <main>, which is the page; the header and footer are the site. */
export function mainText(html: string): string {
  const main = html.match(/<main[\s\S]*<\/main>/i);
  return main ? visibleText(main[0]) : '';
}

export function checkHandmadePages(
  pages: readonly PageFile[],
  expected = handmadePaths().length,
): Violation[] {
  const chosen = pages.filter((page) => isHandmadePath(page.path));
  const bad: Violation[] = [];
  if (chosen.length !== expected) {
    bad.push({
      path: '/learn',
      what: `ships ${chosen.length} board, class and subject pages where ${expected} are written`,
    });
  }
  const scored = ownShares(
    chosen.map((page) => ({
      path: page.path,
      runs: runsOf(maskedWords(mainText(page.html)), RUN),
    })),
  );
  for (const row of scored) {
    if (row.own < HANDMADE_OWN_FLOOR) {
      bad.push({
        path: row.path,
        what:
          `is ${(row.own * 100).toFixed(1)}% its own words once names are masked, under the ` +
          `${HANDMADE_OWN_FLOOR * 100}% a written page clears: it reads as a template`,
      });
    }
  }
  return bad;
}

/** The spread of the shipped scores, for the header above and docs/GROWTH-SEARCH.md §6. */
export function spread(pages: readonly PageFile[]): {
  count: number;
  lowest: number;
  median: number;
} {
  const scores = ownShares(
    pages
      .filter((page) => isHandmadePath(page.path))
      .map((page) => ({ path: page.path, runs: runsOf(maskedWords(mainText(page.html)), RUN) })),
  )
    .map((row) => row.own)
    .sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  const median =
    scores.length === 0
      ? 0
      : scores.length % 2
        ? (scores[mid] as number)
        : ((scores[mid - 1] as number) + (scores[mid] as number)) / 2;
  return { count: scores.length, lowest: scores[0] ?? 0, median };
}

if (import.meta.main) {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { MANIFEST_FILE } = await import('./prerender-manifest');
  const app = join(import.meta.dir, '..');
  const manifestPath = join(app, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    console.error('No build to read. Run `bun run build` first.');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    pages: { path: string; file: string }[];
  };
  const pages: PageFile[] = manifest.pages.map((page) => ({
    path: page.path,
    file: page.file,
    html: readFileSync(join(app, 'dist', page.file), 'utf8'),
  }));
  const { count, lowest, median } = spread(pages);
  const bad = checkHandmadePages(pages);
  console.log(
    `${count} written pages, lowest ${(lowest * 100).toFixed(1)}%, median ` +
      `${(median * 100).toFixed(1)}%, floor ${HANDMADE_OWN_FLOOR * 100}%, ${bad.length} under`,
  );
  process.exit(bad.length ? 1 : 0);
}
