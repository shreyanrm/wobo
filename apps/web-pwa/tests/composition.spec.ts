/**
 * THE COMPOSER, IN A REAL BROWSER, AT 390 AND 1440.
 *
 * docs/CONTENT-INTERACTION.md §3 asks for one renderer that takes ANY valid composition of the
 * primitives, with "a hit area a finger can use", "feedback that teaches on a wrong move", "the
 * moment of surprise visible" and "nothing that jumps". A unit test can assert the data. Only a
 * browser can assert the pixels, so this suite plays the three designed interactions and the seven
 * template floors on the bench (`/compose-bench.html`) and measures what a learner would feel:
 *
 *   1. every control a learner must touch is at least 44 css px on both axes, at 390;
 *   2. a wrong move prints a line about the IDEA, and never the word "wrong" or "try again";
 *   3. the reveal appears only after the act, never before, and the advance is shut until it does;
 *   4. every one of the ten is completable end to end, by clicking what a finger could hit;
 *   5. nothing jumps: the page never scrolls sideways, and the prompt does not move while playing.
 *
 * Every browser here is launched muted by the suite's own config (`--mute-audio`, docs/INK-FOUR.md).
 */

import { expect, type Locator, type Page, test } from '@playwright/test';

/** The two widths the wave is measured at. */
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

/** The finger's law, in css pixels — `plexus/specs.py`'s MIN_HIT_PX. */
const MIN_HIT = 44;

/** The ten: the designer's three, then §2's floors in order. */
const DESIGNED = [
  'designed-equivalent-fractions',
  'designed-plant-cell',
  'designed-nature-of-roots',
];
const FLOORS = [
  'floor-classify',
  'floor-order',
  'floor-match',
  'floor-vary',
  'floor-construct',
  'floor-discriminate',
  'floor-drill',
];
const ALL = [...DESIGNED, ...FLOORS];

const bench = (id: string, theme = 'light') => `/compose-bench.html?design=${id}&theme=${theme}`;

async function open(page: Page, id: string, size: typeof PHONE, theme = 'light') {
  await page.setViewportSize(size);
  await page.goto(bench(id, theme));
  const section = page.locator(`[data-bench-design="${id}"]`);
  await expect(section).toBeVisible();
  await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => {});
  // The stage lands with a spring. Every measurement below is of a page AT REST, which is the only
  // way "nothing jumps" means anything (DESIGN.md §0: the first paint shows the page at rest).
  await page.waitForTimeout(700);
  return section;
}

/** Everything a learner is asked to touch in the beat that is on. */
function controls(section: Locator): Locator {
  return section.locator(
    '.cx button:not([disabled]), .cx [role="button"]:not([aria-disabled="true"]), .cx input[type="range"]',
  );
}

/**
 * Play the beat that is on until it is done, by doing the right thing for whatever act it is. The
 * point is not to be clever: it is to prove that a finger CAN finish every one of them.
 */
async function playBeat(page: Page, section: Locator): Promise<void> {
  const cx = section.locator('.cx');
  const kind = await cx.getAttribute('data-cx-kind');

  if (kind === 'slide') {
    // `End` is one real key press that takes a range to its maximum: a learner's own input path,
    // and deterministic in a way that setting `.value` past React's change tracker is not.
    const range = cx.locator('input[type="range"]');
    await range.focus();
    await range.press('End');
    return;
  }

  if (kind === 'drop') {
    // Take whichever token is still on the tray and try every zone until one accepts it. A wrong try
    // is the point: it is what proves the teaching line lands.
    const tray = cx.locator('[data-cx="tray"] > button:not([disabled])');
    const zones = cx.locator('[data-cx="zones"] > button');
    const zn = await zones.count();
    for (let picked = 0; picked < 10; picked++) {
      const left = await tray.count();
      if (left === 0) break;
      await tray.first().click();
      for (let z = 0; z < zn; z++) {
        await zones.nth(z).click();
        if ((await tray.count()) < left) break; // it landed
      }
    }
    return;
  }

  if (kind === 'sort') {
    // The right order is nowhere on the page, so the proof solves it the only way a learner can:
    // swap two cards, ask for the check, and keep the swap only if it settled the position it was
    // aiming at. A selection sort over the check signal converges in at most n squared checks.
    const lane = cx.locator('[data-cx="lane"] > button');
    const check = cx.locator('[data-cx="check"]');
    const n = await lane.count();
    const settled = async (i: number) =>
      ((await lane.nth(i).getAttribute('class')) ?? '').includes('cx-right');
    // The check closes itself the moment the order is right, which is also the moment the beat is
    // done. Every click below asks first, so the solver stops the instant the learner would.
    const ask = async () => {
      if (!(await check.isEnabled())) return false;
      await check.click();
      return true;
    };

    await ask();
    for (let i = 0; i < n; i++) {
      if (await settled(i)) continue;
      for (let j = i + 1; j < n; j++) {
        await lane.nth(i).click();
        await lane.nth(j).click();
        if (!(await ask())) return;
        if (await settled(i)) break;
        // put it back and try the next candidate
        await lane.nth(i).click();
        await lane.nth(j).click();
        if (!(await ask())) return;
      }
    }
    await ask();
    return;
  }

  if (kind === 'match') {
    const lefts = cx.locator('.cx-match > .cx-col').first().locator('button');
    const rights = cx.locator('.cx-match > .cx-col').last().locator('button');
    const n = await lefts.count();
    const rn = await rights.count();
    for (let i = 0; i < n; i++) {
      const left = lefts.nth(i);
      if (await left.isDisabled()) continue;
      await left.click();
      for (let r = 0; r < rn; r++) {
        const right = rights.nth(r);
        if (await right.isDisabled()) continue;
        await right.click();
        if (await left.isDisabled()) break; // joined
        // a wrong join keeps the left held, so it is still armed for the next right
      }
    }
    return;
  }

  if (kind === 'sequence') {
    for (;;) {
      const tray = cx.locator('[data-cx="tray"] > button:not([disabled])');
      const n = await tray.count();
      if (n === 0) break;
      let moved = false;
      for (let i = 0; i < n; i++) {
        const before = await cx.locator('[data-cx="built"] > li').count();
        await tray.nth(i).click();
        const after = await cx.locator('[data-cx="built"] > li').count();
        if (after > before) {
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return;
  }

  if (kind === 'branch') {
    const options = cx.locator('[data-cx="options"] > button');
    const n = await options.count();
    for (let i = 0; i < n; i++) {
      await options.nth(i).click();
      if (await cx.locator('[data-cx="reveal"]').isVisible()) return;
    }
    return;
  }

  if (kind === 'tap' || kind === 'mark') {
    const targets = cx.locator('[data-cx="target"]');
    const n = await targets.count();
    for (let i = 0; i < n; i++) await targets.nth(i).click({ force: true });
    return;
  }

  if (kind === 'drag') {
    // The arrow-key path: the same release the pointer takes, and deterministic. Both ends are read
    // off the stage rather than guessed, so moving the design never silently breaks the proof.
    const handle = cx.locator('[data-cx="handle"]');
    const zone = cx.locator('[data-cx="zone"]');
    const at = async (l: Locator) => ({
      x: Number(await l.getAttribute('cx')),
      y: Number(await l.getAttribute('cy')),
    });
    const from = await at(handle);
    const to = await at(zone);
    const STEP = 4; // the arrow key's own step, in stage units
    await handle.focus();
    const across = Math.round((to.x - from.x) / STEP);
    const down = Math.round((to.y - from.y) / STEP);
    for (let i = 0; i < Math.abs(across); i++)
      await page.keyboard.press(across > 0 ? 'ArrowRight' : 'ArrowLeft');
    for (let i = 0; i < Math.abs(down); i++)
      await page.keyboard.press(down > 0 ? 'ArrowDown' : 'ArrowUp');
    await page.keyboard.press('Enter');
    return;
  }

  throw new Error(`the bench met an act the proof cannot play: ${kind}`);
}

test.describe('the composer renders any valid composition', () => {
  for (const size of [PHONE, DESK]) {
    const at = `${size.width}`;

    test(`every control is a hit area a finger can use, at ${at}`, async ({ page }) => {
      const small: string[] = [];
      for (const id of ALL) {
        const section = await open(page, id, size);
        const items = controls(section);
        const n = await items.count();
        expect(n, `${id} offers nothing to touch`).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
          const item = items.nth(i);
          const box = await item.boundingBox();
          if (!box) continue;
          if (box.width < MIN_HIT - 0.5 || box.height < MIN_HIT - 0.5) {
            const what = await item.evaluate((el) =>
              `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60),
            );
            small.push(`${id} ${what} ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
          }
        }
      }
      expect(small, `controls under ${MIN_HIT}px at ${at}`).toEqual([]);
    });

    test(`nothing scrolls sideways, at ${at}`, async ({ page }) => {
      for (const id of ALL) {
        await open(page, id, size);
        const over = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(over.scroll, `${id} is wider than the screen at ${at}`).toBeLessThanOrEqual(
          over.client + 1,
        );
      }
    });

    test(`every one is completable, and the advance stays shut until it is, at ${at}`, async ({
      page,
    }) => {
      for (const id of ALL) {
        const section = await open(page, id, size);
        const advance = section.locator('[data-bench="advance"]');

        // Guard against a beat that never completes: a design carries at most five, of which the
        // modifiers are lifted off, so four acts is the most any of the ten can ask for.
        for (let beat = 0; beat < 6; beat++) {
          if (await section.locator('[data-bench="finished"]').isVisible()) break;
          // The reveal is not on the screen before the act, and the advance is shut.
          await expect(section.locator('[data-cx="reveal"]')).toHaveCount(0);
          await expect(advance).toBeDisabled();

          await playBeat(page, section);

          await expect(section.locator('[data-cx="reveal"]')).toBeVisible({ timeout: 5_000 });
          await expect(advance).toBeEnabled();
          await advance.click();
        }
        await expect(section.locator('[data-bench="finished"]')).toBeVisible();
      }
    });
  }

  test('a wrong move teaches the idea, and never says "wrong"', async ({ page }) => {
    // The classify floor: six rocks, three bins. Picking the first zone for every token guarantees
    // a wrong drop, which is exactly the move the law is about.
    const section = await open(page, 'floor-classify', PHONE);
    const cx = section.locator('.cx');
    const tokens = cx.locator('[data-cx="tray"] > button:not([disabled])');
    const zones = cx.locator('[data-cx="zones"] > button');

    const lines: string[] = [];
    // The tray shrinks as tokens land, so take whichever token is still on it rather than an index
    // into a list that is changing under the loop.
    for (let picked = 0; picked < 8; picked++) {
      const left = await tokens.count();
      if (left === 0) break;
      await tokens.first().click();
      for (let z = 0; z < 3; z++) {
        await zones.nth(z).click();
        const teach = cx.locator('[data-cx="teach"]');
        if (await teach.isVisible()) lines.push((await teach.innerText()).trim());
        if ((await tokens.count()) < left) break; // it landed
      }
    }

    expect(lines.length, 'a wrong drop said nothing at all').toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length, `a teaching line that short taught nothing: "${line}"`).toBeGreaterThan(
        20,
      );
      expect(line.toLowerCase()).not.toMatch(/\b(wrong|incorrect|try again|oops|nope)\b/);
      expect(line).not.toContain('—');
    }
  });

  /**
   * RULE 3, ON A REAL SCREEN (docs/LEARNING-MODEL.md, "the tutor never leaves", the owner
   * 2026-09-15): *"Every wrong answer gets the reason it is wrong, DRAWN WHERE THE MISTAKE IS."*
   *
   * A drop is wrong as a PAIR — this token, that bin — so the line a learner reads must be the
   * refusal of the bin they chose, not the token's own description. `DropPlay` passed only the
   * token, so the zone's refusal was unreachable and the learner read why marble is marble instead
   * of why it is not igneous. Measured at both widths and in both themes, because a line nobody
   * can read is a line that was not said.
   */
  for (const size of [PHONE, DESK]) {
    for (const theme of ['light', 'dark']) {
      test(`a wrong drop reads as the bin's own refusal, at ${size.width} in ${theme}`, async ({
        page,
      }) => {
        const section = await open(page, 'floor-classify', size, theme);
        const cx = section.locator('.cx');
        const marble = cx.locator('[data-cx="tray"] > button', { hasText: 'Marble' });
        const igneous = cx.locator('[data-cx="zones"] > button', {
          hasText: 'Cooled from molten rock',
        });
        const teach = cx.locator('[data-cx="teach"]');

        // Marble is metamorphic. Putting it with the molten rocks is a real, specific mistake.
        await marble.click();
        await igneous.click();
        await expect(teach).toBeVisible();
        const first = (await teach.innerText()).trim();

        // THE BIN'S reason, not the token's. "never melted" is what this zone refuses for;
        // "recrystallised" is marble's own story and answers a question nobody asked.
        expect(first.toLowerCase()).toContain('never melted');
        expect(first.toLowerCase()).not.toContain('recrystallised');

        // ...and the ink is legible on whichever ground this theme paints.
        const seen = await teach.evaluate((el) => ({
          color: getComputedStyle(el).color,
          ground: getComputedStyle(el).backgroundColor,
        }));
        expect(seen.color).not.toBe(seen.ground);
        expect(seen.color).not.toBe('rgba(0, 0, 0, 0)');

        // RULE 4: the same mistake again is never answered with the same sentence again.
        // A refused token stays IN HAND (the zones are armed only while something is held), so the
        // learner simply tries the same bin again. Picking marble up a second time would put it
        // back down and disarm every bin.
        await igneous.click();
        // The teaching line animates out before the next one animates in (AnimatePresence
        // `mode="wait"`), so the exiting paragraph is still in the DOM and `toBeVisible` would
        // resolve against the sentence that is on its way off. Wait for the words themselves to
        // change, which is what a learner actually waits for.
        await expect(teach).not.toHaveText(first);
        const second = (await teach.innerText()).trim();
        expect(second).not.toBe(first);
        expect(second.length).toBeGreaterThan(10);
        expect(second.toLowerCase()).not.toMatch(/\b(wrong|incorrect|try again|oops|nope)\b/);
        expect(second).not.toContain('—');
      });
    }
  }

  test('the moment of surprise is what lands, and only once the act is done', async ({ page }) => {
    const section = await open(page, 'designed-equivalent-fractions', PHONE);
    await expect(section.locator('[data-cx="reveal"]')).toHaveCount(0);
    await playBeat(page, section);
    const reveal = section.locator('[data-cx="reveal"]');
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText('never grew');
  });

  test('nothing jumps: the prompt holds its place while the learner plays', async ({ page }) => {
    const section = await open(page, 'floor-discriminate', PHONE);
    const prompt = section.locator('[data-cx="prompt"]');
    const before = await prompt.boundingBox();
    await section.locator('[data-cx="options"] > button').nth(1).click();
    await page.waitForTimeout(400);
    const after = await prompt.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
  });

  test('both themes paint, and the ink stays legible on either ground', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
      const section = await open(page, 'floor-order', DESK, theme);
      const seen = await section.locator('.cx-prompt').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, ground: getComputedStyle(document.body).backgroundColor };
      });
      expect(seen.color).not.toBe(seen.ground);
      expect(seen.color).not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('a design the door refuses renders nothing, and says nothing about it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(bench('nothing-of-the-sort'));
    await expect(page.locator('.cx')).toHaveCount(0);
    // never-narrate: no caption for an absence (DESIGN.md §0.x)
    const words = (await page.locator('body').innerText()).toLowerCase();
    expect(words).not.toContain('not found');
    expect(words).not.toContain('unavailable');
    expect(words).not.toContain('error');
  });
});
