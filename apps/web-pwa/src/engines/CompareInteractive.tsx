'use client';

/**
 * CompareInteractive — visual compare (DESIGN.md §9): animal cell vs plant cell, series vs parallel.
 * Two synced SVG panels side by side. Tap a part in either panel and its counterpart lights up in
 * BOTH panels while the difference (or correspondence) line surfaces below — correspondences and
 * differences shown, never tabulated.
 *
 * Spec-driven: the composer emits { left(label,marks), right(label,marks), links[] } where each link
 * ties a left mark to a right mark with a note. Registers as a Wobo scene target so Wobo can read
 * what's selected (getSceneState) and DRIVE the comparison — light a pairing to demonstrate
 * (applyTutorAction). Reduced-motion + mute aware; both themes; no new deps.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import { CardBody, captionSurface, cardTitle, lead, rgba, whisper } from '../screens/course/shared';
import { sfx } from '../ui/sound';

// --- The spec ------------------------------------------------------------------------------------

export interface CompareMark {
  id: string;
  shape: 'circle' | 'ring' | 'ellipse' | 'rect' | 'line' | 'text';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r?: number;
  rx?: number;
  ry?: number;
  w?: number;
  h?: number;
  text?: string;
  tone?: 'ink' | 'muted' | 'hue';
}

export interface CompareLink {
  id: string;
  /** A mark id in the left panel. */
  left: string;
  /** A mark id in the right panel. */
  right: string;
  /** The difference or correspondence, one line. */
  note: string;
  kind?: 'same' | 'diff';
}

export interface CompareSpec {
  id: string;
  title: string;
  left: { label: string; marks: CompareMark[] };
  right: { label: string; marks: CompareMark[] };
  links: CompareLink[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const SHAPES: ReadonlySet<string> = new Set(['circle', 'ring', 'ellipse', 'rect', 'line', 'text']);

function parseMark(raw: unknown): CompareMark | null {
  if (!isRecord(raw) || !str(raw.id) || typeof raw.shape !== 'string' || !SHAPES.has(raw.shape))
    return null;
  if (!num(raw.x) || !num(raw.y)) return null;
  return {
    id: raw.id,
    shape: raw.shape as CompareMark['shape'],
    x: raw.x,
    y: raw.y,
    x2: num(raw.x2) ? raw.x2 : undefined,
    y2: num(raw.y2) ? raw.y2 : undefined,
    r: num(raw.r) ? raw.r : undefined,
    rx: num(raw.rx) ? raw.rx : undefined,
    ry: num(raw.ry) ? raw.ry : undefined,
    w: num(raw.w) ? raw.w : undefined,
    h: num(raw.h) ? raw.h : undefined,
    text: str(raw.text) ? raw.text : undefined,
    tone: raw.tone === 'hue' ? 'hue' : raw.tone === 'muted' ? 'muted' : 'ink',
  };
}

function parsePanel(raw: unknown): { label: string; marks: CompareMark[] } | null {
  if (!isRecord(raw)) return null;
  const marks = (Array.isArray(raw.marks) ? raw.marks : [])
    .map(parseMark)
    .filter((m): m is CompareMark => m !== null);
  if (marks.length === 0) return null;
  return { label: str(raw.label) ? raw.label : '', marks };
}

/** Validate a generated compare spec — anything malformed is refused (caller falls back). */
export function parseCompareSpec(raw: unknown): CompareSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const left = parsePanel(src.left);
  const right = parsePanel(src.right);
  if (!left || !right) return null;
  const leftIds = new Set(left.marks.map((m) => m.id));
  const rightIds = new Set(right.marks.map((m) => m.id));
  const links = (Array.isArray(src.links) ? src.links : []).flatMap((l): CompareLink[] => {
    if (!isRecord(l) || !str(l.id) || !str(l.left) || !str(l.right) || !str(l.note)) return [];
    if (!leftIds.has(l.left) || !rightIds.has(l.right)) return [];
    return [
      {
        id: l.id,
        left: l.left,
        right: l.right,
        note: l.note,
        kind: l.kind === 'diff' ? 'diff' : 'same',
      },
    ];
  });
  if (links.length === 0) return null;
  return {
    id: str(src.id) ? src.id : 'compare',
    title: str(src.title) ? src.title : 'compare',
    left,
    right,
    links,
  };
}

// --- Rendering -------------------------------------------------------------------------------------

const VB_W = 62;
const VB_H = 64;

function toneStroke(tone: CompareMark['tone'], hue: string): string {
  return tone === 'hue' ? hue : tone === 'muted' ? 'var(--wobo-ink-300)' : 'var(--wobo-ink-700)';
}

function MarkShape({
  mark,
  hue,
  lit,
  tappable,
  onTap,
}: {
  mark: CompareMark;
  hue: string;
  lit: boolean;
  tappable: boolean;
  onTap?: () => void;
}) {
  const stroke = lit ? hue : toneStroke(mark.tone, hue);
  const sw = lit ? 1.8 : mark.tone === 'muted' ? 0.7 : 1.2;
  const fill = lit ? rgba(hue, 0.22) : mark.tone === 'hue' ? rgba(hue, 0.12) : 'none';
  const common = {
    stroke,
    strokeWidth: sw,
    style: { cursor: tappable ? 'pointer' : 'default', transition: 'stroke 0.25s, fill 0.3s' },
    onClick: onTap,
  } as const;
  switch (mark.shape) {
    case 'circle':
      return <circle cx={mark.x} cy={mark.y} r={mark.r ?? 4} fill={fill} {...common} />;
    case 'ring':
      return <circle cx={mark.x} cy={mark.y} r={mark.r ?? 20} fill="none" {...common} />;
    case 'ellipse':
      return (
        <ellipse
          cx={mark.x}
          cy={mark.y}
          rx={mark.rx ?? 10}
          ry={mark.ry ?? 7}
          fill={fill}
          {...common}
        />
      );
    case 'rect':
      return (
        <rect
          x={mark.x}
          y={mark.y}
          width={mark.w ?? 8}
          height={mark.h ?? 8}
          rx={1.5}
          fill={fill}
          {...common}
        />
      );
    case 'line':
      return (
        <line x1={mark.x} y1={mark.y} x2={mark.x2 ?? mark.x} y2={mark.y2 ?? mark.y} {...common} />
      );
    case 'text':
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: an SVG label tap-target, mirrors Discovery's mark taps
        <text
          x={mark.x}
          y={mark.y}
          fontSize={mark.r ?? 4.5}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={lit ? hue : 'var(--wobo-ink-700)'}
          style={{
            fontFamily: 'inherit',
            fontWeight: 540,
            cursor: tappable ? 'pointer' : 'default',
          }}
          onClick={onTap}
        >
          {mark.text}
        </text>
      );
    default:
      return null;
  }
}

function Panel({
  label,
  marks,
  hue,
  litIds,
  tapIds,
  onTap,
}: {
  label: string;
  marks: CompareMark[];
  hue: string;
  litIds: Set<string>;
  tapIds: Set<string>;
  onTap: (id: string) => void;
}) {
  return (
    <div
      style={{ flex: '1 1 160px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ ...whisper, textAlign: 'center' }}>{label}</div>
      <div
        style={{
          background: rgba(hue, 0.05),
          borderRadius: 10,
          padding: 8,
          border: '0.5px solid var(--wobo-hairline-on-paper)',
        }}
      >
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" role="img" aria-label={label}>
          {marks.map((m) => (
            <MarkShape
              key={m.id}
              mark={m}
              hue={hue}
              lit={litIds.has(m.id)}
              tappable={tapIds.has(m.id)}
              onTap={tapIds.has(m.id) ? () => onTap(m.id) : undefined}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

export function CompareInteractive({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: CompareSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  const selectLink = (id: string) => {
    const link = spec.links.find((l) => l.id === id);
    if (!link) return;
    setSelected(id);
    setRevealed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    sfx.tap();
    if (!revealed.has(id)) window.setTimeout(() => sfx.reveal(), 120);
  };

  const tapMark = (side: 'left' | 'right', markId: string) => {
    const link = spec.links.find((l) => (side === 'left' ? l.left : l.right) === markId);
    if (link) selectLink(link.id);
  };

  // the action bar — pairing one part unlocks continue
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: revealed.size === 0, onClick: onDone } });
  }, [revealed.size, setBar, onDone]);

  // Wobo reads the current pairing and can drive the comparison to demonstrate
  const applyTutorAction = (patch: Record<string, unknown>) => {
    if (typeof patch.select === 'string') selectLink(patch.select);
    else if (typeof patch.tap === 'string') {
      const link = spec.links.find((l) => l.left === patch.tap || l.right === patch.tap);
      if (link) selectLink(link.id);
    }
  };
  const ref = useRegisterTarget<HTMLDivElement>(`compare-${spec.id}`, {
    kind: 'diagram',
    label: `a side-by-side compare of ${spec.left.label} and ${spec.right.label}`,
    getSceneState: () => {
      const link = spec.links.find((l) => l.id === selected);
      return {
        left: spec.left.label,
        right: spec.right.label,
        selected: link ? link.note : 'nothing paired yet',
        paired: `${revealed.size} of ${spec.links.length}`,
      };
    },
    getValidActions: () => spec.links.map((l) => `pair: ${l.note}`),
    applyTutorAction,
  });

  useEffect(() => {
    const link = spec.links.find((l) => l.id === selected);
    bus.publishCanvas({
      nodeId: `compare-${spec.id}`,
      steps: [
        `${spec.left.label} vs ${spec.right.label}`,
        link ? link.note : 'tap a part to pair it across both',
        `paired ${revealed.size}/${spec.links.length}`,
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, selected, revealed.size]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const activeLink = spec.links.find((l) => l.id === selected) ?? null;
  const litLeft = new Set(activeLink ? [activeLink.left] : []);
  const litRight = new Set(activeLink ? [activeLink.right] : []);
  const tapLeft = new Set(spec.links.map((l) => l.left));
  const tapRight = new Set(spec.links.map((l) => l.right));

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>compare — tap a part to see it in both</div>
        <div style={cardTitle}>{spec.title}</div>

        <div ref={ref} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          <Panel
            label={spec.left.label}
            marks={spec.left.marks}
            hue={hue}
            litIds={litLeft}
            tapIds={tapLeft}
            onTap={(id) => tapMark('left', id)}
          />
          <Panel
            label={spec.right.label}
            marks={spec.right.marks}
            hue={hue}
            litIds={litRight}
            tapIds={tapRight}
            onTap={(id) => tapMark('right', id)}
          />
        </div>

        {/* the difference / correspondence line */}
        <AnimatePresence mode="wait">
          {activeLink ? (
            <motion.div
              key={activeLink.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              style={{
                border: `1px solid ${activeLink.kind === 'diff' ? hue : 'var(--wobo-feedback-correct)'}`,
                background:
                  activeLink.kind === 'diff' ? rgba(hue, 0.08) : 'var(--wobo-feedback-correctSoft)',
                borderRadius: 10,
                padding: '14px 16px',
                fontSize: '1.02rem',
                lineHeight: 1.6,
                color: 'var(--wobo-ink-900)',
              }}
            >
              <span style={{ ...whisper, display: 'block', marginBottom: 6 }}>
                {activeLink.kind === 'diff' ? 'where they differ' : 'the same part, both sides'}
              </span>
              {activeLink.note}
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
              tap any part in either panel — its match lights up in both, and I'll tell you what
              changes.
            </motion.div>
          )}
        </AnimatePresence>

        {/* progress dots — how many pairings found */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {spec.links.map((l) => (
            <div
              key={l.id}
              style={{
                height: 4,
                width: revealed.has(l.id) ? 20 : 8,
                borderRadius: 10,
                background: revealed.has(l.id) ? hue : 'var(--wobo-hairline-on-paper-strong)',
                transition: 'width 0.3s, background 0.3s',
              }}
            />
          ))}
        </div>
      </motion.div>
    </CardBody>
  );
}

// --- A hand-authored demo (animal vs plant cell) — proves the engine end to end --------------------

export const COMPARE_DEMO: CompareSpec = {
  id: 'demo-cells',
  title: 'animal cell vs plant cell',
  left: {
    label: 'animal cell',
    marks: [
      { id: 'a-membrane', shape: 'ellipse', x: 31, y: 32, rx: 26, ry: 22, tone: 'ink' },
      { id: 'a-nucleus', shape: 'circle', x: 31, y: 32, r: 7, tone: 'hue' },
      { id: 'a-cyto', shape: 'text', x: 31, y: 51, r: 4, text: 'cytoplasm', tone: 'muted' },
      { id: 'a-mito', shape: 'ellipse', x: 44, y: 24, rx: 4, ry: 2.4, tone: 'ink' },
    ],
  },
  right: {
    label: 'plant cell',
    marks: [
      { id: 'p-wall', shape: 'rect', x: 5, y: 10, w: 52, h: 44, tone: 'ink' },
      { id: 'p-membrane', shape: 'rect', x: 8, y: 13, w: 46, h: 38, tone: 'muted' },
      { id: 'p-nucleus', shape: 'circle', x: 20, y: 26, r: 6, tone: 'hue' },
      { id: 'p-vacuole', shape: 'rect', x: 30, y: 22, w: 20, h: 24, tone: 'ink' },
      { id: 'p-mito', shape: 'ellipse', x: 16, y: 44, rx: 4, ry: 2.4, tone: 'ink' },
    ],
  },
  links: [
    {
      id: 'nucleus',
      left: 'a-nucleus',
      right: 'p-nucleus',
      note: 'both have a nucleus — the control centre holding the DNA. This part is the same in both.',
      kind: 'same',
    },
    {
      id: 'wall',
      left: 'a-membrane',
      right: 'p-wall',
      note: 'the plant cell adds a rigid cell wall outside its membrane; the animal cell has only the membrane, so it has no fixed shape.',
      kind: 'diff',
    },
    {
      id: 'vacuole',
      left: 'a-cyto',
      right: 'p-vacuole',
      note: 'the plant cell has one large central vacuole storing water and holding the cell firm; the animal cell has only small ones, if any.',
      kind: 'diff',
    },
    {
      id: 'mito',
      left: 'a-mito',
      right: 'p-mito',
      note: 'both burn food for energy in mitochondria — another part they share.',
      kind: 'same',
    },
  ],
};
