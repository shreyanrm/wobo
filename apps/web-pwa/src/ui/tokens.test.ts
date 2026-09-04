/**
 * The token layer is a port of LAW v5 — design/prototypes/landing-v8.html, character for character.
 *
 * These tests hold src/ui/tokens.css to that file, so a "tidier" value can never drift in: the two
 * :root blocks at the top of the prototype are the two blocks here, in both stamps. They also hold
 * the whole app to the white ground — the five cream hexes law v5 retired cannot appear in any
 * shipped source file, in the document shell, or in the PWA manifest.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cssVariables } from '@wobo/config/css';
import { LEGACY_TOKEN_BRIDGE, LEGACY_TOKENS_KEPT, PAGE } from './tokens';

const APP = join(import.meta.dir, '..', '..');
const REPO = join(APP, '..', '..');
const PROTOTYPE = readFileSync(join(REPO, 'design', 'prototypes', 'landing-v8.html'), 'utf8');
const TOKENS = readFileSync(join(import.meta.dir, 'tokens.css'), 'utf8');

/** The declarations of the first `selector{...}` block in `css`, as `name:value` strings. */
function block(css: string, selector: string): string[] {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no block for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((d) => d.replace(/\s*:\s*/, ':'));
}

/**
 * The only declarations the app adds to the prototype's block: the sixth subject hue and the six
 * washes an EARNED moment paints with (src/ui/hues.ts). A one-page landing never needed them.
 * Every one is built on white — never a cream tint — and none of them is ever a section ground.
 */
const APP_ONLY_LIGHT = [
  '--lilac:#B7A6FF',
  '--pig-w:#EDF0FF',
  '--violet-w:#EFEBFF',
  '--rose-w:#FFEDEB',
  '--marigold-w:#FFF6E5',
  '--mint-w:#E3F7F0',
  '--lilac-w:#F6F4FF',
];
const APP_ONLY_DARK = [
  '--lilac:#C9BDFF',
  '--pig-w:#1A1E3A',
  '--violet-w:#2C293E',
  '--rose-w:#38272C',
  '--marigold-w:#383027',
  '--mint-w:#1C3232',
  '--lilac-w:#302E3E',
];

describe('law v5 tokens are the prototype’s, character for character', () => {
  const protoLight = block(PROTOTYPE, ':root{');
  const protoDark = block(PROTOTYPE, '[data-theme="dark"]{');

  it('reads the prototype’s two blocks, and they are law v5’s white ground', () => {
    expect(protoLight.length).toBeGreaterThan(20);
    expect(protoDark.length).toBeGreaterThan(15);
    expect(protoLight).toContain('--paper:#FFFFFF');
    expect(protoLight).toContain('--paper-2:#F6F6F8');
    expect(protoLight).toContain('--line:#E4E4EA');
    expect(protoDark).toContain('--paper:#0E0E16');
    expect(protoDark).toContain('--paper-2:#17171F');
  });

  it('carries every light declaration, stamped as the default and as [data-theme="light"]', () => {
    const mine = block(TOKENS, ':root,[data-theme="light"]{');
    for (const d of protoLight) expect(mine).toContain(d);
    for (const d of mine) expect([...protoLight, ...APP_ONLY_LIGHT]).toContain(d);
  });

  it('carries every night declaration, stamped as [data-theme="dark"]', () => {
    const mine = block(TOKENS, '[data-theme="dark"]{');
    expect(mine.sort()).toEqual([...protoDark, ...APP_ONLY_DARK].sort());
  });

  it('follows prefers-color-scheme for a document nobody has stamped', () => {
    const media = TOKENS.indexOf('@media (prefers-color-scheme:dark)');
    expect(media).toBeGreaterThan(0);
    const mine = block(TOKENS.slice(media), ':root:not([data-theme="light"]){');
    expect(mine.sort()).toEqual([...protoDark, ...APP_ONLY_DARK].sort());
  });

  it('carries law v5’s one spacing rhythm, the prototype’s clamps exactly', () => {
    const mine = block(TOKENS, ':root,[data-theme="light"]{');
    for (const d of [
      '--gutter:clamp(20px, 5vw, 48px)',
      '--band:clamp(96px, 11vw, 184px)',
      '--colgap:clamp(32px, 5vw, 80px)',
      '--s5:72px',
      '--s6:128px',
    ]) {
      expect(protoLight).toContain(d);
      expect(mine).toContain(d);
    }
  });

  it('names the page colours the same in code — white by day, near-black by night', () => {
    expect(PAGE.light).toBe('#FFFFFF');
    expect(PAGE.dark).toBe('#0E0E16');
    expect(protoLight).toContain(`--paper:${PAGE.light}`);
    expect(protoDark).toContain(`--paper:${PAGE.dark}`);
  });

  it('sets only the two faces, self-hosted', () => {
    const faces = [...TOKENS.matchAll(/@font-face\{font-family:'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(faces)).toEqual(new Set(['Poppins', 'Caveat']));
    expect(TOKENS).not.toMatch(/https?:\/\//);
    expect(TOKENS).toContain("--sans:'Poppins',system-ui,-apple-system,sans-serif");
    expect(TOKENS).toContain("--hand:'Caveat',cursive");
  });

  it('carries the base, with law v5’s min-width:0 on every box', () => {
    // §0: a grid or flex child defaults to min-width:auto, which is what gives a phone a
    // horizontal scrollbar at 390px. The prototype resets it on `*`; so does the app.
    expect(PROTOTYPE).toContain('*{box-sizing:border-box;min-width:0}');
    expect(TOKENS).toContain('*{box-sizing:border-box;min-width:0}');
    expect(TOKENS).toContain(
      'body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}',
    );
    expect(TOKENS).toContain('h1,h2,h3{margin:0;letter-spacing:-.02em}');
    expect(TOKENS).toContain('.hand{font-family:var(--hand);font-weight:600}');
  });
});

/**
 * The cream ground is retired (DESIGN.md §0). These five hexes were palette v3/v4's paper and its
 * night — `#FAF7F0` / `#F1EDE3` / `#E7E1D3` by day, `#0F1226` / `#181C3A` by night. One of them
 * written down anywhere in shipped source is a screen that did not move to the white ground, and a
 * hex cannot know which theme is live, so it is a light-theme colour painted into a dark page too.
 *
 * The ban binds what the app SHIPS: every source file, the document shell, and the PWA manifest.
 * Comments are stripped, and a test file is exempt — this one writes all five down to name them.
 */
const CREAM = ['#FAF7F0', '#F1EDE3', '#E7E1D3', '#0F1226', '#181C3A'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
      continue;
    }
    if (!/\.(tsx?|css)$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

/** Comments stripped: the ban is on what the code DRAWS, never on what a doc block explains. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function creamIn(body: string): string[] {
  const up = body.toUpperCase();
  return CREAM.filter((hex) => up.includes(hex));
}

describe('the cream ground cannot come back', () => {
  it('finds no cream hex in any shipped source file', () => {
    for (const file of sources(join(APP, 'src'))) {
      const found = creamIn(code(readFileSync(file, 'utf8')));
      const name = file.slice(APP.length + 1);
      expect(`${name}: ${found.join(' ') || 'white'}`).toBe(`${name}: white`);
    }
  });

  it('paints the first paint and the browser chrome white, never cream', () => {
    const html = readFileSync(join(APP, 'index.html'), 'utf8');
    expect(creamIn(code(html))).toEqual([]);
    expect(html).toContain(`content="${PAGE.light}"`);
    expect(html).toContain(`content="${PAGE.dark}"`);
    expect(html).toContain(`background: ${PAGE.light};`);
    expect(html).toContain(`background: ${PAGE.dark};`);
  });

  it('installs the PWA on the same white paper', () => {
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
    expect(creamIn(code(config))).toEqual([]);
    expect(config).toContain(`theme_color: '${PAGE.light}'`);
    expect(config).toContain(`background_color: '${PAGE.light}'`);
  });
});

describe('the bridge lays the older --wobo-* layer onto law v5', () => {
  const legacy = cssVariables();
  const names = new Set([...legacy.matchAll(/(--wobo-[\w-]+):/g)].map((m) => m[1] as string));
  const colourish = (name: string) => {
    const values = [...legacy.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1]);
    return values.some((v) => /#[0-9a-f]{3,8}|rgba?\(|gradient\(/i.test(v ?? ''));
  };
  const bridged = new Map(
    [...LEGACY_TOKEN_BRIDGE.matchAll(/(--wobo-[\w-]+):\s*var\((--[\w-]+)\)/g)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );

  it('re-points every colour token the older layer emits, or names why it is kept', () => {
    for (const name of names) {
      if (!colourish(name)) continue;
      const covered = bridged.has(name) || LEGACY_TOKENS_KEPT.includes(name);
      expect([name, covered]).toEqual([name, true]);
    }
  });

  it('only ever points at a law v5 token — never a hex of its own', () => {
    for (const line of LEGACY_TOKEN_BRIDGE.split('\n')) {
      const m = line.match(/--wobo-[\w-]+:\s*(.+);/);
      if (!m) continue;
      expect(m[1]).toMatch(/^var\(--[\w-]+\)$/);
    }
  });

  it('bridges nothing the older layer does not have', () => {
    for (const name of bridged.keys()) expect([name, names.has(name)]).toEqual([name, true]);
  });

  it('lands every page and canvas on the white ground, and every hairline on --line', () => {
    // A screen nobody has rebuilt reads these names; law v5 is what they now resolve to.
    for (const name of ['--wobo-page', '--wobo-paper', '--wobo-canvas', '--wobo-on-ink'])
      expect([name, bridged.get(name)]).toEqual([name, '--paper']);
    for (const name of ['--wobo-card', '--wobo-tonal', '--wobo-surface-1'])
      expect([name, bridged.get(name)]).toEqual([name, '--paper-2']);
    for (const name of [
      '--wobo-card-border',
      '--wobo-hairline-on-paper',
      '--wobo-hairline-on-paper-strong',
      '--wobo-hairline-on-dark',
    ])
      expect([name, bridged.get(name)]).toEqual([name, '--line']);
  });
});
