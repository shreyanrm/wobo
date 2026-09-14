'use client';

/**
 * WaitScene — the orb doing the subject's thing while the thing arrives.
 *
 * docs/EMAILS-AND-ANIMATIONS.md §3. This is what stands where a spinner, a skeleton or a sentence
 * about what Wobo is doing used to stand: for maths a number line is drawn and marked, for physics
 * a pendulum swings under Wobo, for biology a cell divides, for chemistry a beaker pours, for the
 * social sciences a map fills in, for computing a line is typed, for a photographed doubt a page
 * turns and a pencil underlines. Ten seconds, looped, calm, in both themes.
 *
 * The geometry is NOT here. It is in `wait.ts`, one pure function of one number, so the product,
 * the stills and the GIFs that go into mail are all the same drawing (§8, rule 1). This file owns
 * the clock and nothing else: one rAF writing attributes onto elements created once, so a scene
 * costs no React render per frame and can run under a lesson being fetched on a cheap phone.
 *
 * Three laws are kept here rather than by the caller:
 *  - it never narrates. There is no text node in this component, and there is no percentage.
 *  - reduced motion is a still with the spark, without exception: the most legible moment of the
 *    scene, and the orb's own spark, and no clock running at all.
 *  - the content arriving wins. The scene has no exit animation and holds no layout of its own
 *    past its box, so a caller swaps it for the real thing mid-loop and nothing jumps.
 */

import { useReducedMotion } from '@wobo/motion';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { ensureRigStyles, RIG_CLASS } from './palette';
import {
  WAIT_LOOP_MS,
  WAIT_STILL_AT,
  WAIT_VIEW,
  type WaitMark,
  type WaitSceneName,
  waitFrame,
  waitSceneFor,
} from './wait';
import { WoboBody } from './WoboBody';

export interface WaitSceneProps {
  /**
   * The subject being waited for — a product family (`math`, `physics`, …), a board's own name for
   * one (`physical_science`), or `doubt` for a photographed page. Unknown subjects get the number
   * line rather than nothing.
   */
  subject?: string;
  /** The scene by name, when the caller already knows which one it wants. Wins over `subject`. */
  scene?: WaitSceneName;
  /** Width in px, or any CSS width. The scene is one number wide and everything scales off it. */
  width?: number;
  /** The subject's pigment, as a CSS colour — `var(--violet)` and the like. Wobo blue by default. */
  pigment?: string;
  /** Wobo above the scene. Off where a surface already has Wobo on it (the lesson plane). */
  orb?: boolean;
  /** What assistive tech is told. Never rendered on screen; never a sentence about the software. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Wobo's own ink and the subject's pigment — the only two colours a scene is ever drawn in. */
const INK = 'var(--wr-body)';
/** What a filled mark that is not pigment is filled with: the ground Wobo's visor is cut from. */
const GROUND = 'var(--wr-visor)';

const round = (v: number) => Math.round(v * 100) / 100;

export function WaitScene({
  subject = 'math',
  scene,
  width = 220,
  pigment = 'var(--wr-eye)',
  orb = true,
  label = 'Wobo',
  className,
  style,
}: WaitSceneProps) {
  const reduced = useReducedMotion();
  const name = scene ?? waitSceneFor(subject);
  const still = reduced ? (WAIT_STILL_AT[name] ?? 0.6) : 0;
  // The shapes are created once, from a frame of the scene itself: every frame of a scene carries
  // the same marks in the same order (wait.ts), so this is the whole element list for the loop.
  const shapes = useMemo(() => waitFrame(name, still), [name, still]);
  const nodes = useRef<(SVGElement | null)[]>([]);

  useEffect(() => {
    ensureRigStyles();
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let started = 0;
    const tick = (now: number) => {
      if (!started) started = now;
      const p = ((now - started) % WAIT_LOOP_MS) / WAIT_LOOP_MS;
      const frame = waitFrame(name, p);
      for (let i = 0; i < frame.length; i++) {
        const el = nodes.current[i];
        if (el) write(el, frame[i] as WaitMark);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [name, reduced]);

  const height = typeof width === 'number' ? (width * WAIT_VIEW.height) / WAIT_VIEW.width : '100%';
  const orbSize = typeof width === 'number' ? Math.round(width * 0.4) : 88;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className={className ? `${RIG_CLASS} ${className}` : RIG_CLASS}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width,
        maxWidth: '100%',
        ...style,
      }}
    >
      {orb ? (
        // Wobo is thinking, which is a state and not a sentence. Under reduced motion Wobo holds
        // the spark instead, because that is what a still is (§8, rule 4). The rig is hidden from
        // assistive tech here: this region already says it is busy, and saying it twice is a
        // caption for a wait, which is the thing the law forbids.
        <span aria-hidden="true">
          <WoboBody size={orbSize} mood={reduced ? 'aha' : 'thinking'} label={label} />
        </span>
      ) : null}
      <svg
        viewBox={`0 0 ${WAIT_VIEW.width} ${WAIT_VIEW.height}`}
        width="100%"
        height={height}
        aria-hidden="true"
        style={{ display: 'block', overflow: 'visible', marginTop: orb ? -6 : 0 }}
      >
        {shapes.map((m, i) => (
          <Shape
            // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks ARE their positions
            key={`${name}-${i}`}
            mark={m}
            pigment={pigment}
            ref={(el: SVGElement | null) => {
              nodes.current[i] = el;
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/** One mark, drawn. Colour and stroke style are fixed at mount; only geometry moves. */
function Shape({
  mark,
  pigment,
  ref,
}: {
  mark: WaitMark;
  pigment: string;
  ref: (el: SVGElement | null) => void;
}) {
  const colour = mark.pigment ? pigment : INK;
  const common = {
    ref: ref as never,
    opacity: mark.o,
    style: { transition: 'none' } as CSSProperties,
  };
  switch (mark.kind) {
    case 'line':
      return (
        <line
          {...common}
          x1={mark.x1}
          y1={mark.y1}
          x2={mark.x2}
          y2={mark.y2}
          stroke={colour}
          strokeWidth={mark.w}
          strokeLinecap="round"
        />
      );
    case 'dot':
      return (
        <circle
          {...common}
          cx={mark.cx}
          cy={mark.cy}
          r={mark.r}
          fill={mark.fill ? colour : 'none'}
          stroke={mark.fill ? 'none' : colour}
          strokeWidth={mark.w ?? 1}
        />
      );
    case 'rect':
      return (
        <rect
          {...common}
          x={mark.x}
          y={mark.y}
          width={mark.w}
          height={mark.h}
          rx={mark.r ?? 1}
          fill={colour}
        />
      );
    case 'path':
      return (
        <path
          {...common}
          d={mark.d}
          fill={mark.fill ? (mark.pigment ? pigment : GROUND) : 'none'}
          stroke={colour}
          strokeWidth={mark.w}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...(mark.draw === undefined
            ? {}
            : { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - mark.draw })}
        />
      );
  }
}

/** Write one mark onto its element. Attributes, never React — this runs sixty times a second. */
function write(el: SVGElement, m: WaitMark): void {
  el.setAttribute('opacity', String(round(m.o)));
  switch (m.kind) {
    case 'line':
      el.setAttribute('x1', String(round(m.x1)));
      el.setAttribute('y1', String(round(m.y1)));
      el.setAttribute('x2', String(round(m.x2)));
      el.setAttribute('y2', String(round(m.y2)));
      el.setAttribute('stroke-width', String(m.w));
      return;
    case 'dot':
      el.setAttribute('cx', String(round(m.cx)));
      el.setAttribute('cy', String(round(m.cy)));
      el.setAttribute('r', String(round(m.r)));
      return;
    case 'rect':
      el.setAttribute('x', String(round(m.x)));
      el.setAttribute('y', String(round(m.y)));
      el.setAttribute('width', String(Math.max(0, round(m.w))));
      el.setAttribute('height', String(Math.max(0, round(m.h))));
      return;
    case 'path':
      el.setAttribute('d', m.d);
      if (m.draw !== undefined) el.setAttribute('stroke-dashoffset', String(round(1 - m.draw)));
      return;
  }
}
