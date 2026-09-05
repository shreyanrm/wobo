'use client';

import { fontFamily, woboHighlight, zIndex } from '@wobo/config';
import { useReducedMotion } from '@wobo/motion';
import { useEffect, useId, useState } from 'react';
import type { ActiveAnnotation, ActiveHighlight, ActiveNote } from './actions';
import { useWoboBus } from './context-bus';
import { inkRng, type Mark, markPath, noteRotation } from './freehand';
import { scrollHold } from './scroll-hold';

const DEFAULT_TTL = 6000;
const FADE = 500;
/**
 * The one pigment Wobo draws with, read through the theme var so a dark root swaps in the dark-ink
 * ultramarine at the same opacities. The literal is only the fallback for a host that has not
 * injected the token sheet yet.
 */
export const HIGHLIGHT_INK = `var(--wobo-highlight-ink, ${woboHighlight.ink})`;
/** At most a 4% ultramarine frost inside the ring — a hint of the box, never a fill. */
export const HIGHLIGHT_FROST = `var(--wobo-highlight-frost, ${woboHighlight.frost})`;
/** Breathing room between the target's box and the ring drawn round it. */
const RING_PAD = 4;
/** How far a hand strays from a ruled edge, in px. */
const RING_WOBBLE = 0.7;
/** Natural handwriting pace when Wobo's voice isn't pacing the note — ~28ms/char (owner: muted fallback). */
const MS_PER_CHAR = 28;
/** How fast the pen travels along a stroke, px/ms — a believable hand, not an instant reveal. */
const PEN_PX_PER_MS = 0.6;
const MIN_STROKE_MS = 380;
const MAX_STROKE_MS = 1200;

/** Keep marks glued to their moving targets AND drive the draw/fade/typing clock: re-measure every frame. */
function useLiveTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return tick;
}

/** 1 while alive, ramps to 0 over the last `fade` ms of the mark's life. */
function fadeOpacity(age: number, ttl: number, fade: number = FADE): number {
  if (age >= ttl) return 0;
  if (age <= ttl - fade) return 1;
  return Math.max(0, (ttl - age) / fade);
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
/** Ease-out cubic — the pen decelerates into the finish of a stroke, the way a hand lifts. */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Rough drawn length of a mark, in px, so a long arrow takes longer to ink than a short tick. */
function strokeLen(mark: Mark, w: number, h: number): number {
  switch (mark) {
    case 'underline':
      return w + 6;
    case 'circle':
      return 2.15 * Math.PI * ((w + h) / 2 + 9); // two passes round the term
    case 'crossOut':
      return 2 * Math.hypot(w, h * 0.25);
    case 'arrow':
      return Math.hypot(Math.max(48, w * 0.5), Math.max(18, h * 0.35)) + 26; // shaft, then the head
    case 'bracket':
      return h + 12;
    case 'check':
      return Math.min(Math.max(Math.min(w, h), 22), 40) * 1.7;
    default:
      return 46; // lookHere — a small quick tick
  }
}

/** How long this stroke takes to draw itself on — pen speed, with a seeded ±10% micro-variation. */
function strokeDurationMs(mark: Mark, w: number, h: number, rng: () => number): number {
  const raw = (strokeLen(mark, w, h) / PEN_PX_PER_MS) * (0.9 + rng() * 0.2);
  return Math.max(MIN_STROKE_MS, Math.min(MAX_STROKE_MS, raw));
}

/** Dash-offset props that draw a path on over `duration` ms, eased like a moving pen (0 = fully drawn). */
function drawOn(
  age: number,
  duration: number,
  reduced: boolean,
): { pathLength: number; strokeDasharray: string; strokeDashoffset: number } {
  const progress = reduced ? 1 : easeOutCubic(clamp01(age / duration));
  return { pathLength: 1, strokeDasharray: '1', strokeDashoffset: 1 - progress };
}

/** One decimal is all an ink path needs; it keeps the emitted `d` short and comparable. */
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/**
 * A rounded rectangle drawn by hand: 3px corners, every edge nudged off true by up to a pixel so
 * the ring reads as Wobo's pen rather than a CSS outline. Seeded, so the same target redraws the
 * same way within a turn and a re-ink genuinely redraws.
 */
export function wobbledBox(w: number, h: number, r: number, rng: () => number): string {
  const k = (): number => (rng() * 2 - 1) * RING_WOBBLE;
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const x0 = 0;
  const y0 = 0;
  const x1 = w;
  const y1 = h;
  return [
    `M ${f1(x0 + rr + k())} ${f1(y0 + k())}`,
    `L ${f1(x1 - rr + k())} ${f1(y0 + k())}`,
    `Q ${f1(x1)} ${f1(y0)} ${f1(x1 + k())} ${f1(y0 + rr + k())}`,
    `L ${f1(x1 + k())} ${f1(y1 - rr + k())}`,
    `Q ${f1(x1)} ${f1(y1)} ${f1(x1 - rr + k())} ${f1(y1 + k())}`,
    `L ${f1(x0 + rr + k())} ${f1(y1 + k())}`,
    `Q ${f1(x0)} ${f1(y1)} ${f1(x0 + k())} ${f1(y1 - rr + k())}`,
    `L ${f1(x0 + k())} ${f1(y0 + rr + k())}`,
    `Q ${f1(x0)} ${f1(y0)} ${f1(x0 + rr + k())} ${f1(y0 + k())}`,
    'Z',
  ].join(' ');
}

/** Everything the ring renders as — pure, so the pigment law is unit-testable without a DOM. */
export interface HighlightRing {
  /** Absolute placement of the svg, in viewport px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The wobbled box, in svg-local coordinates. */
  d: string;
  /** The only fill on the overlay: ultramarine frost, capped at 4% alpha. */
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  pathLength: number;
  strokeDasharray: string;
  strokeDashoffset: number;
}

/**
 * Wobo pointing at a region of the screen: a 1.5px hand-wobbled ultramarine ring on the target's
 * box, drawing itself on over 320ms, with at most a 4% ultramarine frost inside. Reduced motion
 * gets the finished ring instantly. Returns null once the mark has fully faded.
 */
export function highlightRing(
  rect: { left: number; top: number; width: number; height: number },
  age: number,
  ttl: number,
  reduced: boolean,
  seed: string,
): HighlightRing | null {
  const opacity = fadeOpacity(age, ttl, woboHighlight.fadeMs);
  if (opacity <= 0) return null;
  const w = rect.width + RING_PAD * 2;
  const h = rect.height + RING_PAD * 2;
  return {
    left: rect.left - RING_PAD,
    top: rect.top - RING_PAD,
    width: w,
    height: h,
    d: wobbledBox(w, h, woboHighlight.radius, inkRng(seed, 'highlight', 'ring')),
    fill: HIGHLIGHT_FROST,
    stroke: HIGHLIGHT_INK,
    strokeWidth: woboHighlight.ringWidth,
    opacity,
    ...drawOn(age, woboHighlight.drawMs, reduced),
  };
}

/**
 * Index the registered targets once per overlay frame and measure each at most once.
 *
 * The overlay re-renders on every animation frame while ink is live. Looking each mark's target up
 * with a linear scan over `getTargets()` and re-measuring it per mark made that O(marks × targets)
 * of layout-forcing work sixty times a second; a worked example accumulates several marks on the
 * same target, so the same element was measured repeatedly within a single frame.
 */
export function rectLookup(
  targets: readonly { id: string; getRect: () => DOMRect | null }[],
): (targetId: string) => DOMRect | null {
  const byId = new Map(targets.map((t) => [t.id, t]));
  const measured = new Map<string, DOMRect | null>();
  return (targetId: string) => {
    const cached = measured.get(targetId);
    if (cached !== undefined) return cached;
    let rect: DOMRect | null = null;
    try {
      rect = byId.get(targetId)?.getRect() ?? null;
    } catch {
      rect = null; // a target torn down mid-frame must not take the overlay with it
    }
    measured.set(targetId, rect);
    return rect;
  };
}

/**
 * True while any ring or stroke mark on the overlay is still drawing itself on: the page is held
 * still for exactly that long (`scroll-hold.ts`). A note being written is not a stroke — it is
 * text arriving — and a mark that has landed follows its target on its own, so neither holds.
 */
export function overlayInFlight(
  marks: {
    highlights: readonly { bornAt?: number }[];
    annotations: readonly { bornAt?: number; durationMs: number }[];
  },
  now: number,
  bornAtDefault: number,
  reduced: boolean,
): boolean {
  if (reduced) return false;
  const age = (bornAt: number | undefined): number => now - (bornAt ?? bornAtDefault);
  for (const h of marks.highlights) {
    const a = age(h.bornAt);
    if (a >= 0 && a < woboHighlight.drawMs) return true;
  }
  for (const m of marks.annotations) {
    const a = age(m.bornAt);
    if (a >= 0 && a < m.durationMs) return true;
  }
  return false;
}

/**
 * WoboOverlay — the visible half of "every page is a canvas Wobo is plugged into", drawn in Wobo's own
 * hand. Pointing at a region is a hand-wobbled ultramarine ring on the target's box — one pigment,
 * a whisper of frost inside, never a coloured wash; every stroke mark DRAWS ITSELF
 * ON like a moving pen — the arrow grows along its shaft with the head arriving last, the circle
 * sweeps its arc, the underline travels left to right — at a believable, slightly varying hand
 * speed. Notes are written on letter-by-letter in Caveat, paced to Wobo's voice when a sentence beat
 * carries them (THE SYNCED HAND) or at a natural handwriting pace when muted. Each mark runs on its
 * OWN birth clock, so a choreographed turn accumulates ink beat by beat instead of popping in at
 * once. Nothing is scaled: paths are built to each target's real rect, so the pen nib stays a
 * constant width. The overlay never intercepts pointer events and casts no shadow.
 */
export function WoboOverlay() {
  const bus = useWoboBus();
  const reduced = useReducedMotion();
  const active = bus.highlights.length + bus.annotations.length + bus.notes.length > 0;
  useLiveTick(active);

  const now = performance.now();
  /** Each mark ages from its own paint time; a pre-timeline turn shares the dispatch clock. */
  const ageOf = (bornAt: number | undefined): number => now - (bornAt ?? bus.marksBornAt);
  // When Wobo re-inks a faded set, the nonce reseeds every stroke so the redraw is genuinely fresh
  // (a new hand-drawn pass), not a pixel-identical copy of what faded.
  const reink = bus.reinkNonce ? String(bus.reinkNonce) : '';
  // One index and one measurement pass for the whole frame.
  const rectOf = rectLookup(bus.getTargets());

  // The scroll hold: the page stands still while a ring or a stroke is drawing itself on, and is
  // let go on the frame it lands (the live tick above re-renders every frame while ink is live).
  const holdToken = useId();
  const holding =
    active &&
    overlayInFlight(
      {
        highlights: bus.highlights,
        annotations: bus.annotations.map((a: ActiveAnnotation) => {
          const rect = rectOf(a.targetId);
          return {
            bornAt: a.bornAt,
            durationMs: rect
              ? strokeDurationMs(
                  a.mark as Mark,
                  rect.width,
                  rect.height,
                  inkRng(a.targetId, a.mark, `dur${a.level}${reink}`),
                )
              : 0,
          };
        }),
      },
      now,
      bus.marksBornAt,
      reduced,
    );
  useEffect(() => {
    scrollHold.set(holdToken, holding);
  }, [holdToken, holding]);
  useEffect(() => () => scrollHold.release(holdToken), [holdToken]);
  useEffect(() => (active ? scrollHold.watch() : undefined), [active]);

  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: zIndex.woboPresence - 10,
      }}
    >
      {bus.highlights.map((h: ActiveHighlight) => {
        const rect = rectOf(h.targetId);
        if (!rect) return null;
        const ring = highlightRing(
          rect,
          ageOf(h.bornAt),
          h.ttl ?? DEFAULT_TTL,
          reduced,
          h.targetId + h.level + reink,
        );
        if (!ring) return null;
        return (
          <svg
            // bornAt is distinct per beat, so accumulated marks on one target still key uniquely
            key={`hl-${h.targetId}-${h.level}-${h.bornAt ?? 'shared'}`}
            width={ring.width}
            height={ring.height}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: ring.left,
              top: ring.top,
              overflow: 'visible',
              opacity: ring.opacity,
            }}
          >
            <path
              d={ring.d}
              fill={ring.fill}
              stroke={ring.stroke}
              strokeWidth={ring.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={ring.pathLength}
              strokeDasharray={ring.strokeDasharray}
              strokeDashoffset={ring.strokeDashoffset}
            />
          </svg>
        );
      })}

      {bus.annotations.map((a: ActiveAnnotation) => {
        const rect = rectOf(a.targetId);
        if (!rect) return null;
        const age = ageOf(a.bornAt);
        const opacity = fadeOpacity(age, a.ttl ?? DEFAULT_TTL);
        if (opacity <= 0) return null;
        const rng = inkRng(a.targetId, a.mark, a.level + reink);
        const mark = a.mark as Mark;
        const d = markPath(mark, rect.width, rect.height, rng);
        // A fresh rng for the duration so the seeded ±10% pen-speed variation doesn't disturb the path.
        const duration = strokeDurationMs(
          mark,
          rect.width,
          rect.height,
          inkRng(a.targetId, a.mark, `dur${a.level}${reink}`),
        );
        return (
          <svg
            key={`an-${a.targetId}-${a.mark}-${a.level}-${a.bornAt ?? 'shared'}`}
            width={rect.width}
            height={rect.height}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: rect.left,
              top: rect.top,
              overflow: 'visible',
              opacity,
            }}
          >
            <path
              d={d}
              fill="none"
              stroke={HIGHLIGHT_INK}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              {...drawOn(age, duration, reduced)}
            />
          </svg>
        );
      })}

      {bus.notes.map((n: ActiveNote) => {
        const rect = rectOf(n.targetId);
        if (!rect) return null;
        const ttl = n.ttl ?? DEFAULT_TTL;
        const age = ageOf(n.bornAt);
        const opacity = fadeOpacity(age, ttl);
        if (opacity <= 0) return null;
        const rng = inkRng(n.targetId, 'note', n.level + reink);
        // Write the note on letter by letter. When a sentence beat set durationMs, the hand keeps
        // pace with Wobo's voice; otherwise a natural pace with a per-note pen-speed variation.
        const speedVar = 0.88 + rng() * 0.24;
        const writeDur = n.durationMs ?? n.text.length * MS_PER_CHAR * speedVar;
        const shown = reduced
          ? n.text.length
          : Math.min(
              n.text.length,
              Math.max(0, Math.floor(clamp01(age / writeDur) * n.text.length)),
            );
        const typing = shown < n.text.length && age < ttl - FADE;
        const tilt = reduced ? 0 : noteRotation(rng);
        const nudgeX = Math.round((rng() * 2 - 1) * 6); // a small margin drift, not pinned to the edge
        return (
          <div
            key={`nt-${n.targetId}-${n.level}-${n.bornAt ?? 'shared'}`}
            style={{
              position: 'absolute',
              left: rect.left + nudgeX,
              top: rect.bottom + 6,
              maxWidth: Math.max(rect.width, 220),
              fontFamily: fontFamily.handwritten,
              fontSize: '1.5rem',
              lineHeight: 1.25,
              color: HIGHLIGHT_INK,
              opacity,
              transform: `rotate(${tilt}deg)`,
              transformOrigin: 'left center',
            }}
          >
            {n.text.slice(0, shown)}
            {typing && (
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 2,
                  height: '1.05em',
                  marginLeft: 1,
                  transform: 'translateY(3px)',
                  background: HIGHLIGHT_INK,
                  opacity: Math.floor(age / 300) % 2 === 0 ? 1 : 0.2,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
