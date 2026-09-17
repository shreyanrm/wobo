/**
 * THE SIXTY-SEVEN WRITTEN PAGES, AS SHIPPED.
 *
 * `scripts/handmade-check.ts` runs inside the build over the files the pre-renderer just wrote.
 * This is the second reading of the same bytes, from `dist`, when a build has happened, and a
 * proof that doesn't need a build: that the check fails a family poured from one mould.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkHandmadePages, HANDMADE_OWN_FLOOR, isHandmadePath } from '../scripts/handmade-check';
import type { PageFile } from '../scripts/prerender-check';
import { reportViolations } from '../scripts/prerender-check';
import { MANIFEST_FILE, type PrerenderManifest } from '../scripts/prerender-manifest';
import { handmadePaths } from '../src/screens/syllabus/handmade';

const APP = join(import.meta.dir, '..');
const DIST = join(APP, 'dist');
const MANIFEST = join(APP, MANIFEST_FILE);

describe('the check that holds the sixty-seven apart', () => {
  it('knows exactly which addresses are the written ones', () => {
    expect(handmadePaths().every(isHandmadePath)).toBe(true);
    expect(isHandmadePath('/learn')).toBe(false);
    expect(isHandmadePath('/learn/cbse/class-10/mathematics/real-numbers')).toBe(false);
    expect(isHandmadePath('/subjects/mathematics')).toBe(false);
  });

  it('fails every page of a family poured from one mould with the names swapped', () => {
    const frame = (board: string, level: string, subject: string) =>
      `<html><body><header>Wobo</header><main><h1>${subject}, ${board} ${level}</h1>` +
      `<p>${board} ${level} sets its chapters of ${subject}. We hold them from the board's own ` +
      `document, and every one carries the page it came from and the day we read it.</p>` +
      `<h2>Is this what my child's school teaches?</h2><p>It is what the board published for ` +
      `this session, and a school may take it in its own order without changing the list.</p>` +
      `<p>Where this came from</p><p>Still wondering? Ask about ${subject}</p></main></body></html>`;
    const pages: PageFile[] = handmadePaths().map((path) => {
      const [, , board = '', level = '', subject = ''] = path.split('/');
      return { path, file: `${path.slice(1)}/index.html`, html: frame(board, level, subject) };
    });
    const bad = checkHandmadePages(pages);
    expect(bad.length).toBe(handmadePaths().length);
  });

  it('counts a missing written page as a failure too', () => {
    expect(checkHandmadePages([], 67).map((v) => v.path)).toEqual(['/learn']);
  });
});

const manifest: PrerenderManifest | null = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as PrerenderManifest)
  : null;

describe.skipIf(!manifest)('the sixty-seven in the last build', () => {
  it(`ships every one of them at least ${HANDMADE_OWN_FLOOR * 100}% its own words`, () => {
    const pages: PageFile[] = (manifest?.pages ?? []).map((page) => ({
      path: page.path,
      file: page.file,
      html: readFileSync(join(DIST, page.file), 'utf8'),
    }));
    const bad = checkHandmadePages(pages);
    expect(reportViolations(bad)).toBe('');
  });
});
