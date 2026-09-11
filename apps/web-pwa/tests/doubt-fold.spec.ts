/**
 * A REFUSAL THE LEARNER NEVER SEES IS NOT A REFUSAL — MEASURED, NOT ASSERTED ABOUT A STRING.
 * (docs/INK-FOUR.md, experience; the adversary, wave 49 finding 8, re-judged in wave 42.)
 *
 * WHAT WENT WRONG. `<CameraIcon />` is an `<svg>` with a viewBox and no width or height. That is a
 * replaced element with an intrinsic ratio, so with no size of its own it takes the whole of its
 * column and 1:1 of that as height — 1072 px inside the 1120 px column at 1440. The panel it
 * heads, `.db-drop`, grew to 1390 px, and the refusal printed at its foot sat at top 1382 on a
 * page 1520 tall with scrollY 0: 482 px below the fold. The learner was refused and never saw it.
 *
 * WHAT CLOSED IT. One line in `screens/doubt/doubt.css`:
 *
 *     .db-drop > svg{width:48px;height:48px;flex:none;color:var(--ink-2)}
 *
 * WHY THIS FILE EXISTS ANYWAY. The close was guarded only by `doubt-screen.test.ts` reading the
 * sheet and finding `width:` and `height:` in that line — a test about the text of a file, not
 * about a screen. It cannot see the height the panel actually takes, and it cannot tell a fix from
 * its own second guard: `DoubtScreen.tsx` ALSO scrolls a refusal into view, so with the CSS rule
 * deleted the sentence still ends up visible and every assertion about "can the learner read it"
 * still passes. The defect is therefore invisible to any check that only asks whether the refusal
 * is on screen.
 *
 * So this file measures the thing the CSS alone owns, and nothing else can supply:
 *
 *   1. the hero camera is 48x48 on the glass, not the width of its column;
 *   2. the capture panel is shorter than the viewport, so the whole screen fits without scrolling
 *      (`scrollHeight === innerHeight`, the judge's own wave-42 measurement, made a guard);
 *   3. the refusal is in view AT scrollY 0 — the page never had to move to show it, which is what
 *      separates the layout being right from the runtime rescuing a layout that is wrong.
 *
 * Delete the rule from doubt.css and 1, 2 and 3 all fail, at 390 and at 1440, in both themes and
 * with motion reduced. Proof of that red run is in the wave's report.
 *
 * A LAB IS SILENT (the owner, 2026-09-09): the config this runs under launches with --mute-audio,
 * and nothing here plays or measures sound.
 *
 * Run: `bunx playwright test --config tests/doubt.config.ts doubt-fold` from apps/web-pwa.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded } from './helpers';
import { applyTheme, settle, type Theme } from './helpers/proof';

const OUT = process.env.WOBO_FOLD_DIR ?? join(process.cwd(), 'shots', 'doubt-fold');

/** The two screens the standard measures on. */
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const;
const THEMES: readonly Theme[] = ['light', 'dark'];

/** The hero camera's declared size in `doubt.css`. */
const ICON_PX = 48;

/** What `acceptsFile` refuses a text file with (screens/doubt/capture.ts). */
const REFUSAL = 'That is not a photo. A picture of the page works best.';

interface Measured {
  icon: { width: number; height: number };
  panel: { top: number; height: number };
  refusal: {
    top: number;
    bottom: number;
    text: string;
    color: string;
    rule: { width: number; color: string };
    ground: string;
  };
  /** The ordinary description line above it — "Point at the page, the sum, the diagram...". */
  body: { color: string };
  /** The fine print under the buttons — "On a laptop you can also drop the photo here.". */
  note: { color: string };
  /** `--ink`, `--ink-3` and `--rose`, as the live theme resolves them. */
  ink: string;
  ink3: string;
  rose: string;
  scrollY: number;
  scrollHeight: number;
  innerHeight: number;
}

/** `#FF6B57` -> `rgb(255, 107, 87)`, so a token can be compared with a computed colour. */
function rgb(hex: string): string {
  const h = hex.trim().replace('#', '');
  const n = Number.parseInt(h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** `rgb(20, 20, 43)` / `#14142B` -> WCAG relative luminance. */
function luminance(color: string): number {
  const nums = color.match(/\d+(\.\d+)?/g);
  let rgbTriple: number[];
  if (nums && color.startsWith('rgb')) rgbTriple = nums.slice(0, 3).map(Number);
  else {
    const n = Number.parseInt(color.trim().replace('#', ''), 16);
    rgbTriple = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const [r, g, b] = rgbTriple.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG ratio between two colours, whichever way round they are given. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Everything the finding is about, read off the live layout in one pass so the numbers all belong
 * to the same frame.
 */
async function measure(page: Page): Promise<Measured> {
  return await page.evaluate(() => {
    const panel = document.querySelector('.db-drop') as HTMLElement | null;
    const icon = panel?.querySelector(':scope > svg') as SVGElement | null;
    const refusal = document.querySelector('.db-error') as HTMLElement | null;
    const body = panel?.querySelector(':scope > p:not(.db-error):not(.db-note)') as HTMLElement | null;
    const note = panel?.querySelector(':scope > p.db-note') as HTMLElement | null;
    if (!panel || !icon || !refusal || !body)
      throw new Error('the capture panel, its camera, its description or its refusal is not on the page');
    const p = panel.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    const r = refusal.getBoundingClientRect();
    return {
      icon: { width: Math.round(i.width), height: Math.round(i.height) },
      panel: { top: Math.round(p.top), height: Math.round(p.height) },
      refusal: {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        text: refusal.textContent ?? '',
        color: getComputedStyle(refusal).color,
        rule: {
          width: Math.round(Number.parseFloat(getComputedStyle(refusal).borderLeftWidth)),
          color: getComputedStyle(refusal).borderLeftColor,
        },
        // what the refusal is actually printed ON — it carries no ground of its own
        ground: getComputedStyle(panel).backgroundColor,
      },
      body: { color: getComputedStyle(body).color },
      note: { color: note ? getComputedStyle(note).color : '' },
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      ink3: getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim(),
      rose: getComputedStyle(document.documentElement).getPropertyValue('--rose').trim(),
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

for (const size of SIZES) {
  for (const theme of THEMES) {
    for (const still of [false, true]) {
      const label = `${size.name}-${theme}${still ? '-reduced' : ''}`;

      test(`the refusal is read where it is printed — ${label}`, async ({ page }) => {
        await seedOnboarded(page);
        await page.emulateMedia({ reducedMotion: still ? 'reduce' : 'no-preference' });
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/doubt');
        if (still) {
          await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduce'));
        }
        await applyTheme(page, theme);
        await expect(page.getByText('Take a photo of the doubt')).toBeVisible();
        await settle(page);

        // The camera door, not the sign-in wall: this config clears VITE_SUPABASE_URL, so the
        // identity is the dev-mock one and `doorFor` opens the camera. Without this the panel
        // under test never renders and every number below would be about the wrong screen.
        await expect(page.locator('.db-drop')).toHaveCount(1);
        await expect(page.locator('.db-wrap input[capture="environment"]')).toHaveCount(1);

        // Refuse something honestly, entirely in the browser: a text file is not a photo. This is
        // `acceptsFile`, so no gateway, no network and no model is involved in the refusal.
        await page
          .locator('.db-wrap input[capture="environment"]')
          .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
        await expect(page.locator('.db-error')).toHaveText(REFUSAL);
        await settle(page);

        const m = await measure(page);
        console.log(`[fold] ${label} ${JSON.stringify(m)}`);

        await page.screenshot({ path: join(OUT, `doubt-refusal-${label}.png`) });

        // Every claim is soft, so a red run prints all three failures and their numbers rather
        // than stopping at the first — the point of this file is the measurement, not the throw.

        // 1. THE CAMERA IS AN ICON. Unsized it measures 1072 px at 1440 and 310 px at 390.
        expect.soft(m.icon).toEqual({ width: ICON_PX, height: ICON_PX });

        // 2. THE PANEL IS SHORTER THAN THE SCREEN, so the whole of it is readable at once. The
        //    unsized icon put it at 1390 px against a 900 px viewport.
        expect.soft(m.panel.height).toBeLessThan(m.innerHeight);

        // 3. AND THE PAGE NEVER HAD TO MOVE. `scrollHeight === innerHeight` is the judge's own
        //    wave-42 measurement of the fixed screen: there is nothing below the fold to reach.
        //    With scrollY still 0 the refusal is in view because the LAYOUT is right, not because
        //    the runtime scrolled to rescue it — which is the only way to tell the CSS fix from
        //    `DoubtScreen.tsx`'s scrollIntoView guard standing in for it.
        expect.soft(m.scrollY).toBe(0);
        expect.soft(m.scrollHeight).toBe(m.innerHeight);
        expect.soft(m.refusal.top).toBeGreaterThanOrEqual(0);
        expect.soft(m.refusal.bottom).toBeLessThanOrEqual(m.innerHeight);

        // 4. AND IT READS AS A REFUSAL. `.db-error` asked for `--rose`, and in the capture panel
        //    it never got it: `.db-drop > p` is (0,1,1) against `.db-error`'s (0,1,0), so the
        //    panel's description colour won and the sentence was painted `--ink-2` — the exact
        //    grey of the ordinary line two rows above it, in both themes. A refusal that looks
        //    like body copy is the same defect as a refusal below the fold, one step further on.
        //
        //    Two claims, and they are the LAW rather than one chosen colour: the refusal is set
        //    apart from the description beside it, and it is legible where it is set. The bare
        //    `--rose` the sheet asked for satisfies the first and fails the second at 2.6:1 on the
        //    light ground; the doors' rose slab satisfies both but is a wash, which this screen's
        //    own law forbids. So the pigment is a rule and the words are full ink.
        expect.soft(m.refusal.color, 'the refusal is not body copy').not.toBe(m.body.color);
        expect.soft(m.refusal.color).toBe(rgb(m.ink));
        expect.soft(m.refusal.rule.color, 'the refusal carries the pigment for care').toBe(rgb(m.rose));
        expect.soft(m.refusal.rule.width).toBeGreaterThanOrEqual(3);
        const ratio = contrast(m.refusal.color, m.refusal.ground);
        console.log(`[fold] ${label} refusal contrast ${ratio.toFixed(2)}:1`);
        expect.soft(ratio, 'the refusal is legible where it is printed').toBeGreaterThanOrEqual(4.5);

        // 5. AND THE FINE PRINT IS STILL FINE PRINT. The same (0,1,1) beat `.db-note`'s --ink-3,
        //    so the panel's three paragraphs — description, fine print and refusal — were all one
        //    colour and the hierarchy the sheet writes down was not on the glass.
        expect.soft(m.note.color).toBe(rgb(m.ink3));
      });
    }
  }
}
