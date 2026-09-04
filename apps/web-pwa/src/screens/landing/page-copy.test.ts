/**
 * The copy, held to the prototype and to law v5.
 *
 * Two kinds of assertion live here, and the first is the important one:
 *
 *  1. VERBATIM. Every sentence the page shows is walked out of `page-copy.ts` and looked for in
 *     `design/prototypes/landing-v8.html`. "Copy verbatim" is the instruction this port was given,
 *     and a test that reads the source of truth is the only version of that instruction that
 *     survives the next edit. Everything this build adds on top of the prototype is listed in
 *     `OURS` with the reason it exists, so an addition is a decision on the record rather than
 *     drift.
 *  2. THE LAW. DESIGN.md §0's copy rules, as regular expressions: no invented names, no grade
 *     gate, no raw allowances, promote before invite, and drawing is never the whole product.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASK,
  ASK_ELSEWHERE,
  AUTH,
  assistants,
  CLIMB,
  CLOSE,
  DEVICES,
  FAQ,
  FOOTER,
  FORMS,
  HERO,
  HERO_FORMS,
  LOOP,
  NAV_LINKS,
  PARENTS,
  PRACTICE,
  SAFE,
  STUDENTS,
  SUBJECTS,
  TEACHES,
} from './page-copy';

const PROTOTYPE = readFileSync(
  join(import.meta.dir, '../../../../../design/prototypes/landing-v8.html'),
  'utf8',
);

/**
 * The prototype as plain text: entities decoded, whitespace flattened, so a wrap cannot fail us.
 *
 * Every entity is decoded, named and numeric alike. A decoder that knew only four of them would
 * quietly push real prototype copy into `OURS` — "simile ✓" and the marked paragraph's fix line
 * are written as `&#10003;` and `&#8594; &ldquo;&hellip;&rdquo;` — and the verbatim check would
 * stop being verbatim exactly where the prose is most decorated.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  ldquo: '\u201c',
  rdquo: '\u201d',
  lsquo: '\u2018',
  rsquo: '\u2019',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  times: '\u00d7',
  deg: '\u00b0',
  sup2: '\u00b2',
};
const SOURCE = PROTOTYPE.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
  if (body.startsWith('#x') || body.startsWith('#X'))
    return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
  if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
  return NAMED[body] ?? whole;
}).replace(/\s+/g, ' ');

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Which component renders which of the prototype's `<section id>`s, read out of the section files
 * themselves. Nothing is listed by hand: a file that stops rendering an id drops out of the map,
 * and the parity test below then fails with that id named.
 */
const SECTION_SOURCES = new Map<string, string>(
  readdirSync(join(import.meta.dir, 'sections'))
    .filter((name) => name.endsWith('.tsx'))
    .flatMap((name) => {
      const source = readFileSync(join(import.meta.dir, 'sections', name), 'utf8');
      const id = source.match(/<section id="([a-z-]+)"/)?.[1];
      return id ? [[id, name.replace(/\.tsx$/, '').toLowerCase()] as [string, string]] : [];
    }),
);

/**
 * What this build says that the prototype does not, and why. Everything else must be verbatim.
 */
const OURS: readonly string[] = [
  // The prototype's form pretends to have posted. There is no waitlist endpoint, so the page keeps
  // the address on the device and says so — an honest line beats a lie in a nicer font.
  CLOSE.local,
  CLOSE.invalid,
  // A control needs a name a screen reader can read out; the prototype's four squares had one each
  // and the rest were pictures.
  ...PRACTICE.cells,
  PRACTICE.notHalf,
  DEVICES.soon,
];

/** Every sentence the page renders, walked out of the copy tree. */
function pageStrings(): string[] {
  const seen: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      seen.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        // Addresses are ours; the prototype's nav and footer carry the same set.
        // Addresses, keys and a legend swatch's colour are not sentences.
        if (key === 'href' || key === 'key' || key === 'suffix' || key === 'tone') continue;
        walk(entry);
      }
    }
  };
  for (const block of [
    AUTH,
    HERO,
    HERO_FORMS,
    LOOP,
    FORMS,
    TEACHES,
    STUDENTS,
    PRACTICE,
    CLIMB,
    PARENTS,
    SUBJECTS,
    SAFE,
    ASK,
    FAQ,
    DEVICES,
    CLOSE,
    FOOTER,
  ]) {
    walk(block);
  }
  for (const link of NAV_LINKS) seen.push(link.label);
  return seen.filter((s) => s.trim().length > 0);
}

describe('the landing copy', () => {
  it('is the prototype, sentence for sentence', () => {
    const ours = new Set(OURS.map(flat));
    const drifted = pageStrings()
      .map(flat)
      .filter((line) => !ours.has(line) && !SOURCE.includes(line));
    expect(drifted).toEqual([]);
  });

  it('names no learner and no parent (law v5: no names)', () => {
    // Any capitalised given name would do; these are the ones the earlier build actually shipped.
    const banned = /\b(Aanya|Aarav|Riya|Priya|Meera|Rohan|Ananya)\b/;
    for (const line of pageStrings()) expect(line).not.toMatch(banned);
  });

  it('sets no grade gate (law v5: no age range on a public surface)', () => {
    const banned = /\b(class(es)?|grade[s]?|year[s]?)\s*\d|\b\d+\s*(to|–|-)\s*\d+\s*(class|grade)/i;
    for (const line of pageStrings()) expect(line).not.toMatch(banned);
    expect(SUBJECTS.eyebrow).toBe('Every subject your board sets');
  });

  it('prints no raw allowance (law v5: never "40 questions a day")', () => {
    const banned = /\d+\s*(questions?|lessons?|minutes?)\s*(a|per)\s*day/i;
    for (const line of pageStrings()) expect(line).not.toMatch(banned);
    // What it says instead: an allowance that resets, with no number attached to it.
    expect(ASK.answers['What does free include?']).toContain('resets each morning');
  });

  it('promotes before it invites (law v5: the close is early access)', () => {
    expect(AUTH.early).toBe('Get early access');
    expect(CLOSE.title).toBe('Wobo opens to families this term.');
    for (const line of pageStrings()) expect(line).not.toMatch(/begin tonight/i);
  });

  it('never lets the board be the whole product (law v5: drawing is one part)', () => {
    // Five steps, and drawing is step three of them.
    expect(LOOP.steps).toHaveLength(5);
    expect(LOOP.lede).toContain('one of five things Wobo does');
    expect(HERO_FORMS.map((f) => f.label)).toEqual(['Drawn', 'Filmed', 'Tried', 'Spoken']);
  });

  it('gives Wobo no gender (plan §19)', () => {
    for (const line of pageStrings()) expect(line).not.toMatch(/\b(she|her|hers|he|him|his)\b/i);
  });

  it('never says what is underneath (plan §17)', () => {
    // The assistants row names other companies' products — the READER's, not ours — and nothing on
    // the page says which models Wobo itself runs on.
    const banned = /\b(openai|anthropic|litellm|llm|large language model|gpt-?\d)\b/i;
    for (const line of pageStrings()) expect(line).not.toMatch(banned);
  });

  it('sends every nav and footer address to a route that exists', () => {
    const routes = new Set([
      '/how-it-works',
      '/subjects',
      '/for-parents',
      '/for-students',
      '/plans',
      '/sign-in',
      '/meet-wobo',
      '/gift',
      '/contact',
      '/help',
      '/about',
      '/security',
      '/legal/terms-of-service',
      '/legal/privacy-policy',
      '/legal/childrens-privacy',
      '/legal/accessibility-statement',
    ]);
    for (const link of NAV_LINKS) expect(routes.has(link.href)).toBe(true);
    for (const column of FOOTER.columns) {
      for (const link of column.links) expect(routes.has(link.href)).toBe(true);
    }
    for (const item of SAFE.items) expect(routes.has(item.href)).toBe(true);
  });

  it('hands the reader’s own assistant the prototype’s exact deep links', () => {
    const links = assistants();
    expect(links.map((a) => a.name)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok']);
    const q = encodeURIComponent(ASK_ELSEWHERE);
    expect(links[0]?.href).toBe(`https://chatgpt.com/?q=${q}&hints=search`);
    expect(links[1]?.href).toBe(`https://claude.ai/new?q=${q}`);
    expect(links[2]?.href).toBe(`https://gemini.google.com/app?q=${q}`);
    expect(links[3]?.href).toBe(`https://www.perplexity.ai/search?q=${q}`);
    expect(links[4]?.href).toBe(`https://grok.com/?q=${q}`);
    // Every one of them carries the question, so the assistant arrives with something to do.
    for (const link of links) expect(link.href).toContain(q);
  });

  /**
   * THE ASSERTION THIS FILE WAS MISSING, and the reason two whole chapters shipped absent.
   *
   * Everything above proves app-copy ⊆ prototype: nothing on the page is invented. Nothing proved
   * the other direction, so a section could be dropped from `Landing.tsx` and every test stayed
   * green — which is exactly what happened to `#teaches` and `#climb`. This walks the prototype's
   * own section ids and demands a component for each, and it reads `Landing.tsx` rather than a
   * list kept beside it, because a list beside it drifts the same way the page did.
   */
  it('renders every chapter the prototype has, in the prototype’s order', () => {
    const wanted = [...PROTOTYPE.matchAll(/<section id="([a-z-]+)"/g)].map((m) => m[1] as string);
    expect(wanted.length).toBeGreaterThan(10);

    const assembly = readFileSync(join(import.meta.dir, 'Landing.tsx'), 'utf8');
    const rendered = [...assembly.matchAll(/^\s+<([A-Z][A-Za-z]*)\b/gm)].map((m) =>
      (m[1] as string).toLowerCase(),
    );
    // A component may be named for its section or for what it draws; the section file is what
    // carries the id, so the id is looked for there.
    const missing = wanted.filter((id) => {
      const source = SECTION_SOURCES.get(id);
      return !source || !rendered.includes(source);
    });
    expect(missing).toEqual([]);

    // And in the prototype's order, because these chapters are an argument, not a set.
    const order = wanted.flatMap((id) => {
      const source = SECTION_SOURCES.get(id);
      const at = source ? rendered.indexOf(source) : -1;
      return at >= 0 ? [at] : [];
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('keeps the four answer forms and the four cards in step', () => {
    expect(FORMS.nav).toHaveLength(4);
    expect(FORMS.labels).toHaveLength(4);
    expect(FAQ.items).toHaveLength(5);
    expect(SAFE.items).toHaveLength(6);
    expect(SUBJECTS.families).toHaveLength(5);
  });
});
