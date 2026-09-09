'use client';

/**
 * The hero: one question, answered four ways.
 *
 * The card is the argument. It says the thing the whole page has to say before a visitor scrolls —
 * that Wobo is not a whiteboard with a chatbot bolted on — by answering the same question drawn,
 * filmed, tried and spoken, and by letting the reader pick.
 *
 * THREE RULES ARE BUILT INTO THIS COMPONENT:
 *
 *  · THE DRAWN ANSWER IS COMPLETE ON FIRST PAINT. The drawn card is the one that is up when the
 *    page loads, its own timeline runs immediately (`engine/motion.ts`), and under reduced motion
 *    the finished drawing is simply there. A visitor never meets an empty stage.
 *  · THE RAIL IS A CONTROL, NOT A CAROUSEL. It cycles on its own so a visitor who does nothing
 *    still sees all four, and the moment anyone taps it, the cycling stops for good. An auto-rotate
 *    that fights the reader is the oldest hostile pattern on the web.
 *  · THE TRY IS IN THE FIRST SCREEN, AND IT IS THE ONLY THING ASKED FOR THERE. docs/SELL.md §4:
 *    letting a stranger ask and be answered with no account is the strongest asset this company
 *    has, and it used to be the ELEVENTH section on the page. It sits in the hero now. It is drawn
 *    in INK rather than in the pointer blue, and the hero carries no door of its own: the one call
 *    to action in this view is the header's, which never leaves the screen. Two saturated pills in
 *    one screen are two calls to action, and two convert worse than one (docs/SELL.md §6).
 *
 * WHAT THE BOX HONESTLY DOES. It answers questions about WOBO, in Wobo's own voice, from a local
 * lookup (`ask.ts`), and says plainly what it is doing when asked anything else. There is no
 * gateway on a marketing page, so a box that invited a syllabus question would be promising a
 * tutor this page cannot reach — the one thing the copy law forbids. When there is a public
 * gateway, this is the single component that changes.
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { HeroDrawn, HeroFilmed, HeroFloats, HeroSpoken, HeroTried } from '../art';
import { answerFor } from '../ask';
import { ASK, ASK_TYPE_MS, HERO, HERO_CYCLE_MS, HERO_FORMS } from '../page-copy';

export function Hero({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  const [form, setForm] = useState(0);
  // A ref, not state: it is read by the interval, and turning it into state would restart the
  // interval on every tick.
  const stopped = useRef(false);
  const current = HERO_FORMS[form] ?? HERO_FORMS[0];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      if (stopped.current) return;
      setForm((i) => (i + 1) % HERO_FORMS.length);
    }, HERO_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const pick = useCallback((i: number) => {
    stopped.current = true;
    setForm(i);
  }, []);

  // --- the try box ------------------------------------------------------------------------------
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [shown, setShown] = useState(0);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The typewriter. One timer, cleared on every change and on unmount, so a reader who asks three
  // questions in a second never ends up with three of them typing over each other.
  useEffect(() => {
    if (typing.current) clearTimeout(typing.current);
    if (!answer || shown >= answer.length) return;
    typing.current = setTimeout(() => setShown((n) => n + 1), ASK_TYPE_MS);
    return () => {
      if (typing.current) clearTimeout(typing.current);
    };
  }, [answer, shown]);

  const ask = useCallback((asked: string) => {
    const reply = answerFor(asked);
    setAnswer(reply);
    // A reader who asked for less motion gets the whole reply at once rather than watching it
    // arrive; the words are the content, and only the typing of them is decoration.
    const instant =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    setShown(instant ? reply.length : 0);
  }, []);

  return (
    <section id="hero" ref={sectionRef as RefObject<HTMLElement>}>
      <div className="wrap grid">
        <div>
          <div className="eyebrow reveal">
            {HERO.eyebrow.lead}
            <b>{HERO.eyebrow.accent}</b>
          </div>
          <h1 className="reveal">
            {HERO.title.lead}
            <span className="hl">{HERO.title.mark}</span>
          </h1>
          <p className="lede reveal">{HERO.lede}</p>
          <div className="ask hero reveal">
            <div>
              <div className="trynote">{HERO.tryNote}</div>
              <form
                className="box"
                onSubmit={(event) => {
                  event.preventDefault();
                  ask(question);
                }}
              >
                <input
                  id="askIn"
                  value={question}
                  placeholder={ASK.placeholder}
                  aria-label="Ask Wobo"
                  onChange={(event) => setQuestion(event.target.value)}
                />
                {/* INK, NOT PIG. The header's "Start free" is the one pointer in this view
                    (DESIGN.md §0: pig is the pointer, one per view) and it is the conversion; this
                    is the demo. Both painted rgb(43,69,255) put two equal calls to action in the
                    first screen, which converts worse than one (docs/SELL.md §6). */}
                <button className="btn" id="askGo" type="submit">
                  <span>{ASK.go}</span>
                </button>
              </form>
              <div className="chips" id="askChips">
                {ASK.chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setQuestion(chip);
                      ask(chip);
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <p className="answer" id="askOut" aria-live="polite">
                {answer.slice(0, shown)}
              </p>
            </div>
          </div>
          {/* NO DOOR IN THE HERO BODY. There was a ghost "Start free" here, which made the one
              phrase appear in three different weights on one screen — pig in the sticky header,
              ghost here, and the pig "Ask" beside it. The header's door is a thumb's width away
              and never leaves the screen, so a second copy of it bought nothing and cost the
              screen its single call to action (docs/SELL.md §6). */}
          <div className="under reveal">
            {HERO.under.map((line) => (
              <span key={line}>
                <i />
                {line}
              </span>
            ))}
          </div>
        </div>
        <div className="stagewrap" style={{ position: 'relative' }}>
          <HeroFloats />
          <div className="device" id="device">
            <div className="top">
              <b>{HERO.device.who}</b> · {HERO.device.live}
              <span className="live">
                <i />
                {/* Announced politely: the label changes on its own, and a reader on a screen
                    reader should hear it change without being interrupted mid-sentence. */}
                <span aria-live="polite">{current?.live}</span>
              </span>
            </div>
            <div className="asked">
              <span className="wake">{HERO.staged.wake}</span>
              {HERO.staged.question}
            </div>
            {/* FADED OUT IS NOT GONE. The four answers cross-fade on opacity, which is right for
                the eye and nothing to a screen reader, which read all four as one run-on with no
                way to tell which was on screen (wave 29, site-7). Every answer but the shown one
                is taken out of the accessibility tree and made inert, so nothing inside it can
                be reached by Tab either; the rail's aria-pressed says which one is up. */}
            <div className="stage" id="heroStage">
              {(
                [
                  [
                    'draw',
                    <HeroDrawn key="draw" label="Wobo draws the leaf and where the light goes" />,
                  ],
                  [
                    'video',
                    <HeroFilmed
                      key="video"
                      label="The same idea as a short film"
                      caption={HERO.filmed.caption}
                    />,
                  ],
                  ['try', <HeroTried key="try" label="Now you try one" copy={HERO.tried} />],
                  [
                    'say',
                    <HeroSpoken key="say" label="Wobo says it out loud" line={HERO.spoken.line} />,
                  ],
                ] as const
              ).map(([key, art], i) => (
                <div
                  key={key}
                  className={form === i ? 'on' : undefined}
                  data-form={key}
                  aria-hidden={form === i ? undefined : true}
                  inert={form !== i}
                >
                  {art}
                </div>
              ))}
            </div>
            <div className="rail" id="heroRail">
              {HERO_FORMS.map((entry, i) => (
                <button
                  key={entry.key}
                  type="button"
                  className={i === form ? 'on' : undefined}
                  data-go={entry.key}
                  aria-pressed={i === form}
                  onClick={() => pick(i)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
