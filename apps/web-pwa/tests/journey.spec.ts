import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import {
  ATOM_ANSWERS,
  actionBarButton,
  assertNoErrors,
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
// 1 — Onboarding: the public front door, then the run's five steps, then the home.
//
//     THE RUN IS FIVE STEPS AND HAS BEEN SINCE WAVE 23 (`0dad66f`): the account door, who is
//     learning, a first question, a parent, ready. This test walked the run that came before it —
//     a warm tap, a written introduction, a name beat, a birthdate beat, a board beat, a class
//     beat, an interests beat and a theatre with a "Step in" button — and every one of those
//     controls has been gone for two waves. It walks today's run.
//
//     The suite runs with the Supabase vars blanked (playwright.config.ts), so there is no account
//     layer and step one is bypassed by config: the run opens on step two, exactly as local dev
//     does. The door itself is auth-doors.spec.ts, on the server that has keys, and each step's
//     craft is tests/onboarding.spec.ts. What is proved HERE is only the journey: that a visitor
//     who has never started can walk from the public page to the home without a deep link.
// ---------------------------------------------------------------------------------------------
test("onboarding walks Wobo's beats and opens the home", async ({ page }, info) => {
  const errors = watchConsole(page);
  // THE FRONT DOOR IS BEHIND THE DIAL (docs/DOORS-CLOSED.md §4, and auth-doors.spec.ts, which
  // seeds the same switch for the same reason). Since 2026-09-09 `doors_open` is false, so every
  // public surface says "Join the list" and points at /sign-up; the loud door to onboarding is not
  // deleted, it is switched off. This spec is about the journey a learner takes THROUGH the
  // product, so it seeds the dial open — `window.__WOBO_DOORS_OPEN__`, the very seed
  // `scripts/prerender.ts` writes into all 438 files — and walks the real door that comes back the
  // day the owner turns it on. The closed state is proved by join-list.spec.ts.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__WOBO_DOORS_OPEN__ = true;
  });
  await page.goto('/');

  // A visitor who has never started meets the landing page first — it is the unauthenticated front
  // door, and every one of its doors leads to onboarding. Walk the real path rather than deep-link.
  // The door is an `<a href="/onboarding">` (site/cta.ts: one phrase, one destination, one file),
  // so a visitor can copy it, open it in a tab and a crawler can follow it. Address it by role.
  await page
    .getByRole('link', { name: 'Start free', exact: true })
    .first()
    .click({ timeout: 15_000 });

  // STEP 2 — who is learning, and where. One card, three answers, one confirm.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Who's learning/, {
    timeout: 30_000,
  });
  await page.getByLabel('First name').fill('Learner');

  // The board is the registry's, not a bundled list: the learner types and picks what the brain
  // served (CURRICULUM.md §3), so this run supplies the brain it would talk to. Installed here,
  // after the navigation that threw the landing page's modules away.
  const seeded = syllabusFor('cbse', 'Class 9', 'Mathematics');
  await installBrain(page, brainFor(seeded));
  await page.getByLabel('Board').pressSequentially('centr', { delay: 30 });
  const cbse = page.getByRole('button', { name: /Central Board of Secondary Education/ }).first();
  await cbse.waitFor({ state: 'visible', timeout: 20_000 });
  await cbse.click();

  // THE BOARD BEFORE THE CLASS, and the class arrives WITH the board: until a board is chosen the
  // class row is the disabled ladder, so a chip that is pressable at all is the brain's answer.
  // The chip carries the number (`gradeOf`), not the level's full name.
  const grade = page.getByRole('group', { name: 'Class' }).getByRole('button', { name: '9' });
  await expect(grade).toBeEnabled({ timeout: 20_000 });
  await grade.click();
  await page.getByRole('button', { name: "That's me", exact: true }).click();

  // STEP 3 — a first question, in the learner's own class and board. The ask itself is proved by
  // tests/onboarding.spec.ts against a brain; the journey's business here is that the step has one
  // quiet way past it and that it works, which is the law each step is held to.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Ask me anything/, {
    timeout: 30_000,
  });
  await expect(page.getByRole('textbox', { name: 'Ask Wobo' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();

  // STEP 4 — a parent, offered and never required.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Link a parent/, {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: "I'll do this later", exact: true }).click();

  // STEP 5 — ready. The name the learner gave is said back to them, and the button is the action.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/That's it, Learner/, {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Begin', exact: true }).click();

  // HOME, AND THE RUN'S ANSWERS ARE ON IT. The app frame is the rail (ui/primitives/AppShell.tsx),
  // whose four doors are real `<a href>`s, and `AppHeader` stands down wherever the shell is
  // mounted — so the doors are addressed as the links they are, not as the buttons the old header
  // drew. The crumb and the greeting are the proof the journey actually carried something: the
  // name typed on step two and the board and class chosen there are what the home says back.
  const rail = page.getByRole('navigation', { name: 'Wobo' });
  await expect(rail.getByRole('link', { name: 'Learn' })).toBeVisible({ timeout: 15_000 });
  await expect(rail.getByRole('link', { name: 'Practice' })).toBeVisible();
  await expect(rail.getByRole('link', { name: 'You' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hey Learner');
  await expect(page.getByText(/Class 9 · Central Board of Secondary Education/)).toBeVisible();
  assertNoErrors(errors, info);
});

// ---------------------------------------------------------------------------------------------
// 2 — The home surfaces: the rail's wordmark and four doors, the learner's own crumb, the ways in.
//
//     THE APP FRAME IS THE RAIL NOW (ui/primitives/AppShell.tsx). This test looked for the old
//     fixed header — a wordmark, an xp chip, a "Did you know" button and two door BUTTONS — and
//     `AppHeader` returns null wherever the shell is mounted (`useShellMounted`), so none of it is
//     on the home any more. What the home actually offers a learner is the rail's four doors, the
//     crumb that says whose home it is, and the three cards that are the ways in.
// ---------------------------------------------------------------------------------------------
test("the home shows the rail's wordmark, its four doors, the learner's crumb and the ways in", async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await seedOnboarded(page);
  await page.goto('/');

  // the rail: the wordmark, then the four doors, as real links a learner can copy and open
  const rail = page.getByRole('navigation', { name: 'Wobo' });
  await expect(rail).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('complementary').getByRole('img', { name: 'Wobo' })).toBeVisible();
  for (const [door, path] of [
    ['Home', '/'],
    ['Learn', '/learn'],
    ['Practice', '/practice'],
    ['You', '/you'],
  ] as const) {
    await expect(rail.getByRole('link', { name: door })).toHaveAttribute('href', path);
  }

  // WHOSE HOME IT IS, said in the learner's own terms: the name they gave and the board and class
  // they chose. This is the identity line the old header's level chip used to stand for.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hey Learner');
  // the crumb is "<weekday> · <class> · <board>"; the weekday moves and the board's printed name
  // depends on whether a world is pinned, so the class — the answer this seed actually carries —
  // is what is held to.
  await expect(page.getByText(/· Class 8 ·/)).toBeVisible();

  // THE WAYS IN. Three cards — continue, practise, ask — and the ask box above them. The continue
  // card's button carries whatever the learner's next move actually is ("Choose your board" before
  // a world is pinned, the subject's own word after), so the cards are counted by their headings
  // and only the two fixed doors are named.
  await expect(page.getByRole('textbox', { name: 'Ask Wobo' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask', exact: true }).first()).toBeVisible();
  assertNoErrors(errors, info);
});

// ---------------------------------------------------------------------------------------------
// 3 — The whole atom journey: learn → subject → course (a wrong answer detonates, the rest are
//     solved) → boss → the greeting XP, then on to the twin, the invite award, and the palette.
//
//     THIS TEST IS RED AND IT IS RED HONESTLY (measured 2026-09-15, WOBO_E2E_PORT=5341). The shell
//     rebuild that replaced the fixed header with the rail (ui/primitives/AppShell.tsx) took three
//     shared helpers with it, and all three live in tests/helpers.ts, which this closer's brief
//     fences it out of. Named here so the next builder walks in with the map rather than the
//     symptom, and so nothing hides inside one agent's silence (docs/INK-FOUR.md, "the discipline"):
//
//       · `openAtomCourse` walks Learn → a "Mathematics — open the subject" BUTTON → a topic
//         button → a subtopic button. The Learn page has no subject step now and its rows are
//         LINKS. tests/palette-ink.spec.ts already walks the working route in its own `openAtom`:
//         Learn, then /Linear equations in one variable/, then /^Solving equations…/, all by link.
//         With that walk substituted the test reaches the practice deck, so this is the first
//         blocker and not the only one.
//       · `readXp` reads `header >> text=/\d+\s*xp/`. `AppHeader` returns null wherever the shell
//         is mounted (`useShellMounted`), so on the home and inside a course there is no header
//         and no xp chip to read. The XP assertions after the boss rest on it.
//       · `profileButton` matches "You — level N, profile and settings", which only `AppHeader`
//         ever rendered. The rail's "You" link is the way to that page now.
//
//     Past those, the practice deck itself has moved: with the Learn walk repaired the run stops on
//     the what-if sandbox and `currentEquation` finds no seeded equation on the card. Three spec
//     files share these helpers — this one, learning.spec.ts and wobo-capabilities.spec.ts — so the
//     repair belongs to one builder who owns all three at once.
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
