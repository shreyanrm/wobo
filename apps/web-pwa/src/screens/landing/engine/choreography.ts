/**
 * The score — every number the page is cut on, and the arithmetic that turns a scroll position or
 * a tap into a moment in it.
 *
 * The timelines live in `motion.ts`; this module is the data and the pure functions under them.
 * Keeping the beats here means the timings are readable in one place, and every question the page
 * asks of them — which answer card is up, how far a number has counted, where the ring goes round
 * a learner's own squares — is testable without a browser, a scroll or a frame.
 *
 * Every value is `design/prototypes/landing-v8.html`'s, to the digit.
 */

import { clamp01 } from './env';

// --- Where things fire ----------------------------------------------------------------------

/** A section's reveal: its top crossing 86% of the viewport, once. */
export const REVEAL_START = 'top 86%';

/** The marigold highlighter sweeps as the headline crosses 80%. */
export const HIGHLIGHT_START = 'top 80%';

/** The film starts scrubbing at 60% and runs while the reader scrolls past it. */
export const FILM_START = 'top 60%';
export const FILM_END = '+=1000';

/**
 * How far the page scrolls while the four answer forms are PINNED — and this is the one number on
 * the page that was not the prototype's to keep.
 *
 * It was `+=2400`. Measured at 390px that produced a 3,195px `.pin-spacer` around a section 795px
 * high: the page stopped responding to scroll for 2,400px, which is 2.8 phone screens, beginning at
 * y≈6,670 — screen 8 of 23. A touch scroll that produces no movement does not read as a pinned
 * chapter on a phone, it reads as a broken page, and with `FILM_END` at 1800 that was 4,200px of
 * scroll-jacking on one page. It was also the single largest reason the price sat at screen 17
 * (docs/SELL.md §3 rung 5, §8 "a page that scrolls past its own point").
 *
 * 1,000px is four card changes in one screen of scroll, which still reads as a held chapter and
 * costs the reader one flick instead of three. `cardAt()` divides the distance into four, so the
 * choreography is unchanged; only how far the reader has to push it is.
 */
export const FORMS_END = '+=1000';

/** The parent's report counts itself up as it crosses 76%, once. */
export const REPORT_START = 'top 76%';

/** The weak prerequisite is found as the teaching chapter crosses 62%, once. */
export const GAP_START = 'top 62%';

/** The mastery curve draws itself as it crosses 78%, once. */
export const MASTERY_START = 'top 78%';

/** The climb's path draws itself as the section crosses 70%, once. */
export const CLIMB_START = 'top 70%';

/** How much the scrub lags the scroll — the film follows the reader, it does not snap to them. */
export const SCRUB = 0.8;

/** The hero's answer draws itself a quarter of a second after the page settles. */
export const HERO_DELAY = 0.25;

// --- The hero -------------------------------------------------------------------------------

/** How far a floating drawn object drifts over the hero, by its index. */
export function floatDrift(index: number): number {
  return -60 - index * 26;
}

// --- The four answer forms --------------------------------------------------------------------

/**
 * Which card a pinned progress lands on.
 *
 * The `.999` is the prototype's and it is load-bearing: `progress` reaches exactly 1 at the end of
 * the pin, and `floor(1 * 4)` is 4 — one past the last card. Shaving the top of the range keeps the
 * last card on screen through the final pixel instead of blanking the panel as it releases.
 */
export function cardIndex(progress: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.floor(clamp01(progress) * count * 0.999));
}

// --- The parent's report -----------------------------------------------------------------------

/** The height a bar grows to, and the y it grows from — the chart's baseline is 150. */
export const CHART_BASELINE = 150;

/** Where a bar's top edge sits once it has grown to `h`. */
export function barTop(h: number): number {
  return CHART_BASELINE - h;
}

/** The number shown while a counter is `k` of the way to its target. */
export function countAt(k: number, to: number): number {
  return Math.round(clamp01(k) * to);
}

// --- Practice ---------------------------------------------------------------------------------

/** The pitch of the puzzle's grid, in the ring SVG's own units: a 104px cell plus its 8px gap. */
export const CELL_PITCH = 112;

/** Which of the four squares sits where, in grid coordinates. */
export const CELL_POSITIONS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/**
 * The looping ring Wobo draws around whatever the learner coloured — a hand-drawn oval that
 * overshoots and comes back, not a rectangle.
 *
 * Pure, so the path is a tested string rather than a shape someone has to squint at. An empty
 * selection returns an empty path, which is exactly what "nothing to ring" should draw.
 */
export function ringPath(selection: readonly number[]): string {
  if (!selection.length) return '';
  const cells = selection.flatMap((i) => {
    const pos = CELL_POSITIONS[i];
    return pos ? [pos] : [];
  });
  if (!cells.length) return '';
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const x0 = Math.min(...xs) * CELL_PITCH - 6;
  const x1 = Math.max(...xs) * CELL_PITCH + 110;
  const y0 = Math.min(...ys) * CELL_PITCH - 6;
  const y1 = Math.max(...ys) * CELL_PITCH + 110;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 16;
  const ry = (y1 - y0) / 2 + 16;
  return `M${cx - rx} ${cy} C${cx - rx} ${cy - ry * 1.34}, ${cx + rx} ${cy - ry * 1.34}, ${cx + rx} ${cy} S${cx - rx * 0.9} ${cy + ry * 1.4}, ${cx - rx - 6} ${cy + 8}`;
}

/** How many squares make half of a four-square shape. The whole point of the moment. */
export const HALF = 2;

/** What the burst throws, and how far. */
export const SPARKS = 14;
export const SPARK_MIN = 70;
export const SPARK_SPREAD = 90;

/** Where spark `i` of `n` flies to, given a 0..1 sample for its distance. */
export function sparkVector(i: number, n: number, sample: number): { x: number; y: number } {
  const a = (i / n) * Math.PI * 2;
  const d = SPARK_MIN + clamp01(sample) * SPARK_SPREAD;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d - 30 };
}
