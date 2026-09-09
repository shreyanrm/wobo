/**
 * Keep a glass read true while the glass is held (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze): a
 * resize or a theme flip re-measures the same ids in place. Nothing is walked again, nothing is
 * renamed; the boxes are read off the handles the read kept.
 *
 * The window, the media query and the attribute observer are injectable so the rule runs in a
 * plain test; in the app they default to `window`, `prefers-color-scheme` and a MutationObserver on
 * the root's `data-theme`.
 */

import type { GlassMap } from './map';
import type { GlassRead } from './read';

interface Listens {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface WatchGlassOptions {
  target?: Listens | null;
  /** The dark/light media query, or null for none. */
  media?: Listens | null;
  /** Subscribe to the theme attribute changing on the root; returns the unsubscribe. */
  observeTheme?: ((listener: () => void) => () => void) | null;
  onChange?: (map: GlassMap) => void;
}

function defaultMedia(): Listens | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function defaultObserveTheme(listener: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** Watch a read. Returns the stop. */
export function watchGlass(read: GlassRead, options: WatchGlassOptions = {}): () => void {
  const target =
    options.target === undefined
      ? typeof window === 'undefined'
        ? null
        : (window as unknown as Listens)
      : options.target;
  const media = options.media === undefined ? defaultMedia() : options.media;
  const observe = options.observeTheme === undefined ? defaultObserveTheme : options.observeTheme;
  const measure = () => {
    const map = read.remeasure();
    options.onChange?.(map);
  };
  target?.addEventListener('resize', measure);
  media?.addEventListener('change', measure);
  const stopAttribute = observe ? observe(measure) : () => {};
  return () => {
    target?.removeEventListener('resize', measure);
    media?.removeEventListener('change', measure);
    stopAttribute();
  };
}
