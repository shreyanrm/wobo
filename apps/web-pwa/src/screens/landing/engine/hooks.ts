'use client';

/**
 * The React surface of the engine: one hook, which mounts the page's motion and — this is the whole
 * point — takes all of it back down again.
 *
 * The landing page is one route inside an app. Everything started here is scoped and reversible:
 * ScrollTrigger's triggers are killed, Lenis is destroyed, the ticker callback is removed, and
 * `data-motion` comes off the page root. A mount/unmount cycle leaves the document as it found it.
 *
 * Reduced motion takes the other path entirely — no Lenis, no triggers, no timelines. Everything is
 * placed at its settled state once, and `data-motion="reduce"` on the root lets the stylesheet lay
 * out the pinned panel and the film as ordinary stacked content.
 */

import { type RefObject, useEffect } from 'react';
import { type Disposer, disposeAll, prefersReducedMotion } from './env';
import {
  mountClimb,
  mountFilm,
  mountFloats,
  mountForms,
  mountGap,
  mountHeroLesson,
  mountHighlights,
  mountMastery,
  mountReport,
  mountReveals,
  settleStill,
} from './motion';
import { registerScrollTrigger, startScroll } from './scroll';

export interface LandingMotionRefs {
  /** The page root. Every selector in the engine is scoped to it. */
  root: RefObject<HTMLElement | null>;
  /** The hero section, which the two floating objects drift against. */
  hero: RefObject<HTMLElement | null>;
}

/**
 * Mount the whole page's motion.
 *
 * The order matters in one place only: `startScroll` must come before the triggers, because Lenis
 * and ScrollTrigger have to share a clock before anything is measured against it.
 */
export function useLandingMotion({ root: rootRef, hero: heroRef }: LandingMotionRefs): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    registerScrollTrigger();

    const reduced = prefersReducedMotion();
    root.setAttribute('data-motion', reduced ? 'reduce' : 'on');
    if (reduced) {
      settleStill(root);
      return () => root.removeAttribute('data-motion');
    }

    const scroll = startScroll();
    const disposers: Disposer[] = [
      mountReveals(root),
      mountHighlights(root),
      mountHeroLesson(root),
      mountFloats(root, heroRef.current),
      mountForms(root),
      mountGap(root),
      mountFilm(root),
      mountMastery(root),
      mountClimb(root),
      mountReport(root),
    ];

    // Measure once the first frame has laid out, or the pin starts from a stale height.
    const measure = requestAnimationFrame(() => scroll.refresh());

    return () => {
      cancelAnimationFrame(measure);
      disposeAll(disposers);
      scroll.destroy();
      root.removeAttribute('data-motion');
    };
  }, [rootRef, heroRef]);
}
