/**
 * THE TUTOR NEVER LEAVES, ON A REAL SCREEN (docs/LEARNING-MODEL.md, the owner 2026-09-15, rule 5:
 * *"No dead end: every screen after a wrong answer has the next thing to do, and the tutor stays
 * in the room (the orb, the voice) rather than handing over to a menu."*)
 *
 * `src/screens/course/tutor-never-leaves.test.ts` plays the learner through the real loop with the
 * model mocked. This walks the same learner through the real BROWSER, on the phone and on the
 * desktop, in both themes, and looks at what is actually on the glass after they get it wrong:
 *
 *   · a control they can press, every time, on every state a miss puts them in
 *   · Wobo still in the room: the head, the voice controls and the hold-to-talk
 *   · nothing scrolling sideways at 390, which is the width most of them are on
 *   · no console error, because a screen that threw is the worst dead end of all
 *
 * EVERY LAB IS MUTED (the owner, 2026-09-09). The browser comes from playwright.config.ts, which
 * launches with `--mute-audio`; this file adds no launch options of its own, so it cannot undo it.
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

/** The two widths the law contracts for, and the two themes each of them is read in (DESIGN.md §0). */
const WIDTHS = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;
const THEMES = ['light', 'dark'] as const;

/** Nothing on a learning screen may scroll sideways (DESIGN.md §0, the three widths contract). */
async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * The tutor is in the room: Wobo's head is on the lesson frame, the voice controls are on it, and
 * the hold-to-talk is reachable. A learner who has just missed is looking at a tutor, not a menu.
 */
async function tutorIsInTheRoom(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /Hold to talk to Wobo/ }).first()).toBeVisible();
  await expect(page.locator('.ls-say').first()).toBeVisible();
}

/** There is something to press. A screen with no live control is the dead end rule 5 forbids. */
async function somethingToDo(page: Page): Promise<void> {
  const live = page.locator('.ls-actions button:not([disabled]), .ls-say button:not([disabled])');
  await expect(live.first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Walk to the first practice item of the atom course, which is the first place a miss is possible.
 *
 * EVERY STEP IS THE LINK, never "either role, whichever comes first". The Learn screen carries the
 * subject as a pressed BUTTON whose name contains the chapter ("Mathematics Chapter 1 of 1 ·
 * Linear equations in one variable") and the chapter as a LINK to the subject's climb ("1 Linear
 * equations in one variable"). The button is earlier in the DOM, so a locator that accepts either
 * role lands on it, presses a toggle, never leaves the page, and then times out on a topic row
 * that was never drawn. `helpers.ts`'s own `openAtomCourse` has the matching problem from the
 * other direction, which is why `learning.spec.ts` keeps a link-based copy beside it.
 */
async function toFirstPracticeItem(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Learn', exact: true }).first().click();
  await page
    .getByRole('link', { name: /Linear equations in one variable/ })
    .first()
    .click();
  // the climb for the subject, which is where the topic rows live
  await expect(page).toHaveURL(/\/subject\//, { timeout: 15_000 });
  await page
    .getByRole('link', { name: /^Solving equations with the variable on one side/ })
    .first()
    .click();
  await actionBarButton(page, 'begin').click();

  const weight = page.getByLabel('take this weight off');
  for (let i = 0; i < 6; i += 1) await weight.first().click();
  const scaleContinue = actionBarButton(page, 'continue');
  await expect(scaleContinue).toBeEnabled({ timeout: 15_000 });
  await scaleContinue.click();

  const whatIf = page.getByText('Every number here is yours to drag', { exact: true });
  await expect(whatIf).toBeVisible({ timeout: 15_000 });
  await actionBarButton(page, 'continue').click();
  if (await whatIf.isVisible().catch(() => false)) {
    await page.waitForTimeout(600);
    if (await whatIf.isVisible().catch(() => false))
      await actionBarButton(page, 'continue').click();
  }
  await expect(whatIf).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText('Solve for x', { exact: true })).toBeVisible({ timeout: 10_000 });
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width.name}, ${theme}`, () => {
      test.use({ viewport: width.viewport, colorScheme: theme });

      test(`a learner who gets it wrong is never left with nothing to do`, async ({
        page,
      }, info) => {
        const errors = watchConsole(page);
        await seedOnboarded(page);
        await seedAtomWorld(page);
        await page.goto('/');
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await installAtomBrain(page, ATOM_TARGET_NODE_ID);
        await toFirstPracticeItem(page);

        // THE WRONG ANSWER. The answer is 5; they say 9.
        await page.keyboard.type('9');
        await actionBarButton(page, 'check').click();

        // The state a miss lands them in: the misconception is shown, and the honest move with it.
        await expect(page.getByText('The honest move')).toBeVisible({ timeout: 10_000 });
        // Never red, never a buzzer, never a cross, and never the word (REWARDS.md §4).
        await expect(page.getByText(/\bwrong\b/i)).toHaveCount(0);
        await expect(page.getByText(/\bincorrect\b/i)).toHaveCount(0);
        await tutorIsInTheRoom(page);
        await somethingToDo(page);
        await noSidewaysScroll(page);

        // THE SLOW ANSWER. They sit with it. Nothing times out, nothing nags, and the way on is
        // still there when they come back to it.
        await page.waitForTimeout(3000);
        await tutorIsInTheRoom(page);
        await somethingToDo(page);

        // The way on opens once the misconception has been shown, and it goes somewhere.
        const onward = actionBarButton(page, 'continue');
        await expect(onward).toBeEnabled({ timeout: 10_000 });
        await onward.click();
        await expect(page.getByText('Solve for x', { exact: true })).toBeVisible({
          timeout: 10_000,
        });
        await tutorIsInTheRoom(page);
        await somethingToDo(page);
        await noSidewaysScroll(page);

        // THE RIGHT ANSWER AFTER THE WRONG ONE. It is not grudging: the mark confirms.
        const eq = await page
          .locator('text=/^[0-9x +\\-−/()=]+$/')
          .first()
          .innerText()
          .catch(() => '');
        const answer = ATOM_ANSWERS[eq.trim()];
        if (answer) {
          await page.keyboard.type(answer);
          await actionBarButton(page, 'check').click();
          await expect(page.getByText('that holds.').first()).toBeVisible({ timeout: 10_000 });
          await tutorIsInTheRoom(page);
          await somethingToDo(page);
        }

        // THE CLOSED TAB AND THE RETURN. They leave mid-struggle and come back: their place is
        // there, the tutor is there, and there is something to do.
        await page.reload();
        await expect(page.locator('.ls-say').first()).toBeVisible({ timeout: 15_000 });
        await tutorIsInTheRoom(page);
        await somethingToDo(page);
        await noSidewaysScroll(page);

        assertNoErrors(errors, info);
      });
    });
  }
}
