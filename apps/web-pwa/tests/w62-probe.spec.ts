/** TEMPORARY LAB (wave 62 closer): why the drawing paints only 1/k of every stroke. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, seedOnboarded } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SHOTS = process.env.W62_SHOTS ?? '/tmp/w62';
mkdirSync(SHOTS, { recursive: true });

async function arrive(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
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
  await page.getByRole('link', { name: /Linear equations in one variable/ }).first().click();
  await page
    .getByRole('link', { name: /^Solving equations with the variable on one side/ })
    .first()
    .click();
  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`what the square's dash actually is at ${w}`, async ({ page }) => {
    await arrive(page, w, h);
    const probe = await page.evaluate(() => {
      const sq = document.querySelector(
        '[data-glass-part="square on the hypotenuse"]',
      ) as SVGPathElement | null;
      if (!sq) return null;
      const svg = sq.ownerSVGElement as SVGSVGElement;
      const k = svg.getBoundingClientRect().width / 200;
      const cs = getComputedStyle(sq);
      return {
        k,
        pathLengthAttr: sq.getAttribute('pathLength'),
        dasharray: cs.strokeDasharray,
        dashoffset: cs.strokeDashoffset,
        vectorEffect: cs.vectorEffect,
        totalLength: sq.getTotalLength(),
        strokeWidth: cs.strokeWidth,
        painted: sq.getBoundingClientRect().width,
      };
    });
    console.log(`probe-${w}`, JSON.stringify(probe));
    await page.screenshot({ path: join(SHOTS, `probe-${w}-before.png`) });
    // AND THE WEIGHT SURVIVES A RESIZE: the frame re-measures, so the painted stroke is the same
    // four (and two and a half) screen pixels at every width.
    const painted = async () =>
      page.evaluate(() => {
        const part = document.querySelector('[data-glass-part="triangle"]');
        const svg = part instanceof SVGElement ? part.ownerSVGElement : null;
        if (!svg) return null;
        const k = svg.getBoundingClientRect().width / 200;
        const px = (sel: string) => {
          const el = document.querySelector(sel) as SVGElement | null;
          return el ? Number.parseFloat(getComputedStyle(el).strokeWidth) * k : null;
        };
        return {
          k,
          triangle: px('[data-glass-part="triangle"]'),
          rightAngle: px('[data-glass-part="right angle"]'),
          square: px('[data-glass-part="square on the hypotenuse"]'),
        };
      });
    console.log(`painted-${w}`, JSON.stringify(await painted()));
    await page.setViewportSize({ width: w === 1440 ? 390 : 1440, height: h });
    await page.waitForTimeout(600);
    console.log(`painted-after-resize-from-${w}`, JSON.stringify(await painted()));
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);

    // Flip vector-effect off on every stroked mark and look again.
    await page.evaluate(() => {
      for (const el of Array.from(
        document.querySelectorAll('[data-glass-part], svg path, svg circle'),
      )) {
        (el as SVGElement).style.vectorEffect = 'none';
      }
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `probe-${w}-no-vector-effect.png`) });
  });
}
