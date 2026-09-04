'use client';

/**
 * The report — a learner's honest read of themselves, scrolled below the twin. Not a dashboard:
 * strengths and growth areas drawn from real evidence (mastery states + per-node accuracy from the
 * event log + median latency from the mind), a thirty-day activity graph, and a plain-language
 * trajectory — "at this pace, all N are yours by <date>" — a simple linear pace, never astrology.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import { loadMind, medianLatencyMs } from '../../store/mind';
import { useSdk } from '../../store/sdk';
import { fluidType, Hairline, Reveal } from '../../ui/kit';
import { STARS, type Star, type StarState } from './twin-data';

const ULTRA = 'var(--wobo-ultramarine)';

// --- pure evidence math (kept testable) ----------------------------------------------------------

export interface Accuracy {
  nodeId: string;
  correct: number;
  total: number;
  ratio: number;
}

type Logged = { event_type: string; context: { ontology_node_id?: string }; payload: unknown };

/** Per-node correct/total from graded events — the raw material of strengths and growth. */
export function accuracyByNode(events: Logged[]): Map<string, Accuracy> {
  const acc = new Map<string, Accuracy>();
  for (const e of events) {
    if (
      e.event_type !== 'practice.item.answered.v1' &&
      e.event_type !== 'learn.attempt.submitted.v1'
    )
      continue;
    const nodeId = e.context.ontology_node_id;
    if (!nodeId) continue;
    const p = (e.payload ?? {}) as { correct?: unknown };
    const row = acc.get(nodeId) ?? { nodeId, correct: 0, total: 0, ratio: 0 };
    row.total += 1;
    if (p.correct === true) row.correct += 1;
    row.ratio = row.correct / row.total;
    acc.set(nodeId, row);
  }
  return acc;
}

export interface Trajectory {
  kind: 'none' | 'complete' | 'projected' | 'building';
  line: string;
  /** active days observed, for the sub-line */
  activeDays: number;
}

/** Days present in the activity ledger (any moment counts as an active day). */
function activeDayList(counts: Record<string, number>): string[] {
  return Object.keys(counts)
    .filter((d) => (counts[d] ?? 0) > 0)
    .sort();
}

function recentActiveDays(counts: Record<string, number>, now: number): number {
  let n = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    if ((counts[d] ?? 0) > 0) n += 1;
  }
  return n;
}

/**
 * A linear-pace projection: mastered so far over active days gives a per-active-day rate; the
 * recent week's cadence turns remaining active days into a calendar date. Honest, and labelled so.
 */
export function computeTrajectory(
  masteredCount: number,
  total: number,
  counts: Record<string, number>,
  now: number = Date.now(),
): Trajectory {
  const days = activeDayList(counts);
  const activeDays = days.length;
  if (masteredCount <= 0)
    return {
      kind: 'none',
      activeDays,
      line: 'Master your first concept and a trajectory appears here — no guesswork, just your pace.',
    };
  if (masteredCount >= total)
    return {
      kind: 'complete',
      activeDays,
      line: 'Every concept in this constellation is yours. The next chapter is where the sky grows.',
    };
  // Mastery exists but no day-level activity to pace from (e.g. seed/imported progress) — acknowledge
  // real progress instead of the empty-state line, which would contradict the "N of M" header above.
  if (activeDays === 0)
    return {
      kind: 'building',
      activeDays,
      line: `${masteredCount} of ${total} concepts are yours — keep a rhythm going and a finish date will appear here.`,
    };
  const pacePerActiveDay = masteredCount / activeDays;
  const remaining = total - masteredCount;
  const cadence = Math.max(1, recentActiveDays(counts, now)); // active days per week, floored at 1
  const remainingActiveDays = remaining / pacePerActiveDay;
  const calendarDays = Math.ceil(remainingActiveDays * (7 / cadence));
  const when = new Date(now + calendarDays * 86400000);
  const date = when.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return {
    kind: 'projected',
    activeDays,
    line: `At this pace, all ${total} concepts are yours by around ${date}.`,
  };
}

// --- the surface ---------------------------------------------------------------------------------

/** A thirty-day area of daily moments — the shape of showing up, drawn in as it scrolls into view. */
function ActivityGraph({ counts, now }: { counts: Record<string, number>; now: number }) {
  const reduced = useReducedMotion();
  const days = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const d = new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10);
        return counts[d] ?? 0;
      }),
    [counts, now],
  );
  const max = Math.max(1, ...days);
  const W = 300;
  const H = 60;
  const step = W / (days.length - 1);
  const pts = days.map((n, i) => [i * step, H - (n / max) * (H - 6) - 3] as const);
  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `0,${H} ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} ${W},${H}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label="your last thirty days of activity"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="rep-act" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ULTRA} stopOpacity={0.16} />
          <stop offset="100%" stopColor={ULTRA} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* the fill swells up from the baseline as the line draws across it */}
      <motion.polygon
        points={area}
        fill="url(#rep-act)"
        style={{ transformOrigin: '50% 100%' }}
        initial={reduced ? false : { opacity: 0, scaleY: 0.4 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ type: 'spring', stiffness: 120, damping: 22, delay: 0.1 }}
      />
      {/* the line traces itself left to right — the spring draw-in */}
      <motion.path
        d={linePath}
        fill="none"
        stroke={ULTRA}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={reduced ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ type: 'spring', stiffness: 55, damping: 20 }}
      />
    </svg>
  );
}

function AccuracyBar({ label, ratio, total }: { label: string; ratio: number; total: number }) {
  const reduced = useReducedMotion();
  const pct = Math.round(ratio * 100);
  const target = `${Math.max(4, pct)}%`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-900)' }}>{label}</span>
        <span style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-faint)', flexShrink: 0 }}>
          {pct}% · {total} tried
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: 'var(--wobo-tonal)',
          overflow: 'hidden',
        }}
      >
        {/* the fill springs out to its mark when the bar scrolls into view */}
        <motion.div
          initial={reduced ? false : { width: 0 }}
          whileInView={{ width: target }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
          style={{
            width: reduced ? target : undefined,
            height: '100%',
            borderRadius: 2,
            background:
              ratio >= 0.75 ? ULTRA : ratio >= 0.5 ? '#66B300' : 'var(--wobo-feedback-retry)',
          }}
        />
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--wobo-card)',
        border: '1px solid var(--wobo-card-border)',
        borderRadius: 3,
        padding: '18px 18px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

const eyebrow = {
  fontSize: fluidType.eyebrow,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: 'var(--wobo-ink-faint)',
};

export function ProgressReport({
  states,
  nameOf,
  mastered,
}: {
  states: Record<string, StarState>;
  nameOf: (star: Star) => string;
  mastered: number;
}) {
  const sdk = useSdk();
  const now = Date.now();

  const counts = useMemo<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('wobo-activity-counts-v1') ?? '{}');
    } catch {
      return {};
    }
  }, []);

  const acc = useMemo(() => accuracyByNode(sdk.events.getLog() as unknown as Logged[]), [sdk]);
  const medianSec = useMemo(() => {
    const m = medianLatencyMs(loadMind());
    return m ? Math.round(m / 1000) : undefined;
  }, []);

  const strengths = useMemo(() => STARS.filter((s) => states[s.id] === 'independent'), [states]);

  // growth: nodes with real attempts and sub-mastery accuracy, then supported stars — weakest first
  const growth = useMemo(() => {
    const scored = STARS.map((s) => {
      const a = s.nodeId ? acc.get(s.nodeId) : undefined;
      return { star: s, a, state: states[s.id] ?? 'unlit' };
    }).filter(
      (r) => r.state !== 'independent' && (r.a ? r.a.ratio < 0.85 : r.state === 'supported'),
    );
    return scored.sort((x, y) => (x.a?.ratio ?? 1) - (y.a?.ratio ?? 1)).slice(0, 4);
  }, [acc, states]);

  const trajectory = useMemo(
    () => computeTrajectory(mastered, STARS.length, counts, now),
    [mastered, counts, now],
  );

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '8px clamp(20px, 6vw, 48px) 96px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <Reveal>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div style={eyebrow}>Your report</div>
          <div
            style={{
              marginTop: 6,
              fontSize: fluidType.small,
              color: 'var(--wobo-ink-faint)',
            }}
          >
            Drawn from what you have actually done — not a guess
          </div>
        </div>
      </Reveal>

      {/* trajectory — the honest projection, given its own ultramarine-tinted stage */}
      <Reveal delay={0.04}>
        <div
          style={{
            background: 'var(--wobo-ultramarine-soft)',
            border: '1px solid var(--wobo-ultramarine-wash)',
            borderRadius: 3,
            padding: '20px 20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={eyebrow}>Trajectory</div>
          <div
            style={{
              fontSize: 'clamp(1.05rem, 2.4vw, 1.35rem)',
              fontWeight: 550,
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
              color: 'var(--wobo-ink-900)',
            }}
          >
            {trajectory.line}
          </div>
          {trajectory.kind === 'projected' && (
            <div style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-soft)' }}>
              based on {mastered} mastered across {trajectory.activeDays} active{' '}
              {trajectory.activeDays === 1 ? 'day' : 'days'} · a straight-line estimate, it moves as
              you do
            </div>
          )}
        </div>
      </Reveal>

      {/* strengths + growth, side by side where there's room */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        <Reveal delay={0.08}>
          <Panel>
            <div style={eyebrow}>Strengths</div>
            {strengths.length === 0 ? (
              <div
                style={{
                  fontSize: fluidType.small,
                  color: 'var(--wobo-ink-soft)',
                  lineHeight: 1.5,
                }}
              >
                Your first independent concept lands here — you are closer than it feels.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {strengths.slice(0, 5).map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: ULTRA,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-900)' }}>
                      {nameOf(s)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </Reveal>

        <Reveal delay={0.12}>
          <Panel>
            <div style={eyebrow}>Where to grow</div>
            {growth.length === 0 ? (
              <div
                style={{
                  fontSize: fluidType.small,
                  color: 'var(--wobo-ink-soft)',
                  lineHeight: 1.5,
                }}
              >
                Nothing shaky right now — practice a little to surface your next edge.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {growth.map((r) =>
                  r.a ? (
                    <AccuracyBar
                      key={r.star.id}
                      label={nameOf(r.star)}
                      ratio={r.a.ratio}
                      total={r.a.total}
                    />
                  ) : (
                    <div key={r.star.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          border: `1.25px solid ${ULTRA}`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-900)' }}>
                        {nameOf(r.star)}
                        <span style={{ color: 'var(--wobo-ink-faint)' }}> · with guidance</span>
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
          </Panel>
        </Reveal>
      </div>

      {/* the thirty-day shape of showing up */}
      <Reveal delay={0.16}>
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={eyebrow}>Last 30 days</div>
            {medianSec !== undefined && (
              <div style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-faint)' }}>
                ~{medianSec}s per answer
              </div>
            )}
          </div>
          <ActivityGraph counts={counts} now={now} />
          <Hairline />
          <div style={{ fontSize: fluidType.small, color: 'var(--wobo-ink-soft)' }}>
            Quiet days are part of it — the line only needs to keep coming back.
          </div>
        </Panel>
      </Reveal>
    </div>
  );
}
