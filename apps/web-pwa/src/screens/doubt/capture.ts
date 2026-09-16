/**
 * A photo from the camera or the file picker, made small and upright before it leaves the device.
 *
 * Two reasons, both the learner's: a 12 MB HEIC off a phone camera is a minute on a 2G link and
 * the brain reads a 1600 px page as well as a 4000 px one; and the fewer pixels leave the phone,
 * the less of a bedroom or a sibling goes with them. EXIF orientation is honoured by the decoder
 * (`createImageBitmap` with `imageOrientation: 'from-image'`), so what the brain reads is what the
 * learner saw through the viewfinder — and the region boxes it returns are in that upright frame.
 */

import type { Capture } from './api';

/** The longest edge that leaves the device. */
export const MAX_EDGE = 1600;
/** Bigger than this is a scan, and a scan should come one page at a time. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const JPEG_QUALITY = 0.86;

/** The size a `w × h` image takes when its longest edge is held to `max`. Never upscaled. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export class CaptureRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureRefused';
  }
}

/** Is this something a camera or a picker could hand us as a page? */
export function acceptsFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!file.type.startsWith('image/'))
    return 'That is not a photo. A picture of the page works best.';
  if (file.size > MAX_FILE_BYTES)
    return 'That photo is bigger than I can read. Try one page at a time.';
  return null;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // HEIC on a browser that cannot decode it, or an option it does not know: fall through
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new CaptureRefused('I could not open that photo. Try another?'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode, downscale, re-encode as JPEG. Throws `CaptureRefused` with a line the learner can read. */
export async function captureFromFile(file: File): Promise<Capture> {
  const refusal = acceptsFile(file);
  if (refusal) throw new CaptureRefused(refusal);
  const source = await decode(file);
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const size = fitWithin(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CaptureRefused('I could not open that photo. Try another?');
  ctx.drawImage(source, 0, 0, size.width, size.height);
  if ('close' in source) source.close();
  const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return {
    data: url.slice(url.indexOf(',') + 1),
    mediaType: 'image/jpeg',
    width: size.width,
    height: size.height,
  };
}

/** A data URL for an <img>, from a capture. */
export function captureUrl(capture: Pick<Capture, 'data' | 'mediaType'>): string {
  return `data:${capture.mediaType};base64,${capture.data}`;
}

// --- the photo that was already taken (the share target) -------------------------------------------

/**
 * THE OTHER WAY A PHOTO ARRIVES: the phone's own share sheet.
 *
 * A child photographs the page in the gallery app, taps share, and chooses Wobo. The OS POSTs the
 * picture to `/doubt/shared` (the manifest's `share_target`, vite.config.ts); the service worker
 * answers that POST itself, puts the bytes in the device's Cache under a token, and redirects to
 * the doubt route (public/share-target.js). This is the page's side of that handover: it collects
 * the file ONCE, the way `takeCapture` hands over a photo from the entry control, and everything
 * after it is the ordinary path — `captureFromFile` screens it, downscales it and turns it upright,
 * and the flow takes the same `captured` action the camera hands it.
 *
 * The bytes leave this store the moment the screen has them. The Cache is the only place on the
 * device a photo is ever written (doubt-store.ts keeps none), and it is written by the worker for
 * the seconds it takes the app to boot, swept on the next share, and emptied here on arrival.
 *
 * AND IT BELONGS TO THE ARRIVAL THAT CARRIED IT, TO NOTHING ELSE (the fixer, 2026-09-16).
 *
 * `wobo-share-v1` is a Cache of the ORIGIN. It is not keyed to anybody, no key walk reaches it,
 * and every learner on a family tablet opens the same one. The first version of this file took
 * that as a fact of life and bounded the exposure at ten minutes; the honest reading of the same
 * fact is the question a store reviewer asks, "is any learner's data written where another
 * learner could read it", and the answer was yes three times over:
 *
 *  1. THE POINTER WAS READ ON EVERY VISIT, not only on a share arrival. The doubt screen collects
 *     on every mount, so any learner who opened the solver within ten minutes of ANY share on that
 *     device was handed it. One child shares their homework, is called away; a sibling taps the
 *     doubt button; the sibling's solver opens with the first child's photo in it, and Explain
 *     sends that photo to the gateway under the sibling's account.
 *  2. A SHARE THAT ARRIVED AT A CLOSED DOOR WAS LEFT BEHIND for whoever opened the app next. With
 *     nobody signed in the screen returned without touching the store, which kept LAW 2 (no photo
 *     travels) and broke the bigger rule it exists for, because the photo then sat there waiting.
 *  3. NO ERASE REACHED IT. `wipeDevice` walks localStorage and sessionStorage; Cache Storage is
 *     not a Storage, so "erase everything" left the photo on the phone.
 *
 * So the rule is now one sentence, and the three holes are three halves of it: **a shared photo
 * belongs to the page load the share redirect opened, and it leaves the device on that page load
 * whether or not anybody is allowed to read it.** `isThisArrival` is the first half (a pointer
 * written before this document began is another sitting's, and is deleted rather than opened),
 * the `door` argument is the second (a closed door empties the store instead of leaving it), and
 * `wipeDeviceCaches` in store/scope.ts is the third (every `wobo-` Cache goes with a sign-out and
 * with an erase). The boundary that matters is the hand-over, and the product makes that one a
 * full navigation unconditionally: `handOverDevice` ends with `location.assign('/')`
 * (`store/sign-out.ts`), so the next learner on a family tablet is always reading a fresh module
 * and a fresh memo, never this page load's.
 */
export const SHARE_CACHE = 'wobo-share-v1';
export const SHARE_PATH = '/__wobo-share/';
/** The query the worker's redirect carries. */
export const SHARE_PARAM = 'share';
/**
 * Where the worker also leaves the token, and why that is not belt and braces.
 *
 * The app's router corrects the address bar on boot — one `replaceState` to the route's own path
 * (shell/router.tsx) — and on a cold arrival that happens before the doubt screen has even
 * downloaded, so the `?share=` the redirect carried is gone by the time anything can read it. The
 * pointer is how the photo survives our own tidy-up. It is spent on the first read.
 */
export const SHARE_POINTER = `${SHARE_PATH}latest`;
/** A pointer older than this belongs to another sitting, and is dropped rather than opened. */
export const SHARE_POINTER_MS = 10 * 60 * 1000;
/**
 * HOW LONG BEFORE THIS PAGE LOAD A SHARE MAY HAVE BEEN WRITTEN AND STILL BE THIS ARRIVAL'S.
 *
 * The worker stamps the share while it is answering the OS's POST, and the answer to that POST is
 * the redirect the browser then follows to get here. So on a real arrival the stamp is written a
 * moment BEFORE this document exists, and `performance.timeOrigin` is the first instant that could
 * possibly come after it. Anything stamped earlier than that — by a whole page load, by a sign-in
 * navigation, by a sibling being handed the tablet — was written for a sitting that has already
 * ended, and is another learner's until proven otherwise.
 *
 * The window is a minute because the interval it covers is a redirect, a navigation and a document
 * being created on a cheap phone on a slow link, not a learner's attention span. It replaces the
 * ten minute one as the rule that decides whether a share may be OPENED; ten minutes remains the
 * outer bound the worker sweeps on, so a share nobody ever came for still does not linger.
 */
export const SHARE_ARRIVAL_MS = 60 * 1000;
/** What the worker stamped the share with. */
const SHARE_STAMP = 'x-wobo-share-at';
const SHARE_NAME = 'x-wobo-share-name';

/**
 * Which door the learner is meeting (`doorFor`, flow.ts). It rides all the way in here because
 * what a closed door means for a photo is not "leave it" but "let it go".
 */
export type ShareDoor = 'camera' | 'sign-in';

/** When this document began: the clock the arrival rule is measured against. */
function pageOpenedAt(): number {
  try {
    return typeof performance === 'undefined' ? Date.now() : performance.timeOrigin;
  } catch {
    return Date.now();
  }
}

/**
 * Was this stamped for THIS page load, or for a sitting that ended before it began?
 *
 * An unstamped entry answers no: the worker stamps everything it writes, so something without one
 * is not something we put there.
 */
function isThisArrival(at: number): boolean {
  if (!at || !Number.isFinite(at)) return false;
  const now = Date.now();
  if (at > now + SHARE_ARRIVAL_MS) return false; // a clock that ran forward; not this arrival
  return at >= pageOpenedAt() - SHARE_ARRIVAL_MS && now - at < SHARE_POINTER_MS;
}

/**
 * EVERY SHARE THIS DEVICE IS HOLDING, GONE.
 *
 * The whole Cache rather than one key, because that is the only sweep that is true whatever state
 * the store was left in: the pointer, the photo it points at, and any photo whose pointer was
 * already spent. It is what a closed door does with a share, and `store/scope.ts` does the same to
 * every `wobo-` Cache on a sign-out and on an erase.
 */
export async function forgetShares(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await caches.delete(SHARE_CACHE);
  } catch {
    // site data switched off, or a browser with no Cache at all: there is nothing to forget
  }
}

/**
 * The token on this address, if it is one of ours.
 *
 * Validated rather than trusted: the token becomes a key in the Cache, so a crafted value is how
 * `?share=../../sw.js` would read something that is not a share at all. Letters, digits, dash and
 * underscore only — which is what `crypto.randomUUID` produces — and a length a token has.
 */
export function shareTokenFrom(href: string): string | null {
  let value: string | null = null;
  try {
    value = new URL(href, 'https://wobo.invalid').searchParams.get(SHARE_PARAM);
  } catch {
    return null;
  }
  if (!value) return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

async function shareStore(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(SHARE_CACHE);
  } catch {
    // site data switched off, or a browser with no Cache at all: there is simply no share to take
    return null;
  }
}

/** The token the worker left behind, spent on reading, and only while it is this sitting's. */
async function pointedTo(store: Cache): Promise<string | null> {
  let token: string | null = null;
  try {
    const held = await store.match(SHARE_POINTER);
    if (held) {
      const said = (await held.json()) as { token?: unknown; at?: unknown };
      const at = typeof said.at === 'number' ? said.at : 0;
      const raw = typeof said.token === 'string' ? said.token : '';
      if (raw && isThisArrival(at)) {
        token = /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
      } else if (raw) {
        // Another sitting's share. It is not opened, and it does not stay on the device either.
        await store.delete(`${SHARE_PATH}${raw}`).catch(() => false);
      }
    }
  } catch {
    token = null;
  }
  await store.delete(SHARE_POINTER).catch(() => false);
  return token;
}

/**
 * THE PICKUP IS READ ONCE PER PAGE LOAD, AND WHOEVER IS LISTENING GETS IT.
 *
 * This is a memo rather than a flag, and it is the fix for a photo that went missing. The screen
 * collects the share in an effect, and React mounts an effect, tears it down and mounts it again
 * (StrictMode, src/main.tsx). The first version guarded the read with a ref so the Cache was only
 * emptied once — which it was, by the run whose teardown had already cancelled its own result. The
 * second run met the guard and returned, the promise landed with nobody listening, and the learner
 * sat on the capture step with their photo already taken off the device. The browser lab caught it
 * (tests/share-arrival.spec.ts) and no unit test could have: it is a fact about how React mounts.
 *
 * Holding the PROMISE means the Cache is still read exactly once, and every mount — the one that
 * was torn down, the one that replaced it, and any later visit to the doubt screen in this same
 * page load — awaits the same answer. The photo cannot be consumed by a listener that is no longer
 * there, because the value stays here until somebody takes it.
 *
 * AND A SECOND LEARNER NEVER READS THIS MEMO, which is what makes holding it safe.
 *
 * The only way one learner replaces another on a device is the hand-over, and `handOverDevice`
 * ends with `location.assign('/')` in every build (`store/sign-out.ts`), so whoever comes next
 * gets a fresh module. The other direction — an anonymous learner signing in, which under dev auth
 * can happen without leaving the page (`screens/auth/run.ts` `landingAfterDoor` may `stay`) — is
 * the SAME person on both sides of the door, and it is the one case where data legitimately
 * crosses (docs/ONE-LEARNER-ONE-WOBO.md, rule 4). It is safe in this direction too: a first mount
 * that met the sign-in card has already emptied the store and left a memo that resolves to null,
 * so signing in yields nothing rather than yielding somebody else's photo.
 */
let pickup: Promise<Capture | null> | null = null;

/**
 * The shared photo as a capture, screened and upright, or null on an ordinary visit.
 *
 * `door` is not an optimisation. With the door shut the store is EMPTIED rather than left, so a
 * photo shared while nobody is signed in cannot be waiting for whoever signs in next.
 */
export function sharedCapture(href: string, door: ShareDoor = 'camera'): Promise<Capture | null> {
  pickup ??= takeSharedFile(href, door).then((file) => (file ? captureFromFile(file) : null));
  return pickup;
}

/**
 * The shared photo, as a file the picker could have handed us — or null, which is the ordinary
 * case and says nothing to anybody.
 */
export async function takeSharedFile(
  href: string,
  door: ShareDoor = 'camera',
): Promise<File | null> {
  /*
   * LAW 2, AND THE HALF OF IT THAT WAS MISSING. The gateway keeps a photo against an account and
   * answers an anonymous session with 403, so no photo may travel before the door is the camera —
   * that half was always kept. What was not: a share met by the sign-in card used to be LEFT on
   * the device, where the next learner to sign in on that tablet collected it. A share is a thing
   * one learner did, and a learner who is not here cannot be asked; so it goes.
   */
  if (door !== 'camera') {
    await forgetShares();
    return null;
  }
  const store = await shareStore();
  if (!store) return null;
  const fromAddress = shareTokenFrom(href);
  // The pointer is read (and spent) either way: a share collected through the address must not
  // leave a token behind for the next visit to trip over.
  const pointed = await pointedTo(store);
  const token = fromAddress ?? pointed;
  if (!token) return null;
  const key = `${SHARE_PATH}${token}`;
  try {
    const held = await store.match(key);
    await store.delete(key).catch(() => false);
    if (!held) return null;
    const bytes = await held.blob();
    if (bytes.size === 0) return null;
    const type = held.headers.get('content-type') || bytes.type || 'image/jpeg';
    const name = held.headers.get(SHARE_NAME) || 'shared.jpg';
    const at = Number(held.headers.get(SHARE_STAMP) || 0);
    // A share that is not THIS arrival's is taken off the device and never opened: it was written
    // for a sitting that ended before this page load began, and whoever is here now is not
    // necessarily whoever shared it. The bytes are already deleted above either way.
    if (!isThisArrival(at)) return null;
    return new File([bytes], name, { type });
  } catch {
    return null;
  }
}
