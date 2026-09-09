/**
 * A question typed into the palette is answered where the learner is
 * (docs/INK-FREEZE-PLAN-TRACE.md §3; the lab's finding 10, 2026-09-08).
 *
 * The palette used to call `router.navigate({ name: 'chat' })` before it asked, so the graph, the
 * derivation and the free body were drawn under /chat with nothing visible — three turns of the
 * lab's world set, unchanged since wave 33. This drives the real palette on the real course card,
 * over a browser-answered gateway, and asserts three things:
 *
 *  · the route does not change: the card the question is about is still on the screen;
 *  · the map that reaches the brain carries that card's own parts, not the chat page's;
 *  · the ink lands ON the card — the ring's box is inside the figure's box.
 *
 * Runs under tests/palette.config.ts, whose server names a gateway this spec answers from the
 * browser. Frames are kept beside the run (WOBO_PALETTE_SHOTS, or the OS temp dir).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, seedOnboarded } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SHOTS = process.env.WOBO_PALETTE_SHOTS ?? join(tmpdir(), 'wobo-palette');
mkdirSync(SHOTS, { recursive: true });

/** The part of the greeting card's drawing this turn is about (tests/glass.spec.ts names it too). */
const SQUARE = 'course-intro-mathematics.square-on-the-hypotenuse';
const FIGURE = 'course-intro-mathematics';
const QUESTION = 'circle the square on the hypotenuse';

/** One turn: a sentence, a ring on the square, and the done frame. Screen ink, not a board. */
const TURN = [
  { type: 'say', text: 'That square is built on the longest side.', t: 0, dur: 1600 },
  {
    type: 'ink',
    t: 120,
    object: {
      id: 'ring-hyp',
      kind: 'circle',
      anchor: { target: SQUARE },
      pad: 8,
      t: { start: 120, dur: 500 },
    },
  },
  { type: 'done', t: 1800, objects: 1, presentation: 'screen' },
];

interface Sent {
  path: string;
  body: string;
}

async function fakeGateway(page: Page, sent: Sent[]): Promise<void> {
  await page.route('**/gw/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/gw/, '');
    sent.push({ path, body: req.postData() ?? '' });
    if (path === '/v1/capability/wobo.turn') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: TURN.map((f, i) => `id: t:${i}\ndata: ${JSON.stringify(f)}\n\n`).join(''),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'not_found' }),
    });
  });
}

/**
 * Learn, the subject, the topic, the arrival card: by role and accessible name, on the Learn page
 * as it is today (the same walk tests/glass.spec.ts takes).
 */
async function openAtom(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Learn', exact: true })
    .or(page.getByRole('link', { name: 'Learn', exact: true }))
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible();
  await page
    .getByRole('link', { name: /Linear equations in one variable/ })
    .first()
    .click();
  await page
    .getByRole('link', { name: /^Solving equations with the variable on one side/ })
    .first()
    .click();
  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 15_000 });
  // the drawing draws itself; let the strokes land before anything is asked about them
  await page.waitForTimeout(1400);
}

/** The live box of one thing on the glass, read through the app's own inspector. */
function boxOf(page: Page, id: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate((wanted) => {
    const read = (
      window as unknown as { __woboGlassRead?: { rectOf: (id: string) => DOMRect | null } }
    ).__woboGlassRead;
    const rect = read?.rectOf(wanted) ?? null;
    if (!rect) throw new Error(`nothing on the glass under ${wanted}`);
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }, id);
}

/** Every mark the hand put on the screen surface, in viewport coordinates. */
function marks(page: Page): Promise<{ id: string; x: number; y: number; w: number; h: number }[]> {
  return page.evaluate(() => {
    const svg = document.querySelector('[aria-label="Wobo\'s ink on this screen"]');
    const groups = svg ? [...svg.querySelectorAll('[data-wobo-object]')] : [];
    return groups.map((g) => {
      const box = (g as SVGGraphicsElement).getBoundingClientRect();
      return {
        // the renderer suffixes an id with its redraw generation (`ring-hyp#0`)
        id: (g.getAttribute('data-wobo-object') ?? '').replace(/#\d+$/, ''),
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
      };
    });
  });
}

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const;

for (const screen of WIDTHS) {
  test(`the palette asks on the lesson and the ink lands on the card at ${screen.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await seedOnboarded(page);
    await seedAtomWorld(page);
    const sent: Sent[] = [];
    await fakeGateway(page, sent);
    await page.goto('/');
    await installAtomBrain(page, ATOM_TARGET_NODE_ID);
    await openAtom(page);
    const before = page.url();

    // ⌘K, the question, Enter — the palette's own path, no shortcut through the runtime.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.getByRole('combobox').fill(QUESTION);
    // A question is not a destination: the ask row is the stop Enter takes.
    await expect(page.locator('#cmdk-opt-__ask__')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');

    // THE ROUTE DOES NOT CHANGE. The card the question is about is still in front of the learner.
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="Wobo\'s ink on this screen"] [data-wobo-object]')
          .length > 0,
      undefined,
      { timeout: 20_000 },
    );
    await page.screenshot({ path: join(SHOTS, `palette-ink-${screen.name}.png`) });
    expect(page.url()).toBe(before);
    expect(page.url()).not.toContain('/chat');

    // THE MAP THAT REACHED THE BRAIN IS THIS PAGE'S. The turn carried the card's own parts.
    const turn = sent.find((s) => s.path === '/v1/capability/wobo.turn');
    expect(turn, 'the palette asked the brain').toBeDefined();
    writeFileSync(join(SHOTS, `palette-sent-${screen.name}.json`), turn?.body ?? '');
    expect(turn?.body).toContain(SQUARE);
    expect(turn?.body).toContain(QUESTION);

    // THE INK LANDS ON THE CARD. The ring is on the square, and the square is inside the figure.
    const drawn = await marks(page);
    const ring = drawn.find((m) => m.id === 'ring-hyp');
    expect(ring, "Wobo's ink is on the screen surface").toBeDefined();
    const square = await boxOf(page, SQUARE);
    const figure = await boxOf(page, FIGURE);
    writeFileSync(
      join(SHOTS, `palette-boxes-${screen.name}.json`),
      JSON.stringify({ ring, square, figure, url: page.url() }, null, 2),
    );
    const slack = 24; // the pen's own overshoot around its subject
    expect(ring?.x).toBeGreaterThanOrEqual(figure.x - slack);
    expect(ring?.y).toBeGreaterThanOrEqual(figure.y - slack);
    expect((ring?.x ?? 0) + (ring?.w ?? 0)).toBeLessThanOrEqual(figure.x + figure.w + slack);
    expect((ring?.y ?? 0) + (ring?.h ?? 0)).toBeLessThanOrEqual(figure.y + figure.h + slack);
    // and it is round the square itself, not merely somewhere on the drawing
    const centre = {
      x: (ring?.x ?? 0) + (ring?.w ?? 0) / 2,
      y: (ring?.y ?? 0) + (ring?.h ?? 0) / 2,
    };
    expect(Math.abs(centre.x - (square.x + square.w / 2))).toBeLessThanOrEqual(slack);
    expect(Math.abs(centre.y - (square.y + square.h / 2))).toBeLessThanOrEqual(slack);
  });
}
