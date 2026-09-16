/**
 * WHERE THEY WENT WRONG, ON A REAL SCREEN (docs/LEARNING-MODEL.md, "The tutor never leaves", the
 * owner 2026-09-15, rule 3: *"Every wrong answer gets the reason it is wrong, drawn where the
 * mistake is ... Never 'incorrect, try again'. Never a generic hint."* and rule 4: the ladder
 * *"never repeats the same line"*).
 *
 * `src/screens/course/where-they-went-wrong.test.ts` plays the learner through the real loop with
 * the model mocked. This walks a learner through the real BROWSER, on the phone and on the desktop,
 * in both themes, into the COMPOSED course's own workbook — the screen where most wrong answers in
 * this product are actually met — and reads what is on the glass after they miss all three.
 *
 * The defect it holds down: every missed item opened with one fixed sentence, so a learner who
 * missed all three read those same six words three times down one screen, each time with a
 * different tail hung off it. A different tail does not stop it being a form's sentence printed
 * three times, and at 390 all three are in view at once.
 *
 * NOTHING IS GENERATED AND NOTHING IS FETCHED. The lesson is seeded onto the device as a course
 * this learner has already opened (`screens/course/kept.ts`), which is the one path that opens a
 * composed course with no network at all, and every capability call is refused at the browser's
 * own edge. So this suite is free, deterministic, and never reaches a model.
 *
 * EVERY LAB IS MUTED (the owner, 2026-09-09). The browser comes from playwright.config.ts, which
 * launches with `--mute-audio`; this file adds no launch options of its own, so it cannot undo it,
 * and it mutes Wobo's own voice switch as well so the reading clock is the only thing gating.
 */

import { expect, type Page, test } from '@playwright/test';
import { assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { seedAtomWorld } from './helpers/brain';

/** The two widths the law contracts for, and the two themes each is read in (DESIGN.md §0). */
const WIDTHS = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;
const THEMES = ['light', 'dark'] as const;

const TOPIC = 'Algebra play';
const TOPIC_ID = 'topic-algebra-play';

/**
 * The lesson on the device, shaped exactly as `engine.compose` returns one and as
 * `screens/course/kept.ts` stores one. Three workbook items, each with the reason its answer is the
 * answer, because that is what a composed course carries now (`plexus/specs.py`'s `explanation`).
 */
const WORKBOOK = [
  {
    id: 'w1',
    type: 'mcq',
    prompt: 'Which move keeps the equation balanced?',
    options: [
      'Subtract 3 from both sides',
      'Subtract 3 from the left side only',
      'Divide the left side by 3',
    ],
    answer: 'Subtract 3 from both sides',
    explanation:
      'Taking 3 off one side on its own makes the two sides count different things, so the equals sign stops being true',
  },
  {
    id: 'w2',
    type: 'mcq',
    prompt: 'You have 2x = 10. What comes next?',
    options: ['Divide both sides by 2', 'Subtract 2 from both sides', 'Add 2 to both sides'],
    answer: 'Divide both sides by 2',
    explanation:
      'The 2 is multiplying the x rather than being added to it, so what undoes it is dividing, and it happens to both sides at once',
  },
  {
    id: 'w3',
    type: 'fill',
    prompt: 'Whatever you do to one side, you do to the ________.',
    answer: 'other',
    explanation:
      'That is the whole rule of a balance: move one pan and the other has to move with it or the scale tips',
  },
] as const;

const KEPT_COURSE = {
  courseId: '11111111-2222-4333-8444-555555555555',
  title: TOPIC,
  seeded: false,
  cards: [
    {
      id: 'c1',
      kind: 'text',
      title: 'Keeping it level',
      idea: 'An equation is a balance, and both pans hold the same amount.',
      interaction: { kind: 'tap', prompt: 'Tap the side you would change first.' },
      reveal: 'Whatever you do to one side, you do to the other.',
    },
  ],
  workbook: WORKBOOK,
  boss: [
    {
      id: 'b1',
      type: 'fill',
      prompt: 'Solve for x: x + 4 = 9. x = ________.',
      answer: '5',
      explanation: 'Taking 4 off both sides leaves x on its own and 5 on the other side',
    },
    {
      id: 'b2',
      type: 'mcq',
      prompt: 'Which of these is a legal move?',
      options: [
        'Multiply both sides by 3',
        'Multiply the left side by 3',
        'Delete the hardest term',
      ],
      answer: 'Multiply both sides by 3',
      explanation: 'A move is legal when it leaves the same values satisfying the equation',
    },
    {
      id: 'b3',
      type: 'fill',
      prompt: 'A legal move keeps the answer set exactly the ________.',
      answer: 'same',
      explanation: 'If the set of values changed, the thing you are solving is no longer the ask',
    },
  ],
};

/** The three openings `Composing.MISS_ANSWER_CLAUSES` gives the three positions down the screen. */
const OPENINGS = [
  'The one that holds is',
  'Here the answer lands on',
  'is where this one ends up',
] as const;

/** The sentence that used to open all three blocks. It may never be on a screen again. */
const THE_OLD_ONE = 'Not this one. The answer is';

/**
 * Put the lesson on the device before the app script runs, the way a course the learner has
 * already opened sits there. The e2e run has no account layer, so the per-learner scope is empty
 * and the key is the bare one (`store/scope.ts`, `brain.ts` says the same of the pinned world).
 */
async function seedKeptLesson(page: Page): Promise<void> {
  await page.addInitScript(
    (seed: { key: string; index: string; record: string }) => {
      localStorage.setItem(seed.key, seed.record);
      localStorage.setItem(seed.index, JSON.stringify([seed.key]));
      localStorage.setItem('wobo-voice-muted-v1', '1'); // every lab is muted, Wobo's voice included
    },
    {
      key: `wobo-lesson-v1:${TOPIC_ID}`,
      index: 'wobo-lesson-v1:index',
      record: JSON.stringify({ v: 1, at: Date.now(), course: KEPT_COURSE }),
    },
  );
}

/** The brain that publishes one chapter with one composed topic in it (no atom node: mode is composing). */
async function installBrain(page: Page): Promise<void> {
  const REPO = new URL('../../..', import.meta.url).pathname;
  await page.evaluate(
    async ({ sdkEntry, topicId, topicName }) => {
      const sdk = (await import(/* @vite-ignore */ sdkEntry)) as {
        createCurriculumClient: (url: string, opts: { post: unknown }) => unknown;
      };
      const app = (await import(/* @vite-ignore */ '/src/curriculum/client.ts')) as {
        setCurriculumClient: (client: unknown) => void;
      };
      const framework = {
        id: 'own:atom-journey',
        name: 'My own chapter list',
        kind: 'personal',
        status: 'personal',
        aliases: [],
        country: null,
        region: null,
        languages: ['en'],
        levels: ['Class 8'],
        official_site: null,
        personal: true,
      };
      const version = { id: 'own-v1', framework_id: framework.id, label: '1', status: 'personal' };
      const unit = {
        id: 'm2',
        kind: 'unit',
        name: 'Linear equations in one variable',
        parent_id: 'subject-node',
        order: 0,
        aliases: [],
        source_ref: null,
        concept_ids: [],
        own: true,
        not_in_my_school: false,
        textbook: null,
        renamed_from: null,
        source: null,
      };
      const topic = {
        ...unit,
        id: topicId,
        kind: 'topic',
        name: topicName,
        parent_id: unit.id,
        concept_ids: [],
        objectives: [],
      };
      const block = {
        framework,
        version,
        label: 'Drafted from your syllabus, check it',
        levels: framework.levels,
      };
      const post = async (capability: string, payload: Record<string, unknown>) => {
        switch (capability) {
          case 'curriculum.pin':
            return { ...block, pinned: true };
          case 'curriculum.framework':
            return { ...block, level: payload.level ?? 'Class 8', subjects: ['Mathematics'] };
          case 'curriculum.units':
            return {
              ...block,
              level: payload.level,
              subject: payload.subject,
              subject_id: 'subject-node',
              status: 'ready',
              units: [unit],
            };
          case 'curriculum.topics':
            return { ...block, unit, topics: [topic] };
          case 'curriculum.overlay.get':
            return { framework_id: framework.id, ops: [], last_report: [] };
          default:
            return {};
        }
      };
      app.setCurriculumClient(sdk.createCurriculumClient('', { post }));
    },
    {
      sdkEntry: `/@fs${REPO}packages/sdk/src/index.ts`,
      topicId: TOPIC_ID,
      topicName: TOPIC,
    },
  );
}

/** Nothing on a learning screen may scroll sideways (DESIGN.md §0, the three widths contract). */
async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** The tutor is still in the room: Wobo's head and voice sit around whatever card is on stage. */
async function tutorIsInTheRoom(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /Hold to talk to Wobo/ }).first()).toBeVisible();
  await expect(page.locator('.ls-say').first()).toBeVisible();
}

/**
 * Wobo's own drawer, dismissed the way a learner dismisses it.
 *
 * It is not in the way by accident and it is not a failure: it is the tutor arriving with a
 * different way into the idea once a miss has become a pattern (rule 1 and rule 5 of "The tutor
 * never leaves"). At 390 it is modal and covers the action bar until it is read and closed.
 */
async function readAndCloseTheDrawer(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Wobo' });
  if (!(await drawer.isVisible().catch(() => false))) return;
  await drawer
    .getByRole('button', { name: /^close$/i })
    .first()
    .click();
  await expect(drawer).toBeHidden({ timeout: 10_000 });
}

/** There is something to press. A screen with no live control is the dead end rule 5 forbids. */
async function somethingToDo(page: Page): Promise<void> {
  const live = page.locator('.ls-actions button:not([disabled]), .ls-say button:not([disabled])');
  await expect(live.first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Walk from the topic row to the workbook. The card beats in between are whatever the lesson
 * carries, so this presses the one control that moves a lesson on until the workbook is on stage
 * rather than naming each beat: what this file is measuring is the workbook, and a lesson that
 * grows a beat must not turn into a failure about a button.
 */
async function toTheWorkbook(page: Page): Promise<void> {
  const heading = page.getByText('Hold what you just built', { exact: true });
  for (let i = 0; i < 12; i += 1) {
    if (await heading.isVisible().catch(() => false)) return;
    const live = page.locator('.ls-actions button:not([disabled])').last();
    if (await live.isVisible().catch(() => false)) await live.click().catch(() => undefined);
    await page.waitForTimeout(900);
  }
  await expect(heading).toBeVisible({ timeout: 15_000 });
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width.name}, ${theme}`, () => {
      test.use({ viewport: width.viewport, colorScheme: theme });

      test('three misses on one screen read as three different things', async ({ page }, info) => {
        const errors = watchConsole(page);
        await seedOnboarded(page);
        await seedAtomWorld(page);
        await seedKeptLesson(page);
        // Nothing generated: every capability the lesson would ask for is refused at the edge, so
        // the film and the pictures fall to the floors the player already draws for them.
        await page.route('**/v1/capability/**', (r) => r.abort());
        await page.goto('/');
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await installBrain(page);

        await page.getByRole('link', { name: 'Learn', exact: true }).first().click();
        await page
          .getByRole('link', { name: /Linear equations in one variable/ })
          .first()
          .click();
        await page
          .getByRole('link', { name: new RegExp(`^${TOPIC}`) })
          .first()
          .click();
        // The lesson is already on the device, so the download gate lets them straight in rather
        // than enqueuing it and bouncing them home. What stands first is the course's own ink
        // screen, with this lesson's outline on it, and the learner presses the control that
        // starts it exactly as they would.
        await expect(page.getByText('Written and verified', { exact: true })).toBeVisible({
          timeout: 20_000,
        });
        await page
          .getByRole('button', { name: /^start the course$/i })
          .last()
          .click();
        // The card itself, addressed by its own sentence rather than its title: a card's title is
        // drawn lowercased (`GenCardView`) and the side column carries it too, so the idea is the
        // one line on this screen that is this card's and nothing else's.
        await expect(page.getByText(KEPT_COURSE.cards[0]?.idea ?? '', { exact: false })).toBeVisible(
          { timeout: 15_000 },
        );
        await toTheWorkbook(page);

        // THE THREE WRONG ANSWERS. Two choices they were never going to be right about, and a word
        // in the gap that is not the one.
        await page.getByRole('button', { name: 'Subtract 3 from the left side only' }).click();
        await page.getByRole('button', { name: 'Add 2 to both sides' }).click();
        await page.getByLabel(WORKBOOK[2].prompt).fill('left');
        await page.getByRole('button', { name: /^check$/i }).last().click();

        // RULE 3: every one of the three is told WHY, in that item's own words.
        for (const item of WORKBOOK) {
          await expect(page.getByText(item.explanation, { exact: false })).toBeVisible({
            timeout: 10_000,
          });
        }

        // RULE 4, and the defect this file exists for: the three blocks do not open alike. Each
        // opening is on the screen exactly once, and the sentence that used to open all three is
        // not on it at all.
        for (const opening of OPENINGS) {
          await expect(page.getByText(opening, { exact: false })).toHaveCount(1);
        }
        await expect(page.getByText(THE_OLD_ONE, { exact: false })).toHaveCount(0);

        // Never red, never a buzzer, never the word (docs/REWARDS.md §4).
        await expect(page.getByText(/\bwrong\b/i)).toHaveCount(0);
        await expect(page.getByText(/\bincorrect\b/i)).toHaveCount(0);

        // RULE 5: the tutor is still here, there is still something to press, and nothing on this
        // screen scrolls sideways at the width most learners are on.
        await tutorIsInTheRoom(page);
        await somethingToDo(page);
        await noSidewaysScroll(page);

        // THE SLOW ANSWER. They sit with it. Nothing times out and nothing nags.
        await page.waitForTimeout(3000);
        await tutorIsInTheRoom(page);
        await somethingToDo(page);

        // WOBO CAME WITHOUT BEING ASKED. Three misses on one concept is a pattern rather than a
        // slip, so the re-teach ladder (`wobo/reteach.ts`) changes approach on its own and the new
        // explanation lands in Wobo's drawer. At 390 that drawer is a modal sheet over the whole
        // screen, so the learner reads it and closes it before carrying on, which is what this
        // does. It is conditional because whether the drawer is still up at this instant depends
        // on the width, and the point being measured here is the workbook rather than the drawer.
        await readAndCloseTheDrawer(page);

        // THE RIGHT ANSWER AFTER THE WRONG ONE. They take one more look and fix two of them.
        await page.getByRole('button', { name: /^one more look$/i }).last().click();
        await page.getByRole('button', { name: 'Subtract 3 from both sides' }).click();
        await page.getByRole('button', { name: 'Divide both sides by 2' }).click();
        await page.getByRole('button', { name: /^check$/i }).last().click();

        // Two of three is a pass, earned, and the one still open is still taught rather than
        // dropped: its own reason is on the screen with the way on.
        await expect(page.getByText('That is a pass, earned', { exact: false })).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByText(WORKBOOK[2].explanation, { exact: false })).toBeVisible();
        await somethingToDo(page);
        await noSidewaysScroll(page);

        assertNoErrors(errors, info);
      });
    });
  }
}
