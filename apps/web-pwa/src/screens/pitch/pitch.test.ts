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
  // the prototype dropped the sixth promise ("Train on a child without consent"); a page that
  // makes six promises to a parent does not quietly make five
  'Five lines wed put in a contract.',
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
  /begin tonight|start learning for free|start free\b|set it up for my child/i, // promote first
  /this evening|\btonight\b/i, // the same invitation with the clock changed
  /the first question is on us/i, // the same invitation, in Wobo's hand
  /which classes and subjects/i, // a grade gate with the numbers taken out is still a gate
  /\bshe\b|\bher\b|\bhe\b|\bhis\b/i, // a learner with a gender is an invented learner
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
  const body = html.split('</header>')[1]?.split('<footer>')[0] ?? '';
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

const SHARED = ['maths.ts', 'Ask.tsx', join('..', 'site', 'ClosePanel.tsx')]
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
  it('composes a draft to the mailbox that answers anything, with the school when given', () => {
    const href = overviewMailto('lead@school.example', 'A school');
    expect(href.startsWith(`mailto:${CONTACT.address}?`)).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('subject')).toBe('Security overview');
    expect(query.get('body')).toBe(
      'Please send the security overview to lead@school.example.\nSchool or organisation: A school',
    );
    expect(new URLSearchParams(overviewMailto('a@b.c', '').split('?')[1]).get('body')).toBe(
      'Please send the security overview to a@b.c.',
    );
  });
});

describe('the lines a page reads from data', () => {
  it('names the mailbox the legal set publishes, rather than one typed on the page', () => {
    expect(MAILBOXES.some((box) => box.address === 'support@heywobo.com')).toBe(true);
    const source = readFileSync(join(import.meta.dir, 'Security.tsx'), 'utf8');
    expect(source).toContain("startsWith('support@')");
  });
});
