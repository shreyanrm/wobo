/**
 * NOT ONE BYTE OF THE CONSOLE SHIPS TO A LEARNER OR TO THE PUBLIC SITE.
 *
 * That is the security rule, and this file is what holds it — not the comment at the top of
 * `main.tsx`, and not anybody's memory six weeks from now. It fails if the console is ever
 * reachable from the app's entry, if the public build is ever pointed at the console's document,
 * or if the console ever starts importing the learner app.
 *
 * The last one is not symmetry for its own sake. Learner code drags in the board renderer, the
 * answer library, the local stores and the whole SDK; a console that imported a screen would ship
 * a learner's data model into an operator bundle and would make the two graphs one, which is
 * exactly the merge the first three assertions exist to prevent.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const APP = join(import.meta.dir, '..');
const WEB = join(APP, '..');
const ADMIN = import.meta.dir;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(path);
  }
  return out;
}

const ADMIN_FILES = sources(ADMIN);
const APP_FILES = sources(APP).filter((path) => !path.startsWith(`${ADMIN}/`));

/** Every module specifier a file imports, static and dynamic. */
function imports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

describe('the console is a separate bundle', () => {
  it('exists as its own entry, with its own build, in its own output directory', () => {
    // Fails today if any of the three is missing, which is what makes the rest of this file mean
    // something: an assertion about a graph that does not exist proves nothing.
    expect(statSync(join(WEB, 'admin.html')).isFile()).toBe(true);
    const config = readFileSync(join(WEB, 'vite.admin.config.ts'), 'utf8');
    expect(config).toContain("input: 'admin.html'");
    expect(config).toContain("outDir: 'dist-admin'");
    expect(ADMIN_FILES.length).toBeGreaterThan(0);
  });

  it('is not reachable from the app or the public site', () => {
    const reaching = APP_FILES.filter((path) =>
      imports(path).some(
        (specifier) => /(^|\/)admin\//.test(specifier) || specifier.endsWith('/admin'),
      ),
    ).map((path) => relative(APP, path));
    expect(reaching).toEqual([]);
  });

  it('is not named by the public build, so `bun run build` cannot emit it', () => {
    expect(readFileSync(join(WEB, 'index.html'), 'utf8')).not.toContain('admin');
    expect(readFileSync(join(WEB, 'vite.config.ts'), 'utf8')).not.toContain('admin.html');
    // The public deploy runs `build`, never `build:admin`.
    const scripts = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')).scripts;
    expect(scripts.build).not.toContain('admin');
    expect(scripts['build:admin']).toContain('vite.admin.config.ts');
  });

  it('and does not drag the learner app into the operator bundle', () => {
    /** The only things the console may borrow: law v5's tokens, and its own files. One design
     *  system, no learner data model. */
    const ALLOWED = [/^\.\.\/ui\/tokens\.css$/, /^\.\.\/config\/supabaseUrl$/];
    const strays: string[] = [];
    for (const path of ADMIN_FILES) {
      for (const specifier of imports(path)) {
        if (!specifier.startsWith('.')) continue; // bare specifiers are react and the like
        if (specifier.startsWith('./')) continue; // the console's own files
        if (ALLOWED.some((allowed) => allowed.test(specifier))) continue;
        strays.push(`${relative(ADMIN, path)} → ${specifier}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it('reaches no workspace package of the learner runtime', () => {
    const banned = ADMIN_FILES.flatMap((path) =>
      imports(path)
        .filter((specifier) => specifier.startsWith('@wobo/'))
        .map((specifier) => `${relative(ADMIN, path)} → ${specifier}`),
    );
    expect(banned).toEqual([]);
  });
});
