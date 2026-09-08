'use client';

/**
 * Discovery — THE guided-discovery shell (DESIGN.md §9, the keystone). The one format every other
 * engine targets: one idea per screen, act-to-reveal, zero lecturing. A stage (a large reactive
 * SVG visual), exactly one interaction (tap targets / drag a handle / slide a slider), and a reveal
 * beat that lands — motion + sound + Wobo's one-line caption — ONLY the moment the learner acts, never
 * before. Advance gates on the interaction completing.
 *
 * ── The spec the composer emits ───────────────────────────────────────────────────────────────
 * A DiscoverySpec is fully declarative — the composer authors it, this shell renders and drives it:
 *
 *   { id, title, stages: [ Stage, … ] }         // 1–6 stages, one idea each
 *
 *   Stage = {
 *     visual:  { marks: Mark[] }                 // the SVG subject on a 0..100 × 0..62 canvas
 *     interaction: Interaction                   // exactly one of the three verbs below
 *     reveal:  string                            // the idea, revealed on completion (never before)
 *     caption: string                            // Wobo's one line, spoken (setMood) as it lands
 *   }
 *
 *   Mark = { id, shape:'circle'|'rect'|'line'|'ring'|'text', x, y, x2?, y2?, r?, w?, h?,
 *            text?, tone?:'ink'|'muted'|'hue', fill?:'soft'|'solid' }
 *          // tone 'hue' is earned pigment — use once, on the point.
 *          // fill = a tactile filled body at rest (CONTENT-VISUALS.md §3.1); absent = outline (structure).
 *
 *   Interaction (one of):
 *     { kind:'tap',   prompt, targets:string[], need? }           // tap the marked ids; done at `need`
 *     { kind:'drag',  prompt, handle, to:{x,y}, radius? }         // drag mark `handle` onto zone `to`
 *     { kind:'slide', prompt, min, max, from, at, unit?, valueLabel?,   // slide until value crosses `at`
 *                     bind?:{ mark, prop:'x'|'y'|'r', at:[number,number] } }  // live-drives one mark
 *
 * The stage registers as a Wobo scene target: Wobo reads current stage + the learner's live action
 * (getSceneState / getValidActions) and can DRIVE it to demonstrate (applyTutorAction). Reduced-motion
 * and mute aware; both themes; no new deps.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BarState } from '../screens/course/shared';
import { CardBody, captionSurface, lead, rgba, Stage } from '../screens/course/shared';
import { hueForTopic } from '../ui/hues';
import { sfx } from '../ui/sound';
import { useWoboChat } from '../wobo/chat';

// --- The spec ------------------------------------------------------------------------------------

type Tone = 'ink' | 'muted' | 'hue';
type Shape = 'circle' | 'rect' | 'line' | 'ring' | 'text';

export interface Mark {
  id: string;
  shape: Shape;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r?: number;
  w?: number;
  h?: number;
  text?: string;
  tone?: Tone;
  /** A filled, tactile body at rest (CONTENT-VISUALS.md §3.1): 'solid' = a chunky object,
   * 'soft' = a roomy tinted container. Absent = outline-only (structure: axes, rays, leaders). */
  fill?: 'soft' | 'solid';
}

export type Interaction =
  | { kind: 'tap'; prompt: string; targets: string[]; need?: number }
  | { kind: 'drag'; prompt: string; handle: string; to: { x: number; y: number }; radius?: number }
  | {
      kind: 'slide';
      prompt: string;
      min: number;
      max: number;
      from: number;
      /** Reveal fires when the value crosses this threshold (either direction from `from`). */
      at: number;
      unit?: string;
      /** Template for the live readout, `{v}` → current value, e.g. "{v} protons". */
      valueLabel?: string;
      /** Live-drive one mark's property linearly as the value sweeps min→max. */
      bind?: { mark: string; prop: 'x' | 'y' | 'r'; at: [number, number] };
    };

export interface DiscoveryStage {
  visual: { marks: Mark[] };
  interaction: Interaction;
  reveal: string;
  caption: string;
}

export interface DiscoverySpec {
  id: string;
  title: string;
  stages: DiscoveryStage[];
}

// --- Validation (a malformed generated spec must never reach the learner — refusal is invisible) --

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const SHAPES: ReadonlySet<string> = new Set<Shape>(['circle', 'rect', 'line', 'ring', 'text']);

function parseMark(raw: unknown): Mark | null {
  if (!isRecord(raw) || !str(raw.id) || typeof raw.shape !== 'string' || !SHAPES.has(raw.shape))
    return null;
  if (!num(raw.x) || !num(raw.y)) return null;
  const tone: Tone = raw.tone === 'hue' ? 'hue' : raw.tone === 'muted' ? 'muted' : 'ink';
  return {
    id: raw.id,
    shape: raw.shape as Shape,
    x: raw.x,
    y: raw.y,
    x2: num(raw.x2) ? raw.x2 : undefined,
    y2: num(raw.y2) ? raw.y2 : undefined,
    r: num(raw.r) ? raw.r : undefined,
    w: num(raw.w) ? raw.w : undefined,
    h: num(raw.h) ? raw.h : undefined,
    text: str(raw.text) ? raw.text : undefined,
    tone,
    fill: raw.fill === 'solid' ? 'solid' : raw.fill === 'soft' ? 'soft' : undefined,
  };
}

function parseInteraction(raw: unknown, markIds: Set<string>): Interaction | null {
  if (!isRecord(raw) || !str(raw.prompt)) return null;
  if (raw.kind === 'tap') {
    const targets = (Array.isArray(raw.targets) ? raw.targets : []).filter(
      (t): t is string => typeof t === 'string' && markIds.has(t),
    );
    if (targets.length === 0) return null;
    const need = num(raw.need)
      ? Math.max(1, Math.min(targets.length, Math.round(raw.need)))
      : targets.length;
    return { kind: 'tap', prompt: raw.prompt, targets, need };
  }
  if (raw.kind === 'drag') {
    if (!str(raw.handle) || !markIds.has(raw.handle) || !isRecord(raw.to)) return null;
    if (!num(raw.to.x) || !num(raw.to.y)) return null;
    return {
      kind: 'drag',
      prompt: raw.prompt,
      handle: raw.handle,
      to: { x: raw.to.x, y: raw.to.y },
      radius: num(raw.radius) ? raw.radius : 8,
    };
  }
  if (raw.kind === 'slide') {
    if (!num(raw.min) || !num(raw.max) || raw.min >= raw.max) return null;
    const from = num(raw.from) ? Math.max(raw.min, Math.min(raw.max, raw.from)) : raw.min;
    const at = num(raw.at) ? Math.max(raw.min, Math.min(raw.max, raw.at)) : raw.max;
    let bind: Extract<Interaction, { kind: 'slide' }>['bind'];
    if (isRecord(raw.bind) && str(raw.bind.mark) && markIds.has(raw.bind.mark)) {
      const prop = raw.bind.prop;
      const range = raw.bind.at;
      if (
        (prop === 'x' || prop === 'y' || prop === 'r') &&
        Array.isArray(range) &&
        num(range[0]) &&
        num(range[1])
      ) {
        bind = { mark: raw.bind.mark, prop, at: [range[0], range[1]] };
      }
    }
    return {
      kind: 'slide',
      prompt: raw.prompt,
      min: raw.min,
      max: raw.max,
      from,
      at,
      unit: str(raw.unit) ? raw.unit : undefined,
      valueLabel: str(raw.valueLabel) ? raw.valueLabel : undefined,
      bind,
    };
  }
  return null;
}

function parseStage(raw: unknown): DiscoveryStage | null {
  if (!isRecord(raw) || !str(raw.reveal) || !str(raw.caption)) return null;
  const visual = isRecord(raw.visual) ? raw.visual : null;
  const marks = (Array.isArray(visual?.marks) ? visual.marks : [])
    .map(parseMark)
    .filter((m): m is Mark => m !== null);
  if (marks.length === 0) return null;
  const interaction = parseInteraction(raw.interaction, new Set(marks.map((m) => m.id)));
  if (!interaction) return null;
  return { visual: { marks }, interaction, reveal: raw.reveal, caption: raw.caption };
}

/** Validate a generated discovery spec; returns null (caller falls back) on anything malformed. */
export function parseDiscoverySpec(raw: unknown): DiscoverySpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const stages = (Array.isArray(src.stages) ? src.stages : [])
    .map(parseStage)
    .filter((s): s is DiscoveryStage => s !== null);
  if (stages.length === 0 || stages.length > 6) return null;
  return {
    id: str(src.id) ? src.id : 'discovery',
    title: str(src.title) ? src.title : 'discover it',
    stages,
  };
}

// --- Mark rendering --------------------------------------------------------------------------------

const VB_W = 100;
const VB_H = 62;

/** What a mark is to the learner's finger: something to tap, something to drag, or the scenery. */
export type MarkRole = 'target' | 'handle' | 'static';

/** The scale a 390 wide phone renders the stage at, used before the first measurement lands. */
const PHONE_PX_PER_UNIT = 3.3;
/** Half of the 44 css px law (DESIGN.md), with a pixel to spare for rounding. */
const HIT_FLOOR_PX = 23;

/**
 * The radius of a mark's hit disc, in viewBox units: its own size plus a margin, and never less
 * than 44 css px across (SCORECARD.md 3.5 #3: 96 of 96 maths marks and 102 of 102 physics marks
 * had no hit area a real finger could land on). `pxPerUnit` is the measured render scale; zero
 * (unmeasured) assumes a phone, which is the tighter case.
 */
export function hitRadius(r: number, pxPerUnit: number): number {
  const scale = pxPerUnit > 0 ? pxPerUnit : PHONE_PX_PER_UNIT;
  return Math.max(r + 4, HIT_FLOOR_PX / scale);
}

/**
 * The fill a mark rests with. The spec's own `fill` wins. Without one, a thing the learner is
 * asked to tap or drag still gets a body (a target is an object, not a hairline), and the
 * scenery stays an outline as CONTENT-VISUALS.md 3.1 intends. Only bodies fill: a ring, a line
 * and a label are structure whatever their role.
 */
export function bodyFill(mark: Mark, role: MarkRole): 'soft' | 'solid' | undefined {
  if (mark.fill) return mark.fill;
  if (mark.shape !== 'circle' && mark.shape !== 'rect') return undefined;
  if (role === 'handle') return 'solid';
  if (role === 'target') return 'soft';
  return undefined;
}

/**
 * Bring the board to the top of the scroller as a stage opens, so the thing to act on is on
 * screen before the prompt is read. Tolerant of a missing method (a server render, a test).
 */
export function scrollBoardIntoView(el: unknown, reduced: boolean): void {
  const target = el as { scrollIntoView?: (o: ScrollIntoViewOptions) => void } | null;
  if (!target || typeof target.scrollIntoView !== 'function') return;
  target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
}

/** Where a mark's hit disc sits: the centre of a body, the midpoint of a line, the anchor of text. */
function centerOf(mark: Mark): { cx: number; cy: number } {
  if (mark.shape === 'rect')
    return { cx: mark.x + (mark.w ?? 10) / 2, cy: mark.y + (mark.h ?? 10) / 2 };
  if (mark.shape === 'line')
    return { cx: (mark.x + (mark.x2 ?? mark.x)) / 2, cy: (mark.y + (mark.y2 ?? mark.y)) / 2 };
  return { cx: mark.x, cy: mark.y };
}

/** A mark's own radius, for the hit disc: a circle's r, half a rect's longer side, a line's half length. */
function extentOf(mark: Mark): number {
  if (mark.shape === 'rect') return Math.max(mark.w ?? 10, mark.h ?? 10) / 2;
  if (mark.shape === 'line')
    return Math.hypot((mark.x2 ?? mark.x) - mark.x, (mark.y2 ?? mark.y) - mark.y) / 2;
  if (mark.shape === 'text') return (mark.r ?? 7) / 2;
  return mark.r ?? (mark.shape === 'ring' ? 20 : 4);
}

function toneStroke(tone: Tone, hue: string): string {
  return tone === 'hue' ? hue : tone === 'muted' ? 'var(--wobo-ink-300)' : 'var(--wobo-ink-700)';
}

/** One SVG mark. `lit` recolours it to the hue (the earned reveal); `hot` is a tap-target hover ring. */
function MarkShape({
  mark,
  hue,
  lit,
  tappable,
  chosen,
  role,
  pxPerUnit,
  onTap,
}: {
  mark: Mark;
  hue: string;
  lit: boolean;
  tappable: boolean;
  chosen: boolean;
  role: MarkRole;
  /** The measured render scale (css px per viewBox unit); 0 until the stage has been measured. */
  pxPerUnit: number;
  onTap?: () => void;
}) {
  const stroke = lit || chosen ? hue : toneStroke(mark.tone ?? 'ink', hue);
  const strokeW = lit ? 1.6 : mark.tone === 'muted' ? 0.8 : 1.4;
  const common = {
    stroke,
    strokeWidth: strokeW,
    fill: 'none',
    style: {
      cursor: tappable ? 'pointer' : 'default',
      transition: 'stroke 0.3s ease, fill 0.4s ease',
    } as const,
    onClick: onTap,
  };
  // the reveal ignites the constellation: solid pigment where the idea landed, a wash on a tapped pick
  const filledLit = lit ? { fill: rgba(hue, 0.85) } : chosen ? { fill: rgba(hue, 0.22) } : {};
  // a tactile filled body AT REST (CONTENT-VISUALS.md §3.1) — flat fill via fill-opacity, never a
  // gradient/shadow. Reveal (filledLit) and tapped-pick still win over it. Bodies only; ring/line
  // /text stay structural. For dimension, the model stacks a darker offset copy behind (§3.2).
  // A target or a handle always has a body (bodyFill): the wire drops `fill` today, and an
  // outline is not a thing a finger can find.
  const fill = bodyFill(mark, role);
  const restFill =
    fill && !lit && !chosen
      ? {
          fill: toneStroke(mark.tone ?? 'ink', hue),
          fillOpacity: fill === 'solid' ? 0.9 : 0.16,
        }
      : {};

  const inner = (() => {
    switch (mark.shape) {
      case 'circle':
        return (
          <circle
            cx={mark.x}
            cy={mark.y}
            r={mark.r ?? 4}
            {...common}
            {...restFill}
            {...filledLit}
          />
        );
      case 'ring':
        return (
          <circle
            cx={mark.x}
            cy={mark.y}
            r={mark.r ?? 20}
            {...common}
            strokeDasharray={mark.tone === 'muted' ? '2 3' : undefined}
          />
        );
      case 'rect':
        return (
          <rect
            x={mark.x}
            y={mark.y}
            width={mark.w ?? 10}
            height={mark.h ?? 10}
            rx={2}
            {...common}
            {...restFill}
            {...filledLit}
          />
        );
      case 'line':
        return (
          <line x1={mark.x} y1={mark.y} x2={mark.x2 ?? mark.x} y2={mark.y2 ?? mark.y} {...common} />
        );
      case 'text':
        return (
          <text
            x={mark.x}
            y={mark.y}
            fontSize={mark.r ?? 7}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={lit ? hue : 'var(--wobo-ink-700)'}
            style={{ fontFamily: 'inherit', fontWeight: 560, transition: 'fill 0.3s ease' }}
          >
            {mark.text}
          </text>
        );
    }
  })();

  if (!tappable) return inner;
  const { cx, cy } = centerOf(mark);
  // The hit disc: painted (transparent, not none) so its whole interior takes the tap, and at
  // least 44 css px across. Under the mark, so the mark's own paint still shows on top.
  // Then a soft pulsing ring so a tap target reads as "touch me" without shouting.
  return (
    <g>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG stage has no <button>; the disc is the tap target */}
      <circle
        cx={cx}
        cy={cy}
        r={hitRadius(extentOf(mark), pxPerUnit)}
        fill="transparent"
        pointerEvents="all"
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        aria-label={mark.text ?? mark.id}
        onClick={onTap}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTap?.();
          }
        }}
      />
      {!chosen && (
        <motion.circle
          cx={cx}
          cy={cy}
          r={extentOf(mark) + 4}
          fill="none"
          stroke={hue}
          strokeWidth={0.8}
          initial={{ opacity: 0.15, scale: 1 }}
          animate={{ opacity: [0.15, 0.5, 0.15], scale: [1, 1.12, 1] }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
          style={{ transformOrigin: `${cx}px ${cy}px`, cursor: 'pointer', pointerEvents: 'none' }}
        />
      )}
      {inner}
    </g>
  );
}

// --- The single stage (one idea, one interaction, act-to-reveal) ----------------------------------

interface StageState {
  done: boolean;
  tapped: string[];
  value: number; // slide value
  handle: { x: number; y: number } | null; // drag handle position (viewBox coords)
}

function DiscoveryStageView({
  stage,
  index,
  total,
  hue,
  specId,
  onComplete,
}: {
  stage: DiscoveryStage;
  index: number;
  total: number;
  hue: string;
  specId: string;
  onComplete: () => void;
}) {
  const reduced = useReducedMotion();
  const bus = useWoboBus();
  const { setMood } = useWoboChat();
  const svgRef = useRef<SVGSVGElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const it = stage.interaction;

  // The render scale, so a hit disc can be sized in css px rather than in viewBox units.
  const [pxPerUnit, setPxPerUnit] = useState(0);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setPxPerUnit(svg.clientWidth / VB_W);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // The board is on screen as the stage opens (SCORECARD.md 3.5 #3): a stage entered with the
  // scroller left low by the previous card put the prompt in view and the thing to act on above it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on entry only; the view is keyed by stage
  useEffect(() => {
    scrollBoardIntoView(boardRef.current, reduced ?? false);
  }, []);

  const [state, setState] = useState<StageState>(() => ({
    done: false,
    tapped: [],
    value: it.kind === 'slide' ? it.from : 0,
    handle: it.kind === 'drag' ? handleStart(stage) : null,
  }));

  // fire the reveal beat exactly once, when the interaction first completes
  const firedRef = useRef(false);
  const fire = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    setState((s) => ({ ...s, done: true }));
    sfx.reveal();
    setMood('explaining');
    window.setTimeout(() => setMood('idle'), 1800);
    onComplete();
  };

  // --- interaction handlers ---
  const tapTarget = (id: string) => {
    if (state.done || it.kind !== 'tap') return;
    setState((s) => {
      if (s.tapped.includes(id)) return s;
      const tapped = [...s.tapped, id];
      sfx.tap();
      if (tapped.length >= (it.need ?? it.targets.length)) queueMicrotask(fire);
      return { ...s, tapped };
    });
  };

  const setSlide = (v: number) => {
    if (it.kind !== 'slide') return;
    const clamped = Math.max(it.min, Math.min(it.max, v));
    setState((s) => ({ ...s, value: clamped }));
    const crossed = it.at >= it.from ? clamped >= it.at : clamped <= it.at;
    if (crossed) fire();
  };

  // drag: map pointer → viewBox via the SVG's own CTM (exact regardless of letterboxing)
  const toViewBox = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };
  const dragging = useRef(false);
  const onHandleDown = (e: ReactPointerEvent) => {
    if (state.done || it.kind !== 'drag') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!dragging.current || it.kind !== 'drag') return;
    const p = toViewBox(e);
    if (!p) return;
    const x = Math.max(2, Math.min(VB_W - 2, p.x));
    const y = Math.max(2, Math.min(VB_H - 2, p.y));
    setState((s) => ({ ...s, handle: { x, y } }));
    if (Math.hypot(x - it.to.x, y - it.to.y) <= (it.radius ?? 8)) {
      setState((s) => ({ ...s, handle: { x: it.to.x, y: it.to.y } }));
      dragging.current = false;
      fire();
    }
  };
  const onHandleUp = () => {
    dragging.current = false;
  };

  // --- live marks (slide bind moves/scales one mark) ---
  const marks = useMemo(() => {
    if (it.kind !== 'slide' || !it.bind) return stage.visual.marks;
    const t = (state.value - it.min) / (it.max - it.min);
    const val = it.bind.at[0] + t * (it.bind.at[1] - it.bind.at[0]);
    return stage.visual.marks.map((m) =>
      m.id === it.bind?.mark ? { ...m, [it.bind.prop]: val } : m,
    );
  }, [stage.visual.marks, it, state.value]);

  // --- publish scene state to Wobo's bus + register the stage as a target Wobo can read/drive ---
  const didText =
    it.kind === 'tap'
      ? `tapped ${state.tapped.length}/${it.need ?? it.targets.length}`
      : it.kind === 'slide'
        ? `value ${state.value}${it.unit ? ` ${it.unit}` : ''}`
        : state.handle
          ? `handle at (${Math.round(state.handle.x)},${Math.round(state.handle.y)})`
          : 'handle at start';

  const sceneState = () => ({
    stage: `${index + 1} of ${total}`,
    prompt: it.prompt,
    interaction: it.kind,
    did: didText,
    done: state.done,
  });
  const validActions = () =>
    state.done
      ? ['continue to the next idea']
      : it.kind === 'tap'
        ? [it.prompt, 'tap the highlighted targets']
        : it.kind === 'slide'
          ? [it.prompt, `slide toward ${it.at}${it.unit ? ` ${it.unit}` : ''}`]
          : [it.prompt, 'drag the handle onto the target zone'];
  // Wobo demonstrates by doing: a { complete:true } patch, a slider value, or a tap id
  const applyTutorAction = (patch: Record<string, unknown>) => {
    if (patch.complete === true) return fire();
    if (it.kind === 'slide' && num(patch.value)) return setSlide(patch.value);
    if (it.kind === 'tap' && typeof patch.tap === 'string') return tapTarget(patch.tap);
    if (it.kind === 'drag' && patch.drop === true) {
      setState((s) => ({ ...s, handle: { x: it.to.x, y: it.to.y } }));
      fire();
    }
  };

  const stageRef = useRegisterTarget<HTMLDivElement>(`discovery-${specId}-stage-${index}`, {
    kind: 'discovery-stage',
    label: `discovery stage ${index + 1}: ${it.prompt}`,
    getSceneState: sceneState,
    getValidActions: validActions,
    applyTutorAction,
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `discovery-${specId}-${index}`,
      steps: [
        `stage ${index + 1}/${total}`,
        it.prompt,
        didText,
        state.done ? 'revealed' : 'exploring',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, specId, index, total, it.prompt, didText, state.done]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const tapSet = it.kind === 'tap' ? new Set(it.targets) : null;

  return (
    <CardBody maxWidth={640}>
      <motion.div
        ref={boardRef}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        {/* stage dots — endowed progress, one idea at a time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {Array.from({ length: total }, (_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: positional stage dots
              key={i}
              style={{
                height: 3,
                width: i === index ? 22 : 10,
                borderRadius: 10,
                background: i <= index ? hue : 'var(--wobo-hairline-on-paper-strong)',
                transition: 'width 0.3s ease, background 0.3s ease',
              }}
            />
          ))}
        </div>

        {/* the stage — the visual subject, large */}
        <div ref={stageRef}>
          <Stage
            hue={hue}
            tint={0.05}
            minHeight={280}
            style={{ padding: 'clamp(16px, 4vw, 30px)' }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              width="100%"
              style={{ maxHeight: 340, touchAction: 'none' }}
              role="img"
              aria-label={it.prompt}
            >
              {marks.map((m) => {
                const isHandle = it.kind === 'drag' && m.id === it.handle;
                const drawn =
                  isHandle && state.handle ? { ...m, x: state.handle.x, y: state.handle.y } : m;
                return (
                  <g
                    key={m.id}
                    onPointerDown={isHandle ? onHandleDown : undefined}
                    onPointerMove={isHandle ? onHandleMove : undefined}
                    onPointerUp={isHandle ? onHandleUp : undefined}
                    onPointerCancel={isHandle ? onHandleUp : undefined}
                    style={isHandle ? { cursor: state.done ? 'default' : 'grab' } : undefined}
                  >
                    {/* the handle's grab disc: painted, and at least 44 css px across */}
                    {isHandle && !state.done && (
                      <circle
                        cx={centerOf(drawn).cx}
                        cy={centerOf(drawn).cy}
                        r={hitRadius(extentOf(drawn), pxPerUnit)}
                        fill="transparent"
                        pointerEvents="all"
                      />
                    )}
                    <MarkShape
                      mark={drawn}
                      hue={hue}
                      lit={state.done}
                      tappable={Boolean(tapSet?.has(m.id)) && !state.done}
                      chosen={state.tapped.includes(m.id)}
                      role={isHandle ? 'handle' : tapSet?.has(m.id) ? 'target' : 'static'}
                      pxPerUnit={pxPerUnit}
                      onTap={tapSet?.has(m.id) ? () => tapTarget(m.id) : undefined}
                    />
                  </g>
                );
              })}
              {/* the drag target zone — a dashed hue ring inviting the drop */}
              {it.kind === 'drag' && !state.done && (
                <motion.circle
                  cx={it.to.x}
                  cy={it.to.y}
                  r={it.radius ?? 8}
                  fill="none"
                  stroke={hue}
                  strokeWidth={0.9}
                  strokeDasharray="2 2.5"
                  animate={reduced ? undefined : { opacity: [0.4, 0.85, 0.4] }}
                  transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
                />
              )}
            </svg>

            {/* the ignite flash — the region catching light the instant the idea lands */}
            <AnimatePresence>
              {state.done && !reduced && (
                <motion.div
                  aria-hidden
                  initial={{ opacity: 0.9, scale: 0.6 }}
                  animate={{ opacity: 0, scale: 1.15 }}
                  transition={{ duration: 0.9, ease: [0.15, 0, 0.2, 1] }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    background: `radial-gradient(circle at 50% 46%, ${rgba(hue, 0.45)}, transparent 62%)`,
                  }}
                />
              )}
            </AnimatePresence>
          </Stage>
        </div>

        {/* slide interaction: the slider sits under the stage it drives */}
        {it.kind === 'slide' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input
              type="range"
              min={it.min}
              max={it.max}
              value={state.value}
              step={1}
              disabled={state.done}
              onChange={(e) => setSlide(Number(e.target.value))}
              aria-label={it.prompt}
              style={{ flex: 1, accentColor: hue, cursor: state.done ? 'default' : 'pointer' }}
            />
            <div
              style={{
                minWidth: 78,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                fontSize: '1.05rem',
                fontWeight: 560,
                color: 'var(--wobo-ink-900)',
              }}
            >
              {(it.valueLabel ?? '{v}').replace('{v}', String(state.value))}
              {it.valueLabel ? '' : it.unit ? ` ${it.unit}` : ''}
            </div>
          </div>
        )}

        {/* the one interaction prompt — the only instruction on screen */}
        <div
          style={{
            ...lead,
            ...captionSurface,
            color: 'var(--wobo-ink-900)',
          }}
        >
          {it.prompt}
        </div>

        {/* the reveal beat — the idea + Wobo's caption, land together, only after the act */}
        <AnimatePresence>
          {state.done && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 26,
                delay: reduced ? 0 : 0.12,
              }}
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
                {stage.reveal}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden style={{ color: hue, fontSize: '1.1rem', lineHeight: 1.4 }}>
                  ◍
                </span>
                <div style={{ ...lead, fontStyle: 'italic', color: 'var(--wobo-ink-700)' }}>
                  {stage.caption}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </CardBody>
  );
}

function handleStart(stage: DiscoveryStage): { x: number; y: number } {
  const it = stage.interaction;
  if (it.kind !== 'drag') return { x: 0, y: 0 };
  const m = stage.visual.marks.find((mk) => mk.id === it.handle);
  return m ? { x: m.x, y: m.y } : { x: 12, y: VB_H - 10 };
}

// --- The shell — walks the stages, owns the action bar, gates advance on completion ---------------

export function Discovery({
  spec,
  hue = hueForTopic(''),
  setBar,
  onDone,
}: {
  spec: DiscoverySpec;
  hue?: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [stageDone, setStageDone] = useState(false);
  const last = idx >= spec.stages.length - 1;

  // the bar: held closed until the learner completes the stage's interaction (advance gate)
  useEffect(() => {
    setBar({
      primary: {
        label: last ? 'complete' : 'continue',
        disabled: !stageDone,
        onClick: () => {
          if (last) return onDone();
          setStageDone(false);
          setIdx((i) => i + 1);
        },
      },
    });
  }, [stageDone, last, setBar, onDone]);

  const stage = spec.stages[idx];
  if (!stage) return null;

  return (
    <DiscoveryStageView
      key={idx}
      stage={stage}
      index={idx}
      total={spec.stages.length}
      hue={hue}
      specId={spec.id}
      onComplete={() => setStageDone(true)}
    />
  );
}

// --- A hand-authored demo spec (the atom) — proves the shell end to end ----------------------------

export const DISCOVERY_DEMO: DiscoverySpec = {
  id: 'demo-atom',
  title: 'inside the atom',
  stages: [
    {
      // TAP — find the nucleus inside mostly-empty space
      visual: {
        marks: [
          // orbital cloud stays structural line-work; the nucleus and electrons are filled objects
          { id: 'cloud', shape: 'ring', x: 50, y: 31, r: 26, tone: 'muted' },
          { id: 'e1', shape: 'circle', x: 50, y: 5, r: 1.9, tone: 'muted', fill: 'solid' },
          { id: 'e2', shape: 'circle', x: 76, y: 31, r: 1.9, tone: 'muted', fill: 'solid' },
          { id: 'e3', shape: 'circle', x: 32, y: 48, r: 1.9, tone: 'muted', fill: 'solid' },
          { id: 'nucleus', shape: 'circle', x: 50, y: 31, r: 3.6, tone: 'ink', fill: 'solid' },
          // a lighter catch-light on the top-left — stacked flat tone gives the core a lit sphere read (§3.2)
          { id: 'nucHi', shape: 'circle', x: 48.7, y: 29.7, r: 1.1, tone: 'muted', fill: 'solid' },
        ],
      },
      interaction: {
        kind: 'tap',
        prompt:
          'an atom is almost entirely empty space. tap where nearly all of its mass is hiding.',
        targets: ['nucleus'],
      },
      reveal:
        'that tiny core, the nucleus, holds more than 99.9% of the atom’s mass in a speck of its volume.',
      caption: 'so an atom is mostly nothing, with everything heavy crammed into the middle.',
    },
    {
      // SLIDE — add protons, watch the core grow, cross into a new element
      visual: {
        marks: [
          { id: 'ring', shape: 'ring', x: 50, y: 31, r: 24, tone: 'muted' },
          // a SOLID core that visibly grows as protons are added — a filled sphere, not a hollow ring
          { id: 'core', shape: 'circle', x: 50, y: 31, r: 4, tone: 'ink', fill: 'solid' },
          {
            id: 'cap',
            shape: 'text',
            x: 50,
            y: 56,
            r: 6,
            text: 'protons decide the element',
            tone: 'muted',
          },
        ],
      },
      interaction: {
        kind: 'slide',
        prompt: 'slide to add protons to the nucleus. keep going until it becomes carbon.',
        min: 1,
        max: 8,
        from: 1,
        at: 6,
        valueLabel: '{v} protons',
        bind: { mark: 'core', prop: 'r', at: [4, 11] },
      },
      reveal:
        'six protons, and it is carbon, always. the proton count alone fixes which element an atom is.',
      caption: 'change the protons and you change the element itself, not just its size.',
    },
    {
      // DRAG — place an electron into its shell
      visual: {
        marks: [
          { id: 'shell', shape: 'ring', x: 50, y: 31, r: 22, tone: 'muted' },
          { id: 'nuc', shape: 'circle', x: 50, y: 31, r: 3.4, tone: 'ink', fill: 'solid' },
          // the draggable electron is a chunky hue knob — a graspable object, not a bare dot (§3.3)
          { id: 'electron', shape: 'circle', x: 16, y: 52, r: 3.4, tone: 'hue', fill: 'solid' },
        ],
      },
      interaction: {
        kind: 'drag',
        prompt: 'drag the loose electron into the empty shell around the nucleus.',
        handle: 'electron',
        to: { x: 50, y: 9 },
        radius: 7,
      },
      reveal:
        'electrons live in shells, not on the nucleus, held at a distance, filling from the inside out.',
      caption: 'they orbit out here, which is exactly why the atom is so mostly-empty.',
    },
  ],
};
