/**
 * WHAT ONE PAGE TELLS A CRAWLER, AND WHERE IT COMES FROM.
 *
 * Until this file existed the whole site said one thing. `vite.config.ts` injected a single
 * `<link rel="canonical">` pointing at the root and a single og:title and og:description into the
 * one shell every address was rewritten to, so all 61 published URLs told a crawler they were the
 * home page and every shared link previewed as the home page (docs/GROWTH-SEARCH.md §2). The words
 * on those pages existed only after JavaScript ran, and the engines that feed the answer machines
 * do not run JavaScript, so the site was invisible.
 *
 * This module is the one table of head tags. Three callers read it and nothing else writes a head:
 *
 *   · `headFor` in `shell/router.tsx`, which the running app writes the head from on every
 *     navigation,
 *   · `scripts/prerender.ts`, which writes a real HTML file per address at build time and asks
 *     `headFor` for the same tags, so the file and the app can never disagree,
 *   · `vite.config.ts`, for the one line the shell and the install manifest carry.
 *
 * It is deliberately plain: no React, no app imports, nothing that cannot run inside a build
 * script or a Vite config.
 */

/** The brand, everywhere a person reads a name (docs/GROWTH-ENTITY.md §2). Never "HeyWobo". */
export const BRAND_NAME = 'Wobo';

/**
 * THE ONE LINE, WORD FOR WORD (docs/copy/press-kit.md).
 *
 * It is the meta description, the app store blurb, the social bio and the listing summary, and it
 * is identical on every one of them on purpose: an answer engine decides what a name means by what
 * independent sources agree on, and sameness is the whole lever (docs/GROWTH-ENTITY.md §4).
 * Improving it "just for this surface" is the one thing that breaks it.
 */
export const BRAND_DESCRIPTION =
  'Wobo is an AI tutor for Indian school students that draws every explanation live on the page, for every subject their board sets.';

/**
 * The front page's title. Every other page sets its own, and a title is the page's own words; the
 * home page had none at all, so its tab and its search result read the bare product name, which
 * tells an engine nothing about which Wobo this is. It carries the qualifier the entity work asks
 * for ("Wobo, the AI tutor") until the engines have learnt the name (docs/GROWTH-ENTITY.md §4).
 */
export const HOME_TITLE = 'Wobo, the AI tutor that draws every explanation';

/** Indian English: the market the product is for, and the market the name is being won in. */
export const BRAND_LOCALE = 'en_IN';

/** The origin of record. `VITE_APP_URL` overrides it, so the domain swap stays one change. */
export const DEFAULT_ORIGIN = 'https://heywobo.com';

/** Where the per-page share cards are written, and the size every scraper is told to expect. */
export const OG_DIR = '/og';
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** How long a description may be before a search result cuts it off mid-word. */
export const DESCRIPTION_MAX = 160;
/** Below this a description says nothing, so the page's next paragraph is taken as well. */
export const DESCRIPTION_MIN = 80;

/** One tag, in the order it should be written. `key` is what it declares, for a test to read. */
export interface HeadTag {
  /** 'title' | 'description' | 'canonical' | 'robots' | 'og:*' | 'twitter:*' */
  key: string;
  value: string;
  html: string;
}

/** Everything a page knows about itself by the time the build has rendered it. */
export interface PageFacts {
  /** The page's own title, as the page itself set it. */
  title: string;
  /** The page's own words, trimmed to a length a result can show. */
  description: string;
  /** The absolute address of the share card drawn for THIS page. */
  image?: string | null;
  /** The one address a crawler should index this page at. Null where nothing should be indexed. */
  canonical?: string | null;
  robots?: 'noindex' | null;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** An origin with no trailing slash, so `${origin}${path}` is never a double slash. */
export function normaliseOrigin(raw?: string | null): string {
  const value = (raw ?? '').trim();
  return (value || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

/** An origin-relative path made absolute. An already-absolute URL is left alone. */
export function absoluteUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${normaliseOrigin(origin)}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The share card for one address, one file per page. `/` is `home` rather than an empty name, and
 * every other address becomes its own path with the slashes flattened, so no two pages can land on
 * the same file and a card can always be traced back to the page it was drawn for.
 */
export function ogImagePath(path: string): string {
  const slug =
    path
      .split('?')[0]
      ?.split('#')[0]
      ?.replace(/^\/+|\/+$/g, '')
      .replace(/[^A-Za-z0-9/_-]+/g, '-')
      .replace(/\//g, '-') || 'home';
  return `${OG_DIR}/${slug}.png`;
}

/**
 * A description cut where a reader would stop. A sentence boundary wins when there is one late
 * enough to still say something.
 *
 * WHEN THERE IS NO SENTENCE TO STOP ON, THE CUT SAYS SO. A page whose first sentence runs past the
 * limit used to be trimmed at the last whole word and left there, so 74 of the 605 published
 * descriptions ended with no punctuation at all: "and we do not print an examination", "and what a
 * machine can and cannot". A reader cannot tell that from a page that ran out of words, so the
 * trim ends on an ellipsis, which is what a truncation looks like everywhere else a person reads
 * one. It is not an em dash, and it is inside the limit rather than added to it.
 */
export function trimDescription(
  text: string,
  max: number = DESCRIPTION_MAX,
  min: number = DESCRIPTION_MIN,
): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max + 1);
  const stop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
  );
  if (stop >= min) return clean.slice(0, stop + 1).trim();
  // One character of the budget belongs to the ellipsis, so the whole line still fits.
  const room = max - 1;
  const space = clean.slice(0, room + 1).lastIndexOf(' ');
  const cut = clean.slice(0, space > min ? space : room).trim();
  // A line that ends on the comma it was cut at reads as a mistake rather than as a trim.
  return `${cut.replace(/[,;:]+$/, '')}…`;
}

/**
 * A description built from the page's own paragraphs, in the order the page says them. A lead that
 * is too thin to describe anything ("34 articles, in three groups") takes the paragraph after it,
 * and the result is cut where a reader would stop.
 *
 * Two paragraphs that were never written to sit on one line are joined as sentences rather than
 * run together, because a search result shows one line and "34 articles, in three groups what Wobo
 * is, getting started" is not a sentence anyone wrote.
 */
export function describeFrom(
  parts: readonly string[],
  max: number = DESCRIPTION_MAX,
  min: number = DESCRIPTION_MIN,
): string {
  let text = '';
  for (const part of parts) {
    const piece = part.replace(/\s+/g, ' ').trim();
    if (!piece) continue;
    if (!text) text = piece;
    else if (/[.!?:]$/.test(text)) text = `${text} ${piece}`;
    else text = `${text}. ${piece.charAt(0).toUpperCase()}${piece.slice(1)}`;
    if (text.length >= min) break;
  }
  return trimDescription(text, max, min);
}

/** How many words a reader would find on the page. The floor a pre-rendered page has to clear. */
export function countWords(text: string): number {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

function meta(kind: 'name' | 'property', key: string, value: string): HeadTag {
  return {
    key,
    value,
    html: `<meta ${kind}="${escapeHtml(key)}" content="${escapeHtml(value)}">`,
  };
}

/**
 * Every tag one page's head should carry, in the order it should carry them.
 *
 * A page that should not be indexed claims no canonical and no og:url — a 404 keeps the address it
 * was asked for so the reader can see the slip, and pointing a canonical at that address would
 * invite a crawler to index a page whose only content is that nothing is there.
 */
export function headTags(facts: PageFacts): HeadTag[] {
  const tags: HeadTag[] = [];
  const title = facts.title.trim();
  const description = facts.description.trim();
  if (title) {
    tags.push({ key: 'title', value: title, html: `<title>${escapeHtml(title)}</title>` });
  }
  if (description) tags.push(meta('name', 'description', description));
  if (facts.canonical) {
    tags.push({
      key: 'canonical',
      value: facts.canonical,
      html: `<link rel="canonical" href="${escapeHtml(facts.canonical)}">`,
    });
  }
  if (facts.robots) tags.push(meta('name', 'robots', facts.robots));
  tags.push(meta('property', 'og:type', 'website'));
  tags.push(meta('property', 'og:site_name', BRAND_NAME));
  tags.push(meta('property', 'og:locale', BRAND_LOCALE));
  if (title) tags.push(meta('property', 'og:title', title));
  if (description) tags.push(meta('property', 'og:description', description));
  if (facts.canonical) tags.push(meta('property', 'og:url', facts.canonical));
  if (facts.image) {
    tags.push(meta('property', 'og:image', facts.image));
    tags.push(meta('property', 'og:image:width', String(OG_WIDTH)));
    tags.push(meta('property', 'og:image:height', String(OG_HEIGHT)));
    if (title) tags.push(meta('property', 'og:image:alt', title));
  }
  tags.push(meta('name', 'twitter:card', 'summary_large_image'));
  if (title) tags.push(meta('name', 'twitter:title', title));
  if (description) tags.push(meta('name', 'twitter:description', description));
  if (facts.image) tags.push(meta('name', 'twitter:image', facts.image));
  return tags;
}

/** The tags as the HTML a head carries, one per line, indented as the shell is. */
export function renderHeadTags(tags: readonly HeadTag[], indent = '    '): string {
  return tags.map((tag) => `${indent}${tag.html}`).join('\n');
}
