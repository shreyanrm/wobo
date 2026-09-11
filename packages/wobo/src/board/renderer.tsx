'use client';

/**
 * The ink renderer (docs/BOARD.md §7) — one SVG layer that draws every board object along its own
 * path, at the pace of a hand, on the beat of Wobo's voice.
 *
 * What makes it a hand and not an animation library:
 *  - every object is drawn along its stroke, with the pen's anticipation and settle (`pen.ts`);
 *  - `write` and `tex` are genuinely written, glyph by glyph, through a moving pen mask
 *    (`handwriting.ts`), with a progressive text reveal as the fallback when the font never comes;
 *  - nothing is placed by pixels: anchors re-resolve whenever the rect they hang from moves, and a
 *    mark whose target disappears fades out rather than floating;
 *  - the aesthetic comes from theme tokens — marker on paper in light, chalk on slate in dark —
 *    never from a literal colour;
 *  - reduced motion draws everything instantly, still in order, on the same voice timing.
 *
 * What makes it fast: geometry is computed once per (object, generation, anchor signature) and
 * cached; settled ink lives in a memoised layer that React skips entirely; only the few objects
 * actually drawing or fading are touched per frame; history beyond the render budget is virtualised
 * out of the DOM; and the nib is a non-scaling stroke, so no transform ever rescales a pen width.
 */

import { useReducedMotion } from '@wobo/motion';
import {
  type CSSProperties,
  memo,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { scrollHold } from '../scroll-hold';
import {
  anchorSignature,
  type BoardFrame,
  type BoardRect,
  boardToRect,
  frameOf,
  isScreenAnchored,
  offGlass,
  pxPerUnit,
  type RectLike,
  rectToBoard,
  resolveAnchorBox,
  unitsHigh,
  unitsWide,
  viewportToBoard,
} from './anchors';
import {
  geometryOf,
  MIN_TYPE_PX,
  type ObjectGeometry,
  tallestGlyphUnits,
  TYPE_AIM,
} from './geometry';
import { HAND_MASK_FACTOR, type HandFont, handFont, loadHandFont } from './handwriting';
import {
  autoCameraTarget,
  blocksLayout,
  CAMERA_FILL,
  CAMERA_FILL_MAX,
  boardArea,
  type Camera,
  cameraArrived,
  contentBounds,
  easeCamera,
  fitCamera,
  NOTE_REACH,
  REACH_AIM,
  RESTING_CAMERA,
} from './layout';
import {
  dashFor,
  fadeOpacity,
  objectProgress,
  penTick,
  polylineLength,
  type Stroke,
  sequenceStrokes,
  smoothPath,
  strokeDurationMs,
  traceDurationMs,
} from './pen';
import {
  BOARD_UNITS,
  type BoardObject,
  type BoardPoint,
  type BoardStyle,
  type InkRole,
} from './schema';
import { describe, type LookUp } from './spoken';
import { type BoardObjectState, type BoardStore, FADE_MS, RENDER_BUDGET } from './store';
import { boardStatesAt } from './timeline';

// --- Targets and focus ------------------------------------------------------------------------------

/** The shape the scene bus already publishes — accepted directly, no adapter. */
export interface BoardTarget {
  id: string;
  getRect: () => DOMRect | null;
}

/** A region the learner drew or selected, which Wobo's next turn can anchor to. */
export interface LearnerFocus {
  id: string;
  kind: 'stroke';
  /** The stroke in board units. */
  points: BoardPoint[];
  box: BoardRect;
  /** The same region in viewport px, for the gesture layer and the brain's context packet. */
  rect: RectLike;
  /** Registered targets the stroke passed over. */
  targetIds: string[];
  /** Stylus pressure, averaged over the stroke; 0.5 for a mouse or a finger. */
  pressure: number;
}

// --- Theme ------------------------------------------------------------------------------------------

/**
 * Ink roles resolve to tokens, never literals. The neutral token already inverts with the theme,
 * so light gives marker on paper and dark gives chalk on slate for free; the nib widens and softens
 * slightly on slate, which is the difference between a marker and a stick of chalk.
 */
const BOARD_CSS = `
.wobo-board{
  --wobo-ink:var(--wobo-ink-900,#0D0D10);
  --wobo-accent:var(--wobo-ultramarine,#1F35E0);
  --wobo-learner:var(--wobo-ink-500,#6E6E76);
  --wobo-faint:var(--wobo-ink-300,#72727C);
  --wobo-nib:3;
  --wobo-ink-opacity:1;
}
[data-theme="dark"] .wobo-board{ --wobo-ink-opacity:.86; }
.wobo-board svg{display:block;overflow:visible}
.wobo-board .wobo-stroke{fill:none;stroke-linecap:round;stroke-linejoin:round}
.wobo-board .wobo-hit{fill:transparent;outline:none}
.wobo-board .wobo-hit:focus-visible{stroke:var(--wobo-accent);stroke-width:3;stroke-dasharray:4 3}
`;

const INK_VAR: Record<InkRole, string> = {
  wobo: 'var(--wobo-ink)',
  accent: 'var(--wobo-accent)',
  learner: 'var(--wobo-learner)',
  faint: 'var(--wobo-faint)',
};

const inkOf = (role: InkRole | undefined): string => INK_VAR[role ?? 'wobo'];

/**
 * EACH WRITTEN GLYPH'S SHARE OF THE OBJECT'S CLOCK (the adversary, wave 47, finding 1).
 *
 * The glyph clock used to divide the running travel by `geometry.length` — the same sum, taken in
 * a different association order. A hair of floating point put the LAST glyph's slot past 1, so
 * `within(1, slot)` never reached 1 and the glyph stayed forever in the half-drawn branch, behind
 * a mask, in the DOM with a real box and painting nothing. The Punnett square's row-3 header 't'
 * was missing at both widths on a board signed `numbers_agree:punnett cells` verified, and the
 * projectile's ground and the lens's label went the same way.
 *
 * The clock is now the pen's OWN travel, summed exactly as the pen spends it: strokes first, then
 * each glyph in order. The last glyph therefore ends at 1 by construction, and a glyph that has
 * finished is painted as a fill.
 */
export function glyphSlots(geometry: ObjectGeometry): { from: number; to: number }[] {
  if (geometry.glyphs.length === 0) return [];
  const lengths = geometry.glyphs.map((g) => g.trace.reduce((s, t) => s + t.length, 0));
  const start = geometry.strokes.reduce((s, x) => s + x.length, 0);
  let travelled = start;
  for (const n of lengths) travelled += n;
  const total = travelled > 0 ? travelled : 1;
  const slots: { from: number; to: number }[] = [];
  let at = start;
  lengths.forEach((n, i) => {
    const from = at / total;
    at += n;
    // The last glyph closes the clock: no residue is left for a rounding error to hide in.
    slots.push({ from, to: i === lengths.length - 1 ? 1 : at / total });
  });
  return slots;
}

/**
 * THE FRAGMENT A HALF-DRAWN GLYPH IS MASKED THROUGH.
 *
 * Every node is keyed `<object id>#<generation>`, and that key is the node's `id`, so a mask id
 * used to read `wobo-pen-b0_1square#0-g3`. Measured in Chromium, `url(#…)` still resolves that —
 * the fragment is everything after the first `#` — so this was NOT what lost the Punnett square's
 * row-3 't' (`glyphSlots` was). It is still not an id: `querySelector('#…')` cannot address it,
 * `getElementById` and the URL parser disagree about it, and other engines are free to differ. The
 * fragment alphabet is enforced here so nothing downstream has to know.
 */
export function penMaskId(id: string, glyphKey: string): string {
  return `wobo-pen-${id.replace(/[^A-Za-z0-9_-]/g, '_')}-${glyphKey}`;
}

// --- Geometry cache ----------------------------------------------------------------------------------

export interface CacheEntry {
  sig: string;
  generation: number;
  font: HandFont | null;
  geometry: ObjectGeometry | null;
  /** Draw time in ms, resolved once. */
  durMs: number;
  slots: { from: number; to: number }[];
}

/**
 * How long the pen takes over an object. The plan's own `dur` wins. On the glass (a px frame) the
 * trace's clock rules: a ring 300 to 600 ms, an underline by its length, in screen px
 * (docs/INK-FREEZE-PLAN-TRACE.md §3). On a board the hand's units-per-ms pace is unchanged.
 */
function drawTimeOf(
  state: BoardObjectState,
  geometry: ObjectGeometry | null,
  frame: BoardFrame,
): number {
  if (state.durMs !== undefined) return state.durMs;
  const length = geometry?.length ?? 0;
  if (frame.scale !== undefined) {
    return traceDurationMs(String(state.object.kind), length * pxPerUnit(frame));
  }
  return strokeDurationMs(length);
}

/**
 * Each stroke's share of the object's draw time, measured against the object's WHOLE pen travel —
 * strokes and written glyphs on one clock. Without this an axis would finish its rules before its
 * label had begun, and the two would race.
 */
export function strokeSlots(geometry: ObjectGeometry): { from: number; to: number }[] {
  const total = geometry.length;
  const drawn = geometry.strokes.reduce((sum, x) => sum + Math.max(x.length, 0), 0);
  if (total <= 0 || drawn <= 0) return sequenceStrokes(geometry.strokes);
  let acc = 0;
  return geometry.strokes.map((stroke) => {
    const from = acc / total;
    acc += Math.max(stroke.length, 0);
    return { from, to: acc / total };
  });
}

// --- One object ---------------------------------------------------------------------------------------

interface NodeProps {
  id: string;
  geometry: ObjectGeometry;
  ink: InkRole;
  weight: number;
  dash?: number[];
  fill: 'none' | 'wash' | 'solid';
  opacity: number;
  progress: number;
  nibPx: number;
  slots: { from: number; to: number }[];
  reduced: boolean;
  ariaLabel?: string;
  /** The registry target this mark is anchored to, when it is anchored to one. */
  anchor?: string;
  /** The BOARD OBJECT this mark hangs off, when it hangs off one — its subject. */
  on?: string;
}

/** Progress within one stroke of an object, given the object's own 0..1. */
function within(progress: number, slot: { from: number; to: number }): number {
  const span = slot.to - slot.from;
  if (span <= 0) return progress >= slot.to ? 1 : 0;
  const t = (progress - slot.from) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const BoardObjectNode = memo(function BoardObjectNode(props: NodeProps) {
  const { geometry, ink, weight, opacity, progress, nibPx, slots, reduced, dash, fill } = props;
  if (opacity <= 0) return null;
  const colour = inkOf(ink);
  const strokeWidth = nibPx * weight;
  const nodes: React.ReactNode[] = [];

  geometry.strokes.forEach((stroke, i) => {
    if (!stroke.d) return;
    // Stroke i of this object IS its identity: the list is fixed at build time and never reorders.
    const key = `s${i}`;
    const slot = slots[i] ?? { from: 0, to: 1 };
    const p = reduced ? (progress >= 1 ? 1 : 0) : within(progress, slot);
    if (p <= 0) return;
    if (stroke.fill) {
      nodes.push(
        <path
          key={key}
          d={stroke.d}
          fill={colour}
          fillOpacity={fill === 'wash' ? 0.14 : 0.9}
          stroke="none"
          opacity={p}
        />,
      );
      return;
    }
    nodes.push(
      <path
        key={key}
        className="wobo-stroke"
        d={stroke.d}
        stroke={colour}
        strokeWidth={strokeWidth * (stroke.weight ?? 1)}
        vectorEffect="non-scaling-stroke"
        {...(dash ? { strokeDasharray: dash.join(' ') } : p >= 1 ? {} : dashFor(p))}
      />,
    );
  });

  // Written glyphs: the fill appears under a fat round nib travelling its own contour.
  const gslots = glyphSlots(geometry);
  geometry.glyphs.forEach((glyph, gi) => {
    const glyphKey = `g${gi}`;
    const p = reduced
      ? progress >= 1
        ? 1
        : 0
      : within(progress, gslots[gi] ?? { from: 0, to: 1 });
    if (p <= 0) return;
    if (glyph.drawn || !glyph.fill) {
      // A symbol Wobo draws by hand — the trace IS the ink.
      const slotsInside = sequenceStrokes(glyph.trace.map((t) => ({ d: t.d, length: t.length })));
      glyph.trace.forEach((t, ti) => {
        const traceKey = `${glyphKey}-${ti}`;
        const sp = reduced ? 1 : within(p, slotsInside[ti] ?? { from: 0, to: 1 });
        if (sp <= 0) return;
        nodes.push(
          <path
            key={traceKey}
            className="wobo-stroke"
            d={t.d}
            stroke={colour}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
            {...(sp >= 1 ? {} : dashFor(sp))}
          />,
        );
      });
      return;
    }
    if (p >= 1) {
      nodes.push(<path key={glyphKey} d={glyph.fill} fill={colour} stroke="none" />);
      return;
    }
    const maskId = penMaskId(props.id, glyphKey);
    const maskWidth = (props.geometry.size ?? 30) * HAND_MASK_FACTOR;
    const inner = sequenceStrokes(glyph.trace.map((t) => ({ d: t.d, length: t.length })));
    nodes.push(
      <g key={glyphKey}>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          {glyph.trace.map((t, ti) => {
            const traceKey = `${glyphKey}-${ti}`;
            const sp = within(p, inner[ti] ?? { from: 0, to: 1 });
            if (sp <= 0) return null;
            return (
              <path
                key={traceKey}
                d={t.d}
                fill="none"
                stroke="#fff"
                strokeWidth={maskWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                {...(sp >= 1 ? {} : dashFor(sp))}
              />
            );
          })}
        </mask>
        <path d={glyph.fill} fill={colour} stroke="none" mask={`url(#${maskId})`} />
      </g>,
    );
  });

  if (geometry.image) {
    const { box, href, alt } = geometry.image;
    nodes.push(
      <image
        key="img"
        href={href}
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        opacity={progress}
      >
        <title>{alt}</title>
      </image>,
    );
  }

  return (
    <g
      // `<object id>#<generation>` — the only way a golden-board test can name a mark in the DOM
      // without reading pixels. Presentational; nothing in the product reads it.
      data-wobo-object={props.id}
      // AND WHAT IT IS ABOUT. A probe can measure where a mark IS off the DOM, and could never
      // ask the only question that matters about a mark — which thing is it on? — without going
      // back to the plan. Live at 390 that gap let one ellipse sprawl across three lines of a
      // photographed page with every containment check passing (the adversary, wave 57, finding
      // 1; the probe is `strayMarks`, apps/web-pwa/src/wobo/doubt-surface.ts). Presentational.
      {...(props.anchor ? { 'data-wobo-anchor': props.anchor } : {})}
      /**
       * AND WHICH MARK IT HANGS OFF, when the thing it is about is another mark rather than
       * something on the page. `data-wobo-anchor` names a page target; this names a board object,
       * and it is the same question asked of the other half of the grammar.
       *
       * The reach law — "a note in the margin within 24 px of its subject" — cannot be measured
       * from the DOM at all without it: a probe can see where every mark is and has no way to say
       * which one each note belongs to, which is how 29 of 60 marks drifted past the law for two
       * waves with every containment check passing. Presentational; nothing in the product reads
       * it.
       */
      {...(props.on ? { 'data-wobo-on': props.on } : {})}
      opacity={opacity}
      {...(props.ariaLabel ? { 'aria-label': props.ariaLabel } : {})}
    >
      {nodes}
    </g>
  );
});

/** The no-font fallback: the same words, revealed progressively, at the same pace. */
const WrittenFallback = memo(function WrittenFallback(props: {
  id: string;
  text: NonNullable<ObjectGeometry['text']>;
  ink: InkRole;
  opacity: number;
  progress: number;
}) {
  const { text, progress } = props;
  const chars = text.lines.join('\n').length;
  const shown = Math.ceil(chars * Math.max(0, Math.min(1, progress)));
  let budget = shown;
  return (
    <g data-wobo-object={props.id} aria-label={text.lines.join(' ')} opacity={props.opacity}>
      {text.lines.map((line, i) => {
        const lineKey = `l${i}`;
        const take = Math.max(0, Math.min(line.length, budget));
        budget -= line.length;
        if (take <= 0) return null;
        return (
          <text
            key={lineKey}
            x={text.x}
            y={text.y + text.size * 0.82 + i * text.lineHeight}
            fill={inkOf(props.ink)}
            fontFamily="'Caveat', cursive"
            fontSize={text.size}
          >
            {line.slice(0, take)}
          </text>
        );
      })}
    </g>
  );
});

/**
 * The hit area over a drawn control. It is a real HTML control sitting invisibly on top of the ink,
 * so the keyboard, the focus ring and the screen reader all work exactly as they do everywhere else
 * in the product; the SVG underneath is only the drawing of it.
 */
function ControlHit(props: {
  /** The hit box in local px, already converted out of board units. */
  box: { left: number; top: number; width: number; height: number };
  state: BoardObjectState;
  variable: string;
  onPoint: (clientX: number, clientY: number) => void;
  onValue: (value: number | boolean | [number, number]) => void;
}) {
  const { box, state, variable, onPoint, onValue } = props;
  const obj = state.object;
  const label = 'label' in obj && obj.label ? obj.label : variable;
  const frame: CSSProperties = {
    position: 'absolute',
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    color: 'transparent',
    cursor: 'pointer',
    margin: 0,
    padding: 0,
  };
  if (obj.kind === 'slider') {
    // A native range: every assistive technology and every keyboard already knows this control.
    return (
      <input
        type="range"
        aria-label={label}
        min={obj.min}
        max={obj.max}
        step={obj.step ?? (obj.max - obj.min) / 100}
        value={obj.value}
        onChange={(e) => onValue(Number(e.target.value))}
        style={{ ...frame, opacity: 0 }}
      />
    );
  }
  if (obj.kind === 'toggle') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={obj.value}
        aria-label={label}
        onClick={() => onValue(!obj.value)}
        style={frame}
      />
    );
  }
  if (obj.kind === 'input') {
    // Reading, not editing: a value Wobo wrote in. Typing into it goes through the composer.
    return (
      <output aria-label={label} style={{ ...frame, cursor: 'default' }}>
        {obj.value}
      </output>
    );
  }
  if (obj.kind !== 'drag') return null;
  const step = 8;
  return (
    <button
      type="button"
      aria-label={`${label}, move with the arrow keys`}
      onPointerDown={(e) => onPoint(e.clientX, e.clientY)}
      onPointerMove={(e) => {
        if (e.buttons === 1) onPoint(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const move: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const delta = move[e.key];
        if (!delta) return;
        e.preventDefault();
        onValue([
          obj.value[0] + delta[0] * (e.shiftKey ? 3 : 1),
          obj.value[1] + delta[1] * (e.shiftKey ? 3 : 1),
        ]);
      }}
      style={frame}
    />
  );
}

/** One object, resolved: its geometry, how long the pen takes over it, and what it hangs from. */
export interface Built {
  state: BoardObjectState;
  geometry: ObjectGeometry | null;
  durMs: number;
  slots: { from: number; to: number }[];
  sig: string;
  /**
   * The thing this mark is about has left the glass (its rect is gone, or wholly outside the
   * viewport). The last geometry is kept so the mark FADES where it was, rather than being dropped
   * on the frame the rect went or floating somewhere else.
   */
  gone: boolean;
}

const NO_BUILD: Built[] = [];

export interface BuildContext {
  frame: BoardFrame;
  font: HandFont | null;
  store: BoardStore;
  cache: Map<string, CacheEntry>;
  targets: () => readonly BoardTarget[];
  focus: () => readonly { id: string; rect: RectLike | (() => RectLike | null) }[];
  /** Resolved boxes, by object id — an `{object: id}` anchor reads this. Filled as it goes. */
  boxes: Map<string, BoardRect>;
  /** Boxes already taken, so a label can step out of the way of one. Appended as it goes. */
  occupied: BoardRect[];
  /** The page's own text near a subject, in viewport px, for a note to dodge. */
  avoid?: (near: RectLike) => readonly RectLike[];
  /** The board's one written-type factor (`TYPE_LADDER`). 1 is the hand's own sizes. */
  typeScale?: number;
  /**
   * Screen pixels per board unit under the camera this board settles at (`settleGlassScale`). What
   * lets the geometry's placement solver state the 24 px reach law in the units it works in.
   */
  glassScale?: number;
}

/** The anchor-bearing side channels: an arrow starts somewhere, a line ends somewhere. */
interface AnchorHolder {
  from?: unknown;
  to?: unknown;
  object?: unknown;
}

/** Every object id whose box this object's geometry reads. */
function anchorObjectId(a: unknown): string | null {
  return a && typeof a === 'object' && 'object' in a && typeof (a as { object: unknown }).object === 'string'
    ? ((a as { object: string }).object)
    : null;
}

/**
 * THE IDS THIS MARK CANNOT BE DRAWN WITHOUT (the adversary, wave 48, findings 1 and 2).
 *
 * Not only the anchor: an arrow reads its `from`, a line its `to`, a swipe the box of the object
 * it takes off. Every one of those is `resolveAnchorBox` against `ctx.objectBox`, so every one of
 * them is a build-order edge.
 */
export function objectDependencies(
  state: BoardObjectState,
  store: Pick<BoardStore, 'anchorOf'>,
): string[] {
  const out: string[] = [];
  const push = (id: string | null) => {
    if (id && id !== state.object.id && !out.includes(id)) out.push(id);
  };
  push(anchorObjectId(store.anchorOf(state)));
  const o = state.object as unknown as AnchorHolder;
  if (state.object.kind === 'arrow') push(anchorObjectId(o.from));
  if (state.object.kind === 'line') push(anchorObjectId(o.to));
  if (state.object.kind === 'erase' && typeof o.object === 'string') push(o.object);
  return out;
}

/**
 * The order the pass must build in: a mark that hangs off another is built AFTER it, however the
 * two were beaten. Stable — anything with no dependency between it and its neighbour keeps its
 * arrival order, because arrival order is z-order and the store is the only authority on that.
 *
 * A cycle (a label on an arrow on the label) is not dropped: whatever is still unplaced when no
 * further mark can be placed is emitted in arrival order, and the second pass in `buildObjects`
 * picks up whichever half of it resolved.
 */
export function dependencyOrder(
  states: readonly BoardObjectState[],
  store: Pick<BoardStore, 'anchorOf'>,
): BoardObjectState[] {
  const present = new Map<string, BoardObjectState>();
  for (const s of states) present.set(s.object.id, s);
  const out: BoardObjectState[] = [];
  const done = new Set<string>();
  const open = new Set<string>();
  const visit = (state: BoardObjectState): void => {
    const id = state.object.id;
    if (done.has(id) || open.has(id)) return;
    open.add(id);
    for (const dep of objectDependencies(state, store)) {
      const on = present.get(dep);
      if (on) visit(on);
    }
    open.delete(id);
    done.add(id);
    out.push(state);
  };
  for (const s of states) visit(s);
  return out;
}

/**
 * The marks whose geometry can move without the surface moving: anything hanging off the page, and
 * anything that hangs off one of those, transitively and WHATEVER ORDER THEY WERE BEATEN IN. The
 * old single forward walk missed a label beaten before the ring it sits on, so the label was built
 * on the settled clock and stood still while its ring travelled with the page.
 */
export function liveObjectIds(
  states: readonly BoardObjectState[],
  store: Pick<BoardStore, 'anchorOf'>,
): Set<string> {
  const live = new Set<string>();
  const deps = new Map<string, string[]>();
  for (const state of states) {
    deps.set(state.object.id, objectDependencies(state, store));
    if (isScreenAnchored(store.anchorOf(state))) live.add(state.object.id);
  }
  // Fixed point: cheap, and bounded by the render budget.
  for (;;) {
    let grew = false;
    for (const [id, on] of deps) {
      if (live.has(id)) continue;
      if (on.some((d) => live.has(d))) {
        live.add(id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return live;
}

/**
 * Resolve a set of objects into geometry, reusing the cache wherever the anchor signature, the
 * generation and the font are all unchanged. Split out of the component so the board-anchored half
 * and the screen-anchored half can be built on different clocks (see `liveIds`).
 *
 * Built in DEPENDENCY order and returned in STORE order: the first is what makes an `{object: …}`
 * anchor resolvable at all, the second is z-order.
 */
export function buildObjects(states: readonly BoardObjectState[], build: BuildContext): Built[] {
  const { frame, font, store, cache, boxes, occupied } = build;
  const typeScale = build.typeScale ?? 1;
  const glassScale = build.glassScale;
  const targetMap = new Map<string, BoardTarget>();
  for (const t of build.targets()) targetMap.set(t.id, t);
  const focusMap = new Map<string, RectLike | (() => RectLike | null)>();
  for (const f of build.focus()) focusMap.set(f.id, f.rect);
  const onGlass = frame.scale !== undefined;
  const avoid = build.avoid;
  const ctx = {
    frame,
    targetRect: (id: string) => targetMap.get(id)?.getRect() ?? null,
    focusRect: (id: string) => {
      // Read live, exactly like a registry target: the region moves when the page moves.
      const region = focusMap.get(id);
      return typeof region === 'function' ? region() : (region ?? null);
    },
    objectBox: (id: string) => boxes.get(id) ?? null,
    font,
    occupied,
    typeScale,
    ...(glassScale !== undefined && glassScale > 0 ? { glassScale } : {}),
    // On the glass, placement is bounded by the glass itself, in px.
    ...(onGlass
      ? {
          area: {
            x: frame.panX,
            y: frame.panY,
            w: unitsWide(frame) / frame.zoom,
            h: unitsHigh(frame) / frame.zoom,
          },
        }
      : {}),
    ...(avoid
      ? {
          avoid: (near: BoardRect) =>
            avoid(boardToRect(frame, near)).map((r) => rectToBoard(frame, r)),
        }
      : {}),
  };
  const resolve = (state: BoardObjectState): Built => {
    const anchor = store.anchorOf(state);
    const key = state.object.id;
    const hit = cache.get(key);
    // Has the thing this mark is about left the glass? A missing rect, or one wholly outside the
    // viewport on a glass surface. The mark then keeps its last geometry and fades in place.
    let gone = false;
    if (anchor && ('target' in anchor || 'focus' in anchor)) {
      const rect = 'target' in anchor ? ctx.targetRect(anchor.target) : ctx.focusRect(anchor.focus);
      gone = rect === null || (onGlass && offGlass(rect, frame));
    }
    if (gone && hit?.geometry) {
      return {
        state,
        geometry: hit.geometry,
        durMs: hit.durMs,
        slots: hit.slots,
        sig: hit.sig,
        gone: true,
      };
    }
    const sigBox = anchor ? resolveAnchorBox(anchor, ctx) : null;
    // The type factor is part of the signature: it is a stable scalar for the board, so this costs
    // nothing per frame, and a board that grew its type rebuilds once rather than never.
    const sig = `${anchorSignature(sigBox)}|${frame.zoom}|${typeScale}|${glassScale ?? 0}`;
    let entry: CacheEntry;
    if (hit && hit.sig === sig && hit.generation === state.generation && hit.font === font) {
      entry = hit;
    } else {
      const object = (
        anchor && 'anchor' in state.object ? { ...state.object, anchor } : state.object
      ) as BoardObject;
      const geometry = geometryOf(object, ctx);
      entry = {
        sig,
        generation: state.generation,
        font,
        geometry,
        durMs: drawTimeOf(state, geometry, frame),
        slots: geometry ? strokeSlots(geometry) : [],
      };
      /**
       * NEVER CACHE AN EMPTY GEOMETRY UNDER A SIGNATURE THAT CANNOT CHANGE (the adversary, wave
       * 48, finding 2). An `{object: …}` anchor that did not resolve signs itself `gone|zoom`;
       * if that were cached, the entry would be reused for ever, because a signature taken of a
       * box that does not exist never moves. The mark is left uncached instead, so the next pass
       * — the one where the thing it hangs off has finally been drawn — builds it for real.
       */
      const pending =
        geometry === null && objectDependencies(state, store).some((d) => !boxes.has(d));
      // A mark whose box came back null keeps whatever it last drew: the fade above needs it.
      if (!pending && (geometry || !hit?.geometry)) cache.set(key, entry);
    }
    if (entry.geometry) {
      boxes.set(key, entry.geometry.box);
      // Ground rather than ink: a plotted grid must not push the notes written over it out of the
      // plot (layout.blocksLayout). Every other kind takes its space.
      if (blocksLayout(String(state.object.kind))) occupied.push(entry.geometry.box);
    }
    return {
      state,
      geometry: entry.geometry,
      durMs: entry.durMs,
      slots: entry.slots,
      sig: entry.sig,
      gone,
    };
  };

  const order = dependencyOrder(states, store);
  const done = new Map<string, Built>();
  for (const state of order) done.set(state.object.id, resolve(state));
  /**
   * THE SECOND PASS. Dependency order settles everything that can be settled in one sweep, but a
   * cycle (a note on an arrow that starts at the note) leaves whichever mark was opened first
   * without a box. Now that every box this pass could fill IS filled, try the empties again.
   * Bounded to two sweeps over what is still empty, so a board of two thousand strokes pays
   * nothing for a board with no cycle in it.
   */
  for (let sweep = 0; sweep < 2; sweep += 1) {
    let healed = false;
    for (const state of order) {
      const b = done.get(state.object.id);
      if (!b || b.geometry || b.gone) continue;
      if (!objectDependencies(state, store).some((d) => boxes.has(d))) continue;
      const again = resolve(state);
      if (again.geometry) {
        done.set(state.object.id, again);
        healed = true;
      }
    }
    if (!healed) break;
  }
  // Back in STORE order: the build order is a dependency, z-order is arrival.
  const out: Built[] = [];
  for (const state of states) {
    const b = done.get(state.object.id);
    if (b) out.push(b);
  }
  return out;
}

/**
 * The largest the hand will grow its writing to reach the floor.
 *
 * Past this the board is no longer a drawing with words on it, and the honest answer is that the
 * DRAWING is too dense for the surface — a pipeline's problem, not the hand's. A board that hits
 * the cap is reported by the craft probe rather than silently rendered as a wall of type.
 */
export const MAX_TYPE_SCALE = 2;

/**
 * The rungs the hand will try, in order, when its own sizes fall under the floor.
 *
 * A LADDER, AND NOT A SOLVED NUMBER, because the thing being solved for is not monotone in the way
 * arithmetic on boxes expects: growing a note moves where the next note can go, so a board can
 * measure WORSE at a larger factor than at a smaller one. Measured, wave 49: the lens at 1440 read
 * 12.8 px at a factor of about 1.5 and 11.6 px at 2. So every rung is laid for real and measured
 * with the ruler the law is written in, the first that clears the floor wins, and if none does the
 * best-measuring rung is kept. Five rungs, and only ever walked by a board that needs them.
 */
export const TYPE_LADDER = [1.25, 1.5, 1.75, MAX_TYPE_SCALE] as const;

/**
 * What the solver aims at, against a law of `MIN_TYPE_PX`.
 *
 * The solver works on the glyph boxes the hand laid; the lab measures the traced path the browser
 * painted. They are the same quantity to within a rounding, and a board solved to land EXACTLY on
 * twelve lands at 11.9 (measured: the plant cell at 390). A board can also settle a pixel either
 * side of its own arithmetic depending on what else the surface is doing — the lens at 1440
 * measured 12.8 with motion and 11.8 with reduced motion off the same solve. The headroom is the
 * honest price of computing a thing the browser will re-measure, and it is set by that spread.
 */
const TYPE_FLOOR_PX = TYPE_AIM;

/**
 * THE ONE WRITTEN-TYPE FACTOR FOR A BOARD, SOLVED AGAINST THE INK AND NOT AGAINST THE CAMERA.
 *
 * `geometry.ts`'s note on `typeUnits` names the trap: a floor read off the live camera closes a
 * loop, because the type it grows widens the ink the camera is fitted to. The algebra there shows
 * the way out — under an auto fit the zoom cancels, and what decides legibility is the glyph's
 * height as a fraction of the ink's own extent. So:
 *
 *  1. a PILOT build lays the board at the hand's own sizes, on the surface at zoom 1 (never the
 *     gliding camera), and that build is memoised on the surface, not on the frame clock;
 *  2. this function asks what factor would put the SMALLEST written glyph on the board at
 *     `MIN_TYPE_PX`, allowing for the fact that growing the writing grows the ink the camera has
 *     to fit — it re-fits the camera to the grown ink at each candidate, which is arithmetic on
 *     boxes and costs no geometry;
 *  3. the answer is one stable scalar, and every written size on the board is multiplied by it.
 *
 * Monotone and saturating in `k`, so a bisection lands on the smallest factor that clears the
 * floor. Returns 1 when the hand's own sizes already do.
 */
/**
 * What the SMALLEST written glyph on a built board actually measures on the glass, in px, under
 * the camera that board would be fitted with. The one number the craft law is stated in, and the
 * one the lab measures with `getBBox` × `getScreenCTM` — the same quantity, computed rather than
 * screenshotted.
 */
export function smallestTypePx(
  built: readonly Built[],
  frame: BoardFrame,
  autoCamera: boolean,
  fill: number = CAMERA_FILL,
): number {
  let smallest = Infinity;
  const boxes: BoardRect[] = [];
  for (const b of built) {
    const g = b.geometry;
    if (!g) continue;
    boxes.push(g.box);
    const tall = tallestGlyphUnits(g);
    if (tall > 0) smallest = Math.min(smallest, tall);
  }
  if (!Number.isFinite(smallest) || smallest <= 0) return Number.POSITIVE_INFINITY;
  const k1 = pxPerUnit({ ...frame, zoom: 1 });
  if (!(k1 > 0)) return Number.POSITIVE_INFINITY;
  const zoom = autoCamera
    ? fitCamera(contentBounds(boxes, 0), frame, { fill }).zoom
    : frame.zoom > 0
      ? frame.zoom
      : 1;
  return smallest * k1 * zoom;
}


/**
 * HOW BIG A BOARD UNIT ACTUALLY IS ON THE GLASS, under the camera this board would be fitted with.
 *
 * The sibling of `smallestTypePx`, and the one number `geometry.ts`'s solver needs to state the
 * reach law — twenty-four pixels — in the board units it works in.
 */
export function boardPxPerUnit(
  built: readonly Built[],
  frame: BoardFrame,
  autoCamera: boolean,
  fill: number = CAMERA_FILL,
): number {
  const boxes: BoardRect[] = [];
  for (const b of built) if (b.geometry) boxes.push(b.geometry.box);
  const k1 = pxPerUnit({ ...frame, zoom: 1 });
  const zoom = autoCamera
    ? fitCamera(contentBounds(boxes, 0), frame, { fill }).zoom
    : frame.zoom > 0
      ? frame.zoom
      : 1;
  return k1 * zoom;
}

/**
 * THE BOARD'S TWO SCALARS, SETTLED TOGETHER (the adversary, wave 57, finding 2).
 *
 * `typeScale` is the factor that puts the smallest written glyph over twelve pixels. `glassScale`
 * is how many pixels a board unit measures once the camera has fitted the result, and it is what
 * lets the geometry hold a mark within twenty-four pixels of its subject.
 *
 * THEY DEPEND ON EACH OTHER, AND THE DEPENDENCE IS A CONTRACTION, NOT A LOOP. Tighter placement
 * shrinks the ink, which raises the zoom, which raises `glassScale`, which SHRINKS the reach in
 * units and so tightens placement further. `typeUnits`'s note warns against a floor read off the
 * live camera; this is not that. It is a fixed point over a stable surface at zoom 1, walked at
 * most three times and measured for real at each step, exactly as the type ladder is walked. Two
 * steps in, every one of the sixteen from-scratch boards has moved by under a percent.
 */
export const SCALE_SETTLE_STEPS = 3;

export function settleGlassScale(
  lay: (glassScale: number) => readonly Built[],
  frame: BoardFrame,
  autoCamera: boolean,
  fill: number = CAMERA_FILL,
): number {
  let scale = boardPxPerUnit(lay(0), frame, autoCamera, fill);
  for (let step = 0; step < SCALE_SETTLE_STEPS; step += 1) {
    const next = boardPxPerUnit(lay(scale), frame, autoCamera, fill);
    if (!(next > 0)) return scale;
    const moved = Math.abs(next - scale) / scale;
    scale = next;
    if (moved < 0.01) break;
  }
  return scale;
}

/**
 * THE FARTHEST ANY WRITTEN MARK SITS FROM THE THING IT NAMES, on the glass, in px.
 *
 * The other half of the craft law `smallestTypePx` measures, and measured the same way: computed
 * off the built geometry under the camera this board would be fitted with, never screenshotted.
 * Marks placed at a bare board coordinate name nothing and are not counted.
 */
export function worstMarkGapPx(
  built: readonly Built[],
  frame: BoardFrame,
  autoCamera: boolean,
  fill: number = CAMERA_FILL,
): number {
  const boxes = new Map<string, BoardRect>();
  const extent: BoardRect[] = [];
  for (const b of built) {
    if (!b.geometry) continue;
    boxes.set(b.state.object.id, b.geometry.box);
    extent.push(b.geometry.box);
  }
  const k1 = pxPerUnit({ ...frame, zoom: 1 });
  const zoom = autoCamera
    ? fitCamera(contentBounds(extent, 0), frame, { fill }).zoom
    : frame.zoom > 0
      ? frame.zoom
      : 1;
  const k = k1 * zoom;
  let worst = 0;
  for (const b of built) {
    const g = b.geometry;
    if (!g || tallestGlyphUnits(g) <= 0) continue;
    const anchor = b.state.object as { anchor?: { object?: string } };
    const id = anchor.anchor?.object;
    const subject = typeof id === 'string' ? boxes.get(id) : undefined;
    if (!subject) continue;
    const dx = Math.max(0, g.box.x - (subject.x + subject.w), subject.x - (g.box.x + g.box.w));
    const dy = Math.max(0, g.box.y - (subject.y + subject.h), subject.y - (g.box.y + g.box.h));
    worst = Math.max(worst, Math.hypot(dx, dy) * k);
  }
  return worst;
}

/**
 * THE BOARD'S TWO SCALARS, SETTLED AS ONE ANSWER AGAINST BOTH LAWS (the adversary, wave 57,
 * finding 2).
 *
 * `typeScale` is the factor that puts the smallest written glyph over twelve pixels; `glassScale`
 * is how many pixels a board unit measures once the camera has fitted the result, and it is what
 * lets `geometry.ts`'s solver hold a mark within twenty-four pixels of what it names.
 *
 * A LADDER JUDGED ON ONE LAW PICKS A RUNG THAT BREAKS THE OTHER, and that is exactly what wave 51
 * shipped. Measured on the timeline at 390 after the solver was in: the rung the type law alone
 * chooses reads 13.5 px and leaves a mark 44 px from its tick, while a neighbouring rung clears
 * both. The rungs are not monotone in either law — growing the type moves where every note can go
 * — so each one is laid for real and measured on BOTH, and the first that clears BOTH wins.
 *
 * Where no rung clears both, the one that comes closest is kept and the board is reported rather
 * than silently rendered: a board too dense for its surface is the pipeline's to answer for, and
 * the hand should not pretend otherwise.
 */
export interface Rung {
  typeScale: number;
  glassScale: number;
  /** The smallest written glyph on this rung, on the glass. */
  typePx: number;
  /** The farthest a written mark sits from what it names, on this rung, on the glass. */
  gapPx: number;
}

export function settleBoardScales(
  lay: (typeScale: number, glassScale: number) => readonly Built[],
  frame: BoardFrame,
  autoCamera: boolean,
  fill: number = CAMERA_FILL,
): Rung {
  const rung = (k: number): Rung => {
    const glassScale = settleGlassScale((g) => lay(k, g), frame, autoCamera, fill);
    const built = lay(k, glassScale);
    return {
      typeScale: k,
      glassScale,
      typePx: smallestTypePx(built, frame, autoCamera, fill),
      gapPx: worstMarkGapPx(built, frame, autoCamera, fill),
    };
  };
  /**
   * THE AIM, THE LAW, AND THE LEAST-BAD — in that order, and never a trade between the two laws.
   *
   * `aim` is both laws with the headroom the browser's own re-measure costs (`TYPE_FLOOR_PX`,
   * `REACH_AIM`); `lawful` is both laws exactly. A rung that clears the aim is taken at once. If
   * none does, the best LAWFUL rung is taken — the one with the most room to spare on the tighter
   * of the two. Only when no rung is lawful at all is anything scored, and then the type law leads
   * because an unreadable mark teaches nothing at any distance; a board that gets there is a board
   * too dense for its surface, which is the pipeline's answer to give, not the hand's.
   */
  const aim = (r: Rung) => r.typePx >= TYPE_FLOOR_PX && r.gapPx <= REACH_AIM;
  const lawful = (r: Rung) =>
    (Number.isFinite(r.typePx) ? r.typePx : Number.POSITIVE_INFINITY) >= MIN_TYPE_PX &&
    r.gapPx <= NOTE_REACH;
  const room = (r: Rung) =>
    Math.min(
      (Number.isFinite(r.typePx) ? r.typePx : 99) - MIN_TYPE_PX,
      NOTE_REACH - r.gapPx,
    );
  const miss = (r: Rung) =>
    Math.max(0, MIN_TYPE_PX - (Number.isFinite(r.typePx) ? r.typePx : MIN_TYPE_PX)) * 1000 +
    Math.max(0, r.gapPx - NOTE_REACH);

  const walked: Rung[] = [rung(1)];
  if (aim(walked[0] as Rung)) return walked[0] as Rung;
  for (const k of TYPE_LADDER) {
    const at = rung(k);
    if (aim(at)) return at;
    walked.push(at);
  }
  const legal = walked.filter(lawful);
  if (legal.length > 0)
    return legal.reduce((best, r) => (room(r) > room(best) ? r : best), legal[0] as Rung);
  return walked.reduce((best, r) => (miss(r) < miss(best) ? r : best), walked[0] as Rung);
}

/**
 * THE FILL THE TYPE NEEDS, INSIDE THE LAW'S OWN BAND.
 *
 * `CAMERA_FILL` is 0.78 with a band of 0.70 to 0.85 — the margin is a law, and so is the 12 px
 * floor. When the two pull against each other the margin is the one with give in it: a board whose
 * smallest word is a tenth short is better read a little closer to the edge than a little too
 * small. Never past 0.85, which is `fitCamera`'s own ceiling; a board that needs more than the
 * band can give does not get it here, it gets reported.
 */
export function typeFillFor(
  built: readonly Built[],
  frame: BoardFrame,
  autoCamera: boolean,
): number {
  if (!autoCamera) return CAMERA_FILL;
  const px = smallestTypePx(built, frame, autoCamera, CAMERA_FILL);
  if (!Number.isFinite(px) || px <= 0 || px >= TYPE_FLOOR_PX) return CAMERA_FILL;
  return Math.min(CAMERA_FILL_MAX, (CAMERA_FILL * TYPE_FLOOR_PX) / px);
}

/**
 * The ink role an object takes when the board did not name one. A grid is chrome, not argument —
 * it reads ink-3 so the curve on top of it is the thing the eye lands on (DESIGN.md).
 */
const CHROME_INK: Partial<Record<BoardObject['kind'], InkRole>> = { grid: 'faint' };

/** One object's element: written text where the font never came, a drawn path everywhere else. */
function inkNode(
  key: string,
  b: Built,
  style: BoardStyle | undefined,
  opacity: number,
  progress: number,
  reduced: boolean,
): React.ReactNode {
  const geometry = b.geometry as ObjectGeometry;
  const ink = style?.ink ?? CHROME_INK[b.state.object.kind] ?? 'wobo';
  if (geometry.glyphs.length === 0 && geometry.text) {
    return (
      <WrittenFallback
        key={key}
        id={key}
        text={geometry.text}
        ink={ink}
        opacity={opacity}
        progress={progress}
      />
    );
  }
  const dash = Array.isArray(style?.dash) ? style.dash : style?.dash ? [8, 6] : undefined;
  // The graphics tree, and not only the live region: a listener who walks the board with a screen
  // reader's own cursor meets each object where it is, and every one of them says what it is. The
  // words win where an object has its own; a shape describes itself. (No look-up here: a node in
  // the tree is read on its own, so it says what it IS rather than what it is about.)
  const ariaLabel = geometry.text ? geometry.text.lines.join(' ') : describe(b.state.object);
  const anchor = (b.state.object as { anchor?: { target?: unknown; object?: unknown } }).anchor;
  const anchored = anchor?.target;
  const on = anchor?.object;
  return (
    <BoardObjectNode
      key={key}
      id={key}
      {...(typeof anchored === 'string' && anchored ? { anchor: anchored } : {})}
      {...(typeof on === 'string' && on ? { on } : {})}
      geometry={geometry}
      ink={ink}
      weight={style?.weight ?? 1}
      {...(dash ? { dash } : {})}
      fill={style?.fill ?? 'none'}
      opacity={opacity}
      progress={progress}
      nibPx={NIB_PX}
      slots={b.slots}
      reduced={reduced}
      {...(ariaLabel ? { ariaLabel } : {})}
    />
  );
}

/**
 * Ink that has landed. Its props change identity every frame, so it compares only the signature of
 * what it holds — one string compare stands in for two thousand element comparisons.
 */
const SettledInk = memo(
  function SettledInk(props: { sig: number; nodes: React.ReactNode }) {
    return <g data-wobo-settled="">{props.nodes}</g>;
  },
  (a, b) => a.sig === b.sig,
);

// --- The surface ------------------------------------------------------------------------------------------

export interface BoardSurfaceProps {
  store: BoardStore;
  /** The registered surface targets — pass the scene bus's `getTargets` straight in. */
  targets?: () => readonly BoardTarget[];
  /**
   * Regions the learner has circled, for `{focus}` anchors. `rect` is a thunk wherever the region
   * can move under the page (which is every region on a scrolling screen): BOARD.md §3 says an
   * anchor is re-resolved on scroll and never floats, and a rect frozen at the moment of the
   * gesture floats. A plain rect is still accepted for a region that genuinely cannot move.
   */
  focusRegions?: () => readonly { id: string; rect: RectLike | (() => RectLike | null) }[];
  /** Fixed to the viewport (ink on the screen) rather than filling its parent (a board). */
  fixed?: boolean;
  /**
   * Show the board as it was at this board-clock instant instead of live — the scrubber's handle
   * (docs/BOARD.md §9). Every object's own timing is read against `at`, so ink that had not been
   * drawn yet is absent, ink mid-stroke is mid-stroke, and ink that had faded is gone. Undefined or
   * null is the live board.
   */
  at?: number | null;
  /** Follow the ink when it outgrows the view. */
  autoCamera?: boolean;
  camera?: Camera;
  /** Let the learner draw on this same layer. */
  capture?: boolean;
  onLearnerFocus?: (focus: LearnerFocus) => void;
  /** A bound control moved; the brain recomputes everything that depends on the variable. */
  onVariableChange?: (
    variable: string,
    value: number | boolean | string | [number, number],
  ) => void;
  className?: string;
  style?: CSSProperties;
  svgRef?: RefObject<SVGSVGElement | null>;
  /** Where Caveat lives. Overridable for the bench and for tests. */
  fontUrl?: string;
  /** Render budget override — the newest N objects are painted, the rest are virtualised out. */
  budget?: number;
  label?: string;
  /**
   * The page's own text lines near a subject, in viewport px (the glass map's lines), so a `note`
   * lands in the margin and never on the words it is about. Asked lazily, only when a note is
   * placed. Glass surfaces only.
   */
  avoid?: (near: RectLike) => readonly RectLike[];
}

const noTargets = (): readonly BoardTarget[] => [];
const noFocus = (): readonly { id: string; rect: RectLike | (() => RectLike | null) }[] => [];

/** Base nib width in CSS px. Non-scaling, so zoom never fattens the pen. */
/**
 * The nib, in screen px. DESIGN.md: ink is 3–4px and never under 2.5, on either theme — a board is
 * the boldest ink in the product, so it sits at the bottom of that range and the night theme reads
 * the same number rather than a heavier one of its own.
 */
const NIB_PX = 3;

/** How far one arrow press moves the keyboard's pen, in board units. */
const CARET_STEP_UNITS = 16;

/** The unit height a surface shows at zoom 1: 1000 wide by its aspect, or its own px on the glass. */
function boardHeightOf(frame: BoardFrame): number {
  return frame.width > 0 ? unitsHigh(frame) : BOARD_UNITS;
}

/**
 * What a screen reader is told when this object lands.
 *
 * It used to be the words off the object and nothing else, which left twenty-two of the grammar's
 * twenty-eight kinds silent: on a real board the triangle, the squares on its sides, the rule under
 * the total and the ring around the answer were all announced as nothing at all. `spoken.ts` has
 * the whole argument and every sentence; this is the seam the surface calls, and it hands the
 * store's own `get` through so a mark can name the thing it is about.
 */
export function spokenLabel(object: BoardObject, look?: LookUp): string {
  return describe(object, look);
}

/**
 * True while any page-anchored object's pen is mid-stroke at `now`: the one condition under which
 * the page is held still (`scroll-hold.ts`). Board-space ink never holds the page — the page
 * cannot move under it — and reduced motion lands every stroke at once, so it never holds either.
 */
export function strokesInFlight(
  built: readonly { state: { object: { id: string }; startAt: number }; durMs: number }[],
  pageAnchored: ReadonlySet<string>,
  now: number,
  reduced: boolean,
): boolean {
  if (reduced) return false;
  for (const b of built) {
    if (!pageAnchored.has(b.state.object.id)) continue;
    const progress = objectProgress(now, b.state.startAt, b.durMs, false);
    if (progress > 0 && progress < 1) return true;
  }
  return false;
}

export function BoardSurface(props: BoardSurfaceProps) {
  const {
    store,
    targets = noTargets,
    focusRegions = noFocus,
    fixed = false,
    autoCamera = false,
    capture = false,
    budget = RENDER_BUDGET,
  } = props;
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const ownSvgRef = useRef<SVGSVGElement>(null);
  const svgRef = props.svgRef ?? ownSvgRef;
  const cache = useRef(new Map<string, CacheEntry>());
  const ticked = useRef(new Set<string>());
  /** Settled ink's elements, kept between frames so a still board builds nothing at all. */
  const settledNodes = useRef(new Map<string, { sig: string; node: React.ReactNode }>());
  const settledSeen = useRef(0);
  const settledVersion = useRef(0);
  const [font, setFont] = useState<HandFont | null>(() => handFont());
  // The glass is measured in CSS px (one unit is one pixel); a board is 1000 units across itself.
  const [frame, setFrame] = useState<BoardFrame>(() =>
    frameOf({ x: 0, y: 0, width: 1000, height: 620 }, fixed ? { scale: 1 } : undefined),
  );
  /** When each gone mark's fade began, by key, so it fades once and comes back when its target does. */
  const goneSince = useRef(new Map<string, number>());
  const [paint, setPaint] = useState(0);
  const [drawing, setDrawing] = useState<{ points: BoardPoint[]; pressure: number[] } | null>(null);
  /** Where the keyboard's pen is, in board units. Null until the arrows are used. */
  const [caret, setCaret] = useState<BoardPoint | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());

  const liveObjects = useSyncExternalStore(
    store.subscribe,
    () => store.snapshot(),
    () => store.snapshot(),
  );
  // Scrubbing: the board is whatever the history says was on it at that instant, wiped ink and all.
  const scrubAt = props.at ?? null;
  const objects = useMemo(
    () => (scrubAt === null ? liveObjects : boardStatesAt(store, scrubAt)),
    [liveObjects, scrubAt, store],
  );

  /**
   * Everything Wobo writes on the board, announced (docs/BOARD.md §8 and DESIGN.md's accessibility
   * law). The svg carries a per-object `aria-label`, but `role="img"` is atomic to assistive
   * technology, so the whole board read as one image called "Wobo's board" and nothing announced new
   * ink at all. The container is a group now, and this is the region that speaks each new mark.
   */
  useEffect(() => {
    const fresh: string[] = [];
    for (const state of objects) {
      const key = `${state.object.id}#${state.generation}`;
      if (announced.current.has(key)) continue;
      announced.current.add(key);
      // `store.get` is handed in so a mark can say what it is about: "a line under c² = 25"
      // rather than "a line underneath", which is the difference between a fact and an explanation.
      const said = spokenLabel(state.object, (id) => store.get(id)?.object);
      if (said) fresh.push(said);
    }
    if (announced.current.size > RENDER_BUDGET * 2) announced.current.clear();
    if (fresh.length > 0) setAnnouncement(fresh.join('. '));
  }, [objects, store]);

  // Caveat, once. A failure is remembered, and every `write` falls back to a progressive reveal.
  useEffect(() => {
    let alive = true;
    void loadHandFont(props.fontUrl).then((f) => {
      if (alive && f) setFont(f);
    });
    return () => {
      alive = false;
    };
  }, [props.fontUrl]);

  // The frame: the surface's own rect. Re-measured on resize and on scroll, because a mark anchored
  // to something on the page must stay glued to it.
  const measure = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setFrame((prev) =>
      prev.left === r.left &&
      prev.top === r.top &&
      prev.width === r.width &&
      prev.height === r.height
        ? prev
        : { ...prev, left: r.left, top: r.top, width: r.width, height: r.height },
    );
  }, []);

  useEffect(() => {
    measure();
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  const camera = props.camera ?? RESTING_CAMERA;
  const liveFrame: BoardFrame = useMemo(
    () => ({ ...frame, zoom: camera.zoom, panX: camera.panX, panY: camera.panY }),
    [frame, camera.zoom, camera.panX, camera.panY],
  );

  // --- Resolve anchors and build geometry ------------------------------------------------------------
  // Virtualised: only the newest `budget` objects are ever in the DOM. The slice is memoised so the
  // frame loop below cannot bust the geometry cache just by re-rendering.
  const rendered = useMemo(
    () => (objects.length > budget ? objects.slice(objects.length - budget) : objects),
    [objects, budget],
  );

  // Lookups are held in refs: a caller passing an inline arrow must not rebuild every stroke.
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const focusRef = useRef(focusRegions);
  focusRef.current = focusRegions;
  const avoidRef = useRef(props.avoid);
  avoidRef.current = props.avoid;

  /**
   * The objects whose geometry can move without this surface moving: a mark hanging off the page
   * (a card scrolls inside a pane, a layout shifts), and anything anchored to one of those. Only
   * these are rebuilt per frame.
   *
   * BOARD.md §10 budgets 60 fps at 2,000 strokes. Re-anchoring, re-signing and re-elementing ALL of
   * them once a frame because one mark on the screen was among them cost 30 fps on a throttled
   * machine — and a mark on the screen is Wobo's commonest turn, so that was the ordinary case.
   */
  const liveIds = useMemo(() => liveObjectIds(rendered, store), [rendered, store]);
  const hasScreenAnchor = liveIds.size > 0;
  const screenTick = hasScreenAnchor ? paint : 0;

  const anchored = useMemo(
    () => rendered.filter((s) => !liveIds.has(s.object.id)),
    [rendered, liveIds],
  );
  const floating = useMemo(
    () => rendered.filter((s) => liveIds.has(s.object.id)),
    [rendered, liveIds],
  );

  /**
   * THE PILOT BUILDS, and the board's TWO scalars (`settleBoardScales`).
   *
   * Their only job is to measure the ink, so they are laid on the SURFACE at zoom 1 and never on
   * the gliding camera: that is what keeps the floor out of the loop `geometry.ts` warns about.
   * Each rung has its own cache, so the pilots and the real build never evict each other.
   *
   * TWO SCALARS, NOT ONE, AND SETTLED TOGETHER (the adversary, wave 57, finding 2). `typeScale` is
   * the factor that puts the smallest written glyph over twelve pixels; `glassScale` is how many
   * pixels a board unit measures once the camera has fitted the result, and it is what lets the
   * geometry's solver hold a mark within twenty-four pixels of what it names. Settling one and
   * then the other would measure rungs laid by a solver that did not yet know how far twenty-four
   * pixels is; `settleBoardScales` walks them as one answer.
   */
  const pilotFrame = useMemo(() => ({ ...frame, zoom: 1, panX: 0, panY: 0 }), [frame]);
  const fitFrame = autoCamera ? pilotFrame : liveFrame;
  const pilotCaches = useRef(new Map<string, Map<string, CacheEntry>>());
  const scales = useMemo(() => {
    const caches = pilotCaches.current;
    const lay = (typeScale: number, glassScale: number) => {
      const key = `${typeScale}|${glassScale.toFixed(4)}`;
      let cache = caches.get(key);
      if (!cache) {
        // One cache per (factor, scale) pair, and never more than the ladder can produce, so a
        // board that settles in two steps pays for two.
        if (caches.size > 24) caches.clear();
        cache = new Map<string, CacheEntry>();
        caches.set(key, cache);
      }
      return buildObjects(rendered, {
        frame: pilotFrame,
        font,
        store,
        cache,
        targets: targetsRef.current,
        focus: focusRef.current,
        boxes: new Map(),
        occupied: [],
        typeScale,
        ...(glassScale > 0 ? { glassScale } : {}),
      });
    };
    return settleBoardScales(lay, fitFrame, autoCamera, CAMERA_FILL_MAX);
  }, [rendered, pilotFrame, fitFrame, font, store, autoCamera]);
  const typeScale = scales.typeScale;
  const glassScale = scales.glassScale;

  /** The board- and object-anchored half: rebuilt only when the store, the frame or the font moves. */
  const settledBuild = useMemo(() => {
    const boxes = new Map<string, BoardRect>();
    const occupied: BoardRect[] = [];
    const objects = buildObjects(anchored, {
      frame: liveFrame,
      font,
      store,
      cache: cache.current,
      targets: targetsRef.current,
      focus: focusRef.current,
      boxes,
      occupied,
      typeScale,
      ...(glassScale > 0 ? { glassScale } : {}),
      ...(avoidRef.current ? { avoid: avoidRef.current } : {}),
    });
    return { objects, boxes, occupied };
    // `rendered` identity changes whenever the store emits, which is the correct trigger.
  }, [anchored, liveFrame, font, store, typeScale, glassScale]);

  /** The half that hangs off the page: rebuilt every frame, because the page moves under it. */
  const floatingBuilt = useMemo(() => {
    // `screenTick` is the dependency, not a value: it advances once a frame while a mark hangs off
    // the page, so those anchors are re-resolved as the page moves under them.
    void screenTick;
    if (floating.length === 0) return NO_BUILD;
    return buildObjects(floating, {
      frame: liveFrame,
      font,
      store,
      cache: cache.current,
      targets: targetsRef.current,
      focus: focusRef.current,
      // Seeded with the settled half's boxes so an object anchored across the two still resolves.
      boxes: new Map(settledBuild.boxes),
      occupied: [...settledBuild.occupied],
      typeScale,
      ...(glassScale > 0 ? { glassScale } : {}),
      ...(avoidRef.current ? { avoid: avoidRef.current } : {}),
    });
  }, [floating, liveFrame, font, store, settledBuild, screenTick, typeScale, glassScale]);

  /** The two halves back in drawing order — z-order is the store's order, not the build order. */
  const built = useMemo(() => {
    if (floatingBuilt.length === 0) return settledBuild.objects;
    if (settledBuild.objects.length === 0) return floatingBuilt;
    const byId = new Map<string, Built>();
    for (const b of settledBuild.objects) byId.set(b.state.object.id, b);
    for (const b of floatingBuilt) byId.set(b.state.object.id, b);
    const out: Built[] = [];
    for (const state of rendered) {
      const hit = byId.get(state.object.id);
      if (hit) out.push(hit);
    }
    return out;
  }, [rendered, settledBuild, floatingBuilt]);

  // --- Camera -----------------------------------------------------------------------------------------
  // Bounds are taken from the two halves separately: the settled half is a memo that survives a
  // frame, so a board of two thousand strokes is not re-measured sixty times a second.
  // THE FIT IS MEASURED AGAINST THE INK, UNPADDED (the adversary, wave 47, finding 4). The
  // settled half used to carry `contentBounds`'s 28-unit layout padding into the camera, so the
  // margin the fill already leaves was charged twice: at 1440 the Pythagoras ink filled 0.63 of
  // the limiting side against a law of 0.78 and landed as 147 x 178 px. Both halves are raw boxes
  // now, and `autoCameraTarget` is the one place the fit is composed.
  const settledBounds = useMemo(
    () =>
      autoCamera
        ? contentBounds(
            settledBuild.objects.flatMap((b) => (b.geometry ? [b.geometry.box] : [])),
            0,
          )
        : null,
    [autoCamera, settledBuild],
  );
  /** The margin the ink keeps — inside the law's band, and only as tight as the type needs. */
  const cameraFill = useMemo(
    () =>
      typeFillFor(
        floatingBuilt.length ? [...settledBuild.objects, ...floatingBuilt] : settledBuild.objects,
        pilotFrame,
        autoCamera,
      ),
    [settledBuild, floatingBuilt, pilotFrame, autoCamera],
  );
  const autoTarget = useMemo(() => {
    if (!autoCamera) return null;
    const boxes = floatingBuilt.flatMap((b) => (b.geometry ? [b.geometry.box] : []));
    return autoCameraTarget(settledBounds ? [...boxes, settledBounds] : boxes, [], frame, {
      fill: cameraFill,
    });
  }, [autoCamera, settledBounds, floatingBuilt, frame, cameraFill]);
  // The camera GLIDES to the fit rather than snapping to it: every new object changes the box the
  // ink has to fit into, and a hard cut on each stroke would read as the board flinching. Reduced
  // motion goes straight there, which is the same rule the ink itself follows.
  const shownCam = useRef<Camera | null>(null);
  /**
   * Whether the board has shown ink yet. The camera glides between fits, but the FIRST fit is a
   * cut: an empty board has nothing on it to glide from, and gliding from the resting camera put
   * the first stroke of a tall board below the fold for its first frames (the food-web golden at
   * 1280 by 720, caught by the first-stroke bench once it required the stroke on the glass).
   */
  const inkSeen = useRef(false);
  let cameraSettling = false;
  if (autoTarget) {
    const hasInk = built.some((b) => b.geometry !== null);
    const firstInk = hasInk && !inkSeen.current;
    if (hasInk) inkSeen.current = true;
    else inkSeen.current = false;
    const from = shownCam.current;
    const next = from && !reduced && !firstInk ? easeCamera(from, autoTarget) : autoTarget;
    cameraSettling = Boolean(from) && !cameraArrived(next, autoTarget);
    shownCam.current = next;
  } else if (shownCam.current) {
    shownCam.current = null;
  }
  const effective = shownCam.current ?? camera;
  const viewFrame: BoardFrame = { ...frame, ...effective };

  // --- The clock ----------------------------------------------------------------------------------------
  // One rAF loop, alive only while something is drawing or fading, or while any mark hangs off the
  // page (whose rect can move under us). It never re-renders settled ink: that layer is memoised.
  // The scrubber's handle IS the clock while it is held: progress, fades and ttl all read from it,
  // so the surface shows the board of that moment rather than the live one with old ink in it.
  const now = scrubAt ?? store.time();
  const animating =
    scrubAt === null &&
    built.some((b) => {
      if (b.state.fadingAt !== undefined && now < b.state.fadingAt + FADE_MS) return true;
      if (b.state.ttl !== undefined && now < b.state.startAt + b.durMs + b.state.ttl + FADE_MS) {
        return true;
      }
      return now < b.state.startAt + b.durMs;
    });

  useEffect(() => {
    if (!animating && !hasScreenAnchor && !cameraSettling) return;
    let raf = 0;
    const loop = () => {
      if (hasScreenAnchor) measure();
      setPaint((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animating, hasScreenAnchor, cameraSettling, measure]);

  // --- The scroll hold ----------------------------------------------------------------------------
  // The page stands still exactly while a page-anchored stroke is mid-flight, and not a frame
  // longer: the loop above re-renders every frame while anything is drawing, so the frame a stroke
  // lands is the frame the hold is released, and the registry re-anchors on the release.
  const holdToken = useId();
  const holding = scrubAt === null && strokesInFlight(built, liveIds, now, reduced);
  useEffect(() => {
    scrollHold.set(holdToken, holding);
  }, [holdToken, holding]);
  useEffect(() => () => scrollHold.release(holdToken), [holdToken]);
  useEffect(() => (hasScreenAnchor ? scrollHold.watch() : undefined), [hasScreenAnchor]);

  // --- Paint ------------------------------------------------------------------------------------------
  // Ink that has landed and is not fading goes into one memoised layer that React skips in a single
  // comparison. Two things make that hold at two thousand strokes:
  //
  //  · a settled object's element is built ONCE and kept, so a frame that changes nothing about it
  //    costs a map lookup and an array push rather than a fresh React element;
  //  · the layer's identity is a counter bumped only when the settled set actually changes, not a
  //    two-thousand-term string rebuilt every frame.
  const settled: React.ReactNode[] = [];
  const live: React.ReactNode[] = [];
  const nodes = settledNodes.current;
  let settledCount = 0;
  let settledChanged = false;
  const gone = goneSince.current;
  for (const b of built) {
    const { state, geometry, durMs, sig } = b;
    if (!geometry) continue;
    const style = store.styleOf(state);
    const progress = objectProgress(now, state.startAt, durMs, reduced);
    if (progress <= 0) continue;
    const age = now - (state.startAt + durMs);
    let opacity = (style?.opacity ?? 1) * fadeOpacity(age, state.ttl, FADE_MS);
    if (state.fadingAt !== undefined) {
      opacity *= Math.max(0, Math.min(1, 1 - (now - state.fadingAt) / FADE_MS));
    }
    const key = `${state.object.id}#${state.generation}`;
    // The thing it is about has left the glass: fade where it was, and come back if it does.
    if (b.gone) {
      const since = gone.get(key) ?? now;
      if (!gone.has(key)) gone.set(key, since);
      opacity *= Math.max(0, Math.min(1, 1 - (now - since) / FADE_MS));
    } else if (gone.has(key)) {
      gone.delete(key);
    }
    if (opacity <= 0) continue;
    if (!ticked.current.has(key)) {
      ticked.current.add(key);
      penTick(geometry.length > 60 ? 1 : 0.6);
    }
    const isSettled = progress >= 1 && opacity >= 1 && state.fadingAt === undefined && !b.gone;
    if (isSettled) {
      const held = nodes.get(key);
      if (held && held.sig === sig) {
        settled.push(held.node);
      } else {
        const node = inkNode(key, b, style, opacity, progress, reduced);
        nodes.set(key, { sig, node });
        settled.push(node);
        settledChanged = true;
      }
      settledCount += 1;
      continue;
    }
    live.push(inkNode(key, b, style, opacity, progress, reduced));
  }
  // Membership shrank (ink faded, was wiped, or scrolled out of the budget) — the layer changed too.
  if (settledCount !== settledSeen.current) {
    settledSeen.current = settledCount;
    settledChanged = true;
  }
  if (settledChanged) settledVersion.current += 1;
  // The cache is bounded by what can be on the board at all; beyond that it is history.
  if (nodes.size > budget * 2) {
    for (const key of nodes.keys()) {
      if (nodes.size <= budget) break;
      nodes.delete(key);
    }
  }

  // --- Learner ink ------------------------------------------------------------------------------------
  const strokeId = useRef(0);
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!capture) return;
    // Palm rejection: a broad contact from a resting hand is not a stroke.
    if (e.pointerType === 'touch' && (e.width > 40 || e.height > 40)) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrawing({
      points: [viewportToBoard(viewFrame, e.clientX, e.clientY)],
      pressure: [e.pressure > 0 ? e.pressure : 0.5],
    });
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    setDrawing((prev) =>
      prev
        ? {
            points: [...prev.points, viewportToBoard(viewFrame, e.clientX, e.clientY)],
            pressure: [...prev.pressure, e.pressure > 0 ? e.pressure : 0.5],
          }
        : prev,
    );
  };
  const finishStroke = () => {
    if (!drawing) return;
    const { points, pressure } = drawing;
    setDrawing(null);
    if (points.length < 2) return;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const box: BoardRect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    const id = `learner-${++strokeId.current}`;
    const k = pxPerUnit({ ...viewFrame, zoom: 1 });
    const rect: RectLike = {
      x: (box.x - viewFrame.panX) * k * viewFrame.zoom + viewFrame.left,
      y: (box.y - viewFrame.panY) * k * viewFrame.zoom + viewFrame.top,
      width: box.w * k * viewFrame.zoom,
      height: box.h * k * viewFrame.zoom,
    };
    const under = new Set<string>();
    for (const t of targets()) {
      const r = t.getRect();
      if (!r) continue;
      if (
        rect.x < r.x + r.width &&
        r.x < rect.x + rect.width &&
        rect.y < r.y + r.height &&
        r.y < rect.y + rect.height
      ) {
        under.add(t.id);
      }
    }
    const origin = points[0] as BoardPoint;
    store.ink({
      id,
      kind: 'polyline',
      anchor: { board: origin },
      style: { ink: 'learner', weight: 1 },
      t: { start: 0, dur: 1 },
      points: points.map((p) => [p[0] - origin[0], p[1] - origin[1]] as BoardPoint),
    });
    props.onLearnerFocus?.({
      id,
      kind: 'stroke',
      points,
      box,
      rect,
      targetIds: [...under],
      pressure: pressure.reduce((s, v) => s + v, 0) / pressure.length,
    });
  };

  /**
   * The keyboard's pen (docs/BOARD.md §8 — the board is bidirectional, and every interaction has a
   * keyboard path). The arrows move a caret in board units, space puts the pen down and lifts it,
   * Escape drops the stroke. Without it a keyboard-only learner could never draw on Wobo's own board
   * or circle anything on it — half the board, unreachable.
   */
  const onSurfaceKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!capture) return;
    const here = caret ?? ([unitsWide(viewFrame) / 2, boardHeightOf(viewFrame) / 2] as BoardPoint);
    const step = CARET_STEP_UNITS * (e.shiftKey ? 4 : 1);
    const moves: Record<string, BoardPoint> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[e.key];
    if (delta) {
      e.preventDefault();
      const to: BoardPoint = [here[0] + delta[0], here[1] + delta[1]];
      setCaret(to);
      setDrawing((prev) =>
        prev ? { points: [...prev.points, to], pressure: [...prev.pressure, 0.5] } : prev,
      );
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (drawing) finishStroke();
      else {
        setCaret(here);
        setDrawing({ points: [here], pressure: [0.5] });
      }
      return;
    }
    if (e.key === 'Escape' && drawing) {
      e.preventDefault();
      setDrawing(null);
    }
  };

  // --- Controls ----------------------------------------------------------------------------------------
  const controls = built.flatMap((b) =>
    b.geometry?.control ? [{ id: b.state.object.id, ...b.geometry.control }] : [],
  );
  /** A hit box in board units, as local px inside this surface. */
  const toLocal = (box: BoardRect) => {
    const k = pxPerUnit(viewFrame);
    return {
      left: (box.x - viewFrame.panX) * k,
      top: (box.y - viewFrame.panY) * k,
      width: box.w * k,
      height: box.h * k,
    };
  };
  /** Dragging a handle: its anchor is wherever it is now, less the value it is carrying. */
  const dragTo = (
    control: { knob?: BoardRect },
    value: [number, number],
    clientX: number,
    clientY: number,
  ): [number, number] => {
    if (!control.knob) return value;
    const originX = control.knob.x + control.knob.w / 2 - value[0];
    const originY = control.knob.y + control.knob.h / 2 - value[1];
    const [bx, by] = viewportToBoard(viewFrame, clientX, clientY);
    return [bx - originX, by - originY];
  };

  const height = viewFrame.height > 0 ? unitsHigh(viewFrame) : 620;
  const shownW = unitsWide(viewFrame) / (effective.zoom || 1);
  const shownH = height / (effective.zoom || 1);
  const learnerPath = drawing && drawing.points.length > 1 ? smoothPath(drawing.points) : null;

  return (
    <div
      ref={hostRef}
      className={`wobo-board${props.className ? ` ${props.className}` : ''}`}
      style={{
        position: fixed ? 'fixed' : 'absolute',
        inset: 0,
        pointerEvents: capture || controls.length > 0 ? 'auto' : 'none',
        ...props.style,
      }}
    >
      <style>{BOARD_CSS}</style>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${effective.panX} ${effective.panY} ${shownW} ${shownH}`}
        preserveAspectRatio="xMidYMid slice"
        // NOT `role="img"`. That role is atomic to assistive technology, so every per-object
        // `aria-label` the hand writes into this tree was invisible and the whole board read as one
        // picture called "Wobo's board". An svg with no role of its own maps to `graphics-document`,
        // which exposes what is inside it — which is everything Wobo wrote.
        data-wobo-surface=""
        aria-label={props.label ?? 'the board'}
        {...(capture
          ? {
              tabIndex: 0,
              'aria-description':
                'arrow keys move the pen, space puts it down and lifts it, escape drops the stroke',
            }
          : {})}
        style={{ opacity: 'var(--wobo-ink-opacity)' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onKeyDown={onSurfaceKeyDown}
      >
        <SettledInk sig={settledVersion.current} nodes={settled} />
        <g>{live}</g>
        {learnerPath ? (
          <path
            className="wobo-stroke"
            d={learnerPath}
            stroke={inkOf('learner')}
            strokeWidth={NIB_PX * 1.2}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {capture && caret ? (
          <g data-wobo-caret="">
            <circle
              cx={caret[0]}
              cy={caret[1]}
              r={6}
              fill="none"
              stroke={inkOf(drawing ? 'accent' : 'learner')}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>
      {/* Every mark Wobo makes, spoken. Nothing announced new ink before this, so a board was
          silent to a screen reader however much Wobo wrote on it. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        data-wobo-ink-log=""
        style={{
          clipPath: 'inset(50%)',
          height: 1,
          overflow: 'hidden',
          position: 'absolute',
          whiteSpace: 'nowrap',
          width: 1,
        }}
      >
        {announcement}
      </div>
      {controls.map((c) => {
        const state = store.get(c.id);
        if (!state) return null;
        const object = state.object;
        return (
          <ControlHit
            key={c.id}
            box={toLocal(c.hit)}
            state={state}
            variable={c.variable}
            onPoint={(x, y) => {
              if (object.kind !== 'drag') return;
              props.onVariableChange?.(object.variable, dragTo(c, object.value, x, y));
            }}
            onValue={(value) => props.onVariableChange?.(c.variable, value)}
          />
        );
      })}
    </div>
  );
}

/** The board's full area in board units, for callers that need to place something themselves. */
export function surfaceArea(frame: BoardFrame): BoardRect {
  return boardArea(frame);
}

/** The pen travel of a set of strokes — exported so the bench can assert pacing. */
export function inkLength(strokes: Stroke[]): number {
  return strokes.reduce((s, x) => s + x.length, 0);
}

export { polylineLength };
