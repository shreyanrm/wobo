'use client';

/**
 * WhatIfNumerical — the what-if sandbox (DESIGN.md §9): "numericals are never static." A word
 * problem is rendered as a real VISUAL scene (the person, the tower, the angle drawn in SVG), and
 * every value in the problem is an editable chip. Editing a value re-solves the problem live — the
 * figure re-draws and the worked solution below re-computes, step by step, in front of the learner.
 *
 * Spec-driven: the composer emits { problem, values, scene(marks), solve(steps) }. Mark geometry
 * can be a number OR an arithmetic expression over the value ids (so the drawing tracks the values),
 * and each solve step is an expression over the values and earlier steps — all evaluated by
 * SimRunner's safe parser, never eval.
 *
 * Registers as a Wobo scene target: Wobo reads the current values + answer (getSceneState) and can
 * DRIVE a value to show a what-if directly (applyTutorAction). Reduced-motion + mute aware; both themes.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import {
  CardBody,
  captionSurface,
  cardTitle,
  lead,
  Scrubber,
  Stage,
  whisper,
} from '../screens/course/shared';
import { sfx } from '../ui/sound';
import { evaluateExpr, formatSimNumber } from './SimRunner';

// --- The spec ------------------------------------------------------------------------------------

type NumOrExpr = number | string;

export interface WhatIfValue {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
}

export interface WhatIfMark {
  id: string;
  shape: 'line' | 'circle' | 'rect' | 'text' | 'arc';
  x: NumOrExpr;
  y: NumOrExpr;
  x2?: NumOrExpr;
  y2?: NumOrExpr;
  r?: NumOrExpr;
  w?: NumOrExpr;
  h?: NumOrExpr;
  /** Text template — {id} tokens fill from the live values/steps. */
  text?: string;
  tone?: 'ink' | 'muted' | 'hue';
}

export interface WhatIfStep {
  id: string;
  label: string;
  /** Arithmetic over the value ids and earlier step ids. */
  expr: string;
}

export interface WhatIfSpec {
  id: string;
  title: string;
  /** The word problem — {id} tokens become editable chips inline. */
  problem: string;
  values: WhatIfValue[];
  scene: { marks: WhatIfMark[] };
  solve: WhatIfStep[];
  answerLabel?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHAPES: ReadonlySet<string> = new Set(['line', 'circle', 'rect', 'text', 'arc']);

const numOrExpr = (v: unknown): NumOrExpr | undefined => (num(v) ? v : str(v) ? v : undefined);

function parseMark(raw: unknown): WhatIfMark | null {
  if (!isRecord(raw) || !str(raw.id) || typeof raw.shape !== 'string' || !SHAPES.has(raw.shape))
    return null;
  const x = numOrExpr(raw.x);
  const y = numOrExpr(raw.y);
  if (x === undefined || y === undefined) return null;
  return {
    id: raw.id,
    shape: raw.shape as WhatIfMark['shape'],
    x,
    y,
    x2: numOrExpr(raw.x2),
    y2: numOrExpr(raw.y2),
    r: numOrExpr(raw.r),
    w: numOrExpr(raw.w),
    h: numOrExpr(raw.h),
    text: str(raw.text) ? raw.text : undefined,
    tone: raw.tone === 'hue' ? 'hue' : raw.tone === 'muted' ? 'muted' : 'ink',
  };
}

/** Validate a generated what-if spec — anything unrunnable is refused (caller falls back). */
export function parseWhatIfSpec(raw: unknown): WhatIfSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const values = (Array.isArray(src.values) ? src.values : []).flatMap((v): WhatIfValue[] => {
    if (!isRecord(v) || !str(v.id) || !IDENT_RE.test(v.id) || !str(v.label)) return [];
    if (!num(v.value) || !num(v.min) || !num(v.max) || v.min >= v.max) return [];
    return [
      {
        id: v.id,
        label: v.label,
        value: Math.max(v.min, Math.min(v.max, v.value)),
        min: v.min,
        max: v.max,
        unit: str(v.unit) ? v.unit : undefined,
      },
    ];
  });
  if (values.length === 0 || values.length > 6) return null;
  const vars = Object.fromEntries(values.map((v) => [v.id, v.value]));
  const solve = (Array.isArray(src.solve) ? src.solve : []).flatMap((s): WhatIfStep[] => {
    if (!isRecord(s) || !str(s.id) || !IDENT_RE.test(s.id) || !str(s.label) || !str(s.expr))
      return [];
    const val = evaluateExpr(s.expr, vars);
    if (val === null) return []; // must be runnable against values + prior steps
    vars[s.id] = val; // later steps may reference this one
    return [{ id: s.id, label: s.label, expr: s.expr }];
  });
  if (solve.length === 0) return null;
  const sceneRaw = isRecord(src.scene) ? src.scene : null;
  const marks = (Array.isArray(sceneRaw?.marks) ? sceneRaw.marks : [])
    .map(parseMark)
    .filter((m): m is WhatIfMark => m !== null);
  if (marks.length === 0) return null;
  return {
    id: str(src.id) ? src.id : 'whatif',
    title: str(src.title) ? src.title : 'what if…',
    problem: str(src.problem) ? src.problem : '',
    values,
    scene: { marks },
    solve,
    answerLabel: str(src.answerLabel) ? src.answerLabel : undefined,
  };
}

// --- Live computation ------------------------------------------------------------------------------

const VB_W = 100;
const VB_H = 62;

function toneStroke(tone: WhatIfMark['tone'], hue: string): string {
  return tone === 'hue' ? hue : tone === 'muted' ? 'var(--wobo-ink-300)' : 'var(--wobo-ink-700)';
}

/** Compute the value map: the editable values, then each solve step folded in in order. */
function computeVars(spec: WhatIfSpec, values: Record<string, number>): Record<string, number> {
  const vars: Record<string, number> = { ...values };
  for (const step of spec.solve) {
    const v = evaluateExpr(step.expr, vars);
    if (v !== null) vars[step.id] = v;
  }
  return vars;
}

function fillTemplate(text: string, vars: Record<string, number>): string {
  return text.replace(/\{(\w+)\}/g, (_, id) =>
    id in vars ? formatSimNumber(vars[id] ?? null) : `{${id}}`,
  );
}

export function WhatIfNumerical({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: WhatIfSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(spec.values.map((v) => [v.id, v.value])),
  );
  const [touched, setTouched] = useState(false);

  const vars = useMemo(() => computeVars(spec, values), [spec, values]);
  const answer = spec.solve[spec.solve.length - 1];
  const answerVal = answer ? (vars[answer.id] ?? null) : null;

  const edit = (id: string, v: number) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    if (!touched) {
      setTouched(true);
      sfx.tap();
    }
  };

  // the action bar — one what-if edit unlocks continue (act-to-reveal)
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !touched, onClick: onDone } });
  }, [touched, setBar, onDone]);

  // Wobo reads the live values + answer and can drive a what-if directly
  const applyTutorAction = (patch: Record<string, unknown>) => {
    const set = isRecord(patch.set) ? patch.set : patch;
    const id = typeof set.id === 'string' ? set.id : undefined;
    const v = num(set.value) ? set.value : undefined;
    const target = spec.values.find((x) => x.id === id);
    if (target && v !== undefined) edit(target.id, Math.max(target.min, Math.min(target.max, v)));
  };
  const ref = useRegisterTarget<HTMLDivElement>(`whatif-${spec.id}`, {
    kind: 'controls',
    label: `the what-if problem "${spec.title}" — every value is editable`,
    getSceneState: () => ({
      values: spec.values.map(
        (v) =>
          `${v.label} = ${formatSimNumber(values[v.id] ?? v.value)}${v.unit ? ` ${v.unit}` : ''}`,
      ),
      answer: answer ? `${answer.label} = ${formatSimNumber(answerVal)}` : undefined,
    }),
    getValidActions: () => spec.values.map((v) => `change ${v.label}`),
    applyTutorAction,
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `whatif-${spec.id}`,
      steps: [
        ...spec.values.map(
          (v) =>
            `${v.label} = ${formatSimNumber(values[v.id] ?? v.value)}${v.unit ? ` ${v.unit}` : ''}`,
        ),
        ...spec.solve.map((s) => `${s.label} = ${formatSimNumber(vars[s.id] ?? null)}`),
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, values, vars]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const resolve = (field: NumOrExpr | undefined): number | undefined => {
    if (field === undefined) return undefined;
    if (typeof field === 'number') return field;
    const v = evaluateExpr(field, vars);
    return v === null || !Number.isFinite(v) ? undefined : v;
  };

  // split the problem statement into text + editable chips
  const segments = spec.problem.split(/(\{\w+\})/g).filter((s) => s !== '');

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>what-if — every number is yours to change</div>
        <div style={cardTitle}>{spec.title}</div>

        {/* the word problem, with inline editable value chips */}
        <div ref={ref} style={{ ...lead, color: 'var(--wobo-ink-900)', fontSize: '1.05rem' }}>
          {segments.map((seg, i) => {
            const m = seg.match(/^\{(\w+)\}$/);
            const val = m ? spec.values.find((v) => v.id === m[1]) : undefined;
            if (val) {
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional problem segments
                  key={i}
                  style={{ color: hue, fontWeight: 560, margin: '0 2px' }}
                >
                  <Scrubber
                    value={values[val.id] ?? val.value}
                    min={val.min}
                    max={val.max}
                    onChange={(v) => edit(val.id, v)}
                    label={`${val.label}${val.unit ? ` (${val.unit})` : ''}`}
                  />
                </span>
              );
            }
            // biome-ignore lint/suspicious/noArrayIndexKey: positional problem segments
            return <span key={i}>{seg}</span>;
          })}
        </div>

        {/* the scene — the actual situation drawn, tracking the values live */}
        <Stage hue={hue} tint={0.05} minHeight={240} style={{ padding: 'clamp(14px, 3vw, 26px)' }}>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            style={{ maxHeight: 300 }}
            role="img"
            aria-label={`scene for ${spec.title}`}
          >
            {spec.scene.marks.map((mk) => {
              const x = resolve(mk.x);
              const y = resolve(mk.y);
              if (x === undefined || y === undefined) return null;
              const stroke = toneStroke(mk.tone, hue);
              const sw = mk.tone === 'muted' ? 0.7 : 1.3;
              switch (mk.shape) {
                case 'line': {
                  const x2 = resolve(mk.x2) ?? x;
                  const y2 = resolve(mk.y2) ?? y;
                  return (
                    <motion.line
                      key={mk.id}
                      animate={{ x1: x, y1: y, x2, y2 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      stroke={stroke}
                      strokeWidth={sw}
                      strokeLinecap="round"
                    />
                  );
                }
                case 'circle':
                  return (
                    <motion.circle
                      key={mk.id}
                      animate={{ cx: x, cy: y, r: resolve(mk.r) ?? 3 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      fill={mk.tone === 'hue' ? hue : 'none'}
                      stroke={stroke}
                      strokeWidth={sw}
                    />
                  );
                case 'rect':
                  return (
                    <motion.rect
                      key={mk.id}
                      animate={{ x, y, width: resolve(mk.w) ?? 6, height: resolve(mk.h) ?? 6 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      rx={1}
                      fill={mk.tone === 'hue' ? hue : 'none'}
                      stroke={stroke}
                      strokeWidth={sw}
                    />
                  );
                case 'arc': {
                  // a small angle arc: r around (x,y) — decorative marker of the angle vertex
                  const r = resolve(mk.r) ?? 8;
                  return (
                    <circle
                      key={mk.id}
                      cx={x}
                      cy={y}
                      r={r}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={0.6}
                      strokeDasharray="1.5 1.5"
                    />
                  );
                }
                case 'text':
                  return (
                    <motion.text
                      key={mk.id}
                      animate={{ x, y }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      fontSize={resolve(mk.r) ?? 4.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={mk.tone === 'hue' ? hue : 'var(--wobo-ink-700)'}
                      style={{ fontFamily: 'inherit', fontWeight: 540 }}
                    >
                      {mk.text ? fillTemplate(mk.text, vars) : ''}
                    </motion.text>
                  );
                default:
                  return null;
              }
            })}
          </svg>
        </Stage>

        {/* the worked solution — re-computes step by step as the values change */}
        <div
          style={{
            border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
            borderRadius: 10,
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={whisper}>the solution, live</div>
          {spec.solve.map((s, i) => {
            const isAnswer = i === spec.solve.length - 1;
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '3px 0',
                  fontSize: isAnswer ? '1.05rem' : '0.95rem',
                  fontWeight: isAnswer ? 560 : 460,
                  color: isAnswer ? 'var(--wobo-ink-900)' : 'var(--wobo-ink-700)',
                }}
              >
                <span>{fillTemplate(s.label, vars)}</span>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={formatSimNumber(vars[s.id] ?? null)}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: isAnswer ? hue : 'inherit',
                      fontWeight: isAnswer ? 600 : 520,
                    }}
                  >
                    {formatSimNumber(vars[s.id] ?? null)}
                  </motion.span>
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div
          style={{
            ...lead,
            ...captionSurface,
            color: 'var(--wobo-ink-900)',
          }}
        >
          drag any highlighted number in the problem — the picture and the answer follow.
        </div>
      </motion.div>
    </CardBody>
  );
}

// --- A hand-authored demo (heights & distances) — proves the engine end to end ---------------------

export const WHATIF_DEMO: WhatIfSpec = {
  id: 'demo-tower',
  title: 'the tower and the angle',
  problem:
    'you stand {d} m from a tower and look up to its top at an angle of {a}°. how tall is the tower?',
  values: [
    { id: 'd', label: 'distance', value: 30, min: 10, max: 60, unit: 'm' },
    { id: 'a', label: 'angle', value: 40, min: 15, max: 75, unit: '°' },
  ],
  scene: {
    // ground line, the observer (a small figure), the tower rising by tan(a)*d, the sightline + angle
    marks: [
      { id: 'ground', shape: 'line', x: 8, y: 52, x2: 92, y2: 52, tone: 'muted' },
      // observer: head + body at x=16
      { id: 'head', shape: 'circle', x: 16, y: 44, r: 2, tone: 'ink' },
      { id: 'body', shape: 'line', x: 16, y: 46, x2: 16, y2: 52, tone: 'ink' },
      // tower base at x=80, height scales with tan(a)*d, capped by the canvas
      {
        id: 'tower',
        shape: 'line',
        x: 80,
        y: 52,
        x2: 80,
        y2: 'max(6, 52 - tan(a * pi / 180) * d * 0.9)',
        tone: 'hue',
      },
      { id: 'towerbase', shape: 'line', x: 76, y: 52, x2: 84, y2: 52, tone: 'ink' },
      // the sightline from the observer's eye to the tower top
      {
        id: 'sight',
        shape: 'line',
        x: 16,
        y: 44,
        x2: 80,
        y2: 'max(6, 52 - tan(a * pi / 180) * d * 0.9)',
        tone: 'muted',
      },
      // the angle marker at the eye
      { id: 'angle', shape: 'arc', x: 16, y: 44, r: 7, tone: 'hue' },
      { id: 'anglelbl', shape: 'text', x: 27, y: 43, r: 4, text: '{a}°', tone: 'hue' },
      { id: 'distlbl', shape: 'text', x: 48, y: 56, r: 4, text: '{d} m', tone: 'muted' },
    ],
  },
  solve: [
    { id: 'rad', label: 'angle in radians  a·π/180', expr: 'a * pi / 180' },
    { id: 'h', label: 'height  =  distance × tan(angle)', expr: 'd * tan(rad)' },
  ],
  answerLabel: 'tower height (m)',
};
