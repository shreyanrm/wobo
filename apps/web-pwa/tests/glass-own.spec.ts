/**
 * What is on the glass, and what never is (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze).
 *
 * Three laws the adversary's lab broke on 2026-09-08, measured on real screens at 390 and 1440:
 *
 *  1. WOBO'S OWN SURFACES ARE NEVER ON THE GLASS. After a three-turn conversation the map carries
 *     not one word the learner typed: 15 of 23 course turns and 14 of 18 world turns rang Wobo's
 *     own transcript back at the learner, because the companion's bubbles were entries on the map.
 *  2. NOTHING OFF THE GLASS IS ON THE MAP, and when the thing the question names is off the glass
 *     the FREEZE scrolls it into view before the read (`diagram-c4.effect` was offered at y=-143).
 *  3. THE FOLD IS SETTLED BEFORE THE READ: at 390 the map carried the learner's bubble at its
 *     unfolded y and the ring landed on that ghost, because two rAFs read a half-folded sheet.
 *
 * And the lasso's half of finding 5: on a fresh page the gesture resolved nothing, so the chip
 * asked "explain this: the circle being drawn" — the gesture layer's own announcement.
 *
 * Frames are kept beside the maps under WOBO_GLASS_SHOTS.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, seedOnboarded } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SHOTS = process.env.WOBO_GLASS_SHOTS ?? join(tmpdir(), 'wobo-glass-own');
mkdirSync(SHOTS, { recursive: true });

type Box = [number, number, number, number];
interface Entry {
  id: string;
  role: string;
  text: string;
  box: Box;
  meaning?: string;
}
interface GlassMap {
  v: 1;
  viewport: { w: number; h: number; scrollY: number; theme?: string; reduced?: boolean };
  entries: Entry[];
  more?: number;
}
interface Inspector {
  take: (options?: { question?: string }) => GlassMap;
  current: () => GlassMap | null;
  rectOf: (id: string) => DOMRect | null;
  hold: () => { held: boolean; reason: string | null; released: string | null };
  settle: () => Promise<void>;
  scrolled: () => boolean;
  freeze: (reason?: string) => void;
  release: (why?: 'escape' | 'tap' | 'voice' | 'end') => void;
}
type Lab = Window & { __woboGlassRead?: Inspector };

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

/** Take the glass the way a turn does: hold, wait for the fold, then read. */
function take(page: Page, question: string): Promise<GlassMap> {
  return page.evaluate(async (q) => {
    const i = (window as unknown as Lab).__woboGlassRead;
    if (!i) throw new Error('no glass inspector on this page');
    await i.settle();
    return i.take({ question: q });
  }, question);
}

async function keep(page: Page, name: string, map: GlassMap | null): Promise<void> {
  writeFileSync(join(SHOTS, `${name}.json`), JSON.stringify(map, null, 2));
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

interface Screen {
  width: number;
  height: number;
  theme?: 'light' | 'dark';
  reduced?: boolean;
}

/** The atom course's arrival card, on a given screen. */
async function arrive(page: Page, screen: Screen): Promise<void> {
  await page.emulateMedia({
    colorScheme: screen.theme ?? 'light',
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
  await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('link', { name: /Linear equations in one variable/ })
    .first()
    .click();
  await page
    .getByRole('link', { name: /^Solving equations with the variable on one side/ })
    .first()
    .click();
  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
}

/** Three turns in Wobo's own drawer, in the learner's own unmistakable words. */
const SAID = [
  'zarquon balances the vorple pans',
  'blorptastic second thought about grimwald',
  'quixnard the third, plainly',
];

async function converse(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const drawer = (await import('/src/wobo/drawer.ts')) as {
      openCompanion: (request: { reason: 'reteach' }) => void;
    };
    drawer.openCompanion({ reason: 'reteach' });
  });
  const sheet = page.getByRole('dialog', { name: 'Wobo' });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  const composer = sheet.getByPlaceholder(/Ask or do anything|Explain it to Wobo/);
  for (const line of SAID) {
    await composer.fill(line);
    await composer.press('Enter');
    await expect(sheet.getByText(line, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
  }
}

// --- 1. Wobo's own surfaces are never on the glass -------------------------------------------------

const SCREENS: Screen[] = [
  { ...PHONE, theme: 'light' },
  { ...PHONE, theme: 'dark' },
  { ...DESK, theme: 'light' },
  { ...DESK, theme: 'dark' },
  { ...PHONE, theme: 'light', reduced: true },
];

for (const screen of SCREENS) {
  const name = `${screen.width}-${screen.theme}${screen.reduced ? '-reduced' : ''}`;
  test(`after three turns the map carries not one word the learner typed, at ${name}`, async ({
    page,
  }) => {
    await arrive(page, screen);
    await converse(page);
    // the turn's own order: hold, let the fold settle, read
    await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.freeze('turn'));
    const map = await take(page, SAID[0] as string);
    await keep(page, `own-${name}`, map);

    const words = ['zarquon', 'vorple', 'blorptastic', 'grimwald', 'quixnard'];
    const leaked = map.entries.filter((e) => words.some((w) => e.text.toLowerCase().includes(w)));
    expect(leaked, `Wobo's transcript is on the map: ${JSON.stringify(leaked)}`).toHaveLength(0);

    // and nothing on the map lives inside a surface Wobo owns
    const inside = await page.evaluate(
      (ids: string[]) => {
        const i = (window as unknown as Lab).__woboGlassRead;
        const out: string[] = [];
        for (const id of ids) {
          const box = i?.rectOf(id);
          if (!box) continue;
          const at = document.elementsFromPoint(
            Math.min(window.innerWidth - 1, Math.max(0, box.x + box.width / 2)),
            Math.min(window.innerHeight - 1, Math.max(0, box.y + box.height / 2)),
          );
          // the topmost thing at the entry's middle: an entry whose own element is Wobo's own is a leak
          const own = at.find((el) => el.closest('[data-wobo-surface]'));
          if (own && at.indexOf(own) === 0) out.push(id);
        }
        return out;
      },
      map.entries.map((e) => e.id),
    );
    // Wobo's drawer covers part of the page: an entry UNDER it is occluded, not a leak, so this
    // only asserts that no entry IS Wobo's own surface — the drawer's own lines have no entry.
    for (const id of inside) {
      const entry = map.entries.find((e) => e.id === id) as Entry;
      const text = entry.text.toLowerCase();
      expect(words.some((w) => text.includes(w))).toBe(false);
    }

    // the lesson's own words are still there: the map did not go empty
    expect(map.entries.length).toBeGreaterThan(3);
    await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.release('end'));
  });
}

// --- 2. nothing off the glass is on the map, and the freeze scrolls it in --------------------------

test('nothing off the glass is on the map, and what the question names is scrolled in first', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await seedOnboarded(page);
  await page.goto('/');
  // the seeded diagram, pushed far below the fold, with page under it
  await page.evaluate(async () => {
    const lab = (await import('/src/wobo/glass-lab.tsx')) as {
      mountDiagramLab: (host: HTMLElement) => () => void;
    };
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    spacer.textContent = 'a long page of ordinary words about nothing in particular';
    document.body.prepend(spacer);
    const host = document.createElement('div');
    host.id = 'glass-lab';
    spacer.after(host);
    lab.mountDiagramLab(host);
  });
  await expect(page.locator('#glass-lab svg')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // before: the effect circle is well below the fold
  const before = await page.evaluate(() => {
    const el = document.querySelector('#glass-lab svg #effect');
    const r = el?.getBoundingClientRect();
    return { y: r?.y ?? 0, scroll: window.scrollY };
  });
  expect(before.y).toBeGreaterThan(PHONE.height);

  // a turn that may draw: the glass is HELD before it is read, and the freeze scrolls
  const map = await page.evaluate(async () => {
    const i = (window as unknown as Lab).__woboGlassRead;
    if (!i) throw new Error('no glass inspector on this page');
    i.freeze('turn');
    await i.settle();
    return i.take({ question: 'circle the effect circle in the diagram' });
  });
  await keep(page, 'offglass-390', map);

  // the freeze brought it onto the glass and read there
  expect(await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.scrolled())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before.scroll);
  const effect = map.entries.find((e) => e.id === 'diagram-c3.effect');
  expect(effect, 'the part the words name is on the map').toBeDefined();

  // and NOTHING on the map is off the glass, whatever the question named
  for (const e of map.entries) {
    expect(e.box[1] + e.box[3], `${e.id} is above the glass`).toBeGreaterThan(0);
    expect(e.box[1], `${e.id} is below the glass`).toBeLessThan(map.viewport.h);
    expect(e.box[0] + e.box[2], `${e.id} is left of the glass`).toBeGreaterThan(0);
    expect(e.box[0], `${e.id} is right of the glass`).toBeLessThan(map.viewport.w);
  }
});

// --- 3. the fold is settled before the read --------------------------------------------------------

test('at 390 every mapped box is the box in the frame the learner sees', async ({ page }) => {
  await arrive(page, PHONE);
  await converse(page);

  // The fold, slowed to a real transition so the read cannot outrun it. The sheet is a modal over
  // the page at 390: what it covers is NOT on the glass, so a map taken half way through the fold
  // is a map of the page the learner is about to stop seeing — most of the lesson dropped as
  // occluded, and the ring left on the ghost of a box that has moved (the lab's held.png at 390).
  await page.addStyleTag({
    content: '[data-wobo-sheet]{transition: height 400ms linear, top 400ms linear !important;}',
  });

  // exactly what a board turn does, in one task: hold, wait for the fold, read. A round trip to
  // the test would hand the fold time the app never gives it.
  const map = await page.evaluate(async () => {
    const i = (window as unknown as Lab).__woboGlassRead;
    if (!i) throw new Error('no glass inspector on this page');
    i.freeze('turn');
    await i.settle();
    return i.take({ question: 'what is this lesson about?' });
  });
  await keep(page, 'folded-390', map);
  // the sheet has folded to its strip by the time the map exists
  await expect(page.locator('[data-glass-strip]')).toBeVisible();
  // and the page the strip uncovered is on the map: read mid-fold, this band is still under a
  // modal sheet and every line in it is dropped as occluded
  const uncovered = map.entries.filter(
    (e) => e.box[1] > 120 && e.box[1] + e.box[3] < PHONE.height - 140,
  );
  expect(
    uncovered.length,
    `the page under the folded sheet is on the map: ${JSON.stringify(map.entries.map((e) => [e.id, e.box]))}`,
  ).toBeGreaterThan(2);

  // let every animation finish, then read the same still page again: a map taken mid-fold is a map
  // of boxes that are no longer there, which is how the ring landed on the ghost of the bubble
  await page.waitForTimeout(900);
  const settled = await take(page, 'what is this lesson about?');
  await keep(page, 'folded-390-settled', settled);
  const moved: { id: string; was: Box; now: Box }[] = [];
  for (const e of map.entries) {
    const now = settled.entries.find((s) => s.id === e.id);
    if (!now) continue;
    if (Math.abs(now.box[0] - e.box[0]) > 1 || Math.abs(now.box[1] - e.box[1]) > 1) {
      moved.push({ id: e.id, was: e.box, now: now.box });
    }
  }
  expect(moved, `boxes moved after the read: ${JSON.stringify(moved)}`).toHaveLength(0);
  // the map is not empty and it is the page, not the sheet
  expect(settled.entries.length).toBeGreaterThan(3);
  await page.evaluate(() => (window as unknown as Lab).__woboGlassRead?.release('end'));
});

// --- 4. the lasso resolves against the page, never against Wobo's own announcement ----------------

test('a lasso on a fresh page circles the page, not the circle being drawn', async ({ page }) => {
  await arrive(page, DESK);
  // arm the circle from the course's own control, then draw a loop round a line of the lesson
  await page
    .getByRole('button', { name: /^Circle$/i })
    .first()
    .click();
  const line = page.getByText(/^one idea/i).first();
  const box = await line.boundingBox();
  expect(box).not.toBeNull();
  const b = box as { x: number; y: number; width: number; height: number };
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = Math.max(90, b.width / 2 + 20);
  const ry = Math.max(40, b.height / 2 + 26);
  await page.mouse.move(cx + rx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  await page.mouse.up();

  // the chip appears with what the learner circled — the page's own words
  const announced = await page.evaluate(() => {
    const live = document.querySelector('[data-wobo-gesture-layer] [aria-live]');
    return live?.textContent ?? '';
  });
  await keep(page, 'lasso-1440', null);
  expect(announced.toLowerCase()).not.toContain('the circle being drawn');
  expect(announced.toLowerCase()).toContain('circled');
  expect(announced.length).toBeGreaterThan('circled a region of the screen.'.length);

  // and a loop round bare page, where nothing is registered and the fallback is the DOM under the
  // pointer: the gesture layer is the topmost thing under every point of its own trace, and its
  // own `<title>` and announcement were what came back (the lab's "explain this: the circle being
  // drawn"). It is Wobo's own surface, so it is skipped here as it is on the glass.
  await page
    .getByRole('button', { name: /^Circle$/i })
    .first()
    .click();
  const bare = { x: 40, y: 300 };
  await page.mouse.move(bare.x + 70, bare.y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    await page.mouse.move(bare.x + Math.cos(a) * 70, bare.y + Math.sin(a) * 50);
  }
  await page.mouse.up();
  const second = await page.evaluate(() => {
    const live = document.querySelector('[data-wobo-gesture-layer] [aria-live]');
    return live?.textContent ?? '';
  });
  expect(second.toLowerCase()).not.toContain('the circle being drawn');
  expect(second.toLowerCase()).not.toContain('ask wobo about this. ask wobo about this');
});
