/**
 * TIER TWO OF THE CHAPTER PAGES, AS THE SITE READS IT.
 *
 * Tier one is the chapter, its topics, its provenance and the tutor door: honest, plain, and live
 * on 86 addresses (2026-09-17: a chapter needs three topics and fifteen words of its own). Tier
 * two adds the thing nobody else in this market ships on a chapter page at all
 * (docs/GROWTH-SEARCH.md §1, §6). It lands only on a chapter that already has a page, and today
 * it lands on none: no concept core is in the cache the freezer reads, so `explained.json` holds
 * no chapter. What it adds:
 *
 *   · **the concept's own explanation**, in the words the concept core holds. The same core a
 *     learner's lesson is rendered from, shown plainly, rather than a paragraph written at a
 *     search engine;
 *   · **an original figure**, drawn for that concept by the same pipeline that draws for a
 *     learner, carrying `ImageObject` markup (`shell/jsonld.ts`);
 *   · **three questions**, taken word for word out of the concept's own check and its own two
 *     misconceptions.
 *
 * WHERE IT COMES FROM, and why it is a file. `explained.json` is frozen by
 * `wobo_gateway.curriculum.explained` from the same cache a learner's lesson is rendered from, at
 * a pace a person sets and reviews. That is the same discipline `syllabus.json` lives under and
 * for the same reason: the site is BUILT, so a page that read this over the network would ship
 * empty the first time a service was slow. A visitor pays nothing for any of it.
 *
 * THE RULE THIS MODULE EXISTS TO KEEP. A chapter with no entry in that file renders exactly as it
 * does today, and says nothing about an explanation it does not have. There is no half state: an
 * entry missing any of its parts is dropped here rather than rendered with a gap, because a figure
 * with no explanation beside it, or a question with no answer under it, is a page implying
 * something it cannot deliver. `a tier one page never implies it has an explanation it does not
 * have` is the ruling (§6), and :func:`readExplained` is where it is enforced.
 *
 * NOTHING HERE IS WRITTEN. Every string a reader sees in this block came out of the concept core
 * or off the board's own syllabus. The only words this file's family adds are the two labels in
 * `copy.ts`, which every tier two page shares and which are therefore counted as frame rather
 * than as a page's own words (`pages.ts`).
 */

import { absoluteUrl, BRAND_NAME, DEFAULT_ORIGIN, normaliseOrigin } from '../../shell/head';
import file from './explained.json';
import { type Place, pathOf } from './tree';

/** The shape this module knows how to read. A file written to another shape is not guessed at. */
export const SHAPE = 1;

/** Where the figures answer. The path they were written to under `public/`, one spelling. */
export const FIGURES_URL = '/learn/figures';

/** One question, and the answer the core itself gives it. */
export interface Question {
  q: string;
  a: string;
}

/** The drawn figure: a real file, with its own size so the page can hold its space. */
export interface Figure {
  /** The file name under {@link FIGURES_URL}. */
  file: string;
  width: number;
  height: number;
  /** The board's own name for the topic. Never a description of the drawing nobody has read. */
  alt: string;
}

/** What one chapter page carries at tier two. */
export interface Explained {
  /** The chapter page's address, exactly as `pages.ts` publishes it. */
  path: string;
  /** The board's own slug for the topic this explains. One of that chapter's own topics. */
  topic: string;
  /** The board's own name for it. */
  name: string;
  /** The concept id the core is filed under, board-agnostic. */
  concept: string;
  /** The depth band the core was written for (docs/CONTENT-INTERACTION.md §5b). */
  band: string;
  /** The idea, in the core's own paragraph. */
  idea: string;
  /** Why it matters, in the core's own sentence. */
  why: string;
  /** Exactly three. Fewer is not a set, and more is a page nobody reads to the end. */
  questions: readonly Question[];
  figure: Figure;
}

interface RawFile {
  shape?: number;
  stamp?: string;
  written?: string;
  chapters?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function question(value: unknown): Question | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const q = text(row.q);
  const a = text(row.a);
  return q && a ? { q, a } : null;
}

function figure(value: unknown): Figure | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const name = text(row.file);
  const width = typeof row.width === 'number' ? row.width : 0;
  const height = typeof row.height === 'number' ? row.height : 0;
  const alt = text(row.alt);
  // A figure with no size cannot have its space reserved, so it would push the page down as it
  // loads. A figure with no name is not a file. Either way there is no figure.
  if (!name || !alt || width <= 0 || height <= 0) return null;
  if (!/^[a-z0-9][a-z0-9-]*--[0-9a-f]{6,}\.svg$/.test(name)) return null;
  return { file: name, width, height, alt };
}

/**
 * Every complete record in a raw file, in the order it holds them. Anything short of complete is
 * dropped: this is the one place the no-half-state rule is enforced, and it is enforced by
 * throwing away rather than by patching, because there is nothing honest to patch a missing
 * explanation with.
 */
export function readExplained(raw: unknown): Explained[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as RawFile;
  if (data.shape !== SHAPE) return [];
  const rows = Array.isArray(data.chapters) ? data.chapters : [];
  const out: Explained[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const path = text(entry.path);
    const idea = text(entry.idea);
    const why = text(entry.why);
    const name = text(entry.name);
    const topic = text(entry.topic);
    const concept = text(entry.concept);
    const band = text(entry.band);
    const art = figure(entry.figure);
    const asked = (Array.isArray(entry.questions) ? entry.questions : []).map(question);
    if (!path || !idea || !why || !name || !topic || !concept || !band || !art) continue;
    if (asked.length !== 3 || asked.some((item) => item === null)) continue;
    // One chapter, one explanation. Two entries for one address is a file that was edited by
    // hand, and there is no way to choose between them that is better than refusing both.
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      topic,
      name,
      concept,
      band,
      idea,
      why,
      questions: asked as Question[],
      figure: art,
    });
  }
  return out;
}

// --- the depth band ------------------------------------------------------------------------------

/**
 * The depth bands, and the classes in each (docs/CONTENT-INTERACTION.md §5b). The same table
 * `wobo_gateway.curriculum.explained.BANDS` holds, read again here so a record carried to the wrong
 * class by a hand edit is refused on the page as well as at the freezer.
 */
export const BANDS: readonly (readonly [string, number, number])[] = [
  ['foundation', 1, 5],
  ['middle', 6, 8],
  ['senior', 9, 12],
];

/** The band a class sits in, or null where its name carries no number. Never a guess. */
export function bandOf(levelName: string): string | null {
  const found = /(\d{1,2})/.exec(levelName ?? '');
  if (!found) return null;
  const number = Number(found[1]);
  for (const [name, low, high] of BANDS) {
    if (number >= low && number <= high) return name;
  }
  return null;
}

let cached: readonly Explained[] | null = null;

/** Every chapter page that carries tier two in this build. */
export function explainedPages(): readonly Explained[] {
  cached ??= readExplained(file);
  return cached;
}

/** The record filed under one address, before it is checked against the page it would sit on. */
export function explainedFor(path: string): Explained | null {
  return explainedPages().find((entry) => entry.path === path) ?? null;
}

/**
 * WHAT ONE PAGE CARRIES AT TIER TWO, or null where it carries nothing, checked against the page.
 *
 * A record is shown only where all of these hold, and each is a way a page could otherwise claim
 * something it does not have:
 *
 *  · the page is a CHAPTER. The family's other layers never carry an explanation;
 *  · the chapter has topics, and the record explains ONE OF THEM. ICSE and ISC give us a unit and
 *    nothing under it, so there is no topic of theirs to explain and nothing is invented for them
 *    (docs/GROWTH-SEARCH.md §3);
 *  · the record was written for the band the page's class sits in (docs/CONTENT-INTERACTION.md
 *    §5b). A core for class 7 is not an explanation of the class 10 chapter of the same name.
 */
export function explanationFor(place: Place): Explained | null {
  if (place.kind !== 'chapter') return null;
  const topics = place.node.children;
  if (topics.length === 0) return null;
  const entry = explainedFor(pathOf(place));
  if (!entry) return null;
  if (!topics.some((topic) => topic.slug === entry.topic)) return null;
  const band = bandOf(place.level?.name ?? '');
  if (!band || band !== entry.band) return null;
  return entry;
}

/** The fragment the site's one Organization is declared under (`shell/jsonld.ts`, ORG_FRAGMENT). */
export const ORG_REF = '#organization';

/**
 * THE FIGURE, AS A MACHINE READS IT: one `ImageObject`, naming the same file the page shows.
 *
 * No competitor in this market ships image markup on a chapter page (docs/GROWTH-SEARCH.md §1).
 * It says what is true and nothing more: the address, the size, the format, the board's own name
 * for the topic, and that Wobo made it. No licence is declared, because none has been decided,
 * and a licence field is a promise to anyone who reads it.
 */
export function figureLd(entry: Explained, origin: string): Record<string, unknown> {
  const page = absoluteUrl(origin, entry.path);
  const src = absoluteUrl(origin, figureSrc(entry.figure));
  const site = absoluteUrl(origin, '/');
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    '@id': `${page}#figure`,
    contentUrl: src,
    url: src,
    name: entry.figure.alt,
    width: entry.figure.width,
    height: entry.figure.height,
    encodingFormat: 'image/svg+xml',
    representativeOfPage: true,
    creditText: BRAND_NAME,
    creator: { '@id': `${site}${ORG_REF}` },
    copyrightHolder: { '@id': `${site}${ORG_REF}` },
  };
}

/** The address one figure answers at. One spelling, so the page and its markup cannot disagree. */
export function figureSrc(art: Figure): string {
  return `${FIGURES_URL}/${art.file}`;
}

/** The origin this build writes absolute addresses at, read the way `canonicalUrl` reads it. */
export function buildOrigin(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return normaliseOrigin(env.VITE_APP_URL ?? DEFAULT_ORIGIN);
}

/**
 * The figure's markup as the body of its script element. `<`, `>` and `&` are escaped, so no
 * string a core ever holds can close the element it sits in (the rule `shell/jsonld.ts` keeps).
 */
export function figureScript(entry: Explained, origin: string = buildOrigin()): string {
  return JSON.stringify(figureLd(entry, origin))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Test seam: forget the parsed file, or read a fixture in its place. The fixture goes through
 * the same reader, so a test cannot show a page a record the build would have dropped.
 */
export function reset(raw?: unknown): void {
  cached = raw === undefined ? null : readExplained(raw);
}
