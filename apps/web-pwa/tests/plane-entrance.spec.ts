/**
 * THE PLANE NEVER ENTERS FROM OFF THE GLASS (the judge, wave 61, finding 1; INK-FOUR craft and
 * timing).
 *
 * "Nothing off the viewport" is the craft law, and "the first stroke is on the glass within one
 * second of the learner asking" is the timing law. Both were being spent by the board's own
 * entrance rather than by anything the hand drew.
 *
 * MEASURED HERE ON 2026-09-15, before a line of `plane.tsx` was changed. At 390x844 the sheet's
 * first painted frame had its top at 882 on an 844 px screen — the whole sheet below the glass —
 * and the board's first object landed at y = 1173, three hundred and thirty pixels under the fold;
 * nothing of the board was on the glass for the first 80 ms and the surface was not still for 434.
 * At 1440x900 the same: the panel's first frame started at 996 on a 900 px screen, seated at 442.
 * The cause was arithmetic, not animation — the entrance offset was computed from `state.rect`,
 * the 520x360 box the plane is given on a wide screen, while the box the plane actually occupies
 * on a phone is a full-width sheet across the lower 62vh. A slide aimed at the orb from the wrong
 * centre is a slide from nowhere.
 *
 * THE LAB IS SILENT and keyless (docs/INK-FOUR.md): `--mute-audio` comes from the shared config and
 * the bench feeds a fixture plan with no gateway and no model behind it.
 */

import { expect, test } from '@playwright/test';

/** The board's own surface, the moment it is summoned, sampled frame by frame. */
async function entrance(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const t0 = performance.now();
    let firstFrame: { top: number; left: number; right: number; bottom: number } | null = null;
    let firstInkOnGlass = -1;
    let seated = -1;
    let last = Number.NaN;
    let still = 0;
    let worstInkY = Number.NEGATIVE_INFINITY;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const end = t0 + 4000;
    while (performance.now() < end) {
      const sec = document.querySelector('.wobo-chrome-plane') as HTMLElement | null;
      if (sec) {
        const r = sec.getBoundingClientRect();
        if (!firstFrame)
          firstFrame = {
            top: Math.round(r.top),
            left: Math.round(r.left),
            right: Math.round(r.right),
            bottom: Math.round(r.bottom),
          };
        const nodes = sec.querySelectorAll('svg path, svg text');
        if (firstInkOnGlass < 0)
          for (const el of Array.from(nodes)) {
            const n = (el as SVGGraphicsElement).getBoundingClientRect();
            if (n.width > 0 && n.y + n.height > 0 && n.y < vh) {
              firstInkOnGlass = performance.now() - t0;
              break;
            }
          }
        if (firstInkOnGlass < 0 && nodes.length > 0) {
          const n = (nodes[0] as SVGGraphicsElement).getBoundingClientRect();
          worstInkY = Math.max(worstInkY, Math.round(n.y));
        }
        if (Math.abs(r.top - last) < 0.25) {
          still += 1;
          if (still >= 4 && seated < 0) seated = performance.now() - t0;
        } else still = 0;
        last = r.top;
        if (seated >= 0 && firstInkOnGlass >= 0) break;
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return {
      firstFrame,
      firstInkOnGlass: Math.round(firstInkOnGlass),
      seated: Math.round(seated),
      worstInkY: Number.isFinite(worstInkY) ? worstInkY : null,
      vw,
      vh,
    };
  });
}

/** The board a learner is most likely to be shown at 390: twenty-one objects on a phone sheet. */
const BOARD = 'timeline';

const WIDTHS = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;

for (const width of WIDTHS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const motion of ['full', 'reduced'] as const) {
      test.describe(`${width.name} ${theme} ${motion}`, () => {
        test.use({ viewport: width.viewport, colorScheme: theme });

        test('the plane’s first painted frame is on the glass, and so is its first ink', async ({
          page,
        }) => {
          await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
          });
          await page.goto(`/board-bench.html?load=1#board-bench/${BOARD}`);
          await expect(page.getByTestId('board-bench')).toHaveAttribute('data-board', BOARD);
          await page.getByTestId('bench-plane').click();
          const seen = await entrance(page);
          console.log(`${width.name} ${theme} ${motion} ${JSON.stringify(seen)}`);

          const f = seen.firstFrame;
          expect(f, 'the plane never painted').not.toBeNull();
          // NOTHING OFF THE VIEWPORT, on the very first frame the learner could see.
          expect(
            {
              top: (f as { top: number }).top >= 0,
              bottom: (f as { bottom: number }).bottom <= seen.vh,
              left: (f as { left: number }).left >= 0,
              right: (f as { right: number }).right <= seen.vw,
            },
            `first frame ${JSON.stringify(f)} on a ${seen.vw}x${seen.vh} screen`,
          ).toEqual({ top: true, bottom: true, left: true, right: true });

          // NO FRAME OF THE BOARD IS EVER PAINTED OFF THE GLASS. This is the y = 1173 of the
          // finding, and it is a yes or no rather than a clock: `worstInkY` is set only when a
          // sample found ink that was NOT on the screen, so a null is the law held on every frame
          // between the summon and the first visible stroke.
          expect(
            seen.worstInkY,
            `the board painted its ink at y=${seen.worstInkY} on a ${seen.vh} px screen before any of it was visible`,
          ).toBeNull();

          // And it reaches the glass at once rather than after the surface has flown in. The law is
          // one second (docs/BOARD.md §10); this is two orders inside it, with room for the frame
          // the sampler itself costs.
          expect(
            seen.firstInkOnGlass,
            `the board's first ink reached the glass after ${seen.firstInkOnGlass} ms`,
          ).toBeLessThanOrEqual(120);
        });
      });
    }
  }
}
