/**
 * THE DOUBT SOLVER, AFTER THE FIXER'S PASS OF 2026-09-07 — the four defects a learner would hit,
 * each measured in a real browser against a gateway answered in the browser. Every case here fails
 * on the code as it stood before the pass; that is what it is for.
 *
 *   1. THE DOOR IS FIXED TO THE VIEWPORT. `.db-entry` is `position: fixed`, but it rendered inside
 *      the route transition's `will-change: transform` wrapper, which is the containing block for a
 *      fixed descendant — so the camera disc was pinned to the bottom of the PAGE, hundreds of
 *      pixels below the fold, and scrolled with the document. Measured here at 390 and 1440 on the
 *      home, practice and progress screens, before and after a scroll.
 *   2. AN ANSWER THAT NEVER CAME IS NOT AN EXPLANATION. With the answer door refusing, the screen
 *      used to tag the doubt "Explained", show an empty said line, and write `explained: true` into
 *      the store. It now stays on the reading, says what happened, and keeps nothing.
 *   3. THE READER'S `question` IS NEVER ON SCREEN (DOUBT.md §5). Emptying every line used to put
 *      the reader's uncorrected question back into "I read this as ...", digits and all.
 *   4. LAW 4 ON A COLD TAB. The gateway's own syllabus node used to be discarded because the
 *      registry was empty on a screen a learner arrives at camera-first, so nothing joined the
 *      climb and a learner with a board pinned was told to go and choose one. The world is now
 *      walked for that node, and the doubt lands on the map under it.
 *   5. THERE IS A WAY OUT OF THE READING. A held vision call used to leave a learner with two
 *      rotate buttons and no exit until the SDK's own 65 second deadline.
 *
 * Run: `bunx playwright test --config tests/doubt.config.ts` from apps/web-pwa.
 */

import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded } from './helpers';

const DOUBT_ID = 'd-fix-01';
/** The board this learner is pinned to before they ever open a chapter. */
const WORLD = {
  frameworkId: 'cbse',
  frameworkName: 'CBSE',
  versionId: null,
  versionYear: null,
  status: 'verified',
  label: 'Official CBSE, verified',
  level: 'Class 8',
  levels: ['Class 8'],
  subjects: ['Mathematics'],
  personal: false,
};
const UNIT_ID = 'unit-lin';
const TOPIC_ID = 'topic-lin';
const TOPIC_NAME = 'Linear equations in one variable';

/**
 * The same arithmetic as `src/screens/learn/mastery.ts` `topicNodeUuid` — the id the gateway files
 * a doubt under (`climb.node_id`, DOUBT.md §1) and the id the app keys evidence by. Written out
 * here so the fixture is a real node id and not a string this test agreed with itself about; if
 * the two ever drift apart, the placement case below stops finding the topic and says so.
 */
function topicNodeUuid(topicId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < topicId.length; i++) {
    h ^= topicId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = 0x1000193 ^ topicId.length;
  for (let i = topicId.length - 1; i >= 0; i--) {
    h2 = Math.imul(h2 ^ topicId.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `00000000-0000-7000-8000-${h.toString(16).padStart(8, '0')}${h2
    .toString(16)
    .padStart(8, '0')
    .slice(0, 4)}`;
}

/** A reading the gateway filed under nothing: the learner is asked where it belongs. */
const NO_NODE = { node_id: null, node_name: null };

interface ReadShape {
  lines: { id: string; text: string; box: number[] | null }[];
  question: string;
  node: { node_id: string | null; node_name: string | null };
}

const reading = (shape: ReadShape) => ({
  doubt: DOUBT_ID,
  created_at: '2026-09-07T09:00:00Z',
  status: 'read',
  words: '',
  say: 'I read this as it stands. Is that right?',
  reading: {
    subject: 'Mathematics',
    topic: 'linear equations',
    question: shape.question,
    lines: shape.lines,
    width: 900,
    height: 1200,
  },
  climb: { ...shape.node, framework_id: 'cbse' },
});

/** A textbook page on a canvas, the way tests/doubt.spec.ts photographs one. */
async function pageImage(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#14142B';
    g.font = '600 64px sans-serif';
    g.fillText('3x + 5 = 20', 90, 300);
    return c.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

interface GatewayOptions {
  read: ReadShape;
  /** What the answer door does. 'stream' is a conforming turn; 'refuse' is a refusal. */
  answer: 'stream' | 'refuse';
  /** Hold the reading open for ever, so the reading phase can be walked out of. */
  holdRead?: boolean;
  /** Answer the curriculum capabilities the world walk uses (law 4 on a cold tab). */
  syllabus?: boolean;
}

const TURN = [
  { type: 'say', text: 'Look at the five first.', t: 0, dur: 1200 },
  { type: 'done', t: 1400, objects: 0, presentation: 'screen' },
];

async function fakeGateway(page: Page, options: GatewayOptions, log: string[]): Promise<void> {
  await page.route('**/gw/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/gw/, '');
    const method = req.method();
    log.push(`${method} ${path}`);
    const json = (status: number, content: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(content) });

    if (path === '/v1/doubt' && method === 'POST') {
      if (options.holdRead) return; // never fulfilled: the vision call that does not come back
      return json(200, reading(options.read));
    }
    if (path === `/v1/doubt/${DOUBT_ID}/answer` && method === 'POST') {
      if (options.answer === 'refuse') {
        return json(503, { code: 'trouble', message: 'I am having trouble reaching my brain.' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: TURN.map((f, i) => `id: t:${i}\ndata: ${JSON.stringify(f)}\n\n`).join(''),
      });
    }
    if (path === '/v1/doubt' && method === 'GET') return json(200, { doubts: [] });
    if (options.syllabus && path === '/v1/capability/curriculum.units') {
      return json(200, {
        framework_id: 'cbse',
        level: 'Class 8',
        subject: 'Mathematics',
        subject_id: 'subject-node',
        status: 'ready',
        label: WORLD.label,
        units: [{ id: UNIT_ID, kind: 'unit', name: 'Linear equations', order: 0 }],
      });
    }
    if (options.syllabus && path === '/v1/capability/curriculum.topics') {
      return json(200, {
        framework_id: 'cbse',
        unit: { id: UNIT_ID, name: 'Linear equations', order: 0 },
        topics: [{ id: TOPIC_ID, kind: 'topic', name: TOPIC_NAME, order: 0, parent_id: UNIT_ID }],
      });
    }
    // everything else the app asks at boot: not here, honestly
    return json(404, { code: 'not_found' });
  });
}

/** Seed the board the learner follows, without opening a single chapter. */
async function seedWorld(page: Page): Promise<void> {
  await page.addInitScript((world: string) => {
    localStorage.setItem('wobo-curriculum-world-v1', world);
  }, JSON.stringify(WORLD));
}

/** Take the photo through the doubt screen's own camera control. */
async function shoot(page: Page): Promise<void> {
  const photo = await pageImage(page);
  await page
    .locator('.db-wrap input[capture="environment"]')
    .setInputFiles({ name: 'page.jpg', mimeType: 'image/jpeg', buffer: photo });
}

/** Every doubt this device kept, whatever storage scope it landed under. */
function storedDoubts(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const out: unknown[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (!key.startsWith('wobo-doubts-v1')) continue;
      try {
        const rows = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (Array.isArray(rows)) out.push(...rows);
      } catch {
        // a corrupt row is not this test's business
      }
    }
    return out;
  });
}

test.describe.configure({ mode: 'serial' });

// --- 1. the one tap, from wherever a learner is ----------------------------------------------------

for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`the doubt door is fixed to the viewport at ${size.width}px, not to the page`, async ({
    page,
  }) => {
    await seedOnboarded(page);
    await fakeGateway(
      page,
      { read: { lines: [], question: '', node: NO_NODE }, answer: 'stream' },
      [],
    );
    await page.setViewportSize(size);
    const measured: string[] = [];
    for (const path of ['/', '/practice', '/progress']) {
      await page.goto(path);
      const entry = page.getByTestId('doubt-entry');
      await expect(entry).toBeVisible();
      // A LONG SCREEN, which is every real one: a learner's home, a chapter list, the progress
      // page. The spacer goes inside the main column, so it is the ROUTE WRAPPER that grows —
      // the element whose `will-change: transform` made it the containing block for anything
      // fixed inside it. With the entry rendered in the page, the disc lands at the bottom of
      // that wrapper, far under the fold; portaled to <body> it does not move at all.
      await page.evaluate(() => {
        const main = document.querySelector('.wk-main');
        if (!main || main.querySelector('[data-test-spacer]')) return;
        const spacer = document.createElement('div');
        spacer.setAttribute('data-test-spacer', '1');
        spacer.style.height = '2000px';
        main.appendChild(spacer);
      });
      const at = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="doubt-entry"]');
        const r = el?.getBoundingClientRect();
        return { top: r?.top ?? -1, bottom: r?.bottom ?? -1, vh: window.innerHeight };
      });
      // in the viewport, not half a page below the fold
      expect(
        at.bottom,
        `${path} at ${size.width}: bottom ${at.bottom} of ${at.vh}`,
      ).toBeLessThanOrEqual(at.vh + 1);
      expect(at.top, `${path} at ${size.width}`).toBeGreaterThanOrEqual(0);
      // and it stays there when the page moves under it
      const after = await page.evaluate(async () => {
        // straight there, not smoothly: the app sets scroll-behavior, and an animated scroll
        // would be measured before it had happened
        const root = document.documentElement;
        const before = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        root.scrollTop = 600;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        root.style.scrollBehavior = before;
        const r = document.querySelector('[data-testid="doubt-entry"]')?.getBoundingClientRect();
        return { top: r?.top ?? -1, scrolled: Math.round(window.scrollY) };
      });
      expect(after.scrolled, `${path} did not scroll, so nothing was proved`).toBeGreaterThan(100);
      expect(Math.abs(after.top - at.top), `${path} moved with the page`).toBeLessThanOrEqual(1);
      measured.push(
        `${path}: top ${Math.round(at.top)} of ${at.vh}, still ${Math.round(after.top)} after scrolling ${after.scrolled}px`,
      );
      // the disc is a real tap target wherever it sits
      const box = await page.getByTestId('doubt-entry').boundingBox();
      expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
    console.log(`[${size.width}px] the doubt door: ${measured.join(' | ')}`);
  });
}

// --- 2. an answer that never came is not an explanation --------------------------------------------

test('a doubt whose answer was refused is not tagged Explained, and nothing is filed', async ({
  page,
}) => {
  await seedOnboarded(page);
  const hits: string[] = [];
  await fakeGateway(
    page,
    {
      read: {
        lines: [{ id: 'r1', text: '3x + 5 = 20', box: [0.09, 0.2, 0.55, 0.275] }],
        question: 'Solve 3x + 5 = 20 for x.',
        node: NO_NODE,
      },
      answer: 'refuse',
    },
    hits,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doubt');
  await shoot(page);

  const explain = page.getByRole('button', { name: 'Explain', exact: true });
  await expect(explain).toBeEnabled();
  await explain.click();

  // the screen comes back to the reading and says what happened, in Wobo's voice
  await expect(page.getByText('I could not finish that explanation')).toBeVisible();
  await expect(page.getByText('Check what I read')).toBeVisible();
  await expect(page.getByText('Explained', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Kept with your doubts')).toHaveCount(0);
  await expect(page.getByText('Filed under')).toHaveCount(0);
  // and nothing was kept: a doubt is filed when it was explained, and it was not
  expect(await storedDoubts(page)).toEqual([]);
  // the answer door was asked exactly once, and Explain is one tap away again
  expect(hits.filter((h) => h.endsWith('/answer'))).toHaveLength(1);
  await expect(explain).toBeEnabled();
  console.log(`[refused answer] the screen stayed on the reading; kept doubts: 0`);
});

// --- 3. the reader's question is never on screen ---------------------------------------------------

test("emptying every line never puts the reader's own question back on screen", async ({
  page,
}) => {
  await seedOnboarded(page);
  await fakeGateway(
    page,
    {
      read: {
        lines: [{ id: 'r1', text: '8x + 5 = 20', box: [0.09, 0.2, 0.55, 0.275] }],
        question: 'Solve 8x + 5 = 20 for x.',
        node: NO_NODE,
      },
      answer: 'stream',
    },
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doubt');
  await shoot(page);

  const line = page.getByTestId('doubt-reading-line');
  await expect(line).toHaveText('I read this as 8x + 5 = 20. Is that right?');
  const first = page.getByRole('textbox', { name: /Line 1 as I read it/ });
  // the learner fixes the misread digit, then thinks again and clears the line entirely
  await first.fill('3x + 5 = 20');
  await expect(line).toHaveText('I read this as 3x + 5 = 20. Is that right?');
  await first.fill('');
  await expect(line).toHaveText('I could not read anything on this page. Tell me what it says?');
  // the 8 the learner deleted is nowhere on the screen, and Explain is closed
  expect(await page.locator('.db-wrap').innerText()).not.toContain('8x');
  await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeDisabled();
});

// --- 4. law 4 on a cold tab ------------------------------------------------------------------------

test("a doubt joins the climb under the gateway's node, on a tab that has opened no chapter", async ({
  page,
}) => {
  await seedOnboarded(page);
  await seedWorld(page);
  const hits: string[] = [];
  await fakeGateway(
    page,
    {
      read: {
        lines: [{ id: 'r1', text: '3x + 5 = 20', box: [0.09, 0.2, 0.55, 0.275] }],
        question: 'Solve 3x + 5 = 20 for x.',
        node: { node_id: topicNodeUuid(TOPIC_ID), node_name: TOPIC_NAME },
      },
      answer: 'stream',
      syllabus: true,
    },
    hits,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  // straight to the camera, the way a doubt arrives: no chapter is opened first
  await page.goto('/doubt');
  await shoot(page);
  await page.getByRole('button', { name: 'Explain', exact: true }).click();

  await expect(page.getByText(`Filed under`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(TOPIC_NAME)).toBeVisible();
  // never the line that tells a learner with a board pinned to go and choose one
  await expect(page.getByText('Choose a board in You')).toHaveCount(0);
  // it is on the map: the topic the gateway named is 'started', through the app's own progress store
  const progress = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (!key.startsWith('wobo-progress-v1')) continue;
      return localStorage.getItem(key);
    }
    return null;
  });
  expect(progress ?? '').toContain(TOPIC_ID);
  // and the world was walked for it, rather than the hint being thrown away
  expect(hits).toContain('POST /v1/capability/curriculum.units');
  expect(hits).toContain('POST /v1/capability/curriculum.topics');
  const kept = (await storedDoubts(page)) as { topicName?: string; explained?: boolean }[];
  expect(kept[0]?.topicName).toBe(TOPIC_NAME);
  expect(kept[0]?.explained).toBe(true);
  console.log(`[cold tab] filed under ${kept[0]?.topicName}, progress written for ${TOPIC_ID}`);
});

// --- 5. there is a way out of the reading ----------------------------------------------------------

test('a reading that never comes back can be walked out of', async ({ page }) => {
  await seedOnboarded(page);
  await fakeGateway(
    page,
    { read: { lines: [], question: '', node: NO_NODE }, answer: 'stream', holdRead: true },
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doubt');
  await shoot(page);

  await expect(page.getByText('Reading the page, one moment.')).toBeVisible();
  const out = page.getByRole('button', { name: 'Another photo' });
  await expect(out).toBeVisible();
  await out.click();
  // back at the camera, with the whole capture door in hand
  await expect(page.getByRole('heading', { name: 'Take a photo of the doubt' })).toBeVisible();
  await expect(page.locator('.db-wrap input[capture="environment"]')).toHaveCount(1);
});
