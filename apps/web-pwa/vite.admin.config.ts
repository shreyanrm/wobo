/**
 * The operator console's own build. A SEPARATE entry, a SEPARATE output directory, and — the part
 * that matters — NOT part of `bun run build`.
 *
 * WHY A SEPARATE BUILD AND NOT A ROUTE IN THE APP. The security rule for this console is that not
 * one byte of it, and no admin route, ships to the public site or to a learner app. A lazy route
 * inside `src/shell/router.tsx` would fail that in two ways at once: the route table is in the
 * entry every visitor downloads, so the PATH ships even when the chunk does not; and one careless
 * shared import later, Rollup hoists a console module into a chunk the marketing page loads.
 * A second `vite.config` with its own `root` entry has no such edge — the console's module graph
 * starts at `admin.html` and the public build never names it.
 *
 * WHERE IT IS SERVED. Nowhere, by default, and that is deliberate. `vercel.json`'s build command
 * is `bun run --cwd apps/web-pwa build`, which does not run this config, so `dist-admin` is never
 * produced by the public deploy and there is no rewrite pointing at it. Putting the console on a
 * host of its own — a private origin, behind whatever network control the owner wants in front of
 * it — is one deploy of this directory, and is the decision somebody should make deliberately
 * rather than inherit from a router.
 *
 * The invariant is held by `src/admin/separation.test.ts`, not by this comment.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The app root, so `/src/...` and `/fonts/...` resolve exactly as they do for the learner build.
  // `admin.html` is the only entry: nothing here can reach `index.html`'s graph.
  build: {
    outDir: 'dist-admin',
    emptyOutDir: true,
    rollupOptions: { input: 'admin.html' },
    // No service worker, no precache, no offline. A console that keeps working from a cache after
    // a session has been revoked is a console showing figures nobody is still allowed to see.
    sourcemap: false,
  },
  // No VitePWA plugin, for the same reason. This is the whole difference from `vite.config.ts`.
  plugins: [react()],
  server: { fs: { allow: ['../..'] } },
});
