/**
 * The pen (docs/BOARD.md §7) — how a stroke behaves as a hand rather than a path animation.
 *
 * Three physical facts make ink read as handwriting: **anticipation** (the nib lands a hair before
 * the stroke and takes off into it), **overshoot** (a fast stroke runs slightly past its end) and
 * **settle** (it comes back to where it meant to stop). On top of that sits a seeded wobble, so
 * the same object always draws the same way — a mark is frozen the moment it is born and never
 * shimmers at 60 fps.
 *
 * Everything here is pure geometry and timing in board units, plus one tiny WebAudio tick for the
 * pen sound. No React, no DOM measurement.
 */

import { hashSeed, mulberry32 } from '../freehand';
import type { BoardPoint } from './schema';

export type Rng = () => number;

/** A single drawn stroke: an SVG path in board units, plus how long the nib travels along it. */
export interface Stroke {
  d: string;
  /** Path length in board units — the pen's clock and the dash animation both use it. */
  length: number;
  /** Filled shapes (a wash, an arrowhead) do not draw on; they bloom with the stroke that owns them. */
  fill?: boolean;
  /** Nib width multiplier for this stroke alone (an arrowhead is finer than its shaft). */
  weight?: number;
  /** Explicit dash pattern in board units. */
  dash?: number[];
}

/** The rng for one object, seeded only from stable identity — never from age or tick. */
export function penRng(...identity: (string | number)[]): Rng {
  return mulberry32(hashSeed(...identity));
}

const f = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

const jitter = (rng: Rng, amp: number): number => (rng() * 2 - 1) * amp;

export function distance(a: BoardPoint, b: BoardPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Total length of a polyline in board units. */
export function polylineLength(points: BoardPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += distance(a, b);
  }
  return total;
}

/** Resample a polyline to roughly even spacing, so wobble bites evenly along a long straight line. */
export function resample(points: BoardPoint[], spacing: number): BoardPoint[] {
  if (points.length < 2 || spacing <= 0) return points.slice();
  const out: BoardPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    if (out.length === 0) out.push(a);
    const seg = distance(a, b);
    const steps = Math.max(1, Math.round(seg / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length > 0 ? out : points.slice();
}

/** A smooth quadratic-through-midpoints path — one flowing hand stroke, not a chain of corners. */
export function smoothPath(points: BoardPoint[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length < 3) {
    return points.map((p, i) => `${i ? 'L' : 'M'} ${f(p[0])} ${f(p[1])}`).join(' ');
  }
  let d = `M ${f(first[0])} ${f(first[1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!p || !next) continue;
    d += ` Q ${f(p[0])} ${f(p[1])} ${f((p[0] + next[0]) / 2)} ${f((p[1] + next[1]) / 2)}`;
  }
  const last = points[points.length - 1];
  return last ? `${d} L ${f(last[0])} ${f(last[1])}` : d;
}

/** A straight polyline path with hard corners — for rules, ticks and table lines. */
export function linePath(points: BoardPoint[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${f(p[0])} ${f(p[1])}`).join(' ');
}

export interface PenOptions {
  /** Wobble amplitude in board units. 0 = a ruler (axes, table rules). */
  wobble?: number;
  /** Lead-in length before the first point, as a fraction of stroke length. */
  anticipation?: number;
  /** How far past the last point the nib runs, as a fraction of stroke length. */
  overshoot?: number;
  /** Close the shape back to its first point. */
  closed?: boolean;
  /** Resample spacing; smaller = more wobble detail, more path data. */
  spacing?: number;
}

const DEFAULTS: Required<PenOptions> = {
  wobble: 0.9,
  anticipation: 0.012,
  overshoot: 0.018,
  closed: false,
  spacing: 14,
};

/** Unit direction from a to b; [0,0] when they coincide. */
function direction(a: BoardPoint, b: BoardPoint): BoardPoint {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len > 0 ? [dx / len, dy / len] : [0, 0];
}

/**
 * Turn a polyline into one hand-drawn stroke: anticipation in, wobble along, overshoot past the
 * end, then settle back onto the true endpoint.
 */
export function penStroke(points: BoardPoint[], rng: Rng, opts: PenOptions = {}): Stroke {
  const o = { ...DEFAULTS, ...opts };
  const src = o.closed && points.length > 2 ? [...points, points[0] as BoardPoint] : points;
  if (src.length < 2) {
    const p = src[0];
    if (!p) return { d: '', length: 0 };
    return { d: `M ${f(p[0])} ${f(p[1])} l 0.01 0`, length: 0.01 };
  }
  const base = polylineLength(src);
  const dense = resample(src, o.spacing);
  const start = dense[0] as BoardPoint;
  const second = (dense[1] ?? start) as BoardPoint;
  const end = dense[dense.length - 1] as BoardPoint;
  const penultimate = (dense[dense.length - 2] ?? end) as BoardPoint;

  const path: BoardPoint[] = [];
  // Anticipation: the nib touches down slightly behind the stroke and takes off into it.
  const inDir = direction(second, start);
  const lead = base * o.anticipation;
  if (lead > 0.05 && !o.closed) {
    path.push([start[0] + inDir[0] * lead, start[1] + inDir[1] * lead]);
  }
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i] as BoardPoint;
    // Ends stay honest: the wobble tapers to nothing at the anchor points.
    const t = dense.length > 1 ? i / (dense.length - 1) : 0;
    const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    const amp = o.wobble * taper;
    path.push(amp > 0 ? [p[0] + jitter(rng, amp), p[1] + jitter(rng, amp)] : p);
  }
  // Overshoot, then settle back onto the true end.
  const outDir = direction(penultimate, end);
  const over = base * o.overshoot;
  if (over > 0.05 && !o.closed) {
    path.push([end[0] + outDir[0] * over, end[1] + outDir[1] * over]);
    path.push([end[0] + outDir[0] * over * 0.15, end[1] + outDir[1] * over * 0.15]);
  }
  return { d: smoothPath(path), length: polylineLength(path) };
}

/** A ruled stroke — no wobble, no overshoot. Axes, table rules, fraction bars. */
export function ruledStroke(points: BoardPoint[]): Stroke {
  return { d: linePath(points), length: polylineLength(points) };
}

/** A closed shape used as a fill (a wash, an arrowhead). Blooms with its owner; never draws on. */
export function fillStroke(points: BoardPoint[]): Stroke {
  const d = points.length > 1 ? `${linePath(points)} Z` : '';
  return { d, length: 0, fill: true };
}

// --- Timing -----------------------------------------------------------------------------------------

/** Board units the nib covers per millisecond. A hand, not a plotter. */
export const PEN_UNITS_PER_MS = 0.5;
export const MIN_STROKE_MS = 180;
export const MAX_STROKE_MS = 2400;

/** How long an object of this total stroke length takes to draw, with a seeded ±10% variation. */
export function strokeDurationMs(length: number, rng?: Rng): number {
  const variance = rng ? 0.9 + rng() * 0.2 : 1;
  const raw = (length / PEN_UNITS_PER_MS) * variance;
  return Math.max(MIN_STROKE_MS, Math.min(MAX_STROKE_MS, raw));
}

/**
 * The trace's clock, in screen px (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace): a ring closes in 300
 * to 600 ms whatever its size; an underline, a bracket and an arrow take their length; a tick, a
 * cross and a point are a flick of the wrist. `lengthPx` is the pen's travel in CSS px, which on
 * the glass is the geometry's own length. Every answer sits inside the hand's floor and ceiling.
 */
export const TRACE_PX_PER_MS = 0.75;
const TRACE_MS: Partial<Record<string, [min: number, max: number]>> = {
  circle: [300, 600],
  ring: [300, 600],
  tick: [220, 320],
  cross: [240, 380],
  point: [220, 340],
};

export function traceDurationMs(kind: string, lengthPx: number): number {
  const raw = Math.max(0, lengthPx) / TRACE_PX_PER_MS;
  const band = TRACE_MS[kind];
  const [lo, hi] = band ?? [MIN_STROKE_MS, MAX_STROKE_MS];
  return Math.round(Math.max(lo, Math.min(hi, raw)));
}

export interface StrokeSlot {
  /** Fraction of the object's draw time when this stroke starts. */
  from: number;
  /** Fraction when it finishes. */
  to: number;
}

/**
 * Share an object's draw time across its strokes in proportion to their length, so a long axis
 * takes longer than the tick on its end and the whole thing still lands on its beat.
 */
export function sequenceStrokes(strokes: Stroke[]): StrokeSlot[] {
  const total = strokes.reduce((sum, s) => sum + Math.max(s.length, 0), 0);
  if (total <= 0) {
    const each = strokes.length > 0 ? 1 / strokes.length : 1;
    return strokes.map((_, i) => ({ from: i * each, to: (i + 1) * each }));
  }
  const slots: StrokeSlot[] = [];
  let acc = 0;
  for (const s of strokes) {
    const share = Math.max(s.length, 0) / total;
    slots.push({ from: acc, to: acc + share });
    acc += share;
  }
  return slots;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
/** Ease-out cubic: the nib decelerates into the finish of a stroke, the way a hand lifts. */
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** How far along one stroke the nib is, given the object's overall 0..1 progress. */
export function strokeProgress(objectProgress: number, slot: StrokeSlot): number {
  const span = slot.to - slot.from;
  if (span <= 0) return objectProgress >= slot.to ? 1 : 0;
  return clamp01((objectProgress - slot.from) / span);
}

/** Object progress 0..1 from the utterance clock. Reduced motion lands the whole object at once. */
export function objectProgress(
  nowMs: number,
  startMs: number,
  durMs: number,
  reduced = false,
): number {
  if (reduced) return nowMs >= startMs ? 1 : 0;
  if (durMs <= 0) return nowMs >= startMs ? 1 : 0;
  return clamp01((nowMs - startMs) / durMs);
}

/** Dash props that reveal a path along its own length. Progress 1 = fully drawn. */
export function dashFor(progress: number): {
  pathLength: number;
  strokeDasharray: string;
  strokeDashoffset: number;
} {
  return {
    pathLength: 1,
    strokeDasharray: '1',
    strokeDashoffset: 1 - easeOutCubic(clamp01(progress)),
  };
}

/** 1 while the ink is alive, ramping to 0 across the last `fade` ms of its life. */
export function fadeOpacity(age: number, ttl: number | undefined, fade = 480): number {
  if (ttl === undefined || !Number.isFinite(ttl)) return 1;
  if (age >= ttl) return 0;
  if (age <= ttl - fade) return 1;
  return Math.max(0, (ttl - age) / fade);
}

// --- The pen sound ------------------------------------------------------------------------------------

/**
 * A tick as the nib lands — a few milliseconds of filtered noise, synthesized, no asset. It shares
 * the app's one mute switch: `speech.tsx` writes this key and fires this event, so muting Wobo's voice
 * mutes Wobo's pen. Read, never written, from here.
 */
const MUTE_KEY = 'wobo-voice-muted-v1';
const MUTE_EVENT = 'wobo-mute-changed';

let muted: boolean | null = null;

export function isPenMuted(): boolean {
  if (muted !== null) return muted;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    muted = false;
  }
  return muted;
}

if (typeof window !== 'undefined') {
  window.addEventListener(MUTE_EVENT, () => {
    muted = null;
  });
}

let audio: AudioContext | null = null;
let lastTick = 0;
/** Never more than one tick per this many ms — reduced motion lands a whole plan at once. */
const TICK_THROTTLE_MS = 55;

/**
 * Open the pen's audio before the first stroke needs it. Creating the context is the one slow
 * thing the tick does: on a fresh browser process it can block the main thread for the better
 * part of a second (887 ms measured in headless Chromium on macOS), and when that happened on the
 * render path of the first mark the stroke landed 900 ms after the word that named it. The
 * conductor calls this as a turn opens, so the cost is paid while the brain is still being waited
 * on. Idempotent, and silent when the pen is muted.
 */
export function warmPen(): void {
  if (isPenMuted()) return;
  penAudio();
}

/** True once the pen's audio is open, so a bench can wait for it the way it waits for the font. */
export function penReady(): boolean {
  return audio !== null || isPenMuted() || typeof window === 'undefined';
}

function penAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audio) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audio = new Ctor();
    }
    return audio;
  } catch {
    return null;
  }
}

/**
 * Tick once, quietly, as a stroke begins. Silent when muted, throttled so a burst of strokes is a
 * pen on a board and not a rattle. Fails closed: any audio problem is simply no sound.
 */
export function penTick(strength = 1): void {
  if (isPenMuted()) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastTick < TICK_THROTTLE_MS) return;
  lastTick = now;
  const ctx = penAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.012));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Noise under a fast exponential decay — a nib touching down, not a click track.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 4;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.035 * Math.max(0, Math.min(1, strength));
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // The pen is silent rather than broken.
  }
}

/** Test seam: forget the cached mute state (the storage read is memoised). */
export function resetPenMuteCache(): void {
  muted = null;
}
