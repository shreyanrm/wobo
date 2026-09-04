'use client';

/**
 * /subjects — every subject, your school's way. A port of design/prototypes/site-subjects.html,
 * word for word and section for section: the four subject tiles as drawn objects, the boards
 * strip with its typeahead, one chapter per subject with its own drawn lesson (the integral,
 * benzene, the river and the port, a paragraph marked up), the ask block and the close.
 *
 * THE TYPEAHEAD IS NO LONGER A DRAWING (docs/SELL.md §6). The prototype's still — a picture of
 * somebody else typing "tel", hidden from assistive technology — was the one thing on the site's
 * highest-intent page that could not do its page's job. A reader who came here to find out whether
 * we cover their board could read the whole page and still not know. It is now `BoardFinder.tsx`,
 * a real control over the real registry, offline and instant, wearing the still's own skin.
 *
 * And the sentence beside it has changed, because it was not true. The prototype writes "Type your
 * board and Wobo finds it, WITH THE YEAR'S OFFICIAL SYLLABUS BEHIND IT", and the registry carries
 * 268 boards while `content/curriculum/syllabi` holds the official chapter lists for four of them.
 * The finder now says which is which, board by board, and the count line under it is generated
 * from those two sources rather than typed (`boardFind.ts`, `scripts/pitch-boards.ts`).
 *
 * ADDED BEYOND THE PROTOTYPE — "Your board sets more than four subjects". The prototype draws four
 * subject families and a reader can read that as the whole offer, which is a smaller product than
 * the one that exists. The new section is careful about a line this repo could easily cross:
 *
 *   what is claimed   a board's list is longer than four, and Wobo follows the board's list. And
 *                     the two doors that actually exist: `content/curriculum/syllabi/**` where we
 *                     hold the official syllabus, and `curriculum/OwnSyllabus.tsx` (paste, a photo
 *                     or a PDF, drafted, confirmed a chapter at a time, kept private) where we do
 *                     not. The chip strip is labelled as ONE BOARD'S LIST, not as our coverage.
 *   what is not       that we hold an official syllabus for every subject on that list. We do not:
 *                     the 121 syllabus files in this repo carry maths, the sciences, social
 *                     science and English. Anything stronger is a question in the report.
 *
 * And no grade gate: the section says out loud that there is no list of classes because there is
 * no gate (DESIGN.md §0, the copy law).
 */

import { Label, Sticker } from '../../ui/primitives';
import { ClosePanel } from '../site/ClosePanel';
import { CTA } from '../site/cta';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import { BoardFinder } from './BoardFinder';
import { reachLine } from './boardFind';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

export function Subjects() {
  return (
    <SiteShell current="subjects" title="Wobo subjects">
      <div className="pt">
        <section className="pt-hero sb-hero">
          <div className="st-wrap">
            <Label>Subjects</Label>
            <h1>
              Every subject. <em>Your school's way.</em>
            </h1>
            <p className="pt-sub">
              Every subject your board sets, taught in the order your textbook uses and the words
              your exam expects. Pick a subject to see what a lesson looks like.
            </p>
            <Reveal className="sb-boards">
              <div>
                <Label>Boards</Label>
                <h2>
                  The boards whose chapter lists we hold, and the syllabus your school wrote itself.
                </h2>
                <p>
                  Type your board and Wobo finds it. Not listed? Paste your school's syllabus and
                  Wobo builds the plan from that, unit by unit.
                </p>
                <p className="sb-reach">{reachLine()}</p>
              </div>
              <BoardFinder
                door={
                  <SiteLink className="st-btn st-pig" to={CTA.to}>
                    {CTA.label}
                  </SiteLink>
                }
              />
            </Reveal>
            <div className="sb-tiles">
              <a href="#maths">
                <svg viewBox="0 0 200 150" aria-hidden="true">
                  <path className="pt-ink" d="M50 120 L140 120 L50 52 Z" />
                  <path className="pt-ink pt-thin" d="M50 104 h16 v16" />
                  <path className="pt-ink pt-pig" d="M140 120 L180 66 L90 -2 L50 52" opacity=".9" />
                  <text className="pt-hw pt-pig" x="118" y="60" fontSize="22">
                    c²
                  </text>
                </svg>
                <b>Mathematics</b>
                <span>Number to calculus, drawn.</span>
                <span className="sb-go">See a lesson →</span>
              </a>
              <a href="#science">
                <svg viewBox="0 0 200 150" aria-hidden="true">
                  <path className="pt-ink" d="M100 20 L152 50 L152 110 L100 140 L48 110 L48 50 Z" />
                  <circle className="pt-ink pt-thin" cx="100" cy="80" r="30" />
                  <text className="pt-hw" x="160" y="44" fontSize="20">
                    C₆H₆
                  </text>
                </svg>
                <b>Science</b>
                <span>Physics, chemistry, biology, seen.</span>
                <span className="sb-go">See a lesson →</span>
              </a>
              <a href="#social">
                <svg viewBox="0 0 200 150" aria-hidden="true">
                  <path
                    className="pt-ink pt-thin"
                    d="M20 110 c30 -30 50 -10 80 -30 s50 -40 90 -30"
                  />
                  <path
                    className="pt-ink pt-thin"
                    d="M20 130 c40 -20 70 0 110 -20 s40 -30 60 -20"
                  />
                  <path className="pt-ink pt-pig" d="M60 40 c20 30 50 40 80 20" />
                  <circle cx="140" cy="60" r="6" fill="var(--rose)" />
                  <text className="pt-hw" x="30" y="40" fontSize="18">
                    river · plateau · port
                  </text>
                </svg>
                <b>Social science</b>
                <span>History, geography, civics, mapped.</span>
                <span className="sb-go">See a lesson →</span>
              </a>
              <a href="#english">
                <svg viewBox="0 0 200 150" aria-hidden="true">
                  <path
                    className="pt-ink pt-thin"
                    d="M24 40 h150 M24 62 h130 M24 84 h150 M24 106 h100"
                  />
                  <rect
                    x="60"
                    y="52"
                    width="70"
                    height="18"
                    rx="6"
                    fill="var(--marigold)"
                    opacity=".6"
                  />
                  <path className="pt-ink pt-pig" d="M120 96 c10 -14 30 -14 40 0" />
                  <text className="pt-hw pt-pig" x="130" y="128" fontSize="18">
                    metaphor
                  </text>
                </svg>
                <b>English</b>
                <span>Reading, writing, grammar, marked up.</span>
                <span className="sb-go">See a lesson →</span>
              </a>
            </div>
          </div>
        </section>

        <section className="st-section" id="maths">
          <div className="st-wrap">
            <Reveal className="pt-chapter sb-chapter">
              <div>
                <span className="sb-k">
                  <i />
                  Mathematics
                </span>
                <h2>Every proof drawn, every number computed.</h2>
                <p>
                  A chocolate bar shared into quarters. Why a² + b² = c², instead of memorising it.
                  An integral filling the area under a curve. Same pen, same patience, whatever your
                  board has set this year.
                </p>
                <div className="sb-span">
                  <div>
                    <b>Early on</b>Fractions as pieces of a real thing, dragged and shaded.
                  </div>
                  <div>
                    <b>Later</b>Limits, derivatives and integrals, built one step at a time on the
                    graph.
                  </div>
                </div>
                <div className="pt-say">
                  If you can watch it drawn, <em>you can draw it in the exam.</em>
                </div>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 340" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="24" width="460" height="292" rx="22" />
                  <path className="pt-ink pt-thin" d="M70 270 h380 M90 290 v-240" />
                  <path
                    className="pt-ink pt-draw"
                    d="M90 250.0 L105 249.7 L120 248.8 L135 247.2 L150 245.0 L165 242.2 L180 238.8 L195 234.7 L210 230.0 L225 224.7 L240 218.8 L255 212.2 L270 205.0 L285 197.2 L300 188.8 L315 179.7 L330 170.0 L345 159.7 L360 148.8 L375 137.2 L390 125.0 L405 112.2 L420 98.8 L435 84.7 L450 70.0"
                    strokeLinejoin="round"
                  />
                  <path
                    className="pt-draw"
                    d="M170 270 L170 241.1 L180 238.8 L190 236.1 L200 233.2 L210 230.0 L220 226.5 L230 222.8 L240 218.8 L250 214.4 L260 209.9 L270 205.0 L270 270 Z"
                    fill="var(--pig)"
                    opacity=".18"
                    stroke="var(--pig)"
                    strokeWidth="3"
                    style={{ transitionDelay: '.8s' }}
                  />
                  <text className="pt-hw pt-pig" x="330" y="100" fontSize="30">
                    ∫ f(x) dx
                  </text>
                  <text className="pt-hw" x="300" y="300" fontSize="22">
                    a
                  </text>
                  <text className="pt-hw" x="365" y="300" fontSize="22">
                    b
                  </text>
                  <text className="pt-hw pt-dim" x="290" y="250" fontSize="20">
                    ← the area, filled
                  </text>
                </svg>
                <Sticker style={{ right: 22, top: 18 }}>integration</Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="science">
          <div className="st-wrap">
            <Reveal className="pt-chapter sb-chapter pt-flip">
              <div>
                <span className="sb-k">
                  <i className="sb-mint" />
                  Science
                </span>
                <h2>Seen, not recited.</h2>
                <p>
                  Benzene as a ring you can rotate. Sound as a wave you can squeeze. A cell you can
                  peel layer by layer. Wobo draws the thing, then asks you to predict what happens
                  when one part changes.
                </p>
                <div className="sb-span">
                  <div>
                    <b>Early on</b>Light bouncing off a mirror, angle by angle.
                  </div>
                  <div>
                    <b>Later</b>Bonds, orbitals and equilibrium, animated on the board.
                  </div>
                </div>
                <div className="pt-say">
                  Predict first. <em>Then watch.</em>
                </div>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 340" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="24" width="460" height="292" rx="22" />
                  <g transform="translate(200 170)">
                    <path
                      className="pt-ink pt-draw"
                      d="M0 -90 L78 -45 L78 45 L0 90 L-78 45 L-78 -45 Z"
                    />
                    <circle
                      className="pt-ink pt-thin pt-draw"
                      r="55"
                      style={{ transitionDelay: '.7s' }}
                    />
                    <g className="pt-hw" fontSize="20">
                      <text x="-8" y="-98">
                        C
                      </text>
                      <text x="82" y="-48">
                        C
                      </text>
                      <text x="82" y="56">
                        C
                      </text>
                      <text x="-8" y="108">
                        C
                      </text>
                      <text x="-98" y="56">
                        C
                      </text>
                      <text x="-98" y="-48">
                        C
                      </text>
                    </g>
                  </g>
                  <text className="pt-hw pt-pig" x="320" y="120" fontSize="30">
                    C₆H₆
                  </text>
                  <text className="pt-hw" x="320" y="160" fontSize="22">
                    six carbons, one ring,
                  </text>
                  <text className="pt-hw" x="320" y="190" fontSize="22">
                    electrons shared all round
                  </text>
                  <path
                    className="pt-ink pt-rose pt-draw"
                    d="M300 210 c-8 20 0 40 30 40 s60 -10 58 -30 s-20 -36 -48 -32 s-34 8 -40 22"
                    style={{ transitionDelay: '1.4s' }}
                  />
                  <text className="pt-hw pt-rose" x="360" y="280" fontSize="22">
                    why a ring?
                  </text>
                </svg>
                <Sticker rotate={4} style={{ left: 22, bottom: 18 }}>
                  aromatic rings
                </Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="social">
          <div className="st-wrap">
            <Reveal className="pt-chapter sb-chapter">
              <div>
                <span className="sb-k">
                  <i className="sb-marigold" />
                  Social science
                </span>
                <h2>History with a timeline, geography with a map, civics with a case.</h2>
                <p>
                  Wobo draws the river before it names the empire that grew beside it, and draws the
                  map the way your own school's atlas draws it. Contested questions get the
                  textbook's words and nothing more.
                </p>
                <div className="sb-span">
                  <div>
                    <b>Early on</b>A river, a plain, a port, and why the city is where it is.
                  </div>
                  <div>
                    <b>Later</b>Timelines, resource maps and how a bill becomes law, step by step.
                  </div>
                </div>
                <div className="pt-say">
                  The map first, <em>then the story.</em>
                </div>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 340" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="24" width="460" height="292" rx="22" />
                  <path
                    className="pt-ink pt-thin pt-draw"
                    d="M60 250 c50 -50 90 -20 150 -50 s90 -70 250 -60"
                  />
                  <path
                    className="pt-ink pt-thin pt-draw"
                    d="M60 290 c60 -30 110 0 170 -30 s80 -50 230 -40"
                  />
                  <path
                    className="pt-ink pt-pig pt-draw"
                    d="M120 60 c30 50 80 70 130 60 s90 -10 140 30"
                    style={{ transitionDelay: '.8s' }}
                  />
                  <circle cx="250" cy="120" r="8" fill="var(--rose)" />
                  <text className="pt-hw pt-rose" x="266" y="112" fontSize="22">
                    the port
                  </text>
                  <text className="pt-hw pt-dim" x="90" y="200" fontSize="18">
                    plateau
                  </text>
                  <text className="pt-hw pt-pig" x="330" y="76" fontSize="20">
                    the river
                  </text>
                  <path
                    className="pt-ink pt-draw"
                    d="M80 300 h360"
                    style={{ transitionDelay: '1.2s' }}
                  />
                  <g className="pt-hw" fontSize="16">
                    <text x="80" y="290">
                      1526
                    </text>
                    <text x="230" y="290">
                      1707
                    </text>
                    <text x="400" y="290">
                      1857
                    </text>
                  </g>
                </svg>
                <Sticker style={{ right: 22, top: 18 }}>empires and rivers</Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="english">
          <div className="st-wrap">
            <Reveal className="pt-chapter sb-chapter pt-flip">
              <div>
                <span className="sb-k">
                  <i className="sb-lilac" />
                  English
                </span>
                <h2>A paragraph, marked up like a good teacher would.</h2>
                <p>
                  Wobo underlines the metaphor, circles the comma splice, and rewrites one sentence
                  beside yours so you can see the difference. Grammar as pattern, not as rules to
                  memorise.
                </p>
                <div className="sb-span">
                  <div>
                    <b>Early on</b>Nouns and verbs coloured in a sentence you wrote.
                  </div>
                  <div>
                    <b>Later</b>Argument, tone and structure, marked across your whole essay.
                  </div>
                </div>
                <div className="pt-say">
                  Your writing, <em>with the pen on it.</em>
                </div>
              </div>
              <div className="pt-art">
                <svg viewBox="0 0 520 340" aria-hidden="true">
                  <rect className="pt-paper" x="30" y="24" width="460" height="292" rx="22" />
                  <g fontFamily="Poppins,sans-serif" fontSize="17" fill="var(--ink)">
                    <text x="60" y="80">
                      The monsoon arrived like a rumour, first
                    </text>
                    <text x="60" y="110">
                      in the smell of the air, then everywhere at
                    </text>
                    <text x="60" y="140">
                      once, the streets were rivers by evening.
                    </text>
                  </g>
                  <rect
                    x="192"
                    y="64"
                    width="128"
                    height="22"
                    rx="6"
                    fill="var(--marigold)"
                    opacity=".55"
                  />
                  <text className="pt-hw pt-pig" x="330" y="60" fontSize="20">
                    simile ✓
                  </text>
                  <path
                    className="pt-ink pt-rose pt-draw"
                    d="M160 146 c-6 12 2 22 20 22 s60 -2 78 -6 s10 -24 -8 -26 s-70 -4 -90 10"
                  />
                  <text className="pt-hw pt-rose" x="270" y="180" fontSize="20">
                    two sentences, one comma
                  </text>
                  <text className="pt-hw pt-pig" x="60" y="240" fontSize="24">
                    → "…at once. By evening the streets were rivers."
                  </text>
                  <text className="pt-hw pt-dim" x="60" y="290" fontSize="18">
                    Wobo rewrites one line. You fix the rest.
                  </text>
                </svg>
                <Sticker rotate={4} style={{ left: 22, bottom: 18 }}>
                  your own draft
                </Sticker>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="everything">
          <div className="st-wrap">
            <Reveal className="st-head">
              <h2>Your board sets more than four subjects. So does Wobo.</h2>
              <p>
                The four above are the ones drawn on this page, not the edge of what Wobo teaches.
                Your board's own list is the edge: the second language your school runs, the
                humanities, the commerce and computing streams that open further up.
              </p>
              <p>
                And there is no list of classes anywhere on this page, because there is no gate.
                Tell Wobo which board you are on and where your class has got to, and it starts
                there.
              </p>
            </Reveal>
            <Reveal className="sb-list">
              <span className="sb-lk">One board's list, as it actually reads</span>
              <div>
                <b>Mathematics</b>
                <b>General science</b>
                <b>Physics</b>
                <b>Chemistry</b>
                <b>Biology</b>
                <b>History</b>
                <b>Geography</b>
                <b>Civics</b>
                <b>Economics</b>
                <b>English</b>
                <b>Your second language</b>
                <b>Computer science</b>
                <b>Accountancy</b>
                <b>Business studies</b>
              </div>
            </Reveal>
            <Reveal className="st-grid2">
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M10 8 h18 l8 8 v20 a4 4 0 0 1 -4 4 h-22 a4 4 0 0 1 -4 -4 v-24 a4 4 0 0 1 4 -4 z" />
                  <path d="M15 24 l5 5 l10 -11" />
                </svg>
                <h3>Where we hold your board's own syllabus</h3>
                <p>
                  Wobo already knows the chapters and the order your textbook puts them in. Nothing
                  to set up past telling it which board you are on.
                </p>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <rect x="7" y="10" width="30" height="24" rx="5" />
                  <path d="M7 27 l8 -7 l6 5 l7 -8 l9 9" />
                  <circle cx="16" cy="18" r="3" />
                </svg>
                <h3>Where we don't hold it yet</h3>
                <p>
                  Type it in, photograph the page, or hand over the PDF. Wobo drafts the plan from
                  that and labels it a draft, you confirm it a chapter at a time, and it stays yours
                  and private rather than being handed to anybody else.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="ask">
          <div className="st-wrap">
            <Reveal>
              <PitchAsk
                page="subjects"
                heading="Ask Wobo about your subject, your board, your class."
                placeholder="Do you cover ICSE physics?"
                chips={[
                  'Which chapter is my CBSE maths class on this week?',
                  'Can you teach Hindi?',
                  'My school uses its own books',
                ]}
              />
            </Reveal>
          </div>
        </section>

        <ClosePanel page="subjects" />
      </div>
    </SiteShell>
  );
}
