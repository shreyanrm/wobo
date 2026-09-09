/**
 * WHERE THE INK IS, AND HOW LONG THE GLASS IS HELD — measured on real screens
 * (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace; the adversary's findings 4, 11 and 15, 2026-09-08).
 *
 * Three things the lab caught, each proved here on the app's own page, at 390 and 1440, light and
 * dark, and under reduced motion:
 *
 *  4. THE PEN IS ABOVE EVERYTHING WOBO OWNS. The fixed ink surface had `z-index: auto` while the
 *     Wobo dialog had 900, so at 1440 every ring at x >= 1020 was drawn UNDER the chat panel and
 *     "ink holds while the ask is open" held an invisible ring. `document.elementsFromPoint` at
 *     the ring's own centre is the proof: Wobo's ink has to come before Wobo's dialog.
 * 15. THE SHEET, THE TOAST AND THE PILL DO NOT COVER THE INK. At 390 the "Your course is ready"
 *     toast and the Tell Wobo pill sat over the folded strip through every turn, and the sheet
 *     unfolded modal over the marks at the turn's end. They stand aside for as long as the ink is
 *     up (wobo/clearance.ts) and every one of them comes back after it.
 * 11. THE HOLD IS SHORT AND HONEST, and wave 33's best moment is back: with the glass released,
 *     a scroll carries the ring with it, to the pixel.
 *
 * Every frame is kept beside the numbers under WOBO_INK_SHOTS (default: a temp dir).
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, seedOnboarded } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SHOTS = process.env.WOBO_INK_SHOTS ?? join(tmpdir(), 'wobo-ink');
mkdirSync(SHOTS, { recursive: true });

type Box = [number, number, number, number];

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
  take: (options?: { question?: string }) => { entries: { id: string; box: Box }[] };
  rectOf: (id: string) => DOMRect | null;
  settle: () => Promise<void>;
  hold: () => { held: boolean; released: string | null };
  freeze: (reason?: string) => void;
  release: (why?: 'escape' | 'tap' | 'voice' | 'end') => void;
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
  await page.waitForTimeout(screen.reduced ? 200 : 1400);
}

/** Wobo's drawer, open, as a learner asks from it. */
async function openDrawer(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const drawer = (await import('/src/wobo/drawer.ts')) as {
      openCompanion: (request: { reason: 'reteach' }) => void;
    };
    drawer.openCompanion({ reason: 'reteach' });
  });
  await expect(page.getByRole('dialog', { name: 'Wobo' })).toBeVisible();
}

/**
 * A ring on the page, put down through the app's own screen store — the same call the conductor
 * makes when a mark lands (`board-turn.ts`, `land`). The glass is read first, so the ring anchors
 * to a real glass id and re-measures its own live box like any other mark.
 */
async function ringOn(page: Page, question: string, pick: 'widest' | 'rightmost'): Promise<string> {
  return page.evaluate(
    async ({ q, how }) => {
      const inspector = (window as unknown as Lab).__woboGlassRead;
      if (!inspector) throw new Error('no glass inspector on this page');
      // No question: a read that names a subject may scroll it onto the glass, and this test is
      // about where the ink lands, not about what the map chooses. The fold settles first, exactly
      // as a turn's own read waits for it, so the boxes are the folded page's and not a ghost.
      void q;
      await inspector.settle();
      const map = inspector.take();
      // only an entry whose live handle still measures: a mark on one that cannot be re-measured
      // is a mark with nothing to hang from, and this test is not about that failure
      const candidates = map.entries.filter(
        (e) => e.box[2] > 40 && e.box[3] > 8 && inspector.rectOf(e.id) !== null,
      );
      if (candidates.length === 0) throw new Error('nothing on the glass to ring');
      const chosen =
        how === 'rightmost'
          ? candidates.reduce((a, b) => (a.box[0] + a.box[2] > b.box[0] + b.box[2] ? a : b))
          : candidates.reduce((a, b) => (a.box[2] > b.box[2] ? a : b));
      const { screenStore } = (await import('/src/wobo/board-turn.ts')) as {
        screenStore: { applyEvent: (e: unknown) => void };
      };
      screenStore.applyEvent({
        type: 'ink',
        t: 0,
        object: {
          id: 'proof-ring',
          kind: 'circle',
          anchor: { target: chosen.id },
          pad: 9,
          words: 'this one',
          style: { ink: 'wobo', weight: 2 },
          t: { start: 0, dur: 1 },
        },
      });
      return chosen.id;
    },
    { q: question, how: pick },
  );
}

/** Let the screen's ink go, the way the turn's end does. */
async function letInkGo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { screenStore } = (await import('/src/wobo/board-turn.ts')) as {
      screenStore: { release: (at?: number) => void; sweep: () => void; time: () => number };
    };
    screenStore.release(screenStore.time());
  });
}

/** The one mark this spec puts down; the renderer names a node `<id>#<generation>`. */
const RING_SELECTOR = '[data-wobo-object^="proof-ring"]';

/** The ring's box on the screen right now, straight off the painted path. */
function ringBox(page: Page): Promise<Box | null> {
  return page.evaluate(() => {
    const node = document.querySelector('[data-wobo-object^="proof-ring"]');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height] as Box;
  });
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

for (const screen of SCREENS) {
  test.describe(`${screen.name}`, () => {
    test('the pen is above everything Wobo owns, and Wobo gets out of its way', async ({
      page,
    }) => {
      await arrive(page, screen);
      // The ring goes down on the page the learner is reading, and THEN they open Wobo's drawer —
      // which is how the lab's failure happened: at 1440 the panel came down the right and every
      // ring at x >= 1020 was under it. So ring the rightmost thing on the glass on purpose.
      const target = await ringOn(
        page,
        'what is this about?',
        screen.width > 720 ? 'rightmost' : 'widest',
      );
      await expect(page.locator(RING_SELECTOR)).toBeVisible();
      await page.waitForTimeout(200);
      const box = await ringBox(page);
      expect(box, `the ring on ${target} is painted on the screen`).not.toBeNull();
      if (!box) return;

      await openDrawer(page);
      await page.waitForTimeout(400);
      await shot(page, `${screen.name}-ink-over-the-panel`);

      // FINDING 4. The ink surface never takes a tap — a layer over the chat that swallowed taps
      // would be worse than one under it — so `elementsFromPoint` at the ring's own centre reports
      // what could be COVERING the ring, and paint order is what decides whether it does.
      const centre: [number, number] = [box[0] + box[2] / 2, box[1] + box[3] / 2];
      const stack = await page.evaluate(
        ([x, y]) =>
          document
            .elementsFromPoint(x, y)
            .map((el) => {
              const e = el as HTMLElement;
              return {
                role: e.getAttribute('role') ?? '',
                label: e.getAttribute('aria-label') ?? '',
              };
            })
            .slice(0, 12),
        centre,
      );
      const layers = await page.evaluate(() => {
        const svg = document.querySelector('[aria-label="Wobo\'s ink on this screen"]');
        const host = svg?.closest('.wobo-board') as HTMLElement | null;
        const dialog = document.querySelector(
          '[role="dialog"][aria-label="Wobo"]',
        ) as HTMLElement | null;
        const z = (el: HTMLElement | null) =>
          el ? Number(getComputedStyle(el).zIndex) : Number.NaN;
        return {
          ink: z(host),
          panel: z(dialog),
          inkTaps: host ? getComputedStyle(host).pointerEvents : null,
          // both are fixed children of the same root, so the two numbers are comparable
          inkParent: host?.parentElement?.tagName.toLowerCase() ?? null,
          panelParent: dialog?.parentElement?.tagName.toLowerCase() ?? null,
          panelBox: dialog
            ? (() => {
                const r = dialog.getBoundingClientRect();
                return [r.x, r.y, r.width, r.height];
              })()
            : null,
        };
      });
      expect(layers.inkTaps, "the ink never steals the learner's taps").toBe('none');
      expect(Number.isFinite(layers.ink), 'the ink has a layer of its own').toBe(true);
      expect(layers.ink).toBeGreaterThan(layers.panel);
      expect(layers.inkParent).toBe(layers.panelParent);

      // and where the panel really is over the ring, the ring's pixels reach the screen: hide the
      // ink surface and the same clip changes. Under the panel (wave 39) it would not change at all.
      const panel = layers.panelBox as [number, number, number, number] | null;
      const overlaps =
        panel !== null &&
        box[0] + box[2] > panel[0] &&
        box[0] < panel[0] + panel[2] &&
        box[1] + box[3] > panel[1] &&
        box[1] < panel[1] + panel[3];
      if (overlaps && panel) {
        const x = Math.max(box[0], panel[0]) + 2;
        const clip = {
          x,
          y: Math.max(box[1], panel[1]),
          width: Math.max(8, Math.min(48, box[0] + box[2] - x)),
          height: Math.max(8, Math.min(48, box[1] + box[3] - Math.max(box[1], panel[1]))),
        };
        const withInk = await page.screenshot({ clip });
        await page.evaluate(() => {
          const svg = document.querySelector('[aria-label="Wobo\'s ink on this screen"]');
          const host = svg?.closest('.wobo-board') as HTMLElement | null;
          if (host) host.style.visibility = 'hidden';
        });
        const withoutInk = await page.screenshot({ clip });
        await page.evaluate(() => {
          const svg = document.querySelector('[aria-label="Wobo\'s ink on this screen"]');
          const host = svg?.closest('.wobo-board') as HTMLElement | null;
          if (host) host.style.visibility = '';
        });
        expect(
          Buffer.compare(withInk, withoutInk),
          `the ring's pixels are on the screen where the panel is over it (stack ${JSON.stringify(stack)})`,
        ).not.toBe(0);
      }

      // FINDING 15: Wobo's own furniture stands aside while the ink is up.
      await expect(page.locator('html')).toHaveAttribute('data-wobo-ink', '');
      const clear = await page.evaluate(() => {
        const toast = document.querySelector('[data-wobo-toast]') as HTMLElement | null;
        const pill = document.querySelector('.wf-float') as HTMLElement | null;
        return {
          toast: toast ? getComputedStyle(toast).opacity : null,
          toastLive: toast ? toast.getAttribute('aria-live') : null,
          pill: pill ? getComputedStyle(pill).visibility : null,
        };
      });
      if (clear.toast !== null) {
        expect(clear.toast).toBe('0');
        // faded, never hidden: a course that finishes composing mid-turn is still announced
        expect(clear.toastLive).toBe('polite');
      }
      if (clear.pill !== null) expect(clear.pill).toBe('hidden');

      // and every one of them comes back the moment the ink goes
      await letInkGo(page);
      await page.waitForTimeout(900);
      await expect(page.locator('html')).not.toHaveAttribute('data-wobo-ink', '');
      const back = await page.evaluate(() => {
        const toast = document.querySelector('[data-wobo-toast]') as HTMLElement | null;
        const pill = document.querySelector('.wf-float') as HTMLElement | null;
        return {
          toast: toast ? getComputedStyle(toast).opacity : null,
          pill: pill ? getComputedStyle(pill).visibility : null,
        };
      });
      if (back.toast !== null) expect(back.toast).toBe('1');
      if (back.pill !== null) expect(back.pill).toBe('visible');
      await shot(page, `${screen.name}-furniture-back`);
    });

    test('a released scroll carries the ring, and the sheet returns after the turn', async ({
      page,
    }) => {
      await arrive(page, screen);
      // The drawer belongs in this test only where it folds. At 1440 it is a modal panel, and a
      // modal is an occluder: the glass read drops what is behind it, the ring's subject leaves
      // the glass and the mark fades, which is the law working. The 1440 panel is proved above.
      if (screen.width < 720) await openDrawer(page);
      const sheet = page.getByRole('dialog', { name: 'Wobo' });

      // the freeze: on a phone the sheet folds to a strip so the page is in front of the learner
      await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.freeze('turn'));
      await ringOn(page, 'what is this about?', 'widest');
      await expect(page.locator(RING_SELECTOR)).toBeVisible();
      await page.waitForTimeout(200);
      if (screen.width < 720) {
        const strip = page.locator('[data-glass-strip]');
        await expect(strip).toBeVisible();
        const folded = await strip.boundingBox();
        expect(folded?.height ?? 999).toBeLessThanOrEqual(140);
        // not modal: the page behind the strip is the learner's
        expect(await sheet.getAttribute('aria-modal')).toBeNull();
      }
      await shot(page, `${screen.name}-held`);

      // FINDING 11: the glass is let go the instant the last stroke lands. Then the page scrolls,
      // and the ring goes with it — wave 33's best moment, back inside a turn.
      await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.release('end'));
      const heldAfter = await page.evaluate(
        () => (window as unknown as Lab).__woboGlassRead?.hold().held,
      );
      expect(heldAfter).toBe(false);
      // the ink is still up, so the sheet stays folded over nothing rather than over the marks
      if (screen.width < 720) await expect(page.locator('[data-glass-strip]')).toBeVisible();

      const before = await ringBox(page);
      expect(before).not.toBeNull();
      // whichever way there is room: the read may already have brought the subject to the foot
      // of the page, and a scroll of nothing proves nothing.
      // The app's own scroller, found from what is under the ring, and given time: the shell
      // scrolls smoothly, so the new position is only true a few frames later.
      const scrollTop = (cx: number, cy: number) =>
        page.evaluate(
          (point: { x: number; y: number }) => {
            const found = (() => {
              let node = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
              while (node) {
                const overflow = getComputedStyle(node).overflowY;
                if (node.scrollHeight - node.clientHeight > 8 && /auto|scroll/.test(overflow)) {
                  return node as Element;
                }
                node = node.parentElement;
              }
              return document.scrollingElement ?? document.documentElement;
            })();
            (window as unknown as { __inkScroller?: Element }).__inkScroller = found;
            return { top: found.scrollTop, room: found.scrollHeight - found.clientHeight };
          },
          { x: cx, y: cy },
        );
      const centre: [number, number] = [
        (before?.[0] ?? 0) + (before?.[2] ?? 0) / 2,
        (before?.[1] ?? 0) + (before?.[3] ?? 0) / 2,
      ];
      const at = await scrollTop(centre[0] ?? 0, centre[1] ?? 0);
      await page.evaluate((place: { top: number; room: number }) => {
        const el = (window as unknown as { __inkScroller?: Element }).__inkScroller;
        if (!el) return;
        const delta = place.top > 140 ? -140 : Math.min(140, place.room - place.top);
        el.scrollTo({ top: place.top + delta, behavior: 'instant' as ScrollBehavior });
      }, at);
      await page.waitForTimeout(500);
      const moved = await page
        .evaluate(() => {
          const el = (window as unknown as { __inkScroller?: Element }).__inkScroller;
          return el ? el.scrollTop : 0;
        })
        .then((now) => now - at.top);
      const after = await ringBox(page);
      await shot(page, `${screen.name}-scrolled`);
      expect(
        Math.abs(moved),
        'the page actually scrolled once the glass was let go',
      ).toBeGreaterThan(0);
      if (before && after) {
        // zero drift: the ring rode the scroll exactly, because it re-measures its own live box
        expect(Math.abs(after[1] - (before[1] - moved))).toBeLessThanOrEqual(1.5);
        expect(Math.abs(after[0] - before[0])).toBeLessThanOrEqual(1);
      }

      // the turn is over: the ink goes and the sheet comes back, over a page with nothing on it
      await letInkGo(page);
      await page.waitForTimeout(900);
      if (screen.width < 720) {
        await expect(page.locator('[data-glass-strip]')).toHaveCount(0);
        expect(await sheet.getAttribute('aria-modal')).toBe('true');
      }
      await shot(page, `${screen.name}-sheet-returned`);
    });
  });
}
