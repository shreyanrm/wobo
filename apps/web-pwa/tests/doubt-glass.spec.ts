/**
 * The doubt page's glass (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze): the photo's lines, with
 * boxes from the vision read, are the map; the glass is held for the explanation and released at
 * its end, or on Escape in one tick. Runs under tests/doubt.config.ts, whose server names a
 * gateway this spec answers from the browser.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded } from './helpers';

const SHOTS = process.env.WOBO_GLASS_SHOTS ?? join(tmpdir(), 'wobo-glass');
mkdirSync(SHOTS, { recursive: true });

const DOUBT_ID = 'd-glass-01';

/** Three lines the reader found, as fractions of the upright page: left, top, right, bottom. */
const LINES = [
  { id: 'r1', text: '3x + 5 = 20', box: [0.09, 0.2, 0.55, 0.275] },
  { id: 'r2', text: '3x = 20 - 5', box: [0.09, 0.32, 0.55, 0.395] },
  { id: 'r3', text: 'x = 5', box: [0.09, 0.44, 0.35, 0.515] },
];

const READING = {
  doubt: DOUBT_ID,
  created_at: '2026-09-08T09:00:00Z',
  status: 'read',
  words: '',
  say: 'I read this as: 3x + 5 = 20; 3x = 20 - 5; x = 5. Is that right?',
  reading: {
    subject: 'Mathematics',
    topic: 'linear equations',
    question: 'Solve 3x + 5 = 20 for x.',
    lines: LINES,
    width: 900,
    height: 1200,
  },
  climb: { node_id: null, node_name: null, framework_id: 'cbse' },
};

/** A turn that says one sentence and rings the second line while it is said. */
const TURN = [
  { type: 'say', text: 'The five crosses the equals sign here.', t: 0, dur: 1800 },
  {
    type: 'ink',
    t: 150,
    object: {
      id: 'ring',
      kind: 'circle',
      anchor: { target: 'r2' },
      pad: 8,
      t: { start: 150, dur: 500 },
    },
  },
  { type: 'done', t: 2000, objects: 1, presentation: 'screen' },
];

async function fakeGateway(page: Page, log: string[]): Promise<void> {
  await page.route('**/gw/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/gw/, '');
    const method = req.method();
    log.push(`${method} ${path}`);
    const json = (status: number, content: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(content) });
    if (path === '/v1/doubt' && method === 'POST') return json(200, READING);
    if (path === `/v1/doubt/${DOUBT_ID}/answer` && method === 'POST') {
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

/** A textbook page on a canvas, with the three lines where the reading says they are. */
async function pageImage(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate((lines: { text: string; box: number[] }[]) => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#14142B';
    g.font = '600 64px sans-serif';
    for (const line of lines) {
      const [x0, , , y1] = line.box as [number, number, number, number];
      g.fillText(line.text, x0 * 900, y1 * 1200 - 16);
    }
    return c.toDataURL('image/jpeg', 0.9);
  }, LINES);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function shoot(page: Page): Promise<void> {
  const photo = await pageImage(page);
  await page
    .locator('.db-wrap input[capture="environment"]')
    .setInputFiles({ name: 'page.jpg', mimeType: 'image/jpeg', buffer: photo });
}

type Box = [number, number, number, number];
interface Entry {
  id: string;
  role: string;
  text: string;
  box: Box;
  meaning?: string;
}
/** The box of an entry the test has already asserted is there. */
const boxOf = (entry: Entry | undefined): Box => {
  if (!entry) throw new Error('no such entry on the map');
  return entry.box;
};

interface GlassMap {
  v: 1;
  viewport: { w: number; h: number; scrollY: number; theme?: string };
  entries: Entry[];
}
interface HoldState {
  held: boolean;
  released: string | null;
}
type Lab = Window & {
  __woboGlassRead?: { current: () => GlassMap | null; hold: () => HoldState };
};

const heldAttr = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-glass-held'));
const holdState = (page: Page): Promise<HoldState | null> =>
  page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.hold() ?? null);

async function keep(page: Page, name: string, map: GlassMap | null): Promise<void> {
  writeFileSync(join(SHOTS, `${name}.json`), JSON.stringify(map, null, 2));
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`the photo's lines are the map at ${size.width}, held for the turn and released at its end`, async ({
    page,
  }) => {
    const hits: string[] = [];
    await seedOnboarded(page);
    await fakeGateway(page, hits);
    await page.setViewportSize(size);
    await page.goto('/doubt');
    await shoot(page);
    const explain = page.getByRole('button', { name: 'Explain', exact: true });
    await expect(explain).toBeEnabled();
    await explain.click();

    // held within the first frames of the turn, and the map is the photo's lines
    await expect.poll(() => heldAttr(page), { timeout: 4_000 }).toBe('turn');
    const map = await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.current());
    expect(map).toBeTruthy();
    await keep(page, `doubt-${size.width}-held`, map as GlassMap);
    const m = map as GlassMap;
    expect(m.viewport.w).toBe(size.width);
    const photo = page.locator('.db-wrap img, .db-wrap canvas').first();
    const frame = await photo.boundingBox();
    for (const line of LINES) {
      const entry = m.entries.find((e) => e.id === line.id);
      expect(entry, `${line.id} is on the map`).toBeDefined();
      expect(entry?.role).toBe('photo-line');
      expect(entry?.text).toBe(line.text);
      // inside the viewport, and inside the photo as rendered
      const [x, y, w, h] = boxOf(entry);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(x + w).toBeLessThanOrEqual(size.width + 1);
      expect(y + h).toBeLessThanOrEqual(size.height + 1);
      if (frame) {
        expect(x).toBeGreaterThanOrEqual(frame.x - 2);
        expect(y).toBeGreaterThanOrEqual(frame.y - 2);
        expect(x + w).toBeLessThanOrEqual(frame.x + frame.width + 2);
        expect(y + h).toBeLessThanOrEqual(frame.y + frame.height + 2);
      }
    }
    // the lines are in reading order, one under the other
    const ys = LINES.map((l) => (m.entries.find((e) => e.id === l.id) as Entry).box[1]);
    expect(ys[0]).toBeLessThan(ys[1] as number);
    expect(ys[1]).toBeLessThan(ys[2] as number);

    // released at the turn's end
    await expect.poll(() => heldAttr(page), { timeout: 12_000 }).toBeNull();
    expect((await holdState(page))?.released).toBe('end');
    expect(hits.filter((h) => h.endsWith('/answer'))).toHaveLength(1);
  });
}

test('Escape during the explanation releases the glass in one tick', async ({ page }) => {
  await seedOnboarded(page);
  await fakeGateway(page, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doubt');
  await shoot(page);
  const explain = page.getByRole('button', { name: 'Explain', exact: true });
  await expect(explain).toBeEnabled();
  await explain.click();
  await expect.poll(() => heldAttr(page), { timeout: 4_000 }).toBe('turn');
  const tick = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const i = (window as unknown as Lab).__woboGlassRead;
    return {
      held: i?.hold().held,
      released: i?.hold().released,
      attr: document.documentElement.hasAttribute('data-glass-held'),
    };
  });
  // released on the key's own tick; the runtime's Escape lifts the pen first and records it as
  // the interruption it is, the hold's own listener records 'escape' when nothing was drawing
  expect(tick.held).toBe(false);
  expect(tick.attr).toBe(false);
  expect(['escape', 'interrupt']).toContain(tick.released);
  await keep(
    page,
    'doubt-390-escaped',
    await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.current() ?? null),
  );
});
