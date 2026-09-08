'use client';

/**
 * ConceptMap — a concept map (DESIGN.md §9): a web of relationships drawn from the real graph,
 * structural not decorative. Nodes are laid out by a deterministic seeded layout, each is tappable,
 * and each registers as a Wobo target so Wobo can annotate ("this one connects back to…") on the
 * exact node. Tapping a node lights it and its relationships; the edges name how ideas connect.
 *
 * Spec-driven: the composer emits { nodes, edges, seed?, root? }. Registers a map-level scene target
 * Wobo can DRIVE — select a node to demonstrate a path (applyTutorAction) — plus a per-node ink
 * target each. Reduced-motion + mute aware; both themes; no new deps.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import { CardBody, captionSurface, cardTitle, lead, rgba, whisper } from '../screens/course/shared';
import { sfx } from '../ui/sound';

// --- The spec ------------------------------------------------------------------------------------

export interface ConceptNode {
  id: string;
  label: string;
}

export interface ConceptEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ConceptMapSpec {
  id: string;
  title: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  /** Deterministic layout seed — same spec draws the same map every time. */
  seed?: number;
  /** Optional centre node; if named it anchors the middle, the rest ring around it. */
  root?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Validate a generated concept map — malformed edges are dropped, an empty map is refused. */
export function parseConceptMapSpec(raw: unknown): ConceptMapSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const nodes = (Array.isArray(src.nodes) ? src.nodes : []).flatMap((n): ConceptNode[] => {
    if (!isRecord(n) || !str(n.id) || !str(n.label)) return [];
    return [{ id: n.id, label: n.label }];
  });
  if (nodes.length < 2 || nodes.length > 12) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(src.edges) ? src.edges : []).flatMap((e): ConceptEdge[] => {
    if (!isRecord(e) || !str(e.from) || !str(e.to)) return [];
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) return [];
    return [{ from: e.from, to: e.to, label: str(e.label) ? e.label : undefined }];
  });
  if (edges.length === 0) return null;
  return {
    id: str(src.id) ? src.id : 'conceptmap',
    title: str(src.title) ? src.title : 'how it connects',
    nodes,
    edges,
    seed: num(src.seed) ? src.seed : undefined,
    root: str(src.root) && ids.has(src.root) ? src.root : undefined,
  };
}

// --- Seeded layout (deterministic: same spec → same map) ------------------------------------------

interface Placed {
  id: string;
  label: string;
  x: number; // 0..100 (percent of the board)
  y: number; // 0..100
}

function layout(spec: ConceptMapSpec): Placed[] {
  const seed = spec.seed ?? 1;
  const rootId = spec.root;
  const ring = spec.nodes.filter((n) => n.id !== rootId);
  const placed: Placed[] = [];
  const clamp = (v: number) => Math.max(9, Math.min(91, v));
  if (rootId) {
    const r = spec.nodes.find((n) => n.id === rootId);
    if (r) placed.push({ id: r.id, label: r.label, x: 50, y: 50 });
  }
  const m = ring.length;
  const offset = (seed % 12) * ((2 * Math.PI) / 12);
  ring.forEach((n, i) => {
    // even ring when a root anchors the centre; a golden-angle spread otherwise (still deterministic)
    const angle = rootId
      ? -Math.PI / 2 + offset + (i * 2 * Math.PI) / Math.max(1, m)
      : offset + i * 2.399963; // golden angle
    const rad = rootId ? 1 : 0.55 + 0.45 * ((i + 1) / m);
    placed.push({
      id: n.id,
      label: n.label,
      x: clamp(50 + Math.cos(angle) * 40 * rad),
      y: clamp(50 + Math.sin(angle) * 36 * rad),
    });
  });
  return placed;
}

// --- A single node (its own ink target so Wobo can annotate the exact concept) ----------------------

function NodePill({
  node,
  hue,
  lit,
  dim,
  mapId,
  onTap,
}: {
  node: Placed;
  hue: string;
  lit: boolean;
  dim: boolean;
  mapId: string;
  onTap: () => void;
}) {
  const ref = useRegisterTarget<HTMLButtonElement>(`concept-${mapId}-${node.id}`, {
    kind: 'concept',
    label: `the concept "${node.label}"`,
  });
  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onTap}
      whileTap={{ scale: 0.95 }}
      animate={{ opacity: dim ? 0.4 : 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      style={{
        position: 'absolute',
        left: `${node.x}%`,
        top: `${node.y}%`,
        transform: 'translate(-50%, -50%)',
        padding: '6px 11px',
        maxWidth: 128,
        fontSize: '0.8rem',
        fontWeight: 540,
        lineHeight: 1.25,
        fontFamily: 'inherit',
        textAlign: 'center',
        color: lit ? 'var(--wobo-paper)' : 'var(--wobo-ink-900)',
        background: lit ? hue : 'var(--wobo-paper)',
        border: `1px solid ${lit ? hue : 'var(--wobo-hairline-on-paper-strong)'}`,
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'normal',
        boxShadow: lit ? `0 0 0 4px ${rgba(hue, 0.16)}` : 'none',
        transition: 'background 0.25s, color 0.25s, box-shadow 0.25s',
      }}
    >
      {node.label}
    </motion.button>
  );
}

export function ConceptMap({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: ConceptMapSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const [selected, setSelected] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());

  const placed = useMemo(() => layout(spec), [spec]);
  const posById = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  const select = (id: string) => {
    setSelected(id);
    setVisited((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    sfx.tap();
  };

  // the action bar — exploring one node unlocks continue
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: visited.size === 0, onClick: onDone } });
  }, [visited.size, setBar, onDone]);

  // incident edges + neighbours of the selected node
  const incident = spec.edges.filter((e) => e.from === selected || e.to === selected);
  const neighbours = new Set<string>();
  if (selected) {
    neighbours.add(selected);
    for (const e of incident) neighbours.add(e.from === selected ? e.to : e.from);
  }

  const applyTutorAction = (patch: Record<string, unknown>) => {
    if (typeof patch.select === 'string' && posById.has(patch.select)) select(patch.select);
  };
  const mapRef = useRegisterTarget<HTMLDivElement>(`conceptmap-${spec.id}`, {
    kind: 'diagram',
    label: `a concept map of ${spec.title}`,
    getSceneState: () => {
      const node = spec.nodes.find((n) => n.id === selected);
      return {
        title: spec.title,
        nodes: spec.nodes.map((n) => n.label).join(', '),
        selected: node ? node.label : 'nothing selected',
        connections: incident.map((e) => `${e.from} → ${e.to}${e.label ? ` (${e.label})` : ''}`),
      };
    },
    getValidActions: () => spec.nodes.map((n) => `select ${n.label}`),
    applyTutorAction,
  });

  useEffect(() => {
    const node = spec.nodes.find((n) => n.id === selected);
    bus.publishCanvas({
      nodeId: `conceptmap-${spec.id}`,
      steps: [
        spec.title,
        node ? `looking at: ${node.label}` : 'tap a concept to trace its links',
        `${incident.length} connections`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, selected, incident.length]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const selectedNode = spec.nodes.find((n) => n.id === selected) ?? null;

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>concept map — tap a node to trace how it connects</div>
        <div style={cardTitle}>{spec.title}</div>

        <div
          ref={mapRef}
          style={{
            position: 'relative',
            width: '100%',
            height: 320,
            background: rgba(hue, 0.05),
            borderRadius: 10,
            border: '0.5px solid var(--wobo-hairline-on-paper)',
            overflow: 'hidden',
          }}
        >
          {/* edges — behind the nodes; percent-space so lines meet the pills exactly */}
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            aria-hidden
          >
            <title>the links between concepts</title>
            {spec.edges.map((e, i) => {
              const a = posById.get(e.from);
              const b = posById.get(e.to);
              if (!a || !b) return null;
              const active = selected != null && (e.from === selected || e.to === selected);
              return (
                <line
                  // biome-ignore lint/suspicious/noArrayIndexKey: edges are positional
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? hue : 'var(--wobo-ink-300)'}
                  strokeWidth={active ? 0.9 : 0.5}
                  opacity={selected == null || active ? 1 : 0.35}
                  style={{ transition: 'stroke 0.25s, opacity 0.25s' }}
                />
              );
            })}
          </svg>

          {placed.map((n) => (
            <NodePill
              key={n.id}
              node={n}
              hue={hue}
              lit={selected === n.id}
              dim={selected != null && !neighbours.has(n.id)}
              mapId={spec.id}
              onTap={() => select(n.id)}
            />
          ))}
        </div>

        {/* the relationship read-out for the tapped node */}
        <AnimatePresence mode="wait">
          {selectedNode ? (
            <motion.div
              key={selectedNode.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              style={{
                border: '1px solid var(--wobo-feedback-correct)',
                background: 'var(--wobo-feedback-correctSoft)',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                color: 'var(--wobo-ink-900)',
              }}
            >
              <span style={{ ...whisper }}>{selectedNode.label}</span>
              {incident.length > 0 ? (
                incident.map((e, i) => {
                  const other = e.from === selected ? e.to : e.from;
                  const otherLabel = spec.nodes.find((n) => n.id === other)?.label ?? other;
                  const dir = e.from === selected ? '→' : '←';
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional relations
                      key={i}
                      style={{ fontSize: '0.98rem', lineHeight: 1.55 }}
                    >
                      <span style={{ color: hue, fontWeight: 560 }}>
                        {dir} {otherLabel}
                      </span>
                      {e.label ? ` — ${e.label}` : ''}
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: '0.98rem' }}>a standalone idea here — no links drawn.</div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="prompt"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                ...lead,
                ...captionSurface,
                color: 'var(--wobo-ink-900)',
              }}
            >
              tap any concept to light up everything it connects to.
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </CardBody>
  );
}

// --- A hand-authored demo (states of matter) — proves the engine end to end ------------------------

export const CONCEPTMAP_DEMO: ConceptMapSpec = {
  id: 'demo-matter',
  title: 'states of matter',
  root: 'matter',
  seed: 3,
  nodes: [
    { id: 'matter', label: 'matter' },
    { id: 'solid', label: 'solid' },
    { id: 'liquid', label: 'liquid' },
    { id: 'gas', label: 'gas' },
    { id: 'melt', label: 'melting' },
    { id: 'evap', label: 'evaporation' },
  ],
  edges: [
    { from: 'matter', to: 'solid', label: 'exists as' },
    { from: 'matter', to: 'liquid', label: 'exists as' },
    { from: 'matter', to: 'gas', label: 'exists as' },
    { from: 'solid', to: 'liquid', label: 'melting (add heat)' },
    { from: 'liquid', to: 'gas', label: 'evaporation (add heat)' },
    { from: 'solid', to: 'melt', label: 'happens by' },
    { from: 'liquid', to: 'evap', label: 'happens by' },
  ],
};
