/**
 * Build step: `dist/404.html`, the page a missing address gets, with a missing address's status.
 *
 * WHAT WAS WRONG, EXACTLY (docs/GROWTH-SEARCH.md §2). `vercel.json` rewrote `/(.*)` to the app
 * shell, so EVERY path on the site answered 200: a typo, a link cut short, a route we renamed,
 * `/for-schools`, and also `/favicon.ico`, `/wobo-logo.png`, `/og.png` and `/llms.txt`. A crawler
 * probing for a file was told the file was there and handed a page with no words in it, which is
 * strictly worse than being told it is not there. The app did the right thing once JavaScript ran
 * (a real 404 screen, `noindex`, no canonical) and the HTTP status stayed 200 regardless, which is
 * the only part a crawler reads.
 *
 * WHAT FIXES IT, in two halves:
 *
 *  · `vercel.json` no longer rewrites everything. It rewrites the addresses the APP owns and
 *    nothing else, and every published page is a real file the pre-renderer wrote, which the
 *    filesystem answers before any rewrite is considered. So a path nobody owns matches nothing.
 *  · Vercel serves `404.html` from the output directory, with a real 404, for exactly that case.
 *    This step writes it, and writes it as the REAL screen — Wobo's own words, its own type, its
 *    own links out — rather than the empty shell, because the person who mistyped the address has
 *    to be able to read their way out of it with nothing running.
 *
 * WHY IT IS ITS OWN STEP AND NOT PART OF `prerender.ts`. That script renders the PUBLISHED pages
 * and proves things about them that are true of a published page and false of this one: every page
 * it emits must carry a canonical equal to its own address, a description, a share card, and no
 * `noindex`. The 404 is the one page that must carry the opposite of all four. It also starts from
 * `dist/app.html` — the shell as `vite build` left it — rather than from `dist/index.html`, which
 * by then is the front page.
 *
 * Run: `bun run scripts/notfound.ts` (wired into `bun run build`, after `prerender`).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { normaliseOrigin, renderHeadTags } from '../src/shell/head';
import { headFor } from '../src/shell/router';
import { MANIFEST_FILE } from './prerender-manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const DIST = join(APP, 'dist');
/** The shell as `vite build` left it, kept under its own name by `prerender.ts`. */
const SHELL = join(DIST, 'app.html');
const OUT = join(DIST, '404.html');
const MANIFEST = join(APP, MANIFEST_FILE);

const SETTLE_MS = 30_000;

/**
 * An address that is not ours and never will be. The router answers any unknown path with the
 * `notfound` route, so this only has to be unclaimed to make the browser render the 404 screen.
 */
const PROBE = '/this-address-is-not-ours-404';

/** Tags the shell carries for the whole site, replaced by the ones this page earns. */
const SHELL_TAGS = [
  /<title[^>]*>[\s\S]*?<\/title>/gi,
  /<meta\b[^>]*\bname=["']description["'][^>]*>/gi,
  /<meta\b[^>]*\bname=["']robots["'][^>]*>/gi,
  /<link\b[^>]*\brel=["']canonical["'][^>]*>/gi,
  /<meta\b[^>]*\bproperty=["']og:[^"']*["'][^>]*>/gi,
  /<meta\b[^>]*\bname=["']twitter:[^"']*["'][^>]*>/gi,
];

/**
 * One turn at the browser, retried once. A single navigation timing out must not fail a deploy
 * over nothing; a second failure is real, and stops the build saying what did not settle.
 */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (first) {
    process.stdout.write(`notfound: ${what} did not settle, trying once more\n`);
    try {
      return await run();
    } catch (second) {
      throw new Error(`notfound: ${what} failed twice: ${(second as Error).message}`, {
        cause: first,
      });
    }
  }
}

interface Rendered {
  heading: string;
  words: number;
  body: string;
  styles: string;
  stylesheets: string[];
}

async function main(): Promise<void> {
  if (!existsSync(SHELL)) {
    throw new Error(`notfound: no ${SHELL}. Run \`vite build\` and \`prerender\` first.`);
  }
  const shell = readFileSync(SHELL, 'utf8');

  // The same host behaviour the pre-renderer models: a real file wins, and anything else boots the
  // SPA — which is what the browser needs in order to render the 404 screen at all.
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      try {
        const direct = join(DIST, path);
        if (existsSync(direct) && statSync(direct).isFile()) return new Response(Bun.file(direct));
        const index = join(direct, 'index.html');
        if (existsSync(index)) return new Response(Bun.file(index));
      } catch {
        // fall through to the shell, which is what the host would serve anyway
      }
      return new Response(Bun.file(SHELL), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
  const local = `http://localhost:${server.port}`;

  // Reduced motion so what is captured is the page at rest, and NO SERVICE WORKER: the app ships
  // one, and it answers every navigation on this origin out of its own precache — which would
  // serve the precached shell here and write a 404 page with nothing on it.
  const browser = await chromium.launch();
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const shot = (await attempt('the 404 screen', async () => {
    await page.goto(`${local}${PROBE}`, { waitUntil: 'networkidle', timeout: SETTLE_MS });
    await page.waitForSelector('h1', { timeout: SETTLE_MS });
    return page.evaluate((shellHtml: string) => {
      // A block still below the fold when it mounted is faded and set low until it scrolls into
      // view. With nothing running it would stay that way, so the resting state is captured.
      for (const el of Array.from(document.querySelectorAll('.st-pre')))
        el.classList.remove('st-pre');
      const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
      const root = document.getElementById('root');
      return {
        heading: clean(document.querySelector('h1')?.textContent ?? ''),
        words: clean(root?.textContent ?? '')
          .split(' ')
          .filter(Boolean).length,
        body: root?.innerHTML ?? '',
        styles: Array.from(document.head.querySelectorAll('style'))
          .map((el) => el.textContent ?? '')
          .filter((css) => css.trim() && !shellHtml.includes(css.trim().slice(0, 120)))
          .join('\n'),
        stylesheets: Array.from(
          document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
        )
          .map((el) => el.getAttribute('href') ?? '')
          .filter(Boolean),
      };
    }, shell);
  })) as Rendered;
  await context.close();

  if (!shot.heading || shot.words < 15) {
    throw new Error(
      `notfound: the 404 screen rendered ${shot.words} words under "${shot.heading}". A page that says nothing is what this step exists to remove.`,
    );
  }

  // The origin the pages themselves declared, so the 404 cannot claim a different domain than the
  // rest of the build. `headFor` gives it a title that says what happened, a `noindex`, and no
  // canonical: pointing one at the address that was mistyped would invite a crawler to index a
  // page whose only content is that nothing is there.
  const origin = normaliseOrigin(
    existsSync(MANIFEST)
      ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { origin?: string }).origin
      : undefined,
  );
  const head = headFor({ name: 'notfound' }, origin);

  // The stylesheets the app fetched as it loaded the screen's chunk, and the CSS it injected,
  // declared up front so the file reads as the page rather than as unstyled markup.
  const links = shot.stylesheets
    .filter((href) => !shell.includes(href))
    .map((href) => `    <link rel="stylesheet" href="${href}">`);
  if (shot.styles.trim()) {
    const digest = createHash('sha256').update(shot.styles).digest('hex').slice(0, 8);
    const name = `assets/notfound-${digest}.css`;
    writeFileSync(join(DIST, name), shot.styles, 'utf8');
    links.push(`    <link rel="stylesheet" href="/${name}">`);
  }

  // The shell's developer commentary does not ship, here for the same reason it does not ship on
  // the 605 pre-rendered pages: it is notes to whoever edits `index.html` next, it names repo
  // paths, and it carries em dashes into a file a reader opens (docs/copy/voice.md).
  let html = shell.replace(/<!--[\s\S]*?-->/g, '');
  for (const shape of SHELL_TAGS) html = html.replace(shape, '');
  html = html.replace(/^[ \t]*\r?\n/gm, '');
  const root = '<div id="root"></div>';
  if (!html.includes(root)) {
    throw new Error('notfound: app.html has no empty root to render into. Run `vite build` again.');
  }
  html = html
    .replace(/\s*<\/head>/i, `\n${links.join('\n')}\n${renderHeadTags(head.tags)}\n  </head>`)
    .replace(root, `<div id="root">${shot.body}</div>`);

  writeFileSync(OUT, `<!-- the 404, by apps/web-pwa/scripts/notfound.ts -->\n${html}`, 'utf8');

  // WHAT A PERSON WITH A SLOW LINK, AND A CRAWLER, ACTUALLY GET: the file we just wrote, read back
  // by a browser with JavaScript switched off. The proof is the browser's, not this script's.
  const dark = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const blind = await dark.newPage();
  const seen = await attempt('404.html with JavaScript off', async () => {
    await blind.goto(`${local}/404.html`, { waitUntil: 'load', timeout: SETTLE_MS });
    return blind.evaluate(() => ({
      heading: (document.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      words: (document.body.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean).length,
      robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
      canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    }));
  });
  await dark.close();
  await browser.close();
  server.stop(true);

  if (seen.heading !== shot.heading || seen.words < 15) {
    throw new Error(
      `notfound: 404.html reads as "${seen.heading}" (${seen.words} words) with JavaScript off, but the app rendered "${shot.heading}".`,
    );
  }
  if (seen.robots !== 'noindex' || seen.canonical !== null) {
    throw new Error(
      `notfound: 404.html declares robots=${seen.robots} and canonical=${seen.canonical}. A page whose only content is that nothing is there must not invite indexing.`,
    );
  }
  console.log(
    `notfound: 404.html written, "${seen.heading}", ${seen.words} words with JavaScript off, noindex, no canonical`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
process.exit(0);
