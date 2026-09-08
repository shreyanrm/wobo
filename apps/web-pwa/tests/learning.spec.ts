/**
 * THE LEARNING SURFACES KEEP THEIR WORD — wave 29's confirmed findings on the home, the course, the
 * practice door, the progress report and the flashcard engine, each reproduced the way the walker
 * reproduced it and then held to the fix:
 *
 *   learn-1  a cold open of /progress (F5, a deep link) no longer tells a parent nothing was learnt,
 *            and no longer wipes `wobo-sky-seen-v1` with an empty set.
 *   learn-5  a learner who missed once is not told they never put a foot wrong.
 *   learn-3  the forge has a door: a workbook can be bound from /practice and lands on the shelf.
 *   learn-4  the practice door keeps position, marks and results across Home and a reload, and
 *            a first correct check reaches the account once.
 *   learn-6  a flashcard's answer is out of the accessibility tree until it is flipped, and the
 *            flip is reachable from the keyboard.
 *
 * Keyless, like journey.spec.ts: the atom world is pinned before boot and its brain installed after
 * each navigation; a reload keeps the offline cache, which is exactly the cold open being tested.
 */

import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import {
  ATOM_ANSWERS,
  actionBarButton,
  assertNoErrors,
  seedOnboarded,
  watchConsole,
} from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

const SKY_SEEN = 'wobo-sky-seen-v1';

/**
 * The learner's XP as the progress store saved it (`wobo-progress-v1`, the SDK's state cache, bare
 * in a keyless run). The header on the practice door carries no XP chip, so the account is read
 * where it is kept rather than where a course happens to print it.
 */
async function storedXp(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('wobo-progress-v1');
    if (!raw) return 0;
    try {
      const xp = (JSON.parse(raw) as { xp?: unknown }).xp;
      return typeof xp === 'number' ? xp : 0;
    } catch {
      return 0;
    }
  });
}

/**
 * Learn to the atom topic's arrival card. The Learn screen draws the subject as a pressed button
 * and its next chapter as a link (helpers.ts `openAtomCourse` predates that row and stalls on it).
 */
async function openAtomCourse(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Learn', exact: true }).click();
  await page.getByRole('link', { name: /Linear equations in one variable/ }).click();
  await expect(
    page.getByRole('heading', { name: /Mathematics, where your class is this week/ }),
  ).toBeVisible();
  // the climb is open on arrival; the topic is a link on it
  await page
    .getByRole('link', { name: /^Solving equations with the variable on one side/ })
    .click();
}

/** Read the current practice/boss equation by matching the on-screen text to the seed set. */
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

/** The atom course to its greeting, with ONE deliberate miss on the first practice item. */
async function finishAtomCourseWithOneMiss(page: Page): Promise<void> {
  await openAtomCourse(page);
  await actionBarButton(page, 'begin').click();

  const weight = page.getByLabel('take this weight off');
  for (let i = 0; i < 6; i += 1) await weight.first().click();
  const scaleContinue = actionBarButton(page, 'continue');
  await expect(scaleContinue).toBeEnabled({ timeout: 15_000 });
  await scaleContinue.click();

  const whatIf = page.getByText('Every number here is yours to drag', { exact: true });
  await expect(whatIf).toBeVisible({ timeout: 15_000 });
  // The bar re-binds in an effect after the card lands; a click that arrives first is a no-op.
  // "Solve for x" is also the step's label in the course rail, so the card is awaited by the
  // What-if leaving, not by that text appearing.
  await actionBarButton(page, 'continue').click();
  if (await whatIf.isVisible().catch(() => false)) {
    await page.waitForTimeout(600);
    if (await whatIf.isVisible().catch(() => false))
      await actionBarButton(page, 'continue').click();
  }
  await expect(whatIf).toBeHidden({ timeout: 10_000 });
  expect(await currentEquation(page)).toBe('x + 7 = 12');
  await page.keyboard.type('9'); // the miss: the answer is 5
  await actionBarButton(page, 'check').click();
  await expect(page.getByText('The honest move')).toBeVisible({ timeout: 8_000 });
  const detonateContinue = actionBarButton(page, 'continue');
  await expect(detonateContinue).toBeEnabled({ timeout: 8_000 });
  await detonateContinue.click();

  for (let i = 0; i < 3; i += 1) {
    await expect(page.getByText('Solve for x', { exact: true })).toBeVisible({ timeout: 10_000 });
    const eq = await currentEquation(page);
    await page.keyboard.type(ATOM_ANSWERS[eq] as string);
    await actionBarButton(page, 'check').click();
    await expect(page.getByText('that holds.').first()).toBeVisible({ timeout: 8_000 });
    await actionBarButton(page, 'continue').click();
  }

  await expect(page.getByText('the boss', { exact: true })).toBeVisible({ timeout: 10_000 });
  await actionBarButton(page, 'step in').click();
  const bossEq = await currentEquation(page);
  await page.getByLabel('your answer for x').fill(ATOM_ANSWERS[bossEq] as string);
  await page.getByRole('button', { name: 'multiply both sides by 2' }).click();
  await page.getByRole('button', { name: '2x = 16', exact: true }).click();
  await actionBarButton(page, 'check all three').click();
  await actionBarButton(page, 'continue').click();
  await expect(page.getByText('The greeting', { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function openPalette(page: Page, where: string): Promise<void> {
  await page.keyboard.press('Control+k');
  const palette = page.getByPlaceholder('Where to, or what…');
  await expect(palette).toBeVisible();
  await palette.fill(where);
  await page.keyboard.press('Enter');
}

test('learn-1, learn-5, learn-3: the report survives a cold open, the greeting tells the truth, the forge opens', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto('/');
  await installAtomBrain(page, ATOM_TARGET_NODE_ID);
  await finishAtomCourseWithOneMiss(page);

  // learn-5: one miss, three stars, and a sentence that does not deny the miss
  await expect(page.getByText('You never put a foot wrong')).toHaveCount(0);
  await expect(
    page.getByText('One slip on the way, and you set it right before the end.').first(),
  ).toBeVisible();
  await actionBarButton(page, 'continue').click();

  // learn-1: inside the app the report counts the lesson
  await openPalette(page, 'progress');
  await expect(page.getByRole('heading', { name: 'Your map' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('nothing has slipped back', { exact: true })).toBeVisible();
  await expect(page.getByText(/is behind you/).first()).toBeVisible();
  const seenBefore = await page.evaluate((k) => sessionStorage.getItem(k), SKY_SEEN);
  expect(seenBefore).toContain('m2-1');

  // ... and it still does after F5 on the same address, with the seen set intact
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your map' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('nothing has slipped back', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('your syllabus lands here once it is set')).toHaveCount(0);
  await expect(page.getByText('Your map draws itself as you go')).toHaveCount(0);
  const seenAfter = await page.evaluate((k) => sessionStorage.getItem(k), SKY_SEEN);
  expect(seenAfter).toContain('m2-1');

  // learn-3: the forge has a door, and a workbook bound there lands on the shelf and opens
  await page.goto('/practice');
  await expect(page.getByText('Practice · Fractions · 1 of 5')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Forge a workbook' }).click();
  await expect(page.getByText('Practice · The forge')).toBeVisible();
  await page
    .getByRole('button', { name: 'Solving equations with the variable on one side', exact: true })
    .click();
  await page.getByRole('button', { name: /^forge · 20 items$/ }).click();
  await expect(page.getByText('Practice · Fractions · 1 of 5')).toBeVisible({ timeout: 10_000 });
  const shelf = page.getByRole('button', {
    name: /^Solving equations with the variable on one side, /,
  });
  await expect(shelf).toBeVisible();
  await expect(shelf).toBeEnabled({ timeout: 20_000 }); // the download centre composes it offline
  const forgedRows = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('wobo-forged-v1'))
      .map((k) => JSON.parse(localStorage.getItem(k) ?? '[]').length),
  );
  expect(forgedRows).toEqual([1]);
  await shelf.click();
  await expect(page.getByRole('heading', { name: 'A forged workbook' })).toBeVisible({
    timeout: 10_000,
  });
  // twenty real linear-equation problems, paged by five: the forge composed something, not nothing
  await expect(page.getByText('a forged workbook · 4 pages', { exact: true })).toBeVisible();
  await actionBarButton(page, 'begin').click();
  await page.getByRole('button', { name: 'Practice', exact: true }).click(); // the close, never a trap
  await expect(page.getByText('Practice · Fractions · 1 of 5')).toBeVisible({ timeout: 10_000 });

  assertNoErrors(errors, info);
});

test('learn-4: the practice door keeps the run across Home and a reload, and the first correct check earns XP once', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await page.goto('/practice');
  await expect(page.getByText('Practice · Fractions · 1 of 5')).toBeVisible({ timeout: 10_000 });
  const before = await storedXp(page);

  // answer the second item of the set
  await page.getByRole('button', { name: /Which is bigger/ }).click();
  await expect(page.getByText('Practice · Fractions · 2 of 5')).toBeVisible();
  await page.getByRole('radio', { name: 'a bar in three parts with one part shaded' }).click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('that holds.')).toBeVisible();
  await expect.poll(() => storedXp(page), { timeout: 8_000 }).toBe(before + 10);

  // Home, and back: the place and the tick are still there
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Practice', exact: true }).click();
  await expect(page.getByText('Practice · Fractions · 2 of 5')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: /Which is bigger/ }).getByRole('img', { name: 'done' }),
  ).toBeVisible();

  // F5: the same
  await page.reload();
  await expect(page.getByText('Practice · Fractions · 2 of 5')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: /Which is bigger/ }).getByRole('img', { name: 'done' }),
  ).toBeVisible();
  expect(await storedXp(page)).toBe(before + 10);

  // a second run of the same item is real practice and earns nothing twice
  await page.getByRole('button', { name: 'Start over' }).first().click();
  await expect(page.getByText('Practice · Fractions · 1 of 5')).toBeVisible();
  await page.getByRole('button', { name: /Which is bigger/ }).click();
  await page.getByRole('radio', { name: 'a bar in three parts with one part shaded' }).click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('that holds.')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await storedXp(page)).toBe(before + 10);

  assertNoErrors(errors, info);
});

test('learn-6: a flashcard keeps its answer out of the tree until flipped, and flips from the keyboard', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await page.goto('/concept/engines');
  await page.getByRole('button', { name: /flashcards — spring 3d flip, FSRS on grade/ }).click();

  const main = page.locator('main').first();
  const card = page.getByRole('button', { name: /what decides which element an atom is\?/ });
  await expect(card).toBeVisible();
  const before = await main.ariaSnapshot();
  expect(before).toContain('what decides which element an atom is?');
  expect(before).not.toContain('the number of protons');

  await card.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => main.ariaSnapshot(), { timeout: 5_000 })
    .toContain('the number of protons in its nucleus.');
  const after = await main.ariaSnapshot();
  expect(after).not.toContain('what decides which element an atom is?');

  assertNoErrors(errors, info);
});
