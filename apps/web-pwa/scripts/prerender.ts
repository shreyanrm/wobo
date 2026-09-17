/**
 * Build step: ONE REAL HTML FILE PER PUBLIC ADDRESS.
 *
 * What was wrong, exactly (docs/GROWTH-SEARCH.md §2). `vercel.json` rewrote every path to the one
 * `index.html`, and the app rendered client-side, so all 61 addresses in `public/sitemap.xml`
 * returned the identical 3,338-byte shell: no heading, no words, no links, a `<link rel="canonical">
 * ` hardcoded to the root and one og:title. The crawlers that feed ChatGPT, Perplexity and Claude
 * do not run JavaScript, so the site could not be read at all, and every shared link previewed as
 * the home page. Meanwhile every competitor in the category has ceded school search to decaying
 * content farms, so the pages are already written, lawyered and voice-checked and nobody has read
 * one. This is the step that lets them be read.
 *
 * How it works, and why this way:
 *
 *  · The addresses come from `src/screens/states/routes.ts` — the SAME list `scripts/sitemap.ts`
 *    publishes — expanded with every compiled help article and every legal document. A page the
 *    sitemap promises and the build did not render is a 200 with nothing on it, so the two lists
 *    are one list.
 *  · The pages are rendered by the REAL app, in the REAL browser, against the REAL bundle. Nothing
 *    here re-implements a screen, so a page cannot be pre-rendered into something the app does not
 *    actually show.
 *  · The head is written by `headFor` in `shell/router.tsx`, which is what the running app writes
 *    its head from. The build asks the same function about the same route object, and asserts that
 *    the canonical the app wrote at runtime is the one it was given, so the file and the app can
 *    never disagree about the address of record.
 *  · The title and the opening words are the PAGE'S OWN, read back off the render. Nothing here
 *    invents copy for a page, so a page cannot be described by a line nobody reviewed.
 *  · The shell is kept as `app.html` and left as the rewrite target, with a `noindex` on it, so
 *    every private app route and every unknown path still boots the SPA while a real file wins for
 *    everything published. Vercel checks the filesystem before it applies a rewrite.
 *
 * ONE CONSEQUENCE WORTH KNOWING. `dist/index.html` stops being the shell and becomes the front
 * page, and the service worker's navigation fallback still names it (vite-plugin-pwa's default).
 * So an INSTALLED app opening a deep link cold paints the front page's markup for the moment before
 * React takes the root over, where it used to paint nothing. Pointing the fallback at `app.html`
 * instead would be the tidy fix, and it cannot be done from the Vite config: `app.html` does not
 * exist when workbox builds its precache manifest, and a fallback workbox has not precached throws.
 * Nothing is broken by it (the router reads the address and renders the right screen either way),
 * and no crawler is involved, so it is left as a note rather than fixed badly.
 *
 * EACH PAGE ALSO CARRIES THE ENTITY GRAPH. Three products share the name Wobo and ours was the
 * only one whose site never said, in a form a machine reads, what it is or who publishes it: the
 * same audit counted `0` `script[type="application/ld+json"]` elements site-wide. So every file
 * written here carries one, built by `src/shell/jsonld.ts`: Organization (with the `sameAs` graph
 * from `src/shell/profiles.ts`, the single home for the listings we hold), WebSite, a
 * BreadcrumbList on every page below the root, and SoftwareApplication on the home and plans
 * pages. Nothing Google has retired is declared, and the naming law is enforced rather than
 * assumed (docs/GROWTH-ENTITY.md §2).
 *
 * AND THE TWO SEARCH CONSOLES' VERIFICATION FILES, from the build environment
 * (`src/shell/verification.ts`), so the owner can prove the domain by setting a variable on the
 * host rather than by shipping a commit.
 *
 * Run: `bun run scripts/prerender.ts` (wired into `bun run build`, after `vite build`).
 * The step is strict: any page that reads as empty, claims the wrong address, repeats another
 * page's title (`scripts/prerender-check.ts`) or declares the wrong entity
 * (`scripts/jsonld-check.ts`) FAILS THE BUILD.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import help from '../src/screens/site/content/help.json' with { type: 'json' };
import { DIAL_SEED, readDial } from '../src/screens/site/dial';
import { expandPublicRoutes, type PublicRoute } from '../src/screens/states/routes';
import {
  absoluteUrl,
  describeFrom,
  escapeHtml,
  normaliseOrigin,
  OG_HEIGHT,
  OG_WIDTH,
  ogImagePath,
  renderHeadTags,
} from '../src/shell/head';
import { crumbName, renderJsonLd, structuredDataFor } from '../src/shell/jsonld';
import { headFor, type Route, routeFromPath } from '../src/shell/router';
import { verificationFiles } from '../src/shell/verification';
import { checkHandmadePages } from './handmade-check';
import { checkStructuredData, extractJsonLd, nodesOfType } from './jsonld-check';
import { leadParagraphs } from './lead';
import { checkPrerenderedPages, reportViolations, sharedCanonicals } from './prerender-check';
import { MANIFEST_FILE, type PrerenderedPage, type PrerenderManifest } from './prerender-manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const DIST = join(APP, 'dist');
const LEGAL_DIR = join(APP, '..', '..', 'docs', 'legal');
const SHELL = join(DIST, 'index.html');
/** The rewrite target: the untouched shell, kept under its own name so a real file can win. */
const FALLBACK = join(DIST, 'app.html');

/** How long one page gets to settle before the build gives up on it and says so. */
const SETTLE_MS = 30_000;

/**
 * The mark every emitted page carries, and the reason it exists.
 *
 * This step REPLACES `dist/index.html` with the front page. Run twice without a fresh `vite build`
 * in between and the shell it reads is no longer a shell: it is the front page, its root is no
 * longer empty, so every other page's markup would be dropped on the floor and 60 files would be
 * written with the front page's body under their own titles. Every check would pass, because every
 * check would be reading a page that reads perfectly well and is the wrong page. So a second run
 * on the same build stops instead.
 */
const STAMP = '<!-- pre-rendered by apps/web-pwa/scripts/prerender.ts -->';

// --- the addresses ------------------------------------------------------------------------------

function helpArticles(): { group: string; slug: string }[] {
  return (help.groups as { slug: string; articles: { slug: string }[] }[]).flatMap((group) =>
    group.articles.map((article) => ({ group: group.slug, slug: article.slug })),
  );
}

function legalSlugs(): string[] {
  return readdirSync(LEGAL_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function publicRoutes(): PublicRoute[] {
  return expandPublicRoutes({ helpArticles: helpArticles(), legalSlugs: legalSlugs() });
}

// --- the shell ----------------------------------------------------------------------------------

/** Tags the shell carries for the whole site, replaced per page by the ones the page earns. */
const SHELL_TAGS = [
  /<title[^>]*>[\s\S]*?<\/title>/gi,
  /<meta\b[^>]*\bname=["']description["'][^>]*>/gi,
  /<meta\b[^>]*\bname=["']robots["'][^>]*>/gi,
  /<link\b[^>]*\brel=["']canonical["'][^>]*>/gi,
  /<meta\b[^>]*\bproperty=["']og:[^"']*["'][^>]*>/gi,
  /<meta\b[^>]*\bname=["']twitter:[^"']*["'][^>]*>/gi,
];

/**
 * THE SOURCE'S COMMENTARY DOES NOT SHIP.
 *
 * `index.html` carries 1,576 bytes of notes to whoever edits it next: why the theme-color meta
 * exists in both schemes, which token file the two colours come from, why the .ico is a real file,
 * why no font CDN is in the CSP. Every word of that is worth having in the source and none of it
 * is worth sending 605 times: about 950KB of comments across the built site, handing any reader
 * the repo's layout, and carrying the only three em dashes on every page (docs/copy/voice.md).
 * The stamp this step writes is added after the strip, so the one comment on the page is the one
 * that says how the page was made.
 */
const COMMENTS = /<!--[\s\S]*?-->/g;

function stripShellTags(html: string): string {
  let out = html.replace(COMMENTS, '');
  for (const shape of SHELL_TAGS) out = out.replace(shape, '');
  return out.replace(/^[ \t]*\r?\n/gm, '');
}

/**
 * The page, assembled: the shell with its site-wide head tags taken out and this page's own put
 * in, the stylesheets the app loaded at runtime declared up front so the file reads correctly with
 * nothing executed, and the rendered markup inlined into the root the app hydrates into.
 */
function assemble(
  shell: string,
  parts: { tags: string; styles: string; linked: string; body: string; path: string },
): string {
  const head = `${parts.styles}\n${parts.tags}\n${parts.linked}\n  </head>`;
  const root = '<div id="root"></div>';
  const withHead = stripShellTags(shell).replace(/\s*<\/head>/i, `\n${head}`);
  if (!withHead.includes(root)) {
    throw new Error(`prerender: ${parts.path} found no empty root to render into in the shell.`);
  }
  return `${STAMP}\n${withHead.replace(root, `<div id="root">${parts.body}</div>`)}`;
}

// --- the share card -----------------------------------------------------------------------------

interface Palette {
  paper: string;
  ink: string;
  soft: string;
  pigment: string;
  line: string;
}

/**
 * The card a share of this page shows: the page's own title and its own opening line, on the
 * product's own paper, in the product's own two faces. One per address, so a link to a chapter
 * never previews as the home page again.
 */
function cardHtml(
  stylesheets: readonly string[],
  palette: Palette,
  page: { title: string; description: string; path: string },
): string {
  const links = stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('');
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8">${links}<style>
    html, body { margin: 0; padding: 0; }
    body {
      width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px; background: ${palette.paper};
      color: ${palette.ink}; font-family: Poppins, 'Plus Jakarta Sans Variable', system-ui, sans-serif;
      display: flex; flex-direction: column; justify-content: space-between;
      padding: 72px 80px; box-sizing: border-box; overflow: hidden;
    }
    .mark { display: flex; align-items: center; gap: 18px; font-weight: 700; font-size: 36px; letter-spacing: -0.02em; color: ${palette.pigment}; }
    .mark img { width: 54px; height: 54px; border-radius: 50%; display: block; }
    .say { margin-top: auto; padding-bottom: 56px; }
    h1 {
      font-size: 68px; line-height: 1.08; font-weight: 700; letter-spacing: -0.03em;
      margin: 0; max-height: 3.3em; overflow: hidden; text-wrap: balance;
    }
    p {
      font-size: 27px; line-height: 1.45; color: ${palette.soft}; margin: 22px 0 0;
      max-height: 2.9em; overflow: hidden; text-wrap: pretty;
    }
    .foot {
      display: flex; align-items: baseline; justify-content: space-between;
      border-top: 1px solid ${palette.line}; padding-top: 22px; font-size: 24px; color: ${palette.soft};
    }
    .hand { font-family: 'Caveat Variable', Caveat, cursive; font-size: 34px; color: ${palette.pigment}; }
  </style></head><body>
    <div class="mark"><img src="/favicon.svg" alt="">Wobo</div>
    <div class="say"><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.description)}</p></div>
    <div class="foot"><span>heywobo.com${page.path === '/' ? '' : escapeHtml(page.path)}</span><span class="hand">a tutor that draws</span></div>
  </body></html>`;
}

// --- the run ------------------------------------------------------------------------------------

/**
 * One page's turn at the browser, retried once.
 *
 * A build that renders 61 pages twice takes 122 navigations, and a single one of them timing out
 * would fail a deploy over nothing. One retry, said out loud, is the difference between a flake and
 * an outage; a second failure is real and stops the build with the address named.
 */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (first) {
    process.stdout.write(`\nprerender: ${what} did not settle, trying once more\n`);
    try {
      return await run();
    } catch (second) {
      throw new Error(`prerender: ${what} failed twice: ${(second as Error).message}`, {
        cause: first,
      });
    }
  }
}

/** What one page told the build about itself, read back off its own render. */
interface Rendered {
  title: string;
  /** The page's own <h1>, kept so the emitted file can be proved to be THIS page. */
  heading: string;
  canonical: string | null;
  body: string;
  styles: string;
  stylesheets: string[];
  palette: Palette;
}

async function main(): Promise<void> {
  if (!existsSync(SHELL)) {
    throw new Error(`prerender: no ${SHELL}. Run \`vite build\` first.`);
  }
  const shellBytes = readFileSync(SHELL, 'utf8');
  if (shellBytes.includes(STAMP)) {
    throw new Error(
      'prerender: dist/index.html is already a pre-rendered page, not the shell. Run `vite build` again before pre-rendering.',
    );
  }
  // FIRST, before index.html becomes a real page: keep the shell under its own name. It stays the
  // rewrite target for every private app route and every unknown path, and it carries a `noindex`
  // because it is a fallback with nothing on it.
  const shell = shellBytes;
  writeFileSync(
    FALLBACK,
    shell.replace(/\s*<\/head>/i, '\n    <meta name="robots" content="noindex">\n  </head>'),
    'utf8',
  );

  const routes = publicRoutes();
  /** The runtime-injected CSS, deduplicated: several pages inject the very same stylesheet. */
  const sheets = new Map<string, string>();
  let card = '<!doctype html><title>card</title>';

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (path === '/__card.html') {
        return new Response(card, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      // Wrapped, because the browser is reading this directory while the build is still writing
      // share cards into it: a file can exist for `existsSync` and be gone again by `statSync`, and
      // a throw out of this handler is a build that fails with nothing printed.
      try {
        const direct = join(DIST, path);
        if (existsSync(direct) && statSync(direct).isFile()) return new Response(Bun.file(direct));
        const index = join(direct, 'index.html');
        if (existsSync(index)) return new Response(Bun.file(index));
      } catch {
        // fall through to the shell, which is what the host would serve anyway
      }
      // What Vercel does with anything the filesystem does not answer: the SPA shell.
      return new Response(Bun.file(FALLBACK), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
  const local = `http://localhost:${server.port}`;

  // Reduced motion: the site sets a block back (`st-pre`) only to reveal it on scroll, and every
  // other animation settles the same way. Under reduced motion nothing is ever set back, so what
  // the build captures is the page at rest rather than mid-transition.
  //
  // SERVICE WORKERS ARE BLOCKED, and that is not a detail. The app ships one, `registerSW.js`
  // registers it on the first page this browser opens, and from then on it answers every
  // navigation on this origin out of its own precache — including the card page, which it served
  // as the precached shell, so every share card came out as a blank white rectangle. Nothing here
  // wants the offline copy; it wants what the build just produced.
  // A build machine without the pinned browser is the one failure that looks like a code defect
  // and is not: `bunx playwright` resolves the LATEST playwright and downloads a browser revision
  // this version will not look for. Name both so the next person reads the answer rather than
  // guessing at it (vercel.json's installCommand uses the pinned binary for exactly this reason).
  const browser = await chromium.launch().catch((cause) => {
    const where = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '<the default browser cache>';
    throw new Error(
      `the pre-render needs a browser and could not start one from ${where}. ` +
        'Install it with the PINNED playwright, not a fetched one: ' +
        '`bun run --cwd apps/web-pwa playwright install chromium`. ' +
        `The underlying failure was: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  });
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 },
  });

  /**
   * THE DIAL, READ ONCE, FOR EVERY FILE THIS BUILD WRITES (docs/DOORS-CLOSED.md §4).
   *
   * Every public page carries a door, and while `doors_open` is false that door is the invitation
   * to the list rather than a way to create an account. The pages are written here, with nothing
   * running afterwards for a crawler, so the state they are written in matters: it is what an
   * answer engine reads and what a person with a slow connection sees first.
   *
   * It is read ONCE and seeded into the page, rather than left for each of the 438 renders to
   * fetch. Two reasons, and the first is the important one: 438 independent readings of a live
   * switch can disagree with each other, and a build that writes the invitation onto four hundred
   * pages and "Start free" onto the rest is worse than either state. The second is that a build
   * must not depend on a service answering 438 times.
   *
   * Closed is the default and closed is every failure (`readDial` never throws), so a build with
   * no gateway configured — which is every local build — writes the invitation.
   */
  const doorsOpen = await readDial(process.env.VITE_GATEWAY_URL ?? '');
  await context.addInitScript(
    ([key, value]: [string, boolean]) => {
      (window as unknown as Record<string, unknown>)[key] = value;
    },
    [DIAL_SEED, doorsOpen] as [string, boolean],
  );
  console.log(`  doors: ${doorsOpen ? 'open' : 'closed'} (the dial, read once for this build)`);

  const page = await context.newPage();

  const rendered = new Map<string, Rendered>();
  for (const route of routes) {
    const shot = await attempt(route.path, async () => {
      await page.goto(`${local}${route.path}`, { waitUntil: 'networkidle', timeout: SETTLE_MS });
      await page.waitForSelector('h1', { timeout: SETTLE_MS });
      return (await page.evaluate((shellHtml: string) => {
        // A block still below the fold when it mounted is faded and set 18px low until it scrolls
        // into view. With nothing running it would stay that way, so the resting state is captured.
        for (const el of Array.from(document.querySelectorAll('.st-pre'))) {
          el.classList.remove('st-pre');
        }
        const root = document.getElementById('root');
        const clean = (el: Element | null | undefined): string =>
          (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const styles = Array.from(document.head.querySelectorAll('style'))
          .map((el) => el.textContent ?? '')
          .filter((css) => css.trim() && !shellHtml.includes(css.trim().slice(0, 120)))
          .join('\n');
        const stylesheets = Array.from(
          document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
        )
          .map((el) => el.getAttribute('href') ?? '')
          .filter(Boolean);
        const read = (name: string, fallback: string): string => {
          const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
          return value || fallback;
        };
        return {
          title: document.title,
          heading: clean(document.querySelector('h1')),
          canonical:
            document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
          body: root?.innerHTML ?? '',
          styles,
          stylesheets,
          palette: {
            paper: read('--paper', '#FFFFFF'),
            ink: read('--ink', '#0E0E16'),
            soft: read('--ink-2', '#55556B'),
            pigment: read('--pig', '#2A4BFF'),
            line: read('--line', '#E4E4EC'),
          },
        };
      }, shell)) as Rendered;
    });
    rendered.set(route.path, shot);
    process.stdout.write(`\rprerender: read ${rendered.size}/${routes.length}`);
  }
  process.stdout.write('\n');

  // THE ORIGIN THE APP ITSELF USED. `canonicalUrl` reads `VITE_APP_URL` out of the bundle, so the
  // build takes the origin from what the app actually wrote rather than guessing at the env a
  // second time and quietly publishing a different domain than the pages declare.
  const home = rendered.get('/');
  const origin = normaliseOrigin(home?.canonical ? new URL(home.canonical).origin : undefined);

  /**
   * WHAT EACH ADDRESS IS CALLED, for the breadcrumb trails.
   *
   * A crumb's name is read off the PAGE'S OWN title, so nothing here invents a label for a page
   * somebody else wrote (`crumbName` says why the title and not the heading). The map is also
   * what says which ancestor paths are real
   * pages: `/help/getting-started` is a heading inside `/help` and not an address, so it is not in
   * here and `breadcrumbTrail` skips it rather than pointing a crawler at the SPA fallback.
   *
   * The root is named "Home" rather than by its own headline, which is a sentence about learning
   * and not the name of a place.
   */
  const crumbNames = new Map<string, string>([['/', 'Home']]);
  for (const [path, shot] of rendered) {
    if (path === '/') continue;
    crumbNames.set(path, crumbName({ path, title: shot.title, heading: shot.heading }));
  }

  mkdirSync(join(DIST, 'og'), { recursive: true });
  const pages: PrerenderedPage[] = [];

  for (const route of routes) {
    const shot = rendered.get(route.path) as Rendered;
    // `/` is the address the sitemap publishes, and the page a stranger gets there is the front
    // door. `pathToRoute` answers a bare `/` with the app's home screen, which is the right answer
    // for a signed-in learner and the wrong one for a crawler, so the front door is named here.
    const routeOf: Route = route.path === '/' ? { name: 'landing' } : routeFromPath(route.path);

    // The app and the build must agree about the address of record, and this is where that is
    // proved rather than assumed: `headFor` is what the running app writes its canonical from.
    const expected = headFor(routeOf, origin).canonical;
    if (shot.canonical !== expected) {
      throw new Error(
        `prerender: ${route.path} rendered a canonical of ${shot.canonical}, but headFor says ${expected}. The app and the build disagree about the address of record.`,
      );
    }

    const image = ogImagePath(route.path);
    // The line a search result shows, written from the page's own opening paragraphs. Which
    // paragraphs those are is decided by `scripts/lead.ts`, over the markup just rendered, so the
    // rule is a function a test can read rather than a selector inside `page.evaluate`.
    const head = headFor(routeOf, origin, {
      title: shot.title,
      description: describeFrom(leadParagraphs(shot.body)),
      image: absoluteUrl(origin, image),
    });
    const title = head.tags.find((t) => t.key === 'title')?.value ?? '';
    const description = head.tags.find((t) => t.key === 'description')?.value ?? '';

    // The card, drawn in the same browser, on the product's own paper and in its own two faces.
    card = cardHtml(shot.stylesheets, shot.palette, { title, description, path: route.path });
    await attempt(`the card for ${route.path}`, async () => {
      await page.setViewportSize({ width: OG_WIDTH, height: OG_HEIGHT });
      await page.goto(`${local}/__card.html`, { waitUntil: 'load', timeout: SETTLE_MS });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(DIST, image.replace(/^\//, '')), type: 'png' });
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    // The stylesheets the app injected as it loaded a screen's chunk are declared up front, so the
    // file reads as the page rather than as unstyled markup when nothing runs.
    const runtimeSheets = shot.stylesheets
      .filter((href) => !shell.includes(href))
      .map((href) => `    <link rel="stylesheet" href="${href}">`);
    let sheet = '';
    if (shot.styles.trim()) {
      const digest = createHash('sha256').update(shot.styles).digest('hex').slice(0, 8);
      const name = `assets/prerender-${digest}.css`;
      if (!sheets.has(digest)) {
        writeFileSync(join(DIST, name), shot.styles, 'utf8');
        sheets.set(digest, name);
      }
      sheet = `    <link rel="stylesheet" href="/${name}">`;
    }

    const html = assemble(shell, {
      tags: renderHeadTags(head.tags),
      linked: renderJsonLd(
        structuredDataFor(
          {
            path: route.path,
            // A page that renders its OWN BreadcrumbList into its body keeps it: the blog does,
            // with labels for a post and its tags that a path cannot know. Two trails on one page
            // is an engine being asked which of two answers is right.
            hasOwnBreadcrumb: nodesOfType(extractJsonLd(shot.body), 'BreadcrumbList').length > 0,
          },
          origin,
          crumbNames,
        ),
      ),
      styles: [...runtimeSheets, sheet].filter(Boolean).join('\n'),
      body: shot.body,
      path: route.path,
    });

    const file = route.path === '/' ? 'index.html' : `${route.path.replace(/^\//, '')}/index.html`;
    mkdirSync(dirname(join(DIST, file)), { recursive: true });
    writeFileSync(join(DIST, file), html, 'utf8');
    pages.push({
      path: route.path,
      file,
      title,
      description,
      canonical: head.canonical ?? '',
      image,
      heading: shot.heading,
      words: 0,
      withoutJs: { heading: '', words: 0 },
    });
    process.stdout.write(`\rprerender: wrote ${pages.length}/${routes.length}`);
  }
  process.stdout.write('\n');

  // WHAT A CRAWLER ACTUALLY GETS. The same files, fetched again with JavaScript switched off, so
  // the proof is a browser reading the emitted bytes rather than this script trusting itself.
  const dark = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const blind = await dark.newPage();
  for (const entry of pages) {
    const seen = await attempt(`${entry.path} with JavaScript off`, async () => {
      await blind.goto(`${local}${entry.path}`, { waitUntil: 'load', timeout: SETTLE_MS });
      return blind.evaluate(() => ({
        heading: (document.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        words: (document.body.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .filter(Boolean).length,
      }));
    });
    if (seen.heading !== entry.heading) {
      throw new Error(
        `prerender: ${entry.path} was written with the heading "${seen.heading}", but the app rendered "${entry.heading}". The wrong page's markup was inlined.`,
      );
    }
    entry.withoutJs = seen;
    entry.words = seen.words;
    process.stdout.write(`\rprerender: read back ${pages.indexOf(entry) + 1}/${pages.length}`);
  }
  process.stdout.write('\n');

  await dark.close();
  await context.close();
  await browser.close();
  server.stop(true);

  const files = pages.map((entry) => ({
    path: entry.path,
    file: entry.file,
    html: readFileSync(join(DIST, entry.file), 'utf8'),
  }));
  const bad = [
    ...checkPrerenderedPages(files, origin),
    ...sharedCanonicals(files),
    // The entity graph, held to its four shapes and the naming law, on the bytes just written
    // (`scripts/jsonld-check.ts`). A page that says nothing about which Wobo it is, or that says
    // "HeyWobo" in a name field, fails the build rather than teaching an engine the wrong string.
    ...checkStructuredData(files, origin),
    // The 67 written pages, read off the bytes just written with every name masked: one that
    // shipped as the shared frame with a name swapped fails here (`scripts/handmade-check.ts`).
    ...checkHandmadePages(files),
  ];
  // THE TWO SEARCH CONSOLES, verified without a deploy of source. Both tokens are read from the
  // build environment (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`), so the owner sets a
  // variable on the host, redeploys, and the file appears at the root. Neither set means neither
  // written, which is the right answer on a laptop and on a preview build.
  for (const file of verificationFiles(process.env as Record<string, string | undefined>)) {
    writeFileSync(join(DIST, file.name), file.contents, 'utf8');
    console.log(`prerender: wrote /${file.name} (${file.why})`);
  }

  const manifest: PrerenderManifest = { origin, built: new Date().toISOString(), pages };
  // Beside `dist`, never inside it: everything in the output directory is served, and this is
  // build bookkeeping rather than part of the site (`scripts/prerender-manifest.ts`).
  writeFileSync(join(APP, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (bad.length > 0) {
    throw new Error(`prerender: ${bad.length} page problems\n${reportViolations(bad)}`);
  }
  console.log(
    `prerender: ${pages.length} addresses written as real HTML at ${origin}, each with its own title, description, canonical and card`,
  );
}

/**
 * The exit code says what happened and nothing else does.
 *
 * Everything this step produces is written and checked before `main` resolves, so once it has, the
 * build is good; a stray rejection from a browser or a socket shutting down afterwards must not
 * fail a deploy in silence. A real failure prints its own sentence rather than a stack nobody reads.
 */
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
process.exit(0);
