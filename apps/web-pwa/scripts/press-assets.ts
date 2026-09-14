/**
 * Build step: THE FILES THE PRESS KIT HANDS OUT, under `/press/`.
 *
 * `/press` (`src/screens/press/Press.tsx`) links six files a journalist downloads: the wordmark as
 * SVG and as a 2048px PNG, the mark as SVG, and three screenshots of the product. The page named
 * them (`src/screens/press/copy.ts`, held to docs/copy/press-kit.md) before anything wrote them,
 * so a crawler walking the built site found six links to addresses that answered with the SPA
 * shell, which is exactly the fault docs/GROWTH-SEARCH.md §2 exists to end: a page is either a
 * real file or it is not linked. `test/prerender.test.ts` ("points at no address the build did not
 * write") fails on that, and this is the step that makes it true instead.
 *
 * WHAT IS WRITTEN, AND FROM WHERE:
 *
 *  · The wordmark SVG is the very component the site's header wears
 *    (`src/ui/primitives/Wordmark.tsx`), rendered to markup by React itself. Nothing is redrawn:
 *    a press kit whose logo is a redraw of the product's logo is two logos, and the second one is
 *    the one that ends up in print. The only change is that `currentColor`, which a standalone
 *    file has no element to inherit from, becomes the site's own ink.
 *  · The wordmark PNG is that same SVG, rasterised by the browser at 2048px wide on a transparent
 *    ground, for anywhere an SVG will not go.
 *  · The mark SVG is the face in `public/favicon.svg`, geometry byte for byte, with the favicon's
 *    scheme-switching stylesheet and its bleed ground taken out, because a file handed to a
 *    designer must look the same on every screen it is opened on.
 *  · The screenshots are taken from the REAL pre-rendered site (`dist/`), served the way the host
 *    serves it, at 1440 by 900, each from the page `copy.ts` says it came from and of the block
 *    the caption describes. Nothing is mocked up: a picture of something the product does not do
 *    costs more in trust than it buys in attention (docs/GROWTH-PRESS.md §3).
 *
 * WHERE. The logos go to `public/press/` (so the source tree carries them and the next
 * `vite build` ships them on its own) and to `dist/press/` (so THIS build ships them). The
 * screenshots go to `dist/press/` only: they are pictures of the build they were taken from, like
 * the share cards in `dist/og/`, and a checked-in copy would be stale by the next commit.
 *
 * Run: `bun run scripts/press-assets.ts` (wired into `bun run build`, after the pre-render, which
 * it needs: the pages it photographs are the files the pre-render wrote).
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LOGOS, SCREENSHOTS } from '../src/screens/press/copy';
import { Wordmark, WORDMARK_RATIO } from '../src/ui/primitives/Wordmark';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const DIST = join(APP, 'dist');
const PUBLIC_DIR = join(APP, 'public');
const FALLBACK = join(DIST, 'app.html');

/** The site's ink (`--ink` in `src/screens/landing/page-styles.ts`), which the header sets the wordmark in. */
const INK = '#14142B';

/** The wordmark PNG's width, as the kit promises it ("2048px wide on a transparent ground"). */
const PNG_WIDTH = 2048;

/** The screenshots' frame, as `Press.tsx` declares it on every `<img>`. */
const SHOT = { width: 1440, height: 900 } as const;

/** How long one page gets to settle before this step gives up on it and says so. */
const SETTLE_MS = 30_000;

/**
 * Which block on the page each screenshot shows. Keyed by the file `copy.ts` names, so a
 * screenshot added to the kit without a rule here fails the build rather than shipping a picture
 * of whatever happened to be at the top of the page.
 */
const FRAMES: Readonly<Record<string, string>> = {
  // The hero: the question on the device card, and the answer being drawn under it.
  '/press/wobo-drawn-answer.png': '#hero',
  // "The same question, four ways, as you scroll."
  '/press/wobo-four-forms.png': '#forms',
  // The re-teach ladder: "The second explanation. Then the third."
  '/press/wobo-reteach.png': '.hw-step:has(.hw-ladder)',
};

// --- the logos ----------------------------------------------------------------------------------

/** The header's wordmark, as a file of its own. */
export function wordmarkSvg(): string {
  const markup = renderToStaticMarkup(createElement(Wordmark));
  return `${markup
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replaceAll('currentColor', INK)}\n`;
}

/**
 * The favicon's face, fixed to its light-scheme colours and without the ground it bleeds for a
 * browser tab. The geometry is the favicon's own, read from the file rather than copied into here.
 */
export function markSvg(favicon: string): string {
  const light = new Map<string, string>();
  const rootRule = favicon.match(/:root\{([^}]*)\}/)?.[1] ?? '';
  for (const pair of rootRule.split(';')) {
    const [name, value] = pair.split(':').map((s) => s.trim());
    if (name && value) light.set(name, value);
  }
  const out = favicon
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<rect x="-500"[^>]*\/>\s*/, '')
    .replace(/var\((--wr-[a-z]+)\)/g, (_, name: string) => {
      const value = light.get(name);
      if (!value) throw new Error(`press-assets: favicon.svg names ${name} and never defines it.`);
      return value;
    })
    .replace(/aria-label="[^"]*"/, 'aria-label="The Wobo mark"');
  if (out.includes('var(')) throw new Error('press-assets: the mark still depends on a variable.');
  return `${out.trim()}\n`;
}

// --- the run ------------------------------------------------------------------------------------

function fileOf(href: string): string {
  return href.replace(/^\//, '');
}

async function main(): Promise<void> {
  if (!existsSync(FALLBACK)) {
    throw new Error(`press-assets: no ${FALLBACK}. Run \`vite build\` and the pre-render first.`);
  }
  for (const shot of SCREENSHOTS) {
    const page = join(DIST, shot.from === '/' ? 'index.html' : join(fileOf(shot.from), 'index.html'));
    if (!existsSync(page)) {
      throw new Error(`press-assets: ${shot.href} is taken from ${shot.from}, which the build did not write (${page}).`);
    }
    if (!FRAMES[shot.href]) {
      throw new Error(`press-assets: ${shot.href} has no frame rule; say which block on ${shot.from} it shows.`);
    }
  }
  mkdirSync(join(PUBLIC_DIR, 'press'), { recursive: true });
  mkdirSync(join(DIST, 'press'), { recursive: true });

  const wordmark = wordmarkSvg();
  const mark = markSvg(readFileSync(join(PUBLIC_DIR, 'favicon.svg'), 'utf8'));
  for (const [name, bytes] of [
    ['wobo-wordmark.svg', wordmark],
    ['wobo-mark.svg', mark],
  ] as const) {
    writeFileSync(join(PUBLIC_DIR, 'press', name), bytes, 'utf8');
    writeFileSync(join(DIST, 'press', name), bytes, 'utf8');
  }

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
      return new Response(Bun.file(FALLBACK), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
  const local = `http://localhost:${server.port}`;

  const browser = await chromium.launch().catch((cause) => {
    throw new Error(
      'press-assets: the screenshots need a browser and could not start one. Install it with the ' +
        'pinned playwright: `bun run --cwd apps/web-pwa playwright install chromium`. ' +
        `The underlying failure was: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  });
  // The same conditions the pre-render renders under: nothing mid-transition, and the service
  // worker kept out so the page photographed is the one this build just wrote.
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    viewport: { width: SHOT.width, height: SHOT.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    // The wordmark PNG: the SVG just written, at the promised width, on nothing.
    const pngHeight = Math.round(PNG_WIDTH / WORDMARK_RATIO);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<div id="wm" style="width:${PNG_WIDTH}px;height:${pngHeight}px;color:${INK}">${wordmark}</div>` +
        `<style>#wm svg{display:block;width:100%;height:100%}</style></body></html>`,
    );
    const png = await page.locator('#wm').screenshot({ omitBackground: true, type: 'png' });
    writeFileSync(join(PUBLIC_DIR, 'press', 'wobo-wordmark.png'), png);
    writeFileSync(join(DIST, 'press', 'wobo-wordmark.png'), png);

    for (const shot of SCREENSHOTS) {
      const frame = FRAMES[shot.href] as string;
      await page.goto(`${local}${shot.from}`, { waitUntil: 'networkidle', timeout: SETTLE_MS });
      await page.waitForSelector('h1', { timeout: SETTLE_MS });
      await page.waitForSelector(frame, { timeout: SETTLE_MS });
      await page.evaluate((selector: string) => {
        // A block below the fold is faded and set low until it scrolls into view; the picture is
        // of the page at rest, so the resting state is what is captured.
        for (const el of Array.from(document.querySelectorAll('.st-pre'))) {
          el.classList.remove('st-pre');
        }
        document.querySelector(selector)?.scrollIntoView({ block: 'start', behavior: 'instant' });
        // The site's header is fixed over the top of the page; the block starts under it, not
        // behind it.
        const header = document.querySelector('header');
        const fixed = header && getComputedStyle(header).position !== 'static' ? header : null;
        if (fixed && window.scrollY > 0) window.scrollBy(0, -(fixed.getBoundingClientRect().height + 16));
      }, frame);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: join(DIST, fileOf(shot.href)),
        type: 'png',
        clip: { x: 0, y: 0, ...SHOT },
      });
    }
  } finally {
    await context.close();
    await browser.close();
    server.stop(true);
  }

  // Every file the page links is now a real file, and not an empty one.
  const missing = [...LOGOS, ...SCREENSHOTS]
    .map((asset) => asset.href)
    .filter((href) => {
      const file = join(DIST, fileOf(href));
      return !existsSync(file) || statSync(file).size === 0;
    });
  if (missing.length > 0) {
    throw new Error(`press-assets: the press page links files that were not written: ${missing.join(', ')}`);
  }
  console.log(
    `press-assets: ${LOGOS.length} logo files and ${SCREENSHOTS.length} screenshots written under /press/`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
