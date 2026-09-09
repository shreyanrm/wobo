/**
 * /glossary — one page per concept, board-agnostic, built from the syllabus we have actually read.
 *
 * WHY THIS FAMILY IS BOARD-AGNOSTIC AND THE CHAPTER PAGES ARE NOT. Four boards teach the laws of
 * motion. Each files it under a different chapter, in a different class, in a document of its own,
 * and a learner searching the phrase gets four content-farm pages that each pretend their board is
 * the only one. One page that says where the concept sits on every board we hold, and names the
 * document behind each placement, is a thing that does not exist anywhere in this market. It is
 * also the page that makes our own concept graph legible: the reason a lesson generated for one
 * board serves a learner on another is that these really are the same idea, and this page is that
 * claim, in public, with the sources attached.
 *
 * WHAT SHIPS, AND WHY IT IS 118 AND NOT 3,948. The concept registry holds 3,948 slugs, catalogued
 * across boards we have not read. A page for one of those would be a name and nothing else. So a
 * concept becomes a page only when the SEED — the syllabi whose bytes we hold, hashed and dated —
 * teaches it in two or more distinct places. Two is the floor rather than one for a reason that is
 * about the reader and not about the count: a concept taught in exactly one place has a chapter
 * page, and a glossary page for it would be the same page at a second address, which is precisely
 * the thin duplication the honest-count law exists to stop.
 *
 * TIER ONE IS HONEST ABOUT BEING TIER ONE. There is no drawn explanation on these pages yet, so no
 * line implies one, and `gate.ts` records `drawn: false` rather than being told otherwise. What is
 * here is real: where the concept sits on each board, the board's own objectives for it where the
 * document states them, the document itself with its page and its hash, and a tutor door that
 * answers about it.
 *
 * The data is `data/glossary.json`, compiled from `content/curriculum/syllabi/**` by
 * `content/curriculum/syllabi/tools/build_growth_data.py` and checked by `data.test.ts`, so this
 * module never reads a syllabus itself and cannot invent one.
 */

import glossaryJson from './data/glossary.json';
import type { Evidence, Verdict } from './gate';
import { gate, onDay, shortHash, words } from './gate';

// --- what the compiled file holds ----------------------------------------------------------------

export interface GlossaryDoc {
  id: string;
  title: string;
  publisher: string;
  url: string;
  pages?: number;
  fetchedAt: string;
  sha256: string;
  board: string;
}

export interface Placement {
  /** The board's own name for the chapter or topic. Never ours. */
  name: string;
  kind: 'chapter' | 'topic';
  board: string;
  level: string;
  levelOrder: number;
  subject: string;
  /** The chapter a topic sits under, where this placement is a topic. */
  unit?: string;
  /** The board's own objectives for it, where the document states them. */
  objectives?: string[];
  /** The id of the document in `documents`. */
  doc: string;
  page?: number;
  section?: string;
}

export interface Concept {
  slug: string;
  name: string;
  subjects: string[];
  /** The short names of the boards that teach it, alphabetical. */
  boards: string[];
  places: Placement[];
}

interface GlossaryFile {
  minPlacements: number;
  boards: Record<string, { short: string; name: string }>;
  documents: Record<string, GlossaryDoc>;
  concepts: Concept[];
}

const FILE = glossaryJson as unknown as GlossaryFile;

export const CONCEPTS: readonly Concept[] = FILE.concepts;
export const DOCUMENTS: Readonly<Record<string, GlossaryDoc>> = FILE.documents;
export const BOARDS: Readonly<Record<string, { short: string; name: string }>> = FILE.boards;
export const MIN_PLACEMENTS = FILE.minPlacements;

/** The board's short name, or its id where the compiled file does not know it. */
export function boardShort(id: string): string {
  return BOARDS[id]?.short ?? id;
}

export function conceptBySlug(slug: string): Concept | null {
  return CONCEPTS.find((c) => c.slug === slug) ?? null;
}

// --- the words on a page -------------------------------------------------------------------------

/** One row of the "where it is taught" table, as the page prints it. */
export interface PlaceRow {
  key: string;
  board: string;
  level: string;
  subject: string;
  /** "Chapter" or "Topic", and the name the board gives it. */
  kind: string;
  name: string;
  /** "in Statistics and probability", or empty for a chapter. */
  under: string;
  objectives: string[];
  doc: GlossaryDoc;
  /** "page 7, Unit 7: STATISTICS AND PROBABILITY", or as much of it as the seed holds. */
  where: string;
}

/** One document, as the page prints it in the sources list. */
export interface DocRow {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** "Read on 3 September 2026." */
  read: string;
  /** "Hash of the bytes we read: d773e7c12b99." */
  hash: string;
}

export interface ConceptPage {
  slug: string;
  path: string;
  name: string;
  /** The tab title. */
  title: string;
  /** The head's description, and the line a search result shows. */
  description: string;
  /** Which boards, which subjects, which classes. */
  lead: string;
  /** What this page is and, plainly, what it is not. */
  standing: string;
  placesHeading: string;
  rows: PlaceRow[];
  sourcesHeading: string;
  sourcesLead: string;
  docs: DocRow[];
  askHeading: string;
  askPlaceholder: string;
  askChips: string[];
  evidence: Evidence;
  verdict: Verdict;
}

/** "CBSE, ICSE, ISC and NIOS" — a list a person reads, with no Oxford comma. */
export function listOf(items: readonly string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0] as string;
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/**
 * The classes a concept is taught in, as a LIST and never as a span.
 *
 * "class 9 to class 12" is a range, and a range on a public surface reads as a gate on who may
 * sign up, which the copy law forbids in every form (docs/copy/voice.md §8.2). The classes are
 * named individually, lowest first, which is also the truer statement: a concept taught in class 9
 * and class 12 is not taught in the two classes between them.
 */
export function classesOf(places: readonly Placement[]): string {
  const seen = new Map<number, string>();
  for (const p of places) if (!seen.has(p.levelOrder)) seen.set(p.levelOrder, p.level);
  const ordered = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, level]) => level);
  return listOf(ordered);
}

/**
 * The placements a page actually shows.
 *
 * A board that names a chapter and its only topic the same thing gives us two rows that say the
 * same sentence, and a generated page that repeats itself is the exact texture of a content farm.
 * So a topic filed under a chapter of its own name is dropped: the chapter row above it already
 * carries everything it would have said. An identical row is dropped too, whatever produced it.
 */
export function shownPlaces(places: readonly Placement[]): Placement[] {
  const out: Placement[] = [];
  const seen = new Set<string>();
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const place of places) {
    if (place.unit && same(place.unit, place.name)) continue;
    const key = `${place.board}|${place.level}|${place.subject}|${place.kind}|${place.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

function whereIn(place: Placement): string {
  const parts: string[] = [];
  if (place.page) parts.push(`page ${place.page}`);
  if (place.section) parts.push(place.section);
  return parts.join(', ');
}

/**
 * Everything one concept page says, as data.
 *
 * The component renders this object and nothing else, and the gate counts this object and nothing
 * else, which is what makes the word count a fact about the page rather than a promise about it.
 */
export function conceptPage(concept: Concept): ConceptPage {
  const places = shownPlaces(concept.places);
  const boards = concept.boards;
  const subjects = concept.subjects;
  const classes = classesOf(places);
  const docIds = [...new Set(places.map((p) => p.doc))].filter((id) => DOCUMENTS[id]);
  const docs: DocRow[] = docIds.map((id) => {
    const doc = DOCUMENTS[id] as GlossaryDoc;
    return {
      id,
      title: doc.title,
      publisher: doc.publisher,
      url: doc.url,
      read: `Read on ${onDay(doc.fetchedAt)}.`,
      hash: `Hash of the bytes we read: ${shortHash(doc.sha256)}.`,
    };
  });

  const rows: PlaceRow[] = places.map((place, i) => ({
    key: `${place.board}-${place.levelOrder}-${place.subject}-${i}`,
    board: boardShort(place.board),
    level: place.level,
    subject: place.subject,
    kind: place.kind === 'chapter' ? 'Chapter' : 'Topic',
    name: place.name,
    under: place.unit ? `in ${place.unit}` : '',
    objectives: place.objectives ?? [],
    doc: DOCUMENTS[place.doc] as GlossaryDoc,
    where: whereIn(place),
  }));

  // One board and several is not the same sentence with a number changed. A concept the seed holds
  // on one board only is usually refused by the gate below, but the lead has to read as English
  // either way, or the refusal reads as a bug instead of a decision.
  const lead =
    (boards.length === 1
      ? `${concept.name} is on the ${listOf(boards)} syllabus, which we hold as an official ` +
        `document. It is set in ${listOf(subjects)}, in ${classes}. `
      : `${concept.name} is on the syllabus of ${numberWord(boards.length)} of the boards whose ` +
        `official documents we hold: ${listOf(boards)}. It is set in ${listOf(subjects)}, in ` +
        `${classes}. `) +
    `${boards.length === 1 ? listOf(boards) : 'Each board'} files it under a chapter of its own, ` +
    'and every row below names the document that chapter was read from, the page inside it, and ' +
    'the day we read it.';

  // The honest limit, stated on the page rather than in a report. Two forms are named beside the
  // drawn one, so no line can leave a reader thinking the board is the whole product.
  const standing =
    'This page is a map, not a lesson. It says where ' +
    `${concept.name} sits on each board and where that came from. Wobo explains it on the board, ` +
    'out loud, or as a thing you drag, and none of that is on this page yet. Ask below and Wobo ' +
    'answers about this concept now, with no account.';

  const title = `${concept.name} on ${listOf(boards)} · Wobo`;
  const description =
    `Where ${concept.name} sits on ${listOf(boards)}: the chapter each board files it under, ` +
    `in ${listOf(subjects)}, with the official document, page and date behind every line.`;

  const sourcesLead =
    docs.length === 1
      ? 'One official document, read in full, hashed, and named here so you can check it yourself.'
      : `${capitalise(numberWord(docs.length))} official documents, each read in full, hashed, and ` +
        'named here so you can check them yourself.';

  const page: Omit<ConceptPage, 'evidence' | 'verdict'> = {
    slug: concept.slug,
    path: `/glossary/${concept.slug}`,
    name: concept.name,
    title,
    description,
    lead,
    standing,
    placesHeading: 'Where it is taught',
    rows,
    sourcesHeading: 'Where this came from',
    sourcesLead,
    docs,
    askHeading: `Ask Wobo about ${concept.name}`,
    askPlaceholder: `Explain ${lowerFirst(concept.name)} to me`,
    askChips: [
      `What does ${lowerFirst(concept.name)} cover?`,
      'Which chapter is this in on my board?',
      'Does Wobo follow my school syllabus?',
    ],
  };

  const evidence: Evidence = {
    // One source per row: a row is a placement, and every placement names its own document, page
    // and section. A row whose document is missing never reaches here — the compiler drops it.
    sources: rows.length,
    drawn: false,
    door: true,
    // Only this concept's own words. The standing note and the two headings are the family's
    // furniture and are rendered without being counted (see `gate.ts`).
    words: words(
      page.lead,
      rows.map((r) => [
        r.board,
        r.level,
        r.subject,
        r.kind,
        r.name,
        r.under,
        r.where,
        r.objectives,
      ]),
      page.sourcesLead,
      docs.map((d) => [d.title, d.publisher, d.read, d.hash]),
    ),
  };
  // The family's own floor, on top of the shared gate. The compiler counted placements BEFORE the
  // repeated rows came out (`shownPlaces`), so a concept can arrive here with two placements and
  // show one, and a page showing one placement is the chapter page at a second address.
  const distinct = new Set(places.map((p) => `${p.board}|${p.level}|${p.subject}`)).size;
  const verdict = gate(evidence);
  const because = [...verdict.because];
  if (distinct < MIN_PLACEMENTS) {
    because.push(
      `set in only ${distinct} place once the repeated rows come out, and the floor is ${MIN_PLACEMENTS}`,
    );
  }
  return { ...page, evidence, verdict: { publishable: because.length === 0, because } };
}

/** The concepts that clear the gate, in the order the index lists them. */
export function publishable(): ConceptPage[] {
  return CONCEPTS.map(conceptPage).filter((p) => p.verdict.publishable);
}

/** Every glossary address, for the sitemap. The index first, then one per concept that ships. */
export function glossaryPaths(): string[] {
  return ['/glossary', ...publishable().map((p) => p.path)];
}

// --- the index -----------------------------------------------------------------------------------

export interface IndexGroup {
  subject: string;
  entries: { slug: string; name: string; boards: string; path: string }[];
}

export interface GlossaryIndex {
  title: string;
  description: string;
  heading: string;
  lead: string;
  /** The count line, generated from what actually passed the gate, never typed. */
  count: string;
  groups: IndexGroup[];
  askHeading: string;
  askPlaceholder: string;
  askChips: string[];
  evidence: Evidence;
  verdict: Verdict;
}

export function glossaryIndex(): GlossaryIndex {
  const pages = publishable();
  const bySubject = new Map<string, IndexGroup['entries']>();
  for (const page of pages) {
    const concept = conceptBySlug(page.slug) as Concept;
    // A concept set in two subjects is listed under both: a reader looking for it under physics
    // should not have to know we filed it under science.
    for (const subject of concept.subjects) {
      const list = bySubject.get(subject) ?? [];
      list.push({
        slug: concept.slug,
        name: concept.name,
        boards: listOf(concept.boards),
        path: page.path,
      });
      bySubject.set(subject, list);
    }
  }
  const groups: IndexGroup[] = [...bySubject.entries()]
    .map(([subject, entries]) => ({
      subject,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const boardNames = listOf(Object.values(BOARDS).map((b) => b.short));
  const heading = 'The glossary';
  const lead =
    'One page per idea, not one page per board. Every entry here is set by at least two of the ' +
    `boards whose official syllabus we hold, so a page says where the idea sits on ${boardNames} ` +
    'at once, and names the document behind each placement. Nothing on these pages was written ' +
    'from memory.';
  const count =
    `${pages.length} ideas so far. It is the number that passed the check, not the number we ` +
    'could generate an address for: an idea set in only one place already has its chapter, and a ' +
    'second page for it would say the same thing twice.';

  const evidence: Evidence = {
    sources: pages.length,
    drawn: false,
    door: true,
    // An index has no siblings, so nothing on it is shared furniture and all of it counts.
    words: words(
      heading,
      lead,
      count,
      groups.map((g) => [g.subject, g.entries.map((e) => [e.name, e.boards])]),
    ),
  };
  return {
    title: 'Glossary · Wobo',
    description:
      `Every idea set by two or more of ${boardNames}, with the chapter each board files it ` +
      'under and the official document behind every line.',
    heading,
    lead,
    count,
    groups,
    askHeading: 'Ask Wobo about any of them',
    askPlaceholder: 'What is the difference between speed and velocity?',
    askChips: [
      'Where does the syllabus come from?',
      'Do two boards teach this the same way?',
      'Does Wobo follow my school syllabus?',
    ],
    evidence,
    verdict: gate(evidence),
  };
}

// --- small words ---------------------------------------------------------------------------------

const NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

/** Words for the small numbers, digits above ten (docs/copy/voice.md §3). */
export function numberWord(n: number): string {
  return NUMBERS[n] ?? String(n);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A concept name inside a sentence. A name that is already a proper noun or an initialism keeps
 * its capitals; an ordinary one is lowercased, so "Explain laws of motion to me" reads as English.
 */
export function lowerFirst(name: string): string {
  const first = name.split(' ')[0] ?? '';
  if (first.length > 1 && first === first.toUpperCase()) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}
