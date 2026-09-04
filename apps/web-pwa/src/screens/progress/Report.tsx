'use client';

/**
 * THE REPORT — what a parent actually reads.
 *
 * design/prototypes/landing-v8.html promises a parent four things in its parents section: numbers
 * that count up, bars that grow, a projection line, and badges. A promise on the site that the app
 * does not keep is the worst bug this repo can ship, so this screen keeps all four — and keeps them
 * from the learner's own record or not at all.
 *
 *   the numbers      minutes actually spent, topics actually behind them, and how many answers came
 *                    back right a week or more after the first on their concept. Each counts up
 *                    from zero on arrival, exactly as the page does. Each is named for what it
 *                    counts: "topics learnt" says when its denominator is only the chapters opened
 *                    so far, and the third is "right a week on" rather than "held a week later",
 *                    because nothing in the arithmetic requires a week without practice.
 *   the bars         minutes a day, one bar a day. A day still to come is quiet, never a zero.
 *   the line         topics learnt against time, solid across the stretch that has happened and
 *                    dashed across the stretch that has not, ending on the date this pace reaches.
 *                    Drawn ONLY when there is a pace to read; otherwise the empty state says why.
 *   the badges       behaviour the ledger actually holds, and milestones actually crossed.
 *
 * Every label names a value the chart reaches: the axis mark is the tallest bar, the endpoint is
 * the projection's own date, the percentage is the one the ratio computes. Nothing is a constant,
 * nothing is decorative, and no learner's name appears anywhere on it (DESIGN.md §0, the copy law).
 */

import { type CSSProperties, type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import { useMotionPref } from '../../ui/motion';
import { Segmented, useMediaQuery, WoboHead } from '../../ui/primitives';
import { type Span, type WeekSummary, word } from '../you/week';
import {
  type ChapterRow,
  type MinuteBar,
  type ProgressTopic,
  type Projection,
  peakMinutes,
  type RetentionRead,
  reportNote,
  STATE_WORDS,
  type Tally,
  totalMinutes,
} from './evidence';
import './progress.css';

const SPANS = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
] as const;

const SPAN_HEAD: Record<Span, string> = {
  week: 'This week',
  month: 'This month',
  year: 'This year',
};

/** A badge is a fact the ledger holds. `mark` says which of the three it is, and why. */
export type BadgeMark = 'held' | 'earned' | 'rhythm';

export interface ReportBadge {
  id: string;
  title: string;
  mark: BadgeMark;
}

function BadgeMarkIcon({ mark }: { mark: BadgeMark }) {
  if (mark === 'held')
    return (
      <svg viewBox="0 0 16 16" stroke="var(--mint)" aria-hidden="true">
        <path d="M2 8 l4 4 l8 -10" />
      </svg>
    );
  if (mark === 'earned')
    return (
      <svg viewBox="0 0 16 16" stroke="var(--marigold)" aria-hidden="true">
        <path d="M8 1 l2 5 l5 .4 l-4 3.4 l1.3 5 l-4.3 -3 l-4.3 3 l1.3 -5 l-4 -3.4 l5 -.4 z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" stroke="var(--pig)" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4 v4 l3 2" />
    </svg>
  );
}

/**
 * A number that counts up to itself.
 *
 * It writes into the element rather than through state: three numbers counting at sixty frames a
 * second would otherwise re-render the whole report a hundred and sixty times for an effect worth
 * under a second. The layout effect runs before paint, so the number is never seen at its final
 * value and then yanked back to zero, and a learner who asked for less motion simply gets the
 * number, already there.
 */
function useCountTo(value: number, still: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = String(value);
    if (still || value <= 0) return;
    const duration = 900;
    const start = performance.now();
    let raf = 0;
    el.textContent = '0';
    const step = (at: number) => {
      const p = Math.min(1, (at - start) / duration);
      el.textContent = String(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, still]);
  return ref;
}

function Counted({ value, still }: { value: number; still: boolean }) {
  const ref = useCountTo(value, still);
  // The value is rendered too, so the number is right before a frame ever runs and right again
  // wherever no frame ever will (a still-frame preference, a print, a snapshot test).
  return <span ref={ref}>{value}</span>;
}

function Kpi({ label, children, note }: { label: string; children?: ReactNode; note: ReactNode }) {
  return (
    <div className="wp-kpi">
      <span>{label}</span>
      {children ? <b>{children}</b> : null}
      <em>{note}</em>
    </div>
  );
}

/**
 * A learner who asked for still frames, EITHER WAY.
 *
 * `useMotionPref` is the app's own switch and stamps `data-motion="reduce"`, which the stylesheet
 * reads; the operating system's own setting never touches it. Every animation in `progress.css` is
 * guarded on both, and so is every one driven from here — otherwise a learner who set the
 * preference on their phone rather than in Wobo would still get numbers spinning at them.
 */
function useStill(): boolean {
  const app = useMotionPref();
  const os = useMediaQuery('(prefers-reduced-motion: reduce)');
  return app || os;
}

/** The projection, drawn: topics learnt against time, and where this pace carries them. */
function ProjectionChart({ projection, now }: { projection: Projection; now: number }) {
  const geometry = useMemo(() => {
    const { from, at, total, learnt } = projection;
    if (projection.kind !== 'projected' || from === undefined || at === undefined) return null;
    if (!(at > from) || total <= 0) return null;
    const W = 460;
    const H = 132;
    const x0 = 16;
    const x1 = W - 16;
    const yBase = H - 20;
    const yTop = 18;
    const xOf = (t: number) => x0 + ((t - from) / (at - from)) * (x1 - x0);
    const yOf = (n: number) => yBase - (n / total) * (yBase - yTop);
    const xNow = xOf(Math.max(from, Math.min(now, at)));
    const yNow = yOf(learnt);
    return {
      W,
      H,
      x0,
      x1,
      yBase,
      xNow,
      yNow,
      yEnd: yOf(total),
      // the drawn length of the observed stretch, so it can draw itself on without a library
      length: Math.round(Math.hypot(xNow - x0, yNow - yBase)),
    };
  }, [projection, now]);

  if (!geometry) return null;
  const { W, H, x0, x1, yBase, xNow, yNow, yEnd, length } = geometry;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Topics learnt over time: ${projection.learnt} of ${projection.total} so far, reaching ${
        projection.wholeSyllabus
          ? `all ${projection.total}`
          : `the ${projection.total} opened so far`
      } by around ${projection.dateLabel}, if this pace holds.`}
    >
      <line className="wp-base" x1={x0} y1={yBase} x2={x1} y2={yBase} />
      <polygon className="wp-obs-fill" points={`${x0},${yBase} ${xNow},${yNow} ${xNow},${yBase}`} />
      {/* the drawn length is handed to the stylesheet, which owns the draw-on and is also the one
          place it is turned off for a learner who asked for still frames */}
      <path
        className="wp-obs"
        style={{ '--wp-len': length } as CSSProperties}
        d={`M${x0} ${yBase} L${xNow} ${yNow}`}
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="wp-fore"
        d={`M${xNow} ${yNow} L${x1} ${yEnd}`}
        vectorEffect="non-scaling-stroke"
      />
      <circle className="wp-now-dot" cx={xNow} cy={yNow} r={5} />
      <circle className="wp-end-dot" cx={x1} cy={yEnd} r={5} />
    </svg>
  );
}

export interface ReportProps {
  span: Span;
  /** Left out, the span control is not drawn and the report reads whatever it was handed. */
  onSpan?: (span: Span) => void;
  /** The one weekly summary the whole app computes (screens/you/ledger.ts). */
  summary: WeekSummary;
  bars: readonly MinuteBar[];
  tally: Tally;
  chapters: readonly ChapterRow[];
  debts: readonly ProgressTopic[];
  coming: readonly ProgressTopic[];
  retention: RetentionRead;
  projection: Projection;
  badges: readonly ReportBadge[];
  now?: number;
}

export function Report({
  span,
  onSpan,
  summary,
  bars,
  tally,
  chapters,
  debts,
  coming,
  retention,
  projection,
  badges,
  now = Date.now(),
}: ReportProps) {
  const still = useStill();
  const minutes = totalMinutes(bars);
  const peak = peakMinutes(bars);
  const note = reportNote(summary);
  const held = retention.recent;
  const before = retention.earlier;

  const barLabel = `Minutes a ${span === 'year' ? 'month' : 'day'}: ${bars
    .filter((b) => !b.future)
    .map((b) => b.full)
    .join('; ')}.`;

  return (
    <section className="wp-report">
      <header className="wp-report-head">
        <WoboHead size={30} />
        <b>{SPAN_HEAD[span]}</b>
        {onSpan ? (
          <span className="wp-spacer">
            <Segmented options={SPANS} value={span} onChange={onSpan} />
          </span>
        ) : null}
      </header>

      <div className="wp-kpis">
        <Kpi
          label="Minutes"
          note={
            summary.evenings > 0
              ? `across ${word(summary.evenings)} ${summary.evenings === 1 ? 'evening' : 'evenings'}`
              : summary.showedUp > 0
                ? `across ${word(summary.showedUp)} ${summary.showedUp === 1 ? 'day' : 'days'}`
                : 'no time on the app yet'
          }
        >
          <Counted value={minutes} still={still} />
        </Kpi>
        <Kpi
          label="Topics learnt"
          note={
            // The denominator is the chapters actually opened, not the board (evidence.ts). A
            // parent reading "2 of 8" on a twelve-chapter syllabus has to be told which eight.
            !projection.wholeSyllabus && tally.total > 0
              ? 'of the chapters opened so far'
              : tally.debt > 0
                ? `${tally.debt} ${tally.debt === 1 ? 'topic needs' : 'topics need'} another pass`
                : tally.total > 0
                  ? 'nothing has slipped back'
                  : 'your syllabus lands here once it is set'
          }
        >
          <Counted value={tally.learnt} still={still} />
          <i>{tally.total > 0 ? ` of ${tally.total}` : ''}</i>
        </Kpi>
        {/* NAMED FOR WHAT IT COUNTS. This read "Held a week later", which claims retention across a
            week WITHOUT practice; `heldLater` requires no gap, so a learner drilling a concept
            daily has every answer from day eight in it. The arithmetic is "of the answers given a
            week or more after the first on that concept, how many were right", and that is what
            the label now says. The stronger claim needs a gap in the evidence to measure. */}
        {held ? (
          <Kpi
            label="Right a week on"
            note={
              before && before.percent !== held.percent
                ? `${before.percent > held.percent ? 'down from' : 'up from'} ${before.percent}%, over ${held.total} answers`
                : `over ${held.total} answers given a week or more after the first on that concept`
            }
          >
            <Counted value={held.percent} still={still} />
            <i>%</i>
          </Kpi>
        ) : (
          <Kpi
            label="Right a week on"
            note="Wobo can only measure this once a concept has been yours for a week. It appears here on its own."
          />
        )}
      </div>

      <div className="wp-chart">
        <div className="wp-chart-top">
          <b>Minutes a {span === 'year' ? 'month' : 'day'}</b>
          <span className="wp-spacer">
            {peak > 0
              ? `best ${span === 'year' ? 'month' : 'day'} ${peak} min`
              : 'nothing recorded yet'}
          </span>
        </div>
        <div className="wp-bars" role="img" aria-label={barLabel}>
          {bars.map((bar, i) => (
            <i
              key={bar.key}
              className={bar.future || bar.minutes === 0 ? 'wp-quiet' : undefined}
              title={bar.full}
              // a day still to come is a quiet stub, never a zero-height sliver
              style={
                {
                  height: `${bar.future || peak === 0 ? 14 : Math.max(6, Math.round((bar.minutes / peak) * 100))}%`,
                  '--wp-i': Math.min(i, 30),
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="wp-axis" aria-hidden="true">
          {bars.map((bar) => (
            <span key={`ax-${bar.key}`}>{bar.label}</span>
          ))}
        </div>
      </div>

      <div className="wp-proj">
        <p className="wp-proj-line">{projection.line}</p>
        <ProjectionChart projection={projection} now={now} />
        {projection.kind === 'projected' ? (
          <p className="wp-proj-sub">
            Drawn from {projection.learnt} topics across {projection.activeDays} active{' '}
            {projection.activeDays === 1 ? 'day' : 'days'}. It is a straight line, not a promise,
            and it moves every time you do.
          </p>
        ) : null}
      </div>

      <div className="wp-lists">
        <div className="wp-panel">
          <span>What was learnt</span>
          {chapters.length === 0 ? (
            <p>The first chapter with something behind it appears here.</p>
          ) : (
            <ul className="wp-rows wp-mint">
              {chapters.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <span>
                    {row.name}
                    <i>{row.subjectName}</i>
                  </span>
                  <b>
                    {row.learnt} of {row.total}
                  </b>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="wp-panel">
          <span>Needed another pass</span>
          {debts.length === 0 ? (
            <p>
              Nothing has slipped back. A topic only lands here when the evidence says it stopped
              holding, and then it comes round again on its own.
            </p>
          ) : (
            <ul className="wp-rows wp-rose">
              {debts.slice(0, 5).map((topic) => (
                <li key={topic.id}>
                  <span>
                    {topic.name}
                    <i>{topic.chapterName}</i>
                  </span>
                  <b>coming back</b>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="wp-panel">
          <span>What is coming</span>
          {coming.length === 0 ? (
            <p>Nothing is queued. Open a subject and the next few appear here in order.</p>
          ) : (
            <ul className="wp-rows">
              {coming.map((topic) => (
                <li key={topic.id}>
                  <span>
                    {topic.name}
                    <i>{topic.chapterName}</i>
                  </span>
                  <b>{STATE_WORDS[topic.state]}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {badges.length > 0 ? (
        <ul className="wp-badges">
          {badges.map((badge) => (
            <li key={badge.id}>
              <BadgeMarkIcon mark={badge.mark} />
              {badge.title}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="wp-note">
        {note.map((segment, i) =>
          segment.em ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the segments are one fixed sentence
            <em key={i}>{segment.text}</em>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: the segments are one fixed sentence
            <span key={i}>{segment.text}</span>
          ),
        )}
      </p>
    </section>
  );
}
