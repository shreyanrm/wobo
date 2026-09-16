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
import { FOOTER_COLUMNS, hrefRoute } from '../site/nav';
import {
  ASK,
  ASK_ELSEWHERE,
  AUTH,
  assistants,
  CLIMB,
  CLOSE,
  FOOTER,
  FORMS,
  HERO,
  HERO_FORMS,
  NAV_LINKS,
  PARENTS,
  PRACTICE,
  PRICE,
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
  // The prototype closes on an email field for a waitlist. We are open (DESIGN.md §0, owner,
  // 2026-09-04), so there is no field and no address to keep: the close is two doors into the
  // product, and its words are the `home` entry in `site/handoffs.ts`.
  CLOSE.title,
  CLOSE.sub,
  CLOSE.primary,
  CLOSE.quiet,
  CLOSE.fine,
  // A control needs a name a screen reader can read out; the prototype's four squares had one each
  // and the rest were pictures.
  ...PRACTICE.cells,
  PRACTICE.notHalf,
  // The footer is the site's one list (`site/nav.ts`), which carries two pages the landing
  // prototype's footer predates: the donate page and the cookies document (wave 29, site-10).
  'Donate Wobo',
  'Cookies',
  // And the blog, which the prototype's footer also predates. It is in the site's one footer list
  // because it is the origin every syndicated post points back at, so it has to be reachable from
  // every page rather than only from whatever linked to a post (docs/GROWTH-DESK.md §3).
  'Blog',
  // And the press kit, in the footer of every page rather than in the pill nav, because a
  // journalist and an answer engine both arrive by looking for it rather than by browsing
  // (docs/GROWTH-PRESS.md §2; docs/copy/press-kit.md, "The page, and what it actually carries").
  'Press',
  /*
    THREE SAFE CARDS THE PROTOTYPE PROMISES AND THE CODE DOES NOT KEEP. Verified against this
    repository on 2026-09-04; the reason is written beside each line in `page-copy.ts`.

      · "sits encrypted at rest" — nothing here evidences the cipher or the key management, and
        `docs/legal/privacy-policy.md` §10, live on this same site, explicitly declines to make
        that claim. One page may not assert what its sibling refuses to.
      · "Memory, progress, account" in one tap — POST /v1/me/erase clears six things and no code
        anywhere calls the auth admin API, so no button deletes an account.
      · "The consent a family gives is the one their own law requires" — no consent is taken from
        any family in any market; `consent_tier` is read everywhere and written nowhere.

    The drawing is corrected the day somebody redraws it. Until then the page carries the true
    version, and this list carries the reason rather than the exemption.
  */
  'Locked at the row',
  'Everything travels over TLS, and the database carries its own per-learner access rules underneath the app, so a row is scoped to the learner it belongs to rather than to whoever asks for it.',
  'Erase the learning, in one tap',
  'Memory, saved boards and threads, and the parent link. Gone from live systems at once, and out of the backups behind them as those roll over. Deleting the account itself is done by a person when you ask.',
  'The laws we are building to',
  "India's Digital Personal Data Protection Act, COPPA for children in the United States, and the GDPR's rules for children in Europe and the United Kingdom. There is no consent gate in Wobo yet, and we say so on the security page rather than implying one here.",
  /*
    THE ADAPTIVE LINE (owner, 2026-09-09; docs/copy/growth/lines.md, "Not a fixed course. It adapts
    to you and does not stop until the topic is mastered"). The prototype predates the entry, and
    the entry places three of its four forms on this page: the eyebrow on the second chapter, the
    section line on the teaching chapter, and its proof beside the re-teach ladder. The fourth is
    the for-parents page's first promise, held in `site/sell.test.ts`. Written here as literals so
    that a word changed in `page-copy.ts` fails against the law rather than against itself.
  */
  'Not a fixed course. A tutor.',
  'No two learners get the same lesson. It changes to your pace and your way of thinking, and it does not stop until the topic is yours.',
  'When one explanation does not land, it tries another. And another. It stays until it lands.',
  /*
    "MASTERED" NEVER REACHES A LEARNER (the same entry: "Never the word 'mastered' on a
    learner-facing surface"). The prototype marks a finished topic "mastered" in three drawings;
    the page says it in our words instead: "yours" in Wobo's hand over the settled curve, "held"
    on the path's list, where the gate line under it already says "held", and the report's badge
    says what the chapter did rather than grading it.
  */
  'yours',
  'held',
  'A chapter that stayed learnt',
];

/**
 * THE ARGUMENT, as an ordered list of section ids (docs/SELL.md §3).
 *
 * This is the whole point of the homepage rework and the one thing most likely to rot, so it is
 * written down once, here, and three separate assertions below read it: the prototype must have
 * these sections in this order, `Landing.tsx` must render them in this order, and each rung must
 * answer the doubt named beside it.
 *
 * The order is the objection ladder, not the order the features were built. What it replaced ran
 * hero, loop, forms, teaches, students, practice, climb, parents, subjects, safe, ask, faq,
 * devices — which answered the doubts a stranger actually has in the order 1, 3, 3, 3, 4, 4, 5, 2,
 * 6, and put the two strongest things on the page ninth and eleventh.
 *
 *   hero      1 "what even is this"          one question answered four ways, and the TRY, on the
 *                                              first screen, because the try is proof, demo and
 *                                              activation in one move (docs/SELL.md §4)
 *   subjects  2 "will it work for MY board"  the qualifier, answered second rather than ninth
 *   teaches   3 "is this just a chatbot"     the two modes, then everything a great teacher does
 *   forms     3                               the four answer forms, shown
 *   students  3                               the film you can stop and question
 *   practice  3                               a problem handed back to you
 *   climb     4 "will my child use it"       checkpoints, a chest, and a vibe that is not childish
 *   parents   4                               and will I see that it is working
 *   price     5 "what does it cost"          on this page, not behind a link, with doubt 7
 *                                              (what if it does not work out) in the same breath
 *   safe      6 "is my child safe here"      six decisions, each one checkable
 *
 * Doubt 8 ("so what do I do now") is the close, which is not a `<section id>` because it is the
 * same handoff panel every public page ends on (`site/handoffs.ts`).
 */
/**
 * docs/SELL.md §3's doubts, in the order they arrive. `price` is rung 5 and follows `climb`
 * (rung 4) directly: it sat one place lower, under the parent's report, and measured at 390px that
 * put the price at y=14,467 on a 19,455px page — screen 17 of 23, sixteen screens of scrolling
 * before a worried parent is told it is free. The report is proof for the payer rather than a rung
 * of its own, and it reads better between the price and the safety chapter.
 */
const LADDER: readonly string[] = [
  'hero',
  'subjects',
  'teaches',
  'forms',
  'students',
  'practice',
  'climb',
  'price',
  'parents',
  'safe',
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
    FORMS,
    TEACHES,
    STUDENTS,
    PRACTICE,
    CLIMB,
    PARENTS,
    SUBJECTS,
    SAFE,
    ASK,
    PRICE,
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
    // What it says instead (voice.md §8.2). The subjects eyebrow carried the phrase until the
    // adaptive line took that slot (lines.md, 2026-09-09); the title and the close still say it.
    expect(SUBJECTS.title.lead + SUBJECTS.title.mark).toBe(
      'Whatever your school sets, Wobo teaches it.',
    );
    expect(
      pageStrings().some((line) => /every subject (your board sets|· every board)/i.test(line)),
    ).toBe(true);
  });

  /**
   * THE ADAPTIVE LINE (owner, 2026-09-09: *"not a fixed course or content, adapts and changes to
   * your learning style and pace, and it doesn't stop until the topic is mastered"*).
   * docs/copy/growth/lines.md sets four forms and where each goes. Three are on this page:
   *
   *   1. the eyebrow, on the landing's second chapter, `subjects` (rung 2 of the ladder above)
   *   2. the section line, on the teaching chapter, which is the chapter that argues Wobo is a
   *      tutor rather than a course; its own eyebrow is the owner's world's-first claim
   *      (2026-09-05, docs/CLAIMS.md §1), so the eyebrow form does not displace it
   *   3. the proof, beside the re-teach ladder drawn as three routes into one idea (beat 02), and
   *      on no other beat
   *
   * "Yours" is the word for mastered: none of the three says a school-report word, and none uses
   * an em dash (voice.md §10a). The fourth form is the for-parents page's first promise, held in
   * `site/sell.test.ts`, which also holds that this line never joins the fun line on one section.
   */
  it('never says "mastered" to a learner, anywhere on the page (lines.md, 2026-09-09)', () => {
    // docs/copy/growth/lines.md: "Never the word 'mastered' on a learner-facing surface". The
    // landing speaks to the learner (docs/SELL.md §1), so the drawings say it in our words instead:
    // "yours" where Wobo's own hand marks a topic finished, "held" where the path lists one.
    expect(pageStrings().filter((line) => /\bmastered\b/i.test(line))).toEqual([]);
    const drawn = readFileSync(join(import.meta.dir, 'art.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(drawn).not.toMatch(/\bmastered\b/i);
    expect(TEACHES.mastery.done).toBe('yours');
    expect(CLIMB.rows.filter((row) => row.state === 'held').length).toBe(2);
  });

  it('carries the adaptive line where lines.md places it (owner, 2026-09-09)', () => {
    expect(SUBJECTS.eyebrow).toBe('Not a fixed course. A tutor.');
    expect(TEACHES.adapts).toBe(
      'No two learners get the same lesson. It changes to your pace and your way of thinking, and it does not stop until the topic is yours.',
    );
    const ladder = TEACHES.beats.filter((beat) => beat.proof);
    expect(ladder.map((beat) => beat.title)).toEqual([
      'If one way does not land, it tries a different one.',
    ]);
    expect(ladder[0]?.proof).toBe(
      'When one explanation does not land, it tries another. And another. It stays until it lands.',
    );
    for (const line of [SUBJECTS.eyebrow, TEACHES.adapts, ladder[0]?.proof ?? '']) {
      expect(line).not.toMatch(/mastered/i);
      expect(line).not.toContain('\u2014');
    }
    // Rendered: the section line under the title, and the proof inside the drawing's own column.
    const teaches = readFileSync(join(import.meta.dir, 'sections', 'Teaches.tsx'), 'utf8');
    expect(teaches).toContain('<p className="lede reveal">{TEACHES.adapts}</p>');
    expect(teaches).toMatch(/<BeatArt index=\{i\} \/>\s*\{beat\.proof/);
  });

  it('prints no raw allowance (law v5: never "40 questions a day")', () => {
    const banned = /\d+\s*(questions?|lessons?|minutes?)\s*(a|per)\s*day/i;
    for (const line of pageStrings()) expect(line).not.toMatch(banned);
    // What it says instead: an allowance that resets, with no number attached to it.
    // What it says instead: an allowance that refills, with no number attached to it. It said
    // "resets each morning", and `budget.py`'s reset_at() is the next UTC midnight — a morning only
    // inside one time-zone band, while `plans/prices.ts` serves several markets off the browser's
    // own locale.
    expect(ASK.answers['What does free include?']).toContain('refills once a day');
  });

  /**
   * We are open (DESIGN.md §0, owner, 2026-09-04, superseding "promote before you invite"). The
   * loud door is read from `site/cta.ts` and says the same two words the rest of the site says,
   * and nothing on the page asks a reader to wait for a product that is already running.
   */
  it('invites rather than promotes (law v5: we are open)', () => {
    expect(AUTH.start).toBe('Start free');
    expect(CLOSE.primary).toBe('Start free');
    for (const line of pageStrings()) {
      expect(line).not.toMatch(/begin tonight|tonight|early access|wait ?list/i);
    }
  });

  /**
   * DRAWING IS ONE PART (DESIGN.md §0). The section that carries this used to be LOOP, five steps
   * with drawing at number three; it is TEACHES now, six things a great teacher does, and the
   * board is still only one of them. What is asserted is the claim, not the section's old name.
   */
  it('never lets the board be the whole product (law v5: drawing is one part)', () => {
    expect(TEACHES.lede).toContain('Six things, and Wobo does all six');
    expect(TEACHES.lede).toMatch(/Drawing it while explaining/);
    // the four answer forms, so the drawn one is a quarter of the hero rather than all of it
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

  /**
   * Walked through the ROUTER, not a list typed here: the list used to name sixteen addresses and
   * pass, while the footer it was guarding had drifted from the site's (wave 29, site-10). An
   * anchor on another page (`/for-parents#questions`) is a route plus an id, and the id is proved
   * on the page's own source in `site/nav.test.ts`.
   */
  it('sends every nav and footer address to a route that exists', () => {
    for (const link of NAV_LINKS)
      expect([link.href, hrefRoute(link.href)]).not.toEqual([link.href, null]);
    for (const column of FOOTER.columns) {
      for (const link of column.links) {
        expect([link.href, hrefRoute(link.href)]).not.toEqual([link.href, null]);
      }
    }
    for (const item of SAFE.items)
      expect([item.href, hrefRoute(item.href)]).not.toEqual([item.href, null]);
  });

  /**
   * ONE FOOTER, READ BY BOTH PAGES. The landing's footer and the site's had drifted: the front page
   * was missing Donate Wobo and Cookies, so the donate page and one of the ten legal documents had
   * no path from the front door, and "Questions" went to two different places depending on which
   * footer the reader was standing in. The landing now reads the site's list, column for column.
   */
  it('carries the same links as the site footer, column for column', () => {
    const ours = FOOTER.columns.map((c) => [c.heading, c.links.map((l) => [l.label, l.href])]);
    const site = FOOTER_COLUMNS.map((c) => [c.title, c.links.map((l) => [l.label, l.href])]);
    expect(ours).toEqual(site);
  });

  /**
   * THE PROMISE THE PAGE IS BUILT ON DOES NOT BREAK IN HALF. At 390 the eyebrow wrapped as
   * "EVERY SUBJECT · EVERY BOARD · FREE EVERY / DAY", orphaning the one word of the pigment
   * phrase on its own line (wave 29, site-9). The accent's spaces are non-breaking, so the three
   * clauses can only break at the separators. `flat` above treats them as spaces, so the copy
   * still reads as the prototype's.
   */
  it('keeps "free every day" on one line', () => {
    expect(HERO.eyebrow.accent).toBe('free\u00a0every\u00a0day');
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
    expect(wanted).toEqual([...LADDER]);

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

  /**
   * THE ARGUMENT, IN ORDER, IN THE ASSEMBLY ITSELF.
   *
   * The test above proves the page renders every chapter the prototype has, in the prototype's
   * order — but it would stay green if the prototype and the page were reordered together into
   * something that is no longer an argument. This one names the rungs, so moving `subjects` back
   * down the page or burying the hero's try fails with the rung that moved.
   *
   * It reads `Landing.tsx` rather than a list kept beside it, for the same reason as above: a list
   * beside the page drifts from the page.
   */
  it('runs the objection ladder in order, and nothing else (docs/SELL.md §3)', () => {
    const assembly = readFileSync(join(import.meta.dir, 'Landing.tsx'), 'utf8');
    const rendered = [...assembly.matchAll(/^\s+<([A-Z][A-Za-z]*)\b/gm)].map((m) =>
      (m[1] as string).toLowerCase(),
    );
    // Every rung, in the ladder's order, with nothing wedged between two of them.
    const rungs = LADDER.map((id) => SECTION_SOURCES.get(id));
    expect(rungs).toEqual([...LADDER]);
    const at = rungs.map((source) => rendered.indexOf(source as string));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));

    // The close is last, after the final rung, because doubt 8 is answered once and at the end.
    expect(rendered.indexOf('close')).toBeGreaterThan(at[at.length - 1] as number);

    // And the four sections the rework retired stay retired: each one either repeated a point made
    // one screen earlier or answered no doubt on the ladder at all.
    for (const gone of ['loop', 'ask', 'faq', 'devices']) {
      expect(rendered).not.toContain(gone);
    }
  });

  /**
   * THE TWO MODES (owner, 2026-09-04: *"for doubt clarification yes, always any time but to learn
   * its not a day before the exams right"*; docs/SELL.md §2).
   *
   * Both must be on the page, and DISTINCTLY, because they have different rhythms and running them
   * together sells the product short in one direction and misrepresents it in the other. The doubt
   * is genuinely any time. Learning is deliberately not: it is a bit at a time, across weeks, which
   * is what makes the week before a test revision. That is the anti-cramming claim, and it is a
   * trust signal to a parent rather than a caveat.
   */
  it('puts both modes on the page, and keeps them apart (owner: a doubt is not learning)', () => {
    const modes = TEACHES.modes.items;
    expect(modes.map((m) => m.key)).toEqual(['doubt', 'learning']);

    // The doubt is available, and says so without naming an hour.
    const doubt = modes[0];
    expect(doubt?.when).toMatch(/moment/i);
    expect(doubt?.body).toMatch(/after school|over the weekend|on the way home/);

    // Learning is paced, and is never sold as something to reach for at the last minute.
    const learning = modes[1];
    expect(learning?.when).toMatch(/a bit at a time/i);
    expect(learning?.body).toMatch(/revision/);

    // The two are not the same sentence with different nouns.
    expect(doubt?.when).not.toBe(learning?.when);

    // Nothing in either one pictures a late hour (DESIGN.md §0, corrected twice), and nothing
    // markets Wobo as a cramming tool.
    const spoken: string[] = [
      TEACHES.modes.note,
      TEACHES.modes.hand.lead,
      TEACHES.modes.hand.em,
      ...modes.flatMap((m) => [m.kicker, m.when, m.body]),
    ];
    for (const line of spoken) {
      expect(line).not.toMatch(/\b(tonight|midnight|late at night|\d\s?pm)\b/i);
      expect(line).not.toMatch(/\bthe night before\b/i);
      expect(line).not.toMatch(/\bcram/i);
    }
  });

  it('keeps the four answer forms and the four cards in step', () => {
    expect(FORMS.nav).toHaveLength(4);
    expect(FORMS.labels).toHaveLength(4);
    // the standalone FAQ block is gone; the questions a reader still has are the ask block's chips,
    // and every chip has an answer written for it rather than a link to somewhere else
    expect(ASK.chips).toHaveLength(4);
    expect(Object.keys(ASK.answers)).toEqual([...ASK.chips]);
    expect(SAFE.items).toHaveLength(6);
    expect(SUBJECTS.families).toHaveLength(5);
  });
});
