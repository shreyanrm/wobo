/**
 * The donate page renders reviewed copy, and it renders it under the rules that copy sets.
 *
 * Three things are asserted here and each of them has a reason to exist:
 *
 *  · the SOURCE reads the way the page assumes it reads — the four policy lines, the three steps,
 *    the two button lines, the sections. A copy edit that changes the shape of the file must break
 *    a test here rather than silently empty a section of the page.
 *  · the RULES of the copy source hold over the page's own words: no counter, no progress bar, no
 *    child, no pity, no urgency, and the whole of law v5's copy law (DESIGN.md §0), which the rest
 *    of the site is held to by `site/law-v5.test.ts` over its own lanes.
 *  · the TWINS cannot diverge. The page's argument is that a funded place and a bought place are
 *    the same product, so the panel is one component that takes no arguments and its markup appears
 *    once. Both of those are checked against the source of the page, because a second copy of the
 *    markup is exactly the mistake that would make the argument a lie.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { giftSections, isButtonLine, sectionText } from '../gift/content';
import { parseBlocks } from '../legal/markdown';
import { formatMoney, PLAN_TIERS, tierById, yearlyTotalLabel } from '../plans/prices';
import {
  emphasise,
  PLACE_TIER,
  placePrice,
  policyLines,
  proseText,
  sentences,
  splitLead,
  unfoldLists,
} from './content';
import { DONATE_PAGE, PLACES } from './copy';
import { DONATE_CSS } from './styles';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const SOURCE = readFileSync(join(REPO, 'docs', 'copy', 'growth', 'donate-page.md'), 'utf8');
const BLOCKS = parseBlocks(unfoldLists(SOURCE));
const SECTIONS = giftSections(BLOCKS);
const PAGE = readFileSync(join(import.meta.dir, 'Donate.tsx'), 'utf8');
const COPY = readFileSync(join(import.meta.dir, 'copy.ts'), 'utf8');

/** A file's shipped words: block comments and whole-line `//` notes taken out. */
function shipped(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/** Everything the page and its copy module actually put on screen. */
const WORDS = `${shipped(PAGE)}\n${shipped(COPY)}`;

describe('unfoldLists', () => {
  it('joins a wrapped list item back into one item', () => {
    expect(unfoldLists('1. **A.** first half\n   second half\n')).toBe(
      '1. **A.** first half second half\n',
    );
  });

  it('leaves a paragraph, a heading and a table alone', () => {
    const src = '# Title\n\nA paragraph.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    expect(unfoldLists(src)).toBe(src);
  });
});

describe('the four policy lines', () => {
  const lines = policyLines(BLOCKS);

  it('reads all four, in the copy’s own order', () => {
    expect(lines.map((l) => l.lead)).toEqual([
      'Who gets a funded place.',
      'What a donation buys.',
      'Whether the donor learns who received it.',
      'Whether the family learns who paid.',
    ]);
  });

  it('states each one as the copy states it, without the marker addressed to the owner', () => {
    expect(lines.map((l) => l.text)).toEqual([
      'A family asks, and places open in the order they were asked for. No means test, no documents, no proof of income.',
      'Plans at the same price a parent pays. A donation is not a discount surface, exactly as a gift is not.',
      'No. The donor funds a place, not a child.',
      'No. Nobody is asked to be grateful in public.',
    ]);
    for (const line of lines) expect(line.text).not.toMatch(/proposed/i);
  });

  it('cannot grow a fifth line that the copy does not carry', () => {
    expect(lines).toHaveLength(4);
    expect(SOURCE.match(/^\d+\. \*\*/gm)).toHaveLength(4);
  });
});

describe('the page proper', () => {
  it('reads the sections the page draws', () => {
    expect(Object.keys(SECTIONS)).toEqual([
      'Heading',
      'Sub',
      'How it works',
      'What a place is',
      'What it is not',
      'If this is you',
      'The honest footnote',
    ]);
  });

  it('keeps the heading and the sub word for word', () => {
    expect(sectionText(SECTIONS.Heading)).toBe('Buy a place for a child who cannot.');
    expect(sectionText(SECTIONS.Sub)).toStartWith('It is the whole of Wobo.');
  });

  it('carries three steps and the two button lines the copy draws', () => {
    const steps = (SECTIONS['How it works'] ?? []).find((b) => b.kind === 'list');
    expect(steps?.kind === 'list' && steps.items).toHaveLength(3);
    expect((SECTIONS['How it works'] ?? []).map(isButtonLine).find(Boolean)).toBe('Fund a place');
    expect((SECTIONS['If this is you'] ?? []).map(isButtonLine).find(Boolean)).toBe(
      'Ask for a place',
    );
  });

  it('splits a step into the sentence that names it and the line under it', () => {
    expect(splitLead('A family asks. One line to us is enough.')).toEqual({
      lead: 'A family asks.',
      rest: 'One line to us is enough.',
    });
    // a step that is one sentence keeps all of it and invents no second line
    expect(splitLead('You fund a place, for the same length.')).toEqual({
      lead: 'You fund a place, for the same length.',
      rest: '',
    });
  });

  it('draws the denials as the copy’s own sentences, none added and none dropped', () => {
    const nots = sentences(sectionText(SECTIONS['What it is not']));
    expect(nots).toHaveLength(4);
    expect(nots[0]).toBe('Not a trial that runs out mid-chapter.');
    expect(nots.join(' ')).toBe(sectionText(SECTIONS['What it is not']));
  });

  it('keeps the copy’s own button label out of the prose beside it', () => {
    // the family's invitation read "One line is enough. Ask for a place" until proseText existed
    const invitation = proseText(SECTIONS['If this is you']);
    expect(invitation).toBe(
      'If money is the only thing standing between your child and this, write to us. One line is enough.',
    );
    expect(invitation).not.toContain('Ask for a place');
  });

  it('sets the pigment on a phrase the heading actually contains', () => {
    const [before, mark, after] = emphasise(sectionText(SECTIONS.Heading), DONATE_PAGE.headingEm);
    expect(mark).toBe(DONATE_PAGE.headingEm);
    expect(before + mark + after).toBe(sectionText(SECTIONS.Heading));
  });
});

describe('what a place costs', () => {
  it('is the plan price and nothing else — a donation is never a discount surface', () => {
    const pro = PLAN_TIERS.find((t) => t.id === PLACE_TIER);
    expect(pro?.price).toBeTruthy();
    const month = PLACES.find((p) => p.id === 'month');
    expect(month && placePrice(month, 'IN')).toBe('₹1,999');
    expect(month && placePrice(month, 'INTL')).toBe('$20');
  });

  it('prices a term as three months of the same plan', () => {
    const term = PLACES.find((p) => p.id === 'term');
    expect(term && placePrice(term, 'IN')).toBe('₹5,997');
    expect(term && placePrice(term, 'INTL')).toBe('$60');
  });

  it('prices the year by the YEAR, never as twelve monthly payments', () => {
    // The page's whole claim is "the price a parent pays, nothing added". A year charged as twelve
    // monthlies is MORE than a parent pays for a year, so that sentence would be false. This test
    // was originally the guard on a year that had no price at all, and it fired the day one landed,
    // which is what it was for. The rule it guards now is the arithmetic.
    const year = PLACES.find((p) => p.id === 'year');
    const pro = tierById('pro');
    expect(year && pro).toBeTruthy();
    if (!year || !pro) return;

    for (const market of ['IN', 'INTL'] as const) {
      const shown = placePrice(year, market);
      expect(shown).toBe(yearlyTotalLabel(pro, market));
      expect(shown).toBeTruthy();

      // and it is genuinely cheaper than twelve of the monthly price
      const monthly = pro.price?.[market];
      expect(monthly).toBeTruthy();
      if (!monthly) continue;
      const twelve = formatMoney({ currency: monthly.currency, amount: monthly.amount * 12 });
      expect(shown).not.toBe(twelve);
      const digits = (v: string) => Number(v.replace(/[^0-9.]/g, ''));
      expect(digits(String(shown)) < digits(twelve)).toBe(true);
    }
  });

  it('gives every length a price and a door, now that all three have one', () => {
    for (const place of PLACES) {
      expect([place.id, place.cta]).not.toEqual([place.id, null]);
      expect([place.id, placePrice(place, 'IN')]).not.toEqual([place.id, null]);
    }
  });
});

describe('the twins cannot diverge', () => {
  it('draws the panel from one component that takes no arguments', () => {
    expect(PAGE).toContain('function PlacePanel() {');
    expect(PAGE.match(/function PlacePanel/g)).toHaveLength(1);
    expect(PAGE.match(/<PlacePanel \/>/g)).toHaveLength(1);
  });

  it('holds the panel’s markup in exactly one place', () => {
    for (const mark of ['dn-mini', 'dn-board', 'dn-chips', 'dn-foot', 'dn-ring']) {
      expect([mark, PAGE.match(new RegExp(`className="${mark}"`, 'g'))?.length]).toEqual([mark, 1]);
    }
  });

  it('gives a twin the caption and nothing else', () => {
    const twin = /function Twin\(\{([^}]*)\}: \{([^}]*)\}\)/.exec(PAGE);
    expect(twin?.[1]?.trim()).toBe('caption');
    expect(twin?.[2]?.trim().replace(/;$/, '')).toBe('caption: string');
    expect(PAGE.match(/<Twin caption=/g)).toHaveLength(2);
  });
});

describe('the rules of the copy source, over the page’s own words', () => {
  it('counts nothing — no places funded, no progress toward a target', () => {
    expect(WORDS).not.toMatch(/places funded|progress|so far this|goal of|target of/i);
    expect(DONATE_CSS).not.toMatch(/\bcounter|progress/i);
  });

  it('puts no child on the page — no photograph, no story, no first name', () => {
    expect(WORDS).not.toMatch(/<img|photograph|\bphoto\b/i);
    expect(WORDS).not.toMatch(
      /\b(aanya|arjun|riya|meera|priya|ananya|rohan|kavya|ishaan|sanya)\b/i,
    );
    expect(WORDS).not.toMatch(/a (?:girl|boy) in\b/i);
  });

  it('uses no pity and no urgency', () => {
    expect(WORDS).not.toMatch(/only today|right now|hurry|before it is too late|countdown/i);
    expect(WORDS).not.toMatch(/\bdeserv|\bpoor\b|\bneedy\b|less fortunate/i);
  });

  it('says nothing renews, and promises no money back', () => {
    expect(WORDS).not.toMatch(/\brefund(?:ed|s)?\b(?!\W*and\W*cancellation)/i);
    expect(sectionText(SECTIONS['The honest footnote'])).toContain('Nothing renews');
  });
});

describe('law v5’s copy law, over the donate page (DESIGN.md §0)', () => {
  it('names no learner and no parent', () => {
    expect(WORDS).not.toMatch(/\bmy (?:son|daughter)\b/i);
  });

  it('gates nobody by class, grade or age', () => {
    expect(WORDS).not.toMatch(/\bclass(?:es)? \d/i);
    expect(WORDS).not.toMatch(/\bgrades? \d/i);
    expect(WORDS).not.toMatch(/\bages? \d/i);
  });

  it('states no raw allowance', () => {
    expect(WORDS).not.toMatch(/\b\d+ (?:questions|turns) a day\b/i);
  });

  it('never asks a reader which country they are in', () => {
    expect(WORDS).not.toMatch(/setMarket|Show prices for|Everywhere else/i);
    expect(PAGE).toContain('readMarket()');
  });

  it('writes no em dash and never says tonight', () => {
    expect(WORDS).not.toContain('—');
    expect(WORDS).not.toMatch(/\btonight\b/i);
  });

  it('sends everything to the one mailbox', () => {
    const boxes = [...WORDS.matchAll(/[\w.]+@[\w.]+/g)].map((m) => m[0]);
    expect(new Set(boxes.filter((b) => b.endsWith('heywobo.com')))).toEqual(new Set());
    expect(PAGE).toContain('MAILBOXES[0]');
  });

  it('deals with no school', () => {
    expect(WORDS).not.toMatch(/\bschool(s)?\b/i);
  });
});

describe('law v5’s paper, over the donate sheet', () => {
  const rules = [
    ...DONATE_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}\n]+)\{([^{}]*)\}/g),
  ];

  it('paints a wash on nothing at all — no card, no tile, no panel, no section', () => {
    const washed = rules
      .filter((m) =>
        /(?:background|fill):var\(--(?:pig|mint|marigold|rose|lilac|violet)-w\)/.test(
          m[2] as string,
        ),
      )
      .map((m) => (m[1] as string).trim());
    expect(washed).toEqual([]);
  });

  it('sits every card and panel on paper-2, and points at one card with pig instead', () => {
    expect(DONATE_CSS).toContain('.dn-place{min-width:0;background:var(--paper-2)');
    expect(DONATE_CSS).toContain(
      '.dn-place.dn-lead{background:var(--paper-2);box-shadow:inset 0 0 0 3px var(--pig)}',
    );
    expect(DONATE_CSS).toContain('.dn-ask{background:var(--paper-2)');
    expect(DONATE_CSS).toContain('.dn-rules > li{min-width:0;background:var(--paper-2)');
    // the twin panel too: a --paper card on a --paper ground has no edge at night
    expect(DONATE_CSS).toContain('.dn-mini{background:var(--paper-2)');
  });

  it('draws no border line, and uses the hairline only between list rows', () => {
    for (const [, selector, body] of rules) {
      if (/border:\s*0/.test(body as string)) continue;
      expect([selector, /(^|[^-])border(-(top|right|bottom|left))?:/.test(body as string)]).toEqual(
        [selector, false],
      );
    }
    const lines = rules.filter((m) => /var\(--line\)/.test(m[2] as string));
    expect(lines.map((m) => (m[1] as string).trim())).toEqual(['.dn-nots > li + li']);
  });

  it('gives every grid child a min-width of zero, so nothing can force the page wide', () => {
    for (const child of [
      '.dn-twin',
      '.dn-steps > li',
      '.dn-rules > li',
      '.dn-place',
      '.dn-ask-say',
      '.dn-eg',
    ]) {
      expect([child, DONATE_CSS.includes(`${child}{`)]).toEqual([child, true]);
      const rule = new RegExp(`\\${child.replace(/ /g, '\\s')}\\{([^}]*)\\}`).exec(DONATE_CSS);
      expect([child, /min-width:0/.test(rule?.[1] ?? '')]).toEqual([child, true]);
    }
  });

  it('animates nothing, so none of the three causes of jitter is reachable', () => {
    expect(DONATE_CSS).not.toMatch(/transition:|animation:|@keyframes/);
  });

  it('collapses every grid at the phone width', () => {
    const phone = /@media \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(DONATE_CSS)?.[1] ?? '';
    for (const grid of ['.dn-twins', '.dn-steps', '.dn-rules', '.dn-places', '.dn-ask']) {
      expect([grid, phone.includes(`${grid}{`)]).toEqual([grid, true]);
    }
  });
});
