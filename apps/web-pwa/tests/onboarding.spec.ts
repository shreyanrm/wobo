/**
 * THE RUN, IN A REAL BROWSER.
 *
 * This suite's server is keyless, so there is no account layer and the door is bypassed by
 * configuration: the run opens on step two, exactly as local dev does. What is proved here is what
 * only a browser can prove about the four steps after the door:
 *
 *   · a reload lands where the learner was, and never past what they have answered,
 *   · back works on every step after the second, from the button and from the stepper's pips,
 *   · the stepper is a real control a keyboard can reach,
 *   · an empty submit on ANY step says one line and puts the caret in the field it is about,
 *   · the board is asked before the class, and the class arrives with the board,
 *   · each step has one quiet way past it, never two,
 *   · a name with an emoji in it is kept as given, and a board not in the list opens the
 *     own-syllabus door,
 *   · the keyboard reaches every control on step two in the order the page asks,
 *   · the run's pips are 44px boxes that do not overlap, the last step draws no bar it cannot read,
 *   · nothing scrolls sideways and nothing is parked at opacity 0, at three widths in both themes,
 *     and under reduced motion.
 *
 * The door itself (step one) is `auth-doors.spec.ts`, on the server that has keys.
 */

import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './helpers';
import { brainFor, installBrain, withChapters } from './helpers/brain';

const STEP_KEY = 'wobo-onb-step-v1';
const PROFILE_KEY = 'wobo-learner-profile';

const WIDTHS = [
  { name: '1440', w: 1440, h: 900 },
  { name: '834', w: 834, h: 1112 },
  { name: '390', w: 390, h: 844 },
];
const THEMES = ['light', 'dark'] as const;

test.describe.configure({ mode: 'serial' });

/**
 * Land mid-run: a saved step, and the answers a later step rests on. Seeded only where nothing is
 * saved yet: an init script runs on every navigation, and re-seeding on a reload would overwrite
 * the very thing the reload test is about.
 */
async function seedRun(page: Page, step: number, answered = step >= 3): Promise<void> {
  await page.addInitScript(
    ({ step, answered, stepKey, profileKey }) => {
      if (localStorage.getItem(stepKey) !== null) return;
      localStorage.setItem(stepKey, String(step));
      if (answered) {
        // The copy law (DESIGN.md §0): no invented learner, not even in a fixture.
        localStorage.setItem(
          profileKey,
          JSON.stringify({ name: 'Learner', grade: 'Class 8', boardId: 'cbse' }),
        );
      }
    },
    { step, answered, stepKey: STEP_KEY, profileKey: PROFILE_KEY },
  );
}

async function wear(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(60);
}

const HEADINGS: Record<number, RegExp> = {
  2: /Who's learning/,
  3: /Ask me anything/,
  4: /Link a parent/,
  5: /That's it/,
};

test('a reload lands where the learner was', async ({ page }, info) => {
  const errors = watchConsole(page);
  await seedRun(page, 4);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[4] as RegExp, {
    timeout: 45_000,
  });
  // and moving on is remembered without anybody asking
  await page.getByRole('button', { name: "I'll do this later" }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[5] as RegExp);
  expect(await page.evaluate((k) => localStorage.getItem(k), STEP_KEY)).toBe('5');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[5] as RegExp);
  expect(errors).toEqual([]);
  info.annotations.push({ type: 'proof', description: 'step 4 → 5 → reload → 5' });
});

test('never lands past what the learner has answered', async ({ page }) => {
  // a saved "4" with no profile behind it: back to the questions, not to a page about nothing
  await seedRun(page, 4, false);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[2] as RegExp);
});

test('back works on every step after the second, and the stepper is a control', async ({
  page,
}) => {
  await seedRun(page, 5);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[5] as RegExp);

  // the button
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[4] as RegExp);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[3] as RegExp);

  // the stepper: a navigation, the current beat marked, a finished beat a button with a destination
  const nav = page.getByRole('navigation', { name: /Setting up, step 3 of 5/ });
  await expect(nav).toBeVisible();
  await expect(nav.locator('[aria-current="step"]')).toHaveCount(1);
  const toTwo = nav.getByRole('button', { name: /Back to step 2/ });
  await expect(toTwo).toBeVisible();
  // the door is finished and is not a button: there is no walking back out through it
  await expect(nav.getByRole('button', { name: /Back to step 1/ })).toHaveCount(0);
  await toTwo.focus();
  await expect(toTwo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[2] as RegExp);
  // step two has nowhere to go back to
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  // and the answers are still there to be changed
  await expect(page.locator('#ob-name')).toHaveValue('Learner');
  await expect(page.locator('#ob-board')).toHaveValue('CBSE');
});

test('an empty invite says one line and puts the caret in the field', async ({ page }) => {
  await seedRun(page, 4);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Send the invite' }).click();
  const note = page.getByRole('alert');
  await expect(note).toBeVisible();
  await expect(note).toContainText("I need a parent's email or phone number");
  const field = page.locator('#parent-address');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', 'parent-address-note');
  // still on the step: nothing was sent, nothing moved
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[4] as RegExp);
});

test('the first name asked for is used from then on', async ({ page }) => {
  await seedRun(page, 3);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.locator('.ob-bar b')).toHaveText('Wobo · with Learner');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.locator('.ob-note')).toContainText('Learner asked for help twice');
  await page.getByRole('button', { name: "I'll do this later" }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText("That's it, Learner.");
});

/** The brain this run would talk to: one board with chapters, so the registry answers. */
async function withBrain(page: Page): Promise<void> {
  await installBrain(page, brainFor(withChapters('cbse')));
}

/**
 * AN EMPTY SUBMIT SAYS SOMETHING, ON EVERY STEP. Step two's "That's me" was `disabled={!ready2}`
 * with no rule to draw it disabled: full pig blue over three empty fields, and a tap did nothing.
 * It is live now, and says the first thing missing in the order the page asks.
 */
test('an empty "That\'s me" says one line and puts the caret in the first empty field', async ({
  page,
}) => {
  await seedRun(page, 2, false);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  const go = page.getByRole('button', { name: "That's me", exact: true });
  await expect(go).toBeEnabled();
  await go.click();
  const note = page.getByRole('alert');
  await expect(note).toBeVisible();
  await expect(note).toContainText('What should I call you?');
  const name = page.locator('#ob-name');
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-describedby', 'ob-refusal');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[2] as RegExp);

  // the next keystroke is the fix, and the line about the name goes with it
  await name.fill('Learner');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await name.getAttribute('aria-invalid')).toBeNull();
  await go.click();
  await expect(page.getByRole('alert')).toContainText('Which board are you with?');
  const board = page.locator('#ob-board');
  await expect(board).toBeFocused();
  await expect(board).toHaveAttribute('aria-invalid', 'true');
  await expect(board).toHaveAttribute('aria-describedby', 'ob-refusal');
});

/**
 * THE BOARD BEFORE THE CLASS. The classes are the board's own, so the class row was nine disabled
 * buttons until a board was chosen, drawn ABOVE the board field: a learner tapped "8", nothing
 * happened, and only the fine print said why. The fields are in the order they can be answered,
 * and the whole step is walked here with its taps counted: the number a new learner spends
 * between the door and a first drawn answer is a number the owner asked for.
 */
test('asks the board before the class, brings the classes with the board, and counts the taps', async ({
  page,
}, info) => {
  await seedRun(page, 2, false);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await withBrain(page);
  let taps = 0;
  const tap = async (target: ReturnType<Page['locator']>) => {
    taps += 1;
    await target.click();
  };

  // page order: name, board, class
  const order = await page.evaluate(() => {
    const y = (sel: string) =>
      (document.querySelector(sel) as HTMLElement).getBoundingClientRect().top;
    return { name: y('#ob-name'), board: y('#ob-board'), klass: y('fieldset.ob-field') };
  });
  expect(order.name).toBeLessThan(order.board);
  expect(order.board).toBeLessThan(order.klass);
  // before a board: the ladder is drawn, not pressable, and the fine print points UP at the board
  await expect(page.locator('.ob-chips button:not([disabled])')).toHaveCount(0);
  await expect(page.locator('.ob-fine')).toContainText('Pick your board above');

  await tap(page.locator('#ob-name'));
  await page.locator('#ob-name').fill('Learner');
  await tap(page.locator('#ob-board'));
  await page.locator('#ob-board').pressSequentially('cbse', { delay: 20 });
  const cbse = page.getByRole('button', { name: /Central Board of Secondary Education/ }).first();
  await expect(cbse).toBeVisible();
  await tap(cbse);
  await expect(page.locator('#ob-board')).toHaveValue(/Central Board/);
  // the board's own classes, pressable now
  const chips = page.locator('.ob-chips button:not([disabled])');
  await expect(chips.first()).toBeVisible();
  await expect(page.locator('.ob-fine')).toHaveCount(0);

  // a class still missing is said, and focus goes to the chips
  await tap(page.getByRole('button', { name: "That's me", exact: true }));
  await expect(page.getByRole('alert')).toContainText('Which class');
  expect(await page.evaluate(() => document.activeElement?.closest('.ob-chips') !== null)).toBe(
    true,
  );
  taps -= 1; // that tap was the proof, not the path
  const eight = chips.filter({ hasText: /^8$|Class 8/ }).first();
  await tap(eight);
  await expect(eight).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await tap(page.getByRole('button', { name: "That's me", exact: true }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[3] as RegExp);

  // the first drawn answer: one sample question
  await tap(page.getByRole('button', { name: 'Why is the sky blue?' }));
  // Wobo's own line on the canvas (the question is drawn in pig until the reply replaces it)
  await expect(page.locator('.ob-canvas .ob-hw:not(.ob-pig)')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ob-canvas .ob-hw:not(.ob-pig)')).not.toHaveText('');
  info.annotations.push({
    type: 'taps',
    description: `${taps} taps from step two to the first drawn answer`,
  });
  expect(taps).toBeLessThanOrEqual(6);
});

test('an empty Ask says one line and puts the caret in the field', async ({ page }) => {
  await seedRun(page, 3);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const note = page.getByRole('alert');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Type a question, or tap one of the three below.');
  const field = page.getByLabel('Ask Wobo');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', 'ob-ask-note');
  await field.fill('w');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

/**
 * ONE QUIET WAY PAST A STEP. Step three had "Skip for now" in the bar and "That was it. Keep going"
 * under an empty canvas, before anything had been asked; step four had "Not now" in the bar over a
 * form that said "I'll do this later". One each now, and step three's changes hands once a
 * question is asked.
 */
test('offers one quiet way past each step, never two', async ({ page }) => {
  await seedRun(page, 3);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Keep going/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Why is the sky blue?' }).click();
  await expect(page.getByRole('button', { name: /Keep going/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
  await page.getByRole('button', { name: /Keep going/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[4] as RegExp);
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: "I'll do this later" })).toHaveCount(1);
});

test('keeps a name with an emoji in it as given', async ({ page }) => {
  await seedRun(page, 2, false);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await withBrain(page);
  await page.locator('#ob-name').fill('Learner 🌸');
  await page.locator('#ob-board').pressSequentially('cbse', { delay: 20 });
  await page
    .getByRole('button', { name: /Central Board of Secondary Education/ })
    .first()
    .click();
  await page
    .locator('.ob-chips button:not([disabled])')
    .filter({ hasText: /^8$|Class 8/ })
    .first()
    .click();
  await page.getByRole('button', { name: "That's me", exact: true }).click();
  await expect(page.locator('.ob-bar b')).toHaveText('Wobo · with Learner');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: "I'll do this later" }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText("That's it, Learner.");
  expect(await page.evaluate((k) => localStorage.getItem(k), PROFILE_KEY)).toContain('Learner 🌸');
});

test('a board not in the list opens the own-syllabus door, and substitutes nothing', async ({
  page,
}) => {
  await seedRun(page, 2, false);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await withBrain(page);
  await page.locator('#ob-board').pressSequentially('a board nobody publishes', { delay: 5 });
  const door = page.getByRole('button', { name: /Paste your school's syllabus/ });
  await expect(door).toBeVisible();
  await expect(page.getByRole('button', { name: /Central Board/ })).toHaveCount(0);
  await door.click();
  await expect(page.getByPlaceholder('My school’s scheme of work')).toBeVisible();
});

test('the keyboard reaches every control on step two, in the order the page asks', async ({
  page,
}) => {
  await seedRun(page, 2, false);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  const seen: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return 'body';
      const hidden = el.closest('[aria-hidden="true"]') !== null;
      const disabled = (el as HTMLButtonElement).disabled === true;
      return `${el.id || el.textContent?.trim() || el.tagName}${hidden ? ' [hidden]' : ''}${disabled ? ' [disabled]' : ''}`;
    });
    seen.push(at);
    if (at === "That's me") break;
  }
  expect(seen).not.toContainEqual(expect.stringMatching(/\[hidden\]|\[disabled\]/));
  const at = (label: string) => seen.indexOf(label);
  expect(at('ob-name')).toBeGreaterThanOrEqual(0);
  expect(at('ob-board')).toBeGreaterThan(at('ob-name'));
  expect(at("That's me")).toBeGreaterThan(at('ob-board'));
});

test('the pips of the run are 44px boxes that do not overlap, at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRun(page, 5);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.au-steps li > *')).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    }),
  );
  expect(boxes).toHaveLength(5);
  for (const b of boxes) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  for (let i = 1; i < boxes.length; i += 1) {
    expect((boxes[i] as { left: number }).left).toBeGreaterThanOrEqual(
      (boxes[i - 1] as { right: number }).right - 0.5,
    );
  }
});

test('the last step draws no bar it cannot read, and never tells a learner to sign in', async ({
  page,
}) => {
  await seedRun(page, 5);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[5] as RegExp);
  // no gateway here, so nothing was read: no fraction, so no bar
  await expect(page.locator('.ob-allow .ob-bar')).toHaveCount(0);
  const line = page.locator('.ob-allow span');
  await expect(line).toHaveText(
    'This fills in as we go: how much of today is left, and when it comes back.',
  );
  await expect(line).not.toContainText(/sign in/i);
});

test('stands still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = watchConsole(page);
  await seedRun(page, 5);
  await page.goto('/onboarding', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[5] as RegExp);
  const faded = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('.ob-screen *')).filter(
        (el) => el.closest('svg') === null && Number(getComputedStyle(el).opacity) === 0,
      ).length,
  );
  expect(faded).toBe(0);
  expect(errors).toEqual([]);
});

for (const step of [2, 3, 4, 5]) {
  for (const size of WIDTHS) {
    for (const theme of THEMES) {
      test(`step ${step} stands still at ${size.name} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: size.w, height: size.h });
        const errors = watchConsole(page);
        await seedRun(page, step);
        await page.goto('/onboarding', { waitUntil: 'networkidle' });
        await wear(page, theme);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[step] as RegExp);

        const measured = await page.evaluate(() => {
          const d = document.documentElement;
          const faded = Array.from(document.querySelectorAll('.ob-screen *')).filter(
            (el) => el.closest('svg') === null && Number(getComputedStyle(el).opacity) === 0,
          ).length;
          const small = Array.from(document.querySelectorAll<HTMLElement>('button,a[href],input'))
            .filter((el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled)
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0 && r.height < 44).length;
          return { overflow: d.scrollWidth - d.clientWidth, faded, small };
        });
        expect(measured.overflow).toBeLessThanOrEqual(0);
        expect(measured.faded).toBe(0);
        if (size.w <= 640) expect(measured.small).toBe(0);
        expect(errors).toEqual([]);
      });
    }
  }
}
