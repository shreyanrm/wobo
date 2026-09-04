import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import {
  ATOM_ANSWERS,
  actionBarButton,
  assertNoErrors,
  MET_KEY,
  openAtomCourse,
  profileButton,
  readXp,
  seedOnboarded,
  watchConsole,
} from './helpers';
import {
  brainFor,
  installAtomBrain,
  installBrain,
  seedAtomWorld,
  syllabusFor,
} from './helpers/brain';

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
    await page.waitForTimeout(150); // card is mid-transition — let the deck settle
  }
  throw new Error('no known equation visible on the current card');
}

// ---------------------------------------------------------------------------------------------
// 1 — Onboarding: one warm tap, Wobo's introduction, then the beats Wobo asks one at a time, and the
//     world-building theatre hands the learner to the home.
//
//     The suite runs with the Supabase vars blanked (playwright.config.ts), so there is no account
//     layer and the mandatory sign-in beat is bypassed by config — exactly the local-dev path.
// ---------------------------------------------------------------------------------------------
test("onboarding walks Wobo's beats and opens the home", async ({ page }, info) => {
  const errors = watchConsole(page);
  await page.goto('/');

  // A visitor who has never started meets the landing page first — it is the unauthenticated front
  // door, and every one of its doors leads to onboarding. Walk the real path rather than deep-link.
  await page
    .getByRole('button', { name: 'Start learning for free', exact: true })
    .first()
    .click({ timeout: 15_000 });

  // the door: Wobo's body and the explicit button both begin, so the button is addressed exactly
  await page.getByRole('button', { name: 'begin', exact: true }).click({ timeout: 15_000 });

  // Wobo's first-meeting introduction is WRITTEN letter by letter; the whole line reaches assistive
  // tech at once through an off-screen copy, so the text lands before the pen finishes.
  await expect(page.getByText("I'm Wobo, your AI wobot").first()).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), MET_KEY)).toBe('1');

  // the name — Wobo's input only appears once Wobo has finished asking, so wait for it, not a timer
  const nameField = page.getByLabel('your name');
  await nameField.waitFor({ state: 'visible', timeout: 20_000 });
  await nameField.fill('Learner');
  await page.getByRole('button', { name: 'continue' }).click();

  // when they landed on this planet — age is derived from it, never asked
  const birthdate = page.getByLabel('your date of birth');
  await birthdate.waitFor({ state: 'visible', timeout: 20_000 });
  await birthdate.fill('2012-04-08');
  await page.getByRole('button', { name: 'continue' }).click();

  // board, then class — each its own beat, each with its own confirm. The board beat is the
  // registry: the learner types and picks what the brain served (CURRICULUM.md §3), so this run
  // supplies the brain it would talk to. There is no bundled board list to fall back on any more.
  const seeded = syllabusFor('cbse', 'Class 9', 'Mathematics');
  await installBrain(page, brainFor(seeded));
  const boardSearch = page.getByRole('textbox', { name: /board/i });
  await boardSearch.waitFor({ state: 'visible', timeout: 20_000 });
  await boardSearch.pressSequentially('centr', { delay: 30 });
  const cbse = page.getByRole('button', { name: /Central Board of Secondary Education/ }).first();
  await cbse.waitFor({ state: 'visible', timeout: 20_000 });
  await cbse.click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  const grade = page.getByRole('button', { name: seeded.level, exact: true });
  await grade.waitFor({ state: 'visible', timeout: 20_000 });
  await grade.click();
  await page.getByRole('button', { name: "That's me", exact: true }).click();

  // what they're into — Wobo grounds their analogies in it from lesson one
  const cricket = page.getByRole('button', { name: 'cricket', exact: true });
  await cricket.waitFor({ state: 'visible', timeout: 20_000 });
  await cricket.click();
  await page.getByRole('button', { name: /^(That’s me|A bit of everything)$/ }).click();

  // the building theatre draws their world, then they step into it
  const stepIn = page.getByRole('button', { name: 'Step in', exact: true });
  await stepIn.waitFor({ state: 'visible', timeout: 30_000 });
  await stepIn.click();

  // home — the doors are live, the identity cluster is present
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toBeVisible();
  await expect(profileButton(page)).toBeVisible();
  assertNoErrors(errors, info);
});

// ---------------------------------------------------------------------------------------------
// 2 — The home surfaces: wordmark, identity cluster, did-you-know, the two aurora doors.
// ---------------------------------------------------------------------------------------------
test('the home shows the wordmark, identity cluster, did-you-know, and both doors', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await page.goto('/');

  // the app header is the LAST header in the DOM (a course chrome bar can precede it)
  const header = page.locator('header').last();
  await expect(header).toBeVisible();
  await expect(header.getByRole('img', { name: 'Wobo' })).toBeVisible();
  // identity cluster: streak flame + xp chip + the avatar carrying its level
  await expect(header.getByText(/\d+\s*xp/)).toBeVisible();
  await expect(profileButton(page)).toBeVisible();

  // did-you-know opens today's fact — which one depends on the date, so any of them counts
  await page.getByRole('button', { name: 'Did you know' }).click();
  await expect(
    page.getByText(
      /white tiger|Venus|Honey|Lightning|Octopuses|underwater|Sharks|Bananas|Eiffel|freeze faster|chess games|neutron star|bones|light bulb/i,
    ),
  ).toBeVisible();

  // the two doors
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toBeVisible();
  assertNoErrors(errors, info);
});

// ---------------------------------------------------------------------------------------------
// 3 — The whole atom journey: learn → subject → course (a wrong answer detonates, the rest are
//     solved) → boss → the greeting XP, then on to the twin, the invite award, and the palette.
// ---------------------------------------------------------------------------------------------
test('the atom journey: course, detonation, boss, greeting, twin, invite, palette', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  // The atom is reached the way §6 says a topic no board publishes for you is reached: through the
  // learner's own syllabus. The world is pinned before boot, the brain that answers for it is
  // installed after, because a navigation throws the page's modules away.
  await seedAtomWorld(page);
  await page.goto('/');
  await installAtomBrain(page, ATOM_TARGET_NODE_ID);

  await openAtomCourse(page);

  // arrival card → begin
  await actionBarButton(page, 'begin').click();

  // guided discovery: take three weights off each pan so the scale ends level (x = 5)
  const weight = page.getByLabel('take this weight off');
  for (let i = 0; i < 6; i += 1) {
    await weight.first().click();
  }
  const scaleContinue = actionBarButton(page, 'continue');
  await expect(scaleContinue).toBeEnabled({ timeout: 15_000 });
  await scaleContinue.click();

  // what-if sandbox → continue
  await expect(page.getByText('Every number here is yours to drag')).toBeVisible({
    timeout: 15_000,
  });
  await actionBarButton(page, 'continue').click();

  // practice — the FIRST item is answered wrong on purpose: the misconception detonates
  await expect(page.getByText('Solve for x')).toBeVisible({ timeout: 15_000 });
  const eqWrong = await currentEquation(page); // x + 7 = 12
  expect(eqWrong).toBe('x + 7 = 12');
  await page.keyboard.type('9'); // wrong — answer is 5
  await actionBarButton(page, 'check').click();
  await expect(page.getByText('The honest move')).toBeVisible({ timeout: 8_000 });
  const detonateContinue = actionBarButton(page, 'continue');
  await expect(detonateContinue).toBeEnabled({ timeout: 8_000 });
  await detonateContinue.click();

  // the remaining three items (two fresh + the re-queued miss) are all solved correctly
  for (let i = 0; i < 3; i += 1) {
    await expect(page.getByText('Solve for x')).toBeVisible({ timeout: 10_000 });
    const eq = await currentEquation(page);
    const answer = ATOM_ANSWERS[eq];
    expect(answer, `no seed answer for "${eq}"`).toBeTruthy();
    await page.keyboard.type(answer as string);
    await actionBarButton(page, 'check').click();
    await expect(page.getByText('that holds.')).toBeVisible({ timeout: 8_000 });
    await actionBarButton(page, 'continue').click();
  }

  // the boss door → step in
  await expect(page.getByText('the boss', { exact: true })).toBeVisible({ timeout: 10_000 });
  await actionBarButton(page, 'step in').click();

  // the boss workbook: solve, choose the missing step, tap the wrong line
  const bossEq = await currentEquation(page); // 5x - 2 = 13
  await page.getByLabel('your answer for x').fill(ATOM_ANSWERS[bossEq] as string); // 3
  await page.getByRole('button', { name: 'multiply both sides by 2' }).click();
  await page.getByRole('button', { name: '2x = 16', exact: true }).click();
  await actionBarButton(page, 'check all three').click();

  // pass → continue into the greeting; the topic completes and XP blooms (+150)
  await actionBarButton(page, 'continue').click();
  await expect(page.getByText('The greeting')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/is yours now — not memorised, understood/i)).toBeVisible();
  await expect.poll(() => readXp(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(150);

  // greeting → whatever Wobo has queued behind it (a level crossing, the mystery tease)
  await actionBarButton(page, 'continue').click();

  // the command palette reaches the twin
  await page.keyboard.press('Control+k');
  const palette = page.getByPlaceholder('Where to, or what…');
  await expect(palette).toBeVisible();
  await palette.fill('progress');
  await page.keyboard.press('Enter');

  // the knowledge twin — the constellation and the identity line
  await expect(page.getByText(/of \d+ concepts are yours/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder(/Ask your twin/i)).toBeVisible();

  // → you, where an invite awards exactly once
  await profileButton(page).click();
  await expect(page.getByText('Learning is better shared')).toBeVisible({ timeout: 10_000 });
  const beforeInvite = await readXp(page);
  // the friend card is the first invite in the DOM
  const friendCopy = page.getByRole('button', { name: 'Copy link' }).first();
  await friendCopy.click();
  await expect.poll(() => readXp(page), { timeout: 8_000 }).toBe(beforeInvite + 40);
  // a second copy must NOT award again (once-key guards it)
  await friendCopy.click();
  await page.waitForTimeout(800);
  expect(await readXp(page)).toBe(beforeInvite + 40);

  // the palette also gets us home — the round trip closes clean
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder('Where to, or what…')).toBeVisible();
  await page.getByPlaceholder('Where to, or what…').fill('home');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible({
    timeout: 10_000,
  });

  assertNoErrors(errors, info);
});
