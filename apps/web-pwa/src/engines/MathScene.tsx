'use client';

/**
 * MathScene — the math scene renderer (SUBJECTS.md §5-math). One spec-driven component that turns a
 * verified scene spec into a live, draggable Mafs canvas for five scene kinds:
 *   plot        — functions on axes; drag a point, both sides of an equation move until they meet.
 *   geometry    — draggable vertices; area / height read out live (Mafs Point + Polygon).
 *   numberline  — slide a bead along a line to where an expression lands on zero.
 *   areaProof   — (a+b)² split into a² + 2ab + b², every piece resizing with the sliders.
 *   probability — a unit square whose overlap is P(A)·P(B), two sliders for the two events.
 *
 * Rendered with Mafs (SUBJECTS.md §7: Mafs is the math renderer; JSXGraph is reserved for heavy
 * draggable Euclidean constructions none of these kinds need). Every coordinate and every readout
 * is either a number OR an arithmetic expression over the draggable handle values — evaluated by
 * SimRunner's safe recursive-descent parser, never eval / never Function.
 *
 * Wobo-drivable: registers as a scene target with getSceneState / getValidActions / applyTutorAction
 * and publishes its working state to the bus, so Wobo reasons about it at code level and can drag a
 * handle directly to demonstrate. Both themes (Mafs vars bound to the app's ink tokens), reduced-motion
 * aware, mute-aware sfx.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Coordinates, Line, Mafs, MovablePoint, Plot, Point, Polygon, Text } from 'mafs';
import 'mafs/core.css';
import './mathscene.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import { CardBody, cardTitle, lead, whisper } from '../screens/course/shared';
import { sfx } from '../ui/sound';
import { evaluateExpr, formatSimNumber } from './SimRunner';

// --- The spec ------------------------------------------------------------------------------------

export type MathSceneKind = 'plot' | 'geometry' | 'numberline' | 'areaProof' | 'probability';

/** A number OR an arithmetic string over the handle ids (so drawings track the values live). */
export type NumOrExpr = number | string;

/** How a draggable handle moves. 'x'/'y' are constrained sliders on a track; 'free' is a 2D point. */
export interface MathHandle {
  id: string;
  label: string;
  along: 'x' | 'y' | 'free';
  min: number;
  max: number;
  /** Track sliders ('x'/'y'). */
  initial?: number;
  /** Fixed coordinate of the track: y for an 'x' slider, x for a 'y' slider. */
  at?: number;
  /** Free 2D point. */
  initialX?: number;
  initialY?: number;
}

export interface MathReadout {
  id: string;
  label: string;
  /** Arithmetic over the handle values (an 'x'/'y' handle binds `id`; a 'free' binds `idx`,`idy`). */
  expr: string;
  unit?: string;
  /** When the value reaches this (±1e-6) the scene reads as solved — a quiet glow + one chime. */
  solveTarget?: number;
}

export type MathTone = 'ink' | 'muted' | 'hue';

export interface MathCurve {
  id: string;
  /** y as a function of x, e.g. "2*x + 1" — evaluated with the live handle values plus `x`. */
  expr: string;
  color?: MathTone;
  label?: string;
}

export interface MathPoly {
  id: string;
  points: [NumOrExpr, NumOrExpr][];
  color?: MathTone;
  fill?: boolean;
  label?: string;
  labelAt?: [NumOrExpr, NumOrExpr];
}

export interface MathSegment {
  id: string;
  from: [NumOrExpr, NumOrExpr];
  to: [NumOrExpr, NumOrExpr];
  color?: MathTone;
  dashed?: boolean;
}

export interface MathPoint {
  id: string;
  at: [NumOrExpr, NumOrExpr];
  color?: MathTone;
}

export interface MathLabel {
  id: string;
  at: [NumOrExpr, NumOrExpr];
  /** Text template — {id} tokens fill from the live values. */
  text: string;
}

export interface MathSceneSpec {
  id: string;
  kind: MathSceneKind;
  title: string;
  caption?: string;
  view: { x: [number, number]; y: [number, number] };
  handles: MathHandle[];
  readouts?: MathReadout[];
  curves?: MathCurve[];
  polys?: MathPoly[];
  segments?: MathSegment[];
  points?: MathPoint[];
  labels?: MathLabel[];
}

// --- Validation (client parity with the gateway _ok_mathscene gate — a malformed field is dropped,
// a malformed scene returns null and the caller falls back to the seed journey) --------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KINDS: ReadonlySet<string> = new Set([
  'plot',
  'geometry',
  'numberline',
  'areaProof',
  'probability',
]);
const TONES: ReadonlySet<string> = new Set(['ink', 'muted', 'hue']);

const numOrExpr = (v: unknown): NumOrExpr | undefined => (num(v) ? v : str(v) ? v : undefined);
const tone = (v: unknown): MathTone | undefined =>
  typeof v === 'string' && TONES.has(v) ? (v as MathTone) : undefined;

function parsePair(v: unknown): [NumOrExpr, NumOrExpr] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const a = numOrExpr(v[0]);
  const b = numOrExpr(v[1]);
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

function parseHandle(raw: unknown): MathHandle | null {
  if (!isRecord(raw)) return null;
  const { id, label, along, min, max } = raw;
  if (typeof id !== 'string' || !IDENT_RE.test(id) || !str(label)) return null;
  if (along !== 'x' && along !== 'y' && along !== 'free') return null;
  if (!num(min) || !num(max) || min >= max) return null;
  const clampTo = (n: number) => Math.max(min, Math.min(max, n));
  if (along === 'free') {
    return {
      id,
      label,
      along,
      min,
      max,
      initialX: clampTo(num(raw.initialX) ? raw.initialX : (min + max) / 2),
      initialY: clampTo(num(raw.initialY) ? raw.initialY : (min + max) / 2),
    };
  }
  return {
    id,
    label,
    along,
    min,
    max,
    initial: clampTo(num(raw.initial) ? raw.initial : (min + max) / 2),
    at: num(raw.at) ? raw.at : 0,
  };
}

function parseReadout(raw: unknown): MathReadout | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.label) || !str(raw.expr)) return null;
  return {
    id: raw.id,
    label: raw.label,
    expr: raw.expr,
    unit: str(raw.unit) ? raw.unit : undefined,
    solveTarget: num(raw.solveTarget) ? raw.solveTarget : undefined,
  };
}

function parseList<T>(raw: unknown, one: (v: unknown) => T | null): T[] {
  return (Array.isArray(raw) ? raw : []).map(one).filter((v): v is T => v !== null);
}

function parsePoly(raw: unknown): MathPoly | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map(parsePair)
    .filter((p): p is [NumOrExpr, NumOrExpr] => p !== undefined);
  if (points.length < 3) return null;
  return {
    id: raw.id,
    points,
    color: tone(raw.color),
    fill: raw.fill !== false,
    label: str(raw.label) ? raw.label : undefined,
    labelAt: parsePair(raw.labelAt),
  };
}

function parseSegment(raw: unknown): MathSegment | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  const from = parsePair(raw.from);
  const to = parsePair(raw.to);
  if (!from || !to) return null;
  return { id: raw.id, from, to, color: tone(raw.color), dashed: raw.dashed === true };
}

function parsePoint(raw: unknown): MathPoint | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  const at = parsePair(raw.at);
  return at ? { id: raw.id, at, color: tone(raw.color) } : null;
}

function parseLabel(raw: unknown): MathLabel | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.text)) return null;
  const at = parsePair(raw.at);
  return at ? { id: raw.id, at, text: raw.text } : null;
}

function parseCurve(raw: unknown): MathCurve | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.expr)) return null;
  return {
    id: raw.id,
    expr: raw.expr,
    color: tone(raw.color),
    label: str(raw.label) ? raw.label : undefined,
  };
}

function parseRange(raw: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(raw) && num(raw[0]) && num(raw[1]) && raw[0] < raw[1]) return [raw[0], raw[1]];
  return fallback;
}

/** Turn a generated (or hand-authored) blob into a runnable scene; null when nothing valid survives. */
export function parseMathScene(raw: unknown): MathSceneSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.spec) ? raw.spec : raw;
  if (src.verified === false) return null;
  if (typeof src.kind !== 'string' || !KINDS.has(src.kind)) return null;
  const kind = src.kind as MathSceneKind;
  const handles = parseList(src.handles, parseHandle);
  if (handles.length === 0 || handles.length > 4) return null;
  const view = isRecord(src.view) ? src.view : {};
  const scene: MathSceneSpec = {
    id: str(src.id) ? src.id : 'mathscene',
    kind,
    title: str(src.title) ? src.title : 'a math scene',
    caption: str(src.caption) ? src.caption : undefined,
    view: { x: parseRange(view.x, [-1, 6]), y: parseRange(view.y, [-1, 6]) },
    handles,
    readouts: parseList(src.readouts, parseReadout),
    curves: parseList(src.curves, parseCurve),
    polys: parseList(src.polys, parsePoly),
    segments: parseList(src.segments, parseSegment),
    points: parseList(src.points, parsePoint),
    labels: parseList(src.labels, parseLabel),
  };
  // The kind must carry the render primitive it needs, or there is nothing to see.
  const hasBody =
    (kind === 'plot' && ((scene.curves?.length ?? 0) > 0 || (scene.points?.length ?? 0) > 0)) ||
    (kind === 'numberline' &&
      ((scene.segments?.length ?? 0) > 0 || (scene.points?.length ?? 0) > 0)) ||
    (scene.polys?.length ?? 0) > 0;
  if (!hasBody) return null;
  // Every expression must actually evaluate at the initial values — a spec that cannot run is refused.
  const vars0 = handleVars(handles, initialState(handles));
  const probe = (e: string, extra: State = {}) => evaluateExpr(e, { ...vars0, ...extra }) !== null;
  const curvesOk = (scene.curves ?? []).every((c) => probe(c.expr, { x: scene.view.x[0] }));
  const readoutsOk = (scene.readouts ?? []).every((r) => probe(r.expr));
  const coords: [NumOrExpr, NumOrExpr][] = [
    ...(scene.polys ?? []).flatMap((p) => [...p.points, ...(p.labelAt ? [p.labelAt] : [])]),
    ...(scene.segments ?? []).flatMap((s) => [s.from, s.to]),
    ...(scene.points ?? []).map((p) => p.at),
    ...(scene.labels ?? []).map((l) => l.at),
  ];
  const coordsOk = coords.every(
    ([x, y]) => (typeof x === 'number' || probe(x)) && (typeof y === 'number' || probe(y)),
  );
  return curvesOk && readoutsOk && coordsOk ? scene : null;
}

// --- Handle state <-> expression variables --------------------------------------------------------

type State = Record<string, number>;

function initialState(handles: MathHandle[]): State {
  const s: State = {};
  for (const h of handles) {
    if (h.along === 'free') {
      s[`${h.id}x`] = h.initialX ?? 0;
      s[`${h.id}y`] = h.initialY ?? 0;
    } else {
      s[h.id] = h.initial ?? 0;
    }
  }
  return s;
}

/** The variables an expression may reference — the same keys the state holds. */
function handleVars(handles: MathHandle[], state: State): State {
  const v: State = {};
  for (const h of handles) {
    if (h.along === 'free') {
      v[`${h.id}x`] = state[`${h.id}x`] ?? 0;
      v[`${h.id}y`] = state[`${h.id}y`] ?? 0;
    } else {
      v[h.id] = state[h.id] ?? 0;
    }
  }
  return v;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// --- Colour (both themes: Mafs primitives take a CSS colour; ink tokens flip with the app theme) --

function toneColor(t: MathTone | undefined, hue: string): string {
  if (t === 'hue') return hue;
  if (t === 'muted') return 'var(--wobo-ink-300)';
  return 'var(--wobo-ink-700)';
}

// The Mafs theme lives in ./mathscene.css, on .MafsView itself: mafs/core.css sets black-on-white
// there, and a wrapper's variables never reached it (SCORECARD.md 3.5 #15).

/** Mafs adds this many units of padding on every side of the declared view. */
const VIEW_PAD = 0.4;
const FRAME_MIN = 220;
const FRAME_MAX = 480;

/**
 * The canvas frame for a declared view. `preserveAspectRatio="contain"` on a fixed 340 px height
 * widened every scene to fill the box, so the spec's x-domain of [-1, 6] was shown as roughly
 * [-6, 11] and the handles huddled in the middle (SCORECARD.md 3.5 #15). The height now follows
 * the view's own shape, so contain has nothing to add. When the clamp stops it following, a plot
 * or a number line keeps the declared domain and lets its two axes scale apart (as any graph
 * paper does), while a shape scene keeps true proportions: a square must look square.
 */
export function mafsFrame(
  kind: MathSceneKind,
  view: MathSceneSpec['view'],
  width: number,
): { height: number; preserveAspectRatio: 'contain' | false } {
  const w = width > 0 ? width : 350;
  const xr = view.x[1] - view.x[0] + 2 * VIEW_PAD;
  const yr = view.y[1] - view.y[0] + 2 * VIEW_PAD;
  const ideal = (w * yr) / xr;
  const height = clamp(ideal, FRAME_MIN, FRAME_MAX);
  const follows = Math.abs(ideal - height) < 1;
  const trueShape = kind === 'geometry' || kind === 'areaProof' || kind === 'probability';
  return { height, preserveAspectRatio: follows || trueShape ? 'contain' : false };
}

function fillTemplate(text: string, vars: State): string {
  return text.replace(/\{(\w+)\}/g, (_, id) =>
    id in vars ? formatSimNumber(vars[id] ?? null) : `{${id}}`,
  );
}

// --- A readout number that fades/rises when it changes (respecting reduced motion) ----------------

function LiveNumber({ children, still }: { children: string; still: boolean }) {
  if (still) return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{children}</span>;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={children}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ type: 'spring', stiffness: 480, damping: 32 }}
        style={{ display: 'inline-block', fontVariantNumeric: 'tabular-nums' }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

// --- The renderer ---------------------------------------------------------------------------------

export function MathScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: MathSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const reduced = useReducedMotion() ?? false;
  const [state, setState] = useState<State>(() => initialState(spec.handles));
  const [touched, setTouched] = useState(false);
  const solvedRef = useRef<Set<string>>(new Set());

  const vars = useMemo(() => handleVars(spec.handles, state), [spec.handles, state]);

  const readouts = (spec.readouts ?? []).map((r) => ({ ...r, value: evaluateExpr(r.expr, vars) }));

  // Which readouts have reached their solve target this frame — a quiet glow + one chime on arrival.
  const solvedNow = new Set(
    readouts
      .filter(
        (r) =>
          r.solveTarget !== undefined &&
          r.value !== null &&
          Math.abs(r.value - r.solveTarget) < 1e-6,
      )
      .map((r) => r.id),
  );
  useEffect(() => {
    for (const id of solvedNow) {
      if (!solvedRef.current.has(id)) {
        solvedRef.current.add(id);
        sfx.reveal();
      }
    }
    for (const id of Array.from(solvedRef.current))
      if (!solvedNow.has(id)) solvedRef.current.delete(id);
  });

  const move = (patch: State) => {
    setState((prev) => ({ ...prev, ...patch }));
    if (!touched) {
      setTouched(true);
      sfx.tap();
    }
  };

  // one drag unlocks continue (act-to-reveal)
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !touched, onClick: onDone } });
  }, [touched, setBar, onDone]);

  // Wobo reads the live scene and can drive a handle directly to demonstrate.
  const applyTutorAction = (raw: Record<string, unknown>) => {
    const set = isRecord(raw.set) ? raw.set : raw;
    const id = typeof set.id === 'string' ? set.id : undefined;
    const h = spec.handles.find((x) => x.id === id);
    if (!h) return;
    if (h.along === 'free') {
      const x = num(set.x) ? set.x : num(set.value) ? set.value : undefined;
      const y = num(set.y) ? set.y : undefined;
      const patch: State = {};
      if (x !== undefined) patch[`${h.id}x`] = clamp(x, h.min, h.max);
      if (y !== undefined) patch[`${h.id}y`] = clamp(y, h.min, h.max);
      if (Object.keys(patch).length) move(patch);
    } else if (num(set.value)) {
      move({ [h.id]: clamp(set.value, h.min, h.max) });
    }
  };

  // The rendered width, so the frame can follow the declared view (mafsFrame).
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrameWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frame = mafsFrame(spec.kind, spec.view, frameWidth);

  const ref = useRegisterTarget<HTMLDivElement>(`mathscene-${spec.id}`, {
    kind: 'scene',
    label: `the ${spec.kind} scene "${spec.title}" — every handle is draggable`,
    getSceneState: () => ({
      handles: spec.handles.map((h) =>
        h.along === 'free'
          ? `${h.label} = (${formatSimNumber(state[`${h.id}x`] ?? 0)}, ${formatSimNumber(state[`${h.id}y`] ?? 0)})`
          : `${h.label} = ${formatSimNumber(state[h.id] ?? 0)}`,
      ),
      readouts: readouts.map(
        (r) => `${r.label} = ${formatSimNumber(r.value)}${r.unit ? ` ${r.unit}` : ''}`,
      ),
    }),
    getValidActions: () => spec.handles.map((h) => `drag ${h.label}`),
    applyTutorAction,
  });

  // Wobo reads the working at code level; cleared when the scene unmounts
  // biome-ignore lint/correctness/useExhaustiveDependencies: readouts is derived from state each render
  useEffect(() => {
    bus.publishCanvas({
      nodeId: `mathscene-${spec.id}`,
      steps: [
        ...spec.handles.map((h) =>
          h.along === 'free'
            ? `${h.label} = (${formatSimNumber(state[`${h.id}x`] ?? 0)}, ${formatSimNumber(state[`${h.id}y`] ?? 0)})`
            : `${h.label} = ${formatSimNumber(state[h.id] ?? 0)}`,
        ),
        ...readouts.map((r) => `${r.label} = ${formatSimNumber(r.value)}`),
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, state]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  // Resolve a coordinate (number or expression over the live vars) to a plain number.
  const res = (c: NumOrExpr): number => {
    if (typeof c === 'number') return c;
    const v = evaluateExpr(c, vars);
    return v === null || !Number.isFinite(v) ? 0 : v;
  };
  const pt = (p: [NumOrExpr, NumOrExpr]): [number, number] => [res(p[0]), res(p[1])];

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={whisper}>{spec.kind} — drag it and watch the numbers move</div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <div
          ref={ref}
          className="wobo-mathscene"
          style={{
            borderRadius: 'var(--wobo-radius-md)',
            overflow: 'hidden',
            border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
            background: 'var(--wobo-paper)',
          }}
        >
          <div ref={frameRef}>
            <Mafs
              height={frame.height}
              pan={false}
              zoom={false}
              preserveAspectRatio={frame.preserveAspectRatio}
              viewBox={{ x: spec.view.x, y: spec.view.y, padding: VIEW_PAD }}
            >
              <Coordinates.Cartesian
                subdivisions={2}
                xAxis={spec.kind === 'probability' ? { labels: false } : undefined}
                yAxis={
                  spec.kind === 'numberline'
                    ? false
                    : spec.kind === 'probability'
                      ? { labels: false }
                      : undefined
                }
              />

              {/* polygons — filled tactile bodies (areaProof / probability / geometry) */}
              {(spec.polys ?? []).map((p) => (
                <Polygon
                  key={p.id}
                  points={p.points.map(pt)}
                  color={toneColor(p.color, hue)}
                  fillOpacity={p.fill === false ? 0 : 0.16}
                  strokeStyle="solid"
                  weight={2}
                />
              ))}

              {/* segments — axes, guides, reach lines */}
              {(spec.segments ?? []).map((s) => (
                <Line.Segment
                  key={s.id}
                  point1={pt(s.from)}
                  point2={pt(s.to)}
                  color={toneColor(s.color, hue)}
                  weight={s.dashed ? 2 : 2.5}
                  style={s.dashed ? 'dashed' : 'solid'}
                />
              ))}

              {/* curves — y = f(x) plotted with the live handle values */}
              {(spec.curves ?? []).map((c) => (
                <Plot.OfX
                  key={c.id}
                  y={(x) => {
                    const v = evaluateExpr(c.expr, { ...vars, x });
                    return v === null ? Number.NaN : v;
                  }}
                  color={toneColor(c.color, hue)}
                  weight={2.5}
                />
              ))}

              {/* fixed points */}
              {(spec.points ?? []).map((p) => {
                const [x, y] = pt(p.at);
                return <Point key={p.id} x={x} y={y} color={toneColor(p.color, hue)} />;
              })}

              {/* text labels, templated with the live values */}
              {(spec.labels ?? []).map((l) => {
                const [x, y] = pt(l.at);
                return (
                  <Text key={l.id} x={x} y={y} size={16} color="var(--wobo-ink-700)">
                    {fillTemplate(l.text, vars)}
                  </Text>
                );
              })}
              {(spec.polys ?? []).flatMap((p) =>
                p.label && p.labelAt
                  ? [
                      <Text
                        key={`${p.id}-label`}
                        x={res(p.labelAt[0])}
                        y={res(p.labelAt[1])}
                        size={16}
                        color="var(--wobo-ink-700)"
                      >
                        {fillTemplate(p.label, vars)}
                      </Text>,
                    ]
                  : [],
              )}

              {/* the draggable handles — points and sliders, live-bound to the expressions */}
              {spec.handles.map((h) => {
                if (h.along === 'free') {
                  return (
                    <MovablePoint
                      key={h.id}
                      color={hue}
                      point={[state[`${h.id}x`] ?? 0, state[`${h.id}y`] ?? 0]}
                      onMove={([x, y]) =>
                        move({
                          [`${h.id}x`]: clamp(x, h.min, h.max),
                          [`${h.id}y`]: clamp(y, h.min, h.max),
                        })
                      }
                    />
                  );
                }
                const at = h.at ?? 0;
                const val = state[h.id] ?? 0;
                // A constrain FUNCTION pins the point to its track and clamps to range (the component's
                // `constrain` takes a mapper, not the hook's "horizontal"/"vertical" string).
                const constrain = ([x, y]: [number, number]): [number, number] =>
                  h.along === 'x' ? [clamp(x, h.min, h.max), at] : [at, clamp(y, h.min, h.max)];
                return (
                  <MovablePoint
                    key={h.id}
                    color={hue}
                    constrain={constrain}
                    point={h.along === 'x' ? [val, at] : [at, val]}
                    onMove={([x, y]) => move({ [h.id]: h.along === 'x' ? x : y })}
                  />
                );
              })}
            </Mafs>
          </div>
        </div>

        {/* the live readouts */}
        {readouts.length > 0 && (
          <div
            style={{
              border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
              borderRadius: 'var(--wobo-radius-md)',
              padding: '4px 18px',
              background: 'var(--wobo-paper)',
            }}
          >
            {readouts.map((r, i) => {
              const solved = solvedNow.has(r.id);
              return (
                <div key={r.id}>
                  {i > 0 && (
                    <div
                      style={{
                        height: 1,
                        transform: 'scaleY(0.5)',
                        background: 'var(--wobo-hairline-on-paper)',
                      }}
                    />
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: '4px 18px',
                      padding: '11px 0',
                    }}
                  >
                    <div style={{ fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>
                      {r.label}
                    </div>
                    <div
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 560,
                        color: solved ? hue : 'var(--wobo-ink-900)',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 6,
                        transition: 'color 200ms ease',
                      }}
                    >
                      <LiveNumber still={reduced}>{formatSimNumber(r.value)}</LiveNumber>
                      {r.unit && <span style={whisper}>{r.unit}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </CardBody>
  );
}

// --- Demos — one per scene kind (rendered on the #engines bench) -----------------------------------

/** The flagship proof: drag x and the left and right sides of 2x + 1 = x + 4 move until they meet (x = 3). */
export const MATHSCENE_PLOT_DEMO: MathSceneSpec = {
  id: 'balance-plot',
  kind: 'plot',
  title: 'both sides of the equation',
  caption:
    'drag x along the axis — the two lines are the two sides of 2x + 1 = x + 4. they meet at the answer.',
  view: { x: [-1, 6], y: [-1, 10] },
  handles: [{ id: 'x', label: 'x', along: 'x', at: 0, min: -1, max: 6, initial: 0.5 }],
  curves: [
    { id: 'lhs', expr: '2*x + 1', color: 'hue', label: '2x + 1' },
    { id: 'rhs', expr: 'x + 4', color: 'ink', label: 'x + 4' },
  ],
  segments: [{ id: 'guide', from: ['x', 0], to: ['x', 9], color: 'muted', dashed: true }],
  points: [
    { id: 'pl', at: ['x', '2*x + 1'], color: 'hue' },
    { id: 'pr', at: ['x', 'x + 4'], color: 'ink' },
  ],
  labels: [{ id: 'lx', at: ['x', -0.6], text: 'x = {x}' }],
  readouts: [
    { id: 'l', label: 'left side · 2x + 1', expr: '2*x + 1' },
    { id: 'r', label: 'right side · x + 4', expr: 'x + 4' },
    {
      id: 'gap',
      label: 'difference (drag to zero)',
      expr: 'abs((2*x + 1) - (x + 4))',
      solveTarget: 0,
    },
  ],
};

export const MATHSCENE_GEOMETRY_DEMO: MathSceneSpec = {
  id: 'triangle-area',
  kind: 'geometry',
  title: 'area lives in the height',
  caption:
    'drag the apex. the base stays 6 — slide sideways and the area never changes; only height matters.',
  view: { x: [-1, 7], y: [-1, 6] },
  handles: [{ id: 'C', label: 'apex', along: 'free', min: -1, max: 6, initialX: 2, initialY: 4 }],
  polys: [
    {
      id: 'tri',
      points: [
        [0, 0],
        [6, 0],
        ['Cx', 'Cy'],
      ],
      color: 'hue',
      labelAt: [3, -0.5],
    },
  ],
  points: [
    { id: 'A', at: [0, 0], color: 'ink' },
    { id: 'B', at: [6, 0], color: 'ink' },
  ],
  labels: [
    { id: 'la', at: [-0.4, -0.5], text: 'A' },
    { id: 'lb', at: [6.3, -0.5], text: 'B' },
    { id: 'lc', at: ['Cx + 0.3', 'Cy + 0.3'], text: 'C' },
  ],
  readouts: [
    { id: 'h', label: 'height', expr: 'abs(Cy)' },
    { id: 'area', label: 'area = ½ · 6 · height', expr: '3 * abs(Cy)' },
  ],
};

export const MATHSCENE_NUMBERLINE_DEMO: MathSceneSpec = {
  id: 'zero-line',
  kind: 'numberline',
  title: 'find where it equals zero',
  caption: 'slide x along the line until 2x − 4 lands exactly on zero.',
  view: { x: [-2, 8], y: [-1.5, 1.5] },
  handles: [{ id: 'x', label: 'x', along: 'x', at: 0, min: -2, max: 8, initial: 0.5 }],
  segments: [
    { id: 'axis', from: [-2, 0], to: [8, 0], color: 'muted' },
    { id: 'reach', from: [0, 0], to: ['x', 0], color: 'hue' },
  ],
  points: [
    { id: 'origin', at: [0, 0], color: 'ink' },
    { id: 'target', at: [2, 0], color: 'muted' },
  ],
  labels: [{ id: 'lx', at: ['x', 0.5], text: 'x = {x}' }],
  readouts: [{ id: 'v', label: '2x − 4 (drag to zero)', expr: '2*x - 4', solveTarget: 0 }],
};

export const MATHSCENE_AREAPROOF_DEMO: MathSceneSpec = {
  id: 'binomial-square',
  kind: 'areaProof',
  title: '(a + b)² unpacked',
  caption:
    'drag the a and b sliders. the big square is always a² + 2ab + b² — read it off the pieces.',
  view: { x: [-1, 12], y: [-3.4, 12] },
  handles: [
    { id: 'a', label: 'a', along: 'x', at: -1.4, min: 1, max: 5, initial: 3 },
    { id: 'b', label: 'b', along: 'x', at: -2.8, min: 1, max: 5, initial: 2 },
  ],
  polys: [
    {
      id: 'aa',
      points: [
        [0, 0],
        ['a', 0],
        ['a', 'a'],
        [0, 'a'],
      ],
      color: 'hue',
      label: 'a²',
      labelAt: ['a/2', 'a/2'],
    },
    {
      id: 'ab1',
      points: [
        ['a', 0],
        ['a + b', 0],
        ['a + b', 'a'],
        ['a', 'a'],
      ],
      color: 'muted',
      label: 'ab',
      labelAt: ['a + b/2', 'a/2'],
    },
    {
      id: 'ab2',
      points: [
        [0, 'a'],
        ['a', 'a'],
        ['a', 'a + b'],
        [0, 'a + b'],
      ],
      color: 'muted',
      label: 'ab',
      labelAt: ['a/2', 'a + b/2'],
    },
    {
      id: 'bb',
      points: [
        ['a', 'a'],
        ['a + b', 'a'],
        ['a + b', 'a + b'],
        ['a', 'a + b'],
      ],
      color: 'ink',
      label: 'b²',
      labelAt: ['a + b/2', 'a + b/2'],
    },
  ],
  labels: [
    { id: 'la', at: ['a', -0.9], text: 'a = {a}' },
    { id: 'lb', at: ['b', -2.3], text: 'b = {b}' },
  ],
  readouts: [
    { id: 'sq', label: '(a + b)²', expr: '(a + b)^2' },
    { id: 'sum', label: 'a² + 2ab + b²', expr: 'a^2 + 2*a*b + b^2' },
  ],
};

export const MATHSCENE_PROBABILITY_DEMO: MathSceneSpec = {
  id: 'joint-probability',
  kind: 'probability',
  title: 'independent events multiply',
  caption:
    'drag the width (P of A) and the height (P of B). the shaded overlap is P of both happening.',
  view: { x: [-0.35, 1.15], y: [-0.35, 1.15] },
  handles: [
    { id: 'pa', label: 'P(A)', along: 'x', at: -0.2, min: 0, max: 1, initial: 0.6 },
    { id: 'pb', label: 'P(B)', along: 'y', at: -0.2, min: 0, max: 1, initial: 0.5 },
  ],
  polys: [
    {
      id: 'unit',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      color: 'muted',
      fill: false,
    },
    {
      id: 'joint',
      points: [
        [0, 0],
        ['pa', 0],
        ['pa', 'pb'],
        [0, 'pb'],
      ],
      color: 'hue',
      label: 'A∩B',
      labelAt: ['pa/2', 'pb/2'],
    },
  ],
  readouts: [
    { id: 'a', label: 'P(A)', expr: 'pa' },
    { id: 'b', label: 'P(B)', expr: 'pb' },
    { id: 'j', label: 'P(A and B) = P(A) · P(B)', expr: 'pa * pb' },
  ],
};

/** All five, in teaching order — the #engines gallery maps over this. */
export const MATHSCENE_DEMOS: MathSceneSpec[] = [
  MATHSCENE_PLOT_DEMO,
  MATHSCENE_GEOMETRY_DEMO,
  MATHSCENE_NUMBERLINE_DEMO,
  MATHSCENE_AREAPROOF_DEMO,
  MATHSCENE_PROBABILITY_DEMO,
];
