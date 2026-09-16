/**
 * THE SYLLABUS, AS THE PUBLIC PAGES READ IT.
 *
 * Four boards, thirteen classes, fifty subjects, three hundred and thirty-three chapters and seven
 * hundred and eleven topics, each one carrying the official document it was read from. That
 * provenance is the reason these pages are allowed to exist at all: a page generated at scale is
 * spam unless it adds something a reader cannot get elsewhere, and no competitor in this market
 * publishes where their syllabus came from (docs/GROWTH-SEARCH.md §1, §3).
 *
 * Where the data comes from, and why it is a file rather than a fetch. The gateway opens
 * `GET /v1/syllabus` and `door.ts` reads it, which is what keeps a live page fresh. But the SITE
 * IS BUILT, not served: one real HTML file is pre-rendered per address and the sitemap is
 * generated from the same list. A build that read 1,111 pages over the network would ship 1,111
 * empty pages the first time the gateway was slow, and the count it published would be whatever
 * the network returned. So the tree is frozen into `syllabus.json` by
 * `wobo_gateway.curriculum.snapshot`, through the same `build_tree` the open door uses, from the
 * committed seed. A gateway test re-derives it and fails if the file has drifted.
 *
 * The file interns its provenance records and the lists of check names inside them, because 1,044
 * nodes carry 678 distinct records naming 8 distinct check lists between them. This module is
 * where that is undone, once, lazily, into the plain tree every page walks.
 */

import { addressPath } from './address';
import raw from './syllabus.json';

/** The five layers that become pages, outermost first. */
export type Layer = 'board' | 'class' | 'subject' | 'chapter' | 'topic';

/**
 * THE LAYERS THIS BUILD WRITES A PAGE FOR, and therefore the only layers anything may link to.
 *
 * It lives here rather than beside the gate in `pages.ts` because BOTH sides need it and only one
 * of them may load the gate: `pages.ts` pulls in the whole frozen syllabus and the running app
 * must never import it, while `Syllabus.tsx` renders in the app and has to know which of a node's
 * children are addresses and which are only names. When those two disagreed, the chapter pages
 * linked all 711 topic addresses and the build wrote none of them, so every one of those links
 * answered 200 with the wordless SPA shell (docs/GROWTH-SEARCH.md §4: the topic tier waits on the
 * concept cores). One list now decides both, so they cannot drift apart again.
 */
export const PUBLISHED_LAYERS: readonly (Layer | 'hub')[] = [
  'board',
  'class',
  'subject',
  'chapter',
  'hub',
];

/** Where one node came from. Every field is the gateway's, unchanged. */
export interface Source {
  /** The official document, as a URL a reader can open. */
  url: string | null;
  /** Where inside it — "page 19, Contents". */
  section: string | null;
  /** The hash of the bytes we read, so the claim is checkable. */
  hash: string | null;
  /** When we read those bytes, as an ISO stamp. */
  fetched: string | null;
  /** When the named checks last passed. */
  verified: string | null;
  /** The checks that passed, by name. */
  checks: readonly string[];
}

export interface Node {
  kind: Layer;
  /** The URL segment. Stable, so a page keeps its address. */
  slug: string;
  /** The board's own words for this thing. Never ours. */
  name: string;
  source: Source | null;
  children: readonly Node[];
}

export interface Board extends Node {
  kind: 'board';
  /** The registry's id — `cbse`, `nios`. */
  id: string;
  /** What a person calls it: CBSE, ICSE, ISC, NIOS. */
  short: string;
  /** The honest status line, from the gateway's own labels. Never softened here. */
  label: string;
  /** The edition of the syllabus we hold — "2026-27". */
  edition: string;
  /** `verified` or `provisional`. Nothing else is ever published. */
  status: string;
  /** The board's own site. */
  site: string | null;
  country: string | null;
}

// --- the file's own shape (interned) -------------------------------------------------------------

interface RawSource {
  url: string | null;
  section: string | null;
  hash: string | null;
  fetched: string | null;
  verified: string | null;
  checks: number | null;
}

interface RawNode {
  slug: string;
  name: string;
  src?: number;
  classes?: RawNode[];
  subjects?: RawNode[];
  chapters?: RawNode[];
  topics?: RawNode[];
}

interface RawBoard extends RawNode {
  id: string;
  short: string;
  label: string;
  edition: string;
  status: string;
  site: string | null;
  country: string | null;
}

interface RawFile {
  shape: number;
  stamp: string;
  checks: string[][];
  sources: RawSource[];
  boards: RawBoard[];
}

const FILE = raw as unknown as RawFile;

/** The shape this module knows how to read. A file written to another shape is not guessed at. */
export const SHAPE = 1;

/** The edition mark of the tree in the file — the gateway's own stamp over every published version. */
export const STAMP = FILE.stamp;

const NO_CHECKS: readonly string[] = [];

function source(index: number | undefined): Source | null {
  if (index === undefined) return null;
  const record = FILE.sources[index];
  if (!record) return null;
  const checks = record.checks === null ? NO_CHECKS : (FILE.checks[record.checks] ?? NO_CHECKS);
  return {
    url: record.url,
    section: record.section,
    hash: record.hash,
    fetched: record.fetched,
    verified: record.verified,
    checks,
  };
}

const CHILD_KEY: Record<Layer, keyof RawNode | null> = {
  board: 'classes',
  class: 'subjects',
  subject: 'chapters',
  chapter: 'topics',
  topic: null,
};

/**
 * IS THERE A PAGE AT THIS NODE'S ADDRESS IN THIS BUILD?
 *
 * The layer list above is the first half of the answer and it is not the whole of it, because a
 * layer being released says nothing about whether one particular node has anything on it. Two
 * boards give us a unit and nothing under it, and a page whose only content is its own name in
 * three arrangements is the thin page the whole plan is written to avoid (docs/GROWTH-SEARCH.md
 * §5). So a chapter with no topic list is not a page here, and its name is carried by the SUBJECT
 * page above it, which lists every one of them with the document behind it.
 *
 * `pages.ts` refuses the same nodes through its own gate and `pages.test.ts` holds the two
 * together, so the sitemap, the pre-render list and the links on a rendered page cannot disagree
 * about which addresses exist.
 */
export const OWN_WORD_FLOOR = 15;

/**
 * AND A CHAPTER MUST HOLD THIS MANY TOPICS OF ITS OWN.
 *
 * A topic that carries the chapter's own name adds nothing: "Number System, with one topic in it,
 * Number System" is the chapter's name printed twice, and it cleared the old floor of twelve only
 * because the section of the document it was read from ("page 10, Class X, section 7") was
 * counted as the page's own words. To a reviewer that page is a template with the name swapped.
 * So the section is a locator and not prose, it no longer counts, and a chapter page needs a real
 * contents list: at least three topics whose names are not its own (2026-09-17, 171 chapter pages
 * down to 86).
 */
export const OWN_TOPIC_FLOOR = 3;

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The children that are not the node's own name again. */
export function ownChildren(node: Node): Node[] {
  return node.children.filter((child) => !same(child.name, node.name));
}

/**
 * The words a node contributes that no sibling of it contributes: the board's own name for it and
 * the names of what it holds, less any that only repeat its own name. Not the sentence built
 * around them, not the label over the list, not the note under a link, and not the section of the
 * document it was read from: a sibling renders every one of the first three, and the last is a
 * page reference, which says where a thing is and nothing about what it is.
 */
export function ownNameWords(node: Node): number {
  const parts = [node.name, ...ownChildren(node).map((child) => child.name)];
  return parts
    .join(' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function hasPage(node: Node): boolean {
  if (!PUBLISHED_LAYERS.includes(node.kind)) return false;
  if (!node.source?.url || !node.source.hash) return false;
  // A board, a class and a subject page each carry a paragraph written for that one address
  // (`handmade.ts`), so their own words are never in doubt and the floor has nothing to say.
  if (node.kind !== 'chapter') return true;
  // A chapter the board published as a unit with nothing under it has its own name and no other
  // content at all, however long that name happens to be. Its name is carried by the subject page
  // above, beside the document it came from, and that is where a reader is better served.
  if (node.children.length === 0) return false;
  if (ownChildren(node).length < OWN_TOPIC_FLOOR) return false;
  return ownNameWords(node) >= OWN_WORD_FLOOR;
}

/** What one layer's children are. Exported so a page can ask whether it may link them. */
export const CHILD_KIND: Record<Layer, Layer | null> = {
  board: 'class',
  class: 'subject',
  subject: 'chapter',
  chapter: 'topic',
  topic: null,
};

function expand(node: RawNode, kind: Layer): Node {
  const key = CHILD_KEY[kind];
  const childKind = CHILD_KIND[kind];
  const rows = key && childKind ? ((node[key] as RawNode[] | undefined) ?? []) : [];
  return {
    kind,
    slug: node.slug,
    name: node.name,
    source: source(node.src),
    children: childKind ? rows.map((row) => expand(row, childKind)) : [],
  };
}

let cached: readonly Board[] | null = null;

/** Every board we publish, in slug order. Expanded once and held. */
export function boards(): readonly Board[] {
  if (cached) return cached;
  if (FILE.shape !== SHAPE) {
    // A file from another shape is not half-read. An empty tree publishes nothing, which is the
    // honest failure: no page, rather than a page with holes where the provenance should be.
    cached = [];
    return cached;
  }
  cached = FILE.boards.map((board) => ({
    ...(expand(board, 'board') as Node),
    kind: 'board' as const,
    id: board.id,
    short: board.short,
    label: board.label,
    edition: board.edition,
    status: board.status,
    site: board.site,
    country: board.country,
  }));
  return cached;
}

// --- finding a place in it ------------------------------------------------------------------------

/** The slugs that name one page, outermost first. Every one needs the one above it. */
export interface Address {
  board: string;
  level?: string | undefined;
  subject?: string | undefined;
  chapter?: string | undefined;
  topic?: string | undefined;
}

/**
 * One page's place: the node it is about, and every node above it, so a template can say where the
 * chapter sits and link back up without walking the tree again.
 */
export interface Place {
  kind: Layer;
  board: Board;
  level?: Node;
  subject?: Node;
  chapter?: Node;
  topic?: Node;
  /** The node this page is about — the deepest one named. */
  node: Node;
  /** Its brothers and sisters in order, for the previous and next links. */
  siblings: readonly Node[];
  /** Where it sits among them, zero-based. */
  index: number;
}

/** The address this place lives at. One spelling, so a page and its key cannot drift apart. */
export function pathOf(place: Place): string {
  return addressPath({
    board: place.board.slug,
    ...(place.level ? { level: place.level.slug } : {}),
    ...(place.subject ? { subject: place.subject.slug } : {}),
    ...(place.chapter ? { chapter: place.chapter.slug } : {}),
    ...(place.topic ? { topic: place.topic.slug } : {}),
  });
}

function child(list: readonly Node[], slug: string): Node | undefined {
  return list.find((node) => node.slug === slug);
}

/**
 * The place an address names, or null when we do not hold it. Null is a real 404: a crawler
 * probing a typo has to be told nothing is there rather than handed a page that says nothing.
 */
export function find(address: Address, all: readonly Board[] = boards()): Place | null {
  const board = all.find((entry) => entry.slug === address.board);
  if (!board) return null;
  let place: Place = {
    kind: 'board',
    board,
    node: board,
    siblings: all,
    index: all.indexOf(board),
  };
  const steps: readonly [Layer, string | undefined][] = [
    ['class', address.level],
    ['subject', address.subject],
    ['chapter', address.chapter],
    ['topic', address.topic],
  ];
  for (const [kind, slug] of steps) {
    if (slug === undefined) {
      // A deeper part named without the part above it names a page that cannot exist.
      const deeper = steps.slice(steps.findIndex(([k]) => k === kind) + 1);
      return deeper.some(([, value]) => value !== undefined) ? null : place;
    }
    const siblings = place.node.children;
    const next = child(siblings, slug);
    if (!next) return null;
    place = {
      ...place,
      kind,
      node: next,
      siblings,
      index: siblings.indexOf(next),
      ...(kind === 'class' ? { level: next } : {}),
      ...(kind === 'subject' ? { subject: next } : {}),
      ...(kind === 'chapter' ? { chapter: next } : {}),
      ...(kind === 'topic' ? { topic: next } : {}),
    };
  }
  return place;
}

/** The node before this one among its brothers and sisters, and the one after. */
export function neighbours(place: Place): { before: Node | null; after: Node | null } {
  return {
    before: place.index > 0 ? (place.siblings[place.index - 1] ?? null) : null,
    after: place.index >= 0 ? (place.siblings[place.index + 1] ?? null) : null,
  };
}

// --- the subject hubs -----------------------------------------------------------------------------

/** One subject as it appears across every board that sets it. */
export interface SubjectHub {
  slug: string;
  /** The board's own name for it — every board that sets it uses the same words, or it is two. */
  name: string;
  /** Where it is taught, board by board and class by class, in tree order. */
  places: readonly { board: Board; level: Node; subject: Node }[];
}

let hubs: readonly SubjectHub[] | null = null;

/**
 * Every distinct subject, board-agnostic. Nine of them, and they are the pages somebody lands on
 * having typed the subject and nothing else.
 */
export function subjects(all: readonly Board[] = boards()): readonly SubjectHub[] {
  if (hubs && all === boards()) return hubs;
  const byslug = new Map<string, SubjectHub>();
  for (const board of all) {
    for (const level of board.children) {
      for (const subject of level.children) {
        const found = byslug.get(subject.slug);
        const row = { board, level, subject };
        if (found) (found.places as { board: Board; level: Node; subject: Node }[]).push(row);
        else byslug.set(subject.slug, { slug: subject.slug, name: subject.name, places: [row] });
      }
    }
  }
  const out = [...byslug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  if (all === boards()) hubs = out;
  return out;
}

/** One subject hub by its slug, or null. */
export function subjectHub(slug: string, all: readonly Board[] = boards()): SubjectHub | null {
  return subjects(all).find((hub) => hub.slug === slug) ?? null;
}

/** Test seam: forget the expanded tree and the hubs so a fixture can be read instead. */
export function reset(): void {
  cached = null;
  hubs = null;
}

/** How many nodes there are at each layer. The only count the site is allowed to publish. */
export function counts(all: readonly Board[] = boards()): Record<Layer, number> {
  const out: Record<Layer, number> = { board: 0, class: 0, subject: 0, chapter: 0, topic: 0 };
  for (const board of all) {
    out.board += 1;
    for (const level of board.children) {
      out.class += 1;
      for (const subject of level.children) {
        out.subject += 1;
        for (const chapter of subject.children) {
          out.chapter += 1;
          out.topic += chapter.children.length;
        }
      }
    }
  }
  return out;
}
