/**
 * THE OTHER HALF OF THE SHARE: what the learner meets when they get here.
 *
 * The worker has done its part (tests/share-target.spec.ts): the photo is in the device's Cache
 * and the address carries its token. This file plants exactly that and walks the doubt solver from
 * it, against a gateway answered in the browser, to prove the three things the feature is for:
 *
 *  · a shared photo is read the way a photographed one is — the screen leaves the capture step on
 *    its own and shows the reading, LINE BY LINE, with nothing computed (LAW 1: the answer door is
 *    never called until the learner says Explain);
 *  · it is collected ONCE: the bytes leave the device store the moment the screen has them, and
 *    the token leaves the address bar;
 *  · a visit with no share — which is every ordinary visit — is the capture step with the camera
 *    in front of the learner and NOT ONE WORD about a photo that did not arrive.
 *
 * Run: `bunx playwright test --config tests/share-target.config.ts --project arrival`
 */

import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded, watchConsole } from './helpers';

const SHARE_CACHE = 'wobo-share-v1';
const DOUBT_ID = 'd-share-01';

/** `POST /v1/doubt` as the gateway answers it: the lines it read, each with its place on the page. */
const READ = {
  doubt: DOUBT_ID,
  created_at: '2026-09-16T09:00:00Z',
  status: 'read',
  words: '',
  say: 'I read this as: 3x + 5 = 20; Solve for x. Is that right? Fix anything I got wrong first.',
  reading: {
    subject: 'Mathematics',
    topic: 'linear equations',
    question: 'Solve 3x + 5 = 20 for x.',
    lines: [
      { id: 'r1', text: '3x + 5 = 20', box: [0.09, 0.2, 0.55, 0.275] },
      { id: 'r2', text: 'Solve for x.', box: [0.09, 0.3, 0.4, 0.34] },
    ],
    width: 900,
    height: 1200,
  },
  climb: { node_id: null, node_name: null, framework_id: null },
};

interface Hit {
  method: string;
  path: string;
}

/** The gateway, answered in the browser. Nothing leaves the machine. */
async function fakeGateway(page: Page, log: Hit[]): Promise<void> {
  await page.route('**/gw/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/gw/, '');
    log.push({ method: route.request().method(), path });
    if (path === '/v1/doubt' && route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(READ),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'not_found' }),
    });
  });
}

/**
 * Put a share where the worker puts one. The page is on our origin, so this is the same Cache the
 * worker writes to and the same one the capture step reads.
 */
async function plantShare(
  page: Page,
  what: { token: string; at?: number; pointer?: boolean },
): Promise<void> {
  await page.evaluate(
    async (share) => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 1200;
      const pen = canvas.getContext('2d');
      if (pen) {
        pen.fillStyle = '#ffffff';
        pen.fillRect(0, 0, 900, 1200);
        pen.fillStyle = '#14142B';
        pen.font = '600 64px sans-serif';
        pen.fillText('3x + 5 = 20', 90, 300);
        pen.font = '400 30px sans-serif';
        pen.fillText('Solve for x.', 90, 380);
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
      );
      const cache = await caches.open(share.cacheName);
      await cache.put(
        `/__wobo-share/${share.token}`,
        new Response(blob as Blob, {
          headers: {
            'content-type': 'image/jpeg',
            'x-wobo-share-at': String(share.at),
            'x-wobo-share-name': 'page.jpg',
          },
        }),
      );
      if (share.pointer) {
        await cache.put(
          '/__wobo-share/latest',
          new Response(JSON.stringify({ token: share.token, at: share.at }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
    },
    {
      cacheName: SHARE_CACHE,
      token: what.token,
      at: what.at ?? Date.now(),
      pointer: what.pointer ?? true,
    },
  );
}

function stillHeld(page: Page): Promise<string[]> {
  return page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((k) => new URL(k.url).pathname);
  }, SHARE_CACHE);
}

test.beforeEach(async ({ page }) => {
  await seedOnboarded(page);
});

test('a shared photo is read exactly as a photographed one, and nothing is computed first', async ({
  page,
}) => {
  const noise = watchConsole(page);
  const hits: Hit[] = [];
  await fakeGateway(page, hits);
  await page.setViewportSize({ width: 390, height: 844 });
  const token = '11111111-2222-4333-8444-555555555555';

  await page.goto('/doubt');
  await expect(page.getByText('Take a photo of the doubt')).toBeVisible();
  await plantShare(page, { token });

  // the address the worker's redirect lands on
  await page.goto(`/doubt?share=${token}`);

  // LAW 1: the reading, shown, line by line, before anything is computed
  await expect(page.getByTestId('doubt-reading-line')).toHaveText(
    'I read this as 3x + 5 = 20; Solve for x. Is that right?',
  );
  await expect(page.getByTestId('doubt-photo')).toBeVisible();
  await expect(page.locator('[data-region]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeEnabled();
  expect(hits.filter((h) => h.path.endsWith('/answer'))).toHaveLength(0);
  expect(hits.filter((h) => h.path === '/v1/doubt' && h.method === 'POST')).toHaveLength(1);

  // taken once: the bytes are off the device store, and the token is out of the address
  expect(await stillHeld(page)).toEqual([]);
  expect(new URL(page.url()).searchParams.get('share')).toBeNull();
  console.log(
    `\n[arrival] a shared photo reached the reading in ${hits.length} gateway call(s), and the device store is empty`,
  );
  expect(noise.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('the photo survives the address bar being cleaned: the pointer is enough', async ({
  page,
}) => {
  const hits: Hit[] = [];
  await fakeGateway(page, hits);
  await page.goto('/doubt');
  await plantShare(page, { token: '99999999-8888-4777-8666-555555555555' });

  // no token in the address at all — the router replaces it on boot, and this is that case
  await page.goto('/doubt');
  await expect(page.getByTestId('doubt-reading-line')).toContainText('I read this as 3x + 5 = 20');
  expect(await stillHeld(page)).toEqual([]);
});

test('a share from another sitting is dropped rather than opened, and says nothing', async ({
  page,
}) => {
  const hits: Hit[] = [];
  await fakeGateway(page, hits);
  await page.goto('/doubt');
  await plantShare(page, {
    token: '22222222-3333-4444-8555-666666666666',
    at: Date.now() - 60 * 60 * 1000,
  });

  await page.goto('/doubt');
  await expect(page.getByText('Take a photo of the doubt')).toBeVisible();
  await expect(page.locator('.db-error')).toHaveCount(0);
  expect(hits.filter((h) => h.path === '/v1/doubt')).toHaveLength(0);
  expect(await stillHeld(page)).toEqual([]);
});

/**
 * THE SIBLING ON THE FAMILY TABLET — the defect this file was extended for, in a real browser.
 *
 * `wobo-share-v1` is a Cache of the ORIGIN. It is keyed to nobody, every learner on one device
 * opens the same one, and the doubt screen collects from it on EVERY mount rather than only on a
 * share arrival. The pointer was honoured for ten minutes with no question about whose ten minutes
 * they were, so: one child shares their homework and is called away; within those ten minutes a
 * sibling opens the doubt solver; the sibling's screen came up with the first child's photograph
 * already read, and their Explain would have sent it to the gateway under their own account.
 *
 * Two minutes is the proof, because two minutes is well inside the window the old rule allowed and
 * is plainly another page load's share. The photo is not merely left unread: it leaves the device.
 */
test('a share from a page load that has already ended is dropped, not handed to the next learner', async ({
  page,
}) => {
  const hits: Hit[] = [];
  await fakeGateway(page, hits);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doubt');
  await plantShare(page, {
    token: '33333333-4444-4555-8666-777777777777',
    at: Date.now() - 2 * 60 * 1000,
  });

  await page.goto('/doubt');
  await expect(page.getByText('Take a photo of the doubt')).toBeVisible();
  await expect(page.getByTestId('doubt-reading-line')).toHaveCount(0);
  // nothing computed, nothing said, and nothing left on the device for a third visit
  expect(hits.filter((h) => h.path === '/v1/doubt')).toHaveLength(0);
  await expect(page.locator('.db-error')).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  expect(await stillHeld(page)).toEqual([]);
  console.log(
    '[arrival] a two minute old share belonged to another page load: dropped, unread, and off the device',
  );
});

test('a visit with no share is the capture step, with nothing said about the absence', async ({
  page,
}) => {
  const noise = watchConsole(page);
  const hits: Hit[] = [];
  await fakeGateway(page, hits);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/doubt?share=not-a-real-token-at-all');
  await expect(page.getByText('Take a photo of the doubt')).toBeVisible();
  // never narrate: no refusal, no alert, no sentence about a photo that never came
  await expect(page.locator('.db-error')).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  expect(hits.filter((h) => h.path === '/v1/doubt')).toHaveLength(0);
  expect(noise.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  console.log('[arrival] a visit with no share said nothing and asked the gateway nothing');
});
