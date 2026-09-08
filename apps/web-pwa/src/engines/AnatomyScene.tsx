'use client';

/**
 * AnatomyScene — the 3D biology rung (SUBJECTS.md §5-biology). The model authors a small set of
 * LABELLED primitive parts (sphere / cylinder / box / torus / lathe), each positioned, scaled and
 * coloured in a shared 3D space. The learner rotates the whole model (hand-rolled pointer drag),
 * taps a part to highlight it and read its label + description, and — when the spec carries a quiz —
 * is asked to "tap the aorta" until every prompt is found.
 *
 * DOCTRINE: the spec is the IR. parseAnatomyScene is a pure, structural gate that mirrors the gateway
 * `_ok_anatomy` gate exactly (client parity); a malformed part is dropped, a malformed scene returns
 * null so the caller falls back — never a throw.
 *
 * DEGRADES INVISIBLY: the heavy three + @react-three/fiber bundle is behind React.lazy and only ever
 * loads when an anatomy card renders AND WebGL is available. With no WebGL (or while three loads) the
 * learner gets a real, tappable 2D SVG projection of the same parts — selection, description and the
 * quiz all keep working. 3D is pure enhancement, never a dependency for the lesson.
 *
 * Wobo reads the same scene state (getSceneState) and can DRIVE it — highlight a named part
 * (applyTutorAction). Both themes (scene bg + lights bound to the paper/theme), reduced-motion
 * (no idle auto-spin), mute-safe sfx.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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

const AnatomyCanvas = lazy(() => import('./AnatomyCanvas'));

// --- the spec ------------------------------------------------------------------------------------

export type AnatomyShape = 'sphere' | 'cylinder' | 'box' | 'torus' | 'lathe';

export interface AnatomyPart {
  id: string;
  label: string;
  description?: string;
  shape: AnatomyShape;
  /** Centre in the shared 3D space (world units, model roughly fits a 4-unit cube). */
  position: [number, number, number];
  /** Uniform scale (number) or per-axis [x, y, z]. */
  scale: number | [number, number, number];
  rotation?: [number, number, number];
  /** A CSS hex colour, #rgb or #rrggbb. */
  color: string;
  /** Lathe profile — (x, y) points revolved around the y-axis. Required iff shape === 'lathe'. */
  profile?: [number, number][];
}

export interface AnatomyQuizItem {
  /** The part the learner must tap. */
  partId: string;
  /** The ask, e.g. "tap the aorta". */
  prompt: string;
}

export interface AnatomyScene {
  id: string;
  kind: 'anatomy';
  title: string;
  caption?: string;
  /** What the model is, e.g. "heart" — shown as a quiet subtitle. */
  model?: string;
  parts: AnatomyPart[];
  quiz?: AnatomyQuizItem[];
}

// --- validation (mirrors the gateway `_ok_anatomy` gate; a spec that cannot render returns null) ---

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SHAPES: ReadonlySet<string> = new Set(['sphere', 'cylinder', 'box', 'torus', 'lathe']);

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [a, b, c] = v;
  return num(a) && num(b) && num(c) ? [a, b, c] : null;
}

function parsePart(raw: unknown): AnatomyPart | null {
  if (!isRecord(raw)) return null;
  const { id, label, shape, color } = raw;
  if (!str(id) || !IDENT_RE.test(id) || !str(label)) return null;
  if (typeof shape !== 'string' || !SHAPES.has(shape)) return null;
  if (!str(color) || !HEX_RE.test(color.trim())) return null;
  const position = vec3(raw.position);
  if (!position) return null;
  // scale: a positive number, or a 3-vector of positive numbers
  let scale: number | [number, number, number];
  if (num(raw.scale) && raw.scale > 0) {
    scale = raw.scale;
  } else {
    const s = vec3(raw.scale);
    if (!s || s.some((n) => n <= 0)) return null;
    scale = s;
  }
  const rotation = raw.rotation === undefined ? undefined : (vec3(raw.rotation) ?? undefined);
  if (raw.rotation !== undefined && !rotation) return null;
  // a lathe MUST carry a valid revolve profile (≥2 points), else it renders as nothing
  let profile: [number, number][] | undefined;
  if (shape === 'lathe') {
    if (!Array.isArray(raw.profile) || raw.profile.length < 2) return null;
    const pts: [number, number][] = [];
    for (const p of raw.profile) {
      if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) return null;
      pts.push([p[0], p[1]]);
    }
    profile = pts;
  }
  return {
    id,
    label: label.trim(),
    description: str(raw.description) ? raw.description.trim() : undefined,
    shape: shape as AnatomyShape,
    position,
    scale,
    rotation,
    color: color.trim(),
    profile,
  };
}

/** Validate a generated anatomy scene. Structural only; a malformed scene returns null (client parity). */
export function parseAnatomyScene(raw: unknown): AnatomyScene | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (src.verified === false) return null;
  if (src.kind !== 'anatomy') return null;

  const parts = (Array.isArray(src.parts) ? src.parts : [])
    .map(parsePart)
    .filter((p): p is AnatomyPart => p !== null)
    .slice(0, 24);
  if (parts.length < 1) return null;
  const ids = new Set(parts.map((p) => p.id));
  if (ids.size !== parts.length) return null; // duplicate part ids would make selection ambiguous

  // quiz items must reference parts that actually exist (else "tap the aorta" is unwinnable)
  let quiz: AnatomyQuizItem[] | undefined;
  if (Array.isArray(src.quiz)) {
    const items: AnatomyQuizItem[] = [];
    for (const q of src.quiz) {
      if (!isRecord(q) || !str(q.partId) || !str(q.prompt) || !ids.has(q.partId)) return null;
      items.push({ partId: q.partId, prompt: q.prompt.trim() });
    }
    quiz = items.length ? items : undefined;
  }

  return {
    id: str(src.id) ? src.id : 'anatomy',
    kind: 'anatomy',
    title: str(src.title) ? src.title : 'anatomy',
    caption: str(src.caption) ? src.caption : undefined,
    model: str(src.model) ? src.model : undefined,
    parts,
    quiz,
  };
}

/** Resolve a part by name (id or case-insensitive label match) — the seam Wobo drives through. */
export function resolvePartByName(spec: AnatomyScene, name: string): string | null {
  const q = name.trim().toLowerCase();
  const byId = spec.parts.find((p) => p.id.toLowerCase() === q);
  if (byId) return byId.id;
  const byLabel = spec.parts.find((p) => p.label.toLowerCase() === q);
  if (byLabel) return byLabel.id;
  const partial = spec.parts.find((p) => p.label.toLowerCase().includes(q));
  return partial ? partial.id : null;
}

// --- WebGL probe + theme read --------------------------------------------------------------------

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

/** Read the current paper colour + dark flag so the 3D scene's bg + lights follow the theme. */
function readTheme(): { bg: string; dark: boolean } {
  if (typeof document === 'undefined') return { bg: '#ffffff', dark: false };
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bg = cs.getPropertyValue('--wobo-paper').trim() || '#ffffff';
  const attr = root.getAttribute('data-theme');
  const dark =
    attr === 'dark' ||
    (attr !== 'light' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  return { bg, dark };
}

// --- the static 2D fallback (no WebGL, or while three loads) — a real, tappable projection --------

const SVG_W = 300;
const SVG_H = 220;

function projectRadius(scale: number | [number, number, number]): number {
  const s = typeof scale === 'number' ? scale : Math.max(scale[0], scale[1], scale[2]);
  return Math.max(8, Math.min(40, s * 16));
}

function StaticParts({
  parts,
  selectedId,
  onSelect,
}: {
  parts: AnatomyPart[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // project the model onto the x/y plane (z ignored); the model roughly fits a 4-unit cube
  const cx = (x: number) => SVG_W / 2 + (x / 4) * (SVG_W * 0.4);
  const cy = (y: number) => SVG_H / 2 - (y / 4) * (SVG_H * 0.42);
  // draw far parts first so nearer (higher z) sit on top
  const ordered = [...parts].sort((a, b) => a.position[2] - b.position[2]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG can't be a real <fieldset>
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width="100%"
      style={{ maxHeight: 260 }}
      role="group"
      aria-label="anatomy model — tap a part"
    >
      <title>anatomy model</title>
      {ordered.map((p) => {
        const x = cx(p.position[0]);
        const y = cy(p.position[1]);
        const r = projectRadius(p.scale);
        const sel = p.id === selectedId;
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG hit target can't be a real <button>
          <g
            key={p.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(p.id)}
            role="button"
            aria-label={p.label}
          >
            <circle
              cx={x}
              cy={y}
              r={r}
              fill={p.color}
              fillOpacity={sel ? 0.95 : 0.7}
              stroke={sel ? 'var(--wobo-ink-900)' : 'var(--wobo-hairline-on-paper-strong)'}
              strokeWidth={sel ? 2 : 0.75}
            />
            <text x={x} y={y + r + 11} textAnchor="middle" fontSize={9} fill="var(--wobo-ink-700)">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// --- the engine ----------------------------------------------------------------------------------

export function AnatomyScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: AnatomyScene;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const bus = useWoboBus();
  // probe WebGL + theme once (client-only; safe defaults for SSR)
  const webgl = useMemo(hasWebGL, []);
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    // keep the 3D bg/lights in step if the learner flips the theme mid-lesson
    setTheme(readTheme());
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(readTheme());
    mq.addEventListener?.('change', on);
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener?.('change', on);
      obs.disconnect();
    };
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [quizIdx, setQuizIdx] = useState(0);
  const quiz = spec.quiz ?? [];
  const quizActive = quiz.length > 0;
  const quizDone = quizIdx >= quiz.length;
  const currentQuiz = quizActive && !quizDone ? quiz[quizIdx] : undefined;

  const selected = spec.parts.find((p) => p.id === selectedId);

  const firstTap = useRef(true);
  const select = (id: string) => {
    setTouched(true);
    setSelectedId(id);
    if (firstTap.current) {
      firstTap.current = false;
      sfx.tap();
    }
    // quiz scoring: right part → advance + bloom, wrong → gentle wrong
    if (currentQuiz) {
      if (id === currentQuiz.partId) {
        sfx.bloom();
        setQuizIdx((i) => i + 1);
      } else {
        sfx.wrong();
      }
    }
  };

  // continue: gated behind finishing the quiz when there is one, else the first tap unlocks it
  const canContinue = quizActive ? quizDone : touched;
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !canContinue, onClick: onDone } });
  }, [canContinue, setBar, onDone]);

  const doneRef = useRef(false);
  useEffect(() => {
    if (quizActive && quizDone && !doneRef.current) {
      doneRef.current = true;
      sfx.bloom();
    }
  }, [quizActive, quizDone]);

  // --- Wobo: reads the live selection + quiz, and can highlight a named part ----------------------
  const ref = useRegisterTarget<HTMLDivElement>(`anatomy-${spec.id}`, {
    kind: 'diagram',
    label: `the 3D model of ${spec.model ?? spec.title}`,
    getSceneState: () => ({
      model: spec.model ?? spec.title,
      parts: spec.parts.map((p) => p.label),
      selected: selected ? selected.label : null,
      rendered3d: webgl,
      ...(quizActive
        ? {
            quiz: quizDone ? 'complete' : (currentQuiz?.prompt ?? null),
            quizProgress: `${quizIdx}/${quiz.length}`,
          }
        : {}),
    }),
    getValidActions: () => spec.parts.map((p) => `highlight the ${p.label}`),
    applyTutorAction: (patch: Record<string, unknown>) => {
      const name = str(patch.highlight)
        ? patch.highlight
        : str(patch.partId)
          ? patch.partId
          : str(patch.part)
            ? patch.part
            : null;
      if (name) {
        const id = resolvePartByName(spec, name);
        if (id) {
          setTouched(true);
          setSelectedId(id);
        }
      }
    },
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `anatomy-${spec.id}`,
      steps: [
        `model: ${spec.model ?? spec.title}`,
        `parts: ${spec.parts.map((p) => p.label).join(', ')}`,
        selected ? `looking at: ${selected.label}` : 'drag to rotate, tap a part',
        ...(quizActive ? [quizDone ? 'quiz complete' : `find: ${currentQuiz?.prompt ?? ''}`] : []),
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, selected, quizActive, quizDone, currentQuiz]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  return (
    <CardBody maxWidth={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={whisper}>
          {quizActive
            ? 'find it — drag to turn the model, tap the right part'
            : 'explore — drag to turn it, tap a part to name it'}
        </div>
        <div style={cardTitle}>{spec.title}</div>
        {spec.model && <div style={whisper}>{spec.model}</div>}

        <Stage hue={hue} tint={0.05} minHeight={280} style={{ padding: 0, overflow: 'hidden' }}>
          <div ref={ref} style={{ width: '100%', height: 300, position: 'relative' }}>
            {webgl ? (
              <Suspense
                fallback={
                  <StaticParts parts={spec.parts} selectedId={selectedId} onSelect={select} />
                }
              >
                <AnatomyCanvas
                  parts={spec.parts}
                  selectedId={selectedId}
                  onSelect={select}
                  hue={hue}
                  bg={theme.bg}
                  dark={theme.dark}
                />
              </Suspense>
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <StaticParts parts={spec.parts} selectedId={selectedId} onSelect={select} />
              </div>
            )}
          </div>
        </Stage>

        {/* the quiz prompt — the ask that gates continue */}
        {quizActive && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={quizDone ? 'done' : quizIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={
                reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 28 }
              }
              style={{
                ...lead,
                ...captionSurface,
                color: 'var(--wobo-ink-900)',
              }}
            >
              {quizDone
                ? 'found them all — you can name every part now.'
                : (currentQuiz?.prompt ?? '')}
            </motion.div>
          </AnimatePresence>
        )}

        {/* tappable part chips — the always-available interaction, works with or without WebGL */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {spec.parts.map((p) => {
            const sel = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 12px',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  color: sel ? 'var(--wobo-paper)' : 'var(--wobo-ink-900)',
                  background: sel ? 'var(--wobo-ink-900)' : 'var(--wobo-paper)',
                  border: sel
                    ? '0.5px solid var(--wobo-ink-900)'
                    : '0.5px solid var(--wobo-hairline-on-paper-strong)',
                  borderRadius: 'var(--wobo-radius-sm)',
                  cursor: 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: p.color,
                    flex: '0 0 auto',
                  }}
                />
                {p.label}
              </button>
            );
          })}
        </div>

        {/* the selected part's name + description */}
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={
                reduced ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 28 }
              }
              style={{
                border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
                borderRadius: 'var(--wobo-radius-md)',
                padding: '14px 16px',
                background: 'var(--wobo-paper)',
              }}
            >
              <div style={{ fontSize: '1.1rem', fontWeight: 560, color: 'var(--wobo-ink-900)' }}>
                {selected.label}
              </div>
              {selected.description && (
                <div style={{ ...lead, marginTop: 6 }}>{selected.description}</div>
              )}
            </motion.div>
          ) : (
            spec.caption && (
              <motion.div
                key="caption"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={lead}
              >
                {spec.caption}
              </motion.div>
            )
          )}
        </AnimatePresence>
      </div>
    </CardBody>
  );
}

// --- hand-authored demos (prove the engine end to end; pass parseAnatomyScene) --------------------

export const ANATOMY_HEART_DEMO: AnatomyScene = {
  id: 'demo-heart',
  kind: 'anatomy',
  title: 'the human heart',
  model: 'heart',
  caption: 'four chambers and the great vessels — drag to turn it, tap each part to name it.',
  parts: [
    {
      id: 'leftVentricle',
      label: 'left ventricle',
      description: 'the thick-walled pump that drives oxygen-rich blood out to the whole body.',
      shape: 'sphere',
      position: [-0.7, -0.8, 0],
      scale: [1.1, 1.4, 1.1],
      color: '#C0392B',
    },
    {
      id: 'rightVentricle',
      label: 'right ventricle',
      description: 'pushes oxygen-poor blood the short way to the lungs, so its wall is thinner.',
      shape: 'sphere',
      position: [0.7, -0.7, 0],
      scale: [1.0, 1.2, 1.0],
      color: '#2E6BB8',
    },
    {
      id: 'leftAtrium',
      label: 'left atrium',
      description:
        'receives oxygen-rich blood back from the lungs before it drops to the ventricle.',
      shape: 'sphere',
      position: [-0.8, 0.9, 0.2],
      scale: 0.7,
      color: '#E07A5F',
    },
    {
      id: 'rightAtrium',
      label: 'right atrium',
      description: 'collects oxygen-poor blood returning from the body.',
      shape: 'sphere',
      position: [0.8, 0.95, 0.2],
      scale: 0.7,
      color: '#5B8DD6',
    },
    {
      id: 'aorta',
      label: 'aorta',
      description:
        'the body’s largest artery — it arches up and away, carrying blood to everywhere.',
      shape: 'torus',
      position: [-0.1, 1.7, 0],
      scale: 0.6,
      rotation: [1.4, 0, 0.3],
      color: '#D64550',
    },
  ],
  quiz: [
    { partId: 'aorta', prompt: 'tap the aorta — the great artery leaving the heart.' },
    { partId: 'leftVentricle', prompt: 'now tap the left ventricle — the strongest pump.' },
  ],
};

export const ANATOMY_CELL_DEMO: AnatomyScene = {
  id: 'demo-cell',
  kind: 'anatomy',
  title: 'an animal cell',
  model: 'animal cell',
  caption: 'the organelles inside one cell — tap each to see what it does.',
  parts: [
    {
      id: 'membrane',
      label: 'cell membrane',
      description: 'the thin boundary that decides what enters and leaves the cell.',
      shape: 'sphere',
      position: [0, 0, 0],
      scale: 2.0,
      color: '#66B300',
    },
    {
      id: 'nucleus',
      label: 'nucleus',
      description: 'the control centre — it holds the DNA that runs the cell.',
      shape: 'sphere',
      position: [0.3, 0.2, 0.3],
      scale: 0.7,
      color: '#7A4FB8',
    },
    {
      id: 'mitochondrion',
      label: 'mitochondrion',
      description: 'the powerhouse — it releases energy the cell can use.',
      shape: 'cylinder',
      position: [-0.9, -0.6, 0.4],
      scale: [0.28, 0.55, 0.28],
      rotation: [0, 0, 0.7],
      color: '#E8881A',
    },
    {
      id: 'vacuole',
      label: 'vacuole',
      description: 'a small storage sac for water and nutrients.',
      shape: 'sphere',
      position: [0.9, -0.7, 0.2],
      scale: 0.45,
      color: '#2E9CCC',
    },
  ],
};

export const ANATOMY_DEMOS: AnatomyScene[] = [ANATOMY_HEART_DEMO, ANATOMY_CELL_DEMO];
