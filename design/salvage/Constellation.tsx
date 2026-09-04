'use client';

/**
 * The living constellation — the knowledge twin as hero art on a bright daylight field
 * (DESIGN.md §11). A day sky: a dust field of far suns in the subject hues, the
 * prerequisite graph as faint hairlines, and the learner's concepts as ultramarine stars.
 * Independent mastery glows with a halo and a cross flare; guided mastery is an unfilled ring;
 * unlit concepts wait as faint points. Stars breathe, a mote drifts the whole sky, and a
 * newly earned star replays its ignite once — light catching and running down its edges.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { hueForTopic } from '../../ui/hues';
import {
  EDGES,
  farStars,
  type PathStep,
  STARS,
  type Star,
  type StarState,
  starById,
  VIEW_H,
  VIEW_W,
} from './twin-data';

/** Ultramarine as mastery light — daylight register, ink-legible against white. */
const GLOW = 'var(--wobo-ultramarine)';

/** An earned star burns in its own subject's hue; ungrounded atom nodes keep ultramarine. */
function hueForStar(star: Star): string {
  return star.topicId ? hueForTopic(star.topicId) : GLOW;
}

/** Far suns in the subject hues — the skies of subjects still to come, light-legible. */
const DUST_HUES = [
  'rgba(92,94,102,0.26)',
  'rgba(92,94,102,0.26)',
  'rgba(31,53,224,0.3)',
  'rgba(15,163,177,0.3)',
  'rgba(240,160,48,0.35)',
  'rgba(204,30,122,0.26)',
];

interface Dust {
  x: number;
  y: number;
  r: number;
  fill: string;
  twinkle: boolean;
  dur: number;
  delay: number;
}

/** Deterministic dust field — the sky never reshuffles between visits. */
const DUST: Dust[] = (() => {
  let s = 20260706;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: 110 }, () => ({
    x: Math.round(rand() * VIEW_W * 10) / 10,
    y: Math.round(rand() * VIEW_H * 10) / 10,
    r: 0.4 + rand() * 1.1,
    fill: DUST_HUES[Math.floor(rand() * DUST_HUES.length)] as string,
    twinkle: rand() > 0.86,
    dur: 2.4 + rand() * 3.4,
    delay: rand() * 4,
  }));
})();

/** Pull a prerequisite line's endpoints in so it meets the star's halo, not its centre. */
function trimmed(from: Star, to: Star, by = 14) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < by * 2 + 4) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: from.x + ux * by,
    y1: from.y + uy * by,
    x2: to.x - ux * by,
    y2: to.y - uy * by,
  };
}

function StarCore({ star, state }: { star: Star; state: StarState }) {
  const hue = hueForStar(star);
  if (state === 'independent')
    return (
      <>
        <circle cx={star.x} cy={star.y} r={26} style={{ fill: 'url(#twin-halo)' }} />
        {/* the cross flare — a star that burns on its own, in its subject's hue */}
        <path
          d={`M ${star.x - 16} ${star.y} H ${star.x + 16} M ${star.x} ${star.y - 16} V ${star.y + 16}`}
          stroke={hue}
          strokeOpacity={0.4}
          strokeWidth={1}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx={star.x} cy={star.y} r={6} style={{ fill: hue }} />
        <circle cx={star.x} cy={star.y} r={2} style={{ fill: 'rgba(255,255,255,0.92)' }} />
      </>
    );
  if (state === 'supported')
    return (
      <>
        <circle
          cx={star.x}
          cy={star.y}
          r={10}
          style={{ fill: 'none', stroke: hue, strokeOpacity: 0.28, strokeWidth: 1.2 }}
        />
        <circle
          cx={star.x}
          cy={star.y}
          r={5}
          style={{ fill: '#FFFFFF', stroke: hue, strokeWidth: 1.8 }}
        />
      </>
    );
  return (
    <circle
      cx={star.x}
      cy={star.y}
      r={3.4}
      style={{ fill: '#FFFFFF', stroke: '#AEB2BE', strokeWidth: 1.2 }}
    />
  );
}

export function Constellation({
  states,
  ignited,
  selectedId,
  onSelect,
  path,
  pathReplay = 0,
}: {
  states: Record<string, StarState>;
  /** Star ids replaying their ignite on this mount — newly completed since last visit. */
  ignited: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The ordered study path to the selected star — lit on the sky when present. */
  path?: readonly PathStep[];
  /** Bump to replay the path's staggered draw. */
  pathReplay?: number;
}) {
  const reduced = useReducedMotion();
  const lit = (id: string) => (states[id] ?? 'unlit') !== 'unlit';

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-label="your knowledge constellation — every star is a concept"
    >
      <title>Your knowledge constellation</title>
      <defs>
        <radialGradient id="twin-halo">
          <stop offset="0%" style={{ stopColor: GLOW, stopOpacity: 0.18 }} />
          <stop offset="45%" style={{ stopColor: GLOW, stopOpacity: 0.08 }} />
          <stop offset="100%" style={{ stopColor: GLOW, stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      {/* tap the sky to put the card away — pointer convenience; the card's close button is the accessible path */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss duplicates the card's accessible close button */}
      <rect
        x={0}
        y={0}
        width={VIEW_W}
        height={VIEW_H}
        fill="transparent"
        onClick={() => onSelect(null)}
      />

      {/* the dust field — far suns in the subject hues, a handful twinkling */}
      <g style={{ pointerEvents: 'none' }}>
        {DUST.map((d) => (
          <circle
            key={`dust-${d.x}-${d.y}`}
            cx={d.x}
            cy={d.y}
            r={d.r}
            opacity={0.9}
            style={{ fill: d.fill }}
          >
            {d.twinkle && !reduced && (
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur={`${d.dur}s`}
                begin={`${d.delay}s`}
                repeatCount="indefinite"
              />
            )}
          </circle>
        ))}
      </g>

      {/* far stars — the chapters still to come (decorative, no accessible text) */}
      <g style={{ pointerEvents: 'none' }}>
        {farStars().map((f) => (
          <circle key={f.id} cx={f.x} cy={f.y} r={1.9} style={{ fill: 'rgba(31,53,224,0.16)' }} />
        ))}
      </g>

      {/* prerequisite lines — ink-strength on white; the earned stretch runs in the star's hue */}
      <g>
        {EDGES.map((e) => {
          const t = trimmed(e.from, e.to);
          const alive = lit(e.from.id) && lit(e.to.id);
          return (
            <line
              key={`${e.from.id}-${e.to.id}`}
              {...t}
              style={{
                stroke: alive
                  ? hueForStar(e.to)
                  : 'color-mix(in srgb, var(--wobo-ink) 22%, transparent)',
                strokeOpacity: alive ? 0.55 : 1,
              }}
              strokeWidth={alive ? 1.6 : 1.2}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      {/* one drifting mote — the sky is alive even when nothing happens */}
      {!reduced && (
        <motion.circle
          cx={0}
          cy={150}
          r={1.4}
          style={{ fill: 'rgba(31,53,224,0.55)' }}
          animate={{ x: [0, VIEW_W], y: [0, -36, 24, -14, 0], opacity: [0, 0.7, 0.7, 0.7, 0] }}
          transition={{ duration: 38, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
      )}

      {/* the stars — arriving staggered, then breathing */}
      {STARS.map((star, i) => {
        const state = states[star.id] ?? 'unlit';
        const isLit = state !== 'unlit';
        const selected = selectedId === star.id;
        const pick = () => onSelect(selected ? null : star.id);
        return (
          <motion.g
            key={star.id}
            role="button"
            tabIndex={0}
            aria-label={`${star.label} — ${BREATH_LABEL[state]}`}
            style={{ cursor: 'pointer' }}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.15 + i * 0.07, ease: 'easeOut' }}
            onClick={(e) => {
              e.stopPropagation();
              pick();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
              }
            }}
          >
            <motion.g
              animate={reduced ? undefined : { opacity: [0.82, 1, 0.82] }}
              transition={
                reduced
                  ? undefined
                  : {
                      duration: 4.8,
                      delay: i * 0.55,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'easeInOut',
                    }
              }
            >
              {/* generous invisible hit area */}
              <circle cx={star.x} cy={star.y} r={18} fill="transparent" />
              {selected && (
                <>
                  <circle
                    cx={star.x}
                    cy={star.y}
                    r={10}
                    style={{
                      fill: 'none',
                      stroke: 'color-mix(in srgb, var(--wobo-ink) 40%, transparent)',
                      strokeWidth: 0.75,
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* a calm ultramarine pulse marks the star in focus — meaning, not chrome */}
                  {!reduced && (
                    <motion.circle
                      cx={star.x}
                      cy={star.y}
                      style={{ fill: 'none', stroke: GLOW }}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      initial={{ r: 10, opacity: 0.5 }}
                      animate={{ r: [10, 15, 10], opacity: [0.5, 0, 0.5] }}
                      transition={{
                        duration: 2.6,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: 'easeInOut',
                      }}
                    />
                  )}
                </>
              )}
              {/* the core scales into being on a soft spring — the concept arriving as light */}
              <motion.g
                initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.2 + i * 0.07 }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                <StarCore star={star} state={state} />
              </motion.g>
              <text
                x={star.x}
                y={star.y + 24}
                textAnchor="middle"
                style={{
                  fill: isLit ? 'var(--wobo-ink-soft)' : 'var(--wobo-ink-300)',
                  fontSize: 11.5,
                  fontFamily: 'inherit',
                }}
              >
                {star.label}
              </text>
            </motion.g>
          </motion.g>
        );
      })}

      {/* the study path — the ordered way to the selected star, lit on the sky in sequence */}
      {path && path.length > 0 && (
        <PathLayer
          key={`path-${path[path.length - 1]?.star.id}-${pathReplay}`}
          path={path}
          reduced={!!reduced}
        />
      )}

      {/* constellation-ignite — a newly earned star catches light, once, ~750ms */}
      {!reduced &&
        Array.from(ignited).map((id) => {
          const star = starById(id);
          if (!star) return null;
          const rays = EDGES.filter((e) => e.from.id === id || e.to.id === id);
          return (
            <g key={`ignite-${id}`} style={{ pointerEvents: 'none' }}>
              <motion.circle
                cx={star.x}
                cy={star.y}
                style={{ fill: 'none', stroke: GLOW }}
                strokeWidth={1}
                initial={{ r: 4, opacity: 0.9 }}
                animate={{ r: 34, opacity: 0 }}
                transition={{ duration: 0.75, ease: 'easeOut' }}
              />
              {rays.map((e) => {
                const a = e.from.id === id ? e.from : e.to;
                const b = e.from.id === id ? e.to : e.from;
                return (
                  <motion.line
                    key={`ray-${e.from.id}-${e.to.id}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    style={{ stroke: GLOW }}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    initial={{ pathLength: 0, opacity: 0.9 }}
                    animate={{ pathLength: 1, opacity: 0 }}
                    transition={{
                      pathLength: { duration: 0.45, ease: 'easeOut' },
                      opacity: { delay: 0.45, duration: 0.3 },
                    }}
                  />
                );
              })}
            </g>
          );
        })}
    </svg>
  );
}

const BREATH_LABEL: Record<StarState, string> = {
  independent: 'yours, independently',
  supported: 'yours, with guidance',
  unlit: 'not started',
};

/**
 * The study path drawn on the sky: edges illuminate in step order (staggered draw), each
 * unmastered step wears a small numbered ultramarine badge, and mastered prerequisites are
 * faintly ticked — already lit, quietly skipped. Keyed by the parent so a replay remounts it.
 */
function PathLayer({ path, reduced }: { path: readonly PathStep[]; reduced: boolean }) {
  const inPath = new Set(path.map((p) => p.star.id));
  return (
    <g style={{ pointerEvents: 'none' }} aria-hidden>
      {path.map((p) => {
        if (p.mastered) {
          // already yours — a faint tick beside the star, no number, no wait
          const tx = p.star.x + 13;
          const ty = p.star.y - 13;
          return (
            <motion.g
              key={`tick-${p.star.id}`}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.08 }}
            >
              <circle
                cx={tx}
                cy={ty}
                r={7}
                style={{
                  fill: 'rgba(255,255,255,0.85)',
                  stroke: 'rgba(31,53,224,0.25)',
                  strokeWidth: 1,
                }}
              />
              <path
                d={`M ${tx - 3.1} ${ty} l 2.2 2.4 l 4 -4.7`}
                style={{ stroke: 'rgba(31,53,224,0.55)', fill: 'none' }}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.g>
          );
        }
        const n = p.step ?? 1;
        const delay = 0.15 + (n - 1) * 0.34;
        const incoming = EDGES.filter((e) => e.to.id === p.star.id && inPath.has(e.from.id));
        return (
          <g key={`step-${p.star.id}`}>
            {incoming.map((e) => (
              <motion.line
                key={`path-edge-${e.from.id}-${e.to.id}`}
                {...trimmed(e.from, e.to)}
                style={{ stroke: GLOW }}
                strokeWidth={1.4}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={reduced ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.7 }}
                transition={{
                  pathLength: { duration: 0.4, delay, ease: 'easeOut' },
                  opacity: { duration: 0.18, delay },
                }}
              />
            ))}
            <motion.g
              initial={reduced ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26, delay: delay + 0.32 }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <circle cx={p.star.x + 13} cy={p.star.y - 13} r={8} style={{ fill: GLOW }} />
              <text
                x={p.star.x + 13}
                y={p.star.y - 13}
                dy={3.4}
                textAnchor="middle"
                style={{ fill: '#FFFFFF', fontSize: 9.5, fontWeight: 650, fontFamily: 'inherit' }}
              >
                {n}
              </text>
            </motion.g>
          </g>
        );
      })}
    </g>
  );
}
