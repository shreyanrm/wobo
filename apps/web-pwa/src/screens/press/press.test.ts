/**
 * THE PRESS PAGE IS HELD TO THE LAW, WORD FOR WORD.
 *
 * `docs/copy/press-kit.md` says every string is used "verbatim and identically on every surface",
 * and that is not a style note: three products share the name Wobo, the other two have app store
 * listings and reviews, and an answer engine decides what a name refers to by what independent
 * sources AGREE on (docs/GROWTH-ENTITY.md). Sameness is the only lever we have. A writer who
 * improves one of these sentences for one surface has spent it.
 *
 * So this file reads the markdown off disk and compares it to what the page renders, rather than
 * asserting a copy of the copy. Edit the law and this fails until the page agrees; edit the page
 * and it fails until the law does. There is no third way to change a word.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_DESCRIPTION } from '../../shell/head';
import { FOUNDER_NAME, organizationLd } from '../../shell/jsonld';
import { PROFILES, sameAs } from '../../shell/profiles';
import { isPublicSite } from '../../shell/public-routes';
import { PLAIN_ROUTES, pathToRoute } from '../../shell/router';
import { MAILBOXES } from '../site/identity';
import { FOOTER_COLUMNS } from '../site/nav';
import { PUBLIC_ROUTES } from '../states/routes';
import { boards } from '../syllabus/tree';
import {
  FACTS,
  FILM_NOTE,
  FOUNDER,
  HUNDRED_WORDS,
  LOGOS,
  ONE_LINE,
  PRESS_HEAD,
  PRESS_MAILBOX,
  SCREENSHOTS,
  THREE_HUNDRED_WORDS,
} from './copy';
import { PRESS_CSS } from './styles';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const KIT = readFileSync(join(REPO, 'docs', 'copy', 'press-kit.md'), 'utf8');
const PAGE = readFileSync(join(import.meta.dir, 'Press.tsx'), 'utf8');

/**
 * The markdown writes a straight apostrophe and the page sets a typographic one, which is a
 * TYPESETTING difference and not a wording one. Everything else has to match exactly, so this
 * normalises the two marks and the blockquote's own wrapping, and nothing else.
 */
function plain(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

/** One `> quoted` block of the kit, under the heading that names it, as one line of prose. */
function quoted(heading: string): string[] {
  const start = KIT.indexOf(`## ${heading}`);
  expect([heading, start]).not.toEqual([heading, -1]);
  const rest = KIT.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);
  // A blank quoted line separates one paragraph from the next.
  return section
    .split('\n')
    .filter((line) => line.startsWith('>'))
    .join('\n')
    .split(/\n>\s*\n/)
    .map((block) =>
      plain(
        block
          .split('\n')
          .map((line) => line.replace(/^>\s?/, ''))
          .join(' '),
      ),
    )
    .filter(Boolean);
}

describe('every description is the law’s, word for word', () => {
  it('prints the one line the meta description and every listing carry', () => {
    expect(
      quoted(
        'The one line (use everywhere: listings, app stores, social bios, the meta description)',
      ),
    ).toEqual([plain(ONE_LINE)]);
    // And it is the SAME string, not a second copy of it: one edit changes every surface.
    expect(ONE_LINE).toBe(BRAND_DESCRIPTION);
  });

  it('prints the hundred words as one paragraph', () => {
    expect(quoted('The hundred words (Crunchbase, Product Hunt, LinkedIn, press kit)')).toEqual([
      plain(HUNDRED_WORDS),
    ]);
  });

  it('prints the three hundred words as the paragraphs the law sets them in', () => {
    expect(quoted("The three hundred words (the press page, the pitch email's body)")).toEqual(
      THREE_HUNDRED_WORDS.map(plain),
    );
  });

  it('names the founder the law names, and nobody else', () => {
    expect(quoted('The founder')[0]).toContain(FOUNDER.name);
    // and the page, the markup and the kit are one spelling, read from one constant
    expect(FOUNDER.name).toBe(FOUNDER_NAME);
    expect(organizationLd('https://heywobo.com').founder).toEqual({
      '@type': 'Person',
      name: FOUNDER.name,
    });
  });

  it('prints the facts box row for row, in the law’s order', () => {
    const rows = [...KIT.matchAll(/^\| ([A-Z][^|]*?) \| (.+?) \|$/gm)].map(([, label, value]) => ({
      label: (label as string).trim(),
      value: (value as string).trim(),
    }));
    expect(rows.map((r) => r.label)).toEqual(FACTS.map((f) => f.label));
    for (const [i, fact] of FACTS.entries()) {
      expect([fact.label, plain(fact.value)]).toEqual([fact.label, plain(rows[i]?.value ?? '')]);
    }
  });
});

describe('the contact is the one address the legal set publishes', () => {
  it('reads the mailbox back rather than typing a second one', () => {
    expect(PRESS_MAILBOX).toBe(MAILBOXES[0]?.address as string);
    expect(KIT).toContain(PRESS_MAILBOX);
    // No press@ box invented for the occasion: an address nobody reads is worse than none.
    expect(PAGE).not.toMatch(/press@/);
  });
});

describe('the page obeys the copy law on every line it renders', () => {
  /** Everything a person reads on the page: the strings, plus the sentences written into it. */
  const words = [
    PRESS_HEAD.heading,
    PRESS_HEAD.sub,
    ONE_LINE,
    HUNDRED_WORDS,
    ...THREE_HUNDRED_WORDS,
    ...FACTS.map((f) => `${f.label} ${f.value}`),
    ...LOGOS.map((l) => `${l.title} ${l.note}`),
    ...SCREENSHOTS.map((s) => `${s.title} ${s.note}`),
    FILM_NOTE,
  ].join('\n');

  it('writes no em dash anywhere a person reads (voice.md §10a)', () => {
    expect(words).not.toContain('—');
    // and none in the sentences typed into the page itself, which the strings above do not cover
    const jsx = PAGE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(jsx).not.toContain('—');
  });

  it('writes no exclamation mark and no emoji (voice.md §3)', () => {
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('names no class, grade or age range (voice.md §8.2)', () => {
    expect(words).not.toMatch(/\bclass(es)? \d/i);
    expect(words).not.toMatch(/\bgrades? \d/i);
    expect(words).not.toMatch(/\b(ages?|aged) \d/i);
    expect(words).not.toMatch(/\b\d+\s*(to|–|-)\s*\d+\s*(year|yr)s? ?olds?\b/i);
  });

  it('names no raw allowance and never says unlimited (voice.md §8.3)', () => {
    expect(words).not.toMatch(/\bunlimited\b/i);
    expect(words).not.toMatch(/\b\d+\s+(questions?|turns?)\s+(a|per)\s+day\b/i);
  });

  it('names no late hour (voice.md §8.7)', () => {
    expect(words).not.toMatch(/\b(tonight|midnight|late at night|10 ?pm|11 ?pm)\b/i);
  });

  it('names no vendor, model or provider (voice.md §7)', () => {
    expect(words).not.toMatch(/\b(openai|gpt|gemini|claude|anthropic|supabase|vercel|railway)\b/i);
  });

  it('calls the brand Wobo and never HeyWobo (GROWTH-ENTITY §2)', () => {
    expect(words).not.toMatch(/HeyWobo|Hey Wobo/);
    // The address is allowed to be the address, in lower case, where an address belongs.
    expect(words).toContain('heywobo.com');
  });

  it('uses no gendered pronoun for Wobo (voice.md §1)', () => {
    expect(words).not.toMatch(/\bWobo\b[^.]{0,40}\b(he|him|his|she|her|hers)\b/i);
  });

  it('claims no exam result, mark or ranking (CLAIMS.md §2)', () => {
    expect(words).not.toMatch(/\b(guarantee|guaranteed|top rank|better marks|improve marks)\b/i);
    expect(words).not.toMatch(/\b\d+\s?% (better|improvement|more marks)\b/i);
  });

  it('runs nobody down, and names no competitor (voice.md §8.8)', () => {
    expect(words).not.toMatch(/\b(better than|cheaper than|unlike) (a )?(teacher|school|tuition)/i);
  });
});

describe('the page is a published address like every other', () => {
  it('is a plain route the router answers', () => {
    expect(PLAIN_ROUTES.has('press')).toBe(true);
    expect(pathToRoute('/press')).toEqual({ name: 'press' });
    // A deeper address under it is not ours, so it 404s rather than rendering the kit.
    expect(pathToRoute('/press/kit')).toBeNull();
  });

  it('is public, so it costs a stranger the site and nothing behind the door', () => {
    expect(isPublicSite('press')).toBe(true);
  });

  it('is in the sitemap, so a crawler is told about it', () => {
    expect(PUBLIC_ROUTES.some((r) => r.path === '/press')).toBe(true);
  });

  it('is linked from the footer of every page, which is how it is found', () => {
    const links = FOOTER_COLUMNS.flatMap((c) => c.links);
    expect(links.some((l) => l.href === '/press' && l.label === 'Press')).toBe(true);
  });
});

describe('the assets it offers are the assets the build writes', () => {
  it('offers the logo in SVG and in PNG, and the mark beside them', () => {
    const hrefs = LOGOS.map((l) => l.href);
    expect(hrefs).toContain('/press/wobo-wordmark.svg');
    expect(hrefs).toContain('/press/wobo-wordmark.png');
    expect(hrefs.every((href) => href.startsWith('/press/'))).toBe(true);
  });

  it('offers three screenshots, each naming the live page it was taken from', () => {
    expect(SCREENSHOTS).toHaveLength(3);
    for (const shot of SCREENSHOTS) {
      expect(shot.href.endsWith('.png')).toBe(true);
      expect([shot.from, pathToRoute(shot.from)]).not.toEqual([shot.from, null]);
    }
  });

  it('names the film as missing rather than linking one that is not cut', () => {
    expect(FILM_NOTE).toMatch(/sixty-second film/);
    expect(PAGE).not.toMatch(/\.mp4|\.webm/);
  });
});

describe('the entity markup this page exists to feed', () => {
  it('publishes only listings that are claimed, and never a handle nobody holds', () => {
    for (const url of sameAs()) {
      const row = PROFILES.find((p) => p.url === url);
      expect([url, row?.claimed]).toEqual([url, true]);
    }
    expect(sameAs().length).toBeLessThanOrEqual(PROFILES.length);
  });
});

describe('the stylesheet keeps the site’s laws', () => {
  it('draws no border line: surfaces separate by tone, space and shape (DESIGN.md §2)', () => {
    expect(PRESS_CSS).not.toMatch(/[^-]border:(?!0)/);
  });

  it('keeps every colour a token, with no hex outside the two ink-panel exceptions', () => {
    const hexes = [...PRESS_CSS.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0]);
    // #14142B is law v5's ink, the one literal the buttons on marigold and mint are written with,
    // exactly as `site/styles.ts` and `pitch/styles.ts` write it.
    expect(hexes.filter((hex) => hex !== '#14142B')).toEqual([]);
  });

  it('stacks to one column on a phone, so nothing scrolls sideways at 390', () => {
    expect(PRESS_CSS).toContain('@media (max-width:860px)');
    expect(PRESS_CSS).toMatch(/\.pr-files,\.pr-shots\{grid-template-columns:1fr\}/);
  });

  it('lets a table scroll inside itself rather than widening the page', () => {
    expect(PRESS_CSS).toMatch(/\.pr-facts\{[^}]*overflow-x:auto/);
  });
});

/**
 * THE LAUNCH ASSETS, AS FILES A PERSON SENDS (docs/GROWTH-PRESS.md §2).
 *
 * The Product Hunt copy, the pitch to the Indian tech press and the award submission live in
 * `docs/copy/press/`. Nothing here sends anything: the files are what a person pastes, one outlet
 * and one journalist at a time. What a reader will read is set in `>` blockquotes under a `##`
 * heading, exactly as the kit is, so the same reader holds them to the same law. Everything
 * outside a blockquote is the note to whoever sends it.
 */
describe('the launch assets carry the kit word for word, and nothing the kit forbids', () => {
  const DIR = join(REPO, 'docs', 'copy', 'press');
  const FILES = ['product-hunt.md', 'pitch-email.md', 'awards.md'] as const;
  const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

  /** Every quoted block in one file, as one line of prose each. */
  function blocks(text: string): string[] {
    return text
      .split('\n')
      .map((line) => (line.startsWith('>') ? line : ''))
      .join('\n')
      .split(/\n(?:>\s*)?\n/)
      .map((block) => plain(block.replace(/^>\s?/gm, ' ')))
      .filter(Boolean);
  }

  /** The quoted words under one heading of one file. */
  function under(text: string, heading: string): string[] {
    const start = text.indexOf(`## ${heading}`);
    expect([heading, start]).not.toEqual([heading, -1]);
    const rest = text.slice(start + heading.length + 3);
    const end = rest.indexOf('\n## ');
    return blocks(end === -1 ? rest : rest.slice(0, end));
  }

  it('is exactly the three files the plan asks for', () => {
    expect(
      readdirSync(DIR)
        .filter((f) => f.endsWith('.md'))
        .sort(),
    ).toEqual([...FILES].sort());
  });

  it('opens every file on the one line, word for word', () => {
    for (const name of FILES) {
      expect([name, blocks(read(name)).includes(plain(ONE_LINE))]).toEqual([name, true]);
    }
  });

  it('gives Product Hunt the name, a tagline that fits, the hundred words and the real screenshots', () => {
    const text = read('product-hunt.md');
    expect(under(text, 'Name')).toEqual(['Wobo']);
    const [tagline, ...more] = under(text, 'Tagline');
    expect(more).toEqual([]);
    // Product Hunt cuts a tagline at sixty characters.
    expect((tagline ?? '').length).toBeLessThanOrEqual(60);
    expect(under(text, 'Description')).toEqual([plain(ONE_LINE)]);
    expect(under(text, 'About')).toEqual([plain(HUNDRED_WORDS)]);
    // The gallery is the press page's three screenshots, captioned as the page captions them.
    for (const shot of SCREENSHOTS) {
      expect(text).toContain(`heywobo.com${shot.href}`);
      expect(under(text, 'Gallery')).toContain(plain(`${shot.title}. ${shot.note}`));
    }
    expect(under(text, 'Maker')).toEqual([plain(`${FOUNDER.name}, founder of Wobo.`)]);
  });

  it('writes the pitch to one named person, with the three hundred words as its body', () => {
    const text = read('pitch-email.md');
    const body = under(text, 'The email');
    // Addressed to a person by name, filled in by hand, never a list.
    expect(body[0]).toMatch(/^Hi \{\{journalist_first_name\}\},$/);
    expect(text).not.toMatch(
      /\b(dear all|hi all|hi there|hello everyone|dear sir\/madam|to whom)\b/i,
    );
    // One sentence written for that journalist alone, about something they wrote.
    expect(body.join(' ')).toContain('{{why_you}}');
    for (const paragraph of THREE_HUNDRED_WORDS) expect(body).toContain(plain(paragraph));
    expect(body.join(' ')).toContain(PRESS_MAILBOX);
    expect(body.join(' ')).toContain(`heywobo.com/press`);
    expect(body.at(-1)).toBe(plain(`${FOUNDER.name}, founder of Wobo.`));
    // The outlets are the reachable tier the plan names, and the file says to send one at a time.
    for (const outlet of ['YourStory', 'Inc42', 'Entrackr', 'Analytics India Magazine']) {
      expect(text).toContain(outlet);
    }
    expect(text).toMatch(/one at a time/i);
  });

  it('gives the design awards a statement about the site and nothing about the stack', () => {
    const text = read('awards.md');
    expect(under(text, 'Site name')).toEqual(['Wobo']);
    expect(under(text, 'Address')).toEqual(['https://heywobo.com']);
    expect(under(text, 'Short description')).toEqual([plain(ONE_LINE)]);
    expect(under(text, 'Design statement').length).toBeGreaterThan(0);
    // The only technologies named are web standards: naming a library is naming a vendor.
    for (const line of under(text, 'Technologies')) {
      expect(line).toMatch(/^(HTML|CSS|SVG|JavaScript)(, (HTML|CSS|SVG|JavaScript))*$/);
    }
    expect(text).toContain('Awwwards');
  });

  describe('every quoted line obeys the law the page obeys', () => {
    const words = FILES.flatMap((name) => blocks(read(name))).join('\n');

    it('has no em dash, no exclamation mark and no emoji', () => {
      expect(words).not.toContain('—');
      expect(words).not.toContain('!');
      expect(words).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it('names no class, grade or age range, no raw allowance and no late hour', () => {
      expect(words).not.toMatch(/\bclass(es)? \d|\bgrades? \d|\b(ages?|aged) \d/i);
      expect(words).not.toMatch(/\bunlimited\b|\b\d+\s+(questions?|turns?)\s+(a|per)\s+day\b/i);
      expect(words).not.toMatch(/\b(tonight|midnight|late at night|10 ?pm|11 ?pm)\b/i);
    });

    it('names no vendor, model or provider, and calls the brand Wobo', () => {
      expect(words).not.toMatch(
        /\b(openai|gpt|gemini|claude|anthropic|supabase|vercel|railway|react|vite|gsap)\b/i,
      );
      expect(words).not.toMatch(/HeyWobo|Hey Wobo/);
    });

    it('claims no number it cannot show, no result and no rank (docs/CLAIMS.md)', () => {
      expect(words).not.toMatch(/\d\s?%/);
      expect(words).not.toMatch(
        /\b\d[\d,]*\+?\s+(users|learners|students|families|schools|lessons|downloads)\b/i,
      );
      expect(words).not.toMatch(
        /\b(guarantee|guaranteed|better marks|improve marks|top rank|best|leading|number one|#1|the only)\b/i,
      );
      // "first" only in the one form docs/CLAIMS.md §1 clears, word for word.
      for (const match of words.matchAll(/[^.]*\bfirst\b[^.]*/gi)) {
        expect(match[0]).toMatch(
          /world’s first AI companion that shows you|world's first AI companion that shows you/,
        );
      }
    });

    it('runs nobody down (voice.md §8.8)', () => {
      expect(words).not.toMatch(
        /\b(better than|cheaper than|unlike|instead of) (a |your )?(teacher|school|tuition|other apps?)/i,
      );
    });
  });
});

/**
 * EVERY BOARD THE PRESS WORDS NAME IS A BOARD THE SITE PUBLISHES (2026-09-17). The kit said
 * "across CBSE, ICSE and the state boards" in the hundred words, the three hundred words and the
 * facts box, and the syllabus the site publishes holds no state board at all. A journalist who
 * searched the site for one found nothing. What is backed: the official syllabus for the boards
 * `syllabus.json` holds, and any other board's syllabus as the learner brings it
 * (docs/CLAIMS.md, `curriculum/OwnSyllabus.tsx`).
 */
describe('the boards the press words name', () => {
  const held = new Set(boards().map((board) => board.short));
  const assets = ['product-hunt.md', 'pitch-email.md', 'awards.md'].map((name) =>
    readFileSync(join(REPO, 'docs', 'copy', 'press', name), 'utf8'),
  );
  const everything = [
    KIT,
    HUNDRED_WORDS,
    ...THREE_HUNDRED_WORDS,
    ...FACTS.map((row) => row.value),
    ...assets,
  ];

  it('never claims the state boards', () => {
    for (const text of everything) expect(text).not.toMatch(/\bstate boards?\b/i);
  });

  it('names only boards the published syllabus holds', () => {
    const named = [...everything.join(' ').matchAll(/\b(CBSE|ICSE|ISC|NIOS|IB|IGCSE)\b/g)].map(
      (m) => m[1] as string,
    );
    expect(named.length).toBeGreaterThan(0);
    for (const board of named) expect(held.has(board), board).toBe(true);
    const boardsRow = FACTS.find((row) => row.label === 'Boards')?.value ?? '';
    for (const board of held) expect(boardsRow).toContain(board);
  });
});
