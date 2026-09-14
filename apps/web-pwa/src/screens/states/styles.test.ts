/**
 * The state family stands on palette v4 alone (DESIGN.md §2): the prototype's tokens, 3.5px ink,
 * 12px buttons with no border, no hairline anywhere, the real wordmark, and the codes the corner
 * carries in design/prototypes/states-v2.html.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATES_CSS } from './styles';

const ART = readFileSync(join(import.meta.dir, 'art.tsx'), 'utf8');
const PAGES = readFileSync(join(import.meta.dir, 'pages.tsx'), 'utf8');
const SCENE = readFileSync(join(import.meta.dir, 'Scene.tsx'), 'utf8');
const PROTO = readFileSync(
  join(import.meta.dir, '..', '..', '..', '..', '..', 'design', 'prototypes', 'states-v2.html'),
  'utf8',
);

describe('the state family on palette v4', () => {
  it('uses the palette tokens, never the older ink layer, for every surface and ink', () => {
    const tokens = STATES_CSS.match(/var\(--[a-z0-9-]+\)/g) ?? [];
    for (const t of tokens) {
      // the frost over a long wait is the one older token kept (tokens.ts LEGACY_TOKENS_KEPT)
      expect(
        t === 'var(--wobo-frost-blur)' ||
          t === 'var(--wobo-frost-on-paper)' ||
          !t.includes('--wobo-'),
        t,
      ).toBe(true);
    }
    expect(STATES_CSS).toContain('background: var(--paper)');
    // The pigment used to enter this sheet through the handwritten line under the loader. That line
    // is gone (a wait says nothing, docs/EMAILS-AND-ANIMATIONS.md §3), and the pigment went with it:
    // the scenes are ink on paper, and the one hit of colour on a wait is the orb's own, drawn by
    // the rig rather than by this stylesheet.
    expect(STATES_CSS).not.toContain('var(--pig)');
    expect(STATES_CSS).toContain('color: var(--ink)');
    expect(ART).not.toMatch(/--wobo-/);
  });
  it('draws no hairline, no border and no corner under 10px', () => {
    expect(STATES_CSS).not.toMatch(/0\.5px|1px solid|border: 0\.5|radius: [0-9]px\b/);
    expect(STATES_CSS).toContain('border-radius: 12px');
    expect(STATES_CSS).toContain('border: 0;');
  });
  it('draws every line at 3.5px, the way the prototype does', () => {
    expect(ART).toContain('width = 3.5');
    expect(ART).toContain('const STROKE = 3.5');
    for (const w of ART.matchAll(/width=\{([0-9.]+)\}/g)) {
      expect(Number(w[1])).toBeGreaterThanOrEqual(2.5);
    }
    expect(ART).not.toMatch(/strokeWidth=\{1/);
  });
  it('carries the real wordmark, not a reconstruction', () => {
    expect(SCENE).toContain("from '../landing/wordmark'");
    expect(SCENE).not.toContain('WoboLogo');
  });
  it("names each state the way the prototype's corner does", () => {
    for (const code of ['404', '500', 'Offline', 'Daily limit', 'Link expired', 'Back soon']) {
      expect(PROTO).toContain(`<div class="code">${code}</div>`);
      expect(PAGES).toContain(`code="${code}"`);
    }
  });
  it('rests every drawing under the app’s own reduce-motion switch as well as the OS one', () => {
    expect(STATES_CSS).toContain(':root[data-motion="reduce"] .ws-draw');
    expect(STATES_CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
