/**
 * A LEARNER, PLAYED THROUGH THE ATOM COURSE WITH A CHAPTER POOL (docs/LEARNING-MODEL.md, "The
 * tutor never leaves"). Shared by `course-rechosen.spec.ts` and `tutor-proves-it.spec.ts`.
 *
 * THE BRAIN. The learner's world and the atom topic are the ones every atom spec uses. The chapter
 * pool is the real `suggest/fixture.ts` pool, with its topic `t4` renamed to this topic's id
 * (`m2-1`). Nothing reaches a network: the pool is answered in the page, and how it is answered
 * (served, late, never, refused once) is the spec's to choose.
 *
 * EVERY LAB IS MUTED. The browser comes from the Playwright config, which launches with
 * `--mute-audio`, and nothing here adds launch options.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { aX, firstMove, fmt, linearize } from '../../src/screens/course/equations';
import { pool } from '../../src/suggest/fixture';
import { ATOM_ANSWERS, actionBarButton } from '../helpers';
import { atomBrain } from './brain';

const SDK_ENTRY = `/@fs${new URL('../../../../packages/sdk/src/index.ts', import.meta.url).pathname}`;

/** The fixture pool, as the brain would hand it for the atom's own chapter cell. */
export function atomPool(): unknown {
  return JSON.parse(JSON.stringify(pool()).replaceAll('"t4"', '"m2-1"'));
}

/** How the brain answers `curriculum.blueprint`. */
export type PoolAnswer =
  | { kind: 'serve' }
  /** answered after this long */
  | { kind: 'late'; ms: number }
  /** never answered */
  | { kind: 'stall' }
  /** refused the first time (the way a 429 reaches the client), served after that */
  | { kind: 'refuse-once' };

/**
 * The atom brain, plus `curriculum.blueprint`, which READS a pool and never builds one. Also
 * listens, in the page, for every time Wobo's drawer is opened and why: a drawer opened to
 * re-teach is a model call the learner's day pays for. Installed after the navigation that needs
 * it, like every brain.
 */
export async function installAtomPoolBrain(
  page: Page,
  answer: PoolAnswer = { kind: 'serve' },
): Promise<void> {
  await page.evaluate(
    async ({ sdkEntry, b, bp, answer }) => {
      const sdk = (await import(/* @vite-ignore */ sdkEntry)) as {
        createCurriculumClient: (url: string, opts: { post: unknown }) => unknown;
      };
      const app = (await import(/* @vite-ignore */ '/src/curriculum/client.ts')) as {
        setCurriculumClient: (client: unknown) => void;
      };
      const drawer = (await import(/* @vite-ignore */ '/src/wobo/drawer.ts')) as {
        subscribeCompanionOpen: (listener: (r: { reason?: string }) => void) => () => void;
      };
      const w = window as unknown as { __asked: string[]; __opened: string[] };
      w.__asked = [];
      w.__opened = [];
      drawer.subscribeCompanionOpen((r) => w.__opened.push(String(r.reason ?? '')));
      const block = {
        framework: b.framework,
        version: b.version,
        label: 'Drafted from your syllabus, check it',
        levels: b.framework.levels,
      };
      let pools = 0;
      const post = async (capability: string, payload: Record<string, unknown>) => {
        w.__asked.push(capability);
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
              units: [b.unit],
            };
          case 'curriculum.topics':
            return { ...block, unit: b.unit, topics: [b.topic] };
          case 'curriculum.blueprint': {
            pools += 1;
            const served = { blueprint: bp, held: 0 };
            if (answer.kind === 'stall') return new Promise(() => undefined);
            if (answer.kind === 'late') {
              return new Promise((done) => window.setTimeout(() => done(served), answer.ms));
            }
            if (answer.kind === 'refuse-once' && pools === 1) {
              const refused = new Error('We have talked a lot today. Tomorrow there is room.');
              refused.name = 'BudgetExhaustedError';
              throw refused;
            }
            return served;
          }
          case 'curriculum.overlay.get':
            return { framework_id: b.framework.id, ops: [], last_report: [] };
          case 'curriculum.overlay.apply':
            return { framework_id: b.framework.id, ops: [], last_report: [] };
          default:
            return {};
        }
      };
      app.setCurriculumClient(sdk.createCurriculumClient('', { post }));
    },
    { sdkEntry: SDK_ENTRY, b: atomBrain(ATOM_TARGET_NODE_ID), bp: atomPool(), answer },
  );
}

/** What the page asked the brain for, in order. */
export async function asked(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
}

/** Why Wobo's drawer was opened, in order. */
export async function drawerOpenings(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
}

/** Wobo's drawer, closed the way a learner closes it, when something brought it in. */
export async function closeTheDrawer(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Wobo' });
  if (!(await drawer.isVisible().catch(() => false))) return;
  await drawer
    .getByRole('button', { name: /^close$/i })
    .first()
    .click()
    .catch(() => undefined);
}

export const TOPIC_LINK = /^Solving equations with the variable on one side/;
export const CHAPTER_LINK = /Linear equations in one variable/;

/** Learn, then the chapter. */
export async function openTheChapter(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Learn', exact: true }).first().click();
  await page.getByRole('link', { name: CHAPTER_LINK }).first().click();
  await expect(page).toHaveURL(/\/subject\//, { timeout: 15_000 });
}

/** The door the topic opens on: the placement check's "Not now", or the lesson's "Begin". */
export function theDoor(page: Page): Locator {
  return page
    .getByRole('button', { name: /^not now$/i })
    .or(actionBarButton(page, 'begin'))
    .first();
}

/** A lesson card on stage: where a course that remembers its place opens again. */
export function aLessonCard(page: Page): Locator {
  const stage = page.locator('main.ls-stage');
  return stage
    .getByLabel('take this weight off')
    .or(stage.getByText(/^(Solve for x|Watch each move|Every number here is yours to drag)$/))
    .first();
}

/**
 * The topic, past the placement check, and through the arrival card. A course the learner has
 * been in before opens again where they were, with no arrival card: `resumes` accepts that.
 */
export async function openTheTopic(
  page: Page,
  opts: { doorWithin?: number; resumes?: boolean } = {},
): Promise<void> {
  await page.getByRole('link', { name: TOPIC_LINK }).first().click();
  await throughTheDoor(page, opts);
}

/** Past the placement check and the arrival card, however the lesson was opened. */
export async function throughTheDoor(
  page: Page,
  opts: { doorWithin?: number; resumes?: boolean } = {},
): Promise<void> {
  const notNow = page.getByRole('button', { name: /^not now$/i });
  const begin = actionBarButton(page, 'begin');
  const door = opts.resumes ? theDoor(page).or(aLessonCard(page)).first() : theDoor(page);
  await expect(door).toBeVisible({ timeout: opts.doorWithin ?? 20_000 });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  if (opts.resumes) {
    await expect(begin.or(aLessonCard(page)).first()).toBeVisible({ timeout: 15_000 });
    if (!(await begin.isVisible().catch(() => false))) return;
  }
  await expect(begin).toBeEnabled({ timeout: 15_000 });
  await begin.click();
}

/** Learn, the chapter, the topic, and in. */
export async function openTheAtom(page: Page): Promise<void> {
  await openTheChapter(page);
  await openTheTopic(page);
}

/** The practice equation on the card, found by the items the atom actually holds. */
async function onCard(page: Page): Promise<string> {
  for (let tries = 0; tries < 20; tries += 1) {
    for (const eq of Object.keys(ATOM_ANSWERS)) {
      const on = page.locator('main.ls-stage').getByText(eq, { exact: true }).first();
      if (await on.isVisible().catch(() => false)) return eq;
    }
    await page.waitForTimeout(150);
  }
  throw new Error('a practice card with no equation on it');
}

/** One thing handed to the learner, as the screen showed it. */
export interface Handed {
  /** The pool module the screen says is on stage, or '-' when it names none. */
  module: string;
  /**
   * What was on the card: `scale`, `whatif`, `worked[<equation>]`, a practice equation,
   * `bossdoor`, `boss:<n>/3`, `greeting`.
   */
  what: string;
  /** For a practice item: whether they got it. */
  right?: boolean;
  /** For a practice item: whether the course had shown this very equation solved before. */
  seen?: boolean;
}

export const say = (h: Handed): string =>
  `${h.module}:${h.what}${h.right === undefined ? '' : h.right ? '✓' : '✗'}${h.seen ? '(seen solved)' : ''}`;

export interface Learner {
  /** Right or wrong on the nth practice answer, given the equation and whether it was shown solved. */
  practice: (nth: number, equation: string, seenSolved: boolean) => boolean;
  /** How the learner answers the boss: all three right, all three wrong. Absent: stop at the door. */
  boss?: 'right' | 'wrong';
  /** Stop after this many boss rounds. */
  bossRounds?: number;
  /** Keep going past the greeting (a walk that greets before the boss would otherwise hide it). */
  throughGreeting?: boolean;
}

export interface Played {
  handed: Handed[];
  /** The greeting was reached. */
  ended: boolean;
  /** Practice answers given. */
  answered: number;
  /** Boss rounds checked, and how many of them passed. */
  bossRounds: number;
  bossPassed: number;
}

const block = (page: Page, whisper: string): Locator =>
  page.locator('main.ls-stage').getByText(whisper, { exact: true }).locator('xpath=..');

/** One boss round, answered as `how`. Returns how many of the three were right. */
async function answerTheBoss(page: Page, how: 'right' | 'wrong'): Promise<number> {
  const solve = block(page, 'one · solve it');
  const step = block(page, 'two · one step is missing — choose it');
  const error = block(page, 'three · one line below is wrong — tap it');
  await expect(solve).toBeVisible({ timeout: 15_000 });

  const solveEq = (await solve.innerText()).split('\n').map((l) => l.trim())[1] ?? '';
  const stepEq = (await step.innerText()).split('\n').map((l) => l.trim())[1] ?? '';
  const errorLines = await error.getByRole('button').allInnerTexts();
  const errorEq = errorLines[0]?.trim() ?? '';

  const s = linearize(solveEq);
  const st = linearize(stepEq);
  const er = linearize(errorEq);
  if (!s || !st || !er)
    throw new Error(`a boss this spec cannot read: ${solveEq} ${stepEq} ${errorEq}`);
  const rightMove = firstMove(st).text;
  const wrongLine = `${aX(er.a)} = ${fmt(er.c + er.b)}`;

  await solve.getByLabel('your answer for x').fill(how === 'right' ? fmt(s.x) : fmt(s.x + 7));
  const moves = step.getByRole('button');
  if (how === 'right') await moves.filter({ hasText: new RegExp(`^${rightMove}$`) }).click();
  else {
    const all = await moves.allInnerTexts();
    const other = all.findIndex((t) => t.trim() !== rightMove);
    await moves.nth(other).click();
  }
  const lines = error.getByRole('button');
  if (how === 'right') await lines.filter({ hasText: new RegExp(`^${wrongLine}$`) }).click();
  else await lines.first().click();

  await actionBarButton(page, 'check all three').click();
  return how === 'right' ? 3 : 0;
}

/**
 * THE LEARNER, PLAYED. Presses exactly what a learner presses on whatever the course hands them.
 * Stops at the greeting (unless told to go through it), at a boss door with no boss plan, after the
 * boss rounds allowed, or after `budget` things handed.
 */
export async function play(page: Page, learner: Learner, budget: number): Promise<Played> {
  const handed: Handed[] = [];
  const shownSolved = new Set<string>();
  const out: Played = { handed, ended: false, answered: 0, bossRounds: 0, bossPassed: 0 };
  const onStage = async (): Promise<string> =>
    (await page
      .locator('main.ls-stage [data-module]')
      .first()
      .getAttribute('data-module', { timeout: 500 })
      .catch(() => null)) ?? '-';

  for (let step = 0; step < budget; step += 1) {
    await closeTheDrawer(page);
    // Everything is read off the card on stage, never off the side column's outline.
    const stage = page.locator('main.ls-stage');
    const scale = stage.getByLabel('take this weight off').first();
    const whatIf = stage.getByText('Every number here is yours to drag', { exact: true });
    const worked = stage.getByText('Watch each move', { exact: true });
    const practice = stage.getByText('Solve for x', { exact: true });
    const greeting = stage.getByText(/^(The greeting|You came back)$/);
    const bossDoor = stage.getByText('no fear', { exact: false });
    const boss = stage.getByText('Three questions, one scale', { exact: true });
    await expect(
      scale.or(whatIf).or(worked).or(practice).or(greeting).or(bossDoor).or(boss).first(),
    ).toBeVisible({ timeout: 20_000 });

    if (await greeting.isVisible().catch(() => false)) {
      handed.push({ module: '-', what: 'greeting' });
      out.ended = true;
      if (!learner.throughGreeting) return out;
      // Continue, and a level beat if the earn crossed one, until the greeting has gone.
      for (let i = 0; i < 3 && (await greeting.isVisible().catch(() => false)); i += 1) {
        await actionBarButton(page, 'continue').click();
        await page.waitForTimeout(600);
      }
      const levelUp = actionBarButton(page, 'continue');
      if (await levelUp.isVisible().catch(() => false)) await levelUp.click();
      continue;
    }
    if (await bossDoor.isVisible().catch(() => false)) {
      handed.push({ module: '-', what: 'bossdoor' });
      if (!learner.boss) return out;
      await actionBarButton(page, 'step in').click();
      await expect(boss).toBeVisible({ timeout: 10_000 });
      continue;
    }
    if (await boss.isVisible().catch(() => false)) {
      if (!learner.boss || out.bossRounds >= (learner.bossRounds ?? 1)) return out;
      const right = await answerTheBoss(page, learner.boss);
      out.bossRounds += 1;
      if (right >= 2) out.bossPassed += 1;
      handed.push({ module: '-', what: `boss:${right}/3` });
      const onward = page.getByRole('button', { name: /^(continue|one more look)$/i }).last();
      await expect(onward).toBeEnabled({ timeout: 10_000 });
      if (out.bossRounds >= (learner.bossRounds ?? 1) && right < 2) {
        // The round is over and the learner stops here: what the course does next is read by
        // pressing on, once, and looking at what is put on stage.
        await onward.click();
        await page.waitForTimeout(800);
        const again = await boss.isVisible().catch(() => false);
        handed.push({
          module: again ? '-' : await onStage(),
          what: again ? 'boss-again' : 'after-boss',
        });
        return out;
      }
      await onward.click();
      await page.waitForTimeout(800);
      continue;
    }

    const module = await onStage();
    if (await practice.isVisible().catch(() => false)) {
      const equation = await onCard(page);
      const seen = shownSolved.has(equation);
      const right = learner.practice(out.answered, equation, seen);
      out.answered += 1;
      await page.keyboard.type(right ? (ATOM_ANSWERS[equation] ?? '0') : '9');
      await actionBarButton(page, 'check').click();
      handed.push({ module, what: equation, right, ...(seen ? { seen } : {}) });
      const onward = actionBarButton(page, 'continue');
      await expect(onward).toBeEnabled({ timeout: 15_000 });
      await closeTheDrawer(page);
      await onward.click();
      await expect(page.getByText(equation, { exact: true }).first())
        .toBeHidden({ timeout: 5_000 })
        .catch(() => undefined);
      continue;
    }
    if (await scale.isVisible().catch(() => false)) {
      handed.push({ module, what: 'scale' });
      for (let i = 0; i < 6; i += 1) {
        const w = page.getByLabel('take this weight off').first();
        if (!(await w.isVisible().catch(() => false))) break;
        await w.click();
      }
      const onward = actionBarButton(page, 'continue');
      await expect(onward).toBeEnabled({ timeout: 15_000 });
      await onward.click();
      await expect(scale).toBeHidden({ timeout: 10_000 });
      continue;
    }
    if (await whatIf.isVisible().catch(() => false)) {
      handed.push({ module, what: 'whatif' });
      for (let i = 0; i < 4 && (await whatIf.isVisible().catch(() => false)); i += 1) {
        await actionBarButton(page, 'continue')
          .click()
          .catch(() => undefined);
        await page.waitForTimeout(500);
      }
      await expect(whatIf).toBeHidden({ timeout: 10_000 });
      continue;
    }
    if (await worked.isVisible().catch(() => false)) {
      // Whatever equation the card solves, read off the card: the learner saw it solved.
      const lines = (await stage.innerText()).split('\n').map((l) => l.trim());
      const solved = lines.find((l) => /x/.test(l) && /=/.test(l) && linearize(l)) ?? '?';
      if (solved in ATOM_ANSWERS) shownSolved.add(solved);
      handed.push({ module, what: `worked[${solved}]` });
      // One press per move, each when Wobo has finished reading it, then on.
      for (let i = 0; i < 8 && (await worked.isVisible().catch(() => false)); i += 1) {
        const press = page.getByRole('button', { name: /^(next move|continue)$/i }).last();
        await expect(press)
          .toBeEnabled({ timeout: 15_000 })
          .catch(() => undefined);
        await press.click().catch(() => undefined);
        await page.waitForTimeout(250);
      }
      await expect(worked).toBeHidden({ timeout: 10_000 });
    }
  }
  return out;
}

/** Every practice sitting, split where something other than a practice item was handed. */
export function sittings(handed: readonly Handed[]): Handed[][] {
  const out: Handed[][] = [];
  let run: Handed[] = [];
  for (const h of handed) {
    if (h.right === undefined) {
      if (run.length > 0) out.push(run);
      run = [];
    } else {
      run.push(h);
    }
  }
  if (run.length > 0) out.push(run);
  return out;
}

/** The band the durable record holds for the atom node, read the way the app stores it. */
export async function bandOnRecord(page: Page): Promise<string> {
  return page.evaluate((node) => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      if (!key.startsWith('wobo-mastery-v1')) continue;
      const snap = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        nodes?: Record<string, { band?: string }>;
      };
      const band = snap.nodes?.[node]?.band;
      if (band) return band;
    }
    return 'not_started';
  }, ATOM_TARGET_NODE_ID);
}

/** The topics the durable progress record calls completed. */
export async function completedOnRecord(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      if (!key.startsWith('wobo-progress-v1')) continue;
      try {
        const state = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          completedTopics?: string[];
        };
        for (const t of state.completedTopics ?? []) out.add(t);
      } catch {
        // not a progress record
      }
    }
    return [...out];
  });
}

/**
 * What the Learn board says about the atom's chapter. The row is a link when the chapter is behind
 * the learner or ahead of them, and a card with a Continue button when it is in hand, so it is found
 * by the row itself, whichever it is.
 */
export async function chapterRowOnTheBoard(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Learn', exact: true }).first().click();
  const row = page.locator('.ln-unit').filter({ hasText: CHAPTER_LINK }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // the rows settle once the chapter's topics and the learner's bands are both in
  await page.waitForTimeout(800);
  return (await row.innerText()).replace(/\s+/g, ' ').trim();
}
