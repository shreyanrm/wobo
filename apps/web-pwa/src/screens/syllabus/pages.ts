/**
 * WHICH SYLLABUS PAGES MAY BE PUBLISHED, AND WHAT EACH ONE SAYS ABOUT ITSELF.
 *
 * This is the quality gate the page family owes the rest of the site. Google's own rule is that
 * generating many pages "without adding value for users" is spam, and the honest-count law
 * (WOBO-TASKS §10.21) says the count we publish is the count we can prove. So no page reaches the
 * sitemap, the pre-renderer or an internal link on the strength of existing. It reaches them by
 * passing :func:`gate`, and a page that fails is simply not published: not listed, not linked, not
 * counted. There is no "publish it thin and improve it later" path in here on purpose.
 *
 * What the gate asks of a page, and why each one:
 *
 *  1. **A source document, with a hash.** This is the whole reason the family is legitimate. A page
 *     that cannot say which official document its chapter came from carries nothing a decayed
 *     content farm does not already carry, so it does not ship (docs/GROWTH-SEARCH.md §3).
 *  2. **Real words, counted.** Not a floor invented to be cleared: :data:`FLOOR` is set below what
 *     the THINNEST honest page in the family actually renders (an ICSE unit with no topic list
 *     under it), so it catches a page that has lost its content rather than one that never had
 *     much. `pages.test.ts` prints the real minimum against it.
 *  3. **Its own title and its own heading.** 1,111 pages, and no two may read the same in a tab or
 *     in a result. Two pages with one title are one page as far as an engine is concerned.
 *
 * `publishedPages()` is the one list. The sitemap, the pre-render list and any internal index all
 * read it, so a page cannot be promised in one place and missing in another.
 */

import { countWords } from '../../shell/head';
import { addressPath, hubPath } from './address';
import {
  ask,
  checksLine,
  childrenLabel,
  description,
  distinctName,
  fingerprintLine,
  heading,
  headingLine,
  hubAsk,
  hubDescription,
  hubHeading,
  hubSummary,
  hubTail,
  hubTitle,
  linkNote,
  linkText,
  NO_TOPICS,
  OURS_LINE,
  provenance,
  QUESTIONS_LABEL,
  summary,
  title,
} from './copy';
import { explanationFor } from './explained';
import { handmade } from './handmade';
import {
  boards,
  find,
  type Layer,
  OWN_TOPIC_FLOOR,
  OWN_WORD_FLOOR,
  ownChildren,
  type Place,
  PUBLISHED_LAYERS,
  pathOf,
  subjects,
} from './tree';

/**
 * The word floor for the WHOLE page. An ICSE unit page with no topic list is the thinnest page the
 * family can honestly produce, and it renders comfortably above this; anything under it has lost
 * something.
 */
export const FLOOR = 70;

/**
 * AND THE FLOOR FOR THE PAGE'S OWN WORDS, which is the one with teeth, and the one that was a
 * decoration until it was rewritten.
 *
 * The first version of this counted every string the page rendered and called the total its own.
 * That is not a gate. A page wears about sixty words of shared frame before it says anything at
 * all, and on the 152 pages a board gave us as a unit with nothing under it, the frame included a
 * standing sentence about the missing topic list that is IDENTICAL on all 152. Counted as the
 * page's own words, one constant string carried a page over the floor 152 times, which is exactly
 * the failure the gate exists to catch.
 *
 * So `ownProse` now hands back only what came from this node's own DATA: the name the board gave
 * it, the names of what it holds, the section of the document it was read from, and, on the
 * sixty-seven pages that have one, the paragraph somebody wrote for that address. The composed
 * sentence, the placement line, the section label and the "four topics" note are all rendered and
 * none of them are counted, because a sibling page renders them too. `pages.test.ts` proves the
 * point directly: no two sibling pages share a counted word run.
 */
export const OWN_FLOOR = OWN_WORD_FLOOR;

/** One publishable page, and everything the build needs to know about it. */
export interface Page {
  path: string;
  layer: Layer | 'hub';
  title: string;
  description: string;
  /** The heading text, both halves, as the `<h1>` renders it. Unique across the family. */
  heading: string;
  /** How many words a reader finds on it, counted from the copy the template actually shows. */
  words: number;
  /** How many of those are the page's OWN, with the frame every page shares taken out. */
  ownWords: number;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
}

/** Why a page was refused. Empty means it passed. */
export type Refusal =
  | 'no_source'
  | 'no_hash'
  | 'nothing_of_its_own'
  | 'too_few_topics'
  | 'too_thin'
  | 'shared_title'
  | 'shared_heading';

// --- what a reader actually finds on a page -----------------------------------------------------------

/**
 * THE PAGE'S OWN WORDS: what came off this node and nothing that came off the template.
 *
 * Four things qualify, and the test of each is that a sibling page cannot be carrying it too:
 *
 *   · the name the BOARD gave this node, as the heading prints it;
 *   · the names of what it holds, which is the chapter's topics or the subject's chapters;
 *   · where inside the document it was read from, which is "page 10, Class X, section 7" and is
 *     different on every one of them;
 *   · on the sixty-seven pages somebody lands on while deciding, the opening, the question and the
 *     answer written for that one address (`handmade.ts`).
 *
 * What is deliberately NOT counted, though all of it is rendered: the placement line under the
 * name (every chapter of one subject shares it), the composed summary sentence (its facts are the
 * names and the counts, which are counted once already), the label over the list, the "four
 * topics" note under a link, and the standing sentence a board's missing topic list gets.
 */
export function ownProse(place: Place): string[] {
  const words: string[] = [distinctName(place.node, place.siblings, place.index)];
  const written = handmade(pathOf(place));
  if (written) words.push(written.opening, written.question, written.answer);
  // A child that only repeats this page's name says nothing the name did not, and the section of
  // the document is a page reference rather than words about the subject: both are rendered, and
  // neither is counted as the page's own (`ownNameWords` in `tree.ts` says the same).
  const own = new Set(ownChildren(place.node));
  place.node.children.forEach((child, at) => {
    if (own.has(child)) words.push(linkText(child, place.node.children, at));
  });
  // TIER TWO, where the chapter has it: the core's own paragraph, its reason, and its three
  // questions with their answers. All of it came off this concept's data and none of it is worn
  // by a sibling page, so it is the page's own. The topic's name is already counted above as one
  // of the chapter's topics and is not counted twice.
  const explained = explanationFor(place);
  if (explained) {
    words.push(explained.idea, explained.why);
    for (const asked of explained.questions) words.push(asked.q, asked.a);
  }
  return words;
}

/** Every word the template actually puts in front of a reader, in the order the page says them. */
export function pageProse(place: Place): string[] {
  const head = heading(place);
  const words: string[] = [headingLine(head), summary(place), ...ownProse(place).slice(1)];
  // Rendered, and so read, though not the page's own: a child named as the page, and the section.
  const own = new Set(ownChildren(place.node));
  place.node.children.forEach((child, at) => {
    if (!own.has(child)) words.push(linkText(child, place.node.children, at));
  });
  const section = place.node.source?.section;
  if (section) words.push(section);
  if (place.kind === 'chapter' && place.node.children.length === 0) words.push(NO_TOPICS);
  if (place.node.children.length > 0) {
    words.push(childrenLabel(place.kind, place.node));
    for (const child of place.node.children) {
      const note = linkNote(child);
      if (note) words.push(note);
    }
  }
  // The two labels a tier two block wears are rendered and counted here, never as the page's own.
  if (explanationFor(place)) words.push(QUESTIONS_LABEL);
  words.push(provenance(place.node.source, place.board));
  const checks = checksLine(place.node.source);
  if (checks) words.push(checks);
  const fingerprint = fingerprintLine(place.node.source);
  if (fingerprint) words.push(fingerprint);
  if (explanationFor(place)) words.push(OURS_LINE);
  const door = ask(place);
  words.push(door.heading, door.placeholder, ...door.chips);
  return words;
}

function hubProse(slug: string): string[] {
  const hub = subjects().find((entry) => entry.slug === slug);
  if (!hub) return [];
  const head = hubHeading(hub);
  const door = hubAsk(hub);
  return [
    head.name,
    head.where,
    hubSummary(hub),
    // What the page actually renders per board: the board's own short name, its honest status
    // label, and each class it is taught in with the chapters counted.
    ...[...new Map(hub.places.map((row) => [row.board.slug, row.board])).values()].flatMap(
      (board) => [board.short, board.label],
    ),
    ...hub.places.map((row) => `${row.level.name} ${linkNote(row.subject) ?? ''}`),
    door.heading,
    door.placeholder,
    ...door.chips,
    hubTail(hub),
  ];
}

// --- the gate --------------------------------------------------------------------------------------

/** What a page is refused for, if anything. A page with no reasons may be published. */
export function gate(place: Place): Refusal[] {
  const out: Refusal[] = [];
  const source = place.node.source;
  if (!source?.url) out.push('no_source');
  if (!source?.hash) out.push('no_hash');
  // The 152 units two boards publish with no topic list under them. Everything on such a page
  // except its own name is a string its 151 brothers and sisters render word for word, which is
  // the shape the honest-count law calls a page we cannot prove (WOBO-TASKS §10.21).
  if (place.kind === 'chapter' && place.node.children.length === 0) out.push('nothing_of_its_own');
  else if (place.kind === 'chapter' && ownChildren(place.node).length < OWN_TOPIC_FLOOR) {
    out.push('too_few_topics');
  }
  if (countWords(pageProse(place).join(' ')) < FLOOR) out.push('too_thin');
  else if (countWords(ownProse(place).join(' ')) < OWN_FLOOR) out.push('too_thin');
  return out;
}

// --- how often each layer changes, and how much it matters ---------------------------------------------

const RHYTHM: Record<Layer | 'hub', { changefreq: Page['changefreq']; priority: string }> = {
  // A syllabus changes when a board publishes an edition, which is once a year, and the pages that
  // matter most are the ones somebody is looking for: the chapter, then the subject.
  board: { changefreq: 'monthly', priority: '0.7' },
  class: { changefreq: 'monthly', priority: '0.7' },
  subject: { changefreq: 'monthly', priority: '0.8' },
  chapter: { changefreq: 'monthly', priority: '0.9' },
  topic: { changefreq: 'monthly', priority: '0.6' },
  hub: { changefreq: 'monthly', priority: '0.7' },
};

// --- the list -----------------------------------------------------------------------------------------

function pageFor(place: Place): Page | null {
  if (gate(place).length > 0) return null;
  const head = heading(place);
  const rhythm = RHYTHM[place.kind];
  return {
    path: addressPath({
      board: place.board.slug,
      ...(place.level ? { level: place.level.slug } : {}),
      ...(place.subject ? { subject: place.subject.slug } : {}),
      ...(place.chapter ? { chapter: place.chapter.slug } : {}),
      ...(place.topic ? { topic: place.topic.slug } : {}),
    }),
    layer: place.kind,
    title: title(place),
    description: description(place),
    heading: headingLine(head),
    words: countWords(pageProse(place).join(' ')),
    ownWords: countWords(ownProse(place).join(' ')),
    ...rhythm,
  };
}

/**
 * Every page in the family that passes the gate, outermost first, then in the board's own order.
 * The order is the order a reader would walk it, which is also the order that makes the sitemap
 * diff readable when a board publishes a new edition.
 */
export function publishedPages(): Page[] {
  const out: Page[] = [];
  const all = boards();
  const at = (address: Parameters<typeof find>[0]): void => {
    const place = find(address, all);
    if (!place) return;
    const page = pageFor(place);
    if (page) out.push(page);
  };
  for (const board of all) {
    at({ board: board.slug });
    for (const level of board.children) {
      at({ board: board.slug, level: level.slug });
      for (const subject of level.children) {
        at({ board: board.slug, level: level.slug, subject: subject.slug });
        for (const chapter of subject.children) {
          const seat = { board: board.slug, level: level.slug, subject: subject.slug };
          at({ ...seat, chapter: chapter.slug });
          for (const topic of chapter.children) {
            at({ ...seat, chapter: chapter.slug, topic: topic.slug });
          }
        }
      }
    }
  }
  for (const hub of subjects(all)) {
    const head = hubHeading(hub);
    const words = countWords(hubProse(hub.slug).join(' '));
    if (words < FLOOR) continue;
    out.push({
      path: hubPath(hub.slug),
      layer: 'hub',
      title: hubTitle(hub),
      description: hubDescription(hub),
      heading: headingLine(head),
      words,
      ownWords: words,
      ...RHYTHM.hub,
    });
  }
  return out;
}

/**
 * WHICH LAYERS ARE PUBLISHED IN THIS BUILD, and why it is not simply "all of them".
 *
 * docs/GROWTH-SEARCH.md §4 sets the order of work and the pace: the pages above the chapters
 * today, then "the chapter pages at tier 1, 333 of them, at a measured pace behind a quality gate",
 * and the topic pages "with tier 2" — that is, when the concept cores land and a page in that
 * family carries a drawn explanation as well as a name. So the topic pages are BUILT and they
 * answer at their addresses, and they are not put in the sitemap yet: a family of 711 pages
 * announced before it has anything but a name on it is the thin-page mistake the whole plan is
 * written to avoid.
 *
 * `WOBO_SYLLABUS_LAYERS` overrides it (a comma-separated list of layer names, or `all`), so the
 * pace is a build-time decision and not a code change.
 */
export const RELEASED: readonly (Layer | 'hub')[] = PUBLISHED_LAYERS;

export function releasedLayers(
  env: Record<string, string | undefined> = {},
): readonly (Layer | 'hub')[] {
  const raw = (env.WOBO_SYLLABUS_LAYERS ?? '').trim();
  if (!raw) return RELEASED;
  if (raw === 'all') return ['board', 'class', 'subject', 'chapter', 'topic', 'hub'];
  if (raw === 'none') return [];
  const wanted = new Set(raw.split(',').map((name) => name.trim()));
  return (['board', 'class', 'subject', 'chapter', 'topic', 'hub'] as const).filter((layer) =>
    wanted.has(layer),
  );
}

/** The pages this build publishes: the gate's list, cut to the layers released. */
export function releasedPages(env: Record<string, string | undefined> = {}): Page[] {
  const layers = new Set(releasedLayers(env));
  return publishedPages().filter((page) => layers.has(page.layer));
}

/**
 * Any title, heading or description two pages share. Empty is the only acceptable answer: two pages
 * that read the same in a tab or in a result are one page as far as an engine is concerned, and
 * `scripts/prerender-check.ts` fails the build over exactly this.
 *
 * The DESCRIPTION is here for a reason worth writing down. The build does not use the description
 * this module computes: it reads the page's own opening words back off the render. So a lead that
 * two pages share is a description two pages share, whatever this function says, which is why the
 * lead sentence and the description are the same sentence (`copy.summary`).
 */
export function collisions(pages: readonly Page[] = publishedPages()): {
  titles: string[];
  headings: string[];
  descriptions: string[];
} {
  const shared = (values: string[]): string[] => {
    const seen = new Map<string, number>();
    for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([value]) => value);
  };
  return {
    titles: shared(pages.map((page) => page.title)),
    headings: shared(pages.map((page) => page.heading)),
    descriptions: shared(pages.map((page) => page.description)),
  };
}

/** How many pages the family publishes, by layer. The count we are allowed to print anywhere. */
export function published(pages: readonly Page[] = publishedPages()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const page of pages) out[page.layer] = (out[page.layer] ?? 0) + 1;
  out.total = pages.length;
  return out;
}
