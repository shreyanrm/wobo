/**
 * The glass, measured on real screens (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
 *
 * The map: every rendered line and meaningful element in the viewport with a stable id, a role,
 * its words, its box in CSS px and its meaning from the content model; at most sixty entries and
 * about two kilobytes, chosen by visibility and relevance. Measured at 390 and 1440, light and
 * dark, and with reduced motion, on the greeting card's triangle, a diagram with parts, and the
 * boss's worked example. The hold: taken for a turn, the phone sheet folded to a strip, scroll
 * locked; released in one tick by Escape, a tap, the learner's voice, and the turn's end.
 *
 * Every frame is kept beside its map under WOBO_GLASS_SHOTS (default: a temp dir).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { ATOM_ANSWERS, actionBarButton, seedOnboarded } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SHOTS = process.env.WOBO_GLASS_SHOTS ?? join(tmpdir(), 'wobo-glass');
mkdirSync(SHOTS, { recursive: true });

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
  viewport: { w: number; h: number; scrollY: number; theme?: string; reduced?: boolean };
  entries: Entry[];
  more?: number;
}
interface HoldState {
  held: boolean;
  reason: string | null;
  released: string | null;
  deferred: number;
}
interface Inspector {
  take: (options?: { question?: string }) => GlassMap;
  current: () => GlassMap | null;
  hold: () => HoldState;
  freeze: (reason?: string) => void;
  release: (why?: 'escape' | 'tap' | 'voice' | 'end') => void;
}
type Lab = Window & { __woboGlassRead?: Inspector };

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

function take(page: Page, question: string): Promise<GlassMap> {
  return page.evaluate((q) => {
    const i = (window as unknown as Lab).__woboGlassRead;
    if (!i) throw new Error('no glass inspector on this page');
    return i.take({ question: q });
  }, question);
}

function current(page: Page): Promise<GlassMap | null> {
  return page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.current() ?? null);
}

function hold(page: Page): Promise<HoldState> {
  return page.evaluate(() => {
    const i = (window as unknown as Lab).__woboGlassRead;
    if (!i) throw new Error('no glass inspector on this page');
    return i.hold();
  });
}

/** Keep the frame with the map drawn over it, and the map beside it. */
async function keep(page: Page, name: string, map: GlassMap | null): Promise<void> {
  writeFileSync(join(SHOTS, `${name}.json`), JSON.stringify(map, null, 2));
  if (map) {
    await page.evaluate((m: GlassMap) => {
      const layer = document.createElement('div');
      layer.id = 'glass-lab-overlay';
      layer.setAttribute('data-glass-ignore', '');
      Object.assign(layer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '99999',
      });
      for (const e of m.entries) {
        const box = document.createElement('div');
        const colour =
          e.role === 'figure-part'
            ? '#E5484D'
            : e.role === 'step'
              ? '#F5A524'
              : e.role === 'figure' || e.role === 'card'
                ? '#2B45FF'
                : '#30A46C';
        Object.assign(box.style, {
          position: 'absolute',
          left: `${e.box[0]}px`,
          top: `${e.box[1]}px`,
          width: `${e.box[2]}px`,
          height: `${e.box[3]}px`,
          outline: `1.5px solid ${colour}`,
          boxSizing: 'border-box',
        });
        layer.appendChild(box);
      }
      document.body.appendChild(layer);
    }, map);
  }
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  await page.evaluate(() => document.getElementById('glass-lab-overlay')?.remove());
}

const inside = (box: Box, vp: { w: number; h: number }): boolean =>
  box[0] >= -1 && box[1] >= -1 && box[0] + box[2] <= vp.w + 1 && box[1] + box[3] <= vp.h + 1;

const within = (inner: Box, outer: Box, slack = 3): boolean =>
  inner[0] >= outer[0] - slack &&
  inner[1] >= outer[1] - slack &&
  inner[0] + inner[2] <= outer[0] + outer[2] + slack &&
  inner[1] + inner[3] <= outer[1] + outer[3] + slack;

const bytes = (map: GlassMap): number => Buffer.byteLength(JSON.stringify(map));

const byId = (map: GlassMap, id: string): Entry | undefined => map.entries.find((e) => e.id === id);

interface Screen {
  width: number;
  height: number;
  theme: 'light' | 'dark';
  reduced?: boolean;
}

/**
 * Learn, the subject, the topic, the arrival card: by role and accessible name, on the Learn page
 * as it is today (the syllabus row is a link to the subject's chapters, the lesson a link under it).
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
}

/** The atom course's arrival card, on a given screen. */
async function arrive(page: Page, screen: Screen): Promise<void> {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console] ${m.text().slice(0, 300)}`);
  });
  await page.emulateMedia({
    colorScheme: screen.theme,
    reducedMotion: screen.reduced ? 'reduce' : 'no-preference',
  });
  await page.setViewportSize({ width: screen.width, height: screen.height });
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto('/');
  await installAtomBrain(page, ATOM_TARGET_NODE_ID);
  await openAtom(page);
  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 15_000 });
  // the drawing draws itself; let the strokes land before the map is read
  await page.waitForTimeout(screen.reduced ? 200 : 1400);
}

/** The whole law of the map, asserted on every take. */
function lawful(map: GlassMap, screen: Screen): void {
  expect(map.v).toBe(1);
  expect(map.entries.length).toBeLessThanOrEqual(60);
  expect(bytes(map)).toBeLessThanOrEqual(2048 + 16);
  expect(map.viewport.w).toBe(screen.width);
  expect(map.viewport.h).toBe(screen.height);
  expect(map.viewport.theme).toBe(screen.theme);
  if (screen.reduced) expect(map.viewport.reduced).toBe(true);
  for (const e of map.entries) {
    expect(e.id.length).toBeGreaterThan(0);
    expect(e.box[2]).toBeGreaterThan(0);
    expect(e.box[3]).toBeGreaterThan(0);
  }
  // reading order: top to bottom
  for (let i = 1; i < map.entries.length; i += 1) {
    const a = map.entries[i - 1] as Entry;
    const b = map.entries[i] as Entry;
    expect(a.box[1] <= b.box[1] || (a.box[1] === b.box[1] && a.box[0] <= b.box[0])).toBe(true);
  }
}

// --- the greeting card's triangle ----------------------------------------------------------------

const SCREENS: Screen[] = [
  { ...PHONE, theme: 'light' },
  { ...PHONE, theme: 'dark' },
  { ...DESK, theme: 'light' },
  { ...DESK, theme: 'dark' },
  { ...PHONE, theme: 'light', reduced: true },
];

for (const screen of SCREENS) {
  const name = `${screen.width}-${screen.theme}${screen.reduced ? '-reduced' : ''}`;
  test(`the greeting card's triangle is on the map part by part at ${name}`, async ({ page }) => {
    await arrive(page, screen);
    const map = await take(page, 'circle the square on the hypotenuse');
    await keep(page, `greeting-${name}`, map);
    lawful(map, screen);

    const figure = byId(map, 'course-intro-mathematics');
    expect(figure, 'the drawing is a figure on the map').toBeDefined();
    expect(figure?.role).toBe('figure');
    const square = byId(map, 'course-intro-mathematics.square-on-the-hypotenuse');
    expect(square, 'the square on the hypotenuse has a box').toBeDefined();
    expect(square?.role).toBe('figure-part');
    expect(square?.meaning).toBe('part:square-on-the-hypotenuse');
    expect(inside(boxOf(square), map.viewport)).toBe(true);
    expect(within(boxOf(square), boxOf(figure))).toBe(true);
    for (const part of ['triangle', 'right-angle', 'c²']) {
      const entry = byId(map, `course-intro-mathematics.${part}`);
      expect(entry, `the ${part} is a part`).toBeDefined();
      expect(within(boxOf(entry), boxOf(figure))).toBe(true);
    }
    // the words on the card are lines with boxes, the topic's title among them
    expect(map.entries.some((e) => e.role === 'line' || e.role === 'heading')).toBe(true);
    expect(
      map.entries.some((e) => e.text.toLowerCase().includes('solving equations')),
      'the topic title is on the map',
    ).toBe(true);
    // the lesson's own words beat Wobo's furniture: the lead line under the title is on the map
    expect(
      map.entries.some((e) => e.text.startsWith('one idea')),
      'the lead line is on the map',
    ).toBe(true);
    // the chip the learner taps next is on the map wherever it is in the viewport (at 390 the
    // action bar sits below the fold of the arrival card, and the map does not pretend otherwise)
    const begin = map.entries.find((e) => e.role === 'chip' && /^begin$/i.test(e.text));
    const barY = await actionBarButton(page, 'begin').evaluate(
      (el) => el.getBoundingClientRect().y,
    );
    if (barY >= screen.height) expect(begin).toBeUndefined();
    // in the viewport it is on the map, unless the map is full and it lost to the page's own words
    else if (!begin) expect(map.more ?? 0).toBeGreaterThan(0);
  });
}

// --- re-measure: the same ids, on a resize and on a theme flip ------------------------------------

test('a resize and a theme flip re-measure the same ids', async ({ page }) => {
  const screen: Screen = { ...DESK, theme: 'light' };
  await arrive(page, screen);
  const wide = await take(page, 'circle the square on the hypotenuse');
  lawful(wide, screen);
  const ids = wide.entries.map((e) => e.id);
  const squareWide = byId(wide, 'course-intro-mathematics.square-on-the-hypotenuse') as Entry;

  await page.setViewportSize(PHONE);
  await page.waitForTimeout(250);
  const narrow = await current(page);
  expect(narrow).not.toBeNull();
  await keep(page, 'remeasure-resize-390', narrow);
  const kept = (narrow as GlassMap).entries.map((e) => e.id);
  // nothing renamed: every id that is still on the glass is the id it was
  for (const id of kept) expect(ids).toContain(id);
  const squareNarrow = byId(
    narrow as GlassMap,
    'course-intro-mathematics.square-on-the-hypotenuse',
  );
  expect(squareNarrow, 'the square is still on the glass at 390').toBeDefined();
  expect(squareNarrow?.box[0]).not.toBe(squareWide.box[0]);
  expect(inside(boxOf(squareNarrow), { w: 390, h: 844 })).toBe(true);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(250);
  const dark = await current(page);
  await keep(page, 'remeasure-theme-dark', dark);
  expect((dark as GlassMap).entries.map((e) => e.id)).toEqual(kept);
});

// --- a diagram with parts -------------------------------------------------------------------------

for (const screen of [
  { ...PHONE, theme: 'light' as const },
  { ...DESK, theme: 'dark' as const },
]) {
  test(`a diagram gives up its parts by name at ${screen.width}, ${screen.theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: screen.theme });
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await seedOnboarded(page);
    await page.goto('/');
    await page.evaluate(async () => {
      const lab = (await import('/src/wobo/glass-lab.tsx')) as {
        mountDiagramLab: (host: HTMLElement) => () => void;
      };
      const host = document.createElement('div');
      host.id = 'glass-lab';
      document.body.prepend(host);
      lab.mountDiagramLab(host);
    });
    await expect(page.locator('#glass-lab svg')).toBeVisible();
    const map = await take(page, 'circle the effect circle in the diagram');
    await keep(page, `diagram-${screen.width}-${screen.theme}`, map);
    lawful(map, screen);

    const figure = byId(map, 'diagram-c3');
    expect(figure).toBeDefined();
    expect(figure?.role).toBe('figure');
    expect(figure?.text).toBe('diagram: Predict, then check');
    const effect = byId(map, 'diagram-c3.effect');
    expect(effect).toBeDefined();
    expect(effect?.role).toBe('figure-part');
    expect(effect?.meaning).toBe('part:effect');
    expect(within(boxOf(effect), boxOf(figure))).toBe(true);
    const idea = byId(map, 'diagram-c3.idea');
    expect(idea).toBeDefined();
    // the two circles are two boxes, side by side, the effect to the right
    expect(boxOf(effect)[0]).toBeGreaterThan(boxOf(idea)[0] + boxOf(idea)[2]);
    expect(byId(map, 'diagram-c3.arrow')).toBeDefined();
    expect(byId(map, 'diagram-c3.predict-then-check')).toBeDefined();
    // the caption is a line under the figure
    const caption = map.entries.find((e) => e.text.startsWith('A claimed answer'));
    expect(caption?.role).toBe('line');
    expect(boxOf(caption)[1]).toBeGreaterThan(boxOf(figure)[1]);
  });
}

// --- the boss's worked example: steps with their meaning ------------------------------------------

async function currentEquation(page: Page): Promise<string> {
  const keys = Object.keys(ATOM_ANSWERS);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const eq of keys) {
      const hit = await page
        .getByText(eq, { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      if (hit) return eq;
    }
    await page.waitForTimeout(150);
  }
  throw new Error('no known equation visible on the current card');
}

test('the boss workbook: the worked lines are steps, and the slip rides the step it lives on', async ({
  page,
}) => {
  const screen: Screen = { ...PHONE, theme: 'light' };
  await arrive(page, screen);
  await actionBarButton(page, 'begin').click();
  const weight = page.getByLabel('take this weight off');
  for (let i = 0; i < 6; i += 1) await weight.first().click();
  const scaleContinue = actionBarButton(page, 'continue');
  await expect(scaleContinue).toBeEnabled({ timeout: 15_000 });
  await scaleContinue.click();
  // the card's own sub-line: the rail names the beat too, so the title matches twice
  const whatIf = page.getByText('Pull a, b, or c sideways');
  await expect(whatIf).toBeVisible({ timeout: 15_000 });
  const whatIfContinue = actionBarButton(page, 'continue');
  await expect(whatIfContinue).toBeEnabled({ timeout: 15_000 });
  await whatIfContinue.click();
  await expect(whatIf).toBeHidden({ timeout: 15_000 });
  // practice, the way tests/journey.spec.ts walks it: one wrong answer, then three right
  await expect(page.getByText('Solve for x').first()).toBeVisible({ timeout: 15_000 });
  expect(await currentEquation(page)).toBe('x + 7 = 12');
  await page.keyboard.type('9');
  await actionBarButton(page, 'check').click();
  await expect(page.getByText('The honest move').first()).toBeVisible({ timeout: 8_000 });
  const detonateContinue = actionBarButton(page, 'continue');
  await expect(detonateContinue).toBeEnabled({ timeout: 8_000 });
  await detonateContinue.click();
  for (let i = 0; i < 3; i += 1) {
    await expect(page.getByText('Solve for x').first()).toBeVisible({ timeout: 15_000 });
    const eq = await currentEquation(page);
    await page.keyboard.type(ATOM_ANSWERS[eq] as string);
    await actionBarButton(page, 'check').click();
    await expect(page.getByText('that holds.').first()).toBeVisible({ timeout: 8_000 });
    await actionBarButton(page, 'continue').click();
  }
  await expect(page.getByText('the boss', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  await actionBarButton(page, 'step in').click();
  await expect(page.getByText('one line below is wrong').first()).toBeVisible({ timeout: 10_000 });
  // the third block sits below the fold on a phone: the question is about it, so bring it up
  await page.getByText('one line below is wrong').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const map = await take(page, 'which step is wrong?');
  await keep(page, 'boss-390-light', map);
  lawful(map, screen);
  const steps = map.entries.filter((e) => e.role === 'step');
  expect(steps.length).toBeGreaterThanOrEqual(3);
  const numbered = steps.filter((s) => /^step:\d/.test(s.meaning ?? ''));
  expect(numbered.length).toBeGreaterThanOrEqual(3);
  const slips = numbered.filter((s) =>
    s.meaning?.includes('misconception:moves-term-without-sign'),
  );
  expect(slips, 'exactly one line carries the slip').toHaveLength(1);
  for (const s of numbered) {
    expect(inside(s.box, map.viewport)).toBe(true);
    expect(s.text.length).toBeGreaterThan(0);
  }
  // the steps read in order, one under the other
  const ordered = [...numbered].sort((a, b) => a.box[1] - b.box[1]);
  expect(ordered.map((s) => s.meaning?.slice(0, 6))).toEqual(
    ordered.map((_, i) => `step:${i + 1}`),
  );
  // the workbook is a card on the map, and nothing inside a step is its own entry
  expect(map.entries.some((e) => e.id === 'course-boss')).toBe(true);
  for (const s of numbered) {
    const twins = map.entries.filter((e) => e !== s && e.text === s.text && within(e.box, s.box));
    expect(twins).toHaveLength(0);
  }
});

// --- the hold and every release -------------------------------------------------------------------

test('the hold: the sheet folds to a strip, scroll locks, and every release is one tick', async ({
  page,
}) => {
  await arrive(page, { ...PHONE, theme: 'light' });
  // the drawer, open, as a phone learner asks from it inside a lesson
  await page.evaluate(async () => {
    const drawer = (await import('/src/wobo/drawer.ts')) as {
      openCompanion: (request: { reason: 'reteach' }) => void;
    };
    drawer.openCompanion({ reason: 'reteach' });
  });
  const sheet = page.getByRole('dialog', { name: 'Wobo' });
  await expect(sheet).toBeVisible();
  const tall = await sheet.boundingBox();
  expect(tall?.height ?? 0).toBeGreaterThan(400);

  // taken: the root says so, and the sheet folds to a strip along the bottom in the same commit
  await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.freeze('turn'));
  await expect(page.locator('html')).toHaveAttribute('data-glass-held', 'turn');
  const strip = page.locator('[data-glass-strip]');
  await expect(strip).toBeVisible();
  const folded = await strip.boundingBox();
  expect(folded?.height ?? 999).toBeLessThanOrEqual(140);
  expect(Math.round((folded?.y ?? 0) + (folded?.height ?? 0))).toBe(PHONE.height);
  expect(Math.round(folded?.width ?? 0)).toBe(PHONE.width);
  await keep(page, 'hold-390-folded', await take(page, 'what is this lesson about?'));
  // the strip is not modal: the page behind it is the learner's
  expect(await sheet.getAttribute('aria-modal')).toBeNull();

  // scroll locked: a wheel does nothing to the page
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(195, 300);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  // Escape: released on the tick of the key, the attribute gone, the sheet unfolded
  const viaEscape = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const i = (window as unknown as Lab).__woboGlassRead;
    return {
      held: i?.hold().held,
      released: i?.hold().released,
      attr: document.documentElement.hasAttribute('data-glass-held'),
    };
  });
  expect(viaEscape).toEqual({ held: false, released: 'escape', attr: false });
  await expect(strip).toHaveCount(0);

  // a tap on the glass
  await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.freeze('turn'));
  expect((await hold(page)).held).toBe(true);
  const tap = await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const i = (window as unknown as Lab).__woboGlassRead;
    return { held: i?.hold().held, released: i?.hold().released };
  });
  expect(tap).toEqual({ held: false, released: 'tap' });

  // the learner's voice
  await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.freeze('turn'));
  const voice = await page.evaluate(() => {
    const i = (window as unknown as Lab).__woboGlassRead;
    i?.release('voice');
    return { held: i?.hold().held, released: i?.hold().released };
  });
  expect(voice).toEqual({ held: false, released: 'voice' });

  // the turn's end
  await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.freeze('turn'));
  const end = await page.evaluate(() => {
    const i = (window as unknown as Lab).__woboGlassRead;
    i?.release('end');
    return { held: i?.hold().held, released: i?.hold().released };
  });
  expect(end).toEqual({ held: false, released: 'end' });
  // and the page scrolls again
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.scrollY);
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 10,
  );
  if (scrollable) expect(after).toBeGreaterThan(before);
});
