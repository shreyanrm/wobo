/**
 * The pen starts within a second (docs/BOARD.md §10, WOBO-PLAN §2).
 *
 * The budget is measured on the hand alone: a fixture plan is fed in at its own timing — no
 * network, no model, no gateway — and the clock runs from the start of the utterance to the moment
 * the first stroke is in the DOM. That covers everything the hand owns: mounting the surface,
 * measuring the frame, resolving the anchor, building the geometry and painting the first path.
 *
 * The budget in BOARD.md is a cheap Android phone on 4G. CI is neither, so this harness holds the
 * hand to the same 1 000 ms number on a far faster machine, which is the strict reading: if a
 * desktop cannot start the pen in a second, no phone will.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The bench API is declared once, where it is implemented (`src/wobo/board-bench.tsx`
// exports `BenchApi` and declares `window.__woboBench`). Re-declaring a narrower shape
// here made the two definitions conflict the moment the specs were type-checked.

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, '../src/wobo/goldens');

/** BOARD.md §10. One second, and the pen has to be moving. */
const FIRST_STROKE_BUDGET_MS = 1000;

const manifest: { name: string; objects: number }[] = JSON.parse(
  readFileSync(join(GOLDENS, 'manifest.json'), 'utf8'),
) as { name: string; objects: number }[];

/**
 * Open the bench on a board with a genuinely fresh document.
 *
 * Two URLs that differ only in their hash are the SAME document to the browser, so navigating
 * between them replays the board without reloading anything — which would quietly turn a cold
 * measurement into a warm one. The counter in the query string forces a real load every time.
 */
let load = 0;
async function open(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.goto(`/board-bench.html?load=${++load}#board-bench/${name}`);
}

/** Play a board at its real pace and read the time to the first stroke. */
async function timeToFirstStroke(
  page: import('@playwright/test').Page,
  name: string,
): Promise<number> {
  // No `instant`: the plan streams on its own clock, exactly as it arrives from the brain.
  await open(page, name);
  await expect(page.getByTestId('board-bench')).toHaveAttribute('data-board', name);
  await page.waitForFunction(
    () => typeof window.__woboBench?.firstStrokeMs === 'number',
    undefined,
    {
      timeout: 15_000,
    },
  );
  const ms = await page.evaluate(() => window.__woboBench?.firstStrokeMs ?? Number.NaN);
  expect(Number.isFinite(ms)).toBe(true);
  // A stroke nobody could see is not a first stroke: the scorecard's 33 to 40 ms figure was
  // measured on ink at x = 2069 on a 1440 viewport (docs/INK-FREEZE-PLAN-TRACE.md §5).
  await page
    .waitForFunction(() => window.__woboBench?.firstStrokeBox !== null, undefined, {
      timeout: 2_000,
    })
    .catch(() => undefined);
  const box = await page.evaluate(() => window.__woboBench?.firstStrokeBox ?? null);
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  expect(box, `${name}: the first stroke has no box`).not.toBeNull();
  if (box) {
    const inside =
      box.x + box.w > 0 && box.x < viewport.width && box.y + box.h > 0 && box.y < viewport.height;
    expect(
      inside,
      `${name}: the first stroke landed outside the viewport at ${JSON.stringify(box)}`,
    ).toBe(true);
  }
  return ms;
}

test.describe('the pen starts within a second', () => {
  test('on the heaviest board in the set', async ({ page }) => {
    // The board with the most objects is the worst case for the first geometry pass.
    const heaviest = [...manifest].sort((a, b) => b.objects - a.objects)[0] as { name: string };
    const ms = await timeToFirstStroke(page, heaviest.name);
    expect(ms, `${heaviest.name} took ${Math.round(ms)} ms to the first stroke`).toBeLessThan(
      FIRST_STROKE_BUDGET_MS,
    );
  });

  test('on every golden board', async ({ page }) => {
    const times: [string, number][] = [];
    for (const entry of manifest) {
      times.push([entry.name, await timeToFirstStroke(page, entry.name)]);
    }
    const slowest = times.reduce((a, b) => (b[1] > a[1] ? b : a));
    // Reported so a regression names itself in the log rather than in a stack trace.
    console.log(
      `time to first stroke: ${times.map(([n, ms]) => `${n} ${Math.round(ms)}ms`).join(', ')}`,
    );
    for (const [name, ms] of times) {
      expect(ms, `${name} took ${Math.round(ms)} ms to the first stroke`).toBeLessThan(
        FIRST_STROKE_BUDGET_MS,
      );
    }
    expect(slowest[1]).toBeLessThan(FIRST_STROKE_BUDGET_MS);
  });

  test('cold: from opening the page to the first mark', async ({ page }) => {
    // The whole cost of the hand on a page that has just opened — modules, mount, measure,
    // geometry, paint. No warm surface, no cached run.
    const cold: [string, number][] = [];
    for (const entry of manifest) {
      await open(page, entry.name);
      await page.waitForFunction(
        () => typeof window.__woboBench?.firstMarkFromLoadMs === 'number',
        undefined,
        { timeout: 15_000 },
      );
      cold.push([
        entry.name,
        await page.evaluate(() => window.__woboBench?.firstMarkFromLoadMs ?? Number.NaN),
      ]);
    }
    console.log(
      `cold to first mark: ${cold.map(([n, ms]) => `${n} ${Math.round(ms)}ms`).join(', ')}`,
    );
    for (const [name, ms] of cold) {
      expect(ms, `${name} took ${Math.round(ms)} ms from page open`).toBeLessThan(
        FIRST_STROKE_BUDGET_MS,
      );
    }
  });

  test('a replay starts just as fast — nothing is cached into passing', async ({ page }) => {
    await open(page, 'projectile-apex');
    await page.waitForFunction(
      () => typeof window.__woboBench?.firstStrokeMs === 'number',
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      const api = window.__woboBench;
      if (api) api.firstStrokeMs = null;
    });
    await page.getByTestId('bench-replay').click();
    await page.waitForFunction(
      () => typeof window.__woboBench?.firstStrokeMs === 'number',
      undefined,
      { timeout: 15_000 },
    );
    const ms = await page.evaluate(() => window.__woboBench?.firstStrokeMs ?? Number.NaN);
    expect(ms).toBeLessThan(FIRST_STROKE_BUDGET_MS);
  });
});
