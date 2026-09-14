/**
 * EVERY MARK ON THE LINE IT NAMES, AND THE FIRST STROKE INSIDE A SECOND (docs/INK-FOUR.md, craft
 * and timing; the adversary, wave 57, findings 1 and 4).
 *
 * Live at 390 on 2026-09-10 the doubt turn read the page right — all six lines, and an answer that
 * said "The first step is 3x = 20 - 5, not 20 + 5" — and then drew one giant ellipse and one
 * struck cross across lines 1 to 3 TOGETHER, because the ink resolved `{target: "r2"}` through the
 * region button, which had been grown to the thumb's 44 px floor over a 7 px line. `offPage` read
 * 0 the whole time: a slab inside the photo is inside the photo, and no probe asked the question a
 * learner asks, which is *which line is it about*.
 *
 * That question is `strayMarks` (wobo/doubt-surface.ts) and this is it on a real screen, at both
 * widths, in both themes and with motion reduced: the marks' own boxes as painted, against the
 * lines' own boxes as measured, with the frames kept.
 *
 * The same run measures the clock. The fake gateway holds its answer for four seconds — the live
 * one took eight — and the first stroke still has to be on the glass within a second of Explain,
 * because the learner's confirmed lines are already registered targets and the local resolve does
 * not wait for anybody (wobo/instant.ts, `resolveDoubtInstant`).
 *
 * Runs under tests/doubt.config.ts.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { Rect } from '@wobo/wobo';
import { strayMarks } from '../src/wobo/doubt-surface';
import { seedOnboarded } from './helpers';

const SHOTS = process.env.WOBO_MARK_SHOTS ?? join(tmpdir(), 'wobo-marks');
mkdirSync(SHOTS, { recursive: true });

const DOUBT_ID = 'd-marks-01';

/** The page the adversary photographed, with the boxes its reader gave the six lines. */
const LINES = [
  { id: 'r1', text: 'Ex 2.3 Q4', box: [0.16, 0.11, 0.38, 0.14] },
  { id: 'r2', text: 'Solve: 3x + 5 = 20', box: [0.16, 0.16, 0.56, 0.19] },
  { id: 'r3', text: '3x = 20 + 5 ?', box: [0.16, 0.22, 0.64, 0.25] },
  { id: 'r4', text: '3x = 25', box: [0.16, 0.28, 0.38, 0.31] },
  { id: 'r5', text: 'x = 25/3', box: [0.16, 0.34, 0.39, 0.37] },
  { id: 'r6', text: 'x = 8.33', box: [0.16, 0.4, 0.39, 0.43] },
];

const READING = {
  doubt: DOUBT_ID,
  created_at: '2026-09-10T15:09:00Z',
  status: 'read',
  words: '',
  say: 'I read this as: Ex 2.3 Q4; Solve: 3x + 5 = 20; 3x = 20 + 5 ?; 3x = 25; x = 25/3; x = 8.33. Is that right?',
  reading: {
    subject: 'Mathematics',
    topic: 'Solving linear equations',
    question: 'Solve the given linear equation.',
    lines: LINES,
    width: 1200,
    height: 1600,
  },
  climb: { node_id: null, node_name: 'Solving linear equations', framework_id: 'cbse' },
};

/** The model's own answer: two sentences, and a mark on each of the two lines they name. */
const TURN = [
  { type: 'say', text: 'Start with the equation, because both sides stay balanced.', t: 0, dur: 2600 },
  {
    type: 'ink',
    t: 120,
    object: {
      id: 'm0',
      // A RING, deliberately: the pen's own pad and its smallest loop are a hand's numbers on a
      // card whose rows are thirty-six units apart, and on a photographed exercise book the rows
      // are fifteen. Live at 390 that is what drew one ellipse over three lines at once.
      kind: 'ring',
      anchor: { target: 'r2' },
      words: 'Solve: 3x + 5 = 20',
      t: { start: 120, dur: 480 },
    },
  },
  {
    type: 'say',
    text: 'The first step is 3x = 20 - 5, not 20 + 5, because subtracting 5 cancels the +5.',
    t: 2600,
    dur: 4200,
  },
  {
    type: 'ink',
    t: 2700,
    object: {
      id: 'm1',
      kind: 'cross',
      anchor: { target: 'r3' },
      words: '3x = 20 + 5 ?',
      t: { start: 2700, dur: 520 },
    },
  },
  { type: 'done', t: 6900, objects: 2, presentation: 'screen' },
];

/** How long the brain thinks before a single byte of the answer arrives. Live it was eight seconds. */
const THINKING_MS = 4_000;

async function fakeGateway(page: Page): Promise<void> {
  await page.route('**/gw/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/gw/, '');
    const method = req.method();
    const json = (status: number, content: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(content) });
    if (path === '/v1/doubt' && method === 'POST') return json(200, READING);
    if (path === `/v1/doubt/${DOUBT_ID}/answer` && method === 'POST') {
      await new Promise((r) => setTimeout(r, THINKING_MS));
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: TURN.map((f, i) => `id: t:${i}\ndata: ${JSON.stringify(f)}\n\n`).join(''),
      });
    }
    if (path === '/v1/doubt' && method === 'GET') return json(200, { doubts: [] });
    return json(404, { code: 'not_found' });
  });
}

/** The exercise page on a canvas, each line drawn where the reading says it is. */
async function pageImage(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate((lines: { text: string; box: number[] }[]) => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1600;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#fdfcf7';
    g.fillRect(0, 0, 1200, 1600);
    g.fillStyle = '#14142B';
    g.font = '500 44px sans-serif';
    for (const line of lines) {
      const [x0, , , y1] = line.box as [number, number, number, number];
      g.fillText(line.text, x0 * 1200, y1 * 1600 - 6);
    }
    return c.toDataURL('image/jpeg', 0.92);
  }, LINES);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function shoot(page: Page): Promise<void> {
  const photo = await pageImage(page);
  await page
    .locator('.db-wrap input[capture="environment"]')
    .setInputFiles({ name: 'page.jpg', mimeType: 'image/jpeg', buffer: photo });
}

interface Measured {
  marks: { id: string; target: string; rect: Rect }[];
  lines: { id: string; rect: Rect; band: Rect }[];
}

/** The marks as painted and the lines as laid out, both read straight off the screen. */
const measure = (page: Page): Promise<Measured> =>
  page.evaluate(() => {
    const asRect = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    /** What a finger meets: the button's own box plus the band its `::after` reaches over. */
    const band = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el, '::after');
      const n = (v: string) => (v === 'auto' ? 0 : Number.parseFloat(v) || 0);
      if (!cs || cs.content === 'none' || cs.content === 'normal' || cs.position !== 'absolute') {
        return asRect(r);
      }
      return {
        x: r.left + n(cs.left),
        y: r.top + n(cs.top),
        width: r.width - n(cs.left) - n(cs.right),
        height: r.height - n(cs.top) - n(cs.bottom),
      };
    };
    const lines = [...document.querySelectorAll('.db-region')].map((el) => ({
      id: el.getAttribute('data-region') ?? '',
      rect: asRect(el.getBoundingClientRect()),
      band: band(el),
    }));
    // What a mark IS about, off the glass: the renderer writes its anchor beside its id.
    const marks = [...document.querySelectorAll('[data-wobo-object]')]
      .map((el) => ({
        id: el.getAttribute('data-wobo-object') ?? '',
        target: el.getAttribute('data-wobo-anchor') ?? '',
        rect: asRect(el.getBoundingClientRect()),
      }))
      .filter((m) => m.rect.width > 0 && m.rect.height > 0);
    return { marks, lines };
  });

const CONDITIONS = [
  { name: '390-light', size: { width: 390, height: 844 }, scheme: 'light' as const, reduced: false },
  { name: '390-dark-rm', size: { width: 390, height: 844 }, scheme: 'dark' as const, reduced: true },
  { name: '1440-light', size: { width: 1440, height: 900 }, scheme: 'light' as const, reduced: false },
  { name: '1440-dark-rm', size: { width: 1440, height: 900 }, scheme: 'dark' as const, reduced: true },
];

for (const c of CONDITIONS) {
  test(`every mark lands on the line it names, and the first stroke beats the brain — ${c.name}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: c.scheme,
      ...(c.reduced ? { reducedMotion: 'reduce' as const } : {}),
    });
    await seedOnboarded(page);
    await fakeGateway(page);
    await page.setViewportSize(c.size);
    await page.goto('/doubt');
    await shoot(page);

    const explain = page.getByRole('button', { name: 'Explain', exact: true });
    await expect(explain).toBeEnabled();

    // THE CLOCK. The answer is four seconds away; the ink is not.
    //
    // MEASURED IN THE PAGE, not by polling from here. A poll round-trip over the debugging
    // protocol is tens of milliseconds on an idle machine and hundreds under a full suite, and
    // what it measures is the harness, not the pen: the same turn read 268 ms alone and 1 008 ms
    // as the twenty-sixth test of a run. An observer inside the page stamps the moment the first
    // mark enters the DOM, on the same clock as the click.
    await page.evaluate(() => {
      const w = window as unknown as { __firstStroke?: number; __asked?: number };
      w.__firstStroke = undefined;
      w.__asked = performance.now();
      const seen = new MutationObserver(() => {
        if (w.__firstStroke !== undefined) return;
        if (!document.querySelector('[data-wobo-object]')) return;
        w.__firstStroke = performance.now();
        seen.disconnect();
      });
      seen.observe(document.body, { childList: true, subtree: true });
    });
    await explain.click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { __firstStroke?: number }).__firstStroke ?? -1,
          ),
        { timeout: 3_000, intervals: [50] },
      )
      .toBeGreaterThan(0);
    const firstStroke = await page.evaluate(() => {
      const w = window as unknown as { __firstStroke: number; __asked: number };
      return w.__firstStroke - w.__asked;
    });
    await page.screenshot({ path: join(SHOTS, `${c.name}-first-stroke.png`) });
    expect(firstStroke, 'the first stroke is on the glass within a second of the ask').toBeLessThan(
      1_000,
    );

    // THE MARKS. Wait for the model's own two, then measure everything on the glass.
    await expect
      .poll(async () => (await measure(page)).marks.length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1_200);
    const m = await measure(page);
    writeFileSync(join(SHOTS, `${c.name}.json`), JSON.stringify({ firstStroke, ...m }, null, 2));
    await page.screenshot({ path: join(SHOTS, `${c.name}-end.png`) });

    expect(m.lines.map((l) => l.id)).toEqual(LINES.map((l) => l.id));
    // A line's own box is the line, not the thumb's slab: six lines fit inside the photo.
    for (const line of m.lines) expect(line.rect.height).toBeLessThan(24);
    // AND THE THUMB'S BAND PARTITIONS THE PAGE. A line's pressable area reaches toward 44 px and
    // stops at the halfway mark to its neighbour, so every tap goes to the line nearest it: no
    // two bands overlap, none leaves a gap, and none is smaller than the line it belongs to.
    // Before wave 58 every band was a 44 px slab and three of them covered the same pixels, so
    // the topmost in the DOM took every tap in the overlap.
    for (const [i, line] of m.lines.entries()) {
      expect(line.band.height).toBeGreaterThanOrEqual(line.rect.height - 0.01);
      const next = m.lines[i + 1];
      if (!next) continue;
      const edge = line.band.y + line.band.height;
      expect(Math.abs(next.band.y - edge), 'the bands meet, exactly once').toBeLessThan(0.6);
    }
    const pitch = (m.lines[1] as { rect: Rect }).rect.y - (m.lines[0] as { rect: Rect }).rect.y;
    for (const line of m.lines) {
      expect(line.band.height).toBeGreaterThanOrEqual(Math.min(44, pitch) - 0.6);
    }
    const named = m.marks.filter((mark) => mark.target);
    expect(named.length, 'the marks anchor to lines of the page').toBeGreaterThanOrEqual(1);
    expect(strayMarks(named, m.lines)).toEqual([]);
  });
}
