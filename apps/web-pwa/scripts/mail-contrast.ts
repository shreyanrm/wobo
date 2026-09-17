/**
 * EVERY MAIL KIND, MEASURED IN A BROWSER: 390 AND 1440 WIDE, LIGHT AND DARK, TEXT NODE BY TEXT NODE.
 *
 * docs/MAIL-PRIMARY.md said this measurement had been made, and nothing in the tree could make it
 * again (the closer's run, 2026-09-17). This is that measurement, kept:
 *
 *   bun run scripts/mail-contrast.ts            # every kind, as test_mail_law.py renders it
 *   bun run scripts/mail-contrast.ts --json     # the same, one JSON line per kind and screen
 *
 * The gateway renders every kind with the facts a real send carries (`SAMPLE` in
 * services/gateway/tests/test_mail_law.py), writes nothing and sends nothing. Each rendering is
 * opened in a headless browser at each width and in each colour scheme, and every visible text
 * node's colour is read against the first painted ground behind it. Large type (24px, or 18.66px
 * bold) must clear 3:1 and everything else 4.5:1. The run exits non-zero when anything is under.
 *
 * What it cannot see: a client that ignores `prefers-color-scheme` and inverts the colours itself.
 * The dark rules exist so the clients that honour the scheme are not left to guess.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const REPO = join(import.meta.dir, '..', '..', '..');
const WIDTHS = [390, 1440] as const;
const SCHEMES = ['light', 'dark'] as const;

const RENDER = `
import json, sys
sys.path.insert(0, "tests")
from test_mail_law import ALL_KINDS, a_render
print(json.dumps({kind: a_render(kind)["html"] for kind in ALL_KINDS}))
`;

interface Low {
  text: string;
  ratio: number;
  needed: number;
  color: string;
  ground: string;
}

function rendered(): Record<string, string> {
  const run = spawnSync('uv', ['run', '--project', '.', 'python', '-c', RENDER], {
    cwd: join(REPO, 'services', 'gateway'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`the gateway could not render the mail:\n${run.stderr}`);
  return JSON.parse(run.stdout) as Record<string, string>;
}

/** Runs inside the page: every visible text node under 4.5:1 (3:1 when large). */
function measure(): { checked: number; worst: number; low: Low[] } {
  const parse = (value: string): [number, number, number, number] | null => {
    const found = value.match(/rgba?\(([^)]+)\)/);
    if (!found?.[1]) return null;
    const [r = 0, g = 0, b = 0, a = 1] = found[1].split(',').map((part) => Number(part.trim()));
    return [r, g, b, a];
  };
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]: [number, number, number, number]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const groundOf = (start: Element): [number, number, number, number] => {
    for (let el: Element | null = start; el; el = el.parentElement) {
      const bg = parse(getComputedStyle(el).backgroundColor);
      if (bg && bg[3] > 0.5) return bg;
      const attr = el.getAttribute('bgcolor');
      if (attr) {
        const probe = document.createElement('i');
        probe.style.color = attr;
        document.body.appendChild(probe);
        const got = parse(getComputedStyle(probe).color);
        probe.remove();
        if (got) return got;
      }
    }
    return [255, 255, 255, 1];
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const low: Low[] = [];
  let checked = 0;
  let worst = Number.POSITIVE_INFINITY;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    const shown = el?.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    if (!text || !el || !shown) continue;
    const style = getComputedStyle(el);
    const size = Number.parseFloat(style.fontSize);
    if (size <= 1) continue;
    const ink = parse(style.color);
    if (!ink) continue;
    const ground = groundOf(el);
    const [a, b] = [luminance(ink), luminance(ground)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const bold = Number(style.fontWeight) >= 700;
    const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    checked += 1;
    worst = Math.min(worst, ratio);
    if (ratio < needed) {
      low.push({
        text: text.slice(0, 60),
        ratio: Math.round(ratio * 100) / 100,
        needed,
        color: style.color,
        ground: `rgb(${ground.slice(0, 3).join(', ')})`,
      });
    }
  }
  return { checked, worst: Math.round(worst * 100) / 100, low };
}

async function main(): Promise<number> {
  const asJson = process.argv.includes('--json');
  const kinds = rendered();
  const browser = await chromium.launch();
  let failures = 0;
  let screens = 0;
  let nodes = 0;
  let worstOfAll = Number.POSITIVE_INFINITY;
  try {
    for (const scheme of SCHEMES) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          colorScheme: scheme,
        });
        for (const [kind, html] of Object.entries(kinds)) {
          await page.setContent(html, { waitUntil: 'load' });
          const result = await page.evaluate(measure);
          screens += 1;
          nodes += result.checked;
          worstOfAll = Math.min(worstOfAll, result.worst);
          failures += result.low.length;
          if (asJson) {
            console.log(JSON.stringify({ kind, width, scheme, ...result }));
          } else if (result.low.length) {
            for (const low of result.low) {
              console.log(
                `${kind} ${width} ${scheme}: ${low.ratio}:1 under ${low.needed}:1, ` +
                  `${low.color} on ${low.ground}, "${low.text}"`,
              );
            }
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  const kindsCount = Object.keys(kinds).length;
  console.log(
    `${kindsCount} kinds, ${screens} screens, ${nodes} text nodes, lowest ${worstOfAll}:1, ` +
      `${failures} under the line`,
  );
  return failures === 0 ? 0 : 1;
}

process.exit(await main());
