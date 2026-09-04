'use client';

/**
 * /for-parents — peace of mind and a tutor at any hour. A port of
 * design/prototypes/site-parents.html, word for word and section for section: the Sunday note
 * rising out of its envelope, the 8 pm drive home, what you see and what you don't (the parent
 * view mock), safe by design, what it costs, the questions parents ask, the ask block and the
 * close.
 *
 * Law v5's copy law (DESIGN.md §0) governs every word here. NO NAMES: the learner in the chapters
 * is "your child", never an invented Aanya, and never "she" or "he" — a parent reading this has
 * their own child in mind and a made-up name puts someone else's there instead. NO GRADE GATE: the
 * page says "every subject your board sets", never a range of classes. NO RAW ALLOWANCE: the
 * drawing says what an evening feels like rather than counting questions. Wobo is "it" in every
 * sentence (WOBO-PLAN §19).
 */

import { useId } from 'react';
import { Label, Sticker, WoboHead } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

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
    q: 'Which subjects?',
    a: 'Every subject your board sets, for CBSE, ICSE and the state boards. Other boards and countries are added as families ask.',
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

export function ForParents() {
  return (
    <SiteShell current="parents" title="Wobo for parents">
      <div className="pt">
        <section className="pt-hero pa-hero">
          <div className="st-wrap">
            <div>
              <Label>For parents</Label>
              <h1>
                You can't be at the table every evening. <em>Wobo can.</em>
              </h1>
              <p className="pt-sub">
                A tutor that knows your child's exact syllabus, answers late in the evening without
                a sigh, and writes you a note on Sunday about what actually happened. Not a report
                card. A note.
              </p>
              <div className="pt-row">
                <SiteLink className="st-btn st-pig" to={{ name: 'onboarding' }}>
                  Get early access
                </SiteLink>
                <a className="st-btn st-quiet" href="#see">
                  What you'll see
                </a>
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

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pt-chapter">
              <div>
                <div className="pt-num">01</div>
                <h2>The 8 pm drive home.</h2>
                <p>
                  Traffic. A message from home: "question 7 makes no sense." You'd explain it if you
                  were there. You're not there.
                </p>
                <div className="pa-caps">
                  <div className="pa-t">Meanwhile, at the table</div>
                  <div>Your child asks Wobo the way they'd ask you.</div>
                  <div>Wobo draws it out, line by line.</div>
                  <div>
                    <em>By the time you park, it's clicked.</em>
                  </div>
                </div>
              </div>
              <div className="pt-art pt-night">
                <svg viewBox="0 0 520 360" aria-hidden="true">
                  <rect x="40" y="40" width="440" height="280" rx="24" fill="#17171F" />
                  <rect x="70" y="70" width="380" height="60" rx="14" fill="#1F1F29" />
                  <text
                    x="90"
                    y="96"
                    fontFamily="Poppins,sans-serif"
                    fontWeight="600"
                    fontSize="15"
                    fill="#F4F4F7"
                  >
                    Wobo
                  </text>
                  <text x="90" y="116" fontFamily="Poppins,sans-serif" fontSize="13" fill="#B4B4C2">
                    Triangles, lesson 3, finished. Got c = 5 without a hint.
                  </text>
                  <text x="410" y="96" fontFamily="Poppins,sans-serif" fontSize="12" fill="#7E7E90">
                    8:12 pm
                  </text>
                  <rect x="70" y="150" width="380" height="60" rx="14" fill="#1F1F29" />
                  <text
                    x="90"
                    y="176"
                    fontFamily="Poppins,sans-serif"
                    fontWeight="600"
                    fontSize="15"
                    fill="#F4F4F7"
                  >
                    Your child
                  </text>
                  <text x="90" y="196" fontFamily="Poppins,sans-serif" fontSize="13" fill="#B4B4C2">
                    got it!! wobo drew the squares thing. dont need u lol
                  </text>
                  <text
                    x="410"
                    y="176"
                    fontFamily="Poppins,sans-serif"
                    fontSize="12"
                    fill="#7E7E90"
                  >
                    8:14 pm
                  </text>
                  <path
                    className="pt-draw"
                    d="M100 270 c40 -30 80 -30 120 0 s80 30 120 0 s60 -30 90 -10"
                    fill="none"
                    stroke="#FFB629"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  <text
                    x="100"
                    y="300"
                    fontFamily="Caveat,cursive"
                    fontWeight="700"
                    fontSize="24"
                    fill="#FFB629"
                  >
                    you, breathing out
                  </text>
                </svg>
                <Sticker style={{ right: 22, top: 18 }}>8:14 pm</Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="see">
          <div className="st-wrap">
            <Reveal className="pt-chapter pt-flip">
              <div>
                <div className="pt-num">02</div>
                <h2>What you see, and what you don't.</h2>
                <p>
                  Every lesson, every practice set, the streak, and the Sunday note. What you don't
                  see is your child's questions word for word, unless they choose to share them.
                  Trust runs both ways.
                </p>
                <div className="pa-caps">
                  <div>
                    You'll know how it's going <em>without asking twice.</em>
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

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pa-head">
              <div className="pt-num">03</div>
              <h2>Safe by design, not by promise.</h2>
              <p>
                We built Wobo the way we'd build it for our own kids. The full detail is on the
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
                  Nothing in Wobo is trying to sell your child anything. It's paid for by families.
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

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="pa-cost">
              <div>
                <div className="pt-num">04</div>
                <h2>Free every day. More when exams get close.</h2>
                <p>
                  Every learner gets a daily allowance of questions, forever, with no card and no
                  trial that ends. When the board exams loom and one evening isn't enough, Pro and
                  Max raise the allowance. Cancelling takes as many taps as subscribing.
                </p>
                <div className="pt-row">
                  <SiteLink className="st-btn" href="/plans">
                    See plans
                  </SiteLink>
                  <SiteLink className="st-btn st-quiet" href="/gift">
                    Gift Wobo
                  </SiteLink>
                </div>
              </div>
              <div className="pa-allow">
                <b>Today's allowance</b>
                <div className="pa-bar">
                  <i />
                </div>
                <span>Most of today's allowance still there · resets 6:00 am</span>
                <div className="hand">enough for a normal evening</div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
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

        <ClosePanel
          title="Be in the first group when Wobo opens."
          hand="Ten minutes now. Every evening after, easier."
          quiet={{ label: 'See plans', href: '/plans' }}
        />
      </div>
    </SiteShell>
  );
}
