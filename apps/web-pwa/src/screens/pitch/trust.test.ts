/**
 * THE QUALIFIER AND THE TRUST PAGES — /subjects, /how-it-works, /meet-wobo, /security and /about,
 * held to the three rulings the owner gave on 2026-09-04 (docs/SELL.md, DESIGN.md §0).
 *
 * WHY THIS FILE EXISTS. `buyers.test.ts` holds the two BUYER pages to the "never run anything down"
 * law and nothing held these five to it at all — which is how "at the hour when parents are tired
 * and TUTORS ARE EXPENSIVE" stayed on /about, the page whose whole job is belief, after the ruling
 * had been given. A law that only one page's test knows about is a law half the site can break.
 *
 * The patterns are deliberately NOT shared with `buyers.test.ts`, and that is not an oversight.
 * Two of them cannot be applied site-wide as written: the landing page names ChatGPT and Gemini on
 * purpose (`landing/page-copy.ts` — "ask an assistant you already trust to go and read our site"),
 * and this page set says "a good teacher never" as PRAISE, which is the pitch itself. A pattern
 * list is only honest inside the surfaces it was checked against, so each file carries its own and
 * says what it covers.
 *
 * Everything here reads the shipped source rather than rendering it. These are copy and structure
 * laws — what a page is allowed to SAY, how many doors it is allowed to have, and where the words
 * on those doors come from — and the source is where a reviewer will look for them.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CTA, RETIRED_CTA, START_FREE_LABEL } from '../site/cta';
import { handoff, type PublicPage } from '../site/handoffs';

const HERE = new URL('.', import.meta.url).pathname;
const read = (path: string) => readFileSync(new URL(path, import.meta.url).pathname, 'utf8');

/** A comment carries the reasoning and often quotes the banned phrase to explain it. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

interface Surface {
  /** The file, and the name a failure prints. */
  name: string;
  /** The shipped source, comments and all. */
  raw: string;
  /** The source with the reasoning taken out. Only this counts as copy. */
  copy: string;
  /** The key it passes to `<ClosePanel />`, which is where its one primary comes from. */
  page: PublicPage;
  /**
   * How many LOUD doors (`st-btn st-pig`) the page carries above its close. One, everywhere except
   * /security: that page is a reference a worried reader scrolls through, its hero doors are
   * in-page navigation to the two things they came for, and its one primary is the close, which is
   * where a fear has actually been answered (docs/SELL.md §6).
   */
  loud: number;
}

function surface(file: string, page: PublicPage, loud: number): Surface {
  const raw = read(file);
  return { name: file.replace(/^\.\.\//, ''), raw, copy: stripComments(raw), page, loud };
}

const SURFACES: readonly Surface[] = [
  surface('./Subjects.tsx', 'subjects', 1),
  surface('./HowItWorks.tsx', 'how', 1),
  surface('./MeetWobo.tsx', 'meet', 1),
  surface('./Security.tsx', 'security', 0),
  surface('../site/About.tsx', 'about', 1),
];

const HOW = SURFACES.find((s) => s.page === 'how')!;
const SUBJECTS = SURFACES.find((s) => s.page === 'subjects')!;

it('has all five surfaces, and reads them from the shipped source', () => {
  expect(SURFACES.map((s) => s.page)).toEqual(['subjects', 'how', 'meet', 'security', 'about']);
  expect(HERE.endsWith('/screens/pitch/')).toBe(true);
  for (const s of SURFACES) expect(s.raw.length > 2000).toBe(true);
});

// --- A. we never sell by running anything down ---------------------------------------------------

/**
 * Owner, 2026-09-04: "Lets not degrade tutors or say school is bad; all we do is we talk about what
 * we are capable of and let the viewers be the judge of it."
 *
 * The ban is on the MOVE, not on a vocabulary, so these are patterns: "unlike a tutor", "cheaper
 * than coaching", "tutors are expensive" and "just a chatbot" are one sentence with different nouns
 * in it. Putting a PRICE on somebody else's work is the same move as putting a limit on it, which
 * is the row `buyers.test.ts` does not have and /about needed.
 */
const RUNNING_SOMETHING_DOWN: readonly (readonly [RegExp, string])[] = [
  [
    /\b(?:tutors?|teachers?|tuition|coaching|classes)\b[^.\n]{0,40}\b(?:expensive|costly|pricey|unaffordable|out of reach)\b/i,
    'a price put on somebody else\'s work is still a comparison',
  ],
  [
    /\b(?:expensive|unaffordable|out of reach)\b[^.\n]{0,30}\b(?:tutors?|teachers?|tuition|coaching)\b/i,
    'the same sentence, inverted',
  ],
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
  [/\bjust a (?:chatbot|chat window|search box)\b/i, 'an implication about somebody else'],
  [/\b(?:boring|useless|broken|outdated) (?:app|class|lesson|school|textbook)/i, 'a jab'],
];

/**
 * The one exemption, and it is the pitch itself: "everything a great teacher does, for one child".
 * "A good teacher never raises their voice" honours the craft — the pattern above cannot tell that
 * from "teachers never notice", so the line is read for praise before it is called a jab.
 */
const PRAISE = /\b(?:a |the )?(?:good|great|best|patient|real) (?:teacher|tutor|school)/i;

describe('nothing on the five is sold by running something down', () => {
  for (const [pattern, why] of RUNNING_SOMETHING_DOWN) {
    it(`says nothing matching ${pattern.source} — ${why}`, () => {
      const hits: string[] = [];
      for (const s of SURFACES) {
        for (const line of s.copy.split('\n')) {
          if (pattern.test(line) && !PRAISE.test(line)) hits.push(`${s.name}: ${line.trim().slice(0, 110)}`);
        }
      }
      expect(hits, why).toEqual([]);
    });
  }

  it('still lets a page praise a teacher, which is the pitch', () => {
    expect(PRAISE.test('Louder is the one move a good teacher never makes.')).toBe(true);
    expect(PRAISE.test('and tutors are expensive')).toBe(false);
  });
});

// --- B. one phrase for the call, and it lives in one file ----------------------------------------

describe('every door reads its words from cta.ts', () => {
  it('has retired the waitlist phrase on all five', () => {
    const guilty = SURFACES.filter((s) => s.raw.includes(RETIRED_CTA)).map((s) => s.name);
    expect(guilty, `${RETIRED_CTA} implies a waitlist and we are open`).toEqual([]);
  });

  it('never types the call to action as a literal', () => {
    const guilty = SURFACES.filter((s) => s.copy.includes(`>${START_FREE_LABEL}<`)).map((s) => s.name);
    expect(guilty, 'read CTA.label, so the phrase can never drift apart again').toEqual([]);
  });

  it('gives each page exactly the doors its job needs, and no second front door', () => {
    for (const s of SURFACES) {
      const loud = s.copy.match(/st-btn st-pig/g) ?? [];
      expect(loud.length, `${s.name} loud doors`).toBe(s.loud);
    }
  });

  it('sends every loud door to the one destination', () => {
    for (const s of SURFACES.filter((x) => x.loud > 0)) {
      expect(s.copy, `${s.name} points its door somewhere of its own`).toContain('to={CTA.to}');
    }
    expect(CTA.to).toEqual({ name: 'onboarding' });
  });
});

// --- C. one page, one job, one close -------------------------------------------------------------

describe('each page closes on its own argument, not on a template', () => {
  it('closes through the table, so a page cannot type its own door', () => {
    for (const s of SURFACES) {
      expect(s.copy, `${s.name} must close through ClosePanel`).toContain(
        `<ClosePanel page="${s.page}"`,
      );
    }
  });

  it('gives the five five different closes', () => {
    const titles = SURFACES.map((s) => handoff(s.page).title);
    expect(new Set(titles).size).toBe(SURFACES.length);
    const quiets = SURFACES.map((s) => handoff(s.page).quiet.label);
    expect(new Set(quiets).size).toBe(SURFACES.length);
  });

  it('keeps every one of the five jobs the one docs/SELL.md §6 gave it', () => {
    expect(handoff('subjects').job).toContain('does it cover mine');
    expect(handoff('how').job).toContain('why this will work');
    expect(handoff('meet').job).toContain('make the tutor real');
    expect(handoff('security').job).toContain('remove the fear');
    expect(handoff('about').job).toContain('belief');
  });
});

// --- D. the qualifier page must be answerable ----------------------------------------------------

describe('/subjects answers "does it cover mine" rather than illustrating it', () => {
  it('renders the real finder over the real registry, not a picture of one', () => {
    expect(SUBJECTS.copy).toContain('<BoardFinder');
    expect(SUBJECTS.copy).toContain('reachLine()');
  });

  it('puts the door inside the finder, so "found yours" and "start" are one move', () => {
    const finder = SUBJECTS.copy.slice(SUBJECTS.copy.indexOf('<BoardFinder'));
    expect(finder.slice(0, 300)).toContain('CTA.label');
  });
});

// --- E. two modes, never blurred -----------------------------------------------------------------

/**
 * Owner, 2026-09-04: "for doubt clarification yes, always any time but to learn its not a day
 * before the exams right". The mechanism page is where both have to be said, distinctly, and the
 * slow one has to be said as the anti-cramming argument it actually is in the code.
 */
describe('the mechanism page says both modes, and does not blur them', () => {
  it('carries the two of them as two separate things', () => {
    expect(HOW.copy).toContain('hw-modes');
    expect(HOW.copy).toContain('A doubt');
    expect(HOW.copy).toContain('A subject');
  });

  it('says the doubt is answered when it turns up, without naming an hour', () => {
    expect(HOW.copy).toMatch(/Answered the moment it turns up/);
    expect(HOW.copy).toMatch(/After school, between classes, on the way home, over the weekend/);
  });

  it('sells the slow mode as revision rather than as a rescue', () => {
    expect(HOW.copy).toMatch(/a bit at a time|Built a bit at a time/);
    expect(HOW.copy).toMatch(/exam week is revision|is revision rather than a rescue/);
  });

  it('claims only the three anti-cramming mechanisms the code actually has', () => {
    // curriculum/placement.ts (MAX_PLACEMENT_QUESTIONS = 3), screens/learn/mastery.ts.
    expect(HOW.copy).toContain('Three questions at most on the ground beneath a topic');
    expect(HOW.copy).toContain('Completed is not learnt');
    expect(HOW.copy).toContain('Nothing is ever locked');
  });
});

// --- F. proof is specific, or it is not proof ----------------------------------------------------

/**
 * docs/SELL.md §5: we have no testimonials, no user count and no press, and we will not invent any.
 * What is left is the product working, specificity, and transparency — so a vague phrase is not a
 * weak sentence here, it is a conversion leak standing where a fact should be.
 */
const VAGUE: readonly (readonly [RegExp, string])[] = [
  [/\bcomprehensive\b/i, 'name what is covered instead'],
  [/\bworld[- ]class\b|\bcutting[- ]edge\b|\bstate[- ]of[- ]the[- ]art\b/i, 'puffery'],
  [/\bindustry[- ]leading\b|\bbest[- ]in[- ]class\b|\bunparalleled\b/i, 'an unprovable superlative'],
  [/\bseamless(?:ly)?\b|\brevolutionary\b|\bgame[- ]chang/i, 'a word that says nothing'],
  [/\b(?:bank|military|enterprise)[- ]grade\b/i, 'a security claim nobody audited'],
  [/\b100% (?:secure|safe|accurate|private)\b/i, 'an absolute we cannot show'],
  [/\btrusted by (?:thousands|millions|families everywhere)\b/i, 'a user count we do not have'],
  [/\b(?:thousands|millions) of (?:families|students|learners|parents)\b/i, 'the same count, spelled out'],
  [
    /\b(?:trusted|used|loved|chosen) by (?:[\d,]+|a |an )?(?:hundred|thousand|million|lakh|crore)/i,
    'a number of families, even as a turn of phrase, reads as a count we do not have',
  ],
];

describe('no vague phrase stands where a fact should', () => {
  for (const [pattern, why] of VAGUE) {
    it(`says nothing matching ${pattern.source} — ${why}`, () => {
      const hits: string[] = [];
      for (const s of SURFACES) {
        for (const line of s.copy.split('\n')) {
          if (pattern.test(line)) hits.push(`${s.name}: ${line.trim().slice(0, 110)}`);
        }
      }
      expect(hits, why).toEqual([]);
    });
  }
});
