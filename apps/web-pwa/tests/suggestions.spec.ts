/**
 * THE WAY BACK AND THE NEXT THING, PLAYED ON THE REAL COURSE (docs/SUGGESTIONS-AND-NOTICES.md §2;
 * docs/LEARNING-MODEL.md, "Who chooses").
 *
 * The chapter pool is the real `suggest/fixture.ts` pool served for the atom's own cell
 * (`helpers/walk.ts`). A learner plays the atom, is beaten twice by the practice run, and reads what
 * Wobo offers. Three things are held on the screen itself:
 *
 *   1. what the suggestion names is exactly the module the course then puts on stage;
 *   2. it is never the loudest thing: the lesson's own Continue is still the one filled control;
 *   3. "not now" takes it away and changes nothing about where the course goes.
 *
 * Frames land in `tests/shots/suggestions/`, at 390 and 1440, in both themes, with reduced motion.
 *
 * EVERY LAB IS MUTED. The browser comes from playwright.config.ts (`--mute-audio`), and nothing
 * here adds launch options.
 */

import { expect, type Page, test } from '@playwright/test';
import { pool } from '../src/suggest/fixture';
import {
  ATOM_ANSWERS,
  actionBarButton,
  assertNoErrors,
  seedOnboarded,
  watchConsole,
} from './helpers';
import { seedAtomWorld } from './helpers/brain';
import {
  CHAPTER_LINK,
  closeTheDrawer,
  installAtomPoolBrain,
  openTheAtom,
  throughTheDoor,
} from './helpers/walk';

const AIM = new Map(pool().modules.map((m) => [m.aim, m.id]));

const onStage = async (page: Page): Promise<string> =>
  (await page
    .locator('main.ls-stage [data-module]')
    .first()
    .getAttribute('data-module', { timeout: 2_000 })
    .catch(() => null)) ?? '-';

/** Through the scale and its free play: the first module, played clean. */
async function throughTheScale(page: Page): Promise<void> {
  const stage = page.locator('main.ls-stage');
  const scale = stage.getByLabel('take this weight off').first();
  await expect(scale).toBeVisible({ timeout: 20_000 });
  // Six taps, exactly: three off the left pan and three off the right leave x alone and the scale
  // level. Every tap counts now, under reduced motion too (balance-scale-taps.spec.ts).
  for (let i = 0; i < 6; i += 1) {
    await stage.getByLabel('take this weight off').first().click();
    await page.waitForTimeout(250);
  }
  await expect(actionBarButton(page, 'continue')).toBeEnabled({ timeout: 15_000 });
  await actionBarButton(page, 'continue').click();
  const whatIf = stage.getByText('Every number here is yours to drag', { exact: true });
  await expect(whatIf).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 4 && (await whatIf.isVisible().catch(() => false)); i += 1) {
    await actionBarButton(page, 'continue')
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await expect(whatIf).toBeHidden({ timeout: 10_000 });
}

/** The equation on the practice card. */
async function practiceEquation(page: Page): Promise<string> {
  await expect(page.locator('main.ls-stage').getByText('Solve for x', { exact: true })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  for (let tries = 0; tries < 20; tries += 1) {
    for (const eq of Object.keys(ATOM_ANSWERS)) {
      const on = page.locator('main.ls-stage').getByText(eq, { exact: true }).first();
      if (await on.isVisible().catch(() => false)) return eq;
    }
    await page.waitForTimeout(150);
  }
  throw new Error('a practice card with no equation on it');
}

/** One wrong answer on the practice card, and the detonation settled. */
async function missOnce(page: Page): Promise<void> {
  await practiceEquation(page);
  await page.keyboard.type('9');
  await actionBarButton(page, 'check').click();
  await expect(actionBarButton(page, 'continue')).toBeEnabled({ timeout: 15_000 });
  await closeTheDrawer(page);
}

/** Beaten twice: the first miss passed, the second left on screen. */
async function beatenTwice(page: Page): Promise<void> {
  await missOnce(page);
  await actionBarButton(page, 'continue').click();
  await page.waitForTimeout(400);
  await missOnce(page);
}

async function frame(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `tests/shots/suggestions/${name}.png`, fullPage: true });
}

/** The suggestion is quieter than the lesson's own Continue. */
async function quieterThanTheLesson(page: Page): Promise<void> {
  const card = page.getByTestId('suggestion');
  const take = card.getByTestId('suggestion-take');
  const takeBg = await take.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(takeBg === 'rgba(0, 0, 0, 0)' || takeBg === 'transparent').toBe(true);
  const title = await card
    .locator('h3')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  const body = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.body).fontSize),
  );
  expect(title).toBeLessThanOrEqual(body * 1.15);
  // the lesson's own Continue is still there and still the way on
  await expect(actionBarButton(page, 'continue')).toBeEnabled();
}

/**
 * A watch over the whole session, installed before the app loads: the most suggestion cards ever on
 * the page at once, and every suggestion shown, in order. It survives nothing but its own page, so
 * a reload starts a new count for the new page while sessionStorage carries the no across.
 */
async function watchSuggestions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __suggest: { most: number; shown: string[] } };
    w.__suggest = { most: 0, shown: [] };
    const look = () => {
      const cards = document.querySelectorAll('[data-testid="suggestion"]');
      w.__suggest.most = Math.max(w.__suggest.most, cards.length);
      for (const card of cards) {
        const id = card.getAttribute('aria-label') ?? '?';
        if (w.__suggest.shown.at(-1) !== id) w.__suggest.shown.push(id);
      }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
  });
}

const seen = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __suggest: { most: number; shown: string[] } }).__suggest,
  );

async function open(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await watchSuggestions(page);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto('/');
  await installAtomPoolBrain(page);
  await openTheAtom(page);
}

for (const width of [390, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`suggestions at ${width}, ${theme}`, () => {
      test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

      test('the way back names the module the course then shows, and the next thing does too', async ({
        page,
      }) => {
        test.setTimeout(120_000);
        const errors = watchConsole(page);
        await open(page, theme);

        await throughTheScale(page);
        // nothing is offered on the first miss
        await missOnce(page);
        await expect(page.getByTestId('suggestion')).toHaveCount(0);
        await actionBarButton(page, 'continue').click();
        await page.waitForTimeout(400);
        await missOnce(page);

        const card = page.getByTestId('suggestion');
        await expect(card).toHaveCount(1, { timeout: 10_000 });
        await expect(card).toHaveAttribute('data-kind', 'way_back');
        const title = (await card.locator('h3').innerText()).trim();
        const named = AIM.get(title);
        expect(
          named,
          `the way back named "${title}", which is no module of the pool`,
        ).toBeDefined();
        const said = (await card.innerText()).toLowerCase();
        for (const verdict of ['stuck', 'struggl', 'wrong', 'mistake', 'failed', 'try again']) {
          expect(said).not.toContain(verdict);
        }
        await quieterThanTheLesson(page);
        await card.scrollIntoViewIfNeeded();
        await frame(page, `way-back-${width}-${theme}`);

        await card.getByTestId('suggestion-take').click();
        await expect.poll(() => onStage(page), { timeout: 10_000 }).toBe(named as string);

        // THE NEXT THING, at the end of the worked card the way back opened. On this pool the course
        // hands p10 (a worked way in) after the check beats them, so the branch always runs.
        expect(named).toBe('p10');
        {
          const press = () => page.getByRole('button', { name: /^(next move|continue)$/i }).last();
          const worked = page
            .locator('main.ls-stage')
            .getByText('Watch each move', { exact: true });
          await expect(worked).toBeVisible({ timeout: 10_000 });
          for (let i = 0; i < 8; i += 1) {
            if ((await press().innerText()).trim().toLowerCase() === 'continue') break;
            await press().click();
            await page.waitForTimeout(200);
          }
          const next = page.getByTestId('suggestion');
          await expect(next).toHaveCount(1, { timeout: 10_000 });
          await expect(next).toHaveAttribute('data-kind', 'next');
          const nextTitle = (await next.locator('h3').innerText()).trim();
          const nextId = AIM.get(nextTitle);
          expect(nextId).toBeDefined();
          await quieterThanTheLesson(page);
          await next.scrollIntoViewIfNeeded();
          await frame(page, `next-thing-${width}-${theme}`);
          await actionBarButton(page, 'continue').click();
          await expect.poll(() => onStage(page), { timeout: 10_000 }).toBe(nextId as string);
        }
        // Across the whole walk: never two at once, and exactly the two moments, each once.
        const watched = await seen(page);
        expect(watched.most).toBe(1);
        expect(watched.shown).toHaveLength(2);
        assertNoErrors(errors, test.info());
      });
    });
  }
}

/** Back into the same lesson in the same tab: the course opens again where it was. */
async function reopen(page: Page): Promise<void> {
  await page.goto('/');
  await installAtomPoolBrain(page);
  await page.getByRole('link', { name: 'Learn', exact: true }).first().click();
  // A chapter in hand shows as a unit with its own Continue, exactly as tutor-proves-it reads it.
  await page
    .locator('.ln-unit')
    .filter({ hasText: CHAPTER_LINK })
    .getByRole('button', { name: /^continue$/i })
    .click();
  await throughTheDoor(page, { resumes: true });
  // The walk opens again on the scale, and the scale is played clean before the run comes back.
  const scale = page.locator('main.ls-stage').getByLabel('take this weight off').first();
  if (await scale.isVisible({ timeout: 5_000 }).catch(() => false)) await throughTheScale(page);
}

test.describe('not now', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('takes the suggestion away, keeps it away for the session, and changes nothing about where the course goes', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await open(page, 'light');
    await throughTheScale(page);
    await beatenTwice(page);

    const card = page.getByTestId('suggestion');
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    const named = AIM.get((await card.locator('h3').innerText()).trim());
    const id = await card.getAttribute('aria-label');
    await card.getByTestId('suggestion-decline').click();
    await expect(card).toHaveCount(0);
    await frame(page, 'declined-390-light');

    // THE SAME MOMENT, AGAIN, IN THE SAME SESSION. The tab reloads (sessionStorage stays), the
    // course opens again, and the same run beats them twice once more. The control test
    // below proves this moment does offer the card when nothing was declined.
    await reopen(page);
    await beatenTwice(page);
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId('suggestion')).toHaveCount(0);
    const after = await seen(page);
    expect(after.shown, `${id} came back after a no`).not.toContain(id);
    expect(after.most).toBeLessThanOrEqual(1);
    await frame(page, 'declined-stays-gone-390-light');

    // And the course still goes where it was going.
    await actionBarButton(page, 'continue').click();
    await expect.poll(() => onStage(page), { timeout: 10_000 }).toBe(named as string);
    assertNoErrors(errors, test.info());
  });

  test('the control: without a no, the same moment after a reload offers the same suggestion', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await open(page, 'light');
    await throughTheScale(page);
    await beatenTwice(page);
    const card = page.getByTestId('suggestion');
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    const id = await card.getAttribute('aria-label');

    await reopen(page);
    await beatenTwice(page);
    await expect(page.getByTestId('suggestion')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId('suggestion')).toHaveAttribute('aria-label', id as string);
    assertNoErrors(errors, test.info());
  });
});
