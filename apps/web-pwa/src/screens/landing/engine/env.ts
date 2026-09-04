/**
 * The engine's shared ground: the two easing primitives every module in here uses, and the three
 * questions the whole landing choreography is gated on — is motion allowed, is there a real
 * pointer, is the page in its night theme.
 *
 * Everything here is safe to call where there is no `window` (the build's type-check, a unit test,
 * a server render). Nothing here touches the DOM beyond reading, and every reader has a defined
 * answer when the browser is missing: no motion, no pointer, white paper. That is the quiet
 * fallback — the page renders, it simply does not perform.
 */

/** Frame-rate-independent enough for a 60 Hz page, and the exact form the prototype used. */
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Clamp to [0,1]. A NaN measurement reads as "not started" rather than poisoning a transform. */
export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A disposer. Every mount in this engine returns one, and returning one is the whole contract. */
export type Disposer = () => void;

/** Run every disposer, in reverse order of registration, and swallow nothing. */
export function disposeAll(disposers: Disposer[]): void {
  for (let i = disposers.length - 1; i >= 0; i--) {
    const dispose = disposers[i];
    if (dispose) dispose();
  }
  disposers.length = 0;
}

/** A media query, answered `false` where `matchMedia` does not exist. */
export function media(query: string, win: Window | undefined = safeWindow()): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false;
  try {
    return win.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** The window, or undefined outside a browser. */
export function safeWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/**
 * The off-switch. Every timeline, every loop and both canvases in this engine ask this first, and
 * a learner who asked for less motion gets a page that is laid out, legible and still.
 */
export function prefersReducedMotion(win?: Window): boolean {
  return media('(prefers-reduced-motion: reduce)', win ?? safeWindow());
}

/** A mouse or a hovering pen. The magnetic controls reach only for this pointer. */
export function finePointer(win?: Window): boolean {
  return media('(pointer: fine)', win ?? safeWindow());
}

/** True while the page wears its night theme. */
export function isDark(doc: Document | undefined = safeDocument()): boolean {
  return doc?.documentElement.getAttribute('data-theme') === 'dark';
}

/** The document, or undefined outside a browser. */
export function safeDocument(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document;
}
