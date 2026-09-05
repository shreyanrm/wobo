/**
 * The page's motion, mounted piece by piece.
 *
 * Everything here is scoped to a root element rather than to the document, because this page is one
 * route inside an app and a global selector would reach into whatever else is mounted. Every mount
 * returns a disposer; a route change kills the lot.
 *
 * LAW v5 §8 — THE THREE CAUSES OF JITTER, and how each is avoided here:
 *
 *  1. A CSS TRANSITION ON A PROPERTY GSAP IS SCRUBBING. One owner per property. Nothing this module
 *     animates carries a transition in `page-styles.ts`: the answer cards' opacity, the film track's
 *     scaleX, the bubbles' opacity and y, the reveals' transform — all GSAP's alone. The magnetic
 *     button's inner span is the mirror of the same rule: the rAF lerp owns its transform, and the
 *     stylesheet leaves it alone.
 *  2. SCRUBBING A LAYOUT PROPERTY. Every scrubbed value below is a transform or an opacity. The two
 *     places a geometric value moves — the report's bars and the drawn strokes' dash offsets — are
 *     fired ONCE on entry, not scrubbed, which is what makes them safe.
 *  3. A TWEEN CREATED PER SCROLL FRAME. The one `onUpdate` on the page compares the card it would
 *     show against the card it is showing and returns when they match, so a tween is made on a
 *     change of state and never on a frame.
 *
 * The values are `design/prototypes/landing-v8.html`'s, to the digit.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  CHART_BASELINE,
  CLIMB_START,
  cardIndex,
  countAt,
  FILM_END,
  FILM_START,
  FORMS_END,
  floatDrift,
  GAP_START,
  HERO_DELAY,
  HIGHLIGHT_START,
  MASTERY_START,
  REPORT_START,
  REVEAL_START,
  SCRUB,
  SPARK_MIN,
  SPARK_SPREAD,
  SPARKS,
  sparkVector,
} from './choreography';
import type { Disposer } from './env';

/**
 * ScrollTrigger's default `pinType` is `'fixed'`, which holds a section still by switching it to
 * `position: fixed`. The app wraps every screen in an element carrying `will-change: transform`,
 * and that hint alone makes the wrapper the containing block for every fixed descendant — so a
 * "fixed" pin resolves against the page rather than the viewport and simply scrolls away.
 * `'transform'` pins by translating instead, which needs no containing block and is correct inside
 * any transformed ancestor.
 */
const PIN_TYPE = 'transform' as const;

/** Query inside a root, always as an array. */
function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Measure a path and publish its length as `--len`, which is what `.draw` dashes against. */
export function measureDraw(path: SVGPathElement | null): number {
  if (!path || typeof path.getTotalLength !== 'function') return 0;
  const length = path.getTotalLength();
  path.style.setProperty('--len', String(length));
  return length;
}

/** Everything a mount hands back, so the caller can take it down without knowing what it made. */
function killer(tweens: gsap.core.Animation[], triggers: ScrollTrigger[]): Disposer {
  return () => {
    for (const tween of tweens) {
      tween.scrollTrigger?.kill();
      // REVERT, not just kill. A killed tween leaves its target wherever it had got to, so a
      // reveal killed before it ran left the element at opacity 0 for the next mount to inherit
      // as its resting state. Reverting puts the element back the way the markup had it.
      if (typeof (tween as { revert?: () => void }).revert === 'function') {
        (tween as { revert: () => void }).revert();
      }
      tween.kill();
    }
    for (const trigger of triggers) trigger.kill();
  };
}

// --- Arrival -----------------------------------------------------------------------------------

/**
 * Everything marked `.reveal` lifts into place as it crosses the trigger line.
 *
 * `fromTo` WITH AN EXPLICIT DESTINATION, and that is a bug fix rather than a style choice.
 *
 * This was `gsap.from`, whose destination is whatever the element's CURRENT value happens to be
 * when the tween is built. That is fine exactly once. It is not fine if a previous tween was
 * killed while it held the start value, or if the effect mounts a second time, because then the
 * element is sitting at `opacity: 0` when the new tween reads it, the new tween's destination
 * becomes 0, and it animates faithfully from nothing to nothing. Every one of the page's 61
 * reveals was invisible on load, headline included, with `will-change: auto` in the inline style
 * proving the tween had run to completion and completed at zero.
 *
 * `fromTo` names both ends, so it cannot inherit a broken destination however it is remounted, and
 * the disposer now reverts rather than only killing, so nothing is left holding a start value for
 * the next mount to read.
 *
 * The original reason for `from` still holds and is preserved: nothing in CSS hides a `.reveal`, so
 * a page whose engine never loads reads correctly rather than blank. Only a tween that actually
 * runs ever sets opacity to 0, and it sets it back.
 */
export function mountReveals(root: ParentNode): Disposer {
  const tweens = all<HTMLElement>(root, '.reveal').map((el) =>
    gsap.fromTo(
      el,
      { y: 24, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.75,
        ease: 'power3.out',
        immediateRender: false,
        scrollTrigger: { trigger: el, start: REVEAL_START, once: true },
        onStart() {
          el.style.willChange = 'transform, opacity';
        },
        onComplete() {
          el.style.willChange = 'auto';
          // Hand the element back to the stylesheet rather than leaving it pinned to the values
          // this tween happened to end on.
          gsap.set(el, { clearProps: 'transform,opacity,willChange' });
        },
      },
    ),
  );
  return killer(tweens, []);
}

/** The marigold highlighter sweeps under the second half of a headline as it lands. */
export function mountHighlights(root: ParentNode): Disposer {
  const triggers = all<HTMLElement>(root, 'h2.t .hl').map((el) =>
    ScrollTrigger.create({
      trigger: el,
      start: HIGHLIGHT_START,
      once: true,
      onEnter: () => el.classList.add('lit'),
    }),
  );
  return killer([], triggers);
}

// --- The hero ------------------------------------------------------------------------------------

/**
 * The hero's card answers its question while you watch: the leaf draws, its vein follows, the light
 * arrives, the sugar leaves, and the caption lands last. It runs once, on load, so the drawn answer
 * is complete on first paint rather than waiting for a scroll that may never come.
 */
export function mountHeroLesson(root: ParentNode): Disposer {
  const leaf = root.querySelector<SVGPathElement>('#d-leaf');
  if (!leaf) return () => {};
  for (const id of ['#d-leaf', '#d-vein', '#d-arrow']) {
    measureDraw(root.querySelector<SVGPathElement>(id));
  }
  const tl = gsap.timeline({ delay: HERO_DELAY });
  const at = (id: string) => root.querySelector(id);
  tl.to(at('#d-leaf'), { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' })
    .to(at('#d-vein'), { strokeDashoffset: 0, duration: 0.7, ease: 'power2.out' }, '-=.45')
    .to(at('#d-rays'), { opacity: 1, duration: 0.4 }, '-=.35')
    .to(at('#d-lbl1'), { opacity: 1, duration: 0.35 }, '-=.2')
    .to(at('#d-arrow'), { strokeDashoffset: 0, duration: 0.7, ease: 'power2.out' }, '-=.1')
    .to([at('#d-head'), at('#d-lbl2')], { opacity: 1, duration: 0.3 }, '-=.25')
    .to(at('#d-cap'), { opacity: 1, duration: 0.45 });
  return () => tl.kill();
}

/** The two drawn objects beside the hero card drift as the hero leaves. */
export function mountFloats(root: ParentNode, hero: Element | null): Disposer {
  if (!hero) return () => {};
  const tweens = all<HTMLElement>(root, '.float').map((el, i) =>
    gsap.to(el, {
      y: floatDrift(i),
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.8 },
    }),
  );
  return killer(tweens, []);
}

// --- The four answer forms -----------------------------------------------------------------------

/**
 * The pinned sequence: the panel holds still while the page scrolls past it, and each quarter of
 * that distance swaps the card and its label.
 *
 * The guard on `shown` is the whole reason this is safe. Without it, `onUpdate` would build a pair
 * of tweens on every scroll frame — dozens a second, each one fighting the last for the same
 * opacity — which is cause 3 of law v5's jitter, and is what the owner saw.
 */
export function mountForms(root: ParentNode): Disposer {
  const section = root.querySelector<HTMLElement>('#forms');
  const cards = all<HTMLElement>(root, '#formsBox .card');
  const navs = all<HTMLElement>(root, '#formsNav span');
  const first = cards[0];
  if (!section || !first) return () => {};

  gsap.set(first, { opacity: 1 });
  let shown = 0;
  const trigger = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: FORMS_END,
    pin: true,
    pinSpacing: true,
    pinType: PIN_TYPE,
    anticipatePin: 1,
    invalidateOnRefresh: true,
    onUpdate(self) {
      const i = cardIndex(self.progress, cards.length);
      if (i === shown) return; // one tween per change, never one per frame
      gsap.to(cards[shown] as HTMLElement, { opacity: 0, duration: 0.3, overwrite: 'auto' });
      gsap.to(cards[i] as HTMLElement, { opacity: 1, duration: 0.35, overwrite: 'auto' });
      navs.forEach((nav, n) => {
        nav.classList.toggle('on', n === i);
      });
      shown = i;
    },
  });

  return () => {
    trigger.kill();
    gsap.set(cards, { clearProps: 'opacity' });
  };
}

// --- The film -------------------------------------------------------------------------------------

/** The film plays, is paused, is circled, and is answered — all of it scrubbed by the reader. */
export function mountFilm(root: ParentNode): Disposer {
  const section = root.querySelector<HTMLElement>('#students');
  const track = root.querySelector<HTMLElement>('#track');
  if (!section || !track) return () => {};

  const lasso = root.querySelector<SVGPathElement>('#lasso');
  if (lasso && typeof lasso.getTotalLength === 'function') {
    const l = lasso.getTotalLength();
    lasso.style.strokeDasharray = String(l);
    lasso.style.strokeDashoffset = String(l);
  }

  const at = (id: string) => root.querySelector(id);
  const tl = gsap.timeline({
    scrollTrigger: { trigger: section, start: FILM_START, end: FILM_END, scrub: SCRUB },
  });
  tl.to(track, { scaleX: 0.38, duration: 1, ease: 'none' })
    .to({}, { duration: 0.01 })
    .to(at('#b1'), { opacity: 1, y: -6, duration: 0.4 })
    .to(at('#lasso'), { strokeDashoffset: 0, duration: 1.1 }, '-=.1')
    .to(at('#b1'), { opacity: 0, duration: 0.3 })
    .to(at('#b2'), { opacity: 1, y: 6, duration: 0.4 })
    .to(at('#b3'), { opacity: 1, duration: 0.5 }, '+=.3')
    .to(track, { scaleX: 0.62, duration: 0.8, ease: 'none' });

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
  };
}

// --- It teaches you ---------------------------------------------------------------------------------

/**
 * The gap: the shaky prerequisite is ringed, the chapter above it flinches, and a mint tick lands
 * on the patched one.
 *
 * Fired ONCE on entry rather than scrubbed, which is what makes it safe: what moves is an opacity,
 * a scale about a fixed origin, and a dash offset, and a dash offset is a geometric value that law
 * v5 §8 cause 2 forbids scrubbing. Nothing in `page-styles.ts` transitions any of the three.
 */
export function mountGap(root: ParentNode): Disposer {
  const section = root.querySelector<HTMLElement>('#teaches');
  const weak = root.querySelector<SVGElement>('#pre-weak');
  if (!section || !weak) return () => {};
  const tweens: gsap.core.Animation[] = [];

  const trigger = ScrollTrigger.create({
    trigger: section,
    start: GAP_START,
    once: true,
    onEnter() {
      const tl = gsap.timeline();
      tl.to(weak, { opacity: 1, duration: 0.45, ease: 'power2.out' }, 0.3)
        .fromTo(
          root.querySelector('#pre-a'),
          { scale: 1 },
          {
            scale: 1.04,
            transformOrigin: '113px 190px',
            duration: 0.3,
            yoyo: true,
            repeat: 1,
          },
          0.3,
        )
        .to(root.querySelector('#pre-tick'), { opacity: 1, duration: 0.01 }, 1.1)
        .to(
          root.querySelector('#pre-tick'),
          { strokeDashoffset: 0, duration: 0.5, ease: 'power2.out' },
          1.1,
        );
      tweens.push(tl);
    },
  });

  return killer(tweens, [trigger]);
}

/**
 * Mastery: the curve draws itself, dips where the chapter slipped, and only then says mastered.
 *
 * The path publishes its own length as `--len` first (`measureDraw`), because the markup's 360 is
 * the prototype's measurement of the same path and a browser's is authoritative.
 */
export function mountMastery(root: ParentNode): Disposer {
  const curve = root.querySelector<SVGPathElement>('#mast-curve');
  if (!curve) return () => {};
  const tweens: gsap.core.Animation[] = [];

  const trigger = ScrollTrigger.create({
    trigger: curve,
    start: MASTERY_START,
    once: true,
    onEnter() {
      measureDraw(curve);
      const tl = gsap.timeline();
      tl.to(curve, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut' })
        .to(root.querySelector('#mast-dip'), { opacity: 1, duration: 0.4 }, 0.5)
        .to(root.querySelector('#mast-done'), { opacity: 1, duration: 0.5 }, 1.2);
      tweens.push(tl);
    },
  });

  return killer(tweens, [trigger]);
}

// --- The climb ---------------------------------------------------------------------------------------

/**
 * The climb's path draws itself as the section arrives — once, and only the pig stroke.
 *
 * GSAP owns the dash offset and nothing else here. The two drawings cross-fade on a CSS transition
 * that the `.on` class alone drives (`page-styles.ts`), so opacity has exactly one owner and the
 * switch cannot fight a tween — law v5 §8, cause 1.
 */
export function mountClimb(root: ParentNode): Disposer {
  const section = root.querySelector<HTMLElement>('#climb');
  const path = root.querySelector<SVGPathElement>('#climb svg[data-vibe="quest"] path.ink.pig');
  if (!section || !path || typeof path.getTotalLength !== 'function') return () => {};
  const tweens: gsap.core.Animation[] = [];

  const trigger = ScrollTrigger.create({
    trigger: section,
    start: CLIMB_START,
    once: true,
    onEnter() {
      const length = path.getTotalLength();
      tweens.push(
        gsap.fromTo(
          path,
          { strokeDasharray: length, strokeDashoffset: length },
          { strokeDashoffset: 0, duration: 1.5, ease: 'power2.out' },
        ),
      );
    },
  });

  return killer(tweens, [trigger]);
}

// --- The parent's report --------------------------------------------------------------------------

/** The numbers count, the bars grow, the projection draws — once, as the card arrives. */
export function mountReport(root: ParentNode): Disposer {
  const report = root.querySelector<HTMLElement>('#report');
  if (!report) return () => {};
  const tweens: gsap.core.Animation[] = [];

  const trigger = ScrollTrigger.create({
    trigger: report,
    start: REPORT_START,
    once: true,
    onEnter() {
      for (const el of all<HTMLElement>(report, '.count')) {
        const to = Number(el.dataset.to ?? 0);
        // The tween runs 0..1 and the number is derived from it, so the arithmetic that produces
        // what a parent reads is the pure function `countAt` rather than a rounding buried here.
        const holder = { k: 0 };
        tweens.push(
          gsap.to(holder, {
            k: 1,
            duration: 1.2,
            ease: 'power2.out',
            onUpdate() {
              el.textContent = String(countAt(holder.k, to));
            },
          }),
        );
      }
      all<SVGRectElement>(report, '#bars rect').forEach((rect, i) => {
        const h = Number(rect.dataset.h ?? 0);
        tweens.push(
          gsap.to(rect, {
            attr: { height: h, y: CHART_BASELINE - h },
            duration: 0.8,
            delay: i * 0.07,
            ease: 'power3.out',
          }),
        );
      });
      const proj = report.querySelector<SVGPathElement>('#proj');
      if (proj) {
        measureDraw(proj);
        tweens.push(
          gsap.to(proj, { strokeDashoffset: 0, duration: 1.1, delay: 0.7, ease: 'power2.out' }),
        );
      }
    },
  });

  return killer(tweens, [trigger]);
}

// --- Practice -------------------------------------------------------------------------------------

/** The small, specific fuss when a learner gets it. Fourteen sparks, out and gone. */
export function burst(box: HTMLElement | null, colors: readonly string[]): void {
  if (!box) return;
  for (let i = 0; i < SPARKS; i++) {
    const spark = document.createElement('i');
    spark.className = 'spark';
    spark.style.background = colors[i % colors.length] ?? 'var(--marigold)';
    spark.style.left = '50%';
    spark.style.top = '46%';
    box.appendChild(spark);
    const { x, y } = sparkVector(i, SPARKS, Math.random());
    gsap.fromTo(
      spark,
      { opacity: 1, x: 0, y: 0, scale: 1 },
      {
        opacity: 0,
        x,
        y,
        scale: 0.4,
        rotate: 180,
        duration: 0.9,
        ease: 'power2.out',
        onComplete: () => spark.remove(),
      },
    );
  }
}

/** The furthest a spark can travel — read by the test that keeps the burst inside its card. */
export const SPARK_REACH = SPARK_MIN + SPARK_SPREAD;

/** Wobo rings the difference on the learner's own answer, drawing the loop as it goes. */
export function drawRing(ring: SVGPathElement | null, d: string): void {
  if (!ring) return;
  ring.setAttribute('d', d);
  if (!d || typeof ring.getTotalLength !== 'function') return;
  const l = ring.getTotalLength();
  ring.style.setProperty('--len', String(l));
  ring.style.strokeDasharray = String(l);
  ring.style.strokeDashoffset = String(l);
  gsap.to(ring, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.out' });
}

// --- The still page --------------------------------------------------------------------------------

/**
 * Reduced motion. Nothing animates in, so everything that would have been revealed is simply put
 * where it belongs: the drawn answer complete, the highlighters swept, the first answer card up.
 * The stylesheet does the rest (`@media (prefers-reduced-motion: reduce)` in `page-styles.ts`).
 */
export function settleStill(root: ParentNode): void {
  for (const el of all<SVGElement>(root, '#hero .draw')) {
    el.style.strokeDashoffset = '0';
  }
  for (const id of ['#d-rays', '#d-lbl1', '#d-head', '#d-lbl2', '#d-cap']) {
    const el = root.querySelector<SVGElement>(id);
    if (el) el.setAttribute('opacity', '1');
  }
  for (const el of all<HTMLElement>(root, 'h2.t .hl')) el.classList.add('lit');
  // The counters are the parent's report. A still page that shows 0 minutes and 0 chapters is not a
  // calmer version of the report, it is a wrong one.
  for (const el of all<HTMLElement>(root, '.count')) {
    el.textContent = String(Number(el.dataset.to ?? 0));
  }
  for (const el of all<SVGRectElement>(root, '#bars rect')) {
    const h = Number(el.dataset.h ?? 0);
    el.setAttribute('height', String(h));
    el.setAttribute('y', String(CHART_BASELINE - h));
  }
  const proj = root.querySelector<SVGPathElement>('#proj');
  if (proj) proj.style.strokeDashoffset = '0';
  // The two teaching chapters. A still page that shows the chapter without the gap it found, or
  // the mastery curve without its ending, is not a calmer version of the argument — it is half of
  // it. The climb's path is drawn in the markup already; only its dash offset would have moved.
  for (const id of ['#pre-tick', '#mast-curve']) {
    const el = root.querySelector<SVGElement>(id);
    if (el) el.style.strokeDashoffset = '0';
  }
  for (const id of ['#pre-weak', '#pre-tick', '#mast-dip', '#mast-done']) {
    root.querySelector<SVGElement>(id)?.setAttribute('opacity', '1');
  }
  const nav = root.querySelector<HTMLElement>('#formsNav span');
  nav?.classList.add('on');
}
