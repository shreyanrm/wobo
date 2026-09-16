/**
 * THE SHARE TARGET, AGAINST THE BUILT SERVICE WORKER.
 *
 * Everything else about this feature can be reasoned about in a fake scope
 * (src/screens/doubt/share-target.test.ts). This file is here because two of its claims are only
 * true of a real build in a real browser: that the manifest the browser fetches actually declares
 * the share target, and that the worker workbox generated — with our handler imported into it —
 * answers a genuine multipart POST before workbox's own router sees it.
 *
 * So the POST here is the one the phone makes: a form with `method=POST`,
 * `enctype=multipart/form-data` and a file on it, submitted at the address the manifest names.
 *
 * NOTHING LEAVES THE MACHINE. The build is the deployed one, so its gateway and account addresses
 * are the real ones; every request that is not this origin is aborted before it is made.
 *
 * Run: `bunx playwright test --config tests/share-target.config.ts --project built`
 */

import { expect, type Page, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SHARE_CACHE = 'wobo-share-v1';
const SHARE_PATH = '/__wobo-share/';

/** Hold the browser to this origin: a built app knows where production lives. */
async function keepItHome(page: Page, origin: string): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });
}

/** The worker, installed and in charge of this page: until it is, nothing intercepts a POST. */
async function workerInCharge(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => 'serviceWorker' in navigator, null, { timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // A page loaded before the worker activated is not controlled by it; one reload and it is.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
}

/**
 * The share a phone makes, as a fetch rather than a navigation.
 *
 * The worker cannot tell the two apart — it reads the method and the address — and a fetch keeps
 * the answer readable: `response.url` is where the redirect landed, token and all, and the app is
 * never booted, so what the worker stored is still there to be measured. The navigation form of
 * the same POST is the test below this one.
 */
async function shareByFetch(
  page: Page,
  what: { photo: boolean; title?: string },
): Promise<{ landedOn: string }> {
  return page.evaluate(async (fields) => {
    const form = new FormData();
    if (fields.title) form.set('title', fields.title);
    if (fields.photo) {
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
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
      );
      form.set('photo', new File([blob as Blob], 'page.jpg', { type: 'image/jpeg' }));
    }
    const res = await fetch('/doubt/shared', { method: 'POST', body: form });
    return { landedOn: res.url };
  }, what);
}

/** What the device is holding for the doubt solver right now. */
function held(page: Page): Promise<{ path: string; type: string | null; bytes: number }[]> {
  return page.evaluate(async (cacheName) => {
    if (!('caches' in self)) return [];
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const out: { path: string; type: string | null; bytes: number }[] = [];
    for (const key of keys) {
      const res = await cache.match(key);
      const blob = res ? await res.blob() : null;
      out.push({
        path: new URL(key.url).pathname,
        type: res?.headers.get('content-type') ?? null,
        bytes: blob?.size ?? 0,
      });
    }
    return out;
  }, SHARE_CACHE);
}

test.beforeEach(async ({ page, baseURL }) => {
  await keepItHome(page, String(baseURL));
  await workerInCharge(page);
  await page.evaluate(async (cacheName) => {
    if ('caches' in self) await caches.delete(cacheName);
  }, SHARE_CACHE);
});

test('the built manifest declares the share target, which is what puts Wobo in the share sheet', async ({
  page,
}) => {
  const manifest = await page.evaluate(() =>
    fetch('/manifest.webmanifest').then((r) => r.json() as Promise<Record<string, unknown>>),
  );
  const share = manifest.share_target as {
    action?: string;
    method?: string;
    enctype?: string;
    params?: { files?: { name?: string; accept?: string[] }[] };
  };
  expect(share).toBeTruthy();
  expect(share.method).toBe('POST');
  expect(share.enctype).toBe('multipart/form-data');
  expect(share.action).toBe('/doubt/shared');
  expect(share.params?.files?.[0]?.name).toBe('photo');
  expect(share.params?.files?.[0]?.accept).toEqual(['image/*']);
  console.log(`\n[built] share_target: ${share.method} ${share.action} (${share.enctype})`);
});

test('the worker answers the POST itself, keeps the photo, and hands back a token', async ({
  page,
}) => {
  const { landedOn } = await shareByFetch(page, { photo: true, title: 'Homework' });
  const to = new URL(landedOn);
  expect(to.pathname).toBe('/doubt');
  const token = to.searchParams.get('share');
  expect(token, 'the redirect carries the token the screen collects the photo by').toBeTruthy();
  expect(token).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

  const store = await held(page);
  const photo = store.find((e) => e.path === `${SHARE_PATH}${token}`);
  expect(photo, 'the shared photo is on the device, under its token').toBeTruthy();
  expect(photo?.type).toBe('image/jpeg');
  expect(photo?.bytes ?? 0).toBeGreaterThan(0);
  // and the pointer that survives the router cleaning the address bar on boot
  expect(store.some((e) => e.path === `${SHARE_PATH}latest`)).toBe(true);
  console.log(
    `[built] the share landed on ${to.pathname}?share=…, ${photo?.bytes} bytes of ${photo?.type} kept on the device`,
  );
});

test('a share with no image lands on the doubt solver with no token and nothing kept', async ({
  page,
}) => {
  const { landedOn } = await shareByFetch(page, { photo: false, title: 'Chapter 4' });
  const to = new URL(landedOn);
  expect(to.pathname).toBe('/doubt');
  expect(to.searchParams.get('share')).toBeNull();
  expect(await held(page)).toEqual([]);
  console.log(`[built] a text-only share landed on ${to.pathname} with nothing kept`);
});

test('the POST a phone actually makes — a multipart form, submitted — lands on the doubt route', async ({
  page,
}) => {
  const seen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) seen.push(frame.url());
  });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const pen = canvas.getContext('2d');
    if (pen) {
      pen.fillStyle = '#ffffff';
      pen.fillRect(0, 0, 600, 800);
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    );
    const move = new DataTransfer();
    move.items.add(new File([blob as Blob], 'page.jpg', { type: 'image/jpeg' }));
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/doubt/shared';
    form.enctype = 'multipart/form-data';
    const field = document.createElement('input');
    field.type = 'file';
    field.name = 'photo';
    form.appendChild(field);
    document.body.appendChild(form);
    field.files = move.files;
    form.submit();
  });
  await page.waitForURL(/\/doubt(\?|$)/, { timeout: 30_000 });
  const withToken = seen.find((url) => /\/doubt\?share=[A-Za-z0-9_-]{8,64}/.test(url));
  expect(withToken, `no redirect with a token in: ${seen.join(' , ')}`).toBeTruthy();
  console.log(`[built] the submitted form redirected to ${new URL(String(withToken)).search}`);
});
