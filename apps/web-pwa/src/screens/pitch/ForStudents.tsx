'use client';

/**
 * /for-students — the page that closes the USER, who is not the person who pays for it.
 *
 * ONE JOB, ONE PRIMARY (docs/SELL.md §6). The job is to close the learner; the primary is the one
 * door in `site/cta.ts`, read through this page's row of `site/handoffs.ts`, and the single quiet
 * second is "See subjects". Nothing else here is a call to action.
 *
 * WHO IS READING. A fifteen year old is the harshest audience there is and leaves the moment a page
 * feels like homework or like an adult performing enthusiasm. So: speak TO them, never about them
 * and never down to them; nothing exclaims; no emoji; no borrowed slang. The hook is RELIEF, not
 * aspiration: they are stuck on one thing, nobody around can explain it, and this will draw it as many
 * times as it takes without ever making them feel stupid. That is the hero, and the rest of the
 * page is the evidence for it.
 *
 * The sections: the paused film with the lasso, ask the basic thing, it draws, it rings the gap
 * (colour half the square — the thing to try), what happens on a second miss, it notices when you
 * nail it (turn the ray to a right angle), the climb and the two looks, your streak your way, the
 * ask block and the close. The prototype is design/prototypes/site-students.html and `pitch.test.ts`
 * holds this page to its words.
 *
 * The two things a visitor can try are real state: the puzzle keeps which cells are lit and
 * what Wobo said about them; the ray keeps its angle. The arithmetic behind both is `maths.ts`.
 *
 * THE SECOND MISS is `wobo/reteach.ts`, and every clause of it was read before it was written:
 * RETEACH_AFTER_MISSES is 2 (one wrong answer is as often a slipped thumb as a misunderstanding);
 * each rung moves an AXIS rather than volume — method (`worked`), representation (`draw`), example
 * (`their_world`), voice (`talk`); the approach that just failed is excluded from the candidates
 * before one is chosen; the `their_world` rung is NOT OFFERED AT ALL when the learner has stated no
 * interest, which is why this page says "only if you've told Wobo what that is"; and the tally and
 * the tried-list are persisted under the learner's own scope, so what has been spent survives a
 * reload. The page claims nothing the module does not do.
 *
 * ADDED BEYOND THE PROTOTYPE — chapter 05, the climb, and the switches under it. A student who
 * reads this page should know that the long game is drawn and that a bad week costs nothing.
 * Every line of it is the code:
 *
 *   the states on the spine     `screens/learn/units.ts` paints a chapter as done / now / next /
 *                               revisit / later / past, and `screens/learn/mastery.ts` decides
 *                               which: held means completed AND at or above MASTERY_FLOOR, and a
 *                               band that falls sends a finished chapter back to `revisit` with
 *                               `owedName`, the topic that slipped, named on the row.
 *   answered all the way        `screens/course/Boss.tsx` — three items, answered in full,
 *                               evaluated at the end.
 *   nothing shuts               mastery.ts, in its own words: the learner is never blocked, every
 *                               chapter and every topic stays tappable, and a debt changes what
 *                               `next` points at rather than what may be opened.
 *   the two looks               `ui/viewPref.ts` — one preference, per learner, whose whole surface
 *                               is two words (`vibeWords`: a chest / unlocked, the gate / chapter
 *                               test) and a `data-vibe` stamp a stylesheet reads. It cannot hide a
 *                               node, reorder one or rename a topic, which is exactly what this
 *                               page claims. `ui/vibe.tsx` draws the switch and both marks;
 *                               `screens/learn/Climb.tsx` renders it over `climb-map.ts`, the one
 *                               set of nodes both looks share.
 *   the two switches            `ui/motion.ts` (data-motion="reduce", which `ui/celebration.tsx`
 *                               collapses every animation to a resolved state for) and the mute in
 *                               `ui/sound.ts`, both rows on the learner's own You screen.
 *
 * WHAT IS DELIBERATELY NOT HERE: a chapter TEST. `climb-map.ts` says it plainly — no module scores
 * a chapter, no event records one, no screen runs one — so this page says a TOPIC ends with a set
 * answered the whole way through (`course/Boss.tsx`, which is true) and never promises an exam at
 * the end of a chapter. The homepage still does; that is a question in the worker's report.
 *
 * ONE DEPENDENCY, STATED: the two looks were built in this same wave. If `ui/viewPref.ts`,
 * `ui/vibe.tsx` and `screens/learn/Climb.tsx` do not ship, the second half of chapter 05 is a
 * claim we cannot show and has to come out with them.
 */

import { useState } from 'react';
import { Label, Sticker } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { START_FREE_HREF } from '../site/cta';
import { handoff } from '../site/handoffs';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  ANGLE_START,
  angleView,
  checkPuzzle,
  PUZZLE_LINES,
  type PuzzleVerdict,
} from './maths';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

/**
 * THE ONE DOOR. The hero and the close both read this page's row of the handoff table
 * (`site/handoffs.ts`), which reads the words from `site/cta.ts`. The page never types a call to
 * action, so the top and the bottom of it cannot drift apart.
 */
const STUDENTS = handoff('students');

const CELLS = ['cell 1', 'cell 2', 'cell 3', 'cell 4'] as const;

function Puzzle() {
  const [lit, setLit] = useState<boolean[]>([false, false, false, false]);
  const [verdict, setVerdict] = useState<PuzzleVerdict>({
    line: PUZZLE_LINES.start,
    win: false,
    ring: null,
  });
  const [show, setShow] = useState(false);

  const toggle = (i: number) => {
    setLit((cells) => cells.map((on, j) => (j === i ? !on : on)));
    setShow(false);
    setVerdict((v) => ({ line: '', win: false, ring: v.ring }));
  };
  const check = () => {
    const v = checkPuzzle(lit);
    // A ring that is not drawn keeps the last loop, so it can draw back on; the word goes with it.
    setVerdict(v.ring ? v : { ...v, ring: verdict.ring });
    setShow(v.ring !== null);
  };
  const reset = () => {
    setLit([false, false, false, false]);
    setShow(false);
    setVerdict((v) => ({ line: PUZZLE_LINES.start, win: false, ring: v.ring }));
  };

  return (
    <div className="su-puzzle">
      <div className="su-pq">
        Colour <i>½</i> of the square.
      </div>
      <div className="su-grid4">
        {CELLS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={lit[i]}
            className={lit[i] ? 'su-lit' : undefined}
            onClick={() => toggle(i)}
          />
        ))}
        <svg viewBox="-40 -40 284 284" aria-hidden="true" className={show ? 'su-show' : undefined}>
          <path d={verdict.ring?.d ?? 'M0 0'} />
          <text x="110" y="238" textAnchor="middle">
            {verdict.ring?.text ?? ''}
          </text>
        </svg>
      </div>
      <div className="pt-row">
        <button type="button" className="st-btn" onClick={check}>
          Check
        </button>
        <button type="button" className="st-btn st-quiet" onClick={reset}>
          Start over
        </button>
      </div>
      <div className={verdict.win ? 'su-line su-win' : 'su-line'} aria-live="polite">
        {verdict.line}
      </div>
    </div>
  );
}

function Angle() {
  const [a, setA] = useState(ANGLE_START);
  const v = angleView(a);
  return (
    <div className="su-angle">
      <svg viewBox="0 0 360 220" role="img" aria-label="Turn the ray to make a right angle">
        <path className="pt-ink" d="M40 190 h280" />
        <g transform={v.transform}>
          <path className="pt-ink pt-pig" d="M40 190 h230" />
        </g>
        <path
          d={v.arc}
          fill="none"
          stroke="var(--rose)"
          strokeWidth="3"
          strokeDasharray="5 6"
          opacity={v.ok ? 0 : 1}
        />
        <text className="pt-hw" x={v.label.x} y={v.label.y} fontSize="28">
          {v.deg}
        </text>
        <path className="pt-ink pt-pig" d="M40 166 h24 v24" opacity={v.ok ? 1 : 0} />
        <circle cx="40" cy="190" r="6" fill="var(--ink)" />
      </svg>
      <input
        type="range"
        min={ANGLE_MIN}
        max={ANGLE_MAX}
        value={a}
        aria-label="angle in degrees"
        onChange={(e) => setA(Number(e.target.value))}
      />
      <div className={v.ok ? 'su-line su-win' : 'su-line'} aria-live="polite">
        {v.line}
      </div>
    </div>
  );
}

const DAYS: readonly { day: string; kind: 'lit' | 'rest' }[] = [
  { day: 'M', kind: 'lit' },
  { day: 'T', kind: 'lit' },
  { day: 'W', kind: 'lit' },
  { day: 'T', kind: 'rest' },
  { day: 'F', kind: 'lit' },
  { day: 'S', kind: 'lit' },
  { day: 'S', kind: 'rest' },
  { day: 'M', kind: 'lit' },
  { day: 'T', kind: 'lit' },
  { day: 'W', kind: 'lit' },
  { day: 'T', kind: 'lit' },
  { day: 'F', kind: 'lit' },
];

export function ForStudents() {
  return (
    <SiteShell current="students" title="Wobo for students">
      <div className="pt">
        <section className="pt-hero su-hero">
          <div className="st-wrap">
            <div>
              <Label>For students</Label>
              {/* THIS HEADLINE USED TO SELL BY RUNNING SOMEBODY DOWN. It read "You're stuck on
                  one thing, and nobody around can explain it." — which tells a child that their
                  teacher, their parent and their sibling cannot help, and puts Wobo against all
                  three. Owner, 2026-09-04: "Lets not degrade tutors or say school is bad; all we do
                  is we talk about what we are capable of and let the viewers be the judge of it."
                  It was also the surviving half of the retired line "It's 10 pm, you're stuck, and
                  nobody is awake": the clock came off and the "nobody" stayed, which is why the
                  lede answered "Wobo is." to a sentence ending "can explain it". The claim now is
                  what Wobo does, and the lede parses with it. */}
              <h1>
                You're stuck on one thing, <em>and you want it drawn out slowly.</em>
              </h1>
              <p className="pt-sub">
                Wobo does that. Ask it the question you'd rather not ask out loud, and it draws the
                answer line by line, as many times as it takes and in as many different ways as it
                takes. Ask the same thing again next week and it starts from the beginning, just as
                patiently.
              </p>
              <div className="pt-row">
                <SiteLink className="st-btn st-pig" href={START_FREE_HREF}>
                  {STUDENTS.primary.label}
                </SiteLink>
                <SiteLink className="st-btn st-quiet" href={STUDENTS.quiet.href ?? '/subjects'}>
                  {STUDENTS.quiet.label}
                </SiteLink>
                <span className="pt-note">Free every day. No card. No trial that ends.</span>
              </div>
            </div>
            <div className="su-film">
              <div className="su-frame">
                <svg
                  viewBox="0 0 480 300"
                  role="img"
                  aria-label="A paused lesson with a loop drawn around the confusing part"
                >
                  <path className="pt-ink pt-thin" d="M60 240 h360 M80 260 v-220" />
                  <path className="pt-ink" d="M80 220 c60 -20 120 -120 300 -140" />
                  <text className="pt-hw" x="300" y="70" fontSize="26">
                    y = x²
                  </text>
                  <text className="pt-hw pt-dim" x="120" y="280" fontSize="20">
                    paused · 0:38
                  </text>
                  <path
                    className="pt-ink pt-pig su-lasso"
                    d="M196 150 c-18 26 -6 68 36 70 s76 -10 74 -44 s-30 -52 -66 -48 s-40 8 -44 22"
                  />
                </svg>
                <div className="su-q">wait, why does it curve?</div>
              </div>
              <div className="su-bar">
                <span className="su-p">
                  <i />
                </span>
                <span className="su-track" />
                <span>0:38 / 1:42</span>
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
                  Ask the <span className="pt-hl">basic</span> thing.
                </h2>
                <p>
                  "What even is a hypotenuse." "Why is it called integration." "Is the mitochondria
                  the thing or the place." Wobo doesn't keep score of what you should already know,
                  and there is nobody else in the room. It just answers.
                </p>
                <div className="pt-say">
                  Ask it twice. <em>Ask it ten times.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="pt-chat">
                  <div className="pt-t">Tuesday, after school</div>
                  <div className="pt-me">ok dumb question but what actually is a hypotenuse</div>
                  <div className="pt-wo">
                    Not dumb. It's the <b>longest side</b> of a right triangle, the one opposite the
                    square corner. Want me to draw it?
                  </div>
                  <div className="pt-me">yes</div>
                  <div className="pt-wo">Drawing… watch the corner first.</div>
                </div>
                <Sticker style={{ right: 22, top: 18 }}>no judgement</Sticker>
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
                  It <span className="pt-hl">draws</span>, it doesn't lecture.
                </h2>
                <p>
                  You don't get a wall of text. You get a board, a pen, and the answer appearing one
                  line at a time so you can see where each bit comes from. Pause it. Rewind it.
                  Scribble on it.
                </p>
                <div className="pt-say">
                  If you can watch it being drawn, <em>you can draw it in the exam.</em>
                </div>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 360" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="30" width="460" height="300" rx="22" />
                  <path className="pt-ink pt-draw" d="M170 270 L290 270 L170 180 Z" />
                  <path className="pt-ink pt-thin" d="M170 250 h20 v20" />
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M290 270 L380 150 L260 60 L170 180"
                    style={{ transitionDelay: '.9s' }}
                  />
                  <text className="pt-hw pt-pig" x="290" y="150" fontSize="28">
                    c²
                  </text>
                  <text className="pt-hw" x="225" y="302" fontSize="24">
                    4
                  </text>
                  <text className="pt-hw" x="140" y="234" fontSize="24">
                    3
                  </text>
                  <text className="pt-hw" x="400" y="290" fontSize="34">
                    c = 5
                  </text>
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M388 262 c-12 20 -6 44 30 46 s66 -6 64 -30 s-24 -40 -56 -36 s-32 8 -38 20"
                    style={{ transitionDelay: '1.6s' }}
                  />
                  <g transform="translate(455 300) rotate(-30)">
                    <rect x="-4" y="-60" width="8" height="46" rx="3" fill="var(--ink)" />
                    <path d="M-4 -14 l4 18 l4 -18 z" fill="var(--pig)" />
                  </g>
                </svg>
                <Sticker rotate={4} style={{ left: 22, bottom: 18 }}>
                  line by line
                </Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="try">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">03</div>
                <h2>
                  It <span className="pt-hl">rings the gap</span>, it never says wrong.
                </h2>
                <p>
                  Try it. Colour half the square. If you're off, Wobo doesn't flash red, it draws a
                  loop around what you did and tells you what it actually is. Then you go again.
                </p>
                <div className="pt-say">
                  Wrong isn't a word Wobo uses. <em>"Close" is.</em>
                </div>
              </div>
              <div className="pt-art">
                <Puzzle />
              </div>
            </Reveal>
            <Reveal className="pt-chapter pt-flip pt-tight">
              <div>
                <h2>
                  Miss it twice and it <span className="pt-hl">changes the whole approach</span>.
                </h2>
                <p>
                  You don't have to say you're lost, and you don't have to ask again. On a second
                  miss Wobo stops explaining and does something else: works one all the way through
                  instead of stating the rule, or draws the shape of it, or puts it inside something
                  you already know how it behaves, or talks it out until you say it back.
                </p>
                <p>
                  It never hands you the one that just failed, and it remembers which ones it has
                  spent, so tomorrow starts somewhere new instead of at the top again.
                </p>
                <div className="pt-say">
                  Two misses isn't a verdict. <em>It's a signal to try another way.</em>
                </div>
              </div>
              <div className="pt-art">
                <ul className="su-climb">
                  <li className="su-slip">
                    <i />
                    <div>
                      <b>The explanation that just missed</b>
                      <span>never offered to you again</span>
                    </div>
                  </li>
                  <li className="su-here">
                    <i />
                    <div>
                      <b>One worked all the way through</b>
                      <span>the method changes, not the volume</span>
                    </div>
                  </li>
                  <li className="su-open">
                    <i />
                    <div>
                      <b>The same idea, drawn</b>
                      <span>when a sentence won't go in, a shape often does</span>
                    </div>
                  </li>
                  <li className="su-open">
                    <i />
                    <div>
                      <b>Put inside something you're into</b>
                      <span>only if you've told Wobo what that is</span>
                    </div>
                  </li>
                  <li className="su-open">
                    <i />
                    <div>
                      <b>Talked out, then you say it back</b>
                      <span>the one that sticks hardest</span>
                    </div>
                  </li>
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter pt-flip">
              <div>
                <div className="pt-num">04</div>
                <h2>
                  It <span className="pt-hl">notices</span> when you nail it.
                </h2>
                <p>
                  Not a confetti cannon every five seconds. A small, specific fuss when you actually
                  get something, and a quiet note of what you're good at that builds up over the
                  term. Drag the ray to a right angle and see.
                </p>
                <div className="pt-say">
                  Nothing is handed to you. <em>So nothing is hollow.</em>
                </div>
              </div>
              <div className="pt-art">
                <Angle />
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="climb">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">05</div>
                <h2>
                  The <span className="pt-hl">climb</span> is yours, and nothing behind you shuts.
                </h2>
                <p>
                  Every chapter is a checkpoint you can see from where you are standing. A topic
                  ends with a set you answer the whole way through and get marked at the end, not
                  one nervous question at a time. Everything you have already opened stays open, so
                  a bad week costs you no ground at all.
                </p>
                <p>
                  And when something slips, it comes back and says which one, by name. That is the
                  reason you are not the person quietly lost in March.
                </p>
                <div className="pt-say">
                  It comes back for you. <em>That isn't a punishment.</em>
                </div>
              </div>
              <div className="pt-art">
                {/* Real text, not text inside a drawing: an SVG label scales with its viewBox and
                    lands under the 13px floor on a phone, where this is read most. */}
                <ul className="su-climb">
                  <li className="su-open">
                    <i />
                    <div>
                      <b>The rest of the chapter</b>
                      <span>open, whenever you want it</span>
                    </div>
                  </li>
                  <li className="su-here">
                    <i />
                    <div>
                      <b>Mixed numbers</b>
                      <span>where you are</span>
                    </div>
                  </li>
                  <li className="su-held">
                    <i />
                    <div>
                      <b>Adding unlike denominators</b>
                      <span>held</span>
                    </div>
                  </li>
                  <li className="su-slip">
                    <i />
                    <div>
                      <b>Equivalent fractions</b>
                      <span>slipped, so it came back</span>
                    </div>
                  </li>
                  <li className="su-held">
                    <i />
                    <div>
                      <b>Fractions on a number line</b>
                      <span>right a week on</span>
                    </div>
                  </li>
                </ul>
              </div>
            </Reveal>
            <Reveal className="pt-chapter pt-flip pt-tight">
              <div>
                <h2>
                  Two looks. The <span className="pt-hl">same climb</span> underneath.
                </h2>
                <p>
                  Quest draws the path with a chest where you earn one and a gate at the end of the
                  chapter, and writes its notes by hand. Focused draws the same nodes, in the same
                  order, with the costume off. The switch is allowed to change two words and how a
                  thing is drawn. It cannot hide a node, move one, rename a topic or change what you
                  have to know, so picking the quiet one costs you nothing at all.
                </p>
                <p>
                  If even that is more than you want, one switch stills every animation and one
                  mutes every sound. Neither of those changes what you're taught either.
                </p>
                <div className="pt-say">
                  Not too childish, <em>if that isn't you.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="su-vibe">
                  <div className="su-vpick">
                    <b className="su-von">Quest</b>
                    <b>Focused</b>
                  </div>
                  <div className="su-vpair">
                    <div>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 9.5 h18 v9 a1.5 1.5 0 0 1 -1.5 1.5 h-15 A1.5 1.5 0 0 1 3 18.5 z" />
                        <path d="M3 9.5 L5 4.5 h14 l2 5 M12 9.5 v10.5 M9.5 13.5 h5" />
                      </svg>
                      <b>A chest</b>
                      <span>Mixed numbers</span>
                    </div>
                    <div>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                        <path d="M8 10.5 V7.5 a4 4 0 0 1 7.4 -2.1" />
                      </svg>
                      <b>Unlocked</b>
                      <span>Mixed numbers</span>
                    </div>
                  </div>
                  <div className="hand">
                    One node, two costumes. Same topic, same place in the chapter, same standard.
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">06</div>
                <h2>
                  Your <span className="pt-hl">streak</span>, your way.
                </h2>
                <p>
                  Ten minutes a day is the whole trick, and Wobo keeps the count. But rest days
                  don't break it and nobody gets a guilt notification after hours. It's your streak,
                  not the app's.
                </p>
                <div className="pt-say">
                  Consistency beats cramming. <em>Every single time.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="su-streak">
                  <div className="su-n">
                    12<small>days, your way</small>
                  </div>
                  <div className="su-days">
                    {DAYS.map((d, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed twelve-day strip; the letters repeat
                      <i key={i} className={d.kind === 'lit' ? 'su-lit' : 'su-rest'}>
                        {d.day}
                      </i>
                    ))}
                  </div>
                  <div className="hand">Thursday and Sunday off. Still 12.</div>
                </div>
                <Sticker style={{ right: 22, top: 18 }}>no guilt</Sticker>
              </div>
            </Reveal>
            <Reveal className="pt-chapter pt-flip pt-tight">
              <div>
                <h2>
                  Ask <span className="pt-hl">now</span>. Learn slowly.
                </h2>
                <p>
                  Two different things, and mixing them up is the whole reason exam week feels the
                  way it does. A doubt is whatever just stopped you, and you ask it the moment it
                  turns up: after school, on the way home, over the weekend, in the ten minutes
                  before practice. Learning is the slow one and it goes a bit at a time.
                </p>
                <p>
                  Which is the only reason the week before an exam can be you reading things you
                  already know, instead of meeting half of them for the first time. Wobo is built
                  for that on purpose, so it is a poor thing to open once a term and a good one to
                  open most days.
                </p>
                <div className="pt-say">
                  One of them is urgent. <em>The other one is why it never has to be.</em>
                </div>
              </div>
              <div className="pt-art">
                <div className="pt-modes">
                  <div>
                    <span>A doubt</span>
                    <b>Ask it the moment it lands</b>
                    <p>
                      Wherever you are, in whatever form makes it go in: drawn on a board, filmed,
                      turned into something to drag, or talked through out loud.
                    </p>
                    <em>Any time</em>
                  </div>
                  <div className="pt-slow">
                    <span>Learning</span>
                    <b>Ten minutes, most days</b>
                    <p>
                      The ground first, then the topic, then it comes back the moment the evidence
                      says it slipped. Nothing counts as done until it holds.
                    </p>
                    <em>So the week before is revision</em>
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
                page="students"
                heading="Ask Wobo about Wobo. It answers for itself."
                placeholder="Will you tell my parents what I asked?"
                chips={[
                  'Can I ask for help as many times as I want?',
                  'What happens to my streak if I rest?',
                  'Are you a boy or a girl?',
                ]}
              />
            </Reveal>
          </div>
        </section>

        <ClosePanel page="students" />
      </div>
    </SiteShell>
  );
}
