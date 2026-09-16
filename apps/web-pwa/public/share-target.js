/*
 * THE SHARE TARGET — the half of it that has to live in the service worker.
 *
 * A child photographs the page in the gallery app, taps share, and chooses Wobo. The phone then
 * POSTs the picture to us as an ordinary HTML form (`share_target` in the install manifest,
 * apps/web-pwa/vite.config.ts). There is no server in that story: the POST is made by the OS to an
 * address of ours, and the only thing that can answer it is the service worker on the device. So
 * this file answers it, keeps the bytes in the Cache for the moment it takes the app to boot, and
 * sends the learner to the doubt solver, where the photo is read the way a photo from the camera
 * is read (screens/doubt/capture.ts).
 *
 * WHY IT IS A PLAIN SCRIPT AND NOT PART OF THE APP. The generated worker is workbox's
 * (`generateSW`), and workbox imports this file into it (`workbox.importScripts`). That keeps the
 * precache, the navigation fallback and the runtime rules exactly as they were and adds one fetch
 * handler in front of them: ours is registered while the worker's script is evaluating, before
 * workbox registers its router, and it answers ONLY the share POST. Everything else falls through
 * to workbox untouched.
 *
 * WHY EVERYTHING IS READ OFF `self`. A fetch handler that can only be run by a phone is a handler
 * nobody tests. Reading `caches`, `crypto` and `Response` off the worker scope means the whole
 * file can be loaded into a scope of our own making and driven with a real POST
 * (screens/doubt/share-target.test.ts); the built worker then meets a real one in a real browser
 * (tests/share-target.spec.ts).
 *
 * WHAT IT NEVER DOES. It never sends the photo anywhere — the bytes go into the device's own Cache
 * and nowhere else, and the gateway sees them only after the learner has arrived, been screened by
 * the door (LAW 2) and had the reading shown to them (LAW 1). It never tells the learner anything:
 * a share that carried no image redirects to the same doubt route as any other and says nothing
 * about the absence (DESIGN.md §0.x, never narrate).
 */

((self) => {
  /** The address the manifest posts to. Nothing else in the app answers here. */
  const ACTION = '/doubt/shared';
  /** Where the learner lands, with or without a photo. */
  const DOUBT = '/doubt';
  /** The form field the manifest names. */
  const FIELD = 'photo';
  /** The device store the photo waits in, swept below and emptied by the screen that takes it. */
  const SHARE_CACHE = 'wobo-share-v1';
  const SHARE_PATH = '/__wobo-share/';
  /**
   * WHY THERE IS A POINTER AS WELL AS A TOKEN IN THE ADDRESS.
   *
   * The redirect carries `?share=<token>`, which is what the screen reads. But the app's router
   * corrects the address bar on boot (`shell/router.tsx`: one `replaceState` to the route's own
   * path), and on a cold start that happens before the doubt screen is even loaded — so by the
   * time anything can read the query it is gone. The token is therefore ALSO left here, with the
   * moment it was written, and the screen falls back to it when the bar has already been cleaned.
   * It is spent on the first read, whether or not the photo was still there.
   */
  const POINTER = `${SHARE_PATH}latest`;
  /** A share nobody collected is swept on the next one. Ten minutes is a boot on a slow phone. */
  const KEEP_MS = 10 * 60 * 1000;
  const STAMP = 'x-wobo-share-at';
  const NAME = 'x-wobo-share-name';

  const isImage = (value) =>
    !!value &&
    typeof value === 'object' &&
    typeof value.type === 'string' &&
    value.type.indexOf('image/') === 0 &&
    typeof value.size === 'number' &&
    value.size > 0;

  /** The picture out of the form: the field the manifest named, or any image that came instead. */
  const imageIn = (form) => {
    const named = form.get(FIELD);
    if (isImage(named)) return named;
    let found = null;
    form.forEach((value) => {
      if (!found && isImage(value)) found = value;
    });
    return found;
  };

  const token = () => {
    if (self.crypto && typeof self.crypto.randomUUID === 'function') {
      return self.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    self.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, (b) => `0${b.toString(16)}`.slice(-2)).join('');
  };

  /** Drop every share old enough that nobody is coming for it. A photo never lingers here. */
  const sweep = (cache, now) =>
    cache.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.url.indexOf(SHARE_PATH) < 0) return null;
          return cache.match(key).then((held) => {
            const at = held ? Number(held.headers.get(STAMP) || 0) : 0;
            if (at && now - at < KEEP_MS) return null;
            return cache.delete(key);
          });
        }),
      ),
    );

  /** Keep the shared photo under a token of its own, and leave the pointer to it. */
  const keep = (file) => {
    const at = Date.now();
    const id = token();
    return self.caches
      .open(SHARE_CACHE)
      .then((cache) =>
        sweep(cache, at).then(() => {
          const headers = {
            'content-type': file.type || 'image/jpeg',
            [STAMP]: String(at),
            [NAME]: typeof file.name === 'string' ? file.name : 'shared',
          };
          return cache.put(SHARE_PATH + id, new self.Response(file, { headers })).then(() =>
            cache.put(
              POINTER,
              new self.Response(JSON.stringify({ token: id, at }), {
                headers: { 'content-type': 'application/json', [STAMP]: String(at) },
              }),
            ),
          );
        }),
      )
      .then(() => id);
  };

  /**
   * The whole answer to a share: take the photo if there is one, then send the learner to the
   * doubt solver either way. A share we could not read is a share with no photo — the learner is
   * on the capture step with the camera in front of them, which is the honest thing to show and
   * needs no sentence about what did not arrive.
   */
  const receive = (request) => {
    const here = request.url;
    return request
      .formData()
      .then((form) => {
        const file = imageIn(form);
        return file ? keep(file) : null;
      })
      .catch(() => null)
      .then((id) => {
        const to = new URL(DOUBT, here);
        if (id) to.searchParams.set('share', id);
        return self.Response.redirect(to.href, 303);
      });
  };

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request?.method !== 'POST') return;
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return;
    }
    if (url.pathname !== ACTION) return;
    event.respondWith(receive(request));
  });
})(self);
