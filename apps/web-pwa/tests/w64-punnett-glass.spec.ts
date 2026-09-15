/**
 * TEMPORARY LAB (wave 64 closer, the Punnett square): the board ON THE GLASS.
 *
 * `packages/wobo/test/board/punnett-cells.test.ts` holds the law — every word in the square is
 * placed by the hand, inside its own cell, a nib clear of every rule, at every rung of the type
 * ladder — but it holds it in bun, through the renderer's own arithmetic. INK-FOUR says the ruler
 * is the screen: 390 and 1440, light, dark and reduced motion. So this lab puts the SAME plan in
 * front of a real Chrome and reads the painted paths off the DOM, the way the judge read the
 * defect: the glyphs of each word, the traced path of each rule, and the distance between them.
 *
 * It is the same carrier as `w61-pipeline-glass.spec.ts`: the board bench plays a gallery of
 * golden plans, and the pipeline's fixture is swapped in at the network wearing a golden's name.
 * Nothing in the app is changed to measure it.
 *
 * A LAB IS SILENT (docs/INK-FOUR.md): `--mute-audio` comes from the shared config, and the bench
 * feeds a fixture with no gateway and no model behind it.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES =
  process.env.W64_FIXTURES ??
  new URL('../../../packages/wobo/test/board/fixtures/boards/', import.meta.url).pathname;
const CARRIER = 'projectile-apex';

interface Screen {
  name: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  reduced?: boolean;
}

const SCREENS: Screen[] = [
  { name: '390-light', width: 390, height: 844, theme: 'light' },
  { name: '390-dark', width: 390, height: 844, theme: 'dark' },
  { name: '390-reduced', width: 390, height: 844, theme: 'light', reduced: true },
  { name: '1440-light', width: 1440, height: 900, theme: 'light' },
  { name: '1440-dark', width: 1440, height: 900, theme: 'dark' },
  { name: '1440-reduced', width: 1440, height: 900, theme: 'light', reduced: true },
];

interface PlanObject {
  id: string;
  kind: string;
  anchor?: { object?: string; at?: unknown };
}

function plan(board: string, width: '390' | '1440'): PlanObject[] {
  return JSON.parse(
    readFileSync(`${FIXTURES.replace(/\/?$/, '/')}${board}-${width}.json`, 'utf8'),
  ) as PlanObject[];
}

function carrier(objects: PlanObject[], board: string): string {
  const golden = {
    name: CARRIER,
    prompt: board,
    title: board,
    presentation: 'full',
    subject: 'biology',
    expect: {
      ids: objects.map((o) => o.id),
      kinds: objects.map((o) => o.kind),
      anchors: objects.map((o) => (o.anchor && 'object' in o.anchor ? 'object' : 'board')),
      hangsOff: [],
      written: [],
      numbers: [],
    },
    plan: [...objects.map((object) => ({ type: 'ink', object, t: 0 })), { type: 'done', t: 10 }],
  };
  return `export default ${JSON.stringify(golden)}`;
}

interface Reading {
  words: {
    id: string;
    text: string;
    on: string | null;
    tallest: number;
    air: number;
    struck: number;
    inside: boolean;
  }[];
  grid: { w: number; h: number } | null;
}

/** What the browser actually painted: every word in the square against every rule of it. */
async function readGlass(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const plane = document.querySelector('.wobo-chrome-plane');
    const surface = (plane ?? document).querySelector('[data-wobo-surface]');
    const groups = Array.from(surface?.querySelectorAll('[data-wobo-object]') ?? []);
    const idOf = (g: Element) => (g.getAttribute('data-wobo-object') ?? '').split('#')[0] as string;
    /** The path a rule traces, sampled every two pixels, in viewport coordinates. */
    const traced = (g: Element): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      for (const path of Array.from(g.querySelectorAll('path.wobo-stroke'))) {
        const el = path as SVGGeometryElement;
        const ctm = el.getScreenCTM();
        const len = el.getTotalLength();
        if (!ctm || !(len > 0)) continue;
        for (let d = 0; d <= len; d += 2) {
          const p = el.getPointAtLength(d);
          out.push({ x: p.x * ctm.a + p.y * ctm.c + ctm.e, y: p.x * ctm.b + p.y * ctm.d + ctm.f });
        }
      }
      return out;
    };
    const rules: { id: string; points: { x: number; y: number }[]; box: DOMRect }[] = [];
    const words: Reading['words'] = [];
    for (const g of groups) {
      const glyphs = Array.from(g.querySelectorAll('path')).filter(
        (p) => !p.classList.contains('wobo-stroke'),
      );
      if (glyphs.length === 0) {
        const points = traced(g);
        if (points.length > 0) {
          rules.push({
            id: idOf(g),
            points,
            box: (g as SVGGraphicsElement).getBoundingClientRect(),
          });
        }
        continue;
      }
      const boxes = glyphs.map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0);
      if (boxes.length === 0) continue;
      words.push({
        id: idOf(g),
        text: '',
        on: g.getAttribute('data-wobo-on'),
        tallest: Math.max(...boxes.map((b) => b.height)),
        air: Number.POSITIVE_INFINITY,
        struck: 0,
        inside: true,
        // biome-ignore lint/suspicious/noExplicitAny: carried to the loop below, not returned
        ...({ boxes } as any),
      });
    }
    const gridBox = rules.reduce<DOMRect | null>((acc, r) => {
      if (!acc) return r.box;
      const x = Math.min(acc.x, r.box.x);
      const y = Math.min(acc.y, r.box.y);
      return new DOMRect(
        x,
        y,
        Math.max(acc.x + acc.width, r.box.x + r.box.width) - x,
        Math.max(acc.y + acc.height, r.box.y + r.box.height) - y,
      );
    }, null);
    for (const word of words as (Reading['words'][number] & { boxes: DOMRect[] })[]) {
      const inGrid =
        gridBox &&
        word.boxes.every(
          (b) =>
            b.x + b.width / 2 > gridBox.x &&
            b.x + b.width / 2 < gridBox.x + gridBox.width &&
            b.y + b.height / 2 > gridBox.y &&
            b.y + b.height / 2 < gridBox.y + gridBox.height,
        );
      if (!inGrid) {
        word.air = Number.POSITIVE_INFINITY;
        continue;
      }
      let air = Number.POSITIVE_INFINITY;
      let struck = 0;
      for (const rule of rules) {
        for (const p of rule.points) {
          for (const b of word.boxes) {
            const dx = Math.max(0, b.x - p.x, p.x - (b.x + b.width));
            const dy = Math.max(0, b.y - p.y, p.y - (b.y + b.height));
            const d = Math.hypot(dx, dy);
            if (d < air) air = d;
            if (d === 0) struck += 1;
          }
        }
      }
      word.air = air;
      word.struck = struck;
      const host = rules.find((r) => r.id === word.on);
      word.inside = host
        ? word.boxes.every(
            (b) =>
              b.x >= host.box.x - 0.5 &&
              b.y >= host.box.y - 0.5 &&
              b.x + b.width <= host.box.x + host.box.width + 0.5 &&
              b.y + b.height <= host.box.y + host.box.height + 0.5,
          )
        : false;
    }
    for (const w of words as (Reading['words'][number] & { boxes?: DOMRect[] })[]) {
      w.boxes = undefined;
    }
    return {
      words: words.filter((w) => Number.isFinite(w.air)),
      grid: gridBox ? { w: gridBox.width, h: gridBox.height } : null,
    };
  });
}

for (const board of ['bio-punnett'] as const) {
  for (const screen of SCREENS) {
    test(`${board} on the glass at ${screen.name}`, async ({ page }) => {
      const width = screen.name.startsWith('390') ? '390' : '1440';
      const objects = plan(board, width);
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.emulateMedia({
        colorScheme: screen.theme,
        reducedMotion: screen.reduced ? 'reduce' : 'no-preference',
      });
      const body = carrier(objects, board);
      await page.route(`**/goldens/${CARRIER}.json*`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body }),
      );
      await page.goto('/board-bench.html');
      await page.goto(`/board-bench.html?load=1#board-bench/${CARRIER}`);
      await expect(page.getByTestId('board-bench')).toHaveAttribute('data-board', CARRIER);
      await page.getByTestId('bench-plane').click();
      await page.waitForFunction(() => window.__woboBench?.ready === true, undefined, {
        timeout: 30_000,
      });
      await page.waitForFunction(
        (want) => {
          const sign = () => {
            const plane = document.querySelector('.wobo-chrome-plane');
            const surface = plane?.querySelector('[data-wobo-surface]');
            const marks = Array.from(surface?.querySelectorAll('[data-wobo-object]') ?? []);
            if (marks.length < want) return null;
            return marks
              .map((m) => {
                const r = (m as SVGGraphicsElement).getBoundingClientRect();
                return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
              })
              .join('|');
          };
          const w = window as unknown as { __w64?: { sig: string; held: number } };
          const now = sign();
          if (now === null) return false;
          const seen = w.__w64;
          w.__w64 =
            seen && seen.sig === now ? { sig: now, held: seen.held + 1 } : { sig: now, held: 0 };
          return (w.__w64?.held ?? 0) >= 8;
        },
        objects.length,
        { timeout: 30_000, polling: 'raf' },
      );

      if (process.env.W64_SHOT) {
        await page.waitForTimeout(4000);
        const plane = page.locator('.wobo-chrome-plane');
        await plane.screenshot({ path: `${process.env.W64_SHOT}/${board}-${screen.name}.png` });
      }
      // The timing half of the same claim: the first stroke is on the glass inside a second of
      // the utterance starting (docs/BOARD.md §10). The COLD number beside it is a dev server's
      // module graph, which `board-latency*.spec.ts` owns and nothing here asserts.
      const first = await page.evaluate(() => ({
        ms: window.__woboBench?.firstStrokeMs ?? null,
        cold: window.__woboBench?.firstMarkFromLoadMs ?? null,
      }));
      const read = await readGlass(page);
      const worst = read.words.reduce(
        (acc, w) => (w.air < acc.air ? w : acc),
        read.words[0] ?? { id: '-', air: Number.POSITIVE_INFINITY, tallest: 0 },
      );
      process.stdout.write(
        `[w64] ${board} ${screen.name} grid=${read.grid ? `${read.grid.w.toFixed(0)}x${read.grid.h.toFixed(0)}` : '-'}px ` +
          `words=${read.words.length} worstAir=${worst.id} ${worst.air.toFixed(1)}px ` +
          `minType=${Math.min(...read.words.map((w) => w.tallest)).toFixed(1)}px ` +
          `struck=${read.words.filter((w) => w.struck > 0).length} outside=${read.words.filter((w) => !w.inside).length} ` +
          `firstStroke=${first.ms}ms cold=${first.cold}ms\n`,
      );

      expect(read.words.length, 'the square carried no writing').toBe(8);
      expect(
        read.words.filter((w) => w.struck > 0).map((w) => w.id),
        'words painted into a rule of the grid',
      ).toEqual([]);
      expect(
        read.words.filter((w) => !w.inside).map((w) => w.id),
        'words written outside the cell they belong to',
      ).toEqual([]);
      expect(
        read.words.filter((w) => w.air < 3).map((w) => `${w.id} ${w.air.toFixed(1)}px`),
        'words closer to a rule than the nib is wide',
      ).toEqual([]);
      expect(
        read.words.filter((w) => w.tallest < 12).map((w) => `${w.id} ${w.tallest.toFixed(1)}px`),
        'written marks under the 12 px floor',
      ).toEqual([]);
      expect(first.ms, 'the first stroke reached the glass late').toBeLessThan(1000);
    });
  }
}
