/**
 * TEMPORARY LAB (wave 62 closer, the 'circle the hypotenuse' finding).
 *
 * Wave 60's judge: "Because the side's declared box IS the triangle's box, the ring encloses the
 * whole triangle at both widths (1440 [537,358,146,115], 390 [122,305,91,73])". This lab measures
 * that on the app's own arrival card at 390 and 1440, light, dark and reduced motion:
 *
 *  1. the glass boxes of every part of the mathematics drawing;
 *  2. the ring the screen store actually paints on `...hypotenuse`, and where it lands against
 *     the triangle's own three corners and its two legs;
 *  3. how much of the square on the hypotenuse is on the glass at the end frame.
 *
 * A LAB IS SILENT (docs/INK-FOUR.md): the browser is launched with --mute-audio by the config.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, seedOnboarded } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SHOTS = process.env.W62_SHOTS ?? '/tmp/w62';
mkdirSync(SHOTS, { recursive: true });

type Box = [number, number, number, number];
type Pt = [number, number];

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
];

interface Inspector {
  take: (options?: { question?: string }) => { entries: { id: string; role: string; text: string; box: Box }[] };
  rectOf: (id: string) => DOMRect | null;
  settle: () => Promise<void>;
}
type Lab = Window & { __woboGlassRead?: Inspector };

async function arrive(page: Page, screen: Screen): Promise<void> {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.emulateMedia({
    colorScheme: screen.theme,
    reducedMotion: screen.reduced ? 'reduce' : 'no-preference',
  });
  await page.setViewportSize({ width: screen.width, height: screen.height });
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto('/');
  await installAtomBrain(page, ATOM_TARGET_NODE_ID);
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
}

/** The mathematics drawing, its parts, and the triangle's own corners, in viewport px. */
async function figure(page: Page): Promise<{
  parts: Record<string, Box>;
  corners: Pt[];
  squareDrawn: number;
}> {
  return page.evaluate(() => {
    const inspector = (window as unknown as Lab).__woboGlassRead;
    if (!inspector) throw new Error('no glass inspector');
    const map = inspector.take();
    const parts: Record<string, Box> = {};
    for (const e of map.entries) {
      if (e.id.startsWith('course-intro-')) parts[e.id.replace('course-intro-mathematics', '')] = e.box;
    }
    // The triangle's three corners, from the path's own user units through its screen matrix.
    const tri = document.querySelector('[data-glass-part="triangle"]') as SVGGraphicsElement | null;
    const corners: [number, number][] = [];
    if (tri) {
      const svg = tri.ownerSVGElement as SVGSVGElement;
      const m = tri.getScreenCTM();
      if (m) {
        for (const [x, y] of [
          [46, 124],
          [106, 124],
          [46, 79],
        ] as [number, number][]) {
          const p = svg.createSVGPoint();
          p.x = x;
          p.y = y;
          const s = p.matrixTransform(m);
          corners.push([s.x, s.y]);
        }
      }
    }
    // How much of the square on the hypotenuse is actually inked right now: framer-motion draws
    // it with a dash offset, so the painted fraction is 1 - offset/length.
    const sq = document.querySelector('[data-glass-part="square on the hypotenuse"]') as
      | (SVGPathElement & { getTotalLength(): number })
      | null;
    let squareDrawn = -1;
    if (sq) {
      const style = getComputedStyle(sq);
      const total = sq.getTotalLength();
      const off = Number.parseFloat(style.strokeDashoffset || '0');
      const dash = style.strokeDasharray;
      squareDrawn = dash === 'none' || !dash ? 1 : Math.max(0, 1 - Math.abs(off) / (total || 1));
    }
    return { parts, corners, squareDrawn };
  });
}

/** The ring the screen store paints on one glass id, exactly as `land` puts a mark down. */
async function ring(page: Page, target: string, markId = 'w62-ring'): Promise<Box | null> {
  await page.evaluate(async ({ id, markId }) => {
    const inspector = (window as unknown as Lab).__woboGlassRead;
    if (!inspector) throw new Error('no glass inspector');
    await inspector.settle();
    inspector.take();
    const { screenStore } = (await import('/src/wobo/board-turn.ts')) as {
      screenStore: { applyEvent: (e: unknown) => void };
    };
    screenStore.applyEvent({
      type: 'ink',
      t: 0,
      object: {
        id: markId,
        kind: 'circle',
        anchor: { target: id },
        pad: 9,
        words: 'this one',
        style: { ink: 'wobo', weight: 2 },
        t: { start: 0, dur: 1 },
      },
    });
  }, { id: target, markId });
  // THE PEN IS NOT SLOWED BY A SMALLER BOX: the wait for the first painted stroke of this mark,
  // from the moment the event was applied.
  const onset = await page.evaluate(
    (mid) =>
      new Promise<number>((done) => {
        const t0 = performance.now();
        const look = () => {
          const node = document.querySelector(`[data-wobo-object^="${mid}"] path`);
          if (node) return done(Math.round(performance.now() - t0));
          if (performance.now() - t0 > 3000) return done(-1);
          requestAnimationFrame(look);
        };
        look();
      }),
    markId,
  );
  console.log(`   first stroke of ${markId}: ${onset} ms after the mark was applied`);
  await page.waitForTimeout(1200);
  const diag = await page.evaluate((id) => {
    const inspector = (window as unknown as Lab).__woboGlassRead;
    const map = inspector?.take();
    const rect = inspector?.rectOf(id) ?? null;
    return {
      onMap: map?.entries.some((e) => e.id === id) ?? false,
      rect: rect ? [rect.x, rect.y, rect.width, rect.height] : null,
      objects: Array.from(document.querySelectorAll('[data-wobo-object]')).map((n) =>
        n.getAttribute('data-wobo-object'),
      ),
    };
  }, target);
  console.log('   ring diag', JSON.stringify(diag));
  return page.evaluate((mid) => {
    const node = document.querySelector(`[data-wobo-object^="${mid}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height] as Box;
  }, markId);
}

const holds = (box: Box, [x, y]: Pt): boolean =>
  x >= box[0] && x <= box[0] + box[2] && y >= box[1] && y <= box[1] + box[3];

/** The shortest distance between two boxes; negative when they overlap. */
function gap(a: Box, b: Box): number {
  if (!a || !b) return Number.NaN;
  const dx = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]));
  const dy = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

const out: Record<string, unknown> = {};

for (const screen of SCREENS) {
  test(`the hypotenuse, ringed, at ${screen.name}`, async ({ page }) => {
    await arrive(page, screen);
    await page.waitForTimeout(screen.reduced ? 300 : 2500);
    const before = await figure(page);
    await page.screenshot({ path: join(SHOTS, `${screen.name}-drawing.png`) });
    const ringBox = await ring(page, 'course-intro-mathematics.hypotenuse');
    await page.screenshot({ path: join(SHOTS, `${screen.name}-ring.png`) });
    const corners = before.corners;
    const record = {
      parts: before.parts,
      corners,
      squareDrawn: before.squareDrawn,
      ring: ringBox,
      cornersInsideRing: ringBox ? corners.filter((c) => holds(ringBox, c)).length : -1,
      // The air between the ring's own painted box and the ink it must not touch, in CSS px:
      // leg A-B lies along the corners' shared y, leg A-C along their shared x, and c² is a part.
      air: ringBox
        ? {
            legAB: (corners[0]?.[1] ?? 0) - (ringBox[1] + ringBox[3]),
            legAC: ringBox[0] - (corners[0]?.[0] ?? 0),
            cSquared: gap(ringBox, before.parts['.c²'] as Box),
            rightAngle: gap(ringBox, before.parts['.right-angle'] as Box),
          }
        : null,
    };
    out[screen.name] = record;
    writeFileSync(join(SHOTS, 'measured.json'), JSON.stringify(out, null, 2));
    console.log(screen.name, JSON.stringify(record));
  });
}
