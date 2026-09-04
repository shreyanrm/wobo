/**
 * THE CONSOLE'S DOOR IS NOT ADVERTISED ANYWHERE A CHILD OR A CRAWLER CAN SEE IT.
 *
 * `src/admin/separation.test.ts` already holds the bigger rule — that no console CODE reaches the
 * learner bundle — and this file deliberately does not repeat it. What it holds is the smaller,
 * quieter leak that a module-graph check cannot see:
 *
 *   1. An ADMIN ROUTE STRING sitting in the public bundle. `/v1/admin/...` in a chunk a child's
 *      browser downloads is a map of the operator API: every path an attacker would otherwise
 *      have to guess, handed over in a file anybody can read. It can arrive without importing a
 *      single console module — one hard-coded string in a shared constants file does it.
 *   2. A LINK to the console from the app or the site. Smaller than an import and bigger than
 *      nothing: it tells every visitor where the door is.
 *   3. THE DOOR IN A SEARCH INDEX. `noindex` alone is not enough — `noarchive` is what stops a
 *      cached copy of the console surviving as a map of what to attack.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '..');
const SRC = join(APP, 'src');
const ADMIN_DIR = join(SRC, 'admin');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css|html)$/.test(name)) out.push(full);
  }
  return out;
}

/** Everything under src/ that is NOT the console. The console may of course name its own routes. */
const OUTSIDE_THE_CONSOLE = walk(SRC).filter((file) => !file.startsWith(`${ADMIN_DIR}/`));

describe("the console's door is not advertised", () => {
  it('keeps every admin route string out of the learner app and the public site', () => {
    const offenders = OUTSIDE_THE_CONSOLE.filter((file) =>
      readFileSync(file, 'utf8').includes('/v1/admin'),
    ).map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('is not linked to from any learner or public screen', () => {
    const offenders = OUTSIDE_THE_CONSOLE.filter((file) =>
      /['"`]\/admin(\.html)?\b/.test(readFileSync(file, 'utf8')),
    ).map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('asks every crawler to forget it exists, cache included', () => {
    const html = readFileSync(join(APP, 'admin.html'), 'utf8');
    for (const rule of ['noindex', 'nofollow', 'noarchive']) {
      expect(html).toContain(rule);
    }
  });

  it('is absent from the public index, which is the document the site ships', () => {
    expect(readFileSync(join(APP, 'index.html'), 'utf8')).not.toContain('admin');
  });
});
