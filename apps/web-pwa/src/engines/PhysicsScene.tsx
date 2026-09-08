'use client';

/**
 * PhysicsScene — spec-driven physics (SUBJECTS.md §5-physics). One renderer, three kinds:
 *
 *   • projectile — closed-form kinematics on a custom canvas with live angle + velocity sliders;
 *     dragging the angle redraws the trajectory and the range / height / flight-time readouts.
 *   • freeBody   — labeled force arrows you drag by the tip; the resultant (vector sum) is drawn
 *     and computed live.
 *   • wave       — sine superposition on a canvas; per-component amplitude / frequency sliders,
 *     each wave drawn faint and their sum drawn bold.
 *
 * The physics is EXACT by construction: projectile draws the analytic parabola (no numerical
 * integrator to drift), the free-body resultant is a true vector sum, the wave is a real Fourier
 * sum. Numeric readouts come from the spec's own formulas (evaluated by SimRunner's safe parser —
 * never eval), which the gateway has already proven dimensionally consistent (plexus/dimensions.py)
 * and constant-correct before serving. A wrong constant ships a wrong mental model, so nothing here
 * is "merely plausible".
 *
 * Every kind registers a Wobo scene target (useRegisterTarget): Wobo reads the live state at code
 * level (getSceneState) and can DRIVE it (applyTutorAction) to demonstrate. Mute-aware, both themes,
 * reduced-motion aware.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { useReducedMotion } from 'framer-motion';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import {
  CardBody,
  captionSurface,
  cardTitle,
  equationType,
  lead,
  Stage,
  whisper,
} from '../screens/course/shared';
import { evaluateExpr, formatSimNumber } from './SimRunner';

// --- The spec ------------------------------------------------------------------------------------

export interface PhysicsParam {
  id: string;
  label: string;
  min: number;
  max: number;
  initial: number;
  /** A unit string (e.g. "m/s", "deg", "N") — the gateway dimension-checks formulas against it. */
  unit: string;
}

export interface PhysicsOutput {
  id: string;
  label: string;
  /** Arithmetic over the param ids (and g, pi) — evaluated by SimRunner's safe parser. */
  expr: string;
  unit: string;
}

export interface PhysicsForce {
  id: string;
  label: string;
  /** Magnitude in the force unit (default N). */
  mag: number;
  /** Direction in degrees, measured CCW from +x (east). */
  angle: number;
  unit?: string;
}

export interface WaveComponent {
  id: string;
  amp: number;
  freq: number;
  phase: number;
}

export type PhysicsKind = 'projectile' | 'freeBody' | 'wave';

export interface PhysicsScene {
  id: string;
  kind: PhysicsKind;
  title: string;
  caption?: string;
  law?: string;
  /** Standard gravity for projectile scenes (m/s²); defaults to 9.8. */
  gravity?: number;
  params?: PhysicsParam[];
  outputs?: PhysicsOutput[];
  forces?: PhysicsForce[];
  components?: WaveComponent[];
}

// --- Validation (a spec that cannot run never reaches the learner; refusal → caller falls back) ----

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseParam(raw: unknown): PhysicsParam | null {
  if (!isRecord(raw)) return null;
  const { id, label, min, max, initial, unit } = raw;
  if (!str(id) || !IDENT_RE.test(id) || !str(label)) return null;
  if (!num(min) || !num(max) || min >= max) return null;
  const start = num(initial) ? Math.max(min, Math.min(max, initial)) : (min + max) / 2;
  return { id, label, min, max, initial: start, unit: str(unit) ? unit : '' };
}

function parseOutput(raw: unknown, vars: Record<string, number>): PhysicsOutput | null {
  if (!isRecord(raw)) return null;
  const { id, label, expr, unit } = raw;
  if (!str(id) || !str(label) || !str(expr)) return null;
  if (evaluateExpr(expr, vars) === null) return null; // must actually run at the initial point
  return { id, label, expr, unit: str(unit) ? unit : '' };
}

function parseForce(raw: unknown): PhysicsForce | null {
  if (!isRecord(raw)) return null;
  const { id, label, mag, angle, unit } = raw;
  if (!str(id) || !IDENT_RE.test(id) || !str(label)) return null;
  if (!num(mag) || !num(angle)) return null;
  return { id, label, mag, angle, unit: str(unit) ? unit : 'N' };
}

function parseComponent(raw: unknown): WaveComponent | null {
  if (!isRecord(raw)) return null;
  const { id, amp, freq, phase } = raw;
  if (!str(id) || !num(amp) || !num(freq) || !num(phase)) return null;
  return { id, amp, freq, phase };
}

/** Validate a generated physics scene. Mirrors the gateway shape; a malformed scene returns null. */
export function parsePhysicsScene(raw: unknown): PhysicsScene | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (src.verified === false) return null;
  const kind = src.kind;
  if (kind !== 'projectile' && kind !== 'freeBody' && kind !== 'wave') return null;

  const params = (Array.isArray(src.params) ? src.params : [])
    .map(parseParam)
    .filter((p): p is PhysicsParam => p !== null)
    .slice(0, 6);
  const gravity = num(src.gravity) ? src.gravity : undefined;
  const vars: Record<string, number> = Object.fromEntries(params.map((p) => [p.id, p.initial]));
  vars.g = gravity ?? 9.8;
  const outputs = (Array.isArray(src.outputs) ? src.outputs : [])
    .map((o) => parseOutput(o, vars))
    .filter((o): o is PhysicsOutput => o !== null);
  const forces = (Array.isArray(src.forces) ? src.forces : [])
    .map(parseForce)
    .filter((f): f is PhysicsForce => f !== null);
  const components = (Array.isArray(src.components) ? src.components : [])
    .map(parseComponent)
    .filter((c): c is WaveComponent => c !== null);

  if (kind === 'projectile' && (params.length < 1 || outputs.length === 0)) return null;
  if (kind === 'freeBody' && forces.length < 2) return null;
  if (kind === 'wave' && components.length === 0) return null;

  return {
    id: str(src.id) ? src.id : 'physics',
    kind,
    title: str(src.title) ? src.title : 'physics',
    caption: str(src.caption) ? src.caption : undefined,
    law: str(src.law) ? src.law : undefined,
    gravity,
    params,
    outputs,
    forces,
    components,
  };
}

// --- Shared bits ---------------------------------------------------------------------------------

const DEG = Math.PI / 180;

const readoutRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '4px 18px',
  padding: '10px 0',
};

function Readouts({
  items,
}: {
  items: { id: string; label: string; value: number | null; unit?: string }[];
}) {
  return (
    <div
      style={{
        border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
        borderRadius: 'var(--wobo-radius-md)',
        padding: '2px 20px',
        background: 'var(--wobo-paper)',
      }}
    >
      {items.map((o, i) => (
        <div key={o.id}>
          {i > 0 && (
            <div
              style={{
                height: 1,
                transform: 'scaleY(0.5)',
                background: 'var(--wobo-hairline-on-paper)',
              }}
            />
          )}
          <div style={readoutRow}>
            <div style={{ fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>{o.label}</div>
            <div
              style={{
                fontSize: '1.15rem',
                fontWeight: 550,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--wobo-ink-900)',
              }}
            >
              {formatSimNumber(o.value)}
              {o.unit && <span style={{ ...whisper, marginLeft: 6 }}>{o.unit}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Slider({
  param,
  value,
  hue,
  onChange,
}: {
  param: PhysicsParam;
  value: number;
  hue: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ minWidth: 92, fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>
        {param.label}
      </div>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={(param.max - param.min) / 200}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={param.label}
        style={{ flex: 1, accentColor: hue, cursor: 'pointer' }}
      />
      <div
        style={{
          minWidth: 74,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '1.02rem',
          fontWeight: 550,
          color: 'var(--wobo-ink-900)',
        }}
      >
        {formatSimNumber(value)}
        {param.unit && <span style={{ ...whisper, marginLeft: 4 }}>{param.unit}</span>}
      </div>
    </div>
  );
}

// --- Projectile (closed form — the killer format) -------------------------------------------------

const VB = 220;
const PAD = 16;

function pickAngleParam(params: PhysicsParam[]): PhysicsParam | undefined {
  return (
    params.find((p) => /deg|rad/i.test(p.unit) || /angle|theta|θ/i.test(`${p.id} ${p.label}`)) ??
    params[1] ??
    params[0]
  );
}

function ProjectileScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: PhysicsScene;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const bus = useWoboBus();
  const params = spec.params ?? [];
  const g = spec.gravity ?? 9.8;
  const angleP = pickAngleParam(params);
  const speedP = params.find((p) => p !== angleP) ?? params[0];

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(params.map((p) => [p.id, p.initial])),
  );
  const [touched, setTouched] = useState(false);
  const [t, setT] = useState(0);

  const theta = (angleP ? (values[angleP.id] ?? angleP.initial) : 45) * DEG;
  const v = speedP ? (values[speedP.id] ?? speedP.initial) : 20;

  // closed-form kinematics — analytic, exact
  const flight = v > 0 && g > 0 ? (2 * v * Math.sin(theta)) / g : 0;
  const vMax = speedP ? speedP.max : v;
  const worldW = Math.max((vMax * vMax) / g, 1e-6) * 1.06; // range at θ=45°, stable frame
  const worldH = Math.max((vMax * vMax) / (2 * g), 1e-6) * 1.15;
  const px = (x: number) => PAD + (x / worldW) * (VB - 2 * PAD);
  const py = (y: number) => VB - PAD - (y / worldH) * (VB - 2 * PAD);

  // the analytic parabola — cheap to sample each render (64 points), no memo needed
  let path = '';
  if (v > 0 && g > 0 && flight > 0) {
    const N = 64;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const tt = (flight * i) / N;
      const x = v * Math.cos(theta) * tt;
      const y = v * Math.sin(theta) * tt - 0.5 * g * tt * tt;
      pts.push(`${px(x).toFixed(2)},${py(Math.max(0, y)).toFixed(2)}`);
    }
    path = `M${pts.join(' L')}`;
  }

  // animate the projectile along the arc (reduced-motion → rest at the landing point)
  const rafT = flight > 0 ? Math.min(t, flight) : 0;
  const ballX = v * Math.cos(theta) * rafT;
  const ballY = Math.max(0, v * Math.sin(theta) * rafT - 0.5 * g * rafT * rafT);

  const raf = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    if (reduced || flight <= 0) {
      setT(flight);
      return;
    }
    last.current = performance.now();
    const step = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => (prev + dt > flight * 1.25 ? 0 : prev + dt));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [reduced, flight]);

  const outVars: Record<string, number> = { ...values, g };
  const results = (spec.outputs ?? []).map((o) => ({
    ...o,
    value: evaluateExpr(o.expr, outVars),
  }));

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !touched, onClick: onDone } });
  }, [touched, setBar, onDone]);

  const setParam = (id: string, val: number) => {
    setTouched(true);
    setValues((prev) => ({ ...prev, [id]: val }));
  };

  const ref = useRegisterTarget<HTMLDivElement>(`physics-${spec.id}`, {
    kind: 'controls',
    label: `the projectile simulation for ${spec.title}`,
    getSceneState: () => ({
      law: spec.law,
      ...(angleP ? { angle: `${formatSimNumber(values[angleP.id] ?? angleP.initial)}°` } : {}),
      ...(speedP ? { speed: `${formatSimNumber(v)} ${speedP.unit}` } : {}),
      ...Object.fromEntries(
        results.map((o) => [o.label, `${formatSimNumber(o.value)}${o.unit ? ` ${o.unit}` : ''}`]),
      ),
    }),
    getValidActions: () => [
      angleP ? `set ${angleP.label} between ${angleP.min} and ${angleP.max}` : 'change a parameter',
      speedP ? `set ${speedP.label} to change the launch speed` : 'change the speed',
    ],
    applyTutorAction: (patch: Record<string, unknown>) => {
      for (const p of params) {
        if (num(patch[p.id]))
          setParam(p.id, Math.max(p.min, Math.min(p.max, patch[p.id] as number)));
      }
    },
  });

  useEffect(() => {
    const gg = spec.gravity ?? 9.8;
    const vars: Record<string, number> = { ...values, g: gg };
    bus.publishCanvas({
      nodeId: `physics-${spec.id}`,
      equation: spec.law,
      steps: [
        ...(spec.params ?? []).map(
          (p) => `${p.label} = ${formatSimNumber(values[p.id] ?? p.initial)} ${p.unit}`,
        ),
        ...(spec.outputs ?? []).map(
          (o) =>
            `${o.label} = ${formatSimNumber(evaluateExpr(o.expr, vars))}${o.unit ? ` ${o.unit}` : ''}`,
        ),
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, values]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>launch — change the angle and watch the arc</div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.law && <div style={{ ...equationType, textAlign: 'center' }}>{spec.law}</div>}
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <Stage hue={hue} tint={0.05} minHeight={260} style={{ padding: 'clamp(10px, 2vw, 20px)' }}>
          <svg
            viewBox={`0 0 ${VB} ${VB}`}
            width="100%"
            style={{ maxHeight: 300 }}
            role="img"
            aria-label={`projectile trajectory at ${formatSimNumber(theta / DEG)} degrees`}
          >
            <title>projectile trajectory</title>
            {/* ground + launch axes */}
            <line
              x1={PAD}
              y1={VB - PAD}
              x2={VB - PAD}
              y2={VB - PAD}
              stroke="var(--wobo-ink-300)"
              strokeWidth={0.6}
            />
            <line
              x1={PAD}
              y1={PAD}
              x2={PAD}
              y2={VB - PAD}
              stroke="var(--wobo-ink-300)"
              strokeWidth={0.6}
            />
            {/* the analytic parabola */}
            <path
              d={path}
              fill="none"
              stroke="var(--wobo-ink-700)"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* launch-angle ray */}
            <line
              x1={px(0)}
              y1={py(0)}
              x2={px(worldW * 0.16 * Math.cos(theta))}
              y2={py(worldW * 0.16 * Math.sin(theta))}
              stroke={hue}
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.7}
            />
            {/* the projectile */}
            <circle cx={px(ballX)} cy={py(ballY)} r={3.4} fill={hue} />
          </svg>
        </Stage>

        {(spec.outputs?.length ?? 0) > 0 && <Readouts items={results} />}

        <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {params.map((p) => (
            <Slider
              key={p.id}
              param={p}
              value={values[p.id] ?? p.initial}
              hue={hue}
              onChange={(val) => setParam(p.id, val)}
            />
          ))}
        </div>
      </div>
    </CardBody>
  );
}

// --- Free-body diagram (draggable force arrows + live resultant) ----------------------------------

const FB = 240;
const FB_C = FB / 2;
const FB_SCALE = 3.4; // px per force unit

function arrow(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hx = toX - ux * 8;
  const hy = toY - uy * 8;
  const nx = -uy;
  const ny = ux;
  return `M${fromX} ${fromY} L${toX} ${toY} M${toX} ${toY} L${(hx + nx * 4).toFixed(1)} ${(
    hy + ny * 4
  ).toFixed(1)} M${toX} ${toY} L${(hx - nx * 4).toFixed(1)} ${(hy - ny * 4).toFixed(1)}`;
}

function FreeBodyScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: PhysicsScene;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const svgRef = useRef<SVGSVGElement>(null);
  const forces = spec.forces ?? [];
  const unit = forces[0]?.unit ?? 'N';
  const [state, setState] = useState<Record<string, { mag: number; angle: number }>>(() =>
    Object.fromEntries(forces.map((f) => [f.id, { mag: f.mag, angle: f.angle }])),
  );
  const [touched, setTouched] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);

  // resultant = vector sum
  const rx = forces.reduce(
    (s, f) => s + (state[f.id]?.mag ?? 0) * Math.cos((state[f.id]?.angle ?? 0) * DEG),
    0,
  );
  const ry = forces.reduce(
    (s, f) => s + (state[f.id]?.mag ?? 0) * Math.sin((state[f.id]?.angle ?? 0) * DEG),
    0,
  );
  const rMag = Math.hypot(rx, ry);
  const rAngle = rMag < 1e-6 ? 0 : (Math.atan2(ry, rx) / DEG + 360) % 360;

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !touched, onClick: onDone } });
  }, [touched, setBar, onDone]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * FB;
    const y = ((e.clientY - r.top) / r.height) * FB;
    return { x, y };
  };

  const updateFrom = (id: string, e: { clientX: number; clientY: number }) => {
    const w = toWorld(e);
    if (!w) return;
    const dx = w.x - FB_C;
    const dy = w.y - FB_C;
    const mag = Math.min(Math.hypot(dx, dy) / FB_SCALE, 60);
    const angle = (Math.atan2(-dy, dx) / DEG + 360) % 360; // screen y is down → flip
    setTouched(true);
    setState((prev) => ({ ...prev, [id]: { mag, angle } }));
  };

  const ref = useRegisterTarget<HTMLDivElement>(`physics-${spec.id}`, {
    kind: 'controls',
    label: `the free-body diagram for ${spec.title}`,
    getSceneState: () => ({
      law: spec.law,
      forces: forces.map(
        (f) =>
          `${f.label}: ${formatSimNumber(state[f.id]?.mag ?? 0)} ${unit} at ${formatSimNumber(
            state[f.id]?.angle ?? 0,
          )}°`,
      ),
      resultant: `${formatSimNumber(rMag)} ${unit} at ${formatSimNumber(rAngle)}°`,
      balanced: rMag < 0.5,
    }),
    getValidActions: () =>
      forces.map(
        (f) => `set ${f.label} magnitude and direction (patch { ${f.id}: { mag, angle } })`,
      ),
    applyTutorAction: (patch: Record<string, unknown>) => {
      for (const f of forces) {
        const p = patch[f.id];
        if (isRecord(p) && (num(p.mag) || num(p.angle))) {
          setTouched(true);
          setState((prev) => ({
            ...prev,
            [f.id]: {
              mag: num(p.mag) ? Math.max(0, p.mag) : (prev[f.id]?.mag ?? 0),
              angle: num(p.angle) ? p.angle : (prev[f.id]?.angle ?? 0),
            },
          }));
        }
      }
    },
  });

  useEffect(() => {
    const fs = spec.forces ?? [];
    const u = fs[0]?.unit ?? 'N';
    const sx = fs.reduce(
      (s, f) => s + (state[f.id]?.mag ?? 0) * Math.cos((state[f.id]?.angle ?? 0) * DEG),
      0,
    );
    const sy = fs.reduce(
      (s, f) => s + (state[f.id]?.mag ?? 0) * Math.sin((state[f.id]?.angle ?? 0) * DEG),
      0,
    );
    const mag = Math.hypot(sx, sy);
    const ang = mag < 1e-6 ? 0 : (Math.atan2(sy, sx) / DEG + 360) % 360;
    bus.publishCanvas({
      nodeId: `physics-${spec.id}`,
      equation: spec.law,
      steps: [
        ...fs.map(
          (f) =>
            `${f.label} = ${formatSimNumber(state[f.id]?.mag ?? 0)} ${u} @ ${formatSimNumber(
              state[f.id]?.angle ?? 0,
            )}°`,
        ),
        `resultant = ${formatSimNumber(mag)} ${u} @ ${formatSimNumber(ang)}°`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, state]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const tip = (id: string) => {
    const f = state[id] ?? { mag: 0, angle: 0 };
    return {
      x: FB_C + f.mag * FB_SCALE * Math.cos(f.angle * DEG),
      y: FB_C - f.mag * FB_SCALE * Math.sin(f.angle * DEG),
    };
  };

  return (
    <CardBody maxWidth={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>drag each arrow — the resultant follows</div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <Stage hue={hue} tint={0.05} minHeight={280} style={{ padding: 'clamp(10px, 2vw, 20px)' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${FB} ${FB}`}
            width="100%"
            style={{ maxHeight: 320, touchAction: 'none' }}
            role="img"
            aria-label={`free-body diagram, resultant ${formatSimNumber(rMag)} ${unit}`}
            onPointerMove={(e) => {
              if (drag) updateFrom(drag, e);
            }}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
          >
            <title>free-body diagram</title>
            {/* the body */}
            <circle cx={FB_C} cy={FB_C} r={7} fill="var(--wobo-ink-700)" />
            {/* the resultant (bold, hue) */}
            {rMag > 0.4 && (
              <path
                d={arrow(FB_C, FB_C, FB_C + rx * FB_SCALE, FB_C - ry * FB_SCALE)}
                fill="none"
                stroke={hue}
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            )}
            {/* each force arrow + a draggable tip */}
            {forces.map((f) => {
              const t = tip(f.id);
              return (
                <g key={f.id}>
                  <path
                    d={arrow(FB_C, FB_C, t.x, t.y)}
                    fill="none"
                    stroke="var(--wobo-ink-500)"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={t.x}
                    cy={t.y}
                    r={7}
                    fill="var(--wobo-paper)"
                    stroke={hue}
                    strokeWidth={1.4}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => {
                      (e.target as SVGCircleElement).setPointerCapture?.(e.pointerId);
                      setDrag(f.id);
                    }}
                  />
                  <text
                    x={t.x}
                    y={t.y - 11}
                    textAnchor="middle"
                    fontSize={9}
                    fill="var(--wobo-ink-700)"
                  >
                    {f.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </Stage>

        <Readouts
          items={[
            ...forces.map((f) => ({
              id: f.id,
              label: f.label,
              value: state[f.id]?.mag ?? 0,
              unit,
            })),
            { id: '__net', label: 'resultant', value: rMag, unit },
          ]}
        />
        <div ref={ref} style={{ ...lead, ...captionSurface }}>
          {rMag < 0.5
            ? 'the forces balance — the resultant is zero, so the body stays put.'
            : `the net force is ${formatSimNumber(rMag)} ${unit} at ${formatSimNumber(rAngle)}°.`}
        </div>
      </div>
    </CardBody>
  );
}

// --- Waves (sine superposition) ------------------------------------------------------------------

const WV_W = 300;
const WV_H = 140;

function WaveScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: PhysicsScene;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const comps = spec.components ?? [];
  const [amps, setAmps] = useState<Record<string, number>>(() =>
    Object.fromEntries(comps.map((c) => [c.id, c.amp])),
  );
  const [freqs, setFreqs] = useState<Record<string, number>>(() =>
    Object.fromEntries(comps.map((c) => [c.id, c.freq])),
  );
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !touched, onClick: onDone } });
  }, [touched, setBar, onDone]);

  const totalAmp = Math.max(
    comps.reduce((s, c) => s + Math.abs(amps[c.id] ?? c.amp), 0),
    1e-6,
  );
  const px = (x: number) => x * WV_W; // x in [0,1]
  const py = (y: number) => WV_H / 2 - (y / totalAmp) * (WV_H / 2 - 6);

  const sample = (fn: (x: number) => number) => {
    const N = 160;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      pts.push(`${px(x).toFixed(1)},${py(fn(x)).toFixed(2)}`);
    }
    return `M${pts.join(' L')}`;
  };

  const compFn = (c: WaveComponent) => (x: number) =>
    (amps[c.id] ?? c.amp) * Math.sin(2 * Math.PI * (freqs[c.id] ?? c.freq) * x + c.phase);
  const sumFn = (x: number) => comps.reduce((s, c) => s + compFn(c)(x), 0);

  const ref = useRegisterTarget<HTMLDivElement>(`physics-${spec.id}`, {
    kind: 'controls',
    label: `the wave superposition for ${spec.title}`,
    getSceneState: () => ({
      law: spec.law,
      components: comps.map(
        (c) =>
          `${c.id}: amplitude ${formatSimNumber(amps[c.id] ?? c.amp)}, frequency ${formatSimNumber(
            freqs[c.id] ?? c.freq,
          )}`,
      ),
    }),
    getValidActions: () => comps.flatMap((c) => [`set ${c.id} amplitude`, `set ${c.id} frequency`]),
    applyTutorAction: (patch: Record<string, unknown>) => {
      for (const c of comps) {
        const p = patch[c.id];
        if (isRecord(p)) {
          setTouched(true);
          if (num(p.amp)) setAmps((prev) => ({ ...prev, [c.id]: p.amp as number }));
          if (num(p.freq)) setFreqs((prev) => ({ ...prev, [c.id]: Math.max(0, p.freq as number) }));
        }
      }
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `physics-${spec.id}`,
      equation: spec.law,
      steps: (spec.components ?? []).map(
        (c) =>
          `${c.id}: A=${formatSimNumber(amps[c.id] ?? c.amp)}, f=${formatSimNumber(freqs[c.id] ?? c.freq)}`,
      ),
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, amps, freqs]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>add the waves — the bold curve is their sum</div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.law && <div style={{ ...equationType, textAlign: 'center' }}>{spec.law}</div>}
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <Stage hue={hue} tint={0.05} minHeight={200} style={{ padding: 'clamp(10px, 2vw, 20px)' }}>
          <svg
            viewBox={`0 0 ${WV_W} ${WV_H}`}
            width="100%"
            style={{ maxHeight: 220 }}
            role="img"
            aria-label={`superposition of ${comps.length} waves`}
          >
            <title>wave superposition</title>
            <line
              x1={0}
              y1={WV_H / 2}
              x2={WV_W}
              y2={WV_H / 2}
              stroke="var(--wobo-ink-300)"
              strokeWidth={0.5}
            />
            {comps.map((c) => (
              <path
                key={c.id}
                d={sample(compFn(c))}
                fill="none"
                stroke="var(--wobo-ink-400)"
                strokeWidth={0.9}
                opacity={0.55}
              />
            ))}
            <path
              d={sample(sumFn)}
              fill="none"
              stroke={hue}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Stage>

        <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {comps.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ ...whisper }}>{c.id}</div>
              <Slider
                param={{
                  id: `${c.id}-amp`,
                  label: 'amplitude',
                  min: 0,
                  max: Math.max(2, c.amp * 2),
                  initial: c.amp,
                  unit: '',
                }}
                value={amps[c.id] ?? c.amp}
                hue={hue}
                onChange={(val) => {
                  setTouched(true);
                  setAmps((prev) => ({ ...prev, [c.id]: val }));
                }}
              />
              <Slider
                param={{
                  id: `${c.id}-freq`,
                  label: 'frequency',
                  min: 0.5,
                  max: Math.max(6, c.freq * 2),
                  initial: c.freq,
                  unit: 'Hz',
                }}
                value={freqs[c.id] ?? c.freq}
                hue={hue}
                onChange={(val) => {
                  setTouched(true);
                  setFreqs((prev) => ({ ...prev, [c.id]: val }));
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </CardBody>
  );
}

// --- The switch ----------------------------------------------------------------------------------

export function PhysicsScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: PhysicsScene;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  if (spec.kind === 'projectile')
    return <ProjectileScene spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
  if (spec.kind === 'freeBody')
    return <FreeBodyScene spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
  return <WaveScene spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
}

// --- Hand-authored demos (prove each kind end to end; drop into EnginesGallery) --------------------

export const PHYSICS_PROJECTILE_DEMO: PhysicsScene = {
  id: 'demo-projectile',
  kind: 'projectile',
  title: 'projectile motion',
  law: 'y = x·tanθ − g·x² / (2·v²·cos²θ)',
  caption: 'raise the angle and watch the arc — range peaks at 45°.',
  gravity: 9.8,
  params: [
    { id: 'v', label: 'launch speed', min: 5, max: 40, initial: 22, unit: 'm/s' },
    { id: 'theta', label: 'launch angle', min: 10, max: 80, initial: 45, unit: 'deg' },
  ],
  outputs: [
    { id: 'R', label: 'range', expr: 'v^2 * sin(2*theta*pi/180) / g', unit: 'm' },
    { id: 'H', label: 'max height', expr: 'v^2 * sin(theta*pi/180)^2 / (2*g)', unit: 'm' },
    { id: 'T', label: 'time of flight', expr: '2*v*sin(theta*pi/180) / g', unit: 's' },
  ],
};

export const PHYSICS_FREEBODY_DEMO: PhysicsScene = {
  id: 'demo-freebody',
  kind: 'freeBody',
  title: 'forces on a sliding box',
  caption: 'drag each arrow — balance them so the resultant vanishes.',
  forces: [
    { id: 'weight', label: 'weight', mag: 12, angle: 270, unit: 'N' },
    { id: 'normal', label: 'normal', mag: 12, angle: 90, unit: 'N' },
    { id: 'push', label: 'push', mag: 8, angle: 0, unit: 'N' },
    { id: 'friction', label: 'friction', mag: 8, angle: 180, unit: 'N' },
  ],
};

export const PHYSICS_WAVE_DEMO: PhysicsScene = {
  id: 'demo-wave',
  kind: 'wave',
  title: 'adding two waves',
  law: 'y = A₁·sin(2πf₁x) + A₂·sin(2πf₂x + φ)',
  caption: 'when the frequencies are close, watch the beats appear.',
  components: [
    { id: 'wave 1', amp: 1, freq: 2, phase: 0 },
    { id: 'wave 2', amp: 0.8, freq: 2.4, phase: 0 },
  ],
};
