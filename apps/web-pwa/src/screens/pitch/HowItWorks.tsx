'use client';

/**
 * /how-it-works — a lesson from the first question to the Sunday note. A port of
 * design/prototypes/site-how.html, word for word and section for section: the three-step strip
 * drawn, then the six steps down a timeline — ask, drawn out, try one (drag the point onto
 * y = 2x + 1, the thing to try), practice that plays fair, the week, the note home — the ask
 * block and the close.
 *
 * The point is real state: dragged with a pointer (captured, so a fast drag never loses it) or
 * nudged with the arrow keys and checked with Enter, and the arithmetic is `maths.ts`.
 *
 * ADDED BEYOND THE PROTOTYPE: the two TURNS off the timeline, because a loop drawn only as a line
 * is not the loop this product runs. A reader who comes to this page comes to find out what
 * happens when it does NOT go well, and the six steps never said. Both turns are the code:
 *
 *   after step 3   the re-teach ladder — `wobo/reteach.ts`. Two misses on one concept
 *                  (RETEACH_AFTER_MISSES) and Wobo changes AXIS on its own: a worked example
 *                  (method), the same idea drawn (representation), an analogy from what the
 *                  learner told us (example, skipped entirely when they have told us nothing),
 *                  out loud and taught back (voice). The rung that just failed is excluded, and
 *                  the tried-list is persisted under the learner's scope, which is why the page
 *                  may say it does not start tomorrow with the one that did not work.
 *   after step 4   the mastery rule — `screens/learn/mastery.ts` and `screens/learn/units.ts`.
 *                  Completed is not learnt: learnt is completed AND at or above MASTERY_FLOOR,
 *                  a band that falls pulls a finished chapter back to `revisit`, and the row
 *                  carries `owedName`, the topic that fell, by name. Nothing is ever locked.
 *
 * Nothing on this page claims a step this product does not take. The claims verified against the
 * code are listed above; anything Wave 10 has not built is a question in the report, not a line.
 */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react';
import { Label, Sticker, WoboHead } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { CTA } from '../site/cta';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import { checkPoint, graphX, graphY, type Placed, POINT_LINES, POINT_START, place } from './maths';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

const X_TICKS = [1, 2, 3, 4, 5, 6] as const;
const Y_TICKS = [2, 4, 6, 8] as const;

interface Said {
  line: string;
  win: boolean;
  gap: string | null;
  ring: string | null;
}

function DragPoint() {
  const svg = useRef<SVGSVGElement>(null);
  const [pt, setPt] = useState<Placed>(() => place(POINT_START.px, POINT_START.py));
  const [said, setSaid] = useState<Said>({
    line: POINT_LINES.drag,
    win: false,
    gap: null,
    ring: null,
  });
  const dragging = useRef(false);
  const latest = useRef(pt);
  latest.current = pt;

  const move = (next: Placed) => {
    latest.current = next;
    setPt(next);
  };
  const clear = () => setSaid({ line: '', win: false, gap: null, ring: null });
  const check = () => {
    const v = checkPoint(latest.current);
    move(v.point);
    setSaid({ line: v.line, win: v.ok, gap: v.gap, ring: v.ring });
  };

  const toGraph = (e: { clientX: number; clientY: number }): DOMPoint | null => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  };
  const onPointerDown = (e: ReactPointerEvent<SVGCircleElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    clear();
  };
  const onPointerMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!dragging.current) return;
    const p = toGraph(e);
    if (p) move(place(p.x, p.y));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    check();
  };
  const onKeyDown = (e: ReactKeyboardEvent<SVGCircleElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-30, 0],
      ArrowRight: [30, 0],
      ArrowUp: [0, -15],
      ArrowDown: [0, 15],
    };
    const delta = step[e.key];
    if (delta) {
      e.preventDefault();
      clear();
      move(place(latest.current.px + delta[0], latest.current.py + delta[1]));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      check();
    }
  };

  return (
    <div className="hw-dragpt">
      <div className="hw-dq">
        Drag the point to where <i>y = 2x + 1</i> when <i>x = 3</i>.
      </div>
      <svg ref={svg} viewBox="0 0 440 300" role="img" aria-label="A graph with a draggable point">
        <path className="pt-ink pt-thin" d="M50 260 h370 M50 270 v-240" />
        <g>
          {X_TICKS.map((x) => (
            <g key={`x${x}`}>
              <path className="pt-ink pt-thin" d={`M${graphX(x)} 256 v8`} />
              <text
                className="pt-hw pt-dim"
                x={graphX(x)}
                y="284"
                fontSize="16"
                textAnchor="middle"
              >
                {x}
              </text>
            </g>
          ))}
          {Y_TICKS.map((y) => (
            <g key={`y${y}`}>
              <path className="pt-ink pt-thin" d={`M46 ${graphY(y)} h8`} />
              <text
                className="pt-hw pt-dim"
                x="36"
                y={graphY(y) + 6}
                fontSize="16"
                textAnchor="end"
              >
                {y}
              </text>
            </g>
          ))}
        </g>
        <path className="pt-ink pt-pig" d="M50 236 L410 20" opacity=".9" />
        <text className="pt-hw pt-pig" x="330" y="60" fontSize="24">
          y = 2x + 1
        </text>
        <path
          className="pt-ink pt-rose"
          d={said.gap ?? 'M0 0'}
          strokeDasharray="5 6"
          opacity={said.gap ? 1 : 0}
        />
        <path className="pt-ink pt-pig" d={said.ring ?? 'M0 0'} opacity={said.ring ? 1 : 0} />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a draggable point on a graph is neither a button nor a slider; it has a tab stop, a name and the arrow keys */}
        <g
          className="hw-pt"
          tabIndex={0}
          aria-label={`The point, at ${pt.label}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {/* the thumb's target: a clear disc round the drawn point, the touch floor's 44px wide */}
          <circle cx={pt.px} cy={pt.py} r="40" fill="transparent" />
          <circle
            cx={pt.px}
            cy={pt.py}
            r="13"
            fill="var(--rose)"
            stroke="var(--ink)"
            strokeWidth="3.5"
          />
        </g>
        <text className="pt-hw" x={pt.px + 20} y={pt.py - 6} fontSize="22">
          {pt.label}
        </text>
      </svg>
      <div className={said.win ? 'hw-dline hw-win' : 'hw-dline'} aria-live="polite">
        {said.line}
      </div>
    </div>
  );
}

/**
 * The mark on a turn's node: the loop back up. Both turns off the timeline are the same gesture —
 * Wobo goes round again — so both wear the same mark rather than the next number, which would say
 * the loop is another step forward.
 */
function TurnMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12 a8 8 0 1 0 3 -6" />
      <path d="M3 3 v5 h5" />
    </svg>
  );
}

export function HowItWorks() {
  return (
    <SiteShell current="how" title="How Wobo works">
      <div className="pt">
        <section className="pt-hero hw-hero">
          <div className="st-wrap">
            <Label>How it works</Label>
            <h1>
              From "I don't get it" to <em>"oh."</em> In one evening.
            </h1>
            <p className="pt-sub">
              One question, drawn out, tried once, practised until it sticks, and written up on
              Sunday. That's the whole loop. Here it is, step by step, with a bit you can try.
            </p>
            <div className="pt-row">
              <SiteLink className="st-btn st-pig" to={CTA.to}>
                {CTA.label}
              </SiteLink>
              <a className="st-btn st-quiet" href="#try">
                Skip to the bit you can try
              </a>
            </div>
            <div className="hw-strip">
              <svg viewBox="0 0 980 205" role="img" aria-label="Ask, drawn out, try one">
                <rect className="hw-box hw-pig" x="10" y="30" width="280" height="110" rx="22" />
                <text className="hw-t" x="150" y="80" textAnchor="middle">
                  1 · Ask
                </text>
                <text className="hw-s" x="150" y="106" textAnchor="middle">
                  say it, type it, or circle it
                </text>
                <path className="pt-ink hw-arrow" d="M300 85 h40" />
                <path className="pt-ink hw-arrow" d="M330 77 l10 8 l-10 8" />
                <rect className="hw-box hw-mint" x="350" y="30" width="280" height="110" rx="22" />
                <text className="hw-t" x="490" y="80" textAnchor="middle">
                  2 · Drawn out
                </text>
                <text className="hw-s" x="490" y="106" textAnchor="middle">
                  on a board, line by line
                </text>
                <path className="pt-ink hw-arrow hw-a2" d="M640 85 h40" />
                <path className="pt-ink hw-arrow hw-a2" d="M670 77 l10 8 l-10 8" />
                <rect
                  className="hw-box hw-marigold"
                  x="690"
                  y="30"
                  width="280"
                  height="110"
                  rx="22"
                />
                <text className="hw-t" x="830" y="80" textAnchor="middle">
                  3 · Try one
                </text>
                <text className="hw-s" x="830" y="106" textAnchor="middle">
                  Wobo rings the gap, never says wrong
                </text>
                <path className="pt-ink hw-arrow hw-a3 hw-long" d="M830 140 v18 h-680 v-18" />
                <path className="pt-ink hw-arrow hw-a3 hw-long" d="M142 150 l8 -10 l8 10" />
                <text className="pt-hw pt-pig" x="490" y="192" textAnchor="middle" fontSize="22">
                  …and on Sunday, a note home
                </text>
              </svg>
            </div>
          </div>
        </section>

        {/*
          THE TWO MODES, before the loop (docs/SELL.md §2; owner, 2026-09-04: "for doubt
          clarification yes, always any time but to learn its not a day before the exams right").

          The loop below is the LEARNING mode drawn end to end, and a reader who saw only that
          would think Wobo has to be sat down with. It does not: a doubt is answered the moment it
          turns up. Blurring the two sells the product short in both directions, so they are said
          separately, side by side, and the slow one is said as an anti-cramming argument because
          that is what it actually is in the code, not a posture:

            three questions at most   `curriculum/placement.ts` — MAX_PLACEMENT_QUESTIONS = 3, one
                                      per piece of unmet ground, asked before the topic, skippable,
                                      and never a wall.
            completed is not learnt   `screens/learn/mastery.ts` — learnt is completed AND at or
                                      above MASTERY_FLOOR (`secure`); a band that falls pulls a
                                      finished chapter back and names the topic that slipped.
            nothing is locked         both modules say so in their own words: a debt changes what
                                      "next" points at, never what the learner may open.

          Nothing here claims the public ask box tutors a stranger's syllabus question: it answers
          questions about Wobo from the help centre (`askPublic.ts`), and a page that said
          otherwise would be claiming something we cannot show.
        */}
        <section className="pt-tight">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Two rhythms</Label>
              <h2>A doubt and a subject are not the same errand.</h2>
            </Reveal>
            <Reveal className="hw-modes">
              <div>
                <div className="hw-m">A doubt</div>
                <h3>Answered the moment it turns up.</h3>
                <p>
                  Half a sentence is enough, and so is a photo of the worksheet. Wobo works out what
                  is actually being asked and answers it in whatever form the idea needs, so it
                  never gets a chance to pile up into the thing they are afraid of.
                </p>
                <ul>
                  <li>After school, between classes, on the way home, over the weekend</li>
                  <li>
                    Drawn on a board, played as a short film, built as a thing to drag, or said out
                    loud
                  </li>
                  <li>Worked out into the chapter of your own syllabus it belongs to</li>
                </ul>
              </div>
              <div className="hw-slow">
                <div className="hw-m">A subject</div>
                <h3>Built a bit at a time, so exam week is revision.</h3>
                <p>
                  A chapter is not finished because you reached the end of it. Wobo checks the
                  ground underneath before it teaches a topic, and brings one back when what you
                  answered stops holding.
                </p>
                <ul>
                  <li>Three questions at most on the ground beneath a topic, before the topic</li>
                  <li>Completed is not learnt: a topic that stops holding comes back on its own</li>
                  <li>Nothing is ever locked, and the ground check can be skipped</li>
                </ul>
                <span className="hand">
                  Which is why the week before an exam is revision rather than a rescue.
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="hw-step">
              <div className="hw-n">1</div>
              <div>
                <div className="hw-when">Tuesday, after school</div>
                <h2>Ask, the way you'd ask a friend.</h2>
                <p>
                  Half a sentence is fine. A photo of the worksheet is fine. Wobo works out what's
                  actually being asked, and which chapter of your syllabus it lives in.
                </p>
                <div className="pt-say">
                  "wait what's a hypotenuse" <em>is a complete question.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="pt-chat">
                  <div className="pt-t">Tuesday, a minute later</div>
                  <div className="pt-me">
                    q7 says find the hypotenuse, sides 3 and 4. what is that even
                  </div>
                  <div className="pt-wo">
                    The <b>longest side</b> of a right triangle. Give me a second, I'll draw the
                    triangle so you can see it.
                  </div>
                </div>
                <Sticker style={{ right: 22, top: 18 }}>listening</Sticker>
              </div>
            </Reveal>
            <Reveal className="hw-step">
              <div className="hw-n">2</div>
              <div>
                <div className="hw-when">Same sitting</div>
                <h2>Drawn out, one line at a time.</h2>
                <p>
                  Not a paragraph. A board. The triangle appears, then the squares, then the
                  numbers, in the order a good teacher would draw them, with Wobo talking as it
                  goes. Pause it, rewind it, circle any bit and ask why.
                </p>
                <div className="pt-say">
                  You watch the answer <em>get built.</em>
                </div>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 340" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="24" width="460" height="292" rx="22" />
                  <path className="pt-ink pt-draw" d="M150 260 L270 260 L150 170 Z" />
                  <path className="pt-ink pt-thin" d="M150 240 h20 v20" />
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M270 260 L360 140 L240 50 L150 170"
                    style={{ transitionDelay: '.9s' }}
                  />
                  <text className="pt-hw" x="205" y="292" fontSize="24">
                    4
                  </text>
                  <text className="pt-hw" x="120" y="222" fontSize="24">
                    3
                  </text>
                  <text className="pt-hw pt-pig" x="270" y="140" fontSize="26">
                    c²
                  </text>
                  <text className="pt-hw" x="380" y="230" fontSize="28">
                    9 + 16 = 25
                  </text>
                  <text className="pt-hw pt-pig" x="380" y="272" fontSize="32">
                    c = 5
                  </text>
                  <g transform="translate(455 300) rotate(-30)">
                    <rect x="-4" y="-60" width="8" height="46" rx="3" fill="var(--ink)" />
                    <path d="M-4 -14 l4 18 l4 -18 z" fill="var(--pig)" />
                  </g>
                </svg>
                <Sticker rotate={4} style={{ left: 22, bottom: 18 }}>
                  drawing
                </Sticker>
              </div>
            </Reveal>
            <Reveal className="hw-step" id="try">
              <div className="hw-n">3</div>
              <div>
                <div className="hw-when">Same sitting · you try</div>
                <h2>Try one. Wobo rings the gap.</h2>
                <p>
                  Every lesson ends with you doing it, not watching it. Drag the point onto the line
                  where x = 3. If you're off, Wobo doesn't say wrong, it draws where you are and
                  where the line is, and waits.
                </p>
                <div className="pt-say">
                  Close counts. <em>"Close" is what Wobo says.</em>
                </div>
              </div>
              <div className="pt-art">
                <DragPoint />
              </div>
            </Reveal>
            <Reveal className="hw-step hw-turn">
              <div className="hw-n">
                <TurnMark />
              </div>
              <div>
                <div className="hw-when">When step 3 goes wrong</div>
                <h2>The second explanation. Then the third.</h2>
                <p>
                  Two misses on the same idea, not one, and Wobo changes how it is teaching without
                  being asked. One wrong answer is as often a slipped thumb as a misunderstanding.
                  Twice on the same thing is a pattern, and what changes then is the route in, never
                  the volume.
                </p>
                <div className="pt-say">
                  Louder is the one move <em>a good teacher never makes.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="hw-ladder">
                  <div className="hw-tried">
                    <i />
                    <b>The explanation you already read</b>
                    <span>tried</span>
                  </div>
                  <div>
                    <i />
                    <b>One worked all the way through, before the rule</b>
                    <span>the method</span>
                  </div>
                  <div>
                    <i />
                    <b>The same idea drawn on the board instead</b>
                    <span>the picture</span>
                  </div>
                  <div>
                    <i />
                    <b>Put inside something you already know how to think about</b>
                    <span>the example</span>
                  </div>
                  <div>
                    <i />
                    <b>Talked out loud, then you say it back</b>
                    <span>your voice</span>
                  </div>
                  <div className="hand">
                    It remembers which ones it has spent, so coming back tomorrow never starts with
                    the one that did not work. Told it nothing about yourself yet? Then it skips
                    that rung rather than invent a world for you.
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="hw-step">
              <div className="hw-n">4</div>
              <div>
                <div className="hw-when">Any evening · 8 minutes</div>
                <h2>Practice that plays fair.</h2>
                <p>
                  Five short items in the kinds your exam actually uses: shade a region, drag a
                  point, draw a line, put steps in order, type a number. Every one is checked the
                  same way, by ringing the gap, never by flashing red.
                </p>
                <div className="pt-say">
                  Nothing to copy, <em>because there's nothing to copy from.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="hw-kinds">
                  <div>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <rect x="8" y="8" width="40" height="40" rx="6" />
                      <rect className="hw-f" x="8" y="8" width="20" height="40" rx="6" />
                    </svg>
                    shade a region
                  </div>
                  <div>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <path d="M8 44 L48 12" />
                      <circle className="hw-f" cx="30" cy="26" r="7" />
                    </svg>
                    drag a point
                  </div>
                  <div>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <path d="M10 46 h36 M10 46 v-36" />
                      <path className="hw-p" d="M14 40 L44 16" />
                    </svg>
                    draw a line
                  </div>
                  <div>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <rect x="10" y="8" width="36" height="10" rx="4" />
                      <rect x="10" y="23" width="36" height="10" rx="4" />
                      <rect x="10" y="38" width="36" height="10" rx="4" />
                      <path className="hw-p" d="M50 12 v26" />
                    </svg>
                    order the steps
                  </div>
                  <div>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <rect x="8" y="16" width="40" height="24" rx="6" />
                      <text
                        x="28"
                        y="34"
                        textAnchor="middle"
                        fontFamily="Caveat,cursive"
                        fontWeight="700"
                        fontSize="20"
                        fill="var(--pig)"
                        stroke="none"
                      >
                        25
                      </text>
                    </svg>
                    type a number
                  </div>
                  <div>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <circle cx="28" cy="28" r="18" />
                      <path className="hw-p" d="M18 28 l7 7 l14 -14" />
                    </svg>
                    the gap, ringed
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="hw-step hw-turn">
              <div className="hw-n">
                <TurnMark />
              </div>
              <div>
                <div className="hw-when">Whenever it comes back</div>
                <h2>Finished is not the same as learnt.</h2>
                <p>
                  A chapter is not done because you reached the end of it. It is done when what you
                  answered holds, and still holds when Wobo brings it back later. If it stops
                  holding, the chapter returns to your board and names the topic that slipped rather
                  than leaving you to guess. Nothing shuts while you fix it, and nothing ahead is
                  locked either.
                </p>
                <div className="pt-say">
                  Done is what the evidence says, <em>not what the calendar says.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="hw-back">
                  <div>
                    <b>
                      Understanding quadrilaterals
                      <span>four topics, every one of them still holding</span>
                    </b>
                    <em>mastered</em>
                  </div>
                  <div className="hw-fell">
                    <b>
                      Fractions on a number line
                      <span>came back, and this time it did not hold</span>
                    </b>
                    <em>come back to this</em>
                  </div>
                  <div className="hand">
                    The row says which topic fell, out loud. That sentence is the whole distance
                    between a tick quietly going out and <em>deciding you are bad at maths.</em>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="hw-step">
              <div className="hw-n">5</div>
              <div>
                <div className="hw-when">Every day · ten minutes</div>
                <h2>The week adds up.</h2>
                <p>
                  Ten minutes a day beats two hours on Sunday. Wobo keeps the count, notices
                  patterns (asked for help after a miss, twice: good), and says so in its own words,
                  not in a bar chart.
                </p>
                <div className="pt-say">
                  Consistency is <em>the whole trick.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="hw-week">
                  <div className="hand">
                    Three lessons, fourteen problems, and you asked for help twice after a miss,{' '}
                    <em>which is exactly how learning looks.</em>
                  </div>
                  <div className="hw-chart">
                    <i style={{ height: '40%' }} />
                    <i style={{ height: '70%' }} />
                    <i style={{ height: '55%' }} />
                    <i style={{ height: '90%' }} />
                    <i style={{ height: '65%' }} />
                    <i className="hw-k" style={{ height: '20%' }} />
                    <i className="hw-k" style={{ height: '20%' }} />
                  </div>
                  <div className="hw-days">
                    <span>M</span>
                    <span>T</span>
                    <span>W</span>
                    <span>T</span>
                    <span>F</span>
                    <span>S</span>
                    <span>S</span>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="hw-step">
              <div className="hw-n">6</div>
              <div>
                <div className="hw-when">Sunday evening</div>
                <h2>A note home, in Wobo's words.</h2>
                <p>
                  If a parent is linked, they get the same three lines you do. Warm, honest,
                  specific. Not a dashboard, not a percentage. What happened, and what's next.
                </p>
                <div className="pt-say">
                  Parents know how it's going <em>without asking twice.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="hw-note">
                  <div className="hw-d">Sunday, 6 pm</div>
                  <div className="hand">
                    Three lessons this week, and help asked for twice after a miss,{' '}
                    <em>which is exactly how learning looks.</em> Triangles: half done. Next: ten
                    minutes a day.
                  </div>
                  <div className="hw-sig">
                    <WoboHead size={28} />— Wobo
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal>
              <PitchAsk
                page="how"
                heading="Ask Wobo how it works. It answers for itself."
                placeholder="What happens if I don't understand the drawing?"
                chips={[
                  'Can I go back to an old lesson?',
                  'How long is a lesson?',
                  "What if my school's syllabus is different?",
                ]}
              />
            </Reveal>
          </div>
        </section>

        <ClosePanel page="how" />
      </div>
    </SiteShell>
  );
}
