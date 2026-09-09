/**
 * THE BLOG ENGINE. A post is a file, and nothing else is needed to publish one.
 *
 * `docs/copy/blog/**` is the reviewed source: one Markdown file per post with a small block of
 * front matter, and one README that holds the blog's own title, its tags and the people who write
 * under it. `compile.ts` turns that folder into `site/content/blog.json` at build time, exactly
 * the way `scripts/site-content.ts` turns `docs/copy/help-centre/**` into `help.json`, so the
 * shipped bundle carries no Markdown parser and no hand-typed duplicate of prose a reviewer owns.
 *
 * This module is the pure half: the front matter, the reading time, the addresses, the feed, the
 * structured data, and THE GATE. It touches no filesystem, so the pages, the build step and the
 * tests all read one implementation.
 *
 * WHY THE GATE IS NOT AN EDITORIAL PREFERENCE. `/blog` is the origin every syndicated copy points
 * back at (docs/GROWTH-DESK.md §3), and Google's rule is that generating many pages "without
 * adding value for users" is spam (docs/GROWTH-SEARCH.md §3). The only defence against drifting
 * into that is a floor a thin page cannot clear, applied by the build rather than by whoever is
 * writing that day. A post that does not clear it is not published, and the build says which one
 * and why.
 */

import type { Block, Inline } from '../markdown';
import { blocksText, inlineText, parseBlocks, proseText, splitLead } from '../markdown';

// --- the shapes ----------------------------------------------------------------------------------

/**
 * Somebody who writes here. `name` is null until the owner decides which name goes on the page:
 * inventing one is forbidden (docs/copy/voice.md §8.1) and would be the exact opposite of the
 * trust these pages exist to earn, so the byline names the desk until a person is named.
 */
export interface BlogAuthor {
  key: string;
  name: string | null;
  /** What they do here, in lower case, so it reads inside a sentence. */
  role: string;
  /** One line about what they work on. Shown under a post. */
  about: string;
}

/** A tag, which is a page of its own and therefore needs words of its own. */
export interface BlogTag {
  slug: string;
  title: string;
  /** What this tag is about, in the tag page's own words. Never a list of the post titles. */
  blurb: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  /** The meta description and the line under the title in the index. The page's own words. */
  summary: string;
  /** ISO date, `YYYY-MM-DD`. */
  published: string;
  /** ISO date, or null where the post has not been revised. */
  updated: string | null;
  /** The key of an author in the registry. */
  author: string;
  tags: readonly string[];
  /** Stated, never defaulted: a reader is entitled to know, and an absent field is not an answer. */
  aiAssisted: boolean;
  /** The opening line: a complete answer on its own, the way the help centre opens. */
  lead: Inline[];
  blocks: Block[];
  words: number;
  minutes: number;
  /** Everything the post says after its title, in its own case. */
  plain: string;
}

export interface BlogDoc {
  title: string;
  blurb: string;
  /** The note a post carries where a machine helped write it. One sentence, one place. */
  note: string;
  authors: readonly BlogAuthor[];
  tags: readonly BlogTag[];
  /** Newest first, as the compiler sorted them. */
  posts: readonly BlogPost[];
}

// --- the floors ----------------------------------------------------------------------------------

/**
 * How many words make a post rather than a note. Six hundred is not arbitrary: it is roughly the
 * length at which a page can carry an answer, the working behind it and the honest limit, which is
 * the shape every post here is written in.
 */
export const POST_WORD_FLOOR = 600;

/** How many words the opening line needs before it is an answer rather than a label. */
export const LEAD_WORD_FLOOR = 10;

/** How many sections a reader needs before the page has an outline to jump through. */
export const HEADING_FLOOR = 3;

/**
 * A tag with one post under it is that post at a second address, which is the duplicate every
 * content farm publishes. Two is the smallest number at which the page is doing its own job.
 */
export const TAG_POST_FLOOR = 2;

/** A tag page has to say what the tag is, in a sentence a search result could show. */
export const TAG_BLURB_FLOOR = 60;

/** Below this a summary is a label; above it a search result cuts it off mid-word. */
export const SUMMARY_MIN = 60;
export const SUMMARY_MAX = 160;

/** Words a reader gets through in a minute. The conventional figure, and it is close enough. */
const WORDS_PER_MINUTE = 200;

// --- addresses -----------------------------------------------------------------------------------

export const BLOG_PATH = '/blog';
export const FEED_PATH = '/blog/feed.xml';
/** The one segment a post may not be called, because the tag pages live under it. */
export const TAG_SEGMENT = 'tag';

export function postPath(slug: string): string {
  return `${BLOG_PATH}/${slug}`;
}

export function tagPath(slug: string): string {
  return `${BLOG_PATH}/${TAG_SEGMENT}/${slug}`;
}

/** The address slug of a post file: `01-reading-a-syllabus.md` becomes `reading-a-syllabus`. */
export function postSlug(filename: string): string {
  return filename.replace(/\.md$/, '').replace(/^\d+[-_]/, '');
}

// --- front matter --------------------------------------------------------------------------------

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * The fields at the top of a post file, and the body under them.
 *
 * Deliberately not YAML: the fields are `key: value` lines, `tags` is a comma-separated list, and
 * nothing here needs nesting. A parser nobody can predict is a worse problem than a format nobody
 * can abbreviate.
 */
export function splitFrontMatter(md: string): { fields: Record<string, string>; body: string } {
  const match = FENCE.exec(md.replace(/^﻿/, ''));
  if (!match?.[1]) {
    throw new Error(
      'a post needs front matter: a `---` block naming the title, the summary, the date, the author, the tags and whether a machine helped',
    );
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    fields[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { fields, body: md.slice(match[0].length) };
}

function required(fields: Record<string, string>, key: string, file: string): string {
  const value = fields[key]?.trim();
  if (!value) throw new Error(`${file}: front matter has no \`${key}\``);
  return value;
}

/** How many words a reader would find. */
export function countWords(text: string): number {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

/** Never less than a minute: a page that claims to take no time reads as a page with nothing on it. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** One post file, parsed. Throws only on what makes the file unreadable; the rest is the gate's. */
export function parsePost(filename: string, md: string): BlogPost {
  const { fields, body } = splitFrontMatter(md);
  const file = filename;
  const assisted = required(fields, 'ai-assisted', file);
  if (assisted !== 'true' && assisted !== 'false') {
    throw new Error(`${file}: \`ai-assisted\` must say true or false, and it said "${assisted}"`);
  }
  const all = parseBlocks(body, 2);
  const { lead, body: rest } = splitLead(all);
  const plain = `${inlineText(lead)} ${proseText(rest)}`.replace(/\s+/g, ' ').trim();
  const words = countWords(plain);
  return {
    slug: postSlug(file),
    title: required(fields, 'title', file),
    summary: required(fields, 'summary', file),
    published: required(fields, 'published', file),
    updated: fields.updated?.trim() || null,
    author: required(fields, 'author', file),
    tags: (fields.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    aiAssisted: assisted === 'true',
    lead,
    blocks: rest,
    words,
    minutes: readingMinutes(words),
    plain,
  };
}

// --- the registry --------------------------------------------------------------------------------

/** The rows of the first pipe table under a `## <heading>` section, cell by cell. */
function tableUnder(md: string, heading: string): string[][] {
  const lines = md.split('\n');
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push(cells);
  }
  // The first row is the table's own header, which names the columns rather than holding a value.
  return rows.slice(1);
}

/** The first paragraph under a `## <heading>`, with any bold marks taken off. */
function paragraphUnder(md: string, heading: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start < 0) return '';
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith('## ')) break;
    if (line) return line.replace(/\*\*/g, '');
  }
  return '';
}

export interface BlogIndex {
  title: string;
  blurb: string;
  note: string;
  authors: BlogAuthor[];
  tags: BlogTag[];
}

/** `docs/copy/blog/README.md`, parsed: the blog's own words, its tags and its writers. */
export function parseBlogIndex(md: string): BlogIndex {
  const lines = md.split('\n');
  const titleLine = lines.find((line) => line.startsWith('# '));
  const title = titleLine ? titleLine.slice(2).trim() : 'The Wobo blog';
  const after = titleLine ? lines.slice(lines.indexOf(titleLine) + 1) : lines;
  const blurbLine = after.find((line) => line.trim() && !line.startsWith('#')) ?? '';
  const blurb = blurbLine.trim().replace(/\*\*/g, '');

  const tags: BlogTag[] = tableUnder(md, 'Tags')
    .filter((row) => (row[0] ?? '').length > 0)
    .map((row) => ({ slug: row[0] ?? '', title: row[1] ?? '', blurb: row[2] ?? '' }));
  const authors: BlogAuthor[] = tableUnder(md, 'Authors')
    .filter((row) => (row[0] ?? '').length > 0)
    .map((row) => ({
      key: row[0] ?? '',
      name: (row[1] ?? '').trim() || null,
      role: row[2] ?? '',
      about: row[3] ?? '',
    }));
  if (tags.length === 0 || authors.length === 0) {
    throw new Error("the blog's README must carry a Tags table and an Authors table");
  }
  return { title, blurb, note: paragraphUnder(md, 'The assistance note'), authors, tags };
}

// --- the gate ------------------------------------------------------------------------------------

const EM_DASH = '—';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export interface GateContext {
  authors: readonly BlogAuthor[];
  tags: readonly BlogTag[];
}

/** Everything wrong with one post, in the words the build log should print. Empty when nothing is. */
export function postViolations(post: BlogPost, ctx: GateContext): string[] {
  const bad: string[] = [];

  if (!SLUG.test(post.slug) || post.slug === TAG_SEGMENT || post.slug.includes('.')) {
    bad.push(
      `its address "${post.slug}" is not a plain lower-case slug, or it collides with the tag pages or the feed`,
    );
  }
  if (!post.title.trim()) bad.push('has no title');
  if (post.summary.length < SUMMARY_MIN) {
    bad.push(
      `summarises itself in ${post.summary.length} characters, under ${SUMMARY_MIN}, which is a label rather than something a search result can show`,
    );
  }
  if (post.summary.length > SUMMARY_MAX) {
    bad.push(
      `summarises itself in ${post.summary.length} characters, over ${SUMMARY_MAX}, which a search result cuts off mid-word`,
    );
  }
  if (!isRealDate(post.published)) {
    bad.push(`gives its date as "${post.published}", which is not a date of the shape YYYY-MM-DD`);
  }
  if (post.updated !== null) {
    if (!isRealDate(post.updated)) {
      bad.push(`gives the date it was updated as "${post.updated}", which is not a date`);
    } else if (post.updated < post.published) {
      bad.push(
        `says it was updated on ${post.updated}, before it was published on ${post.published}`,
      );
    }
  }
  if (!ctx.authors.some((author) => author.key === post.author)) {
    bad.push(`names the author "${post.author}", who is not in the blog's Authors table`);
  }
  if (post.tags.length === 0) bad.push('carries no tag, so it sits on no page but its own');
  for (const tag of post.tags) {
    if (!ctx.tags.some((known) => known.slug === tag)) {
      bad.push(`carries the tag "${tag}", which is not in the blog's Tags table`);
    }
  }

  const leadWords = countWords(inlineText(post.lead));
  if (leadWords < LEAD_WORD_FLOOR) {
    bad.push(
      `opens on ${leadWords} words, under ${LEAD_WORD_FLOOR}: the opening line has to answer the question on its own`,
    );
  }
  const headings = post.blocks.filter((block) => block.k === 'h').length;
  if (headings < HEADING_FLOOR) {
    bad.push(
      `carries ${headings} headings, under ${HEADING_FLOOR}, so it has no outline a reader can jump through`,
    );
  }
  if (post.words < POST_WORD_FLOOR) {
    bad.push(`reads ${post.words} words, under the floor of ${POST_WORD_FLOOR}`);
  }

  const everything = `${post.title} ${post.summary} ${post.plain} ${blocksText(post.blocks)}`;
  if (everything.includes(EM_DASH)) bad.push('carries an em dash, which nothing a reader sees may');

  return bad;
}

/** Everything wrong with one tag page. `posts` is every post carrying that tag. */
export function tagViolations(tag: BlogTag, posts: readonly BlogPost[]): string[] {
  const bad: string[] = [];
  if (!SLUG.test(tag.slug)) bad.push(`its address "${tag.slug}" is not a plain lower-case slug`);
  if (!tag.title.trim()) bad.push('has no title');
  if (tag.blurb.length < TAG_BLURB_FLOOR) {
    bad.push(
      `says ${tag.blurb.length} characters about itself, under ${TAG_BLURB_FLOOR}: a tag page needs words of its own, not a list of post titles`,
    );
  }
  if (posts.length < TAG_POST_FLOOR) {
    bad.push(
      `has ${posts.length} posts under it, under ${TAG_POST_FLOOR}: a tag with one post is that post at a second address`,
    );
  }
  if (`${tag.title} ${tag.blurb}`.includes(EM_DASH)) bad.push('carries an em dash');
  return bad;
}

/** Everything wrong with the blog as a whole: the things only visible across the set. */
export function blogViolations(doc: BlogDoc): string[] {
  const bad: string[] = [];
  if (doc.posts.length === 0) bad.push('the blog has no posts, so there is nothing to publish');
  if (!doc.blurb.trim()) bad.push('the blog says nothing about itself');
  if (!doc.note.trim()) bad.push('the blog has no assistance note for the posts that need one');

  const seen = <T>(values: readonly T[]): T[] => {
    const once = new Set<T>();
    const twice = new Set<T>();
    for (const value of values) {
      if (once.has(value)) twice.add(value);
      once.add(value);
    }
    return [...twice];
  };
  for (const slug of seen(doc.posts.map((post) => post.slug))) {
    bad.push(`two posts claim the address ${postPath(slug)}`);
  }
  for (const title of seen(doc.posts.map((post) => post.title))) {
    bad.push(`two posts carry the title "${title}"`);
  }
  for (const summary of seen(doc.posts.map((post) => post.summary))) {
    bad.push(`two posts share one summary, so they would share one search result: "${summary}"`);
  }
  return bad;
}

// --- what the pages read ---------------------------------------------------------------------------

export function findPost(doc: BlogDoc, slug: string): BlogPost | null {
  return doc.posts.find((post) => post.slug === slug) ?? null;
}

export function findTag(doc: BlogDoc, slug: string): BlogTag | null {
  return doc.tags.find((tag) => tag.slug === slug) ?? null;
}

export function findAuthor(doc: BlogDoc, key: string): BlogAuthor | null {
  return doc.authors.find((author) => author.key === key) ?? null;
}

/** Every post carrying a tag, newest first. */
export function postsWithTag(doc: BlogDoc, slug: string): BlogPost[] {
  return doc.posts
    .filter((post) => post.tags.includes(slug))
    .sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
}

/** The tags a post carries, resolved to the registry and in the registry's order. */
export function tagsOf(doc: BlogDoc, post: BlogPost): BlogTag[] {
  return doc.tags.filter((tag) => post.tags.includes(tag.slug));
}

/**
 * The byline. A named person where the owner has named one; the desk where they have not, because
 * a name nobody decided would be a name somebody invented (docs/copy/voice.md §8.1).
 */
export function byline(author: BlogAuthor): string {
  return author.name ? `${author.name}, ${author.role} at Wobo` : `the ${author.role} at Wobo`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A date the way a person reads one in India: 9 September 2026. No em dash, no ordinal. */
export function formatDate(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split('-') as [string, string, string];
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

// --- the origin everything syndicates from ---------------------------------------------------------

function origin(raw: string): string {
  return raw.replace(/\/+$/, '');
}

export function postUrl(base: string, post: BlogPost): string {
  return `${origin(base)}${postPath(post.slug)}`;
}

export function tagUrl(base: string, tag: BlogTag): string {
  return `${origin(base)}${tagPath(tag.slug)}`;
}

/**
 * Structured data, escaped so it can sit inside a `<script>` in the body of a pre-rendered page.
 * `<`, `>` and `&` become their escapes, so a closing tag inside a string can never end the script.
 */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

const PUBLISHER = {
  '@type': 'Organization',
  name: 'Wobo',
  url: 'https://heywobo.com',
};

function authorNode(doc: BlogDoc, post: BlogPost): Record<string, unknown> {
  const author = findAuthor(doc, post.author);
  if (author?.name) return { '@type': 'Person', name: author.name };
  // No name has been decided, so the honest structured author is the organisation that stands
  // behind the page. Inventing a Person here would be inventing a person.
  return { '@type': 'Organization', name: 'Wobo', description: author?.about ?? '' };
}

export function postJsonLd(base: string, doc: BlogDoc, post: BlogPost): Record<string, unknown> {
  const url = postUrl(base, post);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.summary,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: post.published,
    dateModified: post.updated ?? post.published,
    author: authorNode(doc, post),
    publisher: { ...PUBLISHER, url: origin(base) },
    inLanguage: 'en-IN',
    wordCount: post.words,
    keywords: tagsOf(doc, post).map((tag) => tag.title),
    isAccessibleForFree: true,
  };
}

export function blogJsonLd(base: string, doc: BlogDoc): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: doc.title,
    description: doc.blurb,
    url: `${origin(base)}${BLOG_PATH}`,
    inLanguage: 'en-IN',
    publisher: { ...PUBLISHER, url: origin(base) },
    blogPost: doc.posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      url: postUrl(base, post),
      datePublished: post.published,
    })),
  };
}

export function tagJsonLd(base: string, doc: BlogDoc, tag: BlogTag): Record<string, unknown> {
  const posts = postsWithTag(doc, tag.slug);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: tag.title,
    description: tag.blurb,
    url: tagUrl(base, tag),
    inLanguage: 'en-IN',
    isPartOf: { '@type': 'Blog', name: doc.title, url: `${origin(base)}${BLOG_PATH}` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: posts.length,
      itemListElement: posts.map((post, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: postUrl(base, post),
        name: post.title,
      })),
    },
  };
}

/** Where a page sits, for the crumb an engine reads rather than the one a person clicks. */
export function breadcrumbJsonLd(
  base: string,
  trail: readonly { name: string; path: string }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: `${origin(base)}${step.path}`,
    })),
  };
}

// --- the feed --------------------------------------------------------------------------------------

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] as string);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));

/** A date as a feed reader expects it. Midnight UTC: a post has a day, not an hour. */
export function rfc822(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[date.getUTCDay()]}, ${pad(d)} ${SHORT_MONTHS[m - 1]} ${y} 00:00:00 +0000`;
}

/** Newest first, the way every reader shows a feed. */
export function newestFirst(posts: readonly BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.published < b.published ? 1 : a.published > b.published ? -1 : 0,
  );
}

/**
 * The feed, RSS 2.0 with the Atom self link every validator asks for.
 *
 * The item's description is the post's own summary and never the whole post: the blog is the
 * origin, and a feed that carries the full text invites a scraper to become the copy that ranks
 * (docs/GROWTH-DESK.md §3).
 */
export function feedXml(base: string, doc: BlogDoc): string {
  const site = origin(base);
  const items = newestFirst(doc.posts).map((post) =>
    [
      '    <item>',
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${escapeXml(postUrl(site, post))}</link>`,
      `      <guid isPermaLink="true">${escapeXml(postUrl(site, post))}</guid>`,
      `      <pubDate>${rfc822(post.published)}</pubDate>`,
      `      <description>${escapeXml(post.summary)}</description>`,
      ...tagsOf(doc, post).map((tag) => `      <category>${escapeXml(tag.title)}</category>`),
      '    </item>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generated from docs/copy/blog/** by src/screens/site/blog/compile.ts. Do not edit by hand. -->',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(doc.title)}</title>`,
    `    <link>${escapeXml(`${site}${BLOG_PATH}`)}</link>`,
    `    <description>${escapeXml(doc.blurb)}</description>`,
    '    <language>en-in</language>',
    `    <atom:link href="${escapeXml(`${site}${FEED_PATH}`)}" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
