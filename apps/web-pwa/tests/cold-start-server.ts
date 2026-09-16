/**
 * The built site, served the way the host serves it, so a cold-start measurement measures what a
 * learner actually downloads.
 *
 * WHY NOT `vite preview`. Preview answers an unknown address with `dist/index.html`, and the
 * pre-render turns THAT file into the front page (scripts/prerender.ts). A measurement of
 * `/course/<topic>` through preview therefore pays for the landing page's markup and its
 * modulepreloads, which is not what the host does: `vercel.json` rewrites every app-owned address
 * to `dist/app.html`, the untouched shell with a `noindex` on it. Measuring the wrong shell would
 * flatter or punish the number for a reason that has nothing to do with the app.
 *
 * So this is the rewrite table of `vercel.json`, read from `vercel.json` itself rather than copied,
 * plus the two rules that file states in its `headers` block: a real file always wins, and anything
 * nobody owns is the 404 page. Nothing here is a second opinion about how the site is served; it is
 * the same table, executed.
 *
 * Run: `PORT=5321 bun tests/cold-start-server.ts` from the app root (tests/cold-start.config.ts
 * starts it). It serves `dist/` and nothing else, and it never reaches the network.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const APP = new URL('..', import.meta.url).pathname;
const REPO = join(APP, '../..');

/**
 * WHICH BUILD IS UNDER MEASUREMENT, and why it is not always `dist`.
 *
 * `dist` is shared mutable state: any other build running in this tree rewrites it, and a
 * measurement that takes minutes on a throttled link can have the bytes swapped underneath it
 * halfway through. That happened — a run reported a closed door that the same `dist` had not shown
 * minutes earlier, because a different build had landed in between, and the number was then a
 * measurement of two builds at once.
 *
 * So the measurement names its own directory and nobody else writes there. `WOBO_COLD_DIST` is it;
 * plain `dist` remains the default, for reading a normal build by hand.
 */
const DIST = process.env.WOBO_COLD_DIST
  ? (process.env.WOBO_COLD_DIST.startsWith('/')
    ? process.env.WOBO_COLD_DIST
    : join(APP, process.env.WOBO_COLD_DIST))
  : join(APP, 'dist');

const PORT = Number(process.env.PORT ?? 5321);

/** The app-owned addresses, exactly as the host is told them. */
interface Rewrite {
  source: string;
  destination: string;
}

function rewrites(): Rewrite[] {
  const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')) as {
    rewrites?: Rewrite[];
  };
  // Only the ones that land on the shell. The `/db/:path*` proxy is a network address and a cold
  // start never touches it; answering it here would invent a service.
  return (vercel.rewrites ?? []).filter((r) => r.destination === '/app.html');
}

/** `/course/:path*` and `/learn` in the host's own notation, as a matcher. */
function matches(source: string, path: string): boolean {
  const wildcard = source.indexOf('/:');
  if (wildcard === -1) return source === path;
  const prefix = source.slice(0, wildcard);
  return path === prefix || path.startsWith(`${prefix}/`);
}

const TABLE = rewrites();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function typeOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot === -1 ? undefined : TYPES[path.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

/** A file inside dist, or nothing. Never anything above it, whatever the address says. */
function fileFor(pathname: string): string | null {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const path = join(DIST, safe);
  if (!path.startsWith(DIST)) return null;
  if (!existsSync(path)) return null;
  return statSync(path).isFile() ? path : null;
}

function send(path: string, status = 200): Response {
  const body = readFileSync(path);
  return new Response(body, {
    status,
    headers: {
      'content-type': typeOf(path),
      // The host's own two rules (vercel.json headers): content-hashed assets are immutable, and
      // the service worker is never cached. A cold start clears storage anyway, so this only keeps
      // a warm second load honest.
      'cache-control': path.includes('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    },
  });
}

Bun.serve({
  port: PORT,
  fetch(request) {
    const { pathname } = new URL(request.url);

    // 1. A real file wins, always. This is what makes a pre-rendered page beat the rewrite.
    const direct = fileFor(pathname === '/' ? '/index.html' : pathname);
    if (direct) return send(direct);

    // 2. A directory address with a real index inside it (`/about` -> `/about/index.html`).
    const indexed = fileFor(`${pathname.replace(/\/$/, '')}/index.html`);
    if (indexed) return send(indexed);

    // 3. An address the app owns: the shell, exactly as the host rewrites it.
    //
    // `app.html` is written by `scripts/prerender.ts`, which is the last step of `bun run build`.
    // A measurement taken against a plain `vite build` (no pre-render, which is how this is
    // developed and how a hermetic measurement build is made) has no such file, and there
    // `index.html` IS the untouched shell — the very file the pre-render would have copied. So the
    // shell is whichever of the two this build actually left behind, and the measurement does not
    // silently fall through to the 404 page.
    if (TABLE.some((r) => matches(r.source, pathname))) {
      const shell = fileFor('/app.html') ?? fileFor('/index.html');
      if (shell) return send(shell);
    }

    // 4. Nobody owns it. The real 404 page when the build wrote one.
    const missing = fileFor('/404.html');
    return missing ? send(missing, 404) : new Response('not found', { status: 404 });
  },
});

// eslint-disable-next-line no-console
console.log(`the built site is on http://localhost:${PORT} (${TABLE.length} app addresses)`);
