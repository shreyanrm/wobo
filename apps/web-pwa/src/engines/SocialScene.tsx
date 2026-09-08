'use client';

/**
 * SocialScene — spec-driven social science (SUBJECTS.md §5-social). One renderer, three kinds:
 *
 *   • timeline     — dated events on a horizontal axis; the learner reads it, or drags a marker
 *     to place a named event at its year (within an authored tolerance).
 *   • eventOrder   — shuffled historical events the learner arranges into chronological order;
 *     the engine verifies against the authored order (Parsons, but for history). A wrong order
 *     is refused; the correct one locks and reveals the years.
 *   • supplyDemand — a supply line and a demand line on price×quantity axes; the learner drags
 *     a curve (a shift) and the engine COMPUTES the new equilibrium live. Economics here is
 *     exact line-intersection math, never a drawn approximation:
 *         q* = (a_d − a_s) / (b_s − b_d),   p* = a_s + b_s · q*
 *
 * All pure SVG / hand-rolled — no heavy deps. Lines are authored slope/intercept (numbers), so
 * nothing is evaluated; the gateway gate (plexus/social.py) mirrors parseSocialScene exactly.
 * Every kind registers a Wobo scene target: Wobo reads the live state (getSceneState) and can
 * drive it (applyTutorAction). Mute-aware sfx, both themes, reduced-motion aware.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { Reorder, useReducedMotion } from 'framer-motion';
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
import { sfx } from '../ui/sound';
import { formatSimNumber } from './SimRunner';

// --- The spec ------------------------------------------------------------------------------------

export interface SocialEvent {
  id: string;
  year: number;
  label: string;
}

export interface TimelinePlace {
  id: string;
  year: number;
  label: string;
  /** Accepted distance from the true year, in years. */
  tolerance: number;
}

export interface SDLine {
  label: string;
  /** p = intercept + slope·q */
  intercept: number;
  slope: number;
}

export interface SDShift {
  target: 'supply' | 'demand';
  /** Intercept offset range the learner can drag through (0 is the authored line). */
  min: number;
  max: number;
}

export type SocialKind = 'timeline' | 'eventOrder' | 'supplyDemand';

export interface SocialSceneSpec {
  id: string;
  kind: SocialKind;
  title: string;
  caption?: string;
  /** timeline + eventOrder */
  events?: SocialEvent[];
  /** timeline — the event to place (optional; absent → a read timeline) */
  place?: TimelinePlace;
  /** supplyDemand */
  supply?: SDLine;
  demand?: SDLine;
  shift?: SDShift;
  qMax?: number;
  pMax?: number;
  qUnit?: string;
  pUnit?: string;
}

// --- The computational core (exact — proved by the gateway self-check and the node proof) ----------

/** Intersection of p = s.intercept + s.slope·q and p = d.intercept + d.slope·q, or null if parallel. */
export function equilibrium(
  s: { intercept: number; slope: number },
  d: { intercept: number; slope: number },
): { q: number; p: number } | null {
  const denom = s.slope - d.slope;
  if (Math.abs(denom) < 1e-9) return null;
  const q = (d.intercept - s.intercept) / denom;
  const p = s.intercept + s.slope * q;
  return Number.isFinite(q) && Number.isFinite(p) ? { q, p } : null;
}

// --- Validation (mirrors plexus/social.py; a malformed scene returns null, never throws) -----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function parseEvent(raw: unknown): SocialEvent | null {
  if (!isRecord(raw)) return null;
  const { id, year, label } = raw;
  if (!str(id) || !str(label) || !num(year)) return null;
  return { id, year, label };
}

function parsePlace(raw: unknown): TimelinePlace | null {
  const ev = parseEvent(raw);
  if (!ev) return null;
  const t = isRecord(raw) && num(raw.tolerance) && raw.tolerance > 0 ? raw.tolerance : 3;
  return { ...ev, tolerance: t };
}

function parseLine(raw: unknown): SDLine | null {
  if (!isRecord(raw)) return null;
  const { label, intercept, slope } = raw;
  if (!str(label) || !num(intercept) || !num(slope)) return null;
  return { label, intercept, slope };
}

/** Validate a generated social scene. Mirrors the gateway gate; malformation → null. */
export function parseSocialScene(raw: unknown): SocialSceneSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (src.verified === false) return null;
  const kind = src.kind;
  if (kind !== 'timeline' && kind !== 'eventOrder' && kind !== 'supplyDemand') return null;
  const id = str(src.id) ? src.id : 'social';
  const title = str(src.title) ? src.title : 'social scene';
  const caption = str(src.caption) ? src.caption : undefined;

  if (kind === 'timeline' || kind === 'eventOrder') {
    const events = (Array.isArray(src.events) ? src.events : [])
      .map(parseEvent)
      .filter((e): e is SocialEvent => e !== null)
      .slice(0, 8);
    if (events.length < 2) return null;
    if (kind === 'eventOrder') {
      // ordering only makes sense over a total order — duplicate years are refused
      if (new Set(events.map((e) => e.year)).size !== events.length) return null;
      return { id, kind, title, caption, events };
    }
    // a malformed place drops silently; the timeline still teaches as a read
    const place = parsePlace(src.place) ?? undefined;
    return { id, kind, title, caption, events, place };
  }

  // supplyDemand — the intersection must be real and land in the visible positive quadrant
  const supply = parseLine(src.supply);
  const demand = parseLine(src.demand);
  if (!supply || !demand) return null;
  if (!(supply.slope > 0) || !(demand.slope < 0)) return null;
  const eq = equilibrium(supply, demand);
  if (!eq || eq.q <= 0 || eq.p <= 0) return null;
  const qMax = num(src.qMax) && src.qMax > 0 ? src.qMax : eq.q * 2;
  const pMax = num(src.pMax) && src.pMax > 0 ? src.pMax : eq.p * 2;
  if (eq.q >= qMax || eq.p >= pMax) return null;
  let shift: SDShift | undefined;
  if (isRecord(src.shift)) {
    const { target, min, max } = src.shift;
    if ((target !== 'supply' && target !== 'demand') || !num(min) || !num(max) || min >= max)
      return null;
    // every reachable shift must keep the equilibrium inside the visible quadrant
    for (const d of [min, max]) {
      const s2 = target === 'supply' ? { ...supply, intercept: supply.intercept + d } : supply;
      const d2 = target === 'demand' ? { ...demand, intercept: demand.intercept + d } : demand;
      const e2 = equilibrium(s2, d2);
      if (!e2 || e2.q <= 0 || e2.p <= 0 || e2.q >= qMax || e2.p >= pMax) return null;
    }
    shift = { target, min, max };
  }
  return {
    id,
    kind,
    title,
    caption,
    supply,
    demand,
    shift,
    qMax,
    pMax,
    qUnit: str(src.qUnit) ? src.qUnit : undefined,
    pUnit: str(src.pUnit) ? src.pUnit : undefined,
  };
}

// --- Shared bits ---------------------------------------------------------------------------------

const readoutBox: CSSProperties = {
  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
  borderRadius: 'var(--wobo-radius-md)',
  padding: '2px 20px',
  background: 'var(--wobo-paper)',
};

function Readouts({ items }: { items: { id: string; label: string; value: string }[] }) {
  return (
    <div style={readoutBox}>
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
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '4px 18px',
              padding: '10px 0',
            }}
          >
            <div style={{ fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>{o.label}</div>
            <div
              style={{
                fontSize: '1.15rem',
                fontWeight: 550,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--wobo-ink-900)',
              }}
            >
              {o.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function lineEquation(l: SDLine): string {
  const b = l.slope;
  const a = l.intercept;
  const slopePart = Math.abs(b) === 1 ? 'q' : `${formatSimNumber(Math.abs(b))}·q`;
  if (a === 0) return `p = ${b < 0 ? '−' : ''}${slopePart}`;
  return `p = ${formatSimNumber(a)} ${b < 0 ? '−' : '+'} ${slopePart}`;
}

// --- Timeline (axis + pins; optional place-the-event drag) ----------------------------------------

const TL_W = 320;
const TL_H = 150;
const TL_PAD = 26;
const TL_AXIS = 100;

function TimelineScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: SocialSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const bus = useWoboBus();
  const svgRef = useRef<SVGSVGElement>(null);
  const events = [...(spec.events ?? [])].sort((a, b) => a.year - b.year);
  const place = spec.place;

  const years = events.map((e) => e.year).concat(place ? [place.year] : []);
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const pad = Math.max(1, (hi - lo) * 0.12);
  const y0 = lo - pad;
  const y1 = hi + pad;
  const px = (year: number) => TL_PAD + ((year - y0) / (y1 - y0)) * (TL_W - 2 * TL_PAD);
  const toYear = (x: number) => Math.round(y0 + ((x - TL_PAD) / (TL_W - 2 * TL_PAD)) * (y1 - y0));

  const [dragYear, setDragYear] = useState(() => Math.round((y0 + y1) / 2));
  const [dragging, setDragging] = useState(false);
  const [solved, setSolved] = useState(false);
  const [missed, setMissed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const done = !place || solved;

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !done, onClick: onDone } });
  }, [done, setBar, onDone]);

  const tryYear = (year: number) => {
    if (!place || solved) return;
    if (Math.abs(year - place.year) <= place.tolerance) {
      setDragYear(place.year);
      setSolved(true);
      setMissed(false);
      sfx.bloom();
    } else {
      setMissed(true);
      sfx.wrong();
    }
  };

  const moveTo = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || solved) return;
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * TL_W;
    setDragYear(Math.max(Math.round(y0), Math.min(Math.round(y1), toYear(x))));
    setMissed(false);
  };

  const ref = useRegisterTarget<HTMLDivElement>(`social-${spec.id}`, {
    kind: 'controls',
    label: `the timeline for ${spec.title}`,
    getSceneState: () => ({
      events: events.map((e) => `${e.year} — ${e.label}`),
      ...(place
        ? {
            placing: place.label,
            markerAt: dragYear,
            trueYear: solved ? place.year : `hidden (±${place.tolerance} accepted)`,
            solved,
          }
        : {}),
    }),
    getValidActions: () =>
      place
        ? [
            `move the marker to a year between ${Math.round(y0)} and ${Math.round(y1)} (patch { year })`,
          ]
        : ['tap an event pin to focus it (patch { focus: "<event id>" })'],
    applyTutorAction: (patch: Record<string, unknown>) => {
      if (num(patch.year)) {
        setDragYear(Math.round(patch.year));
        tryYear(Math.round(patch.year));
      }
      if (str(patch.focus)) setPicked(patch.focus);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: events derive from spec
  useEffect(() => {
    bus.publishCanvas({
      nodeId: `social-${spec.id}`,
      steps: [
        ...events.map((e) => `${e.year} — ${e.label}`),
        ...(place ? [`place: ${place.label} → marker at ${dragYear}${solved ? ' ✓' : ''}`] : []),
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec.id, dragYear, solved]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>
          {place ? `drag the marker to the year — ${place.label}` : 'read the years left to right'}
        </div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <Stage hue={hue} tint={0.05} minHeight={210} style={{ padding: 'clamp(10px, 2vw, 20px)' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${TL_W} ${TL_H}`}
            width="100%"
            style={{ maxHeight: 260, touchAction: 'none' }}
            role="img"
            aria-label={`timeline from ${Math.round(y0)} to ${Math.round(y1)}`}
            onPointerMove={(e) => {
              if (dragging) moveTo(e.clientX);
            }}
            onPointerUp={() => {
              if (dragging) {
                setDragging(false);
                tryYear(dragYear);
              }
            }}
            onPointerLeave={() => setDragging(false)}
          >
            <title>timeline</title>
            <line
              x1={TL_PAD}
              y1={TL_AXIS}
              x2={TL_W - TL_PAD}
              y2={TL_AXIS}
              stroke="var(--wobo-ink-500)"
              strokeWidth={1}
            />
            {events.map((e, i) => {
              const x = px(e.year);
              const labelY = i % 2 === 0 ? 66 : 42;
              const focused = picked === e.id;
              return (
                <g
                  key={e.id}
                  onPointerDown={() => {
                    setPicked(e.id);
                    sfx.tap();
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <line
                    x1={x}
                    y1={labelY + 4}
                    x2={x}
                    y2={TL_AXIS}
                    stroke="var(--wobo-ink-300)"
                    strokeWidth={0.5}
                  />
                  <circle
                    cx={x}
                    cy={TL_AXIS}
                    r={focused ? 4.5 : 3.2}
                    fill={focused ? hue : 'var(--wobo-ink-700)'}
                  />
                  <text
                    x={x}
                    y={TL_AXIS + 14}
                    textAnchor="middle"
                    fontSize={8}
                    fill="var(--wobo-ink-500)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Math.round(e.year)}
                  </text>
                  <text
                    x={x}
                    y={labelY}
                    textAnchor="middle"
                    fontSize={7.5}
                    fill={focused ? 'var(--wobo-ink-900)' : 'var(--wobo-ink-700)'}
                  >
                    {e.label.length > 26 ? `${e.label.slice(0, 25)}…` : e.label}
                  </text>
                </g>
              );
            })}
            {place && (
              <g>
                <line
                  x1={px(dragYear)}
                  y1={TL_AXIS}
                  x2={px(dragYear)}
                  y2={TL_AXIS + 26}
                  stroke={hue}
                  strokeWidth={1}
                  strokeDasharray={solved ? undefined : '2 2'}
                />
                <circle
                  cx={px(dragYear)}
                  cy={TL_AXIS + 30}
                  r={7}
                  fill={solved ? hue : 'var(--wobo-paper)'}
                  stroke={hue}
                  strokeWidth={1.6}
                  style={{ cursor: solved ? 'default' : 'grab' }}
                  onPointerDown={(e) => {
                    if (solved) return;
                    (e.target as SVGCircleElement).setPointerCapture?.(e.pointerId);
                    setDragging(true);
                    sfx.tap();
                  }}
                />
                <text
                  x={px(dragYear)}
                  y={TL_AXIS + 46}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontWeight={600}
                  fill={solved ? hue : 'var(--wobo-ink-900)'}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {dragYear}
                </text>
              </g>
            )}
          </svg>
        </Stage>

        {place && !solved && (
          // keyboard path for the drag: nudge the marker year by year
          <div
            role="slider"
            aria-label={`year for ${place.label}`}
            aria-valuenow={dragYear}
            aria-valuemin={Math.round(y0)}
            aria-valuemax={Math.round(y1)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                setDragYear((v) => Math.max(Math.round(y0), v - 1));
              } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                setDragYear((v) => Math.min(Math.round(y1), v + 1));
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tryYear(dragYear);
              }
            }}
            style={{ ...lead, ...captionSurface, outlineOffset: 3 }}
          >
            {missed
              ? `not quite — ${dragYear} is too far off. slide again and release.`
              : `release the marker (or press enter) when it sits on the right year.`}
          </div>
        )}
        {place && solved && (
          <div
            style={{
              ...lead,
              ...captionSurface,
              transition: reduced ? undefined : 'opacity 300ms ease',
            }}
          >
            {`${place.label} — ${place.year}. it takes its place among the rest.`}
          </div>
        )}
      </div>
    </CardBody>
  );
}

// --- Event order (Parsons for history — drag into chronological order) ----------------------------

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

function shuffleIds(events: SocialEvent[], seed: string): string[] {
  const rng = seeded(seed);
  const a = events.map((e) => e.id);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as string, a[i] as string];
  }
  const correct = [...events].sort((x, y) => x.year - y.year).map((e) => e.id);
  // never hand the learner the solved arrangement
  if (a.join() === correct.join() && a.length > 1) {
    const first = a.shift();
    if (first !== undefined) a.push(first);
  }
  return a;
}

function EventOrderScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: SocialSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const events = spec.events ?? [];
  const byId = new Map(events.map((e) => [e.id, e]));
  const correct = [...events].sort((a, b) => a.year - b.year).map((e) => e.id);
  const [order, setOrder] = useState<string[]>(() => shuffleIds(events, spec.id));
  const [solved, setSolved] = useState(false);
  const [wrongAt, setWrongAt] = useState<Set<number> | null>(null);

  const check = () => {
    if (order.join() === correct.join()) {
      setSolved(true);
      setWrongAt(null);
      sfx.bloom();
    } else {
      setWrongAt(
        new Set(order.map((eid, i) => (eid === correct[i] ? -1 : i)).filter((i) => i >= 0)),
      );
      sfx.wrong();
    }
  };

  // the check button is the bar's primary until the order locks
  const orderKey = order.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: check reads order via closure; orderKey re-arms it
  useEffect(() => {
    setBar(
      solved
        ? { primary: { label: 'continue', onClick: onDone } }
        : { primary: { label: 'check order', onClick: check } },
    );
  }, [solved, orderKey, setBar, onDone]);

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= order.length || solved) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j] as string, next[i] as string];
      return next;
    });
    setWrongAt(null);
    sfx.tap();
  };

  const ref = useRegisterTarget<HTMLDivElement>(`social-${spec.id}`, {
    kind: 'controls',
    label: `the event-ordering puzzle for ${spec.title}`,
    getSceneState: () => ({
      arrangement: order.map((eid) => byId.get(eid)?.label ?? eid),
      solved,
      ...(solved ? {} : { hint: 'years are hidden until the order is right' }),
    }),
    getValidActions: () => [
      'rearrange events into chronological order (patch { order: ["<event id>", ...] })',
    ],
    applyTutorAction: (patch: Record<string, unknown>) => {
      const o = patch.order;
      if (Array.isArray(o) && o.length === order.length && o.every((v) => byId.has(String(v)))) {
        setOrder(o.map(String));
        setWrongAt(null);
      }
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: byId derives from spec
  useEffect(() => {
    bus.publishCanvas({
      nodeId: `social-${spec.id}`,
      steps: order.map(
        (eid, i) =>
          `${i + 1}. ${byId.get(eid)?.label ?? eid}${solved ? ` (${byId.get(eid)?.year})` : ''}`,
      ),
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec.id, orderKey, solved]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>drag the events into the order they happened</div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <Reorder.Group
          axis="y"
          values={order}
          onReorder={(next: string[]) => {
            if (solved) return;
            setOrder(next);
            setWrongAt(null);
          }}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {order.map((eid, i) => {
            const ev = byId.get(eid);
            if (!ev) return null;
            const wrong = wrongAt?.has(i) ?? false;
            return (
              <Reorder.Item
                key={eid}
                value={eid}
                dragListener={!solved}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 'var(--wobo-radius-md)',
                  border: solved
                    ? `1px solid ${hue}`
                    : `0.5px ${wrong ? 'dashed' : 'solid'} var(--wobo-hairline-on-paper-strong)`,
                  background: 'var(--wobo-paper)',
                  cursor: solved ? 'default' : 'grab',
                  touchAction: 'none',
                }}
              >
                <span
                  style={{
                    minWidth: 20,
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                    color: solved ? hue : 'var(--wobo-ink-500)',
                    fontSize: '0.9rem',
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontSize: '0.95rem', color: 'var(--wobo-ink-900)' }}>
                  {ev.label}
                </span>
                {solved ? (
                  <span
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 550,
                      color: hue,
                      fontSize: '0.9rem',
                    }}
                  >
                    {Math.round(ev.year)}
                  </span>
                ) : (
                  <span style={{ display: 'flex', gap: 2 }}>
                    <button
                      type="button"
                      aria-label={`move ${ev.label} earlier`}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      style={arrowBtn}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`move ${ev.label} later`}
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      style={arrowBtn}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>

        {wrongAt && (
          <div style={{ ...lead, ...captionSurface }}>
            not in order yet — the dashed ones sit in the wrong spot.
          </div>
        )}
        {solved && (
          <div style={{ ...lead, ...captionSurface }}>
            that is the true sequence — the years appear to prove it.
          </div>
        )}
      </div>
    </CardBody>
  );
}

const arrowBtn: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
  background: 'var(--wobo-paper)',
  color: 'var(--wobo-ink-700)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  lineHeight: 1,
};

// --- Supply & demand (drag a curve; the equilibrium is exact line intersection) --------------------

const SD_W = 260;
const SD_H = 200;
const SD_L = 34; // left pad (price labels)
const SD_B = 24; // bottom pad (quantity labels)
const SD_T = 12;
const SD_R = 12;

/** The visible piece of p = a + b·q inside [0,qMax]×[0,pMax], as [q0,p0,q1,p1] (null → off-chart). */
function clipLine(
  a: number,
  b: number,
  qMax: number,
  pMax: number,
): [number, number, number, number] | null {
  let q0 = 0;
  let q1 = qMax;
  if (Math.abs(b) > 1e-9) {
    const qa = (0 - a) / b;
    const qb = (pMax - a) / b;
    q0 = Math.max(q0, Math.min(qa, qb));
    q1 = Math.min(q1, Math.max(qa, qb));
  } else if (a < 0 || a > pMax) {
    return null;
  }
  if (q0 >= q1) return null;
  return [q0, a + b * q0, q1, a + b * q1];
}

function SupplyDemandScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: SocialSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const bus = useWoboBus();
  const svgRef = useRef<SVGSVGElement>(null);
  // parseSocialScene guarantees these for kind 'supplyDemand'
  const supply = spec.supply ?? { label: 'supply', intercept: 0, slope: 1 };
  const demand = spec.demand ?? { label: 'demand', intercept: 10, slope: -1 };
  const shift = spec.shift;
  const qMax = spec.qMax ?? 10;
  const pMax = spec.pMax ?? 10;

  const [offset, setOffset] = useState(0);
  const [touched, setTouched] = useState(!shift);
  const drag = useRef<{ p: number; offset: number } | null>(null);

  const sNow =
    shift?.target === 'supply' ? { ...supply, intercept: supply.intercept + offset } : supply;
  const dNow =
    shift?.target === 'demand' ? { ...demand, intercept: demand.intercept + offset } : demand;
  const eq0 = equilibrium(supply, demand);
  const eq = equilibrium(sNow, dNow);

  const px = (q: number) => SD_L + (q / qMax) * (SD_W - SD_L - SD_R);
  const py = (p: number) => SD_H - SD_B - (p / pMax) * (SD_H - SD_T - SD_B);
  const toP = (clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const y = ((clientY - r.top) / r.height) * SD_H;
    return ((SD_H - SD_B - y) / (SD_H - SD_T - SD_B)) * pMax;
  };

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !touched, onClick: onDone } });
  }, [touched, setBar, onDone]);

  const applyShift = (v: number) => {
    if (!shift) return;
    // half-step snaps keep the numbers crisp while the drag stays smooth
    const snapped = Math.round(Math.max(shift.min, Math.min(shift.max, v)) * 2) / 2;
    setOffset(snapped);
    setTouched(true);
  };

  const ref = useRegisterTarget<HTMLDivElement>(`social-${spec.id}`, {
    kind: 'controls',
    label: `the supply and demand market for ${spec.title}`,
    getSceneState: () => ({
      supply: lineEquation(sNow),
      demand: lineEquation(dNow),
      ...(shift ? { shiftedCurve: shift.target, shiftOffset: offset } : {}),
      equilibrium: eq
        ? `q* = ${formatSimNumber(eq.q)}${spec.qUnit ? ` ${spec.qUnit}` : ''}, p* = ${formatSimNumber(eq.p)}${spec.pUnit ? ` ${spec.pUnit}` : ''}`
        : 'none in view',
    }),
    getValidActions: () =>
      shift
        ? [
            `shift the ${shift.target} curve between ${shift.min} and ${shift.max} (patch { shift })`,
          ]
        : ['read the equilibrium at the intersection'],
    applyTutorAction: (patch: Record<string, unknown>) => {
      if (num(patch.shift)) applyShift(patch.shift);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: lines derive from spec + offset
  useEffect(() => {
    const steps = [`${sNow.label}: ${lineEquation(sNow)}`, `${dNow.label}: ${lineEquation(dNow)}`];
    if (eq) {
      steps.push(
        `q* = (${formatSimNumber(dNow.intercept)} − ${formatSimNumber(sNow.intercept)}) / (${formatSimNumber(sNow.slope)} − (${formatSimNumber(dNow.slope)})) = ${formatSimNumber(eq.q)}`,
        `p* = ${formatSimNumber(sNow.intercept)} + ${formatSimNumber(sNow.slope)}·${formatSimNumber(eq.q)} = ${formatSimNumber(eq.p)}`,
      );
    }
    bus.publishCanvas({
      nodeId: `social-${spec.id}`,
      equation: 'p_supply = p_demand at equilibrium',
      steps,
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec.id, offset]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const sSeg = clipLine(sNow.intercept, sNow.slope, qMax, pMax);
  const dSeg = clipLine(dNow.intercept, dNow.slope, qMax, pMax);
  const shiftedBase = shift?.target === 'supply' ? supply : demand;
  const ghost =
    shift && offset !== 0 ? clipLine(shiftedBase.intercept, shiftedBase.slope, qMax, pMax) : null;
  const shiftedSeg = shift?.target === 'supply' ? sSeg : dSeg;
  const handle = shiftedSeg
    ? {
        q: (shiftedSeg[0] + shiftedSeg[2]) / 2,
        p:
          (shift?.target === 'supply' ? sNow : dNow).intercept +
          (shift?.target === 'supply' ? sNow : dNow).slope * ((shiftedSeg[0] + shiftedSeg[2]) / 2),
      }
    : null;

  const seg = (
    s: [number, number, number, number],
    stroke: string,
    width: number,
    dash?: string,
  ) => (
    <line
      x1={px(s[0])}
      y1={py(s[1])}
      x2={px(s[2])}
      y2={py(s[3])}
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap="round"
    />
  );

  return (
    <CardBody maxWidth={640}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>
          {shift
            ? `drag the ${shift.target} curve — the market finds a new balance`
            : 'the intersection is the market price'}
        </div>
        <div style={cardTitle}>{spec.title}</div>
        <div style={{ ...equationType, textAlign: 'center' }}>
          {lineEquation(supply)} · {lineEquation(demand)}
        </div>
        {spec.caption && <div style={lead}>{spec.caption}</div>}

        <Stage hue={hue} tint={0.05} minHeight={260} style={{ padding: 'clamp(10px, 2vw, 20px)' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SD_W} ${SD_H}`}
            width="100%"
            style={{ maxHeight: 300, touchAction: 'none' }}
            role="img"
            aria-label={
              eq
                ? `market equilibrium at quantity ${formatSimNumber(eq.q)}, price ${formatSimNumber(eq.p)}`
                : 'supply and demand chart'
            }
            onPointerMove={(e) => {
              const d0 = drag.current;
              if (!d0) return;
              const p = toP(e.clientY);
              if (p !== null) applyShift(d0.offset + (p - d0.p));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerLeave={() => {
              drag.current = null;
            }}
          >
            <title>supply and demand</title>
            {/* axes */}
            <line
              x1={SD_L}
              y1={SD_T}
              x2={SD_L}
              y2={SD_H - SD_B}
              stroke="var(--wobo-ink-500)"
              strokeWidth={0.8}
            />
            <line
              x1={SD_L}
              y1={SD_H - SD_B}
              x2={SD_W - SD_R}
              y2={SD_H - SD_B}
              stroke="var(--wobo-ink-500)"
              strokeWidth={0.8}
            />
            <text
              x={SD_L - 6}
              y={SD_T + 4}
              textAnchor="end"
              fontSize={7.5}
              fill="var(--wobo-ink-500)"
            >
              {spec.pUnit ? `p (${spec.pUnit})` : 'price'}
            </text>
            <text
              x={SD_W - SD_R}
              y={SD_H - SD_B + 14}
              textAnchor="end"
              fontSize={7.5}
              fill="var(--wobo-ink-500)"
            >
              {spec.qUnit ? `q (${spec.qUnit})` : 'quantity'}
            </text>

            {/* the untouched original as a ghost, so the shift is visible as a move */}
            {ghost && seg(ghost, 'var(--wobo-ink-300)', 0.8, '3 3')}
            {sSeg &&
              seg(
                sSeg,
                shift?.target === 'supply' ? hue : 'var(--wobo-ink-700)',
                shift?.target === 'supply' ? 2 : 1.6,
              )}
            {dSeg &&
              seg(
                dSeg,
                shift?.target === 'demand' ? hue : 'var(--wobo-ink-700)',
                shift?.target === 'demand' ? 2 : 1.6,
              )}
            {sSeg && (
              <text
                x={px(sSeg[2]) - 2}
                y={py(sSeg[3]) - 5}
                textAnchor="end"
                fontSize={7.5}
                fill="var(--wobo-ink-700)"
              >
                {supply.label}
              </text>
            )}
            {dSeg && (
              <text
                x={px(dSeg[2]) - 2}
                y={py(dSeg[3]) + 10}
                textAnchor="end"
                fontSize={7.5}
                fill="var(--wobo-ink-700)"
              >
                {demand.label}
              </text>
            )}

            {/* the computed equilibrium — dashed guides to both axes, exact values at the ticks */}
            {eq && eq.q > 0 && eq.q < qMax && eq.p > 0 && eq.p < pMax && (
              <g style={{ transition: reduced ? undefined : 'opacity 200ms ease' }}>
                <line
                  x1={SD_L}
                  y1={py(eq.p)}
                  x2={px(eq.q)}
                  y2={py(eq.p)}
                  stroke="var(--wobo-ink-400)"
                  strokeWidth={0.6}
                  strokeDasharray="2 2"
                />
                <line
                  x1={px(eq.q)}
                  y1={py(eq.p)}
                  x2={px(eq.q)}
                  y2={SD_H - SD_B}
                  stroke="var(--wobo-ink-400)"
                  strokeWidth={0.6}
                  strokeDasharray="2 2"
                />
                <circle cx={px(eq.q)} cy={py(eq.p)} r={4} fill={hue} />
                <text
                  x={SD_L - 4}
                  y={py(eq.p) + 3}
                  textAnchor="end"
                  fontSize={8}
                  fontWeight={600}
                  fill="var(--wobo-ink-900)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatSimNumber(eq.p)}
                </text>
                <text
                  x={px(eq.q)}
                  y={SD_H - SD_B + 14}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={600}
                  fill="var(--wobo-ink-900)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatSimNumber(eq.q)}
                </text>
              </g>
            )}

            {/* the drag handle on the shiftable curve */}
            {shift && handle && (
              <circle
                cx={px(handle.q)}
                cy={py(handle.p)}
                r={7}
                fill="var(--wobo-paper)"
                stroke={hue}
                strokeWidth={1.6}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  (e.target as SVGCircleElement).setPointerCapture?.(e.pointerId);
                  const p = toP(e.clientY);
                  if (p !== null) drag.current = { p, offset };
                  sfx.tap();
                }}
              />
            )}
          </svg>
        </Stage>

        {shift && (
          // keyboard path for the shift drag
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ minWidth: 92, fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>
              {`shift ${shift.target}`}
            </div>
            <input
              type="range"
              min={shift.min}
              max={shift.max}
              step={0.5}
              value={offset}
              onChange={(e) => applyShift(Number(e.target.value))}
              aria-label={`shift the ${shift.target} curve`}
              style={{ flex: 1, accentColor: hue, cursor: 'pointer' }}
            />
            <div
              style={{
                minWidth: 54,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 550,
                color: 'var(--wobo-ink-900)',
              }}
            >
              {offset > 0 ? `+${formatSimNumber(offset)}` : formatSimNumber(offset)}
            </div>
          </div>
        )}

        {eq && (
          <Readouts
            items={[
              {
                id: 'p',
                label: 'equilibrium price',
                value: `${formatSimNumber(eq.p)}${spec.pUnit ? ` ${spec.pUnit}` : ''}`,
              },
              {
                id: 'q',
                label: 'equilibrium quantity',
                value: `${formatSimNumber(eq.q)}${spec.qUnit ? ` ${spec.qUnit}` : ''}`,
              },
            ]}
          />
        )}

        {eq && eq0 && offset !== 0 && (
          <div style={{ ...lead, ...captionSurface }}>
            {`the ${shift?.target ?? ''} shift moves the market: price ${
              eq.p > eq0.p ? 'rises' : eq.p < eq0.p ? 'falls' : 'holds'
            } to ${formatSimNumber(eq.p)}, quantity ${
              eq.q > eq0.q ? 'rises' : eq.q < eq0.q ? 'falls' : 'holds'
            } to ${formatSimNumber(eq.q)}.`}
          </div>
        )}
      </div>
    </CardBody>
  );
}

// --- The switch ----------------------------------------------------------------------------------

export function SocialScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: SocialSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  if (spec.kind === 'timeline')
    return <TimelineScene spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
  if (spec.kind === 'eventOrder')
    return <EventOrderScene spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
  return <SupplyDemandScene spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
}

// --- Hand-authored demos (one per kind; drop into EnginesGallery) ----------------------------------

export const SOCIAL_TIMELINE_DEMO: SocialSceneSpec = {
  id: 'demo-timeline',
  kind: 'timeline',
  title: 'the road to independence',
  caption: 'four marked moments — now place the salt march where it belongs.',
  events: [
    { id: 'inc', year: 1885, label: 'Indian National Congress founded' },
    { id: 'jb', year: 1919, label: 'Jallianwala Bagh massacre' },
    { id: 'qi', year: 1942, label: 'Quit India movement' },
    { id: 'ind', year: 1947, label: 'independence' },
  ],
  place: { id: 'dandi', year: 1930, label: 'the salt march reaches Dandi', tolerance: 3 },
};

export const SOCIAL_EVENTORDER_DEMO: SocialSceneSpec = {
  id: 'demo-eventorder',
  kind: 'eventOrder',
  title: 'which came first?',
  caption: 'the years are hidden until the order is right.',
  events: [
    { id: 'revolt', year: 1857, label: 'the revolt against Company rule' },
    { id: 'inc', year: 1885, label: 'Indian National Congress founded' },
    { id: 'partition', year: 1905, label: 'partition of Bengal announced' },
    { id: 'salt', year: 1930, label: 'the salt march to Dandi' },
    { id: 'ind', year: 1947, label: 'independence at midnight' },
  ],
};

/** The flagship: supply p = q and demand p = 10 − q meet at (5, 5); dragging demand up to
 *  p = 14 − q moves the equilibrium to (7, 7) — computed, not drawn. */
export const SOCIAL_SUPPLYDEMAND_DEMO: SocialSceneSpec = {
  id: 'demo-supplydemand',
  kind: 'supplyDemand',
  title: 'the market finds its price',
  caption: 'a festival raises demand for mangoes — watch where the new price settles.',
  supply: { label: 'supply', intercept: 0, slope: 1 },
  demand: { label: 'demand', intercept: 10, slope: -1 },
  shift: { target: 'demand', min: -2, max: 4 },
  qMax: 12,
  pMax: 14,
  qUnit: 'crates',
  pUnit: '₹',
};

export const SOCIAL_DEMOS: SocialSceneSpec[] = [
  SOCIAL_TIMELINE_DEMO,
  SOCIAL_EVENTORDER_DEMO,
  SOCIAL_SUPPLYDEMAND_DEMO,
];
