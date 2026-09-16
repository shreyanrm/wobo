/**
 * NO WORKSHOP BENCH SHIPS TO A CHILD'S PHONE.
 *
 * A bench is a surface built for us rather than for a learner: the engine gallery at
 * /concept/engines, which renders every engine against its hand-authored demo spec, and the UI kit
 * at /ui-kit, which lays out every primitive in both themes for the design gate. Both are worth
 * having. Neither belongs in a production build, for three separate reasons:
 *
 *   1. THE INSTALL. The service worker precaches the product so it works offline, and the engine
 *      gallery was 486 kB of it — the single largest file in a 4,717 KiB precache, ahead of the
 *      app runtime itself. Every child downloaded the engine QA bench before a lesson had been
 *      taught, on the cheap Android and the slow link the standard is measured on
 *      (docs/PLATFORMS.md §5, §6).
 *   2. THE ADDRESS. /concept/engines was an ordinary unguarded route, and `#engines` booted
 *      straight into it. A store reviewer reading the manifest and the worker would find an
 *      internal engine demo as the largest thing in a children's app.
 *   3. THE GATE THAT DID NOT HOLD. /ui-kit was already gated with `import.meta.env.DEV` and
 *      shipped anyway (`UiKit-C5vZXnZD.js`, 8.3 kB, precached), because its `import()` lived in an
 *      always-constructed `load` table. A property of a live object is reachable however dead the
 *      branch beside it is, so Rollup emitted the chunk. That is the failure this file is really
 *      guarding: a gate that reads correctly and does nothing.
 *
 * So the assertions come in two layers, and the second is the one that cannot be fooled.
 *
 * THE SOURCE LAYER checks that every import of a bench is lexically inside a DEV gate, which is
 * the only arrangement that makes a dynamic import unreachable in a production build.
 *
 * THE BUILT LAYER reads `dist` and asserts no bench chunk exists at all, and that the service
 * worker's precache manifest names none. It skips when nothing has been built, exactly as
 * `prerender.test.ts` and `doors-closed.test.ts` do: `bun run test` runs before `bun run build` in
 * the gate, and a skipped read is honest where an invented one is not.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dir, '..');
const SRC = join(APP, 'src');
const DIST = join(APP, 'dist');

/** The gate that makes a branch dead in a production build. */
const DEV_GATE = 'import.meta.env.DEV';

/**
 * Every bench, as the module specifier its import names and the chunk that specifier produces.
 * The chunk name is Rollup's default for the module's basename, which is what lands in `dist`.
 */
const BENCHES = [
  {
    what: 'the engine gallery',
    specifier: './screens/concepts/EnginesGallery',
    chunk: 'EnginesGallery',
  },
  { what: 'the UI kit', specifier: '../ui/UiKit', chunk: 'UiKit' },
];

/**
 * Is every occurrence of `specifier` in `text` preceded by a DEV gate close enough to be the same
 * declaration? The window is generous on purpose — a gated import may be split over several lines
 * by the formatter — and the built layer below is what proves the result rather than this.
 */
function everyImportIsGated(text: string, specifier: string): boolean {
  const needle = `'${specifier}'`;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return true;
    if (!text.slice(Math.max(0, at - 400), at).includes(DEV_GATE)) return false;
    from = at + needle.length;
  }
}

describe('a workshop bench is gated out of the production graph at its call site', () => {
  it('imports the engine gallery only behind the dev gate', () => {
    const text = readFileSync(join(SRC, 'AppRuntime.tsx'), 'utf8');
    expect(text).toContain(DEV_GATE);
    expect(everyImportIsGated(text, './screens/concepts/EnginesGallery')).toBe(true);
  });

  it('imports the UI kit only behind the dev gate, and never through the loader table', () => {
    const text = readFileSync(join(SRC, 'site', 'PublicRoutes.tsx'), 'utf8');
    expect(everyImportIsGated(text, '../ui/UiKit')).toBe(true);
    // The exact shape that shipped the kit for as long as it did: a bench loader as a property of
    // the always-constructed `load` table. No bench may be reachable that way again.
    expect(text).not.toContain('uiKit:');
    expect(text).not.toContain('load.uiKit');
  });

  it('opens the bench on #engines only in a dev build, on both paths that read the hash', () => {
    for (const file of [join(SRC, 'App.tsx'), join(SRC, 'shell', 'public-routes.ts')]) {
      const text = readFileSync(file, 'utf8');
      const at = text.indexOf("'#engines'");
      expect([file, at === -1]).toEqual([file, false]);
      expect([file, text.slice(Math.max(0, at - 200), at).includes(DEV_GATE)]).toEqual([
        file,
        true,
      ]);
    }
  });
});

describe('the built app contains no workshop bench', () => {
  const built = existsSync(join(DIST, 'sw.js')) && existsSync(join(DIST, 'assets'));
  const assets = built ? readdirSync(join(DIST, 'assets')) : [];

  it.skipIf(!built)('emits no chunk for any bench', () => {
    for (const bench of BENCHES) {
      const found = assets.filter((name) => name.startsWith(`${bench.chunk}-`));
      expect([bench.what, found]).toEqual([bench.what, []]);
    }
  });

  it.skipIf(!built)('precaches no bench, so no install pays for one', () => {
    const worker = readFileSync(join(DIST, 'sw.js'), 'utf8');
    const urls = [...worker.matchAll(/url:"([^"]+)"/g)].map((m) => m[1] ?? '');
    // The manifest must be real: an empty read would make every assertion below vacuous.
    expect(urls.length).toBeGreaterThan(50);
    for (const bench of BENCHES) {
      const found = urls.filter((url) => url.includes(`/${bench.chunk}-`));
      expect([bench.what, found]).toEqual([bench.what, []]);
    }
  });
});
