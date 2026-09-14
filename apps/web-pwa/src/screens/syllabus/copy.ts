/**
 * EVERY WORD THE SYLLABUS PAGES SAY, BUILT FROM THE SYLLABUS ITSELF.
 *
 * The rule these pages live or die by: generating pages at scale is spam unless each one adds
 * something for a reader, and the thing ours add is real (docs/GROWTH-SEARCH.md §3) — the official
 * document a chapter was read from, and a tutor door that answers about that chapter. So every
 * title, description, heading and sentence in here is composed from the board's own names and from
 * facts this page actually holds: how many topics there are, which they are, which document they
 * came from, and when we last read it. Nothing is a template with a keyword swapped, and nothing
 * claims an explanation we do not have.
 *
 * The words are shaped by what people actually type (the harvest of Google and Bing autocomplete
 * for India, wave 33). Two findings changed the copy:
 *
 *   · **"maths", not "mathematics"** — 1,505 searches against 61. The URL keeps the board's own
 *     word (`/mathematics`), because an address is a name and not a guess at a phrase; the
 *     sentences and the link text say what a person says.
 *   · **"chapter", not "unit"** — 4,110 against 48. The board's documents call the layer a unit
 *     and the gateway serves it as a chapter; a reader gets "chapter". The one place we say unit
 *     is where the board has given us a unit with nothing under it, and calling that a chapter with
 *     no chapters in it would be the invention we refuse to make.
 *
 * The copy law of DESIGN.md §0 and `docs/copy/voice.md` §8 applies to every line: no invented
 * person, no class or age range in any direction (a class NAMED, which is the reader's own
 * question, is not a range), no allowance count, no em dash, no exclamation mark, sentence case,
 * and never a word against anyone. `copy.test.ts` runs the same patterns the gateway's
 * `test_copy_law.py` runs, over every one of the 1,111 pages this file writes.
 */

import { DESCRIPTION_MAX, trimDescription } from '../../shell/head';
import { handmade } from './handmade';
import { type Board, type Node, type Place, pathOf, type Source, type SubjectHub } from './tree';

// --- the small words -------------------------------------------------------------------------------

/**
 * What a person calls a subject, for a sentence and for link text. The board's own name is kept
 * everywhere else, and it is what the address is built from.
 */
const SPOKEN: Readonly<Record<string, string>> = {
  Mathematics: 'maths',
};

/** The subject as a reader would say it, mid-sentence. */
export function spoken(subject: string): string {
  return SPOKEN[subject] ?? subject.toLowerCase();
}

/** A class as it reads inside a sentence: "Class 10" becomes "class 10". */
export function classWords(level: string): string {
  return level.toLowerCase();
}

/** Words for one and two, numerals for anything a reader would count (voice.md §3). */
export function number(n: number): string {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  return String(n);
}

/**
 * "a" or "an" in front of an acronym, decided by how the first LETTER is said rather than how it
 * is spelt: "a CBSE document", "an ICSE document", "an NIOS document". Getting this wrong is one
 * of the few mistakes a reader notices instantly on an otherwise careful page.
 */
const VOWEL_SOUND = new Set('AEFHILMNORSX'.split(''));

export function article(name: string): string {
  const first = name.charAt(0);
  if (!first) return 'a';
  if (first === first.toUpperCase() && /[A-Z]/.test(first)) {
    return VOWEL_SOUND.has(first) ? 'an' : 'a';
  }
  return /^[aeiou]/i.test(first) ? 'an' : 'a';
}

/** "a", "a and b", "a, b and c" — the Indian English list, no serial comma. */
export function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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

/** An ISO stamp as a person reads a date. The clock is noise in a sentence; only the day is kept. */
export function dateWords(stamp: string | null): string | null {
  if (!stamp || stamp.length < 10) return null;
  const [y, m, d] = stamp.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  if (!y || !month || !d) return null;
  return `${Number(d)} ${month} ${y}`;
}

/** How many topics sit under this chapter, or under every chapter of this subject. */
function topicCount(node: Node): number {
  return node.children.reduce((sum, child) => sum + child.children.length, 0);
}

// --- where a node sits ------------------------------------------------------------------------------

/** "CBSE class 10 maths" — the placement line every deep page carries under its name. */
export function where(place: Place): string {
  const parts = [place.board.short];
  if (place.level) parts.push(classWords(place.level.name));
  if (place.subject) parts.push(spoken(place.subject.name));
  return parts.join(' ');
}

/** The trail from the board down to this page, as the crumbs a reader and a crawler both walk. */
export interface Crumb {
  label: string;
  path: string;
}

// --- the heading ------------------------------------------------------------------------------------

/**
 * A page's heading, in two parts: the thing's own name, and the quiet line inside the same heading
 * that says where it sits. Both are rendered inside the `<h1>`, so the heading text of every one of
 * the 1,111 pages is different — which is the point. A hundred pages headed "Light" tell a reader
 * and an engine nothing about which light.
 */
export interface Heading {
  name: string;
  where: string;
}

/**
 * The heading as one line of text: the name, a comma, then where it sits.
 *
 * THE COMMA IS NOT DECORATION. The two halves are rendered as two spans inside one `<h1>`, and
 * with nothing between them a board page's heading read "Central Board of Secondary Education the
 * CBSE syllabus, 2026-27" — broken English on the four highest-value pages in the family, and on
 * the tab as well, because the title is built from the same parts. An appositive takes a comma in
 * English, so it takes one here, and every one of the 1,111 headings reads as a sentence would.
 */
export function headingLine(head: Heading): string {
  return `${head.name}, ${head.where}`;
}

/**
 * THE NAME THIS PAGE GOES BY, and the one place a name is ever changed.
 *
 * Two boards' documents list the same name twice inside one chapter: CBSE class 12 chemistry has
 * "Physical Properties and Chemical Reactions" twice under Aldehydes, Ketones and Carboxylic
 * Acids, and "Chemical Reactions" twice under Amines. That is the document, so the name stays; what
 * cannot stay is two pages reading identically in a tab and in a result, which makes them one page
 * as far as an engine is concerned. So the second one carries its own position, which is a fact off
 * the same document and not a word we invented. Local to the node's own brothers and sisters, so a
 * page can work it out without reading the rest of the syllabus.
 */
export function distinctName(node: Node, siblings: readonly Node[], index: number): string {
  const before = siblings.slice(0, index).filter((other) => other.name === node.name).length;
  return before === 0 ? node.name : `${node.name} (${ordinal(before + 1)} of that name)`;
}

export function heading(place: Place): Heading {
  const board = place.board;
  const name = distinctName(place.node, place.siblings, place.index);
  switch (place.kind) {
    case 'board':
      return { name: board.name, where: `the ${board.short} syllabus for ${board.edition}` };
    case 'class':
      return { name, where: board.short };
    case 'subject':
      return { name, where: `${board.short} ${classWords((place.level as Node).name)}` };
    case 'chapter':
      return { name, where: where(place) };
    default:
      return { name, where: `${(place.chapter as Node).name}, ${where(place)}` };
  }
}

export function hubHeading(hub: SubjectHub): Heading {
  return { name: hub.name, where: 'every board we hold' };
}

// --- the title ---------------------------------------------------------------------------------------

const MARK = ' · Wobo';

/**
 * The tab and the search result. Distinctive words first, the brand last, and enough of the
 * placement that no two of the 1,111 can read the same. `copy.test.ts` proves that over the real
 * tree rather than trusting the shape.
 */
/**
 * Where a name is long enough to swallow a title. Some boards write a whole sentence as a topic
 * name ("Real-world deviations from textbook theory, such as in case of necessities, luxury
 * goods, perishable items, and expectations"). The name is the board's and stays whole in the
 * heading and on the page; only the TAB gets a shorter one, cut where a reader would stop.
 */
const TITLE_NAME_MAX = 88;
/** Past this, a topic's name is distinctive on its own and the chapter is dropped from the tab. */
const TITLE_NAME_PLAIN = 58;

function titleName(place: Place): string {
  const name = distinctName(place.node, place.siblings, place.index);
  return name.length <= TITLE_NAME_MAX ? name : trimDescription(name, TITLE_NAME_MAX, 30);
}

export function title(place: Place): string {
  const board = place.board;
  const level = place.level ? classWords(place.level.name) : '';
  const subject = place.subject ? spoken(place.subject.name) : '';
  const name = titleName(place);
  switch (place.kind) {
    case 'board':
      return `${board.short} syllabus, class by class${MARK}`;
    case 'class':
      return `${board.short} ${level} syllabus, every subject${MARK}`;
    case 'subject':
      return `${(place.level as Node).name} ${subject} syllabus, ${board.short}${MARK}`;
    case 'chapter':
      return `${name} · ${level} ${subject}, ${board.short}${MARK}`;
    default:
      return name.length > TITLE_NAME_PLAIN
        ? `${name} · ${level} ${subject}, ${board.short}${MARK}`
        : `${name} · ${(place.chapter as Node).name}, ${level} ${subject}, ${board.short}${MARK}`;
  }
}

export function hubTitle(hub: SubjectHub): string {
  return `${hub.name}, board by board${MARK}`;
}

// --- the description ------------------------------------------------------------------------------------

function chapterSummary(place: Place): string {
  const node = { ...place.node, name: distinctName(place.node, place.siblings, place.index) };
  const topics = place.node.children;
  const seat = `${place.board.short} ${classWords((place.level as Node).name)} ${spoken((place.subject as Node).name)}`;
  if (topics.length === 0) {
    // ICSE and ISC give us the unit and no topics under it. We publish the unit and say so; the
    // one thing we will not do is invent a chapter list nobody wrote (docs/GROWTH-SEARCH.md §3).
    return `${node.name} is a unit of the ${seat} syllabus. We hold the unit and the document it came from, and no topic list under it.`;
  }
  if (topics.length === 1) {
    return `${node.name} is a chapter of ${seat} with one topic in it, ${(topics[0] as Node).name}.`;
  }
  if (topics.length === 2) {
    return `${node.name} is a chapter of ${seat}. Its two topics are ${(topics[0] as Node).name} and ${(topics[1] as Node).name}.`;
  }
  const first = (topics[0] as Node).name;
  const last = (topics[topics.length - 1] as Node).name;
  return `${node.name} is a chapter of ${seat} with ${topics.length} topics in it, from ${first} to ${last}.`;
}

function subjectSummary(place: Place): string {
  const node = place.node;
  const chapters = node.children.length;
  const topics = topicCount(node);
  const seat = `${place.board.short} ${classWords((place.level as Node).name)}`;
  const word = chapters === 1 ? 'chapter' : 'chapters';
  // A short list is named rather than counted. Four subject pages hold a single chapter, and
  // "sets one chapter of science" tells a reader nothing they could not have guessed; the
  // chapter's own name is the answer they came for.
  const named =
    chapters > 0 && chapters <= 3
      ? ` ${chapters === 1 ? 'It is' : 'They are'} ${list(node.children.map((child) => child.name))}.`
      : '';
  if (topics === 0) {
    return `${seat} sets ${number(chapters)} ${word} of ${spoken(node.name)}.${named} We hold the units from the board's own document, and no topic lists under them.`;
  }
  return `${seat} sets ${number(chapters)} ${word} of ${spoken(node.name)}, ${number(topics)} topics between them.${named}`;
}

function classSummary(place: Place): string {
  const node = place.node;
  const named = node.children.map((subject) => spoken(subject.name));
  const chapters = node.children.reduce((sum, subject) => sum + subject.children.length, 0);
  return `${place.board.short} ${classWords(node.name)} on Wobo: ${list(named)}. ${number(chapters)} chapters in all, each one read from the board's own document.`;
}

function boardSummary(board: Board): string {
  let classes = 0;
  let subjects = 0;
  let chapters = 0;
  for (const level of board.children) {
    classes += 1;
    for (const subject of level.children) {
      subjects += 1;
      chapters += subject.children.length;
    }
  }
  return `We hold the ${board.short} syllabus for ${board.edition}: ${number(classes)} classes, ${number(subjects)} subject lists and ${number(chapters)} chapters. ${board.label}.`;
}

function topicSummary(place: Place): string {
  const chapter = place.chapter as Node;
  const name = distinctName(place.node, place.siblings, place.index);
  const seat = `${name} is a topic of ${chapter.name}, in ${where(place)}.`;
  if (place.siblings.length === 1)
    return `${seat} It is the only topic the document lists under it.`;
  return `${seat} It is the ${ordinal(place.index + 1)} of ${number(place.siblings.length)} topics the document lists under it.`;
}

/** "first", "second", "3rd" — words where a reader would say a word. */
export function ordinal(n: number): string {
  const words = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
  if (n < words.length) return words[n] as string;
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${tail}`;
}

/**
 * The one honest sentence about what this page is, built from what the page actually holds. It is
 * also the page's opening paragraph, so a reader and a search result are told the same thing.
 */
export function summary(place: Place): string {
  switch (place.kind) {
    case 'board':
      return boardSummary(place.board);
    case 'class':
      return classSummary(place);
    case 'subject':
      return subjectSummary(place);
    case 'chapter':
      return chapterSummary(place);
    default:
      return topicSummary(place);
  }
}

export function hubSummary(hub: SubjectHub): string {
  const boards = [...new Set(hub.places.map((row) => row.board.short))];
  const lists = hub.places.length;
  const chapters = hub.places.reduce((sum, row) => sum + row.subject.children.length, 0);
  const listWord = lists === 1 ? 'chapter list' : 'chapter lists';
  const chapterWord = chapters === 1 ? 'chapter' : 'chapters';
  return `${hub.name} on Wobo follows the board's own chapter list, not ours. We hold it for ${list(boards)}: ${number(lists)} ${listWord} and ${number(chapters)} ${chapterWord}, each one read from that board's own document and carrying the page it was read from.`;
}

/**
 * The meta description: the page's own opening words, cut where a reader would stop.
 *
 * It has to be the page's OPENING rather than any sentence we like best, because the build does
 * not use this value: `scripts/prerender.ts` reads the first paragraph back off the render. So on
 * the sixty-seven handwritten pages this is the handwritten opening, which is what those pages
 * lead with, and everywhere else it is the composed summary, which is what those lead with. The
 * two agreeing is not a nicety; when they disagreed, 320 pages were described by their provenance
 * line instead of by what they are about.
 */
export function description(place: Place): string {
  const written = handmade(pathOf(place));
  return trimDescription(written ? written.opening : summary(place), DESCRIPTION_MAX);
}

export function hubDescription(hub: SubjectHub): string {
  return trimDescription(hubSummary(hub), DESCRIPTION_MAX);
}

// --- the provenance, which is the whole reason these pages may exist ---------------------------------

/**
 * The quiet line that says where this came from. Two shapes, because two of our four boards are
 * still being checked and a page that called a provisional document "official" would be the one
 * dishonest sentence on an otherwise honest page.
 */
export function provenance(source: Source | null, board: Board): string {
  if (!source?.url) return 'We have no source document on file for this one.';
  const at = source.section ? `, ${source.section}` : '';
  const on = dateWords(source.fetched);
  const when = on ? `, read on ${on}` : '';
  if (board.status === 'verified') {
    return `From the official ${board.short} document for ${board.edition}${at}${when}.`;
  }
  return `From ${article(board.short)} ${board.short} document found on the board's own site${at}${when}. We are still checking it, so this page says provisional rather than official.`;
}

/** The line under it: how many named checks passed, and when. */
export function checksLine(source: Source | null): string | null {
  if (!source || source.checks.length === 0) return null;
  const on = dateWords(source.verified ?? source.fetched);
  const n = number(source.checks.length);
  const word = source.checks.length === 1 ? 'check' : 'checks';
  return on ? `${n} named ${word} passed on it on ${on}.` : `${n} named ${word} passed on it.`;
}

/** The hash of the bytes we read, shortened for the eye. The whole of it is in the page's markup. */
export function shortHash(source: Source | null): string | null {
  return source?.hash ? source.hash.slice(0, 12) : null;
}

// --- the tutor door -----------------------------------------------------------------------------------

export interface AskCopy {
  heading: string;
  placeholder: string;
  chips: readonly string[];
}

/**
 * The ask block's words. What it promises is exactly what the public ask box can do: the help
 * centre answers first, and a question it does not cover reaches the syllabus corpus, which knows
 * every chapter and topic by name and where each one sits. So the placeholder and the chips are
 * questions that corpus can actually answer about THIS page, never "explain this chapter to me",
 * which would be promising an explanation this page does not have.
 */
export function ask(place: Place): AskCopy {
  const name = place.node.name;
  const short = place.board.short;
  const chips: string[] = [];
  switch (place.kind) {
    case 'board':
      // NEVER `What does CBSE set in <the board>?`, which is what a single template for every
      // layer produced: both slots filled with the same entity, on all four board pages, in the
      // first two seconds a parent spends here.
      chips.push(`Which classes of ${short} do you hold?`);
      chips.push('Where did you get this syllabus?');
      break;
    case 'class':
      chips.push(`What does ${short} set in ${classWords(name)}?`);
      chips.push('Where did you get this syllabus?');
      break;
    case 'subject':
      chips.push(
        `What does ${short} set in ${classWords((place.level as Node).name)} ${spoken(name)}?`,
      );
      chips.push('Where did you get this syllabus?');
      break;
    default:
      // A chapter and a topic ask about themselves. Not "what does it cover", which the topic
      // list two inches above already answers: where else it turns up, and what sits beside it.
      chips.push(`Which other boards teach ${name}?`);
      chips.push(`What comes before ${name}?`);
      break;
  }
  chips.push('Does Wobo follow my school syllabus?');
  return {
    heading: `Ask about ${name}`,
    placeholder:
      place.kind === 'board'
        ? `Which subjects do you hold for ${short}?`
        : `Where does ${name} sit in the ${short} syllabus?`,
    chips,
  };
}

/**
 * The line a subject hub ends on. It says the two true things a reader on this page still needs:
 * this list belongs to a board, and a school that sets its own is not shut out.
 */
export function hubTail(hub: SubjectHub): string {
  return `Every chapter list here belongs to the board that wrote it, and ${spoken(hub.name)} on a board we have not read yet is not on this page. A school that sets its own list can hand Wobo that syllabus instead.`;
}

export function hubAsk(hub: SubjectHub): AskCopy {
  return {
    heading: `Ask about ${spoken(hub.name)}`,
    placeholder: `Which boards do you hold ${spoken(hub.name)} for?`,
    chips: [
      `What does ${spoken(hub.name)} cover?`,
      'Does Wobo follow my school syllabus?',
      'My school uses its own books',
    ],
  };
}

// --- the words on a link ---------------------------------------------------------------------------------

/**
 * What a link to this node reads as, from the page above it. The board's own name, always, and the
 * position only where the document lists the same name twice in one place (see `distinctName`).
 */
export function linkText(node: Node, siblings: readonly Node[] = [], index = -1): string {
  return index < 0 ? node.name : distinctName(node, siblings, index);
}

/** The line under a link in a list: what is under this node, counted, never estimated. */
export function linkNote(node: Node): string | null {
  const kids = node.children.length;
  if (kids === 0) return null;
  if (node.kind === 'subject') {
    const topics = topicCount(node);
    const word = kids === 1 ? 'chapter' : 'chapters';
    return topics === 0
      ? `${number(kids)} ${word}`
      : `${number(kids)} ${word}, ${number(topics)} topics`;
  }
  if (node.kind === 'chapter') {
    return `${number(kids)} ${kids === 1 ? 'topic' : 'topics'}`;
  }
  if (node.kind === 'class') {
    return `${number(kids)} ${kids === 1 ? 'subject' : 'subjects'}`;
  }
  return `${number(kids)} ${kids === 1 ? 'class' : 'classes'}`;
}

/** What the list of children is called on a page. A reader gets "chapters", never "units". */
export function childrenLabel(kind: Place['kind']): string {
  switch (kind) {
    case 'board':
      return 'Classes';
    case 'class':
      return 'Subjects';
    case 'subject':
      return 'Chapters';
    default:
      return 'Topics';
  }
}

/**
 * What a chapter page says in place of a topic list when the board's document gave us a unit and
 * nothing under it. Never a promise that the list is coming, and never an empty heading.
 */
export const NO_TOPICS =
  'The board publishes this one as a unit with no chapter list under it, so there is no list here. What is on this page is what the document says.';

// --- tier two: the drawn explanation, and the three questions ------------------------------------------

/**
 * THE THREE LABELS A TIER TWO BLOCK WEARS, AND NOTHING ELSE.
 *
 * Everything else a reader reads in that block came out of the concept core or off the board's own
 * syllabus: the idea, the reason it matters, the three questions and their answers, and the name of
 * the topic the figure was drawn for (`explained.ts`, and the gateway module that freezes it). This
 * file writes exactly three strings for it, and every tier two page wears the same three, which is
 * why `pages.ts` counts none of them as a page's own words.
 *
 * NOTHING HERE NARRATES (DESIGN.md §0.x). There is no line announcing that Wobo drew this, none
 * saying an explanation is coming, and none describing the figure. The heading is the board's own
 * name for the topic, the questions are called questions, and the drawing is simply there.
 */

/** Over the three questions. Plain, because the questions themselves are the interesting part. */
export const QUESTIONS_LABEL = 'Questions';

/**
 * The one line that keeps the page's two halves apart, inside the provenance block.
 *
 * The block above it says a chapter and its topics came from the board's own document, which is
 * the whole reason this family is allowed to exist. The explanation and the figure did NOT: they
 * are ours. Without this sentence a careful reader would reasonably take the board as the author
 * of an explanation the board never wrote, which is the one confusion a page carrying somebody
 * else's provenance can create. It is attribution rather than narration: it says who wrote what,
 * not what the software is about to do.
 */
export const OURS_LINE =
  "The chapter and its topics are the board's. The explanation, the figure and the questions on this page are ours.";
