/**
 * EVERY PUBLIC ADDRESS IS A REAL FILE WITH REAL WORDS IN IT.
 *
 * Before `scripts/prerender.ts` existed, all 61 addresses in `public/sitemap.xml` returned the
 * identical 3,338-byte shell: no heading, no words, no links, one `<link rel="canonical">` pointing
 * at the root, and one og:title, so every page told a crawler it was the home page and every shared
 * link previewed as the home page (docs/GROWTH-SEARCH.md §2). The words existed only after
 * JavaScript ran, and the crawlers that feed the answer engines do not run JavaScript.
 *
 * This reads the emitted files the way one of those crawlers does: off disk, nothing executed, the
 * bytes as served. The build itself runs the same rules (`scripts/prerender-check.ts`) and fails on
 * any violation, so this is the second reading of the same evidence rather than the only one, and
 * it also checks what the build recorded from a REAL browser with JavaScript switched off.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkPrerenderedPages,
  firstHeading,
  hasNoScriptPath,
  INVITATION_FORM,
  type PageFile,
  reportViolations,
  sharedCanonicals,
  THIN_PAGES,
  WORD_FLOOR,
} from '../scripts/prerender-check';
import { MANIFEST_FILE, type PrerenderManifest } from '../scripts/prerender-manifest';

const APP = join(import.meta.dir, '..');
const DIST = join(APP, 'dist');
const MANIFEST = join(APP, MANIFEST_FILE);

/**
 * There is no `dist` until something has been built, and `bun run test` runs before `bun run
 * build` in the gate. When a build HAS happened the manifest must be there, and that is asserted
 * below rather than skipped: a `dist` with no pre-render in it is the exact regression this whole
 * file exists to catch.
 */
const built = existsSync(join(DIST, 'index.html'));

describe.skipIf(!built)('the build pre-rendered the public site', () => {
  it('left a manifest of every address it wrote', () => {
    expect(existsSync(MANIFEST)).toBe(true);
  });
});

const manifest: PrerenderManifest | null = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as PrerenderManifest)
  : null;

const pages: PageFile[] = (manifest?.pages ?? []).map((page) => ({
  path: page.path,
  file: page.file,
  html: readFileSync(join(DIST, page.file), 'utf8'),
}));

describe.skipIf(!manifest)('every page a crawler with no JavaScript opens', () => {
  it('covers every address the sitemap publishes, one file each', () => {
    const sitemap = readFileSync(join(APP, 'public', 'sitemap.xml'), 'utf8');
    const published = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
      (m[1] as string).replace(manifest?.origin ?? '', ''),
    );
    expect(published.length).toBeGreaterThan(0);
    expect([...pages].map((p) => p.path).sort()).toEqual([...published].sort());
  });

  it('reads as a finished page: a heading, its own words, its own address and its own card', () => {
    const bad = checkPrerenderedPages(pages, manifest?.origin ?? '');
    expect(reportViolations(bad)).toBe('');
    expect(bad).toEqual([]);
  });

  it('clears the word floor on every page that is not a door', () => {
    const thin = (manifest?.pages ?? []).filter(
      (p) => p.words < (THIN_PAGES[p.path] ?? WORD_FLOOR),
    );
    expect(thin).toEqual([]);
  });

  it('waives only the pages that still need waiving, and only by what they need', () => {
    // A waiver is a promise to come back to a page, and a promise nothing checks is one that gets
    // forgotten. `/sign-in`'s comment said it rendered 70 words; it renders 86. This reads the
    // number out of the build's own measurement, so a waived page that has since been written
    // properly, or one that has quietly got thinner, shows up here.
    for (const [path, floor] of Object.entries(THIN_PAGES)) {
      const page = (manifest?.pages ?? []).find((entry) => entry.path === path);
      expect([path, page !== undefined]).toEqual([path, true]);
      const words = page?.words ?? 0;
      expect([path, words >= floor]).toEqual([path, true]);
      // Still below the floor: a page that clears it does not need naming here any more.
      expect([path, words < WORD_FLOOR]).toEqual([path, true]);
    }
  });

  it('was measured in a browser with JavaScript switched off, not just parsed', () => {
    for (const page of manifest?.pages ?? []) {
      expect(page.withoutJs.heading.length).toBeGreaterThan(0);
      expect(page.withoutJs.words).toBeGreaterThanOrEqual(THIN_PAGES[page.path] ?? WORD_FLOOR);
    }
  });

  it('carries the markup of the page it names, and not another page’s', () => {
    const wrong = (manifest?.pages ?? [])
      .map((page, i) => ({ page, heading: firstHeading(pages[i]?.html ?? '') }))
      .filter(({ page, heading }) => heading !== page.heading)
      .map(({ page, heading }) => `${page.path}: "${heading}" not "${page.heading}"`);
    expect(wrong).toEqual([]);
  });

  it('ships the share card each page names', () => {
    const missing = (manifest?.pages ?? [])
      .map((page) => page.image)
      .filter((image) => !existsSync(join(DIST, image.replace(/^\//, ''))));
    expect(missing).toEqual([]);
  });
});

describe.skipIf(!manifest)('no two pages are the same page', () => {
  it('gives every address its own canonical, and no other address claims it', () => {
    const clashes = sharedCanonicals(pages);
    expect(reportViolations(clashes)).toBe('');
    expect(clashes).toEqual([]);
  });

  it('gives every address its own title and its own description', () => {
    const titles = (manifest?.pages ?? []).map((p) => p.title);
    const descriptions = (manifest?.pages ?? []).map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

/**
 * THE SITE AS A CRAWLER WALKS IT: only real pages, and every real page reachable.
 *
 * Two faults the pre-render left behind, both counted off the built site.
 *
 *  1. 712 ADDRESSES THE SITE LINKED AND THE BUILD DID NOT WRITE. Every chapter page linked each of
 *     its topics — 711 of them — and no topic page is published (`PUBLISHED_LAYERS`), so each one
 *     answered 200 with the wordless SPA shell. The 712th was `/landing`, which 604 of the 605
 *     pages linked from the wordmark in the header and the wordmark in the footer, while only 3
 *     linked `/`. A crawler following our links found more empty addresses than real pages.
 *  2. NINE REAL PAGES NOTHING LINKED. /subjects/biology through /subjects/social-science were in
 *     the sitemap and orphaned everywhere else, including on /subjects, which is their parent.
 */
const APP_DOORS = new Set([
  // The signup funnel. It is the app, not a page: `Start free` opens it, it is not in the sitemap
  // and `vercel.json` rewrites it to the shell on purpose.
  '/onboarding',
  // The same, one step further along: /gift's "Choose a gift" opens the checkout. Its own words
  // are that paying is not open yet, which is a thing to tell a buyer standing in front of it and
  // not a thing to ask an engine to index (`screens/states/routes.ts`).
  '/plans/checkout',
  // The parent's door (screens/parent). The two learner doors point a parent at it; it is the
  // parent account's own host, private, and rewritten to the shell like /onboarding.
  '/parent',
]);

/** Every internal address a published page points at, and which pages point at it. */
function internalLinks(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const page of pages) {
    const body = page.html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? page.html;
    for (const link of body.matchAll(/<a\b[^>]*?href="(\/[^"]*)"/g)) {
      const target = ((link[1] as string).split('#')[0]?.split('?')[0] ?? '').replace(
        /(.)\/+$/,
        '$1',
      );
      if (!target) continue;
      out.set(target, (out.get(target) ?? new Set()).add(page.path));
    }
  }
  return out;
}

describe.skipIf(!manifest)('the site as a crawler walks it', () => {
  const links = internalLinks();
  const published = new Set(pages.map((page) => page.path));

  it('points at no address the build did not write', () => {
    const bad = [...links]
      .filter(([target]) => !published.has(target) && !APP_DOORS.has(target))
      // A real file that is not a page: the blog's feed. It is fetched, never read as a page.
      .filter(([target]) => !existsSync(join(DIST, target.replace(/^\//, ''))))
      .map(([target, from]) => `${target} (linked from ${[...from].slice(0, 3).join(', ')})`);
    expect(bad).toEqual([]);
  });

  it('leaves no published page that no other page links to', () => {
    const orphans = pages
      .map((page) => page.path)
      // The front page is the root: it is what a crawler starts from and what the sitemap leads
      // with, so nothing has to link it for it to be found.
      .filter((path) => path !== '/')
      .filter((path) => ![...(links.get(path) ?? [])].some((from) => from !== path));
    expect(orphans).toEqual([]);
  });
});

/**
 * WHAT RIDES ALONG ON EVERY PAGE, AND WHAT MUST NOT.
 *
 * Three things did. `index.html` carries 1,576 bytes of notes to whoever edits it next — repo
 * paths, the CSP reasoning, which token file two colours come from — and every one of the 605
 * pages shipped a copy: about 950KB of commentary across the site, handing any reader the source
 * layout. Those comments carried the only three em dashes on every page, which the voice law bans
 * from anything a person reads (docs/copy/voice.md). And every page declared `lang="en"` while its
 * own JSON-LD said `inLanguage: en-IN` and its og:locale said `en_IN`, on a site whose whole
 * strategy is winning India rather than the bare word (docs/GROWTH-ENTITY.md).
 */
describe.skipIf(!manifest)('what every page carries besides its words', () => {
  it('declares the English it is written in, which is the market it is for', () => {
    const wrong = pages
      .filter((page) => !/<html[^>]*\blang="en-IN"/.test(page.html))
      .map((page) => page.path);
    expect(wrong).toEqual([]);
  });

  it('ships none of the source’s own commentary, only the one line saying how it was made', () => {
    const noisy = pages
      .map((page) => ({
        path: page.path,
        found: [...page.html.matchAll(/<!--[\s\S]*?-->/g)]
          .map((m) => m[0] as string)
          .filter((c) => !c.includes('pre-rendered by')),
      }))
      .filter((page) => page.found.length > 0)
      .map((page) => `${page.path}: ${page.found[0]?.slice(0, 60)}`);
    expect(noisy).toEqual([]);
  });

  it('carries no em dash anywhere in the bytes, which is where they were hiding', () => {
    expect(pages.filter((page) => page.html.includes('—')).map((page) => page.path)).toEqual([]);
  });
});

describe.skipIf(!built)('the shell that is left for everything else', () => {
  it('is a file of its own, so a real page always wins the rewrite', () => {
    expect(existsSync(join(DIST, 'app.html'))).toBe(true);
  });

  it('asks not to be indexed, because it is the fallback and says nothing', () => {
    const shell = readFileSync(join(DIST, 'app.html'), 'utf8');
    expect(shell).toContain('name="robots"');
    expect(shell).toContain('noindex');
  });

  it('is what vercel.json rewrites the app’s own addresses to, and nothing wider', () => {
    const vercel = JSON.parse(readFileSync(join(APP, '..', '..', 'vercel.json'), 'utf8')) as {
      rewrites: { source: string; destination: string }[];
    };
    const toShell = vercel.rewrites.filter((r) => r.destination === '/app.html');
    expect(toShell.length).toBeGreaterThan(0);
    // The blanket `/(.*)` is gone: it made every missing page and every missing asset a 200 with
    // this shell in it. The shell is now the fallback for the addresses the APP owns, and a path
    // nobody owns falls through to `dist/404.html` (scripts/notfound.ts, test/addresses.test.ts).
    expect(toShell.some((r) => r.source === '/(.*)')).toBe(false);
    expect(toShell.some((r) => r.source === '/you')).toBe(true);
  });

  it.skipIf(!existsSync(join(DIST, 'sw.js')))(
    'is what the service worker answers a navigation with, so no page is served as the front page',
    () => {
      const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
      // The pre-render turns `index.html` into the front page. With the fallback still named after
      // it, every navigation a returning visitor made was answered out of the precache with the
      // home page's markup, at every address on the site.
      expect(sw).toContain('createHandlerBoundToURL("app.html")');
      expect(sw).not.toContain('createHandlerBoundToURL("index.html")');
      // And the front page is not precached under a revision that stopped describing its bytes the
      // moment the pre-render rewrote them.
      expect(sw).not.toMatch(/url:"index\.html"/);
      expect(sw).toMatch(/url:"app\.html"/);
    },
  );

  it('is followed by the step that writes the 404, every time the site is built', () => {
    const pkg = readFileSync(join(APP, 'package.json'), 'utf8');
    expect(pkg).toContain('bun run prerender && bun run notfound');
  });

  // Gated on the file rather than on `built`, because a hand-run `vite build && prerender` (which
  // is how this step is developed) stops one short of it. `bun run build` never does, and the
  // assertion above is what holds that.
  it.skipIf(!existsSync(join(DIST, '404.html')))(
    'leaves a 404 that is a real page, so a missing address says so with nothing running',
    () => {
      const html = readFileSync(join(DIST, '404.html'), 'utf8');
      expect(html).toContain('name="robots" content="noindex"');
      expect(html).not.toContain('rel="canonical"');
      expect(html).toContain('<div id="root"><');
      const text = html
        .slice(html.indexOf('<div id="root">'))
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      expect(text.split(' ').filter(Boolean).length).toBeGreaterThan(15);
      // AND A WAY OUT, that works with nothing running. Both doors used to be
      // `<button type="button">`, which does nothing at all with JavaScript off, so the one page
      // written for that exact reader had no links in and no links out.
      const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      expect(hrefs).toContain('/');
    },
  );
});

/**
 * A READER WITH NOTHING RUNNING IS NEVER THROWN OFF THE SITE.
 *
 * The invitation's form posts JSON from JavaScript to another hostname. A native submit of it is
 * form-encoded and cross-origin, so with JavaScript off pressing the button lands the reader on a
 * raw error page on a host that is not ours, with no header, no footer and no way back. The panel
 * carries a `noscript` block that hides the form and puts one address in its place, and this is
 * where it is proven to have survived the build: React renders that block into a live DOM, and a
 * `noscript` element's children do not come back out of `innerHTML` on their own, so the pages
 * shipped with an EMPTY `<noscript></noscript>` and the trap fully armed.
 */
describe('the no-JavaScript path out of the invitation', () => {
  const FORM = `<form class="jl-form" method="post" action="https://api.example.com/v1/waiting-list">`;
  const WAY_OUT =
    '<noscript><style>.jl-form{display:none}</style>' +
    '<p><a href="mailto:support@heywobo.com">support@heywobo.com</a></p></noscript>';

  it('is required of any page that carries the form', () => {
    expect(hasNoScriptPath(`<main>${FORM}</form></main>`)).toBe(false);
    expect(hasNoScriptPath(`<main>${FORM}</form>${WAY_OUT}</main>`)).toBe(true);
  });

  it('is not required of a page that carries no form', () => {
    expect(hasNoScriptPath('<main><h1>A chapter</h1></main>')).toBe(true);
  });

  it('is not satisfied by an empty noscript, which is what the build used to emit', () => {
    expect(hasNoScriptPath(`<main>${FORM}</form><noscript></noscript></main>`)).toBe(false);
  });

  it('is not satisfied by an address with the form still pressable beside it', () => {
    const half = '<noscript><p><a href="mailto:support@heywobo.com">write</a></p></noscript>';
    expect(hasNoScriptPath(`<main>${FORM}</form>${half}</main>`)).toBe(false);
  });

  it('names the class the panel actually uses', () => {
    expect(INVITATION_FORM).toBe('jl-form');
  });
});

describe.skipIf(!manifest)('every built page that carries the invitation', () => {
  it('carries the way out of it too', () => {
    const stranded = pages.filter((page) => !hasNoScriptPath(page.html)).map((page) => page.path);
    expect(stranded, 'a native submit here throws the reader onto another hostname').toEqual([]);
  });

  it('was actually built with the invitation on it, so this proves something', () => {
    const withForm = pages.filter((page) => page.html.includes(INVITATION_FORM));
    expect(withForm.length).toBeGreaterThan(0);
  });
});
