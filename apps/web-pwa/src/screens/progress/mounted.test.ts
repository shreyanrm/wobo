/**
 * THE SURFACES ARE REACHABLE.
 *
 * This folder shipped four surfaces, thirty-eight unit tests and about two thousand lines, and not
 * one of them was reachable from anywhere in the app: `/progress` redirected to `/you`, nothing
 * outside the folder imported `ProgressSurfaces`, and the responsive harness asserted the redirect
 * rather than measuring the screen. Every test in the folder passed the whole time, because a unit
 * test of `evidence.ts` cannot see whether anyone can open the page it feeds.
 *
 * So this file tests the wiring itself, which is the only part the other tests structurally cannot
 * reach. It reads sources rather than rendering: mounting the real screen needs the router, the
 * SDK, the mastery layer, the progress store and a DOM, and a test that stubs all five would be
 * testing its own stubs — exactly the mistake that let this ship. The chain below is short and each
 * link is a fact about a file that exists.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;
const SRC = join(HERE, '..', '..');
const APP = join(SRC, '..');

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

const RUNTIME = read(SRC, 'AppRuntime.tsx');
const SCREEN = read(SRC, 'screens', 'ProgressScreen.tsx');
const PROOF = read(APP, 'tests', 'helpers', 'proof.ts');
const SURFACES = read(HERE, 'ProgressSurfaces.tsx');

describe('a parent can open the report and a learner can open the map', () => {
  it('the router mounts a screen at /progress', () => {
    expect(RUNTIME).toContain("route.name === 'progress' && <ProgressScreen />");
    expect(RUNTIME).toContain("import('./screens/ProgressScreen')");
  });

  it('that screen renders the surfaces rather than handing the address away', () => {
    expect(SCREEN).toContain('<ProgressSurfaces />');
    expect(SCREEN).toContain("from './progress'");
    // the redirect this replaced. Anything of the shape `replace({ name: … })` here is that bug
    // coming back, whatever it redirects to.
    expect(SCREEN).not.toMatch(/replace\(\{\s*name:/);
  });

  it('the surfaces mount both halves — the constellation and the report', () => {
    expect(SURFACES).toContain('<Constellation');
    expect(SURFACES).toContain('<Report');
  });

  it('the responsive harness measures the screen instead of asserting a redirect', () => {
    const row = PROOF.slice(PROOF.indexOf("id: 'progress'"));
    const entry = row.slice(0, row.indexOf('},'));
    expect(entry).toContain("path: '/progress'");
    // its readiness signal has to be text this screen actually paints
    const ready = entry.match(/ready: '([^']+)'/)?.[1] as string;
    expect(SURFACES).toContain(`<h2>${ready}</h2>`);
    // and it must not be waiting for the You screen to appear
    expect(entry).not.toContain("'/you'");
  });
});
