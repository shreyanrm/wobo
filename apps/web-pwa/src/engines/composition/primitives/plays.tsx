'use client';

/**
 * The nine acts of the vocabulary, one file, one contract.
 *
 * A play takes its primitive (the generated `@wobo/contracts/plexus` shape, already through the
 * door in `../parse.ts`), reports a right move, a wrong move and completion, and owns nothing else.
 * The beat, the clock, the score, the teaching line, the reveal, the branch and the advance all
 * belong to the composer above it. A new primitive is a new case here and nothing else changes,
 * which is what makes "one composer renders ANY valid composition" true rather than aspirational.
 *
 * Three rules every one of them keeps:
 *  1. **A finger can do it.** Every control is at least `MIN_HIT_PX` tall, taken from the spec's own
 *     hit box and floored at 44 css px, so a box the schema let through small still lands big.
 *  2. **A wrong move teaches.** Nothing here prints a word. It names the piece that moved and the
 *     composer reads that piece's own reason (`teachFor`).
 *  3. **A keyboard reaches everything.** Every token, zone and option is a real `<button>`; a stage
 *     target is a `<circle role="button" tabindex=0>`; the drag has an arrow-key path.
 *
 * On layout: the spec places its boxes on a 100 by 62 stage. At 390 css px that stage is 3.4 px to
 * the unit, so a placed label would be eleven-pixel type inside a hairline box. The boxes are
 * therefore honoured as SIZE (the half the finger cares about, floored at the law) and as READING
 * ORDER (top to bottom, then left to right), and the controls are flowed. It is the same reading the
 * contract already takes for `match`, whose comment says the client lays the columns out.
 */

import type { HitBox, Mark } from '@wobo/contracts/plexus';
import { motion, useReducedMotion } from 'framer-motion';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { hitCentre, MIN_HIT_PX, type Primitive, STAGE_H, STAGE_W } from '../parse';

// --- the contract every play answers to --------------------------------------------------------------

export interface PlayProps {
  primitive: Primitive;
  /** The stage's marks. They belong to the design, not the beat, so every play shares one drawing. */
  marks: Mark[];
  /** The concept's pigment. One accent per view (DESIGN.md §0). */
  hue: string;
  /** Css pixels per stage unit, measured live. Turns a spec's hit box into a real hit area. */
  unitPx: number;
  /** True once the beat is revealed: the play becomes a picture of what happened. */
  frozen: boolean;
  onRight: (pieceId?: string) => void;
  onWrong: (pieceId?: string) => void;
  onDone: (pieceId?: string) => void;
}

// --- helpers ------------------------------------------------------------------------------------------

/** The same shuffle on every render and every machine: `Math.random` would move a tray under a finger. */
function shuffled<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 48271) + 11) >>> 0;
    const j = h % (i + 1);
    const carried = out[i] as T;
    out[i] = out[j] as T;
    out[j] = carried;
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Top to bottom, then left to right: the designer's placement, kept as reading order. */
const byPlace = <T extends { box: HitBox }>(a: T, b: T) => a.box.y - b.box.y || a.box.x - b.box.x;

/** A spec's hit box, as the css size of a real control, never under the law. */
function sizeOf(box: HitBox, unitPx: number) {
  return {
    minHeight: Math.max(MIN_HIT_PX, box.h * unitPx),
    minWidth: Math.max(MIN_HIT_PX, Math.min(box.w * unitPx, 320)),
  };
}

function toneColor(tone: Mark['tone'], hue: string): string {
  return tone === 'hue' ? hue : tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)';
}

function MarkShape({ mark, hue }: { mark: Mark; hue: string }) {
  const color = toneColor(mark.tone, hue);
  const filled = mark.fill === 'solid';
  const soft = mark.fill === 'soft';
  const common = {
    fill: filled || soft ? color : 'none',
    fillOpacity: filled ? 0.9 : soft ? 0.14 : 0,
    stroke: color,
    strokeWidth: 0.7,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  switch (mark.shape) {
    case 'circle':
      return <circle cx={mark.x} cy={mark.y} r={mark.r ?? 5} {...common} />;
    case 'ring':
      return (
        <circle cx={mark.x} cy={mark.y} r={mark.r ?? 5} {...common} fill="none" fillOpacity={0} />
      );
    case 'rect':
      return (
        <rect
          x={mark.x}
          y={mark.y}
          width={mark.w ?? 10}
          height={mark.h ?? 10}
          rx={1.5}
          {...common}
        />
      );
    case 'line':
      return (
        <line
          x1={mark.x}
          y1={mark.y}
          x2={mark.x2 ?? mark.x}
          y2={mark.y2 ?? mark.y}
          stroke={color}
          strokeWidth={0.7}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'text':
      return (
        <text
          x={mark.x}
          y={mark.y}
          textAnchor="middle"
          fontSize={3.6}
          fill={color}
          style={{ fontFamily: 'inherit' }}
        >
          {mark.text ?? ''}
        </text>
      );
  }
}

function Stage({
  marks,
  hue,
  label,
  children,
  svgRef,
}: {
  marks: Mark[];
  hue: string;
  label: string;
  children?: React.ReactNode;
  svgRef?: React.Ref<SVGSVGElement>;
}) {
  return (
    <svg
      ref={svgRef}
      className="cx-stage"
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      {marks.map((m) => (
        <MarkShape key={m.id} mark={m} hue={hue} />
      ))}
      {children}
    </svg>
  );
}

/** Dots, not "3 of 6 done": a count of what is left is a caption for an absence (DESIGN.md §0.x). */
export function Pips({ at, of }: { at: number; of: number }) {
  if (of < 2) return null;
  return (
    <span className="cx-pips" data-cx="pips" aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a pip is a position, not content
        <i key={i} className={i < at ? 'cx-on' : ''} />
      ))}
    </span>
  );
}

// --- drop: bins with rules (§2 classification) ----------------------------------------------------------

/**
 * Pick a token up, then put it in a zone. Pick-then-place rather than a pointer drag: the same two
 * taps on a phone and on a desk, it survives a scroll mid-gesture, and it is a keyboard path for
 * free. The rule is the zone's `accepts`, so a wrong placement is a fact about the idea.
 */
function DropPlay({ primitive, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'drop' }>;
  const [held, setHeld] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [missed, setMissed] = useState<string | null>(null);
  const tray = useMemo(
    () => shuffled([...p.tokens].sort(byPlace), p.tokens.map((t) => t.id).join()),
    [p.tokens],
  );
  const zones = useMemo(() => [...p.zones].sort(byPlace), [p.zones]);

  const drop = (zoneId: string) => {
    if (frozen || !held) return;
    const zone = p.zones.find((z) => z.id === zoneId);
    const token = held;
    const cap = zone?.capacity ?? null;
    const full = cap !== null && Object.values(placed).filter((z) => z === zoneId).length >= cap;
    if (zone?.accepts.includes(token) && !full) {
      const next = { ...placed, [token]: zoneId };
      setPlaced(next);
      setHeld(null);
      setMissed(null);
      onRight(token);
      if (Object.keys(next).length === p.tokens.length) onDone();
    } else {
      setMissed(token);
      onWrong(token);
    }
  };

  return (
    <>
      <div className="cx-tray" data-cx="tray">
        {tray.map((t) => (
          <button
            key={t.id}
            type="button"
            className={[
              'cx-chip',
              held === t.id ? 'cx-held' : '',
              missed === t.id ? 'cx-miss' : '',
              placed[t.id] ? 'cx-gone' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={sizeOf(t.box, unitPx)}
            disabled={frozen || Boolean(placed[t.id])}
            aria-pressed={held === t.id}
            onClick={() => {
              setMissed(null);
              setHeld((h) => (h === t.id ? null : t.id));
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="cx-zones" data-cx="zones">
        {zones.map((z) => (
          <button
            key={z.id}
            type="button"
            className={`cx-zone${held ? ' cx-armed' : ''}`}
            style={{ minHeight: Math.max(MIN_HIT_PX * 1.6, z.box.h * unitPx) }}
            disabled={frozen || !held}
            onClick={() => drop(z.id)}
          >
            <span className="cx-zone-label">{z.label}</span>
            <span className="cx-zone-held">
              {p.tokens
                .filter((t) => placed[t.id] === z.id)
                .map((t) => (
                  <span key={t.id}>{t.label}</span>
                ))}
            </span>
          </button>
        ))}
      </div>
      <Pips at={Object.keys(placed).length} of={p.tokens.length} />
    </>
  );
}

// --- sort: the whole set into its order (§2 ordering) -----------------------------------------------------

/** Tap two to swap them, then check. An order is right or wrong as a whole, so the check is explicit. */
function SortPlay({ primitive, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'sort' }>;
  const right = useMemo(
    () => [...p.items].sort((a, b) => a.rank - b.rank).map((i) => i.id),
    [p.items],
  );
  const [row, setRow] = useState<string[]>(() => shuffled(right, right.join('|')));
  const [held, setHeld] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const byId = useMemo(() => new Map(p.items.map((i) => [i.id, i])), [p.items]);
  const solved = row.every((id, i) => id === right[i]);

  const tap = (id: string) => {
    if (frozen) return;
    setChecked(false);
    if (held === null) return setHeld(id);
    if (held === id) return setHeld(null);
    const a = row.indexOf(held);
    const b = row.indexOf(id);
    const next = row.slice();
    const carried = next[a] as string;
    next[a] = next[b] as string;
    next[b] = carried;
    setRow(next);
    setHeld(null);
  };

  const check = () => {
    if (frozen) return;
    setChecked(true);
    if (row.every((id, i) => id === right[i])) {
      onRight();
      onDone();
    } else {
      // the first card out of place is what the line is about, so the learner is told about THAT idea
      const off = row.find((id, i) => id !== right[i]);
      onWrong(off);
    }
  };

  return (
    <div className={`cx-sort${p.axis === 'horizontal' ? ' cx-across' : ''}`}>
      <div className="cx-lane" data-cx="lane">
        {row.map((id, i) => {
          const item = byId.get(id);
          const inPlace = checked && right[i] === id;
          const outOfPlace = checked && right[i] !== id;
          return (
            <button
              key={id}
              type="button"
              className={[
                'cx-chip',
                held === id ? 'cx-held' : '',
                inPlace ? 'cx-right' : '',
                outOfPlace ? 'cx-miss' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={item ? sizeOf(item.box, unitPx) : undefined}
              disabled={frozen}
              aria-pressed={held === id}
              onClick={() => tap(id)}
            >
              <b className="cx-place" aria-hidden>
                {i + 1}
              </b>
              {item?.label ?? id}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="cx-check"
        data-cx="check"
        disabled={frozen || (checked && solved)}
        onClick={check}
      >
        Check the order
      </button>
    </div>
  );
}

// --- match: join each left to its right (§2 correspondence) -------------------------------------------------

function MatchPlay({ primitive, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'match' }>;
  const [held, setHeld] = useState<string | null>(null);
  const [joined, setJoined] = useState<Record<string, string>>({});
  const [missed, setMissed] = useState<string | null>(null);
  const rights = useMemo(() => shuffled(p.pairs, p.pairs.map((x) => x.right).join('|')), [p.pairs]);
  const size = sizeOf(p.card, unitPx);

  const join = (pairId: string) => {
    if (frozen || held === null) return;
    if (held === pairId) {
      const next = { ...joined, [held]: pairId };
      setJoined(next);
      setHeld(null);
      setMissed(null);
      onRight(held);
      if (Object.keys(next).length === p.pairs.length) onDone();
    } else {
      setMissed(held);
      onWrong(held);
    }
  };

  const taken = new Set(Object.values(joined));
  return (
    <div className="cx-match" data-cx="match">
      <div className="cx-col">
        {p.pairs.map((x) => (
          <button
            key={`l-${x.id}`}
            type="button"
            className={[
              'cx-chip',
              held === x.id ? 'cx-held' : '',
              missed === x.id ? 'cx-miss' : '',
              x.id in joined ? 'cx-right' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={size}
            disabled={frozen || x.id in joined}
            aria-pressed={held === x.id}
            onClick={() => {
              setMissed(null);
              setHeld((h) => (h === x.id ? null : x.id));
            }}
          >
            {x.left}
          </button>
        ))}
      </div>
      <div className="cx-col">
        {rights.map((x) => (
          <button
            key={`r-${x.id}`}
            type="button"
            className={`cx-chip${taken.has(x.id) ? ' cx-right' : ''}`}
            style={size}
            disabled={frozen || taken.has(x.id) || held === null}
            onClick={() => join(x.id)}
          >
            {x.right}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- sequence: build it, checked at each step (§2 construction) --------------------------------------------

function SequencePlay({ primitive, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'sequence' }>;
  const [built, setBuilt] = useState<string[]>([]);
  const [missed, setMissed] = useState<string | null>(null);
  const tray = useMemo(() => shuffled(p.steps, p.steps.map((s) => s.id).join()), [p.steps]);
  const byId = useMemo(() => new Map(p.steps.map((s) => [s.id, s])), [p.steps]);

  const pick = (id: string) => {
    if (frozen) return;
    if (p.steps[built.length]?.id === id) {
      const next = [...built, id];
      setBuilt(next);
      setMissed(null);
      onRight(id);
      if (next.length === p.steps.length) onDone();
    } else {
      setMissed(id);
      onWrong(id);
    }
  };

  return (
    <>
      {built.length > 0 && (
        <ol className="cx-built" data-cx="built">
          {built.map((id, i) => (
            <li key={id}>
              <b>{i + 1}</b>
              <span>
                {byId.get(id)?.label ?? id}
                {/* the check the step opened: the reason the next move is allowed at all */}
                <em>{byId.get(id)?.check}</em>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="cx-tray" data-cx="tray">
        {tray.map((s) => (
          <button
            key={s.id}
            type="button"
            className={[
              'cx-chip',
              missed === s.id ? 'cx-miss' : '',
              built.includes(s.id) ? 'cx-gone' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={sizeOf(s.box, unitPx)}
            disabled={frozen || built.includes(s.id)}
            onClick={() => pick(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Pips at={built.length} of={p.steps.length} />
    </>
  );
}

// --- branch: one of several, and where a wrong one sends you (§2 discrimination) --------------------------

function BranchPlay({ primitive, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'branch' }>;
  const [chosen, setChosen] = useState<string | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const options = useMemo(
    () => shuffled([...p.options].sort(byPlace), p.options.map((o) => o.id).join()),
    [p.options],
  );

  const choose = (id: string) => {
    if (frozen || chosen || missed.includes(id)) return;
    const option = p.options.find((o) => o.id === id);
    if (option?.correct) {
      setChosen(id);
      onRight(id);
      onDone(id);
    } else {
      setMissed((m) => [...m, id]);
      onWrong(id);
      // A wrong answer that routes somewhere routes the moment it is made: that IS the branch.
      if (option?.goto) onDone(id);
    }
  };

  return (
    <div className="cx-options" data-cx="options">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={[
            'cx-chip',
            chosen === o.id ? 'cx-right' : '',
            missed.includes(o.id) ? 'cx-miss' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={sizeOf(o.box, unitPx)}
          disabled={frozen}
          onClick={() => choose(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- mark: land on the stage itself ----------------------------------------------------------------------

/**
 * The four tools reduce to the same check the contract describes: the drawing is checked against the
 * targets. A point lands on one; a line lands on two; a path lands on each in turn; a circle lands on
 * its centre. Nothing the model wrote is executed to decide it — the targets are data.
 */
function MarkPlay({ primitive, marks, hue, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'mark' }>;
  // The spec's radius is a floor in stage units; what a finger needs is 44 css px, and how many
  // units that is depends on how wide this stage actually came out. Measured, never assumed.
  const finger = MIN_HIT_PX / 2 / unitPx;
  const [hit, setHit] = useState<string[]>([]);
  const [missed, setMissed] = useState<string | null>(null);
  const still = useReducedMotion();
  const ordered = p.tool === 'line' || p.tool === 'path';

  const land = (id: string) => {
    if (frozen || hit.includes(id)) return;
    const wanted = ordered ? p.targets[hit.length]?.id : id;
    if (id === wanted) {
      const next = [...hit, id];
      setHit(next);
      setMissed(null);
      onRight(id);
      if (next.length >= p.need) onDone();
    } else {
      setMissed(id);
      onWrong(id);
    }
  };

  const key = (e: ReactKeyboardEvent<SVGCircleElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      land(id);
    }
  };

  return (
    <>
      <Stage marks={marks} hue={hue} label={p.prompt}>
        {hit.length > 1 && ordered && (
          <polyline
            points={hit
              .map((id) => p.targets.find((t) => t.id === id))
              .filter((t): t is (typeof p.targets)[number] => Boolean(t))
              .map((t) => `${t.x},${t.y}`)
              .join(' ')}
            fill="none"
            stroke={hue}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {p.targets.map((t) => (
          <g key={t.id}>
            {hit.includes(t.id) && (
              <motion.circle
                cx={t.x}
                cy={t.y}
                r={Math.max(t.r ?? 0, finger) * 0.8}
                fill={hue}
                fillOpacity={0.18}
                stroke={hue}
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
                initial={still ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                style={{ transformOrigin: `${t.x}px ${t.y}px` }}
              />
            )}
            {/* biome-ignore lint/a11y/useSemanticElements: an SVG stage has no <button>; the disc is the tap target */}
            <circle
              className="cx-hitspot"
              data-cx="target"
              data-mark={t.id}
              cx={t.x}
              cy={t.y}
              r={Math.max(t.r ?? 0, finger)}
              fill="transparent"
              role="button"
              tabIndex={frozen ? -1 : 0}
              aria-label={t.why}
              aria-pressed={hit.includes(t.id)}
              onClick={() => land(t.id)}
              onKeyDown={(e) => key(e, t.id)}
              style={missed === t.id ? { outline: '2px solid var(--rose)' } : undefined}
            />
          </g>
        ))}
      </Stage>
      <Pips at={hit.length} of={p.need} />
    </>
  );
}

// --- tap: the marks the stage already carries -------------------------------------------------------------

function TapPlay({ primitive, marks, hue, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'tap' }>;
  const [hit, setHit] = useState<string[]>([]);
  const [missed, setMissed] = useState<string | null>(null);
  // The finger's radius in stage units, from the width this stage actually came out at.
  const R = MIN_HIT_PX / 2 / unitPx;

  const land = (id: string) => {
    if (frozen || hit.includes(id)) return;
    if (p.targets.includes(id)) {
      const next = [...hit, id];
      setHit(next);
      setMissed(null);
      onRight(id);
      if (next.length >= p.need) onDone();
    } else {
      setMissed(id);
      onWrong(id);
    }
  };

  return (
    <>
      <Stage marks={marks} hue={hue} label={p.prompt}>
        {/* Targets paint last, so where two hit areas do meet the one being asked for wins the tap. */}
        {[...marks]
          .sort((a, b) => Number(p.targets.includes(a.id)) - Number(p.targets.includes(b.id)))
          .map((m) => {
            const { x: cx, y: cy } = hitCentre(m);
            return (
              <g key={`hit-${m.id}`}>
                {hit.includes(m.id) && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={R}
                    fill={hue}
                    fillOpacity={0.18}
                    stroke={hue}
                    strokeWidth={0.8}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {/* biome-ignore lint/a11y/useSemanticElements: an SVG stage has no <button>; the disc is the tap target */}
                <circle
                  className="cx-hitspot"
                  data-cx={p.targets.includes(m.id) ? 'target' : 'decoy'}
                  data-mark={m.id}
                  cx={cx}
                  cy={cy}
                  r={R}
                  fill="transparent"
                  role="button"
                  tabIndex={frozen ? -1 : 0}
                  aria-label={m.text ?? m.id}
                  aria-pressed={hit.includes(m.id)}
                  onClick={() => land(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      land(m.id);
                    }
                  }}
                  style={missed === m.id ? { outline: '2px solid var(--rose)' } : undefined}
                />
              </g>
            );
          })}
      </Stage>
      <Pips at={hit.length} of={p.need} />
    </>
  );
}

// --- drag: carry one mark onto a zone ------------------------------------------------------------------------

function DragPlay({ primitive, marks, hue, unitPx, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'drag' }>;
  const handle = marks.find((m) => m.id === p.handle) as Mark;
  const [pos, setPos] = useState({ x: handle.x, y: handle.y });
  const svg = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const settled = useRef(false);
  const others = marks.filter((m) => m.id !== p.handle);

  const release = (x: number, y: number) => {
    if (settled.current) return;
    if (Math.hypot(x - p.to.x, y - p.to.y) <= p.radius) {
      settled.current = true;
      setPos({ x: p.to.x, y: p.to.y });
      onRight(p.handle);
      onDone();
    } else {
      setPos({ x: handle.x, y: handle.y });
      onWrong(p.handle);
    }
  };

  const toUnits = (e: ReactPointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: clamp(((e.clientX - box.left) / box.width) * STAGE_W, 0, STAGE_W),
      y: clamp(((e.clientY - box.top) / box.height) * STAGE_H, 0, STAGE_H),
    };
  };

  return (
    <Stage marks={others} hue={hue} label={p.prompt} svgRef={svg}>
      <circle
        data-cx="zone"
        cx={p.to.x}
        cy={p.to.y}
        r={p.radius}
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth={0.6}
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${pos.x - handle.x} ${pos.y - handle.y})`}>
        <MarkShape mark={handle} hue={hue} />
      </g>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG stage has no <button>; the disc is the handle */}
      <circle
        className="cx-hitspot"
        data-cx="handle"
        cx={pos.x}
        cy={pos.y}
        r={Math.max(p.radius, MIN_HIT_PX / 2 / unitPx)}
        fill="transparent"
        role="button"
        tabIndex={frozen ? -1 : 0}
        aria-label={p.prompt}
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if (frozen || settled.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const u = toUnits(e);
          if (u) setPos(u);
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const u = toUnits(e) ?? pos;
          release(u.x, u.y);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (frozen || settled.current) return;
          const d = 4;
          const next = { ...pos };
          if (e.key === 'ArrowLeft') next.x -= d;
          else if (e.key === 'ArrowRight') next.x += d;
          else if (e.key === 'ArrowUp') next.y -= d;
          else if (e.key === 'ArrowDown') next.y += d;
          else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            release(pos.x, pos.y);
            return;
          } else return;
          e.preventDefault();
          setPos({ x: clamp(next.x, 0, STAGE_W), y: clamp(next.y, 0, STAGE_H) });
        }}
      />
    </Stage>
  );
}

// --- slide: move the value, watch the picture ------------------------------------------------------------------

/**
 * `at` is where the idea lands. Moving AWAY from it is the wrong move this act has, and it is a real
 * one: on the fractions bar it is the learner making the pieces bigger while looking for more
 * chocolate. It is reported once, not on every frame.
 */
function SlidePlay({ primitive, marks, hue, frozen, onRight, onWrong, onDone }: PlayProps) {
  const p = primitive as Extract<Primitive, { kind: 'slide' }>;
  const [v, setV] = useState(p.from);
  const crossed = useRef(false);
  const warned = useRef(false);
  const span = p.max - p.min;
  // A range ten wide or more is a count of things and moves in ones; a narrower one is a quantity
  // and needs a hundred stops. The old rule gave a range of ten a step of 0.1, which is sixty
  // presses of an arrow key to cross a threshold six away.
  const step = span >= 10 ? 1 : span / 100;
  const away = p.at > p.from ? -1 : 1;

  const move = (next: number) => {
    if (frozen) return;
    setV(next);
    const reached = p.at > p.from ? next >= p.at : next <= p.at;
    if (reached && !crossed.current) {
      crossed.current = true;
      onRight();
      onDone();
      return;
    }
    if (!crossed.current && !warned.current && (next - p.from) * away > span * 0.1) {
      warned.current = true;
      onWrong();
    }
  };

  const drawn = useMemo(() => {
    if (!p.bind) return marks;
    const t = clamp((v - p.min) / span, 0, 1);
    const [a, b] = p.bind.at as [number, number];
    const at = a + (b - a) * t;
    return marks.map((m) => (m.id === p.bind?.mark ? { ...m, [p.bind.prop]: at } : m));
  }, [marks, p.bind, p.min, span, v]);

  const readout = (p.valueLabel ?? '{v}').replace(
    '{v}',
    Number.isInteger(v) ? String(v) : v.toFixed(2),
  );

  return (
    <div className="cx-slide">
      {drawn.length > 0 && <Stage marks={drawn} hue={hue} label={readout} />}
      <span className="cx-value" data-cx="value">
        {readout}
        {p.unit ? ` ${p.unit}` : ''}
      </span>
      <input
        className="cx-range"
        data-cx="range"
        type="range"
        min={p.min}
        max={p.max}
        step={step}
        value={v}
        disabled={frozen}
        aria-label={readout}
        onChange={(e) => move(Number(e.currentTarget.value))}
      />
    </div>
  );
}

// --- the one dispatch -------------------------------------------------------------------------------------------

const PLAYS: Record<string, (p: PlayProps) => React.ReactNode> = {
  drop: DropPlay,
  sort: SortPlay,
  match: MatchPlay,
  sequence: SequencePlay,
  branch: BranchPlay,
  mark: MarkPlay,
  tap: TapPlay,
  drag: DragPlay,
  slide: SlidePlay,
};

/** Every act the vocabulary has. The bench and the browser proof walk this list. */
export const ACT_KINDS = Object.keys(PLAYS);

/** The whole of "renders ANY valid composition": look the act up by kind, hand it its props. */
export function PlayView(props: PlayProps) {
  const Play = PLAYS[props.primitive.kind];
  if (!Play) return null;
  return <Play {...props} />;
}
