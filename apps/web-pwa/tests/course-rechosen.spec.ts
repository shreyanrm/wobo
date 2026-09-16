/**
 * THE COURSE RE-CHOOSES, PLAYED THROUGH THE REAL SCREEN (docs/LEARNING-MODEL.md, "The tutor never
 * leaves", the owner 2026-09-15).
 *
 *   Rule 1  after every module the group is re-chosen from what just happened. A module that beat
 *           the learner twice is followed by a DIFFERENT one, never the same one, never a harder one.
 *   Rule 2  the topic ends at its own evidence, never at a count.
 *   Rule 5  there is always a next thing.
 *
 * WHAT WAS MEASURED BEFORE THIS FILE (2026-09-16). The course fetched the chapter's pool and gave it
 * only to the placement check. No production code set `stuckOn`, `groupInPool` had no caller, and
 * the course's misses were tallied under the topic's node and cleared by any right answer. A learner
 * the practice run had just beaten twice was handed the next practice item anyway, and a learner who
 * missed everything was handed A, B, C, A, B, C with no end.
 *
 * THE BRAIN. The learner's world and the atom topic are the ones every atom spec uses. The chapter
 * pool is the real `suggest/fixture.ts` pool, with its topic `t4` renamed to this topic's id
 * (`m2-1`), which is exactly how the measuring run served it. Nothing reaches a network. The
 * brain and the played learner live in `helpers/walk.ts`, shared with `tutor-proves-it.spec.ts`.
 *
 * EVERY LAB IS MUTED. The browser comes from playwright.config.ts, which launches with
 * `--mute-audio`, and this file adds no launch options that could undo it.
 */

import { expect, test } from '@playwright/test';
import { pool } from '../src/suggest/fixture';
import { assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { seedAtomWorld } from './helpers/brain';
import {
  asked,
  bandOnRecord,
  type Handed,
  installAtomPoolBrain,
  openTheAtom,
  play,
  say,
  sittings,
} from './helpers/walk';

test.describe('the course re-chooses after every module', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a practice run that beats a learner twice is followed by a different module, and the topic ends at the band', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await seedOnboarded(page);
    await seedAtomWorld(page);
    await page.goto('/');
    await installAtomPoolBrain(page);
    await openTheAtom(page);

    // The learner misses the first two things they answer and gets everything after that,
    // the boss included.
    const { handed, ended } = await play(page, { practice: (nth) => nth >= 2, boss: 'right' }, 16);
    const sequence = handed.map(say);
    info.attach('handed', { body: sequence.join('\n'), contentType: 'text/plain' });
    console.log(`HANDED: ${sequence.join(' | ')}`);

    // The pool reached the screen and was read once.
    expect((await asked(page)).filter((c) => c === 'curriculum.blueprint')).toHaveLength(1);

    // RULE 1. The practice sitting that beat them twice ENDED there, and what came next was not a
    // practice item at all: a different module, and not the one that beat them.
    const first = handed.findIndex((h) => h.right === false);
    const second = handed.findIndex((h, i) => i > first && h.right === false);
    expect(second, 'the learner was never beaten twice').toBeGreaterThan(first);
    const after = handed[second + 1];
    expect(after, 'nothing was handed after the second miss').toBeDefined();
    expect(after?.right, `after two misses the course handed ${say(after as Handed)}`).toBe(
      undefined,
    );
    expect(after?.module).not.toBe(handed[second]?.module);
    // and every module named on the screen came out of the pool
    const ids = new Set((pool().modules as { id: string }[]).map((m) => m.id));
    for (const h of handed) if (h.module !== '-') expect(ids.has(h.module)).toBe(true);
    // never harder: a way in, never the stretch, the boss or a side door
    expect(['p9', 'p10', 'r2']).toContain(after?.module);

    // No practice sitting ever went past the second miss.
    for (const run of sittings(handed)) {
      expect(run.filter((h) => h.right === false).length).toBeLessThanOrEqual(2);
      const beaten = run.findIndex(
        (h, i) => h.right === false && run.slice(0, i).some((x) => !x.right),
      );
      if (beaten !== -1) expect(beaten).toBe(run.length - 1);
    }

    // RULE 2. The topic ended, at the boss, and the durable band says so too.
    expect(ended, `the walk never reached the topic's end: ${sequence.join(' | ')}`).toBe(true);
    const greeted = sequence.indexOf('-:greeting');
    expect(sequence.slice(0, greeted).some((s) => /^-:boss:[23]\/3$/.test(s))).toBe(true);
    expect(['secure', 'independent']).toContain(await bandOnRecord(page));

    assertNoErrors(errors, info);
  });

  test('a learner who misses everything is never cycled through the same items, and never left', async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await seedOnboarded(page);
    await seedAtomWorld(page);
    await page.goto('/');
    await installAtomPoolBrain(page);
    await openTheAtom(page);

    const { handed, ended } = await play(page, { practice: () => false, boss: 'wrong' }, 16);
    const sequence = handed.map(say);
    info.attach('handed', { body: sequence.join('\n'), contentType: 'text/plain' });
    console.log(`HANDED: ${sequence.join(' | ')}`);

    // RULE 2: nothing about getting everything wrong ends the topic.
    expect(ended).toBe(false);
    expect(handed.map((h) => h.what)).not.toContain('bossdoor');

    // RULE 1: no sitting hands a third item after two misses, and a sitting that beat them is
    // followed by something that is not a practice item.
    const runs = sittings(handed);
    expect(runs.length, `one endless practice run: ${sequence.join(' | ')}`).toBeGreaterThan(1);
    for (const run of runs) expect(run.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < handed.length; i += 1) {
      const before = handed[i - 1] as Handed;
      const now = handed[i] as Handed;
      const beatenJustNow =
        before.right === false && handed.slice(0, i - 1).at(-1)?.right === false;
      if (beatenJustNow) expect(now.right, `handed ${say(now)} straight after`).toBe(undefined);
    }

    // RULE 5: the walk never ran dry. Every step of the budget handed something.
    expect(handed.length).toBe(16);
    await expect(page.locator('.ls-actions button').first()).toBeVisible();

    assertNoErrors(errors, info);
  });
});
