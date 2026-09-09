/**
 * THE HEAD IS ONE SOURCE, AND THE BUILD READS IT.
 *
 * Every public URL used to answer with the same 3,338-byte shell: one title, one description, and
 * a `<link rel="canonical">` hardcoded to the root, so every page on the site told a crawler it was
 * the home page and every shared link previewed as the home page (docs/GROWTH-SEARCH.md §2). The
 * fix is a pre-render, and a pre-render is only worth having if the tags it writes are the tags the
 * running app would write. So the tag table lives here, `headFor` in the router uses it, and
 * `scripts/prerender.ts` uses the same function on the same route object.
 */

import { describe, expect, it } from 'bun:test';
import {
  BRAND_DESCRIPTION,
  BRAND_LOCALE,
  BRAND_NAME,
  describeFrom,
  headTags,
  ogImagePath,
  renderHeadTags,
  trimDescription,
} from './head';

const PAGE = {
  canonical: 'https://heywobo.com/about',
  title: 'About Wobo',
  description:
    'Wobo is a small company with one job: make sure no child is stuck alone with a question.',
  image: 'https://heywobo.com/og/about.png',
};

function tagMap(tags: ReturnType<typeof headTags>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags) out[tag.key] = tag.value;
  return out;
}

describe('the tags one page carries', () => {
  it('names THAT page in every tag a crawler and a share card read', () => {
    const map = tagMap(headTags(PAGE));
    expect(map.title).toBe('About Wobo');
    expect(map.description).toBe(PAGE.description);
    expect(map.canonical).toBe('https://heywobo.com/about');
    expect(map['og:title']).toBe('About Wobo');
    expect(map['og:description']).toBe(PAGE.description);
    expect(map['og:url']).toBe('https://heywobo.com/about');
    expect(map['og:image']).toBe('https://heywobo.com/og/about.png');
    expect(map['og:site_name']).toBe(BRAND_NAME);
    expect(map['og:locale']).toBe(BRAND_LOCALE);
    expect(map['twitter:card']).toBe('summary_large_image');
    expect(map['twitter:title']).toBe('About Wobo');
    expect(map['twitter:description']).toBe(PAGE.description);
    expect(map['twitter:image']).toBe('https://heywobo.com/og/about.png');
  });

  it('carries no robots tag on a page that should be indexed', () => {
    expect(tagMap(headTags(PAGE)).robots).toBeUndefined();
  });

  it('asks not to be indexed, and claims no canonical, where the route says so', () => {
    const map = tagMap(headTags({ ...PAGE, canonical: null, robots: 'noindex' }));
    expect(map.robots).toBe('noindex');
    expect(map.canonical).toBeUndefined();
    expect(map['og:url']).toBeUndefined();
  });

  it('renders escaped HTML a browser can parse', () => {
    const html = renderHeadTags(headTags({ ...PAGE, title: 'A "quoted" & <angled> title' }));
    expect(html).toContain('<title>A &quot;quoted&quot; &amp; &lt;angled&gt; title</title>');
    expect(html).toContain('<link rel="canonical" href="https://heywobo.com/about">');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).not.toContain('<angled>');
  });
});

describe('the one line every surface repeats', () => {
  it('is the press kit line, word for word (docs/copy/press-kit.md)', () => {
    expect(BRAND_DESCRIPTION).toBe(
      'Wobo is an AI tutor for Indian school students that draws every explanation live on the page, for every subject their board sets.',
    );
  });

  it('carries no em dash, like every other line a person reads', () => {
    expect(BRAND_DESCRIPTION).not.toContain('—');
  });
});

describe('the image a share card shows', () => {
  it('is one file per page, named for the page', () => {
    expect(ogImagePath('/')).toBe('/og/home.png');
    expect(ogImagePath('/about')).toBe('/og/about.png');
    expect(ogImagePath('/help/wobo-basics/what-is-wobo')).toBe(
      '/og/help-wobo-basics-what-is-wobo.png',
    );
    expect(ogImagePath('/plans/checkout')).toBe('/og/plans-checkout.png');
  });

  it('gives no two addresses the same file', () => {
    const paths = ['/', '/about', '/help', '/help/a/b', '/legal/cookies'];
    expect(new Set(paths.map(ogImagePath)).size).toBe(paths.length);
  });
});

describe('a description written from the page’s own words', () => {
  it('stops on a sentence rather than mid-word', () => {
    const long =
      'Wobo teaches your child’s own syllabus, draws the answer until it lands, and shows you what happened. It never judges, and it is free every day of the week for every learner.';
    const out = trimDescription(long);
    expect(out.length).toBeLessThanOrEqual(165);
    expect(out.endsWith('.')).toBe(true);
    expect(long.startsWith(out)).toBe(true);
  });

  it('says so when it had to cut, rather than stopping in the middle of a sentence', () => {
    const oneSentence =
      'Everything here is the board’s own document, and we do not summarise a circular, we do not repost a date somebody put on a forum, and we do not print an examination date we have not read.';
    const out = trimDescription(oneSentence);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/[,;:]…$/);
    expect(oneSentence.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('keeps a short lead whole', () => {
    expect(trimDescription('Help centre, in three groups.')).toBe('Help centre, in three groups.');
  });

  it('takes the next paragraph when the lead is too thin to say anything', () => {
    const out = describeFrom([
      '34 articles, in three groups',
      'what Wobo is, getting started, talking to Wobo, your account, settings, plans, privacy.',
    ]);
    expect(out).toBe(
      '34 articles, in three groups. What Wobo is, getting started, talking to Wobo, your account, settings, plans, privacy.',
    );
  });

  it('leaves a lead that already ends in a stop exactly as the page wrote it', () => {
    expect(describeFrom(['One.', 'Two, and something longer to reach the floor.'])).toBe(
      'One. Two, and something longer to reach the floor.',
    );
  });

  it('is empty when the page gave it nothing', () => {
    expect(describeFrom([])).toBe('');
    expect(describeFrom(['   ', ''])).toBe('');
  });
});
