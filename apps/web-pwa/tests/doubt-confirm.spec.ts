/**
 * THE CONFIRM STEP IS THE STEP A LEARNER ACTUALLY REACHES WITH A PHOTO — MEASURED ON A REAL SCREEN.
 * (docs/INK-FOUR.md, craft: "Nothing under a panel, sheet, toast or pill. Nothing off the
 * viewport."; experience: "After the turn the learner can act on what they see.")
 *
 * WHAT WENT WRONG (the adversary, wave 42 re-judge, finding 1; evidence w54/confirmocc). Wave 49's
 * finding 8 closed the CAPTURE step's refusal and nothing else, and the guard written for it
 * (`doubt-fold.spec.ts`) only ever loads the camera panel. One step further on, with a photo read
 * and the reading on the glass, the same screen at 390x844 measured:
 *
 *   · "I read this as Ex 2.3 Q4; 3x = 20 + 5 ?; ..." at [38,671,314,90] — the one sentence Wobo
 *     asks the learner to check — under the fixed `.wf-float` "Tell Wobo" pill;
 *   · "Fix anything I misread, line by line, then I explain." at [38,775,314,41] — under `.wk-rail`,
 *     the phone's tab bar;
 *   · the EXPLAIN button, which is how the turn continues at all, at y 1302 in an 844 px viewport:
 *     458 px below the fold, on a page whose scroll nothing ever moved.
 *
 * At 1440x900 the same step was clean, so every number below is asserted at BOTH widths: one to
 * close the defect, the other to hold the width that was already right.
 *
 * WHAT THIS FILE MEASURES, and nothing else can supply. `doubt-screen.test.ts` reads the sources
 * and can only ask whether a string is present; the occlusion here is a fact about painted boxes
 * and a hit test, and the fold is a fact about `scrollHeight`. So:
 *
 *   1. NOTHING PAINTED OVER, AND NOTHING PAINTED OUTSIDE ITS OWN BOX. Every word and every field of
 *      the doubt pane is hit-tested at its corners and edges with `document.elementsFromPoint`; if
 *      any fixed or sticky element of the app's chrome comes back above it, that is the craft law
 *      failed. This is the adversary's own probe, kept here so the next run of it finds what this
 *      one found. And each box is asked whether it holds its own words: a pane gives its grid a
 *      definite height, and a grid short of room shrinks a row to that row's minimum — which for
 *      anything declaring a `min-height` is smaller than the words it holds.
 *   2. THE ACTION IS ON THE GLASS. Explain is fully inside the viewport at scrollY 0 and nothing
 *      paints over it — the learner can act on what they see without hunting for it.
 *   3. NO FOLD AT ALL. `scrollHeight === innerHeight`: there is nothing below the fold to reach,
 *      which is the same crispness wave 49's close earned for the capture step. A pane that ends
 *      where Wobo's own bottom furniture begins is what makes this true rather than a runtime
 *      scroll rescuing a layout that is wrong.
 *   4. AND EVERY CORRECTION IS REACHABLE. Each of the five lines the reader returned is brought
 *      into view in turn and measured again: fully visible, never under the chrome, with the photo
 *      still on the glass beside it — a line tapped in the reading lights its place on the photo,
 *      so a photo that had scrolled away would light where nobody is looking. A pane that hides
 *      half the reading would satisfy 1 to 3 and still be a bad screen.
 *   5. AND THE SAME ONCE THE TURN IS OVER. The explanation is played, the doubt is filed, and 1, 2
 *      and 3 are asked again of the step the learner is left standing on.
 *
 * Delete the phone pane from `screens/doubt/doubt.css` (the `@media (max-width:900px)` block that
 * gives `.db-grid` its measured height, makes `.db-read` the one scroller and docks `.db-act`) and
 * 1, 2, 3 and 4 all fail at 390 in both themes and with motion reduced. Proof of that red run is in
 * the wave's report.
 *
 * A LAB IS SILENT (the owner, 2026-09-09): `doubt.config.ts` launches every browser with
 * --mute-audio, and nothing here plays or measures sound.
 *
 * Run: `bunx playwright test --config tests/doubt.config.ts doubt-confirm` from apps/web-pwa.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded } from './helpers';
import { applyTheme, settle, type Theme } from './helpers/proof';

const OUT = process.env.WOBO_CONFIRM_DIR ?? join(process.cwd(), 'shots', 'doubt-confirm');

const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const;
const THEMES: readonly Theme[] = ['light', 'dark'];

const DOUBT_ID = 'd-confirm-01';

/**
 * The reading the adversary's own photo produced (`adv-lab/math.jpg`), line for line — five lines,
 * three of them with a place on the page. Five is what the step has to hold at 390; a fixture with
 * two lines would fit anywhere and prove nothing.
 */
const READ = {
  doubt: DOUBT_ID,
  created_at: '2026-09-10T09:00:00Z',
  status: 'read',
  words: '',
  say: 'I read this as Ex 2.3 Q4; 3x = 20 + 5 ?; 3x = 25; x = 25/3; x = 8.33.',
  reading: {
    subject: 'Mathematics',
    topic: 'linear equations',
    question: 'Solve 3x - 5 = 20 for x.',
    lines: [
      { id: 'r1', text: 'Ex 2.3 Q4', box: [0.09, 0.1, 0.45, 0.15] },
      { id: 'r2', text: '3x = 20 + 5 ?', box: [0.09, 0.2, 0.62, 0.27] },
      { id: 'r3', text: '3x = 25', box: [0.09, 0.32, 0.5, 0.38] },
      { id: 'r4', text: 'x = 25/3', box: null },
      { id: 'r5', text: 'x = 8.33', box: null },
    ],
    width: 900,
    height: 1200,
  },
  climb: { node_id: null, node_name: null, framework_id: null },
};

/**
 * A conforming answer, so the turn can be played to its end and the step AFTER confirm measured
 * too: each stroke inside the sentence about it, then done.
 */
const TURN: Record<string, unknown>[] = [
  { type: 'say', text: 'You moved the five across without changing its sign.', t: 0, dur: 1600 },
  {
    type: 'ink',
    t: 200,
    object: {
      id: 'c-five',
      kind: 'circle',
      anchor: { target: 'r2' },
      pad: 10,
      t: { start: 200, dur: 400 },
    },
  },
  {
    type: 'say',
    text: 'Minus five moves over as plus five, so three x is twenty five.',
    t: 1600,
    dur: 1800,
  },
  { type: 'done', t: 3400, objects: 1, presentation: 'screen' },
];

/** The gateway, answered in the browser: the read, the answer, and nothing else this file needs. */
async function fakeGateway(page: Page): Promise<void> {
  await page.route('**/gw/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/gw/, '');
    const json = (status: number, content: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(content) });
    if (path === '/v1/doubt' && route.request().method() === 'POST') return json(200, READ);
    if (path === `/v1/doubt/${DOUBT_ID}/answer` && route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: TURN.map((f, i) => `id: turn:${i}\ndata: ${JSON.stringify(f)}\n\n`).join(''),
      });
    }
    if (path === '/v1/doubt') return json(200, { doubts: [] });
    return json(404, { code: 'not_found' });
  });
}

/** A textbook page drawn on a canvas, portrait, the shape a phone photograph of a page has. */
async function pageImage(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#14142B';
    g.font = '500 34px sans-serif';
    g.fillText('Ex 2.3 Q4', 90, 150);
    g.font = '600 60px sans-serif';
    g.fillText('3x - 5 = 20', 90, 300);
    g.font = '500 44px sans-serif';
    g.fillText('3x = 25', 90, 420);
    g.fillText('x = 8.33', 90, 520);
    g.fillStyle = '#8A8A9E';
    for (let y = 600; y < 1100; y += 56) g.fillRect(90, y, 720, 2);
    return c.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

// --- the probe ------------------------------------------------------------------------------------

interface Item {
  what: string;
  box: [number, number, number, number];
  /** The classes of any fixed or sticky element painting over one of its corners. */
  covered: string[];
  inView: boolean;
  hitTested: boolean;
  /** How far the words are painted outside the box that is supposed to hold them, in pixels. */
  spill: number;
  /** The element's own type size, so a spill can be judged against a line of it. */
  fs: number;
  /** True for an <input> or <textarea>: the corrections, whose text is a value and not a node. */
  field: boolean;
}
interface Shot {
  vw: number;
  vh: number;
  scrollY: number;
  scrollHeight: number;
  chrome: { what: string; box: [number, number, number, number] }[];
  items: Item[];
}

/**
 * The adversary's probe, kept whole: every painted fixed or sticky box on the page, and every word
 * and field of the doubt pane hit-tested at its own four corners against it.
 *
 * A corner is only counted when the element itself comes back in the stack (`i >= 0`). An element
 * a scroller has clipped is not in any stack, and calling that "covered" would turn a pane that
 * scrolls correctly into a false failure.
 */
const PROBE = `(() => {
  const pane = document.querySelector('.db-wrap');
  if (!pane) throw new Error('the doubt pane is not on the page');
  const name = (el) => (el.getAttribute('aria-label') || el.className || el.tagName).toString().slice(0, 40);
  const chrome = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    chrome.push({ what: name(el), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  }
  const items = [];
  for (const el of pane.querySelectorAll('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(' ');
    const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    const what = own || (field ? (el.value || el.getAttribute('aria-label') || el.tagName) : '');
    if (!what) continue;
    const cs = getComputedStyle(el);
    // a region button on the photo paints no words at all (color:transparent;font-size:0): it is
    // a hit area, and counting it as text would measure something nobody can read
    if (!field && (Number.parseFloat(cs.fontSize) === 0 || cs.color === 'rgba(0, 0, 0, 0)')) continue;
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const covered = [];
    let hitTested = false;
    const pts = [
      [r.left + r.width / 2, r.top + 3], [r.left + r.width / 2, r.bottom - 3],
      [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3],
      [r.left + 3, r.top + 3], [r.right - 3, r.top + 3],
    ];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const stack = document.elementsFromPoint(x, y);
      const i = stack.findIndex((n) => n === el || el.contains(n));
      if (i < 0) continue;
      hitTested = true;
      for (const n of stack.slice(0, i)) {
        const cs = getComputedStyle(n);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        covered.push(name(n));
        break;
      }
    }
    const scrolls = /auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflow);
    items.push({
      spill: !scrolls && el.clientHeight > 0 ? Math.max(0, el.scrollHeight - el.clientHeight) : 0,
      fs: Math.round(Number.parseFloat(cs.fontSize)) || 0,
      what: what.toString().slice(0, 70),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      covered: [...new Set(covered)],
      inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      hitTested,
      field,
    });
  }
  return { vw: innerWidth, vh: innerHeight, scrollY: Math.round(window.scrollY),
    scrollHeight: document.documentElement.scrollHeight, chrome, items };
})()`;

const shoot = (page: Page): Promise<Shot> => page.evaluate(PROBE) as Promise<Shot>;

/**
 * A whole line of words outside the box. Sub-pixel rounding puts a pixel or two of a small
 * upper-case label past its own line box on every screen ever built; a LINE of type outside it is
 * a row that was shrunk under the words it is holding.
 */
const spilling = (item: Item): boolean => item.spill >= Math.max(4, item.fs);

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

for (const size of SIZES) {
  for (const theme of THEMES) {
    for (const still of [false, true]) {
      const label = `${size.name}-${theme}${still ? '-reduced' : ''}`;

      test(`the confirm step is whole on the glass — ${label}`, async ({ page }) => {
        await seedOnboarded(page);
        await fakeGateway(page);
        await page.emulateMedia({ reducedMotion: still ? 'reduce' : 'no-preference' });
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/doubt');
        if (still) {
          await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduce'));
        }
        await applyTheme(page, theme);
        await expect(page.getByText('Take a photo of the doubt')).toBeVisible();

        await page.locator('.db-wrap input[capture="environment"]').setInputFiles({
          name: 'page.jpg',
          mimeType: 'image/jpeg',
          buffer: await pageImage(page),
        });

        // The confirm step, with all five lines editable in place.
        await expect(page.getByTestId('doubt-reading-line')).toBeVisible();
        await expect(page.locator('.db-lines > li')).toHaveCount(5);
        await settle(page);

        const shot = await shoot(page);
        console.log(`[confirm] ${label} ${JSON.stringify(shot)}`);
        await page.screenshot({ path: join(OUT, `doubt-confirm-${label}.png`) });

        // Soft throughout: a red run should print every number the finding is about, not stop at
        // the first of them.

        // 1. NOTHING PAINTED OVER. At 390 this listed the reading line under `.wf-float` and the
        //    instruction under `.wk-rail`.
        // and the words are inside the box that holds them: a pane gives its grid a definite
        // height, and a grid with less room than its rows want shrinks a row to its own minimum —
        // which for anything declaring `min-height` is smaller than the words it is holding
        expect
          .soft(
            shot.items.filter(spilling).map((i) => `${i.what} (${i.spill}px)`),
            'no words painted outside their box',
          )
          .toEqual([]);
        const painted = shot.items.filter((i) => i.covered.length > 0);
        expect
          .soft(
            painted.map((i) => `${i.what} under ${i.covered.join(',')}`),
            'nothing under a panel, sheet, toast or pill',
          )
          .toEqual([]);

        // 2. THE ACTION IS ON THE GLASS. Explain sat at y 1302 in an 844 px viewport.
        const explain = shot.items.find((i) => i.what.trim() === 'Explain');
        expect.soft(explain, 'the Explain button is in the pane').toBeTruthy();
        expect
          .soft(explain?.inView, `Explain is in the viewport (${JSON.stringify(explain?.box)})`)
          .toBe(true);
        expect.soft(explain?.covered ?? []).toEqual([]);

        // 3. NO FOLD AT ALL. The page was 1478 px tall in an 844 px viewport, and nothing scrolled.
        expect.soft(shot.scrollY).toBe(0);
        expect
          .soft(shot.scrollHeight, 'there is nothing below the fold to reach')
          .toBeLessThanOrEqual(shot.vh + 1);

        // 4. AND EVERY CORRECTION IS REACHABLE. Each line in turn, brought into view and measured
        //    where it lands: fully visible, and nothing of the chrome over it.
        const lines = page.locator('.db-lines > li > input');
        for (let i = 0; i < 5; i += 1) {
          const input = lines.nth(i);
          await input.scrollIntoViewIfNeeded();
          await settle(page);
          const after = await shoot(page);
          const value = String(READ.reading.lines[i]?.text);
          const found = after.items.find((it) => it.field && it.what === value);
          expect.soft(found, `line ${i + 1} (${value}) is measurable`).toBeTruthy();
          expect
            .soft(
              found?.inView,
              `line ${i + 1} (${value}) is fully in view at ${JSON.stringify(found?.box)}, scrollY ${after.scrollY}`,
            )
            .toBe(true);
          expect
            .soft(found?.covered ?? [], `line ${i + 1} (${value}) is not under the chrome`)
            .toEqual([]);
          // the photo keeps its place while the reading scrolls: the line just brought into view
          // lights ITS place on the page, and that has to be somewhere the eye already is
          const photo = await page.locator('[data-testid="doubt-photo"]').boundingBox();
          expect
            .soft(
              photo && photo.y >= 0 && photo.y + photo.height <= after.vh,
              `the photo is still on the glass at line ${i + 1}`,
            )
            .toBe(true);
        }
        await page.screenshot({ path: join(OUT, `doubt-confirm-${label}-corrections.png`) });

        // 5. AND AT THE END OF THE TURN. "After the turn the learner can act on what they see":
        //    the explanation plays over the photo, the doubt is filed, and the same three claims
        //    are made again about the step the learner is left on.
        await page.getByRole('button', { name: 'Explain' }).click();
        await expect(page.getByRole('button', { name: 'Another doubt' })).toBeVisible({
          timeout: 60_000,
        });
        await settle(page);
        const end = await shoot(page);
        console.log(`[confirm] ${label} placed ${JSON.stringify(end)}`);
        await page.screenshot({ path: join(OUT, `doubt-confirm-${label}-placed.png`) });
        expect
          .soft(
            end.items
              .filter((i) => i.covered.length > 0)
              .map((i) => `${i.what} under ${i.covered.join(',')}`),
            'nothing under a panel, sheet, toast or pill, once the turn is over',
          )
          .toEqual([]);
        expect
          .soft(
            end.items.filter(spilling).map((i) => `${i.what} (${i.spill}px)`),
            'no words painted outside their box, once the turn is over',
          )
          .toEqual([]);
        const another = end.items.find((i) => i.what.trim() === 'Another doubt');
        expect
          .soft(
            another?.inView,
            `Another doubt is in the viewport (${JSON.stringify(another?.box)})`,
          )
          .toBe(true);
        expect.soft(end.scrollHeight).toBeLessThanOrEqual(end.vh + 1);
      });
    }
  }
}
