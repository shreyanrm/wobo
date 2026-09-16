/**
 * THE TUTOR PROVES IT BEFORE IT SAYS IT, PLAYED THROUGH THE REAL SCREEN (docs/LEARNING-MODEL.md,
 * "The tutor never leaves", the owner 2026-09-15).
 *
 * Three adversary findings against wave 55, each played here as a learner would meet it.
 *
 *   ENDED TOO EARLY   a child who got 8 of 12 wrong and only copied back equations the course had
 *                     just solved for them was told the topic "is yours now"; a child who got the
 *                     first two right was finished after two answers; the boss on unseen items
 *                     came after the topic was closed and decided nothing.
 *   WAITED ON A READ  the course held a blank page until the pool request answered (66 s when it
 *                     stalled), and a refused pool request turned re-choosing off for the session.
 *   TWO ANSWERS       the course and the Learn board read the band under two different keys, a
 *                     completed topic that slipped was replayed as the fixed journey, and a second
 *                     miss on a walk also sent a re-teach ask to the model.
 *
 * THE BRAIN is `helpers/walk.ts`: the atom world, and the real fixture pool with its topic renamed
 * to the atom's. Nothing reaches a network. EVERY LAB IS MUTED: the browser comes from the config,
 * which launches with `--mute-audio`, and this file adds no launch options.
 */

import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { seedAtomWorld } from './helpers/brain';
import {
  aLessonCard,
  asked,
  bandOnRecord,
  CHAPTER_LINK,
  chapterRowOnTheBoard,
  completedOnRecord,
  drawerOpenings,
  installAtomPoolBrain,
  openTheAtom,
  openTheChapter,
  openTheTopic,
  type PoolAnswer,
  play,
  say,
  TOPIC_LINK,
  theDoor,
  throughTheDoor,
} from './helpers/walk';

async function arrive(page: Page, pool: PoolAnswer = { kind: 'serve' }): Promise<void> {
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto('/');
  await installAtomPoolBrain(page, pool);
}

const onStage = (page: Page) =>
  page
    .locator('main.ls-stage [data-module]')
    .first()
    .getAttribute('data-module', { timeout: 3_000 })
    .catch(() => null);

test.describe('a topic ends at evidence, and the boss is that evidence', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a child who only copies back what the course just solved is never told it is theirs', async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const errors = watchConsole(page);
    await arrive(page);
    await openTheAtom(page);

    // THE PARROT: the right number only for an equation the stage has just shown solved.
    const run = await play(page, { practice: (_n, _eq, seen) => seen, boss: 'wrong' }, 20);
    const sequence = run.handed.map(say);
    info.attach('handed', { body: sequence.join('\n'), contentType: 'text/plain' });
    console.log(`PARROT HANDED: ${sequence.join(' | ')}`);

    expect(run.ended, `told it was theirs: ${sequence.join(' | ')}`).toBe(false);
    expect(await completedOnRecord(page)).not.toContain('m2-1');
    expect(['secure', 'independent']).not.toContain(await bandOnRecord(page));
    // Never a dead end: the budget was spent on things handed, and there is still a next thing.
    expect(run.handed.length).toBeGreaterThanOrEqual(15);
    await expect(page.locator('.ls-actions button').first()).toBeVisible();
    assertNoErrors(errors, info);
  });

  test('two right answers are not the end, and the topic closes only when the boss is passed', async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await arrive(page);
    await openTheAtom(page);

    const run = await play(page, { practice: () => true, boss: 'right' }, 14);
    const sequence = run.handed.map(say);
    info.attach('handed', { body: sequence.join('\n'), contentType: 'text/plain' });
    console.log(`TWO RIGHT HANDED: ${sequence.join(' | ')}`);

    expect(run.ended, sequence.join(' | ')).toBe(true);
    // one answer is one piece of evidence: two right is not three
    expect(run.answered, sequence.join(' | ')).toBeGreaterThanOrEqual(3);
    // the greeting follows a passed boss, and nothing closed the topic before it
    const greeting = sequence.indexOf('-:greeting');
    const passed = sequence.findIndex((s) => /^-:boss:[23]\/3$/.test(s));
    expect(passed, sequence.join(' | ')).toBeGreaterThanOrEqual(0);
    expect(passed).toBeLessThan(greeting);
    expect(await completedOnRecord(page)).toContain('m2-1');
    expect(['secure', 'independent']).toContain(await bandOnRecord(page));
    assertNoErrors(errors, info);
  });

  test('a boss the learner fails closes nothing, says nothing on the board, and the walk goes on', async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await arrive(page);
    await openTheAtom(page);

    const run = await play(
      page,
      { practice: () => true, boss: 'wrong', bossRounds: 1, throughGreeting: true },
      16,
    );
    const sequence = run.handed.map(say);
    info.attach('handed', { body: sequence.join('\n'), contentType: 'text/plain' });
    console.log(`FAILED BOSS HANDED: ${sequence.join(' | ')}`);

    expect(run.bossRounds, sequence.join(' | ')).toBe(1);
    expect(sequence, 'greeted before the boss had decided').not.toContain('-:greeting');
    expect(await completedOnRecord(page)).not.toContain('m2-1');
    // what follows a failed boss is a module of the learner's group, never the same boss again
    const after = run.handed.at(-1);
    expect(after?.what, sequence.join(' | ')).toBe('after-boss');
    expect(after?.module).not.toBe('-');
    // and the board does not call the chapter mastered
    expect(await chapterRowOnTheBoard(page)).not.toContain('Mastered');
    assertNoErrors(errors, info);
  });
});

test.describe('the lesson never waits on the pool, and a refused pool is asked again', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a pool request that never answers does not hold the lesson', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await arrive(page, { kind: 'stall' });
    await openTheChapter(page);
    const tapped = Date.now();
    await page.getByRole('link', { name: TOPIC_LINK }).first().click();
    await expect(theDoor(page)).toBeVisible({ timeout: 8_000 });
    console.log(`STALLED POOL: the door after ${Date.now() - tapped} ms`);
    expect(await asked(page)).toContain('curriculum.blueprint');
    assertNoErrors(errors, info);
  });

  test('a pool that answers late joins the walk at the next module boundary', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await arrive(page, { kind: 'late', ms: 6_000 });
    await openTheChapter(page);
    const tapped = Date.now();
    await openTheTopic(page, { doorWithin: 4_000 });
    console.log(`LATE POOL: in after ${Date.now() - tapped} ms`);
    const run = await play(page, { practice: () => false }, 4);
    const sequence = run.handed.map(say);
    info.attach('handed', { body: sequence.join('\n'), contentType: 'text/plain' });
    console.log(`LATE POOL HANDED: ${sequence.join(' | ')}`);
    // the first module was the fixed journey's; once the pool is in, the course chooses
    const named = run.handed.filter((h) => h.module !== '-');
    expect(named.length, sequence.join(' | ')).toBeGreaterThan(0);
    assertNoErrors(errors, info);
  });

  test('a pool request refused once is asked again when the learner comes back', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await arrive(page, { kind: 'refuse-once' });
    await openTheAtom(page);
    await expect(
      actionBarButton(page, 'continue').or(page.getByLabel('take this weight off').first()).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    // leave the topic, and come back to it, in the same session
    await page.goBack();
    await expect(page).toHaveURL(/\/subject\//, { timeout: 15_000 });
    await openTheTopic(page, { resumes: true });
    await expect(aLessonCard(page)).toBeVisible({ timeout: 15_000 });
    const pools = (await asked(page)).filter((c) => c === 'curriculum.blueprint');
    const module = await onStage(page);
    console.log(
      `REFUSED ONCE: pool asked ${pools.length}x, module on stage after coming back: ${module}`,
    );
    expect(pools.length).toBe(2);
    expect(module, 'the walk did not start once the pool was served').not.toBeNull();
    assertNoErrors(errors, info);
  });
});

test.describe('one record decides finished, and one tally decides stuck', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a second miss on a walk changes the module and asks the model nothing', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await arrive(page);
    await openTheAtom(page);
    const run = await play(page, { practice: (n) => n >= 2 }, 6);
    const sequence = run.handed.map(say);
    const opened = await drawerOpenings(page);
    console.log(
      `ONE STUCK HANDED: ${sequence.join(' | ')} / drawer opened for: ${opened.join(',')}`,
    );
    expect(run.handed.filter((h) => h.right === false).length).toBeGreaterThanOrEqual(2);
    expect(opened, 'the drawer was opened to re-teach, which is a model call').not.toContain(
      'reteach',
    );
    assertNoErrors(errors, info);
  });

  test('a finished topic that slipped says so on the board and is walked again, not replayed', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await page.addInitScript((node) => {
      // Completed once, and the recent answers since then do not hold up.
      localStorage.setItem('wobo-progress-v1', JSON.stringify({ completedTopics: ['m2-1'] }));
      const at = (i: number) => new Date(Date.UTC(2026, 8, 1, 10, i)).toISOString();
      const evidence = [true, true, true, false, false, false, false, false].map((correct, i) => ({
        event_id: `00000000-0000-7000-8000-0000000009${String(i).padStart(2, '0')}`,
        correct,
        independence: 0.95,
        at: at(i),
      }));
      localStorage.setItem(
        'wobo-mastery-v1',
        JSON.stringify({ nodes: { [node]: { band: 'developing', evidence } } }),
      );
    }, ATOM_TARGET_NODE_ID);
    await arrive(page);

    // The board judges a chapter once its topics are known, so the chapter is opened first.
    await openTheChapter(page);
    await expect(page.getByRole('link', { name: TOPIC_LINK }).first()).toBeVisible();
    const row = await chapterRowOnTheBoard(page);
    console.log(`SLIPPED ROW: ${row} / band ${await bandOnRecord(page)}`);
    expect(row).not.toContain('Mastered');
    // the chapter is owed again: back in hand, or waiting to be come back to
    expect(row).toMatch(/Lesson 1 of 1|slipped back/);

    // the chapter is in hand again, and its Continue opens the topic that slipped
    await page
      .locator('.ln-unit')
      .filter({ hasText: CHAPTER_LINK })
      .getByRole('button', { name: /^continue$/i })
      .click();
    await throughTheDoor(page, { resumes: true });
    await expect(aLessonCard(page)).toBeVisible({ timeout: 15_000 });
    const module = await onStage(page);
    console.log(`SLIPPED REOPENED ON: ${module}`);
    expect(module, 'a slipped topic was replayed as the fixed journey').not.toBeNull();
    assertNoErrors(errors, info);
  });
});
