'use client';

/**
 * PerturbationSandbox — "break it" (DESIGN.md §9). A law lives inside an assumption; this engine
 * exposes the ONE parameter where the assumption fails as a slider. Dragging toward the breakpoint
 * animates the model diverging (the plotted output shoots to the asymptote), and at the edge the
 * hidden assumption is revealed in Wobo's ink hand — the annotation and the "why not in reality?" line.
 *
 * Ohm's law with R→0 (current diverges — real wires have internal resistance); an ideal gas with
 * V→0; an n-slider for a sampling statistic. All spec-driven: the composer emits
 * { model(law), param, range, breakpoint, revelation } and this shell renders and drives it.
 *
 * Registers as a Wobo scene target: Wobo reads the slider + output + broken state (getSceneState),
 * and can DRIVE it to demonstrate the divergence directly (applyTutorAction). Output arithmetic is
 * evaluated by SimRunner's safe parser — never eval. Reduced-motion + mute aware; both themes.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import {
  CardBody,
  captionSurface,
  cardTitle,
  lead,
  Stage,
  whisper,
} from '../screens/course/shared';
import { sfx } from '../ui/sound';
import { useWoboChat } from '../wobo/chat';
import { evaluateExpr, formatSimNumber } from './SimRunner';

// --- The spec ------------------------------------------------------------------------------------

export interface PerturbSpec {
  id: string;
  title: string;
  /** The law on display, e.g. "I = V / R". */
  law: string;
  param: { id: string; label: string; min: number; max: number; from: number; unit?: string };
  /** The output that diverges — arithmetic over the param id and numeric constants (pi, sqrt, sin…). */
  output: { label: string; expr: string; unit?: string };
  breakpoint: {
    at: number;
    /** The side the param travels to reach the edge (R→0 is 'below'; V→∞ is 'above'). */
    approach: 'below' | 'above';
    /** The hidden assumption the ideal model quietly makes — Wobo's ink annotation at the edge. */
    assumption: string;
    /** Why the real world refuses to diverge — the reveal that lands once it breaks. */
    revelation: string;
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate a generated perturbation spec — a spec that cannot run never reaches the learner. */
export function parsePerturbSpec(raw: unknown): PerturbSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const p = isRecord(src.param) ? src.param : null;
  const o = isRecord(src.output) ? src.output : null;
  const b = isRecord(src.breakpoint) ? src.breakpoint : null;
  if (!p || !o || !b || !str(src.law)) return null;
  if (!str(p.id) || !IDENT_RE.test(p.id) || !str(p.label)) return null;
  if (!num(p.min) || !num(p.max) || p.min >= p.max) return null;
  const from = num(p.from) ? Math.max(p.min, Math.min(p.max, p.from)) : (p.min + p.max) / 2;
  if (!str(o.label) || !str(o.expr)) return null;
  // the output must actually evaluate at the starting point (the only param bound), or it is unrunnable
  if (evaluateExpr(o.expr, { [p.id]: from }) === null) return null;
  if (!num(b.at) || (b.approach !== 'below' && b.approach !== 'above')) return null;
  if (!str(b.assumption) || !str(b.revelation)) return null;
  return {
    id: str(src.id) ? src.id : 'perturb',
    title: str(src.title) ? src.title : 'break the law',
    law: src.law,
    param: {
      id: p.id,
      label: p.label,
      min: p.min,
      max: p.max,
      from,
      unit: str(p.unit) ? p.unit : undefined,
    },
    output: { label: o.label, expr: o.expr, unit: str(o.unit) ? o.unit : undefined },
    breakpoint: {
      at: b.at,
      approach: b.approach,
      assumption: b.assumption,
      revelation: b.revelation,
    },
  };
}

// --- The diverging plot ---------------------------------------------------------------------------

const VB_W = 100;
const VB_H = 60;
const PAD_L = 10;
const PAD_B = 10;
const PAD_T = 6;
const PAD_R = 6;

const equationRow: CSSProperties = {
  fontSize: 'clamp(1.3rem, 4vw, 1.7rem)',
  fontWeight: 550,
  letterSpacing: '-0.01em',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
  color: 'var(--wobo-ink-900)',
};

/** True once the param has reached the failure edge — the model is broken. */
function isBroken(spec: PerturbSpec, value: number): boolean {
  const band = (spec.param.max - spec.param.min) * 0.06;
  return spec.breakpoint.approach === 'below'
    ? value <= spec.breakpoint.at + band
    : value >= spec.breakpoint.at - band;
}

export function PerturbationSandbox({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: PerturbSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const bus = useWoboBus();
  const { setMood } = useWoboChat();
  const [value, setValue] = useState(spec.param.from);
  const [broke, setBroke] = useState(false);

  const { min, max } = spec.param;
  const raw = evaluateExpr(spec.output.expr, { [spec.param.id]: value });
  const broken = isBroken(spec, value);

  // the plot: sample the output across the range, scaled so divergence shoots to the top
  const plot = useMemo(() => {
    const N = 72;
    const samples: { p: number; y: number | null }[] = [];
    for (let i = 0; i <= N; i++) {
      const p = min + ((max - min) * i) / N;
      samples.push({ p, y: evaluateExpr(spec.output.expr, { [spec.param.id]: p }) });
    }
    const finite = samples.map((s) => (s.y !== null && Number.isFinite(s.y) ? Math.abs(s.y) : 0));
    // ceiling: a robust multiple of the output at the safe end, so the curve has headroom to run away
    const baseIdx = spec.breakpoint.approach === 'below' ? N : 0;
    const baseVal = finite[baseIdx] || 1;
    const base = Math.max(baseVal, ...finite.filter((v) => v < baseVal * 3));
    const ceil = Math.max(base * 2.4, 1e-6);
    const px = (p: number) => PAD_L + ((p - min) / (max - min)) * (VB_W - PAD_L - PAD_R);
    const py = (y: number) =>
      VB_H - PAD_B - (Math.min(Math.abs(y), ceil) / ceil) * (VB_H - PAD_B - PAD_T);
    const pts = samples
      .filter((s) => s.y !== null && Number.isFinite(s.y))
      .map((s) => `${px(s.p).toFixed(2)},${py(s.y as number).toFixed(2)}`);
    return { d: pts.length ? `M${pts.join(' L')}` : '', px, py, ceil };
  }, [spec, min, max]);

  const dotX = plot.px(value);
  const dotY = raw !== null && Number.isFinite(raw) ? plot.py(raw) : PAD_T;
  const bpX = plot.px(spec.breakpoint.at);
  const diverging = Number.isFinite(raw ?? 0) ? Math.min(1, Math.abs(raw ?? 0) / plot.ceil) : 1;

  // break the model exactly once — the reveal beat
  useEffect(() => {
    if (broken && !broke) {
      setBroke(true);
      sfx.reveal();
      setMood('explaining');
      window.setTimeout(() => setMood('idle'), 1800);
    }
  }, [broken, broke, setMood]);

  // the action bar — held closed until they drag it to the breaking point
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !broke, onClick: onDone } });
  }, [broke, setBar, onDone]);

  // Wobo reads the sandbox at code level, and can drive the slider to demonstrate the divergence
  const applyTutorAction = (patch: Record<string, unknown>) => {
    if (patch.break === true) return setValue(spec.breakpoint.at);
    if (num(patch.value)) setValue(Math.max(min, Math.min(max, patch.value)));
  };
  const ref = useRegisterTarget<HTMLDivElement>(`perturb-${spec.id}`, {
    kind: 'controls',
    label: `the "break it" sandbox for ${spec.law}`,
    getSceneState: () => ({
      law: spec.law,
      param: `${spec.param.label} = ${formatSimNumber(value)}${spec.param.unit ? ` ${spec.param.unit}` : ''}`,
      output: `${spec.output.label} = ${formatSimNumber(raw)}`,
      broken,
    }),
    getValidActions: () => [
      `drag ${spec.param.label} toward ${spec.breakpoint.at} to break the model`,
      'set the parameter to the breakpoint',
    ],
    applyTutorAction,
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `perturb-${spec.id}`,
      equation: spec.law,
      steps: [
        `${spec.param.label} = ${formatSimNumber(value)}${spec.param.unit ? ` ${spec.param.unit}` : ''}`,
        `${spec.output.label} = ${formatSimNumber(raw)}${spec.output.unit ? ` ${spec.output.unit}` : ''}`,
        broken ? `broken: ${spec.breakpoint.revelation}` : 'the model still holds',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, value, raw, broken]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>break it — find where the law stops working</div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={260} style={{ padding: 'clamp(14px, 3vw, 26px)' }}>
          <div style={equationRow}>{spec.law}</div>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            style={{ maxHeight: 260, marginTop: 6 }}
            role="img"
            aria-label={`plot of ${spec.output.label} against ${spec.param.label}`}
          >
            <line
              x1={PAD_L}
              y1={VB_H - PAD_B}
              x2={VB_W - PAD_R}
              y2={VB_H - PAD_B}
              stroke="var(--wobo-ink-300)"
              strokeWidth={0.5}
            />
            <line
              x1={PAD_L}
              y1={PAD_T}
              x2={PAD_L}
              y2={VB_H - PAD_B}
              stroke="var(--wobo-ink-300)"
              strokeWidth={0.5}
            />
            {/* the breakpoint edge — a dashed wall the curve races toward */}
            <line
              x1={bpX}
              y1={PAD_T}
              x2={bpX}
              y2={VB_H - PAD_B}
              stroke={hue}
              strokeWidth={0.7}
              strokeDasharray="2 2"
              opacity={0.55}
            />
            <path
              d={plot.d}
              fill="none"
              stroke="var(--wobo-ink-700)"
              strokeWidth={1.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* divergence glow — the model tearing as the output runs away */}
            {diverging > 0.5 && !reduced && (
              <motion.circle
                cx={dotX}
                cy={dotY}
                r={3 + diverging * 6}
                fill="none"
                stroke={hue}
                strokeWidth={0.6}
                initial={{ opacity: 0.5 }}
                animate={{ opacity: [0.5, 0.05, 0.5] }}
                transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY }}
              />
            )}
            {/* the live operating point — climbs the curve toward the asymptote */}
            <motion.circle
              cx={dotX}
              cy={dotY}
              r={2.6}
              fill={hue}
              animate={reduced || !broke ? undefined : { r: [2.6, 3.4, 2.6] }}
              transition={{ duration: 0.8, repeat: broke ? Number.POSITIVE_INFINITY : 0 }}
            />
            {/* Wobo's ink annotation at the edge — the hidden assumption, drawn only when broken */}
            <AnimatePresence>
              {broke && (
                <motion.g
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  <path
                    d={`M${bpX} ${PAD_T + 3} q -6 4 -14 3`}
                    fill="none"
                    stroke={hue}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                  />
                  <circle cx={bpX} cy={PAD_T + 3} r={1.4} fill={hue} />
                </motion.g>
              )}
            </AnimatePresence>
          </svg>
        </Stage>

        {/* the live output */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            padding: '4px 2px',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>
            {spec.output.label}
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 560,
              fontVariantNumeric: 'tabular-nums',
              color: broke ? hue : 'var(--wobo-ink-900)',
              transition: 'color 0.3s ease',
            }}
          >
            {formatSimNumber(raw)}
            {spec.output.unit && (
              <span style={{ ...whisper, marginLeft: 6 }}>{spec.output.unit}</span>
            )}
          </div>
        </div>

        {/* the failure parameter — the one slider that breaks it */}
        <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <input
            type="range"
            min={min}
            max={max}
            step={(max - min) / 200}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            aria-label={`${spec.param.label} — drag toward the breakpoint`}
            style={{ flex: 1, accentColor: hue, cursor: 'pointer' }}
          />
          <div
            style={{
              minWidth: 82,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '1.05rem',
              fontWeight: 560,
              color: 'var(--wobo-ink-900)',
            }}
          >
            {spec.param.label} {formatSimNumber(value)}
          </div>
        </div>

        <div
          style={{
            ...lead,
            ...captionSurface,
            color: 'var(--wobo-ink-900)',
          }}
        >
          drag {spec.param.label} toward {formatSimNumber(spec.breakpoint.at)} and watch{' '}
          {spec.output.label} run away.
        </div>

        {/* the reveal — the hidden assumption and why reality refuses to diverge */}
        <AnimatePresence>
          {broke && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26, delay: reduced ? 0 : 0.1 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div
                style={{
                  border: '1px solid var(--wobo-feedback-correct)',
                  background: 'var(--wobo-feedback-correctSoft)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  fontSize: '1.02rem',
                  lineHeight: 1.6,
                  color: 'var(--wobo-ink-900)',
                }}
              >
                <span style={{ ...whisper, display: 'block', marginBottom: 6 }}>
                  the hidden assumption
                </span>
                {spec.breakpoint.assumption}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden style={{ color: hue, fontSize: '1.1rem', lineHeight: 1.4 }}>
                  ◍
                </span>
                <div style={{ ...lead, fontStyle: 'italic', color: 'var(--wobo-ink-700)' }}>
                  {spec.breakpoint.revelation}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </CardBody>
  );
}

// --- A hand-authored demo (Ohm's law, R → 0) — proves the engine end to end ------------------------

export const PERTURB_DEMO: PerturbSpec = {
  id: 'demo-ohm',
  title: 'ohm’s law, pushed to the edge',
  law: 'I = 12 / R',
  param: { id: 'R', label: 'R', min: 0.4, max: 12, from: 8, unit: 'Ω' },
  output: { label: 'current I', expr: '12 / R', unit: 'A' },
  breakpoint: {
    at: 0.4,
    approach: 'below',
    assumption:
      'the ideal model assumes the only resistance in the circuit is R — nothing else pushes back.',
    revelation:
      'in reality the battery and the wires have their own internal resistance, so the current never truly runs to infinity — it tops out.',
  },
};
