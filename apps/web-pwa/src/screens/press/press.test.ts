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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_DESCRIPTION } from '../../shell/head';
import { PROFILES, sameAs } from '../../shell/profiles';
import { PLAIN_ROUTES, pathToRoute } from '../../shell/router';
import { isPublicSite } from '../../shell/public-routes';
import { FOOTER_COLUMNS } from '../site/nav';
import { MAILBOXES } from '../site/identity';
import { PUBLIC_ROUTES } from '../states/routes';
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
    expect(quoted('The one line (use everywhere: listings, app stores, social bios, the meta description)')).toEqual([
      plain(ONE_LINE),
    ]);
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
