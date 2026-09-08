'use client';

/**
 * WoboLoader — the boot loader, which is the character (docs/WOBO-PLAN.md §16).
 *
 * A pen crosses the page and draws the first hairline the product will show; the pen lifts; Wobo
 * settles into the orb above it with one overshoot. Under a second. No spinner, no progress bar, no
 * skeleton — the loader IS the introduction, and it is the only place in the product where a
 * decorative animation is also the meaning.
 *
 * The curve lives in `loader.ts` so it is testable to the millisecond; this file only draws it. The
 * orb is the real rig (`WoboBody`), not a lookalike, so the character the learner meets in the first
 * 900 ms is the character they keep.
 */

import { useReducedMotion } from '@wobo/motion';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import {
  LOADER_DURATION,
  LOADER_PEN,
  LOADER_TIMING,
  LOADER_VIEW,
  loaderDash,
  loaderFrame,
  loaderRestFrame,
} from './loader';
import { ensureRigStyles, RIG_CLASS } from './palette';
import { WoboBody } from './WoboBody';

export {
  LOADER_DURATION,
  LOADER_OVERSHOOT,
  LOADER_PEN,
  LOADER_TIMING,
  LOADER_VIEW,
  type LoaderFrame,
  type LoaderPhase,
  loaderDash,
  loaderFrame,
  loaderRestFrame,
} from './loader';

export interface WoboLoaderProps {
  /** Width in px. Everything else scales off it — the loader is one number wide. */
  width?: number;
  /**
   * Fires once the loader has finished. Under reduced motion it fires on the next tick, so a caller
   * that waits for it never hangs.
   */
  onDone?: () => void;
  /** What a screen reader is told while the app boots. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function WoboLoader({
  width = 240,
  onDone,
  label = 'Wobo',
  className,
  style,
}: WoboLoaderProps) {
  const reduced = useReducedMotion();
  const lineRef = useRef<SVGPathElement | null>(null);
  const penRef = useRef<SVGGElement | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  /** Only used to give the orb a mount point once the settle begins — one render, not sixty. */
  const [settling, setSettling] = useState(reduced);

  useEffect(() => {
    ensureRigStyles();
  }, []);

  const write = useRef((elapsed: number, isReduced: boolean) => {
    const f = isReduced ? loaderRestFrame() : loaderFrame(elapsed);
    const dash = loaderDash(f.line);
    lineRef.current?.setAttribute('stroke-dashoffset', String(round(dash.offset)));
    if (penRef.current) {
      penRef.current.style.opacity = String(round(f.penOpacity));
      penRef.current.style.display = f.pen ? '' : 'none';
      if (f.pen) {
        // The barrel is drawn at 28° off vertical; this leans it to a real writing angle and then
        // tips it further as it lifts away, the way a hand comes off the page.
        penRef.current.setAttribute(
          'transform',
          `translate(${round(f.pen.x)} ${round(f.pen.y)}) rotate(${round(15 + (1 - f.penOpacity) * 20)})`,
        );
      }
    }
    if (orbRef.current) {
      orbRef.current.style.opacity = String(round(f.orbOpacity));
      // Wobo grows out of the point the pen left, not out of the middle of nowhere.
      orbRef.current.style.transform = `translate(-50%, -100%) scale(${round(f.orb)})`;
    }
    return f.done;
  });

  useEffect(() => {
    if (reduced) {
      setSettling(true);
      write.current(LOADER_DURATION, true);
      const id = setTimeout(() => doneRef.current?.(), 0);
      return () => clearTimeout(id);
    }
    let raf = 0;
    let started = 0;
    let fired = false;
    let shown = false;
    const tick = (now: number) => {
      if (!started) started = now;
      const elapsed = now - started;
      if (!shown && elapsed >= LOADER_TIMING.draw) {
        shown = true;
        setSettling(true);
      }
      const done = write.current(elapsed, false);
      if (done && !fired) {
        fired = true;
        doneRef.current?.();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const scale = width / LOADER_VIEW.width;
  const height = LOADER_VIEW.height * scale;
  const dash = loaderDash(reduced ? 1 : 0);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={className ? `${RIG_CLASS} ${className}` : RIG_CLASS}
      style={{
        position: 'relative',
        width,
        height,
        display: 'inline-block',
        ...style,
      }}
    >
      <svg
        viewBox={`0 0 ${LOADER_VIEW.width} ${LOADER_VIEW.height}`}
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* The first hairline of the product, drawn in front of the learner. */}
        <path
          ref={lineRef}
          d={`M${LOADER_VIEW.lineFrom} ${LOADER_VIEW.lineY}H${LOADER_VIEW.lineTo}`}
          stroke="var(--wr-body)"
          strokeWidth={1}
          strokeOpacity={0.32}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={dash.array}
          strokeDashoffset={dash.offset}
        />
        {/* The pen: a tapered barrel, a collar and a nib that comes to a point, ultramarine at the
            tip. Filled outlines, not strokes — see LOADER_PEN. The group's origin is the nib, so
            the transform in `write` puts the point of the pen exactly on the line being drawn. */}
        <g
          ref={penRef}
          style={{ opacity: reduced ? 0 : 1, display: reduced ? 'none' : '' }}
          strokeLinejoin="round"
        >
          <path d={LOADER_PEN.barrel} fill="var(--wr-body)" />
          <path d={LOADER_PEN.ferrule} fill="var(--wr-body)" opacity={0.55} />
          <path d={LOADER_PEN.nib} fill="var(--wr-eye)" />
        </g>
      </svg>
      {/* Wobo settles in above the line Wobo just drew. */}
      <div
        ref={orbRef}
        style={{
          position: 'absolute',
          left: `${(LOADER_VIEW.woboX / LOADER_VIEW.width) * 100}%`,
          top: `${(LOADER_VIEW.woboY / LOADER_VIEW.height) * 100}%`,
          width: LOADER_VIEW.width * LOADER_VIEW.woboScale * scale,
          height: LOADER_VIEW.width * LOADER_VIEW.woboScale * scale,
          transformOrigin: '50% 100%',
          transform: 'translate(-50%, -100%) scale(0)',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        {settling ? (
          <WoboBody
            size={LOADER_VIEW.width * LOADER_VIEW.woboScale * scale}
            mood="greeting"
            label={label}
          />
        ) : null}
      </div>
    </div>
  );
}
