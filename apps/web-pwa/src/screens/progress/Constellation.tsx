'use client';

/**
 * THE CONSTELLATION — a map of what connects to what, on law v5's white ground.
 *
 * The twin a bad commit deleted was a night sky: a dark field, a dust layer, ultramarine stars.
 * That design no longer exists, so this is the same idea rebuilt for white paper. What survives
 * from it is the thinking, not the look — that independent and supported are different things and
 * must never be conflated, that the sky must not reshuffle between visits, that a newly earned
 * concept catches light exactly once, and that a learner has to be able to read the whole thing
 * without seeing a single colour.
 *
 * This is the one place in the product allowed to be beautiful for its own sake, so it is: subjects
 * radiate from the learner at the centre, chapters ring outward, and prerequisites bow between the
 * stars they join. It is still a list underneath — every concept is a row below the picture, with
 * its status in words — because a map nobody can operate with a keyboard is a decoration.
 *
 * WHO OPERATES IT, AND HOW
 *   everyone   the list below the picture. Every concept is a row, every row is a real button of at
 *              least 44px, in syllabus order, with its status in words. It is the map's controls.
 *   a pointer  the stars themselves also take a click, as a convenience that duplicates that list
 *              and adds nothing to it. They are deliberately NOT focusable: a star cannot be a
 *              44px thumb target without swallowing its neighbours, and a second set of controls
 *              carrying the same rows would only make the map twice as long to tab through.
 *   the picture itself describes what it shows (`role="img"`, and a description that counts the
 *   stars and says what the rings and the curves mean), so nothing in it has to be read shape by
 *   shape by somebody who cannot see it.
 */

import { type CSSProperties, useMemo, useState } from 'react';
import { toneForSubject } from '../../ui/hues';
import { type ProgressTopic, STATE_WORDS, type TopicState } from './evidence';
import type { Sky, SkyStar } from './sky';
import './progress.css';

/** How each state is drawn, in words — so the legend teaches the shapes, not the colours. */
const SHAPE_WORDS: Record<TopicState, string> = {
  learnt: 'a filled star',
  debt: 'a dashed ring',
  started: 'an open ring',
  untouched: 'a small outline',
};

function coreFor(star: SkyStar, hue: string) {
  if (star.state === 'learnt')
    return (
      <>
        <circle cx={star.x} cy={star.y} r={star.r + 12} fill={hue} opacity={0.14} />
        <circle cx={star.x} cy={star.y} r={star.r} fill={hue} />
      </>
    );
  if (star.state === 'debt')
    return <circle className="wp-core-debt" cx={star.x} cy={star.y} r={star.r} />;
  if (star.state === 'started')
    return <circle className="wp-core-part" cx={star.x} cy={star.y} r={star.r} stroke={hue} />;
  return <circle className="wp-core-out" cx={star.x} cy={star.y} r={star.r} />;
}

/** The legend's own marks, drawn from the same rules as the sky so the two can never drift. */
function LegendMark({ state }: { state: TopicState }) {
  if (state === 'learnt')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--mint)" opacity="0.16" />
        <circle cx="8" cy="8" r="4.5" fill="var(--mint)" />
      </svg>
    );
  if (state === 'debt')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="5"
          fill="none"
          stroke="var(--rose)"
          strokeWidth="2.4"
          strokeDasharray="3 3"
        />
      </svg>
    );
  if (state === 'started')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5" fill="none" stroke="var(--pig)" strokeWidth="2.4" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.6" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" />
    </svg>
  );
}

export interface ConstellationProps {
  /** Every concept of the learner's own world, in syllabus order, with where each one stands. */
  topics: readonly ProgressTopic[];
  sky: Sky;
  /** What the learn flow says is next — the single pointer this view is allowed (law v5, §0). */
  currentId?: string | null;
  /** Concepts earned since this session last looked. Each catches light once, then never again. */
  ignited?: ReadonlySet<string>;
  /** Opening a concept from its card. Left out, the card is a fact sheet and nothing more. */
  onOpen?: (topicId: string) => void;
}

export function Constellation({
  topics,
  sky,
  currentId = null,
  ignited,
  onOpen,
}: ConstellationProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const counts = useMemo(() => {
    const out = { learnt: 0, debt: 0, started: 0, untouched: 0 };
    for (const t of topics) out[t.state] += 1;
    return out;
  }, [topics]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const prereqs = useMemo(
    () =>
      (selected?.prereqTopicIds ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is ProgressTopic => Boolean(t)),
    [selected, byId],
  );
  const unlocks = useMemo(
    () => (selected ? topics.filter((t) => t.prereqTopicIds.includes(selected.id)) : []),
    [selected, topics],
  );

  if (sky.stars.length === 0) {
    return (
      <div className="wp-empty">
        <b>Your map draws itself as you go</b>
        Every concept you open becomes a star here, and every prerequisite becomes a line between
        two of them. Open a subject and the first one appears.
      </div>
    );
  }

  const pick = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  const summary = `${sky.stars.length} concepts across ${sky.subjects.length} ${
    sky.subjects.length === 1 ? 'subject' : 'subjects'
  }: ${counts.learnt} learnt, ${counts.started} in progress, ${counts.debt} needing another pass, ${counts.untouched} not started. Subjects fan out from the centre, chapters ring outward, and each curve joins a concept to one it stands on.`;

  return (
    <figure className="wp-sky">
      <div className="wp-sky-stage">
        <div className="wp-sky-plot">
          <svg
            viewBox={`0 0 ${sky.width} ${sky.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={summary}
          >
            <title>Your knowledge map</title>

            {/* the prerequisite curves: a relationship both ends of which are behind the learner
              burns in the hue of what it unlocked; the rest stay the one hairline law v5 allows */}
            <g>
              {sky.edges.map((edge) => (
                <path
                  key={edge.id}
                  className={edge.lit ? 'wp-edge wp-lit' : 'wp-edge'}
                  d={edge.d}
                  vectorEffect="non-scaling-stroke"
                  style={edge.lit ? { stroke: toneForSubject(edge.subjectId).hue } : undefined}
                />
              ))}
            </g>

            {sky.stars.map((star, i) => {
              const hue = toneForSubject(star.subjectId).hue;
              const isNow = star.id === currentId;
              const isPicked = star.id === selectedId;
              const core = (
                <g style={{ '--wp-i': Math.min(i, 40) } as CSSProperties}>
                  {isNow && (
                    <>
                      <circle
                        className="wp-ring"
                        cx={star.x}
                        cy={star.y}
                        r={star.r + 7}
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        className="wp-pulse"
                        cx={star.x}
                        cy={star.y}
                        r={star.r + 7}
                        fill="none"
                        stroke="var(--pig)"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  )}
                  {coreFor(star, hue)}
                  {isPicked && (
                    <circle
                      className="wp-pick-ring"
                      cx={star.x}
                      cy={star.y}
                      r={star.r + 11}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              );
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: pointer convenience only — the same row is a real button in the list below, which is this map's accessible path
                <g key={star.id} className="wp-star" onClick={() => pick(star.id)}>
                  <circle className="wp-star-hit" cx={star.x} cy={star.y} r={24} />
                  {core}
                </g>
              );
            })}

            {/* a concept earned since this session last looked catches light, once */}
            <g>
              {sky.stars
                .filter((star) => ignited?.has(star.id))
                .map((star) => (
                  <circle
                    key={`lit-${star.id}`}
                    className="wp-ignite"
                    cx={star.x}
                    cy={star.y}
                    r={star.r + 6}
                    fill="none"
                    stroke={toneForSubject(star.subjectId).hue}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            </g>
          </svg>

          {/* THE SUBJECT NAMES, in HTML rather than in the picture.
              An SVG <text> in a 1000-unit box renders at whatever the box scaled to — six pixels on
              a phone — and its own scrollWidth reports as clipped text to a measuring harness. So
              the names ride the picture instead: the plot is square and the SVG meets its box, so a
              percentage of the box IS the same point in the drawing, at every width and in every
              theme. Each one is capped to the room it has on its own side, so a long subject name
              wraps instead of pushing the page sideways (DESIGN.md §0, trap 4). */}
          {sky.subjects.map((subject) => {
            const x = (subject.labelX / sky.width) * 100;
            const y = (subject.labelY / sky.height) * 100;
            const place: CSSProperties =
              subject.anchor === 'end'
                ? { right: `${100 - x}%`, top: `${y}%`, maxWidth: `${x - 2}%`, textAlign: 'right' }
                : subject.anchor === 'start'
                  ? { left: `${x}%`, top: `${y}%`, maxWidth: `${98 - x}%` }
                  : {
                      left: `${x}%`,
                      top: `${y}%`,
                      maxWidth: '42%',
                      transform: 'translateX(-50%)',
                      textAlign: 'center',
                    };
            return (
              <span key={subject.id} className="wp-sky-name" style={place} aria-hidden="true">
                {subject.name}
              </span>
            );
          })}
        </div>
      </div>

      <figcaption>
        <ul className="wp-legend">
          {(['learnt', 'started', 'debt', 'untouched'] as const).map((state) => (
            <li key={state}>
              <LegendMark state={state} />
              {STATE_WORDS[state]} · {SHAPE_WORDS[state]}
            </li>
          ))}
        </ul>
      </figcaption>

      <ul className="wp-subjects">
        {sky.subjects.map((subject) => (
          <li key={subject.id}>
            <b>{subject.name}</b> · {subject.learnt} of {subject.topics} learnt
          </li>
        ))}
      </ul>

      {selected && (
        <div className="wp-pick">
          <h3>{selected.name}</h3>
          <span className="wp-pick-where">
            {selected.subjectName} · {selected.chapterName}
          </span>
          <span className="wp-pick-state">{STATE_WORDS[selected.state]}</span>
          {prereqs.length > 0 && (
            <>
              <span className="wp-pick-where">It stands on</span>
              <ul className="wp-pick-list">
                {prereqs.map((p) => (
                  <li key={p.id}>
                    {p.name} · {STATE_WORDS[p.state]}
                  </li>
                ))}
              </ul>
            </>
          )}
          {unlocks.length > 0 && (
            <>
              <span className="wp-pick-where">What it opens</span>
              <ul className="wp-pick-list">
                {unlocks.map((u) => (
                  <li key={u.id}>
                    {u.name} · {STATE_WORDS[u.state]}
                  </li>
                ))}
              </ul>
            </>
          )}
          {onOpen && (
            <button type="button" className="wp-pick-close" onClick={() => onOpen(selected.id)}>
              Open this concept
            </button>
          )}
          <button type="button" className="wp-pick-close" onClick={() => setSelectedId(null)}>
            Close
          </button>
        </div>
      )}

      {/* THE MAP, AS A LIST. Not a transcript of the picture: the same rows, in the same order,
          as real controls. It is how the map is operated on a phone, how it is operated by anyone
          who does not use a pointer, and how the status of every concept is stated in words. */}
      <ul className="wp-map-rows">
        {sky.stars.map((star) => (
          <li key={`row-${star.id}`}>
            <button
              type="button"
              aria-pressed={star.id === selectedId}
              onClick={() => setSelectedId((cur) => (cur === star.id ? null : star.id))}
            >
              <span>
                {star.name}
                <i>
                  {star.subjectName} · {star.chapterName}
                </i>
              </span>
              <b>{star.id === currentId ? 'where you are' : STATE_WORDS[star.state]}</b>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}
