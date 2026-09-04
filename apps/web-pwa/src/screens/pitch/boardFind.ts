/**
 * The board finder's arithmetic and its words — everything about /subjects' finder that is not a
 * DOM node, so it is tested rather than eyeballed.
 *
 * docs/SELL.md §6 gives the subjects page one job: remove the "does it cover mine" objection. That
 * makes two things load-bearing, and both live here:
 *
 *   the match   a reader types "telangana", or "ts ssc", or "cbse", or half of either, and the
 *               board they mean is the first row. The registry's own aliases are the search keys,
 *               so nothing has to be spelt the way we spell it.
 *   the answer  what we say about the board they found, which is either "the official chapter list
 *               is here" or "it is not, and here is what happens instead". Never a hedge. SELL §5:
 *               a company that tells you what it cannot do is believed about what it can.
 *
 * The data is `boards.json`, generated from the curriculum registry and the syllabus files by
 * `scripts/pitch-boards.ts`. No board, count, subject or year on this page is typed by hand.
 */

import data from './boards.json';

export interface PitchBoard {
  id: string;
  name: string;
  short: string;
  also: string[];
  where: string;
  subjects: string[];
  year: string | null;
  chapters: number;
}

export interface PitchBoards {
  source: string;
  registryBuild: string;
  total: number;
  countries: number;
  held: { boards: number; syllabuses: number; chapters: number };
  boards: PitchBoard[];
}

export const BOARDS = data as PitchBoards;

/** How many rows the finder shows at once. Enough to recognise yours, few enough to read. */
export const FINDER_ROWS = 6;

/** True where Wobo already holds this board's official chapter list. */
export function isHeld(board: PitchBoard): boolean {
  return board.chapters > 0;
}

/** The boards whose official chapter lists are held, strongest first. The finder's resting state. */
export const HELD: readonly PitchBoard[] = BOARDS.boards
  .filter(isHeld)
  .sort((a, b) => b.chapters - a.chapters);

/** A name as it is compared: lower case, punctuation dropped, whitespace folded. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How well one name answers a query, lower being better, `null` for no answer at all.
 *
 * The four steps are the four ways somebody types a board: the whole thing, the start of it, the
 * start of a word inside it ("secondary" finding "Board of Secondary Education"), and anywhere at
 * all. Nothing fuzzier: a finder that guesses is worse than one that says it has not got it,
 * because the page's whole job is to answer a yes-or-no question honestly.
 */
export function nameScore(name: string, query: string): number | null {
  const haystack = fold(name);
  if (!haystack || !query) return null;
  if (haystack === query) return 0;
  if (haystack.startsWith(query)) return 1;
  if (haystack.split(' ').some((word) => word.startsWith(query))) return 2;
  if (haystack.includes(query)) return 3;
  return null;
}

/** Every name a board answers to, best-known first. The registry's strings, never a coinage. */
export function names(board: PitchBoard): string[] {
  return [board.name, board.short, ...board.also].filter((name, i, all) => all.indexOf(name) === i);
}

/** The best score any of a board's registered names gets, or `null` where none of them match. */
export function boardScore(board: PitchBoard, query: string): number | null {
  let best: number | null = null;
  for (const name of names(board)) {
    const score = nameScore(name, query);
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

/**
 * The name to PUT ON THE ROW: the one that answered the query.
 *
 * A reader who types "tel" and is shown "TS SSC board", "TGBIE" and "TOSS" cannot see why any of
 * those rows is there, and a list you cannot see the reason for is a list you do not trust. Show
 * the registered name that actually matched and the reason is on the row, marked. With no query,
 * and for a query that matched nothing on display, the registry's full name is what stands.
 */
export function matchedName(board: PitchBoard, query: string): string {
  const needle = fold(query);
  if (!needle) return board.name;
  let best: { name: string; score: number } | null = null;
  for (const name of names(board)) {
    const score = nameScore(name, needle);
    if (score !== null && (best === null || score < best.score)) best = { name, score };
  }
  return best?.name ?? board.name;
}

/**
 * The rows for a query. Blank shows the held boards, because the resting state of this control
 * should already be an answer rather than an empty box.
 *
 * Ties break on the strongest answer first (a board whose chapter list we hold), then on the
 * shorter name, then alphabetically, so the same query always returns the same rows.
 */
export function findBoards(query: string, limit = FINDER_ROWS): PitchBoard[] {
  const needle = fold(query);
  if (!needle) return HELD.slice(0, limit);
  const scored: { board: PitchBoard; score: number }[] = [];
  for (const board of BOARDS.boards) {
    const score = boardScore(board, needle);
    if (score !== null) scored.push({ board, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(isHeld(b.board)) - Number(isHeld(a.board)) ||
      a.board.name.length - b.board.name.length ||
      a.board.name.localeCompare(b.board.name),
  );
  return scored.slice(0, limit).map((row) => row.board);
}

/** A list as a sentence reads it: "a, b and c". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The pill on a row: what this board's state is, in two words. */
export function statusWord(board: PitchBoard): string {
  return isHeld(board) ? 'Syllabus held' : 'In the list';
}

/**
 * What we say about the board a reader picked. Two sentences at most, and the second one is always
 * what happens next, so no row is a dead end.
 */
export function boardAnswer(board: PitchBoard): string {
  if (isHeld(board)) {
    return `The official ${board.year} chapter list for this board is already here, in your textbook's own order. Tell Wobo this is yours and it starts where your class is.`;
  }
  return `Wobo knows this board by name, and it does not hold the official chapter list for it yet. So you hand over your school's syllabus once, by typing it, photographing the page or dropping in the PDF, and Wobo builds the plan from that, unit by unit.`;
}

/** What we say when the registry has nothing by that name. Still an answer, still a way in. */
export const NO_MATCH =
  'No board of that name in the list yet. You can still start: hand Wobo your school’s syllabus once and it builds the plan from that, unit by unit.';

/**
 * The honest sentence under the finder, built from the generated counts rather than typed.
 *
 * It leads with the reach, names the boards whose chapter lists are actually held, and says what
 * happens for every other one. Three facts, no adjectives: docs/SELL.md §5 calls a vague coverage
 * claim a conversion leak, and this is the sentence that would have been one.
 */
export function reachLine(boards: PitchBoards = BOARDS): string {
  const held = boards.boards.filter(isHeld).map((b) => b.short);
  return `Wobo searches ${boards.total} boards and curricula across ${boards.countries} countries. It already holds the official chapter lists for ${andList(held)}, ${boards.held.chapters} chapters of them. For any other board, or a syllabus your school wrote itself, you hand it over once and Wobo builds the plan from that.`;
}
