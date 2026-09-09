/**
 * THE PRE-RENDERED PAGES CARRY THE INVITATION, NOT THE OLD DOOR.
 *
 * `docs/DOORS-CLOSED.md`, owner 2026-09-09. 438 public files are written by the build and read off
 * disk by the crawlers that feed the answer engines, with nothing executing. So the state those
 * files are written in IS the site, for every visitor who arrives from a search and for every
 * machine that summarises us. A build that wrote "Start free" onto four hundred pages while the
 * gateway refuses every account would be inviting a stranger through a door that is bolted.
 *
 * This reads the emitted bytes the way one of those crawlers does. `scripts/prerender.ts` reads the
 * dial ONCE per build and seeds it into every render, so the files agree with each other and with
 * the switch as it stood; what is asserted here is the consequence:
 *
 *  1. `/sign-up` is the invitation: a real form, an email field, and the plain sentence.
 *  2. No file names the address that creates an account.
 *  3. Every file that carries a door carries the invitation's words.
 *
 * It skips when nothing has been built, exactly as `prerender.test.ts` does: `bun run test` runs
 * before `bun run build` in the gate, and a skipped read is honest where an invented one is not.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, type PrerenderManifest } from '../scripts/prerender-manifest';
import { LIST } from '../src/screens/site/invitation';

const APP = join(import.meta.dir, '..');
const DIST = join(APP, 'dist');
const MANIFEST = join(APP, MANIFEST_FILE);

const manifest: PrerenderManifest | null =
  existsSync(join(DIST, 'index.html')) && existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as PrerenderManifest)
    : null;

const pages = (manifest?.pages ?? [])
  .filter((page) => existsSync(join(DIST, page.file)))
  .map((page) => ({ path: page.path, html: readFileSync(join(DIST, page.file), 'utf8') }));

/** The words a reader sees, with the markup taken out. */
function words(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe.skipIf(!manifest)('the pre-rendered site, with the door closed', () => {
  it('wrote a file for every address, and read at least the sign-up one', () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(pages.map((p) => p.path)).toContain('/sign-up');
  });

  it('stands the invitation where the door was, in the markup and not behind a script', () => {
    const page = pages.find((p) => p.path === '/sign-up');
    expect(page, 'the sign-up address must be pre-rendered').toBeDefined();
    const html = page?.html ?? '';
    const said = words(html);
    expect(said).toContain(LIST.title);
    expect(said).toContain(LIST.promise);
    // a real form, present before anything runs
    expect(html).toMatch(/<form[^>]*method="post"/i);
    expect(html).toMatch(
      /<input[^>]*type="email"[^>]*required|<input[^>]*required[^>]*type="email"/i,
    );
    expect(html).toMatch(/<button[^>]*type="submit"/i);
  });

  it('offers no way to create an account, on any page a crawler can reach', () => {
    const guilty = pages.filter((page) => /href="\/onboarding/.test(page.html)).map((p) => p.path);
    expect(guilty, 'a pre-rendered page pointing at the first run is an open door').toEqual([]);
  });

  it('says the same thing about when, wherever it says anything about it', () => {
    const doors = pages.filter((page) => page.html.includes(LIST.label));
    expect(doors.length, 'the invitation must reach the public pages').toBeGreaterThan(10);
    // and never a queue or an invented scarcity, anywhere on the site. The pattern names only
    // phrases that cannot be innocent: the help centre PROMISES no countdown and no streak
    // pressure, in those words, and a scan that fired on a promise not to do a thing would be
    // teaching writers to stop making the promise.
    for (const page of pages) {
      const said = words(page.html);
      expect([
        page.path,
        /first in line|spots? left|places? left|you are number \d/i.test(said),
      ]).toEqual([page.path, false]);
    }
  });
});
