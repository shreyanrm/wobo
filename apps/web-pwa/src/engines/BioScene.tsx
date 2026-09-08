'use client';

/**
 * BioScene — the biology engine (SUBJECTS.md §5-biology). Pure SVG / custom, no heavy deps. One
 * spec-driven component, four kinds chosen by `kind`:
 *
 *   • dragLabel — a labelled diagram (cell / heart / plant / neuron). An SVG figure the model
 *     authors as simple marks, plus a tray of labels; the learner drags each label onto its
 *     authored target zone (x, y, r). A correct drop snaps + locks (sfx.bloom); a drop on a wrong
 *     zone returns to the tray (sfx.wrong); continue unlocks once every label is placed.
 *   • punnett — a Punnett square. The parents' alleles are authored (e.g. Bb × Bb); the engine
 *     COMPUTES the correct genotype in every cell and the phenotype ratio itself (the same cross
 *     logic plexus/bio.py proves), refuses a wrong cell, and reveals 1:2:1 / 3:1 when solved.
 *   • foodWeb — organisms as SVG nodes with arrowed directed edges (energy flow). The learner taps
 *     an organism to remove it and watches everything downstream collapse — a real, computed graph
 *     reachability, not a guess.
 *   • taxonomy — a classification tree kingdom → … → species. The learner classifies down one rank
 *     at a time, picking from the offered options; a correct pick locks and reveals the next rank.
 *
 * The genotype math (validGenotype / canonical / punnettCross / phenotypeRatio) mirrors the gateway
 * gate plexus/bio.py exactly, so a scene the server would refuse is refused here too (client parity).
 * Registers a Wobo scene target every kind (Wobo reads live state + drives it); reduced-motion + mute
 * aware; both themes via CSS vars + the passed hue; sentence-case copy.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
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

// --- the spec (discriminated by `kind`) -----------------------------------------------------------

/** A mark in a dragLabel figure — simple SVG geometry on a 0..100 × 0..62 canvas. */
export interface BioFigureMark {
  id: string;
  shape?: 'ellipse' | 'circle' | 'rect' | 'line' | 'polygon' | 'path';
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: string;
  d?: string;
  filled?: boolean;
}

export interface BioLabel {
  id: string;
  text: string;
  /** The authored target zone on the 0..100 × 0..62 canvas. */
  x: number;
  y: number;
  r: number;
}

export interface BioDragLabelSpec {
  kind: 'dragLabel';
  id: string;
  title: string;
  figure: BioFigureMark[];
  labels: BioLabel[];
  caption?: string;
}

export interface BioPunnettSpec {
  kind: 'punnett';
  id: string;
  title: string;
  /** Parent genotypes, single gene, same letter — e.g. "Bb". */
  parentA: string;
  parentB: string;
  /** Optional authored answer cells (validated against the true cross). */
  cells?: string[];
  /** Human names for the dominant / recessive phenotype (for the reveal). */
  traitDominant?: string;
  traitRecessive?: string;
  caption?: string;
}

export interface BioNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
}

export interface BioEdge {
  from: string;
  to: string;
}

export interface BioFoodWebSpec {
  kind: 'foodWeb';
  id: string;
  title: string;
  nodes: BioNode[];
  edges: BioEdge[];
  caption?: string;
}

export interface BioRank {
  rank: string;
  answer: string;
  options: string[];
}

export interface BioTaxonomySpec {
  kind: 'taxonomy';
  id: string;
  title: string;
  organism?: string;
  ranks: BioRank[];
  caption?: string;
}

export type BioSceneSpec = BioDragLabelSpec | BioPunnettSpec | BioFoodWebSpec | BioTaxonomySpec;

// --- validation (mirrors plexus/bio.py; a scene it would refuse is refused here) -------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// Linnaean ranks in canonical descending order — a taxonomy must walk them top-down (bio.py parity).
const RANK_ORDER = ['domain', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
const RANK_INDEX = new Map(RANK_ORDER.map((r, i) => [r, i]));

// --- punnett genetics (pure math — mirrors bio.py valid_genotype / canonical / punnett_cross) -----

/** A single-gene genotype is two letters of the same gene, e.g. "Bb"/"BB"/"bb". */
export function validGenotype(g: unknown): g is string {
  return (
    typeof g === 'string' &&
    g.length === 2 &&
    /^[A-Za-z]{2}$/.test(g) &&
    g[0]?.toLowerCase() === g[1]?.toLowerCase()
  );
}

/** Order an allele pair with the dominant (uppercase) allele first: ("b","B") -> "Bb". */
export function canonical(a: string, b: string): string {
  return [a, b]
    .sort((x, y) => {
      const lx = x.toLowerCase();
      const ly = y.toLowerCase();
      if (lx !== ly) return lx < ly ? -1 : 1;
      // uppercase (islower false) sorts ahead of lowercase
      return Number(x === x.toLowerCase()) - Number(y === y.toLowerCase());
    })
    .join('');
}

/** The four offspring genotypes for parentA × parentB (single gene), canonicalised; null if malformed. */
export function punnettCross(parentA: unknown, parentB: unknown): string[] | null {
  if (!validGenotype(parentA) || !validGenotype(parentB)) return null;
  if (parentA[0]?.toLowerCase() !== parentB[0]?.toLowerCase()) return null;
  const out: string[] = [];
  for (const x of parentA) for (const y of parentB) out.push(canonical(x, y));
  return out;
}

/** (dominant, recessive) counts — dominant if any uppercase allele is present. */
export function phenotypeRatio(cells: string[]): [number, number] {
  const dominant = cells.filter((g) => /[A-Z]/.test(g)).length;
  return [dominant, cells.length - dominant];
}

function multiset(cells: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of cells) out[g] = (out[g] ?? 0) + 1;
  return out;
}

function sameMultiset(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

// --- parsers per kind -----------------------------------------------------------------------------

const NUM_GEOM = ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2'] as const;

function parseMark(raw: unknown): BioFigureMark | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  const mark: BioFigureMark = { id: raw.id.trim() };
  const shape = raw.shape;
  if (
    shape === 'ellipse' ||
    shape === 'circle' ||
    shape === 'rect' ||
    shape === 'line' ||
    shape === 'polygon' ||
    shape === 'path'
  )
    mark.shape = shape;
  for (const k of NUM_GEOM) if (num(raw[k])) mark[k] = raw[k] as number;
  if (str(raw.points)) mark.points = raw.points.trim();
  if (str(raw.d)) mark.d = raw.d.trim();
  if (raw.filled === true) mark.filled = true;
  return mark;
}

function parseLabel(raw: unknown): BioLabel | null {
  if (!isRecord(raw)) return null;
  const { id, text, x, y, r } = raw;
  if (!str(id) || !str(text) || !num(x) || !num(y) || !num(r) || r <= 0) return null;
  return { id: id.trim(), text: text.trim(), x, y, r };
}

function parseNode(raw: unknown): BioNode | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.label)) return null;
  const node: BioNode = { id: raw.id.trim(), label: raw.label.trim() };
  if (num(raw.x)) node.x = raw.x;
  if (num(raw.y)) node.y = raw.y;
  return node;
}

function parseRank(raw: unknown): BioRank | null {
  if (!isRecord(raw) || !str(raw.rank) || !str(raw.answer)) return null;
  const options = (Array.isArray(raw.options) ? raw.options : []).filter((o): o is string =>
    str(o),
  );
  if (options.length < 2 || !options.includes(raw.answer.trim())) return null;
  if (!RANK_INDEX.has(raw.rank.trim().toLowerCase())) return null;
  return {
    rank: raw.rank.trim(),
    answer: raw.answer.trim(),
    options: options.map((o) => o.trim()),
  };
}

/** Validate a generated BioScene spec — anything unrenderable / unprovable is refused (null). */
export function parseBioScene(raw: unknown): BioSceneSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (src.verified === false) return null;
  const kind = src.kind;
  const id = str(src.id) ? src.id : 'bio';
  const title = str(src.title) ? src.title : 'biology';
  const caption = str(src.caption) ? src.caption : undefined;

  if (kind === 'dragLabel') {
    const figure = (Array.isArray(src.figure) ? src.figure : [])
      .map(parseMark)
      .filter((m): m is BioFigureMark => m !== null);
    if (figure.length < 1) return null;
    const labels = (Array.isArray(src.labels) ? src.labels : [])
      .map(parseLabel)
      .filter((l): l is BioLabel => l !== null);
    if (labels.length < 2) return null;
    return { kind: 'dragLabel', id, title, figure, labels, caption };
  }

  if (kind === 'punnett') {
    const cross = punnettCross(src.parentA, src.parentB);
    if (cross === null) return null;
    const parentA = (src.parentA as string).trim();
    const parentB = (src.parentB as string).trim();
    let cells: string[] | undefined;
    if (src.cells !== undefined) {
      if (!Array.isArray(src.cells) || src.cells.length !== cross.length) return null;
      if (!src.cells.every(validGenotype)) return null;
      const authored = (src.cells as string[]).map((g) =>
        canonical(g[0] as string, g[1] as string),
      );
      if (!sameMultiset(multiset(authored), multiset(cross))) return null;
      cells = authored;
    }
    return {
      kind: 'punnett',
      id,
      title,
      parentA,
      parentB,
      cells,
      traitDominant: str(src.traitDominant) ? src.traitDominant.trim() : undefined,
      traitRecessive: str(src.traitRecessive) ? src.traitRecessive.trim() : undefined,
      caption,
    };
  }

  if (kind === 'foodWeb') {
    const nodes = (Array.isArray(src.nodes) ? src.nodes : [])
      .map(parseNode)
      .filter((n): n is BioNode => n !== null);
    if (nodes.length < 2) return null;
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (Array.isArray(src.edges) ? src.edges : [])
      .filter(
        (e): e is BioEdge =>
          isRecord(e) &&
          str(e.from) &&
          str(e.to) &&
          ids.has(e.from.trim()) &&
          ids.has(e.to.trim()) &&
          e.from.trim() !== e.to.trim(),
      )
      .map((e) => ({ from: e.from.trim(), to: e.to.trim() }));
    if (edges.length < 1) return null;
    return { kind: 'foodWeb', id, title, nodes, edges, caption };
  }

  if (kind === 'taxonomy') {
    const rawRanks = Array.isArray(src.ranks) ? src.ranks : [];
    const ranks = rawRanks.map(parseRank);
    if (ranks.some((r) => r === null) || ranks.length < 2) return null;
    const clean = ranks as BioRank[];
    const order = clean.map((r) => RANK_INDEX.get(r.rank.toLowerCase()) ?? -1);
    for (let i = 0; i < order.length - 1; i++)
      if ((order[i] ?? -1) >= (order[i + 1] ?? -1)) return null; // strictly descending
    return {
      kind: 'taxonomy',
      id,
      title,
      organism: str(src.organism) ? src.organism.trim() : undefined,
      ranks: clean,
      caption,
    };
  }

  return null;
}

// --- shared style bits ----------------------------------------------------------------------------

const chip: CSSProperties = {
  padding: '8px 12px',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  borderRadius: 'var(--wobo-radius-sm)',
  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
  background: 'var(--wobo-paper)',
  color: 'var(--wobo-ink-900)',
  cursor: 'pointer',
  userSelect: 'none',
};

const revealBox: CSSProperties = {
  border: '1px solid var(--wobo-feedback-correct)',
  background: 'var(--wobo-feedback-correctSoft)',
  borderRadius: 10,
  padding: '14px 16px',
  fontSize: '1rem',
  lineHeight: 1.6,
  color: 'var(--wobo-ink-900)',
};

// ================================================================================================
// dragLabel — labelled diagram
// ================================================================================================

const BIO_VB_W = 100;
const BIO_VB_H = 62;

function FigureShape({ mark, hue }: { mark: BioFigureMark; hue: string }) {
  const stroke = 'var(--wobo-ink-700)';
  const fill = mark.filled ? hue : 'none';
  const common = { stroke, strokeWidth: 0.6, fill, fillOpacity: mark.filled ? 0.12 : 1 };
  switch (mark.shape) {
    case 'circle':
      return <circle cx={mark.cx ?? 50} cy={mark.cy ?? 31} r={mark.r ?? 8} {...common} />;
    case 'rect':
      return (
        <rect
          x={mark.x ?? 40}
          y={mark.y ?? 20}
          width={mark.w ?? 20}
          height={mark.h ?? 20}
          rx={1.5}
          {...common}
        />
      );
    case 'line':
      return (
        <line
          x1={mark.x1 ?? 10}
          y1={mark.y1 ?? 31}
          x2={mark.x2 ?? 90}
          y2={mark.y2 ?? 31}
          stroke={stroke}
          strokeWidth={0.6}
        />
      );
    case 'polygon':
      return <polygon points={mark.points ?? ''} {...common} />;
    case 'path':
      return <path d={mark.d ?? ''} {...common} />;
    default:
      return (
        <ellipse
          cx={mark.cx ?? 50}
          cy={mark.cy ?? 31}
          rx={mark.rx ?? 30}
          ry={mark.ry ?? 20}
          {...common}
        />
      );
  }
}

function DragLabel({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: BioDragLabelSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [placed, setPlaced] = useState<Record<string, true>>({});
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const touchedRef = useRef(false);

  const done = Object.keys(placed).length === spec.labels.length;

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !done, onClick: onDone } });
  }, [done, setBar, onDone]);

  const toCanvas = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * BIO_VB_W,
      y: ((clientY - r.top) / r.height) * BIO_VB_H,
    };
  };

  const dropAt = (labelId: string, clientX: number, clientY: number) => {
    const p = toCanvas(clientX, clientY);
    if (!p) return;
    // nearest authored zone the drop falls inside (over ALL labels — a wrong zone is a wrong drop)
    let hit: BioLabel | null = null;
    let best = Infinity;
    for (const lb of spec.labels) {
      const d = Math.hypot(p.x - lb.x, p.y - lb.y);
      if (d <= lb.r && d < best) {
        best = d;
        hit = lb;
      }
    }
    if (!hit) return; // empty space — silently return to tray
    if (hit.id === labelId) {
      setPlaced((prev) => ({ ...prev, [labelId]: true }));
      sfx.bloom();
    } else {
      sfx.wrong();
    }
  };

  const onChipDown = (labelId: string) => (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ id: labelId, dx: 0, dy: 0 });
    if (!touchedRef.current) {
      touchedRef.current = true;
      sfx.tap();
    }
  };
  const onChipMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s || !drag) return;
    setDrag({ id: drag.id, dx: e.clientX - s.x, dy: e.clientY - s.y });
  };
  const onChipUp = (labelId: string) => (e: React.PointerEvent) => {
    if (drag) dropAt(labelId, e.clientX, e.clientY);
    startRef.current = null;
    setDrag(null);
  };

  const remaining = spec.labels.filter((l) => !placed[l.id]);

  const ref = useRegisterTarget<HTMLDivElement>(`bio-draglabel-${spec.id}`, {
    kind: 'controls',
    label: `the labelled diagram "${spec.title}" — drag each label to its part`,
    getSceneState: () => ({
      placed: spec.labels.filter((l) => placed[l.id]).map((l) => l.text),
      remaining: remaining.map((l) => l.text),
      done,
    }),
    getValidActions: () => remaining.map((l) => `place the label "${l.text}"`),
    applyTutorAction: (patch: Record<string, unknown>) => {
      // Wobo can place a label by id or text
      const target = str(patch.place) ? patch.place.trim() : undefined;
      const lb = spec.labels.find((l) => l.id === target || l.text === target);
      if (lb && !placed[lb.id]) {
        setPlaced((prev) => ({ ...prev, [lb.id]: true }));
        sfx.bloom();
      }
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `bio-draglabel-${spec.id}`,
      steps: [
        ...spec.labels.map((l) => `${l.text}: ${placed[l.id] ? 'placed ✓' : 'in tray'}`),
        done ? 'every part labelled' : `${remaining.length} to place`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, placed, done, remaining.length]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>label it — drag each name onto the right part</div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={220} style={{ padding: 'clamp(12px, 3vw, 22px)' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${BIO_VB_W} ${BIO_VB_H}`}
            width="100%"
            style={{ maxHeight: 300, touchAction: 'none' }}
            role="img"
            aria-label={`diagram of ${spec.title}`}
          >
            <title>{spec.title}</title>
            {spec.figure.map((m) => (
              <FigureShape key={m.id} mark={m} hue={hue} />
            ))}
            {spec.labels.map((lb) => {
              const isPlaced = Boolean(placed[lb.id]);
              return (
                <g key={lb.id}>
                  {/* drop hint ring — solid + named once placed */}
                  <circle
                    cx={lb.x}
                    cy={lb.y}
                    r={lb.r}
                    fill={isPlaced ? hue : 'none'}
                    fillOpacity={isPlaced ? 0.16 : 0}
                    stroke={isPlaced ? hue : 'var(--wobo-ink-300)'}
                    strokeWidth={0.5}
                    strokeDasharray={isPlaced ? undefined : '1.5 1.5'}
                  />
                  <circle cx={lb.x} cy={lb.y} r={0.9} fill="var(--wobo-ink-500)" />
                  {isPlaced && (
                    <text
                      x={lb.x}
                      y={lb.y - lb.r - 1.5}
                      textAnchor="middle"
                      fontSize={3.4}
                      fontWeight={600}
                      fill="var(--wobo-ink-900)"
                    >
                      {lb.text}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </Stage>

        {/* the tray */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          <AnimatePresence>
            {remaining.map((lb) => {
              const active = drag?.id === lb.id;
              return (
                <motion.button
                  key={lb.id}
                  type="button"
                  layout={!reduced}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onPointerDown={onChipDown(lb.id)}
                  onPointerMove={onChipMove}
                  onPointerUp={onChipUp(lb.id)}
                  onPointerCancel={onChipUp(lb.id)}
                  style={{
                    ...chip,
                    borderColor: active ? hue : 'var(--wobo-hairline-on-paper-strong)',
                    touchAction: 'none',
                    cursor: 'grab',
                    transform: active ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                    zIndex: active ? 20 : 1,
                    position: 'relative',
                    boxShadow: active ? '0 6px 18px rgba(0,0,0,0.16)' : undefined,
                  }}
                >
                  {lb.text}
                </motion.button>
              );
            })}
          </AnimatePresence>
          {remaining.length === 0 && (
            <div style={{ ...lead, ...captionSurface }}>
              every part is labelled — you built the diagram yourself.
            </div>
          )}
        </div>
        {spec.caption && remaining.length > 0 && <div style={lead}>{spec.caption}</div>}
      </div>
    </CardBody>
  );
}

// ================================================================================================
// punnett — the flagship
// ================================================================================================

function Punnett({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: BioPunnettSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const a = spec.parentA;
  const b = spec.parentB;
  const geneUp = (a[0] as string).toUpperCase();
  const geneLow = geneUp.toLowerCase();
  const options = useMemo(
    () => [geneUp + geneUp, geneUp + geneLow, geneLow + geneLow],
    [geneUp, geneLow],
  );
  // the true cross — computed, never authored trusted: correct[r][c] = canonical(colAllele, rowAllele)
  const correct = useMemo(() => {
    const grid: string[][] = [];
    for (let r = 0; r < 2; r++) {
      const row: string[] = [];
      for (let c = 0; c < 2; c++) row.push(canonical(a[c] as string, b[r] as string));
      grid.push(row);
    }
    return grid;
  }, [a, b]);
  const flatCorrect = useMemo(() => correct.flat(), [correct]);

  const [solved, setSolved] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [shake, setShake] = useState(0);
  const touchedRef = useRef(false);

  const allSolved = Object.keys(solved).length === 4;

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !allSolved, onClick: onDone } });
  }, [allSolved, setBar, onDone]);

  const bloomedRef = useRef(false);
  useEffect(() => {
    if (allSolved && !bloomedRef.current) {
      bloomedRef.current = true;
      sfx.bloom();
    }
  }, [allSolved]);

  const assign = (cellIdx: number, genotype: string) => {
    if (solved[cellIdx]) return;
    if (!touchedRef.current) {
      touchedRef.current = true;
      sfx.tap();
    }
    if (genotype === flatCorrect[cellIdx]) {
      setSolved((prev) => ({ ...prev, [cellIdx]: genotype }));
      setSelected(null);
    } else {
      sfx.wrong();
      setShake((s) => s + 1);
    }
  };

  const [genoRatio, phenoRatio] = useMemo(() => {
    const counts = options.map((o) => flatCorrect.filter((g) => g === o).length);
    const [dom, rec] = phenotypeRatio(flatCorrect);
    return [counts, [dom, rec] as [number, number]];
  }, [options, flatCorrect]);

  const ref = useRegisterTarget<HTMLDivElement>(`bio-punnett-${spec.id}`, {
    kind: 'controls',
    label: `the punnett square ${a} × ${b}`,
    getSceneState: () => ({
      cross: `${a} × ${b}`,
      cells: flatCorrect.map((g, i) => `${g}${solved[i] ? ' ✓' : ' —'}`),
      genotypeRatio: `${genoRatio[0]} ${options[0]} : ${genoRatio[1]} ${options[1]} : ${genoRatio[2]} ${options[2]}`,
      phenotypeRatio: `${phenoRatio[0]} : ${phenoRatio[1]}`,
      solved: allSolved,
    }),
    getValidActions: () =>
      Object.keys(solved).length < 4
        ? ['fill a cell with its genotype (BB, Bb or bb)']
        : ['the square is complete'],
    applyTutorAction: (patch: Record<string, unknown>) => {
      // Wobo can solve a cell: { cell: 0..3 } fills it correctly, or { fillAll: true }
      if (patch.fillAll === true) {
        setSolved(Object.fromEntries(flatCorrect.map((g, i) => [i, g])));
        return;
      }
      if (num(patch.cell) && patch.cell >= 0 && patch.cell < 4) {
        const i = Math.round(patch.cell);
        setSolved((prev) => ({ ...prev, [i]: flatCorrect[i] as string }));
      }
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `bio-punnett-${spec.id}`,
      steps: [
        `cross: ${a} × ${b}`,
        ...flatCorrect.map((g, i) => `cell ${i + 1}: ${solved[i] ? g : '?'}`),
        allSolved
          ? `genotype ${genoRatio[0]}:${genoRatio[1]}:${genoRatio[2]} · phenotype ${phenoRatio[0]}:${phenoRatio[1]}`
          : 'filling the square',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec.id, a, b, flatCorrect, solved, allSolved, genoRatio, phenoRatio]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const CellBox = ({ idx }: { idx: number }) => {
    const value = solved[idx];
    const isSelected = selected === idx;
    return (
      <motion.button
        type="button"
        animate={isSelected && shake ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
        key={`cell-${idx}-${isSelected ? shake : 0}`}
        transition={{ duration: 0.4 }}
        onClick={() => !value && setSelected(isSelected ? null : idx)}
        style={{
          aspectRatio: '1',
          minWidth: 56,
          fontFamily: 'inherit',
          fontSize: '1.25rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: value
            ? 'var(--wobo-feedback-correctSoft)'
            : isSelected
              ? 'var(--wobo-ink-100)'
              : 'var(--wobo-paper)',
          color: value ? 'var(--wobo-ink-900)' : 'var(--wobo-ink-500)',
          border: value
            ? '1px solid var(--wobo-feedback-correct)'
            : isSelected
              ? `1.5px solid ${hue}`
              : '0.5px solid var(--wobo-hairline-on-paper-strong)',
          borderRadius: 10,
          cursor: value ? 'default' : 'pointer',
        }}
      >
        {value ?? (isSelected ? '·' : '')}
      </motion.button>
    );
  };

  const HeaderCell = ({ text }: { text: string }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.1rem',
        fontWeight: 600,
        color: hue,
        minWidth: 56,
        minHeight: 28,
      }}
    >
      {text}
    </div>
  );

  return (
    <CardBody maxWidth={560}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>
          cross it — pick each cell's genotype: combine the row and column allele
        </div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={220} style={{ padding: 'clamp(14px, 3vw, 24px)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto auto auto',
              gap: 6,
              alignItems: 'stretch',
            }}
          >
            <HeaderCell text="" />
            <HeaderCell text={a[0] as string} />
            <HeaderCell text={a[1] as string} />
            <HeaderCell text={b[0] as string} />
            <CellBox idx={0} />
            <CellBox idx={1} />
            <HeaderCell text={b[1] as string} />
            <CellBox idx={2} />
            <CellBox idx={3} />
          </div>
        </Stage>

        {/* the genotype palette — tap a cell, then a genotype */}
        {!allSolved && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {options.map((o) => (
              <button
                key={o}
                type="button"
                disabled={selected === null}
                onClick={() => selected !== null && assign(selected, o)}
                style={{
                  ...chip,
                  fontWeight: 600,
                  opacity: selected === null ? 0.5 : 1,
                  cursor: selected === null ? 'default' : 'pointer',
                  borderColor: selected === null ? 'var(--wobo-hairline-on-paper)' : hue,
                }}
              >
                {o}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence>
          {allSolved && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={revealBox}
            >
              genotype ratio {genoRatio[0]} {options[0]} : {genoRatio[1]} {options[1]} :{' '}
              {genoRatio[2]} {options[2]}. phenotype ratio {phenoRatio[0]} : {phenoRatio[1]} —{' '}
              {phenoRatio[0]} {spec.traitDominant ?? 'dominant'} to {phenoRatio[1]}{' '}
              {spec.traitRecessive ?? 'recessive'}.
            </motion.div>
          )}
        </AnimatePresence>
        {!allSolved && (
          <div style={{ ...lead, ...captionSurface }}>
            {spec.caption ??
              'each cell takes one allele from the top and one from the side — the dominant allele is written first.'}
          </div>
        )}
      </div>
    </CardBody>
  );
}

// ================================================================================================
// foodWeb — energy flows, remove a link and watch it collapse
// ================================================================================================

/** Auto-layout nodes without authored positions: even rows on the 0..100 × 0..62 canvas. */
function layoutNodes(nodes: BioNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const cols = Math.ceil(Math.sqrt(nodes.length));
  nodes.forEach((n, i) => {
    if (num(n.x) && num(n.y)) {
      out[n.id] = { x: n.x, y: n.y };
    } else {
      const rows = Math.ceil(nodes.length / cols);
      const col = i % cols;
      const row = Math.floor(i / cols);
      out[n.id] = {
        x: 14 + (col + 0.5) * ((100 - 28) / cols),
        y: 12 + (row + 0.5) * ((62 - 20) / Math.max(rows, 1)),
      };
    }
  });
  return out;
}

function FoodWeb({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: BioFoodWebSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const pos = useMemo(() => layoutNodes(spec.nodes), [spec.nodes]);
  const [removed, setRemoved] = useState<string | null>(null);
  const touchedRef = useRef(false);

  // everything downstream of `removed` that loses its energy source (BFS along directed edges)
  const collapsed = useMemo(() => {
    if (!removed) return new Set<string>();
    const adj = new Map<string, string[]>();
    for (const e of spec.edges) {
      const arr = adj.get(e.from) ?? [];
      arr.push(e.to);
      adj.set(e.from, arr);
    }
    const dead = new Set<string>([removed]);
    const queue = [removed];
    while (queue.length) {
      const cur = queue.shift() as string;
      for (const nxt of adj.get(cur) ?? []) {
        // a consumer collapses only if ALL its food sources are dead
        const sources = spec.edges.filter((e) => e.to === nxt).map((e) => e.from);
        if (sources.every((s) => dead.has(s)) && !dead.has(nxt)) {
          dead.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return dead;
  }, [removed, spec.edges]);

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: removed === null, onClick: onDone } });
  }, [removed, setBar, onDone]);

  const tap = (id: string) => {
    if (!touchedRef.current) {
      touchedRef.current = true;
      sfx.tap();
    }
    if (removed === id) {
      setRemoved(null);
    } else {
      setRemoved(id);
      sfx.bloom();
    }
  };

  const ref = useRegisterTarget<HTMLDivElement>(`bio-foodweb-${spec.id}`, {
    kind: 'controls',
    label: `the food web "${spec.title}" — tap an organism to remove it`,
    getSceneState: () => ({
      removed: removed ? spec.nodes.find((n) => n.id === removed)?.label : null,
      collapses: spec.nodes.filter((n) => collapsed.has(n.id)).map((n) => n.label),
      totalOrganisms: spec.nodes.length,
    }),
    getValidActions: () => spec.nodes.map((n) => `remove ${n.label}`),
    applyTutorAction: (patch: Record<string, unknown>) => {
      const target = str(patch.remove) ? patch.remove.trim() : undefined;
      const n = spec.nodes.find((x) => x.id === target || x.label === target);
      if (n) tap(n.id);
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `bio-foodweb-${spec.id}`,
      steps: removed
        ? [
            `removed: ${spec.nodes.find((n) => n.id === removed)?.label}`,
            `collapses: ${
              spec.nodes
                .filter((n) => collapsed.has(n.id) && n.id !== removed)
                .map((n) => n.label)
                .join(', ') || 'nothing else'
            }`,
          ]
        : ['tap an organism to see what depends on it'],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, removed, collapsed]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const collapsedCount = spec.nodes.filter((n) => collapsed.has(n.id)).length;

  return (
    <CardBody maxWidth={640}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>energy flows along the arrows — tap an organism to remove it</div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={240} style={{ padding: 'clamp(12px, 3vw, 22px)' }}>
          <svg
            viewBox={`0 0 ${BIO_VB_W} ${BIO_VB_H}`}
            width="100%"
            style={{ maxHeight: 320 }}
            role="img"
            aria-label={`food web of ${spec.title}`}
          >
            <title>{spec.title}</title>
            <defs>
              <marker
                id={`bio-arrow-${spec.id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M0 1 L9 5 L0 9 z" fill={hue} />
              </marker>
            </defs>
            {spec.edges.map((e) => {
              const p = pos[e.from];
              const q = pos[e.to];
              if (!p || !q) return null;
              const dx = q.x - p.x;
              const dy = q.y - p.y;
              const len = Math.hypot(dx, dy) || 1;
              const R = 6.5; // node radius, so arrows land on the rim
              const x1 = p.x + (dx / len) * R;
              const y1 = p.y + (dy / len) * R;
              const x2 = q.x - (dx / len) * (R + 1.5);
              const y2 = q.y - (dy / len) * (R + 1.5);
              const dead = collapsed.has(e.from) || collapsed.has(e.to);
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={dead ? 'var(--wobo-ink-300)' : hue}
                  strokeWidth={0.8}
                  opacity={dead ? 0.35 : 0.85}
                  markerEnd={`url(#bio-arrow-${spec.id})`}
                />
              );
            })}
            {spec.nodes.map((n) => {
              const p = pos[n.id];
              if (!p) return null;
              const dead = collapsed.has(n.id);
              const isRemoved = removed === n.id;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG hit target can't be a real <button>
                <g
                  key={n.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => tap(n.id)}
                  role="button"
                  aria-label={`${n.label}${dead ? ' (collapsed)' : ''}`}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6.5}
                    fill={
                      isRemoved
                        ? 'var(--wobo-paper)'
                        : dead
                          ? 'var(--wobo-ink-100)'
                          : 'var(--wobo-paper)'
                    }
                    stroke={
                      isRemoved ? 'var(--wobo-feedback-retry)' : dead ? 'var(--wobo-ink-300)' : hue
                    }
                    strokeWidth={isRemoved ? 1.2 : 0.8}
                    strokeDasharray={dead && !isRemoved ? '1.5 1.5' : undefined}
                    opacity={dead ? 0.5 : 1}
                  />
                  <text
                    x={p.x}
                    y={p.y + 11}
                    textAnchor="middle"
                    fontSize={3.4}
                    fontWeight={600}
                    fill={dead ? 'var(--wobo-ink-500)' : 'var(--wobo-ink-900)'}
                    style={{ textDecoration: isRemoved ? 'line-through' : undefined }}
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </Stage>

        <div style={{ ...lead, ...captionSurface }}>
          {removed
            ? collapsedCount > 1
              ? `remove ${spec.nodes.find((n) => n.id === removed)?.label} and ${collapsedCount - 1} other ${collapsedCount - 1 === 1 ? 'organism loses' : 'organisms lose'} their food — energy stops flowing.`
              : `${spec.nodes.find((n) => n.id === removed)?.label} feeds nothing else here — tap another to trace the flow.`
            : (spec.caption ??
              'follow the arrows: each points from food to the organism that eats it.')}
        </div>
      </div>
    </CardBody>
  );
}

// ================================================================================================
// taxonomy — classify down the ranks
// ================================================================================================

function Taxonomy({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: BioTaxonomySpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const [step, setStep] = useState(0); // current rank the learner is on
  const [shake, setShake] = useState(0);
  const touchedRef = useRef(false);
  const done = step >= spec.ranks.length;

  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !done, onClick: onDone } });
  }, [done, setBar, onDone]);

  const bloomedRef = useRef(false);
  useEffect(() => {
    if (done && !bloomedRef.current) {
      bloomedRef.current = true;
      sfx.bloom();
    }
  }, [done]);

  const pick = (option: string) => {
    const rank = spec.ranks[step];
    if (!rank) return;
    if (!touchedRef.current) {
      touchedRef.current = true;
      sfx.tap();
    }
    if (option === rank.answer) {
      sfx.bloom();
      setStep((s) => s + 1);
    } else {
      sfx.wrong();
      setShake((s) => s + 1);
    }
  };

  const current = spec.ranks[step];

  const ref = useRegisterTarget<HTMLDivElement>(`bio-taxonomy-${spec.id}`, {
    kind: 'controls',
    label: `classifying ${spec.organism ?? 'the organism'} down the ranks`,
    getSceneState: () => ({
      organism: spec.organism,
      classified: spec.ranks.slice(0, step).map((r) => `${r.rank}: ${r.answer}`),
      currentRank: current?.rank ?? 'complete',
      done,
    }),
    getValidActions: () =>
      current ? current.options.map((o) => `choose ${o} for ${current.rank}`) : [],
    applyTutorAction: (patch: Record<string, unknown>) => {
      // Wobo advances by choosing the correct option for the current rank
      if (patch.choose !== undefined && current && str(patch.choose)) pick(patch.choose.trim());
      else if (patch.advance === true && current) pick(current.answer);
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `bio-taxonomy-${spec.id}`,
      steps: [
        ...(spec.organism ? [`organism: ${spec.organism}`] : []),
        ...spec.ranks.slice(0, step).map((r) => `${r.rank}: ${r.answer} ✓`),
        done ? 'fully classified' : `${current?.rank ?? ''} — choose`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, step, done, current]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={560}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>classify it — narrow down one rank at a time</div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={200} style={{ padding: 'clamp(14px, 3vw, 24px)' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              width: '100%',
              maxWidth: 320,
            }}
          >
            {spec.organism && (
              <div style={{ textAlign: 'center', ...whisper, marginBottom: 4 }}>
                {spec.organism}
              </div>
            )}
            {spec.ranks.map((r, i) => {
              const settled = i < step;
              const active = i === step;
              return (
                <div
                  key={r.rank}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    paddingLeft: i * 12,
                    opacity: settled || active ? 1 : 0.35,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: settled ? hue : 'var(--wobo-ink-300)',
                      flex: '0 0 auto',
                    }}
                  />
                  <div
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.1em',
                      color: 'var(--wobo-ink-500)',
                      minWidth: 62,
                    }}
                  >
                    {r.rank}
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--wobo-ink-900)' }}>
                    {settled ? r.answer : active ? '…' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </Stage>

        {current && (
          <motion.div
            key={`opts-${step}-${shake}`}
            animate={shake ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
            transition={{ duration: 0.4 }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}
          >
            <div style={{ ...whisper, width: '100%', textAlign: 'center' }}>
              which {current.rank}?
            </div>
            {current.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => pick(o)}
                style={{ ...chip, fontWeight: 600 }}
              >
                {o}
              </button>
            ))}
          </motion.div>
        )}

        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={revealBox}
            >
              {spec.organism ? `${spec.organism} — ` : ''}
              {spec.ranks.map((r) => r.answer).join(' › ')}. you walked the whole tree from{' '}
              {spec.ranks[0]?.rank} to {spec.ranks[spec.ranks.length - 1]?.rank}.
            </motion.div>
          )}
        </AnimatePresence>
        {!done && spec.caption && <div style={lead}>{spec.caption}</div>}
      </div>
    </CardBody>
  );
}

// ================================================================================================
// the engine entry — switches on kind
// ================================================================================================

export function BioScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: BioSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  switch (spec.kind) {
    case 'dragLabel':
      return <DragLabel spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
    case 'punnett':
      return <Punnett spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
    case 'foodWeb':
      return <FoodWeb spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
    case 'taxonomy':
      return <Taxonomy spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
  }
}

// --- hand-authored demos (prove the engine end to end; each passes parseBioScene) ------------------

export const BIO_DRAGLABEL_DEMO: BioDragLabelSpec = {
  kind: 'dragLabel',
  id: 'demo-plant-cell',
  title: 'the plant cell',
  figure: [
    { id: 'wall', shape: 'rect', x: 14, y: 8, w: 72, h: 46 },
    { id: 'membrane', shape: 'rect', x: 17, y: 11, w: 66, h: 40, filled: true },
    { id: 'nucleus', shape: 'circle', cx: 38, cy: 31, r: 8 },
    { id: 'vacuole', shape: 'ellipse', cx: 64, cy: 31, rx: 13, ry: 11 },
  ],
  labels: [
    { id: 'wall', text: 'cell wall', x: 20, y: 10, r: 8 },
    { id: 'nucleus', text: 'nucleus', x: 38, y: 31, r: 8 },
    { id: 'vacuole', text: 'vacuole', x: 64, y: 31, r: 9 },
    { id: 'membrane', text: 'cell membrane', x: 78, y: 48, r: 8 },
  ],
  caption: 'a plant cell has a rigid wall, a big central vacuole, and a nucleus.',
};

export const BIO_PUNNETT_DEMO: BioPunnettSpec = {
  kind: 'punnett',
  id: 'demo-monohybrid',
  title: 'a monohybrid cross',
  parentA: 'Bb',
  parentB: 'Bb',
  // authored answer matches the true cross (the gate proves it) — the engine recomputes anyway
  cells: ['BB', 'Bb', 'Bb', 'bb'],
  traitDominant: 'brown-eyed',
  traitRecessive: 'blue-eyed',
  caption: 'two heterozygous parents. fill each cell, then read the ratio.',
};

export const BIO_FOODWEB_DEMO: BioFoodWebSpec = {
  kind: 'foodWeb',
  id: 'demo-meadow',
  title: 'a meadow food web',
  nodes: [
    { id: 'grass', label: 'grass', x: 20, y: 50 },
    { id: 'rabbit', label: 'rabbit', x: 20, y: 16 },
    { id: 'grasshopper', label: 'grasshopper', x: 55, y: 50 },
    { id: 'frog', label: 'frog', x: 55, y: 16 },
    { id: 'fox', label: 'fox', x: 85, y: 33 },
  ],
  edges: [
    { from: 'grass', to: 'rabbit' },
    { from: 'grass', to: 'grasshopper' },
    { from: 'grasshopper', to: 'frog' },
    { from: 'rabbit', to: 'fox' },
    { from: 'frog', to: 'fox' },
  ],
  caption: 'remove the grass and watch how far the loss travels.',
};

export const BIO_TAXONOMY_DEMO: BioTaxonomySpec = {
  kind: 'taxonomy',
  id: 'demo-tiger',
  title: 'classifying the tiger',
  organism: 'tiger',
  ranks: [
    { rank: 'kingdom', answer: 'Animalia', options: ['Animalia', 'Plantae', 'Fungi'] },
    { rank: 'phylum', answer: 'Chordata', options: ['Chordata', 'Arthropoda'] },
    { rank: 'class', answer: 'Mammalia', options: ['Mammalia', 'Aves', 'Reptilia'] },
    { rank: 'order', answer: 'Carnivora', options: ['Carnivora', 'Primates', 'Rodentia'] },
    { rank: 'species', answer: 'tigris', options: ['tigris', 'leo', 'pardus'] },
  ],
  caption: 'narrow from all animals down to one species, rank by rank.',
};

export const BIO_DEMOS: BioSceneSpec[] = [
  BIO_DRAGLABEL_DEMO,
  BIO_PUNNETT_DEMO,
  BIO_FOODWEB_DEMO,
  BIO_TAXONOMY_DEMO,
];
