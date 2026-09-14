/**
 * The bench the orb is filmed on.
 *
 * This page mounts the REAL component — `packages/wobo/src/body/WoboBody.tsx`, the same file the
 * product renders — and hands it a clock. Nothing here draws Wobo. The renderer steps the clock
 * frame by frame, photographs the result, and reads the transform the rig wrote onto its own SVG,
 * which is what becomes the stylesheet (tools/orb/css.ts).
 *
 * Three things are stubbed, and all three are stubbed so that two runs a month apart produce the
 * same bytes:
 *   - `requestAnimationFrame` and `performance.now`, so a frame happens when we say so and not when
 *     the machine gets round to it
 *   - `Date.now`, pinned to a weekday afternoon, so the rig's own night-time rule is a fact rather
 *     than whatever hour the render was started at
 *   - `Math.random`, which the rig uses for blinks and glances, seeded per move
 */

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { WoboBehaviour } from '../../packages/wobo/src/body/behaviours.ts';
import type { WoboExpression } from '../../packages/wobo/src/body/expressions.ts';
import { WoboBody } from '../../packages/wobo/src/body/WoboBody.tsx';

/** A Wednesday afternoon: not night, so Wobo's clock rule is settled and the same every run. */
const EPOCH = Date.parse('2026-09-09T14:00:00Z');
const TICK_MS = 16;

let clock = 0;
let pending: FrameRequestCallback[] = [];

performance.now = () => clock;
Date.now = () => EPOCH + clock;
window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  pending.push(callback);
  return pending.length;
};
window.cancelAnimationFrame = () => {};

let seed = 0x2b45ff;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x1_0000_0000;
};

interface StageState {
  mood: WoboExpression;
  scene: string | null;
  sceneKey: number;
  behaviour: WoboBehaviour | null;
  behaviourKey: number;
  gaze: { x: number; y: number } | null;
  /** True hands the rig a learner who has just done something, so idle life never starts. */
  awake: boolean;
}

const REST: StageState = {
  mood: 'idle',
  scene: null,
  sceneKey: 0,
  behaviour: null,
  behaviourKey: 0,
  gaze: null,
  awake: true,
};

let state: StageState = REST;
let apply: ((next: StageState) => void) | null = null;

function Stage({ size }: { size: number }) {
  const [live, set] = useState<StageState>(REST);
  apply = set;
  return (
    <WoboBody
      size={size}
      mood={live.mood}
      scene={live.scene}
      sceneKey={live.sceneKey}
      behaviour={live.behaviour}
      behaviourKey={live.behaviourKey}
      gaze={live.gaze ?? undefined}
      // A clock in the future clamps to "just now", which is how a move is filmed without the idle
      // scheduler wandering in halfway through. `undefined` lets the idle clock run, which is how
      // sleeping is earned rather than asked for.
      idleSince={live.awake ? Date.now() + 10_000_000 : undefined}
      night={false}
    />
  );
}

interface PropLayer {
  layer: 'under' | 'over';
  uri: string;
  origin?: string;
  keyframes: Keyframe[];
}

const layers: Animation[] = [];

function readTransform(): { dx: number; dy: number; sx: number; sy: number; rot: number } {
  const svg = document.querySelector('.wobo-rig svg');
  const outer = svg?.querySelector('g') as SVGGElement | null;
  const body = outer?.querySelector('g') as SVGGElement | null;
  const translate = /translate\(\s*(-?[\d.]+)[ ,]\s*(-?[\d.]+)\s*\)/;
  const outerT = translate.exec(outer?.getAttribute('transform') ?? '');
  const bodyAttr = body?.getAttribute('transform') ?? '';
  const scale = /scale\(\s*(-?[\d.]+)[ ,]\s*(-?[\d.]+)\s*\)/.exec(bodyAttr);
  const rotate = /rotate\(\s*(-?[\d.]+)\s*\)/.exec(bodyAttr);
  return {
    dx: outerT ? Number(outerT[1]) : 0,
    dy: outerT ? Number(outerT[2]) : 0,
    sx: scale ? Number(scale[1]) : 1,
    sy: scale ? Number(scale[2]) : 1,
    rot: rotate ? Number(rotate[1]) : 0,
  };
}

const orb = {
  /** Put the bench up: a stage square, the rig in the middle of it, nothing else on the page. */
  mount(stage: number, rig: number): void {
    document.body.style.margin = '0';
    document.body.style.background = '#FFFFFF';
    const box = document.createElement('div');
    box.id = 'stage';
    box.style.cssText = `position:relative;width:${stage}px;height:${stage}px;background:#FFFFFF;`;
    const inner = document.createElement('div');
    const inset = (stage - rig) / 2;
    inner.id = 'rig';
    inner.style.cssText = `position:absolute;left:${inset}px;top:${inset}px;width:${rig}px;height:${rig}px;z-index:1;`;
    box.appendChild(inner);
    document.body.appendChild(box);
    flushSync(() => {
      createRoot(inner).render(<Stage size={rig} />);
    });
  },

  /** The props for this move, as layers over and under the orb, paused on their own clock. */
  dress(props: PropLayer[]): void {
    for (const animation of layers.splice(0)) animation.cancel();
    for (const old of Array.from(document.querySelectorAll('.orb-prop'))) old.remove();
    const box = document.getElementById('stage');
    if (!box) return;
    for (const prop of props) {
      const el = document.createElement('div');
      el.className = 'orb-prop';
      el.style.cssText = `position:absolute;inset:0;background-repeat:no-repeat;background-position:center;background-size:100% 100%;z-index:${prop.layer === 'under' ? 0 : 2};background-image:url("${prop.uri}");`;
      if (prop.origin) el.style.transformOrigin = prop.origin;
      box.appendChild(el);
      if (prop.keyframes.length === 0) continue;
      const animation = el.animate(prop.keyframes, { duration: 1000, easing: 'linear' });
      animation.pause();
      layers.push(animation);
    }
  },

  /** Move the prop layers to a point in the move, as a fraction of it. */
  propAt(fraction: number): void {
    for (const animation of layers) animation.currentTime = fraction * 1000;
  },

  reset(): void {
    seed = 0x2b45ff;
    state = REST;
    if (apply) flushSync(() => apply?.(REST));
  },

  set(next: Partial<StageState>): void {
    state = { ...state, ...next };
    if (apply) flushSync(() => apply?.(state));
  },

  /** Advance the clock, running every frame the rig asked for on the way. */
  step(ms: number): void {
    const ticks = Math.max(1, Math.round(ms / TICK_MS));
    for (let i = 0; i < ticks; i += 1) {
      clock += TICK_MS;
      const queue = pending;
      pending = [];
      for (const callback of queue) callback(clock);
    }
  },

  read: readTransform,

  /** The rig's own geometry, read off what it rendered rather than restated here. */
  geometry(): { viewBox: string; pivot: { x: number; y: number } } {
    const svg = document.querySelector('.wobo-rig svg');
    const body = svg?.querySelector('g > g') as SVGGElement | null;
    const pivot = /translate\(\s*(-?[\d.]+)[ ,]\s*(-?[\d.]+)\s*\)/.exec(
      body?.getAttribute('transform') ?? '',
    );
    return {
      viewBox: svg?.getAttribute('viewBox') ?? '',
      pivot: { x: pivot ? Number(pivot[1]) : 0, y: pivot ? Number(pivot[2]) : 0 },
    };
  },

  /** Turn the app's own reduce-motion switch on, which is what the rig reads. */
  reduce(on: boolean): void {
    if (on) document.documentElement.setAttribute('data-motion', 'reduce');
    else document.documentElement.removeAttribute('data-motion');
  },

  /** The rig's own spark, exactly as it draws it — the mark a still keeps. */
  spark(): string {
    const groups = Array.from(document.querySelectorAll('.wobo-rig svg g[fill]'));
    const group = groups.find((g) => g.querySelector('path') !== null);
    return group ? group.outerHTML : '';
  },
};

declare global {
  interface Window {
    orb: typeof orb;
  }
}

window.orb = orb;
