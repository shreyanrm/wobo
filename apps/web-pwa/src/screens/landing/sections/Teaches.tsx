'use client';

/**
 * "It teaches you, at your pace, until you actually have it" — the chapter that argues Wobo is a
 * tutor rather than a course.
 *
 * Three beats, alternating side to side: it finds the hole under a chapter before building on it,
 * it changes route rather than repeating itself louder, and it does not call a chapter finished
 * until the chapter comes back right days later.
 *
 * The alternation is `nth-child(even)` in the stylesheet, not a prop, so the order can be read off
 * the markup. Every drawing here is still until it is scrolled to; the motion belongs to
 * `engine/motion.ts` (`mountGap`, `mountMastery`), which fires once on entry rather than scrubbing
 * — law v5 §8 cause 2, since what moves is a dash offset.
 */

import { GapArt, MasteryArt, RoutesArt } from '../art';
import { TEACHES } from '../page-copy';

/** The drawing that belongs to each beat, in the prototype's order. */
function BeatArt({ index }: { index: number }) {
  const label = TEACHES.beats[index]?.art ?? '';
  if (index === 0) return <GapArt label={label} words={TEACHES.gap} />;
  if (index === 1) return <RoutesArt label={label} words={TEACHES.routes} />;
  return <MasteryArt label={label} words={TEACHES.mastery} />;
}

export function Teaches() {
  return (
    <section id="teaches">
      <div className="wrap">
        <div className="eyebrow reveal">{TEACHES.eyebrow}</div>
        {/* The one headline on the page whose highlighter falls in the middle rather than at the
            end, so it carries a trail after the marked word. */}
        <h2 className="t reveal">
          {TEACHES.title.lead}
          <span className="hl">{TEACHES.title.mark}</span>
          {TEACHES.title.trail}
        </h2>
        <p className="lede reveal">{TEACHES.lede}</p>

        <div className="beats">
          {TEACHES.beats.map((beat, i) => (
            <div className="beat reveal" key={beat.n}>
              <div>
                <div className="n">{beat.n}</div>
                <h3>{beat.title}</h3>
                <p>{beat.body}</p>
                <div className="said">
                  {beat.said.lead}
                  <em>{beat.said.em}</em>
                </div>
              </div>
              <div className="beat-art">
                <BeatArt index={i} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
