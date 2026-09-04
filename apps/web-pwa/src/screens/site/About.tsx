'use client';

/**
 * /about — why we built it. A port of design/prototypes/site-about.html, word for word and section
 * for section: the mission line in Wobo's hand, the homework hour, the three habits, what we
 * cover, the six promises, the people, the ask block and the close.
 *
 * Every word on this page is the prototype's. The only things drawn by code are Wobo's head (the
 * shipped rig, through the kit, never redrawn) and the three tile icons, which are the prototype's
 * own paths.
 */

import { Label, WoboHead } from '../../ui/primitives';
import { reachLine } from '../pitch/boardFind';
import { AskWobo } from './AskWobo';
import { ClosePanel } from './ClosePanel';
import { CTA } from './cta';
import { SiteLink } from './nav';
import { Reveal } from './Reveal';
import { SiteShell } from './SiteShell';

const PROMISES: readonly { title: string; line: string }[] = [
  {
    title: 'Free every day, forever.',
    line: 'A daily allowance of questions with no card and no trial that ends. Paid plans raise the allowance; they never change the tutor.',
  },
  {
    title: "Your school's syllabus, not a generic one.",
    line: "The chapter your class is on this week, in your textbook's order and your exam's words.",
  },
  {
    title: 'No ads, no selling, no data for sale.',
    line: 'Wobo is paid for by families. Nothing in it is trying to sell your child anything.',
  },
  {
    title: 'Neutral on everything but the chapter.',
    line: 'Politics, religion, anything contested: Wobo stays out of it and steers back to the lesson, kindly.',
  },
  {
    title: "Parents see how it's going, without spying.",
    line: 'Lessons, progress and the Sunday note. Questions word for word only if the child allows.',
  },
  {
    title: 'Erase everything, any time.',
    line: 'One button. Memory, progress, account. Gone, and out of the backups behind them as those roll over.',
  },
];

export function About() {
  return (
    <SiteShell current="about" title="About Wobo">
      <section className="ab-hero">
        <div className="st-wrap">
          <div>
            <Label>About</Label>
            <h1>
              We built the tutor we wished we'd had <em>on the evenings nothing made sense.</em>
            </h1>
            <p className="ab-sub">
              Wobo is a small company with one job: make sure no child is stuck alone with a
              question. Not a content library. Not a chatbot. A tutor that draws, never judges, and
              is always there.
            </p>
            {/*
              THE ONE DOOR ON THIS PAGE, BEFORE THE FOLD. /about's job is belief (docs/SELL.md §6)
              and belief is built by reading — but until now the only way forward was the close at
              the very bottom, so a reader convinced by the mission note had nothing to press for
              another six sections. One primary, never two, and the words and the destination come
              from cta.ts so this page cannot drift from the rest of the site (SELL.md §7).
            */}
            <div className="st-row">
              <SiteLink className="st-btn st-pig" to={CTA.to}>
                {CTA.label}
              </SiteLink>
              <span className="ab-under">{CTA.under}</span>
            </div>
          </div>
          <div className="ab-mission">
            <span className="ab-pin" />
            <div className="hand">
              Every child deserves a patient teacher at the table, every evening,{' '}
              <em>whether or not the family can afford one.</em> That's the whole company.
            </div>
            <div className="ab-sig">
              <WoboHead size={40} />— written by Wobo, kept by us
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <Label>Why</Label>
            <h2>The homework hour is where confidence is made or lost.</h2>
          </Reveal>
          <Reveal className="ab-story">
            <div>
              {/*
                THIS PARAGRAPH USED TO SAY "at the hour when parents are tired and tutors are
                expensive". Two laws in one sentence. It named a late hour, and it sold Wobo by
                putting a price on somebody else's work — and a parent reading a page that prices
                their child's tutor does not think less of the tutor (docs/SELL.md §2, DESIGN.md §0).
                What the sentence was actually reaching for is where learning happens and how alone
                it feels, and that is said here without costing anyone their reputation.
              */}
              <p>
                Most of learning happens at home, at the kitchen table, after school, with the day's
                homework out and one question that will not come apart. That's when a child decides
                they're "not a maths person". Not in class. At the table, alone, with question 7.
              </p>
              <p>
                We wanted a tutor for exactly that moment. One that knows the child's actual
                syllabus, answers the basic question without a face, draws instead of lecturing, and
                tells the parent on Sunday how it's really going. And we wanted it free, every day,
                so the family that needs it most gets it too.
              </p>
              <p>
                So we built Wobo: one character, one pen, one promise. It teaches what your school
                teaches, and it never makes anyone feel small.
              </p>
            </div>
            {/*
              The clock came off this line too. "9:46 pm on a Tuesday" is the late hour spelled with
              minutes, and it slipped past the clock law's bare-hour pattern until that hole was
              closed (site/hours.test.ts). The point of the line is the NEXT DAY, not the hour, and
              it lands harder without a number in front of it.
            */}
            <div className="ab-pull">
              The child who gets unstuck on Tuesday after school{' '}
              <em>walks into class on Wednesday a different kid.</em>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <Label>How Wobo teaches</Label>
            <h2>Three habits of a great teacher, built in.</h2>
          </Reveal>
          <Reveal className="st-grid3">
            <div className="st-tile">
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <path d="M8 36 l6 -1 l20 -20 l-5 -5 l-20 20 z" />
                <path d="M26 13 l5 5" />
              </svg>
              <h3>It draws</h3>
              <p>
                Every answer appears line by line on a board, in the order a good teacher would draw
                it. You watch it think.
              </p>
            </div>
            <div className="st-tile">
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="14" />
                <path d="M14 22 l6 6 l10 -12" />
              </svg>
              <h3>It rings the gap</h3>
              <p>
                When you're close, Wobo circles what you did and waits. It never says wrong. "Close"
                is the word.
              </p>
            </div>
            <div className="st-tile">
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <rect x="6" y="10" width="32" height="24" rx="5" />
                <path d="M6 14 l16 10 l16 -10" />
              </svg>
              <h3>It notices</h3>
              <p>
                Earned praise, a quiet record of strengths, and a three-line note home on Sunday in
                its own words.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <Label>What we cover</Label>
            <h2>Every subject your board sets, in your school&rsquo;s own order.</h2>
            {/*
              This paragraph used to read "CBSE, ICSE and the state boards today, WITH THE YEAR'S
              OFFICIAL SYLLABUS BEHIND EACH ONE". The registry carries 268 boards and
              `content/curriculum/syllabi` holds the official chapter lists for four of them, so
              that sentence claimed something we cannot show, on the page whose entire job is
              belief. It is now the generated count line, which is the same fact without the part
              that was not true, and it hands the reader to the page that answers it for their own
              board (docs/SELL.md §5).
            */}
            <p>{reachLine()}</p>
            <p>
              <SiteLink href="/subjects">Look your own board up on the subjects page</SiteLink>, and
              it will tell you which of the two you are, in one line.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <Label>Our promises</Label>
            <h2>Six lines we'd put in a contract.</h2>
          </Reveal>
          <Reveal className="ab-promises">
            {PROMISES.map((promise, i) => (
              <div className="ab-promise" key={promise.title}>
                <i>{i + 1}</i>
                <div>
                  <b>{promise.title}</b>
                  <span>{promise.line}</span>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="ab-team">
            <div>
              <Label>The people</Label>
              <h2>A very small team, and one very patient character.</h2>
              <p>
                Wobo is built in India by a founder who was, not long ago, the kid stuck at the
                table. The company is small on purpose: every rupee goes into the tutor, not into a
                sales team.
              </p>
              {/*
                "trusted by a thousand families than known by a million" reads at a glance as a
                count of families, and we have no count to publish (docs/SELL.md §5: no user number,
                invented or implied). The value is the same without the two numbers in it.
              */}
              <div className="hand">We'd rather be trusted than known.</div>
            </div>
            <div className="ab-cards">
              <div className="ab-card">
                <div className="ab-a">S</div>
                <div>
                  <b>Founder</b>
                  <span>
                    Product, design, the promises above. Answers the contact form personally.
                  </span>
                </div>
              </div>
              <div className="ab-card">
                <div className="ab-a ab-paper">
                  <WoboHead size={36} />
                </div>
                <div>
                  <b>Wobo</b>
                  <span>
                    The tutor. Draws, notices, never judges. Has no gender and no opinions about
                    anything but the chapter.
                  </span>
                </div>
              </div>
              <div className="ab-card">
                <div className="ab-a ab-plus">+</div>
                <div>
                  <b>You, maybe</b>
                  <span>
                    Teachers who want to help shape lessons, and engineers who care about children's
                    data: write to us.
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <AskWobo
              heading="Ask Wobo about us. It answers for itself."
              placeholder="Who makes Wobo, and how do they make money?"
              /*
                The third chip was "Can my school use it?", straight out of
                design/prototypes/site-about.html. A suggested question presupposes its own answer,
                and that one presupposes a school offering. We do not deal with schools at this
                stage (DESIGN.md §0), so the chip asks something this page can actually answer.
              */
              chips={['Why is it free?', 'Where is my data stored?', 'Which boards do you cover?']}
            />
          </Reveal>
        </div>
      </section>

      <ClosePanel page="about" />
    </SiteShell>
  );
}
