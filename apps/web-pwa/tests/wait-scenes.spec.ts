/**
 * THE WAIT, ON THE GLASS (docs/EMAILS-AND-ANIMATIONS.md §3; docs/THE-WAIT.md §1).
 *
 * "Ten seconds looped, calm, both themes, reduced motion (a still with the spark) [...] Measure at
 * 390 and 1440."
 *
 * WHAT WAS ALREADY PROVEN WITHOUT A BROWSER, and is deliberately not repeated here:
 *   - the geometry of the seven scenes, the ten second loop, the seam at the ends of it, and the
 *     still a reduced-motion learner is given (`packages/wobo/src/body/wait.test.ts`);
 *   - the markup a screen reader meets, and that a scene renders no text at all
 *     (`src/ui/WaitScene.test.tsx`);
 *   - that no waiting state anywhere in the app carries a narrating word
 *     (`src/screens/states/waiting-never-narrates.test.ts`).
 *
 * WHAT ONLY A BROWSER CAN SAY, which is what this lab measures. A pure test can prove the scene is
 * a good drawing; it cannot prove the drawing reaches the glass. Every assertion below is about
 * something a learner would see on a phone:
 *   1. the scene is DRAWN — marks on the page, lit, inside the box;
 *   2. it MOVES — the rAF loop is really running, so the wait is watched rather than frozen;
 *   3. it SAYS NOTHING — no word and no percentage in the waiting card, measured as rendered text
 *      rather than as source;
 *   4. it FITS at 390 and at 1440, with no sideways scroll;
 *   5. it is drawn in the THEME's own ink, in both;
 *   6. reduced motion is a STILL, and the spark is on it;
 *   7. its own box never changes size while it loops, which is what lets the real content replace
 *      it without the page jumping.
 *
 * THE SURFACE IS A REAL ONE, not a bench: the subject screen's first cold request, which is the
 * wait a learner meets on a board whose chapters have never been read (BOARD-COLD-START §2). The
 * gateway is replaced at the app's own client seam and the units request is HELD open, so the
 * screen sits in the state under test for as long as the measurement needs and nothing leaves the
 * machine.
 *
 * A LAB IS SILENT (the owner, 2026-09-09): the browser is launched muted by
 * tests/wait-scenes.config.ts, and nothing here asks for a voice.
 *
 * Run it:
 *     cd apps/web-pwa && bunx playwright test --config tests/wait-scenes.config.ts
 */

import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded } from './helpers';
import { seedAtomWorld } from './helpers/brain';
import { applyTheme, type Theme } from './helpers/proof';

/** The two widths the design names. */
const PHONE = { width: 390, height: 844 } as const;
const LAPTOP = { width: 1440, height: 900 } as const;

/** The waiting card on the subject screen, and the scene's own svg inside it. */
const CARD = '.sb-wait';
const SCENE = '.sb-wait [role="status"] > svg';

/**
 * The spark, by the one path that draws it (`WoboBody.tsx`). Reduced motion is a still WITH the
 * spark, without exception (the library's rule 4), so the still has to be able to prove it.
 */
const SPARK = '.sb-wait g > path[d^="M115 22"]';

/**
 * Put the subject screen into its first cold wait and hold it there.
 *
 * The client is installed on the home screen, BEFORE the subject screen mounts: `useUnits` reads
 * `curriculumReady()` once per subject and returns early when there is no brain, so a client
 * installed after the mount would never be asked anything and the screen would fall through to an
 * end state instead of the wait. Home asks the curriculum layer for nothing, so it is the safe
 * place to stand while installing.
 *
 * The units request is then held open for ever. That is the honest shape of the state under test:
 * a request in flight with nothing behind it yet.
 */
async function openHeldWait(page: Page): Promise<void> {
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();

  await page.evaluate(async () => {
    const CLIENT_MODULE = '/src/curriculum/client.ts';
    const app = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
      setCurriculumClient: (client: unknown) => void;
    };
    // Never settles: the wait under test is a request that has not come back.
    const held = new Promise<never>(() => {});
    const empty = async () => ({}) as unknown;
    app.setCurriculumClient({
      search: async () => ({ query: '', country: null, results: [], not_listed: null }),
      framework: empty,
      units: () => held,
      topics: empty,
      pin: empty,
      upgrade: empty,
      overlayGet: empty,
      overlayApply: empty,
      status: empty,
    });
  });

  // Into the subject screen without a reload, which would take the brain with it. The router
  // follows the browser's own history (`applyPop`), so this is the same move as a tap on a tile.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/subject/Mathematics/learn');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForSelector(CARD, { timeout: 15_000 });
}

/**
 * Every mark of the scene as it stands right now: the tag and the geometry, with `style` left out
 * because the clock writes attributes rather than styles. Two identical samples a moment apart
 * mean the scene is not moving.
 */
async function sampleScene(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    if (!svg) return [];
    return Array.from(svg.children).map((el) => {
      const attrs = Array.from(el.attributes)
        .filter((a) => a.name !== 'style')
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join(' ');
      return `${el.tagName} ${attrs}`;
    });
  }, SCENE);
}

/**
 * Every run of text in the waiting card that is actually PAINTED, which is the only kind a learner
 * can read.
 *
 * `innerText` is the obvious tool here and it is the wrong one, measured on 2026-09-16: against
 * this very surface it returns "z\nz". Wobo's sleeping z's are carried by every rig and shown only
 * when Wobo is dozing, so on a wait they sit in a `<g>` whose computed display is `none`, whose
 * opacity is `0`, and whose boxes measure 0x0 — nothing is on the screen. Chromium's `innerText`
 * includes SVG `<text>` from inside a hidden group anyway, so an assertion built on it fails on
 * letters no child has ever seen, and would have been "fixed" by loosening the law it was written
 * to keep.
 *
 * `Range.getBoundingClientRect()` over the same text node is the second obvious tool and is wrong
 * the same way: measured here, it reports a real box for those z's even though the `<text>` element
 * itself measures 0x0 inside a group that is not displayed. Neither API is a reliable witness for
 * SVG text.
 *
 * So the question is put to the ancestor chain, which cannot be fooled: a run of text counts only
 * if nothing between it and the card is `display: none`, `visibility: hidden` or fully transparent,
 * AND the element carrying it has a real box. A word that survives that is a word on the screen,
 * and a word on the screen during a wait is a word that narrates.
 */
async function paintedText(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return ['the waiting card was not on the page'];
    const hidden = (from: Element): boolean => {
      for (let n: Element | null = from; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) {
          return true;
        }
        if (n === card) break;
      }
      return false;
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || hidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(text);
    }
    return out;
  }, CARD);
}

/** The waiting card's own box, and the bar above it — what a jump would move. */
async function geometry(page: Page): Promise<{ card: string; bar: string }> {
  return page.evaluate((sel) => {
    const box = (el: Element | null): string => {
      if (!el) return 'none';
      const r = el.getBoundingClientRect();
      return `${Math.round(r.top)}x${Math.round(r.height)}`;
    };
    return {
      card: box(document.querySelector(sel)),
      bar: box(document.querySelector('header, .tb, [class*="topbar" i]')),
    };
  }, CARD);
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

for (const view of [PHONE, LAPTOP]) {
  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`${view.width}x${view.height}, ${theme}: the orb does the subject's thing, and says nothing`, async ({
      page,
    }) => {
      await page.setViewportSize(view);
      await openHeldWait(page);
      await applyTheme(page, theme);

      // 1. It is drawn, and it is lit. A wait that shows nothing is a blank screen.
      const marks = await sampleScene(page);
      expect(marks.length).toBeGreaterThanOrEqual(3);
      const lit = await page.evaluate((sel) => {
        const svg = document.querySelector(sel);
        if (!svg) return 0;
        return Array.from(svg.children).filter(
          (el) => Number(el.getAttribute('opacity') ?? '1') > 0.05,
        ).length;
      }, SCENE);
      expect(lit).toBeGreaterThan(0);

      // 2. It moves: the clock is really running, on this width, in this theme.
      await wait(page, 700);
      expect(await sampleScene(page)).not.toEqual(marks);

      // 3. It says nothing at all. Rendered text, not source: this is the half of the
      //    never-narrate law that only the glass can answer.
      const painted = await paintedText(page);
      expect(painted).toEqual([]);
      expect(painted.join(' ')).not.toMatch(/\d\s?%/);

      // 4. It fits, and the page does not scroll sideways to hold it.
      const box = await page.locator(CARD).boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(view.width + 1);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      // 7. Its box never changes while it loops. A scene that resized itself mid-loop would move
      //    the page under the learner, and would move it again when the real content arrived.
      const before = await geometry(page);
      await wait(page, 1_200);
      expect(await geometry(page)).toEqual(before);
    });
  }
}

/**
 * The instrument, checked against itself.
 *
 * `paintedText` had to be written twice (see its own note), and a measurement that quietly stops
 * measuring is worse than none: every assertion about the never-narrate law on this surface rests
 * on it, and all of them pass by returning an empty list. So one caption is painted into the
 * waiting card on purpose and has to be caught. If this test ever goes green by finding nothing,
 * the four above it are green for the same bad reason.
 */
test('the never-narrate guard bites: a caption painted into the wait is caught', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openHeldWait(page);
  expect(await paintedText(page)).toEqual([]);

  await page.evaluate((sel) => {
    const line = document.createElement('p');
    line.textContent = 'Loading your lesson';
    document.querySelector(sel)?.appendChild(line);
  }, CARD);

  expect(await paintedText(page)).toContain('Loading your lesson');
});

test('the scene is drawn in the theme’s own ink, and the two themes differ', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openHeldWait(page);

  const inkOf = async (): Promise<string> =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)?.querySelector('line, circle, rect, path');
      if (!el) return 'none';
      const s = getComputedStyle(el);
      return `${s.stroke}|${s.fill}`;
    }, SCENE);

  await applyTheme(page, 'light');
  const light = await inkOf();
  await applyTheme(page, 'dark');
  const dark = await inkOf();

  expect(light).not.toBe('none');
  expect(dark).not.toBe('none');
  // The rig's own tokens resolve per theme (`palette.ts`); a scene with a colour of its own could
  // not tell these apart, and would be unreadable in one of the two.
  expect(light).not.toBe(dark);
});

test('reduced motion is a still, with the spark on it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await openHeldWait(page);

  // A still: the same marks, in the same places, however long it is watched.
  const first = await sampleScene(page);
  await wait(page, 900);
  expect(await sampleScene(page)).toEqual(first);

  // And a legible one — the moment the scene is recognisable from, never an empty first frame.
  const strong = await page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    if (!svg) return 0;
    return Array.from(svg.children).filter((el) => Number(el.getAttribute('opacity') ?? '1') > 0.3)
      .length;
  }, SCENE);
  expect(strong).toBeGreaterThan(1);

  // The spark is what a still keeps (the library's rule 4, DESIGN.md §2 law 9).
  const sparkShown = await page.evaluate((sel) => {
    const path = document.querySelector(sel);
    const group = path?.parentElement;
    if (!group) return null;
    const s = getComputedStyle(group as unknown as Element);
    return { display: s.display, opacity: Number(s.opacity) };
  }, SPARK);
  expect(sparkShown).not.toBeNull();
  expect(sparkShown?.display).not.toBe('none');
  expect(sparkShown?.opacity ?? 0).toBeGreaterThan(0);
});
