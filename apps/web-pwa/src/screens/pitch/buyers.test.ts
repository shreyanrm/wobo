/**
 * THE TWO BUYER PAGES — /for-parents and /for-students — held to the four rulings that made them.
 *
 * The person who USES Wobo and the person who PAYS for it are not the same person and arrive with
 * opposite feelings (docs/SELL.md §1), so these two pages are the only ones on the site with a
 * named audience. What is asserted here is what a reviewer cannot see by reading one file:
 *
 *   A. ONE DOOR, NEVER TYPED. Both pages read the call to action from `site/handoffs.ts`, which
 *      reads it from `site/cta.ts`. Neither page types a call to action, so the top of a page and
 *      the bottom of it cannot say two different things and no surface can imply a waitlist.
 *   B. WE NEVER SELL BY RUNNING ANYTHING DOWN (owner, 2026-09-04). Not a teacher, not a school, not
 *      a tuition centre, not another product. No comparison, no price against anyone else's, and no
 *      implication. This is asserted over the SHIPPED WORDS of both pages and both prototypes,
 *      because a jab is exactly the kind of line that gets written in a hurry and read by a parent
 *      who loves their child's teacher.
 *   C. ONE PAGE, ONE JOB, ONE PRIMARY (docs/SELL.md §6). Exactly one loud button per page, and one
 *      quiet second that is the next step in that page's argument — plans for the payer, subjects
 *      for the learner.
 *   D. NOTHING CLAIMED THAT CANNOT BE SHOWN WORKING. The six things the parents page says a great
 *      teacher does are each a claim about this codebase. Every one of them names the module that
 *      makes it true, and this file fails if that module or the symbol inside it goes away. That is
 *      the only kind of test that can stop a marketing page drifting ahead of the product, and the
 *      owner has caught this repo inventing claims twice.
 *
 * The pages' own words are read with comments stripped, exactly as `site/law-v5.test.ts` reads
 * them, so a note that names a forbidden phrase in order to forbid it is not itself a violation.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CTA } from '../site/cta';
import { HANDOFFS } from '../site/handoffs';

const HERE = import.meta.dir;
const REPO = join(HERE, '..', '..', '..', '..', '..');
const SRC = join(HERE, '..', '..');

/** A file's shipped words: block comments and whole-line `//` notes taken out. */
function shipped(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const PARENTS = shipped(join(HERE, 'ForParents.tsx'));
const STUDENTS = shipped(join(HERE, 'ForStudents.tsx'));
const PARENTS_PROTO = readFileSync(join(REPO, 'design', 'prototypes', 'site-parents.html'), 'utf8');
const STUDENTS_PROTO = readFileSync(
  join(REPO, 'design', 'prototypes', 'site-students.html'),
  'utf8',
);

const SURFACES: readonly [name: string, text: string][] = [
  ['ForParents.tsx', PARENTS],
  ['ForStudents.tsx', STUDENTS],
  ['site-parents.html', PARENTS_PROTO],
  ['site-students.html', STUDENTS_PROTO],
];

// --- A. one door, never typed --------------------------------------------------------------------

describe('the buyer pages read the one call to action rather than typing one', () => {
  /**
   * SUPERSEDED IN PART, owner 2026-09-09 (`docs/DOORS-CLOSED.md`): the door is closed to new
   * accounts and the invitation to the list stands in its place, so "join the list" is now the
   * site's own phrase and is read from `cta.ts` like every other door. What neither page may do,
   * closed or open, is type a door of its own or promise early access to anybody.
   */
  it('neither page carries the retired phrase, and neither types a door of its own', () => {
    for (const [name, text] of SURFACES) {
      expect([name, /get early access|early access|jump the queue/i.test(text)]).toEqual([
        name,
        false,
      ]);
    }
  });

  it('takes the loud label from the handoff table, which takes it from cta.ts', () => {
    // typed nowhere: the words appear in neither page's source, only the lookup does
    expect(PARENTS).not.toContain(`'${CTA.label}'`);
    expect(STUDENTS).not.toContain(`'${CTA.label}'`);
    expect(PARENTS).toContain('handoff(PARENTS, open)');
    expect(STUDENTS).toContain('handoff(STUDENTS, open)');
    expect(PARENTS).toContain('close.primary.label');
    expect(STUDENTS).toContain('close.primary.label');
    // and the table says the open phrase for both, from the constant
    expect(HANDOFFS.parents.primary.label).toBe(CTA.label);
    expect(HANDOFFS.students.primary.label).toBe(CTA.label);
  });

  it('closes through the table too, so the hero and the close cannot drift', () => {
    expect(PARENTS).toContain('<ClosePanel page="parents" />');
    expect(STUDENTS).toContain('<ClosePanel page="students" />');
  });
});

// --- B. we never sell by running anything down ---------------------------------------------------

/**
 * Every shape a jab takes. Written as patterns rather than a word list because the ban is on the
 * MOVE, not on a vocabulary: "unlike a tutor", "what a classroom cannot do", "cheaper than
 * coaching" and "just a chatbot" are the same sentence with different nouns in it.
 */
const RUNNING_SOMETHING_DOWN: readonly [RegExp, string][] = [
  [
    /\bunlike (?:a |an |the |your |most |other )?(?:tutor|teacher|school|class|classroom|app|product|chatbot|tuition|course|platform)s?\b/i,
    'a comparison, however gentle, names a competitor',
  ],
  [/\b(?:better|cheaper|faster|smarter) than\b/i, 'a comparative claim about somebody else'],
  [
    /\b(?:tuition|coaching)(?: centre| center| class)?\b/i,
    'a tuition centre is somebody a parent chose',
  ],
  [
    /\b(?:teachers?|schools?|classrooms?|tutors?) (?:can(?:no|')t|don'?t|won'?t|never|fail|miss)\b/i,
    'a teacher, a school or a tutor being told what they cannot do',
  ],
  [
    /\b(?:most|other|ordinary|typical) (?:apps?|tutors?|teachers?|schools?|products?)\b/i,
    'the category compared against',
  ],
  [/\bchatgpt|\bcopilot\b|\bgemini\b|\bkhan academy\b|\bbyju/i, 'a named product'],
  [/\bjust a (?:chatbot|chat window|search box)\b/i, 'an implication about somebody else'],
  [/\bnot like (?:a |an |the |other)\b/i, 'the same comparison, inverted'],
  [/\b(?:boring|useless|broken|outdated) (?:app|class|lesson|school|textbook)/i, 'a jab'],
];

describe('nothing on either page is sold by running something down', () => {
  for (const [pattern, why] of RUNNING_SOMETHING_DOWN) {
    it(`says nothing matching ${pattern} — ${why}`, () => {
      const hits: string[] = [];
      for (const [name, text] of SURFACES) {
        for (const line of text.split('\n')) {
          if (pattern.test(line)) hits.push(`${name}: ${line.trim().slice(0, 110)}`);
        }
      }
      expect(hits, why).toEqual([]);
    });
  }

  it('makes the pitch the craft rather than the competition', () => {
    // docs/SELL.md §2: everything a great teacher does, for one child, at ten at night
    expect(PARENTS).toContain('Everything a great teacher does');
    expect(PARENTS).toContain('Six things a great teacher does. Wobo does all six.');
  });
});

// --- C. one page, one job, one primary -----------------------------------------------------------

describe('one primary action, and a second that is never at equal weight', () => {
  const loud = (text: string) => text.match(/st-btn st-pig/g) ?? [];

  it('gives each page exactly one loud button', () => {
    expect(loud(PARENTS)).toHaveLength(1);
    expect(loud(STUDENTS)).toHaveLength(1);
  });

  it('hands the payer to the price and the learner to the syllabus', () => {
    expect(HANDOFFS.parents.job).toBe('close the payer');
    expect(HANDOFFS.parents.quiet).toEqual({ label: 'See plans', href: '/plans' });
    expect(HANDOFFS.students.job).toBe('close the user');
    expect(HANDOFFS.students.quiet).toEqual({ label: 'See subjects', href: '/subjects' });
    // and each hero's quiet second is that same second, read from the same row
    expect(PARENTS).toContain('close.quiet.label');
    expect(STUDENTS).toContain('close.quiet.label');
  });

  it('opens the payer on what changes rather than on their child struggling', () => {
    // the chapter this page used to open with — traffic, and a message from home at 8 pm
    expect(PARENTS).not.toContain('The 8 pm drive home');
    expect(PARENTS).not.toContain('question 7 makes no sense');
    expect(PARENTS_PROTO).not.toContain('The 8 pm drive home');
  });

  it('runs the payer through the arc in order: see, why, cost, what we hold, questions', () => {
    const ids = [...PARENTS.matchAll(/id="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['see', 'why', 'cost', 'hold', 'questions']);
  });
});

// --- the learner's page, in the learner's voice ---------------------------------------------------

describe('the students page speaks to a fifteen year old without performing', () => {
  /**
   * The words a reader actually sees: every JSX text node, and nothing else. Stripping tags from
   * the whole file leaves the code behind it, and `v.ring !== null` is not an exclamation.
   */
  const words = [...STUDENTS.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).join(' ');

  it('never exclaims', () => {
    expect(words).not.toContain('!');
  });

  it('carries no emoji', () => {
    // an alternation rather than one class: a variation selector inside a class combines with the
    // character before it, which is a lint error and a pattern that quietly matches less than it reads
    expect(words).not.toMatch(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u);
  });

  it('borrows no enthusiasm it has not earned', () => {
    expect(words).not.toMatch(/\bawesome\b|\bamazing\b|\bsuper\b|\bhits different\b|\blevel up\b/i);
  });

  /**
   * IT OPENS ON RELIEF, AND THE RELIEF IS WHAT WOBO DOES — not what the people around this child
   * cannot do. This assertion used to be the opposite of a law: it DEMANDED the line "and nobody
   * around can explain it." and so it held the page to the very move ruling B forbids ("no jab, no
   * implication, however gentle" — owner, 2026-09-04). A child reading it was told that their
   * teacher, their parent and their sibling are all out of their depth.
   *
   * It got there by halves. The prototype's headline was "It's 10 pm, you're stuck, and nobody is
   * awake." The clock law took the hour off and left the "nobody" behind, which is why the lede
   * answered "Wobo is." to a sentence ending "can explain it" — a grammar break sitting in the
   * first screen of the page whose one job is closing the learner.
   *
   * So the shape of the assertion changes. The page must still open on being stuck, because that
   * is the feeling a learner arrives with (docs/SELL.md §1). What follows must be a capability,
   * and the words that put a limit on somebody else are banned outright — including "no sigh",
   * which pictures a person sighing at a child even though it never names one.
   */
  it('opens on being stuck, and answers it with what Wobo does', () => {
    expect(STUDENTS).toContain("You're stuck on one thing,");
    expect(STUDENTS).toContain('and you want it drawn out slowly.');
    // the answer is Wobo's own behaviour, and it parses with the headline above it
    expect(STUDENTS).toContain('Wobo does that.');
    expect(STUDENTS).toContain('as many times as it takes');
  });

  /**
   * The words that put somebody else down without naming them. Every one of these shipped: the
   * headline and lede said "nobody around can explain it" and "No face. No sigh.", and the close
   * in `site/handoffs.ts` said "No face, no sigh, and no one else in the room."
   */
  it('never sells the learner by implying the people around them fall short', () => {
    const IMPLIED: readonly RegExp[] = [
      /\bnobody around\b/i,
      /\bnobody (?:is awake|can explain|could explain|to ask|else can)\b/i,
      /\bno one (?:around|can explain|is awake|to ask)\b/i,
      // "no one else is in the room" is the opposite move — a statement about privacy, not about
      // anybody's competence — so the patterns above name the put-down rather than the pronoun.
      /\bno sigh\b/i,
      /\bwithout a sigh\b/i,
      /\bdoesn'?t sigh\b/i,
      /\bno face\b/i,
    ];
    const surfaces: [string, string][] = [
      ['ForStudents.tsx', words],
      ['ForParents.tsx', PARENTS],
      ['site-students.html', STUDENTS_PROTO],
      ['handoffs.ts', shipped(join(SRC, 'screens', 'site', 'handoffs.ts'))],
    ];
    const guilty: string[] = [];
    for (const [name, body] of surfaces) {
      for (const pattern of IMPLIED) {
        const hit = body.match(pattern);
        if (hit) guilty.push(`${name}: "${hit[0]}"`);
      }
    }
    expect(guilty, 'describe what Wobo does; let the reader judge').toEqual([]);
  });

  it('still keeps the clock off the page', () => {
    expect(words).not.toMatch(/\b(?:9|10|11|12)\s*(?:pm|p\.m\.)|\bmidnight\b/i);
  });

  it('says the vibe is theirs and costs them nothing', () => {
    expect(STUDENTS).toContain('Two looks. The');
    expect(STUDENTS).toContain('picking the quiet one costs you nothing at all');
  });
});

// --- D. nothing claimed that cannot be shown working ----------------------------------------------

/**
 * The six things the parents page says a great teacher does, each against the module that makes it
 * true. A claim whose module or symbol has gone away fails HERE, on the page that makes it, rather
 * than being noticed by a parent.
 */
const SIX_ARE_REAL: readonly { claim: string; file: string; symbol: string }[] = [
  { claim: 'draws it', file: 'wobo/board-turn.ts', symbol: 'export' },
  { claim: 'films it', file: 'wobo/video.ts', symbol: 'frameSurfaceId' },
  { claim: 'speaks it', file: 'wobo/voice.ts', symbol: 'VoiceStatus' },
  {
    claim: 'changes method on a repeated miss',
    file: 'wobo/reteach.ts',
    symbol: 'RETEACH_AFTER_MISSES',
  },
  {
    claim: 'never repeats the approach that just failed',
    file: 'wobo/reteach.ts',
    symbol: 'tried',
  },
  { claim: 'the example from their world', file: 'wobo/reteach.ts', symbol: 'their_world' },
  { claim: 'and only when they have said one', file: 'store/mind.ts', symbol: 'preferredAnalogy' },
  { claim: 'the ground under a topic', file: 'curriculum/prereq.ts', symbol: 'PrereqEdge' },
  {
    claim: 'at most three questions, skippable',
    file: 'curriculum/placement.ts',
    symbol: 'MAX_PLACEMENT_QUESTIONS',
  },
  { claim: 'taught inside the same lesson', file: 'wobo/bridge.ts', symbol: 'export' },
  {
    claim: 'does not move on until it holds',
    file: 'screens/learn/mastery.ts',
    symbol: 'MASTERY_FLOOR',
  },
  { claim: 'and names the topic that fell', file: 'screens/learn/units.ts', symbol: 'owedName' },
];

describe('every claim the parents page makes is answered by a module in this repo', () => {
  for (const { claim, file, symbol } of SIX_ARE_REAL) {
    it(`${claim} — ${file} still carries ${symbol}`, () => {
      expect([file, shipped(join(SRC, file)).includes(symbol)]).toEqual([file, true]);
    });
  }

  it('names the three questions as three, because the module says three', () => {
    const placement = readFileSync(join(SRC, 'curriculum', 'placement.ts'), 'utf8');
    expect(placement).toContain('export const MAX_PLACEMENT_QUESTIONS = 3;');
    expect(PARENTS).toContain('Three questions at most, and your child can skip any of them.');
  });

  it('changes approach on the SECOND miss, because the ladder waits for two', () => {
    const reteach = readFileSync(join(SRC, 'wobo', 'reteach.ts'), 'utf8');
    expect(reteach).toContain('export const RETEACH_AFTER_MISSES = 2;');
    expect(PARENTS).toContain('It changes method after a second miss.');
    expect(STUDENTS).toContain('Miss it twice and it');
  });

  it('promises the analogy only where the learner has stated an interest', () => {
    // reteach.ts refuses the rung outright when they have said nothing, and both pages say so
    expect(readFileSync(join(SRC, 'wobo', 'reteach.ts'), 'utf8')).toContain(
      'ready: (c) => Boolean(c.world?.trim())',
    );
    expect(PARENTS).toContain('If they have told it nothing, Wobo explains plainly');
    expect(STUDENTS).toContain("only if you've told Wobo what that is");
  });
});

// --- the report a parent is shown ------------------------------------------------------------------

describe('the report the parents page draws is the report the app draws', () => {
  const evidence = readFileSync(join(SRC, 'screens', 'progress', 'evidence.ts'), 'utf8');

  it('shows the three figures the app computes, under the app’s own headings', () => {
    for (const heading of ['What was learnt', 'Needed another pass', 'What is coming']) {
      expect([heading, PARENTS.includes(heading)]).toEqual([heading, true]);
    }
    // "Right a week on", not "Held a week later". `screens/progress/Report.tsx` renamed this
    // metric in the app and wrote down why: `heldLater` requires no GAP, so a learner drilling a
    // concept daily has every answer from day eight in it, and the old label claimed retention
    // across a week WITHOUT practice. The marketing page shipped the label the product took down.
    for (const figure of ['Minutes', 'Topics learnt', 'Right a week on']) {
      expect([figure, PARENTS.includes(figure)]).toEqual([figure, true]);
      expect([figure, evidence.length > 0]).toEqual([figure, true]);
    }
  });

  it('projects only from a pace, because projectFinish refuses to draw a line without one', () => {
    expect(evidence).toContain('export function projectFinish(');
    expect(evidence).toContain(
      "line: 'Learn one topic and a finish line appears here, drawn from your own pace and nothing else.',",
    );
    expect(PARENTS).toContain('once there is a pace');
    expect(PARENTS).toContain('Drawn from their own pace, and it says so on the report.');
  });

  it('says out loud that the numbers in the drawing are an example', () => {
    // the copy law forbids a fabricated figure, and an unlabelled mock full of numbers is one
    expect(PARENTS).toContain('Drawn here with example numbers.');
    expect(PARENTS_PROTO).toContain('Drawn here with example numbers.');
  });

  /**
   * SAYS WHAT THE ARITHMETIC IS, NOT WHAT IT SOUNDS LIKE.
   *
   * The note under this figure read "measured only after a week", and the figure was labelled
   * "Held a week later" — both of which claim retention across a week WITHOUT practice.
   * `evidence.ts` counts an answer once a week has passed since the FIRST answer on that concept
   * and requires no gap at all, so a learner drilling a concept daily has every answer from day
   * eight in it. `screens/progress/Report.tsx` already made this correction inside the app and
   * wrote down why; the page a parent reads shipped the retracted label for another five surfaces.
   *
   * The assertion is now two-sided: the window is still real and still seven days, AND the page is
   * held off the stronger claim in either of the two wordings that made it.
   */
  it('describes the retention figure as the arithmetic it actually is', () => {
    expect(evidence).toContain('export const HELD_WINDOW_DAYS = 7;');
    expect(PARENTS).toContain('answers given a week or more after the first');
    for (const overclaim of [
      /held a week later/i,
      /measured only after a week/i,
      /still right a week later/i,
    ]) {
      expect([overclaim.source, overclaim.test(PARENTS)]).toEqual([overclaim.source, false]);
      expect([overclaim.source, overclaim.test(PARENTS_PROTO)]).toEqual([overclaim.source, false]);
    }
  });
});

// --- what it costs, and what happens if they stop ---------------------------------------------------

describe('the payer is told what stopping costs before being asked to start', () => {
  it('promises no money back, only that nothing renews', () => {
    expect(PARENTS).not.toMatch(/refund|money back|guarantee/i);
    expect(PARENTS).toContain('nothing renews');
    expect(PARENTS).toContain('everything learnt stays exactly where it is');
  });

  it('says cancelling takes as many taps as subscribing, with nothing in the way', () => {
    expect(PARENTS).toContain('Cancelling takes as many taps as subscribing');
    expect(PARENTS).toContain('offers no discount, no pause and no reason picker');
  });

  it('hands the data question off to the page that answers it in full', () => {
    expect(PARENTS).toContain('What we hold, and what we will never do with it.');
    expect(PARENTS).toContain('Read the Security and trust page');
  });
});

// --- the clock, in every shape it takes ------------------------------------------------------------

/**
 * NEVER NAME A LATE HOUR (DESIGN.md §0, owner, 2026-09-04, corrected twice).
 *
 * `site/hours.test.ts` already bans the bare hour — "10pm", "9 pm", "tonight", "midnight". It does
 * NOT catch a CLOCK TIME, because its pattern reads a digit followed by "pm" and a clock puts a
 * colon in between: `\b9\s?pm` cannot see "9:46 pm". Both of these pages were shipping one anyway —
 * a lesson row timed "Tuesday 9:46 pm" on the payer's phone mock, and a chat opening "Tuesday, 9:41
 * pm" on the learner's — which is the same picture the law exists to forbid, drawn with two extra
 * characters. A parent reading either one sees a product that had their child up at a quarter to
 * ten, which is the problem rather than the answer.
 *
 * So this asserts the shape the law is actually about — an hour that reads as late, however it is
 * spelt — over the shipped pages AND their prototypes, which are the thing the next worker ports
 * from. Six o'clock and an after-school afternoon stay legal: the point being made is availability
 * and choice, never lateness.
 */
const A_LATE_HOUR: readonly [RegExp, string][] = [
  [
    /\b(?:8|9|1[012])\s*[:.]\s*[0-5]\d\s*(?:pm|p\.m\.)/i,
    'a clock time reads later than a bare hour, not earlier — say "after school" or name no hour',
  ],
  [
    /\b(?:8|9|1[012])\s?(?:pm|p\.m\.)/i,
    'say "after school", "over the weekend", "whenever they want"',
  ],
  [
    /\b(?:eight|nine|ten|eleven|twelve)\s+(?:at night|o.?clock at night)\b/i,
    'the same hour, spelt',
  ],
  [/\btonight\b|\bmidnight\b|\blate at night\b/i, 'drop the hour entirely'],
  [/\bwhen everyone (?:else )?is asleep\b|\bnobody is awake\b/i, 'say "on their own time"'],
  [
    /\bthe night before (?:the |an |their )?exam/i,
    'we are not a cramming tool: say "a bit at a time, so the exam is revision"',
  ],
];

describe('neither buyer page pictures a child studying late', () => {
  for (const [pattern, instead] of A_LATE_HOUR) {
    it(`carries nothing matching ${pattern.source}`, () => {
      const guilty: string[] = [];
      for (const [name, text] of SURFACES) {
        for (const line of text.split('\n')) {
          const hit = line.match(pattern);
          if (hit) guilty.push(`${name}: "${hit[0]}" — ${instead}`);
        }
      }
      expect(guilty, instead).toEqual([]);
    });
  }

  it('says availability instead, and says it in more than one way', () => {
    // the vocabulary is not scarce (DESIGN.md §0), and one phrase repeated on both pages is a tic
    const vocabulary = [
      /after school/i,
      /over the weekend/i,
      /on a holiday/i,
      /between classes/i,
      /on the way home/i,
      /whenever (?:they|you) want/i,
      /wherever (?:they|you) are/i,
    ];
    for (const [name, text] of SURFACES) {
      const said = vocabulary.filter((v) => v.test(text)).length;
      expect([name, said >= 3]).toEqual([name, true]);
    }
  });
});

// --- two modes, and never blurred ------------------------------------------------------------------

/**
 * A DOUBT AND A LESSON ARE NOT THE SAME PRODUCT (docs/SELL.md §2, owner, 2026-09-04):
 * *"for doubt clarification yes, always any time but to learn its not a day before the exams
 * right"*.
 *
 * A doubt is cleared the moment it appears, wherever they are. Learning goes a bit at a time across
 * weeks, so the week before an exam is revision rather than panic. Blurring the two sells a cram
 * tool, and a cram tool is reached for three times a year by a frightened child; the thing that was
 * actually engineered is the other one, and every anti-cramming mechanism on the parents page —
 * mastery gating, the prerequisite taught first, the return of what slipped — is already asserted
 * against its module further up this file. This asserts that the pages SAY SO, distinctly, in each
 * audience's own words, because a parent who cannot tell the two apart reads the six things as a
 * shortcut with extra steps.
 */
describe('both buyer pages carry both modes, and never blur them', () => {
  const MODES: readonly [name: string, text: string][] = [
    ['ForParents.tsx', PARENTS],
    ['ForStudents.tsx', STUDENTS],
  ];

  it('names the doubt as the one with no clock on it', () => {
    for (const [name, text] of MODES) {
      expect([name, /a doubt/i.test(text)]).toEqual([name, true]);
      expect([name, /the moment it (?:appears|lands|turns up)/i.test(text)]).toEqual([name, true]);
    }
  });

  it('names learning as the slow one, measured in weeks rather than in an evening', () => {
    for (const [name, text] of MODES) {
      expect([name, /a bit at a time/i.test(text)]).toEqual([name, true]);
      expect([name, /revision/i.test(text)]).toEqual([name, true]);
    }
  });

  it('sells no shortcut, on either page', () => {
    for (const [name, text] of MODES) {
      expect([
        name,
        /\bcram(?:ming)? (?:for|the night|in one)|\bin one night\b|\bovernight\b/i.test(text),
      ]).toEqual([name, false]);
    }
    // and the parents page says out loud that the slow one is the design, not a limitation
    expect(PARENTS).toContain('Nothing here is a shortcut.');
  });

  it('draws the two as two, so the shape of the block is the argument', () => {
    for (const [name, text] of MODES) {
      expect([name, (text.match(/className="pt-modes"/g) ?? []).length]).toEqual([name, 1]);
      expect([name, (text.match(/className="pt-slow"/g) ?? []).length]).toEqual([name, 1]);
    }
  });
});

// --- trap 4: a highlighted phrase that cannot wrap --------------------------------------------------

/**
 * THE MARK WRAPS ON A PHONE (DESIGN.md §0, trap 4).
 *
 * The marigold highlighter under a headline word is an absolutely positioned bar, and a bar cannot
 * follow an inline that breaks across two lines — so the rule that draws it pinned the phrase with
 * `white-space:nowrap`. The learner's page highlights "changes the whole approach", which at the
 * headline size is wider than a phone: measured in Chromium at a 390px viewport, site-students.html
 * reported `scrollWidth` 461 against `clientWidth` 390, and the WHOLE SITE scrolled sideways.
 *
 * That is the fourth trap, word for word, and the repo has already paid for it once ("one
 * highlighted phrase forced the whole page to 1731px"). The fix is the one the law prescribes
 * rather than a shorter headline: below the phone breakpoint the mark stops being a bar and becomes
 * the span's own painted background with `box-decoration-break: clone`, sized from the LINE BOX and
 * centred so a superscript inside a highlighted phrase is contained (trap 5). Both the sheet and
 * the prototype it is ported from carry it, and this fails if either loses it.
 */
describe('a highlighted phrase wraps rather than widening the phone', () => {
  const SHEET = readFileSync(join(HERE, 'styles.ts'), 'utf8');
  const MARKED: readonly [name: string, css: string, sel: string][] = [
    ['pitch/styles.ts', SHEET, '.pt-chapter h2 .pt-hl'],
    ['site-students.html', STUDENTS_PROTO, '.chapter h2 .hl'],
  ];

  /** The declarations a `max-width:560px` block gives `sel`, flattened as styles.test.ts does. */
  function onAPhone(css: string, sel: string): string {
    const block = css.match(/@media \(max-width:560px\)\{([\s\S]*?)\n\}/g) ?? [];
    return block.filter((b) => b.includes(sel)).join(' ');
  }

  for (const [name, css, sel] of MARKED) {
    it(`${name} lets ${sel} break across lines on a phone`, () => {
      const phone = onAPhone(css, sel);
      expect([name, phone.includes('white-space:normal')]).toEqual([name, true]);
      expect([name, phone.includes('box-decoration-break:clone')]).toEqual([name, true]);
      // sized from the line box and centred, so what rises above the baseline stays inside it
      expect([name, phone.includes('background-size:100% 92%')]).toEqual([name, true]);
      expect([name, phone.includes('background-position:0 50%')]).toEqual([name, true]);
      // and the bar the mark used to be is out of the way rather than painting a second time
      expect([name, /\.\w[\w-]* h2 \.[\w-]*hl::before\{display:none\}/.test(phone)]).toEqual([
        name,
        true,
      ]);
    });
  }

  it('still pins the phrase above the phone, where the bar can animate on one line', () => {
    expect(SHEET).toContain('.pt-chapter h2 .pt-hl{position:relative;white-space:nowrap}');
  });
});
