/**
 * THE OWNER'S TEST, MOVED TO WHERE A READER ACTUALLY STANDS.
 *
 * docs/GROWTH-SEARCH.md §6 is an owner ruling: the 4 board pages, the 13 class pages and the 50
 * subject pages "are never generated from a template with a name swapped, and a test asserts that
 * no two of them share a paragraph."
 *
 * `handmade.test.ts` already holds the written half of that, and holds it hard: no two of the 67
 * entries in `handmade.ts` share a paragraph, a sentence, or a six-word run. But it reads the
 * SOURCE, and a source file full of unique paragraphs proves nothing about the page. Three ways the
 * family could go back to being generated while every assertion in that file still passed:
 *
 *   · `Syllabus.tsx` stops rendering the written block, or renders it behind a condition that stops
 *     being true. `handmade.ts` stays perfect and all 67 pages become the shared frame.
 *   · The block renders on ONE page and not the rest. `markup.test.tsx` proves the ordering of the
 *     written block on `cbse/class-10/mathematics` alone, so 66 of the 67 could lose it silently.
 *   · A page is written so close to its sibling that it clears the six-word rule on a technicality
 *     while a parent reading both would find one page.
 *
 * So this file asserts over the MARKUP the real component produces, for all 67, and it asserts a
 * FRACTION rather than the existence of one unique run. `pages.test.ts` already requires every
 * published page to ship "a run of words that no other page ships", and a template with a name
 * swapped passes that trivially: the swapped name is itself the unique run.
 *
 * THE THRESHOLD, AND WHY IT IS THIS NUMBER. It was measured, not chosen. Counting six-word runs
 * over the rendered body of all 67 and asking what share of each page's runs appear on no other:
 *
 *   · every page as written today            59.8% to 93.0%   (worst: isc/class-11/mathematics)
 *   · the same page given its sibling's
 *     written block with the name swapped    13.2%
 *   · the same page with the written block
 *     removed, leaving the generated frame   24.8%
 *
 * The floor is 45%. It sits 15 points under the worst page that is genuinely written, which is the
 * room a future honest page needs: the two ISC mathematics years legitimately share the Council's
 * own unit vocabulary (algebra, trigonometry, calculus, statistics) on top of the navigational
 * frame §6 expressly permits, and that is the densest the family gets. It sits at nearly twice the
 * 24.8% a page scores when the written block is gone, which is what "generated from a template"
 * means in practice. A number tight enough to fail on frame alone would fail an honest page in a
 * dense family; a number under 25% would pass the exact regression this file exists to catch.
 *
 * No browser. The component is rendered to static markup the way `markup.test.tsx` does it, so this
 * runs in the normal test pass rather than only after a build.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider } from '../../shell/router';
import { addressFrom } from './address';
import { HANDMADE } from './handmade';
import { releasedPages } from './pages';
import { SyllabusBody } from './Syllabus';
import { find, type Place } from './tree';

/** The floor, and the measurement behind it is in the comment at the top of this file. */
const OWN_RUN_FLOOR = 0.45;

/** Six words: short enough that a swapped name cannot carry a paragraph over the line. */
const RUN = 6;

const SIXTY_SEVEN: { path: string; place: Place }[] = releasedPages()
  .filter((page) => page.layer === 'board' || page.layer === 'class' || page.layer === 'subject')
  .map((page) => {
    const address = addressFrom(page.path.split('/').filter(Boolean).slice(1));
    const place = address ? find(address) : null;
    if (!place) throw new Error(`no place behind ${page.path}`);
    return { path: page.path, place };
  });

/**
 * The page as a reader meets it: the real component, rendered, with the markup taken back out.
 * The entities are DECODED rather than blanked, because React writes every apostrophe in these
 * paragraphs as `&#x27;` and a blanked entity would make a written paragraph look absent when it
 * is on the page.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#34;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

function rendered(place: Place): string {
  return renderToStaticMarkup(
    <RouterProvider initial={{ name: 'landing' }}>
      <SyllabusBody place={place} freshness="built" door={<div />} />
    </RouterProvider>,
  )
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?%)\]])/g, '$1')
    .trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function runsOf(text: string): Set<string> {
  const all = words(text);
  const out = new Set<string>();
  for (let i = 0; i + RUN <= all.length; i += 1) out.add(all.slice(i, i + RUN).join(' '));
  return out;
}

const PAGES = SIXTY_SEVEN.map((row) => ({ ...row, text: rendered(row.place) }));

describe('the sixty-seven pages, as a reader actually meets them', () => {
  it('renders one for every board, class and subject page this build publishes', () => {
    expect(PAGES.length).toBe(67);
  });

  /**
   * The assertion `markup.test.tsx` makes for one page, made for all of them. If the written block
   * stops reaching the page, this is the test that says so.
   */
  it('puts every page its own written opening, question and answer', () => {
    const lost: string[] = [];
    for (const page of PAGES) {
      const written = HANDMADE[page.path];
      if (!written) {
        lost.push(`${page.path}: nothing written for it`);
        continue;
      }
      for (const field of ['opening', 'question', 'answer'] as const) {
        const want = written[field].replace(/\s+/g, ' ').trim();
        if (!page.text.includes(want)) lost.push(`${page.path}: .${field} never reaches the page`);
      }
    }
    expect(lost).toEqual([]);
  });

  /** A paragraph written for one address and showing up at a second is the swap, caught in the act. */
  it('lets no written paragraph appear on a page it was not written for', () => {
    const strays: string[] = [];
    for (const [path, written] of Object.entries(HANDMADE)) {
      for (const field of ['opening', 'question', 'answer'] as const) {
        const want = written[field].replace(/\s+/g, ' ').trim();
        for (const page of PAGES) {
          if (page.path !== path && page.text.includes(want)) {
            strays.push(`${path}.${field} also renders on ${page.path}`);
          }
        }
      }
    }
    expect(strays).toEqual([]);
  });

  /**
   * THE ONE THAT FAILS IF A FUTURE PAGE IS GENERATED FROM A TEMPLATE. Not "does this page say one
   * thing nobody else says" but "how much of this page is its own", which is the question a parent
   * reading two of them would be asking.
   */
  it('gives every one of them a rendered body that is mostly its own words', () => {
    const seen = new Map<string, number>();
    for (const page of PAGES) {
      for (const run of runsOf(page.text)) seen.set(run, (seen.get(run) ?? 0) + 1);
    }
    const thin = PAGES.map((page) => {
      const mine = runsOf(page.text);
      const own = [...mine].filter((run) => seen.get(run) === 1).length / mine.size;
      return { path: page.path, own };
    })
      .filter((row) => row.own < OWN_RUN_FLOOR)
      .sort((a, b) => a.own - b.own)
      .map((row) => `${row.path}: ${(row.own * 100).toFixed(1)}% its own, floor is ${OWN_RUN_FLOOR * 100}%`);
    expect(thin).toEqual([]);
  });
});
