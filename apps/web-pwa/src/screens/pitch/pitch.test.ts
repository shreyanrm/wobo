/**
 * The six pitch pages say what their prototypes say — every line of copy on
 * design/prototypes/site-{security,meet,parents,students,how,subjects}.html, word for word.
 *
 * The check is blunt on purpose: every run of text the prototype's body carries (twelve
 * characters or longer, so a stray "yes" or a tick does not count) has to appear in the page's
 * source, or in the two modules a page draws its words from — `maths.ts` for the three things a
 * visitor can try, `Ask.tsx` for the ask block's label and the shell's ClosePanel for the shared
 * close. The prototype's text is split at its tags; on both sides quotes and brackets are dropped
 * and whitespace is folded, so a sentence wrapped across three JSX lines, or handed to a
 * component as a prop, still matches its one prototype line, and a sentence with a word changed
 * does not.
 *
 * The one line that is data rather than copy — the mailbox the security page's report panel names,
 * which the page reads from the legal set's published addresses — is checked against that source
 * instead.
 *
 * AND a prototype line the COPY LAW forbids is not a line the page has to carry. Law v5
 * (DESIGN.md §0) outranks the prototypes and the prototypes are still catching up to it, so a
 * mock-up that still names an invented learner, gates a reader by class, counts out a raw
 * allowance or invites someone into a product that has not opened cannot drag the shipped page
 * back over the line. `site/law-v5.test.ts` asserts the other half: that no page says any of it.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACT } from '../auth/copy';
import { MAILBOXES } from '../site/identity';
import { overviewMailto } from './Security';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO = join(REPO, 'design', 'prototypes');

const PAGES: readonly { proto: string; source: string }[] = [
  { proto: 'site-security.html', source: 'Security.tsx' },
  { proto: 'site-meet.html', source: 'MeetWobo.tsx' },
  { proto: 'site-parents.html', source: 'ForParents.tsx' },
  { proto: 'site-students.html', source: 'ForStudents.tsx' },
  { proto: 'site-how.html', source: 'HowItWorks.tsx' },
  { proto: 'site-subjects.html', source: 'Subjects.tsx' },
];

/**
 * Lines a page renders from data rather than from its own copy: the mailboxes come from the legal
 * set's published addresses (`site/identity.ts`), so a mock-up that still prints one we have
 * retired is not a line the page is missing.
 */
const DATA_LINES = new Set(['support@heywobo.com', 'security@heywobo.com']);

/**
 * A prototype line the page deliberately improves on, with the reason. Kept short on purpose: an
 * entry here is a decision, not a backlog.
 */
const BETTER_HERE = new Set([
  /*
    --- /security: fourteen lines the DRAWING promises and the CODE does not keep ---------------

    Every one of these was verified false against this repository on 2026-09-04, and every one was
    live at /security. A prototype is a drawing and a page is a claim, so where the two disagree
    about what the product DOES, the page wins and the drawing is corrected the day somebody
    redraws it. The reason is written beside each claim in `Security.tsx` itself; the short version:

      · "erase all" / "the erase-everything button" / "deletes memory, progress and the account" —
        POST /v1/me/erase clears six things (memory.Erasure) and NOTHING in the gateway, the SDK or
        the app calls the auth admin API. The account survives every button this product has.
      · "unless a family turns on transcripts" — there is no transcripts setting anywhere. The row
        names a family control that has never existed, and it is the sentence a parent reads to
        decide whether voice is safe.
      · "Consent by age and country" / "a parent's verifiable consent before a child's account
        opens" — `consent_tier` is read on every capability call and written by nothing. Our own
        `docs/legal/childrens-privacy.md` §3 opens "There is no consent gate in Wobo today", and
        two live surfaces may not say opposite things about children's consent.
      · "Every change is reviewed and gated by automated checks. Dependencies are scanned." —
        `gh api .../branches/main/protection` returns 404 Branch not protected, `rulesets` returns
        [], and ci.yml runs no audit of any kind. Only the secrets half of that sentence is true.
      · "The parent view. A linked parent sees lessons, progress and the Sunday note." — the Sunday
        note is real; /parent renders localStorage on the VIEWER's device, so a parent opening it
        sees their own empty storage. The note no longer links there and carries the week itself.
      · "Holds accounts, learning data and backups, encrypted." with region "INDIA, WITH EU FOR EU
        FAMILIES" — there is one database project and no EU project; nothing in the repository
        provisions, routes to or names a second region.
  */
  'and you can erase all of it with one button.',
  'Erase memory, keep progress, or erase all',
  'Not stored, unless a family turns on transcripts',
  'Nothing to delete by default',
  'Every change is reviewed and gated by automated checks. Dependencies are scanned. Secrets never live in the code.',
  'Consent by age and country.',
  'Under 18 in India needs a parents verifiable consent under the DPDP Act 2023. Under 13 in the United States follows COPPA. Under 16 in the EU follows GDPRs rules for children.',
  'The parent view.',
  'A linked parent sees lessons, progress and the Sunday note. They cannot read a childs typed questions word for word unless the childs settings allow it.',
  'The erase-everything button.',
  'In Settings, for the learner and for a linked parent. It deletes memory, progress and the account.',
  /*
    --- a door that does not exist, and a character the law forbids (wave 29, site-3 and site-4) --

    "You, in Settings, any time" sends a reader to a Settings screen; the app has four doors and
    Settings is a card on You, so the page says "On You, under Settings" (`site/doors.test.ts`).
    The two note sign-offs carried an em dash, which docs/copy/voice.md 10a allows nowhere a
    learner reads; the notes now sign "From Wobo" (`site/sell.test.ts`).
  */
  'You, in Settings, any time. Gone from live systems at once, and out of the backups behind them as those roll over.',
  'minutes a day. — Wobo',
  'triangles. — Wobo',
  'A parents verifiable consent before a childs account opens, no profiling of a child for advertising, and erasure on request.',
  'Reviewed and gated.',
  'Holds accounts, learning data and backups, encrypted.',

  // How it works marks a chapter that still holds as "held" rather than the prototype's
  // "mastered": docs/copy/growth/lines.md (2026-09-09) keeps that word off every surface a
  // learner reads, and the for-parents page is the only public page it lets keep it.
  'mastered',
  // the prototype dropped the sixth promise ("Train on a child without consent"); a page that
  // makes six promises to a parent does not quietly make five
  'Five lines wed put in a contract.',
  // The second half of the students hero, whose first half is "It's 10 pm, you're stuck," — banned
  // by the clock law below. The page rewrote the whole sentence rather than keeping the half that
  // only reads as a headline with the hour in front of it: "and nobody around can explain it."
  'and nobody is awake.',
  // The parents hero. DESIGN.md §0 still quotes "for one child, at ten at night" as the pitch, and
  // the clock law written the same day forbids picturing a child studying late. The page keeps the
  // whole promise and drops the hour — "for one child, whenever they want to learn." — which is
  // the availability the line was always reaching for. FLAGGED FOR THE OWNER: the two lines in
  // DESIGN.md §0 disagree, and only the owner can retire one of them.
  'for one child, at ten at night.',
  // The parents hero's first promise. The owner placed the adaptive line on the public pages on
  // 2026-09-09 (docs/copy/growth/lines.md, "Not a fixed course. It adapts to you and does not
  // stop until the topic is mastered", form 4: "It is not content your child scrolls. It is a
  // tutor that changes how it teaches until your child has it, and tells you when they do."),
  // and the entry names the for-parents page's first promise as its place. The prototype still
  // carries the older sentence, so the drawing is behind the law, not the page. The new line is
  // held word for word, and in the hero, by `site/sell.test.ts` (section H); the page keeps the
  // prototype's second half, "You set it up once. It runs on its own after that."
  'Wobo teaches your childs own syllabus, draws the answer until it lands, and shows you what actually moved this week. You set it up once. It runs on its own after that.',

  // --- /subjects: the drawn typeahead became a real one (BoardFinder.tsx) --------------------
  // The prototype's boards paragraph says every board a reader types has "the year's official
  // syllabus behind it". The registry carries 268 boards; `content/curriculum/syllabi` holds the
  // official chapter lists for four of them, and the other files there record a fetch that was
  // blocked rather than a syllabus. So the clause is not true, it is the exact kind of claim the
  // owner has caught this repo inventing twice, and the page says what is true instead while
  // keeping the sentence's honest half word for word.
  'Type your board and Wobo finds it, with the years official syllabus behind it. Not listed? Paste your schools syllabus and Wobo builds the plan from that, unit by unit.',
  // The three lines below are what the STILL drew inside that typeahead: two invented result rows
  // and the label under one of them. The page now runs a real search over the real registry, and
  // holding a working control to the words somebody typed into a picture of it would be holding it
  // to the wrong source. The registry answers "tel" with these boards under their registered
  // names, which is a better answer than the drawing's and not one this page gets to write.
  'angana State Board (BSE)',
  'angana Intermediate (TSBIE)',
  'senior secondary',

  // --- /security: the sub-processor line the page had to make true ---------------------------
  // The prototype tells a parent that the model providers "answer the question without ever
  // knowing whose it is". They are sent a first name, a class and a board, so the sentence is not
  // true, and it is untrue on the one page whose entire credibility rests on not overclaiming
  // (docs/SELL.md §5). The page names exactly what is sent and exactly what is not, which is a
  // longer sentence and a stronger one: a company that tells you what it hands over is believed
  // about what it holds back.
  'Answer the question without ever knowing whose it is.',
]);

/**
 * A prototype line law v5's copy law forbids. The law is the authority on these six things, so a
 * page is right to say something else — and a prototype that still carries one of them is stale,
 * not a specification.
 */
const AGAINST_THE_LAW = [
  /\b(aanya|arjun|riya|meera|priya|ananya|rohan|kavya|ishaan|sanya)\b/i, // no names
  /\bclass(?:es)? \d|\bgrades? \d|\bages? \d/i, // no grade gate
  /\b\d+ (?:questions|turns) a day\b|\bof \d+ (?:questions|turns)\b/i, // no raw allowance
  /\b(?:forty|two hundred|eight hundred) questions\b/i,
  // THE DOOR. "Promote before you invite" is retired (DESIGN.md §0, owner, 2026-09-04): we are
  // open, and the door says the one phrase `site/cta.ts` holds, on every surface. A prototype
  // button that says something else is stale, not a specification — which is why "Start free"
  // itself is NOT banned here any more, and the phrasings it replaced are.
  /start learning for free|get early access|begin tonight|set it up for my child/i,
  // THE CLOCK LAW (site/hours.test.ts, owner, 2026-09-04). No public surface pictures a child
  // studying late, so the prototypes' late-night headlines are lines a page is right to refuse.
  // "this evening" came off this list with the waitlist: an evening is not a late night.
  /\btonight\b|\bmidnight\b|\blate at night\b/i,
  /\b(?:9|10|11|12)\s?(?:pm|p\.m\.)/i,
  // The same hour with minutes on it. The prototypes stamp the how-it-works beats "Tuesday,
  // 9:40 pm", "9:42 pm", "9:45 pm" and a report card "Tuesday 9:46 pm", and a clock reading is
  // the late hour spelled differently — it slipped past the bare-hour pattern above on four
  // beats of one page. The pages say when without naming an hour: "Tuesday, after school", "A
  // minute later", "Same sitting". (site/hours.test.ts carries the same row for every surface.)
  /\b(?:6|7|8|9|10|11|12)[:.]\d{2}\s?(?:pm|p\.m\.)/i,
  /when everyone (?:else )?is asleep/i,
  /the first question is on us/i, // the same invitation, in Wobo's hand
  /which classes and subjects/i, // a grade gate with the numbers taken out is still a gate
  /\bshe\b|\bher\b|\bhe\b|\bhis\b/i, // a learner with a gender is an invented learner
  // NEVER NARRATE (DESIGN.md §0.x, owner, 2026-09-08). Wobo draws; Wobo does not say "I'll draw".
  // The prototype's transcript still has Wobo announcing the triangle, and a page is right to
  // refuse that line: the words while drawing are about the idea (never-narrate.test.ts).
  /\b(?:let me|I(?:'|’)?ll|I will) (?:draw|show)\b|give me a second/i,
];

const bannedByLaw = (phrase: string): boolean => AGAINST_THE_LAW.some((r) => r.test(phrase));

/** The handful of HTML entities the prototypes type, as the page renders them. */
const ENTITIES: Record<string, string> = {
  '&#10003;': '\u2713',
  '&#8594;': '\u2192',
  '&ldquo;': '\u201c',
  '&rdquo;': '\u201d',
  '&hellip;': '\u2026',
  '&amp;': '&',
  '&nbsp;': ' ',
};

/** Text as both sides are compared: entities decoded, no quotes, no brackets, whitespace folded. */
function fold(s: string): string {
  return s
    .replace(/&#?\w+;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\{' '\}/g, ' ')
    .replace(/[<>/{}]/g, ' ')
    .replace(/['"`\u2018\u2019\u201c\u201d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every run of text the prototype's page body carries, plus every placeholder it types. */
function phrases(html: string): string[] {
  /**
   * THE CLOSE PANEL IS NOT THE PROTOTYPE'S ANY MORE. Every prototype ends on the same three lines
   * ("Start this evening.", "Start learning for free"), which is exactly the template `handoffs.ts`
   * replaced: one page, one job, one primary, in that page's own words, with the door read from
   * `cta.ts`. Holding six pages to one shared close would hold them to the thing we removed on
   * purpose, so the body being compared stops where the close begins. `handoffs.test.ts` and
   * `site/law-v5.test.ts` own the close instead.
   */
  const above = html.split('</header>')[1]?.split('<div class="close">')[0];
  const body = above ?? html.split('</header>')[1]?.split('<footer>')[0] ?? '';
  const noScript = body.replace(/<script>[\s\S]*?<\/script>/g, '');
  const placeholders = [...noScript.matchAll(/placeholder="([^"]+)"/g)].map((m) => m[1] as string);
  const runs = noScript
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim());
  return [...new Set([...runs, ...placeholders].map(fold).filter((s) => s.length >= 12))];
}

/**
 * A page's words read TWICE: once as written, and once with the intrinsic tags (`<text>`,
 * `<tspan>`, `<span>` — the lower-case ones) taken out, so a sentence a drawing breaks across two
 * `<text>` lines still reads as the one sentence the prototype writes on one line. Without the
 * second reading the test measures where the markup happens to break, which is not a thing a
 * reader can see. Component tags stay: `<PitchAsk … placeholder="…" />` carries its words in its
 * props, and stripping it would take them with it.
 */
function bothWays(source: string): string {
  const withoutIntrinsics = source.replace(/<\/?[a-z][^>]*>/g, '');
  return `${fold(source)} ${fold(withoutIntrinsics)}`;
}

const SHARED = [
  'maths.ts',
  'Ask.tsx',
  join('..', 'site', 'ClosePanel.tsx'),
  // every page's close is now a row in one table rather than words on the page (docs/SELL.md §6)
  join('..', 'site', 'handoffs.ts'),
]
  .map((f) => bothWays(readFileSync(join(import.meta.dir, f), 'utf8')))
  .join(' ');

describe('each pitch page carries every line of its prototype', () => {
  for (const page of PAGES) {
    it(`${page.source} says what ${page.proto} says`, () => {
      const html = readFileSync(join(PROTO, page.proto), 'utf8');
      const source = `${bothWays(readFileSync(join(import.meta.dir, page.source), 'utf8'))} ${SHARED}`;
      const missing = phrases(html).filter(
        (p) => !DATA_LINES.has(p) && !BETTER_HERE.has(p) && !bannedByLaw(p) && !source.includes(p),
      );
      expect(missing).toEqual([]);
    });
  }
});

describe('the security overview request', () => {
  /**
   * It asks for the address and nothing else. The form used to carry a second field, "School or
   * organisation (optional)", which put the school into the mail body. We do not deal with schools
   * at this stage (DESIGN.md §0) and the prototype has no such field, so both are gone and this
   * test is the thing that stops one growing back.
   */
  it('composes a draft to the mailbox that answers anything, asking for nothing but the address', () => {
    const href = overviewMailto('a@b.c');
    expect(href.startsWith(`mailto:${CONTACT.address}?`)).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('subject')).toBe('Security overview');
    expect(query.get('body')).toBe('Please send the security overview to a@b.c.');
    expect(query.get('body')).not.toMatch(/school|organisation/i);
  });
});

describe('the lines a page reads from data', () => {
  it('names the mailbox the legal set publishes, rather than one typed on the page', () => {
    expect(MAILBOXES.some((box) => box.address === 'support@heywobo.com')).toBe(true);
    const source = readFileSync(join(import.meta.dir, 'Security.tsx'), 'utf8');
    expect(source).toContain("startsWith('support@')");
  });
});

/**
 * "MASTERED" IS A SCHOOL-REPORT WORD, AND A LEARNER READS THIS PAGE (docs/copy/growth/lines.md,
 * 2026-09-09: "Never the word 'mastered' on a learner-facing surface"). The for-parents page is
 * the one public page the entry lets keep it. How it works marks a chapter that still holds as
 * "held", which is the word its own sentence beside it uses.
 */
describe('how it works never tells a learner a topic is mastered', () => {
  it('renders the word nowhere', () => {
    const rendered = readFileSync(join(import.meta.dir, 'HowItWorks.tsx'), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(rendered).not.toMatch(/\bmastered\b/i);
    expect(rendered).toContain('<em>held</em>');
  });
});
