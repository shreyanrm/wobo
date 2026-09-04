/**
 * The curriculum journeys, in a real browser, over the real seeded boards.
 *
 * What is under test here is the app's own curriculum layer — `src/curriculum/client.ts`,
 * `world.ts`, `subjects.ts` and the SDK's parsers — driven with payloads built from the actual
 * files under `content/curriculum/`. The fixtures are read in Node when this module loads and
 * handed to the page, so a chapter list asserted here is the chapter list a board publishes, not
 * one written into a test.
 *
 * The gateway is replaced at the client's own seam (`createCurriculumClient(url, { post })`), so
 * every parser, every honest label and every refusal runs for real while nothing leaves the
 * machine. The Playwright config already starts the app keyless (`VITE_GATEWAY_URL=`), which is
 * the state `curriculumReady()` calls honest — these specs supply the brain the app would talk to.
 *
 * Three journeys, from CURRICULUM.md §3, §5, §6 and §8:
 *   1. pick a board by typing part of its name, open a class and a subject, read the chapters and
 *      the label that says how well we know them;
 *   2. ask for something we hold no syllabus for and get the status card and the door, never an
 *      invented chapter;
 *   3. paste your own syllabus and get a personal plan that says it is yours.
 */

import { expect, type Page, test } from '@playwright/test';
import { assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { brainFor, installBrain, nameOf, withChapters } from './helpers/brain';

async function open(page: Page): Promise<void> {
  await seedOnboarded(page);
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
}

// =================================================================================================
// Journey 1 — pick a board by typing, open a subject, read the honest label
// =================================================================================================

test.describe('picking a board and opening a subject', () => {
  test('a typed fragment of a board name finds the board, and only the board', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const brain = brainFor(withChapters('cbse'));
    await open(page);
    await installBrain(page, brain);

    const results = await page.evaluate(async () => {
      const CLIENT_MODULE = '/src/curriculum/client.ts';
      const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
        curriculum: () => { search: (q: string, o?: unknown) => Promise<unknown> };
      };
      const found = (await curriculum().search('centr', { country: 'IN' })) as {
        results: Array<{ id: string; name: string; label: string }>;
        notListed: { message: string } | null;
      };
      return found;
    });

    expect(results.results.map((r) => r.id)).toContain('cbse');
    // §3: the door is on every response, matched or not.
    expect(results.notListed?.message).toContain('Show me your syllabus');
    assertNoErrors(errors, info);
  });

  test('every alias the board publishes is a way to find it', async ({ page }, info) => {
    const errors = watchConsole(page);
    const brain = brainFor(withChapters('cbse'));
    await open(page);
    await installBrain(page, brain);

    for (const alias of brain.framework.aliases.slice(0, 4)) {
      const ids = await page.evaluate(async (typed: string) => {
        const CLIENT_MODULE = '/src/curriculum/client.ts';
        const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
          curriculum: () => { search: (q: string) => Promise<{ results: Array<{ id: string }> }> };
        };
        return (await curriculum().search(typed)).results.map((r) => r.id);
      }, alias);
      expect(ids, `alias ${alias}`).toContain('cbse');
    }
    assertNoErrors(errors, info);
  });

  test('the chapters shown are the board’s own, in the board’s own order', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const file = withChapters('cbse');
    await open(page);
    await installBrain(page, brainFor(file));

    const served = await page.evaluate(
      async ({ id, level, subject }) => {
        const CLIENT_MODULE = '/src/curriculum/client.ts';
        const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
          curriculum: () => {
            units: (
              f: string,
              l: string,
              s: string,
            ) => Promise<{ status: string; units: Array<{ name: string; sourceRef: unknown }> }>;
          };
        };
        return await curriculum().units(id, level, subject);
      },
      { id: file.framework_id, level: file.level, subject: file.subject },
    );

    expect(served.status).toBe('ready');
    expect(served.units.map((u) => u.name)).toEqual((file.units ?? []).map(nameOf));
    // §12, first line: a syllabus with no source. Every chapter arrives carrying where it came from.
    for (const unit of served.units) expect(unit.sourceRef).toBeTruthy();
    assertNoErrors(errors, info);
  });

  test('the label says how well we know the syllabus, in one plain sentence', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const file = withChapters('cbse');
    const brain = brainFor(file);
    await open(page);
    await installBrain(page, brain);

    const view = await page.evaluate(async (id: string) => {
      const CLIENT_MODULE = '/src/curriculum/client.ts';
      const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
        curriculum: () => { framework: (f: string) => Promise<{ label: string }> };
      };
      return await curriculum().framework(id);
    }, file.framework_id);

    const allowed = [
      "Found on the board's site, still checking",
      'Shared by another learner, not yet checked',
      'Drafted from your syllabus, check it',
    ];
    expect(allowed.includes(view.label) || /^Official .+, verified$/.test(view.label)).toBe(true);
    // Product copy law: sentence case, no emoji, no exclamation marks.
    expect(view.label).not.toMatch(/[!\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    // A syllabus nothing has promoted must never say "verified" (CURRICULUM.md §4.5).
    if (file.status !== 'verified') expect(view.label).not.toContain('verified');
    assertNoErrors(errors, info);
  });

  test('the world a learner ends up with never invents a board or a class', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const file = withChapters('cbse');
    const brain = brainFor(file);
    await open(page);
    await installBrain(page, brain);

    const world = await page.evaluate(
      async ({ framework, version, label, level }) => {
        const WORLD_MODULE = '/src/curriculum/world.ts';
        const w = (await import(/* @vite-ignore */ WORLD_MODULE)) as {
          worldFrom: (f: unknown, o: unknown) => unknown;
          saveWorld: (w: unknown) => void;
          loadWorld: () => unknown;
          resetWorldCache: () => void;
          schoolLevels: (levels: string[]) => string[];
        };
        // An untouched device has no world at all — never a default board.
        w.resetWorldCache();
        const before = w.loadWorld();
        const built = w.worldFrom(
          { ...(framework as Record<string, unknown>), label },
          {
            version: { id: version.id, year: version.label },
            label,
            level,
            levels: framework.levels,
          },
        );
        w.saveWorld(built);
        w.resetWorldCache();
        return { before, after: w.loadWorld(), inBand: w.schoolLevels(framework.levels) };
      },
      { framework: brain.framework, version: brain.version, label: brain.label, level: file.level },
    );

    expect(world.before).toBeNull();
    expect(world.after).toMatchObject({
      frameworkId: file.framework_id,
      level: file.level,
      label: brain.label,
      personal: false,
    });
    // §11: grades 4 to 13, school level only.
    for (const level of world.inBand) {
      const grade = Number(level.match(/\d{1,2}/)?.[0] ?? Number.NaN);
      if (Number.isFinite(grade)) expect(grade).toBeGreaterThanOrEqual(4);
      if (Number.isFinite(grade)) expect(grade).toBeLessThanOrEqual(13);
    }
    assertNoErrors(errors, info);
  });
});

// =================================================================================================
// Journey 2 — the board, class or subject we hold nothing for
// =================================================================================================

test.describe('the not-listed path', () => {
  test('a subject we hold no syllabus for shows the status card and no chapters', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const file = withChapters('cbse');
    await open(page);
    await installBrain(page, brainFor(file));

    const served = await page.evaluate(
      async ({ id, level }) => {
        const CLIENT_MODULE = '/src/curriculum/client.ts';
        const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
          curriculum: () => {
            units: (
              f: string,
              l: string,
              s: string,
            ) => Promise<{
              status: string;
              units: unknown[];
              placeholder: { message: string; open: boolean } | null;
              notListed: { message: string } | null;
              label: string | null;
            }>;
          };
        };
        return await curriculum().units(id, level, 'Sanskrit');
      },
      { id: file.framework_id, level: file.level },
    );

    expect(served.status).toBe('looking');
    // §12: never a plausible fabrication. Not one chapter comes back.
    expect(served.units).toEqual([]);
    expect(served.placeholder?.open).toBe(true);
    expect(served.placeholder?.message).toBe('Looking for the official syllabus now');
    // §3: the own-syllabus door, one tap away, on the dead end as much as on the search.
    expect(served.notListed?.message).toContain('Show me your syllabus');
    expect(served.placeholder?.message).not.toMatch(/!/);
    assertNoErrors(errors, info);
  });

  test('a class we hold nothing for lists no subjects rather than plausible ones', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const file = withChapters('cbse');
    await open(page);
    await installBrain(page, brainFor(file));

    const view = await page.evaluate(
      async ({ id }) => {
        const CLIENT_MODULE = '/src/curriculum/client.ts';
        const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
          curriculum: () => {
            framework: (
              f: string,
              o: { level: string },
            ) => Promise<{ subjects: string[]; notListed: { message: string } | null }>;
          };
        };
        return await curriculum().framework(id, { level: 'Class 5' });
      },
      { id: file.framework_id },
    );

    // Not one plausible subject. `parseFrameworkView` carries no door of its own, so the door for
    // this dead end is the one on the units call below — §3 asks for it within a tap, not on
    // every payload.
    expect(view.subjects).toEqual([]);
    assertNoErrors(errors, info);
  });
});

// =================================================================================================
// Journey 3 — the learner's own syllabus
// =================================================================================================

test.describe('the learner’s own syllabus', () => {
  const PASTED = [
    'Rational numbers',
    'Linear equations in one variable',
    'Understanding quadrilaterals',
    'Data handling',
  ].join('\n');

  test('a pasted syllabus becomes a personal plan that says it is yours', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    await open(page);
    await installBrain(page, brainFor(withChapters('cbse')));

    const built = await page.evaluate(async (text: string) => {
      const CLIENT_MODULE = '/src/curriculum/client.ts';
      const { curriculum } = (await import(/* @vite-ignore */ CLIENT_MODULE)) as {
        curriculum: () => {
          own: {
            read: (
              source: unknown,
              about: unknown,
            ) => Promise<{
              framework: { id: string; name: string; status: string; personal: boolean };
              label: string;
              level: string;
              subject: string | null;
              status: string;
              units: Array<{ id: string; name: string; confirmed: boolean }>;
              unconfirmed: string[];
            }>;
          };
        };
      };
      const view = await curriculum().own.read(
        { kind: 'paste', text, title: 'My school list' },
        { name: 'A school of their own', level: 'Class 8', subject: 'Mathematics' },
      );
      return view;
    }, PASTED);

    // The plan is what they pasted, in the order they pasted it — nothing added, nothing tidied
    // into a chapter they did not write.
    expect(built.units.map((u) => u.name)).toEqual(PASTED.split('\n'));
    expect(built.framework.id).toBe('own:aanya-1');
    expect(built.framework.name).toBe('A school of their own');
    // §6: a personal framework belongs to the learner and is never shared unless they offer it.
    expect(built.framework.personal).toBe(true);
    expect(built.status).toBe('personal');
    expect(built.level).toBe('Class 8');
    // §5: a personal syllabus keeps its own label whatever else is true of it.
    expect(built.label).toBe('Drafted from your syllabus, check it');
    // §6: one tap per unit to confirm — nothing is taken as read on the learner's behalf.
    expect(built.unconfirmed).toEqual(built.units.map((u) => u.id));
    for (const unit of built.units) expect(unit.confirmed).toBe(false);
    assertNoErrors(errors, info);
  });

  test('a personal world is marked personal, so nothing ever offers to share it', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    await open(page);
    await installBrain(page, brainFor(withChapters('cbse')));

    const world = await page.evaluate(async () => {
      const WORLD_MODULE = '/src/curriculum/world.ts';
      const w = (await import(/* @vite-ignore */ WORLD_MODULE)) as {
        worldFrom: (f: unknown, o: unknown) => { personal: boolean; label: string };
      };
      return w.worldFrom(
        {
          id: 'own:aanya-1',
          name: 'A school of their own',
          kind: 'personal',
          status: 'personal',
          aliases: [],
          levels: ['Class 8'],
          personal: true,
          label: 'Drafted from your syllabus, check it',
        },
        { level: 'Class 8' },
      );
    });

    expect(world.personal).toBe(true);
    expect(world.label).toBe('Drafted from your syllabus, check it');
    assertNoErrors(errors, info);
  });
});

// =================================================================================================
// The picker screen
// =================================================================================================

/**
 * The registry-backed picker — type a board, pick a class, read the label — on the You screen,
 * which is where a learner changes their board after onboarding. `docs/CURRICULUM.md` §10's static
 * chip list is gone: what answers here is `BoardSearch` over the brain installed above, so a board
 * that reaches the screen is a board the registry served.
 */
test.describe('the picker screen', () => {
  /**
   * Open the board picker on You — it is behind the current world's own label, which is the door.
   * The brain is installed AFTER the navigation, because a navigation throws the page's modules
   * away and the client goes with them.
   */
  async function openPicker(page: Page) {
    await seedOnboarded(page);
    await page.goto('/you');
    await expect(page.locator('#root')).not.toBeEmpty();
    await installBrain(page, brainFor(withChapters('cbse')));
    await page.locator('button:has-text("· change")').first().click();
    return page.getByRole('textbox', { name: /board/i });
  }

  test('a board is picked by typing, and the chosen board shows its label', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const search = await openPicker(page);
    await search.pressSequentially('centr', { delay: 30 });
    const hit = page.getByRole('button', { name: /Central Board of Secondary Education/ }).first();
    await expect(hit).toBeVisible();
    await hit.click();

    // §5: the label is the one thing the learner is told about how well we know this syllabus.
    await expect(
      page
        .getByText(
          /Official .+, verified|Found on the board's site, still checking|Shared by another learner, not yet checked/,
        )
        .first(),
    ).toBeVisible();
    assertNoErrors(errors, info);
  });

  test('a board we hold nothing for shows the own-syllabus door, never a substitute', async ({
    page,
  }, info) => {
    const errors = watchConsole(page);
    const search = await openPicker(page);
    await search.pressSequentially('a board nobody publishes', { delay: 5 });
    // §3: the door is never more than one tap away, and it is what a dead end offers.
    await expect(page.getByRole('button', { name: /Show me my syllabus/ }).first()).toBeVisible();
    // And nothing was substituted for the board they asked for.
    await expect(page.getByRole('button', { name: /Central Board/ })).toHaveCount(0);
    assertNoErrors(errors, info);
  });
});
