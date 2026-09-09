import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type HtmlTagDescriptor, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRAND_DESCRIPTION } from './src/shell/head';

// Brand-neutral config: the product name, tagline and canonical origin come from the
// environment, so renaming or swapping the domain is one env change and no code edit.
// Fallbacks keep a bare `bun run dev` (no .env) working.
const DEFAULT_APP_NAME = 'Wobo';
// THE MOST-READ LINE OF COPY THE PRODUCT HAS: the install text, the app store blurb, and the
// description of any address that has not been pre-rendered. It is the press kit's one line, taken
// from `src/shell/head.ts` so the product says the same sentence on every surface it appears on —
// which is the entire lever behind the entity work (docs/copy/press-kit.md, GROWTH-ENTITY.md §4).
const DEFAULT_APP_DESCRIPTION = BRAND_DESCRIPTION;

/**
 * THE SHELL THE SERVICE WORKER ANSWERS A NAVIGATION WITH, and why it is not `index.html`.
 *
 * `scripts/prerender.ts` REPLACES `dist/index.html` with the front page and keeps the untouched
 * shell as `dist/app.html`. Workbox's navigation fallback still named `index.html`
 * (vite-plugin-pwa's default), and a NavigationRoute has no denylist here, so from the second
 * visit onward EVERY navigation on the site was answered out of the precache with the front page's
 * 58KB of markup: a fresh navigation to /about arrived titled "Wobo, the AI tutor that draws every
 * explanation" under the heading "Fall in love with learning while studying." React swapped the
 * right screen in before first paint even at 20x CPU throttling, so nothing was visible — but the
 * per-page HTML this build exists to write was never delivered to a returning visitor, and any
 * reader whose bundle failed got the home page at every address on the site.
 *
 * It could not be pointed at `app.html` from here before, because `app.html` does not exist when
 * workbox builds its precache manifest and a fallback workbox has not precached throws. It is
 * declared as an additional entry instead: workbox fetches it at install time, by which point the
 * pre-render has written it. Its revision is the hash of `index.html`, which is what `app.html` is
 * made from (that file plus one `noindex` meta), so the cached copy is replaced exactly when the
 * shell it was cut from changes. The precached `index.html` entry, whose recorded revision matched
 * neither the shipped `index.html` nor `app.html` once the pre-render had run, is gone.
 */
const SHELL_FILE = 'app.html';
const SHELL_REVISION = createHash('sha256')
  .update(readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8'))
  .digest('hex')
  .slice(0, 16);

export default defineConfig(({ mode }) => {
  // loadEnv reads .env[.mode][.local] AND the VITE_-prefixed vars the host injects
  // (Vercel project env), so production values arrive without a code path of their own.
  const env = loadEnv(mode, process.cwd());
  const appName = env.VITE_APP_NAME || DEFAULT_APP_NAME;
  const appDescription = env.VITE_APP_DESCRIPTION || DEFAULT_APP_DESCRIPTION;

  // The two faces the FIRST paint is drawn in: the landing's headline is Poppins 700 and the
  // handwritten half of it is Caveat. Both are self-hosted out of /fonts and declared by
  // src/ui/tokens.css — which the browser only discovers after the entry CSS has parsed, a whole
  // round-trip after it could have started fetching them. Preloading them takes the swap off the
  // critical path on a slow link.
  //
  // WHY IT IS FIVE FILES AND NOT TWO, which is the whole of the layout-shift fix.
  //
  // A face is fetched when a character is laid out in it, not when its `@font-face` is parsed. The
  // two preloaded here were the headline's Poppins 700 and Caveat, so on a throttled phone every
  // other weight started downloading only once React had painted — and landed about 400ms later,
  // reflowing the hero as it swapped in. Measured on the built site, Pixel 7 at 1.6 Mbps with a 4x
  // CPU throttle: ONE shift of 0.2484 at 4,026ms, 386ms after first paint, moving the eyebrow, the
  // headline, the lede (which grew a whole line as Poppins' wider glyphs re-wrapped it) and the ask
  // box under them. That single shift was the site's entire CLS, and 0.248 is more than twice the
  // 0.1 a page is allowed (docs/GROWTH-SEARCH.md §2).
  //
  // The first screen sets in four weights — 400 for the lede, 500 for the eyebrow and the buttons,
  // 600 for the claims, 700 for the headline — plus Caveat for the hand. Naming all five costs
  // about 39 kB, roughly 200ms of the throttled link, spent BEFORE the paint rather than after it,
  // and the reflow it removes is the whole shift. The latin-ext subsets are deliberately not here:
  // English copy never touches them.
  //
  // The alternative fixes were considered and are worse. `font-display: optional` would drop the
  // brand's faces entirely on any first visit slower than 100ms. A metric-matched fallback face
  // would mean changing `--sans`, which is law v5's token, held to design/prototypes/landing-v8.html
  // character for character by src/ui/tokens.test.ts.
  const fontPreloads: HtmlTagDescriptor[] = [
    '/fonts/Poppins-400-latin.woff2',
    '/fonts/Poppins-500-latin.woff2',
    '/fonts/Poppins-600-latin.woff2',
    '/fonts/Poppins-700-latin.woff2',
    '/fonts/Caveat-latin.woff2',
  ].map((href) => ({
    tag: 'link',
    attrs: { rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: '' },
    injectTo: 'head-prepend' as const,
  }));

  // NO CANONICAL AND NO SOCIAL TAGS ARE INJECTED HERE ANY MORE, and that is the fix rather than an
  // omission. This shell was served for every address on the site, so the one `<link rel="canonical">
  // ` it carried told a crawler that all 61 published pages were the home page, and the one og:title
  // made every shared link preview as the home page (docs/GROWTH-SEARCH.md §2). Those tags belong to
  // a page, so `scripts/prerender.ts` writes them per address from `headFor`, and what is left of
  // this shell is the SPA fallback (`dist/app.html`), which carries a `noindex` and claims nothing.
  const brandTags: HtmlTagDescriptor[] = [...fontPreloads];

  const brandHtml: Plugin = {
    name: 'brand-html',
    transformIndexHtml(html) {
      return {
        html: html
          .replaceAll('{{APP_NAME}}', appName)
          .replaceAll('{{APP_DESCRIPTION}}', appDescription),
        tags: brandTags,
      };
    },
  };

  return {
    // The frame builder code-splits the real catalogs (content/catalogs/*.json) at the repo root —
    // allow Vite dev to serve from above the app root.
    server: { fs: { allow: ['../..'] } },
    build: {
      rollupOptions: {
        output: {
          /**
           * WHO PAYS FOR WHAT.
           *
           * Rollup's default is to hoist any module two lazy chunks share into their nearest
           * common ancestor — which, for an app with one entry, is the entry. That is how a
           * visitor reading the marketing page came to download Wobo's board renderer, its
           * handwriting engine and a schema validator: the app needs them and one other page
           * needs them, so they landed in the chunk everybody loads first.
           *
           * Naming them here makes them chunks of their own, fetched beside whatever actually
           * needs them and cached across every deploy that does not change them.
           */
          manualChunks(id: string) {
            // Vite's dynamic-import helper. Left unnamed it is folded into whichever chunk Rollup
            // finds convenient — which was the board, making Wobo's whole hand a static dependency
            // of the entry because the entry has a `lazy()` in it.
            if (id.includes('vite/preload-helper')) return 'preload';
            if (id.includes('/node_modules/')) {
              // React is the one library the entry genuinely needs. Its own chunk so a deploy
              // that changes the app does not re-download the framework.
              if (/[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) {
                return 'react';
              }
              // The two heaviest libraries in the product, each reached by exactly one screen: a
              // 3D scene and a molecule viewer. Named — not left to Rollup — because the service
              // worker keeps them OUT of the precache by this name, and a chunk that quietly got
              // renamed would go back to costing every first visit a megabyte it never opens.
              if (/[\\/]node_modules[\\/](?:three|@react-three)[\\/]/.test(id))
                return 'heavy-three';
              if (id.includes('/node_modules/3dmol/')) return 'heavy-3dmol';
              // A schema validator, ~150 kB of it, reached only through Wobo's board plans.
              if (id.includes('/node_modules/zod/')) return 'zod';
              // Nothing on the public site animates with framer-motion — the site's motion is its
              // own. Keeping it out of the entry keeps it off a document page entirely.
              if (/[\\/]node_modules[\\/](?:framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
                return 'motion';
              }
              return undefined;
            }
            // The design tokens and the motion vocabulary are the two workspace pieces the ENTRY
            // itself reads. Named, so Rollup does not fold them into whichever big chunk happens
            // to share them — which is how the board and the answer library came to be static
            // dependencies of a page that draws neither.
            if (id.includes('/packages/config/')) return 'tokens';
            if (id.includes('/packages/motion/')) return 'motion-kit';
            // Wobo's hand: the plan schema, the geometry, the handwriting, the renderer. The app
            // draws with it constantly; a help article never does.
            if (id.includes('/packages/wobo/src/board/')) return 'wobo-board';
            // Every interactive way a learner answers — a lesson's vocabulary, nothing else's.
            if (id.includes('/packages/wobo/src/answers/')) return 'wobo-answers';
            return undefined;
          },
        },
      },
    },
    plugins: [
      react(),
      brandHtml,
      VitePWA({
        registerType: 'autoUpdate',
        // Icons are cropped from the wordmark's W-mark (the source file named in DEPLOY.md).
        // Regenerate with the snippet there if the logo changes.
        //
        // `wobo-logo.png` used to be first in this list and there is no such file in `public/`,
        // so the name promised an asset that did not exist. It was harmless only because the
        // catch-all rewrite answered every missing file with the app shell and a 200; with that
        // gone (vercel.json), a name here has to be a file. `favicon.ico` is one now — it was the
        // one address a browser asks for without being told to, and it answered with HTML
        // (docs/GROWTH-SEARCH.md §2).
        includeAssets: [
          'favicon.svg',
          'favicon.ico',
          'apple-touch-icon.png',
          'robots.txt',
          'sitemap.xml',
        ],
        workbox: {
          // A new deploy must take over IMMEDIATELY, not after every tab closes. Without these, the
          // old service worker keeps serving its cached (stale) bundle — so a shipped feature looks
          // "missing" until the user manually hard-refreshes. skipWaiting activates the new SW at once;
          // clientsClaim + autoUpdate's client-side reload then swap the page to the fresh build.
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          // Every screen is behind React.lazy, and the whole app runtime is behind one more, so
          // each route is its own chunk and a learner downloads a screen when they walk to it.
          // What IS precached is the product working offline: the entry, the app runtime, every
          // screen. The ceiling is a little above workbox's 2 MiB default, with room for the
          // largest chunk that is still worth having offline.
          maximumFileSizeToCacheInBytes: 2.5 * 1024 * 1024,
          // The heaviest on-demand payloads are NOT precached: RDKit's 6.9 MB wasm, three.js and
          // the molecule viewer — together megabytes that a visitor who opened the marketing page
          // would download in the background for a screen they may never open. They are
          // content-hashed and immutable, so the first real use caches them for good. Everything
          // else — the entry, the runtime, every screen — is still precached, so the product works
          // offline the way it always has.
          //
          // Each ignored pattern has exactly one runtime rule below and nothing else matches them:
          // a file precached AND runtime-cached is stored twice, in two caches, on a phone whose
          // storage is the scarce thing.
          globIgnores: ['**/RDKit_minimal*.wasm', '**/assets/heavy-*', 'index.html'],
          navigateFallback: SHELL_FILE,
          additionalManifestEntries: [{ url: SHELL_FILE, revision: SHELL_REVISION }],
          runtimeCaching: [
            {
              urlPattern: /RDKit_minimal.*\.wasm$/,
              handler: 'CacheFirst',
              options: { cacheName: 'rdkit-wasm', expiration: { maxEntries: 2 } },
            },
            {
              urlPattern: /\/assets\/heavy-[^/]*$/,
              handler: 'CacheFirst',
              options: { cacheName: 'heavy-engines', expiration: { maxEntries: 8 } },
            },
          ],
        },
        manifest: {
          name: appName,
          short_name: appName,
          description: appDescription,
          // Origin-relative on purpose: the manifest is served from the app's own origin
          // (https://heywobo.com), so `/` IS the installed app's identity and launch URL. An
          // absolute URL here would pin an installed app to one host and break every preview.
          id: '/',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          // The manifest cannot carry a media query, so it names the default (light) page colour —
          // matching background_color and the light `theme-color` tag. A dark value here painted
          // the installed PWA's title bar black above a white app. Law v5's paper is WHITE
          // (DESIGN.md §0), and this is the same value as src/ui/tokens.ts PAGE.light.
          theme_color: '#FFFFFF',
          background_color: '#FFFFFF',
          lang: 'en',
          categories: ['education'],
          icons: [
            { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/pwa-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
  };
});
