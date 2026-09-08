import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded } from './helpers';
import { seedAtomWorld } from './helpers/brain';

/**
 * Wave 29, learn-2: a screen that exits never unmounted when the very next navigation brought the
 * same screen back while it was still leaving. The download-first gate does exactly that: Course
 * mounts, enqueues, bounces `back()` to Learn in the same tick, so Learn's exiting instance and its
 * new instance shared one AnimatePresence key and neither the stale Learn nor the bouncing Course
 * was ever removed. Three `.wk-shell`s stacked at top:0, three rails, and the stale climb sat over
 * 'Start the course' catching the tap. The screen key is minted once per navigation now, so every
 * exit finishes on its own; this walks the bounce at both widths and counts what is left.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SDK_ENTRY = `/@fs${join(REPO, 'packages/sdk/src/index.ts')}`;
const TOPIC = 'Algebra play';
const TOPIC_ID = 'topic-algebra-play';

function brain() {
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
    id: TOPIC_ID,
    kind: 'topic',
    name: TOPIC,
    parent_id: unit.id,
    concept_ids: [],
    objectives: [],
  };
  return { framework, version, unit, topic };
}

async function installBrain(page: Page): Promise<void> {
  await page.evaluate(
    async ({ sdkEntry, b }) => {
      const sdk = (await import(/* @vite-ignore */ sdkEntry)) as {
        createCurriculumClient: (url: string, opts: { post: unknown }) => unknown;
      };
      const app = (await import(/* @vite-ignore */ '/src/curriculum/client.ts')) as {
        setCurriculumClient: (client: unknown) => void;
      };
      const block = {
        framework: b.framework,
        version: b.version,
        label: 'Drafted from your syllabus, check it',
        levels: b.framework.levels,
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
              units: [b.unit],
            };
          case 'curriculum.topics':
            return { ...block, unit: b.unit, topics: [b.topic] };
          case 'curriculum.overlay.get':
            return { framework_id: b.framework.id, ops: [], last_report: [] };
          case 'curriculum.overlay.apply':
            return {
              framework_id: b.framework.id,
              ops: Array.isArray(payload.ops) ? payload.ops : [],
              last_report: [],
            };
          default:
            return {};
        }
      };
      app.setCurriculumClient(sdk.createCurriculumClient('', { post }));
    },
    { sdkEntry: SDK_ENTRY, b: brain() },
  );
}

const count = (page: Page) =>
  page.evaluate(() => ({
    shells: document.querySelectorAll('.wk-shell').length,
    rails: document.querySelectorAll('aside.wk-rail').length,
    links: document.querySelectorAll('nav[aria-label=Wobo] a').length,
  }));

// The honest floor the gateway serves when it has nothing verified for a topic: a placeholder,
// named three ways (Composing.isPlaceholderEnvelope). Never opened as a course, never 'ready'.
const PLACEHOLDER = {
  verified: false,
  status: 'provisional',
  seeded: true,
  provenance: { engine: 'engine.compose', source: 'seed', placeholder: true },
  artifact: { topic: TOPIC, cards: [], workbook: [], boss: [] },
};

for (const width of [390, 1440]) {
  test(`the download-first bounce leaves one screen standing at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await seedOnboarded(page);
    await seedAtomWorld(page);
    await page.route('**/v1/capability/engine.compose', (r) => r.fulfill({ json: PLACEHOLDER }));
    await page.goto('/');
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
    // the gate bounced us back to Learn; the exiting Course and the old Learn must both be gone
    await page.waitForTimeout(3000);
    expect(page.url()).toMatch(/\/learn$/);
    const afterBounce = await count(page);
    expect(afterBounce, `after the bounce: ${JSON.stringify(afterBounce)}`).toEqual({
      shells: 1,
      rails: 1,
      links: 4,
    });
  });
}
