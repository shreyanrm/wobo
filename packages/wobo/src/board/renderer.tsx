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
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  anchorSignature,
  type BoardFrame,
  type BoardRect,
  frameOf,
  isScreenAnchored,
  pxPerUnit,
  type RectLike,
  resolveAnchorBox,
  viewportToBoard,
} from './anchors';
import { geometryOf, type ObjectGeometry } from './geometry';
import { HAND_MASK_FACTOR, type HandFont, handFont, loadHandFont } from './handwriting';
import {
  blocksLayout,
  boardArea,
  type Camera,
  cameraArrived,
  contentBounds,
  easeCamera,
  fitCamera,
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

// --- Geometry cache ----------------------------------------------------------------------------------

interface CacheEntry {
  sig: string;
  generation: number;
  font: HandFont | null;
  geometry: ObjectGeometry | null;
  /** Draw time in ms, resolved once. */
  durMs: number;
  slots: { from: number; to: number }[];
}

function drawTimeOf(state: BoardObjectState, geometry: ObjectGeometry | null): number {
  if (state.durMs !== undefined) return state.durMs;
  return strokeDurationMs(geometry?.length ?? 0);
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
  const glyphStart = geometry.strokes.reduce((s, x) => s + x.length, 0);
  const totalLength = Math.max(geometry.length, 0.0001);
  let travelled = glyphStart;
  geometry.glyphs.forEach((glyph, gi) => {
    const glyphKey = `g${gi}`;
    const glyphLength = glyph.trace.reduce((s, t) => s + t.length, 0);
    const from = travelled / totalLength;
    const to = (travelled + glyphLength) / totalLength;
    travelled += glyphLength;
    const p = reduced ? (progress >= 1 ? 1 : 0) : within(progress, { from, to });
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
    const maskId = `wobo-pen-${props.id}-${glyphKey}`;
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
interface Built {
  state: BoardObjectState;
  geometry: ObjectGeometry | null;
  durMs: number;
  slots: { from: number; to: number }[];
  sig: string;
}

const NO_BUILD: Built[] = [];

interface BuildContext {
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
}

/**
 * Resolve a set of objects into geometry, reusing the cache wherever the anchor signature, the
 * generation and the font are all unchanged. Split out of the component so the board-anchored half
 * and the screen-anchored half can be built on different clocks (see `liveIds`).
 */
function buildObjects(states: readonly BoardObjectState[], build: BuildContext): Built[] {
  const { frame, font, store, cache, boxes, occupied } = build;
  const targetMap = new Map<string, BoardTarget>();
  for (const t of build.targets()) targetMap.set(t.id, t);
  const focusMap = new Map<string, RectLike | (() => RectLike | null)>();
  for (const f of build.focus()) focusMap.set(f.id, f.rect);
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
  };
  const out: Built[] = [];
  for (const state of states) {
    const anchor = store.anchorOf(state);
    const sigBox = anchor ? resolveAnchorBox(anchor, ctx) : null;
    const sig = `${anchorSignature(sigBox)}|${frame.zoom}`;
    const key = state.object.id;
    const hit = cache.get(key);
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
        durMs: drawTimeOf(state, geometry),
        slots: geometry ? strokeSlots(geometry) : [],
      };
      cache.set(key, entry);
    }
    if (entry.geometry) {
      boxes.set(key, entry.geometry.box);
      // Ground rather than ink: a plotted grid must not push the notes written over it out of the
      // plot (layout.blocksLayout). Every other kind takes its space.
      if (blocksLayout(String(state.object.kind))) occupied.push(entry.geometry.box);
    }
    out.push({
      state,
      geometry: entry.geometry,
      durMs: entry.durMs,
      slots: entry.slots,
      sig: entry.sig,
    });
  }
  return out;
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
  return (
    <BoardObjectNode
      key={key}
      id={key}
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

/** The board-unit height a surface shows, at its current camera. */
function boardHeightOf(frame: BoardFrame): number {
  return frame.width > 0 ? (frame.height / frame.width) * BOARD_UNITS : BOARD_UNITS;
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
  const [frame, setFrame] = useState<BoardFrame>(() =>
    frameOf({ x: 0, y: 0, width: 1000, height: 620 }),
  );
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

  /**
   * The objects whose geometry can move without this surface moving: a mark hanging off the page
   * (a card scrolls inside a pane, a layout shifts), and anything anchored to one of those. Only
   * these are rebuilt per frame.
   *
   * BOARD.md §10 budgets 60 fps at 2,000 strokes. Re-anchoring, re-signing and re-elementing ALL of
   * them once a frame because one mark on the screen was among them cost 30 fps on a throttled
   * machine — and a mark on the screen is Wobo's commonest turn, so that was the ordinary case.
   */
  const liveIds = useMemo(() => {
    const live = new Set<string>();
    for (const state of rendered) {
      const anchor = store.anchorOf(state);
      if (isScreenAnchored(anchor)) {
        live.add(state.object.id);
      } else if (anchor && 'object' in anchor && live.has(anchor.object)) {
        // It hangs off something that moves, so it moves.
        live.add(state.object.id);
      }
    }
    return live;
  }, [rendered, store]);
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
    });
    return { objects, boxes, occupied };
    // `rendered` identity changes whenever the store emits, which is the correct trigger.
  }, [anchored, liveFrame, font, store]);

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
    });
  }, [floating, liveFrame, font, store, settledBuild, screenTick]);

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
  const settledBounds = useMemo(
    () =>
      autoCamera
        ? contentBounds(settledBuild.objects.flatMap((b) => (b.geometry ? [b.geometry.box] : [])))
        : null,
    [autoCamera, settledBuild],
  );
  const autoTarget = useMemo(() => {
    if (!autoCamera) return null;
    const boxes = floatingBuilt.flatMap((b) => (b.geometry ? [b.geometry.box] : []));
    if (settledBounds) boxes.push(settledBounds);
    return fitCamera(contentBounds(boxes, 0), frame);
  }, [autoCamera, settledBounds, floatingBuilt, frame]);
  // The camera GLIDES to the fit rather than snapping to it: every new object changes the box the
  // ink has to fit into, and a hard cut on each stroke would read as the board flinching. Reduced
  // motion goes straight there, which is the same rule the ink itself follows.
  const shownCam = useRef<Camera | null>(null);
  let cameraSettling = false;
  if (autoTarget) {
    const from = shownCam.current;
    const next = from && !reduced ? easeCamera(from, autoTarget) : autoTarget;
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
    if (opacity <= 0) continue;
    const key = `${state.object.id}#${state.generation}`;
    if (!ticked.current.has(key)) {
      ticked.current.add(key);
      penTick(geometry.length > 60 ? 1 : 0.6);
    }
    const isSettled = progress >= 1 && opacity >= 1 && state.fadingAt === undefined;
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
    const k = viewFrame.width > 0 ? viewFrame.width / BOARD_UNITS : 1;
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
    const here = caret ?? ([BOARD_UNITS / 2, boardHeightOf(viewFrame) / 2] as BoardPoint);
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

  const height = viewFrame.height > 0 ? (viewFrame.height / viewFrame.width) * BOARD_UNITS : 620;
  const shownW = BOARD_UNITS / (effective.zoom || 1);
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
        aria-label={props.label ?? 'what Wobo is drawing'}
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
