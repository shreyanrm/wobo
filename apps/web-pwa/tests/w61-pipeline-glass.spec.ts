/**
 * TEMPORARY LAB (wave 61 closer, the projectile and the lens): the two pipeline boards ON THE GLASS.
 *
 * `packages/wobo/test/board/written-*.test.ts` hold the three craft laws on the sixteen plans the
 * pipelines produce, but they hold them in bun, through the renderer's own arithmetic. INK-FOUR
 * says the ruler is the screen: 390 and 1440, light, dark and reduced motion. So this lab puts the
 * SAME two plans in front of a real Chrome and reads the painted boxes off the DOM.
 *
 * HOW THE PLAN GETS THERE. The board bench plays a gallery of golden plans, and a golden is a JSON
 * module Vite serves in dev. The fixture is swapped in at the network, by route, wearing a golden's
 * name — nothing in the app is changed to measure it, and nothing about this lab survives the run.
 *
 * WHAT IS READ, all in screen pixels off `getBoundingClientRect`. The renderer already writes the
 * three things a probe needs onto every `<g>`: `data-wobo-object` (its id), `data-wobo-on` (the
 * object it hangs off) and `data-wobo-written` (the type size, when it is writing rather than
 * drawing). A glyph is a filled path; a stroke carries `wobo-stroke`.
 *   · every written mark paints at least 12 px of glyph;
 *   · every mark that hangs off another is within 24 px of what it names;
 *   · the first ink is inside the viewport, and lands within a second of the utterance starting
 *     (docs/BOARD.md §10). The COLD number — module evaluation and first paint of a Vite dev page
 *     — is printed beside it and asserted by nobody here: `board-latency*.spec.ts` owns that, on a
 *     throttled machine, and a dev server's module graph is not the ruler for it.
 *
 * A LAB IS SILENT (docs/INK-FOUR.md): `--mute-audio` comes from the shared config, and the bench
 * feeds a fixture with no gateway and no model behind it.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES =
  process.env.W61_FIXTURES ??
  new URL('../../../packages/wobo/test/board/fixtures/boards/', import.meta.url).pathname;

/** A golden the bench already knows, whose JSON module this lab answers instead of Vite. */
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
  return JSON.parse(readFileSync(`${FIXTURES}${board}-${width}.json`, 'utf8')) as PlanObject[];
}

/** The pipeline fixture, dressed as the golden the bench asks for. */
function carrier(objects: PlanObject[], board: string): string {
  const golden = {
    name: CARRIER,
    prompt: board,
    title: board,
    presentation: 'full',
    subject: 'physics',
    expect: {
      ids: objects.map((o) => o.id),
      kinds: objects.map((o) => o.kind),
      anchors: objects.map((o) => (o.anchor && 'object' in o.anchor ? 'object' : 'board')),
      hangsOff: [],
      written: [],
      numbers: [],
    },
    // Everything at once: this lab is about where the ink LANDS, not about the choreography.
    plan: [...objects.map((object) => ({ type: 'ink', object, t: 0 })), { type: 'done', t: 10 }],
  };
  return `export default ${JSON.stringify(golden)}`;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Painted {
  id: string;
  on: string | null;
  writing: boolean;
  glyphs: Box | null;
  all: Box | null;
  tallest: number;
}

/** What the browser actually painted, mark by mark, in viewport pixels. */
async function painted(page: Page): Promise<Painted[]> {
  return page.evaluate(() => {
    const union = (els: Element[]): Box | null => {
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const el of els) {
        const r = (el as SVGGraphicsElement).getBoundingClientRect();
        if (!(r.width > 0 || r.height > 0)) continue;
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.width);
        y1 = Math.max(y1, r.y + r.height);
      }
      return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    };
    const out: Painted[] = [];
    const plane = document.querySelector('.wobo-chrome-plane');
    const surface = (plane ?? document).querySelector('[data-wobo-surface]');
    for (const g of Array.from(surface?.querySelectorAll('[data-wobo-object]') ?? [])) {
      // `<object id>#<generation>` — the generation is the renderer's, not the plan's.
      const id = (g.getAttribute('data-wobo-object') ?? '').split('#')[0] as string;
      const paths = Array.from(g.querySelectorAll('path'));
      const glyphs = paths.filter((p) => !p.classList.contains('wobo-stroke'));
      let tallest = 0;
      for (const p of glyphs) tallest = Math.max(tallest, p.getBoundingClientRect().height);
      out.push({
        id,
        on: g.getAttribute('data-wobo-on'),
        writing: g.hasAttribute('data-wobo-written'),
        glyphs: union(glyphs),
        all: union(paths),
        tallest,
      });
    }
    return out;
  });
}

const gapOf = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)),
    Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)),
  );

for (const board of ['physics-projectile', 'physics-lens'] as const) {
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
      // WARM THE DEV SERVER FIRST. Vite compiles the bench's module graph on the first request of a
      // run, and that compile lands inside the first board's clock: measured here, 1,298 ms on the
      // first test of a run against 43 to 240 for the same board on every later one. The compile is
      // the lab's, not the hand's, so it is paid before the measurement starts.
      await page.goto('/board-bench.html');
      await page.goto(`/board-bench.html?load=1#board-bench/${CARRIER}`);
      await expect(page.getByTestId('board-bench')).toHaveAttribute('data-board', CARRIER);
      // The PLANE, not the full board: the fixtures were solved for the canvas the plane gives a
      // board at each width (366 x 333 at 390, 496 x 282 at 1440), and a surface of another size
      // is a different camera and a different answer.
      await page.getByTestId('bench-plane').click();
      await page.waitForFunction(() => window.__woboBench?.ready === true, undefined, {
        timeout: 30_000,
      });
      // Wait for the PLANE to hold the whole plan AND STOP MOVING, not for a clock. The surface
      // the bench opens first is the full board; the plane fills after it, and the type ladder and
      // the camera then settle over several frames. A reading taken before that is a reading of a
      // board that is still becoming itself — measured here, the same board reported a worst gap
      // of 150 px mid-settle and 20 px settled, off one plan.
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
          const w = window as unknown as { __w61?: { sig: string; held: number } };
          const now = sign();
          if (now === null) return false;
          const seen = w.__w61;
          w.__w61 =
            seen && seen.sig === now ? { sig: now, held: seen.held + 1 } : { sig: now, held: 0 };
          return (w.__w61?.held ?? 0) >= 8;
        },
        objects.length,
        { timeout: 30_000, polling: 'raf' },
      );
      const rect = await page.evaluate(() => {
        const el = document.querySelector('.wobo-chrome-plane') as HTMLElement | null;
        const r = el?.getBoundingClientRect();
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
      });

      const first = await page.evaluate(() => ({
        ms: window.__woboBench?.firstStrokeMs ?? null,
        cold: window.__woboBench?.firstMarkFromLoadMs ?? null,
        box: window.__woboBench?.firstStrokeBox ?? null,
      }));

      const marks = await painted(page);
      expect(marks.length, 'the surface painted nothing').toBeGreaterThan(0);
      const byId = new Map(marks.map((m) => [m.id, m]));

      const small: string[] = [];
      const far: string[] = [];
      for (const object of objects) {
        const mine = byId.get(object.id);
        if (!mine?.writing || !mine.glyphs) continue;
        if (mine.tallest < 12) small.push(`${object.id} ${mine.tallest.toFixed(1)}px`);
        const host = typeof object.anchor?.object === 'string' ? object.anchor.object : '';
        if (!host || Array.isArray(object.anchor?.at)) continue;
        const subject = byId.get(host);
        if (!subject?.all) continue;
        const gap = gapOf(mine.glyphs, subject.all);
        if (gap > 24) far.push(`${object.id} ${gap.toFixed(1)}px from ${host}`);
      }
      const worst = objects
        .map((o) => {
          const m = byId.get(o.id);
          const host = typeof o.anchor?.object === 'string' ? o.anchor.object : '';
          const s = host ? byId.get(host) : undefined;
          return m?.glyphs && s?.all ? { id: o.id, gap: gapOf(m.glyphs, s.all) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b as { gap: number }).gap - (a as { gap: number }).gap)[0];
      const writing = marks.filter((m) => m.writing);
      const minType = Math.min(...writing.map((m) => m.tallest));

      process.stdout.write(
        `[glass] ${board} ${screen.name} plane=${JSON.stringify(rect)} firstStroke=${first.ms}ms cold=${first.cold}ms ` +
          `firstBox=${JSON.stringify(first.box)} worstGap=${worst ? `${(worst as { id: string; gap: number }).id} ${(worst as { gap: number }).gap.toFixed(1)}px` : '-'} ` +
          `minType=${minType.toFixed(1)}px\n`,
      );
      expect(writing.length, 'the plane painted no writing at all').toBeGreaterThan(3);
      expect(small, 'written marks under the 12 px floor').toEqual([]);
      expect(far, 'marks past the 24 px reach').toEqual([]);
      expect(first.box, 'the first stroke was not inside the viewport').not.toBeNull();
      expect(first.ms, 'the first stroke reached the glass late').toBeLessThan(1000);
    });
  }
}
