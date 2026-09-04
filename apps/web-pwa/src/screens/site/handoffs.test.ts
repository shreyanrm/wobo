/**
 * THE DRIFT GUARD, and the walk of the whole site.
 *
 * This file exists because of one bug that cost more than any layout defect on this site: the
 * header said "Get started", the plans page said "Get early access", and a visitor who clicked the
 * first and read the second learnt that we did not know whether we were open. Nobody typed two
 * phrases on purpose. Two people typed one phrase each, months apart, and there was nothing to stop
 * them — which is why the fix is not a rename, it is this test.
 *
 * It holds four things, in order of how expensive they are to lose:
 *
 *  1. NO PUBLIC SCREEN TYPES A CALL TO ACTION. The phrase appears once in the tree, in `cta.ts`.
 *     Any other public source that writes it — or writes one of the retired phrases — fails here,
 *     named, with its line.
 *  2. EVERY PAGE HANDS OFF. Each public page's close has one primary and one quiet second, the two
 *     are different, the quiet one is not a second front door, and every address either of them
 *     names is one the router actually answers.
 *  3. NO PAGE DEAD-ENDS. Walking the site as a visitor, from every page there is a way forward
 *     that is not the header.
 *  4. NO DEAD CONTROL IN THE CHROME. Every address in the pill nav and the footer resolves. This is
 *     the check that would have caught "/schools", a footer link on every public page that went to
 *     the 404 for as long as the footer has existed.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToRoute } from '../../shell/router';
import { PLANS_PAGE } from '../plans/copy';
import { CTA, RETIRED_CTA } from './cta';
import { type Handoff, HANDOFFS, type PublicPage } from './handoffs';
import { FOOTER_COLUMNS, NAV_LINKS } from './nav';

const SCREENS = join(import.meta.dir, '..');

/** Every lane that renders a public surface, plus the state family, which owns the 404. */
const PUBLIC_LANES = [
  'landing',
  'site',
  'pitch',
  'plans',
  'gift',
  'donate',
  'legal',
  'contact',
  'states',
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `content/` is compiled from the reviewed copy in docs/, not written here
      if (entry.name !== 'content') sources(path, out);
    } else if (['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

/** A file's SHIPPED words: block comments and whole-line `//` notes taken out first, so a note
 *  that names a retired phrase in order to retire it is not itself a violation. */
function shipped(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const PAGES = PUBLIC_LANES.flatMap((lane) => sources(join(SCREENS, lane))).map((path) => ({
  name: relative(SCREENS, path),
  text: shipped(path),
}));

/** Every hit of `pattern` in the shipped words of a public source, excluding the files named. */
function hits(pattern: RegExp, except: readonly string[] = []): string[] {
  const found: string[] = [];
  for (const page of PAGES) {
    if (except.includes(page.name)) continue;
    for (const [i, line] of page.text.split('\n').entries()) {
      if (pattern.test(line)) found.push(`${page.name}:${i + 1} ${line.trim().slice(0, 100)}`);
    }
  }
  return found;
}

describe('one phrase, one place', () => {
  it('scans the whole public site, not a corner of it', () => {
    // a guard on the guard: a rename that empties this list must fail here, not pass in silence
    expect(PAGES.length).toBeGreaterThan(40);
    for (const file of [
      'landing/sections/Header.tsx',
      'landing/sections/Hero.tsx',
      'landing/sections/Close.tsx',
      'site/SiteShell.tsx',
      'site/ClosePanel.tsx',
      'pitch/ForParents.tsx',
      'plans/Plans.tsx',
      'gift/Gift.tsx',
      'donate/Donate.tsx',
      'states/pages.tsx',
    ]) {
      expect(PAGES.map((p) => p.name)).toContain(file);
    }
  });

  it('lets no public screen type the call to action — it is in cta.ts and nowhere else', () => {
    const phrase = new RegExp(CTA.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    expect(
      hits(phrase, ['site/cta.ts']),
      'a hard-coded call to action is how the site drifted apart last time: read CTA.label',
    ).toEqual([]);
  });

  it('retires "Get early access" and "Get started" from every public surface', () => {
    expect(
      // `cta.ts` is the one file allowed to name a retired phrase, because it names it in order to
      // retire it: `RETIRED_CTA` exists so a scan like this one has somewhere single to look.
      hits(/get early access|get started|start learning for free|begin tonight/i, ['site/cta.ts']),
      'we are open (owner, 2026-09-04): no surface may imply a waitlist',
    ).toEqual([]);
    expect(RETIRED_CTA).not.toBe(CTA.label);
  });

  it('leaves no waitlist behind it — no list to join, no address to leave', () => {
    expect(
      hits(/waitlist|first group|first in line|on the list|leave an address/i),
      'nothing on a public page may suggest a queue',
    ).toEqual([]);
    // the landing's email capture, gone with the waitlist it fed
    expect(hits(/EARLY_ACCESS_KEY|keepAddress|earlyAccessHandler/)).toEqual([]);
  });
});

describe('one page, one job, one primary', () => {
  const entries = Object.entries(HANDOFFS) as [PublicPage, (typeof HANDOFFS)[PublicPage]][];

  it('covers every public page that closes', () => {
    expect(entries.length).toBe(17);
  });

  it('gives each page one primary and one quiet second, never two of equal weight', () => {
    for (const [page, close] of entries) {
      expect([page, close.primary.label === close.quiet.label]).toEqual([page, false]);
      // exactly one destination each: a route or an address, never both and never neither
      for (const action of [close.primary, close.quiet]) {
        expect([page, action.label, Boolean(action.to) !== Boolean(action.href)]).toEqual([
          page,
          action.label,
          true,
        ]);
      }
    }
  });

  it('says what each page is for, in the words of SELL.md §6', () => {
    for (const [page, close] of entries) {
      expect([page, close.job.length > 8]).toEqual([page, true]);
      expect([page, close.title.endsWith('.')]).toEqual([page, true]);
      // the copy law: no exclamation, no em dash, sentence case
      expect([page, /[!—]/.test(`${close.title}${close.hand ?? ''}`)]).toEqual([page, false]);
    }
  });

  it('points every address at a route the router answers', () => {
    for (const [page, close] of entries) {
      for (const action of [close.primary, close.quiet]) {
        const href = action.href;
        if (!href || href.startsWith('#')) continue;
        const route = href === '/' ? { name: 'landing' } : pathToRoute(href);
        expect([page, href, route !== null]).toEqual([page, href, true]);
      }
    }
  });

  /**
   * THE WALK. From every page there must be a way forward that is not the header — an address that
   * is not this page. An in-page anchor does not count: it is this page, not a way off it.
   *
   * ONE PAGE IS EXEMPT, and it is written down rather than quietly skipped. `/donate` closes on its
   * own two conversions — funding a place and asking for one — and both of those are working forms
   * further up the same page, one for each of the two people the page is for. Its close is
   * therefore all in-page by design, and the way off it is the footer's money document, printed in
   * the fine print under the doors. If a second page ever needs this line, it needs a reason first.
   */
  const ON_PAGE_CONVERSION = new Set<PublicPage>(['donate']);

  it('leaves no page whose only way forward is the header', () => {
    const SELF: Partial<Record<PublicPage, string>> = {
      home: '/',
      meet: '/meet-wobo',
      how: '/how-it-works',
      parents: '/for-parents',
      students: '/for-students',
      subjects: '/subjects',
      security: '/security',
      plans: '/plans',
      checkout: '/plans/checkout',
      gift: '/gift',
      donate: '/donate',
      about: '/about',
      help: '/help',
      contact: '/contact',
      legal: '/legal',
      sitemap: '/sitemap',
      notfound: '/404',
    };
    for (const [page, close] of entries) {
      const forward = [close.primary, close.quiet].filter((action) => {
        if (action.to) return true; // a route is always another screen
        const href = action.href ?? '';
        return href !== '' && !href.startsWith('#') && href !== SELF[page];
      });
      expect([page, forward.length > 0 || ON_PAGE_CONVERSION.has(page)]).toEqual([page, true]);
    }
  });

  it('mirrors the plans close in the plans copy, so the two cannot say different things', () => {
    // the table's side is the one that is `string`; the copy file's side is a literal, so it is the
    // expectation and not the subject, or the compiler reads a widening as a failure
    expect(HANDOFFS.plans.title).toBe(PLANS_PAGE.close.title);
    expect(HANDOFFS.plans.hand).toBe(PLANS_PAGE.close.hand);
    expect(HANDOFFS.plans.primary.label).toBe(PLANS_PAGE.close.primary);
    expect(HANDOFFS.plans.quiet.label).toBe(PLANS_PAGE.close.quiet);
  });
});

describe('the chrome has no dead control', () => {
  /**
   * "/schools" sat in the footer of every public page and answered with the 404, because there has
   * never been a route for it. A dead link in the chrome is on fifty pages at once, which is why it
   * is worth a test rather than a look.
   */
  it('resolves every address in the pill nav and the footer', () => {
    const links = [...NAV_LINKS, ...FOOTER_COLUMNS.flatMap((column) => column.links)];
    const dead = links.filter((link) => {
      const path = link.href.split('#')[0] ?? '/';
      if (path === '/' || path === '') return false; // the front door
      return pathToRoute(path) === null;
    });
    expect(dead.map((link) => `${link.label} → ${link.href}`)).toEqual([]);
  });

  it('carries the nav in the order the doubts arrive (SELL.md §3)', () => {
    expect(NAV_LINKS.map((link) => link.label)).toEqual([
      'Meet Wobo',
      'Subjects',
      'How it works',
      'For parents',
      'For students',
      'Plans',
    ]);
  });

  it('keeps the nav a funnel rather than a sitemap', () => {
    expect(NAV_LINKS.length).toBeLessThanOrEqual(6);
  });
});

/**
 * THE SOURCES A WRITER READS BEFORE TYPING A DOOR.
 *
 * Retiring a phrase from the code is half a retirement. The other half is the documents somebody
 * opens when they write the next page: the copy law, the voice guide, the site map and the design
 * law, plus the prototypes every page is ported from word for word. Leave "Get early access" in any
 * of those and the phrase comes back on the next surface anybody builds, correctly, from a source
 * that still says it — which is exactly how a header and a plans page came to say two different
 * things in the first place.
 *
 * So the retirement is enforced over the SOURCES as well as the screens. Two files are allowed to
 * name the phrase, and both name it in order to retire it: `site/cta.ts` (which exports it as
 * `RETIRED_CTA` so a scan like this one has somewhere single to look) and `docs/SELL.md` §7, which
 * is the ruling itself.
 */
describe('the copy sources say what the code says', () => {
  const REPO = join(SCREENS, '..', '..', '..', '..');

  /** The documents a writer reads before typing a door, and the drawings a page is ported from. */
  const SOURCES = [
    'docs/copy/README.md',
    'docs/copy/voice.md',
    'docs/SITE.md',
    'DESIGN.md',
    ...readdirSync(join(REPO, 'design', 'prototypes'))
      .filter((name) => name.endsWith('.html'))
      .map((name) => `design/prototypes/${name}`),
  ];

  /**
   * A line is allowed to name a retired phrase only in the same breath as retiring it — the way
   * DESIGN.md §0 and `cta.ts` both do. A line that names it and says nothing about it being gone is
   * a line the next writer copies.
   */
  const RETIRES_IT = /\bretired\b|\bno longer\b|comes off\b/i;

  /** Every line of a source that still carries a phrase the law retired. */
  function inSources(pattern: RegExp): string[] {
    const found: string[] = [];
    for (const source of SOURCES) {
      for (const [i, line] of readFileSync(join(REPO, source), 'utf8').split('\n').entries()) {
        if (pattern.test(line) && !RETIRES_IT.test(line)) {
          found.push(`${source}:${i + 1} ${line.trim().slice(0, 90)}`);
        }
      }
    }
    return found;
  }

  it('leaves "Get early access" in no document a writer reads and no drawing a page is ported from', () => {
    expect(
      inSources(new RegExp(RETIRED_CTA, 'i')),
      'we are open (owner, 2026-09-04): a source that still promotes is how the phrase comes back',
    ).toEqual([]);
  });

  it('retires the law that produced it, not only the words', () => {
    expect(
      inSources(/promote before you invite/i),
      'the closing call is no longer early access, so the rule that said so cannot stand',
    ).toEqual([]);
  });

  it('keeps the one phrase the code uses out of no source, and the code the only place it is typed', () => {
    // the ruling itself is allowed to quote what it retires; nothing else is
    expect(RETIRED_CTA).not.toBe(CTA.label);
    expect(CTA.label).toBe('Start free');
  });
});

/**
 * THE OTHER HALF OF "NO DEAD CONTROL". The walk above proves every close that names a PATH points at
 * a route the router answers. It says nothing about the closes that name an in-page anchor, and
 * four of those are on the pages where a reader is closest to deciding: `#plans` on the plans page,
 * `#how-it-works` on the gift page, `#fund` and `#ask` on the donate page. An anchor is a control
 * only if the page it belongs to actually carries that id; one typo and it is a button that scrolls
 * nowhere, which is the friction docs/SELL.md §8 names.
 *
 * `pitch/anchors.test.ts` walks the six pitch pages and /about from the page's end. This walks the
 * TABLE's end, so every page in it is covered — including the three the pitch file does not reach.
 */
describe('no close scrolls nowhere', () => {
  /** Where each page in the table renders, for the pages whose close names an in-page anchor. */
  const RENDERED_BY: Partial<Record<PublicPage, string>> = {
    subjects: 'pitch/Subjects.tsx',
    security: 'pitch/Security.tsx',
    plans: 'plans/Plans.tsx',
    gift: 'gift/Gift.tsx',
    donate: 'donate/Donate.tsx',
  };

  it('covers every page in the table that closes on an anchor', () => {
    const withAnchors = (Object.entries(HANDOFFS) as [PublicPage, Handoff][])
      .filter(([, close]) =>
        [close.primary, close.quiet].some((action) => (action.href ?? '').startsWith('#')),
      )
      .map(([page]) => page);
    expect(withAnchors.filter((page) => !RENDERED_BY[page])).toEqual([]);
  });

  for (const [page, file] of Object.entries(RENDERED_BY) as [PublicPage, string][]) {
    it(`${file} carries every id its close scrolls to`, () => {
      const text = readFileSync(join(SCREENS, file), 'utf8');
      const ids = new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] as string));
      const close = HANDOFFS[page];
      const dead = [close.primary, close.quiet]
        .map((action) => action.href ?? '')
        .filter((href) => href.startsWith('#'))
        .map((href) => href.slice(1))
        .filter((id) => !ids.has(id));
      expect(dead, `${file} closes on an anchor it does not carry`).toEqual([]);
    });
  }
});
