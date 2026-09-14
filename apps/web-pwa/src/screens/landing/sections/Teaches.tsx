'use client';

/**
 * "It teaches you, at your pace, until you actually have it" — the chapter that argues Wobo is a
 * tutor rather than a course.
 *
 * It opens on THE TWO MODES, because they are the frame for everything under them and the honest
 * answer to "is this just a chatbot with a logo": a chat window clears a doubt, and has no way to
 * do the second job. A doubt is any time; learning is a bit at a time, across weeks (owner,
 * 2026-09-04; docs/SELL.md §2).
 *
 * Under the title, the adaptive line (owner, 2026-09-09; docs/copy/growth/lines.md): the thesis the
 * six things substantiate, with its proof set beside the second beat's drawing, the re-teach ladder.
 *
 * Then three beats, alternating side to side: it finds the hole under a chapter before building on
 * it, it changes route rather than repeating itself louder, and it does not call a chapter finished
 * until the chapter comes back right without a hint.
 *
 * The alternation is `nth-child(even)` in the stylesheet, not a prop, so the order can be read off
 * the markup. Every drawing here is still until it is scrolled to; the motion belongs to
 * `engine/motion.ts` (`mountGap`, `mountMastery`), which fires once on entry rather than scrubbing
 * — law v5 §8 cause 2, since what moves is a dash offset.
 */

import { AssistantMark, GapArt, MasteryArt, RoutesArt } from '../art';
import { ASK, assistants, TEACHES } from '../page-copy';

const ASSISTANTS = assistants();

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
        <p className="lede reveal">{TEACHES.adapts}</p>
        <p className="lede reveal">{TEACHES.lede}</p>

        {/* THE TWO MODES (owner, 2026-09-04; docs/SELL.md §2). A doubt is any time; learning is a
            bit at a time, across weeks. They are drawn as two panels rather than one paragraph
            because the whole point is that they are DIFFERENT, and a reader who only skims the
            kickers still leaves with both. It sits above the beats because it frames them. */}
        <div className="tmodes reveal">
          <div className="tmodes-note">{TEACHES.modes.note}</div>
          <div className="tmodes-pair">
            {TEACHES.modes.items.map((mode) => (
              <div className="tmode" data-mode={mode.key} key={mode.key}>
                <div className="tmode-kicker">{mode.kicker}</div>
                <div className="tmode-when">{mode.when}</div>
                <p>{mode.body}</p>
              </div>
            ))}
          </div>
          <div className="tmodes-hand">
            {TEACHES.modes.hand.lead}
            <em>{TEACHES.modes.hand.em}</em>
          </div>
        </div>

        {/* DO NOT TAKE OUR WORD FOR IT. This is rung 3 of the objection ladder — "is this just a
            chatbot with a logo" — so the confident move is to hand the reader an assistant they
            already trust and let it go and read the site. It used to sit 526px above the close,
            where five outbound links compete with the one conversion. Here it is above the price
            and it costs nothing (docs/SELL.md §8). It is also the only place on the product where
            another company's assistant is named, and they are named because they belong to the
            READER: nothing here reveals what sits underneath Wobo. */}
        <div className="others reveal">
          <div className="line">{ASK.others}</div>
          <div className="models" id="models">
            {ASSISTANTS.map((assistant, i) => (
              <a
                key={assistant.name}
                href={assistant.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <AssistantMark index={i} />
                {assistant.name}
              </a>
            ))}
          </div>
        </div>

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
                {beat.proof ? <div className="said">{beat.proof}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
