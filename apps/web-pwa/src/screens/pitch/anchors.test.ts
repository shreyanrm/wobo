/**
 * NO DEAD CONTROL ON A PAGE THAT IS TRYING TO CONVERT (docs/SELL.md §8).
 *
 * `site/handoffs.test.ts` proves every close points at an address the ROUTER answers, and that no
 * page's only way forward is the header. It cannot prove the other half, because the other half is
 * not in the table: an in-page anchor is only a control if the page it belongs to actually has
 * that id. `#ask` in the subjects close and `#collect` in the security close are both real
 * conversions and both are one typo away from being a button that scrolls nowhere, on the two
 * pages where a reader is closest to deciding.
 *
 * So this walks it from the other end: every `#anchor` a page links to, and every `#anchor` its
 * close names, has to be an id on that page's own source.
 *
 * It also holds the two claims the subjects page is now allowed to make, because they are the ones
 * that would be expensive to get wrong: the finder is really on the page, and the sentence that
 * put an official syllabus behind every board in the registry is gone.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handoff, type PublicPage } from '../site/handoffs';

const SCREENS = join(import.meta.dir, '..');

/** Every public page this wave owns or shares a shell with, and the close it renders. */
const PAGES: readonly { page: PublicPage; file: string }[] = [
  { page: 'security', file: join('pitch', 'Security.tsx') },
  { page: 'meet', file: join('pitch', 'MeetWobo.tsx') },
  { page: 'parents', file: join('pitch', 'ForParents.tsx') },
  { page: 'students', file: join('pitch', 'ForStudents.tsx') },
  { page: 'how', file: join('pitch', 'HowItWorks.tsx') },
  { page: 'subjects', file: join('pitch', 'Subjects.tsx') },
  { page: 'about', file: join('site', 'About.tsx') },
];

const source = (file: string): string => readFileSync(join(SCREENS, file), 'utf8');

/** Every `id="…"` a page's own source sets, which is every anchor it can answer. */
function ids(text: string): Set<string> {
  return new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] as string));
}

/** Every in-page anchor the source links to. */
function anchors(text: string): string[] {
  return [...text.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] as string);
}

describe('every in-page anchor lands on something', () => {
  for (const { page, file } of PAGES) {
    it(`${file} answers every anchor it offers, and the one its close names`, () => {
      const text = source(file);
      const answered = ids(text);
      const close = handoff(page, true);
      const fromClose = [close.primary, close.quiet]
        .map((action) => action.href ?? '')
        .filter((href) => href.startsWith('#'))
        .map((href) => href.slice(1));
      const dead = [...new Set([...anchors(text), ...fromClose])].filter((id) => !answered.has(id));
      expect(dead, `${file} links to an anchor it does not carry`).toEqual([]);
    });
  }

  it('checks the two anchors a close actually depends on today', () => {
    // a guard on the guard: if these move out of the table this test quietly stops proving anything
    expect(handoff('subjects', true).quiet.href).toBe('#ask');
    // /security's second was `#collect`, an anchor back UP the page the reader had just finished,
    // so the only forward move off the trust page was the primary. It points at the documents now,
    // which is a step onward and the evidence the page cites all the way down (docs/SELL.md §6).
    expect(handoff('security', true).quiet.href).toBe('/legal');
  });
});

describe('the subjects page answers "does it cover mine" for real', () => {
  const text = source(join('pitch', 'Subjects.tsx'));

  it('ships the finder rather than a picture of one', () => {
    expect(text).toContain('<BoardFinder');
    // the prototype's still was `aria-hidden`, which is the shape of the bug: a control a reader
    // using a screen reader could not reach at all, on the page that qualifies them
    expect(text).not.toContain('className="sb-type" aria-hidden');
  });

  it('gives the finder a door, so finding your board ends in starting', () => {
    expect(text).toMatch(/<BoardFinder\s+door=/);
  });

  it('no longer puts an official syllabus behind every board in the registry', () => {
    expect(text).not.toContain("with the year's official syllabus behind it");
  });
});
