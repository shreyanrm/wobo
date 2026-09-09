/**
 * The record `scripts/prerender.ts` leaves behind: one entry per address it wrote, what that page
 * says about itself, and what a browser with JavaScript SWITCHED OFF actually found on the file.
 *
 * It is a type of its own so the build and `test/prerender.test.ts` cannot drift on the shape, and
 * so the test can assert against a measurement it did not take itself.
 */

export interface PrerenderedPage {
  /** The address the file answers at, e.g. `/about`. */
  path: string;
  /** Where it was written, relative to `dist`, e.g. `about/index.html`. */
  file: string;
  title: string;
  description: string;
  canonical: string;
  /** The share card drawn for this page, origin-relative. */
  image: string;
  /** The page's own <h1>, as the app rendered it. The emitted file has to carry the same one. */
  heading: string;
  /** Words in the emitted file. */
  words: number;
  /** What a real browser with JavaScript disabled read off the emitted file. */
  withoutJs: { heading: string; words: number };
}

/**
 * WHERE THE RECORD LIVES, AND WHY IT IS NOT IN `dist`.
 *
 * It used to be written to `dist/prerender.json`: 432KB of build bookkeeping, published at
 * https://heywobo.com/prerender.json because everything in the output directory is served. It is
 * an artefact of the build and not part of the site, it names every file the build wrote, and
 * nobody outside this repo has any use for it. It sits beside `dist` instead, where the build and
 * the tests read it and the host never sees it.
 */
export const MANIFEST_FILE = '.prerender.json';

export interface PrerenderManifest {
  /** The origin every canonical on this build points at. */
  origin: string;
  /** When the build ran, so a stale `dist` is visible rather than silent. */
  built: string;
  pages: PrerenderedPage[];
}
