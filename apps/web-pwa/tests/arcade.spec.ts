import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { assertNoErrors, seedOnboarded, watchConsole } from './helpers';

/**
 * THE ARCADE, IN THE BROWSER (docs/CONTENT-INTERACTION.md §7).
 *
 * Four things the owner asked to see proved, and each is one describe block below:
 *
 *   TWO CHAPTERS, TWO DIFFERENT GAMES   the same shell, two levels, and they do not look or read
 *                                       alike, because six mechanics is not one skin.
 *   THE DAILY CAP                       bonus XP stops at sixty a day and says so plainly, and the
 *                                       climb's own XP never moves at all.
 *   THE SIDE DOOR IS NOT IN THE PATH    the climb's path is one `<ol>` of topics; no bonus level
 *                                       is in it, at any width.
 *   IT WORKS AT 390                     every touchable is at least 44 css px, and the play field
 *                                       fits a phone without a sideways scroll.
 *
 * A LAB IS SILENT (docs/INK-FOUR.md): the suite's own launch options carry `--mute-audio`, and
 * nothing here plays or measures a sound.
 *
 * The frames land in `tests/shots/arcade/` as well as on the run's report, because the owner reads
 * the picture and a report that is cleaned between runs is not a proof he can look at.
 *
 * The two levels are seeded straight into the arcade's ledger, which is exactly what a side door
 * writes when a course carries one (`store/arcade.ts` `rememberDoor`). Nothing is generated for
 * this run and nothing is fetched: that IS the claim of §7, so proving it any other way would be
 * proving something else.
 */

const LEDGER_KEY = 'wobo-arcade-v1';

/** Chapter one's door: sort against the clock, on real numbers. */
const SORT_LEVEL = {
  id: 'bonus-3-sort',
  title: 'the sevens',
  game: 'sort',
  skill: 'speed',
  seconds: 45,
  rounds: [
    {
      id: 'r1',
      prompt: 'smallest first',
      order: ['42', '49', '56', '63'],
      why: 'seven sixes is smaller than seven nines, so it sits to the left of it.',
    },
  ],
};

/** Chapter two's door: match pairs, on real symbols. A different game, and it reads like one. */
const MATCH_LEVEL = {
  id: 'bonus-3-match',
  title: 'the symbols',
  game: 'match',
  skill: 'recall',
  seconds: 60,
  rounds: [
    {
      id: 'r1',
      prompt: 'pair each one with what it is',
      pairs: [
        { left: 'Na', right: 'sodium' },
        { left: 'K', right: 'potassium' },
        { left: 'Fe', right: 'iron' },
      ],
      why: 'the symbol comes from the latin name, which is why it is not the english one.',
    },
  ],
};

/** A one-round quiz, used to spend the day's cap four times over. */
const quickLevel = (n: number) => ({
  id: `bonus-quick-${n}`,
  title: `the sevens, run ${n}`,
  game: 'quiz',
  skill: 'recall',
  rounds: [{ id: 'r1', prompt: 'what is 7 x 6', answer: '42', options: ['42', '36', '48'] }],
});

type Door = { chapterId: string; topicId: string; levelId: string; title: string; spec: unknown };

async function seedDoors(page: Page, doors: Door[]): Promise<void> {
  await seedOnboarded(page);
  // An init script runs on EVERY navigation, so writing the ledger unconditionally would wipe the
  // day's count on each `goto` and the cap could never be reached. It seeds once and then leaves
  // the learner's own ledger alone, which is also how the real thing behaves.
  await page.addInitScript(
    (arg: { key: string; doors: Door[] }) => {
      if (localStorage.getItem(arg.key)) return;
      localStorage.setItem(
        arg.key,
        JSON.stringify({
          day: new Date().toISOString().slice(0, 10),
          earnedToday: 0,
          perChapter: {},
          cleared: [],
          total: 0,
          doors: arg.doors,
        }),
      );
    },
    { key: LEDGER_KEY, doors },
  );
}

const door = (chapter: string, topic: string, spec: { id: string; title: string }): Door => ({
  chapterId: chapter,
  topicId: topic,
  levelId: spec.id,
  title: spec.title,
  spec,
});

/** A frame, kept where a person can open it as well as attached to the run. */
async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true, path: `tests/shots/arcade/${name}.png` });
  await info.attach(name, { body, contentType: 'image/png' });
}

/** Play the level in front of us to the end, whatever mechanic it is. */
async function playThrough(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'start', exact: true }).click();
}

test.describe('two chapters, two different games', () => {
  test('a sort in one chapter and a match in another, on the same shell', async ({ page }, info) => {
    const errors = watchConsole(page);
    await seedDoors(page, [
      door('ch-tables', 'topic-tables-3', SORT_LEVEL),
      door('ch-symbols', 'topic-symbols-3', MATCH_LEVEL),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });

    // chapter one: sort against the clock
    await page.goto('/arcade/topic-tables-3');
    await expect(page.getByRole('heading', { name: 'the sevens', level: 2 })).toBeVisible();
    await expect(page.getByText('bonus level', { exact: true }).first()).toBeVisible();
    await playThrough(page);
    // the sort deals its chips shuffled, and every one of them is a real number off the course
    for (const chip of ['42', '49', '56', '63']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${chip},`) })).toBeVisible();
    }
    // it runs against a clock, which is what makes speed the skill
    await expect(page.getByText('time', { exact: true })).toBeVisible();
    await shot(page, info, 'arcade-sort-390');

    // chapter two: match pairs. A different board, different words, no clock chips at all.
    await page.goto('/arcade/topic-symbols-3');
    await expect(page.getByRole('heading', { name: 'the symbols', level: 2 })).toBeVisible();
    await playThrough(page);
    for (const tile of ['Na', 'sodium', 'Fe', 'iron']) {
      await expect(page.getByRole('button', { name: tile, exact: true })).toBeVisible();
    }
    // the sort's chips are nowhere on this one: two doors in two chapters are two games
    await expect(page.getByRole('button', { name: /^42,/ })).toHaveCount(0);
    await shot(page, info, 'arcade-match-390');

    assertNoErrors(errors, info);
  });

  test('and both of them work at 1440 as well as at 390', async ({ page }, info) => {
    const errors = watchConsole(page);
    await seedDoors(page, [door('ch-symbols', 'topic-symbols-3', MATCH_LEVEL)]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/arcade/topic-symbols-3');
    await playThrough(page);
    await expect(page.getByRole('button', { name: 'sodium', exact: true })).toBeVisible();
    // nothing runs off the side of the page at either width
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, info, 'arcade-match-1440');
    assertNoErrors(errors, info);
  });
});

test.describe('a finger can use it at 390', () => {
  test('every touchable on a play field is at least 44 css px', async ({ page }, info) => {
    const errors = watchConsole(page);
    await seedDoors(page, [door('ch-symbols', 'topic-symbols-3', MATCH_LEVEL)]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/arcade/topic-symbols-3');
    await playThrough(page);

    const small: string[] = [];
    for (const tile of ['Na', 'sodium', 'K', 'potassium', 'Fe', 'iron']) {
      const box = await page.getByRole('button', { name: tile, exact: true }).boundingBox();
      if (!box || box.height < 44 || box.width < 44) {
        small.push(`${tile}: ${box ? `${box.width}x${box.height}` : 'not drawn'}`);
      }
    }
    expect(small, `touchables under the 44px floor:\n${small.join('\n')}`).toEqual([]);
    assertNoErrors(errors, info);
  });
});

test.describe('the daily cap', () => {
  test('bonus xp stops at sixty a day, and says so plainly', async ({ page }, info) => {
    const errors = watchConsole(page);
    const runs = [1, 2, 3, 4, 5];
    await seedDoors(
      page,
      runs.map((n) => door(`ch-${n}`, `topic-${n}`, quickLevel(n))),
    );
    await page.setViewportSize({ width: 390, height: 844 });

    const paid: number[] = [];
    for (const n of runs) {
      await page.goto(`/arcade/topic-${n}`);
      await playThrough(page);
      await page.getByRole('button', { name: '42', exact: true }).click();
      await expect(page.getByText(/cleared, 1 of 1/)).toBeVisible();
      paid.push(
        await page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw ? (JSON.parse(raw).earnedToday as number) : -1;
        }, LEDGER_KEY),
      );
    }

    // four levels at fifteen is the day's sixty; the fifth pays nothing and is not a failure
    expect(paid).toEqual([15, 30, 45, 60, 60]);
    await expect(page.getByText('that is the arcade done for today. it comes back tomorrow.')).toBeVisible();
    await shot(page, info, 'arcade-daily-cap-390');

    // AND THE LOAD-BEARING HALF: none of it reached the XP that unlocks a level.
    const climbXp = await page.evaluate(() => {
      const raw = localStorage.getItem('wobo-progress-v1');
      return raw ? ((JSON.parse(raw).xp as number) ?? 0) : 0;
    });
    expect(climbXp).toBe(0);

    assertNoErrors(errors, info);
  });
});

test.describe('the side door is not in the path', () => {
  for (const width of [390, 1440]) {
    test(`no bonus level stands in the climb at ${width}`, async ({ page }, info) => {
      const errors = watchConsole(page);
      await seedDoors(page, [door('ch-tables', 'topic-tables-3', SORT_LEVEL)]);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/learn');
      await page.waitForLoadState('networkidle');

      // The path is literally one ordered list. Whatever it holds, it holds no game: a bonus level
      // is a side door and a learner walking the climb never has to walk through one.
      const inPath = await page.evaluate(() =>
        [...document.querySelectorAll('ol.cl-path a, ol.cl-path button')].map(
          (el) => el.getAttribute('href') ?? '',
        ),
      );
      expect(inPath.filter((href) => href.includes('/arcade/'))).toEqual([]);

      // and nothing anywhere on the climb navigates into one
      expect(await page.locator('a[href^="/arcade/"]').count()).toBe(0);
      assertNoErrors(errors, info);
    });
  }
});
