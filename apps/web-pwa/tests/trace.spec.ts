/**
 * The trace, on real screens (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 *
 * The glass bench (`src/wobo/glass-bench.tsx`) renders a worked example the way a page renders it
 * and streams a plan to the real conductor over a fake wire. Everything here is read off the DOM
 * of the fixed surface over that page, at 390 and at 1440, in both themes, and once under reduced
 * motion. Frames are kept beside the run (`WOBO_TRACE_FRAMES`, or the OS temp dir) so a human can
 * look at what the numbers describe.
 *
 * What is measured:
 *  · the first stroke is inside the viewport and starts within 150 ms of its sentence's first
 *    word, or ahead of it;
 *  · a ring closes in 300 to 600 ms; every mark kind lands on its subject;
 *  · a note sits in the margin, within 24 px of its subject, on no line of the page's text;
 *  · ink holds while the ask is open (no six-second life), and a turn with no question lingers
 *    and then fades;
 *  · Escape, a tap and a route change lift the pen, fade the ink and release the glass in one tick;
 *  · a released scroll carries the ring with its row, drift-free;
 *  · a theme flip mid-stroke re-inks the same path;
 *  · a subject that leaves the glass takes its mark with it, fading where it was;
 *  · reduced motion lands the stroke whole at first sighting;
 *  · the plane never opens before its first object exists.
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FRAMES = process.env.WOBO_TRACE_FRAMES ?? join(tmpdir(), 'wobo-trace-frames');
mkdirSync(FRAMES, { recursive: true });

type Box = { x: number; y: number; w: number; h: number };
type Mark = {
  id: string;
  settled: boolean;
  drawing: boolean;
  opacity: number;
  box: Box | null;
  d: string | null;
  stroke: string | null;
  firstSeen: number | null;
  settledAt: number | null;
};

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const;
const THEMES = ['light', 'dark'] as const;

/** Ink before the word: the first stroke of a sentence starts within this of its first word. */
const FIRST_STROKE_LEAD_MS = 150;
/** The note's reach from its subject, in px. */
const NOTE_REACH = 24;
/** FADE_MS in the store, plus a frame. */
const FADE = 480 + 40;
/** LINGER_MS in the conductor. */
const LINGER = 4000;

let load = 0;
async function open(page: Page, theme: string, scene: string): Promise<void> {
  await page.goto(`/board-bench.html?theme=${theme}&load=${++load}#glass/${scene}`);
  await expect(page.getByTestId('glass-bench')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__woboGlass), undefined, { timeout: 15_000 });
  // The hand's font, parsed and in hand: in the app that happens at boot, long before a turn. On a
  // cold dev server it lands about a second after the page, and parsing it blocks the main thread
  // for most of that second; measured as part of the first stroke it would be the server's cost,
  // not the hand's. A font that never comes is not waited on forever: the hand falls back.
  await page
    .waitForFunction(() => window.__woboGlass?.fontReady() === true, undefined, { timeout: 5_000 })
    .catch(() => undefined);
}

const play = (page: Page, scene: string) =>
  page.evaluate((s) => window.__woboGlass?.play(s), scene);

/** Start a scene and let it run; resolves once the first stroke is in the DOM. */
async function playUntilFirstStroke(page: Page, scene: string): Promise<void> {
  await page.evaluate((s) => {
    void window.__woboGlass?.play(s);
  }, scene);
  await page.waitForFunction(() => window.__woboGlass?.firstStroke !== null, undefined, {
    timeout: 15_000,
  });
}

const marks = (page: Page) =>
  page.evaluate(() => window.__woboGlass?.marks() ?? []) as Promise<Mark[]>;
const subject = (page: Page, id: string) =>
  page.evaluate((i) => window.__woboGlass?.subject(i) ?? null, id) as Promise<Box | null>;
const frame = (page: Page, name: string) =>
  page.screenshot({ path: join(FRAMES, `${name}.png`), fullPage: false });

function inside(box: Box, vp: { width: number; height: number }): boolean {
  return (
    box.x >= -1 && box.y >= -1 && box.x + box.w <= vp.width + 1 && box.y + box.h <= vp.height + 1
  );
}
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}
/** A mark is on its subject when it touches the subject's box, padded by a hand's pad. */
function onSubject(mark: Box, s: Box, pad = 14): boolean {
  return overlaps(mark, { x: s.x - pad, y: s.y - pad, w: s.w + pad * 2, h: s.h + pad * 2 });
}

for (const vp of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`the trace at ${vp.name}, ${theme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      const tag = `${vp.name}-${theme}`;

      test('the first stroke is on the glass, on the word, and the ring closes in 300 to 600 ms', async ({
        page,
      }) => {
        await open(page, theme, 'which-step');
        await playUntilFirstStroke(page, 'which-step');
        await frame(page, `${tag}-which-step-first-stroke`);
        const first = await page.evaluate(() => window.__woboGlass?.firstStroke ?? null);
        expect(first).not.toBeNull();
        if (!first) return;
        // Inside the viewport: a stroke nobody could see does not count.
        expect(inside(first.box, vp), `first stroke at ${JSON.stringify(first.box)}`).toBe(true);
        // On the word: sentence 0 began at most 150 ms before the stroke, or after it.
        const sentences = await page.evaluate(() => window.__woboGlass?.sentences() ?? []);
        expect(sentences.length).toBeGreaterThan(0);
        const lead = first.t - (sentences[0] as number);
        const clock = await page.evaluate(() => ({
          started: window.__woboGlass?.startedAt ?? 0,
          landed: window.__woboGlass?.landedAt('s0m0') ?? 0,
        }));
        console.log(
          `${tag}: sentence 0 at +${Math.round((sentences[0] as number) - clock.started)} ms, ` +
            `ring in the store at +${Math.round(clock.landed - clock.started)} ms, ` +
            `first stroke in the DOM at +${Math.round(first.t - clock.started)} ms`,
        );
        if (first.t - clock.started > 300) {
          const loaded = await page.evaluate(
            (window_) => {
              const from = window_.from;
              const to = window_.to;
              return performance
                .getEntriesByType('resource')
                .filter((e) => e.startTime >= from - 50 && e.startTime <= to + 50)
                .map(
                  (e) =>
                    `${Math.round(e.startTime - from)}+${Math.round(e.duration)} ${e.name.replace(/^.*?\/\/[^/]+/, '')}`,
                );
            },
            { from: clock.started, to: first.t },
          );
          console.log(`${tag}: loaded meanwhile: ${loaded.join(' | ')}`);
          const tasks = await page.evaluate(() => window.__woboGlass?.longTasks() ?? []);
          const gaps = await page.evaluate(() => window.__woboGlass?.frameGaps() ?? []);
          console.log(
            `${tag}: long tasks: ${JSON.stringify(tasks)}; frame gaps: ${gaps.join(',')}`,
          );
        }
        expect(lead, `stroke ${Math.round(lead)} ms after the first word`).toBeLessThanOrEqual(
          FIRST_STROKE_LEAD_MS,
        );
        // On its subject.
        const w2 = await subject(page, 'w2');
        expect(w2).not.toBeNull();
        if (w2) expect(onSubject(first.box, w2)).toBe(true);

        const outcome = await page.waitForFunction(() => !window.__woboGlass?.active(), undefined, {
          timeout: 20_000,
        });
        void outcome;
        await frame(page, `${tag}-which-step-end`);
        const all = await marks(page);
        const ring = all.find((m) => m.id === 's0m0');
        const underline = all.find((m) => m.id === 's1m0');
        expect(ring?.settledAt, 'the ring never settled').not.toBeNull();
        expect(ring?.firstSeen).not.toBeNull();
        if (ring?.settledAt && ring.firstSeen) {
          const took = ring.settledAt - ring.firstSeen;
          // The plan gave 450 ms; a frame either side.
          expect(took, `ring took ${Math.round(took)} ms`).toBeGreaterThanOrEqual(300 - 40);
          expect(took, `ring took ${Math.round(took)} ms`).toBeLessThanOrEqual(600 + 60);
        }
        // The underline landed with the second sentence, not before it.
        expect(underline?.firstSeen).not.toBeNull();
        if (underline?.firstSeen && sentences.length > 1) {
          expect(underline.firstSeen).toBeGreaterThanOrEqual((sentences[1] as number) - 40);
          expect(underline.firstSeen - (sentences[1] as number)).toBeLessThanOrEqual(
            FIRST_STROKE_LEAD_MS,
          );
        }
        const w1 = await subject(page, 'w1');
        if (underline?.box && w1) expect(onSubject(underline.box, w1)).toBe(true);
      });

      test('ink holds while the question is open, and the glass is let go when the voice ends', async ({
        page,
      }) => {
        await open(page, theme, 'which-step');
        const outcome = await play(page, 'which-step');
        expect(outcome?.ask).toBe('What changed between step 1 and step 2?');
        // The turn is over: the glass is released the same tick the voice ends.
        expect(await page.evaluate(() => window.__woboGlass?.held())).toEqual({
          glass: false,
          scroll: false,
        });
        // Seven seconds later the ring is still there: no six-second life while an ask is open.
        await page.waitForTimeout(7_000);
        const ring = (await marks(page)).find((m) => m.id === 's0m0');
        expect(ring?.opacity).toBe(1);
        expect(await page.evaluate(() => window.__woboGlass?.fading('s0m0'))).toBeNull();
        await frame(page, `${tag}-which-step-held-7s`);
        // The learner answers (the next turn begins): it fades.
        await playUntilFirstStroke(page, 'all-marks');
        expect(await page.evaluate(() => window.__woboGlass?.fading('s0m0'))).not.toBeNull();
        await page.waitForTimeout(FADE);
        expect((await marks(page)).find((m) => m.id === 's0m0')).toBeUndefined();
      });

      test('every mark lands on its subject; the note keeps to the margin; a turn with no question lingers then fades', async ({
        page,
      }) => {
        await open(page, theme, 'all-marks');
        const outcome = await play(page, 'all-marks');
        expect(outcome?.completed).toBe(true);
        expect(outcome?.ask).toBeNull();
        await frame(page, `${tag}-all-marks-end`);
        const all = await marks(page);
        const ids = ['ring', 'note', 'tick', 'bracket', 'arrow', 'cross', 'point'];
        for (const id of ids) {
          const m = all.find((x) => x.id === id);
          expect(m, `${id} never landed`).toBeDefined();
          expect(m?.box, `${id} has no box`).not.toBeNull();
          if (m?.box) expect(inside(m.box, vp), `${id} at ${JSON.stringify(m.box)}`).toBe(true);
        }
        const on = async (id: string, target: string) => {
          const m = all.find((x) => x.id === id);
          const s = await subject(page, target);
          expect(s, `${target} is not on the glass`).not.toBeNull();
          if (m?.box && s) expect(onSubject(m.box, s), `${id} is not on ${target}`).toBe(true);
        };
        await on('ring', 'w2');
        await on('tick', 'w1');
        await on('bracket', 'w3');
        await on('cross', 'w4');
        await on('point', 'w1');
        await on('arrow', 'w3');

        // The note: within 24 px of its subject, and on no line of the page's own text.
        const note = all.find((x) => x.id === 'note');
        const w2 = await subject(page, 'w2');
        expect(note?.box).not.toBeNull();
        if (note?.box && w2) {
          expect(
            gap(note.box, w2),
            `note ${Math.round(gap(note.box, w2))} px from step 2`,
          ).toBeLessThanOrEqual(NOTE_REACH);
          const lines = await page.evaluate(() => {
            const api = window.__woboGlass;
            if (!api) return [];
            return api
              .map()
              .entries.filter((e) => e.role === 'line' || e.role === 'step' || e.role === 'heading')
              .map((e) => ({ id: e.id, box: api.subject(e.id) }))
              .filter((e): e is { id: string; box: Box } => e.box !== null);
          });
          expect(lines.length).toBeGreaterThan(3);
          for (const line of lines) {
            expect(overlaps(note.box, line.box), `the note lies on ${line.id}`).toBe(false);
          }
        }

        // No question was asked: the ink lingers, then goes on its own.
        expect(await page.evaluate(() => window.__woboGlass?.fading('ring'))).not.toBeNull();
        const still = (await marks(page)).find((x) => x.id === 'ring');
        expect(still?.opacity).toBe(1);
        await page.waitForTimeout(LINGER + FADE);
        expect((await marks(page)).find((x) => x.id === 'ring')).toBeUndefined();
        await frame(page, `${tag}-all-marks-faded`);
      });

      test('Escape lifts the pen, fades the ink and releases the glass in one tick', async ({
        page,
      }) => {
        await open(page, theme, 'which-step');
        await playUntilFirstStroke(page, 'which-step');
        expect(await page.evaluate(() => window.__woboGlass?.held().glass)).toBe(true);
        const before = await page.evaluate(() => window.__woboGlass?.now() ?? 0);
        await page.keyboard.press('Escape');
        const after = await page.evaluate(() => ({
          active: window.__woboGlass?.active(),
          held: window.__woboGlass?.held(),
          fading: window.__woboGlass?.fading('s0m0'),
          now: window.__woboGlass?.now() ?? 0,
        }));
        expect(after.active).toBe(false);
        expect(after.held).toEqual({ glass: false, scroll: false });
        expect(after.fading).not.toBeNull();
        // One tick: the fade began no later than the key reached the page.
        expect((after.fading as number) - before).toBeLessThanOrEqual(after.now - before);
        await frame(page, `${tag}-escape-mid-ring`);
        // The second sentence never lands its mark: nothing is drawn after the learner cut in.
        await page.waitForTimeout(FADE + 400);
        expect((await marks(page)).find((m) => m.id === 's1m0')).toBeUndefined();
      });

      test('a tap on the glass is the same interruption', async ({ page }) => {
        await open(page, theme, 'which-step');
        await playUntilFirstStroke(page, 'which-step');
        await page.mouse.click(vp.width / 2, vp.height - 40);
        const after = await page.evaluate(() => ({
          active: window.__woboGlass?.active(),
          held: window.__woboGlass?.held(),
          fading: window.__woboGlass?.fading('s0m0'),
        }));
        expect(after.active).toBe(false);
        expect(after.held).toEqual({ glass: false, scroll: false });
        expect(after.fading).not.toBeNull();
      });

      test('a released scroll carries the ring with its row, drift-free', async ({ page }) => {
        await open(page, theme, 'which-step');
        await play(page, 'which-step');
        const before = {
          ring: (await marks(page)).find((m) => m.id === 's0m0')?.box,
          w2: await subject(page, 'w2'),
        };
        expect(before.ring).toBeTruthy();
        expect(before.w2).toBeTruthy();
        await page.mouse.move(vp.width / 2, vp.height / 2);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(120);
        const after = {
          ring: (await marks(page)).find((m) => m.id === 's0m0')?.box,
          w2: await subject(page, 'w2'),
        };
        expect(after.ring).toBeTruthy();
        expect(after.w2).toBeTruthy();
        if (before.ring && before.w2 && after.ring && after.w2) {
          const moved = before.w2.y - after.w2.y;
          expect(moved).toBeGreaterThan(50);
          const drift = Math.abs(before.ring.y - after.ring.y - moved);
          expect(
            drift,
            `ring drifted ${drift.toFixed(1)} px on a 120 px scroll`,
          ).toBeLessThanOrEqual(1.5);
        }
        await frame(page, `${tag}-scrolled-ring`);
      });

      test('a theme flip mid-stroke re-inks the same path', async ({ page }) => {
        await open(page, theme, 'which-step');
        await playUntilFirstStroke(page, 'which-step');
        const before = (await marks(page)).find((m) => m.id === 's0m0');
        expect(before?.stroke).toBeTruthy();
        const other = theme === 'light' ? 'dark' : 'light';
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, other);
        await page.waitForTimeout(40);
        const after = (await marks(page)).find((m) => m.id === 's0m0');
        expect(after?.stroke).toBeTruthy();
        expect(after?.stroke).not.toBe(before?.stroke);
        // Same path: the ring did not restart or move under the new ink.
        expect(after?.d).toBe(before?.d);
        await frame(page, `${tag}-theme-flip-to-${other}`);
        await page.keyboard.press('Escape');
      });

      test('a subject that leaves the glass takes its mark with it: it fades where it was', async ({
        page,
      }) => {
        await open(page, theme, 'off-glass');
        await play(page, 'off-glass');
        const before = (await marks(page)).find((m) => m.id === 'ring');
        expect(before?.box).toBeTruthy();
        const w4 = await subject(page, 'w4');
        expect(w4).toBeTruthy();
        // Scroll the row above the top of the glass.
        const dy = (w4?.y ?? 0) + (w4?.h ?? 0) + 60;
        await page.evaluate((y) => window.scrollBy(0, y), dy);
        await page.waitForTimeout(60);
        const going = (await marks(page)).find((m) => m.id === 'ring');
        // Never dropped on the frame the rect went: still in the DOM, fading, same path.
        expect(going).toBeDefined();
        expect(going?.d).toBe(before?.d);
        await frame(page, `${tag}-off-glass-fading`);
        await page.waitForTimeout(FADE);
        const gone = (await marks(page)).find((m) => m.id === 'ring');
        expect(gone === undefined || gone.opacity <= 0.02).toBe(true);
        // And back: the subject returns, so does the mark.
        await page.evaluate((y) => window.scrollBy(0, -y), dy);
        await page.waitForTimeout(FADE);
        const back = (await marks(page)).find((m) => m.id === 'ring');
        expect(back?.opacity).toBe(1);
      });

      test('the plane never opens before its first object exists', async ({ page }) => {
        await open(page, theme, 'board-talk');
        const talk = await play(page, 'board-talk');
        expect(talk?.objects).toBe(0);
        expect(await page.evaluate(() => window.__woboGlass?.planeOpen())).toBe(false);
        const drew = await play(page, 'board-axis');
        expect(drew?.objects).toBe(1);
        expect(await page.evaluate(() => window.__woboGlass?.planeOpen())).toBe(true);
        expect(await page.evaluate(() => window.__woboGlass?.emptyPlaneOpenings)).toBe(0);
        await frame(page, `${tag}-plane-on-first-object`);
      });
    });
  }
}

test.describe('the trace under reduced motion, 390 light', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    contextOptions: { reducedMotion: 'reduce' },
  });

  test('the stroke lands whole at first sighting, on the word, and still holds for the ask', async ({
    page,
  }) => {
    await open(page, 'light', 'which-step');
    await playUntilFirstStroke(page, 'which-step');
    const first = await page.evaluate(() => window.__woboGlass?.firstStroke ?? null);
    expect(first).not.toBeNull();
    const ring = (await marks(page)).find((m) => m.id === 's0m0');
    // No dash: the whole ring at once.
    expect(ring?.drawing).toBe(false);
    if (first) expect(inside(first.box, { width: 390, height: 844 })).toBe(true);
    await frame(page, '390-light-reduced-first-stroke');
    await page.waitForFunction(() => !window.__woboGlass?.active(), undefined, { timeout: 20_000 });
    expect(await page.evaluate(() => window.__woboGlass?.fading('s0m0'))).toBeNull();
    // Reduced motion never holds the scroll for a stroke, and the turn's hold is gone with the turn.
    expect(await page.evaluate(() => window.__woboGlass?.held())).toEqual({
      glass: false,
      scroll: false,
    });
  });
});
