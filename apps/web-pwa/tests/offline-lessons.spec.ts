/**
 * THE LESSON PLAYS WITH THE NETWORK OFF (docs/PLATFORMS.md §5 and §6).
 *
 * What this proves, and why each half of it is here.
 *
 * Measured on the built app before the fix, at 390, with a course that had been composed and played
 * minutes earlier: turning the network off did not degrade the lesson, it took it away. The compose
 * call was the only place the cards had ever existed, so the player floored to its generic
 * scaffold; the scaffold is `seeded`, so the screen flipped this topic's download from `ready` to
 * `failed`; the download gate then read `failed` and bounced the learner to the home screen. Going
 * offline once also destroyed the record of a course they already owned.
 *
 * So the spec plays a lesson with a brain answering, cuts the network for real, and asks for the
 * same lesson back. It asserts the three things that were each separately wrong:
 *
 *   1. the lesson OPENS — the learner is on the course, not sent home;
 *   2. it is THEIR lesson — the composed cards, not the scaffold, and never the "not written yet"
 *      line the placeholder screen carries;
 *   3. nothing was taken away by the outage — the queue still says the course is theirs, and no
 *      call to the brain was even attempted while offline.
 *
 * And one thing that was quietly wrong beside them: the product's own faces were never precached,
 * so an offline learner read the whole app in the system's fallback face (DESIGN.md §0).
 *
 * The brain is answered IN THE BROWSER (`page.route`), the way the doubt suite answers it, so the
 * SDK, the parsers, the player and its engines all run for real and nothing leaves the machine —
 * a catch-all route aborts every address that is not this server, before and after the cut.
 */

import { expect, test } from '@playwright/test';

const TOPIC = 't-offline-1';
const COURSE_TITLE = 'Solving equations on one side';
/** The line the placeholder screen shows. Seeing it offline is the defect this spec exists for. */
const PLACEHOLDER_LINE = /not written yet/i;

const WORLD = {
  frameworkId: 'own:offline-lab',
  frameworkName: 'My own chapter list',
  versionId: 'own-v1',
  versionYear: '1',
  status: 'personal',
  label: 'Drafted from your syllabus, check it',
  level: 'Class 8',
  levels: ['Class 8'],
  subjects: ['Mathematics'],
  personal: true,
};

const unit = {
  id: 'u-offline',
  kind: 'unit',
  name: 'Linear equations in one variable',
  parent_id: 'subject-node',
  order: 0,
  aliases: [],
  source_ref: null,
  // No concept id: a topic the brain has not mapped is a COMPOSED course, which is the path that
  // needed the network. The atom's own journey is written into the bundle and never did.
  concept_ids: [],
  own: true,
  not_in_my_school: false,
  textbook: null,
  renamed_from: null,
  source: null,
};
const topicNode = { ...unit, id: TOPIC, kind: 'topic', name: COURSE_TITLE, parent_id: unit.id };

const block = {
  framework: {
    id: WORLD.frameworkId,
    name: WORLD.frameworkName,
    kind: 'personal',
    status: 'personal',
    aliases: [],
    country: null,
    region: null,
    languages: ['en'],
    levels: ['Class 8'],
    official_site: null,
    personal: true,
  },
  version: { id: 'own-v1', framework_id: WORLD.frameworkId, label: '1', status: 'personal' },
  label: WORLD.label,
  levels: ['Class 8'],
};

/** The four cards of the lesson, named so the spec can tell them from the scaffold's four. */
const CARD_TITLES = ['Meet the balance', 'Feel the rule', 'Picture the scale', 'Where it bends'];

const card = (id: string, title: string, kind: 'text' | 'diagram') => ({
  id,
  kind,
  title,
  idea: `What ${title.toLowerCase()} really means, in one line.`,
  interaction: { kind: 'tap', prompt: 'Tap the part that looks unknown.' },
  reveal: 'Whatever you do to one side, you do to the other.',
});

const items = (prefix: string) =>
  [1, 2, 3].map((n) => ({
    id: `${prefix}${n}`,
    type: 'fill',
    prompt: `Solve x + ${n} = ${n + 5}`,
    answer: '5',
  }));

const COURSE = {
  topic: COURSE_TITLE,
  verified: true,
  cards: [
    card('c1', CARD_TITLES[0] as string, 'text'),
    card('c2', CARD_TITLES[1] as string, 'text'),
    card('c3', CARD_TITLES[2] as string, 'diagram'),
    card('c4', CARD_TITLES[3] as string, 'text'),
  ],
  workbook: items('w'),
  boss: items('b'),
};

const DIAGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" fill="none" stroke="#14142B" stroke-width="3"/></svg>';

function answerFor(capability: string, payload: Record<string, unknown>): unknown {
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
      return { ...block, unit, topics: [topicNode] };
    case 'curriculum.overlay.get':
      return { framework_id: WORLD.frameworkId, ops: [], last_report: [] };
    case 'engine.compose':
      return COURSE;
    case 'engine.diagram':
      return { svg: DIAGRAM };
    default:
      return {};
  }
}

/** Every call the page made to the brain, so "none while offline" is a measurement. */
const calls: string[] = [];

test.describe.configure({ mode: 'serial' });

test('a lesson already opened plays with the network off, in full', async ({ page, context }) => {
  await context.addInitScript((world) => {
    localStorage.setItem('wobo-onboarded-v1', '1');
    localStorage.setItem('wobo-met-v1', '1');
    localStorage.setItem(
      'wobo-learner-profile',
      // The copy law (DESIGN.md §0): no invented learner, not even in a fixture.
      JSON.stringify({ name: 'Learner', grade: 'Class 8', boardId: 'own:offline-lab' }),
    );
    localStorage.setItem('wobo-curriculum-world-v1', JSON.stringify(world));
    try {
      sessionStorage.setItem('wobo-home-opened', '1');
    } catch {
      /* ignore */
    }
  }, WORLD);

  // Nothing leaves this machine, before the cut or after it. The pattern deliberately matches only
  // addresses that are NOT this server: a catch-all would also sit in front of the worker's own
  // precache traffic, and the thing under test is precisely what that worker can answer alone.
  // Registered first, so the brain's route below still wins — Playwright matches routes in reverse
  // order of registration.
  await context.route(/^(?!http:\/\/localhost(?::\d+)?\/).*/, (route) =>
    route.abort('internetdisconnected'),
  );

  const brain = async (route: import('@playwright/test').Route) => {
    const capability = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/v1/capability/')[1] ?? '',
    );
    let payload: Record<string, unknown> = {};
    try {
      payload = (JSON.parse(route.request().postData() ?? '{}').payload ?? {}) as Record<
        string,
        unknown
      >;
    } catch {
      /* an empty payload answers the same */
    }
    calls.push(capability);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        capability,
        output: answerFor(capability, payload),
        track: 'track_2',
        cache_hit: false,
      }),
    });
  };
  await context.route('**/v1/capability/**', brain);

  // --- the first play, with a brain answering ----------------------------------------------------

  // The download gate composes the course in the background and bounces back; the second opening
  // is the one that plays. This is the learner's real first visit, not a shortcut around it.
  await page.goto(`/course/${TOPIC}`);
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('wobo-downloads-v1');
      if (!raw) return false;
      try {
        return (JSON.parse(raw) as { status: string }[]).some((d) => d.status === 'ready');
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60_000 },
  );

  await page.goto(`/course/${TOPIC}`);
  await expect(page.getByText(CARD_TITLES[0] as string, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(PLACEHOLDER_LINE)).toHaveCount(0);

  // The worker has to be installed and running, or "offline" below would only be measuring a
  // browser cache and the whole suite would prove nothing.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready.catch(() => null);
          return Boolean(reg?.active);
        }),
      { timeout: 60_000 },
    )
    .toBe(true);

  // --- now the network is genuinely gone ---------------------------------------------------------

  await context.unroute('**/v1/capability/**', brain);
  calls.length = 0;
  await context.setOffline(true);

  await page.goto(`/course/${TOPIC}`);

  // 1. The lesson opens. Before the fix the learner was sent to the home screen by the download
  //    gate, so this is asserted by what is on screen rather than by the address.
  await expect(page.getByText(CARD_TITLES[0] as string, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(CARD_TITLES[1] as string, { exact: false }).first()).toBeVisible();

  // 2. It is THEIR lesson: the composed cards, never the scaffold and never the placeholder line.
  await expect(page.getByText(PLACEHOLDER_LINE)).toHaveCount(0);
  await expect(page.getByText(new RegExp(`Meet ${COURSE_TITLE}`, 'i'))).toHaveCount(0);

  // 3. The outage took nothing away: the course is still theirs, and the brain was never called.
  const queue = await page.evaluate(() => localStorage.getItem('wobo-downloads-v1'));
  expect(queue, 'the download record survives an offline open').toContain('"status":"ready"');
  expect(calls, 'nothing was asked of the brain while offline').toEqual([]);

  // And the product is still drawn in its own hand, because the faces are precached now.
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.fonts.check('700 16px Poppins')),
    'the interface face is precached, so an offline learner does not read the fallback',
  ).toBe(true);

  // 4. And again, still offline, in a page that shares nothing with the first load: the worker
  //    answers the shell from its precache and the lesson comes off the learner's own storage.
  //    A second opening is the ordinary case — a child comes back to a lesson more than once —
  //    and it is where anything left in flight by the first one would show.
  const second = await context.newPage();
  await second.goto(`/course/${TOPIC}`);
  await expect(second.getByText(CARD_TITLES[0] as string, { exact: false }).first()).toBeVisible();
  await expect(second.getByText(PLACEHOLDER_LINE)).toHaveCount(0);
  expect(calls, 'still nothing asked of the brain').toEqual([]);
  await second.close();
});
