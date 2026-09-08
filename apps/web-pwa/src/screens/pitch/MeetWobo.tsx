'use client';

/**
 * /meet-wobo — who Wobo is, the character and the voice. A port of
 * design/prototypes/site-meet.html, word for word and section for section: Wobo large, watching
 * the pointer, the first-meeting line written; how it listens, how it draws, how it notices, what
 * it never does; the "Hey Wobo" hold-to-talk demo; the ask block and the close.
 *
 * The big Wobo is the shipped rig (packages/wobo), never redrawn, with its gaze pinned to the
 * pointer — the prototype drew a simplified head and moved its pupils by hand; the rig does the
 * same thing with its whole body. The demo stage is the rig too, on the panel's inverse tones,
 * listening while the button or the space bar is held.
 *
 * The hold-to-talk is a mock, as the prototype says on the page: nothing is recorded, nothing is
 * sent; the real thing is in the app.
 */

import { useReducedMotion } from '@wobo/motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewport } from '../../shell/useViewport';
import { Label, Sticker, WoboHead } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { CTA } from '../site/cta';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

/** The first-meeting line, written into the bubble. */
export const FIRST_LINE = "Hi. I'm Wobo. Ask me anything from your syllabus.";

/** The prototype's pace: 42ms a character, a breath after "Hi." and after "I'm Wobo.". */
export function typeDelay(i: number): number {
  return i === 3 || i === 13 ? 320 : 42;
}

function useTypedLine(line: string): string {
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (reduced) {
      setTyped(line);
      return;
    }
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setTyped(line.slice(0, i));
      if (i < line.length) timer = setTimeout(tick, typeDelay(i));
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [line, reduced]);
  return typed;
}

/** True while the focus is somewhere a space bar means something else. */
function spaceIsTaken(hold: HTMLElement | null): boolean {
  const el = document.activeElement;
  if (!el || el === hold) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'SUMMARY' ||
    (el as HTMLElement).isContentEditable
  );
}

function SayHey() {
  const [live, setLive] = useState(false);
  const [show, setShow] = useState(false);
  const down = useRef(false);
  const hold = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const start = useCallback(() => {
    if (down.current) return;
    down.current = true;
    clearTimeout(timer.current);
    setLive(true);
    setShow(false);
  }, []);
  const stop = useCallback(() => {
    if (!down.current) return;
    down.current = false;
    setLive(false);
    setShow(true);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || spaceIsTaken(hold.current)) return;
      e.preventDefault();
      start();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') stop();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearTimeout(timer.current);
    };
  }, [start, stop]);

  return (
    <>
      <div>
        <Label>Try it</Label>
        <h2>Say "Hey Wobo".</h2>
        <p>
          Hold the button, or the space bar, and Wobo listens. Let go, and it answers. This one's a
          demo, the real thing is in the app.
        </p>
        <button
          type="button"
          ref={hold}
          className={live ? 'mt-hold mt-live' : 'mt-hold'}
          aria-pressed={live}
          onPointerDown={start}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          <span className="mt-k">space</span>
          {live ? 'Listening…' : 'Hold to talk'}
        </button>
      </div>
      <div className={live ? 'mt-stage mt-live' : 'mt-stage'}>
        <div className="mt-ring" />
        <WoboHead size={190} mood={live ? 'listening' : 'idle'} />
        <div className={show ? 'mt-say mt-show' : 'mt-say'} aria-hidden={!show}>
          Got it. Let's draw it.
        </div>
      </div>
    </>
  );
}

const Mic = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11 a6 6 0 0 0 12 0 M12 17 v4" />
  </svg>
);

export function MeetWobo() {
  const typed = useTypedLine(FIRST_LINE);
  const { width } = useViewport();
  // The prototype's head: 460px of drawing on a desktop, 300 on a phone, the head 104/120 of it.
  const big =
    width <= 900 ? Math.min(260, Math.round(width * 0.6)) : Math.min(400, Math.round(width * 0.3));

  return (
    <SiteShell current="meet" title="Meet Wobo">
      <div className="pt">
        <section className="pt-hero mt-hero">
          <div className="st-wrap">
            <div>
              <Label>Meet Wobo</Label>
              <h1>
                A tutor with a pen, <em>endless patience,</em> and no opinions about anything but
                the chapter.
              </h1>
              <p className="pt-sub">
                Wobo listens the way you'd talk to a friend, draws the answer instead of reciting
                it, notices what you're good at, and never, ever makes you feel small. Wobo is the
                part of this you talk to. It is not the whole of what is going on.
              </p>
              <div className="pt-row">
                <SiteLink className="st-btn st-pig" to={CTA.to}>
                  {CTA.label}
                </SiteLink>
                <a className="st-btn st-quiet" href="#say">
                  Say hey to Wobo
                </a>
                <span className="pt-note">Wobo has no gender. Wobo is just Wobo.</span>
              </div>
            </div>
            <div className="mt-big">
              <WoboHead size={big} gaze="pointer" label="Wobo, watching the pointer" />
              <div className="mt-bubble">
                <span>{typed}</span>
                <span className="mt-cur" />
              </div>
            </div>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">01</div>
                <h2>
                  It <span className="pt-hl">listens</span> however you want to ask.
                </h2>
                <p>
                  Say it out loud, type it, or circle the part of the board that lost you. Wobo
                  hears the question under the question.
                </p>
                <ul className="mt-list">
                  <li>
                    <i>
                      <Mic />
                    </i>
                    <div>
                      <b>Say it.</b> Hold space, or the mic, and just talk. Half sentences are fine.
                    </div>
                  </li>
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 6 h16 M4 12 h10 M4 18 h13" />
                      </svg>
                    </i>
                    <div>
                      <b>Type it.</b> Paste question 7 straight from the worksheet.
                    </div>
                  </li>
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 4 c6 0 8 3 8 8 s-3 8 -8 8 s-8 -3 -8 -8 s2 -8 8 -8 M16 6 l2 -2" />
                      </svg>
                    </i>
                    <div>
                      <b>Circle it.</b> Draw a loop around the confusing bit and ask "why?"
                    </div>
                  </li>
                </ul>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 360" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="30" width="460" height="300" rx="22" />
                  <text className="pt-hw" x="60" y="86" fontSize="30">
                    why is the angle 90° here?
                  </text>
                  <g className="mt-wave" transform="translate(60 120)">
                    <rect x="0" y="0" width="8" height="40" rx="4" />
                    <rect x="14" y="0" width="8" height="40" rx="4" />
                    <rect x="28" y="0" width="8" height="40" rx="4" />
                    <rect x="42" y="0" width="8" height="40" rx="4" />
                    <rect x="56" y="0" width="8" height="40" rx="4" />
                    <rect x="70" y="0" width="8" height="40" rx="4" />
                  </g>
                  <path className="pt-ink pt-thin" d="M300 200 L440 200 L300 100 Z" />
                  <path className="pt-ink pt-thin" d="M300 180 h20 v20" />
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M282 176 c-14 22 -4 60 30 62 s54 -8 52 -36 s-24 -44 -50 -40 s-28 6 -32 14"
                  />
                  <text className="pt-hw pt-pig" x="330" y="290" fontSize="26">
                    this one
                  </text>
                  <path className="pt-ink" d="M60 300 h180" />
                  <text className="pt-hw" x="250" y="306" fontSize="22" fill="var(--ink-3)">
                    or type here
                  </text>
                </svg>
                <Sticker style={{ right: 22, top: 18 }}>listening</Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter pt-flip">
              <div>
                <div className="pt-num">02</div>
                <h2>
                  It <span className="pt-hl">draws</span>, it doesn't dictate.
                </h2>
                <p>
                  Every answer is drawn in front of you, one stroke at a time, on a board you can
                  pause, rewind and scribble on. Some things need a diagram. Wobo knows which.
                </p>
                <ul className="mt-list">
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20 l4 -1 l11 -11 l-3 -3 l-11 11 z" />
                      </svg>
                    </i>
                    <div>
                      <b>The pen.</b> You watch it think. Nothing appears fully formed.
                    </div>
                  </li>
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="13" rx="3" />
                        <path d="M8 21 h8" />
                      </svg>
                    </i>
                    <div>
                      <b>The board.</b> Diagrams, graphs, maps, a paragraph marked up.
                    </div>
                  </li>
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="3" />
                        <path d="M3 12 h18" />
                      </svg>
                    </i>
                    <div>
                      <b>Plane or full board.</b> A quick strip over your lesson, or the whole wall
                      when it's a big one.
                    </div>
                  </li>
                </ul>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 360" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="30" width="460" height="300" rx="22" />
                  <path className="pt-ink pt-thin" d="M70 280 h380 M90 300 v-240" />
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M90 260 c60 -10 100 -60 140 -100 s90 -70 200 -80"
                  />
                  <path
                    className="pt-ink pt-draw"
                    d="M230 160 v120"
                    style={{ stroke: 'var(--rose)', strokeDasharray: '6 8', strokeWidth: 3 }}
                  />
                  <text className="pt-hw" x="240" y="300" fontSize="26">
                    x = 3
                  </text>
                  <text className="pt-hw pt-pig" x="330" y="120" fontSize="30">
                    y = 2x + 1
                  </text>
                  <circle cx="230" cy="160" r="8" fill="var(--rose)" />
                  <g transform="translate(455 90) rotate(-30)">
                    <rect x="-4" y="-70" width="8" height="52" rx="3" fill="var(--ink)" />
                    <path d="M-4 -18 l4 20 l4 -20 z" fill="var(--pig)" />
                  </g>
                </svg>
                <Sticker rotate={4} style={{ left: 22, bottom: 18 }}>
                  drawing
                </Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">03</div>
                <h2>
                  It <span className="pt-hl">notices</span> what a good teacher notices.
                </h2>
                <p>
                  When you nail it, Wobo makes a small fuss. When you're close, it rings the gap
                  instead of saying wrong. And on Sunday it writes a note home, in its own words,
                  about what actually happened this week.
                </p>
                <ul className="mt-list">
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3 l2.5 6 l6.5 .6 l-5 4.3 l1.6 6.4 l-5.6 -3.4 l-5.6 3.4 l1.6 -6.4 l-5 -4.3 l6.5 -.6 z" />
                      </svg>
                    </i>
                    <div>
                      <b>Praise that's earned.</b> Specific, quick, and never every five seconds.
                    </div>
                  </li>
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="8" />
                        <path d="M12 8 v4 l3 2" />
                      </svg>
                    </i>
                    <div>
                      <b>The gap, ringed.</b> A circle on your answer, right where it went sideways.
                    </div>
                  </li>
                  <li>
                    <i>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="6" width="18" height="13" rx="3" />
                        <path d="M3 8 l9 6 l9 -6" />
                      </svg>
                    </i>
                    <div>
                      <b>The Sunday note.</b> To you, and to a parent if you've linked one. Warm,
                      honest, three lines.
                    </div>
                  </li>
                </ul>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 360" aria-hidden="true">
                  <rect
                    className="pt-paper"
                    x="60"
                    y="40"
                    width="400"
                    height="280"
                    rx="18"
                    transform="rotate(-2 260 180)"
                  />
                  <text className="pt-hw" x="100" y="100" fontSize="24" fill="var(--ink-3)">
                    Sunday, 6 pm
                  </text>
                  <text className="pt-hw" x="100" y="150" fontSize="30">
                    asked for help twice
                  </text>
                  <text className="pt-hw" x="100" y="188" fontSize="30">
                    after a miss this week, <tspan className="pt-hw pt-rose">which is</tspan>
                  </text>
                  <text className="pt-hw pt-rose" x="100" y="226" fontSize="30">
                    exactly how learning looks.
                  </text>
                  <text className="pt-hw" x="100" y="274" fontSize="30">
                    Triangles: half done. Next: ten
                  </text>
                  <text className="pt-hw" x="100" y="310" fontSize="30">
                    minutes a day. From Wobo
                  </text>
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M96 132 c-8 20 -2 50 40 48 s260 -4 300 -20 s6 -50 -30 -52 s-280 -10 -310 24"
                  />
                </svg>
                <Sticker style={{ right: 22, top: 18 }}>noticed</Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter" style={{ gridTemplateColumns: '1fr', gap: 0 }}>
              <div>
                <div className="pt-num">04</div>
                <h2>
                  What it <span className="pt-hl">never</span> does.
                </h2>
                <p>
                  Three rules we'd put in a contract, because a tutor a child talks to on their own
                  has to be safe by design, not by promise.
                </p>
              </div>
            </Reveal>
            <Reveal className="mt-never">
              <div>
                <span className="mt-x">✗</span>
                <b>Make you feel small</b>
                <span>
                  Wobo never says wrong. It rings the gap and waits. No red ink, no scores you
                  didn't ask for.
                </span>
              </div>
              <div>
                <span className="mt-x">✗</span>
                <b>Have opinions</b>
                <span>
                  Politics, religion, anything contested: Wobo stays neutral and steers back to the
                  chapter, kindly.
                </span>
              </div>
              <div>
                <span className="mt-x">✗</span>
                <b>Sell you anything</b>
                <span>
                  No ads, no nudges, no "premium" pop-ups mid-lesson. Wobo is paid for by families,
                  not by advertisers.
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <div className="pt-num">05</div>
              <h2>Wobo is the voice. It isn't the whole of it.</h2>
              <p>
                A patient tutor with a pen is one reason this works. Three more sit behind it, and
                none of them is a personality. They are the difference between a chat that answers
                well and something that actually gets you through the year.
              </p>
            </Reveal>
            <Reveal className="st-grid3">
              <SiteLink className="st-tile" href="/subjects">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M8 10 h13 a4 4 0 0 1 4 4 v22 a5 5 0 0 0 -5 -4 h-12 z" />
                  <path d="M36 10 h-13 a4 4 0 0 0 -4 4 v22 a5 5 0 0 1 5 -4 h12 z" />
                </svg>
                <h3>It knows which chapter this is</h3>
                <p>
                  Your board's own syllabus sits underneath every answer, in your textbook's order,
                  so nothing arrives from a different year or a different country.
                </p>
                <span className="mt-more">See the subjects</span>
              </SiteLink>
              <SiteLink className="st-tile" href="/how-it-works">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <rect x="6" y="6" width="32" height="10" rx="3" />
                  <path d="M12 16 v6 M22 16 v6 M32 16 v6" />
                  <rect x="6" y="22" width="12" height="15" rx="3" />
                  <rect x="26" y="22" width="12" height="15" rx="3" />
                  <path d="M17 22 h10 M17 37 h10" />
                </svg>
                <h3>It checks the ground before it builds</h3>
                <p>
                  A chapter usually stands on an older one. Wobo asks two or three short questions
                  about that older one first, and teaches whatever is thin before the chapter that
                  needs it.
                </p>
                <span className="mt-more">See the loop</span>
              </SiteLink>
              <SiteLink className="st-tile" href="/for-parents">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M22 8 a14 14 0 1 1 -13 9" />
                  <path d="M22 3 l6 5 l-6 5" />
                  <path d="M15 23 l5 5 l10 -11" />
                </svg>
                <h3>It doesn't move on until it holds</h3>
                <p>
                  Getting it right once is not knowing it. A chapter counts as done when it is still
                  right without a hint, and if it stops being right, it comes back.
                </p>
                <span className="mt-more">Why that matters</span>
              </SiteLink>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="say">
          <div className="st-wrap">
            <Reveal className="mt-demo">
              <SayHey />
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal>
              <PitchAsk
                page="meet"
                heading="Ask Wobo about Wobo. It answers for itself."
                placeholder="Do you get annoyed if I ask the same thing twice?"
                chips={[
                  "Can you help with my school's textbook?",
                  'Can you say it out loud instead of drawing it?',
                  'Do you remember me?',
                ]}
              />
            </Reveal>
          </div>
        </section>

        <ClosePanel page="meet" />
      </div>
    </SiteShell>
  );
}
