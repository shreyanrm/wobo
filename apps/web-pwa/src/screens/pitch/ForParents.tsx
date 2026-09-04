'use client';

/**
 * /for-parents — the page that closes the payer.
 *
 * ONE JOB, ONE PRIMARY (docs/SELL.md §6). The job is to close the person who pays; the primary
 * action is the door in `site/cta.ts`, said in the payer's own words, and the one quiet second is
 * "See plans". Nothing else on this page is a call to action, because two of equal weight convert
 * worse than one.
 *
 * THE ARC, and why it is this arc (docs/SELL.md §1). A parent arrives worried, guilty and out of
 * their depth, and they ALREADY KNOW the problem. Describing their child's struggle back to them is
 * a sales page performing empathy, and it is what the previous version of this page opened with —
 * a chapter about traffic and an 8 pm message from home. It is gone. The page now opens on what
 * changes, and then answers the four things a payer actually decides on, in the order the doubts
 * arrive:
 *
 *   01  WHAT THEY GET TO SEE   the weekly report, drawn as the app draws it — what was learnt, what
 *                              needed another pass, what is coming, and a projection ONLY where
 *                              there is real history to project from.
 *   02  WHY IT WORKS           the six things a great teacher does, every one of them built.
 *   03  WHAT IT COSTS          free every day, and what happens if they stop.
 *   04  WHAT WE HOLD           one honest block, handing off to the security page.
 *
 * WE NEVER SELL BY RUNNING ANYTHING DOWN (owner, 2026-09-04; DESIGN.md §0; docs/SELL.md §2). Not a
 * teacher, not a school, not a tuition centre, not another product. There is no comparison on this
 * page, no price against anyone else's, and no implication. The pitch is EVERYTHING A GREAT TEACHER
 * DOES, FOR ONE CHILD, AT TEN AT NIGHT, which honours the craft instead of borrowing against it —
 * and most of the parents reading this loved a teacher who changed something for them.
 *
 * EVERY CLAIM IN CHAPTER 02 IS IN THIS CODEBASE, and was checked against it before it was written:
 *
 *   draws while it explains   `wobo/board-turn.ts` + `wobo/board-stream.ts` answer on the board;
 *                             `wobo/video.ts` films it; `wobo/paths/types.ts` carries the component
 *                             path a learner drags (`engines/SimRunner.tsx`); `wobo/voice.ts`
 *                             speaks it. Four forms, one answer.
 *   changes method            `wobo/reteach.ts` — RETEACH_AFTER_MISSES is 2, the ladder moves an
 *                             AXIS rather than volume (method, representation, example, voice), it
 *                             never re-offers the approach that just failed, and what has been
 *                             tried survives a reload.
 *   teaches the ground first  `curriculum/prereq.ts` derives the edges and labels each with where
 *                             it came from; `curriculum/placement.ts` checks it in at most
 *                             MAX_PLACEMENT_QUESTIONS (three), every one skippable; `wobo/bridge.ts`
 *                             teaches the thin piece as card one of the SAME lesson.
 *   does not move on          `screens/learn/mastery.ts` — learnt is completed AND at or above
 *                             MASTERY_FLOOR, and a band that falls pulls a finished chapter back.
 *   brings back what slipped  `screens/learn/units.ts` carries `owedName`, so the row NAMES the
 *                             topic that fell. And the learner is never blocked: every chapter
 *                             stays tappable, which is the answer in the FAQ.
 *   the example from their    `store/mind.ts` (`rememberInterests`, `preferredAnalogy`) and the
 *   world                     `their_world` rung of the ladder, which is NOT OFFERED AT ALL when
 *                             the learner has stated no interest — Wobo explains plainly rather
 *                             than inventing a world for them.
 *
 * THE REPORT MOCK is the shape of `screens/progress/Report.tsx` and its `evidence.ts`: the three
 * figures at the top are its own (minutes, topics learnt, held a week later), the three lists are
 * its own headings, and the projection line is `projectFinish`, which refuses to draw a line at all
 * until there is a pace to draw one from. The panel says in its own words that its numbers are an
 * example, because the copy law forbids a fabricated figure and a mock with no label is one.
 *
 * Law v5's copy law (DESIGN.md §0) governs every word. NO NAMES: the child here is "your child",
 * never an invented learner and never "she" or "he". NO GRADE GATE. NO RAW ALLOWANCE: the drawing
 * says what an evening feels like rather than counting questions. CANCEL, NEVER REFUND: this page
 * promises no money back, only that nothing renews. Wobo is "it" in every sentence.
 */

import { useId } from 'react';
import { Label, WoboHead } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { START_FREE_HREF } from '../site/cta';
import { handoff } from '../site/handoffs';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

/**
 * THE ONE DOOR. Both the hero and the close read this page's own row of the handoff table
 * (`site/handoffs.ts`), which reads the words from `site/cta.ts`. The page cannot type a call to
 * action, so the top of the page and the bottom of it cannot say two different things, and the day
 * the owner wants the payer's own words on this button ("Set it up for my child") it is one line in
 * the table rather than a grep across the site.
 */
const PARENTS = handoff('parents');

/**
 * The six things, in the order a parent can follow: what a lesson does, what it does when the
 * lesson misses, what it does before the lesson, what it does at the end of one, what it does weeks
 * later, and whose world it borrows. Every `p` was checked against the module named beside it in
 * the note at the top of this file.
 */
interface Craft {
  title: string;
  what: string;
  /** The drawn mark. Ink at 2.5px or more, as every mark on this site is. */
  mark: string;
}

const SIX: readonly Craft[] = [
  {
    title: 'It draws while it explains.',
    what: 'The answer arrives on a board, a line at a time, so your child watches the idea appear instead of reading a finished one. Where drawing is not the right form, the same answer becomes a short film, a thing to drag, or a voice talking it through.',
    mark: 'M8 32 c8 -14 14 -18 22 -8 s10 12 16 -4 M8 12 h28',
  },
  {
    title: 'It changes method after a second miss.',
    what: 'Never the same explanation again, louder. A worked example instead of a rule, the same idea drawn, an analogy from something your child already cares about, or talked out loud until they can say it back. It remembers which ones it has spent, so tomorrow starts somewhere new.',
    mark: 'M10 14 h18 a8 8 0 0 1 0 16 h-18 M16 8 l-6 6 l6 6 M28 24 l6 6 l-6 6',
  },
  {
    title: 'It teaches the ground first.',
    what: 'Before a topic that stands on older work, two or three short questions about that older work. If a piece of it is thin, that piece is taught as the opening of the same lesson, and every one of those questions can be skipped.',
    mark: 'M22 6 v14 M8 20 h28 M8 20 v14 M22 20 v14 M36 20 v14',
  },
  {
    title: 'It does not move on until it stays learnt.',
    what: 'Reaching the end of a chapter is not the same as holding it. A chapter counts as done when what your child answered is still right the next time Wobo brings it back.',
    mark: 'M8 24 l8 8 l18 -20 M34 8 v10 h-10',
  },
  {
    title: 'It brings back what slipped.',
    what: 'When something stops holding, it returns to your child’s board and names the topic that fell. The one moment a child is told they have gone backwards is spent saying which thing, and never on a grade.',
    mark: 'M10 22 a12 12 0 1 0 4 -9 M10 10 v8 h8',
  },
  {
    title: 'It builds the example from their world.',
    what: 'If your child has told Wobo what they are into, the analogy is built out of that. If they have told it nothing, Wobo explains plainly rather than inventing a world for them.',
    mark: 'M22 8 a14 14 0 1 0 0 28 a14 14 0 1 0 0 -28 M8 22 h28 M22 8 c6 7 6 21 0 28 c-6 -7 -6 -21 0 -28',
  },
];

/** Minutes a day across one week, as the report's own chart draws them. Example numbers. */
const WEEK: readonly { day: string; minutes: number; height: string }[] = [
  { day: 'Monday', minutes: 18, height: '58%' },
  { day: 'Tuesday', minutes: 24, height: '77%' },
  { day: 'Wednesday', minutes: 0, height: '8%' },
  { day: 'Thursday', minutes: 31, height: '100%' },
  { day: 'Friday', minutes: 12, height: '39%' },
  { day: 'Saturday', minutes: 11, height: '35%' },
  { day: 'Sunday', minutes: 0, height: '8%' },
];

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Will it just give my child the answers?',
    a: "No. Wobo draws the reasoning and asks your child to take the next step. When they're close, it rings the gap on their answer and waits. Copying isn't possible, because there's nothing to copy until they've done the thinking.",
  },
  {
    q: "Does it follow our school's syllabus, or a generic one?",
    a: "Your school's. You pick the board and class when you set up, and Wobo teaches the chapter your class is on this week, in the order your textbook uses. If your school does something differently, tell Wobo and it adjusts.",
  },
  {
    q: 'Is it safe for a ten-year-old to talk to?',
    a: "Yes, and it's built for exactly that. Wobo stays inside school subjects, has no opinions on anything contested, shows no ads, and never makes a child feel small. Voice isn't stored. You can read the full detail on the Security and trust page.",
  },
  {
    q: 'Can I see what my child asks?',
    a: "You see every lesson, practice set and the Sunday note. Questions word for word are shared only if your child allows it. We think that's what a good tutor would do too.",
  },
  {
    q: 'What does it cost?',
    a: 'Nothing, every day, with a daily allowance of questions. Pro and Max raise that allowance for exam season. The plans page has the numbers for your country.',
  },
  {
    q: 'What happens if I stop paying?',
    a: 'Nothing renews, the plan runs to the end of the period already paid for, and then the account goes back to the free one, which never ends. Everything learnt stays exactly where it is. Cancelling takes as many taps as subscribing, and the screen that does it offers no discount, no pause and no reason picker.',
  },
  {
    q: 'Which subjects?',
    a: 'Every subject your board sets, for CBSE, ICSE and the state boards. Other boards and countries are added as families ask.',
  },
  {
    q: 'Will it hold my child back?',
    a: 'No. Nothing in Wobo locks, ever. Your child can open any chapter they like, whenever they like, including one we would not have suggested yet. What the check on older ground changes is only what Wobo teaches FIRST inside the lesson they opened, and if they would rather skip that, they can.',
  },
  {
    q: 'What happens when my child gets the same thing wrong twice?',
    a: 'Wobo changes how it is teaching, without being asked and without being told there is a problem. Not the same explanation again: a worked example instead of a rule, or the same idea drawn, or put into something your child already cares about, or talked through out loud until they can say it back. It never repeats the one that just failed, and it remembers which ones it has already spent, so tomorrow starts somewhere new.',
  },
];

/** The prototype's own drawn head, for the one place it sits inside another drawing. */
function DrawnHead() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 120 120" width="80" height="80" x="-40" y="-40" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-hg`} cx="36%" cy="30%" r="80%">
          <stop offset="0" style={{ stopColor: 'var(--body-hi)' }} />
          <stop offset="1" style={{ stopColor: 'var(--body)' }} />
        </radialGradient>
        <linearGradient id={`${id}-vg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--visor)' }} />
          <stop offset="1" style={{ stopColor: 'var(--visor-lo)' }} />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="52" fill={`url(#${id}-hg)`} />
      <rect x="18" y="41" width="84" height="38" rx="19" fill={`url(#${id}-vg)`} />
      <g className="pt-blink">
        <circle cx="43" cy="61" r="9" fill="var(--eye)" />
        <circle cx="77" cy="61" r="9" fill="var(--eye)" />
        <circle cx="40" cy="58" r="3" fill="var(--paper)" opacity=".85" />
        <circle cx="74" cy="58" r="3" fill="var(--paper)" opacity=".85" />
      </g>
    </svg>
  );
}

/**
 * The weekly report, drawn as `screens/progress/Report.tsx` draws it, with example numbers and a
 * line saying so. The chart is one image to a screen reader, with every bar read out in its label,
 * because seven separate stubs are seven pieces of noise.
 */
function ReportPanel() {
  const chartLabel = `Minutes a day: ${WEEK.map((d) => `${d.day} ${d.minutes}`).join('; ')}.`;
  return (
    <div className="pa-report">
      <div className="pa-rtop">
        <WoboHead size={28} />
        <b>This week</b>
        <span>drawn from your child’s own record</span>
      </div>
      <div className="pa-kpis">
        <div>
          <b>
            96<i>min</i>
          </b>
          <span>Minutes</span>
          <em>across four evenings</em>
        </div>
        <div>
          <b>
            7<i>of 9</i>
          </b>
          <span>Topics learnt</span>
          <em>one needs another pass</em>
        </div>
        <div>
          <b>
            82<i>%</i>
          </b>
          <span>Held a week later</span>
          <em>measured only after a week</em>
        </div>
      </div>
      <div className="pa-chart">
        <div className="pa-ctop">
          <b>Minutes a day</b>
          <span>best day 31 min</span>
        </div>
        <div className="pa-bars" role="img" aria-label={chartLabel}>
          {WEEK.map((d) => (
            <i
              key={d.day}
              className={d.minutes === 0 ? 'pa-off' : undefined}
              style={{ height: d.height }}
            />
          ))}
        </div>
      </div>
      <div className="pa-lists">
        <div>
          <span>What was learnt</span>
          <b>Understanding quadrilaterals</b>
          <b>Fractions on a number line</b>
        </div>
        <div className="pa-pass">
          <span>Needed another pass</span>
          <b>Equivalent fractions</b>
        </div>
        <div>
          <span>What is coming</span>
          <b>Mixed numbers</b>
          <b>Sound</b>
        </div>
      </div>
      <div className="pa-proj">
        At this pace, all nine topics are behind them by around the middle of November.
        <em>Drawn from their own pace, and it says so on the report.</em>
      </div>
      <div className="pa-eg">
        Drawn here with example numbers. Your child’s report carries theirs, and shows nothing it
        cannot measure yet.
      </div>
    </div>
  );
}

export function ForParents() {
  return (
    <SiteShell current="parents" title="Wobo for parents">
      <div className="pt">
        <section className="pt-hero pa-hero">
          <div className="st-wrap">
            <div>
              <Label>For parents</Label>
              <h1>
                Everything a great teacher does, <em>for one child, whenever they want to learn.</em>
              </h1>
              <p className="pt-sub">
                Wobo teaches your child’s own syllabus, draws the answer until it lands, and shows
                you what actually moved this week. You set it up once. It runs on its own after
                that.
              </p>
              <div className="pt-row">
                <SiteLink className="st-btn st-pig" href={START_FREE_HREF}>
                  {PARENTS.primary.label}
                </SiteLink>
                <SiteLink className="st-btn st-quiet" href={PARENTS.quiet.href ?? '/plans'}>
                  {PARENTS.quiet.label}
                </SiteLink>
                <span className="pt-note">Free every day. No card to start.</span>
              </div>
            </div>
            <div className="pa-env">
              <svg
                viewBox="0 0 480 400"
                role="img"
                aria-label="A Sunday note rising out of its envelope"
              >
                <rect x="60" y="212" width="360" height="170" rx="18" fill="var(--pig)" />
                <g className="pa-letter">
                  <rect
                    x="90"
                    y="60"
                    width="300"
                    height="300"
                    rx="14"
                    fill="var(--paper)"
                    stroke="var(--ink)"
                    strokeWidth="3.5"
                  />
                  <text className="pt-hw pt-dim" x="116" y="100" fontSize="20">
                    Sunday, 6 pm
                  </text>
                  <text className="pt-hw" x="116" y="140" fontSize="26">
                    Your child asked for help
                  </text>
                  <text className="pt-hw" x="116" y="172" fontSize="26">
                    twice after a miss, <tspan className="pt-hw pt-rose">which is</tspan>
                  </text>
                  <text className="pt-hw pt-rose" x="116" y="204" fontSize="26">
                    how learning looks.
                  </text>
                  <text className="pt-hw" x="116" y="248" fontSize="26">
                    Next: the other half of
                  </text>
                  <text className="pt-hw" x="116" y="280" fontSize="26">
                    triangles. — Wobo
                  </text>
                </g>
                <path
                  d="M60 230 h360 v134 a18 18 0 0 1 -18 18 h-324 a18 18 0 0 1 -18 -18 z"
                  fill="var(--pig)"
                />
                <path
                  d="M60 230 L240 340 L420 230"
                  fill="none"
                  stroke="rgba(255,255,255,.35)"
                  strokeWidth="3"
                />
                <path className="pa-flap" d="M60 230 L240 320 L420 230 Z" fill="var(--violet)" />
                <g transform="translate(404 350)">
                  <DrawnHead />
                </g>
              </svg>
            </div>
          </div>
        </section>

        <section className="st-section" id="see">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">01</div>
                <h2>What was learnt, what needed another pass, and what is coming.</h2>
                <p>
                  A report drawn from your child’s own record and nothing else. Minutes and the
                  evenings behind them, topics learnt, and how much of it was still right a week
                  later. Where there is not enough history to say something, it says so instead of
                  filling the space.
                </p>
                <div className="pa-caps">
                  <div className="pa-t">On the report</div>
                  <div>What was learnt, and what slipped back.</div>
                  <div>What held a week after it was first answered.</div>
                  <div>
                    <em>A finish line drawn from their own pace, once there is a pace.</em>
                  </div>
                </div>
              </div>
              <div className="pt-art">
                <ReportPanel />
              </div>
            </Reveal>
            <Reveal className="pt-chapter pt-flip pt-tight">
              <div>
                <h2>What you see, and what you don’t.</h2>
                <p>
                  Every lesson, every practice set, the streak, and the Sunday note. What you don’t
                  see is your child’s questions word for word, unless they choose to share them.
                  Trust runs both ways.
                </p>
                <div className="pa-caps">
                  <div>
                    You’ll know how it’s going <em>without asking twice.</em>
                  </div>
                </div>
              </div>
              <div className="pt-art">
                <div className="pa-mock">
                  <div className="pa-top">
                    <WoboHead size={32} />
                    <b>Your child</b>· CBSE · this week
                  </div>
                  <div className="pa-row">
                    <div>
                      <b>Triangles and the hypotenuse</b>
                      <span>Lesson 3 of 5 · Tuesday 9:46 pm</span>
                    </div>
                    <span className="pa-ok pa-now">in progress</span>
                  </div>
                  <div className="pa-row">
                    <div>
                      <b>Understanding quadrilaterals</b>
                      <span>4 lessons · practice 9 of 10</span>
                    </div>
                    <span className="pa-ok">mastered</span>
                  </div>
                  <div className="pa-row">
                    <div>
                      <b>Sound</b>
                      <span>Science · starts after the test</span>
                    </div>
                    <span className="pa-ok pa-next">next</span>
                  </div>
                  <div className="pa-note">
                    Three lessons, fourteen problems, and help asked for twice after a miss,{' '}
                    <em>which is exactly how learning looks.</em>
                  </div>
                  <div className="pa-lock">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="5" y="10" width="14" height="10" rx="3" />
                      <path d="M8 10 v-3 a4 4 0 0 1 8 0 v3" />
                    </svg>
                    Questions word for word: shared only if your child allows
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="why">
          <div className="st-wrap">
            <Reveal className="pa-head">
              <div className="pt-num">02</div>
              <h2>Six things a great teacher does. Wobo does all six.</h2>
              <p>
                Not one of them is a setting to find or a button to press. They happen inside the
                lesson, on their own, whether or not anyone is watching.
              </p>
            </Reveal>
            <Reveal className="pa-six">
              {SIX.map((item) => (
                <div className="st-tile" key={item.title}>
                  <svg viewBox="0 0 44 44" aria-hidden="true">
                    <path d={item.mark} />
                  </svg>
                  <h3>{item.title}</h3>
                  <p>{item.what}</p>
                </div>
              ))}
            </Reveal>
            <Reveal className="pt-chapter">
              <div>
                <h2>The ground under this week’s chapter.</h2>
                <p>
                  A child rarely falls behind on this week’s chapter. They fall behind on a chapter
                  from two years ago that nobody ever went back for, and every chapter built on top
                  of it costs a little more. So before Wobo teaches a topic that stands on older
                  ground, it asks two or three short questions about that ground, and teaches
                  whatever is thin as the opening of the same lesson.
                </p>
                <div className="pa-caps">
                  <div className="pa-t">What that means at your table</div>
                  <div>Three questions at most, and your child can skip any of them.</div>
                  <div>
                    The missing piece is taught inside the lesson, never as a separate exercise your
                    child has to find their way back from.
                  </div>
                  <div>Nothing is ever locked. A chapter your child wants to open, opens.</div>
                  <div>
                    <em>They stop falling further behind.</em>
                  </div>
                </div>
              </div>
              <div className="pt-art">
                <div className="pa-ground">
                  <div className="pa-top-row">
                    <b>This week’s chapter</b>
                    <span>what the class is on</span>
                  </div>
                  <svg viewBox="0 0 360 66" aria-hidden="true">
                    <path
                      className="pt-ink pt-thin"
                      d="M180 2 v18 M60 20 h240 M60 20 v42 M180 20 v42 M300 20 v42"
                    />
                  </svg>
                  <div className="pa-stones">
                    <div>
                      <b>Fractions</b>
                      <em>solid</em>
                    </div>
                    <div className="pa-thin">
                      <b>Ratios</b>
                      <em>thin, so this is taught first</em>
                    </div>
                    <div>
                      <b>Negatives</b>
                      <em>solid</em>
                    </div>
                  </div>
                  <div className="hand">
                    Nobody fails the chapter in front of them. They failed the one holding it up.
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="pt-chapter pt-flip pt-tight">
              <div>
                <h2>And &ldquo;mastered&rdquo; has to be earned twice.</h2>
                <p>
                  A chapter is not marked done because your child reached the end of it. It is done
                  when what they answered holds, and still holds when Wobo brings it back later.
                  When something stops holding, the chapter comes back on their board and names the
                  topic that slipped, so the one moment a child is told they have gone backwards is
                  spent saying which thing, and not on a grade.
                </p>
                <div className="pa-caps">
                  <div>
                    You will see a chapter reopen sometimes.{' '}
                    <em>That is the product working, not failing.</em>
                  </div>
                </div>
              </div>
              <div className="pt-art">
                <div className="pa-earned">
                  <div>
                    <b>
                      Understanding quadrilaterals
                      <span>finished, and it held when it came back</span>
                    </b>
                    <em>mastered</em>
                  </div>
                  <div className="pa-fell">
                    <b>
                      Fractions on a number line
                      <span>finished three weeks ago, and this time it did not hold</span>
                    </b>
                    <em>come back to this</em>
                  </div>
                  <div className="hand">
                    A tick that can go out again is the only kind of tick worth anything.
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="cost">
          <div className="st-wrap">
            <Reveal className="pa-cost">
              <div>
                <div className="pt-num">03</div>
                <h2>Free every day, forever. And stopping costs nothing.</h2>
                <p>
                  Every learner gets a daily allowance of questions, with no card and no trial that
                  ends. When the board exams are close and one evening isn’t enough, Pro and Max
                  raise the allowance. If you stop, nothing renews, the plan runs to the end of the
                  period already paid for, and everything learnt stays exactly where it is.
                </p>
                <div className="pt-row">
                  <SiteLink className="st-btn st-quiet" href="/plans">
                    See plans
                  </SiteLink>
                </div>
              </div>
              <div className="pa-allow">
                <b>Today’s allowance</b>
                <div className="pa-bar">
                  <i />
                </div>
                <span>Most of today’s allowance still there · resets 6:00 am</span>
                <div className="hand">enough for a normal evening</div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="hold">
          <div className="st-wrap">
            <Reveal className="pa-head">
              <div className="pt-num">04</div>
              <h2>What we hold, and what we will never do with it.</h2>
              <p>
                We built Wobo the way we’d build it for our own kids. The full detail is on the
                Security and trust page. The short version is here.
              </p>
            </Reveal>
            <Reveal className="pa-grid3">
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M22 6 L36 12 C36 26 30 34 22 39 C14 34 8 26 8 12 Z" />
                </svg>
                <h3>No opinions, ever</h3>
                <p>
                  Politics, religion, anything contested: Wobo stays neutral and steers back to the
                  chapter.
                </p>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <rect x="8" y="19" width="28" height="19" rx="5" />
                  <path d="M14 19 v-5 a8 8 0 0 1 16 0 v5" />
                </svg>
                <h3>No ads, no selling</h3>
                <p>
                  Nothing in Wobo is trying to sell your child anything. It’s paid for by families.
                </p>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M10 34 l8 -8 l6 6 l12 -14" />
                  <path d="M28 18 h8 v8" />
                </svg>
                <h3>Erase everything, any time</h3>
                <p>One button, for you or your child. Memory, progress, account. Gone.</p>
              </div>
            </Reveal>
            <div className="pa-more">
              <SiteLink className="st-btn st-quiet" href="/security">
                Read the Security and trust page
              </SiteLink>
            </div>
          </div>
        </section>

        <section className="st-section" id="questions">
          <div className="st-wrap">
            <Reveal className="pa-head">
              <div className="pt-num">05</div>
              <h2>The questions parents ask.</h2>
            </Reveal>
            <Reveal className="pa-faq">
              {FAQ.map((item, i) => (
                <details key={item.q} open={i === 0}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal>
              <PitchAsk
                page="parents"
                heading="Ask Wobo what you'd ask a tutor at the door."
                placeholder="How do you handle a child who guesses instead of thinking?"
                chips={[
                  'Do you teach ICSE?',
                  'What happens at the end of the daily allowance?',
                  'Can two children share one account?',
                ]}
              />
            </Reveal>
          </div>
        </section>

        <ClosePanel page="parents" />
      </div>
    </SiteShell>
  );
}
