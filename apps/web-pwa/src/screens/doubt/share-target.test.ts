/**
 * THE SHARE TARGET — a photo that is already taken.
 *
 * A child photographs the page in the gallery app, taps share, and chooses Wobo. The phone POSTs
 * the picture to us as a form, and what they should meet is the doubt solver with the photo
 * already in it: the same reading, the same corrections, the same Explain. Nothing in the tree did
 * this until this file; the OS offers an app as a share target only if its manifest says so, and
 * it delivers the bytes only to a service worker that answers the POST.
 *
 * Three pieces, held here:
 *
 *  1. THE MANIFEST (vite.config.ts) declares `share_target`: POST, multipart/form-data, one file
 *     field that accepts image/*. Without it the app is not in the share sheet at all.
 *  2. THE SERVICE WORKER (public/share-target.js, imported by the generated worker) answers that
 *     POST itself — no server sees it — keeps the file in the Cache under a token, and redirects
 *     to the doubt route. It is driven here in a fake worker scope, which is the only way to prove
 *     a fetch handler without a browser; the built worker meets a real POST in tests/share-target.spec.ts.
 *  3. THE CAPTURE STEP (capture.ts, flow.ts) collects that file on arrival and hands the flow the
 *     SAME `captured` action a camera hands it, so the screen moves straight to the reading, with
 *     the same screening on the way in (`acceptsFile`) and LAW 1 untouched: nothing is computed
 *     until the learner says Explain.
 *
 * And the quiet case, which is a law of its own (DESIGN.md §0.x, never narrate): a share with no
 * image lands on the capture step with NOTHING SAID. No refusal, no "that had no photo", no
 * narration of an absence the learner can see for themselves.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;
const APP = join(HERE, '..', '..', '..');
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');
/** A source with every space taken out: what the code says, not how the formatter wrapped it. */
const packed = (source: string) => source.replace(/\s+/g, '');

const VITE = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
const WORKER = readFileSync(join(APP, 'public', 'share-target.js'), 'utf8');
const SCREEN = read('DoubtScreen.tsx');
const CAPTURE = read('capture.ts');

// --- 1. the manifest, which is what puts Wobo in the share sheet ----------------------------------

describe('the manifest carries the share target', () => {
  const block = VITE.slice(VITE.indexOf('share_target:'), VITE.indexOf('icons:'));

  it('declares it at all, on the install manifest the browser reads', () => {
    expect(VITE).toContain('share_target:');
    expect(block).toBeTruthy();
  });

  it('is a POST of multipart form data, which is the only shape that can carry a file', () => {
    expect(packed(block)).toContain("method:'POST'");
    expect(packed(block)).toContain("enctype:'multipart/form-data'");
  });

  it('accepts images, under the field name the worker reads', () => {
    expect(packed(block)).toContain("name:'photo'");
    expect(packed(block)).toContain("accept:['image/*']");
    expect(packed(WORKER)).toContain("'photo'");
  });

  it('posts to the doubt solver, and the worker answers that same address', () => {
    expect(packed(block)).toContain("action:'/doubt/shared'");
    expect(packed(WORKER)).toContain("'/doubt/shared'");
  });

  it('the generated worker imports the handler, and does not precache it as a page asset', () => {
    expect(packed(VITE)).toContain("importScripts:['/share-target.js']");
    expect(packed(VITE)).toContain("'**/share-target.js'");
  });
});

// --- 2. the worker, driven in a fake scope --------------------------------------------------------

interface Kept {
  url: string;
  body: Uint8Array;
  headers: Headers;
}

/** The Cache API, small enough to reason about and honest about what a put stores. */
class FakeCache {
  readonly entries = new Map<string, { response: Response; body: Uint8Array }>();
  /** The real Cache resolves a relative request against its own base, so this one does too. */
  private at(request: Request | string): string {
    return new URL(typeof request === 'string' ? request : request.url, 'https://wobo.test').href;
  }
  async put(request: Request | string, response: Response): Promise<void> {
    const body = new Uint8Array(await response.clone().arrayBuffer());
    this.entries.set(this.at(request), { response, body });
  }
  async match(request: Request | string): Promise<Response | undefined> {
    const hit = this.entries.get(this.at(request));
    return hit ? hit.response.clone() : undefined;
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string): Promise<boolean> {
    return this.entries.delete(this.at(request));
  }
}

interface Scope {
  cache: FakeCache;
  fetch(request: Request): Promise<Response>;
}

/**
 * Load `public/share-target.js` into a worker scope of our own making. The file is a classic
 * script that reads everything off `self` for exactly this reason: the handler it registers is the
 * whole feature, and a handler that can only be run by a phone is a handler nobody tests.
 */
function workerScope(): Scope {
  const cache = new FakeCache();
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const self = {
    addEventListener(type: string, fn: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    caches: {
      open: async (_name: string) => cache,
    },
    crypto,
    Response,
    Request,
    URL,
    location: new URL('https://wobo.test/sw.js'),
  };
  new Function('self', WORKER)(self);
  return {
    cache,
    fetch(request: Request): Promise<Response> {
      let answered: Promise<Response> | null = null;
      const event = {
        request,
        respondWith(value: Promise<Response> | Response) {
          answered = Promise.resolve(value);
        },
      };
      for (const fn of listeners.get('fetch') ?? []) fn(event);
      // Not ours: the worker left it alone, which is what every other request must meet.
      return answered ?? Promise.resolve(new Response(null, { status: 599 }));
    },
  };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function sharePost(fields: { photo?: File; title?: string; text?: string }): Request {
  const form = new FormData();
  if (fields.photo) form.set('photo', fields.photo);
  if (fields.title) form.set('title', fields.title);
  if (fields.text) form.set('text', fields.text);
  return new Request('https://wobo.test/doubt/shared', { method: 'POST', body: form });
}

const photoFile = () => new File([JPEG], 'page.jpg', { type: 'image/jpeg' });

async function kept(cache: FakeCache): Promise<Kept[]> {
  const out: Kept[] = [];
  for (const [url, entry] of cache.entries) {
    out.push({ url, body: entry.body, headers: entry.response.headers });
  }
  return out;
}

describe('the worker answers the share itself, and nothing leaves the phone', () => {
  it('takes the photo out of the form and redirects to the doubt route with a token', async () => {
    const scope = workerScope();
    const res = await scope.fetch(sharePost({ photo: photoFile(), title: 'Homework' }));
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get('location') ?? '', 'https://wobo.test');
    expect(to.pathname).toBe('/doubt');
    const token = to.searchParams.get('share');
    expect(token).toBeTruthy();
    expect(token).toMatch(/^[0-9a-f-]{8,64}$/i);
  });

  it('keeps the bytes, exactly as they were shared, under that token', async () => {
    const scope = workerScope();
    const res = await scope.fetch(sharePost({ photo: photoFile() }));
    const token = new URL(res.headers.get('location') ?? '', 'https://wobo.test').searchParams.get(
      'share',
    );
    const entries = await kept(scope.cache);
    const photo = entries.find((e) => e.url.includes(String(token)));
    expect(photo).toBeTruthy();
    expect([...(photo?.body ?? [])]).toEqual([...JPEG]);
    expect(photo?.headers.get('content-type')).toBe('image/jpeg');
  });

  it('leaves a pointer to it, because the address bar is cleaned before the screen can read it', async () => {
    const scope = workerScope();
    const res = await scope.fetch(sharePost({ photo: photoFile() }));
    const token = new URL(res.headers.get('location') ?? '', 'https://wobo.test').searchParams.get(
      'share',
    );
    const pointer = await scope.cache.match('https://wobo.test/__wobo-share/latest');
    expect(pointer).toBeTruthy();
    const said = (await pointer?.json()) as { token?: string; at?: number };
    expect(said.token).toBe(String(token));
    expect(said.at).toBeGreaterThan(0);
  });

  it('a share with no image keeps nothing and says nothing: the doubt route, bare', async () => {
    const scope = workerScope();
    const res = await scope.fetch(sharePost({ title: 'Chapter 4', text: 'look at this' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://wobo.test/doubt');
    expect(await kept(scope.cache)).toEqual([]);
  });

  it('a file that is not an image is not a photo, and is treated as no photo at all', async () => {
    const scope = workerScope();
    const form = new FormData();
    form.set('photo', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const res = await scope.fetch(
      new Request('https://wobo.test/doubt/shared', { method: 'POST', body: form }),
    );
    expect(res.headers.get('location')).toBe('https://wobo.test/doubt');
    expect(await kept(scope.cache)).toEqual([]);
  });

  it('answers nothing else: a GET of the same address, and every other request, are not ours', async () => {
    const scope = workerScope();
    const get = await scope.fetch(new Request('https://wobo.test/doubt/shared'));
    expect(get.status).toBe(599);
    const other = await scope.fetch(
      new Request('https://wobo.test/v1/doubt', { method: 'POST', body: '{}' }),
    );
    expect(other.status).toBe(599);
  });

  it('sweeps a share nobody collected, so a photo never lingers on the device', async () => {
    const scope = workerScope();
    const stale = 'https://wobo.test/__wobo-share/00000000-0000-4000-8000-000000000000';
    await scope.cache.put(
      stale,
      new Response(JPEG, {
        headers: {
          'content-type': 'image/jpeg',
          'x-wobo-share-at': String(Date.now() - 3_600_000),
        },
      }),
    );
    await scope.fetch(sharePost({ photo: photoFile() }));
    expect(await scope.cache.match(stale)).toBeUndefined();
  });
});

// --- 3. the capture step, which meets it on the way in --------------------------------------------

const {
  forgetShares,
  SHARE_ARRIVAL_MS,
  SHARE_CACHE,
  SHARE_PARAM,
  SHARE_POINTER,
  shareTokenFrom,
  sharedCapture,
  takeSharedFile,
} = await import('./capture');
const { initialFlow, reduce, shared } = await import('./flow');

/** A Cache Storage stand-in for the page's side of the same store. */
function stubCaches(cache: FakeCache): void {
  (globalThis as { caches?: unknown }).caches = {
    open: async (name: string) => {
      expect(name).toBe(SHARE_CACHE);
      return cache;
    },
    delete: async (name: string) => {
      expect(name).toBe(SHARE_CACHE);
      const had = cache.entries.size > 0;
      cache.entries.clear();
      return had;
    },
  };
}

describe('the token the worker handed over', () => {
  it('is read off the address the share landed on', () => {
    expect(shareTokenFrom(`https://wobo.test/doubt?${SHARE_PARAM}=abc12345`)).toBe('abc12345');
  });

  it('is nothing at all on an ordinary visit to the doubt solver', () => {
    expect(shareTokenFrom('https://wobo.test/doubt')).toBeNull();
  });

  it('never addresses anything but a share: a crafted token is refused, not resolved', () => {
    for (const crafted of ['../../sw.js', 'a/b', '', 'x'.repeat(200), 'no spaces here']) {
      expect(
        shareTokenFrom(`https://wobo.test/doubt?${SHARE_PARAM}=${encodeURIComponent(crafted)}`),
      ).toBeNull();
    }
  });
});

describe('the photo is handed over, not kept', () => {
  const token = '11111111-2222-4333-8444-555555555555';
  const put = async (cache: FakeCache, at = Date.now()) => {
    await cache.put(
      `https://wobo.test/__wobo-share/${token}`,
      new Response(JPEG, {
        headers: {
          'content-type': 'image/jpeg',
          'x-wobo-share-at': String(at),
          'x-wobo-share-name': 'page.jpg',
        },
      }),
    );
    await cache.put(
      `https://wobo.test${SHARE_POINTER}`,
      new Response(JSON.stringify({ token, at }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  it('collects the shared file by its token, as a file the picker could have handed us', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await put(cache);
    const file = await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`);
    expect(file).toBeTruthy();
    expect(file?.type).toBe('image/jpeg');
    expect(file?.size).toBe(JPEG.length);
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(JPEG);
  });

  it('takes it ONCE: the bytes leave the device store the moment the screen has them', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await put(cache);
    await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`);
    expect(cache.entries.size).toBe(0);
    expect(await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`)).toBeNull();
  });

  it('finds it through the pointer when the address has already been cleaned', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await put(cache);
    const file = await takeSharedFile('https://wobo.test/doubt');
    expect(file?.size).toBe(JPEG.length);
    expect(cache.entries.size).toBe(0);
  });

  it('ignores a share from another sitting: an old pointer is dropped, never opened', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await put(cache, Date.now() - 20 * 60 * 1000);
    expect(await takeSharedFile('https://wobo.test/doubt')).toBeNull();
    expect(cache.entries.size).toBe(0);
  });

  /**
   * THE SIBLING ON THE FAMILY TABLET, which is the defect this rule closes.
   *
   * `wobo-share-v1` is a Cache of the ORIGIN: it is keyed to nobody, and every learner on one
   * device opens the same one. The pointer used to be honoured for ten whole minutes with no
   * question about WHOSE ten minutes they were, and the doubt screen reads it on every mount, not
   * only on a share arrival. So: one child shares their homework and is called away; within ten
   * minutes a sibling taps the doubt button; the sibling's solver opened with the first child's
   * photo already read, and their Explain would have sent it to the gateway under their account.
   *
   * A share is stamped by the worker while it answers the phone's POST, which is a moment BEFORE
   * the redirect creates this document. So a stamp older than this page load's own beginning was
   * written for a sitting that has already ended, and it is dropped. Two minutes is well inside
   * the ten minute window the old rule allowed, and it is another page load's share.
   */
  it('never hands a share to a later page load: a pointer older than this document is dropped', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    const anotherSitting = performance.timeOrigin - 2 * SHARE_ARRIVAL_MS;
    // still young by the worker's own ten minute sweep, and still not this arrival's
    expect(Date.now() - anotherSitting).toBeLessThan(10 * 60 * 1000);
    await put(cache, anotherSitting);
    expect(await takeSharedFile('https://wobo.test/doubt')).toBeNull();
    // and it does not merely go unread: it leaves the device rather than waiting for the next mount
    expect(cache.entries.size).toBe(0);
  });

  it('will not open one through the address either, however the token got there', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await put(cache, performance.timeOrigin - 2 * SHARE_ARRIVAL_MS);
    expect(await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`)).toBeNull();
    expect(cache.entries.size).toBe(0);
  });

  it('opens this arrival’s own share, stamped the moment before the document began', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    // what the worker actually writes: a stamp a few hundred milliseconds before the redirect lands
    await put(cache, performance.timeOrigin - 400);
    const file = await takeSharedFile('https://wobo.test/doubt');
    expect(file?.size).toBe(JPEG.length);
  });

  it('refuses an entry the worker never stamped: it is not something we put there', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await cache.put(
      `https://wobo.test/__wobo-share/${token}`,
      new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }),
    );
    await cache.put(
      `https://wobo.test${SHARE_POINTER}`,
      new Response(JSON.stringify({ token, at: Date.now() }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await takeSharedFile('https://wobo.test/doubt')).toBeNull();
    expect(cache.entries.size).toBe(0);
  });
});

/**
 * LAW 2, AND THE HALF OF IT THAT WAS MISSING.
 *
 * "No photo travels before the door is the camera" was kept: with an anonymous session the screen
 * returned without calling the gateway. What it also did was RETURN WITHOUT TOUCHING THE STORE, so
 * the photo sat in an origin-level Cache for ten minutes with the sign-in card on the screen —
 * which is the worst case of all, because the very next thing that happens is somebody signing in,
 * and it does not have to be the same somebody.
 */
describe('a share met by the sign-in card is dropped, not kept for whoever signs in next', () => {
  const token = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';

  it('empties the whole store and hands back nothing, on the arrival itself', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await cache.put(
      `https://wobo.test/__wobo-share/${token}`,
      new Response(JPEG, {
        headers: { 'content-type': 'image/jpeg', 'x-wobo-share-at': String(Date.now()) },
      }),
    );
    await cache.put(
      `https://wobo.test${SHARE_POINTER}`,
      new Response(JSON.stringify({ token, at: Date.now() }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const file = await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`, 'sign-in');
    expect(file).toBeNull();
    expect(cache.entries.size).toBe(0);
    // and nothing is left for a second look, however the next visitor arrives
    expect(await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`)).toBeNull();
  });

  it('takes an orphan with it: a photo whose pointer was already spent goes too', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await cache.put(
      `https://wobo.test/__wobo-share/${token}`,
      new Response(JPEG, {
        headers: { 'content-type': 'image/jpeg', 'x-wobo-share-at': String(Date.now()) },
      }),
    );
    await takeSharedFile('https://wobo.test/doubt', 'sign-in');
    expect(cache.entries.size).toBe(0);
  });

  it('`forgetShares` is the sweep, and it says nothing where there is no Cache at all', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    await cache.put(`https://wobo.test${SHARE_POINTER}`, new Response('{}'));
    await forgetShares();
    expect(cache.entries.size).toBe(0);
    (globalThis as { caches?: unknown }).caches = undefined;
    expect(await forgetShares()).toBeUndefined();
  });

  it('is nothing on an ordinary visit, and nothing where there is no cache at all', async () => {
    const cache = new FakeCache();
    stubCaches(cache);
    expect(await takeSharedFile('https://wobo.test/doubt')).toBeNull();
    (globalThis as { caches?: unknown }).caches = undefined;
    expect(await takeSharedFile(`https://wobo.test/doubt?${SHARE_PARAM}=${token}`)).toBeNull();
  });
});

describe('the flow takes a shared photo exactly as it takes a captured one', () => {
  const capture = { data: 'AAAA', mediaType: 'image/jpeg', width: 1200, height: 1600 };

  it('is the same action, so the screen moves straight to the reading', () => {
    const action = shared(capture);
    expect(action).toEqual({ type: 'captured', capture });
    expect(reduce(initialFlow, action as never)).toEqual(
      reduce(initialFlow, { type: 'captured', capture }),
    );
    expect(reduce(initialFlow, action as never).phase).toBe('reading');
  });

  it('a share with no photo is not an event: the capture step stands, with nothing said', () => {
    expect(shared(null)).toBeNull();
    // and the state a learner meets is the untouched capture step — no refusal to read
    expect(initialFlow.phase).toBe('capture');
    expect(initialFlow.error).toBeNull();
  });
});

describe('the screen collects it on arrival', () => {
  it('looks for a shared photo when no camera handed it one', () => {
    expect(SCREEN).toContain('sharedCapture');
    expect(SCREEN).toContain('shared(');
  });

  it('hands the door to the collector instead of walking away from the store', () => {
    // LAW 2: the gateway keeps a photo against an account and refuses an anonymous session, so a
    // shared photo is neither collected nor read until the door is the camera. The door rides IN
    // now rather than gating the call, because a closed door must empty the store, not leave it.
    const effect = SCREEN.slice(SCREEN.lastIndexOf('sharedCapture') - 500);
    expect(packed(effect)).toContain('sharedCapture(window.location.href,doorFor(sdk.account))');
    // the early return that left one learner's photo on the device for the next is gone
    expect(packed(SCREEN)).not.toContain("if(doorFor(sdk.account)!=='camera')return;");
  });

  /**
   * THE DEFECT THIS PINS, because no reasoning found it and a browser did.
   *
   * React mounts an effect, tears it down and mounts it again (StrictMode, src/main.tsx). The first
   * version of this collected the share behind a ref so the Cache was emptied once — and it was, by
   * the run whose teardown had already cancelled its own result. The second run met the ref and
   * returned; the photo landed with nobody listening. The learner sat on the capture step with the
   * photo already taken off their device. `tests/share-arrival.spec.ts` failed on exactly that and
   * is the regression proof; this is the unit that says what the rule now is.
   */
  it('reads the device store once a page load, so a remount cannot lose the photo', async () => {
    stubCaches(new FakeCache());
    const first = sharedCapture('https://wobo.test/doubt');
    const second = sharedCapture('https://wobo.test/doubt');
    expect(second).toBe(first); // the same read, not a second one
    expect(await first).toBeNull();
  });

  it('never cancels the photo on teardown: nothing in the effect drops a capture it has taken', () => {
    const effect = SCREEN.slice(SCREEN.lastIndexOf('sharedCapture') - 400);
    // the read is held by capture.ts, so the screen keeps no ref of its own to guard it with
    expect(effect).not.toContain('collected.current');
  });

  it('screens a shared photo the way it screens a captured one', () => {
    // one door into the bytes for both: `captureFromFile` refuses what is not a photo and what is
    // too big, in a line the learner can read
    expect(CAPTURE).toContain('export async function captureFromFile');
    expect(SCREEN).toContain('CaptureRefused');
  });
});
